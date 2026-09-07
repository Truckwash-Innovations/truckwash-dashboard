/**
 * Plakt de migraties vanaf 0017 achter elkaar tot één bestand:
 * supabase/bijwerken.sql
 *
 * Waarom dit script er is
 * -----------------------
 *
 * Omdat de handmatige versie is gaan afwijken. Elke nieuwe migratie werd
 * hieraan toegevoegd door de tekst van dat moment eronder te plakken -- en
 * elke keer dat een oudere migratie daarna nog werd gerepareerd, bleef de
 * kopie hier de oude staan.
 *
 * Dat viel niet op, want setup.sql wordt wél gegenereerd en getest en die
 * bleef dus schoon. Tot Casper bijwerken.sql draaide en er twee fouten uit
 * kwamen die in de migraties allang waren opgelost:
 *
 *   "public.exact_crediteur bestaat niet"
 *   "cannot change return type of existing function"
 *
 * Eén bron, en dat zijn de migraties. Dit bestand is een uitdraai.
 *
 * Waarom vanaf 0017
 * -----------------
 *
 * 0001 tot en met 0016 stonden er al toen dit bestand werd bedacht; het is
 * bedoeld voor een database die al draait. Wie helemaal opnieuw begint neemt
 * setup.sql -- dat is het geheel.
 *
 *   node scripts/build-bijwerken-sql.cjs
 */

const { readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const dir = join(root, 'supabase', 'migrations')

/** Vanaf hier. Alles ervoor stond er al toen dit bestand ontstond. */
const VANAF = 17

const bestanden = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => Number(f.slice(0, 4)) >= VANAF)
  .sort()

/** De eerste zin uit de kop van een migratie, om in de inhoudsopgave te zetten. */
function korteNaam(bestand) {
  const tekst = readFileSync(join(dir, bestand), 'utf8')
  const regel = tekst.split('\n').find((r) => /^--\s{2}\S/.test(r) && !/^--\s*=+/.test(r))
  return (regel ?? '').replace(/^--\s+/, '').trim()
}

const eerste = bestanden[0].slice(0, 4)
const laatste = bestanden[bestanden.length - 1].slice(0, 4)

const inhoudsopgave = bestanden
  .map((f) => `--    ${f.slice(0, 4)}  ${korteNaam(f)}`)
  .join('\n')

const KOP = `-- ===========================================================================
--  Bijwerken: migratie ${eerste} tot en met ${laatste}
--
--  Plak dit in de SQL-editor van Supabase en druk op Run. Opnieuw draaien mag.
--
--  Twijfel je of je een eerdere migratie hebt gedraaid, neem dan
--  supabase/setup.sql -- dat is het geheel, en dat mag ook opnieuw.
--
--  Dit bestand wordt gemaakt door scripts/build-bijwerken-sql.cjs. Wijzig de
--  migraties in supabase/migrations, niet dit bestand: de handgeschreven
--  versie liep uit de pas met de migraties, en dat kwam er pas uit toen het
--  in de echte database misging.
--
--  Wat erin zit:
${inhoudsopgave}
-- ===========================================================================

`

const inhoud = KOP + bestanden
  .map((f) => readFileSync(join(dir, f), 'utf8').trimEnd())
  .join('\n\n')
  + '\n'

writeFileSync(join(root, 'supabase', 'bijwerken.sql'), inhoud, 'utf8')

console.log(`bijwerken.sql opgebouwd uit ${bestanden.length} migraties (${eerste} t/m ${laatste})`)
