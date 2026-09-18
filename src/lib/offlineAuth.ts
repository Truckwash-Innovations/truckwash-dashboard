import { db, getMeta, setMeta, uid } from './db'

/* ------------------------------------------------------------------ *
 *  Offline inloggen
 *
 *  Een echte backend (Supabase) controleert wachtwoorden op de server en
 *  stuurt ze nooit mee. Zonder internet kunnen we dus niets aan de server
 *  vragen. Daarom onthouden we bij een geslaagde online inlog een
 *  afgeleide van het wachtwoord: een SHA-256-hash met een salt die alleen
 *  op dit apparaat bestaat.
 *
 *  Daarmee kan iemand die dit apparaat eerder gebruikte ook zonder
 *  verbinding inloggen, zonder dat het wachtwoord zelf ergens staat.
 * ------------------------------------------------------------------ */

const SALT_KEY = 'offlineAuthSalt'

async function salt(): Promise<string> {
  let s = await getMeta<string | null>(SALT_KEY, null)
  if (!s) {
    s = uid('salt')
    await setMeta(SALT_KEY, s)
  }
  return s
}

async function digest(email: string, password: string): Promise<string> {
  const material = `${(await salt())}:${email.trim().toLowerCase()}:${password}`
  const bytes = new TextEncoder().encode(material)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const key = (email: string) => `offlineAuth:${email.trim().toLowerCase()}`

/** Onthoudt de inloggegevens na een geslaagde online inlog. */
export async function rememberOfflineLogin(email: string, password: string, userId: string) {
  await setMeta(key(email), { userId, hash: await digest(email, password) })
}

/** Geeft het gebruikers-id terug als e-mail en wachtwoord kloppen, anders null. */
export async function verifyOfflineLogin(email: string, password: string): Promise<string | null> {
  const stored = await getMeta<{ userId: string; hash: string } | null>(key(email), null)
  if (!stored) return null
  return (await digest(email, password)) === stored.hash ? stored.userId : null
}

/** Alle lokale gegevens wissen. Gebruikt bij het wisselen van backend. */
export async function forgetEverything() {
  await Promise.all(db.tables.map((t) => t.clear()))
}

/* ------------------------------------------------------------------ *
 *  Wat er niet op een afgemeld apparaat hoort te blijven staan
 *
 *  De cache blijft met opzet staan als je uitlogt -- daar draait offline
 *  inloggen op, en dat is precies wat een tablet in de wasstraat nodig
 *  heeft. Maar dat gold ook voor het dossier, en dat hoort er niet bij.
 *
 *  Deze tabellen bevatten gegevens van ANDEREN: een leidinggevende die
 *  inlogt trekt het BSN, het rekeningnummer en de paspoortscan van zijn
 *  collega's naar zijn toestel. Raakt dat toestel kwijt terwijl er niemand
 *  is ingelogd, dan is dat een datalek dat binnen 72 uur gemeld moet worden.
 *
 *  Wat iemand van zichzelf bij zich draagt (zijn eigen post, zijn eigen
 *  rooster) staat hier bewust niet tussen. Dat is een aparte afweging.
 * ------------------------------------------------------------------ */

const GEVOELIG = () => [
  db.personnelPrivate,  // geboortedatum, nationaliteit, documentnummer, BSN
  db.personnelLoon,     // rekeningnummer, uurloon, interne notities
  db.documents,         // dossierstukken, waaronder de scan van een ID-bewijs
  db.changeRequests,    // wijzigingsverzoeken op een dossier
  db.sollicitaties,     // van mensen die hier nog niet eens werken
]

/**
 * Wist de dossiergegevens uit de lokale kopie.
 *
 * Bij uitloggen, en bij het inloggen van iemand anders op hetzelfde toestel.
 * De rest van de cache blijft staan zodat offline werken blijft werken; deze
 * tabellen worden bij de eerstvolgende synchronisatie vanzelf weer gevuld
 * voor wie ze mag zien.
 */
export async function vergeetDossiergegevens() {
  await Promise.all(GEVOELIG().map((t) => t.clear()))
}
