import { useEffect, useState } from 'react'
import {
  AlertTriangle, ExternalLink, FileQuestion, Loader2, Lock, RefreshCw,
} from 'lucide-react'
import type { Bekijkbaar } from '../../lib/bekijken'
import { Knop } from './pagina'

/* ==================================================================
   Het document, naast de gegevens
   ==================================================================

   Casper: "links: document / PDF-preview, rechts: administratieve gegevens
   ... Op grote schermen moet dit naast elkaar kunnen."

   Waarom dit het hart van de administratie is
   -------------------------------------------

   Wie een factuur controleert kijkt heen en weer: staat dit bedrag er ook zo
   op, is dit het juiste factuurnummer, klopt de leverancier. Tot nu toe stond
   de bon achter een knop die een schermvullende viewer opende BOVEN de
   velden. Dus: openen, lezen, onthouden, sluiten, intikken. Bij een bedrag
   van zes cijfers is dat precies het moment waarop er een cijfer omdraait.

   Naast elkaar hoeft er niets onthouden te worden. Dat is de hele winst, en
   het is geen kleine: het verschil tussen controleren en overtypen.

   Over de korte geldigheid van het adres
   --------------------------------------

   haal() geeft een ondertekend adres dat een minuut meegaat -- de emmer staat
   dicht, en dat hoort zo. Een paneel dat een uur openstaat heeft dus een dood
   adres. Vandaar de verversknop: die haalt een nieuw adres op in plaats van
   te doen alsof er niets aan de hand is.
   ================================================================== */

/** Wat we in een iframe durven te zetten. De rest gaat naar een nieuw venster. */
function soortVan(b: Bekijkbaar): 'pdf' | 'beeld' | 'anders' {
  const mime = (b.mime ?? '').toLowerCase()
  const naam = b.naam.toLowerCase()
  if (mime.includes('pdf') || naam.endsWith('.pdf')) return 'pdf'
  if (mime.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|avif)$/.test(naam)) return 'beeld'
  return 'anders'
}

export function Documentpaneel({
  bestanden, hoogte,
}: {
  bestanden: readonly Bekijkbaar[]
  /** Alleen zetten waar het paneel niet het hele scherm hoog mag zijn. */
  hoogte?: number | string
}) {
  const [welke, setWelke] = useState(0)
  const [adres, setAdres] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  /* Verandert bij elke verversing, zodat het effect opnieuw loopt. */
  const [ronde, setRonde] = useState(0)

  const bestand = bestanden[welke]

  /* Buiten de lijst gaan staan kan als er een bijlage bij komt of afvalt. */
  useEffect(() => {
    if (welke >= bestanden.length) setWelke(0)
  }, [welke, bestanden.length])

  useEffect(() => {
    if (!bestand || bestand.geblokkeerd) { setAdres(null); return }

    let weg = false
    setBezig(true)
    setFout(null)

    bestand.haal()
      .then((u) => { if (!weg) setAdres(u) })
      .catch((e: unknown) => {
        if (weg) return
        setFout(e instanceof Error ? e.message : 'Het bestand kon niet worden opgehaald.')
      })
      .finally(() => { if (!weg) setBezig(false) })

    /* Bij het wisselen van bestand hoort het oude adres weg: anders staat er
       een tel lang het vorige document onder de nieuwe naam, en dat is
       precies het soort verwarring waar een verkeerd bedrag uit komt. */
    return () => { weg = true }
  }, [bestand, ronde])

  if (!bestanden.length) {
    return (
      <div className="tweeluik-doc" style={hoogte ? { height: hoogte } : undefined}>
        <div className="blad leegdoc">
          <FileQuestion size={26} />
          <p>Bij deze kostenpost zit geen bijlage.</p>
        </div>
      </div>
    )
  }

  const soort = bestand ? soortVan(bestand) : 'anders'

  return (
    <div className="tweeluik-doc" style={hoogte ? { height: hoogte } : undefined}>
      <div className="balk">
        {/*
          Meer dan een bijlage: een mail met drie bonnen eraan hoort ze alle
          drie te laten zien. Als keuzelijst en niet als tabbladen -- bij vijf
          bijlagen met lange bestandsnamen is een rij tabbladen breder dan het
          paneel.
        */}
        {bestanden.length > 1 ? (
          <select
            value={welke}
            onChange={(e) => setWelke(Number(e.target.value))}
            aria-label="Welke bijlage"
            style={{
              maxWidth: 260,
              height: 'var(--knop-h-klein)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: 'var(--fs-meta)',
              fontFamily: 'inherit',
            }}
          >
            {bestanden.map((b, i) => (
              <option key={b.naam + i} value={i}>{b.naam}</option>
            ))}
          </select>
        ) : (
          <span className="naam" title={bestand?.naam}>{bestand?.naam}</span>
        )}

        <span style={{ flex: '1 1 auto' }} />

        {adres && (
          <>
            <Knop
              klein
              soort="bij"
              ikoon={<RefreshCw size={13} />}
              title="Opnieuw ophalen — een adres is een minuut geldig"
              aria-label="Opnieuw ophalen"
              onClick={() => setRonde((r) => r + 1)}
            />
            {/*
              Openen in een nieuw venster blijft bestaan. Niet als terugval
              maar omdat het iets anders is: in het paneel controleer je, in
              een eigen venster zoom je in op een regel die je niet kunt
              lezen. rel=noopener omdat het adres naar de opslag wijst.
            */}
            <a
              className="k klein bij"
              href={adres}
              target="_blank"
              rel="noopener noreferrer"
              title="In een nieuw venster openen"
            >
              <ExternalLink size={13} />
            </a>
          </>
        )}
      </div>

      <div className="blad">
        {bestand?.geblokkeerd ? (
          <div className="leegdoc">
            <Lock size={24} />
            <p>
              <strong>{bestand.geblokkeerdKop ?? 'Deze bijlage gaat niet open.'}</strong>
              <br />
              {bestand.geblokkeerd}
            </p>
          </div>
        ) : bezig ? (
          <div className="leegdoc">
            <Loader2 size={22} className="spin" />
            <p>Het document wordt opgehaald…</p>
          </div>
        ) : fout ? (
          <div className="leegdoc">
            <AlertTriangle size={24} />
            <p>
              <strong>Het document kon niet worden opgehaald.</strong><br />
              {fout}
            </p>
            <Knop soort="gewoon" klein onClick={() => setRonde((r) => r + 1)}>
              Opnieuw proberen
            </Knop>
          </div>
        ) : adres && soort === 'pdf' ? (
          /* #view=FitH laat de PDF op breedte beginnen. Zonder dat begint hij
             op honderd procent en zie je een kwart van de bon. */
          <iframe src={`${adres}#view=FitH`} title={bestand?.naam ?? 'Document'} />
        ) : adres && soort === 'beeld' ? (
          <img src={adres} alt={bestand?.naam ?? 'Bijlage'} />
        ) : (
          <div className="leegdoc">
            <FileQuestion size={24} />
            <p>
              Dit bestandstype kan hier niet worden getoond.
              {adres && ' Open het in een nieuw venster.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
