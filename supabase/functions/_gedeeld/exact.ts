/* ===========================================================================
 *  Praten met Exact Online
 *
 *  Eén plek waar alles staat wat je nodig hebt om iets bij Exact op te
 *  vragen of erheen te sturen. De functie exact/ deed tot nu toe alleen het
 *  koppelen; zodra er ook gegevens over en weer gaan, komt er van alles bij
 *  dat je maar één keer goed wilt schrijven.
 *
 *  Het token leeft tien minuten
 *  ----------------------------
 *
 *  Dit is het stuk dat bij elke eerste poging vergeten wordt. Exact geeft een
 *  toegangstoken dat 600 seconden geldig is. Wie het bij het koppelen opslaat
 *  en later gewoon gebruikt, heeft een koppeling die precies tien minuten
 *  werkt en daarna voorgoed 401 geeft -- zonder dat er iets aan de koppeling
 *  zelf mis is.
 *
 *  En één addertje daaronder, dat erger is: Exact geeft bij het verversen een
 *  NIEUW refresh-token terug en trekt het oude in. Sla je dat niet op, dan
 *  werkt de eerste verversing en is de koppeling daarna definitief dood --
 *  ook opnieuw proberen helpt niet meer, want het token dat je bewaard hebt
 *  bestaat niet meer. Dan is er niets anders dan opnieuw koppelen.
 *
 *  Daarom schrijft geldigToken() het nieuwe stel altijd meteen weg, vóór het
 *  antwoord wordt gebruikt, en niet achteraf.
 *
 *  Twee verzoeken tegelijk
 *  -----------------------
 *
 *  Draaien er twee syncs door elkaar heen, dan zouden ze allebei kunnen gaan
 *  verversen met hetzelfde oude refresh-token; de tweede krijgt dan een fout
 *  en gooit de koppeling weg terwijl er niets aan de hand is. De marge van
 *  een minuut (VERSE_MARGE) maakt dat onwaarschijnlijk, en bij een fout op de
 *  verversing blijft het opgeslagen token staan in plaats van gewist te
 *  worden. Zeker weten doe je dat pas met een slot in de database; dat is de
 *  moeite nog niet waard bij het aantal aanroepen dat hier langskomt.
 *
 *  Wat Exact teruggeeft
 *  --------------------
 *
 *  OData versie 2, en dat ziet er anders uit dan je verwacht: geen
 *  { value: [...] } maar { d: { results: [...], __next: "..." } }. Bovendien
 *  antwoordt Exact in XML als je niet met zoveel woorden om JSON vraagt.
 *  Beide zitten hier in verwerkt, zodat niemand het per ongeluk anders doet.
 * =========================================================================== */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

/* ------------------------------------------------------------------ *
 *  De rij met de koppeling
 * ------------------------------------------------------------------ */

export interface ExactRij {
  division: string | null
  access_token: string | null
  refresh_token: string | null
  token_verloopt_at: number | null
  status: string
  client_id: string | null
  client_geheim: string | null
  basis_url: string | null
  omgeving: string | null
}

/** Wat er nodig is om te praten: adres, administratie en een vers token. */
export interface ExactLijn {
  basis: string
  division: string
  token: string
  omgeving: 'proef' | 'echt'
}

export class ExactFout extends Error {
  /** true als opnieuw koppelen de enige uitweg is. */
  readonly opnieuwKoppelen: boolean
  readonly status: number

  constructor(bericht: string, opties: { opnieuwKoppelen?: boolean; status?: number } = {}) {
    super(bericht)
    this.name = 'ExactFout'
    this.opnieuwKoppelen = opties.opnieuwKoppelen ?? false
    this.status = opties.status ?? 502
  }
}

const STANDAARD_BASIS = 'https://start.exactonline.nl'

/*
 * Ververs zodra er minder dan een minuut over is. Een verzoek dat begint met
 * nog vijf seconden op de klok komt terug met 401 terwijl het token "geldig"
 * was; die minuut dekt de reistijd en het verschil tussen twee klokken.
 */
const VERSE_MARGE_MS = 60_000

/* ------------------------------------------------------------------ *
 *  Een vers token
 * ------------------------------------------------------------------ */

async function leesRij(admin: SupabaseClient): Promise<ExactRij | null> {
  const { data, error } = await admin
    .from('exact_koppeling')
    .select('division, access_token, refresh_token, token_verloopt_at, status,' +
            ' client_id, client_geheim, basis_url, omgeving')
    .eq('id', 'exact')
    .maybeSingle()
  if (error) throw new ExactFout(`exact_koppeling lezen: ${error.message}`)
  return (data ?? null) as ExactRij | null
}

