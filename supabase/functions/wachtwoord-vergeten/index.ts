/* ===========================================================================
 *  wachtwoord-vergeten -- een code per Resend-mail, geen link
 *
 *  Uitrollen (zónder JWT-controle, want wie zijn wachtwoord kwijt is heeft
 *  per definitie geen sessie):
 *
 *    supabase functions deploy wachtwoord-vergeten --no-verify-jwt
 *
 *  Hij staat in package.json onder functions:open, dus "npm run functions"
 *  doet het goed.
 *
 *  Waarom deze functie bestaat
 *  ---------------------------
 *
 *  Casper: "je moet alle emails via resend doen, het vergeten wachtwoord knop
 *  zit nu aan supabase, en stuurt je naar een localhost, wat niet kan?"
 *
 *  De knop riep supabase.auth.resetPasswordForEmail() aan. Drie dingen mis:
 *
 *   1. Die mail komt van Supabase, niet van Resend, en laat geen regel achter
 *      in email_log -- "heeft hij iets gehad?" was onbeantwoordbaar.
 *   2. Er ging geen redirectTo mee, dus Supabase pakt zijn eigen Site URL, en
 *      die staat op localhost.
 *   3. En met een goed adres was het nog dood geweest: de client staat op
 *      detectSessionInUrl: false en nergens in de app luistert iets op
 *      PASSWORD_RECOVERY. Die link kon in geen enkele bouw een sessie maken.
 *
 *  Dus geen link maar een code. Acht tekens, tien minuten geldig, ingetikt op
 *  hetzelfde scherm waar hij is aangevraagd. Dat werkt in Electron, in de APK
 *  en in de browser gelijk, en er is geen adres dat verkeerd kan staan.
 *
 *  Waarom niet meteen een nieuw wachtwoord mailen
 *  ----------------------------------------------
 *
 *  Dat is wat de knop bij management doet, en daar klopt het: die wordt
 *  ingedrukt door iemand die is ingelogd en die rol heeft. Hier drukt iedereen
 *  op internet die een adres kan intypen. Meteen vervangen zou betekenen dat
 *  een voorbijganger elke medewerker kan buitensluiten met een formulier,
 *  zonder ooit een postvak te zien. Met een code blijft het oude wachtwoord
 *  werken tot de eigenaar de zijne intoetst.
 *
 *  Wat er met opzet níét in de antwoorden staat
 *  --------------------------------------------
 *
 *  Of het adres bestaat. "aanvragen" antwoordt altijd hetzelfde, ook voor een
 *  onbekend adres, ook voor een geblokkeerd account, ook als de mail mislukt.
 *  Anders is dit een lijstje waarmee je kunt uitvinden wie hier werkt.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { verstuurBrief } from '../_gedeeld/post.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const AFZENDER = Deno.env.get('MAIL_FROM') ??
  'Truckwash1 Group <dashboard@preview.truckwash.cloud>'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/* De code is tien minuten geldig. Lang genoeg om een mail te zien
   binnenkomen en over te typen, kort genoeg om een onderschepte mail
   waardeloos te maken. */
const GELDIG_MS = 10 * 60 * 1000

/* Hoe vaak je mag misgokken op één code. Vijf keer is ruim voor iemand die
   zich vertypt, en verwaarloosbaar tegen 31^8 mogelijkheden -- ruim 800
   miljard, waarvan er vijf mogen worden geprobeerd binnen tien minuten. */
const HOOGSTENS_POGINGEN = 5

/* En hoe vaak je binnen een kwartier een nieuwe code mag vragen. Zonder dit
   is deze functie een knop waarmee je andermans postvak kunt volgooien. */
const AANVRAGEN_PER_KWARTIER = 3
const KWARTIER_MS = 15 * 60 * 1000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/* ------------------------------------------------------------------ *
 *  De code
 *
 *  Geen i, l, 1, O en 0: die worden verkeerd overgetypt van een
 *  telefoonscherm, en dan belt er iemand. Hoofdletters en cijfers, want
 *  dit wordt gelezen en niet geplakt.
 * ------------------------------------------------------------------ */

const ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function nieuweCode(lengte = 8): string {
  const bytes = new Uint8Array(lengte)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => ALFABET[b % ALFABET.length]).join('')
}

/*
 * De code gaat nooit als zichzelf de tabel in.
 *
 * De id doet dienst als zout. Zonder dat zou één lijst van alle mogelijke
 * codes op elke rij tegelijk passen; met de id erin is elke rij apart werk.
 */
