/* ------------------------------------------------------------------ *
 *  Testfacturen maken
 *
 *      node scripts/testfacturen.mjs
 *
 *  Zet een handvol PDF's in testfacturen/ die je naar een inkoopadres kunt
 *  mailen. Elke factuur is er een om een ANDERE afslag in de verwerking te
 *  raken -- niet zeven keer dezelfde bon met een ander bedrag.
 *
 *  Waarom dit een generator is en geen map met PDF's
 *  -------------------------------------------------
 *
 *  Omdat er nummers op horen die van Truckwash zelf zijn, en die horen niet
 *  in de repo. Ze staan hieronder in EIGEN; wie ze aanvult en dit opnieuw
 *  draait, krijgt facturen die ook langs de KvK- en btw-weg te herkennen
 *  zijn. Zolang ze leeg zijn staan ze er gewoon niet op, en dat is een
 *  eerlijke test: dan moet de IBAN het alleen doen.
 *
 *  De PDF wordt met de hand geschreven. Geen bibliotheek, want een pakket
 *  erbij voor zeven testbestanden is een pakket dat je over een jaar bij elke
 *  npm install meesleept. Het is een tekstlaag-PDF, dus de lokale lezer leest
 *  hem als tekst en Claude als document -- allebei zonder tussenstap.
 * ------------------------------------------------------------------ */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))
const UIT = join(HIER, '..', 'testfacturen')

/* ------------------------------------------------------------------ *
 *  De eigen nummers
 *
 *  De IBAN is die van Truckwash. KvK en btw staan leeg: die heb ik niet, en
 *  een verzonnen nummer op een testfactuur is erger dan geen nummer -- dan
 *  lijkt de test te slagen op iets wat in het echt niet klopt.
 *
 *  Vul ze aan en draai dit opnieuw als je ook die twee wegen wilt proberen.
 *  Ze moeten dan wel bij Ontwikkelaar -> Inkoop staan, want daarmee
 *  vergelijkt de post.
 * ------------------------------------------------------------------ */

const EIGEN = {
  iban: 'NL24 INGB 0106 7276 21',
  kvk: '',
  btw: '',
}

/* ------------------------------------------------------------------ *
 *  Een PDF schrijven
 * ------------------------------------------------------------------ */

const BREED = 595
const HOOG = 842

/* Helvetica, breedte per teken van spatie t/m tilde, uit de AFM van Adobe.
   Nodig om rechts uit te lijnen: zonder dit staan de bedragen in een kolom
   die per regel een paar punten verschuift, en dat leest een mens als
   slordig en een model als twee kolommen. */
const GEWOON = ('278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,'
  + '556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,'
  + '667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,'
  + '667,611,722,667,944,667,667,611,278,278,278,469,556,333,'
  + '556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,'
  + '500,278,556,500,722,500,500,500,334,260,334,584').split(',').map(Number)

const VET = ('278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,'
  + '556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,'
  + '722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,'
  + '667,611,722,667,944,667,667,611,333,278,333,584,556,333,'
  + '556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,'
  + '556,333,611,556,778,556,556,500,389,280,389,584').split(',').map(Number)

/* De paar tekens boven ASCII die op een Nederlandse factuur staan. De PDF
   gebruikt WinAnsiEncoding; dit is waar ze daar zitten. */
const WINANSI = {
  '€': 0x80, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94,
  '–': 0x96, '—': 0x97, '·': 0xB7,
}

function breedte(tekst, maat, vet) {
  const tabel = vet ? VET : GEWOON
  let som = 0
  for (const teken of tekst) {
    const code = teken.codePointAt(0)
    som += code >= 32 && code <= 126 ? tabel[code - 32] : 556
  }
  return (som * maat) / 1000
}

/** Een tekst zoals hij in een PDF-stream mag staan. */
function ontsnap(tekst) {
  let uit = ''
  for (const teken of tekst) {
    const code = WINANSI[teken] ?? teken.codePointAt(0)
    if (code > 255) { uit += '?'; continue }
    if (teken === '\\' || teken === '(' || teken === ')') { uit += '\\' + teken; continue }
    uit += code > 126 ? '\\' + code.toString(8).padStart(3, '0') : String.fromCharCode(code)
  }
  return uit
}

/**
 * Een blad om op te tekenen.
 *
 * De y telt van boven naar beneden, zoals je een brief leest. PDF telt
 * andersom; dat wordt hier omgerekend en verder nergens meer.
 */
