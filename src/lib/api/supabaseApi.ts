import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ApiAdapter, PullResult, PushChange } from './types'
import type { EntityName } from '../types'

/* ------------------------------------------------------------------ *
 *  Supabase-adapter
 *
 *  Zelfde vier methodes als de mock: login, push, pull, ping. De rest van
 *  de app merkt geen verschil.
 *
 *  Twee dingen die hier geregeld worden:
 *   1. De app werkt in camelCase, Postgres in snake_case. Onderaan staat
 *      een vertaallaag; alleen de uitzonderingen zijn met de hand benoemd.
 *   2. Alle tijdstempels zijn epoch-milliseconden (bigint). Dat is exact
 *      hetzelfde formaat als in de app, dus geen tijdzone-verrassingen.
 *      `updated_at` wordt serverzijdig gezet door een trigger, zodat een
 *      scheefstaande klok op een telefoon de synchronisatie niet breekt.
 * ------------------------------------------------------------------ */

// import.meta.env bestaat alleen in een Vite-build. In Node (de zelftest)
// niet, vandaar de voorzichtige uitlezing.
const ENV: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}

const URL = ENV.VITE_SUPABASE_URL

/** Het adres van het project, voor wie zelf een edge function moet aanroepen. */
export function supabaseUrl(): string {
  return String(URL ?? '').replace(/\/+$/, '')
}
const ANON = ENV.VITE_SUPABASE_ANON_KEY

/**
 * De sleutel in deze variabele belandt in de app-bundel en gaat dus mee naar
 * iedere gebruiker. Dat mag alleen met de publieke sleutel: die komt niet
 * langs de beveiligingsregels heen. Een geheime sleutel doet dat wel, en die
 * weigeren we hier hardop.
 */
function keyProblem(key: string | undefined): string | null {
  if (!key) return null
  if (key.startsWith('sb_secret_') || key.startsWith('sk_')) {
    return 'Dit is een geheime sleutel (sb_secret_). Gebruik de publieke sleutel: ' +
           'Supabase -> Project Settings -> API Keys -> "publishable".'
  }
  const parts = key.split('.')
  if (parts.length === 3) {
    try {
      const pad = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4)
      const json = atob(pad.replace(/-/g, '+').replace(/_/g, '/'))
      if (JSON.parse(json).role === 'service_role') {
        return 'Dit is de service_role-sleutel. Gebruik de "anon public" sleutel.'
      }
    } catch {
      /* geen leesbare JWT: dan is het waarschijnlijk een publieke sleutel */
    }
  }
  return null
}

export const configError = keyProblem(ANON)

if (configError) {
  console.error('[Supabase] ' + configError)
}

export const supabaseConfigured = Boolean(URL && ANON) && !configError

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient {
  if (!client) {
    if (!URL || !ANON) {
      throw new Error(
        'Supabase is niet ingesteld. Zet VITE_SUPABASE_URL en ' +
        'VITE_SUPABASE_ANON_KEY in je .env-bestand.',
      )
    }
    client = createClient(URL, ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // De app draait ook als bestand (Electron) en als webview (mobiel);
        // daar bestaat geen URL-callback om een sessie uit te lezen.
        detectSessionInUrl: false,
      },
    })
  }
  return client
}

/* ------------------------------------------------------------------ *
 *  Tabellen
 * ------------------------------------------------------------------ */

/*
 * Welke tabel bij welke entiteit hoort.
 *
 * Geëxporteerd omdat de zelftest hem nodig heeft: die legt de kolommen die
 * NOT NULL zijn naast de velden die een scherm expres leegmaakt. Zonder die
 * koppeling zou die controle moeten raden welke tabel erbij hoort.
 */
