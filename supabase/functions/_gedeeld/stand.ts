/**
 * Een functie die zegt dat hij er is, en welke versie hij draait
 *
 * Waarom
 * ------
 *
 * "npm run functions" vergeten ziet er van buitenaf precies zo uit als een
 * functie die stuk is: je roept iets aan, het antwoord klopt niet, en er is
 * geen manier om te zien of de code die daar draait de code is die je hebt
 * geschreven. Dat heeft hier meer dan eens een uur gekost.
 *
 * Elke functie meldt zich nu bij het opstarten. Dat is één regel bovenaan
 * index.ts:
 *
 *   meldStand('exact')
 *
 * Wanneer dat gebeurt
 * -------------------
 *
 * Bij een koude start, dus wanneer Supabase een nieuwe worker opzet. Niet bij
 * elk verzoek: dat zou een schrijfactie per aanroep zijn, en voor deze vraag
 * -- "welke versie draait daar" -- is één keer per worker ruim genoeg.
 *
 * Een functie die je vandaag niet in public.functie_stand ziet staan is dus
 * niet per se stuk; hij kan ook gewoon niet zijn aangeroepen. Andersom is wel
 * hard: staat er een oude versie, dan draait er een oude versie.
 *
 * Waarom het nooit iets kan breken
 * --------------------------------
 *
 * Omdat het niets is waar iemand op wacht. Er wordt niet op ge-await, elke
 * fout wordt opgeslokt, en de tabel mag ontbreken -- wie 0103 nog niet heeft
 * gedraaid merkt hier niets van behalve een regel in het logboek van de
 * functie zelf.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import { GEBOUWD, VERSIE } from './versie.ts'

/** Zodat een module die twee keer wordt ingeladen niet twee keer schrijft. */
let gemeld = false

export function meldStand(naam: string): void {
  if (gemeld) return
  gemeld = true

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const sleutel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !sleutel) return

  const werk = (async () => {
    try {
      const admin = createClient(url, sleutel, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { error } = await admin.rpc('functie_gezien', {
        p_naam: naam, p_versie: VERSIE, p_gebouwd: GEBOUWD,
      })
      if (error) console.warn(`[stand] ${naam} kon zich niet melden: ${error.message}`)
    } catch (e) {
      console.warn(`[stand] ${naam} kon zich niet melden: ${String(e)}`)
    }
  })()

  /*
   * waitUntil houdt de worker in leven tot dit klaar is. Zonder dat kan het
   * verzoek eerder klaar zijn dan de melding, en dan landt hij soms wel en
   * soms niet -- een tabel die de helft van de tijd iets zegt is erger dan
   * een die niets zegt. Niet elke runtime kent hem, vandaar de vraag vooraf.
   */
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime
  if (typeof rt?.waitUntil === 'function') rt.waitUntil(werk)
  else void werk.catch(() => {})
}
