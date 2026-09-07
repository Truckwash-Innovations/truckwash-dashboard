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
import { ExactFout, exactLijst, geldigToken } from '../_gedeeld/exact.ts'

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

/** Het terugkeeradres. Naar onszelf, dus alleen https en zonder anker. */
function schoonRedirect(ruw: string): string | null {
  let u: URL
  try {
    u = new URL(ruw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.hash) return null
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
    return pagina('Niet gekoppeld',
      'Deze koppelpoging is niet herkend of verlopen. Begin opnieuw vanuit het dashboard, bij Instellingen.', 400)
  }

  if (fout || !code) {
    /* De state klopt, dus dit is echt Exact: iemand heeft daar op "weigeren"
       gedrukt, of Exact kwam zonder code terug. Nu mag de poging dicht. */
    await bewaar({ state: null, state_at: null, laatste_fout: fout ? `Exact: ${fout.slice(0, 200)}` : 'Teruggekomen zonder code' })
    return pagina('Niet gekoppeld',
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
    return pagina('Niet gekoppeld',
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
    return pagina('Niet gekoppeld',
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

  return pagina('Gekoppeld', 'Exact Online is gekoppeld. Je kunt dit venster sluiten.')
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
        return json({ ok: false, reden: 'Het terugkeeradres moet een https-adres zijn zonder anker.' }, 400)
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

  const rijen = await exactLijst<ExactGL>(lijn, 'financial/GLAccounts', {
    $select: 'ID,Code,Description,IsBlocked,Type',
    $orderby: 'Code',
  })

  const nu = Date.now()
  const uit = rijen
    .map((r) => ({
      code: String(r.Code ?? '').trim(),
      omschrijving: String(r.Description ?? '').trim(),
      exact_id: r.ID ?? null,
      soort: typeof r.Type === 'number' ? (GL_SOORTEN[r.Type] ?? String(r.Type)) : null,
      geblokkeerd: r.IsBlocked === true,
      division: lijn.division,
      updated_at: nu,
    }))
    .filter((r) => r.code !== '')

  if (uit.length > 0) {
    /* In brokken, want een administratie met honderden rekeningen in één
       verzoek is een tijdslimiet die je een keer haalt en daarna niet meer. */
    for (let i = 0; i < uit.length; i += 200) {
      const { error } = await admin.from('exact_grootboek')
        .upsert(uit.slice(i, i + 200), { onConflict: 'code' })
      if (error) throw new ExactFout(`exact_grootboek schrijven: ${error.message}`)
    }

    /*
     * Rekeningen die er niet meer zijn, of die uit een andere administratie
     * komen. Zonder dit blijft de lijst van het proefaccount naast die van de
     * echte staan, en dan lijkt elke code te bestaan.
     */
    await admin.from('exact_grootboek').delete().lt('updated_at', nu)
  }

  await admin.from('exact_sync').upsert({
    soort: 'grootboek',
    laatst_at: nu,
    aantal: uit.length,
    laatste_fout: null,
    door: beller.naam || beller.id,
    updated_at: nu,
  }, { onConflict: 'soort' })

  return json({ ok: true, aantal: uit.length, division: lijn.division, ...await grootboekStand() })
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
    admin.from('grootboek').select('code, naam, actief').order('code'),
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
      actief: g.actief === true,
      inExact: Boolean(e),
      exactNaam: e?.omschrijving ?? null,
      exactSoort: e?.soort ?? null,
      geblokkeerd: e?.geblokkeerd ?? false,
    }
  })

  return {
    regels,
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
 *  Mag deze beller bij de administratie
 *
 *  Het ophalen van het rekeningschema is administratiewerk en geen
 *  ontwikkelwerk. wieBelt() kijkt naar de rollen rond Trucksupply; hier gaat
 *  het om het recht admin.desk, en dat weet alleen de database.
 * ------------------------------------------------------------------ */

async function magAdministratie(req: Request): Promise<boolean> {
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

  const rollen = (profiel.roles ?? []) as string[]
  const toegekend = (profiel.grants ?? []) as string[]
  const ingetrokken = (profiel.revokes ?? []) as string[]
  if (ingetrokken.includes('admin.desk')) return false
  return rollen.includes('administratie') || rollen.includes('management')
    || toegekend.includes('admin.desk')
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
      if (actie === 'sync-grootboek') {
        await admin.from('exact_sync').upsert({
          soort: 'grootboek',
          laatste_fout: e.message.slice(0, 400),
          updated_at: Date.now(),
        }, { onConflict: 'soort' }).then(() => {}, () => {})
      }
      return json({ ok: false, reden: e.message, opnieuwKoppelen: e.opnieuwKoppelen }, e.status)
    }
    return json({ ok: false, reden: String((e as Error).message ?? e) }, 502)
  }
})
