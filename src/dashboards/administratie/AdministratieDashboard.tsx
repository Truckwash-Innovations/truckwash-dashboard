import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Bot, ClipboardCheck, Clock, Inbox, LayoutDashboard, MessageSquare, Receipt,
  ScrollText, Settings, ShoppingCart, Store, Truck, UserPlus, Users, Wallet,
} from 'lucide-react'
import Shell, { type NavItem } from '../../components/Shell'
import { Start, type Tegel } from '../../components/Tegels'
import { db } from '../../lib/db'
import type {
  DossierWijziging, Expense, HourRequest, MailBericht, Signup, TruckyContact,
} from '../../lib/types'
import Kostenposten from './Kostenposten'
import TeVerwerken from './TeVerwerken'
import TruckyScherm from './Trucky'
import Urenverzoeken from '../../components/Urenverzoeken'
import { OpenWijzigingen } from '../../components/Wijzigingen'
import Aanmeldingen from '../management/Aanmeldingen'
import Postbus from '../../components/Postbus'
import Inkoopinstellingen from '../developer/Inkoop'
import Overleg, { useOverlegTeller } from '../../components/Overleg'
import {
  Betalen, Facturen, Grootboek, Relaties, Verkoop,
} from '../developer/Exact'
import { exactStatus } from '../../lib/trucksupply'
import { telStuk, telWerk } from '../../lib/werklijst'
import { useNavTarget, usePerms } from '../../store/useNav'

/* ------------------------------------------------------------------ *
 *  Het administratiedashboard
 *
 *  Eén rode draad: hier staat wat op een beslissing wacht. Kostenposten,
 *  urenwijzigingen, aanpassingen in een dossier en aanmeldingen stonden
 *  verspreid over vier schermen van het management, tussen de grafieken en
 *  de planning door. Wie vier lijsten moet openen om te weten of hij klaar
 *  is, denkt op een gegeven moment dat hij klaar is.
 *
 *  De verbouwing van 1.74
 *  ----------------------
 *
 *  Casper vroeg om een hoofdindeling: Inkoop, Verkoop, Financieel, een
 *  dashboard en de instellingen. En om een rustig menu, "geen twintig
 *  knoppen onder elkaar".
 *
 *  Wat daarvoor is verplaatst: niets. De vier boekhoudschermen (Relaties,
 *  Facturen, Betalen, Verkoop) en het grootboek stonden bij ontwikkeling in
 *  Exact.tsx en staan daar nog steeds; ze zijn geexporteerd en worden hier
 *  ook gerenderd. Een verhuizing van 900 regels naar een tweede kopie is
 *  hoe een SEPA-bestand op twee manieren wordt opgebouwd.
 *
 *  Wat er wel bij is gekomen: 'Te verwerken', de werklijst die zegt wat er
 *  vandaag nog moet gebeuren, en 'Boekhouding' voor de instellingen die tot
 *  nu toe alleen bij ontwikkeling stonden.
 *
 *  Trucky en de aanmeldingen blijven staan. Casper: "Trucky en aanmeldingen
 *  mogen in administratie blijven."
 * ------------------------------------------------------------------ */

const TITELS: Record<string, { title: string; subtitle: string }> = {
  start: { title: 'Te doen', subtitle: 'Alles wat op een beslissing wacht' },
  verwerken: { title: 'Te verwerken', subtitle: 'Wat er binnenkwam en nog een stap nodig heeft' },
  kosten: { title: 'Inkoopfacturen', subtitle: 'Bonnen en facturen beoordelen' },
  postbus: { title: 'Postvak', subtitle: 'Wat er binnenkomt op het inkoopadres' },
  leveranciers: { title: 'Leveranciers', subtitle: 'Wie er factureert, en hoe dat in Exact heet' },
  verkoopfacturen: { title: 'Verkoopfacturen', subtitle: 'Wat wij versturen' },
  betalen: { title: 'Betalen', subtitle: 'Betaalbatches en SEPA-bestanden' },
  grootboek: { title: 'Grootboek', subtitle: 'Het rekeningschema uit Exact' },
  boekhouding: { title: 'Boekhouding', subtitle: 'Hoe facturen worden gelezen, geboekt en goedgekeurd' },
  trucky: { title: 'Trucky', subtitle: 'Vragen via de website, en wat de chatbot zelf beantwoordt' },
  uren: { title: 'Urenwijzigingen', subtitle: 'Correcties op wat er is geklokt' },
  dossiers: { title: 'Dossierwijzigingen', subtitle: 'Wat medewerkers zelf willen aanpassen' },
  aanmeldingen: { title: 'Aanmeldingen', subtitle: 'Wie zich via de app heeft gemeld' },
  overleg: { title: 'Overleg', subtitle: 'Kanalen en gesprekken' },
}

