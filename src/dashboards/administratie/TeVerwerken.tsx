import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle, ArrowRight, Check, Clock, Loader2, RotateCcw, ScanText,
} from 'lucide-react'
import { db } from '../../lib/db'
import type { Expense, MailBericht } from '../../lib/types'
import { leesFactuur } from '../../lib/facturen'
import { leesOpnieuw, type Ladderuitkomst } from '../../lib/leesladder'
import { STANDEN, isTeLezen, ontbreekt, standVan, verdeel } from '../../lib/werklijst'
import { dateShort, money, relative } from '../../lib/format'
import { Card, Empty } from '../../components/ui'
import { toast } from '../../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Te verwerken
 *
 *  Casper: "Maak een aparte werklijst met statussen: wat is er binnen, wat
 *  is gelezen, wat is gecontroleerd, wat is geboekt, en wat is vastgelopen."
 *
 *  Waarom dit naast Inkoopfacturen staat en er niet in
 *  --------------------------------------------------
 *
 *  Dat scherm is een lijst met tabbladen op status, en dat is precies iets
 *  anders. Daar zoek je een bon op omdat de leverancier belt. Hier loop je
 *  af wat er vandaag nog moet gebeuren, en dat is werk met een volgorde:
 *  eerst wat stuk is, dan wat op jou wacht, en wat vanzelf verdergaat komt
 *  onderaan.
 *
 *  De hele indeling komt uit lib/werklijst.ts, zodat de zelftest hem kan
 *  narekenen zonder dit scherm te hoeven renderen.
 * ------------------------------------------------------------------ */

export default function TeVerwerken({ onOpen }: { onOpen?: (bonId: string) => void }) {
  const bonnen = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])

  /*
   * Eén keer per render de klok lezen en dat getal doorgeven. Zou elke
   * standVan() zijn eigen Date.now() nemen, dan kan een bon halverwege de
   * lijst van vak wisselen -- en dan telt de kop iets anders dan er
   * eronder staat.
   */
  const nu = Date.now()
  const vakken = useMemo(() => verdeel(bonnen, nu), [bonnen, nu])

  const werk = vakken.filter((v) => v.stand.actie).reduce((n, v) => n + v.bonnen.length, 0)

  if (bonnen.length === 0) {
    return <Empty text="Er is nog niets binnengekomen." icon={<Clock size={22} />} />
  }

  if (vakken.length === 0) {
    return (
      <Empty
        text="Alles is verwerkt. Dat is geen foutmelding."
        icon={<Check size={22} />}
      />
    )
  }

  return (
    <div className="verwerklijst">
      <p className="verwerklijst-kop">
        {werk === 0
          ? 'Er wacht niets op jou; wat hieronder staat gaat vanzelf verder.'
          : werk === 1
            ? 'Eén factuur wacht op jou.'
            : `${werk} facturen wachten op jou.`}
      </p>

      {vakken.map((vak) => (
        <Vak key={vak.stand.sleutel} vak={vak} nu={nu} onOpen={onOpen} />
      ))}
    </div>
  )
}

/* ---------------------------- Eén vak ----------------------------- */

function Vak({ vak, nu, onOpen }: {
  vak: ReturnType<typeof verdeel>[number]
  nu: number
  onOpen?: (bonId: string) => void
}) {
  const { stand, bonnen } = vak

  return (
    <Card
      title={`${stand.label} · ${bonnen.length}`}
      hint={stand.uitleg}
      className={stand.stuk ? 't-danger' : stand.actie ? 't-oranje' : 't-neutraal'}
    >
      <div className="verwerkrij-lijst">
        {bonnen.map((bon) => (
          <Regel key={bon.id} bon={bon} nu={nu} onOpen={onOpen} />
        ))}
      </div>
    </Card>
  )
}

/* --------------------------- Eén factuur -------------------------- */

function Regel({ bon, nu, onOpen }: {
  bon: Expense
  nu: number
  onOpen?: (bonId: string) => void
}) {
  const stand = standVan(bon, nu)
  const mist = ontbreekt(bon)

  return (
    <div className="verwerkrij">
      <div className="verwerkrij-wie">
        <strong>{bon.supplier || 'Onbekende leverancier'}</strong>
        <span className="muted">
          {dateShort(bon.date)}
          {bon.factuurnummer ? ` · ${bon.factuurnummer}` : ''}
          {' · '}
          {bon.amountExcl > 0 ? `${money(bon.amountExcl)} excl. btw` : 'geen bedrag'}
        </span>
      </div>

      {/* Wat eraan mankeert, in gewone zinnen. Hoogstens drie: staat er een
          lijst van tien, dan leest niemand meer welke de belangrijke was. */}
      {mist.length > 0 && (
        <ul className="verwerkrij-mist">
          {mist.slice(0, 3).map((zin) => <li key={zin}>{zin}</li>)}
          {mist.length > 3 && <li className="muted">en nog {mist.length - 3}</li>}
        </ul>
      )}

      {stand === 'geweigerd' && bon.exactFout && (
        <p className="verwerkrij-fout">
          <AlertTriangle size={13} /> Exact zei: {bon.exactFout}
        </p>
      )}

      {stand === 'lezen' && bon.leesGeclaimdAt && (
        <p className="muted small">Sinds {relative(bon.leesGeclaimdAt)} bij de lezer.</p>
      )}

      <div className="verwerkrij-knoppen">
        {stand === 'vastgelopen' && isTeLezen(bon) && <OpnieuwLezen bon={bon} />}
        {onOpen && (
          <button className="btn sm ghost" onClick={() => onOpen(bon.id)}>
            Openen <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------- De leesladder -------------------------- */

/**
 * Opnieuw lezen, en niet op dezelfde manier.
 *
 * De vorige versie van deze knop deed precies wat er de eerste keer ook
 * gebeurde, dus wie hem indrukte kreeg dezelfde fout terug. Nu loopt hij de
 * bijlagen van de mail langs, kansrijkste eerst -- en laat hij zien wat er
 * is geprobeerd, ook als het niet lukte. Dat laatste is het punt: het
 * alternatief voor doorproberen is niet gokken maar zeggen dat het niet
 * lukte.
 */
function OpnieuwLezen({ bon }: { bon: Expense }) {
  const [bezig, setBezig] = useState(false)
  const [uitkomst, setUitkomst] = useState<Ladderuitkomst | null>(null)

  const post = useLiveQuery<MailBericht | undefined>(
    async () => (bon.mailboxId ? db.mailbox.get(bon.mailboxId) : undefined),
    [bon.mailboxId],
  )

  async function probeer() {
    if (bezig) return
    setBezig(true)
    setUitkomst(null)
    const uit = await leesOpnieuw(bon, post?.attachments ?? [], leesFactuur)
    setBezig(false)
    setUitkomst(uit)
    if (uit.gelukt) toast.ok(uit.samenvatting)
    else toast.warn(uit.samenvatting)
  }

  return (
    <>
      <button className="btn sm" disabled={bezig} onClick={() => void probeer()}>
        {bezig ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}
        {bezig ? 'Bezig…' : 'Opnieuw lezen'}
      </button>

      {uitkomst && (
        <div className="leesladder">
          <p>{uitkomst.samenvatting}</p>
          <ol>
            {uitkomst.pogingen.map((p, i) => (
              <li key={`${p.pad ?? 'zelf'}-${i}`} className={p.gelukt ? 'ok' : ''}>
                {p.gelukt ? <Check size={12} /> : <ScanText size={12} />}
                <span>{p.wat}</span>
                {p.reden && <em>{p.reden}</em>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  )
}

export { STANDEN }