export const TABLES: Record<EntityName, string> = {
  locations: 'locations',
  users: 'profiles',
  companies: 'companies',
  washJobs: 'wash_jobs',
  inventory: 'inventory_items',
  stockMovements: 'stock_movements',
  expenses: 'expenses',
  timeEntries: 'time_entries',
  shifts: 'shifts',
  notifications: 'notifications',
  courses: 'courses',
  courseProgress: 'course_progress',
  assets: 'assets',
  faults: 'faults',
  workOrders: 'work_orders',
  maintenancePlans: 'maintenance_plans',
  tickets: 'tickets',
  ticketMessages: 'ticket_messages',
  logEvents: 'log_events',
  devPlans: 'dev_plans',
  hourRequests: 'hour_requests',
  trips: 'trips',
  posRegisters: 'pos_registers',
  posDevices: 'pos_devices',
  posPairings: 'pos_pairings',
  posSafes: 'pos_safes',
  posSafeMoves: 'pos_safe_moves',
  locationPhotos: 'location_photos',
  truckyVragen: 'trucky_vragen',
  grootboek: 'grootboek',
  exactGrootboek: 'exact_grootboek',
  kostenTags: 'kosten_tags',
  inkoopAdressen: 'inkoop_adres',
  voorraadAlarmen: 'voorraad_alarmen',
  bestellingen: 'bestellingen',
  bestelregels: 'bestelregels',
  truckyContact: 'trucky_contact',
  instellingen: 'instellingen',
  signups: 'signups',
  channels: 'channels',
  chatMessages: 'chat_messages',
  channelReads: 'channel_reads',
  emailLog: 'email_log',
  personnelPrivate: 'personnel_private',
  personnelLoon: 'personnel_loon',
  expenseGebeurtenissen: 'expense_gebeurtenis',
  expenseRegels: 'expense_regel',
  documents: 'documents',
  mailbox: 'mailbox',
  werkmail: 'werkmail',
  postbussen: 'postbus',
  postbusLeden: 'postbus_lid',
  werkmailMappen: 'werkmail_map',
  changeRequests: 'change_requests',
  agendaItems: 'agenda_items',
  employers: 'employers',
  employerLinks: 'employer_links',
  employerRules: 'employer_rules',
  taken: 'taak',
  taakProjecten: 'taak_project',
  taakReacties: 'taak_reactie',
  vacatures: 'vacature',
  sollicitaties: 'sollicitatie',
  docMappen: 'doc_map',
  docBestanden: 'doc_bestand',
  docToegang: 'doc_toegang',
  taakDocumenten: 'taak_document',
}

/** Kolommen waarvan de naam niet simpelweg de snake_case-variant is. */
const OVERRIDES: Partial<Record<EntityName, Record<string, string>>> = {
  // "end" en "function" zijn gereserveerde woorden in SQL, "date" is een typenaam
  timeEntries: { start: 'started_at', end: 'ended_at' },
  expenses: { date: 'expense_date' },
  users: { function: 'job_title' },
}

/**
 * Velden die alleen op dit apparaat bestaan en niet naar de server gaan.
 *
 * `password` is er zo een. De testgegevens gebruiken hem om zonder Supabase
 * te kunnen inloggen; de echte database kent die kolom niet en hoort hem ook
 * niet te kennen -- wachtwoorden horen bij auth, niet bij een dossier.
 *
 * Zonder deze lijst stuurde de app hem gewoon mee, en dan weigert PostgREST
 * de hele rij met "Could not find the 'password' column". Daar sneuvelde een
 * nieuw personeelsdossier op.
 */
const LOKAAL: Partial<Record<EntityName, string[]>> = {
  users: ['password'],
}

/* ------------------------------------------------------------------ *
 *  camelCase <-> snake_case
 * ------------------------------------------------------------------ */

const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

/**
 * Een record klaarmaken voor de server.
 *
 * Het verschil tussen "ik weet het niet" en "het moet leeg"
 * ---------------------------------------------------------
 *
 * Hier stond `if (v === undefined) continue`. Dat was er ooit gekomen tegen
 * het echte gevaar -- een half record dat de rest overschrijft -- maar het
 * ging te ver: een veld leegmaken werd dáármee onmogelijk. Een upsert zet
 * alleen de kolommen die je meestuurt, dus een veld dat werd overgeslagen
 * bleef op de server gewoon staan.
 *
 * Wat dat in de praktijk betekende:
 *
 *   een wasopdracht terug in de wachtrij zetten (repo.ts, setStatus) wiste
 *   startedAt en completedAt lokaal, maar op de server bleef hij begonnen
 *   en afgerond
 *
 *   een factuur heropenen (expenses.reopen) haalde de goedkeuring eraf,
 *   maar approved_by, approved_at en de afkeurreden bleven staan
 *
 *   een geboortedatum of einddatum uit een dossier weghalen zag er gedaan
 *   uit, en kwam bij de volgende synchronisatie terug
 *
 * Geen van die drie gaf een foutmelding. Het lukte gewoon niet.
 *
 * Wat er nu telt is of de SLEUTEL er staat, niet of er een waarde in zit:
 *
 *   sleutel ontbreekt       ik heb hier geen mening over  ->  niet meesturen
 *   sleutel met undefined   dit heb ik leeggemaakt        ->  null sturen
 *   sleutel met null        idem                          ->  null sturen
 *
 * Dat is precies wat JavaScript al bedoelt met die twee waarden, en het
 * overleeft de reis door de wachtrij: IndexedDB bewaart een sleutel met
 * undefined erin. Een record dat uit de server komt heeft die sleutels niet
 * -- fromRow() laat null weg -- dus alleen wat een scherm zelf leegmaakt
 * komt hier als "leeg" binnen.
 *
 * Wat dit NIET oplost: twee apparaten die hetzelfde record bewerken. De
 * laatste wint, zoals altijd. Voor de kolommen waar dat echt niet mag --
 * betaald_at, exact_id -- staan er triggers op de server die de app
 * tegenhouden (0100).
 */
