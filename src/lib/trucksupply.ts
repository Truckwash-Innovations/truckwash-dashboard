import { db, uid } from './db'
import { enqueue } from './sync'
import { supabase, supabaseConfigured, supabaseUrl } from './api/supabaseApi'
import { inventory as voorraadRepo } from './repo'
import { leesInstelling, SLEUTELS } from './instellingen'
import {
  BESTELLING_STATUS,
  type Bestelling, type BestellingBron, type BestellingStatus, type Bestelregel,
  type InventoryItem, type Location, type Role, type User, type VoorraadAlarm,
} from './types'

/* ------------------------------------------------------------------ *
 *  Trucksshop, de leverancier van de vestigingen
 *
 *  Drie dingen die aan elkaar hangen:
 *
 *    Alarm        een artikel op een vestiging dat onder zijn minimum staat;
 *                 de database zet hem, de app toont en mailt hem
 *    Artikel      wat Trucksshop levert, met prijs, foto en minimum, en
 *                 desgewenst doorgezet naar de kassa
 *    Bestelling   wat er naar een vestiging gaat: van concept via inpakken
 *                 en verzenden tot ontvangen, met pakbon en verzendlabel
 *
 *  Waarom dit bestaat: "we zijn door de shampoo heen" kwam per telefoon, per
 *  appje of helemaal niet, en dan stond er een wasstraat stil. Nu meldt de
 *  voorraad het zelf, en de bestelling boekt de levering bij op de vestiging
 *  op het moment dat hij de deur uitgaat.
 *
 *  Alles wat hier puur kan is puur gehouden (geen Dexie, geen netwerk), zodat
 *  de zelftest het kan narekenen. De schrijvende functies volgen het patroon
 *  van de rest van de app: lokaal eerst, dan de wachtrij.
 * ------------------------------------------------------------------ */

async function put<T extends { id: string; updatedAt?: number }>(
  entity: Parameters<typeof enqueue>[0],
  table: { put: (v: T) => Promise<unknown> },
  record: T,
) {
  const stamped = { ...record, updatedAt: Date.now() }
  await table.put(stamped)
  await enqueue(entity, 'put', record.id, stamped)
  return stamped
}

/** Zijn we in een browser met verbinding? In Node (de zelftest) nee. */
function verbonden(): boolean {
  if (!supabaseConfigured) return false
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  return true
}

/**
 * Een serverfunctie aanroepen met het sessietoken.
 *
 * Zelfde patroon als trucky.beantwoord(): de functies staan open zonder
 * verplichte inlog (de cron moet erbij kunnen) en controleren dus zelf wie
 * er belt. Zonder token heeft bellen geen zin.
 */
