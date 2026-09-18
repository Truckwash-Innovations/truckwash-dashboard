import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, ExternalLink, Loader2, TriangleAlert } from 'lucide-react'
import { db } from '../lib/db'
import { vraagCameratoegang } from '../lib/cameras'
import type { Location } from '../lib/types'
import { Card, Empty } from '../components/ui'
import { usePerms } from '../store/useNav'
import { toast } from '../store/useToasts'

/* ------------------------------------------------------------------ *
 *  De camera's
 *
 *  Tot nu toe had het camerportaal precies één gebruikersnaam en één
 *  wachtwoord. Dat moest dus rondgaan -- per app, per telefoon, per nieuwe
 *  collega -- en wie het had, zag elke camera van elke vestiging.
 *
 *  Hier vraag je een toegangsbriefje dat zegt wie je bent en waar je bij
 *  mag. Wat je te zien krijgt staat aan de serverkant vast (migratie 0118 en
 *  de functie camportal): wie niet overal mag komen, komt alleen bij de
 *  vestiging waar hij staat.
 *
 *  Waarom er een lijst met vestigingen op het scherm staat vóór je wegklikt:
 *  anders is "ik zie maar één vestiging" een storing in plaats van een
 *  afspraak.
 * ------------------------------------------------------------------ */

export default function Cameras() {
  const perms = usePerms()
  const [bezig, setBezig] = useState(false)

  const locaties = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])

  /* Wat er nog niet gekoppeld is. Zolang daar iets in staat, komt op die
     vestigingen niemand via het dashboard binnen -- en dat hoort te blijken
     uit een lijst, niet uit iemand die belt dat het niet werkt. */
  const zonderCamera = locaties.filter(
    (l) => l.active && l.kind === 'vestiging' && !l.cameraSiteId?.trim(),
  )
  const magKoppelen = perms.can('locations.manage')

  async function openen() {
    if (bezig) return
    setBezig(true)
    try {
      const uitkomst = await vraagCameratoegang()
      if (!uitkomst.ok || !uitkomst.url) {
        toast.error(uitkomst.reden ?? 'Het camerportaal is niet bereikbaar.')
        return
      }

      /*
       * Een nieuw tabblad, en niet dit venster. Het briefje is zestig
       * seconden geldig en werkt één keer; wie terugklikt zou anders op een
       * link staan die niet meer werkt en denken dat het stuk is.
       *
       * noopener: de pagina die opengaat hoort geen greep te hebben op het
       * venster waar het dashboard in draait.
       */
      window.open(uitkomst.url, '_blank', 'noopener,noreferrer')

      const waar = uitkomst.alles
        ? 'alle vestigingen'
        : (uitkomst.vestigingen ?? []).join(', ')
      toast.ok(waar ? `Geopend voor ${waar}` : 'Het camerportaal is geopend')
    } finally {
      setBezig(false)
    }
  }

  return (
    <>
      <Card className="mb">
        <div className="row tussen">
          <div>
            <h3 className="kop">Camerabeelden</h3>
            <p className="dim sm">
              Je komt binnen als jezelf, en je ziet de vestigingen waar je bij
              mag. Het gedeelde wachtwoord heb je hier niet voor nodig.
            </p>
          </div>
          <button className="btn" disabled={bezig} onClick={() => void openen()}>
            {bezig ? <Loader2 size={15} className="spin" /> : <ExternalLink size={15} />}
            {' '}Open het portaal
          </button>
        </div>
      </Card>

      {/* Alleen voor wie er iets aan kan doen. Voor de rest is het een lijst
          met dingen die hij niet kan oplossen. */}
      {magKoppelen && zonderCamera.length > 0 && (
        <Card className="mb">
          <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <TriangleAlert size={18} />
            <div>
              <h4 className="kop sm">Nog niet gekoppeld</h4>
              <p className="dim sm">
                Op deze vestigingen komt via het dashboard niemand binnen. Het
                nummer van de installatie staat in het camerportaal zelf; zet
                het bij de vestiging onder Vestigingen.
              </p>
              <ul className="dim sm">
                {zonderCamera.map((l) => <li key={l.id}>{l.name}</li>)}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {locaties.length === 0 && (
        <Empty
          icon={<Camera size={30} />}
          text="Er zijn nog geen vestigingen om camera's aan te koppelen."
        />
      )}
    </>
  )
}
