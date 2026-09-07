import { useEffect } from 'react'
import { create } from 'zustand'
import { useMemo } from 'react'
import { useAuth } from './useAuth'
import { effectivePermissions } from '../lib/permissions'
import { DASHBOARDS_MET } from '../lib/schermen'
import type { Permission, Role } from '../lib/types'

/* ------------------------------------------------------------------ *
 *  Navigatie tussen schermen
 *
 *  De zoekbalk en de meldingen moeten naar een pagina kunnen springen die
 *  ergens anders in de app staat. Dat loopt via dit kleine winkeltje: wie
 *  wil navigeren zet een doel, en het dashboard dat die pagina kent pakt hem op.
 * ------------------------------------------------------------------ */

interface NavStore {
  target: { page: string; query?: string; id?: string } | null
  goto: (page: string, extra?: { query?: string; id?: string }) => void
  consume: () => void

  /** Vraagt het zoekpaneel te openen, eventueel meteen luisterend. */
  searchRequest: { voice: boolean; nonce: number } | null
  openSearch: (voice?: boolean) => void
  clearSearchRequest: () => void

  /* Hetzelfde voor de bel. Die is geen pagina maar een paneel met een eigen
     open-vlaggetje in NotificationCenter, en daar kun je van buitenaf niet bij.
     Een link uit een mail moet hem wél kunnen openen: "er staat een bericht
     voor je klaar" hoort uit te komen bij dat bericht. */
  meldingenRequest: number | null
  openMeldingen: () => void
  clearMeldingenRequest: () => void
}

let nonce = 0

export const useNav = create<NavStore>((set) => ({
  target: null,
  goto: (page, extra) => set({ target: { page, ...extra } }),
  consume: () => set({ target: null }),

  searchRequest: null,
  openSearch: (voice = false) => set({ searchRequest: { voice, nonce: ++nonce } }),
  clearSearchRequest: () => set({ searchRequest: null }),

  meldingenRequest: null,
  openMeldingen: () => set({ meldingenRequest: ++nonce }),
  clearMeldingenRequest: () => set({ meldingenRequest: null }),
}))

/**
 * Laat een dashboard reageren op een navigatieverzoek voor zijn eigen pagina's.
 */
export function useNavTarget(pages: string[], onGo: (page: string, id?: string) => void) {
  const target = useNav((s) => s.target)
  const consume = useNav((s) => s.consume)

  useEffect(() => {
    if (!target) return
    if (!pages.includes(target.page)) return
    onGo(target.page, target.id)
    consume()
    // onGo verandert elke render; alleen op het doel reageren is hier juist
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
}

/* ------------------------------------------------------------------ *
 *  Binnenkomen op een scherm, vanuit een link
 *
 *  Een mail zegt "er staat een bericht voor je klaar" met een knop erbij. Die
 *  knop bracht je tot voor kort op de releasepagina van GitHub; daarna op de
 *  startpagina van de app, waarna je zelf mocht zoeken wat er ook alweer
 *  klaarstond. Nu staat er ?open=postbus achter, en komt die pagina meteen.
 *
 *  Waarom niet gewoon overnemen wat er in het adres staat
 *  -----------------------------------------------------
 *
 *  Omdat een adres uit een mail komt, en een mail kan van iedereen zijn. Een
 *  waarde die ongezien in de navigatie belandt is een manier om iemand een
 *  scherm in te duwen dat hij niet had gekozen. Vandaar dat de naam wordt
 *  nagekeken tegen DASHBOARDS_MET -- de lijst die de zelftest compleet houdt.
 *  Staat hij daar niet in, dan gebeurt er niets en blijf je gewoon op start.
 *
 *  Rechten worden hier niet nagekeken, en dat hoeft ook niet: een pagina
 *  bestaat pas als het dashboard dat haar kent gemount is, en dat dashboard
 *  bouwt zijn eigen lijst op uit de rechten van deze gebruiker. Een naam die
 *  niet bij je past komt dus nergens aan.
 *
 *  Het adres wordt daarna schoongeveegd. Zonder dat opent een verversing --
 *  of een terugknop uren later -- diezelfde pagina opnieuw, en dan lijkt het
 *  alsof de app niet luistert.
 * ------------------------------------------------------------------ */

export function useDiepeLink() {
  const user = useAuth((s) => s.user)
  const role = useAuth((s) => s.role)
  const chooseRole = useAuth((s) => s.chooseRole)
  const goto = useNav((s) => s.goto)
  const openMeldingen = useNav((s) => s.openMeldingen)

  useEffect(() => {
    /* Pas als er iemand binnen is. Vóór het inloggen zou het doel verloren
       gaan op het inlogscherm, en juist wie een mail krijgt moet meestal nog
       inloggen. */
    if (!user) return

    let url: URL
    try {
      url = new URL(window.location.href)
    } catch {
      return
    }
    const scherm = url.searchParams.get('open')
    if (!scherm) return

    /* Weghalen vóór het navigeren: gaat er hieronder iets mis, dan blijft er
       geen adres achter dat het bij elke verversing opnieuw probeert. */
    url.searchParams.delete('open')
    const id = url.searchParams.get('id')
    url.searchParams.delete('id')
    window.history.replaceState({}, '', url.toString())

    /* "meldingen" is geen pagina maar de bel in de balk. Elke rol heeft hem,
       dus er valt ook geen dashboard bij te kiezen. */
    if (scherm === 'meldingen') { openMeldingen(); return }

    const rollen = DASHBOARDS_MET[scherm]
    if (!rollen) return

    /* Heb je meer dan één rol, dan sta je nu op het keuzescherm en zou het
       doel daar blijven liggen tot je zelf het goede dashboard aanklikt. Kent
       precies één van jouw rollen deze pagina, dan is die keuze niet echt een
       keuze -- dus maken we hem. Kennen er meer hem, dan kiezen we niet: dan
       is het wél een keuze, en die is aan jou. */
    if (!role && user.roles) {
      const passend = user.roles.filter((r: Role) => rollen.includes(r))
      if (passend.length === 1) chooseRole(passend[0])
    }

    goto(scherm, id ? { id } : undefined)
    // Eén keer, zodra er iemand is ingelogd.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])
}

/* ------------------------------------------------------------------ *
 *  Rechten in de UI
 * ------------------------------------------------------------------ */

export function usePerms() {
  const user = useAuth((s) => s.user)
  return useMemo(() => {
    const set = effectivePermissions(user)
    return {
      set,
      can: (p: Permission) => set.has(p),
      canAny: (...ps: Permission[]) => ps.some((p) => set.has(p)),
      canAll: (...ps: Permission[]) => ps.every((p) => set.has(p)),
    }
  }, [user])
}
