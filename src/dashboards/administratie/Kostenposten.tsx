import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, Check, CheckCheck, Clock, Euro, Loader2, Mail, Paperclip,
  History, MessageSquarePlus, Plus, Receipt, RotateCcw, ScanText, Sparkles,
  Split, Wallet, X,
} from 'lucide-react'
import { db, uid } from '../../lib/db'
import { expenses as expRepo } from '../../lib/repo'
import type {
  Expense, ExpenseGebeurtenis, ExpenseRegel, FactuurLezing, Grootboek, KostenTag, Location, MailBericht,
} from '../../lib/types'
import {
  bedragExcl, btwPercentage, heeftIetsTeLezen, leesFactuur, nogNietIngevuld,
  regelsKloppen, voorstellen, type Voorstel,
} from '../../lib/facturen'
import { dateShort, dateTime, datumMisschienTijd, money } from '../../lib/format'
import {
  BRON_TEKST, onthoudBoeking, rekeningNaam, vraagtAandacht, zetBoeking,
} from '../../lib/boeking'
import { historieVan } from '../../lib/factuurhistorie'
import { Badge, Card, Empty, Field, Modal, Stat } from '../../components/ui'
import { magOpenen, postbus } from '../../lib/postbus'
import Bekijker from '../../components/Bekijker'
import type { Bekijkbaar } from '../../lib/bekijken'
import { useAuth } from '../../store/useAuth'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Kostenposten
 *
 *  Stond bij Financieel, tussen de omzetgrafieken. Dat was de verkeerde
 *  plek: cijfers bekijk je, bonnen beoordeel je, en dat is ander werk met
 *  een ander ritme. Hier staat alleen het beoordelen.
 *
 *  Wat erbij is gekomen: de factuur wordt voorgelezen. Uit de PDF of de foto
 *  komen de leverancier, het factuurnummer, de regels en de bedragen, en die
 *  worden naast de bon gelegd.
 *
 *  Het belangrijkste aan dat lezen is wat het níét doet. Er wordt niets
 *  overgenomen. Wat eruit komt staat in een eigen veld, met erbij waar het
 *  model over twijfelde, en pas als jij op overnemen drukt verandert er iets
 *  aan de kostenpost. Een bedrag dat half is geraden is gevaarlijker dan een
 *  leeg veld: dat laatste vul je in, het eerste keur je goed.
 * ------------------------------------------------------------------ */

type Tab = 'open' | 'eerste_akkoord' | 'goedgekeurd' | 'afgekeurd' | 'alles'

/*
 * "Wacht op tweede" staat er sinds 0060 tussen. Dat is met opzet een eigen
 * tabblad en geen randje bij "te valideren": het is werk voor iemand ANDERS
 * dan wie er al keek, en dat wil je in één oogopslag zien.
 */
const TABS: { key: Tab; label: string }[] = [
  { key: 'open', label: 'Te valideren' },
  { key: 'eerste_akkoord', label: 'Wacht op tweede' },
  { key: 'goedgekeurd', label: 'Goedgekeurd' },
  { key: 'afgekeurd', label: 'Afgekeurd' },
  { key: 'alles', label: 'Alles' },
]

