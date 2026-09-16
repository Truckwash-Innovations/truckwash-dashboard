/**
 * De koppeling met Exact: sleutels, schema, boeken en betalen
 *
 * Onderdeel van de zelftest; zie scripts/selftest.ts voor hoe dit draait en
 * waarom het is opgesplitst.
 */

import { api, check, db, eq, zonderCommentaar } from './kern.ts'

export async function groepen() {
/* ==================================================================== *
 *  De sleutels van Exact
 *
 *  Casper zet ze nu zelf in het scherm bij Ontwikkeling, omdat hij met een
 *  dev-account van Exact aan het uitproberen is. Dat maakt drie dingen
 *  belangrijk genoeg om vast te leggen, want ze zijn alle drie stil kapot te
 *  maken zonder dat er ooit iets rood wordt.
 *
 *  Een: het clientgeheim mag nooit terug naar de browser. Het gaat heen bij
 *  het opslaan en komt er hoogstens als vier laatste tekens weer uit.
 *
 *  Twee: het adres waar dat geheim naartoe gaat mag niet vrij invulbaar
 *  zijn. Wie het mag zetten zou anders in een handeling de sleutels van de
 *  boekhouding naar zijn eigen server kunnen laten sturen, en er zou geen
 *  foutmelding komen -- zijn server antwoordt gewoon.
 *
 *  Drie: wijzigen van de sleutels moet de tokens weggooien. Een token dat is
 *  opgehaald bij het proefaccount hoort niet te blijven staan als het
 *  client-id naar de echte administratie wijst.
 * ==================================================================== */

console.log('\n34. De sleutels van Exact')

{
  const { readFileSync } = await import('node:fs')
  const bron = readFileSync('supabase/functions/exact/index.ts', 'utf8')

  /* --- het geheim gaat niet terug --- */

  check('de stand stuurt hoogstens de laatste vier tekens van het geheim',
    bron.includes('geheimStaart') && bron.includes('geheim.slice(-4)'))
  check('en nergens het geheim zelf',
    !/geheim:\s*geheim\b/.test(bron) && !/client_geheim:\s*k\?\./.test(bron))

  /* --- het adres zit op slot --- */

  check('er is een lijst met adressen die van Exact zijn',
    bron.includes('EXACT_DOMEINEN') && bron.includes('exactonline.nl'))
  check('en het opgegeven adres wordt eraan getoetst',
    /function schoonBasis/.test(bron) && bron.includes("u.protocol !== 'https:'"))
  check('opslaan gaat langs die toets',
    /velden\.basis_url = schoon/.test(bron))

  /* --- wijzigen koppelt los --- */

  check('een gewijzigde sleutel gooit de tokens weg',
    bron.includes('raaktTokens')
    && /raaktTokens && wasGekoppeld/.test(bron)
    && /velden\.refresh_token = null/.test(bron))
  check('en de omgeving telt daarin mee',
    /'client_id', 'client_geheim', 'basis_url', 'omgeving'/.test(bron))

  /* --- wie mag wat --- */

  check('sleutels zetten mag alleen bij ontwikkeling of management',
    bron.includes("rollen.includes('developer') || rollen.includes('management')"))
  check('en de actie controleert dat ook echt',
    /if \(!beller\.magSleutels\)/.test(bron))

  /*
   * Het paar id+geheim komt uit een bron. Half om half geeft "invalid_client"
   * terug, en dat is een foutmelding die naar de verkeerde kant wijst.
   */
  check('id en geheim worden als paar gepakt',
    bron.includes('const uitDb = Boolean(dbId && dbGeheim)'))

  /* --- het scherm --- */

  const scherm = readFileSync('src/components/Exact.tsx', 'utf8')
  check('het veld voor het geheim staat leeg bij het openen',
    scherm.includes("setGeheim('')"))
  check('en leeg laten betekent: laat staan',
    scherm.includes('geheim.trim() ? { geheim: geheim.trim() } : {}'))
}

/* ==================================================================== *
 *  Het token van Exact leeft tien minuten
 *
 *  Dit is de val waar elke eerste koppeling in loopt, en hij is stil: alles
 *  werkt, tien minuten lang, en daarna geeft Exact 401 zonder dat er iets aan
 *  de koppeling mankeert.
 *
 *  Eronder zit een tweede, die erger is. Exact geeft bij het verversen een
 *  NIEUW refresh-token en trekt het oude in. Wie dat niet opslaat, heeft een
 *  koppeling die precies één verversing overleeft en daarna definitief dood
 *  is -- opnieuw proberen helpt dan niet meer, want het bewaarde token
 *  bestaat niet meer bij Exact.
 *
 *  Alle drie de regels hieronder zijn met het oog niet te zien in een diff.
 *  Vandaar dat ze hier staan.
 * ==================================================================== */

console.log('\n36. Het token van Exact')

{
  const { readFileSync } = await import('node:fs')
  const bron = readFileSync('supabase/functions/_gedeeld/exact.ts', 'utf8')

  check('er wordt met een refresh_token ververst',
    bron.includes("grant_type: 'refresh_token'"))

  check('het nieuwe refresh-token wordt opgeslagen',
    /refresh_token: uit\.refresh_token \|\| rij\.refresh_token/.test(bron))

  /*
   * En het wordt opgeslagen VOORDAT het antwoord wordt gebruikt. Zou dat na
   * afloop gebeuren, dan is een mislukt verzoek genoeg om het verse token
   * kwijt te raken terwijl Exact het oude al heeft ingetrokken.
   */
  const iSchrijf = bron.indexOf("update(nieuw)")
  const iTerug = bron.indexOf("return { basis, division: rij.division, token: uit.access_token")
  check('en dat gebeurt vóór het antwoord teruggaat',
    iSchrijf > 0 && iTerug > 0 && iSchrijf < iTerug)

  check('mislukt wegschrijven laat de aanroep niet slagen',
    bron.includes('Het verse token kon niet worden opgeslagen'))

  /*
   * Het verschil tussen "koppel opnieuw" en "Exact had het even niet". Bij
   * een 500 de tokens weggooien betekent dat een storing bij Exact een
   * handmatige herkoppeling kost.
   */
  check('alleen bij 400 of 401 gaat de koppeling los',
    bron.includes('const kwijt = res.status === 400 || res.status === 401'))
  check('en bij een storing blijft hij staan',
    /if \(kwijt\) \{/.test(bron))

  /* Verversen met marge: een token dat nog vijf seconden geldig is, is bij
     aankomst verlopen. */
  check('er wordt met een marge ververst', bron.includes('VERSE_MARGE_MS'))

  /*
   * Exact antwoordt in XML als je niet om JSON vraagt, en verpakt in
   * { d: { results } } -- niet in { value }, dat is OData 4.
   */
  check('er wordt om JSON gevraagd', bron.includes("Accept: 'application/json'"))
  check('en het antwoord wordt uit d.results gehaald',
    bron.includes('uit.d?.results') && !bron.includes('json.value'))
  check('meerdere pagina\'s worden gevolgd', bron.includes('__next'))

  /* Een factuurdatum is een dag, geen moment: op lokale middernacht kan hij
     in de winter een dag terugvallen en dan in het vorige boekjaar landen. */
  check('een datum gaat op UTC naar Exact',
    bron.includes('getUTCFullYear') && bron.includes('T00:00:00.000Z'))
}

/* ==================================================================== *
 *  Het rekeningschema blijft van ons
 *
 *  De verleiding is om het schema van Exact over public.grootboek heen te
 *  zetten. Dat is precies wat er niet moet gebeuren: die lijst is met opzet
 *  kort (zie 0044) en heeft eigen namen en trefwoorden. Een sync die daar
 *  overheen loopt, gooit dat weg -- en dat merk je pas als de administratie
 *  de rekening niet meer terugvindt.
 * ==================================================================== */

console.log('\n37. Het rekeningschema blijft van ons')

{
  const { readFileSync } = await import('node:fs')
  const bron = readFileSync('supabase/functions/exact/index.ts', 'utf8')

  check('de sync schrijft in exact_grootboek',
    bron.includes("from('exact_grootboek')"))
  check('en raakt public.grootboek niet aan',
    !/from\('grootboek'\)[\s\S]{0,80}(upsert|update|insert|delete)/.test(bron))

  /* Wat Exact niet meer kent hoort weg, anders blijft de lijst van het
     proefaccount naast die van de echte administratie staan. */
  check('wat verdwenen is wordt opgeruimd',
    /delete\(\)\.lt\('updated_at', nu\)/.test(bron))

  /*
   * Dit stond hier als `bron.includes('magAdministratie')` -- de naam van de
   * functie moest in het bestand voorkomen. Dat was hij ook, netjes, vijf keer
   * zelfs. Alleen stond hij ACHTER wieBelt(), en die liet de rol administratie
   * niet binnen. De check was groen en het scherm gaf 403.
   *
   * Een check op een naam is geen check op een pad. Deze kijkt naar de deur.
   */
  check('de administratie komt door de deur van wieBelt',
    /const magBoekhouding = magSleutels[\s\S]{0,220}rollen\.includes\('administratie'\)/
      .test(bron))
  check('en die uitkomst bepaalt of het mag',
    bron.includes('const mag = magBoekhouding ||'))
  /*
   * Hier stond een telling op precies vijf. Dat is een teller en geen
   * controle: wie er een beschermde actie bij zet, moet het getal ophogen, en
   * dan is de test iets wat je stilzwijgend goedzet in plaats van iets wat je
   * iets vertelt. Bij de zesde actie (grootboek-overnemen) viel hij om
   * terwijl die juist wél netjes beschermd was.
   *
   * Wat het moet zijn: een ondergrens, plus de eis dat elke actie die aan de
   * boekhouding komt er ook echt achter staat.
   */
  check('de boekhoudacties hangen aan dat veld',
    (bron.match(/if \(!beller\.magBoekhouding\)/g) ?? []).length >= 5)

  /*
   * En geen enkele boekhoudactie staat buiten die deur. De router groepeert
   * ze; wat hier wordt nagerekend is dat elke naam die geld of Exact raakt in
   * zo'n groep valt en niet los in de router is blijven hangen.
   */
  for (const actie of [
    'sync-grootboek', 'grootboek-overnemen', 'sync-relaties', 'stuur-facturen',
    'koppel-leverancier', 'proefrit', 'opnieuw-ophalen', 'geschiedenis',
    'niet-boekbaar', 'crediteuren', 'sepa-maken', 'batch-uitvoeren',
  ]) {
    /*
     * De LAATSTE vermelding, want dat is de regel die hem afhandelt. De
     * eerste staat in de groepsvoorwaarde ("actie === 'a' || actie === 'b'"),
     * en daar staat de rechtencontrole per definitie ná -- zoek je daarvóór,
     * dan vind je de controle van de vórige groep en slaagt de test om de
     * verkeerde reden. Precies dat deed de eerste versie hiervan: tien acties
     * groen op een controle die niet de hunne was.
     */
    const plek = bron.lastIndexOf(`actie === '${actie}'`)
    const deur = bron.lastIndexOf('if (!beller.magBoekhouding)', plek)
    const magPersoneel = bron.lastIndexOf('await magPersoneel(req)', plek)
    check(`${actie} staat achter de boekhouddeur`,
      plek > 0 && deur > 0 && deur < plek && deur > magPersoneel,
      plek > 0 ? 'staat buiten een rechtencontrole' : 'actie niet gevonden')
  }
  /* De sleutels blijven bij ontwikkeling en management. */
  check('maar de sleutels van de Exact-app niet',
    bron.includes('if (!beller.magSleutels) {'))
}

/* ==================================================================== *
 *  Het personeel van Exact
 *
 *  Casper: "voor personeel mag je alles doen." Wat er dan blijkt: exporteren
 *  kan niet. payroll/Employees in de Exact-API doet GET en verder niets --
 *  geen POST, geen PUT. Een export zou stilzwijgend geweigerd worden.
 *
 *  Wat hier wordt vastgelegd zijn de twee dingen die daarna nog stil kapot
 *  kunnen: koppelen op naam in plaats van op adres, en het volledige record
 *  van Exact breder te zien maken dan het dossier zelf.
 * ==================================================================== */

console.log('\n38. Het personeel van Exact')

{
  const { readFileSync } = await import('node:fs')
  const bron = readFileSync('supabase/functions/exact/index.ts', 'utf8')

  /* --- er wordt niets naar de HRM-kant geschreven --- */

  check('er gaat niets naar payroll/Employees toe',
    !/exactPost\([^)]*payroll\/Employees/.test(bron))

  /* --- koppelen gaat op adres en niet op naam --- */

  check('automatisch koppelen gaat op e-mailadres',
    bron.includes('const opAdres = new Map<string, number>()'))
  /*
   * Op naam matchen is aanlokkelijk en fout. Twee mensen die De Vries heten
   * is geen uitzondering, en een verkeerde koppeling stuurt straks de uren
   * van de een naar de loonstrook van de ander.
   */
  check('en niet op naam',
    !/opNaam|volledige_naam.*toLowerCase.*set\(/.test(bron))

  /* Een nummer dat al bezet is wordt overgeslagen, niet overschreven. */
  check('een bezet loonnummer wordt overgeslagen',
    bron.includes('if (hid == null || bezet.has(hid)) continue'))

  /* --- het hele record, en de grens eromheen --- */

  check('het volledige antwoord van Exact wordt bewaard',
    bron.includes('ruw: r as unknown as Record<string, unknown>'))
  /*
   * Zonder $select, met opzet: één verzonnen veldnaam laat Exact het hele
   * verzoek weigeren, en dan wijst de foutmelding naar niets.
   */
  check('en zonder $select opgehaald',
    /exactLijst<ExactMedewerker>\(lijn, 'payroll\/Employees'\)/.test(bron))

  /*
   * De grens. In dat record kan een BSN zitten, en dat ligt in 0009 bij het
   * management en bij de medewerker zelf. Een los toegekend recht mag hier
   * dus géén achterdeur zijn -- vandaar null als recht.
   */
  check('personeel is management-only, zonder rechtenachterdeur',
    bron.includes("return await heeftRecht(req, null, ['management'])"))
  check('en heeftRecht kent die vorm ook echt',
    bron.includes('if (recht === null) return rollen.some((r) => mijn.includes(r))'))

  /* Het volledige record reist niet mee met het overzicht. */
  check('het hele record komt pas mee als je er een opent',
    bron.includes('async function medewerkerDetails')
    && !/exactMensen[\s\S]{0,400}ruw:/.test(bron))

  /* --- het scherm --- */

  const scherm = readFileSync('src/components/Exact.tsx', 'utf8')
  check('je kunt een Exact-medewerker opzoeken in plaats van een nummer typen',
    scherm.includes('function Zoeker'))
  check('en zoeken kan op naam, nummer en adres',
    scherm.includes('String(m.employeeHid).includes(t)')
    && scherm.includes('m.email.toLowerCase().includes(t)'))
  check('een nummer dat al aan iemand anders hangt is niet te kiezen',
    scherm.includes("disabled={Boolean(m.gekoppeldAan && m.gekoppeldAan !== persoon.userId)}"))
  check('de datums van Exact worden leesbaar getoond',
    scherm.includes('function leesbaar') && scherm.includes('OData v2 schrijft datums'))
}

/* ==================================================================== *
 *  Terugkomen uit Exact
 *
 *  Casper: "zodat ik erop kan klikken, en erop terug kom."
 *
 *  Twee dingen kunnen hier stil misgaan, en allebei zijn ze niet met het
 *  oog te zien.
 *
 *  Het eerste is een open doorstuurluik. De serverfunctie stuurt je na het
 *  koppelen door naar een adres uit de instellingen. Wordt dat adres niet
 *  nagekeken, dan staat er op ons eigen domein een link die iedereen ergens
 *  anders heen stuurt -- precies wat je in een phishingmail wil hebben.
 *
 *  Het tweede is de tekst van Exact doorgeven aan het scherm. Die komt uit
 *  een URL die iedereen kan sturen; hem tonen betekent dat een vreemde
 *  bepaalt wat er in het dashboard staat. Daarom een vast rijtje woorden.
 * ==================================================================== */

console.log('\n40. Terugkomen uit Exact')

{
  const { readFileSync } = await import('node:fs')
  const bron = readFileSync('supabase/functions/exact/index.ts', 'utf8')

  check('er wordt teruggestuurd naar de app', bron.includes('async function terugNaarApp'))
  check('het adres komt uit de instellingen', bron.includes("eq('sleutel', 'app_url')"))

  /* Alleen https, en zonder inlognaam in het adres. */
  check('een adres dat geen https is wordt niet gebruikt',
    bron.includes("if (u.protocol !== 'https:' || u.username || u.password) return null"))
  check('en bij twijfel blijft de oude pagina staan',
    bron.includes('if (!app) return pagina(titel, tekst, status)'))

  /*
   * Wat er in de URL belandt is een van onze eigen woorden. Zou hier de
   * foutmelding van Exact staan, dan schrijft een vreemde mee in het scherm.
   */
  const woorden = ['ok', 'geweigerd', 'verlopen', 'sleutels', 'token']
  check('er gaat een vast woord mee terug, geen foutmelding',
    woorden.every((w) => bron.includes(`terugNaarApp('${w}'`)))
  check('en de tekst van Exact gaat niet mee in de URL',
    !/searchParams\.set\('exact',\s*(fout|reden|antwoord)/.test(bron))

  /* --- het scherm --- */

  const scherm = readFileSync('src/components/Exact.tsx', 'utf8')
  check('het scherm vangt de terugkeer op',
    scherm.includes("searchParams.get('exact')"))
  /*
   * En haalt hem daarna uit de URL. Blijft hij staan, dan krijg je bij elke
   * verversing dezelfde melding, en na een herstart een melding over iets
   * van vorige week.
   */
  check('en haalt het woord daarna uit de URL',
    scherm.includes("u.searchParams.delete('exact')")
    && scherm.includes('window.history.replaceState'))

  /*
   * De Windows-app opent je gewone browser, en die kan het app-venster niet
   * terugroepen. Zonder navragen zou je naar "niet gekoppeld" zitten kijken
   * terwijl het allang gelukt is.
   */
  check('en vraagt zelf na terwijl je bij Exact bent',
    scherm.includes('if (!wachten) return') && scherm.includes('setWachten(true)'))
  check('dat navragen stopt vanzelf',
    scherm.includes('const tot = Date.now() + 3 * 60_000'))
}

/* ==================================================================== *
 *  Het SEPA-betaalbestand (0065)
 *
 *  Een bank weigert een bestand met één foute IBAN in ZIJN GEHEEL. Niet die
 *  ene regel: het hele bestand. Dan sta je met achttien facturen die niet
 *  betaald zijn en een foutmelding die alleen zegt dat er iets niet klopt.
 *
 *  En die IBAN's komen uit een factuur die door een model is gelezen.
 *  Meestal goed, en soms een cijfer verkeerd -- precies wat de mod-97-toets
 *  eruit haalt.
 * ==================================================================== */

console.log('\n43. Het SEPA-betaalbestand')

{
  const { ibanKlopt, maakSepa } = await import('../../supabase/functions/_gedeeld/sepa.ts')

  /* --- de toets --- */

  check('een goede Nederlandse IBAN komt erdoor', ibanKlopt('NL91ABNA0417164300'))
  check('met spaties ook', ibanKlopt('NL91 ABNA 0417 1643 00'))
  check('en in kleine letters', ibanKlopt('nl91abna0417164300'))

  /*
   * Eén cijfer verkeerd is precies wat een model doet met een slechte scan.
   * Zou dat erdoor komen, dan gaat er geld naar een rekening die niet
   * bestaat -- of erger, naar een die wel bestaat.
   */
  check('één cijfer verkeerd valt af', !ibanKlopt('NL91ABNA0417164301'))
  check('een te korte valt af', !ibanKlopt('NL91ABNA04'))
  check('en leeg ook', !ibanKlopt(''))

  /* --- het bestand --- */

  const uit = maakSepa({
    berichtId: 'bb_test1',
    eigenNaam: 'Truckwash1 Group B.V.',
    eigenIban: 'NL91ABNA0417164300',
    uitvoerenOp: new Date('2026-04-03T00:00:00Z'),
    regels: [
      { id: 'exp_1', naam: 'Enexis B.V.', iban: 'NL02ABNA0123456789', bedrag: 121, kenmerk: '2026-00841' },
      { id: 'exp_2', naam: 'Fout & Co', iban: 'NL00FOUT0000000000', bedrag: 50, kenmerk: 'X' },
      { id: 'exp_3', naam: 'Nul B.V.', iban: 'NL91ABNA0417164300', bedrag: 0, kenmerk: 'Y' },
    ],
  })

  check('alleen de goede regel gaat mee', uit.aantal === 1, String(uit.aantal))
  check('en de andere twee worden gemeld met een reden',
    uit.overgeslagen.length === 2
    && uit.overgeslagen.some((o) => /klopt niet/.test(o.reden))
    && uit.overgeslagen.some((o) => /nul/.test(o.reden)),
    JSON.stringify(uit.overgeslagen))

  check('het totaal is dat van wat meegaat', uit.totaal === 121, String(uit.totaal))

  /*
   * De bank telt na. Staat er in CtrlSum iets anders dan de som van de
   * bedragen, of in NbOfTxs iets anders dan het aantal, dan weigert hij het
   * bestand -- en dat is precies het soort fout dat je niet met het oog ziet.
   */
  check('het aantal in de kop klopt met de regels',
    (uit.xml.match(/<NbOfTxs>1<\/NbOfTxs>/g) ?? []).length === 2)
  check('en het controletotaal ook',
    (uit.xml.match(/<CtrlSum>121\.00<\/CtrlSum>/g) ?? []).length === 2)

  check('de uitvoerdatum staat erin', uit.xml.includes('<ReqdExctnDt>2026-04-03</ReqdExctnDt>'))
  check('en het is pain.001.001.03',
    uit.xml.includes('urn:iso:std:iso:20022:tech:xsd:pain.001.001.03'))

  /*
   * Een leveranciersnaam met een ampersand erin maakt van geldige XML een
   * bestand dat de bank niet kan lezen -- en dat merk je pas daar.
   */
  const metTeken = maakSepa({
    berichtId: 'bb_test2',
    eigenNaam: 'Truckwash1 Group B.V.',
    eigenIban: 'NL91ABNA0417164300',
    uitvoerenOp: new Date('2026-04-03T00:00:00Z'),
    regels: [{ id: 'exp_9', naam: 'Jansen & Zonen', iban: 'NL02ABNA0123456789', bedrag: 10 }],
  })
  /*
   * De ampersand haalt het bestand niet eens: SEPA staat hem niet toe in een
   * naam, dus hij wordt al bij het opschonen vervangen. Dat is de goede
   * uitkomst -- de bank zou hem anders weigeren. Wat hier wordt vastgelegd is
   * dat er GEEN losse & in de XML belandt, hoe dan ook: dat zou van geldige
   * XML een bestand maken dat niet te lezen is.
   */
  check('een ampersand haalt het bestand niet',
    metTeken.xml.includes('Jansen Zonen'), metTeken.xml.match(/<Nm>[^<]*<\/Nm>/g)?.join(' | '))
  check('en er staat nergens een losse ampersand in',
    !/&(?!(amp|lt|gt|quot|apos);)/.test(metTeken.xml))

  /* En tekens die SEPA niet toestaat worden vervangen, niet weggelaten:
     "Müller" hoort "Muller" te worden en niet "Mller". */
  const metAccent = maakSepa({
    berichtId: 'bb_test3',
    eigenNaam: 'Truckwash1 Group B.V.',
    eigenIban: 'NL91ABNA0417164300',
    uitvoerenOp: new Date('2026-04-03T00:00:00Z'),
    regels: [{ id: 'exp_8', naam: 'Müller Transport', iban: 'NL02ABNA0123456789', bedrag: 10 }],
  })
  check('een accent wordt vervangen en niet weggelaten',
    metAccent.xml.includes('Muller Transport'), metAccent.xml.slice(0, 0) || 'zie bestand')

  /* En een eigen rekening die niet klopt is geen regel die je overslaat maar
     een bestand dat nergens heen kan. */
  let eigenFout = false
  try {
    maakSepa({
      berichtId: 'bb_test4',
      eigenNaam: 'Truckwash1 Group B.V.',
      eigenIban: 'NL00FOUT0000000000',
      uitvoerenOp: new Date('2026-04-03T00:00:00Z'),
      regels: [{ id: 'exp_7', naam: 'Test', iban: 'NL02ABNA0123456789', bedrag: 10 }],
    })
  } catch {
    eigenFout = true
  }
  check('een eigen rekening die niet klopt stopt het hele bestand', eigenFout)
}

/* ==================================================================== *
 *  62. Het administratienummer van Exact
 *
 *  Casper koppelde de echte Exact nadat er met een proefaccount was
 *  geoefend, en kreeg op alles:
 *
 *      403 op financial/GLAccounts
 *      { "error": { "message": { "value": "Forbidden - WrongDivision" } } }
 *
 *  Dat leest als een rechtenprobleem en is het niet. Het divisienummer van
 *  het proefaccount stond nog in de instelling exact_division, die won bij
 *  het koppelen van wat Exact zelf zei, en elk adres bij Exact is
 *  /api/v1/<division>/... -- dus faalde alles.
 *
 *  Het venijn zit in de weg terug. Ook system/Divisions, de lijst waarmee je
 *  het nummer zou rechtzetten, zit achter datzelfde nummer. Een koppeling die
 *  er goed uitziet, niets kan, en geen knop meer heeft om zichzelf te
 *  repareren.
 *
 *  Hier staat vast wat dat dichthoudt: één vraag zonder nummer in het adres,
 *  en een foutmelding die het nummer noemt in plaats van "403".
 * ==================================================================== */

console.log('\n62. Het administratienummer van Exact')

{
  const { readFileSync } = await import('node:fs')
  const { administratiesVan, exactLijst, huidigeDivisie } =
    await import('../../supabase/functions/_gedeeld/exact.ts')

  const echteFetch = globalThis.fetch
  const gevraagd: string[] = []

  const json = (lijf: unknown, status = 200) =>
    new Response(JSON.stringify(lijf), {
      status, headers: { 'content-type': 'application/json' },
    })

  function stub(maak: (url: string) => Response) {
    gevraagd.length = 0
    globalThis.fetch = ((invoer: unknown) => {
      const url = String(invoer)
      gevraagd.push(url)
      return Promise.resolve(maak(url))
    }) as typeof fetch
  }

  try {
    /* ---- de vraag die altijd werkt ---- */

    stub(() => json({ d: { results: [{ CurrentDivision: 3010101 }] } }))
    check('de huidige administratie komt van Exact zelf',
      await huidigeDivisie('https://start.exactonline.nl', 'tok') === '3010101')

    /*
     * Dit is de hele reparatie in één regel. Staat er wél een nummer in dit
     * adres, dan is er bij een verkeerd nummer geen weg terug meer.
     */
    check('en in dat adres staat geen administratienummer',
      gevraagd[0] === 'https://start.exactonline.nl/api/v1/current/Me?$select=CurrentDivision')

    /* Exact levert soms de array rechtstreeks onder d, zonder results. */
    stub(() => json({ d: [{ CurrentDivision: 42 }] }))
    check('ook de vorm zonder results wordt gelezen',
      await huidigeDivisie('https://x', 'tok') === '42')

    /*
     * Gaat Exact onderuit, dan geen fout maar niets. De aanroeper heeft dan
     * nog wat er al stond; een uitzondering zou het ophalen van de
     * administraties laten mislukken op de stap die het juist moest redden.
     */
    stub(() => json({}, 500))
    check('en bij een storing komt er niets terug in plaats van een fout',
      await huidigeDivisie('https://x', 'tok') === null)

    /* ---- de lijst met bv's ---- */

    stub(() => json({ d: { results: [
      { Code: 3010101, Description: 'Truckwash 1 Group B.V.' },
      { Code: 3010102, Description: 'Truckwash 1 Venlo B.V.' },
    ] } }))
    const lijst = await administratiesVan('https://start.exactonline.nl', 'tok', '3010101')

    check('de administraties komen met naam mee',
      lijst.length === 2 && lijst[1].code === '3010102'
      && lijst[1].naam === 'Truckwash 1 Venlo B.V.')
    check('opgehaald vanaf de administratie die je meegeeft',
      gevraagd[0].includes('/api/v1/3010101/system/Divisions'))

    /* Main bestaat niet op system/Divisions; het opvragen gaf een 400 op het
       hele ophalen. Zie de kanttekening in syncAdministraties(). */
    check('zonder Main in de $select',
      !gevraagd[0].includes('Main'))

    /* ---- de foutmelding ---- */

    stub(() => new Response(
      '{"error":{"code":"","message":{"lang":"","value":"Forbidden - WrongDivision"}}}',
      { status: 403 }))

    const lijn = {
      basis: 'https://start.exactonline.nl', token: 'tok',
      division: '999999', omgeving: 'echt' as const,
    }
    let melding = ''
    try {
      await exactLijst(lijn, 'financial/GLAccounts')
    } catch (e) {
      melding = e instanceof Error ? e.message : String(e)
    }

    /*
     * Het nummer erbij, want dat IS het antwoord. Zonder dat ga je zoeken in
     * de rechten van de Exact-app, en daar is niets te vinden.
     */
    check('een WrongDivision noemt het nummer dat niet deugt',
      melding.includes('999999'))
    check('en zegt wat je eraan doet',
      melding.includes('Haal de administraties opnieuw op'))
    check('in plaats van alleen de foutcode door te geven',
      !melding.includes('403'))

    /* Een gewone fout blijft wel gewoon een gewone fout. */
    stub(() => new Response('boem', { status: 500 }))
    melding = ''
    try {
      await exactLijst(lijn, 'financial/GLAccounts')
    } catch (e) {
      melding = e instanceof Error ? e.message : String(e)
    }
    check('een andere fout gaat ongeschonden door',
      melding.includes('500') && melding.includes('boem'))
  } finally {
    globalThis.fetch = echteFetch
  }

  /* ---- en de kant die de reparatie uitvoert ---- */

  const bron = readFileSync('supabase/functions/exact/index.ts', 'utf8')

  check('het ophalen van de administraties begint bij current/Me',
    /const huidig = await huidigeDivisie\(lijn\.basis, lijn\.token\)/.test(bron))

  check('en niet bij het nummer dat juist stuk kan zijn',
    !/administratiesVan\(lijn\.basis, lijn\.token, lijn\.division\)/.test(bron))

  check('een koppelnummer dat er niet bij hoort wordt rechtgezet',
    bron.includes('hersteld = { van: lijn.division, naar: huidig }'))

  /*
   * Uitzetten en niet weggooien. Aan die codes hangen vestigingen, bonnen en
   * grootboekregels (0059, 0079); een rij weghalen laat die verwijzingen in
   * het niets wijzen.
   */
  check('een administratie van een ander account gaat uit',
    bron.includes('.update({ actief: false, updated_at: nu }).in(\'code\', vreemd)'))
  check('en wordt niet weggegooid',
    !bron.includes("from('exact_administratie').delete()"))

  /*
   * Bij het koppelen beslist Exact, en mag de instelling daar alleen uit
   * kiezen. Andersom was precies de fout: een oud nummer dat won van de
   * werkelijkheid.
   */
  const iVraag = bron.indexOf('division = await huidigeDivisie(')
  const iKies = bron.indexOf('mag.some((a) => a.code === gewenst)')
  check('bij het koppelen wordt eerst gevraagd wat Exact heeft',
    iVraag > 0 && iKies > 0 && iVraag < iKies)
}

/* ==================================================================== *
 *  63. Exact hoort bij de administratie
 *
 *  Casper: "zorg dat dit soort dingen naar administratie verhuizen, alles
 *  exact related mag naar administratie, behalve de koppeling zelf."
 *
 *  Acht kaarten stonden onder elkaar op het ontwikkelscherm -- niet omdat ze
 *  daar horen, maar omdat ze daar zijn ontstaan, naast de sleutels waarmee ze
 *  werden uitgeprobeerd. Ze zijn verhuisd en niet gekopieerd: de componenten
 *  staan nog in Exact.tsx en worden geëxporteerd. Twee kopieën van een
 *  betaalscherm is hoe een SEPA-bestand op twee manieren wordt opgebouwd.
 *
 *  Wat hier wordt vastgelegd is de verhuizing zelf. Die is met één regel
 *  terug te draaien zonder dat iemand het merkt -- een <Grootboek /> erbij op
 *  de ontwikkelpagina en het staat weer op twee plekken.
 * ==================================================================== */

console.log('\n63. Exact hoort bij de administratie')

{
  const { readFileSync } = await import('node:fs')
  const dev = readFileSync('src/components/Exact.tsx', 'utf8')
  const adm = readFileSync('src/dashboards/administratie/AdministratieDashboard.tsx', 'utf8')
  const mgt = readFileSync('src/dashboards/management/ManagementDashboard.tsx', 'utf8')

  /*
   * Het ontwikkelscherm rendert ze niet meer. Op de hoofdcomponent gekeken en
   * niet op het hele bestand: de componenten stáán er nog, ze worden alleen
   * niet meer op die pagina gezet.
   */
  const pagina = dev.slice(0, dev.indexOf('De rest staat bij de administratie'))
  for (const wat of ['Administraties', 'Grootboek', 'Relaties', 'Facturen', 'Verkoop', 'Betalen']) {
    check(`de ontwikkelpagina zet ${wat} niet meer neer`,
      !pagina.includes(`<${wat} `) && !pagina.includes(`<${wat}/>`))
  }

  /* En de administratie doet dat wel. */
  for (const wat of ['Administraties', 'Grootboek', 'Relaties', 'Facturen', 'Verkoop', 'Betalen']) {
    check(`de administratie zet ${wat} wel neer`, adm.includes(`<${wat} `))
  }

  /*
   * Behalve het personeel. Daar gaat het volledige Exact-record langs en daar
   * kan een BSN in zitten; dat ligt sinds 0009 bij het management en bij de
   * medewerker zelf. De database laat het ook niet toe -- de policy op
   * exact_personeel is is_management().
   */
  check('het personeel staat bij management en niet bij de administratie',
    mgt.includes('<ExactPersoneel ') && !adm.includes('ExactPersoneel'))

  /* De koppeling zelf blijft waar hij was. */
  check('de sleutels en het koppelen blijven bij ontwikkeling',
    pagina.includes('De Exact-app') && pagina.includes('De koppeling'))

  /* ---- de bv's en hun rekening ---- */

  const functie = readFileSync('supabase/functions/exact/index.ts', 'utf8')

  /*
   * Het betaalscherm vroeg om een eigen rekeningnummer per bv en er was in de
   * hele app geen plek om het in te vullen. Dezelfde soort fout als het
   * verkoopdagboek: een scherm dat iets eist wat nergens te zetten is.
   */
  check('de bv geeft zijn eigen rekening mee',
    /eigenIban: String\(r\.eigen_iban/.test(functie))
  check('en die is ook te zetten',
    functie.includes("if ('eigenIban' in body)"))

  /*
   * Nagerekend vóór het opslaan. Een bank weigert een bestand met één foute
   * IBAN in zijn geheel, en dan zoek je in achttien regels naar een fout die
   * in een invoerveld zit.
   */
  check('een fout rekeningnummer wordt geweigerd bij het opslaan',
    functie.includes('ibanKlopt(ruw)') && functie.includes("import { ibanKlopt, maakSepa }"))

  /* ---- ophalen ---- */

  /*
   * Casper: "of doe dat automatisch?" -- allebei. De knop blijft, en wat
   * ouder is dan een dag haalt zichzelf op zodra het scherm opengaat.
   */
  check('verouderd is een dag',
    dev.includes('const DAG = 24 * 60 * 60 * 1000'))
  check('en wat verouderd is haalt zichzelf op',
    (dev.match(/useVanzelfOphalen\(/g) ?? []).length >= 4)
  check('hoogstens één keer per keer dat het scherm opengaat',
    /const gedaan = useRef\(false\)/.test(dev))

  /* ---- de lijst met bedrijven ---- */

  /*
   * De matrix is weg: twaalf bv's als kolommen, elk met duizend opties. Wat
   * hij suggereerde was bovendien fout -- dat elk bedrijf in elke bv een
   * relatie hoort te hebben. De server telt bedrijven met NUL koppelingen.
   */
  const relaties = dev.slice(dev.indexOf('export function Relaties'))
  check('de bv\'s staan niet meer als kolommen in de lijst',
    !relaties.slice(0, relaties.indexOf('<Modal')).includes('bvs.map'))
  check('er kan gezocht worden',
    relaties.includes('<Zoekveld'))
  check('en het venster opent met de naam die wij kennen',
    relaties.includes('setZoekRelatie(b.naam)'))

  /*
   * Nooit stil afkappen. Staat er meer dan er getoond wordt, dan hoort dat er
   * te staan -- anders zoek je een relatie die er wel is, ziet hem niet, en
   * concludeert dat hij in Exact ontbreekt.
   */
  check('een afgekapte keuzelijst zegt dat hij afgekapt is',
    relaties.includes('totaal > lijst.length'))
}

/* ==================================================================== *
 *  71. De proefrit en de proeffacturen
 *
 *  Twee dingen worden hier vastgehouden, en het eerste is het zwaarste.
 *
 *  1. De tweede deur in ontvang-mail.
 *
 *     Die webhook is de enige plek waar een kostenpost vanzelf ontstaat, en
 *     hij staat open op internet -- daarom hangt er een handtekening van
 *     Resend voor. Voor de proeffacturen is er een tweede weg naar binnen
 *     gekomen, en dat is precies het soort deur dat een half jaar later
 *     openstaat omdat iemand de voorwaarde heeft versoepeld.
 *
 *     Dus: zonder de vlag wordt er niet eens naar gekeken, en mét de vlag
 *     moet er een ONTWIKKELAAR achter zitten. Geen "een geldig token", geen
 *     tweede geheim.
 *
 *  2. De proeffacturen zelf.
 *
 *     Elk geval zet één beslissing op scherp en er staat bij wat er hoort te
 *     gebeuren. Zonder dat laatste is het geen proef maar een demonstratie.
 * ==================================================================== */

console.log('\n71. De proefrit en de proeffacturen')

{
  const { readFileSync } = await import('node:fs')
  const webhook = readFileSync('supabase/functions/ontvang-mail/index.ts', 'utf8')
  const exact = readFileSync('supabase/functions/exact/index.ts', 'utf8')

  const { TESTFACTUREN, testfactuurPdf } = await import('../../src/lib/testfacturen')

  /* ---- de tweede deur ---- */

  check('een proefbericht moet van een ontwikkelaar komen',
    /isOntwikkelaar/.test(webhook)
    && webhook.includes("includes('developer')"))

  /*
   * Zonder de vlag geldt de handtekening onverkort. Zou de proefweg buiten
   * die if vallen, dan is de handtekening optioneel geworden zonder dat het
   * ergens staat.
   */
  const deur = webhook.slice(webhook.indexOf('const proef = payload.proef === true'),
    webhook.indexOf('const soort = String(payload.type'))
  check('zonder die vlag blijft de handtekening van Resend gelden',
    deur.includes('handtekeningKlopt') && /}\s*else\s*{/.test(deur),
    deur.replace(/\s+/g, ' ').slice(0, 90))
  check('en een proefbericht zonder ontwikkelaar wordt geweigerd',
    deur.includes('403'))

  /* ---- de proefrit boekt niet ---- */

  const rit = exact.slice(exact.indexOf('async function proefrit()'),
    exact.indexOf('async function resultaat('))
  check('de proefrit doet alleen vragen aan Exact',
    rit.length > 0 && !rit.includes('exactPost('),
    rit.length ? 'er staat een exactPost in' : 'proefrit niet gevonden')
  check('en schrijft niets in onze eigen tabellen',
    !/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(rit))

  /*
   * En opnieuw ophalen laat de koppelingen met rust. exact_leverancier en
   * company_exact zijn met de hand gelegd; die zijn niet opnieuw op te halen
   * en horen dus nooit in een "alles weg"-knop te zitten.
   */
  const ronde = exact.slice(exact.indexOf('async function opnieuwOphalen('),
    exact.indexOf('async function opnieuwOphalen(') + 3000)
  const wist = [...ronde.matchAll(/from\('(\w+)'\)\s*\.delete\(/g)].map((m) => m[1])
  check('opnieuw ophalen gooit alleen de kopieën weg',
    wist.every((t) => ['exact_grootboek', 'exact_relatie', 'exact_personeel'].includes(t)),
    wist.join(', ') || '(niets)')
  check('en raakt de handgelegde koppelingen niet aan',
    !wist.includes('exact_leverancier') && !wist.includes('company_exact')
    && !wist.includes('exact_administratie'))

  /* ---- de gevallen ---- */

  check('elke proeffactuur zegt wat hij test',
    TESTFACTUREN.every((f) => f.test.trim().length > 10))
  check('en wat er hoort te gebeuren',
    TESTFACTUREN.every((f) => f.verwacht.trim().length > 20),
    TESTFACTUREN.filter((f) => f.verwacht.trim().length <= 20).map((f) => f.sleutel).join())
  check('de sleutels zijn uniek',
    new Set(TESTFACTUREN.map((f) => f.sleutel)).size === TESTFACTUREN.length)

  const van = (sleutel: string) => TESTFACTUREN.find((f) => f.sleutel === sleutel)!

  /*
   * De dubbele moet echt dezelfde leverancier én hetzelfde nummer hebben.
   * Wijkt er een van af, dan test hij niets -- en dat zie je niet, want er
   * gebeurt dan precies wat er bij een gewone factuur gebeurt.
   */
  check('de dubbele is echt dezelfde als de gewone',
    van('dubbel').nummer === van('gewoon').nummer
    && van('dubbel').leverancier === van('gewoon').leverancier)

  check('de verkoopfactuur staat op naam van Truckwash zelf',
    /truckwash/i.test(van('eigen-verkoop').leverancier)
    && Boolean(van('eigen-verkoop').kvk))

  check('de factuur voor een andere bv is aan een andere bv gericht',
    van('andere-bv').aan.some((r) => /vastgoed/i.test(r)))

  check('de onleesbare heeft geen bedrag en geen nummer',
    van('onleesbaar').excl === '' && van('onleesbaar').nummer === '')

  /* ---- en het papier ---- */

  const pdf = testfactuurPdf(van('gewoon'))
  const tekst = Buffer.from(pdf).toString('latin1')

  check('een proeffactuur is een geldige PDF',
    tekst.startsWith('%PDF-') && tekst.trimEnd().endsWith('%%EOF'))
  check('met het factuurnummer erop', tekst.includes('WT-2026-04412'))
  check('en het bedrag', tekst.includes('1.494,35'))
  check('en het rekeningnummer', tekst.includes('NL91 ABNA 0417 1643 00'))

  /*
   * Dat er PROEFFACTUUR op staat is geen nettigheid. Belandt er ooit een in
   * een echte stapel, dan moet iemand die deze knop niet kent het kunnen
   * zien -- op het papier zelf, niet in een veld in de database.
   */
  check('er staat PROEFFACTUUR op elke bladzijde', tekst.includes('PROEFFACTUUR'))

  const leeg = Buffer.from(testfactuurPdf(van('onleesbaar'))).toString('latin1')
  check('de onleesbare is ook een geldige PDF, maar zonder bedrag',
    leeg.startsWith('%PDF-') && !/EUR/.test(leeg))
}

/* ==================================================================== *
 *  72. Wat er omviel toen het echt aan ging
 *
 *  Twee fouten, allebei pas zichtbaar op de echte omgeving, en allebei van
 *  het soort dat er in een test niet uitkomt omdat er niets mis is met de
 *  logica -- ze gaan over de VORM van een verzoek.
 *
 *  1. "Failed to fetch" op elke proeffactuur.
 *
 *     ontvang-mail was jarenlang alleen een webhook: Resend belt hem van
 *     server naar server, en dan bestaat CORS niet. Sinds de proeffacturen
 *     wordt hij ook uit een browser gebeld, en die stuurt eerst een OPTIONS
 *     -- want er gaat een Authorization-kop mee. Daar kwam 405 op zonder
 *     toestemming, dus de echte POST is nooit verstuurd.
 *
 *     Het verraderlijke: in het scherm staat dan "Failed to fetch", wat
 *     eruitziet als een netwerkstoring terwijl de server nooit is
 *     aangesproken.
 *
 *  2. De serverfunctie exact gaf 546.
 *
 *     Dat is geen code van ons. Supabase geeft 546 bij WORKER_LIMIT: de
 *     worker is neergehaald omdat hij door zijn rekentijd of geheugen ging.
 *     Onze eigen catch komt daar niet meer aan te pas -- er is niets meer om
 *     mee te antwoorden, en dat is precies waarom het niet als nette fout
 *     verscheen.
 *
 *     De oorzaak was de vorm: elk ophalen liep over ALLE aangevinkte bv's in
 *     één verzoek. Dat is een grens die meegroeit met het werk, en dus geen
 *     grens. Bij één administratie valt het niemand op; bij de ruim twintig
 *     die hier staan valt hij altijd om.
 * ==================================================================== */

console.log('\n72. Wat er omviel toen het echt aan ging')

{
  const { readFileSync } = await import('node:fs')
  const webhook = readFileSync('supabase/functions/ontvang-mail/index.ts', 'utf8')
  const exact = readFileSync('supabase/functions/exact/index.ts', 'utf8')
  const client = readFileSync('src/lib/trucksupply.ts', 'utf8')

  /* ---- 1. de webhook is ook uit een browser bereikbaar ---- */

  check('ontvang-mail beantwoordt de preflight van de browser',
    /req\.method === 'OPTIONS'/.test(webhook))

  /*
   * En vóór de methodecontrole. Staat hij erna, dan krijgt een OPTIONS eerst
   * 405 en is er niets opgelost -- precies de fout die hier gerepareerd is.
   */
  const ingang = webhook.slice(webhook.indexOf('Deno.serve'))
  check('en wel vóór "alleen POST"',
    ingang.indexOf("=== 'OPTIONS'") < ingang.indexOf("!== 'POST'"))

  check('elk antwoord van ontvang-mail draagt de CORS-koppen',
    /headers: \{ \.\.\.CORS,/.test(webhook))

  /*
   * De deur zelf is niet mee opengegaan. CORS zegt welke PAGINA mag vragen,
   * niet wie er antwoord krijgt -- en dat blijft zo.
   */
  check('de handtekening en de ontwikkelaarscontrole staan er nog',
    webhook.includes('handtekeningKlopt') && webhook.includes('isOntwikkelaar'))

  /* ---- 2. geen verzoek loopt nog onbegrensd over alle bv's ---- */

  check('de serverfunctie kent een tijdsbudget', /const BUDGET_MS/.test(exact))

  /*
   * De vier plekken die per bv werk doen. Elk moet kunnen stoppen en zeggen
   * wat er nog ligt; anders is het opnieuw een verzoek zonder bovengrens.
   */
  for (const [naam, start, eind] of [
    ['syncGrootboek', 'async function syncGrootboek(', 'async function grootboekStand('],
    ['syncRelaties', 'async function syncRelaties(', 'async function relatiesStand('],
    ['proefrit', 'async function proefrit(', 'async function lees('],
    ['resultaat', 'async function resultaat(', 'async function brugStand('],
  ] as const) {
    const blok = exact.slice(exact.indexOf(start), exact.indexOf(eind))
    check(`${naam} stopt als zijn tijd op is`,
      blok.length > 0 && blok.includes('nogTijd(begonnen)'),
      blok.length ? 'geen tijdsbewaking' : 'blok niet gevonden')
  }

  /*
   * En de eerste bv gaat altijd door. Zonder die uitzondering kan een ronde
   * nul bv's doen -- en dan draait de client eeuwig rond zonder dat er iets
   * opschiet. Een lus die niet vordert is erger dan een die lang duurt.
   */
  check('elke ronde doet minstens één bv',
    (exact.match(/n > 0 && !nogTijd\(begonnen\)/g) ?? []).length >= 3)

  /* ---- de lus staat op één plek ---- */

  check('de client maakt de rondes af', /async function inRondes</.test(client))
  check('en heeft een noodrem als er niets meer vordert',
    /MAX_RONDES/.test(client) && client.includes('n < MAX_RONDES'))

  /*
   * Drie schermen halen op. Zouden ze elk hun eigen lus draaien, dan is er
   * één die het vergeet -- en die toont een half opgehaald rekeningschema
   * als een heel.
   */
  for (const fn of ['exactSyncGrootboek', 'exactSyncRelaties', 'exactOpnieuwOphalen']) {
    const blok = client.slice(client.indexOf(`export async function ${fn}(`),
      client.indexOf(`export async function ${fn}(`) + 900)
    check(`${fn} gaat door de lus`, blok.includes('inRondes'))
  }

  /*
   * Het resultaat telt de rondes bij elkaar op in plaats van de laatste te
   * nemen. Zou dat laatste gebeuren, dan stond er een resultaat van vier
   * bv's onder een lijst van twintig -- erger dan een foutmelding, want het
   * ziet er goed uit.
   */
  const res = client.slice(client.indexOf('export async function exactResultaat('),
    client.indexOf('export async function exactOpnieuwOphalen('))
  check('exactResultaat voegt de rondes samen',
    res.includes('perBv.push(...uit.perBv)')
    && res.includes('gelukt.reduce'))

  /*
   * En opnieuw ophalen ruimt pas op als alles binnen is. Zou de opruiming
   * halverwege draaien, dan gooit ze de bv's weg die nog niet aan de beurt
   * waren -- en dan staat het rekeningschema half leeg terwijl het scherm
   * zegt dat het goed ging.
   */
  const gb = exact.slice(exact.indexOf('async function syncGrootboek('),
    exact.indexOf('async function grootboekStand('))
  check('de opruiming wacht tot de laatste bv',
    gb.indexOf('if (rest.length)') < gb.indexOf("delete().not('division'"))
}

/* ==================================================================== *
 *  76. De knop om te versturen staat waar je hem zoekt
 *
 *  Casper: "Hij geeft aan dat je moet boeken? maar ik kan niks vinden."
 *
 *  Er viel niets te vinden: versturen kon alleen bij Ontwikkeling, Exact --
 *  een scherm waar de administratie niet komt. Op de plek waar staat dat er
 *  iets blijft liggen stond geen enkele handeling.
 *
 *  Dat is de klasse fout die deze controle vasthoudt: een melding die zegt
 *  dat er nog iets moet gebeuren, zonder dat er iets te doen valt.
 * ==================================================================== */

console.log('\n76. Versturen naar Exact')

{
  const { readFileSync } = await import('node:fs')
  const scherm = readFileSync('src/dashboards/administratie/NaarExact.tsx', 'utf8')
  const dash = readFileSync('src/dashboards/administratie/AdministratieDashboard.tsx', 'utf8')

  check('de administratie kan zelf versturen',
    scherm.includes('exactStuurFacturen'),
    'versturen kan alleen nog bij Ontwikkeling')

  /* En de schakelaar erbij. Zonder dat ziet de administratie een knop die
     niets doet en kan ze nergens zien waarom -- precies het raadsel dat we
     aan het oplossen zijn. exact_facturen staat sinds 0072 in
     is_boekhoud_instelling(), dus de database laat het toe. */
  check('en de schakelaar staat op hetzelfde scherm',
    scherm.includes("zetInstelling('exact_facturen'"))

  check('het scherm hangt in het boekhoudingsdashboard',
    dash.includes('<NaarExact'))

  /*
   * De zin die Casper op pad stuurde. Die las als een opdracht om ergens te
   * gaan boeken, terwijl het omgekeerde bedoeld was: er ontbreekt iets, en
   * drukken helpt niet.
   *
   * Alleen wat er op het SCHERM komt, want de uitleg eromheen citeert de
   * oude zin -- dat hoort ook, anders zet iemand hem over een half jaar
   * terug. De eerste versie van deze controle zocht in het hele bestand en
   * sloeg aan op zijn eigen toelichting.
   */
  const jsx = scherm.replace(/\/\*[\s\S]*?\*\//g, '')
  check('de melding leest niet meer als een opdracht',
    !jsx.includes('klaarstaan om op te boeken'),
    'de oude zin staat er nog')
  check('en zegt wat er dan wel aan de hand is',
    jsx.includes('omdat er iets ontbreekt dat Exact nodig heeft'))

  /* Geen stille bovengrens: de server pakt er 25 per keer, en dat hoort op
     het scherm te staan -- anders lijkt de rest overgeslagen. */
  const exactFn = readFileSync('supabase/functions/exact/index.ts', 'utf8')
  /*
   * Op de REGEL en niet op de letterlijke tekst: die stond eerst als
   * `klaar.slice(0, 25)` en werd `meedoen.slice(0, 25)` toen er een losse
   * bon bij kwam. De bovengrens is wat telt, niet hoe de variabele heet.
   */
  check('de server pakt er hoogstens 25 per keer',
    /\.slice\(0, 25\)/.test(exactFn),
    'de bovengrens per ronde staat niet meer in de serverfunctie')
  check('en dat staat ook op het scherm',
    scherm.includes('klaar.length > 25'),
    'de bovengrens staat nergens')

  /* ------------------------------------------------------------------ *
   *  Wat "dezelfde naam" is, bepaalt de database
   *
   *  Casper: "Ik koppel hem steeds, hij geeft aan dat hij gekoppeld is en
   *  vervolgens blijft hij erop staan dat die niet gekoppeld is."
   *
   *  Het scherm rekende de zoeknaam zelf uit met een nagebouwde
   *  kaal_bedrijf(). Bij elke B.V. gaf die iets anders dan de database:
   *
   *    database  "Van der Velden Amsterdam B.V." -> van der velden amsterdam
   *    scherm                                    -> ... amsterdam b v
   *
   *  De koppeling werd dus opgeslagen onder een naam waar de join nooit naar
   *  zoekt. Opslaan lukte, terugvinden niet, en het scherm bleef zeggen dat
   *  er geen crediteur was.
   *
   *  Twee implementaties van dezelfde regel lopen uit elkaar; dat is geen
   *  vermoeden meer maar wat hier gebeurd is. Deze controle houdt vast dat er
   *  nog maar één is.
   * ------------------------------------------------------------------ */

  check('het scherm bouwt kaal_bedrijf niet na',
    !/\(bvba\|bv\|nv\|vof\|cv\|/.test(scherm),
    'er staat weer een eigen kaalmaker in het scherm')

  check('de serverfunctie haalt de naam door de database',
    exactFn.includes("admin.rpc('kaal_bedrijf'"),
    'de zoeknaam komt nog van de aanroeper')

  /* En de sleutel waarop de join zoekt is dezelfde functie. Zou dat ooit
     uiteenlopen, dan is de reparatie hierboven zinloos. */
  const m88 = readFileSync('supabase/migrations/0086_alles_per_bv.sql', 'utf8')
  check('en de join zoekt op precies die uitkomst',
    m88.includes('l.zoeknaam = public.kaal_bedrijf(b.supplier)'))

  /* De scheve rijen die er al staan worden rechtgezet, want Casper heeft er
     een paar gemaakt voordat dit gevonden werd. */
  const herstel = readFileSync(
    'supabase/migrations/0088_de_koppeling_die_niemand_terugvond.sql', 'utf8')
  check('en wat er scheef staat wordt rechtgezet',
    herstel.includes('set zoeknaam   = public.kaal_bedrijf(l.gezien_als)'))
}

/* ==================================================================== *
 *  77. Wat Exact van een inkoopboeking eist
 *
 *  Exact weigerde de eerste echte boeking met vijf regels tegelijk, en vier
 *  daarvan wist Exact zelf al. Casper: "zoveel mogelijk uit exact gebruiken."
 *
 *  De ergste van de vijf was een omgekeerde aanname: wij hielden
 *  Journals.Type 20 voor het inkoopdagboek, terwijl 20 VERKOOP is en 22
 *  inkoop. Daardoor keurde de proefrit een goed dagboek af en een verkeerd
 *  goed -- groen scherm, geweigerde boeking.
 *
 *  Zulke getallen staan in de documentatie van Exact en nergens anders. Deze
 *  controle houdt vast wat daar is nagekeken, zodat het niet terugglijdt naar
 *  wat plausibel lijkt.
 * ==================================================================== */

console.log('\n77. Wat Exact van een inkoopboeking eist')

{
  const { readFileSync } = await import('node:fs')
  const fn = readFileSync('supabase/functions/exact/index.ts', 'utf8')
  const m89 = readFileSync('supabase/migrations/0089_wat_exact_zelf_al_wist.sql', 'utf8')

  /* --- 1. het dagboektype --- */

  check('een inkoopdagboek is type 22, niet 20',
    /const DAGBOEK_INKOOP = 22/.test(fn),
    'DAGBOEK_INKOOP staat niet op 22')

  /* Nergens nog een losse 20 als dagboektype. Die stond op twee plekken en
     één ervan was de proefrit, die het dus niet ving. */
  check('en dat getal staat op één plek',
    !/Type === 20|soort !== 20|r\.Type === 20/.test(fn),
    'er staat nog ergens een dagboektype 20')

  /* --- 2. de vier dingen die Exact zelf weet --- */

  check('het dagboek komt uit Exact',
    fn.includes("'financial/Journals'") && fn.includes('GLAccount'),
    'de crediteurenrekening van het dagboek wordt niet opgehaald')

  check('een verkoop-btw-code gaat er niet meer in',
    fn.includes('VATTransactionType'),
    'het type van een btw-code wordt nergens gelezen')

  check('de betalingsconditie komt van de crediteur in Exact',
    fn.includes('PaymentConditionPurchase') && fn.includes('PaymentCondition:'),
    'de betalingsconditie wordt niet opgehaald of niet meegestuurd')

  check('de crediteurenrekening van de relatie ook',
    fn.includes('GLAP'),
    'crm/Accounts.GLAP wordt niet gelezen')

  /* --- 3. het ene dat Exact NIET weet --- */

  check('de vervaldatum gaat mee naar Exact',
    fn.includes('DueDate:'),
    'DueDate wordt niet meegestuurd')

  check('en komt uit de wachtrij, van het papier',
    m89.includes('b.vervaldatum') && fn.includes('bon.vervaldatum'),
    'de vervaldatum komt niet uit exact_facturen_wachtend')

  /*
   * Geen verzonnen termijn. Een vervaldatum bepaalt wanneer er betaald
   * wordt; er dagen bij optellen omdat het veld verplicht is, is geld
   * verplaatsen op een aanname.
   */
  check('zonder vervaldatum wordt er geen termijn verzonnen',
    fn.includes('bon.vervaldatum || bon.datum'),
    'er wordt een vervaldatum berekend in plaats van overgenomen')

  /* --- 4. en de rechten na de drop --- */

  check('de rechten staan na de drop weer goed',
    m89.includes('revoke execute on function public.exact_facturen_wachtend() from public, anon, authenticated')
    && m89.includes('grant  execute on function public.exact_facturen_wachtend() to service_role'))
}

/* ==================================================================== *
 *  78. Een koppeling die verkeerd staat
 *
 *  Exact weigerde een factuur van "Van der Velden Amsterdam B.V." met de
 *  melding dat "Vrienden van De Hoop" geen betalingsconditie had. Die naam
 *  kwam uit Exact, opgehaald met het crediteurnummer dat wij bij Van der
 *  Velden hadden staan: de koppeling wees naar een andere relatie.
 *
 *  Erger dan de verkeerde koppeling was dat er geen scherm voor was. De knop
 *  "Koppelen" stond alleen bij facturen die nog GEEN crediteur hadden; zodra
 *  er een koppeling stond, ook een verkeerde, was hij nergens meer te zien of
 *  te wijzigen. En een verkeerde koppeling ziet er aan de factuur compleet
 *  uit -- hij gaat gewoon mee, naar de rekening van iemand anders.
 *
 *  Dat het hier strandde was toeval. Deze controle houdt vast dat de
 *  koppelingen zichtbaar en terug te draaien blijven.
 * ==================================================================== */

console.log('\n78. Een koppeling die verkeerd staat')

{
  const { readFileSync } = await import('node:fs')
  const fn = readFileSync('supabase/functions/exact/index.ts', 'utf8')
  const api = readFileSync('src/lib/trucksupply.ts', 'utf8')
  const scherm = readFileSync('src/dashboards/administratie/NaarExact.tsx', 'utf8')

  /* --- 1. de server geeft ze mee --- */

  check('de koppelingen komen mee met de stand',
    /from\('exact_leverancier'\)[\s\S]{0,200}gezien_als/.test(fn)
    && fn.includes('koppelingen: (koppels ?? [])'),
    'facturen-stand stuurt de bestaande koppelingen niet mee')

  check('met de naam zoals hij op de bon stond',
    fn.includes('gezienAls: (r.gezien_als as string)'),
    'gezien_als gaat niet mee -- dan staat er alleen een kale zoeknaam')

  check('en de client kent het veld',
    api.includes('koppelingen: ExactKoppeling[]')
    && api.includes('koppelingen: uit.koppelingen ?? []'),
    'FacturenStand heeft geen koppelingen')

  /* --- 2. het scherm toont ze, en allebei de namen --- */

  check('er is een kaart met de koppelingen',
    scherm.includes('function Koppelingen(') && scherm.includes('<Koppelingen'),
    'de kaart bestaat niet of hangt nergens in')

  /*
   * De twee namen naast elkaar is de hele truc. Alleen "gekoppeld: ja" zegt
   * niets -- de koppeling van Casper stond op ja.
   */
  check('beide namen staan naast elkaar',
    scherm.includes('Leverancier op de bon') && scherm.includes('Wordt geboekt op'),
    'het scherm toont niet aan welke crediteur er geboekt wordt')

  check('een koppeling is te wijzigen en los te maken',
    /koppel\(k\.naam, k\.administratie\)/.test(scherm)
    && /exactKoppelLeverancier\(k\.naam, null,/.test(scherm),
    'een bestaande koppeling is niet te wijzigen of terug te draaien')

  /* --- 3. het vlaggetje is een aanwijzing, geen oordeel --- */

  check('namen die niet op elkaar lijken komen bovenaan',
    scherm.includes('function lijktOp(') && scherm.includes('vreemd'),
    'er is niets dat een vreemde combinatie laat opvallen')

  /*
   * Korte woorden tellen niet mee. "de", "van" en "b v" staan in half
   * Nederland; zouden die meetellen, dan lijkt alles op elkaar en wijst het
   * vlaggetje nergens meer naar.
   */
  check('korte woorden tellen niet mee bij dat vergelijken',
    /w\.length > 3/.test(scherm),
    'lijktOp() telt woorden van drie letters of korter mee')

  /* Niets wordt hierop geweigerd: een bv mag haar crediteuren noemen zoals
     ze wil, en Shell heet in Exact geregeld anders dan op de bon. */
  check('maar er wordt niets op geblokkeerd',
    !/vreemd[\s\S]{0,80}disabled/.test(scherm),
    'een vreemd ogende naam zet een knop uit -- dat is een oordeel te ver')

  /* --- 4. en waar het in Exact zelf staat --- */

  /*
   * Casper: "En waar in exact kan ik hem terugvinden?" Wij weten het nummer
   * van de relatie en van de administratie al; dan is een link een beter
   * antwoord dan een menupad uit het hoofd.
   */
  check('je klikt vanaf de crediteur door naar Exact',
    api.includes('export function exactRelatieLink(')
    && scherm.includes('exactRelatieLink(stand.exactBasis'),
    'er is geen doorklik naar de relatie in Exact')

  check('en dat gaat naar het adres van de juiste landversie',
    api.includes('CRMAccountCard.aspx') && fn.includes('exactBasis: sleutelsVan('),
    'de link gebruikt een vast adres in plaats van de ingestelde omgeving')

  /* Een link kan verouderen, een menupad niet. Ze staan er allebei. */
  check('het menupad staat er los van de link bij',
    /tabblad Boekhouding/.test(scherm),
    'zonder link is er geen antwoord meer op de vraag waar het in Exact staat')
}

/* ==================================================================== *
 *  79. Het nummer waarop je een boeking terugvindt
 *
 *  Casper: "Ik kan hem nergens in exact vinden, kan het zijn omdat er in
 *  exact al eentje staat?"
 *
 *  Nee -- de boeking was gelukt. Wat wij hem gaven was de EntryID van Exact:
 *  een guid, en die staat op geen enkel scherm van Exact en is er niet op te
 *  zoeken. Het EntryNumber, het boekstuknummer, is wat er wel op staat. Dat
 *  kregen we in hetzelfde antwoord al mee en gooiden we weg.
 *
 *  Zijn vermoeden was los daarvan terecht: Exact weigert een tweede boeking
 *  van dezelfde factuur niet. Aan onze kant kan het niet, maar Blue10 boekt
 *  voorlopig nog mee.
 * ==================================================================== */

console.log('\n79. Het nummer waarop je een boeking terugvindt')

{
  const { readFileSync } = await import('node:fs')
  const fn = readFileSync('supabase/functions/exact/index.ts', 'utf8')
  const m90 = readFileSync('supabase/migrations/0090_het_nummer_waarop_je_hem_terugvindt.sql', 'utf8')
  const types = readFileSync('src/lib/types.ts', 'utf8')
  const scherm = readFileSync('src/dashboards/administratie/Kostenposten.tsx', 'utf8')

  /* --- 1. het boekstuknummer wordt bewaard --- */

  check('het boekstuknummer wordt bewaard, niet alleen de guid',
    /exact_nummer: uit\.EntryNumber/.test(fn)
    && m90.includes('add column if not exists exact_nummer'),
    'EntryNumber wordt weggegooid -- dan blijft er een guid over om mee te zoeken')

  /* Boekstuknummers lopen per dagboek. Sinds 0089 kiest de verzendlus het
     dagboek zelf, en welk het werd legden we nergens vast. */
  check('en het dagboek waar hij in kwam',
    /exact_dagboek: dagboek/.test(fn)
    && m90.includes('add column if not exists exact_dagboek'),
    'het gekozen dagboek wordt niet bewaard')

  /*
   * De guid blijft leidend. Daar hangt de uniciteitsindex van 0053 aan, en
   * die is de garantie dat dezelfde bon niet twee keer naar Exact gaat.
   */
  check('de guid blijft het veld waar de uniciteit aan hangt',
    /exact_id: id,/.test(fn),
    'exact_id wordt niet meer met de EntryID gevuld')

  /* --- 2. en je ziet hem terug --- */

  check('de app kent de twee velden',
    types.includes('exactNummer?: string') && types.includes('exactDagboek?: string'),
    'Expense heeft het boekstuknummer niet')

  check('het scherm zegt waar de boeking in Exact staat',
    scherm.includes('label="In Exact"') && scherm.includes('Boekstuk'),
    'het scherm noemt het boekstuknummer nergens')

  /* Oude boekingen hebben geen nummer; die stonden er al voordat we het
     bewaarden. Een leeg vak is daar geen antwoord op. */
  check('en bij oude boekingen wat je dan doet',
    scherm.includes('voor we het boekstuknummer bewaarden'),
    'zonder nummer staat er niets over hoe je hem dan vindt')

  check('de historieregel noemt het nummer ook',
    m90.includes("coalesce(nullif(new.exact_nummer, ''), new.exact_id)"),
    'de regel in de historie toont nog steeds alleen de guid')

  /* --- 3. en niet twee keer dezelfde factuur --- */

  /*
   * Exact weigert een dubbele boeking niet; hij maakt er netjes nog een.
   * Onze kant is gedekt door exact_id, maar dat beschermt alleen tegen
   * onszelf -- Blue10 en handmatige invoer zien wij niet.
   */
  check('er wordt eerst gevraagd of hij er al staat',
    /YourRef eq/.test(fn) && fn.includes('Deze factuur staat al in Exact'),
    'er gaat een boeking heen zonder te kijken of dezelfde factuur er al is')

  /* Zonder factuurnummer valt er niets te vergelijken. Dan die controle
     overslaan, en niet elke bon zonder nummer voor een dubbele aanzien. */
  check('behalve als er geen factuurnummer is',
    /if \(ref\) \{/.test(fn),
    'de dubbelcontrole draait ook zonder factuurnummer')
}

/* ==================================================================== *
 *  83. Welke rekeningen bij welke onderneming horen
 *
 *  Casper: "maar hij geeft nog steeds codes van de hoofdvestiging, terwijl
 *  ik een andere geselecteerd heb."
 *
 *  De regel was "een rekening zonder bv geldt overal". Dat klonk als een
 *  nette terugval op de oude situatie, en het was het niet: die rekeningen
 *  zonder bv ZIJN de lijst die ooit als eerste is binnengehaald -- die van de
 *  hoofdadministratie. Ze verschenen dus in elke bv.
 *
 *  Dit is geen tekstcontrole maar een gedragscontrole. De vorige ronde had
 *  een regex die aansloeg op rekeningenVoor() en niets zei over wat hij
 *  teruggeeft -- en precies daarom stond de fout er nog.
 * ==================================================================== */

console.log('\n83. Welke rekeningen bij welke onderneming horen')

{
  const { rekeningenVan, rekeningNaam, bvVanBon } = await import('../../src/lib/boeking')

  /* Wat Exact kent, per administratie. Dit is de bron; wij kopiëren hem niet
     meer (0104). */
  const uitExact = (code: string, division: string, geblokkeerd = false) => ({
    id: `${division}::${code}`,
    code,
    omschrijving: `Exact ${code}`,
    geblokkeerd,
    division,
    updatedAt: 0,
  })

  /* En wat van ons is: een eigen naam en de trefwoorden. Op code, want daar
     horen ze bij. */
  const vanOns = (code: string, trefwoorden: string[] = [], naam?: string) => ({
    id: `gb_${code}`,
    code,
    naam: naam ?? `Rekening ${code}`,
    trefwoorden,
    actief: true,
    updatedAt: 0,
  })

  const schema = [
    uitExact('4000', '3630506'), uitExact('7100', '3630506'),
    uitExact('4000', '2392511'), uitExact('4010', '2392511'),
    uitExact('4900', '3630506', true),
  ]
  const onze = [vanOns('4000', ['shell', 'tankpas'], 'Brandstof')]

  const codes = (bv?: string, huidige?: string) =>
    rekeningenVan(schema, onze, bv, huidige).map((g) => g.code).join(',')

  check('een bv ziet de rekeningen die Exact daar kent',
    codes('3630506') === '4000,7100', codes('3630506'))

  /* Dit was de melding: rekeningen van de ene administratie doken op in de
     andere. Nu kan dat niet meer -- de lijst kómt uit die administratie. */
  check('en niet die van een andere administratie',
    !codes('3630506').includes('4010'), codes('3630506'))

  check('een andere bv ziet de zijne',
    codes('2392511') === '4000,4010', codes('2392511'))

  /*
   * En dit is de kern van 0104: een trefwoord hoort bij de CODE. Wie bij de
   * ene bv "shell" op 4000 zet, hoort dat bij de andere terug te zien --
   * daarvoor moest het twintig keer worden ingetikt, of deed het bij
   * negentien bv's niets.
   */
  const inVenlo = rekeningenVan(schema, onze, '2392511').find((g) => g.code === '4000')
  check('een trefwoord van één bv geldt bij alle bv’s',
    (inVenlo?.trefwoorden ?? []).includes('shell'),
    JSON.stringify(inVenlo?.trefwoorden))
  check('en onze eigen naam reist mee',
    inVenlo?.naam === 'Brandstof', String(inVenlo?.naam))

  /* Waar wij niets over te zeggen hebben, gebruikt hij de naam van Exact. */
  const zonderOns = rekeningenVan(schema, onze, '3630506').find((g) => g.code === '7100')
  check('en anders die van Exact',
    zonderOns?.naam === 'Exact 7100', String(zonderOns?.naam))

  /* Een in Exact geblokkeerde rekening is niet te boeken -- behalve als hij
     er nu op staat, want dan hoort te blijven staan wat er staat. */
  check('een geblokkeerde rekening staat er niet bij',
    !codes('3630506').includes('4900'), codes('3630506'))
  check('behalve de rekening die er nu op staat',
    codes('3630506', '4900').includes('4900'), codes('3630506', '4900'))

  /* Zonder bv: alles, en elke code één keer. */
  check('zonder bv staat elke code er één keer',
    codes(undefined) === '4000,4010,7100', codes(undefined))

  /*
   * Geen schema binnengehaald? Dan onze eigen lijst. Dat is de installatie
   * zonder Exact-koppeling, en het moment vlak na het inloggen. Een lege
   * keuzelijst zou daar zeggen "er is geen enkele rekening", en dat is iets
   * anders dan "ik weet het nog niet".
   */
  check('zonder schema valt hij terug op onze eigen lijst',
    rekeningenVan([], onze, '3630506').map((g) => g.code).join(',') === '4000',
    rekeningenVan([], onze, '3630506').map((g) => g.code).join(','))

  /* --- de naam bij een code --- */

  check('de naam komt van ons als wij er een hebben',
    rekeningNaam('4000', onze, schema) === '4000 · Brandstof',
    rekeningNaam('4000', onze, schema))

  /*
   * En anders uit het schema van Exact. Sinds 0104 bewaren we van een
   * rekening waar wij niets over te zeggen hebben geen eigen kopie meer;
   * zonder die tweede bron zou een oude boeking hier als kaal nummer staan.
   */
  check('en anders uit het schema van Exact',
    rekeningNaam('7100', onze, schema) === '7100 · Exact 7100',
    rekeningNaam('7100', onze, schema))

  check('en als niemand hem kent, het nummer zelf',
    rekeningNaam('9999', onze, schema) === '9999',
    rekeningNaam('9999', onze, schema))

  /* --- en welke bv het is --- */

  const bon = (administratie?: string, locationId?: string) =>
    ({ id: 'e1', administratie, locationId } as never)

  const vestigingen = [{ id: 'loc_venlo', administratie: '2392511' }]
  const bedrijven = [{ code: '3050842', hoofd: true }, { code: '2392511' }]

  check('wat op de bon staat gaat voor',
    bvVanBon(bon('3630506', 'loc_venlo'), vestigingen, bedrijven) === '3630506')

  check('anders die van zijn vestiging',
    bvVanBon(bon(undefined, 'loc_venlo'), vestigingen, bedrijven) === '2392511')

  check('en anders de hoofdadministratie',
    bvVanBon(bon(), vestigingen, bedrijven) === '3050842')
}

/* ==================================================================== *
 *  84. De rekeningen komen van de bv zelf
 *
 *  Casper: "maar kan je niet zorgen dat je die grootboekrekeningen bij het
 *  zoeken dynamisch ophaalt?"
 *
 *  Dat kan, en het is bovendien de juiste lijst. Er staan twee schema's in
 *  dit systeem en ze doen niet hetzelfde:
 *
 *    exact_grootboek   wat Exact kent, per administratie
 *    public.grootboek  onze korte lijst met eigen namen en trefwoorden
 *
 *  En de boeking hangt aan de eerste: exact_facturen_wachtend() zoekt de guid
 *  op in exact_grootboek (code + division). Wat Exact in die bv kent is dus
 *  boekbaar, of wij het hebben overgenomen of niet -- "eerst overnemen" was
 *  een tussenstap die alleen wij nodig hadden.
 * ==================================================================== */

console.log('\n84. De rekeningen komen van de bv zelf')

{
  const { readFileSync } = await import('node:fs')
  const lib = readFileSync('src/lib/rekeningen.ts', 'utf8')
  const scherm = readFileSync('src/dashboards/administratie/Kostenposten.tsx', 'utf8')
  const naarExact = readFileSync('src/dashboards/administratie/NaarExact.tsx', 'utf8')
  const migratie = readFileSync('supabase/bijwerken.sql', 'utf8')

  /*
   * De aanname waar dit op rust. Zou de wachtrij de guid uit public.grootboek
   * halen, dan MOET er eerst overgenomen worden en is deze hele wijziging
   * fout. Daarom staat hij hier vast.
   */
  check('de boeking zoekt de rekening op in het schema van Exact',
    /left join public\.exact_grootboek\s+g on g\.code = b\.grootboek_code/.test(migratie)
      && /g\.division = b\.adm/.test(migratie),
    'exact_facturen_wachtend haalt de rekening ergens anders vandaan')

  /* --- 1. ophalen per bv --- */

  check('het schema wordt per bv opgehaald',
    lib.includes('exactGrootboekStand(bv)') && lib.includes('export function useRekeningen('),
    'er wordt niets opgehaald')

  check('en beide keuzelijsten gebruiken het',
    (scherm.match(/useRekeningen\(/g) ?? []).length >= 2,
    'de verdeling of de bon haalt zijn lijst nog ergens anders')

  /*
   * Eén vraag per bv, niet per toetsaanslag en niet per keuzelijst. Twee
   * lijsten op hetzelfde scherm horen op dezelfde ronde te wachten.
   */
  check('één vraag per bv, ook bij twee lijsten op één scherm',
    lib.includes('const onderweg = new Map<string, Promise<Regel[]>>()'),
    'twee keuzelijsten sturen ieder hun eigen vraag')

  /* --- 2. en het blijft werken zonder verbinding --- */

  /*
   * Dit is een offline-first app. Een lijst die leeg is omdat de server niet
   * bereikbaar was, is erger dan een lijst die een dag oud is.
   */
  check('zonder verbinding blijft de lokale lijst staan',
    lib.includes('rekeningenVan(schema, lokaal, bv, huidige)'),
    'er is geen terugval op wat er lokaal staat')

  /*
   * En die terugval leest het schema van Exact, niet onze eigen kopie.
   *
   * Dat verschil is niet cosmetisch. In IndexedDB staat grootboek op CODE,
   * dus van twintig bv's bleef er lokaal één rij per code over -- de bv die
   * als laatste binnenkwam. Zonder verbinding keek je dus naar de rekeningen
   * van een willekeurige administratie, met het label van de jouwe.
   */
  check('en die terugval komt uit het schema van Exact',
    lib.includes('db.exactGrootboek.toArray()'),
    'de terugval leest nog de eigen kopie')

  check('en een mislukte ronde wordt niet onthouden',
    /belofte\.catch\(\(\) => \{ onderweg\.delete\(bv\) \}\)/.test(lib),
    'na één mislukte poging blijft de lijst leeg')

  /* Een in Exact geblokkeerde rekening is niet te boeken; hem aanbieden is
     een keuze die pas bij het versturen wordt geweigerd. */
  check('een geblokkeerde rekening is niet te kiezen',
    /!r\.geblokkeerd \|\| r\.code === huidige/.test(lib),
    'een geblokkeerde rekening staat gewoon in de lijst')

  /* --- 3. overnemen is iets anders geworden --- */

  /*
   * Eerst bleef de knop "overnemen" staan met een andere belofte: eigen namen
   * en trefwoorden. Een ronde later bleek ook dat niet meer nodig -- 0093
   * haalt de trefwoorden uit een weergave per CODE, los van de bv. Toen kon
   * de kaart helemaal weg.
   *
   * Wat overblijft is dat het geheugen te wissen is. Dat hangt niet meer aan
   * die kaart maar het blijft nodig: wie in Exact een rekening hernoemt of
   * blokkeert, hoort dat te zien zonder de app opnieuw te openen.
   */
  check('het geheugen van de rekeningen is te wissen',
    lib.includes('export function vergeetRekeningen('),
    'een gewijzigd schema blijft staan tot de app opnieuw opent')
}

/* ==================================================================== *
 *  85. Van onderneming wisselen laat geen rekening achter die daar niet bestaat
 *
 *  Casper: "dus hij pakt per onderneming de code?" Ja -- en toen ik dat
 *  natrok bleek er een gat te zitten aan de andere kant van dezelfde vraag.
 *
 *  Van bv wisselen liet de grootboekrekening staan zoals hij stond. Dat ziet
 *  er goed uit, want de keuzelijst toont de rekening die erop staat altijd,
 *  ook als hij bij een andere administratie hoort. Maar rekening 4040 van de
 *  ene bv bestaat in de andere misschien niet, en dan blijft de factuur later
 *  liggen met "rekening 4040 bestaat niet in <bv>" -- ver weg van het moment
 *  waarop je van bv wisselde.
 * ==================================================================== */

console.log('\n85. Van onderneming wisselen laat geen verkeerde rekening achter')

{
  const { readFileSync } = await import('node:fs')
  const scherm = readFileSync('src/dashboards/administratie/Kostenposten.tsx', 'utf8')
  const lib = readFileSync('src/lib/rekeningen.ts', 'utf8')

  check('na het wisselen wordt de rekening nagekeken',
    /await zetOnderneming\(bon, code\)[\s\S]{0,900}?haalRekeningen\(code\)/.test(scherm),
    'de rekening blijft staan zonder dat iemand kijkt of hij daar bestaat')

  /* Leegmaken en niet stil laten staan: een leeg veld vraagt om een keuze,
     een verkeerd gevuld veld niet. */
  check('en leeggemaakt als hij daar niet bestaat',
    /grootboekCode: undefined \}\)[\s\S]{0,200}?bestaat niet in/.test(scherm),
    'er wordt niets gedaan met een rekening die daar niet bestaat')

  /*
   * De vraag "bestaat deze code in die bv" is er één, en daar hoort geen hook
   * bij -- die hangt aan een component die op dat moment nog de oude bv toont.
   */
  check('die vraag kan buiten een component om',
    lib.includes('export async function haalRekeningen('),
    'de lijst van een bv is alleen via een hook op te vragen')

  /* Dezelfde ronde, hetzelfde geheugen: wisselen mag geen tweede vraag naar
     dezelfde bv opleveren naast die van de keuzelijst eronder. */
  check('en gaat langs hetzelfde geheugen',
    /export async function haalRekeningen\([^)]*\): Promise<\{ code: string \}\[\]> \{\s*return haal\(bv\)/
      .test(lib),
    'haalRekeningen doet zijn eigen ronde')
}

/* ==================================================================== *
 *  86. De btw-code vraag je aan Exact, niet aan een instelling
 *
 *  Casper: "hij blijft kutten met exact en de codes inkoopdagboek, btwcodes
 *  ect, kan dit niet automatisch per onderneming? nu loopt hij er elke keer
 *  op vast..."
 *
 *  Hij liep vast op de laatste regel van kiesBtw(): zijn er meer inkoopcodes
 *  voor 21%, dan "kies er een bij de bv". Dat is een instelling die iemand met
 *  de hand moet zetten, twintig administraties lang -- precies wat er niet
 *  moest.
 *
 *  Niet raden was wél goed: een btw-code gokken levert btw op die niet op de
 *  factuur staat. Maar tussen raden en opgeven zit wat Exact zelf al weet, en
 *  dat werd niet gevraagd. Twee velden, allebei nagekeken in hun
 *  documentatie:
 *
 *      financial/GLAccounts.VATCode    "VAT Code linked to the G/L account"
 *      crm/Accounts.PurchaseVATCode    "Default VAT code used for purchase
 *                                       entries"
 * ==================================================================== */

console.log('\n86. De btw-code vraag je aan Exact, niet aan een instelling')

{
  const { readFileSync } = await import('node:fs')
  const fn = readFileSync('supabase/functions/exact/index.ts', 'utf8')
  const m93 = readFileSync(
    'supabase/migrations/0093_indelen_zonder_eerst_over_te_nemen.sql', 'utf8')
  const naarExact = readFileSync('src/dashboards/administratie/NaarExact.tsx', 'utf8')
  const dash = readFileSync('src/dashboards/administratie/AdministratieDashboard.tsx', 'utf8')

  /* --- 1. de twee bronnen die Exact al had --- */

  check('de btw-code van de grootboekrekening wordt gevraagd',
    fn.includes("'financial/GLAccounts'") && /\$select: 'VATCode'/.test(fn),
    'GLAccounts.VATCode wordt niet opgehaald')

  check('en die van de crediteur ook',
    fn.includes('PurchaseVATCode') && /btwCode: String\(r\?\.PurchaseVATCode/.test(fn),
    'Accounts.PurchaseVATCode wordt niet opgehaald')

  /* De rij groeide in 87 met de algemene instelling erachter; daarom niet op
     het einde van de lijst vastspijkeren maar op het begin ervan. */
  check('en ze gaan allebei mee naar kiesBtw',
    /\[rekeningBtw, cred\.btwCode[,\]]/.test(fn)
      && /\[regelRekeningBtw, cred\.btwCode[,\]]/.test(fn),
    'de voorkeuren komen niet bij de keuze terecht')

  /*
   * Een voorkeur blijft een voorkeur. Zou hij klakkeloos gevolgd worden, dan
   * is "niet raden" alsnog weg -- een verkeerd ingestelde standaard bij een
   * crediteur levert dan btw op die niet op de factuur staat.
   */
  check('maar een voorkeur wordt nagekeken en niet gevolgd',
    /const bruikbaarOp = \(code: string \| null \| undefined\)/.test(fn)
      && /for \(const v of voorkeuren\) \{[\s\S]{0,120}?bruikbaarOp\(v\)/.test(fn),
    'een voorkeur gaat er ongecontroleerd in')

  /* En als er echt niets is, nog steeds niet gokken. */
  check('en bij geen enkele aanwijzing wordt er niet gegokt',
    /heeft \$\{passend\.length\} inkoop-btw-codes/.test(fn),
    'er wordt een btw-code gekozen zonder aanwijzing')

  /*
   * De btw-code per rekening is een vraag per REKENING, niet per factuurregel.
   * Zonder geheugen wordt dat bij 25 bonnen een regen van verzoeken.
   */
  check('en één vraag per rekening, niet per regel',
    fn.includes('const btwPerRekening = new Map<string, string | null>()'),
    'de btw-code van een rekening wordt per factuurregel opnieuw gevraagd')

  /* --- 2. indelen hoeft niet meer te wachten op overnemen --- */

  check('indelen kijkt naar wat Exact in die bv kent',
    /from public\.exact_grootboek e\s*\n\s*where e\.division = administratie_in/.test(m93),
    'factuur_indelen eist nog steeds onze eigen lijst per bv')

  /* Een trefwoord hoort bij een CODE en niet bij een bv: "Enexis boekt op
     4010" is waar in elke administratie. */
  check('en de trefwoorden horen bij een code, niet bij een bv',
    m93.includes('create or replace view public.grootboek_trefwoorden'),
    'de trefwoorden hangen nog aan een administratie')

  check('en de weergave staat niet open voor anon',
    m93.includes('revoke all on public.grootboek_trefwoorden from public, anon'),
    'Supabase geeft een nieuwe weergave aan anon; die deur staat open')

  /* --- 3. en de kaarten die niets meer deden --- */

  check('de kaart met nullen is weg',
    !naarExact.includes('function Schema(') && !naarExact.includes('<Schema'),
    'de kaart die overal 0 liet zien staat er nog')

  check('en de grootboekrekeningen staan niet meer in Boekhouding',
    /<Inkoopinstellingen[^>]*rekeningen=\{false\}/.test(dash),
    'de grootboeklijst staat nog op het administratiescherm')
}

/* ==================================================================== *
 *  87. De instelling die ik een migratie te vroeg weghaalde
 *
 *  Casper: "maar hij laat nog steeds dingen vastlopen... kan je zorgen dat
 *  hij de verbinding maakt? automatisch? Nu doet hij alsnog niks."
 *
 *  Op zijn scherm stond het antwoord er allebei bij. De melding:
 *
 *      3630506 heeft 3 inkoop-btw-codes voor 0% (01, 0, 5), en Exact heeft er
 *      bij deze rekening en bij deze leverancier geen als standaard staan.
 *
 *  En in het instellingenveld eronder: btw-code 0% = 5. Dus hij HAD het
 *  ingevuld, en 5 is er één van de drie. Alleen werd dat veld niet meer
 *  gelezen: 0092 haalde de terugval op de globale sleutel uit
 *  bv_boekinstelling().
 *
 *  Die redenering was in 0086 juist -- een code uit de ene administratie in de
 *  andere is een gok -- en sinds 0089 niet meer. kiesBtw() en kiesDagboek()
 *  kijken elke code na tegen wat Exact in DIE bv heeft: mag hij voor inkoop,
 *  klopt het percentage, hoort het dagboek bij de crediteurenrekening. Wat die
 *  controle doorstaat is geen gok maar een antwoord.
 *
 *  Vandaar terug, maar achteraan in de rij: wat Exact zelf bij de rekening en
 *  de relatie heeft staan is specifieker en gaat voor.
 * ==================================================================== */

console.log('\n87. De instelling die ik een migratie te vroeg weghaalde')

{
  const { readFileSync } = await import('node:fs')
  const fn = readFileSync('supabase/functions/exact/index.ts', 'utf8')
  const naarExact = readFileSync('src/dashboards/administratie/NaarExact.tsx', 'utf8')

  /* --- 1. de algemene instelling telt weer mee --- */

  check('de algemene btw-instelling wordt weer gebruikt',
    /inst\.btw\[tariefBon as 21 \| 9 \| 0\]/.test(fn)
      && /inst\.btw\[tarief as 21 \| 9 \| 0\]/.test(fn),
    'het ingevulde veld bij Boekhouding doet nog steeds niets')

  check('en het algemene dagboek ook',
    /kiesDagboek\([\s\S]{0,120}?inst\.dagboek\)/.test(fn),
    'het ingevulde inkoopdagboek doet niets')

  /*
   * De volgorde is de bedoeling: Exact weet het specifieker dan wij. Staat de
   * algemene instelling vooraan, dan overrulet één veld van ons wat Exact bij
   * elke rekening apart heeft staan.
   */
  check('maar achter wat Exact bij de rekening en de relatie heeft staan',
    /\[rekeningBtw, cred\.btwCode, inst\.btw\[/.test(fn),
    'de algemene instelling gaat vóór wat Exact zelf weet')

  /* En nog steeds nagekeken, anders is het alsnog een gok. */
  check('en hij wordt nagekeken als elke andere bron',
    /for \(const v of voorkeuren\) \{[\s\S]{0,120}?bruikbaarOp\(v\)/.test(fn),
    'een voorkeur gaat er ongecontroleerd in')

  /* Het dagboek uit de algemene instelling moet in DEZE bv een inkoopdagboek
     zijn én bij de crediteurenrekening van deze relatie passen. */
  check('het algemene dagboek moet in die bv passen',
    /basis\.dagboeken\.find\(\(d\) => d\.code === voorkeur && past\(d\)\)/.test(fn),
    'het algemene dagboek wordt niet nagekeken')

  /* --- 2. en een koppeling die er niet uitziet als een vergissing --- */

  /*
   * In zijn lijst stond "Gemeente Venlo" gekoppeld aan "Pinpas/CC Klaus" en
   * "Vitens N.V." aan "Gemeente Rijssen-Holten". Allebei met de hand, allebei
   * uit een lijst waarin je twee regels langs elkaar schiet. De melding
   * achteraf stond er al; dit is het moment waarop iemand er nog naar kijkt.
   */
  check('bij het koppelen wordt gevraagd of een vreemde naam klopt',
    naarExact.includes('const [twijfel, setTwijfel] = useState<ExactCrediteur | null>(null)')
      && /if \(!lijktOp\(leverancier, c\.naam\)/.test(naarExact),
    'een koppeling aan een heel andere naam gaat er zonder vraag in')

  /* Vragen en niet weigeren: Shell heet in Exact geregeld anders dan op de
     bon, en een bv mag haar crediteuren noemen zoals ze wil. */
  check('en het blijft een vraag, geen verbod',
    naarExact.includes('Ja, koppel'),
    'er is geen manier om toch te koppelen')

  /* Dezelfde vraag op beide plekken: bij het maken en in de lijst erna. Twee
     eigen versies gaan uit elkaar lopen. */
  check('en het is dezelfde vraag als in de lijst eronder',
    (naarExact.match(/function lijktOp\(/g) ?? []).length === 1
      && (naarExact.match(/lijktOp\(/g) ?? []).length >= 3,
    'er staan twee versies van dezelfde vergelijking')
}

/* ==================================================================== *
 *  88. Een rekeningnummer met een cijfer ernaast
 *
 *  Casper: "Bij betalen kan hij het niet aanmaken? waarom?"
 *
 *  Omdat de enige openstaande factuur NL55BNGH0285000122 droeg, en dat nummer
 *  doorstaat de elfproef niet -- met dít rekeningnummer horen de
 *  controlecijfers 65 te zijn. De lezer zat er één cijfer naast, de SEPA-bouwer
 *  sloeg de factuur over, en dan blijft er niets over om in het bestand te
 *  zetten.
 *
 *  Twee dingen gingen daar mis, en het eerste is het vervelendst:
 *
 *    - de server stuurde per factuur de REDEN mee, en het scherm gooide die
 *      weg. De melding verwees naar "de lijst hieronder" en die lijst was er
 *      niet.
 *    - en er was geen manier om het nummer recht te zetten: het komt uit de
 *      lezing, en die staat sinds 0029 met opzet vast.
 * ==================================================================== */

console.log('\n88. Een rekeningnummer met een cijfer ernaast')

{
  const { readFileSync } = await import('node:fs')
  const api = readFileSync('src/lib/trucksupply.ts', 'utf8')
  const betalen = readFileSync('src/components/Exact.tsx', 'utf8')
  const scherm = readFileSync('src/dashboards/administratie/Kostenposten.tsx', 'utf8')
  const m94 = readFileSync(
    'supabase/migrations/0094_een_rekeningnummer_dat_verkeerd_gelezen_is.sql', 'utf8')

  /* --- 1. de elfproef, en dat hij hetzelfde rekent overal --- */

  const { ibanKlopt } = await import('../../src/lib/boeking')

  check('het nummer van die factuur wordt afgekeurd',
    !ibanKlopt('NL55BNGH0285000122'),
    'NL55BNGH0285000122 komt er gewoon door')

  /* En het nummer dat er wél bij hoort komt er wel door. Een controle die
     alles afkeurt is net zo stuk als een die alles doorlaat. */
  check('en het nummer dat er wel bij hoort komt erdoor',
    ibanKlopt('NL65BNGH0285000122'),
    'een geldig nummer wordt afgekeurd')

  check('spaties en kleine letters maken niet uit',
    ibanKlopt('nl65 bngh 0285 0001 22'),
    'hetzelfde nummer met spaties wordt afgekeurd')

  check('en iets wat geen IBAN is ook niet',
    !ibanKlopt('') && !ibanKlopt('NL65BNGH') && !ibanKlopt('12345678'),
    'een half nummer komt erdoor')

  /* --- 2. een weigering neemt zijn gegevens mee --- */

  /*
   * Dit is de klasse, niet het geval. Elke serverfunctie die nee zegt kan er
   * gegevens bij sturen; die gingen allemaal verloren op de rand tussen
   * server en scherm.
   */
  check('een weigering neemt mee wat de server erbij stuurde',
    api.includes('export class FunctieFout extends Error')
      && /throw new FunctieFout\(/.test(api),
    'een weigering is nog steeds een kale melding')

  check('en het betaalscherm laat per factuur zien waarom hij niet meekon',
    /e instanceof FunctieFout && Array\.isArray\(e\.details\.overgeslagen\)/.test(betalen),
    'de reden wordt nog steeds weggegooid')

  /* --- 3. en het is recht te zetten --- */

  /*
   * De lezing blijft staan. Een veld ernaast, met de lezing als terugval --
   * dezelfde opzet als bij de bv (0079). Zo is te zien waar het verschil zit,
   * en blijft het verslag een verslag.
   */
  check('er is een veld naast de lezing om het recht te zetten',
    m94.includes('add column if not exists betaal_iban')
      && scherm.includes('function Rekeningnummer('),
    'een misgelezen nummer is nog steeds niet te herstellen')

  check('en de betaling neemt dat veld vóór de lezing',
    /coalesce\(\s*\n\s*nullif\(upper\(replace\(coalesce\(e\.betaal_iban/.test(m94),
    'betaalbaar() kijkt nog steeds alleen naar de lezing')

  /* Een correctie die zelf niet klopt is geen correctie. De database houdt
     hem tegen; het scherm zegt het terwijl je typt. */
  check('een correctie die niet klopt komt er niet in',
    m94.includes('public.iban_klopt(betaal_iban)') && scherm.includes('De elfproef klopt niet.'),
    'er kan een nummer in dat de elfproef niet doorstaat')

  /* Waar het geld heen gaat hoort in hetzelfde rijtje als het bedrag en de
     rekening: in de historie, met wie en wanneer. */
  check('en de wijziging komt in de historie',
    /'rekeningnummer',\s*\n\s*coalesce\(old\.betaal_iban/.test(m94),
    'een gewijzigd rekeningnummer gebeurt stil')
}

/* ==================================================================== *
 *  89. De nummers op de proeffacturen moeten de proef doorstaan
 *
 *  Casper: "maar het zijn je eigen test facturen? fix dat dan."
 *
 *  Hij liep vast bij het betalen. De factuur van Gemeente Venlo droeg
 *  NL55BNGH0285000122, dat doorstaat de elfproef niet, de SEPA-bouwer sloeg
 *  hem over en er bleef niets over voor het bestand. Ik had aangenomen dat de
 *  lezer er een cijfer naast zat -- maar het nummer stond zo in
 *  src/lib/testfacturen.ts. Verzonnen, en nooit nagerekend.
 *
 *  Drie van de vijf IBAN's waren fout, en één van de twee btw-nummers.
 *
 *  Verzonnen gegevens horen op een proeffactuur; verzonnen gegevens die de
 *  controles niet doorstaan niet. Dan test je de foutmelding in plaats van de
 *  keten -- en je jaagt een middag op een fout die je zelf hebt neergezet.
 *
 *  Deze controle rekent ze alle vier na, uit het bestand zelf. Wie er een
 *  toevoegt komt er meteen achter.
 * ==================================================================== */

console.log('\n89. De nummers op de proeffacturen')

{
  const { readFileSync } = await import('node:fs')
  const { ibanKlopt } = await import('../../src/lib/boeking')
  const bron = readFileSync('src/lib/testfacturen.ts', 'utf8')

  /* Uit het bestand halen en niet overtypen: een lijst die je hier herhaalt
     is een lijst die uit de pas gaat lopen zodra er een factuur bij komt. */
  const ibans = [...bron.matchAll(/iban: '([^']+)'/g)].map((m) => m[1])
  const btws = [...bron.matchAll(/btwNummer: '([^']+)'/g)].map((m) => m[1])
  const kvks = [...bron.matchAll(/kvk: '([^']+)'/g)].map((m) => m[1])

  check('er staan rekeningnummers op de proeffacturen',
    ibans.length >= 4, `${ibans.length} gevonden`)

  const slechteIban = ibans.filter((i) => !ibanKlopt(i))
  check('en ze doorstaan allemaal de elfproef',
    slechteIban.length === 0,
    slechteIban.join(', '))

  /*
   * De elfproef op een Nederlands btw-nummer: NL, negen cijfers, B, twee
   * cijfers. De eerste acht cijfers maal 9..2, min het negende, moet deelbaar
   * zijn door 11. Hier uitgeschreven en niet uit een bibliotheek: het is drie
   * regels, en dan staat er wat er gecontroleerd wordt.
   */
  const btwKlopt = (nr: string) => {
    const m = /^NL(\d{9})B\d{2}$/.exec(nr.replace(/\s/g, '').toUpperCase())
    if (!m) return false
    const d = m[1].split('').map(Number)
    let som = 0
    for (let i = 0; i < 8; i++) som += d[i] * (9 - i)
    return (som - d[8]) % 11 === 0
  }

  const slechteBtw = btws.filter((b) => !btwKlopt(b))
  check('de btw-nummers ook',
    btws.length > 0 && slechteBtw.length === 0,
    slechteBtw.join(', ') || 'geen btw-nummer op de proeffacturen')

  /* Een KvK-nummer heeft geen controlecijfer; acht cijfers is alles wat
     erover te zeggen valt. Dat staat hier zodat niemand er later een
     elfproef op gaat zoeken die niet bestaat. */
  const slechteKvk = kvks.filter((k) => !/^\d{8}$/.test(k.replace(/\s/g, '')))
  check('en een KvK-nummer is acht cijfers',
    slechteKvk.length === 0,
    slechteKvk.join(', '))

  /*
   * En het nummer waar hij op vastliep staat er niet meer. Met naam genoemd,
   * want dit is het geval dat de regel opleverde -- een controle die alleen
   * "alles klopt" zegt, zegt niet waarom hij er staat.
   */
  /*
   * Naar de GEGEVENS kijken en niet naar het bestand. De eerste versie zocht
   * in de hele tekst en sloeg aan op de uitleg bovenaan, waar dat nummer met
   * zoveel woorden staat als voorbeeld -- dezelfde val als bij groep 76.
   */
  check('het nummer waarop hij vastliep staat er niet meer op een factuur',
    !ibans.some((i) => i.replace(/\s/g, '') === 'NL55BNGH0285000122'),
    'NL55BNGH0285000122 staat nog op een proeffactuur')
}

/* ==================================================================== *
 *  96. Betaald is iets wat Exact zegt, niet iets wat wij aanvinken
 *
 *  Casper: "Als wij moeten betalen, kan je er dan voor zorgen dat je de
 *  status vanuit exact kan zien (of die al betaald is) (...) dit moet echt
 *  feilloos zijn."
 *
 *  "Betaald" betekende: iemand klikte op Uitgevoerd. Wij maken het
 *  SEPA-bestand en een mens zet het bij de bank neer -- of de bank het
 *  werkelijk doet, staat op het bankafschrift, en dat komt in Exact binnen.
 *
 *  Vandaar drie standen: open, aangeboden, betaald. Die laatste komt uit
 *  Exact (cashflow/Payments.Status = 50) en nergens anders vandaan.
 *
 *  Wat de database ervan doet staat in sqltest 67; hier staat wat er
 *  omheen moet kloppen.
 * ==================================================================== */

console.log('\n96. Betaald is iets wat Exact zegt')

{
  const { readFileSync } = await import('node:fs')
  const m100 = readFileSync(
    'supabase/migrations/0100_betalen_dat_niet_liegt.sql', 'utf8')
  const fn = readFileSync('supabase/functions/exact/index.ts', 'utf8')
  const gedeeld = readFileSync('supabase/functions/_gedeeld/exact.ts', 'utf8')
  const lib = readFileSync('src/lib/trucksupply.ts', 'utf8')
  const scherm = readFileSync('src/components/Exact.tsx', 'utf8')

  /* --- 1. de stand komt uit Exact, en van het juiste veld --- */

  check('de betaalstand wordt bij Exact opgehaald',
    fn.includes("'bulk/Cashflow/Payments'"),
    'er wordt nog niets over betalingen uit Exact gelezen')

  /*
   * Op TransactionEntryID, want dat is volgens de documentatie de verwijzing
   * naar onze eigen boeking. Matchen op bedrag of naam zou gokken zijn.
   */
  check('en gekoppeld op de boeking die wij zelf aanmaakten',
    fn.includes('TransactionEntryID'),
    'de koppeling loopt niet over de EntryID van onze boeking')

  /*
   * En NIET op Status van purchaseentry/PurchaseEntries. Dat is de
   * verwerkingsstand van de boeking: een volstrekt onbetaalde factuur staat
   * daar gewoon op 50 = Processed. Daar zijn we bijna in getrapt.
   */
  check('en niet op de verwerkingsstand van de boeking zelf',
    fn.includes('purchaseentry/PurchaseEntries.Status'),
    'het verschil met PurchaseEntries.Status staat nergens vastgelegd')

  /* --- 2. alleen 50 telt als betaald --- */

  check('alleen afgeletterd telt als betaald',
    /when status_in = 50 then/.test(m100),
    'een andere stand dan 50 zet ook betaald_at')

  /*
   * 40 heet bij Exact "processed", maar dat betekent dat het bestand is
   * klaargezet -- niet dat er geld is gegaan. Bij ons, waar het bestand
   * buiten Exact om wordt gemaakt, komt 40 zelfs helemaal niet voor.
   */
  check('en 40 uitdrukkelijk niet',
    /40 heet in Exact "processed"|niet dat er geld is gegaan/.test(m100),
    'het verschil tussen 40 en 50 staat nergens uitgelegd')

  /* De datum van Exact gaat voor onze klok: dat is de dag waarop de post
     niet meer openstond, en die hoort in de administratie te kloppen. */
  check('met de datum van Exact en niet die van ons',
    /coalesce\(e\.betaald_at, eind_in, public\.now_ms\(\)\)/.test(m100),
    'de betaaldatum komt van onze eigen klok')

  /*
   * En de datum die Exact teruggeeft is geen ISO maar /Date(...)/. Wie dat
   * rechtstreeks in new Date() gooit krijgt Invalid Date, en dan belandt er
   * een NaN als tijdstip in de database.
   */
  const { datumUitExact } = await import('../../supabase/functions/_gedeeld/exact.ts')
  check('en de datumvorm van Exact wordt echt gelezen',
    datumUitExact('/Date(1719792000000)/') === 1719792000000,
    String(datumUitExact('/Date(1719792000000)/')))
  check('ook met een tijdzone erachter',
    datumUitExact('/Date(1719792000000+0200)/') === 1719792000000,
    String(datumUitExact('/Date(1719792000000+0200)/')))
  check('een gewone ISO-datum ook',
    datumUitExact('2026-07-01T00:00:00.000Z') === Date.parse('2026-07-01T00:00:00.000Z'))
  check('en leeg of onleesbaar geeft niets, nooit NaN',
    datumUitExact(null) === null && datumUitExact('') === null
      && datumUitExact('geen datum') === null)

  /* --- 3. de drie gaten in de betaalketen --- */

  check('er valt niets te betalen wat niet in Exact staat',
    /and e\.exact_id is not null/.test(m100),
    'je kunt een factuur betalen die nooit is geboekt')

  /* Maar dan wel gezegd, anders lijkt het of er niets te betalen valt. */
  check('en dat wordt geteld en getoond',
    m100.includes('betaalbaar_wacht_op_boeking')
      && /wachtOpBoeking/.test(fn) && /wachtOpBoeking/.test(scherm),
    'facturen verdwijnen stil uit de betaallijst')

  check('het SEPA-bestand blijft bewaard',
    /alter table public\.betaalbatch add column if not exists xml/.test(m100)
      && fn.includes('batchBestand'),
    'een mislukte download betekent nog steeds een verloren bestand')

  check('een concept-opdracht kan ingetrokken worden',
    m100.includes('betaalbatch_intrekken') && lib.includes('exactBatchIntrekken'),
    'een verkeerd aangemaakte opdracht blijft voor altijd staan')

  /*
   * En daarna kan dezelfde factuur opnieuw. De sleutel van een betaalregel
   * was 'br_' + factuur-id -- de primaire sleutel -- dus een tweede poging
   * liep stuk op een dubbele sleutel, precies in het geval waarvoor
   * intrekken bedoeld is.
   */
  check('en de sleutel van een betaalregel draagt de opdracht mee',
    /'br_' \+ batchId \+ '_' \+ r\.id/.test(fn),
    'dezelfde factuur kan niet in een tweede opdracht')

  /* --- 4. en de betaalvelden zijn niet met de hand te zetten --- */

  check('de betaalvelden zijn van de server',
    m100.includes('betalen_blijft_van_de_server'),
    'iedereen die over kosten beslist kan betaald_at rechtstreeks zetten')

  /* --- 5. en het scherm zegt geen betaald als het aangeboden is --- */

  check('het scherm noemt aangeboden ook aangeboden',
    scherm.includes('Aangeboden') && !/op betaald zetten\?/.test(scherm),
    'het scherm belooft nog steeds betaald bij het maken van een bestand')

  check('en er is een knop om de stand bij Exact op te halen',
    scherm.includes('exactBetaalstatus') && lib.includes('exactBetaalstatus'),
    'de betaalstand is nergens op te vragen')

  /* --- 6. en wat de tegenlezers eruit haalden --- */

  /*
   * Een deelbetaling levert MEERDERE regels op dezelfde boeking op. Hier
   * stond een Map die er een overhield -- de laatste in de volgorde waarin
   * Exact ze toevallig teruggaf. Was dat de betaalde helft, dan ging een half
   * betaalde factuur op volledig betaald.
   */
  check('een deelbetaling telt niet als volledige betaling',
    /new Map<string, ExactBetaling\[\]>/.test(fn)
      && /Math\.min\(laagst, Number\(p\.Status\)/.test(fn),
    'bij meerdere betaalregels op dezelfde boeking wint er willekeurig een')

  /*
   * En een half antwoord van Exact mag nooit als een heel antwoord voelen:
   * exactLijst stopt na een vast aantal pagina's en gaf dat niet door, dus
   * "hij staat er niet in" kon "hij is niet betaald" gaan betekenen terwijl
   * de lijst gewoon op was.
   */
  check('en een afgekapte lijst wordt gemeld in plaats van verzwegen',
    gedeeld.includes('laatsteRonde') && /afgekapt/.test(fn) && /afgekapt/.test(scherm),
    'een half antwoord ziet eruit als een heel antwoord')

  /*
   * Twintig administraties met elk tot veertig pagina's is werk zonder
   * bovengrens, en precies die vorm kostte deze functie al eens de worker.
   */
  check('en de ronde heeft een klok en een vervolg',
    /BUDGET_MS/.test(fn) && /vervolg: klaar \? null/.test(fn)
      && /while \(!ronde\.klaar/.test(scherm),
    'alle bv-en gaan in een verzoek, zonder tijdsbudget')

  /* Een mislukte schrijfactie mag niet als betaald geteld worden. */
  check('en een mislukte schrijfactie telt niet als betaald',
    /const \{ data: veranderd, error: zetFout \}/.test(fn),
    'de fout van het wegschrijven wordt weggegooid')

  /* exact_id hoort een guid te zijn; bij oudere boekingen staat er een
     boekstuknummer in, en dat matcht nooit op een guid. */
  check('en er wordt alleen op een guid gematcht',
    /\^\[0-9a-f-\]\{32,36\}\$/.test(fn),
    'een boekstuknummer wordt met een guid vergeleken')

  /*
   * En de weigering van Exact is ook van de server: de app schrijft de hele
   * rij terug, dus een stale weigering werd anders opnieuw geboekt als
   * gebeurtenis, op naam van wie net iets anders wijzigde.
   */
  check('een oude weigering wordt niet door de app teruggeschreven',
    /new\.exact_fout    := old\.exact_fout/.test(m100),
    'een stale rij kan een weigering opnieuw in de historie zetten')

  /* En de stand van het betaalscherm sleept het SEPA-bestand niet mee. */
  check('en de stand haalt de bestanden niet elke keer op',
    m100.includes('heeft_xml') && !/select\('\*'\)\.order\('aangemaakt_at'/.test(fn),
    'elke standopvraag trekt dertig SEPA-bestanden uit de database')
}
}
