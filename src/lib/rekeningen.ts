/* ==================================================================== *
 *  De rekeningen van één bv, opgehaald in plaats van overgenomen
 *
 *  Casper: "maar kan je niet zorgen dat je die grootboekrekeningen bij het
 *  zoeken dynamisch ophaalt?"
 *
 *  Ja, en dat is niet alleen makkelijker -- het is ook juister. Er staan
 *  twee rekeningschema's in dit systeem en ze doen niet hetzelfde:
 *
 *    exact_grootboek   wat Exact kent, per administratie. Een kopie, bij te
 *                      werken met "sync-grootboek".
 *    public.grootboek  onze eigen korte lijst met eigen namen en de
 *                      trefwoorden waarop factuur_indelen() raadt.
 *
 *  En de boeking hangt aan de EERSTE. exact_facturen_wachtend() zoekt de
 *  guid van de rekening op in exact_grootboek op (code, division); wat er in
 *  public.grootboek staat komt daar niet aan te pas. Een rekening die Exact
 *  in die bv kent is dus boekbaar, of wij hem nu hebben overgenomen of niet.
 *
 *  Daarmee was "eerst het schema per bv overnemen" een tussenstap die alleen
 *  wij nodig hadden. De lijst waar je uit kiest hoort te zijn wat Exact in
 *  die administratie heeft -- niet wat wij er toevallig van hebben gekopieerd.
 *
 *  Wat overnemen nog wél doet: het geeft een rekening een eigen naam en
 *  trefwoorden, en daarop raadt de post de indeling van een nieuwe factuur.
 *  Dat is een aparte waarde en die blijft.
 *
 *  Waarom in één keer per bv en niet per toetsaanslag
 *  --------------------------------------------------
 *
 *  Een schema is een paar honderd regels en verandert niet tijdens het typen.
 *  Bij het openen één keer ophalen en daarna lokaal filteren geeft antwoord
 *  terwijl je typt; een vraag per aanslag geeft een lijst die achter je
 *  vingers aan hobbelt, en dan typ je over een resultaat heen dat er nog niet
 *  was.
 * ==================================================================== */

import { useEffect, useMemo, useState } from 'react'

import { exactGrootboekStand } from './trucksupply'
import { rekeningenVoor } from './boeking'
import type { KiezerOptie } from '../components/ui'
import type { Grootboek } from './types'

/** Eén rekening zoals de keuzelijst hem nodig heeft. */
interface Regel {
  code: string
  /** Onze naam als we die hebben, anders die van Exact. */
  naam: string
  sub?: string
  zoekwoorden?: string
  geblokkeerd: boolean
}

/*
 * Het geheugen, per bv en per sessie.
 *
 * Een Map buiten de component, want twee keuzelijsten op hetzelfde scherm --
 * de rekening van de bon en die van elke regel van de verdeling -- horen niet
 * allebei hun eigen ronde te doen. In vlucht staat er een belofte in, zodat
 * ze op dezelfde wachten in plaats van er twee te sturen.
 */
const geheugen = new Map<string, Regel[]>()
const onderweg = new Map<string, Promise<Regel[]>>()

/** Na het overnemen van een schema klopt het geheugen niet meer. */
export function vergeetRekeningen(): void {
  geheugen.clear()
  onderweg.clear()
}

async function haal(bv: string): Promise<Regel[]> {
  const klaar = geheugen.get(bv)
  if (klaar) return klaar

  const bezig = onderweg.get(bv)
  if (bezig) return bezig

  const belofte = (async () => {
    const stand = await exactGrootboekStand(bv)

    /*
     * Onze eigen regels eerst -- die dragen de naam die iemand hier heeft
     * bedacht ("Inkoop wasmiddelen en chemie" in plaats van "Kosten grond- en
     * hulpstoffen"). Daarna wat Exact verder nog kent.
     */
    const uit: Regel[] = [
      ...stand.regels
        .filter((r) => r.actief)
        .map((r) => ({
          code: r.code,
          naam: r.naam,
          /* De naam van Exact eronder als hij afwijkt: dan zie je waar je in
             Exact naar kijkt zonder onze naam kwijt te raken. */
          sub: r.exactNaam && r.exactNaam !== r.naam ? r.exactNaam : (r.categorie ?? undefined),
          geblokkeerd: r.geblokkeerd,
        })),
      ...stand.nogNiet.map((r) => ({
        code: r.code,
        naam: r.omschrijving || r.code,
        sub: r.soort ?? undefined,
        geblokkeerd: r.geblokkeerd,
      })),
    ]

    uit.sort((a, b) => a.code.localeCompare(b.code))
    geheugen.set(bv, uit)
    onderweg.delete(bv)
    return uit
  })()

  onderweg.set(bv, belofte)
  /* Mislukt hij, dan niets onthouden: de volgende poging hoort het opnieuw
     te proberen en niet op een lege lijst te blijven staan. */
  belofte.catch(() => { onderweg.delete(bv) })
  return belofte
}

/**
 * De rekeningen die bij deze bon te kiezen zijn.
 *
 * Geeft altijd meteen iets terug: wat er lokaal staat. Zodra het schema van
 * die bv binnen is, wordt dat de lijst. Lukt dat niet -- geen verbinding --
 * dan blijft de lokale lijst staan, en dat is precies wat er vóór deze
 * wijziging gebeurde. Een factuur indelen zonder internet blijft dus kunnen.
 */
export function useRekeningen(
  bv: string | undefined,
  lokaal: Grootboek[],
  huidige?: string,
): { opties: KiezerOptie[]; laden: boolean } {
  const [uitExact, setUitExact] = useState<Regel[] | null>(null)
  const [laden, setLaden] = useState(false)

  useEffect(() => {
    if (!bv) { setUitExact(null); return }

    let weg = false
    setUitExact(geheugen.get(bv) ?? null)
    if (geheugen.has(bv)) return

    setLaden(true)
    haal(bv)
      .then((r) => { if (!weg) setUitExact(r) })
      /* Stil: dit is een aanvulling op een lijst die er al staat, geen
         handeling die iemand heeft gevraagd. Een rode melding voor iets wat
         vanzelf goed komt zodra de verbinding er is, leert mensen meldingen
         wegklikken. */
      .catch(() => {})
      .finally(() => { if (!weg) setLaden(false) })

    return () => { weg = true }
  }, [bv])

  return useMemo(() => {
    if (!uitExact) {
      return {
        opties: rekeningenVoor(lokaal, bv, huidige).map((g) => ({
          waarde: g.code,
          label: `${g.code} · ${g.naam}`,
          sub: g.categorie ?? undefined,
          zoekwoorden: (g.trefwoorden ?? []).join(' '),
        })),
        laden,
      }
    }

    /* De trefwoorden komen van onze eigen lijst; daar staan ze in. */
    const woorden = new Map(lokaal.map((g) => [g.code, (g.trefwoorden ?? []).join(' ')]))

    return {
      opties: uitExact
        /*
         * Een in Exact geblokkeerde rekening is niet te boeken. Hem toch
         * aanbieden is een keuze die pas bij het versturen wordt geweigerd --
         * behalve als hij er nu op staat, want dan hoort te blijven staan
         * wat er staat.
         */
        .filter((r) => !r.geblokkeerd || r.code === huidige)
        .map((r) => ({
          waarde: r.code,
          label: `${r.code} · ${r.naam}`,
          sub: r.sub,
          zoekwoorden: woorden.get(r.code) ?? '',
        })),
      laden,
    }
  }, [uitExact, lokaal, bv, huidige, laden])
}
