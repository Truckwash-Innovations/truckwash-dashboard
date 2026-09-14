/* ------------------------------------------------------------------ *
 *  Een document schrijven, en er een PDF van maken
 *
 *  Casper: "dingen zoals pdf's ect kunnen maken, downloaden, printen ect."
 *
 *  Het documentbeheer (0071) bewaart wat van elders komt: een upload, een
 *  bijlage uit de mail, een scan. Wat er niet was, is de andere kant --
 *  iets zelf opschrijven. En dat is nou juist waar Word voor gebruikt wordt:
 *  een brief, een verslag, een protocol, een verklaring.
 *
 *  Het model: blokken, geen opmaak
 *  -------------------------------
 *
 *  Een document is een rij blokken, elk met een soort en een tekst. Geen vet
 *  midden in een zin, geen lettergroottes, geen kleuren. Dat is een keuze en
 *  geen tekortkoming: wat je hier schrijft ziet er daardoor altijd hetzelfde
 *  uit, en een protocol dat op elke vestiging hetzelfde oogt is meer waard
 *  dan een protocol waar iemand zijn eigen lettertype in heeft gezet.
 *
 *  Wat er wél op de lijst staat -- tabellen, plaatjes, .docx -- hoort bij
 *  OnlyOffice, en dat wacht op een server.
 *
 *  Waarom hier geen tweede versie ontstaat
 *  ---------------------------------------
 *
 *  De PDF wordt gemaakt op het moment dat je hem vraagt, uit de blokken die
 *  op dat moment in de rij staan. Hem opslaan zou betekenen dat er een PDF
 *  van gisteren naast de tekst van vandaag ligt, en dat de verkeerde van die
 *  twee wordt rondgestuurd.
 * ------------------------------------------------------------------ */

import { maakPdf, nummering } from './pdfmaken'

/* De nummering van een genummerde lijst hoort bij de opmaak en staat daarom
   in pdfmaken.ts. Het scherm heeft hem ook nodig om een document te tonen;
   hier weer naar buiten, zodat er niet een tweede telling ontstaat die er net
   naast zit. */
export { nummering }
import { bewaarBestand } from './download'
import { uid } from './db'
import type { DocBestand, DocBlok, DocBlokSoort } from './types'

/**
 * Wat er onderaan elke bladzijde komt.
 *
 * Een vaste waarde en geen instelling: het staat al op vier andere plekken in
 * de app zo, en van één regel onder een brief een beheerscherm maken levert
 * een veld op dat niemand ooit invult.
 */
export const VOET = 'Truckwash 1 Group'

/* ------------------------------------------------------------------ *
 *  De blokken
 * ------------------------------------------------------------------ */

export const SOORTEN: { key: DocBlokSoort; label: string; korte: string }[] = [
  { key: 'kop1',      label: 'Kop',            korte: 'H1' },
  { key: 'kop2',      label: 'Tussenkop',      korte: 'H2' },
  { key: 'alinea',    label: 'Alinea',         korte: '¶' },
  { key: 'punt',      label: 'Opsomming',      korte: '•' },
  { key: 'genummerd', label: 'Genummerd',      korte: '1.' },
  { key: 'streep',    label: 'Scheidingslijn', korte: '—' },
  { key: 'wit',       label: 'Witregel',       korte: '␣' },
]

/** Soorten waar geen tekst in hoort; die krijgen in de opmaak geen invoerveld. */
export const ZONDER_TEKST: DocBlokSoort[] = ['wit', 'streep']

export function nieuwBlok(soort: DocBlokSoort = 'alinea', tekst = ''): DocBlok {
  return { id: uid('blk'), soort, tekst }
}

/** Een nieuw document: één alinea, zodat er meteen iets staat om in te typen. */
export function leegDocument(): DocBlok[] {
  return [nieuwBlok('alinea')]
}

/**
 * De blokken zoals ze uit de database komen.
 *
 * De kolom is jsonb en dus is alles mogelijk: null, een object, een lijst met
 * rommel erin. Dat is geen theoretisch geval -- een oudere versie van de app
 * of een wijziging met de hand komt hier langs. Wat niet klopt valt weg in
 * plaats van dat het scherm omvalt op een blok zonder tekst.
 */
