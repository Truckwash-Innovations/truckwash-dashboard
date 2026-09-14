/* ===========================================================================
 *  Een identiteitsbewijs of een contract laten voorlezen
 *
 *  Casper: "De ai, kan je die niet gebruiken bij inscannen arbeidsovereenkomst
 *  en id ect? gezien de ocr niet echt lekker werkt."
 *
 *  Dit staat naast de leesmotor in de app en niet in plaats daarvan. Die
 *  motor draait op het toestel zelf en is daarmee de enige weg waarbij er
 *  gegarandeerd geen foto weggaat; hij is alleen kieskeurig over de foto. Wat
 *  hier bijkomt is de tweede poging: lukt het daar niet, dan mag een model
 *  ernaar kijken.
 *
 *  Wat er uitkomt is een VOORSTEL
 *  ------------------------------
 *
 *  Net als bij de facturen. Alles wat eruit komt gaat langs dezelfde controles
 *  als wat een mens intikt -- het BSN door de elfproef, het IBAN door de
 *  mod-97, de MRZ door zijn eigen controlecijfers -- en daarna kijkt er een
 *  mens naar. Een verkeerd overgenomen BSN is erger dan een leeg veld: dat
 *  laatste valt op, het eerste niet.
 *
 *  Daarom staat in het prompt op drie plekken dat verzinnen erger is dan
 *  weglaten, en daarom is elk veld optioneel.
 *
 *  Waarom de MRZ apart wordt gevraagd
 *  ----------------------------------
 *
 *  De twee regels onderaan een paspoort dragen hun eigen controlecijfers. Een
 *  model dat de naam "verkeerd leest" merk je nooit; een MRZ die verkeerd is
 *  overgenomen valt om op zijn eigen som. Dus vragen we de regels letterlijk
 *  op, en rekent de app ze na met dezelfde code die de OCR-uitkomst narekent.
 *  Dat is de enige harde controle die we op deze lezing hebben.
 * =========================================================================== */

export const MODEL = 'claude-sonnet-5'

export type DocumentSoort = 'identiteitsbewijs' | 'arbeidsovereenkomst'

/* ------------------------------------------------------------------ *
 *  Wat we het model vragen
 * ------------------------------------------------------------------ */

const GEMEENSCHAPPELIJK = [
  'Je leest een ingescand document voor de personeelsadministratie van een',
  'Nederlands truckwash-bedrijf en geeft terug wat er letterlijk op staat.',
  '',
  'Regels die altijd gelden:',
  '- Neem over wat er staat. Reken niets uit, vul niets aan uit ervaring, en',
  '  verzin nooit een nummer of een datum om een veld te vullen.',
  '- Kun je een waarde niet met zekerheid lezen -- onscherp, afgesneden, een',
  '  vlek over een cijfer -- laat het veld dan WEG en zet in "twijfel" een',
  '  korte Nederlandse zin die zegt wat er aan de hand is.',
  '- Een leeg veld is goed. Een verkeerd gelezen nummer is dat niet: daar',
  '  kijkt niemand overheen, want het ziet er net zo uit als een goed nummer.',
  '- Datums als jjjj-mm-dd.',
  '- Antwoord met alleen JSON, zonder uitleg eromheen.',
]

const ID_PROMPT = [
  ...GEMEENSCHAPPELIJK,
  '',
  'Dit is een identiteitsbewijs: een Nederlandse identiteitskaart, een',
  'paspoort of een rijbewijs. Er kunnen twee foto\'s bij zitten (voorkant en',
  'achterkant); lees ze als één document.',
  '',
  '- "mrzRegels" zijn de machineleesbare regels onderaan: twee regels van 44',
  '  tekens bij een paspoort, drie regels van 30 bij een identiteitskaart. Neem',
  '  ze LETTERLIJK over, teken voor teken, inclusief de < tekens en zonder',
  '  spaties toe te voegen. Dit is het belangrijkste veld: die regels dragen',
  '  hun eigen controlecijfers, dus een leesfout komt eruit. Zie je ze niet of',
  '  niet volledig, geef dan een lege lijst -- een half overgenomen regel is',
  '  erger dan geen regel.',
  '- "bsn" is het burgerservicenummer: negen cijfers. Op een Nederlandse',
  '  identiteitskaart staat het op de ACHTERKANT, vaak met "BSN" of',
  '  "Persoonsnummer" ervoor. Op een rijbewijs staat het niet. Verwar het niet',
  '  met het documentnummer -- dat begint meestal met letters.',
  '- "documentnummer" is het nummer van het document zelf.',
  '- "soortDocument" is "identiteitskaart", "paspoort" of "rijbewijs".',
  '- "achternaam" en "voornamen" zoals ze op het document staan. Een tussen-',
  '  voegsel hoort bij de achternaam, zoals het document het ook schrijft.',
  '- "nationaliteit" voluit, bijvoorbeeld "Nederlandse".',
  '',
  'Antwoord met alleen JSON:',
  '',
  '{',
  '  "soortDocument": "identiteitskaart" | "paspoort" | "rijbewijs" | "onbekend",',
  '  "mrzRegels": ["string"],',
  '  "bsn": "string",',
  '  "documentnummer": "string",',
  '  "achternaam": "string",',
  '  "voornamen": "string",',
  '  "geboortedatum": "jjjj-mm-dd",',
  '  "geboorteplaats": "string",',
  '  "nationaliteit": "string",',
  '  "geslacht": "M" | "V" | "X",',
  '  "geldigTot": "jjjj-mm-dd",',
  '  "twijfel": ["string"]',
  '}',
].join('\n')

