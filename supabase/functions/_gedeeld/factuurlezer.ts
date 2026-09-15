/* ===========================================================================
 *  De factuurlezer
 *
 *  Dit stuk zat eerst helemaal in de functie factuur-lezen, en dat werkte
 *  prima zolang er een mens op een knop drukte. Zodra de post het ook zelf
 *  moest kunnen liep het vast op iets banaals: factuur-lezen wil een
 *  ingelogde gebruiker zien, en een webhook van Resend is niemand.
 *
 *  De uitweg was niet om die controle te verzwakken. Wie die functie kan
 *  aanroepen kan er willekeurige bestanden doorheen halen, en dan is het een
 *  gratis taalmodel voor de hele wereld. Dus staat het lezen nu hier, los van
 *  de vraag wie het vraagt:
 *
 *    factuur-lezen   een mens drukt op de knop -- eerst inloggen, dan lezen
 *    ontvang-mail    er komt post binnen      -- geen mens, dus geen token
 *    lezer           de pc thuis leest met Ollama en valt zo nodig terug op
 *                    Claude; gebruikt SYSTEEM, LEZING_SCHEMA en opschonen()
 *                    zodat de uitkomst dezelfde is (0049)
 *
 *  Alle drie komen ze hier. Geen tweede kopie van de aanwijzingen aan het
 *  model, en geen verzoek van de ene functie naar de andere waarbij onderweg
 *  bedacht moet worden hoe die zich legitimeert.
 *
 *  Wat hier met opzet NIET gebeurt: goedkeuren, boeken of velden overschrijven
 *  die een mens heeft ingevuld. Er komt een lezing uit. Wat daarmee gebeurt is
 *  aan de beller.
 * =========================================================================== */

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

export const MODEL = 'claude-sonnet-5'
const EMMER = 'post'

/** Ruim boven een gewone factuur, ruim onder wat de API aankan. */
const MAX_BESTAND = 12 * 1024 * 1024

const nu = () => Date.now()

/* ------------------------------------------------------------------ *
 *  Niet opgeven bij een hik
 *
 *  Casper: "de ai lukt het steeds vaker niet, hij pakt de pdf facturen
 *  steeds niet."
 *
 *  Hier stond geen enkele herkansing. Eén hik -- de leesdienst even druk,
 *  een verbinding die wegviel -- en de factuur bleef ongelezen liggen. Bij
 *  een handmatige poging zie je dat en druk je nog eens; bij de post zag
 *  niemand het, want daar ging de reden in een logregel die nooit iemand
 *  opent.
 *
 *  Welke statussen tijdelijk zijn staat niet op gevoel maar in de
 *  documentatie van de API (platform.claude.com/docs/en/api/errors):
 *
 *    429  te veel verzoeken        de retry-after kop zegt hoe lang
 *    500  fout aan hun kant        "retry with exponential backoff"
 *    502/503/504                   onderweg blijven steken
 *    529  overbelast               tijdelijk te druk
 *
 *  En wat NIET tijdelijk is: 400 (het stuk deugt niet), 413 (te groot, meer
 *  dan 32 MB), 401/403 (de sleutel). Die blijven morgen ook fout, en dan is
 *  het opnieuw proberen alleen geld en wachttijd.
 * ------------------------------------------------------------------ */

const OPNIEUW_BIJ = [429, 500, 502, 503, 504, 529]
const POGINGEN = 3
/* Een minuut per poging. Langer heeft geen zin: de functie zelf heeft ook
   een bovengrens, en drie keer vastlopen kost dan meer dan het oplevert. */
const GEDULD_MS = 60_000

const wacht = (ms: number) => new Promise((klaar) => setTimeout(klaar, ms))

/**
 * Hoe lang wachten voor de volgende poging.
 *
 * De kop retry-after gaat voor: die komt van de dienst zelf en weet meer dan
 * wij. Staat hij er niet, dan verdubbelend vanaf een seconde, met een beetje
 * ruis erop -- anders komen twee facturen die tegelijk binnenkwamen ook weer
 * precies tegelijk terug, en dan lopen ze samen opnieuw tegen dezelfde muur.
 */
function hoelangWachten(res: Response | null, poging: number): number {
  const kop = res?.headers.get('retry-after')
  const seconden = kop ? Number(kop) : NaN
  if (Number.isFinite(seconden) && seconden > 0) {
    return Math.min(seconden * 1000, 30_000)
  }
  return Math.min(1000 * 2 ** (poging - 1), 8000) + Math.floor(Math.random() * 400)
}

interface Mislukking {
  reden: string
  tijdelijk: boolean
  /** Het antwoord zelf, alleen om er retry-after uit te kunnen lezen. */
  res: Response | null
}

