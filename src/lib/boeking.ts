/* ------------------------------------------------------------------ *
 *  De boeking van een kostenpost
 *
 *  Twee dingen die uit elkaar gehouden moeten worden:
 *
 *    de indeling   welke grootboekrekening en welke tags
 *    het geheugen  hoe deze leverancier voortaan geboekt moet worden
 *
 *  Het tweede is waar het om draait. Raden op trefwoorden werkt precies één
 *  keer; daarna weet je iets veel beters, namelijk hoe iemand die ernaar keek
 *  het de vorige keer boekte. Elke goedkeuring is zo'n moment, en die gaat
 *  hier het geheugen in.
 *
 *  Waarom pas bij goedkeuren en niet meteen bij het indelen: wat de post
 *  automatisch invult is een gok tot een mens ernaar heeft gekeken. Zou een
 *  gok het geheugen in gaan, dan bevestigt het systeem voortaan zijn eigen
 *  vergissingen -- en dan is het geen geheugen meer maar een echo.
 * ------------------------------------------------------------------ */

import { db } from './db'
import { enqueue } from './sync'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import type { ExactGrootboek, Expense, Grootboek } from './types'

/** Waar de indeling vandaan komt, in gewone taal. */
export const BRON_TEKST: Record<NonNullable<Expense['indelingBron']>, string> = {
  geheugen: 'Zo is deze leverancier eerder geboekt',
  geraden: 'Geraden op trefwoorden — kijk dit na',
  handmatig: 'Met de hand ingesteld',
}

/** En hetzelfde voor de vennootschap waarop geboekt wordt (0079). */
export const BV_BRON_TEKST: Record<NonNullable<Expense['administratieBron']>, string> = {
  gelezen: 'Van de factuur gelezen — de naam of het KvK-nummer klopte',
  adres: 'Het inkoopadres waarop de factuur binnenkwam',
  vermoeden: 'Geraden op de naam — kijk dit na',
  vestiging: 'Afgeleid uit de vestiging van deze bon',
  handmatig: 'Met de hand ingesteld',
}

/**
 * Handmatig de vennootschap zetten.
 *
 * Zet de bron op handmatig, en dat is de hele reden dat deze functie bestaat:
 * de lezer werkt de bv bij elke nieuwe lezing bij, maar laat met rust wat een
 * mens heeft gezet (zie verwerking.ts). Zonder deze functie is die afspraak
 * eenzijdig -- de database respecteert 'handmatig' en er is geen manier om
 * het te worden.
 *
 * Leeg zetten mag ook: dan volgt de bon weer zijn vestiging, zoals het tot
 * 0079 altijd ging.
 */
export async function zetOnderneming(bon: Expense, code: string): Promise<Expense> {
  const nieuw: Expense = {
    ...bon,
    administratie: code || undefined,
    administratieBron: code ? 'handmatig' : undefined,
    updatedAt: Date.now(),
  }
  await db.expenses.put(nieuw)
  await enqueue('expenses', 'put', nieuw.id, nieuw)
  return nieuw
}

/**
 * Handmatig een rekening en tags zetten.
 *
 * Zet de bron op handmatig, en dat is niet cosmetisch: bij het goedkeuren
 * leert het geheugen hiervan, en het scherm laat de waarschuwing "geraden"
 * vallen zodra er iemand naar gekeken heeft.
 */
export async function zetBoeking(
  bon: Expense,
  wijziging: { grootboekCode?: string; tags?: string[] },
): Promise<Expense> {
  const nieuw: Expense = {
    ...bon,
    grootboekCode: wijziging.grootboekCode ?? bon.grootboekCode,
    tags: wijziging.tags ?? bon.tags ?? [],
    indelingBron: 'handmatig',
    updatedAt: Date.now(),
  }
  await db.expenses.put(nieuw)
  await enqueue('expenses', 'put', nieuw.id, nieuw)
  return nieuw
}

/**
 * De elfproef op een rekeningnummer.
 *
 * Dezelfde berekening als in de database (0094) en in de verzendlus
 * (_gedeeld/sepa.ts): de eerste vier tekens naar achteren, letters naar
 * cijfers, en de rest moet 1 zijn modulo 97.
 *
 * Hier staat hij om het te kunnen ZEGGEN terwijl iemand typt. Het echte slot
 * zit op de andere twee plekken -- een bank weigert een heel bestand om één
 * fout nummer, en dat mag niet van een schermcontrole afhangen.
 */