const CONTRACT_PROMPT = [
  ...GEMEENSCHAPPELIJK,
  '',
  'Dit is een arbeidsovereenkomst. Er kunnen meerdere pagina\'s bij zitten.',
  '',
  '- "werknemer" is de naam van de medewerker, niet die van de werkgever. De',
  '  werkgever is Truckwash 1 Group of een van zijn vennootschappen; die naam',
  '  hoort in "werkgever".',
  '- "soortContract" is "bepaalde tijd" of "onbepaalde tijd". Staat er een',
  '  einddatum, dan is het bepaalde tijd, ook als dat er niet bij staat.',
  '- "uren" is het aantal uren per week als getal. "Fulltime" zonder getal is',
  '  geen getal: laat het veld dan weg en meld het in "twijfel".',
  '- "uurloon" en "maandloon": neem over wat er staat, als getal met een punt',
  '  als decimaalteken. Staat er alleen een maandloon, laat "uurloon" dan weg',
  '  -- terugrekenen is precies het soort aanvullen dat hier niet mag.',
  '- "functie" zoals hij in het contract staat.',
  '- "proeftijd" is de tekst over de proeftijd, of laat weg als die er niet is.',
  '- "bsn" en "iban" alleen als ze er letterlijk staan.',
  '',
  'Antwoord met alleen JSON:',
  '',
  '{',
  '  "werknemer": "string",',
  '  "werkgever": "string",',
  '  "functie": "string",',
  '  "soortContract": "bepaalde tijd" | "onbepaalde tijd" | "onbekend",',
  '  "inDienst": "jjjj-mm-dd",',
  '  "uitDienst": "jjjj-mm-dd",',
  '  "uren": 0,',
  '  "uurloon": 0,',
  '  "maandloon": 0,',
  '  "proeftijd": "string",',
  '  "bsn": "string",',
  '  "iban": "string",',
  '  "twijfel": ["string"]',
  '}',
].join('\n')

export function systeemVoor(soort: DocumentSoort): string {
  return soort === 'identiteitsbewijs' ? ID_PROMPT : CONTRACT_PROMPT
}

/* ------------------------------------------------------------------ *
 *  Het schema
 *
 *  Voor Ollama, die een JSON-schema meekrijgt en zich eraan houdt. Claude
 *  krijgt hetzelfde als gereedschap.
 *
 *  Alles optioneel behalve "twijfel". Dat is geen slordigheid: een verplicht
 *  veld is een uitnodiging om iets te verzinnen, en dat is hier de duurste
 *  fout die er is.
 * ------------------------------------------------------------------ */

const TEKST = { type: 'string' }

export const ID_SCHEMA = {
  type: 'object',
  properties: {
    soortDocument: { type: 'string', enum: ['identiteitskaart', 'paspoort', 'rijbewijs', 'onbekend'] },
    mrzRegels: { type: 'array', items: TEKST },
    bsn: TEKST,
    documentnummer: TEKST,
    achternaam: TEKST,
    voornamen: TEKST,
    geboortedatum: TEKST,
    geboorteplaats: TEKST,
    nationaliteit: TEKST,
    geslacht: { type: 'string', enum: ['M', 'V', 'X'] },
    geldigTot: TEKST,
    twijfel: { type: 'array', items: TEKST },
  },
  required: ['twijfel'],
}

export const CONTRACT_SCHEMA = {
  type: 'object',
  properties: {
    werknemer: TEKST,
    werkgever: TEKST,
    functie: TEKST,
    soortContract: { type: 'string', enum: ['bepaalde tijd', 'onbepaalde tijd', 'onbekend'] },
    inDienst: TEKST,
    uitDienst: TEKST,
    uren: { type: 'number' },
    uurloon: { type: 'number' },
    maandloon: { type: 'number' },
    proeftijd: TEKST,
    bsn: TEKST,
    iban: TEKST,
    twijfel: { type: 'array', items: TEKST },
  },
  required: ['twijfel'],
}

