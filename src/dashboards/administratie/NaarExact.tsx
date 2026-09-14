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
 *    3. de koppelingen die er al staan, om na te kijken en terug te draaien
 *    4. wat er is doorgekomen, mislukt of blijven liggen
 *
 *  Dat laatste staat er niet voor de sier. Zolang niemand telt wat er ligt,
 *  ligt het er over een maand nog.
 *
 *  Het derde kwam er later bij, en om een vervelende reden. Een koppeling was
 *  alleen te zien zolang hij er NIET was; eenmaal gelegd verdween hij, ook als
 *  hij naar de verkeerde relatie wees. Casper kreeg van Exact terug dat
 *  "Vrienden van De Hoop" geen betalingsconditie had, op een factuur van "Van
 *  der Velden Amsterdam B.V." -- de koppeling wees naar een andere crediteur,
 *  en er was geen scherm om dat te zien of te herstellen.
 * ==================================================================== */

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, ChevronDown, Clock, Link2, Loader2, RefreshCw, Search,
  Send, X,
} from 'lucide-react'

import { Card, Empty, Field, Knop, Modal } from '../../components/ui'
import { toast } from '../../store/useToasts'
import { money, dateShort, relative } from '../../lib/format'
import {
  exactCrediteuren, exactFacturenStand, exactGeschiedenis, exactKoppelLeverancier,
  exactNietBoekbaar, exactStuurFacturen,
  type ExactCrediteur, type ExactHistorie, type FacturenStand, type NietBoekbaar,
} from '../../lib/trucksupply'
import { zetInstelling } from '../../lib/instellingen'

/* ------------------------------------------------------------------ *
 *  1. De knop
 *
 *  Casper: "Hij geeft aan dat je moet boeken? maar ik kan niks vinden."
 *
 *  Terecht, want er viel niets te vinden. Versturen kon op precies een plek
 *  -- Ontwikkeling, Exact -- en daar komt de administratie niet. Op het
 *  scherm waar je goedkeurt en waar staat wat er blijft liggen, stond geen
 *  enkele knop die er iets mee deed.
 *
 *  Zo wordt een melding als "er moet nog iets gebeuren" een raadsel: hij
 *  heeft gelijk, en er is nergens een handeling die erbij hoort.
 *
 *  De schakelaar staat erbij en niet elders
 *  ----------------------------------------
 *
 *  Versturen staat standaard uit (0058), en dat blijft zo -- hier gaan
 *  boekingen de deur uit. Maar hem alleen bij Ontwikkeling kunnen aanzetten
 *  betekent dat de administratie een knop ziet die niets doet en niet kan
 *  zien waarom. De instelling exact_facturen staat sinds 0072 in
 *  is_boekhoud_instelling(), dus de database laat dit toe; het scherm liep
 *  daarop achter.
 * ------------------------------------------------------------------ */

