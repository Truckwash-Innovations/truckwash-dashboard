import {
  type ReactNode, useEffect, useMemo, useRef, useState,
} from 'react'
import { ChevronDown, ChevronUp, Inbox, SearchX, X } from 'lucide-react'

/* ==================================================================
   De administratietabel
   ==================================================================

   Casper: "sticky header, hover state, klikbare rij, duidelijke kolommen,
   sortering, filters, pagination of virtual scrolling indien nodig, bulk
   selection, bulk actions."

   Waarom dit een component is en geen stuk opmaak
   ----------------------------------------------

   Gemeten voordat dit bestand er was: negentien schermen met een eigen
   <table>, waarvan er twee konden sorteren, geen enkele bulkselectie had, en
   elf hun bedragen links uitlijnden. Dat is geen slordigheid van negentien
   mensen -- er was niets om te gebruiken, dus bouwde iedereen het na, en
   niemand bouwde het twee keer hetzelfde.

   Hier staat het een keer. Wat een scherm nog zelf bepaalt is WAT er in de
   kolommen staat; hoe een tabel zich gedraagt is geen keuze meer.

   Wat er met opzet NIET in zit
   ----------------------------

   Paginering. Bij deze hoeveelheden (de grootste lijst is een paar duizend
   kostenposten) is een pagineerbalk drie klikken extra voor iets wat
   scrollen ook doet, en hij breekt Ctrl+F. Wordt het ooit tienduizenden,
   dan hoort daar virtualisatie -- en niet een balk met paginanummers.
   ================================================================== */

export interface Kolom<T> {
  /** Vaste sleutel, ook gebruikt om de sortering te onthouden. */
  sleutel: string
  kop: string
  /** Wat er in de cel komt. */
  toon: (rij: T) => ReactNode
  /**
   * Rechts uitgelijnd met cijfers van gelijke breedte. Voor bedragen en
   * aantallen: "bedragen rechts uitlijnen" (hoofdstuk 45).
   */
  getal?: boolean
  /** Secundaire informatie, subtieler getoond. */
  zacht?: boolean
  /**
   * Hoe er op deze kolom gesorteerd wordt. Geen functie betekent: op deze
   * kolom valt niet te sorteren, en dan staat er ook geen pijl.
   */
  sorteer?: (a: T, b: T) => number
  /**
   * Onder deze schermbreedte verdwijnt de kolom. "Op kleinere schermen
   * moeten kolommen logisch verdwijnen of herschikken" -- welke dat zijn
   * weet het scherm zelf, niet de tabel.
   */
  wegOnder?: number
  /** Vaste breedte in pixels, als de kolom niet mag meegroeien. */
  breedte?: number
}

export interface Bulkactie {
  label: string
  ikoon?: ReactNode
  /** 'hoofd' voor de belangrijkste, 'gevaar' voor wat iets weggooit. */
  soort?: 'hoofd' | 'gewoon' | 'gevaar'
  doe: (ids: string[]) => void
}

interface Props<T> {
  rijen: readonly T[]
  kolommen: readonly Kolom<T>[]
  sleutelVan: (rij: T) => string
  /** Klikken op de rij. Zonder dit is de rij niet klikbaar. */
  opRij?: (rij: T) => void
  /** Welke rij nu open staat, zodat je hem terugvindt na het sluiten. */
  actief?: string
  /** Aanzetten voor selectie. Zonder deze twee is er geen kieskolom. */
  gekozen?: ReadonlySet<string>
  setGekozen?: (ids: Set<string>) => void
  bulk?: readonly Bulkactie[]
  /** De kolom waarop standaard gesorteerd wordt, en de richting. */
  sorteerOp?: string
  omgekeerd?: boolean
  /** Laadt nog: dan een skelet in de vorm van de tabel. */
  laden?: boolean
  /** Staat er niets, dan dit. Zie LeegStaat hieronder. */
  leeg?: ReactNode
  /** Rijen tellen mee in "3 geselecteerd" maar zijn niet te kiezen. */
  nietTeKiezen?: (rij: T) => boolean
}

