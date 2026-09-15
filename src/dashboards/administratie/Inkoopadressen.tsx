/* ==================================================================== *
 *  Waar facturen binnenkomen
 *
 *  Casper: "We hebben meerdere bv's, en dat is prima, maar het moet
 *  makkelijker gaan. De mailadressen moeten niet per vestiging, maar per
 *  onderneming, je moet wel een vestiging kunnen koppelen aan een mailadres.
 *  (...) de tweede goedkeuring moet dan komen te liggen bij een persoon, ik
 *  stel voor dat we een werknemer (degene met de juiste rechten) kunnen
 *  koppelen aan het mailadres."
 *
 *  Waarom dit een lijst is en geen berekening
 *  ------------------------------------------
 *
 *  Tot 0095 werd het adres UITGEREKEND: inkoop.<website-slug>@<domein>, en de
 *  vestiging werd er weer uit teruggerekend. Dat is aardig zolang een adres
 *  één ding betekent. Maar de bv is wat telt voor de boekhouding, en die
 *  volgde uit de vestiging -- dus een bv zonder wasstraat (Vastgoed, Techniek
 *  & Beheer) had geen adres waarop zijn facturen konden binnenkomen. De enige
 *  weg was: binnen laten komen op een vestiging en daarna met de hand de
 *  onderneming omzetten.
 *
 *  Nu is een adres een afspraak met drie dingen eraan: de bv (verplicht), een
 *  vestiging (mag), en wie de tweede handtekening zet.
 * ==================================================================== */

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Check, Copy, Plus, X } from 'lucide-react'

import { Card, Empty, Field, Kiezer, Modal } from '../../components/ui'
import { db, uid } from '../../lib/db'
import { enqueue } from '../../lib/sync'
import { toast } from '../../store/useToasts'
import { usePerms } from '../../store/useNav'
import { exactFacturenStand, type ExactAdministratie } from '../../lib/trucksupply'
import type { InkoopAdres, Location, User } from '../../lib/types'

/** Iemand die een tweede handtekening mag zetten. */
function magTekenen(u: User): boolean {
  if (!u.active || u.archivedAt) return false
  if (u.isDevice) return false
  const rollen = u.roles ?? []
  return rollen.includes('management')
    || rollen.includes('administratie')
    || (u.grants ?? []).includes('expenses.approve')
}

