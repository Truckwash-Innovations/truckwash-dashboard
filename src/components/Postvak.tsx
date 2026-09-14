import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Archive, FolderPlus, Inbox, Loader2, Mail, MailOpen, Paperclip, PenLine,
  Reply, ReplyAll, RotateCcw, Send, Star, Trash2, Undo2, Forward, Users, X,
} from 'lucide-react'
import { db } from '../lib/db'
import {
  MAPPEN, MIJN_VAK, antwoordOp, bijlageAdres, doorsturen, draadVan, inEigenMap,
  inMap, maakMap, mappenVan, markeerGelezen, naarEigenMap, naarMap, postVan,
  verwijderMap, versturen, zetSter, zoekIn,
  type NieuwBericht, type Vak,
} from '../lib/werkpost'
import { handtekeningVoor } from '../lib/handtekening'
import { zetHandtekening } from '../lib/werkmail'
import type { MailMap, Postbus, PostbusLid, WerkMail, WerkMailMap } from '../lib/types'
import { dateTime, relative } from '../lib/format'
import { useAuth } from '../store/useAuth'
import { toast } from '../store/useToasts'
import { Badge, Card, Field, Modal } from './ui'
import { Filterbalk, LeegStaat, Zoekveld } from './ui'

/* ------------------------------------------------------------------ *
 *  Het postvak
 *
 *  Casper: "Vervolgens krijgen ze ook toegang tot een soort outlook
 *  omgeving."
 *
 *  Drie kolommen zoals iedereen ze kent: de mappen, de lijst, en het bericht.
 *  Dat is geen gebrek aan verbeelding maar het tegendeel -- dit is het enige
 *  scherm in de app waarvan mensen al weten hoe het werkt, en dat is precies
 *  wat je wilt als je Outlook vervangt.
 *
 *  Wat er anders is dan bij Outlook, en waarom
 *  -------------------------------------------
 *
 *  De tekst is plat. Geen vet, geen kleuren, geen lettertypes. Post van
 *  buiten wordt nooit als HTML getoond -- dat is de afspraak sinds de
 *  inkooppostbus (0011), en bij persoonlijke post is die nog meer waard: daar
 *  komt de rommel binnen die op een inkoopadres nooit langskomt.
 *
 *  Een gesprek staat bij elkaar, over de mappen heen. Jouw antwoord staat in
 *  Verzonden en hoort in de draad thuis; een draad die alleen laat zien wat er
 *  binnenkwam is een half gesprek.
 * ------------------------------------------------------------------ */

