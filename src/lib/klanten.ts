import { db, uid } from './db'
import { enqueue } from './sync'
import { supabase, supabaseConfigured } from './api/supabaseApi'
import type { Company } from './types'

/* ------------------------------------------------------------------ *
 *  Klanten
 *
 *  Casper: "Daarnaast moet je alle klanten, gebruikers ect kunnen beheren bij
 *  managment, kunnen aanmaken".
 *
 *  Waarom hij het niet kon vinden
 *  ------------------------------
 *
 *  Drie dingen heten "Klant" in dit systeem:
 *
 *    Company    het factuuradres -- deze tabel
 *    Werkgever  het transportbedrijf waarvan de chauffeurs komen wassen
 *    de rol customer  het inlogaccount dat aan een Company hangt
 *
 *  Het menu-item "Klanten" opent het werkgeversscherm. Voor Company bestond
 *  geen scherm en ook geen repo: in de hele app stond geen enkele
 *  schrijfactie op db.companies -- alleen lezen. De synchronisatie was er wel
 *  al, op alle zes de plekken. Er ontbrak dus een scherm, geen leidingwerk.
 *
 *  Over verwijderen
 *  ----------------
 *
 *  Dat is het gevaarlijkste stuk, want er zijn drie manieren waarop het
 *  stilletjes misgaat -- zie 0075. Vandaar dat dit bestand het niet zelf
 *  bedenkt maar de database vraagt: klant_verwijderen_belet() geeft de reden
 *  terug waarom het niet mag, of niets als het wel mag. Diezelfde functie zit
 *  als slot op de tabel, dus het scherm en de database zeggen per definitie
 *  hetzelfde.
 * ------------------------------------------------------------------ */

export const klanten = {
  async maak(input: {
    name: string
    contact?: string
    email?: string
    phone?: string
    city?: string
    contractDiscountPct?: number
  }): Promise<Company> {
    const rij: Company = {
      id: uid('co'),
      name: input.name.trim(),
      contact: (input.contact ?? '').trim(),
      email: (input.email ?? '').trim(),
      phone: (input.phone ?? '').trim(),
      city: (input.city ?? '').trim(),
      contractDiscountPct: input.contractDiscountPct ?? 0,
      updatedAt: Date.now(),
    }
    await db.companies.put(rij)
    await enqueue('companies', 'put', rij.id, rij)
    return rij
  },

  async wijzig(id: string, patch: Partial<Omit<Company, 'id'>>): Promise<Company | null> {
    const bestaand = await db.companies.get(id)
    if (!bestaand) return null
    const rij: Company = { ...bestaand, ...patch, id, updatedAt: Date.now() }
    await db.companies.put(rij)
    await enqueue('companies', 'put', rij.id, rij)
    return rij
  },

  /**
   * Wat het verwijderen tegenhoudt, of niets.
   *
   * De vraag gaat naar de database en wordt hier niet nagebouwd. Twee plekken
   * die allebei "mag deze klant weg" beantwoorden, gaan uit elkaar lopen --
   * en dan zegt het scherm ja terwijl de database nee zegt, of andersom.
   *
   * Zonder verbinding komt er null uit: dan weten we het niet, en dan hoort
   * het scherm te zeggen dat je hiervoor online moet zijn in plaats van te
   * doen alsof het mag.
   */
  async verwijderenBelet(id: string): Promise<{ reden: string | null } | null> {
    if (!supabaseConfigured) return null
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null
    try {
      const { data, error } = await supabase()
        .rpc('klant_verwijderen_belet', { klant_in: id })
      if (error) return null
      return { reden: (data as string | null) ?? null }
    } catch {
      return null
    }
  },

  /**
   * Weggooien.
   *
   * Eerst plaatselijk, dan de wachtrij -- zoals alles hier. Het slot zit in de
   * database (0075), dus lukt het daar niet, dan blijft de regel in de
   * wachtrij staan met de reden erbij. Daarom vraagt het scherm het van
   * tevoren: een verwijdering die pas een minuut later blijkt te zijn
   * geweigerd, is een verwijdering waarvan je denkt dat hij is gelukt.
   */
  async verwijder(id: string): Promise<void> {
    await db.companies.delete(id)
    await enqueue('companies', 'delete', id, null)
  },
}

/**
 * Past deze klant bij wat er is getypt?
 *
 * Eén veld, want zo zoeken mensen: ze typen wat ze weten. Een naam, een
 * plaats, een mailadres.
 */
export function pastBijZoek(c: Company, zoek: string): boolean {
  const q = zoek.trim().toLowerCase()
  if (!q) return true
  return [c.name, c.contact, c.email, c.phone, c.city]
    .some((v) => (v ?? '').toLowerCase().includes(q))
}
