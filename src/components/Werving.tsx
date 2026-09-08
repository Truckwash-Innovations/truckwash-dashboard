import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  BriefcaseBusiness, Check, ExternalLink, FileText, Plus, UserPlus, Users, X,
} from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../store/useAuth'
import { toast } from '../store/useToasts'
import { dateFull, dateShort } from '../lib/format'
import { magBijLocatie } from '../lib/werk'
import {
  FUNCTIEGROEPEN, NOG_NODIG, SOL_STATUS, leeftijd, magVacature,
  naarMedewerker, slugVan, sollicitaties as solRepo, vacatures as vacRepo,
} from '../lib/werving'
import { Badge, Card, Empty, Field, Modal } from './ui'
import type {
  Beschikbaar, Functiegroep, Location, Sollicitatie, SollicitatieStatus, Vacature,
} from '../lib/types'

/* ------------------------------------------------------------------ *
 *  Werving
 *
 *  Twee dingen die bij elkaar horen: de vacatures die op de website staan, en
 *  wat daarop binnenkomt.
 *
 *  Wie wat mag staat in migratie 0068 en in magVacature(): de leiding voor
 *  haar eigen vestigingen, het management voor alles. Een vacature zonder
 *  vestiging betekent "overal", en dat mag een leidinggevende daarom niet --
 *  niet omdat hij geen vacature mag maken, maar omdat "overal" ook de
 *  zeventien vestigingen bevat waar hij niets te zeggen heeft.
 * ------------------------------------------------------------------ */

type Tab = 'sollicitaties' | 'vacatures'

