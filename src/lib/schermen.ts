import {
  AlertTriangle, Briefcase, Bug, Building2, CalendarDays, CalendarRange, ClipboardList, Cpu, FolderLock,
  GraduationCap, Inbox, LayoutDashboard, LayoutGrid, Link2, Mail, MessageSquare, Package,
  PackageCheck, Radio, Receipt, ScrollText, Server, Settings, ShieldAlert,
  BriefcaseBusiness, FolderOpen, ListTodo, Sparkles, Timer, Truck, Users, Wallet, Wrench,
} from 'lucide-react'
import { ROLE_ORDER, type Permission, type Role } from './types'

/* ------------------------------------------------------------------ *
 *  Welke schermen er zijn, en in welk dashboard ze staan
 *
 *  De zoekbalk staat sinds kort ook op het keuzescherm, vóór er een
 *  dashboard gekozen is. Casper: "zodat je iets sneller ergens kan komen,
 *  zonder eerst door te moeten klikken." Maar op dat scherm is er nog geen
 *  rol, en de app heeft geen router: een pagina bestaat pas als het
 *  dashboard dat haar kent gemount is. Dus moet er van tevoren iets weten
 *  welke pagina in welk dashboard woont, anders kan de zoekbalk wel een
 *  treffer tonen maar er niet heen.
 *
 *  Waarom dit een handgeschreven kaart is en niet uit de dashboards wordt
 *  afgeleid: die lijsten staan in acht componenten, als items-arrays die
 *  afhangen van rechten en pas bij het renderen bestaan. Ze importeren zou
 *  betekenen dat een pure functie acht dashboards (en hun schermen, hooks
 *  en styling) meesleept -- ook in de zelftest, die in Node draait. De kaart
 *  hier is data, en de zelftest controleert dat ze compleet blijft: elke
 *  pagina uit SCHERMEN staat erin, en elke rol komt voor.
 * ------------------------------------------------------------------ */

/**
 * Per pagina: de dashboards die haar kennen. Nagemeten uit de items-arrays
 * en de useNavTarget-aanroep van elk dashboard; komt er een pagina bij,
 * dan hoort ze ook hier.
 */
export const DASHBOARDS_MET: Record<string, Role[]> = {
  start:        ['employee', 'supervisor', 'technician', 'customer', 'employer', 'administratie', 'management', 'trucksupply'],
  overleg:      ['employee', 'supervisor', 'technician', 'employer', 'administratie', 'management', 'developer', 'trucksupply'],
  agenda:       ['employee', 'supervisor', 'technician', 'management'],
  opleiding:    ['employee', 'supervisor', 'technician', 'management'],
  uren:         ['employee', 'supervisor', 'administratie'],
  rooster:      ['employee', 'supervisor'],
  overzicht:    ['technician', 'customer', 'management'],
  personeel:    ['supervisor', 'management'],
  aanmeldingen: ['administratie', 'management'],
  bericht:      ['supervisor', 'management'],
  trucky:       ['administratie', 'management'],
  postbus:      ['management', 'developer', 'administratie'],
  werk:         ['supervisor', 'management', 'developer'],
  werving:      ['supervisor', 'management', 'developer'],
  documenten:   ['supervisor', 'management', 'developer'],
  plannen:      ['customer', 'developer'],
  kosten:       ['employee', 'administratie'],
  materiaal:    ['employee', 'management'],
  storingen:    ['technician', 'management'],
  werkbonnen:   ['technician', 'management'],
  installaties: ['technician', 'management'],
  onderhoud:    ['technician', 'management'],

  // Alleen in het werknemersdashboard
  vandaag:      ['employee'],
  dossier:      ['employee'],

  // Alleen bij de leidinggevende
  mijn:         ['supervisor'],
  smart:        ['supervisor'],
  team:         ['supervisor'],

  // Alleen bij de technische dienst
  storing:      ['technician'],
  scan:         ['technician'],

  // Alleen bij de klant
  facturen:     ['customer'],
  historie:     ['customer'],

  // Alleen bij de werkgever
  beurten:      ['employer'],
  chauffeurs:   ['employer'],
  afspraken:    ['employer'],

  // Alleen bij de administratie
  //
  // De boekhouding kreeg eigen sleutels en geen bestaande. 'facturen' is van
  // de klant, 'financieel' en 'klanten' van het management, en 'instellingen'
  // hangt in SCHERMEN aan trucksupply. Een sleutel delen betekent dat
  // kiesDashboard bij iemand met twee rollen de verkeerde kant op kan gaan.
  dossiers:      ['administratie'],
  verwerken:     ['administratie'],
  leveranciers:  ['administratie'],
  verkoopfacturen: ['administratie'],
  betalen:       ['administratie'],
  grootboek:     ['administratie'],
  boekhouding:   ['administratie'],

  // Alleen bij het management (klanten via useNavTarget, zonder eigen menu-item)
  planning:     ['management'],
  financieel:   ['management'],
  techniek:     ['management'],
  beheer:       ['management'],
  kassas:       ['management'],
  vestigingen:  ['management', 'trucksupply'],
  voorraad:     ['management', 'trucksupply'],
  werkgevers:   ['management'],
  klanten:      ['management'],

  // Alleen bij Trucksshop: artikelen tot in de kassa, bestellingen met
  // pakbon, en de instellingen van de leverancier (mailadres, ochtendtijd,
  // Exact). Voorraad en vestigingen deelt hij met het management.
  artikelen:    ['trucksupply'],
  bestellingen: ['trucksupply'],
  instellingen: ['trucksupply'],

  // Alleen bij ontwikkeling
  tickets:      ['developer'],
  logboek:      ['developer'],
  beveiliging:  ['developer'],
  meekijken:    ['developer'],
  systeem:      ['developer'],
  inkoop:       ['developer'],
  eigenai:      ['developer'],
  exact:        ['developer'],
  post:         ['developer'],
}

