import { supabase, supabaseConfigured } from './api/supabaseApi'

/* ------------------------------------------------------------------ *
 *  Wat draait er op de server?
 *
 *  Casper vroeg om zes dingen te repareren; dit is de eerste. Er was geen
 *  enkele manier om te zien of het schema was bijgewerkt of de functies
 *  waren uitgerold. Bij elke storing begon het met de vraag "heb je de sql
 *  gedraaid?" en het antwoord was een herinnering.
 *
 *  Sinds 0103 houdt de server het zelf bij:
 *
 *    schema_stand    elke migratie schrijft zichzelf in bij het draaien
 *    functie_stand   elke edge function meldt zich bij zijn eerste start
 *
 *  Wat hier NIET staat is of het schema klopt. Het staat er alleen wat er is
 *  gedraaid -- wie de migraties half of door elkaar draait krijgt een nummer
 *  dat liegt. Zie de kop van 0103.
 * ------------------------------------------------------------------ */

/** Hoe ver het schema staat. */
export interface SchemaStand {
  /** Het hoogste migratienummer dat de database kent. */
  nummer: number
  /** De korte naam van die migratie. */
  naam: string
  /** Wanneer hij gedraaid is, of null als dat alleen is aangenomen. */
  at: number | null
  /** Tot hier is het echt waargenomen; daaronder is het aangenomen. */
  gezien: number
  /** Hoeveel migraties alleen zijn aangenomen (alles van vóór 0103). */
  aangenomen: number
}

/** Eén edge function, zoals hij zich gemeld heeft. */
export interface FunctieStand {
  naam: string
  versie: string
  gebouwd: string
  gezienAt: number
}

export interface ServerStand {
  schema: SchemaStand
  functies: FunctieStand[]
}

/**
 * De stand ophalen.
 *
 * Geeft null als er geen Supabase is (testmodus), en gooit als de aanroep
 * misgaat. Het scherm laat dat verschil zien: "niet ingesteld" is iets
 * anders dan "het lukte niet".
 *
 * Een database die 0103 nog niet heeft gedraaid kent server_stand() niet.
 * Dat is geen fout maar het antwoord zelf -- dan staat het schema dus vóór
 * 0103 -- en dat wordt hier vertaald naar nummer 0.
 */
export async function serverStand(): Promise<ServerStand | null> {
  if (!supabaseConfigured) return null

  const { data, error } = await supabase().rpc('server_stand')

  if (error) {
    /* 42883 = de functie bestaat niet. PGRST202 zegt hetzelfde een laag hoger. */
    if (error.code === '42883' || error.code === 'PGRST202'
        || /function .*server_stand.* does not exist/i.test(error.message ?? '')) {
      return { schema: { nummer: 0, naam: '', at: null, gezien: 0, aangenomen: 0 }, functies: [] }
    }
    throw new Error(error.message)
  }

  const r = (data ?? {}) as Record<string, unknown>
  const s = (r.schema ?? {}) as Record<string, unknown>
  const lijst = Array.isArray(r.functies) ? (r.functies as Record<string, unknown>[]) : []

  return {
    schema: {
      nummer: Number(s.nummer) || 0,
      naam: String(s.naam ?? ''),
      at: s.at == null ? null : Number(s.at),
      gezien: Number(s.gezien) || 0,
      aangenomen: Number(s.aangenomen) || 0,
    },
    functies: lijst.map((f) => ({
      naam: String(f.naam ?? ''),
      versie: String(f.versie ?? ''),
      gebouwd: String(f.gebouwd ?? ''),
      gezienAt: Number(f.gezienAt) || 0,
    })),
  }
}

/**
 * Het hoogste migratienummer dat deze app verwacht.
 *
 * Wordt door vite gevuld uit de bestandsnamen in supabase/migrations, zodat
 * het scherm "het schema loopt achter" kan zeggen in plaats van alleen een
 * nummer te tonen waar niemand iets aan afleest.
 */
export const SCHEMA_VERWACHT: number = __SCHEMA_VERWACHT__

/** Loopt de server achter op wat deze app verwacht? */
export function schemaLooptAchter(stand: ServerStand | null): boolean {
  return stand !== null && stand.schema.nummer < SCHEMA_VERWACHT
}

/**
 * Welke functies een andere versie draaien dan deze app.
 *
 * Een functie die hier niet in staat is niet per se goed: hij kan ook nog
 * nooit zijn aangeroepen sinds de uitrol. Daarom geeft het scherm er ook bij
 * hoe lang geleden elke functie zich voor het laatst heeft gemeld.
 */
export function functiesAchter(stand: ServerStand | null, appVersie: string): FunctieStand[] {
  if (!stand) return []
  return stand.functies.filter((f) => f.versie !== '' && f.versie !== appVersie)
}
