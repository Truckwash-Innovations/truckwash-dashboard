/* ------------------------------------------------------------------ *
 *  Een PDF maken, in de browser
 *
 *  Casper: "dingen zoals pdf's ect kunnen maken, downloaden, printen ect."
 *
 *  Niet te verwarren met pdf.ts ernaast: die haalt pdf.js op om een PDF te
 *  LEZEN -- een contract uitlezen, een bijlage tonen. Dit bestand schrijft er
 *  een, en deelt daar niets mee.
 *
 *  Waarom dit met de hand geschreven is en niet met een pakket
 *  ----------------------------------------------------------
 *
 *  De gebruikelijke keus is pdf-lib of jsPDF, en die zijn allebei goed. Ze
 *  zijn ook allebei honderden kilobytes die iedereen downloadt, ook wie nooit
 *  een document maakt -- in een app die op negentien kassa's en op telefoons
 *  draait is dat geen detail.
 *
 *  Wat we nodig hebben is klein en scherp begrensd: tekst op A4, in twee
 *  gewichten, links of rechts, met regelafbreking en pagina's. Dat is een
 *  paar honderd regels, en het is een formaat dat sinds 1993 niet meer
 *  verandert.
 *
 *  Wat er NIET in zit
 *  ------------------
 *
 *  Afbeeldingen, tabellen, kleuren buiten grijstinten, en lettertypes buiten
 *  Helvetica. Dat is geen luiheid maar de grens: zodra je plaatjes en
 *  lettertypes wilt insluiten, ben je een pakket aan het schrijven, en dan
 *  kun je er beter een gebruiken. Loopt iemand hier tegenaan, dan is dat het
 *  moment om die keuze te maken -- niet nu.
 * ------------------------------------------------------------------ */

import type { DocBlok, DocBlokSoort } from './types'

const BREED = 595   // A4 in punten
const HOOG = 842
const MARGE = 56

/* Helvetica, breedte per teken van spatie t/m tilde, uit de AFM van Adobe.
   Zonder deze tabel kun je niet afbreken op woordgrenzen en niet rechts
   uitlijnen -- dan is elke regel een gok. */
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

/** De paar tekens boven ASCII die op een Nederlands stuk staan, in WinAnsi. */
const WINANSI: Record<string, number> = {
  '€': 0x80, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94,
  '–': 0x96, '—': 0x97, '·': 0xB7, '•': 0x95,
}

export function breedte(tekst: string, maat: number, vet = false): number {
  const tabel = vet ? VET : GEWOON
  let som = 0
  for (const teken of tekst) {
    const code = teken.codePointAt(0) ?? 32
    som += code >= 32 && code <= 126 ? tabel[code - 32] : 556
  }
  return (som * maat) / 1000
}

/** Een tekst zoals hij in een PDF-stream mag staan. */
function ontsnap(tekst: string): string {
  let uit = ''
  for (const teken of tekst) {
    const code = WINANSI[teken] ?? teken.codePointAt(0) ?? 32
    if (code > 255) { uit += '?'; continue }
    if (teken === '\\' || teken === '(' || teken === ')') { uit += '\\' + teken; continue }
    uit += code > 126 ? '\\' + code.toString(8).padStart(3, '0') : String.fromCharCode(code)
  }
  return uit
}

/**
 * Een regel opbreken zodat hij past.
 *
 * Op woordgrenzen, en een woord dat in zijn eentje te lang is (een url, een
 * lang samengesteld woord) wordt hard afgebroken. Dat laatste is lelijk en
 * het alternatief is erger: een regel die buiten de bladspiegel doorloopt en
 * bij het printen wordt afgesneden.
 */
export function breekAf(tekst: string, maat: number, vet: boolean, ruimte: number): string[] {
  const uit: string[] = []
  for (const stuk of tekst.split('\n')) {
    let regel = ''
    for (const woord of stuk.split(' ')) {
      const poging = regel ? regel + ' ' + woord : woord
      if (breedte(poging, maat, vet) <= ruimte) { regel = poging; continue }

      if (regel) { uit.push(regel); regel = '' }

      /* Het woord alleen past ook niet: teken voor teken afbreken. */
      let rest = woord
      while (breedte(rest, maat, vet) > ruimte && rest.length > 1) {
        let n = 1
        while (n < rest.length && breedte(rest.slice(0, n + 1), maat, vet) <= ruimte) n++
        uit.push(rest.slice(0, n))
        rest = rest.slice(n)
      }
      regel = rest
    }
    uit.push(regel)
  }
  return uit
}