export function alsBlokken(ruw: unknown): DocBlok[] {
  if (!Array.isArray(ruw)) return []
  const soorten = new Set<string>(SOORTEN.map((s) => s.key))
  const uit: DocBlok[] = []
  for (const item of ruw) {
    if (!item || typeof item !== 'object') continue
    const b = item as Partial<DocBlok>
    if (typeof b.soort !== 'string' || !soorten.has(b.soort)) continue
    uit.push({
      id: typeof b.id === 'string' && b.id ? b.id : uid('blk'),
      soort: b.soort as DocBlokSoort,
      tekst: typeof b.tekst === 'string' ? b.tekst : '',
    })
  }
  return uit
}

/**
 * Het document als platte tekst.
 *
 * Voor het zoekveld en voor het regeltje onder de naam in de lijst. Witregels
 * en strepen doen hier niet mee: die zeggen iets over de opmaak en niets over
 * waar het stuk over gaat.
 */
export function alsTekst(blokken: DocBlok[]): string {
  return blokken
    .filter((b) => !ZONDER_TEKST.includes(b.soort))
    .map((b) => b.tekst.trim())
    .filter(Boolean)
    .join('\n')
}

/** Een korte samenvatting voor in de lijst. */
export function eersteRegels(blokken: DocBlok[], tekens = 120): string {
  const alles = alsTekst(blokken).replace(/\s+/g, ' ').trim()
  return alles.length > tekens ? alles.slice(0, tekens - 1) + '…' : alles
}

/* ------------------------------------------------------------------ *
 *  Bewerkingen
 *
 *  Allemaal zonder de lijst zelf aan te raken: ze geven een nieuwe terug.
 *  React vergelijkt op verwijzing, en een lijst die je ter plekke wijzigt
 *  ziet er voor hem hetzelfde uit -- dan blijft het scherm staan terwijl de
 *  inhoud allang veranderd is.
 * ------------------------------------------------------------------ */

export function zetTekst(blokken: DocBlok[], id: string, tekst: string): DocBlok[] {
  return blokken.map((b) => (b.id === id ? { ...b, tekst } : b))
}

export function zetSoort(blokken: DocBlok[], id: string, soort: DocBlokSoort): DocBlok[] {
  return blokken.map((b) => (b.id === id ? { ...b, soort } : b))
}

/** Een blok erachter zetten. Zonder id komt hij onderaan. */
export function voegToe(blokken: DocBlok[], na: string | undefined, blok: DocBlok): DocBlok[] {
  const i = na ? blokken.findIndex((b) => b.id === na) : -1
  if (i < 0) return [...blokken, blok]
  return [...blokken.slice(0, i + 1), blok, ...blokken.slice(i + 1)]
}

/**
 * Een blok weghalen.
 *
 * Nooit tot nul: een document zonder blokken geeft een scherm zonder
 * invoervelden, en dan is er geen manier meer om er iets in te typen zonder
 * eerst op een knop te zoeken die er niet is.
 */
export function haalWeg(blokken: DocBlok[], id: string): DocBlok[] {
  const over = blokken.filter((b) => b.id !== id)
  return over.length ? over : leegDocument()
}

export function verplaats(blokken: DocBlok[], id: string, richting: -1 | 1): DocBlok[] {
  const i = blokken.findIndex((b) => b.id === id)
  const j = i + richting
  if (i < 0 || j < 0 || j >= blokken.length) return blokken
  const uit = [...blokken]
  ;[uit[i], uit[j]] = [uit[j], uit[i]]
  return uit
}

/* ------------------------------------------------------------------ *
 *  Eruit halen: PDF, downloaden, printen
 * ------------------------------------------------------------------ */

/** Een bestandsnaam waar geen schijf moeilijk over doet. */
export function bestandsnaam(naam: string, achtervoegsel = '.pdf'): string {
  const kaal = naam
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return (kaal || 'document') + achtervoegsel
}

export function naarPdf(doc: Pick<DocBestand, 'naam'>, blokken: DocBlok[], voet?: string) {
  return maakPdf({ titel: doc.naam, blokken, voet })
}

export function pdfDownloaden(doc: Pick<DocBestand, 'naam'>, blokken: DocBlok[], voet?: string) {
  const bytes = naarPdf(doc, blokken, voet)
  /*
   * De bytes worden hier gekopieerd naar een eigen ArrayBuffer.
   *
   * Een Uint8Array uit een groter buffer geeft aan Blob() soms méér mee dan
   * de bedoeling was. Hier komt hij altijd uit maakPdf() en klopt dat wel,
   * maar de kopie kost niets en houdt het onafhankelijk van waar hij vandaan
   * komt.
   */
  const kopie = new Uint8Array(bytes)
  bewaarBestand(bestandsnaam(doc.naam), new Blob([kopie], { type: 'application/pdf' }))
}