export default function Postvak() {
  const ik = useAuth((s) => s.user)
  const alles = useLiveQuery(() => db.werkmail.toArray(), [], [] as WerkMail[])
  const alleMappen = useLiveQuery(
    () => db.werkmailMappen.toArray(), [], [] as WerkMailMap[])
  const postbussen = useLiveQuery(() => db.postbussen.toArray(), [], [] as Postbus[])
  const leden = useLiveQuery(() => db.postbusLeden.toArray(), [], [] as PostbusLid[])

  const [vak, setVak] = useState<Vak>(MIJN_VAK)
  const [map, setMap] = useState<MailMap>('postvak')
  /* Een eigen map staat náást de vaste mappen: is deze gevuld, dan kijk je
     daarin en doet `map` even niet mee. */
  const [eigenMap, setEigenMap] = useState<string | null>(null)
  const [zoek, setZoek] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [opstellen, setOpstellen] = useState<NieuwBericht | null>(null)
  const [handtekening, setHandtekening] = useState(false)
  const [nieuweMap, setNieuweMap] = useState(false)

  /*
   * De gedeelde postvakken waar ik lid van ben.
   *
   * Uit de plaatselijke kopie en niet uit een vraag aan de server: wat hier
   * staat is wat de synchronisatie heeft opgehaald, en de database geeft me
   * alleen de postvakken waar ik bij mag (0084). Twee keer dezelfde vraag
   * stellen zou betekenen dat er een dag komt waarop ze iets anders zeggen.
   */
  const mijnVakken = useMemo(() => {
    if (!ik) return [] as Postbus[]
    const van = new Set(leden.filter((l) => l.userId === ik.id).map((l) => l.postbusId))
    return postbussen
      .filter((p) => p.actief && van.has(p.id))
      .sort((a, b) => a.naam.localeCompare(b.naam))
  }, [postbussen, leden, ik?.id])

  const magSturenHier = useMemo(() => {
    if (vak.soort === 'ik') return true
    return leden.some((l) => l.postbusId === vak.id && l.userId === ik?.id && l.magSturen)
  }, [leden, vak, ik?.id])

  const post = useMemo(() => postVan(alles, vak), [alles, vak])
  const mappen = useMemo(() => mappenVan(alleMappen, vak), [alleMappen, vak])

  const lijst = useMemo(
    () => zoekIn(eigenMap ? inEigenMap(post, eigenMap) : inMap(post, map), zoek),
    [post, map, eigenMap, zoek])
  const gekozen = open ? post.find((m) => m.id === open) ?? null : null
  const draad = gekozen ? draadVan(post, gekozen) : []

  /* Van postvak wisselen zet je terug bij Postvak IN. Blijven staan in een
     map die daar niet bestaat geeft een lege lijst waar niets mis mee is en
     die er toch uitziet alsof er post kwijt is. */
  function kiesVak(nieuw: Vak) {
    setVak(nieuw)
    setMap('postvak')
    setEigenMap(null)
    setOpen(null)
    setZoek('')
  }

  /* Openen is lezen. Niet bij het selecteren in de lijst maar bij het tonen:
     zo blijft doorbladeren met de pijltjes geen manier om alles ongelezen te
     verklaren. */
  useEffect(() => {
    if (gekozen) void markeerGelezen(gekozen)
  }, [gekozen?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const telling = useMemo(() => {
    const uit: Partial<Record<MailMap, number>> = {}
    for (const m of post) {
      if (m.map === 'postvak' && !m.mapId && !m.gelezenAt) {
        uit.postvak = (uit.postvak ?? 0) + 1
      }
    }
    return uit
  }, [post])

  /* En per eigen map, zodat je ziet waar nog iets ligt zonder hem te openen. */
  const perMap = useMemo(() => {
    const uit: Record<string, number> = {}
    for (const m of post) {
      if (m.mapId && !m.gelezenAt) uit[m.mapId] = (uit[m.mapId] ?? 0) + 1
    }
    return uit
  }, [post])

  if (!ik?.werkEmail || !ik.werkMailAan) {
    return (
      <Card title="Postvak" hint="Je eigen mailadres op het bedrijfsdomein">
        <LeegStaat
          titel="Je hebt nog geen postvak"
          uitleg="Het management kan er een aanzetten bij je dossier. Je krijgt dan
                  een adres op het bedrijfsdomein; je meldingen blijven naar je
                  eigen mailadres gaan."
          ikoon={<Mail size={20} />}
        />
      </Card>
    )
  }

  return (
    <div className="postvak">
      {/* ------------------------- de mappen ------------------------- */}

      <div className="postvak-mappen">
        <button
          className="btn primary"
          disabled={!magSturenHier}
          title={magSturenHier
            ? undefined
            : 'In dit postvak mag je meekijken maar niet versturen'}
          onClick={() => setOpstellen({
            aan: [], onderwerp: '', tekst: '',
            vanaf: vak.soort === 'gedeeld' ? vak.id : undefined,
          })}
        >
          <Send size={15} /> Nieuw bericht
        </button>

        {/* ---- welk postvak ---- */}

        {mijnVakken.length > 0 && (
          <div className="mappen-lijst postvak-keuze">
            <button
              className={`map ${vak.soort === 'ik' ? 'aan' : ''}`}
              onClick={() => kiesVak(MIJN_VAK)}
              title={ik.werkEmail}
            >
              <Inbox size={14} /> <span>Mijn post</span>
            </button>
            {mijnVakken.map((p) => (
              <button
                key={p.id}
                className={`map ${vak.soort === 'gedeeld' && vak.id === p.id ? 'aan' : ''}`}
                onClick={() => kiesVak({ soort: 'gedeeld', id: p.id })}
                title={p.adres}
              >
                <Users size={14} /> <span>{p.naam || p.adres}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mappen-lijst">
          {MAPPEN.map((m) => (
            <button
              key={m.sleutel}
              className={`map ${map === m.sleutel && !eigenMap ? 'aan' : ''}`}
              onClick={() => { setMap(m.sleutel); setEigenMap(null); setOpen(null) }}
              title={m.uitleg}
            >
              <span>{m.label}</span>
              {telling[m.sleutel] ? <Badge tone="brand">{telling[m.sleutel]}</Badge> : null}
            </button>
          ))}
        </div>

        {/* ---- eigen mappen ---- */}

        <div className="mappen-lijst">
          {mappen.map((m) => (
            <button
              key={m.id}
              className={`map ${eigenMap === m.id ? 'aan' : ''}`}
              onClick={() => { setEigenMap(m.id); setOpen(null) }}
              /* Meteen bij het slepen, zodat de map zelf de knop is. Dat is
                 hoe iedereen het van een postvak kent. */
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/plain')
                const mail = post.find((x) => x.id === id)
                if (mail) void naarEigenMap(mail, m.id)
              }}
            >
              <span>{m.naam}</span>
              {perMap[m.id] ? <Badge tone="brand">{perMap[m.id]}</Badge> : null}
            </button>
          ))}

          <button className="map nieuw" onClick={() => setNieuweMap(true)}>
            <FolderPlus size={14} /> <span>Nieuwe map</span>
          </button>
        </div>

        <div className="ts-sub" style={{ marginTop: 14, wordBreak: 'break-all' }}>
          {vak.soort === 'ik'
            ? ik.werkEmail
            : mijnVakken.find((p) => p.id === vak.id)?.adres}
        </div>

        {vak.soort === 'ik' && (
          <button
            className="btn ghost sm"
            style={{ marginTop: 8 }}
            onClick={() => setHandtekening(true)}
            title="Wat er onder elk bericht komt dat je verstuurt"
          >
            <PenLine size={14} /> Handtekening
          </button>
        )}
      </div>

      {/* ------------------------- de lijst -------------------------- */}

      <div className="postvak-lijst">
        <Filterbalk>
          <Zoekveld
            waarde={zoek}
            zet={setZoek}
            hint="Zoek op afzender, onderwerp of inhoud"
            sneltoets
          />
          {/* Een map opruimen kan alleen als je erin staat. Een kruisje bij
              elke map in de lijst zou de kolom een mijnenveld maken. */}
          {eigenMap && (
            <button
              className="btn ghost sm danger"
              title="Deze map weghalen; de post blijft staan"
              onClick={() => {
                const m = mappen.find((x) => x.id === eigenMap)
                if (!m) return
                void verwijderMap(m).then((hoeveel) => {
                  setEigenMap(null)
                  toast.ok(hoeveel
                    ? `Map weg. ${hoeveel} bericht(en) staan weer in hun vorige map.`
                    : 'Map weg.')
                })
              }}
            >
              <X size={14} /> Map weghalen
            </button>
          )}
        </Filterbalk>

        {lijst.length === 0 ? (
          <LeegStaat
            gefilterd={zoek.trim() !== ''}
            titel={zoek.trim() ? 'Niets gevonden' : 'Niets in deze map'}
            uitleg={zoek.trim()
              ? 'Pas de zoekterm aan.'
              : 'Zodra er post binnenkomt staat hij hier.'}
          />
        ) : (
          <div className="berichten">
            {lijst.map((m) => (
              <button
                key={m.id}
                className={`bericht ${open === m.id ? 'aan' : ''} ${m.gelezenAt ? '' : 'ongelezen'}`}
                onClick={() => setOpen(m.id)}
                /* Slepen naar een map links. Dat is de snelste manier om een
                   postvak op te ruimen, en de enige die mensen al kennen. */
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', m.id)}
              >
                <div className="regel">
                  <span className="wie">
                    {m.richting === 'uit'
                      ? `Aan: ${m.aan.join(', ') || '—'}`
                      : (m.vanNaam || m.van)}
                  </span>
                  <span className="wanneer">{relative(m.at)}</span>
                </div>
                <div className="onderwerp">{m.onderwerp || '(geen onderwerp)'}</div>
                <div className="flard">
                  {m.bijlagen.length > 0 && <Paperclip size={12} />}
                  {m.ster && <Star size={12} className="ster" />}
                  {m.fout && <Badge tone="danger">niet verstuurd</Badge>}
                  <span>{m.tekst.slice(0, 120)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------ het bericht ------------------------ */}

      <div className="postvak-bericht">
        {!gekozen ? (
          <LeegStaat
            titel="Kies een bericht"
            uitleg="Wat je aanklikt staat hier."
            ikoon={<MailOpen size={20} />}
          />
        ) : (
          <Bericht
            mail={gekozen}
            draad={draad}
            mappen={mappen}
            magSturen={magSturenHier}
            opAntwoord={(allen) => setOpstellen({
              ...antwoordOp(gekozen, allen),
              vanaf: vak.soort === 'gedeeld' ? vak.id : undefined,
            })}
            opDoorsturen={() => setOpstellen({
              ...doorsturen(gekozen),
              vanaf: vak.soort === 'gedeeld' ? vak.id : undefined,
            })}
          />
        )}
      </div>

      {opstellen && (
        <Opstellen
          begin={opstellen}
          sluit={() => setOpstellen(null)}
        />
      )}

      {handtekening && <Handtekening sluit={() => setHandtekening(false)} />}

      {nieuweMap && (
        <NieuweMap
          vak={vak}
          ikId={ik.id}
          sluit={() => setNieuweMap(false)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Eén bericht, met zijn gesprek eronder
 * ------------------------------------------------------------------ */

function Bericht({
  mail, draad, mappen, magSturen, opAntwoord, opDoorsturen,
}: {
  mail: WerkMail
  draad: WerkMail[]
  mappen: WerkMailMap[]
  magSturen: boolean
  opAntwoord: (allen: boolean) => void
  opDoorsturen: () => void
}) {
  const eerder = draad.filter((m) => m.id !== mail.id)

  async function verplaats(naar: MailMap) {
    try {
      await naarMap(mail, naar)
      toast.ok(naar === 'prullenbak' ? 'Naar de prullenbak.' : 'Verplaatst.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dat lukte niet.')
    }
  }

  return (
    <div className="bericht-blad">
      <div className="kop">
        <h3>{mail.onderwerp || '(geen onderwerp)'}</h3>
        <div className="acties">
          {magSturen && (
            <>
              <button className="btn sm" onClick={() => opAntwoord(false)}>
                <Reply size={14} /> Antwoorden
              </button>
              {(mail.aan.length + mail.cc.length) > 1 && (
                <button className="btn sm ghost" onClick={() => opAntwoord(true)}>
                  <ReplyAll size={14} /> Allen
                </button>
              )}
              <button className="btn sm ghost" onClick={opDoorsturen}>
                <Forward size={14} /> Doorsturen
              </button>
            </>
          )}

          {/* Naar een eigen map, voor wie niet sleept -- op een tablet is dat
              iedereen. */}
          {mappen.length > 0 && (
            <select
              className="input sm"
              value={mail.mapId ?? ''}
              onChange={(e) => void naarEigenMap(mail, e.target.value || undefined)}
              title="In welke map"
            >
              <option value="">Geen map</option>
              {mappen.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
            </select>
          )}
          <button className="btn sm ghost" onClick={() => void zetSter(mail, !mail.ster)}>
            <Star size={14} className={mail.ster ? 'ster' : ''} />
          </button>
          {mail.map !== 'archief' && (
            <button className="btn sm ghost" onClick={() => void verplaats('archief')}>
              <Archive size={14} />
            </button>
          )}
          {mail.map === 'prullenbak' ? (
            <button className="btn sm ghost" onClick={() => void verplaats('postvak')}>
              <Undo2 size={14} /> Terug
            </button>
          ) : (
            <button className="btn sm ghost" onClick={() => void verplaats('prullenbak')}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="afzender">
        <strong>{mail.vanNaam || mail.van}</strong>
        {mail.vanNaam && <span className="ts-sub"> &lt;{mail.van}&gt;</span>}
        <div className="ts-sub">
          Aan: {mail.aan.join(', ') || '—'}
          {mail.cc.length > 0 && ` · cc: ${mail.cc.join(', ')}`}
        </div>
        <div className="ts-sub">{dateTime(mail.at)}</div>
      </div>

      {mail.fout && (
        <div className="waarschuwing mb">
          <span>
            Dit bericht is niet verstuurd: {mail.fout} — het staat hier zodat je
            de tekst niet kwijt bent.
          </span>
        </div>
      )}

      {mail.hadHtml && (
        <p className="help" style={{ marginTop: 0 }}>
          Dit bericht was opgemaakt. Je ziet de tekst zonder opmaak — post van
          buiten wordt nooit als HTML getoond.
        </p>
      )}

      <pre className="mail-tekst">{mail.tekst}</pre>

      {mail.bijlagen.length > 0 && <Bijlagen mail={mail} />}

      {eerder.length > 0 && (
        <div className="draad">
          <h4>Eerder in dit gesprek ({eerder.length})</h4>
          {eerder.map((m) => (
            <div className="draad-regel" key={m.id}>
              <div className="ts-sub">
                {m.richting === 'uit' ? 'Jij' : (m.vanNaam || m.van)} · {dateTime(m.at)}
              </div>
              <pre className="mail-tekst klein">{m.tekst.slice(0, 600)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Bijlagen
 *
 *  Openen met een ondertekend adres van een minuut. Downloaden en printen
 *  doet de browser; wat wij moeten leveren is een adres dat werkt en daarna
 *  niet meer.
 * ------------------------------------------------------------------ */

function Bijlagen({ mail }: { mail: WerkMail }) {
  const [bezig, setBezig] = useState<string | null>(null)

  async function openen(pad: string, naam: string) {
    setBezig(pad)
    try {
      const adres = await bijlageAdres(pad)
      window.open(adres, '_blank', 'noopener')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${naam} is niet op te halen.`)
    } finally {
      setBezig(null)
    }
  }

  return (
    <div className="bijlagen">
      <h4>Bijlagen</h4>
      {mail.bijlagen.map((b, i) => (
        <div className="bijlage" key={i}>
          <Paperclip size={14} />
          <span className="naam">{b.naam}</span>
          <span className="ts-sub">{Math.round((b.size ?? 0) / 1024)} kB</span>
          {b.path ? (
            <button
              className="btn ghost sm"
              disabled={bezig === b.path}
              onClick={() => void openen(b.path, b.naam)}
            >
              {bezig === b.path ? <Loader2 size={13} className="spin" /> : 'Openen'}
            </button>
          ) : (
            <Badge tone="danger">tegengehouden</Badge>
          )}
        </div>
      ))}
      {mail.bijlagen.some((b) => !b.path) && (
        <p className="help" style={{ marginBottom: 0 }}>
          Een tegengehouden bijlage is niet opgeslagen. Wat er aan de hand was
          staat onderaan het bericht.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Opstellen
 * ------------------------------------------------------------------ */

function Opstellen({ begin, sluit }: { begin: NieuwBericht; sluit: () => void }) {
  const [aan, setAan] = useState(begin.aan.join(', '))
  const [cc, setCc] = useState((begin.cc ?? []).join(', '))
  const [onderwerp, setOnderwerp] = useState(begin.onderwerp)
  const [tekst, setTekst] = useState(begin.tekst)
  const [bezig, setBezig] = useState(false)

  /* Wat er straks onder het bericht komt. De serverfunctie plakt hem eronder
     (zie werkmail/index.ts); hier staat hij alleen om te laten zien. */
  const handtekening = useAuth((s) => s.user?.mailHandtekening)

  const splits = (ruw: string) =>
    ruw.split(/[,;]/).map((a) => a.trim()).filter(Boolean)

  async function verstuur() {
    setBezig(true)
    try {
      await versturen({
        aan: splits(aan),
        cc: splits(cc),
        onderwerp,
        tekst,
        antwoordOp: begin.antwoordOp,
      })
      toast.ok('Verstuurd.')
      sluit()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Versturen lukte niet.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open
      title="Nieuw bericht"
      onClose={sluit}
      width={780}
      /* Wie een mail aan het typen is, raakt hem niet kwijt door ernaast te
         klikken. Zie de kanttekening bij Modal. */
      alleenBewustSluiten
    >
      <Field label="Aan" help="Meerdere adressen met een komma ertussen.">
        <input
          className="input"
          value={aan}
          onChange={(e) => setAan(e.target.value)}
          placeholder="naam@bedrijf.nl"
          spellCheck={false}
        />
      </Field>
      <Field label="Cc">
        <input
          className="input"
          value={cc}
          onChange={(e) => setCc(e.target.value)}
          spellCheck={false}
        />
      </Field>
      <Field label="Onderwerp">
        <input
          className="input"
          value={onderwerp}
          onChange={(e) => setOnderwerp(e.target.value)}
        />
      </Field>
      <Field
        label="Bericht"
        help="Platte tekst. Dat is wat er aankomt bij iedereen, in elk mailprogramma."
      >
        <textarea
          className="textarea"
          style={{ minHeight: 240 }}
          value={tekst}
          onChange={(e) => setTekst(e.target.value)}
        />
      </Field>

      {/* Zeg dat de handtekening eronder komt. Zonder dit typt iemand zijn
          eigen groet eronder en staat er twee keer een afsluiting. */}
      {handtekening?.trim() && (
        <div className="mail-handtekening">
          <span className="ts-sub">Hieronder komt automatisch:</span>
          <pre>{handtekening.trim()}</pre>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn ghost" onClick={sluit} disabled={bezig}>Annuleren</button>
        <button
          className="btn primary"
          onClick={() => void verstuur()}
          disabled={bezig || splits(aan).length === 0}
        >
          {bezig ? <><Loader2 size={15} className="spin" /> Bezig…</> : <><Send size={15} /> Versturen</>}
        </button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 *  Je handtekening
 *
 *  Casper: "zorg dat het als tekst er komt te staan zodat je het zelf kan
 *  aanpassen."
 *
 *  Dus een tekstvak en geen velden. Wie zijn doorkiesnummer erbij wil, of
 *  "p/a Rotterdam" omdat hij daar vier dagen staat, typt het er gewoon in.
 *  Een formulier met vaste vakjes zou precies dat onmogelijk maken -- en dan
 *  gaan mensen hun eigen afsluiting bóven de handtekening typen en staat er
 *  twee keer een groet onder elke mail.
 *
 *  De knop "Standaard" zet het voorstel terug. Dat is de uitweg voor wie iets
 *  heeft weggegooid en het niet meer weet.
 * ------------------------------------------------------------------ */

function Handtekening({ sluit }: { sluit: () => void }) {
  const ik = useAuth((s) => s.user)!
  const herlaadProfiel = useAuth((s) => s.herlaadProfiel)
  const vestiging = useLiveQuery(
    () => (ik.locationId ? db.locations.get(ik.locationId) : undefined),
    [ik.locationId])

  const [tekst, setTekst] = useState(ik.mailHandtekening ?? '')
  const [bezig, setBezig] = useState(false)

  async function bewaar() {
    setBezig(true)
    try {
      await zetHandtekening(ik, tekst)
      /* Ook de sessie bijwerken, anders staat hier bij het volgende bezoek
         nog de oude tekst en lijkt het alsof het niet is opgeslagen. */
      await herlaadProfiel()
      toast.ok(tekst.trim() ? 'Handtekening bewaard' : 'Geen handtekening meer')
      sluit()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bewaren lukte niet.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal open title="Je handtekening" onClose={sluit} width={560}>
      <p className="help" style={{ marginTop: 0 }}>
        Komt onder elk bericht dat je verstuurt, met een streepje ertussen.
        Pas hem gerust aan -- wat hier staat blijft staan.
      </p>

      <Field label="Tekst">
        <textarea
          className="input"
          rows={9}
          value={tekst}
          placeholder="Met vriendelijke groet,"
          onChange={(e) => setTekst(e.target.value)}
        />
      </Field>

      <div className="row" style={{ marginTop: 14 }}>
        <button
          className="btn ghost"
          onClick={() => setTekst(handtekeningVoor(ik, vestiging?.name))}
        >
          <RotateCcw size={14} /> Standaard
        </button>
        <span className="spacer" />
        <button className="btn ghost" onClick={sluit}>Annuleren</button>
        <button className="btn primary" disabled={bezig} onClick={() => void bewaar()}>
          {bezig ? <><Loader2 size={14} className="spin" /> Bezig…</> : 'Bewaren'}
        </button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 *  Een eigen map
 *
 *  0082 zette hier een streep door en 0084 draait dat terug; in de kop van
 *  die migratie staat waarom. Wat blijft: de vaste mappen zijn niet te
 *  hernoemen en niet weg te gooien. Een eigen map komt erbij, nooit in de
 *  plaats -- anders is "Verzonden" op het ene toestel iets anders dan op het
 *  andere.
 * ------------------------------------------------------------------ */

function NieuweMap({ vak, ikId, sluit }: { vak: Vak; ikId: string; sluit: () => void }) {
  const [naam, setNaam] = useState('')
  const [bezig, setBezig] = useState(false)

  async function maak() {
    setBezig(true)
    try {
      await maakMap(vak, ikId, naam)
      toast.ok(`Map "${naam.trim()}" gemaakt`)
      sluit()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dat lukte niet.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal open title="Nieuwe map" onClose={sluit} width={420}>
      <p className="help" style={{ marginTop: 0 }}>
        {vak.soort === 'ik'
          ? 'Alleen jij ziet deze map.'
          : 'Iedereen die bij dit postvak mag, ziet deze map.'}
      </p>

      <Field label="Naam">
        <input
          className="input"
          value={naam}
          placeholder="Facturen"
          autoFocus
          onChange={(e) => setNaam(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && naam.trim()) void maak() }}
        />
      </Field>

      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={sluit}>Annuleren</button>
        <button className="btn primary" disabled={bezig || !naam.trim()} onClick={() => void maak()}>
          {bezig ? <><Loader2 size={14} className="spin" /> Bezig…</> : 'Maken'}
        </button>
      </div>
    </Modal>
  )
}
