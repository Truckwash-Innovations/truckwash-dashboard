/* ===========================================================================
 *  meet.mjs -- welk model leest onze facturen het best?
 *
 *  Casper kreeg het advies om Qwen3-VL 32B te proberen in plaats van
 *  gemma4:26b, en vroeg: "misschien gebruiken we nu een te grote model,
 *  waardoor het lang duurt".
 *
 *  Dat is een goede vraag en er is geen goed antwoord op te geven zonder te
 *  meten. Vandaar dit: geen mening over parameters, maar dezelfde facturen
 *  door meerdere modellen, met de klok erbij.
 *
 *  Gebruik
 *  -------
 *
 *    node meet.mjs --map ./proeffacturen
 *    node meet.mjs --map ./proeffacturen --modellen gemma4:26b,qwen3-vl:30b-a3b,qwen3-vl:32b
 *    node meet.mjs --map ./proeffacturen --rondes 3
 *
 *  Wat je terugkrijgt: per model de tijd per factuur, hoe vaak de eigen
 *  controle van lezer.mjs (controleer) er iets van vond, en per veld hoe vaak
 *  het model afweek van wat de andere modellen zeiden.
 *
 *  Twee manieren om te scoren, en het verschil is groot
 *  ----------------------------------------------------
 *
 *  ZONDER waarheid meet dit alleen EENSGEZINDHEID: wijkt een model af van de
 *  meerderheid, dan is dat een aanwijzing, geen bewijs. Drie modellen kunnen
 *  het samen mis hebben, en dan wint de fout.
 *
 *  Leg je naast de map een waarheid.json, dan wordt het echt gescoord:
 *
 *    { "hazeldonk-mei.pdf": { "totaalIncl": 1234.56, "leverancier": "Shell",
 *                             "richting": "inkoop", "datum": "2026-04-30" } }
 *
 *  Je hoeft niet alle velden te vullen -- wat erin staat wordt nagekeken, de
 *  rest overgeslagen. Tien facturen met de vier velden die ertoe doen zijn
 *  meer waard dan honderd zonder waarheid.
 *
 *  Waarom die vier velden zwaarder wegen
 *  -------------------------------------
 *
 *  Een verkeerd gelezen betalingskenmerk kost iemand een minuut. Een
 *  verkeerde RICHTING boekt een inkoopfactuur als verkoop, en een verkeerd
 *  TOTAAL gaat mee in een betaalbatch. Daarom worden die apart geteld en niet
 *  weggemiddeld in "84% van de velden goed".
 *
 *  Wat dit NIET doet
 *  -----------------
 *
 *  Het raakt de server niet aan en het haalt geen echte facturen op. Zet zelf
 *  een mapje neer met bonnen waarvan je het antwoord kent. Dit programma
 *  praat alleen met Ollama op deze pc.
 * =========================================================================== */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))

const argv = process.argv.slice(2)
const arg = (naam, terugval) => {
  const i = argv.indexOf(naam)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : terugval
}

const OLLAMA = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '')
const MAP = arg('--map', null)
const RONDES = Math.max(1, Number(arg('--rondes', '1')) || 1)

/*
 * De standaardlijst.
 *
 * gemma4:26b is wat er nu staat. De andere twee zijn er niet om er drie te
 * hebben maar omdat ze een echt verschil laten zien:
 *
 *   gemma4:26b        26B totaal, 4B actief (a4b) -- een MoE, dus snel voor
 *                     zijn omvang
 *   qwen3-vl:30b-a3b  30B totaal, 3B actief -- dezelfde soort, van een ander
 *                     huis. Dít is de eerlijke vergelijking met wat er staat.
 *   qwen3-vl:32b      32B DENSE. Even groot op papier, maar acht keer zoveel
 *                     rekenwerk per token. Verwacht hier de beste lezing en
 *                     de langste wachttijd -- en dat is precies wat gemeten
 *                     moet worden voordat je hem kiest.
 */
const MODELLEN = (arg('--modellen', 'gemma4:26b,qwen3-vl:30b-a3b,qwen3-vl:32b'))
  .split(',').map((m) => m.trim()).filter(Boolean)

/** De velden waar een fout geld of een verkeerde boeking kost. */
const ZWAAR = ['richting', 'totaalIncl', 'leverancier', 'datum']

/** En de rest, voor het volledige beeld. */
const LICHT = [
  'soort', 'factuurnummer', 'vervaldatum', 'iban', 'betalingskenmerk',
  'btwNummer', 'kvk', 'valuta', 'subtotaalExcl', 'btwBedrag', 'voorstelCategorie',
]

