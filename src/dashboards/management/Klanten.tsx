import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle, Briefcase, Building2, Loader2, Pencil, Plus, Search, Trash2,
} from 'lucide-react'
import { db } from '../../lib/db'
import { klanten, pastBijZoek } from '../../lib/klanten'
import type { Company, WashJob } from '../../lib/types'
import { money, number } from '../../lib/format'
import { Card, Empty, Field, Modal } from '../../components/ui'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'

/* ------------------------------------------------------------------ *
 *  Klanten
 *
 *  Casper: "Daarnaast moet je alle klanten, gebruikers ect kunnen beheren bij
 *  managment, kunnen aanmaken."
 *
 *  Dit gaat over public.companies: het bedrijf waar de factuur heen gaat. Niet
 *  te verwarren met het scherm dat tot nu toe "Klanten" heette -- dat zijn de
 *  werkgevers, de transportbedrijven waarvan de chauffeurs komen wassen. Beide
 *  bestaan naast elkaar en dat is geen fout: een werkgever kan aan een
 *  factuuradres hangen, en een factuuradres kan er zijn zonder werkgever.
 *
 *  Het menu noemt dit scherm daarom "Facturatieklanten" en het andere gewoon
 *  "Klanten". Lelijker en minder verwarrend.
 * ------------------------------------------------------------------ */

