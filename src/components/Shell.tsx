import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, Bug, ChevronDown, Compass, LayoutGrid, LogOut,
  MessageSquarePlus, Mic, MoreHorizontal,
  PanelLeftClose, PanelLeftOpen, RefreshCw, Search, Settings, SlidersHorizontal,
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
import { trail } from '../lib/trail'
import { useTheme } from '../lib/theme'
import { usePerms } from '../store/useNav'
import NotificationCenter from './NotificationCenter'
import { terugTeKijken } from '../lib/rondleiding'
import { useRondleiding } from '../store/useRondleiding'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  key: string
  label: string
  icon: LucideIcon
  badge?: number
  /**
   * Een tweede niveau.
   *
   * Optioneel, en dat is de hele truc: een item zonder kinderen rendert
   * precies zoals het altijd deed. Negen dashboards delen deze Shell; acht
   * daarvan hoeven van dit hoofdstuk niets te merken.
   *
   * Alleen de administratie gebruikt het, en om een reden: die had zeven
   * losse knoppen die er straks vijftien zouden worden. Vijftien knoppen op
   * een rij is geen menu meer maar een lijst waar je in zoekt.
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
  const klein = useTheme((s) => s.zijbalkKlein)
  const setZijbalk = useTheme((s) => s.setZijbalk)

  const [storing, setStoring] = useState(false)
  const [devmelding, setDevmelding] = useState(false)
  const [instellingen, setInstellingen] = useState(false)

  /* ---------------------------------------------------------------- *
   *  Het tweede niveau
   *
   *  In de smalle zijbalk staan alleen icoontjes. Een groepskop is daar
   *  onbruikbaar -- je ziet een icoon dat niets doet behalve iets openvouwen
   *  wat je niet kunt lezen. Dus daar plat: de kinderen komen los in de rij te
   *  staan, precies zoals het menu voor deze verbouwing was.
   * ---------------------------------------------------------------- */
  const zichtbaar = useMemo(
    () => (klein
      ? items.flatMap((it) => (it.kinderen?.length ? it.kinderen : [it]))
      : items),
    [items, klein],
  )

  /*
   * Welke groepen open staan onthouden we per dashboard. Iemand die elke
   * ochtend bij Inkoop begint, hoort dat niet elke ochtend opnieuw open te
   * hoeven klikken.
   *
   * De groep waar je nu in zit staat altijd open; dat regelt Groep zelf. Deze
   * verzameling gaat alleen over wat je met de hand hebt opengezet.
   */
  const [openGroepen, setOpenGroepen] = useState<Set<string>>(() => {
    try {
      const bewaard = localStorage.getItem(`menu-open:${roleLabel}`)
      return new Set<string>(bewaard ? (JSON.parse(bewaard) as string[]) : [])
    } catch {
      return new Set<string>()
    }
  })

  const wisselGroep = (sleutel: string) => {
    setOpenGroepen((oud) => {
      const nieuw = new Set(oud)
      if (nieuw.has(sleutel)) nieuw.delete(sleutel)
      else nieuw.add(sleutel)
      /* Een voorkeur die niet bewaard kan worden is geen reden om niet te
         kunnen klikken. */
      try {
        localStorage.setItem(`menu-open:${roleLabel}`, JSON.stringify([...nieuw]))
      } catch { /* prive-venster, volle schijf -- niet erg */ }
      return nieuw
    })
  }

  // Elk schermwissel in het spoor, zodat een melding laat zien waar iemand
  // liep vlak voordat er iets misging.
  useEffect(() => { trail.page(roleLabel, active) }, [roleLabel, active])

  /* ---------------------------------------------------------------- *
   *  Het actiemenu
   *
   *  Hier zat vroeger een rij losse icoontjes waarvan je moest raden wat
   *  ze deden. Onder één knop, met een regel uitleg per keuze, is het
   *  compacter én duidelijker.
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
    /*
     * De rondleiding terugkijken, per rol die je hebt. Alleen de rollen die
     * je ook echt hebt -- een uitleg over een dashboard waar je niet in komt
     * is geen uitleg maar een folder.
     */
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
    <div className={`app-shell ${klein ? 'smal' : ''}`}>
      {/* ------------------------- Zijbalk -------------------------- */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          {klein ? <Logo width={34} /> : <Logo width={150} />}
          <div className="sub">{roleLabel}</div>
        </div>

        <nav className="nav">
          {zichtbaar.map((it) => (
            it.kinderen && it.kinderen.length > 0
              ? (
                <Groep
                  key={it.key}
                  item={it}
                  active={active}
                  open={openGroepen.has(it.key)}
                  onToggle={() => wisselGroep(it.key)}
                  onNavigate={onNavigate}
                />
              )
              : (
                <Knop
                  key={it.key}
                  item={it}
                  active={active}
                  klein={klein}
                  onNavigate={onNavigate}
                />
              )
          ))}
        </nav>

        <div className="sidebar-foot">
          <button className="nav-item" onClick={clearRole} title={klein ? 'Ander dashboard' : undefined}>
            <LayoutGrid size={18} />
            <span>Ander dashboard</span>
          </button>
          <button
            className="nav-item"
            onClick={() => setInstellingen(true)}
            title={klein ? 'Instellingen' : undefined}
          >
            <Settings size={18} />
            <span>Instellingen</span>
          </button>
          <button
            className="nav-item"
            onClick={() => setZijbalk(!klein)}
            title={klein ? 'Menu uitklappen' : 'Menu inklappen'}
          >
            {klein ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            <span>Inklappen</span>
          </button>

          <div className="sidebar-persoon" title={klein ? user?.name : undefined}>
            <div className="av">{initials(user?.name ?? '?')}</div>
            <div style={{ minWidth: 0 }}>
              <div className="n">{user?.name}</div>
              <div className="s">
                v{version}
                {lastSyncAt ? ` · ${relative(lastSyncAt)}` : ''}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* --------------------------- Werkvlak ----------------------- */}
      <div className="main">
        <header className="topbar">
          <div className="topbar-titel">
            <h1>{title}</h1>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <span className="spacer" />

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
        </header>

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
          className="content"
          key={active}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .2 }}
        >
          {children}
        </motion.main>

        {/* --------------------- Mobiele navigatie ------------------
          *
          *  Vijf even brede vakken: de eerste vier schermen en "Meer". Wat er
          *  bovenin niet past op een telefoon -- de acties, synchroniseren,
          *  instellingen, wisselen van dashboard -- zit onder "Meer". De
          *  schermen die niet in de eerste vier zitten zijn via zoeken te
          *  bereiken; dat is op een telefoon toch de snelste weg.
          * ---------------------------------------------------------- */}
        <nav className="mobile-nav" aria-label="Hoofdmenu">
          {items.slice(0, 4).map((it) => {
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

/* ------------------------------------------------------------------ *
 *  Het menu
 *
 *  Twee niveaus, maar alleen waar een dashboard erom vraagt. Een item zonder
 *  kinderen gaat door Knop en komt eruit als de knop die er altijd stond --
 *  zelfde klassen, zelfde data-rondleiding, zelfde aria-current. Dat is
 *  bewust: de rondleiding haakt aan `nav-<sleutel>` en de acht andere
 *  dashboards mogen hier niets van merken.
 * ------------------------------------------------------------------ */

function Knop({ item, active, klein, onNavigate, kind }: {
  item: NavItem
  active: string
  klein?: boolean
  onNavigate: (key: string) => void
  kind?: boolean
}) {
  const Icon = item.icon
  return (
    <button
      className={`nav-item ${kind ? 'nav-kind' : ''} ${active === item.key ? 'active' : ''}`}
      onClick={() => onNavigate(item.key)}
      title={klein ? item.label : undefined}
      data-rondleiding={`nav-${item.key}`}
      aria-current={active === item.key ? 'page' : undefined}
    >
      <Icon size={kind ? 16 : 18} />
      <span>{item.label}</span>
      {!!item.badge && <span className="badge brand">{item.badge}</span>}
    </button>
  )
}

/**
 * Een groep met kinderen.
 *
 * De kop is geen pagina. Erop klikken vouwt open en dicht en navigeert niet
 * -- anders spring je naar een scherm terwijl je alleen wilde kijken wat
 * eronder zit.
 *
 * Staat de groep dicht en ligt er werk in, dan telt de kop de badges van zijn
 * kinderen bij elkaar op. Zonder dat is inklappen een manier om werk te
 * verstoppen, en dan klapt niemand ooit iets in.
 */
function Groep({ item, active, open, onToggle, onNavigate }: {
  item: NavItem
  active: string
  open: boolean
  onToggle: () => void
  onNavigate: (key: string) => void
}) {
  const kinderen = item.kinderen ?? []
  const heeftActieve = kinderen.some((k) => k.key === active)
  const uit = open || heeftActieve
  const samen = kinderen.reduce((n, k) => n + (k.badge ?? 0), 0)
  const Icon = item.icon

  return (
    <div className={`nav-groep ${uit ? 'uit' : ''}`}>
      <button
        className={`nav-item nav-kop ${heeftActieve ? 'bevat' : ''}`}
        onClick={onToggle}
        aria-expanded={uit}
        data-rondleiding={`nav-${item.key}`}
      >
        <Icon size={18} />
        <span>{item.label}</span>
        {!uit && samen > 0 && <span className="badge brand">{samen}</span>}
        <ChevronDown size={15} className="nav-pijl" />
      </button>

      {uit && (
        <div className="nav-kinderen">
          {kinderen.map((k) => (
            <Knop key={k.key} item={k} active={active} onNavigate={onNavigate} kind />
          ))}
        </div>
      )}
    </div>
  )
}