export function Tabel<T>({
  rijen, kolommen, sleutelVan, opRij, actief,
  gekozen, setGekozen, bulk, sorteerOp, omgekeerd,
  laden, leeg, nietTeKiezen,
}: Props<T>) {
  const [sorteer, setSorteer] = useState<{ sleutel: string; om: boolean }>(
    () => ({ sleutel: sorteerOp ?? '', om: omgekeerd ?? false }))

  /* Welke kolommen passen. Een resize-luisteraar en geen CSS-klasse, omdat
     een <td> die met display:none verdwijnt de kolombreedtes van de rest
     scheeftrekt -- dan verspringt de hele tabel bij het slepen van het
     venster. */
  const [breed, setBreed] = useState(() =>
    typeof window === 'undefined' ? 1600 : window.innerWidth)
  useEffect(() => {
    const meet = () => setBreed(window.innerWidth)
    window.addEventListener('resize', meet)
    return () => window.removeEventListener('resize', meet)
  }, [])

  const zichtbaar = useMemo(
    () => kolommen.filter((k) => !k.wegOnder || breed >= k.wegOnder),
    [kolommen, breed])

  const gesorteerd = useMemo(() => {
    const k = kolommen.find((c) => c.sleutel === sorteer.sleutel)
    if (!k?.sorteer) return rijen
    /* Een kopie: sorteren op de doorgegeven array zou de lijst van de
       aanroeper omgooien, en dan verandert er iets buiten dit component
       zonder dat daar iets is aangeroepen. */
    const uit = [...rijen].sort(k.sorteer)
    return sorteer.om ? uit.reverse() : uit
  }, [rijen, kolommen, sorteer])

  const kiesbaar = useMemo(
    () => gesorteerd.filter((r) => !nietTeKiezen?.(r)).map(sleutelVan),
    [gesorteerd, nietTeKiezen, sleutelVan])

  const kiezenAan = !!gekozen && !!setGekozen
  const aantalGekozen = gekozen ? kiesbaar.filter((id) => gekozen.has(id)).length : 0
  const allesGekozen = kiesbaar.length > 0 && aantalGekozen === kiesbaar.length

  /*
   * Het derde vinkje: half.
   *
   * Een kop-vinkje kent drie standen en HTML kent er twee, dus het
   * middelste moet in JavaScript. Zonder dit staat de kop leeg zodra er één
   * rij niet gekozen is, en dan lijkt het of er niets gekozen is terwijl er
   * negenennegentig regels aan staan.
   */
  const kopVink = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (kopVink.current) {
      kopVink.current.indeterminate = aantalGekozen > 0 && !allesGekozen
    }
  }, [aantalGekozen, allesGekozen])

  function kiesAlles(aan: boolean) {
    if (!setGekozen) return
    setGekozen(aan ? new Set(kiesbaar) : new Set())
  }

  function wissel(id: string) {
    if (!gekozen || !setGekozen) return
    const uit = new Set(gekozen)
    if (uit.has(id)) uit.delete(id)
    else uit.add(id)
    setGekozen(uit)
  }

  function kopKlik(k: Kolom<T>) {
    if (!k.sorteer) return
    setSorteer((s) =>
      s.sleutel === k.sleutel ? { sleutel: k.sleutel, om: !s.om } : { sleutel: k.sleutel, om: false })
  }

  /* ---------------------------------------------------------------- *
   *  Laden
   * ---------------------------------------------------------------- */

  if (laden) {
    return (
      <div className="tabelraam" aria-busy="true" aria-live="polite">
        <div className="tabelschuif">
          <table className="tabel">
            <thead>
              <tr>
                {kiezenAan && <th className="kiescel" />}
                {zichtbaar.map((k) => (
                  <th key={k.sleutel} className={k.getal ? 'getal' : undefined}>{k.kop}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Acht regels: genoeg om de vorm te laten zien, niet zoveel
                  dat het scherm vol grijs staat als er straks drie rijen
                  blijken te zijn. */}
              {Array.from({ length: 8 }, (_, i) => (
                <tr key={i}>
                  {kiezenAan && <td className="kiescel"><div className="skelet skelet-regel" style={{ width: 14 }} /></td>}
                  {zichtbaar.map((k, n) => (
                    <td key={k.sleutel}>
                      <div
                        className="skelet skelet-regel"
                        style={{ width: `${[70, 55, 85, 45, 60][(i + n) % 5]}%` }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="sr-only">De lijst wordt geladen…</span>
      </div>
    )
  }

  /* ---------------------------------------------------------------- *
   *  Leeg
   * ---------------------------------------------------------------- */

  if (!gesorteerd.length) {
    return <div className="tabelraam">{leeg ?? <LeegStaat titel="Niets gevonden" />}</div>
  }

  /* ---------------------------------------------------------------- *
   *  De tabel
   * ---------------------------------------------------------------- */

  return (
    <>
      {kiezenAan && aantalGekozen > 0 && (
        <div className="bulkbalk" role="region" aria-label="Wat je met de gekozen regels kunt doen">
          <span className="hoeveel">
            {aantalGekozen} geselecteerd
          </span>
          <span className="rek" />
          {(bulk ?? []).map((a) => (
            <button
              key={a.label}
              className={`k klein ${a.soort ?? 'gewoon'}`}
              onClick={() => a.doe(kiesbaar.filter((id) => gekozen!.has(id)))}
            >
              {a.ikoon}
              {a.label}
            </button>
          ))}
          <button className="k klein bij" onClick={() => kiesAlles(false)}>
            <X size={14} /> Selectie wissen
          </button>
        </div>
      )}

      <div className="tabelraam">
        <div className="tabelschuif">
          <table className="tabel">
            <thead>
              <tr>
                {kiezenAan && (
                  <th className="kiescel">
                    <input
                      ref={kopVink}
                      type="checkbox"
                      checked={allesGekozen}
                      onChange={(e) => kiesAlles(e.target.checked)}
                      aria-label={allesGekozen ? 'Niets kiezen' : 'Alles kiezen'}
                    />
                  </th>
                )}
                {zichtbaar.map((k) => {
                  const aan = sorteer.sleutel === k.sleutel
                  return (
                    <th
                      key={k.sleutel}
                      className={[
                        k.getal ? 'getal' : '',
                        k.sorteer ? 'sorteerbaar' : '',
                      ].filter(Boolean).join(' ') || undefined}
                      style={k.breedte ? { width: k.breedte } : undefined}
                      onClick={() => kopKlik(k)}
                      /* Sorteren hoort ook met het toetsenbord te kunnen.
                         Een <th> is geen knop, dus expliciet. */
                      tabIndex={k.sorteer ? 0 : undefined}
                      role={k.sorteer ? 'button' : undefined}
                      onKeyDown={(e) => {
                        if (!k.sorteer) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          kopKlik(k)
                        }
                      }}
                      aria-sort={aan ? (sorteer.om ? 'descending' : 'ascending') : undefined}
                    >
                      {k.kop}
                      {aan && (
                        <span className="pijl" aria-hidden="true">
                          {sorteer.om ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                        </span>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {gesorteerd.map((rij) => {
                const id = sleutelVan(rij)
                const isGekozen = !!gekozen?.has(id)
                return (
                  <tr
                    key={id}
                    className={[
                      opRij ? 'klikbaar' : '',
                      isGekozen || actief === id ? 'gekozen' : '',
                    ].filter(Boolean).join(' ') || undefined}
                    onClick={opRij ? () => opRij(rij) : undefined}
                    /* De hele rij is klikbaar, dus hij hoort ook met Tab
                       bereikbaar te zijn en op Enter te openen. */
                    tabIndex={opRij ? 0 : undefined}
                    onKeyDown={opRij ? (e) => {
                      if (e.key === 'Enter') { e.preventDefault(); opRij(rij) }
                    } : undefined}
                    aria-current={actief === id ? 'true' : undefined}
                  >
                    {kiezenAan && (
                      <td
                        className="kiescel"
                        /* Kiezen mag de rij niet openen. Zonder dit klapt bij
                           elk vinkje het detailvenster open, en dan is een
                           stapel aanvinken onmogelijk. */
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isGekozen}
                          disabled={nietTeKiezen?.(rij)}
                          onChange={() => wissel(id)}
                          aria-label={`Regel ${id} kiezen`}
                        />
                      </td>
                    )}
                    {zichtbaar.map((k) => (
                      <td
                        key={k.sleutel}
                        className={[k.getal ? 'getal' : '', k.zacht ? 'zacht' : '']
                          .filter(Boolean).join(' ') || undefined}
                      >
                        {k.toon(rij)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

/* ==================================================================
   De lege staat
   ==================================================================

   Casper: "Als een overzicht leeg is, toon geen kale lege pagina."

   Het onderscheid dat er werkelijk toe doet zit in de knop: leeg omdat er
   niets is, of leeg omdat de filters te streng staan. In het tweede geval
   hoort er een knop te staan die ze wist -- anders concludeert iemand dat er
   geen facturen zijn terwijl er tweehonderd liggen die hij zelf heeft
   weggefilterd.
   ================================================================== */

export function LeegStaat({
  titel, uitleg, ikoon, actie, gefilterd,
}: {
  titel: string
  uitleg?: string
  ikoon?: ReactNode
  actie?: ReactNode
  /** Staat er niets door de filters? Dan een ander icoon en een andere toon. */
  gefilterd?: boolean
}) {
  return (
    <div className="leegstaat">
      <div className="ikoon" aria-hidden="true">
        {ikoon ?? (gefilterd ? <SearchX size={20} /> : <Inbox size={20} />)}
      </div>
      <h3>{titel}</h3>
      {uitleg && <p>{uitleg}</p>}
      {actie}
    </div>
  )
}
