import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CalendarClock, Check, Download, FileText, Flag, FolderKanban, ListTodo,
  MessageSquare, Paperclip, Plus, Trash2, User as UserIcon, X,
} from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../store/useAuth'
import { toast } from '../store/useToasts'
import { dateShort, dateFull } from '../lib/format'
import {
  BRON_LABEL, KOLOMMEN, PRIORITEITEN, isTeLaat, isVanMij, magBijLocatie,
  opBord, opDringendheid, projecten as projectRepo, reacties as reactieRepo,
  taken as taakRepo,
} from '../lib/werk'
import {
  aanTaak, documenten as docRepo, leesbaarFormaat, magZien,
} from '../lib/documenten'
import { Badge, Card, Empty, Field, Modal } from './ui'
import type {
  DocBestand, DocToegang, Location, Role, Taak, TaakDocument, TaakPrioriteit,
  TaakProject, TaakReactie, TaakStatus, User,
} from '../lib/types'

/* ------------------------------------------------------------------ *
 *  Werk
 *
 *  Casper: "Ik wil voor leidinggevende, management en ontwikkelaar een
 *  volledige workflow, met todo's, projectmanagement, kanban board ect."
 *
 *  Drie manieren om naar hetzelfde te kijken:
 *
 *    Lijst      wat er bij mij ligt, het dringendst bovenaan. Dit is het
 *               scherm waar je 's ochtends komt, en het is hetzelfde lijstje
 *               dat om zeven uur per mail gaat.
 *    Bord       alles in vier kolommen, om te slepen en om te zien waar het
 *               vastloopt.
 *    Projecten  groepen werk met een naam.
 *
 *  Waarom de lijst vooropstaat en niet het bord: een bord is prettig als je
 *  overzicht wilt, maar niemand begint zijn dag met overzicht. Je begint met
 *  "wat moet ik doen".
 * ------------------------------------------------------------------ */

type Tab = 'lijst' | 'bord' | 'projecten'

