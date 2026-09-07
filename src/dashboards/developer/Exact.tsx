/* ===========================================================================
 *  Exact -- de sleutels van de koppeling
 *
 *  De vraag van Casper: "ik heb nu een exact dev account, dus niet de
 *  realtime, zorg dat je dit makkelijk in het dashboard bij ontwikkelaar kan
 *  aanpassen dan wel aub, exact doet nu moeilijk".
 *
 *  Tot 0052 stonden die sleutels als geheim op de server. Prima voor iets dat
 *  nooit verandert, hopeloos voor iets waar je nog mee aan het stoeien bent:
 *  elke poging was "supabase secrets set" plus opnieuw uitrollen.
 *
 *  Waar dit scherm over gaat, en waar niet
 *  ---------------------------------------
 *
 *  Hier staan de sleutels van de APP -- wie wij zijn richting Exact. Het
 *  koppelen zelf (inloggen bij Exact en toestemming geven) staat ook hier,
 *  omdat het één handeling is: sleutels erin, meteen proberen. Het
 *  administratienummer hoort bij het dagelijkse werk en blijft bij
 *  Trucksupply -> Instellingen staan.
 *
 *  Wat er nooit naar de browser komt
 *  ---------------------------------
 *
 *  Het clientgeheim. De server stuurt alleen of het gezet is en de laatste
 *  vier tekens, genoeg om te zien of het het geheim is dat je dacht te
 *  plakken. Daarom is het veld hier ook altijd leeg als je binnenkomt: leeg
 *  laten betekent "laat staan wat er staat".
 *
 *  Proef of echt
 *  -------------
 *
 *  Een dev-account van Exact en de echte boekhouding zien er identiek uit.
 *  Dat verschil staat er daarom met zoveel woorden bij, en het omzetten
 *  ervan maakt de koppeling los -- een token van het proefaccount hoort niet
 *  in de echte administratie te blijven hangen.
 * =========================================================================== */

import { useEffect, useMemo, useState } from 'react'
import {
  Check, Download, ExternalLink, Link2, Link2Off, Loader2, RefreshCw, Save,
  Search, TriangleAlert, Unlink, Users, X,
} from 'lucide-react'
import { SLEUTELS, leesInstelling, zetInstelling } from '../../lib/instellingen'
import {
  exactGrootboekStand, exactInstellen, exactKoppelMedewerker, exactLos,
  exactMedewerkerDetails, exactPersoneelStand, exactStatus, exactSyncGrootboek,
  exactSyncPersoneel, exactVerbindUrl,
  type ExactPersoon, type ExactStatus, type GrootboekStand, type PersoneelRegel,
  type PersoneelStand,
} from '../../lib/trucksupply'
import { dateShort, dateTime, relative } from '../../lib/format'
import { Badge, Card, Empty, Field, Modal } from '../../components/ui'
import { toast } from '../../store/useToasts'

/** Leeg = de standaard van de server. Alleen om het typen te besparen. */
const ADRESSEN = [
  { waarde: '', naam: 'Standaard (start.exactonline.nl)' },
  { waarde: 'https://start.exactonline.nl', naam: 'Nederland — start.exactonline.nl' },
  { waarde: 'https://start.exactonline.be', naam: 'België — start.exactonline.be' },
  { waarde: 'https://start.exactonline.de', naam: 'Duitsland — start.exactonline.de' },
  { waarde: 'https://start.exactonline.co.uk', naam: 'Verenigd Koninkrijk — start.exactonline.co.uk' },
  { waarde: 'https://start.exactonline.com', naam: 'Overig — start.exactonline.com' },
]

