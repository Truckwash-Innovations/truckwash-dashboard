import { useMemo, useState } from 'react'
import { ArrowLeft, Bug, DoorOpen, MessageSquareText, Sparkles } from 'lucide-react'
import { Card, Knop, LeegStaat, Paginakop } from '../../components/ui'
import DevMelding from '../../components/DevMelding'
import Trucky from '../administratie/Trucky'
import Bibliotheek from './Bibliotheek'
import { VLEUGELS, ruimtesVoor, type Ruimte } from '../../lib/kantoor'
import { usePerms } from '../../store/useNav'
import { useAuth } from '../../store/useAuth'
import type { Role } from '../../lib/types'

/* ==================================================================
   Het virtuele kantoor
   ==================================================================

   Casper: "Ik wil een virtual office (...) Na het inloggen komt de gebruiker
   in een Virtuele Lobby terecht met interactieve ruimtes."

   Wat dit is, en wat het uitdrukkelijk niet is, staat in lib/kantoor.ts. Hier
   staat alleen hoe het eruitziet.

   Waarom het geen plattegrond met plaatjes is
   -------------------------------------------

   De verleiding bij "virtueel kantoor" is een tekening: gangen, deuren, een
   poppetje dat loopt. Dat is leuk om één keer te zien en daarna elke dag in
   de weg -- je klikt vier keer om ergens te komen waar het menu je in één
   klik brengt, en op een telefoon werkt het helemaal niet.

   Dus: ruimtes als kaarten, gegroepeerd per vleugel, in de volgorde waarin je
   ze zou tegenkomen. Het ruimtelijke zit in de INDELING en de woorden, niet
   in een plaatje. Daarmee is het op een telefoon precies even bruikbaar als
   op een groot scherm, en dat was een eis.

   Waarom de meeste deuren naar bestaande schermen gaan
   ----------------------------------------------------

   Omdat dit een tweede manier is om ergens te komen, geen tweede app. De
   administratie achter de deur "Administratie" is hetzelfde scherm als in het
   menu -- anders zijn er twee plekken waar facturen staan en raakt iemand er
   een kwijt.

   Twee ruimtes zijn wél van hier: de receptie en de bibliotheek.
   ================================================================== */

