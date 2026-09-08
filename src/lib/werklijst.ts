import type { Expense } from './types'

/* ------------------------------------------------------------------ *
 *  Wat er nog moet gebeuren met een binnengekomen factuur
 *
 *  Casper vroeg om een aparte werklijst met statussen: "wat is er binnen,
 *  wat is er gelezen, wat is er gecontroleerd, wat is er geboekt, en wat is
 *  er vastgelopen."
 *
 *  Er komt geen nieuwe tabel aan te pas. Alles wat daarvoor nodig is staat al
 *  op de kostenpost: lees_status (0049), status, exact_id en exact_fout
 *  (0053), de eerste handtekening (0060). Wat ontbrak was niet gegevens maar
 *  een antwoord op de vraag "en wat nu?" -- en die vraag stond nergens in een
 *  functie, dus stond hij in het hoofd van degene die de lijst doorliep.
 *
 *  Hier staat hij wel, als pure functie, zodat de zelftest hem kan narekenen
 *  en het scherm hem niet nog eens hoeft uit te schrijven.
 * ------------------------------------------------------------------ */

/**
 * De standen, in de volgorde waarin ze langskomen.
 *
 * Ze sluiten elkaar uit: een bon heeft er precies een. Dat is met opzet --
 * een bon die in twee kolommen staat is een bon die twee mensen oppakken of
 * geen van beiden.
 */
export type Verwerkstand =
  | 'lezen'
  | 'vastgelopen'
  | 'aanvullen'
  | 'akkoord'
  | 'tweede'
  | 'boeken'
  | 'geweigerd'
  | 'klaar'
  | 'afgekeurd'

export interface Standinfo {
  sleutel: Verwerkstand
  label: string
  /** Een zin die zegt wat er van jou wordt verwacht, niet wat de stand heet. */
  uitleg: string
  /** Ligt het werk hier bij ons, of wachten we op iets anders. */
  actie: boolean
  /** Hier is iets misgegaan; die krijgen voorrang. */
  stuk?: boolean
  /** Hier is niets meer te doen; blijft buiten de werklijst. */
  afgerond?: boolean
}

export const STANDEN: Record<Verwerkstand, Standinfo> = {
  vastgelopen: {
    sleutel: 'vastgelopen',
    label: 'Vastgelopen',
    uitleg: 'Het lezen is niet gelukt. Probeer het opnieuw of vul het met de hand in.',
    actie: true,
    stuk: true,
  },
  geweigerd: {
    sleutel: 'geweigerd',
    label: 'Exact weigert',
    uitleg: 'De boeking is door Exact teruggestuurd. Er staat bij waarom.',
    actie: true,
    stuk: true,
  },
  lezen: {
    sleutel: 'lezen',
    label: 'Wordt gelezen',
    uitleg: 'De factuur staat in de wachtrij bij de lezer. Hier hoef je niets te doen.',
    actie: false,
  },
  aanvullen: {
    sleutel: 'aanvullen',
    label: 'Aanvullen',
    uitleg: 'Er is gelezen, maar er ontbreekt iets waar je niet op kunt tekenen.',
    actie: true,
  },
  akkoord: {
    sleutel: 'akkoord',
    label: 'Wacht op akkoord',
    uitleg: 'Compleet. Iemand moet er ja of nee op zeggen.',
    actie: true,
  },
  tweede: {
    sleutel: 'tweede',
    label: 'Tweede handtekening',
    uitleg: 'De eerste staat er. De tweede moet iemand anders zijn.',
    actie: true,
  },
  boeken: {
    sleutel: 'boeken',
    label: 'Naar Exact',
    uitleg: 'Goedgekeurd en klaar om geboekt te worden.',
    actie: true,
  },
  klaar: {
    sleutel: 'klaar',
    label: 'Geboekt',
    uitleg: 'Staat in Exact. Hier is niets meer te doen.',
    actie: false,
    afgerond: true,
  },
  afgekeurd: {
    sleutel: 'afgekeurd',
    label: 'Afgekeurd',
    uitleg: 'Iemand heeft deze afgewezen.',
    actie: false,
    afgerond: true,
  },
}

/**
 * Hoe lang een lezing mag duren voor we hem als vastgelopen beschouwen.
 *
 * Tien minuten, dezelfde grens als de serverkant hanteert voor lees_geclaimd_at.
 * Zonder deze grens blijft een bon waarvan de leescomputer halverwege uitviel
 * eeuwig op 'bezig' staan -- zichtbaar in geen enkele lijst, want technisch is
 * er iemand mee bezig.
 */
export const LEZEN_DUURT_HOOGSTENS = 10 * 60 * 1000

/**
 * In welke stand staat deze bon?
 *
 * De volgorde van de vragen is de hele functie. Eerst wat kapot is, dan wat
 * af is, dan wat er nog moet gebeuren -- want een bon die goedgekeurd is en
 * waarvan Exact een fout teruggaf, hoort bij "er is iets mis" en niet bij
 * "moet nog geboekt worden".
 */
