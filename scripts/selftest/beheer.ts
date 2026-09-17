/**
 * Beheer: de site, de wekkers, de versies en wat er verder los staat
 *
 * Onderdeel van de zelftest; zie scripts/selftest.ts voor hoe dit draait en
 * waarom het is opgesplitst.
 */

import { api, check, db, eq, zonderCommentaar } from './kern.ts'

export async function groepen() {
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
  } = await import('../../src/lib/trucksupply')
  const { ROLE_DEFAULTS } = await import('../../src/lib/permissions')
  const { DASHBOARDS_MET } = await import('../../src/lib/schermen')
  const { BESTELLING_STATUS, ROLE_LABELS, ROLE_ORDER } = await import('../../src/lib/types')
  type VoorraadAlarm = import('../../src/lib/types').VoorraadAlarm
  type InventoryItem = import('../../src/lib/types').InventoryItem
  type Bestelling = import('../../src/lib/types').Bestelling
  type Bestelregel = import('../../src/lib/types').Bestelregel
  type Location = import('../../src/lib/types').Location

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
  const { nogNietIngevuld, voorstellen } = await import('../../src/lib/facturen')

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
  const { heeftTijd, datumMisschienTijd } = await import('../../src/lib/format')

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
  const { isVanMij, magBijLocatie, isTeLaat, opDringendheid } = await import('../../src/lib/werk.ts')
  const { leeftijd, slugVan, magVacature } = await import('../../src/lib/werving.ts')

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
  const { leesOpnieuw, opVolgorde, samenvat } = await import('../../src/lib/leesladder.ts')

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
 *  56. Wachtwoord vergeten -- via Resend, en zonder localhost
 *
 *  Casper: "je moet alle emails via resend doen, het vergeten wachtwoord knop
 *  zit nu aan supabase, en stuurt je naar een localhost, wat niet kan?"
 *
 *  Er zaten drie fouten onder elkaar, en de bovenste verborg de andere twee.
 *
 *    1. supabase.auth.resetPasswordForEmail() stuurt post via Supabase en niet
 *       via Resend. Er kwam dus geen regel in email_log, en "heeft hij iets
 *       gehad?" was onbeantwoordbaar.
 *    2. Er ging geen redirectTo mee, dus Supabase pakt de Site URL van het
 *       project. Die staat op localhost.
 *    3. En met een goed adres was het nog dood geweest: de client staat op
 *       detectSessionInUrl: false en nergens in src/ luistert iets op
 *       PASSWORD_RECOVERY. Die link kon in geen enkele bouw een sessie maken.
 *
 *  Het scherm zei ondertussen "E-mail verzonden. Controleer uw inbox."
 *
 *  Er komt nu een code per Resend-mail. Dit hoofdstuk kijkt of de oude weg
 *  echt weg is, of de nieuwe compleet is, en of er in de nieuwe geen gat zit
 *  dat een lege huls van deze test zou maken.
 * ==================================================================== */

console.log('\n56. Wachtwoord vergeten')

