/**
 * Zelftest van de offline-laag. Draait in Node met een nagebootste
 * IndexedDB, zodat de sync-motor echt getest wordt en niet alleen compileert.
 *
 *   npm run selftest
 */

// De app praat met Supabase; de mock is er alleen nog voor deze test.
process.env.TW_USE_MOCK = '1'

import 'fake-indexeddb/auto'

/* ---- browsertoestand nabootsen -------------------------------------- */

const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
}

let onLine = true
// navigator is in Node alleen-lezen: eigenschap vervangen i.p.v. toewijzen
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  get: () => ({ onLine }),
})
const setOnline = (v: boolean) => { onLine = v }

;(globalThis as any).window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
}

/* ---- test-hulpjes --------------------------------------------------- */

let passed = 0
let failed = 0

function check(name: string, ok: boolean, extra = '') {
  if (ok) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`)
  }
}

/* ====================================================================
 *  0. Draait deze test op hetzelfde gereedschap als de CI
 *
 *  Dit hoofdstuk staat vooraan omdat het alle andere ongeldig maakt als het
 *  faalt.
 *
 *  Wat er gebeurde: package.json staat op typescript ^7.0.2 en de lockfile
 *  op precies 7.0.2, maar in node_modules stond hier nog 5.9.3. Lokaal gaf
 *  `npm run build` dus groen licht, en de release viel om op een fout die
 *  5.9 nog liet lopen en 7.0 niet: een type-import en een component met
 *  dezelfde naam in een bestand.
 *
 *  Een lokale controle die zwakker is dan die van de CI is erger dan geen
 *  controle -- je denkt dat je hebt nagekeken. Vandaar deze: wat er
 *  geinstalleerd staat moet zijn wat de lockfile zegt.
 *
 *  Alleen de compiler, niet alle pakketten: dit gaat over de vraag of de
 *  toets die je net hebt gedaan iets waard is.
 * ==================================================================== */

console.log('\n0. Draait deze test op hetzelfde gereedschap als de CI')

{
  const { readFileSync } = await import('node:fs')
  const lees = (pad: string) => JSON.parse(readFileSync(pad, 'utf8'))

  const lock = lees('package-lock.json')
  const wachters = ['typescript', 'vite', 'tsx']

  for (const naam of wachters) {
    const uitLock = lock.packages?.[`node_modules/${naam}`]?.version
    let uitMap: string | null = null
    try {
      uitMap = lees(`node_modules/${naam}/package.json`).version
    } catch {
      uitMap = null
    }

    if (!uitLock) {
      check(`${naam} staat in de lockfile`, false, 'niet gevonden')
      continue
    }
    check(`${naam} ${uitLock} is ook wat er geinstalleerd staat`,
      uitMap === uitLock, `lockfile ${uitLock}, node_modules ${uitMap ?? 'niets'}`)
  }
}

/* ---- modules ophalen na het opzetten van de globals ------------------ */

const { db } = await import('../src/lib/db')
const { api } = await import('../src/lib/api')
const { setForcedOffline } = await import('../src/lib/api/mockApi')
const { useSync } = await import('../src/lib/sync')
const { jobs, expenses, inventory } = await import('../src/lib/repo')

const sync = () => useSync.getState().sync()

/* ==================================================================== */

console.log('\n1. Eerste synchronisatie vult de lokale cache')
await sync()

const userCount = await db.users.count()
const jobCount = await db.washJobs.count()
const invCount = await db.inventory.count()
const expCount = await db.expenses.count()

check('gebruikers opgehaald', userCount > 40, `kreeg ${userCount}`)
check('wasopdrachten opgehaald', jobCount > 400, `kreeg ${jobCount}`)
check('voorraad opgehaald per vestiging', invCount === 19 * 8, `kreeg ${invCount}`)
// Drie ervan komen uit de postbus: een mail met bijlage levert een bon op.
check('kostenposten opgehaald', expCount === 49, `kreeg ${expCount}`)
check('geen sync-fout', useSync.getState().lastError === null, String(useSync.getState().lastError))
check('wachtrij leeg', useSync.getState().pending === 0)

/* ==================================================================== */

console.log('\n2. Inloggen')
const good = await api.login('manager@truckwash1group.nl', 'manager')
const badPw = await api.login('manager@truckwash1group.nl', 'fout')
const noUser = await api.login('niemand@nergens.nl', 'x')

check('juist wachtwoord geeft sessie', good?.userId === 'u_manager')
check('fout wachtwoord wordt geweigerd', badPw === null)
check('onbekend account wordt geweigerd', noUser === null)

/* ==================================================================== */

console.log('\n3. Offline schrijven belandt in de wachtrij')
setOnline(false)
setForcedOffline(true)

const company = (await db.companies.toArray())[0]
const locaties = await db.locations.toArray()
const created = await jobs.create({
  locationId: locaties.find((l) => l.kind === 'vestiging')!.id,
  companyId: company.id,
  companyName: company.name,
  plate: 'test-01',
  service: 'combi',
  scheduledAt: Date.now() + 3_600_000,
  createdBy: 'u_klant',
  discountPct: company.contractDiscountPct,
})

const localJob = await db.washJobs.get(created!.id)
check('afspraak staat direct in de lokale cache', !!localJob)
check('kenteken genormaliseerd', localJob?.plate === 'TEST-01', localJob?.plate)

await expenses.create({
  locationId: locaties.find((l) => l.kind === 'vestiging')!.id,
  date: Date.now(),
  category: 'materiaal',
  supplier: 'Zelftest BV',
  description: 'Offline ingediend',
  amountExcl: 123.45,
  vatPct: 21,
  submittedBy: 'u_wasser',
  submittedByName: 'Tom Verhoeven',
})

const item = (await db.inventory.toArray())[0]
const stockBefore = item.stock
await inventory.adjust({
  itemId: item.id,
  qty: -5,
  reason: 'Zelftest verbruik',
  user: { id: 'u_wasser', name: 'Tom Verhoeven' },
})
const stockAfter = (await db.inventory.get(item.id))!.stock

check('voorraad direct bijgewerkt', stockAfter === stockBefore - 5, `${stockBefore} -> ${stockAfter}`)

const queued = await db.outbox.count()
check('wijzigingen staan in de wachtrij', queued === 4, `kreeg ${queued}`)

// een mislukte sync mag de wachtrij niet legen
await sync()
check('offline sync meldt een fout', useSync.getState().lastError !== null)
check('wachtrij blijft intact na mislukte sync', (await db.outbox.count()) === 4)

/*
 * En blijft intact als de SERVER hem weigert, hoe vaak dat ook gebeurt.
 *
 * Dit is een ander geval dan hierboven. Offline komt het niet eens tot een
 * poging: de ronde stopt bij ping() en de teller blijft op nul. Weigert de
 * server daarentegen het record zelf, dan werd er wél geteld -- en na acht
 * keer werd de wijziging weggegooid.
 *
 * Dat kostte een nieuwe medewerker: aangemaakt, in de wachtrij gezet, acht
 * keer geweigerd, weg. Het scherm zei "staat erin", de lijst toonde hem, en
 * de server kende hem niet. Bij het uitnodigen was er niets meer om terug te
 * sturen, en de melding luidde "dossier niet gevonden".
 *
 * Daarom gaat de verbinding hier weer aan en laten we alleen het versturen
 * weigeren. Twintig rondes is ruim over de oude grens van acht.
 */
setOnline(true)
setForcedOffline(false)
const pushVoorProef = api.push
api.push = async () => { throw new Error('proef: de server weigert dit') }

for (let i = 0; i < 20; i++) await sync()

api.push = pushVoorProef

const naVeelPogingen = await db.outbox.count()
check('een geweigerde wijziging wordt niet meer weggegooid', naVeelPogingen === 4,
  `kreeg ${naVeelPogingen} van de 4 — er is werk verdwenen`)

const pogingen = (await db.outbox.toArray()).map((r) => r.tries)
check('de pogingen worden geteld, zodat je ziet dat het vastloopt',
  pogingen.every((n) => n > 8), `pogingen: ${pogingen.join(', ')}`)

check('en bij elke regel staat waarom het niet lukt',
  (await db.outbox.toArray()).every((r) => !!r.lastError))

setOnline(false)
setForcedOffline(true)

/* ==================================================================== */

console.log('\n4. Terug online: de wachtrij wordt verstuurd')
setOnline(true)
setForcedOffline(false)
await sync()

check('wachtrij is leeg', (await db.outbox.count()) === 0)
check('geen sync-fout meer', useSync.getState().lastError === null, String(useSync.getState().lastError))

// controleren dat het echt op de "server" staat: een lege client, opnieuw pullen
await db.washJobs.clear()
await db.meta.clear()
useSync.setState({ lastSyncAt: null })
await sync()

const fromServer = await db.washJobs.get(created!.id)
check('afspraak staat op de server', !!fromServer, 'niet teruggevonden na volledige pull')
check('server kent hetzelfde kenteken', fromServer?.plate === 'TEST-01')

/* ==================================================================== */

console.log('\n5. Laatste wijziging wint binnen de wachtrij')
setForcedOffline(true)
setOnline(false)

await jobs.setStatus(created!.id, 'wachtrij')
await jobs.setStatus(created!.id, 'bezig')
await jobs.setStatus(created!.id, 'gereed')

const collapsed = await db.outbox.where('recordId').equals(created!.id).count()
check('drie bewerkingen zijn tot één samengevoegd', collapsed === 1, `kreeg ${collapsed}`)

setForcedOffline(false)
setOnline(true)
await sync()

await db.washJobs.clear()
await db.meta.clear()
useSync.setState({ lastSyncAt: null })
await sync()

const finalJob = await db.washJobs.get(created!.id)
check('eindstatus correct doorgezet', finalJob?.status === 'gereed', finalJob?.status)

/* ==================================================================== */

console.log('\n6. Lokale wijziging wordt niet overschreven door een pull')
setForcedOffline(true)
setOnline(false)
await jobs.update(created!.id, { notes: 'lokaal, nog niet verstuurd' })

setForcedOffline(false)
setOnline(true)
// pull-only afdwingen door de outbox even te parkeren
const parked = await db.outbox.toArray()
check('wijziging staat nog in de wachtrij', parked.length === 1)

await sync()
const merged = await db.washJobs.get(created!.id)
check('notitie overleeft de synchronisatie', merged?.notes === 'lokaal, nog niet verstuurd', merged?.notes)

/* ==================================================================== */

console.log('\n7. Analyse-functies')
const { managementKpis, seriesByDay, staffPerformance, inventoryHealth } =
  await import('../src/lib/analytics')

const allJobs = await db.washJobs.toArray()
const allExp = await db.expenses.toArray()
const allUsers = await db.users.toArray()
const allTime = await db.timeEntries.toArray()
const allInv = await db.inventory.toArray()

const k = managementKpis(allJobs, allExp, 30)
const s = seriesByDay(allJobs, allExp, 30)
const staff = staffPerformance(allUsers, allJobs, allTime, 30)
const health = inventoryHealth(allInv)

check('omzet is positief', k.omzet.value > 0, String(k.omzet.value))
check('kosten zijn positief', k.kosten.value > 0, String(k.kosten.value))
check('marge klopt met omzet minus kosten',
  Math.abs(k.marge.value - (k.omzet.value - k.kosten.value)) < 0.01)
check('grafiekreeks heeft 30 dagen', s.length === 30, String(s.length))
check('reeks telt op tot de omzet-kpi',
  Math.abs(s.reduce((a, b) => a + b.omzet, 0) - k.omzet.value) < 1)
check('personeelsoverzicht gevuld', staff.length > 40, String(staff.length))
check('voorraadwaarde berekend', health.waarde > 0, String(health.waarde))
check('lage voorraad gedetecteerd', Array.isArray(health.low))

/* ==================================================================== */

console.log('\n8. Vertaallaag naar Postgres (Supabase-adapter)')
const { toRow, fromRow } = await import('../src/lib/api/supabaseApi')

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const job = {
  id: 'job_1', ticket: 'W1001', companyId: 'co_jansen', companyName: 'Jansen',
  plate: '12-BND-4', service: 'combi', status: 'gereed',
  assignedTo: 'u_1', assignedName: 'Tom', scheduledAt: 1_700_000_000_000,
  startedAt: 1_700_000_100_000, completedAt: undefined,
  priceExcl: 99, notes: undefined, createdBy: 'u_2', updatedAt: 123,
}
const row = toRow('washJobs', job)

check('camelCase wordt snake_case',
  row.company_id === 'co_jansen' && row.scheduled_at === job.scheduledAt)
check('undefined-velden gaan niet mee',
  !('completed_at' in row) && !('notes' in row))
check('updated_at laat de server zelf zetten', !('updated_at' in row))
check('heen en terug levert hetzelfde op',
  eq(
    fromRow('washJobs', row),
    Object.fromEntries(
      Object.entries(job).filter(([k, v]) => v !== undefined && k !== 'updatedAt'),
    ),
  ))

// Uitzonderingen: "end" is een gereserveerd woord in SQL, "date" een typenaam
const teRow = toRow('timeEntries', { id: 't1', userId: 'u1', start: 10, end: 20, note: 'x' })
check('timeEntries.start wordt started_at', teRow.started_at === 10 && !('start' in teRow))
check('timeEntries.end wordt ended_at', teRow.ended_at === 20 && !('end' in teRow))
check('en weer terug',
  eq(fromRow('timeEntries', teRow), { id: 't1', userId: 'u1', start: 10, end: 20, note: 'x' }))

const expRow = toRow('expenses', { id: 'e1', date: 555, amountExcl: 10, vatPct: 21 })
check('expenses.date wordt expense_date', expRow.expense_date === 555 && !('date' in expRow))
check('en weer terug', (fromRow('expenses', expRow) as Record<string, unknown>).date === 555)

check('null uit Postgres wordt weggelaten',
  !('notes' in fromRow('washJobs', { id: 'j', notes: null, price_excl: 5 })))

/* ==================================================================== */

console.log('\n9. Niet synchroniseren zonder sessie')
// Een echte backend geeft een niet-ingelogde bezoeker niets terug. Zou de app
// dan toch de teller bijzetten, dan denkt hij na het inloggen dat hij bij is
// en blijft de cache leeg -- precies de bug die dit voorkomt.
const { setSyncEnabled, LAST_SYNC } = await import('../src/lib/sync')
const { getMeta, setMeta } = await import('../src/lib/db')

setSyncEnabled(false)
await setMeta(LAST_SYNC, 0)

await jobs.update(created!.id, { notes: 'gemaakt terwijl uitgelogd' })
const queuedWhileLoggedOut = await db.outbox.count()
await sync()

check('sync doet niets zonder sessie', (await db.outbox.count()) === queuedWhileLoggedOut)
check('de teller blijft op nul staan', (await getMeta(LAST_SYNC, -1)) === 0,
  String(await getMeta(LAST_SYNC, -1)))

setSyncEnabled(true)
await sync()

check('na inloggen loopt de wachtrij alsnog leeg', (await db.outbox.count()) === 0)
check('en staat de teller op de servertijd', (await getMeta(LAST_SYNC, 0)) > 0)

/* --- een verlopen sessie mag geen werk kosten --- */

/*
 * Dit ging mis in het echt: iemand logt zonder internet in, of een oude
 * sessie wordt hersteld terwijl de sleutel allang is verlopen. Elk verzoek
 * gaat dan als onbekende bezoeker naar de database, die alles weigert met
 * een melding over beveiligingsregels. Acht rondes later was de wijziging
 * weggegooid -- om een reden die niets met die wijziging te maken had.
 */
const { GeenSessie } = await import('../src/lib/api/supabaseApi')
const { useSync: syncStore } = await import('../src/lib/sync')

await jobs.update(created!.id, { notes: 'gemaakt terwijl de sessie weg was' })
const inDeWachtrij = await db.outbox.count()
check('er staat iets klaar om te versturen', inDeWachtrij > 0)

const echtePush = api.push.bind(api)
api.push = async () => { throw new GeenSessie() }

for (let ronde = 0; ronde < 10; ronde++) await sync()

check('zonder sessie blijft de wachtrij staan',
  (await db.outbox.count()) === inDeWachtrij, String(await db.outbox.count()))
check('en kost het geen pogingen -- ook niet na tien rondes',
  (await db.outbox.toArray()).every((r) => r.tries === 0),
  (await db.outbox.toArray()).map((r) => r.tries).join(','))
check('de app zegt dat je opnieuw moet inloggen', syncStore.getState().sessieWeg)

api.push = echtePush
await sync()

check('na opnieuw inloggen gaat het alsnog mee', (await db.outbox.count()) === 0)
check('en is de melding weg', !syncStore.getState().sessieWeg)

// Volledige pull na het inloggen: teller op 0 en de cache moet weer vullen.
await db.washJobs.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('een volledige pull vult de cache opnieuw', (await db.washJobs.count()) > 400,
  String(await db.washJobs.count()))

/* ==================================================================== */

console.log('\n10. Rooster')
const { shifts: shiftRepo } = await import('../src/lib/repo')
const { shiftHours, weekStart, shiftsOnDay, totalHours } = await import('../src/lib/roster')

check('rooster opgehaald', (await db.shifts.count()) > 100, String(await db.shifts.count()))

// maandag 00:00 van deze week
const ws = weekStart(Date.now())
const wsDate = new Date(ws)
check('weekStart geeft maandag 00:00',
  wsDate.getDay() === 1 && wsDate.getHours() === 0 && wsDate.getMinutes() === 0,
  wsDate.toString())

// netto uren: 07:00-15:30 met 30 min pauze = 8 uur
check('uren tellen de pauze eraf',
  shiftHours({
    id: 'x', userId: 'u', userName: '', kind: 'dienst',
    startAt: ws + 7 * 3_600_000, endAt: ws + 15.5 * 3_600_000,
    breakMinutes: 30, createdBy: 'u', updatedAt: 0,
  }) === 8)

check('verlof telt niet als gewerkte uren',
  shiftHours({
    id: 'x', userId: 'u', userName: '', kind: 'verlof',
    startAt: ws, endAt: ws + 86_400_000, breakMinutes: 0, createdBy: 'u', updatedAt: 0,
  }) === 0)

// een dienst inplannen, offline, en kijken of hij aankomt
setForcedOffline(true)
setOnline(false)

const nieuweDienst = await shiftRepo.create({
  user: { id: 'u_wasser', name: 'Tom Verhoeven' },
  kind: 'dienst',
  startAt: ws + 21 * 86_400_000 + 7 * 3_600_000,
  endAt: ws + 21 * 86_400_000 + 15.5 * 3_600_000,
  breakMinutes: 30,
  note: 'Zelftest',
  createdBy: 'u_manager',
})

check('dienst staat direct in de lokale cache', !!(await db.shifts.get(nieuweDienst!.id)))
check('dienst wacht op verzending',
  (await db.outbox.where('recordId').equals(nieuweDienst!.id).count()) === 1)

setForcedOffline(false)
setOnline(true)
await sync()

await db.shifts.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('dienst staat op de server', !!(await db.shifts.get(nieuweDienst!.id)))

// dag- en weektotalen
const tomShifts = (await db.shifts.toArray()).filter((s) => s.userId === 'u_wasser')
const weekVanTom = tomShifts.filter((s) => s.startAt >= ws && s.startAt < ws + 7 * 86_400_000)
check('weektotaal is een redelijk aantal uren',
  totalHours(weekVanTom) >= 0 && totalHours(weekVanTom) <= 60,
  String(totalHours(weekVanTom)))
check('diensten per dag worden gefilterd',
  shiftsOnDay(tomShifts, ws).every((s) => s.startAt >= ws && s.startAt < ws + 86_400_000))

// verwijderen moet ook op de server doorkomen
await shiftRepo.remove(nieuweDienst!.id)
check('lokaal verwijderd', !(await db.shifts.get(nieuweDienst!.id)))
await sync()
await db.shifts.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('ook op de server verwijderd', !(await db.shifts.get(nieuweDienst!.id)))

/* ==================================================================== */

console.log('\n11. Medewerker toevoegen')
const { users: userRepo } = await import('../src/lib/repo')

const nieuw = await userRepo.create({
  name: 'Testpersoon Zelftest',
  email: 'Test.Persoon@Truckwash1group.NL',
  roles: ['employee'],
  personnelNumber: 'TW-999',
  phone: '06-11111111',
  function: 'Wasmedewerker',
  hourlyRate: 21.5,
  contractHours: 32,
  startDate: Date.now(),
})

check('e-mailadres wordt genormaliseerd',
  nieuw!.email === 'test.persoon@truckwash1group.nl', nieuw!.email)
check('nog geen inlogaccount gekoppeld', nieuw!.authId === undefined)
check('personeelsvelden bewaard',
  nieuw!.personnelNumber === 'TW-999' && nieuw!.contractHours === 32)

await sync()
await db.users.clear()
await setMeta(LAST_SYNC, 0)
await sync()

const opgehaald = await db.users.get(nieuw!.id)
check('medewerker staat op de server', !!opgehaald)
check('functie overleeft de rondgang', opgehaald?.function === 'Wasmedewerker', opgehaald?.function)

/* ==================================================================== */

console.log('\n12. Wisselen van backend laat geen oude gegevens achter')
const { ensureBackendMatches } = await import('../src/lib/sync')

// Doen alsof de vorige sessie tegen een andere server draaide.
await setMeta('backend', 'een-andere-server')
await jobs.update(created!.id, { notes: 'mag niet blijven staan' })
check('er staat iets in de cache en in de wachtrij',
  (await db.washJobs.count()) > 0 && (await db.outbox.count()) > 0)

const gewist = await ensureBackendMatches()

check('meldt dat er gewist is', gewist === true)
check('wasopdrachten weg', (await db.washJobs.count()) === 0)
check('medewerkers weg', (await db.users.count()) === 0)
check('rooster weg', (await db.shifts.count()) === 0)
check('wachtrij weg', (await db.outbox.count()) === 0,
  'wijzigingen voor een andere server zijn onbruikbaar')
check('teller teruggezet', (await getMeta(LAST_SYNC, -1)) === 0)

// Tweede keer met dezelfde backend: niets meer te wissen.
await sync()
const naHerstel = await db.washJobs.count()
check('daarna vult de juiste backend de cache weer', naHerstel > 400, String(naHerstel))
check('geen tweede wisbeurt', (await ensureBackendMatches()) === false)
check('gegevens blijven staan', (await db.washJobs.count()) === naHerstel)

/* ==================================================================== */

console.log('\n13. Rechten per persoon')
const { can, effectivePermissions, togglePermission, wouldLockOut, ROLE_DEFAULTS } =
  await import('../src/lib/permissions')
const { PERMISSIONS } = await import('../src/lib/types')

const wasser = (await db.users.get('u_wasser'))!
const voorman = (await db.users.get('u_wasser3'))!
const manager = (await db.users.get('u_manager'))!

check('werknemer mag wagens oppakken', can(wasser, 'jobs.claim'))
check('werknemer mag geen bonnen goedkeuren', !can(wasser, 'expenses.approve'))
check('werknemer ziet geen loongegevens', !can(wasser, 'staff.pay'))
check('leidinggevende mag het rooster maken', can(voorman, 'roster.edit'))
check('leidinggevende mag berichten sturen', can(voorman, 'notify.send'))
check('leidinggevende mag geen rechten uitdelen', !can(voorman, 'staff.permissions'))
check('management mag alles', effectivePermissions(manager).size === PERMISSIONS.length)
check('geblokkeerd account mag niets',
  effectivePermissions({ ...wasser, active: false }).size === 0)

// Losse afwijkingen: alleen het verschil met de rol wordt bewaard
const extra = togglePermission(wasser, 'finance.view', true)
check('extra recht komt in grants',
  extra.grants.includes('finance.view') && extra.revokes.length === 0)
check('het werkt ook echt',
  can({ ...wasser, ...extra }, 'finance.view'))

const minder = togglePermission(wasser, 'jobs.claim', false)
check('ingetrokken rolrecht komt in revokes',
  minder.revokes.includes('jobs.claim') && minder.grants.length === 0)
check('en is daarna weg', !can({ ...wasser, ...minder }, 'jobs.claim'))

const terug = togglePermission({ ...wasser, ...minder }, 'jobs.claim', true)
check('weer aanzetten laat niets achter',
  terug.grants.length === 0 && terug.revokes.length === 0)

check('intrekken wint van toekennen',
  !can({ ...wasser, grants: ['finance.view'], revokes: ['finance.view'] }, 'finance.view'))

// Niemand mag zichzelf buitensluiten
const alleUsers = await db.users.toArray()
const zonderRechten = togglePermission(manager, 'staff.permissions', false)
const managers = alleUsers.filter((u) => u.active && u.roles.includes('management'))
check('meerdere managers: uitzetten mag',
  managers.length < 2 || !wouldLockOut(alleUsers, manager, zonderRechten))
check('laatste rechtenbeheerder wordt beschermd',
  wouldLockOut([manager], manager, zonderRechten))

/*
 * Elke rol hoort een standaardset rechten te hebben.
 *
 * Stond hier als `=== 7`. Dat klopte tot er een achtste rol bij kwam, en dan
 * valt de test om terwijl er niets mis is -- de rol was juist netjes
 * toegevoegd. Nu vergelijken we met de lijst rollen zelf, dus mist er echt
 * iets als dit rood wordt: een rol die bestaat maar geen rechten heeft.
 */
const { ROLE_ORDER } = await import('../src/lib/types')
const zonderStandaard = ROLE_ORDER.filter((r) => !(r in ROLE_DEFAULTS))
check('elke rol heeft een standaardset', zonderStandaard.length === 0,
  zonderStandaard.length
    ? 'geen standaardset voor: ' + zonderStandaard.join(', ')
    : Object.keys(ROLE_DEFAULTS).join(', '))

/* ==================================================================== */

console.log('\n14. Smartroster')
const { planWeek, patternOf } = await import('../src/lib/smartRoster')

const alleShifts = await db.shifts.toArray()
const alleJobs = await db.washJobs.toArray()
const medewerkers = alleUsers.filter((u) => u.active && u.roles.includes('employee'))

const patroon = patternOf(alleShifts, 'u_wasser')
check('patroon herkent gewerkte dagen', patroon.sampleSize > 0, String(patroon.sampleSize))
check('gewone begintijd is een reële tijd',
  patroon.usualStart >= 5 && patroon.usualStart <= 12, String(patroon.usualStart))
check('gewone eindtijd ligt na de begintijd', patroon.usualEnd > patroon.usualStart)

const volgendeWeek = weekStart(Date.now()) + 7 * 86_400_000
const plan = planWeek({ staff: medewerkers, shifts: alleShifts, jobs: alleJobs, weekStart: volgendeWeek })

check('plan levert een samenvatting per persoon',
  plan.summary.length === medewerkers.filter((u) => (u.contractHours ?? 0) > 0).length)
check('elk voorstel heeft een reden',
  plan.proposals.every((p) => p.reason.length > 0))
check('geen voorstel op zondag',
  plan.proposals.every((p) => new Date(p.day).getDay() !== 0))
check('geen dienst korter dan drie uur',
  plan.proposals.every((p) => p.hours >= 3), 'kortste: ' +
    Math.min(...plan.proposals.map((p) => p.hours), 99))
// De planner mag niets toevoegen aan wie al aan zijn uren zit, en waar hij
// wel bijplant moet het totaal binnen het contract blijven. Wat er al stond
// kan hoger zijn -- dat meldt hij als opmerking, maar hij verergert het niet.
check('planner voegt niets toe aan wie al vol zit',
  plan.summary.every((s) => s.plannedHours >= s.contractHours - 0.5 ? s.proposedHours === 0 : true),
  plan.summary.map((s) => `${s.userName}:${s.plannedHours}+${s.proposedHours}/${s.contractHours}`).join(' '))
check('waar hij bijplant blijft het binnen het contract',
  plan.summary.every((s) => s.proposedHours === 0 || s.plannedHours + s.proposedHours <= s.contractHours + 2),
  plan.summary.filter((s) => s.proposedHours > 0)
    .map((s) => `${s.userName}:${s.plannedHours + s.proposedHours}/${s.contractHours}`).join(' '))
check('te veel ingeroosterd wordt gemeld',
  plan.summary.filter((s) => s.plannedHours > s.contractHours + 2).every((s) => !!s.note))
check('geen twee voorstellen op dezelfde dag voor dezelfde persoon',
  new Set(plan.proposals.map((p) => p.userId + ':' + p.day)).size === plan.proposals.length)
check('voorstellen vallen binnen de openingstijden',
  plan.proposals.every((p) => {
    const from = new Date(p.startAt).getHours()
    const till = new Date(p.endAt).getHours()
    return from >= 6 && till <= 19
  }))

/* ==================================================================== */

console.log('\n15. Berichten en opleiding')
const { notifications: notifyRepo, learning } = await import('../src/lib/repo')

const bericht = await notifyRepo.send({
  to: { id: 'u_wasser', name: 'Tom Verhoeven' },
  from: { id: 'u_wasser3', name: 'Nour El Amrani' },
  kind: 'taak',
  title: 'Zelftest',
  body: 'Een bericht uit de test',
})
check('bericht staat lokaal', !!(await db.notifications.get(bericht!.id)))
check('bericht is ongelezen', !(await db.notifications.get(bericht!.id))!.readAt)

await notifyRepo.markRead(bericht!.id)
check('gelezen zetten werkt', !!(await db.notifications.get(bericht!.id))!.readAt)

const groeps = await notifyRepo.broadcast({
  role: 'employee',
  from: { id: 'u_manager', name: 'Ilse Bakker' },
  kind: 'info',
  title: 'Groepsbericht',
  body: 'Voor iedereen',
})
check('groepsbericht richt zich op een rol',
  (await db.notifications.get(groeps!.id))!.toRole === 'employee')

await sync()
await db.notifications.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('berichten staan op de server', !!(await db.notifications.get(bericht!.id)))

// Opleiding: toets afleggen
const cursus = (await db.courses.toArray())[0]
check('cursussen zijn gesynchroniseerd', !!cursus)

await learning.start({ id: 'u_wasser', name: 'Tom Verhoeven' }, cursus.id)
const voortgangId = 'u_wasser__' + cursus.id
await learning.submitQuiz(voortgangId, 60, cursus.passScore, cursus.validMonths)
const gezakt = await db.courseProgress.get(voortgangId)
check('te lage score is niet geslaagd', gezakt?.passed === false, String(gezakt?.score))

await learning.submitQuiz(voortgangId, 100, cursus.passScore, cursus.validMonths)
const geslaagd = await db.courseProgress.get(voortgangId)
check('voldoende score is geslaagd', geslaagd?.passed === true)
check('pogingen worden geteld', geslaagd?.attempts === 2, String(geslaagd?.attempts))
check('geldigheid wordt gezet',
  cursus.validMonths ? (geslaagd?.expiresAt ?? 0) > Date.now() : geslaagd?.expiresAt === undefined)

/* ==================================================================== */

console.log('\n16. Vestigingen')
const { scopeOf, seesAllLocations, withinScope, filterByLocation, visibleLocations } =
  await import('../src/lib/locations')

const alleLocaties = await db.locations.toArray()
const hoofdkantoor = alleLocaties.find((l) => l.kind === 'hoofdkantoor')!
const filialen = alleLocaties.filter((l) => l.kind === 'vestiging')

check('negentien vestigingen plus hoofdkantoor',
  filialen.length === 19 && !!hoofdkantoor, `${filialen.length} vestigingen`)
check('elke vestiging heeft een unieke code',
  new Set(alleLocaties.map((l) => l.code)).size === alleLocaties.length)

const hkUser = (await db.users.get('u_manager'))!
const voormanUtr = (await db.users.get('u_wasser3'))!
const wasserUtr = (await db.users.get('u_wasser'))!

check('hoofdkantoor ziet alles', seesAllLocations(hkUser))
check('een wasser niet', !seesAllLocations(wasserUtr))

const scopeVoorman = scopeOf(voormanUtr)
check('leidinggevende ziet zijn eigen vestigingen',
  scopeVoorman !== 'alle' && scopeVoorman.has('loc_utr') && scopeVoorman.has('loc_ams'),
  JSON.stringify([...(scopeVoorman === 'alle' ? [] : scopeVoorman)]))
check('en niet die van een ander',
  scopeVoorman !== 'alle' && !scopeVoorman.has('loc_rtm'))

const scopeWasser = scopeOf(wasserUtr)
check('een wasser ziet alleen zijn eigen vestiging',
  scopeWasser !== 'alle' && scopeWasser.size === 1 && scopeWasser.has('loc_utr'))

check('hoofdkantoor ziet alle vestigingen in de kiezer',
  visibleLocations(hkUser, alleLocaties).length === alleLocaties.length)
check('leidinggevende ziet er drie',
  visibleLocations(voormanUtr, alleLocaties).length === 3,
  String(visibleLocations(voormanUtr, alleLocaties).length))

// Voorraad is per vestiging: filteren mag nooit meer opleveren dan je mag zien
const alleVoorraad = await db.inventory.toArray()
const voorraadWasser = withinScope(wasserUtr, alleVoorraad)
check('wasser ziet alleen de voorraad van zijn vestiging',
  voorraadWasser.length > 0 && voorraadWasser.every((i) => i.locationId === 'loc_utr'),
  `${voorraadWasser.length} artikelen`)
check('hoofdkantoor ziet alle voorraad',
  withinScope(hkUser, alleVoorraad).length === alleVoorraad.length)

// De keuze bovenin versmalt verder, maar kan nooit verbreden
const gekozenRotterdam = filterByLocation(voormanUtr, alleVoorraad, 'loc_rtm')
check('een vestiging kiezen waar je niet mag geeft niets',
  gekozenRotterdam.length === 0)
const gekozenAmsterdam = filterByLocation(voormanUtr, alleVoorraad, 'loc_ams')
check('een vestiging kiezen waar je wel mag werkt',
  gekozenAmsterdam.length > 0 && gekozenAmsterdam.every((i) => i.locationId === 'loc_ams'))

// Wasopdrachten hangen allemaal aan een vestiging
const jobsMetLocatie = (await db.washJobs.toArray()).filter((j) => !j.locationId)
check('elke wasbeurt hoort bij een vestiging', jobsMetLocatie.length === 0,
  `${jobsMetLocatie.length} zonder`)

// Elke vestiging heeft eigen mensen en eigen voorraad
const zonderPloeg = filialen.filter(
  (l) => !alleUsers.some((u) => u.locationId === l.id))
check('elke vestiging heeft personeel', zonderPloeg.length === 0,
  zonderPloeg.map((l) => l.name).join(', '))
const zonderVoorraad = filialen.filter(
  (l) => !alleVoorraad.some((i) => i.locationId === l.id))
check('elke vestiging heeft voorraad', zonderVoorraad.length === 0)

/* ==================================================================== */

console.log('\n17. Technische dienst')
const {
  assets: assetRepo, faults: faultRepo, workOrders: orderRepo,
  maintenance: planRepo, techKpis, makeQrToken, dueStateOf,
} = await import('../src/lib/techniek')
const { MAINTENANCE_DAYS: MAINTENANCE_DAGEN } = await import('../src/lib/types')

const alleAssets = await db.assets.toArray()
const alleFaults = await db.faults.toArray()
const alleOrders = await db.workOrders.toArray()
const allePlans = await db.maintenancePlans.toArray()

check('machinepark gesynchroniseerd', alleAssets.length > 100, String(alleAssets.length))
check('elke vestiging heeft installaties',
  filialen.every((l) => alleAssets.some((a) => a.locationId === l.id)))
check('storingen en werkbonnen aanwezig',
  alleFaults.length > 20 && alleOrders.length > 20,
  `${alleFaults.length} storingen, ${alleOrders.length} werkbonnen`)
check('onderhoudsschemas aanwezig', allePlans.length > 50, String(allePlans.length))

// QR-sleutels moeten uniek zijn, anders wijst een label naar twee apparaten
const tokens = alleAssets.map((a) => a.qrToken)
check('elke QR-sleutel is uniek', new Set(tokens).size === tokens.length,
  `${tokens.length - new Set(tokens).size} dubbel`)
check('sleutels hebben geen verwarrende tekens',
  tokens.every((t) => !/[IO01]/.test(t.replace(/-/g, ''))))

const nieuwToken = makeQrToken()
check('nieuwe sleutel heeft het juiste formaat',
  /^[A-Z2-9]{4}-[A-Z2-9]{3}-[A-Z2-9]{3}$/.test(nieuwToken), nieuwToken)

// Een apparaat terugvinden via zijn QR-code of via de code op het label
const proef = alleAssets[0]
check('apparaat vindbaar via de QR-sleutel',
  (await assetRepo.byQr(proef.qrToken))?.id === proef.id)
check('apparaat vindbaar via de code op het label',
  (await assetRepo.find(proef.code))?.id === proef.id)
check('kleine letters worden ook gevonden',
  (await assetRepo.find(proef.qrToken.toLowerCase()))?.id === proef.id)
check('onbekende code geeft niets', (await assetRepo.find('BESTAAT-NIET')) === undefined)

/* --- de hele keten: melden, werkbon, afronden --- */

const vestiging = filialen[0]
const apparaat = alleAssets.find((a) => a.locationId === vestiging.id)!

const melding = await faultRepo.report({
  locationId: vestiging.id,
  assetId: apparaat.id,
  assetName: apparaat.name,
  title: 'Zelftest storing',
  description: 'Aangemaakt door de zelftest',
  severity: 'kritiek',
  stopsProduction: true,
  by: { id: 'u_wasser', name: 'Tom Verhoeven' },
})

check('storing krijgt een nummer', /^S-\d{4}-\d{4}$/.test(melding.number), melding.number)
check('kritieke storing zet het apparaat op storing',
  (await db.assets.get(apparaat.id))?.status === 'storing')

const bon = await orderRepo.create({
  locationId: vestiging.id,
  type: 'storing',
  title: 'Zelftest werkbon',
  assetId: apparaat.id,
  faultId: melding.id,
  checklist: ['Spanningsloos gemaakt', 'Storing verholpen'],
  by: { id: 'u_wasser3', name: 'Nour El Amrani' },
})

check('werkbon krijgt een nummer', /^W-\d{4}-\d{4}$/.test(bon.number), bon.number)
check('storing weet welke werkbon eraan hangt',
  (await db.faults.get(melding.id))?.workOrderId === bon.id)
check('storing staat nu in behandeling',
  (await db.faults.get(melding.id))?.status === 'in behandeling')

await orderRepo.toggleCheck(bon.id, 0)
check('checklist-punt afvinken werkt',
  (await db.workOrders.get(bon.id))?.checklist[0].done === true)

await orderRepo.addPart(bon.id, { name: 'Borstelsegment', qty: 2, unitPrice: 34.5 })
const metOnderdeel = await db.workOrders.get(bon.id)
check('onderdeel toegevoegd', metOnderdeel?.parts.length === 1)
check('en de prijs klopt',
  (metOnderdeel?.parts[0].qty ?? 0) * (metOnderdeel?.parts[0].unitPrice ?? 0) === 69)

await orderRepo.complete({
  id: bon.id,
  minutesSpent: 90,
  workDone: 'Segment vervangen en proefgedraaid.',
  signedOffBy: 'Tom Verhoeven',
  by: { id: 'u_wasser3', name: 'Nour El Amrani' },
})

const afgerond = await db.workOrders.get(bon.id)
const naAfronden = await db.faults.get(melding.id)
check('werkbon staat op gereed', afgerond?.status === 'gereed')
check('storing is mee afgemeld', naAfronden?.status === 'opgelost')
check('stilstand is berekend', (naAfronden?.downtimeMinutes ?? -1) >= 0)
check('apparaat is weer in bedrijf',
  (await db.assets.get(apparaat.id))?.status === 'in bedrijf')

/* --- onderhoud: schema wordt doorgeschoven --- */

const schema = allePlans.find((p) => p.locationId === vestiging.id)!
const vorigeDatum = schema.nextDueAt
const onderhoudsbon = await planRepo.schedule(schema.id, { id: 'u_wasser3', name: 'Nour El Amrani' })
check('onderhoud levert een werkbon op', !!onderhoudsbon)
check('checklist van het schema staat erop',
  (onderhoudsbon?.checklist.length ?? 0) === schema.checklist.length)

await orderRepo.complete({
  id: onderhoudsbon!.id,
  minutesSpent: 45,
  workDone: 'Beurt uitgevoerd.',
  by: { id: 'u_wasser3', name: 'Nour El Amrani' },
})
const naBeurt = await db.maintenancePlans.get(schema.id)
// Een beurt die je vroeg uitvoert, verschuift de volgende naar nu plus het
// interval. Dat kan eerder zijn dan de oorspronkelijke datum, en dat hoort zo.
const verwachteDag = Math.round((Date.now() + MAINTENANCE_DAGEN[schema.interval] * 86_400_000) / 86_400_000)
check('volgende beurt staat op nu plus het interval',
  Math.round((naBeurt?.nextDueAt ?? 0) / 86_400_000) === verwachteDag,
  `${new Date(naBeurt?.nextDueAt ?? 0).toISOString().slice(0, 10)} bij interval ${schema.interval}`)
check('de datum is daadwerkelijk verzet', (naBeurt?.nextDueAt ?? 0) !== vorigeDatum)
check('laatst gedaan is bijgewerkt', (naBeurt?.lastDoneAt ?? 0) > 0)
check('een doorgeschoven schema staat niet meer over tijd',
  dueStateOf(naBeurt!) !== 'over tijd')

/* --- cijfers --- */

const kpi = techKpis({
  faults: await db.faults.toArray(),
  orders: await db.workOrders.toArray(),
  plans: await db.maintenancePlans.toArray(),
  days: 60,
})
check('cijfers tellen open storingen', kpi.openStoringen >= 0)
check('onderhoud op peil is een percentage',
  kpi.onderhoudOpPeil >= 0 && kpi.onderhoudOpPeil <= 100, String(kpi.onderhoudOpPeil))
check('onderdelenkosten zijn meegeteld', kpi.onderdelenKosten >= 69,
  String(kpi.onderdelenKosten))

/* --- alles overleeft de rondgang naar de server --- */

await sync()
await db.assets.clear()
await db.faults.clear()
await db.workOrders.clear()
await db.maintenancePlans.clear()
await setMeta(LAST_SYNC, 0)
await sync()

check('installaties staan op de server', (await db.assets.count()) === alleAssets.length)
check('werkbon staat op de server', !!(await db.workOrders.get(bon.id)))
check('afronding overleefde de rondgang',
  (await db.workOrders.get(bon.id))?.status === 'gereed')
check('onderdelen overleefden de rondgang',
  (await db.workOrders.get(bon.id))?.parts.length === 1)

/* --- afscherming per vestiging geldt ook hier --- */

const techniekVanWasser = withinScope(wasserUtr, await db.assets.toArray())
check('wasser ziet alleen de installaties van zijn vestiging',
  techniekVanWasser.length > 0 && techniekVanWasser.every((a) => a.locationId === 'loc_utr'))
check('hoofdkantoor ziet het hele machinepark',
  withinScope(hkUser, await db.assets.toArray()).length === alleAssets.length)

/* ==================================================================== */

console.log('\n18. Meldingen aan de ontwikkelaar')
const {
  tickets: ticketRepo, ticketMessages: messageRepo, logs: logRepo,
} = await import('../src/lib/tickets')
const { trail } = await import('../src/lib/trail')

check('voorbeeldmeldingen gesynchroniseerd', (await db.tickets.count()) === 5,
  String(await db.tickets.count()))
check('logboek gesynchroniseerd', (await db.logEvents.count()) >= 5)

/* --- het spoor van handelingen --- */

trail.clear()
trail.page('Werknemer', 'vandaag')
trail.action('Wagen 12-BND-4 opgepakt')
trail.error('Kan niet opslaan')
check('spoor legt drie handelingen vast', trail.recent().length === 3)
check('en in de juiste volgorde',
  trail.recent().map((e) => e.kind).join(',') === 'pagina,actie,fout')

// Twee keer hetzelfde vlak achter elkaar hoort niet dubbel te tellen
trail.action('Zelfde actie')
trail.action('Zelfde actie')
check('herhaling vlak na elkaar wordt genegeerd', trail.recent().length === 4)

/* --- een ticket18 maken --- */

const ticket18 = await ticketRepo.create({
  title: 'Zelftest: knop reageert niet',
  description: 'Aangemaakt door de zelftest om de keten te controleren.',
  kind: 'fout',
  priority: 'hoog',
  by: { id: 'u_wasser', name: 'Tom Verhoeven', locationId: 'loc_utr' },
  fromRole: 'employee',
  fromPage: 'vandaag',
  appVersion: '9.9.9',
  online: true,
  pendingChanges: 2,
})

check('melding krijgt een nummer', /^M-\d{4}-\d{4}$/.test(ticket18.number), ticket18.number)
check('status begint op nieuw', ticket18.status === 'nieuw')
check('het spoor gaat mee', ticket18.trail.length === 4, String(ticket18.trail.length))
check('de technische context gaat mee',
  ticket18.appVersion === '9.9.9' && ticket18.pendingChanges === 2 && !!ticket18.platform)
check('de ontwikkelaar krijgt bericht',
  (await db.notifications.toArray()).some(
    (n) => n.toUserId === 'u_dev' && n.title.includes(ticket18.number)))

/* --- gesprek --- */

await messageRepo.send({
  ticketId: ticket18.id,
  body: 'Gebeurt dat altijd of alleen soms?',
  internal: false,
  by: { id: 'u_dev', name: 'Sem de Ontwikkelaar' },
})
check('antwoord van de ontwikkelaar zet hem op wacht op melder',
  (await db.tickets.get(ticket18.id))?.status === 'wacht op melder')
check('de melder krijgt bericht',
  (await db.notifications.toArray()).some(
    (n) => n.toUserId === 'u_wasser' && n.title.includes('Reactie op')))

await messageRepo.send({
  ticketId: ticket18.id,
  body: 'Alleen als ik offline ben.',
  internal: false,
  by: { id: 'u_wasser', name: 'Tom Verhoeven' },
})
check('reactie van de melder zet hem terug in behandeling',
  (await db.tickets.get(ticket18.id))?.status === 'in behandeling')

const intern = await messageRepo.send({
  ticketId: ticket18.id,
  body: 'Interne notitie: waarschijnlijk de outbox.',
  internal: true,
  by: { id: 'u_dev', name: 'Sem de Ontwikkelaar' },
})
check('interne notitie is als intern gemarkeerd', intern?.internal === true)

const zichtbaarVoorMelder = (await db.ticketMessages
  .where('ticketId').equals(ticket18.id).toArray()).filter((m) => !m.internal)
check('de melder ziet de interne notitie niet', zichtbaarVoorMelder.length === 2)

/* --- afhandelen --- */

await ticketRepo.setStatus(ticket18.id, 'opgelost', { id: 'u_dev', name: 'Sem de Ontwikkelaar' }, {
  resolution: 'De wachtrij liep vast bij een lege verbinding. Opgelost.',
  fixedIn: '9.9.10',
})
const afgehandeld = await db.tickets.get(ticket18.id)
check('melding staat op opgelost', afgehandeld?.status === 'opgelost')
check('de oplossing is vastgelegd', !!afgehandeld?.resolution)
check('de versie is vastgelegd', afgehandeld?.fixedIn === '9.9.10')
check('de melder krijgt bericht van de afhandeling',
  (await db.notifications.toArray()).some(
    (n) => n.toUserId === 'u_wasser' && n.title.includes('is nu: opgelost')))

/* --- logboek telt herhalingen op --- */

const eerste = await logRepo.record({
  level: 'fout',
  message: 'Zelftest: iets ging mis bij record 41',
  page: 'Werknemer -> vandaag',
  appVersion: '9.9.9',
})
const tweede = await logRepo.record({
  level: 'fout',
  message: 'Zelftest: iets ging mis bij record 77',
  page: 'Werknemer -> vandaag',
  appVersion: '9.9.9',
})
check('dezelfde fout met een ander getal telt op, niet dubbel',
  eerste.id === tweede.id && tweede.count === 2,
  `${eerste.id} vs ${tweede.id}, count ${tweede.count}`)

const ander = await logRepo.record({
  level: 'fout',
  message: 'Zelftest: heel iets anders',
  page: 'Werknemer -> vandaag',
  appVersion: '9.9.9',
})
check('een andere fout krijgt een eigen regel', ander.id !== eerste.id)

/* --- alles overleeft de rondgang --- */

await sync()
await db.tickets.clear()
await db.ticketMessages.clear()
await db.logEvents.clear()
await setMeta(LAST_SYNC, 0)
await sync()

const naSync = await db.tickets.get(ticket18.id)
check('melding staat op de server', !!naSync)
check('het spoor overleefde de rondgang', (naSync?.trail.length ?? 0) === 4)
check('de gesprekken staan op de server',
  (await db.ticketMessages.where('ticketId').equals(ticket18.id).count()) === 3)
check('het logboek staat op de server', (await db.logEvents.get(eerste.id))?.count === 2)

/* ==================================================================== */

console.log('\n19. Overleg')

const {
  chat, channels: kanaalRepo, channelStates, findMentions, mentionsEveryone,
  mayRead, slugify, dmId, visibleChannels, ensureDefaultChannels,
} = await import('../src/lib/chat')

check('kanalen gesynchroniseerd', (await db.channels.count()) > 4,
  String(await db.channels.count()))
check('gesprekken gesynchroniseerd', (await db.chatMessages.count()) === 9,
  String(await db.chatMessages.count()))

/* --- namen omzetten naar kanaalnamen --- */

check('kanaalnaam met hoofdletters wordt klein', slugify('Chemie En Dosering') === 'chemie-en-dosering')
check('accenten verdwijnen uit de kanaalnaam', slugify('Nieuwegeïn') === 'nieuwegein')
check('een gesprek heeft hetzelfde id vanaf beide kanten',
  dmId('u_a', 'u_b') === dmId('u_b', 'u_a'))

/* --- wie wordt er genoemd --- */

const alleMensen = await db.users.toArray()
const tom = alleMensen.find((u) => u.id === 'u_wasser')!
const nour = alleMensen.find((u) => u.id === 'u_wasser3')!
const ilse = alleMensen.find((u) => u.id === 'u_manager')!

check('een volledige naam wordt herkend',
  findMentions('Kijk jij ernaar @Tom Verhoeven?', [tom]).includes(tom.id))
check('een voornaam ook',
  findMentions('@Tom kun jij dat oppakken?', [tom]).includes(tom.id))
check('een naam die er niet staat wordt niet verzonnen',
  findMentions('Ik pak het zelf wel op.', [tom, nour]).length === 0)
check('een langere naam wint van de korte',
  findMentions('@Nour El Amrani graag', [nour]).length === 1)
check('iedereen aanspreken wordt herkend', mentionsEveryone('Let op @iedereen'))

/* --- een bericht plaatsen --- */

const algemeen = (await db.channels.get('ch_algemeen'))!
const voorHet = await db.chatMessages.where('channelId').equals('ch_algemeen').count()

const geplaatst = await chat.send({
  channelId: 'ch_algemeen',
  body: 'Zelftest: @Tom Verhoeven kun jij morgen de osmose bijvullen?',
  by: ilse,
  members: [tom, nour, ilse],
})

check('het bericht staat er meteen',
  (await db.chatMessages.where('channelId').equals('ch_algemeen').count()) === voorHet + 1)
check('de genoemde persoon is eruit gehaald',
  geplaatst!.mentions.length === 1 && geplaatst!.mentions[0] === tom.id,
  JSON.stringify(geplaatst!.mentions))

const belletjes = (await db.notifications.toArray()).filter(
  (n) => n.toUserId === tom.id && n.link === 'overleg')
check('wie genoemd wordt krijgt bericht', belletjes.length === 1, String(belletjes.length))

/* --- ongelezen ---
 *
 * Meten vóór Tom zelf iets terugzegt: wie een bericht plaatst heeft het
 * kanaal daarmee gelezen, en dan valt er niets meer te tellen.
 */

const statesTom = channelStates(
  tom,
  await db.channels.toArray(),
  await db.chatMessages.toArray(),
  await db.channelReads.toArray(),
)
const algemeenTom = statesTom.find((c) => c.channel.id === 'ch_algemeen')!

check('ongelezen berichten worden geteld', algemeenTom.ongelezen > 0,
  String(algemeenTom.ongelezen))
check('genoemd worden valt apart op', algemeenTom.genoemd === true)

const statesIlse = channelStates(
  ilse,
  await db.channels.toArray(),
  await db.chatMessages.toArray(),
  await db.channelReads.toArray(),
)
check('je eigen bericht telt niet als ongelezen',
  statesIlse.find((c) => c.channel.id === 'ch_algemeen')!.ongelezen === 0)

await chat.markRead('ch_algemeen', tom.id)
const naLezen = channelStates(
  tom,
  await db.channels.toArray(),
  await db.chatMessages.toArray(),
  await db.channelReads.toArray(),
)
check('na lezen staat de teller op nul',
  naLezen.find((c) => c.channel.id === 'ch_algemeen')!.ongelezen === 0)

/* --- antwoorden --- */

const antwoord = await chat.send({
  channelId: 'ch_algemeen',
  body: 'Doe ik, staat genoteerd.',
  by: tom,
  replyTo: geplaatst!,
  members: [tom, nour, ilse],
})
check('een antwoord houdt vast waarop het slaat',
  antwoord!.replyToId === geplaatst!.id && antwoord!.replyToName === ilse.name)

const kanalenNu = await db.channels.toArray()

/* --- verwijderen laat de regel staan --- */

await chat.remove(antwoord!.id, tom)
const weg = await db.chatMessages.get(antwoord!.id)
check('een verwijderd bericht blijft als regel staan', !!weg)
check('maar de inhoud is eruit', weg!.body === '' && !!weg!.deletedAt)

/* --- wie mag waar meelezen --- */

const utrecht = kanalenNu.find((c) => c.kind === 'vestiging' && c.locationId === 'loc_utr')!
const rotterdam = kanalenNu.find((c) => c.kind === 'vestiging' && c.locationId === 'loc_rtm')!

check('je leest het kanaal van je eigen vestiging', mayRead(tom, utrecht))
check('en niet dat van een andere vestiging', !mayRead(tom, rotterdam))
check('het hoofdkantoor leest overal mee', mayRead(ilse, rotterdam))
check('een klant komt het overleg niet in',
  !mayRead(alleMensen.find((u) => u.id === 'u_klant')!, algemeen))

const besloten = await kanaalRepo.create({
  name: 'Zelftest besloten',
  private: true,
  memberIds: [ilse.id],
  by: ilse,
})
check('een besloten kanaal is alleen voor de leden',
  mayRead(ilse, besloten!) && !mayRead(tom, besloten!))
check('en staat niet in de lijst van wie er niet in zit',
  !visibleChannels(tom, await db.channels.toArray()).some((c) => c.id === besloten!.id))

/* --- rechtstreeks gesprek --- */

const gesprek = await kanaalRepo.openDirect(ilse, tom)
check('een gesprek heeft twee leden', gesprek!.memberIds.length === 2)
const nogmaals = await kanaalRepo.openDirect(tom, ilse)
check('hetzelfde gesprek twee keer openen levert er niet twee op',
  nogmaals!.id === gesprek!.id)

await chat.send({
  channelId: gesprek!.id,
  body: 'Zelftest: kun je even bellen?',
  by: ilse,
  members: [tom, ilse],
})
const dmBel = (await db.notifications.toArray()).filter(
  (n) => n.toUserId === tom.id && n.title.includes('Bericht van'))
check('in een rechtstreeks gesprek krijgt de ander altijd bericht',
  dmBel.length === 1, String(dmBel.length))

/* --- standaardkanalen worden niet dubbel aangemaakt --- */

const voorStandaard = await db.channels.count()
await ensureDefaultChannels(ilse, await db.locations.toArray())
check('bestaande kanalen worden niet nog eens aangemaakt',
  (await db.channels.count()) === voorStandaard,
  `${voorStandaard} -> ${await db.channels.count()}`)

/* --- zonder verbinding blijft het staan --- */

setForcedOffline(true)
setOnline(false)
const offlineBericht = await chat.send({
  channelId: 'ch_algemeen',
  body: 'Zelftest: getypt in de machinekamer, zonder bereik.',
  by: tom,
  members: [tom, ilse],
})
check('een bericht zonder bereik staat er meteen',
  !!(await db.chatMessages.get(offlineBericht!.id)))
check('en wacht in de wachtrij', useSync.getState().pending > 0)

setForcedOffline(false)
setOnline(true)
await sync()
check('zodra er weer bereik is vertrekt het', useSync.getState().pending === 0)

await db.chatMessages.clear()
await db.channels.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('het gesprek staat op de server',
  !!(await db.chatMessages.get(offlineBericht!.id)))
check('de kanalen ook', (await db.channels.count()) > 4)

/* ==================================================================== */

console.log('\n20. Aanmelden')

const { signups: signupRepo, passwordProblem, emailLooksValid } =
  await import('../src/lib/signups')

check('een kort wachtwoord wordt geweigerd', passwordProblem('kort12') !== null)
check('letters zonder cijfers ook', passwordProblem('allemaalletters') !== null)
check('cijfers zonder letters ook', passwordProblem('1234567890') !== null)
check('een fatsoenlijk wachtwoord mag', passwordProblem('wasstraat2026') === null)

check('een geldig adres wordt herkend', emailLooksValid('jan@truckwash1group.nl'))
check('een adres zonder apenstaartje niet', !emailLooksValid('jan.truckwash1group.nl'))
check('een adres zonder domein ook niet', !emailLooksValid('jan@truckwash'))

check('aanmeldingen gesynchroniseerd', (await db.signups.count()) === 5,
  String(await db.signups.count()))

const openstaand = (await db.signups.toArray()).filter((s) => s.status === 'nieuw')
check('er staan drie aanmeldingen open', openstaand.length === 3, String(openstaand.length))

/* --- toelaten --- */

const teBeoordelen = openstaand.find((s) => s.kind === 'werknemer')!
const aantalVoor = await db.users.count()

const toegelaten = await signupRepo.approve({
  signup: teBeoordelen,
  roles: ['employee', 'supervisor'],
  locationId: 'loc_utr',
  manages: ['loc_utr', 'loc_ams'],
  personnelNumber: 'TW-901',
  function: 'Voorman wasstraat',
  contractHours: 38,
  by: ilse,
})

check('er is een dossier bij gekomen', (await db.users.count()) === aantalVoor + 1)
check('het dossier staat op actief', toegelaten!.active === true)
check('met de gekozen rollen',
  toegelaten!.roles.join() === 'employee,supervisor', toegelaten!.roles.join())
check('en de gekozen vestiging', toegelaten!.locationId === 'loc_utr')
check('inclusief de vestigingen waar hij leiding over krijgt',
  (toegelaten!.manages ?? []).length === 2, JSON.stringify(toegelaten!.manages))
check('het personeelsnummer is overgenomen', toegelaten!.personnelNumber === 'TW-901')

const bijgewerkt = await db.signups.get(teBeoordelen.id)
check('de aanmelding staat op goedgekeurd', bijgewerkt!.status === 'goedgekeurd')
check('met wie hem heeft afgehandeld', bijgewerkt!.handledByName === ilse.name)

const welkom = (await db.notifications.toArray()).filter(
  (n) => n.toUserId === toegelaten!.id && n.title.includes('goedgekeurd'))
check('de nieuwe medewerker krijgt bericht', welkom.length === 1)

check('en zit meteen in het kanaal van zijn vestiging',
  (await db.channels.toArray())
    .find((c) => c.kind === 'vestiging' && c.locationId === 'loc_utr')!
    .memberIds.includes(toegelaten!.id))

/* --- afwijzen --- */

const afTeWijzen = (await db.signups.toArray()).find(
  (s) => s.status === 'nieuw' && s.kind === 'klant')!

const afgewezen = await signupRepo.reject(
  afTeWijzen, 'Dit adres kennen we niet als klant.', ilse)

check('de aanmelding staat op afgewezen', afgewezen!.status === 'afgewezen')
check('met de reden erbij',
  afgewezen!.rejectReason === 'Dit adres kennen we niet als klant.')
check('afwijzen maakt geen dossier aan',
  !(await db.users.toArray()).some((u) => u.email === afTeWijzen.email))

/* --- terugdraaien --- */

const heropend = await signupRepo.reopen(afgewezen!)
check('terugdraaien zet hem weer op nieuw', heropend!.status === 'nieuw')
check('en wist de reden', heropend!.rejectReason === undefined)

/* --- alles overleeft de rondgang --- */

await sync()
await db.signups.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('de aanmeldingen staan op de server',
  (await db.signups.get(teBeoordelen.id))?.status === 'goedgekeurd')

/* ==================================================================== */

console.log('\n21. De wachtrij: volgorde en veerkracht')

const { PUSH_ORDER } = await import('../src/lib/sync')
const { EntityNames } = { EntityNames: [
  'locations', 'users', 'companies', 'washJobs', 'inventory',
  'stockMovements', 'expenses', 'timeEntries', 'shifts',
  'notifications', 'courses', 'courseProgress',
  'assets', 'faults', 'workOrders', 'maintenancePlans',
  'tickets', 'ticketMessages', 'logEvents',
  'signups', 'channels', 'chatMessages', 'channelReads', 'emailLog',
] }

check('elke tabel staat in de verstuurvolgorde',
  EntityNames.every((e) => PUSH_ORDER.includes(e as never)),
  EntityNames.filter((e) => !PUSH_ORDER.includes(e as never)).join(', '))
check('en er staat niets dubbel in',
  new Set(PUSH_ORDER).size === PUSH_ORDER.length)

/** Waar staat deze tabel in de rij? */
const rang = (e: string) => PUSH_ORDER.indexOf(e as never)

check('kanalen gaan voor berichten', rang('channels') < rang('chatMessages'))
check('kanalen gaan voor leestekens', rang('channels') < rang('channelReads'))
check('meldingen gaan voor hun gesprekken', rang('tickets') < rang('ticketMessages'))
check('installaties gaan voor storingen', rang('assets') < rang('faults'))
check('storingen gaan voor werkbonnen', rang('faults') < rang('workOrders'))
check('vestigingen gaan als eerste', rang('locations') === 0)
check('dossiers gaan voor alles wat naar iemand verwijst',
  rang('users') < rang('shifts') && rang('users') < rang('expenses'))

/* --- de volgorde geldt ook als de wachtrij door elkaar staat --- */

const { enqueue } = await import('../src/lib/sync')

await db.outbox.clear()
// Bewust omgekeerd in de wachtrij zetten: eerst het kind, dan de ouder.
await enqueue('chatMessages', 'put', 'cm_volgorde', {
  id: 'cm_volgorde', channelId: 'ch_volgorde', authorId: 'u_manager',
  authorName: 'Ilse Bakker', body: 'Test', at: Date.now(), mentions: [],
  updatedAt: Date.now(),
})
await enqueue('channels', 'put', 'ch_volgorde', {
  id: 'ch_volgorde', slug: 'volgorde', name: 'Volgorde', kind: 'kanaal',
  private: false, memberIds: ['u_manager'], createdBy: 'u_manager',
  createdAt: Date.now(), archived: false, updatedAt: Date.now(),
})

await sync()
check('allebei verstuurd, ondanks de omgekeerde volgorde',
  useSync.getState().pending === 0, String(useSync.getState().pending))

/* --- een record dat blijft weigeren blokkeert de rest niet --- */

const { logs: logRepo2 } = await import('../src/lib/tickets')

check('een fout in het logboek gooit niets terug',
  (await logRepo2.record({
    level: 'fout',
    message: 'Zelftest: het logboek mag nooit omvallen',
    appVersion: '9.9.9',
  })) !== null)

/* --- de opvanger mag geen kettingreactie maken --- */

const { onCapturedError, installErrorCapture } = await import('../src/lib/trail')

// De opvanger draait normaal alleen in de app; hier zetten we hem zelf aan.
installErrorCapture()

let rondes = 0
onCapturedError((e) => {
  rondes++
  // Zoals een kapotte opslag zou doen: de opvanger valt zelf om.
  if (rondes < 50) throw new Error('opvanger valt om: ' + e.message)
})
console.error('Zelftest: een fout die de opvanger laat struikelen')

check('een opvanger die omvalt stopt na één ronde', rondes === 1, String(rondes))

// De opvanger weer onschadelijk maken voor de rest van de test.
onCapturedError(() => {})

/* ==================================================================== */

console.log('\n22. Controles op identiteits- en betaalgegevens')

const {
  bsnGeldig, bsnProbleem, bsnFormatteer, bsnGemaskeerd,
  ibanGeldig, ibanProbleem, ibanFormatteer,
  leesMrz, kortHash,
} = await import('../src/lib/identiteit')

/* --- de elfproef --- */

check('een geldig BSN komt erdoor', bsnGeldig('123456782'))
check('nog eentje', bsnGeldig('111222333'))
check('een omgedraaid cijfer valt op', !bsnGeldig('123456728'))
check('acht cijfers is geen BSN', !bsnGeldig('12345678'))
check('negen nullen ook niet', !bsnGeldig('000000000'))
check('letters worden genegeerd, cijfers geteld', bsnGeldig('123 456 782'))

check('een half ingetypt BSN klaagt niet meteen',
  (bsnProbleem('1234') ?? '').includes('Nog'))
check('een fout BSN wordt benoemd',
  (bsnProbleem('123456728') ?? '').includes('elfproef'))
check('een goed BSN geeft geen klacht', bsnProbleem('123456782') === null)

check('BSN wordt gegroepeerd', bsnFormatteer('123456782') === '123 456 782')
check('BSN staat standaard afgeschermd', bsnGemaskeerd('123456782') === '••• ••• 782')
check('zonder BSN valt er niets af te schermen', bsnGemaskeerd(undefined) === '—')

/* --- de mod-97-toets --- */

check('een geldig IBAN komt erdoor', ibanGeldig('NL91ABNA0417164300'))
check('met spaties ook', ibanGeldig('NL91 ABNA 0417 1643 00'))
check('een verkeerd controlegetal valt op', !ibanGeldig('NL92ABNA0417164300'))
check('een te kort Nederlands IBAN valt op', !ibanGeldig('NL91ABNA041716430'))
check('een Duits IBAN mag ook', ibanGeldig('DE89370400440532013000'))
check('een verzonnen land zonder lengte wordt alsnog gerekend',
  !ibanGeldig('XX00ABNA0417164300'))

check('de lengte wordt benoemd',
  (ibanProbleem('NL91ABNA041716430') ?? '').includes('18'))
check('een goed IBAN geeft geen klacht', ibanProbleem('NL91ABNA0417164300') === null)
check('IBAN wordt in blokjes gezet',
  ibanFormatteer('NL91ABNA0417164300') === 'NL91 ABNA 0417 1643 00')

/* --- de machineleesbare strook --- */

const PASPOORT = [
  'P<NLDDE<BRUIJN<<WILLEM<JAN<<<<<<<<<<<<<<<<<<',
  'SPECI20142NLD6503101M2403096999999990<<<<<84',
].join('\n')

const mrz = leesMrz(PASPOORT)
check('een paspoortstrook wordt gelezen', !!mrz)
check('het documentnummer komt eruit', mrz?.documentNumber === 'SPECI2014')
check('de achternaam komt eruit', mrz?.achternaam === 'De Bruijn', String(mrz?.achternaam))
check('de voornamen ook', mrz?.voornamen === 'Willem Jan', String(mrz?.voornamen))
check('de nationaliteit komt eruit', mrz?.nationaliteit === 'NLD')
check('het geslacht komt eruit', mrz?.geslacht === 'M')

const geboren = mrz?.geboortedatum ? new Date(mrz.geboortedatum) : null
check('de geboortedatum klopt',
  geboren?.getFullYear() === 1965 && geboren?.getMonth() === 2 && geboren?.getDate() === 10,
  String(geboren))

const verloopt = mrz?.vervaldatum ? new Date(mrz.vervaldatum) : null
check('de vervaldatum ligt in de toekomst, niet honderd jaar terug',
  (verloopt?.getFullYear() ?? 0) >= 2024, String(verloopt))

check('alle controlecijfers kloppen', mrz?.betrouwbaar === true,
  JSON.stringify(mrz?.twijfel))

/* Eén teken veranderen in het documentnummer moet opvallen. */
const VERMINKT = PASPOORT.replace('SPECI20142', 'SPECI20143')
const stuk = leesMrz(VERMINKT)
check('een verkeerd overgetypt teken springt eruit', stuk?.betrouwbaar === false)
check('en er wordt bij gezegd wát er niet klopt',
  (stuk?.twijfel ?? []).includes('documentnummer'), JSON.stringify(stuk?.twijfel))

check('onzin levert niets op', leesMrz('dit is geen strook') === null)
check('een lege invoer ook niet', leesMrz('') === null)

check('een korte vingerafdruk blijft leesbaar',
  kortHash('abcdef0123456789abcdef0123456789') === 'abcdef01…23456789',
  kortHash('abcdef0123456789abcdef0123456789'))
check('zonder vingerafdruk een streepje', kortHash(undefined) === '—')

/* ==================================================================== */

console.log('\n23. Het dossier')

const { dossier: dossierRepo, documentenVan, eigenDocumenten, signalen } =
  await import('../src/lib/dossier')

const dossierPersoon = 'u_wasser'

await dossierRepo.save(dossierPersoon, {
  bsn: '123456782',
  iban: 'NL91ABNA0417164300',
  hourlyRate: 24.5,
  internalNotes: 'Zelftest: interne notitie',
})

const opgeslagen = await dossierRepo.get(dossierPersoon)
check('het dossier is opgeslagen', opgeslagen?.bsn === '123456782')
check('het uurtarief staat in het afgeschermde deel', opgeslagen?.hourlyRate === 24.5)
check('en het id is het dossier-id', opgeslagen?.id === dossierPersoon)

await dossierRepo.save(dossierPersoon, { birthPlace: 'Utrecht' })
const bijgewerktDossier = await dossierRepo.get(dossierPersoon)
check('bijwerken laat de rest staan',
  bijgewerktDossier?.bsn === '123456782' && bijgewerktDossier?.birthPlace === 'Utrecht')

/* --- documenten sorteren en filteren --- */

const nu = Date.now()
const DOCS = [
  { id: 'zt_1', title: 'Loonstrook mei', kind: 'loonstrook' as const, zichtbaar: true,  tekenen: false, at: nu - 3000 },
  { id: 'zt_2', title: 'Contract 2026',  kind: 'contract' as const,   zichtbaar: true,  tekenen: true,  at: nu - 9000 },
  { id: 'zt_3', title: 'Gespreksverslag', kind: 'beoordeling' as const, zichtbaar: false, tekenen: false, at: nu - 1000 },
]

for (const d of DOCS) {
  await db.documents.put({
    id: d.id,
    userId: dossierPersoon,
    userName: 'Tom Verhoeven',
    kind: d.kind,
    title: d.title,
    storagePath: `${dossierPersoon}/${d.id}.pdf`,
    mime: 'application/pdf',
    sizeBytes: 1024,
    visibleToEmployee: d.zichtbaar,
    uploadedBy: 'u_manager',
    uploadedByName: 'Ilse Bakker',
    uploadedAt: d.at,
    requiresSignature: d.tekenen,
    updatedAt: nu,
  })
}

const alleDocs = await db.documents.toArray()
const vanTom = documentenVan(alleDocs, dossierPersoon)

check('alle drie de stukken horen bij hem', vanTom.length === 3, String(vanTom.length))
check('wat getekend moet worden staat bovenaan',
  vanTom[0].id === 'zt_2', vanTom[0].id)
check('daarna op datum, nieuwste eerst',
  vanTom[1].id === 'zt_3' && vanTom[2].id === 'zt_1',
  vanTom.map((d) => d.id).join(','))

const zietTom = eigenDocumenten(alleDocs, dossierPersoon)
check('hij ziet zijn afgeschermde verslag niet',
  zietTom.length === 2 && !zietTom.some((d) => d.id === 'zt_3'),
  zietTom.map((d) => d.id).join(','))

/* --- waar het dossier aandacht vraagt --- */

const seinen = signalen(alleDocs, dossierPersoon)
check('een openstaande handtekening wordt gemeld',
  seinen.some((s) => s.soort === 'tekenen'))
check('een ontbrekend identiteitsbewijs wordt gemeld',
  seinen.some((s) => s.soort === 'ontbreekt' && s.tekst.includes('identiteitsbewijs')))
check('een aanwezig contract wordt niet gemist',
  !seinen.some((s) => s.soort === 'ontbreekt' && s.tekst.includes('contract')))

await db.documents.put({
  ...(await db.documents.get('zt_1'))!,
  id: 'zt_4',
  kind: 'identiteitsbewijs',
  title: 'ID-kaart',
  expiresAt: nu - 86_400_000,
})
check('een verlopen document wordt gemeld',
  signalen(await db.documents.toArray(), dossierPersoon)
    .some((s) => s.soort === 'verlopen'))

await db.documents.put({
  ...(await db.documents.get('zt_4'))!,
  id: 'zt_5',
  title: 'ID-kaart nieuw',
  expiresAt: nu + 20 * 86_400_000,
})
check('een document dat bijna verloopt ook',
  signalen(await db.documents.toArray(), dossierPersoon)
    .some((s) => s.soort === 'verloopt' && s.tekst.includes('20')))

/* --- alles overleeft de rondgang --- */

await sync()
await db.personnelPrivate.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('het dossier staat op de server',
  (await dossierRepo.get(dossierPersoon))?.bsn === '123456782')


/* ==================================================================== */

console.log('\n24. Postbus')

const { filterPost, onbekeken, bijbehorendeBon, grootte, postbus: postbusRepo } =
  await import('../src/lib/postbus')

const post = await db.mailbox.toArray()
check('post gesynchroniseerd', post.length === 4, String(post.length))
check('twee berichten zijn nog niet bekeken', onbekeken(post) === 2, String(onbekeken(post)))

const binnen = filterPost(post, { richting: 'in' })
check('alles is binnengekomen post', binnen.length === 4)
check('nieuwste bovenaan', binnen[0].at >= binnen[1].at)

check('filteren op status werkt',
  filterPost(post, { richting: 'in', status: 'nieuw' }).length === 2)
check('zoeken op afzender werkt',
  filterPost(post, { richting: 'in', zoek: 'cleanchem' }).length === 1)
check('zoeken op onderwerp werkt',
  filterPost(post, { richting: 'in', zoek: 'osmose' }).length === 1)
check('zoeken in de tekst werkt',
  filterPost(post, { richting: 'in', zoek: 'twaalf trekkers' }).length === 1)
check('een zoekterm die nergens staat levert niets',
  filterPost(post, { richting: 'in', zoek: 'zzzzz' }).length === 0)
check('verstuurde post is er nog niet',
  filterPost(post, { richting: 'uit' }).length === 0)

/* --- de verkoopfacturen apart (0047) --- */

const { isVerkoopfactuur, aantalVerkoopfacturen } = await import('../src/lib/postbus')
const gemengd: typeof post = [
  ...post.map((m, i) => ({
    ...m,
    soort: i === 0 ? 'verkoop' as const : i === 1 ? 'inkoop' as const : undefined,
  })),
  // Een verstuurde verkoopfactuur telt niet mee: het gaat om wat binnenkwam.
  { ...post[0], id: 'mb_uit_verkoop', richting: 'uit' as const, soort: 'verkoop' as const },
]
const verkoop = filterPost(gemengd, { richting: 'in', soort: 'verkoop' })
check('filteren op verkoop geeft alleen binnengekomen verkoopfacturen',
  verkoop.length === 1 && verkoop[0].soort === 'verkoop' && verkoop[0].richting === 'in')
check('zonder soort of met alles verandert het filter niets',
  filterPost(gemengd, { richting: 'in' }).length === 4
  && filterPost(gemengd, { richting: 'in', soort: 'alles' }).length === 4)
check('isVerkoopfactuur kijkt alleen naar het soort',
  isVerkoopfactuur(gemengd[0]) && !isVerkoopfactuur(gemengd[1]) && !isVerkoopfactuur(gemengd[2]))
check('de teller op het tabblad telt alleen binnengekomen verkoopfacturen',
  aantalVerkoopfacturen(gemengd) === 1)

/* --- de bon die eruit ontstond --- */

const alleBonnen = await db.expenses.toArray()
const uitMail = alleBonnen.filter((b) => b.source === 'mail')
check('drie bonnen kwamen uit de mail', uitMail.length === 3, String(uitMail.length))
check('het bedrag staat bewust op nul', uitMail.every((b) => b.amountExcl === 0))
check('de bijlage hangt eraan vast', uitMail.every((b) => !!b.attachmentPath))

const metBon = post.find((m) => m.expenseId)!
check('het bericht wijst naar zijn bon',
  bijbehorendeBon(metBon, alleBonnen)?.id === metBon.expenseId)
check('een bericht zonder bon geeft niets terug',
  bijbehorendeBon(post.find((m) => !m.expenseId)!, alleBonnen) === undefined)

/* --- status bijwerken --- */

await postbusRepo.markeerGelezen(metBon.id)
check('openslaan zet nieuw op gelezen',
  (await db.mailbox.get(metBon.id))?.status !== 'nieuw')

const alGelezen = post.find((m) => m.status === 'verwerkt')!
await postbusRepo.markeerGelezen(alGelezen.id)
check('een afgehandeld bericht wordt niet teruggezet',
  (await db.mailbox.get(alGelezen.id))?.status === 'verwerkt')

await postbusRepo.setStatus(metBon.id, 'verwerkt', { id: 'u_manager', name: 'Ilse Bakker' })
const postAfgehandeld = await db.mailbox.get(metBon.id)
check('afhandelen legt vast wie het deed', postAfgehandeld?.handledByName === 'Ilse Bakker')
check('en wanneer', (postAfgehandeld?.handledAt ?? 0) > 0)

check('grootte leest prettig',
  grootte(512) === '512 B' && grootte(84_000) === '82 kB' && grootte(3_000_000) === '2.9 MB',
  `${grootte(512)} / ${grootte(84_000)} / ${grootte(3_000_000)}`)

/* --- alles overleeft de rondgang --- */

await sync()
await db.mailbox.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('de postbus staat op de server',
  (await db.mailbox.get(metBon.id))?.status === 'verwerkt')


/* ==================================================================== */

console.log('\n25. Een contract uitlezen')

const {
  vindGegevens, leesDatum, leesBedrag, aantalGevonden, afgeleidUurloon,
} = await import('../src/lib/contractLezen')

/* --- bedragen --- */

check('Nederlandse notatie', leesBedrag('2.850,00') === 2850)
check('punt als decimaal', leesBedrag('2850.00') === 2850)
check('duizendtallen met een punt', leesBedrag('12.500') === 12500)
check('komma als decimaal', leesBedrag('22,50') === 22.5)
check('met euroteken ervoor', leesBedrag('€ 1.975,50') === 1975.5)
check('onzin levert niets op', leesBedrag('abc') === undefined)

/* --- datums --- */

const eersteMaart = leesDatum('1 maart 2026')
check('geschreven datum', new Date(eersteMaart!).getMonth() === 2
  && new Date(eersteMaart!).getDate() === 1
  && new Date(eersteMaart!).getFullYear() === 2026)

const metStreepjes = leesDatum('01-03-2026')
check('datum met streepjes', new Date(metStreepjes!).getMonth() === 2
  && new Date(metStreepjes!).getFullYear() === 2026)

const isoDatum = leesDatum('2026-03-01')
check('datum in ISO', new Date(isoDatum!).getMonth() === 2
  && new Date(isoDatum!).getFullYear() === 2026)

check('afgekorte maand', leesDatum('15 sep 2025') !== undefined)
check('geen datum levert niets op', leesDatum('ergens volgend jaar') === undefined)

/* --- een heel contract --- */

const CONTRACT = `
ARBEIDSOVEREENKOMST VOOR BEPAALDE TIJD

De ondergetekenden: Truckwash1 Group B.V., hierna te noemen werkgever, en
de heer T. Verhoeven, hierna te noemen werknemer.

Artikel 1 - Functie en aanvang
Werknemer treedt in dienst per 1 maart 2026 in de functie van Wasmedewerker.
De overeenkomst is aangegaan voor bepaalde tijd en eindigt van rechtswege op
28 februari 2027.

Artikel 2 - Arbeidsduur
De arbeidsduur bedraagt 38 uur per week.

Artikel 3 - Salaris
Het bruto maandsalaris bedraagt EUR 2.850,00 per maand bij een volledige
arbeidsduur, exclusief 8% vakantiebijslag.
`

const uitContract = vindGegevens(CONTRACT)

check('de functie komt eruit', uitContract.functie?.waarde === 'Wasmedewerker',
  String(uitContract.functie?.waarde))
check('het maandsalaris komt eruit', uitContract.maandloon?.waarde === 2850,
  String(uitContract.maandloon?.waarde))
check('de uren komen eruit', uitContract.urenPerWeek?.waarde === 38,
  String(uitContract.urenPerWeek?.waarde))

const gevondenStart = uitContract.startDatum?.waarde
check('de ingangsdatum komt eruit',
  !!gevondenStart && new Date(gevondenStart).getFullYear() === 2026
  && new Date(gevondenStart).getMonth() === 2,
  gevondenStart ? new Date(gevondenStart).toISOString() : 'niets')

const gevondenEind = uitContract.eindDatum?.waarde
check('de einddatum komt eruit',
  !!gevondenEind && new Date(gevondenEind).getFullYear() === 2027
  && new Date(gevondenEind).getMonth() === 1,
  gevondenEind ? new Date(gevondenEind).toISOString() : 'niets')

check('bij een einddatum wordt onbepaalde tijd niet gemeld',
  uitContract.onbepaaldeTijd === undefined)
check('er is genoeg gevonden om voor te stellen', aantalGevonden(uitContract) >= 5,
  String(aantalGevonden(uitContract)))
check('bij elke vondst staat de zin waarin hij stond',
  (uitContract.maandloon?.bron ?? '').toLowerCase().includes('bruto'),
  String(uitContract.maandloon?.bron))

/* --- onbepaalde tijd, met een uurloon --- */

const ONBEPAALD = `
Werknemer treedt in dienst per 01-09-2025 in de functie van Voorman wasstraat.
De overeenkomst wordt aangegaan voor onbepaalde tijd.
De arbeidsduur bedraagt 40 uur per week.
Het bruto uurloon bedraagt EUR 24,50.
`

const contractOnbepaald = vindGegevens(ONBEPAALD)
check('onbepaalde tijd wordt herkend', contractOnbepaald.onbepaaldeTijd?.waarde === true)
check('en er is dan geen einddatum', contractOnbepaald.eindDatum === undefined)
check('het uurloon komt eruit', contractOnbepaald.uurloon?.waarde === 24.5,
  String(contractOnbepaald.uurloon?.waarde))
check('de functie met twee woorden ook',
  contractOnbepaald.functie?.waarde === 'Voorman wasstraat',
  String(contractOnbepaald.functie?.waarde))

/* --- onzin mag niets opleveren --- */

const ONZIN = 'Beste Tom, hierbij de notulen van de vergadering van dinsdag.'
const contractOnzin = vindGegevens(ONZIN)
check('uit een gewone brief komt niets', aantalGevonden(contractOnzin) === 0,
  JSON.stringify(contractOnzin))

/* --- bedragen die geen salaris zijn worden niet aangezien --- */

const RAAR = 'Het bruto maandsalaris bedraagt EUR 12,00 per maand.'
check('een onmogelijk maandloon wordt niet overgenomen',
  vindGegevens(RAAR).maandloon === undefined)

/* --- uurloon uit een maandloon --- */

check('uurloon afgeleid uit maandloon en uren',
  afgeleidUurloon(2850, 38) === 17.31, String(afgeleidUurloon(2850, 38)))

/* ==================================================================== */

console.log('\n26. Wijzigingen in een dossier')

const {
  wijzigingen: wijzigRepo, huidigeWaarde, toonWaarde, gelijk, openVerzoeken,
} = await import('../src/lib/wijzigingen')

const alleMensen2 = await db.users.toArray()
const tomW = alleMensen2.find((u) => u.id === 'u_wasser')!
const nourW = alleMensen2.find((u) => u.id === 'u_wasser3')!
const ilseW = alleMensen2.find((u) => u.id === 'u_manager')!

check('de huidige functie komt uit het profiel',
  huidigeWaarde('function', tomW) === tomW.function)
check('het uurtarief komt uit het afgeschermde deel',
  huidigeWaarde('hourlyRate', tomW, await db.personnelPrivate.get(tomW.id)) === 24.5)

check('twee lijsten met dezelfde inhoud zijn gelijk',
  gelijk(['a', 'b'], ['b', 'a']))
check('een lege waarde en niets zijn gelijk', gelijk('', undefined))
check('verschillende waarden zijn niet gelijk', !gelijk(38, 40))

/* --- een verzoek indienen --- */

const verzoek = await wijzigRepo.aanvragen({
  persoon: tomW,
  prive: await db.personnelPrivate.get(tomW.id),
  // Hij stond al op 40; 42 is dus een echte verandering.
  voorstel: { contractHours: 42, function: 'Allround wasmedewerker' },
  reden: 'Draait sinds september structureel meer uren.',
  door: nourW,
})

check('het verzoek is aangemaakt', !!verzoek)
check('met twee velden erin', verzoek?.velden.length === 2, String(verzoek?.velden.length))
check('de oude waarde staat erbij',
  verzoek?.velden.find((v) => v.veld === 'contractHours')?.oud === tomW.contractHours)
check('het staat open', verzoek?.status === 'open')

const crBericht = (await db.notifications.toArray()).filter(
  (n) => n.title.includes('Wijziging voorgesteld'))
check('het management krijgt bericht', crBericht.length > 0)

/* --- velden die niet veranderen vallen eruit --- */

const leegVerzoek = await wijzigRepo.aanvragen({
  persoon: tomW,
  voorstel: { function: tomW.function },
  reden: 'Niets aan de hand',
  door: nourW,
})
check('een voorstel zonder verandering levert niets op', leegVerzoek === null)

/* --- goedkeuren voert door --- */

await wijzigRepo.goedkeuren(verzoek!, ilseW)

const naGoedkeuren = await db.users.get(tomW.id)
check('de contracturen zijn doorgevoerd', naGoedkeuren?.contractHours === 42,
  String(naGoedkeuren?.contractHours))
check('de functie ook', naGoedkeuren?.function === 'Allround wasmedewerker')
check('het verzoek staat op goedgekeurd',
  (await db.changeRequests.get(verzoek!.id))?.status === 'goedgekeurd')
check('met wie het goedkeurde',
  (await db.changeRequests.get(verzoek!.id))?.beslistDoorNaam === ilseW.name)

check('een tweede keer goedkeuren doet niets',
  (await wijzigRepo.goedkeuren(
    (await db.changeRequests.get(verzoek!.id))!, ilseW))?.beslistOp
  === (await db.changeRequests.get(verzoek!.id))?.beslistOp)

/* --- een uurloon gaat naar het afgeschermde deel --- */

const loonVerzoek = await wijzigRepo.aanvragen({
  persoon: naGoedkeuren!,
  prive: await db.personnelPrivate.get(tomW.id),
  voorstel: { hourlyRate: 26 },
  reden: 'Hoort bij de nieuwe functie.',
  door: nourW,
})
await wijzigRepo.goedkeuren(loonVerzoek!, ilseW)

check('het uurloon staat in het afgeschermde deel',
  (await db.personnelPrivate.get(tomW.id))?.hourlyRate === 26)
check('en niet in het profiel',
  (await db.users.get(tomW.id))?.hourlyRate !== 26)

/* --- afwijzen --- */

const afTeWijzenVerzoek = await wijzigRepo.aanvragen({
  persoon: naGoedkeuren!,
  voorstel: { function: 'Vestigingsmanager' },
  reden: 'Wil doorgroeien.',
  door: nourW,
})
await wijzigRepo.afwijzen(afTeWijzenVerzoek!, 'Eerst het gesprek voeren.', ilseW)

check('het verzoek is afgewezen',
  (await db.changeRequests.get(afTeWijzenVerzoek!.id))?.status === 'afgewezen')
check('met de reden erbij',
  (await db.changeRequests.get(afTeWijzenVerzoek!.id))?.afwijzingReden
  === 'Eerst het gesprek voeren.')
check('en de functie is niet veranderd',
  (await db.users.get(tomW.id))?.function === 'Allround wasmedewerker')

/* --- intrekken --- */

const intrekbaar = await wijzigRepo.aanvragen({
  persoon: (await db.users.get(tomW.id))!,
  voorstel: { contractHours: 32 },
  reden: 'Toch even navragen.',
  door: nourW,
})
await wijzigRepo.intrekken(intrekbaar!)
check('een ingetrokken verzoek telt niet meer mee',
  !openVerzoeken(await db.changeRequests.toArray()).some((v) => v.id === intrekbaar!.id))

/* --- leesbaar in het scherm --- */

const locatiesW = await db.locations.toArray()
check('een uurtarief leest als bedrag',
  toonWaarde('hourlyRate', 26, { locaties: locatiesW, mensen: alleMensen2 }) === '€ 26,00')
check('een vestiging leest als naam',
  toonWaarde('locationId', 'loc_utr', { locaties: locatiesW, mensen: alleMensen2 }) === 'Utrecht')
check('lege waarden lezen als een streepje',
  toonWaarde('function', undefined, { locaties: locatiesW, mensen: alleMensen2 }) === '—')

/* --- alles overleeft de rondgang --- */

await sync()
await db.changeRequests.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('de verzoeken staan op de server',
  (await db.changeRequests.get(verzoek!.id))?.status === 'goedgekeurd')


/* ==================================================================== */

console.log('\n27. Agenda, verjaardagen en jubilea')

const {
  gebeurtenissen, perDag, beginVanDag, teVieren, feliciteer, MIJLPALEN,
  agenda: agendaRepo,
} = await import('../src/lib/agenda')

const DAG_MS = 86_400_000

/* Een vaste dag om mee te rekenen: 15 juni 2026. */
const peildag = new Date(2026, 5, 15).getTime()

const agendaMensen = [
  {
    id: 'zt_a', email: 'a@x.nl', password: '', name: 'Anna Bakker',
    roles: ['employee'] as never, active: true, locationId: 'loc_utr',
    // Jarig op de peildag, en precies vijf jaar in dienst.
    startDate: new Date(2021, 5, 15).getTime(),
    updatedAt: 0,
  },
  {
    id: 'zt_b', email: 'b@x.nl', password: '', name: 'Bram Jansen',
    roles: ['employee'] as never, active: true, locationId: 'loc_utr',
    // Begint vandaag.
    startDate: peildag,
    updatedAt: 0,
  },
  {
    id: 'zt_c', email: 'c@x.nl', password: '', name: 'Carla Smit',
    roles: ['employee'] as never, active: true, locationId: 'loc_utr',
    // Drie jaar in dienst: geen mijlpaal.
    startDate: new Date(2023, 5, 15).getTime(),
    updatedAt: 0,
  },
  {
    id: 'zt_d', email: 'd@x.nl', password: '', name: 'Daan Weg',
    roles: ['employee'] as never, active: false, locationId: 'loc_utr',
    startDate: new Date(2016, 5, 15).getTime(),
    updatedAt: 0,
  },
]

const agendaPrive = [
  { id: 'zt_a', userId: 'zt_a', birthDate: new Date(1990, 5, 15).getTime(), updatedAt: 0 },
  { id: 'zt_c', userId: 'zt_c', birthDate: new Date(1985, 0, 3).getTime(), updatedAt: 0 },
]

const gevonden = gebeurtenissen({
  van: beginVanDag(peildag),
  tot: beginVanDag(peildag) + DAG_MS,
  ik: null,
  items: [],
  mensen: agendaMensen as never,
  prive: agendaPrive as never,
  shifts: [],
  documenten: [],
  onderhoud: [],
})

const soorten = gevonden.map((g) => g.soort)

check('een verjaardag komt in de agenda', soorten.includes('verjaardag'))
check('een jubileum van vijf jaar ook', soorten.includes('jubileum'))
check('een eerste werkdag ook', soorten.includes('indienst'))
check('drie jaar in dienst is geen jubileum',
  !gevonden.some((g) => g.soort === 'jubileum' && g.titel.includes('Carla')))
check('wie uit dienst is telt niet mee',
  !gevonden.some((g) => g.titel.includes('Daan')))
check('de leeftijd staat erbij',
  gevonden.find((g) => g.soort === 'verjaardag')?.toelichting === 'Wordt 36',
  String(gevonden.find((g) => g.soort === 'verjaardag')?.toelichting))
check('het jubileum noemt het aantal jaren',
  (gevonden.find((g) => g.soort === 'jubileum')?.titel ?? '').includes('5 jaar'),
  String(gevonden.find((g) => g.soort === 'jubileum')?.titel))

check('een verjaardag buiten de periode telt niet mee',
  !gevonden.some((g) => g.titel.includes('Carla') && g.soort === 'verjaardag'))
check('mijlpalen bevatten geen 3', !MIJLPALEN.includes(3))
check('en wel 5, 10 en 25',
  MIJLPALEN.includes(5) && MIJLPALEN.includes(10) && MIJLPALEN.includes(25))

/* --- een aflopend document --- */

const metDocument = gebeurtenissen({
  van: beginVanDag(peildag),
  tot: beginVanDag(peildag) + DAG_MS,
  ik: null,
  items: [],
  mensen: agendaMensen as never,
  prive: agendaPrive as never,
  shifts: [],
  documenten: [{
    id: 'zt_doc', userId: 'zt_a', userName: 'Anna Bakker', kind: 'contract',
    title: 'Arbeidsovereenkomst', storagePath: 'x', mime: 'application/pdf',
    sizeBytes: 1, visibleToEmployee: true, uploadedBy: 'x', uploadedByName: 'x',
    uploadedAt: 0, requiresSignature: false, expiresAt: peildag, updatedAt: 0,
  }] as never,
  onderhoud: [],
})
check('een aflopend contract staat in de agenda',
  metDocument.some((g) => g.soort === 'contract'))

/* --- per dag groeperen --- */

const gegroepeerd = perDag(gevonden)
check('alles valt op dezelfde dag', gegroepeerd.size === 1, String(gegroepeerd.size))
check('en er staat meer dan één ding op',
  (gegroepeerd.get(beginVanDag(peildag)) ?? []).length >= 3)

/* --- wat er te vieren valt --- */

const feest = teVieren(agendaMensen as never, agendaPrive as never, peildag)
check('drie dingen te vieren', feest.length === 3, String(feest.length))
check('het id ligt vast op persoon en jaar',
  feest.some((f) => f.id === 'nt_vj_zt_a_2026'), feest.map((f) => f.id).join(','))
check('de tekst spreekt iemand aan met zijn voornaam',
  feest.some((f) => f.titel.includes('Anna')))
check('een dag zonder iets te vieren levert niets op',
  teVieren(agendaMensen as never, agendaPrive as never,
    new Date(2026, 6, 4).getTime()).length === 0)

/* --- feliciteren stuurt één bericht per persoon per jaar --- */

for (const m of agendaMensen) await db.users.put(m as never)
for (const pv of agendaPrive) await db.personnelPrivate.put(pv as never)

const ilseA = (await db.users.get('u_manager'))!
const eersteRonde = await feliciteer(ilseA, peildag)
check('er zijn felicitaties verstuurd', eersteRonde === 3, String(eersteRonde))

const tweedeRonde = await feliciteer(ilseA, peildag)
check('een tweede ronde stuurt niets extra', tweedeRonde === 0, String(tweedeRonde))

const gefeliciteerd = (await db.notifications.toArray()).filter(
  (n) => n.id.startsWith('nt_vj_') || n.id.startsWith('nt_jub_') || n.id.startsWith('nt_id_'))
check('en er staan er precies drie', gefeliciteerd.length === 3, String(gefeliciteerd.length))

/* --- een afspraak toevoegen --- */

const afspraak = await agendaRepo.create({
  title: 'Keuring hogedrukinstallatie',
  soort: 'onderhoud',
  startAt: peildag + 9 * 3_600_000,
  endAt: peildag + 11 * 3_600_000,
  locationId: 'loc_utr',
  deelnemers: ['zt_a'],
  door: ilseA,
})

check('de afspraak staat erin', !!(await db.agendaItems.get(afspraak.id)))
check('met de juiste soort', afspraak.soort === 'onderhoud')

const deelnemerBericht = (await db.notifications.toArray()).filter(
  (n) => n.toUserId === 'zt_a' && n.title.includes('In je agenda'))
check('de deelnemer krijgt bericht', deelnemerBericht.length === 1)

/*
 * Een afspraak hangt aan een vestiging, en die telt mee. Ilse zit op het
 * hoofdkantoor en mag overal bij; Anna werkt in Utrecht en ziet hem ook.
 */
const alsIlse = gebeurtenissen({
  van: beginVanDag(peildag),
  tot: beginVanDag(peildag) + DAG_MS,
  ik: ilseA,
  items: [afspraak],
  mensen: agendaMensen as never,
  prive: agendaPrive as never,
  shifts: [],
  documenten: [],
  onderhoud: [],
})
check('de afspraak komt terug in de agenda',
  alsIlse.some((g) => g.id === afspraak.id))

const elders = (await db.users.toArray()).find(
  (u) => u.locationId && u.locationId !== 'loc_utr' && !u.allLocations)!
const alsIemandElders = gebeurtenissen({
  van: beginVanDag(peildag),
  tot: beginVanDag(peildag) + DAG_MS,
  ik: elders,
  items: [afspraak],
  mensen: agendaMensen as never,
  prive: agendaPrive as never,
  shifts: [],
  documenten: [],
  onderhoud: [],
})
check('en niet bij iemand van een andere vestiging',
  !alsIemandElders.some((g) => g.id === afspraak.id), elders.name)

const metAfspraak = alsIlse
check('hele dagen staan boven de tijdgebonden dingen',
  metAfspraak[0].heleDag === true)

await agendaRepo.remove(afspraak.id)
check('weghalen werkt', !(await db.agendaItems.get(afspraak.id)))

/* --- alles overleeft de rondgang --- */

const blijvend = await agendaRepo.create({
  title: 'Zelftest blijft staan',
  soort: 'afspraak',
  startAt: peildag,
  endAt: peildag + 3_600_000,
  door: ilseA,
})
await sync()
await db.agendaItems.clear()
await setMeta(LAST_SYNC, 0)
await sync()
check('de agenda staat op de server', !!(await db.agendaItems.get(blijvend.id)))

/* ==================================================================== *
 *  Werkgevers
 *
 *  De vraag die dit hele blok moest beantwoorden: als een werkgever iemand
 *  uit zijn chauffeurs gooit, ziet die chauffeur de ritten van dat bedrijf
 *  dan echt niet meer? Ook de ritten die hij zelf heeft gebracht?
 * ==================================================================== */

{
  console.log('\n— werkgevers —')

  const {
    werkgevers: wgRepo, koppelingen: kopRepo, regels: regelRepo,
    magAfnemen, mijnWerkgevers, chauffeursVan, openKoppelverzoeken, beurtenVan,
  } = await import('../src/lib/werkgevers')

  const ellen = { id: 'zt_ellen', name: 'Ellen Jansen' }
  const rick = { id: 'zt_rick', name: 'Rick Molenaar' }

  await db.users.bulkPut([
    { id: 'zt_ellen', email: 'ellen@zt.nl', password: '', name: 'Ellen Jansen',
      roles: ['employer'], active: true, updatedAt: 0 },
    { id: 'zt_rick', email: 'rick@zt.nl', password: '', name: 'Rick Molenaar',
      roles: ['employee'], active: true, updatedAt: 0 },
  ] as never)

  /* --- aanmaken en aanvragen --- */

  const wgActief = await wgRepo.aanmaken({
    naam: 'Zelftest Transport', contactNaam: 'Ellen Jansen',
    email: 'ellen@zt.nl', beheerders: ['zt_ellen'], door: ellen,
  })
  check('management maakt een werkgever meteen actief aan', wgActief.status === 'actief')

  const wgAanvraag = await wgRepo.aanvragen({
    naam: 'Zelftest Koeltransport', contactNaam: 'Wouter Bergman',
    email: 'wouter@zt.nl', door: ellen,
  })
  check('een aanvraag wacht op akkoord', wgAanvraag.status === 'aangevraagd')
  check('de aanvrager staat er als beheerder bij',
    wgAanvraag.beheerders.includes('zt_ellen'))

  const naGoedkeuren = await wgRepo.goedkeuren(wgAanvraag, { id: 'zt_baas', name: 'Ilse' })
  check('goedkeuren zet hem op actief', naGoedkeuren?.status === 'actief')
  check('en noteert wie het deed', naGoedkeuren?.beslistDoorNaam === 'Ilse')

  const naAfwijzen = await wgRepo.afwijzen(
    (await db.employers.get(wgActief.id))!, 'Geen contract', { id: 'zt_baas', name: 'Ilse' })
  check('afwijzen bewaart de reden', naAfwijzen?.afwijzingReden === 'Geen contract')
  await wgRepo.update(wgActief.id, { status: 'actief', afwijzingReden: undefined })

  /* --- een chauffeur koppelen --- */

  const koppeling = {
    id: 'zt_kop', werkgeverId: wgActief.id, werkgeverNaam: wgActief.naam,
    userId: 'zt_rick', naam: 'Rick Molenaar', email: 'rick@zt.nl',
    kentekens: [] as string[], status: 'wacht op akkoord' as const,
    uitgenodigdOp: Date.now(), uitgenodigdDoor: 'zt_ellen',
    uitgenodigdDoorNaam: 'Ellen Jansen', bestaandAccount: true,
    updatedAt: Date.now(),
  }
  await db.employerLinks.put(koppeling)

  check('een openstaand verzoek komt bij de chauffeur terecht',
    openKoppelverzoeken([koppeling], { id: 'zt_rick', email: 'rick@zt.nl' } as never).length === 1)
  check('en niet bij iemand anders',
    openKoppelverzoeken([koppeling], { id: 'zt_ander', email: 'x@zt.nl' } as never).length === 0)
  check('een verzoek op mijn adres telt ook zonder gekoppeld dossier',
    openKoppelverzoeken(
      [{ ...koppeling, userId: undefined }],
      { id: 'zt_rick', email: 'RICK@ZT.NL' } as never).length === 1)

  const actief = await kopRepo.aannemen(koppeling, rick)
  check('akkoord maakt de koppeling actief', actief.status === 'actief')
  check('en zet de datum erbij', typeof actief.gekoppeldOp === 'number')

  /* --- wat de chauffeur ziet --- */

  const zijnJobs = [
    { id: 'ztj_1', werkgeverId: wgActief.id, createdBy: 'zt_rick', scheduledAt: 3 },
    { id: 'ztj_2', werkgeverId: wgActief.id, createdBy: 'zt_ellen', scheduledAt: 2 },
    { id: 'ztj_3', werkgeverId: 'wg_anders', createdBy: 'zt_rick', scheduledAt: 1 },
  ] as never[]

  check('de werkgever ziet alleen zijn eigen ritten',
    beurtenVan(zijnJobs, wgActief.id).length === 2)
  check('nieuwste bovenaan', beurtenVan(zijnJobs, wgActief.id)[0].id === 'ztj_1')

  const alleWg = await db.employers.toArray()
  check('de chauffeur ziet zijn werkgever',
    mijnWerkgevers(alleWg, [actief], { id: 'zt_rick', email: 'rick@zt.nl' } as never)
      .some((w) => w.id === wgActief.id))

  /* --- en dit is de kern: losgekoppeld is losgekoppeld --- */

  const beeindigd = await kopRepo.beeindigen(actief, 'Uit dienst', ellen)
  check('beëindigen bewaart de reden', beeindigd.beeindigdReden === 'Uit dienst')
  check('de koppeling blijft bestaan als historie',
    !!(await db.employerLinks.get('zt_kop')))
  check('maar de chauffeur ziet de werkgever niet meer',
    mijnWerkgevers(alleWg, [beeindigd], { id: 'zt_rick', email: 'rick@zt.nl' } as never)
      .length === 0)
  check('ook niet de ritten die hij zelf bracht',
    mijnWerkgevers(alleWg, [beeindigd], { id: 'zt_rick', email: 'rick@zt.nl' } as never)
      .flatMap((w) => beurtenVan(zijnJobs, w.id)).length === 0)

  const losBericht = (await db.notifications.toArray())
    .find((n) => n.toUserId === 'zt_rick' && n.title.includes('losgekoppeld'))
  check('en hij krijgt er bericht van', !!losBericht)
  check('met de mededeling dat zijn account van hem blijft',
    (losBericht?.body ?? '').includes('blijven gewoon van jou'))

  check('een geweigerd verzoek levert ook niets op',
    mijnWerkgevers(alleWg,
      [{ ...actief, status: 'geweigerd' as const }],
      { id: 'zt_rick', email: 'rick@zt.nl' } as never).length === 0)

  check('de beheerder blijft zijn eigen bedrijf wel zien',
    mijnWerkgevers(alleWg, [beeindigd], { id: 'zt_ellen', email: 'ellen@zt.nl' } as never)
      .some((w) => w.id === wgActief.id))

  /* --- de volgorde in de lijst --- */

  const gesorteerd = chauffeursVan([
    { ...beeindigd, id: 'a', naam: 'Zeger' },
    { ...actief, id: 'b', naam: 'Bart' },
    { ...koppeling, id: 'c', naam: 'Anna' },
  ], wgActief.id)
  check('actieve chauffeurs staan bovenaan', gesorteerd[0].naam === 'Bart')
  check('en wie weg is onderaan', gesorteerd[2].naam === 'Zeger')

  /* --- afspraken over wat er afgenomen mag worden --- */

  await regelRepo.toevoegen({
    werkgeverId: wgActief.id, service: 'polish',
    soort: 'niet toegestaan', reden: 'Gaat via de dealer', door: ellen,
  })
  await regelRepo.toevoegen({
    werkgeverId: wgActief.id, kenteken: 'aa-01-bb', service: 'tankreiniging',
    soort: 'alleen met akkoord', door: ellen,
  })
  const mijnRegels = (await db.employerRules.toArray())
    .filter((r) => r.werkgeverId === wgActief.id)

  check('een kenteken wordt in hoofdletters bewaard',
    mijnRegels.some((r) => r.kenteken === 'AA-01-BB'))

  const polish = magAfnemen(mijnRegels, {
    werkgeverId: wgActief.id, kenteken: 'AA-99-ZZ', service: 'polish' })
  check('een verbod zonder kenteken geldt voor alle wagens', !polish.toegestaan)
  check('en noemt de reden', polish.reden === 'Gaat via de dealer')

  const tankDezeWagen = magAfnemen(mijnRegels, {
    werkgeverId: wgActief.id, kenteken: 'AA-01-BB', service: 'tankreiniging' })
  check('een voorwaarde mag wel, maar met akkoord',
    tankDezeWagen.toegestaan && tankDezeWagen.akkoordNodig)

  const tankAndereWagen = magAfnemen(mijnRegels, {
    werkgeverId: wgActief.id, kenteken: 'AA-77-XX', service: 'tankreiniging' })
  check('bij een andere wagen geldt die voorwaarde niet',
    tankAndereWagen.toegestaan && !tankAndereWagen.akkoordNodig)

  check('een kleine letter in het kenteken maakt niet uit',
    magAfnemen(mijnRegels, {
      werkgeverId: wgActief.id, kenteken: 'aa-01-bb', service: 'tankreiniging' }).akkoordNodig)

  check('wat niet geregeld is mag gewoon',
    magAfnemen(mijnRegels, {
      werkgeverId: wgActief.id, kenteken: 'AA-01-BB', service: 'buitenwas' }).toegestaan)

  check('de regels van een ander bedrijf tellen niet mee',
    magAfnemen(mijnRegels, {
      werkgeverId: 'wg_ergens_anders', service: 'polish' }).toegestaan)

  const strengste = magAfnemen([
    ...mijnRegels,
    { id: 'zt_r3', werkgeverId: wgActief.id, service: 'polish',
      soort: 'alleen met akkoord', aangemaaktDoor: 'zt_ellen',
      aangemaaktOp: 0, updatedAt: 0 } as never,
  ], { werkgeverId: wgActief.id, service: 'polish' })
  check('staat er allebei iets, dan geldt het verbod', !strengste.toegestaan)

  const legeRegel = magAfnemen([
    { id: 'zt_r4', werkgeverId: wgActief.id, soort: 'niet toegestaan',
      aangemaaktDoor: 'zt_ellen', aangemaaktOp: 0, updatedAt: 0 } as never,
  ], { werkgeverId: wgActief.id, service: 'polish' })
  check('een regel zonder behandeling én zonder product zegt niets', legeRegel.toegestaan)

  /* --- alles overleeft de rondgang --- */

  await sync()
  await db.employers.clear()
  await db.employerLinks.clear()
  await db.employerRules.clear()
  await setMeta(LAST_SYNC, 0)
  await sync()
  check('de werkgever staat op de server', !!(await db.employers.get(wgActief.id)))
  check('de koppeling ook', (await db.employerLinks.get('zt_kop'))?.status === 'beëindigd')
  check('en de afspraken', (await db.employerRules.toArray())
    .filter((r) => r.werkgeverId === wgActief.id).length === 2)

}

/* ==================================================================== *
 *  Bijlagen bekijken
 *
 *  Wat een bestand is bepalen we aan de extensie, niet aan wat de afzender
 *  zegt dat het is. Post komt van buiten, en iets dat zichzelf een plaatje
 *  noemt is daarmee nog geen plaatje.
 * ==================================================================== */

console.log('\n— bijlagen bekijken —')

{
  const {
    soortVan, extensieVan, grootteVan, MAX_TONEN, TeGroot,
  } = await import('../src/lib/bekijken')
  const { magOpenen, controleLabel } = await import('../src/lib/postbus')

  /* --- wat tonen we zelf --- */

  check('een jpeg is beeld', soortVan('bon.jpg', 'image/jpeg') === 'beeld')
  check('een png ook', soortVan('scan.PNG') === 'beeld')
  check('een pdf is een pdf', soortVan('factuur.pdf', 'application/pdf') === 'pdf')
  check('een csv is tekst', soortVan('mutaties.csv', 'text/csv') === 'tekst')

  /* --- en wat niet --- */

  check('een zip tonen we niet', soortVan('spullen.zip', 'application/zip') === 'onbekend')
  check('een exe al helemaal niet', soortVan('setup.exe') === 'onbekend')
  check('een bestand zonder naam ook niet', soortVan('') === 'onbekend')

  /*
   * Dit is het geval waar het om gaat: de naam zegt plaatje, de afzender
   * zegt iets anders. Twee bronnen die elkaar tegenspreken is precies het
   * moment om niets te doen.
   */
  check('naam en type die elkaar tegenspreken leveren niets op',
    soortVan('vakantiefoto.png', 'application/x-msdownload') === 'onbekend')
  /*
   * Hier stond dat rapport.pdf met application/octet-stream 'onbekend' moest
   * opleveren. Die verwachting was fout, en hij hield de fout in stand: een
   * heleboel mailprogramma's sturen octet-stream mee bij élke bijlage, dus
   * gewone facturen waren niet te openen. Octet-stream is geen tegenspraak
   * maar een schouderophalen.
   */
  check('en octet-stream spreekt niets tegen -- dat betekent "geen idee"',
    soortVan('rapport.pdf', 'application/octet-stream') === 'pdf')
  check('terwijl een type dat wél iets anders beweert nog steeds wint',
    soortVan('rapport.pdf', 'application/vnd.ms-excel') === 'onbekend')

  check('zonder extensie mag het type het zeggen',
    soortVan('bijlage', 'image/png') === 'beeld')
  check('maar dan ook alleen voor wat we tekenen',
    soortVan('bijlage', 'application/zip') === 'onbekend')

  check('de extensie komt er los uit', extensieVan('Factuur.2026.PDF') === 'pdf')
  check('geen punt betekent geen extensie', extensieVan('LEESMIJ') === '')

  /* --- leesbare grootte --- */

  check('bytes blijven bytes', grootteVan(900) === '900 B')
  check('kilobytes worden afgerond', grootteVan(2048) === '2 kB')
  check('megabytes met één decimaal', grootteVan(3_500_000) === '3.3 MB')
  check('niets is niets', grootteVan(undefined) === '')

  check('er zit een dak op wat we inladen', MAX_TONEN === 25 * 1024 * 1024)
  check('een te groot bestand zegt wat het is',
    new TeGroot(80 * 1024 * 1024).message.includes('80.0 MB'))

  /* --- wat er tegengehouden is, gaat niet open --- */

  check('een schone bijlage mag open',
    magOpenen({ naam: 'a.pdf', mime: 'application/pdf', size: 1, path: 'p', controle: 'schoon' }))
  check('een verdachte niet',
    !magOpenen({ naam: 'a.pdf', mime: 'application/pdf', size: 1, path: 'p', controle: 'verdacht' }))
  check('een mislukte controle ook niet',
    !magOpenen({ naam: 'a.pdf', mime: 'application/pdf', size: 1, path: 'p', controle: 'mislukt' }))
  check('van vóór de controle mag wel, met een waarschuwing',
    magOpenen({ naam: 'a.pdf', mime: 'application/pdf', size: 1, path: 'p' }) &&
    controleLabel({ naam: 'a.pdf', mime: 'application/pdf', size: 1, path: 'p' })?.tone === 'warn')
  check('en een schone krijgt geen stempel',
    controleLabel({ naam: 'a.pdf', mime: 'application/pdf', size: 1, path: 'p', controle: 'schoon' }) === null)

  /*
   * En het geval waar het om ging: de bijlage zat wel in de mail, maar er
   * staat niets in de opslag. Dat is iets anders dan tegengehouden, en het
   * hoort ook anders te heten.
   */
  const nietBinnen = {
    naam: 'factuur.pdf', mime: 'application/pdf', size: 0, path: '',
    controle: 'mislukt' as const,
    controleReden: 'De webhook bevatte geen inhoud voor deze bijlage.',
  }
  check('zonder pad valt er niets te openen', !magOpenen(nietBinnen))
  check('en dat heet niet "tegengehouden"',
    controleLabel(nietBinnen)?.label === 'Niet binnengekomen',
    String(controleLabel(nietBinnen)?.label))
  check('een bijlage zonder pad die wel verdacht is heet dat ook',
    controleLabel({ ...nietBinnen, controle: 'verdacht' })?.label !== 'Niet binnengekomen')
}

/* ==================================================================== *
 *  Van melding naar plan
 *
 *  De kern: een plan bestaat uit stappen die je los kunt uitzetten, en wat
 *  er uitstaat is een besluit dat de melder hoort te horen -- geen "later
 *  misschien" dat stil verdwijnt.
 * ==================================================================== */

console.log('\n— van melding naar plan —')

{
  const {
    plannen: planRepo, vragenVoor, opdrachtTekst, omvangVan, terBeoordeling,
    planVan, gesprekUit,
  } = await import('../src/lib/devplan')
  const { tickets: tkRepo, ticketMessages: tmRepo } = await import('../src/lib/tickets')

  const dev = { id: 'zt_dev', name: 'Sem' }
  const baas = { id: 'zt_baas2', name: 'Ilse' }
  const melder = { id: 'zt_melder', name: 'Tom Verhoeven', locationId: 'loc_utr' }

  await db.users.bulkPut([
    { id: 'zt_dev', email: 'dev@zt.nl', password: '', name: 'Sem',
      roles: ['developer'], active: true, updatedAt: 0 },
    { id: 'zt_baas2', email: 'ilse@zt.nl', password: '', name: 'Ilse',
      roles: ['management'], active: true, updatedAt: 0 },
    { id: 'zt_melder', email: 'tom@zt.nl', password: '', name: 'Tom Verhoeven',
      roles: ['employee'], active: true, locationId: 'loc_utr', updatedAt: 0 },
  ] as never)

  /* --- de vaste vragen --- */

  check('een fout krijgt andere vragen dan een wens',
    vragenVoor('fout')[0].id !== vragenVoor('wens')[0].id)
  check('bij een fout wordt gevraagd wat je verwachtte',
    vragenVoor('fout').some((v) => v.id === 'verwacht'))
  check('bij een wens juist hoe je het nu doet',
    vragenVoor('wens').some((v) => v.id === 'nu'))
  check('elke soort melding heeft vragen',
    (['fout', 'wens', 'traag', 'vraag'] as const).every((k) => vragenVoor(k).length > 0))
  check('er staan keuzes bij waar dat kan',
    vragenVoor('fout').some((v) => (v.keuzes?.length ?? 0) > 0))

  /* --- een melding met een gesprek eronder --- */

  const melding = await tkRepo.create({
    title: 'Kan geen wasbeurt afmelden op de telefoon',
    description: 'Ik druk op gereed en er gebeurt niets.',
    kind: 'fout',
    priority: 'hoog',
    by: melder,
    fromPage: 'vandaag',
    appVersion: '1.12.1',
    online: true,
    pendingChanges: 0,
  })

  await tmRepo.send({
    ticketId: melding.id,
    body: '**Wat deed je precies, vlak voordat het misging?**\nIk stond bij baan 2 en tikte op gereed.',
    internal: false,
    by: melder,
  })
  await tmRepo.send({
    ticketId: melding.id,
    body: '**Gebeurt dit elke keer, of af en toe?**\nElke keer',
    internal: false,
    by: melder,
  })
  await tmRepo.send({
    ticketId: melding.id,
    body: 'Even gekeken, lijkt de knop zelf te zijn.',
    internal: true,
    by: dev,
  })

  const berichten = await db.ticketMessages.toArray()
  const gesprek = gesprekUit(berichten, melding.id)
  check('het gesprek komt weer uit de berichten', gesprek.length === 2)
  check('met de vraag apart van het antwoord',
    gesprek[0].vraag === 'Wat deed je precies, vlak voordat het misging?' &&
    gesprek[0].antwoord.startsWith('Ik stond bij baan 2'))
  check('een interne notitie is geen gesprek',
    !gesprek.some((b) => b.antwoord.includes('lijkt de knop')))

  /* --- er komt een plan uit --- */

  const plan = await planRepo.opstellen({ ticket: melding, gesprek, door: dev })
  check('zonder server komt er een geraamte', plan.bron === 'vragenlijst')
  check('en dat geraamte heeft een stap', plan.stappen.length >= 1)
  check('het plan begint als concept', plan.status === 'concept')
  check('alle stappen staan aan', plan.stappen.every((s) => s.gekozen))
  check('de aanleiding bevat wat de melder zei',
    plan.aanleiding.includes('baan 2'))
  check('het plan is bij de melding te vinden',
    planVan(await db.devPlans.toArray(), melding.id)?.id === plan.id)

  /* --- stappen aan en uit --- */

  const metStappen = await planRepo.update(plan.id, {
    stappen: [
      { id: 's1', titel: 'Knop repareren', wat: 'De knop doet weer wat hij belooft',
        risico: 'klein', omvang: 'klein', gekozen: true },
      { id: 's2', titel: 'Bevestiging tonen', wat: 'Kort zichtbaar dat het gelukt is',
        risico: 'klein', omvang: 'klein', gekozen: true },
      { id: 's3', titel: 'Hele scherm herbouwen', wat: 'Alles opnieuw',
        risico: 'groot', omvang: 'groot', gekozen: true },
    ],
  })
  check('drie stappen erin', metStappen?.stappen.length === 3)

  await planRepo.zetStap(plan.id, 's3', false)
  await planRepo.zetStapOpmerking(plan.id, 's3', 'Te groot voor nu, later kijken')
  const naVinkjes = (await db.devPlans.get(plan.id))!
  check('een stap gaat uit', naVinkjes.stappen.find((s) => s.id === 's3')?.gekozen === false)
  check('met de reden erbij',
    naVinkjes.stappen.find((s) => s.id === 's3')?.opmerking === 'Te groot voor nu, later kijken')

  const omvang = omvangVan(naVinkjes)
  check('alleen wat aanstaat telt mee', omvang.stappen === 2)
  check('twee kleine stappen is klein werk', omvang.zwaarte === 'klein')
  check('met de grote stap erbij wordt het groter',
    omvangVan({ ...naVinkjes, stappen: naVinkjes.stappen.map((s) => ({ ...s, gekozen: true })) })
      .zwaarte !== 'klein')

  /* --- beoordelen --- */

  await planRepo.indienen(naVinkjes)
  const ingediend = (await db.devPlans.get(plan.id))!
  check('indienen zet hem op ter beoordeling', ingediend.status === 'ter beoordeling')
  check('en hij staat in de lijst die wacht',
    terBeoordeling(await db.devPlans.toArray()).some((p) => p.id === plan.id))

  const seintje = (await db.notifications.toArray())
    .find((n) => n.title.includes('Plan klaar'))
  check('het management krijgt er bericht van', !!seintje)

  await planRepo.goedkeuren(ingediend, baas, 'Graag eerst op één vestiging')
  const akkoord = (await db.devPlans.get(plan.id))!
  check('goedkeuren legt vast wie het deed', akkoord.beoordeeldDoorNaam === 'Ilse')
  check('en de aantekening', akkoord.opmerking === 'Graag eerst op één vestiging')

  const naarMelder = (await db.ticketMessages.toArray())
    .filter((m) => m.ticketId === melding.id && !m.internal)
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  check('de melder hoort wat er gebouwd wordt',
    naarMelder.body.includes('Knop repareren'))
  check('en ook wat er niet gebeurt',
    naarMelder.body.includes('Hele scherm herbouwen') &&
    naarMelder.body.includes('Te groot voor nu'))
  check('de melding staat daarna in behandeling',
    (await db.tickets.get(melding.id))?.status === 'in behandeling')

  /* --- niets aanvinken is geen akkoord --- */

  const leegPlan = await planRepo.opstellen({ ticket: melding, gesprek: [], door: dev })
  await planRepo.update(leegPlan.id, {
    stappen: leegPlan.stappen.map((s) => ({ ...s, gekozen: false })),
  })
  let geweigerd = false
  try {
    await planRepo.goedkeuren((await db.devPlans.get(leegPlan.id))!, baas)
  } catch {
    geweigerd = true
  }
  check('een plan zonder aangevinkte stappen kun je niet goedkeuren', geweigerd)

  /* --- de opdracht --- */

  const opdracht = opdrachtTekst(akkoord, melding)
  check('de opdracht noemt wat er gebouwd wordt', opdracht.includes('Knop repareren'))
  check('en zet apart wat er niet in zit',
    opdracht.includes('Wat er bewust niet in zit'))
  check('met de reden erbij', opdracht.includes('Te groot voor nu'))
  check('de melding staat erin', opdracht.includes(melding.number))
  check('en wie het goedkeurde', opdracht.includes('Ilse'))
  check('een uitgezette stap staat niet bij het werk',
    opdracht.indexOf('Hele scherm herbouwen') > opdracht.indexOf('Wat er bewust niet in zit'))

  /* --- uitgeleverd --- */

  await planRepo.uitgevoerd(akkoord, '1.13.0', dev)
  const klaar = (await db.devPlans.get(plan.id))!
  check('uitvoeren legt de versie vast', klaar.uitgevoerdIn === '1.13.0')
  check('en de melding gaat op opgelost',
    (await db.tickets.get(melding.id))?.status === 'opgelost')
  check('met het versienummer erbij',
    (await db.tickets.get(melding.id))?.fixedIn === '1.13.0')

  /* --- alles overleeft de rondgang --- */

  await sync()
  await db.devPlans.clear()
  await setMeta(LAST_SYNC, 0)
  await sync()
  const terug = await db.devPlans.get(plan.id)
  check('het plan staat op de server', !!terug)
  check('inclusief de vinkjes',
    terug?.stappen.find((s) => s.id === 's3')?.gekozen === false)
}

/* ==================================================================== *
 *  De rondleiding
 *
 *  Per rol, en per rol een eigen versienummer. Dat laatste is de knop om
 *  hem bij iedereen opnieuw te laten zien als er wezenlijk iets verandert
 *  aan een dashboard.
 * ==================================================================== */

console.log('\n— de rondleiding —')

{
  const {
    RONDLEIDINGEN, merk, moetZien, terugTeKijken, metGezien, zichtbareAanwijzers,
  } = await import('../src/lib/rondleiding')
  const { ROLE_ORDER } = await import('../src/lib/types')

  /* --- er is er een voor elke rol --- */

  check('elke rol heeft een rondleiding',
    ROLE_ORDER.every((r) => !!RONDLEIDINGEN[r]),
    ROLE_ORDER.filter((r) => !RONDLEIDINGEN[r]).join(', '))

  check('en elke rondleiding heeft schermen',
    ROLE_ORDER.every((r) => RONDLEIDINGEN[r].schermen.length >= 3))

  check('met een titel en een tekst die er staan',
    ROLE_ORDER.every((r) => RONDLEIDINGEN[r].schermen.every(
      (s) => s.titel.length > 3 && s.tekst.length > 40)))

  check('de rol in de rondleiding klopt met de sleutel',
    ROLE_ORDER.every((r) => RONDLEIDINGEN[r].rol === r))

  check('geen twee schermen met hetzelfde id binnen één rondleiding',
    ROLE_ORDER.every((r) => {
      const ids = RONDLEIDINGEN[r].schermen.map((s) => s.id)
      return new Set(ids).size === ids.length
    }))

  /* --- het merkje --- */

  check('het merkje bevat de rol en de versie', merk('employee') === 'employee@1')
  check('en verschilt per rol', merk('management') !== merk('employee'))

  /* --- wie moet hem zien --- */

  const nieuw = { id: 'zt_n', roles: ['employee'], seenTours: [] } as never
  const gezien = { id: 'zt_g', roles: ['employee'], seenTours: ['employee@1'] } as never
  const erbij = { id: 'zt_e', roles: ['employee', 'management'],
    seenTours: ['employee@1'] } as never

  check('wie hem nog niet heeft gezien, ziet hem', moetZien(nieuw, 'employee'))
  check('wie hem heeft gezien niet meer', !moetZien(gezien, 'employee'))
  check('maar bij een nieuwe rol wel weer', moetZien(erbij, 'management'))
  check('en niet nog eens voor de rol die hij al kende',
    !moetZien(erbij, 'employee'))
  check('zonder gebruiker gebeurt er niets', !moetZien(null, 'employee'))
  check('en zonder rol ook niet', !moetZien(nieuw, null))

  /*
   * Het geval waar het versienummer voor bestaat: verandert er wezenlijk
   * iets, dan hoogt iemand het op en ziet iedereen met die rol hem opnieuw.
   */
  const oudGezien = { id: 'zt_o', roles: ['employee'], seenTours: ['employee@0'] } as never
  check('een oudere versie telt niet als gezien', moetZien(oudGezien, 'employee'))

  /* --- afvinken --- */

  check('afvinken zet het merkje erbij',
    metGezien(nieuw, 'employee').includes('employee@1'))
  check('en doet dat niet twee keer',
    metGezien(gezien, 'employee').filter((m) => m === 'employee@1').length === 1)
  check('wat er al stond blijft staan',
    metGezien(erbij, 'management').includes('employee@1'))

  /* --- terugkijken --- */

  check('je kunt alleen de rondleidingen van je eigen rollen terugkijken',
    terugTeKijken(erbij).length === 2)
  check('een werknemer krijgt er één', terugTeKijken(nieuw).length === 1)
  check('zonder gebruiker geen lijst', terugTeKijken(null).length === 0)

  /* --- aanwijzers volgen de rechten --- */

  const alles = zichtbareAanwijzers(RONDLEIDINGEN.employee, () => true)
  const niets = zichtbareAanwijzers(RONDLEIDINGEN.employee, () => false)
  check('met alle rechten zie je alle aanwijzers',
    alles.length === RONDLEIDINGEN.employee.aanwijzers.length)
  check('zonder rechten vallen de rechtgebonden weg', niets.length < alles.length)
  check('maar de aanwijzers zonder recht blijven',
    niets.length === RONDLEIDINGEN.employee.aanwijzers.filter((a) => !a.recht).length)

  check('elke aanwijzer wijst ergens naartoe',
    ROLE_ORDER.every((r) => RONDLEIDINGEN[r].aanwijzers.every(
      (a) => a.doel.length > 0 && a.titel.length > 0)))
}

/* ==================================================================== *
 *  Dubbele mensen
 *
 *  Twee dossiers van dezelfde man ontstaan doordat het kantoor er een
 *  aanmaakt op zijn werkadres en hij zich daarna zelf aanmeldt met zijn
 *  privé-adres. Op e-mailadres zijn dat twee mensen; op naam en
 *  telefoonnummer valt het wél op.
 * ==================================================================== */

console.log('\n— dubbele mensen —')

{
  const {
    mogelijkDubbel, normaliseerNaam, normaliseerTelefoon, inDienst,
  } = await import('../src/lib/personeel')

  const staat = [
    { id: 'p1', email: 'jan.jansen@truckwash1group.nl', name: 'Jan Jansen',
      phone: '06-12345678', roles: ['employee'], active: true, updatedAt: 0 },
    { id: 'p2', email: 'sanne@truckwash1group.nl', name: 'Sanne de Vries',
      phone: '06-99887766', roles: ['employee'], active: true, updatedAt: 0 },
    { id: 'p3', email: 'weg@truckwash1group.nl', name: 'Ferry Blok',
      roles: ['employee'], active: false, archivedAt: 1, updatedAt: 0 },
  ] as never[]

  /* --- namen normaliseren --- */

  check('tussenvoegsels tellen niet mee',
    normaliseerNaam('Sanne de Vries') === normaliseerNaam('Sanne Vries'))
  check('hoofdletters ook niet',
    normaliseerNaam('JAN JANSEN') === normaliseerNaam('jan jansen'))
  check('en de volgorde van voor- en achternaam niet',
    normaliseerNaam('Jansen, Jan') === normaliseerNaam('Jan Jansen'))
  check('accenten evenmin',
    normaliseerNaam('José Núñez') === normaliseerNaam('Jose Nunez'))
  check('maar twee verschillende namen blijven verschillend',
    normaliseerNaam('Jan Jansen') !== normaliseerNaam('Jan Janssen'))

  /* --- telefoonnummers --- */

  check('streepjes en spaties tellen niet mee',
    normaliseerTelefoon('06-12 34 56 78') === normaliseerTelefoon('0612345678'))
  check('de landcode ook niet',
    normaliseerTelefoon('+31 6 12345678') === normaliseerTelefoon('0612345678'))
  check('geen nummer levert niets op', normaliseerTelefoon(undefined) === '')

  /* --- het vangnet zelf --- */

  const opAdres = mogelijkDubbel(staat, {
    naam: 'Iemand Anders', email: 'jan.jansen@truckwash1group.nl' })
  check('hetzelfde adres is een zekere treffer',
    opAdres.length === 1 && opAdres[0].hard)
  check('en zegt waarom', opAdres[0].waarom === 'zelfde e-mailadres')

  const opNaam = mogelijkDubbel(staat, {
    naam: 'jan jansen', email: 'jan@prive.nl' })
  check('een privé-adres bij dezelfde naam valt op',
    opNaam.length === 1 && opNaam[0].user.id === 'p1')
  check('maar dat is een vermoeden, geen zekerheid', !opNaam[0].hard)
  check('en het zegt waarom', opNaam[0].waarom === 'zelfde naam')

  const naamEnTel = mogelijkDubbel(staat, {
    naam: 'Jan Jansen', email: 'jan@prive.nl', telefoon: '+31612345678' })
  check('naam én telefoonnummer maakt het wel zeker', naamEnTel[0].hard)
  check('met beide redenen erbij',
    naamEnTel[0].waarom === 'zelfde naam én telefoonnummer')

  const alleenTel = mogelijkDubbel(staat, {
    naam: 'Heel Iemand Anders', telefoon: '06-99887766' })
  check('een gedeeld telefoonnummer valt ook op',
    alleenTel.length === 1 && alleenTel[0].user.id === 'p2')

  check('wie er niet op lijkt komt er niet uit',
    mogelijkDubbel(staat, { naam: 'Piet Pietersen', email: 'piet@x.nl' }).length === 0)

  check('jezelf tel je niet mee bij het bijwerken',
    mogelijkDubbel(staat, {
      naam: 'Jan Jansen', email: 'jan.jansen@truckwash1group.nl' }, 'p1').length === 0)

  /*
   * Het geval waar het om begon: kantoor maakt Jan aan op het werkadres, Jan
   * meldt zich daarna zelf aan met zijn privé-adres. Dat moet opvallen.
   */
  const hetGeval = mogelijkDubbel(staat, {
    naam: 'Jan  Jansen', email: 'jjansen1987@hotmail.com', telefoon: '0612345678' })
  check('kantoor maakt hem aan, hij meldt zich zelf aan: dat valt op',
    hetGeval.length === 1 && hetGeval[0].hard && hetGeval[0].user.id === 'p1')

  /* --- uitgeschreven telt niet mee in de lijst --- */

  check('wie is uitgeschreven staat niet meer in dienst',
    inDienst(staat).length === 2)
  check('en de rest wel',
    inDienst(staat).every((u) => u.id !== 'p3'))
}

/* ==================================================================== *
 *  Uren rechtzetten en kilometers
 *
 *  Twee dingen die een medewerker over zichzelf zegt, en één ding dat hij
 *  juist niet zelf bepaalt.
 * ==================================================================== */

console.log('\n— uren en kilometers —')

{
  const {
    urenverzoeken, ritten: ritRepo, totaalKm, vergoeding, mijnRitten,
    openVerzoeken, adresVan, KM_TARIEF, SOORT_LABEL,
  } = await import('../src/lib/urenritten')

  const tom = { id: 'zt_tom', name: 'Tom Verhoeven', locationId: 'loc_utr' }
  const nour = { id: 'zt_nour', name: 'Nour El Amrani' }

  await db.users.bulkPut([
    { id: 'zt_tom', email: 'tom2@zt.nl', password: '', name: 'Tom Verhoeven',
      roles: ['employee'], active: true, locationId: 'loc_utr', updatedAt: 0 },
    { id: 'zt_nour', email: 'nour2@zt.nl', password: '', name: 'Nour El Amrani',
      roles: ['employee', 'supervisor'], active: true, locationId: 'loc_utr',
      manages: ['loc_utr'], updatedAt: 0 },
  ] as never)

  /* --- er staat niets, en dat moet er wel staan --- */

  const dag = new Date(2026, 8, 1, 8, 0).getTime()
  const verzoek = await urenverzoeken.indienen({
    door: tom as never,
    soort: 'vergeten',
    van: dag,
    tot: dag + 8 * 3_600_000,
    toelichting: 'De kassa deed het niet, Nour heeft me binnen zien komen.',
  })

  check('een verzoek begint op nieuw', verzoek.status === 'nieuw')
  check('en staat op naam van de aanvrager', verzoek.userId === 'zt_tom')
  check('het staat in de lijst die op de leidinggevende wacht',
    openVerzoeken(await db.hourRequests.toArray()).some((v) => v.id === verzoek.id))

  const seintje = (await db.notifications.toArray())
    .find((n) => n.toUserId === 'zt_nour' && n.title.includes('Urenverzoek'))
  check('de leidinggevende krijgt er bericht van', !!seintje)

  /* --- goedkeuren zet de uren ook echt recht --- */

  const voor = await db.timeEntries.where('userId').equals('zt_tom').count()
  await urenverzoeken.goedkeuren(
    (await db.hourRequests.get(verzoek.id))!, nour as never, 'Klopt, ik heb hem gezien')
  const na = await db.timeEntries.where('userId').equals('zt_tom').toArray()

  check('goedkeuren levert een urenregel op', na.length === voor + 1)
  check('met de gevraagde begintijd', na.some((e) => e.start === dag))
  check('en de gevraagde eindtijd', na.some((e) => e.end === dag + 8 * 3_600_000))
  check('de regel zegt waar hij vandaan komt',
    na.some((e) => (e.note ?? '').includes('verzoek')))

  const bij = (await db.hourRequests.get(verzoek.id))!
  check('het verzoek staat op goedgekeurd', bij.status === 'goedgekeurd')
  check('met wie het deed erbij', bij.beslistDoorNaam === 'Nour El Amrani')
  check('en de reden', bij.beslissingReden === 'Klopt, ik heb hem gezien')

  const bericht = (await db.notifications.toArray())
    .find((n) => n.toUserId === 'zt_tom' && n.title.includes('rechtgezet'))
  check('de aanvrager hoort het ook', !!bericht)

  /* --- een bestaande regel bijstellen in plaats van erbij zetten --- */

  const bestaand = na.find((e) => e.start === dag)!
  const tweede = await urenverzoeken.indienen({
    door: tom as never,
    soort: 'te vroeg uitgeklokt',
    van: dag,
    tot: dag + 9 * 3_600_000,
    entryId: bestaand.id,
    toelichting: 'Ik heb nog een uur doorgewerkt na het uitklokken.',
  })
  const aantalVoor = await db.timeEntries.where('userId').equals('zt_tom').count()
  await urenverzoeken.goedkeuren((await db.hourRequests.get(tweede.id))!, nour as never)

  check('een bestaande regel wordt bijgesteld, niet gedupliceerd',
    (await db.timeEntries.where('userId').equals('zt_tom').count()) === aantalVoor)
  check('en de eindtijd staat een uur later',
    (await db.timeEntries.get(bestaand.id))?.end === dag + 9 * 3_600_000)

  /* --- afwijzen laat de uren met rust --- */

  const derde = await urenverzoeken.indienen({
    door: tom as never, soort: 'anders', van: dag, tot: dag + 20 * 3_600_000,
    toelichting: 'Twintig uur gewerkt.',
  })
  const voorAfwijzen = await db.timeEntries.where('userId').equals('zt_tom').count()
  await urenverzoeken.afwijzen(
    (await db.hourRequests.get(derde.id))!, 'Twintig uur kan niet', nour as never)

  check('afwijzen verandert niets aan de uren',
    (await db.timeEntries.where('userId').equals('zt_tom').count()) === voorAfwijzen)
  check('en de aanvrager hoort waarom',
    (await db.notifications.toArray()).some(
      (n) => n.toUserId === 'zt_tom' && (n.body ?? '').includes('Twintig uur kan niet')))

  /* --- intrekken kan de aanvrager zelf --- */

  const vierde = await urenverzoeken.indienen({
    door: tom as never, soort: 'vergeten', van: dag, toelichting: 'Toch niet nodig.',
  })
  await urenverzoeken.intrekken(vierde)
  check('een verzoek intrekken kan',
    (await db.hourRequests.get(vierde.id))?.status === 'ingetrokken')
  check('en dan wacht het niet meer op de leidinggevende',
    !openVerzoeken(await db.hourRequests.toArray()).some((v) => v.id === vierde.id))

  check('elke soort verzoek heeft een naam',
    Object.values(SOORT_LABEL).every((l) => l.length > 3))

  /* --- kilometers --- */

  const rit = await ritRepo.toevoegen({
    door: tom as never,
    op: dag,
    vanLabel: 'Thuis', naarLabel: 'Utrecht',
    vanAdres: 'Dorpsstraat 1, Houten', naarAdres: 'Handelsweg 14, Utrecht',
    km: 12.4, retour: true, doel: 'woon-werk',
  })
  check('een rit begint op nieuw', rit.status === 'nieuw')
  check('en zegt dat de afstand van de routedienst komt', rit.bron === 'route')

  await ritRepo.toevoegen({
    door: tom as never,
    op: dag + DAG_MS,
    vanLabel: 'Utrecht', naarLabel: 'Almere',
    vanAdres: 'Handelsweg 14, Utrecht', naarAdres: 'Ergens 3, Almere',
    km: 40, retour: false, doel: 'vestiging',
  })

  const mijn = mijnRitten(await db.trips.toArray(), 'zt_tom')
  check('beide ritten staan op zijn naam', mijn.length === 2)
  check('de nieuwste bovenaan', mijn[0].naarLabel === 'Almere')

  check('retour telt dubbel', totaalKm(mijn) === 12.4 * 2 + 40)
  check('en de vergoeding volgt daaruit',
    vergoeding(mijn, KM_TARIEF) === Math.round((12.4 * 2 + 40) * KM_TARIEF * 100) / 100)
  check('het tarief is het onbelaste bedrag', KM_TARIEF === 0.23)

  check('een lege lijst is nul kilometer', totaalKm([]) === 0)

  /* --- het adres van een vestiging, zoals de routedienst het wil --- */

  check('een vestigingsadres wordt één regel',
    adresVan({ address: 'Handelsweg 14', postcode: '3542 AB', city: 'Utrecht' } as never)
      === 'Handelsweg 14, 3542 AB Utrecht')
  check('en zonder vestiging komt er niets uit', adresVan(undefined) === '')

  /* --- alles overleeft de rondgang --- */

  await sync()
  await db.hourRequests.clear()
  await db.trips.clear()
  await setMeta(LAST_SYNC, 0)
  await sync()
  check('het verzoek staat op de server',
    (await db.hourRequests.get(verzoek.id))?.status === 'goedgekeurd')
  check('de ritten ook', (await db.trips.get(rit.id))?.km === 12.4)
}

/* ==================================================================== *
 *  Een pasje uitlezen
 *
 *  De leesmotor zelf valt hier niet te testen -- die heeft een plaatje en
 *  een browser nodig. Wat wél te testen is, is het deel dat bepaalt wat er
 *  uit die brij aan tekst wordt overgenomen. En dat is precies het deel dat
 *  stil fout kan gaan: een getal dat toevallig op een BSN lijkt, of een
 *  regel die voor een MRZ wordt aangezien.
 * ==================================================================== */

console.log('\n— pasjes uitlezen —')

{
  const {
    vindMrzRegels, vindBsn, vindIban, vindNaamOpPas,
    voorstellenUitId, voorstellenUitPas,
  } = await import('../src/lib/scannen')
  const { leesMrz, bsnGeldig } = await import('../src/lib/identiteit')

  /* --- de twee regels onderaan een paspoort --- */

  const paspoort = [
    'KONINKRIJK DER NEDERLANDEN',
    'Paspoort / Passport',
    'P<NLDDE<BRUIJN<<WILLEM<JAN<<<<<<<<<<<<<<<<<<',
    'SPECI20142NLD6503101M2403096999999990<<<<<84',
  ].join('\n')

  const regels = vindMrzRegels(paspoort)
  check('de twee regels worden uit de rest gevist',
    regels.split('\n').length === 2)
  check('en de kop blijft eruit', !regels.includes('KONINKRIJK'))
  check('ze zijn ook echt te lezen', !!leesMrz(regels))

  const gelezen = leesMrz(regels)!
  check('met de naam erin', gelezen.volledigeNaam.toLowerCase().includes('bruijn'))

  /*
   * Een ID-kaart heeft drie regels van dertig in plaats van twee van
   * vierenveertig. Dat onderscheid moet blijven staan, anders wordt een
   * ID-kaart als een half paspoort gelezen.
   */
  const idKaart = [
    'NEDERLANDSE IDENTITEITSKAART',
    'IDNLDSPECI20142<<<<<<<<<<<<<<<',
    '6503101M2403096NLD<<<<<<<<<<<8',
    'DE<BRUIJN<<WILLEM<JAN<<<<<<<<<',
  ].join('\n')
  check('een ID-kaart levert drie regels op',
    vindMrzRegels(idKaart).split('\n').length === 3)

  check('zonder herkenbare regels komt er niets uit',
    vindMrzRegels('Gewoon wat tekst\nzonder pasje erin') === '')
  check('en één losse regel is niet genoeg',
    vindMrzRegels('P<NLDDE<BRUIJN<<WILLEM<JAN<<<<<<<<<<<<<<<<<<') === '')

  /* --- het burgerservicenummer --- */

  /* Een geldig BSN om mee te werken; de elfproef moet erop kloppen. */
  const echt = '123456782'
  check('het testnummer klopt met de elfproef', bsnGeldig(echt))

  check('een BSN wordt uit de tekst gehaald',
    vindBsn(`Burgerservicenummer ${echt} / BSN`) === echt)
  check('ook met spaties erin', vindBsn(`BSN ${echt.slice(0, 4)} ${echt.slice(4)}`) === echt)

  /*
   * Dit is waar het om gaat. Op een pasje staan meer getallen van negen
   * cijfers -- documentnummers, datums achter elkaar. Alleen wat door de
   * elfproef komt telt.
   */
  check('een getal dat niet door de elfproef komt telt niet',
    vindBsn('Documentnummer 111111111 en verder niets') === undefined)
  check('een documentnummer met letters ook niet',
    vindBsn('SPECI2014 2 NLD') === undefined)
  check('en zonder cijfers komt er niets uit', vindBsn('Alleen maar tekst') === undefined)

  /* --- het rekeningnummer --- */

  const iban = 'NL91ABNA0417164300'
  check('een IBAN wordt gevonden', vindIban(`Rekening ${iban}`) === iban)
  check('ook met spaties zoals op een pas',
    vindIban('NL91 ABNA 0417 1643 00') === iban)
  check('ook tussen andere tekst',
    vindIban(`PASNR 1234\n${iban}\nVALID THRU 12/28`) === iban)

  /*
   * En hier hetzelfde: een pasnummer of een reeks die er toevallig uitziet
   * als een IBAN mag er niet doorheen. De mod-97 houdt dat tegen.
   */
  check('een nummer dat niet door de mod-97 komt telt niet',
    vindIban('NL00BANK0000000000') === undefined)
  check('en een gewone reeks cijfers evenmin',
    vindIban('1234567890123456') === undefined)

  /* --- de naam op de pas --- */

  const pastekst = 'MAESTRO\nNL91 ABNA 0417 1643 00\nW J DE BRUIJN\nVALID THRU 12/28'
  check('de naam op de pas wordt herkend',
    vindNaamOpPas(pastekst) === 'W J DE BRUIJN')
  check('en het merk niet', vindNaamOpPas(pastekst) !== 'MAESTRO')
  check('VALID THRU telt ook niet mee',
    (vindNaamOpPas(pastekst) ?? '').includes('VALID') === false)

  /* --- wat er wordt voorgesteld --- */

  const voorstellen = voorstellenUitId({
    mrz: gelezen, bsn: echt, tekst: '', gemist: [], kanten: 2,
  })

  /*
   * Het geval waar het misging: alleen de voorkant. Op een ID-kaart staan
   * het BSN en de machineleesbare regels achterop, dus dan mist de helft --
   * en dat hoort er ook bij te staan.
   */
  const halfDossier = { mrz: undefined, bsn: undefined, tekst: '',
    gemist: ['de twee regels onderaan het document', 'het burgerservicenummer'],
    kanten: 1 }
  check('met één kant mist er van alles', halfDossier.gemist.length === 2)
  check('en dat is te zien aan het aantal kanten', halfDossier.kanten === 1)
  check('er komen voorstellen uit een scan', voorstellen.length >= 3)
  check('het BSN zit erbij', voorstellen.some((v) => v.veld === 'bsn'))
  check('met de mededeling dat de elfproef klopt',
    voorstellen.find((v) => v.veld === 'bsn')?.gecontroleerd === 'elfproef klopt')
  check('en de geboortedatum is nagerekend',
    (voorstellen.find((v) => v.veld === 'geboortedatum')?.gecontroleerd ?? '')
      .includes('controlecijfer'))

  const leeg = voorstellenUitId({ tekst: '', gemist: ['alles'] })
  check('een mislukte scan stelt niets voor', leeg.length === 0)

  const pasVoorstel = voorstellenUitPas({ iban, naam: 'W J DE BRUIJN', tekst: '', gemist: [] })
  check('een pas levert het rekeningnummer op',
    pasVoorstel.some((v) => v.veld === 'iban'))
  check('met de mod-97 erbij',
    pasVoorstel.find((v) => v.veld === 'iban')?.gecontroleerd === 'mod-97 klopt')
}

/* ==================================================================== *
 *  De kassa's en de kluis
 *
 *  Twee dingen die hier fout kunnen gaan zonder dat iemand het merkt: een
 *  koppelcode met tekens die je niet uit elkaar houdt, en een kluissaldo dat
 *  net niet klopt. Bij het eerste belt er iemand; bij het tweede niet.
 * ==================================================================== */

console.log('\n— kassa en kluis —')

{
  const {
    schoonCode, codeProbleem, voorstelCode, nieuweCode, toonCode, openCodes,
    muntWaarde, waardeVan, saldoVan, laatsteTelling, tellingAchterstallig,
    bewegingenVan, coupuresOpVolgorde, coupureLabel, apparaatVan, stilte,
    TELLING_TERMIJN,
  } = await import('../src/lib/kassa')

  /* --- de code op de bon --- */

  check('een code wordt hoofdletters', schoonCode('kas-utr-1') === 'KAS-UTR-1')
  check('spaties worden streepjes', schoonCode('kas utr 1') === 'KAS-UTR-1')
  check('rommel eruit', schoonCode('kas//utr__1') === 'KAS-UTR-1')
  check('geen streepje aan het begin of eind', schoonCode('-kas-') === 'KAS')

  const kassas = [
    { id: 'r1', code: 'KAS-UTR-1', name: 'Balie', locationId: 'loc_utr',
      lastSeq: 42, active: true, updatedAt: 0 },
    { id: 'r2', code: 'KAS-UTR-2', name: 'Buiten', locationId: 'loc_utr',
      lastSeq: 0, active: false, updatedAt: 0 },
  ] as never[]

  check('een dubbele code wordt tegengehouden',
    !!codeProbleem('kas utr 1', kassas))
  check('en dat wordt uitgelegd, niet als databasefout',
    (codeProbleem('KAS-UTR-1', kassas) ?? '').includes('op elke bon'))
  check('een vrije code mag', codeProbleem('KAS-UTR-3', kassas) === null)
  check('je eigen code botst niet met jezelf',
    codeProbleem('KAS-UTR-1', kassas, 'r1') === null)
  check('twee tekens is te kort', !!codeProbleem('AB', kassas))

  const voorstel = voorstelCode({ code: 'TW-UTR' } as never, kassas)
  check('het voorstel telt door op wat er staat', voorstel === 'KAS-UTR-3',
    voorstel)

  /* --- de koppelcode --- */

  const codes = Array.from({ length: 60 }, () => nieuweCode())

  check('een code is acht tekens', codes.every((c) => c.length === 8))
  check('en alleen hoofdletters en cijfers',
    codes.every((c) => /^[A-Z0-9]{8}$/.test(c)))

  /*
   * Dit is de hele reden dat er een eigen alfabet is. Een code wordt van een
   * scherm gelezen en op een tablet ingetikt; wie een I voor een 1 aanziet
   * krijgt "code onbekend" en belt.
   */
  check('geen I, L, O, 0 of 1 erin',
    codes.every((c) => !/[ILO01]/.test(c)),
    codes.find((c) => /[ILO01]/.test(c)))

  check('twee codes achter elkaar zijn niet gelijk',
    new Set(codes).size === codes.length)

  check('een code wordt in twee groepjes getoond',
    toonCode('K7QJ4M2P') === 'K7QJ-4M2P')
  check('en de streepjes storen niet bij het teruglezen',
    toonCode('K7QJ-4M2P') === 'K7QJ-4M2P')

  const nu = Date.now()
  const alleCodes = [
    { id: 'p1', code: 'AAAABBBB', registerId: 'r1', locationId: 'loc_utr',
      createdByName: 'Ilse', expiresAt: nu + 3_600_000, updatedAt: 0 },
    { id: 'p2', code: 'CCCCDDDD', registerId: 'r1', locationId: 'loc_utr',
      createdByName: 'Ilse', expiresAt: nu - 1000, updatedAt: 0 },
    { id: 'p3', code: 'EEEEFFFF', registerId: 'r1', locationId: 'loc_utr',
      createdByName: 'Ilse', expiresAt: nu + 3_600_000, usedAt: nu, updatedAt: 0 },
    { id: 'p4', code: 'GGGGHHHH', registerId: 'r2', locationId: 'loc_utr',
      createdByName: 'Ilse', expiresAt: nu + 3_600_000, updatedAt: 0 },
  ] as never[]

  const open = openCodes(alleCodes, 'r1', nu)
  check('alleen codes die nog werken', open.length === 1 && open[0].id === 'p1')
  check('een verlopen code telt niet mee', !open.some((c) => c.id === 'p2'))
  check('een gebruikte code ook niet', !open.some((c) => c.id === 'p3'))
  check('en een code van een andere kassa evenmin', !open.some((c) => c.id === 'p4'))

  /* --- briefjes en munten --- */

  check('b100 is een briefje van honderd', muntWaarde('b100') === 100)
  check('m5 is vijf cent', muntWaarde('m5') === 0.05)
  /*
   * Dit onderscheid is de reden dat de sleutel met een letter begint. Vijf
   * euro tegenover vijf cent scheelt een factor honderd, en dat wil je niet
   * in een kasverschil terugvinden.
   */
  check('b5 en m5 zijn niet hetzelfde', muntWaarde('b5') !== muntWaarde('m5'))
  check('b5 is vijf euro', muntWaarde('b5') === 5)
  check('onzin is niets waard', muntWaarde('x9') === 0)

  check('een stapel telt op',
    waardeVan({ b50: 2, b20: 1, m50: 3, m5: 4 }) === 100 + 20 + 1.5 + 0.2)
  check('een lege stapel is nul', waardeVan({}) === 0)
  check('en niets is ook nul', waardeVan(undefined) === 0)

  check('coupures staan van groot naar klein',
    coupuresOpVolgorde({ m5: 1, b50: 1, m50: 1 }).map((c) => c[0]).join(',')
      === 'b50,m50,m5')
  check('nul stuks doen niet mee',
    coupuresOpVolgorde({ b50: 0, b20: 2 }).length === 1)
  check('een briefje heet euro', coupureLabel('b50') === '€ 50')
  check('en een munt cent', coupureLabel('m20') === '20 cent')

  /* --- het saldo --- */

  const DAG = 86_400_000
  const bewegingen = [
    { id: 'm1', safeId: 'k1', soort: 'inleg', coins: { b50: 4 }, amount: 200,
      reason: '', userName: '', at: nu - 10 * DAG, updatedAt: 0 },
    { id: 'm2', safeId: 'k1', soort: 'telling', coins: {}, counted: { b50: 4, b20: 1 },
      amount: 0, expected: 200, difference: 20,
      reason: '', userName: '', at: nu - 5 * DAG, updatedAt: 0 },
    { id: 'm3', safeId: 'k1', soort: 'afstorting', coins: { b20: 5 }, amount: 100,
      reason: '', userName: '', at: nu - 2 * DAG, updatedAt: 0 },
    { id: 'm4', safeId: 'k1', soort: 'naar-bank', coins: { b50: 2 }, amount: -100,
      reason: '', userName: '', at: nu - 1 * DAG, updatedAt: 0 },
    { id: 'm9', safeId: 'k2', soort: 'inleg', coins: { b10: 1 }, amount: 10,
      reason: '', userName: '', at: nu, updatedAt: 0 },
  ] as never[]

  /*
   * Vanaf de laatste telling optellen. De inleg van tien dagen geleden telt
   * dus niet mee: die zat al in wat er is geteld.
   */
  check('het saldo begint bij de laatste telling',
    saldoVan(bewegingen, 'k1') === 220 + 100 - 100)
  check('een andere kluis staat er los van', saldoVan(bewegingen, 'k2') === 10)
  check('zonder bewegingen is het nul', saldoVan([], 'k1') === 0)

  const zonderTelling = bewegingen.filter((m) => m.soort !== 'telling')
  check('zonder telling wordt alles opgeteld',
    saldoVan(zonderTelling, 'k1') === 200 + 100 - 100)

  /*
   * Twee boekingen in dezelfde milliseconde. Zou er alleen op tijd worden
   * gesorteerd, dan viel de boeking van hetzelfde moment als de telling uit
   * het saldo -- geen fout, alleen een bedrag dat niet klopt.
   */
  const zelfdeTel = [
    { id: 'a', safeId: 'k3', soort: 'telling', coins: {}, counted: { b50: 1 },
      amount: 0, reason: '', userName: '', at: 1000, updatedAt: 0 },
    { id: 'b', safeId: 'k3', soort: 'inleg', coins: { b10: 1 }, amount: 10,
      reason: '', userName: '', at: 1000, updatedAt: 0 },
  ] as never[]
  check('een boeking van hetzelfde moment als de telling telt mee',
    saldoVan(zelfdeTel, 'k3') === 60)

  /* --- is er nog geteld --- */

  check('de laatste telling wordt gevonden',
    laatsteTelling(bewegingen, 'k1')?.id === 'm2')
  check('een kluis zonder telling levert niets op',
    laatsteTelling(bewegingen, 'k2') === undefined)

  check('vijf dagen geleden geteld is op tijd',
    !tellingAchterstallig(bewegingen, 'k1', nu).achterstallig)
  check('twintig dagen niet',
    tellingAchterstallig(bewegingen, 'k1', nu + 20 * DAG).achterstallig)
  check('nooit geteld telt als achterstallig',
    tellingAchterstallig(bewegingen, 'k2', nu).achterstallig)
  check('en dat wordt apart gemeld',
    tellingAchterstallig(bewegingen, 'k2', nu).nooit)
  check('de termijn staat op veertien dagen', TELLING_TERMIJN === 14 * DAG)

  check('de bewegingen komen nieuwste eerst',
    bewegingenVan(bewegingen, 'k1')[0].id === 'm4')
  check('en alleen van die kluis',
    bewegingenVan(bewegingen, 'k1').every((m) => m.safeId === 'k1'))

  /* --- welk apparaat staat er --- */

  const apparaten = [
    { id: 'd1', registerId: 'r1', status: 'ingetrokken', deviceKey: 'a',
      name: 'Oude tablet', platform: 'android', pairedAt: 1, updatedAt: 0 },
    { id: 'd2', registerId: 'r1', status: 'actief', deviceKey: 'b',
      name: 'Tablet balie', platform: 'android', pairedAt: 2,
      lastSeenAt: nu - 3_600_000, updatedAt: 0 },
  ] as never[]

  check('het actieve apparaat wordt gepakt',
    apparaatVan(apparaten, 'r1')?.id === 'd2')
  check('een ingetrokken apparaat blijft zichtbaar als er niets anders is',
    apparaatVan([apparaten[0]], 'r1')?.id === 'd1')
  check('en zonder apparaat komt er niets uit',
    apparaatVan(apparaten, 'r9') === undefined)

  check('de stilte wordt gemeten', stilte(apparaten[1], nu) === 3_600_000)
  check('een apparaat dat zich nooit meldde geeft niets',
    stilte(apparaten[0], nu) === null)
}

/* ==================================================================== *
 *  Vestigingen
 *
 *  Twee dingen die hier stil fout gaan. Een dubbele code merk je pas als je
 *  een half jaar later een export opent en niet meer weet waar een werkbon
 *  vandaan kwam. En openingstijden die in zeven regels onder elkaar staan
 *  leest niemand, dus die worden samengetrokken -- en juist bij dat
 *  samentrekken zit de rand: de eerste dag, de laatste dag, en de dag die
 *  nog leeg is.
 * ==================================================================== */

console.log('\n— vestigingen —')

{
  const {
    voorstelCode, vrijeCode, codeProbleem, tijdProbleem, standaardTijden,
    tijdenInHetKort, nuOpen, adresRegel, bezettingInWoorden, opVolgorde,
    coverVan, voorstelSlug, slugProbleem, websiteGaten, WEBSITE_DIENSTEN,
  } = await import('../src/lib/vestigingen')

  /* --- de code --- */

  check('een plaats levert een codevoorstel op',
    voorstelCode('Utrecht') === 'TW-UTR')
  check('het hoofdkantoor krijgt een eigen voorvoegsel',
    voorstelCode('Amersfoort', 'hoofdkantoor') === 'HK-AME')
  check('een plaats met een streepje wordt netjes afgekort',
    voorstelCode('Den Bosch') === 'TW-DEN')
  check('en zonder plaats komt er niets uit', voorstelCode('  ') === '')

  check('een vrije code blijft zoals hij is',
    vrijeCode('TW-UTR', ['TW-AMS']) === 'TW-UTR')
  check('een bezette code krijgt er een cijfer bij',
    vrijeCode('TW-UTR', ['TW-UTR']) === 'TW-UTR2')
  check('en dat loopt door',
    vrijeCode('TW-UTR', ['TW-UTR', 'TW-UTR2']) === 'TW-UTR3')

  const bestaand = [
    { id: 'l1', code: 'TW-UTR', name: 'Utrecht' },
    { id: 'l2', code: 'TW-AMS', name: 'Amsterdam' },
  ] as never[]

  check('een lege code kan niet', codeProbleem('', bestaand) !== null)
  check('twee tekens is te kort', codeProbleem('TW', bestaand) !== null)
  check('spaties in een code kunnen niet',
    codeProbleem('TW UTR', bestaand) !== null)
  check('een bezette code botst', codeProbleem('TW-UTR', bestaand) !== null)
  check('en dat staat er met naam bij',
    (codeProbleem('TW-UTR', bestaand) ?? '').includes('Utrecht'))
  check('kleine letters botsen net zo goed',
    codeProbleem('tw-utr', bestaand) !== null)
  check('je eigen code botst niet met jezelf',
    codeProbleem('TW-UTR', bestaand, 'l1') === null)
  check('een vrije code mag', codeProbleem('TW-EIN', bestaand) === null)

  /* --- het adres op de website ---
   *
   * Dit is de enige plek in de app waar een tikfout op straat komt te liggen,
   * dus wordt hij hier strenger nagerekend dan de rest.
   */

  check('een plaats wordt een webadres', voorstelSlug('Utrecht') === 'utrecht')
  check('spaties worden streepjes', voorstelSlug('Den Bosch') === 'den-bosch')
  check('accenten gaan eruit', voorstelSlug('Sint-Oedenrode') === 'sint-oedenrode')
  check('een apostrof ook', voorstelSlug("'s-Hertogenbosch") === 's-hertogenbosch')
  check('en er blijft geen streepje aan de rand hangen',
    voorstelSlug('  Ede!  ') === 'ede')

  const opSite = [
    { id: 'l1', name: 'Utrecht', websiteSlug: 'utrecht' },
    { id: 'l2', name: 'Amsterdam', websiteSlug: undefined },
  ] as never[]

  check('geen adres is geen fout -- dan staat hij niet op de site',
    slugProbleem('', opSite) === null)
  // Hoofdletters worden gladgestreken en niet geweigerd -- net als bij de code,
  // en het invoerveld doet hetzelfde. Wat er niet in past wordt wel geweigerd.
  check('hoofdletters worden gewoon kleine letters',
    slugProbleem('Eindhoven', opSite) === null)
  check('spaties kunnen niet', slugProbleem('den bosch', opSite) !== null)
  check('een schuine streep al helemaal niet',
    slugProbleem('locaties/utrecht', opSite) !== null)
  check('en accenten ook niet', slugProbleem('sint-oedenród', opSite) !== null)
  check('een streepje aan het eind is geen adres',
    slugProbleem('ede-', opSite) !== null)
  check('twee vestigingen op dezelfde pagina kan niet',
    slugProbleem('utrecht', opSite) !== null)
  check('en er staat bij wie hem al heeft',
    (slugProbleem('utrecht', opSite) ?? '').includes('Utrecht'))
  check('hoofdletters botsen net zo goed',
    slugProbleem('UTRECHT', opSite) !== null)
  check('je eigen adres botst niet met jezelf',
    slugProbleem('utrecht', opSite, 'l1') === null)
  check('een vrij adres mag', slugProbleem('eindhoven', opSite) === null)

  /* --- wat er nog ontbreekt voor de website --- */

  const kaal = {
    id: 'l9', name: 'Nieuw', address: '', postcode: '', city: '',
  } as never as Parameters<typeof websiteGaten>[0]
  check('een kale vestiging mist van alles', websiteGaten(kaal).length === 6)

  const compleet = {
    id: 'l9', name: 'Nieuw',
    address: 'Rijksweg 1', postcode: '3542 AB', city: 'Utrecht',
    phone: '030 123 45 67', websiteSlug: 'utrecht',
    openingHours: standaardTijden(), intro: 'Aan de A2.',
    diensten: ['truckparking'],
  } as never as Parameters<typeof websiteGaten>[0]
  check('een ingevulde vestiging mist niets', websiteGaten(compleet).length === 0)

  check('en zonder telefoonnummer mist hij precies dat ene',
    JSON.stringify(websiteGaten({ ...compleet, phone: undefined }))
      === JSON.stringify(['een telefoonnummer']))

  /* --- de dienstenlijst --- */

  check('de diensten van de website hebben unieke sleutels',
    new Set(WEBSITE_DIENSTEN.map((d) => d.slug)).size === WEBSITE_DIENSTEN.length)
  check('en die sleutels zijn zelf geldige webadressen',
    WEBSITE_DIENSTEN.every((d) => /^[a-z0-9-]+$/.test(d.slug)))
  check('elke dienst heeft een naam om te tonen',
    WEBSITE_DIENSTEN.every((d) => d.naam.trim().length > 2))

  /* --- openingstijden --- */

  check('een sluitingstijd voor de openingstijd kan niet',
    tijdProbleem({ van: '18:00', tot: '07:00' }) !== null)
  check('rommel in een tijdvak kan ook niet',
    tijdProbleem({ van: 'ochtend', tot: '18:00' }) !== null)
  check('een gewone dag mag', tijdProbleem({ van: '07:00', tot: '18:00' }) === null)

  const standaard = standaardTijden()
  check('de standaard zet zondag dicht', standaard.zo === null)
  check('en de rest open', standaard.ma?.van === '07:00')

  check('zes gelijke dagen worden samengetrokken',
    tijdenInHetKort(standaard) === 'ma t/m za 07:00-18:00, zo dicht')

  check('een afwijkende zaterdag komt er los bij',
    tijdenInHetKort({ ...standaard, za: { van: '08:00', tot: '13:00' } })
      === 'ma t/m vr 07:00-18:00, za 08:00-13:00, zo dicht')

  check('een losse dag krijgt geen "t/m"',
    tijdenInHetKort({ ma: { van: '07:00', tot: '18:00' } }) === 'ma 07:00-18:00')

  check('niets ingevuld zegt dat ook', tijdenInHetKort({}) === 'Niet ingevuld')
  check('en niets meegegeven ook', tijdenInHetKort(undefined) === 'Niet ingevuld')

  /* --- is er nu open --- */

  const utrecht = { openingHours: standaard } as never as Parameters<typeof nuOpen>[0]

  // Woensdag 3 september 2025; getDay() geeft 3, dus de derde weekdag.
  check('woensdagochtend is er open',
    nuOpen(utrecht, new Date(2025, 8, 3, 9, 0)) === true)
  check("'s avonds laat niet",
    nuOpen(utrecht, new Date(2025, 8, 3, 22, 0)) === false)
  check('precies op sluitingstijd is het dicht',
    nuOpen(utrecht, new Date(2025, 8, 3, 18, 0)) === false)
  check('op zondag is het dicht',
    nuOpen(utrecht, new Date(2025, 8, 7, 12, 0)) === false)
  check('zonder openingstijden zeggen we niets',
    nuOpen({ openingHours: undefined } as never, new Date()) === null)

  /* --- het adres --- */

  check('het adres komt op een regel',
    adresRegel({ address: 'Kanaalweg 12', postcode: '3526 KL', city: 'Utrecht' })
      === 'Kanaalweg 12, 3526 KL Utrecht')
  check('een half adres levert geen losse komma op',
    adresRegel({ address: '', postcode: '', city: 'Utrecht' }) === 'Utrecht')

  /* --- wat er aan een vestiging hangt --- */

  check('een enkele soort staat er zonder "en"',
    bezettingInWoorden([{ wat: 'medewerkers', aantal: 9 }]) === '9 medewerkers')
  check('twee soorten krijgen een "en"',
    bezettingInWoorden([
      { wat: 'medewerkers', aantal: 9 },
      { wat: 'installaties', aantal: 4 },
    ]) === '9 medewerkers en 4 installaties')
  check('en drie een komma en een "en"',
    bezettingInWoorden([
      { wat: 'medewerkers', aantal: 9 },
      { wat: 'installaties', aantal: 4 },
      { wat: "kassa's", aantal: 2 },
    ]) === "9 medewerkers, 4 installaties en 2 kassa's")
  check('niets levert een lege zin op', bezettingInWoorden([]) === '')

  /* --- de volgorde van de foto's --- */

  const fotos = [
    { id: 'f1', locationId: 'l1', sort: 2, isCover: false, uploadedAt: 30 },
    { id: 'f2', locationId: 'l1', sort: 0, isCover: false, uploadedAt: 10 },
    { id: 'f3', locationId: 'l1', sort: 1, isCover: true, uploadedAt: 20 },
  ] as never[]

  check('de foto die vooraan staat komt eerst', opVolgorde(fotos)[0].id === 'f3')
  check('en de rest op eigen volgorde',
    opVolgorde(fotos).map((f) => f.id).join() === 'f3,f2,f1')
  check('coverVan pakt diezelfde', coverVan(fotos)?.id === 'f3')
  check('zonder aangewezen foto pakt hij de eerste',
    coverVan([fotos[0], fotos[1]] as never)?.id === 'f2')
  check('en zonder foto’s komt er niets uit', coverVan([]) === undefined)

  check('opVolgorde laat het origineel met rust', fotos[0].id === 'f1')
}


/* ==================================================================== *
 *  Vooruit en achteruit kijken
 *
 *  relative() rekent uit hoe lang geleden iets was. Wie er een tijdstip in
 *  stopt dat nog moet komen, kreeg "zojuist" -- niet fout gerekend, wel het
 *  tegenovergestelde van wat er aan de hand was. Een koppelcode die nog een
 *  week meeging las als "verloopt zojuist", en wie dat leest maakt een
 *  nieuwe. Dan staan er twee codes voor één kassa.
 * ==================================================================== */

console.log('\n— vooruit en achteruit kijken —')

{
  const { relative, nogGeldig } = await import('../src/lib/format')

  const nu = Date.now()
  const MIN = 60_000
  const UUR = 3_600_000
  const DAG = 86_400_000

  /* --- achteruit, zoals het altijd al werkte --- */

  check('net gebeurd heet zojuist', relative(nu - 10_000, nu) === 'zojuist')
  check('een half uur terug staat in minuten',
    relative(nu - 30 * MIN, nu) === '30 min geleden')
  check('vanochtend staat in uren', relative(nu - 5 * UUR, nu) === '5 uur geleden')
  check('vorige week in dagen', relative(nu - 6 * DAG, nu) === '6 dagen geleden')
  check('en gisteren in enkelvoud', relative(nu - DAG, nu) === '1 dag geleden')

  /* --- vooruit, waar het misging --- */

  check('een uur vooruit is niet "zojuist"', relative(nu + UUR, nu) !== 'zojuist')
  check('en leest als "over 1 uur"', relative(nu + UUR, nu) === 'over 1 uur')
  check('een week vooruit ook niet', relative(nu + 7 * DAG, nu) === 'over 7 dagen')

  /* --- hoe lang iets nog geldig is --- */

  check('een code van een uur gaat nog een uur mee',
    nogGeldig(nu + UUR, nu) === 'over 1 uur')
  check('een code van een dag',
    nogGeldig(nu + DAG, nu) === 'over 1 dag')
  check('een code van een week',
    nogGeldig(nu + 7 * DAG, nu) === 'over 7 dagen')
  check('twintig minuten staat in minuten',
    nogGeldig(nu + 20 * MIN, nu) === 'over 20 min')

  check('een code die net is verlopen heet verlopen',
    nogGeldig(nu - 1000, nu) === 'verlopen')
  check('en precies op het moment zelf ook',
    nogGeldig(nu, nu) === 'verlopen')
  check('een ingetrokken code leest als verlopen',
    nogGeldig(nu - 1000, nu) === 'verlopen')

  check('vlak voor het einde staat er niet dat hij al weg is',
    nogGeldig(nu + 30_000, nu) === 'zo meteen')
}

/* ==================================================================== *
 *  De brug naar het venster
 *
 *  De knoppen rechtsboven -- minimaliseren, maximaliseren, sluiten -- praten
 *  via kanaalnamen met het venster. Staat er aan de ene kant een letter
 *  anders dan aan de andere, dan gebeurt er niets. Geen foutmelding, geen
 *  waarschuwing: je drukt op sluiten en het venster blijft staan.
 *
 *  Dat is precies het soort fout dat je pas ontdekt als het bij iemand op
 *  het bureau staat, want de app draait in de browser gewoon door. Vandaar
 *  deze controle: alles wat de ene kant vraagt moet de andere kant
 *  aanbieden.
 * ==================================================================== */

console.log('\n— de brug naar het venster —')

{
  const { readFileSync } = await import('node:fs')

  const main = readFileSync('electron/main.cjs', 'utf8')
  const preload = readFileSync('electron/preload.cjs', 'utf8')

  const alle = (tekst: string, patroon: RegExp) =>
    [...tekst.matchAll(patroon)].map((m) => m[1])

  const geregistreerd = alle(main, /ipcMain\.handle\(\s*'([^']+)'/g)
  const gevraagd = alle(preload, /ipcRenderer\.invoke\(\s*'([^']+)'/g)
  const gestuurd = alle(main, /send\(\s*'([^']+)'/g)
  const geluisterd = alle(preload, /ipcRenderer\.on\(\s*'([^']+)'/g)

  const ontbreekt = gevraagd.filter((k) => !geregistreerd.includes(k))
  check('elk verzoek van de app komt bij het venster aan',
    ontbreekt.length === 0, ontbreekt.join(', '))

  const doof = geluisterd.filter((k) => !gestuurd.includes(k))
  check('en elk bericht van het venster wordt gehoord',
    doof.length === 0, doof.join(', '))

  /* --- de knoppen die er echt moeten zijn --- */

  for (const knop of ['minimaliseren', 'maximaliseren', 'sluiten']) {
    check(`het venster kan ${knop}`, geregistreerd.includes(`venster:${knop}`))
  }
  check('en de app kan vragen of het al groot is',
    geregistreerd.includes('venster:is-max'))
  check('en hoort het als dat verandert',
    gestuurd.includes('venster:max') && geluisterd.includes('venster:max'))

  /* --- het venster heeft geen rand van Windows meer --- */

  check('het venster staat zonder rand', /\bframe:\s*false\b/.test(main))

  /*
   * Zonder menu vallen Ctrl+R, F12 en Ctrl+plus weg. Het menu wordt niet
   * meer getekend, maar het hoort te blijven staan -- juist daarvoor.
   */
  check('het menu blijft bestaan voor de sneltoetsen',
    main.includes('Menu.setApplicationMenu'))
}

/* ==================================================================== *
 *  Een factuur die is voorgelezen
 *
 *  Het gevaarlijke aan dit stuk is niet dat het model iets mist -- dat zie
 *  je -- maar dat het iets bijna goed heeft. Een bedrag exclusief btw dat
 *  is teruggerekend uit een totaal met een aangenomen percentage ziet er
 *  precies zo uit als een bedrag dat op de factuur stond. En dat wordt
 *  goedgekeurd.
 *
 *  Dus: liever niets voorstellen dan iets aannemen.
 * ==================================================================== */

console.log('\n— een factuur die is voorgelezen —')

{
  const {
    bedragExcl, btwPercentage, voorstellen, regelsKloppen, heeftIetsTeLezen,
  } = await import('../src/lib/facturen')

  const kaal = { gelezenOp: 1 }

  /* --- het bedrag exclusief --- */

  check('het subtotaal van de factuur telt',
    bedragExcl({ ...kaal, subtotaalExcl: 120.5 }) === 120.5)
  check('anders totaal min btw',
    bedragExcl({ ...kaal, totaalIncl: 121, btwBedrag: 21 }) === 100)
  check('een cent wordt netjes afgerond',
    bedragExcl({ ...kaal, totaalIncl: 100.005, btwBedrag: 0 }) === 100.01)

  check('alleen een totaal inclusief levert niets op',
    bedragExcl({ ...kaal, totaalIncl: 121 }) === undefined)
  check('en een lege lezing ook niet', bedragExcl(kaal) === undefined)

  /* --- het percentage --- */

  check('21 procent wordt herkend',
    btwPercentage({ ...kaal, subtotaalExcl: 100, btwBedrag: 21 }) === 21)
  check('9 procent ook',
    btwPercentage({ ...kaal, subtotaalExcl: 200, btwBedrag: 18 }) === 9)
  check('en 0 procent, bij verlegde btw',
    btwPercentage({ ...kaal, subtotaalExcl: 100, btwBedrag: 0 }) === 0)

  check('een afronding van een cent gaat er nog doorheen',
    btwPercentage({ ...kaal, subtotaalExcl: 100, btwBedrag: 20.99 }) === 21)

  /*
   * Twee tarieven op één factuur geven een percentage dat nergens bestaat.
   * Dan is één getal invullen gewoon fout, en stellen we niets voor.
   */
  check('een tarief dat niet bestaat levert niets op',
    btwPercentage({ ...kaal, subtotaalExcl: 100, btwBedrag: 17.4 }) === undefined)
  check('zonder btw-bedrag ook niet',
    btwPercentage({ ...kaal, subtotaalExcl: 100 }) === undefined)
  check('en delen door nul gebeurt niet',
    btwPercentage({ ...kaal, subtotaalExcl: 0, btwBedrag: 21 }) === undefined)

  /* --- tellen de regels op --- */

  const metRegels = {
    ...kaal,
    subtotaalExcl: 100,
    regels: [
      { omschrijving: 'Ontvetter 20L', bedragExcl: 60 },
      { omschrijving: 'Borstels', bedragExcl: 40 },
    ],
  }
  check('kloppende regels worden gemeld als kloppend',
    regelsKloppen(metRegels)?.klopt === true)

  const scheef = { ...metRegels, subtotaalExcl: 112.5 }
  check('en een verschil ook',
    regelsKloppen(scheef)?.klopt === false)
  check('met het verschil erbij',
    Math.abs((regelsKloppen(scheef)?.verschil ?? 0) + 12.5) < 0.001)
  check('zonder regels valt er niets te controleren',
    regelsKloppen(kaal) === null)

  /* --- wat er over te nemen valt --- */

  const bon = {
    id: 'e1', locationId: 'l1', date: 1000,
    category: 'overig', supplier: '', description: '',
    amountExcl: 0, vatPct: 21, status: 'open',
    submittedBy: 'u1', submittedByName: 'Wim',
    attachmentPath: 'post/x.pdf', updatedAt: 0,
  } as never as Parameters<typeof voorstellen>[0]

  const lezing = {
    ...kaal,
    leverancier: 'Chemtrans BV',
    factuurnummer: 'F-2025-118',
    datum: 2000,
    subtotaalExcl: 100,
    btwBedrag: 21,
    totaalIncl: 121,
    voorstelCategorie: 'materiaal' as const,
  }

  const uit = voorstellen(bon, lezing)
  const veld = (naam: string) => uit.find((v) => v.veld === naam)

  check('de leverancier wordt voorgesteld', veld('supplier')?.waarde === 'Chemtrans BV')
  check('het bedrag exclusief ook', veld('amountExcl')?.waarde === 100)
  check('de datum ook', veld('date')?.waarde === 2000)
  check('de categorie ook', veld('category')?.waarde === 'Materiaal')
  check('en het factuurnummer komt in de omschrijving',
    String(veld('description')?.waarde ?? '').includes('F-2025-118'))

  /*
   * Het percentage stond al goed op de bon. Een voorstel dat niets verandert
   * is een regel die je overslaat, en wie regels overslaat slaat er straks
   * ook een over die er wel toe deed.
   */
  check('een percentage dat al klopt wordt niet voorgesteld',
    veld('vatPct') === undefined)

  const zelfde = voorstellen(
    { ...bon, supplier: 'Chemtrans BV', amountExcl: 100, date: 2000,
      category: 'materiaal', description: 'Factuur F-2025-118' } as never,
    lezing)
  check('een lezing die niets nieuws zegt levert geen enkel voorstel op',
    zelfde.length === 0)

  /* --- valt er iets te lezen --- */

  check('een bon met een bijlage is te lezen', heeftIetsTeLezen(bon))
  check('een bon uit de post ook',
    heeftIetsTeLezen({ ...bon, attachmentPath: undefined, mailboxId: 'mb_1' } as never))
  check('een bon zonder bijlage niet',
    !heeftIetsTeLezen({ ...bon, attachmentPath: undefined } as never))
}

/* ==================================================================== *
 *  De administratie
 * ==================================================================== */

console.log('\n— de administratie —')

{
  const { ROLE_DEFAULTS, effectivePermissions } = await import('../src/lib/permissions')
  const { ROLE_LABELS, ROLE_ORDER } = await import('../src/lib/types')
  const { RONDLEIDINGEN, moetZien, merk } = await import('../src/lib/rondleiding')

  check('de rol bestaat', ROLE_LABELS.administratie === 'Administratie')
  check('en staat in de volgorde', ROLE_ORDER.includes('administratie'))
  check('en heeft een rondleiding', !!RONDLEIDINGEN.administratie)

  const rechten = new Set(ROLE_DEFAULTS.administratie)

  check('de administratie keurt kosten goed', rechten.has('expenses.approve'))
  check('en mag de factuur laten lezen', rechten.has('expenses.read'))
  check('en keurt uren goed', rechten.has('hours.approve'))
  check('en handelt aanmeldingen af', rechten.has('signups.decide'))
  check('en ziet de cijfers', rechten.has('finance.view'))

  /*
   * Beoordelen is iets anders dan uitvoeren. Wie het rooster maakt en de
   * uren goedkeurt, keurt zijn eigen werk goed.
   */
  check('maar maakt geen rooster', !rechten.has('roster.edit'))
  check('en plant geen wasbeurten', !rechten.has('planning.edit'))
  check('en boekt geen voorraad af', !rechten.has('inventory.adjust'))
  check('en deelt geen rechten uit', !rechten.has('staff.permissions'))
  check('en komt niet bij het logboek', !rechten.has('dev.logs'))

  /* --- de rondleiding wordt één keer getoond, per rol --- */

  const iemand = {
    id: 'u1', email: 'a@b.nl', password: '', name: 'Ada',
    roles: ['administratie'], active: true, updatedAt: 0,
    seenTours: [],
  } as never as Parameters<typeof moetZien>[0]

  check('een nieuwe administratiekracht krijgt de rondleiding',
    moetZien(iemand, 'administratie'))
  check('en daarna niet meer',
    !moetZien({ ...(iemand as object), seenTours: [merk('administratie')] } as never,
              'administratie'))

  /* --- de rechten van de rol komen ook echt aan --- */

  const echt = effectivePermissions(iemand)
  check('de rechten van de rol gelden', echt.has('expenses.approve'))
  check('en een ingetrokken recht telt niet mee',
    !effectivePermissions(
      { ...(iemand as object), revokes: ['expenses.approve'] } as never,
    ).has('expenses.approve'))
}

/* ==================================================================== *
 *  Elke rol is ook echt te kiezen
 *
 *  Er is een rol bij gekomen die overal klopte -- een kaart in de rolkiezer,
 *  een set rechten, een eigen dashboard, een rondleiding -- en die toch
 *  nergens te openen was. De rolkiezer had een eigen lijstje met de volgorde,
 *  en daar stond hij niet in.
 *
 *  TypeScript zag dat niet, en dat is precies de reden dat deze controle
 *  bestaat: een onvolledige Role[] is een geldige Role[]. Alleen een
 *  onvolledige Record<Role, ...> valt op bij het compileren.
 * ==================================================================== */

console.log('\n— elke rol is te kiezen —')

{
  const { ROLE_LABELS, ROLE_ORDER } = await import('../src/lib/types')
  const { ROLE_DEFAULTS } = await import('../src/lib/permissions')
  const { RONDLEIDINGEN } = await import('../src/lib/rondleiding')

  // ROLE_LABELS is een Record<Role, string>, dus dit is de volledige lijst.
  const alleRollen = Object.keys(ROLE_LABELS)

  check('er zijn rollen om te controleren', alleRollen.length >= 8)

  for (const rol of alleRollen) {
    check(`${rol} staat in de volgorde van de rolkiezer`,
      ROLE_ORDER.includes(rol as never))
    check(`${rol} heeft standaardrechten`,
      Array.isArray(ROLE_DEFAULTS[rol as never]))
    check(`${rol} heeft een rondleiding`,
      !!RONDLEIDINGEN[rol as never])
  }

  check('de volgorde bevat geen rol die niet bestaat',
    ROLE_ORDER.every((r) => alleRollen.includes(r)))
  check('en niets dubbel',
    new Set(ROLE_ORDER).size === ROLE_ORDER.length)
  check('en is even lang als de lijst met rollen',
    ROLE_ORDER.length === alleRollen.length)
}

/* ==================================================================== *
 *  Een PDF die gewoon een PDF is
 *
 *  Twee fouten hielden facturen tegen, en allebei zag je alleen aan het
 *  gevolg: de bijlage ging niet open, en de AI las hem niet.
 *
 *  De eerste zat hier. De regel was "een type dat de extensie tegenspreekt
 *  wint", en application/octet-stream werd als tegenspraak geteld. Dat is
 *  het niet -- het betekent "ik weet het niet", en het is wat een heleboel
 *  mailprogramma's bij elke bijlage meesturen.
 * ==================================================================== */

console.log('\n— een PDF die gewoon een PDF is —')

{
  const { soortVan, extensieVan, grootteVan } = await import('../src/lib/bekijken')

  /* --- het geval waar het om ging --- */

  check('een factuur die als octet-stream binnenkomt is gewoon een PDF',
    soortVan('factuur.pdf', 'application/octet-stream') === 'pdf')
  check('ook met hoofdletters',
    soortVan('Factuur.PDF', 'APPLICATION/OCTET-STREAM') === 'pdf')
  check('en met een parameter erachter',
    soortVan('factuur.pdf', 'application/octet-stream; name="factuur.pdf"') === 'pdf')
  check('binary/octet-stream telt net zo goed als niets',
    soortVan('bon.pdf', 'binary/octet-stream') === 'pdf')
  check('en een foto ook',
    soortVan('bon.jpg', 'application/octet-stream') === 'beeld')
  check('en een csv',
    soortVan('uren.csv', 'application/octet-stream') === 'tekst')

  /* --- zonder type, zoals het altijd al werkte --- */

  check('zonder type beslist de extensie', soortVan('factuur.pdf') === 'pdf')
  check('met het juiste type ook',
    soortVan('factuur.pdf', 'application/pdf') === 'pdf')

  /*
   * En dit moet blijven werken: een echte tegenspraak is nog steeds een
   * reden om niets te tonen. Daar was de regel voor bedoeld.
   */
  check('een .pdf die zegt een zip te zijn wordt niet getoond',
    soortVan('factuur.pdf', 'application/zip') === 'onbekend')
  check('een .png die zegt een uitvoerbaar bestand te zijn ook niet',
    soortVan('logo.png', 'application/x-msdownload') === 'onbekend')
  check('en een .txt die zegt een pdf te zijn',
    soortVan('brief.txt', 'application/pdf') === 'onbekend')

  /* --- zonder extensie mag het type het zeggen --- */

  check('zonder extensie beslist het type',
    soortVan('bijlage', 'application/pdf') === 'pdf')
  check('maar octet-stream zonder extensie zegt niets',
    soortVan('bijlage', 'application/octet-stream') === 'onbekend')

  /* --- randjes die er al waren --- */

  check('een naam zonder punt heeft geen extensie', extensieVan('bijlage') === '')
  check('en een punt aan het eind ook niet echt', extensieVan('bijlage.') === '')
  check('de extensie is kleine letters', extensieVan('FACTUUR.PDF') === 'pdf')
  check('een grootte leest als mensentaal', grootteVan(2_400_000) === '2.3 MB')
  check('en kleine bestanden in bytes', grootteVan(512) === '512 B')
}

/* ==================================================================== *
 *  Wat een factuur wél en niet verdacht maakt
 *
 *  De tweede fout. De controle hield een PDF tegen zodra /OpenAction erin
 *  stond, en dat staat in bijna elke PDF uit Word. /EmbeddedFile is nog
 *  erger: dat is juist het kenmerk van een ZUGFeRD-factuur, de Europese
 *  e-factuur met de gegevens als XML erin.
 * ==================================================================== */

console.log('\n— wat een factuur verdacht maakt —')

{
  const { readFileSync } = await import('node:fs')
  const bron = readFileSync('supabase/functions/ontvang-mail/controle.ts', 'utf8')

  const alarmBlok = bron.slice(
    bron.indexOf('const PDF_ALARM'),
    bron.indexOf('const PDF_OPMERKING'))

  /* --- wat er tegenhoudt --- */

  check('JavaScript houdt een bijlage tegen', alarmBlok.includes("'/JavaScript'"))
  check('en /JS ook', alarmBlok.includes("'/JS'"))
  check('en het starten van een programma', alarmBlok.includes("'/Launch'"))

  /* --- wat er niet meer tegenhoudt --- */

  check('een beginweergave houdt niets meer tegen',
    !alarmBlok.includes('/OpenAction'))
  check('een automatische actie op een formulierveld ook niet',
    !alarmBlok.includes("'/AA'"))
  check('en een ingesloten bestand al helemaal niet -- dat is een e-factuur',
    !alarmBlok.includes('/EmbeddedFile'))

  /* --- maar het wordt wel gemeld --- */

  const opmerkingBlok = bron.slice(bron.indexOf('const PDF_OPMERKING'))
  check('een ingesloten bestand komt terug als opmerking',
    opmerkingBlok.includes('/EmbeddedFile'))
  check('met de uitleg dat het waarschijnlijk een e-factuur is',
    opmerkingBlok.includes('e-factuur'))

  /* --- en de AI leest ook wat is tegengehouden --- */

  /*
   * Het lezen zelf staat in _gedeeld/factuurlezer.ts en niet meer in de
   * functie factuur-lezen. Dat moest wel: de post leest een binnengekomen
   * factuur nu uit zichzelf, en die kan geen ingelogde gebruiker meesturen
   * -- precies wat factuur-lezen als eerste eist.
   */
  const lezer = readFileSync('supabase/functions/_gedeeld/factuurlezer.ts', 'utf8')
  check('de lezer slaat een tegengehouden bijlage niet meer over',
    !lezer.includes("if (b.controle && b.controle !== 'schoon') continue"))
  check('maar geeft wel door dat hij was tegengehouden',
    lezer.includes('gemarkeerd'))

  /*
   * En beide kanten gebruiken diezelfde lezer. Een tweede kopie van de
   * aanwijzingen aan het model zou binnen een maand uit elkaar lopen, en dan
   * leest een bon anders uit als hij per mail binnenkomt dan als je erop
   * klikt.
   */
  for (const wie of ['factuur-lezen', 'ontvang-mail']) {
    const bron = readFileSync(`supabase/functions/${wie}/index.ts`, 'utf8')
    check(`${wie} gebruikt de gedeelde factuurlezer`,
      bron.includes("from '../_gedeeld/factuurlezer.ts'"))
  }

  /*
   * De post roept factuur-lezen niet over HTTP aan. Dat lijkt de nette weg en
   * is het niet: die functie staat achter verify_jwt en wil daarna nog een
   * ingelogde gebruiker zien. Een webhook van Resend is allebei niet, en dan
   * krijg je een 401 die nergens zichtbaar wordt.
   */
  const post = readFileSync('supabase/functions/ontvang-mail/index.ts', 'utf8')
  check('en de post belt de leesfunctie niet over het netwerk',
    !/functions\/v1\/factuur-lezen/.test(post))
}

/* ==================================================================== *
 *  Wat zit er werkelijk in dat bestand
 *
 *  Een inkoopfactuur van 3 kB die niet openging, met als enige uitleg "deze
 *  PDF is niet te openen". Dat is geen uitleg maar een doodlopende weg: je
 *  weet niet of het aan de lezer ligt, aan het bestand, of aan hoe het is
 *  opgeslagen. De eerste bytes verraden het meestal, dus zeggen we het.
 * ==================================================================== */

console.log('\n— wat zit er werkelijk in dat bestand —')

{
  const { watIsDit } = await import('../src/lib/bekijken')
  const bytes = (t: string) => new TextEncoder().encode(t)

  check('een echte PDF geeft geen klacht',
    watIsDit(bytes('%PDF-1.7\n1 0 obj'), 'pdf') === null)
  check('ook met rommel ervoor',
    watIsDit(bytes('\n\n%PDF-1.4'), 'pdf') === null)

  check('een leeg bestand wordt als leeg gemeld',
    (watIsDit(bytes(''), 'pdf') ?? '').includes('leeg'))

  check('JSON wordt herkend als foutmelding',
    (watIsDit(bytes('{"message":"Not found"}'), 'pdf') ?? '').includes('JSON'))
  check('en een array ook',
    (watIsDit(bytes('[{"error":1}]'), 'pdf') ?? '').includes('JSON'))

  check('een webpagina wordt herkend',
    (watIsDit(bytes('<!DOCTYPE html><html>'), 'pdf') ?? '').includes('webpagina'))
  check('xml ook',
    (watIsDit(bytes('<?xml version="1.0"?>'), 'pdf') ?? '').includes('webpagina'))

  check('een zip wordt bij naam genoemd',
    (watIsDit(bytes('PK'), 'pdf') ?? '').includes('zip'))

  /*
   * Het geval uit het veld: iets van drie kilobyte dat geen van de bekende
   * vormen heeft. Dan zeggen we tenminste dat het geen PDF is, met de maat
   * erbij -- want die maat is zelf het signaal.
   */
  const raar = watIsDit(bytes('x'.repeat(3000)), 'pdf') ?? ''
  check('en iets onherkenbaars heet gewoon geen PDF', raar.includes('geen PDF'))
  check('met de grootte erbij, want die zegt iets', raar.includes('kB'))

  check('bij een plaatje bemoeit hij zich nergens mee',
    watIsDit(bytes('van alles'), 'beeld') === null)
}

/* ==================================================================== */

console.log('\nX. De spookopruimer eet geen verse dossiers')

/*
 * Dit kostte elk nieuw personeelsdossier, en het liet geen enkel spoor na.
 *
 * zonderSpoken() ruimt mensen op die hier staan en op de server niet. Dat is
 * bedoeld voor een dossier dat de server nooit heeft gehaald. Maar een NET
 * aangemaakte medewerker staat daar ook niet -- die wacht nog in de wachtrij.
 * En omdat deze controle in het scherm "Medewerker toevoegen" bij elke
 * toetsaanslag draait, werd hij binnen een seconde na het aanmaken gewist,
 * inclusief zijn verzendopdracht.
 *
 * Wat je overhield: "staat erin" op het scherm, niets in de wachtrij, niets op
 * de server, en een uitnodiging die zegt dat het dossier niet bestaat.
 */
{
  const { welkeZijnSpoken } = await import('../src/lib/personeel')

  const ids = ['u_vers', 'u_spook', 'u_bestaat']
  const opServer = new Set(['u_bestaat'])
  const onderweg = new Set(['u_vers'])

  const spoken = welkeZijnSpoken(ids, opServer, onderweg)

  check('wie nog in de wachtrij staat is geen spook',
    !spoken.includes('u_vers'))
  check('wie op de server staat ook niet',
    !spoken.includes('u_bestaat'))
  check('en wie nergens staat en niets meer klaar heeft staan wel',
    spoken.includes('u_spook'))
  check('precies die ene dus', spoken.length === 1)

  /* De oude regel -- alleen "staat niet op de server" -- zou de net
     aangemaakte medewerker hebben meegenomen. */
  const oud = ids.filter((id) => !opServer.has(id))
  check('de oude regel nam er twee mee, waaronder de verse',
    oud.length === 2 && oud.includes('u_vers'))
}

/* ==================================================================== *
 *  De historie bij een factuur
 *
 *  Een bon los beoordelen is lastiger dan het lijkt: is 1240 euro voor Enexis
 *  veel? Dat weet je pas als je de vorige vier ziet. Dit stuk zoekt die reeks
 *  bij elkaar en let op twee dingen die je met het blote oog mist: dezelfde
 *  rekening die twee keer binnenkomt, en een bedrag dat uit de toon valt.
 * ==================================================================== */

console.log('\n28. De historie bij een factuur')

{
  const { historieVan, leveranciersleutel } =
    await import('../src/lib/factuurhistorie')

  /* ---- dezelfde partij, anders geschreven ---- */

  check('B.V. telt niet mee bij het herkennen van een leverancier',
    leveranciersleutel('Enexis Netbeheer B.V.') === leveranciersleutel('ENEXIS NETBEHEER BV'))
  check('en twee verschillende partijen blijven verschillend',
    leveranciersleutel('Enexis') !== leveranciersleutel('Eneco'))

  let teller = 0
  const bon = (over: Partial<Expense>): Expense => ({
    id: 'exp_h' + (++teller),
    locationId: 'loc_oss',
    date: Date.parse('2026-06-01'),
    category: 'energie',
    supplier: 'Enexis Netbeheer B.V.',
    description: 'elektra',
    amountExcl: 400,
    vatPct: 21,
    status: 'goedgekeurd',
    submittedBy: '',
    submittedByName: 'de post',
    updatedAt: 1,
    ...over,
  })

  const eerdere = [
    bon({ date: Date.parse('2026-02-01'), amountExcl: 390 }),
    bon({ date: Date.parse('2026-03-01'), amountExcl: 410 }),
    bon({ date: Date.parse('2026-04-01'), amountExcl: 400 }),
    bon({ date: Date.parse('2026-05-01'), amountExcl: 405 }),
  ]

  /* ---- een gewone maandfactuur valt niet op ---- */

  const gewoon = bon({ amountExcl: 415 })
  const h1 = historieVan(gewoon, [gewoon, ...eerdere])
  check('de eerdere facturen van dezelfde leverancier komen mee',
    h1.eerder.length === 4, String(h1.eerder.length))
  check('het gebruikelijke bedrag klopt', h1.gebruikelijk === 402.5, String(h1.gebruikelijk))
  check('en een gewone maandfactuur levert geen opmerking op', !h1.opmerking, h1.opmerking)

  /* ---- een jaarafrekening wel ---- */

  const groot = bon({ amountExcl: 1240 })
  const h2 = historieVan(groot, [groot, ...eerdere])
  check('een bedrag van drie keer de mediaan valt op', !!h2.opmerking, h2.opmerking)

  /*
   * En het zegt niet dat het fout is. Een jaarafrekening hoort hoog te zijn;
   * de administratie moet hem nakijken, niet afkeuren op gezag van een
   * rekensom.
   */
  check('maar het wordt geen afkeuring',
    !!h2.opmerking && /kan kloppen/i.test(h2.opmerking), h2.opmerking)

  /* ---- te weinig om iets over te zeggen ---- */

  const h3 = historieVan(groot, [groot, eerdere[0], eerdere[1]])
  check('met twee eerdere bonnen wordt er niets beweerd',
    h3.gebruikelijk === undefined && !h3.opmerking)

  /* ---- alleen goedgekeurde bonnen tellen mee ---- */

  const openStaand = eerdere.map((e) => ({ ...e, status: 'open' as const }))
  const h4 = historieVan(groot, [groot, ...openStaand])
  check('open bonnen tellen niet mee voor wat gebruikelijk is',
    h4.gebruikelijk === undefined, String(h4.gebruikelijk))
  check('maar ze staan wel in de lijst', h4.eerder.length === 4)

  /* ---- dezelfde rekening twee keer ---- */

  const eerste = bon({ date: Date.parse('2026-05-01'), factuurnummer: 'F-8811' })
  const nogmaals = bon({ date: Date.parse('2026-05-20'), factuurnummer: 'F-8811' })
  const h5 = historieVan(nogmaals, [nogmaals, eerste, ...eerdere])
  check('een factuurnummer dat er al staat wordt gemeld',
    h5.dubbel?.id === eerste.id)

  const h6 = historieVan(bon({ factuurnummer: 'F-9999' }), [eerste, ...eerdere])
  check('en een nieuw nummer niet', h6.dubbel === undefined)

  /* ---- een andere leverancier hoort er niet bij ---- */

  const ander = bon({ supplier: 'PreZero Nederland B.V.' })
  const h7 = historieVan(ander, [ander, ...eerdere])
  check('de historie blijft bij dezelfde leverancier', h7.eerder.length === 0)
}

/* ====================================================================
 *  29. Zoeken vóór je een dashboard hebt gekozen
 *
 *  De zoekbalk staat ook op het keuzescherm. Daar is nog geen rol, en de
 *  app heeft geen router: een treffer kan alleen open als het dashboard dat
 *  de pagina kent gemount wordt. kiesDashboard bepaalt welk dat is. De kaart
 *  is handgeschreven; deze tests houden hem compleet.
 * ==================================================================== */

console.log('\n29. Zoeken vóór je een dashboard hebt gekozen')

{
  const { kiesDashboard, kiesPagina, DASHBOARDS_MET, SCHERMEN } = await import('../src/lib/schermen')
  const { ROLE_ORDER } = await import('../src/lib/types')

  /* ---- wie de pagina al heeft, houdt hem ---- */

  check('de huidige rol wint als die de pagina heeft',
    kiesDashboard('overleg', ['employee', 'management'], 'management') === 'management')
  check('ook als een eerdere rol in de volgorde hem óók heeft',
    kiesDashboard('uren', ['employee', 'supervisor'], 'supervisor') === 'supervisor')

  /* ---- anders het eerste dashboard in ROLE_ORDER dat hem kent ---- */

  check('zonder rol het eerste dashboard uit ROLE_ORDER dat de pagina kent',
    kiesDashboard('overleg', ['management', 'employee'], null) === 'employee')
  check('de volgorde komt uit ROLE_ORDER, niet uit de lijst van de gebruiker',
    kiesDashboard('uren', ['management', 'administratie', 'supervisor'], null) === 'supervisor')
  check('heeft de huidige rol de pagina niet, dan een ander dashboard',
    kiesDashboard('financieel', ['employee', 'management'], 'employee') === 'management')
  check('een huidige rol die de gebruiker niet heeft telt niet',
    kiesDashboard('uren', ['supervisor'], 'employee') === 'supervisor')

  /* ---- en niets als niemand hem kent ---- */

  check('null als geen van je dashboards de pagina kent',
    kiesDashboard('financieel', ['employee'], 'employee') === null)
  check('null voor een pagina die niet bestaat',
    kiesDashboard('bestaatniet', ROLE_ORDER, 'management') === null)
  check('null zonder rollen', kiesDashboard('start', [], null) === null)

  /* ---- dezelfde treffer, per dashboard een andere pagina ---- *
   *
   * Een werkgever die op het keuzescherm zijn chauffeur zocht, kreeg de
   * pagina van het management mee en landde op zijn startpagina. De pagina
   * hoort te volgen uit welke dashboards je hebt, niet uit een rol die er
   * nog niet is.
   */

  const wasbeurt = ['planning', 'vandaag', 'beurten']
  check('een wasbeurt opent binnen het werknemersdashboard op Vandaag',
    kiesPagina(wasbeurt, ['employee', 'management'], 'employee') === 'vandaag')
  check('en binnen Management op Planning',
    kiesPagina(wasbeurt, ['employee', 'management'], 'management') === 'planning')
  check('en binnen het werkgeversdashboard onder Wasbeurten',
    kiesPagina(wasbeurt, ['employer'], 'employer') === 'beurten')
  check('zonder rol volgt de pagina uit de dashboards die je hebt: werkgever -> Wasbeurten',
    kiesPagina(wasbeurt, ['employer'], null) === 'beurten')
  check('zonder rol met alleen het werknemersdashboard: Vandaag',
    kiesPagina(wasbeurt, ['employee'], null) === 'vandaag')

  const koppeling = ['werkgevers', 'chauffeurs']
  check('een chauffeur opent voor een werkgever zonder rol onder Chauffeurs',
    kiesPagina(koppeling, ['employer'], null) === 'chauffeurs')
  check('wie ook management heeft, gaat zonder rol naar Werkgevers',
    kiesPagina(koppeling, ['employer', 'management'], null) === 'werkgevers')
  check('maar binnen het werkgeversdashboard blijft het Chauffeurs',
    kiesPagina(koppeling, ['employer', 'management'], 'employer') === 'chauffeurs')
  check('een werkgever zelf opent voor een werkgever zonder rol op Start',
    kiesPagina(['werkgevers', 'start'], ['employer'], null) === 'start')
  check('kent geen dashboard een kandidaat, dan de eerste (en kiesDashboard geeft daar null)',
    kiesPagina(['meldingen'], ['employee'], null) === 'meldingen'
    && kiesDashboard('meldingen', ['employee'], null) === null)
  check('een huidige rol die de gebruiker niet heeft telt ook hier niet',
    kiesPagina(wasbeurt, ['employee'], 'management') === 'vandaag')

  /* ---- de kaart is compleet ---- */

  const zonderRol = Object.entries(DASHBOARDS_MET).filter(([, r]) => r.length === 0).map(([p]) => p)
  check('elke pagina in de kaart heeft minstens één dashboard',
    zonderRol.length === 0, zonderRol.join(', '))

  const alleRollen = new Set(Object.values(DASHBOARDS_MET).flat())
  const ontbreekt = ROLE_ORDER.filter((r) => !alleRollen.has(r))
  check('elke rol uit ROLE_ORDER komt in de kaart voor',
    ontbreekt.length === 0, ontbreekt.join(', '))

  const onbekend = SCHERMEN.filter((s) => !DASHBOARDS_MET[s.page]).map((s) => s.page)
  check('elk scherm uit de zoeklijst staat in de kaart',
    onbekend.length === 0, onbekend.join(', '))

  const tegenstrijdig = SCHERMEN
    .filter((s) => s.rol && !DASHBOARDS_MET[s.page]?.includes(s.rol))
    .map((s) => s.page)
  check('een scherm met een vaste rol staat bij die rol in de kaart',
    tegenstrijdig.length === 0, tegenstrijdig.join(', '))
}

/* ====================================================================
 *  30. Trucksupply
 *
 *  De leverancier van de vestigingen. Wat hier wordt nagerekend is de pure
 *  kant: welke alarmen open zijn, wat er dan besteld wordt, welke stempels
 *  een statuswijziging zet, en of de pakbon alles noemt. Plus de afspraken
 *  over de rol zelf: wel alle supply-rechten, geen verbruik boeken.
 * ==================================================================== */

console.log('\n30. Trucksupply')

{
  const {
    openAlarmen, perVestiging, voorstelUitAlarmen, volgendeStatus, magNaar,
    pakbonTekst, printvel, isConceptNummer, CONCEPT_VOORVOEGSEL,
    MUTATIE_ROLLEN, magMutatieBoeken, voorstelAantal, FOTO_SERVER_MAX_TEKENS, FOTO_MAX_TEKENS,
  } = await import('../src/lib/trucksupply')
  const { ROLE_DEFAULTS } = await import('../src/lib/permissions')
  const { DASHBOARDS_MET } = await import('../src/lib/schermen')
  const { BESTELLING_STATUS, ROLE_LABELS, ROLE_ORDER } = await import('../src/lib/types')
  type VoorraadAlarm = import('../src/lib/types').VoorraadAlarm
  type InventoryItem = import('../src/lib/types').InventoryItem
  type Bestelling = import('../src/lib/types').Bestelling
  type Bestelregel = import('../src/lib/types').Bestelregel
  type Location = import('../src/lib/types').Location

  /* ---- de rol ---- */

  const rechten = new Set(ROLE_DEFAULTS.trucksupply)
  check('trucksupply heeft alle vier de supply-rechten',
    ['supply.view', 'supply.articles', 'supply.orders', 'supply.settings']
      .every((r) => rechten.has(r as never)))
  check('en ziet alle vestigingen', rechten.has('locations.all') && rechten.has('locations.view'))
  check('maar boekt geen verbruik', !rechten.has('inventory.adjust'))
  check('en komt niet bij personeel of cijfers',
    !rechten.has('staff.view') && !rechten.has('finance.view'))
  check('de rol heeft een label en staat na de werkgever',
    ROLE_LABELS.trucksupply === 'Trucksshop'
    && ROLE_ORDER.indexOf('trucksupply') === ROLE_ORDER.indexOf('employer') + 1)

  for (const pagina of ['start', 'voorraad', 'artikelen', 'bestellingen', 'vestigingen', 'instellingen', 'overleg']) {
    check(`het Trucksupply-dashboard kent de pagina ${pagina}`,
      (DASHBOARDS_MET[pagina] ?? []).includes('trucksupply'))
  }

  check('elke bestelstatus heeft een badge',
    (['concept', 'bevestigd', 'ingepakt', 'verzonden', 'ontvangen', 'geannuleerd'] as const)
      .every((s) => !!BESTELLING_STATUS[s]?.label))

  /* ---- alarmen ---- */

  const alarm = (over: Partial<VoorraadAlarm>): VoorraadAlarm => ({
    id: 'va_' + Math.random().toString(36).slice(2),
    itemId: 'inv_shampoo',
    itemNaam: 'Shampoo',
    locationId: 'loc_utr',
    stand: 2,
    minimum: 5,
    ontstaanAt: 1000,
    updatedAt: 1000,
    ...over,
  })

  const alarmen = [
    alarm({ id: 'va_oud', ontstaanAt: 1000 }),
    alarm({ id: 'va_nieuw', itemId: 'inv_wax', itemNaam: 'Wax', ontstaanAt: 3000, stand: 0, minimum: 4 }),
    alarm({ id: 'va_klaar', itemId: 'inv_doek', itemNaam: 'Doeken', ontstaanAt: 2000, opgelostAt: 2500 }),
    alarm({ id: 'va_elders', itemId: 'inv_shampoo_ams', locationId: 'loc_ams', ontstaanAt: 1500 }),
  ]

  const open = openAlarmen(alarmen)
  check('een opgelost alarm is niet open', open.every((a) => a.id !== 'va_klaar') && open.length === 3)
  check('nieuwste bovenaan', open[0].id === 'va_nieuw')

  const locaties: Location[] = [
    { id: 'loc_utr', code: 'TW-UTR', name: 'Utrecht', kind: 'vestiging', address: 'Havenweg 1', postcode: '3542 AB', city: 'Utrecht', phone: '030-1234567', bays: 2, active: true, updatedAt: 1 },
  ]
  const groepen = perVestiging(alarmen, locaties)
  check('gegroepeerd per vestiging, drukste bovenaan',
    groepen.length === 2 && groepen[0].locationId === 'loc_utr' && groepen[0].alarmen.length === 2)
  check('een onbekende vestiging valt niet weg maar krijgt een naam',
    groepen[1].locationId === 'loc_ams' && groepen[1].naam === 'Onbekende vestiging' && !groepen[1].locatie)

  /* ---- het voorstel ---- */

  const items: InventoryItem[] = [
    { id: 'inv_shampoo', locationId: 'loc_utr', name: 'Shampoo', unit: 'liter', stock: 2, minStock: 5, pricePerUnit: 3, supplier: 'Trucksupply', bestelhoeveelheid: 20, inkoopprijs: 2.5, updatedAt: 1 },
    { id: 'inv_wax', locationId: 'loc_utr', name: 'Wax', unit: 'liter', stock: 0, minStock: 4, pricePerUnit: 8, supplier: 'Trucksupply', bestelhoeveelheid: 0, updatedAt: 1 },
    { id: 'inv_shampoo_ams', locationId: 'loc_ams', name: 'Shampoo', unit: 'liter', stock: 7, minStock: 3, pricePerUnit: 3, supplier: 'Trucksupply', updatedAt: 1 },
  ]
  const voorstel = voorstelUitAlarmen(alarmen, items)
  const perItem = Object.fromEntries(voorstel.map((r) => [r.itemId, r]))

  check('een opgelost alarm komt niet in het voorstel', !perItem.inv_doek)
  check('de bestelhoeveelheid wint als die er is',
    perItem.inv_shampoo?.aantal === 20 && perItem.inv_shampoo?.prijs === 2.5)
  check('zonder bestelhoeveelheid: twee keer het minimum min de stand',
    perItem.inv_wax?.aantal === 8)
  check('en nooit nul of minder, ook als de stand alweer boven het minimum staat',
    perItem.inv_shampoo_ams?.aantal === 3)
  check('de eenheid komt van het artikel', perItem.inv_wax?.eenheid === 'liter')

  const dubbel = voorstelUitAlarmen([alarmen[0], { ...alarmen[0], id: 'va_dubbel' }], items)
  check('twee alarmen op hetzelfde artikel leveren één regel', dubbel.length === 1)

  /* ---- statussen en stempels ---- */

  const bestelling: Bestelling = {
    id: 'bst_1', nummer: 'TS-2026-0001', locationId: 'loc_utr', status: 'concept', bron: 'voorraad',
    aangemaaktDoor: 'u_ts', aangemaaktDoorNaam: 'Casper', aangemaaktAt: 100, updatedAt: 100,
  }

  const bevestigd = volgendeStatus(bestelling, 'bevestigd', 200)
  check('bevestigen zet bevestigdAt', bevestigd.status === 'bevestigd' && bevestigd.bevestigdAt === 200)
  check('en verandert het origineel niet', bestelling.status === 'concept' && !bestelling.bevestigdAt)

  const verzonden = volgendeStatus(bevestigd, 'verzonden', 300)
  check('verzenden zet verzondenAt en laat bevestigdAt staan',
    verzonden.verzondenAt === 300 && verzonden.bevestigdAt === 200)
  check('nog eens verzenden verandert het tijdstip niet',
    volgendeStatus(verzonden, 'verzonden', 999).verzondenAt === 300)

  const snel = volgendeStatus(bestelling, 'verzonden', 400)
  check('verzenden zonder bevestigen stempelt allebei',
    snel.bevestigdAt === 400 && snel.verzondenAt === 400)

  const ontvangen = volgendeStatus(verzonden, 'ontvangen', 500)
  check('ontvangen zet ontvangenAt', ontvangen.ontvangenAt === 500)
  check('annuleren zet geen leveringsstempels',
    !volgendeStatus(bestelling, 'geannuleerd', 600).verzondenAt)

  check('van concept mag je bevestigen of annuleren, niet verzenden',
    magNaar('concept', 'bevestigd') && magNaar('concept', 'geannuleerd') && !magNaar('concept', 'verzonden'))
  check('wat verzonden is kan niet meer geannuleerd worden', !magNaar('verzonden', 'geannuleerd'))
  check('ontvangen en geannuleerd zijn eindstations',
    !magNaar('ontvangen', 'concept') && !magNaar('geannuleerd', 'concept'))

  check('een tijdelijk nummer is aan zijn vorm te herkennen',
    isConceptNummer(CONCEPT_VOORVOEGSEL + '1725000000000') && !isConceptNummer('TS-2026-0001'))

  /* ---- wie een mutatie mag schrijven (spiegel van stock_insert / is_staff) ---- */

  check('de mutatierollen zijn precies de rollen van public.is_staff() in 0048',
    [...MUTATIE_ROLLEN].sort().join(',')
      === ['employee', 'supervisor', 'technician', 'administratie', 'management', 'developer'].sort().join(','))
  check('alleen trucksupply mag geen mutatie schrijven: de levering gaat dan via de stand',
    !magMutatieBoeken({ roles: ['trucksupply'] }))
  check('management wel, en trucksupply naast een personeelsrol ook',
    magMutatieBoeken({ roles: ['management'] }) && magMutatieBoeken({ roles: ['trucksupply', 'employee'] }))
  check('zonder rollen geen mutatie (dan hangt er niets in de wachtrij)',
    !magMutatieBoeken({}) && !magMutatieBoeken({ roles: [] }))

  /* ---- het voorstelaantal, een regel voor alarmen, voorraadscherm en de vloer ---- */

  check('de bestelhoeveelheid wint als die er staat',
    voorstelAantal({ stock: 1, minStock: 10, bestelhoeveelheid: 24 }) === 24)
  check('anders genoeg om op twee keer het minimum te komen',
    voorstelAantal({ stock: 3, minStock: 10, bestelhoeveelheid: 0 }) === 17
    && voorstelAantal({ stock: 2.5, minStock: 5 }) === 7.5)
  check('en nooit nul of minder, ook niet boven het minimum',
    voorstelAantal({ stock: 40, minStock: 10 }) === 10 && voorstelAantal({ stock: 5, minStock: 0 }) === 1)
  check('de fotogrens van de app ligt ruim onder die van de database (inventory_items_image_maat)',
    FOTO_MAX_TEKENS < FOTO_SERVER_MAX_TEKENS && FOTO_SERVER_MAX_TEKENS === 150_000)

  /* ---- de pakbon ---- */

  const regels: Bestelregel[] = [
    { id: 'bsr_1', bestellingId: 'bst_1', itemId: 'inv_shampoo', itemNaam: 'Shampoo', aantal: 20, eenheid: 'liter', prijs: 2.5, updatedAt: 1 },
    { id: 'bsr_2', bestellingId: 'bst_1', itemId: 'inv_wax', itemNaam: 'Wax', aantal: 8, eenheid: 'liter', geleverd: 6, updatedAt: 1 },
    { id: 'bsr_x', bestellingId: 'bst_ander', itemId: 'inv_doek', itemNaam: 'Doeken', aantal: 3, eenheid: 'pak', updatedAt: 1 },
  ]
  const tekst = pakbonTekst({ ...verzonden, opmerking: 'Achterom afleveren' }, regels, locaties[0])
  check('de pakbon noemt het nummer', tekst.includes('TS-2026-0001'))
  check('en de vestiging met adres',
    tekst.includes('Utrecht') && tekst.includes('Havenweg 1') && tekst.includes('3542 AB'))
  check('en elke regel van deze bestelling',
    tekst.includes('20 liter  Shampoo') && tekst.includes('Wax'))
  check('met het geleverde aantal als dat afwijkt', tekst.includes('6 liter  Wax') && !tekst.includes('8 liter'))
  check('regels van een andere bestelling niet', !tekst.includes('Doeken'))
  check('en de opmerking', tekst.includes('Achterom afleveren'))
  check('de tekst bevat geen HTML', !/<[a-z]/i.test(tekst))

  const vel = printvel(verzonden, regels, locaties[0], items)
  check('het printvel heeft twee regels en het label draagt het nummer',
    vel.regels.length === 2 && vel.label.nummer === 'TS-2026-0001' && vel.label.naar === 'Utrecht')
  check('zonder vestiging valt de pakbon terug op het id',
    pakbonTekst(verzonden, regels).includes('Vestiging loc_utr'))
}

/* ==================================================================== *
 *  Overnemen zonder klikken
 *
 *  De vraag van Casper: "Die dingen overnemen, doe dat automatisch dan? want
 *  tot nu toe doet hij dat 100 goed." Sindsdien vult niet alleen de post maar
 *  ook de knop "Lezen" de bon in, en het scherm doet het bij het openen als de
 *  bon nog leeg is. Waar het op staat of valt is nogNietIngevuld(): die regel
 *  bepaalt of er iets overschreven kan worden dat een mens heeft ingetikt.
 * ==================================================================== */

console.log('\n31. Overnemen zonder klikken')

{
  const { nogNietIngevuld, voorstellen } = await import('../src/lib/facturen')

  const bon = (over: Partial<Expense>): Expense => ({
    id: 'exp_ov1',
    locationId: 'loc_oss',
    date: Date.parse('2026-09-04'),
    category: 'overig',
    supplier: 'casper@truckwash1group.nl',
    description: 'FW: test',
    amountExcl: 0,
    vatPct: 21,
    status: 'open',
    submittedBy: '',
    submittedByName: 'de post',
    updatedAt: 1,
    ...over,
  })

  check('een verse bon uit de post is nog niet ingevuld',
    nogNietIngevuld(bon({})) === true)

  check('met een bedrag erin blijft de keuze aan de mens',
    nogNietIngevuld(bon({ amountExcl: 10000 })) === false)

  /*
   * Een goedgekeurde of afgekeurde bon nooit, ook niet als het bedrag nul is.
   * Daar heeft iemand een oordeel over gegeven; dat overschrijf je niet.
   */
  check('een goedgekeurde bon niet, ook niet met bedrag nul',
    nogNietIngevuld(bon({ status: 'goedgekeurd', approvedAt: 2 })) === false)
  check('een afgekeurde bon evenmin',
    nogNietIngevuld(bon({ status: 'afgekeurd' })) === false)

  /*
   * En een bon die openstaat maar wel is afgetekend (dat kan als iemand hem
   * goedkeurde en de status later terugzette) blijft ook met rust.
   */
  check('afgetekend telt zwaarder dan de status',
    nogNietIngevuld(bon({ approvedAt: 3 })) === false)

  /* ---- en dan de voorstellen die er vanzelf op gaan ---- */

  const lezing = {
    soort: 'factuur' as const,
    leverancier: 'Shell Nederland Verkoopmaatschappij B.V.',
    factuurnummer: '1300122763',
    datum: Date.parse('2026-03-21'),
    subtotaalExcl: 10000,
    btwBedrag: 2100,
    totaalIncl: 12100,
    regels: [{ omschrijving: 'Basic Rent', bedragExcl: 10000, btwPct: 21 }],
    twijfel: [],
    gelezenOp: 4,
  }

  const leeg = bon({})
  const uit = voorstellen(leeg, lezing)
  const velden = uit.map((v) => v.veld).sort()

  check('de leverancier, het bedrag en de datum worden voorgesteld',
    velden.includes('supplier') && velden.includes('amountExcl') && velden.includes('date'),
    velden.join(','))
  check('en het bedrag is het subtotaal exclusief btw',
    uit.find((v) => v.veld === 'amountExcl')?.waarde === 10000)

  /*
   * Wat al klopt komt niet als voorstel terug -- anders zou "alles overnemen"
   * op een bon die al goed staat alsnog van alles aanraken.
   */
  const alGoed = bon({
    supplier: 'Shell Nederland Verkoopmaatschappij B.V.',
    amountExcl: 10000,
    date: Date.parse('2026-03-21'),
  })
  check('wat al klopt wordt niet nog eens voorgesteld',
    voorstellen(alGoed, lezing).every((v) => v.veld !== 'supplier' && v.veld !== 'amountExcl' && v.veld !== 'date'))
}

/* ==================================================================== *
 *  Tijd bij datum, maar alleen als er een tijd is
 *
 *  In hetzelfde veld staan twee soorten momenten. Een factuurdatum komt van
 *  papier en heeft geen tijd; het moment waarop post binnenkomt wel. Er "01:00"
 *  bij zetten omdat het toevallig middernacht UTC is, is geen informatie maar
 *  een verzinsel.
 * ==================================================================== */

console.log('\n32. Tijd bij datum')

{
  const { heeftTijd, datumMisschienTijd } = await import('../src/lib/format')

  check('een factuurdatum uit de lezer draagt geen tijd',
    heeftTijd(Date.UTC(2026, 2, 21)) === false)
  check('een moment van binnenkomst wel',
    heeftTijd(Date.UTC(2026, 8, 4, 9, 12)) === true)

  const alleenDatum = datumMisschienTijd(Date.UTC(2026, 2, 21))
  check('en dus staat er bij een factuurdatum geen tijd',
    !/\d{2}:\d{2}/.test(alleenDatum), alleenDatum)

  const metTijd = datumMisschienTijd(Date.UTC(2026, 8, 4, 9, 12))
  check('en bij een binnenkomst wel',
    /\d{2}:\d{2}/.test(metTijd), metTijd)

  /*
   * Een factuur die toevallig om precies middernacht binnenkwam verliest zijn
   * tijd. Dat is de prijs van deze regel, en hij is te dragen: dan staat er
   * de datum, en die klopt.
   */
  check('middernacht telt als "geen tijd" -- bewust',
    heeftTijd(Date.UTC(2026, 8, 4)) === false)
}

/* ==================================================================== *
 *  Eén bon per bijlage
 *
 *  "Als er bijvoorbeeld 10 facturen in zitten en 3 fotos, alles 1 voor 1, dus
 *  dat je ze los van elkaar zet."
 *
 *  De keuze welke bijlagen een bon worden zit in ontvang-mail en draait in
 *  Deno; hier staat de regel zelf, zodat hij te lezen en te toetsen is zonder
 *  die functie te draaien. Wijkt de functie hiervan af, dan is dat een fout in
 *  de functie -- de regel hoort er één te zijn.
 * ==================================================================== */

console.log('\n33. Eén bon per bijlage')

{
  const MIN_FOTO = 40 * 1024
  const MAX_BONNEN = 20

  /** Dezelfde keuze als in ontvang-mail. */
  function bonnenUit(bijlagen: { naam: string; mime: string; size: number; path: string }[]) {
    const opgeslagen = bijlagen.filter((b) => b.path)
    const pdfs = opgeslagen.filter((b) => b.mime === 'application/pdf')
    const fotos = opgeslagen.filter((b) => b.mime.startsWith('image/'))
    return [
      ...pdfs,
      ...fotos.filter((b) => pdfs.length === 0 || b.size >= MIN_FOTO),
    ].slice(0, MAX_BONNEN)
  }

  const pdf = (n: number) => ({ naam: `factuur${n}.pdf`, mime: 'application/pdf', size: 90_000, path: `p/${n}` })
  const foto = (n: number, size = 300_000) => ({ naam: `bon${n}.jpg`, mime: 'image/jpeg', size, path: `f/${n}` })
  const logo = { naam: 'logo.png', mime: 'image/png', size: 3_000, path: 'l/1' }

  /* Het geval uit de vraag: tien facturen en drie foto's. */
  const veel = [...Array.from({ length: 10 }, (_, i) => pdf(i)), foto(1), foto(2), foto(3)]
  check('tien facturen en drie foto\'s worden dertien losse bonnen',
    bonnenUit(veel).length === 13)

  check('één bijlage blijft één bon', bonnenUit([pdf(1)]).length === 1)

  /*
   * Het logo uit de handtekening is de reden dat er een ondergrens is. Zonder
   * die grens stond er bij elke mail van dezelfde leverancier een lege
   * kostenpost van drie kilobyte in de rij.
   */
  check('een logo naast een factuur wordt geen bon',
    bonnenUit([pdf(1), logo]).length === 1)

  /*
   * Maar is dat kleine plaatje het enige wat er is, dan is het wél de bon --
   * een schermafbeelding van een bonnetje kan klein zijn.
   */
  check('zonder PDF telt ook een klein plaatje mee',
    bonnenUit([logo]).length === 1)

  check('een bijlage die niet is opgeslagen telt niet mee',
    bonnenUit([{ ...pdf(1), path: '' }]).length === 0)

  check('boven het maximum wordt afgekapt',
    bonnenUit(Array.from({ length: 30 }, (_, i) => pdf(i))).length === MAX_BONNEN)

  /* PDF's staan vooraan: die zijn vrijwel altijd de echte factuur. */
  check('de PDF\'s komen eerst',
    bonnenUit([foto(9), pdf(1)])[0].mime === 'application/pdf')

  /* ---- de id per bijlage ---- */

  const idVoor = (berichtId: string, i: number) =>
    'exp_mail_' + berichtId.slice(3, 15) + (i === 0 ? '' : '_' + (i + 1))

  const bid = 'mb_0123456789abcdef'
  check('de eerste bon houdt de id die hij altijd had',
    idVoor(bid, 0) === 'exp_mail_' + bid.slice(3, 15))
  check('en de volgende krijgen een nummer',
    idVoor(bid, 1).endsWith('_2') && idVoor(bid, 2).endsWith('_3'))
  check('alle ids zijn verschillend',
    new Set([0, 1, 2, 3].map((i) => idVoor(bid, i))).size === 4)
}

/* ==================================================================== */

/* ==================================================================== *
 *  De sleutels van Exact
 *
 *  Casper zet ze nu zelf in het scherm bij Ontwikkeling, omdat hij met een
 *  dev-account van Exact aan het uitproberen is. Dat maakt drie dingen
 *  belangrijk genoeg om vast te leggen, want ze zijn alle drie stil kapot te
 *  maken zonder dat er ooit iets rood wordt.
 *
 *  Een: het clientgeheim mag nooit terug naar de browser. Het gaat heen bij
 *  het opslaan en komt er hoogstens als vier laatste tekens weer uit.
 *
 *  Twee: het adres waar dat geheim naartoe gaat mag niet vrij invulbaar
 *  zijn. Wie het mag zetten zou anders in een handeling de sleutels van de
 *  boekhouding naar zijn eigen server kunnen laten sturen, en er zou geen
 *  foutmelding komen -- zijn server antwoordt gewoon.
 *
 *  Drie: wijzigen van de sleutels moet de tokens weggooien. Een token dat is
 *  opgehaald bij het proefaccount hoort niet te blijven staan als het
 *  client-id naar de echte administratie wijst.
 * ==================================================================== */

console.log('\n34. De sleutels van Exact')

{
  const { readFileSync } = await import('node:fs')
  const bron = readFileSync('supabase/functions/exact/index.ts', 'utf8')

  /* --- het geheim gaat niet terug --- */

  check('de stand stuurt hoogstens de laatste vier tekens van het geheim',
    bron.includes('geheimStaart') && bron.includes('geheim.slice(-4)'))
  check('en nergens het geheim zelf',
    !/geheim:\s*geheim\b/.test(bron) && !/client_geheim:\s*k\?\./.test(bron))

  /* --- het adres zit op slot --- */

  check('er is een lijst met adressen die van Exact zijn',
    bron.includes('EXACT_DOMEINEN') && bron.includes('exactonline.nl'))
  check('en het opgegeven adres wordt eraan getoetst',
    /function schoonBasis/.test(bron) && bron.includes("u.protocol !== 'https:'"))
  check('opslaan gaat langs die toets',
    /velden\.basis_url = schoon/.test(bron))

  /* --- wijzigen koppelt los --- */

  check('een gewijzigde sleutel gooit de tokens weg',
    bron.includes('raaktTokens')
    && /raaktTokens && wasGekoppeld/.test(bron)
    && /velden\.refresh_token = null/.test(bron))
  check('en de omgeving telt daarin mee',
    /'client_id', 'client_geheim', 'basis_url', 'omgeving'/.test(bron))

  /* --- wie mag wat --- */

  check('sleutels zetten mag alleen bij ontwikkeling of management',
    bron.includes("rollen.includes('developer') || rollen.includes('management')"))
  check('en de actie controleert dat ook echt',
    /if \(!beller\.magSleutels\)/.test(bron))

  /*
   * Het paar id+geheim komt uit een bron. Half om half geeft "invalid_client"
   * terug, en dat is een foutmelding die naar de verkeerde kant wijst.
   */
  check('id en geheim worden als paar gepakt',
    bron.includes('const uitDb = Boolean(dbId && dbGeheim)'))

  /* --- het scherm --- */

  const scherm = readFileSync('src/dashboards/developer/Exact.tsx', 'utf8')
  check('het veld voor het geheim staat leeg bij het openen',
    scherm.includes("setGeheim('')"))
  check('en leeg laten betekent: laat staan',
    scherm.includes('geheim.trim() ? { geheim: geheim.trim() } : {}'))
}

/* ==================================================================== *
 *  Elk scherm bij ontwikkeling is ook te vinden
 *
 *  De zoekbalk werkt op SCHERMEN uit schermen.ts. Drie schermen bij
 *  ontwikkeling stonden daar niet in en waren dus met geen mogelijkheid te
 *  vinden -- je moest weten dat het tabblad bestond. En een treffer landt
 *  alleen als het dashboard de pagina in useNavTarget noemt.
 * ==================================================================== */

console.log('\n35. De ontwikkelschermen zijn te vinden')

{
  const { readFileSync } = await import('node:fs')
  const dash = readFileSync('src/dashboards/developer/DeveloperDashboard.tsx', 'utf8')
  const { SCHERMEN, DASHBOARDS_MET } = await import('../src/lib/schermen')

  /* De sleutels uit TITLES: dat is de lijst die het dashboard zelf kent. */
  const titels = dash.slice(dash.indexOf('const TITLES'), dash.indexOf('\n}', dash.indexOf('const TITLES')))
  const paginas = [...titels.matchAll(/^\s{2}([a-z]+):/gm)].map((m) => m[1])
  check('het dashboard kent meer dan een handvol schermen', paginas.length >= 10, String(paginas.length))

  /* Overleg en postbus staan elders in de zoeklijst; die horen hier niet
     bij het rijtje "alleen ontwikkeling". */
  const eigen = paginas.filter((p) => (DASHBOARDS_MET[p] ?? []).join() === 'developer')

  const nietVindbaar = eigen.filter((p) => !SCHERMEN.some((s) => s.page === p))
  check('elk eigen ontwikkelscherm staat in de zoeklijst',
    nietVindbaar.length === 0, nietVindbaar.join(', '))

  const navRegel = dash.slice(dash.indexOf('useNavTarget('), dash.indexOf('(p) => setPage(p))'))
  const nietBereikbaar = eigen.filter((p) => !navRegel.includes(`'${p}'`))
  check('en het dashboard springt er ook heen als je erop klikt',
    nietBereikbaar.length === 0, nietBereikbaar.join(', '))

  check('Exact staat erbij', eigen.includes('exact'))
}

/* ==================================================================== *
 *  Het token van Exact leeft tien minuten
 *
 *  Dit is de val waar elke eerste koppeling in loopt, en hij is stil: alles
 *  werkt, tien minuten lang, en daarna geeft Exact 401 zonder dat er iets aan
 *  de koppeling mankeert.
 *
 *  Eronder zit een tweede, die erger is. Exact geeft bij het verversen een
 *  NIEUW refresh-token en trekt het oude in. Wie dat niet opslaat, heeft een
 *  koppeling die precies één verversing overleeft en daarna definitief dood
 *  is -- opnieuw proberen helpt dan niet meer, want het bewaarde token
 *  bestaat niet meer bij Exact.
 *
 *  Alle drie de regels hieronder zijn met het oog niet te zien in een diff.
 *  Vandaar dat ze hier staan.
 * ==================================================================== */

console.log('\n36. Het token van Exact')

{
  const { readFileSync } = await import('node:fs')
  const bron = readFileSync('supabase/functions/_gedeeld/exact.ts', 'utf8')

  check('er wordt met een refresh_token ververst',
    bron.includes("grant_type: 'refresh_token'"))

  check('het nieuwe refresh-token wordt opgeslagen',
    /refresh_token: uit\.refresh_token \|\| rij\.refresh_token/.test(bron))

  /*
   * En het wordt opgeslagen VOORDAT het antwoord wordt gebruikt. Zou dat na
   * afloop gebeuren, dan is een mislukt verzoek genoeg om het verse token
   * kwijt te raken terwijl Exact het oude al heeft ingetrokken.
   */
  const iSchrijf = bron.indexOf("update(nieuw)")
  const iTerug = bron.indexOf("return { basis, division: rij.division, token: uit.access_token")
  check('en dat gebeurt vóór het antwoord teruggaat',
    iSchrijf > 0 && iTerug > 0 && iSchrijf < iTerug)

  check('mislukt wegschrijven laat de aanroep niet slagen',
    bron.includes('Het verse token kon niet worden opgeslagen'))

  /*
   * Het verschil tussen "koppel opnieuw" en "Exact had het even niet". Bij
   * een 500 de tokens weggooien betekent dat een storing bij Exact een
   * handmatige herkoppeling kost.
   */
  check('alleen bij 400 of 401 gaat de koppeling los',
    bron.includes('const kwijt = res.status === 400 || res.status === 401'))
  check('en bij een storing blijft hij staan',
    /if \(kwijt\) \{/.test(bron))

  /* Verversen met marge: een token dat nog vijf seconden geldig is, is bij
     aankomst verlopen. */
  check('er wordt met een marge ververst', bron.includes('VERSE_MARGE_MS'))

  /*
   * Exact antwoordt in XML als je niet om JSON vraagt, en verpakt in
   * { d: { results } } -- niet in { value }, dat is OData 4.
   */
  check('er wordt om JSON gevraagd', bron.includes("Accept: 'application/json'"))
  check('en het antwoord wordt uit d.results gehaald',
    bron.includes('uit.d?.results') && !bron.includes('json.value'))
  check('meerdere pagina\'s worden gevolgd', bron.includes('__next'))

  /* Een factuurdatum is een dag, geen moment: op lokale middernacht kan hij
     in de winter een dag terugvallen en dan in het vorige boekjaar landen. */
  check('een datum gaat op UTC naar Exact',
    bron.includes('getUTCFullYear') && bron.includes('T00:00:00.000Z'))
}

/* ==================================================================== *
 *  Het rekeningschema blijft van ons
 *
 *  De verleiding is om het schema van Exact over public.grootboek heen te
 *  zetten. Dat is precies wat er niet moet gebeuren: die lijst is met opzet
 *  kort (zie 0044) en heeft eigen namen en trefwoorden. Een sync die daar
 *  overheen loopt, gooit dat weg -- en dat merk je pas als de administratie
 *  de rekening niet meer terugvindt.
 * ==================================================================== */

console.log('\n37. Het rekeningschema blijft van ons')

{
  const { readFileSync } = await import('node:fs')
  const bron = readFileSync('supabase/functions/exact/index.ts', 'utf8')

  check('de sync schrijft in exact_grootboek',
    bron.includes("from('exact_grootboek')"))
  check('en raakt public.grootboek niet aan',
    !/from\('grootboek'\)[\s\S]{0,80}(upsert|update|insert|delete)/.test(bron))

  /* Wat Exact niet meer kent hoort weg, anders blijft de lijst van het
     proefaccount naast die van de echte administratie staan. */
  check('wat verdwenen is wordt opgeruimd',
    /delete\(\)\.lt\('updated_at', nu\)/.test(bron))

  /*
   * Dit stond hier als `bron.includes('magAdministratie')` -- de naam van de
   * functie moest in het bestand voorkomen. Dat was hij ook, netjes, vijf keer
   * zelfs. Alleen stond hij ACHTER wieBelt(), en die liet de rol administratie
   * niet binnen. De check was groen en het scherm gaf 403.
   *
   * Een check op een naam is geen check op een pad. Deze kijkt naar de deur.
   */
  check('de administratie komt door de deur van wieBelt',
    /const magBoekhouding = magSleutels[\s\S]{0,220}rollen\.includes\('administratie'\)/
      .test(bron))
  check('en die uitkomst bepaalt of het mag',
    bron.includes('const mag = magBoekhouding ||'))
  check('de boekhoudacties hangen aan dat veld',
    (bron.match(/if \(!beller\.magBoekhouding\)/g) ?? []).length === 5)
  /* De sleutels blijven bij ontwikkeling en management. */
  check('maar de sleutels van de Exact-app niet',
    bron.includes('if (!beller.magSleutels) {'))
}

/* ==================================================================== *
 *  Het personeel van Exact
 *
 *  Casper: "voor personeel mag je alles doen." Wat er dan blijkt: exporteren
 *  kan niet. payroll/Employees in de Exact-API doet GET en verder niets --
 *  geen POST, geen PUT. Een export zou stilzwijgend geweigerd worden.
 *
 *  Wat hier wordt vastgelegd zijn de twee dingen die daarna nog stil kapot
 *  kunnen: koppelen op naam in plaats van op adres, en het volledige record
 *  van Exact breder te zien maken dan het dossier zelf.
 * ==================================================================== */

console.log('\n38. Het personeel van Exact')

{
  const { readFileSync } = await import('node:fs')
  const bron = readFileSync('supabase/functions/exact/index.ts', 'utf8')

  /* --- er wordt niets naar de HRM-kant geschreven --- */

  check('er gaat niets naar payroll/Employees toe',
    !/exactPost\([^)]*payroll\/Employees/.test(bron))

  /* --- koppelen gaat op adres en niet op naam --- */

  check('automatisch koppelen gaat op e-mailadres',
    bron.includes('const opAdres = new Map<string, number>()'))
  /*
   * Op naam matchen is aanlokkelijk en fout. Twee mensen die De Vries heten
   * is geen uitzondering, en een verkeerde koppeling stuurt straks de uren
   * van de een naar de loonstrook van de ander.
   */
  check('en niet op naam',
    !/opNaam|volledige_naam.*toLowerCase.*set\(/.test(bron))

  /* Een nummer dat al bezet is wordt overgeslagen, niet overschreven. */
  check('een bezet loonnummer wordt overgeslagen',
    bron.includes('if (hid == null || bezet.has(hid)) continue'))

  /* --- het hele record, en de grens eromheen --- */

  check('het volledige antwoord van Exact wordt bewaard',
    bron.includes('ruw: r as unknown as Record<string, unknown>'))
  /*
   * Zonder $select, met opzet: één verzonnen veldnaam laat Exact het hele
   * verzoek weigeren, en dan wijst de foutmelding naar niets.
   */
  check('en zonder $select opgehaald',
    /exactLijst<ExactMedewerker>\(lijn, 'payroll\/Employees'\)/.test(bron))

  /*
   * De grens. In dat record kan een BSN zitten, en dat ligt in 0009 bij het
   * management en bij de medewerker zelf. Een los toegekend recht mag hier
   * dus géén achterdeur zijn -- vandaar null als recht.
   */
  check('personeel is management-only, zonder rechtenachterdeur',
    bron.includes("return await heeftRecht(req, null, ['management'])"))
  check('en heeftRecht kent die vorm ook echt',
    bron.includes('if (recht === null) return rollen.some((r) => mijn.includes(r))'))

  /* Het volledige record reist niet mee met het overzicht. */
  check('het hele record komt pas mee als je er een opent',
    bron.includes('async function medewerkerDetails')
    && !/exactMensen[\s\S]{0,400}ruw:/.test(bron))

  /* --- het scherm --- */

  const scherm = readFileSync('src/dashboards/developer/Exact.tsx', 'utf8')
  check('je kunt een Exact-medewerker opzoeken in plaats van een nummer typen',
    scherm.includes('function Zoeker'))
  check('en zoeken kan op naam, nummer en adres',
    scherm.includes('String(m.employeeHid).includes(t)')
    && scherm.includes('m.email.toLowerCase().includes(t)'))
  check('een nummer dat al aan iemand anders hangt is niet te kiezen',
    scherm.includes("disabled={Boolean(m.gekoppeldAan && m.gekoppeldAan !== persoon.userId)}"))
  check('de datums van Exact worden leesbaar getoond',
    scherm.includes('function leesbaar') && scherm.includes('OData v2 schrijft datums'))
}

/* ==================================================================== *
 *  De stijlbladen sluiten zichzelf
 *
 *  Eén vergeten accolade, en de halve app staat er kaal bij.
 *
 *  Zo ging het in september 2026. Bij het omzetten van 64px naar een
 *  variabele viel de sluitaccolade van een @media weg. CSS is vergevend: de
 *  browser klaagt niet, hij sluit het blok bij het einde van het bestand.
 *  Alles wat erachter stond viel daarmee binnen "max-width: 860px" -- en
 *  omdat Vite alle stijlbladen achter elkaar plakt, gold dat ook voor
 *  auth.css, rolzoek.css, trucksupply.css en vestigingen.css. Op een gewoon
 *  scherm was er dus opeens geen opmaak meer, zonder één foutmelding.
 *
 *  De typecontrole ziet dat niet, de zelftest zag het niet, en de bouw
 *  slaagde gewoon. Vandaar deze telling.
 *
 *  Commentaar telt apart mee: een /* dat nooit sluit slikt de rest van het
 *  bestand op dezelfde stille manier.
 * ==================================================================== */

console.log('\n39. De stijlbladen sluiten zichzelf')

{
  const { readFileSync, readdirSync } = await import('node:fs')

  const map = 'src/styles'
  const bladen = readdirSync(map).filter((n) => n.endsWith('.css')).sort()
  check('er zijn stijlbladen om na te kijken', bladen.length >= 4, String(bladen.length))

  for (const naam of bladen) {
    const ruw = readFileSync(`${map}/${naam}`, 'utf8')

    /* Eerst het commentaar zelf: ongelijk aantal openers en sluiters betekent
       dat er een blok openstaat, en dan klopt de telling hieronder ook niet. */
    const open = (ruw.match(/\/\*/g) ?? []).length
    const dicht = (ruw.match(/\*\//g) ?? []).length
    check(`${naam}: elk commentaar wordt gesloten`, open === dicht,
      `${open} keer /* tegen ${dicht} keer */`)

    /* En dan de accolades, met het commentaar eruit -- daar staan er ook
       tussen, en die tellen niet mee. */
    const zonder = ruw.replace(/\/\*[\s\S]*?\*\//g, ' ')
    const na = (zonder.match(/\{/g) ?? []).length
    const uit = (zonder.match(/\}/g) ?? []).length
    check(`${naam}: elke accolade wordt gesloten`, na === uit,
      `${na} keer { tegen ${uit} keer }`)
  }
}

/* ==================================================================== *
 *  Terugkomen uit Exact
 *
 *  Casper: "zodat ik erop kan klikken, en erop terug kom."
 *
 *  Twee dingen kunnen hier stil misgaan, en allebei zijn ze niet met het
 *  oog te zien.
 *
 *  Het eerste is een open doorstuurluik. De serverfunctie stuurt je na het
 *  koppelen door naar een adres uit de instellingen. Wordt dat adres niet
 *  nagekeken, dan staat er op ons eigen domein een link die iedereen ergens
 *  anders heen stuurt -- precies wat je in een phishingmail wil hebben.
 *
 *  Het tweede is de tekst van Exact doorgeven aan het scherm. Die komt uit
 *  een URL die iedereen kan sturen; hem tonen betekent dat een vreemde
 *  bepaalt wat er in het dashboard staat. Daarom een vast rijtje woorden.
 * ==================================================================== */

console.log('\n40. Terugkomen uit Exact')

{
  const { readFileSync } = await import('node:fs')
  const bron = readFileSync('supabase/functions/exact/index.ts', 'utf8')

  check('er wordt teruggestuurd naar de app', bron.includes('async function terugNaarApp'))
  check('het adres komt uit de instellingen', bron.includes("eq('sleutel', 'app_url')"))

  /* Alleen https, en zonder inlognaam in het adres. */
  check('een adres dat geen https is wordt niet gebruikt',
    bron.includes("if (u.protocol !== 'https:' || u.username || u.password) return null"))
  check('en bij twijfel blijft de oude pagina staan',
    bron.includes('if (!app) return pagina(titel, tekst, status)'))

  /*
   * Wat er in de URL belandt is een van onze eigen woorden. Zou hier de
   * foutmelding van Exact staan, dan schrijft een vreemde mee in het scherm.
   */
  const woorden = ['ok', 'geweigerd', 'verlopen', 'sleutels', 'token']
  check('er gaat een vast woord mee terug, geen foutmelding',
    woorden.every((w) => bron.includes(`terugNaarApp('${w}'`)))
  check('en de tekst van Exact gaat niet mee in de URL',
    !/searchParams\.set\('exact',\s*(fout|reden|antwoord)/.test(bron))

  /* --- het scherm --- */

  const scherm = readFileSync('src/dashboards/developer/Exact.tsx', 'utf8')
  check('het scherm vangt de terugkeer op',
    scherm.includes("searchParams.get('exact')"))
  /*
   * En haalt hem daarna uit de URL. Blijft hij staan, dan krijg je bij elke
   * verversing dezelfde melding, en na een herstart een melding over iets
   * van vorige week.
   */
  check('en haalt het woord daarna uit de URL',
    scherm.includes("u.searchParams.delete('exact')")
    && scherm.includes('window.history.replaceState'))

  /*
   * De Windows-app opent je gewone browser, en die kan het app-venster niet
   * terugroepen. Zonder navragen zou je naar "niet gekoppeld" zitten kijken
   * terwijl het allang gelukt is.
   */
  check('en vraagt zelf na terwijl je bij Exact bent',
    scherm.includes('if (!wachten) return') && scherm.includes('setWachten(true)'))
  check('dat navragen stopt vanzelf',
    scherm.includes('const tot = Date.now() + 3 * 60_000'))
}

/* ==================================================================== *
 *  Het dossier valt uiteen (0056)
 *
 *  Casper: "als leidinggevende een medewerker aanmaken, moeten hun ook
 *  gewoon een BSN zien."
 *
 *  De schematest bewaakt de kant van de database. Dit hoofdstuk bewaakt de
 *  kant van de app, en dat is een andere fout: hier gaat het niet mis met
 *  een policy maar met een veld dat terugkruipt. Zou het rekeningnummer of
 *  het uurloon ooit weer via dossier.save() meegaan, dan schrijft de app het
 *  in personnel_private -- en dan staat het weer naast de identiteit, waar
 *  de leidinggevende bij mag.
 *
 *  Dat levert geen foutmelding op. Het veld verdwijnt gewoon stilletjes naar
 *  de verkeerde tabel.
 * ==================================================================== */

console.log('\n41. Het dossier valt uiteen')

{
  const { readFileSync } = await import('node:fs')

  /* --- de opslaghulp --- */

  const repo = readFileSync('src/lib/dossier.ts', 'utf8')
  check('er is een aparte bewaring voor de geldkant', repo.includes('async saveLoon('))
  check('die schrijft in personnelLoon',
    /put\('personnelLoon', db\.personnelLoon, rij\)/.test(repo))

  /*
   * En de gewone save() raakt het geld niet aan. Deze twee stukken staan
   * vlak onder elkaar in hetzelfde bestand; één copy-paste te veel en het
   * uurloon zit weer in de verkeerde helft.
   */
  const gewoon = repo.slice(repo.indexOf('async save('), repo.indexOf('async saveLoon('))
  check('en de gewone bewaring schrijft alleen in personnelPrivate',
    gewoon.includes("put('personnelPrivate'") && !gewoon.includes('personnelLoon'))

  /* --- het scherm --- */

  const scherm = readFileSync('src/components/Dossier.tsx', 'utf8')

  check('de geldkant komt uit de eigen tabel',
    scherm.includes('db.personnelLoon.get(person.id)'))
  check('en het scherm kent twee rechten',
    scherm.includes("const magInvullen = magBeheren || perms.can('staff.view')"))

  /*
   * Het rekeningnummer, het uurloon en de interne notitie horen alleen in
   * beeld te komen voor wie eraan mag. Niet grijs, niet leeg: afwezig.
   */
  for (const veld of ['Rekeningnummer', 'Uurtarief', 'Interne notitie']) {
    const i = scherm.indexOf(`label="${veld}`)
    check(`${veld} staat achter magBeheren`,
      i > 0 && /\{magBeheren && \($/m.test(scherm.slice(Math.max(0, i - 260), i)),
      i > 0 ? 'gevonden maar niet afgeschermd' : 'veld niet gevonden')
  }

  /* En bij het opslaan gaat de geldkant apart, achter hetzelfde recht. */
  check('opslaan van het geld gebeurt alleen met dat recht',
    /if \(magBeheren\) \{\s*await dossierRepo\.saveLoon\(/.test(scherm))

  /* --- wat er niet meer bij de identiteit hoort te staan --- */

  const opslaan = scherm.slice(scherm.indexOf('await dossierRepo.save(person.id, {'),
    scherm.indexOf('if (magBeheren) {'))
  for (const veld of ['iban:', 'hourlyRate:', 'internalNotes:']) {
    check(`${veld.slice(0, -1)} gaat niet mee met de identiteitsgegevens`,
      !opslaan.includes(veld))
  }

  /* --- de synchronisatie kent de nieuwe tabel --- */

  const sync = readFileSync('src/lib/sync.ts', 'utf8')
  check('personnelLoon staat in de duwvolgorde', sync.includes("'personnelLoon'"))
  check('en wordt opgeruimd bij het uitloggen',
    (sync.match(/db\.personnelLoon\.clear\(\)/g) ?? []).length === 2)
}

/* ==================================================================== *
 *  Zoeken in de kostenposten (0061)
 *
 *  Eén veld voor alles, want dat is hoe mensen zoeken: ze typen wat ze
 *  weten. Wat daarbij makkelijk stukgaat zonder dat je het merkt zijn twee
 *  dingen -- meerdere woorden, en een bedrag met een komma.
 * ==================================================================== */

console.log('\n42. Zoeken in de kostenposten')

{
  const { pastBijZoek } = await import('../src/dashboards/administratie/Kostenposten')

  const bon = {
    id: 'exp_1',
    supplier: 'Shell Nederland Verkoopmij B.V.',
    description: 'Brandstof maart',
    factuurnummer: '2026-00841',
    grootboekCode: '4080',
    amountExcl: 248.5,
    status: 'open',
    updatedAt: 0,
  } as never

  check('leeg zoeken laat alles staan', pastBijZoek(bon, ''))
  check('op leverancier', pastBijZoek(bon, 'shell'))
  check('hoofdletters maken niet uit', pastBijZoek(bon, 'SHELL'))
  check('op factuurnummer', pastBijZoek(bon, '00841'))
  check('op grootboekcode', pastBijZoek(bon, '4080'))

  /*
   * Twee woorden betekent: allebei moeten voorkomen. Zou het OF zijn, dan
   * geeft "shell maart" alles met shell én alles met maart -- en dan is
   * zoeken op twee woorden erger dan op één.
   */
  check('twee woorden moeten allebei voorkomen', pastBijZoek(bon, 'shell maart'))
  check('en een woord dat er niet is sluit hem uit', !pastBijZoek(bon, 'shell februari'))

  /*
   * Het bedrag staat als 248.5 in de database en je typt 248,50. Zonder de
   * tweede schrijfwijze vind je je eigen bon niet.
   */
  check('op bedrag met een punt', pastBijZoek(bon, '248.5'))
  check('en met een komma', pastBijZoek(bon, '248,5'))

  check('wat er niet in staat vindt hij niet', !pastBijZoek(bon, 'enexis'))
}

/* ==================================================================== *
 *  Het SEPA-betaalbestand (0065)
 *
 *  Een bank weigert een bestand met één foute IBAN in ZIJN GEHEEL. Niet die
 *  ene regel: het hele bestand. Dan sta je met achttien facturen die niet
 *  betaald zijn en een foutmelding die alleen zegt dat er iets niet klopt.
 *
 *  En die IBAN's komen uit een factuur die door een model is gelezen.
 *  Meestal goed, en soms een cijfer verkeerd -- precies wat de mod-97-toets
 *  eruit haalt.
 * ==================================================================== */

console.log('\n43. Het SEPA-betaalbestand')

{
  const { ibanKlopt, maakSepa } = await import('../supabase/functions/_gedeeld/sepa.ts')

  /* --- de toets --- */

  check('een goede Nederlandse IBAN komt erdoor', ibanKlopt('NL91ABNA0417164300'))
  check('met spaties ook', ibanKlopt('NL91 ABNA 0417 1643 00'))
  check('en in kleine letters', ibanKlopt('nl91abna0417164300'))

  /*
   * Eén cijfer verkeerd is precies wat een model doet met een slechte scan.
   * Zou dat erdoor komen, dan gaat er geld naar een rekening die niet
   * bestaat -- of erger, naar een die wel bestaat.
   */
  check('één cijfer verkeerd valt af', !ibanKlopt('NL91ABNA0417164301'))
  check('een te korte valt af', !ibanKlopt('NL91ABNA04'))
  check('en leeg ook', !ibanKlopt(''))

  /* --- het bestand --- */

  const uit = maakSepa({
    berichtId: 'bb_test1',
    eigenNaam: 'Truckwash1 Group B.V.',
    eigenIban: 'NL91ABNA0417164300',
    uitvoerenOp: new Date('2026-04-03T00:00:00Z'),
    regels: [
      { id: 'exp_1', naam: 'Enexis B.V.', iban: 'NL02ABNA0123456789', bedrag: 121, kenmerk: '2026-00841' },
      { id: 'exp_2', naam: 'Fout & Co', iban: 'NL00FOUT0000000000', bedrag: 50, kenmerk: 'X' },
      { id: 'exp_3', naam: 'Nul B.V.', iban: 'NL91ABNA0417164300', bedrag: 0, kenmerk: 'Y' },
    ],
  })

  check('alleen de goede regel gaat mee', uit.aantal === 1, String(uit.aantal))
  check('en de andere twee worden gemeld met een reden',
    uit.overgeslagen.length === 2
    && uit.overgeslagen.some((o) => /klopt niet/.test(o.reden))
    && uit.overgeslagen.some((o) => /nul/.test(o.reden)),
    JSON.stringify(uit.overgeslagen))

  check('het totaal is dat van wat meegaat', uit.totaal === 121, String(uit.totaal))

  /*
   * De bank telt na. Staat er in CtrlSum iets anders dan de som van de
   * bedragen, of in NbOfTxs iets anders dan het aantal, dan weigert hij het
   * bestand -- en dat is precies het soort fout dat je niet met het oog ziet.
   */
  check('het aantal in de kop klopt met de regels',
    (uit.xml.match(/<NbOfTxs>1<\/NbOfTxs>/g) ?? []).length === 2)
  check('en het controletotaal ook',
    (uit.xml.match(/<CtrlSum>121\.00<\/CtrlSum>/g) ?? []).length === 2)

  check('de uitvoerdatum staat erin', uit.xml.includes('<ReqdExctnDt>2026-04-03</ReqdExctnDt>'))
  check('en het is pain.001.001.03',
    uit.xml.includes('urn:iso:std:iso:20022:tech:xsd:pain.001.001.03'))

  /*
   * Een leveranciersnaam met een ampersand erin maakt van geldige XML een
   * bestand dat de bank niet kan lezen -- en dat merk je pas daar.
   */
  const metTeken = maakSepa({
    berichtId: 'bb_test2',
    eigenNaam: 'Truckwash1 Group B.V.',
    eigenIban: 'NL91ABNA0417164300',
    uitvoerenOp: new Date('2026-04-03T00:00:00Z'),
    regels: [{ id: 'exp_9', naam: 'Jansen & Zonen', iban: 'NL02ABNA0123456789', bedrag: 10 }],
  })
  /*
   * De ampersand haalt het bestand niet eens: SEPA staat hem niet toe in een
   * naam, dus hij wordt al bij het opschonen vervangen. Dat is de goede
   * uitkomst -- de bank zou hem anders weigeren. Wat hier wordt vastgelegd is
   * dat er GEEN losse & in de XML belandt, hoe dan ook: dat zou van geldige
   * XML een bestand maken dat niet te lezen is.
   */
  check('een ampersand haalt het bestand niet',
    metTeken.xml.includes('Jansen Zonen'), metTeken.xml.match(/<Nm>[^<]*<\/Nm>/g)?.join(' | '))
  check('en er staat nergens een losse ampersand in',
    !/&(?!(amp|lt|gt|quot|apos);)/.test(metTeken.xml))

  /* En tekens die SEPA niet toestaat worden vervangen, niet weggelaten:
     "Müller" hoort "Muller" te worden en niet "Mller". */
  const metAccent = maakSepa({
    berichtId: 'bb_test3',
    eigenNaam: 'Truckwash1 Group B.V.',
    eigenIban: 'NL91ABNA0417164300',
    uitvoerenOp: new Date('2026-04-03T00:00:00Z'),
    regels: [{ id: 'exp_8', naam: 'Müller Transport', iban: 'NL02ABNA0123456789', bedrag: 10 }],
  })
  check('een accent wordt vervangen en niet weggelaten',
    metAccent.xml.includes('Muller Transport'), metAccent.xml.slice(0, 0) || 'zie bestand')

  /* En een eigen rekening die niet klopt is geen regel die je overslaat maar
     een bestand dat nergens heen kan. */
  let eigenFout = false
  try {
    maakSepa({
      berichtId: 'bb_test4',
      eigenNaam: 'Truckwash1 Group B.V.',
      eigenIban: 'NL00FOUT0000000000',
      uitvoerenOp: new Date('2026-04-03T00:00:00Z'),
      regels: [{ id: 'exp_7', naam: 'Test', iban: 'NL02ABNA0123456789', bedrag: 10 }],
    })
  } catch {
    eigenFout = true
  }
  check('een eigen rekening die niet klopt stopt het hele bestand', eigenFout)
}

/* ====================================================================
 *  44. Waar een link in een mail uitkomt
 *
 *  Casper: "kan je ervoor zorgen dat alle linken die in mails worden
 *  verstuurd op de website uitkomen ipv de github release?"
 *
 *  Waarom hier een toets op staat en niet alleen een aanpassing: dit is een
 *  fout die niemand ziet. De code doet het, de mail komt aan, de knop werkt
 *  -- hij komt alleen op de verkeerde plek uit. Er stond bovendien twee keer
 *  dezelfde constante in twee functies, dus één van de twee terugzetten kon
 *  ongemerkt. Nu staat het adres op één plek en let dit hoofdstuk erop dat er
 *  geen tweede bijkomt.
 *
 *  En op het schoonvegen van wat er uit een mail meekomt. Het adres in een
 *  mail is de enige plek waar een buitenstaander invloed heeft op waar de app
 *  heen springt.
 * ==================================================================== */

console.log('\n44. Waar een link in een mail uitkomt')

{
  const { readFileSync } = await import('node:fs')
  const { ophalen, openen } = await import('../supabase/functions/_gedeeld/adressen.ts')

  const site = new URL('https://truckwash-workspace.com/')
  const app = new URL('https://truckwash-workspace.com/app/')

  /* --- de twee soorten link --- */

  check('"de app ophalen" gaat naar de medewerkerspagina',
    ophalen(site) === 'https://truckwash-workspace.com/medewerkers/')

  check('een site met een pad erin raakt dat pad kwijt, want /medewerkers/ staat op de wortel',
    ophalen(new URL('https://truckwash-workspace.com/ergens/')) ===
      'https://truckwash-workspace.com/medewerkers/')

  check('zonder scherm is het gewoon de app', openen(app) === 'https://truckwash-workspace.com/app/')

  check('met een scherm komt dat erachter',
    openen(app, 'postbus') === 'https://truckwash-workspace.com/app/?open=postbus')

  check('en met een id erbij',
    openen(app, 'kosten', 'exp_7') ===
      'https://truckwash-workspace.com/app/?open=kosten&id=exp_7')

  /* --- wat er niet doorheen mag ---
   *
   * Deze waarden komen van de aanroeper van de serverfunctie. Een schuine
   * streep of een vraagteken dat hier ongezien in glipt, verandert niet de
   * parameter maar het adres zelf -- en dan staat er een link in onze mail,
   * met ons logo erboven, die ergens anders uitkomt.
   */

  const junk = ['../../kwaad', 'post/bus', 'a?b=c', 'a&b', 'a b', '', 'https://elders.nl']
  check('rommel als scherm wordt genegeerd',
    junk.every((j) => openen(app, j) === 'https://truckwash-workspace.com/app/'))

  check('en rommel als id ook, terwijl het scherm blijft staan',
    junk.filter((j) => j !== '').every((j) =>
      openen(app, 'postbus', j) === 'https://truckwash-workspace.com/app/?open=postbus'))

  check('een scherm van veertig tekens of langer valt af',
    openen(app, 'x'.repeat(80)) === 'https://truckwash-workspace.com/app/?open=' + 'x'.repeat(40))

  /* --- en geen enkele mail wijst nog naar GitHub --- */

  const mailers = ['stuur-mail', 'nodig-uit']
  const bronnen = mailers.map((m) =>
    readFileSync(`supabase/functions/${m}/index.ts`, 'utf8'))

  check('geen mailfunctie noemt nog een GitHub-adres',
    bronnen.every((b) => !/github\.com/.test(b)))

  /* Op de declaratie en niet op het woord: de commentaarregels die uitleggen
     wat er stond noemen APP_LINK, en die horen te blijven staan. */
  check('en geen van beide heeft nog een eigen APP_LINK-constante',
    bronnen.every((b) => !/const\s+APP_LINK/.test(b)))

  /*
   * De app moet de schermnaam uit het adres nakijken tegen haar eigen lijst.
   * Zonder die controle kan een link iemand een scherm in duwen dat hij niet
   * had gekozen -- en een adres uit een mail komt van wie de mail stuurde.
   */
  const nav = readFileSync('src/store/useNav.ts', 'utf8')
  check('de app kijkt een schermnaam uit een adres na tegen DASHBOARDS_MET',
    /DASHBOARDS_MET\[scherm\]/.test(nav))
  check('en veegt het adres daarna schoon',
    /searchParams\.delete\('open'\)/.test(nav) && /replaceState/.test(nav))
}

/* ====================================================================
 *  45. Werk en werving
 *
 *  Drie regels die op meer dan één plek staan en dus uit de pas kunnen gaan
 *  lopen:
 *
 *    - wat er bij mij ligt (isVanMij in werk.ts, de policy in 0067, en
 *      taken_voor_mail() in 0070)
 *    - wie welke vacature mag (magVacature in werving.ts en mag_vacature in
 *      0068)
 *    - de leeftijd uit een geboortedatum, die het loon uit de salaristabel
 *      bepaalt
 *
 *  De eerste twee kunnen hier alleen aan de app-kant worden nagemeten; de SQL
 *  ernaast staat in sqltest.mjs. Wat hier telt is dat de app niet iets anders
 *  zegt dan wat er in de kop van 0067 en 0068 beloofd wordt.
 * ==================================================================== */

console.log('\n45. Werk en werving')

{
  const { isVanMij, magBijLocatie, isTeLaat, opDringendheid } = await import('../src/lib/werk.ts')
  const { leeftijd, slugVan, magVacature } = await import('../src/lib/werving.ts')

  const mens = (extra: Record<string, unknown> = {}) => ({
    id: 'u1', email: 'a@b.nl', password: '', name: 'Test',
    roles: ['supervisor'], active: true, updatedAt: 0, ...extra,
  }) as never

  const taak = (extra: Record<string, unknown> = {}) => ({
    id: 't1', titel: 'x', status: 'te_doen', prioriteit: 'normaal',
    volgorde: 0, bron: 'handmatig', createdAt: 0, updatedAt: 0, ...extra,
  }) as never

  /* --- bij wie ligt het --- */

  check('op mijn naam is van mij',
    isVanMij(taak({ toegewezenAan: 'u1' }), mens()))

  check('een taak van iemand anders niet',
    !isVanMij(taak({ toegewezenAan: 'u2' }), mens()))

  /*
   * Werk dat bij een rol ligt is het geval waar het om draait: dat is werk dat
   * nog door niemand is opgepakt. Zonder deze regel ziet niemand een nieuwe
   * sollicitatie tot iemand er toevallig op klikt.
   */
  check('werk dat bij mijn rol ligt op mijn vestiging is van mij',
    isVanMij(taak({ toegewezenRol: 'supervisor', locationId: 'loc_venlo' }),
             mens({ locationId: 'loc_venlo' })))

  check('maar niet op een vestiging waar ik niets te zeggen heb',
    !isVanMij(taak({ toegewezenRol: 'supervisor', locationId: 'loc_groenlo' }),
              mens({ locationId: 'loc_venlo' })))

  check('en niet als het bij een andere rol ligt',
    !isVanMij(taak({ toegewezenRol: 'management', locationId: 'loc_venlo' }),
              mens({ locationId: 'loc_venlo' })))

  check('wie leiding heeft over een vestiging telt die mee',
    isVanMij(taak({ toegewezenRol: 'supervisor', locationId: 'loc_ede' }),
             mens({ manages: ['loc_ede', 'loc_wehl'] })))

  check('het hoofdkantoor mag overal bij',
    magBijLocatie('loc_wat_dan_ook', mens({ allLocations: true })))

  check('en een taak zonder vestiging is voor iedereen',
    magBijLocatie(undefined, mens({ locationId: 'loc_venlo' })))

  /* --- over de datum --- */

  const gisteren = Date.now() - 86_400_000
  check('een taak met een datum van gisteren is te laat',
    isTeLaat(taak({ deadline: gisteren })))
  check('maar niet als hij al klaar is',
    !isTeLaat(taak({ deadline: gisteren, status: 'klaar' })))
  check('en zonder datum kun je niet te laat zijn',
    !isTeLaat(taak({})))

  /*
   * Op de lijst telt de prioriteit eerst en de datum daarna, en een taak
   * zonder datum komt achter een taak met een datum. Anders staat "ooit een
   * keer" boven "vandaag af".
   */
  const gesorteerd = [
    taak({ id: 'a', prioriteit: 'normaal', deadline: gisteren }),
    taak({ id: 'b', prioriteit: 'urgent' }),
    taak({ id: 'c', prioriteit: 'normaal' }),
  ].sort(opDringendheid).map((t: { id: string }) => t.id).join('')
  check('het dringendst bovenaan, zonder datum onderaan', gesorteerd === 'bac', gesorteerd)

  /* --- de leeftijd --- */

  const nu = new Date('2026-09-08T12:00:00Z')
  check('leeftijd uit een geboortedatum', leeftijd('2000-01-01', nu) === 26)
  /*
   * De verjaardag van vandaag telt mee, die van morgen niet. Dat verschil is
   * precies wat de salaristabel doet: op je verjaardag ga je een regel omlaag.
   */
  check('op je verjaardag ben je al jarig', leeftijd('2008-09-08', nu) === 18)
  check('een dag ervoor nog niet', leeftijd('2008-09-09', nu) === 17)
  check('rommel geeft niets terug', leeftijd('gisteren', nu) === null)
  check('en niets geeft ook niets terug', leeftijd(undefined, nu) === null)

  /* --- de slug --- */

  check('een titel wordt een adres', slugVan('Wasmedewerker Venlo') === 'wasmedewerker-venlo')
  check('accenten en leestekens gaan eruit',
    slugVan('Chauffeur (C/CE) — Zoë!') === 'chauffeur-c-ce-zoe')
  check('en er blijven geen streepjes aan de randen staan',
    slugVan('  Horeca  ') === 'horeca')

  /* --- wie welke vacature mag ---
   *
   * Een lege lijst vestigingen betekent "overal". Een leidinggevende mag dat
   * daarom niet: "overal" bevat ook de zeventien vestigingen waar hij niets te
   * zeggen heeft. Dezelfde regel staat als mag_vacature() in 0068.
   */

  const leiding = mens({ manages: ['loc_venlo'] })
  const baas = mens({ roles: ['management'], allLocations: true })

  check('het management mag een vacature voor alle vestigingen',
    magVacature([], baas))
  check('een leidinggevende niet',
    !magVacature([], leiding))
  check('wel voor zijn eigen vestiging',
    magVacature(['loc_venlo'], leiding))
  check('niet voor die van een ander',
    !magVacature(['loc_groenlo'], leiding))
  check('en niet voor een lijst waar er een van een ander bij zit',
    !magVacature(['loc_venlo', 'loc_groenlo'], leiding))
  check('een gewone medewerker mag helemaal niets',
    !magVacature(['loc_venlo'], mens({ roles: ['employee'], locationId: 'loc_venlo' })))
}

/* ====================================================================
 *  46. Welke vestiging mag je kiezen
 *
 *  Casper zag dit: "De database weigert dit voor doc_bestand: new row
 *  violates row-level security policy. Dat gaat over rechten, niet over dit
 *  record -- het blijft in de wachtrij staan."
 *
 *  De regel in de database was goed; het SCHERM was fout. In het
 *  documentvenster stonden alle achttien vestigingen in de keuzelijst, ook die
 *  waar je niet over gaat. Koos je zo'n vestiging, dan schreef de app het
 *  lokaal weg, weigerde de server het, en bleef het record in de wachtrij
 *  hangen -- met een melding waar je niets aan hebt, want die zegt "rechten"
 *  en niet "je koos Ede".
 *
 *  Een keuzelijst die iets aanbiedt wat de server terugstuurt is geen
 *  keuzelijst maar een val. Vandaar hier een toets: wat de app aanbiedt is
 *  precies wat in_my_locations() op de server doorlaat.
 * ==================================================================== */

console.log('\n46. Welke vestiging mag je kiezen')

{
  const { mijnVestigingen, magVestigingKiezen } = await import('../src/lib/documenten.ts')

  const mens = (extra: Record<string, unknown> = {}) => ({
    id: 'u1', email: 'a@b.nl', password: '', name: 'Test',
    roles: ['supervisor'], active: true, updatedAt: 0, ...extra,
  }) as never

  const alle = [{ id: 'loc_a' }, { id: 'loc_b' }, { id: 'loc_c' }]
  const namen = (xs: { id: string }[]) => xs.map((x) => x.id).join(',')

  check('het hoofdkantoor mag alles kiezen',
    namen(mijnVestigingen(alle, mens({ allLocations: true }))) === 'loc_a,loc_b,loc_c')

  check('een leidinggevende alleen zijn eigen vestiging',
    namen(mijnVestigingen(alle, mens({ locationId: 'loc_a' }))) === 'loc_a')

  check('en zijn eigen plus wat hij beheert',
    namen(mijnVestigingen(alle, mens({ locationId: 'loc_a', manages: ['loc_c'] })))
      === 'loc_a,loc_c')

  /*
   * Iemand zonder vestiging krijgt een LEGE lijst en niet alles. Dat is het
   * verschil dat de val maakte: de oude lijst gaf alles, en dan koos hij iets
   * dat de server weigerde.
   */
  check('wie geen vestiging heeft, krijgt er ook geen te kiezen',
    mijnVestigingen(alle, mens({})).length === 0)

  /* --- en de rem die hetzelfde zegt --- */

  check('geen vestiging mag altijd',
    magVestigingKiezen(undefined, mens({ locationId: 'loc_a' })))
  check('de eigen vestiging mag',
    magVestigingKiezen('loc_a', mens({ locationId: 'loc_a' })))
  /*
   * Dit is de regel die de wachtrij liet vastlopen. Hij hoort nu op het scherm
   * te falen met een zin die zegt wat er aan de hand is, en niet stil in de
   * wachtrij.
   */
  check('die van een ander niet',
    !magVestigingKiezen('loc_b', mens({ locationId: 'loc_a' })))
  check('tenzij je overal mag',
    magVestigingKiezen('loc_b', mens({ allLocations: true })))

  /* Wat de lijst aanbiedt en wat de rem doorlaat, horen hetzelfde te zijn --
     anders is de een een val voor de ander. */
  const leiding = mens({ locationId: 'loc_a', manages: ['loc_c'] })
  check('de lijst en de rem zijn het overal over eens',
    alle.every((l) =>
      mijnVestigingen(alle, leiding).some((x) => x.id === l.id)
        === magVestigingKiezen(l.id, leiding)))
}

/* ====================================================================
 *  47. De brug tussen de rollen en de database
 *
 *  De database kende rollen niet. heeft_recht() keek alleen naar
 *  profiles.grants, en de app schrijft een recht dat uit de ROL komt daar
 *  bewust niet in. Gevolg: 22 policies stonden dicht voor precies de mensen
 *  voor wie ze geschreven waren.
 *
 *  0072 lost dat op met een tabel rol_recht: een korte, leesbare lijst van
 *  rolrechten die de database mag afleiden. Bewust een lijst en niet "lees
 *  permissions.ts maar uit", want dat laatste zou en passant staff.view aan
 *  elke leidinggevende geven.
 *
 *  Maar een tweede lijst is een tweede waarheid, en twee waarheden lopen uit
 *  elkaar. Dit hoofdstuk is de klem: wat de database aanneemt moet de app ook
 *  echt geven. Zet iemand later een regel in rol_recht die in permissions.ts
 *  niet bestaat, dan valt dit om -- en niet een half jaar later op een
 *  maandagochtend.
 * ==================================================================== */

console.log('\n47. De brug tussen de rollen en de database')

{
  const { readFileSync } = await import('node:fs')
  const { ROLE_DEFAULTS } = await import('../src/lib/permissions.ts')

  const sql = readFileSync(
    'supabase/migrations/0072_de_administratie_komt_binnen.sql', 'utf8')

  /* De regels uit de insert lezen, zoals ze er staan. */
  const blok = sql.slice(sql.indexOf('insert into public.rol_recht'))
  /* Ruim genoeg voor elke naam die permissions.ts kan bevatten. Een rij die
     dit patroon niet leest, is een rij die niemand controleert -- en dat is
     precies het gat dat dit hoofdstuk moet dichten. */
  const rijen = [...blok.matchAll(/\('([a-z0-9_]+)',\s*'([a-z0-9._]+)'/g)]
    .map(([, rol, recht]) => ({ rol, recht }))

  check('de brug bevat regels', rijen.length >= 5, String(rijen.length))

  /*
   * De klem zelf. Elk paar in rol_recht moet in ROLE_DEFAULTS staan --
   * anders neemt de database iets aan wat de app niet geeft, en dan mag
   * iemand in de database meer dan op zijn scherm.
   */
  const mist = rijen.filter(({ rol, recht }) =>
    !((ROLE_DEFAULTS as Record<string, string[]>)[rol] ?? []).includes(recht))
  check('en geeft niets wat de rol in de app niet geeft',
    mist.length === 0, mist.map((m) => `${m.rol}/${m.recht}`).join(', '))

  /*
   * En andersom NIET. De administratie heeft in de app ruim dertig rechten;
   * de database hoort er maar een handvol te kennen. Een brug die alles
   * overzet is dezelfde generieke oplossing die staff.view zou opengooien.
   */
  const adm = rijen.filter((r) => r.rol === 'administratie').length
  const inApp = (ROLE_DEFAULTS as Record<string, string[]>).administratie.length
  check('maar bewust niet alles wat de rol geeft', adm < inApp / 3,
    `${adm} van ${inApp}`)

  /* Een intrekking hoort te winnen, anders is het management machteloos. */
  check('een intrekking sluit de brug',
    /not \(recht = any\(\s*\n?\s*coalesce\(\(select revokes/.test(sql))

  /* --- en de tweede functie die op grants alleen keek --- */

  const postbus = readFileSync('supabase/functions/postbus-actie/index.ts', 'utf8')
  /*
   * Deze was al stuk voor de ontwikkelaar, los van welke verbouwing dan ook:
   * de knoppen Delen en Bijlagen-opnieuw stonden in beeld en gaven 403, omdat
   * mail.read bij hem uit de rol komt en de controle alleen naar grants keek.
   */
  check('postbus-actie kijkt naar de rollen en niet alleen naar grants',
    /POSTROLLEN = \['management', 'developer', 'administratie'\]/.test(postbus))
  check('en laat een los toegekend recht ook nog toe',
    postbus.includes("beller.rechten.includes('mail.read')"))
}

/* ====================================================================
 *  48. Te verwerken: welke stand heeft een factuur
 *
 *  Casper vroeg om een werklijst met statussen, en om iets wat niet meteen
 *  opgeeft als een bestand niet te lezen is: "Probeer opnieuw of gebruik een
 *  andere aanpak. Ga niet zomaar gokken."
 *
 *  De standen zijn geen nieuw veld maar een antwoord dat uit de bestaande
 *  velden wordt afgeleid -- lees_status, status, exact_id, exact_fout. Dat
 *  antwoord hangt af van de VOLGORDE waarin de vragen worden gesteld, en
 *  precies daar gaat zoiets stuk: een goedgekeurde factuur die Exact heeft
 *  teruggestuurd, hoort bij "er is iets mis" en niet bij "moet nog geboekt".
 *  Verwissel je die twee vragen, dan verdwijnt de fout in de gewone stapel.
 * ==================================================================== */

console.log('\n48. Te verwerken: welke stand heeft een factuur')

{
  const {
    LEZEN_DUURT_HOOGSTENS, STANDEN, ontbreekt, standVan, telStuk, telWerk, verdeel,
  } = await import('../src/lib/werklijst.ts')

  const NU = 1_800_000_000_000

  const bon = (extra: Record<string, unknown> = {}) => ({
    id: 'e1', locationId: 'loc_a', date: NU - 86_400_000, category: 'materiaal',
    supplier: 'Chemtrans', description: '', amountExcl: 100, vatPct: 21,
    status: 'open', submittedBy: 'u1', submittedByName: 'Wim', updatedAt: NU,
    ...extra,
  }) as never

  /* --- de gewone gang van zaken --- */

  check('een complete bon wacht op akkoord',
    standVan(bon(), NU) === 'akkoord')
  check('met de eerste handtekening erop wacht hij op de tweede',
    standVan(bon({ status: 'eerste_akkoord' }), NU) === 'tweede')
  check('goedgekeurd betekent: moet naar Exact',
    standVan(bon({ status: 'goedgekeurd' }), NU) === 'boeken')
  check('en met een exact-id is hij klaar',
    standVan(bon({ status: 'goedgekeurd', exactId: '12345' }), NU) === 'klaar')

  /*
   * De volgorde waar het om draait. Deze bon is goedgekeurd EN Exact gaf een
   * fout. Zou 'goedgekeurd' eerst worden nagevraagd, dan stond hij tussen het
   * werk dat nog moet gebeuren -- en dan probeert iemand hem morgen weer, en
   * overmorgen weer.
   */
  check('een fout van Exact wint van "moet nog geboekt worden"',
    standVan(bon({ status: 'goedgekeurd', exactFout: 'Dagboek 70 bestaat niet' }), NU)
      === 'geweigerd')

  /* --- het lezen --- */

  check('wat in de wachtrij staat wordt gelezen',
    standVan(bon({ leesStatus: 'wacht', amountExcl: 0 }), NU) === 'lezen')
  check('en wat mislukte is vastgelopen',
    standVan(bon({ leesStatus: 'mislukt', amountExcl: 0 }), NU) === 'vastgelopen')

  /*
   * De stilste van allemaal. De leescomputer eist een bon op, zet hem op
   * 'bezig', en valt uit. Zonder een grens blijft die bon eeuwig op 'bezig'
   * staan: hij is niet vastgelopen, want er is technisch iemand mee bezig, en
   * hij staat dus in geen enkele lijst die om aandacht vraagt.
   */
  check('bezig is bezig, zolang het niet te lang duurt',
    standVan(bon({ leesStatus: 'bezig', leesGeclaimdAt: NU - 60_000, amountExcl: 0 }), NU)
      === 'lezen')
  check('maar te lang bezig is vastgelopen',
    standVan(bon({
      leesStatus: 'bezig',
      leesGeclaimdAt: NU - LEZEN_DUURT_HOOGSTENS - 1,
      amountExcl: 0,
    }), NU) === 'vastgelopen')

  /* --- wat er ontbreekt --- */

  check('zonder bedrag valt er niets goed te keuren',
    standVan(bon({ amountExcl: 0 }), NU) === 'aanvullen')
  check('zonder leverancier ook niet',
    standVan(bon({ supplier: '  ' }), NU) === 'aanvullen')

  /*
   * "Ga niet zomaar gokken." Een model dat zelf zegt dat het ergens niet uit
   * kwam, hoort niet stil tussen "wacht op akkoord" te belanden alsof er
   * niets aan de hand is.
   */
  const twijfelt = bon({
    gelezen: { gelezenOp: NU, twijfel: ['Er staan twee btw-tarieven op.'] },
  })
  check('twijfel van de lezer telt als ontbrekend',
    standVan(twijfelt, NU) === 'aanvullen')
  check('en die twijfel staat er ook bij',
    ontbreekt(twijfelt).includes('Er staan twee btw-tarieven op.'))

  /* Een eigen verkoopfactuur tussen de inkoop: dan boek je je eigen omzet
     als kosten. */
  check('een factuur van onszelf wordt niet stil goedgekeurd',
    standVan(bon({ gelezen: { gelezenOp: NU, richting: 'verkoop' } }), NU) === 'aanvullen')

  /* --- de verdeling --- */

  const stapel = [
    bon({ id: 'a', status: 'goedgekeurd', exactId: 'X' }),          // klaar
    bon({ id: 'b', status: 'afgekeurd' }),                           // afgekeurd
    bon({ id: 'c', leesStatus: 'mislukt', amountExcl: 0 }),          // vastgelopen
    bon({ id: 'd' }),                                                // akkoord
    bon({ id: 'e', leesStatus: 'wacht', amountExcl: 0 }),            // lezen
  ]
  const vakken = verdeel(stapel, NU)

  /*
   * Wat af is doet niet mee. Een werklijst waar het afgehandelde werk in
   * blijft staan, wordt elke maand langer en elke maand minder gelezen.
   */
  check('afgeronde bonnen staan niet in de werklijst',
    !vakken.some((v) => v.stand.sleutel === 'klaar' || v.stand.sleutel === 'afgekeurd'))
  check('en wat kapot is staat bovenaan',
    vakken[0]?.stand.sleutel === 'vastgelopen')
  check('wat vanzelf verdergaat staat onderaan',
    vakken[vakken.length - 1]?.stand.sleutel === 'lezen')

  /* De badge telt alleen wat op een mens wacht. */
  check('de teller telt het werk en niet het wachten',
    telWerk(stapel, NU) === 2, String(telWerk(stapel, NU)))
  check('en apart wat er stuk is',
    telStuk(stapel, NU) === 1)

  /* Elke stand heeft een zin die zegt wat er van je verwacht wordt. Zonder
     die zin is een kopje "Aanvullen" een raadsel. */
  check('elke stand legt zichzelf uit',
    Object.values(STANDEN).every((st) => st.uitleg.length > 20 && st.uitleg.endsWith('.')))
}

/* ====================================================================
 *  49. De leesladder: niet meteen opgeven, en ook niet gokken
 *
 *  Een mail met een factuur heeft zelden precies een bijlage. Er zit een
 *  logo in de handtekening, algemene voorwaarden, soms een briefje. De
 *  server pakt er een, en als dat de verkeerde is kwam er "niet gelukt"
 *  terug -- terwijl de factuur in dezelfde mail zat. Wie op Opnieuw drukte
 *  kreeg exact dezelfde poging nog een keer.
 * ==================================================================== */

console.log('\n49. De leesladder')

{
  const { leesOpnieuw, opVolgorde, samenvat } = await import('../src/lib/leesladder.ts')

  const bijlage = (naam: string, mime: string, size: number, extra = {}) =>
    ({ naam, mime, size, path: `post/${naam}`, ...extra }) as never

  const bon = { id: 'e1', attachmentPath: 'post/oud.pdf' } as never

  /* --- de volgorde --- */

  const gemengd = [
    bijlage('logo.png', 'image/png', 4_000),
    bijlage('voorwaarden.pdf', 'application/pdf', 12_000),
    bijlage('factuur.pdf', 'application/pdf', 180_000),
    bijlage('foto.jpg', 'image/jpeg', 900_000),
  ]
  check('PDF gaat voor plaatje, en binnen een soort het grootste eerst',
    opVolgorde(gemengd).map((b) => b.naam).join(',')
      === 'factuur.pdf,voorwaarden.pdf,foto.jpg,logo.png')

  /* Een tegengehouden bijlage proberen we niet: die mag niet eens open. */
  check('een geweigerde bijlage doet niet mee',
    opVolgorde([...gemengd, bijlage('virus.pdf', 'application/pdf', 999_999,
      { controle: 'geweigerd', controleReden: 'Scanner sloeg aan' })])
      .every((b) => b.naam !== 'virus.pdf'))

  /* --- de ladder zelf --- */

  /* Eerste poging raak: dan hoort hij niet alsnog vier bijlagen af te gaan. */
  {
    const gedaan: (string | undefined)[] = []
    const uit = await leesOpnieuw(bon, gemengd, async (_id, pad) => {
      gedaan.push(pad)
      return { ok: true }
    })
    check('lukt het meteen, dan stopt hij meteen',
      uit.gelukt && gedaan.length === 1 && gedaan[0] === undefined)
  }

  /* De derde poging raak: hij moet doorgaan tot daar, en dan stoppen. */
  {
    const gedaan: (string | undefined)[] = []
    const uit = await leesOpnieuw(bon, gemengd, async (_id, pad) => {
      gedaan.push(pad)
      return gedaan.length === 3
        ? { ok: true }
        : { ok: false, reden: 'Geen factuur gevonden in dit bestand.' }
    })
    check('en anders gaat hij door tot het lukt',
      uit.gelukt && gedaan.length === 3)
    check('in de volgorde van kansrijk naar minst kansrijk',
      gedaan[1] === 'post/factuur.pdf' && gedaan[2] === 'post/voorwaarden.pdf')
    check('en hij zegt waar het in zat',
      uit.samenvatting.includes('voorwaarden.pdf'), uit.samenvatting)
  }

  /* Niets lukt. Het punt van dit hoofdstuk: dan komt er GEEN lezing terug,
     maar een lijstje van wat er is geprobeerd. Niet gokken. */
  {
    const uit = await leesOpnieuw(bon, gemengd, async () =>
      ({ ok: false, reden: 'Onleesbaar.' }))
    check('lukt niets, dan is er niets gelukt', !uit.gelukt)
    check('en is elke bijlage langsgeweest',
      uit.pogingen.length === 1 + gemengd.length, String(uit.pogingen.length))
    check('met per poging een reden erbij',
      uit.pogingen.every((pg) => !pg.gelukt && !!pg.reden))
    check('en een zin die zegt dat doorklikken geen zin heeft',
      uit.samenvatting.includes('met de hand'), uit.samenvatting)
  }

  /* Een bon zonder mail: een poging, en een eerlijke zin. */
  {
    const uit = await leesOpnieuw(bon, [], async () => ({ ok: false, reden: 'Te wazig.' }))
    check('zonder andere bijlagen blijft het bij een poging',
      uit.pogingen.length === 1)
    check('en zegt hij dat er niets anders te proberen was',
      uit.samenvatting.includes('geen andere bijlagen'), uit.samenvatting)
  }

  /* De bijlage die al aan de bon hangt heeft de server net geprobeerd; die
     nog een keer doen is precies de knop die niets deed. */
  {
    const gedaan: (string | undefined)[] = []
    await leesOpnieuw(
      { id: 'e1', attachmentPath: 'post/factuur.pdf' } as never,
      gemengd,
      async (_id, pad) => { gedaan.push(pad); return { ok: false, reden: 'nee' } },
    )
    check('dezelfde bijlage wordt niet twee keer geprobeerd',
      !gedaan.slice(1).includes('post/factuur.pdf'), gedaan.join(','))
  }

  check('en een geslaagde eerste poging heet gewoon "Gelezen."',
    samenvat([{ wat: 'x', gelukt: true }]) === 'Gelezen.')
}

/* ====================================================================
 *  50. De rondleiding wijst naar knoppen die bestaan
 *
 *  Een aanwijzer zoekt zijn doel met een querySelector op
 *  data-rondleiding="nav-<sleutel>". Vindt hij niets, dan gaat hij zonder
 *  mopperen door naar de volgende (Rondleiding.tsx: als het element er niet
 *  is, roept hij meteen onVolgende aan).
 *
 *  Dat is goed gedrag, en het is precies waarom dit hoofdstuk er moet zijn:
 *  een aanwijzer die nergens heen wijst is niet stuk, hij is er gewoon niet
 *  meer. In de administratierondleiding stond 'nav-tedoen', en die sleutel
 *  heeft nooit bestaan -- de pagina heet 'start'. Die stap werd dus vanaf de
 *  eerste dag overgeslagen, en niemand die het merkte.
 *
 *  Dit werd urgent door het menu met twee niveaus (1.74): wat in een groep
 *  zit is er alleen als die groep openstaat, dus een aanwijzer naar een kind
 *  mist zijn doel zodra iemand de groep dichtklapt.
 * ==================================================================== */

console.log('\n50. De rondleiding wijst naar knoppen die bestaan')

{
  const { readFileSync, readdirSync } = await import('node:fs')
  const { RONDLEIDINGEN } = await import('../src/lib/rondleiding.ts')
  const { DASHBOARDS_MET } = await import('../src/lib/schermen.ts')

  /* De bronnen van alle dashboards bij elkaar: daar staan de groepssleutels
     in, en die zijn geen pagina en staan dus niet in DASHBOARDS_MET. */
  const bronnen = readdirSync('src/dashboards', { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync('src/dashboards/' + d.name)
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => readFileSync('src/dashboards/' + d.name + '/' + f, 'utf8')))
    .join('\n')

  const kapot: string[] = []
  const nietZichtbaar: string[] = []

  for (const [rol, rondleiding] of Object.entries(RONDLEIDINGEN)) {
    for (const a of rondleiding.aanwijzers ?? []) {
      if (!a.doel.startsWith('nav-')) continue
      const sleutel = a.doel.slice(4)

      /*
       * Een groep is geen pagina; die staat alleen in de bron van het
       * dashboard. Wel nakijken dat hij daar echt staat, anders is een
       * hernoemde groep net zo stil weg als een hernoemde pagina.
       */
      if (sleutel.endsWith('-groep')) {
        if (!bronnen.includes("'" + sleutel + "'")) kapot.push(rol + ': ' + a.doel)
        continue
      }

      const dashboards = DASHBOARDS_MET[sleutel]
      if (!dashboards) { kapot.push(rol + ': ' + a.doel); continue }
      /* En hij moet in DIT dashboard staan, niet ergens anders. */
      if (!dashboards.includes(rol as never)) nietZichtbaar.push(rol + ': ' + a.doel)
    }
  }

  check('elke aanwijzer wijst naar een sleutel die bestaat',
    kapot.length === 0, kapot.join(', '))
  check('en naar een die in dat dashboard staat',
    nietZichtbaar.length === 0, nietZichtbaar.join(', '))

  /*
   * En het omgekeerde voor de administratie: de knoppen die in een groep
   * zitten horen geen aanwijzer meer te hebben, want die is er niet zodra de
   * groep dichtstaat. Wijs naar de kop.
   */
  const adm = RONDLEIDINGEN.administratie.aanwijzers ?? []
  const inGroepen = ['nav-kosten', 'nav-uren', 'nav-dossiers', 'nav-aanmeldingen',
    'nav-postbus', 'nav-betalen', 'nav-grootboek']
  const risico = adm.filter((a) => inGroepen.includes(a.doel)).map((a) => a.doel)
  check('de administratie wijst niet naar iets dat kan dichtklappen',
    risico.length === 0, risico.join(', '))
}

/* ====================================================================
 *  51. Mensen beheren: uitnodigen, wachtwoord, en de rij die niet aankwam
 *
 *  Casper: "ik zie nog steeds niks waar ik mensen kan beheren ect".
 *
 *  Het bestond wel, maar op de verkeerde plek en met een tekst ernaast die
 *  het tegensprak. Boven aan het dossier stond een gele balk: "Laat hem zich
 *  aanmelden op het inlogscherm." Dat is precies wat uitnodigen moet
 *  voorkomen -- wie zich zelf aanmeldt doet dat met zijn prive-adres, en dan
 *  staan er twee dossiers van dezelfde man. De knop die het wel goed doet
 *  stond ver eronder, in een andere kaart, voorbij de statistieken en het
 *  rooster.
 *
 *  Dit hoofdstuk legt drie dingen vast die alle drie stil misgingen.
 * ==================================================================== */

console.log('\n51. Mensen beheren')

{
  const { readFileSync } = await import('node:fs')

  /* ---- 1. de aanmaakwizard schreef in een kolom die niet bestaat ---- */

  /*
   * Rekeningnummer en uurtarief staan sinds 0056 in personnel_loon; de
   * kolommen iban en hourly_rate zijn uit personnel_private weggehaald. De
   * wizard stuurde ze toch mee in dezelfde rij, en dan weigert PostgREST de
   * HELE rij -- dus kwamen ook het BSN, de geboortedatum en de
   * documentgegevens nooit op de server aan. Lokaal stond alles er wel, dus
   * het scherm meldde dat het gelukt was.
   */
  const wizard = readFileSync('src/components/NieuweMedewerker.tsx', 'utf8')
  const setup = readFileSync('supabase/setup.sql', 'utf8')

  check('de kolommen iban en hourly_rate zijn echt weg uit personnel_private',
    setup.includes('alter table public.personnel_private drop column if exists iban;')
      && setup.includes('alter table public.personnel_private drop column if exists hourly_rate;'))

  /* De aanroep van save() opzoeken en kijken wat erin zit. */
  const saveBlok = wizard.slice(
    wizard.indexOf('dossierRepo.save(persoon.id, {'),
    wizard.indexOf('documentVerified'))
  check('de wizard stuurt geen iban meer naar het dossier',
    !saveBlok.includes('iban:'), saveBlok.slice(0, 200))
  check('en geen uurtarief',
    !saveBlok.includes('hourlyRate:'))
  check('maar bewaart ze wel, in de loonrij',
    wizard.includes('dossierRepo.saveLoon(persoon.id, loon)'))

  /* ---- 2. uitnodigen staat waar het probleem staat ---- */

  const scherm = readFileSync('src/dashboards/management/Personeel.tsx', 'utf8')
  const balk = scherm.slice(
    scherm.indexOf('Nog geen toegang tot de app'),
    scherm.indexOf('Nog geen toegang tot de app') + 900)

  check('de balk stuurt je niet meer naar het inlogscherm',
    !balk.includes('aanmelden op het inlogscherm'), balk.slice(0, 160))
  check('maar zet de uitnodigknop erbij',
    balk.includes('<UitnodigenKnop'))
  check('en die knop roept echt uitnodigen aan',
    /function UitnodigenKnop[\s\S]{0,900}personeel\.uitnodigen\(person\.id\)/.test(scherm))

  /* ---- 3. wachtwoord opnieuw instellen ---- */

  const beheer = readFileSync('src/components/PersoonBeheer.tsx', 'utf8')
  const repo = readFileSync('src/lib/personeel.ts', 'utf8')
  const server = readFileSync('supabase/functions/medewerker/index.ts', 'utf8')

  check('er is een knop Wachtwoord opnieuw',
    beheer.includes('Wachtwoord opnieuw'))
  /*
   * Achter een bevestiging. Dit maakt het huidige wachtwoord meteen ongeldig;
   * wie hem per ongeluk indrukt heeft iemand buitengesloten tot de mail er is.
   */
  check('en die zit achter een bevestiging',
    /setWachtwoord\(true\)/.test(beheer)
      && /open={wachtwoord}/.test(beheer))
  check('de app roept de actie wachtwoord aan',
    repo.includes("roep({ actie: 'wachtwoord', userId })"))
  check('de server kent die actie',
    server.includes("if (actie === 'wachtwoord') {"))
  check('en zet het wachtwoord met de servicesleutel',
    /updateUserById\(\s*String\(dossier\.auth_id\),\s*{ password:/.test(server))

  /*
   * must_change_password moet weer aan. Zonder dat blijft een wachtwoord dat
   * per mail is verstuurd geldig zolang niemand het wijzigt -- en dan staat de
   * sleutel van een account voor onbepaalde tijd in twee postvakken.
   */
  const actieBlok = server.slice(
    server.indexOf("if (actie === 'wachtwoord') {"),
    server.indexOf('uitschrijven ------------------'))
  check('de vlag must_change_password gaat weer aan',
    actieBlok.includes('must_change_password: true'))

  /*
   * En als de mail niet aankomt is het wachtwoord al gewijzigd en weet
   * niemand het nieuwe. Dat hoort op het scherm te komen, niet in een log.
   */
  check('een mislukte mail wordt gemeld en niet weggeslikt',
    actieBlok.includes('if (!verstuurd)')
      && actieBlok.includes('NIET verstuurd'))

  /* ---- 4. listUsers zonder paginering geeft er vijftig ---- */

  /*
   * Alleen een echte aanroep, niet de tekst. Dit stond eerst als
   * /listUsers\(\)/ en sloeg toen aan op het commentaar dat de valkuil
   * uitlegt -- een test die faalt omdat je hebt opgeschreven waarom hij
   * bestaat.
   */
  check('uitnodigen zoekt bestaande accounts met paginering',
    !/admin\.listUsers\(\)/.test(server), 'er staat nog een kale aanroep')
  check('en pakt er genoeg',
    server.includes('listUsers({ page: 1, perPage: 200 })'))
}

/* ====================================================================
 *  52. De site haalt zijn eigen gegevens op
 *
 *  Casper: "als ik iets aanpas, dan moet je het wel live op de website
 *  aanpassen" en "zorg ervoor dat de website live wordt aangepast als ik een
 *  locatie in de app ect bijmaak, ook vacatures ect".
 *
 *  De site werd gebouwd uit een momentopname die iemand met de hand moest
 *  verversen. Die stond zes dagen stil en had de vacatures helemaal niet, want
 *  die kwamen pas met migratie 0068. Er stond "Er werken 5 mensen" terwijl het
 *  er tien waren.
 *
 *  site/assets/live.js haalt bij het openen van elke pagina de actuele
 *  gegevens op. Dat bestand wordt in het websiteproject gemaakt -- dat is geen
 *  git-repo en staat alleen op de laptop van Casper -- maar het EINDRESULTAAT
 *  staat hier in site/ en is dus wel te toetsen. Dat is ook wat er live gaat.
 *
 *  Hier draait het echt: met een nagebootste DOM en een nagebootste fetch,
 *  tegen opmaak die uit de gebouwde pagina's komt.
 * ==================================================================== */

console.log('\n52. De site haalt zijn eigen gegevens op')

{
  const { readFileSync } = await import('node:fs')
  const script = readFileSync('site/assets/live.js', 'utf8')

  check('live.js weet waar hij het moet halen',
    /window\.LIVE_BRON="https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/website-gegevens"/
      .test(script), script.slice(0, 90))

  check('en elke pagina laadt hem',
    readFileSync('site/locaties/index.html', 'utf8')
      .includes('<script src="/assets/live.js" defer></script>'))

  /* ---- een nagebootste pagina, en dan het script erop ---- */

  /*
   * Geen jsdom in dit project, dus precies zoveel DOM als live.js aanraakt.
   * Dat is minder mooi dan een echte browser en meer waard dan niets: het
   * toetst de vorm van het antwoord, de volgorde en het opnieuw opbouwen van
   * de lijsten -- juist de dingen die stilletjes fout gaan.
   */
  const maakElement = (klasse: string, tag = 'div') => {
    const el: Record<string, unknown> = {
      tagName: tag.toUpperCase(),
      className: klasse,
      textContent: '',
      cells: [] as unknown[],
      kinderen: [] as unknown[],
      attrs: {} as Record<string, string>,
      setAttribute(k: string, v: string) { (el.attrs as Record<string, string>)[k] = v },
      insertAdjacentHTML(_waar: string, html: string) { el.html = String(el.html ?? '') + html },
      querySelectorAll() { return [] },
    }
    return el
  }

  /* De houder van de vestigingenrijen, met een bestaande rij erin. */
  const rijOud = maakElement('locrij', 'a')
  const locHouder = maakElement('raster')
  ;(locHouder as Record<string, unknown>).querySelectorAll = (sel: string) =>
    (sel === 'a.locrij' ? [rijOud] : [])
  ;(rijOud as Record<string, unknown>).parentNode = locHouder

  const vacOud = maakElement('vacrij')
  const vacHouder = maakElement('raster')
  ;(vacHouder as Record<string, unknown>).querySelectorAll = (sel: string) =>
    (sel === '.vacrij' ? [vacOud] : [])
  ;(vacOud as Record<string, unknown>).parentNode = vacHouder

  const telVest = maakElement('', 'span')
  const telMede = maakElement('', 'span')
  ;(telVest as Record<string, unknown>).textContent = '2'
  ;(telMede as Record<string, unknown>).textContent = '5'

  const gewist: string[] = []
  const nepDocument = {
    readyState: 'complete',
    addEventListener() {},
    querySelector(sel: string) {
      if (sel === 'a.locrij') return rijOud
      if (sel === '.vacrij') return vacOud
      if (sel === 'table.uren') return null
      return null
    },
    querySelectorAll(sel: string) {
      if (sel === '[data-live="vestigingen"]') return [telVest]
      if (sel === '[data-live="medewerkers"]') return [telMede]
      return []
    },
  }

  /* Verwijderen loopt via el.parentNode.removeChild; die tellen we mee. */
  ;(locHouder as Record<string, unknown>).removeChild = (el: { className: string }) => {
    gewist.push(el.className)
  }
  ;(vacHouder as Record<string, unknown>).removeChild = (el: { className: string }) => {
    gewist.push(el.className)
  }

  const antwoord = {
    ok: true,
    medewerkers: 10,
    vestigingen: [
      {
        slug: 'utrecht', naam: 'Truckwash Utrecht', adres: 'Handelsweg 14',
        postcode: '3542 AB', plaats: 'Utrecht', telefoon: '0301234567',
        lat: 52.1, lon: 5.1,
        openingstijden: { ma: { van: '07:00', tot: '19:00' }, zo: null },
      },
      {
        slug: 'nieuw', naam: 'Truckwash Nieuw', adres: 'Nieuwstraat 1',
        postcode: '1000 AA', plaats: 'Nieuwstad', telefoon: '0201112233',
        lat: 52.3, lon: 4.9, openingstijden: {},
      },
    ],
    vacatures: [
      { slug: 'washeld', titel: 'Washeld', intro: 'Kom bij ons wassen.' },
      { slug: 'chauffeur', titel: 'Chauffeur', intro: 'Rij met ons mee.' },
      { slug: 'derde', titel: 'Derde', intro: 'Nieuw erbij.' },
    ],
  }

  const nepVenster: Record<string, unknown> = {
    LIVE_BRON: 'https://proef.example/functions/v1/website-gegevens',
    /* Zoals data.js hem neerzet: met één oude vestiging erin. */
    SITE_DATA: { locaties: [{ slug: 'oud', plaats: 'Oudstad' }] },
    dispatchEvent() {},
    addEventListener() {},
  }

  let gevraagd = 0
  const nepFetch = async () => {
    gevraagd++
    return { ok: true, json: async () => antwoord }
  }

  const opslag = new Map<string, string>()
  const nepSessie = {
    getItem: (k: string) => opslag.get(k) ?? null,
    setItem: (k: string, v: string) => void opslag.set(k, v),
  }

  /*
   * Het script draait in een eigen functie met zijn globals als parameters.
   * Zo hoeven we niets aan de echte globalThis te hangen -- en dan kan een
   * volgend hoofdstuk er ook geen last van krijgen.
   */
  const draai = new Function(
    'window', 'document', 'fetch', 'sessionStorage', 'CustomEvent', 'location',
    script,
  )

  /*
   * Precies wat app.js op zijn eerste regel doet: `const DATA =
   * window.SITE_DATA`. Die verwijzing pakt hij één keer en houdt hij vast.
   *
   * Deze regel is de hele reden dat live.js de array bijwerkt in plaats van
   * hem te vervangen -- en zonder deze regel toetst dit hoofdstuk dat niet.
   * Nagegaan door live.js te laten vervangen: dan blijft alles hieronder
   * groen behalve deze.
   */
  const zoalsAppJs = nepVenster.SITE_DATA as { locaties: { slug: string }[] }

  draai(
    nepVenster, nepDocument, nepFetch, nepSessie,
    class { constructor() { /* leeg */ } },
    { pathname: '/locaties/' },
  )

  /* live.js is async; even wachten tot de belofte rond is. */
  await new Promise((r) => setTimeout(r, 20))

  check('hij heeft de gegevens opgehaald', gevraagd === 1, String(gevraagd))

  /* ---- de postcodezoeker ---- */

  /*
   * Ter plekke bijwerken, niet vervangen. app.js doet bovenaan
   * `const DATA = window.SITE_DATA` en houdt die verwijzing vast; een nieuw
   * object toewijzen ziet hij nooit meer.
   */
  const zoeker = zoalsAppJs
  check('de vestigingen van de zoeker zijn bijgewerkt',
    zoeker.locaties.length === 2, String(zoeker.locaties.length))
  /* En window.SITE_DATA wijst nog naar hetzelfde object; anders keek app.js
     naar een lijst die niemand meer bijwerkt. */
  check('en app.js kijkt nog naar dezelfde lijst',
    nepVenster.SITE_DATA === zoalsAppJs)
  check('en de oude is echt weg',
    !zoeker.locaties.some((l) => l.slug === 'oud'))
  check('de nieuwe vestiging staat erin',
    zoeker.locaties.some((l) => l.slug === 'nieuw'))

  /* De openingstijden komen in de vorm die app.js verwacht. */
  const utrecht = zoeker.locaties.find((l) => l.slug === 'utrecht') as
    { uren: { dag: string; tijd: string }[] }
  check('met openingstijden per dag',
    utrecht.uren.length === 7, String(utrecht.uren.length))
  check('maandag uit de database',
    utrecht.uren[0].dag === 'Maandag' && utrecht.uren[0].tijd === '07:00 - 19:00',
    JSON.stringify(utrecht.uren[0]))
  /* Een dag zonder tijden is geen ontbrekende dag maar een gesloten dag. */
  check('en zondag dicht in plaats van weg',
    utrecht.uren[6].dag === 'Zondag' && utrecht.uren[6].tijd === 'Gesloten')

  /* ---- de lijsten ---- */

  check('de oude vestigingsrij is opgeruimd', gewist.includes('locrij'))
  check('en er staan twee nieuwe',
    ((locHouder.html as string) ?? '').split('class="locrij"').length - 1 === 2,
    String(locHouder.html ?? '').slice(0, 120))
  check('de nieuwe vestiging krijgt een eigen link',
    ((locHouder.html as string) ?? '').includes('href="/locaties/nieuw/"'))
  check('met een doorlopend nummer',
    ((locHouder.html as string) ?? '').includes('>01<')
      && ((locHouder.html as string) ?? '').includes('>02<'))

  check('de oude vacature is opgeruimd', gewist.includes('vacrij'))
  check('en er staan drie nieuwe',
    ((vacHouder.html as string) ?? '').split('class="vacrij"').length - 1 === 3)
  check('de derde vacature staat erbij',
    ((vacHouder.html as string) ?? '').includes('href="/werken-bij/derde/"'))

  /* ---- de tellingen ---- */

  check('het aantal vestigingen is bijgewerkt', telVest.textContent === '2',
    String(telVest.textContent))
  check('en het aantal medewerkers ook', telMede.textContent === '10',
    String(telMede.textContent))

  /* ---- en wat er gebeurt als het misgaat ---- */

  /*
   * Dit is de belangrijkste check van het hoofdstuk. Gaat het ophalen mis,
   * dan moet de gebouwde pagina staan blijven -- niet half leeg raken. Een
   * site die bij een storing zijn vestigingen kwijtraakt is erger dan een
   * site met de stand van gisteren.
   */
  const stukVenster: Record<string, unknown> = {
    LIVE_BRON: 'https://proef.example/functions/v1/website-gegevens',
    SITE_DATA: { locaties: [{ slug: 'oud', plaats: 'Oudstad' }] },
    dispatchEvent() {}, addEventListener() {},
  }
  const stukHouder = maakElement('raster')
  const stukRij = maakElement('locrij', 'a')
  ;(stukRij as Record<string, unknown>).parentNode = stukHouder
  ;(stukHouder as Record<string, unknown>).removeChild = () => {
    throw new Error('er had niets opgeruimd mogen worden')
  }

  const stukDocument = {
    readyState: 'complete',
    addEventListener() {},
    querySelector: (sel: string) => (sel === 'a.locrij' ? stukRij : null),
    querySelectorAll: () => [],
  }

  new Function('window', 'document', 'fetch', 'sessionStorage', 'CustomEvent', 'location', script)(
    stukVenster, stukDocument,
    async () => { throw new Error('geen verbinding') },
    { getItem: () => null, setItem: () => {} },
    class { constructor() { /* leeg */ } },
    { pathname: '/locaties/' },
  )
  await new Promise((r) => setTimeout(r, 20))

  check('bij een storing blijft de gebouwde pagina staan',
    (stukVenster.SITE_DATA as { locaties: unknown[] }).locaties.length === 1
      && stukHouder.html === undefined)
}

/* ====================================================================
 *  53. Klanten beheren
 *
 *  Casper: "Daarnaast moet je alle klanten, gebruikers ect kunnen beheren bij
 *  managment, kunnen aanmaken."
 *
 *  Hij kon het niet vinden omdat het er niet was. Drie dingen heten "Klant":
 *  public.companies (het factuuradres), Werkgever (het transportbedrijf) en de
 *  rol customer (het inlogaccount). Het menu-item "Klanten" opende het
 *  werkgeversscherm; voor companies bestond geen scherm en ook geen repo -- er
 *  stond in de hele app geen enkele schrijfactie op db.companies.
 *
 *  De synchronisatie was er wel al, op alle zes de plekken. Er ontbrak dus een
 *  scherm, geen leidingwerk.
 * ==================================================================== */

console.log('\n53. Klanten beheren')

{
  const { klanten, pastBijZoek } = await import('../src/lib/klanten.ts')
  const { db } = await import('../src/lib/db')

  /* ---- aanmaken ---- */

  const gemaakt = await klanten.maak({
    name: '  Transport De Wit  ',
    contact: 'J. de Wit',
    email: 'facturen@dewit.nl',
    city: 'Venlo',
  })

  check('een klant aanmaken levert een id op',
    typeof gemaakt.id === 'string' && gemaakt.id.startsWith('co'), gemaakt.id)
  check('en de naam wordt opgeschoond', gemaakt.name === 'Transport De Wit', gemaakt.name)
  /* Zonder korting is nul, niet undefined -- die waarde gaat op een factuur. */
  check('zonder opgave is de korting nul', gemaakt.contractDiscountPct === 0)

  const uitDb = await db.companies.get(gemaakt.id)
  check('hij staat meteen in de plaatselijke opslag', uitDb?.name === 'Transport De Wit')

  /*
   * En in de wachtrij, want anders staat hij alleen op dit apparaat. Dat is
   * het hele punt van de offline-eerst opzet: schrijven gaat plaatselijk en de
   * wachtrij brengt het naar de server.
   */
  const inWachtrij = await db.outbox
    .filter((r) => r.entity === 'companies' && r.recordId === gemaakt.id)
    .toArray()
  check('en in de wachtrij naar de server', inWachtrij.length >= 1,
    String(inWachtrij.length))
  check('als een put', inWachtrij.some((r) => r.op === 'put'))

  /* ---- wijzigen ---- */

  const gewijzigd = await klanten.wijzig(gemaakt.id, { city: 'Venlo-Zuid', contractDiscountPct: 12 })
  check('wijzigen werkt', gewijzigd?.city === 'Venlo-Zuid' && gewijzigd?.contractDiscountPct === 12)
  check('en laat de rest staan', gewijzigd?.contact === 'J. de Wit')
  check('een onbekende klant wijzigen doet niets',
    (await klanten.wijzig('co_bestaatniet', { city: 'X' })) === null)

  /* ---- verwijderen ---- */

  await klanten.verwijder(gemaakt.id)
  check('verwijderen haalt hem plaatselijk weg',
    (await db.companies.get(gemaakt.id)) === undefined)

  /*
   * En de wachtrij moet het weten. Zonder deze regel is de klant alleen op dit
   * apparaat weg en staat hij op de server en op elke andere telefoon nog.
   */
  const wisRegel = await db.outbox
    .filter((r) => r.entity === 'companies' && r.recordId === gemaakt.id && r.op === 'delete')
    .toArray()
  check('en zet een verwijdering in de wachtrij', wisRegel.length === 1,
    String(wisRegel.length))

  /* ---- zoeken ---- */

  const klant = {
    id: 'co_x', name: 'Chemtrans B.V.', contact: 'W. Bakker',
    email: 'w@chemtrans.nl', phone: '0201234567', city: 'Amsterdam',
    contractDiscountPct: 0, updatedAt: 0,
  }
  check('zoeken op naam', pastBijZoek(klant, 'chemtrans'))
  check('op plaats', pastBijZoek(klant, 'amsterdam'))
  check('op contactpersoon', pastBijZoek(klant, 'bakker'))
  check('op een stuk van het mailadres', pastBijZoek(klant, 'chemtrans.nl'))
  check('een lege zoekopdracht laat alles zien', pastBijZoek(klant, '   '))
  check('en iets dat er niet in staat vindt niets', !pastBijZoek(klant, 'zzzz'))

  /* ---- het scherm hangt in het menu ---- */

  const { readFileSync } = await import('node:fs')
  const dash = readFileSync('src/dashboards/management/ManagementDashboard.tsx', 'utf8')

  check('het scherm staat in het managementmenu',
    /key: 'klanten', label: 'Facturatieklanten'/.test(dash))
  check('en wordt ook echt gerenderd',
    dash.includes("{page === 'klanten' && <Klanten"))

  /*
   * Dit was een stille fout: 'klanten' werd omgeleid naar 'personeel'. Wie in
   * de zoekbalk een klant aanklikte, kreeg de personeelslijst te zien met een
   * company-id dat nooit een dossier-id kan zijn -- en dan gebeurde er niets,
   * zonder melding.
   */
  check('en wordt niet meer naar personeel omgeleid',
    !/p === 'klanten' \? 'personeel'/.test(dash))

  const { DASHBOARDS_MET } = await import('../src/lib/schermen.ts')
  check('de sleutel hoort bij het management',
    (DASHBOARDS_MET.klanten ?? []).includes('management'))
}

/* ====================================================================
 *  54. De sfeerbeelden op het inlogscherm
 *
 *  Casper stuurde een mp4 en vroeg of die als animatie bij het inloggen kon.
 *
 *  Het bestand zoals hij binnenkwam kon niet zomaar mee, om drie redenen die
 *  je geen van drieen ziet aankomen:
 *
 *    1. Er zit een stereo audiospoor in. Electron staat standaard op
 *       no-user-gesture-required en Capacitor zet
 *       setMediaPlaybackRequiresUserGesture(false) -- dus zonder muted klinkt
 *       er op achttien vestigingen 25 seconden geluid zodra iemand het
 *       inlogscherm opent.
 *    2. Er zat 52 kB udta-metadata in met de complete ComfyUI-workflow en de
 *       prompts. Dat zou onveranderd op /app/ worden uitgeserveerd.
 *    3. 4,14 MB op een app van 5,26 MB. Dat is +79% voor de webapp en +67%
 *       voor de APK, en gzip haalt er anderhalve procent af.
 *
 *  Dit hoofdstuk toetst het BESTAND dat we uitleveren en niet het origineel,
 *  plus de vier dingen in de code die het gedrag bepalen.
 * ==================================================================== */

console.log('\n54. De sfeerbeelden op het inlogscherm')

{
  const { readFileSync, existsSync } = await import('node:fs')

  const pad = 'src/assets/inlog.mp4'
  check('de video staat in src/ en niet in public/', existsSync(pad))
  /*
   * Uit src/ omdat Vite er dan een hash aan hangt en hem in dist/app/assets/
   * zet -- de enige map met een cache-kopregel (uitrol/_headers). Uit public/
   * zou hij daarbuiten vallen en haalt elke tablet hem bij elk bezoek opnieuw
   * op, zonder dat iets een fout meldt.
   */
  check('en niet ook in public/', !existsSync('public/inlog.mp4'))

  const bytes = readFileSync(pad)
  const kb = Math.round(bytes.length / 1024)

  check('en is kleiner dan een megabyte', kb < 1100, kb + ' kB')

  /* ---- geen geluid ---- */

  /*
   * Netjes nakijken en niet op de tekst "mp4a" zoeken: die vier letters
   * kunnen in 900 kB beeldgegevens toevallig voorkomen. Elk spoor heeft een
   * hdlr-blok, en op vier bytes na de bloknaam staat waar het spoor over
   * gaat: vide, soun, of iets anders.
   */
  const soorten: string[] = []
  for (let n = 0; n + 12 <= bytes.length; n++) {
    if (bytes.toString('latin1', n, n + 4) !== 'hdlr') continue
    soorten.push(bytes.toString('latin1', n + 12, n + 16))
  }
  check('het bestand heeft een beeldspoor', soorten.includes('vide'),
    soorten.join(', '))
  check('en geen geluidsspoor', !soorten.includes('soun'), soorten.join(', '))

  /* ---- geen prompts erin ---- */

  const alsTekst = bytes.toString('latin1')
  check('de ComfyUI-workflow zit er niet meer in',
    !alsTekst.includes('last_node_id') && !alsTekst.includes('SaveVideo'))

  /* ---- en wat de code ermee doet ---- */

  const login = readFileSync('src/components/Login.tsx', 'utf8')
  const css = readFileSync('src/styles/auth.css', 'utf8')

  /*
   * muted is hier geen nettigheid maar het verschil tussen stil en 25
   * seconden geluid in achttien wasstraten.
   */
  check('de video staat op muted', /<video[\s\S]{0,400}?muted/.test(login))
  /* Zonder playsInline zet iOS hem schermvullend zodra hij begint. */
  check('en op playsInline', /<video[\s\S]{0,400}?playsInline/.test(login))
  check('en in een lus', /<video[\s\S]{0,400}?loop/.test(login))

  /*
   * De knop "rustige beweging" dekte video niet: de CSS-vangnet raakt alleen
   * animation en transition, en MotionConfig alleen framer-motion. useBeweegt()
   * bestond al en werd nergens gebruikt.
   */
  check('wie rust wil, krijgt geen video',
    login.includes('const beweegt = useBeweegt()')
      && /{beweegt &&[\s\S]{0,120}<video/.test(login))

  /*
   * .auth-screen wordt door vijf schermen gebruikt. Wie net is uitgenodigd en
   * verplicht een wachtwoord moet kiezen, hoort geen filmpje te krijgen.
   */
  check('alleen op het inlogscherm',
    login.includes('className="auth-screen inlogscherm"'))
  const anderen = ['Aanmelden', 'ForgotPassword', 'WachtwoordWijzigen']
    .filter((n) => existsSync('src/components/' + n + '.tsx'))
    .filter((n) => readFileSync('src/components/' + n + '.tsx', 'utf8')
      .includes('inlogscherm'))
  check('en niet op de andere authenticatieschermen',
    anderen.length === 0, anderen.join(', '))

  /*
   * .auth-screen had geen position. Een absoluut geplaatst kind zoekt dan het
   * eerste ouderelement dat er wel een heeft, en dan hangt de video ergens
   * anders in de pagina dan waar hij hoort.
   */
  check('de houder heeft een eigen positie',
    /\.inlogscherm {[^}]*position: relative/.test(css), 'geen position op .inlogscherm')
  check('en de kaart staat erboven',
    /\.auth-card {[\s\S]{0,400}?z-index: 1/.test(css))
}

/* ====================================================================
 *  55. De tweede handtekening moet gezet kunnen worden
 *
 *  Casper: "een tweede persoon zou de dingen moeten goedkeuren (dus altijd
 *  iemand die het ziet nadat AI het ziet) maar een tweede persoon heeft geen
 *  knop?"
 *
 *  Hij had gelijk, en het was erger dan een ontbrekende knop: er was geen
 *  enkele weg. De knoppen in de rij stonden achter `status === 'open'`, dus
 *  een bon op "wacht op tweede" kreeg alleen Heropenen. Het detailvenster
 *  heeft helemaal geen goedkeurknop. En de selectievakjes stonden alleen op
 *  het tabblad 'open', dus ook niet met een stapel tegelijk.
 *
 *  De onderkant deugde wel: repo.decide zet netjes de eerste of de tweede en
 *  weigert dezelfde persoon twee keer. Dat wordt hier eerst nagespeeld, zodat
 *  vaststaat dat de knop op iets aansluit dat werkt.
 * ==================================================================== */

console.log('\n55. De tweede handtekening')

{
  const { expenses: expRepo } = await import('../src/lib/repo')

  const A = { id: 'u_anna', name: 'Anna' }
  const Bee = { id: 'u_bram', name: 'Bram' }

  const maak = async (id: string) => {
    await db.expenses.put({
      id, locationId: 'loc_a', date: Date.now(), category: 'materiaal',
      supplier: 'Chemtrans', description: 'proef', amountExcl: 250, vatPct: 21,
      status: 'open', submittedBy: 'u_wim', submittedByName: 'Wim',
      updatedAt: Date.now(),
    } as never)
  }
  const standVan = async (id: string) => (await db.expenses.get(id))?.status

  /* ---- de keten zelf ---- */

  await maak('exp_55a')
  await expRepo.decide('exp_55a', 'goedgekeurd', A)
  check('de eerste handtekening zet hem op wacht-op-tweede',
    (await standVan('exp_55a')) === 'eerste_akkoord',
    String(await standVan('exp_55a')))

  const eerste = await db.expenses.get('exp_55a')
  check('en legt vast wie het was', eerste?.eersteDoor === 'u_anna')

  /*
   * Dezelfde persoon nog een keer: dat is het hele punt van vier ogen. Een
   * nette melding hier is prettiger dan een databasefout die pas bij het
   * synchroniseren opvalt.
   */
  let nogEens = 'gelukt'
  try {
    await expRepo.decide('exp_55a', 'goedgekeurd', A)
  } catch (e) {
    nogEens = e instanceof Error ? e.message : 'fout'
  }
  check('dezelfde persoon mag niet twee keer', nogEens !== 'gelukt', nogEens)
  check('en de melding zegt waarom',
    nogEens.includes('iemand anders'), nogEens)
  check('de stand blijft staan', (await standVan('exp_55a')) === 'eerste_akkoord')

  await expRepo.decide('exp_55a', 'goedgekeurd', Bee)
  check('iemand anders tekent hem wel af',
    (await standVan('exp_55a')) === 'goedgekeurd')
  const klaar = await db.expenses.get('exp_55a')
  check('en beide namen staan erbij',
    klaar?.eersteDoorNaam === 'Anna' && klaar?.approvedByName === 'Bram',
    `${klaar?.eersteDoorNaam} / ${klaar?.approvedByName}`)

  /* ---- en dan de knop die daarop aansluit ---- */

  const { readFileSync } = await import('node:fs')
  const scherm = readFileSync('src/dashboards/administratie/Kostenposten.tsx', 'utf8')

  /*
   * Dit was de fout: `e.status === 'open' ? (...knoppen...) : (...heropenen)`.
   * Een bon die op de tweede handtekening wachtte viel in de else-tak.
   */
  check('de knoppenrij geldt ook voor wacht-op-tweede',
    scherm.includes("{(e.status === 'open' || e.status === 'eerste_akkoord') ? ("),
    'de knoppen staan nog achter alleen open')

  /*
   * Uitgeschakeld en niet verborgen als je zelf de eerste was. Verbergen zou
   * betekenen dat het lijkt alsof er niets te doen valt, terwijl er op een
   * collega wordt gewacht.
   */
  check('en is uit als je zelf de eerste was',
    /disabled={e\.status === 'eerste_akkoord' && e\.eersteDoor === user\.id}/.test(scherm))
  check('met de reden in de tooltip',
    scherm.includes('de tweede handtekening moet van iemand anders komen'))

  /* De selectievakjes stonden ook alleen op het tabblad open. */
  check('en je kunt er een stapel tegelijk kiezen',
    scherm.includes("const teKiezenTab = tab === 'open' || tab === 'eerste_akkoord'")
      && !/{tab === 'open' && \(\s*<th/.test(scherm))

  /*
   * En de tellers. Die stonden op alleen 'open', dus ze zeiden "0 te
   * valideren" terwijl er een stapel op een tweede handtekening lag --
   * precies de stilte waardoor niemand doorhad dat de knop ontbrak.
   */
  check('de teller telt beide standen mee',
    /const teValideren = alle\.filter\(\(e\) => e\.status === 'open' \|\| e\.status === 'eerste_akkoord'\)/
      .test(scherm))

  const dash = readFileSync('src/dashboards/administratie/AdministratieDashboard.tsx', 'utf8')
  check('en de badge in het menu ook',
    /kosten: bonnen\.filter\(\(e\) => e\.status === 'open' \|\| e\.status === 'eerste_akkoord'\)/
      .test(dash))

  /* ---- altijd iemand ná de AI ---- */

  /*
   * Casper: "dus altijd iemand die het ziet nadat AI het ziet". Dat werkt via
   * de automatische goedkeuring: die zet hem met vier ogen aan op
   * eerste_akkoord en laat de tweede aan een mens. Zou hij daar meteen
   * 'goedgekeurd' zetten, dan gaat er geld weg zonder dat er iemand keek.
   */
  const verwerking = readFileSync('supabase/functions/_gedeeld/verwerking.ts', 'utf8')
  check('automatisch goedkeuren laat de tweede aan een mens',
    /status: await vierOgenAan\(admin, bedrag\) \? 'eerste_akkoord' : 'goedgekeurd'/
      .test(verwerking))

  await db.expenses.delete('exp_55a')
}

console.log(`\n${passed} geslaagd, ${failed} mislukt\n`)
process.exit(failed === 0 ? 0 : 1)
