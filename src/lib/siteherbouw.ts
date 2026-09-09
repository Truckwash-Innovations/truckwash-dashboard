import type { EntityName } from './types'
import { supabase, supabaseConfigured } from './api/supabaseApi'

/* ------------------------------------------------------------------ *
 *  De website laten bijwerken
 *
 *  Casper: "als ik een vestiging maak via de app, dat je die direct live hebt
 *  op de website".
 *
 *  De site haalt zijn lijsten en tellingen al bij elk bezoek op (live.js),
 *  maar elke vestiging heeft ook een eigen pagina, en die bestaat als
 *  bestand. Een pagina die er niet is, kan zichzelf niet invullen -- dus moet
 *  de site opnieuw gebouwd worden. Dat doet .github/workflows/site.yml, en
 *  dit bestand geeft het seintje.
 *
 *  WAAROM DIT NIET BIJ HET OPSLAAN GEBEURT
 *  ---------------------------------------
 *
 *  Dat was de eerste ingeving en hij is fout. Deze app schrijft eerst
 *  plaatselijk en duwt daarna pas naar de server -- dat is het hele punt van
 *  de offline-eerst opzet. Een seintje op het moment van opslaan laat GitHub
 *  dus bouwen met een database waar de wijziging nog helemaal niet in staat.
 *
 *  Gevolg zou zijn: een herbouw die niets oplevert, en de echte wijziging die
 *  pas de volgende nacht op de site komt. Precies het tegenovergestelde van
 *  wat er gevraagd is, en niet te zien aan iets -- de knop zou gewoon
 *  "bijgewerkt" zeggen.
 *
 *  Dus wordt er onthouden dat er iets langs is gekomen dat de site raakt, en
 *  gaat het seintje pas als de wachtrij het er echt doorheen heeft gekregen.
 * ------------------------------------------------------------------ */

/*
 * Wat de website laat zien.
 *
 * locationPhotos staat erbij omdat de foto's van een vestiging op zijn
 * pagina komen (0046) -- een nieuwe omslagfoto is voor een bezoeker net zo
 * goed een wijziging als een nieuw telefoonnummer.
 *
 * instellingen staat er met opzet NIET bij: daar hangt de hele app aan en
 * bijna niets ervan komt op de site. Dan zou elke wijziging in een
 * boekhoudinstelling een herbouw van de website starten.
 */
const RAAKT_DE_SITE: readonly EntityName[] = ['locations', 'locationPhotos', 'vacatures']

let wachtOpSeintje = false

/** Onthoudt dat er iets is doorgekomen dat op de website te zien is. */
export function merkOp(entiteiten: readonly EntityName[]): void {
  if (wachtOpSeintje) return
  if (entiteiten.some((e) => RAAKT_DE_SITE.includes(e))) wachtOpSeintje = true
}

/** Alleen voor de zelftest: kijken of er een seintje klaarstaat. */
export function seintjeKlaar(): boolean {
  return wachtOpSeintje
}

/** Alleen voor de zelftest: terug naar de beginstand. */
export function vergeetSeintje(): void {
  wachtOpSeintje = false
}

/**
 * Geeft het seintje, als er iets te melden is.
 *
 * Gooit nooit. Dit hangt achter een geslaagde synchronisatie, en een website
 * die niet meteen bijwerkt mag geen synchronisatie laten omvallen -- dan zou
 * een haperende GitHub-koppeling de hele app blokkeren. Mislukt het, dan
 * bouwt de nachtelijke ronde de site alsnog; de serverfunctie meldt een
 * verlopen token zelf aan het management.
 *
 * De vlag gaat vooraf omlaag en niet achteraf. Twee rondes vlak na elkaar
 * zouden anders allebei bellen, en de rem zit dan wel op de server maar het
 * verkeer is er al.
 */
export async function geefSeintjeAlsNodig(): Promise<void> {
  if (!wachtOpSeintje) return
  wachtOpSeintje = false

  if (!supabaseConfigured || !navigator.onLine) return

  try {
    await supabase().functions.invoke('site-herbouwen', { body: {} })
  } catch {
    /* Stil. Zie hierboven: vannacht gaat hij alsnog. */
  }
}
