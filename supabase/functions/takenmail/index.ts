/* ===========================================================================
 *  takenmail -- om 7 en om 15 uur wat er bij je ligt
 *
 *  Casper: "zorg ook ervoor dat iedereen om 7 uur en 15:00 uur een mail
 *  krijgen met al hun todo's".
 *
 *  Uitrollen:  npm run functions:dicht
 *  Deze mag de JWT-controle houden: hij wordt gewekt door GitHub Actions met
 *  een eigen geheim, niet door een browser. Zie .github/workflows/taken.yml.
 *
 *  Wat hier NIET staat
 *  -------------------
 *
 *  De vraag "wat ligt er bij wie". Die staat in taken_voor_mail() (0070), en
 *  met reden: het is dezelfde regel als isVanMij() in de app en als de policy
 *  op taak in 0067. Drie plekken die hetzelfde moeten zeggen zijn er twee te
 *  veel; nu weet deze functie niets van rollen, vestigingen of manages[].
 *
 *  De tijd
 *  -------
 *
 *  GitHub plant in UTC en Nederland verzet twee keer per jaar de klok. Zeven
 *  uur 's ochtends is dus 5 of 6 uur UTC, afhankelijk van de maand. De wekker
 *  loopt daarom elk heel uur van 4 tot en met 14 UTC langs en deze functie
 *  kijkt zelf hoe laat het in Nederland is. Dat is DST-bestendig zonder dat
 *  iemand twee keer per jaar aan een cron moet denken.
 *
 *  En hij houdt bij wanneer hij voor het laatst ging, per uur. GitHub start
 *  een schedule soms twee keer, en twee identieke mails om zeven uur is erger
 *  dan geen mail: dan gaat de volgende ook ongelezen weg.
 * =========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { adressen, openen } from '../_gedeeld/adressen.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const AFZENDER = Deno.env.get('MAIL_FROM') ??
  'Truckwash1 Group <dashboard@preview.truckwash.cloud>'
const GEHEIM = Deno.env.get('TAKEN_CRON_SECRET') ?? ''

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
 *  Hoe laat is het in Nederland
 *
 *  Via de tijdzonedatabase van de omgeving en niet met een offset die we zelf
 *  uitrekenen: dan klopt hij ook in de week dat Europa de klok verzet en wij
 *  nog niet aan die code hebben gedacht.
 * ------------------------------------------------------------------ */

function nederlandseTijd(nu = new Date()): { uur: number; dag: string } {
  const opm = new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(nu)
  const deel = (t: string) => opm.find((p) => p.type === t)?.value ?? ''
  return {
    uur: Number(deel('hour')),
    dag: `${deel('year')}-${deel('month')}-${deel('day')}`,
  }
}

async function instelling(sleutel: string): Promise<string> {
  const { data } = await admin.from('instellingen')
    .select('waarde').eq('sleutel', sleutel).maybeSingle()
  return String(data?.waarde ?? '').trim()
}

async function zetInstelling(id: string, sleutel: string, waarde: string, omschrijving: string) {
  await admin.from('instellingen').upsert({ id, sleutel, waarde, omschrijving }, { onConflict: 'id' })
}

/* ------------------------------------------------------------------ *
 *  De mail
 * ------------------------------------------------------------------ */

const veilig = (t: unknown) => String(t ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface TaakRegel {
  titel: string
  prioriteit: string
  status: string
  deadline: number | null
  bron: string
  vanRol: boolean
}

const PRIO_TEKST: Record<string, string> = {
  urgent: 'Urgent', hoog: 'Hoog', normaal: '', laag: 'Laag',
}

const STATUS_TEKST: Record<string, string> = {
  te_doen: 'te doen', bezig: 'bezig', wacht: 'wacht op iemand',
}

function datumNL(ms: number | null): string {
  if (!ms) return ''
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'short',
  }).format(new Date(ms))
}

