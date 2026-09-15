/* ------------------------------------------------------------------ *
 *  Testfacturen
 *
 *  Casper: "daarna wil ik een aantal test facturen sturen, kan je die
 *  eventueel voor me maken? en dat ik via ontwikkelaar deze test facturen kan
 *  'versturen' zodat het systeem ze gaan bekijken ect ect"
 *
 *  Wat dit is, en wat het niet is
 *  ------------------------------
 *
 *  Geen verzameling mooie facturen. Elke factuur hieronder zet één beslissing
 *  van het systeem op scherp, en bij elke staat wat er hoort te gebeuren. Een
 *  proef waarvan je vooraf niet hebt opgeschreven wat je verwacht, is geen
 *  proef maar een demonstratie: je kijkt naar het scherm en vindt het er goed
 *  uitzien.
 *
 *  Ze gaan door de ECHTE weg naar binnen -- de webhook ontvang-mail, met een
 *  ontwikkelaar als bewijs in plaats van de handtekening van Resend. Alles
 *  daarna is precies wat er met post van een leverancier gebeurt: de
 *  bijlagecontrole, de vestiging uit het adres, het lezen, de
 *  verkoopcontrole, het indelen, het eventueel automatisch goedkeuren.
 *
 *  Waarom de PDF hier wordt gemaakt en niet als bestand meegeleverd
 *  ---------------------------------------------------------------
 *
 *  Een map met zeven PDF's in de repo is een map die na de eerste wijziging
 *  aan de lezer niet meer past bij waar hij op wordt getest. Hier staat de
 *  INHOUD, en het papier wordt er elke keer vers van gemaakt -- met dezelfde
 *  schrijver die ook een gewoon document maakt (pdfmaken.ts).
 *
 *  De nummers moeten de proef doorstaan
 *  ------------------------------------
 *
 *  Casper: "maar het zijn je eigen test facturen? fix dat dan."
 *
 *  Hij liep vast bij het betalen: er kon geen bestand gemaakt worden omdat de
 *  factuur van Gemeente Venlo NL55BNGH0285000122 droeg, en dat nummer
 *  doorstaat de elfproef niet. Dat was geen misgelezen cijfer maar een cijfer
 *  dat ik hier heb verzonnen -- en hetzelfde gold voor twee andere IBAN's en
 *  een btw-nummer.
 *
 *  Verzonnen gegevens horen hier; verzonnen gegevens die de controles niet
 *  doorstaan niet. Dan test je de foutmelding in plaats van de keten, en jaag
 *  je een middag op iets wat je zelf hebt neergezet.
 *
 *  Zelftest 89 rekent elk nummer in dit bestand na. Wie er een toevoegt komt
 *  daar meteen achter, en niet pas als de bank een bestand weigert.
 * ------------------------------------------------------------------ */

import { maakPdf } from './pdfmaken'
import { supabase, supabaseUrl } from './api/supabaseApi'
import type { DocBlok } from './types'

export interface Testfactuur {
  sleutel: string
  /** Wat er op het papier komt te staan. */
  naam: string
  /** Welke beslissing dit op scherp zet. */
  test: string
  /** Wat er hoort te gebeuren. Dit lees je naast de uitkomst. */
  verwacht: string
  leverancier: string
  adres: string[]
  /** Aan wie de factuur gericht is -- hier wordt de bv uit afgeleid (0079). */
  aan: string[]
  nummer: string
  datum: string
  vervaldatum: string
  regels: { wat: string; bedrag: string }[]
  excl: string
  btwPct: number
  btw: string
  totaal: string
  iban?: string
  kvk?: string
  btwNummer?: string
  /** Extra regels onderaan, bijvoorbeeld een betalingsvoorwaarde. */
  slot?: string[]
}

/* ------------------------------------------------------------------ *
 *  De gevallen
 *
 *  In volgorde van oplopende gemeenheid. De eerste hoort zonder hulp door te
 *  lopen; de laatste hoort te blijven staan met een duidelijke twijfel erbij.
 * ------------------------------------------------------------------ */

