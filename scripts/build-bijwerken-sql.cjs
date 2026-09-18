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
 *
 * Een kleiner bestand, met alleen wat er nog moet
 * -----------------------------------------------
 *
 * De SQL-editor van Supabase weigert alles boven ongeveer een megabyte, en
 * daar zit dit bestand inmiddels tegenaan. Dat is ook onnodig: wie bij 0113
 * staat, hoeft de honderd ervoor niet opnieuw te draaien.
 *
 *   node scripts/build-bijwerken-sql.cjs 114
 *
 * geeft supabase/bijwerken-vanaf-0114.sql, met alleen 0114 en verder. Waar je
 * staat vraag je aan de database zelf:
 *
 *   select max(nummer) from public.schema_stand;
 */

const { readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { korteNaam, metStand } = require('./migratie-stand.cjs')

const root = join(__dirname, '..')
const dir = join(root, 'supabase', 'migrations')

/** Vanaf hier. Alles ervoor stond er al toen dit bestand ontstond. */
const STANDAARD = 17

const gevraagd = Number(process.argv[2])
if (process.argv[2] && !Number.isInteger(gevraagd)) {
  console.error('Geef een migratienummer mee, bijvoorbeeld: node scripts/build-bijwerken-sql.cjs 114')
  process.exit(1)
}
const VANAF = gevraagd || STANDAARD

const bestanden = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => Number(f.slice(0, 4)) >= VANAF)
  .sort()

if (bestanden.length === 0) {
  console.error(`Geen migraties vanaf ${VANAF}. De hoogste die er is staat lager.`)
  process.exit(1)
}

const eerste = bestanden[0].slice(0, 4)
const laatste = bestanden[bestanden.length - 1].slice(0, 4)

/* Het volledige bestand houdt zijn naam; een deel krijgt er een die zegt wat
   erin zit. Anders overschrijft "even alleen de laatste drie" het geheel, en
   dan mist iemand die opnieuw begint de helft zonder het te merken. */
const deel = VANAF !== STANDAARD
const naam = deel ? `bijwerken-vanaf-${eerste}.sql` : 'bijwerken.sql'

const inhoudsopgave = bestanden
  .map((f) => `--    ${f.slice(0, 4)}  ${korteNaam(dir, f)}`)
  .join('\n')

const KOP = `-- ===========================================================================
--  Bijwerken: migratie ${eerste} tot en met ${laatste}
--
--  Plak dit in de SQL-editor van Supabase en druk op Run. Opnieuw draaien mag.
--
${deel
  ? `--  Dit is een DEEL: alleen ${eerste} en verder. Bedoeld voor een database die
--  al tot en met ${String(VANAF - 1).padStart(4, '0')} bij is -- vraag dat na met:
--
--      select max(nummer) from public.schema_stand;
--
--  Twijfel je, neem dan supabase/setup.sql; dat is het geheel en dat mag ook
--  opnieuw.`
  : `--  Twijfel je of je een eerdere migratie hebt gedraaid, neem dan
--  supabase/setup.sql -- dat is het geheel, en dat mag ook opnieuw.`}
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

/* metStand plakt achter elke migratie het blokje dat hem inschrijft in
   public.schema_stand; zie scripts/migratie-stand.cjs. */
const inhoud = KOP + bestanden
  .map((f) => metStand(dir, f))
  .join('\n\n')
  + '\n'

writeFileSync(join(root, 'supabase', naam), inhoud, 'utf8')

const kb = Math.round(Buffer.byteLength(inhoud, 'utf8') / 1024)
console.log(`${naam} opgebouwd uit ${bestanden.length} migraties (${eerste} t/m ${laatste}), ${kb} kB`)