/* ------------------------------------------------------------------ *
 *  Wat er op het blad komt
 * ------------------------------------------------------------------ */

const STIJL: Record<DocBlokSoort, { maat: number; vet: boolean; voor: number; na: number }> = {
  kop1:      { maat: 17, vet: true,  voor: 10, na: 8 },
  kop2:      { maat: 13, vet: true,  voor: 12, na: 5 },
  alinea:    { maat: 10.5, vet: false, voor: 0, na: 7 },
  punt:      { maat: 10.5, vet: false, voor: 0, na: 3 },
  genummerd: { maat: 10.5, vet: false, voor: 0, na: 3 },
  wit:       { maat: 10.5, vet: false, voor: 0, na: 8 },
  streep:    { maat: 10.5, vet: false, voor: 6, na: 10 },
}

/**
 * Welk nummer elke genummerde regel krijgt.
 *
 * Uit de plek in de lijst, en niet uit het blok zelf. Zou het nummer in het
 * blok staan, dan klopt de hele lijst niet meer zodra iemand er een regel
 * tussen zet -- en dat merk je pas in de PDF. Een andere soort ertussen
 * begint een nieuwe lijst; nul betekent "geen nummer".
 */
export function nummering(blokken: DocBlok[]): number[] {
  let n = 0
  return blokken.map((b) => (b.soort === 'genummerd' ? ++n : (n = 0)))
}

export interface PdfDocument {
  titel: string
  blokken: DocBlok[]
  /** Kleine regel onderaan elke bladzijde, bijvoorbeeld de bedrijfsnaam. */
  voet?: string
}

/* ------------------------------------------------------------------ *
 *  De opmaak
 * ------------------------------------------------------------------ */

interface Opdracht { x: number; y: number; tekst: string; maat: number; vet: boolean }

function paginas(doc: PdfDocument): Opdracht[][] {
  const ruimte = BREED - 2 * MARGE
  /* Onderaan ruimte houden voor het paginanummer en de voettekst. */
  const bodem = HOOG - MARGE - 26

  const bladen: Opdracht[][] = []
  let blad: Opdracht[] = []
  let y = MARGE

  const nummers = nummering(doc.blokken)

  const nieuwBlad = () => {
    bladen.push(blad)
    blad = []
    y = MARGE
  }

  /* De titel bovenaan het eerste blad. */
  if (doc.titel.trim()) {
    for (const regel of breekAf(doc.titel, 20, true, ruimte)) {
      blad.push({ x: MARGE, y, tekst: regel, maat: 20, vet: true })
      y += 24
    }
    y += 12
  }

  for (const [nr, blok] of doc.blokken.entries()) {
    const stijl = STIJL[blok.soort]
    y += stijl.voor

    if (blok.soort === 'wit') { y += 4; continue }

    if (blok.soort === 'streep') {
      if (y > bodem) nieuwBlad()
      /* Een streep is een heel dunne rechthoek; die tekenen we als zodanig in
         de stream. Hier alleen de ruimte reserveren. */
      blad.push({ x: -1, y, tekst: '', maat: 0, vet: false })
      y += stijl.na
      continue
    }

    /* Een opsommingsteken schuift de tekst in; het teken zelf komt links. */
    const inspring = blok.soort === 'punt' || blok.soort === 'genummerd' ? 16 : 0
    const merk = blok.soort === 'punt'
      ? '•'
      : blok.soort === 'genummerd' ? `${nummers[nr]}.` : ''

    const regels = breekAf(blok.tekst, stijl.maat, stijl.vet, ruimte - inspring)
    for (const [i, regel] of regels.entries()) {
      if (y > bodem) nieuwBlad()
      if (i === 0 && merk) {
        blad.push({ x: MARGE, y, tekst: merk, maat: stijl.maat, vet: false })
      }
      blad.push({
        x: MARGE + inspring, y, tekst: regel, maat: stijl.maat, vet: stijl.vet,
      })
      y += stijl.maat * 1.45
    }
    y += stijl.na
  }

  bladen.push(blad)
  return bladen
}