/**
 * Wat een status betekent, in een zin die een mens iets zegt.
 *
 * Dit stond er eerst niet: alles behalve een bestandstypefout werd "De
 * leesdienst gaf geen antwoord. Probeer het straks nog eens." Daarmee zag
 * een te grote bijlage er precies hetzelfde uit als een drukke dienst en een
 * verlopen sleutel, en die drie vragen om iets heel anders.
 */
function duidingVan(status: number, detail: string): Mislukking {
  const tijdelijk = OPNIEUW_BIJ.includes(status)

  if (status === 413 || /request_too_large/i.test(detail)) {
    return {
      res: null, tijdelijk: false,
      reden: 'Deze bijlage is te groot voor de leesdienst (meer dan 32 MB in '
           + 'één verzoek). Stuur een kleiner bestand of een foto.',
    }
  }
  if (status === 401 || status === 403) {
    return {
      res: null, tijdelijk: false,
      reden: 'De leesdienst weigert de sleutel (ANTHROPIC_API_KEY). Die is '
           + 'verlopen of ingetrokken; zonder nieuwe sleutel wordt er niets '
           + 'meer gelezen.',
    }
  }
  if (status === 402) {
    return {
      res: null, tijdelijk: false,
      reden: 'De leesdienst meldt een betalingsprobleem op het account. Tot '
           + 'dat is opgelost wordt er niets gelezen.',
    }
  }
  if (status === 400 && /media_type|document|encrypted|password/i.test(detail)) {
    return {
      res: null, tijdelijk: false,
      reden: 'Dit bestand kan niet worden gelezen. Een PDF met een wachtwoord '
           + 'of een onbekend bestandstype gaat niet; PDF en foto’s wel.',
    }
  }
  if (status === 400) {
    return {
      res: null, tijdelijk: false,
      reden: 'De leesdienst wees het stuk af. Vaak is het te lang '
           + '(meer dan honderd bladzijden) of geen gewone PDF.',
    }
  }
  if (status === 429) {
    return {
      res: null, tijdelijk: true,
      reden: 'Er zijn te veel facturen tegelijk aangeboden; de leesdienst '
           + 'houdt even de rem erop.',
    }
  }
  if (status === 529) {
    return { res: null, tijdelijk: true, reden: 'De leesdienst is overbelast.' }
  }

  return {
    res: null,
    tijdelijk,
    reden: `De leesdienst gaf ${status} terug.`,
  }
}

/* ------------------------------------------------------------------ *
 *  Het bestand
 * ------------------------------------------------------------------ */

const PDF = 'application/pdf'
const PLAATJES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

