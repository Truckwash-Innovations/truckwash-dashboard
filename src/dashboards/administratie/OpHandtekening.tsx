/* ==================================================================== *
 *  Wat er op een tweede handtekening wacht
 *
 *  Casper: "daarbuiten moet je ervoor zorgen dat het dan op hun todo komt te
 *  staan, maar ook in de lijst zoals op de foto van blue10."
 *
 *  Die foto is een lijst van facturen met per regel wie hem moet aftekenen en
 *  hoeveel dagen hij er al ligt. Dat laatste is waar het om gaat: een factuur
 *  van vier maanden oud ziet er in een gewone lijst hetzelfde uit als een van
 *  gisteren, en juist daarom blijft hij vier maanden liggen.
 *
 *  De takenlijst is de andere kant van hetzelfde: daar staat het werk van ÉÉN
 *  persoon tussen zijn andere werk. Hier staat de hele stapel, zodat iemand
 *  die het overzicht moet houden ziet waar het hangt. Twee weergaven van
 *  dezelfde rijen; de taken worden door een trigger gemaakt (0096) en niet
 *  hier, anders lopen ze uit elkaar.
 * ==================================================================== */

import { useEffect, useMemo, useState } from 'react'
import {
  ROUTE_TEKST, ROUTE_UITLEG, type RouteBron,
} from '../../lib/routering'
import { AlertTriangle, Clock, Loader2, RefreshCw } from 'lucide-react'

import { Card, Empty, Field } from '../../components/ui'
import { money, dateShort } from '../../lib/format'
import { useAuth } from '../../store/useAuth'
import {
  facturenOpHandtekening, type OpHandtekeningRegel,
} from '../../lib/trucksupply'

export function OpHandtekening({ onOpen }: { onOpen?: (id: string) => void }) {
  const user = useAuth((s) => s.user)
  const [regels, setRegels] = useState<OpHandtekeningRegel[] | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const [alleen, setAlleen] = useState(true)

  async function laad() {
    setBezig(true)
    try {
      setRegels(await facturenOpHandtekening())
      setFout(null)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'De lijst is niet op te halen.')
    } finally {
      setBezig(false)
    }
  }

  useEffect(() => { void laad() }, [])

  const zichtbaar = useMemo(() => {
    const alles = regels ?? []
    if (!alleen || !user) return alles
    /* Wat bij mij ligt, plus wat bij niemand ligt -- dat laatste is werk dat
       anders blijft staan omdat iedereen aanneemt dat een ander het doet. */
    return alles.filter(
      (r) => r.ligtBij.length === 0 || r.ligtBij.includes(user.id))
  }, [regels, alleen, user])

  const vanMij = useMemo(
    () => (regels ?? []).filter((r) => user && r.ligtBij.includes(user.id)).length,
    [regels, user])

  return (
    <Card
      title="Wacht op een tweede handtekening"
      hint="Wie hem moet aftekenen, en hoe lang hij er al ligt"
      className="mb"
      action={
        <button className="btn ghost sm" disabled={bezig} onClick={() => void laad()}>
          <RefreshCw size={14} /> Vernieuwen
        </button>
      }
    >
      {fout && (
        <div className="waarschuwing mb">
          <AlertTriangle size={15} /><span>{fout}</span>
        </div>
      )}

      {!regels && !fout && (
        <p className="help" style={{ margin: 0 }}>
          <Loader2 size={14} className="spin" /> Ophalen...
        </p>
      )}

      {regels && regels.length === 0 && (
        <Empty text="Er wacht niets op een tweede handtekening." />
      )}

      {regels && regels.length > 0 && (
        <>
          <Field label="Tonen">
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={alleen}
                onChange={(e) => setAlleen(e.target.checked)}
              />
              <span>
                Alleen wat bij mij ligt
                <span className="ts-sub"> — {vanMij} van {regels.length}</span>
              </span>
            </label>
          </Field>

          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Leverancier</th>
                  <th style={{ width: 130 }}>Factuurnummer</th>
                  <th style={{ width: 90 }}>Vervalt</th>
                  <th style={{ width: 80 }}>Bv</th>
                  <th className="num" style={{ width: 110 }}>Incl. btw</th>
                  <th>Ligt bij</th>
                  <th className="num" style={{ width: 80 }}>Dagen</th>
                </tr>
              </thead>
              <tbody>
                {zichtbaar.map((r) => (
                  <tr
                    key={r.id}
                    style={{ cursor: onOpen ? 'pointer' : undefined }}
                    onClick={() => onOpen?.(r.id)}
                  >
                    <td className="afgekapt">
                      {r.leverancier || '—'}
                      {r.automatisch && (
                        /* Zeggen dat de eerste vanzelf ging. Anders lijkt het
                           of er al iemand naar gekeken heeft, en dan is de
                           tweede handtekening een formaliteit in plaats van
                           de enige. */
                        <div className="ts-sub">eerste goedkeuring ging automatisch</div>
                      )}
                      {!r.automatisch && r.eersteDoorNaam && (
                        <div className="ts-sub">eerste akkoord: {r.eersteDoorNaam}</div>
                      )}
                    </td>
                    <td className="mono afgekapt">{r.factuurnummer || '—'}</td>
                    <td>{r.vervaldatum ? dateShort(r.vervaldatum) : '—'}</td>
                    <td className="mono">{r.administratie ?? '—'}</td>
                    <td className="num">{money(r.bedragIncl)}</td>
                    <td className="afgekapt">
                      {/* Eén van de groep is genoeg; wie er allemaal bij mogen
                          staat erbij, want anders lijkt het van één persoon. */}
                      {r.ligtBijNaam.length > 0
                        ? r.ligtBijNaam.join(', ')
                        : r.ligtBij.length > 0
                          ? r.ligtBij.join(', ')
                          : <span className="ts-sub">niemand in het bijzonder</span>}
                      {/*
                        En waarom hij daar ligt (0106). Zonder die reden is
                        "ligt bij Milos" een feit zonder herkomst, en dan is de
                        enige manier om te zien of de routering doet wat je
                        hebt ingesteld: wachten tot het een keer misgaat.
                      */}
                      {r.routeBron && (
                        <>
                          <br />
                          <span
                            className="ts-sub"
                            title={ROUTE_UITLEG[r.routeBron as RouteBron]}
                          >
                            {ROUTE_TEKST[r.routeBron as RouteBron] ?? r.routeBron}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="num">
                      {/* Boven de twee weken oranje. Een grens is willekeurig;
                          géén grens betekent dat 4 en 140 er hetzelfde
                          uitzien, en dat is het echte probleem. */}
                      <span style={{ color: r.dagen > 14 ? 'var(--warn)' : undefined }}>
                        <Clock size={12} style={{ verticalAlign: -2 }} /> {r.dagen}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {zichtbaar.length === 0 && (
            <p className="help" style={{ marginTop: 8 }}>
              Er ligt niets bij jou. Haal het vinkje weg om de hele stapel te zien.
            </p>
          )}
        </>
      )}
    </Card>
  )
}