export function toRow(entity: EntityName, obj: Record<string, unknown>) {
  const over = OVERRIDES[entity] ?? {}
  const lokaal = LOKAAL[entity] ?? []
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (lokaal.includes(k)) continue
    out[over[k] ?? toSnake(k)] = v === undefined ? null : v
  }
  // updated_at wordt serverzijdig gezet
  delete out.updated_at
  return out
}

export function fromRow(entity: EntityName, row: Record<string, unknown>) {
  const over = OVERRIDES[entity] ?? {}
  const back = Object.fromEntries(Object.entries(over).map(([camel, col]) => [col, camel]))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v === null) continue // de app gebruikt undefined, niet null
    out[back[k] ?? toCamel(k)] = v
  }
  return out
}

/* ------------------------------------------------------------------ */

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? 'onbekende fout'}`)
}

/**
 * Bestaat deze tabel nog niet?
 *
 * Dat gebeurt zodra er een versie uitkomt met een nieuwe tabel en het
 * schema nog niet is bijgewerkt. Vroeger liep de hele synchronisatie daarop
 * stuk -- niet alleen die ene tabel, maar alles: roosters, bonnen, meldingen.
 * Eén ontbrekende tabel legde de app plat.
 *
 * Nu slaan we hem over en zeggen we hardop wat eraan te doen valt.
 */
export function tabelOntbreekt(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  // 42P01 komt van Postgres, PGRST205/PGRST106 van de laag ervoor.
  if (['42P01', 'PGRST205', 'PGRST106'].includes(error.code ?? '')) return true
  return /(relation|table).{0,40}(does not exist|not found)/i.test(error.message ?? '')
}

/**
 * Bestaat deze kolom nog niet?
 *
 * Hetzelfde soort probleem als een tabel die er niet is: het schema loopt
 * achter, of de app stuurt iets mee wat er niet hoort. In beide gevallen is
 * het record niet fout, en hoort het niet na acht pogingen weggegooid te
 * worden -- dat is precies wat er met een nieuw personeelsdossier gebeurde.
 */
export function kolomOntbreekt(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'PGRST204') return true
  return /could not find the .* column/i.test(error.message ?? '')
}

/** Geen rechten op een tabel is normaal: een klant ziet geen voorraad. */
function geenRechten(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST301' || error?.code === '42501'
}

/**
 * Is dit werkelijk een rechtenprobleem, of ben je gewoon uitgelogd?
 *
 * De database maakt dat onderscheid niet, en dat kostte een middag zoeken.
 * Elke regel op de tabellen geldt voor de rol "authenticated". Verloopt je
 * sessie, dan gaat het verzoek als anonieme bezoeker naar de server -- de
 * publieke sleutel is immers nog steeds een geldige sleutel -- en dan is er
 * voor die rol geen enkele regel die iets toestaat. De database antwoordt dan:
 *
 *   new row violates row-level security policy for table "channels"
 *
 * Precies dezelfde melding als wanneer een regel je iets niet gunt. Nagemeten
 * met alleen de publieke sleutel: byte voor byte dezelfde tekst.
 *
 * Die melding wijst dus naar een tabel terwijl het probleem je inlog is. Er
 * stonden drieëntwintig kanalen honderd pogingen lang vast op "geen rechten",
 * terwijl er niets mis was met die kanalen en niets mis met de regels.
 *
 * Vandaar deze vraag erbij: is er nog een sessie? Zo niet, dan is dat het
 * antwoord, en dat is een heel ander probleem met een heel andere oplossing.
 */
async function sessieVerlopen(): Promise<boolean> {
  try {
    const { data } = await supabase().auth.getSession()
    return !data.session?.access_token
  } catch {
    /* Kunnen we het niet vaststellen, dan houden we het op wat de database
       zei. Een verkeerde gok hier maakt het alleen maar verwarrender. */
    return false
  }
}

/** De juiste fout bij een weigering: uitgelogd, of werkelijk geen rechten. */
async function weigering(table: string, bericht: string): Promise<Error> {
  return (await sessieVerlopen()) ? new GeenSessie() : new GeenRechten(table, bericht)
}

/** Welke tabellen ontbraken bij de laatste ronde. */
export const ontbrekendeTabellen = new Set<string>()

/**
 * Een wijziging voor een tabel die nog niet bestaat.
 *
 * Apart soort fout, want dit is geen slecht record maar een schema dat
 * achterloopt. Zo'n wijziging mag niet worden weggegooid na een paar
 * mislukte pogingen -- hij hoort te blijven staan tot het schema klopt.
 */
export class OntbrekendeTabel extends Error {
  constructor(readonly tabel: string) {
    super(
      `De tabel "${tabel}" bestaat nog niet in de database. ` +
      'Draai supabase/setup.sql opnieuw; je wijziging blijft zolang in de wachtrij staan.',
    )
  }
}

/**
 * Er is geen geldige sessie meer bij de server.
 *
 * Ook dit is geen slecht record. Zonder sessie gaat elk verzoek als
 * onbekende bezoeker naar de database, en die weigert terecht alles -- met
 * een melding over beveiligingsregels, die naar de verkeerde kant wijst.
 *
 * Dat gebeurt vaker dan je zou denken: iemand logt zonder internet in met de
 * gegevens die dit apparaat heeft onthouden, of een sessie van weken oud
 * wordt hersteld terwijl de vernieuwsleutel allang is verlopen. De app werkt
 * dan gewoon door op de lokale gegevens -- maar versturen kan niet, en wat in
 * de wachtrij staat hoort daar te blijven tot er weer echt is ingelogd.
 */
export class GeenSessie extends Error {
  constructor() {
    super(
      'Je bent niet meer ingelogd bij de server. Log opnieuw in; je ' +
      'wijzigingen blijven zolang in de wachtrij staan.',
    )
  }
}

/**
 * Is er een bruikbare sessie? getSession() vernieuwt zelf een verlopen
 * toegangssleutel zolang de vernieuwsleutel nog geldig is, dus dit is
 * tegelijk de plek waar dat gebeurt.
 */
export async function heeftSessie(): Promise<boolean> {
  if (!supabaseConfigured) return false
  try {
    const { data } = await supabase().auth.getSession()
    const sessie = data.session
    if (!sessie) return false

    /*
     * Een opgeslagen sessie is niet hetzelfde als een geldige sessie. De
     * toegangssleutel verloopt na een uur; wat er dan nog ligt is papier.
     * PostgREST behandelt zo'n verlopen sleutel als geen sleutel, en dan
     * krijg je opnieuw een melding over beveiligingsregels terwijl er met
     * de regels niets mis is.
     *
     * Een halve minuut marge, want de sleutel moet ook de rit naar de
     * server nog overleven.
     */
    const verlooptOver = (sessie.expires_at ?? 0) * 1000 - Date.now()
    if (verlooptOver > 30_000) return true

    const { data: vers } = await supabase().auth.refreshSession()
    return !!vers.session
  } catch {
    return false
  }
}

/**
 * De database weigert dit record op zijn beveiligingsregels.
 *
 * Ook dit is geen slecht record, en het gaat niet over door het nog eens te
 * proberen. Het is een rechtenkwestie: of de regels kloppen niet, of het
 * verzoek komt niet binnen als wie je denkt te zijn.
 *
 * Zo'n weigering mag daarom nooit een teller vullen die uiteindelijk iemands
 * werk weggooit. Hij blijft staan tot de rechten kloppen, en dan gaat hij
 * alsnog mee.
 */
/**
 * Een kolom die de database niet kent.
 *
 * Blijft staan tot het schema klopt, net als een ontbrekende tabel. Anders
 * verdwijnt er werk om een reden die niets met dat werk te maken heeft.
 */
export class OntbrekendeKolom extends Error {
  constructor(readonly tabel: string, boodschap?: string) {
    super(
      `De tabel "${tabel}" mist een kolom die de app meestuurt: ${boodschap ?? ''} `.trim() +
      ' Draai supabase/setup.sql opnieuw; je wijziging blijft zolang in de wachtrij staan.',
    )
  }
}

export class GeenRechten extends Error {
  constructor(readonly tabel: string, boodschap: string) {
    super(
      `De database weigert dit voor "${tabel}": ${boodschap} ` +
      'Dat gaat over rechten, niet over dit record -- het blijft in de ' +
      'wachtrij staan.',
    )
  }
}

/* ------------------------------------------------------------------ *
 *  Ophalen tot er niets meer is, in plaats van tot tweeduizend
 *
 *  Hier stond .limit(2000), en daarnaast schoof de cursor na afloop door
 *  naar de servertijd van dat moment. Die twee samen zijn een lek: kwamen er
 *  precies tweeduizend rijen terug, dan was dat vrijwel zeker afgekapt -- en
 *  de rest werd nooit meer opgehaald, want de cursor stond er al voorbij.
 *
 *  Zolang geen enkele tabel in één keer over de tweeduizend ging viel dat
 *  niet op. Het rekeningschema van Exact gaat er wél overheen: twintig bv's
 *  met een paar honderd rekeningen. De eerste synchronisatie zou dan een half
 *  schema opleveren, en niets zou dat zeggen.
 *
 *  Dus doorpagineren op (updated_at, id). Op allebei, want een bulkinvoer
 *  geeft honderden rijen dezelfde tijdstempel; zou de cursor alleen op de
 *  tijd staan, dan slaat hij bij zo'n groep de rest over of haalt hij ze
 *  eeuwig opnieuw op. Met het id erbij is de volgorde volledig bepaald.
 * ------------------------------------------------------------------ */

/** Zoals Supabase een fout teruggeeft: een melding, met soms een code erbij. */
interface PostgrestFout { code?: string; message: string; details?: string | null }

/** Hoeveel rijen per ronde. Kleiner dan de oude grens, maar nu met vervolg. */
const PAGINA = 1000

/**
 * De veiligheidsklep.
 *
 * Als er iets misgaat aan de cursor -- een tabel zonder id, een rij die
 * zichzelf blijft bijwerken -- dan is doorlopen erger dan stoppen. Dit is
 * ruim boven wat een normale ronde ophaalt en ver onder oneindig.
 */
const MAX_PER_TABEL = 50_000

/** Waar de volgende ronde begint. */
export interface Cursor { tijd: number; id: string }

/**
 * Het filter voor een vervolgronde.
 *
 * Alles wat later is, PLUS wat op hetzelfde tijdstip staat maar een hoger id
 * heeft. Dat tweede stuk is precies de groep die anders tussen wal en schip
 * valt: een bulkinvoer geeft honderden rijen dezelfde tijdstempel, en een
 * cursor die alleen op de tijd staat slaat bij zo'n groep de rest over (met
 * "groter dan") of haalt ze eeuwig opnieuw op (met "vanaf").
 */
export function naFilter(c: Cursor): string {
  return `updated_at.gt.${c.tijd},and(updated_at.eq.${c.tijd},id.gt."${c.id}")`
}

/**
 * Waar de volgende ronde begint, of null als we er zijn.
 *
 * Null betekent klaar: een pagina die niet vol is, of een rij waar niet op
 * verder te tellen valt. Dat laatste is geen normale situatie -- elke tabel
 * in dit schema heeft een id -- maar doorgaan zou daar een lus zijn die
 * nooit afloopt, en dat is erger dan te vroeg stoppen.
 */
export function volgendeCursor(
  rijen: Record<string, unknown>[],
  pagina: number,
): Cursor | null {
  if (rijen.length < pagina) return null

  const laatste = rijen[rijen.length - 1]
  const tijd = Number(laatste.updated_at)
  const id = String(laatste.id ?? '')

  if (!id || !Number.isFinite(tijd)) return null
  return { tijd, id }
}

async function paginaVoorPagina(
  tabel: string,
  since: number,
): Promise<{ data: Record<string, unknown>[] | null; error: PostgrestFout | null }> {
  const uit: Record<string, unknown>[] = []
  let cursor: Cursor | null = null

  for (;;) {
    const basis = supabase()
      .from(tabel)
      .select('*')
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGINA)

    const vraag = cursor === null
      ? basis.gt('updated_at', since)
      : basis.or(naFilter(cursor))

    const { data, error } = await vraag
    if (error) return { data: null, error }

    const rijen = (data ?? []) as Record<string, unknown>[]
    uit.push(...rijen)

    const vol = rijen.length >= PAGINA
    cursor = volgendeCursor(rijen, PAGINA)

    if (!cursor) {
      if (vol) {
        console.warn(`[sync] ${tabel} geeft rijen zonder id of updated_at; ` +
                     `ophalen gestopt na ${uit.length} rijen.`)
      }
      return { data: uit, error: null }
    }

    if (uit.length >= MAX_PER_TABEL) {
      console.warn(`[sync] ${tabel} gaf meer dan ${MAX_PER_TABEL} rijen in één ronde; ` +
                   'de rest volgt bij de volgende synchronisatie.')
      return { data: uit, error: null }
    }
  }
}

export const supabaseApi: ApiAdapter = {
  name: 'supabase',

  async ping() {
    if (!supabaseConfigured || !navigator.onLine) return false
    try {
      // Lichte query die alleen slaagt als de server bereikbaar is.
      const { error } = await supabase().from('companies').select('id', { head: true, count: 'exact' }).limit(1)
      // Een RLS-weigering betekent nog steeds: server bereikbaar.
      return !error || error.code === 'PGRST301' || error.code === '42501'
    } catch {
      return false
    }
  },
  /*
   * Wachtwoord vergeten -- via onze eigen functie, niet via Supabase.
   *
   * Hier stond auth.resetPasswordForEmail(). Dat was op drie manieren stuk:
   * de mail kwam van Supabase in plaats van Resend en liet geen regel achter
   * in email_log, er ging geen redirectTo mee (dus Supabase pakte zijn eigen
   * Site URL, en die staat op localhost), en zelfs met een goed adres kon die
   * link nergens landen -- de client hieronder staat op
   * detectSessionInUrl: false en er luistert nergens iets op
   * PASSWORD_RECOVERY. Casper: "stuurt je naar een localhost, wat niet kan?"
   *
   * De serverfunctie stuurt nu een code van acht tekens. Zie
   * supabase/functions/wachtwoord-vergeten/.
   */
  async forgotPassword(email: string): Promise<void> {
    if (!supabaseConfigured) {
      throw new Error('No backend configured')
    }
    const { error } = await supabase().functions.invoke('wachtwoord-vergeten', {
      body: { actie: 'aanvragen', email: email.trim().toLowerCase() },
    })
    /*
     * Alleen als het verzoek de server niet haalde. Wat de server ervan vond
     * blijft expres binnen: het antwoord is voor elk adres hetzelfde.
     */
    if (error) {
      throw new Error(error.message || 'De aanvraag is niet verstuurd.')
    }
  },

  async resetPassword(email: string, code: string, wachtwoord: string) {
    if (!supabaseConfigured) {
      return { ok: false, reden: 'Er is geen verbinding met de database.' }
    }
    const { data, error } = await supabase().functions.invoke<{ ok: boolean; reden?: string }>(
      'wachtwoord-vergeten',
      {
        body: {
          actie: 'instellen',
          email: email.trim().toLowerCase(),
          code: code.trim().toUpperCase(),
          wachtwoord,
        },
      },
    )
    /*
     * invoke() maakt van elke status buiten 2xx een error en laat het lichaam
     * dan liggen. Hier staat in dat lichaam juist de reden ("deze code klopt
     * niet"), en dat is precies wat de gebruiker moet lezen. Dus uitpakken.
     */
    if (error) {
      const uitLichaam = await (async () => {
        try {
          const res = (error as { context?: Response }).context
          if (!res || typeof res.json !== 'function') return null
          const body = await res.json()
          return typeof body?.reden === 'string' ? body.reden : null
        } catch {
          return null
        }
      })()
      return { ok: false, reden: uitLichaam ?? (error.message || 'Het is niet gelukt.') }
    }
    if (!data?.ok) return { ok: false, reden: data?.reden ?? 'Het is niet gelukt.' }
    return { ok: true }
  },

  async login(email, password) {
    const { data, error } = await supabase().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (error) {
      // Verkeerde inloggegevens is geen storing: null teruggeven.
      const wrong = error.status === 400 || /invalid login/i.test(error.message)
      if (wrong) return null
      throw new Error(error.message)
    }
    if (!data.session || !data.user) return null

    // Het inlogaccount en het personeelsdossier zijn twee dingen: iemand kan
    // al op de loonlijst staan voordat er een account is. De rest van de app
    // werkt met het dossier-id, dus dat zoeken we hier op.
    const { data: profile, error: profileError } = await supabase()
      .from('profiles')
      .select('*')
      .eq('auth_id', data.user.id)
      .maybeSingle()

    if (profileError) fail('profiel ophalen', profileError)
    if (!profile) {
      throw new Error(
        'Inloggen lukte, maar er hangt geen personeelsdossier aan dit account. ' +
        'Laat het management je toevoegen met hetzelfde e-mailadres.',
      )
    }

    return {
      userId: profile.id as string,
      token: data.session.access_token,
      profile: fromRow('users', profile as Record<string, unknown>),
    }
  },

  async push(changes: PushChange[]) {
    if (!(await heeftSessie())) throw new GeenSessie()

    // Per tabel bundelen scheelt netwerkrondes.

    const byTable = new Map<EntityName, PushChange[]>()
    for (const c of changes) {
      const list = byTable.get(c.entity) ?? []
      list.push(c)
      byTable.set(c.entity, list)
    }

    for (const [entity, list] of byTable) {
      const table = TABLES[entity]

      const deletes = list.filter((c) => c.op === 'delete').map((c) => c.recordId)
      if (deletes.length) {
        const { error } = await supabase().from(table).delete().in('id', deletes)
        if (error && tabelOntbreekt(error)) throw new OntbrekendeTabel(table)
        if (error && kolomOntbreekt(error)) throw new OntbrekendeKolom(table, error.message)
        if (error && geenRechten(error)) throw await weigering(table, error.message)
        if (error) fail(`verwijderen in ${table}`, error)
      }

      const upserts = list
        .filter((c) => c.op === 'put')
        .map((c) => toRow(entity, c.payload as Record<string, unknown>))
      if (upserts.length) {
        const { error } = await supabase().from(table).upsert(upserts, { onConflict: 'id' })
        if (error && tabelOntbreekt(error)) throw new OntbrekendeTabel(table)
        if (error && kolomOntbreekt(error)) throw new OntbrekendeKolom(table, error.message)
        if (error && geenRechten(error)) throw await weigering(table, error.message)
        if (error) fail(`opslaan in ${table}`, error)
      }
    }
  },

  async pull(since: number): Promise<PullResult> {
    if (!(await heeftSessie())) throw new GeenSessie()

    const changes: PullResult['changes'] = {}

    // Parallel ophalen: zeven kleine queries in plaats van zeven wachtrondes.
    const results = await Promise.all(
      (Object.keys(TABLES) as EntityName[]).map(async (entity) => {
        const { data, error } = await paginaVoorPagina(TABLES[entity], since)

        if (error && geenRechten(error)) {
          return [entity, [] as Record<string, unknown>[]] as const
        }
        if (error && tabelOntbreekt(error)) {
          if (!ontbrekendeTabellen.has(TABLES[entity])) {
            ontbrekendeTabellen.add(TABLES[entity])
            console.warn(
              `[sync] De tabel "${TABLES[entity]}" bestaat nog niet in de database. ` +
              'Draai supabase/setup.sql opnieuw. De rest van de app blijft werken.',
            )
          }
          return [entity, [] as Record<string, unknown>[]] as const
        }
        ontbrekendeTabellen.delete(TABLES[entity])
        if (error) fail(`ophalen van ${TABLES[entity]}`, error)
        return [entity, (data ?? []).map((r) => fromRow(entity, r))] as const
      }),
    )

    for (const [entity, rows] of results) {
      if (rows.length) changes[entity] = rows
    }

    // Servertijd bepaalt de volgende cursor, niet de klok van dit apparaat.
    const { data: serverNow } = await supabase().rpc('server_time_ms')
    return {
      changes,
      serverTime: typeof serverNow === 'number' ? serverNow : Date.now(),
    }
  },
}

/** Uitloggen bij Supabase; de lokale cache blijft staan. */
export async function supabaseSignOut() {
  if (supabaseConfigured) {
    try {
      await supabase().auth.signOut()
    } catch {
      /* offline uitloggen mag geen fout geven */
    }
  }
}
