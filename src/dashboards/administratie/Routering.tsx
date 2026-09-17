import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Brain, Play, RefreshCw, Trash2, TriangleAlert, UserCheck } from 'lucide-react'

import { Badge, Card, Empty, Field, Modal } from '../../components/ui'
import Groep from '../../components/Groep'
import { db } from '../../lib/db'
import { relative } from '../../lib/format'
import {
  bewaarBvRoute, bvRoutes, facturenRouteren, leverancierRoutes, magBeoordelen,
  vergeetRoute,
  type BvRoute, type LeverancierRoute,
} from '../../lib/routering'
import type { User } from '../../lib/types'
import { usePerms } from '../../store/useNav'
import { toast } from '../../store/useToasts'

/* ==================================================================== *
 *  Wie een factuur krijgt, per onderneming
 *
 *  Casper: "Je moet dus ai laten kijken, en evt direct laten daarzetten naar
 *  degene die akkoord moet geven. Maar als AI hem nog niet kent ect, moet je
 *  hem onder de eerste persoon zetten (...) Zorg dat je dit per bv kan
 *  instellen."
 *
 *  Twee knoppen per bv, en ze doen allebei iets anders:
 *
 *    de eerste persoon   waar een onbekende factuur heen gaat. Zonder dit
 *                        ligt hij bij de ROL administratie, en dat is een
 *                        stapel waar niemand zich eigenaar van voelt.
 *
 *    direct doorzetten   mag het geheugen hem meteen bij de vorige tekenaar
 *                        leggen. Uit betekent: alles langs de eerste persoon,
 *                        ook wat we allang kennen.
 *
 *  Het rekenwerk staat in de database (0106). Dit scherm zet alleen de
 *  instelling en laat zien wat het geheugen inmiddels weet.
 * ==================================================================== */

