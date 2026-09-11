import type { Expense, MailBericht } from './types'
import { STANDEN, standVan, type Verwerkstand } from './werklijst'

/* ------------------------------------------------------------------ *
 *  De stroom: waar staat een factuur in het proces
 *
 *  Casper stuurde foto's van Blue10 mee: "je moet echt blue10 een beetje
 *  namaken met dat stuk". Dat stuk is de rij vakjes boven de lijst --
 *  Importeren, Splitsen, Valideren, Boeken, Goedkeuren, Betalen -- met een
 *  getal in elk vakje en een kruisje of uitroepteken erop als er iets aan de
 *  hand is.
 *
 *  Waarom dat werkt is niet de opmaak maar wat eronder zit: het proces is ÉÉN
 *  rij, van links naar rechts, en elk vakje is tegelijk een teller en een
 *  filter. Je ziet in één blik waar de stapel ligt, en je klikt erop om hem te
 *  openen. Dat is precies wat er hier ontbrak: de standen bestonden al
 *  (werklijst.ts), maar ze stonden als losse vakken onder elkaar en er was
 *  geen plek waar je het geheel zag.
 *
 *  Waar dit van Blue10 afwijkt, en waarom
 *  --------------------------------------
 *
 *  Niet klakkeloos zes vakjes namaken. Twee ervan zeggen bij ons iets anders:
 *
 *  1. SPLITSEN bestaat hier niet. Blue10 kan een PDF met vijf facturen erin
 *     uit elkaar trekken. Wij kunnen dat niet, en een vakje neerzetten dat
 *     altijd nul toont en waar niets achter zit, is erger dan het weglaten --
 *     dan lijkt het proces compleet terwijl er een stap ontbreekt. Als het
 *     gebouwd wordt komt het vakje erbij.
 *
 *  2. BOEKEN staat bij Blue10 vóór Goedkeuren, bij ons erna. Dat is geen
 *     slordigheid maar een ander proces: bij Blue10 is "boeken" het coderen
 *     van de factuurregels en gaat het daarna langs de tekenbevoegde. Bij ons
 *     codeert de lezer meteen bij binnenkomst (0044), tekenen twee mensen
 *     (0060), en gaat de boeking pas daarna naar Exact (0058). De volgorde
 *     hier is de volgorde die wij werkelijk hebben; hem omdraaien om op het
 *     plaatje te lijken zou een proces tekenen dat niet bestaat.
 *
 *  Wat er wél bij komt en bij Blue10 niet apart staat: BINNEN. Post die op
 *  het inkoopadres aankwam en waar geen kostenpost van is gemaakt -- een mail
 *  zonder bijlage, een bijlage die de controle tegenhield, een leverancier die
 *  zijn factuur in de tekst van de mail zet. Die berichten waren tot nu toe
 *  alleen in de postbus te vinden en in geen enkele teller. Dat is de stilste
 *  stapel die er is: niemand mist wat hij niet ziet.
 * ------------------------------------------------------------------ */

export type StapSleutel = 'binnen' | 'lezen' | 'aanvullen' | 'goedkeuren' | 'boeken' | 'betalen'

export interface Stap {
  sleutel: StapSleutel
  label: string
  /** Eén zin die zegt wat hier ligt, voor onder de teller en in een tooltip. */
  uitleg: string
  /**
   * Welke standen uit werklijst.ts in dit vakje vallen.
   *
   * Leeg bij 'binnen': die telt geen kostenposten maar post waar er nog geen
   * van is.
   */
  standen: Verwerkstand[]
}

export const STAPPEN: Stap[] = [
  {
    sleutel: 'binnen',
    label: 'Binnen',
    uitleg: 'Post op het inkoopadres waar nog geen factuur van is gemaakt.',
    standen: [],
  },
  {
    sleutel: 'lezen',
    label: 'Lezen',
    uitleg: 'Staat bij de lezer, of het lezen is vastgelopen.',
    standen: ['lezen', 'vastgelopen'],
  },
  {
    sleutel: 'aanvullen',
    label: 'Aanvullen',
    uitleg: 'Gelezen, maar er ontbreekt iets waar je niet op kunt tekenen.',
    standen: ['aanvullen'],
  },
  {
    sleutel: 'goedkeuren',
    label: 'Goedkeuren',
    uitleg: 'Compleet. Wacht op de eerste of de tweede handtekening.',
    standen: ['akkoord', 'tweede'],
  },
  {
    sleutel: 'boeken',
    label: 'Boeken',
    uitleg: 'Goedgekeurd en klaar voor Exact, of door Exact teruggestuurd.',
    standen: ['boeken', 'geweigerd'],
  },
  {
    sleutel: 'betalen',
    label: 'Betalen',
    uitleg: 'Geboekt en nog niet betaald.',
    standen: ['betalen'],
  },
]

/** Bij welke stap hoort deze stand? Leeg voor wat afgerond is. */
export function stapVanStand(stand: Verwerkstand): StapSleutel | null {
  return STAPPEN.find((s) => s.standen.includes(stand))?.sleutel ?? null
}

