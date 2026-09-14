import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Clock, Euro, Receipt, RefreshCw } from 'lucide-react'
import { db } from '../../lib/db'
import type { Expense, WashJob } from '../../lib/types'
import { money, moneyShort, relative } from '../../lib/format'
import { Badge, Card, Stat } from '../../components/ui'
import { exactResultaat, type ExactResultaat } from '../../lib/trucksupply'
import { expensesByCategory, managementKpis, startOfDay } from '../../lib/analytics'
import { PALETTE, gridStroke, hoverFill, tooltipStyle } from '../../lib/charts'

/* ------------------------------------------------------------------ *
 *  Financieel
 *
 *  Alleen de cijfers. Het beoordelen van kostenposten stond hier tussen de
 *  grafieken en is verhuisd naar het administratiedashboard: cijfers bekijk
 *  je, bonnen beoordeel je, en dat is ander werk met een ander ritme.
 *
 *  Wat hier bleef staan is het beeld dat je nodig hebt om te weten of het
 *  klopt -- omzet, kosten, marge en de btw-stand.
 * ------------------------------------------------------------------ */

const DAY = 86_400_000

export default function Financieel({ days }: { days: number }) {

  const expenses = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])
  const jobs = useLiveQuery(() => db.washJobs.toArray(), [], [] as WashJob[])

  const from = startOfDay(Date.now() - (days - 1) * DAY)

  const kpis = useMemo(() => managementKpis(jobs, expenses, days), [jobs, expenses, days])
  const byCategory = useMemo(() => expensesByCategory(expenses, days), [expenses, days])

  const open = expenses.filter((e) => e.status === 'open')
  const openBedrag = open.reduce((a, e) => a + e.amountExcl, 0)

  const periodeKosten = expenses.filter((e) => e.status === 'goedgekeurd' && e.date >= from)
  const btw = periodeKosten.reduce((a, e) => a + (e.amountExcl * e.vatPct) / 100, 0)

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Te valideren"
          value={open.length}
          delta={{ text: money(openBedrag), dir: 'flat' }}
          icon={<Clock size={17} />}
          tone={open.length ? 'warn' : 'ok'}
        />
        <Stat label={`Omzet (${days}d)`} value={money(kpis.omzet.value)} icon={<Euro size={17} />} />
        <Stat label={`Goedgekeurde kosten (${days}d)`} value={money(kpis.kosten.value)} icon={<Receipt size={17} />} tone="warn" />
        <Stat
          label="Resultaat"
          value={money(kpis.marge.value)}
          delta={{
            text: kpis.omzet.value ? `${Math.round((kpis.marge.value / kpis.omzet.value) * 100)}% marge` : '—',
            dir: kpis.marge.value >= 0 ? 'up' : 'down',
          }}
          icon={<Euro size={17} />}
          tone={kpis.marge.value >= 0 ? 'ok' : 'danger'}
        />
      </div>

      {open.length > 0 && (
        <p className="hint" style={{ marginBottom: 14 }}>
          <Receipt size={13} /> {open.length} {open.length === 1 ? 'kostenpost wacht' : 'kostenposten wachten'} op
          een beslissing. Beoordelen doe je bij Administratie; hier staan de cijfers.
        </p>
      )}

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
          <Card title="Kosten per categorie" hint={`${days} dagen`}>
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCategory} layout="vertical" margin={{ left: 12, right: 12 }}>
                  <CartesianGrid stroke={gridStroke} horizontal={false} />
                  <XAxis type="number" stroke="#6b7d9e" fontSize={11} tickFormatter={(v) => moneyShort(v)} />
                  <YAxis
                    type="category" dataKey="name" stroke="#6b7d9e" fontSize={11}
                    width={78} tickLine={false} axisLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v) => [money(Number(v ?? 0)), 'Kosten']}
                    cursor={hoverFill}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {byCategory.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Resultaat" hint={`Laatste ${days} dagen`}>
            <PnlLine label="Omzet (excl. btw)" value={kpis.omzet.value} />
            <PnlLine label="Goedgekeurde kosten" value={-kpis.kosten.value} />
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 8 }}>
              <PnlLine label="Brutoresultaat" value={kpis.marge.value} strong />
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-soft)', fontSize: '.8rem', color: 'var(--text-3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Voorbelasting (btw op kosten)</span>
                <span className="mono">{money(btw)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span>Btw over omzet (21%)</span>
                <span className="mono">{money(kpis.omzet.value * 0.21)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, color: 'var(--text-2)' }}>
                <span>Saldo aangifte</span>
                <span className="mono">{money(kpis.omzet.value * 0.21 - btw)}</span>
              </div>
            </div>
          </Card>
      </div>

      <VolgensExact />
    </>
  )
}

