/* ==================================================================
   Markdown lezen, net genoeg
   ==================================================================

   Voor de bibliotheek in het virtuele kantoor. Die toont de documentatie uit
   docs/, en dat zijn markdown-bestanden.

   Waarom geen pakket
   ------------------

   Omdat het niet nodig is. Wij lezen precies één soort markdown: die van
   onszelf. Geen voetnoten, geen HTML ertussen, geen plaatjes van internet.
   Wat er wél in staat is koppen, alinea's, lijsten, tabellen, codeblokken,
   citaten en streepjes -- en dat is te overzien.

   Een lezer die alles kan is hier een afhankelijkheid die bij elke update kan
   breken, voor gemak dat we niet gebruiken. Dezelfde afweging als bij .env in
   de lokale lezer.

   En het scheelt nog iets belangrijkers: wat hier binnenkomt wordt NOOIT als
   HTML uitgevoerd. Er is geen dangerouslySetInnerHTML; dit levert gegevens op
   en het scherm maakt er elementen van. Een document kan dus niets doen.

   Waarom dit gegevens teruggeeft en geen elementen
   ------------------------------------------------

   Zodat de zelftest hem kan narekenen zonder React te laden. Zelfde reden als
   bij werklijst.ts en keuze.mjs: een oordeel dat je alleen kunt zien door te
   renderen, kan niemand controleren.
   ================================================================== */

export type Stukje =
  | { soort: 'tekst'; tekst: string }
  | { soort: 'vet'; tekst: string }
  | { soort: 'cursief'; tekst: string }
  | { soort: 'code'; tekst: string }
  | { soort: 'link'; tekst: string; naar: string }

export type Blok =
  | { soort: 'kop'; niveau: number; stukjes: Stukje[] }
  | { soort: 'alinea'; stukjes: Stukje[] }
  | { soort: 'lijst'; genummerd: boolean; items: Stukje[][] }
  | { soort: 'tabel'; koppen: Stukje[][]; rijen: Stukje[][][] }
  | { soort: 'code'; taal: string; tekst: string }
  | { soort: 'citaat'; stukjes: Stukje[] }
  | { soort: 'streep' }

/* ------------------------------------------------------------------ *
 *  Wat er binnen een regel staat
 * ------------------------------------------------------------------ */

/**
 * Vet, cursief, code en links uit een regel halen.
 *
 * Code gaat eerst en wint van de rest: in `**niet vet**` hoort je precies dat
 * te zien, letterlijk, want dat is waar backticks voor zijn.
 */
export function leesStukjes(regel: string): Stukje[] {
  const uit: Stukje[] = []
  let rest = regel
  /* De volgorde is de voorrang. Code bovenaan, daarna links (want die kunnen
     vette tekst bevatten), dan vet vóór cursief -- anders leest ** als twee
     keer cursief. */
  const patroon = /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)/

  for (;;) {
    const m = patroon.exec(rest)
    if (!m || m.index === undefined) break

    if (m.index > 0) uit.push({ soort: 'tekst', tekst: rest.slice(0, m.index) })
    const stuk = m[0]

    if (stuk.startsWith('`')) {
      uit.push({ soort: 'code', tekst: stuk.slice(1, -1) })
    } else if (stuk.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(stuk)
      if (link) uit.push({ soort: 'link', tekst: link[1], naar: link[2] })
      else uit.push({ soort: 'tekst', tekst: stuk })
    } else if (stuk.startsWith('**')) {
      uit.push({ soort: 'vet', tekst: stuk.slice(2, -2) })
    } else {
      uit.push({ soort: 'cursief', tekst: stuk.slice(1, -1) })
    }

    rest = rest.slice(m.index + stuk.length)
  }

  if (rest) uit.push({ soort: 'tekst', tekst: rest })
  return uit
}

/* ------------------------------------------------------------------ *
 *  En wat er over regels heen gaat
 * ------------------------------------------------------------------ */

const isStreep = (r: string) => /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(r)
const isTabelrand = (r: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(r) && r.includes('-')

function tabelrij(regel: string): string[] {
  return regel
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim())
}