export default function Klanten({ openId }: { openId?: string | null }) {
  const perms = usePerms()
  const magBeheren = perms.can('customers.manage')

  const alle = useLiveQuery(
    () => db.companies.orderBy('name').toArray(), [], [] as Company[])
  const beurten = useLiveQuery(() => db.washJobs.toArray(), [], [] as WashJob[])

  const [zoek, setZoek] = useState('')
  const [bewerken, setBewerken] = useState<Company | null>(null)
  const [nieuw, setNieuw] = useState(false)
  const [wissen, setWissen] = useState<Company | null>(null)

  const rijen = useMemo(
    () => alle.filter((c) => pastBijZoek(c, zoek)),
    [alle, zoek],
  )

  /* Wat er per klant aan werk hangt. Dat is wat verwijderen tegenhoudt, dus
     het hoort in de lijst te staan en niet pas in het venster erna. */
  const perKlant = useMemo(() => {
    const kaart = new Map<string, { beurten: number; omzet: number }>()
    for (const j of beurten) {
      const r = kaart.get(j.companyId) ?? { beurten: 0, omzet: 0 }
      r.beurten += 1
      r.omzet += j.priceExcl ?? 0
      kaart.set(j.companyId, r)
    }
    return kaart
  }, [beurten])

  const geopend = openId ? alle.find((c) => c.id === openId) : undefined

  return (
    <>
      <Card
        title="Facturatieklanten"
        hint="De bedrijven waar een factuur heen gaat"
        action={magBeheren
          ? (
            <button className="btn primary sm" onClick={() => setNieuw(true)}>
              <Plus size={14} /> Nieuwe klant
            </button>
          )
          : undefined}
      >
        <div className="zoekveld mb">
          <Search size={15} />
          <input
            className="input"
            placeholder="Naam, plaats, contactpersoon of mailadres"
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
          />
        </div>

        {rijen.length === 0
          ? (
            <Empty
              text={alle.length === 0
                ? 'Er staan nog geen klanten in.'
                : 'Geen klant gevonden.'}
              icon={<Building2 size={22} />}
            />
          )
          : (
            <div className="tabelwrap">
              <table className="tabel">
                <thead>
                  <tr>
                    <th>Naam</th>
                    <th>Plaats</th>
                    <th>Contact</th>
                    <th className="rechts">Korting</th>
                    <th className="rechts">Wasbeurten</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rijen.map((c) => {
                    const werk = perKlant.get(c.id)
                    return (
                      <tr key={c.id} className={geopend?.id === c.id ? 'uitgelicht' : undefined}>
                        <td><strong>{c.name}</strong></td>
                        <td>{c.city || '—'}</td>
                        <td>
                          {c.contact || '—'}
                          {c.email && <div className="muted small">{c.email}</div>}
                        </td>
                        <td className="rechts">
                          {c.contractDiscountPct ? `${c.contractDiscountPct}%` : '—'}
                        </td>
                        <td className="rechts">
                          {werk
                            ? <>{number(werk.beurten)}<div className="muted small">{money(werk.omzet)}</div></>
                            : '—'}
                        </td>
                        <td className="rechts">
                          {magBeheren && (
                            <div className="row end" style={{ gap: 6 }}>
                              <button
                                className="btn sm ghost"
                                onClick={() => setBewerken(c)}
                                title="Wijzigen"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                className="btn sm ghost"
                                onClick={() => setWissen(c)}
                                title="Verwijderen"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <KlantVenster
        open={nieuw || !!bewerken}
        klant={bewerken}
        onClose={() => { setNieuw(false); setBewerken(null) }}
      />

      <Wissen klant={wissen} onClose={() => setWissen(null)} />
    </>
  )
}

/* ------------------------ Aanmaken en wijzigen -------------------- */

function KlantVenster({ open, klant, onClose }: {
  open: boolean
  klant: Company | null
  onClose: () => void
}) {
  const leeg = () => ({
    name: klant?.name ?? '',
    contact: klant?.contact ?? '',
    email: klant?.email ?? '',
    phone: klant?.phone ?? '',
    city: klant?.city ?? '',
    korting: String(klant?.contractDiscountPct ?? 0),
  })

  const [form, setForm] = useState(leeg)
  const [sleutel, setSleutel] = useState(klant?.id ?? '')
  const [bezig, setBezig] = useState(false)

  /* Bij het openen van een andere klant het formulier opnieuw vullen. */
  const nieuweSleutel = (klant?.id ?? '') + ':' + (klant?.updatedAt ?? 0)
  if (open && sleutel !== nieuweSleutel) {
    setSleutel(nieuweSleutel)
    setForm(leeg())
  }

  const set = (patch: Partial<ReturnType<typeof leeg>>) => setForm({ ...form, ...patch })

  async function bewaar() {
    if (!form.name.trim()) return toast.error('Een klant heeft in elk geval een naam nodig')

    /*
     * De korting gaat op de factuur, dus hier wordt hij nagerekend en niet
     * aangenomen. Een leeg veld is nul, een onzinwaarde is een fout -- en
     * geen stille nul, want dan factureer je zonder de afgesproken korting.
     */
    const korting = Number(form.korting.replace(',', '.'))
    if (!Number.isFinite(korting) || korting < 0 || korting > 100) {
      return toast.error('De korting moet een getal tussen 0 en 100 zijn')
    }

    setBezig(true)
    try {
      const velden = {
        name: form.name.trim(),
        contact: form.contact.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        city: form.city.trim(),
        contractDiscountPct: korting,
      }
      if (klant) {
        await klanten.wijzig(klant.id, velden)
        toast.ok('Klant bijgewerkt')
      } else {
        await klanten.maak(velden)
        toast.ok('Klant aangemaakt')
      }
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan lukte niet')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title={klant ? 'Klant wijzigen' : 'Nieuwe klant'}
      subtitle={klant?.name}
      onClose={onClose}
      width={560}
    >
      <Field label="Bedrijfsnaam">
        <input
          className="input" value={form.name} autoFocus
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>

      <div className="grid cols-2">
        <Field label="Contactpersoon">
          <input
            className="input" value={form.contact}
            onChange={(e) => set({ contact: e.target.value })}
          />
        </Field>
        <Field label="Plaats">
          <input
            className="input" value={form.city}
            onChange={(e) => set({ city: e.target.value })}
          />
        </Field>
      </div>

      <div className="grid cols-2">
        <Field label="E-mailadres" help="Hier gaan de verkoopfacturen heen.">
          <input
            className="input" type="email" value={form.email}
            onChange={(e) => set({ email: e.target.value })}
          />
        </Field>
        <Field label="Telefoon">
          <input
            className="input" value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
          />
        </Field>
      </div>

      <Field label="Contractkorting" help="Percentage op de standaardprijs. 0 is geen korting.">
        <input
          className="input" value={form.korting} inputMode="decimal"
          onChange={(e) => set({ korting: e.target.value })}
        />
      </Field>

      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button className="btn primary" disabled={bezig} onClick={() => void bewaar()}>
          {bezig ? <Loader2 size={14} className="spin" /> : <Briefcase size={14} />}
          {klant ? 'Opslaan' : 'Aanmaken'}
        </button>
      </div>
    </Modal>
  )
}

/* ----------------------------- Wissen ----------------------------- */

/**
 * Verwijderen, maar eerst vragen of het mag.
 *
 * De reden komt uit de database (klant_verwijderen_belet, 0075) en wordt hier
 * niet nagebouwd: dezelfde functie zit als slot op de tabel, dus het scherm
 * en de database kunnen niet uit elkaar lopen.
 *
 * Waarom vooraf en niet gewoon proberen: de app schrijft eerst plaatselijk en
 * duwt daarna via de wachtrij. Zou de database het weigeren, dan is de klant
 * hier al weg en blijft de weigering in de wachtrij hangen -- en dan lijkt het
 * gelukt.
 */
function Wissen({ klant, onClose }: { klant: Company | null; onClose: () => void }) {
  const [belet, setBelet] = useState<string | null | undefined>(undefined)
  const [onbekend, setOnbekend] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [gevraagdVoor, setGevraagdVoor] = useState<string | null>(null)

  if (klant && gevraagdVoor !== klant.id) {
    setGevraagdVoor(klant.id)
    setBelet(undefined)
    setOnbekend(false)
    void klanten.verwijderenBelet(klant.id).then((uit) => {
      if (uit === null) setOnbekend(true)
      else setBelet(uit.reden)
    })
  }
  if (!klant && gevraagdVoor !== null) setGevraagdVoor(null)

  async function doe() {
    if (!klant) return
    setBezig(true)
    try {
      await klanten.verwijder(klant.id)
      toast.ok(`${klant.name} is verwijderd`)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verwijderen lukte niet')
    } finally {
      setBezig(false)
    }
  }

  const magWeg = belet === null && !onbekend

  return (
    <Modal
      open={!!klant}
      title="Klant verwijderen"
      subtitle={klant?.name}
      onClose={onClose}
    >
      {belet === undefined && !onbekend && (
        <p className="help" style={{ marginTop: 0 }}>
          <Loader2 size={14} className="spin" /> Nakijken of dit kan…
        </p>
      )}

      {onbekend && (
        <div className="waarschuwing zacht mb">
          <AlertTriangle size={16} />
          <span>
            Zonder verbinding kan ik niet nakijken wat er aan deze klant hangt.
            Verwijderen kan straks alsnog geweigerd worden, en dan blijft het
            hier hangen. Probeer het opnieuw als je online bent.
          </span>
        </div>
      )}

      {typeof belet === 'string' && (
        <div className="waarschuwing zacht mb">
          <AlertTriangle size={16} />
          <span>{belet}</span>
        </div>
      )}

      {magWeg && (
        <p className="help" style={{ marginTop: 0 }}>
          Er hangt niets aan deze klant. Hij verdwijnt van alle apparaten.
        </p>
      )}

      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button
          className="btn danger"
          disabled={bezig || !magWeg}
          onClick={() => void doe()}
        >
          {bezig ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
          Verwijderen
        </button>
      </div>
    </Modal>
  )
}
