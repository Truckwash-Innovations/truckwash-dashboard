import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Archive, Loader2, Mail, MailOpen, Paperclip, PenLine, Reply, ReplyAll,
  RotateCcw, Send, Star, Trash2, Undo2, Forward,
} from 'lucide-react'
import { db } from '../lib/db'
import {
  MAPPEN, antwoordOp, bijlageAdres, doorsturen, draadVan, inMap, markeerGelezen,
  naarMap, versturen, zetSter, zoekIn, type NieuwBericht,
} from '../lib/werkpost'
import { handtekeningVoor } from '../lib/handtekening'
import { zetHandtekening } from '../lib/werkmail'
import type { MailMap, WerkMail } from '../lib/types'
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
  const post = useLiveQuery(() => db.werkmail.toArray(), [], [] as WerkMail[])

  const [map, setMap] = useState<MailMap>('postvak')
  const [zoek, setZoek] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [opstellen, setOpstellen] = useState<NieuwBericht | null>(null)
  const [handtekening, setHandtekening] = useState(false)

  const lijst = useMemo(() => zoekIn(inMap(post, map), zoek), [post, map, zoek])
  const gekozen = open ? post.find((m) => m.id === open) ?? null : null
  const draad = gekozen ? draadVan(post, gekozen) : []

  /* Openen is lezen. Niet bij het selecteren in de lijst maar bij het tonen:
     zo blijft doorbladeren met de pijltjes geen manier om alles ongelezen te
     verklaren. */
  useEffect(() => {
    if (gekozen) void markeerGelezen(gekozen)
  }, [gekozen?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const telling = useMemo(() => {
    const uit: Partial<Record<MailMap, number>> = {}
    for (const m of post) {
      if (m.map === 'postvak' && !m.gelezenAt) uit.postvak = (uit.postvak ?? 0) + 1
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
        <button className="btn primary" onClick={() => setOpstellen({
          aan: [], onderwerp: '', tekst: '',
        })}>
          <Send size={15} /> Nieuw bericht
        </button>

        <div className="mappen-lijst">
          {MAPPEN.map((m) => (
            <button
              key={m.sleutel}
              className={`map ${map === m.sleutel ? 'aan' : ''}`}
              onClick={() => { setMap(m.sleutel); setOpen(null) }}
              title={m.uitleg}
            >
              <span>{m.label}</span>
              {telling[m.sleutel] ? <Badge tone="brand">{telling[m.sleutel]}</Badge> : null}
            </button>
          ))}
        </div>

        <div className="ts-sub" style={{ marginTop: 14, wordBreak: 'break-all' }}>
          {ik.werkEmail}
        </div>

        <button
          className="btn ghost sm"
          style={{ marginTop: 8 }}
          onClick={() => setHandtekening(true)}
          title="Wat er onder elk bericht komt dat je verstuurt"
        >
          <PenLine size={14} /> Handtekening
        </button>
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
            opAntwoord={(allen) => setOpstellen(antwoordOp(gekozen, allen))}
            opDoorsturen={() => setOpstellen(doorsturen(gekozen))}
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
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Eén bericht, met zijn gesprek eronder
 * ------------------------------------------------------------------ */

function Bericht({
  mail, draad, opAntwoord, opDoorsturen,
}: {
  mail: WerkMail
  draad: WerkMail[]
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