export function standVan(bon: Expense, nu: number = Date.now()): Verwerkstand {
  if (bon.status === 'afgekeurd') return 'afgekeurd'

  /* Exact eerst: een fout hier is de enige stand waar niemand vanzelf
     uitkomt. Blijft hij tussen 'goedgekeurd' hangen, dan ziet het eruit als
     werk dat nog moet gebeuren terwijl het al drie keer is geprobeerd. */
  if (bon.exactFout) return 'geweigerd'
  if (bon.exactId) return 'klaar'

  if (bon.status === 'goedgekeurd') return 'boeken'
  if (bon.status === 'eerste_akkoord') return 'tweede'

  /* Het lezen. 'mislukt' is duidelijk; 'bezig' dat te lang duurt is dat niet,
     en juist daar blijft werk liggen. */
  if (bon.leesStatus === 'mislukt') return 'vastgelopen'
  if (bon.leesStatus === 'bezig'
      && bon.leesGeclaimdAt != null
      && nu - bon.leesGeclaimdAt > LEZEN_DUURT_HOOGSTENS) {
    return 'vastgelopen'
  }
  if (bon.leesStatus === 'wacht' || bon.leesStatus === 'bezig') return 'lezen'

  return ontbreekt(bon).length > 0 ? 'aanvullen' : 'akkoord'
}

/**
 * Wat er aan deze bon ontbreekt om er ja op te kunnen zeggen.
 *
 * Leesbare zinnen en geen veldnamen: dit komt op het scherm te staan naast de
 * bon, en "amountExcl" zegt de administratie niets.
 *
 * De twijfel van de lezer telt mee. Casper: "Ga niet zomaar gokken." Een
 * model dat zelf zegt dat het ergens niet uit kwam, hoort niet stil in de rij
 * "wacht op akkoord" te belanden alsof er niets aan de hand is.
 */
export function ontbreekt(bon: Expense): string[] {
  const uit: string[] = []

  if (!(bon.amountExcl > 0)) uit.push('Er staat geen bedrag op.')
  if (!bon.supplier.trim()) uit.push('De leverancier is niet ingevuld.')
  if (!bon.date) uit.push('De factuurdatum ontbreekt.')

  const lezing = bon.gelezen
  if (lezing) {
    for (const zin of lezing.twijfel ?? []) uit.push(zin)
    /*
     * Een verkoopfactuur tussen de inkoop is geen ontbrekend veld maar wel
     * iets waar niemand blind ja op moet zeggen: dan boek je je eigen omzet
     * als kosten.
     */
    if (lezing.richting === 'verkoop') {
      uit.push('Dit lijkt een factuur van onszelf, geen inkoopfactuur.')
    }
    if (lezing.gemarkeerd) {
      uit.push(`De bijlage is tegengehouden in de postbus: ${lezing.gemarkeerd}`)
    }
  }

  return uit
}

/** Is er iets om opnieuw te laten lezen? Zonder bijlage valt er niets te lezen. */
export function isTeLezen(bon: Expense): boolean {
  return !!bon.attachmentPath || !!bon.mailboxId
}

export interface Vak {
  stand: Standinfo
  bonnen: Expense[]
}

/**
 * De bonnen over de vakken verdelen, in de volgorde waarin je ze wil zien.
 *
 * Kapot bovenaan, dan wat op jou wacht, dan wat vanzelf verdergaat. Wat af is
 * doet niet mee: een werklijst waar het afgeronde werk in blijft staan, wordt
 * elke maand langer en elke maand minder gelezen.
 */
export const VOLGORDE: Verwerkstand[] = [
  'vastgelopen', 'geweigerd', 'aanvullen', 'akkoord', 'tweede', 'boeken', 'lezen',
]

export function verdeel(bonnen: Expense[], nu: number = Date.now()): Vak[] {
  const per = new Map<Verwerkstand, Expense[]>()
  for (const bon of bonnen) {
    const stand = standVan(bon, nu)
    if (STANDEN[stand].afgerond) continue
    const rij = per.get(stand)
    if (rij) rij.push(bon)
    else per.set(stand, [bon])
  }

  return VOLGORDE
    .filter((s) => (per.get(s)?.length ?? 0) > 0)
    .map((s) => ({
      stand: STANDEN[s],
      /* Oudste bovenaan: wat het langst ligt, ligt er niet voor niets. */
      bonnen: (per.get(s) ?? []).sort((a, b) => a.date - b.date),
    }))
}

/** Hoeveel bonnen er op iemand wachten. Dat is het getal voor de badge. */
export function telWerk(bonnen: Expense[], nu: number = Date.now()): number {
  return bonnen.filter((b) => STANDEN[standVan(b, nu)].actie).length
}

/** En hoeveel daarvan stuk zijn. Die krijgen een andere kleur. */
export function telStuk(bonnen: Expense[], nu: number = Date.now()): number {
  return bonnen.filter((b) => STANDEN[standVan(b, nu)].stuk).length
}