function blad() {
  const stukken = []
  return {
    tekst(x, y, tekst, opties = {}) {
      const { maat = 10, vet = false, grijs = false, rechts = null } = opties
      const px = rechts === null ? x : rechts - breedte(tekst, maat, vet)
      stukken.push(
        (grijs ? '0.45 0.45 0.45 rg\n' : '0 0 0 rg\n')
        + 'BT /' + (vet ? 'F2' : 'F1') + ' ' + maat + ' Tf 1 0 0 1 '
        + px.toFixed(2) + ' ' + (HOOG - y).toFixed(2) + ' Tm ('
        + ontsnap(tekst) + ') Tj ET')
      return this
    },
    lijn(x1, y, x2, dik = 0.6, grijs = 0.75) {
      stukken.push(grijs + ' ' + grijs + ' ' + grijs + ' rg\n'
        + x1.toFixed(2) + ' ' + (HOOG - y).toFixed(2) + ' '
        + (x2 - x1).toFixed(2) + ' ' + dik + ' re f')
      return this
    },
    stroom() { return stukken.join('\n') + '\n' },
  }
}

function pdf(inhoud) {
  const objecten = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + BREED + ' ' + HOOG + '] '
      + '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + Buffer.byteLength(inhoud, 'latin1') + ' >>\nstream\n' + inhoud + 'endstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ]

  let uit = '%PDF-1.4\n'
  const plekken = []
  objecten.forEach((obj, i) => {
    plekken.push(Buffer.byteLength(uit, 'latin1'))
    uit += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n'
  })

  const xref = Buffer.byteLength(uit, 'latin1')
  uit += 'xref\n0 ' + (objecten.length + 1) + '\n0000000000 65535 f \n'
  for (const plek of plekken) uit += String(plek).padStart(10, '0') + ' 00000 n \n'
  uit += 'trailer\n<< /Size ' + (objecten.length + 1) + ' /Root 1 0 R >>\n'
    + 'startxref\n' + xref + '\n%%EOF\n'

  return Buffer.from(uit, 'latin1')
}

/* ------------------------------------------------------------------ *
 *  Een factuur tekenen
 * ------------------------------------------------------------------ */

const LINKS = 50
const RECHTS = 545

function bedrag(getal) {
  const [heel, cent] = Math.abs(getal).toFixed(2).split('.')
  return (getal < 0 ? '-' : '') + heel.replace(/\d(?=(\d{3})+$)/g, '$&.') + ',' + cent
}

