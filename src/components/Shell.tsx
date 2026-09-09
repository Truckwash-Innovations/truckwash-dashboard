import {
  type ReactNode, useEffect, useMemo, useRef, useState,
} from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, Bug, Compass, LayoutGrid, LogOut, Menu as MenuIcon,
  MessageSquarePlus, Mic, MoreHorizontal, RefreshCw, Search, SlidersHorizontal, X,
} from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { useSync } from '../lib/sync'
import { useNav } from '../store/useNav'
import { voiceSupported, voiceUnavailableReason } from '../lib/voice'
import { toast } from '../store/useToasts'
import { useUpdates } from '../lib/updates'
import { initials, relative } from '../lib/format'
import SyncPill from './SyncPill'
import Logo from './Logo'
import GlobalSearch from './GlobalSearch'
import LocationSwitcher from './LocationSwitcher'
import StoringMelden from './StoringMelden'
import DevMelding from './DevMelding'
import Instellingen from './Instellingen'
import Overleg, { OverlegKnop } from './Overleg'
import { Dropdown, type MenuGroup } from './ui'
import { CATEGORIEEN } from '../lib/menu'
import { trail } from '../lib/trail'
import { usePerms } from '../store/useNav'
import NotificationCenter from './NotificationCenter'
import { terugTeKijken } from '../lib/rondleiding'
import { useRondleiding } from '../store/useRondleiding'
import type { LucideIcon } from 'lucide-react'

/* ==================================================================
   Het raam om de app
   ==================================================================

   Wat hier veranderd is, en waarom
   --------------------------------

   Casper: "Verwijder de huidige permanente navigatiebalk aan de zijkant. Ik
   wil geen grote sidebar die permanent een deel van het scherm inneemt."

   Er stond een zijbalk van 248px in een raster van twee kolommen. Op een
   laptop van 1366px is dat achttien procent van het scherm, permanent, voor
   een lijst die je een paar keer per uur gebruikt -- en op een tabel met
   tien kolommen precies de twee kolommen die niet meer passen.

   Nu: een balk van 48px bovenaan, daaronder alles, en de navigatie achter
   een menuknop linksboven. Die opent een paneel met alle categorieen naast
   elkaar, zodat je in een blik ziet wat er is. Dat is het verschil met de
   oude opzet: die had twee niveaus waarvan het tweede dichtstond, dus wist
   je niet wat eronder zat.

   Wat er met opzet NIET verdwenen is
   ----------------------------------

   Alles wat in de voet van de zijbalk stond -- ander dashboard, instellingen,
   wie je bent, de versie, hoe lang geleden er is bijgewerkt -- zat al in het
   profielmenu rechtsboven, of staat daar nu. De onderbalk op een telefoon
   blijft: dat is geen zijbalk maar de snelste weg op een klein scherm, en
   die weghalen zou werk kosten in plaats van opleveren.

   En de rondleiding blijft werken. Vierentwintig van haar stappen wijzen
   naar een menu-item; die bestaan alleen zolang het menu openstaat. Vandaar
   menuNodig in useRondleiding: wijst de uitleg naar een menu-item, dan gaat
   het menu open en blijft het staan.
   ================================================================== */

export interface NavItem {
  key: string
  label: string
  icon: LucideIcon
  badge?: number
  /**
   * Een tweede niveau.
   *
   * Blijft bestaan omdat de administratie het gebruikt en acht andere
   * dashboards er niets van hoeven te merken. In de launcher wordt het
   * platgeslagen: daar doen de categorieen de groepering, en twee soorten
   * groepen door elkaar is precies de diepte die eruit moest.
   */
  kinderen?: NavItem[]
}

interface Props {
  roleLabel: string
  items: NavItem[]
  active: string
  onNavigate: (key: string) => void
  title: string
  subtitle?: string
  /** Knoppen die zichtbaar moeten blijven, bijv. de periodekiezer */
  actions?: ReactNode
  /** Regels die het dashboard aan het actiemenu toevoegt */
  menu?: MenuGroup[]
  children: ReactNode
}

