import { useMemo } from 'react'
import { X } from 'lucide-react'

import { Kiezer } from './ui'
import type { User } from '../lib/types'

/* ------------------------------------------------------------------ *
 *  Een groep mensen kiezen
 *
 *  Casper: "Kan je het mogelijk maken om meerdere mensen bij zowel de eerste
 *  als tweede neer te zetten?"
 *
 *  Namen als plaatjes met een kruisje, en eronder een kiezer om er een bij te
 *  doen. Geen lijst met vinkjes: bij twintig collega's is dat twintig regels
 *  om twee namen te zien, en het gaat hier bijna altijd om twee.
 *
 *  Leeg is een geldige keuze en betekent iets -- iedereen die over kosten mag
 *  beslissen, zoals het was. Dat staat er dus ook als het leeg is, want een
 *  leeg vakje ziet eruit als "nog niet ingevuld".
 *
 *  Staat hier en niet in één van de twee schermen: de route per bv en het
 *  inkoopadres stellen dezelfde vraag, en twee kiezers voor "welke mensen"
 *  is er één te veel.
 * ------------------------------------------------------------------ */

export default function Groep({
  ids, namen = [], mag, kandidaten, leegTekst = 'iedereen die over kosten beslist', onZet,
}: {
  ids: string[]
  /** De namen zoals ze zijn vastgelegd; anders die van nu. */
  namen?: string[]
  mag: boolean
  kandidaten: User[]
  leegTekst?: string
  onZet: (ids: string[], namen: string[]) => void
}) {
  const naamVan = useMemo(
    () => new Map(kandidaten.map((u) => [u.id, u.name])), [kandidaten])

  /*
   * De vastgelegde naam gaat voor.
   *
   * Die is meegeschreven op het moment zelf, en blijft leesbaar als iemand
   * later vertrekt. Kennen we hem niet meer én is er geen naam vastgelegd,
   * dan het id -- lelijk, maar eerlijker dan een leeg vakje.
   */
  const toon = (id: string, i: number) => namen[i] || naamVan.get(id) || id

  function haalWeg(id: string) {
    const over: string[] = []
    const overNamen: string[] = []
    ids.forEach((x, i) => {
      if (x === id) return
      over.push(x)
      overNamen.push(toon(x, i))
    })
    onZet(over, overNamen)
  }

  function doeErbij(id: string) {
    if (!id || ids.includes(id)) return
    onZet([...ids, id], [...ids.map(toon), naamVan.get(id) ?? ''])
  }

  const vrij = kandidaten.filter((u) => !ids.includes(u.id))

  return (
    <div style={{ display: 'grid', gap: 5 }}>
      {ids.length === 0 ? (
        <span className="ts-sub">{leegTekst}</span>
      ) : (
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {ids.map((id, i) => (
            <span
              key={id}
              className="row"
              style={{
                gap: 4,
                alignItems: 'center',
                fontSize: '.8rem',
                background: 'var(--bg-2)',
                borderRadius: 999,
                padding: '2px 4px 2px 9px',
              }}
            >
              {toon(id, i)}
              {mag && (
                <button
                  className="btn ghost sm"
                  style={{ padding: '0 4px', lineHeight: 1 }}
                  title="Van deze stap afhalen"
                  onClick={() => haalWeg(id)}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {mag && vrij.length > 0 && (
        <Kiezer
          waarde=""
          leeg="+ iemand erbij"
          zoekHint="Naam"
          opties={vrij.map((u) => ({
            waarde: u.id, label: u.name, sub: u.function ?? undefined,
          }))}
          onKies={doeErbij}
        />
      )}
    </div>
  )
}
