import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle, CheckCircle2, Mail, MailX, Search, ShieldCheck, XCircle,
} from 'lucide-react'
import { db } from '../../lib/db'
import {
  laatsteMailFout, mailVrij, misluktEnTeRedden, probeerOpnieuw, wachtendePost,
  type MisluktEnTeRedden,
} from '../../lib/mail'
import { useAuth } from '../../store/useAuth'
import type { EmailLog } from '../../lib/types'
import { dateTime, relative } from '../../lib/format'
import { Badge, Card, Empty, Stat } from '../../components/ui'

/* ------------------------------------------------------------------ *
 *  Post
 *
 *  Waarom dit scherm bestaat: "ik heb niets ontvangen" is anders niet te
 *  beantwoorden. Hier zie je of de mail eruit is gegaan, wanneer, en zo
 *  niet: waarom niet.
 *
 *  De app verstuurt zelf niets. Dat doet een serverfunctie met de sleutel
 *  van Resend; deze regels zet diezelfde functie neer. Wat je hier ziet is
 *  dus wat er werkelijk is gebeurd, niet wat de app dácht te doen.
 * ------------------------------------------------------------------ */

const SJABLOON_LABEL: Record<string, string> = {
  'aanmelding': 'Aanmelding ontvangen',
  'nieuwe-aanmelding': 'Seintje aan het management',
  'aanmelding-goedgekeurd': 'Aanmelding goedgekeurd',
  'aanmelding-afgewezen': 'Aanmelding afgewezen',
  'bericht': 'Melding uit de app',
}

