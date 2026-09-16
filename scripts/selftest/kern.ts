/**
 * De kern van de zelftest: de nagebootste browser en de telling.
 *
 * Waarom dit een apart bestand is
 * -------------------------------
 *
 * scripts/selftest.ts was dertienduizend regels met honderd hoofdstukken.
 * Dat werkte, maar het is er een van de zes dingen die Casper liet
 * repareren: "mijn testbestanden zijn te groot."
 *
 * De hoofdstukken staan nu per onderwerp in scripts/selftest/. Wat ze
 * allemaal nodig hebben staat hier, en het moet hier staan: de nagebootste
 * IndexedDB en de browservariabelen moeten klaarstaan vóór er ook maar iets
 * uit src/ wordt ingeladen. Elke module importeert dit bestand, dus dat is
 * vanzelf op tijd.
 *
 * De telling is met opzet niet per module. Eén eindstand, en die moet nul
 * mislukt zijn -- drie losse eindstanden zijn drie plekken waar je er een
 * kunt vergeten te lezen.
 */

// De app praat met Supabase; de mock is er alleen nog voor deze test.
process.env.TW_USE_MOCK = '1'

import 'fake-indexeddb/auto'

/* ---- browsertoestand nabootsen -------------------------------------- */

const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
}

let onLine = true
// navigator is in Node alleen-lezen: eigenschap vervangen i.p.v. toewijzen
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  get: () => ({ onLine }),
})

/** Doen alsof de verbinding weg is, of terug. */
export const setOnline = (v: boolean) => { onLine = v }

;(globalThis as any).window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
}

/* ---- test-hulpjes --------------------------------------------------- */

/**
 * De broncode zonder commentaar.
 *
 * Nodig bij elke controle van de vorm "deze tekst staat er niet meer".
 * Uitleg noemt namelijk juist wat er weg is -- dat is waar uitleg voor
 * dient -- en dan meet de controle het commentaar in plaats van de code.
 *
 * Dat is hier vijf keer gebeurd (groep 89, 95, 98, 100 en 102), elke keer
 * op een andere plek, en elke keer werd het ter plekke opgelost. Vijf keer
 * dezelfde fout is geen toeval maar een ontbrekend gereedschap.
 */
export function zonderCommentaar(bron: string): string {
  return bron
    .replace(/\/\*[\s\S]*?\*\//g, '')   // blokken
    .replace(/^[ \t]*\/\/.*$/gm, '')     // hele regels
}

/** Twee dingen die er hetzelfde uitzien als je ze opschrijft. */
export const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

let passed = 0
let failed = 0

export function check(name: string, ok: boolean, extra = '') {
  if (ok) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`)
  }
}

/** De eindstand, voor het slot van de test. */
export function telling(): { passed: number; failed: number } {
  return { passed, failed }
}

/* ---- wat bijna elk hoofdstuk nodig heeft ---------------------------- */

/*
 * De lokale database en de backend, één keer ingeladen.
 *
 * Ze stonden als losse regels boven in het oude bestand en werden door
 * hoofdstukken verderop gewoon gebruikt. Nu die hoofdstukken in eigen
 * bestanden staan, moeten ze ergens vandaan komen -- en hier is de plek waar
 * de nagebootste browser al klaarstaat, dus hier kan het veilig.
 */
export const { db } = await import('../../src/lib/db')
export const { api } = await import('../../src/lib/api')