function soortVan(naam: string, mime?: string | null): string {
  if (mime && (mime === PDF || PLAATJES.includes(mime))) return mime
  const ext = (naam.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  if (ext === 'pdf') return PDF
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/jpeg'
}

/** Bytes naar base64, in stukken -- in een keer loopt de stack over. */
function naarBase64(bytes: Uint8Array): string {
  let ruw = ''
  const stap = 0x8000
  for (let i = 0; i < bytes.length; i += stap) {
    ruw += String.fromCharCode(...bytes.subarray(i, i + stap))
  }
  return btoa(ruw)
}

/* ------------------------------------------------------------------ *
 *  Wat we het model vragen
 * ------------------------------------------------------------------ */

export const SYSTEEM = [
  'Je leest een factuur of kassabon die per mail is binnengekomen bij een',
  'Nederlands truckwash-bedrijf, en geeft terug wat er letterlijk op staat.',
  '',
  'Regels:',
  '- Neem over wat er staat. Reken niets uit dat er niet staat, en vul niets',
  '  aan uit ervaring. Staat er geen factuurnummer, laat het veld dan weg.',
  '- Bedragen als getal, met een punt als decimaalteken, zonder valutateken.',
  '  Een Nederlands bedrag van 1.234,56 wordt 1234.56.',
  '- Een getal dat niet op het stuk staat is null, niet 0. Een 0 betekent dat',
  '  er letterlijk nul staat (0% btw, een gratis regel). Staat er per regel',
  '  geen btw-percentage, dan is "btwPct" null; staat er geen btw-bedrag, dan',
  '  is "btwBedrag" null.',
  '- Datums als jjjj-mm-dd.',
  '- Twijfel je over een waarde -- onscherpe scan, doorgehaald bedrag, twee',
  '  bedragen die elkaar tegenspreken -- zet die waarde er dan NIET in, en zet',
  '  in "twijfel" een korte Nederlandse zin die uitlegt wat er aan de hand is.',
  '- Tellen de regels niet op tot het subtotaal, meld dat in "twijfel". Pas de',
  '  getallen niet aan om het kloppend te maken.',
  '- Is dit geen factuur of bon maar bijvoorbeeld een pakbon of een aanmaning,',
  '  zet dat in "soort" en geef terug wat je wel ziet.',
  '- "richting" zegt wie hier aan wie factureert. Het bedrijf dat dit leest',
  '  heet Truckwash 1 Group, met vestigingen die "Truckwash" in de naam hebben',
  '  (Truckwash Oss, Truckwash 1 Utrecht, enzovoort).',
  '    "inkoop":  Truckwash staat als ontvanger op het stuk -- bij "aan",',
  '               "factuuradres", "klant" of "t.a.v." -- en een ANDER bedrijf',
  '               staat als afzender bovenaan, met zijn eigen KvK- en',
  '               btw-nummer, IBAN en logo. Dan is dit een rekening die',
  '               Truckwash moet betalen.',
  '    "verkoop": Truckwash staat zelf als afzender bovenaan, met KvK, btw-',
  '               nummer en IBAN van Truckwash, en een ander bedrijf staat als',
  '               klant. Dan is dit een rekening die Truckwash zelf heeft',
  '               gestuurd en die iemand heeft doorgestuurd.',
  '    "onbekend": je kunt het niet met zekerheid zeggen, bijvoorbeeld omdat',
  '               er geen namen op staan of Truckwash nergens voorkomt.',
  '  Kijk naar wie het stuk heeft opgemaakt, niet naar wie de mail stuurde.',
  '  Zeg alleen "verkoop" als Truckwash zelf het stuk heeft opgemaakt. Een',
  '  stempel of aantekening "ontvangen" van Truckwash maakt Truckwash niet de',
  '  afzender. Een ander bedrijf met "Truckwash" in de naam dat niet Truckwash',
  '  1 Group of een van zijn vestigingen is (een buitenlandse wasserij, een',
  '  leverancier van wasinstallaties) is een ander bedrijf: dan "inkoop". Een',
  '  creditnota van een leverancier aan Truckwash is ook "inkoop". Twijfel je,',
  '  dan "onbekend" -- dat is nooit fout.',
  '  "leverancier" is altijd de afzender op het stuk, ook bij verkoop.',
  '- "kenmerk" is de korte omschrijving waar deze factuur over gaat, zoals je',
  '  hem zelf in een boekhouding zou zetten: "elektra maart", "afvalcontainer",',
  '  "osmosefilters". Niet de bedrijfsnaam en niet het factuurnummer.',
  '- "geadresseerde" is AAN WELKE VENNOOTSCHAP deze factuur gericht is. Dat is',
  '  iets anders dan de leverancier: de leverancier stuurt hem, de',
  '  geadresseerde moet hem betalen. Je vindt hem bij "aan", "factuuradres",',
  '  "t.a.v.", "debiteur" of in het adresblok bovenaan.',
  '  Dit is belangrijk. Truckwash 1 Group bestaat uit ruim twintig besloten',
  '  vennootschappen -- een per vestiging (Truckwash 1 Asten B.V., Truckwash 1',
  '  Venlo B.V.) plus een aantal die geen vestiging zijn (Truckwash 1 Group',
  '  B.V., Truckwash 1 Vastgoed B.V., Truckwash 1 Techniek & Beheer B.V.,',
  '  Truckshop 1 B.V., Truckstop 8 B.V.). Elk daarvan heeft een eigen',
  '  boekhouding, en een factuur die in de verkeerde terechtkomt staat in de',
  '  jaarrekening van de verkeerde vennootschap.',
  '  Neem de naam over zoals hij op het stuk staat, volledig en met de',
  '  rechtsvorm erbij als die er staat. Verzin niets: staat er alleen',
  '  "Truckwash" zonder meer, geef dan "Truckwash" en niet de vestiging waarvan',
  '  je denkt dat het die zal zijn.',
  '  Staat er geen ontvanger op, laat het veld dan weg.',
  '- "geadresseerdeKvk" en "geadresseerdeBtw" zijn het KvK- en btw-nummer van',
  '  die geadresseerde, als ze op het stuk staan. Let op wiens nummer je pakt:',
  '  bovenaan staan die van de LEVERANCIER, en die horen in "kvk" en',
  '  "btwNummer". Alleen een nummer dat bij het ontvangstadres staat is van de',
  '  geadresseerde. Twijfel je bij wie een nummer hoort, laat het dan weg --',
  '  een verkeerd nummer hier boekt de factuur bij de verkeerde vennootschap.',
  '',
  'Antwoord met alleen JSON, zonder uitleg eromheen:',
  '',
  '{',
  '  "soort": "factuur" | "bon" | "pakbon" | "aanmaning" | "onbekend",',
  '  "richting": "inkoop" | "verkoop" | "onbekend",',
  '  "leverancier": "string",',
  '  "factuurnummer": "string",',
  '  "datum": "jjjj-mm-dd",',
  '  "vervaldatum": "jjjj-mm-dd",',
  '  "iban": "string",',
  '  "betalingskenmerk": "string",',
  '  "btwNummer": "string",',
  '  "kvk": "string",',
  '  "geadresseerde": "string",',
  '  "geadresseerdeKvk": "string",',
  '  "geadresseerdeBtw": "string",',
  '  "valuta": "EUR",',
  '  "kenmerk": "string",',
  '  "regels": [',
  '    { "omschrijving": "string", "aantal": 0, "eenheid": "string",',
  '      "stukprijs": 0, "btwPct": 0, "bedragExcl": 0 }',
  '  ],',
  '  "subtotaalExcl": 0,',
  '  "btwBedrag": 0,',
  '  "totaalIncl": 0,',
  '  "voorstelCategorie": "materiaal" | "energie" | "onderhoud" | "personeel" | "transport" | "overig",',
  '  "twijfel": ["string"]',
  '}',
].join('\n')

/*
 * Hetzelfde antwoord, maar als JSON-schema.
 *
 * Claude krijgt de vorm hierboven als tekst en houdt zich eraan. Een lokaal
 * model via Ollama krijgt dit schema als "format" mee, en dan kán het niet
 * anders antwoorden. Uit de proef op de eigen pc bleek één ding doorslaggevend:
 * velden die niet als verplicht staan laat het model weg, ook als ze op de
 * factuur staan. Daarom is hier bijna alles verplicht.
 *
 * Verplicht betekent wel dat het model áltijd iets moet geven, ook als het
 * er niet staat. Voor tekst is dat een lege tekst en die maakt opschonen()
 * undefined, net als een weggelaten veld. Voor getallen lag daar een val: een
 * verplicht getal zonder waarde werd 0, en 0 is een echte waarde. Een
 * kassabon zonder btw per regel kreeg zo btwPct 0 op elke regel en btwBedrag
 * 0, en verwerkLezing schreef dan 0% en 0,00 btw op de bon -- waar Claude,
 * die de velden gewoon weglaat, 21% afleidt uit btw en subtotaal. Precies het
 * verschil dat er niet mag zijn. Daarom mag elk getal hier ook null zijn,
 * zegt SYSTEEM dat onbekend null is en niet 0, en maakt getal() van null
 * undefined.
 *
 * De velden en hun betekenis staan in SYSTEEM; verander je daar iets, dan
 * hier ook. De server is de enige plek waar dit staat -- het lokale programma
 * haalt prompt en schema bij elke ronde hier op.
 */
const GETAL_OF_NIETS = { type: ['number', 'null'] }

export const LEZING_SCHEMA = {
  type: 'object',
  properties: {
    soort: { type: 'string', enum: ['factuur', 'bon', 'pakbon', 'aanmaning', 'onbekend'] },
    richting: { type: 'string', enum: ['inkoop', 'verkoop', 'onbekend'] },
    leverancier: { type: 'string' },
    factuurnummer: { type: 'string' },
    datum: { type: 'string' },
    vervaldatum: { type: 'string' },
    iban: { type: 'string' },
    betalingskenmerk: { type: 'string' },
    btwNummer: { type: 'string' },
    kvk: { type: 'string' },
    geadresseerde: { type: 'string' },
    geadresseerdeKvk: { type: 'string' },
    geadresseerdeBtw: { type: 'string' },
    valuta: { type: 'string' },
    kenmerk: { type: 'string' },
    regels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          omschrijving: { type: 'string' },
          aantal: GETAL_OF_NIETS,
          eenheid: { type: 'string' },
          stukprijs: GETAL_OF_NIETS,
          btwPct: GETAL_OF_NIETS,
          bedragExcl: GETAL_OF_NIETS,
        },
        required: ['omschrijving', 'aantal', 'eenheid', 'stukprijs', 'btwPct', 'bedragExcl'],
      },
    },
    subtotaalExcl: GETAL_OF_NIETS,
    btwBedrag: GETAL_OF_NIETS,
    totaalIncl: GETAL_OF_NIETS,
    voorstelCategorie: {
      type: 'string',
      enum: ['materiaal', 'energie', 'onderhoud', 'personeel', 'transport', 'overig'],
    },
    twijfel: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'soort', 'richting', 'leverancier', 'factuurnummer', 'datum', 'vervaldatum',
    'iban', 'btwNummer', 'kvk', 'kenmerk', 'regels', 'subtotaalExcl', 'btwBedrag',
    'totaalIncl', 'voorstelCategorie', 'twijfel',
    /*
     * De geadresseerde staat er met opzet bij.
     *
     * Zie de uitleg boven dit schema: wat niet verplicht is laat een lokaal
     * model weg, ook als het op de factuur staat. En juist dit veld moet er
     * zijn, want zonder de geadresseerde valt de boeking terug op de
     * vestiging van het mailadres -- en dat is precies wat 0079 repareert.
     * Staat er niets op het stuk, dan komt er een lege tekst uit en maakt
     * opschonen() daar undefined van; dat is hetzelfde als weggelaten.
     */
    'geadresseerde', 'geadresseerdeKvk', 'geadresseerdeBtw',
  ],
}

