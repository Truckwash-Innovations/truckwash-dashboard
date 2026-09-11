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
  Check, Download, ExternalLink, Link2, Link2Off, Loader2, Plus, RefreshCw,
  Save, Search, Send, Trash2, TriangleAlert, Unlink, Users, X,
} from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/db'
import { enqueue } from '../../lib/sync'
/* Location moet hier bij naam staan: zonder deze import pakt TypeScript de
   Location van de browser, en dan klopt er niets van de foutmeldingen. */
/*
 * De rij heet hier GrootboekRij en niet Grootboek.
 *
 * Sinds het scherm Grootboek geexporteerd wordt (1.74.0, de administratie
 * rendert het ook) botsen de twee namen in dit bestand: een type uit types.ts
 * en een component. TypeScript 5.9 liet dat nog lopen, 7.0 niet -- en de
 * lockfile staat op 7.0.2, dus CI viel erover terwijl het hier nog bouwde.
 * De component houdt zijn naam; het type wijkt, want dat is een databaserij
 * en die naam staat alleen in dit bestand.
 */
import type { Grootboek as GrootboekRij, Location } from '../../lib/types'
import { SLEUTELS, leesInstelling, zetInstelling } from '../../lib/instellingen'
import {
  exactGrootboekStand, exactInstellen, exactKoppelMedewerker, exactLos,
  exactMedewerkerDetails, exactPersoneelStand, exactStatus, exactSyncGrootboek,
  exactBtwCodes, exactDagboeken, exactFacturenStand, exactStuurFacturen,
  exactBatchUitvoeren, exactBetaalStand, exactKoppelBedrijf,
  exactRelatiesStand, exactSepaMaken, exactStuurVerkoop,
  exactSyncAdministraties, exactSyncPersoneel, exactSyncRelaties,
  exactVerbindUrl, exactVerkoopOpmaken, exactVerkoopStand,
  exactVerkoopVersturen, exactZetAdministratie,
  type ExactAdministratie, type ExactBtwCode, type ExactDagboek,
  type BetaalStand, type FacturenStand, type RelatiesStand, type VerkoopStand,
  type ExactPersoon, type ExactRekening, type ExactStatus, type GrootboekStand,
  type PersoneelRegel, type PersoneelStand, type VerkoopFactuurRegel,
} from '../../lib/trucksupply'
import { dateShort, dateTime, money, relative } from '../../lib/format'
import {
  Badge, Card, Empty, Field, Filterbalk, Filterchips, Knop, LeegStaat,
  Modal, Paginakop, Stand, Tabel, Zoekveld,
} from '../../components/ui'
/* Als type en niet als waarde -- zie de kanttekening bij GrootboekRij
   hierboven; 1.74.0 viel om op precies dit soort botsing. */
import type { Kolom } from '../../components/ui'
import Stroombalk from '../../components/Stroombalk'
import {
  buitenStaand, verkoopKlem, verkoopstapVan, verkoopstroom, verkoopTeLaat,
} from '../../lib/verkoopstroom'
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

            {/*
              * Twee velden die op elkaar lijken en het tegenovergestelde
              * doen. Hier stond alleen "Terugkeeradres", en dat werd
              * ingevuld met het adres van de app -- waarna Exact "Callback
              * URI is not valid" gaf en er niets in beeld kwam dat uitlegde
              * waarom. De koppen zeggen nu wie waar naartoe belt.
              */}
            <Field
              label="Waar Exact naartoe belt (redirect URI)"
              help="Dit is ONZE server, niet de app: alleen die kan de code van Exact inwisselen. Hetzelfde adres moet letterlijk in het Exact App Center staan. Leeg laten is het veiligst — dan pakt hij het adres hieronder."
            >
              <input
                className="input mono"
                value={redirect}
                onChange={(e) => setRedirect(e.target.value)}
                placeholder={stand?.standaardRedirect ?? 'https://…/functions/v1/exact'}
                spellCheck={false}
              />
              {redirect.trim() !== '' && !redirect.trim().replace(/\/+$/, '').endsWith('/functions/v1/exact') && (
                <span className="waarschuwing zacht" style={{ marginTop: 6 }}>
                  <TriangleAlert size={13} />
                  <span>
                    Dit wijst niet naar de serverfunctie. Exact zal dit weigeren met
                    “Callback URI is not valid”. Laat het leeg, of gebruik{' '}
                    <code>{stand?.standaardRedirect ?? '…/functions/v1/exact'}</code>.
                  </span>
                </span>
              )}
            </Field>

            <Field
              label="Waar JIJ terugkomt (de app)"
              help="Nadat Exact onze server heeft gebeld, stuurt die jou hierheen. Dit is dus wél het adres van de app. Leeg laten geeft een kaal pagina'tje dat je zelf moet sluiten."
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
            <div className="waarschuwing zacht mb">
              <TriangleAlert size={14} />
              <span>
                <strong>Krijg je “Callback URI is not valid”?</strong> Dan staat dit adres niet,
                of niet volledig, bij je app in het App Center. Er is een bekende eigenaardigheid
                waarbij dat veld maar een deel van de URL bewaart. Sla het op,{' '}
                <em>sluit het scherm en open het opnieuw</em>, en kijk of er nog steeds het hele
                adres staat — tot en met <code>/exact</code>.
              </span>
            </div>

            <p className="help" style={{ marginBottom: 0 }}>
              Een app in het App Center werkt eerst alleen op je eigen administratie; dat is
              genoeg om mee te proberen. Toegestane adressen:{' '}
              {(stand?.domeinen ?? []).join(', ')}.
            </p>
          </Card>
        )}
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <Administraties verbonden={stand?.verbonden === true} />
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <Grootboek verbonden={stand?.verbonden === true} />
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <Personeel verbonden={stand?.verbonden === true} />
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <Relaties verbonden={stand?.verbonden === true} />
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <Facturen verbonden={stand?.verbonden === true} />
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <Verkoop verbonden={stand?.verbonden === true} />
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <Betalen />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  De bv's
 *
 *  Casper: "Ik heb in exact meerdere bv's, die hebben ook allemaal een eigen
 *  grootboekrekening, fix dit."
 *
 *  Dit is het blok waar de rest aan hangt. Rekening 4000 bestaat in elke
 *  administratie en betekent er iets anders; welke bv erbij hoort bepaalt
 *  dus welke rekening geldt en waar de boeking heen gaat. Een bon erft dat
 *  van zijn vestiging, en die staan hieronder.
 * ------------------------------------------------------------------ */