export function leesMarkdown(tekst: string): Blok[] {
  const regels = String(tekst ?? '').replace(/\r\n/g, '\n').split('\n')
  const blokken: Blok[] = []
  let i = 0

  while (i < regels.length) {
    const regel = regels[i]

    /* --- leeg --- */
    if (regel.trim() === '') { i++; continue }

    /* --- codeblok --- */
    if (/^\s*```/.test(regel)) {
      const taal = regel.replace(/^\s*```/, '').trim()
      const inhoud: string[] = []
      i++
      while (i < regels.length && !/^\s*```/.test(regels[i])) {
        inhoud.push(regels[i]); i++
      }
      i++ /* de sluitende ``` */
      blokken.push({ soort: 'code', taal, tekst: inhoud.join('\n') })
      continue
    }

    /* --- streep. Vóór de lijst, want --- lijkt op een opsomming --- */
    if (isStreep(regel)) { blokken.push({ soort: 'streep' }); i++; continue }

    /* --- kop --- */
    const kop = /^(#{1,6})\s+(.*)$/.exec(regel)
    if (kop) {
      blokken.push({
        soort: 'kop', niveau: kop[1].length, stukjes: leesStukjes(kop[2].trim()),
      })
      i++
      continue
    }

    /* --- tabel: een regel met pijpen, en daaronder de rand --- */
    if (regel.includes('|') && i + 1 < regels.length && isTabelrand(regels[i + 1])) {
      const koppen = tabelrij(regel).map(leesStukjes)
      i += 2
      const rijen: Stukje[][][] = []
      while (i < regels.length && regels[i].includes('|') && regels[i].trim() !== '') {
        rijen.push(tabelrij(regels[i]).map(leesStukjes))
        i++
      }
      blokken.push({ soort: 'tabel', koppen, rijen })
      continue
    }

    /* --- citaat --- */
    if (/^\s*>\s?/.test(regel)) {
      const stuk: string[] = []
      while (i < regels.length && /^\s*>\s?/.test(regels[i])) {
        stuk.push(regels[i].replace(/^\s*>\s?/, '')); i++
      }
      blokken.push({ soort: 'citaat', stukjes: leesStukjes(stuk.join(' ').trim()) })
      continue
    }

    /* --- lijst --- */
    const opsomming = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(regel)
    if (opsomming) {
      const genummerd = /\d/.test(opsomming[1])
      const items: Stukje[][] = []
      while (i < regels.length) {
        const m = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(regels[i])
        if (!m) {
          /* Een vervolgregel hoort bij het vorige punt, zolang hij inspringt. */
          if (items.length > 0 && /^\s{2,}\S/.test(regels[i])) {
            const laatste = items[items.length - 1]
            laatste.push(...leesStukjes(' ' + regels[i].trim()))
            i++
            continue
          }
          break
        }
        if (/\d/.test(m[1]) !== genummerd) break
        items.push(leesStukjes(m[2]))
        i++
      }
      blokken.push({ soort: 'lijst', genummerd, items })
      continue
    }

    /* --- alinea: alles tot de volgende lege regel --- */
    const alinea: string[] = []
    while (
      i < regels.length
      && regels[i].trim() !== ''
      && !/^\s*```/.test(regels[i])
      && !/^(#{1,6})\s/.test(regels[i])
      && !/^\s*>\s?/.test(regels[i])
      && !isStreep(regels[i])
      && !/^\s*([-*+]|\d+\.)\s+/.test(regels[i])
    ) {
      alinea.push(regels[i].trim()); i++
    }
    if (alinea.length > 0) {
      blokken.push({ soort: 'alinea', stukjes: leesStukjes(alinea.join(' ')) })
    } else {
      /* Voor de zekerheid: nooit blijven staan op een regel die niemand wil. */
      i++
    }
  }

  return blokken
}

/**
 * De koppen van een document, voor het zijmenu in de bibliotheek.
 *
 * Alleen niveau 2 en 3 -- niveau 1 is de titel van het document zelf, en
 * dieper dan drie wordt een inhoudsopgave een tweede document.
 */
export function koppenVan(blokken: Blok[]): { niveau: number; tekst: string; id: string }[] {
  return blokken
    .filter((b): b is Extract<Blok, { soort: 'kop' }> => b.soort === 'kop')
    .filter((b) => b.niveau === 2 || b.niveau === 3)
    .map((b) => {
      const tekst = b.stukjes.map((s) => s.tekst).join('')
      return { niveau: b.niveau, tekst, id: kopId(tekst) }
    })
}

/** Een anker dat in een adres past, en dat twee keer hetzelfde oplevert. */
export function kopId(tekst: string): string {
  return String(tekst ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
}