/* ------------------------------------------------------------------ *
 *  Printen
 *
 *  Via een eigen lijstje HTML in een verborgen iframe, en niet met een
 *  printstijlblad over de app heen.
 *
 *  Dat tweede is de gebruikelijke weg en het werkt hier slecht: dan moet elk
 *  ander scherm in de app zich bij het printen wegcijferen, en dat is een
 *  regel die iemand ooit vergeet bij een nieuw scherm. Dan komt de zijbalk
 *  mee op het papier van een brief aan een klant.
 *
 *  Een iframe heeft zijn eigen pagina met zijn eigen stijl. Wat erin staat is
 *  wat er uit de printer komt, en de rest van de app doet niet mee.
 * ------------------------------------------------------------------ */

function ontsnapHtml(tekst: string): string {
  return tekst
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Het document als een op zichzelf staande pagina. Ook los bruikbaar. */
export function alsHtml(titel: string, blokken: DocBlok[], voet?: string): string {
  const regels: string[] = []
  let lijst: 'punt' | 'genummerd' | null = null

  const sluit = () => {
    if (lijst) regels.push(lijst === 'punt' ? '</ul>' : '</ol>')
    lijst = null
  }

  for (const blok of blokken) {
    const tekst = ontsnapHtml(blok.tekst)
    if (blok.soort === 'punt' || blok.soort === 'genummerd') {
      if (lijst !== blok.soort) {
        sluit()
        regels.push(blok.soort === 'punt' ? '<ul>' : '<ol>')
        lijst = blok.soort
      }
      regels.push(`<li>${tekst}</li>`)
      continue
    }
    sluit()
    if (blok.soort === 'kop1') regels.push(`<h2>${tekst}</h2>`)
    else if (blok.soort === 'kop2') regels.push(`<h3>${tekst}</h3>`)
    else if (blok.soort === 'streep') regels.push('<hr>')
    else if (blok.soort === 'wit') regels.push('<p class="wit">&nbsp;</p>')
    else regels.push(`<p>${tekst}</p>`)
  }
  sluit()

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8">`
    + `<title>${ontsnapHtml(titel)}</title><style>`
    + 'body{font:11pt/1.5 Helvetica,Arial,sans-serif;color:#111;margin:20mm}'
    + 'h1{font-size:19pt;margin:0 0 14pt}h2{font-size:15pt;margin:16pt 0 6pt}'
    + 'h3{font-size:12.5pt;margin:13pt 0 4pt}p{margin:0 0 7pt}'
    + 'ul,ol{margin:0 0 7pt;padding-left:18pt}li{margin:0 0 3pt}'
    + 'hr{border:0;border-top:1px solid #bbb;margin:10pt 0}'
    + '.wit{margin:0 0 10pt}.voet{margin-top:18pt;font-size:8pt;color:#666}'
    + '@page{size:A4;margin:20mm}'
    + `</style></head><body><h1>${ontsnapHtml(titel)}</h1>`
    + regels.join('')
    + (voet?.trim() ? `<p class="voet">${ontsnapHtml(voet)}</p>` : '')
    + '</body></html>'
}

export function printen(titel: string, blokken: DocBlok[], voet?: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)

  const venster = frame.contentWindow
  if (!venster) { frame.remove(); return }

  venster.document.open()
  venster.document.write(alsHtml(titel, blokken, voet))
  venster.document.close()

  /*
   * Pas printen als de pagina er staat.
   *
   * Meteen na close() is hij er meestal wel, maar niet altijd -- en dan komt
   * er een leeg vel uit. onload wacht daar netjes op; de terugval eronder is
   * voor het geval hij al klaar was voordat we de luisteraar zetten.
   */
  const nu = () => {
    venster.focus()
    venster.print()
    /* Weghalen kan pas als het printvenster dicht is; in Electron en in de
       browser blokkeert print() daar zelf op. Ruim op met vertraging, zodat
       een printer die nog leest niet naar een weggegooid document kijkt. */
    setTimeout(() => frame.remove(), 60_000)
  }

  if (venster.document.readyState === 'complete') nu()
  else venster.addEventListener('load', nu, { once: true })
}