export default function Kantoor({ rol, onGa }: {
  /** De rol waarin deze persoon nu werkt; bepaalt welke deuren er zijn. */
  rol: Role
  /** Naar een scherm in dit dashboard. */
  onGa: (pagina: string) => void
}) {
  const perms = usePerms()
  const user = useAuth((s) => s.user)
  const [binnen, setBinnen] = useState<'receptie' | 'bibliotheek' | null>(null)

  const ruimtes = useMemo(
    () => ruimtesVoor(rol, (r) => perms.can(r)),
    [rol, perms])

  const perVleugel = useMemo(() => {
    const uit = new Map<Ruimte['vleugel'], Ruimte[]>()
    for (const r of ruimtes) {
      if (!uit.has(r.vleugel)) uit.set(r.vleugel, [])
      uit.get(r.vleugel)!.push(r)
    }
    return uit
  }, [ruimtes])

  /* --- binnen in een ruimte die van het kantoor zelf is --- */

  if (binnen === 'receptie') {
    return <Receptie terug={() => setBinnen(null)} rol={rol} />
  }
  if (binnen === 'bibliotheek') {
    return (
      <>
        <div className="kantoor-terug">
          <Knop soort="gewoon" onClick={() => setBinnen(null)}>
            <ArrowLeft size={14} /> Terug naar de lobby
          </Knop>
        </div>
        <Bibliotheek />
      </>
    )
  }

  /* --- de lobby --- */

  const uur = new Date().getHours()
  const groet = uur < 6 ? 'Goedenacht' : uur < 12 ? 'Goedemorgen'
    : uur < 18 ? 'Goedemiddag' : 'Goedenavond'
  const voornaam = (user?.name ?? '').split(' ')[0]

  return (
    <>
      <Paginakop
        titel="Het kantoor"
        uitleg="Dezelfde schermen, maar dan als plek. Handig als je weet wáár je moet zijn en niet hoe het heet."
      />

      <div className="lobby-onthaal">
        <div className="lobby-onthaal-tekst">
          <h2>{groet}{voornaam ? `, ${voornaam}` : ''}.</h2>
          <p>
            Je staat in de lobby. Hiernaast is de receptie — daar kun je iets
            vragen of melden. Verderop liggen de werkvloer en de kantoren, en
            achteraan staat de bibliotheek.
          </p>
        </div>
        <div className="lobby-onthaal-licht" aria-hidden="true" />
      </div>

      {ruimtes.length === 0 ? (
        <LeegStaat
          titel="Er is hier niets voor jou"
          uitleg="Je hebt geen rechten voor een van de ruimtes. Dat is geen storing — vraag het management als je ergens bij moet kunnen."
          ikoon={<DoorOpen size={20} />}
        />
      ) : (
        [...perVleugel.entries()].map(([vleugel, lijst]) => (
          <section key={vleugel} className="lobby-vleugel">
            <div className="lobby-vleugel-kop">
              <h3>{VLEUGELS[vleugel].naam}</h3>
              <p className="ts-sub">{VLEUGELS[vleugel].uitleg}</p>
            </div>

            <div className="lobby-deuren">
              {lijst.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className="lobby-deur"
                  onClick={() => {
                    if (r.heen === 'receptie') setBinnen('receptie')
                    else if (r.heen === 'bibliotheek') setBinnen('bibliotheek')
                    else onGa(r.heen)
                  }}
                >
                  <span className="lobby-deur-kier" aria-hidden="true" />
                  <span className="lobby-deur-ikoon"><r.icoon size={20} /></span>
                  <span className="lobby-deur-tekst">
                    <strong>{r.naam}</strong>
                    <span className="ts-sub">{r.wat}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  De receptie
 *
 *  Casper: "de receptie, waar je kan praten met trucky (of een melding kan
 *  maken)".
 *
 *  Allebei op één plek, want het is dezelfde beweging: er is iets wat je niet
 *  weet of wat niet klopt, en je wilt er iemand over spreken. Welke van de
 *  twee het wordt, hangt af van het antwoord -- en dat weet je vooraf niet.
 * ------------------------------------------------------------------ */

function Receptie({ terug, rol }: { terug: () => void; rol: Role }) {
  const [melden, setMelden] = useState(false)

  return (
    <>
      <div className="kantoor-terug">
        <Knop soort="gewoon" onClick={terug}>
          <ArrowLeft size={14} /> Terug naar de lobby
        </Knop>
      </div>

      <Paginakop
        titel="Receptie"
        uitleg="Vraag het aan Trucky, of meld iets dat niet klopt."
      />

      <div className="receptie">
        <Card
          title="Iets vragen"
          hint="Trucky kent de app, de vestigingen en de afspraken"
          className="mb"
        >
          <p className="help" style={{ marginTop: 0 }}>
            <Sparkles size={14} style={{ verticalAlign: -2 }} /> Vraag gerust in
            gewone taal. Weet hij het niet, dan zegt hij dat — hij verzint niets.
          </p>
          <Trucky />
        </Card>

        <Card
          title="Iets melden"
          hint="Werkt er iets niet, of klopt er iets niet?"
        >
          <p className="help" style={{ marginTop: 0 }}>
            Een melding komt rechtstreeks bij de ontwikkelaar terecht, met erbij
            waar je was toen het gebeurde. Schrijf op wat je deed en wat je
            verwachtte — dat scheelt een keer heen en weer.
          </p>
          <div className="row" style={{ gap: 8, marginTop: 'var(--s3)' }}>
            <Knop soort="hoofd" onClick={() => setMelden(true)}>
              <Bug size={14} /> Melding maken
            </Knop>
            <Knop soort="gewoon" onClick={() => setMelden(true)}>
              <MessageSquareText size={14} /> Mijn meldingen
            </Knop>
          </div>
        </Card>
      </div>

      <DevMelding
        open={melden}
        onClose={() => setMelden(false)}
        fromRole={rol}
        fromPage="kantoor"
      />
    </>
  )
}
