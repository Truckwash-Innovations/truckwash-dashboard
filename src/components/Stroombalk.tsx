import { AlertTriangle, ChevronRight, X } from 'lucide-react'
import { STAPPEN, type Stapstand, type StapSleutel } from '../lib/stroom'

/* ------------------------------------------------------------------ *
 *  De rij vakjes boven de factuurlijst
 *
 *  Casper stuurde foto's van Blue10 mee: "je moet echt blue10 een beetje
 *  namaken met dat stuk". Dit is dat stuk.
 *
 *  Wat het doet is twee dingen tegelijk, en dat is de hele winst: elk vakje
 *  is een TELLER en een FILTER. Je ziet waar de stapel ligt en je klikt erop
 *  om hem te openen. Tot nu toe stonden diezelfde standen als losse vakken
 *  onder elkaar in 'Te verwerken' -- je moest scrollen om te weten hoeveel
 *  werk er was, en filteren deed je ergens anders.
 *
 *  Drie keuzes die niet vanzelf spreken
 *  ------------------------------------
 *
 *  1. Lege vakjes blijven staan. Een vakje dat verdwijnt omdat er niets in
 *     zit, verschuift alle andere -- en dan staat "Goedkeuren" de ene dag op
 *     plek drie en de volgende op plek twee. Je leert zo'n rij niet lezen.
 *
 *  2. Geen geel. Dat is hier voorbehouden aan het logo en aan de ene
 *     hoofdactie per scherm; een rij van zes gele vakken maakt dat betekenis-
 *     loos. Het gekozen vakje is donker, de rest is rustig.
 *
 *  3. Het kruisje en het uitroepteken staan er alleen als ze iets betekenen.
 *     Blue10 zet ze op bijna elk vakje, en daar zijn ze al een deel van het
 *     meubilair. Hier is een rood kruisje een echte stapel vastgelopen
 *     facturen, en anders staat hij er niet.
 * ------------------------------------------------------------------ */

export default function Stroombalk({
  stroom, gekozen, kies,
}: {
  stroom: Stapstand[]
  /** Welke stap nu gefilterd is, of null voor alles. */
  gekozen: StapSleutel | null
  kies: (sleutel: StapSleutel | null) => void
}) {
  return (
    <div className="stroombalk" role="group" aria-label="De stappen van een factuur">
      {stroom.map((s, i) => (
        <div key={s.stap.sleutel} className="stroomdeel">
          {i > 0 && <ChevronRight size={14} className="stroompijl" aria-hidden />}
          <Vakje
            stand={s}
            actief={gekozen === s.stap.sleutel}
            /* Nog een keer klikken zet het filter weer uit. Dat is wat je
               verwacht van iets dat als knop aanvoelt, en het scheelt zoeken
               naar een kruisje om het ongedaan te maken. */
            kies={() => kies(gekozen === s.stap.sleutel ? null : s.stap.sleutel)}
          />
        </div>
      ))}
    </div>
  )
}

function Vakje({
  stand, actief, kies,
}: {
  stand: Stapstand
  actief: boolean
  kies: () => void
}) {
  const { stap, aantal, stuk, telaat } = stand
  const leeg = aantal === 0

  /*
   * Wat er in het label staat is de stap, wat eronder staat is de uitleg --
   * en die gaat ook in het title-attribuut, want op een smal scherm valt de
   * uitleg weg en dan is "Aanvullen" alleen een woord.
   */
  return (
    <button
      type="button"
      onClick={kies}
      className={['stroomvak', actief ? 'aan' : '', leeg ? 'leeg' : ''].filter(Boolean).join(' ')}
      aria-pressed={actief}
      title={`${stap.label} -- ${stap.uitleg}`}
    >
      {stuk > 0 && (
        <span className="stroommerk stuk" title={`${stuk} vastgelopen of geweigerd`}>
          <X size={11} strokeWidth={3} aria-hidden />
          <span className="sr-only">{stuk} vastgelopen</span>
        </span>
      )}
      {stuk === 0 && telaat > 0 && (
        <span className="stroommerk laat" title={`${telaat} over de vervaldatum`}>
          <AlertTriangle size={11} strokeWidth={3} aria-hidden />
          <span className="sr-only">{telaat} over de vervaldatum</span>
        </span>
      )}
      <span className="stroomcijfer">{aantal}</span>
      <span className="stroomnaam">{stap.label}</span>
    </button>
  )
}

/**
 * Dezelfde rij, maar alleen de getallen -- voor een startscherm waar hij
 * naast ander werk staat en niet de baas mag zijn.
 *
 * Losse component en geen vlaggetje op de bovenstaande: een knop die soms
 * geen knop is, is een knop waarvan niemand weet of hij ergens heen gaat.
 */
export function Stroomlijn({ stroom, ga }: { stroom: Stapstand[]; ga: () => void }) {
  const totaal = stroom.reduce((t, s) => t + s.aantal, 0)
  if (totaal === 0) return null

  return (
    <button type="button" className="stroomlijn" onClick={ga}>
      {stroom.filter((s) => s.aantal > 0).map((s) => (
        <span key={s.stap.sleutel} className="stroomlijn-deel">
          <strong>{s.aantal}</strong> {s.stap.label.toLowerCase()}
        </span>
      ))}
      <ChevronRight size={14} aria-hidden />
    </button>
  )
}

/** De stappen, voor een keuzelijst die dezelfde woorden moet gebruiken. */
export const STROOM_KEUZES = STAPPEN.map((s) => ({ waarde: s.sleutel, label: s.label }))
