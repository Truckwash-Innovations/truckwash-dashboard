/**
 * Mensen: dossiers, rechten, vestigingen en wat de AI van een pasje maakt
 *
 * Onderdeel van de zelftest; zie scripts/selftest.ts voor hoe dit draait en
 * waarom het is opgesplitst.
 */

import { api, check, db, eq, zonderCommentaar } from './kern.ts'

export async function groepen() {
/* ==================================================================== *
 *  Het dossier valt uiteen (0056)
 *
 *  Casper: "als leidinggevende een medewerker aanmaken, moeten hun ook
 *  gewoon een BSN zien."
 *
 *  De schematest bewaakt de kant van de database. Dit hoofdstuk bewaakt de
 *  kant van de app, en dat is een andere fout: hier gaat het niet mis met
 *  een policy maar met een veld dat terugkruipt. Zou het rekeningnummer of
 *  het uurloon ooit weer via dossier.save() meegaan, dan schrijft de app het
 *  in personnel_private -- en dan staat het weer naast de identiteit, waar
 *  de leidinggevende bij mag.
 *
 *  Dat levert geen foutmelding op. Het veld verdwijnt gewoon stilletjes naar
 *  de verkeerde tabel.
 * ==================================================================== */

console.log('\n41. Het dossier valt uiteen')

{
  const { readFileSync } = await import('node:fs')

  /* --- de opslaghulp --- */

  const repo = readFileSync('src/lib/dossier.ts', 'utf8')
  check('er is een aparte bewaring voor de geldkant', repo.includes('async saveLoon('))
  check('die schrijft in personnelLoon',
    /put\('personnelLoon', db\.personnelLoon, rij\)/.test(repo))

  /*
   * En de gewone save() raakt het geld niet aan. Deze twee stukken staan
   * vlak onder elkaar in hetzelfde bestand; één copy-paste te veel en het
   * uurloon zit weer in de verkeerde helft.
   */
  const gewoon = repo.slice(repo.indexOf('async save('), repo.indexOf('async saveLoon('))
  check('en de gewone bewaring schrijft alleen in personnelPrivate',
    gewoon.includes("put('personnelPrivate'") && !gewoon.includes('personnelLoon'))

  /* --- het scherm --- */

  const scherm = readFileSync('src/components/Dossier.tsx', 'utf8')

  check('de geldkant komt uit de eigen tabel',
    scherm.includes('db.personnelLoon.get(person.id)'))
  check('en het scherm kent twee rechten',
    scherm.includes("const magInvullen = magBeheren || perms.can('staff.view')"))

  /*
   * Het rekeningnummer, het uurloon en de interne notitie horen alleen in
   * beeld te komen voor wie eraan mag. Niet grijs, niet leeg: afwezig.
   */
  for (const veld of ['Rekeningnummer', 'Uurtarief', 'Interne notitie']) {
    const i = scherm.indexOf(`label="${veld}`)
    check(`${veld} staat achter magBeheren`,
      i > 0 && /\{magBeheren && \($/m.test(scherm.slice(Math.max(0, i - 260), i)),
      i > 0 ? 'gevonden maar niet afgeschermd' : 'veld niet gevonden')
  }

  /* En bij het opslaan gaat de geldkant apart, achter hetzelfde recht. */
  check('opslaan van het geld gebeurt alleen met dat recht',
    /if \(magBeheren\) \{\s*await dossierRepo\.saveLoon\(/.test(scherm))

  /* --- wat er niet meer bij de identiteit hoort te staan --- */

  const opslaan = scherm.slice(scherm.indexOf('await dossierRepo.save(person.id, {'),
    scherm.indexOf('if (magBeheren) {'))
  for (const veld of ['iban:', 'hourlyRate:', 'internalNotes:']) {
    check(`${veld.slice(0, -1)} gaat niet mee met de identiteitsgegevens`,
      !opslaan.includes(veld))
  }

  /* --- de synchronisatie kent de nieuwe tabel --- */

  const sync = readFileSync('src/lib/sync.ts', 'utf8')
  check('personnelLoon staat in de duwvolgorde', sync.includes("'personnelLoon'"))

  /*
   * Hier stond: db.personnelLoon.clear() komt twee keer voor. Dat klopte
   * zolang er twee lijsten met de hand werden bijgehouden -- en precies dat
   * bleek het probleem: ze liepen allebei achter, en negen tabellen werden
   * bij "Opnieuw ophalen" niet gewist terwijl het scherm zei van wel.
   *
   * Nu komt de lijst uit TABLE_OF, waar het ophalen zelf ook op draait. De
   * belofte is dezelfde en de meting is anders: staat de tabel erin, dan
   * wordt hij gewist -- en dat geldt meteen voor elke tabel die er later bij
   * komt.
   */
  check('en wordt opgeruimd, want hij staat in TABLE_OF',
    /TABLE_OF[\s\S]*personnelLoon: \(\) => db\.personnelLoon/.test(sync))
  check('het wissen komt uit die ene lijst',
    sync.includes('Object.values(TABLE_OF).map((pak) => pak().clear())'))
  check('en beide plekken die wissen gebruiken hem',
    (sync.match(/await wisLokaleKopie\(\)/g) ?? []).length === 2)
}

/* ====================================================================
 *  46. Welke vestiging mag je kiezen
 *
 *  Casper zag dit: "De database weigert dit voor doc_bestand: new row
 *  violates row-level security policy. Dat gaat over rechten, niet over dit
 *  record -- het blijft in de wachtrij staan."
 *
 *  De regel in de database was goed; het SCHERM was fout. In het
 *  documentvenster stonden alle achttien vestigingen in de keuzelijst, ook die
 *  waar je niet over gaat. Koos je zo'n vestiging, dan schreef de app het
 *  lokaal weg, weigerde de server het, en bleef het record in de wachtrij
 *  hangen -- met een melding waar je niets aan hebt, want die zegt "rechten"
 *  en niet "je koos Ede".
 *
 *  Een keuzelijst die iets aanbiedt wat de server terugstuurt is geen
 *  keuzelijst maar een val. Vandaar hier een toets: wat de app aanbiedt is
 *  precies wat in_my_locations() op de server doorlaat.
 * ==================================================================== */

console.log('\n46. Welke vestiging mag je kiezen')

{
  const { mijnVestigingen, magVestigingKiezen } = await import('../../src/lib/documenten.ts')

  const mens = (extra: Record<string, unknown> = {}) => ({
    id: 'u1', email: 'a@b.nl', password: '', name: 'Test',
    roles: ['supervisor'], active: true, updatedAt: 0, ...extra,
  }) as never

  const alle = [{ id: 'loc_a' }, { id: 'loc_b' }, { id: 'loc_c' }]
  const namen = (xs: { id: string }[]) => xs.map((x) => x.id).join(',')

  check('het hoofdkantoor mag alles kiezen',
    namen(mijnVestigingen(alle, mens({ allLocations: true }))) === 'loc_a,loc_b,loc_c')

  check('een leidinggevende alleen zijn eigen vestiging',
    namen(mijnVestigingen(alle, mens({ locationId: 'loc_a' }))) === 'loc_a')

  check('en zijn eigen plus wat hij beheert',
    namen(mijnVestigingen(alle, mens({ locationId: 'loc_a', manages: ['loc_c'] })))
      === 'loc_a,loc_c')

  /*
   * Iemand zonder vestiging krijgt een LEGE lijst en niet alles. Dat is het
   * verschil dat de val maakte: de oude lijst gaf alles, en dan koos hij iets
   * dat de server weigerde.
   */
  check('wie geen vestiging heeft, krijgt er ook geen te kiezen',
    mijnVestigingen(alle, mens({})).length === 0)

  /* --- en de rem die hetzelfde zegt --- */

  check('geen vestiging mag altijd',
    magVestigingKiezen(undefined, mens({ locationId: 'loc_a' })))
  check('de eigen vestiging mag',
    magVestigingKiezen('loc_a', mens({ locationId: 'loc_a' })))
  /*
   * Dit is de regel die de wachtrij liet vastlopen. Hij hoort nu op het scherm
   * te falen met een zin die zegt wat er aan de hand is, en niet stil in de
   * wachtrij.
   */
  check('die van een ander niet',
    !magVestigingKiezen('loc_b', mens({ locationId: 'loc_a' })))
  check('tenzij je overal mag',
    magVestigingKiezen('loc_b', mens({ allLocations: true })))

  /* Wat de lijst aanbiedt en wat de rem doorlaat, horen hetzelfde te zijn --
     anders is de een een val voor de ander. */
  const leiding = mens({ locationId: 'loc_a', manages: ['loc_c'] })
  check('de lijst en de rem zijn het overal over eens',
    alle.every((l) =>
      mijnVestigingen(alle, leiding).some((x) => x.id === l.id)
        === magVestigingKiezen(l.id, leiding)))
}

/* ====================================================================
 *  47. De brug tussen de rollen en de database
 *
 *  De database kende rollen niet. heeft_recht() keek alleen naar
 *  profiles.grants, en de app schrijft een recht dat uit de ROL komt daar
 *  bewust niet in. Gevolg: 22 policies stonden dicht voor precies de mensen
 *  voor wie ze geschreven waren.
 *
 *  0072 lost dat op met een tabel rol_recht: een korte, leesbare lijst van
 *  rolrechten die de database mag afleiden. Bewust een lijst en niet "lees
 *  permissions.ts maar uit", want dat laatste zou en passant staff.view aan
 *  elke leidinggevende geven.
 *
 *  Maar een tweede lijst is een tweede waarheid, en twee waarheden lopen uit
 *  elkaar. Dit hoofdstuk is de klem: wat de database aanneemt moet de app ook
 *  echt geven. Zet iemand later een regel in rol_recht die in permissions.ts
 *  niet bestaat, dan valt dit om -- en niet een half jaar later op een
 *  maandagochtend.
 * ==================================================================== */

console.log('\n47. De brug tussen de rollen en de database')

{
  const { readFileSync } = await import('node:fs')
  const { ROLE_DEFAULTS } = await import('../../src/lib/permissions.ts')

  const sql = readFileSync(
    'supabase/migrations/0072_de_administratie_komt_binnen.sql', 'utf8')

  /* De regels uit de insert lezen, zoals ze er staan. */
  const blok = sql.slice(sql.indexOf('insert into public.rol_recht'))
  /* Ruim genoeg voor elke naam die permissions.ts kan bevatten. Een rij die
     dit patroon niet leest, is een rij die niemand controleert -- en dat is
     precies het gat dat dit hoofdstuk moet dichten. */
  const rijen = [...blok.matchAll(/\('([a-z0-9_]+)',\s*'([a-z0-9._]+)'/g)]
    .map(([, rol, recht]) => ({ rol, recht }))

  check('de brug bevat regels', rijen.length >= 5, String(rijen.length))

  /*
   * De klem zelf. Elk paar in rol_recht moet in ROLE_DEFAULTS staan --
   * anders neemt de database iets aan wat de app niet geeft, en dan mag
   * iemand in de database meer dan op zijn scherm.
   */
  const mist = rijen.filter(({ rol, recht }) =>
    !((ROLE_DEFAULTS as Record<string, string[]>)[rol] ?? []).includes(recht))
  check('en geeft niets wat de rol in de app niet geeft',
    mist.length === 0, mist.map((m) => `${m.rol}/${m.recht}`).join(', '))

  /*
   * En andersom NIET. De administratie heeft in de app ruim dertig rechten;
   * de database hoort er maar een handvol te kennen. Een brug die alles
   * overzet is dezelfde generieke oplossing die staff.view zou opengooien.
   */
  const adm = rijen.filter((r) => r.rol === 'administratie').length
  const inApp = (ROLE_DEFAULTS as Record<string, string[]>).administratie.length
  check('maar bewust niet alles wat de rol geeft', adm < inApp / 3,
    `${adm} van ${inApp}`)

  /* Een intrekking hoort te winnen, anders is het management machteloos. */
  check('een intrekking sluit de brug',
    /not \(recht = any\(\s*\n?\s*coalesce\(\(select revokes/.test(sql))

  /* --- en de tweede functie die op grants alleen keek --- */

  const postbus = readFileSync('supabase/functions/postbus-actie/index.ts', 'utf8')
  /*
   * Deze was al stuk voor de ontwikkelaar, los van welke verbouwing dan ook:
   * de knoppen Delen en Bijlagen-opnieuw stonden in beeld en gaven 403, omdat
   * mail.read bij hem uit de rol komt en de controle alleen naar grants keek.
   */
  check('postbus-actie kijkt naar de rollen en niet alleen naar grants',
    /POSTROLLEN = \['management', 'developer', 'administratie'\]/.test(postbus))
  check('en laat een los toegekend recht ook nog toe',
    postbus.includes("beller.rechten.includes('mail.read')"))
}

/* ====================================================================
 *  51. Mensen beheren: uitnodigen, wachtwoord, en de rij die niet aankwam
 *
 *  Casper: "ik zie nog steeds niks waar ik mensen kan beheren ect".
 *
 *  Het bestond wel, maar op de verkeerde plek en met een tekst ernaast die
 *  het tegensprak. Boven aan het dossier stond een gele balk: "Laat hem zich
 *  aanmelden op het inlogscherm." Dat is precies wat uitnodigen moet
 *  voorkomen -- wie zich zelf aanmeldt doet dat met zijn prive-adres, en dan
 *  staan er twee dossiers van dezelfde man. De knop die het wel goed doet
 *  stond ver eronder, in een andere kaart, voorbij de statistieken en het
 *  rooster.
 *
 *  Dit hoofdstuk legt drie dingen vast die alle drie stil misgingen.
 * ==================================================================== */

console.log('\n51. Mensen beheren')

{
  const { readFileSync } = await import('node:fs')

  /* ---- 1. de aanmaakwizard schreef in een kolom die niet bestaat ---- */

  /*
   * Rekeningnummer en uurtarief staan sinds 0056 in personnel_loon; de
   * kolommen iban en hourly_rate zijn uit personnel_private weggehaald. De
   * wizard stuurde ze toch mee in dezelfde rij, en dan weigert PostgREST de
   * HELE rij -- dus kwamen ook het BSN, de geboortedatum en de
   * documentgegevens nooit op de server aan. Lokaal stond alles er wel, dus
   * het scherm meldde dat het gelukt was.
   */
  const wizard = readFileSync('src/components/NieuweMedewerker.tsx', 'utf8')
  const setup = readFileSync('supabase/setup.sql', 'utf8')

  check('de kolommen iban en hourly_rate zijn echt weg uit personnel_private',
    setup.includes('alter table public.personnel_private drop column if exists iban;')
      && setup.includes('alter table public.personnel_private drop column if exists hourly_rate;'))

  /* De aanroep van save() opzoeken en kijken wat erin zit. */
  const saveBlok = wizard.slice(
    wizard.indexOf('dossierRepo.save(persoon.id, {'),
    wizard.indexOf('documentVerified'))
  check('de wizard stuurt geen iban meer naar het dossier',
    !saveBlok.includes('iban:'), saveBlok.slice(0, 200))
  check('en geen uurtarief',
    !saveBlok.includes('hourlyRate:'))
  check('maar bewaart ze wel, in de loonrij',
    wizard.includes('dossierRepo.saveLoon(persoon.id, loon)'))

  /* ---- 2. uitnodigen staat waar het probleem staat ---- */

  const scherm = readFileSync('src/components/Personeel.tsx', 'utf8')
  const balk = scherm.slice(
    scherm.indexOf('Nog geen toegang tot de app'),
    scherm.indexOf('Nog geen toegang tot de app') + 900)

  check('de balk stuurt je niet meer naar het inlogscherm',
    !balk.includes('aanmelden op het inlogscherm'), balk.slice(0, 160))
  check('maar zet de uitnodigknop erbij',
    balk.includes('<UitnodigenKnop'))
  check('en die knop roept echt uitnodigen aan',
    /function UitnodigenKnop[\s\S]{0,900}personeel\.uitnodigen\(person\.id\)/.test(scherm))

  /* ---- 3. wachtwoord opnieuw instellen ---- */

  const beheer = readFileSync('src/components/PersoonBeheer.tsx', 'utf8')
  const repo = readFileSync('src/lib/personeel.ts', 'utf8')
  const server = readFileSync('supabase/functions/medewerker/index.ts', 'utf8')

  check('er is een knop Wachtwoord opnieuw',
    beheer.includes('Wachtwoord opnieuw'))
  /*
   * Achter een bevestiging. Dit maakt het huidige wachtwoord meteen ongeldig;
   * wie hem per ongeluk indrukt heeft iemand buitengesloten tot de mail er is.
   */
  check('en die zit achter een bevestiging',
    /setWachtwoord\(true\)/.test(beheer)
      && /open={wachtwoord}/.test(beheer))
  check('de app roept de actie wachtwoord aan',
    repo.includes("roep({ actie: 'wachtwoord', userId })"))
  check('de server kent die actie',
    server.includes("if (actie === 'wachtwoord') {"))
  check('en zet het wachtwoord met de servicesleutel',
    /updateUserById\(\s*String\(dossier\.auth_id\),\s*{ password:/.test(server))

  /*
   * must_change_password moet weer aan. Zonder dat blijft een wachtwoord dat
   * per mail is verstuurd geldig zolang niemand het wijzigt -- en dan staat de
   * sleutel van een account voor onbepaalde tijd in twee postvakken.
   */
  const actieBlok = server.slice(
    server.indexOf("if (actie === 'wachtwoord') {"),
    server.indexOf('uitschrijven ------------------'))
  check('de vlag must_change_password gaat weer aan',
    actieBlok.includes('must_change_password: true'))

  /*
   * En als de mail niet aankomt is het wachtwoord al gewijzigd en weet
   * niemand het nieuwe. Dat hoort op het scherm te komen, niet in een log.
   */
  check('een mislukte mail wordt gemeld en niet weggeslikt',
    actieBlok.includes('if (!verstuurd)')
      && actieBlok.includes('NIET verstuurd'))

  /* ---- 4. listUsers zonder paginering geeft er vijftig ---- */

  /*
   * Alleen een echte aanroep, niet de tekst. Dit stond eerst als
   * /listUsers\(\)/ en sloeg toen aan op het commentaar dat de valkuil
   * uitlegt -- een test die faalt omdat je hebt opgeschreven waarom hij
   * bestaat.
   */
  check('uitnodigen zoekt bestaande accounts met paginering',
    !/admin\.listUsers\(\)/.test(server), 'er staat nog een kale aanroep')
  check('en pakt er genoeg',
    server.includes('listUsers({ page: 1, perPage: 200 })'))
}

/* ====================================================================
 *  53. Klanten beheren
 *
 *  Casper: "Daarnaast moet je alle klanten, gebruikers ect kunnen beheren bij
 *  managment, kunnen aanmaken."
 *
 *  Hij kon het niet vinden omdat het er niet was. Drie dingen heten "Klant":
 *  public.companies (het factuuradres), Werkgever (het transportbedrijf) en de
 *  rol customer (het inlogaccount). Het menu-item "Klanten" opende het
 *  werkgeversscherm; voor companies bestond geen scherm en ook geen repo -- er
 *  stond in de hele app geen enkele schrijfactie op db.companies.
 *
 *  De synchronisatie was er wel al, op alle zes de plekken. Er ontbrak dus een
 *  scherm, geen leidingwerk.
 * ==================================================================== */

console.log('\n53. Klanten beheren')

{
  const { klanten, pastBijZoek } = await import('../../src/lib/klanten.ts')
  const { db } = await import('../../src/lib/db')

  /* ---- aanmaken ---- */

  const gemaakt = await klanten.maak({
    name: '  Transport De Wit  ',
    contact: 'J. de Wit',
    email: 'facturen@dewit.nl',
    city: 'Venlo',
  })

  check('een klant aanmaken levert een id op',
    typeof gemaakt.id === 'string' && gemaakt.id.startsWith('co'), gemaakt.id)
  check('en de naam wordt opgeschoond', gemaakt.name === 'Transport De Wit', gemaakt.name)
  /* Zonder korting is nul, niet undefined -- die waarde gaat op een factuur. */
  check('zonder opgave is de korting nul', gemaakt.contractDiscountPct === 0)

  const uitDb = await db.companies.get(gemaakt.id)
  check('hij staat meteen in de plaatselijke opslag', uitDb?.name === 'Transport De Wit')

  /*
   * En in de wachtrij, want anders staat hij alleen op dit apparaat. Dat is
   * het hele punt van de offline-eerst opzet: schrijven gaat plaatselijk en de
   * wachtrij brengt het naar de server.
   */
  const inWachtrij = await db.outbox
    .filter((r) => r.entity === 'companies' && r.recordId === gemaakt.id)
    .toArray()
  check('en in de wachtrij naar de server', inWachtrij.length >= 1,
    String(inWachtrij.length))
  check('als een put', inWachtrij.some((r) => r.op === 'put'))

  /* ---- wijzigen ---- */

  const gewijzigd = await klanten.wijzig(gemaakt.id, { city: 'Venlo-Zuid', contractDiscountPct: 12 })
  check('wijzigen werkt', gewijzigd?.city === 'Venlo-Zuid' && gewijzigd?.contractDiscountPct === 12)
  check('en laat de rest staan', gewijzigd?.contact === 'J. de Wit')
  check('een onbekende klant wijzigen doet niets',
    (await klanten.wijzig('co_bestaatniet', { city: 'X' })) === null)

  /* ---- verwijderen ---- */

  await klanten.verwijder(gemaakt.id)
  check('verwijderen haalt hem plaatselijk weg',
    (await db.companies.get(gemaakt.id)) === undefined)

  /*
   * En de wachtrij moet het weten. Zonder deze regel is de klant alleen op dit
   * apparaat weg en staat hij op de server en op elke andere telefoon nog.
   */
  const wisRegel = await db.outbox
    .filter((r) => r.entity === 'companies' && r.recordId === gemaakt.id && r.op === 'delete')
    .toArray()
  check('en zet een verwijdering in de wachtrij', wisRegel.length === 1,
    String(wisRegel.length))

  /* ---- zoeken ---- */

  const klant = {
    id: 'co_x', name: 'Chemtrans B.V.', contact: 'W. Bakker',
    email: 'w@chemtrans.nl', phone: '0201234567', city: 'Amsterdam',
    contractDiscountPct: 0, updatedAt: 0,
  }
  check('zoeken op naam', pastBijZoek(klant, 'chemtrans'))
  check('op plaats', pastBijZoek(klant, 'amsterdam'))
  check('op contactpersoon', pastBijZoek(klant, 'bakker'))
  check('op een stuk van het mailadres', pastBijZoek(klant, 'chemtrans.nl'))
  check('een lege zoekopdracht laat alles zien', pastBijZoek(klant, '   '))
  check('en iets dat er niet in staat vindt niets', !pastBijZoek(klant, 'zzzz'))

  /* ---- het scherm hangt in het menu ---- */

  const { readFileSync } = await import('node:fs')
  const dash = readFileSync('src/dashboards/management/ManagementDashboard.tsx', 'utf8')

  check('het scherm staat in het managementmenu',
    /key: 'klanten', label: 'Facturatieklanten'/.test(dash))
  check('en wordt ook echt gerenderd',
    dash.includes("{page === 'klanten' && <Klanten"))

  /*
   * Dit was een stille fout: 'klanten' werd omgeleid naar 'personeel'. Wie in
   * de zoekbalk een klant aanklikte, kreeg de personeelslijst te zien met een
   * company-id dat nooit een dossier-id kan zijn -- en dan gebeurde er niets,
   * zonder melding.
   */
  check('en wordt niet meer naar personeel omgeleid',
    !/p === 'klanten' \? 'personeel'/.test(dash))

  const { DASHBOARDS_MET } = await import('../../src/lib/schermen.ts')
  check('de sleutel hoort bij het management',
    (DASHBOARDS_MET.klanten ?? []).includes('management'))
}

/* ==================================================================== *
 *  64. De AI leest een pasje, en wij rekenen het na
 *
 *  Casper: "De ai, kan je die niet gebruiken bij inscannen arbeidsovereenkomst
 *  en id ect? gezien de ocr niet echt lekker werkt."
 *
 *  Het versturen is een paar regels en valt vanzelf op als het stuk is. Het
 *  narekenen niet, en daar zit het hele risico: een model dat een cijfer
 *  verkeerd leest geeft een antwoord dat er precies zo uitziet als een goed
 *  antwoord. Bij OCR wist je dat je moest wantrouwen; bij een model dat in
 *  vloeiende zinnen antwoordt vergeet je het.
 *
 *  Dus gaat alles langs dezelfde drie controles als wat een mens intikt: de
 *  elfproef op het BSN, mod-97 op het IBAN, en de controlecijfers van de MRZ.
 *  Wat daar niet doorheen komt hoort GEEN voorstel te worden.
 *
 *  Dat laatste is wat hier wordt vastgelegd. Een regel die per ongeluk een
 *  ongecontroleerd BSN doorlaat is met het oog niet te zien in een diff.
 * ==================================================================== */

console.log('\n64. De AI leest een pasje, en wij rekenen het na')

{
  const { naarContractUitkomst, naarIdUitkomst } =
    await import('../../src/lib/documentlezen')

  /* De strook uit hoofdstuk 16, waarvan we weten dat hij klopt. */
  const GOED = [
    'P<NLDDE<BRUIJN<<WILLEM<JAN<<<<<<<<<<<<<<<<<<',
    'SPECI20142NLD6503101M2403096999999990<<<<<84',
  ]

  /* ---- een lezing die deugt ---- */

  const goed = naarIdUitkomst({
    mrzRegels: GOED,
    bsn: '111222333',   // komt door de elfproef
    twijfel: [],
  })
  check('een kloppende strook levert een lezing op', !!goed.mrz)
  check('en de naam komt eruit', goed.mrz?.volledigeNaam === 'Willem Jan De Bruijn',
    String(goed.mrz?.volledigeNaam))
  check('een geldig BSN wordt overgenomen', goed.bsn === '111222333')
  check('en er valt niets op te merken', goed.opmerkingen.length === 0,
    JSON.stringify(goed.opmerkingen))

  /* ---- en een die niet deugt ---- */

  /*
   * Eén teken verkeerd in het documentnummer. De MRZ komt er wel uit -- het is
   * een geldige strook -- maar zijn eigen som klopt niet meer. Dat is precies
   * het geval waarvoor die regels worden opgevraagd in plaats van alleen de
   * naam: zonder controlecijfers is een lezing een bewering.
   */
  const scheef = naarIdUitkomst({
    mrzRegels: [GOED[0], GOED[1].replace('SPECI20142', 'SPECI20143')],
    twijfel: [],
  })
  check('een verminkte strook wordt gemeld', scheef.opmerkingen.length > 0)
  check('en de melding noemt de controlecijfers',
    scheef.opmerkingen.some((o) => o.includes('controlecijfers')),
    JSON.stringify(scheef.opmerkingen))

  /*
   * Het BSN is de gevaarlijkste. Een verkeerd cijfer gaat mee de loonaangifte
   * in en komt er maanden later als probleem weer uit.
   */
  const fout = naarIdUitkomst({ mrzRegels: [], bsn: '123456789', twijfel: [] })
  check('een BSN dat de elfproef niet haalt wordt NIET overgenomen',
    fout.bsn === undefined)
  check('maar wel gemeld, met het nummer erbij',
    fout.opmerkingen.some((o) => o.includes('123456789') && o.includes('elfproef')),
    JSON.stringify(fout.opmerkingen))

  check('zonder strook wordt dat gezegd',
    naarIdUitkomst({ mrzRegels: [], twijfel: [] }).opmerkingen
      .some((o) => o.includes('niet gelezen')))

  /* Wat het model zelf niet zeker wist gaat mee naar het scherm. */
  const twijfel = naarIdUitkomst({
    mrzRegels: GOED, twijfel: ['De onderste regel is afgesneden.'],
  })
  check('de twijfel van het model komt erbij te staan',
    twijfel.opmerkingen.includes('De onderste regel is afgesneden.'))

  /* ---- het contract ---- */

  const contract = naarContractUitkomst({
    werknemer: 'W. de Bruijn',
    iban: 'NL91ABNA0417164300',
    bsn: '111222333',
    uren: 38,
    uurloon: 15.5,
    twijfel: [],
  })
  check('een geldig rekeningnummer wordt overgenomen',
    contract.iban === 'NL91ABNA0417164300')
  check('en een geldig BSN ook', contract.bsn === '111222333')
  check('zonder opmerkingen', contract.opmerkingen.length === 0,
    JSON.stringify(contract.opmerkingen))

  const slecht = naarContractUitkomst({ iban: 'NL00FOUT0000000000', twijfel: [] })
  check('een rekeningnummer dat niet klopt wordt niet overgenomen',
    slecht.iban === undefined)
  check('en wel gemeld', slecht.opmerkingen.some((o) => o.includes('NL00FOUT0000000000')))

  /*
   * Terugrekenen is aanvullen, en aanvullen is hier de duurste fout. Een
   * maandloon zonder uurloon blijft een maandloon zonder uurloon -- met een
   * regel erbij zodat degene die het invult weet waarom het veld leeg is.
   */
  const maand = naarContractUitkomst({ maandloon: 2800, uren: 38, twijfel: [] })
  check('een uurloon wordt niet uitgerekend uit een maandloon',
    maand.lezing.uurloon === undefined)
  check('en er staat bij waarom het veld leeg blijft',
    maand.opmerkingen.some((o) => o.includes('niet uitgerekend')),
    JSON.stringify(maand.opmerkingen))
}

/* ==================================================================== *
 *  65. Waar de foto van een paspoort heen mag
 *
 *  Bovenaan src/lib/scannen.ts staat waarom het inlezen op het toestel zelf
 *  gebeurt: "Er gaat geen foto van een paspoort naar een externe partij --
 *  niet naar ons, niet naar een leverancier."
 *
 *  Die belofte wordt met 0080 deels ingeleverd, en dat mag -- de OCR werkt
 *  niet goed genoeg. Maar niet stilzwijgend, en niet verder dan nodig. Wat
 *  hier vastligt is de grens die daarbij is getrokken.
 * ==================================================================== */

console.log('\n65. Waar de foto van een paspoort heen mag')

{
  const { readFileSync } = await import('node:fs')
  const migratie = readFileSync(
    'supabase/migrations/0080_de_ai_leest_ook_een_pasje.sql', 'utf8')
  const functie = readFileSync('supabase/functions/document-lezen/index.ts', 'utf8')
  const lezer = readFileSync('supabase/functions/lezer/index.ts', 'utf8')

  check('de standaard is de eigen machine, niet de cloud',
    /'ai_documenten', 'lokaal'/.test(migratie))

  /*
   * Dit is het besluit dat ertoe doet. Bij de facturen bestaat
   * "lokaal-terugval": lukt het lokaal niet, dan doet Claude het alsnog. Die
   * stand hoort hier NIET te bestaan -- een paspoort gaat niet naar de andere
   * kant van de oceaan omdat er een pc uit stond.
   */
  check('er is geen terugval van lokaal naar Claude',
    !functie.includes("'lokaal-terugval'") || functie.includes('bij een document is er geen terugval'))
  check('en de migratie zegt dat met zoveel woorden',
    migratie.includes('GEEN terugval'))

  /* De deur: dezelfde grens als het dossier zelf (0056, 0074). */
  check('alleen wie personeelsdossiers mag inzien komt erlangs',
    functie.includes('magDossiers') && functie.includes("rollen.includes('management')"))
  check('en een ingetrokken recht wint',
    functie.includes("ingetrokken.includes('staff.view')"))

  /*
   * De foto blijft niet staan. Niet tot de opruimer langskomt, maar tot het
   * antwoord er is -- ook als het mislukte.
   */
  check('de foto wordt gewist zodra het antwoord er is',
    /plaatjes: null/.test(lezer))

  /* En er staat een grens op wat je erin kunt duwen. */
  check('er is een grens aan het aantal afbeeldingen',
    functie.includes('MAX_PLAATJES'))
  check('en aan de omvang', functie.includes('MAX_TEKENS'))

  /*
   * En de opdracht moet bij een model met ogen terechtkomen.
   *
   * De server vraagt om ai_lokaal_model, en bij die instelling staat met
   * zoveel woorden dat hij geen plaatjes hoeft te kunnen lezen (0051) -- tot
   * 0080 ging er nooit beeld langs die lus. Een model zonder ogen negeert de
   * afbeelding stilzwijgend en antwoordt op het prompt alleen: geen fout,
   * maar een lezing die nergens op slaat.
   */
  const machine = readFileSync('lezer/lezer.mjs', 'utf8')
  check('een opdracht met een foto gaat naar het beeldmodel',
    machine.includes('metBeeld && process.env.LEZER_MODEL_BEELD'))
  check('en de plaatjes gaan ook echt mee naar Ollama',
    machine.includes("{ role: 'user', content: gebruiker, images: plaatjes }"))

  /* De leesmotor op het toestel blijft bestaan; dit is de tweede poging. */
  const scannen = readFileSync('src/lib/scannen.ts', 'utf8')
  check('het lezen op het toestel zelf blijft staan',
    scannen.includes('scanIdentiteitsbewijs'))
  const client = readFileSync('src/lib/documentlezen.ts', 'utf8')
  check('en de nieuwe weg zegt zelf dat hij ernaast staat',
    client.includes('staat NAAST scannen.ts'))
}
/* ==================================================================== *
 *  Wat er op een afgemeld toestel achterblijft (0114)
 *
 *  In personeelsdossier.md stond: "Uitloggen wist ze (dat is getest)."
 *  Allebei niet waar. forgetEverything() bestond wel, maar werd nergens
 *  aangeroepen -- nul verwijzingen in de hele src. En er was geen test.
 *
 *  Het besluit om BSN's naar het toestel te laten synchroniseren is dus
 *  genomen op een aanname die niet klopte.
 *
 *  Uitloggen wist nu het dossier, en alleen het dossier. De rest van de
 *  cache blijft staan, want daar draait offline inloggen op en dat is wat
 *  een tablet in de wasstraat nodig heeft. Dit hoofdstuk bewaakt allebei
 *  de helften: wat weg moet gaat weg, wat blijven moet blijft staan.
 * ==================================================================== */

console.log('\n77. Wat er op een afgemeld toestel achterblijft')

{
  const { readFileSync } = await import('node:fs')
  const { vergeetDossiergegevens } = await import('../../src/lib/offlineAuth.ts')

  await db.personnelPrivate.put({ id: 'pp_77', userId: 'u_77', bsn: '123456782' } as never)
  await db.personnelLoon.put({ id: 'pl_77', userId: 'u_77', iban: 'NL00BANK0123456789' } as never)
  await db.documents.put({ id: 'doc_77', userId: 'u_77', kind: 'identiteitsbewijs' } as never)
  await db.changeRequests.put({ id: 'cr_77', userId: 'u_77', status: 'open' } as never)
  await db.sollicitaties.put({ id: 'so_77', status: 'nieuw' } as never)

  /* Iets wat juist NIET weg mag: daar hangt offline werken aan. */
  await db.washJobs.put({ id: 'wj_77', plate: 'BX-JT-42', status: 'open' } as never)

  await vergeetDossiergegevens()

  check('het afgeschermde dossier is weg', (await db.personnelPrivate.count()) === 0)
  check('het rekeningnummer ook',          (await db.personnelLoon.count()) === 0)
  check('de dossierstukken ook',           (await db.documents.count()) === 0)
  check('de wijzigingsverzoeken ook',      (await db.changeRequests.count()) === 0)
  check('en de sollicitaties ook',         (await db.sollicitaties.count()) === 0)

  /*
   * Dit is de andere helft. Zou hier ooit forgetEverything() komen te staan,
   * dan werkt offline inloggen niet meer en merkt niemand dat tot er een
   * tablet in een wasstraat zonder bereik staat.
   */
  check('maar de wasbeurten blijven staan, anders werkt offline niet meer',
    (await db.washJobs.get('wj_77')) !== undefined)

  /* --- en het wordt ook echt aangeroepen --- */

  const auth = readFileSync('src/store/useAuth.ts', 'utf8')
  /* Vanaf de implementatie, niet vanaf de regel in de interface erboven. */
  const vanaf = auth.indexOf('logout: async')
  const uitloggen = auth.slice(vanaf, auth.indexOf('chooseRole:', vanaf))
  check('uitloggen roept het aan', uitloggen.includes('vergeetDossiergegevens()'))

  /*
   * En bij het wisselen van gebruiker op hetzelfde toestel. Zonder dit bleef
   * het dossier van de vorige staan zodra iemand anders inlogde -- dezelfde
   * fout, maar dan zonder dat er ook maar iemand uitgelogd was.
   */
  const wisselen = auth.slice(auth.indexOf('async function prepareCacheFor'),
    auth.indexOf('export const useAuth'))
  check('en inloggen als iemand anders ook', wisselen.includes('vergeetDossiergegevens()'))
}

}
