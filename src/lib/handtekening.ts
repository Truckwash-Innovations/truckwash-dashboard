/* ------------------------------------------------------------------ *
 *  De handtekening onder een mail
 *
 *  Casper: "kan je ervoor zorgen dat je automatisch een handtekening maakt?
 *  (...) En dan extra dingen, zorg dat het als tekst er komt te staan zodat
 *  je het zelf kan aanpassen."
 *
 *  Dat laatste is de hele opzet van dit bestand, en het is een keuze die je
 *  maar één keer goed kunt maken.
 *
 *  Waarom het TEKST wordt en geen sjabloon
 *  ---------------------------------------
 *
 *  De verleiding is om de handtekening te laten uitrekenen op het moment van
 *  versturen: naam uit het dossier, functie uit het dossier, vestiging erbij.
 *  Dan staat er altijd het laatste nieuws in en hoeft niemand iets bij te
 *  houden.
 *
 *  En dan kun je hem niet meer aanpassen. Iemand die er zijn doorkiesnummer
 *  bij wil, of "p/a Rotterdam" omdat hij daar vier dagen staat, of gewoon
 *  "Groet, Jan" omdat het een collega is -- die kan niets. Een sjabloon dat
 *  je niet mag wijzigen is een sjabloon waar mensen omheen gaan werken: dan
 *  typen ze hun eigen afsluiting bóven de handtekening en staat er twee keer
 *  een groet onder elke mail.
 *
 *  Dus: dit bestand maakt één keer een VOORSTEL, dat voorstel wordt als
 *  gewone tekst in het dossier gezet, en daarna is het van die persoon. Wat
 *  hij erin zet blijft staan, ook als zijn functie in het dossier verandert.
 *  Dat is het kleine nadeel, en het is het waard.
 *
 *  Waar hij eronder wordt geplakt
 *  ------------------------------
 *
 *  Niet hier en niet in de app, maar in de serverfunctie werkmail -- met een
 *  regel "--" ertussen, zoals mailprogramma's dat al veertig jaar doen. Zou
 *  de app hem eronder zetten, dan staat hij in het tekstvak en kan iemand hem
 *  per ongeluk half weggummen; en bij een antwoord vanaf een ander toestel
 *  zou hij ontbreken.
 * ------------------------------------------------------------------ */

import { BEDRIJF } from './types'
import type { User } from './types'

/**
 * Voornaam en achternaam, netjes achter elkaar.
 *
 * Het dossier heeft één naamveld. Hier wordt hij alleen opgeschoond --
 * dubbele spaties eruit -- en niet opgesplitst: "Jan van Dijk" hoort er
 * onder een mail precies zo te staan, en elke poging om daar een voor- en
 * achternaam uit te halen gaat bij een tussenvoegsel de mist in.
 */
function volledigeNaam(naam: string): string {
  return naam.replace(/\s+/g, ' ').trim()
}

/**
 * De regel met de functie en de vestiging.
 *
 * Ontbreekt er een van de twee, dan verdwijnt ook het scheidingsteken. Een
 * handtekening met " · " en niets erachter is precies het soort slordigheid
 * waar een klant naar kijkt.
 */
function functieRegel(functie?: string, vestiging?: string): string {
  return [functie?.trim(), vestiging?.trim()].filter(Boolean).join(' · ')
}

export interface HandtekeningInvoer {
  naam: string
  /** De functie uit het dossier, bijvoorbeeld "Vestigingsmanager". */
  functie?: string
  /** De naam van de vestiging waar hij werkt. */
  vestiging?: string
  werkEmail?: string
  telefoon?: string
}

/**
 * Een handtekening om mee te beginnen.
 *
 * Wat er niet bekend is, valt weg -- inclusief de lege regel die erbij
 * hoorde. Er komt dus nooit een gat in te staan omdat iemands
 * telefoonnummer niet in het dossier staat.
 */
export function standaardHandtekening(wie: HandtekeningInvoer): string {
  const naam = volledigeNaam(wie.naam)
  const functie = functieRegel(wie.functie, wie.vestiging)

  const blok = [naam, functie, BEDRIJF].filter(Boolean)
  const bereikbaar = [wie.werkEmail?.trim(), wie.telefoon?.trim()].filter(Boolean)

  return [
    'Met vriendelijke groet,',
    '',
    ...blok,
    ...(bereikbaar.length ? ['', ...bereikbaar] : []),
  ].join('\n')
}

/** Dezelfde tekst, maar dan uit een dossier. */
export function handtekeningVoor(gebruiker: User, vestiging?: string): string {
  return standaardHandtekening({
    naam: gebruiker.name,
    functie: gebruiker.function,
    vestiging,
    werkEmail: gebruiker.werkEmail,
    telefoon: gebruiker.phone,
  })
}