export default function Werk() {
  const user = useAuth((s) => s.user)!
  const [tab, setTab] = useState<Tab>('lijst')
  const [project, setProject] = useState<string>('')
  const [locatie, setLocatie] = useState<string>('')
  const [open, setOpen] = useState<Taak | null>(null)
  const [nieuw, setNieuw] = useState(false)

  const alleTaken = useLiveQuery(() => db.taken.toArray(), [], [] as Taak[])
  const alleProjecten = useLiveQuery(() => db.taakProjecten.toArray(), [], [] as TaakProject[])
  const vestigingen = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const mensen = useLiveQuery(() => db.users.toArray(), [], [] as User[])

  /*
   * Wat deze persoon überhaupt mag zien.
   *
   * De database bewaakt dit ook (0067), maar wat hier binnenkomt is wat er
   * eerder is opgehaald -- en een leidinggevende die van vestiging wisselt
   * heeft de taken van zijn vorige vestiging nog in zijn browser staan. Dus
   * ook hier filteren, en niet vertrouwen op wat er toevallig in de kast ligt.
   */
  const zichtbaar = useMemo(
    () => alleTaken.filter((t) => isVanMij(t, user) || magBijLocatie(t.locationId, user)),
    [alleTaken, user])

  const gefilterd = useMemo(() => zichtbaar.filter((t) =>
    (!project || t.projectId === project) &&
    (!locatie || t.locationId === locatie)), [zichtbaar, project, locatie])

  const mijn = useMemo(
    () => gefilterd.filter((t) => t.status !== 'klaar' && isVanMij(t, user)).sort(opDringendheid),
    [gefilterd, user])

  const teLaat = mijn.filter((t) => isTeLaat(t)).length
  const projectenActief = alleProjecten.filter((p) => !p.archief)

  return (
    <>
      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        {/* Dezelfde knoppen als op de andere schermen; geen eigen
            tabbladstijl erbij. */}
        {([
          ['lijst', 'Mijn werk', ListTodo],
          ['bord', 'Bord', FolderKanban],
          ['projecten', 'Projecten', Flag],
        ] as [Tab, string, typeof ListTodo][]).map(([k, label, Icon]) => (
          <button
            key={k}
            className={`btn sm ${tab === k ? 'primary' : 'ghost'}`}
            onClick={() => setTab(k)}
          >
            <Icon size={15} /> {label}
            {k === 'lijst' && mijn.length > 0 && ` (${mijn.length})`}
          </button>
        ))}

        <span className="spacer" />

        <select className="input" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">Alle projecten</option>
          {projectenActief.map((p) => <option key={p.id} value={p.id}>{p.naam}</option>)}
        </select>

        {/* Een leidinggevende met één vestiging heeft niets aan deze keuze. */}
        {(user.allLocations || (user.manages ?? []).length > 1) && (
          <select className="input" value={locatie} onChange={(e) => setLocatie(e.target.value)}>
            <option value="">Alle vestigingen</option>
            {vestigingen
              .filter((l) => magBijLocatie(l.id, user))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}

        <button className="btn primary" onClick={() => setNieuw(true)}>
          <Plus size={15} /> Taak
        </button>
      </div>

      {teLaat > 0 && (
        <div className="start-attentie" style={{ marginBottom: 16 }}>
          <span>{teLaat === 1 ? 'Eén taak' : `${teLaat} taken`} over de datum</span>
          <span>Ze staan bovenaan in Mijn werk.</span>
        </div>
      )}

      {tab === 'lijst' && (
        <Lijst taken={mijn} projecten={alleProjecten} vestigingen={vestigingen} onOpen={setOpen} />
      )}
      {tab === 'bord' && (
        <Bord taken={gefilterd} projecten={alleProjecten} onOpen={setOpen} />
      )}
      {tab === 'projecten' && (
        <Projecten projecten={alleProjecten} taken={zichtbaar} vestigingen={vestigingen} />
      )}

      {open && (
        <TaakVenster
          taak={alleTaken.find((t) => t.id === open.id) ?? open}
          projecten={alleProjecten}
          vestigingen={vestigingen}
          mensen={mensen}
          onSluiten={() => setOpen(null)}
        />
      )}

      {nieuw && (
        <NieuweTaak
          projecten={projectenActief}
          vestigingen={vestigingen.filter((l) => magBijLocatie(l.id, user))}
          mensen={mensen}
          onSluiten={() => setNieuw(false)}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Mijn werk
 * ------------------------------------------------------------------ */

function Lijst({
  taken, projecten, vestigingen, onOpen,
}: {
  taken: Taak[]
  projecten: TaakProject[]
  vestigingen: Location[]
  onOpen: (t: Taak) => void
}) {
  const user = useAuth((s) => s.user)!

  if (!taken.length) {
    return <Empty text="Niets op je lijst. Ook een uitkomst." icon={<Check size={22} />} />
  }

  return (
    <div className="werklijst">
      {taken.map((t) => (
        <div key={t.id} className={`werkregel ${isTeLaat(t) ? 'telaat' : ''}`}>
          <button
            className="werk-vink"
            title="Afvinken"
            onClick={(e) => {
              e.stopPropagation()
              void taakRepo.afvinken(t.id, user).then(() => toast.ok('Afgevinkt'))
            }}
          >
            <Check size={15} />
          </button>

          <button className="werk-open" onClick={() => onOpen(t)}>
            <strong>{t.titel}</strong>
            <span className="werk-meta">
              <PrioriteitBadge prioriteit={t.prioriteit} />
              {t.projectId && (
                <span>{projecten.find((p) => p.id === t.projectId)?.naam ?? 'Project'}</span>
              )}
              {t.locationId && (
                <span>{vestigingen.find((l) => l.id === t.locationId)?.name ?? 'Vestiging'}</span>
              )}
              {t.bron !== 'handmatig' && <span>{BRON_LABEL[t.bron]}</span>}
              {/* Ligt hij bij een rol en niet bij een persoon, dan is hij nog
                  door niemand opgepakt -- dat is precies wat je wilt zien. */}
              {!t.toegewezenAan && t.toegewezenRol && <span>nog niet opgepakt</span>}
            </span>
          </button>

          {t.deadline && (
            <span className={`werk-datum ${isTeLaat(t) ? 'telaat' : ''}`}>
              <CalendarClock size={13} /> {dateShort(t.deadline)}
            </span>
          )}

          {!t.toegewezenAan && (
            <button
              className="btn ghost sm"
              onClick={() => void taakRepo.oppakken(t.id, user).then(() => toast.ok('Op jouw naam'))}
            >
              Oppakken
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Het bord
 *
 *  Slepen met de gewone slepen-en-neerzetten van de browser, zonder
 *  bibliotheek. Dat is hier genoeg: vier kolommen, kaarten met een titel. Een
 *  pakket erbij is honderd kilobyte die elke pagina meedraagt voor een gebaar
 *  dat de browser zelf kan.
 *
 *  Op een telefoon werkt slepen niet; daar zijn de pijltjes op de kaart de
 *  weg. Die staan er altijd, ook op een groot scherm -- een tweede manier om
 *  hetzelfde te doen kost niets en helpt wie liever niet sleept.
 * ------------------------------------------------------------------ */

function Bord({
  taken, projecten, onOpen,
}: {
  taken: Taak[]
  projecten: TaakProject[]
  onOpen: (t: Taak) => void
}) {
  const user = useAuth((s) => s.user)!
  const [sleept, setSleept] = useState<string | null>(null)
  const [boven, setBoven] = useState<TaakStatus | null>(null)

  const perKolom = useMemo(() => {
    const uit = {} as Record<TaakStatus, Taak[]>
    for (const k of KOLOMMEN) uit[k.key] = []
    for (const t of taken) uit[t.status]?.push(t)
    for (const k of KOLOMMEN) uit[k.key].sort(opBord)
    return uit
  }, [taken])

  async function laatVallen(naar: TaakStatus) {
    setBoven(null)
    if (!sleept) return
    const id = sleept
    setSleept(null)
    await taakRepo.verplaatsen(id, naar, perKolom[naar].length, user)
  }

  return (
    <div className="bord">
      {KOLOMMEN.map((k) => (
        <div
          key={k.key}
          className={`bord-kolom ${boven === k.key ? 'raak' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setBoven(k.key) }}
          onDragLeave={() => setBoven((b) => (b === k.key ? null : b))}
          onDrop={() => void laatVallen(k.key)}
        >
          <div className="bord-kop">
            <strong>{k.label}</strong>
            <span className="bord-tel">{perKolom[k.key].length}</span>
          </div>
          <p className="bord-hint">{k.hint}</p>

          <div className="bord-stapel">
            {perKolom[k.key].map((t) => (
              <BordKaart
                key={t.id}
                taak={t}
                project={projecten.find((p) => p.id === t.projectId)}
                onOpen={() => onOpen(t)}
                onSleep={() => setSleept(t.id)}
                onKlaarSlepen={() => setSleept(null)}
              />
            ))}
            {!perKolom[k.key].length && <p className="bord-leeg">Leeg</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

function BordKaart({
  taak, project, onOpen, onSleep, onKlaarSlepen,
}: {
  taak: Taak
  project?: TaakProject
  onOpen: () => void
  onSleep: () => void
  onKlaarSlepen: () => void
}) {
  const user = useAuth((s) => s.user)!
  const hier = KOLOMMEN.findIndex((k) => k.key === taak.status)

  async function schuif(richting: -1 | 1) {
    const naar = KOLOMMEN[hier + richting]
    if (!naar) return
    await taakRepo.verplaatsen(taak.id, naar.key, 0, user)
  }

  return (
    <div
      className={`bord-kaart ${isTeLaat(taak) ? 'telaat' : ''}`}
      draggable
      onDragStart={onSleep}
      onDragEnd={onKlaarSlepen}
    >
      <button className="bord-kaart-open" onClick={onOpen}>
        <strong>{taak.titel}</strong>
        <span className="bord-kaart-meta">
          <PrioriteitBadge prioriteit={taak.prioriteit} />
          {project && <span className={`punt t-${project.kleur}`} title={project.naam} />}
          {taak.deadline && (
            <span className={isTeLaat(taak) ? 'telaat' : ''}>{dateShort(taak.deadline)}</span>
          )}
        </span>
        <span className="bord-kaart-wie">
          <UserIcon size={12} />
          {taak.toegewezenNaam ?? (taak.toegewezenRol ? rolLabel(taak.toegewezenRol) : 'niemand')}
        </span>
      </button>

      {/* Ook zonder slepen vooruit te komen. Op een telefoon kan het niet
          anders, en met een muis is het vaak gewoon sneller. */}
      <div className="bord-kaart-pijlen">
        <button disabled={hier === 0} onClick={() => void schuif(-1)} aria-label="Naar links">‹</button>
        <button
          disabled={hier === KOLOMMEN.length - 1}
          onClick={() => void schuif(1)}
          aria-label="Naar rechts"
        >
          ›
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Projecten
 * ------------------------------------------------------------------ */

function Projecten({
  projecten, taken, vestigingen,
}: {
  projecten: TaakProject[]
  taken: Taak[]
  vestigingen: Location[]
}) {
  const user = useAuth((s) => s.user)!
  const [nieuw, setNieuw] = useState(false)
  const [naam, setNaam] = useState('')
  const [locatie, setLocatie] = useState('')
  const [kleur, setKleur] = useState('brand')

  const actief = projecten.filter((p) => !p.archief)

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="spacer" />
        <button className="btn" onClick={() => setNieuw(true)}><Plus size={15} /> Project</button>
      </div>

      {!actief.length && <Empty text="Nog geen projecten." icon={<Flag size={22} />} />}

      <div className="grid cols-3">
        {actief.map((p) => {
          const mijne = taken.filter((t) => t.projectId === p.id)
          const klaar = mijne.filter((t) => t.status === 'klaar').length
          return (
            <Card key={p.id} title={p.naam} hint={p.omschrijving}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <span className={`punt t-${p.kleur}`} />
                {p.locationId && (
                  <Badge>{vestigingen.find((l) => l.id === p.locationId)?.name ?? 'Vestiging'}</Badge>
                )}
                <Badge tone={klaar === mijne.length && mijne.length > 0 ? 'ok' : 'info'}>
                  {klaar} van {mijne.length} klaar
                </Badge>
              </div>
              <button
                className="btn ghost sm"
                onClick={() => void projectRepo.archiveren(p.id).then(() => toast.ok('Gearchiveerd'))}
              >
                Archiveren
              </button>
            </Card>
          )
        })}
      </div>

      <Modal open={nieuw} title="Nieuw project" onClose={() => setNieuw(false)} alleenBewustSluiten>
        <Field label="Naam">
          <input className="input" value={naam} onChange={(e) => setNaam(e.target.value)}
                 placeholder="bijv. Nieuwe wasstraat Venlo" />
        </Field>
        <Field label="Kleur" help="Alleen om het bord leesbaar te houden.">
          <select className="input" value={kleur} onChange={(e) => setKleur(e.target.value)}>
            {['brand', 'ok', 'warn', 'danger', 'info', 'paars', 'oranje'].map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label="Vestiging" help="Leeg laten betekent: voor iedereen die bij projecten mag.">
          <select className="input" value={locatie} onChange={(e) => setLocatie(e.target.value)}>
            <option value="">Geen vestiging</option>
            {vestigingen
              .filter((l) => magBijLocatie(l.id, user))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <div className="row" style={{ marginTop: 14 }}>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => setNieuw(false)}>Annuleren</button>
          <button
            className="btn primary"
            disabled={!naam.trim()}
            onClick={() => {
              void projectRepo.aanmaken({
                naam, kleur, locationId: locatie || undefined, door: user,
              }).then(() => {
                toast.ok('Project aangemaakt')
                setNaam(''); setLocatie(''); setKleur('brand'); setNieuw(false)
              })
            }}
          >
            Aanmaken
          </button>
        </div>
      </Modal>
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Eén taak
 * ------------------------------------------------------------------ */

function TaakVenster({
  taak, projecten, vestigingen, mensen, onSluiten,
}: {
  taak: Taak
  projecten: TaakProject[]
  vestigingen: Location[]
  mensen: User[]
  onSluiten: () => void
}) {
  const user = useAuth((s) => s.user)!
  const [reactie, setReactie] = useState('')

  const gesprek = useLiveQuery(
    () => db.taakReacties.where('taakId').equals(taak.id).toArray(),
    [taak.id], [] as TaakReactie[])

  const mag = taak.bron === 'handmatig'

  return (
    <Modal open title={taak.titel} onClose={onSluiten} width={620}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <PrioriteitBadge prioriteit={taak.prioriteit} />
        <Badge tone="info">{KOLOMMEN.find((k) => k.key === taak.status)?.label}</Badge>
        {taak.bron !== 'handmatig' && <Badge>{BRON_LABEL[taak.bron]}</Badge>}
        {taak.locationId && (
          <Badge>{vestigingen.find((l) => l.id === taak.locationId)?.name ?? 'Vestiging'}</Badge>
        )}
      </div>

      {taak.omschrijving && <p style={{ whiteSpace: 'pre-wrap' }}>{taak.omschrijving}</p>}

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <Field label="Kolom">
          <select
            className="input"
            value={taak.status}
            onChange={(e) => void taakRepo.verplaatsen(
              taak.id, e.target.value as TaakStatus, 0, user)}
          >
            {KOLOMMEN.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </Field>

        <Field label="Prioriteit">
          <select
            className="input"
            value={taak.prioriteit}
            onChange={(e) => void taakRepo.bijwerken(taak.id,
              { prioriteit: e.target.value as TaakPrioriteit })}
          >
            {PRIORITEITEN.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </Field>

        <Field label="Van wie">
          <select
            className="input"
            value={taak.toegewezenAan ?? ''}
            onChange={(e) => {
              const m = mensen.find((p) => p.id === e.target.value)
              void taakRepo.bijwerken(taak.id, {
                toegewezenAan: m?.id,
                toegewezenNaam: m?.name,
              })
            }}
          >
            <option value="">
              {taak.toegewezenRol ? `${rolLabel(taak.toegewezenRol)} — nog niet opgepakt` : 'Niemand'}
            </option>
            {mensen
              .filter((m) => m.active)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>

        <Field label="Deadline">
          <input
            className="input"
            type="date"
            value={taak.deadline ? new Date(taak.deadline).toISOString().slice(0, 10) : ''}
            onChange={(e) => void taakRepo.bijwerken(taak.id, {
              deadline: e.target.value ? new Date(e.target.value + 'T12:00:00').getTime() : undefined,
            })}
          />
        </Field>

        <Field label="Project">
          <select
            className="input"
            value={taak.projectId ?? ''}
            onChange={(e) => void taakRepo.bijwerken(taak.id,
              { projectId: e.target.value || undefined })}
          >
            <option value="">Geen project</option>
            {projecten.filter((p) => !p.archief)
              .map((p) => <option key={p.id} value={p.id}>{p.naam}</option>)}
          </select>
        </Field>
      </div>

      {/* --- de documenten --- */}
      <TaakDocumenten taakId={taak.id} />

      {/* --- het gesprek --- */}
      <h4 style={{ marginTop: 18, marginBottom: 8 }}>
        <MessageSquare size={15} /> Overleg
      </h4>
      {!gesprek.length && (
        <p className="ts-sub">Nog niets. Wat hier staat blijft bij de taak, ook over een maand.</p>
      )}
      <div className="werk-gesprek">
        {[...gesprek].sort((a, b) => a.createdAt - b.createdAt).map((r) => (
          <div key={r.id} className="werk-reactie">
            <span className="werk-reactie-wie">{r.doorNaam ?? 'Iemand'}</span>
            <span className="werk-reactie-wanneer">{dateFull(r.createdAt)}</span>
            <p>{r.tekst}</p>
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <input
          className="input"
          value={reactie}
          placeholder="Iets toevoegen…"
          onChange={(e) => setReactie(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && reactie.trim()) {
              void reactieRepo.plaatsen(taak.id, reactie, user)
              setReactie('')
            }
          }}
        />
        <button
          className="btn"
          disabled={!reactie.trim()}
          onClick={() => {
            void reactieRepo.plaatsen(taak.id, reactie, user)
            setReactie('')
          }}
        >
          Plaatsen
        </button>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        {mag ? (
          <button
            className="btn ghost danger"
            onClick={() => void taakRepo.verwijderen(taak.id)
              .then(() => { toast.ok('Weg'); onSluiten() })
              .catch((e: Error) => toast.error(e.message))}
          >
            <Trash2 size={15} /> Weggooien
          </button>
        ) : (
          <span className="ts-sub">
            Werk dat uit het systeem komt vink je af; weggooien kan niet.
          </span>
        )}
        <span className="spacer" />
        <button className="btn primary" onClick={() => {
          void taakRepo.afvinken(taak.id, user).then(() => { toast.ok('Afgevinkt'); onSluiten() })
        }}>
          <Check size={15} /> Afvinken
        </button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 *  Nieuwe taak
 * ------------------------------------------------------------------ */

function NieuweTaak({
  projecten, vestigingen, mensen, onSluiten,
}: {
  projecten: TaakProject[]
  vestigingen: Location[]
  mensen: User[]
  onSluiten: () => void
}) {
  const user = useAuth((s) => s.user)!
  const [titel, setTitel] = useState('')
  const [omschrijving, setOmschrijving] = useState('')
  const [prioriteit, setPrioriteit] = useState<TaakPrioriteit>('normaal')
  const [wie, setWie] = useState(user.id)
  const [locatie, setLocatie] = useState(user.locationId ?? '')
  const [project, setProject] = useState('')
  const [deadline, setDeadline] = useState('')
  const [bezig, setBezig] = useState(false)

  async function bewaar() {
    if (!titel.trim() || bezig) return
    setBezig(true)
    const m = mensen.find((p) => p.id === wie)
    await taakRepo.aanmaken({
      titel,
      omschrijving,
      prioriteit,
      locationId: locatie || undefined,
      projectId: project || undefined,
      toegewezenAan: m?.id,
      toegewezenNaam: m?.name,
      deadline: deadline ? new Date(deadline + 'T12:00:00').getTime() : undefined,
      door: user,
    })
    toast.ok('Toegevoegd')
    onSluiten()
  }

  return (
    <Modal open title="Nieuwe taak" onClose={onSluiten} alleenBewustSluiten>
      <Field label="Wat moet er gebeuren?">
        <input className="input" value={titel} autoFocus
               onChange={(e) => setTitel(e.target.value)}
               placeholder="bijv. Sollicitatiegesprek inplannen" />
      </Field>
      <Field label="Toelichting" help="Mag leeg blijven.">
        <textarea className="input" rows={3} value={omschrijving}
                  onChange={(e) => setOmschrijving(e.target.value)} />
      </Field>
      <div className="grid cols-2">
        <Field label="Prioriteit">
          <select className="input" value={prioriteit}
                  onChange={(e) => setPrioriteit(e.target.value as TaakPrioriteit)}>
            {PRIORITEITEN.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Voor wie">
          <select className="input" value={wie} onChange={(e) => setWie(e.target.value)}>
            <option value="">Niemand in het bijzonder</option>
            {mensen.filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name))
              .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="Vestiging">
          <select className="input" value={locatie} onChange={(e) => setLocatie(e.target.value)}>
            <option value="">Geen vestiging</option>
            {vestigingen.sort((a, b) => a.name.localeCompare(b.name))
              .map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Deadline">
          <input className="input" type="date" value={deadline}
                 onChange={(e) => setDeadline(e.target.value)} />
        </Field>
        <Field label="Project">
          <select className="input" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Geen project</option>
            {projecten.map((p) => <option key={p.id} value={p.id}>{p.naam}</option>)}
          </select>
        </Field>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <span className="spacer" />
        <button className="btn ghost" onClick={onSluiten}><X size={15} /> Annuleren</button>
        <button className="btn primary" disabled={!titel.trim() || bezig} onClick={() => void bewaar()}>
          <Plus size={15} /> Toevoegen
        </button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 *  Documenten aan een taak
 *
 *  Casper: "deze documenten moet je ook aan een todo kunnen neerhangen".
 *
 *  Wat je hier kunt kiezen is beperkt tot documenten die je zelf mag zien.
 *  Dat is niet alleen netjes maar noodzakelijk: zou je een afgeschermd
 *  document aan een taak kunnen hangen die door iemand anders wordt opgepakt,
 *  dan is de afscherming te omzeilen door hem ergens anders neer te leggen.
 *  De database weigert het ook (taak_document_insert in 0071), maar een lijst
 *  waaruit je iets kunt kiezen dat daarna wordt geweigerd is een lijst die
 *  liegt.
 * ------------------------------------------------------------------ */

function TaakDocumenten({ taakId }: { taakId: string }) {
  const user = useAuth((s) => s.user)!
  const [kies, setKies] = useState('')

  const koppelingen = useLiveQuery(
    () => db.taakDocumenten.where('taakId').equals(taakId).toArray(),
    [taakId], [] as TaakDocument[])
  const alleDocs = useLiveQuery(() => db.docBestanden.toArray(), [], [] as DocBestand[])
  const delingen = useLiveQuery(() => db.docToegang.toArray(), [], [] as DocToegang[])

  const mijne = useMemo(
    () => alleDocs.filter((d) => magZien(d, user, delingen)),
    [alleDocs, user, delingen])

  const eraan = koppelingen
    .map((k) => ({ koppeling: k, doc: mijne.find((d) => d.id === k.documentId) }))
    .filter((x): x is { koppeling: TaakDocument; doc: DocBestand } => !!x.doc)

  return (
    <>
      <h4 style={{ marginTop: 18, marginBottom: 8 }}>
        <Paperclip size={15} /> Documenten
      </h4>

      {eraan.length === 0 && (
        <p className="ts-sub" style={{ marginTop: 0 }}>
          Nog geen documenten. Wat je hier aanhangt blijft bij de taak staan.
        </p>
      )}

      <div className="verkenner-lijst">
        {eraan.map(({ koppeling, doc }) => (
          <div key={koppeling.id} className="verkenner-regel">
            <span className="verkenner-open" style={{ cursor: 'default' }}>
              <FileText size={16} />
              <span className="verkenner-tekst">
                <strong>{doc.naam}</strong>
                <span className="verkenner-meta">
                  <span>{leesbaarFormaat(doc.grootte)}</span>
                  {doc.bron === 'mail' && <span>per mail</span>}
                </span>
              </span>
            </span>
            <button
              className="btn ghost sm"
              title="Downloaden"
              onClick={async () => {
                const url = await docRepo.link(doc)
                if (!url) { toast.error('Het bestand is nu niet op te halen.'); return }
                window.open(url, '_blank', 'noopener')
              }}
            >
              <Download size={14} />
            </button>
            <button
              className="btn ghost sm"
              title="Loshalen"
              onClick={() => void aanTaak.loshalen(koppeling.id)}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <select className="input" value={kies} onChange={(e) => setKies(e.target.value)}>
          <option value="">Een document erbij…</option>
          {mijne
            .filter((d) => !koppelingen.some((k) => k.documentId === d.id))
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 200)
            .map((d) => <option key={d.id} value={d.id}>{d.naam}</option>)}
        </select>
        <button
          className="btn"
          disabled={!kies}
          onClick={() => {
            void aanTaak.hangen(taakId, kies, user).then(() => {
              toast.ok('Erbij gezet')
              setKies('')
            })
          }}
        >
          <Paperclip size={14} /> Aanhangen
        </button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Kleine dingen
 * ------------------------------------------------------------------ */

function PrioriteitBadge({ prioriteit }: { prioriteit: TaakPrioriteit }) {
  const p = PRIORITEITEN.find((x) => x.key === prioriteit)!
  if (prioriteit === 'normaal') return null
  return <span className={`werk-prio t-${p.tint}`}>{p.label}</span>
}

const ROL_LABEL: Partial<Record<Role, string>> = {
  supervisor: 'Leidinggevende',
  management: 'Management',
  developer: 'Ontwikkelaar',
  administratie: 'Administratie',
  technician: 'Technische dienst',
  employee: 'Medewerker',
  trucksupply: 'Trucksupply',
}

function rolLabel(r: Role): string {
  return ROL_LABEL[r] ?? r
}