/**
 * Een bruikbare lijn naar Exact, of een fout die zegt wat eraan mankeert.
 *
 * Ververst onderweg het token als dat nodig is, en schrijft het nieuwe stel
 * meteen weg -- zie de kop van dit bestand voor waarom dat niet mag wachten.
 */
export async function geldigToken(admin: SupabaseClient): Promise<ExactLijn> {
  const rij = await leesRij(admin)

  if (!rij || !rij.refresh_token || rij.status !== 'verbonden') {
    throw new ExactFout('Er is geen koppeling met Exact. Koppel eerst bij Ontwikkeling, Exact.',
      { opnieuwKoppelen: true, status: 409 })
  }
  if (!rij.division) {
    throw new ExactFout('De koppeling kent nog geen administratienummer (division).', { status: 409 })
  }

  const basis = (rij.basis_url ?? '').trim() || STANDAARD_BASIS
  const omgeving: 'proef' | 'echt' = rij.omgeving === 'echt' ? 'echt' : 'proef'

  /* Nog ruim geldig: gebruiken zoals hij is. */
  const over = (rij.token_verloopt_at ?? 0) - Date.now()
  if (rij.access_token && over > VERSE_MARGE_MS) {
    return { basis, division: rij.division, token: rij.access_token, omgeving }
  }

  /* --- verversen --- */

  const clientId = (rij.client_id ?? '').trim() || (Deno.env.get('EXACT_CLIENT_ID') ?? '').trim()
  const geheim = (rij.client_geheim ?? '').trim() || (Deno.env.get('EXACT_CLIENT_SECRET') ?? '').trim()
  if (!clientId || !geheim) {
    throw new ExactFout('De sleutels van de Exact-app ontbreken.', { status: 409 })
  }

  const res = await fetch(`${basis}/api/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: rij.refresh_token,
      client_id: clientId,
      client_secret: geheim,
    }),
  })

  let uit: {
    access_token?: string
    refresh_token?: string
    expires_in?: number | string
    error?: string
    error_description?: string
  } = {}
  try {
    uit = await res.json()
  } catch { /* hieronder afgevangen */ }

  if (!res.ok || !uit.access_token) {
    /*
     * Onderscheid maken loont hier. Een 400 met invalid_grant betekent dat het
     * refresh-token niet meer geldt -- dan is opnieuw koppelen de enige weg en
     * moet het scherm dat zeggen. Een 500 of een netwerkstoring bij Exact is
     * iets heel anders en gaat vanzelf over; daar hoort de koppeling niet voor
     * weggegooid te worden.
     */
    const kwijt = res.status === 400 || res.status === 401
    const reden = uit.error_description || uit.error || `token ${res.status}`
    if (kwijt) {
      await admin.from('exact_koppeling').update({
        status: 'los',
        access_token: null,
        refresh_token: null,
        token_verloopt_at: null,
        laatste_fout: `Verversen geweigerd: ${String(reden).slice(0, 200)}`,
        updated_at: Date.now(),
      }).eq('id', 'exact')
      throw new ExactFout('Exact heeft de koppeling ingetrokken. Koppel opnieuw.',
        { opnieuwKoppelen: true, status: 409 })
    }
    throw new ExactFout(`Het token verversen lukte niet: ${String(reden).slice(0, 200)}`)
  }

  const seconden = Number(uit.expires_in ?? 600) || 600
  const nieuw = {
    access_token: uit.access_token,
    /* Exact rotéért het refresh-token. Komt er geen nieuwe mee, dan blijft de
       oude staan -- maar hem overschrijven met null zou de koppeling slopen. */
    refresh_token: uit.refresh_token || rij.refresh_token,
    token_verloopt_at: Date.now() + seconden * 1000,
    laatste_fout: null,
    updated_at: Date.now(),
  }

  const { error: schrijf } = await admin.from('exact_koppeling').update(nieuw).eq('id', 'exact')
  if (schrijf) {
    /*
     * Wegschrijven mislukt terwijl Exact het oude refresh-token al heeft
     * ingetrokken: dan is het nieuwe stel alleen nog hier in het geheugen. Dit
     * verzoek nog laten slagen zou de fout verbergen tot de volgende keer, en
     * dan is er niets meer om mee te verversen.
     */
    throw new ExactFout(
      `Het verse token kon niet worden opgeslagen (${schrijf.message}). ` +
      'Waarschijnlijk moet er opnieuw gekoppeld worden.',
      { opnieuwKoppelen: true })
  }

  return { basis, division: rij.division, token: uit.access_token, omgeving }
}

/* ------------------------------------------------------------------ *
 *  Opvragen
 * ------------------------------------------------------------------ */

/** Hoeveel pagina's we maximaal ophalen. Een rekeningschema is geen archief. */
const MAX_PAGINAS = 40

interface ODataAntwoord<T> {
  d?: { results?: T[]; __next?: string } | T[]
}

/**
 * Alle rijen van een Exact-resource, pagina voor pagina.
 *
 * `pad` is het stuk na de administratie, bijvoorbeeld 'financial/GLAccounts'.
 * Exact levert per pagina een beperkt aantal rijen met een __next erbij; die
 * volgen we tot hij op is.
 */
export async function exactLijst<T = Record<string, unknown>>(
  lijn: ExactLijn,
  pad: string,
  query: Record<string, string> = {},
): Promise<T[]> {
  const eerste = new URL(`${lijn.basis}/api/v1/${lijn.division}/${pad}`)
  for (const [k, v] of Object.entries(query)) eerste.searchParams.set(k, v)

  const alles: T[] = []
  let volgende: string | null = eerste.toString()
  let paginas = 0

  while (volgende && paginas < MAX_PAGINAS) {
    const res = await fetch(volgende, {
      headers: {
        Authorization: `Bearer ${lijn.token}`,
        /* Zonder dit antwoordt Exact in XML. */
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      const tekst = (await res.text()).slice(0, 300)
      throw new ExactFout(`Exact gaf ${res.status} op ${pad}: ${tekst}`,
        { opnieuwKoppelen: res.status === 401, status: 502 })
    }

    const uit = await res.json() as ODataAntwoord<T>
    /* Exact levert normaal { d: { results: [...] } }; bij sommige resources
       staat de array rechtstreeks onder d. Allebei opvangen. */
    const blok = Array.isArray(uit.d) ? uit.d : (uit.d?.results ?? [])
    alles.push(...blok)

    volgende = (!Array.isArray(uit.d) && uit.d?.__next) ? uit.d.__next : null
    paginas++
  }

  return alles
}

/** Eén ding naar Exact sturen. Geeft terug wat Exact ervan maakte. */
export async function exactPost<T = Record<string, unknown>>(
  lijn: ExactLijn,
  pad: string,
  lijf: unknown,
): Promise<T> {
  const res = await fetch(`${lijn.basis}/api/v1/${lijn.division}/${pad}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${lijn.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(lijf),
  })

  const tekst = await res.text()
  if (!res.ok) {
    /*
     * De foutmelding van Exact is het enige wat je hebt als een boeking wordt
     * geweigerd -- "de rekening bestaat niet in deze administratie", "de
     * periode is afgesloten". Die hoort mee terug naar het scherm, ingekort
     * maar niet weggegooid.
     */
    throw new ExactFout(`Exact weigerde ${pad} (${res.status}): ${tekst.slice(0, 400)}`,
      { opnieuwKoppelen: res.status === 401, status: 502 })
  }

  try {
    const uit = JSON.parse(tekst) as ODataAntwoord<T>
    if (Array.isArray(uit.d)) return uit.d[0] as T
    if (uit.d && 'results' in uit.d) return (uit.d.results?.[0] ?? {}) as T
    return (uit.d ?? {}) as T
  } catch {
    return {} as T
  }
}

/* ------------------------------------------------------------------ *
 *  Wat Exact van een datum vindt
 * ------------------------------------------------------------------ */

/**
 * Exact wil een datum als ISO-tekst zonder tijdzone-gedoe.
 *
 * Een factuurdatum is een dag en geen moment. Sturen we er middernacht in de
 * lokale tijd heen, dan wordt het in de winter de dag ervoor -- en dan valt
 * een factuur van 1 januari in het vorige boekjaar. Daarom altijd op UTC en
 * op middernacht.
 */
export function exactDatum(ms: number): string {
  const d = new Date(ms)
  const jaar = d.getUTCFullYear()
  const maand = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dag = String(d.getUTCDate()).padStart(2, '0')
  return `${jaar}-${maand}-${dag}T00:00:00.000Z`
}