function Versturen({ na }: { na: () => void }) {
  const [stand, setStand] = useState<FacturenStand | null>(null)
  const [bezig, setBezig] = useState<'' | 'laden' | 'sturen' | 'schakelen'>('')
  const [fout, setFout] = useState<string | null>(null)
  const [aanzetten, setAanzetten] = useState(false)

  async function laad() {
    setBezig('laden')
    try {
      setStand(await exactFacturenStand())
      setFout(null)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'De stand is niet op te halen.')
    } finally {
      setBezig('')
    }
  }

  useEffect(() => { void laad() }, [])

  /* Klaar = alles compleet. Wat er mist staat per bon in de kaart hieronder;
     hier gaat het alleen om het aantal dat werkelijk weg kan. */
  const klaar = (stand?.wachtend ?? []).filter((b) => b.mist.length === 0)
  const stuk = (stand?.wachtend ?? []).filter((b) => b.mist.length > 0)

  async function stuur() {
    setBezig('sturen')
    try {
      const uit = await exactStuurFacturen()
      setStand(uit)
      if (uit.mislukt2.length > 0) {
        toast.error(`${uit.gelukt} verstuurd, ${uit.mislukt2.length} vastgelopen. `
          + 'De reden staat hieronder bij de factuur.')
      } else if (uit.gelukt === 0) {
        toast.info('Er ging niets weg.')
      } else {
        toast.ok(`${uit.gelukt} factuur${uit.gelukt === 1 ? '' : 'en'} naar Exact.`)
      }
      na()
    } catch (e) {
      const t = e instanceof Error ? e.message : 'Versturen lukte niet.'
      setFout(t)
      toast.error(t)
    } finally {
      setBezig('')
    }
  }

  async function schakel(aan: boolean) {
    setBezig('schakelen')
    try {
      await zetInstelling('exact_facturen', aan ? 'aan' : 'uit')
      setAanzetten(false)
      await laad()
      toast.ok(aan
        ? 'Aan. Wat compleet is kan nu naar Exact.'
        : 'Uit. Er gaat niets meer naar Exact.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dat lukte niet.')
    } finally {
      setBezig('')
    }
  }

  return (
    <>
      <Card
        title="Naar Exact sturen"
        hint="Goedkeuren zet een factuur klaar; hier gaat hij weg"
        className="mb"
        action={
          <button className="btn ghost sm" disabled={bezig !== ''} onClick={() => void laad()}>
            <RefreshCw size={14} /> Nakijken
          </button>
        }
      >
        {fout && (
          <div className="waarschuwing mb">
            <AlertTriangle size={15} /><span>{fout}</span>
          </div>
        )}

        {!stand && !fout && (
          <p className="help" style={{ margin: 0 }}>
            <Loader2 size={14} className="spin" /> Ophalen...
          </p>
        )}

        {stand && !stand.aan && (
          <div className="waarschuwing mb">
            <AlertTriangle size={15} />
            <span style={{ flex: 1 }}>
              Het versturen staat uit. Er gaat niets naar Exact, ook niet wat
              compleet is. Alles eromheen werkt wel: goedkeuren, koppelen en
              indelen kunnen gewoon door.
            </span>
          </div>
        )}

        {stand && (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button
              className="btn primary sm"
              disabled={bezig !== '' || !stand.aan || klaar.length === 0}
              onClick={() => void stuur()}
              title={!stand.aan
                ? 'Zet het versturen eerst aan'
                : klaar.length === 0
                  ? 'Er staat niets compleet klaar'
                  : undefined}
            >
              {bezig === 'sturen'
                ? <Loader2 size={14} className="spin" />
                : <Send size={14} />}
              {' '}Nu versturen ({klaar.length})
            </button>

            {stand.aan ? (
              <button
                className="btn ghost sm"
                disabled={bezig !== ''}
                onClick={() => void schakel(false)}
              >
                Versturen uitzetten
              </button>
            ) : (
              <button
                className="btn sm"
                disabled={bezig !== ''}
                onClick={() => setAanzetten(true)}
              >
                Versturen aanzetten
              </button>
            )}

            <span className="ts-sub" style={{ flex: 1, textAlign: 'right' }}>
              {klaar.length} klaar &middot; {stuk.length} blokkeert &middot; {stand.verstuurd} eerder doorgekomen
            </span>
          </div>
        )}

        {/*
          Geen stille bovengrens. De serverfunctie pakt er hoogstens 25 per
          keer -- anders loopt hij tegen zijn tijdslimiet aan en breekt hij
          halverwege af. Dat hoort hier te staan, want anders lijkt het alsof
          de rest is overgeslagen.
        */}
        {stand?.aan && klaar.length > 25 && (
          <p className="ts-sub" style={{ marginTop: 8 }}>
            Er gaan er 25 per keer. Druk daarna nog eens voor de volgende.
          </p>
        )}

        {stand?.aan && klaar.length === 0 && stuk.length > 0 && (
          <p className="ts-sub" style={{ marginTop: 8 }}>
            Er staat niets compleet klaar. Hieronder staat per factuur wat
            eraan ontbreekt.
          </p>
        )}

        {stand?.aan && klaar.length === 0 && stuk.length === 0 && (
          <p className="ts-sub" style={{ marginTop: 8 }}>
            Er is niets goedgekeurd dat nog niet in Exact staat.
          </p>
        )}
      </Card>

      {/*
        Aanzetten met een tussenstap. Dit is het enige punt in de boekhouding
        waar iets onomkeerbaars begint -- een boeking in Exact haal je niet
        terug met een knop hier.
      */}
      <Modal
        open={aanzetten}
        title="Versturen aanzetten"
        onClose={() => setAanzetten(false)}
        width={520}
      >
        <p className="help" style={{ marginTop: 0 }}>
          Vanaf nu gaat elke goedgekeurde factuur waar niets aan ontbreekt naar
          Exact zodra je op versturen drukt. Een boeking die daar eenmaal staat
          haal je niet met een knop hier terug -- dat doe je in Exact zelf.
        </p>
        <p className="help">
          Er gaat nog steeds niets vanzelf: je drukt zelf. Uitzetten kan op
          dezelfde plek.
        </p>
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <Knop soort="gewoon" onClick={() => setAanzetten(false)}>Laat maar</Knop>
          <button
            className="btn primary sm"
            disabled={bezig !== ''}
            onClick={() => void schakel(true)}
          >
            Ja, aanzetten
          </button>
        </div>
      </Modal>
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  2. Wat er niet weg kan
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
        {/*
          Hier stond "er moet ook iets klaarstaan om op te boeken", en dat las
          als een opdracht: ga ergens boeken. Casper zocht zich er suf naar.
          Het ging om het omgekeerde -- er ontbreekt iets waar Exact om
          vraagt, en zolang dat er niet is helpt drukken niet.
        */}
        <span>
          Deze zijn goedgekeurd en blijven liggen. Niet omdat er nog iemand op
          moet drukken, maar omdat er iets ontbreekt dat Exact nodig heeft.
          Hieronder staat per factuur wat.
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
 *  3. Een leverancier aan een crediteur koppelen
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
      /* De naam zoals hij op de bon staat. Kaalmaken doet de database, want
         daar staat ook de join die hem straks moet terugvinden -- zie de
         serverfunctie. Hier stond een nagebouwde kaal_bedrijf() die bij elke
         B.V. een andere uitkomst gaf, en dan koppel je iets wat niemand meer
         opzoekt. */
      await exactKoppelLeverancier(leverancier, c.exactId, bv, leverancier)
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

/* ------------------------------------------------------------------ *
 *  3b. De koppelingen die er al staan
 *
 *  Een verkeerde koppeling is niet zichtbaar aan de factuur. Die ziet er
 *  compleet uit -- leverancier bekend, crediteur bekend -- en gaat mee. Pas
 *  in Exact blijkt het, als het al blijkt: Casper zag het doordat de boeking
 *  toevallig op iets anders strandde en de melding een vreemde naam noemde.
 *
 *  Dus twee namen naast elkaar, altijd: hoe de leverancier op de bon heet en
 *  hoe de crediteur in Exact heet. Lijken ze niet op elkaar, dan staat er een
 *  vlaggetje bij en komt hij bovenaan. Dat is een aanwijzing om te kijken,
 *  geen oordeel -- "Shell Nederland Verkoopmaatschappij" en "Shell" horen bij
 *  elkaar en delen geen hele naam, en een bv mag haar crediteuren noemen zoals
 *  ze wil. Er wordt hier dus niets geweigerd of stilgezet.
 * ------------------------------------------------------------------ */

/**
 * Delen deze twee namen een woord dat ergens op slaat?
 *
 * Woorden van drie letters of korter tellen niet mee: "de", "van", "b.v." en
 * "nv" staan in half Nederland en zouden alles op elkaar laten lijken. Het
 * omgekeerde -- geen enkel gedeeld woord -- is wat we zoeken.
 */
function lijktOp(a: string, b: string): boolean {
  const woorden = (t: string) => new Set(
    t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3))
  const links = woorden(a)
  if (links.size === 0) return true
  for (const w of woorden(b)) if (links.has(w)) return true
  return false
}