export default function Werving() {
  const user = useAuth((s) => s.user)!
  const [tab, setTab] = useState<Tab>('sollicitaties')
  const [status, setStatus] = useState<SollicitatieStatus | 'open'>('open')
  const [open, setOpen] = useState<Sollicitatie | null>(null)
  const [nieuweVacature, setNieuweVacature] = useState(false)

  const alle = useLiveQuery(() => db.sollicitaties.toArray(), [], [] as Sollicitatie[])
  const alleVacatures = useLiveQuery(() => db.vacatures.toArray(), [], [] as Vacature[])
  const vestigingen = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])

  /* De database filtert dit ook (0068), maar wat hier in de kast ligt is wat
     er ooit is opgehaald -- en een leidinggevende die van vestiging wisselt
     heeft de sollicitaties van zijn vorige vestiging nog staan. */
  const zichtbaar = useMemo(
    () => alle.filter((s) => magBijLocatie(s.locationId, user)),
    [alle, user])

  const lijst = useMemo(() => zichtbaar
    .filter((s) => status === 'open'
      ? !['aangenomen', 'afgewezen', 'ingetrokken'].includes(s.status)
      : s.status === status)
    .sort((a, b) => b.createdAt - a.createdAt), [zichtbaar, status])

  const nieuw = zichtbaar.filter((s) => s.status === 'nieuw').length

  return (
    <>
      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <button
          className={`btn sm ${tab === 'sollicitaties' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('sollicitaties')}
        >
          <Users size={15} /> Sollicitaties{nieuw > 0 && ` (${nieuw})`}
        </button>
        <button
          className={`btn sm ${tab === 'vacatures' ? 'primary' : 'ghost'}`}
          onClick={() => setTab('vacatures')}
        >
          <BriefcaseBusiness size={15} /> Vacatures
        </button>

        <span className="spacer" />

        {tab === 'sollicitaties' ? (
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as SollicitatieStatus | 'open')}
          >
            <option value="open">Lopend</option>
            {SOL_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        ) : (
          <button className="btn primary" onClick={() => setNieuweVacature(true)}>
            <Plus size={15} /> Vacature
          </button>
        )}
      </div>

      {tab === 'sollicitaties' && (
        lijst.length === 0
          ? <Empty text="Geen sollicitaties in deze lijst." icon={<Users size={22} />} />
          : (
            <div className="werklijst">
              {lijst.map((s) => {
                const st = SOL_STATUS.find((x) => x.key === s.status)!
                const jaar = leeftijd(s.geboortedatum)
                return (
                  <div key={s.id} className="werkregel">
                    <button className="werk-open" onClick={() => setOpen(s)}>
                      <strong>{s.naam}{jaar !== null && ` (${jaar})`}</strong>
                      <span className="werk-meta">
                        <span className={`werk-prio t-${st.tint}`}>{st.label}</span>
                        {s.vacatureTitel && <span>{s.vacatureTitel}</span>}
                        {s.locationId && (
                          <span>
                            {vestigingen.find((l) => l.id === s.locationId)?.name ?? 'Vestiging'}
                          </span>
                        )}
                        <span>{s.email}</span>
                      </span>
                    </button>
                    <span className="werk-datum">{dateShort(s.createdAt)}</span>
                  </div>
                )
              })}
            </div>
          )
      )}

      {tab === 'vacatures' && (
        <Vacatures
          vacatures={alleVacatures}
          vestigingen={vestigingen}
          sollicitaties={zichtbaar}
        />
      )}

      {open && (
        <SollicitatieVenster
          sollicitatie={alle.find((s) => s.id === open.id) ?? open}
          vestigingen={vestigingen}
          onSluiten={() => setOpen(null)}
        />
      )}

      {nieuweVacature && (
        <NieuweVacature
          vestigingen={vestigingen.filter((l) => magBijLocatie(l.id, user))}
          onSluiten={() => setNieuweVacature(false)}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Eén sollicitatie
 * ------------------------------------------------------------------ */

function SollicitatieVenster({
  sollicitatie: s, vestigingen, onSluiten,
}: {
  sollicitatie: Sollicitatie
  vestigingen: Location[]
  onSluiten: () => void
}) {
  const user = useAuth((s2) => s2.user)!
  const [bezig, setBezig] = useState(false)
  const jaar = leeftijd(s.geboortedatum)
  const st = SOL_STATUS.find((x) => x.key === s.status)!

  async function maakMedewerker() {
    if (bezig) return
    setBezig(true)
    try {
      const m = await naarMedewerker(s, user)
      toast.ok(`Dossier aangemaakt voor ${m.name}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal open title={s.naam} subtitle={s.vacatureTitel} onClose={onSluiten} width={680}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <span className={`werk-prio t-${st.tint}`}>{st.label}</span>
        {s.locationId && (
          <Badge>{vestigingen.find((l) => l.id === s.locationId)?.name ?? 'Vestiging'}</Badge>
        )}
        <Badge tone="info">Binnengekomen {dateFull(s.createdAt)}</Badge>
      </div>

      {/* --- wat de sollicitant heeft ingevuld --- */}
      <div className="sol-vakken">
        <Vak label="E-mail"><a href={`mailto:${s.email}`}>{s.email}</a></Vak>
        {s.telefoon && <Vak label="Telefoon"><a href={`tel:${s.telefoon}`}>{s.telefoon}</a></Vak>}
        {jaar !== null && <Vak label="Leeftijd">{jaar} jaar</Vak>}
        {s.woonplaats && <Vak label="Woonplaats">{s.woonplaats}</Vak>}
        {s.school !== undefined && (
          <Vak label="Op school">
            {s.school
              ? [s.opleiding, s.niveau, s.leerjaar].filter(Boolean).join(' · ') || 'Ja'
              : 'Nee'}
          </Vak>
        )}
        {s.hoeGevonden && <Vak label="Hoe gevonden">{s.hoeGevonden}</Vak>}
        {s.hoeLang && <Vak label="Hoe lang">{s.hoeLang}</Vak>}
        {s.vervoer && <Vak label="Vervoer">{s.vervoer}</Vak>}
        {s.rijbewijs !== undefined && <Vak label="Rijbewijs">{s.rijbewijs ? 'Ja' : 'Nee'}</Vak>}
        {s.reistijd && <Vak label="Reistijd">{s.reistijd}</Vak>}
        {s.andereVestiging !== undefined && (
          <Vak label="Andere vestiging">{s.andereVestiging ? 'Ja, dat kan' : 'Liever niet'}</Vak>
        )}
      </div>

      {s.ervaring && <Alinea label="Ervaring">{s.ervaring}</Alinea>}
      {s.motivatie && <Alinea label="Motivatie">{s.motivatie}</Alinea>}
      {s.beperkingen && <Alinea label="Wat de inzet kan beperken">{s.beperkingen}</Alinea>}

      <Beschikbaarheid rijen={s.beschikbaarheid ?? []} />

      {/* --- het gesprek: wat wíj invullen --- */}
      <h4 style={{ marginTop: 18, marginBottom: 8 }}>Het gesprek</h4>
      <div className="grid cols-2">
        <Field label="Status">
          <select
            className="input"
            value={s.status}
            onChange={(e) => void solRepo.zetStatus(
              s.id, e.target.value as SollicitatieStatus, user)}
          >
            {SOL_STATUS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </Field>
        <Field label="Functiegroep" help="Alleen om de schaal vast te leggen.">
          <select
            className="input"
            value={s.functiegroep ?? ''}
            onChange={(e) => void solRepo.bijwerken(s.id,
              { functiegroep: (e.target.value || undefined) as Functiegroep | undefined })}
          >
            <option value="">Nog niet bepaald</option>
            {FUNCTIEGROEPEN.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="Gesprek op">
          <input
            className="input"
            type="date"
            value={s.gesprekAt ? new Date(s.gesprekAt).toISOString().slice(0, 10) : ''}
            onChange={(e) => void solRepo.bijwerken(s.id, {
              gesprekAt: e.target.value ? new Date(e.target.value + 'T12:00:00').getTime() : undefined,
            })}
          />
        </Field>
        <Field label="Proefdag op">
          <input
            className="input"
            type="date"
            value={s.proefdagAt ? new Date(s.proefdagAt).toISOString().slice(0, 10) : ''}
            onChange={(e) => void solRepo.bijwerken(s.id, {
              proefdagAt: e.target.value ? new Date(e.target.value + 'T12:00:00').getTime() : undefined,
            })}
          />
        </Field>
      </div>

      <Field label="Algemene indruk" help="Wat je van het gesprek vond.">
        <textarea
          className="input"
          rows={3}
          defaultValue={s.indruk ?? ''}
          onBlur={(e) => {
            if (e.currentTarget.value !== (s.indruk ?? '')) {
              void solRepo.bijwerken(s.id, { indruk: e.currentTarget.value }, user)
            }
          }}
        />
      </Field>

      {/* --- de knop --- */}
      <div className="sol-afronden">
        {s.profileId ? (
          <p className="ts-sub">
            <Check size={14} /> Er staat al een dossier voor deze persoon.
          </p>
        ) : (
          <>
            <p className="ts-sub" style={{ margin: '0 0 8px' }}>
              Alles wat hierboven staat gaat mee naar het dossier. Wat je daarna nog
              zelf toevoegt: {NOG_NODIG.join(', ').toLowerCase()}.
            </p>
            <button className="btn primary" disabled={bezig} onClick={() => void maakMedewerker()}>
              <UserPlus size={15} /> Medewerker aanmaken
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}

function Vak({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sol-vak">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  )
}

function Alinea({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <h4 style={{ marginBottom: 4, fontSize: '.86rem' }}>{label}</h4>
      <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{children}</p>
    </div>
  )
}

function Beschikbaarheid({ rijen }: { rijen: Beschikbaar[] }) {
  const gevuld = rijen.filter((r) => r.van || r.tot || r.opmerking)
  if (!gevuld.length) return null
  return (
    <div style={{ marginTop: 14 }}>
      <h4 style={{ marginBottom: 6, fontSize: '.86rem' }}>Beschikbaarheid</h4>
      <div className="sol-uren">
        {gevuld.map((r) => (
          <div key={r.dag}>
            <span>{r.dag}</span>
            <strong>{[r.van, r.tot].filter(Boolean).join(' – ') || 'in overleg'}</strong>
            {r.opmerking && <em>{r.opmerking}</em>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Vacatures
 * ------------------------------------------------------------------ */

function Vacatures({
  vacatures, vestigingen, sollicitaties,
}: {
  vacatures: Vacature[]
  vestigingen: Location[]
  sollicitaties: Sollicitatie[]
}) {
  const user = useAuth((s) => s.user)!
  const zichtbaar = vacatures
    .filter((v) => v.actief || magVacature(v.locaties, user))
    .sort((a, b) => a.volgorde - b.volgorde)

  if (!zichtbaar.length) {
    return <Empty text="Nog geen vacatures." icon={<BriefcaseBusiness size={22} />} />
  }

  return (
    <div className="grid cols-2">
      {zichtbaar.map((v) => {
        const mag = magVacature(v.locaties, user)
        const aantal = sollicitaties.filter((s) => s.vacatureId === v.id).length
        return (
          <Card key={v.id} title={v.titel} hint={v.uren}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <Badge tone={v.actief ? 'ok' : 'default'}>{v.actief ? 'Open' : 'Gesloten'}</Badge>
              {v.functiegroep && <Badge tone="info">{v.functiegroep}</Badge>}
              <Badge>{aantal} sollicitatie{aantal === 1 ? '' : 's'}</Badge>
              <Badge>
                {v.locaties.length === 0
                  ? 'Alle vestigingen'
                  : v.locaties.length === 1
                    ? vestigingen.find((l) => l.id === v.locaties[0])?.name ?? '1 vestiging'
                    : `${v.locaties.length} vestigingen`}
              </Badge>
            </div>
            {v.intro && <p className="ts-sub" style={{ marginTop: 0 }}>{v.intro}</p>}
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <a
                className="btn ghost sm"
                href={`/werken-bij/${v.slug}/`}
                target="_blank"
                rel="noopener"
              >
                <ExternalLink size={14} /> Op de site
              </a>
              {mag && v.actief && (
                <button
                  className="btn ghost sm"
                  onClick={() => void vacRepo.sluiten(v.id).then(() => toast.ok('Gesloten'))}
                >
                  Sluiten
                </button>
              )}
              {mag && !v.actief && (
                <button
                  className="btn ghost sm"
                  onClick={() => void vacRepo.bijwerken(v.id, { actief: true })
                    .then(() => toast.ok('Weer open'))}
                >
                  Heropenen
                </button>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function NieuweVacature({
  vestigingen, onSluiten,
}: {
  vestigingen: Location[]
  onSluiten: () => void
}) {
  const user = useAuth((s) => s.user)!
  const alles = user.allLocations || user.roles.includes('management') ||
                user.roles.includes('developer')

  const [titel, setTitel] = useState('')
  const [intro, setIntro] = useState('')
  const [tekst, setTekst] = useState('')
  const [uren, setUren] = useState('')
  const [fg, setFg] = useState<string>('')
  const [taken, setTaken] = useState('')
  const [eisen, setEisen] = useState('')
  const [bieden, setBieden] = useState('')
  const [overal, setOveral] = useState(alles)
  const [gekozen, setGekozen] = useState<Set<string>>(new Set())
  const [bezig, setBezig] = useState(false)

  const locaties = overal ? [] : [...gekozen]
  const mag = titel.trim() && magVacature(locaties, user)

  const regels = (t: string) => t.split('\n').map((r) => r.trim()).filter(Boolean)

  async function bewaar() {
    if (!mag || bezig) return
    setBezig(true)
    await vacRepo.aanmaken({
      titel, intro, tekst, uren,
      functiegroep: (fg || undefined) as Functiegroep | undefined,
      taken: regels(taken), eisen: regels(eisen), bieden: regels(bieden),
      locaties,
      door: user,
    })
    toast.ok('Vacature aangemaakt. Hij staat op de site bij de eerstvolgende sitebouw.')
    onSluiten()
  }

  return (
    <Modal open title="Nieuwe vacature" onClose={onSluiten} width={640} alleenBewustSluiten>
      <Field label="Titel" help={titel ? `Adres op de site: /werken-bij/${slugVan(titel)}/` : undefined}>
        <input className="input" value={titel} autoFocus
               onChange={(e) => setTitel(e.target.value)}
               placeholder="bijv. Wasmedewerker Venlo" />
      </Field>
      <Field label="Korte introductie" help="De eerste zin op de site, en in de zoekresultaten.">
        <textarea className="input" rows={2} value={intro}
                  onChange={(e) => setIntro(e.target.value)} />
      </Field>
      <div className="grid cols-2">
        <Field label="Uren" help="Vrije tekst; komt zo op de site.">
          <input className="input" value={uren} onChange={(e) => setUren(e.target.value)}
                 placeholder="bijv. 12 tot 20 uur" />
        </Field>
        <Field label="Functiegroep">
          <select className="input" value={fg} onChange={(e) => setFg(e.target.value)}>
            <option value="">Geen</option>
            {FUNCTIEGROEPEN.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Wat ga je doen?" help="Eén punt per regel.">
        <textarea className="input" rows={4} value={taken}
                  onChange={(e) => setTaken(e.target.value)} />
      </Field>
      <Field label="Wie ben jij?" help="Eén punt per regel.">
        <textarea className="input" rows={4} value={eisen}
                  onChange={(e) => setEisen(e.target.value)} />
      </Field>
      <Field label="Wat bieden wij?" help="Eén punt per regel.">
        <textarea className="input" rows={4} value={bieden}
                  onChange={(e) => setBieden(e.target.value)} />
      </Field>
      <Field label="Verdere tekst" help="Mag leeg blijven.">
        <textarea className="input" rows={3} value={tekst}
                  onChange={(e) => setTekst(e.target.value)} />
      </Field>

      <Field
        label="Waar"
        help={alles
          ? 'Alle vestigingen betekent: hij staat overal op de site.'
          : 'Je kunt alleen je eigen vestigingen kiezen.'}
      >
        <div className="sol-locaties">
          {alles && (
            <label>
              <input type="checkbox" checked={overal}
                     onChange={(e) => setOveral(e.target.checked)} />
              <span>Alle vestigingen</span>
            </label>
          )}
          {!overal && vestigingen.sort((a, b) => a.name.localeCompare(b.name)).map((l) => (
            <label key={l.id}>
              <input
                type="checkbox"
                checked={gekozen.has(l.id)}
                onChange={(e) => {
                  const n = new Set(gekozen)
                  if (e.target.checked) n.add(l.id); else n.delete(l.id)
                  setGekozen(n)
                }}
              />
              <span>{l.name}</span>
            </label>
          ))}
        </div>
      </Field>

      <div className="row" style={{ marginTop: 14 }}>
        <span className="spacer" />
        <button className="btn ghost" onClick={onSluiten}><X size={15} /> Annuleren</button>
        <button className="btn primary" disabled={!mag || bezig} onClick={() => void bewaar()}>
          <FileText size={15} /> Aanmaken
        </button>
      </div>
    </Modal>
  )
}
