import { db } from './db'
import { supabase, supabaseConfigured } from './api/supabaseApi'

/* ------------------------------------------------------------------ *
 *  E-mail via Resend
 *
 *  De sleutel van Resend zit niet in deze app en hoort daar ook niet. Wie
 *  hem heeft kan namens preview.truckwash.cloud versturen wat hij wil, en
 *  alles in een app op telefoons en laptops is uit te lezen. De sleutel
 *  staat dus in een serverfunctie bij Supabase.
 *
 *  Wat hier gebeurt is alleen: vragen of die functie iets wil versturen.
 *
 *  Twee dingen die met opzet zo zijn:
 *
 *   1. De app geeft nooit een e-mailadres mee, maar een id -- van een
 *      dossier, van een aanmelding, of een rol. De serverfunctie zoekt het
 *      adres er zelf bij. Daarmee kan niemand deze weg gebruiken om post
 *      naar een willekeurig adres te sturen.
 *
 *   2. De app geeft nooit HTML mee, alleen een sjabloonnaam en wat losse
 *      woorden. De opmaak staat op de server.
 *
 *  Mislukken mag. Een bericht in de app is de echte melding; de mail is de
 *  tik op de schouder voor wie de app niet openheeft. Gaat dat mis, dan
 *  komt het in het logboek en gaat de rest gewoon door.
 * ------------------------------------------------------------------ */

export type MailTemplate =
  /** Bevestiging aan de aanmelder plus een seintje aan het management */
  | 'aanmelding'
  | 'aanmelding-goedgekeurd'
  | 'aanmelding-afgewezen'
  /** Een melding uit de app, doorgestuurd naar het postvak */
  | 'bericht'
  /** Een mail die iemand zelf opstelt */
  | 'vrij'

export interface MailRequest {
  template: MailTemplate
  /** Het dossier van de ontvanger */
  toUserId?: string
  /** Of: de aanmelding waar het over gaat; het adres komt uit die rij */
  signupId?: string
  /** Het e-mailadres dat zich zojuist aanmeldde (alleen bij 'aanmelding') */
  email?: string
  /** Losse woorden voor in het sjabloon; nooit opmaak */
  vars?: Record<string, string>
  /** De melding waar deze mail bij hoort; zie mailBericht. */
  meldingId?: string
}

export interface MailResult {
  sent: number
  skipped?: string
  /**
   * Waarom hij niet aankwam, woordelijk zoals Resend het zegt.
   *
   * Die stond alleen in email_log. Dat is de juiste plek om hem te bewaren,
   * maar het betekende dat een scherm "verzenden mislukt" kon tonen terwijl
   * de echte melding -- "The domain is not verified" -- een tabel verderop
   * stond. Bij een proefmail is juist die melding het hele antwoord.
   */
  reden?: string | null
}

const FUNCTION = 'stuur-mail'

/** Onthoudt of de functie er is, zodat we niet elke keer opnieuw proberen. */
let functionMissing = false

/**
 * Vraagt de serverfunctie om post te versturen.
 *
 * Geeft nooit een fout terug: de bel in de app is de echte melding.
 */