function teken(f) {
  const b = blad()
  let y = 60

  /* --- de afzender --- */
  b.tekst(LINKS, y, f.van.naam, { maat: 16, vet: true })
  y += 16
  for (const regel of f.van.adres) { b.tekst(LINKS, y, regel, { maat: 9, grijs: true }); y += 12 }

  /* --- de kop, rechts --- */
  b.tekst(0, 60, f.kop ?? 'FACTUUR', { maat: 20, vet: true, rechts: RECHTS })
  let yr = 88
  const gegeven = (label, waarde) => {
    if (!waarde) return
    b.tekst(345, yr, label, { maat: 9, grijs: true })
    b.tekst(0, yr, waarde, { maat: 9, rechts: RECHTS })
    yr += 13
  }
  gegeven(f.kop === 'PAKBON' ? 'Pakbonnummer' : 'Factuurnummer', f.nummer)
  gegeven('Datum', f.datum)
  gegeven('Vervaldatum', f.vervaldatum)
  gegeven('Onze referentie', f.referentie)

  /* --- aan wie --- */
  y = Math.max(y, 150) + 18
  b.tekst(LINKS, y, f.kop === 'PAKBON' ? 'Afleveradres' : 'Factuuradres', { maat: 9, grijs: true })
  y += 15
  b.tekst(LINKS, y, f.aan.naam, { maat: 11, vet: true })
  y += 14
  for (const regel of f.aan.adres) { b.tekst(LINKS, y, regel, { maat: 9 }); y += 12 }
  for (const regel of f.aan.nummers ?? []) { b.tekst(LINKS, y, regel, { maat: 9, grijs: true }); y += 12 }

  /* --- de regels --- */
  y += 26
  b.tekst(LINKS, y, 'Omschrijving', { maat: 9, vet: true })
  b.tekst(0, y, 'Aantal', { maat: 9, vet: true, rechts: 350 })
  if (f.prijzen !== false) {
    b.tekst(0, y, 'Stukprijs', { maat: 9, vet: true, rechts: 425 })
    b.tekst(0, y, 'Btw', { maat: 9, vet: true, rechts: 465 })
    b.tekst(0, y, 'Bedrag', { maat: 9, vet: true, rechts: RECHTS })
  }
  y += 6
  b.lijn(LINKS, y, RECHTS)
  y += 16

  let excl = 0
  const btwPer = new Map()
  for (const regel of f.regels) {
    const som = Math.round(regel.aantal * regel.stuk * 100) / 100
    excl += som
    btwPer.set(regel.btw, (btwPer.get(regel.btw) ?? 0) + som)

    b.tekst(LINKS, y, regel.wat, { maat: 9 })
    b.tekst(0, y, (regel.aantal + ' ' + (regel.eenheid ?? '')).trim(), { maat: 9, rechts: 350 })
    if (f.prijzen !== false) {
      b.tekst(0, y, bedrag(regel.stuk), { maat: 9, rechts: 425 })
      b.tekst(0, y, regel.btw + '%', { maat: 9, rechts: 465 })
      b.tekst(0, y, bedrag(som), { maat: 9, rechts: RECHTS })
    }
    y += 15
  }

  y += 2
  b.lijn(LINKS, y, RECHTS)
  y += 18

  /* --- de optelsom --- */
  if (f.prijzen !== false) {
    const som = (label, getal, vet = false) => {
      b.tekst(330, y, label, { maat: 9, vet })
      b.tekst(0, y, '€ ' + bedrag(getal), { maat: 9, vet, rechts: RECHTS })
      y += 15
    }
    excl = Math.round(excl * 100) / 100
    som('Subtotaal excl. btw', excl)
    let btwTotaal = 0
    for (const [pct, grond] of [...btwPer].sort((a, c) => c[0] - a[0])) {
      const btw = Math.round(grond * pct) / 100
      btwTotaal += btw
      som('Btw ' + pct + '% over € ' + bedrag(Math.round(grond * 100) / 100), btw)
    }
    btwTotaal = Math.round(btwTotaal * 100) / 100
    y += 2
    b.lijn(330, y, RECHTS, 0.8, 0.4)
    y += 16
    som('Totaal te voldoen', Math.round((excl + btwTotaal) * 100) / 100, true)
  }

  /* --- de staart --- */
  y += 24
  for (const regel of f.slot ?? []) { b.tekst(LINKS, y, regel, { maat: 9 }); y += 13 }

  const nummers = [
    f.van.kvk ? 'KvK ' + f.van.kvk : null,
    f.van.btw ? 'Btw-nummer ' + f.van.btw : null,
    f.van.iban ? 'IBAN ' + f.van.iban : null,
  ].filter(Boolean)
  if (nummers.length) {
    y += 6
    b.tekst(LINKS, y, nummers.join('  ·  '), { maat: 9, grijs: true })
  }

  b.tekst(LINKS, 800, 'Testdocument, gemaakt met scripts/testfacturen.mjs om de '
    + 'factuurverwerking te beproeven. Geen echte vordering.', { maat: 7, grijs: true })

  return pdf(b.stroom())
}

/* ------------------------------------------------------------------ *
 *  De zeven
 * ------------------------------------------------------------------ */

const TW_VENLO = {
  naam: 'Truckwash 1 Venlo B.V.',
  adres: ['Columbusweg 47', '5928 LA Venlo', 'venlo@truckwash1group.nl'],
  kvk: EIGEN.kvk,
  btw: EIGEN.btw,
  iban: EIGEN.iban,
}

