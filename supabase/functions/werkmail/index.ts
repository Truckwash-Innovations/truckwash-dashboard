/* ===========================================================================
 *  Post versturen vanuit een eigen postvak
 *
 *  Casper: "Vervolgens krijgen ze ook toegang tot een soort outlook omgeving."
 *
 *  Binnenkomen doet de post via ontvang-mail; die zet hem in public.werkmail
 *  zodra het adres bij een medewerker hoort. Dit is de andere kant.
 *
 *  Het enige dat hier echt toe doet
 *  --------------------------------
 *
 *  Je verstuurt vanaf JOUW adres. Niet vanaf een adres dat je meestuurt.
 *
 *  Dat klinkt vanzelfsprekend en het is precies wat er misgaat als je het
 *  niet afdwingt: een functie die een afzender uit het verzoek overneemt, is
 *  een functie waarmee iedere ingelogde medewerker post kan sturen namens de
 *  directeur -- op het echte bedrijfsdomein, met een geldige handtekening
 *  eronder, want SPF en DKIM kloppen gewoon. Dat is geen foutje maar een
 *  gereedschap voor fraude.
 *
 *  Dus: het adres komt uit het dossier van degene die belt, en uit niets
 *  anders. Er is geen manier om het mee te geven.
 *
 *  En het versturen zelf gaat via Resend, dezelfde weg als de rest van de
 *  post. Wat hier ontbreekt en bij de meldingen wel staat, is het omhulsel:
 *  een mail van een mens aan een klant hoort er niet uit te zien als een
 *  systeembericht met een knop "de app openen".
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { meldStand } from '../_gedeeld/stand.ts'

/* Zegt bij de eerste start welke versie hier draait; zie _gedeeld/stand.ts. */
meldStand('werkmail')

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

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

/** Hooguit vijfentwintig ontvangers per bericht. Daarboven is het geen mail
    maar een nieuwsbrief, en daar zijn andere regels voor. */
const MAX_ONTVANGERS = 25
const MAX_TEKST = 100_000

interface Beller {
  id: string
  naam: string
  werkEmail: string
  handtekening: string | null
}

/* ------------------------------------------------------------------ *
 *  Wie belt er, en vanaf welk adres mag hij versturen?
 * ------------------------------------------------------------------ */

async function wieBelt(req: Request): Promise<Beller | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token || token === (Deno.env.get('SUPABASE_ANON_KEY') ?? '')) return null

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null

  const { data: profiel } = await admin
    .from('profiles')
    .select('id, name, werk_email, werk_mail_aan, active, archived_at, mail_handtekening')
    .eq('auth_id', data.user.id)
    .maybeSingle()

  if (!profiel?.active || profiel.archived_at) return null
  /* Geen adres of een postvak dat dicht staat: dan verstuurt hij niets. Een
     gesloten postvak hoort ook niet meer te kunnen zenden -- anders is
     "sluiten" alleen het stoppen van de inkomende post. */
  if (!profiel.werk_email || profiel.werk_mail_aan !== true) return null

  return {
    id: String(profiel.id),
    naam: String(profiel.name ?? ''),
    werkEmail: String(profiel.werk_email),
    handtekening: (profiel.mail_handtekening as string | null) ?? null,
  }
}

/* ------------------------------------------------------------------ *
 *  Adressen nakijken
 *
 *  Geen volledige controle op de standaard -- die is losser dan iedereen
 *  denkt en strenger zijn dan de standaard weigert geldige adressen. Wel
 *  streng genoeg om de fouten te vangen die je hier maakt: een spatie, een
 *  komma die per ongeluk in het adres staat, een naam zonder apenstaartje.
 * ------------------------------------------------------------------ */

function schoonAdres(ruw: unknown): string | null {
  const a = String(ruw ?? '').trim().toLowerCase()
  if (!a || a.length > 254) return null
  if (!/^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/.test(a)) return null
  return a
}

function adressen(ruw: unknown): { goed: string[]; fout: string[] } {
  const lijst = Array.isArray(ruw) ? ruw : String(ruw ?? '').split(/[,;]/)
  const goed: string[] = []
  const fout: string[] = []
  for (const r of lijst) {
    const schoon = schoonAdres(r)
    if (schoon) {
      if (!goed.includes(schoon)) goed.push(schoon)
    } else if (String(r ?? '').trim()) {
      fout.push(String(r).trim().slice(0, 80))
    }
  }
  return { goed, fout }
}

