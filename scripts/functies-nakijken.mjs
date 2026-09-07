/* ===========================================================================
 *  De Edge Functions nakijken
 *
 *  Waarom dit bestaat
 *  ------------------
 *
 *  Alles onder src/ gaat langs "tsc --noEmit" bij elke bouw. De functies in
 *  supabase/functions/ niet: dat is Deno, met imports naar https-adressen en
 *  globals die TypeScript hier niet kent. Ze worden pas gecontroleerd op het
 *  moment dat ze worden uitgerold -- en dat is laat.
 *
 *  Hoe laat bleek in september 2026. Er stond een functie klaar die nog nooit
 *  gedraaid had, met drie fouten die alle drie meteen te zien waren geweest:
 *
 *    - een commentaarblok dat begon zonder openingsteken, zodat het bestand
 *      niet eens te lezen was
 *    - een aanroep van upsertLedger(), een functie die nergens bestond
 *    - upsertContacts(), twee keer gedefinieerd, waarbij de tweede de eerste
 *      overschreef -- facturen werden daardoor in het grootboek geschreven
 *
 *  Geen daarvan is een subtiele fout. Ze waren alleen door niets gezien.
 *
 *  Wat het wel en niet doet
 *  ------------------------
 *
 *  Het draait tsc over elke functie en houdt twee soorten klachten over:
 *  syntaxfouten (TS1xxx) en namen die nergens bestaan (TS2304, TS2552). Al
 *  het andere wordt weggelaten -- "Cannot find module 'https://...'" en
 *  "Cannot find name 'Deno'" horen erbij en zijn geen fout.
 *
 *  Dit is dus geen typecontrole. Het is de vraag "kan dit bestand überhaupt
 *  gelezen worden, en roept het alleen dingen aan die bestaan". Dat is
 *  precies de klasse fouten die anders pas bij het uitrollen opvalt.
 *
 *  Draaien:  npm run functietest
 * =========================================================================== */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const WORTEL = path.resolve(import.meta.dirname, '..')
const FUNCTIES = path.join(WORTEL, 'supabase', 'functions')

/** Namen die in Deno bestaan maar die deze tsc niet kent. Geen fout. */
const BEKEND_IN_DENO = new Set(['Deno', 'EdgeRuntime'])

function bestanden(map) {
  const uit = []
  for (const naam of readdirSync(map)) {
    const pad = path.join(map, naam)
    if (statSync(pad).isDirectory()) uit.push(...bestanden(pad))
    else if (naam.endsWith('.ts') && !naam.endsWith('.d.ts')) uit.push(pad)
  }
  return uit
}

const lijst = bestanden(FUNCTIES).sort()
if (lijst.length === 0) {
  console.error('Geen functies gevonden onder supabase/functions/')
  process.exit(1)
}

console.log(`\nDe Edge Functions nakijken — ${lijst.length} bestanden\n`)

/*
 * tsc rechtstreeks aanroepen, met de node die dit script draait.
 *
 * Hier stond execFileSync('npx', [...], { shell: true }). Dat werkte niet op
 * Windows -- npx werd niet gevonden -- en het ergste was hoe dat eruitzag:
 * geen uitvoer, dus geen klachten, dus "alles in orde". Een controle die bij
 * het mislukken groen wordt is erger dan geen controle, want nu vertrouw je
 * erop. Vandaar het pad naar tsc zelf, en de tegencontrole verderop.
 */
const TSC = path.join(WORTEL, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(TSC)) {
  console.error(`  tsc niet gevonden op ${TSC}. Draai eerst npm install.`)
  process.exit(1)
}

let rauw = ''
try {
  rauw = execFileSync(process.execPath, [
    TSC, '--noEmit', '--skipLibCheck', '--allowImportingTsExtensions',
    '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler',
    ...lijst,
  ], { cwd: WORTEL, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (e) {
  /* tsc geeft een foutcode zodra er ook maar iets is; de tekst staat op
     stdout. Dat is hier het normale geval, want de Deno-klachten blijven. */
  rauw = String(e.stdout ?? '') + String(e.stderr ?? '')
}

const regels = rauw.split(/\r?\n/).filter(Boolean)

/*
 * Heeft tsc werkelijk gekeken?
 *
 * Elke functie hier gebruikt Deno.env of importeert van een https-adres, en
 * daar klaagt deze tsc altijd over. Komt er HELEMAAL geen klacht uit, dan is
 * er iets misgegaan bij het starten en zegt "geen fouten" niets. Dan liever
 * hard stoppen dan onterecht groen worden.
 *
 * Let op de vorm: eerst stond hier dat er een Deno-klacht moest zijn. Dat
 * klopte niet -- bij een syntaxfout stopt tsc vóór hij aan die controles
 * toekomt, en dan zou uitgerekend het ergste geval als "controle stuk"
 * gemeld worden in plaats van als fout. Elke klacht is bewijs dat hij las.
 */
if (!regels.some((r) => /error TS\d+:/.test(r))) {
  console.error('  tsc leverde niets op wat erop wijst dat hij deze bestanden gelezen heeft.')
  console.error('  Dat betekent NIET dat ze in orde zijn -- de controle zelf is stuk.')
  if (rauw.trim()) console.error('  Uitvoer was:\n' + rauw.split(/\r?\n/).slice(0, 5).map((r) => '    ' + r).join('\n'))
  process.exit(1)
}

const erg = regels.filter((r) => {
  const m = r.match(/error TS(\d+): (.*)$/)
  if (!m) return false
  const code = Number(m[1])
  const tekst = m[2]

  /* Syntaxfouten: het bestand is niet te lezen. Altijd erg. */
  if (code >= 1000 && code < 2000) return true

  /* Een naam die nergens bestaat -- tenzij het iets van Deno is. */
  if (code === 2304 || code === 2552) {
    const naam = tekst.match(/Cannot find name '([^']+)'/)?.[1]
    return !naam || !BEKEND_IN_DENO.has(naam)
  }

  /* Twee keer dezelfde naam: de tweede overschrijft stilletjes de eerste. */
  if (code === 2393 || code === 2451) return true

  return false
})

for (const r of erg) console.log('  FOUT  ' + r.replace(WORTEL + path.sep, ''))

if (erg.length === 0) {
  console.log('  ok    geen syntaxfouten, geen onbekende namen, geen dubbele definities\n')
  process.exit(0)
}

console.log(`\n${erg.length} probleem(en) gevonden.\n`)
process.exit(1)
