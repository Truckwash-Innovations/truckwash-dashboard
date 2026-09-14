/* ==================================================================== *
 *  Naar Exact: wat ligt er, wat blokkeert, en wat is er doorgekomen
 *
 *  Casper: "Hij wilt niks naar exact sturen. (...) Nu is het te onduidelijk,
 *  en werkt het gewoon niet." En daarna: "Kan je zorgen dat je ook de
 *  geschiedenis van exact kan zien, zodat je weet wat er door is gekomen ect?
 *  zodat alles zichtbaar is, en je niks kan missen."
 *
 *  Waarom er niets ging, en waarom dat nergens stond
 *  -------------------------------------------------
 *
 *  De verzendlus draait over goedgekeurde bonnen waar niets aan ontbreekt, en
 *  die lijst was in de praktijk altijd leeg: elke bon miste 'crediteur'. Het
 *  automatisch koppelen sloeg alleen toe bij precies één match over ALLE bv's
 *  heen, en met ruim twintig bv's staat dezelfde leverancier er twintig keer
 *  in. Koppelen met de hand kon nergens -- de serveractie bestond, maar geen
 *  enkel scherm riep hem aan.
 *
 *  En op het scherm waar je goedkeurt stond niet dát er iets bleef liggen, en
 *  al helemaal niet waarom. Een vastgelopen factuur zag eruit als een die net
 *  was goedgekeurd. Dat is hoe "hij wilt niks naar exact sturen" ontstaat
 *  zonder dat er ergens een foutmelding staat.
 *
 *  Drie stukken, in de volgorde waarin je ze nodig hebt
 *  ----------------------------------------------------
 *
 *    1. wat er blokkeert, met per bon de reden en wat je eraan doet
 *    2. de leveranciers die nog aan een crediteur moeten -- hier, niet elders
 *    3. wat er is doorgekomen, mislukt of blijven liggen
 *
 *  Dat derde staat er niet voor de sier. Zolang niemand telt wat er ligt, ligt
 *  het er over een maand nog.
 * ==================================================================== */

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, ChevronDown, Clock, Link2, Loader2, RefreshCw, Search, X,
} from 'lucide-react'

import { Card, Empty, Field, Knop, Modal } from '../../components/ui'
import { toast } from '../../store/useToasts'
import { money, dateShort, relative } from '../../lib/format'
import {
  exactCrediteuren, exactGeschiedenis, exactKoppelLeverancier, exactNietBoekbaar,
  type ExactCrediteur, type ExactHistorie, type NietBoekbaar,
} from '../../lib/trucksupply'

/* ------------------------------------------------------------------ *
 *  1. Wat er niet weg kan
 * ------------------------------------------------------------------ */

/**
 * Welke bonnen blijven liggen, en waarom.
 *
 * De reden komt uit de database (bon_niet_boekbaar, 0086) en niet uit een
 * gok hier: daar staat de hele keten bij elkaar -- bv, rekening in díe bv,
 * crediteur, dagboek, btw-code -- en het zou uit de pas lopen zodra er een
 * voorwaarde bij komt.
 */