/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, reden: 'Alleen POST.' }, 405)

  const beller = await wieBelt(req)
  if (!beller) {
    return json({
      ok: false,
      reden: 'Je hebt geen postvak, of het staat uit. Vraag het management om '
        + 'een werkadres aan te zetten.',
    }, 403)
  }

  let lijf: Record<string, unknown> = {}
  try {
    lijf = await req.json()
  } catch {
    return json({ ok: false, reden: 'Geen leesbaar verzoek.' }, 400)
  }

  if (String(lijf.actie ?? 'versturen') !== 'versturen') {
    return json({ ok: false, reden: 'Onbekende actie.' }, 400)
  }

  /*
   * Vanaf welk adres?
   *
   * Standaard het eigen werkadres. Staat er een gedeeld postvak bij (0084),
   * dan wordt dát de afzender -- maar alleen als de beller er lid van is én
   * er mag versturen. Die vraag gaat naar de database en niet naar het
   * verzoek: "vanaf" is een ID en nooit een adres, zodat er ook hier niets
   * uit het verzoek in het from-veld terechtkomt. Zie de kop.
   */
  const vanafVak = typeof lijf.vanaf === 'string' && lijf.vanaf.trim()
    ? lijf.vanaf.trim()
    : null

  let vanAdres = beller.werkEmail
  let vanNaam: string | null = beller.naam || null
  let postbusId: string | null = null

  if (vanafVak) {
    const { data: vak } = await admin
      .from('postbus')
      .select('id, adres, naam, actief')
      .eq('id', vanafVak)
      .maybeSingle()

    const { data: lid } = await admin
      .from('postbus_lid')
      .select('mag_sturen')
      .eq('postbus_id', vanafVak)
      .eq('user_id', beller.id)
      .maybeSingle()

    if (!vak?.actief || !lid) {
      return json({ ok: false, reden: 'Je hoort niet bij dat postvak.' }, 403)
    }
    if (lid.mag_sturen !== true) {
      return json({
        ok: false,
        reden: 'Je mag in dit postvak meekijken maar niet versturen.',
      }, 403)
    }

    postbusId = String(vak.id)
    vanAdres = String(vak.adres)
    /* De naam van het postvak, niet die van de beller. Wie namens info@
       schrijft, schrijft namens het bedrijf -- en de ontvanger hoort te zien
       waar zijn antwoord heen gaat. */
    vanNaam = String(vak.naam ?? '') || null
  }

  const aan = adressen(lijf.aan)
  const cc = adressen(lijf.cc)

  if (aan.fout.length || cc.fout.length) {
    return json({
      ok: false,
      reden: `Dit is geen geldig adres: ${[...aan.fout, ...cc.fout].join(', ')}`,
    }, 400)
  }
  if (aan.goed.length === 0) {
    return json({ ok: false, reden: 'Er staat geen ontvanger in.' }, 400)
  }
  if (aan.goed.length + cc.goed.length > MAX_ONTVANGERS) {
    return json({
      ok: false,
      reden: `Hooguit ${MAX_ONTVANGERS} ontvangers per bericht. Meer is een `
        + 'nieuwsbrief, en daar gelden andere regels voor.',
    }, 400)
  }

  const onderwerp = String(lijf.onderwerp ?? '').trim().slice(0, 300)
  const tekst = String(lijf.tekst ?? '').slice(0, MAX_TEKST)
  if (!onderwerp && !tekst.trim()) {
    return json({ ok: false, reden: 'Een leeg bericht versturen heeft geen zin.' }, 400)
  }

  /*
   * De handtekening eronder, als die er is. Platte tekst, want dat is wat de
   * mail is -- zie de kop van 0082.
   *
   * Bij een gedeeld postvak niet. Die van de beller staat op zijn eigen naam
   * en adres, en die onder een bericht van info@ zetten spreekt zichzelf
   * tegen: bovenaan het bedrijf, onderaan een mens met een ander adres. Wie
   * er een wil, typt hem erin.
   */
  const lijfTekst = !postbusId && beller.handtekening?.trim()
    ? `${tekst}\n\n--\n${beller.handtekening.trim()}`
    : tekst

  if (!RESEND_KEY) {
    return json({ ok: false, reden: 'RESEND_API_KEY ontbreekt op de server.' }, 500)
  }

  /* ---- versturen ---- */

  const id = 'wm_' + crypto.randomUUID().replace(/-/g, '')
  let providerId: string | null = null
  let fout: string | null = null

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        /*
         * Het adres van de beller, en niets anders. Hier staat met opzet geen
         * waarde uit het verzoek: zie de kop.
         */
        from: vanNaam ? `${vanNaam} <${vanAdres}>` : vanAdres,
        to: aan.goed,
        ...(cc.goed.length ? { cc: cc.goed } : {}),
        reply_to: vanAdres,
        subject: onderwerp || '(geen onderwerp)',
        text: lijfTekst,
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) {
      providerId = typeof body?.id === 'string' ? body.id : null
    } else {
      fout = String(body?.message ?? res.status).slice(0, 400)
    }
  } catch (e) {
    fout = String(e instanceof Error ? e.message : e).slice(0, 400)
  }

  /* ---- en een kopie in Verzonden ---- */

  /*
   * Ook als het versturen mislukte. Dan staat het bericht er met de reden
   * erbij, en is het terug te vinden en opnieuw te versturen -- in plaats van
   * dat iemand zijn tekst kwijt is aan een foutmelding.
   */
  const { data: draadData } = await admin.rpc('werkmail_draad', {
    eigenaar: postbusId ?? beller.id,
    onderwerp_in: onderwerp,
    antwoord_op_in: typeof lijf.antwoordOp === 'string' ? lijf.antwoordOp : null,
  }).then((r: { data: unknown }) => r, () => ({ data: null }))

  const { error } = await admin.from('werkmail').insert({
    id,
    /* In het postvak waaruit hij vertrok. Een bericht namens info@ hoort in
       Verzonden van info@ te staan en niet in dat van degene die toevallig op
       versturen drukte -- anders ziet de collega die morgen antwoordt niet wat
       er al is gezegd. */
    user_id: postbusId ? null : beller.id,
    postbus_id: postbusId,
    richting: 'uit',
    map: 'verzonden',
    van: vanAdres,
    van_naam: vanNaam,
    aan: aan.goed,
    cc: cc.goed,
    onderwerp,
    tekst: lijfTekst,
    draad: typeof draadData === 'string' ? draadData : null,
    antwoord_op: typeof lijf.antwoordOp === 'string' ? lijf.antwoordOp : null,
    at: Date.now(),
    gelezen_at: Date.now(),
    provider_id: providerId,
    fout,
  })

  if (error) console.error('[werkmail] kopie bewaren: ' + error.message)

  if (fout) {
    return json({
      ok: false,
      reden: `Versturen lukte niet: ${fout}. Het bericht staat bij Verzonden, `
        + 'met de reden erbij.',
      id,
    }, 502)
  }

  return json({ ok: true, id, van: beller.werkEmail })
})
