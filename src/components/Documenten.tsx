import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowDown, ArrowUp, ChevronRight, Download, FilePlus2, FileSpreadsheet, FileText,
  FolderPlus, Folder, HardDrive, Image as ImageIcon, Inbox, Lock, PenLine, Plus,
  Printer, Save, Search, Trash2, Upload, Users, X,
} from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../store/useAuth'
import { toast } from '../store/useToasts'
import { dateShort } from '../lib/format'
import {
  ZICHTBAARHEID, delen as deelRepo, documenten as docRepo, isGemaakt, leesbaarFormaat,
  magDocumentbeheer, magMap, magZien, mappen as mapRepo, mijnVestigingen,
  padNaar, soortVan,
} from '../lib/documenten'
import {
  SOORTEN, VOET, ZONDER_TEKST, alsBlokken, alsTekst, eersteRegels, haalWeg,
  leegDocument, nieuwBlok, nummering, pdfDownloaden, printen, verplaats, voegToe,
  zetSoort, zetTekst,
} from '../lib/documentmaken'
import { Badge, Empty, Field, Modal } from './ui'
import type {
  DocBestand, DocBlok, DocBlokSoort, DocMap, DocToegang, DocZichtbaarheid,
  Location, Role, User,
} from '../lib/types'

/* ------------------------------------------------------------------ *
 *  Documentbeheer
 *
 *  Casper: "Ook een soort verkenner idee erin aub, zodat je netjes erdoorheen
 *  kan gaan."
 *
 *  Links de mappen, rechts wat erin zit, bovenin waar je bent. Plus twee
 *  vaste plekken die geen map zijn:
 *
 *    Postvak      wat per mail binnenkwam en nog nergens staat
 *    Bij mij      wat persoonlijk bij jou is neergelegd of met je is gedeeld
 *
 *  Die twee staan bovenaan en niet ergens tussen de mappen, omdat het geen
 *  plekken zijn maar vragen: "wat moet ik nog wegzetten" en "wat is er voor
 *  mij". Dat is waar je 's ochtends kijkt.
 * ------------------------------------------------------------------ */

type Plek = { soort: 'map'; id?: string } | { soort: 'postvak' } | { soort: 'bijmij' }

