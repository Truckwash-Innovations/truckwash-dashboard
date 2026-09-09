/**
 * De merksite opnieuw bouwen uit de database.
 *
 * Waarom dit bestaat
 * ------------------
 *
 * Casper: "als ik een vestiging maak via de app, dat je die direct live hebt
 * op de website, kan je de website niet die locaties uit de database laten
 * halen?"
 *
 * Half deed hij dat al. assets/live.js haalt bij elk bezoek de actuele
 * gegevens op en werkt de lijsten en de tellingen bij. Maar elke vestiging
 * heeft ook een EIGEN pagina, en die bestaat als bestand. Een nieuwe
 * vestiging heeft dus geen pagina (404) en een weggehaalde heeft er nog een
 * -- gemeten: /locaties/roosendaaltest/ gaf nog gewoon 200 nadat hij uit de
 * database was verdwenen. Hetzelfde geldt voor sitemap.xml en de
 * vestigingenlijst in de voettekst van alle 49 pagina's.
 *
 * Dat is niet met een script in de browser op te lossen: een pagina die er
 * niet is, kan zichzelf niet invullen. De site moet opnieuw gebouwd worden.
 *
 * En dat kon tot nu toe op één laptop. truckwash-website is geen git-repo,
 * dus de generator stond nergens anders. Sinds site:ophalen hem meeneemt
 * staat hij in sitebouw/ en kan GitHub het ook -- zie
 * .github/workflows/site.yml.
 *
 * Draaien:
 *
 *   npm run site:bouwen              haal de vestigingen op en bouw
 *   npm run site:bouwen -- --droog   bouw, maar laat site/ ongemoeid
 *
 * DE STILLE FOUT DIE HIER OP DE LOER LIGT
 * ---------------------------------------
 *
 * webbouw.cjs faalt met opzet zacht: ontbreekt vestigingen.json of is hij
 * stuk, dan bouwt hij door met de achttien vestigingen uit site.json. Dat is
 * juist gedrag op een laptop zonder bereik -- de site hoort te bouwen met wat
 * er ligt.
 *
 * Hier is het levensgevaarlijk. Draait dit in GitHub, mislukt het ophalen, en
 * committen we de uitkomst, dan draaien we de site stilletjes terug naar de
 * stand van site.json. Geen foutmelding, een groene bouw, en een site die een
 * halfjaar oude vestigingen toont.
 *
 * Vandaar de versheidscontrole hieronder. Is vestigingen.json niet zojuist
 * opgehaald, dan stopt dit script met een foutcode en wordt er niets
 * vervangen. Liever geen herbouw dan een verkeerde.
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const bouw = path.join(root, 'sitebouw')
const site = path.join(root, 'site')
const werk = path.join(root, '.site-bouw')

const droog = process.argv.includes('--droog')

/* Hoe oud vestigingen.json hoogstens mag zijn om als "zojuist opgehaald" te
   tellen. Ruim genomen: het ophalen zelf duurt seconden, maar een trage
   koude start van de edge function mag geen bouw laten omvallen. */
const VERS_GENOEG_MS = 10 * 60 * 1000

function stop(waarom, hoe) {
  console.error(`\n  ${waarom}`)
  if (hoe) console.error(`  ${hoe}`)
  console.error('')
  process.exit(1)
}

/* ------------------------------------------------------------------ *
 *  1. Staat de bouwer er?
 * ------------------------------------------------------------------ */

if (!fs.existsSync(path.join(bouw, 'webbouw.cjs'))) {
  stop(
    'sitebouw/ ontbreekt; er valt niets te bouwen.',
    'Draai eerst npm run site:ophalen -- die haalt de site en de bouwer op uit truckwash-website.')
}

/* ------------------------------------------------------------------ *
 *  2. De vestigingen ophalen
 *
 *  vestigingen.cjs faalt met opzet zacht en eindigt op 0, ook als het
 *  ophalen mislukt -- zie de kop van dat bestand. De uitkomst wordt daarom
 *  hieronder aan het bestand zelf afgelezen en niet aan de foutcode.
 * ------------------------------------------------------------------ */

const lijst = path.join(bouw, 'vestigingen.json')
const voor = fs.existsSync(lijst) ? fs.readFileSync(lijst, 'utf8') : null

console.log('De vestigingen ophalen...')
try {
  execFileSync(process.execPath, ['vestigingen.cjs'], {
    cwd: bouw,
    stdio: 'inherit',
    env: {
      ...process.env,
      /* vestigingen.cjs zoekt de sleutels naast zichzelf in ../../dashboard.
         Sinds hij IN het dashboard staat klopt dat pad niet meer, dus wijzen
         we hem hier aan. */
      DASHBOARD: root,
    },
  })
} catch (e) {
  stop('Het ophalen van de vestigingen liep vast.', String(e.message || e).split('\n')[0])
}

/* ------------------------------------------------------------------ *
 *  3. Is het echt opgehaald?
 *
 *  Dit is de rem uit de kop. Zonder deze controle bouwt een mislukt ophalen
 *  een site uit site.json en ziet niemand het verschil tot er iemand belt.
 * ------------------------------------------------------------------ */

if (!fs.existsSync(lijst)) {
  stop('vestigingen.json is er niet; het ophalen is mislukt.',
       'Er wordt niets vervangen -- liever geen herbouw dan een verkeerde.')
}

