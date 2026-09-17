import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { db } from '../lib/db'
import { shifts as shiftRepo } from '../lib/repo'
import { SHIFT_KINDS, type Shift, type ShiftKind, type User } from '../lib/types'
import {
  DAY_LABELS, dateInputValue, dayFromDateInput, fromTimeInput, shiftHours,
  shiftRange, shiftsOnDay, toTimeInput, totalHours, weekDays, weekNumber, weekStart,
} from '../lib/roster'
import { Badge, Field, Modal } from './ui'
import { toast } from '../store/useToasts'
import { useAuth } from '../store/useAuth'

const DAY = 86_400_000

interface Props {
  person: Pick<User, 'id' | 'name' | 'contractHours'>
  /** Alleen management mag het rooster wijzigen. */
  editable?: boolean
  /**
   * Meteen naar déze dienst.
   *
   * Casper: "Nu kom ik nog aan bij het begin, maar het is toch fijner dat ik
   * in dit geval uit zou komen bij dat specifieke gedeelte van het rooster?"
   *
   * Komt uit de knop in een roostermail (?open=rooster&id=sh_...). Het
   * rooster opende altijd op de week van vandaag, ook als het bericht ging
   * over een dienst over twee weken -- en dan mocht je zelf gaan bladeren.
   *
   * Staat er een id in dat we niet terugvinden, dan gebeurt er niets en blijf
   * je op deze week. Dat is het eerlijkste antwoord: de dienst kan intussen
   * geschrapt zijn, en dan is de week van vandaag net zo goed een startpunt
   * als elke andere.
   */
  richtOp?: string
  /**
   * Gemeld zodra die sprong is gemaakt.
   *
   * Zonder dit blijft het doel hangen: ga je later via het menu terug naar
   * het rooster, dan springt hij opnieuw naar diezelfde dienst -- en dat
   * heeft dan niemand gevraagd. Een link werkt een keer.
   */
  onGericht?: () => void
}