async function roepFunctie<T>(naam: string, body: Record<string, unknown>): Promise<T> {
  const { data: sessie } = await supabase().auth.getSession()
  const token = sessie.session?.access_token
  if (!token) throw new Error('Je sessie is verlopen. Log opnieuw in.')

  const res = await fetch(`${supabaseUrl()}/functions/v1/${naam}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  const uit = await res.json().catch(() => null) as
    ({ ok?: boolean; reden?: string } & Record<string, unknown>) | null
  if (!res.ok || !uit || uit.ok === false) {
    throw new Error(uit?.reden ?? `De serverfunctie ${naam} gaf ${res.status} terug.`)
  }
  return uit as T
}

/* ================================================================== *
 *  Alarmen
 * ================================================================== */

/** De alarmen die nog niet zijn opgelost, nieuwste bovenaan. */
export function openAlarmen(alarmen: VoorraadAlarm[]): VoorraadAlarm[] {
  return alarmen
    .filter((a) => !a.opgelostAt)
    .sort((a, b) => b.ontstaanAt - a.ontstaanAt)
}

export interface AlarmenPerVestiging {
  locationId: string
  naam: string
  locatie?: Location
  alarmen: VoorraadAlarm[]
}

/**
 * De open alarmen gegroepeerd per vestiging, drukste vestiging bovenaan.
 *
 * Een vestiging die in de alarmen voorkomt maar niet in de lijst locaties
 * (net opgeheven, of nog niet gesynchroniseerd) krijgt geen lege groep maar
 * een naam die zegt wat er aan de hand is. Weglaten zou betekenen dat een
 * alarm onzichtbaar wordt om een reden die er los van staat.
 */
export function perVestiging(alarmen: VoorraadAlarm[], locaties: Location[]): AlarmenPerVestiging[] {
  const groepen = new Map<string, VoorraadAlarm[]>()
  for (const a of openAlarmen(alarmen)) {
    const lijst = groepen.get(a.locationId) ?? []
    lijst.push(a)
    groepen.set(a.locationId, lijst)
  }
  const uit: AlarmenPerVestiging[] = []
  for (const [locationId, lijst] of groepen) {
    const locatie = locaties.find((l) => l.id === locationId)
    uit.push({
      locationId,
      naam: locatie?.name ?? 'Onbekende vestiging',
      locatie,
      alarmen: lijst,
    })
  }
  return uit.sort((a, b) =>
    b.alarmen.length - a.alarmen.length || a.naam.localeCompare(b.naam, 'nl'))
}

/**
 * Een alarm op gezien zetten.
 *
 * Gezien is niet opgelost: de stand is nog steeds te laag. Het betekent
 * alleen dat iemand van Trucksshop het weet, en dan hoeft de ochtendmail
 * er niet nog eens over te beginnen.
 */
export async function markeerGezien(alarm: VoorraadAlarm, door: Pick<User, 'id' | 'name'>) {
  if (alarm.gezienAt) return alarm
  return put('voorraadAlarmen', db.voorraadAlarmen, {
    ...alarm,
    gezienAt: Date.now(),
    gezienDoor: door.id,
    gezienDoorNaam: door.name,
  })
}

/* ================================================================== *
 *  Artikelen
 * ================================================================== */

export interface ArtikelInvoer {
  id?: string
  locationId: string
  name: string
  unit: string
  sku?: string
  omschrijving?: string
  image?: string
  stock?: number
  minStock?: number
  bestelhoeveelheid?: number
  inkoopprijs?: number
  pricePerUnit?: number
  supplier?: string
  actief?: boolean
  exactCode?: string
}

const getal = (v: unknown, terugval = 0): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : terugval
}

/**
 * Een artikel aanmaken of bijwerken.
 *
 * Bestaat het al (id meegegeven en gevonden), dan blijven stand en velden
 * die niet zijn meegegeven staan: dit scherm gaat over het artikel, niet
 * over de voorraadstand -- die wordt door leveringen en verbruik bijgewerkt.
 */
export async function artikelOpslaan(input: ArtikelInvoer): Promise<InventoryItem> {
  // De server heeft een check op de fotomaat (inventory_items_image_maat, 0048).
  // Een te grote foto zou lokaal gewoon lukken en dan in de wachtrij blijven
  // hangen zonder dat de gebruiker iets ziet; liever nu een fout op het scherm.
  if (input.image && input.image.length > FOTO_SERVER_MAX_TEKENS) {
    throw new Error('De foto is te groot om op te slaan. Kies hem opnieuw; de app verkleint hem dan.')
  }

  const bestaand = input.id ? await db.inventory.get(input.id) : undefined

  const item: InventoryItem = {
    ...(bestaand ?? {
      id: uid('inv'),
      stock: 0,
      minStock: 0,
      pricePerUnit: 0,
      supplier: 'Trucksshop',
      updatedAt: Date.now(),
    }),
    locationId: input.locationId,
    name: input.name.trim(),
    unit: input.unit.trim() || 'stuk',
    sku: input.sku?.trim() || undefined,
    omschrijving: input.omschrijving?.trim() || undefined,
    image: input.image ?? bestaand?.image,
    stock: input.stock !== undefined ? getal(input.stock) : (bestaand?.stock ?? 0),
    minStock: input.minStock !== undefined ? getal(input.minStock) : (bestaand?.minStock ?? 0),
    bestelhoeveelheid: input.bestelhoeveelheid !== undefined
      ? Math.max(0, getal(input.bestelhoeveelheid))
      : (bestaand?.bestelhoeveelheid ?? 0),
    inkoopprijs: input.inkoopprijs !== undefined ? getal(input.inkoopprijs) : bestaand?.inkoopprijs,
    // Zonder aparte interne prijs is de inkoopprijs wat het kost.
    pricePerUnit: input.pricePerUnit !== undefined
      ? getal(input.pricePerUnit)
      : (bestaand?.pricePerUnit || getal(input.inkoopprijs, 0)),
    supplier: input.supplier?.trim() || bestaand?.supplier || 'Trucksshop',
    actief: input.actief ?? bestaand?.actief ?? true,
    exactCode: input.exactCode?.trim() || undefined,
  }
  if (!item.name) throw new Error('Een artikel heeft een naam nodig.')

  return voorraadRepo.upsert(item)
}

/**
 * Hetzelfde artikel op andere vestigingen zetten.
 *
 * De voorraad is per vestiging, dus "shampoo" bestaat negentien keer. Wie
 * een artikel toevoegt wil het niet negentien keer intikken. De kopie krijgt
 * dezelfde naam, sku, prijs en foto, en stand 0: wat er werkelijk ligt weet
 * de vestiging, niet wij. Staat er op een vestiging al een artikel met deze
 * sku (of, zonder sku, deze naam), dan slaan we die over -- twee keer
 * dezelfde shampoo op één vestiging is precies de verwarring die dit moest
 * voorkomen.
 */
export async function artikelKopieerNaar(
  item: InventoryItem,
  locationIds: string[],
  opties: { minimumMeenemen?: boolean } = {},
): Promise<InventoryItem[]> {
  const alles = await db.inventory.toArray()
  const zelfde = (x: InventoryItem, locationId: string) =>
    x.locationId === locationId && (
      item.sku ? x.sku === item.sku
               : x.name.trim().toLowerCase() === item.name.trim().toLowerCase())

  const gemaakt: InventoryItem[] = []
  for (const locationId of new Set(locationIds)) {
    if (locationId === item.locationId) continue
    if (alles.some((x) => zelfde(x, locationId))) continue
    const kopie = await voorraadRepo.upsert({
      ...item,
      id: uid('inv'),
      locationId,
      stock: 0,
      /*
       * Het minimum gaat standaard NIET mee.
       *
       * De kopie begint op stand 0, en stand 0 onder een minimum is voor de
       * trigger een alarm -- per vestiging, meteen, en binnen een kwartier
       * één mail met al die regels, terwijl er op de vloer niets veranderde.
       * Achttien vinkjes waren achttien rode kaarten. Het minimum hoort te
       * volgen op wat er werkelijk ligt, dus dat zet de leverancier per
       * vestiging zodra de stand geteld is. Wie het toch wil, zegt het.
       */
      minStock: opties.minimumMeenemen ? item.minStock : 0,
      updatedAt: Date.now(),
    })
    gemaakt.push(kopie)
  }
  return gemaakt
}

/**
 * Hoe groot een artikelfoto mag zijn, als data-URI.
 *
 * Het plaatje gaat mee in de rij van het artikel en dus naar elk apparaat
 * dat de voorraad synchroniseert. Negentien vestigingen keer honderd
 * artikelen keer een foto van een megabyte is geen voorraadlijst meer. De
 * kassa hanteert 150 kB (0027); wij blijven daar ruim onder, want dit is een
 * herkenningsplaatje en geen productfoto.
 */
export const FOTO_MAX_TEKENS = 48 * 1024
/** Wat de database hoogstens aanneemt (check inventory_items_image_maat in 0048). */
export const FOTO_SERVER_MAX_TEKENS = 150_000

/**
 * Een foto verkleinen tot een data-URI die in de rij past.
 *
 * Zelfde aanpak als vestigingen.verklein(), maar dan met een harde grens:
 * eerst de zijde omlaag, dan de kwaliteit, tot hij past. Lukt het niet
 * (geen canvas, een raar formaat), dan een fout en geen origineel van drie
 * megabyte in de database.
 */
export async function fotoVerkleinen(bestand: Blob, maxTekens = FOTO_MAX_TEKENS): Promise<string> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    throw new Error('Een foto verkleinen kan alleen in de app zelf.')
  }
  const bitmap = await createImageBitmap(bestand)
  try {
    for (const zijde of [320, 240, 180, 120]) {
      const schaal = Math.min(1, zijde / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * schaal))
      canvas.height = Math.max(1, Math.round(bitmap.height * schaal))
      const ctx = canvas.getContext('2d')
      if (!ctx) break
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const kwaliteit of [0.82, 0.7, 0.55, 0.4]) {
        const uri = canvas.toDataURL('image/jpeg', kwaliteit)
        if (uri.length <= maxTekens) return uri
      }
    }
  } finally {
    bitmap.close?.()
  }
  throw new Error('Deze foto is ook verkleind te groot. Probeer een eenvoudiger plaatje.')
}

/**
 * Een artikel in de kassa zetten (of daar bijwerken).
 *
 * De pos_*-tabellen zijn van de kassa en de app schrijft er niet rechtstreeks
 * in; de enige deur is de serverfunctie supply_artikel_naar_kassa. Die maakt
 * of werkt het kassaproduct bij met de naam, eenheid, foto en vestiging van
 * het artikel, en de prijs inclusief btw die hier wordt meegegeven.
 *
 * Werkt alleen met verbinding: de kassatabellen zitten niet in de
 * synchronisatie van deze app, dus er is geen wachtrij om op terug te vallen.
 */
export async function naarKassa(item: InventoryItem, prijsIncl: number, groep: string): Promise<string> {
  if (!verbonden()) {
    throw new Error('Een artikel naar de kassa zetten lukt alleen met verbinding.')
  }
  const { data, error } = await supabase().rpc('supply_artikel_naar_kassa', {
    item_id: item.id,
    prijs_incl: getal(prijsIncl),
    groep: groep.trim() || 'Overig',
  })
  if (error) throw new Error('Naar de kassa zetten mislukte: ' + error.message)
  return String(data ?? '')
}

/** Wat de kassa van een artikel weet: het gekoppelde product, de prijs, aan of uit. */
export interface KassaPrijs {
  inventoryItemId: string
  productId: string
  prijsIncl: number
  actief: boolean
}

/**
 * De kassaprijzen terugkijken.
 *
 * De leverancier mag pos_products niet lezen -- die tabel is voor personeel
 * -- maar wie de prijs zet hoort hem terug te kunnen zien. Daarom een
 * leesdeur in de database (supply_kassa_prijzen, 0048) die alleen de
 * koppeling, de prijs en aan/uit teruggeeft. Zonder verbinding: niets, en
 * dat is geen fout; het scherm zegt dan "onbekend" in plaats van te gokken.
 */
export async function kassaPrijzen(): Promise<KassaPrijs[] | null> {
  if (!verbonden()) return null
  const { data, error } = await supabase().rpc('supply_kassa_prijzen')
  if (error || !Array.isArray(data)) return null
  return (data as { inventory_item_id: string; product_id: string; price_incl: number; active: boolean }[])
    .map((r) => ({
      inventoryItemId: r.inventory_item_id,
      productId: r.product_id,
      prijsIncl: Number(r.price_incl) || 0,
      actief: !!r.active,
    }))
}

/* ================================================================== *
 *  Bestellingen
 * ================================================================== */

export type RegelInvoer = Omit<Bestelregel, 'id' | 'bestellingId' | 'updatedAt'>

/** Welke stap er na welke mag. Alles kan geannuleerd worden tot het verzonden is. */
export const VOLGENDE_STATUS: Record<BestellingStatus, BestellingStatus[]> = {
  concept:     ['bevestigd', 'geannuleerd'],
  bevestigd:   ['ingepakt', 'geannuleerd'],
  ingepakt:    ['verzonden', 'geannuleerd'],
  verzonden:   ['ontvangen'],
  ontvangen:   [],
  geannuleerd: [],
}

export function magNaar(van: BestellingStatus, naar: BestellingStatus): boolean {
  return VOLGENDE_STATUS[van].includes(naar)
}

/** Het voorvoegsel van een nummer dat nog niet door de server is uitgegeven. */
export const CONCEPT_VOORVOEGSEL = 'TS-concept-'

export function isConceptNummer(nummer: string): boolean {
  return nummer.startsWith(CONCEPT_VOORVOEGSEL)
}

/**
 * Een bestelnummer halen.
 *
 * Het nummer komt van een reeks op de server (public.bestelnummer): twee
 * apparaten die tegelijk een bestelling maken krijgen zo nooit hetzelfde
 * nummer. Zonder verbinding kan dat niet, en dan krijgt de bestelling een
 * tijdelijk nummer dat aan zijn vorm te herkennen is. Zodra hij bevestigd
 * wordt met verbinding, wordt het alsnog een echt nummer. Een bestelling
 * niet kunnen maken omdat je in de loods geen bereik hebt zou erger zijn.
 */
async function haalNummer(): Promise<string> {
  if (verbonden()) {
    try {
      const { data, error } = await supabase().rpc('bestelnummer')
      if (!error && typeof data === 'string' && data) return data
    } catch {
      /* dan het tijdelijke nummer */
    }
  }
  return CONCEPT_VOORVOEGSEL + Date.now()
}

/**
 * Hoeveel er van een artikel mee zou moeten.
 *
 * De bestelhoeveelheid die erbij staat; is die nul, dan genoeg om weer op
 * twee keer het minimum te komen (minimum * 2 - stand). Nooit nul of minder:
 * een regel met nul stuks is geen bestelling maar een vergissing.
 *
 * Een functie voor de alarmen, het voorraadscherm en de aanvraagknop op de
 * vloer: die rekenden eerst elk net iets anders, en dan vraagt de vestiging
 * 12 en zet de leverancier er 10 in zonder dat iemand weet waarom.
 */
export function voorstelAantal(item: Pick<InventoryItem, 'stock' | 'minStock' | 'bestelhoeveelheid'>): number {
  let aantal = getal(item.bestelhoeveelheid)
  if (aantal <= 0) aantal = item.minStock * 2 - item.stock
  if (aantal <= 0) aantal = Math.max(item.minStock, 1)
  return Math.round(aantal * 100) / 100
}

/** Het voorstel voor een bestelling uit de open alarmen; per artikel een regel. */
export function voorstelUitAlarmen(alarmen: VoorraadAlarm[], items: InventoryItem[]): RegelInvoer[] {
  const uit: RegelInvoer[] = []
  const gezien = new Set<string>()
  for (const a of openAlarmen(alarmen)) {
    if (gezien.has(a.itemId)) continue
    gezien.add(a.itemId)
    const item = items.find((i) => i.id === a.itemId)

    uit.push({
      itemId: a.itemId,
      itemNaam: item?.name ?? a.itemNaam,
      aantal: voorstelAantal({
        stock: item?.stock ?? a.stand,
        minStock: item?.minStock ?? a.minimum,
        bestelhoeveelheid: item?.bestelhoeveelheid,
      }),
      eenheid: item?.unit ?? 'stuk',
      prijs: item?.inkoopprijs,
    })
  }
  return uit
}

/**
 * Een nieuwe bestelling met haar regels.
 *
 * De bestelling gaat vóór de regels de wachtrij in (en PUSH_ORDER houdt dat
 * ook zo): een regel die eerder aankomt dan zijn bestelling wordt door de
 * server geweigerd op de verwijzing.
 */
export async function nieuweBestelling(input: {
  locationId: string
  bron: BestellingBron
  door: Pick<User, 'id' | 'name'>
  regels: RegelInvoer[]
  opmerking?: string
}): Promise<{ bestelling: Bestelling; regels: Bestelregel[] }> {
  const regelsMetInhoud = input.regels.filter((r) => r.aantal > 0)
  if (!regelsMetInhoud.length) throw new Error('Een bestelling heeft minstens één regel nodig.')

  const nu = Date.now()
  const bestelling: Bestelling = {
    id: uid('bst'),
    nummer: await haalNummer(),
    locationId: input.locationId,
    status: 'concept',
    bron: input.bron,
    aangemaaktDoor: input.door.id,
    aangemaaktDoorNaam: input.door.name,
    aangemaaktAt: nu,
    opmerking: input.opmerking?.trim() || undefined,
    updatedAt: nu,
  }
  await put('bestellingen', db.bestellingen, bestelling)

  const regels: Bestelregel[] = []
  for (const r of regelsMetInhoud) {
    const regel: Bestelregel = {
      ...r,
      id: uid('bsr'),
      bestellingId: bestelling.id,
      itemNaam: r.itemNaam.trim(),
      updatedAt: nu,
    }
    regels.push(await put('bestelregels', db.bestelregels, regel))
  }
  return { bestelling, regels }
}

/**
 * De pure kant van een statuswijziging: het object met de juiste stempels.
 *
 * Elke stap krijgt zijn eigen tijdstempel, en die wordt niet overschreven
 * als hij er al staat -- wie een bestelling per ongeluk twee keer op
 * verzonden zet, verandert daarmee niet wanneer hij werkelijk wegging.
 */
export function volgendeStatus(bestelling: Bestelling, status: BestellingStatus, nu = Date.now()): Bestelling {
  const uit: Bestelling = { ...bestelling, status }
  if (status === 'bevestigd' && !uit.bevestigdAt) uit.bevestigdAt = nu
  if (status === 'verzonden') {
    // Verzonden zonder bevestigd komt voor als iemand snel werkt; dan is
    // het moment van verzenden ook het moment van bevestigen.
    if (!uit.bevestigdAt) uit.bevestigdAt = nu
    if (!uit.verzondenAt) uit.verzondenAt = nu
  }
  if (status === 'ontvangen' && !uit.ontvangenAt) uit.ontvangenAt = nu
  return uit
}

/**
 * Wie de server een voorraadmutatie laat schrijven.
 *
 * De insert-regel op stock_movements (stock_insert, 0040, door 0048 bewust
 * ongemoeid gelaten) laat alleen is_staff() door, en dat zijn precies deze
 * rollen. De rol trucksupply zit er niet bij: verbruik boeken doet de
 * vestiging. Dit lijstje is een spiegel van public.is_staff() in 0048;
 * verandert die functie, dan dit lijstje ook.
 *
 * Waarom de app dit moet weten: een mutatie die de server weigert komt niet
 * terug als foutmelding maar blijft in de wachtrij hangen, en na acht
 * pogingen logt de synchronisatie "Blijft hangen". Dat gebeurde bij elke
 * levering van een gebruiker met alleen de rol trucksupply, terwijl de stand
 * zelf wel aankwam (inventory_write laat de leverancier wel door). Beter
 * vooraf weten welke weg open is dan achteraf een wachtrij vol spoken.
 */
export const MUTATIE_ROLLEN: readonly Role[] = [
  'employee', 'supervisor', 'technician', 'administratie', 'management', 'developer',
]

/** Mag deze gebruiker een rij in stock_movements zetten (spiegel van stock_insert)? */
export function magMutatieBoeken(door: { roles?: readonly Role[] }): boolean {
  return (door.roles ?? []).some((r) => MUTATIE_ROLLEN.includes(r))
}

/**
 * Een levering bijboeken op één artikel van de vestiging.
 *
 * Twee wegen, allebei positief en met dezelfde uitkomst voor de stand:
 *
 *   mutatie   als de gebruiker een voorraadmutatie mag schrijven (zie
 *             MUTATIE_ROLLEN): via de inventory-repo, dus mét een regel
 *             "Levering Trucksshop <nummer>" in de mutaties van de vestiging
 *   stand     anders alleen de stand zelf ophogen (inventory_write laat de
 *             leverancier door). De bestelling met haar regels en
 *             verzondenAt ís dan het bewijs van de levering; er staat alleen
 *             geen losse regel tussen het verbruik op de vloer.
 *
 * Zodra deel A stock_insert openzet voor de leverancier hoeft alleen
 * 'trucksupply' bij MUTATIE_ROLLEN en loopt alles via de eerste weg.
 */
async function boekLevering(
  item: InventoryItem,
  aantal: number,
  bestelling: Bestelling,
  door: Pick<User, 'id' | 'name' | 'roles'>,
): Promise<'mutatie' | 'stand'> {
  if (magMutatieBoeken(door)) {
    await voorraadRepo.adjust({
      itemId: item.id,
      qty: aantal,
      reason: `Levering Trucksshop ${bestelling.nummer}`,
      user: door,
    })
    return 'mutatie'
  }
  await voorraadRepo.upsert({
    ...item,
    stock: Math.round((item.stock + aantal) * 100) / 100,
  })
  return 'stand'
}

/**
 * Een bestelling een stap verder zetten.
 *
 * Bij 'verzonden' wordt de levering bijgeboekt op de vestiging: per regel
 * positief, met de reden "Levering Trucksshop <nummer>" als de gebruiker
 * een mutatie mag schrijven en anders alleen de stand (zie boekLevering).
 * Dat gebeurt één keer: staat hij al op verzonden of ontvangen, dan wordt er
 * niets nog eens bijgeboekt.
 *
 * Eerst boeken, dan de status. Andersom kon een mislukte boeking een
 * bestelling opleveren die "verzonden" zegt terwijl de vestiging de voorraad
 * nooit heeft zien binnenkomen -- en dan gaat het alarm er nooit af.
 */
export async function zetStatus(
  bestelling: Bestelling,
  status: BestellingStatus,
  door: Pick<User, 'id' | 'name' | 'roles'>,
): Promise<Bestelling> {
  if (bestelling.status === status) return bestelling
  // VOLGENDE_STATUS is de enige toegestane volgorde. De knoppen houden zich
  // eraan, maar wie dit rechtstreeks aanroept ('geannuleerd' -> 'verzonden')
  // zou anders voorraad bijboeken op een bestelling die nooit de deur uitging.
  if (!magNaar(bestelling.status, status)) {
    const van = BESTELLING_STATUS[bestelling.status].label.toLowerCase()
    const naar = BESTELLING_STATUS[status].label.toLowerCase()
    throw new Error(`Een bestelling gaat niet van ${van} naar ${naar}`)
  }

  let volgende = volgendeStatus(bestelling, status)

  if (status === 'verzonden' && bestelling.status !== 'verzonden' && bestelling.status !== 'ontvangen') {
    const regels = await db.bestelregels.where('bestellingId').equals(bestelling.id).toArray()
    for (const r of regels) {
      const aantal = r.geleverd ?? r.aantal
      if (aantal <= 0) continue
      const item = await db.inventory.get(r.itemId)
      if (!item) {
        console.warn(`[trucksupply] artikel ${r.itemId} (${r.itemNaam}) staat niet in de voorraad; niet bijgeboekt`)
        continue
      }
      await boekLevering(item, aantal, bestelling, door)
    }
  }

  // Een concept-nummer alsnog inruilen voor een echt nummer, nu er misschien
  // verbinding is. Bij elke stap, niet alleen bij bevestigen: wie offline
  // bevestigde en later met verbinding inpakt, moet geen 'TS-concept-...' op
  // de pakbon en het verzendlabel krijgen.
  if (isConceptNummer(volgende.nummer)) {
    const nummer = await haalNummer()
    if (!isConceptNummer(nummer)) volgende = { ...volgende, nummer }
  }

  return put('bestellingen', db.bestellingen, volgende)
}

/** Vervoerder en track & trace erbij zetten, of de opmerking wijzigen. */
export async function bestellingBijwerken(
  bestelling: Bestelling,
  patch: Partial<Pick<Bestelling, 'vervoerder' | 'trackTrace' | 'opmerking'>>,
): Promise<Bestelling> {
  return put('bestellingen', db.bestellingen, {
    ...bestelling,
    vervoerder: patch.vervoerder !== undefined ? (patch.vervoerder.trim() || undefined) : bestelling.vervoerder,
    trackTrace: patch.trackTrace !== undefined ? (patch.trackTrace.trim() || undefined) : bestelling.trackTrace,
    opmerking: patch.opmerking !== undefined ? (patch.opmerking.trim() || undefined) : bestelling.opmerking,
  })
}

/** Het geleverde aantal op een regel, als dat afwijkt van wat er besteld was. */
export async function regelGeleverd(regel: Bestelregel, geleverd: number): Promise<Bestelregel> {
  return put('bestelregels', db.bestelregels, {
    ...regel,
    geleverd: Math.max(0, getal(geleverd)),
  })
}

/** Een conceptbestelling weggooien. Verder dan concept kan alleen annuleren. */
export async function bestellingVerwijderen(bestelling: Bestelling): Promise<void> {
  if (bestelling.status !== 'concept') {
    throw new Error('Alleen een concept kan weg; annuleer de bestelling anders.')
  }
  const regels = await db.bestelregels.where('bestellingId').equals(bestelling.id).toArray()
  for (const r of regels) {
    await db.bestelregels.delete(r.id)
    await enqueue('bestelregels', 'delete', r.id, null)
  }
  await db.bestellingen.delete(bestelling.id)
  await enqueue('bestellingen', 'delete', bestelling.id, null)
}

/**
 * De pakbon per mail doorsturen -- naar de vestiging, of naar een vervoerder.
 *
 * Gaat via de serverfunctie, want de app heeft geen mailsleutel en hoort die
 * ook niet te hebben. De functie zet doorgestuurd_naar/at op de server; we
 * zetten het hier ook meteen lokaal, zodat het scherm niet op de volgende
 * synchronisatie hoeft te wachten.
 */
export async function mailBestelling(bestelling: Bestelling, naar: string, bericht: string): Promise<Bestelling> {
  const adres = naar.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adres)) throw new Error('Dat is geen geldig mailadres.')

  await roepFunctie<{ ok: boolean }>('trucksupply', {
    actie: 'mail-bestelling',
    bestellingId: bestelling.id,
    naar: adres,
    bericht: bericht.trim(),
  })

  return put('bestellingen', db.bestellingen, {
    ...bestelling,
    doorgestuurdNaar: adres,
    doorgestuurdAt: Date.now(),
  })
}

/* ------------------------------------------------------------------ *
 *  Pakbon en verzendlabel
 * ------------------------------------------------------------------ */

const AFZENDER = 'Trucksshop'

function datumTekst(ms?: number): string {
  if (!ms) return '-'
  return new Date(ms).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function aantalTekst(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')
}

/**
 * De pakbon als platte tekst, voor de mail en als terugval voor de print.
 *
 * Platte tekst met opzet: de mail bevat wat mensen hebben ingetikt (namen,
 * opmerkingen) en dat hoort niet als HTML naar buiten te gaan.
 */
export function pakbonTekst(bestelling: Bestelling, regels: Bestelregel[], locatie?: Location): string {
  const r: string[] = []
  r.push(`PAKBON ${bestelling.nummer}`)
  r.push(`Afzender: ${AFZENDER}`)
  r.push(`Datum: ${datumTekst(bestelling.verzondenAt ?? bestelling.bevestigdAt ?? bestelling.aangemaaktAt)}`)
  r.push('')
  r.push('Bestemming:')
  r.push(`  ${locatie?.name ?? 'Vestiging ' + bestelling.locationId}`)
  if (locatie?.address) r.push(`  ${locatie.address}`)
  if (locatie?.postcode || locatie?.city) r.push(`  ${[locatie?.postcode, locatie?.city].filter(Boolean).join(' ')}`)
  if (locatie?.phone) r.push(`  ${locatie.phone}`)
  r.push('')
  r.push('Inhoud:')
  const mijn = regels.filter((x) => x.bestellingId === bestelling.id)
  for (const regel of mijn) {
    const aantal = regel.geleverd ?? regel.aantal
    r.push(`  ${aantalTekst(aantal)} ${regel.eenheid}  ${regel.itemNaam}`)
  }
  if (!mijn.length) r.push('  (geen regels)')
  if (bestelling.opmerking) {
    r.push('')
    r.push(`Opmerking: ${bestelling.opmerking}`)
  }
  if (bestelling.vervoerder || bestelling.trackTrace) {
    r.push('')
    r.push(`Vervoerder: ${bestelling.vervoerder ?? '-'}`)
    if (bestelling.trackTrace) r.push(`Track & trace: ${bestelling.trackTrace}`)
  }
  return r.join('\n')
}

/** Wat er op het printvel komt: de pakbon en het verzendlabel, als gegevens. */
export interface Printvel {
  nummer: string
  datum: string
  afzender: string
  ontvanger: {
    naam: string
    adres?: string
    postcode?: string
    plaats?: string
    telefoon?: string
  }
  regels: { aantal: number; eenheid: string; naam: string; sku?: string }[]
  opmerking?: string
  vervoerder?: string
  trackTrace?: string
  /** Het label: kort, groot, en met het nummer dat op de doos komt. */
  label: { van: string; naar: string; regel2: string; nummer: string }
}

export function printvel(
  bestelling: Bestelling,
  regels: Bestelregel[],
  locatie?: Location,
  items: InventoryItem[] = [],
): Printvel {
  const naam = locatie?.name ?? 'Vestiging ' + bestelling.locationId
  return {
    nummer: bestelling.nummer,
    datum: datumTekst(bestelling.verzondenAt ?? bestelling.bevestigdAt ?? bestelling.aangemaaktAt),
    afzender: AFZENDER,
    ontvanger: {
      naam,
      adres: locatie?.address,
      postcode: locatie?.postcode,
      plaats: locatie?.city,
      telefoon: locatie?.phone,
    },
    regels: regels
      .filter((x) => x.bestellingId === bestelling.id)
      .map((x) => ({
        aantal: x.geleverd ?? x.aantal,
        eenheid: x.eenheid,
        naam: x.itemNaam,
        sku: items.find((i) => i.id === x.itemId)?.sku,
      })),
    opmerking: bestelling.opmerking,
    vervoerder: bestelling.vervoerder,
    trackTrace: bestelling.trackTrace,
    label: {
      van: AFZENDER,
      naar: naam,
      regel2: [locatie?.address, [locatie?.postcode, locatie?.city].filter(Boolean).join(' ')]
        .filter(Boolean).join(', '),
      nummer: bestelling.nummer,
    },
  }
}

/* ================================================================== *
 *  Instellingen
 * ================================================================== */

export interface TrucksshopInstellingen {
  mail: string
  /** Het uur (Europe/Amsterdam) waarop de ochtendmail vertrekt */
  ochtendUur: number
  exactDivision: string
}

/** Wat er staat, met de terugval die de serverfunctie ook hanteert. */
export async function trucksupplyInstellingen(): Promise<TrucksshopInstellingen> {
  const uur = Number(await leesInstelling(SLEUTELS.trucksupplyOchtendUur, '8'))
  return {
    mail: await leesInstelling(SLEUTELS.trucksupplyMail, 'casper@truckwash1group.nl'),
    ochtendUur: Number.isInteger(uur) && uur >= 0 && uur <= 23 ? uur : 8,
    exactDivision: await leesInstelling(SLEUTELS.exactDivision, ''),
  }
}

/** Een testmail naar het ingestelde adres, om te zien of de keten werkt. */
export async function testMail(): Promise<void> {
  await roepFunctie<{ ok: boolean }>('trucksupply', { actie: 'test-mail' })
}

/* ================================================================== *
 *  Exact
 *
 *  De koppeling zelf: verbinden, kijken of hij er nog is, en losmaken. De
 *  tokens staan in exact_koppeling, waar alleen de server bij kan; de app
 *  ziet hoogstens of er verbinding is en tot wanneer.
 *
 *  Sinds 0052 komen de sleutels van de Exact-app daar ook vandaan, te zetten
 *  vanuit Ontwikkeling -> Exact. Het clientgeheim gaat alleen heen en nooit
 *  terug: de server stuurt hoogstens of het gezet is en de laatste vier
 *  tekens.
 * ================================================================== */

/** Wat er in de rij staat -- voor de velden van het formulier. */
export interface ExactOpgeslagen {
  clientId: string
  geheimGezet: boolean
  basisUrl: string
  redirectUri: string
  omgeving: 'proef' | 'echt'
}

export interface ExactStatus {
  verbonden: boolean
  division?: string
  verlooptAt?: number
  laatsteFout?: string
  /** Staan er sleutels, waar dan ook vandaan. */
  ingesteld?: boolean
  omgeving?: 'proef' | 'echt'

  /* Hieronder alleen voor wie de sleutels mag zien (ontwikkeling,
     management). Bij iedereen anders laat de server ze gewoon weg. */
  opgeslagen?: ExactOpgeslagen
  clientId?: string
  geheimGezet?: boolean
  geheimStaart?: string
  basisUrl?: string
  redirectUri?: string
  bron?: 'database' | 'omgeving' | 'geen'
  sleutelsDoor?: string
  sleutelsAt?: number
  standaardRedirect?: string
  domeinen?: string[]
}

/**
 * Wat er naar de server gaat bij het opslaan.
 *
 * Het geheim is optioneel en dat is het hele punt: laat je het weg, dan
 * blijft staan wat er staat. Zo kun je het adres wijzigen zonder dat het
 * geheim eerst naar de browser toe moet om het weer terug te sturen.
 */
export interface ExactSleutels {
  clientId?: string
  geheim?: string
  geheimWissen?: boolean
  basis?: string
  redirect?: string
  omgeving?: 'proef' | 'echt'
}

function alsStatus(uit: ExactStatus & { ok?: boolean }): ExactStatus {
  return {
    verbonden: !!uit.verbonden,
    division: uit.division || undefined,
    verlooptAt: uit.verlooptAt || undefined,
    laatsteFout: uit.laatsteFout || undefined,
    ingesteld: uit.ingesteld,
    omgeving: uit.omgeving,
    opgeslagen: uit.opgeslagen,
    clientId: uit.clientId || undefined,
    geheimGezet: uit.geheimGezet,
    geheimStaart: uit.geheimStaart || undefined,
    basisUrl: uit.basisUrl || undefined,
    redirectUri: uit.redirectUri || undefined,
    bron: uit.bron,
    sleutelsDoor: uit.sleutelsDoor || undefined,
    sleutelsAt: uit.sleutelsAt || undefined,
    standaardRedirect: uit.standaardRedirect || undefined,
    domeinen: uit.domeinen,
  }
}

export async function exactStatus(): Promise<ExactStatus> {
  return alsStatus(await roepFunctie<ExactStatus & { ok?: boolean }>('exact', { actie: 'status' }))
}

/**
 * De sleutels opslaan. Geeft de nieuwe stand terug, plus of de koppeling
 * erdoor is losgegaan -- dat gebeurt zodra het id, het geheim, het adres of
 * de omgeving verandert, want de tokens horen bij het stel waarmee ze zijn
 * opgehaald.
 */
export async function exactInstellen(
  velden: ExactSleutels,
): Promise<{ stand: ExactStatus; losgekoppeld: boolean }> {
  const uit = await roepFunctie<ExactStatus & { ok?: boolean; losgekoppeld?: boolean }>(
    'exact', { actie: 'instellen', ...velden },
  )
  return { stand: alsStatus(uit), losgekoppeld: !!uit.losgekoppeld }
}

/** De URL waar de gebruiker Exact toestemming geeft; open hem in een nieuw venster. */
export async function exactVerbindUrl(): Promise<string> {
  const uit = await roepFunctie<{ url?: string }>('exact', { actie: 'verbind-url' })
  if (!uit.url) throw new Error('De server gaf geen adres terug om mee te verbinden.')
  return uit.url
}

export async function exactLos(): Promise<void> {
  await roepFunctie<{ ok: boolean }>('exact', { actie: 'los' })
}

/* ------------------------------------------------------------------ *
 *  Het rekeningschema
 *
 *  Twee lijsten die naast elkaar horen te staan: die van ons (kort, met
 *  eigen namen) en die van Exact (compleet). Wat je wilt weten is niet hoe
 *  lang ze zijn, maar of elke code waarop wij boeken daar ook bestaat --
 *  anders wordt de boeking straks geweigerd en is de factuur al weg.
 * ------------------------------------------------------------------ */

export interface GrootboekRegel {
  code: string
  naam: string
  categorie: string | null
  actief: boolean
  inExact: boolean
  exactNaam: string | null
  exactSoort: string | null
  geblokkeerd: boolean
}

/** Een rekening die Exact kent en wij nog niet. */
export interface ExactRekening {
  code: string
  omschrijving: string
  soort: string | null
  geblokkeerd: boolean
}

export interface GrootboekStand {
  regels: GrootboekRegel[]
  /** Wat Exact kent en wij nog niet -- de lijst om uit over te nemen. */
  nogNiet: ExactRekening[]
  /** Actieve rekeningen van ons die Exact niet kent. */
  ontbreekt: number
  /** Actieve rekeningen die in Exact geblokkeerd staan. */
  geblokkeerd: number
  /** Hoeveel rekeningen Exact in totaal kent. */
  exactAantal: number
  laatstAt: number | null
  laatsteFout: string | null
  door: string | null
}

function alsStand(uit: Partial<GrootboekStand>): GrootboekStand {
  return {
    regels: uit.regels ?? [],
    nogNiet: uit.nogNiet ?? [],
    ontbreekt: uit.ontbreekt ?? 0,
    geblokkeerd: uit.geblokkeerd ?? 0,
    exactAantal: uit.exactAantal ?? 0,
    laatstAt: uit.laatstAt ?? null,
    laatsteFout: uit.laatsteFout ?? null,
    door: uit.door ?? null,
  }
}

/** De stand zonder Exact te bellen: alleen wat er is opgeslagen. */
export async function exactGrootboekStand(): Promise<GrootboekStand> {
  return alsStand(await roepFunctie<GrootboekStand>('exact', { actie: 'grootboek-stand' }))
}

/** Het schema opnieuw ophalen bij Exact. Duurt even bij een grote administratie. */
export async function exactSyncGrootboek(): Promise<GrootboekStand & { aantal: number }> {
  const uit = await roepFunctie<GrootboekStand & { aantal?: number }>(
    'exact', { actie: 'sync-grootboek' })
  return { ...alsStand(uit), aantal: uit.aantal ?? 0 }
}

/* ------------------------------------------------------------------ *
 *  Het personeel
 *
 *  Let op de richting. Personeel naar Exact sturen kan niet: de HRM-kant
 *  van hun API is alleen-lezen (payroll/Employees doet GET en verder
 *  niets). Wat hier gebeurt is dus vergelijken, en dat blijkt nuttiger dan
 *  het klinkt -- vooral de vraag wie in Exact uit dienst staat en hier nog
 *  gewoon kan inloggen.
 * ------------------------------------------------------------------ */

export interface PersoneelRegel {
  userId: string
  naam: string
  email: string
  actief: boolean
  employeeHid: number | null
  koppelBron: 'email' | 'naam' | 'handmatig' | null
  exactNaam: string | null
  exactActief: boolean | null
  uitDienstPer: number | null
  /** Uit dienst bij Exact, hier nog actief. */
  wegMaarActief: boolean
}

export interface ExactPersoon {
  employeeHid: number
  naam: string
  email: string
  priveEmail?: string
  actief: boolean
  inDienstPer?: number | null
  uitDienstPer?: number | null
  /** profiles.id van wie hij al aan hangt, of null. */
  gekoppeldAan?: string | null
}

export interface PersoneelStand {
  regels: PersoneelRegel[]
  /** Iedereen die Exact kent -- de lijst waarin je zoekt. */
  exactMensen: ExactPersoon[]
  /** Wie Exact kent en aan niemand hier gekoppeld is. */
  alleenInExact: ExactPersoon[]
  zonderKoppeling: number
  weg: number
  exactAantal: number
  laatstAt: number | null
  laatsteFout: string | null
  door: string | null
}

function alsPersoneel(uit: Partial<PersoneelStand>): PersoneelStand {
  return {
    regels: uit.regels ?? [],
    exactMensen: uit.exactMensen ?? [],
    alleenInExact: uit.alleenInExact ?? [],
    zonderKoppeling: uit.zonderKoppeling ?? 0,
    weg: uit.weg ?? 0,
    exactAantal: uit.exactAantal ?? 0,
    laatstAt: uit.laatstAt ?? null,
    laatsteFout: uit.laatsteFout ?? null,
    door: uit.door ?? null,
  }
}

export async function exactPersoneelStand(): Promise<PersoneelStand> {
  return alsPersoneel(await roepFunctie<PersoneelStand>('exact', { actie: 'personeel-stand' }))
}

/** Ophalen bij Exact, en meteen koppelen wat op e-mailadres te koppelen valt. */
export async function exactSyncPersoneel(): Promise<PersoneelStand & { gekoppeld: number }> {
  const uit = await roepFunctie<PersoneelStand & { gekoppeld?: number }>(
    'exact', { actie: 'sync-personeel' })
  return { ...alsPersoneel(uit), gekoppeld: uit.gekoppeld ?? 0 }
}

/**
 * Alles wat Exact over deze medewerker weet.
 *
 * Apart opgehaald en niet meegeleverd met de lijst: het is per persoon
 * tientallen velden en er kan een BSN in zitten. Dat hoort niet mee te reizen
 * met een overzicht dat je opent om te zien wie waar bij hoort.
 */
export async function exactMedewerkerDetails(
  employeeHid: number,
): Promise<{ employeeHid: number; naam: string; velden: Record<string, unknown> }> {
  const uit = await roepFunctie<{ employeeHid: number; naam: string; velden: Record<string, unknown> }>(
    'exact', { actie: 'medewerker-details', employeeHid })
  return { employeeHid: uit.employeeHid, naam: uit.naam ?? '', velden: uit.velden ?? {} }
}

/** Met de hand koppelen. employeeHid null = de koppeling weghalen. */
export async function exactKoppelMedewerker(
  userId: string,
  employeeHid: number | null,
): Promise<PersoneelStand> {
  return alsPersoneel(await roepFunctie<PersoneelStand>(
    'exact', { actie: 'koppel-medewerker', userId, employeeHid }))
}


/* ------------------------------------------------------------------ *
 *  Goedgekeurde facturen naar Exact
 *
 *  Staat standaard uit, en dat slot zit op de server -- deze functies
 *  krijgen gewoon een weigering terug zolang de schakelaar uit staat.
 * ------------------------------------------------------------------ */

export interface WachtendeFactuur {
  id: string
  /** In welke bv deze bon geboekt wordt; leeg = nog niet bekend. */
  administratie: string | null
  leverancier: string
  zoeknaam: string
  factuurnummer: string | null
  bedrag: number
  btwPct: number
  grootboek: string | null
  crediteur: string | null
  datum: number
  /** Wat er nog ontbreekt voordat deze bon weg kan. Leeg = klaar. */
  mist: string[]
  fout: string | null
}

export interface ExactAdministratie {
  code: string
  naam: string
  actief: boolean
  hoofd: boolean
  /**
   * De rekening waarvan deze bv betaalt (0065), met de naam en BIC die in het
   * SEPA-bestand komen als die van de opdrachtgever.
   *
   * Leeg is een geldige stand en geen fout: dan zegt het betaalscherm dat er
   * voor deze bv nog geen rekening staat. Wat er niet moest zijn, was dat je
   * hem nergens kon invullen.
   */
  eigenIban: string
  eigenNaam: string
  eigenBic: string
}

/**
 * Een administratie zoals het scherm hem nodig heeft.
 *
 * De drie rekeningvelden komen pas mee sinds de serverfunctie opnieuw is
 * uitgerold. Is dat nog niet gebeurd, dan stuurt hij ze niet, en dan zou
 * React een invoerveld zonder waarde krijgen -- dat wordt een ongecontroleerd
 * veld dat zich vreemd gedraagt zodra je erin typt, en dat is een lastiger
 * verhaal dan "er staat niets".
 *
 * Dus altijd een lege tekst. Wat er dan gebeurt is eerlijk: je typt een
 * rekeningnummer, de oude serverfunctie kent het veld niet, en het staat er na
 * het opslaan niet. Vervelend, maar zichtbaar.
 */
function alsAdministratie(r: Partial<ExactAdministratie>): ExactAdministratie {
  return {
    code: String(r.code ?? ''),
    naam: r.naam ?? '',
    actief: r.actief === true,
    hoofd: r.hoofd === true,
    eigenIban: r.eigenIban ?? '',
    eigenNaam: r.eigenNaam ?? '',
    eigenBic: r.eigenBic ?? '',
  }
}

export interface FacturenStand {
  administraties: ExactAdministratie[]
  aan: boolean
  dagboek: string
  btw: Record<string, string>
  wachtend: WachtendeFactuur[]
  /** Wat er nog moet gebeuren voordat er überhaupt iets kan. */
  ontbreekt: string[]
  verstuurd: number
  mislukt: number
  crediteuren: number
  laatstAt: number | null
  laatsteFout: string | null
}

function alsFacturen(uit: Partial<FacturenStand>): FacturenStand {
  return {
    administraties: (uit.administraties ?? []).map(alsAdministratie),
    aan: uit.aan === true,
    dagboek: uit.dagboek ?? '',
    btw: uit.btw ?? {},
    wachtend: uit.wachtend ?? [],
    ontbreekt: uit.ontbreekt ?? [],
    verstuurd: uit.verstuurd ?? 0,
    mislukt: uit.mislukt ?? 0,
    crediteuren: uit.crediteuren ?? 0,
    laatstAt: uit.laatstAt ?? null,
    laatsteFout: uit.laatsteFout ?? null,
  }
}

export async function exactFacturenStand(): Promise<FacturenStand> {
  return alsFacturen(await roepFunctie<FacturenStand>('exact', { actie: 'facturen-stand' }))
}

/**
 * De relaties uit Exact: crediteuren én klanten in één ronde.
 *
 * Heette sync-crediteuren tot 0063. Ze staan bij Exact in dezelfde lijst met
 * alleen een vlaggetje ertussen, en twee syncs op dezelfde resource is twee
 * keer hetzelfde verkeer en twee plekken waar dezelfde relatie kan
 * verschillen.
 */
export async function exactSyncRelaties(): Promise<
  FacturenStand & { aantal: number; gekoppeldLeveranciers: number; gekoppeldBedrijven: number }
> {
  const uit = await roepFunctie<FacturenStand & {
    aantal?: number; gekoppeldLeveranciers?: number; gekoppeldBedrijven?: number
  }>('exact', { actie: 'sync-relaties' })
  return {
    ...alsFacturen(uit),
    aantal: uit.aantal ?? 0,
    gekoppeldLeveranciers: uit.gekoppeldLeveranciers ?? 0,
    gekoppeldBedrijven: uit.gekoppeldBedrijven ?? 0,
  }
}

/** Nu versturen. Weigert zolang de schakelaar uit staat. */
export async function exactStuurFacturen(): Promise<
  FacturenStand & { gelukt: number; mislukt2: { id: string; reden: string }[] }
> {
  const uit = await roepFunctie<
    FacturenStand & { gelukt?: number; mislukt?: { id: string; reden: string }[] }
  >('exact', { actie: 'stuur-facturen' })
  return {
    ...alsFacturen(uit),
    gelukt: uit.gelukt ?? 0,
    mislukt2: Array.isArray(uit.mislukt) ? uit.mislukt : [],
  }
}

export async function exactKoppelLeverancier(
  zoeknaam: string, exactId: string | null, gezienAls: string,
): Promise<FacturenStand> {
  return alsFacturen(await roepFunctie<FacturenStand>(
    'exact', { actie: 'koppel-leverancier', zoeknaam, exactId, gezienAls }))
}

export interface ExactDagboek { code: string; naam: string; inkoop: boolean }
export interface ExactBtwCode { code: string; naam: string; pct: number | null }

export async function exactDagboeken(): Promise<ExactDagboek[]> {
  const uit = await roepFunctie<{ dagboeken?: ExactDagboek[] }>('exact', { actie: 'dagboeken' })
  return uit.dagboeken ?? []
}

export async function exactBtwCodes(): Promise<ExactBtwCode[]> {
  const uit = await roepFunctie<{ codes?: ExactBtwCode[] }>('exact', { actie: 'btw-codes' })
  return uit.codes ?? []
}


/* ------------------------------------------------------------------ *
 *  De administraties
 *
 *  Meerdere bv's, elk met een eigen grootboek (0059). Nieuwe komen binnen
 *  als NIET actief -- er kunnen bv's tussen zitten waar wij niets mee doen.
 * ------------------------------------------------------------------ */

/**
 * Wat het ophalen deed, niet alleen wat het opleverde.
 *
 * `hersteld` en `uitgezet` gaan over het geval dat er van Exact-account is
 * gewisseld: dan wijzen het opgeslagen administratienummer en een deel van de
 * lijst nog naar het oude. Het ophalen zet dat recht, en dat hoort het scherm
 * te zeggen -- anders verandert er stilletjes iets aan waar de boekingen heen
 * gaan, en dat is precies het soort wijziging waarvan je later wilt weten dat
 * hij is gebeurd.
 */
export interface AdministratieRonde {
  administraties: ExactAdministratie[]
  /** Het nummer van de koppeling hoorde niet bij dit account en is vervangen. */
  hersteld: { van: string; naar: string } | null
  /** Administraties die uit stonden gezet omdat ze bij een ander account horen. */
  uitgezet: string[]
}

export async function exactSyncAdministraties(): Promise<AdministratieRonde> {
  const uit = await roepFunctie<Partial<AdministratieRonde>>(
    'exact', { actie: 'sync-administraties' })
  return {
    administraties: (uit.administraties ?? []).map(alsAdministratie),
    hersteld: uit.hersteld ?? null,
    uitgezet: uit.uitgezet ?? [],
  }
}

export async function exactZetAdministratie(
  code: string,
  velden: {
    actief?: boolean
    hoofd?: boolean
    eigenIban?: string
    eigenNaam?: string
    eigenBic?: string
  },
): Promise<ExactAdministratie[]> {
  const uit = await roepFunctie<{ administraties?: ExactAdministratie[] }>(
    'exact', { actie: 'zet-administratie', code, ...velden })
  return (uit.administraties ?? []).map(alsAdministratie)
}


/* ------------------------------------------------------------------ *
 *  Onze bedrijven naast de relaties van Exact
 *
 *  public.companies is geen kopie van Exact -- er hangen wasbeurten aan,
 *  klantenportalen en profielen. Dus een kopie ernaast en een koppeling
 *  ertussen, per administratie: dezelfde klant heeft in elke bv een eigen
 *  relatienummer.
 * ------------------------------------------------------------------ */

export interface BedrijfKoppeling {
  division: string
  exactId: string
  naam: string
  bron: string
}

export interface BedrijfRegel {
  id: string
  naam: string
  plaats: string
  koppelingen: BedrijfKoppeling[]
}

export interface ExactKlant {
  exactId: string
  division: string
  code: string | null
  naam: string
  plaats: string | null
  email: string | null
  gekoppeld: boolean
}

export interface RelatiesStand {
  bedrijven: BedrijfRegel[]
  klanten: ExactKlant[]
  zonderKoppeling: number
  alleenInExact: number
  laatstAt: number | null
  laatsteFout: string | null
}

function alsRelaties(uit: Partial<RelatiesStand>): RelatiesStand {
  return {
    bedrijven: uit.bedrijven ?? [],
    klanten: uit.klanten ?? [],
    zonderKoppeling: uit.zonderKoppeling ?? 0,
    alleenInExact: uit.alleenInExact ?? 0,
    laatstAt: uit.laatstAt ?? null,
    laatsteFout: uit.laatsteFout ?? null,
  }
}

export async function exactRelatiesStand(): Promise<RelatiesStand> {
  return alsRelaties(await roepFunctie<RelatiesStand>('exact', { actie: 'relaties-stand' }))
}

/** Met de hand koppelen. exactId null = de koppeling weghalen. */
export async function exactKoppelBedrijf(
  companyId: string, division: string, exactId: string | null,
): Promise<RelatiesStand> {
  return alsRelaties(await roepFunctie<RelatiesStand>(
    'exact', { actie: 'koppel-bedrijf', companyId, division, exactId }))
}


/* ------------------------------------------------------------------ *
 *  Verkoopfacturen
 *
 *  De andere kant van de factuurstroom (0064). Bij Exact het spiegelbeeld:
 *  salesentry/SalesEntries, met de klant in plaats van de leverancier en een
 *  eigen verkoopdagboek.
 * ------------------------------------------------------------------ */

export interface VerkoopFactuurRegel {
  id: string
  nummer: string | null
  klant: string
  companyId: string
  administratie: string | null
  periode: string | null
  datum: number
  /** Wanneer hij betaald moet zijn, epoch ms. */
  vervaldatum: number | null
  verstuurdAt: number | null
  /** Gevuld = binnen. Leeg en over de vervaldatum = te laat. */
  betaaldAt: number | null
  bedragExcl: number
  bedragIncl: number
  status: 'concept' | 'verstuurd' | 'betaald' | 'vervallen'
  exactId: string | null
  fout: string | null
  /** Zonder gekoppelde relatie kan hij niet naar Exact. */
  heeftRelatie: boolean
}

export interface VerkoopStand {
  facturen: VerkoopFactuurRegel[]
  verkoopdagboek: string
  /**
   * Staat het boeken naar Exact aan (0058)?
   *
   * Het scherm heeft dit nodig om een stapel bij "Boeken" te kunnen verklaren.
   * Staat de schakelaar uit, dan groeit dat vakje elke maand en is er niets
   * mis -- maar zonder die zin ziet het eruit als een achterstand.
   *
   * null betekent: de serverfunctie is nog niet uitgerold en zegt er niets
   * over. Dat is met opzet iets anders dan false. Zou het op false vallen,
   * dan beweert het scherm dat boeken uit staat terwijl het aan kan zijn --
   * en dan gaat iemand een schakelaar omzetten die al goed stond.
   */
  boekenAan: boolean | null
  concepten: number
  verstuurd: number
  naarExact: number
  laatstAt: number | null
  laatsteFout: string | null
}

function alsVerkoop(uit: Partial<VerkoopStand>): VerkoopStand {
  return {
    facturen: uit.facturen ?? [],
    verkoopdagboek: uit.verkoopdagboek ?? '',
    /* Niet `=== true`: dan wordt onbekend stilletjes false, en dat is
       precies het verschil dat dit veld moet maken. */
    boekenAan: typeof uit.boekenAan === 'boolean' ? uit.boekenAan : null,
    concepten: uit.concepten ?? 0,
    verstuurd: uit.verstuurd ?? 0,
    naarExact: uit.naarExact ?? 0,
    laatstAt: uit.laatstAt ?? null,
    laatsteFout: uit.laatsteFout ?? null,
  }
}

export async function exactVerkoopStand(): Promise<VerkoopStand> {
  return alsVerkoop(await roepFunctie<VerkoopStand>('exact', { actie: 'verkoop-stand' }))
}

/** Concepten opmaken uit de gereedgemelde wasbeurten van een maand. */
export async function exactVerkoopOpmaken(
  periode: string,
): Promise<VerkoopStand & { gemaakt: number }> {
  const uit = await roepFunctie<VerkoopStand & { gemaakt?: number }>(
    'exact', { actie: 'verkoop-opmaken', periode })
  return { ...alsVerkoop(uit), gemaakt: uit.gemaakt ?? 0 }
}

/** Een concept een nummer geven en op verstuurd zetten. Daarna liggen de regels vast. */
export async function exactVerkoopVersturen(
  factuurId: string,
): Promise<VerkoopStand & { nummer: string }> {
  const uit = await roepFunctie<VerkoopStand & { nummer?: string }>(
    'exact', { actie: 'verkoop-versturen', factuurId })
  return { ...alsVerkoop(uit), nummer: uit.nummer ?? '' }
}

export async function exactStuurVerkoop(): Promise<
  VerkoopStand & { gelukt: number; mislukt2: { id: string; reden: string }[] }
> {
  const uit = await roepFunctie<
    VerkoopStand & { gelukt?: number; mislukt?: { id: string; reden: string }[] }
  >('exact', { actie: 'stuur-verkoop' })
  return {
    ...alsVerkoop(uit),
    gelukt: uit.gelukt ?? 0,
    mislukt2: Array.isArray(uit.mislukt) ? uit.mislukt : [],
  }
}


/* ------------------------------------------------------------------ *
 *  Betalen en SEPA
 *
 *  Het bestand maken en het betaald zetten zijn met opzet twee handelingen.
 *  Een bestand maken is niet hetzelfde als geld overmaken.
 * ------------------------------------------------------------------ */

export interface OpenstaandeFactuur {
  id: string
  leverancier: string
  factuurnummer: string | null
  bedragIncl: number
  /** Zoals de lezer hem van de factuur haalde. Leeg = niets over te maken. */
  iban: string
  administratie: string | null
  datum: number
  vervaldatum: number | null
}

export interface BetaalBatch {
  id: string
  administratie: string | null
  bestandsnaam: string
  aantal: number
  totaal: number
  status: 'concept' | 'uitgevoerd' | 'ingetrokken'
  aangemaaktAt: number
  uitgevoerdAt: number | null
  door: string | null
}

export interface BetaalAdministratie {
  code: string
  naam: string
  eigenIban: string
  eigenNaam: string
  eigenBic: string
}

export interface BetaalStand {
  openstaand: OpenstaandeFactuur[]
  zonderIban: number
  totaalOpen: number
  batches: BetaalBatch[]
  administraties: BetaalAdministratie[]
}

function alsBetaal(uit: Partial<BetaalStand>): BetaalStand {
  return {
    openstaand: uit.openstaand ?? [],
    zonderIban: uit.zonderIban ?? 0,
    totaalOpen: uit.totaalOpen ?? 0,
    batches: uit.batches ?? [],
    administraties: uit.administraties ?? [],
  }
}

export async function exactBetaalStand(): Promise<BetaalStand> {
  return alsBetaal(await roepFunctie<BetaalStand>('exact', { actie: 'betaal-stand' }))
}

export interface SepaUitkomst extends BetaalStand {
  batchId: string
  bestandsnaam: string
  xml: string
  aantal: number
  totaal: number
  /** Wat er niet in kon, met de reden erbij. */
  overgeslagen: { id: string; naam: string; reden: string }[]
}

export async function exactSepaMaken(
  administratie: string, ids?: string[],
): Promise<SepaUitkomst> {
  const uit = await roepFunctie<SepaUitkomst>(
    'exact', { actie: 'sepa-maken', administratie, ...(ids?.length ? { ids } : {}) })
  return {
    ...alsBetaal(uit),
    batchId: uit.batchId ?? '',
    bestandsnaam: uit.bestandsnaam ?? 'betaling.xml',
    xml: uit.xml ?? '',
    aantal: uit.aantal ?? 0,
    totaal: uit.totaal ?? 0,
    overgeslagen: uit.overgeslagen ?? [],
  }
}

/** Pas hier gaan de facturen op betaald: het bestand is dan echt gedraaid. */
export async function exactBatchUitvoeren(
  batchId: string,
): Promise<BetaalStand & { betaald: number }> {
  const uit = await roepFunctie<BetaalStand & { betaald?: number }>(
    'exact', { actie: 'batch-uitvoeren', batchId })
  return { ...alsBetaal(uit), betaald: uit.betaald ?? 0 }
}

export async function exactZetBetaald(
  wat: { expenseId?: string; verkoopId?: string; terug?: boolean },
): Promise<void> {
  await roepFunctie<{ ok: boolean }>('exact', { actie: 'zet-betaald', ...wat })
}
