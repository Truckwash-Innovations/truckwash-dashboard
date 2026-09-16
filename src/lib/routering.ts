import { supabase } from './api/supabaseApi'
import type { User } from './types'

/* ==================================================================== *
 *  Bij wie een factuur komt te liggen
 *
 *  Casper, met een schermafdruk van de suggestieroutes in Blue10: "Je moet
 *  dus ai laten kijken, en evt direct laten daarzetten naar degene die
 *  akkoord moet geven. Maar als AI hem nog niet kent ect, moet je hem onder
 *  de eerste persoon zetten, degene met managment kan het override, maar
 *  krijgt hem niet in zijn todo. Zorg dat je dit per bv kan instellen."
 *
 *  Drie lagen, van sterk naar zwak (0106):
 *
 *    adres      een mens heeft dat postvak aan iemand gegeven
 *    geheugen   deze leverancier ging in deze bv al vaker naar dezelfde
 *               persoon -- vaak genoeg om het geen toeval te noemen
 *    eerste     we kennen hem niet; dan naar de eerste persoon van die bv
 *
 *  En 'handmatig' erboven: wat een mens op de bon zelf heeft gezet, blijft
 *  staan. Anders draait de eerstvolgende ronde de beslissing van het
 *  management terug, en dat merkt niemand.
 *
 *  Het rekenwerk staat in de database en niet hier. Dat is geen toeval: het
 *  gebeurt ook op de server, nadat de AI de factuur heeft gelezen -- want pas
 *  dan is bekend wie de leverancier is. Twee versies van dezelfde regel zou
 *  betekenen dat het scherm iets anders belooft dan er gebeurt.
 * ==================================================================== */

/** Waarom een factuur ligt waar hij ligt. */
export type RouteBron = 'adres' | 'geheugen' | 'eerste' | 'handmatig'

export const ROUTE_TEKST: Record<RouteBron, string> = {
  adres: 'via het inkoopadres',
  geheugen: 'herkend aan eerdere facturen',
  eerste: 'de eerste beoordelaar van deze bv',
  handmatig: 'met de hand toegewezen',
}

export const ROUTE_UITLEG: Record<RouteBron, string> = {
  adres:
    'Dit postvak is aan deze persoon toegewezen. Een keuze van een mens gaat '
    + 'voor op alles wat wij afleiden.',
  geheugen:
    'Deze leverancier is in deze onderneming al vaker door dezelfde persoon '
    + 'getekend. Daarom gaat hij er meteen heen.',
  eerste:
    'Deze leverancier is hier nog niet eerder getekend. Dan gaat de factuur '
    + 'naar de eerste beoordelaar van deze onderneming.',
  handmatig:
    'Iemand heeft deze factuur met de hand bij deze persoon gelegd. Die keuze '
    + 'blijft staan; de routering komt er niet meer aan.',
}

/** De route van één onderneming. */
export interface BvRoute {
  administratie: string
  bvNaam: string
  /** Wie een onbekende factuur krijgt. Leeg = de rol administratie. */
  eerste: string | null
  eersteNaam: string | null
  /** Mag het geheugen een factuur direct bij de vorige tekenaar leggen? */
  aiDirect: boolean
  /** Vanaf hoeveel keer het geheugen meetelt. */
  vanafKeren: number
  /** Hoeveel leveranciers het geheugen in deze bv kent. */
  onthouden: number
  /** Hoeveel facturen er nu op een tweede handtekening wachten. */
  wachtend: number
}

/** De routes van alle actieve ondernemingen. */
export async function bvRoutes(): Promise<BvRoute[]> {
  const { data, error } = await supabase().rpc('bv_routes')
  if (error) throw new Error(error.message)

  return (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
    administratie: String(r.administratie ?? ''),
    bvNaam: String(r.bv_naam ?? ''),
    eerste: r.eerste ? String(r.eerste) : null,
    eersteNaam: r.eerste_naam ? String(r.eerste_naam) : null,
    aiDirect: r.ai_direct !== false,
    vanafKeren: Number(r.vanaf_keren) || 3,
    onthouden: Number(r.onthouden) || 0,
    wachtend: Number(r.wachtend) || 0,
  }))
}

/** De route van één onderneming zetten. */
export async function bewaarBvRoute(input: {
  administratie: string
  eerste: string | null
  aiDirect: boolean
  vanafKeren: number
}): Promise<void> {
  const { error } = await supabase().from('bv_route').upsert({
    id: input.administratie,
    eerste: input.eerste,
    ai_direct: input.aiDirect,
    /* Onder de één zou betekenen dat één waarneming een gewoonte is. De
       database weigert het ook; hier vangen we het voordat het een rode
       melding wordt. */
    vanaf_keren: Math.max(1, Math.round(input.vanafKeren) || 3),
    updated_at: Date.now(),
  }, { onConflict: 'id' })

  if (error) throw new Error(error.message)
}

/** Eén onthouden route: deze leverancier gaat in deze bv naar deze persoon. */
export interface LeverancierRoute {
  administratie: string
  leverancier: string
  goedkeurder: string
  keren: number
  laatstAt: number
}

/** Wat het geheugen van een onderneming weet. */
export async function leverancierRoutes(bv: string): Promise<LeverancierRoute[]> {
  const { data, error } = await supabase()
    .from('leverancier_route')
    .select('administratie, leverancier, goedkeurder, keren, laatst_at')
    .eq('administratie', bv)
    .order('keren', { ascending: false })

  if (error) throw new Error(error.message)

  return (data ?? []).map((r: Record<string, unknown>) => ({
    administratie: String(r.administratie ?? ''),
    leverancier: String(r.leverancier ?? ''),
    goedkeurder: String(r.goedkeurder ?? ''),
    keren: Number(r.keren) || 0,
    laatstAt: Number(r.laatst_at) || 0,
  }))
}

/**
 * Een onthouden route vergeten.
 *
 * Nodig als iemand vertrekt of als een leverancier van afdeling wisselt: dan
 * klopt wat het geheugen weet niet meer, en er is geen reden om te wachten
 * tot het zichzelf corrigeert.
 */
export async function vergeetRoute(bv: string, leverancier: string): Promise<void> {
  const { error } = await supabase()
    .from('leverancier_route')
    .delete()
    .eq('administratie', bv)
    .eq('leverancier', leverancier)

  if (error) throw new Error(error.message)
}

/**
 * Wie er bij een bv als beoordelaar te kiezen is.
 *
 * Dezelfde regel als bij het inkoopadres, en met opzet dezelfde functie:
 * twee lijsten van "wie mag tekenen" is er één te veel.
 */
export function magBeoordelen(u: User): boolean {
  if (!u.active || u.archivedAt) return false
  if (u.isDevice) return false
  const rollen = u.roles ?? []
  return rollen.includes('management')
    || rollen.includes('administratie')
    || (u.grants ?? []).includes('expenses.approve')
}