/**
 * Menu-items die geen pagina zijn.
 *
 * Deze drie staan in DASHBOARDS_MET omdat ze in een menu voorkomen, maar er
 * is geen dashboard met een `page === '<sleutel>'`-tak: ze openen een
 * venster. Nagemeten met een grep -- nul treffers voor alle drie.
 *
 * Ze horen daarom WEL in het menu en NIET in de zoeklijst. Een zoektreffer
 * zou naar een pagina navigeren die niet bestaat, en dat is precies de
 * doodlopende weg die zelftest 59 opspoort.
 *
 * Het staat hier en niet als uitzondering in die test, omdat het een
 * eigenschap van deze drie sleutels is en geen eigenschap van de test.
 */
export const VENSTER_ITEMS = ['bericht', 'storing', 'scan'] as const

/** De dashboards die deze pagina kennen; leeg als niemand haar kent. */
export function dashboardsMet(page: string): Role[] {
  return DASHBOARDS_MET[page] ?? []
}

/**
 * In welk dashboard moet deze pagina open?
 *
 * De huidige rol wint als die de pagina heeft: wie in Management zit en
 * "overleg" zoekt, moet niet ineens in het werknemersdashboard belanden.
 * Anders de eerste rol uit ROLE_ORDER die de gebruiker heeft én de pagina
 * kent -- die volgorde loopt van uitvoerend naar overkoepelend, dus je
 * komt in het eenvoudigste dashboard dat de pagina heeft. Kent geen van
 * je dashboards de pagina, dan null: dan valt er niets te kiezen.
 */
export function kiesDashboard(
  page: string,
  userRoles: readonly Role[],
  huidigeRol: Role | null,
): Role | null {
  const kent = dashboardsMet(page)
  if (huidigeRol && userRoles.includes(huidigeRol) && kent.includes(huidigeRol)) return huidigeRol
  return ROLE_ORDER.find((r) => userRoles.includes(r) && kent.includes(r)) ?? null
}

