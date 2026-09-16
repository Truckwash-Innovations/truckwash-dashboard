import { useMemo, useState } from 'react'
import { BookOpen, Search, X } from 'lucide-react'
import { Knop, LeegStaat } from '../../components/ui'
import { leesMarkdown, koppenVan, kopId, type Blok, type Stukje } from '../../lib/markdown'

/* ==================================================================
   De bibliotheek
   ==================================================================

   Casper: "Maar je moet ook een bieb hebben voor die documentatie."

   Waarom de documentatie hier de ECHTE documentatie is
   ----------------------------------------------------

   De documenten worden bij het bouwen uit docs/ meegenomen. Niet
   overgetypt, niet samengevat: dezelfde bestanden die in de repo staan en
   waar de zelftest de verwijzingen van nareken.

   Dat is het hele punt. Documentatie die op twee plekken staat, loopt uit
   elkaar -- en dan is degene die je in de app leest altijd de verouderde,
   want die ziet niemand bij het wijzigen. Nu kan dat niet: wie docs/
   bijwerkt, werkt de bibliotheek bij.

   En het werkt offline, omdat het bij de app inzit in plaats van opgehaald
   te worden. Dat past bij de rest van deze app, en bij een monteur in een
   wasstraat met slecht bereik.
   ================================================================== */

/*
 * Vite haalt ze bij het bouwen op. `eager` omdat het er zeven zijn van een
 * paar kilobyte: een laadscherm voor twintig kilobyte tekst is meer werk dan
 * het bespaart.
 */
