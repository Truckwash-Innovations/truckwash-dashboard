import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle, ArrowRight, Check, Clock, RotateCcw, ScanText,
} from 'lucide-react'
import { db } from '../../lib/db'
import type { Expense, MailBericht } from '../../lib/types'
import { leesFactuur } from '../../lib/facturen'
import { leesOpnieuw, type Ladderuitkomst } from '../../lib/leesladder'
import { STANDEN, isTeLezen, ontbreekt, standVan, verdeel } from '../../lib/werklijst'
import { dateShort, money, relative } from '../../lib/format'
import {
  Knop, Lade, LeegStaat, Paginakop, Sectie, Tabel,
} from '../../components/ui'
import type { Kolom } from '../../components/ui'
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
 *
 *  Wat er bij het herontwerp veranderd is
 *  --------------------------------------
 *
 *  De vakken waren kaarten met daarin losse blokjes per factuur -- elk met
 *  een eigen indeling, een eigen regelafstand en de knoppen ergens onderaan.
 *  Prima bij drie facturen, onleesbaar bij dertig: je kon niet langs een
 *  kolom kijken om te zien welke bedragen ontbraken.
 *
 *  Nu per vak een tabel met dezelfde kolommen. Dat maakt het scanbaar
 *  ("welke hebben geen bedrag") en het maakt de vakken onderling
 *  vergelijkbaar. De kaart eromheen is een kop met een lijn geworden --
 *  Casper: "Een tabel hoeft niet in een card binnen een card binnen een
 *  card."
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
  const stuk = vakken.filter((v) => v.stand.stuk).reduce((n, v) => n + v.bonnen.length, 0)

  if (bonnen.length === 0) {
    return (
      <>
        <Paginakop titel="Te verwerken" />
        <LeegStaat
          titel="Er is nog niets binnengekomen"
          uitleg="Zodra er een factuur op het inkoopadres arriveert, staat hij hier."
          ikoon={<Clock size={20} />}
        />
      </>
    )
  }

  if (vakken.length === 0) {
    return (
      <>
        <Paginakop titel="Te verwerken" />
        {/* Casper, hoofdstuk 29: "Alles verwerkt. Er staan momenteel geen
            documenten meer op je takenlijst." Een lege werklijst is goed
            nieuws en hoort er ook als goed nieuws uit te zien. */}
        <LeegStaat
          titel="Alles verwerkt"
          uitleg="Er staat niets meer op je lijst. Dat is geen foutmelding."
          ikoon={<Check size={20} />}
        />
      </>
    )
  }

  return (
    <>
      <Paginakop
        titel="Te verwerken"
        uitleg="Alles wat binnenkwam en nog een stap nodig heeft, op volgorde van wat het eerst aandacht vraagt."
      />

      <div className="kerncijfers">
        <span className={werk ? 'let' : undefined}>
          <b>{werk}</b> {werk === 1 ? 'factuur wacht' : 'facturen wachten'} op jou
        </span>
        {stuk > 0 && (
          <>
            <span className="scheiding" aria-hidden="true">·</span>
            <span className="let"><b>{stuk}</b> vastgelopen</span>
          </>
        )}
        <span className="scheiding" aria-hidden="true">·</span>
        <span><b>{bonnen.length}</b> in totaal</span>
      </div>

      {vakken.map((vak) => (
        <Vak key={vak.stand.sleutel} vak={vak} nu={nu} onOpen={onOpen} />
      ))}
    </>
  )
}

/* ---------------------------- Eén vak ----------------------------- */

