/* ===========================================================================
 *  Eén keer inloggen: van het dashboard naar het camerportaal
 *
 *  Casper: "zorg dat het gemakkelijk is in te loggen als je de rechten hebt"
 *  en "zorg dat iemand enkel bij eigen camera komt als degene vast op
 *  vestiging staat."
 *
 *  Wat er stond
 *  ------------
 *
 *  Aan de camerakant één gebruikersnaam en één wachtwoord voor alles. Geen
 *  gebruikers, geen rollen, geen vestigingen -- wie binnen was, zag elke
 *  camera van elke vestiging. En dat wachtwoord moest dus rondgaan.
 *
 *  Wat deze functie doet
 *  ---------------------
 *
 *  Zij tekent een briefje. Meer niet:
 *
 *      "Dit is Casper, hij mag bij deze installaties, en dit briefje is
 *       zestig seconden geldig."
 *
 *  De app stuurt de gebruiker naar /sso/callback van het portaal met dat
 *  briefje erachter. Het portaal rekent de handtekening na, maakt er een
 *  sessie van, en weet vanaf dat moment wie er kijkt en waar hij bij mag.
 *
 *  Waarom een briefje en geen gedeelde database
 *  --------------------------------------------
 *
 *  Omdat het portaal op negentien pc's draait, in het pand, achter een
 *  tunnel. Dat ding een verbinding met onze database geven betekent een
 *  sleutel van die database op negentien pc's. Een handtekening die het kan
 *  narekenen met een geheim dat het toch al heeft, is genoeg -- en het werkt
 *  ook als onze kant er even uit ligt.
 *
 *  Waarom zestig seconden
 *  ----------------------
 *
 *  Het briefje staat in een adresbalk. Dat betekent: in de geschiedenis van
 *  de browser, mogelijk in een log van een tussenliggende server, en in wat
 *  iemand per ongeluk doorstuurt. Zestig seconden is ruim voor een
 *  omleiding en te kort om later nog iets mee te kunnen. Het portaal
 *  onthoudt bovendien welke briefjes het al gezien heeft, dus twee keer
 *  gebruiken kan niet.
 *
 *  Wat deze functie NIET doet
 *  --------------------------
 *
 *  Beelden doorgeven, camera's uitlezen, opnames ophalen. Dat blijft
 *  allemaal aan de camerakant; hier gaat alleen de vraag "wie ben je en waar
 *  mag je bij" over de lijn. Een functie met de servicesleutel gebruik je
 *  voor het ene ding dat niet anders kan.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { meldStand } from '../_gedeeld/stand.ts'

/* Zegt bij de eerste start welke versie hier draait; zie _gedeeld/stand.ts. */
meldStand('camportal')

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/*
 * Het geheim waarmee het briefje wordt ondertekend.
 *
 * In de omgeving en niet in public.instellingen, en dat is geen smaak: die
 * tabel synchroniseert mee naar elke tablet en elke telefoon (zie 0052, waar
 * de Exact-sleutels om dezelfde reden zijn verhuisd). Een geheim waarmee je
 * je eigen toegangsbriefje kunt schrijven, hoort niet op het toestel van
 * degene die het briefje krijgt.
 *
 *   supabase secrets set CAMPORTAL_SECRET=<hetzelfde als in het portaal>
 */
const GEHEIM = Deno.env.get('CAMPORTAL_SECRET') ?? ''

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/* Zie de uitleg in kassa-apparaat/index.ts: zonder dit bestaat de functie
   wel en is hij onbereikbaar zodra de app in een browser draait. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/* ------------------------------------------------------------------ *
 *  Wie belt er?
 * ------------------------------------------------------------------ */

async function wieBelt(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null

  const { data: profiel } = await admin
    .from('profiles')
    .select('id, name, roles, active, grants, revokes, archived_at')
    .eq('auth_id', data.user.id)
    .maybeSingle()

  if (!profiel?.active || profiel.archived_at) return null
  return {
    id: profiel.id as string,
    naam: (profiel.name ?? '') as string,
    rollen: (profiel.roles ?? []) as string[],
    rechten: (profiel.grants ?? []) as string[],
    ingetrokken: (profiel.revokes ?? []) as string[],
  }
}

/* ------------------------------------------------------------------ *
 *  Mag deze persoon naar de camera's kijken?
 *
 *  Dezelfde volgorde als heeft_recht() in de database (0072): een
 *  intrekking wint, dan een los toegekend recht, dan wat de rol geeft.
 *  Die laatste vraag stellen we aan public.rol_recht -- dat is dezelfde
 *  lijst waar de database naar kijkt, dus de twee kunnen niet uit elkaar
 *  gaan lopen.
 * ------------------------------------------------------------------ */

