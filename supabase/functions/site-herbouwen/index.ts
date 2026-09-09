/* ===========================================================================
 *  site-herbouwen -- de website opnieuw laten bouwen
 *
 *  Uitrollen (MET de JWT-controle; hij staat in functions:dicht):
 *
 *    supabase functions deploy site-herbouwen
 *
 *  Waarom deze functie bestaat
 *  ---------------------------
 *
 *  Casper: "als ik een vestiging maak via de app, dat je die direct live hebt
 *  op de website, kan je de website niet die locaties uit de database laten
 *  halen?"
 *
 *  Half deed de site dat al: assets/live.js haalt bij elk bezoek de actuele
 *  gegevens op en werkt de lijsten en de tellingen bij. Maar elke vestiging
 *  heeft ook een eigen pagina, en die bestaat als bestand. Een pagina die er
 *  niet is, kan zichzelf niet invullen -- dus moet de site opnieuw gebouwd
 *  worden, en dat doet .github/workflows/site.yml.
 *
 *  Deze functie is het knopje daarvoor. Hij doet zelf niets aan de site; hij
 *  geeft GitHub een seintje.
 *
 *  Waarom dat niet rechtstreeks uit de app kan
 *  -------------------------------------------
 *
 *  Er hoort een token bij, en dat token mag in de repo schrijven. Een token
 *  met schrijfrecht in een app die op achttien tablets staat, is een token dat
 *  je kwijt bent. Hier staat hij in de omgeving van Supabase en komt hij
 *  nergens anders.
 *
 *  Zonder token werkt alles nog
 *  ----------------------------
 *
 *  Dan gebeurt er hier niets en meldt hij dat. De site wordt 's nachts alsnog
 *  herbouwd door dezelfde workflow -- het seintje maakt het snel, niet
 *  mogelijk. Dat verschil staat expres in het antwoord, zodat het scherm kan
 *  zeggen "vannacht" in plaats van te doen alsof het zo klaar is.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TOKEN = Deno.env.get('GITHUB_SITE_TOKEN') ?? ''

/* De repo staat hier en niet in een geheim: het is geen geheim, en zo is aan
   dit bestand te zien waar het seintje heen gaat. Met een uitweg voor het
   geval de repo ooit verhuist. */
const REPO = Deno.env.get('GITHUB_REPO') ?? 'Truckwash-Innovations/truckwash-dashboard'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const nu = () => Date.now()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/* ------------------------------------------------------------------ *
 *  De rem
 *
 *  Wie een vestiging invult, slaat vijf keer op: eerst het adres, dan de
 *  telefoon, dan de openingstijden. Zonder rem zijn dat vijf herbouwen van
 *  twee minuten die elkaar in de rij staan op te wachten.
 *
 *  Een minuut. Kort genoeg dat "direct live" ook echt direct voelt, lang
 *  genoeg dat een reeks bewerkingen op één herbouw uitkomt. En wat er tijdens
 *  een lopende herbouw nog verandert gaat niet verloren: de volgende
 *  aanvraag na die minuut zet er gewoon een nieuwe achteraan (de workflow
 *  laat ze wachten in plaats van ze af te breken).
 * ------------------------------------------------------------------ */

const RUST_MS = 60 * 1000
const SLEUTEL = 'site_herbouw_laatst'

async function laatst(): Promise<number> {
  const { data } = await admin
    .from('instellingen')
    .select('waarde')
    .eq('sleutel', SLEUTEL)
    .maybeSingle()
  const n = Number(data?.waarde ?? 0)
  return Number.isFinite(n) ? n : 0
}

async function stempel(op: number) {
  await admin.from('instellingen').upsert({
    id: 'in_' + SLEUTEL,
    sleutel: SLEUTEL,
    waarde: String(op),
    omschrijving:
      'Wanneer de website voor het laatst opnieuw is gebouwd (epoch ms). ' +
      'Schrijft de functie site-herbouwen zelf; niet met de hand aanpassen.',
  }, { onConflict: 'sleutel' })
}

/* ------------------------------------------------------------------ *
 *  Wie belt er
 * ------------------------------------------------------------------ */

async function wieBelt(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null

  const { data: profiel } = await admin
    .from('profiles')
    .select('id, name, roles, grants, active')
    .eq('auth_id', data.user.id)
    .maybeSingle()

  if (!profiel?.active) return null
  return profiel as {
    id: string; name: string; roles: string[]; grants: string[] | null
  }
}

/* Dezelfde grens als mag_vestigingen_beheren() in 0026: wie een vestiging mag
   wijzigen, mag de site laten bijwerken. Vacatures vallen daar ook onder --
   die worden door dezelfde mensen beheerd. */
