import type { VerkoopFactuurRegel } from './trucksupply'

/* ------------------------------------------------------------------ *
 *  De stroom aan de verkoopkant
 *
 *  Casper vroeg of Verkoop dezelfde behandeling kon krijgen als Inkoop: een
 *  rij vakjes boven de lijst die tegelijk teller en filter is.
 *
 *  Waarom dit een eigen bestand is en geen uitbreiding van stroom.ts
 *  ----------------------------------------------------------------
 *
 *  De vorm is gelijk en de inhoud niet. Een inkoopfactuur doorloopt binnen,
 *  lezen, aanvullen, goedkeuren, boeken, betalen -- zes standen die uit een
 *  kostenpost worden afgeleid. Een verkoopfactuur heeft er vier, ze staan
 *  gewoon in een kolom (concept, verstuurd, betaald, vervallen), en er komt
 *  geen lezer en geen tweede handtekening aan te pas.
 *
 *  Die twee samenpersen in één functie zou betekenen dat elke stand een vraag
 *  krijgt die voor de helft van de facturen niet geldt. Twee bestanden van
 *  tachtig regels zijn hier eerlijker dan één van honderdvijftig met overal
 *  een "if verkoop".
 *
 *  De vakjes sluiten elkaar uit
 *  ----------------------------
 *
 *  Dezelfde regel als bij de werklijst: een factuur staat in precies één
 *  vakje. Een factuur die in twee vakjes staat, is een factuur die twee
 *  mensen oppakken of geen van beiden.
 *
 *  Dat vraagt één keuze die niet vanzelf spreekt. Een verstuurde factuur die
 *  nog niet in Exact staat, is tegelijk "moet geboekt" en "staat open". Hij
 *  valt hier onder BOEKEN, want dat is de eerstvolgende handeling van ons;
 *  openstaan is wachten op de klant. Het totaal dat buiten staat verdwijnt
 *  daarmee niet uit beeld -- dat staat als één bedrag in de kerncijfers
 *  boven de balk, en dat is ook de plek waar je ernaar kijkt.
 * ------------------------------------------------------------------ */

export type VerkoopStapSleutel = 'concept' | 'boeken' | 'openstaand'

export interface VerkoopStap {
  sleutel: VerkoopStapSleutel
  label: string
  /** Eén zin die zegt wat hier ligt. */
  uitleg: string
}

export const VERKOOPSTAPPEN: VerkoopStap[] = [
  {
    sleutel: 'concept',
    label: 'Concept',
    uitleg: 'Opgemaakt en nog niet verstuurd. Heeft nog geen nummer.',
  },
  {
    sleutel: 'boeken',
    label: 'Boeken',
    uitleg: 'Verstuurd naar de klant en nog niet in Exact geboekt.',
  },
  {
    sleutel: 'openstaand',
    label: 'Openstaand',
    uitleg: 'Geboekt en nog niet betaald. Hier wachten we op de klant.',
  },
]

/**
 * In welk vakje valt deze factuur?
 *
 * Null voor wat afgerond is: betaald, of vervallen. Een lijst waarin het
 * afgehandelde werk blijft staan, wordt elke maand langer en elke maand
 * minder gelezen.
 */
export function verkoopstapVan(f: VerkoopFactuurRegel): VerkoopStapSleutel | null {
  if (f.status === 'betaald' || f.status === 'vervallen') return null
  if (f.status === 'concept') return 'concept'
  /* Verstuurd. Eerst boeken, dan wachten -- zie de kop voor waarom die
     twee elkaar niet overlappen. */
  return f.exactId ? 'openstaand' : 'boeken'
}

/** Is deze factuur over zijn vervaldatum, en nog niet betaald? */
export function verkoopTeLaat(f: VerkoopFactuurRegel, nu: number = Date.now()): boolean {
  return f.vervaldatum != null && f.vervaldatum < nu && f.betaaldAt == null
}

/**
 * Kan deze factuur niet geboekt worden, en waarom niet?
 *
 * Geeft een leesbare zin of null. Twee redenen, en ze zijn allebei door een
 * mens op te lossen -- daarom horen ze op het scherm en niet alleen in een
 * logregel die niemand opent.
 */
export function verkoopKlem(f: VerkoopFactuurRegel): string | null {
  if (f.status !== 'verstuurd' || f.exactId) return null
  if (!f.heeftRelatie) {
    return 'Deze klant is nog niet aan een relatie in Exact gekoppeld. '
      + 'Een boeking wijst naar een relatie en niet naar een naam.'
  }
  if (f.fout) return f.fout
  return null
}

export interface VerkoopStapstand {
  stap: VerkoopStap
  aantal: number
  /** Inclusief btw: dat is wat de klant moet overmaken. */
  bedrag: number
  /** Hoeveel hiervan vastzitten -- het rode kruisje. */
  klem: number
  /** Hoeveel hiervan over de vervaldatum zijn -- het oranje uitroepteken. */
  telaat: number
}

/**
 * De hele stroom in één keer.
 *
 * Geeft altijd alle stappen terug, ook de lege -- de rij is het proces, en
 * een vakje dat verdwijnt verschuift alle andere.
 */
export function verkoopstroom(
  facturen: VerkoopFactuurRegel[],
  nu: number = Date.now(),
): VerkoopStapstand[] {
  return VERKOOPSTAPPEN.map((stap) => {
    const mijne = facturen.filter((f) => verkoopstapVan(f) === stap.sleutel)
    return {
      stap,
      aantal: mijne.length,
      bedrag: mijne.reduce((t, f) => t + f.bedragIncl, 0),
      klem: mijne.filter((f) => verkoopKlem(f) !== null).length,
      telaat: mijne.filter((f) => verkoopTeLaat(f, nu)).length,
    }
  })
}

/**
 * Wat er in totaal buiten staat: alles wat verstuurd is en niet betaald.
 *
 * Los van de vakjes, want dat bedrag loopt er dwars doorheen -- 'boeken' en
 * 'openstaand' zijn allebei geld dat nog moet komen. Dit is het getal waar
 * iemand 's ochtends naar kijkt, en het zou verdwijnen als het over twee
 * vakjes verdeeld bleef.
 */
export function buitenStaand(facturen: VerkoopFactuurRegel[]): {
  aantal: number
  bedrag: number
  telaat: number
  telaatBedrag: number
} {
  const open = facturen.filter((f) => f.status === 'verstuurd' && f.betaaldAt == null)
  const laat = open.filter((f) => verkoopTeLaat(f))
  return {
    aantal: open.length,
    bedrag: open.reduce((t, f) => t + f.bedragIncl, 0),
    telaat: laat.length,
    telaatBedrag: laat.reduce((t, f) => t + f.bedragIncl, 0),
  }
}
