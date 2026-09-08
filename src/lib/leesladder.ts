import { magOpenen } from './postbus'
import type { Expense, MailBijlage } from './types'
import type { Leesuitkomst } from './facturen'

/* ------------------------------------------------------------------ *
 *  Niet meteen opgeven
 *
 *  Casper: "Als je een bestand niet goed kunt lezen: geef niet meteen op.
 *  Probeer opnieuw of gebruik een andere aanpak. Ga niet zomaar gokken."
 *
 *  Die twee zinnen zijn samen de opdracht, en de tweede is de moeilijkste.
 *  Doorproberen is makkelijk; doorproberen zonder dat er uiteindelijk een
 *  verzonnen bedrag in een veld belandt, is het punt.
 *
 *  Wat er misging
 *  --------------
 *
 *  Een mail met een factuur heeft zelden precies een bijlage. Er zit een
 *  logo in de handtekening, een PDF met algemene voorwaarden, soms een
 *  begeleidend briefje. De server pakt er een, en als dat de verkeerde is
 *  komt er "niet gelukt" terug -- terwijl de factuur gewoon in dezelfde mail
 *  zat. Wie dan op Opnieuw drukte, kreeg precies dezelfde poging nog een
 *  keer.
 *
 *  Wat het nu doet
 *  ---------------
 *
 *  Eerst wat de server zelf kiest. Lukt dat niet, dan de andere bijlagen,
 *  op volgorde van hoe waarschijnlijk het een factuur is: PDF's voor
 *  plaatjes, en binnen elke soort het grootste bestand eerst -- een logo van
 *  vier kilobyte is geen factuur.
 *
 *  Wat het NIET doet
 *  -----------------
 *
 *  Iets invullen. Elke poging geeft of een echte lezing of niets, en als
 *  alles is geprobeerd komt er een lijstje met wat er is gedaan en wat elke
 *  poging zei. Dat lijstje gaat naar het scherm. Een mens beslist dan of hij
 *  het met de hand invult -- en dat staat er dan ook als handmatig bij.
 * ------------------------------------------------------------------ */

export interface Poging {
  /** Wat er is geprobeerd, in een halve zin. */
  wat: string
  /** Het pad in de emmer; leeg bij de poging die de server zelf koos. */
  pad?: string
  gelukt: boolean
  reden?: string
}

export interface Ladderuitkomst {
  gelukt: boolean
  pogingen: Poging[]
  /** Een zin voor op het scherm, ook als het gelukt is. */
  samenvatting: string
}

/**
 * De bijlagen op volgorde van kansrijk naar minst kansrijk.
 *
 * Losstaand omdat de zelftest hem los narekent: als deze volgorde omdraait,
 * begint de ladder bij het logo en stopt hij bij de factuur.
 */
export function opVolgorde(bijlagen: MailBijlage[]): MailBijlage[] {
  const bruikbaar = bijlagen.filter((b) => magOpenen(b))

  const score = (b: MailBijlage) => {
    const mime = (b.mime || '').toLowerCase()
    const naam = (b.naam || '').toLowerCase()
    if (mime.includes('pdf') || naam.endsWith('.pdf')) return 0
    if (mime.startsWith('image/')) return 1
    return 2
  }

  return [...bruikbaar].sort((a, b) => {
    const verschil = score(a) - score(b)
    if (verschil !== 0) return verschil
    /* Binnen dezelfde soort het grootste eerst. Een factuur weegt meer dan
       een logo in de handtekening. */
    return (b.size ?? 0) - (a.size ?? 0)
  })
}

/**
 * De ladder aflopen.
 *
 * `lees` wordt meegegeven en niet geimporteerd, zodat de zelftest hem kan
 * narekenen zonder netwerk -- en zodat te controleren valt dat hij stopt
 * zodra er iets lukt, in plaats van alle bijlagen langs te gaan.
 */
export async function leesOpnieuw(
  bon: Expense,
  bijlagen: MailBijlage[],
  lees: (expenseId: string, pad?: string) => Promise<Leesuitkomst>,
): Promise<Ladderuitkomst> {
  const pogingen: Poging[] = []

  /* --- 1. wat de server zelf kiest --- */
  const eerste = await lees(bon.id)
  pogingen.push({
    wat: 'De bijlage die de post zelf koos',
    gelukt: eerste.ok,
    reden: eerste.ok ? undefined : (eerste.reden ?? 'Geen reden opgegeven.'),
  })
  if (eerste.ok) return klaar(pogingen)

  /* --- 2. de andere bijlagen, kansrijkste eerst --- */
  const rij = opVolgorde(bijlagen)
    /* De bijlage die al aan de bon hangt heeft de server net geprobeerd. */
    .filter((b) => b.path !== bon.attachmentPath)

  for (const b of rij) {
    const uit = await lees(bon.id, b.path)
    pogingen.push({
      wat: b.naam,
      pad: b.path,
      gelukt: uit.ok,
      reden: uit.ok ? undefined : (uit.reden ?? 'Geen reden opgegeven.'),
    })
    if (uit.ok) return klaar(pogingen)
  }

  return klaar(pogingen)
}

function klaar(pogingen: Poging[]): Ladderuitkomst {
  const gelukt = pogingen.some((p) => p.gelukt)
  return { gelukt, pogingen, samenvatting: samenvat(pogingen) }
}

/**
 * Wat er is geprobeerd, in een zin.
 *
 * Met opzet nuchter. "Er ging iets mis" helpt niemand; "vier bijlagen
 * geprobeerd, geen ervan is een leesbare factuur" vertelt je dat je hem met
 * de hand moet invullen en dat doorklikken geen zin heeft.
 */
export function samenvat(pogingen: Poging[]): string {
  const n = pogingen.length
  const gelukt = pogingen.find((p) => p.gelukt)

  if (gelukt) {
    return n === 1
      ? 'Gelezen.'
      : `Gelezen, na ${n} pogingen — het zat in ${gelukt.wat}.`
  }
  if (n === 1) {
    return `Niet gelukt: ${pogingen[0].reden ?? 'onbekende reden'}. Er waren geen andere bijlagen om te proberen.`
  }
  return `Alle ${n} bijlagen geprobeerd, geen ervan was te lezen als factuur. Vul hem met de hand in.`
}