export default function Shell({
  roleLabel, items, active, onNavigate, title, subtitle, actions, menu, children,
}: Props) {
  const { user, clearRole, logout } = useAuth()
  const { lastSyncAt, sync, syncing, schemaAchter, sessieWeg } = useSync()
  const version = useUpdates((s) => s.version)
  const openSearch = useNav((s) => s.openSearch)
  const goto = useNav((s) => s.goto)
  const perms = usePerms()

  const [storing, setStoring] = useState(false)
  const [devmelding, setDevmelding] = useState(false)
  const [instellingen, setInstellingen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  /* De rondleiding mag het menu openzetten; zie de kop. */
  const menuNodig = useRondleiding((s) => s.menuNodig)
  const menuZichtbaar = menuOpen || menuNodig

  /*
   * De vier vakken van de onderbalk op een telefoon.
   *
   * Groepskoppen eruit: die zijn geen pagina en navigeren naar niets. Zie de
   * uitleg bij de onderbalk zelf.
   */
  const mobielItems = useMemo(
    () => items.flatMap((it) => (it.kinderen?.length ? it.kinderen : [it])).slice(0, 4),
    [items])

  // Elk schermwissel in het spoor, zodat een melding laat zien waar iemand
  // liep vlak voordat er iets misging.
  useEffect(() => { trail.page(roleLabel, active) }, [roleLabel, active])

  /* ---------------------------------------------------------------- *
   *  Het actiemenu
   * ---------------------------------------------------------------- */

  const acties: MenuGroup[] = [
    ...(menu ?? []),
    {
      title: 'Melden',
      items: [
        ...(perms.can('faults.report') ? [{
          key: 'storing',
          label: 'Storing melden',
          hint: 'Er is iets stuk op de vestiging',
          icon: <AlertTriangle size={16} />,
          onClick: () => setStoring(true),
        }] : []),
        ...(perms.can('dev.report') ? [{
          key: 'devmelding',
          label: 'Melding aan de ontwikkelaar',
          hint: 'De app doet iets raars, of je mist iets',
          icon: <Bug size={16} />,
          onClick: () => setDevmelding(true),
        }] : []),
        ...(perms.can('dev.report') ? [{
          key: 'mijnmeldingen',
          label: 'Mijn meldingen',
          hint: 'Wat je eerder hebt doorgegeven',
          icon: <MessageSquarePlus size={16} />,
          onClick: () => { setDevmelding(true) },
        }] : []),
      ],
    },
    {
      title: 'Gegevens',
      items: [
        {
          key: 'sync',
          label: syncing ? 'Bezig met synchroniseren…' : 'Nu synchroniseren',
          hint: lastSyncAt ? `Laatst bijgewerkt ${relative(lastSyncAt)}` : 'Nog niet bijgewerkt',
          icon: <RefreshCw size={16} />,
          disabled: syncing,
          onClick: () => void sync(),
        },
      ],
    },
  ]

  const rondleidingen = terugTeKijken(user)
  const startRondleiding = useRondleiding((s) => s.start)

  const persoonlijk: MenuGroup[] = [
    {
      /* Wie je bent en waar je zit. Stond in de voet van de zijbalk; hier is
         het op de plek waar iedereen het in een zakelijke app zoekt. */
      title: user?.name ? `${user.name} · v${version}` : undefined,
      items: [
        {
          key: 'instellingen',
          label: 'Instellingen',
          hint: 'Licht of donker, beweging, meldingen',
          icon: <SlidersHorizontal size={16} />,
          onClick: () => setInstellingen(true),
        },
        {
          key: 'wissel',
          label: 'Ander dashboard',
          hint: 'Terug naar de keuze',
          icon: <LayoutGrid size={16} />,
          onClick: clearRole,
        },
      ],
    },
    ...(rondleidingen.length > 0 ? [{
      title: rondleidingen.length > 1 ? 'Rondleidingen' : undefined,
      items: rondleidingen.map((r) => ({
        key: 'rond-' + r.rol,
        label: rondleidingen.length > 1 ? r.naam : 'Rondleiding opnieuw',
        hint: rondleidingen.length > 1 ? undefined : 'Nog eens laten zien waar alles staat',
        icon: <Compass size={16} />,
        onClick: () => startRondleiding(r.rol),
      })),
    }] : []),
    {
      items: [
        {
          key: 'uit',
          label: 'Uitloggen',
          icon: <LogOut size={16} />,
          tone: 'danger' as const,
          onClick: () => void logout(),
        },
      ],
    },
  ]

  return (
    <div className="raam">
      {/* De eerste Tab op elke pagina. Zonder dit moet wie met het
          toetsenbord werkt eerst door de hele bovenbalk. */}
      <a className="overslaan" href="#inhoud">Naar de inhoud</a>

      <header className="topbalk">
        <button
          className="menuknop"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuZichtbaar}
          aria-controls="hoofdmenu"
          aria-label={menuZichtbaar ? 'Menu sluiten' : 'Menu openen'}
          title="Menu"
          data-rondleiding="menu"
        >
          {menuZichtbaar ? <X size={19} /> : <MenuIcon size={19} />}
        </button>

        <button className="topbalk-merk" onClick={() => onNavigate('start')} title="Naar het begin">
          {/* Het logo is een woordmerk van 250x70; op 96 breed is dat 27
              hoog en past het in een balk van 48 met lucht eromheen. */}
          <Logo width={96} />
        </button>

        <div className="topbalk-plek">
          <span className="hide-mobile" aria-hidden="true">·</span>
          <b>{title}</b>
          {subtitle && <span className="hide-mobile">{subtitle}</span>}
        </div>

        <span className="topbalk-rek" />

        <div className="topbalk-rechts">
          <span data-rondleiding="locatie"><LocationSwitcher /></span>

          <div className="topbar-search" data-rondleiding="zoeken">
            <button className="search-trigger" onClick={() => openSearch(false)} title="Zoeken (Ctrl+K)">
              <Search size={15} />
              <span className="label">Zoeken…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              className="topbar-mic"
              onClick={() =>
                voiceSupported() ? openSearch(true) : toast.info(voiceUnavailableReason())
              }
              title={voiceSupported() ? 'Zoeken met je stem' : voiceUnavailableReason()}
              aria-label="Zoeken met je stem"
            >
              <Mic size={16} />
            </button>
          </div>

          <GlobalSearch />

          {actions}

          <OverlegKnop onOpen={() => goto('overleg')} />
          <span data-rondleiding="meldingen"><NotificationCenter /></span>

          <Dropdown
            icon={<MoreHorizontal size={17} />}
            items={acties}
            title="Acties"
            className="hide-mobile"
          />

          <span data-rondleiding="ik">
            <Dropdown
              icon={<span className="menu-av">{initials(user?.name ?? '?')}</span>}
              items={persoonlijk}
              title={user?.name}
              className="menu-persoon"
            />
          </span>

          <SyncPill />
        </div>
      </header>

      {/* className="main" blijft staan. Niet uit gemakzucht: de mobiele
          regels voor het overleg hangen eraan (.main:has(.chat-list.has-open)
          verbergt de onderbalk als er een gesprek openstaat). Hem weghalen zou
          op een telefoon het invoerveld onder de balk schuiven -- en dat merk
          je pas als iemand in een wasstraat iets probeert te typen. */}
      <div className="main">
        {sessieWeg && (
          <div className="schema-banner">
            <AlertTriangle size={17} />
            <span>
              <strong>Je bent niet meer ingelogd bij de server.</strong>{' '}
              De app werkt door op wat er op dit apparaat staat, maar versturen
              lukt niet. Log opnieuw in — wat je hebt ingevoerd blijft in de
              wachtrij staan en gaat daarna alsnog mee.
            </span>
            <button className="btn sm" onClick={() => void logout()}>
              Opnieuw inloggen
            </button>
          </div>
        )}

        {schemaAchter.length > 0 && perms.canAny('admin.settings', 'dev.logs') && (
          <div className="schema-banner">
            <AlertTriangle size={17} />
            <span>
              <strong>De database loopt achter op de app.</strong>{' '}
              {schemaAchter.length === 1
                ? `De tabel ${schemaAchter[0]} bestaat nog niet.`
                : `Deze tabellen bestaan nog niet: ${schemaAchter.join(', ')}.`}{' '}
              Draai supabase/setup.sql opnieuw. De rest blijft gewoon werken, en
              wat er in de wachtrij staat blijft bewaard.
            </span>
          </div>
        )}

        <motion.main
          id="inhoud"
          className="werkvlak"
          key={active}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .16 }}
        >
          {children}
        </motion.main>

        {/* --------------------- Mobiele navigatie ------------------
          *
          *  Blijft. Dit is geen zijbalk maar de snelste weg op een telefoon:
          *  vier vakken plus "Meer". Wie meer nodig heeft opent het menu of
          *  zoekt -- op een klein scherm is dat toch sneller dan bladeren.
          * ---------------------------------------------------------- */}
        <nav className="mobile-nav" aria-label="Snel naar">
          {/*
            De eerste vier ECHTE schermen, en niet de eerste vier menu-items.

            Hier stond items.slice(0, 4), en bij de administratie zijn twee van
            die vier een groepskop -- 'inkoop-groep' en 'verkoop-groep'. Die
            bestaan als pagina niet, dus zette een tik op een telefoon de
            pagina op iets waar geen enkele tak voor is: een leeg scherm met de
            titel "Te doen", zonder melding.

            In de zijbalk viel dat niet op, want daar vouwt een kop open. De
            onderbalk gebruikte dezelfde lijst en navigeerde gewoon.
          */}
          {mobielItems.map((it) => {
            const Icon = it.icon
            return (
              <button
                key={it.key}
                className={active === it.key ? 'active' : ''}
                onClick={() => onNavigate(it.key)}
                aria-current={active === it.key ? 'page' : undefined}
              >
                <Icon size={22} />
                <span>{it.label}</span>
                {!!it.badge && <span className="stip" />}
              </button>
            )
          })}
          <Dropdown
            icon={<MoreHorizontal size={22} />}
            items={[...acties, ...persoonlijk]}
            align="right"
            className="mobile-meer"
            label="Meer"
          />
        </nav>
      </div>

      <Launcher
        open={menuZichtbaar}
        sluit={() => setMenuOpen(false)}
        items={items}
        active={active}
        roleLabel={roleLabel}
        onNavigate={(k) => { setMenuOpen(false); onNavigate(k) }}
      />

      <StoringMelden open={storing} onClose={() => setStoring(false)} />
      <DevMelding
        open={devmelding}
        onClose={() => setDevmelding(false)}
        fromRole={roleLabel}
        fromPage={active}
      />
      <Instellingen open={instellingen} onClose={() => setInstellingen(false)} />
    </div>
  )
}