const FACTUREN = [
  {
    bestand: '1-verkoop-met-onze-iban.pdf',
    verwacht: 'De lezer hoort "verkoop" te zeggen, en onze IBAN staat erop. De '
      + 'kostenpost gaat weg en het bericht in de postbus wordt als '
      + 'verkoopfactuur gemerkt. Dit is de factuur waar het om begonnen was.',
    van: TW_VENLO,
    aan: {
      naam: 'Van Dijk Transport B.V.',
      adres: ['Havenweg 12', '5928 PB Venlo'],
      nummers: ['KvK 61220345', 'Btw-nummer NL854289117B01'],
    },
    nummer: 'TST-2026-0141',
    datum: '2026-09-04',
    vervaldatum: '2026-10-04',
    regels: [
      { wat: 'Buitenwas trekker met oplegger', aantal: 14, eenheid: 'stuks', stuk: 54.50, btw: 21 },
      { wat: 'Cabine binnen reinigen', aantal: 3, eenheid: 'stuks', stuk: 39.00, btw: 21 },
      { wat: 'Alcoa velgen behandeling', aantal: 2, eenheid: 'sets', stuk: 87.50, btw: 21 },
    ],
    slot: ['Betaling binnen 30 dagen op onderstaande rekening, onder vermelding',
      'van het factuurnummer.'],
  },

  {
    bestand: '2-verkoop-zonder-nummers.pdf',
    verwacht: 'De lezer zegt "verkoop", maar er staat geen KvK, btw-nummer of '
      + 'IBAN op om dat aan te toetsen. De kostenpost hoort te BLIJVEN staan, '
      + 'met een regel twijfel erbij die uitlegt waarom. Dat is het tweede slot '
      + 'aan het werk.',
    van: { naam: 'Truckwash 1 Asten B.V.', adres: ['Nobisweg 5', '5721 VA Asten'] },
    aan: { naam: 'Kessels Logistiek B.V.', adres: ['Industrieweg 8', '5731 HR Mierlo'] },
    nummer: 'TST-2026-0142',
    datum: '2026-09-05',
    vervaldatum: '2026-10-05',
    regels: [
      { wat: 'Buitenwas bakwagen', aantal: 6, eenheid: 'stuks', stuk: 42.00, btw: 21 },
    ],
    slot: ['Betaling binnen 30 dagen.'],
  },

  {
    bestand: '3-inkoop-gewoon.pdf',
    verwacht: 'Een gewone rekening aan een vestiging. Wordt een kostenpost, '
      + 'krijgt een grootboekvoorstel op trefwoord (chemie, dus 4000) en de bv '
      + 'van vestiging Venlo.',
    van: {
      naam: 'Reinchem Nederland B.V.',
      adres: ['Chemieweg 22', '5928 RT Venlo', 'facturatie@reinchem-test.nl'],
      kvk: '17098412', btw: 'NL809442117B01', iban: 'NL29TEST0341920033',
    },
    aan: {
      naam: 'Truckwash 1 Venlo B.V.',
      adres: ['Columbusweg 47', '5928 LA Venlo'],
    },
    nummer: 'RC-884120',
    datum: '2026-09-02',
    vervaldatum: '2026-09-16',
    referentie: 'Order 55-2211',
    regels: [
      { wat: 'Truckshampoo alkalisch, can 25 liter', aantal: 8, eenheid: 'can', stuk: 62.40, btw: 21 },
      { wat: 'Ontvetter velgen, can 10 liter', aantal: 4, eenheid: 'can', stuk: 48.75, btw: 21 },
      { wat: 'Transportkosten', aantal: 1, eenheid: '', stuk: 35.00, btw: 21 },
    ],
    slot: ['Betaling binnen 14 dagen. Betalingskenmerk 8841200000141.'],
  },

  {
    bestand: '4-inkoop-vastgoed.pdf',
    verwacht: 'Gericht aan Truckwash 1 Vastgoed B.V. -- geen vestiging. Het '
      + 'mailadres wijst naar een vestiging, het stuk naar Vastgoed. De bv hoort '
      + 'van het STUK te komen (bron: gelezen) en niet van het adres waar de '
      + 'mail binnenkwam.',
    van: {
      naam: 'Van Loon Bouwbeheer B.V.',
      adres: ['Ambachtstraat 4', '5384 RH Heesch'],
      kvk: '16044927', btw: 'NL802114553B01', iban: 'NL62TEST0776301188',
    },
    aan: {
      naam: 'Truckwash 1 Vastgoed B.V.',
      adres: ['Postbus 24', '5680 AA Best'],
    },
    nummer: 'VL-2026-0771',
    datum: '2026-09-01',
    vervaldatum: '2026-09-29',
    regels: [
      { wat: 'Vervangen dakbedekking wasstraat, 3e termijn', aantal: 1, eenheid: '', stuk: 4850.00, btw: 21 },
      { wat: 'Huurdersonderhoud hemelwaterafvoer', aantal: 1, eenheid: '', stuk: 610.00, btw: 21 },
    ],
    slot: ['Betaling binnen 28 dagen na factuurdatum.'],
  },

  {
    bestand: '5-inkoop-afkorting.pdf',
    verwacht: 'Gericht aan "Truckwash 1 Techniek", terwijl de bv voluit '
      + '"Truckwash 1 Techniek & Beheer B.V." heet. Dat is een afkorting en geen '
      + 'zekerheid: de bron hoort "vermoeden" te worden, en dan staat er een '
      + 'merkje bij dat iemand het nakijkt.',
    van: {
      naam: 'Hydrauliek Zuid B.V.',
      adres: ['Metaalweg 9', '5804 CG Venray'],
      kvk: '12038877', btw: 'NL807761209B01', iban: 'NL18TEST0294551070',
    },
    aan: {
      naam: 'Truckwash 1 Techniek',
      adres: ['Columbusweg 47', '5928 LA Venlo'],
    },
    nummer: 'HZ-51209',
    datum: '2026-09-03',
    vervaldatum: '2026-10-03',
    regels: [
      { wat: 'Hogedrukpomp revisie, arbeid', aantal: 6.5, eenheid: 'uur', stuk: 72.50, btw: 21 },
      { wat: 'Keerringset', aantal: 2, eenheid: 'sets', stuk: 118.00, btw: 21 },
      { wat: 'Voorrijkosten', aantal: 1, eenheid: '', stuk: 45.00, btw: 21 },
    ],
    slot: ['Betaling binnen 30 dagen.'],
  },

  {
    bestand: '6-inkoop-naam-lijkt-erop.pdf',
    verwacht: 'De valstrik. De afzender heet "Truckwash Systems GmbH" en is een '
      + 'ANDER bedrijf: een leverancier van wasinstallaties. Dit hoort "inkoop" '
      + 'te zijn en een kostenpost te blijven. Verdwijnt hij als verkoopfactuur, '
      + 'dan deugt het tweede slot niet.',
    van: {
      naam: 'Truckwash Systems GmbH',
      adres: ['Industriestrasse 14', '47533 Kleve, Deutschland'],
      kvk: 'HRB 14822 Kleve', btw: 'DE812449107', iban: 'DE24TEST0500011223',
    },
    aan: {
      naam: 'Truckwash 1 Asten B.V.',
      adres: ['Nobisweg 5', '5721 VA Asten'],
    },
    nummer: 'TS-2026-4471',
    datum: '2026-08-28',
    vervaldatum: '2026-09-27',
    regels: [
      { wat: 'Borstelset hoofdborstel, type HB-4', aantal: 2, eenheid: 'sets', stuk: 1340.00, btw: 21 },
      { wat: 'Montage en inbedrijfstelling', aantal: 1, eenheid: '', stuk: 780.00, btw: 21 },
    ],
    slot: ['Zahlbar innerhalb 30 Tagen ohne Abzug.'],
  },

  {
    bestand: '7-pakbon.pdf',
    verwacht: 'Een pakbon: aantallen, geen bedragen. De lezing wordt bewaard, '
      + 'maar de bon hoort NIET ingevuld te worden -- anders staat dezelfde '
      + 'levering straks twee keer in de kosten, want de factuur komt apart.',
    kop: 'PAKBON',
    prijzen: false,
    van: {
      naam: 'Reinchem Nederland B.V.',
      adres: ['Chemieweg 22', '5928 RT Venlo'],
      kvk: '17098412',
    },
    aan: {
      naam: 'Truckwash 1 Venlo B.V.',
      adres: ['Columbusweg 47', '5928 LA Venlo'],
    },
    nummer: 'PB-884120',
    datum: '2026-09-02',
    referentie: 'Order 55-2211',
    regels: [
      { wat: 'Truckshampoo alkalisch, can 25 liter', aantal: 8, eenheid: 'can', stuk: 0, btw: 21 },
      { wat: 'Ontvetter velgen, can 10 liter', aantal: 4, eenheid: 'can', stuk: 0, btw: 21 },
    ],
    slot: ['Goederen ontvangen in goede staat. De factuur volgt apart.'],
  },
]