export default function Post() {
  const ik = useAuth((s) => s.user)
  const [q, setQ] = useState('')
  const [alleenMislukt, setAlleenMislukt] = useState(false)

  const alle = useLiveQuery(
    async () => (await db.emailLog.toArray()).sort((a, b) => b.at - a.at),
    [],
    [] as EmailLog[],
  )

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase().slice(0, 64)
    return alle
      .filter((e) => !alleenMislukt || e.status === 'mislukt')
      .filter((e) => !needle ||
        e.toEmail.toLowerCase().includes(needle) ||
        e.subject.toLowerCase().includes(needle) ||
        e.template.toLowerCase().includes(needle))
      .slice(0, 300)
  }, [alle, q, alleenMislukt])

  const dag = alle.filter((e) => e.at > Date.now() - 86_400_000)
  const mislukt = alle.filter((e) => e.status === 'mislukt')

  /* ---------------------------------------------------------------- *
   *  Kan er überhaupt post weg?
   *
   *  Casper: "Geen enkele timer is goed gelukt, geen enkele mail is
   *  verzonden??"
   *
   *  Dat was op dat moment niet te beantwoorden zonder te wachten tot er
   *  vanzelf iets verstuurd werd. Resend weigert namelijk stil: een domein
   *  dat daar niet is geverifieerd geeft geen foutmelding in de app maar een
   *  regel in dit logboek -- en die staat er pas als er iets is geprobeerd.
   *
   *  Deze knop probeert het. Eén mail naar je eigen adres, en het antwoord
   *  van Resend komt er woordelijk uit. Tien seconden in plaats van wachten
   *  tot morgenochtend.
   * ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- *
   *  Wat er sneuvelde, alsnog versturen
   *
   *  Casper: "hoe stuur ik die notify's en dingen handmatig alsnog dan?
   *  gezien ze niet gestuurd zijn door het systeem op de tijden"
   *
   *  Een melding is gemaakt en de bel in de app is gegaan; alleen de mail
   *  erover werd geweigerd. De tekst staat nog in de melding zelf, dus de
   *  mail is opnieuw op te BOUWEN -- niet na te praten uit een kopie.
   *
   *  Alleen wat sinds 0112 is verstuurd draagt zijn herkomst. Alles daarvóór
   *  staat wel in de lijst hieronder maar is niet opnieuw te maken, en dat
   *  hoort er eerlijk bij te staan.
   * ---------------------------------------------------------------- */

  const [teRedden, setTeRedden] = useState<MisluktEnTeRedden[]>([])
  const [reddenBezig, setReddenBezig] = useState(false)
  const [reddenUit, setReddenUit] = useState('')

  const haalTeRedden = useCallback(() => {
    misluktEnTeRedden().then(setTeRedden).catch(() => setTeRedden([]))
  }, [])

  useEffect(() => { haalTeRedden() }, [haalTeRedden])

  async function stuurAllesOpnieuw() {
    setReddenBezig(true)
    setReddenUit('')
    let goed = 0
    let mis = 0
    let laatsteReden = ''
    try {
      for (const rij of teRedden) {
        const uit = await probeerOpnieuw(rij)
        if (uit && uit.sent > 0) goed++
        else {
          mis++
          laatsteReden = uit?.reden || uit?.skipped || laatsteReden
        }
      }
      setReddenUit(
        mis === 0
          ? `${goed} meldingen alsnog verstuurd.`
          : `${goed} verstuurd, ${mis} nog steeds niet${laatsteReden ? ': ' + laatsteReden : '.'}`,
      )
      haalTeRedden()
    } finally {
      setReddenBezig(false)
    }
  }

  /* ---------------------------------------------------------------- *
   *  Wat de app zelf al wist
   *
   *  Casper: "Bij wijzigen rooster ect, hij stuurt bij veranderingen geen
   *  emails meer? wat wel moet..."
   *
   *  Een roosterwijziging stuurt de mail met `void mailBericht(...)` -- niet
   *  op wachten, want de bel in de app is al gegaan. Gaat die mail mis, dan
   *  gebeurt er verder niets: geen melding, geen rood, alleen een regel in de
   *  console van een tabblad dat allang dicht is.
   *
   *  Intussen bewaarde lib/mail.ts de laatste reden allang in laatsteFout,
   *  met een functie eromheen om hem op te vragen -- en die werd nergens
   *  aangeroepen. Weer een geval van: het systeem wist het en zei het niet.
   *
   *  En de wachtrij erbij. Post die op een tablet zonder bereik is opgesteld
   *  staat daar te wachten; blijft dat staan, dan is het aantal het enige dat
   *  het zegt.
   * ---------------------------------------------------------------- */

  const [mailFout, setMailFout] = useState<string | null>(null)
  const [wachtend, setWachtend] = useState(0)

  useEffect(() => {
    const lees = () => {
      setMailFout(laatsteMailFout())
      void wachtendePost().then(setWachtend)
    }
    lees()
    const klok = setInterval(lees, 5000)
    return () => clearInterval(klok)
  }, [])

  const [proefBezig, setProefBezig] = useState(false)
  const [proefUit, setProefUit] = useState('')

  async function proefmail() {
    if (!ik?.email) {
      setProefUit('Je eigen account heeft geen e-mailadres.')
      return
    }
    setProefBezig(true)
    setProefUit('')
    try {
      const uit = await mailVrij(
        ik.email,
        'Proefmail uit het dashboard',
        'Als je deze leest, komt er post weg vanaf het ingestelde domein.',
      )
      if (!uit) setProefUit('Geen verbinding met de server.')
      else if (uit.sent > 0) setProefUit(`Verstuurd naar ${ik.email}. Kijk in je postvak.`)
      else setProefUit(uit.reden || uit.skipped
        || 'Niet verstuurd, en er kwam geen reden mee.')
    } catch (e) {
      setProefUit(e instanceof Error ? e.message : String(e))
    } finally {
      setProefBezig(false)
    }
  }

  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label="Verstuurd (24 uur)" value={dag.length} icon={<Mail size={17} />} />
        <Stat
          label="Mislukt"
          value={mislukt.length}
          icon={<MailX size={17} />}
          tone={mislukt.length ? 'danger' : 'ok'}
        />
        <Stat label="Totaal vastgelegd" value={alle.length} icon={<CheckCircle2 size={17} />} />
      </div>

      <Card
        title="Kan er post weg?"
        hint="Eén proefmail naar je eigen adres, met het antwoord van Resend erbij"
        className="mb"
        action={
          <button className="btn sm" onClick={() => void proefmail()} disabled={proefBezig}>
            <Mail size={14} /> {proefBezig ? 'Bezig…' : 'Stuur een proefmail'}
          </button>
        }
      >
        {proefUit ? (
          <p style={{ margin: 0 }}>
            <strong>{proefUit}</strong>
          </p>
        ) : (
          <p className="help" style={{ margin: 0 }}>
            Gaat hij weg, dan staat het domein goed bij Resend. Gaat hij niet
            weg, dan staat hier woordelijk waarom — en dat is bijna altijd het
            domein waarvandaan wordt verstuurd, niet het adres waar hij heen
            moet.
          </p>
        )}
      </Card>

      {(mailFout || wachtend > 0) && (
        <div className="waarschuwing mb">
          <AlertTriangle size={17} />
          <span>
            {wachtend > 0 && (
              <>
                {wachtend} {wachtend === 1 ? 'mail wacht' : 'mails wachten'} op
                verzending — die zijn opgesteld zonder verbinding en gaan mee
                zodra er weer bereik is.{' '}
              </>
            )}
            {mailFout && (
              <>
                De laatste keer dat de app post probeerde te versturen kwam
                dit terug: <strong>{mailFout}</strong>
              </>
            )}
          </span>
        </div>
      )}

      {teRedden.length > 0 && (
        <Card
          title="Nog te versturen"
          hint="Meldingen die wel zijn gemaakt, maar waarvan de mail sneuvelde"
          className="mb"
          action={
            <button
              className="btn sm primary"
              onClick={() => void stuurAllesOpnieuw()}
              disabled={reddenBezig}
            >
              {reddenBezig ? 'Bezig…' : `Stuur ${teRedden.length} opnieuw`}
            </button>
          }
        >
          {reddenUit && (
            <p style={{ marginTop: 0 }}><strong>{reddenUit}</strong></p>
          )}

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Naar</th>
                  <th>Onderwerp</th>
                  <th>Waarom het misging</th>
                  <th style={{ width: 120 }}>Wanneer</th>
                </tr>
              </thead>
              <tbody>
                {teRedden.map((r) => (
                  <tr key={r.id}>
                    <td className="afgekapt">{r.naar}</td>
                    <td className="afgekapt">{r.onderwerp}</td>
                    <td className="afgekapt" style={{ color: 'var(--warn)' }}>{r.fout}</td>
                    <td style={{ color: 'var(--text-2)' }}>{relative(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="help" style={{ marginTop: 10 }}>
            De melding zelf staat er nog — de bel in de app is gegaan, alleen
            het mailtje erover niet. Hij wordt opnieuw opgebouwd uit die
            melding, dus je krijgt geen oude kopie maar wat er nú staat.
            Los eerst op waarom het misging; anders sneuvelt hij opnieuw.
          </p>
        </Card>
      )}

      {mislukt.length > 0 && (
        <div className="waarschuwing mb">
          <AlertTriangle size={17} />
          <span>
            Er is post blijven steken. Kijk bij de eerste mislukte regel wat de
            server terugkreeg — meestal is dat een sleutel die verlopen is of
            een domein dat niet meer geverifieerd staat.
          </span>
        </div>
      )}

      <Card
        title="Verstuurde post"
        hint="Wat de serverfunctie via Resend de deur uit deed"
        flush
        action={
          <div className="row" style={{ gap: 6 }}>
            <div className="chat-search" style={{ margin: 0, width: 220 }}>
              <Search size={14} />
              <input
                value={q}
                maxLength={64}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Adres of onderwerp"
              />
            </div>
            <button
              className={`btn sm ${alleenMislukt ? 'danger' : 'ghost'}`}
              onClick={() => setAlleenMislukt((v) => !v)}
            >
              Alleen mislukt
            </button>
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty
            text={alle.length === 0
              ? 'Er is nog niets verstuurd. Zodra er een aanmelding of een melding langskomt, staat het hier.'
              : 'Geen regels die hierop passen.'}
            icon={<Mail size={30} />}
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Wanneer</th>
                  <th>Aan</th>
                  <th>Soort</th>
                  <th>Onderwerp</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className="mono">{dateTime(e.at)}</span>
                      <div style={{ fontSize: '.71rem', color: 'var(--text-3)' }}>
                        {relative(e.at)}
                      </div>
                    </td>
                    <td>{e.toEmail}</td>
                    <td>
                      <Badge>{SJABLOON_LABEL[e.template] ?? e.template}</Badge>
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>
                      {e.subject}
                      {e.error && (
                        <div style={{ fontSize: '.73rem', color: 'var(--danger)', marginTop: 3 }}>
                          {e.error}
                        </div>
                      )}
                    </td>
                    <td>
                      {e.status === 'verstuurd'
                        ? <Badge tone="ok"><CheckCircle2 size={11} /> verstuurd</Badge>
                        : <Badge tone="danger"><XCircle size={11} /> mislukt</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Hoe dit werkt" className="mt">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <ShieldCheck size={17} color="var(--brand)" style={{ flex: 'none', marginTop: 2 }} />
          <div style={{ fontSize: '.86rem', color: 'var(--text-2)', lineHeight: 1.6 }}>
            <p style={{ margin: '0 0 8px' }}>
              De sleutel van Resend zit niet in deze app en hoort daar ook niet:
              alles wat je meelevert aan telefoons en laptops is uit te lezen.
              Hij staat in de functie <strong>stuur-mail</strong> bij Supabase.
            </p>
            <p style={{ margin: 0 }}>
              De app geeft die functie nooit een e-mailadres mee, maar een id —
              van een dossier of van een aanmelding. Het adres zoekt de functie
              er zelf bij. Daarmee is dit geen doorgeefluik waarmee iemand
              namens truckwash.cloud post de wereld in kan sturen.
            </p>
          </div>
        </div>
      </Card>
    </>
  )
}
