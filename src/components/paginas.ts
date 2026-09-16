import type { LucideIcon } from 'lucide-react'

import type { NavItem } from './Shell'
import type { Permission } from '../lib/types'

/* ------------------------------------------------------------------ *
 *  Eén lijst per dashboard, in plaats van drie die het eens moeten zijn
 *
 *  Casper: "fix het allemaal" -- de vierde van zes.
 *
 *  Elk dashboard hield drie dingen bij over dezelfde schermen:
 *
 *    items         wat er in het menu staat: sleutel, label, icoon, teller
 *    TITLES        de kop boven het scherm: titel en ondertitel
 *    useNavTarget  welke pagina's van buitenaf geopend mogen worden
 *
 *  Drie lijsten die het met elkaar eens moeten zijn, negen keer. Het kantoor
 *  toevoegen kostte eenentwintig bewerkingen, en dat is niet alleen werk --
 *  het is werk waarvan je de helft kunt vergeten zonder dat iets het zegt.
 *
 *  Dat is ook precies wat er gebeurde. Twee keer:
 *
 *    - werk, werving en documenten stonden niet in de useNavTarget-lijst van
 *      Ontwikkeling. De knop in de takenmail (?open=werk) deed daardoor
 *      niets, en het doel bleef in useNav staan -- zodat je er later
 *      onaangekondigd op landde zodra je naar een ander dashboard wisselde.
 *    - en met het kantoor ging het opnieuw mis, in hetzelfde bestand.
 *
 *  Nu is er één lijst en worden de drie eruit afgeleid.
 *
 *  Wat hier NIET gebeurt
 *  ---------------------
 *
 *  De teksten worden niet uit lib/schermen.ts gehaald. Dat was het plan, tot
 *  het naast elkaar lag: van de vijfenzestig koppen zijn er maar twintig
 *  gelijk aan wat daar staat. "Uren / Registraties van het team" bij de
 *  leidinggevende tegenover "Mijn uren / Tijdregistratie" bij de werknemer --
 *  dat is geen dubbele tekst maar dezelfde pagina die per rol iets anders
 *  betekent. Die tweeënveertig verschillen samenvoegen zou de schermen
 *  armer maken, niet opgeruimder.
 *
 *  SCHERMEN blijft waarvoor het is: de kaart voor het zoeken en voor de vraag
 *  welk dashboard een pagina kent.
 * ------------------------------------------------------------------ */

export interface Pagina {
  /** De paginasleutel, zoals in de render-switch en in ?open=. */
  key: string
  /** Wat er in het menu staat. */
  label: string
  icon: LucideIcon
  /**
   * De ondertitel in de kop van het scherm.
   *
   * Mag ontbreken: bij de klant staat er de bedrijfsnaam, en die hoort niet
   * bij een pagina maar bij wie er kijkt.
   */
  sub?: string
  /** De titel in de kop, als die afwijkt van het menu-label. */
  titel?: string
  /** Een teller achter het menu-item. Nul telt als geen. */
  badge?: number
  /** Alleen in het menu als dit recht er is. */
  recht?: Permission
  /** Of een eigen voorwaarde, voor wat geen recht is maar wel een keuze. */
  als?: boolean
  /** Een tweede niveau; de administratie gebruikt dat. */
  kinderen?: Pagina[]
}

/** Mag deze pagina in het menu? */
function mag(p: Pagina, kan: (recht: Permission) => boolean): boolean {
  if (p.als === false) return false
  if (p.recht && !kan(p.recht)) return false
  return true
}

/**
 * Het menu.
 *
 * Wat er niet in mag valt eruit, met kinderen en al -- een groep zonder
 * inhoud is een kop waar je op klikt en niets gebeurt.
 */
export function menuVan(
  paginas: Pagina[],
  kan: (recht: Permission) => boolean,
): NavItem[] {
  const uit: NavItem[] = []

  for (const p of paginas) {
    if (!mag(p, kan)) continue

    const kinderen = p.kinderen?.filter((k) => mag(k, kan))
    if (p.kinderen && (!kinderen || kinderen.length === 0)) continue

    uit.push({
      key: p.key,
      label: p.label,
      icon: p.icon,
      badge: p.badge || undefined,
      ...(kinderen ? {
        kinderen: kinderen.map((k) => ({
          key: k.key, label: k.label, icon: k.icon, badge: k.badge || undefined,
        })),
      } : {}),
    })
  }

  return uit
}

/** Alle pagina's, ook die in een tweede niveau staan. */
function alle(paginas: Pagina[]): Pagina[] {
  return paginas.flatMap((p) => [p, ...(p.kinderen ?? [])])
}

/**
 * De kop boven het scherm.
 *
 * De titel is het menu-label, tenzij er iets anders bij staat. Dat scheelt
 * niet alleen tikwerk: bij een label dat verandert en een titel die blijft
 * staan, is het de titel die je pas weken later opmerkt.
 */
export function kopVan(
  paginas: Pagina[],
  page: string,
  terugval: string,
): { title: string; subtitle: string } {
  const lijst = alle(paginas)
  const p = lijst.find((x) => x.key === page)
    ?? lijst.find((x) => x.key === terugval)
    ?? lijst[0]

  if (!p) return { title: '', subtitle: '' }
  return { title: p.titel ?? p.label, subtitle: p.sub ?? '' }
}

/**
 * Welke pagina's dit dashboard van buitenaf mag openen.
 *
 * Dezelfde regel als voor het menu: wat je niet mag zien, kun je ook niet
 * geopend krijgen. Dat was niet overal zo -- het ene dashboard gaf een vaste
 * lijst mee, het andere de gefilterde menu-items -- en twee regels voor
 * dezelfde vraag betekent dat er ergens een deur openstaat die elders dicht
 * zit.
 *
 * De strengste is de juiste: de render-switch van een dashboard controleert
 * geen rechten, dus een pagina die je via ?open= kunt bereiken maar niet in
 * je menu staat, is een scherm dat je niet hoort te zien.
 */
export function sleutelsVan(
  paginas: Pagina[],
  kan: (recht: Permission) => boolean,
): string[] {
  return alle(paginas).filter((p) => mag(p, kan)).map((p) => p.key)
}
