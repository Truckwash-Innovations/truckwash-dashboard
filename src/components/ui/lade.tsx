import { type ReactNode, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { Knop } from './pagina'

/* ==================================================================
   De lade en het bevestigvenster
   ==================================================================

   Casper: "Hoewel ik geen permanente sidebar wil, mogen tijdelijke side
   panels wel worden gebruikt. Bijvoorbeeld voor filters, details, snelle
   bewerking, notificaties. Deze moeten alleen verschijnen wanneer nodig. Ze
   mogen nooit de primaire navigatie vervangen."

   En over vensters: "Gebruik modals alleen wanneer dat logisch is. Geen
   enorme pop-ups voor simpele acties ... Voor uitgebreide workflows liever
   een aparte pagina of side panel."

   Dus twee dingen met een duidelijke taakverdeling:

     Lade      iets erbij bekijken of snel wijzigen, zonder de lijst kwijt
               te raken. Rechts, want de navigatie zit links.
     Bevestig  één vraag met twee antwoorden. Niets anders -- zodra er een
               formulier in moet, hoort het een lade of een pagina te zijn.
   ================================================================== */

/* ------------------------------------------------------------------ *
 *  Focus vasthouden
 *
 *  Waarom dit er is: zonder dit loopt Tab uit een open venster wég, naar de
 *  knoppen van de pagina eronder. Voor wie met de muis werkt valt dat niet
 *  op; wie met het toetsenbord werkt raakt het venster kwijt en drukt op
 *  knoppen die hij niet kan zien.
 *
 *  Drie dingen: de focus gaat naar binnen bij het openen, Tab blijft binnen,
 *  en bij het sluiten gaat hij terug naar waar hij vandaan kwam.
 * ------------------------------------------------------------------ */

const TE_FOCUSSEN = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

function useFocusKooi(open: boolean, sluit: () => void) {
  const raam = useRef<HTMLDivElement>(null)
  const kwamVan = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    kwamVan.current = document.activeElement as HTMLElement | null

    /* Naar het eerste veld, of naar het venster zelf als er niets in zit. */
    const eerste = raam.current?.querySelector<HTMLElement>(TE_FOCUSSEN)
    ;(eerste ?? raam.current)?.focus()

    function toets(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); sluit(); return }
      if (e.key !== 'Tab') return
      const kan = raam.current?.querySelectorAll<HTMLElement>(TE_FOCUSSEN)
      if (!kan?.length) return
      const eerst = kan[0]
      const laatst = kan[kan.length - 1]
      if (e.shiftKey && document.activeElement === eerst) {
        e.preventDefault(); laatst.focus()
      } else if (!e.shiftKey && document.activeElement === laatst) {
        e.preventDefault(); eerst.focus()
      }
    }

    document.addEventListener('keydown', toets)
    /* De pagina eronder mag niet meescrollen: dan schuift de lijst weg
       terwijl je in de lade werkt en sta je na het sluiten ergens anders. */
    const oud = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', toets)
      document.body.style.overflow = oud
      kwamVan.current?.focus?.()
    }
  }, [open, sluit])

  return raam
}

/* ------------------------------------------------------------------ *
 *  De lade
 * ------------------------------------------------------------------ */

export function Lade({
  open, sluit, titel, uitleg, voet, breed, children,
}: {
  open: boolean
  sluit: () => void
  titel: string
  uitleg?: string
  /** De knoppen onderaan. Blijven staan als de inhoud scrollt. */
  voet?: ReactNode
  /** Breder, voor een lade met een tabel erin. */
  breed?: boolean
  children: ReactNode
}) {
  const raam = useFocusKooi(open, sluit)
  if (!open) return null

  return createPortal(
    <>
      <div className="lade-sluier" onClick={sluit} aria-hidden="true" />
      <div
        className="lade"
        style={breed ? { width: 'min(720px, 100vw)' } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={titel}
        ref={raam}
        tabIndex={-1}
      >
        <div className="lade-kop">
          <h2>{titel}</h2>
          <Knop soort="bij" klein ikoon={<X size={16} />} onClick={sluit} aria-label="Sluiten" />
        </div>
        {uitleg && (
          <p style={{
            margin: 0,
            padding: 'var(--s2) var(--s4)',
            borderBottom: '1px solid var(--line-soft)',
            fontSize: 'var(--fs-meta)',
            color: 'var(--text-3)',
          }}>{uitleg}</p>
        )}
        <div className="lade-body">{children}</div>
        {voet && <div className="lade-voet">{voet}</div>}
      </div>
    </>,
    document.body,
  )
}

/* ------------------------------------------------------------------ *
 *  Bevestigen
 *
 *  Casper: "Bijvoorbeeld bij verwijderen: Factuur verwijderen? Weet je zeker
 *  dat je deze factuur wilt verwijderen? Annuleren / Verwijderen."
 *
 *  Klein, één vraag, twee knoppen. En de gevaarlijke knop is NIET de
 *  standaardknop: Enter doet hier niets. Wie een venster wegdrukt met Enter
 *  hoort niet per ongeluk iets te wissen.
 * ------------------------------------------------------------------ */

export function Bevestig({
  open, sluit, titel, vraag, knop, gevaar, bezig, doe,
}: {
  open: boolean
  sluit: () => void
  titel: string
  vraag: ReactNode
  /** Wat er op de bevestigknop staat. "Verwijderen", niet "Ja". */
  knop: string
  gevaar?: boolean
  bezig?: boolean
  doe: () => void
}) {
  const raam = useFocusKooi(open, sluit)
  if (!open) return null

  return createPortal(
    <>
      <div className="lade-sluier" onClick={sluit} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titel}
        ref={raam}
        tabIndex={-1}
        style={{
          position: 'fixed',
          zIndex: 71,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(420px, calc(100vw - var(--s6)))',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow)',
          padding: 'var(--s5)',
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'flex-start' }}>
          {gevaar && (
            <span style={{ flex: 'none', color: 'var(--text-danger)', marginTop: 2 }}>
              <AlertTriangle size={20} />
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <h2 style={{
              margin: 0,
              fontSize: 'var(--fs-sectie)',
              fontWeight: 'var(--fw-half)',
              color: 'var(--text)',
            }}>{titel}</h2>
            <div style={{
              margin: 'var(--s2) 0 0',
              fontSize: 'var(--fs-klein)',
              color: 'var(--text-2)',
              lineHeight: 1.55,
            }}>{vraag}</div>
          </div>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 'var(--s2)',
          marginTop: 'var(--s5)',
        }}>
          <Knop soort="bij" onClick={sluit} disabled={bezig}>Annuleren</Knop>
          <Knop soort={gevaar ? 'gevaar' : 'hoofd'} onClick={doe} bezig={bezig}>{knop}</Knop>
        </div>
      </div>
    </>,
    document.body,
  )
}
