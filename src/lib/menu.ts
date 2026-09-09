import { DASHBOARDS_MET } from './schermen'

/* ==================================================================
   De indeling van het menu
   ==================================================================

   Casper: "Het menu moet professioneel en overzichtelijk zijn. Gebruik
   categorieen ... De gebruiker moet binnen maximaal een paar klikken bij
   vrijwel iedere functie kunnen komen. Voorkom diepe menu-structuren.
   Idealiter: Menu -> categorie -> functie."

   Waarom dit een aparte kaart is
   ------------------------------

   De schermen zelf staan in schermen.ts: welke er zijn, hoe ze heten, welk
   dashboard ze kent. Dat is de waarheid over WAT er bestaat.

   Hier staat waar het HOORT. Die twee scheiden is geen nettigheid: er komen
   voortdurend schermen bij, en zolang de indeling in acht dashboards
   verspreid staat als items-arrays, is er geen enkele plek waar je kunt
   nakijken of alles ergens onder valt. Nu wel -- en zelftest 58 rekent na
   dat elke sleutel uit DASHBOARDS_MET precies een keer voorkomt.

   Waarom de categorieen niet letterlijk die uit de opdracht zijn
   -------------------------------------------------------------

   Casper noemde er vier als voorbeeld (Werk, Administratie, Beheer,
   Inzicht). Die dekken de boekhouding goed en de wasstraat niet: storingen,
   werkbonnen, onderhoud, installaties en de voorraad vallen dan allemaal
   onder "Werk", en dat is precies de hoop waar hij vanaf wil. Vandaar
   Operatie, Mensen en Relaties erbij.

   Dat lijkt meer, en het is minder. Elke rol ziet alleen wat zijn dashboard
   kent, dus een wasser ziet twee categorieen en de administratie drie. Wie
   alles heeft -- het management -- ziet er zes, en dat is nog altijd een
   scherm waar je in een blik overheen kijkt in plaats van een lijst van
   dertig.

   Volgorde
   --------

   Van "wat ligt er op mij" naar "hoe stel ik het in". Dat is de volgorde
   waarin iemand op een dag zijn app gebruikt, en dus de volgorde waarin hij
   zoekt.
   ================================================================== */

export interface Categorie {
  sleutel: string
  naam: string
  /** Wat er in deze categorie hoort, in de volgorde waarin het getoond wordt. */
  paginas: string[]
}

export const CATEGORIEEN: Categorie[] = [
  {
    sleutel: 'werk',
    naam: 'Werk',
    /* Wat er vandaag op je ligt. Voor elke rol de eerste categorie, en voor
       een wasser bijna de enige. */
    paginas: [
      'start',
      'vandaag',
      'verwerken',
      'werk',
      'rooster',
      'uren',
      'mijn',
      'agenda',
      'overleg',
      'opleiding',
      'dossier',
      'beurten',
      'afspraken',
      'historie',
      'facturen',
      'plannen',
    ],
  },
  {
    sleutel: 'administratie',
    naam: 'Administratie',
    /* De geldstroom, van binnenkomst tot betaling. De volgorde is de
       volgorde van de factuur zelf: binnen, gelezen, goedgekeurd, geboekt,
       betaald. Dat is wat Blue10 goed doet -- het menu vertelt de werkwijze. */
    paginas: [
      'postbus',
      'kosten',
      'financieel',
      'verkoopfacturen',
      'betalen',
      'grootboek',
      'leveranciers',
      'documenten',
      'dossiers',
    ],
  },
  {
    sleutel: 'operatie',
    naam: 'Operatie',
    /* De wasstraat zelf: het werk, de machines en wat erin gaat. */
    paginas: [
      'planning',
      'materiaal',
      'voorraad',
      'artikelen',
      'bestellingen',
      'techniek',
      'storingen',
      'storing',
      'werkbonnen',
      'installaties',
      'onderhoud',
      'scan',
    ],
  },
  {
    sleutel: 'mensen',
    naam: 'Mensen',
    paginas: [
      'personeel',
      'team',
      'smart',
      'aanmeldingen',
      'werving',
      'chauffeurs',
      'bericht',
    ],
  },
  {
    sleutel: 'relaties',
    naam: 'Relaties',
    /* Wie er van buiten met ons te maken heeft, plus onze eigen vestigingen
       -- die staan hier omdat je ze in de praktijk opzoekt om een adres of
       een openingstijd, niet om ze in te stellen. */
    paginas: [
      'werkgevers',
      'klanten',
      'vestigingen',
    ],
  },
  {
    sleutel: 'inzicht',
    naam: 'Inzicht',
    paginas: [
      'overzicht',
    ],
  },
  {
    sleutel: 'beheer',
    naam: 'Beheer',
    /* Hoe het systeem staat afgesteld. Achteraan, want hier kom je een keer
       per maand en niet een keer per uur. */
    paginas: [
      'beheer',
      'kassas',
      'boekhouding',
      'instellingen',
      'trucky',
    ],
  },
  {
    sleutel: 'ontwikkeling',
    naam: 'Ontwikkeling',
    paginas: [
      'tickets',
      'logboek',
      'beveiliging',
      'meekijken',
      'systeem',
      'post',
      'inkoop',
      'eigenai',
      'exact',
    ],
  },
]

/* ------------------------------------------------------------------ *
 *  Nakijken dat er niets tussen valt
 *
 *  Deze twee functies bestaan voor de zelftest, en dat is met opzet: een
 *  indeling met de hand is precies het soort ding dat achterloopt zodra er
 *  een scherm bij komt. Dan staat het nergens in het menu, en het enige wat
 *  je merkt is dat iemand het niet kan vinden.
 * ------------------------------------------------------------------ */

/** Alle pagina's die in het menu staan, in volgorde. */
export function paginasInMenu(): string[] {
  return CATEGORIEEN.flatMap((c) => c.paginas)
}

/** Wat er wel bestaat maar nergens in het menu staat. Hoort leeg te zijn. */
export function paginasZonderPlek(): string[] {
  const inMenu = new Set(paginasInMenu())
  return Object.keys(DASHBOARDS_MET).filter((p) => !inMenu.has(p)).sort()
}

/** Wat er in het menu staat maar niet bestaat. Hoort ook leeg te zijn. */
export function paginasDieNietBestaan(): string[] {
  return paginasInMenu().filter((p) => !(p in DASHBOARDS_MET)).sort()
}

/** Wat er in meer dan een categorie staat. Een pagina hoort op een plek. */
export function paginasDubbel(): string[] {
  const geteld = new Map<string, number>()
  for (const p of paginasInMenu()) geteld.set(p, (geteld.get(p) ?? 0) + 1)
  return [...geteld].filter(([, n]) => n > 1).map(([p]) => p).sort()
}