/** Het overlegscherm, zodat dashboards het als pagina kunnen tonen. */
export { Overleg }

/* ==================================================================
   De app-launcher
   ==================================================================

   Casper: "Menu -> categorie -> functie, en niet Menu -> categorie ->
   subcategorie -> subcategorie -> pagina."

   Alles staat open. Geen uitklapbare groepen: de categorieen staan als
   kolommen naast elkaar en je ziet in een blik wat er is. Dat was het
   probleem met de oude zijbalk -- het tweede niveau stond dicht, dus wat er
   onder een kop zat wist je pas als je erop klikte.

   Wat een dashboard hier aanlevert is nog steeds zijn eigen items-lijst; de
   indeling in categorieen komt uit lib/menu.ts en is aantoonbaar compleet
   (zelftest 58 rekent na dat elke schermsleutel precies een categorie heeft).
   ================================================================== */

function Launcher({
  open, sluit, items, active, roleLabel, onNavigate,
}: {
  open: boolean
  sluit: () => void
  items: NavItem[]
  active: string
  roleLabel: string
  onNavigate: (key: string) => void
}) {
  const raam = useRef<HTMLDivElement>(null)
  const [zoek, setZoek] = useState('')

  /* Het tweede niveau plat: de categorieen doen de groepering. */
  const plat = useMemo(
    () => items.flatMap((it) => (it.kinderen?.length ? it.kinderen : [it])),
    [items])

  /* Per categorie wat dit dashboard ervan kent, in de volgorde van menu.ts.
     Een categorie zonder items komt niet in beeld -- een wasser hoort geen
     lege kop "Administratie" te zien. */
  const groepen = useMemo(() => {
    const term = zoek.trim().toLowerCase()
    const past = (it: NavItem) => !term || it.label.toLowerCase().includes(term)
    const opSleutel = new Map(plat.map((it) => [it.key, it]))
    const gebruikt = new Set<string>()

    const uit = CATEGORIEEN.map((c) => {
      const gevonden = c.paginas
        .map((p) => opSleutel.get(p))
        .filter((it): it is NavItem => !!it && past(it))
      gevonden.forEach((it) => gebruikt.add(it.key))
      return { naam: c.naam, sleutel: c.sleutel, items: gevonden }
    }).filter((g) => g.items.length > 0)

    /* Wat in geen enkele categorie staat. Hoort niet voor te komen -- de
       zelftest bewaakt dat -- maar als het toch gebeurt is een kop "Overig"
       beter dan een item dat nergens meer te vinden is. */
    const rest = plat.filter((it) => !gebruikt.has(it.key) && past(it))
    if (rest.length) uit.push({ naam: 'Overig', sleutel: 'overig', items: rest })

    return uit
  }, [plat, zoek])

  /* Escape sluit, en de focus gaat naar het zoekveld bij het openen. */
  useEffect(() => {
    if (!open) { setZoek(''); return }
    const veld = raam.current?.querySelector<HTMLInputElement>('input')
    veld?.focus()
    function toets(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); sluit() }
    }
    document.addEventListener('keydown', toets)
    return () => document.removeEventListener('keydown', toets)
  }, [open, sluit])

  if (!open) return null

  const totaal = groepen.reduce((n, g) => n + g.items.length, 0)

  return (
    <>
      <div className="launcher-sluier" onClick={sluit} aria-hidden="true" />
      <div
        className="launcher"
        id="hoofdmenu"
        role="dialog"
        aria-modal="false"
        aria-label="Hoofdmenu"
        ref={raam}
      >
        <div className="launcher-kop">
          <h2>{roleLabel}</h2>
          <p>Alles wat je in dit dashboard kunt doen.</p>
          <div className="zoekveld" style={{ marginTop: 'var(--s3)', maxWidth: 'none' }}>
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={zoek}
              onChange={(e) => setZoek(e.target.value)}
              placeholder="Filter dit menu…"
              aria-label="Filter dit menu"
            />
          </div>
        </div>

        <div className="launcher-body">
          {groepen.map((g) => (
            <div className="launcher-groep" key={g.sleutel}>
              <h3>{g.naam}</h3>
              {g.items.map((it) => {
                const Icon = it.icon
                return (
                  <button
                    key={it.key}
                    className="launcher-item"
                    onClick={() => onNavigate(it.key)}
                    aria-current={active === it.key ? 'page' : undefined}
                    data-rondleiding={`nav-${it.key}`}
                  >
                    <Icon size={17} />
                    <span className="naam">{it.label}</span>
                    {!!it.badge && <span className="teller">{it.badge}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {totaal === 0 && (
          <p style={{
            padding: 'var(--s5)',
            margin: 0,
            fontSize: 'var(--fs-klein)',
            color: 'var(--text-3)',
          }}>
            Niets gevonden voor “{zoek}”.
          </p>
        )}
      </div>
    </>
  )
}