let pak
try {
  pak = JSON.parse(fs.readFileSync(lijst, 'utf8'))
} catch (e) {
  stop('vestigingen.json is onleesbaar.', String(e.message || e))
}

const opgehaald = Date.parse(pak?.opgehaald ?? '')
const oud = Number.isNaN(opgehaald) ? Infinity : Date.now() - opgehaald

if (oud > VERS_GENOEG_MS) {
  const na = fs.readFileSync(lijst, 'utf8')
  stop(
    `vestigingen.json is niet ververst (${Number.isFinite(oud)
      ? Math.round(oud / 60000) + ' minuten oud'
      : 'geen tijdstempel'}).`,
    voor === na
      ? 'Het bestand is niet eens veranderd: de edge function website-gegevens was niet bereikbaar.'
      : 'Het ophalen gaf geen bruikbaar antwoord. Er wordt niets vervangen.')
}

const aantal = Array.isArray(pak.vestigingen) ? pak.vestigingen.length : 0
if (aantal === 0) {
  stop('De database gaf nul vestigingen terug.',
       'Dat is bijna zeker een storing en geen bedrijf zonder vestigingen; er wordt niets vervangen.')
}

console.log(`  ${aantal} vestigingen, opgehaald ${Math.round(oud / 1000)} seconden geleden`)

/* ------------------------------------------------------------------ *
 *  4. Bouwen, in een lege map naast de bestaande site
 *
 *  Niet over site/ heen. Een vestiging die uit de database verdwijnt laat
 *  dan zijn map staan, en die wordt daarna gewoon weer gepubliceerd -- exact
 *  de fout waar dit script voor bestaat.
 *
 *  De map wordt wel eerst gevuld met de assets van de huidige site: de
 *  opmaak, de lettertypen, de foto's en app.js komen uit truckwash-website
 *  en niet uit de bouwer. webbouw.cjs schrijft daar zelf live.js, data.js en
 *  favicon.svg overheen.
 * ------------------------------------------------------------------ */

fs.rmSync(werk, { recursive: true, force: true })
fs.mkdirSync(path.join(werk, 'assets'), { recursive: true })

if (!fs.existsSync(path.join(site, 'assets'))) {
  stop('site/assets ontbreekt.', 'Draai eerst npm run site:ophalen.')
}
fs.cpSync(path.join(site, 'assets'), path.join(werk, 'assets'), { recursive: true })

console.log('Bouwen...')
try {
  execFileSync(process.execPath, ['webbouw.cjs'], {
    cwd: bouw,
    stdio: 'inherit',
    env: { ...process.env, UIT: werk },
  })
} catch (e) {
  fs.rmSync(werk, { recursive: true, force: true })
  stop('De bouw liep vast.', String(e.message || e).split('\n')[0])
}

/* ------------------------------------------------------------------ *
 *  5. Nakijken voordat we iets vervangen
 *
 *  Een bouw die "gelukt" meldt en een halve site oplevert, is erger dan een
 *  bouw die omvalt. Deze vier dingen moeten er zijn; ontbreekt er een, dan
 *  blijft site/ staan zoals hij stond.
 * ------------------------------------------------------------------ */

const moetBestaan = ['index.html', '404.html', 'sitemap.xml', 'robots.txt']
const mist = moetBestaan.filter((n) => !fs.existsSync(path.join(werk, n)))
if (mist.length) {
  fs.rmSync(werk, { recursive: true, force: true })
  stop(`De bouw is niet af: ${mist.join(', ')} ontbreekt.`, 'site/ is niet aangeraakt.')
}

/*
 * En de robots.txt moet de site toelaten.
 *
 * scripts/uitrol-bestanden.cjs breekt de bouw af op een robots.txt met
 * Disallow, en met reden: die haalt de complete site uit Google. Hier
 * dezelfde controle, een stap eerder -- dan valt het op vóórdat er iets
 * vervangen is in plaats van erna.
 */
const robots = fs.readFileSync(path.join(werk, 'robots.txt'), 'utf8')
if (/^\s*Disallow:\s*\/\s*$/mi.test(robots)) {
  fs.rmSync(werk, { recursive: true, force: true })
  stop('De gebouwde robots.txt sluit de hele site af (Disallow: /).', 'site/ is niet aangeraakt.')
}

const tel = (d) => fs.readdirSync(d, { withFileTypes: true })
  .reduce((n, i) => n + (i.isDirectory()
    ? tel(path.join(d, i.name))
    : Number(i.name === 'index.html')), 0)

const paginas = tel(werk)
if (paginas < 20) {
  fs.rmSync(werk, { recursive: true, force: true })
  stop(`Er zijn maar ${paginas} pagina's gebouwd; dat klopt niet.`, 'site/ is niet aangeraakt.')
}

/* ------------------------------------------------------------------ *
 *  6. Omwisselen
 * ------------------------------------------------------------------ */

if (droog) {
  console.log(`\n  droog: ${paginas} pagina's in .site-bouw/, site/ is niet aangeraakt\n`)
  process.exit(0)
}

fs.rmSync(site, { recursive: true, force: true })
fs.renameSync(werk, site)

console.log(`\n  site: ${paginas} pagina's uit ${aantal} vestigingen\n`)