export default function Kostenposten({ openBon }: { openBon?: string } = {}) {
  const user = useAuth((s) => s.user)!
  const perms = usePerms()
  const [tab, setTab] = useState<Tab>('open')
  /*
   * Zoeken. Eén veld, want dat is hoe mensen zoeken: ze typen wat ze weten.
   * Een leveranciersnaam, een bedrag, een factuurnummer, een woord uit de
   * omschrijving. Losse velden per soort zouden nauwkeuriger zijn en trager
   * in gebruik -- dan moet je eerst kiezen wát je weet.
   */
  const [zoek, setZoek] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [afkeuren, setAfkeuren] = useState<Expense | null>(null)
  const [reden, setReden] = useState('')
  const [open, setOpen] = useState<string | null>(openBon ?? null)

  /*
   * Binnenkomen op een bon.
   *
   * Uit de werklijst ("Openen") of uit een mail met ?open=kosten&id=exp_123.
   * Het tabblad gaat mee naar 'alles': staat de bon op goedgekeurd en kijk je
   * naar 'open', dan schuift het venster open boven een lijst waar hij niet
   * in staat, en na sluiten ben je hem kwijt.
   */
  useEffect(() => {
    if (!openBon) return
    setOpen(openBon)
    setTab('alles')
  }, [openBon])

  const alle = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])

  const rijen = useMemo(
    () => alle
      .filter((e) => (tab === 'alles' ? true : e.status === tab))
      .filter((e) => pastBijZoek(e, zoek))
      .sort((a, b) => b.date - a.date),
    /* `zoek` hoort hier ook in. Zonder dat werd de lijst pas opnieuw
       gefilterd als je van tabblad wisselde, en leek het zoekveld stuk. */
    [alle, tab, zoek],
  )

  const teValideren = alle.filter((e) => e.status === 'open')
  const openBedrag = teValideren.reduce((a, e) => a + e.amountExcl, 0)
  const zonderBedrag = teValideren.filter((e) => e.amountExcl === 0).length
  const gekozen = alle.find((e) => e.id === open) ?? null

  function wissel(id: string) {
    const volgende = new Set(selected)
    if (volgende.has(id)) volgende.delete(id)
    else volgende.add(id)
    setSelected(volgende)
  }

  async function keurGoed(ids: string[]) {
    let eerste = 0
    let tweede = 0
    const geweigerd: string[] = []

    for (const id of ids) {
      const voor = alle.find((r) => r.id === id)?.status
      try {
        await expRepo.decide(id, 'goedgekeurd', { id: user.id, name: user.name })
      } catch (e) {
        /*
         * De enige verwachte weigering: je hebt hem zelf al nagekeken. Dat
         * hoort geen ramp te zijn -- bij het goedkeuren van tien bonnen
         * tegelijk zitten er misschien twee van jezelf tussen, en de andere
         * acht moeten gewoon doorgaan.
         */
        geweigerd.push(e instanceof Error ? e.message : 'geweigerd')
        continue
      }
      const na = (await db.expenses.get(id))?.status
      if (na === 'eerste_akkoord') eerste++
      else if (na === 'goedgekeurd') tweede++
      if (voor === undefined) { /* niets */ }

      /*
       * En onthouden hoe deze leverancier geboekt is.
       *
       * Dit is het moment waarop het raden ophoudt: iemand heeft ernaar
       * gekeken en gezegd dat het klopt. De volgende factuur van dezelfde
       * partij staat daarmee meteen goed.
       *
       * Achter de goedkeuring langs, en zonder erop te wachten: het bijwerken
       * van het geheugen mag het goedkeuren niet ophouden en al helemaal niet
       * laten mislukken.
       */
      const bon = alle.find((r) => r.id === id)
      if (bon && (await db.expenses.get(id))?.status === 'goedgekeurd') void onthoudBoeking(bon)
    }
    setSelected(new Set())

    if (tweede > 0) {
      toast.ok(tweede === 1 ? 'Kostenpost goedgekeurd' : `${tweede} kostenposten goedgekeurd`)
    }
    if (eerste > 0) {
      toast.ok(eerste === 1
        ? 'Eerste akkoord gegeven. Iemand anders moet hem nog aftekenen.'
        : `${eerste} keer eerste akkoord. Iemand anders moet ze nog aftekenen.`)
    }
    if (geweigerd.length > 0) {
      toast.warn(geweigerd.length === 1
        ? geweigerd[0]
        : `${geweigerd.length} bonnen had je zelf al nagekeken; die moet iemand anders aftekenen.`)
    }
  }

  async function keurAf() {
    if (!afkeuren) return
    await expRepo.decide(
      afkeuren.id, 'afgekeurd', { id: user.id, name: user.name },
      reden.trim() || 'Geen reden opgegeven')
    toast.warn('Kostenpost afgekeurd')
    setAfkeuren(null)
    setReden('')
  }

  const gekozenRijen = rijen.filter((r) => selected.has(r.id))

  return (
    <>
      <div className="grid cols-3 mb">
        <Stat
          label="Te valideren"
          value={teValideren.length}
          delta={{ text: money(openBedrag), dir: 'flat' }}
          icon={<Clock size={17} />}
          tone={teValideren.length ? 'warn' : 'ok'}
        />
        <Stat
          label="Bedrag nog leeg"
          value={zonderBedrag}
          icon={<Euro size={17} />}
          tone={zonderBedrag ? 'warn' : undefined}
        />
        <Stat
          label="Al voorgelezen"
          value={alle.filter((e) => e.gelezen).length}
          icon={<ScanText size={17} />}
        />
      </div>

      <Card
        title="Kostenposten"
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            {gekozenRijen.length > 0 && (
              <button
                className="btn ok sm"
                onClick={() => void keurGoed(gekozenRijen.map((r) => r.id))}
              >
                <CheckCheck size={14} /> {gekozenRijen.length} goedkeuren
              </button>
            )}
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input"
                style={{ minWidth: 200 }}
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
                placeholder="Zoek op leverancier, nummer, bedrag…"
                aria-label="Zoeken in kostenposten"
              />
              {zoek && (
                <button className="btn ghost sm" onClick={() => setZoek('')} title="Zoekterm wissen">
                  <X size={14} />
                </button>
              )}
            </div>
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`btn sm ${tab === t.key ? 'primary' : 'ghost'}`}
                onClick={() => { setTab(t.key); setSelected(new Set()) }}
              >
                {t.label}
                {t.key === 'open' && teValideren.length > 0 && ` (${teValideren.length})`}
              </button>
            ))}
          </div>
        }
      >
        {rijen.length === 0 ? (
          <Empty text="Niets in deze lijst." icon={<Receipt size={30} />} />
        ) : (
          <div className="table-wrap" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  {tab === 'open' && (
                    <th style={{ width: 34 }}>
                      <input
                        type="checkbox"
                        checked={selected.size > 0 && selected.size === rijen.length}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(rijen.map((r) => r.id)) : new Set())
                        }
                      />
                    </th>
                  )}
                  <th>Datum</th>
                  <th>Leverancier</th>
                  <th>Omschrijving</th>
                  <th>Ingediend door</th>
                  <th className="num">Excl.</th>
                  <th className="num">Btw</th>
                  <th className="num">Incl.</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rijen.map((e) => {
                  const btw = (e.amountExcl * e.vatPct) / 100
                  return (
                    <tr key={e.id}>
                      {tab === 'open' && (
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(e.id)}
                            onChange={() => wissel(e.id)}
                          />
                        </td>
                      )}
                      <td>{datumMisschienTijd(e.date)}</td>
                      <td><strong>{e.supplier || <span className="hint">onbekend</span>}</strong></td>
                      <td>
                        <button className="kosten-open" onClick={() => setOpen(e.id)}>
                          {e.description || 'Zonder omschrijving'}
                        </button>
                        <div className="kosten-categorie">{e.category}</div>
                        {e.source === 'mail' && (
                          <div className="bon-uit-mail">
                            <Mail size={12} /> Per mail binnengekomen
                            {e.amountExcl === 0 && ' — bedrag nog invullen'}
                          </div>
                        )}
                        {e.gelezen && (
                          <div className="kosten-gelezen">
                            <ScanText size={12} /> Voorgelezen
                            {(e.gelezen.twijfel?.length ?? 0) > 0
                              && ` · ${e.gelezen.twijfel!.length} punt${e.gelezen.twijfel!.length === 1 ? '' : 'en'} van twijfel`}
                          </div>
                        )}
                        <LeesStatus bon={e} />
                        <VanzelfAkkoord bon={e} kort />
                        <Bijlage bon={e} />
                        {e.rejectReason && (
                          <div className="kosten-reden">Reden: {e.rejectReason}</div>
                        )}
                      </td>
                      <td>{e.submittedByName}</td>
                      <td className="num">{money(e.amountExcl)}</td>
                      <td className="num" style={{ color: 'var(--text-3)' }}>{money(btw)}</td>
                      <td className="num">{money(e.amountExcl + btw)}</td>
                      <td>
                        {e.status === 'open' && <Badge tone="warn">Open</Badge>}
                        {e.status === 'eerste_akkoord' && (
                          <Badge tone="warn" dot>
                            1 van 2{e.eersteDoorNaam ? ` · ${e.eersteDoorNaam}` : ''}
                          </Badge>
                        )}
                        {e.status === 'goedgekeurd' && (
                          <Badge tone="ok"><Check size={11} /> {e.approvedByName ?? 'Akkoord'}</Badge>
                        )}
                        {e.status === 'afgekeurd' && (
                          <Badge tone="danger"><X size={11} /> Afgekeurd</Badge>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {e.status === 'open' ? (
                          <>
                            <button
                              className="btn ok sm"
                              onClick={() => void keurGoed([e.id])}
                              title="Goedkeuren"
                            >
                              <Check size={14} />
                            </button>{' '}
                            <button
                              className="btn danger sm"
                              onClick={() => { setAfkeuren(e); setReden('') }}
                              title="Afkeuren"
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn ghost sm"
                            onClick={() => void expRepo.reopen(e.id).then(() => toast.info('Terug naar te valideren'))}
                            title="Heropenen"
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <BonDetail
        bon={gekozen}
        magLezen={perms.can('expenses.read')}
        onClose={() => setOpen(null)}
      />

      <Modal
        open={!!afkeuren}
        title="Kostenpost afkeuren"
        subtitle={afkeuren ? `${afkeuren.supplier} — ${money(afkeuren.amountExcl)}` : undefined}
        onClose={() => setAfkeuren(null)}
      >
        <Field label="Reden" help="De indiener ziet deze reden bij zijn kostenpost.">
          <textarea
            className="textarea"
            value={reden}
            onChange={(e) => setReden(e.target.value)}
            placeholder="Bijv. bon ontbreekt, of privé-uitgave"
            autoFocus
          />
        </Field>
        <div className="row end">
          <button className="btn ghost" onClick={() => setAfkeuren(null)}>Annuleren</button>
          <button className="btn danger" onClick={() => void keurAf()}>Afkeuren</button>
        </div>
      </Modal>
    </>
  )
}

/* ================================================================== *
 *  De bon van dichtbij, met wat eruit gelezen is
 * ================================================================== */

function BonDetail({
  bon, magLezen, onClose,
}: {
  bon: Expense | null
  magLezen: boolean
  onClose: () => void
}) {
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  async function lees() {
    if (!bon || bezig) return
    setBezig(true)
    setFout(null)
    const uit = await leesFactuur(bon.id)
    setBezig(false)
    if (!uit.ok) return setFout(uit.reden ?? 'Het lezen lukte niet.')
    toast.ok('De factuur is voorgelezen.')
    if (uit.bewaard === false) {
      toast.warn('Het lezen lukte, maar bewaren niet. Probeer het zo nog eens.')
    }
  }

  return (
    <Modal
      open={!!bon}
      title={bon?.supplier || 'Kostenpost'}
      subtitle={bon ? `${datumMisschienTijd(bon.date)} · ${money(bon.amountExcl)} excl. btw` : undefined}
      onClose={onClose}
      width={760}
    >
      {bon && (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <Bijlage bon={bon} />
            <LeesStatus bon={bon} />
            <VanzelfAkkoord bon={bon} />
            <span className="spacer" />
            {magLezen && heeftIetsTeLezen(bon) && (
              <button className="btn primary sm" disabled={bezig} onClick={() => void lees()}>
                {bezig
                  ? <><Loader2 size={14} className="spin" /> Aan het lezen…</>
                  : <><ScanText size={14} /> {bon.gelezen ? 'Opnieuw lezen' : 'Laat de factuur lezen'}</>}
              </button>
            )}
          </div>

          {!heeftIetsTeLezen(bon) && (
            <p className="hint">
              Bij deze kostenpost zit geen bijlage, dus er valt niets voor te lezen.
            </p>
          )}

          {fout && <p className="waarschuwing">{fout}</p>}

          <Overzicht bon={bon} />
          <Splitsen bon={bon} />
          <Verloop bon={bon} />
          <Boeking bon={bon} />
          <Historie bon={bon} />

          <AnimatePresence mode="wait">
            {bon.gelezen && (
              <motion.div
                key={bon.gelezen.gelezenOp}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: .22 }}
              >
                <Lezing bon={bon} lezing={bon.gelezen} />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </Modal>
  )
}

/* ----------------------- De lokale lezer -------------------------- */

/**
 * Waar een bon staat bij de lokale lezer (0049).
 *
 * Alleen iets laten zien als het veld gezet is: een bon die Claude las, of
 * die iemand met de hand invulde, heeft geen leesStatus en hoort hier stil te
 * blijven. 'klaar' toont ook niets -- dan staat er al "Voorgelezen". Wat er
 * misging staat niet hier maar in de twijfel van de lezing; de server zet het
 * daar neer, zodat het op dezelfde plek staat als bij Claude.
 */
function LeesStatus({ bon }: { bon: Expense }) {
  /*
   * Wachten en gelezen worden zijn twee verschillende dingen, en dat was niet
   * te zien: allebei stond er "wacht op de lokale lezer". Nu zegt de badge of
   * er iets gebeurt, en sinds wanneer -- dan weet je of het loopt of hangt.
   */
  if (bon.leesStatus === 'bezig') {
    const sinds = bon.leesGeclaimdAt ? Math.round((Date.now() - bon.leesGeclaimdAt) / 1000) : null
    return (
      <div style={{ marginTop: 3 }}>
        <Badge tone="brand">
          <Loader2 size={11} className="spin" /> wordt nu gelezen
          {sinds !== null && sinds < 3600 ? ` · ${sinds}s` : ''}
        </Badge>
      </div>
    )
  }
  if (bon.leesStatus === 'wacht') {
    return (
      <div style={{ marginTop: 3 }}>
        <Badge tone="info"><Clock size={11} /> wacht op de lokale lezer</Badge>
      </div>
    )
  }
  if (bon.leesStatus === 'mislukt') {
    return (
      <div style={{ marginTop: 3 }}>
        <Badge tone="danger"><AlertTriangle size={11} /> lezen mislukt</Badge>
      </div>
    )
  }
  return null
}

/**
 * Deze bon is vanzelf goedgekeurd (0050).
 *
 * Staat los van LeesStatus, want het gaat over iets anders: niet wie hem las,
 * maar wie hem akkoord gaf. En het hoort op te vallen. Een goedkeuring zonder
 * mens is precies het soort ding dat je pas mist als er een keer iets doorheen
 * glipt, dus krijgt hij een eigen badge in de rij en de hele reden in het
 * detail -- inclusief de zin waarmee de database het besloot.
 */
function VanzelfAkkoord({ bon, kort = false }: { bon: Expense; kort?: boolean }) {
  if (bon.goedkeuringBron !== 'automatisch') return null

  if (kort) {
    return (
      <div style={{ marginTop: 3 }}>
        <Badge tone="brand"><Sparkles size={11} /> vanzelf goedgekeurd</Badge>
      </div>
    )
  }

  return (
    <div className="hint" style={{ marginBottom: 14 }}>
      <Sparkles size={14} style={{ verticalAlign: -2 }} />{' '}
      <strong>Vanzelf goedgekeurd.</strong>{' '}
      {bon.goedkeuringReden
        ? bon.goedkeuringReden
        : 'Dezelfde leverancier is eerder een aantal keer voor ongeveer hetzelfde bedrag goedgekeurd.'}{' '}
      Klopt het niet, dan keur je hem alsnog af; dan is het weer mensenwerk.
    </div>
  )
}

/* -------------------------- De historie --------------------------- */

/**
 * Wat deze leverancier eerder stuurde.
 *
 * Een bon los beoordelen is lastiger dan het lijkt: is €1.240 voor Enexis
 * veel? Dat weet je pas als je ziet dat het de vorige vier keer rond de €400
 * was. Dan is dit geen bedrag maar een vraag.
 */
function Historie({ bon }: { bon: Expense }) {
  const alle = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])
  const rekeningen = useLiveQuery(
    () => db.grootboek.toArray(), [], [] as Grootboek[])

  const h = useMemo(() => historieVan(bon, alle), [bon, alle])

  if (!h.eerder.length) return null

  return (
    <Card
      title="Eerder van deze leverancier"
      hint={h.gebruikelijk
        ? `Meestal rond ${money(h.gebruikelijk)} excl. btw`
        : 'Zodat je ziet of dit bedrag in de lijn ligt'}
      className="mb"
    >
      {h.dubbel && (
        <p className="waarschuwing">
          <AlertTriangle size={14} style={{ verticalAlign: -2 }} />{' '}
          Factuurnummer <strong>{bon.factuurnummer}</strong> staat er al, van{' '}
          {dateShort(h.dubbel.date)} ({money(h.dubbel.amountExcl)}). Waarschijnlijk
          is dit dezelfde rekening die nog een keer is gestuurd.
        </p>
      )}

      {h.opmerking && !h.dubbel && (
        <p className="hint">
          <History size={14} style={{ verticalAlign: -2 }} /> {h.opmerking}
        </p>
      )}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Omschrijving</th>
              <th>Rekening</th>
              <th className="num">Excl. btw</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {h.eerder.map((e) => (
              <tr key={e.id}>
                <td>{datumMisschienTijd(e.date)}</td>
                <td className="afgekapt">{e.description || '—'}</td>
                <td className="afgekapt">{rekeningNaam(e.grootboekCode, rekeningen) || '—'}</td>
                <td className="num">{e.amountExcl > 0 ? money(e.amountExcl) : '—'}</td>
                <td>
                  {e.status === 'eerste_akkoord' && <Badge tone="warn">1 van 2</Badge>}
                  {e.status === 'goedgekeurd' && <Badge tone="ok">akkoord</Badge>}
                  {e.status === 'afgekeurd' && <Badge tone="danger">afgekeurd</Badge>}
                  {e.status === 'open' && <Badge>open</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/* --------------------------- Splitsen ----------------------------- */

/**
 * Eén factuur over meerdere rekeningen en vestigingen.
 *
 * De rekening van Enexis is voor drie vestigingen; de bon van de groothandel
 * staat half op wasmiddelen en half op klein materiaal. Dat kon tot nu toe
 * niet -- je moest hem twee keer invoeren, met twee keer hetzelfde
 * factuurnummer, wat de dubbelcontrole juist tegenhoudt.
 *
 * Geen regels betekent: het bedrag en de rekening op de bon zelf zijn de
 * boeking. Dat is verreweg het meeste, dus dit blok blijft dicht tot je hem
 * opent.
 *
 * Het optellen wordt niet per regel afgedwongen maar bij het goedkeuren. Een
 * splitsing bouw je op; zou de eis op elke regel gelden, dan is er nooit een
 * moment waarop je een tweede regel kunt toevoegen. Wel staat het verschil
 * hier de hele tijd in beeld, want dat is wat je uiteindelijk op nul wilt
 * hebben.
 */
function Splitsen({ bon }: { bon: Expense }) {
  const perms = usePerms()
  const mag = perms.can('expenses.approve') && !bon.exactId
  const [open, setOpen] = useState(false)

  const regels = useLiveQuery(
    () => db.expenseRegels.where('expenseId').equals(bon.id).toArray(),
    [bon.id], [] as ExpenseRegel[])
  const rekeningen = useLiveQuery(() => db.grootboek.toArray(), [], [] as Grootboek[])
  const vestigingen = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])

  const opVolgorde = useMemo(
    () => [...regels].sort((a, b) => a.volgorde - b.volgorde), [regels])

  const som = opVolgorde.reduce((t, r) => t + (Number(r.bedragExcl) || 0), 0)
  const verschil = Math.round((som - bon.amountExcl) * 100) / 100

  async function voegToe() {
    /* De eerste regel krijgt meteen wat er nog open staat. Negen van de tien
       keer splits je in tweeën, en dan hoef je maar één bedrag te typen. */
    await expRepo.zetRegel({
      id: uid('er'),
      expenseId: bon.id,
      volgorde: opVolgorde.length,
      omschrijving: '',
      bedragExcl: Math.max(0, Math.round((bon.amountExcl - som) * 100) / 100),
      btwPct: bon.vatPct ?? 21,
      grootboekCode: opVolgorde.length === 0 ? bon.grootboekCode : undefined,
      locationId: opVolgorde.length === 0 ? bon.locationId : undefined,
    })
  }

  async function pas(r: ExpenseRegel, patch: Partial<ExpenseRegel>) {
    try {
      await expRepo.zetRegel({ ...r, ...patch })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dat lukte niet.')
    }
  }

  if (!open && opVolgorde.length === 0) {
    return (
      <Card title="Verdeling" hint="Deze factuur staat op één rekening" className="mb">
        <div className="row">
          <span className="help" style={{ flex: 1, margin: 0 }}>
            {mag
              ? 'Hoort deze factuur bij meerdere rekeningen of vestigingen? Dan kun je hem verdelen.'
              : bon.exactId
                ? 'Deze factuur staat al in Exact; de verdeling kan niet meer wijzigen.'
                : 'Je mag de verdeling niet wijzigen.'}
          </span>
          {mag && (
            <button className="btn sm" onClick={() => { setOpen(true); void voegToe() }}>
              <Split size={14} /> Splitsen
            </button>
          )}
        </div>
      </Card>
    )
  }

  return (
    <Card
      title="Verdeling"
      hint={`${opVolgorde.length} regel${opVolgorde.length === 1 ? '' : 's'}`}
      className="mb"
      action={mag ? (
        <button className="btn ghost sm" onClick={() => void voegToe()}>
          <Plus size={14} /> Regel
        </button>
      ) : undefined}
    >
      {bon.exactId && (
        <div className="waarschuwing zacht mb">
          <span>Deze factuur staat in Exact. De verdeling ligt vast.</span>
        </div>
      )}

      <div className="verdeling">
        <div className="verdeel-kop">
          <span>Omschrijving</span>
          <span>Excl. btw</span>
          <span>Btw</span>
          <span>Rekening</span>
          <span>Vestiging</span>
          <span />
        </div>

        {opVolgorde.map((r) => (
          <div className="verdeel-regel" key={r.id}>
            <label className="verdeel-veld breed">
              <span>Omschrijving</span>
              <input
                className="input"
                defaultValue={r.omschrijving}
                disabled={!mag}
                placeholder="waarvoor"
                onBlur={(e) => { if (e.currentTarget.value !== r.omschrijving) void pas(r, { omschrijving: e.currentTarget.value }) }}
              />
            </label>

            <label className="verdeel-veld">
              <span>Excl. btw</span>
              <input
                className="input num"
                inputMode="decimal"
                defaultValue={String(r.bedragExcl ?? '')}
                disabled={!mag}
                onBlur={(e) => {
                  const v = Number(e.currentTarget.value.replace(',', '.'))
                  if (!Number.isFinite(v)) { e.currentTarget.value = String(r.bedragExcl); return }
                  if (v !== r.bedragExcl) void pas(r, { bedragExcl: v })
                }}
              />
            </label>

            <label className="verdeel-veld">
              <span>Btw</span>
              <select
                className="input"
                value={String(r.btwPct ?? 21)}
                disabled={!mag}
                onChange={(e) => void pas(r, { btwPct: Number(e.currentTarget.value) })}
              >
                {[21, 9, 0].map((p) => <option key={p} value={p}>{p}%</option>)}
              </select>
            </label>

            <label className="verdeel-veld">
              <span>Rekening</span>
              <select
                className="input"
                value={r.grootboekCode ?? ''}
                disabled={!mag}
                onChange={(e) => void pas(r, { grootboekCode: e.currentTarget.value || undefined })}
              >
                <option value="">— kies —</option>
                {rekeningen.filter((g) => g.actief || g.code === r.grootboekCode)
                  .sort((a, b) => a.code.localeCompare(b.code))
                  .map((g) => (
                    <option key={g.id} value={g.code}>{g.code} · {g.naam}</option>
                  ))}
              </select>
            </label>

            <label className="verdeel-veld">
              <span>Vestiging</span>
              <select
                className="input"
                value={r.locationId ?? ''}
                disabled={!mag}
                onChange={(e) => void pas(r, { locationId: e.currentTarget.value || undefined })}
              >
                <option value="">— van de bon —</option>
                {[...vestigingen].sort((a, b) => a.name.localeCompare(b.name)).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>

            <div>
              {mag && (
                <button
                  className="btn ghost sm"
                  title="Deze regel weghalen"
                  onClick={() => void expRepo.wisRegel(r.id)}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ---- wat er nog aan ontbreekt ---- */}

      <div className="verdeel-som">
        <span className="ts-sub op">
          Regels samen {money(som)} · op de factuur {money(bon.amountExcl)}
        </span>
        {Math.abs(verschil) < 0.005
          ? <Badge tone="ok" dot>sluit</Badge>
          : (
            <Badge tone="danger" dot>
              {verschil > 0 ? 'te veel' : 'te weinig'}: {money(Math.abs(verschil))}
            </Badge>
          )}
      </div>

      {Math.abs(verschil) >= 0.005 && (
        <p className="help" style={{ marginBottom: 0 }}>
          Zolang dit niet op nul staat kan de factuur niet worden goedgekeurd — dan zou er een
          ander bedrag naar de boekhouding gaan dan er op de factuur staat.
        </p>
      )}
    </Card>
  )
}

/* ---------------------------- Het verloop ------------------------- */

/**
 * Alles wat er met deze factuur gebeurd is, en een veld om er iets bij te
 * zetten.
 *
 * Het Overzicht hierboven leidt zijn tijdlijn af uit de velden op de bon:
 * binnengekomen, voorgelezen, goedgekeurd. Dat is de korte versie en die
 * blijft, want dat is wat je in negen van de tien gevallen wilt zien.
 *
 * Dit is de lange. Hij komt uit een tabel die door een trigger wordt
 * gevuld, en die ziet ook wat het Overzicht niet kan weten: dat iemand het
 * bedrag heeft gecorrigeerd, dat de rekening is omgezet, wie de eerste
 * handtekening zette. Precies wat je terug wilt zoeken als een boeking
 * achteraf niet klopt.
 */
function Verloop({ bon }: { bon: Expense }) {
  const user = useAuth((s) => s.user)!
  const [tekst, setTekst] = useState('')
  const [bezig, setBezig] = useState(false)

  const regels = useLiveQuery(
    () => db.expenseGebeurtenissen.where('expenseId').equals(bon.id).toArray(),
    [bon.id], [] as ExpenseGebeurtenis[])

  const opVolgorde = useMemo(
    () => [...regels].sort((a, b) => b.at - a.at), [regels])

  async function schrijf() {
    const schoon = tekst.trim()
    if (!schoon) return
    setBezig(true)
    try {
      await expRepo.notitie(bon.id, schoon, { id: user.id, name: user.name })
      setTekst('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'De notitie is niet opgeslagen.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Card title="Historie" hint="Alles wat er met deze factuur gebeurd is" className="mb">
      <Field label="Notitie" help="Voor wat de velden niet vertellen: waarom een bedrag is aangepast, wat er met de leverancier is afgesproken.">
        <div className="row">
          <input
            className="input"
            style={{ flex: 1 }}
            value={tekst}
            onChange={(e) => setTekst(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void schrijf() }}
            placeholder="Typ een notitie en druk op enter"
            disabled={bezig}
          />
          <button className="btn sm" disabled={bezig || !tekst.trim()} onClick={() => void schrijf()}>
            <MessageSquarePlus size={14} /> Toevoegen
          </button>
        </div>
      </Field>

      {opVolgorde.length === 0 && (
        <p className="help" style={{ marginBottom: 0 }}>
          Nog niets vastgelegd. Vanaf nu wordt elke wijziging aan het bedrag, de rekening,
          de leverancier en het factuurnummer hier bijgeschreven.
        </p>
      )}

      {opVolgorde.length > 0 && (
        <div className="kosten-loop">
          {opVolgorde.map((g) => (
            <div key={g.id} className="kosten-stap">
              <span className="stip" />
              <div>
                <strong>{HISTORIE_KOP[g.soort] ?? g.soort}</strong>{' '}
                <span className="mono">{dateTime(g.at)}</span>
                {g.doorNaam
                  ? <span className="kosten-door"> · {g.doorNaam}</span>
                  : <span className="kosten-door"> · door het systeem</span>}
                {g.soort === 'gewijzigd' && (
                  <div className="ts-sub">
                    {g.veld}: <span className="mono">{g.oud || '—'}</span>
                    {' → '}
                    <span className="mono">{g.nieuw || '—'}</span>
                  </div>
                )}
                {g.soort !== 'gewijzigd' && g.tekst && (
                  <div className="ts-sub">{g.tekst}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/** Hoe een gebeurtenis heet in het scherm. */
const HISTORIE_KOP: Record<string, string> = {
  aangemaakt: 'Aangemaakt',
  gewijzigd: 'Gewijzigd',
  eerste_akkoord: 'Eerste akkoord',
  goedgekeurd: 'Goedgekeurd',
  afgekeurd: 'Afgekeurd',
  heropend: 'Heropend',
  notitie: 'Notitie',
  naar_exact: 'Naar Exact',
}

/* ---------------------------- Zoeken ------------------------------ */

/**
 * Past deze bon bij wat er getypt is?
 *
 * Eén veld voor alles, want dat is hoe mensen zoeken: ze typen wat ze weten.
 * Een naam, een nummer, een bedrag. Losse velden per soort zouden
 * nauwkeuriger zijn en trager -- dan moet je eerst kiezen wát je weet.
 *
 * Meerdere woorden betekent: allemaal moeten voorkomen. Zo werkt "shell
 * maart" zoals je verwacht, in plaats van alles met "shell" OF "maart".
 *
 * Een bedrag zoeken werkt ook: 248,50 en 248.50 vinden allebei dezelfde bon,
 * want de komma is wat er op een Nederlands toetsenbord uit komt en de punt
 * is wat er in de database staat.
 */
export function pastBijZoek(bon: Expense, term: string): boolean {
  const t = term.trim().toLowerCase()
  if (!t) return true

  const hooi = [
    bon.supplier,
    bon.description,
    bon.factuurnummer,
    bon.grootboekCode,
    bon.category,
    bon.attachmentName,
    bon.submittedByName,
    bon.approvedByName,
    bon.eersteDoorNaam,
    bon.exactId,
    /* Het bedrag in beide schrijfwijzen, zodat 248,50 en 248.50 allebei
       werken. */
    String(bon.amountExcl ?? ''),
    String(bon.amountExcl ?? '').replace('.', ','),
  ].filter(Boolean).join(' ').toLowerCase()

  return t.split(/\s+/).every((woord) => hooi.includes(woord))
}

/* -------------------------- Het overzicht ------------------------- */

/**
 * Alles van deze ene bon op een rij.
 *
 * Sinds een mail met dertien bijlagen dertien losse bonnen oplevert, is de
 * vraag "waar komt deze vandaan" niet meer vanzelfsprekend te beantwoorden.
 * Dit blok zegt het: uit welke mail, welke bijlage, wanneer die binnenkwam,
 * wanneer hij gelezen is en door wie, en wat er verder over hem bekend is.
 *
 * De loop staat bovenaan en de gegevens eronder. Dat is de volgorde waarin je
 * ernaar kijkt: eerst "is hier iets geks gebeurd", dan pas de nummers.
 */
function Overzicht({ bon }: { bon: Expense }) {
  const mail = useLiveQuery(
    async () => (bon.mailboxId ? await db.mailbox.get(bon.mailboxId) : undefined),
    [bon.mailboxId],
  )
  const locaties = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const vestiging = locaties.find((l) => l.id === bon.locationId)

  /*
   * De bonnen die uit dezelfde mail komen. Bij één bijlage is dat er één en
   * laten we het weg; bij dertien wil je zien dat er dertien zijn en de
   * hoeveelste dit is.
   */
  /*
   * De bonnen uit dezelfde mail. In het geheugen gefilterd en niet met
   * where('mailboxId'): dat veld staat niet in de Dexie-index, en een where op
   * een niet-geïndexeerd veld valt om zodra je een bon opent. Het zijn er
   * hooguit een paar honderd; die staan er toch al voor de lijst erachter.
   */
  const alleBonnen = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])
  const buren = useMemo(
    () => bon.mailboxId ? alleBonnen.filter((e) => e.mailboxId === bon.mailboxId) : [],
    [alleBonnen, bon.mailboxId])

  const opVolgorde = useMemo(
    () => [...buren].sort((a, b) => a.id.localeCompare(b.id)), [buren])
  const nummer = opVolgorde.findIndex((e) => e.id === bon.id) + 1

  const lezing = bon.gelezen

  /* De loop van deze bon: alleen wat er werkelijk gebeurd is. */
  const stappen: { wat: string; wanneer: number; door?: string }[] = []
  if (mail?.at) stappen.push({ wat: 'Binnengekomen per mail', wanneer: mail.at, door: mail.vanNaam || mail.van })
  if (lezing?.gelezenOp) {
    stappen.push({
      wat: 'Voorgelezen',
      wanneer: lezing.gelezenOp,
      door: bon.lezer ?? lezing.gelezenDoor,
    })
  }
  if (bon.approvedAt) {
    stappen.push({
      wat: bon.status === 'afgekeurd' ? 'Afgekeurd' : 'Goedgekeurd',
      wanneer: bon.approvedAt,
      door: bon.approvedByName || undefined,
    })
  }
  stappen.sort((a, b) => a.wanneer - b.wanneer)

  return (
    <Card title="Overzicht" hint="Waar deze bon vandaan komt en wat ermee gebeurd is" className="mb">
      {/* ---- de loop ---- */}

      {stappen.length > 0 && (
        <div className="kosten-loop mb">
          {stappen.map((st, i) => (
            <div key={i} className="kosten-stap">
              <span className="stip" />
              <div>
                <strong>{st.wat}</strong>{' '}
                <span className="mono">{dateTime(st.wanneer)}</span>
                {st.door && <span className="kosten-door"> · {st.door}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---- waar hij vandaan komt ---- */}

      <div className="grid cols-2 mb">
        <div>
          <Veld label="Uit de mail" waarde={mail?.onderwerp} />
          <Veld label="Afzender" waarde={mail ? (mail.vanNaam ? `${mail.vanNaam} <${mail.van}>` : mail.van) : undefined} />
          <Veld label="Bezorgd op" waarde={mail?.aan} mono />
          <Veld
            label="Bijlage"
            waarde={bon.attachmentName
              ? (opVolgorde.length > 1 && nummer > 0
                  ? `${bon.attachmentName} — bon ${nummer} van ${opVolgorde.length} uit deze mail`
                  : bon.attachmentName)
              : undefined}
          />
        </div>
        <div>
          <Veld label="Vestiging" waarde={vestiging ? `${vestiging.name}${vestiging.city ? ` · ${vestiging.city}` : ''}` : undefined} />
          <Veld label="Ingediend door" waarde={bon.submittedByName || undefined} />
          <Veld label="Bron" waarde={bon.source === 'mail' ? 'Per mail binnengekomen' : bon.source === 'app' ? 'In de app ingevoerd' : undefined} />
          <Veld label="Gelezen door" waarde={bon.lezer} />
        </div>
      </div>

      {/* ---- wat er op het stuk staat ---- */}

      {lezing && (
        <div className="grid cols-3">
          <Veld label="Factuurnummer" waarde={bon.factuurnummer ?? lezing.factuurnummer} mono />
          <Veld label="Factuurdatum" waarde={lezing.datum ? dateShort(lezing.datum) : undefined} />
          <Veld label="Vervaldatum" waarde={bon.vervaldatum ? dateShort(bon.vervaldatum) : lezing.vervaldatum ? dateShort(lezing.vervaldatum) : undefined} />
          <Veld label="IBAN" waarde={lezing.iban} mono />
          <Veld label="Btw-nummer" waarde={lezing.btwNummer} mono />
          <Veld label="KvK" waarde={lezing.kvk} mono />
          <Veld label="Betalingskenmerk" waarde={lezing.betalingskenmerk} mono />
          <Veld label="Soort stuk" waarde={lezing.soort && lezing.soort !== 'onbekend' ? lezing.soort : undefined} />
          <Veld
            label="Richting"
            waarde={lezing.richting === 'inkoop' ? 'Inkoop (wij betalen)'
              : lezing.richting === 'verkoop' ? 'Verkoop (wij stuurden hem)'
              : undefined}
          />
        </div>
      )}

      {!lezing && (
        <p className="hint" style={{ margin: 0 }}>
          Deze bon is nog niet gelezen, dus er is verder nog niets over hem bekend.
        </p>
      )}

      {/* ---- de andere bonnen uit dezelfde mail ---- */}

      {opVolgorde.length > 1 && (
        <>
          <h4 style={{ marginTop: 18, marginBottom: 6 }}>
            Uit dezelfde mail ({opVolgorde.length} bonnen)
          </h4>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Bijlage</th>
                  <th>Leverancier</th>
                  <th className="num">Excl. btw</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {opVolgorde.map((e) => (
                  <tr key={e.id} className={e.id === bon.id ? 'aan' : undefined}>
                    <td className="afgekapt">
                      {e.id === bon.id && <strong>› </strong>}
                      {e.attachmentName ?? '—'}
                    </td>
                    <td className="afgekapt">{e.supplier}</td>
                    <td className="num">{e.amountExcl > 0 ? money(e.amountExcl) : '—'}</td>
                    <td>
                      {e.status === 'goedgekeurd' && <Badge tone="ok">akkoord</Badge>}
                      {e.status === 'afgekeurd' && <Badge tone="danger">afgekeurd</Badge>}
                      {e.status === 'open' && <Badge>open</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

/* --------------------------- De boeking --------------------------- */

/**
 * Waar deze bon op geboekt staat, en de mogelijkheid dat te corrigeren.
 *
 * Staat boven de lezing en niet erin, want dit is iets anders. De lezing is
 * wat er op het papier staat; dit is waar het in de boekhouding terechtkomt.
 * Dat tweede is de vraag die de accountant stelt.
 */
function Boeking({ bon }: { bon: Expense }) {
  const rekeningen = useLiveQuery(
    () => db.grootboek.toArray(), [], [] as Grootboek[])
  const tags = useLiveQuery(() => db.kostenTags.toArray(), [], [] as KostenTag[])

  const [bezig, setBezig] = useState(false)

  const bruikbaar = useMemo(
    () => rekeningen
      /*
       * Uitgezette rekeningen zijn niet te kiezen, maar de rekening die er nu
       * op staat wél -- ook als hij uit is. Anders springt een oude boeking
       * bij het openen naar leeg, en dan verander je hem per ongeluk door
       * alleen te kijken.
       */
      .filter((g) => g.actief || g.code === bon.grootboekCode)
      .sort((a, b) => a.code.localeCompare(b.code)),
    [rekeningen, bon.grootboekCode])

  const beschikbaar = useMemo(
    () => [...new Set([...tags.map((t) => t.naam), ...(bon.tags ?? [])])].sort(),
    [tags, bon.tags])

  async function kiesRekening(code: string) {
    setBezig(true)
    try {
      await zetBoeking(bon, { grootboekCode: code || undefined })
    } finally {
      setBezig(false)
    }
  }

  async function wisselTag(naam: string) {
    const huidig = bon.tags ?? []
    const nieuw = huidig.includes(naam)
      ? huidig.filter((t) => t !== naam)
      : [...huidig, naam]
    setBezig(true)
    try {
      await zetBoeking(bon, { tags: nieuw })
    } finally {
      setBezig(false)
    }
  }

  return (
    <Card title="Boeking" hint="Waar deze kosten terechtkomen" className="mb">
      {vraagtAandacht(bon) && (
        <p className="waarschuwing">
          <AlertTriangle size={14} style={{ verticalAlign: -2 }} />{' '}
          {bon.grootboekCode
            ? 'Deze rekening is geraden op trefwoorden omdat deze leverancier nog '
              + 'niet bekend was. Klopt hij, dan onthoudt het systeem hem zodra je '
              + 'goedkeurt.'
            : 'Deze bon is nog niet ingedeeld. Kies een rekening; die wordt dan '
              + 'onthouden voor de volgende factuur van deze leverancier.'}
        </p>
      )}

      <div className="grid cols-2 mb">
        <Field
          label="Grootboekrekening"
          help={bon.indelingBron ? BRON_TEKST[bon.indelingBron] : undefined}
        >
          <select
            className="select"
            value={bon.grootboekCode ?? ''}
            disabled={bezig}
            onChange={(e) => void kiesRekening(e.target.value)}
          >
            <option value="">— nog niet ingedeeld —</option>
            {bruikbaar.map((g) => (
              <option key={g.id} value={g.code}>
                {g.code} · {g.naam}{g.actief ? '' : ' (uit)'}
              </option>
            ))}
          </select>
        </Field>

        <div>
          <Veld label="Factuurnummer" waarde={bon.factuurnummer} mono />
          <Veld
            label="Vervaldatum"
            waarde={bon.vervaldatum ? dateShort(bon.vervaldatum) : undefined}
          />
          <Veld
            label="Btw volgens de factuur"
            waarde={bon.btwBedrag != null ? money(bon.btwBedrag) : undefined}
          />
        </div>
      </div>

      {beschikbaar.length > 0 && (
        <Field label="Tags" help="Waar je later op filtert; los van de rekening.">
          <div className="row">
            {beschikbaar.map((naam) => {
              const aan = (bon.tags ?? []).includes(naam)
              return (
                <button
                  key={naam}
                  className={aan ? 'btn sm ok' : 'btn ghost sm'}
                  disabled={bezig}
                  onClick={() => void wisselTag(naam)}
                >
                  {aan && <Check size={12} />} {naam}
                </button>
              )
            })}
          </div>
        </Field>
      )}

      {bruikbaar.length === 0 && (
        <p className="hint">
          <Wallet size={14} style={{ verticalAlign: -2 }} /> Er staan nog geen
          grootboekrekeningen klaar. Die stel je in bij Ontwikkeling → Inkoop.
        </p>
      )}
    </Card>
  )
}

/* --------------------------- De uitkomst -------------------------- */

function Lezing({ bon, lezing }: { bon: Expense; lezing: FactuurLezing }) {
  const voorstel = useMemo(() => voorstellen(bon, lezing), [bon, lezing])
  const optelling = regelsKloppen(lezing)
  const [bezig, setBezig] = useState(false)

  /*
   * Zelf overnemen, zonder dat er iemand klikt.
   *
   * Het scherm bood de gelezen velden aan als voorstel, regel voor regel met
   * een knop ernaast. Dat was de voorzichtige stand van het begin, en die is
   * ingehaald door de praktijk: de lezer heeft het tot nu toe altijd goed, en
   * dan is elke klik er een te veel. De post vult een bon bij binnenkomst al
   * vanzelf in; alleen wat een mens met de knop "Lezen" liet lezen bleef
   * liggen.
   *
   * De server doet dit sinds kort ook (factuur-lezen), maar dit stuk staat er
   * apart naast, om twee redenen. Bonnen die al gelezen zijn vóór die
   * wijziging staan nog steeds met nul erin, en die horen bij het openen
   * gewoon goed te komen. En werkt de server even niet, dan is de app het
   * vangnet in plaats van andersom.
   *
   * De voorwaarde is dezelfde als op de server: alleen als er nog nul in het
   * bedrag staat. Is er iets ingevuld, dan blijven de knoppen staan en kies
   * je zelf -- precies het geval waarin kiezen zin heeft.
   *
   * gedaan onthoudt dat het al is geprobeerd, zodat een mislukte poging niet
   * elke render opnieuw begint.
   */
  const gedaan = useRef<string | null>(null)

  useEffect(() => {
    if (gedaan.current === bon.id) return
    if (!nogNietIngevuld(bon) || !voorstel.length) return
    gedaan.current = bon.id
    void neemOver(voorstel, true)
    // De lijst met voorstellen verandert zodra het gelukt is; dat is het einde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bon.id, voorstel.length])

  async function neemOver(regels: Voorstel[], vanzelf = false) {
    if (!regels.length || bezig) return
    setBezig(true)
    try {
      const patch: Partial<Expense> = {}
      for (const v of regels) {
        if (v.veld === 'supplier') patch.supplier = String(v.waarde)
        if (v.veld === 'description') patch.description = String(v.waarde)
        if (v.veld === 'amountExcl') patch.amountExcl = Number(v.waarde)
        if (v.veld === 'vatPct') patch.vatPct = Number(v.waarde)
        if (v.veld === 'date') patch.date = Number(v.waarde)
        if (v.veld === 'category') patch.category = lezing.voorstelCategorie
      }
      await expRepo.update(bon.id, patch)
      toast.ok(vanzelf
        ? 'De gelezen gegevens zijn overgenomen.'
        : regels.length === 1 ? 'Overgenomen.' : `${regels.length} velden overgenomen.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Overnemen lukte niet.')
    } finally {
      setBezig(false)
    }
  }

  const excl = bedragExcl(lezing)
  const btw = btwPercentage(lezing)

  return (
    <div className="lezing">
      <div className="lezing-kop">
        <ScanText size={15} />
        <span>
          Voorgelezen {dateTime(lezing.gelezenOp)}
          {lezing.bestand ? ` uit ${lezing.bestand}` : ''}
        </span>
        {lezing.soort && lezing.soort !== 'factuur' && (
          <Badge tone="info">{lezing.soort}</Badge>
        )}
      </div>

      {lezing.gemarkeerd && (
        <p className="waarschuwing">
          De bijlagecontrole had dit bestand tegengehouden: {lezing.gemarkeerd} Het is
          wél gelezen — daarbij wordt niets uitgevoerd — maar kijk de bedragen na
          voordat je ze overneemt.
        </p>
      )}

      {/* --- waar het model over twijfelde --- */}
      {(lezing.twijfel?.length ?? 0) > 0 && (
        <div className="lezing-twijfel">
          <div className="kop"><AlertTriangle size={14} /> Hier kwam de app niet uit</div>
          <ul>
            {lezing.twijfel!.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}

      {optelling && !optelling.klopt && (
        <p className="waarschuwing">
          De regels tellen op tot {money((lezing.subtotaalExcl ?? 0) + optelling.verschil)},
          maar er staat {money(lezing.subtotaalExcl ?? 0)} als subtotaal.
          Er staat iets op de factuur dat niet in de regels terecht is gekomen.
        </p>
      )}

      {/* --- de kop van de factuur --- */}
      <div className="lezing-velden">
        <Veld label="Leverancier" waarde={lezing.leverancier} />
        <Veld label="Factuurnummer" waarde={lezing.factuurnummer} />
        <Veld label="Factuurdatum" waarde={lezing.datum ? dateShort(lezing.datum) : undefined} />
        <Veld label="Vervaldatum" waarde={lezing.vervaldatum ? dateShort(lezing.vervaldatum) : undefined} />
        <Veld label="IBAN" waarde={lezing.iban} mono />
        <Veld label="Betalingskenmerk" waarde={lezing.betalingskenmerk} mono />
        <Veld label="Btw-nummer" waarde={lezing.btwNummer} mono />
        <Veld label="KvK" waarde={lezing.kvk} mono />
      </div>

      {/* --- de regels --- */}
      {(lezing.regels?.length ?? 0) > 0 && (
        <div className="table-wrap" style={{ marginTop: 12, maxHeight: 260, overflowY: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Omschrijving</th>
                <th className="num">Aantal</th>
                <th className="num">Stukprijs</th>
                <th className="num">Btw</th>
                <th className="num">Excl.</th>
              </tr>
            </thead>
            <tbody>
              {lezing.regels!.map((r, i) => (
                <tr key={i}>
                  <td>{r.omschrijving}</td>
                  <td className="num">
                    {r.aantal != null ? `${r.aantal}${r.eenheid ? ' ' + r.eenheid : ''}` : '—'}
                  </td>
                  <td className="num">{r.stukprijs != null ? money(r.stukprijs) : '—'}</td>
                  <td className="num">{r.btwPct != null ? `${r.btwPct}%` : '—'}</td>
                  <td className="num">{r.bedragExcl != null ? money(r.bedragExcl) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Subtotaal exclusief btw</td>
                <td className="num">{lezing.subtotaalExcl != null ? money(lezing.subtotaalExcl) : '—'}</td>
              </tr>
              <tr>
                <td colSpan={4}>Btw</td>
                <td className="num">{lezing.btwBedrag != null ? money(lezing.btwBedrag) : '—'}</td>
              </tr>
              <tr>
                <td colSpan={4}><strong>Totaal inclusief</strong></td>
                <td className="num"><strong>{lezing.totaalIncl != null ? money(lezing.totaalIncl) : '—'}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* --- wat er over te nemen valt --- */}
      <div className="lezing-overnemen">
        {voorstel.length === 0 ? (
          <p className="hint">
            {excl == null && btw == null
              ? 'Er zijn geen bedragen uit dit stuk te halen om over te nemen.'
              : 'Wat hierboven staat komt overeen met wat er al bij de kostenpost staat.'}
          </p>
        ) : (
          <>
            <div className="kop">
              <Sparkles size={14} /> Overnemen naar de kostenpost
              <span className="help" style={{ fontWeight: 400, marginLeft: 8 }}>
                Er staat al iets ingevuld, dus kies zelf wat er overheen mag.
              </span>
            </div>
            <ul>
              {voorstel.map((v) => (
                <li key={String(v.veld)}>
                  <span className="l">{v.label}</span>
                  {v.huidig != null && (
                    <span className="was">
                      {typeof v.huidig === 'number' && v.veld !== 'date'
                        ? money(v.huidig)
                        : v.veld === 'date' ? dateShort(Number(v.huidig)) : String(v.huidig)}
                    </span>
                  )}
                  <span className="wordt">
                    {typeof v.waarde === 'number' && v.veld !== 'date'
                      ? money(v.waarde)
                      : v.veld === 'date' ? dateShort(Number(v.waarde)) : String(v.waarde)}
                  </span>
                  <button
                    className="btn ghost sm"
                    disabled={bezig}
                    onClick={() => void neemOver([v])}
                  >
                    Overnemen
                  </button>
                </li>
              ))}
            </ul>
            <div className="row end">
              <button
                className="btn primary sm"
                disabled={bezig}
                onClick={() => void neemOver(voorstel)}
              >
                {bezig ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                Alles overnemen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Veld({ label, waarde, mono }: { label: string; waarde?: string; mono?: boolean }) {
  if (!waarde) return null
  return (
    <div className="lezing-veld">
      <span className="l">{label}</span>
      <span className={mono ? 'w mono' : 'w'}>{waarde}</span>
    </div>
  )
}

/* ---------------------------- De bijlage -------------------------- */

function Bijlage({ bon }: { bon: Expense }) {
  const post = useLiveQuery<MailBericht | undefined>(
    async () => (bon.mailboxId ? db.mailbox.get(bon.mailboxId) : undefined),
    [bon.mailboxId],
  )
  const [kijkt, setKijkt] = useState<number | null>(null)

  /*
   * Een mail met drie bonnen eraan leverde hier één knop op, en de andere
   * twee waren nergens meer te vinden. Kwam deze bon uit de post, dan hangt
   * alles wat er bij die mail zat er nu onder.
   */
  const bijlagen = useMemo<Bekijkbaar[]>(() => {
    const uitPost: Bekijkbaar[] = (post?.attachments ?? []).map((b) => ({
      naam: b.naam,
      mime: b.mime,
      size: b.size,
      geblokkeerd: magOpenen(b)
        ? undefined
        : (b.controleReden || 'Deze bijlage kwam niet door de controle.'),
      haal: () => postbus.openBijlage(b),
    }))

    if (!bon.attachmentPath) return uitPost
    if (uitPost.some((b) => b.naam === bon.attachmentName)) return uitPost
    return [
      {
        naam: bon.attachmentName ?? 'Bijlage',
        haal: () => postbus.openBijlage({ path: bon.attachmentPath! }),
      },
      ...uitPost,
    ]
  }, [post, bon.attachmentPath, bon.attachmentName])

  if (bijlagen.length === 0) return null

  return (
    <>
      {bijlagen.map((b, i) => (
        <button key={b.naam + i} className="bon-bijlage" onClick={() => setKijkt(i)}>
          <Paperclip size={12} /> {b.naam}
        </button>
      ))}
      <Bekijker
        bestanden={bijlagen}
        index={kijkt}
        onSluiten={() => setKijkt(null)}
        onWissel={setKijkt}
      />
    </>
  )
}
