/* ===========================================================================
 *  keuze.mjs -- wat krijgt het model te zien?
 *
 *  Twee oordelen, hier apart gezet omdat ze de uitkomst van het hele lezen
 *  bepalen en allebei een keer fout zijn geweest. Een oordeel dat middenin
 *  een programma staat dat bij het importeren meteen gaat draaien, is een
 *  oordeel dat niemand kan narekenen.
 *
 *  Beide kennen geen pdfjs, geen canvas en geen Ollama: erin gaat tekst of
 *  een aantal, eruit komt een besluit.
 * =========================================================================== */

/** Onder deze lengte is een tekstlaag te dun om een factuur te zijn. */
export const MIN_TEKST = 200

/** Meer bladzijden kost meer tijd en geeft zelden meer factuur. */
export const MAX_PAGINAS = 3

/**
 * Ziet deze tekstlaag eruit als een factuur?
 *
 * De drempel stond op lengte alleen: tweehonderd tekens en het ging als
 * tekst naar het model, beeld werd overgeslagen. Dat gaat stil mis bij een
 * SCAN, en juist daar doet het pijn -- veel multifunctionals plakken er zelf
 * een OCR-laag onder, en een kopregel plus een voettekst haalt die
 * tweehonderd met gemak. Dan leest het model de slechte OCR van de scanner
 * in plaats van de factuur te zien, en de beeldroute die veel beter was komt
 * er niet eens aan te pas.
 *
 * Wat een echte factuurtekst altijd heeft en zulke rommel bijna nooit: een
 * bedrag met centen. Dat is het hele oordeel -- bewust grof, want fijner
 * afstellen betekent dat het bij de volgende leverancier weer net anders
 * ligt. Twijfel valt hier de goede kant op: geen bedrag gevonden betekent
 * beeld, en beeld is de duurdere maar zelden slechtere weg.
 */
export function lijktOpFactuur(tekst) {
  return /\d[.,]\d{2}(?!\d)/.test(String(tekst ?? ''))
}

/** Gaat deze tekstlaag naar het model, of wordt het beeld? */
export function alsTekst(tekst) {
  const t = String(tekst ?? '')
  return t.length >= MIN_TEKST && lijktOpFactuur(t)
}

/**
 * Welke bladzijden gaan er als plaatje naar het model?
 *
 * Hier stond "de eerste drie", en dat is bij een factuur van vijf pagina's
 * precies de verkeerde drie. Op zo'n stuk staat vooraan wie het stuurt en
 * ACHTERAAN wat er te betalen valt -- de specificatie ertussen is het minst
 * interessante deel. De oude keuze liet het model dus altijd het totaal
 * mislopen, zonder een woord.
 *
 * Nu: vooraan beginnen en de laatste er altijd bij. Bij drie bladzijden of
 * minder verandert er niets.
 */
export function welkeBladzijden(aantal) {
  const n = Math.max(0, Math.floor(Number(aantal) || 0))
  if (n <= MAX_PAGINAS) return Array.from({ length: n }, (_, i) => i + 1)
  const uit = Array.from({ length: MAX_PAGINAS - 1 }, (_, i) => i + 1)
  uit.push(n)
  return uit
}
