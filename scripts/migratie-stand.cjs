/**
 * Elke migratie schrijft zichzelf in, in de uitdraai
 *
 * Waarom hier en niet in de migratie zelf
 * ---------------------------------------
 *
 * Omdat er honderd migratiebestanden zijn en ze allemaal al gedraaid zijn.
 * Er achteraf een regel in plakken zou betekenen dat setup.sql en
 * bijwerken.sql veranderen voor bestanden waar verder niets aan is gewijzigd
 * -- en dat maakt een wijziging onleesbaar.
 *
 * De uitdraai is de plek waar het hoort: daar is de volgorde bekend, daar
 * staat het nummer al in de bestandsnaam, en het is precies dat bestand dat
 * in de SQL-editor wordt geplakt.
 *
 * Waarom het blokje eerst kijkt of de functie bestaat
 * --------------------------------------------------
 *
 * public.migratie_gedaan() wordt gemaakt in 0103. In setup.sql staan 102
 * migraties vóór dat moment, en die zouden anders stuklopen op een functie
 * die nog niet bestaat. Dus is het blokje een lege handeling zolang de
 * functie er niet is, en gaat het vanaf 0103 vanzelf meedoen.
 *
 * to_regprocedure en niet to_regproc: die eerste neemt de hele handtekening
 * en geeft netjes null terug bij een onbekende functie. to_regproc geeft ook
 * null bij een naam die meer dan een keer bestaat, en dat heeft hier eerder
 * een migratie laten denken dat pg_cron niet aan stond terwijl dat wel zo was
 * (zie 0102).
 */

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

/** De eerste zin uit de kop van een migratie, om in de stand te zetten. */
function korteNaam(dir, bestand) {
  const tekst = readFileSync(join(dir, bestand), 'utf8')
  const regel = tekst.split('\n').find((r) => /^--\s{2}\S/.test(r) && !/^--\s*=+/.test(r))
  return (regel ?? '').replace(/^--\s+/, '').trim()
}

/** SQL-tekst tussen aanhalingstekens, met de aanhalingstekens erin verdubbeld. */
function sqlTekst(s) {
  return "'" + String(s).replace(/'/g, "''") + "'"
}

/**
 * Het blokje dat achter een migratie komt.
 *
 * @param {string} bestand  bijvoorbeeld "0103_de_server_zegt....sql"
 * @param {string} naam     de korte naam uit de kop
 */
function standBlok(bestand, naam) {
  const nummer = Number(bestand.slice(0, 4))
  return [
    '-- --- ingeschreven door scripts/migratie-stand.cjs ---',
    'do $stand$ begin',
    "  if to_regprocedure('public.migratie_gedaan(integer,text)') is not null then",
    `    perform public.migratie_gedaan(${nummer}, ${sqlTekst(naam)});`,
    '  end if;',
    'end $stand$;',
  ].join('\n')
}

/** De tekst van een migratie met het inschrijfblokje eronder. */
function metStand(dir, bestand) {
  const tekst = readFileSync(join(dir, bestand), 'utf8').trimEnd()
  return tekst + '\n\n' + standBlok(bestand, korteNaam(dir, bestand))
}

module.exports = { korteNaam, standBlok, metStand }