export interface Stapstand {
  stap: Stap
  aantal: number
  /** Het openstaande bedrag inclusief btw, want dat is wat er weg moet. */
  bedrag: number
  /** Hoeveel hiervan vastgelopen of geweigerd zijn -- het rode kruisje. */
  stuk: number
  /** Hoeveel hiervan over hun vervaldatum zijn -- het oranje uitroepteken. */
  telaat: number
  /** De bonnen zelf, zodat het scherm er meteen op kan filteren. */
  bonnen: Expense[]
}

/** Het bedrag inclusief btw. Dat is wat er betaald moet worden. */
export function inclusief(bon: Expense): number {
  const excl = bon.amountExcl || 0
  if (bon.btwBedrag != null) return excl + bon.btwBedrag
  return excl * (1 + (bon.vatPct || 0) / 100)
}

/**
 * Is deze factuur over zijn vervaldatum?
 *
 * Alleen wat nog niet betaald is. Een factuur die vorige maand te laat was en
 * inmiddels betaald, is geen openstaand probleem meer -- die meetellen maakt
 * het uitroepteken een teller van het verleden.
 */
export function teLaat(bon: Expense, nu: number = Date.now()): boolean {
  return bon.vervaldatum != null && bon.vervaldatum < nu && bon.betaaldAt == null
}

/**
 * De hele stroom in één keer.
 *
 * Geeft altijd alle stappen terug, ook de lege. Dat is met opzet: de rij is
 * het proces, en een vakje dat verdwijnt omdat er niets in zit verandert de
 * plek van alle andere. Dan staat "Goedkeuren" de ene dag op de derde plek en
 * de volgende op de tweede, en leer je de rij niet lezen.
 */
export function stroom(
  bonnen: Expense[],
  post: MailBericht[] = [],
  nu: number = Date.now(),
): Stapstand[] {
  const per = new Map<StapSleutel, Expense[]>()
  for (const bon of bonnen) {
    const sleutel = stapVanStand(standVan(bon, nu))
    if (!sleutel) continue
    const rij = per.get(sleutel)
    if (rij) rij.push(bon)
    else per.set(sleutel, [bon])
  }

  const binnen = onafgehandeldePost(post)

  return STAPPEN.map((stap) => {
    const mijne = per.get(stap.sleutel) ?? []
    return {
      stap,
      aantal: stap.sleutel === 'binnen' ? binnen.length : mijne.length,
      bedrag: mijne.reduce((t, b) => t + inclusief(b), 0),
      stuk: mijne.filter((b) => STANDEN[standVan(b, nu)].stuk).length,
      telaat: mijne.filter((b) => teLaat(b, nu)).length,
      bonnen: mijne,
    }
  })
}

/**
 * Post waar geen factuur van is gemaakt.
 *
 * Drie voorwaarden, en alle drie doen ze werk:
 *
 *   binnengekomen   uitgaande post is geen stapel om af te handelen
 *   geen expenseId  is er wel een kostenpost van gemaakt, dan staat hij
 *                   verderop in de rij en hoort hij hier niet ook nog
 *   niet 'verkoop'  een doorgestuurde eigen factuur is met opzet géén
 *                   kostenpost geworden (0047). Die hoort niet als
 *                   achterstand te tellen -- dan staat er elke maand werk in
 *                   de rij dat er geen is.
 */
export function onafgehandeldePost(post: MailBericht[]): MailBericht[] {
  return post.filter((m) => m.richting === 'in' && !m.expenseId && m.soort !== 'verkoop')
}

/* ------------------------------------------------------------------ *
 *  Per onderneming
 *
 *  De tweede foto van Casper: onder de rij vakjes een tabel met een regel per
 *  bv -- hoeveel facturen, en wat er te betalen staat. Dat is de vraag die
 *  een holding met twintig vennootschappen elke maand stelt, en die tot nu
 *  toe alleen te beantwoorden was door in Exact per administratie te kijken.
 * ------------------------------------------------------------------ */

export interface PerBedrijf {
  /** De administratiecode, of leeg voor wat nog nergens bij hoort. */
  code: string
  naam: string
  aantal: number
  bedrag: number
  telaat: number
}

/**
 * De bonnen gegroepeerd per vennootschap.
 *
 * `namen` is de vertaling van code naar naam; wat daar niet in staat wordt
 * met zijn code getoond. Dat is eerlijker dan de code verbergen: een
 * administratie die wel op facturen staat en niet in de lijst, is precies wat
 * je wilt zien.
 */
export function perBedrijf(
  bonnen: Expense[],
  namen: Map<string, string>,
  nu: number = Date.now(),
): PerBedrijf[] {
  const per = new Map<string, PerBedrijf>()

  for (const bon of bonnen) {
    const code = (bon.administratie ?? '').trim()
    const rij = per.get(code) ?? {
      code,
      naam: code ? (namen.get(code) ?? code) : 'Nog geen onderneming',
      aantal: 0,
      bedrag: 0,
      telaat: 0,
    }
    rij.aantal += 1
    rij.bedrag += inclusief(bon)
    if (teLaat(bon, nu)) rij.telaat += 1
    per.set(code, rij)
  }

  return [...per.values()].sort((a, b) => {
    /* Wat nergens bij hoort bovenaan: dat is het enige in deze lijst waar
       iemand iets aan moet doen. De rest op bedrag, grootste eerst. */
    if (!a.code !== !b.code) return a.code ? 1 : -1
    return b.bedrag - a.bedrag
  })
}