export default function Inkoopadressen() {
  const perms = usePerms()
  const mag = perms.can('admin.desk') || perms.can('expenses.approve')

  const adressen = useLiveQuery(
    () => db.inkoopAdressen.toArray(), [], [] as InkoopAdres[])
  const vestigingen = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const mensen = useLiveQuery(() => db.users.toArray(), [], [] as User[])

  const [bedrijven, setBedrijven] = useState<ExactAdministratie[]>([])
  const [open, setOpen] = useState<InkoopAdres | 'nieuw' | null>(null)

  useMemo(() => {
    let weg = false
    exactFacturenStand()
      .then((s) => { if (!weg) setBedrijven(s.administraties) })
      .catch(() => {})
    return () => { weg = true }
  }, [])

  const bvNaam = useMemo(
    () => new Map(bedrijven.map((b) => [b.code, b.naam])), [bedrijven])
  const vestigingNaam = useMemo(
    () => new Map(vestigingen.map((l) => [l.id, l.name])), [vestigingen])
  const mensNaam = useMemo(
    () => new Map(mensen.map((u) => [u.id, u.name])), [mensen])

  const opVolgorde = useMemo(
    () => [...adressen].sort((a, b) =>
      (a.administratie ?? '').localeCompare(b.administratie ?? '')
      || a.adres.localeCompare(b.adres)),
    [adressen])

  /*
   * Een bv zonder adres kan geen facturen ontvangen. Dat hoort hier te staan
   * en niet pas te blijken als er een maand niets binnenkwam.
   */
  const zonderAdres = useMemo(
    () => bedrijven.filter((b) => b.actief && !adressen.some(
      (a) => a.actief && a.administratie === b.code)),
    [bedrijven, adressen])

  async function bewaar(rij: InkoopAdres) {
    await db.inkoopAdressen.put(rij)
    await enqueue('inkoopAdressen', 'put', rij.id, rij)
    setOpen(null)
    toast.ok(`${rij.adres} is opgeslagen.`)
  }

  async function weg(rij: InkoopAdres) {
    await db.inkoopAdressen.delete(rij.id)
    await enqueue('inkoopAdressen', 'delete', rij.id, null)
    toast.ok(`${rij.adres} is weggehaald.`)
  }

  return (
    <Card
      title="Waar facturen binnenkomen"
      hint="Per onderneming een adres, met wie de tweede handtekening zet"
      className="mb"
      action={mag ? (
        <button className="btn ghost sm" onClick={() => setOpen('nieuw')}>
          <Plus size={14} /> Adres
        </button>
      ) : undefined}
    >
      {zonderAdres.length > 0 && (
        <div className="waarschuwing mb">
          <AlertTriangle size={15} />
          <span>
            {zonderAdres.length === 1 ? 'Eén onderneming heeft' : `${zonderAdres.length} ondernemingen hebben`}
            {' '}nog geen adres: {zonderAdres.map((b) => b.naam).join(', ')}. Facturen
            van die bv kunnen nergens binnenkomen.
          </span>
        </div>
      )}

      {opVolgorde.length === 0 && (
        <Empty text="Er is nog geen enkel inkoopadres. Zonder adres komt er geen factuur binnen." />
      )}

      {opVolgorde.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Adres</th>
                <th>Onderneming</th>
                <th>Vestiging</th>
                <th>Tweede handtekening</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {opVolgorde.map((a) => (
                <tr key={a.id} style={{ opacity: a.actief ? 1 : 0.55 }}>
                  <td><code>{a.adres}</code></td>
                  <td>
                    {bvNaam.get(a.administratie) ?? a.administratie}
                    <div className="ts-sub mono">{a.administratie}</div>
                  </td>
                  <td className="afgekapt">
                    {a.locationId
                      ? (vestigingNaam.get(a.locationId) ?? a.locationId)
                      : <span className="ts-sub">— geen —</span>}
                  </td>
                  <td className="afgekapt">
                    {a.goedkeurder
                      ? (mensNaam.get(a.goedkeurder) ?? a.goedkeurder)
                      /* Leeg is geen fout maar wel het vermelden waard: dan
                         ligt het werk bij een groep, en dat is bij niemand. */
                      : <span className="ts-sub">wie over kosten beslist</span>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Kopieer adres={a.adres} />
                      {mag && (
                        <>
                          <button className="btn ghost sm" onClick={() => setOpen(a)}>
                            Wijzigen
                          </button>
                          <button
                            className="btn ghost sm"
                            title="Weghalen"
                            onClick={() => void weg(a)}
                          >
                            <X size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="ts-sub" style={{ marginTop: 8 }}>
        Een factuur die hier binnenkomt draagt meteen de onderneming van dit
        adres. Staat er op het stuk zelf een KvK- of btw-nummer van een andere
        bv, dan wint dat — dat is harder dan een adres.
      </p>

      {open && (
        <Wijzigen
          rij={open === 'nieuw' ? null : open}
          bedrijven={bedrijven}
          vestigingen={vestigingen.filter((l) => l.active !== false)}
          mensen={mensen.filter(magTekenen)}
          sluit={() => setOpen(null)}
          bewaar={bewaar}
        />
      )}
    </Card>
  )
}

function Kopieer({ adres }: { adres: string }) {
  const [gekopieerd, setGekopieerd] = useState(false)
  return (
    <button
      className="btn ghost sm"
      title="Adres kopiëren"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(adres)
          setGekopieerd(true)
          setTimeout(() => setGekopieerd(false), 1500)
        } catch {
          toast.error('Kopiëren lukte niet; selecteer het adres met de hand.')
        }
      }}
    >
      {gekopieerd ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

function Wijzigen({ rij, bedrijven, vestigingen, mensen, sluit, bewaar }: {
  rij: InkoopAdres | null
  bedrijven: ExactAdministratie[]
  vestigingen: Location[]
  mensen: User[]
  sluit: () => void
  bewaar: (rij: InkoopAdres) => Promise<void>
}) {
  const [adres, setAdres] = useState(rij?.adres ?? '')
  const [bv, setBv] = useState(rij?.administratie ?? '')
  const [vestiging, setVestiging] = useState(rij?.locationId ?? '')
  const [wie, setWie] = useState(rij?.goedkeurder ?? '')
  const [actief, setActief] = useState(rij?.actief ?? true)
  const [bezig, setBezig] = useState(false)

  const schoon = adres.trim().toLowerCase()
  const adresKlopt = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(schoon)
  const kan = adresKlopt && !!bv

  async function opslaan() {
    setBezig(true)
    try {
      await bewaar({
        id: rij?.id ?? uid('ia_'),
        adres: schoon,
        administratie: bv,
        locationId: vestiging || undefined,
        goedkeurder: wie || undefined,
        omschrijving: rij?.omschrijving,
        actief,
        door: rij?.door,
        createdAt: rij?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      })
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal open title={rij ? 'Adres wijzigen' : 'Nieuw inkoopadres'} onClose={sluit} width={620}>
      <Field
        label="Adres"
        help="Het hele adres, zoals de leverancier het gebruikt."
      >
        <input
          className="input mono"
          value={adres}
          autoFocus
          placeholder="inkoop.groep@truckwash1group.nl"
          onChange={(e) => setAdres(e.currentTarget.value)}
        />
      </Field>

      <Field
        label="Onderneming"
        help="Verplicht. Hier worden de facturen van dit adres geboekt."
      >
        <Kiezer
          waarde={bv}
          leeg="— kies een bv —"
          zoekHint="Naam of nummer"
          opties={bedrijven
            .filter((b) => b.actief || b.code === bv)
            .map((b) => ({ waarde: b.code, label: b.naam, sub: b.code }))}
          onKies={setBv}
        />
      </Field>

      <Field
        label="Vestiging"
        help="Mag leeg. Staat hij er, dan draagt de bon ook meteen die vestiging."
      >
        <Kiezer
          waarde={vestiging}
          leeg="— geen vestiging —"
          zoekHint="Naam of plaats"
          opties={vestigingen.map((l) => ({
            waarde: l.id, label: l.name, sub: l.city ?? undefined,
          }))}
          onKies={setVestiging}
        />
      </Field>

      <Field
        label="Tweede handtekening"
        help="Wie deze facturen aftekent. Het management kan het altijd — ook als deze persoon er niet is."
      >
        <Kiezer
          waarde={wie}
          leeg="— wie over kosten beslist —"
          zoekHint="Naam"
          legeLijst="Niemand met het recht om kosten goed te keuren"
          opties={mensen.map((u) => ({
            waarde: u.id, label: u.name, sub: u.function ?? undefined,
          }))}
          onKies={setWie}
        />
      </Field>

      <label className="row" style={{ gap: 8, marginTop: 10 }}>
        <input type="checkbox" checked={actief} onChange={(e) => setActief(e.target.checked)} />
        <span>
          Actief
          <span className="ts-sub">
            {' '}— uit betekent: post op dit adres wordt niet meer als factuur aangenomen.
          </span>
        </span>
      </label>

      {!adresKlopt && adres.trim() !== '' && (
        <p className="ts-sub" style={{ color: 'var(--warn)', marginTop: 8 }}>
          Dat ziet er niet uit als een mailadres.
        </p>
      )}

      <div className="row" style={{ gap: 8, marginTop: 14 }}>
        <button className="btn primary" disabled={!kan || bezig} onClick={() => void opslaan()}>
          Opslaan
        </button>
        <button className="btn ghost" disabled={bezig} onClick={sluit}>Annuleren</button>
      </div>
    </Modal>
  )
}
