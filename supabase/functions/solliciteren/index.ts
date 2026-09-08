/* ===========================================================================
 *  solliciteren -- het formulier op de website komt hier binnen
 *
 *  Uitrollen:  npm run functions:open
 *  NOOIT kaal deployen: zonder --no-verify-jwt gaat de inlogcontrole aan en
 *  krijgt elke sollicitant een 401. Een sollicitant heeft geen account; dat is
 *  het hele punt.
 *
 *  Waarom dit bestaat
 *  ------------------
 *
 *  De sollicitatieknoppen op de site wezen naar truckwash.trainstation.nl, een
 *  systeem van een andere partij. Wat daar binnenkwam kwam hier nooit aan:
 *  geen melding, geen taak, geen dossier. En bij de pendelchauffeur wees de
 *  knop naar vacaturenummer 1 -- hetzelfde nummer als de washeld -- zodat een
 *  sollicitatie op de verkeerde vacature belandde.
 *
 *  Nu komt hij hier binnen, en de trigger in 0068 maakt er meteen werk van bij
 *  de leiding van de gekozen vestiging.
 *
 *  Wat deze functie NIET aanneemt
 *  ------------------------------
 *
 *  Dit adres is openbaar. Alles wat binnenkomt is dus van een vreemde, en dat
 *  betekent drie dingen:
 *
 *   - de status komt niet uit het verzoek. Wie mag bepalen of hij al is
 *     aangenomen, is aangenomen.
 *   - de vestiging en de vacature worden nagekeken tegen de database. Een id
 *     dat niet bestaat wordt leeg, geen fout: anders is dit een manier om te
 *     achterhalen welke id's wél bestaan.
 *   - er zit een rem op. Zonder rem is een openbaar formulier een manier om
 *     onze database vol te schrijven en onze mailrekening op te maken.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { adressen, ophalen } from '../_gedeeld/adressen.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const AFZENDER = Deno.env.get('MAIL_FROM') ??
  'Truckwash1 Group <dashboard@preview.truckwash.cloud>'

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

/* ------------------------------------------------------------------ *
 *  Schoonmaken
 * ------------------------------------------------------------------ */

const tekst = (v: unknown, max: number): string =>
  String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Meerdere regels mogen blijven staan; alleen de lengte wordt begrensd. */
const alinea = (v: unknown, max: number): string =>
  String(v ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)

const jaNee = (v: unknown): boolean | null =>
  v === true || v === 'ja' ? true : v === false || v === 'nee' ? false : null

/**
 * Een geboortedatum, of niets.
 *
 * Een datum in de toekomst of van honderdtwintig jaar geleden is een typefout
 * of een grap; die halen we eruit in plaats van hem op te slaan en later te
 * moeten uitleggen waarom er een sollicitant van 1902 in het systeem staat.
 */