/* ------------------------------------------------------------------ *
 *  Wegschrijven
 * ------------------------------------------------------------------ */

mkdirSync(UIT, { recursive: true })

const uitleg = [
  'Testfacturen',
  '============',
  '',
  'Gemaakt met: node scripts/testfacturen.mjs',
  '',
  'Mail ze als bijlage naar een inkoopadres; Ontwikkelaar -> Inkoop laat zien',
  'welke dat zijn. Per stuk een aparte mail: de post maakt een kostenpost per',
  'bericht, en zo zie je bij elke bon los wat de lezer ervan vond.',
  '',
]

if (!EIGEN.kvk && !EIGEN.btw) {
  uitleg.push(
    'Let op: het KvK- en btw-nummer van Truckwash staan niet in het script, dus',
    'ze staan ook niet op de facturen. Alleen de IBAN kan een verkoopfactuur',
    'hier bevestigen. Vul ze in bovenaan scripts/testfacturen.mjs als je die',
    'twee wegen ook wilt proberen.',
    '')
}

for (const f of FACTUREN) {
  writeFileSync(join(UIT, f.bestand), teken(f))
  uitleg.push(f.bestand, '  ' + f.verwacht.replace(/(.{1,72})(\s|$)/g, '$1\n  ').trim(), '')
  console.log('  ' + f.bestand)
}

writeFileSync(join(UIT, 'LEESMIJ.txt'), uitleg.join('\n') + '\n')
console.log('\n' + FACTUREN.length + ' testfacturen in testfacturen/ -- zie LEESMIJ.txt')
