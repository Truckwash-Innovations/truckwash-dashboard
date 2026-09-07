/* ===========================================================================
 *  Waar een link in een mail naartoe moet wijzen
 *
 *  Casper: "kan je ervoor zorgen dat alle linken die in mails worden verstuurd
 *  op de website uitkomen in plaats van de GitHub release? evt al bij die app,
 *  zodat ze misschien gelijk bij het bericht kunnen komen?"
 *
 *  Wat er stond
 *  ------------
 *
 *  Twee serverfuncties hadden allebei hun eigen APP_LINK, met dezelfde
 *  terugval:
 *
 *      https://github.com/Truckwash-Innovations/truckwash-dashboard/releases/latest
 *
 *  Dat is de plek waar een ontwikkelaar bestanden ophaalt. Wie een mail krijgt
 *  dat zijn aanmelding is goedgekeurd, komt daar terecht op een pagina met
 *  versienummers, .exe-bestanden en changelogs -- en moet zelf raden welke van
 *  de vijf bestanden voor hem is. En de secret APP_LINK stond nergens gezet,
 *  dus die terugval was niet de terugval maar wat er echt gebeurde.
 *
 *  Wat er nu staat
 *  ---------------
 *
 *  Twee adressen, allebei uit de tabel instellingen, zodat een verhuizing geen
 *  nieuwe versie kost:
 *
 *    app_url    waar de app draait          https://truckwash-workspace.com/app/
 *    site_url   waar de website staat       https://truckwash-workspace.com/
 *
 *  En twee soorten link, want het zijn twee verschillende vragen:
 *
 *    ophalen()  "ik moet de app nog installeren"  -> /medewerkers/ op de site,
 *               waar de knoppen voor Windows en Android staan mét uitleg
 *    openen()   "er staat iets voor me klaar"     -> de app zelf, en als we
 *               weten wát er klaarstaat meteen op dat scherm
 *
 *  Dat laatste is het punt van "gelijk bij het bericht kunnen komen": achter
 *  het adres komt ?open=postbus&id=..., en de app pikt dat op.
 *
 *  De automatische bijwerker blijft bij GitHub. Die haalt bestanden op, geen
 *  mensen.
 *
 *  Waarom alles langs een controle gaat
 *  ------------------------------------
 *
 *  Deze adressen komen uit de database en belanden in een href in een mail.
 *  Een adres dat niet klopt is daar geen kapotte link maar een doorstuurluik
 *  met ons logo erboven. Dus: alleen https, geen inlognaam in het adres, en
 *  bij twijfel het vaste adres hieronder.
 * =========================================================================== */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Waar we altijd op terugvallen. Nooit GitHub. */
const VASTE_SITE = 'https://truckwash-workspace.com/'
const VASTE_APP = 'https://truckwash-workspace.com/app/'

function schoon(ruw: unknown): URL | null {
  const tekst = String(ruw ?? '').trim()
  if (!tekst) return null
  try {
    const u = new URL(tekst)
    if (u.protocol !== 'https:' || u.username || u.password) return null
    return u
  } catch {
    return null
  }
}

/**
 * Beide adressen in één vraag aan de database.
 *
 * Twee losse selects zou twee rondjes kosten voor een mail die toch al op de
 * verzendende partij wacht -- maar het gaat hier vooral om één plek waar de
 * terugval staat, zodat de twee niet uit elkaar kunnen lopen.
 */
export async function adressen(admin: any): Promise<{ app: URL; site: URL }> {
  let rijen: Array<{ sleutel: string; waarde: string }> = []
  try {
    const { data } = await admin.from('instellingen')
      .select('sleutel, waarde')
      .in('sleutel', ['app_url', 'site_url'])
    rijen = data ?? []
  } catch {
    /* Geen database is geen reden om een mail zonder link te sturen. */
  }

  const uit = (s: string) => schoon(rijen.find((r) => r.sleutel === s)?.waarde)

  const app = uit('app_url') ?? schoon(Deno.env.get('APP_URL')) ?? new URL(VASTE_APP)

  /* Staat site_url niet ingevuld, dan is de wortel van het app-adres de beste
     gok: de site en de app staan op hetzelfde domein, met de app in /app/. */
  const site = uit('site_url') ?? schoon(Deno.env.get('SITE_URL')) ??
    schoon(app.origin + '/') ?? new URL(VASTE_SITE)

  return { app, site }
}

/**
 * "Ik heb de app nog niet."
 *
 * Naar /medewerkers/ op de website. Daar staat per besturingssysteem wat je
 * moet hebben, met een knop erbij -- in plaats van een lijst releases waarin
 * je zelf het goede bestand moet aanwijzen.
 */
export function ophalen(site: URL): string {
  return new URL('/medewerkers/', site).toString()
}

/**
 * "Er staat iets voor me klaar."
 *
 * Naar de app. Weten we welk scherm het betreft, dan gaat dat mee als
 * ?open=..., en eventueel ?id=... voor het ding zelf. De app kijkt die waarden
 * na tegen haar eigen lijst schermen; wat daar niet in staat wordt genegeerd.
 * Daarom mag hier een naam in die van de aanroeper komt.
 */
export function openen(app: URL, open?: string | null, id?: string | null): string {
  const u = new URL(app.toString())
  /* Alleen tekens die in een schermnaam of een id voorkomen. Een vraagteken of
     een schuine streep die hier ongezien in glipt, verandert het adres. */
  const veilig = (t: unknown, max: number) => {
    const s = String(t ?? '').trim().slice(0, max)
    return /^[A-Za-z0-9_-]+$/.test(s) ? s : ''
  }
  const scherm = veilig(open, 40)
  if (scherm) {
    u.searchParams.set('open', scherm)
    const ding = veilig(id, 64)
    if (ding) u.searchParams.set('id', ding)
  }
  return u.toString()
}