export default function AdministratieDashboard() {
  const [page, setPage] = useState('start')
  /** Welke bon er open moet, als je via een diepe link of de werklijst komt. */
  const [bonId, setBonId] = useState<string | null>(null)
  const perms = usePerms()
  const ongelezen = useOverlegTeller()

  const bonnen = useLiveQuery(() => db.expenses.toArray(), [], [] as Expense[])
  const uren = useLiveQuery(() => db.hourRequests.toArray(), [], [] as HourRequest[])
  const wijzigingen = useLiveQuery(
    () => db.changeRequests.toArray(), [], [] as DossierWijziging[])
  const aanmeldingen = useLiveQuery(() => db.signups.toArray(), [], [] as Signup[])
  const viaWebsite = useLiveQuery(
    () => db.truckyContact.toArray(), [], [] as TruckyContact[])
  const post = useLiveQuery(() => db.mailbox.toArray(), [], [] as MailBericht[])

  /*
   * Of de koppeling met Exact staat. De vier boekhoudschermen willen dat
   * weten om hun ophaalknoppen aan of uit te zetten. Eén keer bij het openen:
   * dit verandert alleen als iemand bij Exact iets koppelt, en dat is geen
   * moment waarop dit scherm hoeft mee te kijken.
   */
  const [verbonden, setVerbonden] = useState(false)
  useEffect(() => {
    let weg = false
    void exactStatus()
      .then((s) => { if (!weg) setVerbonden(s.verbonden === true) })
      /* Geen melding: dit is achtergrondinformatie, en de schermen zeggen
         zelf wel dat er eerst gekoppeld moet worden. */
      .catch(() => { /* niet verbonden, of geen rechten */ })
    return () => { weg = true }
  }, [])

  const wacht = useMemo(() => ({
    /* Beide standen wachten op een mens: 'open' op de eerste handtekening,
       'eerste_akkoord' op de tweede. Alleen de eerste tellen liet de badge op
       nul staan terwijl er werk lag. */
    kosten: bonnen.filter((e) => e.status === 'open' || e.status === 'eerste_akkoord').length,
    // Een bon zonder bedrag is erger dan een bon die op akkoord wacht: daar
    // kun je niets over beslissen tot iemand hem aanvult.
    kaal: bonnen.filter((e) => e.status === 'open' && e.amountExcl === 0).length,
    verwerken: telWerk(bonnen),
    stuk: telStuk(bonnen),
    uren: uren.filter((u) => u.status === 'nieuw').length,
    dossiers: wijzigingen.filter((w) => w.status === 'open').length,
    aanmeldingen: aanmeldingen.filter((s) => s.status === 'nieuw').length,
    trucky: viaWebsite.filter((c) => c.status === 'nieuw').length,
    post: post.filter((m) => m.status === 'nieuw').length,
  }), [bonnen, uren, wijzigingen, aanmeldingen, viaWebsite, post])

  const totaal = wacht.verwerken + wacht.uren + wacht.dossiers + wacht.aanmeldingen

  /* ---------------------------------------------------------------- *
   *  Het menu
   *
   *  Vijf hoofdstukken en drie losse regels, in plaats van de vijftien
   *  knoppen die het anders waren geworden. Een groep zonder kinderen laten
   *  we weg: een kopje "Verkoop" waar niets onder staat omdat je het recht
   *  mist, is erger dan geen kopje.
   * ---------------------------------------------------------------- */
  const magBoekhouden = perms.can('admin.desk')

  const inkoop: NavItem[] = [
    ...(perms.can('expenses.approve')
      ? [{ key: 'kosten', label: 'Inkoopfacturen', icon: Receipt, badge: wacht.kosten || undefined }]
      : []),
    ...(perms.can('mail.read')
      ? [{ key: 'postbus', label: 'Postvak', icon: Inbox, badge: wacht.post || undefined }]
      : []),
    ...(magBoekhouden
      ? [{ key: 'leveranciers', label: 'Leveranciers', icon: Truck }]
      : []),
  ]

  const verkoop: NavItem[] = magBoekhouden
    ? [{ key: 'verkoopfacturen', label: 'Verkoopfacturen', icon: Store }]
    : []

  const financieel: NavItem[] = magBoekhouden
    ? [
      { key: 'betalen', label: 'Betalen', icon: Wallet },
      { key: 'grootboek', label: 'Grootboek', icon: ScrollText },
    ]
    : []

  const personeel: NavItem[] = [
    ...(perms.can('hours.approve')
      ? [{ key: 'uren', label: 'Urenwijzigingen', icon: Clock, badge: wacht.uren || undefined }]
      : []),
    ...(perms.can('staff.view')
      ? [{ key: 'dossiers', label: 'Dossiers', icon: Users, badge: wacht.dossiers || undefined }]
      : []),
    ...(perms.can('signups.view')
      ? [{ key: 'aanmeldingen', label: 'Aanmeldingen', icon: UserPlus,
           badge: wacht.aanmeldingen || undefined }]
      : []),
  ]

  const groep = (key: string, label: string, icon: NavItem['icon'], kinderen: NavItem[]) =>
    (kinderen.length > 0 ? [{ key, label, icon, kinderen }] : [])

  const items: NavItem[] = [
    { key: 'start', label: 'Dashboard', icon: LayoutDashboard, badge: totaal || undefined },
    ...(perms.can('expenses.approve')
      ? [{ key: 'verwerken', label: 'Te verwerken', icon: ClipboardCheck,
           badge: wacht.verwerken || undefined }]
      : []),
    ...groep('inkoop-groep', 'Inkoop', ShoppingCart, inkoop),
    ...groep('verkoop-groep', 'Verkoop', Store, verkoop),
    ...groep('financieel-groep', 'Financieel', Wallet, financieel),
    ...groep('personeel-groep', 'Personeel', Users, personeel),
    { key: 'trucky', label: 'Trucky', icon: Bot, badge: wacht.trucky || undefined },
    ...(perms.can('chat.use')
      ? [{ key: 'overleg', label: 'Overleg', icon: MessageSquare, badge: ongelezen || undefined }]
      : []),
    ...(magBoekhouden
      ? [{ key: 'boekhouding', label: 'Boekhouding', icon: Settings }]
      : []),
  ]

  /*
   * De sleutels waar je heen kunt, inclusief die van het tweede niveau. Een
   * groepskop is geen pagina en hoort er niet in: daar navigeer je niet
   * heen, die vouwt alleen open.
   *
   * En de bon uit de diepe link onthouden. Dit stond hier als
   * `useNavTarget(..., setPage)`, en dan viel het id op de grond -- de mail
   * bracht je naar het juiste scherm maar niet naar de juiste factuur.
   */
  const paginas = useMemo(
    () => items.flatMap((i) => (i.kinderen ? i.kinderen.map((k) => k.key) : [i.key])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.map((i) => i.key).join(','), magBoekhouden],
  )
  useNavTarget(paginas, (p, id) => {
    setPage(p)
    setBonId(id ?? null)
  })

  /* ---------------------------------------------------------------- *
   *  De tegels
   *
   *  Casper: "een dashboard met aanklikbare kaarten." Ze staan in de
   *  volgorde waarin het werk langskomt, en niet op alfabet.
   * ---------------------------------------------------------------- */
  const tegels: Tegel[] = [
    ...(perms.can('expenses.approve') ? [{
      key: 'verwerken',
      label: 'Te verwerken',
      hint: wacht.stuk
        ? `${wacht.stuk} vastgelopen — die komen zonder jou niet verder`
        : 'Wat er binnenkwam en nog een stap nodig heeft',
      icon: ClipboardCheck,
      tint: (wacht.stuk ? 'danger' : wacht.verwerken ? 'oranje' : 'neutraal') as Tegel['tint'],
      stat: wacht.verwerken,
      statLabel: wacht.verwerken === 1 ? 'wacht op jou' : 'wachten op jou',
      urgent: wacht.stuk > 0,
      onClick: () => setPage('verwerken'),
    }] : []),
    ...(perms.can('expenses.approve') ? [{
      key: 'kosten',
      label: 'Inkoopfacturen',
      hint: wacht.kaal
        ? `${wacht.kaal} zonder bedrag — laat de factuur voorlezen`
        : 'Bonnen en facturen beoordelen',
      icon: Receipt,
      tint: (wacht.kosten ? 'oranje' : 'neutraal') as Tegel['tint'],
      stat: wacht.kosten,
      statLabel: wacht.kosten === 1 ? 'wacht op akkoord' : 'wachten op akkoord',
      urgent: wacht.kosten > 0,
      onClick: () => setPage('kosten'),
    }] : []),
    ...(perms.can('mail.read') ? [{
      key: 'postbus',
      label: 'Postvak',
      hint: 'Wat er binnenkomt op het inkoopadres',
      icon: Inbox,
      tint: (wacht.post ? 'info' : 'neutraal') as Tegel['tint'],
      stat: wacht.post,
      statLabel: wacht.post === 1 ? 'nieuw bericht' : 'nieuwe berichten',
      urgent: false,
      onClick: () => setPage('postbus'),
    }] : []),
    ...(magBoekhouden ? [{
      key: 'verkoopfacturen',
      label: 'Verkoopfacturen',
      hint: 'Opmaken, versturen en naar Exact',
      icon: Store,
      tint: 'ok' as Tegel['tint'],
      onClick: () => setPage('verkoopfacturen'),
    }] : []),
    ...(magBoekhouden ? [{
      key: 'betalen',
      label: 'Betalen',
      hint: 'Wat er klaarstaat om over te maken',
      icon: Wallet,
      tint: 'neutraal' as Tegel['tint'],
      onClick: () => setPage('betalen'),
    }] : []),
    ...(perms.can('hours.approve') ? [{
      key: 'uren',
      label: 'Urenwijzigingen',
      hint: 'Wie niet op tijd geklokt heeft vraagt hier een correctie',
      icon: Clock,
      tint: (wacht.uren ? 'oranje' : 'neutraal') as Tegel['tint'],
      stat: wacht.uren,
      statLabel: wacht.uren === 1 ? 'openstaand verzoek' : 'openstaande verzoeken',
      urgent: wacht.uren > 0,
      onClick: () => setPage('uren'),
    }] : []),
    ...(perms.can('staff.view') ? [{
      key: 'dossiers',
      label: 'Dossierwijzigingen',
      hint: 'Een gewijzigd rekeningnummer neem je niet zomaar over',
      icon: Users,
      tint: (wacht.dossiers ? 'oranje' : 'neutraal') as Tegel['tint'],
      stat: wacht.dossiers,
      statLabel: 'te beoordelen',
      urgent: wacht.dossiers > 0,
      onClick: () => setPage('dossiers'),
    }] : []),
    ...(perms.can('signups.view') ? [{
      key: 'aanmeldingen',
      label: 'Aanmeldingen',
      hint: 'Wie zich via de app heeft gemeld',
      icon: UserPlus,
      tint: (wacht.aanmeldingen ? 'oranje' : 'neutraal') as Tegel['tint'],
      stat: wacht.aanmeldingen,
      statLabel: wacht.aanmeldingen === 1 ? 'nieuwe aanmelding' : 'nieuwe aanmeldingen',
      urgent: wacht.aanmeldingen > 0,
      onClick: () => setPage('aanmeldingen'),
    }] : []),
    ...(perms.can('chat.use') ? [{
      key: 'overleg',
      label: 'Overleg',
      hint: 'Kanalen, vestigingen en gesprekken',
      icon: MessageSquare,
      tint: 'paars' as Tegel['tint'],
      stat: ongelezen,
      statLabel: ongelezen === 1 ? 'nieuw bericht' : 'nieuwe berichten',
      urgent: ongelezen > 0,
      onClick: () => setPage('overleg'),
    }] : []),
  ]

  const kop = TITELS[page] ?? TITELS.start

  /** Naar een bon toe, vanuit de werklijst. */
  const openBon = (id: string) => {
    setBonId(id)
    setPage('kosten')
  }

  return (
    <Shell
      roleLabel="Administratie"
      items={items}
      active={page}
      onNavigate={(p) => { setPage(p); setBonId(null) }}
      title={kop.title}
      subtitle={page === 'start' && totaal === 0
        ? 'Er staat niets open. Dat is geen foutmelding.'
        : kop.subtitle}
    >
      {page === 'start' && <Start tegels={tegels} />}

      {page === 'verwerken' && <TeVerwerken onOpen={openBon} />}
      {page === 'kosten' && <Kostenposten openBon={bonId ?? undefined} />}
      {page === 'postbus' && <Postbus />}
      {page === 'leveranciers' && <Relaties verbonden={verbonden} />}

      {page === 'verkoopfacturen' && <Verkoop verbonden={verbonden} />}

      {page === 'betalen' && <Betalen />}
      {page === 'grootboek' && <Grootboek verbonden={verbonden} />}

      {/*
        Geen tweede instellingenscherm. Adressen, de lezer, het automatisch
        goedkeuren, de grootboekrekeningen en de etiketten stonden al in
        Inkoop.tsx bij ontwikkeling, en dat is geen ontwikkelwerk maar
        boekhouding -- het stond daar omdat het daar is ontstaan. Erachter
        hetzelfde scherm, en dus maar een plek waar de vier ogen worden
        ingesteld.

        'Naar Exact' hangt eronder: dat is de laatste stap van een
        inkoopfactuur en hoort bij hoe de boekhouding is ingericht.
      */}
      {page === 'boekhouding' && (
        <>
          <Inkoopinstellingen />
          <Facturen verbonden={verbonden} />
        </>
      )}

      {page === 'trucky' && <TruckyScherm />}
      {page === 'uren' && <Urenverzoeken />}
      {page === 'dossiers' && <OpenWijzigingen />}
      {page === 'aanmeldingen' && <Aanmeldingen />}
      {page === 'overleg' && <Overleg />}
    </Shell>
  )
}