export const TESTFACTUREN: Testfactuur[] = [
  {
    sleutel: 'gewoon',
    naam: 'Gewone factuur, alles erop',
    test: 'De rechte weg: lezen, indelen, klaarzetten.',
    verwacht: 'Wordt een kostenpost met leverancier, bedrag, btw en '
      + 'factuurnummer ingevuld. De rekening komt uit het geheugen of wordt '
      + 'geraden op trefwoord (dan staat er "geraden" bij).',
    leverancier: 'Wairtec Chemie B.V.',
    adres: ['Industrieweg 45', '5928 PA Venlo', 'KvK 17098345'],
    aan: ['Truckwash 1 Venlo B.V.', 'Columbusweg 47', '5928 LA Venlo'],
    nummer: 'WT-2026-04412',
    datum: '3 september 2026',
    vervaldatum: '3 oktober 2026',
    regels: [
      { wat: '20 x Ontvetter concentraat 20L', bedrag: '840,00' },
      { wat: '10 x Shampoo actief 20L', bedrag: '395,00' },
    ],
    excl: '1.235,00',
    btwPct: 21,
    btw: '259,35',
    totaal: '1.494,35',
    iban: 'NL91 ABNA 0417 1643 00',
    kvk: '17098345',
    btwNummer: 'NL810234567B01',
    slot: ['Betaling binnen 30 dagen.'],
  },
  {
    sleutel: 'geen-nummer',
    naam: 'Zonder factuurnummer',
    test: 'Wat de lezer niet vindt, moet hij niet verzinnen.',
    verwacht: 'Komt binnen zonder factuurnummer, met een twijfel erbij. '
      + 'Gaat NOOIT automatisch door -- de dubbelcontrole kan zonder nummer '
      + 'niet werken.',
    leverancier: 'Van Dijk Techniek',
    adres: ['Ambachtsweg 12', '3542 CV Utrecht'],
    aan: ['Truckwash 1 Utrecht B.V.', 'Reactorweg 27', '3542 AD Utrecht'],
    nummer: '',
    datum: '5 september 2026',
    vervaldatum: '19 september 2026',
    regels: [{ wat: 'Storing hogedrukpomp, 3 uur', bedrag: '285,00' }],
    excl: '285,00',
    btwPct: 21,
    btw: '59,85',
    totaal: '344,85',
    iban: 'NL07 RABO 0132 4578 91',
  },
  {
    sleutel: 'laag-tarief',
    naam: 'Laag btw-tarief (9%)',
    test: 'Het percentage van het papier, niet het gebruikelijke.',
    verwacht: 'Btw 9% en niet 21%. Dat is de btw-code die bij het boeken '
      + 'wordt gekozen; staat exact_btw_9 leeg, dan hoort de proefrit daar '
      + 'over te klagen.',
    leverancier: 'Vitens N.V.',
    adres: ['Oude Veerweg 1', '8019 BE Zwolle', 'KvK 05083588'],
    aan: ['Truckwash 1 Holten B.V.', 'Handelsweg 34', '7451 PJ Holten'],
    nummer: '2026-8841003',
    datum: '1 september 2026',
    vervaldatum: '15 september 2026',
    regels: [{ wat: 'Waterverbruik augustus, 340 m3', bedrag: '612,00' }],
    excl: '612,00',
    btwPct: 9,
    btw: '55,08',
    totaal: '667,08',
    iban: 'NL32 INGB 0000 0001 23',
    kvk: '05083588',
  },
  {
    sleutel: 'andere-bv',
    naam: 'Gericht aan een andere bv',
    test: 'De onderneming komt van het stuk en niet van de vestiging (0079).',
    verwacht: 'Komt binnen op het adres van een WASSTRAAT, maar is gericht '
      + 'aan Vastgoed. De bv hoort Vastgoed te worden, met bron "gelezen" of '
      + '"vermoeden" -- niet de bv van de vestiging.',
    leverancier: 'Gemeente Venlo',
    adres: ['Hanzeplaats 1', '5912 AT Venlo'],
    aan: ['Truckwash 1 Vastgoed B.V.', 'Columbusweg 47', '5928 LA Venlo'],
    nummer: 'AANSL-2026-77120',
    datum: '2 september 2026',
    vervaldatum: '2 november 2026',
    regels: [{ wat: 'OZB niet-woningen 2026, Columbusweg 47', bedrag: '3.240,00' }],
    excl: '3.240,00',
    btwPct: 0,
    btw: '0,00',
    totaal: '3.240,00',
    iban: 'NL65 BNGH 0285 0001 22',
  },
  {
    sleutel: 'eigen-verkoop',
    naam: 'Onze eigen verkoopfactuur, doorgestuurd',
    test: 'Een factuur van Truckwash zelf is geen kostenpost (0047).',
    verwacht: 'De lezer ziet Truckwash bovenaan staan. Staan eigen_kvk, '
      + 'eigen_btw of eigen_iban ingevuld, dan wordt de kostenpost weer '
      + 'weggehaald en komt er "verkoop" op het bericht. Staan die leeg, dan '
      + 'blijft hij staan met twijfel -- dat is met opzet.',
    leverancier: 'Truckwash 1 Group B.V.',
    adres: ['Columbusweg 47', '5928 LA Venlo', 'KvK 63451209'],
    aan: ['Chemtrans Logistiek B.V.', 'Havenweg 8', '3199 LB Rotterdam'],
    nummer: '2026-0412',
    datum: '31 augustus 2026',
    vervaldatum: '30 september 2026',
    regels: [
      { wat: '18 x Buitenwas trekker + oplegger', bedrag: '1.170,00' },
      { wat: '4 x Cabine binnen', bedrag: '180,00' },
    ],
    excl: '1.350,00',
    btwPct: 21,
    btw: '283,50',
    totaal: '1.633,50',
    iban: 'NL24 INGB 0106 7276 21',
    kvk: '63451209',
    btwNummer: 'NL855142091B01',
  },
  {
    sleutel: 'dubbel',
    naam: 'Dezelfde factuur nog een keer',
    test: 'Dezelfde leverancier, hetzelfde factuurnummer.',
    verwacht: 'Stuur deze ná "Gewone factuur". Hij hoort NIET automatisch '
      + 'goedgekeurd te worden, ook niet als automatisch goedkeuren aanstaat '
      + '-- een nummer dat al bij deze leverancier staat is een herinnering '
      + 'of een dubbele (0050).',
    leverancier: 'Wairtec Chemie B.V.',
    adres: ['Industrieweg 45', '5928 PA Venlo', 'KvK 17098345'],
    aan: ['Truckwash 1 Venlo B.V.', 'Columbusweg 47', '5928 LA Venlo'],
    nummer: 'WT-2026-04412',
    datum: '3 september 2026',
    vervaldatum: '3 oktober 2026',
    regels: [
      { wat: '20 x Ontvetter concentraat 20L', bedrag: '840,00' },
      { wat: '10 x Shampoo actief 20L', bedrag: '395,00' },
    ],
    excl: '1.235,00',
    btwPct: 21,
    btw: '259,35',
    totaal: '1.494,35',
    iban: 'NL91 ABNA 0417 1643 00',
    kvk: '17098345',
    slot: ['HERINNERING — deze factuur staat nog open.'],
  },
  {
    sleutel: 'onleesbaar',
    naam: 'Nauwelijks iets op het papier',
    test: 'Wat de lezer niet weet, hoort hij te zeggen.',
    verwacht: 'Er staat geen bedrag en geen nummer op. De lezer hoort dit '
      + 'als twijfel terug te geven en niets in te vullen. Een kostenpost '
      + 'van 0,00 met een verzonnen leverancier is de fout waar dit tegen '
      + 'beschermt.',
    leverancier: '',
    adres: [],
    aan: [],
    nummer: '',
    datum: '',
    vervaldatum: '',
    regels: [],
    excl: '',
    btwPct: 21,
    btw: '',
    totaal: '',
    slot: ['Bijgaand de stukken zoals besproken.'],
  },
]

