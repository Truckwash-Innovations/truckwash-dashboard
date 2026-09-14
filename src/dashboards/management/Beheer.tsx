import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bell, Database, Download, HardDrive, KeyRound, RefreshCw, ServerCog,
  ShieldCheck, Trash2, TriangleAlert, Users, Wifi, WifiOff,
} from 'lucide-react'
import { db, setMeta, alleMensen } from '../../lib/db'
import {
  haalLidWeg, maakPostbus, zetLid, zetPostbusActief,
} from '../../lib/werkmail'
import { LAST_SYNC, useSync } from '../../lib/sync'
import { activeBackend, isForcedOffline, setForcedOffline } from '../../lib/api'
import { useUpdates } from '../../lib/updates'
import {
  PERMISSIONS, ROLE_LABELS, SERVICES,
  type Postbus, type PostbusLid, type Role, type User,
} from '../../lib/types'
import { effectivePermissions } from '../../lib/permissions'
import { money, relative } from '../../lib/format'
import { Badge, Card, Empty, Modal, Stat } from '../../components/ui'
import { notifyPermissionState, requestNotifyPermission } from '../../lib/notify'
import { toast } from '../../store/useToasts'
import { SLEUTELS, leesInstelling, zetInstelling } from '../../lib/instellingen'
import { useAuth } from '../../store/useAuth'

/* ------------------------------------------------------------------ *
 *  Beheerderspaneel
 *
 *  Alles wat je maar één keer per zoveel tijd nodig hebt, maar dan wel op
 *  één plek: welke backend draait er, hoe staat de synchronisatie ervoor,
 *  wie heeft welke rechten, en de knoppen om de lokale gegevens op te ruimen.
 * ------------------------------------------------------------------ */

