import {
  type ReactNode, useEffect, useRef,
} from 'react'
import { ChevronRight, Loader2, Search, X } from 'lucide-react'

/* ==================================================================
   De onderdelen waar elke pagina uit bestaat
   ==================================================================

   Casper: "Elke pagina moet zoveel mogelijk dezelfde structuur hebben:
   Topbar -> Page header -> Filters/tabs -> Content. De gebruiker moet
   hierdoor snel leren hoe de applicatie werkt."

   Dat laatste is het hele punt. Wie honderd keer per dag hetzelfde scherm
   opent, hoeft dan niet te kijken waar de knop staat -- die staat waar hij
   altijd staat. Zolang elk scherm zijn eigen kop bouwt, is dat een belofte
   die je niet kunt houden.
   ================================================================== */

/* ------------------------------------------------------------------ *
 *  De paginakop
 * ------------------------------------------------------------------ */

export function Paginakop({
  titel, uitleg, acties, kruimels,
}: {
  titel: string
  uitleg?: string
  /** Rechts. De hoofdactie hoort hier, en er is er één per scherm. */
  acties?: ReactNode
  kruimels?: ReactNode
}) {
  return (
    <>
      {kruimels}
      <div className="paginakop">
        <div className="paginakop-tekst">
          <h1>{titel}</h1>
          {uitleg && <p>{uitleg}</p>}
        </div>
        {acties && <div className="paginakop-acties">{acties}</div>}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Kruimels
 *
 *  Casper: "Gebruik breadcrumbs alleen wanneer de gebruiker daadwerkelijk
 *  diep in een structuur zit. Niet overal onnodig tonen."
 *
 *  Vandaar dat dit een los onderdeel is en geen vast deel van de kop: op een
 *  overzicht staan ze niet, op een detailpagina wel.
 * ------------------------------------------------------------------ */

export function Kruimels({
  stappen,
}: {
  /** De laatste is waar je bent en is niet klikbaar. */
  stappen: readonly { label: string; ga?: () => void }[]
}) {
  return (
    <nav className="kruimels" aria-label="Waar je bent">
      {stappen.map((s, i) => (
        <span key={s.label + i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {i > 0 && <ChevronRight size={13} aria-hidden="true" />}
          {s.ga && i < stappen.length - 1
            ? <button onClick={s.ga}>{s.label}</button>
            : <span className="nu" aria-current="page">{s.label}</span>}
        </span>
      ))}
    </nav>
  )
}

/* ------------------------------------------------------------------ *
 *  Een sectie binnen een pagina
 *
 *  Casper: "Gebruik cards alleen wanneer ze daadwerkelijk helpen. Vermijd
 *  Card -> Card -> Card -> tabel."
 *
 *  Een kop met een lijn eronder in plaats van een doos. Dat leest hetzelfde
 *  en kost geen drie randen en drie keer padding.
 * ------------------------------------------------------------------ */

export function Sectie({
  titel, acties, children,
}: {
  titel?: string
  acties?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="sectie">
      {titel && (
        <h2 style={acties ? { display: 'flex', alignItems: 'center', gap: 'var(--s3)' } : undefined}>
          <span style={{ flex: '1 1 auto' }}>{titel}</span>
          {acties}
        </h2>
      )}
      {children}
    </section>
  )
}

/* Label naast waarde. De standaardvorm voor gegevens bekijken. */
export function Paren({ children }: { children: ReactNode }) {
  return <dl className="paren">{children}</dl>
}

export function Paar({
  label, children, getal,
}: {
  label: string
  children: ReactNode
  getal?: boolean
}) {
  return (
    <div className="paar">
      <dt>{label}</dt>
      <dd className={getal ? 'getal' : undefined}>{children}</dd>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Tabbladen
 *
 *  Casper: "Gebruik tabs wanneer verschillende views van dezelfde dataset
 *  logisch bij elkaar horen. Niet voor totaal verschillende
 *  functionaliteiten."
 *
 *  Dus voor Alle / Nieuw / In behandeling. Losse functies horen in het menu;
 *  daar zit de scheiding.
 * ------------------------------------------------------------------ */

export interface Tab {
  sleutel: string
  label: string
  /** Hoeveel er in dit tabblad zitten. Nul wordt niet getoond. */
  aantal?: number
}

export function Tabbladen({
  tabs, actief, kies,
}: {
  tabs: readonly Tab[]
  actief: string
  kies: (sleutel: string) => void
}) {
  const raam = useRef<HTMLDivElement>(null)

  /*
   * Pijltjes links en rechts.
   *
   * Tabbladen zijn volgens de WAI-ARIA-afspraak één stop met Tab, waarna je
   * met de pijltjes wisselt. Dat is niet alleen netjes: op een scherm met
   * zes tabbladen en een tabel eronder wil je niet zes keer Tab voordat je
   * bij de inhoud bent.
   */
  function pijl(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.sleutel === actief)
    if (i < 0) return
    let n = i
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = tabs.length - 1
    else return
    e.preventDefault()
    kies(tabs[n].sleutel)
    const knoppen = raam.current?.querySelectorAll<HTMLButtonElement>('.tabblad')
    knoppen?.[n]?.focus()
  }

  return (
    <div className="tabbladen" role="tablist" ref={raam} onKeyDown={pijl}>
      {tabs.map((t) => (
        <button
          key={t.sleutel}
          className="tabblad"
          role="tab"
          aria-selected={t.sleutel === actief}
          /* Alleen het actieve tabblad zit in de tabreeks; de rest bereik je
             met de pijltjes. Zo is het één stop en geen zes. */
          tabIndex={t.sleutel === actief ? 0 : -1}
          onClick={() => kies(t.sleutel)}
        >
          {t.label}
          {!!t.aantal && <span className="aantal">{t.aantal}</span>}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  De filterbalk
 *
 *  Casper: "Filters moeten makkelijk te verwijderen zijn ... Status: In
 *  behandeling x ... Filters wissen."
 * ------------------------------------------------------------------ */

export function Filterbalk({ children }: { children: ReactNode }) {
  return <div className="filterbalk">{children}</div>
}

export function Zoekveld({
  waarde, zet, hint, sneltoets,
}: {
  waarde: string
  zet: (v: string) => void
  hint?: string
  /**
   * Ctrl+F op deze pagina zet de cursor hier in plaats van in de zoekbalk
   * van de browser. Casper vroeg daarom (hoofdstuk 16); het is bij een
   * administratielijst bijna altijd wat je bedoelt.
   */
  sneltoets?: boolean
}) {
  const veld = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!sneltoets) return
    function toets(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        veld.current?.focus()
        veld.current?.select()
      }
    }
    window.addEventListener('keydown', toets)
    return () => window.removeEventListener('keydown', toets)
  }, [sneltoets])

  return (
    <div className="zoekveld">
      <Search size={15} aria-hidden="true" />
      <input
        ref={veld}
        type="search"
        value={waarde}
        onChange={(e) => zet(e.target.value)}
        placeholder={hint ?? 'Zoeken…'}
        aria-label={hint ?? 'Zoeken in deze lijst'}
        /* Escape wist het veld. Sneller dan achtentwintig keer backspace, en
           het is wat iedereen probeert. */
        onKeyDown={(e) => { if (e.key === 'Escape' && waarde) { e.preventDefault(); zet('') } }}
      />
    </div>
  )
}

/** Wat er nu aan staat, met een kruisje eraf. */
export function Filterchips({
  chips, wisAlles,
}: {
  chips: readonly { label: string; waarde: string; weg: () => void }[]
  wisAlles?: () => void
}) {
  if (!chips.length) return null
  return (
    <div className="filterchips">
      {chips.map((c) => (
        <span className="chip" key={c.label + c.waarde}>
          {c.label}: <b>{c.waarde}</b>
          <button onClick={c.weg} aria-label={`Filter ${c.label} weghalen`}>
            <X size={12} />
          </button>
        </span>
      ))}
      {chips.length > 1 && wisAlles && (
        <button className="k klein bij" onClick={wisAlles}>Filters wissen</button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Statussen
 *
 *  Een stip EN een woord, zie systeem.css hoofdstuk 8: "geen informatie die
 *  alleen door kleur wordt aangegeven."
 * ------------------------------------------------------------------ */

export type Stemming =
  | 'nieuw' | 'bezig' | 'wacht' | 'akkoord' | 'afgekeurd' | 'betaald' | 'fout'

export function Stand({ stemming, children }: { stemming: Stemming; children: ReactNode }) {
  return <span className={`stand ${stemming}`}>{children}</span>
}

/* ------------------------------------------------------------------ *
 *  Een knop
 *
 *  Vier soorten, en de bezig-stand erin verwerkt: "Als de gebruiker op
 *  Opslaan klikt, moet duidelijk zijn dat er iets gebeurt."
 * ------------------------------------------------------------------ */

export function Knop({
  soort = 'gewoon', klein, ikoon, bezig, children, ...rest
}: {
  soort?: 'hoofd' | 'gewoon' | 'bij' | 'gevaar'
  klein?: boolean
  ikoon?: ReactNode
  bezig?: boolean
  children?: ReactNode
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'>) {
  return (
    <button
      {...rest}
      className={['k', soort, klein ? 'klein' : '', children ? '' : 'ikoon']
        .filter(Boolean).join(' ')}
      data-bezig={bezig ? 'ja' : undefined}
      disabled={rest.disabled || bezig}
    >
      {bezig ? <Loader2 size={klein ? 13 : 15} className="draai" /> : ikoon}
      {children}
    </button>
  )
}