/* ------------------------------------------------------------------ *
 *  Het prompt en het schema
 *
 *  Uit prompt.json, hetzelfde bestand dat lezer.mjs gebruikt als hij zonder
 *  server draait. Een eigen prompt verzinnen zou de meting waardeloos maken:
 *  dan meet je twee dingen tegelijk.
 * ------------------------------------------------------------------ */

const { prompt: PROMPT, schema: SCHEMA } = JSON.parse(
  await readFile(path.join(HIER, 'prompt.json'), 'utf8'))

/* ------------------------------------------------------------------ *
 *  Een bestand klaarmaken
 *
 *  Bewust simpeler dan lezer.mjs: die haalt de tekstlaag uit een PDF en
 *  stuurt alleen bij een scan een plaatje. Hier gaat ALLES als plaatje, want
 *  dit gaat over beeldmodellen. Op een PDF met tekstlaag is de keuze tussen
 *  deze modellen namelijk nauwelijks interessant -- daar is al gemeten dat
 *  het drie seconden scheelt (zie de kop van lezer.mjs). Het verschil zit bij
 *  scans en foto's, en dat is wat hier wordt gemeten.
 * ------------------------------------------------------------------ */

const BEELD = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

async function alsPlaatjes(pad) {
  const ext = path.extname(pad).toLowerCase()
  const bytes = await readFile(pad)
  if (BEELD.has(ext)) return [bytes.toString('base64')]
  if (ext !== '.pdf') return null

  /* pdfjs zit al in de node_modules van lezer/, want lezer.mjs gebruikt hem. */
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise
  const uit = []
  for (let n = 1; n <= Math.min(doc.numPages, 3); n++) {
    const pagina = await doc.getPage(n)
    /* 200 dpi. Lager en de kleine lettertjes onderaan een factuur -- het
       betalingskenmerk, het btw-nummer -- worden onleesbaar; hoger en je
       stuurt vooral meer tokens. */
    const schaal = 200 / 72
    const vp = pagina.getViewport({ scale: schaal })
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await pagina.render({ canvasContext: ctx, viewport: vp }).promise
    uit.push(canvas.toBuffer('image/png').toString('base64'))
  }
  return uit
}

/* ------------------------------------------------------------------ *
 *  Ollama
 * ------------------------------------------------------------------ */

function leesJson(ruw) {
  const zonderHek = String(ruw ?? '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(zonderHek)
  } catch {
    const eerste = zonderHek.indexOf('{')
    const laatste = zonderHek.lastIndexOf('}')
    if (eerste < 0 || laatste <= eerste) return null
    try {
      return JSON.parse(zonderHek.slice(eerste, laatste + 1))
    } catch {
      return null
    }
  }
}

async function vraag(model, images) {
  const t0 = Date.now()
  const res = await fetch(OLLAMA + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: SCHEMA,
      /* temperature 0, net als in lezer.mjs: bij het lezen van een factuur is
         creativiteit een verkeerd antwoord. */
      options: { temperature: 0, num_ctx: 16384 },
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: 'Lees dit stuk en geef de JSON terug.', images },
      ],
    }),
  })
  const ms = Date.now() - t0
  if (!res.ok) return { fout: `${res.status} ${(await res.text()).slice(0, 200)}`, ms }
  const body = await res.json()
  return {
    uit: leesJson(body?.message?.content),
    ms,
    tokens: { in: body?.prompt_eval_count, uit: body?.eval_count },
  }
}

/* ------------------------------------------------------------------ *
 *  Vergelijken
 * ------------------------------------------------------------------ */

