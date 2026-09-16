/**
 * De schermen: menu, zoeken, opmaak en de wegen ertussen
 *
 * Onderdeel van de zelftest; zie scripts/selftest.ts voor hoe dit draait en
 * waarom het is opgesplitst.
 */

import { api, check, db, eq, zonderCommentaar } from './kern.ts'

export async function groepen() {
/* ====================================================================
 *  29. Zoeken vóór je een dashboard hebt gekozen
 *
 *  De zoekbalk staat ook op het keuzescherm. Daar is nog geen rol, en de
 *  app heeft geen router: een treffer kan alleen open als het dashboard dat
 *  de pagina kent gemount wordt. kiesDashboard bepaalt welk dat is. De kaart
 *  is handgeschreven; deze tests houden hem compleet.
 * ==================================================================== */

console.log('\n29. Zoeken vóór je een dashboard hebt gekozen')

{
  const { kiesDashboard, kiesPagina, DASHBOARDS_MET, SCHERMEN } = await import('../../src/lib/schermen')
  const { ROLE_ORDER } = await import('../../src/lib/types')

  /* ---- wie de pagina al heeft, houdt hem ---- */

  check('de huidige rol wint als die de pagina heeft',
    kiesDashboard('overleg', ['employee', 'management'], 'management') === 'management')
  check('ook als een eerdere rol in de volgorde hem óók heeft',
    kiesDashboard('uren', ['employee', 'supervisor'], 'supervisor') === 'supervisor')

  /* ---- anders het eerste dashboard in ROLE_ORDER dat hem kent ---- */

  check('zonder rol het eerste dashboard uit ROLE_ORDER dat de pagina kent',
    kiesDashboard('overleg', ['management', 'employee'], null) === 'employee')
  check('de volgorde komt uit ROLE_ORDER, niet uit de lijst van de gebruiker',
    kiesDashboard('uren', ['management', 'administratie', 'supervisor'], null) === 'supervisor')
  check('heeft de huidige rol de pagina niet, dan een ander dashboard',
    kiesDashboard('financieel', ['employee', 'management'], 'employee') === 'management')
  check('een huidige rol die de gebruiker niet heeft telt niet',
    kiesDashboard('uren', ['supervisor'], 'employee') === 'supervisor')

  /* ---- en niets als niemand hem kent ---- */

  check('null als geen van je dashboards de pagina kent',
    kiesDashboard('financieel', ['employee'], 'employee') === null)
  check('null voor een pagina die niet bestaat',
    kiesDashboard('bestaatniet', ROLE_ORDER, 'management') === null)
  check('null zonder rollen', kiesDashboard('start', [], null) === null)

  /* ---- dezelfde treffer, per dashboard een andere pagina ---- *
   *
   * Een werkgever die op het keuzescherm zijn chauffeur zocht, kreeg de
   * pagina van het management mee en landde op zijn startpagina. De pagina
   * hoort te volgen uit welke dashboards je hebt, niet uit een rol die er
   * nog niet is.
   */

  const wasbeurt = ['planning', 'vandaag', 'beurten']
  check('een wasbeurt opent binnen het werknemersdashboard op Vandaag',
    kiesPagina(wasbeurt, ['employee', 'management'], 'employee') === 'vandaag')
  check('en binnen Management op Planning',
    kiesPagina(wasbeurt, ['employee', 'management'], 'management') === 'planning')
  check('en binnen het werkgeversdashboard onder Wasbeurten',
    kiesPagina(wasbeurt, ['employer'], 'employer') === 'beurten')
  check('zonder rol volgt de pagina uit de dashboards die je hebt: werkgever -> Wasbeurten',
    kiesPagina(wasbeurt, ['employer'], null) === 'beurten')
  check('zonder rol met alleen het werknemersdashboard: Vandaag',
    kiesPagina(wasbeurt, ['employee'], null) === 'vandaag')

  const koppeling = ['werkgevers', 'chauffeurs']
  check('een chauffeur opent voor een werkgever zonder rol onder Chauffeurs',
    kiesPagina(koppeling, ['employer'], null) === 'chauffeurs')
  check('wie ook management heeft, gaat zonder rol naar Werkgevers',
    kiesPagina(koppeling, ['employer', 'management'], null) === 'werkgevers')
  check('maar binnen het werkgeversdashboard blijft het Chauffeurs',
    kiesPagina(koppeling, ['employer', 'management'], 'employer') === 'chauffeurs')
  check('een werkgever zelf opent voor een werkgever zonder rol op Start',
    kiesPagina(['werkgevers', 'start'], ['employer'], null) === 'start')
  check('kent geen dashboard een kandidaat, dan de eerste (en kiesDashboard geeft daar null)',
    kiesPagina(['meldingen'], ['employee'], null) === 'meldingen'
    && kiesDashboard('meldingen', ['employee'], null) === null)
  check('een huidige rol die de gebruiker niet heeft telt ook hier niet',
    kiesPagina(wasbeurt, ['employee'], 'management') === 'vandaag')

  /* ---- de kaart is compleet ---- */

  const zonderRol = Object.entries(DASHBOARDS_MET).filter(([, r]) => r.length === 0).map(([p]) => p)
  check('elke pagina in de kaart heeft minstens één dashboard',
    zonderRol.length === 0, zonderRol.join(', '))

  const alleRollen = new Set(Object.values(DASHBOARDS_MET).flat())
  const ontbreekt = ROLE_ORDER.filter((r) => !alleRollen.has(r))
  check('elke rol uit ROLE_ORDER komt in de kaart voor',
    ontbreekt.length === 0, ontbreekt.join(', '))

  const onbekend = SCHERMEN.filter((s) => !DASHBOARDS_MET[s.page]).map((s) => s.page)
  check('elk scherm uit de zoeklijst staat in de kaart',
    onbekend.length === 0, onbekend.join(', '))

  const tegenstrijdig = SCHERMEN
    .filter((s) => s.rol && !DASHBOARDS_MET[s.page]?.includes(s.rol))
    .map((s) => s.page)
  check('een scherm met een vaste rol staat bij die rol in de kaart',
    tegenstrijdig.length === 0, tegenstrijdig.join(', '))
}

/* ==================================================================== *
 *  Elk scherm bij ontwikkeling is ook te vinden
 *
 *  De zoekbalk werkt op SCHERMEN uit schermen.ts. Drie schermen bij
 *  ontwikkeling stonden daar niet in en waren dus met geen mogelijkheid te
 *  vinden -- je moest weten dat het tabblad bestond. En een treffer landt
 *  alleen als het dashboard de pagina in useNavTarget noemt.
 * ==================================================================== */

console.log('\n35. Eén lijst per dashboard, en die klopt')

{
  const { readFileSync, readdirSync } = await import('node:fs')
  const { SCHERMEN, DASHBOARDS_MET } = await import('../../src/lib/schermen')

  /*
   * Elk dashboard hield drie lijsten bij over dezelfde schermen: het menu,
   * de koppen en de doelen voor useNavTarget. Ze moesten het met elkaar eens
   * zijn, en twee keer waren ze dat niet -- werk, werving en documenten
   * ontbraken bij de doelen (de knop in de takenmail deed niets), en bij de
   * koppen ontbraken ze óók, zodat er boven die schermen "Start / Waar wil je
   * heen?" stond.
   *
   * De vorige versie van deze controle keek alleen naar Ontwikkeling, en
   * alleen naar de drie waar het al was misgegaan -- "de hele lijst nalopen
   * zou het parseren van acht dashboards vragen". Nu is er per dashboard één
   * lijst, en dan is nalopen juist makkelijk.
   */

  const rolVan: Record<string, string> = {
    administratie: 'administratie', customer: 'customer', developer: 'developer',
    employee: 'employee', employer: 'employer', management: 'management',
    supervisor: 'supervisor', technician: 'technician', trucksupply: 'trucksupply',
  }

  /** De paginalijst van een dashboard, met haakjes tellen in plaats van raden. */
  const lijstVan = (bron: string): string => {
    const m = /const (?:paginas|PAGINAS): Pagina\[\] = \[/.exec(bron)
    if (!m) return ''
    let diep = 0
    const i = m.index + m[0].length - 1
    for (let j = i; j < bron.length; j++) {
      if (bron[j] === '[') diep++
      else if (bron[j] === ']') {
        diep--
        if (diep === 0) return bron.slice(i, j + 1)
      }
    }
    return ''
  }

  const dashboards = readdirSync('src/dashboards', { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(`src/dashboards/${d.name}`)
      .filter((f) => f.endsWith('Dashboard.tsx'))
      .map((f) => ({ map: d.name, bestand: `src/dashboards/${d.name}/${f}` })))

  check('er zijn negen dashboards', dashboards.length === 9, String(dashboards.length))

  const zonderLijst: string[] = []
  const nietInLijst: string[] = []
  const nietAfgeleid: string[] = []
  const nietVindbaar: string[] = []
  const nietOpDeKaart: string[] = []

  for (const { map, bestand } of dashboards) {
    const bron = readFileSync(bestand, 'utf8')
    const blok = lijstVan(bron)
    if (!blok) { zonderLijst.push(map); continue }

    const sleutels = new Set([...blok.matchAll(/key: '([^']+)'/g)].map((m) => m[1]))
    const rendert = [...new Set([...bron.matchAll(/page === '([^']+)'/g)].map((m) => m[1]))]

    /* 1. alles wat het rendert staat in de lijst */
    for (const p of rendert) if (!sleutels.has(p)) nietInLijst.push(`${map}: ${p}`)

    /* 2. en de drie worden er echt uit afgeleid */
    for (const nodig of ['menuVan(', 'kopVan(', 'sleutelsVan(']) {
      if (!bron.includes(nodig)) nietAfgeleid.push(`${map}: ${nodig}`)
    }

    /* 3. wat het rendert is ook te vinden via de zoekbalk... */
    const rol = rolVan[map]
    for (const p of rendert) {
      /* mijnpost zit in het postvak van iedereen en heeft geen eigen scherm
         in SCHERMEN; dat is met opzet zo (zie lib/schermen.ts). */
      if (p === 'mijnpost') continue
      if (!SCHERMEN.some((sc) => sc.page === p)) nietVindbaar.push(`${map}: ${p}`)
      else if (!(DASHBOARDS_MET[p] ?? []).includes(rol as never)) {
        nietOpDeKaart.push(`${map}: ${p}`)
      }
    }
  }

  check('elk dashboard heeft één paginalijst', zonderLijst.length === 0, zonderLijst.join(', '))
  check('en rendert geen scherm dat er niet in staat',
    nietInLijst.length === 0, nietInLijst.join(', '))
  check('het menu, de kop en de doelen komen alle drie uit die lijst',
    nietAfgeleid.length === 0, nietAfgeleid.join(', '))
  check('elk scherm is ook via de zoekbalk te vinden',
    nietVindbaar.length === 0, nietVindbaar.join(', '))
  check('en de kaart weet in welk dashboard het woont',
    nietOpDeKaart.length === 0, nietOpDeKaart.join(', '))

  /* ---- geen dashboard leent een scherm van een ander ---- */

  /*
   * Casper: "Bij ontwikkelaar heb ik bij inkoop nog steeds de adressen en
   * grootboekrekeningen, gezien die bij administratie opkomen, kan dat daar
   * niet weg?"
   *
   * Die schermen stonden daar niet toevallig -- ze stónden er, in
   * dashboards/developer/, en de administratie importeerde ze daaruit. Een
   * scherm dat twee dashboards gebruiken is van geen van beide; het hoort
   * bij de gedeelde componenten, net als het postvak en het overleg.
   *
   * Negen bestanden zijn zo verhuisd. Deze regel houdt het zo: uit
   * src/dashboards/<a>/ mag niets uit src/dashboards/<b>/ komen.
   */
  const geleend: string[] = []
  for (const { map } of dashboards) {
    for (const bestand of readdirSync(`src/dashboards/${map}`)) {
      if (!/\.tsx?$/.test(bestand)) continue
      const bron = readFileSync(`src/dashboards/${map}/${bestand}`, 'utf8')
      for (const m of bron.matchAll(/from '\.\.\/([a-z][a-zA-Z]*)\//g)) {
        geleend.push(`${map}/${bestand} leent uit ${m[1]}/`)
      }
    }
  }
  check('geen dashboard leent een scherm van een ander',
    geleend.length === 0, geleend.join('; '))

  /* En geen enkel dashboard houdt nog een eigen koppenlijst bij. */
  const metEigenKoppen = dashboards.filter(({ bestand }) => {
    const bron = readFileSync(bestand, 'utf8')
    return /const TIT[EL]LS?:/.test(bron) || bron.includes('const TITELS') || bron.includes('const TITLES')
  })
  check('en niemand houdt nog een aparte koppenlijst bij',
    metEigenKoppen.length === 0, metEigenKoppen.map((d) => d.map).join(', '))
}

/* ==================================================================== *
 *  De stijlbladen sluiten zichzelf
 *
 *  Eén vergeten accolade, en de halve app staat er kaal bij.
 *
 *  Zo ging het in september 2026. Bij het omzetten van 64px naar een
 *  variabele viel de sluitaccolade van een @media weg. CSS is vergevend: de
 *  browser klaagt niet, hij sluit het blok bij het einde van het bestand.
 *  Alles wat erachter stond viel daarmee binnen "max-width: 860px" -- en
 *  omdat Vite alle stijlbladen achter elkaar plakt, gold dat ook voor
 *  auth.css, rolzoek.css, trucksupply.css en vestigingen.css. Op een gewoon
 *  scherm was er dus opeens geen opmaak meer, zonder één foutmelding.
 *
 *  De typecontrole ziet dat niet, de zelftest zag het niet, en de bouw
 *  slaagde gewoon. Vandaar deze telling.
 *
 *  Commentaar telt apart mee: een /* dat nooit sluit slikt de rest van het
 *  bestand op dezelfde stille manier.
 * ==================================================================== */

console.log('\n39. De stijlbladen sluiten zichzelf')

{
  const { readFileSync, readdirSync } = await import('node:fs')

  const map = 'src/styles'
  const bladen = readdirSync(map).filter((n) => n.endsWith('.css')).sort()
  check('er zijn stijlbladen om na te kijken', bladen.length >= 4, String(bladen.length))

  for (const naam of bladen) {
    const ruw = readFileSync(`${map}/${naam}`, 'utf8')

    /* Eerst het commentaar zelf: ongelijk aantal openers en sluiters betekent
       dat er een blok openstaat, en dan klopt de telling hieronder ook niet. */
    const open = (ruw.match(/\/\*/g) ?? []).length
    const dicht = (ruw.match(/\*\//g) ?? []).length
    check(`${naam}: elk commentaar wordt gesloten`, open === dicht,
      `${open} keer /* tegen ${dicht} keer */`)

    /* En dan de accolades, met het commentaar eruit -- daar staan er ook
       tussen, en die tellen niet mee. */
    const zonder = ruw.replace(/\/\*[\s\S]*?\*\//g, ' ')
    const na = (zonder.match(/\{/g) ?? []).length
    const uit = (zonder.match(/\}/g) ?? []).length
    check(`${naam}: elke accolade wordt gesloten`, na === uit,
      `${na} keer { tegen ${uit} keer }`)
  }
}

/* ====================================================================
 *  44. Waar een link in een mail uitkomt
 *
 *  Casper: "kan je ervoor zorgen dat alle linken die in mails worden
 *  verstuurd op de website uitkomen ipv de github release?"
 *
 *  Waarom hier een toets op staat en niet alleen een aanpassing: dit is een
 *  fout die niemand ziet. De code doet het, de mail komt aan, de knop werkt
 *  -- hij komt alleen op de verkeerde plek uit. Er stond bovendien twee keer
 *  dezelfde constante in twee functies, dus één van de twee terugzetten kon
 *  ongemerkt. Nu staat het adres op één plek en let dit hoofdstuk erop dat er
 *  geen tweede bijkomt.
 *
 *  En op het schoonvegen van wat er uit een mail meekomt. Het adres in een
 *  mail is de enige plek waar een buitenstaander invloed heeft op waar de app
 *  heen springt.
 * ==================================================================== */

console.log('\n44. Waar een link in een mail uitkomt')

{
  const { readFileSync } = await import('node:fs')
  const { ophalen, openen } = await import('../../supabase/functions/_gedeeld/adressen.ts')

  const site = new URL('https://truckwash-workspace.com/')
  const app = new URL('https://truckwash-workspace.com/app/')

  /* --- de twee soorten link --- */

  check('"de app ophalen" gaat naar de medewerkerspagina',
    ophalen(site) === 'https://truckwash-workspace.com/medewerkers/')

  check('een site met een pad erin raakt dat pad kwijt, want /medewerkers/ staat op de wortel',
    ophalen(new URL('https://truckwash-workspace.com/ergens/')) ===
      'https://truckwash-workspace.com/medewerkers/')

  check('zonder scherm is het gewoon de app', openen(app) === 'https://truckwash-workspace.com/app/')

  check('met een scherm komt dat erachter',
    openen(app, 'postbus') === 'https://truckwash-workspace.com/app/?open=postbus')

  check('en met een id erbij',
    openen(app, 'kosten', 'exp_7') ===
      'https://truckwash-workspace.com/app/?open=kosten&id=exp_7')

  /* --- wat er niet doorheen mag ---
   *
   * Deze waarden komen van de aanroeper van de serverfunctie. Een schuine
   * streep of een vraagteken dat hier ongezien in glipt, verandert niet de
   * parameter maar het adres zelf -- en dan staat er een link in onze mail,
   * met ons logo erboven, die ergens anders uitkomt.
   */

  const junk = ['../../kwaad', 'post/bus', 'a?b=c', 'a&b', 'a b', '', 'https://elders.nl']
  check('rommel als scherm wordt genegeerd',
    junk.every((j) => openen(app, j) === 'https://truckwash-workspace.com/app/'))

  check('en rommel als id ook, terwijl het scherm blijft staan',
    junk.filter((j) => j !== '').every((j) =>
      openen(app, 'postbus', j) === 'https://truckwash-workspace.com/app/?open=postbus'))

  check('een scherm van veertig tekens of langer valt af',
    openen(app, 'x'.repeat(80)) === 'https://truckwash-workspace.com/app/?open=' + 'x'.repeat(40))

  /* --- en geen enkele mail wijst nog naar GitHub --- */

  const mailers = ['stuur-mail', 'nodig-uit']
  const bronnen = mailers.map((m) =>
    readFileSync(`supabase/functions/${m}/index.ts`, 'utf8'))

  check('geen mailfunctie noemt nog een GitHub-adres',
    bronnen.every((b) => !/github\.com/.test(b)))

  /* Op de declaratie en niet op het woord: de commentaarregels die uitleggen
     wat er stond noemen APP_LINK, en die horen te blijven staan. */
  check('en geen van beide heeft nog een eigen APP_LINK-constante',
    bronnen.every((b) => !/const\s+APP_LINK/.test(b)))

  /*
   * De app moet de schermnaam uit het adres nakijken tegen haar eigen lijst.
   * Zonder die controle kan een link iemand een scherm in duwen dat hij niet
   * had gekozen -- en een adres uit een mail komt van wie de mail stuurde.
   */
  const nav = readFileSync('src/store/useNav.ts', 'utf8')
  check('de app kijkt een schermnaam uit een adres na tegen DASHBOARDS_MET',
    /DASHBOARDS_MET\[scherm\]/.test(nav))
  check('en veegt het adres daarna schoon',
    /searchParams\.delete\('open'\)/.test(nav) && /replaceState/.test(nav))
}

/* ====================================================================
 *  50. De rondleiding wijst naar knoppen die bestaan
 *
 *  Een aanwijzer zoekt zijn doel met een querySelector op
 *  data-rondleiding="nav-<sleutel>". Vindt hij niets, dan gaat hij zonder
 *  mopperen door naar de volgende (Rondleiding.tsx: als het element er niet
 *  is, roept hij meteen onVolgende aan).
 *
 *  Dat is goed gedrag, en het is precies waarom dit hoofdstuk er moet zijn:
 *  een aanwijzer die nergens heen wijst is niet stuk, hij is er gewoon niet
 *  meer. In de administratierondleiding stond 'nav-tedoen', en die sleutel
 *  heeft nooit bestaan -- de pagina heet 'start'. Die stap werd dus vanaf de
 *  eerste dag overgeslagen, en niemand die het merkte.
 *
 *  Dit werd urgent door het menu met twee niveaus (1.74): wat in een groep
 *  zit is er alleen als die groep openstaat, dus een aanwijzer naar een kind
 *  mist zijn doel zodra iemand de groep dichtklapt.
 * ==================================================================== */

console.log('\n50. De rondleiding wijst naar knoppen die bestaan')

{
  const { readFileSync, readdirSync } = await import('node:fs')
  const { RONDLEIDINGEN } = await import('../../src/lib/rondleiding.ts')
  const { DASHBOARDS_MET } = await import('../../src/lib/schermen.ts')

  /* De bronnen van alle dashboards bij elkaar: daar staan de groepssleutels
     in, en die zijn geen pagina en staan dus niet in DASHBOARDS_MET. */
  const bronnen = readdirSync('src/dashboards', { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync('src/dashboards/' + d.name)
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => readFileSync('src/dashboards/' + d.name + '/' + f, 'utf8')))
    .join('\n')

  const kapot: string[] = []
  const nietZichtbaar: string[] = []

  for (const [rol, rondleiding] of Object.entries(RONDLEIDINGEN)) {
    for (const a of rondleiding.aanwijzers ?? []) {
      if (!a.doel.startsWith('nav-')) continue
      const sleutel = a.doel.slice(4)

      /*
       * Een groep is geen pagina; die staat alleen in de bron van het
       * dashboard. Wel nakijken dat hij daar echt staat, anders is een
       * hernoemde groep net zo stil weg als een hernoemde pagina.
       */
      if (sleutel.endsWith('-groep')) {
        if (!bronnen.includes("'" + sleutel + "'")) kapot.push(rol + ': ' + a.doel)
        continue
      }

      const dashboards = DASHBOARDS_MET[sleutel]
      if (!dashboards) { kapot.push(rol + ': ' + a.doel); continue }
      /* En hij moet in DIT dashboard staan, niet ergens anders. */
      if (!dashboards.includes(rol as never)) nietZichtbaar.push(rol + ': ' + a.doel)
    }
  }

  check('elke aanwijzer wijst naar een sleutel die bestaat',
    kapot.length === 0, kapot.join(', '))
  check('en naar een die in dat dashboard staat',
    nietZichtbaar.length === 0, nietZichtbaar.join(', '))

  /*
   * En het omgekeerde voor de administratie: de knoppen die in een groep
   * zitten horen geen aanwijzer meer te hebben, want die is er niet zodra de
   * groep dichtstaat. Wijs naar de kop.
   */
  const adm = RONDLEIDINGEN.administratie.aanwijzers ?? []
  const inGroepen = ['nav-kosten', 'nav-uren', 'nav-dossiers', 'nav-aanmeldingen',
    'nav-postbus', 'nav-betalen', 'nav-grootboek']
  const risico = adm.filter((a) => inGroepen.includes(a.doel)).map((a) => a.doel)
  check('de administratie wijst niet naar iets dat kan dichtklappen',
    risico.length === 0, risico.join(', '))
}

/* ====================================================================
 *  54. De sfeerbeelden op het inlogscherm
 *
 *  Casper stuurde een mp4 en vroeg of die als animatie bij het inloggen kon.
 *
 *  Het bestand zoals hij binnenkwam kon niet zomaar mee, om drie redenen die
 *  je geen van drieen ziet aankomen:
 *
 *    1. Er zit een stereo audiospoor in. Electron staat standaard op
 *       no-user-gesture-required en Capacitor zet
 *       setMediaPlaybackRequiresUserGesture(false) -- dus zonder muted klinkt
 *       er op achttien vestigingen 25 seconden geluid zodra iemand het
 *       inlogscherm opent.
 *    2. Er zat 52 kB udta-metadata in met de complete ComfyUI-workflow en de
 *       prompts. Dat zou onveranderd op /app/ worden uitgeserveerd.
 *    3. 4,14 MB op een app van 5,26 MB. Dat is +79% voor de webapp en +67%
 *       voor de APK, en gzip haalt er anderhalve procent af.
 *
 *  Dit hoofdstuk toetst het BESTAND dat we uitleveren en niet het origineel,
 *  plus de vier dingen in de code die het gedrag bepalen.
 * ==================================================================== */

console.log('\n54. De sfeerbeelden op het inlogscherm')

{
  const { readFileSync, existsSync } = await import('node:fs')

  const pad = 'src/assets/inlog.mp4'
  check('de video staat in src/ en niet in public/', existsSync(pad))
  /*
   * Uit src/ omdat Vite er dan een hash aan hangt en hem in dist/app/assets/
   * zet -- de enige map met een cache-kopregel (uitrol/_headers). Uit public/
   * zou hij daarbuiten vallen en haalt elke tablet hem bij elk bezoek opnieuw
   * op, zonder dat iets een fout meldt.
   */
  check('en niet ook in public/', !existsSync('public/inlog.mp4'))

  const bytes = readFileSync(pad)
  const kb = Math.round(bytes.length / 1024)

  check('en is kleiner dan een megabyte', kb < 1100, kb + ' kB')

  /* ---- geen geluid ---- */

  /*
   * Netjes nakijken en niet op de tekst "mp4a" zoeken: die vier letters
   * kunnen in 900 kB beeldgegevens toevallig voorkomen. Elk spoor heeft een
   * hdlr-blok, en op vier bytes na de bloknaam staat waar het spoor over
   * gaat: vide, soun, of iets anders.
   */
  const soorten: string[] = []
  for (let n = 0; n + 12 <= bytes.length; n++) {
    if (bytes.toString('latin1', n, n + 4) !== 'hdlr') continue
    soorten.push(bytes.toString('latin1', n + 12, n + 16))
  }
  check('het bestand heeft een beeldspoor', soorten.includes('vide'),
    soorten.join(', '))
  check('en geen geluidsspoor', !soorten.includes('soun'), soorten.join(', '))

  /* ---- geen prompts erin ---- */

  const alsTekst = bytes.toString('latin1')
  check('de ComfyUI-workflow zit er niet meer in',
    !alsTekst.includes('last_node_id') && !alsTekst.includes('SaveVideo'))

  /* ---- en wat de code ermee doet ---- */

  const login = readFileSync('src/components/Login.tsx', 'utf8')
  const css = readFileSync('src/styles/auth.css', 'utf8')

  /*
   * muted is hier geen nettigheid maar het verschil tussen stil en 25
   * seconden geluid in achttien wasstraten.
   */
  check('de video staat op muted', /<video[\s\S]{0,400}?muted/.test(login))
  /* Zonder playsInline zet iOS hem schermvullend zodra hij begint. */
  check('en op playsInline', /<video[\s\S]{0,400}?playsInline/.test(login))
  check('en in een lus', /<video[\s\S]{0,400}?loop/.test(login))

  /*
   * De knop "rustige beweging" dekte video niet: de CSS-vangnet raakt alleen
   * animation en transition, en MotionConfig alleen framer-motion. useBeweegt()
   * bestond al en werd nergens gebruikt.
   */
  check('wie rust wil, krijgt geen video',
    login.includes('const beweegt = useBeweegt()')
      && /{beweegt &&[\s\S]{0,120}<video/.test(login))

  /*
   * .auth-screen wordt door vijf schermen gebruikt. Wie net is uitgenodigd en
   * verplicht een wachtwoord moet kiezen, hoort geen filmpje te krijgen.
   */
  check('alleen op het inlogscherm',
    login.includes('className="auth-screen inlogscherm"'))
  /*
   * Op de klasse en niet op het woord.
   *
   * Dit sloeg aan op de knoptekst "Naar het inlogscherm" in ForgotPassword --
   * een zin voor de lezer, geen video. Zo'n valse melding is erger dan geen
   * melding: hij leert je de uitslag wegwuiven.
   */
  const anderen = ['Aanmelden', 'ForgotPassword', 'WachtwoordWijzigen']
    .filter((n) => existsSync('src/components/' + n + '.tsx'))
    .filter((n) => readFileSync('src/components/' + n + '.tsx', 'utf8')
      .includes('auth-screen inlogscherm'))
  check('en niet op de andere authenticatieschermen',
    anderen.length === 0, anderen.join(', '))

  /*
   * .auth-screen had geen position. Een absoluut geplaatst kind zoekt dan het
   * eerste ouderelement dat er wel een heeft, en dan hangt de video ergens
   * anders in de pagina dan waar hij hoort.
   */
  check('de houder heeft een eigen positie',
    /\.inlogscherm {[^}]*position: relative/.test(css), 'geen position op .inlogscherm')
  check('en de kaart staat erboven',
    /\.auth-card {[\s\S]{0,400}?z-index: 1/.test(css))
}

/* ====================================================================
 *  58. De zijbalk is weg, en er is niets met hem meegegaan
 *
 *  Casper: "Verwijder de huidige permanente navigatiebalk aan de zijkant ...
 *  Maak linksboven een duidelijke menu-/app-launcher-knop."
 *
 *  Het gevaar van deze wijziging zit niet in de balk. Dat is een element dat
 *  je weghaalt en dan is hij weg. Het gevaar zit in de tweeenzestig
 *  schermsleutels die erin stonden: valt er een buiten de nieuwe indeling,
 *  dan is dat scherm nergens meer te vinden. De app werkt, er komt geen
 *  foutmelding, en niemand merkt het tot iemand ernaar zoekt.
 *
 *  Vandaar dat dit hoofdstuk niet kijkt of het er mooi uitziet, maar of er
 *  iets kwijt is.
 * ==================================================================== */

console.log('\n58. De zijbalk is weg')

{
  const { readFileSync } = await import('node:fs')
  const {
    CATEGORIEEN, paginasInMenu, paginasZonderPlek,
    paginasDieNietBestaan, paginasDubbel,
  } = await import('../../src/lib/menu.ts')
  const { DASHBOARDS_MET } = await import('../../src/lib/schermen.ts')

  /* ---- niets kwijt ---- */

  const bestaat = Object.keys(DASHBOARDS_MET).length
  check('er zijn schermen om in te delen', bestaat > 50, String(bestaat))

  /*
   * De drie controles die er werkelijk toe doen. Ze staan los omdat ze elk
   * een ander soort fout vangen, en de melding moet zeggen WELKE sleutel het
   * betreft -- anders zoek je hem met de hand terug uit tweeenzestig.
   */
  const zonder = paginasZonderPlek()
  check('elk bestaand scherm staat in het menu', zonder.length === 0,
    'geen plek voor: ' + zonder.join(', '))

  const spoken = paginasDieNietBestaan()
  check('en het menu verwijst nergens naar een scherm dat niet bestaat',
    spoken.length === 0, 'bestaat niet: ' + spoken.join(', '))

  const dubbel = paginasDubbel()
  check('en niets staat in twee categorieen', dubbel.length === 0,
    'dubbel: ' + dubbel.join(', '))

  check('het menu dekt precies de schermen die er zijn',
    paginasInMenu().length === bestaat,
    `${paginasInMenu().length} in het menu, ${bestaat} schermen`)

  /* ---- de indeling zelf ---- */

  check('er zijn categorieen', CATEGORIEEN.length >= 4, String(CATEGORIEEN.length))
  check('en geen enkele is leeg',
    CATEGORIEEN.every((c) => c.paginas.length > 0),
    CATEGORIEEN.filter((c) => !c.paginas.length).map((c) => c.naam).join(', '))
  /*
   * Menu -> categorie -> functie, en niet dieper. Een categorie met veertig
   * items is geen categorie meer maar een lijst waar je in zoekt -- precies
   * wat de oude zijbalk was.
   */
  const grootste = Math.max(...CATEGORIEEN.map((c) => c.paginas.length))
  check('en geen enkele is een lijst geworden', grootste <= 18, String(grootste))

  /* ---- wat er uit de Shell verdwenen moest ---- */

  const shell = readFileSync('src/components/Shell.tsx', 'utf8')

  check('de zijbalk staat niet meer in de Shell',
    !/<aside className="sidebar"/.test(shell))
  check('en het raster van twee kolommen ook niet',
    !shell.includes('className={`app-shell'))
  check('er is een menuknop', shell.includes('className="menuknop"'))
  check('en die vertelt of hij openstaat',
    /aria-expanded={menuZichtbaar}/.test(shell))

  /* ---- en wat er NIET mocht verdwijnen ---- */

  /*
   * Dit is de andere helft. Alles wat in de voet van de zijbalk zat moet
   * ergens anders terecht zijn gekomen; anders is "de zijbalk is weg" waar
   * en heeft iemand zijn uitlogknop niet meer.
   */
  for (const [wat, waar] of [
    ['ander dashboard', 'clearRole'],
    ['instellingen', 'setInstellingen(true)'],
    ['uitloggen', 'void logout()'],
    ['de versie', 'v${version}'],
    ['synchroniseren', 'void sync()'],
    ['storing melden', 'setStoring(true)'],
    ['de vestigingswisselaar', '<LocationSwitcher />'],
    ['zoeken', 'openSearch(false)'],
    ['meldingen', '<NotificationCenter />'],
    ['de onderbalk op een telefoon', 'className="mobile-nav"'],
  ] as const) {
    check(`${wat} bestaat nog`, shell.includes(waar))
  }

  /* ---- de rondleiding wijst nog ergens naar ---- */

  /*
   * Vierentwintig stappen wijzen naar doel: nav-<sleutel>. Die elementen
   * zaten in de zijbalk en zitten nu in de launcher -- die dicht staat.
   * Zonder de vlag hieronder start de rondleiding, gebeurt er niets, en is
   * er niets te zien wat erop wijst waarom.
   */
  const rond = readFileSync('src/lib/rondleiding.ts', 'utf8')
  const navDoelen = (rond.match(/doel: 'nav-[a-z]+'/g) ?? []).length
  check('de rondleiding wijst naar menu-items', navDoelen > 10, String(navDoelen))

  check('de launcher draagt die doelen',
    shell.includes('data-rondleiding={`nav-${it.key}`}'))
  check('en het menu gaat open als de uitleg erheen wijst',
    shell.includes('menuNodig') && shell.includes('menuOpen || menuNodig'))

  const uitleg = readFileSync('src/components/Rondleiding.tsx', 'utf8')
  check('de rondleiding zet die vlag ook echt',
    /zetMenuNodig\(!!doelNu\?\.startsWith\('nav-'\)\)/.test(uitleg))
  check('en zet hem uit als hij klaar is',
    uitleg.includes('() => zetMenuNodig(false)'))
}

/* ====================================================================
 *  59. Geen doodlopende wegen
 *
 *  Bij de UX-verbouwing heb ik acht lezers de app laten doorspitten, en die
 *  vonden iets wat geen enkele test zag: overal wegen die naar niets leiden.
 *
 *    - twee meldingen wezen naar een pagina die niet bestaat. 'meldingen'
 *      (het scherm heet tickets) en 'werknemers' (het heet chauffeurs). Klik
 *      erop en er gebeurt niets -- juist bij de mensen die toch al twijfelden
 *      of de app iets met hun melding deed.
 *    - de knop "Openen" in het postvak deed goto('financieel'), en dat scherm
 *      heeft alleen het management. De administratie -- de rol die dit
 *      postvak dagelijks leegwerkt -- bleef staan waar ze stond.
 *    - elf bestaande schermen stonden niet in de zoeklijst en waren dus
 *      alleen via het menu te vinden. Een klant die "facturen" typte kreeg
 *      vier treffers en niet zijn eigen facturenscherm.
 *    - de takenmail (?open=werk) deed niets bij de ontwikkelaar: dat
 *      dashboard rendert Werk wel maar noemde het niet als navigatiedoel.
 *    - en op een telefoon navigeerden twee van de vier vakken bij de
 *      administratie naar een groepskop, wat een leeg scherm oplevert.
 *
 *  Waarom niets dit ving: de zelftest keek maar EEN kant op -- staat elk
 *  scherm uit de zoeklijst in de kaart. Nooit of elk scherm in de kaart ook
 *  vindbaar is, en nooit of een meldingslink ergens uitkomt.
 *
 *  Dit hoofdstuk kijkt beide kanten op, en per klasse in plaats van per
 *  geval. Een nieuwe dode link valt er dus ook in.
 * ==================================================================== */

console.log('\n59. Geen doodlopende wegen')

{
  const { readFileSync, readdirSync } = await import('node:fs')
  const { DASHBOARDS_MET, SCHERMEN, VENSTER_ITEMS } =
    await import('../../src/lib/schermen.ts')

  const bestaat = new Set(Object.keys(DASHBOARDS_MET))

  /*
   * Drie sleutels zijn een menu-item en geen pagina: ze openen een venster.
   * Nagemeten -- er is geen enkel dashboard met een tak ervoor. Ze horen dus
   * wel in het menu en niet in de zoeklijst, en dat staat benoemd in
   * schermen.ts en niet hier: het is een eigenschap van die sleutels.
   */
  const vensters = new Set<string>(VENSTER_ITEMS)
  for (const sleutel of vensters) {
    check(`${sleutel} is een venster en geen pagina`, bestaat.has(sleutel))
  }

  /* ---- beide kanten op ---- */

  /* Deze richting stond er al. */
  const zonderDashboard = SCHERMEN
    .map((s) => s.page)
    .filter((p) => !bestaat.has(p))
  check('elk scherm uit de zoeklijst heeft een dashboard',
    zonderDashboard.length === 0, zonderDashboard.join(', '))

  /*
   * En deze niet. Dit is het gat waardoor elf schermen onvindbaar konden
   * blijven: ze stonden in de kaart, dus het menu kende ze, maar in de
   * zoeklijst niet -- en de zoekbalk is op een telefoon de kortste weg.
   */
  const inZoeklijst = new Set(SCHERMEN.map((s) => s.page))
  const onvindbaar = [...bestaat]
    .filter((p) => !inZoeklijst.has(p) && !vensters.has(p))
    .sort()
  check('en elk scherm uit de kaart staat in de zoeklijst',
    onvindbaar.length === 0, 'niet te vinden: ' + onvindbaar.join(', '))

  /* ---- geen melding die nergens uitkomt ---- */

  /*
   * Per klasse en niet per geval: elke link in elk bestand onder src/lib
   * moet een pagina zijn. Zo valt de volgende dode link er ook in, en niet
   * pas als iemand hem aanklikt.
   *
   * De zoekopdracht is met opzet ruim -- link: '<iets>' -- want het gaat er
   * juist om dat er geen enkele buiten valt.
   */
  const doden: string[] = []
  for (const naam of readdirSync('src/lib')) {
    if (!naam.endsWith('.ts')) continue
    const tekst = readFileSync('src/lib/' + naam, 'utf8')
    for (const m of tekst.matchAll(/link: '([a-z-]+)'/g)) {
      if (!bestaat.has(m[1])) doden.push(`${naam}: ${m[1]}`)
    }
  }
  check('elke meldingslink wijst naar een scherm dat bestaat',
    doden.length === 0, doden.join(' | '))

  /* ---- het postvak brengt je naar je eigen bonnen ---- */

  const postbus = readFileSync('src/components/Postbus.tsx', 'utf8')
  /*
   * De knop moet kiezen. goto('financieel') hardcoderen betekent dat hij
   * werkt voor het management en voor niemand anders -- en dat is niet te
   * zien aan de knop.
   */
  check('het postvak kiest het bonnenscherm van dit dashboard',
    postbus.includes("kiesPagina(['kosten', 'financieel']"),
    'staat nog vast op een scherm')
  /*
   * Op de AANROEP en niet op de tekst.
   *
   * Dit sloeg eerst aan op mijn eigen commentaar erboven, waarin staat wat
   * er misging -- en die uitleg hoort te blijven staan. Dezelfde fout heb ik
   * in dit bestand al twee keer gemaakt (hoofdstuk 52 en 56); vandaar hier
   * meteen het patroon van de aanroep.
   */
  check('en niet meer vast op financieel',
    !/onNaarBon={\(\) => goto\('financieel'\)}/.test(postbus))

  /* ---- de takenmail komt aan ---- */

  /*
   * Elk dashboard dat een scherm RENDERT moet het ook als navigatiedoel
   * opgeven, anders doet een diepe link of een knop in een mail niets -- en
   * blijft het doel in useNav hangen, zodat je er later onaangekondigd op
   * landt in een ander dashboard.
   *
   * Hier stond een controle op drie namen in één dashboard, omdat "de hele
   * lijst nalopen het parseren van acht dashboards zou vragen". Dat hoeft
   * niet meer: sinds er per dashboard één lijst is, worden de doelen eruit
   * afgeleid en kan het verschil niet meer bestaan. Groep 35 kijkt dat na,
   * voor alle negen.
   */

  /* ---- en de onderbalk op een telefoon ---- */

  const shell = readFileSync('src/components/Shell.tsx', 'utf8')
  /*
   * items.slice(0, 4) pakte de eerste vier MENU-items, en twee daarvan zijn
   * bij de administratie een groepskop. Die bestaan als pagina niet, dus
   * leverde een tik een leeg scherm op met de titel "Te doen".
   */
  /* Ook hier op de aanroep: de uitleg in de Shell noemt het oude patroon,
     en dat is de reden dat het er staat. */
  check('de onderbalk pakt echte schermen en geen groepskoppen',
    shell.includes('mobielItems.map')
      && !/{items\.slice\(0, 4\)\.map/.test(shell))
  check('en die lijst slaat groepskoppen over',
    /mobielItems = useMemo\(\s*\(\) =>\s*items\.flatMap/.test(shell))
}

/* ==================================================================== *
 *  99. De documentatie wijst naar iets dat bestaat
 *
 *  Casper: "nu heb ik een gehele documentatie nodig, van a tot z, zodat zowel
 *  medewerkers, zowel toekomstige iters weten wat ze waar moeten vinden."
 *
 *  Het probleem was nooit dat er te weinig documentatie was -- er lagen een
 *  README van achthonderd regels en zes losse stukken. Het was dat niemand
 *  wist waar hij moest kijken, en dat de grootste keten van allemaal nergens
 *  beschreven stond behalve in migratiecommentaar.
 *
 *  Er is nu een wegwijzer. En een wegwijzer die naar een bestand verwijst dat
 *  niet bestaat is erger dan geen wegwijzer: dan zoek je naar iets dat er
 *  nooit was. Dat is precies wat verrot als bestanden hernoemd worden, en
 *  precies wat een test wél kan vangen.
 * ==================================================================== */

console.log('\n99. De documentatie wijst naar iets dat bestaat')

{
  const { readFileSync, existsSync, readdirSync } = await import('node:fs')

  check('er is een wegwijzer', existsSync('docs/README.md'),
    'docs/README.md ontbreekt')

  /* De vier die de keten beschrijven. */
  for (const naam of ['facturen-verwerken.md', 'facturen-techniek.md', 'uitrollen.md']) {
    check(`docs/${naam} bestaat`, existsSync(`docs/${naam}`))
  }

  /*
   * Elke verwijzing in elk document moet ergens op uitkomen. Dit is de
   * controle die echt iets doet: bestandsnamen veranderen, en dan wijst een
   * tabel met "lees dit" naar niets.
   */
  const kapot: string[] = []
  const bestanden = ['README.md', ...readdirSync('docs').map((f) => `docs/${f}`)]
    .filter((f) => f.endsWith('.md'))

  for (const bestand of bestanden) {
    const tekst = readFileSync(bestand, 'utf8')
    const map = bestand.includes('/') ? bestand.slice(0, bestand.lastIndexOf('/')) : '.'
    for (const m of tekst.matchAll(/\]\(([^)#]+?)(?:#[^)]*)?\)/g)) {
      const doel = m[1].trim()
      /* Alleen verwijzingen naar bestanden hier; het web controleren we niet. */
      if (/^[a-z]+:/i.test(doel) || doel.startsWith('/')) continue
      const pad = doel.startsWith('../')
        ? doel.replace(/^\.\.\//, '')
        : (map === '.' ? doel : `${map}/${doel}`)
      if (!existsSync(pad)) kapot.push(`${bestand} -> ${doel}`)
    }
  }

  check('en elke verwijzing komt ergens op uit',
    kapot.length === 0, kapot.join(' | '))

  /*
   * En de wegwijzer wijst naar alles wat er ligt. Een document dat er wel is
   * maar nergens genoemd wordt, is een document dat niemand vindt -- precies
   * het probleem waar dit voor bedoeld was.
   */
  const wegwijzer = readFileSync('docs/README.md', 'utf8')
  const vergeten = readdirSync('docs')
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .filter((f) => !wegwijzer.includes(f))
  check('en noemt elk document dat er ligt',
    vergeten.length === 0, vergeten.join(', '))

  /* De hoofd-README hoort ernaar te wijzen, anders begint niemand daar. */
  check('de hoofd-README wijst naar de wegwijzer',
    readFileSync('README.md', 'utf8').includes('docs/README.md'),
    'wie bij README.md begint vindt de rest niet')
}

/* ==================================================================== *
 *  100. Het virtuele kantoor
 *
 *  Casper: "Ik wil een virtual office, je kan inloggen, en dan heb je dan een
 *  extra tabje. Dan heb je bijvoorbeeld de receptie, waar je kan praten met
 *  trucky (of een melding kan maken), kantoren voor bijvoorbeeld
 *  administratie ect ect. Maar je moet ook een bieb hebben voor die
 *  documentatie. Zorg dat enkel medewerkers, managment ect ect erin kunnen,
 *  geen klanten of uitgenodigde klanten."
 *
 *  Twee dingen moeten hier hard zijn, en de rest is smaak.
 *
 *  Wie erin mag. Een klant hoort dit niet te zien -- ook niet leeg, want de
 *  namen van de deuren verraden al hoe de organisatie in elkaar zit.
 *
 *  En dat het kantoor GEEN tweede rechtensysteem wordt. Een deur gaat open op
 *  hetzelfde recht dat het menu gebruikt. Zou het kantoor eigen rechten
 *  krijgen, dan zijn er twee plekken waar je ze fout kunt zetten, en de
 *  tweede vergeet iedereen.
 * ==================================================================== */

console.log('\n100. Het virtuele kantoor')

{
  const kantoor = await import('../../src/lib/kantoor')
  const { magKantoor, ruimtesVoor, RUIMTES, KANTOOR_UITGESLOTEN } = kantoor

  /* --- 1. wie erin mag --- */

  check('een klant komt het kantoor niet in',
    !magKantoor('employer') && !magKantoor('customer'),
    'een klant kan het virtuele kantoor openen')

  check('en een medewerker wel',
    ['employee', 'supervisor', 'technician', 'administratie', 'management', 'developer']
      .every((r) => magKantoor(r as never)),
    'niet elke interne rol komt binnen')

  /* Zonder rol ook niet -- dat is de stand vóór het kiezen. */
  check('en zonder rol niet', !magKantoor(null) && !magKantoor(undefined))

  /*
   * En een klant krijgt niet "het kantoor maar leeg". Dat lijkt hetzelfde en
   * is het niet: een lege lobby met de tekst "je hebt hier geen rechten" zegt
   * nog steeds dát er een kantoor is.
   */
  check('een klant krijgt geen enkele deur, ook niet met alle rechten',
    ruimtesVoor('employer' as never, () => true).length === 0,
    'een klant ziet deuren')

  /* --- 2. geen tweede rechtensysteem --- */

  /*
   * Elke deur die een recht eist, gebruikt een recht dat echt bestaat. Een
   * typefout in een rechtnaam zou betekenen dat de deur er voor niemand is,
   * of juist voor iedereen -- en dat merk je pas als iemand klaagt.
   */
  const { PERMISSIONS } = await import('../../src/lib/types')
  const bestaat = new Set(PERMISSIONS.map((p: { key: string }) => p.key))
  const onbekend = RUIMTES
    .flatMap((r: { rechten?: string[] }) => r.rechten ?? [])
    .filter((p: string) => !bestaat.has(p))
  check('elke deur gebruikt een recht dat bestaat',
    onbekend.length === 0, onbekend.join(', '))

  /*
   * En elke deur komt op een bestaand scherm uit, of is een van de twee
   * ruimtes die in het kantoor zelf zitten. Een deur naar een pagina die
   * niemand kent is een muur met een klink.
   */
  const { DASHBOARDS_MET } = await import('../../src/lib/schermen')
  const nergens = RUIMTES
    .map((r: { heen: string }) => r.heen)
    .filter((h: string) => h !== 'receptie' && h !== 'bibliotheek')
    .filter((h: string) => !(h in DASHBOARDS_MET))
  check('en elke deur komt op een bestaand scherm uit',
    nergens.length === 0, nergens.join(', '))

  /*
   * Zonder rechten alleen de twee ruimtes die van het kantoor zelf zijn. Een
   * nieuwe medewerker zonder enig recht hoort niet voor een dichte deur te
   * staan -- vragen en opzoeken mag altijd.
   */
  const kaal = ruimtesVoor('employee' as never, () => false)
  check('zonder rechten blijven de receptie en de bibliotheek over',
    kaal.length === 2 && kaal.every((r: { heen: string }) =>
      r.heen === 'receptie' || r.heen === 'bibliotheek'),
    kaal.map((r: { key: string }) => r.key).join(', '))

  /*
   * En een deur verschijnt niet als het dashboard van die rol de pagina niet
   * kent. De app heeft geen router: een pagina bestaat pas als het dashboard
   * haar rendert.
   */
  const bijEmployee = ruimtesVoor('employee' as never, () => true)
  check('en een deur naar een scherm dat dit dashboard niet kent, is er niet',
    !bijEmployee.some((r: { heen: string }) => r.heen === 'boekhouding'),
    'een werknemer krijgt een deur naar de boekhouding')

  check('de uitgesloten rollen staan op één plek',
    KANTOOR_UITGESLOTEN.length === 2,
    'de lijst met uitgesloten rollen klopt niet')

  /* --- 3. de bibliotheek leest echte documentatie --- */

  const { leesMarkdown, leesStukjes, koppenVan, kopId } = await import('../../src/lib/markdown')

  const proef = leesMarkdown([
    '# Titel',
    '',
    'Een alinea met **vet** en `code`.',
    '',
    '## Een kop',
    '',
    '- een punt',
    '- nog een',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '```sql',
    'select 1;',
    '```',
    '',
    '> een citaat',
  ].join('\n'))

  const soorten = proef.map((b: { soort: string }) => b.soort)
  check('de markdown-lezer kent kop, alinea, lijst, tabel, code en citaat',
    ['kop', 'alinea', 'kop', 'lijst', 'tabel', 'code', 'citaat']
      .every((s2) => soorten.includes(s2)),
    soorten.join(', '))

  /* Een tabel met één rij hoort één rij te hebben, niet twee (de rand telt
     niet mee) of nul. */
  const tabel = proef.find((b: { soort: string }) => b.soort === 'tabel') as
    { rijen: unknown[]; koppen: unknown[] }
  check('en een tabel houdt zijn koppen en zijn rijen uit elkaar',
    tabel && tabel.koppen.length === 2 && tabel.rijen.length === 1,
    JSON.stringify({ k: tabel?.koppen.length, r: tabel?.rijen.length }))

  /*
   * Backticks winnen van sterretjes. In `**niet vet**` hoor je precies dat te
   * zien -- dat is waar backticks voor zijn, en een lezer die daar vet van
   * maakt is onbruikbaar voor documentatie over code.
   */
  const gemengd = leesStukjes('`**niet vet**` maar **wel vet**')
  check('code wint van vet',
    gemengd[0].soort === 'code' && gemengd[0].tekst === '**niet vet**'
      && gemengd.some((x: { soort: string }) => x.soort === 'vet'),
    JSON.stringify(gemengd))

  /* Een streep is geen lijst, ook al begint hij met streepjes. */
  const streep = leesMarkdown('tekst\n\n---\n\nmeer tekst')
  check('--- is een streep en geen opsomming',
    streep.some((b: { soort: string }) => b.soort === 'streep')
      && !streep.some((b: { soort: string }) => b.soort === 'lijst'),
    streep.map((b: { soort: string }) => b.soort).join(', '))

  /* Een anker moet twee keer hetzelfde opleveren, anders werkt de
     inhoudsopgave één keer. */
  check('een kop krijgt een stabiel anker',
    kopId('Als er iets vastzit') === kopId('Als er iets vastzit')
      && kopId('Als er iets vastzit') === 'als-er-iets-vastzit',
    kopId('Als er iets vastzit'))

  /*
   * En de lezer moet de ECHTE documentatie aankunnen -- dat is waar hij voor
   * is. Elk document uit docs/ erdoorheen, en er moet iets uitkomen.
   */
  const { readFileSync, readdirSync } = await import('node:fs')
  const stuk: string[] = []
  for (const naam of readdirSync('docs').filter((f) => f.endsWith('.md'))) {
    const blokken = leesMarkdown(readFileSync(`docs/${naam}`, 'utf8'))
    if (blokken.length < 3) stuk.push(`${naam}: ${blokken.length} blokken`)
    if (koppenVan(blokken).length === 0) stuk.push(`${naam}: geen koppen`)
  }
  check('en elk echt document komt er leesbaar uit',
    stuk.length === 0, stuk.join(' | '))

  /* --- 4. en het is een scherm zoals de andere --- */

  const { DASHBOARDS_MET: kaart } = await import('../../src/lib/schermen')
  check('het kantoor staat in de schermenkaart',
    Array.isArray(kaart.kantoor) && kaart.kantoor.length > 0,
    'kantoor ontbreekt in DASHBOARDS_MET')

  check('en niet voor klanten',
    !kaart.kantoor.includes('customer') && !kaart.kantoor.includes('employer'),
    'een klantdashboard kent de pagina kantoor')

  /* --- en wat er dubbel stond, staat nu op een plek --- */

  /*
   * Casper: "Bij ontwikkelaar heb ik bij inkoop nog steeds de adressen en
   * grootboekrekeningen, gezien die bij administratie opkomen, kan dat daar
   * niet weg?"
   *
   * De BEREKENDE adreslijst wel: sinds 0095 is een adres een rij met een
   * onderneming en een persoon eraan, en die lijst wist daar niets van.
   * De instellingen eromheen blijven -- domein, voorvoegsel, wie er leest --
   * want die staan nergens anders.
   */
  const inkoopScherm = readFileSync('src/components/Inkoop.tsx', 'utf8')
  check('de berekende adreslijst staat niet meer bij de ontwikkelaar',
    !inkoopScherm.includes('function AdresRegel'),
    'er staan nog twee lijsten met inkoopadressen')

  check('maar het domein en de lezer staan er nog wel',
    inkoopScherm.includes('factuur_lezer') || inkoopScherm.includes('SLEUTELS'),
    'de instellingen zijn meegesneuveld met de lijst')

  /*
   * En de rekeningenkaart heet niet meer alsof het een tweede rekeningschema
   * is. Hij blijft bestaan, want de TREFWOORDEN staan nergens anders en
   * zonder die tabel deelt factuur_indelen() niets meer in.
   */
  check('en de trefwoordenkaart doet zich niet voor als het grootboek',
    !inkoopScherm.includes('title="Grootboekrekeningen"')
      && inkoopScherm.includes('Trefwoorden voor het indelen'),
    'de kaart heet nog Grootboekrekeningen')

  /*
   * Casper, met een schermafdruk van honderden regels waarbij er bijna geen
   * een een trefwoord had: "Die trefwoorden, of laat ze per bv zien, of niet,
   * liever per bv... Zodat het geen eindeloze lijst wordt daar."
   *
   * Twee dingen, en ze zijn allebei nodig. Per bv, want rekening 4040 bestaat
   * in de ene administratie en niet in de andere. En standaard alleen wat
   * een trefwoord HEEFT, want een lijst waarin negenennegentig procent niets
   * doet, is een lijst waarin je het ene dat wel iets doet niet meer vindt.
   *
   * De lijst komt sinds 0104 uit het schema van Exact en niet meer uit onze
   * eigen kopie. Dat moest wel: lokaal staat grootboek op code, dus die kopie
   * hield van twintig bv's er één over, en het filter op administratie
   * filterde op de bv die toevallig als laatste binnenkwam.
   */
  check('de trefwoorden zijn per onderneming te bekijken',
    inkoopScherm.includes('rekeningenVan(schema, rijen, bv || undefined)'),
    'alle bv-en staan nog door elkaar')

  /* Dezelfde regel als bij het boeken, en niet een tweede versie ervan.
     Het pad is korter geworden: dit scherm staat sinds deze versie bij de
     gedeelde componenten, want de administratie gebruikt het ook. */
  check('en met dezelfde regel als bij het boeken',
    /from '\.\.?\/(\.\.\/)?lib\/boeking'/.test(inkoopScherm),
    'er staat een tweede regel voor welke rekening bij welke bv hoort')

  check('en standaard alleen de rekeningen die iets doen',
    /const metTrefwoord/.test(inkoopScherm),
    'de hele lijst staat nog open')

  /* Maar niet stil: wie een rekening niet ziet, moet weten dat hij bestaat. */
  check('met erbij hoeveel er verborgen zijn, en een knop om ze te tonen',
    inkoopScherm.includes('Toon ze toch'),
    'de verborgen rekeningen verdwijnen zonder dat iemand het weet')

  /* --- het btw-nummer komt uit Exact, de andere twee niet --- */

  const exactFn2 = readFileSync('supabase/functions/exact/index.ts', 'utf8')
  check('het btw-nummer wordt uit Exact overgenomen',
    exactFn2.includes("'hrm/Divisions'") && exactFn2.includes('VATNumber'),
    'de btw-nummers moeten nog met de hand')

  /* Alleen waar het leeg staat: wat een mens heeft nagekeken wint van wat
     Exact toevallig bewaart. */
  check('maar alleen waar het nog leeg staat',
    /if \(!String\(staat\?\.btw_nummer \?\? ''\)\.trim\(\)\)/.test(exactFn2),
    'een ingetikt btw-nummer wordt overschreven')

  /* En dat KvK en IBAN niet uit Exact komen, staat op het scherm. Anders
     blijft iemand zoeken naar een knop die niet bestaat. */
  const exactScherm = readFileSync('src/components/Exact.tsx', 'utf8')
  check('en er staat bij welke nummers Exact NIET weet',
    exactScherm.includes('blijven handwerk'),
    'niemand kan zien waarom KvK en IBAN met de hand moeten')

  /* De opmaak leunt op de bestaande tokens; een eigen kleur zou in de lichte
     stand een vlek worden die niet meer weg te krijgen is. */
  const css = readFileSync('src/styles/kantoor.css', 'utf8')
  /*
   * Eerst het commentaar eruit. De uitleg NOEMT die kleuren -- dat is juist
   * het punt dat ze al bestaan -- en een controle die daarover struikelt
   * meet het commentaar in plaats van de opmaak. Vierde keer dat deze val
   * toeslaat; zie ook groep 89, 95 en 98.
   */
  const eigenKleuren = (zonderCommentaar(css).match(/#[0-9a-f]{3,8}\b/gi) ?? [])
  check('en de opmaak verzint geen eigen kleuren',
    eigenKleuren.length === 0, eigenKleuren.join(', '))
}
}
