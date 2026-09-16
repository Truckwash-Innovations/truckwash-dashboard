/**
 * Het lezen van een factuur, en wat er misgaat als dat niet lukt
 *
 * Onderdeel van de zelftest; zie scripts/selftest.ts voor hoe dit draait en
 * waarom het is opgesplitst.
 */

import { api, check, db, eq, zonderCommentaar } from './kern.ts'

export async function groepen() {
/* ==================================================================== *
 *  73. Wat de lokale lezer te zien krijgt
 *
 *  Casper: "Hij faalt best vaak om een factuur goed te lezen."
 *
 *  Twee oordelen bepalen wat er bij het model aankomt, en ze waren allebei
 *  fout op een manier die niets zegt -- geen foutmelding, alleen een lezing
 *  die er net naast zit.
 *
 *  1. De keuze tussen tekst en beeld hing aan LENGTE: tweehonderd tekens
 *     tekstlaag en het beeld werd overgeslagen. Bij een scan is dat precies
 *     verkeerd om. Veel multifunctionals plakken er zelf een OCR-laag onder,
 *     en een kopregel plus een voettekst haalt die tweehonderd met gemak.
 *     Dan leest het model de slechte OCR van de scanner, en de beeldroute --
 *     die veel beter was -- komt er niet aan te pas.
 *
 *  2. Van een lange factuur gingen de eerste drie bladzijden mee. Op zo'n
 *     stuk staat vooraan wie het stuurt en ACHTERAAN wat er te betalen valt.
 *     Het model kreeg dus stelselmatig alles behalve het totaal.
 * ==================================================================== */

console.log('\n73. Wat de lokale lezer te zien krijgt')

{
  const keuze = await import('../../lezer/keuze.mjs') as {
    MIN_TEKST: number
    MAX_PAGINAS: number
    lijktOpFactuur: (t: string) => boolean
    alsTekst: (t: string) => boolean
    welkeBladzijden: (n: number) => number[]
  }
  const { alsTekst, lijktOpFactuur, welkeBladzijden, MAX_PAGINAS } = keuze

  /* ---- 1. tekst of beeld ---- */

  /*
   * Een echte tekstlaag van een factuur. Woordelijk wat pdfjs uit onze eigen
   * proeffactuur haalt -- nagemeten, niet verzonnen.
   */
  const echt = [
    'Wairtec Chemie B.V.', 'Industrieweg 45', '5928 PA Venlo', 'KvK 17098345',
    'Factuurnummer: WT-2026-04412', 'Factuurdatum: 3 september 2026',
    'Subtotaal excl. btw EUR 1.235,00', 'Btw 21% EUR 259,35',
    'Totaal te betalen EUR 1.494,35', 'IBAN: NL91 ABNA 0417 1643 00',
  ].join('\n')
  check('een echte factuurtekst gaat als tekst', alsTekst(echt))

  /*
   * En dit is het geval waar het om begonnen was: een scan met een OCR-laag
   * die wél lang genoeg is en géén factuur bevat. Vroeger ging deze als
   * tekst naar het model en werd de bladzijde nooit bekeken.
   */
  const scanrommel = ('Gescand met Konica Minolta bizhub C258 '
    + 'Pagina 1 van 1 Vertrouwelijk Niet bestemd voor derden '
    + 'Deze scan is automatisch gemaakt Afdeling administratie ').repeat(2)
  check('die rommel is lang genoeg om de oude drempel te halen',
    scanrommel.length >= keuze.MIN_TEKST)
  check('maar gaat nu naar de beeldroute', !alsTekst(scanrommel))

  check('een bedrag met centen is het hele oordeel',
    lijktOpFactuur('Totaal 1.494,35') && lijktOpFactuur('Totaal 1494.35')
    && !lijktOpFactuur('Pagina 1 van 1, kenmerk 2026'))

  /*
   * Een jaartal of een huisnummer mag geen bedrag heten. Anders is elke
   * voettekst opeens een factuur en verandert er niets.
   */
  check('een jaartal is geen bedrag', !lijktOpFactuur('opgesteld in 2026'))
  check('en een lang nummer ook niet', !lijktOpFactuur('kenmerk 1.234567'))

  /* Kort maar met een bedrag is nog steeds te dun: dat is een bonnetje of
     een restje, en dat hoort gezien te worden. */
  check('een korte tekst gaat naar het beeld, ook met een bedrag',
    !alsTekst('Totaal 12,50'))

  /* ---- 2. welke bladzijden ---- */

  check('een factuur van één bladzijde levert die ene',
    JSON.stringify(welkeBladzijden(1)) === '[1]')
  check('drie bladzijden gaan alle drie mee',
    JSON.stringify(welkeBladzijden(3)) === '[1,2,3]')

  /*
   * Vijf bladzijden: vooraan beginnen, en de laatste erbij. Daar staat het
   * totaal, en dat is het veld dat in een betaalbatch terechtkomt.
   */
  check('bij vijf bladzijden gaat de laatste mee',
    JSON.stringify(welkeBladzijden(5)) === '[1,2,5]',
    JSON.stringify(welkeBladzijden(5)))
  check('en bij twintig ook',
    welkeBladzijden(20).includes(20))

  check('er gaan er nooit meer dan het maximum',
    [1, 2, 3, 4, 7, 50].every((n) => welkeBladzijden(n).length <= MAX_PAGINAS))
  check('en nooit twee keer dezelfde',
    [1, 3, 4, 9].every((n) => new Set(welkeBladzijden(n)).size === welkeBladzijden(n).length))

  /* Onzin erin mag geen onzin eruit geven: nul bladzijden is een lege lijst
     en geen lus die nooit stopt. */
  check('nul bladzijden is een lege lijst',
    JSON.stringify(welkeBladzijden(0)) === '[]')

  /* ---- 3. de meetset ---- */

  const { readFileSync } = await import('node:fs')
  const proefset = readFileSync('scripts/proefset.mts', 'utf8')

  /*
   * De onleesbare factuur hoort GEEN waarheid te krijgen. Op dat vel staat
   * met opzet geen bedrag, en het goede antwoord is "ik weet het niet". Als
   * veld is dat niet te scoren: een model dat netjes niets invult zou dan
   * evenveel punten krijgen als een model dat iets verzint.
   */
  check('de onleesbare proeffactuur krijgt geen waarheid mee',
    proefset.includes("f.sleutel !== 'onleesbaar'"))

  check('de eigen verkoopfactuur staat als verkoop in de waarheid',
    proefset.includes("f.sleutel === 'eigen-verkoop' ? 'verkoop' : 'inkoop'"))
}

/* ==================================================================== *
 *  93. Het lezen geeft niet op bij een hik, en zegt wat er misging
 *
 *  Casper: "de ai lukt het steeds vaker niet? hij pakt de pdf facturen
 *  steeds niet."
 *
 *  Twee dingen zaten fout, en samen maakten ze precies dit beeld.
 *
 *  Er stond geen enkele herkansing. Eén verzoek naar de leesdienst; kwam
 *  daar 429 (te druk) of 529 (overbelast) uit, of viel de verbinding weg,
 *  dan was de factuur klaar. Terwijl dat juist de fouten zijn die vanzelf
 *  overgaan -- de documentatie zegt er letterlijk bij: retry with
 *  exponential backoff.
 *
 *  En in de automatische route werd de reden weggegooid:
 *
 *      console.warn('[ontvang-mail] niet gelezen: ' + uit.reden)
 *
 *  Een logregel op een server. De bon kwam leeg in de rij te staan en van
 *  buiten was niet te zien of hij nog gelezen moest worden of dat het al
 *  geprobeerd en mislukt was. Daarom LEEK het steeds vaker mis te gaan: het
 *  ging al langer soms mis, alleen zei niemand het.
 * ==================================================================== */

console.log('\n93. Het lezen geeft niet op bij een hik')

{
  const { readFileSync } = await import('node:fs')
  const lezer = readFileSync('supabase/functions/_gedeeld/factuurlezer.ts', 'utf8')
  const verw = readFileSync('supabase/functions/_gedeeld/verwerking.ts', 'utf8')
  const post = readFileSync('supabase/functions/ontvang-mail/index.ts', 'utf8')
  const pc = readFileSync('supabase/functions/lezer/index.ts', 'utf8')

  /* --- 1. niet opgeven bij een hik --- */

  check('het lezen wordt opnieuw geprobeerd',
    /for \(let poging = 1; poging <= POGINGEN; poging\+\+\)/.test(lezer),
    'één mislukt verzoek is meteen een ongelezen factuur')

  /*
   * Welke statussen tijdelijk zijn is nagekeken bij de API zelf en niet
   * bedacht: 429, 500, 502, 503, 504 en 529. Een lijst die ook 400 of 413
   * bevat maakt het erger -- dan wordt een te grote bijlage drie keer
   * aangeboden en drie keer geweigerd.
   */
  check('alleen bij fouten die vanzelf overgaan',
    /const OPNIEUW_BIJ = \[429, 500, 502, 503, 504, 529\]/.test(lezer),
    'de lijst met te herhalen statussen klopt niet')

  check('en niet bij een fout die morgen ook fout is',
    /if \(!mis\.tijdelijk\) return \{ ok: false/.test(lezer),
    'een te grote bijlage wordt net zo vaak opnieuw aangeboden')

  /* Wachten voordat je het opnieuw vraagt, en luisteren als de dienst zelf
     zegt hoe lang. Meteen opnieuw vragen bij 429 maakt de rem alleen erger. */
  check('met wachttijd ertussen, en retry-after gaat voor',
    lezer.includes("headers.get('retry-after')") && /2 \*\* \(poging - 1\)/.test(lezer),
    'er wordt meteen opnieuw gevraagd, of de retry-after wordt genegeerd')

  /*
   * Een verbinding die blijft hangen mag de functie niet opeten. Zonder
   * bovengrens valt de worker om (546) in plaats van dat er een nette reden
   * uit komt -- en dan staat er nergens iets.
   */
  check('en een verbinding die hangt wordt afgekapt',
    lezer.includes('new AbortController()') && lezer.includes('stop.abort()'),
    'een hangende verbinding kan de hele functie opeten')

  /* --- 2. de reden is bruikbaar --- */

  /*
   * Hiervoor werd alles behalve een bestandstypefout "De leesdienst gaf geen
   * antwoord". Daarmee zag een verlopen sleutel er hetzelfde uit als een
   * drukke dienst, terwijl het ene een half jaar stilstand betekent en het
   * andere vijf minuten.
   */
  check('en een 401 is iets anders dan een 429',
    /status === 401 \|\| status === 403/.test(lezer)
      && lezer.includes('ANTHROPIC_API_KEY')
      && /status === 429/.test(lezer),
    'elke fout krijgt nog dezelfde zin')

  check('een bon weet of het aan het moment lag of aan het stuk',
    /tijdelijk\?: boolean/.test(lezer),
    'de beller kan niet zien of het zin heeft om het nog eens te proberen')

  /* --- 3. een mislukking is zichtbaar --- */

  check('een mislukte lezing wordt vastgelegd',
    verw.includes('export async function markeerLezenMislukt'),
    'er is geen gedeelde plek die een mislukking opschrijft')

  /*
   * En de post gebruikt hem ook. Dat was het hele gat: de pc thuis legde een
   * mislukking netjes vast (0049), Claude in de post schreef een logregel.
   */
  check('en de post gebruikt hem, niet alleen de pc',
    post.includes('markeerLezenMislukt') && pc.includes('markeerLezenMislukt'),
    'de automatische route gooit de reden nog steeds weg')

  check('de console.warn die de reden weggooide is weg',
    !/console\.warn\('\[ontvang-mail\] niet gelezen/.test(post),
    'de reden verdwijnt nog in een logregel')

  /*
   * Zichtbaar betekent: lees_status mislukt, want daar hangt de badge in
   * Kostenposten en de stand "vastgelopen" in de werklijst aan (0049). Een
   * eigen veld erbij verzinnen zou een tweede waarheid zijn.
   */
  check('via de stand waar het scherm al naar kijkt',
    /lees_status: 'mislukt'/.test(verw),
    'de mislukking komt niet in de stand die het scherm leest')

  /* En bij een tijdelijke fout hoort erbij te staan dat opnieuw proberen
     zin heeft -- anders gaat iemand een goede factuur overtikken. */
  check('en bij een tijdelijke fout staat erbij dat opnieuw zin heeft',
    /uit\.tijdelijk/.test(post) && post.includes('Opnieuw lezen'),
    'bij een drukke leesdienst lijkt de factuur onleesbaar')
}

/* ==================================================================== *
 *  94. De pc las de hele stapel en hield geen ruimte over voor het antwoord
 *
 *  Casper stuurde het logboek van de pc thuis:
 *
 *    12:40:13  exp_mail tekst 77.2s mislukt: Ollama gaf twee keer geen
 *              leesbare JSON terug:
 *    13:26:14  exp_mail tekst  9.0s klaar, met twijfel: (...)
 *
 *  Twee dingen vallen daaraan op. De regel eindigt op een dubbele punt met
 *  NIETS erachter -- het model gaf een leeg antwoord, geen kapotte JSON. En
 *  de mislukkingen duren zeventig seconden terwijl een geslaagde er negen
 *  doet; dat is geen toeval maar een verschil in hoeveel er naar binnen ging.
 *
 *  De beeldroute pakte al lang niet meer alle bladzijden: eerste twee plus
 *  de laatste, want vooraan staat wie het stuurt en achteraan wat er te
 *  betalen valt (welkeBladzijden, groep 82). De tekstroute deed dat niet en
 *  las alles tot dertigduizend tekens. Bij een dikke factuur vult dat samen
 *  met de aanwijzingen het venster van 16384 tokens, en dan is er voor het
 *  ANTWOORD niets meer over.
 *
 *  Dezelfde keuze hoort aan allebei de kanten te gelden. Er was geen reden
 *  waarom een bladzijde die als plaatje niet de moeite waard is, als tekst
 *  ineens wel meetelt.
 * ==================================================================== */

console.log('\n94. De pc hield geen ruimte over voor het antwoord')

{
  const { readFileSync } = await import('node:fs')
  const pc = readFileSync('lezer/lezer.mjs', 'utf8')

  check('de tekstroute pakt dezelfde bladzijden als de beeldroute',
    /for \(const p of welkeBladzijden\(doc\.numPages\)\)/.test(pc),
    'de tekstlaag van alle bladzijden gaat nog naar het model')

  /*
   * En de mislukking zegt wat er gebeurde. Ollama geeft done_reason en de
   * tokentellingen gewoon terug; die werden alleen weggegooid zodra het
   * misging -- precies wanneer je ze nodig hebt.
   */
  check('en een mislukking meldt de getallen die het verklaren',
    pc.includes('done_reason')
      && /prompt_eval_count/.test(pc)
      && /venster \$\{venster\}|venster \$\{/.test(pc),
    'een mislukte lezing zegt nog steeds alleen dat het mislukte')

  check('een leeg antwoord heet ook leeg',
    pc.includes("'(leeg)'"),
    'een leeg antwoord levert een regel op die op niets eindigt')

  /* Past de vraag al niet, dan hoort dat er in gewone taal bij te staan --
     anders staat er een rij getallen waar je zelf uit moet opmaken wat er
     aan de hand is. */
  check('en als de tekst het venster al vult, staat dat er in woorden bij',
    /inTokens > venster - 512/.test(pc) && pc.includes('num_ctx'),
    'een vol venster blijft een rij getallen')
}
}
