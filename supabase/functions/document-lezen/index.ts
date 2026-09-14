/* ===========================================================================
 *  Een identiteitsbewijs of contract laten voorlezen
 *
 *  Casper: "De ai, kan je die niet gebruiken bij inscannen arbeidsovereenkomst
 *  en id ect? gezien de ocr niet echt lekker werkt."
 *
 *  De leesmotor in de app blijft staan en gaat voor: die draait op het toestel
 *  zelf, en daarmee is het de enige weg waarbij er gegarandeerd geen foto
 *  weggaat. Hij is alleen kieskeurig over de foto. Dit is de tweede poging.
 *
 *  Waar de foto heen gaat
 *  ----------------------
 *
 *  Dat hangt af van de instelling ai_documenten, en het is met opzet een
 *  keuze en geen standaard (zie 0080):
 *
 *    uit      hier komt niets langs. De app doet het zelf of niet.
 *    lokaal   naar onze eigen database, en van daar haalt de eigen pc hem op.
 *             De foto wordt gewist zodra het antwoord er is.
 *    claude   naar Anthropic. Dat is een partij buiten het bedrijf, en bij een
 *             paspoort is dat een besluit dat iemand genomen moet hebben.
 *
 *  Er is GEEN terugval van lokaal naar Claude. Bij de facturen bestaat die
 *  stand wel; hier niet. Een paspoort hoort niet naar de andere kant van de
 *  oceaan te gaan omdat er een pc uit stond.
 *
 *  Wie mag dit
 *  -----------
 *
 *  Dezelfde grens als het dossier zelf: het management, een leidinggevende, of
 *  wie staff.view heeft. Dat is de grens die 0056 en 0074 trekken voor
 *  personnel_private, en daar gaat dit over -- geboortedatum, documentnummer,
 *  burgerservicenummer.
 *
 *  Zonder die deur is dit een gratis taalmodel voor iedereen die het adres
 *  kent, en erger: een die je een willekeurige foto kunt laten lezen.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import {
  MODEL, jsonUit, opschonen, schemaVoor, systeemVoor,
  type DocumentSoort,
} from '../_gedeeld/documentlezer.ts'
import { lokaleInstelling, vraagLokaal } from '../_gedeeld/lokaal.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

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

/*
 * Drie plaatjes van hooguit 6 MB samen.
 *
 * Voor- en achterkant van een pasje zijn er twee; een contract van drie
 * pagina's past er ook in. Meer is geen scan maar een archief, en het staat
 * hier omdat een base64-reeks van dertig megabyte de functie omver duwt op
 * een manier die niets uitlegt.
 */
const MAX_PLAATJES = 3
const MAX_TEKENS = 6 * 1024 * 1024

/* ------------------------------------------------------------------ *
 *  Wie belt er?
 * ------------------------------------------------------------------ */

async function magDossiers(req: Request): Promise<boolean> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token || token === (Deno.env.get('SUPABASE_ANON_KEY') ?? '')) return false

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return false

  const { data: profiel } = await admin
    .from('profiles')
    .select('roles, active, grants, revokes')
    .eq('auth_id', data.user.id)
    .maybeSingle()
  if (!profiel?.active) return false

  const rollen = (profiel.roles ?? []) as string[]
  const toegekend = (profiel.grants ?? []) as string[]
  const ingetrokken = (profiel.revokes ?? []) as string[]

  if (rollen.includes('management')) return true
  if (ingetrokken.includes('staff.view')) return false
  return rollen.includes('supervisor') || toegekend.includes('staff.view')
}

/* ------------------------------------------------------------------ *
 *  Claude ernaar laten kijken
 * ------------------------------------------------------------------ */

async function viaClaude(soort: DocumentSoort, plaatjes: string[], mimes: string[]) {
  if (!ANTHROPIC_KEY) {
    return {
      ok: false,
      reden: 'De leesdienst is niet ingesteld. Zet ANTHROPIC_API_KEY als geheim '
        + 'bij de functies, of zet ai_documenten op "lokaal".',
    }
  }

  const blokken = plaatjes.map((data, i) => ({
    type: 'image',
    source: { type: 'base64', media_type: mimes[i] ?? 'image/jpeg', data },
  }))

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: systeemVoor(soort),
      messages: [{
        role: 'user',
        content: [...blokken, { type: 'text', text: 'Lees dit document en geef de JSON terug.' }],
      }],
    }),
  })

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    console.error(`[document-lezen] Anthropic gaf ${res.status}: ${detail}`)
    return { ok: false, reden: 'De leesdienst gaf geen antwoord. Probeer het straks nog eens.' }
  }

  const antwoord = await res.json()
  const platte = (antwoord?.content ?? [])
    .filter((b: { type?: string }) => b?.type === 'text')
    .map((b: { text?: string }) => b.text ?? '')
    .join('\n')

  return { ok: true, tekst: platte, door: 'claude' }
}