/* ------------------------------------------------------------------ *
 *  Het papier
 * ------------------------------------------------------------------ */

let teller = 0
const blok = (soort: DocBlok['soort'], tekst: string): DocBlok =>
  ({ id: `tf${++teller}`, soort, tekst })

/** De factuur als PDF, met dezelfde schrijver als een gewoon document. */
export function testfactuurPdf(f: Testfactuur): Uint8Array {
  const blokken: DocBlok[] = []

  for (const r of f.adres) blokken.push(blok('alinea', r))
  if (f.adres.length) blokken.push(blok('wit', ''))

  if (f.aan.length) {
    blokken.push(blok('kop2', 'Factuuradres'))
    for (const r of f.aan) blokken.push(blok('alinea', r))
    blokken.push(blok('wit', ''))
  }

  blokken.push(blok('streep', ''))
  if (f.nummer) blokken.push(blok('alinea', `Factuurnummer: ${f.nummer}`))
  if (f.datum) blokken.push(blok('alinea', `Factuurdatum: ${f.datum}`))
  if (f.vervaldatum) blokken.push(blok('alinea', `Vervaldatum: ${f.vervaldatum}`))
  blokken.push(blok('streep', ''))

  for (const r of f.regels) {
    blokken.push(blok('punt', `${r.wat}   EUR ${r.bedrag}`))
  }

  if (f.excl) {
    blokken.push(blok('wit', ''))
    blokken.push(blok('alinea', `Subtotaal excl. btw   EUR ${f.excl}`))
    blokken.push(blok('alinea', `Btw ${f.btwPct}%   EUR ${f.btw}`))
    blokken.push(blok('kop2', `Totaal te betalen   EUR ${f.totaal}`))
  }

  if (f.iban || f.kvk || f.btwNummer) {
    blokken.push(blok('wit', ''))
    if (f.iban) blokken.push(blok('alinea', `IBAN: ${f.iban}`))
    if (f.kvk) blokken.push(blok('alinea', `KvK: ${f.kvk}`))
    if (f.btwNummer) blokken.push(blok('alinea', `Btw-nummer: ${f.btwNummer}`))
  }

  for (const r of f.slot ?? []) {
    blokken.push(blok('wit', ''))
    blokken.push(blok('alinea', r))
  }

  return maakPdf({
    titel: f.leverancier || 'Factuur',
    blokken,
    /* Met zoveel woorden op het papier. Belandt er ooit een in een echte
       stapel, dan is het meteen te zien -- ook door iemand die deze knop
       niet kent. */
    voet: 'PROEFFACTUUR — gemaakt door het dashboard om de verwerking te testen',
  })
}