function Vak({ vak, nu, onOpen }: {
  vak: ReturnType<typeof verdeel>[number]
  nu: number
  onOpen?: (bonId: string) => void
}) {
  const { stand, bonnen } = vak

  /*
   * De kolommen zijn per vak hetzelfde, met opzet.
   *
   * Een vak "vastgelopen" en een vak "wacht op de lezer" hebben andere
   * oorzaken maar dezelfde vraag: welke leverancier, hoeveel, en wat
   * mankeert eraan. Dezelfde kolommen betekent dat je van vak naar vak kunt
   * kijken zonder je ogen opnieuw te richten.
   */
  const kolommen: Kolom<Expense>[] = [
    {
      sleutel: 'wie',
      kop: 'Leverancier',
      sorteer: (a, b) => (a.supplier ?? '').localeCompare(b.supplier ?? '', 'nl'),
      toon: (bon) => (
        <span className="sterk krimp">
          {bon.supplier || <span className="zacht">onbekende leverancier</span>}
        </span>
      ),
    },
    {
      sleutel: 'datum',
      kop: 'Datum',
      breedte: 104,
      zacht: true,
      sorteer: (a, b) => a.date - b.date,
      toon: (bon) => dateShort(bon.date),
    },
    {
      sleutel: 'nummer',
      kop: 'Factuurnr.',
      breedte: 128,
      zacht: true,
      wegOnder: 1200,
      toon: (bon) => bon.factuurnummer || '—',
    },
    {
      sleutel: 'bedrag',
      kop: 'Excl.',
      breedte: 104,
      getal: true,
      sorteer: (a, b) => a.amountExcl - b.amountExcl,
      toon: (bon) => (bon.amountExcl > 0
        ? money(bon.amountExcl)
        : <span className="zacht">geen bedrag</span>),
    },
    {
      /* ------------------------------------------------------------ *
       *  Wat eraan mankeert
       *
       *  Stond als een lijstje van maximaal drie regels ONDER elke factuur.
       *  Dat leest goed bij drie facturen en niet bij dertig: dan is de
       *  lijst vier keer zo hoog en kun je niet meer langs een kolom
       *  kijken.
       *
       *  Nu op een regel, met de rest in de title. De volledige uitleg
       *  staat in het detail -- daar is de ruimte ervoor.
       * ------------------------------------------------------------ */
      sleutel: 'mankeert',
      kop: 'Wat er nog moet',
      toon: (bon) => <Mankeert bon={bon} nu={nu} />,
    },
    {
      sleutel: 'acties',
      kop: '',
      breedte: 190,
      toon: (bon) => (
        <span className="rijacties" onClick={(e) => e.stopPropagation()}>
          {standVan(bon, nu) === 'vastgelopen' && isTeLezen(bon) && <OpnieuwLezen bon={bon} />}
          {onOpen && (
            <Knop klein soort="gewoon" onClick={() => onOpen(bon.id)}>
              Openen <ArrowRight size={13} />
            </Knop>
          )}
        </span>
      ),
    },
  ]

  return (
    <Sectie
      titel={`${stand.label} · ${bonnen.length}`}
    >
      {/* De uitleg van het vak onder de kop en niet als tooltip: dit is de
          reden dat deze facturen bij elkaar staan, en die hoort te lezen te
          zijn zonder ergens overheen te gaan. */}
      <p style={{
        margin: 'calc(var(--s2) * -1) 0 var(--s3)',
        fontSize: 'var(--fs-klein)',
        color: 'var(--text-3)',
        maxWidth: '80ch',
      }}>
        {stand.uitleg}
      </p>

      <Tabel
        rijen={bonnen}
        kolommen={kolommen}
        sleutelVan={(bon) => bon.id}
        opRij={onOpen ? (bon) => onOpen(bon.id) : undefined}
        sorteerOp="datum"
      />
    </Sectie>
  )
}

/* --------------------- Wat er aan een bon mankeert ----------------- */

function Mankeert({ bon, nu }: { bon: Expense; nu: number }) {
  const stand = standVan(bon, nu)
  const mist = ontbreekt(bon)

  if (stand === 'geweigerd' && bon.exactFout) {
    return (
      <span className="krimp" title={`Exact zei: ${bon.exactFout}`}
        style={{ color: 'var(--text-danger)' }}>
        <AlertTriangle size={13} style={{ verticalAlign: -2 }} /> Exact: {bon.exactFout}
      </span>
    )
  }

  if (stand === 'lezen' && bon.leesGeclaimdAt) {
    return (
      <span className="zacht">
        Sinds {relative(bon.leesGeclaimdAt)} bij de lezer
      </span>
    )
  }

  if (mist.length === 0) return <span className="zacht">—</span>

  return (
    <span className="krimp" title={mist.join(' · ')}>
      {mist[0]}
      {mist.length > 1 && <span className="zacht"> en nog {mist.length - 1}</span>}
    </span>
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
 *
 * Wat er bij het herontwerp veranderde: het verslag van de pogingen stond
 * onder de knop, in de rij. In een tabel kan dat niet -- dan groeit een rij
 * van 36 naar 200 pixels en verspringt de hele lijst. Het staat nu in een
 * lade, en dat is beter: daar is ruimte voor de volledige ladder in plaats
 * van drie regels.
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
      <Knop
        klein
        soort="gewoon"
        bezig={bezig}
        onClick={() => void probeer()}
        ikoon={<RotateCcw size={13} />}
        title="De bijlagen opnieuw langsgaan, kansrijkste eerst"
      >
        Lezen
      </Knop>

      {/*
        Het verslag van de ladder.

        Als lade en niet in de rij: in een tabel zou een rij van 36 naar 200
        pixels groeien en verspringt alles eronder. En hier is ruimte voor de
        hele ladder in plaats van drie regels -- juist bij een factuur die
        niet wil, wil je zien wát er is geprobeerd.
      */}
      <Lade
        open={!!uitkomst}
        sluit={() => setUitkomst(null)}
        titel="Opnieuw lezen"
        uitleg={bon.supplier || undefined}
      >
        {uitkomst && (
          <>
            <p style={{
              margin: '0 0 var(--s4)',
              fontSize: 'var(--fs-body)',
              color: uitkomst.gelukt ? 'var(--text-ok)' : 'var(--text-warn)',
            }}>
              {uitkomst.samenvatting}
            </p>

            <ol className="leesladder">
              {uitkomst.pogingen.map((p, i) => (
                <li key={`${p.pad ?? 'zelf'}-${i}`} className={p.gelukt ? 'ok' : ''}>
                  {p.gelukt ? <Check size={13} /> : <ScanText size={13} />}
                  <span>{p.wat}</span>
                  {p.reden && <em>{p.reden}</em>}
                </li>
              ))}
            </ol>
          </>
        )}
      </Lade>
    </>
  )
}

export { STANDEN }
