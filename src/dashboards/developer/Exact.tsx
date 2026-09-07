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

import { useEffect, useState } from 'react'
import {
  ExternalLink, Link2, Link2Off, Loader2, RefreshCw, Save, TriangleAlert,
} from 'lucide-react'
import {
  exactInstellen, exactLos, exactStatus, exactVerbindUrl, type ExactStatus,
} from '../../lib/trucksupply'
import { dateTime, relative } from '../../lib/format'
import { Badge, Card, Field } from '../../components/ui'
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

  /* De velden van het formulier. */
  const [clientId, setClientId] = useState('')
  const [geheim, setGeheim] = useState('')
  const [basis, setBasis] = useState('')
  const [redirect, setRedirect] = useState('')
  const [omgeving, setOmgeving] = useState<'proef' | 'echt'>('proef')

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
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'De status is niet op te halen.')
    }
  }

  useEffect(() => { void laad() }, [])

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
                    if (!venster) toast.warn('Het venster werd geblokkeerd. Sta pop-ups toe en probeer opnieuw.')
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
    </div>
  )
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