function brief(naam: string, taken: TaakRegel[], teLaat: number, link: string, uur: number) {
  const nu = Date.now()
  const kop = uur < 12
    ? `Goedemorgen ${naam}, dit ligt er vandaag`
    : `${naam}, dit staat er nog open`

  const regel = (t: TaakRegel) => {
    const laat = t.deadline && t.deadline < nu
    const bijzonder = [
      PRIO_TEKST[t.prioriteit] || '',
      STATUS_TEKST[t.status] || '',
      t.deadline ? (laat ? `over de datum (${datumNL(t.deadline)})` : datumNL(t.deadline)) : '',
      /* Werk dat nog door niemand is opgepakt: dat is de reden dat het bij een
         rol ligt en niet bij een persoon, en het is wat je wilt zien. */
      t.vanRol ? 'nog niet opgepakt' : '',
    ].filter(Boolean).join(' &middot; ')

    return `<tr>
      <td style="padding:9px 0;border-bottom:1px solid #eef1f6">
        <div style="font-size:15px;color:#0b1220;font-weight:600${laat ? ';color:#b3261e' : ''}">
          ${veilig(t.titel)}
        </div>
        ${bijzonder ? `<div style="font-size:13px;color:#6b7891;margin-top:2px">${bijzonder}</div>` : ''}
      </td>
    </tr>`
  }

  const inleiding = teLaat > 0
    ? `Je hebt ${taken.length} ${taken.length === 1 ? 'taak' : 'taken'} openstaan, waarvan ` +
      `${teLaat === 1 ? 'er één' : `er ${teLaat}`} over de datum ${teLaat === 1 ? 'is' : 'zijn'}.`
    : `Je hebt ${taken.length} ${taken.length === 1 ? 'taak' : 'taken'} openstaan.`

  const html = `<!doctype html><html lang="nl"><body style="margin:0;background:#f2f4f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden;
                    font-family:-apple-system,Segoe UI,Roboto,sans-serif">
        <tr><td style="background:#0b1220;padding:20px 26px">
          <span style="color:#f8c010;font-size:17px;font-weight:800">TRUCKWASH1</span>
          <span style="color:#8b9ab5;font-size:13px;margin-left:8px">Jouw werk</span>
        </td></tr>
        <tr><td style="padding:26px">
          <h1 style="margin:0 0 6px;font-size:20px;color:#0b1220">${veilig(kop)}</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#243044">${inleiding}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${taken.slice(0, 25).map(regel).join('')}
          </table>
          ${taken.length > 25
            ? `<p style="margin:12px 0 0;font-size:13px;color:#6b7891">
                 En nog ${taken.length - 25} andere. Die staan in het dashboard.</p>`
            : ''}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0">
            <tr><td style="border-radius:9px;background:#f8c010">
              <a href="${veilig(link)}"
                 style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;
                        color:#14202f;text-decoration:none">Openen in het dashboard</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 26px;background:#fafbfd;border-top:1px solid #e6e9ef">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#8b9ab5">
            Je krijgt dit bericht omdat er werk op je naam staat. Staat er niets open,
            dan sturen we ook niets.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  const text = [
    kop, '', inleiding, '',
    ...taken.slice(0, 25).map((t) => {
      const bij = [
        PRIO_TEKST[t.prioriteit] || '',
        t.deadline ? datumNL(t.deadline) : '',
        t.vanRol ? 'nog niet opgepakt' : '',
      ].filter(Boolean).join(' - ')
      return `- ${t.titel}${bij ? ` (${bij})` : ''}`
    }),
    '', `Openen in het dashboard: ${link}`,
  ].join('\n')

  return { onderwerp: uur < 12 ? 'Je werk voor vandaag' : 'Wat er nog openstaat', html, text }
}

async function verstuur(naar: string, b: { onderwerp: string; html: string; text: string }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: AFZENDER, to: [naar], subject: b.onderwerp, html: b.html, text: b.text }),
  })
  return res.ok
}

/* ------------------------------------------------------------------ *
 *  Het verzoek
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, reden: 'Alleen POST' }, 405)

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch { /* een leeg lijf mag; dan telt alleen het geheim */ }

  if (!GEHEIM) {
    return json({ ok: false, reden: 'TAKEN_CRON_SECRET staat niet op de server.' }, 500)
  }
  if (String(body.geheim ?? '') !== GEHEIM) {
    return json({ ok: false, reden: 'Verkeerd geheim.' }, 403)
  }

  const { uur, dag } = nederlandseTijd()
  const proef = body.actie === 'test'

  /* Is dit een van de ingestelde uren? */
  const uren = (await instelling('taken_mail_uren'))
    .split(',').map((u) => Number(u.trim())).filter((u) => Number.isInteger(u) && u >= 0 && u <= 23)

  if (!proef) {
    if (!uren.length) return json({ ok: true, overgeslagen: 'taken_mail_uren is leeg' })
    if (!uren.includes(uur)) return json({ ok: true, overgeslagen: `het is ${uur} uur` })

    /* Al gegaan voor dit uur? GitHub start een schedule soms twee keer. */
    const stempel = `${dag}T${String(uur).padStart(2, '0')}`
    if (await instelling('taken_mail_laatst') === stempel) {
      return json({ ok: true, overgeslagen: 'deze ronde is al geweest' })
    }
    await zetInstelling('in_taken_mail_laatst', 'taken_mail_laatst', stempel,
      'Wanneer de takenmail voor het laatst is verstuurd (jjjj-mm-ddTuu). ' +
      'Voorkomt dat dezelfde ronde twee keer gaat.')
  }

  const { data, error } = await admin.rpc('taken_voor_mail')
  if (error) return json({ ok: false, reden: 'De database antwoordde niet: ' + error.message }, 500)

  const rijen = Array.isArray(data) ? data : []
  const { app } = await adressen(admin)
  const link = openen(app, 'werk')

  let verstuurd = 0
  let mislukt = 0
  for (const r of rijen) {
    const taken = (Array.isArray(r.taken) ? r.taken : []) as TaakRegel[]
    if (!taken.length) continue
    const naam = String(r.naam ?? '').split(' ')[0] || 'collega'
    const ok = await verstuur(String(r.email), brief(naam, taken, Number(r.te_laat ?? 0), link, uur))
    if (ok) verstuurd++; else mislukt++
  }

  return json({ ok: true, uur, mensen: rijen.length, verstuurd, mislukt })
})