export default function WeekRooster({ person, editable = false, richtOp, onGericht }: Props) {
  const me = useAuth((s) => s.user)!
  const [offset, setOffset] = useState(0)
  /* Welke dienst is aangewezen. Los van richtOp, want het bladeren moet hem
     kunnen laten vallen: blader je weg, dan wijst er niets meer aan. */
  const [aangewezen, setAangewezen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Shift | null>(null)
  const [adding, setAdding] = useState<number | null>(null)

  const start = weekStart(Date.now()) + offset * 7 * DAY
  const days = weekDays(start)

  const shifts = useLiveQuery(
    async () => {
      const rows = await db.shifts.where('userId').equals(person.id).toArray()
      return rows.filter((s) => s.startAt >= start && s.startAt < start + 7 * DAY)
    },
    [person.id, start],
    [] as Shift[],
  )

  /*
   * De sprong naar de week van die dienst.
   *
   * In een effect en niet tijdens het renderen, want het antwoord komt uit de
   * database. En op de dienst gezocht in plaats van op een datum meegestuurd:
   * de dienst kan sinds het versturen van de mail verschoven zijn, en dan
   * hoort de link naar waar hij NU staat te wijzen, niet naar waar hij stond.
   */
  useEffect(() => {
    if (!richtOp) return
    let weg = false
    void db.shifts.get(richtOp).then((s) => {
      if (weg || !s) return
      const hier = weekStart(Date.now())
      setOffset(Math.round((weekStart(s.startAt) - hier) / (7 * DAY)))
      setAangewezen(s.id)
    }).finally(() => { if (!weg) onGericht?.() })
    return () => { weg = true }
    // onGericht verandert elke render; alleen op het doel reageren is hier juist
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [richtOp])

  const hours = useMemo(() => totalHours(shifts), [shifts])
  const contract = person.contractHours ?? 0
  const diff = contract ? Math.round((hours - contract) * 10) / 10 : 0

  const today = new Date().setHours(0, 0, 0, 0)

  return (
    <>
      <div className="row" style={{ marginBottom: 12, flexWrap: 'nowrap' }}>
        <button className="btn ghost sm" onClick={() => { setOffset(offset - 1); setAangewezen(null) }} aria-label="Vorige week">
          <ChevronLeft size={15} />
        </button>
        <button className="btn ghost sm" onClick={() => { setOffset(0); setAangewezen(null) }} disabled={offset === 0}>
          Deze week
        </button>
        <button className="btn ghost sm" onClick={() => { setOffset(offset + 1); setAangewezen(null) }} aria-label="Volgende week">
          <ChevronRight size={15} />
        </button>

        <div style={{ marginLeft: 6, minWidth: 0 }}>
          <strong style={{ fontSize: '.9rem' }}>Week {weekNumber(start)}</strong>
          <div style={{ fontSize: '.74rem', color: 'var(--text-3)' }}>
            {new Date(start).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
            {' t/m '}
            {new Date(start + 6 * DAY).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
          </div>
        </div>

        <span style={{ flex: 1 }} />

        <div style={{ textAlign: 'right' }}>
          <strong className="mono" style={{ fontSize: '1.05rem' }}>{hours} u</strong>
          {contract > 0 && (
            <div style={{ fontSize: '.73rem', color: diff === 0 ? 'var(--text-3)' : diff > 0 ? 'var(--warn)' : 'var(--info)' }}>
              contract {contract} u{diff !== 0 ? ` (${diff > 0 ? '+' : ''}${diff})` : ''}
            </div>
          )}
        </div>
      </div>

      <div className="rooster-week">
        {days.map((day) => {
          const list = shiftsOnDay(shifts, day)
          const isToday = day === today
          return (
            <div key={day} className={`rooster-day ${isToday ? 'today' : ''}`}>
              <div className="rooster-day-head">
                <span className="dow">{DAY_LABELS[(new Date(day).getDay() + 6) % 7]}</span>
                <span className="num">{new Date(day).getDate()}</span>
              </div>

              <div className="rooster-day-body">
                {list.length === 0 && (
                  <div className="rooster-empty">—</div>
                )}

                {list.map((s) => {
                  const meta = SHIFT_KINDS[s.kind]
                  return (
                    <button
                      key={s.id}
                      className={`rooster-shift k-${s.kind}${s.id === aangewezen ? ' aangewezen' : ''}`}
                      onClick={() => editable && setEditing(s)}
                      disabled={!editable}
                      title={s.note ?? meta.label}
                    >
                      <span className="k">{meta.label}</span>
                      {s.kind === 'dienst' && (
                        <>
                          <span className="t">{shiftRange(s)}</span>
                          <span className="h">{shiftHours(s)} u</span>
                        </>
                      )}
                    </button>
                  )
                })}

                {editable && (
                  <button className="rooster-add" onClick={() => setAdding(day)} title="Dienst toevoegen">
                    <Plus size={13} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {shifts.length === 0 && (
        <div className="row" style={{ gap: 8, marginTop: 12, fontSize: '.83rem', color: 'var(--text-3)' }}>
          <CalendarDays size={15} />
          Geen rooster voor deze week
          {editable && ' — klik op een dag om een dienst toe te voegen.'}
        </div>
      )}

      <ShiftDialog
        open={adding !== null || editing !== null}
        shift={editing}
        day={adding ?? editing?.startAt ?? start}
        person={person}
        createdBy={me.id}
        onClose={() => { setAdding(null); setEditing(null) }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */

function ShiftDialog({
  open, shift, day, person, createdBy, onClose,
}: {
  open: boolean
  shift: Shift | null
  day: number
  person: Pick<User, 'id' | 'name'>
  createdBy: string
  onClose: () => void
}) {
  const dayStart = new Date(day).setHours(0, 0, 0, 0)

  const [kind, setKind] = useState<ShiftKind>('dienst')
  const [date, setDate] = useState(dateInputValue(dayStart))
  const [from, setFrom] = useState('07:00')
  const [till, setTill] = useState('15:30')
  const [pause, setPause] = useState('30')
  const [note, setNote] = useState('')
  const [key, setKey] = useState('')

  // Formulier vullen zodra er een andere dienst of dag geopend wordt
  const signature = `${shift?.id ?? 'new'}:${dayStart}`
  if (open && signature !== key) {
    setKey(signature)
    setKind(shift?.kind ?? 'dienst')
    setDate(dateInputValue(shift ? shift.startAt : dayStart))
    setFrom(shift ? toTimeInput(shift.startAt) : '07:00')
    setTill(shift ? toTimeInput(shift.endAt) : '15:30')
    setPause(String(shift?.breakMinutes ?? 30))
    setNote(shift?.note ?? '')
  }

  async function save() {
    const base = dayFromDateInput(date)
    const isShift = kind === 'dienst'
    const startAt = isShift ? fromTimeInput(base, from) : base
    let endAt = isShift ? fromTimeInput(base, till) : base + 86_400_000

    // nachtdienst: eind vóór begin betekent de volgende dag
    if (isShift && endAt <= startAt) endAt += 86_400_000

    const payload = {
      kind,
      startAt,
      endAt,
      breakMinutes: isShift ? Number(pause) || 0 : 0,
      note: note.trim() || undefined,
    }

    if (shift) {
      await shiftRepo.update(shift.id, payload)
      toast.ok('Rooster bijgewerkt')
    } else {
      await shiftRepo.create({ ...payload, user: person, createdBy })
      toast.ok(`${SHIFT_KINDS[kind].label} ingepland voor ${person.name.split(' ')[0]}`)
    }
    onClose()
  }

  async function remove() {
    if (!shift) return
    await shiftRepo.remove(shift.id)
    toast.info('Uit het rooster gehaald')
    onClose()
  }

  return (
    <Modal
      open={open}
      title={shift ? 'Dienst wijzigen' : 'Dienst inplannen'}
      subtitle={person.name}
      onClose={onClose}
      width={460}
    >
      <Field label="Soort">
        <div className="row" style={{ gap: 6 }}>
          {(Object.keys(SHIFT_KINDS) as ShiftKind[]).map((k) => (
            <button
              key={k}
              className={`btn sm ${kind === k ? 'primary' : ''}`}
              onClick={() => setKind(k)}
              type="button"
            >
              {SHIFT_KINDS[k].label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Datum">
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      {kind === 'dienst' && (
        <div className="grid cols-3">
          <Field label="Van">
            <input className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Tot">
            <input className="input" type="time" value={till} onChange={(e) => setTill(e.target.value)} />
          </Field>
          <Field label="Pauze (min)">
            <input className="input" inputMode="numeric" value={pause} onChange={(e) => setPause(e.target.value)} />
          </Field>
        </div>
      )}

      <Field label="Notitie (optioneel)">
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={kind === 'dienst' ? 'Bijv. ochtenddienst' : 'Bijv. opgenomen vakantiedag'}
        />
      </Field>

      <div className="row">
        {shift && (
          <button className="btn danger sm" onClick={() => void remove()}>
            <Trash2 size={14} /> Verwijderen
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" onClick={() => void save()}>
          {shift ? 'Opslaan' : 'Inplannen'}
        </button>
      </div>
    </Modal>
  )
}

/** Kleine samenvatting van vandaag, voor bovenaan een dashboard. */
export function ShiftToday({ userId }: { userId: string }) {
  const today = new Date().setHours(0, 0, 0, 0)
  const list = useLiveQuery(
    async () => {
      const rows = await db.shifts.where('userId').equals(userId).toArray()
      return shiftsOnDay(rows, today)
    },
    [userId, today],
    [] as Shift[],
  )

  if (list.length === 0) return <Badge>Geen rooster vandaag</Badge>

  return (
    <>
      {list.map((s) => (
        <Badge key={s.id} tone={SHIFT_KINDS[s.kind].tone as never}>
          {SHIFT_KINDS[s.kind].label}
          {s.kind === 'dienst' ? ` ${shiftRange(s)}` : ''}
        </Badge>
      ))}
    </>
  )
}
