/* ===========================================================================
 *  Inkoop -- waar facturen binnenkomen en hoe ze zichzelf indelen
 *
 *  Drie dingen op één scherm, want ze horen bij elkaar en je stelt ze in
 *  dezelfde tien minuten in:
 *
 *    1. de adressen    inkoop.<vestiging>@<domein>, per vestiging
 *    2. het grootboek  waar een factuur op geboekt wordt
 *    3. de tags        waar hij daarnaast op te filteren is
 *
 *  Waarom hier en niet bij de administratie: dit is instelwerk dat één keer
 *  goed moet staan en daarna met rust gelaten wordt. Het dagelijkse werk --
 *  nakijken en goedkeuren -- staat bij Kostenposten.
 *
 *  Het domein is met opzet geen vaste waarde in de code. Er staat nu een
 *  voorlopig domein, en zodra dat verhuist zou anders de hele factuurstroom
 *  stilvallen tot er iemand een nieuwe versie uitbrengt.
 * =========================================================================== */

import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Check, Copy, Loader2, Mail, Plus, Save, Send, Tag, TriangleAlert, Wallet, X,
} from 'lucide-react'
import { db } from '../lib/db'
import { enqueue } from '../lib/sync'
import {
  SLEUTELS, domeinProbleem, inkoopAdres, leesInstellingen, voorvoegselProbleem,
  zetInstelling,
} from '../lib/instellingen'
import { relative } from '../lib/format'
import {
  TESTFACTUREN, stuurTestfactuur, type Testfactuur,
} from '../lib/testfacturen'
import type { ExactGrootboek, Grootboek, Instelling, KostenTag, Location } from '../lib/types'
import { Badge, Card, Empty, Field, Kiezer, Modal } from '../components/ui'
import { rekeningenVan } from '../lib/boeking'
import { exactFacturenStand, type ExactAdministratie } from '../lib/trucksupply'
import { toast } from '../store/useToasts'

/*
 * De drie standen van de factuurlezer (instelling factuur_lezer, 0049). De
 * waarde is wat de post en de functie lezer op de server vergelijken; de
 * tekst is wat Casper leest. Wie hier een stand toevoegt, moet hem ook in
 * ontvang-mail en lezer kennen.
 */
type Lezer = 'claude' | 'lokaal' | 'lokaal-terugval'

const LEZERS: { waarde: Lezer; naam: string; uitleg: string }[] = [
  {
    waarde: 'claude',
    naam: 'Claude (Sonnet 5, in de cloud)',
    uitleg: 'Leest ook foto’s van gekreukte bonnen goed; kost een paar cent per factuur en de factuur gaat naar Anthropic.',
  },
  {
    waarde: 'lokaal',
    naam: 'Lokaal (Ollama op de eigen server)',
    uitleg: 'Gratis per factuur en de factuur verlaat het pand niet. Staat de server uit, dan blijven de bonnen wachten tot hij weer draait.',
  },
  {
    waarde: 'lokaal-terugval',
    naam: 'Lokaal, met Claude als terugval',
    uitleg: 'De veilige middenweg: lokaal lezen, en alleen als het lokale model twijfelt of uitvalt gaat de factuur alsnog naar Claude.',
  },
]

/** Langer dan dit niets gehoord van het lokale programma terwijl het zou moeten draaien: rood. */
const LEZER_STIL_NA_MS = 5 * 60_000

/*
 * Rode hulptekst. De stylesheet kent .btn.danger en .badge.danger, maar geen
 * .help.danger: een span met die klasse kreeg het driehoekje wel en de kleur
 * niet (viel op bij de statusregel van de lezer, maar de foutregels onder de
 * velden hadden hetzelfde). Tot er een regel in theme.css staat, zetten we de
 * kleur hier inline; het token bestaat voor licht en donker.
 */
const ROOD = { color: 'var(--text-danger)' } as const

export default function Inkoop({ rekeningen = true, adressen = true }: {
  /*
   * Of de kaart met grootboekrekeningen meekomt.
   *
   * Casper: "Kan je dan die grootboekrekeningen in boekhouding niet weghalen
   * dan ook?" Op het administratiescherm heeft die lijst geen werk meer: de
   * rekeningen bij een factuur komen van Exact zelf, en sinds 0093 deelt de
   * post ook in zonder dat er iets is overgenomen.
   *
   * Bij Ontwikkeling blijft hij staan, want de trefwoorden eronder doen nog
   * wél iets -- daarop raadt de post de indeling van een nieuwe factuur.
   */
  rekeningen?: boolean
  /*
   * En of de berekende adressenlijst meekomt.
   *
   * Op het administratiescherm staat sinds 0095 een eigen kaart: adressen per
   * ONDERNEMING, met een vestiging en een goedkeurder eraan. De lijst hier
   * rekent ze nog uit uit de website-slug van een vestiging -- dat is wat er
   * was, en het is nuttig om te zien welke adressen er van oudsher lopen,
   * maar twee lijsten met adressen op één scherm is er één te veel.
   */
  adressen?: boolean
} = {}) {
  return (
    <>
      {adressen && <Adressen />}
      <Proeffacturen />
      {rekeningen && <Rekeningen />}
      <Etiketten />
    </>
  )
}

