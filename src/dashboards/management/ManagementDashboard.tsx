import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bot, Briefcase, BriefcaseBusiness, Building2, Camera, CalendarDays, CalendarRange, DoorOpen, FolderOpen, GraduationCap, Inbox, LayoutDashboard, LayoutGrid, ListTodo, Mail, MessageSquare, Monitor, Package, Receipt, Send, Settings, Users, Wrench,
} from 'lucide-react'
import Shell from '../../components/Shell'
import { kopVan, menuVan, sleutelsVan, type Pagina } from '../../components/paginas'
import Kantoor from '../../components/kantoor/Kantoor'
import { db, alleMensen } from '../../lib/db'
import { money } from '../../lib/format'
import Overzicht from './Overzicht'
import Financieel from './Financieel'
import Personeel from '../../components/Personeel'
/*
 * De koppeling van het personeel met Exact.
 *
 * Die stond bij ontwikkeling, tussen de sleutels van de Exact-app. Alles wat
 * met Exact te maken heeft is naar de administratie verhuisd -- behalve dit:
 * hier gaat het volledige Exact-record langs en daar kan een BSN in zitten.
 * Dat ligt sinds 0009 bij het management en bij de medewerker zelf, en 0054
 * herhaalt dat. De database laat een ruimere deur ook niet toe: de policy op
 * exact_personeel is is_management().
 *
 * Onder een andere naam, want er staat hier al een Personeel.
 */
import { Personeel as ExactPersoneel } from '../../components/Exact'
import { exactStatus } from '../../lib/trucksupply'
import Voorraad from './Voorraad'
import Planning from './Planning'
import Beheer from './Beheer'
import Techniek from './Techniek'
import Aanmeldingen from '../../components/Aanmeldingen'
import Cameras from '../../components/Cameras'
import Werkgevers from './Werkgevers'
import Klanten from './Klanten'
import Kassas from './Kassas'
import Vestigingen from './Vestigingen'
import TruckyScherm from '../../components/Trucky'
import OpleidingOverzicht from '../../components/OpleidingOverzicht'
import BerichtVersturen from '../../components/BerichtVersturen'
import Overleg, { useOverlegTeller } from '../../components/Overleg'
import MijnPostvak from '../../components/Postvak'
import Postbus from '../../components/Postbus'
import Agenda from '../../components/Agenda'
import { Start, type Tegel, type TegelTint } from '../../components/Tegels'
import { useNavTarget, usePerms } from '../../store/useNav'
import { startOfDay } from '../../lib/analytics'
import Werk from '../../components/Werk'
import Werving from '../../components/Werving'
import Documenten from '../../components/Documenten'
import type {
  Expense, Fault, InventoryItem, MailBericht, Signup, TruckyContact, User, WashJob,
  Werkgever,
} from '../../lib/types'

const DAY = 86_400_000

const PERIODS = [
  { days: 7, label: '7 dagen' },
  { days: 30, label: '30 dagen' },
  { days: 90, label: '90 dagen' },
]


const ZONDER_PERIODE = [
  'start', 'planning', 'beheer', 'opleiding', 'aanmeldingen', 'overleg', 'postbus',
  'agenda', 'werkgevers', 'kassas', 'vestigingen', 'trucky', 'cameras',
]