function leesJson(ruw: string): Record<string, unknown> | null {
  const hek = String.fromCharCode(96, 96, 96)
  let schoon = ruw.trim()
  if (schoon.startsWith(hek)) schoon = schoon.slice(hek.length).replace(/^json/i, '').trim()
  if (schoon.endsWith(hek)) schoon = schoon.slice(0, -hek.length).trim()
  try {
    return JSON.parse(schoon)
  } catch {
    const eerste = schoon.indexOf('{')
    const laatste = schoon.lastIndexOf('}')
    if (eerste < 0 || laatste <= eerste) return null
    try {
      return JSON.parse(schoon.slice(eerste, laatste + 1))
    } catch {
      return null
    }
  }
}

/** "2025-09-01" naar epoch ms; alles anders naar niets. */
function datum(waarde: unknown): number | undefined {
  if (typeof waarde !== 'string') return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(waarde.trim())
  if (!m) return undefined
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(t) ? t : undefined
}

/**
 * Een getal, of niets. Alleen een echt getal of een tekst met een getal erin
 * telt. null en een lege tekst zijn "niet op het stuk" en worden undefined --
 * niet 0, want Number(null) en Number('') zijn allebei 0, en een 0 die er niet
 * stond wordt verderop een btw-tarief van 0%.
 */