/**
 * Dezelfde treffer woont in verschillende dashboards op een andere pagina:
 * een wasbeurt staat bij het management onder Planning, bij de wasser onder
 * Vandaag en bij de werkgever onder Wasbeurten. De zoekbalk koos die pagina
 * eerst aan de hand van de gekozen rol -- maar op het keuzescherm is die er
 * nog niet, en dan kreeg een werkgever de pagina van het management mee,
 * die zijn dashboard niet kent. Hij landde op zijn startpagina en het doel
 * bleef in useNav hangen.
 *
 * Daarom hier: geef de kandidaten in volgorde van voorkeur, en je krijgt de
 * eerste die het huidige dashboard kent; anders de eerste die een van je
 * dashboards kent; anders de eerste van de lijst (dan weet de aanroeper
 * via kiesDashboard dat er geen dashboard voor is).
 */
export function kiesPagina(
  kandidaten: readonly string[],
  userRoles: readonly Role[],
  huidigeRol: Role | null,
): string {
  if (huidigeRol && userRoles.includes(huidigeRol)) {
    const eigen = kandidaten.find((p) => dashboardsMet(p).includes(huidigeRol))
    if (eigen) return eigen
  }
  return kandidaten.find((p) => kiesDashboard(p, userRoles, null) !== null) ?? kandidaten[0]
}

/* ------------------------------------------------------------------ *
 *  De schermen zelf
 *
 *  Wie de weg niet kent typt de naam van wat hij zoekt, niet die van een
 *  record. "Post", "voorraad", "rooster" -- dat hoort je naar dat scherm te
 *  brengen. Onder `ook` staan de woorden waarmee mensen het óók noemen.
 *
 *  Dit stond in GlobalSearch.tsx; het staat nu hier naast de kaart, zodat
 *  de zelftest kan nakijken dat elk scherm een dashboard heeft.
 * ------------------------------------------------------------------ */

export interface Scherm {
  page: string
  label: string
  hint: string
  icon: typeof Truck
  recht?: Permission
  /** Sommige schermen bestaan alleen in één dashboard. */
  rol?: Role
  ook?: string[]
}