{
  const { readFileSync } = await import('node:fs')

  const client = readFileSync('src/lib/api/supabaseApi.ts', 'utf8')
  const server = readFileSync('supabase/functions/wachtwoord-vergeten/index.ts', 'utf8')
  const post = readFileSync('supabase/functions/_gedeeld/post.ts', 'utf8')
  const scherm = readFileSync('src/components/ForgotPassword.tsx', 'utf8')
  const pakket = readFileSync('package.json', 'utf8')

  /* ---- de oude weg is dicht ---- */

  /*
   * Niet zoeken op de tekst in een commentaarblok: die staat er met opzet nog,
   * om uit te leggen waarom hij weg is. Dus op de aanroep.
   */
  check('resetPasswordForEmail wordt nergens meer aangeroepen',
    !/await supabase\(\)\.auth\.resetPasswordForEmail/.test(client))

  /* ---- de nieuwe weg is er helemaal ---- */

  check('de app vraagt de code bij onze eigen functie',
    /invoke\('wachtwoord-vergeten'/.test(client))
  check('met de actie aanvragen', client.includes("actie: 'aanvragen'"))
  check('en met de actie instellen', client.includes("actie: 'instellen'"))

  /*
   * Zonder --no-verify-jwt weigert Supabase elk verzoek zonder geldige sessie
   * -- en dat is precies iedereen die deze functie nodig heeft. Dan is de knop
   * opnieuw dood, en opnieuw zonder dat iets het meldt.
   */
  /*
   * Als JSON lezen en niet als tekst. Het patroon hierboven liep vast op het
   * aanhalingsteken tussen de sleutel en de waarde -- en zo'n test is dan
   * verleidelijk om losser te maken tot hij groen wordt.
   */
  const open = String(JSON.parse(pakket).scripts?.['functions:open'] ?? '')
  check('de functie wordt open uitgerold',
    open.includes(' wachtwoord-vergeten ') && open.includes('--no-verify-jwt'), open)

  /* ---- de post gaat via Resend en laat een spoor na ---- */

  check('de mail gaat via Resend',
    post.includes('https://api.resend.com/emails'))
  check('en legt elke verzending vast, gelukt of niet',
    /\.from\('email_log'\)\.insert/.test(post)
      && post.includes("status: ok ? 'verstuurd' : 'mislukt'"))
  check('de functie gebruikt die ene postkamer en niet zijn eigen fetch',
    server.includes("import { verstuurBrief } from '../_gedeeld/post.ts'")
      && !server.includes('api.resend.com'))

  /* ---- geen link, dus geen adres dat verkeerd kan staan ---- */

  /*
   * Dit is de kern van Caspers klacht. De code hoort in de tekst van de mail
   * te staan en niet in een adres: een adres moet ergens vandaan komen, en dat
   * "ergens" stond op localhost.
   */
  check('de code gaat als tekst mee en niet in een link',
    server.includes("gegevens: [['Herstelcode', code]]"))
  /*
   * Alleen in de code kijken. Het woord "localhost" staat bovenin, in de
   * uitleg waarom het er niet meer is -- dat is de reden en niet de fout.
   */
  const codeVanServer = server
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((r) => !r.trim().startsWith('*') && !r.trim().startsWith('//'))
    .join('\n')
  check('en er staat nergens een redirect of een localhost in',
    !/redirectTo|localhost/.test(codeVanServer))

  /* ---- wat er niet gelekt mag worden ---- */

  /*
   * Eén antwoord voor elk adres. Zou het verschil maken of er een account
   * bestaat, dan is dit formulier een manier om uit te vinden wie hier werkt.
   */
  const altijd = (server.match(/return json\(ALTIJD\)/g) ?? []).length
  check('elk pad van "aanvragen" geeft hetzelfde antwoord', altijd >= 4,
    String(altijd) + ' keer')
  /*
   * En de code komt nergens terug behalve in de mail. Regel voor regel kijken
   * en niet met een patroon over het hele bestand: het woord "code" staat er
   * tientallen keren, in commentaar en in namen, en dan toetst zo'n patroon
   * niets meer.
   */
  const verdacht = server.split('\n')
    .map((r, n) => [n + 1, r.trim()] as [number, string])
    .filter(([, r]) => /console\.(log|warn|error)|return json/.test(r))
    /*
     * Op `code` als waarde, niet op het woord. Een logregel mag "kon de code
     * niet vastleggen" zeggen -- daar staat de code zelf niet in. Wat niet mag
     * is hem invoegen of doorgeven als los argument.
     */
    .filter(([, r]) => /\$\{code\}|[(,]\s*code\s*[,)]/.test(r))
  check('de code staat in geen enkel antwoord en in geen enkele logregel',
    verdacht.length === 0, verdacht.map(([n, r]) => n + ': ' + r).join(' | '))

  /* ---- de code zelf ---- */

  check('de code wordt gehasht bewaard, niet als zichzelf',
    server.includes("crypto.subtle.digest('SHA-256'")
      && /code_hash: await hashVan\(id, code\)/.test(server))
  /*
   * Met de id als zout. Zonder dat past één lijst van alle mogelijke codes op
   * elke rij tegelijk -- en acht tekens is een lijst die te maken valt.
   */
  check('met de id als zout',
    server.includes('`${id}:${code'))
  check('en het alfabet mist de tekens die verkeerd worden overgetypt',
    !/[IL1O0]/.test((server.match(/const ALFABET = '([^']+)'/) ?? [, ''])[1]))

  /* ---- de remmen ---- */

  check('misgokken is beperkt', server.includes('HOOGSTENS_POGINGEN'))
  /*
   * Tellen vóór vergelijken. Andersom telt een mislukte poging niet mee als er
   * halverwege iets misgaat, en dan is de teller geen rem maar een suggestie.
   */
  const telt = server.indexOf("update({ pogingen })")
  const vergelijkt = server.indexOf('gelijkTraag(rij.code_hash')
  check('en wordt geteld vóór de code wordt vergeleken',
    telt > 0 && vergelijkt > telt)
  check('aanvragen is ook begrensd', server.includes('AANVRAGEN_PER_KWARTIER'))
  check('en een code vervalt', server.includes('GELDIG_MS'))

  /*
   * Eén melding voor elke manier waarop het misgaat. Zou "verlopen" anders
   * klinken dan "verkeerd", dan verklapt dat of het adres bestaat en of er
   * onlangs om is gevraagd.
   */
  check('elke afwijzing klinkt hetzelfde',
    (server.match(/reden: AFGEWEZEN/g) ?? []).length >= 4)

  /* ---- en het scherm ---- */

  check('het scherm heeft een tweede stap voor de code',
    scherm.includes("type Stap = 'adres' | 'code' | 'klaar'"))
  /*
   * Dit stond er: "E-mail verzonden. Controleer uw inbox." -- gezegd zonder
   * dat er iets was verstuurd, en zonder dat het kón aankomen.
   */
  check('en belooft niet meer dat er post is verzonden',
    !/E.mail verzonden/.test(scherm))
  check('maar zegt wat er waar is: als er een account staat',
    scherm.includes('Staat er een account op'))
  check('en dat het oude wachtwoord blijft werken',
    scherm.includes('blijft'))

  /* ---- dezelfde eis aan het wachtwoord, aan beide kanten ---- */

  const signups = readFileSync('src/lib/signups.ts', 'utf8')
  for (const regel of ['Gebruik minstens tien tekens.', 'Gebruik letters én cijfers.']) {
    check(`de server stelt dezelfde eis: "${regel}"`,
      server.includes(regel) && signups.includes(regel))
  }
  check('en het scherm kijkt met dezelfde functie mee',
    scherm.includes('passwordProblem'))

  /* ---- zonder database ---- */

  const { mockApi } = await import('../../src/lib/api/mockApi')
  const uit = await mockApi.resetPassword('a@b.nl', 'ABCD2345', 'watgeheims12')
  check('zonder database zegt de nepbak netjes nee', uit.ok === false)
  check('met een reden erbij', typeof uit.reden === 'string' && uit.reden.length > 10)
}

/* ====================================================================
 *  57. De website haalt zijn vestigingen uit de database
 *
 *  Casper: "als ik een vestiging maak via de app, dat je die direct live hebt
 *  op de website, kan je de website niet die locaties uit de database laten
 *  halen?"
 *
 *  Half deed hij dat al. live.js haalt bij elk bezoek de lijsten en de
 *  tellingen op. Maar elke vestiging heeft ook een EIGEN pagina, en die
 *  bestaat als bestand -- gemeten: /locaties/roosendaaltest/ gaf nog 200
 *  nadat die vestiging van de site was gehaald, en een nieuwe zou 404 geven.
 *  Sitemap en voettekst liepen mee achter.
 *
 *  Een pagina die er niet is, kan zichzelf niet invullen. Dus wordt de site
 *  opnieuw gebouwd, en dat kon tot nu toe op één laptop: truckwash-website is
 *  geen git-repo. Nu staat de bouwer in sitebouw/.
 * ==================================================================== */

console.log('\n57. De website haalt zijn vestigingen uit de database')

{
  const { readFileSync, existsSync, statSync } = await import('node:fs')

  /* ---- de bouwer staat in de repo ---- */

  const NODIG = ['webbouw.cjs', 'brok.js', 'site.json', 'omzet.cjs',
                 'live.js', 'releases.json', 'vestigingen.cjs', 'beeld.json']
  const mist = NODIG.filter((n) => !existsSync('sitebouw/' + n))
  check('de bouwer staat in sitebouw/', mist.length === 0, 'mist: ' + mist.join(', '))

  /*
   * En hij is klein gebleven.
   *
   * beeld.json is in het bronproject 3,4 MB: alle foto's als base64. De bouw
   * vervangt de src door /assets/img/<rol>.webp en gebruikt daarna alleen nog
   * w en h -- dus gaat hij afgeslankt mee. Zou iemand ooit het volle bestand
   * kopieren, dan staat er 3,4 MB in de repo die niemand opvraagt.
   */
  const beeldBytes = statSync('sitebouw/beeld.json').size
  check('beeld.json is afgeslankt', beeldBytes < 5000, beeldBytes + ' bytes')

  const beeld = JSON.parse(readFileSync('sitebouw/beeld.json', 'utf8'))
  const rollen = Object.keys(beeld)
  check('maar wel compleet', rollen.length >= 20, rollen.length + ' rollen')
  check('en met de afmetingen die de bouw nodig heeft',
    rollen.every((r) => Number(beeld[r].w) > 0 && Number(beeld[r].h) > 0))
  /* De foto's zelf horen er NIET in te staan; die staan als .webp in de site. */
  check('en zonder de foto\'s erin',
    rollen.every((r) => beeld[r].uri === undefined))

  /* ---- de rem op de stille fout ---- */

  const bouwer = readFileSync('scripts/site-bouwen.cjs', 'utf8')

  /*
   * Dit is de gevaarlijkste regel van het hele stuk.
   *
   * webbouw.cjs faalt met opzet zacht: geen vestigingen.json, dan bouwt hij
   * door met de achttien uit site.json. Op een laptop zonder bereik is dat
   * juist. In GitHub zou het betekenen dat een mislukt ophaalmoment de site
   * stilletjes terugdraait naar een halfjaar oude stand -- met een groene
   * bouw en zonder één melding.
   */
  check('een mislukt ophalen vervangt de site niet',
    bouwer.includes('VERS_GENOEG_MS') && /opgehaald/.test(bouwer))
  check('en nul vestigingen ook niet',
    /aantal === 0/.test(bouwer))
  check('de bouw gaat naar een lege map en niet over site/ heen',
    bouwer.includes('.site-bouw') && /fs\.renameSync\(werk, site\)/.test(bouwer))
  check('en er wordt nagekeken voordat er iets vervangen wordt',
    bouwer.includes("'index.html', '404.html', 'sitemap.xml', 'robots.txt'"))

  /* ---- de wekker ---- */

  const stroom = readFileSync('.github/workflows/site.yml', 'utf8')
  check('de app kan een herbouw starten',
    /types:\s*\[site-herbouwen\]/.test(stroom))
  check('en er is een nachtelijk vangnet', /schedule:/.test(stroom))
  /*
   * Zonder vangnet hangt de hele site aan een token dat een keer verloopt.
   * Dan werkt alles nog, hij wordt alleen niet meer bijgewerkt -- en dat is
   * precies wat niemand ziet.
   */
  check('twee herbouwen tegelijk kunnen niet',
    /concurrency:/.test(stroom) && stroom.includes('cancel-in-progress: false'))
  check('en er wordt alleen vastgelegd als er iets veranderd is',
    stroom.includes('git diff --quiet -- site'))

  /* ---- het seintje uit de app ---- */

  const { merkOp, seintjeKlaar, vergeetSeintje } = await import('../../src/lib/siteherbouw.ts')

  vergeetSeintje()
  merkOp(['expenses', 'timeEntries'])
  check('een kostenpost laat de website met rust', !seintjeKlaar())

  merkOp(['locations'])
  check('een vestiging niet', seintjeKlaar())

  vergeetSeintje()
  merkOp(['vacatures'])
  check('een vacature ook niet', seintjeKlaar())

  vergeetSeintje()
  merkOp(['locationPhotos'])
  check('en een foto van een vestiging evenmin', seintjeKlaar())

  /*
   * instellingen raakt de site niet. Zou het er wel bij staan, dan start elke
   * gewijzigde boekhoudinstelling een herbouw van de website.
   */
  vergeetSeintje()
  merkOp(['instellingen'])
  check('maar een instelling wel', !seintjeKlaar())

  /* ---- en het hangt op de goede plek in de synchronisatie ---- */

  const sync = readFileSync('src/lib/sync.ts', 'utf8')

  /*
   * Dit was mijn eerste ingeving en hij was fout: het seintje bij het
   * OPSLAAN. Deze app schrijft eerst plaatselijk en duwt daarna pas. GitHub
   * zou dan bouwen met een database waar de wijziging nog niet in staat --
   * een herbouw die niets oplevert, en de echte wijziging pas de nacht erna.
   */
  const naDuw = sync.indexOf('await api.push(changes)')
  const onthoudt = sync.indexOf('merkOp(gesorteerd')
  check('er wordt pas onthouden nadat het op de server staat',
    naDuw > 0 && onthoudt > naDuw)
  check('ook als de wachtrij per stuk moest', sync.includes('merkOp([r.entity])'))
  check('en het seintje gaat aan het eind van de ronde',
    sync.includes('void geefSeintjeAlsNodig()'))

  /* ---- de serverfunctie ---- */

  const functie = readFileSync('supabase/functions/site-herbouwen/index.ts', 'utf8')

  check('het token staat op de server en niet in de app',
    functie.includes("Deno.env.get('GITHUB_SITE_TOKEN')")
      && !readFileSync('src/lib/siteherbouw.ts', 'utf8').includes('GITHUB'))
  check('en niet iedereen mag de site laten herbouwen',
    functie.includes('magHerbouwen'))
  check('een reeks bewerkingen levert één herbouw op', functie.includes('RUST_MS'))
  /*
   * Een verlopen token is stil: de site werkt, hij wordt alleen niet meer
   * bijgewerkt. Daarom een melding aan het management, en hoogstens één per
   * dag -- tien meldingen over hetzelfde token is een postvak dat je
   * dichtklikt.
   */
  check('een verlopen token meldt zichzelf',
    functie.includes('meldStoring') && /401, 403, 404/.test(functie))
  /* Als JSON lezen en niet als tekst: een patroon met [^"]* loopt vast op het
     aanhalingsteken tussen de sleutel en de waarde. Dat ging hier al een keer
     mis bij functions:open. */
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {}
  check('en de functie wordt met inlogcontrole uitgerold',
    String(scripts['functions:dicht'] ?? '').includes(' site-herbouwen'),
    String(scripts['functions:dicht'] ?? ''))
  /* Niet in de open lijst: zonder inlogcontrole kan iedereen op internet de
     herbouw aan de gang houden. */
  check('en niet zonder', !String(scripts['functions:open'] ?? '').includes('site-herbouwen'))

  /* Zonder token is er niets stuk -- dan doet de nacht het. Dat hoort geen
     rode melding te geven. */
  check('zonder token is het geen fout maar "vannacht"',
    /gepland: 'vannacht'/.test(functie) && functie.includes('!TOKEN'))
}

/* ==================================================================== *
 *  97. De lange lijn hield zijn eigen belofte niet
 *
 *  Casper stuurde het logboek van de pc:
 *
 *    02:25:11 ai: server niet bereikbaar, de server antwoordde niet binnen 40 s
 *    02:25:58 ai: server weer bereikbaar
 *    02:33:28 ai: server niet bereikbaar, de server antwoordde niet binnen 40 s
 *    02:34:10 ai: server weer bereikbaar
 *
 *  De hele nacht door, en altijd op 'ai-werk' -- bijna nooit op 'werk'. Dat
 *  verschil wijst de weg: 'werk' antwoordt meteen, 'ai-werk' hangt aan een
 *  lange lijn die de server tot vijfentwintig seconden openhoudt.
 *
 *  Twee dingen klopten daar niet.
 *
 *  De server begon zijn klok NA het huishoudelijke werk -- opruimen, hartslag,
 *  stand wegschrijven, drie databasevragen. Bij een koude worker kwam daar zo
 *  tien seconden bij bovenop de vijfentwintig, en de pc brak af op veertig.
 *  De belofte "je hoort binnen vijfentwintig seconden iets van me" was dus
 *  niet waar, en precies daar zat de ruimte tussen.
 *
 *  En de pc riep bij de EERSTE misser meteen "server niet bereikbaar". Aan een
 *  lange lijn over een serverloos platform is een verbroken verbinding gewoon
 *  wat er af en toe gebeurt. Het gevolg was erger dan de storing zelf: een
 *  logboek vol nachtelijke alarmregels waarin de ene ECHTE storing -- acht
 *  minuten stil, allebei de lussen -- er precies hetzelfde uitziet als de ruis.
 * ==================================================================== */

console.log('\n97. De lange lijn hield zijn eigen belofte niet')

{
  const { readFileSync } = await import('node:fs')
  const fn = readFileSync('supabase/functions/lezer/index.ts', 'utf8')
  const pc = readFileSync('lezer/lezer.mjs', 'utf8')

  /* --- 1. de klok telt alles mee --- */

  check('de lange lijn telt zijn klok vanaf het begin van het verzoek',
    /const gestart = Date\.now\(\)\s*\n\s*const tot = gestart \+ LANGE_LIJN_MS/.test(fn),
    'de klok begint pas na het huishoudelijke werk')

  /*
   * En hij kijkt VOORDAT er weer een vraag uitgaat. Andersom betekent elke
   * ronde: de tijd is op, maar we doen er nog een select en een pauze
   * overheen -- en bij een trage database is dat het stuk dat de lijn over
   * zijn eigen belofte heen duwt.
   */
  check('en kijkt op de klok vóór de volgende vraag, niet erna',
    /for \(;;\) \{[\s\S]{0,600}if \(Date\.now\(\) >= tot - LIJN_KIJK_MS\)/.test(fn),
    'de klok wordt pas na de databasevraag gecontroleerd')

  /* --- 2. en de marge is echt een marge --- */

  /*
   * Narekenen in plaats van beschrijven. Deze twee getallen staan in
   * verschillende bestanden en zijn een keer uit elkaar gegroeid; dat hoort
   * een test te vangen en niet een opmerking.
   */
  const lijn = Number(/const LANGE_LIJN_MS = ([0-9_]+)/.exec(fn)?.[1].replace(/_/g, '') ?? 0)
  const wacht = Number(/'ai-werk': ([0-9_]+)/.exec(pc)?.[1].replace(/_/g, '') ?? 0)
  check('de pc wacht ruim langer dan de server de lijn openhoudt',
    lijn > 0 && wacht >= lijn * 2,
    `server ${lijn} ms, pc ${wacht} ms`)

  /* --- 3. één misser is geen storing --- */

  check('een enkele misser is nog geen melding',
    /const MELD_NA = 3/.test(pc) && /missers >= MELD_NA/.test(pc),
    'de eerste mislukte poging heet meteen een storing')

  /*
   * En als hij terugkomt, hoe lang het duurde. Zonder dat getal is een blip
   * van veertig seconden niet te onderscheiden van acht minuten stilte, en
   * dat was precies het probleem met dit logboek.
   */
  check('en bij herstel staat erbij hoe lang het duurde',
    /weer bereikbaar na/.test(pc) && /eersteMisserAt/.test(pc),
    'een blip ziet er hetzelfde uit als een echte storing')
}

/* ==================================================================== *
 *  98. De wekkers gaan naast wat ze wekken
 *
 *  Casper: "Die cronjobs op github lopen steeds vaker fout, kan dat niet via
 *  iets anders?"
 *
 *  Ja: pg_cron, in de database, naast de functies die ze wekken. GitHub zet
 *  geplande workflows bij drukte achteraan en laat ze soms vallen -- en op
 *  het kwartier, waar iedereen plant, het vaakst. En de uitkomst van een
 *  ronde stond alleen in het Actions-tabblad van een website.
 *
 *  Wat er gebeurt als pg_cron er NIET is, staat in sqltest 69 -- daar draait
 *  het echt, op een database zonder die uitbreidingen.
 * ==================================================================== */

console.log('\n98. De wekkers gaan naast wat ze wekken')

{
  const { readFileSync } = await import('node:fs')
  const m101 = readFileSync(
    'supabase/migrations/0101_de_wekkers_gaan_naast_wat_ze_wekken.sql', 'utf8')
  const taken = readFileSync('.github/workflows/taken.yml', 'utf8')
  const voorraad = readFileSync('.github/workflows/voorraad.yml', 'utf8')

  check('de wekkers worden in de database gepland',
    m101.includes('cron.schedule') && m101.includes('net.http_post'),
    'er wordt niets in de database gepland')

  /*
   * Met dezelfde stut als 0042: de testdatabase kent geen uitbreidingen, en
   * zonder vangst kan bijwerken.sql daar niet eens laden.
   */
  check('en het ontbreken van de uitbreidingen laat niets omvallen',
    /create extension if not exists pg_cron;\s*\nexception when others/.test(m101)
      && /create extension if not exists pg_net;\s*\nexception when others/.test(m101),
    'een database zonder pg_cron struikelt over deze migratie')

  /*
   * Het geheim hoort NIET in de cron-regel. Wat daar staat komt in cron.job
   * en dus in elke back-up en elke dump. In de tekst van de taak staat
   * alleen de opzoekvraag.
   */
  check('het geheim staat niet in de geplande taak, alleen de opzoekvraag',
    m101.includes('public.wekker_geheim') && m101.includes('vault.decrypted_secrets'),
    'het wachtwoord belandt in cron.job')

  /* En dat is de winst: de uitkomst van elke ronde is een tabel. */
  check('en wat de wekkers deden is uit te lezen',
    m101.includes('cron.job_run_details') && m101.includes('wekkers_stand'),
    'of een ronde gelukt is staat nergens')

  /* --- en bij GitHub staat de planning niet meer --- */

  check('GitHub plant de wekkers niet meer',
    !/^\s*- cron:/m.test(taken) && !/^\s*- cron:/m.test(voorraad),
    'er staan nog geplande runs in GitHub Actions')

  /*
   * Maar de handknop blijft. Blijkt pg_cron niet te kunnen op dit project,
   * dan is er iets om op terug te vallen -- en anders is het een manier om
   * niet op de klok te hoeven wachten.
   */
  check('maar de handknop blijft staan',
    taken.includes('workflow_dispatch') && voorraad.includes('workflow_dispatch'),
    'er is geen manier meer om een wekker met de hand te starten')

  check('en er staat bij waarom de planning weg is',
    taken.includes('0101') && voorraad.includes('0101'),
    'wie dit later leest ziet niet waarom de planning ontbreekt')

  /*
   * En het bestaan van cron.schedule wordt niet met to_regproc gecontroleerd.
   *
   * Dat stond er, en het gaf precies het verkeerde antwoord: to_regproc geeft
   * null terug als een naam MEERDERE varianten heeft, en cron.schedule
   * bestaat in twee vormen. Op Caspers database, waar pg_cron gewoon aanstond
   * (1.6.4), meldde de functie doodleuk dat hij er niet was -- waarna je gaat
   * zoeken naar een abonnement dat je al hebt.
   *
   * Op een TABEL mag to_regclass wel: die kent geen varianten.
   */
  check('het bestaan van een functie wordt in de catalogus opgezocht',
    /*
     * Positief geformuleerd, en dat is geen slordigheid maar nodig: de
     * uitleg hierboven NOEMT to_regproc('cron.schedule'), want dat was de
     * fout. Een controle die op de afwezigheid van die tekst let, struikelt
     * dus over het commentaar dat vertelt waarom hij bestaat. Dezelfde val
     * als bij groep 89 en 95.
     */
    m101.includes('from pg_proc p') && m101.includes('join pg_namespace n'),
    'to_regproc op een naam met meerdere varianten geeft altijd null')

  /* En de melding zegt welk van de drie gevallen het is. */
  check('en een ontbrekende uitbreiding zegt of hij wél kan',
    m101.includes('pg_available_extensions'),
    '"staat niet aan" is niet te onderscheiden van "kan niet"')

  /* --- en de wekker zegt of hij GEHOORD is --- */

  const m102 = readFileSync(
    'supabase/migrations/0102_een_wekker_die_zegt_of_hij_gehoord_is.sql', 'utf8')

  /*
   * net.http_post is asynchroon: de cron-taak is "geslaagd" zodra het verzoek
   * is weggezet, ook als de functie er een 403 op teruggeeft. Een stand die
   * alleen cron.job_run_details leest staat dus groen terwijl er niets
   * gebeurt -- en dat is erger dan geen stand, want dan zoek je de oorzaak
   * ergens anders.
   */
  check('de stand leest wat de functie terugstuurde, niet alleen of de taak liep',
    m102.includes('net._http_response') && m102.includes('status_code'),
    'een geweigerde wekker ziet er hetzelfde uit als een geslaagde')

  /* Daarvoor moet het verzoeknummer bewaard blijven; dat gooide 0101 weg. */
  check('en het verzoeknummer wordt bewaard zodat antwoord en wekker bij elkaar horen',
    m102.includes('wekker_ronde') && m102.includes('verzoek_id'),
    'er is niet te zien welk antwoord bij welke wekker hoorde')

  /*
   * pg_net bewaart antwoorden maar zes uur. Daarna weten we nog DAT hij
   * liep, en dat hoort er anders uit te zien dan "het ging goed".
   */
  check('en een vervallen antwoord heet niet stilletjes gelukt',
    m102.includes('niet (meer) bewaard'),
    'een antwoord dat pg_net heeft opgeruimd telt als geslaagd')
}

/* ==================================================================== *
 *  101. De server zegt zelf welke versie hij draait
 *
 *  Casper: "fix het allemaal" -- de eerste van zes.
 *
 *  Er was geen enkele manier om te zien of het schema bij was of de functies
 *  waren uitgerold. Bij elke storing begon het met "heb je de sql gedraaid?"
 *  en het antwoord was een herinnering.
 *
 *  Wat hier hard moet zijn:
 *
 *    - het verwachte migratienummer komt uit de map en niet uit een getal
 *      dat iemand met de hand ophoogt (want dat vergeet je)
 *    - elke migratie in de uitdraai schrijft zichzelf in; precies een keer
 *    - elke edge function meldt zijn EIGEN naam, niet die van de buurman
 *    - en de vergelijking zelf klopt: achterlopen is achterlopen
 * ==================================================================== */

console.log('\n101. De server zegt welke versie hij draait')

{
  const { readFileSync, readdirSync } = await import('node:fs')

  const migraties = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
  const hoogste = Math.max(...migraties.map((f) => Number(f.slice(0, 4))))

  /* ---- 1. het verwachte nummer komt uit de map ---- */

  /*
   * Deze twee zet vite normaal klaar. In Node bestaan ze niet, en zonder
   * deze regels valt de module om op een naam die nergens is. Het getal is
   * hetzelfde getal dat vite.config.ts uitrekent -- uit dezelfde map.
   */
  ;(globalThis as any).__APP_VERSION__ = '1.90.0'
  ;(globalThis as any).__SCHEMA_VERWACHT__ = hoogste

  const stand = await import('../../src/lib/serverstand')
  const { SCHEMA_VERWACHT, schemaLooptAchter, functiesStil } = stand

  check('het verwachte schemanummer is het hoogste in de map',
    SCHEMA_VERWACHT === hoogste, `${SCHEMA_VERWACHT} tegenover ${hoogste}`)

  const viteConfig = readFileSync('vite.config.ts', 'utf8')
  check('en vite telt het uit de map in plaats van het te onthouden',
    viteConfig.includes('readdirSync(dir)') && viteConfig.includes('__SCHEMA_VERWACHT__'),
    'een nummer dat met de hand wordt opgehoogd is een nummer dat je vergeet')

  /* ---- 2. achterlopen is achterlopen ---- */

  const maak = (nummer: number) => ({
    schema: { nummer, naam: '', at: null, gezien: nummer, aangenomen: 0 },
    functies: [],
  })

  check('geen verbinding betekent niet "loopt achter"',
    schemaLooptAchter(null) === false)
  check('een schema dat een migratie mist loopt achter',
    schemaLooptAchter(maak(hoogste - 1)) === true)
  check('en een dat bij is niet',
    schemaLooptAchter(maak(hoogste)) === false)
  /*
   * Een server die vooruitloopt is geen storing. Dat gebeurt zodra de sql is
   * gedraaid en de app nog niet is uitgerold, en dat is de goede volgorde.
   */
  check('een server die vooruitloopt is geen waarschuwing',
    schemaLooptAchter(maak(hoogste + 1)) === false)

  /* ---- 3. welke functies oud zijn ---- */

  const metFuncties = {
    schema: maak(hoogste).schema,
    functies: [
      { naam: 'exact', versie: '1.90.0', gebouwd: '', gezienAt: 1 },
      { naam: 'lezer', versie: '1.89.0', gebouwd: '', gezienAt: 1 },
      { naam: 'trucky', versie: '', gebouwd: '', gezienAt: 1 },
    ],
  }
  const oud = functiesStil(metFuncties, '1.90.0')
  check('een functie die zich sinds de uitrol niet meldde valt op',
    oud.length === 1 && oud[0].naam === 'lezer', JSON.stringify(oud.map((f) => f.naam)))
  /*
   * Een functie zonder versie heeft zich gemeld van vóór dit alles, of de
   * stempel ontbrak. "Onbekend" is geen "verouderd": dat zou een waarschuwing
   * geven waar niemand iets mee kan.
   */
  check('en een zonder versie wordt niet meegeteld',
    !oud.some((f) => f.naam === 'trucky'), JSON.stringify(oud.map((f) => f.naam)))

  /* ---- 4. elke migratie schrijft zichzelf in, precies een keer ---- */

  const { standBlok } = await import('../migratie-stand.cjs') as any

  const blok = standBlok("0103_proef.sql", "Een naam met 'aanhalingstekens'")
  check('het blokje roept de juiste migratie aan',
    blok.includes('public.migratie_gedaan(103,'), blok)
  check('en verdubbelt aanhalingstekens in de naam',
    blok.includes("''aanhalingstekens''"), blok)
  /*
   * De functie bestaat pas vanaf 0103. In setup.sql staan er 102 migraties
   * vóór; zonder deze vraag zou het bestand daar stuklopen.
   */
  check('en doet niets zolang migratie_gedaan nog niet bestaat',
    blok.includes("to_regprocedure('public.migratie_gedaan(integer,text)') is not null"), blok)
  /*
   * to_regprocedure en niet to_regproc. Die laatste geeft ook null bij een
   * naam die meer dan een keer bestaat, en dat heeft 0101 laten denken dat
   * pg_cron uit stond terwijl het aanstond.
   */
  check('met to_regprocedure, niet met to_regproc',
    !blok.includes('to_regproc('), blok)

  const setup = readFileSync('supabase/setup.sql', 'utf8')
  const bij = readFileSync('supabase/bijwerken.sql', 'utf8')
  const tel = (t: string) => (t.match(/perform public\.migratie_gedaan\(/g) ?? []).length

  check('setup.sql schrijft elke migratie in, precies een keer',
    tel(setup) === migraties.length, `${tel(setup)} van ${migraties.length}`)
  check('en bijwerken.sql die hij bevat',
    tel(bij) === migraties.filter((f) => Number(f.slice(0, 4)) >= 17).length,
    String(tel(bij)))

  /* ---- 5. elke functie meldt zijn eigen naam ---- */

  const functies = readdirSync('supabase/functions', { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)

  const zonder: string[] = []
  const verkeerd: string[] = []
  for (const naam of functies) {
    const bron = readFileSync(`supabase/functions/${naam}/index.ts`, 'utf8')
    const m = bron.match(/meldStand\('([^']+)'\)/)
    if (!m) zonder.push(naam)
    else if (m[1] !== naam) verkeerd.push(`${naam} meldt zich als ${m[1]}`)
  }
  check('elke edge function meldt zich bij het opstarten',
    zonder.length === 0, zonder.join(', '))
  check('en doet dat onder zijn eigen naam',
    verkeerd.length === 0, verkeerd.join(', '))

  /* ---- 6. de stempel klopt met package.json ---- */

  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const versieTs = readFileSync('supabase/functions/_gedeeld/versie.ts', 'utf8')
  const gestempeld = versieTs.match(/VERSIE = '([^']+)'/)?.[1]
  check('de gestempelde versie is een versie',
    /^\d+\.\d+\.\d+/.test(gestempeld ?? ''), String(gestempeld))
  /*
   * Hij hoeft niet gelijk te zijn aan package.json: het stempel wordt gezet
   * bij het uitrollen, en dat gebeurt na het ophogen. Wat wel moet, is dat
   * het uitrollen hem zet -- anders meldt elke functie voor altijd de versie
   * van de dag dat dit is gebouwd.
   */
  check('en het uitrollen zet hem opnieuw',
    String(pkg.scripts.functions).includes('scripts/functie-versie.cjs'),
    pkg.scripts.functions)

  /* ---- 7. melden mag nooit iets breken ---- */

  const standTs = readFileSync('supabase/functions/_gedeeld/stand.ts', 'utf8')
  check('het melden wacht nergens op',
    !/await admin\.rpc/.test(standTs.replace(/const werk = \(async \(\) => \{[\s\S]*?\}\)\(\)/, '')),
    'een functie die op zijn eigen versiemelding wacht, wacht op niets')
  check('en slikt elke fout',
    standTs.includes('catch (e)') && standTs.includes('console.warn'),
    'een mislukte melding mag geen verzoek laten stranden')
}

/* ==================================================================== *
 *  102. Ophalen tot er niets meer is, in plaats van tot tweeduizend
 *
 *  Het rekeningschema van Exact staat sinds 0104 in de app: twintig bv's met
 *  elk een paar honderd rekeningen. Daarmee ging de synchronisatie voor het
 *  eerst over een grens heen die er altijd al zat.
 *
 *  Het ophalen deed .limit(2000), en zette daarna de cursor op de servertijd
 *  van dat moment. Die twee samen zijn een lek: kwamen er precies
 *  tweeduizend rijen terug -- vrijwel zeker afgekapt -- dan werd de rest
 *  nooit meer opgehaald, want de cursor stond er al voorbij. Een half schema,
 *  en niets dat het zei.
 *
 *  Het addertje zit in de gelijke tijdstempels: een bulkinvoer geeft
 *  honderden rijen precies dezelfde updated_at. Een cursor die alleen op de
 *  tijd staat slaat bij zo'n groep de rest over, of haalt ze eeuwig opnieuw
 *  op. Daarom telt hij verder op (updated_at, id).
 * ==================================================================== */

/* ==================================================================== *
 *  103. Oud is ouder, niet anders
 *
 *  Casper, met een schermafdruk van het systeemscherm: zes functies op
 *  1.91.2 met "oud" erachter, en er één op 1.91.1 zonder badge. Precies
 *  omgekeerd.
 *
 *  De oorzaak was één teken: `f.versie !== appVersie`. Hij keek naar het
 *  tabblad van vóór de laatste uitrol, en daarmee heette alles wat NIEUWER
 *  was dan zijn app "oud".
 *
 *  Vooruitlopen is geen storing maar de goede volgorde -- de functies worden
 *  eerst uitgerold en daarna vernieuwt de app. Bij het schema stond die regel
 *  al, met een controle eronder (groep 101). Hier was hij vergeten, en dat is
 *  het soort fout dat je alleen ziet als iemand ernaar wijst.
 * ==================================================================== */

console.log('\n103. Oud is ouder, niet anders')

{
  const { functiesStil, vergelijkVersie } = await import('../../src/lib/serverstand.ts')

  check('een lagere versie is ouder', vergelijkVersie('1.91.1', '1.91.2') === -1)
  check('een hogere versie is nieuwer', vergelijkVersie('1.91.2', '1.91.1') === 1)
  check('dezelfde versie is gelijk', vergelijkVersie('1.91.2', '1.91.2') === 0)

  /* Op getal en niet op tekst: als tekst komt "1.9.0" ná "1.10.0". */
  check('tien is meer dan negen', vergelijkVersie('1.10.0', '1.9.0') === 1)

  /*
   * Onbekend is iets anders dan oud. Een functie die zich meldde van vóór het
   * stempelen heeft een lege versie; daar mag geen waarschuwing op staan,
   * want er valt niets uit af te leiden.
   */
  check('een lege versie levert geen oordeel op', vergelijkVersie('', '1.91.2') === null)
  check('en onzin ook niet', vergelijkVersie('binnenkort', '1.91.2') === null)

  const stand = {
    schema: { nummer: 0, naam: '', at: null, gezien: 0, aangenomen: 0 },
    functies: [
      { naam: 'oud', versie: '1.91.1', gebouwd: '', gezienAt: 1 },
      { naam: 'gelijk', versie: '1.91.2', gebouwd: '', gezienAt: 1 },
      { naam: 'nieuwer', versie: '1.92.0', gebouwd: '', gezienAt: 1 },
      { naam: 'onbekend', versie: '', gebouwd: '', gezienAt: 1 },
    ],
  }

  const achter = functiesStil(stand, '1.91.2').map((f) => f.naam)
  check('alleen wat een lagere versie meldt telt mee',
    achter.join(',') === 'oud', JSON.stringify(achter))

  /* Dit was de fout zelf: een functie die vooruitloopt kreeg "oud". */
  check('een functie die vooruitloopt telt niet mee',
    !achter.includes('nieuwer'), JSON.stringify(achter))

  /*
   * En het scherm noemt het geen "oud".
   *
   * Dat was de tweede keer dat dit scherm iets beweerde wat de gegevens niet
   * dragen: vijf functies met "verouderd" erachter terwijl ze allemaal net
   * waren uitgerold. Een functie meldt zich bij zijn koude start, niet bij
   * elke uitrol -- dus "stil" en "oud" zien er van hieraf hetzelfde uit.
   */
  const { readFileSync: lees } = await import('node:fs')
  const systeem = lees('src/dashboards/developer/DeveloperDashboard.tsx', 'utf8')
  /* Alleen in de kaart over de server. Verderop staat ook "verouderd", en
     dáár klopt het: dat gaat over de app-versies waarop mensen echt draaien,
     en die melden zich bij elke melding en elke logregel. */
  const kaart = systeem.slice(
    systeem.indexOf('function ServerStandKaart'),
    systeem.indexOf('function Wekkers'))
  check('het scherm noemt een stille functie niet verouderd',
    kaart.includes('nog niet gemeld') && !zonderCommentaar(kaart).includes('verouderd'),
    'er staat nog een bewering die van hieraf niet te doen is')

  /* ---- en wat een wekker terugstuurde ---- */

  /*
   * Casper: "Maar hij heeft nooit iets gestuurd?"
   *
   * De wekker meldde "aangenomen" en er was geen mail verstuurd. Allebei
   * waar: de functie neemt het verzoek aan en besluit daarna zelf of er iets
   * te doen valt. {"overgeslagen":"het is 14 uur"} is net zo goed een 200 als
   * {"verstuurd":9}. Het antwoord moet dus mee tot in het scherm.
   */
  const { readFileSync } = await import('node:fs')
  const sql = readFileSync('supabase/setup.sql', 'utf8')

  /* De laatste definitie van wekkers_stand is die van 0109; daar hoort het
     antwoord zelf in te staan. Vanaf de laatste 'create or replace' kijken,
     want de eerdere versies staan er in setup.sql ook nog. */
  const laatsteStand = sql.slice(sql.lastIndexOf('create or replace function public.wekkers_stand'))
  check('de stand geeft het antwoord van de functie terug',
    laatsteStand.includes("left(coalesce(a.content, ''), 500)"),
    'alleen de statuscode; dan blijft "aangenomen" het enige dat je ziet')

  const scherm = readFileSync('src/dashboards/developer/DeveloperDashboard.tsx', 'utf8')
  check('en het scherm laat het zien',
    scherm.includes('w.inhoud'),
    'het scherm toont alleen nog de statuscode')
}

console.log('\n102. Ophalen tot er niets meer is')

{
  const { volgendeCursor, naFilter } = await import('../../src/lib/api/supabaseApi')

  const rij = (id: string, updated_at: number) => ({ id, updated_at })

  /* --- een halve pagina betekent: we zijn er --- */

  check('een pagina die niet vol is, is de laatste',
    volgendeCursor([rij('a', 1), rij('b', 2)], 10) === null)

  check('en een lege pagina ook',
    volgendeCursor([], 10) === null)

  /* --- een volle pagina betekent: er is meer --- */

  const c = volgendeCursor([rij('a', 1), rij('b', 5)], 2)
  check('een volle pagina geeft een vervolg',
    c?.tijd === 5 && c?.id === 'b', JSON.stringify(c))

  /*
   * En het vervolg telt verder op allebei. Dit is de regel waar het om
   * draait: alles wat later is, plus wat op hetzelfde tijdstip staat maar een
   * hoger id heeft. Zonder dat tweede deel valt een bulkinvoer -- honderden
   * rijen met dezelfde tijdstempel -- tussen wal en schip.
   */
  const f = naFilter({ tijd: 5, id: 'b' })
  check('het vervolgfilter neemt alles wat later is',
    f.includes('updated_at.gt.5'), f)
  check('en wat op hetzelfde moment staat met een hoger id',
    f.includes('and(updated_at.eq.5,id.gt."b")'), f)

  /*
   * Een rij zonder id is geen reden om door te tellen -- dan is de volgende
   * ronde raden, en raden in een lus is een lus die niet afloopt. Elke tabel
   * in dit schema heeft een id; dit is de klep voor als dat ooit niet zo is.
   */
  check('zonder id wordt er niet verder geteld',
    volgendeCursor([{ updated_at: 5 }], 1) === null)
  check('en zonder tijdstempel ook niet',
    volgendeCursor([{ id: 'a' }], 1) === null)

  /* --- en het ophalen gebruikt het ook echt --- */

  const { readFileSync } = await import('node:fs')
  const adapter = readFileSync('src/lib/api/supabaseApi.ts', 'utf8')

  check('het ophalen sorteert op allebei',
    /\.order\('updated_at'[\s\S]{0,80}\.order\('id'/.test(adapter),
    'zonder vaste volgorde is een vervolg niet te bepalen')

  /*
   * En de oude grens is weg. Hem alleen verhogen zou de klip verzetten in
   * plaats van weghalen. Zonder commentaar gemeten: de uitleg hierboven
   * noemt die grens juist, en anders meet deze controle mijn eigen tekst.
   */
  check('er staat geen ophaalgrens meer zonder vervolg',
    !zonderCommentaar(adapter).includes('.limit(2000)'),
    'de oude grens van tweeduizend staat er nog')
}

}