export function schemaVoor(soort: DocumentSoort): unknown {
  return soort === 'identiteitsbewijs' ? ID_SCHEMA : CONTRACT_SCHEMA
}

/* ------------------------------------------------------------------ *
 *  Wat eruit komt
 * ------------------------------------------------------------------ */

export interface IdLezing {
  soortDocument?: string
  mrzRegels: string[]
  bsn?: string
  documentnummer?: string
  achternaam?: string
  voornamen?: string
  geboortedatum?: string
  geboorteplaats?: string
  nationaliteit?: string
  geslacht?: string
  geldigTot?: string
  twijfel: string[]
}

export interface ContractLezing {
  werknemer?: string
  werkgever?: string
  functie?: string
  soortContract?: string
  inDienst?: string
  uitDienst?: string
  uren?: number
  uurloon?: number
  maandloon?: number
  proeftijd?: string
  bsn?: string
  iban?: string
  twijfel: string[]
}

export type DocumentLezing = IdLezing | ContractLezing

/* ------------------------------------------------------------------ *
 *  Opschonen
 *
 *  Een model geeft soms een lege string waar het niets wist, soms "onbekend",
 *  soms "N/A". Dat zijn alledrie manieren om niets te zeggen, en ze horen als
 *  niets in de lezing te komen -- anders staat er straks "N/A" in het veld
 *  waar een BSN hoort.
 * ------------------------------------------------------------------ */

const NIETS = new Set(['', 'onbekend', 'n/a', 'na', 'null', 'none', 'geen', '-', '--', 'x'])

function tekst(waarde: unknown, max = 200): string | undefined {
  if (typeof waarde !== 'string') return undefined
  const schoon = waarde.trim()
  if (NIETS.has(schoon.toLowerCase())) return undefined
  return schoon.slice(0, max)
}

function getal(waarde: unknown): number | undefined {
  const n = typeof waarde === 'number' ? waarde : Number(String(waarde ?? '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function lijst(waarde: unknown, max = 10): string[] {
  if (!Array.isArray(waarde)) return []
  return waarde.map((r) => tekst(r, 120)).filter((r): r is string => !!r).slice(0, max)
}

export function opschonen(soort: DocumentSoort, ruw: unknown): DocumentLezing {
  const uit = (ruw ?? {}) as Record<string, unknown>
  const twijfel = lijst(uit.twijfel)

  if (soort === 'identiteitsbewijs') {
    return {
      soortDocument: tekst(uit.soortDocument, 30),
      /*
       * De MRZ zonder spaties. Modellen zetten er graag spaties tussen de
       * blokken; de controlecijfers rekenen over de tekens zelf, dus een
       * spatie erin laat elke som mislukken op iets wat geen leesfout is.
       */
      mrzRegels: lijst(uit.mrzRegels, 3).map((r) => r.replace(/\s+/g, '').toUpperCase()),
      bsn: tekst(uit.bsn, 20),
      documentnummer: tekst(uit.documentnummer, 30),
      achternaam: tekst(uit.achternaam, 100),
      voornamen: tekst(uit.voornamen, 120),
      geboortedatum: tekst(uit.geboortedatum, 10),
      geboorteplaats: tekst(uit.geboorteplaats, 80),
      nationaliteit: tekst(uit.nationaliteit, 50),
      geslacht: ['M', 'V', 'X'].includes(String(uit.geslacht)) ? String(uit.geslacht) : undefined,
      geldigTot: tekst(uit.geldigTot, 10),
      twijfel,
    }
  }

  return {
    werknemer: tekst(uit.werknemer, 120),
    werkgever: tekst(uit.werkgever, 120),
    functie: tekst(uit.functie, 120),
    soortContract: tekst(uit.soortContract, 30),
    inDienst: tekst(uit.inDienst, 10),
    uitDienst: tekst(uit.uitDienst, 10),
    uren: getal(uit.uren),
    uurloon: getal(uit.uurloon),
    maandloon: getal(uit.maandloon),
    proeftijd: tekst(uit.proeftijd, 300),
    bsn: tekst(uit.bsn, 20),
    iban: tekst(uit.iban, 40),
    twijfel,
  }
}

/* ------------------------------------------------------------------ *
 *  De JSON eruit halen
 *
 *  Een model zet er soms ```json omheen of een zin ervoor. Dezelfde
 *  behandeling als bij de facturen.
 * ------------------------------------------------------------------ */

export function jsonUit(tekst: string): unknown {
  const zonderHek = tekst.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
  try {
    return JSON.parse(zonderHek)
  } catch {
    const begin = zonderHek.indexOf('{')
    const eind = zonderHek.lastIndexOf('}')
    if (begin < 0 || eind <= begin) return null
    try {
      return JSON.parse(zonderHek.slice(begin, eind + 1))
    } catch {
      return null
    }
  }
}