const BESTANDEN = import.meta.glob('../../../docs/*.md', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

const ROOT = import.meta.glob('../../../README.md', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>

interface Document {
  key: string
  bestand: string
  titel: string
  /** De eerste alinea; die staat in de lijst onder de titel. */
  inleiding: string
  tekst: string
  blokken: Blok[]
}

/** De titel is de eerste kop-1; staat die er niet, dan de bestandsnaam. */
function titelVan(blokken: Blok[], bestand: string): string {
  const kop = blokken.find((b) => b.soort === 'kop' && b.niveau === 1)
  if (kop && kop.soort === 'kop') return kop.stukjes.map((s) => s.tekst).join('')
  return bestand.replace(/\.md$/, '').replace(/-/g, ' ')
}

function inleidingVan(blokken: Blok[]): string {
  const alinea = blokken.find((b) => b.soort === 'alinea')
  if (!alinea || alinea.soort !== 'alinea') return ''
  const tekst = alinea.stukjes.map((s) => s.tekst).join('')
  return tekst.length > 160 ? tekst.slice(0, 157) + '…' : tekst
}

const DOCUMENTEN: Document[] = [...Object.entries(ROOT), ...Object.entries(BESTANDEN)]
  .map(([pad, tekst]) => {
    const bestand = pad.split('/').pop() ?? pad
    const blokken = leesMarkdown(tekst)
    return {
      key: (bestand === 'README.md' && pad.includes('/docs/')) ? 'wegwijzer' : bestand,
      bestand,
      titel: titelVan(blokken, bestand),
      inleiding: inleidingVan(blokken),
      tekst,
      blokken,
    }
  })
  /* De wegwijzer voorop, daarna op titel. Wie binnenkomt hoort eerst te zien
     waar alles staat. */
  .sort((a, b) => {
    if (a.key === 'wegwijzer') return -1
    if (b.key === 'wegwijzer') return 1
    if (a.bestand === 'README.md') return -1
    if (b.bestand === 'README.md') return 1
    return a.titel.localeCompare(b.titel, 'nl')
  })

/* ------------------------------------------------------------------ *
 *  Tonen
 * ------------------------------------------------------------------ */

function Stukjes({ stukjes, opDoc }: { stukjes: Stukje[]; opDoc: (naam: string) => void }) {
  return (
    <>
      {stukjes.map((s, i) => {
        if (s.soort === 'vet') return <strong key={i}>{s.tekst}</strong>
        if (s.soort === 'cursief') return <em key={i}>{s.tekst}</em>
        if (s.soort === 'code') return <code key={i} className="bieb-code">{s.tekst}</code>
        if (s.soort === 'link') {
          /*
           * Een verwijzing naar een ander document blijft binnen de
           * bibliotheek -- dat is het nut ervan. Naar buiten opent gewoon.
           */
          const intern = /\.md$/.test(s.naar.split('#')[0])
          if (intern) {
            const naam = s.naar.split('#')[0].split('/').pop() ?? ''
            return (
              <button key={i} type="button" className="bieb-link"
                onClick={() => opDoc(naam)}>
                {s.tekst}
              </button>
            )
          }
          if (/^https?:/.test(s.naar)) {
            return (
              <a key={i} href={s.naar} target="_blank" rel="noreferrer noopener">
                {s.tekst}
              </a>
            )
          }
          /* Een pad in de repo: laten zien wat het is, maar niet klikbaar --
             daar kan de app niets mee. */
          return <code key={i} className="bieb-code">{s.tekst}</code>
        }
        return <span key={i}>{s.tekst}</span>
      })}
    </>
  )
}

function Blokken({ blokken, opDoc }: { blokken: Blok[]; opDoc: (naam: string) => void }) {
  return (
    <>
      {blokken.map((b, i) => {
        switch (b.soort) {
          case 'kop': {
            const tekst = b.stukjes.map((s) => s.tekst).join('')
            const id = kopId(tekst)
            const H = (`h${Math.min(b.niveau + 1, 6)}`) as 'h2'
            return <H key={i} id={id} className="bieb-kop"><Stukjes stukjes={b.stukjes} opDoc={opDoc} /></H>
          }
          case 'alinea':
            return <p key={i}><Stukjes stukjes={b.stukjes} opDoc={opDoc} /></p>
          case 'lijst':
            return b.genummerd ? (
              <ol key={i}>
                {b.items.map((it, j) => <li key={j}><Stukjes stukjes={it} opDoc={opDoc} /></li>)}
              </ol>
            ) : (
              <ul key={i}>
                {b.items.map((it, j) => <li key={j}><Stukjes stukjes={it} opDoc={opDoc} /></li>)}
              </ul>
            )
          case 'tabel':
            return (
              <div key={i} className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>{b.koppen.map((k, j) => (
                      <th key={j}><Stukjes stukjes={k} opDoc={opDoc} /></th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {b.rijen.map((rij, j) => (
                      <tr key={j}>{rij.map((c, k) => (
                        <td key={k}><Stukjes stukjes={c} opDoc={opDoc} /></td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'code':
            return <pre key={i} className="bieb-blok"><code>{b.tekst}</code></pre>
          case 'citaat':
            return (
              <blockquote key={i} className="bieb-citaat">
                <Stukjes stukjes={b.stukjes} opDoc={opDoc} />
              </blockquote>
            )
          case 'streep':
            return <hr key={i} className="bieb-streep" />
        }
      })}
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Het scherm
 * ------------------------------------------------------------------ */

export default function Bibliotheek() {
  const [open, setOpen] = useState<string | null>(null)
  const [zoek, setZoek] = useState('')

  const doc = useMemo(
    () => DOCUMENTEN.find((d) => d.key === open || d.bestand === open) ?? null,
    [open])

  /*
   * Zoeken door de inhoud en niet alleen door de titels. Wie "SEPA" intikt
   * weet meestal niet in welk document dat staat -- dat is juist waarom hij
   * zoekt.
   */
  const gevonden = useMemo(() => {
    const woorden = zoek.toLowerCase().split(/\s+/).filter(Boolean)
    if (woorden.length === 0) return DOCUMENTEN
    return DOCUMENTEN.filter((d) => {
      const hooiberg = (d.titel + ' ' + d.tekst).toLowerCase()
      return woorden.every((w) => hooiberg.includes(w))
    })
  }, [zoek])

  const koppen = useMemo(() => (doc ? koppenVan(doc.blokken) : []), [doc])

  /* --- één document open --- */

  if (doc) {
    return (
      <div className="bieb">
        <div className="bieb-balk">
          <Knop soort="gewoon" onClick={() => setOpen(null)}>
            <X size={14} /> Terug naar de kast
          </Knop>
          <span className="ts-sub mono">{doc.bestand}</span>
        </div>

        <div className="bieb-lezen">
          {koppen.length > 2 && (
            <nav className="bieb-inhoud" aria-label="In dit document">
              <p className="bieb-inhoud-kop">In dit document</p>
              {koppen.map((k) => (
                <a key={k.id} href={`#${k.id}`}
                  className={k.niveau === 3 ? 'diep' : undefined}>
                  {k.tekst}
                </a>
              ))}
            </nav>
          )}
          <article className="bieb-tekst">
            <Blokken blokken={doc.blokken} opDoc={(naam) => setOpen(naam)} />
          </article>
        </div>
      </div>
    )
  }

  /* --- de kast --- */

  return (
    <div className="bieb">
      <div className="bieb-zoek">
        <Search size={15} />
        <input
          className="input"
          value={zoek}
          placeholder="Zoek in alle documentatie — bijvoorbeeld SEPA, vier ogen, wekkers"
          onChange={(e) => setZoek(e.currentTarget.value)}
        />
        {zoek && (
          <button className="btn ghost sm" onClick={() => setZoek('')}>
            <X size={13} />
          </button>
        )}
      </div>

      {gevonden.length === 0 ? (
        <LeegStaat
          titel="Niets gevonden"
          uitleg={`Geen document met "${zoek}". Zoek op een ander woord, of blader door de kast.`}
          ikoon={<BookOpen size={20} />}
        />
      ) : (
        <div className="bieb-kast">
          {gevonden.map((d) => (
            <button key={d.key} type="button" className="bieb-boek"
              onClick={() => setOpen(d.key)}>
              <span className="bieb-rug" aria-hidden="true" />
              <span className="bieb-boek-tekst">
                <strong>{d.titel}</strong>
                {d.inleiding && <span className="ts-sub">{d.inleiding}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="ts-sub" style={{ marginTop: 'var(--s4)' }}>
        Dit is dezelfde documentatie die in de repo staat, meegebouwd bij het
        uitbrengen. Klopt er iets niet, dan klopt het daar ook niet — en dan is
        het een melding waard.
      </p>
    </div>
  )
}