/* ------------------------------------------------------------------ *
 *  Versturen
 * ------------------------------------------------------------------ */

function base64Van(bytes: Uint8Array): string {
  let ruw = ''
  /* In stukjes: String.fromCharCode met honderdduizend argumenten tegelijk
     loopt op een stapeloverloop. */
  for (let i = 0; i < bytes.length; i += 8192) {
    ruw += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(ruw)
}

/**
 * De proeffactuur door de echte webhook heen sturen.
 *
 * Het adres waarop hij binnenkomt bepaalt de vestiging (inkoop.venlo@...), en
 * daarmee de bv waarin hij zou boeken. Dat is precies wat er bij een echte
 * factuur ook gebeurt, dus het hoort hier ook zo te gaan.
 */
export async function stuurTestfactuur(f: Testfactuur, naarAdres: string): Promise<{
  bericht?: string
  kostenpost?: string
  soort?: string
}> {
  const { data: sessie } = await supabase().auth.getSession()
  const token = sessie.session?.access_token
  if (!token) throw new Error('Je sessie is verlopen. Log opnieuw in.')

  const pdf = testfactuurPdf(f)

  const res = await fetch(`${supabaseUrl()}/functions/v1/ontvang-mail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      /* Zonder deze vlag wordt er niet eens naar het token gekeken en geldt
         de handtekening van Resend. Zie de kop van ontvang-mail. */
      proef: true,
      type: 'email.received',
      data: {
        from: f.leverancier
          ? `${f.leverancier} <facturen@${kaalDomein(f.leverancier)}>`
          : 'onbekend@voorbeeld.nl',
        to: naarAdres,
        subject: f.nummer ? `Factuur ${f.nummer}` : 'Factuur',
        text: `Bijgaand onze factuur.\n\n${f.leverancier}`,
        attachments: [{
          filename: `${f.sleutel}.pdf`,
          content_type: 'application/pdf',
          content: base64Van(pdf),
        }],
      },
    }),
  })

  const uit = await res.json().catch(() => null) as
    ({ ok?: boolean; error?: string; reden?: string; id?: string;
       expenseId?: string; soort?: string }) | null

  if (!res.ok || !uit || uit.ok === false) {
    throw new Error(uit?.reden ?? uit?.error ?? `De webhook gaf ${res.status} terug.`)
  }
  return { bericht: uit.id, kostenpost: uit.expenseId, soort: uit.soort }
}

/** "Wairtec Chemie B.V." -> "wairtecchemie.nl", puur voor een echt ogend adres. */
function kaalDomein(naam: string): string {
  const kaal = naam
    .toLowerCase()
    .replace(/\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24)
  return (kaal || 'voorbeeld') + '.nl'
}
