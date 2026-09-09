/**
 * Haalt de merksite op uit het buurproject.
 *
 * Waarom dit bestaat
 * ------------------
 *
 * De site wordt gemaakt in projecten/truckwash-website. Die map is geen
 * git-repo en staat dus nergens anders dan op deze ene laptop. Cloudflare
 * bouwt uit een kloon van de dashboard-repo, en wat daar niet in staat
 * bestaat voor de bouwmachine niet.
 *
 * Vandaar deze stap: hij zet een kopie van de gebouwde site in site/, die
 * meegaat in git en dus ook op de bouwmachine landt. Handmatig, niet
 * automatisch bij elke bouw -- dan zou een bouw op een andere machine stil
 * een oude of lege site publiceren.
 *
 * Draaien:  npm run site:ophalen
 *
 * Wat er NIET meegaat naar site/
 * ------------------------------
 *
 *   bouw/       de generator. Die hoort niet in de uitrolmap: Cloudflare
 *               serveert alles wat daarin staat, en dat zou dezelfde site
 *               nog een keer online zetten met de bron erbij.
 *   README.md   ontwikkeldocumentatie.
 *
 * Maar de generator gaat WEL mee, naar sitebouw/
 * ---------------------------------------------
 *
 * Sinds Casper vroeg of een nieuwe vestiging meteen live kan staan. Dat kan
 * alleen door de site opnieuw te bouwen -- een pagina die niet bestaat kan
 * zichzelf niet invullen -- en dat kon tot nu toe op één laptop, want
 * truckwash-website is geen git-repo.
 *
 * Nu staat de bouwer in sitebouw/ en kan GitHub het ook. Zie
 * scripts/site-bouwen.cjs en .github/workflows/site.yml.
 *
 * Het gaat met OPZET in dezelfde stap als het ophalen van de site. Twee
 * losse commando's zouden betekenen dat de gebouwde site en de bouwer die
 * hem maakte uit elkaar kunnen lopen, en dan bouwt GitHub straks iets anders
 * dan wat hier staat -- zonder dat iets dat meldt.
 *
 * Wat er van de generator NIET meegaat:
 *
 *   template.html   200 kB, de voorbeeldpagina. webbouw.cjs raakt hem niet
 *                   aan -- nagekeken: hij leest alleen site.json, beeld.json,
 *                   releases.json, vestigingen.json, brok.js en live.js.
 *   beeld.json      3,4 MB aan foto's als base64. Gaat AFGESLANKT mee: de
 *                   bouw vervangt de src door /assets/img/<rol>.webp en
 *                   gebruikt alleen nog w en h. Dat is 717 bytes in plaats
 *                   van 3,4 MB, en de .webp-bestanden staan al in de site.
 *   de rest         kaart.cjs, lettertypen.cjs, threejs.cjs, fotos.py: die
 *                   maken assets die niet veranderen als er een vestiging
 *                   bijkomt. Die staan al in site/assets/.
 *
 * De robots.txt van de site gaat WEL mee. Dat is met opzet: die staat op
 * "Allow: /", en de app wordt afgeschermd met de kopregel X-Robots-Tag op
 * /app/* uit uitrol/_headers. Zou hier een robots.txt met "Disallow: /"
 * belanden, dan haalt die de complete site uit Google -- scripts/
 * uitrol-bestanden.cjs breekt de bouw af als dat gebeurt.
 */

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const bron = process.env.SITE_BRON
  ? path.resolve(process.env.SITE_BRON)
  : path.resolve(root, '..', 'truckwash-website')
const doel = path.join(root, 'site')
const bouwdoel = path.join(root, 'sitebouw')

/*
 * De generator, en niets meer dan dit.
 *
 * Nageteld tegen wat webbouw.cjs werkelijk inleest; een bestand meer is een
 * bestand dat in twee repo's uit elkaar kan lopen. vestigingen.json staat er
 * met opzet NIET bij: dat is een momentopname die bij elke bouw opnieuw
 * wordt opgehaald, en een oude kopie in de repo is precies waar
 * site-bouwen.cjs een rem op zet.
 */
const BOUWBESTANDEN = [
  'webbouw.cjs',      // de bouwer zelf
  'brok.js',          // alle paginatekenaars
  'site.json',        // de vaste teksten, prijzen en diensten
  'omzet.cjs',        // database-vorm -> site-vorm
  'live.js',          // wordt als assets/live.js weggeschreven
  'releases.json',    // de downloadknoppen op /medewerkers/
  'vestigingen.cjs',  // haalt de vestigingen op bij website-gegevens
]

/* Wat nooit meegaat. Namen in de wortel van de site. */
const OVERSLAAN = new Set(['bouw', 'README.md', '.git', 'node_modules'])