export const SCHERMEN: Scherm[] = [
  { page: 'start',      label: 'Start',        hint: 'Het tegeloverzicht van je dashboard', icon: LayoutGrid, ook: ['home', 'begin', 'tegels'] },
  { page: 'vandaag',    label: 'Vandaag',      hint: 'Wasopdrachten en wachtrij',       icon: Truck,           recht: 'jobs.view', ook: ['wachtrij', 'wasbeurten'] },
  { page: 'planning',   label: 'Planning',     hint: 'Alle wasopdrachten',              icon: CalendarRange,   recht: 'planning.view' },
  { page: 'rooster',    label: 'Rooster',      hint: 'Wanneer je bent ingeroosterd',    icon: CalendarDays,    recht: 'roster.viewOwn', ook: ['diensten', 'werktijden'] },
  { page: 'uren',       label: 'Uren',         hint: 'Je geregistreerde uren',          icon: Timer,           recht: 'hours.own', ook: ['tijd', 'klok', 'inklokken', 'urenstaat'] },
  { page: 'materiaal',  label: 'Materiaal',    hint: 'Voorraad en verbruik',            icon: Package,         recht: 'inventory.view', ook: ['voorraad', 'chemie'] },
  { page: 'kosten',     label: 'Kosten',       hint: 'Bonnen indienen',                 icon: Receipt,         recht: 'expenses.submit', ook: ['bon', 'declaratie'] },
  { page: 'financieel', label: 'Financieel',   hint: 'Kosten valideren en resultaat',   icon: Receipt,         recht: 'finance.view', ook: ['omzet', 'marge', 'bonnen'] },
  { page: 'overzicht',  label: 'Overzicht',    hint: 'Cijfers en grafieken',            icon: LayoutDashboard, ook: ['kpi', 'cijfers'] },
  { page: 'documenten', label: 'Documenten',   hint: 'Mappen, het postvak en wat bij jou ligt', icon: FolderOpen,  ook: ['document', 'bestand', 'map', 'archief', 'verkenner'] },
  { page: 'werving',    label: 'Werving',      hint: 'Sollicitaties en vacatures',        icon: BriefcaseBusiness, ook: ['vacature', 'solliciteren', 'sollicitatie', 'kandidaat'] },
  { page: 'werk',       label: 'Werk',         hint: 'Je taken, het bord en de projecten', icon: ListTodo,     ook: ['taken', 'todo', 'bord', 'kanban', 'project'] },
  { page: 'personeel',  label: 'Personeel',    hint: 'Dossiers, rechten en vestigingen', icon: Users,          recht: 'staff.view', ook: ['medewerkers', 'dossier'] },
  { page: 'aanmeldingen', label: 'Aanmeldingen', hint: 'Wie zich heeft aangemeld',      icon: Inbox,           recht: 'signups.view' },
  { page: 'dossier',    label: 'Mijn dossier', hint: 'Je contract en documenten',       icon: FolderLock,      ook: ['contract', 'documenten', 'loonstrook'] },
  { page: 'techniek',   label: 'Techniek',     hint: 'Storingen, onderhoud, werkbonnen', icon: Wrench,         recht: 'faults.view' },
  { page: 'storingen',  label: 'Storingen',    hint: 'Meldingen beoordelen',            icon: AlertTriangle,   recht: 'faults.view', ook: ['defect', 'kapot'] },
  { page: 'werkbonnen', label: 'Werkbonnen',   hint: 'Het werk zelf',                   icon: ClipboardList,   recht: 'workorders.view' },
  { page: 'installaties', label: 'Installaties', hint: 'Machinepark en QR-labels',      icon: Wrench,          recht: 'assets.view', ook: ['machines', 'apparaten'] },
  { page: 'onderhoud',  label: 'Onderhoud',    hint: 'Schema’s en beurten',             icon: CalendarRange,   recht: 'maintenance.view' },
  { page: 'opleiding',  label: 'Opleiding',    hint: 'Cursussen en certificaten',       icon: GraduationCap,   recht: 'learning.take', ook: ['cursus', 'elearning', 'veiligheid'] },
  { page: 'overleg',    label: 'Overleg',      hint: 'Kanalen en gesprekken',           icon: MessageSquare,   recht: 'chat.use', ook: ['chat', 'berichten', 'kanaal'] },
  { page: 'tickets',    label: 'Meldingen',    hint: 'Wat gebruikers tegenkomen',       icon: Bug,             recht: 'dev.tickets' },
  { page: 'logboek',    label: 'Logboek',      hint: 'Fouten en waarschuwingen',        icon: ScrollText,      recht: 'dev.logs', ook: ['errors', 'fouten'] },
  { page: 'beveiliging', label: 'Beveiliging', hint: 'Wat er is weggehaald en welke apparaten opvallen', icon: ShieldAlert, recht: 'dev.logs', ook: ['security', 'verwijderd', 'audit', 'verdacht'] },
  { page: 'meekijken',  label: 'Meekijken',    hint: 'Alles wat er nu gebeurt',         icon: Radio,           recht: 'dev.logs', ook: ['live', 'monitor'] },
  { page: 'post',       label: 'Post',         hint: 'Wat er via Resend is verstuurd',  icon: Mail,            recht: 'dev.logs', ook: ['mail', 'email', 'resend'] },
  { page: 'systeem',    label: 'Systeem',      hint: 'Versies, verbinding en opslag',   icon: Server,          recht: 'dev.logs' },
  /* De drie schermen bij ontwikkeling die er wel waren maar niet in deze
     lijst stonden, en dus met geen mogelijkheid te vinden waren. */
  { page: 'inkoop',     label: 'Inkoop',       hint: 'Waar facturen binnenkomen en hoe ze zichzelf indelen', icon: Wallet, recht: 'dev.logs', ook: ['facturen', 'grootboek', 'boeken', 'kostenplaats', 'tags'] },
  { page: 'eigenai',    label: 'Eigen AI',     hint: 'Bij Claude of op de eigen machine', icon: Cpu,            recht: 'dev.logs', ook: ['ollama', 'lokaal', 'model', 'claude', 'lezer'] },
  { page: 'exact',      label: 'Exact-koppeling', hint: 'De sleutels van de Exact-app en de koppeling', icon: Link2, recht: 'dev.logs', ook: ['exact', 'boekhouding', 'oauth', 'sleutels', 'client', 'blue10'] },
  { page: 'beheer',     label: 'Beheer',       hint: 'Vestigingen, klanten, instellingen', icon: Settings,     recht: 'admin.settings', ook: ['locaties', 'instellingen'] },
  { page: 'postbus',    label: 'Postbus',      hint: 'Wat er binnenkomt op het mailadres', icon: Inbox,        recht: 'mail.read', ook: ['post', 'mail', 'email', 'facturen', 'bijlagen'] },
  /* De boekhouding. Eigen sleutels met een vaste rol, want de namen die je
     hier zou verwachten -- facturen, financieel, klanten -- zijn al van
     iemand anders. */
  { page: 'verwerken',  label: 'Te verwerken', hint: 'Alles wat binnenkwam en nog een stap nodig heeft', icon: Inbox, rol: 'administratie', recht: 'admin.desk', ook: ['werklijst', 'wachtrij', 'binnengekomen', 'vastgelopen', 'lezen'] },
  { page: 'leveranciers', label: 'Leveranciers', hint: 'Wie er factureert, en hoe dat in Exact heet', icon: Truck, rol: 'administratie', recht: 'admin.desk', ook: ['relaties', 'crediteuren', 'exact'] },
  { page: 'verkoopfacturen', label: 'Verkoopfacturen', hint: 'Wat wij versturen', icon: Receipt, rol: 'administratie', recht: 'admin.desk', ook: ['verkoop', 'debiteuren', 'factureren', 'uitgaand'] },
  { page: 'betalen',    label: 'Betalen',      hint: 'Betaalbatches en SEPA-bestanden', icon: Wallet, rol: 'administratie', recht: 'admin.desk', ook: ['sepa', 'batch', 'bank', 'overboeken', 'crediteuren'] },
  { page: 'grootboek',  label: 'Grootboek',    hint: 'Het rekeningschema uit Exact',    icon: ScrollText, rol: 'administratie', recht: 'admin.desk', ook: ['rekeningschema', 'grootboekrekening', 'boeken'] },
  { page: 'boekhouding', label: 'Boekhouding instellen', hint: 'Hoe facturen worden gelezen, geboekt en goedgekeurd', icon: Settings, rol: 'administratie', recht: 'admin.desk', ook: ['instellingen', 'vier ogen', 'automatisch', 'dagboek', 'btw'] },
  { page: 'agenda',     label: 'Agenda',       hint: 'Afspraken, verjaardagen en jubilea', icon: CalendarDays, recht: 'agenda.view', ook: ['kalender', 'afspraak', 'verjaardag'] },
  { page: 'klanten',    label: 'Facturatieklanten', hint: 'De bedrijven waar een factuur heen gaat', icon: Building2, recht: 'customers.view', ook: ['klant', 'bedrijf', 'factuuradres', 'debiteur'] },
  { page: 'werkgevers', label: 'Klanten',      hint: 'Bedrijven waarvan de chauffeurs hier wassen', icon: Briefcase, recht: 'employer.view', ook: ['bedrijven', 'transporteur', 'chauffeurs', 'werkgevers', 'werkgever'] },
  { page: 'beurten',    label: 'Wasbeurten',   hint: 'Wat er op naam van je bedrijf staat', icon: Truck,      rol: 'employer' },
  { page: 'chauffeurs', label: 'Chauffeurs',   hint: 'Wie er namens je bedrijf komt wassen', icon: Users,     rol: 'employer', recht: 'employer.staff' },
  { page: 'afspraken',  label: 'Afspraken',    hint: 'Wat er per wagen wel en niet mag',  icon: ClipboardList, rol: 'employer', recht: 'employer.rules' },
  // Met rol: management heeft alle rechten, maar deze pagina's bestaan alleen
  // in het dashboard van Trucksshop; zonder rol was het een treffer die
  // nergens heen leidde (kiesDashboard geeft dan null).
  { page: 'artikelen',  label: 'Artikelen',    hint: 'Wat Trucksshop levert, tot in de kassa', icon: Package, rol: 'trucksupply', recht: 'supply.articles', ook: ['assortiment', 'sku', 'producten'] },
  { page: 'bestellingen', label: 'Bestellingen', hint: 'Inpakken, verzenden, pakbon en label', icon: PackageCheck, rol: 'trucksupply', recht: 'supply.orders', ook: ['pakbon', 'levering', 'verzenden', 'order'] },
  { page: 'instellingen', label: 'Instellingen', hint: 'Mailadres, ochtendmail en Exact', icon: Settings, rol: 'trucksupply', recht: 'supply.settings', ook: ['exact', 'ochtendmail'] },

  /* ---------------------------------------------------------------- *
   *  De elf die er wel waren maar niet te vinden
   *
   *  SCHERMEN telde 48 ingangen tegenover 59 echte paginasleutels. Deze elf
   *  stonden er niet in en waren dus alleen via het menu te bereiken -- en op
   *  een telefoon was het menu tot voor kort vier knoppen.
   *
   *  Het duurste voorbeeld: een klant die "facturen" typt kreeg vier treffers
   *  (Inkoop, Postbus, Verkoopfacturen, Boekhouding instellen) en niet zijn
   *  eigen facturenscherm. Dat is erger dan geen treffer: hij klikt er een
   *  aan, komt nergens, en concludeert dat de app zijn facturen niet heeft.
   * ---------------------------------------------------------------- */

  { page: 'facturen',    label: 'Mijn facturen',  hint: 'Wat er bij jouw bedrijf in rekening is gebracht', icon: Receipt, rol: 'customer', ook: ['factuur', 'rekening', 'nota', 'openstaand'] },
  { page: 'historie',    label: 'Historie',       hint: 'Alle wasbeurten van je bedrijf, terug in de tijd', icon: CalendarRange, rol: 'customer', ook: ['verleden', 'eerder', 'wasbeurten', 'archief'] },
  { page: 'plannen',     label: 'Inplannen',      hint: 'Een wasbeurt aanvragen',           icon: CalendarDays,  ook: ['boeken', 'aanvragen', 'afspraak', 'reserveren'] },

  { page: 'mijn',        label: 'Mijn team',      hint: 'Wie er vandaag staat en wat er ligt', icon: Users,       rol: 'supervisor', ook: ['ploeg', 'vandaag', 'bezetting'] },
  { page: 'team',        label: 'Uren van het team', hint: 'De urenstaten van je mensen',   icon: Timer,          rol: 'supervisor', recht: 'hours.approve', ook: ['urenstaat', 'klokken', 'goedkeuren'] },
  { page: 'smart',       label: 'Slim inroosteren', hint: 'Een rooster laten voorstellen',  icon: Sparkles,       rol: 'supervisor', ook: ['rooster', 'planning', 'voorstel', 'ai'] },

  { page: 'dossiers',    label: 'Personeelsdossiers', hint: 'Contracten, documenten en gegevens', icon: FolderLock, rol: 'administratie', recht: 'staff.view', ook: ['dossier', 'contract', 'loonstrook', 'personeel'] },

  { page: 'vestigingen', label: 'Vestigingen',    hint: 'Adressen, openingstijden, foto\u2019s en wat er op de website staat', icon: Building2, recht: 'locations.manage', ook: ['locatie', 'locaties', 'filiaal', 'adres', 'openingstijden', 'website'] },
  { page: 'voorraad',    label: 'Voorraad',       hint: 'Standen, minima en wat er bijbesteld moet', icon: Package,  recht: 'inventory.view', ook: ['materiaal', 'chemie', 'bestellen', 'minimum', 'alarm'] },
  { page: 'kassas',      label: 'Kassa\u2019s',       hint: 'Apparaten koppelen, lades en kluizen', icon: Cpu,       recht: 'pos.manage', ook: ['kassa', 'pos', 'lade', 'kluis', 'apparaat', 'koppelen', 'pin'] },
  { page: 'trucky',      label: 'Trucky',         hint: 'De chatbot op de website: vragen, antwoorden en contactverzoeken', icon: MessageSquare, recht: 'admin.desk', ook: ['chatbot', 'bot', 'website', 'vragen', 'contact'] },
]