export async function sendMail(request: MailRequest): Promise<MailResult | null> {
  if (!supabaseConfigured || functionMissing) return null

  /*
   * Zonder verbinding niet weggooien maar bewaren.
   *
   * Dit was een gat waar je zo doorheen viel: een leidinggevende die het
   * rooster op een tablet zonder bereik omgooit. Het belletje in de app kwam
   * later alsnog aan, want dat gaat via de wachtrij -- de mail was een
   * directe aanroep en verdween. Iemand kreeg dus wel bericht in een app die
   * hij niet openheeft, en geen mail.
   */
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await bewaarVoorStraks(request)
    return null
  }

  try {
    const { data, error } = await supabase().functions.invoke<MailResult>(FUNCTION, {
      body: request,
    })

    if (error) {
      // Niet uitgerold? Dan houden we op met vragen tot de app herstart.
      const msg = String(error.message ?? error)
      if (/not found|404/i.test(msg)) {
        functionMissing = true
        console.warn(
          `[mail] De functie ${FUNCTION} staat nog niet bij Supabase. ` +
          'De app blijft werken; er gaat alleen geen post uit.',
        )
        return null
      }

      /*
       * "non-2xx status code" zegt niemand iets. De functie zelf stuurt wél
       * een reden mee -- geen rechten, sjabloon onbekend, sleutel ontbreekt --
       * en die staat in het antwoord. Even uitpakken, want anders sta je te
       * raden bij een fout die precies vertelt wat eraan schort.
       */
      const uitgepakt = await leesFout(error)
      console.warn(`[mail] ${request.template} niet verstuurd: ${uitgepakt ?? msg}`)
      laatsteFout = uitgepakt ?? msg
      return null
    }

    return data ?? null
  } catch (e) {
    console.warn(`[mail] ${request.template} niet verstuurd: ${
      e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/* ------------------------------------------------------------------ *
 *  Post die moest wachten
 *
 *  Een eigen wachtrijtje, want post gaat niet langs de gewone
 *  synchronisatie: dat verstuurt records, en dit is een verzoek. Hij blijft
 *  op dit apparaat staan tot er verbinding is.
 * ------------------------------------------------------------------ */

/** Zoveel verzoeken bewaren we hoogstens; daarboven vervalt het oudste. */
const MAX_WACHTEND = 200

async function bewaarVoorStraks(request: MailRequest) {
  try {
    await db.mailOutbox.add({
      request,
      createdAt: Date.now(),
      tries: 0,
    })
    const aantal = await db.mailOutbox.count()
    if (aantal > MAX_WACHTEND) {
      const oudste = await db.mailOutbox.orderBy('createdAt').limit(aantal - MAX_WACHTEND).toArray()
      await db.mailOutbox.bulkDelete(oudste.map((r) => r.id!))
    }
  } catch {
    /* Lukt zelfs dat niet, dan is de bel in de app nog steeds gegaan. */
  }
}

/**
 * De bewaarde post alsnog versturen.
 *
 * Wordt bij elke geslaagde synchronisatieronde aangeroepen. Wat niet lukt
 * blijft staan, tot een stuk of wat pogingen -- een adres dat niet meer
 * bestaat hoort niet eeuwig te blijven rondzingen.
 */
export async function verstuurWachtendePost(): Promise<number> {
  if (!supabaseConfigured || functionMissing) return 0
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0

  let verstuurd = 0
  const wachtend = await db.mailOutbox.orderBy('createdAt').limit(25).toArray()

  for (const regel of wachtend) {
    const uit = await sendMail(regel.request as MailRequest)
    if (uit) {
      await db.mailOutbox.delete(regel.id!)
      verstuurd++
      continue
    }
    const tries = regel.tries + 1
    if (tries >= 5) {
      console.warn(
        `[mail] ${(regel.request as MailRequest).template} is na ${tries} pogingen opgegeven.`,
        laatsteFout ?? '')
      await db.mailOutbox.delete(regel.id!)
    } else {
      await db.mailOutbox.update(regel.id!, { tries })
    }
  }
  return verstuurd
}

/** Hoeveel post er nog op verzending wacht. */
export function wachtendePost(): Promise<number> {
  return db.mailOutbox.count()
}

/**
 * De reden die de serverfunctie meestuurde.
 *
 * supabase-js verpakt een foutstatus in een FunctionsHttpError met het
 * oorspronkelijke antwoord erin. Daar staat wat er werkelijk misging.
 */
async function leesFout(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown })?.context
  if (!context || typeof context !== 'object') return null
  try {
    const response = context as Response
    if (typeof response.json !== 'function') return null
    const body = await response.json()
    const reden = body?.error ?? body?.message ?? body?.skipped
    return reden ? String(reden) : null
  } catch {
    return null
  }
}

/** De laatste reden waarom er geen post uitging, voor in het scherm. */
let laatsteFout: string | null = null

export function laatsteMailFout(): string | null {
  return laatsteFout
}

/* ------------------------------------------------------------------ *
 *  De gevallen waarin er post uitgaat
 * ------------------------------------------------------------------ */

/**
 * Iemand heeft zich zojuist aangemeld.
 *
 * Dit is het enige verzoek dat zonder inlog mag -- de aanmelder heeft per
 * definitie nog geen toegang. De serverfunctie laat het alleen door als er
 * bij dit adres net werkelijk een aanmelding binnenkwam, en één keer.
 */
export async function mailAanmeldingOntvangen(email: string, naam: string) {
  return sendMail({ template: 'aanmelding', email, vars: { naam } })
}

/** Het management heeft een aanmelding toegelaten of afgewezen. */
export async function mailAanmeldingBesluit(
  signupId: string,
  goedgekeurd: boolean,
  vars: Record<string, string> = {},
) {
  return sendMail({
    template: goedgekeurd ? 'aanmelding-goedgekeurd' : 'aanmelding-afgewezen',
    signupId,
    vars,
  })
}

/**
 * Een mail die iemand zelf heeft opgesteld.
 *
 * Het enige geval waarin de app een adres meegeeft. Daarom loopt het ook
 * alleen langs deze weg: de serverfunctie eist de rol management of
 * ontwikkelaar, remt af, en legt elke verzending vast met de naam van wie
 * hem verstuurde.
 */
export async function mailVrij(
  email: string,
  onderwerp: string,
  tekst: string,
): Promise<MailResult | null> {
  return sendMail({ template: 'vrij', email, vars: { onderwerp, tekst } })
}

/**
 * Een melding uit de app ook in het postvak laten belanden.
 *
 * `open` zegt waar het over gaat: een schermnaam uit schermen.ts, of
 * 'meldingen' voor de bel. Het komt achter het adres in de knop van de mail te
 * staan, zodat die knop uitkomt bij het bericht en niet op de startpagina.
 * De serverfunctie laat alleen letters, cijfers, - en _ door, en de app kijkt
 * de naam na tegen haar eigen lijst; wat daar niet in staat opent gewoon de
 * app.
 */
export async function mailBericht(
  toUserId: string,
  vars: { titel: string; tekst: string; van?: string; open?: string; id?: string },
  /**
   * De melding waar deze mail bij hoort.
   *
   * Wordt vastgelegd bij de verzending (0112). Sneuvelt de mail -- en dat
   * gebeurde vandaag de hele dag, omdat Resend het afzenderdomein niet
   * kende -- dan is hij daarmee later opnieuw op te bouwen uit de melding
   * zelf. Niet uit een kopie: de melding is de bron van waarheid.
   */
  meldingId?: string,
) {
  return sendMail({ template: 'bericht', toUserId, vars, meldingId })
}

/* ------------------------------------------------------------------ *
 *  Wat er sneuvelde, alsnog versturen
 *
 *  Casper: "hoe stuur ik die notify's en dingen handmatig alsnog dan? gezien
 *  ze niet gestuurd zijn door het systeem op de tijden"
 *
 *  Een melding is gemaakt en de bel in de app is gegaan; alleen de mail
 *  erover werd geweigerd. De tekst staat nog in de melding zelf, dus de mail
 *  is opnieuw op te BOUWEN -- niet na te praten uit een kopie die intussen
 *  achterloopt.
 *
 *  Sinds 0112 draagt elke mail zijn herkomst. Alles van daarvóór niet: die
 *  regels staan er wel, maar zijn niet opnieuw te maken. Dat zegt het scherm
 *  er ook bij.
 * ------------------------------------------------------------------ */

/** Eén mislukte mail die opnieuw op te bouwen is. */
export interface MisluktEnTeRedden {
  id: string
  bron: string
  bronId: string
  naar: string
  onderwerp: string
  fout: string
  at: number
}

/** Wat er mislukt is en opnieuw geprobeerd kan worden. */
export async function misluktEnTeRedden(): Promise<MisluktEnTeRedden[]> {
  const { data, error } = await supabase().rpc('mail_opnieuw_te_proberen', { hoeveel: 50 })
  if (error) throw new Error(error.message)

  return (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
    id: String(r.id ?? ''),
    bron: String(r.bron ?? ''),
    bronId: String(r.bron_id ?? ''),
    naar: String(r.naar ?? ''),
    onderwerp: String(r.onderwerp ?? ''),
    fout: String(r.fout ?? ''),
    at: Number(r.at) || 0,
  }))
}

/**
 * Eén mislukte mail opnieuw opbouwen en versturen.
 *
 * Geeft terug wat eruit kwam, of null als de melding er niet meer is -- dan
 * valt er niets meer op te bouwen, en dat is geen fout maar een antwoord.
 */
export async function probeerOpnieuw(rij: MisluktEnTeRedden): Promise<MailResult | null> {
  if (rij.bron !== 'melding') return null

  const melding = await db.notifications.get(rij.bronId)
  /* Geen melding meer, of een melding zonder ontvanger: dan valt er niets op
     te bouwen. Dat is geen fout maar een antwoord. */
  if (!melding?.toUserId) return null

  return mailBericht(melding.toUserId, {
    titel: melding.title,
    tekst: melding.body,
    van: melding.fromName,
    open: melding.link || 'meldingen',
    id: melding.linkId,
  }, melding.id)
}