export default function ManagementDashboard() {
  const [page, setPage] = useState('start')
  const [days, setDays] = useState(30)
  const [messaging, setMessaging] = useState(false)
  const perms = usePerms()

  const bonnen = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])
  const aanmeldingen = useLiveQuery(() => db.signups.toArray(), [], [] as Signup[])
  const storingen = useLiveQuery(() => db.faults.toArray(), [], [] as Fault[])
  const voorraad = useLiveQuery(() => db.inventory.toArray(), [], [] as InventoryItem[])
  const mensen = useLiveQuery(() => alleMensen(), [], [] as User[])
  const ongelezen = useOverlegTeller()
  const post = useLiveQuery(() => db.mailbox.toArray(), [], [] as MailBericht[])
  const werkgevers = useLiveQuery(() => db.employers.toArray(), [], [] as Werkgever[])
  const viaWebsite = useLiveQuery(
    () => db.truckyContact.toArray(), [], [] as TruckyContact[])

  const jobsVandaag = useLiveQuery(
    async () => {
      const van = startOfDay(Date.now())
      return db.washJobs.where('scheduledAt').between(van, van + DAY, true, false).toArray()
    },
    [],
    [] as WashJob[],
  )

  /*
   * Of de koppeling met Exact staat. Alleen het personeelsscherm wil dat
   * weten, om zijn ophaalknop aan of uit te zetten. Eén keer bij het openen:
   * dit verandert alleen als iemand bij Ontwikkeling iets koppelt, en dat is
   * geen moment waarop dit scherm hoeft mee te kijken.
   */
  const [exactVerbonden, setExactVerbonden] = useState(false)
  useEffect(() => {
    let weg = false
    void exactStatus()
      .then((st) => { if (!weg) setExactVerbonden(st.verbonden === true) })
      /* Geen melding: het scherm zegt zelf wel dat er eerst gekoppeld moet
         worden, en hier komt ook wie geen rechten op die functie heeft. */
      .catch(() => { /* niet verbonden, of geen rechten */ })
    return () => { weg = true }
  }, [])

  const cijfers = useMemo(() => {
    const openKosten = bonnen.filter((b) => b.status === 'open')
    const nieuweAanmeldingen = aanmeldingen.filter((s) => s.status === 'nieuw').length
    const openStoringen = storingen.filter(
      (f) => f.status !== 'opgelost' && f.status !== 'afgewezen')
    const kritiek = openStoringen.filter(
      (f) => f.severity === 'kritiek' || f.stopsProduction).length
    const laag = voorraad.filter((i) => i.stock <= i.minStock).length
    const zonderLogin = mensen.filter(
      (u) => u.active && !u.authId && !u.roles.includes('customer')).length
    const gereed = jobsVandaag.filter((j) => j.status === 'gereed').length

    const nieuwePost = post.filter((m) => m.richting === 'in' && m.status === 'nieuw').length
    const nieuweWerkgevers = werkgevers.filter((w) => w.status === 'aangevraagd').length

    return {
      nieuwePost,
      viaWebsite: viaWebsite.filter((c) => c.status === 'nieuw').length,
      nieuweWerkgevers,
      openKosten: openKosten.length,
      openBedrag: openKosten.reduce((a, b) => a + b.amountExcl, 0),
      nieuweAanmeldingen,
      openStoringen: openStoringen.length,
      kritiek,
      laag,
      zonderLogin,
      gereed,
      vandaag: jobsVandaag.length,
    }
  }, [bonnen, aanmeldingen, storingen, voorraad, mensen, jobsVandaag, post, werkgevers,
      viaWebsite])

  /* ------------------------------------------------------------ *
   *  Eén lijst: het menu, de kop en wat van buitenaf te openen is
   *
   *  Werk, werving en documenten stonden wel in het menu en niet in de
   *  koppen; boven die drie schermen stond dus "Start / Waar wil je heen?".
   *  Zie components/paginas.ts.
   * ------------------------------------------------------------ */
  const paginas: Pagina[] = [
    { key: 'start', label: 'Start', icon: LayoutGrid, sub: 'Waar wil je heen?' },
    /* Het virtuele kantoor: dezelfde schermen, maar dan als plek.
       Welke deuren je daar ziet bepaalt lib/kantoor.ts. */
    { key: 'kantoor', label: 'Het kantoor', icon: DoorOpen,
      sub: 'De lobby: receptie, kantoren en de bibliotheek' },
    /* Direct onder Start: dit is het scherm waar je 's ochtends komt. */
    { key: 'werk', label: 'Werk', icon: ListTodo,
      sub: 'Je taken, het bord en de projecten' },
    { key: 'werving', label: 'Werving', icon: BriefcaseBusiness,
      sub: 'Sollicitaties en vacatures' },
    { key: 'documenten', label: 'Documenten', icon: FolderOpen,
      sub: 'Mappen, het postvak en wat bij jou ligt' },
    { key: 'overzicht', label: 'Overzicht', icon: LayoutDashboard,
      titel: 'Managementoverzicht', sub: 'Omzet, volume en marge' },
    { key: 'financieel', label: 'Financieel', icon: Receipt, badge: cijfers.openKosten,
      sub: 'Kosten valideren en resultaat' },
    { key: 'planning', label: 'Planning', icon: CalendarRange, sub: 'Alle wasopdrachten' },
    { key: 'personeel', label: 'Personeel', icon: Users,
      sub: 'Prestaties, uren en rechten' },
    { key: 'aanmeldingen', label: 'Aanmeldingen', icon: Inbox, recht: 'signups.view',
      badge: cijfers.nieuweAanmeldingen, sub: 'Wie zich via de app heeft aangemeld' },
    { key: 'voorraad', label: 'Voorraad', icon: Package,
      sub: 'Materiaal, verbruik en bestellingen' },
    { key: 'techniek', label: 'Techniek', icon: Wrench, badge: cijfers.kritiek,
      sub: 'Storingen, onderhoud en werkbonnen' },
    { key: 'opleiding', label: 'Opleiding', icon: GraduationCap,
      sub: 'Voortgang van iedereen' },
    { key: 'overleg', label: 'Overleg', icon: MessageSquare, badge: ongelezen,
      recht: 'chat.use', sub: 'Kanalen en gesprekken' },
    /* Persoonlijke post. Geen recht ervoor: iedereen die hier binnenkomt is
       een mens, en of hij een postvak heeft bepaalt het scherm zelf -- dat
       zegt netter waarom er niets staat dan een menu-item dat ontbreekt. */
    { key: 'mijnpost', label: 'Mijn post', icon: Mail,
      sub: 'Je eigen mailadres op het bedrijfsdomein' },
    { key: 'werkgevers', label: 'Klanten', icon: Briefcase, recht: 'employer.view',
      badge: cijfers.nieuweWerkgevers,
      sub: 'Bedrijven waarvan de chauffeurs hier wassen' },
    /*
     * Twee schermen die allebei over klanten gaan, en dat is geen fout.
     * 'werkgevers' zijn de transportbedrijven waarvan de chauffeurs komen
     * wassen; 'klanten' is public.companies, het adres waar de factuur heen
     * gaat. Die twee bestaan naast elkaar en het menu hoort dat te zeggen in
     * plaats van te doen alsof het er een is.
     */
    { key: 'klanten', label: 'Facturatieklanten', icon: Building2, recht: 'customers.view',
      sub: 'De bedrijven waar een factuur heen gaat' },
    { key: 'vestigingen', label: 'Vestigingen', icon: Building2, recht: 'locations.view',
      sub: "Adressen, foto's en openingstijden" },
    { key: 'kassas', label: "Kassa's", icon: Monitor, recht: 'pos.manage',
      sub: 'Apparaten, koppelcodes en de kluis' },
    { key: 'cameras', label: "Camera's", icon: Camera, recht: 'camera.view',
      sub: 'Meekijken op de vestigingen waar je bij mag' },
    { key: 'trucky', label: 'Trucky', icon: Bot, badge: cijfers.viaWebsite,
      sub: 'Vragen via de website, en wat de chatbot zelf beantwoordt' },
    { key: 'agenda', label: 'Agenda', icon: CalendarDays, recht: 'agenda.view',
      sub: 'Afspraken, verjaardagen en wat er aankomt' },
    { key: 'postbus', label: 'Postbus', icon: Mail, recht: 'mail.read',
      badge: cijfers.nieuwePost, sub: 'Post die binnenkomt op het dashboard' },
    { key: 'beheer', label: 'Beheer', icon: Settings,
      sub: 'Instellingen, rechten en gegevens' },
  ]

  const items = menuVan(paginas, (r) => perms.can(r))

  /*
   * De zoekbalk geeft het id van de aangeklikte persoon netjes mee, maar dat
   * werd hier weggegooid: er werd alleen een scherm gekozen. Voor iemand die
   * in de personeelstabel staat viel dat niet op -- die zocht je daar gewoon
   * op. Voor iemand die er NIET in staat wel: de tabel toont alleen de rol
   * "werknemer", dus een klant of werkgever was wel te vinden en niet te
   * openen. En het dossier is de enige plek waar je iemand kunt uitschrijven
   * of wissen. Zo raakte een e-mailadres voorgoed bezet.
   */
  const [openPersoon, setOpenPersoon] = useState<string | null>(null)
  const [openKlant, setOpenKlant] = useState<string | null>(null)

  /*
   * Namen waar iemand anders heen wil, die hier iets anders heten. Geen
   * pagina's van dit dashboard maar wegwijzers: de zoekbalk en de mail kennen
   * "storingen", en dat is hier het techniekscherm.
   */
  const OMWEGEN = ['materiaal', 'storingen', 'werkbonnen', 'installaties', 'onderhoud']

  useNavTarget(
    [...sleutelsVan(paginas, (r) => perms.can(r)), ...OMWEGEN],
    (p, id) => {
      /*
       * 'klanten' ging hier naar 'personeel'. Wie in de zoekbalk een klant
       * aanklikte belandde dus op de personeelslijst, met een company-id dat
       * nooit een dossier-id kan zijn -- en dan gebeurde er niets, zonder
       * melding. Nu is 'klanten' een echt scherm.
       */
      const doel =
        p === 'materiaal' ? 'voorraad' :
        ['storingen', 'werkbonnen', 'installaties', 'onderhoud'].includes(p) ? 'techniek' : p
      setPage(doel)
      setOpenPersoon(doel === 'personeel' ? id ?? null : null)
      setOpenKlant(doel === 'klanten' ? id ?? null : null)
    },
  )

  const meta = kopVan(paginas, page, 'start')
  const showPeriod = !ZONDER_PERIODE.includes(page)

  const tegels: Tegel[] = [
    {
      key: 'overzicht',
      label: 'Overzicht',
      hint: 'Omzet, volume, marge en doorlooptijd',
      icon: LayoutDashboard,
      tint: 'brand',
      stat: `${cijfers.gereed}/${cijfers.vandaag}`,
      statLabel: 'gereed vandaag',
      onClick: () => setPage('overzicht'),
    },
    {
      key: 'financieel',
      label: 'Financieel',
      hint: 'Bonnen valideren en het resultaat',
      icon: Receipt,
      tint: cijfers.openKosten ? 'warn' : 'ok',
      stat: cijfers.openKosten,
      statLabel: cijfers.openKosten
        ? `wacht op akkoord · ${money(cijfers.openBedrag)}`
        : 'alles afgehandeld',
      urgent: cijfers.openKosten > 0,
      onClick: () => setPage('financieel'),
    },
    ...(perms.can('signups.view') ? [{
      key: 'aanmeldingen',
      label: 'Aanmeldingen',
      hint: 'Mensen die zich via de app hebben aangemeld',
      icon: Inbox,
      tint: (cijfers.nieuweAanmeldingen ? 'oranje' : 'neutraal') as TegelTint,
      stat: cijfers.nieuweAanmeldingen,
      statLabel: cijfers.nieuweAanmeldingen === 1 ? 'wacht op je' : 'wachten op je',
      urgent: cijfers.nieuweAanmeldingen > 0,
      onClick: () => setPage('aanmeldingen'),
    }] : []),
    {
      key: 'techniek',
      label: 'Techniek',
      hint: 'Storingen, onderhoud en werkbonnen',
      icon: Wrench,
      tint: cijfers.kritiek ? 'danger' : 'info',
      stat: cijfers.openStoringen,
      statLabel: cijfers.kritiek ? `waarvan ${cijfers.kritiek} kritiek` : 'storingen open',
      urgent: cijfers.kritiek > 0,
      onClick: () => setPage('techniek'),
    },
    {
      key: 'personeel',
      label: 'Personeel',
      hint: 'Dossiers, rechten, uren en vestigingen',
      icon: Users,
      tint: cijfers.zonderLogin ? 'warn' : 'neutraal',
      stat: cijfers.zonderLogin || mensen.filter((u) => u.active).length,
      statLabel: cijfers.zonderLogin ? 'nog zonder inlog' : 'actieve mensen',
      onClick: () => setPage('personeel'),
    },
    {
      key: 'planning',
      label: 'Planning',
      hint: 'Alle wasopdrachten over alle vestigingen',
      icon: CalendarRange,
      tint: 'info',
      stat: cijfers.vandaag,
      statLabel: 'ingepland vandaag',
      onClick: () => setPage('planning'),
    },
    {
      key: 'voorraad',
      label: 'Voorraad',
      hint: 'Materiaal, verbruik en bestellingen',
      icon: Package,
      tint: cijfers.laag ? 'warn' : 'neutraal',
      stat: cijfers.laag,
      statLabel: 'onder het minimum',
      urgent: cijfers.laag > 3,
      onClick: () => setPage('voorraad'),
    },
    ...(perms.can('chat.use') ? [{
      key: 'overleg',
      label: 'Overleg',
      hint: 'Kanalen, vestigingen en gesprekken',
      icon: MessageSquare,
      tint: 'paars' as const,
      stat: ongelezen,
      statLabel: ongelezen === 1 ? 'nieuw bericht' : 'nieuwe berichten',
      urgent: ongelezen > 0,
      onClick: () => setPage('overleg'),
    }] : []),
    ...(perms.can('locations.view') ? [{
      key: 'vestigingen',
      label: 'Vestigingen',
      hint: "Adressen, foto's en openingstijden",
      icon: Building2,
      tint: 'neutraal' as TegelTint,
      onClick: () => setPage('vestigingen'),
    }] : []),
    ...(perms.can('pos.manage') ? [{
      key: 'kassas',
      label: "Kassa's",
      hint: 'Apparaten, koppelcodes en de kluis',
      icon: Monitor,
      tint: 'neutraal' as TegelTint,
      onClick: () => setPage('kassas'),
    }] : []),
    ...(perms.can('employer.view') ? [{
      key: 'werkgevers',
      label: 'Klanten',
      hint: 'Bedrijven waarvan de chauffeurs hier wassen',
      icon: Briefcase,
      tint: (cijfers.nieuweWerkgevers ? 'oranje' : 'neutraal') as TegelTint,
      stat: cijfers.nieuweWerkgevers,
      statLabel: cijfers.nieuweWerkgevers === 1 ? 'wacht op akkoord' : 'wachten op akkoord',
      urgent: cijfers.nieuweWerkgevers > 0,
      onClick: () => setPage('werkgevers'),
    }] : []),
    ...(perms.can('agenda.view') ? [{
      key: 'agenda',
      label: 'Agenda',
      hint: 'Afspraken, verjaardagen en jubilea',
      icon: CalendarDays,
      tint: 'info' as TegelTint,
      onClick: () => setPage('agenda'),
    }] : []),
    ...(perms.can('mail.read') ? [{
      key: 'postbus',
      label: 'Postbus',
      hint: 'Bonnen en post die binnenkomen per mail',
      icon: Mail,
      tint: (cijfers.nieuwePost ? 'oranje' : 'neutraal') as TegelTint,
      stat: cijfers.nieuwePost,
      statLabel: cijfers.nieuwePost === 1 ? 'nieuw bericht' : 'nieuwe berichten',
      urgent: cijfers.nieuwePost > 0,
      onClick: () => setPage('postbus'),
    }] : []),
    {
      key: 'opleiding',
      label: 'Opleiding',
      hint: 'Wie welke cursus heeft gehaald',
      icon: GraduationCap,
      tint: 'neutraal',
      onClick: () => setPage('opleiding'),
    },
    {
      key: 'beheer',
      label: 'Beheer',
      hint: 'Vestigingen, klanten en instellingen',
      icon: Settings,
      tint: 'neutraal',
      onClick: () => setPage('beheer'),
    },
  ]

  return (
    <Shell
      roleLabel="Management"
      items={items}
      active={page}
      onNavigate={setPage}
      title={meta.title}
      subtitle={meta.subtitle}
      actions={
        showPeriod ? (
          <div className="row hide-mobile" style={{ gap: 5 }}>
            {PERIODS.map((p) => (
              <button
                key={p.days}
                className={`btn sm ${days === p.days ? 'primary' : 'ghost'}`}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : undefined
      }
      menu={
        perms.can('notify.send')
          ? [{
              title: 'Versturen',
              items: [{
                key: 'bericht',
                label: 'Bericht sturen',
                hint: 'Naar losse medewerkers of een hele groep',
                icon: <Send size={16} />,
                onClick: () => setMessaging(true),
              }],
            }]
          : undefined
      }
    >
      {page === 'start' && (
        <Start
          tegels={tegels}
          snel={
            perms.can('notify.send') ? (
              <button className="btn sm" onClick={() => setMessaging(true)}>
                <Send size={14} /> Bericht sturen
              </button>
            ) : undefined
          }
        />
      )}
      {page === 'overzicht' && <Overzicht days={days} />}
      {page === 'financieel' && <Financieel days={days} />}
      {page === 'personeel' && (
        <>
          <Personeel days={days} openId={openPersoon} />
          <ExactPersoneel verbonden={exactVerbonden} />
        </>
      )}
      {page === 'aanmeldingen' && <Aanmeldingen />}
      {page === 'voorraad' && <Voorraad days={days} />}
      {page === 'planning' && <Planning />}
      {page === 'techniek' && <Techniek days={days} />}
      {page === 'opleiding' && <OpleidingOverzicht />}
      {page === 'overleg' && <Overleg />}
      {page === 'mijnpost' && <MijnPostvak />}
      {page === 'werk' && <Werk />}
      {page === 'werving' && <Werving />}
      {page === 'documenten' && <Documenten />}
      {page === 'postbus' && <Postbus />}
      {page === 'agenda' && <Agenda />}
      {page === 'werkgevers' && <Werkgevers />}
      {page === 'klanten' && <Klanten openId={openKlant} />}
      {page === 'kassas' && <Kassas />}
      {page === 'vestigingen' && <Vestigingen />}
      {page === 'cameras' && <Cameras />}
      {page === 'trucky' && <TruckyScherm />}
      {page === 'beheer' && <Beheer />}

      <BerichtVersturen open={messaging} onClose={() => setMessaging(false)} />
      {page === 'kantoor' && <Kantoor rol="management" onGa={setPage} />}
    </Shell>
  )
}