function Administraties({ verbonden }: { verbonden: boolean }) {
  const [lijst, setLijst] = useState<ExactAdministratie[] | null>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const vestigingen = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])

  useEffect(() => {
    void (async () => {
      try {
        setLijst((await exactFacturenStand()).administraties)
      } catch { /* nog niet gekoppeld; het blok blijft leeg */ }
    })()
  }, [])

  async function haalOp() {
    setBezig(true)
    setFout(null)
    try {
      const uit = await exactSyncAdministraties()
      setLijst(uit)
      toast.ok(`${uit.length} administratie(s) gevonden.`)
    } catch (e) {
      const b = e instanceof Error ? e.message : 'Ophalen mislukte.'
      setFout(b)
      toast.error(b)
    } finally {
      setBezig(false)
    }
  }

  async function zet(code: string, velden: { actief?: boolean; hoofd?: boolean }) {
    try {
      setLijst(await exactZetAdministratie(code, velden))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dat lukte niet.')
    }
  }

  async function zetVestiging(id: string, adm: string) {
    const l = vestigingen.find((v) => v.id === id)
    if (!l) return
    const nieuw: Location = { ...l, administratie: adm || undefined, updatedAt: Date.now() }
    await db.locations.put(nieuw)
    await enqueue('locations', 'put', nieuw.id, nieuw)
  }

  const actief = (lijst ?? []).filter((a) => a.actief)
  const zonder = vestigingen.filter((v) => !v.administratie)

  return (
    <Card
      title="De bv's"
      hint="Elke administratie heeft zijn eigen grootboek"
      action={
        <button className="btn sm" disabled={bezig || !verbonden} onClick={() => void haalOp()}>
          {bezig ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Ophalen uit Exact
        </button>
      }
    >
      {fout && <div className="waarschuwing mb"><TriangleAlert size={14} /><span>{fout}</span></div>}

      {(lijst ?? []).length === 0 && (
        <Empty text="Nog niet opgehaald. Haal de administraties op om te beginnen." />
      )}

      {(lijst ?? []).length > 0 && (
        <>
          <p className="help" style={{ marginTop: 0 }}>
            Zet alleen aan waar jullie werkelijk in boeken. Een bv die aanstaat wordt bij elke
            ophaalronde meegenomen — grootboek, crediteuren, alles.
          </p>
          <div className="table-wrap mb">
            <table className="data">
              <thead><tr><th>Nummer</th><th>Naam</th><th>Gebruiken</th><th>Hoofd</th></tr></thead>
              <tbody>
                {(lijst ?? []).map((a) => (
                  <tr key={a.code}>
                    <td className="mono">{a.code}</td>
                    <td className="afgekapt">{a.naam || '—'}</td>
                    <td>
                      <label className="row" style={{ gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={a.actief}
                          onChange={(e) => void zet(a.code, { actief: e.currentTarget.checked })}
                        />
                        <span className="ts-sub">{a.actief ? 'ja' : 'nee'}</span>
                      </label>
                    </td>
                    <td>
                      {a.hoofd
                        ? <Badge tone="ok">hoofd</Badge>
                        : (
                          <button className="btn ghost sm" onClick={() => void zet(a.code, { hoofd: true })}>
                            Tot hoofd maken
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ---- welke vestiging in welke bv ---- */}

          <h4 style={{ marginTop: 18, marginBottom: 6 }}>Welke vestiging boekt waar</h4>
          <p className="help" style={{ marginTop: 0 }}>
            Een bon erft zijn bv van de vestiging. Staat er niets, dan valt hij terug op de
            hoofdadministratie — en dan boekt hij mogelijk in de verkeerde.
          </p>
          {zonder.length > 0 && (
            <div className="waarschuwing zacht mb">
              <TriangleAlert size={14} />
              <span>{zonder.length} vestiging(en) hebben nog geen bv.</span>
            </div>
          )}
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="data">
              <thead><tr><th>Vestiging</th><th>Plaats</th><th>Bv</th></tr></thead>
              <tbody>
                {[...vestigingen].sort((a, b) => a.name.localeCompare(b.name)).map((v) => (
                  <tr key={v.id}>
                    <td className="afgekapt">{v.name}</td>
                    <td className="afgekapt">{v.city ?? '—'}</td>
                    <td>
                      <select
                        className="input"
                        value={v.administratie ?? ''}
                        onChange={(e) => void zetVestiging(v.id, e.currentTarget.value)}
                      >
                        <option value="">— hoofdadministratie —</option>
                        {actief.map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.code}{a.naam ? ` · ${a.naam}` : ''}
                          </option>
                        ))}
                      </select>
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

export function Grootboek({ verbonden }: { verbonden: boolean }) {
  const [stand, setStand] = useState<GrootboekStand | null>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [alles, setAlles] = useState(false)
  /** Welke rekeningen van Exact staan er klaar om over te nemen. */
  const [overnemen, setOvernemen] = useState<ExactRekening[] | null>(null)
  const [weg, setWeg] = useState<{ code: string; naam: string; inGebruik: number } | null>(null)

  /* Onze eigen lijst komt uit de plaatselijke opslag: die is er ook zonder
     verbinding, en wijzigingen gaan via de gewone wachtrij naar de server. */
  const onze = useLiveQuery(() => db.grootboek.toArray(), [], [] as GrootboekRij[])

  useEffect(() => {
    void (async () => {
      try {
        setStand(await exactGrootboekStand())
      } catch (e) {
        setFout(e instanceof Error ? e.message : 'De stand is niet op te halen.')
      }
    })()
  }, [])

  /**
   * Overnemen wat er nog niet is.
   *
   * Alleen toevoegen. Bestaande regels blijven zoals ze zijn -- "Inkoop
   * wasmiddelen en chemie" is een naam die hier is bedacht omdat de
   * administratie hem zo herkent, en in Exact heet diezelfde rekening iets
   * als "Kosten grond- en hulpstoffen". Overschrijven zou dat elke ophaalronde
   * opnieuw wissen.
   */
  async function neemOver(rijen: ExactRekening[]) {
    const nu = Date.now()
    for (const r of rijen) {
      const rij: GrootboekRij = {
        id: 'gb_' + r.code,
        code: r.code,
        naam: r.omschrijving || r.code,
        trefwoorden: [],
        categorie: r.soort ?? undefined,
        btwPct: 21,
        /* Geblokkeerd bij Exact komt binnen als "niet in gebruik". Boeken op
           zo'n rekening wordt daar toch geweigerd. */
        actief: !r.geblokkeerd,
        updatedAt: nu,
      }
      await db.grootboek.put(rij)
      await enqueue('grootboek', 'put', rij.id, rij)
    }
    setOvernemen(null)
    toast.ok(`${rijen.length} rekening${rijen.length === 1 ? '' : 'en'} overgenomen.`)
    try {
      setStand(await exactGrootboekStand())
    } catch { /* de lijst hiernaast klopt al; de stand komt vanzelf */ }
  }

  async function zetCategorie(code: string, categorie: string) {
    const rij = onze.find((g) => g.code === code)
    if (!rij) return
    const nieuw: GrootboekRij = { ...rij, categorie: categorie.trim() || undefined, updatedAt: Date.now() }
    await db.grootboek.put(nieuw)
    await enqueue('grootboek', 'put', nieuw.id, nieuw)
  }

  /**
   * Weggooien, maar niet zomaar.
   *
   * Een rekening waarop al geboekt is, laat kostenposten achter met een code
   * die nergens naar wijst. Daarom eerst tellen, en het aantal in de vraag
   * zetten -- "weet je het zeker" zonder te zeggen waar het over gaat is geen
   * bevestiging maar een drempel.
   */
  async function vraagWeg(code: string, naam: string) {
    const bonnen = await db.expenses.toArray()
    setWeg({ code, naam, inGebruik: bonnen.filter((e) => e.grootboekCode === code).length })
  }

  async function gooiWeg(code: string) {
    const rij = onze.find((g) => g.code === code)
    if (!rij) return
    await db.grootboek.delete(rij.id)
    await enqueue('grootboek', 'delete', rij.id, rij)
    setWeg(null)
    toast.ok('Rekening verwijderd.')
    try {
      setStand(await exactGrootboekStand())
    } catch { /* niet erg */ }
  }

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

      {/*
        * Pas melden als er ook werkelijk iets is opgehaald. Anders staat er
        * bij het openen "13 rekeningen bestaan niet in Exact" terwijl er
        * simpelweg nog nooit iets is opgehaald -- een rode balk over een
        * probleem dat niet bestaat, en dat is erger dan geen balk.
        */}
      {stand && stand.laatstAt && stand.ontbreekt > 0 && (
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

      {stand?.laatstAt && tonen.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Bij ons</th>
                <th>Categorie</th>
                <th>In Exact</th>
                <th>Staat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tonen.map((r) => (
                <tr key={r.code}>
                  <td className="mono">{r.code}</td>
                  <td className="afgekapt">{r.naam}{!r.actief && <span className="ts-sub"> · niet in gebruik</span>}</td>
                  <td>
                    {/*
                      * Vrije tekst, met wat er al gebruikt wordt als suggestie.
                      * Een vaste lijst zou betekenen dat iemand met een eigen
                      * indeling -- "wasstraat" naast "wagenpark" -- er niet in
                      * past, en dan gaat hij hem in de naam zetten.
                      */}
                    <input
                      className="input"
                      style={{ minWidth: 120 }}
                      defaultValue={r.categorie ?? ''}
                      list="grootboek-categorieen"
                      placeholder="—"
                      onBlur={(e) => {
                        const v = e.currentTarget.value
                        if (v.trim() === (r.categorie ?? '')) return
                        void zetCategorie(r.code, v)
                      }}
                    />
                  </td>
                  <td className="afgekapt">
                    {r.inExact
                      ? (r.exactNaam || <span className="ts-sub">zonder omschrijving</span>)
                      : <span className="ts-sub">—</span>}
                  </td>
                  <td>
                    {!r.inExact && <Badge tone="danger" dot>niet in Exact</Badge>}
                    {r.inExact && r.geblokkeerd && <Badge tone="warn" dot>geblokkeerd</Badge>}
                    {r.inExact && !r.geblokkeerd && <Badge tone="ok" dot>klopt</Badge>}
                  </td>
                  <td>
                    <button
                      className="btn ghost sm"
                      title="Deze rekening verwijderen"
                      onClick={() => void vraagWeg(r.code, r.naam)}
                    >
                      <Trash2 size={13} />
                    </button>
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

      {/* De categorieën die al in gebruik zijn, als suggestie bij het typen. */}
      <datalist id="grootboek-categorieen">
        {[...new Set(onze.map((g) => g.categorie).filter(Boolean))].map((c) => (
          <option key={c} value={c as string} />
        ))}
      </datalist>

      {/* ---- wat Exact kent en wij nog niet ---- */}

      {stand && stand.nogNiet.length > 0 && (
        <>
          <h4 style={{ marginTop: 20, marginBottom: 6 }}>
            Nog niet overgenomen ({stand.nogNiet.length})
          </h4>
          <p className="help" style={{ marginTop: 0 }}>
            Deze rekeningen kent Exact wel en wij niet. Overnemen voegt ze toe met de
            omschrijving en het soort uit Exact; wat er al staat blijft ongemoeid.
          </p>
          <div className="row mb">
            <button
              className="btn primary sm"
              onClick={() => setOvernemen(stand.nogNiet)}
            >
              <Plus size={14} /> Alle {stand.nogNiet.length} overnemen
            </button>
            <button
              className="btn sm"
              onClick={() => setOvernemen(stand.nogNiet.filter((r) => !r.geblokkeerd))}
            >
              Alleen de niet-geblokkeerde
            </button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr><th>Code</th><th>In Exact</th><th>Soort</th><th>Staat</th><th /></tr>
              </thead>
              <tbody>
                {stand.nogNiet.map((r) => (
                  <tr key={r.code}>
                    <td className="mono">{r.code}</td>
                    <td className="afgekapt">{r.omschrijving || '—'}</td>
                    <td>{r.soort ?? '—'}</td>
                    <td>
                      {r.geblokkeerd
                        ? <Badge tone="warn">geblokkeerd</Badge>
                        : <Badge tone="ok">bruikbaar</Badge>}
                    </td>
                    <td>
                      <button className="btn ghost sm" onClick={() => setOvernemen([r])}>
                        <Plus size={13} /> Overnemen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="help" style={{ marginTop: 12, marginBottom: 0 }}>
        Overnemen voegt alleen toe. Wat er staat houdt zijn eigen naam en trefwoorden — die
        zijn hier bedacht omdat de administratie ze zo herkent, en in Exact heet dezelfde
        rekening vaak heel anders.
      </p>

      {/* ---- bevestigen: overnemen ---- */}

      {overnemen && (
        <Modal
          open
          title={overnemen.length === 1
            ? `Rekening ${overnemen[0].code} overnemen?`
            : `${overnemen.length} rekeningen overnemen?`}
          subtitle="Ze komen erbij in ons grootboek; er wordt niets overschreven"
          onClose={() => setOvernemen(null)}
          width={620}
        >
          {overnemen.some((r) => r.geblokkeerd) && (
            <div className="waarschuwing zacht mb">
              <TriangleAlert size={14} />
              <span>
                Er zitten geblokkeerde rekeningen bij. Die komen erin als “niet in gebruik”,
                want boeken erop wordt bij Exact toch geweigerd.
              </span>
            </div>
          )}
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="data">
              <thead><tr><th>Code</th><th>Wordt</th><th>Categorie</th></tr></thead>
              <tbody>
                {overnemen.slice(0, 200).map((r) => (
                  <tr key={r.code}>
                    <td className="mono">{r.code}</td>
                    <td className="afgekapt">{r.omschrijving || r.code}</td>
                    <td>{r.soort ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {overnemen.length > 200 && (
            <p className="ts-sub">…en nog {overnemen.length - 200}.</p>
          )}
          <div className="row end" style={{ marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setOvernemen(null)}>Annuleren</button>
            <button className="btn primary" onClick={() => void neemOver(overnemen)}>
              <Plus size={14} /> Overnemen
            </button>
          </div>
        </Modal>
      )}

      {/* ---- bevestigen: weggooien ---- */}

      {weg && (
        <Modal
          open
          title={`Rekening ${weg.code} verwijderen?`}
          subtitle={weg.naam}
          onClose={() => setWeg(null)}
          width={520}
        >
          {weg.inGebruik > 0 ? (
            <div className="waarschuwing mb">
              <TriangleAlert size={14} />
              <span>
                Er staan <strong>{weg.inGebruik} kostenpost{weg.inGebruik === 1 ? '' : 'en'}</strong> op
                deze rekening. Weggooien laat die achter met een code die nergens meer naar wijst.
                Boek ze eerst om, of zet de rekening op “niet in gebruik” — dan blijft hij bestaan
                maar stelt hij zich niet meer voor bij een nieuwe bon.
              </span>
            </div>
          ) : (
            <p className="help" style={{ marginTop: 0 }}>
              Er staat geen enkele kostenpost op deze rekening, dus er blijft niets achter.
            </p>
          )}
          <div className="row end" style={{ marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setWeg(null)}>Annuleren</button>
            <button
              className="btn danger"
              disabled={weg.inGebruik > 0}
              onClick={() => void gooiWeg(weg.code)}
            >
              <Trash2 size={14} /> Verwijderen
            </button>
          </div>
        </Modal>
      )}
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

/* ------------------------------------------------------------------ *
 *  Gedeeld met de administratie
 *
 *  Relaties, Facturen, Betalen en Verkoop staan hier omdat ze bij de
 *  Exact-koppeling zijn ontstaan, maar het werk erin is boekhouding en geen
 *  ontwikkelwerk. Sinds 1.74 staan ze ook in het administratiedashboard.
 *
 *  Ze zijn geexporteerd en niet verplaatst. Dat scheelt niet alleen een
 *  verhuizing van 900 regels: het ontwikkeldashboard houdt zijn tabbladen
 *  precies zoals ze waren, en er is maar een plek waar de logica staat. Twee
 *  kopieen van een betaalscherm is hoe een SEPA-bestand op twee manieren
 *  wordt opgebouwd.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  Onze bedrijven naast de relaties van Exact
 *
 *  Casper: "In exact staan natuurlijk relaties, dat worden onze bedrijven,
 *  sync dit dan ook."
 *
 *  Niet door onze lijst te overschrijven. Aan public.companies hangen
 *  wasbeurten, klantenportalen en profielen; een sync die daar rijen
 *  overheen zet of weggooit, sloopt verwijzingen die nergens anders vandaan
 *  komen. Dus hetzelfde als bij het grootboek: een kopie ernaast en een
 *  koppeling ertussen.
 *
 *  Per administratie, want dezelfde klant heeft in elke bv een eigen
 *  relatienummer -- en een verkoopfactuur wijst naar dat nummer.
 * ------------------------------------------------------------------ */

export function Relaties({ verbonden }: { verbonden: boolean }) {
  const [stand, setStand] = useState<RelatiesStand | null>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [alles, setAlles] = useState(false)

  async function laad() {
    try {
      setStand(await exactRelatiesStand())
      setFout(null)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'De stand is niet op te halen.')
    }
  }

  useEffect(() => { void laad() }, [])

  async function haalOp() {
    setBezig(true)
    setFout(null)
    try {
      const uit = await exactSyncRelaties()
      await laad()
      toast.ok(uit.gekoppeldBedrijven > 0
        ? `${uit.aantal} relaties opgehaald, ${uit.gekoppeldBedrijven} bedrijven gekoppeld op naam.`
        : `${uit.aantal} relaties opgehaald.`)
    } catch (e) {
      const b = e instanceof Error ? e.message : 'Ophalen mislukte.'
      setFout(b)
      toast.error(b)
    } finally {
      setBezig(false)
    }
  }

  async function koppel(companyId: string, division: string, exactId: string | null) {
    try {
      setStand(await exactKoppelBedrijf(companyId, division, exactId))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Koppelen mislukte.')
    }
  }

  /* Welke bv's er in de opgehaalde relaties voorkomen. Meer dan één betekent
     dat elk bedrijf per bv een eigen koppeling kan hebben. */
  const bvs = useMemo(
    () => [...new Set((stand?.klanten ?? []).map((k) => k.division))].sort(),
    [stand])

  const bedrijven = stand?.bedrijven ?? []
  const opvallend = bedrijven.filter((b) => b.koppelingen.length === 0)
  const tonen = alles ? bedrijven : opvallend

  return (
    <Card
      title="Onze bedrijven naast de relaties van Exact"
      hint="Nodig zodra er verkoopfacturen heen gaan"
      action={
        <button className="btn sm" disabled={bezig || !verbonden} onClick={() => void haalOp()}>
          {bezig ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Relaties ophalen
        </button>
      }
    >
      {fout && <div className="waarschuwing mb"><TriangleAlert size={14} /><span>{fout}</span></div>}

      <p className="help" style={{ marginTop: 0 }}>
        Onze klantenlijst blijft van ons — er hangen wasbeurten en portalen aan. Wat hier gebeurt
        is koppelen: welk bedrijf van ons is welke relatie in Exact. Dat gaat automatisch op naam
        als er precies één relatie met die naam is; bij twee is kiezen raden, en dan doet een mens
        het.
      </p>

      <div className="row mb">
        {stand?.laatstAt
          ? <span className="ts-sub">Laatst opgehaald {relative(stand.laatstAt)} · {stand.klanten.length} klanten in Exact</span>
          : <span className="ts-sub">Nog niet opgehaald.</span>}
      </div>

      {stand && stand.zonderKoppeling > 0 && (
        <div className="waarschuwing zacht mb">
          <TriangleAlert size={14} />
          <span>
            {stand.zonderKoppeling} bedrijf/bedrijven hangen nog aan geen enkele relatie. Zolang
            dat zo is kan er voor hen geen verkoopfactuur naar Exact.
          </span>
        </div>
      )}

      {stand && stand.zonderKoppeling === 0 && stand.laatstAt && bedrijven.length > 0 && (
        <div className="waarschuwing zacht mb" style={{ borderColor: 'var(--ok)' }}>
          <Check size={14} />
          <span>Elk bedrijf is aan een relatie in Exact gekoppeld.</span>
        </div>
      )}

      {tonen.length === 0 && !stand?.laatstAt && (
        <Empty text="Haal de relaties op bij Exact om te koppelen." />
      )}

      {tonen.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Bij ons</th>
                <th>Plaats</th>
                {bvs.map((bv) => <th key={bv}>In {bv}</th>)}
              </tr>
            </thead>
            <tbody>
              {tonen.map((b) => (
                <tr key={b.id}>
                  <td className="afgekapt">{b.naam}</td>
                  <td className="afgekapt">{b.plaats || '—'}</td>
                  {bvs.map((bv) => {
                    const link = b.koppelingen.find((k) => k.division === bv)
                    const keuzes = (stand?.klanten ?? []).filter(
                      (k) => k.division === bv && (!k.gekoppeld || k.exactId === link?.exactId))
                    return (
                      <td key={bv}>
                        <select
                          className="input"
                          style={{ minWidth: 150 }}
                          value={link?.exactId ?? ''}
                          onChange={(e) => void koppel(b.id, bv, e.currentTarget.value || null)}
                        >
                          <option value="">— niet gekoppeld —</option>
                          {keuzes.map((k) => (
                            <option key={k.exactId} value={k.exactId}>
                              {k.code ? `${k.code} · ` : ''}{k.naam}
                            </option>
                          ))}
                        </select>
                        {link?.bron === 'naam' && <span className="ts-sub"> op naam</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bedrijven.length > opvallend.length && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn ghost sm" onClick={() => setAlles((v) => !v)}>
            {alles
              ? <><X size={14} /> Alleen wat nog niet gekoppeld is</>
              : <>Alle {bedrijven.length} bedrijven tonen</>}
          </button>
        </div>
      )}

      {stand && stand.alleenInExact > 0 && (
        <p className="help" style={{ marginTop: 12, marginBottom: 0 }}>
          Er staan {stand.alleenInExact} relaties in Exact die aan geen bedrijf van ons hangen.
          Dat hoeft niet fout te zijn — daar zitten leveranciers en oude klanten tussen.
        </p>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 *  Goedgekeurde facturen naar Exact
 *
 *  Casper: "uiteindelijk wil ik natuurlijk als er facturen goedgekeurd
 *  worden, bij exact netjes komen, zodat we blue10 volledig weg kunnen halen.
 *  Kan je dat wel alvast integreren, maar voor nu even uit laten zetten?"
 *
 *  Dus staat alles er en gaat er niets. Het slot zit op de server: die
 *  weigert te versturen zolang de schakelaar uit staat. Een knop die je
 *  verstopt is geen slot -- de functie is met een gewoon verzoek aan te
 *  roepen.
 * ------------------------------------------------------------------ */

export function Facturen({ verbonden }: { verbonden: boolean }) {
  const [stand, setStand] = useState<FacturenStand | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [dagboeken, setDagboeken] = useState<ExactDagboek[] | null>(null)
  const [codes, setCodes] = useState<ExactBtwCode[] | null>(null)
  const [aanzetten, setAanzetten] = useState(false)

  async function laad() {
    try {
      setStand(await exactFacturenStand())
      setFout(null)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'De stand is niet op te halen.')
    }
  }

  useEffect(() => { void laad() }, [])

  async function doe(wat: string, werk: () => Promise<void>) {
    setBezig(wat)
    try {
      await werk()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dat lukte niet.')
    } finally {
      setBezig(null)
    }
  }

  async function zetAan(aan: boolean) {
    await zetInstelling('exact_facturen', aan ? 'aan' : 'uit')
    setAanzetten(false)
    await laad()
    toast.ok(aan
      ? 'Goedgekeurde facturen gaan nu naar Exact.'
      : 'Uitgezet. Er gaat niets meer naar Exact.')
  }

  const klaar = (stand?.wachtend ?? []).filter((b) => b.mist.length === 0)
  const stuk = (stand?.wachtend ?? []).filter((b) => b.mist.length > 0)

  return (
    <Card
      title="Goedgekeurde facturen naar Exact"
      hint="Het einddoel: Blue10 eruit"
      action={
        <button className="btn ghost sm" onClick={() => void laad()} title="Opnieuw ophalen">
          <RefreshCw size={14} />
        </button>
      }
    >
      {fout && <div className="waarschuwing mb"><TriangleAlert size={14} /><span>{fout}</span></div>}

      {/* ---- de schakelaar ---- */}

      <div className="row mb">
        {stand?.aan
          ? <Badge tone="ok" dot>staat aan</Badge>
          : <Badge tone="warn" dot>staat uit</Badge>}
        {stand && <span className="ts-sub">{stand.verstuurd} verstuurd · {klaar.length} klaar · {stuk.length} nog niet compleet</span>}
      </div>

      {stand && !stand.aan && (
        <div className="waarschuwing zacht mb">
          <span>
            Er gaat niets naar Exact. Alles eromheen werkt wel — je kunt instellen en koppelen
            zonder dat er één boeking wordt aangemaakt.
          </span>
        </div>
      )}

      <div className="row mb">
        {stand?.aan ? (
          <button className="btn danger sm" disabled={bezig !== null}
            onClick={() => void doe('uit', () => zetAan(false))}>
            Uitzetten
          </button>
        ) : (
          <button className="btn sm" disabled={bezig !== null || !verbonden}
            onClick={() => setAanzetten(true)}>
            Aanzetten
          </button>
        )}
        <button
          className="btn sm"
          disabled={bezig !== null || !verbonden}
          onClick={() => void doe('relaties', async () => {
            const uit = await exactSyncRelaties()
            setStand(uit)
            toast.ok(`${uit.aantal} relaties opgehaald.`)
          })}
        >
          {bezig === 'relaties' ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
          Relaties ophalen
        </button>
        <button
          className="btn primary sm"
          disabled={bezig !== null || !stand?.aan || klaar.length === 0}
          onClick={() => void doe('sturen', async () => {
            const uit = await exactStuurFacturen()
            setStand(uit)
            toast.ok(uit.mislukt2.length > 0
              ? `${uit.gelukt} verstuurd, ${uit.mislukt2.length} mislukt.`
              : `${uit.gelukt} factuur${uit.gelukt === 1 ? '' : 'en'} verstuurd.`)
          })}
        >
          {bezig === 'sturen' ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          Nu versturen ({klaar.length})
        </button>
      </div>

      {/* ---- wat er nog moet staan ---- */}

      {stand && stand.ontbreekt.length > 0 && (
        <div className="waarschuwing mb">
          <TriangleAlert size={14} />
          <span>Er ontbreekt nog: {stand.ontbreekt.join(', ')}.</span>
        </div>
      )}

      <div className="grid cols-3 mb">
        <Field label="Inkoopdagboek" help="Vaak 70. Haal de lijst op om te kiezen.">
          <div className="row">
            <input
              className="input mono" style={{ flex: 1 }}
              defaultValue={stand?.dagboek ?? ''}
              list="exact-dagboeken"
              placeholder="70"
              onBlur={(e) => void zetInstelling('exact_dagboek', e.currentTarget.value.trim()).then(laad)}
            />
            <button className="btn ghost sm" disabled={!verbonden}
              onClick={() => void doe('dagboeken', async () => setDagboeken(await exactDagboeken()))}>
              <Download size={13} />
            </button>
          </div>
          <datalist id="exact-dagboeken">
            {(dagboeken ?? []).map((d) => (
              <option key={d.code} value={d.code}>{d.naam}{d.inkoop ? ' (inkoop)' : ''}</option>
            ))}
          </datalist>
        </Field>

        {([21, 9, 0] as const).map((pct) => (
          <Field key={pct} label={`Btw-code ${pct}%`} help={pct === 21 ? 'Verplicht; de rest mag leeg.' : undefined}>
            <div className="row">
              <input
                className="input mono" style={{ flex: 1 }}
                defaultValue={stand?.btw?.[String(pct)] ?? ''}
                list="exact-btw"
                onBlur={(e) => void zetInstelling(`exact_btw_${pct}`, e.currentTarget.value.trim()).then(laad)}
              />
              {pct === 21 && (
                <button className="btn ghost sm" disabled={!verbonden}
                  onClick={() => void doe('btw', async () => setCodes(await exactBtwCodes()))}>
                  <Download size={13} />
                </button>
              )}
            </div>
          </Field>
        ))}
      </div>

      <datalist id="exact-btw">
        {(codes ?? []).map((c) => (
          <option key={c.code} value={c.code}>{c.naam}{c.pct != null ? ` (${c.pct}%)` : ''}</option>
        ))}
      </datalist>

      {/* ---- wat er nog niet compleet is ---- */}

      {stuk.length > 0 && (
        <>
          <h4 style={{ marginTop: 18, marginBottom: 6 }}>
            Nog niet compleet ({stuk.length})
          </h4>
          <p className="help" style={{ marginTop: 0 }}>
            Deze bonnen zijn goedgekeurd maar kunnen nog niet weg. Meestal is de leverancier nog
            niet aan een crediteur in Exact gekoppeld.
          </p>
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr><th>Datum</th><th>Leverancier</th><th className="num">Excl.</th><th>Rekening</th><th>Mist</th></tr>
              </thead>
              <tbody>
                {stuk.map((b) => (
                  <tr key={b.id}>
                    <td>{b.datum ? dateShort(b.datum) : '—'}</td>
                    <td className="afgekapt">{b.leverancier}</td>
                    <td className="num">{b.bedrag > 0 ? money(b.bedrag) : '—'}</td>
                    <td className="mono">{b.grootboek ?? '—'}</td>
                    <td>
                      {b.mist.map((m) => <Badge key={m} tone="warn">{m}</Badge>)}
                      {b.fout && <span className="ts-sub"> · {b.fout}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="help" style={{ marginTop: 12, marginBottom: 0 }}>
        Een bon die is verstuurd draagt het boekingsnummer van Exact en gaat nooit een tweede
        keer — daar zit een slot op in de database, niet alleen in deze knop.
      </p>

      {/* ---- bevestigen: aanzetten ---- */}

      {aanzetten && (
        <Modal
          open
          title="Facturen naar Exact aanzetten?"
          subtitle="Vanaf dat moment worden er echte boekingen aangemaakt"
          onClose={() => setAanzetten(false)}
          width={560}
        >
          <div className="waarschuwing mb">
            <TriangleAlert size={14} />
            <span>
              Dit is de enige plek waar dit systeem iets in jullie boekhouding zet. Een boeking
              die eenmaal in Exact staat, haal je daar weg en niet hier.
            </span>
          </div>
          <p className="help" style={{ marginTop: 0 }}>
            Er staan nu <strong>{klaar.length}</strong> goedgekeurde facturen klaar die compleet
            zijn. Aanzetten stuurt ze nog niet — dat doe je met “Nu versturen”. Begin met één,
            kijk in Exact of hij klopt, en ga dan pas verder.
          </p>
          {stand && stand.ontbreekt.length > 0 && (
            <div className="waarschuwing zacht">
              <span>Let op: {stand.ontbreekt.join(', ')} ontbreekt nog. Zonder dat gaat er niets.</span>
            </div>
          )}
          <div className="row end" style={{ marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setAanzetten(false)}>Annuleren</button>
            <button className="btn primary" onClick={() => void doe('aan', () => zetAan(true))}>
              Aanzetten
            </button>
          </div>
        </Modal>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  Betalen
 *
 *  Casper: "zorg ervoor dat je hem ook op betaald kan zetten, evt een sepa
 *  bestand kan aanmaken."
 *
 *  Twee handelingen, en dat is geen omslachtigheid. Een bestand maken is
 *  niet hetzelfde als geld overmaken -- er kan van alles tussen komen: de
 *  bank weigert het, iemand vergeet te fiatteren, het blijft in de map
 *  staan. Pas als iemand zegt dat het is uitgevoerd, gaan de facturen op
 *  betaald.
 * ------------------------------------------------------------------ */

export function Betalen() {
  const [stand, setStand] = useState<BetaalStand | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [bv, setBv] = useState('')
  const [overgeslagen, setOvergeslagen] = useState<{ id: string; naam: string; reden: string }[]>([])

  async function laad() {
    try {
      const uit = await exactBetaalStand()
      setStand(uit)
      if (!bv && uit.administraties.length > 0) setBv(uit.administraties[0].code)
      setFout(null)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'De stand is niet op te halen.')
    }
  }

  useEffect(() => { void laad() }, [])

  async function doe(wat: string, werk: () => Promise<void>) {
    setBezig(wat)
    try {
      await werk()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dat lukte niet.')
    } finally {
      setBezig(null)
    }
  }

  /**
   * Het bestand aan de gebruiker geven.
   *
   * Via een blob en een onzichtbare link. De app draait ook als
   * Windows-programma en op een tablet; een gewone download is het enige dat
   * daar overal hetzelfde werkt.
   */
  function bewaar(naam: string, inhoud: string) {
    const blob = new Blob([inhoud], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = naam
    document.body.appendChild(a)
    a.click()
    a.remove()
    /* Even wachten voordat we hem weggooien: sommige browsers hebben de blob
       nog nodig als de download net begint. */
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const voorBv = (stand?.openstaand ?? []).filter((r) => !bv || r.administratie === bv)
  const zonderIban = voorBv.filter((r) => !r.iban)
  const adm = stand?.administraties.find((a) => a.code === bv)

  return (
    <Card
      title="Betalen"
      hint="Wat er openstaat, en een bestand voor de bank"
      action={
        <button className="btn ghost sm" onClick={() => void laad()} title="Opnieuw ophalen">
          <RefreshCw size={14} />
        </button>
      }
    >
      {fout && <div className="waarschuwing mb"><TriangleAlert size={14} /><span>{fout}</span></div>}

      <div className="row mb">
        {stand && (
          <span className="ts-sub">
            {stand.openstaand.length} facturen open · {money(stand.totaalOpen)} in totaal
            {stand.zonderIban > 0 && ` · ${stand.zonderIban} zonder rekeningnummer`}
          </span>
        )}
      </div>

      {/* ---- van welke rekening ---- */}

      <div className="grid cols-3 mb">
        <Field label="Betalen vanuit" help="Elke bv betaalt van zijn eigen rekening.">
          <select className="input" value={bv} onChange={(e) => setBv(e.currentTarget.value)}>
            {(stand?.administraties ?? []).map((a) => (
              <option key={a.code} value={a.code}>{a.code}{a.naam ? ` · ${a.naam}` : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Onze rekening" help="Komt in het bestand als rekening van de opdrachtgever.">
          <input className="input mono" readOnly value={adm?.eigenIban || ''} placeholder="nog niet ingevuld" />
        </Field>
        <Field label="Op naam van">
          <input className="input" readOnly value={adm?.eigenNaam || ''} placeholder="nog niet ingevuld" />
        </Field>
      </div>

      {adm && !adm.eigenIban && (
        <div className="waarschuwing mb">
          <TriangleAlert size={14} />
          <span>
            Voor {adm.code} staat er geen eigen rekeningnummer. Zonder dat kan er geen
            betaalbestand gemaakt worden.
          </span>
        </div>
      )}

      {zonderIban.length > 0 && (
        <div className="waarschuwing zacht mb">
          <TriangleAlert size={14} />
          <span>
            {zonderIban.length} factuur/facturen hebben geen rekeningnummer. De lezer haalt dat
            van de factuur; staat het er niet op, dan moet die betaling met de hand.
          </span>
        </div>
      )}

      <div className="row mb">
        <button
          className="btn primary sm"
          disabled={bezig !== null || !adm?.eigenIban || voorBv.length === 0}
          onClick={() => void doe('sepa', async () => {
            const uit = await exactSepaMaken(bv)
            bewaar(uit.bestandsnaam, uit.xml)
            setOvergeslagen(uit.overgeslagen)
            await laad()
            toast.ok(`${uit.aantal} betalingen, ${money(uit.totaal)}. Het bestand is opgeslagen.`)
          })}
        >
          {bezig === 'sepa' ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
          Betaalbestand maken ({voorBv.length - zonderIban.length})
        </button>
      </div>

      {overgeslagen.length > 0 && (
        <div className="waarschuwing zacht mb">
          <TriangleAlert size={14} />
          <span>
            Niet meegenomen:{' '}
            {overgeslagen.map((o) => `${o.naam} (${o.reden})`).join(', ')}.
          </span>
        </div>
      )}

      {/* ---- de opdrachten ---- */}

      {(stand?.batches ?? []).length > 0 && (
        <>
          <h4 style={{ marginTop: 18, marginBottom: 6 }}>Betaalopdrachten</h4>
          <p className="help" style={{ marginTop: 0 }}>
            Zet een opdracht pas op uitgevoerd als de bank hem werkelijk heeft gedraaid. Dán gaan
            de facturen op betaald.
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Gemaakt</th><th>Bv</th><th className="num">Aantal</th><th className="num">Totaal</th><th>Staat</th><th /></tr>
              </thead>
              <tbody>
                {(stand?.batches ?? []).map((b) => (
                  <tr key={b.id}>
                    <td>{dateTime(b.aangemaaktAt)}</td>
                    <td className="mono">{b.administratie ?? '—'}</td>
                    <td className="num">{b.aantal}</td>
                    <td className="num">{money(b.totaal)}</td>
                    <td>
                      {b.status === 'concept' && <Badge tone="warn" dot>nog niet uitgevoerd</Badge>}
                      {b.status === 'uitgevoerd' && <Badge tone="ok" dot>uitgevoerd</Badge>}
                      {b.door && <span className="ts-sub"> · {b.door}</span>}
                    </td>
                    <td>
                      {b.status === 'concept' && (
                        <button
                          className="btn sm"
                          disabled={bezig !== null}
                          onClick={() => {
                            if (!confirm(`${b.aantal} facturen op betaald zetten? Doe dit pas als de bank de opdracht heeft gedraaid.`)) return
                            void doe('uitvoeren', async () => {
                              const uit = await exactBatchUitvoeren(b.id)
                              setStand(uit)
                              toast.ok(`${uit.betaald} facturen op betaald gezet.`)
                            })
                          }}
                        >
                          <Check size={13} /> Uitgevoerd
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---- wat er openstaat ---- */}

      {voorBv.length > 0 && (
        <>
          <h4 style={{ marginTop: 18, marginBottom: 6 }}>Openstaand ({voorBv.length})</h4>
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr><th>Vervalt</th><th>Leverancier</th><th>Nummer</th><th className="num">Incl. btw</th><th>Rekening</th></tr>
              </thead>
              <tbody>
                {voorBv.map((r) => (
                  <tr key={r.id}>
                    <td>{r.vervaldatum ? dateShort(r.vervaldatum) : dateShort(r.datum)}</td>
                    <td className="afgekapt">{r.leverancier}</td>
                    <td className="mono">{r.factuurnummer ?? '—'}</td>
                    <td className="num">{money(r.bedragIncl)}</td>
                    <td className="mono afgekapt">
                      {r.iban || <Badge tone="warn">ontbreekt</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="help" style={{ marginTop: 12, marginBottom: 0 }}>
        Het bestand is pain.001.001.03, het formaat dat elke bank leest. Rekeningnummers worden
        vooraf nagerekend met de mod-97-toets: een bank weigert een bestand met één foute IBAN in
        zijn geheel, en die nummers komen van een factuur die door een model is gelezen.
      </p>
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 *  Verkoopfacturen
 *
 *  Casper: "bij een factuur moet je zowel inkomend als uitkomend nadenken."
 *
 *  Het scherm bij de klant rekende zijn facturen tot nu toe elke keer
 *  opnieuw uit: alle gereedgemelde wasbeurten van een maand bij elkaar. Dat
 *  is handig om te zien en het is geen factuur -- er is geen nummer, geen
 *  datum, en geen bedrag dat vastligt. Verandert er na het versturen iets aan
 *  een wasbeurt, dan verandert de "factuur" mee en klopt hij niet meer met
 *  het papier dat de klant heeft.
 *
 *  Drie stappen, en elke stap is een handeling van een mens:
 *
 *    opmaken    concepten uit de wasbeurten van een maand
 *    versturen  het nummer erop; daarna liggen de regels vast
 *    naar Exact als verkoopboeking, met de klant als relatie
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  Verkoopfacturen
 *
 *  Casper: "maar nu staan zowel binnenkomende als uitgaande facturen op
 *  dezelfde plek?" -- en daarna, op de vraag of Verkoop dezelfde behandeling
 *  moest krijgen als Inkoop: ja.
 *
 *  Dus dezelfde vorm: een rij vakjes bovenaan die teller en filter tegelijk
 *  is, een filterrij eronder, en een tabel met de kolommen waarop je
 *  sorteert. Wat er anders is dan bij inkoop staat in src/lib/verkoopstroom.ts
 *  -- kort gezegd: een verkoopfactuur heeft vier standen die gewoon in een
 *  kolom staan, en er komt geen lezer en geen tweede handtekening aan te pas.
 *
 *  Waarom dit scherm niet uit de plaatselijke opslag leest
 *  ------------------------------------------------------
 *
 *  De rest van de app werkt offline-eerst: schrijf lokaal, duw het daarna
 *  naar de server. Verkoopfacturen niet -- die tabel synchroniseert niet mee
 *  en dit scherm haalt zijn gegevens bij de serverfunctie op.
 *
 *  Dat is een keuze en geen vergetelheid. Een inkoopbon ontstaat overal: op
 *  een vestiging, in een mailbox, op een telefoon bij een tankstation. Een
 *  verkoopfactuur ontstaat op één plek -- achter het bureau van de
 *  administratie -- en de handelingen eromheen (opmaken, versturen, boeken)
 *  gaan allemaal via serverfuncties, want ze delen nummers uit en praten met
 *  Exact. Een plaatselijke kopie zou daar niets aan toevoegen behalve een
 *  tweede waarheid.
 *
 *  De prijs staat er wel: zonder verbinding is dit scherm leeg, en na een
 *  handeling wordt de hele stand opnieuw opgehaald in plaats van één rij
 *  bijgewerkt.
 * ------------------------------------------------------------------ */

export function Verkoop({ verbonden }: { verbonden: boolean }) {
  const [stand, setStand] = useState<VerkoopStand | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const [fout, setFout] = useState<string | null>(null)

  /* Standaard de vorige maand: die is af, en de huidige loopt nog. */
  const [periode, setPeriode] = useState(() => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  /* De filters. Dezelfde vier vragen als bij inkoop, met "klant" waar daar
     "leverancier" staat -- het is dezelfde vraag vanaf de andere kant. */
  const [zoek, setZoek] = useState('')
  const [klant, setKlant] = useState('')
  const [maand, setMaand] = useState('')
  const [bedrijf, setBedrijf] = useState('')
  const [stap, setStap] = useState<string | null>(null)

  async function laad() {
    try {
      setStand(await exactVerkoopStand())
      setFout(null)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'De stand is niet op te halen.')
    }
  }

  useEffect(() => { void laad() }, [])

  async function doe(wat: string, werk: () => Promise<void>) {
    setBezig(wat)
    try {
      await werk()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dat lukte niet.')
    } finally {
      setBezig(null)
    }
  }

  const facturen = useMemo(() => stand?.facturen ?? [], [stand])
  const balk = useMemo(() => verkoopstroom(facturen), [facturen])
  const buiten = useMemo(() => buitenStaand(facturen), [facturen])

  /* Wat er te kiezen valt, uit de facturen zelf -- een klant zonder factuur
     hoort niet in de keuzelijst, en een nieuwe hoort er meteen in te staan. */
  const klanten = useMemo(
    () => [...new Set(facturen.map((f) => f.klant).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'nl')),
    [facturen])

  const maanden = useMemo(
    () => [...new Set(facturen.map((f) => f.periode).filter((p): p is string => !!p))]
      .sort().reverse(),
    [facturen])

  const bedrijven = useMemo(
    () => [...new Set(facturen.map((f) => f.administratie).filter((a): a is string => !!a))]
      .sort(),
    [facturen])

  const rijen = useMemo(() => {
    const z = zoek.trim().toLowerCase()
    return facturen
      .filter((f) => !z
        || (f.nummer ?? '').toLowerCase().includes(z)
        || f.klant.toLowerCase().includes(z)
        || String(f.bedragIncl).includes(z))
      .filter((f) => !klant || f.klant === klant)
      .filter((f) => !maand || f.periode === maand)
      .filter((f) => !bedrijf || (f.administratie ?? '') === bedrijf)
      .filter((f) => !stap || verkoopstapVan(f) === stap)
  }, [facturen, zoek, klant, maand, bedrijf, stap])

  const chips = [
    ...(stap
      ? [{
          label: 'Stap',
          waarde: balk.find((b) => b.stap.sleutel === stap)?.stap.label ?? stap,
          weg: () => setStap(null),
        }]
      : []),
    ...(klant ? [{ label: 'Klant', waarde: klant, weg: () => setKlant('') }] : []),
    ...(maand ? [{ label: 'Periode', waarde: maand, weg: () => setMaand('') }] : []),
    ...(bedrijf ? [{ label: 'Onderneming', waarde: bedrijf, weg: () => setBedrijf('') }] : []),
    ...(zoek.trim() ? [{ label: 'Zoeken', waarde: zoek.trim(), weg: () => setZoek('') }] : []),
  ]

  function wisFilters() {
    setStap(null); setKlant(''); setMaand(''); setBedrijf(''); setZoek('')
  }

  const kolommen: Kolom<VerkoopFactuurRegel>[] = [
    {
      sleutel: 'nummer',
      kop: 'Nummer',
      breedte: 108,
      sorteer: (a, b) => (a.nummer ?? '').localeCompare(b.nummer ?? '', 'nl'),
      /* Een concept heeft er geen. Dat is geen ontbrekend gegeven maar een
         eigenschap van een concept -- zie de uitleg onderaan. */
      toon: (f) => (f.nummer
        ? <span className="mono sterk">{f.nummer}</span>
        : <span className="zacht">concept</span>),
    },
    {
      sleutel: 'klant',
      kop: 'Klant',
      sorteer: (a, b) => a.klant.localeCompare(b.klant, 'nl'),
      toon: (f) => <span className="sterk krimp">{f.klant}</span>,
    },
    {
      sleutel: 'periode',
      kop: 'Periode',
      breedte: 96,
      zacht: true,
      wegOnder: 1200,
      sorteer: (a, b) => (a.periode ?? '').localeCompare(b.periode ?? ''),
      toon: (f) => <span className="mono">{f.periode ?? '—'}</span>,
    },
    {
      sleutel: 'datum',
      kop: 'Datum',
      breedte: 108,
      sorteer: (a, b) => a.datum - b.datum,
      toon: (f) => dateShort(f.datum),
    },
    {
      sleutel: 'vervalt',
      kop: 'Vervalt',
      breedte: 110,
      zacht: true,
      wegOnder: 1360,
      sorteer: (a, b) => (a.vervaldatum ?? 0) - (b.vervaldatum ?? 0),
      /* Te laat springt eruit. Bij Casper in Blue10 staan 559 facturen onder
         de omschrijving "Verstreken vervaldatum"; dan hoort het geen grijze
         datum tussen de andere te zijn. */
      toon: (f) => (f.vervaldatum
        ? (
          <span className={verkoopTeLaat(f) ? 'tekst-laat' : undefined}>
            {dateShort(f.vervaldatum)}
          </span>
          )
        : '—'),
    },
    {
      sleutel: 'bv',
      kop: 'Onderneming',
      breedte: 130,
      zacht: true,
      wegOnder: 1500,
      sorteer: (a, b) => (a.administratie ?? '').localeCompare(b.administratie ?? ''),
      toon: (f) => <span className="mono">{f.administratie ?? '—'}</span>,
    },
    {
      sleutel: 'excl',
      kop: 'Excl.',
      breedte: 104,
      getal: true,
      zacht: true,
      wegOnder: 1100,
      sorteer: (a, b) => a.bedragExcl - b.bedragExcl,
      toon: (f) => money(f.bedragExcl),
    },
    {
      sleutel: 'incl',
      kop: 'Incl.',
      breedte: 110,
      getal: true,
      sorteer: (a, b) => a.bedragIncl - b.bedragIncl,
      toon: (f) => money(f.bedragIncl),
    },
    {
      sleutel: 'signalen',
      kop: '',
      breedte: 64,
      toon: (f) => {
        const klem = verkoopKlem(f)
        return (
          <span className="signalen">
            {klem && (
              <span className="mis" title={klem}>
                <TriangleAlert size={14} />
              </span>
            )}
            {!klem && verkoopTeLaat(f) && (
              <span className="let" title="Over de vervaldatum en nog niet betaald">
                <TriangleAlert size={14} />
              </span>
            )}
            {f.exactId && (
              <span className="goed" title={`Geboekt in Exact (${f.exactId})`}>
                <Check size={14} />
              </span>
            )}
          </span>
        )
      },
    },
    {
      sleutel: 'stand',
      kop: 'Staat',
      breedte: 126,
      sorteer: (a, b) => a.status.localeCompare(b.status),
      toon: (f) => <VerkoopStaat factuur={f} />,
    },
    {
      sleutel: 'acties',
      kop: '',
      breedte: 110,
      toon: (f) => (f.status === 'concept'
        ? (
          <Knop
            klein
            disabled={bezig !== null || f.bedragExcl <= 0}
            title={f.bedragExcl <= 0
              ? 'Een factuur van nul euro versturen heeft geen zin'
              : 'Geeft hem een nummer en zet de regels vast'}
            onClick={(e) => {
              e.stopPropagation()
              void doe('versturen', async () => {
                const uit = await exactVerkoopVersturen(f.id)
                setStand(uit)
                toast.ok(`Factuur ${uit.nummer} verstuurd.`)
              })
            }}
          >
            Versturen
          </Knop>
          )
        : null),
    },
  ]

  return (
    <>
      <Paginakop
        titel="Verkoopfacturen"
        uitleg="Wat wij aan klanten sturen"
        acties={(
          <>
            <Knop
              klein
              ikoon={<RefreshCw size={14} />}
              title="Opnieuw ophalen"
              onClick={() => void laad()}
            />
            <Knop
              soort="hoofd"
              klein
              ikoon={<Send size={15} />}
              bezig={bezig === 'exact'}
              disabled={bezig !== null || !verbonden || (stand?.naarExact ?? 0) === 0}
              onClick={() => void doe('exact', async () => {
                const uit = await exactStuurVerkoop()
                setStand(uit)
                toast.ok(uit.mislukt2.length > 0
                  ? `${uit.gelukt} geboekt, ${uit.mislukt2.length} mislukt.`
                  : `${uit.gelukt} factuur${uit.gelukt === 1 ? '' : 'en'} geboekt in Exact.`)
              })}
            >
              Naar Exact ({stand?.naarExact ?? 0})
            </Knop>
          </>
        )}
      />

      {fout && <p className="waarschuwing"><TriangleAlert size={14} /> {fout}</p>}

      {/*
        * Wat er buiten staat, als één getal.
        *
        * Los van de vakjes met opzet: "boeken" en "openstaand" zijn allebei
        * geld dat nog moet komen, en dat totaal zou verdwijnen als het over
        * twee vakjes verdeeld bleef. Dit is het getal waar je 's ochtends
        * naar kijkt.
        */}
      <div className="kerncijfers">
        <span className={buiten.aantal ? 'let' : undefined}>
          <b>{buiten.aantal}</b> openstaand
        </span>
        <span className="scheiding" aria-hidden="true">·</span>
        <span><b>{money(buiten.bedrag)}</b> buiten</span>
        {buiten.telaat > 0 && (
          <>
            <span className="scheiding" aria-hidden="true">·</span>
            <span className="let">
              <b>{buiten.telaat}</b> te laat ({money(buiten.telaatBedrag)})
            </span>
          </>
        )}
        <span className="scheiding" aria-hidden="true">·</span>
        <span><b>{stand?.concepten ?? 0}</b> concept</span>
      </div>

      {/*
        * Het verkoopdagboek.
        *
        * Dit veld stond in de vorige versie van dit scherm en is de ENIGE
        * plek in de hele app waar exact_verkoopdagboek te zetten is -- het
        * staat niet in SLEUTELS en nergens in een instellingenscherm. Bij het
        * herbouwen was hij bijna weggevallen; dan had Exact elke
        * verkoopboeking geweigerd zonder dat er nog iets was om het mee recht
        * te zetten.
        *
        * Klein en op één regel, want je zet hem één keer. De waarschuwing
        * hierboven zegt wel hardop wanneer hij ontbreekt.
        */}
      <p className="help" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
        <label htmlFor="verkoopdagboek">Verkoopdagboek in Exact</label>
        <input
          id="verkoopdagboek"
          className="input mono"
          style={{ width: 88 }}
          defaultValue={stand?.verkoopdagboek ?? ''}
          list="exact-dagboeken"
          placeholder="50"
          onBlur={(e) => void zetInstelling(
            'exact_verkoopdagboek', e.currentTarget.value.trim()).then(laad)}
        />
      </p>

      {/*
        * Waarom een stapel bij "Boeken" er niet altijd een is.
        *
        * Zonder deze twee regels ziet een groeiend vakje eruit als een
        * achterstand waar iemand naar moet kijken, terwijl de schakelaar
        * gewoon uit staat of het dagboek niet is ingevuld. Dat is precies het
        * soort stilte waar je een middag aan kwijt bent.
        */}
      {stand?.boekenAan === false && (
        <p className="waarschuwing zacht">
          <TriangleAlert size={14} />{' '}
          Boeken naar Exact staat uit. Wat hier bij "Boeken" staat is dus geen
          achterstand -- het wacht tot je die schakelaar omzet bij Boekhouding.
        </p>
      )}
      {stand?.boekenAan !== false && stand && !stand.verkoopdagboek && (
        <p className="waarschuwing zacht">
          <TriangleAlert size={14} />{' '}
          Er staat geen verkoopdagboek ingesteld. Zonder dat weigert Exact een
          verkoopboeking.
        </p>
      )}

      <Stroombalk
        vakjes={balk.map((b) => ({
          sleutel: b.stap.sleutel,
          label: b.stap.label,
          uitleg: b.stap.uitleg,
          aantal: b.aantal,
          stuk: b.klem,
          telaat: b.telaat,
        }))}
        gekozen={stap}
        kies={setStap}
      />

      <Filterbalk>
        <Zoekveld
          waarde={zoek}
          zet={setZoek}
          hint="Zoek op nummer, klant, bedrag…"
          sneltoets
        />

        <select
          value={klant}
          onChange={(e) => setKlant(e.target.value)}
          data-aan={klant ? 'ja' : undefined}
          aria-label="Filter op klant"
        >
          <option value="">Alle klanten</option>
          {klanten.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>

        <select
          value={maand}
          onChange={(e) => setMaand(e.target.value)}
          data-aan={maand ? 'ja' : undefined}
          aria-label="Filter op periode"
        >
          <option value="">Alle perioden</option>
          {maanden.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>

        {bedrijven.length > 1 && (
          <select
            value={bedrijf}
            onChange={(e) => setBedrijf(e.target.value)}
            data-aan={bedrijf ? 'ja' : undefined}
            aria-label="Filter op onderneming"
          >
            <option value="">Alle ondernemingen</option>
            {bedrijven.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}

        {/* Opmaken hoort bij de filterrij en niet bij de hoofdacties: het is
            geen knop die je elke dag indrukt, en hij heeft een maand nodig. */}
        <span className="row" style={{ gap: 'var(--s2)', marginLeft: 'auto' }}>
          <input
            className="input mono"
            style={{ width: 96 }}
            value={periode}
            onChange={(e) => setPeriode(e.target.value)}
            placeholder="2026-03"
            aria-label="Welke maand opmaken"
          />
          <Knop
            klein
            ikoon={<Plus size={14} />}
            bezig={bezig === 'opmaken'}
            disabled={bezig !== null}
            title="Alle gereedgemelde wasbeurten van die maand die nog niet op een factuur staan"
            onClick={() => void doe('opmaken', async () => {
              const uit = await exactVerkoopOpmaken(periode)
              setStand(uit)
              toast.ok(uit.gemaakt > 0
                ? `${uit.gemaakt} conceptfactuur${uit.gemaakt === 1 ? '' : 'en'} opgemaakt.`
                : 'Er was niets nieuws te factureren over die maand.')
            })}
          >
            Opmaken
          </Knop>
        </span>
      </Filterbalk>

      <Filterchips chips={chips} wisAlles={wisFilters} />

      <Tabel
        rijen={rijen}
        kolommen={kolommen}
        sleutelVan={(f) => f.id}
        sorteerOp="datum"
        omgekeerd
        laden={stand === null && fout === null}
        leeg={(
          <LeegStaat
            gefilterd={chips.length > 0}
            titel={chips.length > 0
              ? 'Geen facturen die hieraan voldoen'
              : 'Nog geen verkoopfacturen'}
            uitleg={chips.length > 0
              ? 'Haal een filter weg om meer te zien.'
              : 'Maak een maand op om te beginnen: dan wordt elke gereedgemelde '
                + 'wasbeurt van die maand een regel op een conceptfactuur.'}
          />
        )}
      />

      <p className="help" style={{ marginTop: 12, marginBottom: 0 }}>
        Een concept heeft nog geen nummer — dat zou een gat in de reeks achterlaten als je hem
        weggooit. Bij versturen krijgt hij er een en liggen de regels vast; wat daarna nog kan is
        een creditnota, en dat is een nieuwe factuur.
      </p>
    </>
  )
}

/** De staat van een verkoopfactuur: een stip én een woord. */
function VerkoopStaat({ factuur }: { factuur: VerkoopFactuurRegel }) {
  if (factuur.status === 'concept') return <Stand stemming="nieuw">Concept</Stand>
  if (factuur.status === 'betaald') return <Stand stemming="betaald">Betaald</Stand>
  if (factuur.status === 'vervallen') return <Stand stemming="afgekeurd">Vervallen</Stand>
  /* Verstuurd. Of dat "wacht op de klant" of "wacht op ons" betekent, hangt
     ervan af of hij al geboekt is -- en dat verschil is wat de stroombalk
     erboven ook maakt. */
  return factuur.exactId
    ? <Stand stemming="wacht">Openstaand</Stand>
    : <Stand stemming="bezig">Te boeken</Stand>
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