if (!fs.existsSync(path.join(bron, 'index.html'))) {
  console.error(`Geen site gevonden in ${bron}.`)
  console.error('Staat het project ergens anders? Geef het pad mee met SITE_BRON=...')
  process.exit(1)
}

/*
 * Eerst helemaal weg, dan opnieuw.
 *
 * Eroverheen kopieren laat pagina's staan die in de bron zijn verdwenen, en
 * die worden daarna gewoon gepubliceerd. Een verwijderde vestiging die op de
 * site blijft staan is precies het soort fout dat niemand ziet.
 */
fs.rmSync(doel, { recursive: true, force: true })

let bestanden = 0
let bytes = 0

function kopieer(van, naar) {
  fs.mkdirSync(naar, { recursive: true })
  for (const item of fs.readdirSync(van, { withFileTypes: true })) {
    if (naar === doel && OVERSLAAN.has(item.name)) continue
    const a = path.join(van, item.name)
    const b = path.join(naar, item.name)
    if (item.isDirectory()) kopieer(a, b)
    else {
      fs.copyFileSync(a, b)
      bestanden++
      bytes += fs.statSync(b).size
    }
  }
}

kopieer(bron, doel)

/* ------------------------------------------------------------------ *
 *  En de generator naar sitebouw/
 * ------------------------------------------------------------------ */

const bouwbron = path.join(bron, 'bouw')

if (!fs.existsSync(path.join(bouwbron, 'webbouw.cjs'))) {
  console.error(`Geen generator gevonden in ${bouwbron}.`)
  console.error('Zonder sitebouw/ kan GitHub de site niet herbouwen.')
  process.exit(1)
}

fs.rmSync(bouwdoel, { recursive: true, force: true })
fs.mkdirSync(bouwdoel, { recursive: true })

let bouwbytes = 0
for (const naam of BOUWBESTANDEN) {
  const van = path.join(bouwbron, naam)
  if (!fs.existsSync(van)) {
    console.error(`bouw/${naam} ontbreekt in ${bouwbron}.`)
    console.error('De lijst BOUWBESTANDEN hierboven klopt dan niet meer met de generator.')
    process.exit(1)
  }
  const naartoe = path.join(bouwdoel, naam)
  fs.copyFileSync(van, naartoe)
  bouwbytes += fs.statSync(naartoe).size
}

/*
 * beeld.json, maar dan zonder de foto's.
 *
 * webbouw.cjs vervangt in brok.js de regel src="${b.uri}" door
 * src="/assets/img/<rol>.webp" voordat hij hem draait. Van het hele bestand
 * blijven daarmee alleen w en h in gebruik -- 717 bytes in plaats van 3,4 MB.
 *
 * Bewezen en niet aangenomen: een volledige herbouw met deze afgeslankte
 * versie gaf 50 pagina's die byte voor byte gelijk waren aan de site zoals
 * hij live stond. Zelftest 57 houdt dat vast.
 */
const beeld = JSON.parse(fs.readFileSync(path.join(bouwbron, 'beeld.json'), 'utf8'))
const mager = {}
for (const [rol, b] of Object.entries(beeld)) mager[rol] = { w: b.w, h: b.h }
fs.writeFileSync(path.join(bouwdoel, 'beeld.json'), JSON.stringify(mager), 'utf8')
bouwbytes += fs.statSync(path.join(bouwdoel, 'beeld.json')).size

/*
 * De 404 is geen luxe maar een voorwaarde.
 *
 * wrangler.jsonc staat op "404-page": Cloudflare loopt vanaf het aangevraagde
 * pad omhoog tot hij een 404.html vindt. Is die er niet, dan valt hij terug op
 * zijn eigen kale foutpagina -- en dan ziet een bezoeker die zich vertypt geen
 * Truckwash meer maar Cloudflare.
 */
if (!fs.existsSync(path.join(doel, '404.html'))) {
  console.error('site/404.html ontbreekt. Draai in truckwash-website eerst:')
  console.error('  cd bouw && UIT=.. node webbouw.cjs')
  process.exit(1)
}

const pagina = (d) => fs.readdirSync(d, { withFileTypes: true })
  .reduce((n, i) => n + (i.isDirectory()
    ? pagina(path.join(d, i.name))
    : Number(i.name === 'index.html')), 0)

console.log(
  `site: ${bestanden} bestanden (${(bytes / 1024 / 1024).toFixed(1)} MB), ` +
  `${pagina(doel)} pagina's uit ${path.basename(bron)}`)
console.log(
  `sitebouw: ${BOUWBESTANDEN.length + 1} bestanden ` +
  `(${Math.round(bouwbytes / 1024)} kB) -- hiermee kan GitHub de site herbouwen`)