/* ------------------------------------------------------------------ *
 *  De PDF zelf
 * ------------------------------------------------------------------ */

function stroomVan(blad: Opdracht[], nummer: number, totaal: number, voet?: string): string {
  const regels: string[] = []

  for (const o of blad) {
    if (o.x < 0) {
      /* De streep. */
      regels.push('0.75 0.75 0.75 rg')
      regels.push(`${MARGE} ${(HOOG - o.y).toFixed(2)} ${BREED - 2 * MARGE} 0.6 re f`)
      continue
    }
    regels.push('0 0 0 rg')
    regels.push(
      `BT /${o.vet ? 'F2' : 'F1'} ${o.maat} Tf 1 0 0 1 `
      + `${o.x.toFixed(2)} ${(HOOG - o.y).toFixed(2)} Tm (${ontsnap(o.tekst)}) Tj ET`)
  }

  /* De voet: links de tekst, rechts het paginanummer. */
  const y = (HOOG - (HOOG - MARGE + 16)).toFixed(2)
  regels.push('0.45 0.45 0.45 rg')
  if (voet?.trim()) {
    regels.push(`BT /F1 8 Tf 1 0 0 1 ${MARGE} ${y} Tm (${ontsnap(voet)}) Tj ET`)
  }
  const tel = `${nummer} van ${totaal}`
  const x = BREED - MARGE - breedte(tel, 8)
  regels.push(`BT /F1 8 Tf 1 0 0 1 ${x.toFixed(2)} ${y} Tm (${ontsnap(tel)}) Tj ET`)

  return regels.join('\n') + '\n'
}

/**
 * Het document als PDF.
 *
 * Geeft de bytes terug; wat er daarna mee gebeurt -- downloaden, in een
 * venster openen, printen -- is aan de aanroeper.
 */
export function maakPdf(doc: PdfDocument): Uint8Array {
  const bladen = paginas(doc)
  const objecten: string[] = []

  /* 1 = catalogus, 2 = paginaboom, 3..n = pagina's en hun inhoud, dan de
     twee lettertypes. De nummers staan vast zodat de verwijzingen kloppen. */
  const eersteBlad = 3
  const perBlad = 2                     // de pagina zelf en zijn stroom
  const fontA = eersteBlad + bladen.length * perBlad
  const fontB = fontA + 1

  const kids = bladen.map((_, i) => `${eersteBlad + i * perBlad} 0 R`).join(' ')

  objecten.push('<< /Type /Catalog /Pages 2 0 R >>')
  objecten.push(`<< /Type /Pages /Kids [${kids}] /Count ${bladen.length} >>`)

  bladen.forEach((blad, i) => {
    const stroomNr = eersteBlad + i * perBlad + 1
    objecten.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${BREED} ${HOOG}] `
      + `/Resources << /Font << /F1 ${fontA} 0 R /F2 ${fontB} 0 R >> >> `
      + `/Contents ${stroomNr} 0 R >>`)

    const inhoud = stroomVan(blad, i + 1, bladen.length, doc.voet)
    objecten.push(`<< /Length ${inhoud.length} >>\nstream\n${inhoud}endstream`)
  })

  objecten.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  objecten.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

  let uit = '%PDF-1.4\n'
  const plekken: number[] = []
  objecten.forEach((obj, i) => {
    plekken.push(uit.length)
    uit += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })

  const xref = uit.length
  uit += `xref\n0 ${objecten.length + 1}\n0000000000 65535 f \n`
  for (const plek of plekken) uit += String(plek).padStart(10, '0') + ' 00000 n \n'
  uit += `trailer\n<< /Size ${objecten.length + 1} /Root 1 0 R >>\n`
    + `startxref\n${xref}\n%%EOF\n`

  /*
   * Latin-1 en geen UTF-8. De byteposities in de xref-tabel zijn in de stream
   * hierboven geteld als tekens; zodra één teken twee bytes wordt, wijzen ze
   * allemaal een stuk te vroeg en weigert elke lezer het bestand. ontsnap()
   * zorgt dat er geen teken boven 255 in komt.
   */
  const bytes = new Uint8Array(uit.length)
  for (let i = 0; i < uit.length; i++) bytes[i] = uit.charCodeAt(i) & 0xff
  return bytes
}
