/**
 * Doorklikken naar het camerportaal
 *
 * Wat dit oplost
 * --------------
 *
 * Het camerportaal had precies één gebruikersnaam en één wachtwoord. Dat
 * moest dus rondgaan -- per app, per telefoon, per nieuwe collega -- en wie
 * het had, zag elke camera van elke vestiging. Het veranderen zette iedereen
 * tegelijk buiten.
 *
 * Nu vraag je hier een toegangsbriefje, en dat briefje zegt wie je bent en
 * bij welke installaties je mag. De serverfunctie `camportal` tekent het; het
 * portaal rekent het na. Zie supabase/functions/camportal/index.ts voor
 * waarom dat een briefje is en geen gedeelde database.
 *
 * Waarom hier zo weinig staat
 * ---------------------------
 *
 * Alles wat ertoe doet -- mag deze persoon kijken, en waar -- wordt op de
 * server beantwoord. Zou de app die lijst meesturen, dan bepaalt de app waar
 * hij bij mag, en dat is geen afscherming maar een verzoek.
 */

import { supabase, supabaseConfigured } from './api/supabaseApi'

export interface Cameratoegang {
  ok: boolean
  /** Waar je heen moet. Zestig seconden geldig, en één keer bruikbaar. */
  url?: string
  /** De vestigingen die je daar te zien krijgt; om te tonen vóór je wegklikt. */
  vestigingen?: string[]
  alles?: boolean
  reden?: string
}

export async function vraagCameratoegang(): Promise<Cameratoegang> {
  if (!supabaseConfigured) {
    return { ok: false, reden: 'Er is nog geen database ingesteld.' }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, reden: 'Hiervoor is verbinding nodig.' }
  }

  try {
    const { data, error } = await supabase().functions.invoke<{
      ok?: boolean
      url?: string
      vestigingen?: string[]
      alles?: boolean
      fout?: string
    }>('camportal', { body: {} })

    if (error) {
      /*
       * De functie zegt met een 403 of 409 precies wat eraan schort -- geen
       * recht, of nog geen installatie gekoppeld. Die tekst zit in het lijf
       * van het antwoord en niet in error.message, en zonder dit staat er
       * "Edge Function returned a non-2xx status code" op het scherm.
       */
      const uitLijf = await leesFout(error)
      return { ok: false, reden: uitLijf ?? String(error.message ?? error) }
    }

    if (!data?.ok || !data.url) {
      return { ok: false, reden: data?.fout ?? 'Geen antwoord van de server.' }
    }

    return {
      ok: true,
      url: data.url,
      vestigingen: data.vestigingen ?? [],
      alles: !!data.alles,
    }
  } catch (e) {
    return { ok: false, reden: e instanceof Error ? e.message : String(e) }
  }
}

async function leesFout(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown })?.context
  if (!context || typeof context !== 'object') return null
  try {
    const lijf = await (context as Response).json()
    const fout = (lijf as { fout?: unknown })?.fout
    return typeof fout === 'string' && fout ? fout : null
  } catch {
    return null
  }
}