/* ================================================================== *
 *  1. De adressen
 * ================================================================== */

function Adressen() {
  const vestigingen = useLiveQuery(
    () => db.locations.toArray(), [], [] as Location[])

  const [domein, setDomein] = useState('')
  const [voorvoegsel, setVoorvoegsel] = useState('inkoop')
  const [automatisch, setAutomatisch] = useState(true)
  const [lezer, setLezer] = useState<Lezer>('claude')
  const [autoAan, setAutoAan] = useState(false)
  const [autoVanaf, setAutoVanaf] = useState('3')
  const [autoMarge, setAutoMarge] = useState('2')
  const [autoMax, setAutoMax] = useState('500')
  const [eigenKvk, setEigenKvk] = useState('')
  const [eigenBtw, setEigenBtw] = useState('')
  const [eigenIban, setEigenIban] = useState('')
  const [geladen, setGeladen] = useState(false)
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    let levend = true
    leesInstellingen().then((alle) => {
      if (!levend) return
      setDomein(alle[SLEUTELS.inkoopDomein] ?? '')
      setVoorvoegsel(alle[SLEUTELS.inkoopVoorvoegsel] || 'inkoop')
      setAutomatisch((alle[SLEUTELS.factuurAutomatisch] || 'ja') !== 'nee')
      /*
       * Een onbekende waarde -- een typefout in de SQL-editor -- wordt hier
       * 'claude', net zoals de post hem leest. Anders zou het scherm een stand
       * tonen die de server niet kent.
       */
      const gekozen = alle[SLEUTELS.factuurLezer]
      setLezer(LEZERS.some((l) => l.waarde === gekozen) ? gekozen as Lezer : 'claude')
      setAutoAan((alle[SLEUTELS.autoGoedkeuren] || 'nee') === 'ja')
      setAutoVanaf(alle[SLEUTELS.autoGoedkeurenVanaf] || '3')
      setAutoMarge(alle[SLEUTELS.autoGoedkeurenMarge] || '2')
      setAutoMax(alle[SLEUTELS.autoGoedkeurenMax] || '500')
      setEigenKvk(alle[SLEUTELS.eigenKvk] ?? '')
      setEigenBtw(alle[SLEUTELS.eigenBtw] ?? '')
      setEigenIban(alle[SLEUTELS.eigenIban] ?? '')
      setGeladen(true)
    })
    return () => { levend = false }
  }, [])

  const foutDomein = geladen ? domeinProbleem(domein) : null
  const foutVoorvoegsel = geladen ? voorvoegselProbleem(voorvoegsel) : null

  async function bewaar() {
    if (foutDomein || foutVoorvoegsel) return
    setBezig(true)
    try {
      await zetInstelling(SLEUTELS.inkoopDomein, domein.trim().toLowerCase())
      await zetInstelling(SLEUTELS.inkoopVoorvoegsel, voorvoegsel.trim().toLowerCase())
      await zetInstelling(SLEUTELS.factuurAutomatisch, automatisch ? 'ja' : 'nee')
      await zetInstelling(SLEUTELS.factuurLezer, lezer)
      await zetInstelling(SLEUTELS.eigenKvk, eigenKvk.trim())
      await zetInstelling(SLEUTELS.eigenBtw, eigenBtw.trim().toUpperCase())
      await zetInstelling(SLEUTELS.eigenIban, eigenIban.trim().toUpperCase())
      await zetInstelling(SLEUTELS.autoGoedkeuren, autoAan ? 'ja' : 'nee')
      await zetInstelling(SLEUTELS.autoGoedkeurenVanaf, String(Math.max(2, Number(autoVanaf) || 3)))
      await zetInstelling(SLEUTELS.autoGoedkeurenMarge, String(Math.min(25, Math.max(0, Number(autoMarge) || 0))))
      await zetInstelling(SLEUTELS.autoGoedkeurenMax, String(Math.max(0, Number(autoMax) || 0)))
      toast.ok('Opgeslagen. Nieuwe post komt hier binnen.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukte.')
    } finally {
      setBezig(false)
    }
  }

  /*
   * Alleen vestigingen met een website-adres. Dat is niet willekeurig: die
   * slug is wat ontvang-mail terugzoekt als er post op inkoop.<iets>@
   * binnenkomt. Een vestiging zonder slug heeft dus geen werkend adres, en
   * dat hoort hier te staan in plaats van een adres te tonen dat nergens
   * aankomt.
   */
  const actief = vestigingen.filter((l) => l.active !== false)
  /* Alleen nog wie er GEEN heeft: dat is het enige dat hier nog iets te
     melden valt. De adressen zelf staan bij de administratie. */
  const zonderSlug = actief.filter((l) => !l.websiteSlug)

  return (
    <Card
      title="Waar facturen binnenkomen"
      hint="Per vestiging een eigen adres, zodat een bon vanzelf op de goede plek staat"
      className="mb"
    >
      <div className="grid cols-2 mb">
        <Field label="Domein" help="Alleen het domein, dus zonder het stuk voor de @.">
          <input
            className="input"
            value={domein}
            onChange={(e) => setDomein(e.target.value)}
            placeholder="preview.truckwash.cloud"
            spellCheck={false}
          />
          {foutDomein && <span className="help danger" style={ROOD}>{foutDomein}</span>}
        </Field>

        <Field label="Voorvoegsel" help="Het stuk voor de punt: inkoop.oss@…">
          <input
            className="input"
            value={voorvoegsel}
            onChange={(e) => setVoorvoegsel(e.target.value)}
            placeholder="inkoop"
            spellCheck={false}
          />
          {foutVoorvoegsel && <span className="help danger" style={ROOD}>{foutVoorvoegsel}</span>}
        </Field>
      </div>

      <label className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={automatisch}
          onChange={(e) => setAutomatisch(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <strong>Facturen automatisch uitlezen en indelen</strong>
          <br />
          <span className="help">
            Staat dit uit, dan komt een bon nog steeds binnen — alleen met een
            leeg bedrag, zoals vroeger. Je leest hem dan zelf uit bij de
            kostenpost.
          </span>
        </span>
      </label>

      {/* ---- wie leest ---- */}

      <h4 style={{ marginTop: 20, marginBottom: 4 }}>Wie leest de facturen</h4>
      <p className="help" style={{ marginBottom: 10 }}>
        Alleen het lezen verschilt; wat er daarna gebeurt — opschonen,
        verkoopcontrole, indelen, boeken — doet de server in alle drie de
        standen op dezelfde manier. Werkt alleen als het vinkje hierboven aanstaat.
      </p>
      <div className="grid" style={{ gap: 8 }}>
        {LEZERS.map((l) => (
          <label
            key={l.waarde}
            className="row"
            style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}
          >
            <input
              type="radio"
              name="factuur-lezer"
              value={l.waarde}
              checked={lezer === l.waarde}
              onChange={() => setLezer(l.waarde)}
              disabled={!automatisch}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>{l.naam}</strong>
              <br />
              <span className="help">{l.uitleg}</span>
            </span>
          </label>
        ))}
      </div>
      {/* Zonder het vinkje leest niemand en wacht er dus ook niets: dan geen rode regel. */}
      <LezerStatus lokaalGekozen={automatisch && lezer !== 'claude'} />

      {/* ---- zichzelf goedkeuren ---- */}

      <h4 style={{ marginTop: 24, marginBottom: 4 }}>Zichzelf goedkeuren</h4>
      <p className="help" style={{ marginBottom: 10 }}>
        Is dezelfde leverancier al een paar keer <strong>door een mens</strong> voor
        ongeveer hetzelfde bedrag goedgekeurd, dan mag de volgende factuur vanzelf
        door. Wat het systeem zelf goedkeurde telt daarbij niet mee — anders
        bevestigt het na verloop van tijd zijn eigen vergissingen. Een factuur met
        twijfel, een geraden grootboekrekening of een factuurnummer dat al bestaat
        gaat nooit vanzelf door.
      </p>

      <label className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={autoAan}
          onChange={(e) => setAutoAan(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <strong>Facturen mogen zichzelf goedkeuren</strong>
          <br />
          <span className="help">
            Hier gaat geld weg zonder dat iemand keek. Zet dit pas aan als je een
            paar maanden hebt gezien dat de lezer klopt; je krijgt van elke
            automatische goedkeuring een melding, en afkeuren kan altijd nog.
          </span>
        </span>
      </label>

      {autoAan && (
        <div className="grid cols-3" style={{ marginTop: 12 }}>
          <Field label="Vanaf hoeveel keer" help="Minimaal 2. Standaard 3.">
            <input
              className="input"
              type="number"
              min={2}
              value={autoVanaf}
              onChange={(e) => setAutoVanaf(e.target.value)}
            />
          </Field>
          <Field label="Marge op het bedrag (%)" help="Hoeveel het mag afwijken van wat gebruikelijk is.">
            <input
              className="input"
              type="number"
              min={0}
              max={25}
              value={autoMarge}
              onChange={(e) => setAutoMarge(e.target.value)}
            />
          </Field>
          <Field label="Plafond (€ excl. btw)" help="Hierboven kijkt altijd iemand mee.">
            <input
              className="input"
              type="number"
              min={0}
              value={autoMax}
              onChange={(e) => setAutoMax(e.target.value)}
            />
          </Field>
        </div>
      )}

      {/* ---- de eigen nummers ---- */}

      <h4 style={{ marginTop: 20, marginBottom: 4 }}>Onze eigen nummers</h4>
      <p className="help" style={{ marginBottom: 10 }}>
        Een factuur die Truckwash zélf stuurde en die iemand doorstuurt naar een
        inkoopadres, mag geen kostenpost worden. De lezer herkent dat aan wie
        bovenaan staat, maar haalt de kostenpost pas weg als één van deze
        nummers ook echt op het stuk staat. Leeg betekent: nooit weghalen, de
        bon blijft dan staan met de twijfel erop. Meerdere nummers mag, met een
        komma ertussen.
      </p>
      <div className="grid cols-3 mb">
        <Field label="KvK-nummer">
          <input
            className="input"
            value={eigenKvk}
            onChange={(e) => setEigenKvk(e.target.value)}
            placeholder="12345678"
            spellCheck={false}
          />
        </Field>
        <Field label="Btw-nummer">
          <input
            className="input"
            value={eigenBtw}
            onChange={(e) => setEigenBtw(e.target.value)}
            placeholder="NL123456789B01"
            spellCheck={false}
          />
        </Field>
        <Field label="IBAN">
          <input
            className="input"
            value={eigenIban}
            onChange={(e) => setEigenIban(e.target.value)}
            placeholder="NL00BANK0123456789"
            spellCheck={false}
          />
        </Field>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button
          className="btn primary"
          onClick={bewaar}
          disabled={bezig || !!foutDomein || !!foutVoorvoegsel}
        >
          <Save size={16} /> Opslaan
        </button>
      </div>

      {/* ------------------------------------------------------------ *
        *  De adressen stonden hier, en staan nu bij de administratie
        *
        *  Casper: "Bij ontwikkelaar heb ik bij inkoop nog steeds de adressen
        *  en grootboekrekeningen, gezien die bij administratie opkomen, kan
        *  dat daar niet weg?"
        *
        *  Terecht. Wat hier stond was de BEREKENDE lijst:
        *  inkoop.<website-slug>@<domein>, per vestiging. Sinds 0095 is een
        *  adres een rij in inkoop_adres met een onderneming en een persoon
        *  eraan, en sinds 0097 maken die zichzelf aan. De lijst hier was
        *  daarmee een tweede antwoord op dezelfde vraag -- en het verkeerde,
        *  want hij wist niets van hernoemde adressen of van bv's zonder
        *  vestiging.
        *
        *  Wat hierboven staat blijft wel: het domein, het voorvoegsel, wie er
        *  leest en wanneer er vanzelf getekend mag worden. Dat zijn
        *  instellingen en geen lijst, en ze staan nergens anders.
        * ------------------------------------------------------------ */}

      {zonderSlug.length > 0 && (
        <p className="help" style={{ marginTop: 12 }}>
          <TriangleAlert size={13} style={{ verticalAlign: -2 }} />{' '}
          {zonderSlug.length === 1
            ? 'Eén vestiging heeft'
            : `${zonderSlug.length} vestigingen hebben`}{' '}
          nog geen website-adres, waardoor het adres op de plaatsnaam niet
          gemaakt kan worden:{' '}
          {zonderSlug.map((l) => l.name).join(', ')}. Dat stel je in bij
          Vestigingen, tabblad Website. De adressen zelf staan bij
          Administratie, onder <strong>Waar facturen binnenkomen</strong>.
        </p>
      )}
    </Card>
  )
}

/**
 * Leeft het lokale programma nog?
 *
 * De functie lezer zet bij elke ronde lezer_laatst_gezien en lezer_model.
 * Die lezen we live uit de eigen tabel en niet één keer bij het laden: je
 * start het programma op de server en wilt hier binnen een halve minuut zien
 * dat het zich meldt, zonder het scherm te verversen.
 *
 * Rood alleen als lokaal gekozen is. Staat de lezer op Claude, dan is een
 * programma dat al weken niets zegt geen probleem maar de bedoeling.
 */
function LezerStatus({ lokaalGekozen }: { lokaalGekozen: boolean }) {
  const rijen = useLiveQuery(
    () => db.instellingen.toArray(), [], [] as Instelling[])

  /*
   * De klok tikt elke halve minuut, anders blijft er "zojuist" staan terwijl
   * het programma allang stil is.
   */
  const [nu, setNu] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNu(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const waarde = (sleutel: string) =>
    (rijen.find((r) => r.sleutel === sleutel)?.waarde ?? '').trim()
  const gezien = Number(waarde(SLEUTELS.lezerLaatstGezien)) || 0
  const model = waarde(SLEUTELS.lezerModel)

  const stil = lokaalGekozen && (!gezien || nu - gezien > LEZER_STIL_NA_MS)

  return (
    // Buiten een <Field> geldt .field .help niet; de maat en kleur dus hier.
    <p
      className={stil ? 'help danger' : 'help'}
      style={{
        marginTop: 10, fontSize: '.76rem', lineHeight: 1.45,
        color: stil ? 'var(--text-danger)' : 'var(--text-3)',
      }}>
      {stil && <TriangleAlert size={13} style={{ verticalAlign: -2 }} />}{' '}
      Lokale lezer{' '}
      {gezien
        ? <>laatst gezien {relative(gezien, nu)}{model && <>, model <code>{model}</code></>}</>
        : 'nog nooit gezien'}
      {stil && (gezien > 0
        ? ' — draait het programma op de server nog?'
        : ' — zonder draaiend programma blijven de bonnen wachten.')}
    </p>
  )
}


/* ================================================================== *
 *  2. Het grootboek
 * ================================================================== */

/*
 * De trefwoorden, niet het grootboek
 *
 * Casper vroeg of de grootboekrekeningen hier ook weg konden, omdat ze bij de
 * administratie al uit Exact komen. Half: de REKENINGEN komen daar inderdaad
 * vandaan -- per bv, uit exact_grootboek, en dat is de enige waarheid over
 * welke rekening bestaat.
 *
 * Wat hier staat is iets anders, en het is het enige exemplaar: de
 * TREFWOORDEN. Die bepalen waar een factuur zichzelf op indeelt -- "shell"
 * naar brandstof, "gamma" naar onderhoud. Zonder deze tabel raadt
 * factuur_indelen() niets meer en komt elke factuur leeg binnen.
 *
 * Dus blijft hij, maar niet meer onder een naam die doet alsof dit een tweede
 * rekeningschema is. Dat was precies de verwarring.
 */
function Rekeningen() {
  const rijen = useLiveQuery(() => db.grootboek.toArray(), [], [] as Grootboek[])
  const [open, setOpen] = useState<Grootboek | 'nieuw' | null>(null)

  /* ------------------------------------------------------------ *
   *  Een trefwoord hoort bij een rekening, niet bij een bv
   *
   *  Casper: "Die trefwoorden, of laat ze per bv zien, of niet, liever per
   *  bv... Zodat het geen eindeloze lijst wordt daar."
   *
   *  Wat hier gisteren op is gebouwd -- een keuze per bv -- filterde op een
   *  veld dat lokaal niet kón kloppen. In IndexedDB staat grootboek op CODE,
   *  dus van twintig bv's blijft er één rij per code over: de bv die als
   *  laatste binnenkwam. Het filter deed dus iets, maar niet wat er stond.
   *
   *  Sinds 0104 is dat ook niet meer nodig. Een trefwoord geldt voor alle
   *  bv's: factuur_indelen() zoekt het op code op, en kijkt in het schema van
   *  Exact of die rekening in DEZE administratie bestaat. Eén keer "shell"
   *  intikken werkt dus overal -- daarvoor was het twintig keer, of negentien
   *  bv's waar niets zichzelf indeelde.
   *
   *  De lijst is daarmee vanzelf kort: hij toont wat er is ingevuld. De
   *  bv-keuze blijft, maar voor de andere vraag -- wélke rekeningen er te
   *  kiezen zijn als je er een trefwoord aan wilt hangen.
   * ------------------------------------------------------------ */

  const schema = useLiveQuery(
    () => db.exactGrootboek.toArray(), [], [] as ExactGrootboek[])

  const [bvs, setBvs] = useState<ExactAdministratie[]>([])
  const [bv, setBv] = useState('')
  const [alles, setAlles] = useState(false)
  const [zoek, setZoek] = useState('')

  useEffect(() => {
    let weg = false
    exactFacturenStand()
      .then((stand) => {
        if (weg) return
        const actief = stand.administraties.filter((a) => a.actief)
        setBvs(actief)
        /* De hoofdadministratie voorop; daar kijkt men het vaakst. */
        const hoofd = actief.find((a) => a.hoofd) ?? actief[0]
        if (hoofd) setBv((b) => b || hoofd.code)
      })
      .catch(() => { /* geen koppeling: dan gewoon alles zonder bv-keuze */ })
    return () => { weg = true }
  }, [])

  /* Alle rekeningen die deze bv kent, met onze trefwoorden eraan. Dezelfde
     functie als het boekscherm gebruikt -- twee regels voor dezelfde vraag is
     er één te veel. */
  const vanBv = useMemo(
    () => rekeningenVan(schema, rijen, bv || undefined),
    [schema, rijen, bv])

  const metTrefwoord = useMemo(
    () => vanBv.filter((r) => (r.trefwoorden?.length ?? 0) > 0),
    [vanBv])

  const gesorteerd = useMemo(() => {
    const woorden = zoek.toLowerCase().split(/\s+/).filter(Boolean)
    const basis = (alles || woorden.length > 0) ? vanBv : metTrefwoord
    const gefilterd = woorden.length === 0 ? basis : basis.filter((r) => {
      const hooi = `${r.code} ${r.naam} ${(r.trefwoorden ?? []).join(' ')}`.toLowerCase()
      return woorden.every((w) => hooi.includes(w))
    })
    return [...gefilterd].sort((a, b) => a.code.localeCompare(b.code))
  }, [vanBv, metTrefwoord, alles, zoek])

  const verborgen = vanBv.length - metTrefwoord.length

  return (
    <Card
      title="Trefwoorden voor het indelen"
      hint="Waaraan een factuur herkend wordt; de rekeningen zelf komen uit Exact"
      className="mb"
      action={
        <button className="btn sm" onClick={() => setOpen('nieuw')}>
          <Plus size={15} /> Rekening
        </button>
      }
    >
      <div className="row mb" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {bvs.length > 0 && (
          <div style={{ minWidth: 240 }}>
            <Kiezer
              waarde={bv}
              leeg="— alle ondernemingen —"
              zoekHint="Naam of nummer"
              opties={bvs.map((a) => ({ waarde: a.code, label: a.naam, sub: a.code }))}
              onKies={setBv}
            />
          </div>
        )}
        <input
          className="input"
          style={{ flex: 1, minWidth: 200 }}
          value={zoek}
          placeholder="Zoek op code, naam of trefwoord"
          onChange={(e) => setZoek(e.currentTarget.value)}
        />
        {zoek && (
          <button className="btn ghost sm" onClick={() => setZoek('')}>
            <X size={13} />
          </button>
        )}
      </div>

      {gesorteerd.length === 0 ? (
        <Empty
          text={zoek
            ? `Geen rekening met "${zoek}"${bv ? ' in deze onderneming' : ''}.`
            : vanBv.length === 0
              ? 'Deze onderneming heeft nog geen rekeningen. Haal ze op bij Exact.'
              : 'Nog geen enkele rekening met een trefwoord. Zonder trefwoorden deelt hij niets vanzelf in.'}
          icon={<Wallet size={22} />}
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Code</th>
                <th>Naam</th>
                <th>Trefwoorden</th>
                <th style={{ width: 60 }}>Btw</th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {gesorteerd.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.code}</code></td>
                  <td>
                    {r.naam}{' '}
                    {!r.actief && <Badge>uit</Badge>}
                  </td>
                  <td className="afgekapt">
                    {r.trefwoorden?.length
                      ? r.trefwoorden.join(', ')
                      : 'geen — deze wordt nooit geraden'}
                  </td>
                  <td className="num">{r.btwPct ?? 21}%</td>
                  <td>
                    <button className="btn ghost sm" onClick={() => setOpen(r)}>
                      Wijzigen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        * Wat er verborgen is, en hoe je erbij komt. Stil weglaten zou
        * betekenen dat iemand een rekening niet kan vinden en denkt dat hij
        * niet bestaat.
        */}
      {!alles && !zoek && verborgen > 0 && (
        <p className="help" style={{ marginTop: 10 }}>
          {verborgen} rekening{verborgen === 1 ? '' : 'en'} zonder trefwoord
          {bv ? ' in deze onderneming' : ''} staan hier niet — die doen bij het
          indelen niets.{' '}
          <button className="btn ghost sm" onClick={() => setAlles(true)}>
            Toon ze toch
          </button>
        </p>
      )}

      {alles && !zoek && (
        <p className="help" style={{ marginTop: 10 }}>
          Alle {vanBv.length} rekeningen{bv ? ' van deze onderneming' : ''}.{' '}
          <button className="btn ghost sm" onClick={() => setAlles(false)}>
            Alleen die met trefwoorden
          </button>
        </p>
      )}

      <RekeningModal
        open={open !== null}
        rij={open === 'nieuw' || open === null ? null : open}
        bestaandeCodes={rijen.map((r) => r.code)}
        onClose={() => setOpen(null)}
      />
    </Card>
  )
}

function RekeningModal({
  open, rij, bestaandeCodes, onClose,
}: {
  open: boolean
  rij: Grootboek | null
  bestaandeCodes: string[]
  onClose: () => void
}) {
  const [code, setCode] = useState('')
  const [naam, setNaam] = useState('')
  const [woorden, setWoorden] = useState('')
  const [btw, setBtw] = useState('21')
  const [actief, setActief] = useState(true)
  const [bezig, setBezig] = useState(false)

  /*
   * Bij het openen de velden vullen. Zonder dit houdt het venster de gegevens
   * van de vorige rekening vast, en dan wijzig je 4010 terwijl er 4000 boven
   * staat.
   */
  useEffect(() => {
    if (!open) return
    setCode(rij?.code ?? '')
    setNaam(rij?.naam ?? '')
    setWoorden((rij?.trefwoorden ?? []).join(', '))
    setBtw(String(rij?.btwPct ?? 21))
    setActief(rij?.actief !== false)
  }, [open, rij])

  const codeFout = !code.trim()
    ? 'Een rekening zonder code is niet terug te vinden.'
    : (!rij && bestaandeCodes.includes(code.trim()))
      ? 'Deze code bestaat al.'
      : null

  async function bewaar() {
    if (codeFout || !naam.trim()) return
    setBezig(true)
    try {
      const nieuw: Grootboek = {
        id: rij?.id ?? 'gb_' + code.trim(),
        code: code.trim(),
        naam: naam.trim(),
        /*
         * Trefwoorden in kleine letters. Het indelen in de database zoekt
         * kleingeschreven; een trefwoord met een hoofdletter zou dan nooit
         * raak zijn, en dat is niet te zien aan het scherm.
         */
        trefwoorden: woorden.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean),
        btwPct: Number(btw) || 0,
        actief,
        updatedAt: Date.now(),
      }
      await db.grootboek.put(nieuw)
      await enqueue('grootboek', 'put', nieuw.id, nieuw)
      toast.ok('Rekening opgeslagen.')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukte.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <Modal
      open={open}
      title={rij ? `Rekening ${rij.code}` : 'Nieuwe rekening'}
      subtitle="Hierop worden kosten geboekt; de trefwoorden bepalen wanneer"
      onClose={onClose}
      width={620}
    >
      <div className="grid cols-2">
        <Field label="Code">
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="4031"
            disabled={!!rij}
          />
          {codeFout && <span className="help danger" style={ROOD}>{codeFout}</span>}
        </Field>
        <Field label="Btw-percentage" help="Vangnet; wat op de factuur staat gaat voor.">
          <input
            className="input"
            type="number"
            value={btw}
            onChange={(e) => setBtw(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Naam">
        <input
          className="input"
          value={naam}
          onChange={(e) => setNaam(e.target.value)}
          placeholder="Contributies en heffingen"
        />
      </Field>

      <Field
        label="Trefwoorden"
        help="Gescheiden door komma's. Hierop wordt geraden zolang de leverancier nog onbekend is."
      >
        <textarea
          className="textarea"
          rows={3}
          value={woorden}
          onChange={(e) => setWoorden(e.target.value)}
          placeholder="contributie, lidmaatschap, heffing, kvk"
        />
      </Field>

      <label className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={actief}
          onChange={(e) => setActief(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          In gebruik
          <br />
          <span className="help">
            Uitgezette rekeningen worden niet meer voorgesteld. Wat er al op
            geboekt staat blijft staan — anders zou een oude boeking van
            rekening veranderen omdat iemand een vinkje uitzette.
          </span>
        </span>
      </label>

      <div className="row end" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onClose}>Annuleren</button>
        <button
          className="btn primary"
          onClick={bewaar}
          disabled={bezig || !!codeFout || !naam.trim()}
        >
          <Save size={16} /> Opslaan
        </button>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 *  3. De tags
 * ================================================================== */

function Etiketten() {
  const rijen = useLiveQuery(() => db.kostenTags.toArray(), [], [] as KostenTag[])
  const [nieuw, setNieuw] = useState('')

  const gesorteerd = useMemo(
    () => [...rijen].sort((a, b) => a.naam.localeCompare(b.naam)), [rijen])

  async function voegToe() {
    const naam = nieuw.trim().toLowerCase()
    if (!naam) return
    if (gesorteerd.some((t) => t.naam === naam)) {
      toast.error('Die tag bestaat al.')
      return
    }
    const rij: KostenTag = { id: 'tag_' + naam, naam, updatedAt: Date.now() }
    await db.kostenTags.put(rij)
    await enqueue('kostenTags', 'put', rij.id, rij)
    setNieuw('')
  }

  async function weg(t: KostenTag) {
    /*
     * Met een waarschuwing en niet stil. Een tag weghalen laat de kostenposten
     * waar hij op staat ongemoeid -- daar blijft dan een etiket staan dat
     * nergens meer in de lijst voorkomt.
     */
    if (!window.confirm(
      `Tag "${t.naam}" weghalen?\n\n`
      + 'Kostenposten waar hij al op staat houden hem; hij is alleen niet meer '
      + 'te kiezen.')) return
    await db.kostenTags.delete(t.id)
    await enqueue('kostenTags', 'delete', t.id, null)
  }

  return (
    <Card
      title="Tags"
      hint="Losse etiketten naast de grootboekrekening: afval, elektra, osmose"
    >
      <div className="row mb">
        <input
          className="input"
          value={nieuw}
          onChange={(e) => setNieuw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') voegToe() }}
          placeholder="nieuwe tag"
          style={{ maxWidth: 240 }}
        />
        <button className="btn" onClick={voegToe} disabled={!nieuw.trim()}>
          <Plus size={15} /> Toevoegen
        </button>
      </div>

      {gesorteerd.length === 0 ? (
        <Empty text="Nog geen tags. Voeg er hierboven een toe." icon={<Tag size={22} />} />
      ) : (
        <div className="row">
          {gesorteerd.map((t) => (
            <span key={t.id} className="badge">
              {t.naam}
              <button
                className="btn ghost sm"
                onClick={() => weg(t)}
                title={`${t.naam} weghalen`}
                style={{ padding: '0 2px', marginLeft: 4 }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}

/* ================================================================== *
 *  4. Proeffacturen
 *
 *  Casper: "daarna wil ik een aantal test facturen sturen (...) en dat ik via
 *  ontwikkelaar deze test facturen kan versturen zodat het systeem ze gaan
 *  bekijken."
 *
 *  Elke factuur hieronder zet één beslissing op scherp, en er staat bij wat
 *  er hoort te gebeuren. Dat laatste is het halve werk: een proef waarvan je
 *  vooraf niet hebt opgeschreven wat je verwacht, is geen proef maar een
 *  demonstratie -- je kijkt naar het scherm en vindt het er goed uitzien.
 *
 *  Ze gaan door de echte webhook naar binnen. Alles wat er daarna gebeurt is
 *  precies wat er met post van een leverancier gebeurt.
 * ================================================================== */

function Proeffacturen() {
  const vestigingen = useLiveQuery(() => db.locations.toArray(), [], [] as Location[])
  const [domein, setDomein] = useState('')
  const [voorvoegsel, setVoorvoegsel] = useState('inkoop')
  const [waarheen, setWaarheen] = useState('')
  const [bezig, setBezig] = useState<string | null>(null)
  const [uitslag, setUitslag] = useState<Record<string, string>>({})

  useEffect(() => {
    let levend = true
    void leesInstellingen().then((alle) => {
      if (!levend) return
      setDomein(alle[SLEUTELS.inkoopDomein] ?? '')
      setVoorvoegsel(alle[SLEUTELS.inkoopVoorvoegsel] || 'inkoop')
    })
    return () => { levend = false }
  }, [])

  const metSlug = useMemo(
    () => vestigingen.filter((l) => l.active !== false && l.websiteSlug)
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [vestigingen])

  /* Het adres bepaalt de vestiging, en daarmee de bv waarin geboekt zou
     worden. Dat is bij een proef precies zo belangrijk als bij een echte. */
  const adres = waarheen
    ? inkoopAdres(domein, voorvoegsel, metSlug.find((l) => l.id === waarheen)?.websiteSlug)
    : inkoopAdres(domein, voorvoegsel)

  async function stuur(f: Testfactuur) {
    setBezig(f.sleutel)
    try {
      const uit = await stuurTestfactuur(f, adres)
      setUitslag((o) => ({
        ...o,
        [f.sleutel]: uit.kostenpost
          ? 'Binnen, en er is een kostenpost van gemaakt.'
          : 'Binnen. Er is geen kostenpost van gemaakt — kijk in de postbus waarom.',
      }))
      toast.ok('Verstuurd. Kijk bij Inkoop wat het systeem ervan maakte.')
    } catch (e) {
      const reden = e instanceof Error ? e.message : 'Versturen lukte niet.'
      setUitslag((o) => ({ ...o, [f.sleutel]: reden }))
      toast.error(reden)
    } finally {
      setBezig(null)
    }
  }

  if (!domein) {
    return (
      <Card title="Proeffacturen" className="mb">
        <Empty
          text="Er staat nog geen inkoopdomein. Vul dat hierboven in; zonder adres
                weet de webhook niet bij welke vestiging een factuur hoort."
        />
      </Card>
    )
  }

  return (
    <Card
      title="Proeffacturen"
      hint="Door de echte webhook, zodat het systeem ze net zo behandelt als post"
      className="mb"
    >
      <div className="grid cols-2 mb">
        <Field
          label="Bezorgen op"
          help="Het adres bepaalt de vestiging, en daarmee de bv waarin hij zou boeken."
        >
          <select className="input" value={waarheen} onChange={(e) => setWaarheen(e.target.value)}>
            <option value="">Algemeen ({inkoopAdres(domein, voorvoegsel)})</option>
            {metSlug.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({inkoopAdres(domein, voorvoegsel, l.websiteSlug)})
              </option>
            ))}
          </select>
        </Field>
      </div>

      <p className="help" style={{ marginTop: 0 }}>
        Op elke PDF staat onderaan <strong>PROEFFACTUUR</strong>. Belandt er
        ooit een in een echte stapel, dan is dat meteen te zien — ook door
        iemand die deze knop niet kent. Weggooien doe je bij Inkoop, zoals bij
        elke andere bon.
      </p>

      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        {TESTFACTUREN.map((f) => (
          <div
            key={f.sleutel}
            style={{
              padding: '11px 13px',
              border: '1px solid var(--line-soft)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-2)',
            }}
          >
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: '.9rem' }}>{f.naam}</strong>
                <div className="ts-sub" style={{ marginTop: 2 }}>{f.test}</div>
              </div>
              <button
                className="btn sm"
                disabled={bezig !== null}
                onClick={() => void stuur(f)}
              >
                {bezig === f.sleutel
                  ? <><Loader2 size={14} className="spin" /> Bezig…</>
                  : <><Send size={14} /> Versturen</>}
              </button>
            </div>

            <div
              style={{
                marginTop: 8, paddingTop: 8,
                borderTop: '1px solid var(--line-soft)',
                fontSize: '.8rem', color: 'var(--text-3)',
              }}
            >
              <strong style={{ color: 'var(--text-2)' }}>Verwacht:</strong> {f.verwacht}
            </div>

            {uitslag[f.sleutel] && (
              <div style={{ marginTop: 6, fontSize: '.8rem', color: 'var(--text-2)' }}>
                → {uitslag[f.sleutel]}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