function Koppelingen({ sleutel, koppel }: {
  sleutel: number
  koppel: (leverancier: string, bv: string) => void
}) {
  const [stand, setStand] = useState<FacturenStand | null>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [zoek, setZoek] = useState('')

  async function laad() {
    setBezig(true)
    try {
      setStand(await exactFacturenStand())
      setFout(null)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'De koppelingen zijn niet op te halen.')
    } finally {
      setBezig(false)
    }
  }

  useEffect(() => { void laad() }, [sleutel])

  const lijst = useMemo(() => {
    const alle = stand?.koppelingen ?? []
    const t = zoek.trim().toLowerCase()
    return alle
      .filter((k) => !t
        || (k.gezienAls || k.zoeknaam).toLowerCase().includes(t)
        || k.exactNaam.toLowerCase().includes(t)
        || k.administratie.toLowerCase().includes(t))
      .map((k) => ({ ...k, naam: k.gezienAls || k.zoeknaam }))
      .map((k) => ({ ...k, vreemd: !lijktOp(k.naam, k.exactNaam) }))
      /* De vreemde bovenaan: dat is waar je naar op zoek bent. */
      .sort((a, b) => Number(b.vreemd) - Number(a.vreemd)
        || a.naam.localeCompare(b.naam, 'nl')
        || a.administratie.localeCompare(b.administratie))
  }, [stand, zoek])

  const vreemd = lijst.filter((k) => k.vreemd).length

  async function los(k: { naam: string; administratie: string; exactNaam: string }) {
    setBezig(true)
    try {
      /* Loskoppelen is exactId leeg meesturen, en alleen in deze bv. */
      await exactKoppelLeverancier(k.naam, null, k.administratie, k.naam)
      toast.ok(`${k.naam} is in ${k.administratie} losgekoppeld van ${k.exactNaam}.`)
      await laad()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Loskoppelen lukte niet.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Card
      title="Wie aan wie hangt"
      hint="Welke leverancier op welke crediteur in Exact wordt geboekt"
      className="mb"
      action={
        <button className="btn ghost sm" disabled={bezig} onClick={() => void laad()}>
          <RefreshCw size={14} /> Nakijken
        </button>
      }
    >
      {fout && (
        <div className="waarschuwing mb">
          <AlertTriangle size={15} /><span>{fout}</span>
        </div>
      )}

      {!stand && !fout && (
        <p className="help" style={{ margin: 0 }}>
          <Loader2 size={14} className="spin" /> Ophalen...
        </p>
      )}

      {stand && stand.koppelingen.length === 0 && (
        <Empty text="Er is nog geen enkele leverancier aan een crediteur gekoppeld." />
      )}

      {stand && stand.koppelingen.length > 0 && (
        <>
          {vreemd > 0 && (
            <div className="waarschuwing mb">
              <AlertTriangle size={15} />
              <span>
                Bij {vreemd} koppeling{vreemd === 1 ? '' : 'en'} lijkt de naam van de
                crediteur in Exact niet op die van de leverancier. Dat hoeft niet
                fout te zijn, maar het is wel waar een verkeerde koppeling op lijkt --
                en die boekt de factuur bij een ander op de rekening. Ze staan bovenaan.
              </span>
            </div>
          )}

          <Field label="Zoeken">
            <input
              className="input"
              placeholder="Leverancier, crediteur of bv"
              value={zoek}
              onChange={(e) => setZoek(e.target.value)}
            />
          </Field>

          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Leverancier op de bon</th>
                  <th style={{ width: 80 }}>Bv</th>
                  <th>Wordt geboekt op</th>
                  <th style={{ width: 210 }}>Wijzigen</th>
                </tr>
              </thead>
              <tbody>
                {lijst.slice(0, 60).map((k) => (
                  <tr key={`${k.administratie}-${k.zoeknaam}`}>
                    <td className="afgekapt">
                      {k.vreemd && (
                        <AlertTriangle
                          size={13}
                          style={{ verticalAlign: -2, marginRight: 4, color: 'var(--warn)' }}
                        />
                      )}
                      {k.naam || '—'}
                    </td>
                    <td className="mono">{k.administratie}</td>
                    <td className="afgekapt">
                      {k.exactNaam || '—'}
                      <div className="ts-sub">
                        {k.bron === 'handmatig' ? 'met de hand' : 'automatisch'}
                        {k.door ? ` · ${k.door}` : ''}
                        {k.at ? ` · ${relative(k.at)}` : ''}
                      </div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          className="btn ghost sm"
                          disabled={bezig}
                          onClick={() => koppel(k.naam, k.administratie)}
                        >
                          <Link2 size={13} /> Andere
                        </button>
                        <button
                          className="btn ghost sm"
                          disabled={bezig}
                          onClick={() => void los(k)}
                        >
                          <X size={13} /> Los
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {lijst.length > 60 && (
            <p className="ts-sub" style={{ marginTop: 6 }}>
              en nog {lijst.length - 60}. Typ een deel van de naam om te zoeken.
            </p>
          )}
        </>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 *  4. Wat er is gebeurd
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
  /* Gaat omhoog na elke koppeling, zodat de lijst met koppelingen zichzelf
     opnieuw ophaalt zonder dat die kaart iets van deze hoeft te weten. */
  const [ronde, setRonde] = useState(0)

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

      <Versturen na={() => void haal()} />

      <Blokkades
        bonnen={blokkades}
        bezig={bezig}
        opnieuw={() => void haal()}
        koppel={(leverancier, bv) => setKoppel({ leverancier, bv })}
      />

      <Koppelingen
        sleutel={ronde}
        koppel={(leverancier, bv) => setKoppel({ leverancier, bv })}
      />

      <Geschiedenis historie={historie} bezig={bezig} opnieuw={() => void haal()} />

      <Koppelen
        open={koppel !== null}
        leverancier={koppel?.leverancier ?? ''}
        bv={koppel?.bv ?? ''}
        sluit={() => setKoppel(null)}
        klaar={() => { setRonde((n) => n + 1); void haal() }}
      />
    </>
  )
}