export default function Routering() {
  const perms = usePerms()
  const mag = perms.can('admin.desk') || perms.can('expenses.approve')

  const [rijen, setRijen] = useState<BvRoute[]>([])
  const [fout, setFout] = useState('')
  const [bezig, setBezig] = useState(true)
  const [geheugenVan, setGeheugenVan] = useState<BvRoute | null>(null)

  const mensen = useLiveQuery(() => db.users.toArray(), [], [] as User[])
  const kandidaten = useMemo(() => mensen.filter(magBeoordelen), [mensen])

  const haal = useCallback(() => {
    setBezig(true)
    setFout('')
    bvRoutes()
      .then(setRijen)
      .catch((e) => setFout(e instanceof Error ? e.message : String(e)))
      .finally(() => setBezig(false))
  }, [])

  useEffect(() => { haal() }, [haal])

  async function zet(rij: BvRoute, wijziging: Partial<BvRoute>) {
    const nieuw = { ...rij, ...wijziging }
    /* Meteen in beeld; de server is de baas, maar wachten op een ronde voor
       een vinkje maakt het scherm traag zonder dat het iets waard is. */
    setRijen((oud) => oud.map((r) => (r.administratie === rij.administratie ? nieuw : r)))
    try {
      await bewaarBvRoute({
        administratie: nieuw.administratie,
        eerste: nieuw.eerste,
        tweede: nieuw.tweede,
        aiDirect: nieuw.aiDirect,
        vanafKeren: nieuw.vanafKeren,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan lukte niet.')
      haal()
    }
  }

  /*
   * En wat er nu al ligt.
   *
   * De routering pakt een factuur op het moment dat hij gelezen wordt. Wat er
   * vandaag in de rij staat is toen niet geroute-erd -- zonder deze knop zet
   * je hierboven een naam en merk je er een week lang niets van.
   */
  const [deelt, setDeelt] = useState(false)

  async function deelOpnieuw() {
    setDeelt(true)
    try {
      const uit = await facturenRouteren()
      toast.ok(
        uit.verplaatst === 0
          ? `${uit.bekeken} facturen nagelopen; er lag er al geen een verkeerd.`
          : `${uit.verplaatst} van de ${uit.bekeken} facturen liggen nu bij iemand anders.`
          + (uit.bijNiemand > 0 ? ` ${uit.bijNiemand} nog steeds bij niemand.` : ''),
      )
      haal()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opnieuw indelen lukte niet.')
    } finally {
      setDeelt(false)
    }
  }

  const zonderEerste = rijen.filter((r) => r.eerste.length === 0 && r.tweede.length === 0)

  return (
    <Card
      title="Wie een factuur krijgt"
      hint="Per onderneming: waar een onbekende factuur heen gaat, en of bekende leveranciers er direct heen mogen"
      className="mb"
      action={
        <div className="row" style={{ gap: 6 }}>
          {mag && (
            <button className="btn sm" onClick={deelOpnieuw} disabled={deelt}>
              <Play size={13} /> {deelt ? 'Bezig…' : 'Nu opnieuw indelen'}
            </button>
          )}
          <button className="btn ghost sm" onClick={haal} disabled={bezig}>
            <RefreshCw size={14} /> Opnieuw
          </button>
        </div>
      }
    >
      {fout ? (
        <Empty text={`De routes ophalen lukte niet: ${fout}`} icon={<TriangleAlert size={22} />} />
      ) : rijen.length === 0 ? (
        <Empty
          text={bezig
            ? 'Bezig met ophalen…'
            : 'Nog geen actieve ondernemingen. Haal ze op bij Exact.'}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Onderneming</th>
                  <th style={{ width: 250 }}>Eerste beoordeling</th>
                  <th style={{ width: 250 }}>Tweede handtekening</th>
                  <th style={{ width: 190 }}>Bekende leveranciers</th>
                  <th style={{ width: 90 }}>Wacht</th>
                </tr>
              </thead>
              <tbody>
                {rijen.map((r) => (
                  <tr key={r.administratie}>
                    <td>
                      {r.bvNaam}
                      <br />
                      <span className="ts-sub mono">{r.administratie}</span>
                    </td>

                    <td>
                      <Groep
                        ids={r.eerste}
                        namen={r.eersteNaam}
                        mag={mag}
                        kandidaten={kandidaten}
                        onZet={(ids, namen) => zet(r, { eerste: ids, eersteNaam: namen })}
                      />
                    </td>

                    <td>
                      <Groep
                        ids={r.tweede}
                        namen={r.tweedeNaam}
                        mag={mag}
                        kandidaten={kandidaten}
                        onZet={(ids, namen) => zet(r, { tweede: ids, tweedeNaam: namen })}
                      />
                    </td>

                    <td>
                      <label
                        className="row"
                        style={{ gap: 7, alignItems: 'center', cursor: mag ? 'pointer' : 'default' }}
                      >
                        <input
                          type="checkbox"
                          checked={r.aiDirect}
                          disabled={!mag}
                          onChange={(e) => zet(r, { aiDirect: e.target.checked })}
                        />
                        <span style={{ fontSize: '.84rem' }}>
                          direct doorzetten
                        </span>
                      </label>
                      <button
                        className="btn ghost sm"
                        style={{ marginTop: 4 }}
                        onClick={() => setGeheugenVan(r)}
                        disabled={r.onthouden === 0}
                      >
                        <Brain size={13} />{' '}
                        {r.onthouden === 0
                          ? 'nog niets onthouden'
                          : `${r.onthouden} onthouden`}
                      </button>
                    </td>

                    <td className="num">
                      {r.wachtend > 0
                        ? <Badge tone="warn">{r.wachtend}</Badge>
                        : <span className="ts-sub">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/*
            Wat er gebeurt als er niemand staat. Dit is geen foutmelding --
            het werkte zo tot nu toe -- maar het is wel precies het gat dat
            deze kaart moet dichten, en dat hoort er te staan.
          */}
          {zonderEerste.length > 0 && (
            <p className="help" style={{ marginTop: 10 }}>
              <TriangleAlert size={13} style={{ verticalAlign: -2 }} />{' '}
              {zonderEerste.length === 1
                ? 'Eén onderneming heeft'
                : `${zonderEerste.length} ondernemingen hebben`}{' '}
              nog niemand staan. Een factuur die we niet herkennen blijft daar
              bij de rol administratie liggen — zichtbaar voor iedereen, en
              daarmee van niemand.
            </p>
          )}

          <p className="help" style={{ marginTop: 10, color: 'var(--text-3)' }}>
            <UserCheck size={13} style={{ verticalAlign: -2 }} />{' '}
            Een inkoopadres met een eigen naam eraan gaat hier altijd voor:
            dat is een keuze van een mens. Daarna kijkt hij of deze leverancier
            hier al vaker is getekend, en pas als dat niet zo is gaat hij naar
            de eerste beoordelaar. Het management kan een factuur altijd bij
            iemand anders leggen; die keuze blijft dan staan.
          </p>
        </>
      )}

      {geheugenVan && (
        <Geheugen
          bv={geheugenVan}
          mensen={mensen}
          mag={mag}
          sluit={() => { setGeheugenVan(null); haal() }}
        />
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 *  Wat het geheugen van één bv weet
 *
 *  En vooral: hoe je het vergeet. Gaat iemand weg of wisselt een leverancier
 *  van afdeling, dan klopt wat hier staat niet meer -- en dan is wachten tot
 *  het zichzelf corrigeert precies de verkeerde kant op.
 * ------------------------------------------------------------------ */

function Geheugen({ bv, mensen, mag, sluit }: {
  bv: BvRoute
  mensen: User[]
  mag: boolean
  sluit: () => void
}) {
  const [rijen, setRijen] = useState<LeverancierRoute[]>([])
  const [bezig, setBezig] = useState(true)

  const naam = useMemo(() => new Map(mensen.map((u) => [u.id, u.name])), [mensen])

  const haal = useCallback(() => {
    setBezig(true)
    leverancierRoutes(bv.administratie)
      .then(setRijen)
      .catch(() => setRijen([]))
      .finally(() => setBezig(false))
  }, [bv.administratie])

  useEffect(() => { haal() }, [haal])

  async function vergeet(r: LeverancierRoute) {
    try {
      await vergeetRoute(r.administratie, r.leverancier)
      setRijen((oud) => oud.filter((x) => x.leverancier !== r.leverancier))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Vergeten lukte niet.')
    }
  }

  return (
    <Modal open title={`Wat we onthouden van ${bv.bvNaam}`} onClose={sluit} width={640}>
      <Field
        label="Vanaf hoeveel keer dit meetelt"
        help="Eén keer is een aanwijzing, drie keer is een gewoonte. Daaronder gaat een factuur naar de eerste beoordelaar."
      >
        <span className="mono">{bv.vanafKeren}</span>
      </Field>

      {bezig ? (
        <Empty text="Bezig met ophalen…" />
      ) : rijen.length === 0 ? (
        <Empty text="Nog niets onthouden voor deze onderneming." />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Leverancier</th>
                <th>Gaat naar</th>
                <th style={{ width: 70 }}>Keren</th>
                <th style={{ width: 120 }}>Laatst</th>
                {mag && <th style={{ width: 60 }} />}
              </tr>
            </thead>
            <tbody>
              {rijen.map((r) => (
                <tr key={r.leverancier}>
                  <td>{r.leverancier}</td>
                  <td>
                    {naam.get(r.goedkeurder) ?? r.goedkeurder}{' '}
                    {r.keren < bv.vanafKeren && (
                      <Badge>telt nog niet</Badge>
                    )}
                  </td>
                  <td className="num">{r.keren}</td>
                  <td style={{ color: 'var(--text-2)' }}>{relative(r.laatstAt)}</td>
                  {mag && (
                    <td>
                      <button
                        className="btn ghost sm"
                        title="Vergeten; de volgende factuur gaat weer naar de eerste beoordelaar"
                        onClick={() => vergeet(r)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="help" style={{ marginTop: 10 }}>
        Dit wordt geleerd van echte handtekeningen. Een factuur die vanzelf is
        goedgekeurd telt niet mee — een geheugen dat zijn eigen gokken
        onthoudt, bevestigt voortaan zijn eigen vergissingen.
      </p>
    </Modal>
  )
}
