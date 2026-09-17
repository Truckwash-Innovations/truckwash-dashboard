/**
 * De post: werkadressen, postvakken, documenten en handtekeningen
 *
 * Onderdeel van de zelftest; zie scripts/selftest.ts voor hoe dit draait en
 * waarom het is opgesplitst.
 */

import { api, check, db, eq, zonderCommentaar } from './kern.ts'

export async function groepen() {

/* ==================================================================== *
 *  105. Waarom een mail niet aankwam, staat niet alleen in het logboek
 *
 *  Casper: "Geen enkele timer is goed gelukt, geen enkele mail is
 *  verzonden??"
 *
 *  Dat was niet te beantwoorden zonder te wachten tot er vanzelf iets werd
 *  verstuurd. Resend weigert stil -- een domein dat daar niet geverifieerd
 *  is levert geen foutmelding in de app op maar een regel in email_log, en
 *  die staat er pas nadat er iets is geprobeerd.
 *
 *  Twee dingen moesten daarvoor kloppen: de reden moet uit de serverfunctie
 *  terugkomen (hij stond alleen in het logboek), en er moet een knop zijn die
 *  het probeert.
 * ==================================================================== */

/* ==================================================================== *
 *  106. Een roosterwijziging die geen mail stuurt, zegt dat ook
 *
 *  Casper: "Bij wijzigen rooster ect, hij stuurt bij veranderingen geen
 *  emails meer? wat wel moet..."
 *
 *  De keten is heel: shifts.update roept meldRooster aan, die stuurt een
 *  melding met mail: true. Maar de mail gaat met `void mailBericht(...)` de
 *  deur uit -- niet op wachten, want de bel in de app is al gegaan. Gaat hij
 *  mis, dan gebeurt er verder niets.
 *
 *  Intussen bewaarde lib/mail.ts de laatste reden allang, met een functie
 *  eromheen om hem op te vragen. Die werd nergens aangeroepen.
 *
 *  Twee dingen leggen we hier vast: dat de keten heel blijft, en dat wat de
 *  app weet ook ergens te zien is.
 * ==================================================================== */

console.log('\n106. Een roosterwijziging die geen mail stuurt, zegt dat ook')

{
  const { readFileSync } = await import('node:fs')
  const repo = readFileSync('src/lib/repo.ts', 'utf8')

  /* ---- de keten zelf ---- */

  check('een roosterwijziging meldt het aan de betrokkene',
    /shifts = \{[\s\S]*?async update[\s\S]{0,900}meldRooster\(bijgewerkt/.test(repo),
    'een gewijzigde dienst stuurt geen bericht meer')

  check('en die melding vraagt om een mail',
    /async function meldRooster[\s\S]{0,1400}mail: true/.test(repo),
    'de melding blijft in de app hangen')

  /*
   * Twee gevallen waarin er met opzet GEEN mail gaat, en die horen hier te
   * staan -- anders wordt de volgende die dit leest gek van "hij doet het
   * soms wel en soms niet".
   */
  check('wie zijn eigen dienst wijzigt krijgt geen mail van zichzelf',
    /async function meldRooster[\s\S]{0,400}if \(door\.id === shift\.userId\) return/.test(repo),
    'je mailt jezelf over je eigen wijziging')

  check('en een bijgestelde opmerking is geen wijziging',
    /const raakt =[\s\S]{0,300}patch\.startAt[\s\S]{0,200}patch\.endAt[\s\S]{0,200}patch\.kind/.test(repo),
    'elke komma in een notitie levert een mail op')

  /* ---- en wat er misgaat komt in beeld ---- */

  const lib = readFileSync('src/lib/mail.ts', 'utf8')
  const post = readFileSync('src/dashboards/developer/Post.tsx', 'utf8')

  check('de app onthoudt waarom er geen post uitging',
    lib.includes('export function laatsteMailFout'),
    'de reden verdwijnt in de console')

  check('en laat dat ergens zien',
    post.includes('laatsteMailFout()'),
    'de app weet het en zegt het tegen niemand')

  check('post die op verzending wacht staat er ook',
    post.includes('wachtendePost()'),
    'mail die zonder bereik is opgesteld blijft onzichtbaar wachten')
}

console.log('\n105. Waarom een mail niet aankwam')

{
  const { readFileSync } = await import('node:fs')
  const fn = readFileSync('supabase/functions/stuur-mail/index.ts', 'utf8')

  /* ---- de reden komt mee terug ---- */

  check('versturen geeft de reden terug, niet alleen ja of nee',
    /async function verstuur\([\s\S]{0,400}Promise<\{ ok: boolean; fout: string \| null \}>/.test(fn),
    'de aanroeper kan alleen "het lukte niet" zeggen')

  check('en de vrije mail geeft hem door aan het scherm',
    /sent: uit\.ok \? 1 : 0, reden: uit\.fout/.test(fn),
    'de reden blijft in het logboek hangen')

  /*
   * En hij wordt nog steeds vastgelegd. Dat is waar email_log voor is; de
   * reden meesturen is een aanvulling, geen vervanging -- anders is een
   * mislukte mail weg zodra het tabblad dicht gaat.
   */
  check('en hij wordt nog steeds vastgelegd',
    fn.includes("status: ok ? 'verstuurd' : 'mislukt'") && fn.includes('error: fout ?? null'),
    'een mislukte mail verdwijnt als niemand kijkt')

  /* ---- en er is een knop die het probeert ---- */

  const post = readFileSync('src/dashboards/developer/Post.tsx', 'utf8')

  check('er is een proefmail op het postscherm',
    post.includes('mailVrij(') && post.includes('Stuur een proefmail'),
    'je kunt alleen wachten tot er vanzelf iets wordt verstuurd')

  /*
   * Naar je eigen adres, en niet naar een vrij in te tikken adres. Dit is een
   * proef of de keten werkt, geen manier om post te versturen -- en een
   * invoerveld zou van dit scherm het tweede mailprogramma maken.
   */
  check('naar je eigen adres, niet naar een vrij veld',
    post.includes('ik?.email') && !/proefAdres|setProefAdres/.test(post),
    'er staat een adresveld bij de proefmail')

  check('en de reden komt woordelijk in beeld',
    /uit\.reden \|\| uit\.skipped/.test(post),
    'het scherm verzint zijn eigen samenvatting')

  /* ---- de mailregels van de app kennen dat veld ---- */

  const lib = readFileSync('src/lib/mail.ts', 'utf8')
  check('het antwoord van de mailfunctie draagt de reden',
    /reden\?: string \| null/.test(lib),
    'het veld bestaat niet in de app')
}

/* ==================================================================== *
 *  66. Het werkadres komt ernaast, niet ervoor in de plaats
 *
 *  Casper: "voor werknemers moet ik een soort microsoft 365 kunnen
 *  aanklikken (...) De communicatie moet wel nog naar hun persoonlijke mail."
 *
 *  Die tweede zin is een eis en geen bijzin. Zou een melding naar het
 *  werkadres gaan, dan komt de uitnodiging om dat postvak te openen ín dat
 *  postvak terecht -- en het wachtwoord om erbij te komen ook. Een kring waar
 *  niemand in komt, en die pas opvalt bij de eerste medewerker die hem nodig
 *  heeft.
 *
 *  De verleiding om dit "netjes" te maken zodra de postvakken werken is groot.
 *  Dit hoofdstuk staat er om dat tegen te houden.
 * ==================================================================== */

console.log('\n66. Het werkadres komt ernaast, niet ervoor in de plaats')

{
  const { readFileSync } = await import('node:fs')

  /*
   * De drie plekken die een mens aanschrijven over iets waar hij nog niet bij
   * kan: de takenmail, de uitnodiging en het wachtwoord. Alle drie horen het
   * privéadres te nemen.
   */
  const bijwerken = readFileSync('supabase/bijwerken.sql', 'utf8')
  const takenmail = bijwerken.slice(bijwerken.indexOf('function public.taken_voor_mail'))
    .slice(0, 4000)
  check('de takenmail leest het privéadres',
    takenmail.includes('p.email'))
  check('en niet het werkadres', !takenmail.includes('werk_email'))

  for (const functie of ['nodig-uit', 'wachtwoord-vergeten']) {
    const bron = readFileSync(`supabase/functions/${functie}/index.ts`, 'utf8')
    check(`${functie} kijkt niet naar het werkadres`, !bron.includes('werk_email'))
  }

  /* --- en aan de kant van de app --- */

  const werkmail = readFileSync('src/lib/werkmail.ts', 'utf8')
  check('er is één plek die zegt waar een melding heen gaat',
    werkmail.includes('export function meldadresVan'))
  check('en die geeft het privéadres', /return gebruiker\.email/.test(werkmail))

  const { meldadresVan } = await import('../../src/lib/werkmail')
  check('ook als er een werkadres is',
    meldadresVan({ email: 'prive@gmail.com' } as never) === 'prive@gmail.com')

  /*
   * Het adres wordt door de server bedacht en niet door het scherm. Twee
   * schermen die tegelijk een Jan aanzetten stellen allebei jan@ voor; de
   * database kijkt in dezelfde transactie wat vrij is.
   */
  check('het adres komt van de database',
    werkmail.includes("rpc('werkadres_voorstel'"))
  check('en het scherm verzint er zelf geen',
    !werkmail.includes("'@' +") && !werkmail.includes('`@${'))

  /*
   * Een uitgedeeld adres blijft van die persoon, ook als het postvak dichtgaat.
   * Post die daarna nog binnenkomt hoort niet bij de volgende Jan te belanden.
   */
  check('het adres blijft staan als het postvak uit gaat',
    werkmail.includes('werkEmail: adres'))

  /* En de rem op profiles kent de nieuwe kolommen -- dezelfde val als 0021. */
  check('je eigen werkadres staat in de rem',
    /new\.werk_email\s*:=\s*old\.werk_email/.test(bijwerken))
  check('en het aan-uitvinkje ook',
    /new\.werk_mail_aan\s*:=\s*old\.werk_mail_aan/.test(bijwerken))
}

/* ==================================================================== *
 *  67. Je verstuurt vanaf je eigen adres
 *
 *  Dit is de enige controle in dit hoofdstuk die er echt toe doet, en hij is
 *  met het oog niet te zien in een diff.
 *
 *  Een functie die de afzender uit het verzoek overneemt, is een functie
 *  waarmee iedere ingelogde medewerker post kan sturen namens de directeur --
 *  op het echte bedrijfsdomein, met een geldige handtekening eronder, want
 *  SPF en DKIM kloppen gewoon. De ontvanger kan er niets aan zien. Dat is
 *  geen foutje maar een gereedschap voor fraude.
 *
 *  Het adres komt daarom uit het dossier van degene die belt, en er is geen
 *  manier om het mee te geven.
 * ==================================================================== */

console.log('\n67. Je verstuurt vanaf je eigen adres')

{
  const { readFileSync } = await import('node:fs')
  const server = readFileSync('supabase/functions/werkmail/index.ts', 'utf8')
  const client = readFileSync('src/lib/werkpost.ts', 'utf8')

  /*
   * Sinds 0084 kan er ook namens een gedeeld postvak verstuurd worden, en
   * daarmee is de afzender niet meer één regel maar een keuze. De regel
   * eronder is niet veranderd en wordt hier op de nieuwe vorm nagerekend:
   * het adres komt uit het dossier of uit de database, nooit uit het verzoek.
   */
  check('de afzender komt uit het dossier van de beller',
    /let vanAdres = beller\.werkEmail/.test(server))
  check('of uit het gedeelde postvak dat de server zelf opzoekt',
    server.includes('vanAdres = String(vak.adres)'))
  check('en nooit uit het verzoek',
    !/from:\s*(String\()?lijf\./.test(server)
    && !server.split('\n').some((r) =>
      /van(Adres|Naam)\s*=/.test(r) && r.includes('lijf.')))

  /*
   * Wat het verzoek WEL mag meegeven is een id. Dat is het hele verschil:
   * een id moet eerst in de database worden teruggevonden, en daar wordt
   * meteen gekeken of de beller er lid van is. Een adres zou zo het
   * from-veld in lopen.
   */
  check('wat het verzoek meegeeft is een id en geen adres',
    server.includes(".eq('id', vanafVak)"))
  check('en het lidmaatschap wordt nagekeken vóór het adres wordt overgenomen',
    server.indexOf("from('postbus_lid')") > 0
    && server.indexOf("from('postbus_lid')") < server.indexOf('vanAdres = String(vak.adres)'))
  /*
   * En de vorm die de deur uit gaat kent geen afzender. Op het commentaar
   * zoeken zou hier geen controle zijn -- het woord "afzender" staat er drie
   * keer in, in uitleg. Dit kijkt naar het enige dat telt: wat NieuwBericht
   * mag bevatten.
   */
  const vorm = client.slice(client.indexOf('export interface NieuwBericht'),
    client.indexOf('}', client.indexOf('export interface NieuwBericht')))
  check('de vorm van een nieuw bericht kent geen afzender',
    !/(van|from|afzender)\??:/.test(vorm), vorm.replace(/\s+/g, ' ').slice(0, 120))

  /*
   * Een postvak dat dicht staat verstuurt niets. Anders is "sluiten" alleen
   * het stoppen van de inkomende post, en kan iemand die weg is nog steeds
   * namens het bedrijf mailen.
   */
  check('een gesloten postvak mag niet versturen',
    server.includes("profiel.werk_mail_aan !== true"))
  check('en wie geen adres heeft ook niet',
    server.includes('!profiel.werk_email'))

  /* Een uitgeschreven medewerker al helemaal niet. */
  check('een uitgeschreven medewerker komt er niet langs',
    server.includes('profiel.archived_at'))

  /* ---- ordenen en antwoorden ---- */

  const { antwoordOp, doorsturen, inMap, zoekIn } =
    await import('../../src/lib/werkpost')

  const mail = (extra: Record<string, unknown> = {}) => ({
    id: 'wm1', userId: 'u1', richting: 'in', map: 'postvak',
    van: 'klant@bedrijf.nl', vanNaam: 'Van Dijk',
    aan: ['jan@truckwash1group.nl'], cc: [],
    onderwerp: 'Offerte', tekst: 'Kan dat dinsdag?',
    at: 1_700_000_000_000, bijlagen: [], updatedAt: 1,
    ...extra,
  } as never)

  const antwoord = antwoordOp(mail())
  check('antwoorden gaat naar de afzender',
    antwoord.aan.join() === 'klant@bedrijf.nl')
  check('en het onderwerp krijgt Re: ervoor', antwoord.onderwerp === 'Re: Offerte')
  check('maar niet twee keer',
    antwoordOp(mail({ onderwerp: 'Re: Offerte' })).onderwerp === 'Re: Offerte')
  check('de oorspronkelijke tekst staat eronder, aangehaald',
    antwoord.tekst.includes('> Kan dat dinsdag?'))

  /*
   * Antwoorden op iets dat JIJ hebt verstuurd gaat naar de ontvanger en niet
   * naar jezelf. Kleine zaak, maar een postvak waarin "antwoorden" je eigen
   * adres invult is een postvak waar niemand op vertrouwt.
   */
  const eigen = antwoordOp(mail({
    richting: 'uit', van: 'jan@truckwash1group.nl', aan: ['klant@bedrijf.nl'],
  }))
  check('antwoorden op eigen post gaat naar de ontvanger',
    eigen.aan.join() === 'klant@bedrijf.nl')

  check('doorsturen laat de ontvanger leeg',
    doorsturen(mail()).aan.length === 0)
  check('en zet de oorspronkelijke gegevens erboven',
    doorsturen(mail()).tekst.includes('Doorgestuurd bericht'))

  /* ---- zoeken en mappen ---- */

  const post = [
    mail({ id: 'a', onderwerp: 'Offerte', map: 'postvak' }),
    mail({ id: 'b', onderwerp: 'Factuur', map: 'archief' }),
    mail({ id: 'c', onderwerp: 'Vraag', map: 'postvak', tekst: 'over de offerte' }),
  ]
  check('een map toont alleen zijn eigen post', inMap(post, 'postvak').length === 2)
  check('zoeken kijkt in het onderwerp én in de tekst',
    zoekIn(post, 'offerte').length === 2, String(zoekIn(post, 'offerte').length))
  check('en in de afzender', zoekIn(post, 'van dijk').length === 3)
}

/* ==================================================================== *
 *  68. Een document schrijven, en er een PDF van maken
 *
 *  De PDF wordt met de hand geschreven (src/lib/pdfmaken.ts), en daar zit
 *  precies één soort fout in die je niet ziet en niet kunt debuggen: de
 *  xref-tabel. Dat is een lijst byteposities waarmee een lezer de objecten
 *  terugvindt. Wijst er één een byte te ver, dan weigert Acrobat het hele
 *  bestand met "damaged" -- niet die ene alinea, het hele stuk.
 *
 *  De valkuil daarbij is UTF-8. De posities worden geteld terwijl de tekst
 *  nog een string is, dus in TEKENS; zodra één teken twee bytes wordt,
 *  schuift alles erna op. Vandaar dat er hier op wordt gestaan dat er geen
 *  byte boven 127 in het bestand voorkomt: een accent en een liggend
 *  streepje horen als octale ontsnapping mee te gaan en niet als teken.
 *
 *  Die twee dingen -- de posities kloppen, en alles is ASCII -- zijn met het
 *  oog niet na te kijken en met een test in twee regels.
 * ==================================================================== */

console.log('\n68. Een document schrijven, en er een PDF van maken')

{
  const { breedte, breekAf, maakPdf, nummering } =
    await import('../../src/lib/pdfmaken')
  const {
    alsBlokken, alsHtml, alsTekst, bestandsnaam, haalWeg, nieuwBlok,
    verplaats, voegToe, zetSoort, zetTekst,
  } = await import('../../src/lib/documentmaken')

  /* ---- regelafbreking ---- */

  const RUIMTE = 200
  const lap = 'De wasstraat in Aalsmeer is op werkdagen geopend van zeven uur '
    + "'s ochtends tot zeven uur 's avonds, en op zaterdag tot drie uur."
  const regels = breekAf(lap, 10.5, false, RUIMTE)

  check('een lange regel wordt opgebroken', regels.length > 1, String(regels.length))
  check('en geen enkele regel loopt buiten de bladspiegel',
    regels.every((r) => breedte(r, 10.5, false) <= RUIMTE),
    regels.map((r) => Math.round(breedte(r, 10.5, false))).join(' '))
  check('er gaat geen woord verloren',
    regels.join(' ').replace(/\s+/g, ' ') === lap.replace(/\s+/g, ' '))

  /*
   * Eén woord dat in zijn eentje te lang is. Dat is lelijk om hard af te
   * breken en het alternatief is erger: een regel die buiten het papier
   * doorloopt en bij het printen wordt afgesneden zonder dat iemand het op
   * het scherm heeft gezien.
   */
  const url = 'https://truckwash1group.nl/vestigingen/aalsmeer/openingstijden'
  const gehakt = breekAf(url, 10.5, false, 100)
  check('een woord dat alleen al te lang is wordt hard afgebroken',
    gehakt.length > 1 && gehakt.every((r) => breedte(r, 10.5, false) <= 100))
  check('en er raakt ook daar niets kwijt', gehakt.join('') === url)

  check('een eigen regeleinde blijft een regeleinde',
    breekAf('een\ntwee\ndrie', 10.5, false, 400).length === 3)
  check('vet is breder dan gewoon',
    breedte('Openingstijden', 11, true) > breedte('Openingstijden', 11, false))

  /* ---- de PDF zelf ---- */

  const blokken = [
    nieuwBlok('kop1', 'Protocol wasstraat'),
    nieuwBlok('alinea', 'Geldig vanaf 1 oktober — voor álle vestigingen.'),
    nieuwBlok('streep', ''),
    nieuwBlok('kop2', 'Voorbereiding'),
    nieuwBlok('punt', 'Controleer de doseerpomp.'),
    nieuwBlok('genummerd', 'Zet de hoofdkraan open.'),
    nieuwBlok('genummerd', 'Start het spoelprogramma.'),
    nieuwBlok('wit', ''),
    nieuwBlok('alinea', lap),
  ]

  const bytes = maakPdf({ titel: 'Protocol', blokken, voet: 'Truckwash 1 Group' })
  const rauw = Buffer.from(bytes).toString('latin1')

  check('het bestand begint als een PDF', rauw.startsWith('%PDF-'))
  check('en eindigt netjes', rauw.trimEnd().endsWith('%%EOF'))

  /*
   * Geen enkele byte boven 127.
   *
   * Dit is de controle waar het om gaat. Zou er een accent als UTF-8 in staan,
   * dan is dat twee bytes waar de teller er één heeft geteld, en wijst elke
   * xref-positie daarna een byte te vroeg. Het bestand ziet er dan nog
   * normaal uit en gaat bij de lezer niet open.
   */
  const hoog = bytes.findIndex((b) => b > 127)
  check('alles gaat als ASCII de deur uit', hoog < 0,
    hoog < 0 ? '' : `byte ${bytes[hoog]} op ${hoog}`)
  check('een accent gaat mee als octale ontsnapping', rauw.includes('\\341'))
  check('en een liggend streepje ook', rauw.includes('\\227'))

  /* En dan de posities zelf nakijken, precies zoals een lezer dat doet. */
  const na = rauw.lastIndexOf('startxref')
  const begin = Number(rauw.slice(na).split('\n')[1])
  const tabel = rauw.slice(begin)
  const posities = [...tabel.matchAll(/^(\d{10}) \d{5} n /gm)].map((m) => Number(m[1]))

  check('de xref-tabel noemt elk object', posities.length >= 5, String(posities.length))
  const misser = posities.findIndex(
    (p, i) => !rauw.slice(p).startsWith(`${i + 1} 0 obj`))
  check('en elke positie wijst op zijn eigen object', misser < 0,
    misser < 0 ? '' : `object ${misser + 1} zou op ${posities[misser]} staan`)

  /* ---- meer dan één bladzijde ---- */

  const veel = Array.from({ length: 120 }, (_, i) =>
    nieuwBlok('alinea', `Regel ${i + 1}. ${lap}`))
  const dik = Buffer.from(maakPdf({ titel: 'Lang stuk', blokken: veel })).toString('latin1')
  const telling = Number(/\/Count (\d+)/.exec(dik)?.[1] ?? 0)

  check('een lang stuk loopt door op een volgende bladzijde', telling > 1, String(telling))
  check("en het aantal pagina's klopt met wat erin staat",
    (dik.match(/\/Type \/Page[^s]/g) ?? []).length === telling)
  check('onderaan staat welke bladzijde het is', dik.includes(`(1 van ${telling})`))
  check('en de voettekst staat er alleen als hij is meegegeven',
    !dik.includes('Truckwash 1 Group') && rauw.includes('Truckwash 1 Group'))

  /* ---- nummeren ---- */

  const reeks = nummering([
    nieuwBlok('genummerd', 'een'),
    nieuwBlok('genummerd', 'twee'),
    nieuwBlok('alinea', 'tussendoor'),
    nieuwBlok('genummerd', 'weer een'),
  ])
  check('een genummerde lijst telt door', reeks[0] === 1 && reeks[1] === 2)
  check('en begint opnieuw na een alinea ertussen',
    reeks[2] === 0 && reeks[3] === 1, reeks.join(','))

  /* ---- de blokken ---- */

  const rommel = alsBlokken([
    null,
    'gewoon een string',
    { soort: 'bestaat-niet', tekst: 'weg hiermee' },
    { soort: 'alinea' },
    { id: 'x', soort: 'kop1', tekst: 'Dit blijft' },
  ])
  check('wat geen blok is valt weg', rommel.length === 2, String(rommel.length))
  check('een blok zonder tekst krijgt een lege tekst', rommel[0].tekst === '')
  check('en een blok zonder id krijgt er een', Boolean(rommel[0].id))
  check('een kolom die geen lijst is geeft een lege lijst',
    alsBlokken(null).length === 0 && alsBlokken({ soort: 'alinea' }).length === 0)

  /*
   * Nooit tot nul. Een document zonder blokken geeft een scherm zonder
   * invoervelden, en dan is er geen manier meer om er iets in te typen.
   */
  const een = [nieuwBlok('alinea', 'de laatste')]
  check('het laatste blok weghalen laat er een leeg blok staan',
    haalWeg(een, een[0].id).length === 1)
  check('en dat is niet meer de oude', haalWeg(een, een[0].id)[0].tekst === '')

  const drie = [nieuwBlok('alinea', 'a'), nieuwBlok('alinea', 'b'), nieuwBlok('alinea', 'c')]
  check('omhoog aan de bovenkant doet niets',
    verplaats(drie, drie[0].id, -1) === drie)
  check('omlaag aan de onderkant ook niet',
    verplaats(drie, drie[2].id, 1) === drie)
  check('en ertussenin wisselt hij van plek',
    verplaats(drie, drie[1].id, -1).map((b) => b.tekst).join('') === 'bac')

  check('een nieuw blok komt achter het blok waar je stond',
    voegToe(drie, drie[0].id, nieuwBlok('alinea', 'x')).map((b) => b.tekst).join('') === 'axbc')
  check('en zonder plek onderaan',
    voegToe(drie, undefined, nieuwBlok('alinea', 'x')).map((b) => b.tekst).join('') === 'abcx')

  /*
   * Een nieuwe lijst terug en niet dezelfde. React vergelijkt op verwijzing;
   * een lijst die je ter plekke wijzigt ziet er voor hem hetzelfde uit, en
   * dan blijft het scherm staan terwijl de tekst allang veranderd is.
   */
  const gewijzigd = zetTekst(drie, drie[0].id, 'nieuw')
  check('wijzigen geeft een nieuwe lijst terug', gewijzigd !== drie)
  check('en laat de oude met rust', drie[0].tekst === 'a')
  check('de soort wijzigen ook',
    zetSoort(drie, drie[0].id, 'kop1')[0].soort === 'kop1' && drie[0].soort === 'alinea')

  check('witregels en strepen tellen niet mee in de tekst',
    !alsTekst(blokken).includes('\n\n') && alsTekst(blokken).includes('Protocol wasstraat'))

  /* ---- printen ---- */

  const html = alsHtml('Protocol', [
    nieuwBlok('alinea', '<script>alert(1)</script> & "aanhalingstekens"'),
    nieuwBlok('punt', 'een'),
    nieuwBlok('punt', 'twee'),
    nieuwBlok('genummerd', 'drie'),
  ])
  check('een stukje HTML in de tekst blijft tekst',
    !html.includes('<script>') && html.includes('&lt;script&gt;'))
  check('en een ampersand ook', html.includes('&amp;'))
  check('twee punten onder elkaar worden één lijst',
    (html.match(/<ul>/g) ?? []).length === 1 && (html.match(/<li>/g) ?? []).length === 3)
  check('en een genummerde regel begint een eigen lijst', html.includes('<ol>'))

  check('de bestandsnaam houdt geen rare tekens over',
    bestandsnaam('Protocol: wasstraat/2026 *definitief*') === 'Protocol wasstraat2026 definitief.pdf',
    bestandsnaam('Protocol: wasstraat/2026 *definitief*'))
  check('en een naam die niets overhoudt wordt niet leeg',
    bestandsnaam('///') === 'document.pdf')
}

/* ==================================================================== *
 *  69. De handtekening onder een mail
 *
 *  Twee dingen worden hier vastgelegd, en het tweede is het belangrijkste.
 *
 *  1. Wat er niet bekend is, laat geen gat achter. Een handtekening met een
 *     losse " · " erachter of een lege regel middenin is precies het soort
 *     slordigheid waar een klant naar kijkt en wij niet.
 *
 *  2. De handtekening wordt ÉÉN keer voorgesteld en is daarna van die
 *     persoon. De verleiding om hem bij elke mail opnieuw uit te rekenen is
 *     groot -- dan staat er altijd de laatste functie in -- en dan kan
 *     niemand hem meer aanpassen. Dat is geen smaakkwestie: wie hem niet mag
 *     wijzigen typt zijn eigen groet erboven, en dan staat er twee keer een
 *     afsluiting onder elke mail.
 * ==================================================================== */

console.log('\n69. De handtekening onder een mail')

{
  const { standaardHandtekening } = await import('../../src/lib/handtekening')
  const { zetWerkmail, zetHandtekening } = await import('../../src/lib/werkmail')
  const { BEDRIJF } = await import('../../src/lib/types')

  /* ---- de tekst ---- */

  const vol = standaardHandtekening({
    naam: 'Jan van Dijk',
    functie: 'Vestigingsmanager',
    vestiging: 'Truckwash Venlo',
    werkEmail: 'jan@truckwash1group.nl',
    telefoon: '06 12345678',
  })

  check('hij begint met de groet', vol.startsWith('Met vriendelijke groet,\n\n'))
  check('daarna de naam', vol.split('\n')[2] === 'Jan van Dijk')
  check('de functie en de vestiging staan op één regel',
    vol.includes('Vestigingsmanager · Truckwash Venlo'))
  check('en het bedrijf eronder', vol.includes(BEDRIJF))
  check('met het adres en het nummer erbij',
    vol.includes('jan@truckwash1group.nl') && vol.includes('06 12345678'))

  /*
   * Een tussenvoegsel blijft staan. Elke poging om uit één naamveld een
   * voor- en achternaam te halen gaat hier de mist in -- "Jan Dijk" is een
   * andere meneer.
   */
  check('een tussenvoegsel blijft in de naam',
    standaardHandtekening({ naam: 'Jan van Dijk' }).includes('Jan van Dijk'))
  check('en dubbele spaties worden opgeruimd',
    standaardHandtekening({ naam: '  Jan   van  Dijk ' }).includes('\nJan van Dijk\n'))

  /* ---- wat er niet is, laat geen gat achter ---- */

  const kaal = standaardHandtekening({ naam: 'Piet' })
  check('zonder functie en vestiging staat er geen scheidingsteken',
    !kaal.includes('·'), kaal.replace(/\n/g, ' | '))
  check('en zonder adres geen lege regel onderaan',
    !kaal.endsWith('\n') && kaal.split('\n').filter((r) => r === '').length === 1,
    JSON.stringify(kaal))
  check('het eindigt dan op de bedrijfsnaam', kaal.endsWith(BEDRIJF))

  const alleenVestiging = standaardHandtekening({ naam: 'Piet', vestiging: 'Truckwash Ede' })
  check('alleen een vestiging geeft ook geen los scheidingsteken',
    alleenVestiging.includes('Truckwash Ede') && !alleenVestiging.includes('·'))

  const alleenTelefoon = standaardHandtekening({ naam: 'Piet', telefoon: '0612' })
  check('alleen een telefoonnummer krijgt wel zijn eigen blok',
    alleenTelefoon.endsWith('\n\n0612'))

  /* ---- hij wordt één keer gezet en daarna met rust gelaten ---- */

  const { db } = await import('../../src/lib/db')

  const proef = {
    id: 'u_handtekening', email: 'proef@prive.nl', password: '', name: 'Sanne de Wit',
    roles: ['employee'], active: true, updatedAt: Date.now(),
    function: 'Wasmedewerker', werkEmail: 'sanne@truckwash1group.nl',
  }
  await db.users.put(proef as never)

  const aan = await zetWerkmail(proef as never, true)
  check('bij het aanzetten komt er een handtekening',
    (aan.mailHandtekening ?? '').includes('Sanne de Wit'),
    String(aan.mailHandtekening).slice(0, 40))
  check('met de functie uit het dossier erin',
    (aan.mailHandtekening ?? '').includes('Wasmedewerker'))

  /*
   * En dan de regel waar het om gaat. Wie zijn handtekening aanpast en zijn
   * postvak daarna uit- en weer aanzet, hoort zijn eigen tekst terug te
   * krijgen. Zou hij hier overschreven worden, dan is elke aanpassing er een
   * die je zomaar kwijt bent -- en dat merk je pas nadat de mail weg is.
   */
  const eigen = await zetHandtekening(aan, 'Groet, Sanne')
  check('je kunt hem zelf wijzigen', eigen.mailHandtekening === 'Groet, Sanne')

  const uit = await zetWerkmail(eigen, false)
  const weerAan = await zetWerkmail(uit, true)
  check('uit- en weer aanzetten laat je eigen tekst staan',
    weerAan.mailHandtekening === 'Groet, Sanne', String(weerAan.mailHandtekening))

  /* Leeg bewaren is een geldige keuze: dan komt er niets onder je mail. */
  const leeg = await zetHandtekening(weerAan, '   ')
  check('leeg bewaren betekent geen handtekening', leeg.mailHandtekening === undefined)

  /* ---- en het adres blijft het privéadres ---- */

  const { meldadresVan } = await import('../../src/lib/werkmail')
  check('een melding gaat naar het privéadres, niet naar het werkadres',
    meldadresVan(aan) === 'proef@prive.nl')

  await db.users.delete('u_handtekening')
}

/* ==================================================================== *
 *  70. Gedeelde postvakken en eigen mappen
 *
 *  Twee dingen die pas misgaan als er post zoekraakt, en dan niet meer te
 *  reconstrueren zijn.
 *
 *  1. Een bericht staat op precies één plek. Zodra iets zowel in "Facturen"
 *     als in Postvak IN staat, handelt iemand het twee keer af -- of denkt de
 *     tweede dat de eerste het al deed.
 *
 *  2. Een map weggooien mag nooit post meenemen. Dat is dezelfde afspraak als
 *     bij de documentmappen (0071), en het is de fout die je pas ontdekt als
 *     iemand naar een bericht vraagt dat er niet meer is.
 * ==================================================================== */

console.log('\n70. Gedeelde postvakken en eigen mappen')

{
  const {
    MIJN_VAK, inEigenMap, inMap, maakMap, mappenVan, naarEigenMap, naarMap,
    postVan, verwijderMap,
  } = await import('../../src/lib/werkpost')
  const { db } = await import('../../src/lib/db')

  const mail = (extra: Record<string, unknown> = {}) => ({
    id: 'wm_' + Math.round(Math.random() * 1e9),
    richting: 'in' as const,
    map: 'postvak' as const,
    van: 'klant@bedrijf.nl',
    aan: ['jan@tw.nl'],
    cc: [] as string[],
    onderwerp: 'Offerte',
    tekst: 'Kunnen jullie dinsdag?',
    at: Date.now(),
    bijlagen: [],
    updatedAt: Date.now(),
    ...extra,
  })

  /* ---- welk postvak ---- */

  const post = [
    mail({ id: 'a', userId: 'p_jan' }),
    mail({ id: 'b', postbusId: 'pb_info' }),
    mail({ id: 'c', postbusId: 'pb_verkoop' }),
  ] as never[]

  check('mijn eigen post is wat niet in een gedeeld postvak hangt',
    postVan(post, MIJN_VAK).map((m) => m.id).join() === 'a')
  check('en een gedeeld postvak toont alleen zijn eigen post',
    postVan(post, { soort: 'gedeeld', id: 'pb_info' }).map((m) => m.id).join() === 'b')

  const mappen = [
    { id: 'm1', userId: 'p_jan', naam: 'Facturen', volgorde: 1, createdAt: 0, updatedAt: 0 },
    { id: 'm2', userId: 'p_jan', naam: 'Aanvragen', volgorde: 0, createdAt: 0, updatedAt: 0 },
    { id: 'm3', postbusId: 'pb_info', naam: 'Afgehandeld', volgorde: 0, createdAt: 0, updatedAt: 0 },
  ]
  check('mappen horen bij hun eigen postvak',
    mappenVan(mappen, MIJN_VAK).map((m) => m.id).join() === 'm2,m1')
  check('en die van een gedeeld postvak staan daar',
    mappenVan(mappen, { soort: 'gedeeld', id: 'pb_info' }).map((m) => m.id).join() === 'm3')

  /* ---- op precies één plek ---- */

  const gesorteerd = [
    mail({ id: 'x', userId: 'p_jan' }),
    mail({ id: 'y', userId: 'p_jan', mapId: 'm1' }),
  ] as never[]

  check('wat in een eigen map ligt staat niet ook in Postvak IN',
    inMap(gesorteerd, 'postvak').map((m) => m.id).join() === 'x')
  check('maar wel in zijn eigen map',
    inEigenMap(gesorteerd, 'm1').map((m) => m.id).join() === 'y')

  /* ---- verplaatsen ---- */

  await db.werkmail.clear()
  await db.werkmailMappen.clear()
  await db.outbox.clear()

  const eentje = mail({ id: 'wm_proef', userId: 'p_jan', mapId: 'm1' }) as never
  await db.werkmail.put(eentje)

  /*
   * Weggooien haalt hem uit de eigen map. Zou mapId blijven staan, dan is het
   * bericht uit de prullenbak verdwenen -- het staat dan nog in "Facturen" en
   * nergens anders, en dat is precies het soort verdwijning waar een postvak
   * niet mee weg komt.
   */
  const weg = await naarMap(eentje, 'prullenbak')
  check('naar de prullenbak haalt hem uit zijn eigen map',
    weg.map === 'prullenbak' && weg.mapId === undefined,
    JSON.stringify({ map: weg.map, mapId: weg.mapId }))

  const terug = await naarEigenMap(weg, 'm1')
  check('en in een map zetten laat de vaste map staan',
    terug.mapId === 'm1' && terug.map === 'prullenbak')

  /* ---- een map maken en weggooien ---- */

  await db.werkmail.clear()
  await db.werkmailMappen.clear()

  const gemaakt = await maakMap(MIJN_VAK, 'p_jan', '  Facturen ')
  check('een nieuwe map krijgt zijn naam opgeschoond', gemaakt.naam === 'Facturen')
  check('en hangt aan de persoon, niet aan een postvak',
    gemaakt.userId === 'p_jan' && gemaakt.postbusId === undefined)

  let dubbel: string | null = null
  try { await maakMap(MIJN_VAK, 'p_jan', 'facturen') } catch (e) {
    dubbel = e instanceof Error ? e.message : String(e)
  }
  check('twee mappen met dezelfde naam gaat niet',
    dubbel?.includes('Facturen') === true, String(dubbel))

  let leeg: string | null = null
  try { await maakMap(MIJN_VAK, 'p_jan', '   ') } catch (e) {
    leeg = e instanceof Error ? e.message : String(e)
  }
  check('en een map zonder naam ook niet', Boolean(leeg))

  const tweede = await maakMap(MIJN_VAK, 'p_jan', 'Aanvragen')
  check('de tweede map komt erachter', tweede.volgorde > gemaakt.volgorde)

  /*
   * En dan de belangrijkste: een map weggooien laat de post staan. De
   * database doet hetzelfde (on delete set null, 0084); hier gebeurt het ook
   * lokaal, zodat het scherm niet eerst een map vol post laat verdwijnen en
   * hem een synchronisatie later terugtovert.
   */
  await db.werkmail.put(mail({ id: 'wm_1', userId: 'p_jan', mapId: gemaakt.id }) as never)
  await db.werkmail.put(mail({ id: 'wm_2', userId: 'p_jan', mapId: gemaakt.id }) as never)

  const hoeveel = await verwijderMap(gemaakt)
  check('een map weggooien meldt hoeveel post er stond', hoeveel === 2, String(hoeveel))
  check('en die post staat er nog', (await db.werkmail.count()) === 2)
  check('terug in zijn vaste map',
    (await db.werkmail.toArray()).every((m) => !m.mapId && m.map === 'postvak'))
  check('de map zelf is weg', (await db.werkmailMappen.get(gemaakt.id)) === undefined)

  await db.werkmail.clear()
  await db.werkmailMappen.clear()
  await db.outbox.clear()
}
}
