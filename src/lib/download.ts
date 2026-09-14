/* ------------------------------------------------------------------ *
 *  Een bestand aan de gebruiker geven
 *
 *  Via een blob en een onzichtbare link. De app draait ook als
 *  Windows-programma en op een tablet; een gewone download is het enige dat
 *  daar overal hetzelfde werkt.
 *
 *  Stond drie keer los in de app -- bij het SEPA-bestand, bij het opslaan van
 *  een bijlage en bij een gemaakt document. Drie kopieën van tien regels is
 *  de plek waar de vierde net iets anders gaat, en dan werkt de download op
 *  één scherm niet zonder dat iemand weet waarom.
 *
 *  Eén plek gebruikt hem met opzet NIET: de opslaanknop in de bestandenkijker
 *  (Bekijker.tsx). Die hangt aan de blob die het kijkvenster zelf al open
 *  heeft staan, en die mag niet ingetrokken worden -- dan is het bestand van
 *  het scherm verdwenen terwijl je ernaar kijkt.
 * ------------------------------------------------------------------ */

export function bewaarBestand(naam: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = naam
  document.body.appendChild(a)
  a.click()
  a.remove()
  /*
   * Even wachten voordat we hem weggooien.
   *
   * Sommige browsers hebben de blob nog nodig op het moment dat de download
   * net begint; hem meteen intrekken geeft dan een lege of afgebroken
   * download. Dertig seconden is ruim en kost niets -- de blob verdwijnt
   * sowieso zodra de pagina weg is.
   */
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