async function hashVan(id: string, code: string): Promise<string> {
  const ruw = new TextEncoder().encode(`${id}:${code.trim().toUpperCase()}`)
  const digest = await crypto.subtle.digest('SHA-256', ruw)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/*
 * Vergelijken zonder te verklappen hoe ver je zat.
 *
 * Een gewone === stopt bij het eerste verschil, en dat verschil is meetbaar.
 * Hier kost elke vergelijking evenveel tijd, ongeacht waar hij misgaat.
 */
function gelijkTraag(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let verschil = 0
  for (let i = 0; i < a.length; i++) verschil |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return verschil === 0
}

/* Dezelfde eis als passwordProblem() in src/lib/signups.ts. De app kijkt al
   mee, maar de app is niet de plek waar dit vaststaat: een verzoek komt hier
   ook binnen zonder dat er een scherm aan te pas komt. */
function wachtwoordProbleem(wachtwoord: string): string | null {
  if (wachtwoord.length < 10) return 'Gebruik minstens tien tekens.'
  if (!/[a-zA-Z]/.test(wachtwoord) || !/[0-9]/.test(wachtwoord)) {
    return 'Gebruik letters én cijfers.'
  }
  return null
}

/* ------------------------------------------------------------------ *
 *  Een code aanvragen
 * ------------------------------------------------------------------ */

/* Wat de aanvrager altijd terugkrijgt, wat er ook is gebeurd. */
const ALTIJD = {
  ok: true,
  bericht: 'Staat er een account op dit adres, dan is de code onderweg.',
}

async function aanvragen(email: string): Promise<Response> {
  const nu = Date.now()

  /* Meteen even opruimen. Deze rijen zijn na tien minuten waardeloos en na
     een dag alleen nog een lijst met mailadressen van collega's. Het gebeurt
     hier en niet in een aparte planning, want dit is de enige plek waar er
     iets bij komt -- er kan dus nooit een berg ontstaan zonder dat deze
     regel langskomt. */
  await admin.from('wachtwoord_herstel').delete().lt('verloopt', nu - 86400000)

  /* Hoe vaak is er de laatste tijd om gevraagd? */
  const { count } = await admin
    .from('wachtwoord_herstel')
    .select('id', { count: 'exact', head: true })
    .eq('email', email)
    .gt('at', nu - KWARTIER_MS)

  if ((count ?? 0) >= AANVRAGEN_PER_KWARTIER) {
    console.warn(`[wachtwoord-vergeten] te veel aanvragen voor dit adres; niets verstuurd`)
    return json(ALTIJD)
  }

  const { data: profiel } = await admin
    .from('profiles')
    .select('id, name, email, active')
    .eq('email', email)
    .maybeSingle()

  /* Onbekend of geblokkeerd: hetzelfde antwoord, geen mail. */
  if (!profiel?.active) return json(ALTIJD)

  const id = 'wh_' + crypto.randomUUID().replace(/-/g, '')
  const code = nieuweCode()

  const { error: schrijfFout } = await admin.from('wachtwoord_herstel').insert({
    id,
    email,
    code_hash: await hashVan(id, code),
    verloopt: nu + GELDIG_MS,
    at: nu,
  })

  /*
   * Als dit misgaat komt er wél een mail met een code die nergens op slaat.
   * Dus eerst schrijven, en bij een fout niets versturen.
   */
  if (schrijfFout) {
    console.error('[wachtwoord-vergeten] kon de code niet vastleggen:', schrijfFout.message)
    return json(ALTIJD)
  }

  const gelukt = await verstuurBrief(
    admin,
    { resendKey: RESEND_KEY, afzender: AFZENDER },
    email,
    {
      onderwerp: 'Je herstelcode voor het Truckwash1-dashboard',
      kop: 'Een nieuw wachtwoord instellen',
      alineas: [
        `Hoi ${profiel.name ?? ''},`.trim(),
        'Er is gevraagd om je wachtwoord opnieuw in te stellen. Tik de code ' +
        'hieronder in op het scherm waar je erom hebt gevraagd; daarna kies ' +
        'je meteen zelf een nieuw wachtwoord.',
        'De code werkt tien minuten en één keer. Tot je hem gebruikt, blijft ' +
        'je huidige wachtwoord gewoon werken.',
      ],
      gegevens: [['Herstelcode', code]],
      voet: 'Heb je hier niet om gevraagd? Dan hoef je niets te doen -- zonder ' +
        'deze code verandert er niets aan je account. Gebeurt het vaker, laat ' +
        'het dan even weten aan kantoor.',
    },
    'wachtwoord-herstel',
  )

  /*
   * Ook bij een mislukte mail hetzelfde antwoord: de aanvrager mag niet uit
   * het verschil afleiden of het adres bestaat. Het staat wel in email_log en
   * in de log hieronder, want daar moet het wél te zien zijn.
   */
  if (!gelukt) {
    console.error('[wachtwoord-vergeten] de herstelmail is niet verstuurd; zie email_log')
  }

  return json(ALTIJD)
}

/* ------------------------------------------------------------------ *
 *  De code inwisselen
 * ------------------------------------------------------------------ */

/* Eén melding voor elke manier waarop het mis kan gaan: onbekend adres,
   verkeerde code, verlopen code, al gebruikt, te vaak geprobeerd. Wie de code
   heeft merkt het verschil niet; wie hem niet heeft, mag het niet weten. */
const AFGEWEZEN = 'Deze code klopt niet of is verlopen. Vraag een nieuwe aan.'

async function instellen(email: string, code: string, wachtwoord: string): Promise<Response> {
  const probleem = wachtwoordProbleem(wachtwoord)
  if (probleem) return json({ ok: false, reden: probleem }, 400)

  const nu = Date.now()

  const { data: rij } = await admin
    .from('wachtwoord_herstel')
    .select('id, code_hash, verloopt, pogingen, gebruikt_at')
    .eq('email', email)
    .is('gebruikt_at', null)
    .gt('verloopt', nu)
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!rij) return json({ ok: false, reden: AFGEWEZEN }, 400)

  /*
   * Eerst tellen, dan vergelijken.
   *
   * Andersom zou een mislukte poging bij een fout halverwege niet meetellen,
   * en dan is de teller geen rem meer maar een suggestie.
   */
  const pogingen = (rij.pogingen ?? 0) + 1
  await admin.from('wachtwoord_herstel').update({ pogingen }).eq('id', rij.id)

  if (pogingen > HOOGSTENS_POGINGEN) {
    /* Opgebrand. Meteen dichtzetten, anders blijft hij bij elke poging
       opnieuw de nieuwste geldige rij. */
    await admin.from('wachtwoord_herstel').update({ gebruikt_at: nu }).eq('id', rij.id)
    return json({ ok: false, reden: AFGEWEZEN }, 400)
  }

  if (!gelijkTraag(rij.code_hash, await hashVan(rij.id, code))) {
    return json({ ok: false, reden: AFGEWEZEN }, 400)
  }

  const { data: profiel } = await admin
    .from('profiles')
    .select('id, auth_id, active')
    .eq('email', email)
    .maybeSingle()

  if (!profiel?.auth_id || !profiel.active) {
    return json({ ok: false, reden: AFGEWEZEN }, 400)
  }

  const { error: authFout } = await admin.auth.admin.updateUserById(profiel.auth_id, {
    password: wachtwoord,
  })

  if (authFout) {
    /*
     * De code is niet verbruikt, want er is niets veranderd. Wél luid melden:
     * dit is de enige plek waar het zichtbaar wordt.
     */
    console.error('[wachtwoord-vergeten] wachtwoord niet gezet:', authFout.message)
    const zelfde = /same.*password|should be different/i.test(authFout.message)
    return json({
      ok: false,
      reden: zelfde
        ? 'Kies een ander wachtwoord dan je vorige.'
        : 'Het wachtwoord kon niet worden opgeslagen. Probeer het zo nog eens.',
    }, 500)
  }

  /*
   * Pas nu is de code op. En meteen alle andere openstaande codes voor dit
   * adres erbij: wie er drie heeft aangevraagd, hoort er na de eerste geen
   * twee bruikbare meer te hebben liggen.
   */
  await admin.from('wachtwoord_herstel')
    .update({ gebruikt_at: nu })
    .eq('email', email)
    .is('gebruikt_at', null)

  /*
   * En de vlag uit. Wie was uitgenodigd met een tijdelijk wachtwoord en dat
   * kwijtraakte, heeft nu zelf iets gekozen -- dan hoort het scherm "kies een
   * wachtwoord" niet alsnog in de weg te staan.
   */
  await admin.from('profiles')
    .update({ must_change_password: false })
    .eq('id', profiel.id)

  return json({ ok: true })
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, reden: 'Onleesbaar verzoek.' }, 400)
  }

  const actie = String(body.actie ?? '')
  const email = String(body.email ?? '').trim().toLowerCase()

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return json({ ok: false, reden: 'Vul een geldig e-mailadres in.' }, 400)
  }

  if (actie === 'aanvragen') return await aanvragen(email)

  if (actie === 'instellen') {
    return await instellen(
      email,
      String(body.code ?? ''),
      String(body.wachtwoord ?? ''),
    )
  }

  return json({ ok: false, reden: 'Onbekende actie.' }, 400)
})