function getal(waarde: unknown): number | undefined {
  if (typeof waarde === 'number') return Number.isFinite(waarde) ? waarde : undefined
  if (typeof waarde !== 'string' || !waarde.trim()) return undefined
  const n = Number(waarde.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

/**
 * Wat een model invult als het een verplicht tekstveld niet kan vullen. Claude
 * laat het veld weg; gemma schrijft met het afgedwongen schema soms letterlijk
 * "null" of "onbekend" (gezien bij de eenheid van een regel). Dat is geen
 * waarde van het stuk en hoort dus ook niet in de lezing.
 */
const NIETS_GEZEGD = new Set(['null', 'none', 'onbekend', 'n/a', 'n.v.t.', 'nvt', '-', '--'])

function tekst(waarde: unknown, max = 200): string | undefined {
  if (typeof waarde !== 'string') return undefined
  const schoon = waarde.trim().slice(0, max)
  if (!schoon || NIETS_GEZEGD.has(schoon.toLowerCase())) return undefined
  return schoon
}

const CATEGORIEEN = ['materiaal', 'energie', 'onderhoud', 'personeel', 'transport', 'overig']

export interface Lezing {
  soort: string
  /**
   * Wie factureert hier aan wie. "inkoop" is een rekening aan Truckwash,
   * "verkoop" een rekening ván Truckwash die iemand heeft doorgestuurd.
   *
   * Dit veld bestaat omdat alles wat met een PDF binnenkwam een kostenpost
   * werd -- ook een factuur die Truckwash zelf aan een klant had gestuurd.
   * Die stond dan aan de kostenkant, en niemand zag het.
   */
  richting: 'inkoop' | 'verkoop' | 'onbekend'
  leverancier?: string
  factuurnummer?: string
  datum?: number
  vervaldatum?: number
  iban?: string
  betalingskenmerk?: string
  btwNummer?: string
  kvk?: string
  /**
   * Aan welke vennootschap de factuur gericht is, letterlijk van het stuk.
   *
   * Niet te verwarren met leverancier: die stuurt hem, deze moet hem betalen.
   * Truckwash 1 Group telt ruim twintig bv's met elk een eigen boekhouding, en
   * tot 0079 werd de bv afgeleid uit het mailadres waarop de factuur
   * binnenkwam. Dat klopt voor een vestiging en niet voor Vastgoed, Techniek
   * & Beheer of de holding -- die hebben geen eigen inkoopadres.
   */
  geadresseerde?: string
  geadresseerdeKvk?: string
  geadresseerdeBtw?: string
  valuta: string
  kenmerk?: string
  regels: Record<string, unknown>[]
  subtotaalExcl?: number
  btwBedrag?: number
  totaalIncl?: number
  voorstelCategorie?: string
  twijfel: string[]
  gelezenOp: number
  gelezenDoor: string
  gemarkeerd?: string
  model: string
  bestand: string
}

export interface Uitkomst {
  ok: boolean
  lezing?: Lezing
  reden?: string
  bewaard?: boolean
  /**
   * Lag het aan het moment en niet aan het stuk?
   *
   * Een factuur die te groot is blijft morgen te groot; een factuur die niet
   * gelezen werd omdat de leesdienst het even druk had, is morgen gewoon te
   * lezen. Dat verschil bepaalt of het zin heeft om het nog eens te proberen,
   * en dus of dit een probleem van de bon is of van de dag.
   */
  tijdelijk?: boolean
}

/* ------------------------------------------------------------------ *
 *  Welke bijlage
 *
 *  Los van het lezen, omdat de functie lezer dezelfde keuze moet maken voor
 *  de pc thuis: die krijgt een lijst met bijlagen en moet dezelfde pakken die
 *  Claude hier gepakt zou hebben. Anders leest de ene lezer de factuur en de
 *  andere het logo uit de handtekening.
 * ------------------------------------------------------------------ */

export interface Kandidaat {
  pad: string
  naam: string
  mime?: string
  /** De reden waarom de bijlagecontrole dit bestand tegenhield, als dat zo was. */
  gemarkeerd?: string
}

/**
 * De bijlagen die bij een kostenpost horen: eerst de aangewezen bijlage
 * (attachment_path), dan alles wat bij het mailbox-bericht zat.
 */
// deno-lint-ignore no-explicit-any
export async function bijlagenVan(admin: any, bon: {
  attachment_path?: string | null
  attachment_name?: string | null
  mailbox_id?: string | null
}): Promise<Kandidaat[]> {
  const kandidaten: Kandidaat[] = []

  if (bon.attachment_path) {
    kandidaten.push({
      pad: String(bon.attachment_path),
      naam: String(bon.attachment_name ?? 'bijlage'),
    })
  }

  if (bon.mailbox_id) {
    const { data: post } = await admin
      .from('mailbox')
      .select('attachments')
      .eq('id', bon.mailbox_id)
      .maybeSingle()

    for (const b of (post?.attachments ?? []) as Record<string, unknown>[]) {
      if (!b?.path) continue

      /*
       * Een tegengehouden bijlage wordt hier wel gelezen, en dat is met opzet.
       *
       * Hier stond dat alles wat niet 'schoon' was werd overgeslagen. Gevolg:
       * een factuur die de bijlagecontrole niet aanstond werd niet getoond en
       * niet gelezen -- dubbel niets, terwijl juist zo'n bon aandacht vraagt.
       *
       * Lezen is ook iets anders dan openen. De bytes gaan naar een API en
       * komen terug als tekst; er wordt niets uitgevoerd, niets geopend en
       * niets opgeslagen. Het risico van actieve inhoud in een PDF zit in de
       * lezer op iemands bureau, niet hier.
       */
      kandidaten.push({
        pad: String(b.path),
        naam: String(b.naam ?? 'bijlage'),
        mime: b.mime ? String(b.mime) : undefined,
        gemarkeerd: b.controle && b.controle !== 'schoon'
          ? String(b.controleReden ?? 'De bijlagecontrole hield dit bestand tegen.')
          : undefined,
      })
    }
  }

  return kandidaten
}

/**
 * Zonder aanwijzing niet zomaar de eerste bijlage.
 *
 * Bij mail met een logo in de handtekening staat er een plaatje voor de
 * factuur, en dan werd er een bedrijfslogo gelezen terwijl de PDF eronder
 * bleef liggen. Een PDF gaat daarom voor.
 */
export function kiesBijlage(kandidaten: Kandidaat[]): Kandidaat | undefined {
  return kandidaten.find((k) => soortVan(k.naam, k.mime) === PDF) ?? kandidaten[0]
}

/* ------------------------------------------------------------------ *
 *  Opschonen
 *
 *  Alles wat uit een model terugkomt gaat langs dit filter. Niet omdat het
 *  model kwaad wil, maar omdat een tekstveld dat rechtstreeks in de database
 *  landt vroeg of laat iets bevat waar niemand op rekende.
 *
 *  Het staat los van leesFactuur omdat de lokale lezer (Ollama op de pc van
 *  Casper) het ruwe antwoord van zijn model naar de server stuurt en de
 *  server het hier doorheen haalt. Zo is de lezing die in de database landt
 *  op precies dezelfde manier schoongemaakt, wie er ook las.
 * ------------------------------------------------------------------ */

export function opschonen(
  uit: Record<string, unknown>,
  meta: { doorWie: string; bestand: string; model: string; gemarkeerd?: string },
): Lezing {
  const regels = Array.isArray(uit.regels)
    ? (uit.regels as Record<string, unknown>[]).slice(0, 100).map((r) => ({
        omschrijving: tekst(r.omschrijving, 300) ?? '',
        aantal: getal(r.aantal),
        eenheid: tekst(r.eenheid, 20),
        stukprijs: getal(r.stukprijs),
        btwPct: getal(r.btwPct),
        bedragExcl: getal(r.bedragExcl),
      })).filter((r) => r.omschrijving)
    : []

  const twijfel = Array.isArray(uit.twijfel)
    ? (uit.twijfel as unknown[]).slice(0, 10)
        .map((t) => tekst(t, 300)).filter(Boolean) as string[]
    : []

  const voorstel = tekst(uit.voorstelCategorie, 20)

  const lezing: Lezing = {
    soort: ['factuur', 'bon', 'pakbon', 'aanmaning', 'onbekend']
      .includes(String(uit.soort)) ? String(uit.soort) : 'onbekend',
    // Alleen de drie waarden die de beller kent. Alles anders is "onbekend",
    // en onbekend wordt gewoon een kostenpost -- zoals het altijd al ging.
    richting: uit.richting === 'inkoop' || uit.richting === 'verkoop'
      ? uit.richting : 'onbekend',
    leverancier: tekst(uit.leverancier),
    factuurnummer: tekst(uit.factuurnummer, 60),
    datum: datum(uit.datum),
    vervaldatum: datum(uit.vervaldatum),
    iban: tekst(uit.iban, 40),
    betalingskenmerk: tekst(uit.betalingskenmerk, 60),
    btwNummer: tekst(uit.btwNummer, 30),
    kvk: tekst(uit.kvk, 20),
    geadresseerde: tekst(uit.geadresseerde, 200),
    geadresseerdeKvk: tekst(uit.geadresseerdeKvk, 20),
    geadresseerdeBtw: tekst(uit.geadresseerdeBtw, 30),
    valuta: tekst(uit.valuta, 8) ?? 'EUR',
    kenmerk: tekst(uit.kenmerk, 200),
    regels,
    subtotaalExcl: getal(uit.subtotaalExcl),
    btwBedrag: getal(uit.btwBedrag),
    totaalIncl: getal(uit.totaalIncl),
    voorstelCategorie: voorstel && CATEGORIEEN.includes(voorstel) ? voorstel : undefined,
    twijfel,
    gelezenOp: nu(),
    gelezenDoor: meta.doorWie,
    gemarkeerd: meta.gemarkeerd,
    model: meta.model,
    bestand: meta.bestand,
  }

  /*
   * Nog een controle die het model zelf niet doet: telt subtotaal plus btw op
   * tot het totaal? Zo niet, dan is er iets overgeslagen -- een kortingsregel,
   * statiegeld, verzendkosten -- en dat hoort de beoordelaar te weten.
   */
  const som = (lezing.subtotaalExcl ?? 0) + (lezing.btwBedrag ?? 0)
  if (lezing.subtotaalExcl != null && lezing.btwBedrag != null
      && lezing.totaalIncl != null && Math.abs(som - lezing.totaalIncl) > 0.02) {
    lezing.twijfel.push(
      `Subtotaal plus btw is ${som.toFixed(2)}, maar er staat ${lezing.totaalIncl.toFixed(2)} ` +
      'als totaal. Er zit iets tussen dat hier niet in staat.')
  }

  return lezing
}

/* ------------------------------------------------------------------ *
 *  Lezen
 * ------------------------------------------------------------------ */

/**
 * Leest de bijlage bij een kostenpost en zet de uitkomst in het veld gelezen.
 *
 * doorWie komt in de lezing te staan, zodat later te zien is of een mens
 * hierom vroeg of dat de post het uit zichzelf deed.
 */
// deno-lint-ignore no-explicit-any
export async function leesFactuur(opties: {
  admin: any
  expenseId: string
  pad?: string
  doorWie: string
}): Promise<Uitkomst> {
  const { admin, expenseId, doorWie } = opties

  if (!ANTHROPIC_KEY) {
    return {
      ok: false,
      tijdelijk: false,
      reden: 'De leesdienst is nog niet ingesteld. Zet ANTHROPIC_API_KEY als ' +
             'geheim bij de functies.',
    }
  }

  const { data: bon } = await admin
    .from('expenses')
    .select('id, supplier, attachment_path, attachment_name, mailbox_id')
    .eq('id', expenseId)
    .maybeSingle()

  if (!bon) return { ok: false, reden: 'Kostenpost niet gevonden' }

  /*
   * Welk bestand. De beller mag er een aanwijzen als er meer bijlagen bij de
   * mail zaten, maar alleen uit de bijlagen die bij deze bon horen -- niet
   * een willekeurig pad uit de emmer.
   */
  const gevraagd = tekst(opties.pad, 400)
  const kandidaten = await bijlagenVan(admin, bon)

  /* Zonder aanwijzing kiest kiesBijlage(): een PDF gaat voor een plaatje. */
  const gekozen = gevraagd
    ? kandidaten.find((k) => k.pad === gevraagd)
    : kiesBijlage(kandidaten)

  if (!gekozen) {
    return {
      ok: false,
      tijdelijk: false,
      reden: gevraagd
        ? 'Dat bestand hoort niet bij deze kostenpost.'
        : 'Bij deze kostenpost zit geen bijlage om te lezen.',
    }
  }

  /* ---- ophalen ---- */

  const { data: bestand, error: haalFout } = await admin.storage.from(EMMER).download(gekozen.pad)
  if (haalFout || !bestand) {
    return { ok: false, tijdelijk: true, reden: 'De bijlage is niet op te halen.' }
  }
  if (bestand.size > MAX_BESTAND) {
    return {
      ok: false,
      tijdelijk: false,
      reden: `Deze bijlage is ${Math.round(bestand.size / 1024 / 1024)} MB en dat is ` +
             'te groot om te laten lezen. Stuur een kleiner bestand of een foto ' +
             'van de factuur.',
    }
  }

  const soort = soortVan(gekozen.naam, gekozen.mime ?? bestand.type)
  const b64 = naarBase64(new Uint8Array(await bestand.arrayBuffer()))

  const blok = soort === PDF
    ? { type: 'document', source: { type: 'base64', media_type: PDF, data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: soort, data: b64 } }

  /* ---- lezen ---- */

  const verzoek = JSON.stringify({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEEM,
    messages: [{
      role: 'user',
      content: [
        blok,
        { type: 'text', text: 'Lees dit stuk en geef de JSON terug.' },
      ],
    }],
  })

  let uit: Record<string, unknown> | null = null
  let gelukt = false
  let mis: Mislukking = {
    reden: 'De leesdienst gaf geen antwoord.', tijdelijk: true, res: null,
  }

  for (let poging = 1; poging <= POGINGEN; poging++) {
    if (poging > 1) {
      const pauze = hoelangWachten(mis.res, poging - 1)
      console.log(
        `[factuurlezer] ${expenseId} poging ${poging} van ${POGINGEN} over ${pauze} ms ` +
        `(${mis.reden})`)
      await wacht(pauze)
    }

    /*
     * Een eigen tijdslimiet. Zonder deze kan een verbinding die blijft hangen
     * de hele functie opeten, en dan valt de worker om (546) in plaats van
     * dat er een nette reden uit komt.
     */
    const stop = new AbortController()
    const wekker = setTimeout(() => stop.abort(), GEDULD_MS)

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: stop.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: verzoek,
      })

      if (!res.ok) {
        const detail = await res.text()
        console.error(`[factuurlezer] Anthropic gaf ${res.status}: ${detail}`)
        mis = { ...duidingVan(res.status, detail), res }
        /* Blijvend? Dan is nog een poging alleen wachttijd en geld. */
        if (!mis.tijdelijk) return { ok: false, reden: mis.reden, tijdelijk: false }
        continue
      }

      const antwoord = await res.json()
      const platte = (antwoord?.content ?? [])
        .filter((c: { type?: string }) => c?.type === 'text')
        .map((c: { text?: string }) => c.text ?? '')
        .join('')
      uit = leesJson(platte)
      gelukt = true
      break
    } catch (e) {
      const afgebroken = e instanceof Error && e.name === 'AbortError'
      console.error('[factuurlezer] ' + String(e))
      mis = {
        res: null,
        tijdelijk: true,
        reden: afgebroken
          ? `De leesdienst deed er langer dan ${GEDULD_MS / 1000} seconden over.`
          : 'De leesdienst was niet te bereiken.',
      }
    } finally {
      clearTimeout(wekker)
    }
  }

  /*
   * Twee verschillende mislukkingen, en ze vragen om iets anders van wie het
   * leest. Geen antwoord gekregen gaat over de dienst -- morgen weer
   * proberen. Wel een antwoord maar er stond geen JSON in, gaat over het
   * stuk: dan helpt een rechtere foto en een herkansing niet.
   */
  if (!gelukt) {
    return {
      ok: false,
      tijdelijk: true,
      reden: `${mis.reden} Na ${POGINGEN} pogingen opgegeven.`,
    }
  }

  if (!uit) {
    return {
      ok: false,
      tijdelijk: false,
      reden: 'Er kwam geen leesbaar antwoord uit. Dit gebeurt bij scans die ' +
             'te onscherp zijn; een rechtere foto helpt meestal.',
    }
  }

  /* ---- opschonen ---- */

  const lezing = opschonen(uit, {
    doorWie,
    bestand: gekozen.naam,
    model: MODEL,
    gemarkeerd: gekozen.gemarkeerd,
  })

  const { error: bewaarFout } = await admin
    .from('expenses')
    .update({ gelezen: lezing })
    .eq('id', expenseId)

  if (bewaarFout) {
    // Het lezen is gelukt; alleen het bewaren niet. Dan geven we het toch
    // terug -- dan kan het scherm er wel wat mee.
    console.warn('[factuurlezer] bewaren mislukte: ' + bewaarFout.message)
  }

  return { ok: true, lezing, bewaard: !bewaarFout }
}
