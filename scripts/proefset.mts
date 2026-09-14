/* ===========================================================================
 *  proefset.mts -- de zeven proeffacturen als map, met het juiste antwoord
 *
 *  Casper: "Hij faalt best vaak om een factuur goed te lezen."
 *
 *  Daar is geen zinnig antwoord op te geven zonder te meten, en meten kan
 *  alleen als je vooraf weet wat eruit hoort te komen. Dat weten we hier
 *  toevallig precies: de zeven proeffacturen uit src/lib/testfacturen.ts
 *  worden door onszelf gemaakt, dus elk bedrag, elk nummer en elke datum
 *  staat vast.
 *
 *  Dit script zet ze als PDF in een map en legt er de waarheid.json naast die
 *  lezer/meet.mjs verwacht. Daarna:
 *
 *      cd lezer
 *      node meet.mjs --map ../proeffacturen
 *      node meet.mjs --map ../proeffacturen --modellen gemma4:26b,qwen3.6:35b-a3b
 *
 *  Wat dat je vertelt, en dat is de hele bedoeling
 *  ----------------------------------------------
 *
 *  Deze zeven zijn MAKKELIJK: nette PDF's met een schone tekstlaag, in
 *  leesvolgorde. Gaat het model hierop al de mist in, dan ligt het niet aan
 *  de scankwaliteit en niet aan de bijlage -- dan leest het model onze
 *  facturen gewoon niet goed genoeg, en is een ander model of een ander
 *  prompt het antwoord.
 *
 *  Gaan ze allemaal goed, dan weet je dat net zo hard het andere: dan zit het
 *  in wat er binnenkomt (scans, foto's, meer dan drie pagina's) en heeft een
 *  groter model geen zin.
 *
 *  Dat onderscheid is niet uit de uitkomst van een echte factuur af te leiden,
 *  want daar weet niemand het juiste antwoord van zonder het na te tellen.
 * =========================================================================== */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TESTFACTUREN, testfactuurPdf, type Testfactuur } from '../src/lib/testfacturen'

const MAP = process.argv[2] ?? 'proeffacturen'

/** "1.494,35" -> 1494.35. Leeg blijft leeg: dat is "onbekend" en geen nul. */
function bedrag(ruw: string): number | undefined {
  const schoon = ruw.replace(/\./g, '').replace(',', '.').trim()
  if (!schoon) return undefined
  const n = Number(schoon)
  return Number.isFinite(n) ? n : undefined
}

const MAANDEN = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
]

/** "3 september 2026" -> "2026-09-03". Zo wil het schema van de lezer het. */
function datum(ruw: string): string | undefined {
  const m = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i.exec(ruw.trim())
  if (!m) return undefined
  const maand = MAANDEN.indexOf(m[2].toLowerCase())
  if (maand < 0) return undefined
  return `${m[3]}-${String(maand + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

/**
 * Wat er uit deze factuur hoort te komen.
 *
 * Alleen velden waarvan we het antwoord ECHT weten. Een veld dat we niet
 * invullen wordt door meet.mjs overgeslagen -- en dat is beter dan een
 * gegokte waarheid, want daarmee zou een model worden afgerekend op iets wat
 * wij zelf niet zeker wisten.
 */
function waarheidVan(f: Testfactuur): Record<string, unknown> {
  const uit: Record<string, unknown> = {
    /*
     * De richting. Zes van de zeven zijn facturen AAN ons; de eigen
     * verkoopfactuur is er een VAN ons, en juist die moet het model als
     * verkoop herkennen -- anders wordt onze eigen omzet een kostenpost.
     */
    richting: f.sleutel === 'eigen-verkoop' ? 'verkoop' : 'inkoop',
  }

  if (f.leverancier) uit.leverancier = f.leverancier
  const totaal = bedrag(f.totaal)
  if (totaal !== undefined) uit.totaalIncl = totaal
  const dat = datum(f.datum)
  if (dat) uit.datum = dat
  if (f.nummer) uit.factuurnummer = f.nummer
  const excl = bedrag(f.excl)
  if (excl !== undefined) uit.subtotaalExcl = excl
  const btw = bedrag(f.btw)
  if (btw !== undefined) uit.btwBedrag = btw
  if (f.iban) uit.iban = f.iban
  if (f.kvk) uit.kvk = f.kvk
  if (f.btwNummer) uit.btwNummer = f.btwNummer

  return uit
}

mkdirSync(MAP, { recursive: true })

const waarheid: Record<string, unknown> = {}
for (const f of TESTFACTUREN) {
  const naam = `${f.sleutel}.pdf`
  writeFileSync(join(MAP, naam), Buffer.from(testfactuurPdf(f)))

  /*
   * De onleesbare krijgt geen waarheid mee.
   *
   * Op dat vel staat met opzet geen bedrag en geen nummer, en het goede
   * antwoord is "ik weet het niet". Dat is niet te scoren als een veld: een
   * model dat netjes niets invult zou dan evenveel punten krijgen als een
   * model dat iets verzint. Hij blijft wel in de map -- kijk met de hand wat
   * eruit kwam, want een verzonnen leverancier is precies de fout waar dit
   * tegen beschermt.
   */
  if (f.sleutel !== 'onleesbaar') waarheid[naam] = waarheidVan(f)
}

writeFileSync(join(MAP, 'waarheid.json'), JSON.stringify(waarheid, null, 2) + '\n')

console.log(`${TESTFACTUREN.length} proeffacturen in ${MAP}/`)
console.log(`waarheid.json: ${Object.keys(waarheid).length} met een bekend antwoord`)
console.log('\nMeten:\n  cd lezer\n  node meet.mjs --map ../' + MAP + '\n')
