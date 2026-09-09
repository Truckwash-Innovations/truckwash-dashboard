/* ===========================================================================
 *  Post -- één opmaak voor de mail die dit systeem verstuurt
 *
 *  Waarom dit bestand er is
 *  ------------------------
 *
 *  De briefopmaak (de gele balk, de kaart, de knop "De app openen") stond in
 *  nodig-uit/index.ts, honderd regels diep in een functie die over iets heel
 *  anders gaat. Toen er een tweede mail bij kwam die er hetzelfde uit moet
 *  zien -- de herstelcode -- was de keuze: die honderd regels kopiëren, of ze
 *  hierheen halen.
 *
 *  Gekopieerde opmaak loopt uit elkaar. Niet meteen, maar bij de eerste keer
 *  dat er één wordt bijgewerkt.
 *
 *  nodig-uit heeft nog zijn eigen kopie. Dat is met opzet: die functie werkt
 *  en er was geen reden om hem voor deze wijziging open te leggen. Komt daar
 *  een keer wat aan, dan hoort hij hierheen. Nieuwe post begint hier.
 *
 *  Wat het doet
 *  ------------
 *
 *  Een Brief beschrijft wat er in de mail staat -- geen HTML. De opmaak
 *  gebeurt hier, de ontsnapping ook, en er gaat altijd een kale tekstversie
 *  mee. Elke verzending laat een regel achter in email_log, gelukt of niet:
 *  zonder dat is "hij heeft geen mail gehad" niet te beantwoorden.
 * =========================================================================== */

import { adressen, openen } from './adressen.ts'

export interface Brief {
  onderwerp: string
  kop: string
  alineas: string[]
  gegevens?: [string, string][]
  voet?: string
}

/** HTML-tekens onschadelijk maken. Alles wat in een brief komt gaat hierlangs. */
export function veilig(text: unknown): string {
  return String(text ?? '')
    .slice(0, 500)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/*
 * De knop wijst naar de app. Dat adres staat in de tabel instellingen en gaat
 * daarom als parameter mee in plaats van als constante bovenin: bij een
 * verhuizing hoeft er dan geen nieuwe versie uit.
 */
export function omhulsel(b: Brief, appLink: string): string {
  return `<!doctype html>
<html lang="nl"><body style="margin:0;padding:0;background:#f2f4f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f8;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;
                    border:1px solid #e6e9ef;font-family:'Segoe UI',Helvetica,Arial,sans-serif">
        <tr><td style="background:#0b1220;padding:20px 26px">
          <span style="color:#f8c010;font-size:17px;font-weight:800">TRUCKWASH1</span>
          <span style="color:#8b9ab5;font-size:13px;margin-left:8px">Dashboard</span>
        </td></tr>
        <tr><td style="padding:26px">
          <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#0b1220">${veilig(b.kop)}</h1>
          ${b.alineas.map((a) =>
            `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#243044">${veilig(a)}</p>`).join('')}
          ${b.gegevens?.length ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="margin:6px 0 18px;border:1px solid #e6e9ef;border-radius:10px;background:#fafbfd">
              ${b.gegevens.map(([k, v]) => `
                <tr>
                  <td style="padding:10px 14px;font-size:13px;color:#6b7891;width:38%">${veilig(k)}</td>
                  <td style="padding:10px 14px;font-size:15px;color:#0b1220;font-weight:700;
                             font-family:Consolas,Menlo,monospace">${veilig(v)}</td>
                </tr>`).join('')}
            </table>` : ''}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px">
            <tr><td style="border-radius:9px;background:#f8c010">
              <a href="${veilig(appLink)}"
                 style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;
                        color:#14202f;text-decoration:none">De app openen</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 26px;background:#fafbfd;border-top:1px solid #e6e9ef">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#8b9ab5">
            ${veilig(b.voet ?? 'Dit bericht komt uit het Truckwash1-dashboard.')}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

interface Postkamer {
  resendKey: string
  afzender: string
}

/**
 * Versturen en vastleggen.
 *
 * Geeft terug of het gelukt is; gooit niet. Een mislukte mail is hier geen
 * uitzondering maar een uitkomst -- de aanroeper beslist wat hij ermee doet,
 * en er staat hoe dan ook een regel in email_log.
 */
export async function verstuurBrief(
  // deno-lint-ignore no-explicit-any
  admin: any,
  kamer: Postkamer,
  naar: string,
  brief: Brief,
  template: string,
): Promise<boolean> {
  const id = 'em_' + crypto.randomUUID().replace(/-/g, '')
  const { app } = await adressen(admin)
  const appLink = openen(app)

  let ok = false
  let fout: string | undefined
  let providerId: string | undefined

  if (!kamer.resendKey) {
    fout = 'RESEND_API_KEY ontbreekt op de server'
  } else {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kamer.resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: kamer.afzender,
          to: [naar],
          subject: brief.onderwerp,
          html: omhulsel(brief, appLink),
          /* Ook kaal, anders staat er voor wie geen HTML leest een mail
             zonder enige inhoud. */
          text: [brief.kop, '', ...brief.alineas,
                 ...(brief.gegevens ?? []).map(([k, v]) => `${k}: ${v}`),
                 '', `De app openen: ${appLink}`].join('\n'),
        }),
      })
      const body = await res.json().catch(() => ({}))
      ok = res.ok
      providerId = body?.id
      if (!ok) fout = String(body?.message ?? res.status).slice(0, 400)
    } catch (e) {
      fout = String(e instanceof Error ? e.message : e).slice(0, 400)
    }
  }

  await admin.from('email_log').insert({
    id, template, to_email: naar, subject: brief.onderwerp,
    status: ok ? 'verstuurd' : 'mislukt',
    provider_id: providerId ?? null, error: fout ?? null, at: Date.now(),
  })

  return ok
}