export default function Documenten() {
  const user = useAuth((s) => s.user)!
  const [plek, setPlek] = useState<Plek>({ soort: 'postvak' })
  const [zoek, setZoek] = useState('')
  const [open, setOpen] = useState<DocBestand | null>(null)
  const [nieuweMap, setNieuweMap] = useState(false)

  const alleMappen = useLiveQuery(() => db.docMappen.toArray(), [], [] as DocMap[])
  const alleDocs = useLiveQuery(() => db.docBestanden.toArray(), [], [] as DocBestand[])
  const delingen = useLiveQuery(() => db.docToegang.toArray(), [], [] as DocToegang[])
  const vestigingen = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const mensen = useLiveQuery(() => db.users.toArray(), [], [] as User[])

  /* De database filtert dit ook (0071), maar wat hier in de kast ligt is wat
     er ooit is opgehaald. Bij een afgeschermd document is dat de verkeerde
     kant om op te vertrouwen. */
  const zichtbaar = useMemo(
    () => alleDocs.filter((d) => magZien(d, user, delingen)),
    [alleDocs, user, delingen])
  const mijnMappen = useMemo(
    () => alleMappen.filter((m) => magMap(m, user)),
    [alleMappen, user])

  const postvak = zichtbaar.filter((d) => !d.mapId && d.bron === 'mail')
  const bijMij = zichtbaar.filter((d) =>
    d.toegewezenAan === user.id ||
    delingen.some((t) => t.documentId === d.id && t.profileId === user.id))

  const hier = useMemo(() => {
    if (plek.soort === 'postvak') return postvak
    if (plek.soort === 'bijmij') return bijMij
    return zichtbaar.filter((d) => (d.mapId ?? '') === (plek.id ?? ''))
      .filter((d) => plek.id || d.bron !== 'mail')
  }, [plek, zichtbaar, postvak, bijMij])

  const getoond = useMemo(() => {
    const q = zoek.trim().toLowerCase()
    const lijst = q
      ? zichtbaar.filter((d) =>
          d.naam.toLowerCase().includes(q) ||
          (d.omschrijving ?? '').toLowerCase().includes(q) ||
          /* En de tekst van wat hier geschreven is. Dat is de reden dat de
             inhoud in de rij staat en niet als bestand in de emmer (0083):
             een blob doorzoek je niet. */
          (isGemaakt(d) && alsTekst(alsBlokken(d.inhoud)).toLowerCase().includes(q)))
      : hier
    return [...lijst].sort((a, b) => b.createdAt - a.createdAt)
  }, [zoek, zichtbaar, hier])

  const submappen = plek.soort === 'map'
    ? mijnMappen.filter((m) => (m.ouderId ?? '') === (plek.id ?? '')).sort(
        (a, b) => a.volgorde - b.volgorde || a.naam.localeCompare(b.naam))
    : []

  const kruimels = plek.soort === 'map' ? padNaar(plek.id, mijnMappen) : []

  return (
    <>
      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div className="zoekveld">
          <Search size={15} />
          <input
            className="input"
            value={zoek}
            placeholder="Zoek in alle documenten…"
            onChange={(e) => setZoek(e.target.value)}
          />
          {zoek && (
            <button className="btn ghost sm" onClick={() => setZoek('')}><X size={14} /></button>
          )}
        </div>
        <span className="spacer" />
        {magDocumentbeheer(user) && (
          <>
            <button className="btn ghost" onClick={() => setNieuweMap(true)}>
              <FolderPlus size={15} /> Map
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                void docRepo.maken({
                  naam: 'Naamloos document',
                  inhoud: leegDocument(),
                  mapId: plek.soort === 'map' ? plek.id : undefined,
                  locationId: user.allLocations ? undefined : user.locationId,
                  door: user,
                }).then((d) => {
                  /* Meteen open: een leeg document in een lijst is iets wat je
                     daarna nog moet aanklikken, en dan sta je twee handelingen
                     verder dan waar je naartoe wilde. */
                  setOpen(d)
                  if (plek.soort === 'postvak' || plek.soort === 'bijmij') {
                    setPlek({ soort: 'map' })
                  }
                })
              }}
            >
              <FilePlus2 size={15} /> Schrijven
            </button>
            <Uploaden plek={plek} />
          </>
        )}
      </div>

      <div className="verkenner">
        {/* ---- links: de mappen ---- */}
        <aside className="verkenner-zij">
          <button
            className={`verkenner-plek ${plek.soort === 'postvak' ? 'actief' : ''}`}
            onClick={() => { setPlek({ soort: 'postvak' }); setZoek('') }}
          >
            <Inbox size={15} /> Postvak
            {postvak.length > 0 && <span className="verkenner-tel">{postvak.length}</span>}
          </button>
          <button
            className={`verkenner-plek ${plek.soort === 'bijmij' ? 'actief' : ''}`}
            onClick={() => { setPlek({ soort: 'bijmij' }); setZoek('') }}
          >
            <Users size={15} /> Bij mij
            {bijMij.length > 0 && <span className="verkenner-tel">{bijMij.length}</span>}
          </button>

          <div className="verkenner-scheiding" />

          <button
            className={`verkenner-plek ${plek.soort === 'map' && !plek.id ? 'actief' : ''}`}
            onClick={() => { setPlek({ soort: 'map' }); setZoek('') }}
          >
            <HardDrive size={15} /> Alle mappen
          </button>
          <Boom
            mappen={mijnMappen}
            ouderId={undefined}
            diep={0}
            actief={plek.soort === 'map' ? plek.id : undefined}
            kies={(id) => { setPlek({ soort: 'map', id }); setZoek('') }}
          />
        </aside>

        {/* ---- rechts: wat er in staat ---- */}
        <section className="verkenner-inhoud">
          {zoek ? (
            <p className="ts-sub" style={{ margin: '0 0 10px' }}>
              {getoond.length} resultaat{getoond.length === 1 ? '' : 'en'} voor “{zoek}”
            </p>
          ) : (
            <div className="verkenner-kruimels">
              {plek.soort === 'postvak' && <strong>Postvak</strong>}
              {plek.soort === 'bijmij' && <strong>Bij mij</strong>}
              {plek.soort === 'map' && (
                <>
                  <button onClick={() => setPlek({ soort: 'map' })}>Alle mappen</button>
                  {kruimels.map((m) => (
                    <span key={m.id}>
                      <ChevronRight size={13} />
                      <button onClick={() => setPlek({ soort: 'map', id: m.id })}>{m.naam}</button>
                    </span>
                  ))}
                </>
              )}
            </div>
          )}

          {plek.soort === 'postvak' && !zoek && postvak.length > 0 && (
            <p className="ts-sub" style={{ marginTop: 0 }}>
              Wat hier binnenkomt is nog van niemand. Zet het bij een map, een vestiging
              of een persoon en het wordt meteen smaller zichtbaar.
            </p>
          )}

          {!zoek && submappen.map((m) => (
            <button
              key={m.id}
              className="verkenner-map"
              onClick={() => setPlek({ soort: 'map', id: m.id })}
            >
              <Folder size={16} />
              <strong>{m.naam}</strong>
              {m.eigenaar && <Lock size={12} />}
              <span className="spacer" />
              <span className="ts-sub">
                {alleDocs.filter((d) => d.mapId === m.id).length} bestand(en)
              </span>
            </button>
          ))}

          {getoond.length === 0 && submappen.length === 0 ? (
            <Empty
              text={plek.soort === 'postvak'
                ? 'Het postvak is leeg. Alles is weggezet.'
                : 'Hier staat nog niets.'}
              icon={<FileText size={22} />}
            />
          ) : (
            <div className="verkenner-lijst">
              {getoond.map((d) => (
                <Regel
                  key={d.id}
                  doc={d}
                  vestigingen={vestigingen}
                  onOpen={() => setOpen(d)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {open && (
        <DocumentVenster
          doc={alleDocs.find((d) => d.id === open.id) ?? open}
          mappen={mijnMappen}
          vestigingen={vestigingen}
          mensen={mensen}
          delingen={delingen.filter((t) => t.documentId === open.id)}
          onSluiten={() => setOpen(null)}
        />
      )}

      {nieuweMap && (
        <NieuweMap
          ouderId={plek.soort === 'map' ? plek.id : undefined}
          vestigingen={vestigingen}
          onSluiten={() => setNieuweMap(false)}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  De boom links
 * ------------------------------------------------------------------ */

function Boom({
  mappen, ouderId, diep, actief, kies,
}: {
  mappen: DocMap[]
  ouderId?: string
  diep: number
  actief?: string
  kies: (id: string) => void
}) {
  /* Een grens op de diepte. Een map die (door een fout) zijn eigen voorouder
     is zou hier oneindig ver blijven tekenen en de pagina laten vastlopen. */
  if (diep > 8) return null

  const hier = mappen
    .filter((m) => (m.ouderId ?? '') === (ouderId ?? ''))
    .sort((a, b) => a.volgorde - b.volgorde || a.naam.localeCompare(b.naam))

  return (
    <>
      {hier.map((m) => (
        <div key={m.id}>
          <button
            className={`verkenner-plek ${actief === m.id ? 'actief' : ''}`}
            style={{ paddingLeft: 12 + diep * 14 }}
            onClick={() => kies(m.id)}
          >
            <Folder size={14} />
            <span className="verkenner-naam">{m.naam}</span>
            {m.eigenaar && <Lock size={11} />}
          </button>
          <Boom mappen={mappen} ouderId={m.id} diep={diep + 1} actief={actief} kies={kies} />
        </div>
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Eén regel
 * ------------------------------------------------------------------ */

const ICOON = {
  gemaakt: PenLine,
  pdf: FileText, beeld: ImageIcon, blad: FileSpreadsheet, tekst: FileText, overig: FileText,
}

function Regel({
  doc, vestigingen, onOpen,
}: {
  doc: DocBestand
  vestigingen: Location[]
  onOpen: () => void
}) {
  const Icoon = ICOON[soortVan(doc)]
  const z = ZICHTBAARHEID.find((x) => x.key === doc.zichtbaarheid)

  return (
    <div className="verkenner-regel">
      <button className="verkenner-open" onClick={onOpen}>
        <Icoon size={17} />
        <span className="verkenner-tekst">
          <strong>{doc.naam}</strong>
          <span className="verkenner-meta">
            {doc.zichtbaarheid === 'prive' && <span className="werk-prio t-warn">Alleen ik</span>}
            {doc.zichtbaarheid === 'personen' && <span className="werk-prio t-warn">Afgeschermd</span>}
            {doc.zichtbaarheid !== 'prive' && doc.zichtbaarheid !== 'personen' && z && (
              <span>{z.label}</span>
            )}
            {doc.locationId && (
              <span>{vestigingen.find((l) => l.id === doc.locationId)?.name ?? 'Vestiging'}</span>
            )}
            {doc.toegewezenNaam && <span>bij {doc.toegewezenNaam}</span>}
            {doc.bron === 'mail' && <span>per mail</span>}
            {isGemaakt(doc)
              ? <span>{eersteRegels(alsBlokken(doc.inhoud), 70) || 'Nog leeg'}</span>
              : <span>{leesbaarFormaat(doc.grootte)}</span>}
          </span>
        </span>
      </button>
      <span className="werk-datum">{dateShort(doc.createdAt)}</span>
      <Downloaden doc={doc} />
    </div>
  )
}

/**
 * Downloaden.
 *
 * De link wordt pas op het moment van klikken gemaakt en is zestig seconden
 * geldig. Hem alvast klaarzetten in de lijst zou betekenen dat er voor elk
 * document een werkende link in de pagina staat -- ook voor documenten die
 * je alleen maar in een lijst zag.
 */
function Downloaden({ doc }: { doc: DocBestand }) {
  const [bezig, setBezig] = useState(false)

  /*
   * Een geschreven document heeft geen bestand om op te halen; de PDF wordt
   * hier gemaakt uit de blokken die op dít moment in de rij staan. Daarom
   * staat er nergens een opgeslagen PDF: dan zou je de versie van gisteren
   * downloaden en dat is precies de versie die je niet rondstuurt.
   */
  if (isGemaakt(doc)) {
    return (
      <button
        className="btn ghost sm"
        title="Als PDF opslaan"
        onClick={() => {
          try {
            pdfDownloaden(doc, alsBlokken(doc.inhoud), VOET)
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'De PDF maken lukte niet.')
          }
        }}
      >
        <Download size={14} />
      </button>
    )
  }

  return (
    <button
      className="btn ghost sm"
      title="Downloaden"
      disabled={bezig}
      onClick={async () => {
        setBezig(true)
        const url = await docRepo.link(doc)
        setBezig(false)
        if (!url) { toast.error('Het bestand is nu niet op te halen.'); return }
        window.open(url, '_blank', 'noopener')
      }}
    >
      <Download size={14} />
    </button>
  )
}

/* ------------------------------------------------------------------ *
 *  Uploaden
 * ------------------------------------------------------------------ */

function Uploaden({ plek }: { plek: Plek }) {
  const user = useAuth((s) => s.user)!
  const invoer = useRef<HTMLInputElement>(null)
  const [bezig, setBezig] = useState(false)

  async function kies(bestanden: FileList | null) {
    if (!bestanden || !bestanden.length) return
    setBezig(true)
    let gelukt = 0
    for (const bestand of Array.from(bestanden)) {
      try {
        await docRepo.uploaden({
          bestand,
          mapId: plek.soort === 'map' ? plek.id : undefined,
          locationId: user.allLocations ? undefined : user.locationId,
          door: user,
        })
        gelukt++
      } catch (e) {
        toast.error(`${bestand.name}: ${(e as Error).message}`)
      }
    }
    setBezig(false)
    if (gelukt) toast.ok(gelukt === 1 ? 'Document toegevoegd' : `${gelukt} documenten toegevoegd`)
    if (invoer.current) invoer.current.value = ''
  }

  return (
    <>
      <input
        ref={invoer}
        type="file"
        multiple
        hidden
        onChange={(e) => void kies(e.target.files)}
      />
      <button className="btn primary" disabled={bezig} onClick={() => invoer.current?.click()}>
        <Upload size={15} /> {bezig ? 'Bezig…' : 'Uploaden'}
      </button>
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Eén document
 * ------------------------------------------------------------------ */

function DocumentVenster({
  doc, mappen, vestigingen, mensen, delingen, onSluiten,
}: {
  doc: DocBestand
  mappen: DocMap[]
  vestigingen: Location[]
  mensen: User[]
  delingen: DocToegang[]
  onSluiten: () => void
}) {
  const user = useAuth((s) => s.user)!
  const [deelMet, setDeelMet] = useState('')
  const mag = magDocumentbeheer(user)
  const geschreven = isGemaakt(doc)

  return (
    <Modal open title={doc.naam} onClose={onSluiten} width={geschreven ? 760 : 620}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {geschreven
          ? <Badge tone="info">Hier geschreven</Badge>
          : <Badge tone="info">{leesbaarFormaat(doc.grootte)}</Badge>}
        {doc.bron === 'mail' && <Badge>Per mail binnengekomen</Badge>}
        {doc.doorNaam && <Badge>van {doc.doorNaam}</Badge>}
        <Badge>{dateShort(doc.createdAt)}</Badge>
      </div>

      {geschreven && <Schrijver doc={doc} lezen={!mag} />}

      {doc.omschrijving && <p style={{ whiteSpace: 'pre-wrap' }}>{doc.omschrijving}</p>}

      {mag && (
        <>
          <h4 style={{ marginTop: 16, marginBottom: 8 }}>Waar hoort het</h4>
          <div className="grid cols-2">
            <Field label="Map">
              <select
                className="input"
                value={doc.mapId ?? ''}
                onChange={(e) => void docRepo.opbergen(doc.id, { mapId: e.target.value || undefined })}
              >
                <option value="">Postvak (nog nergens)</option>
                {mappen.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
              </select>
            </Field>
            {/* Alleen de vestigingen waar deze persoon over gaat. Stonden ze
                er allemaal in, dan koos iemand er een waar hij niet bij mag en
                weigerde de server het record -- waarna het onzichtbaar in de
                wachtrij bleef staan. */}
            <Field label="Vestiging">
              <select
                className="input"
                value={doc.locationId ?? ''}
                onChange={(e) => {
                  void docRepo.opbergen(doc.id,
                    { locationId: e.target.value || undefined }, user)
                    .catch((err: Error) => toast.error(err.message))
                }}
              >
                <option value="">Geen vestiging</option>
                {mijnVestigingen(vestigingen, user)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="Bij wie">
              <select
                className="input"
                value={doc.toegewezenAan ?? ''}
                onChange={(e) => {
                  const m = mensen.find((p) => p.id === e.target.value)
                  void docRepo.opbergen(doc.id, {
                    toegewezenAan: m?.id, toegewezenNaam: m?.name,
                  })
                }}
              >
                <option value="">Niemand in het bijzonder</option>
                {mensen.filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name))
                  .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field
              label="Wie mag het zien"
              help={ZICHTBAARHEID.find((z) => z.key === doc.zichtbaarheid)?.uitleg}
            >
              <select
                className="input"
                value={doc.zichtbaarheid}
                onChange={(e) => void docRepo.bijwerken(doc.id, {
                  zichtbaarheid: e.target.value as DocZichtbaarheid,
                  /* Wie "alleen ik" kiest wordt ook de eigenaar; anders schermt
                     hij iets af waar hij daarna zelf niet meer bij kan. */
                  ...(e.target.value === 'prive' && !doc.eigenaar ? { eigenaar: user.id } : {}),
                })}
              >
                {ZICHTBAARHEID.map((z) => <option key={z.key} value={z.key}>{z.label}</option>)}
              </select>
            </Field>
          </div>

          {doc.zichtbaarheid === 'rollen' && (
            <Field label="Welke rollen">
              <div className="sol-locaties">
                {(['management', 'supervisor', 'administratie', 'technician', 'developer'] as Role[])
                  .map((r) => (
                    <label key={r}>
                      <input
                        type="checkbox"
                        checked={(doc.rollen ?? []).includes(r)}
                        onChange={(e) => {
                          const n = new Set(doc.rollen ?? [])
                          if (e.target.checked) n.add(r); else n.delete(r)
                          void docRepo.bijwerken(doc.id, { rollen: [...n] })
                        }}
                      />
                      <span>{r}</span>
                    </label>
                  ))}
              </div>
            </Field>
          )}

          {/* --- los delen --- */}
          <h4 style={{ marginTop: 16, marginBottom: 8 }}>Los gedeeld met</h4>
          {delingen.length === 0 && (
            <p className="ts-sub" style={{ marginTop: 0 }}>Met niemand apart gedeeld.</p>
          )}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {delingen.map((t) => {
              const wie = mensen.find((m) => m.id === t.profileId)
              return (
                <span key={t.id} className="chip">
                  {wie?.name ?? t.profileId}
                  <button onClick={() => void deelRepo.intrekken(t.id)} aria-label="Intrekken">
                    <X size={12} />
                  </button>
                </span>
              )
            })}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <select className="input" value={deelMet} onChange={(e) => setDeelMet(e.target.value)}>
              <option value="">Kies iemand…</option>
              {mensen.filter((m) => m.active && !delingen.some((t) => t.profileId === m.id))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button
              className="btn"
              disabled={!deelMet}
              onClick={() => {
                void deelRepo.met(doc.id, deelMet, user).then(() => {
                  toast.ok('Gedeeld')
                  setDeelMet('')
                })
              }}
            >
              Delen
            </button>
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        {mag && (
          <button
            className="btn ghost danger"
            onClick={() => {
              void docRepo.verwijderen(doc.id).then(() => { toast.ok('Weg'); onSluiten() })
            }}
          >
            <Trash2 size={15} /> Weggooien
          </button>
        )}
        <span className="spacer" />
        {geschreven && (
          <button
            className="btn ghost"
            title="Printen"
            onClick={() => printen(doc.naam, alsBlokken(doc.inhoud), VOET)}
          >
            <Printer size={15} /> Printen
          </button>
        )}
        <Downloaden doc={doc} />
        <button className="btn primary" onClick={onSluiten}>Klaar</button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 *  Schrijven
 *
 *  Blok voor blok, want dat is het model (zie documentmaken.ts). Eén veld per
 *  blok met zijn soort ernaast, en knoppen om hem te verplaatsen.
 *
 *  Waarom er een knop "Bewaren" staat en het niet vanzelf gaat
 *  ----------------------------------------------------------
 *
 *  Vanzelf opslaan is prettiger en het kan hier niet zomaar: elke opslag zet
 *  een regel in de wachtrij en die gaat naar de server. Bij elke toetsaanslag
 *  zou dat honderden regels per alinea zijn, en op een tablet met een slechte
 *  verbinding loopt die wachtrij dan vol met versies van dezelfde zin.
 *
 *  Dus met een knop, en met een merkteken erbij zolang er iets niet bewaard
 *  is -- plus een waarschuwing als je het venster sluit. Een document dat je
 *  kwijt bent omdat je op het kruisje drukte is erger dan een knop.
 * ------------------------------------------------------------------ */

function Schrijver({ doc, lezen }: { doc: DocBestand; lezen: boolean }) {
  const [naam, setNaam] = useState(doc.naam)
  const [blokken, setBlokken] = useState<DocBlok[]>(() => {
    const uit = alsBlokken(doc.inhoud)
    return uit.length ? uit : leegDocument()
  })
  const [vuil, setVuil] = useState(false)
  const [bezig, setBezig] = useState(false)

  function wijzig(nieuw: DocBlok[]) {
    setBlokken(nieuw)
    setVuil(true)
  }

  async function bewaren() {
    setBezig(true)
    try {
      await docRepo.bijwerken(doc.id, {
        naam: naam.trim() || 'Naamloos document',
        inhoud: blokken,
      })
      setVuil(false)
      toast.ok('Bewaard')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bewaren lukte niet.')
    } finally {
      setBezig(false)
    }
  }

  if (lezen) {
    /* Wie het document wel mag zien maar niet beheren, leest het gewoon --
       en kan het printen en als PDF opslaan; die knoppen staan onderaan het
       venster. Bewerken hoort bij het documentbeheer, net als uploaden. */
    const nummers = nummering(blokken)
    return (
      <div className="doc-lees">
        {blokken.map((b, i) => <Vertoon key={b.id} blok={b} nummer={nummers[i]} />)}
      </div>
    )
  }

  return (
    <>
      <Field label="Naam">
        <input
          className="input"
          value={naam}
          onChange={(e) => { setNaam(e.target.value); setVuil(true) }}
          placeholder="Waar gaat het over?"
        />
      </Field>

      <div className="doc-schrijf">
        {blokken.map((b, i) => (
          <div key={b.id} className="doc-blok">
            <select
              className="input doc-blok-soort"
              value={b.soort}
              onChange={(e) => wijzig(zetSoort(blokken, b.id, e.target.value as DocBlokSoort))}
            >
              {SOORTEN.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>

            {ZONDER_TEKST.includes(b.soort) ? (
              <span className="doc-blok-leeg">
                {b.soort === 'streep' ? '───────────' : '(witregel)'}
              </span>
            ) : b.soort === 'kop1' || b.soort === 'kop2' ? (
              <input
                className={`input doc-blok-tekst ${b.soort}`}
                value={b.tekst}
                placeholder={b.soort === 'kop1' ? 'Kop' : 'Tussenkop'}
                onChange={(e) => wijzig(zetTekst(blokken, b.id, e.target.value))}
              />
            ) : (
              <textarea
                className="input doc-blok-tekst"
                value={b.tekst}
                placeholder={b.soort === 'alinea' ? 'Typ hier…' : 'Regel'}
                rows={Math.min(12, Math.max(2, b.tekst.split('\n').length))}
                onChange={(e) => wijzig(zetTekst(blokken, b.id, e.target.value))}
              />
            )}

            <div className="doc-blok-knoppen">
              <button
                className="btn ghost sm"
                title="Omhoog"
                disabled={i === 0}
                onClick={() => wijzig(verplaats(blokken, b.id, -1))}
              >
                <ArrowUp size={13} />
              </button>
              <button
                className="btn ghost sm"
                title="Omlaag"
                disabled={i === blokken.length - 1}
                onClick={() => wijzig(verplaats(blokken, b.id, 1))}
              >
                <ArrowDown size={13} />
              </button>
              <button
                className="btn ghost sm"
                title="Regel eronder"
                onClick={() => wijzig(voegToe(blokken, b.id, nieuwBlok(
                  /* Een nieuwe regel onder een opsomming hoort weer een
                     opsomming te zijn. Anders typ je bij elk punt eerst de
                     soort opnieuw, en dat is precies waar een lijst voor
                     bedoeld is. */
                  b.soort === 'punt' || b.soort === 'genummerd' ? b.soort : 'alinea')))}
              >
                <Plus size={13} />
              </button>
              <button
                className="btn ghost sm danger"
                title="Regel weg"
                onClick={() => wijzig(haalWeg(blokken, b.id))}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button
          className="btn ghost"
          onClick={() => wijzig(voegToe(blokken, undefined, nieuwBlok('alinea')))}
        >
          <Plus size={14} /> Regel
        </button>
        <span className="spacer" />
        {vuil && <span className="ts-sub">Nog niet bewaard</span>}
        <button className="btn primary" disabled={bezig || !vuil} onClick={() => void bewaren()}>
          <Save size={15} /> {bezig ? 'Bezig…' : 'Bewaren'}
        </button>
      </div>
    </>
  )
}

/** Eén blok, zoals het eruitziet voor wie het alleen leest. */
function Vertoon({ blok, nummer }: { blok: DocBlok; nummer: number }) {
  if (blok.soort === 'streep') return <hr />
  if (blok.soort === 'wit') return <p>&nbsp;</p>
  if (blok.soort === 'kop1') return <h3>{blok.tekst}</h3>
  if (blok.soort === 'kop2') return <h4>{blok.tekst}</h4>
  if (blok.soort === 'punt') return <p style={{ paddingLeft: 16 }}>• {blok.tekst}</p>
  if (blok.soort === 'genummerd') {
    return <p style={{ paddingLeft: 16 }}>{nummer}. {blok.tekst}</p>
  }
  return <p style={{ whiteSpace: 'pre-wrap' }}>{blok.tekst}</p>
}

/* ------------------------------------------------------------------ *
 *  Nieuwe map
 * ------------------------------------------------------------------ */

function NieuweMap({
  ouderId, vestigingen, onSluiten,
}: {
  ouderId?: string
  vestigingen: Location[]
  onSluiten: () => void
}) {
  const user = useAuth((s) => s.user)!
  const [naam, setNaam] = useState('')
  const [locatie, setLocatie] = useState('')
  const [prive, setPrive] = useState(false)

  return (
    <Modal open title="Nieuwe map" onClose={onSluiten} alleenBewustSluiten>
      <Field label="Naam">
        <input className="input" value={naam} autoFocus
               onChange={(e) => setNaam(e.target.value)}
               placeholder="bijv. Keuringen 2026" />
      </Field>
      <Field label="Vestiging" help="Leeg laten betekent: van het hele bedrijf.">
        <select className="input" value={locatie} disabled={prive}
                onChange={(e) => setLocatie(e.target.value)}>
          <option value="">Geen vestiging</option>
          {mijnVestigingen(vestigingen, user)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
      <label className="row" style={{ gap: 8, alignItems: 'center', marginTop: 4 }}>
        <input type="checkbox" checked={prive} onChange={(e) => setPrive(e.target.checked)} />
        <span>Alleen voor mij — niemand anders ziet deze map of wat erin staat.</span>
      </label>

      <div className="row" style={{ marginTop: 14 }}>
        <span className="spacer" />
        <button className="btn ghost" onClick={onSluiten}>Annuleren</button>
        <button
          className="btn primary"
          disabled={!naam.trim()}
          onClick={() => {
            void mapRepo.aanmaken({
              naam, ouderId, prive,
              locationId: prive ? undefined : (locatie || undefined),
              door: user,
            }).then(() => { toast.ok('Map aangemaakt'); onSluiten() })
          }}
        >
          <FolderPlus size={15} /> Aanmaken
        </button>
      </div>
    </Modal>
  )
}
