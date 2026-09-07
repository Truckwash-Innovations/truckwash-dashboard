/**
 * Exact -- de koppeling met Exact Online, en voorlopig alleen de koppeling.
 *
 * Exact werkt met OAuth: je stuurt iemand naar Exact, die logt daar in en
 * geeft toestemming, en Exact stuurt hem terug met een code die je inwisselt
 * voor tokens. Die tokens zijn de sleutel tot de boekhouding. Ze horen dus
 * niet in de app en niet in een tabel die de app synchroniseert, maar op
 * één plek waar alleen de server bij kan: exact_koppeling (0048), RLS aan,
 * geen enkele policy, alleen de servicesleutel.
 *
 * Deze functie doet zeven dingen:
 *
 *   instellen         de sleutels van de Exact-app zetten (alleen ontwikkeling)
 *   verbind-url       een link naar Exact maken, met een state die we onthouden
 *   terug             Exact komt terug met code en state: eerst de state, dan pas iets schrijven
 *   status            is er een koppeling, welke administratie, tot wanneer
 *   los               de tokens wissen
 *   sync-grootboek    het rekeningschema uit Exact ophalen
 *   grootboek-stand   onze lijst naast die van Exact leggen
 *   sync-personeel    het personeel uit Exact ophalen
 *   personeel-stand   onze mensen naast die van Exact leggen
 *   koppel-medewerker met de hand zeggen wie wie is
 *   sync-administraties  welke bv's Exact kent
 *   zet-administratie    een bv aan- of uitzetten, of tot hoofd maken
 *   sync-crediteuren  de leveranciers uit Exact ophalen
 *   facturen-stand    wat er klaarstaat om te versturen, en wat mist
 *   stuur-facturen    goedgekeurde facturen als inkoopboeking naar Exact
 *   koppel-leverancier  met de hand zeggen welke crediteur het is
 *   dagboeken / btw-codes   lijstjes uit Exact om uit te kiezen
 *
 * Het praten met Exact zelf staat in _gedeeld/exact.ts -- inclusief het
 * verversen van het token, want dat leeft tien minuten. Facturen versturen
 * komt daarna; wat daarvoor nog nodig is staat in docs/exact-koppelen.md.
 *
 * Uitrollen:  npm run functions:open
 * NOOIT kaal deployen: de terugkeer van Exact is een gewone GET uit een
 * browser zonder token, en die weigert Supabase zodra verify_jwt aan staat.
 *
 * Waar de sleutels vandaan komen (sinds 0052)
 * -------------------------------------------
 *
 * Eerst uit exact_koppeling, gezet vanuit het ontwikkelaarsscherm. Staan ze
 * daar niet, dan uit de omgeving -- dat was de enige weg en blijft werken.
 *
 * De reden voor die verhuizing is dat een proefaccount van Exact iets is dat
 * je uitprobeert. Elke poging via "supabase secrets set" plus opnieuw
 * uitrollen maakt van vijf minuten zoeken een halve middag.
 *
 * Id en geheim worden als PAAR gepakt, nooit half om half. Een nieuw id uit
 * de database naast een oud geheim uit de omgeving levert een foutmelding
 * van Exact op die nergens naar wijst.
 *
 * Nodig op de server:
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  zet Supabase zelf klaar
 *   EXACT_CLIENT_ID / EXACT_CLIENT_SECRET     optioneel, als terugval
 *   EXACT_REDIRECT_URI                        optioneel; standaard
 *                        <SUPABASE_URL>/functions/v1/exact. Moet letterlijk
 *                        overeenkomen met wat bij Exact staat.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import {
  ExactFout, exactDatum, exactLijst, exactPost, geldigToken, type ExactLijn,
} from '../_gedeeld/exact.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
/* De omgeving is sinds 0052 de terugval, niet meer de bron. */
const ENV_CLIENT_ID = (Deno.env.get('EXACT_CLIENT_ID') ?? '').trim()
const ENV_CLIENT_SECRET = (Deno.env.get('EXACT_CLIENT_SECRET') ?? '').trim()
const ENV_REDIRECT_URI = (Deno.env.get('EXACT_REDIRECT_URI') ?? '').trim()

const STANDAARD_BASIS = 'https://start.exactonline.nl'
const STANDAARD_REDIRECT = `${SUPABASE_URL}/functions/v1/exact`

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/*
 * De pagina die Exact na de terugkeer laat zien.
 *
 * Statische tekst, met opzet: er komt niets uit de URL of uit Exact in
 * terecht. Een foutmelding van Exact in een pagina plakken is een pagina
 * waar iemand anders de tekst van bepaalt.
 */
function pagina(titel: string, tekst: string, status = 200) {
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<title>${titel}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1220;color:#e5e7eb;
display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.4rem}
p{color:#9ca3af;line-height:1.5}</style></head>
<body><main><h1>${titel}</h1><p>${tekst}</p></main></body></html>`
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/* ------------------------------------------------------------------ *
 *  Terug naar de app
 *
 *  Casper: "zodat ik erop kan klikken, en erop terug kom."
 *
 *  Hier eindigde de rondgang op een kaal pagina'tje dat je zelf moest
 *  sluiten, waarna je in de app zelf op verversen moest drukken. Nu stuurt
 *  hij je terug naar de app met een woord in de URL, zodat het scherm meteen
 *  kan zeggen wat er gebeurd is.
 *
 *  Waarom er een vast rijtje woorden gaat en geen foutmelding
 *  ---------------------------------------------------------
 *
 *  De tekst van Exact komt uit een URL die iedereen kan sturen. Die
 *  doorgeven aan de app betekent dat een vreemde bepaalt wat er in jouw
 *  scherm staat. Dus: alleen woorden die hier in de code staan, en de echte
 *  foutmelding gaat naar laatste_fout, waar het scherm hem los ophaalt.
 *
 *  En het adres zelf wordt nagekeken. Een adres dat van buiten komt en
 *  ongezien in een 302 belandt, is een open doorstuurluik op ons eigen
 *  domein -- precies wat je in een phishingmail wil hebben. Alleen https,
 *  en zonder inlognaam in het adres.
 * ------------------------------------------------------------------ */

/** Waar de app draait, of null als er niets bruikbaars is ingesteld. */
async function appAdres(): Promise<URL | null> {
  const { data } = await admin.from('instellingen')
    .select('waarde').eq('sleutel', 'app_url').maybeSingle()
  const ruw = String(data?.waarde ?? '').trim()
  if (!ruw) return null
  try {
    const u = new URL(ruw)
    if (u.protocol !== 'https:' || u.username || u.password) return null
    return u
  } catch {
    return null
  }
}

/**
 * Terug naar de app, of anders de pagina die er altijd al was.
 *
 * `hoe` is een van onze eigen woorden: ok, geweigerd, verlopen, sleutels,
 * token. Nooit iets wat uit een verzoek komt.
 */
async function terugNaarApp(hoe: string, titel: string, tekst: string, status = 200) {
  const app = await appAdres()
  if (!app) return pagina(titel, tekst, status)

  app.searchParams.set('exact', hoe)
  return new Response(null, {
    status: 302,
    headers: { Location: app.toString(), 'Cache-Control': 'no-store' },
  })
}

/* ------------------------------------------------------------------ *
 *  De ene rij
 * ------------------------------------------------------------------ */

interface Koppeling {
  id: string
  division: string | null
  access_token: string | null
  refresh_token: string | null
  token_verloopt_at: number | null
  status: string
  verbonden_door: string | null
  verbonden_at: number | null
  laatste_fout: string | null
  state: string | null
  state_at: number | null
  /* De sleutels van de Exact-app, sinds 0052 hier en niet meer alleen in
     de omgeving. Leeg = terugvallen op wat er op de server staat. */
  client_id: string | null
  client_geheim: string | null
  basis_url: string | null
  redirect_uri: string | null
  omgeving: string | null
  sleutels_door: string | null
  sleutels_at: number | null
}

/* Hoe lang een uitgegeven state geldig blijft. Inloggen bij Exact duurt een
   minuut; een kwartier is ruim, en daarna is een verlaten poging geen deur meer. */
const STATE_GELDIG_MS = 15 * 60 * 1000

async function koppeling(): Promise<Koppeling | null> {
  const { data, error } = await admin.from('exact_koppeling').select('*').eq('id', 'exact').maybeSingle()
  if (error) throw new Error(`exact_koppeling lezen: ${error.message}`)
  return (data ?? null) as Koppeling | null
}

async function bewaar(velden: Partial<Koppeling>) {
  const { error } = await admin.from('exact_koppeling')
    .upsert({ id: 'exact', ...velden, updated_at: Date.now() }, { onConflict: 'id' })
  if (error) throw new Error(`exact_koppeling schrijven: ${error.message}`)
}

/* ------------------------------------------------------------------ *
 *  Waar praat deze functie mee
 *
 *  Naar dit adres gaat straks het clientgeheim toe, samen met de code die
 *  Exact heeft teruggestuurd. Dat maakt het adres geen instelling maar een
 *  beveiligingskeuze: wie het mag zetten, mag anders in één handeling de
 *  sleutels van de boekhouding naar zijn eigen server laten sturen -- en er
 *  zou geen foutmelding komen, want zijn server antwoordt gewoon.
 *
 *  Daarom een lijst met wat Exact zelf is. Draait jullie proefomgeving op
 *  een adres dat hier niet bij staat, dan hoort dat een bewuste toevoeging
 *  te zijn en geen veld dat iemand invult.
 * ------------------------------------------------------------------ */

const EXACT_DOMEINEN = [
  'exactonline.nl', 'exactonline.be', 'exactonline.de',
  'exactonline.co.uk', 'exactonline.fr', 'exactonline.es',
  'exactonline.com',
]

/** Het adres, of null als het geen Exact is. Pad en querystring vallen weg. */
function schoonBasis(ruw: string): string | null {
  let u: URL
  try {
    u = new URL(ruw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()
  const bekend = EXACT_DOMEINEN.some((d) => host === d || host.endsWith('.' + d))
  return bekend ? `${u.protocol}//${u.host}` : null
}