export function ibanKlopt(ruw: string): boolean {
  const schoon = (ruw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (schoon.length < 15 || schoon.length > 34) return false
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(schoon)) return false

  const her = (schoon.slice(4) + schoon.slice(0, 4))
    .replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))

  /* Cijfer voor cijfer: een IBAN wordt tot 30 cijfers lang, en dat past in
     geen enkel getal dat JavaScript nauwkeurig kan bewaren. */
  let rest = 0
  for (const d of her) rest = (rest * 10 + Number(d)) % 97
  return rest === 1
}

/** Waarop deze bon betaald wordt: de correctie, anders wat er gelezen is. */
export function betaalRekening(bon: Expense): string {
  return (bon.betaalIban || bon.gelezen?.iban || '').replace(/\s+/g, '').toUpperCase()
}

/**
 * Het rekeningnummer rechtzetten.
 *
 * Apart van zetBoeking(), want het is iets anders: dat gaat over waar de kosten
 * terechtkomen, dit over waar het geld heen gaat. Leeg maken kan en betekent
 * "toch maar wat er gelezen is".
 */
export async function zetBetaalRekening(bon: Expense, ruw: string): Promise<Expense> {
  const schoon = (ruw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const nieuw: Expense = {
    ...bon,
    betaalIban: schoon || undefined,
    updatedAt: Date.now(),
  }
  await db.expenses.put(nieuw)
  await enqueue('expenses', 'put', nieuw.id, nieuw)
  return nieuw
}

/**
 * Onthouden hoe deze leverancier geboekt is.
 *
 * Gaat rechtstreeks naar de database en niet via de wachtrij, want dit is
 * geen rij die van ons is -- het is een teller die opgehoogd wordt, en twee
 * apparaten die hem allebei bijwerken moeten optellen en niet overschrijven.
 * Dat kan alleen aan de serverkant.
 *
 * Lukt het niet, dan is dat geen fout die het goedkeuren mag tegenhouden. De
 * kostenpost is goedgekeurd; het geheugen leert dan de volgende keer bij.
 */
export async function onthoudBoeking(bon: Expense): Promise<void> {
  if (!bon.supplier?.trim() || !bon.grootboekCode) return
  if (!supabaseConfigured) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  try {
    const { error } = await supabase().rpc('boeking_onthouden', {
      leverancier_in: bon.supplier.trim(),
      grootboek_in: bon.grootboekCode,
      tags_in: bon.tags ?? [],
    })
    if (error) console.warn('[boeking] onthouden mislukte: ' + error.message)
  } catch (e) {
    console.warn('[boeking] onthouden mislukte: ' + String(e))
  }
}

/* ------------------------------------------------------------------ *
 *  In welke bv valt deze bon, en welke rekeningen horen daarbij
 *
 *  Casper: "als ik bij boeking een andere onderneming pak, moet je die
 *  grootboekrekeningen laten zien.... want anders blijf ik bezig"
 *
 *  Terecht. Sinds 0086 staat het rekeningschema per bv in de database, maar
 *  het scherm toonde ze allemaal door elkaar -- 4040 van de ene administratie
 *  naast 4040 van de andere, zonder onderscheid. Wie er een koos die in zijn
 *  bv niet bestaat, kreeg dat pas bij het boeken te horen.
 * ------------------------------------------------------------------ */

/**
 * Welke bv is dit?
 *
 * Dezelfde volgorde als bon_administratie() in de database (0079): wat op de
 * bon staat, anders die van zijn vestiging, anders de hoofdadministratie.
 * Twee plekken die hetzelfde moeten zeggen -- vandaar dat die volgorde hier
 * woordelijk staat en niet "ongeveer zo".
 */
export function bvVanBon(
  bon: Expense,
  vestigingen: { id: string; administratie?: string }[],
  bedrijven: { code: string; hoofd?: boolean }[],
): string | undefined {
  const opDeBon = (bon.administratie ?? '').trim()
  if (opDeBon) return opDeBon

  const vest = vestigingen.find((l) => l.id === bon.locationId)
  const viaVestiging = (vest?.administratie ?? '').trim()
  if (viaVestiging) return viaVestiging

  return bedrijven.find((b) => b.hoofd)?.code
}

/**
 * De rekeningen die in DEZE bv te kiezen zijn.
 *
 * Het schema is van Exact, de trefwoorden zijn van ons
 * ----------------------------------------------------
 *
 * Hier stond rekeningenVoor(), die de lijst uit onze eigen kopie haalde en
 * daar op administratie in filterde. Dat kon niet werken, om een reden die
 * pas zichtbaar wordt als je de app ernaast legt: in IndexedDB staat
 * grootboek op CODE. Eén rij per code, ongeacht bv -- wie twintig bv's
 * ophaalt houdt lokaal de laatste over. Het veld administratie waarop hier
 * werd gefilterd, was dus de bv die toevallig als laatste binnenkwam.
 *
 * Sinds 0104 staat het schema van Exact zelf in de app (exactGrootboek, op
 * division::code). Dat is de lijst waar het boeken ook op leunt: bij het
 * versturen wordt de guid opgezocht in exact_grootboek, niet bij ons.
 *
 * Wat van ons blijft, is wat van ons is: de naam als iemand er een heeft
 * bedacht, de trefwoorden, de btw en de categorie. Die horen bij een code en
 * niet bij een bv -- daarom zoekt dit op code.
 */
export function rekeningenVan(
  schema: ExactGrootboek[],
  onze: Grootboek[],
  bv?: string,
  huidige?: string,
): Grootboek[] {
  const eigen = new Map(onze.map((g) => [g.code, g]))

  /*
   * Geen schema binnen? Dan onze eigen lijst, zoals het was.
   *
   * Dat gebeurt bij een installatie zonder Exact-koppeling, en bij wie het
   * scherm opent voordat de eerste synchronisatie klaar is. Een lege
   * keuzelijst zou daar zeggen "er is geen enkele rekening", en dat is iets
   * anders dan "ik weet het nog niet".
   */
  if (schema.length === 0) {
    return [...onze]
      .filter((g) => g.actief || g.code === huidige)
      .sort((a, b) => a.code.localeCompare(b.code))
  }

  const uit = new Map<string, Grootboek>()

  for (const e of schema) {
    if (bv && e.division !== bv) continue

    /* De rekening die er NU op staat blijft kiesbaar, ook als hij geblokkeerd
       is. Anders springt een bestaande boeking bij het openen naar leeg en
       verander je hem door alleen te kijken. */
    if (e.geblokkeerd && e.code !== huidige) continue

    /* Zonder bv kan dezelfde code in meer administraties staan; dan is de
       eerste goed genoeg -- het gaat dan om de naam, niet om de bv. */
    if (uit.has(e.code)) continue

    const vanOns = eigen.get(e.code)

    uit.set(e.code, {
      id: e.id,
      code: e.code,
      naam: vanOns?.naam?.trim() || e.omschrijving.trim() || e.code,
      trefwoorden: vanOns?.trefwoorden ?? [],
      categorie: vanOns?.categorie ?? e.soort,
      btwPct: vanOns?.btwPct,
      administratie: e.division,
      actief: !e.geblokkeerd,
      updatedAt: e.updatedAt,
    })
  }

  /*
   * En de rekening die er nu op staat, ook als Exact hem niet (meer) kent.
   * Een oude boeking op een opgeheven rekening hoort leesbaar te blijven.
   */
  if (huidige && !uit.has(huidige)) {
    const vanOns = eigen.get(huidige)
    if (vanOns) uit.set(huidige, vanOns)
  }

  return [...uit.values()].sort((a, b) => a.code.localeCompare(b.code))
}

/**
 * De naam bij een rekeningnummer.
 *
 * "4031" zegt niemand iets; "Contributies en heffingen" wel. Staat de
 * rekening niet in de lijst, dan de code zelf -- dat gebeurt bij een oude
 * boeking op een rekening die later is weggehaald, en dan is het nummer
 * tonen beter dan een leeg vakje.
 */
export function rekeningNaam(
  code: string | undefined,
  lijst: Grootboek[],
  schema: ExactGrootboek[] = [],
): string {
  if (!code) return ''
  const gevonden = lijst.find((g) => g.code === code)
  if (gevonden) return `${gevonden.code} · ${gevonden.naam}`

  /*
   * En anders in het schema van Exact. Sinds 0104 bewaren we van een rekening
   * waar wij niets over te zeggen hebben geen eigen kopie meer; zonder deze
   * regel zou een boeking op zo'n rekening het nummer tonen zonder naam, en
   * dat is precies wat deze functie moest voorkomen.
   */
  const uitExact = schema.find((e) => e.code === code)
  return uitExact
    ? `${uitExact.code} · ${uitExact.omschrijving || uitExact.code}`
    : code
}

/**
 * Is er reden om hier nog eens naar te kijken?
 *
 * Alleen bij een gok. Wat uit het geheugen komt of met de hand is gezet heeft
 * al iemands oordeel gehad, en een waarschuwing die overal staat leest
 * niemand meer.
 */
export function vraagtAandacht(bon: Expense): boolean {
  return bon.indelingBron === 'geraden' || (!bon.grootboekCode && bon.source === 'mail')
}