function datum(v: unknown): string | null {
  const s = tekst(v, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = Date.parse(s + 'T12:00:00Z')
  if (!Number.isFinite(d)) return null
  const jaren = (Date.now() - d) / (365.25 * 86400_000)
  return jaren >= 13 && jaren <= 90 ? s : null
}

const DAGEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']

/**
 * De beschikbaarheid uit het formulier.
 *
 * Alleen de zeven dagen die wij kennen, alleen tijden die op een tijd lijken.
 * Wat er niet bij past valt weg -- dit gaat als jsonb de database in en wordt
 * later in een scherm getoond; wat daar binnenkomt hoort schoon te zijn.
 */
function beschikbaarheid(v: unknown): { dag: string; van: string; tot: string; opmerking: string }[] {
  if (!Array.isArray(v)) return []
  const uit: { dag: string; van: string; tot: string; opmerking: string }[] = []
  for (const rij of v.slice(0, 7)) {
    if (!rij || typeof rij !== 'object') continue
    const r = rij as Record<string, unknown>
    const dag = tekst(r.dag, 12).toLowerCase()
    if (!DAGEN.includes(dag)) continue
    if (uit.some((x) => x.dag === dag)) continue
    const tijd = (t: unknown) => {
      const s = tekst(t, 5)
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : ''
    }
    uit.push({
      dag,
      van: tijd(r.van),
      tot: tijd(r.tot),
      opmerking: tekst(r.opmerking, 120),
    })
  }
  return uit
}

/* ------------------------------------------------------------------ *
 *  De rem
 *
 *  Twee grenzen. Per adres, zodat één iemand niet honderd keer hetzelfde
 *  formulier verstuurt, en over het geheel, zodat een script dat honderd
 *  adressen verzint niet honderd rijen en honderd mails oplevert.
 * ------------------------------------------------------------------ */

const PER_ADRES_PER_DAG = 3
const TOTAAL_PER_UUR = 40

async function teVaak(email: string): Promise<string | null> {
  const dag = Date.now() - 86_400_000
  const uur = Date.now() - 3_600_000

  const { count: eigen } = await admin.from('sollicitatie')
    .select('id', { count: 'exact', head: true })
    .eq('email', email).gte('created_at', dag)
  if ((eigen ?? 0) >= PER_ADRES_PER_DAG) {
    return 'Je hebt vandaag al gesolliciteerd. We hebben hem binnen.'
  }

  const { count: alles } = await admin.from('sollicitatie')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', uur)
  if ((alles ?? 0) >= TOTAAL_PER_UUR) {
    return 'Het is nu erg druk. Probeer het over een uurtje nog eens, of bel ons.'
  }

  return null
}

/* ------------------------------------------------------------------ *
 *  De bevestiging
 * ------------------------------------------------------------------ */

const veilig = (t: unknown) => String(t ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function bevestig(naar: string, naam: string, wat: string, appLink: string) {
  if (!RESEND_KEY) return
  const kop = `Dag ${naam}, we hebben je sollicitatie`
  const regels = [
    `Bedankt voor je sollicitatie${wat ? ` op ${wat}` : ''}. Hij is binnen en ligt bij de juiste vestiging.`,
    'Iemand van ons neemt contact met je op om een gesprek in te plannen. Dat gebeurt meestal binnen een paar werkdagen.',
    'Heb je in de tussentijd een vraag, of klopt er iets niet? Bel dan gerust 088 - 0600 100.',
  ]
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: AFZENDER,
        to: [naar],
        subject: 'We hebben je sollicitatie ontvangen',
        html: `<!doctype html><html lang="nl"><body style="margin:0;background:#f2f4f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden;
                    font-family:-apple-system,Segoe UI,Roboto,sans-serif">
        <tr><td style="background:#0b1220;padding:20px 26px">
          <span style="color:#f8c010;font-size:17px;font-weight:800">TRUCKWASH1</span>
        </td></tr>
        <tr><td style="padding:26px">
          <h1 style="margin:0 0 14px;font-size:20px;color:#0b1220">${veilig(kop)}</h1>
          ${regels.map((r) =>
            `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#243044">${veilig(r)}</p>`).join('')}
          <p style="margin:18px 0 0;font-size:13px;color:#8b9ab5">
            Meer over werken bij ons: <a href="${veilig(appLink)}">${veilig(appLink)}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
        text: [kop, '', ...regels].join('\n'),
      }),
    })
  } catch {
    /* Een bevestiging die niet aankomt is vervelend; een sollicitatie die
       daardoor niet wordt opgeslagen is erger. Dus zwijgend door. */
  }
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, reden: 'Alleen POST' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, reden: 'Onleesbaar verzoek' }, 400)
  }

  const naam = tekst(body.naam, 120)
  const email = tekst(body.email, 160).toLowerCase()
  if (!naam) return json({ ok: false, reden: 'Vul je naam in.' }, 400)
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
    return json({ ok: false, reden: 'Dat e-mailadres klopt niet.' }, 400)
  }

  const rem = await teVaak(email)
  if (rem) return json({ ok: false, reden: rem }, 429)

  /* Vestiging en vacature worden nagekeken tegen de database; wat niet bestaat
     wordt leeg en geen foutmelding. Zie de kop.

     De site stuurt een slug en geen id: onze sleutels horen niet in een
     openbare pagina te staan. Hier wordt hij omgezet. */
  let locationId: string | null = null
  const gevraagdeLocatie = tekst(body.locatie, 60)
  if (gevraagdeLocatie) {
    const { data } = await admin.from('locations')
      .select('id').eq('website_slug', gevraagdeLocatie).eq('active', true).maybeSingle()
    locationId = data?.id ?? null
  }

  let vacatureId: string | null = null
  let vacatureTitel: string | null = null
  const gevraagdeVacature = tekst(body.vacature, 80)
  if (gevraagdeVacature) {
    const { data } = await admin.from('vacature')
      .select('id, titel').eq('slug', gevraagdeVacature).eq('actief', true).maybeSingle()
    vacatureId = data?.id ?? null
    vacatureTitel = data?.titel ?? null
  }

  const id = 'sol_' + crypto.randomUUID().replace(/-/g, '')

  const { error } = await admin.from('sollicitatie').insert({
    id,
    vacature_id: vacatureId,
    vacature_titel: vacatureTitel,
    location_id: locationId,
    naam,
    email,
    telefoon: tekst(body.telefoon, 40),
    geboortedatum: datum(body.geboortedatum),
    woonplaats: tekst(body.woonplaats, 80),
    school: jaNee(body.school),
    opleiding: tekst(body.opleiding, 120),
    niveau: tekst(body.niveau, 60),
    leerjaar: tekst(body.leerjaar, 40),
    ervaring: alinea(body.ervaring, 800),
    hoe_gevonden: tekst(body.hoeGevonden, 120),
    motivatie: alinea(body.motivatie, 2000),
    hoe_lang: tekst(body.hoeLang, 120),
    beperkingen: alinea(body.beperkingen, 500),
    vervoer: tekst(body.vervoer, 60),
    rijbewijs: jaNee(body.rijbewijs),
    reistijd: tekst(body.reistijd, 40),
    andere_vestiging: jaNee(body.andereVestiging),
    beschikbaarheid: beschikbaarheid(body.beschikbaarheid),
    /* status komt met opzet NIET uit het verzoek. */
  })

  if (error) {
    console.error('sollicitatie opslaan mislukt:', error.message)
    return json({ ok: false, reden: 'Opslaan lukte niet. Probeer het zo nog eens.' }, 500)
  }

  const { site } = await adressen(admin)
  await bevestig(email, naam.split(' ')[0], vacatureTitel ?? '', ophalen(site))

  return json({ ok: true })
})
