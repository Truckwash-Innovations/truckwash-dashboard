/* ==================================================================== *
 *  Kiezen uit een lange lijst
 *
 *  Casper: "Bij grootboekrekening moet je ook een zoekbalkje hebben, evenals
 *  onderneming."
 *
 *  Een <select> is prima tot een stuk of vijftien regels. Het rekeningschema
 *  van een bv heeft er honderden, en dan krijg je wat op zijn schermafbeelding
 *  staat: scrollen langs 2040 Uitbetaalde lonen, 2050 Betalingen onderweg,
 *  2100 Overlopende passiva -- op zoek naar 4000. Je weet wat je zoekt en je
 *  moet het toch vinden.
 *
 *  Dus typen in plaats van scrollen. Verder blijft het een keuzelijst: er is
 *  niets vrijs in te vullen, want een rekening die niet in de lijst staat
 *  bestaat niet in die administratie.
 *
 *  Waarom een portaal
 *  ------------------
 *
 *  Dezelfde reden als bij Dropdown hierboven: de balk bovenin heeft een
 *  backdrop-filter en het werkvlak krijgt van framer-motion een transform.
 *  Allebei maken een eigen stapelcontext, en dan telt een z-index alleen mee
 *  ten opzichte van buren. Een paneel dat binnen de kaart blijft, verdwijnt
 *  achter de volgende kaart -- of wordt afgeknipt door de overflow van de
 *  verdeling.
 * ==================================================================== */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'

export interface KiezerOptie {
  waarde: string
  label: string
  /** Kleiner eronder: een omschrijving, een plaats, een toelichting. */
  sub?: string
  /** Meetellen bij het zoeken zonder in beeld te staan. */
  zoekwoorden?: string
}

/**
 * Past deze optie bij wat er getypt is?
 *
 * Alle woorden moeten voorkomen, in willekeurige volgorde. Zo werkt "4000
 * chemie" net zo goed als "chemie 4000", en dat is hoe mensen zoeken: ze
 * typen wat ze weten, niet wat er in de juiste volgorde staat.
 */
function past(o: KiezerOptie, term: string): boolean {
  const t = term.trim().toLowerCase()
  if (!t) return true
  const hooi = `${o.label} ${o.sub ?? ''} ${o.zoekwoorden ?? ''}`.toLowerCase()
  return t.split(/\s+/).every((w) => hooi.includes(w))
}

export function Kiezer({
  waarde, opties, onKies, leeg = '— kies —', disabled = false,
  zoekHint = 'Typ om te zoeken', legeLijst = 'Niets gevonden', className = '',
}: {
  waarde: string | undefined
  opties: KiezerOptie[]
  onKies: (waarde: string) => void
  /** Wat er staat als er niets gekozen is; leeg maken kan altijd. */
  leeg?: string
  disabled?: boolean
  zoekHint?: string
  legeLijst?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [wijzer, setWijzer] = useState(0)
  const [plek, setPlek] = useState<{ top: number; left: number; breed: number } | null>(null)

  const knop = useRef<HTMLButtonElement>(null)
  const paneel = useRef<HTMLDivElement>(null)
  const veld = useRef<HTMLInputElement>(null)

  const gekozen = opties.find((o) => o.waarde === waarde)
  const zichtbaar = useMemo(() => opties.filter((o) => past(o, term)), [opties, term])

  /* Bij elke nieuwe zoekterm weer bovenaan beginnen. Zonder dit wijst de
     markering na het typen naar een regel die er niet meer staat. */
  useEffect(() => { setWijzer(0) }, [term])

  useLayoutEffect(() => {
    if (!open) return
    const r = knop.current?.getBoundingClientRect()
    if (!r) return

    const hoog = 320
    const ruimteOnder = window.innerHeight - r.bottom
    const boven = ruimteOnder < hoog && r.top > ruimteOnder

    setPlek({
      top: boven ? Math.max(8, r.top - hoog - 6) : r.bottom + 6,
      left: r.left,
      /* Nooit smaller dan de knop en nooit zo smal dat een rekeningnaam
         afgekapt wordt -- juist die naam is waar je op zoekt. */
      breed: Math.min(Math.max(r.width, 280), window.innerWidth - r.left - 12),
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    veld.current?.focus()

    const buiten = (e: MouseEvent) => {
      const t = e.target as Node
      if (!paneel.current?.contains(t) && !knop.current?.contains(t)) setOpen(false)
    }
    /* Meescrollen heeft geen zin: dan zweeft het paneel los van zijn knop. */
    const weg = () => setOpen(false)

    document.addEventListener('mousedown', buiten)
    window.addEventListener('resize', weg)
    window.addEventListener('scroll', weg, true)
    return () => {
      document.removeEventListener('mousedown', buiten)
      window.removeEventListener('resize', weg)
      window.removeEventListener('scroll', weg, true)
    }
  }, [open])

  function kies(v: string) {
    onKies(v)
    setOpen(false)
    setTerm('')
  }

  function toets(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setWijzer((n) => Math.min(n + 1, zichtbaar.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setWijzer((n) => Math.max(n - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const raak = zichtbaar[wijzer]
      if (raak) kies(raak.waarde)
    }
  }

  return (
    <>
      <button
        ref={knop}
        type="button"
        className={`kiezer-knop ${open ? 'open' : ''} ${className}`}
        disabled={disabled}
        onClick={() => { setTerm(''); setOpen((v) => !v) }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={gekozen ? `${gekozen.label}${gekozen.sub ? ` · ${gekozen.sub}` : ''}` : leeg}
      >
        <span className={`kiezer-waarde ${gekozen ? '' : 'leeg'}`}>
          {gekozen ? gekozen.label : leeg}
        </span>
        <ChevronDown size={14} className="kiezer-pijl" />
      </button>

      {open && plek && createPortal(
        <div
          ref={paneel}
          className="kiezer-paneel"
          style={{ top: plek.top, left: plek.left, width: plek.breed }}
          role="listbox"
        >
          <div className="kiezer-zoek">
            <Search size={14} />
            <input
              ref={veld}
              className="kiezer-invoer"
              placeholder={zoekHint}
              value={term}
              onChange={(e) => setTerm(e.currentTarget.value)}
              onKeyDown={toets}
            />
          </div>

          <div className="kiezer-lijst">
            {/* Leegmaken kan altijd, en staat bovenaan zodat het niet
                verdwijnt zodra er gezocht wordt. */}
            <button
              type="button"
              className={`kiezer-regel ${!waarde ? 'aan' : ''}`}
              onClick={() => kies('')}
            >
              <span className="kiezer-vink">{!waarde && <Check size={13} />}</span>
              <span className="kiezer-tekst leeg">{leeg}</span>
            </button>

            {zichtbaar.map((o, i) => (
              <button
                key={o.waarde}
                type="button"
                role="option"
                aria-selected={o.waarde === waarde}
                className={`kiezer-regel ${i === wijzer ? 'wijzer' : ''} ${o.waarde === waarde ? 'aan' : ''}`}
                onMouseEnter={() => setWijzer(i)}
                onClick={() => kies(o.waarde)}
              >
                <span className="kiezer-vink">
                  {o.waarde === waarde && <Check size={13} />}
                </span>
                <span className="kiezer-tekst">
                  {o.label}
                  {o.sub && <span className="kiezer-sub">{o.sub}</span>}
                </span>
              </button>
            ))}

            {zichtbaar.length === 0 && (
              <p className="kiezer-niets">{legeLijst}</p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
