/* ===========================================================================
 *  Een SEPA-betaalbestand maken
 *
 *  Casper: "evt een sepa bestand kan aanmaken ect."
 *
 *  Zo gaat betalen in de praktijk: je maakt één bestand met alle openstaande
 *  facturen erin, laadt het bij de bank, en die maakt ze in één keer over.
 *  Het formaat is pain.001.001.03 -- een Europese standaard, en elke bank
 *  leest hem.
 *
 *  Waarom de IBAN's hier worden nagerekend
 *  ---------------------------------------
 *
 *  Omdat een bank een bestand met één foute IBAN in zijn geheel weigert. Niet
 *  die ene regel: het hele bestand. Dan sta je met achttien facturen die niet
 *  betaald zijn en een foutmelding die alleen zegt dat er iets niet klopt.
 *
 *  Die IBAN's komen bovendien uit een factuur die door een model is gelezen.
 *  Meestal goed, en soms een cijfer verkeerd -- en dat is precies wat de
 *  elfproef van IBAN (mod-97) eruit haalt. Wat niet klopt gaat er niet in, en
 *  wordt gemeld zodat iemand het kan nakijken.
 *
 *  Wat dit bestand NIET is
 *  -----------------------
 *
 *  Een betaling. Het is een opdracht die iemand nog bij de bank moet
 *  aanleveren en fiatteren. Daarom zet het maken van dit bestand ook geen
 *  enkele factuur op betaald -- dat is een aparte handeling, later.
 * =========================================================================== */

export interface SepaRegel {
  /** Onze eigen id van de factuur; komt terug als EndToEndId. */
  id: string
  naam: string
  iban: string
  /** In euro, inclusief btw. Wordt op twee decimalen afgerond. */
  bedrag: number
  /** Wat de leverancier op zijn afschrift ziet. */
  kenmerk?: string | null
}

export interface SepaOpdracht {
  berichtId: string
  /** Naam en rekening van wie betaalt. */
  eigenNaam: string
  eigenIban: string
  eigenBic?: string | null
  /** Wanneer de bank het moet uitvoeren. */
  uitvoerenOp: Date
  regels: SepaRegel[]
}

/* ------------------------------------------------------------------ *
 *  De IBAN-toets
 *
 *  Verplaats de eerste vier tekens naar achteren, vervang letters door
 *  cijfers (a=10 ... z=35), en wat overblijft moet rest 1 geven bij deling
 *  door 97. Dat is de hele regel, en hij vangt vrijwel elke typefout en elk
 *  verkeerd gelezen cijfer.
 *
 *  In stukjes rekenen, want een Nederlandse IBAN wordt een getal van
 *  twintig cijfers en dat past niet in een gewoon getal.
 * ------------------------------------------------------------------ */

export function ibanKlopt(ruw: string): boolean {
  const iban = (ruw ?? '').replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false

  const gedraaid = iban.slice(4) + iban.slice(0, 4)
  let rest = 0
  for (const teken of gedraaid) {
    const cijfers = /\d/.test(teken)
      ? teken
      : String(teken.charCodeAt(0) - 55)
    for (const c of cijfers) {
      rest = (rest * 10 + Number(c)) % 97
    }
  }
  return rest === 1
}

/* ------------------------------------------------------------------ *
 *  XML zonder verrassingen
 *
 *  Een leveranciersnaam kan van alles bevatten -- een ampersand, een
 *  aanhalingsteken, een naam met accenten. Onbewerkt in XML zetten levert een
 *  bestand op dat de bank niet kan lezen, en dat merk je pas daar.
 * ------------------------------------------------------------------ */

