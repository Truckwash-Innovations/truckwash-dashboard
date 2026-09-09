import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '../store/useAuth'

/* ==================================================================
   Het startscherm van elk dashboard
   ==================================================================

   Casper, hoofdstuk 12 en 13: "Het dashboard moet niet volstaan met
   willekeurige kaartjes. Het moet daadwerkelijk nuttig zijn ... Gebruik geen
   enorme verzameling cards. Elke component moet een duidelijke reden hebben.
   Prioriteit: 1. Wat moet ik doen? 2. Wat vraagt mijn aandacht? 3. Wat is
   nieuw?"

   Wat er stond
   ------------

   Een raster van grote tegels, allemaal even groot en even zwaar, elk met een
   cijfer erop. Bij het management zijn dat eenentwintig tegels. Dat is geen
   dashboard maar een tweede menu -- en het antwoord op "wat moet ik nu doen"
   moest je er zelf uit halen door alle cijfers langs te gaan.

   Erboven stond een aandachtsbalk met dezelfde dringende dingen nog een keer,
   die je kon wegklikken. Dat was een pleister op precies dit probleem: omdat
   alle tegels even zwaar waren, moest het dringende apart worden benoemd.

   Wat er nu staat
   ---------------

   Twee delen, en de scheiding is de hele verbetering:

     Op je bord   alles waar werk ligt, als een lijst met het aantal vooraan.
                  Een regel per ding, dringend eerst. Dit is het antwoord op
                  "wat moet ik doen".
     Verder       de rest, klein en grijs. Bereikbaar, maar het vraagt niets.

   De aandachtsbalk is daarmee weg, en dat is met opzet: hij zei hetzelfde als
   het eerste blok. Twee plekken die hetzelfde melden zijn niet twee keer zo
   duidelijk -- dan leest niemand meer welke de echte is. Er verdwijnt geen
   enkele tegel; ze staan alleen niet meer allemaal even hard te roepen.
   ================================================================== */

export type TegelTint =
  'brand' | 'ok' | 'warn' | 'danger' | 'info' | 'paars' | 'oranje' | 'neutraal'

export interface Tegel {
  key: string
  label: string
  hint: string
  icon: LucideIcon
  tint?: TegelTint
  /** Het cijfer dat op de tegel staat */
  stat?: ReactNode
  /** Waar dat cijfer over gaat, bijv. "wachten op akkoord" */
  statLabel?: string
  /** Zet de tegel op scherp: er is iets wat aandacht vraagt */
  urgent?: boolean
  onClick: () => void
}

/**
 * Ligt hier werk?
 *
 * `urgent` zet een dashboard zelf, en dat weegt het zwaarst. Daarnaast telt
 * een cijfer dat groter is dan nul: "4 bonnen wachten" is werk, "0 bonnen"
 * niet.
 *
 * Een cijfer kan ook tekst zijn (een bedrag, "3 van 5"). Dan valt er niets te
 * vergelijken en laten we het aan `urgent` -- liever iets in het rustige deel
 * dat er had mogen staan, dan een lijst "op je bord" waar dingen in staan die
 * niets vragen. Dat laatste maakt het eerste blok waardeloos.
 */
function heeftWerk(t: Tegel): boolean {
  if (t.urgent) return true
  if (typeof t.stat === 'number') return t.stat > 0
  return false
}

/* ------------------------------------------------------------------ *
 *  Eén regel op je bord
 * ------------------------------------------------------------------ */

function Werkregel({ tegel }: { tegel: Tegel }) {
  const Icon = tegel.icon
  return (
    <button
      className={`werkregel t-${tegel.tint ?? 'neutraal'}`}
      onClick={tegel.onClick}
    >
      <span className="ico"><Icon size={17} /></span>

      {/* Het aantal vooraan, want dat is waar je naar kijkt. Cijfers van
          gelijke breedte, zodat een kolom van tien regels uitlijnt. */}
      <span className="hoeveel">{tegel.stat ?? ''}</span>

      <span className="wat">
        <strong>{tegel.label}</strong>
        <span>{tegel.statLabel ?? tegel.hint}</span>
      </span>

      <span className="pijl"><ArrowRight size={15} /></span>
    </button>
  )
}

/* ------------------------------------------------------------------ *
 *  Eén ingang in het rustige deel
 * ------------------------------------------------------------------ */

function Ingang({ tegel }: { tegel: Tegel }) {
  const Icon = tegel.icon
  return (
    <button className="ingang" onClick={tegel.onClick} title={tegel.hint}>
      <Icon size={16} />
      <span className="naam">{tegel.label}</span>
      {tegel.stat !== undefined && <span className="cijfer">{tegel.stat}</span>}
    </button>
  )
}

/**
 * De tegels los, voor waar een dashboard ze zelf wil plaatsen.
 *
 * Blijft bestaan omdat er schermen zijn die hem los gebruiken. Hij tekent nu
 * hetzelfde als het rustige deel van Start: één rij per ingang in plaats van
 * een blok van 150 pixels hoog.
 */
export function Tegels({ items }: { items: Tegel[] }) {
  return (
    <div className="ingangen">
      {items.map((t) => <Ingang key={t.key} tegel={t} />)}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Startscherm
 * ------------------------------------------------------------------ */

export function Start({
  tegels, snel, children, onderschrift,
}: {
  tegels: Tegel[]
  /** Knoppen voor wat je meestal meteen wilt doen */
  snel?: ReactNode
  children?: ReactNode
  onderschrift?: string
}) {
  const user = useAuth((s) => s.user)
  const uur = new Date().getHours()
  const groet = uur < 6 ? 'Goedenacht' : uur < 12 ? 'Goedemorgen' : uur < 18 ? 'Goedemiddag' : 'Goedenavond'

  /*
   * Dringend bovenaan, en binnen die twee groepen de volgorde die het
   * dashboard zelf koos. Dat laatste is geen luiheid: die volgorde is daar
   * met een reden gezet, en hier alfabetisch of op aantal sorteren zou die
   * kennis weggooien.
   */
  const opBord = tegels.filter(heeftWerk)
    .sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent))
  const rest = tegels.filter((t) => !heeftWerk(t))

  return (
    <>
      <div className="start-kop">
        <div>
          <h1>{groet}, {user?.name.split(' ')[0]}</h1>
          <p>{onderschrift ?? 'Wash Your Truck – Professional Cleaning'}</p>
        </div>
        {snel && <div className="start-snel">{snel}</div>}
      </div>

      {opBord.length > 0 ? (
        <section className="sectie" style={{ marginBottom: 'var(--s5)' }}>
          <h2>Op je bord</h2>
          <div className="werklijst-regels">
            {opBord.map((t) => <Werkregel key={t.key} tegel={t} />)}
          </div>
        </section>
      ) : (
        /*
         * Niets te doen is informatie, en het is goed nieuws. Een leeg
         * dashboard zonder tekst laat iemand zoeken naar wat hij mist.
         */
        <p className="niets-te-doen">
          Er staat niets open. Dat is geen foutmelding.
        </p>
      )}

      {rest.length > 0 && (
        <section className="sectie">
          <h2>Verder</h2>
          <div className="ingangen">
            {rest.map((t) => <Ingang key={t.key} tegel={t} />)}
          </div>
        </section>
      )}

      {children}
    </>
  )
}