/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, reden: 'Alleen POST.' }, 405)

  if (!await magDossiers(req)) {
    return json({
      ok: false,
      reden: 'Een document laten voorlezen mag wie personeelsdossiers mag inzien.',
    }, 403)
  }

  let lijf: Record<string, unknown> = {}
  try {
    lijf = await req.json()
  } catch {
    return json({ ok: false, reden: 'Geen leesbaar verzoek.' }, 400)
  }

  const soort = String(lijf.soort ?? '') as DocumentSoort
  if (soort !== 'identiteitsbewijs' && soort !== 'arbeidsovereenkomst') {
    return json({ ok: false, reden: 'Onbekend soort document.' }, 400)
  }

  const plaatjes = Array.isArray(lijf.plaatjes)
    ? lijf.plaatjes.filter((p: unknown) => typeof p === 'string' && p.length > 0) as string[]
    : []
  const mimes = Array.isArray(lijf.mimes)
    ? lijf.mimes.map((m: unknown) => String(m ?? 'image/jpeg'))
    : []

  if (plaatjes.length === 0) return json({ ok: false, reden: 'Geen afbeelding meegestuurd.' }, 400)
  if (plaatjes.length > MAX_PLAATJES) {
    return json({ ok: false, reden: `Hooguit ${MAX_PLAATJES} afbeeldingen per keer.` }, 400)
  }
  const totaal = plaatjes.reduce((a, p) => a + p.length, 0)
  if (totaal > MAX_TEKENS) {
    return json({
      ok: false,
      reden: 'De foto\'s zijn samen te groot. Maak ze kleiner of scan één kant tegelijk.',
    }, 400)
  }

  /* ---- wie mag ernaar kijken ---- */

  const { keuze, model, wachtMs } = await lokaleInstelling(admin, 'ai_documenten')

  if (keuze === 'claude') {
    const uit = await viaClaude(soort, plaatjes, mimes)
    if (!uit.ok) return json(uit, 502)
    const ruw = jsonUit(String(uit.tekst ?? ''))
    if (!ruw) return json({ ok: false, reden: 'Het antwoord was geen bruikbare JSON.' }, 502)
    return json({ ok: true, door: 'claude', lezing: opschonen(soort, ruw) })
  }

  /*
   * Alles wat geen 'claude' is gaat langs de eigen machine. Ook
   * 'lokaal-terugval', mocht iemand die waarde met de hand in de instelling
   * zetten: bij een document is er geen terugval, en dan is lokaal de veilige
   * uitleg van een waarde die hier niet hoort.
   *
   * "uit" is een aparte stand en hoort ook echt niets te doen -- zie 0080.
   */
  if (String(keuze) === 'uit') {
    return json({
      ok: false,
      reden: 'Het laten voorlezen van documenten staat uit. De app leest zelf, '
        + 'of iemand zet ai_documenten op "lokaal".',
    }, 409)
  }

  const uit = await vraagLokaal(admin, {
    soort: 'document',
    systeem: systeemVoor(soort),
    gebruiker: 'Lees dit document en geef de JSON terug.',
    model,
    wachtMs,
    schema: schemaVoor(soort),
    plaatjes,
  })

  if (!uit.tekst) {
    return json({
      ok: false,
      reden: uit.reden ?? 'De eigen AI kwam er niet uit.',
      /* Zodat het scherm kan zeggen dat er niets naar buiten is gegaan. */
      lokaal: true,
    }, 502)
  }

  const ruw = jsonUit(uit.tekst)
  if (!ruw) return json({ ok: false, reden: 'Het antwoord was geen bruikbare JSON.' }, 502)

  return json({ ok: true, door: uit.door, lezing: opschonen(soort, ruw) })
})
