import { AlertTriangle, ChevronRight, X } from 'lucide-react'

/* ------------------------------------------------------------------ *
 *  De rij vakjes boven een factuurlijst
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
 *  Waarom deze component niets van facturen weet
 *  ---------------------------------------------
 *
 *  Hij begon als de balk boven de INKOOP, met de standen uit werklijst.ts
 *  erin verweven. Toen de verkoopkant dezelfde balk kreeg was de verleiding
 *  om hem te kopiëren -- twee bestanden die op één na hetzelfde zijn, en dan
 *  krijgt er eentje over een half jaar een verbetering die de ander mist.
 *
 *  Dus kent hij alleen nog vakjes: een naam, een getal en twee merkjes. Wat
 *  er in een vakje valt bepaalt de aanroeper (stroom.ts voor inkoop,
 *  verkoopstroom.ts voor verkoop), en dat zijn twee wezenlijk verschillende
 *  processen die hier niets van elkaar hoeven te weten.
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

export interface Vakje {
  /** Waarmee de aanroeper hem herkent als erop geklikt wordt. */
  sleutel: string
  label: string
  /** Eén zin die zegt wat hier ligt; komt in de tooltip. */
  uitleg: string
  aantal: number
  /** Hoeveel hiervan vastzitten -- het rode kruisje. Nul is geen merk. */
  stuk?: number
  /** Hoeveel hiervan te laat zijn -- het oranje uitroepteken. */
  telaat?: number
}

export default function Stroombalk({
  vakjes, gekozen, kies,
}: {
  vakjes: Vakje[]
  /** Welk vakje nu gefilterd is, of null voor alles. */
  gekozen: string | null
  kies: (sleutel: string | null) => void
}) {
  return (
    <div className="stroombalk" role="group" aria-label="De stappen van een factuur">
      {vakjes.map((v, i) => (
        <div key={v.sleutel} className="stroomdeel">
          {i > 0 && <ChevronRight size={14} className="stroompijl" aria-hidden />}
          <Vak
            vakje={v}
            actief={gekozen === v.sleutel}
            /* Nog een keer klikken zet het filter weer uit. Dat is wat je
               verwacht van iets dat als knop aanvoelt, en het scheelt zoeken
               naar een kruisje om het ongedaan te maken. */
            kies={() => kies(gekozen === v.sleutel ? null : v.sleutel)}
          />
        </div>
      ))}
    </div>
  )
}

function Vak({
  vakje, actief, kies,
}: {
  vakje: Vakje
  actief: boolean
  kies: () => void
}) {
  const { label, uitleg, aantal } = vakje
  const stuk = vakje.stuk ?? 0
  const telaat = vakje.telaat ?? 0
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
      title={`${label} -- ${uitleg}`}
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
      <span className="stroomnaam">{label}</span>
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
export function Stroomlijn({ vakjes, ga }: { vakjes: Vakje[]; ga: () => void }) {
  const totaal = vakjes.reduce((t, v) => t + v.aantal, 0)
  if (totaal === 0) return null

  return (
    <button type="button" className="stroomlijn" onClick={ga}>
      {vakjes.filter((v) => v.aantal > 0).map((v) => (
        <span key={v.sleutel} className="stroomlijn-deel">
          <strong>{v.aantal}</strong> {v.label.toLowerCase()}
        </span>
      ))}
      <ChevronRight size={14} aria-hidden />
    </button>
  )
}