function magHerbouwen(b: { roles: string[]; grants: string[] | null }): boolean {
  const rollen = b.roles ?? []
  const rechten = b.grants ?? []
  return rollen.includes('management')
    || rollen.includes('developer')
    || rechten.includes('locations.manage')
}

/* ------------------------------------------------------------------ *
 *  Het luide falen
 *
 *  Een token met een houdbaarheidsdatum verloopt, en dan gebeurt er precies
 *  niets: de site werkt, hij wordt alleen niet meer bijgewerkt. Dat is het
 *  soort stilte waar iemand pas over belt als er een vestiging bij is die er
 *  niet op staat.
 *
 *  Dus een melding in het dashboard, en hoogstens één per dag -- vandaar het
 *  id met de datum erin. Tien meldingen over hetzelfde token is geen
 *  duidelijker signaal, alleen een postvak dat je dichtklikt.
 * ------------------------------------------------------------------ */

async function meldStoring(reden: string) {
  const dag = new Date().toISOString().slice(0, 10)
  await admin.from('notifications').upsert({
    id: 'nt_site_herbouw_' + dag,
    to_role: 'management',
    kind: 'taak',
    title: 'De website wordt niet meer bijgewerkt',
    body:
      'Het seintje naar GitHub werd geweigerd, dus een nieuwe of gewijzigde ' +
      'vestiging komt niet vanzelf op de website. De nachtelijke herbouw ' +
      'loopt hier ook op vast.\n\n' +
      'Reden: ' + reden + '\n\n' +
      'Meestal is het token verlopen. Maak een nieuw fijnmazig token aan op ' +
      'de repo (Contents: read and write) en zet het met ' +
      'supabase secrets set GITHUB_SITE_TOKEN=...',
    from_user_id: null,
    from_name: 'Website',
    created_at: nu(),
    link: 'instellingen',
  }, { onConflict: 'id', ignoreDuplicates: true })
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405)

  const beller = await wieBelt(req)
  if (!beller) return json({ ok: false, reden: 'Niet ingelogd' }, 401)
  if (!magHerbouwen(beller)) {
    return json({ ok: false, reden: 'Geen rechten om de website bij te werken' }, 403)
  }

  if (!TOKEN) {
    /*
     * Geen fout. De site wordt vannacht gewoon herbouwd; alleen niet nu.
     * Het scherm hoort dat te kunnen zeggen zonder een rode melding, want er
     * is niets stuk -- er staat alleen geen token.
     */
    return json({
      ok: true,
      gepland: 'vannacht',
      reden: 'Er staat geen GITHUB_SITE_TOKEN, dus de site wordt vannacht bijgewerkt in plaats van nu.',
    })
  }

  const vorige = await laatst()
  const sinds = nu() - vorige
  if (sinds < RUST_MS) {
    return json({
      ok: true,
      gepland: 'loopt al',
      reden: `De site wordt al bijgewerkt (${Math.round(sinds / 1000)} seconden geleden gestart).`,
    })
  }

  let res: Response
  try {
    res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        /* GitHub weigert verzoeken zonder User-Agent met een 403 die nergens
           over gaat. Kost niets en scheelt een halve dag zoeken. */
        'User-Agent': 'truckwash-dashboard',
      },
      body: JSON.stringify({
        event_type: 'site-herbouwen',
        client_payload: { door: beller.name, op: nu() },
      }),
    })
  } catch (e) {
    const reden = String(e instanceof Error ? e.message : e).slice(0, 300)
    console.error('[site-herbouwen] GitHub niet bereikbaar:', reden)
    await meldStoring('GitHub was niet bereikbaar: ' + reden)
    return json({ ok: false, gepland: 'vannacht', reden: 'GitHub was niet bereikbaar.' }, 502)
  }

  /* 204 is wat GitHub teruggeeft als het seintje is aangenomen. */
  if (res.status === 204) {
    await stempel(nu())
    console.log(`[site-herbouwen] seintje gegeven door ${beller.name}`)
    return json({ ok: true, gepland: 'nu' })
  }

  const tekst = (await res.text().catch(() => '')).slice(0, 300)
  const reden = `GitHub gaf ${res.status}. ${tekst}`
  console.error('[site-herbouwen]', reden)

  /*
   * 401 is het token, 403 is meestal de rechten erop, 404 op deze route
   * betekent ook "mag niet" -- GitHub geeft geen 403 op een repo die je niet
   * mag zien, want dan zou je uit de foutcode kunnen afleiden dat hij bestaat.
   * Alle drie hetzelfde gevolg: het gaat niet meer vanzelf.
   */
  if ([401, 403, 404].includes(res.status)) {
    await meldStoring(reden)
  }

  return json({ ok: false, gepland: 'vannacht', reden }, 502)
})