export default function Exact() {
  const [stand, setStand] = useState<ExactStatus | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  /** Loopt er een koppelpoging waar we op wachten. */
  const [wachten, setWachten] = useState(false)

  /* De velden van het formulier. */
  const [clientId, setClientId] = useState('')
  const [geheim, setGeheim] = useState('')
  const [basis, setBasis] = useState('')
  const [redirect, setRedirect] = useState('')
  const [omgeving, setOmgeving] = useState<'proef' | 'echt'>('proef')
  /** Waar de serverfunctie je heen stuurt als je klaar bent bij Exact. */
  const [appUrl, setAppUrl] = useState('')

  async function laad(velden = true) {
    try {
      const s = await exactStatus()
      setStand(s)
      setFout(null)
      /*
       * De velden alleen vullen bij het openen en na het opslaan, niet bij
       * elke verversing: anders verdwijnt wat je aan het typen bent zodra de
       * status binnenkomt.
       */
      if (velden && s.opgeslagen) {
        setClientId(s.opgeslagen.clientId)
        setBasis(s.opgeslagen.basisUrl)
        setRedirect(s.opgeslagen.redirectUri)
        setOmgeving(s.opgeslagen.omgeving)
      }
      /* Het geheim komt nooit terug, dus het veld blijft leeg. */
      setGeheim('')
      if (velden) setAppUrl(await leesInstelling(SLEUTELS.appUrl, ''))
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'De status is niet op te halen.')
    }
  }

  useEffect(() => { void laad() }, [])

  /*
   * Terugkomen uit Exact.
   *
   * De serverfunctie stuurt je hierheen terug met ?exact=<woord> (0055). Dat
   * woord komt uit een vast rijtje in die functie en nooit uit een verzoek,
   * dus het is veilig om er een melding aan te hangen. Daarna gaat hij uit de
   * URL: blijft hij staan, dan krijg je bij elke verversing dezelfde melding
   * opnieuw, en na een herstart zelfs een melding over iets van vorige week.
   */
  useEffect(() => {
    let woord: string | null = null
    try {
      woord = new URL(window.location.href).searchParams.get('exact')
    } catch {
      return
    }
    if (!woord) return

    const meldingen: Record<string, () => void> = {
      ok: () => toast.ok('Gekoppeld met Exact.'),
      geweigerd: () => toast.warn('Exact heeft de koppeling niet toegestaan.'),
      verlopen: () => toast.warn('Die koppelpoging was verlopen. Probeer het opnieuw.'),
      sleutels: () => toast.error('De sleutels van de Exact-app ontbreken.'),
      token: () => toast.error('Het inwisselen van de code bij Exact is mislukt.'),
    }
    ;(meldingen[woord] ?? (() => toast.warn('Onbekend antwoord van Exact.')))()

    try {
      const u = new URL(window.location.href)
      u.searchParams.delete('exact')
      window.history.replaceState({}, '', u.toString())
    } catch { /* geen ramp; de melding is al geweest */ }

    void laad(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /*
   * Wachten terwijl jij bij Exact bezig bent.
   *
   * In de browser kom je vanzelf terug op deze pagina en vangt het blokje
   * hierboven het op. In de Windows-app niet: die opent je gewone browser, en
   * die kan het app-venster niet weer naar voren halen. Dan zou je hier naar
   * "niet gekoppeld" zitten kijken terwijl het allang gelukt is.
   *
   * Dus vragen we het gewoon: elke drie seconden, hooguit drie minuten. Dat
   * is ruim voor inloggen bij Exact, en het stopt vanzelf -- een scherm dat
   * de hele dag blijft vragen is een scherm dat je vergeet.
   */
  useEffect(() => {
    if (!wachten) return
    const tot = Date.now() + 3 * 60_000
    const t = setInterval(() => {
      if (Date.now() > tot) {
        setWachten(false)
        return
      }
      void (async () => {
        try {
          const s = await exactStatus()
          setStand(s)
          if (s.verbonden) {
            setWachten(false)
            toast.ok('Gekoppeld met Exact.')
          }
        } catch { /* een misser tussendoor is geen reden om te stoppen */ }
      })()
    }, 3000)
    return () => clearInterval(t)
  }, [wachten])

  const mag = stand !== null && stand.opgeslagen !== undefined

  async function bewaar() {
    setBezig('opslaan')
    try {
      const { losgekoppeld } = await exactInstellen({
        clientId: clientId.trim(),
        /* Leeg laten = laat staan. Alleen meesturen als er iets getypt is. */
        ...(geheim.trim() ? { geheim: geheim.trim() } : {}),
        basis: basis.trim(),
        redirect: redirect.trim(),
        omgeving,
      })
      await zetInstelling(SLEUTELS.appUrl, appUrl.trim())
      await laad()
      toast.ok(losgekoppeld
        ? 'Opgeslagen. De koppeling is losgegaan, want de sleutels zijn gewijzigd — koppel opnieuw.'
        : 'Opgeslagen.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukte.')
    } finally {
      setBezig(null)
    }
  }

  async function wisGeheim() {
    if (!confirm('Het clientgeheim wissen? De koppeling gaat daarmee los.')) return
    setBezig('wissen')
    try {
      await exactInstellen({ geheimWissen: true })
      await laad()
      toast.ok('Het geheim is gewist.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Wissen mislukte.')
    } finally {
      setBezig(null)
    }
  }

  return (
    <div className="grid cols-2">
      {/* ------------------------- de sleutels ------------------------- */}

      <Card
        title="De Exact-app"
        hint="Wie wij zijn richting Exact"
        action={
          <button className="btn ghost sm" onClick={() => void laad()} title="Opnieuw ophalen">
            <RefreshCw size={14} />
          </button>
        }
      >
        {fout && <div className="waarschuwing mb"><TriangleAlert size={14} /><span>{fout}</span></div>}

        {stand !== null && !mag && (
          <p className="help" style={{ marginTop: 0 }}>
            Je mag de status zien maar de sleutels niet zetten. Dat kan alleen met de rol
            ontwikkeling of management.
          </p>
        )}

        {mag && (
          <>
            <Field
              label="Client-id"
              help="Uit het Exact App Center, bij je geregistreerde app. Leeg laten valt terug op EXACT_CLIENT_ID op de server."
            >
              <input
                className="input mono"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="{00000000-0000-0000-0000-000000000000}"
                spellCheck={false}
              />
            </Field>

            <Field
              label="Clientgeheim"
              help={stand?.opgeslagen?.geheimGezet
                ? `Er staat er een${stand.geheimStaart ? `, eindigend op ${stand.geheimStaart}` : ''}. Leeg laten betekent: laat staan.`
                : 'Er staat er nog geen. Het geheim gaat alleen heen en komt nooit terug naar dit scherm.'}
            >
              <div className="row">
                <input
                  className="input mono"
                  type="password"
                  value={geheim}
                  onChange={(e) => setGeheim(e.target.value)}
                  placeholder={stand?.opgeslagen?.geheimGezet ? '•••••••• (ongewijzigd)' : 'plak het geheim'}
                  autoComplete="new-password"
                  spellCheck={false}
                  style={{ flex: 1 }}
                />
                {stand?.opgeslagen?.geheimGezet && (
                  <button
                    className="btn ghost sm"
                    disabled={bezig !== null}
                    onClick={() => void wisGeheim()}
                    title="Het opgeslagen geheim wissen"
                  >
                    Wissen
                  </button>
                )}
              </div>
            </Field>

            <Field
              label="Omgeving"
              help="Alleen om te tonen wat het is. Omzetten maakt de koppeling los: een token van het proefaccount hoort niet in de echte boekhouding."
            >
              <select
                className="input"
                value={omgeving}
                onChange={(e) => setOmgeving(e.target.value === 'echt' ? 'echt' : 'proef')}
              >
                <option value="proef">Proef — een dev-account van Exact</option>
                <option value="echt">Echt — de administratie waar de boekhouding in staat</option>
              </select>
            </Field>

            <Field
              label="Adres van Exact"
              help="Per land een eigen adres. Alleen adressen van Exact zelf worden geaccepteerd — hier gaat het clientgeheim naartoe."
            >
              <select className="input" value={ADRESSEN.some((a) => a.waarde === basis) ? basis : ''} onChange={(e) => setBasis(e.target.value)}>
                {ADRESSEN.map((a) => <option key={a.waarde || 'standaard'} value={a.waarde}>{a.naam}</option>)}
              </select>
            </Field>

            <Field
              label="Terugkeeradres"
              help="Moet LETTERLIJK hetzelfde zijn als wat in het Exact App Center staat, tot de laatste schuine streep. Leeg laten gebruikt het adres hieronder."
            >
              <input
                className="input mono"
                value={redirect}
                onChange={(e) => setRedirect(e.target.value)}
                placeholder={stand?.standaardRedirect ?? 'https://…/functions/v1/exact'}
                spellCheck={false}
              />
            </Field>

            <Field
              label="Waar kom je terug"
              help="Nadat je bij Exact op toestaan klikt, stuurt de server je hierheen. Leeg laten geeft een kaal pagina'tje dat je zelf moet sluiten."
            >
              <input
                className="input mono"
                value={appUrl}
                onChange={(e) => setAppUrl(e.target.value)}
                placeholder="https://truckwash-workspace.com/app/"
                spellCheck={false}
              />
            </Field>

            <div className="row">
              <button className="btn primary sm" disabled={bezig !== null} onClick={() => void bewaar()}>
                {bezig === 'opslaan' ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Opslaan
              </button>
            </div>
          </>
        )}
      </Card>

      {/* -------------------------- de stand --------------------------- */}

      <div>
        <Card title="De koppeling" hint="Staat hij, en waarmee" className="mb">
          <div className="row" style={{ marginBottom: 12 }}>
            {stand === null && !fout && <Badge>ophalen…</Badge>}
            {stand && (stand.verbonden
              ? <Badge tone="ok" dot>gekoppeld</Badge>
              : <Badge tone="warn" dot>niet gekoppeld</Badge>)}
            {stand?.omgeving && (
              <Badge tone={stand.omgeving === 'echt' ? 'danger' : undefined}>
                {stand.omgeving === 'echt' ? 'echte administratie' : 'proefomgeving'}
              </Badge>
            )}
            {stand?.division && <span className="ts-sub">administratie {stand.division}</span>}
            {stand?.verlooptAt && <span className="ts-sub">token tot {dateTime(stand.verlooptAt)}</span>}
          </div>

          {wachten && (
            <div className="waarschuwing zacht mb">
              <Loader2 size={14} className="spin" />
              <span>
                Wachten tot je bij Exact op toestaan hebt geklikt. Dit scherm springt vanzelf
                om — je hoeft niets te verversen.{' '}
                <button className="btn ghost sm" onClick={() => setWachten(false)}>Stoppen</button>
              </span>
            </div>
          )}

          {stand?.laatsteFout && (
            <div className="waarschuwing zacht mb"><span>Laatste fout: {stand.laatsteFout}</span></div>
          )}

          {stand && !stand.ingesteld && (
            <div className="waarschuwing zacht mb">
              <span>Er staan nog geen sleutels. Zonder client-id en geheim kan er niet gekoppeld worden.</span>
            </div>
          )}

          {mag && (
            <div className="grid cols-2 mb">
              <Veld label="Gebruikt nu" waarde={stand?.clientId} mono />
              <Veld
                label="Sleutels vandaan"
                waarde={stand?.bron === 'database' ? 'Uit dit scherm'
                  : stand?.bron === 'omgeving' ? 'Van de server (EXACT_CLIENT_ID)'
                  : 'Nergens vandaan'}
              />
              <Veld label="Adres" waarde={stand?.basisUrl} mono />
              <Veld label="Terugkeer" waarde={stand?.redirectUri} mono />
              <Veld
                label="Gezet door"
                waarde={stand?.sleutelsDoor
                  ? `${stand.sleutelsDoor}${stand.sleutelsAt ? ` · ${relative(stand.sleutelsAt)}` : ''}`
                  : undefined}
              />
            </div>
          )}

          <div className="row">
            <button
              className="btn primary sm"
              disabled={bezig !== null || !stand?.ingesteld}
              onClick={() => {
                setBezig('verbind')
                void (async () => {
                  try {
                    const url = await exactVerbindUrl()
                    const venster = window.open(url, '_blank', 'noopener')
                    if (!venster) {
                      toast.warn('Het venster werd geblokkeerd. Sta pop-ups toe en probeer opnieuw.')
                    } else {
                      /* In de Windows-app opent dit je gewone browser, en die
                         kan dit venster niet terugroepen. Daarom vragen we het
                         zelf na. */
                      setWachten(true)
                    }
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Het koppelen lukte niet.')
                  } finally {
                    setBezig(null)
                  }
                })()
              }}
            >
              {bezig === 'verbind' ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />}
              {stand?.verbonden ? 'Opnieuw koppelen' : 'Koppelen met Exact'} <ExternalLink size={12} />
            </button>

            {stand?.verbonden && (
              <button
                className="btn danger sm"
                disabled={bezig !== null}
                onClick={() => {
                  if (!confirm('De koppeling met Exact losmaken? De tokens worden gewist.')) return
                  setBezig('los')
                  void (async () => {
                    try {
                      await exactLos()
                      await laad(false)
                      toast.ok('Koppeling losgemaakt.')
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Loskoppelen mislukte.')
                    } finally {
                      setBezig(null)
                    }
                  })()
                }}
              >
                {bezig === 'los' ? <Loader2 size={14} className="spin" /> : <Link2Off size={14} />} Loskoppelen
              </button>
            )}
          </div>

          <p className="help" style={{ marginTop: 12, marginBottom: 0 }}>
            Na het koppelen in het nieuwe venster: hierboven op het pijltje om de status te verversen.
          </p>
        </Card>

        {/* --------------------- wat Exact van jou wil --------------------- */}

        {mag && (
          <Card title="Wat er in het Exact App Center moet staan" hint="Bij het instellen">
            <p className="help" style={{ marginTop: 0 }}>
              Exact vergelijkt het terugkeeradres teken voor teken. Eén schuine streep te veel
              en je krijgt een foutmelding die niet zegt waar het aan ligt.
            </p>
            <Field label="Redirect URI" help="Kopieer dit letterlijk naar de app in het Exact App Center.">
              <input
                className="input mono"
                readOnly
                value={stand?.redirectUri ?? stand?.standaardRedirect ?? ''}
                onFocus={(e) => e.currentTarget.select()}
                spellCheck={false}
              />
            </Field>
            <p className="help" style={{ marginBottom: 0 }}>
              Een app in het App Center werkt eerst alleen op je eigen administratie; dat is
              genoeg om mee te proberen. Toegestane adressen:{' '}
              {(stand?.domeinen ?? []).join(', ')}.
            </p>
          </Card>
        )}
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <Grootboek verbonden={stand?.verbonden === true} />
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <Personeel verbonden={stand?.verbonden === true} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Het rekeningschema
 *
 *  Casper: "grootboekrekeningen moeten ook met exact syncen, zodat alles
 *  netjes kan staan."
 *
 *  Wat hier NIET gebeurt is het schema van Exact over onze lijst heen
 *  zetten. Een administratie in Exact heeft er al gauw een paar honderd, en
 *  onze lijst is met opzet kort -- staat zo in migratie 0044. Wat je wilt
 *  weten is iets anders, en dat is precies wat deze tabel laat zien: bestaat
 *  elke code waarop wij boeken ook daar, en heet hij hetzelfde?
 *
 *  Een code die hier wel bestaat en in Exact niet, is een boeking die straks
 *  geweigerd wordt. Dat wil je zien voordat de factuur weg is.
 * ------------------------------------------------------------------ */

function Grootboek({ verbonden }: { verbonden: boolean }) {
  const [stand, setStand] = useState<GrootboekStand | null>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [alles, setAlles] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setStand(await exactGrootboekStand())
      } catch (e) {
        setFout(e instanceof Error ? e.message : 'De stand is niet op te halen.')
      }
    })()
  }, [])

  async function haalOp() {
    setBezig(true)
    setFout(null)
    try {
      const uit = await exactSyncGrootboek()
      setStand(uit)
      toast.ok(`${uit.exactAantal} rekeningen opgehaald uit Exact.`)
    } catch (e) {
      const bericht = e instanceof Error ? e.message : 'Ophalen mislukte.'
      setFout(bericht)
      toast.error(bericht)
    } finally {
      setBezig(false)
    }
  }

  /* Standaard alleen wat aandacht vraagt. De hele lijst is instelwerk dat je
     één keer nakijkt; de afwijkingen zijn wat je elke keer wilt zien. */
  const regels = stand?.regels ?? []
  const opvallend = regels.filter((r) => r.actief && (!r.inExact || r.geblokkeerd))
  const tonen = alles ? regels : opvallend

  return (
    <Card
      title="Het rekeningschema naast dat van Exact"
      hint="Boekt elke code straks ook echt?"
      action={
        <button
          className="btn sm"
          disabled={bezig || !verbonden}
          onClick={() => void haalOp()}
          title={verbonden ? 'Opnieuw ophalen bij Exact' : 'Eerst koppelen met Exact'}
        >
          {bezig ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Ophalen uit Exact
        </button>
      }
    >
      {fout && <div className="waarschuwing mb"><TriangleAlert size={14} /><span>{fout}</span></div>}

      <div className="row mb">
        {stand?.laatstAt
          ? <span className="ts-sub">Laatst opgehaald {relative(stand.laatstAt)}{stand.door ? ` · ${stand.door}` : ''} · {stand.exactAantal} rekeningen in Exact</span>
          : <span className="ts-sub">Nog niet opgehaald.</span>}
      </div>

      {stand && stand.ontbreekt > 0 && (
        <div className="waarschuwing mb">
          <TriangleAlert size={14} />
          <span>
            <strong>{stand.ontbreekt} rekening{stand.ontbreekt === 1 ? '' : 'en'}</strong> waarop wij
            boeken bestaan niet in Exact. Een factuur op zo'n code wordt straks geweigerd.
          </span>
        </div>
      )}
      {stand && stand.geblokkeerd > 0 && (
        <div className="waarschuwing zacht mb">
          <span>{stand.geblokkeerd} rekening(en) staan in Exact op geblokkeerd.</span>
        </div>
      )}

      {stand && opvallend.length === 0 && stand.laatstAt && (
        <div className="waarschuwing zacht mb" style={{ borderColor: 'var(--ok)' }}>
          <Check size={14} />
          <span>Elke rekening die wij gebruiken bestaat in Exact en is niet geblokkeerd.</span>
        </div>
      )}

      {tonen.length === 0 && !stand?.laatstAt && (
        <Empty text="Haal het schema op bij Exact om de vergelijking te zien." />
      )}

      {tonen.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Bij ons</th>
                <th>In Exact</th>
                <th>Soort</th>
                <th>Staat</th>
              </tr>
            </thead>
            <tbody>
              {tonen.map((r) => (
                <tr key={r.code}>
                  <td className="mono">{r.code}</td>
                  <td className="afgekapt">{r.naam}{!r.actief && <span className="ts-sub"> · niet in gebruik</span>}</td>
                  <td className="afgekapt">
                    {r.inExact
                      ? (r.exactNaam || <span className="ts-sub">zonder omschrijving</span>)
                      : <span className="ts-sub">—</span>}
                  </td>
                  <td>{r.exactSoort ?? '—'}</td>
                  <td>
                    {!r.inExact && <Badge tone="danger" dot>niet in Exact</Badge>}
                    {r.inExact && r.geblokkeerd && <Badge tone="warn" dot>geblokkeerd</Badge>}
                    {r.inExact && !r.geblokkeerd && <Badge tone="ok" dot>klopt</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {regels.length > opvallend.length && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn ghost sm" onClick={() => setAlles((v) => !v)}>
            {alles
              ? <><X size={14} /> Alleen wat afwijkt</>
              : <>Alle {regels.length} rekeningen tonen</>}
          </button>
        </div>
      )}

      <p className="help" style={{ marginTop: 12, marginBottom: 0 }}>
        Onze lijst blijft kort en houdt zijn eigen namen; die van Exact is een kopie ernaast.
        Wat je hier ziet is of ze op elkaar aansluiten.
      </p>
    </Card>
  )
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  Het personeel
 *
 *  Casper: "voor personeel mag je alles doen." Wat dan blijkt: exporteren
 *  kan niet. De HRM-kant van de Exact-API is alleen-lezen -- geen POST en
 *  geen PUT op payroll/Employees. Een export bouwen zou iets opleveren dat
 *  Exact stilzwijgend weigert.
 *
 *  Andersom kijken kan wel, en dat levert meer op dan het klinkt. Drie
 *  vragen, en de derde is de reden dat dit scherm er staat: wie is er in
 *  Exact uit dienst en kan hier nog gewoon inloggen?
 * ------------------------------------------------------------------ */

function Personeel({ verbonden }: { verbonden: boolean }) {
  const [stand, setStand] = useState<PersoneelStand | null>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [alles, setAlles] = useState(false)
  const [mag, setMag] = useState(true)
  /** Bij wie staat de zoeker open. */
  const [zoeken, setZoeken] = useState<PersoneelRegel | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setStand(await exactPersoneelStand())
      } catch (e) {
        const bericht = e instanceof Error ? e.message : 'De stand is niet op te halen.'
        /* Geen recht is geen storing: dan hoort dit blok gewoon dicht te
           blijven in plaats van een rode balk te tonen. */
        if (/niet voor iedereen/i.test(bericht)) setMag(false)
        else setFout(bericht)
      }
    })()
  }, [])

  async function haalOp() {
    setBezig(true)
    setFout(null)
    try {
      const uit = await exactSyncPersoneel()
      setStand(uit)
      toast.ok(uit.gekoppeld > 0
        ? `${uit.exactAantal} medewerkers opgehaald, ${uit.gekoppeld} nieuw gekoppeld op e-mailadres.`
        : `${uit.exactAantal} medewerkers opgehaald uit Exact.`)
    } catch (e) {
      const bericht = e instanceof Error ? e.message : 'Ophalen mislukte.'
      setFout(bericht)
      toast.error(bericht)
    } finally {
      setBezig(false)
    }
  }

  async function koppel(userId: string, hid: number | null) {
    try {
      setStand(await exactKoppelMedewerker(userId, hid))
      toast.ok(hid == null ? 'Koppeling weggehaald.' : 'Gekoppeld.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Koppelen mislukte.')
    }
  }

  if (!mag) return null

  const regels = stand?.regels ?? []
  const opvallend = regels.filter((r) => r.actief && (r.wegMaarActief || r.employeeHid == null))
  const tonen = alles ? regels : opvallend

  return (
    <Card
      title="Het personeel naast dat van Exact"
      hint="Wie is wie, en wie hoort er niet meer bij"
      action={
        <button
          className="btn sm"
          disabled={bezig || !verbonden}
          onClick={() => void haalOp()}
          title={verbonden ? 'Opnieuw ophalen bij Exact' : 'Eerst koppelen met Exact'}
        >
          {bezig ? <Loader2 size={14} className="spin" /> : <Users size={14} />} Ophalen uit Exact
        </button>
      }
    >
      <p className="help" style={{ marginTop: 0 }}>
        Personeel <strong>naar</strong> Exact sturen kan niet: hun HRM-API is alleen-lezen.
        Wat hier staat is de vergelijking — en de enige kant die Exact wél laat schrijven zijn
        de variabele loonmutaties (uren per periode). Daarvoor moet eerst duidelijk zijn wie
        hier welk medewerkernummer heeft, en dat is precies wat deze lijst regelt.
      </p>

      {fout && <div className="waarschuwing mb"><TriangleAlert size={14} /><span>{fout}</span></div>}

      <div className="row mb">
        {stand?.laatstAt
          ? <span className="ts-sub">Laatst opgehaald {relative(stand.laatstAt)}{stand.door ? ` · ${stand.door}` : ''} · {stand.exactAantal} medewerkers in Exact</span>
          : <span className="ts-sub">Nog niet opgehaald.</span>}
      </div>

      {stand && stand.weg > 0 && (
        <div className="waarschuwing mb">
          <TriangleAlert size={14} />
          <span>
            <strong>{stand.weg} {stand.weg === 1 ? 'iemand staat' : 'mensen staan'} in Exact uit
            dienst</strong> maar hier nog actief. Die kunnen dus nog inloggen.
          </span>
        </div>
      )}
      {stand && stand.zonderKoppeling > 0 && (
        <div className="waarschuwing zacht mb">
          <span>
            {stand.zonderKoppeling} actieve medewerker(s) zijn nog aan geen enkel
            medewerkernummer gekoppeld. Zolang dat zo is kunnen hun uren niet naar Exact.
          </span>
        </div>
      )}

      {stand && opvallend.length === 0 && stand.laatstAt && (
        <div className="waarschuwing zacht mb" style={{ borderColor: 'var(--ok)' }}>
          <Check size={14} />
          <span>Iedereen die hier werkt is gekoppeld en staat in Exact in dienst.</span>
        </div>
      )}

      {tonen.length === 0 && !stand?.laatstAt && (
        <Empty text="Haal het personeel op bij Exact om de vergelijking te zien." />
      )}

      {tonen.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Bij ons</th>
                <th>E-mail</th>
                <th>In Exact</th>
                <th>Nummer</th>
                <th>Staat</th>
              </tr>
            </thead>
            <tbody>
              {tonen.map((r) => (
                <tr key={r.userId}>
                  <td className="afgekapt">
                    {r.naam}{!r.actief && <span className="ts-sub"> · niet actief</span>}
                  </td>
                  <td className="afgekapt mono">{r.email}</td>
                  <td className="afgekapt">
                    {r.exactNaam ?? <span className="ts-sub">—</span>}
                    {r.uitDienstPer != null && (
                      <span className="ts-sub"> · uit dienst {dateShort(r.uitDienstPer)}</span>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        className="btn ghost sm"
                        onClick={() => setZoeken(r)}
                        title="Een medewerker in Exact opzoeken en koppelen"
                      >
                        {r.employeeHid != null
                          ? <><span className="mono">{r.employeeHid}</span></>
                          : <><Search size={13} /> zoeken</>}
                      </button>
                      {r.koppelBron && <span className="ts-sub">{r.koppelBron}</span>}
                    </div>
                  </td>
                  <td>
                    {r.wegMaarActief && <Badge tone="danger" dot>uit dienst</Badge>}
                    {!r.wegMaarActief && r.employeeHid == null && <Badge tone="warn" dot>niet gekoppeld</Badge>}
                    {!r.wegMaarActief && r.employeeHid != null && <Badge tone="ok" dot>klopt</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {regels.length > opvallend.length && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn ghost sm" onClick={() => setAlles((v) => !v)}>
            {alles
              ? <><X size={14} /> Alleen wat afwijkt</>
              : <>Alle {regels.length} medewerkers tonen</>}
          </button>
        </div>
      )}

      {stand && stand.alleenInExact.length > 0 && (
        <>
          <h4 style={{ marginTop: 18, marginBottom: 6 }}>
            Alleen in Exact ({stand.alleenInExact.length})
          </h4>
          <p className="help" style={{ marginTop: 0 }}>
            Deze medewerkernummers hangen aan niemand hier. Vul het nummer hierboven in bij de
            juiste persoon om ze te koppelen.
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Nummer</th><th>Naam</th><th>E-mail</th><th>Staat</th></tr>
              </thead>
              <tbody>
                {stand.alleenInExact.map((p) => (
                  <tr key={p.employeeHid}>
                    <td className="mono">{p.employeeHid}</td>
                    <td className="afgekapt">{p.naam}</td>
                    <td className="afgekapt mono">{p.email || '—'}</td>
                    <td>{p.actief ? <Badge>in dienst</Badge> : <Badge tone="warn">uit dienst</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="help" style={{ marginTop: 12, marginBottom: 0 }}>
        Koppelen gaat automatisch op e-mailadres, en verder niet. Op naam matchen klinkt handig
        maar twee mensen die De Vries heten is geen uitzondering — en een verkeerde koppeling
        stuurt straks de uren van de een naar de loonstrook van de ander.
      </p>

      {zoeken && (
        <Zoeker
          persoon={zoeken}
          mensen={stand?.exactMensen ?? []}
          onSluit={() => setZoeken(null)}
          onKies={async (hid) => {
            await koppel(zoeken.userId, hid)
            setZoeken(null)
          }}
        />
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 *  De Exact-medewerker erbij zoeken
 *
 *  Casper: "dat je dus bij een medewerker in het systeem, een medewerker in
 *  exact kan zoeken, zodat je dus de exact medewerker kan koppelen aan die
 *  medewerker, waar dus ook alle dingen bij meekomen."
 *
 *  Hier stond een veldje waar je het nummer in tikte. Dat werkt alleen als je
 *  het nummer uit je hoofd kent, en dan nog zie je pas na het opslaan of je
 *  de juiste te pakken had. Nu: zoeken op naam, nummer of adres, en van wie
 *  je aanwijst eerst zien wat Exact over hem weet.
 * ------------------------------------------------------------------ */

function Zoeker({
  persoon, mensen, onKies, onSluit,
}: {
  persoon: PersoneelRegel
  mensen: ExactPersoon[]
  onKies: (hid: number | null) => void | Promise<void>
  onSluit: () => void
}) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState<number | null>(persoon.employeeHid)
  const [velden, setVelden] = useState<Record<string, unknown> | null>(null)
  const [laden, setLaden] = useState(false)

  /* Bij het openen alvast zoeken op de naam die we hier kennen. Negen van de
     tien keer staat de juiste dan meteen bovenaan. */
  useEffect(() => { setTerm(persoon.naam) }, [persoon.naam])

  useEffect(() => {
    if (open == null) { setVelden(null); return }
    setLaden(true)
    void (async () => {
      try {
        const uit = await exactMedewerkerDetails(open)
        setVelden(uit.velden)
      } catch {
        setVelden(null)
      } finally {
        setLaden(false)
      }
    })()
  }, [open])

  const gevonden = useMemo(() => {
    const t = term.trim().toLowerCase()
    const lijst = t === ''
      ? mensen
      : mensen.filter((m) =>
          m.naam.toLowerCase().includes(t)
          || String(m.employeeHid).includes(t)
          || m.email.toLowerCase().includes(t)
          || (m.priveEmail ?? '').toLowerCase().includes(t))
    /* In dienst eerst: wie uit dienst is zoek je zelden op. */
    return [...lijst].sort((a, b) => Number(b.actief) - Number(a.actief)
      || a.naam.localeCompare(b.naam)).slice(0, 60)
  }, [mensen, term])

  return (
    <Modal
      open
      title={`Exact-medewerker koppelen aan ${persoon.naam}`}
      subtitle="Zoek de juiste, bekijk wat Exact van hem weet, en koppel"
      onClose={onSluit}
      width={860}
    >
      {mensen.length === 0 && (
        <Empty text="Er is nog geen personeel opgehaald uit Exact. Doe dat eerst." />
      )}

      {mensen.length > 0 && (
        <>
          <Field label="Zoeken" help="Op naam, medewerkernummer of e-mailadres.">
            <input
              className="input"
              value={term}
              autoFocus
              onChange={(e) => setTerm(e.target.value)}
              placeholder="naam, nummer of e-mail"
            />
          </Field>

          <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr><th>Nr.</th><th>Naam</th><th>E-mail</th><th>Dienst</th><th /></tr>
              </thead>
              <tbody>
                {gevonden.map((m) => (
                  <tr key={m.employeeHid} className={m.employeeHid === open ? 'aan' : undefined}>
                    <td className="mono">{m.employeeHid}</td>
                    <td className="afgekapt">{m.naam}</td>
                    <td className="afgekapt mono">{m.email || m.priveEmail || '—'}</td>
                    <td>
                      {m.actief ? <Badge tone="ok">in dienst</Badge> : <Badge tone="warn">uit dienst</Badge>}
                      {m.gekoppeldAan && m.gekoppeldAan !== persoon.userId && (
                        <Badge tone="danger">al gekoppeld</Badge>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn ghost sm" onClick={() => setOpen(m.employeeHid)}>
                          Bekijken
                        </button>
                        <button
                          className="btn sm"
                          disabled={Boolean(m.gekoppeldAan && m.gekoppeldAan !== persoon.userId)}
                          onClick={() => void onKies(m.employeeHid)}
                        >
                          Koppelen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {gevonden.length === 0 && (
                  <tr><td colSpan={5}><span className="ts-sub">Niets gevonden.</span></td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ---- alles wat Exact over deze medewerker weet ---- */}

          {open != null && (
            <>
              <h4 style={{ marginTop: 18, marginBottom: 6 }}>
                Wat Exact weet over nummer {open}
              </h4>
              {laden && <p className="ts-sub" style={{ marginTop: 0 }}>Ophalen…</p>}
              {!laden && !velden && (
                <p className="ts-sub" style={{ marginTop: 0 }}>Geen gegevens gevonden.</p>
              )}
              {!laden && velden && <Velden velden={velden} />}
            </>
          )}

          {persoon.employeeHid != null && (
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn danger sm" onClick={() => void onKies(null)}>
                <Unlink size={14} /> Koppeling weghalen
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

/**
 * Het hele record van Exact, leesbaar.
 *
 * Er komen tientallen velden mee en de namen zijn die van Exact. De bekende
 * krijgen een Nederlandse kop; de rest tonen we zoals hij heet, want een veld
 * verbergen omdat wij de naam niet kennen is precies wat je niet wilt als je
 * zit te zoeken waarom een koppeling niet klopt.
 *
 * Lege velden vallen weg. Een record met veertig lege regels is geen
 * overzicht.
 */
const VELDNAMEN: Record<string, string> = {
  EmployeeHID: 'Medewerkernummer',
  FullName: 'Volledige naam',
  FirstName: 'Voornaam',
  LastName: 'Achternaam',
  Initials: 'Voorletters',
  Email: 'E-mail (werk)',
  PrivateEmail: 'E-mail (privé)',
  Phone: 'Telefoon',
  MobilePhone: 'Mobiel',
  BirthDate: 'Geboortedatum',
  SocialSecurityNumber: 'Burgerservicenummer',
  StartDate: 'In dienst per',
  EndDate: 'Uit dienst per',
  IsActive: 'In dienst',
  Gender: 'Geslacht',
  City: 'Plaats',
  Postcode: 'Postcode',
  AddressLine1: 'Adres',
  Country: 'Land',
  JobTitleDescription: 'Functie',
  BusinessEmail: 'E-mail (zakelijk)',
}

function Velden({ velden }: { velden: Record<string, unknown> }) {
  const regels = Object.entries(velden)
    .map(([sleutel, waarde]) => [sleutel, leesbaar(waarde)] as const)
    .filter(([, waarde]) => waarde !== '')
    .sort(([a], [b]) => {
      /* Wat we een naam hebben gegeven eerst, in de volgorde van die lijst. */
      const ia = Object.keys(VELDNAMEN).indexOf(a)
      const ib = Object.keys(VELDNAMEN).indexOf(b)
      if (ia >= 0 && ib >= 0) return ia - ib
      if (ia >= 0) return -1
      if (ib >= 0) return 1
      return a.localeCompare(b)
    })

  if (regels.length === 0) return <p className="ts-sub">Exact stuurde geen velden mee.</p>

  return (
    <div className="grid cols-3">
      {regels.map(([sleutel, waarde]) => (
        <div key={sleutel}>
          <span className="help" style={{ display: 'block' }}>
            {VELDNAMEN[sleutel] ?? sleutel}
          </span>
          <span style={{ wordBreak: 'break-word' }}>{waarde}</span>
        </div>
      ))}
    </div>
  )
}

/** Eén waarde uit Exact als tekst. Leeg betekent: laat de regel weg. */
function leesbaar(waarde: unknown): string {
  if (waarde === null || waarde === undefined || waarde === '') return ''
  if (typeof waarde === 'boolean') return waarde ? 'ja' : 'nee'
  if (typeof waarde === 'number') return String(waarde)
  if (typeof waarde === 'string') {
    /* OData v2 schrijft datums als /Date(1735689600000)/. Zo laten staan
       is onleesbaar; er een datum van maken is het hele punt. */
    const d = /^\/Date\((-?\d+)/.exec(waarde)
    if (d) {
      const t = Number(d[1])
      return Number.isFinite(t) ? dateShort(t) : ''
    }
    /* Exact hangt overal een __metadata-blok aan; dat zegt niemand iets. */
    return waarde
  }
  if (typeof waarde === 'object') return ''
  return String(waarde)
}

/* ------------------------------------------------------------------ */

/** Eén regel label-waarde. Leeg laat hij weg in plaats van een streepje. */
function Veld({ label, waarde, mono }: { label: string; waarde?: string; mono?: boolean }) {
  return (
    <div>
      <span className="help" style={{ display: 'block' }}>{label}</span>
      <span className={mono ? 'mono' : undefined} style={{ wordBreak: 'break-all' }}>
        {waarde || '—'}
      </span>
    </div>
  )
}