/**
 * Het terugkeeradres dat naar Exact gaat.
 *
 * Dit is de plek waar EXACT naartoe belt met de code, en dat is deze functie
 * -- niet de app. Dat verschil is de val waar dit veld in trapte: er stond
 * ook een veld "waar kom je terug", en dat is wél de app. Wie het app-adres
 * hier invult, krijgt van Exact "Callback URI is not valid" en heeft geen
 * idee waarom, want het adres bestaat en werkt gewoon.
 *
 * Vandaar dat het pad wordt afgedwongen. Een ander adres is niet een
 * ongebruikelijke keuze maar een die altijd stukloopt: de app kan de code
 * niet inwisselen, want daar is het clientgeheim voor nodig en dat staat
 * alleen hier.
 *
 * Het domein blijft vrij, want er kan ooit een eigen domein vóór de functie
 * hangen. Het pad niet.
 */
const REDIRECT_PAD = '/functions/v1/exact'

function schoonRedirect(ruw: string): string | null {
  let u: URL
  try {
    u = new URL(ruw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.hash) return null
  if (!u.pathname.replace(/\/+$/, '').endsWith(REDIRECT_PAD)) return null
  return u.toString()
}

interface Sleutels {
  clientId: string
  geheim: string
  basis: string
  redirect: string
  omgeving: 'proef' | 'echt'
  /** Waar het paar id+geheim vandaan komt; alleen om te tonen. */
  bron: 'database' | 'omgeving' | 'geen'
}

/*
 * Het paar id+geheim komt uit één bron, nooit half om half. Een id uit de
 * database naast een geheim uit de omgeving geeft "invalid_client" terug, en
 * dat is een foutmelding die naar de verkeerde kant wijst: de sleutels lijken
 * dan fout terwijl alleen de herkomst niet klopte.
 *
 * Adres en terugkeeradres staan daar los van: die mogen wel per stuk uit de
 * database komen, want ze horen niet bij elkaar en zijn geen geheim.
 */
function sleutelsVan(k: Koppeling | null): Sleutels {
  const dbId = (k?.client_id ?? '').trim()
  const dbGeheim = (k?.client_geheim ?? '').trim()
  const uitDb = Boolean(dbId && dbGeheim)

  const clientId = uitDb ? dbId : ENV_CLIENT_ID
  const geheim = uitDb ? dbGeheim : ENV_CLIENT_SECRET

  return {
    clientId,
    geheim,
    basis: schoonBasis(k?.basis_url ?? '') ?? STANDAARD_BASIS,
    /* ?? en || door elkaar: schoonRedirect geeft null bij afkeuren, maar een
       niet-gezet EXACT_REDIRECT_URI is een lege string en die moet ook door
       naar de standaard. */
    redirect: schoonRedirect(k?.redirect_uri ?? '') ?? (ENV_REDIRECT_URI || STANDAARD_REDIRECT),
    omgeving: k?.omgeving === 'echt' ? 'echt' : 'proef',
    bron: uitDb ? 'database' : (clientId && geheim ? 'omgeving' : 'geen'),
  }
}

/* ------------------------------------------------------------------ *
 *  Wie belt hier
 *
 *  Voor de POST-acties. Rollen kent de database niet (permissions.ts), dus
 *  hier het rijtje dat bij supply.settings hoort: trucksupply heeft dat
 *  recht standaard, management altijd, en verder wie het los kreeg.
 *
 *  Sinds 0052 twee niveaus, want de sleutels zetten is iets anders dan
 *  koppelen. Koppelen doet trucksupply zelf. De sleutels van de Exact-app
 *  zijn de toegang tot de boekhouding en horen bij ontwikkeling en
 *  management -- ook al staat het scherm ervoor bij ontwikkeling, want
 *  ontwikkeling heeft supply.settings niet en zou er anders niet in komen.
 *
 *  Die tweede controle staat op de rol en niet op een recht uit
 *  permissions.ts. Dat bestand deelt de kassa-repo mee; er een recht bij
 *  verzinnen is een wijziging aan twee projecten voor één scherm.
 * ------------------------------------------------------------------ */

interface Beller {
  id: string
  naam: string
  /** Mag de sleutels van de Exact-app zien en zetten. */
  magSleutels: boolean
}

async function wieBelt(req: Request): Promise<Beller | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token || token === (Deno.env.get('SUPABASE_ANON_KEY') ?? '')) return null

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null

  const { data: profiel } = await admin
    .from('profiles')
    .select('id, name, roles, active, grants, revokes')
    .eq('auth_id', data.user.id)
    .maybeSingle()
  if (!profiel?.active) return null

  const rollen = (profiel.roles ?? []) as string[]
  const toegekend = (profiel.grants ?? []) as string[]
  const ingetrokken = (profiel.revokes ?? []) as string[]

  const magSleutels = rollen.includes('developer') || rollen.includes('management')

  const mag = magSleutels || (!ingetrokken.includes('supply.settings')
    && (rollen.includes('trucksupply') || toegekend.includes('supply.settings')))

  if (!mag) return null
  return {
    id: profiel.id as string,
    naam: (profiel.name ?? '') as string,
    magSleutels,
  }
}

/* ------------------------------------------------------------------ *
 *  Exact komt terug
 * ------------------------------------------------------------------ */

interface TokenAntwoord {
  access_token?: string
  refresh_token?: string
  expires_in?: number | string
  error?: string
  error_description?: string
}

