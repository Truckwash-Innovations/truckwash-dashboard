import { create } from 'zustand'
import type { Role } from '../lib/types'

/* ------------------------------------------------------------------ *
 *  De rondleiding opnieuw opvragen
 *
 *  Een klein winkeltje, want de knop staat in het menu rechtsboven en het
 *  scherm hangt aan de wortel van de app. Die twee kennen elkaar niet, en
 *  dat hoeven ze ook niet.
 * ------------------------------------------------------------------ */

interface RondleidingStore {
  /** Welke rondleiding er nu is opgevraagd; null is geen. */
  rol: Role | null
  start: (rol: Role) => void
  stop: () => void
  /**
   * Moet het menu openstaan voor de stap die nu aan de beurt is?
   *
   * Vierentwintig stappen wijzen naar een menu-item (doel: nav-<sleutel>).
   * Die stonden in de zijbalk, die er altijd was. Sinds die weg is en de
   * navigatie in de app-launcher zit, bestaat zo'''n item alleen in het scherm
   * zolang het menu open is -- en wijst de rondleiding anders naar niets.
   *
   * De rondleiding zet dit dus aan zodra de huidige stap een menu-item
   * aanwijst, en de Shell houdt het menu dan open. Zo laat de uitleg zien
   * waar iets NU staat, wat precies is wat een rondleiding hoort te doen.
   */
  menuNodig: boolean
  zetMenuNodig: (nodig: boolean) => void
}

export const useRondleiding = create<RondleidingStore>((set) => ({
  rol: null,
  start: (rol) => set({ rol }),
  stop: () => set({ rol: null, menuNodig: false }),
  menuNodig: false,
  zetMenuNodig: (menuNodig) => set({ menuNodig }),
}))
