import {
  BookOpen, Briefcase, Building2, ConciergeBell, FolderLock, Inbox,
  MessageSquare, Package, Receipt, Users, Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { dashboardsMet } from './schermen'
import type { Permission, Role } from './types'

/* ==================================================================
   Het virtuele kantoor
   ==================================================================

   Casper: "Ik wil een virtual office, je kan inloggen, en dan heb je dan een
   extra tabje. Dan heb je bijvoorbeeld de receptie, waar je kan praten met
   trucky (of een melding kan maken), kantoren voor bijvoorbeeld administratie
   ect ect. Maar je moet ook een bieb hebben voor die documentatie."

   Wat dit WEL is
   --------------

   Een plattegrond. Een tweede manier om ergens te komen, voor wie liever
   denkt in "waar moet ik zijn" dan in "hoe heet het scherm". Naast het menu,
   niet in plaats daarvan -- wie de weg weet klikt gewoon door.

   Twee ruimtes zijn meer dan een doorgang: de receptie (daar praat je met
   Trucky of maak je een melding, allebei op één plek) en de bibliotheek
   (daar staat de documentatie, in de app in plaats van in de repo).

   Wat dit NIET is, en dat is belangrijker
   ---------------------------------------

   Geen tweede rechtensysteem. Een deur gaat open als je het onderliggende
   recht hebt -- hetzelfde recht dat het menu gebruikt -- en anders staat hij
   er niet. Zou het kantoor eigen rechten krijgen, dan zijn er twee plekken
   waar je ze fout kunt zetten, en de tweede vergeet iedereen.

   En geen tweede waarheid over welk scherm bestaat. Een ruimte wijst naar een
   pagina uit schermen.ts; kent jouw dashboard die pagina niet, dan is de deur
   er niet. Zo kan de plattegrond niet uit de pas lopen met de app.

   Wie er in mag
   -------------

   Casper: "Zorg dat enkel medewerkers, managment ect ect erin kunnen, geen
   klanten of uitgenodigde klanten."

   Dus: iedereen behalve 'employer' (klant) en 'customer' (uitgenodigde
   klant). Die twee zien een dashboard dat voor hén gemaakt is; een kantoor
   met een personeelskamer en een directiekamer hoort daar niet bij, ook niet
   als elke deur toevallig op slot zou zitten. De deuren zelf verraden al hoe
   de organisatie in elkaar zit.
   ================================================================== */

/** De rollen die geen kantoor hebben. Alles wat hier niet staat, heeft het wel. */
export const KANTOOR_UITGESLOTEN: Role[] = ['customer', 'employer']

export function magKantoor(rol: Role | null | undefined): boolean {
  if (!rol) return false
  return !KANTOOR_UITGESLOTEN.includes(rol)
}

export interface Ruimte {
  key: string
  naam: string
  /** Eén zin: wat doe je hier. Staat op de deur. */
  wat: string
  icoon: LucideIcon
  /**
   * Waar de deur op uitkomt.
   *
   * Een paginasleutel uit schermen.ts, of 'receptie'/'bibliotheek' voor de
   * twee ruimtes die in het kantoor zelf zitten.
   */
  heen: string
  /**
   * Welk recht je nodig hebt. Leeg = iedereen die het kantoor in mag.
   *
   * Meerdere rechten betekent: één ervan is genoeg. Dat is met opzet zo
   * gekozen en niet "alle" -- een ruimte is een plek, en wie er om welke
   * reden dan ook iets te zoeken heeft, hoort binnen te kunnen.
   */
  rechten?: Permission[]
  /** De verdieping waarop hij staat; alleen voor de indeling van de lobby. */
  vleugel: 'entree' | 'werk' | 'kantoor' | 'kennis'
}

/*
 * De plattegrond.
 *
 * Volgorde is de looproute: je komt binnen bij de receptie, loopt langs waar
 * het werk is, dan de kantoren, en de bibliotheek ligt achteraan waar het
 * stil is. Dat is geen grap -- een lijst met een volgorde die ergens op slaat
 * onthoud je, een alfabetische niet.
 */
export const RUIMTES: Ruimte[] = [
  {
    key: 'receptie',
    naam: 'Receptie',
    wat: 'Vraag iets aan Trucky, of meld iets dat niet klopt',
    icoon: ConciergeBell,
    heen: 'receptie',
    vleugel: 'entree',
  },
  {
    key: 'overleg',
    naam: 'Overlegruimte',
    wat: 'Praten met collega’s, per kanaal',
    icoon: MessageSquare,
    heen: 'overleg',
    rechten: ['chat.use'],
    vleugel: 'entree',
  },

  /* --- waar het werk is --- */

  {
    key: 'werkvloer',
    naam: 'Werkvloer',
    wat: 'Wat er vandaag gewassen wordt',
    icoon: Briefcase,
    heen: 'vandaag',
    rechten: ['jobs.view'],
    vleugel: 'werk',
  },
  {
    key: 'werkplaats',
    naam: 'Technische dienst',
    wat: 'Storingen, werkbonnen en onderhoud',
    icoon: Wrench,
    heen: 'storingen',
    rechten: ['faults.view', 'workorders.view', 'maintenance.view'],
    vleugel: 'werk',
  },
  {
    key: 'magazijn',
    naam: 'Magazijn',
    wat: 'Voorraad en bestellingen',
    icoon: Package,
    heen: 'voorraad',
    rechten: ['inventory.view', 'supply.view'],
    vleugel: 'werk',
  },

  /* --- de kantoren --- */

  {
    key: 'administratie',
    naam: 'Administratie',
    wat: 'Facturen die binnenkwamen en nog een stap nodig hebben',
    icoon: Receipt,
    heen: 'verwerken',
    rechten: ['expenses.approve'],
    vleugel: 'kantoor',
  },
  {
    key: 'boekhouding',
    naam: 'Boekhouding',
    wat: 'Wat er naar Exact gaat, en wat daar blokkeert',
    icoon: Building2,
    heen: 'boekhouding',
    rechten: ['admin.desk'],
    vleugel: 'kantoor',
  },
  {
    key: 'postkamer',
    naam: 'Postkamer',
    wat: 'Wat er binnenkomt op het inkoopadres',
    icoon: Inbox,
    heen: 'postbus',
    rechten: ['mail.read'],
    vleugel: 'kantoor',
  },
  {
    key: 'personeelszaken',
    naam: 'Personeelszaken',
    wat: 'Dossiers, rooster en uren',
    icoon: Users,
    heen: 'personeel',
    rechten: ['staff.view'],
    vleugel: 'kantoor',
  },
  {
    key: 'directie',
    naam: 'Directiekamer',
    wat: 'Cijfers, omzet en wat eronder ligt',
    icoon: FolderLock,
    heen: 'financieel',
    rechten: ['finance.view'],
    vleugel: 'kantoor',
  },

  /* --- en achteraan, waar het stil is --- */

  {
    key: 'bibliotheek',
    naam: 'Bibliotheek',
    wat: 'Alle documentatie: hoe iets werkt en waar je het vindt',
    icoon: BookOpen,
    heen: 'bibliotheek',
    vleugel: 'kennis',
  },
]

export const VLEUGELS: Record<Ruimte['vleugel'], { naam: string; uitleg: string }> = {
  entree: {
    naam: 'Entree',
    uitleg: 'Waar je binnenkomt, en waar je iets kunt vragen.',
  },
  werk: {
    naam: 'De werkvloer',
    uitleg: 'Wat er vandaag gedaan wordt, en wat er stuk is.',
  },
  kantoor: {
    naam: 'De kantoren',
    uitleg: 'Papier, geld en mensen.',
  },
  kennis: {
    naam: 'Stille afdeling',
    uitleg: 'Opzoeken hoe iets werkt.',
  },
}

/**
 * Welke deuren er voor deze persoon zijn.
 *
 * Twee voorwaarden, en ze doen allebei iets anders:
 *
 *   het recht      mag je daar zijn. Hetzelfde recht als het menu gebruikt.
 *   het dashboard  kent jouw dashboard die pagina überhaupt? Zo niet, dan zou
 *                  de deur op een muur uitkomen: de app heeft geen router, en
 *                  een pagina bestaat pas als het dashboard haar kent.
 *
 * De twee ruimtes die in het kantoor zelf zitten (receptie, bibliotheek)
 * hebben geen pagina en slaan die tweede voorwaarde over.
 */
export function ruimtesVoor(
  rol: Role | null | undefined,
  kan: (recht: Permission) => boolean,
): Ruimte[] {
  if (!magKantoor(rol)) return []

  return RUIMTES.filter((r) => {
    if (r.rechten && r.rechten.length > 0 && !r.rechten.some(kan)) return false
    if (r.heen === 'receptie' || r.heen === 'bibliotheek') return true
    return dashboardsMet(r.heen).includes(rol as Role)
  })
}