async function magKijken(wie: Awaited<ReturnType<typeof wieBelt>>) {
  if (!wie) return false
  if (wie.ingetrokken.includes('camera.view')) return false
  if (wie.rechten.includes('camera.view')) return true

  const { data } = await admin
    .from('rol_recht')
    .select('rol')
    .eq('recht', 'camera.view')

  const rollenMetRecht = (data ?? []).map((r) => r.rol as string)
  return wie.rollen.some((r) => rollenMetRecht.includes(r))
}

/* ------------------------------------------------------------------ *
 *  Het briefje ondertekenen
 *
 *  HMAC-SHA256 met een gedeeld geheim, en geen sleutelpaar. Dat is hier
 *  de juiste keuze: het geheim opent alleen het portaal, en wie het uit
 *  een portaal weet te trekken had daarmee toch al toegang tot datzelfde
 *  portaal. Er valt dus niets extra's mee te bereiken -- en het scheelt
 *  aan de camerakant een afhankelijkheid die daar op negentien pc's mee
 *  moet worden uitgerold.
 * ------------------------------------------------------------------ */

function b64url(ruw: Uint8Array | string): string {
  const bytes = typeof ruw === 'string' ? new TextEncoder().encode(ruw) : ruw
  let tekst = ''
  for (const b of bytes) tekst += String.fromCharCode(b)
  return btoa(tekst).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function onderteken(payload: unknown): Promise<string> {
  const lijf = b64url(JSON.stringify(payload))
  const sleutel = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(GEHEIM),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const hand = await crypto.subtle.sign('HMAC', sleutel, new TextEncoder().encode(lijf))
  return `${lijf}.${b64url(new Uint8Array(hand))}`
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, fout: 'Alleen POST' }, 405)

  const wie = await wieBelt(req)
  if (!wie) return json({ ok: false, fout: 'Niet ingelogd' }, 401)

  if (!(await magKijken(wie))) {
    return json({
      ok: false,
      fout: 'Je hebt geen toegang tot de camerabeelden. Vraag het kantoor om '
          + 'het recht "Camera\'s bekijken".',
    }, 403)
  }

  if (!GEHEIM) {
    /*
     * Zonder geheim kan er wel een briefje gemaakt worden, maar dan tekent
     * iedereen met een leeg geheim -- en dat kan iedereen. Dus niet.
     */
    return json({
      ok: false,
      fout: 'Het camerportaal is nog niet ingesteld: CAMPORTAL_SECRET ontbreekt '
          + 'op de server.',
    }, 503)
  }

  /* Waar het portaal staat. In de instellingen, zodat het te verzetten is
     zonder een nieuwe uitrol -- zie 0055 en 0066 voor dezelfde keuze bij
     app_url en site_url. */
  const { data: instelling } = await admin
    .from('instellingen')
    .select('waarde')
    .eq('sleutel', 'camera_portaal_url')
    .maybeSingle()

  const basis = (instelling?.waarde ?? '').trim().replace(/\/+$/, '')
  if (!basis) {
    return json({
      ok: false,
      fout: 'Er staat geen adres bij de instelling camera_portaal_url.',
    }, 503)
  }

  /* Bij welke installaties mag deze persoon? Die vraag staat in de database
     (0118) en niet hier: daar staan de vestigingen, en daar wordt hij ook
     getest. */
  const { data: sites, error } = await admin.rpc('camera_sites_voor', { wie: wie.id })
  if (error) return json({ ok: false, fout: error.message }, 500)

  const lijst = (sites ?? []) as { site_id: string; location_id: string; naam: string }[]
  if (lijst.length === 0) {
    return json({
      ok: false,
      fout: 'Er is nog geen camera-installatie aan jouw vestiging gekoppeld. '
          + 'Het kantoor zet die koppeling bij de vestiging.',
    }, 409)
  }

  const { data: alles } = await admin.rpc('mag_alle_vestigingen', { wie: wie.id })

  const nu = Math.floor(Date.now() / 1000)
  const briefje = {
    v: 1,
    iss: 'truckwash-dashboard',
    sub: wie.id,
    naam: wie.naam,
    /* Puur om in het portaal te kunnen tonen; de toegang volgt uit sites. */
    alles: alles === true,
    sites: lijst.map((s) => s.site_id),
    iat: nu,
    exp: nu + 60,
    /* Eenmalig. Het portaal onthoudt welke het gezien heeft, zodat een
       briefje dat in een browsergeschiedenis blijft staan niets meer doet. */
    jti: crypto.randomUUID(),
  }

  const token = await onderteken(briefje)

  return json({
    ok: true,
    url: `${basis}/sso/callback?t=${encodeURIComponent(token)}`,
    /* Zodat het scherm kan laten zien waar je straks bij mag, vóórdat je
       wegklikt. */
    vestigingen: lijst.map((s) => s.naam),
    alles: alles === true,
    geldigTot: briefje.exp,
  })
})