const getal = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(String(v ?? '').replace(/[^\d,.-]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Twee waarden voor hetzelfde veld: hetzelfde of niet?
 *
 * Bedragen op twee cent na, want een model dat 1234.56 leest en een dat
 * 1234.5600001 teruggeeft zijn het eens. Tekst genormaliseerd, want "Shell
 * Nederland B.V." en "shell nederland bv" zijn dezelfde leverancier en een
 * meting die dat als fout rekent meet vooral zichzelf.
 */
function gelijk(veld, a, b) {
  if (a == null || b == null) return a == null && b == null
  if (/totaal|subtotaal|btwBedrag/i.test(veld)) {
    const x = getal(a), y = getal(b)
    return x != null && y != null && Math.abs(x - y) <= 0.02
  }
  const kaal = (v) => String(v).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
  return kaal(a) === kaal(b)
}

/** Wat de meeste modellen zeiden. Alleen bruikbaar bij drie of meer. */
function meerderheid(waarden, veld) {
  const groepen = []
  for (const w of waarden) {
    const g = groepen.find((x) => gelijk(veld, x.waarde, w))
    if (g) g.aantal++
    else groepen.push({ waarde: w, aantal: 1 })
  }
  groepen.sort((a, b) => b.aantal - a.aantal)
  return groepen[0] && groepen[0].aantal > 1 ? groepen[0].waarde : undefined
}

/* ------------------------------------------------------------------ *
 *  De eigen controle van de lezer, zodat de cijfers vergelijkbaar zijn
 * ------------------------------------------------------------------ */

function controleer(uit) {
  if (!uit) return 'geen leesbare JSON'
  const redenen = []
  if (!String(uit.leverancier ?? '').trim()) redenen.push('geen leverancier')
  const totaal = getal(uit.totaalIncl)
  if (totaal == null || totaal === 0) redenen.push('geen totaal')
  const sub = getal(uit.subtotaalExcl)
  const btw = getal(uit.btwBedrag)
  if (sub != null && btw != null && totaal != null && Math.abs(sub + btw - totaal) > 0.02) {
    redenen.push('optelling klopt niet')
  }
  const twijfel = Array.isArray(uit.twijfel)
    ? uit.twijfel.filter((t) => String(t ?? '').trim()) : []
  if (twijfel.length) redenen.push('twijfelt: ' + twijfel.join(' | ').slice(0, 120))
  return redenen.length ? redenen.join('; ') : null
}

/* ------------------------------------------------------------------ *
 *  Draaien
 * ------------------------------------------------------------------ */

function hulp() {
  console.log(`
Welk model leest onze facturen het best?

  node meet.mjs --map <map met facturen> [--modellen a,b,c] [--rondes n]

Zet in die map een handvol echte bonnen -- graag scans en foto's, want daar
gaat het om. Ken je de juiste antwoorden, leg dan een waarheid.json ernaast:

  { "bestandsnaam.pdf": { "totaalIncl": 1234.56, "richting": "inkoop" } }

Zonder dat bestand meet dit alleen snelheid en of de modellen het eens zijn.
`)
}

if (!MAP) { hulp(); process.exit(1) }

const mapPad = path.resolve(MAP)
if (!existsSync(mapPad)) {
  console.error(`De map ${mapPad} bestaat niet.`)
  process.exit(1)
}

const bestanden = (await readdir(mapPad))
  .filter((f) => /\.(pdf|png|jpe?g|webp|gif)$/i.test(f))
  .sort()

if (!bestanden.length) {
  console.error(`Geen facturen in ${mapPad}.`)
  process.exit(1)
}

let waarheid = {}
const waarheidPad = path.join(mapPad, 'waarheid.json')
if (existsSync(waarheidPad)) {
  waarheid = JSON.parse(await readFile(waarheidPad, 'utf8'))
  console.log(`waarheid.json gevonden: ${Object.keys(waarheid).length} bestand(en) met bekende antwoorden`)
} else {
  console.log('Geen waarheid.json -- dit meet snelheid en eensgezindheid, geen juistheid.')
}

console.log(`${bestanden.length} bestand(en), ${MODELLEN.length} model(len), ${RONDES} ronde(s), via ${OLLAMA}\n`)

/* Eerst kijken of de modellen er zijn. Twintig minuten wachten om daarna te
   horen dat een naam niet bestaat is twintig minuten te veel. */
const aanwezig = await fetch(OLLAMA + '/api/tags')
  .then((r) => r.json()).then((j) => (j.models ?? []).map((m) => m.name))
  .catch(() => null)
if (!aanwezig) {
  console.error(`Ollama antwoordt niet op ${OLLAMA}. Draait hij?`)
  process.exit(1)
}
const ontbreekt = MODELLEN.filter((m) =>
  !aanwezig.some((a) => a === m || a === m + ':latest' || a.startsWith(m + ':')))
if (ontbreekt.length) {
  console.error('Deze modellen staan niet op deze pc:\n' +
    ontbreekt.map((m) => `  ollama pull ${m}`).join('\n'))
  process.exit(1)
}

const uitkomsten = []

for (const bestand of bestanden) {
  const pad = path.join(mapPad, bestand)
  const images = await alsPlaatjes(pad)
  if (!images || !images.length) {
    console.log(`${bestand}: niet om te zetten naar een plaatje, overgeslagen`)
    continue
  }
  console.log(`${bestand} (${images.length} pagina('s))`)

  for (const model of MODELLEN) {
    const tijden = []
    let laatste = null
    let fout = null
    for (let r = 0; r < RONDES; r++) {
      const a = await vraag(model, images)
      if (a.fout) { fout = a.fout; break }
      tijden.push(a.ms)
      laatste = a
    }
    if (fout) {
      console.log(`  ${model.padEnd(20)} FOUT ${fout}`)
      uitkomsten.push({ bestand, model, fout })
      continue
    }
    /* De mediaan en niet het gemiddelde: de eerste ronde is bijna altijd
       traag omdat Ollama het model nog moet laden, en dat zegt niets over
       hoe snel hij is als hij warm is. */
    const gesorteerd = [...tijden].sort((a, b) => a - b)
    const mediaan = gesorteerd[Math.floor(gesorteerd.length / 2)]
    const opmerking = controleer(laatste.uit)
    console.log(`  ${model.padEnd(20)} ${(mediaan / 1000).toFixed(1)}s` +
      (RONDES > 1 ? ` (eerste ${(tijden[0] / 1000).toFixed(1)}s)` : '') +
      `  ${laatste.tokens?.uit ?? '?'} tokens uit` +
      (opmerking ? `  -- ${opmerking}` : '  -- controle in orde'))
    uitkomsten.push({ bestand, model, ms: mediaan, eerste: tijden[0], uit: laatste.uit, opmerking })
  }
  console.log()
}

/* ------------------------------------------------------------------ *
 *  De uitslag
 * ------------------------------------------------------------------ */

console.log('='.repeat(72))
console.log('UITSLAG\n')

for (const model of MODELLEN) {
  const mijne = uitkomsten.filter((u) => u.model === model && !u.fout)
  if (!mijne.length) { console.log(`${model}: geen enkele gelukt`); continue }

  const mediaan = [...mijne.map((u) => u.ms)].sort((a, b) => a - b)[Math.floor(mijne.length / 2)]
  const inOrde = mijne.filter((u) => !u.opmerking).length

  /* Zwaar en licht apart, want een verkeerde richting is niet hetzelfde als
     een verkeerd betalingskenmerk. */
  let zwaarGoed = 0, zwaarGeteld = 0, lichtGoed = 0, lichtGeteld = 0
  const missers = []

  for (const u of mijne) {
    const w = waarheid[u.bestand] || {}
    const anderen = uitkomsten
      .filter((x) => x.bestand === u.bestand && x.model !== model && !x.fout)
      .map((x) => x.uit)

    for (const [velden, gewicht] of [[ZWAAR, 'zwaar'], [LICHT, 'licht']]) {
      for (const veld of velden) {
        /* De waarheid gaat voor; staat die er niet, dan de meerderheid van de
           andere modellen. Is er geen van beide, dan valt dit veld buiten de
           telling -- meten zonder maatstaf is geen meten. */
        const maat = Object.prototype.hasOwnProperty.call(w, veld)
          ? w[veld]
          : meerderheid([u.uit?.[veld], ...anderen.map((a) => a?.[veld])], veld)
        if (maat === undefined) continue
        const goed = gelijk(veld, u.uit?.[veld], maat)
        if (gewicht === 'zwaar') { zwaarGeteld++; if (goed) zwaarGoed++ }
        else { lichtGeteld++; if (goed) lichtGoed++ }
        if (!goed && gewicht === 'zwaar') {
          missers.push(`${u.bestand} ${veld}: "${u.uit?.[veld]}" ipv "${maat}"`)
        }
      }
    }
  }

  const pct = (a, b) => b ? `${Math.round((a / b) * 100)}%` : 'n.v.t.'
  console.log(`${model}`)
  console.log(`  tijd (mediaan)      ${(mediaan / 1000).toFixed(1)}s per factuur`)
  console.log(`  eigen controle ok   ${inOrde} van ${mijne.length}`)
  console.log(`  zware velden goed   ${pct(zwaarGoed, zwaarGeteld)} (${zwaarGoed}/${zwaarGeteld}) -- ${ZWAAR.join(', ')}`)
  console.log(`  overige velden goed ${pct(lichtGoed, lichtGeteld)} (${lichtGoed}/${lichtGeteld})`)
  if (missers.length) {
    console.log('  missers op de zware velden:')
    for (const m of missers.slice(0, 8)) console.log('    ' + m)
    if (missers.length > 8) console.log(`    en nog ${missers.length - 8}`)
  }
  console.log()
}

if (!Object.keys(waarheid).length) {
  console.log('Let op: zonder waarheid.json is "goed" hierboven alleen "hetzelfde als de\n' +
    'meerderheid". Drie modellen kunnen het samen mis hebben. Vul voor de\n' +
    'facturen die je kent de vier zware velden in en draai het nog eens.\n')
}

const uitPad = path.join(mapPad, 'meting.json')
await writeFile(uitPad, JSON.stringify({ op: new Date().toISOString(), MODELLEN, uitkomsten }, null, 1))
console.log(`Alles staat ook in ${uitPad}.`)