export default function Beheer() {
  const sync = useSync()
  const { version, channel, state, check } = useUpdates()
  const [flight, setFlight] = useState(isForcedOffline())
  const [notif, setNotif] = useState(notifyPermissionState())
  const [busy, setBusy] = useState(false)

  const users = useLiveQuery(() => alleMensen(), [], [] as User[])
  const counts = useLiveQuery(async () => ({
    users: await db.users.count(),
    companies: await db.companies.count(),
    washJobs: await db.washJobs.count(),
    shifts: await db.shifts.count(),
    inventory: await db.inventory.count(),
    expenses: await db.expenses.count(),
    timeEntries: await db.timeEntries.count(),
    notifications: await db.notifications.count(),
    courses: await db.courses.count(),
    courseProgress: await db.courseProgress.count(),
    outbox: await db.outbox.count(),
  }), [], null)

  const totaalRecords = counts
    ? Object.entries(counts).filter(([k]) => k !== 'outbox').reduce((a, [, v]) => a + v, 0)
    : 0

  const rechtenPerRol = useMemo(() => {
    const map = new Map<Role, number>()
    for (const u of users) for (const r of u.roles) map.set(r, (map.get(r) ?? 0) + 1)
    return map
  }, [users])

  async function volledigeSync() {
    setBusy(true)
    try {
      await setMeta(LAST_SYNC, 0)
      useSync.setState({ lastSyncAt: null })
      await sync.sync()
      toast.ok('Alles opnieuw opgehaald van de server')
    } finally {
      setBusy(false)
    }
  }

  async function cacheLegen() {
    setBusy(true)
    try {
      const wachtrij = await db.outbox.count()
      if (wachtrij > 0) {
        toast.error(`Er staan nog ${wachtrij} wijzigingen in de wachtrij. Synchroniseer eerst.`)
        return
      }
      await Promise.all([
        db.users.clear(), db.companies.clear(), db.washJobs.clear(),
        db.inventory.clear(), db.stockMovements.clear(), db.expenses.clear(),
        db.timeEntries.clear(), db.shifts.clear(), db.notifications.clear(),
        db.courses.clear(), db.courseProgress.clear(),
      ])
      await setMeta(LAST_SYNC, 0)
      useSync.setState({ lastSyncAt: null })
      await sync.sync()
      toast.ok('Lokale gegevens opnieuw opgebouwd')
    } finally {
      setBusy(false)
    }
  }

  function toggleFlight() {
    const next = !flight
    setFlight(next)
    setForcedOffline(next)
    toast.info(next ? 'Offline-test aan' : 'Weer verbonden')
  }

  async function vraagMeldingen() {
    setNotif(await requestNotifyPermission())
  }

  return (
    <>
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Backend"
          value={activeBackend === 'supabase' ? 'Supabase' : activeBackend === 'mock' ? 'Testmodus' : 'Niet ingesteld'}
          icon={<ServerCog size={17} />}
          tone={activeBackend === 'supabase' ? 'ok' : 'warn'}
        />
        <Stat
          label="Synchronisatie"
          value={sync.pending > 0 ? `${sync.pending} in wachtrij` : 'Bij'}
          delta={sync.lastSyncAt ? { text: relative(sync.lastSyncAt), dir: 'flat' } : undefined}
          icon={sync.online ? <Wifi size={17} /> : <WifiOff size={17} />}
          tone={sync.pending > 0 ? 'warn' : 'ok'}
        />
        <Stat label="Records lokaal" value={totaalRecords} icon={<Database size={17} />} />
        <Stat label="Versie" value={version} delta={{ text: channel, dir: 'flat' }} icon={<Download size={17} />} />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <Card title="Verbinding en gegevens">
          <div className="setting-row">
            <div>
              <div className="setting-label">Volledig opnieuw ophalen</div>
              <div className="setting-hint">
                Zet de teller op nul en haalt alles opnieuw op. Handig als iets
                niet klopt met wat je op de server ziet.
              </div>
            </div>
            <button className="btn sm" onClick={() => void volledigeSync()} disabled={busy || !sync.online}>
              <RefreshCw size={14} className={busy ? 'spin' : ''} /> Ophalen
            </button>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">Lokale gegevens opnieuw opbouwen</div>
              <div className="setting-hint">
                Wist de cache op dit apparaat en haalt alles vers op. Lukt niet
                zolang er wijzigingen in de wachtrij staan.
              </div>
            </div>
            <button className="btn danger sm" onClick={() => void cacheLegen()} disabled={busy || !sync.online}>
              <Trash2 size={14} /> Opnieuw opbouwen
            </button>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-label">Offline testen</div>
              <div className="setting-hint">
                Doet alsof er geen internet is, zodat je kunt zien hoe de app
                zich zonder verbinding gedraagt.
              </div>
            </div>
            <button className={`btn sm ${flight ? 'danger' : ''}`} onClick={toggleFlight}>
              {flight ? <WifiOff size={14} /> : <Wifi size={14} />}
              {flight ? 'Aan' : 'Uit'}
            </button>
          </div>

          <div className="setting-row" style={{ borderBottom: 0 }}>
            <div>
              <div className="setting-label">Meldingen op dit apparaat</div>
              <div className="setting-hint">
                {notif === 'granted'
                  ? 'Staan aan. Je krijgt berichten ook als de app dicht is.'
                  : notif === 'denied'
                    ? 'Geblokkeerd. Zet ze aan in de instellingen van je apparaat.'
                    : 'Nog niet aangezet.'}
              </div>
            </div>
            <button
              className={`btn sm ${notif === 'granted' ? 'ok' : ''}`}
              onClick={() => void vraagMeldingen()}
              disabled={notif === 'granted'}
            >
              <Bell size={14} /> {notif === 'granted' ? 'Aan' : 'Aanzetten'}
            </button>
          </div>
        </Card>

        <Card title="Updates">
          <div className="setting-row">
            <div>
              <div className="setting-label">Kanaal</div>
              <div className="setting-hint">
                {channel === 'windows'
                  ? 'Windows: GitHub Releases. Controleert bij het opstarten en elk half uur.'
                  : channel === 'mobile'
                    ? 'Mobiel: nieuwe webbundel zonder store-review.'
                    : 'Web: herladen geeft de nieuwste versie.'}
              </div>
            </div>
            <Badge tone="brand">{channel}</Badge>
          </div>

          <div className="setting-row" style={{ borderBottom: 0 }}>
            <div>
              <div className="setting-label">Nu controleren</div>
              <div className="setting-hint">
                Status: {state === 'idle' ? 'nog niet gecontroleerd' : state}
              </div>
            </div>
            <button className="btn sm" onClick={() => void check()}>
              <Download size={14} /> Controleren
            </button>
          </div>

          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
            <div className="setting-label" style={{ marginBottom: 8 }}>Tarieven</div>
            <div style={{ display: 'grid', gap: 5 }}>
              {Object.entries(SERVICES).map(([key, s]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.83rem' }}>
                  <span style={{ color: 'var(--text-2)' }}>{s.label}</span>
                  <span className="mono">{money(s.price)} · {s.minutes} min</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '.75rem', color: 'var(--text-3)', marginTop: 8 }}>
              Tarieven staan nu in de code. Wil je ze in de app kunnen wijzigen,
              dan zet ik daar een tabel voor klaar.
            </div>
          </div>
        </Card>

        <Werkadressen />
        <GedeeldePostvakken />
      </div>

      <Card title="Rechtenoverzicht" hint="Wat iedereen daadwerkelijk mag" flush className="mb">
        {users.length === 0 ? (
          <Empty text="Geen gebruikers." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Gebruiker</th>
                  <th>Rollen</th>
                  <th className="num">Rechten</th>
                  <th>Handmatig aangepast</th>
                  <th>Inlogaccount</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const eff = effectivePermissions(u)
                  const afwijkingen = (u.grants?.length ?? 0) + (u.revokes?.length ?? 0)
                  return (
                    <tr key={u.id} style={{ opacity: u.active ? 1 : .5 }}>
                      <td>
                        <strong>{u.name}</strong>
                        <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>{u.email}</div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {u.roles.map((r) => (
                            <Badge key={r} tone={r === 'management' ? 'brand' : 'default'}>
                              {r === 'management' && <ShieldCheck size={11} />}
                              {ROLE_LABELS[r]}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="num">{eff.size} / {PERMISSIONS.length}</td>
                      <td>
                        {afwijkingen > 0
                          ? <Badge tone="warn">{u.grants?.length ?? 0} extra, {u.revokes?.length ?? 0} ingetrokken</Badge>
                          : <span style={{ color: 'var(--text-3)', fontSize: '.8rem' }}>volgt de rol</span>}
                      </td>
                      <td>
                        {u.authId
                          ? <Badge tone="ok">Gekoppeld</Badge>
                          : <Badge tone="warn"><KeyRound size={11} /> Geen login</Badge>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid cols-2">
        <Card title="Wat er lokaal staat" hint="Op dit apparaat">
          {counts ? (
            <div style={{ display: 'grid', gap: 5 }}>
              {Object.entries(counts).map(([key, value]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.83rem' }}>
                  <span style={{ color: key === 'outbox' && value > 0 ? 'var(--warn)' : 'var(--text-2)' }}>
                    {key === 'outbox' ? 'Wachtrij (nog te versturen)' : key}
                  </span>
                  <span className="mono">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Bezig met tellen…" icon={<HardDrive size={30} />} />
          )}
        </Card>

        <Card title="Rollen in gebruik">
          <div style={{ display: 'grid', gap: 9 }}>
            {[...rechtenPerRol.entries()].map(([role, n]) => (
              <div key={role}>
                <div className="row" style={{ justifyContent: 'space-between', fontSize: '.85rem', marginBottom: 4 }}>
                  <span>{ROLE_LABELS[role]}</span>
                  <span className="mono">{n}</span>
                </div>
                <div className="bar">
                  <span style={{ width: `${(n / Math.max(1, users.length)) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>

          {sync.lastError && (
            <div
              style={{
                marginTop: 16, padding: '11px 13px', borderRadius: 'var(--radius-sm)',
                background: 'rgba(244,104,95,.1)', border: '1px solid rgba(244,104,95,.3)',
                fontSize: '.82rem', color: '#ffbdb8',
              }}
            >
              <div className="row" style={{ gap: 8 }}>
                <TriangleAlert size={15} />
                <span><strong>Laatste synchronisatiefout:</strong> {sync.lastError}</span>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Werkadressen
 *
 *  Het adres zelf deel je per persoon uit, in zijn dossier. Maar het stuk
 *  achter de @ is er één voor het hele bedrijf, en dat stond tot nu toe
 *  alleen in de database -- zonder scherm om het te zetten.
 *
 *  Gevolg: de knop "Werkadres aanzetten" in een dossier stond er wel en kon
 *  niets, want hij wist niet wat hij achter de voornaam moest zetten. Een
 *  knop die niets doet omdat er elders iets ontbreekt is erger dan een knop
 *  die er niet is: je gaat zoeken in het verkeerde scherm.
 * ------------------------------------------------------------------ */

function Werkadressen() {
  const [domein, setDomein] = useState('')
  const [geladen, setGeladen] = useState(false)
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    let levend = true
    void leesInstelling(SLEUTELS.werkDomein).then((waarde) => {
      if (!levend) return
      setDomein(waarde ?? '')
      setGeladen(true)
    })
    return () => { levend = false }
  }, [])

  /*
   * Een domein en geen mailadres. Wie hier "jan@truckwash1group.nl" intikt
   * krijgt straks "piet@jan@truckwash1group.nl", en dat valt pas op als er
   * post niet aankomt.
   */
  const kaal = domein.trim().toLowerCase().replace(/^@/, '')
  const fout = !geladen || kaal === ''
    ? null
    : kaal.includes('@') ? 'Alleen het stuk ná de @.'
    : !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(kaal) ? 'Dat lijkt geen domein.'
    : null

  async function bewaar() {
    if (fout) return
    setBezig(true)
    try {
      await zetInstelling(SLEUTELS.werkDomein, kaal)
      toast.ok(kaal
        ? `Werkadressen worden voornaam@${kaal}`
        : 'Uitgezet. Er kunnen geen werkadressen meer bij.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukte.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Card title="Werkadressen" hint="Het domein achter de @">
      <div className="setting-row" style={{ borderBottom: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="setting-label">Domein</div>
          <div className="setting-hint">
            Iemand met de voornaam Jan krijgt jan@{kaal || 'domein.nl'}. Het
            adres zelf deel je uit in het dossier van die persoon, onder
            “Werkadres”.
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginTop: 4 }}>
        <input
          className="input"
          value={domein}
          placeholder="truckwash1group.nl"
          onChange={(e) => setDomein(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button className="btn sm primary" disabled={bezig || !!fout} onClick={() => void bewaar()}>
          Opslaan
        </button>
      </div>
      {fout && (
        <span className="help danger" style={{ color: 'var(--text-danger)' }}>{fout}</span>
      )}

      <p className="help" style={{ marginTop: 12 }}>
        Het domein moet bij Resend geverifieerd zijn (SPF en DKIM) én de
        inkomende post moet naar de functie <span className="mono">ontvang-mail</span>
        wijzen. Staat dat niet klaar, dan kun je hier wel een adres uitdelen
        maar komt er niets aan en gaat er niets weg.
      </p>
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 *  Gedeelde postvakken
 *
 *  Casper: "en echt postvakken kunnen maken ect."
 *
 *  info@, verkoop@ -- een adres dat niet aan een mens hangt maar aan het
 *  bedrijf. Wie erbij mag staat er met naam bij; er is geen regel die het
 *  management er ongevraagd in laat kijken, en dat is met opzet zo gebleven
 *  (zie de kop van 0084). Wil je erin, zet jezelf er dan bij -- dan staat het
 *  ergens opgeschreven.
 *
 *  Weggooien kan niet. Er hangt post aan, en "weg" is dan hetzelfde als
 *  "kwijt". Een postvak dat je niet meer gebruikt zet je dicht; het adres
 *  blijft bezet en de post blijft staan.
 * ------------------------------------------------------------------ */

function GedeeldePostvakken() {
  const ik = useAuth((s) => s.user)!
  const vakken = useLiveQuery(() => db.postbussen.toArray(), [], [] as Postbus[])
  const leden = useLiveQuery(() => db.postbusLeden.toArray(), [], [] as PostbusLid[])
  const mensen = useLiveQuery(() => alleMensen(), [], [] as User[])

  const [adres, setAdres] = useState('')
  const [naam, setNaam] = useState('')
  const [bezig, setBezig] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  async function maak() {
    setBezig(true)
    try {
      const vak = await maakPostbus({ adres, naam, door: ik })
      toast.ok(vak.adres + ' aangemaakt')
      setAdres('')
      setNaam('')
      /* Meteen open, want het is nog van niemand: een postvak zonder leden
         neemt wel post aan en laat niemand kijken. */
      setOpen(vak.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dat lukte niet.')
    } finally {
      setBezig(false)
    }
  }

  const gekozen = open ? vakken.find((v) => v.id === open) ?? null : null

  return (
    <Card title="Gedeelde postvakken" hint="info@, verkoop@ — met wie erbij mag">
      {vakken.length === 0 ? (
        <p className="help" style={{ marginTop: 0 }}>
          Nog geen gedeeld postvak. Post op zo’n adres komt binnen bij iedereen
          die je eraan toevoegt, en zij kunnen er ook namens antwoorden.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          {vakken.map((v) => {
            const hoeveel = leden.filter((l) => l.postbusId === v.id).length
            return (
              <div key={v.id} className="setting-row" style={{ borderBottom: 0, padding: '6px 0' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="setting-label">
                    {v.naam} {!v.actief && <Badge tone="warn">dicht</Badge>}
                  </div>
                  <div className="setting-hint" style={{ wordBreak: 'break-all' }}>
                    {v.adres} · {hoeveel === 0
                      ? 'nog niemand'
                      : `${hoeveel} ${hoeveel === 1 ? 'persoon' : 'mensen'}`}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm ghost" onClick={() => setOpen(v.id)}>
                    <Users size={14} /> Wie
                  </button>
                  <button
                    className={`btn sm ${v.actief ? 'ghost danger' : ''}`}
                    onClick={() => void zetPostbusActief(v, !v.actief).then(() =>
                      toast.ok(v.actief
                        ? 'Dicht. Het adres blijft bezet en de post blijft staan.'
                        : 'Weer open.'))}
                  >
                    {v.actief ? 'Sluiten' : 'Openen'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          className="input"
          value={adres}
          placeholder="info@truckwash1group.nl"
          onChange={(e) => setAdres(e.target.value)}
          style={{ flex: '1 1 220px', minWidth: 0 }}
        />
        <input
          className="input"
          value={naam}
          placeholder="Naam, bijv. Info"
          onChange={(e) => setNaam(e.target.value)}
          style={{ flex: '1 1 140px', minWidth: 0 }}
        />
        <button className="btn sm primary" disabled={bezig || !adres.trim()} onClick={() => void maak()}>
          Aanmaken
        </button>
      </div>

      <p className="help" style={{ marginTop: 12 }}>
        Het adres moet bij Resend op een geverifieerd domein staan en naar de
        functie <span className="mono">ontvang-mail</span> wijzen. Anders kun
        je hier wel een postvak aanmaken maar komt er niets in.
      </p>

      {gekozen && (
        <PostvakLeden
          vak={gekozen}
          leden={leden.filter((l) => l.postbusId === gekozen.id)}
          mensen={mensen}
          ikId={ik.id}
          sluit={() => setOpen(null)}
        />
      )}
    </Card>
  )
}

function PostvakLeden({
  vak, leden, mensen, ikId, sluit,
}: {
  vak: Postbus
  leden: PostbusLid[]
  mensen: User[]
  ikId: string
  sluit: () => void
}) {
  const [erbij, setErbij] = useState('')

  const kandidaten = mensen
    .filter((m) => m.active && !leden.some((l) => l.userId === m.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Modal open title={`Wie mag bij ${vak.adres}`} onClose={sluit} width={520}>
      {leden.length === 0 ? (
        <p className="help" style={{ marginTop: 0 }}>
          Nog niemand. Post die hier binnenkomt ziet dus ook niemand.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
          {leden.map((l) => {
            const wie = mensen.find((m) => m.id === l.userId)
            return (
              <div key={l.id} className="setting-row" style={{ borderBottom: 0, padding: '6px 0' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="setting-label">{wie?.name ?? l.userId}</div>
                  <div className="setting-hint">
                    {l.magSturen ? 'Leest mee en mag versturen' : 'Leest alleen mee'}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn sm ghost"
                    title="Lezen en versturen zijn niet hetzelfde"
                    onClick={() => void zetLid(vak.id, l.userId, !l.magSturen, ikId)}
                  >
                    {l.magSturen ? 'Alleen lezen' : 'Mag versturen'}
                  </button>
                  <button className="btn sm ghost danger" onClick={() => void haalLidWeg(l)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="row" style={{ gap: 8 }}>
        <select
          className="input"
          value={erbij}
          onChange={(e) => setErbij(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        >
          <option value="">Kies iemand…</option>
          {kandidaten.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button
          className="btn sm primary"
          disabled={!erbij}
          onClick={() => {
            void zetLid(vak.id, erbij, true, ikId).then(() => {
              toast.ok('Toegevoegd')
              setErbij('')
            })
          }}
        >
          Toevoegen
        </button>
      </div>

      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={sluit}>Klaar</button>
      </div>
    </Modal>
  )
}