async function terug(url: URL): Promise<Response> {
  const code = url.searchParams.get('code') ?? ''
  const state = url.searchParams.get('state') ?? ''
  const fout = url.searchParams.get('error') ?? ''

  /*
   * Dit is een open GET: geen token, geen login, iedereen die de URL kent
   * kan hem sturen. Daarom wordt hier pas iets in exact_koppeling geschreven
   * als de state klopt. Een eerdere versie ruimde bij een mismatch de state
   * op en zette de fout uit de URL in laatste_fout; daarmee kon een vreemde
   * met één verzoek een lopende koppelpoging van Casper laten mislukken, en
   * eigen tekst in het dashboard zetten. Bij een mismatch nu: alleen de
   * pagina, verder niets.
   *
   * De state is het bewijs dat deze terugkeer hoort bij een link die wíj
   * hebben uitgegeven. Zonder die controle kan iemand een code van zijn eigen
   * Exact-account hier naar binnen sturen, en dan boekt Truckwash straks in
   * de administratie van een vreemde.
   */
  const huidig = await koppeling()
  const verlopen = !huidig?.state_at || Date.now() - huidig.state_at > STATE_GELDIG_MS
  if (!state || !huidig?.state || state !== huidig.state || verlopen) {
    return await terugNaarApp('verlopen', 'Niet gekoppeld',
      'Deze koppelpoging is niet herkend of verlopen. Begin opnieuw vanuit het dashboard, bij Instellingen.', 400)
  }

  if (fout || !code) {
    /* De state klopt, dus dit is echt Exact: iemand heeft daar op "weigeren"
       gedrukt, of Exact kwam zonder code terug. Nu mag de poging dicht. */
    await bewaar({ state: null, state_at: null, laatste_fout: fout ? `Exact: ${fout.slice(0, 200)}` : 'Teruggekomen zonder code' })
    return await terugNaarApp('geweigerd', 'Niet gekoppeld',
      'Exact heeft de koppeling niet toegestaan. Je kunt dit venster sluiten en het in het dashboard opnieuw proberen.')
  }

  /*
   * Dezelfde sleutels als waarmee de link is gemaakt. Ze komen uit dezelfde
   * rij die hierboven al gelezen is, dus wie halverwege een koppelpoging de
   * sleutels omzet, krijgt hier een nette afwijzing van Exact in plaats van
   * een koppeling met een half stel.
   */
  const sleutels = sleutelsVan(huidig)

  if (!sleutels.clientId || !sleutels.geheim) {
    await bewaar({ state: null, state_at: null, laatste_fout: 'Client-id of clientgeheim van Exact ontbreekt' })
    return await terugNaarApp('sleutels', 'Niet gekoppeld',
      'De sleutels van de Exact-app ontbreken. Zet ze in het dashboard bij Ontwikkeling, Exact.', 500)
  }

  const res = await fetch(`${sleutels.basis}/api/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      redirect_uri: sleutels.redirect,
      grant_type: 'authorization_code',
      client_id: sleutels.clientId,
      client_secret: sleutels.geheim,
    }),
  })

  let antwoord: TokenAntwoord = {}
  try { antwoord = await res.json() as TokenAntwoord } catch { /* geen json: hieronder afgevangen */ }

  if (!res.ok || !antwoord.access_token || !antwoord.refresh_token) {
    const reden = `token ${res.status}: ${antwoord.error ?? 'geen tokens in het antwoord'}`
    console.error('[exact] inwisselen', reden, antwoord.error_description ?? '')
    await bewaar({ state: null, state_at: null, laatste_fout: reden.slice(0, 300) })
    return await terugNaarApp('token', 'Niet gekoppeld',
      'Het inwisselen van de code bij Exact is mislukt. Probeer het vanuit het dashboard opnieuw.', 502)
  }

  /*
   * Welke administratie. Een instelling gaat voor; staat die leeg, dan wat
   * Exact zelf als huidige administratie van dit account opgeeft. Lukt dat
   * niet, dan is de koppeling er nog steeds -- alleen zonder division, en
   * dat staat dan zichtbaar in het dashboard.
   */
  let division: string | null = null
  try {
    const { data } = await admin.from('instellingen').select('waarde').eq('sleutel', 'exact_division').maybeSingle()
    division = String(data?.waarde ?? '').trim() || null
    if (!division) {
      const me = await fetch(`${sleutels.basis}/api/v1/current/Me?$select=CurrentDivision`, {
        headers: { Authorization: `Bearer ${antwoord.access_token}`, Accept: 'application/json' },
      })
      if (me.ok) {
        const uit = await me.json() as { d?: { results?: Array<{ CurrentDivision?: number }> } }
        const cd = uit.d?.results?.[0]?.CurrentDivision
        if (cd != null) division = String(cd)
      }
    }
  } catch (e) {
    console.error('[exact] division ophalen', e)
  }

  /* Exact geeft de looptijd in seconden (doorgaans 600). */
  const seconden = Number(antwoord.expires_in ?? 600) || 600
  await bewaar({
    division,
    access_token: antwoord.access_token,
    refresh_token: antwoord.refresh_token,
    token_verloopt_at: Date.now() + seconden * 1000,
    status: 'verbonden',
    verbonden_at: Date.now(),
    laatste_fout: null,
    state: null,
    state_at: null,
  })

  return await terugNaarApp('ok', 'Gekoppeld', 'Exact Online is gekoppeld. Je kunt dit venster sluiten.')
}

/* ------------------------------------------------------------------ *
 *  De stand
 *
 *  Wat het scherm nodig heeft om te tonen wat er staat. Het clientgeheim
 *  komt er nooit uit -- alleen of het gezet is en de laatste vier tekens,
 *  genoeg om te zien of het het geheim is dat je dacht te plakken, te weinig
 *  om er iets mee te doen.
 *
 *  Twee lagen, en dat is met opzet
 *  -------------------------------
 *
 *  "opgeslagen" is wat er letterlijk in de rij staat: dat hoort in de velden
 *  van het formulier, zodat wat je typte terugkomt zoals je het typte. De
 *  rest is wat hij op dit moment zou GEBRUIKEN, en dat kan iets anders zijn.
 *
 *  Dat verschil is precies het geval waar je anders op stukloopt: sla je het
 *  client-id op en het geheim nog niet, dan pakt sleutelsVan() het paar uit
 *  de omgeving, want half om half mag niet. Zonder deze twee lagen zou het
 *  scherm dan het oude id uit de omgeving tonen alsof jouw nieuwe id was
 *  opgeslagen -- en dat is een half uur zoeken naar niets.
 * ------------------------------------------------------------------ */

async function stand(beller: Beller) {
  const k = await koppeling()
  const sleutels = sleutelsVan(k)
  const geheim = sleutels.geheim

  const basis = {
    verbonden: Boolean(k?.refresh_token) && k?.status === 'verbonden',
    division: k?.division ?? null,
    verlooptAt: k?.token_verloopt_at ?? null,
    verbondenAt: k?.verbonden_at ?? null,
    verbondenDoor: k?.verbonden_door ?? null,
    laatsteFout: k?.laatste_fout ?? null,
    ingesteld: Boolean(sleutels.clientId && geheim),
    omgeving: sleutels.omgeving,
  }

  /* Wie de sleutels niet mag zetten, hoeft ze ook niet te zien staan. */
  if (!beller.magSleutels) return basis

  return {
    ...basis,

    /* Wat er in de rij staat -- voor de velden van het formulier. */
    opgeslagen: {
      clientId: (k?.client_id ?? '').trim(),
      geheimGezet: Boolean((k?.client_geheim ?? '').trim()),
      basisUrl: (k?.basis_url ?? '').trim(),
      redirectUri: (k?.redirect_uri ?? '').trim(),
      omgeving: k?.omgeving === 'echt' ? 'echt' : 'proef',
    },

    /* Wat hij nu zou gebruiken -- voor het statusblok. */
    clientId: sleutels.clientId,
    geheimGezet: Boolean(geheim),
    geheimStaart: geheim ? geheim.slice(-4) : null,
    basisUrl: sleutels.basis,
    redirectUri: sleutels.redirect,
    bron: sleutels.bron,

    sleutelsDoor: k?.sleutels_door ?? null,
    sleutelsAt: k?.sleutels_at ?? null,
    /* Waar de terugkeer standaard heen gaat. Dit moet letterlijk in het
       Exact App Center staan; het scherm laat het zien om te kopieren. */
    standaardRedirect: STANDAARD_REDIRECT,
    domeinen: EXACT_DOMEINEN,
  }
}

/* ------------------------------------------------------------------ *
 *  De sleutels zetten
 *
 *  Een ding waar het op staat: zodra het id, het geheim of het adres
 *  verandert, gaan de tokens weg. Ze horen bij de app en de administratie
 *  waarmee ze zijn opgehaald. Blijven ze staan bij een omzetting van proef
 *  naar echt, dan wijst het scherm "gekoppeld" aan terwijl er straks met een
 *  token van het proefaccount in de echte boekhouding geboekt zou worden --
 *  of andersom, wat erger is.
 * ------------------------------------------------------------------ */

async function instellen(body: Record<string, unknown>, beller: Beller): Promise<Response> {
  const huidig = await koppeling()
  const velden: Partial<Koppeling> = {}

  /* Het id. Leeg mag: dan valt hij terug op de omgeving. */
  if ('clientId' in body) {
    const v = String(body.clientId ?? '').trim().slice(0, 200)
    velden.client_id = v || null
  }

  /*
   * Het geheim. Niet meesturen betekent "laat staan" -- anders zou het
   * scherm het geheim moeten kennen om het adres te kunnen wijzigen, en dan
   * moest het geheim eerst naar de browser toe.
   */
  if (body.geheimWissen === true) {
    velden.client_geheim = null
  } else if (typeof body.geheim === 'string' && body.geheim.trim()) {
    velden.client_geheim = body.geheim.trim().slice(0, 400)
  }

  if ('basis' in body) {
    const ruw = String(body.basis ?? '').trim().slice(0, 500)
    if (!ruw) {
      velden.basis_url = null
    } else {
      const schoon = schoonBasis(ruw)
      if (!schoon) {
        return json({
          ok: false,
          reden: `Dat adres herkent hij niet als Exact. Het moet https zijn op een van: ${EXACT_DOMEINEN.join(', ')}.`,
        }, 400)
      }
      velden.basis_url = schoon
    }
  }

  if ('redirect' in body) {
    const ruw = String(body.redirect ?? '').trim().slice(0, 500)
    if (!ruw) {
      velden.redirect_uri = null
    } else {
      const schoon = schoonRedirect(ruw)
      if (!schoon) {
        return json({
          ok: false,
          reden: 'Het terugkeeradres is de plek waar Exact naartoe belt, en dat is deze '
            + `serverfunctie -- niet de app. Het moet eindigen op ${REDIRECT_PAD}, `
            + `bijvoorbeeld ${STANDAARD_REDIRECT}. Waar JIJ terugkomt na het koppelen `
            + 'staat in het veld eronder.',
        }, 400)
      }
      velden.redirect_uri = schoon
    }
  }

  if ('omgeving' in body) {
    velden.omgeving = body.omgeving === 'echt' ? 'echt' : 'proef'
  }

  if (Object.keys(velden).length === 0) {
    return json({ ok: false, reden: 'Er is niets meegestuurd om te wijzigen.' }, 400)
  }

  /*
   * Is er iets veranderd waar de tokens aan hangen? De omgeving staat er
   * bewust bij: die verandert alleen als je van proef naar echt gaat, en dan
   * is opnieuw koppelen precies wat er moet gebeuren.
   */
  const raaktTokens = (['client_id', 'client_geheim', 'basis_url', 'omgeving'] as const)
    .some((v) => v in velden && (velden[v] ?? null) !== (huidig?.[v] ?? null))

  const wasGekoppeld = Boolean(huidig?.refresh_token)

  if (raaktTokens && wasGekoppeld) {
    velden.access_token = null
    velden.refresh_token = null
    velden.token_verloopt_at = null
    velden.status = 'los'
    velden.state = null
    velden.state_at = null
    velden.laatste_fout = 'De sleutels zijn gewijzigd; opnieuw koppelen met Exact.'
  }

  velden.sleutels_door = beller.naam || beller.id
  velden.sleutels_at = Date.now()

  await bewaar(velden)

  return json({
    ok: true,
    losgekoppeld: raaktTokens && wasGekoppeld,
    ...await stand(beller),
  })
}

/* ------------------------------------------------------------------ *
 *  De administraties
 *
 *  Sinds 0059 zijn het er meer dan één. Het token geldt voor alle bv's waar
 *  de ingelogde Exact-gebruiker bij mag; welke dat zijn vraagt hij hier op.
 *
 *  Nieuwe administraties komen binnen als NIET actief. Dat is met opzet: er
 *  kunnen bv's tussen zitten waar wij niets mee doen -- een holding, een
 *  slapende vennootschap -- en die elke ophaalronde meenemen kost tijd en
 *  levert lijsten op waar niemand iets aan heeft. Aanzetten doe je zelf.
 * ------------------------------------------------------------------ */

interface ExactDivision {
  Code?: number | string
  Description?: string
  HID?: number
  Main?: number | boolean
}

async function syncAdministraties(): Promise<Response> {
  const lijn = await geldigToken(admin)
  const rijen = await exactLijst<ExactDivision>(lijn, 'system/Divisions', {
    $select: 'Code,Description,Main',
  })

  const nu = Date.now()
  const codes = rijen
    .map((r) => ({ code: String(r.Code ?? '').trim(), naam: String(r.Description ?? '').trim() }))
    .filter((r) => r.code)

  for (const r of codes) {
    /* Alleen invoegen wat er nog niet is: actief en hoofd zijn keuzes die
       hier zijn gemaakt en die een ophaalronde niet hoort terug te draaien. */
    await admin.from('exact_administratie').upsert(
      { code: r.code, naam: r.naam, updated_at: nu },
      { onConflict: 'code', ignoreDuplicates: false },
    ).select()
  }

  /*
   * Is er nog geen hoofdadministratie, dan wordt het die van de koppeling.
   * Zonder hoofd valt bon_administratie() terug op niets, en dan blijft elke
   * bon zonder vestiging staan zonder dat het scherm zegt waarom.
   */
  const { count: hoofden } = await admin.from('exact_administratie')
    .select('code', { count: 'exact', head: true }).eq('hoofd', true)
  if (!hoofden) {
    await admin.from('exact_administratie')
      .update({ hoofd: true, actief: true, updated_at: nu })
      .eq('code', lijn.division)
  }

  return json({ ok: true, aantal: codes.length, ...await administraties() })
}

async function administraties() {
  const { data } = await admin.from('exact_administratie').select('*').order('code')
  return {
    administraties: (data ?? []).map((r) => ({
      code: String(r.code),
      naam: String(r.naam ?? ''),
      actief: r.actief === true,
      hoofd: r.hoofd === true,
    })),
  }
}

async function zetAdministratie(body: Record<string, unknown>): Promise<Response> {
  const code = String(body.code ?? '').trim()
  if (!code) return json({ ok: false, reden: 'Geen administratie meegestuurd.' }, 400)

  const velden: Record<string, unknown> = { updated_at: Date.now() }
  if ('actief' in body) velden.actief = body.actief === true
  if ('hoofd' in body && body.hoofd === true) {
    /* Er kan er maar één zijn; de database bewaakt dat ook, maar een nette
       omzetting is beter dan een botsing op een unieke index. */
    await admin.from('exact_administratie').update({ hoofd: false }).eq('hoofd', true)
    velden.hoofd = true
    velden.actief = true
  }

  const { error } = await admin.from('exact_administratie').update(velden).eq('code', code)
  if (error) return json({ ok: false, reden: error.message }, 502)
  return json({ ok: true, ...await administraties() })
}

/** De bv's waar we werkelijk iets mee doen. */
async function actieveAdministraties(lijn: ExactLijn): Promise<string[]> {
  const { data } = await admin.from('exact_administratie')
    .select('code').eq('actief', true).order('code')
  const uit = (data ?? []).map((r) => String(r.code))
  /* Nog nooit opgehaald? Dan is er er één: die van de koppeling. */
  return uit.length > 0 ? uit : [lijn.division]
}

/* ------------------------------------------------------------------ *
 *  Het rekeningschema ophalen
 *
 *  Uit Exact naar public.exact_grootboek, en verder niets: public.grootboek
 *  blijft van ons. Zie de kop van migratie 0053 voor waarom die twee lijsten
 *  gescheiden blijven.
 * ------------------------------------------------------------------ */

interface ExactGL {
  ID?: string
  Code?: string
  Description?: string
  BalanceSide?: string
  IsBlocked?: boolean
  Type?: number
}

/*
 * Wat de nummers van Exact betekenen. Een 12 in een kolom zegt niemand iets;
 * bij "Kosten" weet de administratie meteen of een rekening klopt. Onbekende
 * nummers laten we als nummer staan in plaats van te gokken.
 */
const GL_SOORTEN: Record<number, string> = {
  10: 'Kas en bank',
  12: 'Debiteuren',
  20: 'Voorraad',
  22: 'Vaste activa',
  30: 'Crediteuren',
  35: 'Btw',
  40: 'Eigen vermogen',
  50: 'Kosten',
  55: 'Omzet',
  90: 'Tussenrekening',
}

async function syncGrootboek(beller: Beller): Promise<Response> {
  const lijn = await geldigToken(admin)
  const bvs = await actieveAdministraties(lijn)

  const nu = Date.now()
  let totaal = 0

  /*
   * Per bv, want elke administratie heeft zijn eigen schema. Rekening 4000
   * bestaat overal en betekent overal iets anders; ze op één hoop gooien
   * levert een lijst op waarin de eerste de beste wint.
   */
  for (const bv of bvs) {
    const rijen = await exactLijst<ExactGL>(lijn, 'financial/GLAccounts', {
      $select: 'ID,Code,Description,IsBlocked,Type',
      $orderby: 'Code',
    }, bv)

    const uit = rijen
      .map((r) => ({
        code: String(r.Code ?? '').trim(),
        omschrijving: String(r.Description ?? '').trim(),
        exact_id: r.ID ?? null,
        soort: typeof r.Type === 'number' ? (GL_SOORTEN[r.Type] ?? String(r.Type)) : null,
        geblokkeerd: r.IsBlocked === true,
        division: bv,
        updated_at: nu,
      }))
      .filter((r) => r.code !== '')

    /* In brokken, want een administratie met honderden rekeningen in één
       verzoek is een tijdslimiet die je een keer haalt en daarna niet meer. */
    for (let i = 0; i < uit.length; i += 200) {
      const { error } = await admin.from('exact_grootboek')
        .upsert(uit.slice(i, i + 200), { onConflict: 'division,code' })
      if (error) throw new ExactFout(`exact_grootboek schrijven: ${error.message}`)
    }

    /*
     * Opruimen binnen DEZE bv. Op updated_at alleen zou de lijst van de
     * vorige administratie weggooien die we net hadden opgehaald.
     */
    await admin.from('exact_grootboek').delete().eq('division', bv).lt('updated_at', nu)
    totaal += uit.length
  }

  /* En wat er van een bv staat die niet meer actief is. */
  await admin.from('exact_grootboek').delete().not('division', 'in', `(${bvs.map((b) => `"${b}"`).join(',')})`)

  await admin.from('exact_sync').upsert({
    soort: 'grootboek',
    laatst_at: nu,
    aantal: totaal,
    laatste_fout: null,
    door: beller.naam || beller.id,
    updated_at: nu,
  }, { onConflict: 'soort' })

  return json({ ok: true, aantal: totaal, bvs, ...await grootboekStand() })
}

/* ------------------------------------------------------------------ *
 *  De twee lijsten naast elkaar
 *
 *  Dit is waar het om begonnen was. Niet "hoeveel rekeningen kent Exact",
 *  maar: staat elke code waarop wij boeken ook daar, en heet hij hetzelfde?
 *  Een code die hier wel bestaat en daar niet, is een boeking die straks
 *  geweigerd wordt -- en dat wil je weten vóór de factuur weg is.
 * ------------------------------------------------------------------ */

async function grootboekStand() {
  const [onze, hunne, sync] = await Promise.all([
    admin.from('grootboek').select('code, naam, categorie, actief').order('code'),
    admin.from('exact_grootboek').select('code, omschrijving, soort, geblokkeerd').order('code'),
    admin.from('exact_sync').select('*').eq('soort', 'grootboek').maybeSingle(),
  ])

  const bij = new Map<string, { omschrijving: string; soort: string | null; geblokkeerd: boolean }>()
  for (const r of (hunne.data ?? [])) {
    bij.set(String(r.code), {
      omschrijving: String(r.omschrijving ?? ''),
      soort: (r.soort as string) ?? null,
      geblokkeerd: r.geblokkeerd === true,
    })
  }

  const regels = (onze.data ?? []).map((g) => {
    const e = bij.get(String(g.code))
    return {
      code: String(g.code),
      naam: String(g.naam),
      categorie: (g.categorie as string) ?? null,
      actief: g.actief === true,
      inExact: Boolean(e),
      exactNaam: e?.omschrijving ?? null,
      exactSoort: e?.soort ?? null,
      geblokkeerd: e?.geblokkeerd ?? false,
    }
  })

  /*
   * En andersom: wat Exact kent en wij nog niet.
   *
   * Dit is nieuw sinds 0057. Tot dan liet dit scherm alleen zien of ONZE
   * codes bij Exact bestonden; overnemen moest met de hand. Casper: "zodat
   * we echt een sync hebben ipv alles handmatig oppakken."
   */
  const onzeCodes = new Set((onze.data ?? []).map((g) => String(g.code)))
  const nogNiet = (hunne.data ?? [])
    .filter((r) => !onzeCodes.has(String(r.code)))
    .map((r) => ({
      code: String(r.code),
      omschrijving: String(r.omschrijving ?? ''),
      soort: (r.soort as string) ?? null,
      geblokkeerd: r.geblokkeerd === true,
    }))

  return {
    regels,
    nogNiet,
    /* Alleen tellen wat ertoe doet: een rekening die wij niet meer gebruiken
       hoeft niet in Exact te bestaan. */
    ontbreekt: regels.filter((r) => r.actief && !r.inExact).length,
    geblokkeerd: regels.filter((r) => r.actief && r.geblokkeerd).length,
    exactAantal: (hunne.data ?? []).length,
    laatstAt: sync.data?.laatst_at ?? null,
    laatsteFout: sync.data?.laatste_fout ?? null,
    door: sync.data?.door ?? null,
  }
}

/* ------------------------------------------------------------------ *
 *  De crediteuren
 * ------------------------------------------------------------------ */

interface ExactAccount {
  ID?: string
  Code?: string
  Name?: string
  VATNumber?: string
}

async function syncCrediteuren(beller: Beller): Promise<Response> {
  const lijn = await geldigToken(admin)
  const bvs = await actieveAdministraties(lijn)

  const nu = Date.now()
  let uitTotaal = 0

  /* Een relatie hoort bij één administratie en heeft daar zijn eigen guid.
     Dezelfde leverancier in twee bv's is dus twee rijen -- en dat moet ook,
     want een boeking wijst naar de guid van díe bv. */
  for (const bv of bvs) {
    const rijen = await exactLijst<ExactAccount>(lijn, 'crm/Accounts', {
      $select: 'ID,Code,Name,VATNumber',
      $filter: 'IsSupplier eq true',
    }, bv)

    const uit = rijen
      .filter((r) => r.ID)
      .map((r) => ({
        exact_id: String(r.ID),
        code: (r.Code ?? '').trim() || null,
        naam: String(r.Name ?? '').trim(),
        btw_nummer: r.VATNumber ?? null,
        division: bv,
        updated_at: nu,
      }))

    for (let i = 0; i < uit.length; i += 200) {
      const { error } = await admin.from('exact_crediteur')
        .upsert(uit.slice(i, i + 200), { onConflict: 'exact_id' })
      if (error) throw new ExactFout(`exact_crediteur schrijven: ${error.message}`)
    }
    await admin.from('exact_crediteur').delete().eq('division', bv).lt('updated_at', nu)
    uitTotaal += uit.length
  }

  const uit = { length: uitTotaal }

  /*
   * De zoeknaam en het automatisch koppelen doet de database, in één keer.
   * Dat scheelt niet alleen verkeer: kaal_bedrijf() staat daar, en als deze
   * functie zijn eigen versie van "dezelfde naam" zou maken, lopen die twee
   * binnen een half jaar uit elkaar.
   */
  const { error: klaar } = await admin.rpc('exact_crediteuren_klaarzetten', {
    door_in: beller.naam || beller.id,
  })
  if (klaar) throw new ExactFout(`crediteuren klaarzetten: ${klaar.message}`)

  await admin.from('exact_sync').upsert({
    soort: 'crediteuren',
    laatst_at: nu,
    aantal: uit.length,
    laatste_fout: null,
    door: beller.naam || beller.id,
    updated_at: nu,
  }, { onConflict: 'soort' })

  return json({ ok: true, aantal: uit.length, ...await facturenStand() })
}

/* ------------------------------------------------------------------ *
 *  Wat er klaarstaat, en wat er nog mist
 * ------------------------------------------------------------------ */

async function instellingenVoorFacturen() {
  const { data } = await admin.from('instellingen')
    .select('sleutel, waarde')
    .in('sleutel', ['exact_facturen', 'exact_dagboek', 'exact_btw_21', 'exact_btw_9', 'exact_btw_0'])
  const bij = Object.fromEntries((data ?? []).map((r) => [r.sleutel, String(r.waarde ?? '').trim()]))
  return {
    aan: (bij.exact_facturen ?? 'uit') === 'aan',
    dagboek: bij.exact_dagboek ?? '',
    btw: { 21: bij.exact_btw_21 ?? '', 9: bij.exact_btw_9 ?? '', 0: bij.exact_btw_0 ?? '' },
  }
}

async function facturenStand() {
  const inst = await instellingenVoorFacturen()

  /*
   * Eén databasefunctie in plaats van een vraag per bon.
   *
   * Hier stond een lus die voor elke bon apart kaal_bedrijf() aanriep om de
   * leverancier te normaliseren. Bij tweehonderd wachtende bonnen zijn dat
   * tweehonderd heen-en-weertjes, en het zette bovendien de kennis van "wat
   * is dezelfde naam" op twee plekken. Nu doet de database het in één keer.
   */
  const [wacht, gedaan, mislukt, sync] = await Promise.all([
    admin.rpc('exact_facturen_wachtend'),
    admin.from('expenses').select('id', { count: 'exact', head: true }).not('exact_id', 'is', null),
    admin.from('expenses').select('id', { count: 'exact', head: true })
      .eq('status', 'goedgekeurd').is('exact_id', null).not('exact_fout', 'is', null),
    admin.from('exact_sync').select('*').eq('soort', 'facturen').maybeSingle(),
  ])
  if (wacht.error) throw new ExactFout(`wachtende facturen: ${wacht.error.message}`)

  const wachtend = ((wacht.data ?? []) as Record<string, unknown>[]).map((e) => {
    const mist: string[] = []
    if (!e.administratie) mist.push('bv')
    if (!e.crediteur_id) mist.push('crediteur')
    /* "grootboekrekening" betekent hier: bestaat die code ook in DEZE bv.
       De join in exact_facturen_wachtend() kijkt op code én administratie. */
    if (!e.grootboek_id) mist.push('grootboekrekening')
    if (!Number(e.bedrag)) mist.push('bedrag')
    return {
      id: String(e.id),
      leverancier: String(e.leverancier ?? ''),
      zoeknaam: String(e.zoeknaam ?? ''),
      factuurnummer: (e.factuurnummer as string) ?? null,
      bedrag: Number(e.bedrag) || 0,
      btwPct: Number(e.btw_pct) || 0,
      grootboek: (e.grootboek_code as string) ?? null,
      grootboekId: (e.grootboek_id as string) ?? null,
      crediteurId: (e.crediteur_id as string) ?? null,
      administratie: (e.administratie as string) ?? null,
      datum: Number(e.datum) || 0,
      crediteur: (e.crediteur_naam as string) ?? null,
      mist,
      fout: (e.fout as string) ?? null,
    }
  })

  const { count: crediteuren } = await admin
    .from('exact_crediteur').select('exact_id', { count: 'exact', head: true })

  return {
    aan: inst.aan,
    dagboek: inst.dagboek,
    btw: inst.btw,
    wachtend,
    /* Wat er nog moet gebeuren voordat er ook maar iets kan. */
    ontbreekt: [
      ...(inst.dagboek ? [] : ['het inkoopdagboek']),
      ...(inst.btw[21] ? [] : ['de btw-code voor 21%']),
      ...(crediteuren ? [] : ['de crediteuren uit Exact']),
    ],
    verstuurd: gedaan.count ?? 0,
    mislukt: mislukt.count ?? 0,
    crediteuren: crediteuren ?? 0,
    ...await administraties(),
    laatstAt: sync.data?.laatst_at ?? null,
    laatsteFout: sync.data?.laatste_fout ?? null,
  }
}

/* ------------------------------------------------------------------ *
 *  Lijstjes uit Exact om uit te kiezen
 *
 *  Niet opgeslagen: het zijn er een handvol en je kijkt er één keer naar,
 *  bij het instellen. Een tabel erbij die daarna nooit meer bijgewerkt wordt
 *  is een tabel die na een jaar iets anders beweert dan Exact.
 * ------------------------------------------------------------------ */

async function dagboeken(): Promise<Response> {
  const lijn = await geldigToken(admin)
  const rijen = await exactLijst<{ Code?: string; Description?: string; Type?: number }>(
    lijn, 'financial/Journals', { $select: 'Code,Description,Type' })
  /* Type 20 is het inkoopdagboek bij Exact. De rest tonen we ook maar
     onderaan -- een administratie kan afwijkend zijn ingericht. */
  return json({
    ok: true,
    dagboeken: rijen
      .map((r) => ({
        code: String(r.Code ?? '').trim(),
        naam: String(r.Description ?? '').trim(),
        inkoop: r.Type === 20,
      }))
      .filter((r) => r.code)
      .sort((a, b) => Number(b.inkoop) - Number(a.inkoop) || a.code.localeCompare(b.code)),
  })
}

async function btwCodes(): Promise<Response> {
  const lijn = await geldigToken(admin)
  const rijen = await exactLijst<{ Code?: string; Description?: string; Percentage?: number }>(
    lijn, 'vat/VATCodes', { $select: 'Code,Description,Percentage' })
  return json({
    ok: true,
    codes: rijen
      .map((r) => ({
        code: String(r.Code ?? '').trim(),
        naam: String(r.Description ?? '').trim(),
        /* Exact geeft 0.21 waar wij 21 zeggen. */
        pct: typeof r.Percentage === 'number' ? Math.round(r.Percentage * 100) : null,
      }))
      .filter((r) => r.code)
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1)),
  })
}

/* ------------------------------------------------------------------ *
 *  Met de hand koppelen
 * ------------------------------------------------------------------ */

async function koppelLeverancier(body: Record<string, unknown>, beller: Beller): Promise<Response> {
  const zoeknaam = String(body.zoeknaam ?? '').trim()
  if (!zoeknaam) return json({ ok: false, reden: 'Geen leverancier meegestuurd.' }, 400)

  const exactId = String(body.exactId ?? '').trim()
  if (!exactId) {
    await admin.from('exact_leverancier').delete().eq('zoeknaam', zoeknaam)
    return json({ ok: true, ...await facturenStand() })
  }

  const { data: cred } = await admin.from('exact_crediteur')
    .select('exact_id, naam').eq('exact_id', exactId).maybeSingle()
  if (!cred) return json({ ok: false, reden: 'Die crediteur staat niet in de opgehaalde lijst.' }, 404)

  const { error } = await admin.from('exact_leverancier').upsert({
    zoeknaam,
    gezien_als: String(body.gezienAls ?? ''),
    exact_id: exactId,
    exact_naam: cred.naam,
    bron: 'handmatig',
    door: beller.naam || beller.id,
    updated_at: Date.now(),
  }, { onConflict: 'zoeknaam' })
  if (error) return json({ ok: false, reden: error.message }, 502)

  return json({ ok: true, ...await facturenStand() })
}

/* ------------------------------------------------------------------ *
 *  Versturen
 *
 *  Het slot zit hier en niet in het scherm. Casper wilde dit alvast
 *  ingebouwd hebben maar uit laten staan, en een knop die je verstopt is
 *  geen slot -- deze functie is met een gewoon verzoek aan te roepen.
 *
 *  Verder: één bon tegelijk, en na elke bon meteen wegschrijven wat ervan
 *  kwam. Zou dat pas aan het eind gebeuren, dan is een tijdslimiet halverwege
 *  genoeg om vijf boekingen in Exact te hebben staan waarvan wij denken dat
 *  ze er niet zijn -- en de volgende ronde stuurt ze nog een keer.
 * ------------------------------------------------------------------ */

interface BoekingAntwoord {
  EntryID?: string
  EntryNumber?: number
}

async function stuurFacturen(beller: Beller): Promise<Response> {
  const inst = await instellingenVoorFacturen()
  if (!inst.aan) {
    return json({
      ok: false,
      reden: 'Facturen naar Exact staat uit. Zet hem aan bij Ontwikkeling, Exact.',
    }, 409)
  }
  if (!inst.dagboek) {
    return json({ ok: false, reden: 'Er staat geen inkoopdagboek ingesteld.' }, 409)
  }

  const lijn = await geldigToken(admin)
  const stand = await facturenStand()
  const klaar = stand.wachtend.filter((b) => b.mist.length === 0)

  let gelukt = 0
  const mislukt: { id: string; reden: string }[] = []

  for (const bon of klaar.slice(0, 25)) {
    try {
      if (!bon.crediteurId) throw new Error('geen crediteur gekoppeld')
      if (!bon.grootboekId) throw new Error(`rekening ${bon.grootboek} bestaat niet in Exact`)

      const btwCode = inst.btw[bon.btwPct as 21 | 9 | 0] ?? inst.btw[21]
      if (!btwCode) throw new Error(`geen btw-code ingesteld voor ${bon.btwPct}%`)

      /*
       * YourRef en niet InvoiceNumber. Dat laatste is bij Exact een geheel
       * getal, en een factuurnummer is bijna nooit alleen cijfers --
       * "2026-00841" of "F/44821". Erin persen levert een 400 op die niets
       * uitlegt.
       */
      /*
       * In de bv van de vestiging. Rekening 4000 bestaat in elke
       * administratie en betekent er iets anders; zonder dit belandt een
       * factuur van de wasstraat in het grootboek van de holding, en dat
       * levert geen foutmelding op -- alleen een verkeerde boeking.
       */
      if (!bon.administratie) throw new Error('geen administratie bekend voor deze bon')

      /*
       * Gesplitst of niet (0062).
       *
       * Geen regels = één boekingsregel, zoals het was. Wél regels = elke
       * regel wordt er een, met zijn eigen rekening en btw-tarief. De
       * rekening van die regel moet in DEZE bv bestaan; daarom wordt hij per
       * regel opgezocht en niet één keer voor de hele bon.
       *
       * Dat de regels optellen tot het factuurbedrag is hier geen zorg meer:
       * de database laat een bon met een verschil niet eens goedkeuren
       * (0062), en alleen goedgekeurde bonnen komen hier langs.
       */
      const { data: regels } = await admin.from('expense_regel')
        .select('omschrijving, bedrag_excl, btw_pct, grootboek_code')
        .eq('expense_id', bon.id).order('volgorde')

      let lijnen: Record<string, unknown>[]

      if ((regels ?? []).length === 0) {
        lijnen = [{
          AmountFC: bon.bedrag,
          GLAccount: bon.grootboekId,
          VATCode: btwCode,
          Description: (bon.factuurnummer ?? bon.leverancier).slice(0, 60),
        }]
      } else {
        lijnen = []
        for (const r of (regels ?? [])) {
          const code = String(r.grootboek_code ?? '').trim()
          if (!code) throw new Error('een regel van de verdeling heeft geen grootboekrekening')

          const { data: rek } = await admin.from('exact_grootboek')
            .select('exact_id').eq('code', code).eq('division', bon.administratie).maybeSingle()
          if (!rek?.exact_id) {
            throw new Error(`rekening ${code} bestaat niet in administratie ${bon.administratie}`)
          }

          const pct = Number(r.btw_pct)
          const regelBtw = inst.btw[(pct === 9 || pct === 0 ? pct : 21) as 21 | 9 | 0] ?? btwCode
          if (!regelBtw) throw new Error(`geen btw-code ingesteld voor ${pct}%`)

          lijnen.push({
            AmountFC: Number(r.bedrag_excl) || 0,
            GLAccount: rek.exact_id,
            VATCode: regelBtw,
            Description: String(r.omschrijving ?? '').trim().slice(0, 60)
              || (bon.factuurnummer ?? bon.leverancier).slice(0, 60),
          })
        }
      }

      const uit = await exactPost<BoekingAntwoord>(lijn, 'purchaseentry/PurchaseEntries', {
        Journal: inst.dagboek,
        Supplier: bon.crediteurId,
        EntryDate: exactDatum(bon.datum || Date.now()),
        Description: `${bon.leverancier}${bon.factuurnummer ? ' ' + bon.factuurnummer : ''}`.slice(0, 60),
        YourRef: (bon.factuurnummer ?? '').slice(0, 50),
        PurchaseEntryLines: lijnen,
      }, bon.administratie)

      const id = uit.EntryID ?? (uit.EntryNumber != null ? String(uit.EntryNumber) : null)
      if (!id) throw new Error('Exact gaf geen boekingsnummer terug')

      await admin.from('expenses')
        .update({ exact_id: id, exact_at: Date.now(), exact_fout: null, updated_at: Date.now() })
        .eq('id', bon.id)
      gelukt++
    } catch (e) {
      const reden = e instanceof Error ? e.message : String(e)
      await admin.from('expenses')
        .update({ exact_fout: reden.slice(0, 400), updated_at: Date.now() })
        .eq('id', bon.id)
      mislukt.push({ id: bon.id, reden })
    }
  }

  await admin.from('exact_sync').upsert({
    soort: 'facturen',
    laatst_at: Date.now(),
    aantal: gelukt,
    laatste_fout: mislukt.length > 0 ? `${mislukt.length} mislukt` : null,
    door: beller.naam || beller.id,
    updated_at: Date.now(),
  }, { onConflict: 'soort' })

  return json({ ok: true, gelukt, mislukt, ...await facturenStand() })
}

/* ------------------------------------------------------------------ *
 *  Het personeel
 *
 *  Exporteren kan niet, en dat is geen keuze van ons: payroll/Employees in
 *  de Exact-API doet GET en verder niets. Geen POST, geen PUT. Wie daar een
 *  export op bouwt, bouwt iets dat stil geweigerd wordt.
 *
 *  Wat wel kan is de andere kant op kijken, en dat blijkt nuttiger dan het
 *  klinkt. Drie vragen worden hiermee beantwoord, en de derde is de reden
 *  dat dit er staat: wie is er in Exact uit dienst terwijl hij hier nog
 *  actief is? Dat is iemand die weg is en nog steeds kan inloggen.
 *
 *  Bewust zonder BSN en geboortedatum -- zie de kop van migratie 0054.
 * ------------------------------------------------------------------ */

interface ExactMedewerker {
  ID?: string
  EmployeeHID?: number
  FullName?: string
  FirstName?: string
  LastName?: string
  Email?: string
  PrivateEmail?: string
  StartDate?: string
  EndDate?: string
  IsActive?: boolean
}

/**
 * Een datum van Exact naar milliseconden.
 *
 * Exact levert OData v2, en dat schrijft datums als "/Date(1735689600000)/".
 * Nieuwere velden komen als gewone ISO-tekst terug. Allebei opvangen, en bij
 * iets onbekends null -- een verkeerd gelezen datum in dienst is erger dan
 * een lege.
 */
function exactMs(waarde: string | undefined): number | null {
  if (!waarde) return null
  const odata = /^\/Date\((-?\d+)/.exec(waarde)
  if (odata) return Number(odata[1])
  const t = Date.parse(waarde)
  return Number.isFinite(t) ? t : null
}

async function syncPersoneel(beller: Beller): Promise<Response> {
  const lijn = await geldigToken(admin)

  /*
   * Met opzet zonder $select.
   *
   * Casper wil bij het koppelen "alle dingen" erbij zien, en een vaste lijst
   * velden betekent dat je ze allemaal bij naam moet kennen. Eén veldnaam die
   * niet bestaat en Exact weigert het hele verzoek -- dan werkt de sync niet
   * en wijst de foutmelding naar niets. Zonder $select komt alles mee; wat we
   * zeker weten gaat in eigen kolommen, de rest blijft in ruw staan.
   */
  const rijen = await exactLijst<ExactMedewerker>(lijn, 'payroll/Employees')

  const nu = Date.now()
  const uit = rijen
    .filter((r) => typeof r.EmployeeHID === 'number')
    .map((r) => ({
      employee_hid: r.EmployeeHID as number,
      exact_id: r.ID ?? null,
      volledige_naam: String(r.FullName ?? `${r.FirstName ?? ''} ${r.LastName ?? ''}`).trim(),
      voornaam: r.FirstName ?? null,
      achternaam: r.LastName ?? null,
      email: r.Email ?? null,
      prive_email: r.PrivateEmail ?? null,
      in_dienst_per: exactMs(r.StartDate),
      uit_dienst_per: exactMs(r.EndDate),
      actief: r.IsActive !== false,
      /* Alles wat Exact meestuurde. Hierin kan een BSN zitten; deze tabel is
         daarom management-only, net als het dossier (0009). */
      ruw: r as unknown as Record<string, unknown>,
      division: lijn.division,
      updated_at: nu,
    }))

  if (uit.length > 0) {
    for (let i = 0; i < uit.length; i += 200) {
      const { error } = await admin.from('exact_personeel')
        .upsert(uit.slice(i, i + 200), { onConflict: 'employee_hid' })
      if (error) throw new ExactFout(`exact_personeel schrijven: ${error.message}`)
    }
    await admin.from('exact_personeel').delete().lt('updated_at', nu)
  }

  /*
   * Koppelen op e-mailadres, en alleen daarop.
   *
   * Op naam matchen is aanlokkelijk en fout: twee mensen die De Vries heten
   * is geen uitzondering maar de regel, en een verkeerde koppeling stuurt
   * straks de uren van de een naar de loonstrook van de ander. Een adres is
   * uniek of het is er niet. Wat overblijft koppelt een mens met de hand.
   */
  const { data: mensen } = await admin.from('profiles').select('id, email, name, active')
  const opAdres = new Map<string, number>()
  for (const r of uit) {
    for (const adres of [r.email, r.prive_email]) {
      const k = (adres ?? '').trim().toLowerCase()
      if (k) opAdres.set(k, r.employee_hid)
    }
  }

  const { data: bestaand } = await admin.from('exact_medewerker').select('user_id, employee_hid, bron')
  const alGekoppeld = new Set((bestaand ?? []).map((r) => String(r.user_id)))
  const bezet = new Set((bestaand ?? []).map((r) => Number(r.employee_hid)))

  const nieuw: { user_id: string; employee_hid: number; bron: string; door: string; updated_at: number }[] = []
  for (const m of (mensen ?? [])) {
    if (alGekoppeld.has(String(m.id))) continue
    const hid = opAdres.get(String(m.email ?? '').trim().toLowerCase())
    /* Een nummer dat al aan iemand anders hangt slaan we over; dat is een
       geval voor een mens, niet voor een regel. */
    if (hid == null || bezet.has(hid)) continue
    bezet.add(hid)
    nieuw.push({
      user_id: String(m.id),
      employee_hid: hid,
      bron: 'email',
      door: beller.naam || beller.id,
      updated_at: nu,
    })
  }
  if (nieuw.length > 0) {
    await admin.from('exact_medewerker').upsert(nieuw, { onConflict: 'user_id' })
  }

  await admin.from('exact_sync').upsert({
    soort: 'personeel',
    laatst_at: nu,
    aantal: uit.length,
    laatste_fout: null,
    door: beller.naam || beller.id,
    updated_at: nu,
  }, { onConflict: 'soort' })

  return json({ ok: true, aantal: uit.length, gekoppeld: nieuw.length, ...await personeelStand() })
}

async function personeelStand() {
  const [onze, hunne, koppel, sync] = await Promise.all([
    admin.from('profiles').select('id, name, email, active').order('name'),
    admin.from('exact_personeel').select('*').order('volledige_naam'),
    admin.from('exact_medewerker').select('user_id, employee_hid, bron'),
    admin.from('exact_sync').select('*').eq('soort', 'personeel').maybeSingle(),
  ])

  const bijHid = new Map<number, Record<string, unknown>>()
  for (const r of (hunne.data ?? [])) bijHid.set(Number(r.employee_hid), r)

  const link = new Map<string, { hid: number; bron: string }>()
  for (const r of (koppel.data ?? [])) {
    link.set(String(r.user_id), { hid: Number(r.employee_hid), bron: String(r.bron) })
  }

  const regels = (onze.data ?? []).map((m) => {
    const k = link.get(String(m.id))
    const e = k ? bijHid.get(k.hid) : undefined
    const uitDienst = e ? (e.uit_dienst_per as number | null) : null
    return {
      userId: String(m.id),
      naam: String(m.name ?? ''),
      email: String(m.email ?? ''),
      actief: m.active === true,
      employeeHid: k?.hid ?? null,
      koppelBron: k?.bron ?? null,
      exactNaam: e ? String(e.volledige_naam ?? '') : null,
      exactActief: e ? e.actief === true : null,
      uitDienstPer: uitDienst,
      /*
       * Waar het om begonnen was: uit dienst bij Exact, hier nog actief.
       * Dat is iemand die weg is en nog steeds kan inloggen.
       */
      wegMaarActief: Boolean(m.active === true && e
        && (e.actief === false || (typeof uitDienst === 'number' && uitDienst < Date.now()))),
    }
  })

  const gekoppeldeHids = new Set([...link.values()].map((v) => v.hid))

  /*
   * Iedereen die Exact kent, met genoeg erbij om in te kunnen zoeken. Het
   * volledige record blijft hier weg: dat is per medewerker tientallen velden
   * en gaat alleen mee als je er eentje opent (medewerker-details).
   */
  const exactMensen = (hunne.data ?? []).map((r) => ({
    employeeHid: Number(r.employee_hid),
    naam: String(r.volledige_naam ?? ''),
    email: String(r.email ?? ''),
    priveEmail: String(r.prive_email ?? ''),
    actief: r.actief === true,
    inDienstPer: (r.in_dienst_per as number | null) ?? null,
    uitDienstPer: (r.uit_dienst_per as number | null) ?? null,
    /* Aan wie hij al hangt; het scherm laat dat zien in plaats van pas bij
       het opslaan te melden dat het nummer bezet is. */
    gekoppeldAan: gekoppeldeHids.has(Number(r.employee_hid))
      ? ([...link.entries()].find(([, v]) => v.hid === Number(r.employee_hid))?.[0] ?? null)
      : null,
  }))

  const alleenInExact = exactMensen.filter((r) => r.gekoppeldAan === null)

  return {
    regels,
    exactMensen,
    alleenInExact,
    /* Wie hier werkt en in Exact niet te vinden is. */
    zonderKoppeling: regels.filter((r) => r.actief && r.employeeHid == null).length,
    weg: regels.filter((r) => r.wegMaarActief).length,
    exactAantal: (hunne.data ?? []).length,
    laatstAt: sync.data?.laatst_at ?? null,
    laatsteFout: sync.data?.laatste_fout ?? null,
    door: sync.data?.door ?? null,
  }
}

/**
 * Alles wat Exact over deze medewerker weet.
 *
 * Apart van de lijst gehouden, en dat is met opzet. Het volledige record is
 * per persoon tientallen velden en kan een BSN bevatten; dat hoort niet in
 * een overzicht mee te reizen dat je alleen maar opent om te zien wie waar
 * bij hoort. Het komt pas mee als je er een openslaat.
 */
async function medewerkerDetails(body: Record<string, unknown>): Promise<Response> {
  const hid = Number(body.employeeHid)
  if (!Number.isInteger(hid)) {
    return json({ ok: false, reden: 'Geen medewerkernummer meegestuurd.' }, 400)
  }
  const { data, error } = await admin.from('exact_personeel')
    .select('*').eq('employee_hid', hid).maybeSingle()
  if (error) return json({ ok: false, reden: error.message }, 502)
  if (!data) return json({ ok: false, reden: 'Die medewerker staat niet in de opgehaalde lijst.' }, 404)

  return json({
    ok: true,
    employeeHid: hid,
    naam: data.volledige_naam,
    /* Wat Exact stuurde, zoals het binnenkwam. Het scherm zet er de leesbare
       namen bij die het kent en toont de rest zoals hij is. */
    velden: data.ruw ?? {},
  })
}

/** Met de hand zeggen wie wie is. employeeHid leeg = de koppeling weghalen. */
async function koppelMedewerker(body: Record<string, unknown>, beller: Beller): Promise<Response> {
  const userId = String(body.userId ?? '').trim()
  if (!userId) return json({ ok: false, reden: 'Geen medewerker meegestuurd.' }, 400)

  const ruw = body.employeeHid
  if (ruw === null || ruw === '' || ruw === undefined) {
    await admin.from('exact_medewerker').delete().eq('user_id', userId)
    return json({ ok: true, ...await personeelStand() })
  }

  const hid = Number(ruw)
  if (!Number.isInteger(hid) || hid <= 0) {
    return json({ ok: false, reden: 'Dat is geen medewerkernummer.' }, 400)
  }

  /*
   * Het nummer mag maar aan één iemand hangen. De database bewaakt dat ook,
   * maar een nette melding is beter dan een foutcode uit Postgres.
   */
  const { data: bezet } = await admin.from('exact_medewerker')
    .select('user_id').eq('employee_hid', hid).maybeSingle()
  if (bezet && String(bezet.user_id) !== userId) {
    return json({ ok: false, reden: 'Dat medewerkernummer hangt al aan iemand anders.' }, 409)
  }

  const { error } = await admin.from('exact_medewerker').upsert({
    user_id: userId,
    employee_hid: hid,
    bron: 'handmatig',
    door: beller.naam || beller.id,
    updated_at: Date.now(),
  }, { onConflict: 'user_id' })
  if (error) return json({ ok: false, reden: error.message }, 502)

  return json({ ok: true, ...await personeelStand() })
}

/* ------------------------------------------------------------------ *
 *  Mag deze beller bij het personeel
 *
 *  Een andere grens dan bij het rekeningschema. Daar mocht ontwikkeling
 *  meekijken; hier gaat het om mensen, en geldt dezelfde grens als bij het
 *  dossier: het management en wie personeel mag inzien.
 * ------------------------------------------------------------------ */

async function magPersoneel(req: Request): Promise<boolean> {
  /*
   * Alleen het management, en niet staff.view. Het volledige Exact-record
   * gaat hier langs en daar kan een BSN in zitten; dat ligt in 0009 bij het
   * management en bij de medewerker zelf. Een ruimere deur hier zou die
   * afspraak omzeilen.
   */
  return await heeftRecht(req, null, ['management'])
}

/* ------------------------------------------------------------------ *
 *  Mag deze beller bij de administratie
 *
 *  Het ophalen van het rekeningschema is administratiewerk en geen
 *  ontwikkelwerk. wieBelt() kijkt naar de rollen rond Trucksupply; hier gaat
 *  het om het recht admin.desk, en dat weet alleen de database.
 * ------------------------------------------------------------------ */

async function magAdministratie(req: Request): Promise<boolean> {
  return await heeftRecht(req, 'admin.desk', ['administratie', 'management'])
}

/**
 * Heeft de beller dit recht, via een rol of los toegekend?
 *
 * Eén plek, want dit stond er twee keer bijna hetzelfde en dat is precies
 * hoe twee controles uit elkaar gaan lopen.
 *
 * recht mag null zijn: dan telt alleen de rol. Dat is geen gemak maar een
 * keuze -- bij het personeel wil je juist géén achterdeur via een los
 * toegekend recht, want dan is de grens ruimer dan die van het dossier.
 */
async function heeftRecht(
  req: Request,
  recht: string | null,
  rollen: string[],
): Promise<boolean> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return false
  const { data } = await admin.auth.getUser(token)
  if (!data.user) return false

  const { data: profiel } = await admin
    .from('profiles')
    .select('roles, active, grants, revokes')
    .eq('auth_id', data.user.id)
    .maybeSingle()
  if (!profiel?.active) return false

  const mijn = (profiel.roles ?? []) as string[]
  const toegekend = (profiel.grants ?? []) as string[]
  const ingetrokken = (profiel.revokes ?? []) as string[]
  if (recht === null) return rollen.some((r) => mijn.includes(r))
  if (ingetrokken.includes(recht)) return false
  return rollen.some((r) => mijn.includes(r)) || toegekend.includes(recht)
}

/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)

  /* --- de redirect van Exact: een browser, geen token --- */
  if (req.method === 'GET') {
    const actie = url.searchParams.get('actie') ?? ''
    if (actie === 'terug' || url.searchParams.has('code') || url.searchParams.has('error')) {
      try {
        return await terug(url)
      } catch (e) {
        console.error('[exact] terug', e)
        return pagina('Niet gekoppeld', 'Er ging iets mis bij het opslaan van de koppeling. Probeer het opnieuw.', 500)
      }
    }
    return pagina('Exact-koppeling', 'Deze pagina is alleen bedoeld voor de terugkeer vanuit Exact Online.', 404)
  }

  if (req.method !== 'POST') return json({ ok: false, reden: 'Alleen GET of POST.' }, 405)

  const beller = await wieBelt(req)
  if (!beller) return json({ ok: false, reden: 'Hier mag je niet bij.' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, reden: 'Onleesbaar verzoek.' }, 400)
  }
  const actie = String(body.actie ?? '')

  try {
    if (actie === 'status') {
      return json({ ok: true, ...await stand(beller) })
    }

    if (actie === 'instellen') {
      if (!beller.magSleutels) {
        return json({ ok: false, reden: 'Alleen ontwikkeling en management mogen de sleutels zetten.' }, 403)
      }
      return await instellen(body, beller)
    }

    if (actie === 'verbind-url') {
      const sleutels = sleutelsVan(await koppeling())
      if (!sleutels.clientId) {
        return json({ ok: false, reden: 'Er staat nog geen client-id van Exact. Zet die eerst bij Ontwikkeling, Exact.' }, 400)
      }
      /* Een nieuwe state per poging; de vorige vervalt daarmee. */
      const state = crypto.randomUUID()
      await bewaar({ state, state_at: Date.now(), verbonden_door: beller.naam || beller.id, laatste_fout: null })

      const link = new URL(`${sleutels.basis}/api/oauth2/auth`)
      link.searchParams.set('client_id', sleutels.clientId)
      link.searchParams.set('redirect_uri', sleutels.redirect)
      link.searchParams.set('response_type', 'code')
      link.searchParams.set('state', state)
      /* Altijd opnieuw inloggen bij Exact: dit is de boekhouding, en de
         browser van een kantoormedewerker staat de hele dag open. */
      link.searchParams.set('force_login', '1')
      return json({ ok: true, url: link.toString() })
    }

    /* ---- de administraties ---- */

    if (actie === 'sync-administraties' || actie === 'zet-administratie') {
      if (!beller.magSleutels && !(await magAdministratie(req))) {
        return json({ ok: false, reden: 'Hier mag je niet bij.' }, 403)
      }
      if (actie === 'sync-administraties') return await syncAdministraties()
      return await zetAdministratie(body)
    }

    /* ---- het rekeningschema ophalen ---- */

    if (actie === 'sync-grootboek') {
      if (!beller.magSleutels && !(await magAdministratie(req))) {
        return json({ ok: false, reden: 'Hier mag je niet bij.' }, 403)
      }
      return await syncGrootboek(beller)
    }

    if (actie === 'grootboek-stand') {
      return json({ ok: true, ...await grootboekStand() })
    }

    /* ---- het personeel ---- */

    if (actie === 'sync-personeel' || actie === 'personeel-stand'
        || actie === 'koppel-medewerker' || actie === 'medewerker-details') {
      if (!(await magPersoneel(req))) {
        return json({ ok: false, reden: 'Personeelsgegevens zijn niet voor iedereen.' }, 403)
      }
      if (actie === 'sync-personeel') return await syncPersoneel(beller)
      if (actie === 'koppel-medewerker') return await koppelMedewerker(body, beller)
      if (actie === 'medewerker-details') return await medewerkerDetails(body)
      return json({ ok: true, ...await personeelStand() })
    }

    /* ---- facturen ---- */

    if (actie === 'sync-crediteuren' || actie === 'facturen-stand'
        || actie === 'stuur-facturen' || actie === 'koppel-leverancier'
        || actie === 'dagboeken' || actie === 'btw-codes') {
      if (!beller.magSleutels && !(await magAdministratie(req))) {
        return json({ ok: false, reden: 'Hier mag je niet bij.' }, 403)
      }
      if (actie === 'sync-crediteuren') return await syncCrediteuren(beller)
      if (actie === 'stuur-facturen') return await stuurFacturen(beller)
      if (actie === 'koppel-leverancier') return await koppelLeverancier(body, beller)
      if (actie === 'dagboeken') return await dagboeken()
      if (actie === 'btw-codes') return await btwCodes()
      return json({ ok: true, ...await facturenStand() })
    }

    if (actie === 'los') {
      await bewaar({
        access_token: null,
        refresh_token: null,
        token_verloopt_at: null,
        status: 'los',
        state: null,
        state_at: null,
        laatste_fout: null,
      })
      return json({ ok: true })
    }

    return json({ ok: false, reden: 'Onbekende actie.' }, 400)
  } catch (e) {
    console.error(`[exact] ${actie}`, e)
    /*
     * Een ExactFout weet zelf wat er aan de hand is. Het verschil dat ertoe
     * doet is "koppel opnieuw" tegenover "Exact had het even niet": bij het
     * eerste moet iemand iets doen, bij het tweede is wachten genoeg. Alles
     * over één kam scheren als 502 laat het scherm dat niet zien.
     */
    if (e instanceof ExactFout) {
      if (actie === 'sync-grootboek' || actie === 'sync-personeel') {
        await admin.from('exact_sync').upsert({
          soort: actie === 'sync-personeel' ? 'personeel' : 'grootboek',
          laatste_fout: e.message.slice(0, 400),
          updated_at: Date.now(),
        }, { onConflict: 'soort' }).then(() => {}, () => {})
      }
      return json({ ok: false, reden: e.message, opnieuwKoppelen: e.opnieuwKoppelen }, e.status)
    }
    return json({ ok: false, reden: String((e as Error).message ?? e) }, 502)
  }
})