function xml(tekst: string): string {
  return String(tekst ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Wat er in een naam of omschrijving mag.
 *
 * SEPA staat een beperkte tekenset toe. Een naam met een accent of een
 * liggend streepje van een tekstverwerker glipt er anders in en wordt bij de
 * bank een afkeuring. Vervangen is hier beter dan weglaten: "Müller" moet
 * "Muller" worden en niet "Mller".
 */
function sepaTekst(ruw: string, max: number): string {
  const vervangen: Record<string, string> = {
    á: 'a', à: 'a', ä: 'a', â: 'a', é: 'e', è: 'e', ë: 'e', ê: 'e',
    í: 'i', ì: 'i', ï: 'i', î: 'i', ó: 'o', ò: 'o', ö: 'o', ô: 'o',
    ú: 'u', ù: 'u', ü: 'u', û: 'u', ç: 'c', ñ: 'n', ß: 'ss',
    '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"',
  }
  const schoon = [...String(ruw ?? '')]
    .map((t) => vervangen[t] ?? vervangen[t.toLowerCase()]?.toUpperCase() ?? t)
    .join('')
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return schoon.slice(0, max)
}

/** Een datum als jjjj-mm-dd, op UTC zodat er geen dag verschuift. */
function dag(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ *
 *  Het bestand
 * ------------------------------------------------------------------ */

export interface SepaUitkomst {
  xml: string
  bestandsnaam: string
  aantal: number
  totaal: number
  /** Wat er niet in kon, met de reden erbij. */
  overgeslagen: { id: string; naam: string; reden: string }[]
}

export function maakSepa(opdracht: SepaOpdracht): SepaUitkomst {
  const overgeslagen: { id: string; naam: string; reden: string }[] = []
  const goed: SepaRegel[] = []

  for (const r of opdracht.regels) {
    const iban = (r.iban ?? '').replace(/\s+/g, '').toUpperCase()
    if (!iban) {
      overgeslagen.push({ id: r.id, naam: r.naam, reden: 'geen rekeningnummer op de factuur' })
      continue
    }
    if (!ibanKlopt(iban)) {
      overgeslagen.push({ id: r.id, naam: r.naam, reden: `rekeningnummer ${iban} klopt niet` })
      continue
    }
    const bedrag = Math.round((Number(r.bedrag) || 0) * 100) / 100
    if (bedrag <= 0) {
      overgeslagen.push({ id: r.id, naam: r.naam, reden: 'bedrag is nul' })
      continue
    }
    goed.push({ ...r, iban, bedrag })
  }

  if (!ibanKlopt(opdracht.eigenIban)) {
    throw new Error(`De eigen rekening (${opdracht.eigenIban}) klopt niet. `
      + 'Zet hem goed bij de bv voordat je een betaalbestand maakt.')
  }

  const totaal = Math.round(goed.reduce((t, r) => t + r.bedrag, 0) * 100) / 100
  const nu = new Date()

  const transacties = goed.map((r) => `
        <CdtTrfTxInf>
          <PmtId><EndToEndId>${xml(sepaTekst(r.id, 35))}</EndToEndId></PmtId>
          <Amt><InstdAmt Ccy="EUR">${r.bedrag.toFixed(2)}</InstdAmt></Amt>
          <Cdtr><Nm>${xml(sepaTekst(r.naam || 'Onbekend', 70))}</Nm></Cdtr>
          <CdtrAcct><Id><IBAN>${xml(r.iban)}</IBAN></Id></CdtrAcct>
          <RmtInf><Ustrd>${xml(sepaTekst(r.kenmerk || r.id, 140))}</Ustrd></RmtInf>
        </CdtTrfTxInf>`).join('')

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${xml(sepaTekst(opdracht.berichtId, 35))}</MsgId>
      <CreDtTm>${nu.toISOString().replace(/\.\d{3}Z$/, 'Z')}</CreDtTm>
      <NbOfTxs>${goed.length}</NbOfTxs>
      <CtrlSum>${totaal.toFixed(2)}</CtrlSum>
      <InitgPty><Nm>${xml(sepaTekst(opdracht.eigenNaam, 70))}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${xml(sepaTekst(opdracht.berichtId, 35))}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${goed.length}</NbOfTxs>
      <CtrlSum>${totaal.toFixed(2)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${dag(opdracht.uitvoerenOp)}</ReqdExctnDt>
      <Dbtr><Nm>${xml(sepaTekst(opdracht.eigenNaam, 70))}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${xml(opdracht.eigenIban.replace(/\s+/g, '').toUpperCase())}</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId>${
        opdracht.eigenBic
          ? `<BIC>${xml(opdracht.eigenBic.replace(/\s+/g, '').toUpperCase())}</BIC>`
          : '<Othr><Id>NOTPROVIDED</Id></Othr>'
      }</FinInstnId></DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>${transacties}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`

  return {
    xml: body,
    bestandsnaam: `betaling-${dag(opdracht.uitvoerenOp)}-${goed.length}.xml`,
    aantal: goed.length,
    totaal,
    overgeslagen,
  }
}