function Blokkades({
  bonnen, bezig, opnieuw, koppel,
}: {
  bonnen: NietBoekbaar[]
  bezig: boolean
  opnieuw: () => void
  koppel: (leverancier: string, bv: string) => void
}) {
  if (!bonnen.length) {
    return (
      <Card title="Wat er nog blokkeert" className="mb">
        <div className="row">
          <Check size={16} style={{ color: 'var(--ok)' }} />
          <span style={{ flex: 1 }}>
            Niets. Alles wat is goedgekeurd kan naar Exact.
          </span>
          <button className="btn ghost sm" disabled={bezig} onClick={opnieuw}>
            <RefreshCw size={14} /> Nakijken
          </button>
        </div>
      </Card>
    )
  }

  /* Per soort tekort bij elkaar. Twintig keer "crediteur ontbreekt" is één
     boodschap en geen twintig regels waar je doorheen moet. */
  const perSoort = new Map<string, NietBoekbaar[]>()
  for (const b of bonnen) {
    const sleutel = b.wat[0] ?? 'onbekend'
    perSoort.set(sleutel, [...(perSoort.get(sleutel) ?? []), b])
  }

  return (
    <Card
      title="Wat er nog blokkeert"
      hint={`${bonnen.length} goedgekeurde factuur${bonnen.length === 1 ? '' : 'en'} kan niet naar Exact`}
      className="mb"
      action={
        <button className="btn ghost sm" disabled={bezig} onClick={opnieuw}>
          <RefreshCw size={14} /> Nakijken
        </button>
      }
    >
      <div className="waarschuwing mb">
        <AlertTriangle size={15} />
        <span>
          Deze zijn goedgekeurd en blijven liggen. Goedkeuren is niet de laatste
          stap — er moet ook iets klaarstaan om op te boeken.
        </span>
      </div>

      {[...perSoort.entries()].map(([soort, lijst]) => (
        <div key={soort} style={{ marginBottom: 14 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: '.88rem' }}>
              {lijst.length}× {soort}
            </strong>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Leverancier</th>
                  <th style={{ width: 90 }}>Bv</th>
                  <th className="num" style={{ width: 110 }}>Bedrag</th>
                  <th>Wat je eraan doet</th>
                </tr>
              </thead>
              <tbody>
                {lijst.slice(0, 12).map((b) => (
                  <tr key={b.id}>
                    <td className="afgekapt">{b.leverancier || '—'}</td>
                    <td className="mono">{b.administratie ?? '—'}</td>
                    <td className="num">{money(b.bedrag)}</td>
                    <td>
                      <div className="ts-sub">{b.reden}</div>
                      {soort === 'crediteur' && b.administratie && (
                        <button
                          className="btn ghost sm"
                          style={{ marginTop: 4 }}
                          onClick={() => koppel(b.leverancier, b.administratie!)}
                        >
                          <Link2 size={13} /> Koppelen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lijst.length > 12 && (
            <p className="ts-sub" style={{ marginTop: 4 }}>
              en nog {lijst.length - 12} met hetzelfde tekort.
            </p>
          )}
        </div>
      ))}
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 *  2. Een leverancier aan een crediteur koppelen
 * ------------------------------------------------------------------ */

/**
 * Het venster dat er niet was.
 *
 * De serveractie 'koppel-leverancier' bestaat sinds 0058 en werd door geen
 * enkel scherm aangeroepen. Het ontwikkelaarsscherm zei zelfs letterlijk
 * "Meestal is de leverancier nog niet aan een crediteur in Exact gekoppeld"
 * en bood daarna geen knop -- een dood spoor.
 *
 * De bv staat vast en is niet te kiezen: hij komt van de bon. Een crediteur
 * uit een andere administratie koppelen is geen keuze maar een fout, en de
 * server weigert hem ook.
 */
function Koppelen({
  open, leverancier, bv, sluit, klaar,
}: {
  open: boolean
  leverancier: string
  bv: string
  sluit: () => void
  klaar: () => void
}) {
  const [zoek, setZoek] = useState('')
  const [lijst, setLijst] = useState<ExactCrediteur[] | null>(null)
  const [afgekapt, setAfgekapt] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  /* Bij het openen meteen zoeken op de naam van de leverancier. Negen van de
     tien keer staat hij er precies zo in, en dan is dit één klik. */
  useEffect(() => {
    if (!open) return
    setZoek(leverancier)
    setFout(null)
  }, [open, leverancier])

  useEffect(() => {
    if (!open || !bv) return
    let weg = false
    setLijst(null)
    const t = setTimeout(() => {
      void exactCrediteuren(bv, zoek)
        .then((r) => { if (!weg) { setLijst(r.crediteuren); setAfgekapt(r.afgekapt) } })
        .catch((e) => { if (!weg) setFout(e instanceof Error ? e.message : 'Niet op te halen.') })
    }, 250)
    return () => { weg = true; clearTimeout(t) }
  }, [open, bv, zoek])

  async function kies(c: ExactCrediteur) {
    setBezig(true)
    setFout(null)
    try {
      await exactKoppelLeverancier(kaal(leverancier), c.exactId, bv, leverancier)
      toast.ok(`${leverancier} is in ${bv} gekoppeld aan ${c.naam}.`)
      klaar()
      sluit()
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Koppelen lukte niet.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal open={open} title={`${leverancier} koppelen`} onClose={sluit} width={640}>
      <p className="help" style={{ marginTop: 0 }}>
        In welke crediteur van <strong>{bv}</strong> hoort deze leverancier? Een
        crediteur bestaat in één administratie; dezelfde leverancier heeft in
        elke bv een ander nummer. Wat je hier kiest geldt dus alleen voor {bv}.
      </p>

      {fout && <div className="waarschuwing mb"><AlertTriangle size={14} /><span>{fout}</span></div>}

      <Field label="Zoeken">
        <div className="row" style={{ gap: 6 }}>
          <Search size={15} style={{ flex: 'none', color: 'var(--text-3)' }} />
          <input
            className="input"
            value={zoek}
            autoFocus
            placeholder="naam van de crediteur"
            onChange={(e) => setZoek(e.currentTarget.value)}
          />
        </div>
      </Field>

      <div style={{ maxHeight: 330, overflowY: 'auto', marginTop: 10 }}>
        {lijst === null && (
          <p className="help"><Loader2 size={14} className="spin" /> Zoeken…</p>
        )}
        {lijst !== null && lijst.length === 0 && (
          <Empty text={zoek
            ? `Geen crediteur in ${bv} met "${zoek}" in de naam. Staat hij er wel, haal dan de relaties opnieuw op.`
            : `Er zijn nog geen crediteuren opgehaald voor ${bv}.`} />
        )}
        {(lijst ?? []).map((c) => (
          <button
            key={c.exactId}
            className="keuzerij"
            disabled={bezig}
            onClick={() => void kies(c)}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{c.naam}</strong>
              <div className="ts-sub">
                {[c.code, c.plaats, c.btwNummer].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <Link2 size={15} />
          </button>
        ))}
      </div>

      {afgekapt && (
        <p className="ts-sub" style={{ marginTop: 8 }}>
          Er zijn er meer dan hier passen. Typ een deel van de naam om te zoeken.
        </p>
      )}
    </Modal>
  )
}

/** "Shell Nederland B.V." -> "shell nederland", zoals kaal_bedrijf() in de database. */
function kaal(naam: string): string {
  return naam
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+(bvba|bv|nv|vof|cv|gmbh|ltd|inc|sa)$/, '')
    .trim()
}

/* ------------------------------------------------------------------ *
 *  3. Wat er is gebeurd
 * ------------------------------------------------------------------ */

const STAND_TEKST: Record<string, string> = {
  geboekt: 'Doorgekomen',
  mislukt: 'Vastgelopen',
  wacht: 'Ligt nog',
}

function Geschiedenis({ historie, bezig, opnieuw }: {
  historie: ExactHistorie | null
  bezig: boolean
  opnieuw: () => void
}) {
  const [alles, setAlles] = useState(false)
  const k = historie?.kort

  const regels = useMemo(
    () => (historie?.regels ?? []).slice(0, alles ? 200 : 20),
    [historie, alles])

  return (
    <Card
      title="Wat er naar Exact ging"
      hint="Doorgekomen, vastgelopen en blijven liggen — inkoop en verkoop"
      className="mb"
      action={
        <button className="btn ghost sm" disabled={bezig} onClick={opnieuw}>
          <RefreshCw size={14} /> Vernieuwen
        </button>
      }
    >
      {k && (
        <div className="grid cols-3 mb">
          <div>
            <div className="ts-sub">Doorgekomen</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 650 }}>{k.geboekt}</div>
            <div className="ts-sub">{money(k.geboektBedrag)}</div>
          </div>
          <div>
            <div className="ts-sub">Vastgelopen</div>
            <div style={{
              fontSize: '1.3rem', fontWeight: 650,
              color: k.mislukt > 0 ? 'var(--warn)' : undefined,
            }}>
              {k.mislukt}
            </div>
            <div className="ts-sub">{k.mislukt ? 'met een reden erbij' : '—'}</div>
          </div>
          <div>
            <div className="ts-sub">Ligt nog</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 650 }}>{k.wacht}</div>
            <div className="ts-sub">
              {/* De oudste erbij. Een factuur van drie maanden geleden die er
                  nog staat is een ander verhaal dan een van gisteren -- en dat
                  verschil zie je niet aan een aantal. */}
              {k.wacht
                ? `${money(k.wachtBedrag)}${k.oudsteWacht ? `, oudste van ${dateShort(k.oudsteWacht)}` : ''}`
                : '—'}
            </div>
          </div>
        </div>
      )}

      {!historie && <p className="help"><Loader2 size={14} className="spin" /> Ophalen…</p>}

      {historie && regels.length === 0 && (
        <Empty text="Er is nog niets naar Exact gegaan." />
      )}

      {regels.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 108 }}>Wanneer</th>
                <th style={{ width: 104 }}>Stand</th>
                <th>Wie</th>
                <th style={{ width: 80 }}>Bv</th>
                <th className="num" style={{ width: 104 }}>Bedrag</th>
                <th>Boeking</th>
              </tr>
            </thead>
            <tbody>
              {regels.map((r) => (
                <tr key={`${r.richting}-${r.id}`}>
                  <td className="ts-sub">{r.at ? relative(r.at) : '—'}</td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        color: r.stand === 'geboekt' ? 'var(--ok)'
                          : r.stand === 'mislukt' ? 'var(--warn)' : undefined,
                      }}
                    >
                      {r.stand === 'geboekt' && <Check size={12} />}
                      {r.stand === 'mislukt' && <X size={12} />}
                      {r.stand === 'wacht' && <Clock size={12} />}
                      {' '}{STAND_TEKST[r.stand]}
                    </span>
                  </td>
                  <td className="afgekapt">
                    {r.wie || '—'}
                    <div className="ts-sub">
                      {r.richting === 'verkoop' ? 'verkoop' : 'inkoop'}
                      {r.nummer ? ` · ${r.nummer}` : ''}
                    </div>
                  </td>
                  <td className="mono">{r.administratie ?? '—'}</td>
                  <td className="num">{money(r.bedrag)}</td>
                  <td>
                    {r.boeking
                      ? <span className="mono ts-sub">{r.boeking}</span>
                      : r.reden
                        ? <span className="ts-sub" style={{ color: 'var(--warn)' }}>{r.reden}</span>
                        : <span className="ts-sub">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(historie?.regels.length ?? 0) > 20 && !alles && (
        <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setAlles(true)}>
          <ChevronDown size={14} /> Alles tonen ({historie!.regels.length})
        </button>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 *  Het geheel
 * ------------------------------------------------------------------ */

export function NaarExact({ verbonden }: { verbonden: boolean }) {
  const [blokkades, setBlokkades] = useState<NietBoekbaar[]>([])
  const [historie, setHistorie] = useState<ExactHistorie | null>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [koppel, setKoppel] = useState<{ leverancier: string; bv: string } | null>(null)

  async function haal() {
    setBezig(true)
    setFout(null)
    try {
      const [b, h] = await Promise.all([exactNietBoekbaar(), exactGeschiedenis()])
      setBlokkades(b)
      setHistorie(h)
    } catch (e) {
      /*
       * Niet stilzwijgend doorslikken. Hier stond in Kostenposten een lege
       * catch, en daardoor zag een 403 van de rechtencontrole er hetzelfde
       * uit als "er is niets" -- op precies het scherm dat moest zeggen dat
       * er iets vastzat.
       */
      setFout(e instanceof Error ? e.message : 'De stand is niet op te halen.')
    } finally {
      setBezig(false)
    }
  }

  useEffect(() => { if (verbonden) void haal() }, [verbonden])

  if (!verbonden) {
    return (
      <Card title="Naar Exact" className="mb">
        <Empty text="Er is nog geen koppeling met Exact." />
      </Card>
    )
  }

  return (
    <>
      {fout && (
        <div className="waarschuwing mb">
          <AlertTriangle size={15} />
          <span style={{ flex: 1 }}>{fout}</span>
          <Knop soort="gewoon" onClick={() => void haal()}>Opnieuw</Knop>
        </div>
      )}

      <Blokkades
        bonnen={blokkades}
        bezig={bezig}
        opnieuw={() => void haal()}
        koppel={(leverancier, bv) => setKoppel({ leverancier, bv })}
      />

      <Geschiedenis historie={historie} bezig={bezig} opnieuw={() => void haal()} />

      <Koppelen
        open={koppel !== null}
        leverancier={koppel?.leverancier ?? ''}
        bv={koppel?.bv ?? ''}
        sluit={() => setKoppel(null)}
        klaar={() => void haal()}
      />
    </>
  )
}