function PnlLine({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div
      style={{
        display: 'flex', justifyContent: 'space-between',
        padding: '5px 0', fontSize: strong ? '.95rem' : '.87rem',
        fontWeight: strong ? 700 : 400,
      }}
    >
      <span style={{ color: strong ? 'var(--text)' : 'var(--text-2)' }}>{label}</span>
      <span
        className="mono"
        style={{ color: value < 0 ? 'var(--warn)' : strong ? 'var(--ok)' : 'var(--text)' }}
      >
        {money(value)}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Volgens Exact
 *
 *  Casper: "dingen zoals financieel bij managment er ook neerzetten op een
 *  nette manier, zodat je daar het exacte resultaat kan zien."
 *
 *  Hierboven staat ONS getal: gereedgemelde wasbeurten min goedgekeurde
 *  bonnen. Dat is bruikbaar voor de vraag "loopt het deze maand", en het is
 *  niet het resultaat -- het mist loon, huur, afschrijving en rente, en het
 *  telt een kostenpost op de dag dat iemand hem goedkeurt in plaats van op
 *  de datum waarop hij hoort.
 *
 *  Dit blok staat er daarom náást en niet in de plaats. Twee getallen die
 *  iets anders meten, allebei met hun naam erbij -- dat is eerlijker dan één
 *  getal waarvan niemand meer weet wat het is.
 *
 *  Waarom het niet vanzelf laadt
 *  -----------------------------
 *
 *  Elke keer dat dit scherm opengaat zou het een ronde langs Exact zijn, per
 *  bv. Dat is traag, het telt mee voor hun limiet, en het cijfer verandert
 *  niet per minuut. Eén knop, en erbij wanneer het is opgehaald.
 * ------------------------------------------------------------------ */

function VolgensExact() {
  const [stand, setStand] = useState<ExactResultaat | null>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [openBv, setOpenBv] = useState<string | null>(null)

  async function haal() {
    setBezig(true)
    setFout(null)
    try {
      setStand(await exactResultaat())
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Ophalen lukte niet.')
    } finally {
      setBezig(false)
    }
  }

  const MAAND = [
    'januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december',
  ]

  return (
    <Card
      title="Volgens Exact"
      hint={stand
        ? `${stand.jaar} tot en met ${MAAND[Math.min(11, Math.max(0, stand.totPeriode - 1))]}`
        : 'Het resultaat uit de boekhouding'}
    >
      {!stand && !fout && (
        <p className="help" style={{ marginTop: 0 }}>
          Hierboven staat wat dit systeem weet: wasbeurten min goedgekeurde
          bonnen. Hieronder komt te staan wat er werkelijk in de boekhouding
          staat — inclusief loon, huur en alles wat niet via deze app loopt.
        </p>
      )}

      {fout && (
        <p className="help danger" style={{ marginTop: 0, color: 'var(--text-danger)' }}>
          {fout}
        </p>
      )}

      {stand && (
        <>
          <div className="grid cols-3" style={{ gap: 10, marginBottom: 14 }}>
            <Stat label="Omzet" value={money(stand.totaal.omzet)} />
            <Stat label="Kosten" value={money(stand.totaal.kosten)} tone="warn" />
            <Stat
              label="Resultaat"
              value={money(stand.totaal.resultaat)}
              tone={stand.totaal.resultaat >= 0 ? 'ok' : 'danger'}
            />
          </div>

          {/* Per bv, want dat is waar het bij meerdere vennootschappen om
              draait: één optelsom zegt niets over welke het doet. */}
          {stand.perBv.map((bv) => (
            <div key={bv.code} style={{ marginBottom: 6 }}>
              <button
                className="verkenner-map"
                onClick={() => setOpenBv(openBv === bv.code ? null : bv.code)}
              >
                <strong>{bv.naam}</strong>
                <span className="spacer" />
                {bv.fout ? (
                  <Badge tone="danger">niet opgehaald</Badge>
                ) : (
                  <span className="mono" style={{
                    color: bv.resultaat >= 0 ? 'var(--ok)' : 'var(--warn)',
                  }}>
                    {money(bv.resultaat)}
                  </span>
                )}
              </button>

              {bv.fout && (
                <p className="ts-sub" style={{ margin: '4px 0 0 12px' }}>{bv.fout}</p>
              )}

              {openBv === bv.code && !bv.fout && (
                <div style={{ padding: '8px 12px' }}>
                  {bv.rekeningen.length === 0 ? (
                    <p className="ts-sub" style={{ margin: 0 }}>
                      Nog niets geboekt in {stand.jaar}.
                    </p>
                  ) : bv.rekeningen.map((r) => (
                    <div
                      key={r.code}
                      style={{
                        display: 'flex', justifyContent: 'space-between',
                        fontSize: '.82rem', padding: '2px 0',
                      }}
                    >
                      <span style={{ color: 'var(--text-2)' }}>
                        <span className="mono">{r.code}</span> {r.naam}
                      </span>
                      <span
                        className="mono"
                        style={{ color: r.soort === 'omzet' ? 'var(--ok)' : 'var(--text)' }}
                      >
                        {money(r.bedrag)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* En wat er van hier nog onderweg is. Zonder dit lijkt het cijfer
              compleet terwijl er nog een stapel ligt die er niet in zit. */}
          <div
            style={{
              marginTop: 14, paddingTop: 12,
              borderTop: '1px solid var(--line-soft)',
              fontSize: '.82rem', color: 'var(--text-3)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Facturen geboekt in Exact</span>
              <span className="mono">{stand.brug.geboekt}</span>
            </div>
            {stand.brug.wachtend > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span>Goedgekeurd, nog niet geboekt</span>
                <span className="mono">
                  {stand.brug.wachtend} · {money(stand.brug.wachtendBedrag)}
                </span>
              </div>
            )}
            {stand.brug.mislukt > 0 && (
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                marginTop: 4, color: 'var(--warn)',
              }}>
                <span>Geweigerd door Exact</span>
                <span className="mono">{stand.brug.mislukt}</span>
              </div>
            )}
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        {stand && (
          <span className="ts-sub">Opgehaald {relative(stand.gemetenOp)}</span>
        )}
        <span className="spacer" />
        <button className="btn sm" disabled={bezig} onClick={() => void haal()}>
          <RefreshCw size={14} className={bezig ? 'spin' : ''} />
          {bezig ? 'Bezig…' : stand ? 'Opnieuw' : 'Ophalen uit Exact'}
        </button>
      </div>
    </Card>
  )
}
