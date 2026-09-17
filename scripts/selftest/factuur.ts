/**
 * De factuur van binnenkomst tot goedkeuring
 *
 * Onderdeel van de zelftest; zie scripts/selftest.ts voor hoe dit draait en
 * waarom het is opgesplitst.
 */

import { api, check, db, eq, zonderCommentaar } from './kern.ts'

export async function groepen() {

/* ==================================================================== *
 *  104. Meer dan één paar ogen per stap
 *
 *  Casper: "Kan je het mogelijk maken om meerdere mensen bij zowel de eerste
 *  als tweede neer te zetten?"
 *
 *  Overal stond één naam. Dat maakt van elke stap een flessenhals: gaat die
 *  ene op vakantie, dan staat de stapel stil tot het management ingrijpt.
 *
 *  Wat hier hard moet zijn is niet de opmaak maar de rekenregel eronder: één
 *  kiezer voor "welke mensen", en die moet namen en ids bij elkaar houden.
 *  Lopen die uit de pas, dan staat er een naam bij het verkeerde id -- en dat
 *  merk je pas als er iemand tekent die er niet over ging.
 * ==================================================================== */

console.log('\n104. Meer dan één paar ogen per stap')

{
  const { readFileSync } = await import('node:fs')

  /* ---- de kiezer staat op één plek ---- */

  /*
   * De route per bv en het inkoopadres stellen dezelfde vraag. Twee kiezers
   * voor "welke mensen" is er één te veel -- dat is precies hoe de twee
   * lijsten van "wie mag tekenen" eerder uit elkaar gingen lopen.
   */
  const routering = readFileSync('src/dashboards/administratie/Routering.tsx', 'utf8')
  const adressen = readFileSync('src/dashboards/administratie/Inkoopadressen.tsx', 'utf8')

  check('de routekaart gebruikt de gedeelde groepskiezer',
    routering.includes("from '../../components/Groep'"),
    'er staat een eigen kopie in dit scherm')
  check('en het inkoopadres dezelfde',
    adressen.includes("from '../../components/Groep'"),
    'het adresscherm heeft zijn eigen kiezer')

  /* ---- namen en ids blijven bij elkaar ---- */

  const groepBron = readFileSync('src/components/Groep.tsx', 'utf8')

  /*
   * Bij het weghalen van iemand moeten de twee lijsten samen krimpen. Een
   * filter op de ids met de oude namenlijst ernaast schuift alles één op --
   * en dan staat de naam van de een bij het id van de ander.
   */
  check('weghalen bouwt beide lijsten samen op',
    /function haalWeg[\s\S]{0,400}over\.push\(x\)[\s\S]{0,200}overNamen\.push/.test(groepBron),
    'de namen worden niet samen met de ids bijgehouden')

  check('en erbij doen zet de naam erachter',
    /function doeErbij[\s\S]{0,300}\[\.\.\.ids\.map\(toon\), naamVan\.get\(id\)/.test(groepBron),
    'de naam van de nieuwe komt niet op dezelfde plek als zijn id')

  /*
   * Een vastgelegde naam gaat voor op de naam van nu. Die is meegeschreven op
   * het moment zelf en blijft leesbaar als iemand later vertrekt -- precies
   * waarom hij op de bon wordt vastgelegd (0095).
   */
  check('de vastgelegde naam gaat voor',
    /const toon = \(id: string, i: number\) => namen\[i\] \|\| naamVan\.get\(id\) \|\| id/.test(groepBron),
    'een vertrokken collega wordt onleesbaar')

  /* ---- leeg betekent iets, en dat staat er ---- */

  check('een lege groep zegt wat dat betekent',
    groepBron.includes('leegTekst') && groepBron.includes('iedereen die over kosten beslist'),
    'een leeg vakje ziet eruit als "nog niet ingevuld"')

  /* ---- en de lijst op handtekening rekent op een groep ---- */

  const opHandtekening = readFileSync(
    'src/dashboards/administratie/OpHandtekening.tsx', 'utf8')

  check('wat bij mij ligt kijkt of ik in de groep zit',
    opHandtekening.includes('r.ligtBij.includes(user.id)'),
    'de filter vergelijkt nog met één naam')
  check('en werk dat bij niemand ligt blijft zichtbaar',
    opHandtekening.includes('r.ligtBij.length === 0'),
    'werk zonder groep valt uit de lijst en blijft dus liggen')
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
    await import('../../src/lib/factuurhistorie')

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
 *  Zoeken in de kostenposten (0061)
 *
 *  Eén veld voor alles, want dat is hoe mensen zoeken: ze typen wat ze
 *  weten. Wat daarbij makkelijk stukgaat zonder dat je het merkt zijn twee
 *  dingen -- meerdere woorden, en een bedrag met een komma.
 * ==================================================================== */

console.log('\n42. Zoeken in de kostenposten')

{
  const { pastBijZoek } = await import('../../src/dashboards/administratie/Kostenposten')

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
  } = await import('../../src/lib/werklijst.ts')

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
  /*
   * Hier stond: "en met een exact-id is hij klaar".
   *
   * Dat was fout, en deze regel ving het toen 'betalen' erbij kwam (0079).
   * Geboekt is niet afgehandeld: de factuur staat in Exact en er is nog geen
   * cent overgemaakt. Met de oude regel telde die hele stapel als afgerond --
   * in de lijst van Casper bij Blue10 zijn dat er 559 -- en was hij in dit
   * systeem nergens te zien.
   */
  check('geboekt maar niet betaald wacht op betalen',
    standVan(bon({ status: 'goedgekeurd', exactId: '12345' }), NU) === 'betalen')
  check('en pas met een betaaldatum is hij klaar',
    standVan(bon({ status: 'goedgekeurd', exactId: '12345', betaaldAt: NU }), NU) === 'klaar')

  /*
   * En die stapel hoort NIET in de werklijst mee te tellen.
   *
   * Betalen is werk, maar het gaat via een betaalopdracht en een SEPA-bestand,
   * niet via "kijk hiernaar en zeg ja of nee". Zou hij meetellen, dan groeit
   * de badge van Te verwerken met alles wat op de bank wacht en is de handvol
   * facturen waar iemand werkelijk naar moet kijken er niet meer in te vinden.
   */
  check('maar telt niet mee in de werklijst',
    telWerk([bon({ status: 'goedgekeurd', exactId: '12345' })], NU) === 0)

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
  const { expenses: expRepo } = await import('../../src/lib/repo')

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

/* ==================================================================== *
 *  60. De stroom van een factuur
 *
 *  Casper stuurde foto's van Blue10 mee: "je moet echt blue10 een beetje
 *  namaken met dat stuk" -- de rij vakjes boven de lijst, elk met een teller.
 *
 *  Wat hier wordt nagerekend is niet de opmaak maar de indeling: welke bon
 *  in welk vakje valt. Dat is de plek waar het stil fout gaat. Een stand die
 *  in geen enkel vakje valt verdwijnt uit de rij, en dan telt de balk minder
 *  facturen dan er zijn zonder dat er iets misgaat -- precies het soort fout
 *  waar niemand achter komt omdat er geen foutmelding bij hoort.
 * ==================================================================== */

console.log('\n60. De stroom van een factuur')

{
  const { STAPPEN, onafgehandeldePost, perBedrijf, stapVanStand, stroom, teLaat } =
    await import('../../src/lib/stroom.ts')
  const { STANDEN, VOLGORDE } = await import('../../src/lib/werklijst.ts')

  const NU = 1_800_000_000_000

  const bon = (extra: Record<string, unknown> = {}) => ({
    id: 'e' + Math.random().toString(36).slice(2, 8),
    locationId: 'loc_a', date: NU - 86_400_000, category: 'materiaal',
    supplier: 'Chemtrans', description: '', amountExcl: 100, vatPct: 21,
    status: 'open', submittedBy: 'u1', submittedByName: 'Wim', updatedAt: NU,
    ...extra,
  }) as never

  /* ---- elke stand die werk is, valt in een vakje ---- */

  /*
   * De belangrijkste controle van dit hoofdstuk.
   *
   * Komt er ooit een stand bij in werklijst.ts en vergeet iemand hem in
   * STAPPEN te zetten, dan verdwijnen die bonnen uit de balk. De teller klopt
   * dan niet meer, en er is niets dat dat zegt. Hier valt het om.
   */
  for (const sleutel of VOLGORDE) {
    check(`de stand "${sleutel}" heeft een vakje in de stroom`,
      stapVanStand(sleutel) !== null)
  }
  check('en "betalen" ook, ook al staat die buiten de werklijst',
    stapVanStand('betalen') === 'betalen')
  check('wat afgerond is valt in geen enkel vakje',
    stapVanStand('klaar') === null && stapVanStand('afgekeurd') === null)

  /* ---- de indeling zelf ---- */

  const stand = (uit: ReturnType<typeof stroom>, sleutel: string) =>
    uit.find((s) => s.stap.sleutel === sleutel)!

  const uit = stroom([
    bon({ status: 'open' }),                                     // akkoord
    bon({ status: 'eerste_akkoord' }),                           // tweede
    bon({ status: 'open', amountExcl: 0, supplier: '' }),         // aanvullen
    bon({ status: 'goedgekeurd' }),                              // boeken
    bon({ status: 'goedgekeurd', exactId: 'X1' }),                // betalen
    bon({ status: 'goedgekeurd', exactId: 'X2', betaaldAt: NU }), // klaar: telt niet
    bon({ status: 'afgekeurd' }),                                // telt niet
  ], [], NU)

  check('akkoord en tweede vallen samen onder Goedkeuren',
    stand(uit, 'goedkeuren').aantal === 2)
  check('een bon zonder bedrag staat bij Aanvullen',
    stand(uit, 'aanvullen').aantal === 1)
  check('goedgekeurd staat bij Boeken',
    stand(uit, 'boeken').aantal === 1)
  check('geboekt en onbetaald staat bij Betalen',
    stand(uit, 'betalen').aantal === 1)
  check('wat betaald of afgekeurd is telt nergens mee',
    uit.reduce((t, s) => t + s.aantal, 0) === 5)

  /*
   * Lege vakjes blijven staan. Dat is geen detail: een vakje dat verdwijnt
   * verschuift alle andere, en dan staat Goedkeuren de ene dag op plek drie
   * en de volgende op plek twee. Zo'n rij leer je niet lezen.
   */
  check('alle stappen komen terug, ook de lege',
    stroom([], [], NU).length === STAPPEN.length)

  /* ---- het kruisje en het uitroepteken ---- */

  const stuk = stroom([
    bon({ status: 'goedgekeurd', exactFout: 'Dagboek 70 bestaat niet' }),
    bon({ status: 'goedgekeurd' }),
  ], [], NU)
  check('een fout van Exact telt als stuk bij Boeken',
    stand(stuk, 'boeken').aantal === 2 && stand(stuk, 'boeken').stuk === 1)

  check('een verstreken vervaldatum is te laat',
    teLaat(bon({ vervaldatum: NU - 86_400_000 }), NU) === true)
  check('maar niet als hij betaald is',
    teLaat(bon({ vervaldatum: NU - 86_400_000, betaaldAt: NU }), NU) === false)
  check('en een vervaldatum in de toekomst ook niet',
    teLaat(bon({ vervaldatum: NU + 86_400_000 }), NU) === false)

  /* ---- Binnen: post waar nog geen factuur van is ---- */

  const post = (extra: Record<string, unknown> = {}) => ({
    id: 'm' + Math.random().toString(36).slice(2, 8),
    richting: 'in', van: 'a@b.nl', aan: 'inkoop.venlo@x.nl', onderwerp: 'Factuur',
    tekst: '', hadHtml: false, at: NU, status: 'nieuw', attachments: [], updatedAt: NU,
    ...extra,
  }) as never

  check('post zonder kostenpost telt als binnengekomen',
    onafgehandeldePost([post()]).length === 1)
  check('post waar al een factuur van is telt niet mee',
    onafgehandeldePost([post({ expenseId: 'e1' })]).length === 0)
  /*
   * Een doorgestuurde eigen verkoopfactuur is met opzet GEEN kostenpost
   * geworden (0047). Die als achterstand tellen zou betekenen dat er elke
   * maand werk in de rij staat dat er niet is -- en dan kijkt niemand meer
   * naar dat vakje.
   */
  check('en een doorgestuurde verkoopfactuur ook niet',
    onafgehandeldePost([post({ soort: 'verkoop' })]).length === 0)
  check('uitgaande post telt niet mee',
    onafgehandeldePost([post({ richting: 'uit' })]).length === 0)

  check('het vakje Binnen telt post en geen bonnen',
    stand(stroom([bon()], [post(), post()], NU), 'binnen').aantal === 2)

  /* ---- per onderneming ---- */

  const namen = new Map([['001', 'Truckwash 1 Asten B.V.'], ['002', 'Truckwash 1 Vastgoed B.V.']])
  const groepen = perBedrijf([
    bon({ administratie: '001', amountExcl: 100, vatPct: 0 }),
    bon({ administratie: '001', amountExcl: 200, vatPct: 0 }),
    bon({ administratie: '002', amountExcl: 1000, vatPct: 0 }),
    bon({ amountExcl: 50, vatPct: 0 }),
  ], namen, NU)

  check('de bonnen worden per bv opgeteld',
    groepen.find((g) => g.code === '001')?.bedrag === 300)
  check('en de naam komt uit Exact',
    groepen.find((g) => g.code === '002')?.naam === 'Truckwash 1 Vastgoed B.V.')
  /*
   * Wat nergens bij hoort staat bovenaan, ook al is het bedrag het kleinst.
   * Dat is het enige in deze lijst waar iemand iets aan moet doen; de rest is
   * een stand van zaken.
   */
  check('wat nog geen onderneming heeft staat bovenaan',
    groepen[0].code === '' && groepen[0].naam === 'Nog geen onderneming')
  check('en de rest staat op bedrag, grootste eerst',
    groepen[1].code === '002' && groepen[2].code === '001')

  /* ---- de uitleg in de balk moet ergens over gaan ---- */

  for (const stap of STAPPEN) {
    check(`de stap "${stap.sleutel}" legt zichzelf uit`,
      stap.uitleg.length > 15 && stap.uitleg.endsWith('.'))
    /* Elke stand die genoemd wordt moet bestaan; een tikfout hier laat
       bonnen stilletjes uit de balk vallen. */
    check(`en noemt alleen standen die bestaan`,
      stap.standen.every((s) => s in STANDEN))
  }
}

/* ==================================================================== *
 *  61. De stroom aan de verkoopkant
 *
 *  Casper vroeg of Verkoop dezelfde behandeling kon krijgen als Inkoop: een
 *  rij vakjes die teller en filter tegelijk is.
 *
 *  Wat hier wordt nagerekend is de indeling, want daar gaat het stil fout.
 *  Een factuur die in twee vakjes valt wordt door twee mensen opgepakt of
 *  door geen van beiden; een factuur die in geen enkel vakje valt verdwijnt
 *  uit de balk zonder dat er iets misgaat.
 *
 *  En het bedrag dat buiten staat, want dat loopt dwars door de vakjes heen
 *  -- 'boeken' en 'openstaand' zijn allebei geld dat nog moet komen.
 * ==================================================================== */

console.log('\n61. De stroom aan de verkoopkant')

{
  const {
    VERKOOPSTAPPEN, buitenStaand, verkoopKlem, verkoopstapVan, verkoopstroom,
    verkoopTeLaat,
  } = await import('../../src/lib/verkoopstroom.ts')

  const NU = 1_800_000_000_000
  const DAG = 86_400_000

  const f = (extra: Record<string, unknown> = {}) => ({
    id: 'vf' + Math.random().toString(36).slice(2, 8),
    nummer: null, klant: 'Van Dijk Transport', companyId: 'co1',
    administratie: '001', periode: '2026-05', datum: NU - 10 * DAG,
    vervaldatum: NU + 20 * DAG, verstuurdAt: null, betaaldAt: null,
    bedragExcl: 100, bedragIncl: 121, status: 'concept',
    exactId: null, fout: null, heeftRelatie: true,
    ...extra,
  }) as never

  /* ---- elke stand valt in precies één vakje ---- */

  check('een concept staat bij Concept',
    verkoopstapVan(f()) === 'concept')
  check('verstuurd en nog niet geboekt staat bij Boeken',
    verkoopstapVan(f({ status: 'verstuurd' })) === 'boeken')
  check('verstuurd en geboekt staat bij Openstaand',
    verkoopstapVan(f({ status: 'verstuurd', exactId: 'X1' })) === 'openstaand')

  /*
   * Wat afgehandeld is valt in geen enkel vakje. Een lijst waarin het
   * afgeronde werk blijft staan wordt elke maand langer en elke maand minder
   * gelezen.
   */
  check('betaald telt nergens mee',
    verkoopstapVan(f({ status: 'betaald', exactId: 'X1', betaaldAt: NU })) === null)
  check('vervallen ook niet',
    verkoopstapVan(f({ status: 'vervallen' })) === null)

  /*
   * De keuze die niet vanzelf spreekt. Een verstuurde factuur die nog niet
   * geboekt is, is tegelijk "moet geboekt" en "staat open". Hij valt onder
   * Boeken -- dat is de eerstvolgende handeling van ONS; openstaan is wachten
   * op de klant.
   */
  const dubbel = f({ status: 'verstuurd', exactId: null })
  check('een verstuurde ongeboekte factuur valt maar in één vakje',
    VERKOOPSTAPPEN.filter((s) => verkoopstapVan(dubbel) === s.sleutel).length === 1)

  /* ---- de balk ---- */

  const vak = (uit: ReturnType<typeof verkoopstroom>, sleutel: string) =>
    uit.find((s) => s.stap.sleutel === sleutel)!

  const uit = verkoopstroom([
    f(),
    f(),
    f({ status: 'verstuurd' }),
    f({ status: 'verstuurd', exactId: 'X1' }),
    f({ status: 'betaald', betaaldAt: NU }),
    f({ status: 'vervallen' }),
  ], NU)

  check('twee concepten', vak(uit, 'concept').aantal === 2)
  check('één te boeken', vak(uit, 'boeken').aantal === 1)
  check('één openstaand', vak(uit, 'openstaand').aantal === 1)
  check('het bedrag is inclusief btw -- dat is wat de klant overmaakt',
    vak(uit, 'concept').bedrag === 242)

  check('alle stappen komen terug, ook de lege',
    verkoopstroom([], NU).length === VERKOOPSTAPPEN.length)

  /* ---- wat vastzit ---- */

  /*
   * Zonder gekoppelde relatie kan een factuur niet naar Exact: een boeking
   * wijst naar een relatie en niet naar een naam. Dat is met de hand op te
   * lossen, dus het hoort op het scherm en niet in een logregel.
   */
  const losseKlant = f({ status: 'verstuurd', heeftRelatie: false })
  check('zonder relatie in Exact zit hij vast',
    (verkoopKlem(losseKlant) ?? '').includes('relatie'))
  check('en dat telt als vastgelopen in de balk',
    vak(verkoopstroom([losseKlant], NU), 'boeken').klem === 1)

  check('een geboekte factuur zit nergens op vast',
    verkoopKlem(f({ status: 'verstuurd', exactId: 'X1', heeftRelatie: false })) === null)
  check('en een concept ook niet',
    verkoopKlem(f({ heeftRelatie: false })) === null)

  /* ---- te laat ---- */

  check('over de vervaldatum en niet betaald is te laat',
    verkoopTeLaat(f({ status: 'verstuurd', vervaldatum: NU - DAG }), NU) === true)
  check('maar betaald niet meer',
    verkoopTeLaat(f({ vervaldatum: NU - DAG, betaaldAt: NU }), NU) === false)
  check('en een vervaldatum in de toekomst ook niet',
    verkoopTeLaat(f({ vervaldatum: NU + DAG }), NU) === false)

  /* ---- wat er buiten staat ---- */

  /*
   * Dit getal loopt dwars door de vakjes heen: 'boeken' en 'openstaand' zijn
   * allebei geld dat nog moet komen. Zou het over twee vakjes verdeeld
   * blijven, dan is er nergens meer één bedrag om naar te kijken.
   */
  const buiten = buitenStaand([
    f({ status: 'verstuurd', bedragIncl: 100 }),
    f({ status: 'verstuurd', exactId: 'X1', bedragIncl: 200 }),
    f({ status: 'concept', bedragIncl: 999 }),
    f({ status: 'betaald', betaaldAt: NU, bedragIncl: 500 }),
  ])
  check('buiten staat alleen wat verstuurd en onbetaald is',
    buiten.aantal === 2 && buiten.bedrag === 300)
  check('een concept telt daar niet in mee -- dat is nog niet de deur uit',
    buiten.bedrag === 300)

  /* ---- de uitleg moet ergens over gaan ---- */

  for (const stap of VERKOOPSTAPPEN) {
    check(`de stap "${stap.sleutel}" legt zichzelf uit`,
      stap.uitleg.length > 15 && stap.uitleg.endsWith('.'))
  }
}

/* ==================================================================== *
 *  74. Eén factuur, meerdere posten
 *
 *  Casper: "dat ik bijvoorbeeld 2 dingen op het factuur, ook verschillende
 *  posten op kan zetten (...) Je moet het echt vriendelijk maken voor exact."
 *
 *  Verdelen kon al sinds 0062, maar je moest elke regel OVERTYPEN terwijl de
 *  lezer ze allang van het papier had gehaald. Dat is niet alleen werk: wie
 *  overtypt maakt tikfouten in bedragen, en die worden daarna goedgekeurd
 *  zonder dat iemand ze naast het papier houdt.
 *
 *  En wat er in Exact terechtkwam was de tweede helft. Een ongesplitste bon
 *  kreeg het factuurnummer als regelomschrijving, dus stond er in het
 *  inkoopdagboek twee keer hetzelfde nummer en nergens waar het over ging.
 * ==================================================================== */

console.log('\n74. Eén factuur, meerdere posten')

{
  const { readFileSync } = await import('node:fs')
  const scherm = readFileSync('src/dashboards/administratie/Kostenposten.tsx', 'utf8')
  const exact = readFileSync('supabase/functions/exact/index.ts', 'utf8')
  const migratie = readFileSync(
    'supabase/migrations/0085_de_omschrijving_in_het_dagboek.sql', 'utf8')
  const css = readFileSync('src/styles/theme.css', 'utf8')

  /* ---- 1. de weergave paste niet ---- */

  /*
   * Vijf kolommen in een smalle kolom betekent horizontaal schuiven, en dan
   * valt precies het bedrag buiten beeld: op het scherm stond "Totaal
   * inclusief" met niets erachter.
   */
  const lezingBlok = scherm.slice(scherm.indexOf('{/* --- de regels --- */}'),
    scherm.indexOf('{/* --- wat er over te nemen valt --- */}'))
  check('de gelezen regels staan niet meer in een tabel van vijf kolommen',
    lezingBlok.length > 0 && !lezingBlok.includes('<th className="num">Stukprijs</th>'),
    lezingBlok.length ? 'de tabel staat er nog' : 'blok niet gevonden')
  check('maar in twee kolommen: wat het was en wat het kostte',
    lezingBlok.includes('lezing-regel-wat') && lezingBlok.includes('lezing-regel-bedrag'))
  check('en het bedrag staat er nog bij elke regel',
    lezingBlok.includes('r.bedragExcl != null ? money(r.bedragExcl)'))
  check('ook onder het totaal',
    lezingBlok.includes('lezing.totaalIncl != null ? money(lezing.totaalIncl)'))

  check('de opmaak staat erbij', /\.lezing-regel-bedrag\s*\{/.test(css))
  /* Een lang bedrag mag niet afbreken; dat is precies wat er misging. */
  check('en het bedrag breekt niet af',
    /\.lezing-regel-bedrag\s*\{[^}]*white-space:\s*nowrap/.test(css))

  /* ---- 2. de regels overnemen ---- */

  const splitsen = scherm.slice(scherm.indexOf('function Splitsen('))
  check('de regels van de factuur zijn over te nemen',
    splitsen.includes('async function neemOver()'))
  check('en komen uit de lezing, niet uit de hand',
    splitsen.includes("bon.gelezen?.regels"))

  /*
   * Alleen regels met een bedrag. Een regel van nul is een kopregel of een
   * toelichting ("Specificatie:"), en die hoort geen boekingsregel te worden
   * -- Exact neemt hem aan en dan staat er een lege regel in het dagboek.
   */
  check('regels zonder bedrag worden overgeslagen',
    splitsen.includes('Number(r.bedragExcl) > 0'))

  /*
   * Twee keer drukken mag geen dubbele verdeling geven. Dat is geen
   * schoonheidsfout: de som telt dan op tot het dubbele en de bon kan niet
   * meer worden goedgekeurd, met een foutmelding die over "de regels tellen
   * op tot te veel" gaat en niet over de knop die je twee keer indrukte.
   */
  check('wat er stond gaat eerst weg',
    /for \(const r of opVolgorde\) await expRepo\.wisRegel\(r\.id\)/.test(splitsen))

  /*
   * De rekening wordt NIET geraden. De lezer weet wat er staat, niet waar het
   * hoort -- en dat oordeel is juist de reden dat je splitst.
   */
  check('de rekening kiest een mens, behalve die van de bon zelf',
    splitsen.includes('grootboekCode: n === 0 ? bon.grootboekCode : undefined'))

  /* Het tarief van de regel gaat voor dat van de bon: een factuur met 21% en
     9% door elkaar is precies waarom dit per regel staat. */
  check('het btw-tarief komt van de regel als het op het papier stond',
    splitsen.includes('btwPct: r.btwPct ?? bon.vatPct ?? 21'))

  check('de knop verschijnt pas als er iets te verdelen valt',
    splitsen.includes('teVerdelen.length > 1'))

  /* ---- 3. wat Exact te zien krijgt ---- */

  check('een omschrijving wordt netjes afgekapt',
    /function kortVoorExact\(/.test(exact))
  /*
   * Nergens meer een harde slice(0, 60) -- ook niet aan de verkoopkant. Die
   * stond er nog, in stuurVerkoop(), en de test vond hem: dezelfde fout in
   * een andere functie. Eén afkapper voor alle vier de plekken, anders staat
   * er over een half jaar weer een die het net anders doet.
   */
  check('en niet meer middenin een woord, ook niet bij verkoop',
    !/\.slice\(0, 60\)/.test(exact),
    'er staat nog een harde slice(0, 60)')
  /*
   * Hier stond een telling: evenveel keer Description als kortVoorExact, min
   * de definitie en min de varianten met ||. Die telde wat hij niet bedoelde.
   * Zodra er een TWEEDE veld door de afkapper ging -- het onderwerp van een
   * document, toen de factuur zelf meeging naar Exact (0091) -- viel hij om,
   * terwijl dat juist goed was.
   *
   * De vraag is niet hoe váák de afkapper wordt aangeroepen maar of er een
   * tekstveld naar Exact gaat dat er NIET langs komt. Dat is precies wat er
   * nu staat, en het is meteen strenger: Subject telt mee.
   */
  check('elke omschrijving die naar Exact gaat, gaat door die ene afkapper',
    (exact.match(/(Description|Subject):/g) ?? []).length
      === (exact.match(/(Description|Subject):\s*kortVoorExact\(/g) ?? []).length,
    'er gaat een Description of Subject naar Exact zonder kortVoorExact')

  /*
   * Waar de factuur over ging, in plaats van nog een keer het factuurnummer.
   * Dat is wat er in het inkoopdagboek komt te staan.
   */
  check('het kenmerk uit de lezing gaat mee naar Exact',
    exact.includes('kortVoorExact(bon.kenmerk ?? \'\')'))
  check('en de database geeft het terug', migratie.includes("gelezen ->> 'kenmerk'"))

  /*
   * De rechten na een drop function. Supabase geeft elke nieuwe functie aan
   * anon en authenticated; deze leest langs RLS heen wat er aan facturen
   * klaarstaat, dus die deur hoort dicht. Zie 0033/0034.
   */
  check('en de rechten staan na de drop weer goed',
    migratie.includes('revoke execute on function public.exact_facturen_wachtend() from public, anon, authenticated')
    && migratie.includes('grant  execute on function public.exact_facturen_wachtend() to service_role'))

  /* Valt het kenmerk weg, dan gaat het zoals het ging. Een lege omschrijving
     in het dagboek is erger dan een factuurnummer. */
  check('zonder kenmerk blijft het factuurnummer de terugval',
    exact.includes("|| kortVoorExact(bon.factuurnummer ?? bon.leverancier)"))
}

/* ==================================================================== *
 *  75. Het factuurscherm: invoer links, papier rechts
 *
 *  Casper, eerst: "links: document / PDF-preview, rechts: administratieve
 *  gegevens." En later, na ermee gewerkt te hebben: "bij de facturen
 *  bekijken de pdf aan de rechterkant hebben, en de invoer en check links."
 *
 *  Die twee staan hier allebei vastgelegd, want zonder de tweede lijkt de
 *  omdraaiing een vergissing die iemand terugzet -- de CSS zei letterlijk
 *  "document links" met het eerste citaat eronder.
 * ==================================================================== */

console.log('\n75. Het factuurscherm')

{
  const { readFileSync } = await import('node:fs')
  const scherm = readFileSync('src/dashboards/administratie/Kostenposten.tsx', 'utf8')
  const css = readFileSync('src/styles/systeem.css', 'utf8')

  const blok = scherm.slice(scherm.indexOf('<div className="tweeluik">'),
    scherm.indexOf('<div className="tweeluik">') + 1800)

  check('de invoer staat vóór het papier in de HTML',
    blok.indexOf('tweeluik-zij') < blok.indexOf('<Documentpaneel'),
    'het documentpaneel staat nog eerst')

  /*
   * En de kolombreedtes moeten meedraaien. Blijft de vaste 420px links
   * staan terwijl de HTML is omgedraaid, dan krijgt de PDF de smalle kolom
   * -- dat is erger dan het was.
   */
  const grid = /\.tweeluik\s*\{[^}]*grid-template-columns:\s*([^;]+);/.exec(css)
  /*
   * Hier stond /^420px\s+minmax/ -- de maat zelf, niet de regel. Toen de
   * gegevenskolom mocht meegroeien (de verdeling paste niet in 420px en liep
   * dwars door de PDF) viel hij om, terwijl de bedoeling ongewijzigd was.
   *
   * De regel is: links een kolom met een BEGRENSDE breedte, rechts de kolom
   * die de rest opvult. Draait dat om, dan krijgt het document de smalle
   * kolom en is het erger dan het was.
   */
  check('de smalle kolom staat links, bij de invoer',
    Boolean(grid)
      && /^(?:\d+px|minmax\(\s*\d+px\s*,\s*\d+px\s*\))\s+minmax\(\s*0\s*,\s*1fr\s*\)$/
        .test(grid[1].trim()),
    grid ? grid[1].trim() : 'grid-template-columns niet gevonden')

  /*
   * Niet met "order" omgedraaid. Dat zou de tabvolgorde andersom laten lopen
   * dan het oog, en dan springt de cursor over het scherm bij elke tab.
   *
   * Alleen in het .tweeluik-blok zelf kijken, en met een grens ervoor: de
   * eerste versie van deze controle zocht "order:" in alles wat met .tweeluik
   * begint, en vond "border:" in .tweeluik-doc. Een test die aanslaat op een
   * rand is geen test.
   */
  const tweeluikBlok = /\n\.tweeluik \{([^}]*)\}/.exec(css)
  check('en niet met order, zodat de tabvolgorde het oog volgt',
    Boolean(tweeluikBlok) && !/(^|[^a-z-])order\s*:/m.test(tweeluikBlok[1]),
    tweeluikBlok ? 'er staat een order in .tweeluik' : '.tweeluik-blok niet gevonden')

  /* Op een smal scherm blijft het onder elkaar; anders staat een PDF van
     420px naast een formulier van 420px op een telefoon. */
  check('op een smal scherm staat het nog steeds onder elkaar',
    /@media \(max-width: 1180px\)[\s\S]{0,240}\.tweeluik \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(css))

  /*
   * Allebei de wensen staan in de uitleg, met de tweede als de geldende.
   *
   * Witruimte platslaan vóór het zoeken: een citaat in een commentaarblok
   * breekt over regels af, en dan vindt includes() het niet terwijl het er
   * gewoon staat.
   */
  const plat = css.replace(/\s+/g, ' ')
  check('de uitleg noemt waarom het is omgedraaid',
    plat.includes('de pdf aan de rechterkant hebben')
    && plat.includes('invoer links, document rechts'))

  /*
   * En de balk van de browser eroverheen staat uit.
   *
   * Casper: "Dat zwart vak met pagina nummers, dat kan je weghalen, als ze
   * naar beneden scrollen kunnen ze alles wel netjes zien." Dat is een
   * aanwijzing in het adres (#toolbar=0), en die is bij de eerste de beste
   * wijziging aan die regel zo weg -- zonder dat iemand het merkt, want het
   * document blijft gewoon staan. Vandaar hier.
   *
   * view=FitH hoort erbij te blijven: zonder dat begint de bon op honderd
   * procent en zie je er een kwart van.
   */
  const doc = readFileSync('src/components/ui/document.tsx', 'utf8')
  const bron = /src=\{`\$\{adres\}([^`]*)`\}/.exec(doc)
  check('de zwarte balk van de pdf-weergave staat uit',
    Boolean(bron) && bron[1].includes('toolbar=0'),
    bron ? bron[1] : 'de iframe-bron is niet gevonden')
  check('en de bon begint nog steeds op breedte',
    Boolean(bron) && bron[1].includes('view=FitH'),
    bron ? bron[1] : 'de iframe-bron is niet gevonden')
}

/* ==================================================================== *
 *  80. Een boeking die niet optelt, en de factuur die meegaat
 *
 *  Casper: "hij heeft het doorgezet, maar heeft niet alle bedragen
 *  meegestuurd. Kan je ook de documenten mee sturen?"
 *
 *  In Exact stond factuur VF261203080 van 143,76 geboekt voor 51,86 -- één
 *  van de drie regels van de verdeling. De boeking was aangemaakt, er kwam
 *  een boekstuknummer terug, en bij ons stond hij op doorgekomen. Aan niets
 *  te zien dat er 91,90 ontbrak.
 *
 *  Dit is het enige soort tekort waarbij er WEL geboekt wordt en niet alles;
 *  al het andere houdt de hele boeking tegen en valt vanzelf op. Daarom staan
 *  er twee controles op: één om het te zien voordat er iets weggaat, en één
 *  vlak voor de deur om het tegen te houden.
 * ==================================================================== */

console.log('\n80. Een boeking die niet optelt, en de factuur die meegaat')

{
  const { readFileSync } = await import('node:fs')
  const fn = readFileSync('supabase/functions/exact/index.ts', 'utf8')
  const m91 = readFileSync('supabase/migrations/0091_een_boeking_die_niet_optelt.sql', 'utf8')
  const bon = readFileSync('src/dashboards/administratie/Kostenposten.tsx', 'utf8')

  /* --- 1. de harde stop --- */

  /*
   * Vlak voor de POST en niet ergens ervoor. 0062 rekende erop dat de
   * database het bij het goedkeuren al ving, en dat doet hij -- alleen slaat
   * die controle over als er op dat moment nog geen regels zijn.
   */
  check('een verdeling die niet optelt gaat niet naar Exact',
    /const somLijnen = lijnen\.reduce/.test(fn)
    && /Math\.abs\(somLijnen - hoort\) >= 0\.005/.test(fn),
    'de verzendlus telt de regels niet na voor hij ze opstuurt')

  check('en zegt hoeveel het scheelt',
    fn.includes('de verdeling telt op tot'),
    'de melding noemt de bedragen niet')

  /* --- 2. en je ziet het aankomen --- */

  check('de optelsom komt mee uit de wachtrij',
    m91.includes('regels_som') && /regels\s+integer/.test(m91),
    'exact_facturen_wachtend geeft de verdeling niet mee')

  check('en staat bij wat er blokkeert',
    m91.includes("then 'verdeling' end") && fn.includes("mist.push('verdeling')"),
    'een scheve verdeling staat niet bij de blokkades')

  /*
   * Het scherm groepeert op het EERSTE tekort. Stond 'verdeling' achteraan in
   * de lijst, dan kwam zo'n factuur onder de kop "crediteur" te staan met een
   * zin over de verdeling eronder.
   */
  check('en staat vooraan, waar het scherm op groepeert',
    /array\[[\s\S]{0,400}?then 'verdeling' end,[\s\S]{0,120}?'onderneming'/.test(m91),
    "'verdeling' staat niet vooraan in wat[]")

  /* --- 3. de factuur zelf gaat mee --- */

  /* Twee stappen bij Exact; een boekingsregel heeft geen veld voor een
     document. Nagekeken in hun documentatie, niet aangenomen. */
  check('de PDF gaat als document naar Exact',
    fn.includes("'documents/Documents'") && fn.includes("'documents/DocumentAttachments'"),
    'er wordt geen document aangemaakt')

  check('en hangt aan de boeking die net is gemaakt',
    fn.includes('FinancialTransactionEntryID'),
    'het document hangt nergens aan -- dan staat het los in het archief')

  /*
   * Het documenttype is een nummer per administratie. Een vast getal was
   * precies de fout bij het dagboek (0089): daar werd 20 voor inkoop
   * aangezien terwijl 20 verkoop is.
   */
  check('het documenttype komt uit Exact en niet uit ons hoofd',
    fn.includes("'documents/DocumentTypes'") && fn.includes('DocumentIsCreatable'),
    'het documenttype is een vast getal')

  /* --- 4. en een bijlage laat de boeking nooit mislukken --- */

  /*
   * Dit is de belangrijkste van de vier. Op het moment dat de bijlage draait
   * staat de boeking al in Exact. Zou een mislukte bijlage de bon laten
   * mislukken, dan blijft exact_id leeg en boekt de volgende ronde dezelfde
   * factuur nog een keer -- twee boekingen om een bestand dat niet paste.
   */
  check('een mislukte bijlage laat de boeking staan',
    /catch \(e\) \{\s*return \{ document: null, fout:/.test(fn)
    && m91.includes('exact_document_fout'),
    'bijlageNaarExact kan gooien, en dan wordt de factuur dubbel geboekt')

  check('en dat is terug te zien op de factuur',
    bon.includes('De factuur zelf ging niet mee'),
    'het scherm zegt niet of de PDF is meegegaan')
}

/* ==================================================================== *
 *  81. Per onderneming, en niet meer door de PDF heen
 *
 *  Casper: "Er gaat op het moment tekst erdoorheen (...) verklein het pdf,
 *  zodat er meer ruimte is." En: "als ik bij boeking een andere onderneming
 *  pak, moet je die grootboekrekeningen laten zien.... datzelfde met de
 *  inkoopdagboek, btw codes ect, zorg dat je die juist per onderneming zelf
 *  pakt, want anders blijf ik bezig"
 *
 *  Twee dingen die aan elkaar hangen. Het schema stond sinds 0086 per bv in
 *  de database, maar het scherm liet ze allemaal door elkaar zien -- 4040 van
 *  de ene administratie naast 4040 van de andere -- en dat bleek pas bij het
 *  boeken. En de verdeling klapte in onder een VENSTERbreedte van 900px,
 *  terwijl hij in een kolom van 420px stond op een scherm van 2000px: de
 *  brede indeling bleef staan in een vak waar hij niet in paste, en liep er
 *  dwars doorheen.
 * ==================================================================== */

console.log('\n81. Per onderneming, en niet meer door de PDF heen')

{
  const { readFileSync } = await import('node:fs')
  const boeking = readFileSync('src/lib/boeking.ts', 'utf8')
  const scherm = readFileSync('src/dashboards/administratie/Kostenposten.tsx', 'utf8')
  const types = readFileSync('src/lib/types.ts', 'utf8')
  const thema = readFileSync('src/styles/theme.css', 'utf8')
  const systeem = readFileSync('src/styles/systeem.css', 'utf8')
  const m92 = readFileSync(
    'supabase/migrations/0092_niet_meer_per_bv_instellen_wat_exact_weet.sql', 'utf8')

  /* --- 1. de rekeningen horen bij één bv --- */

  /*
   * De kolom stond in de database en niet in het type. Daarmee kón het scherm
   * niet filteren, ook al wilde het.
   */
  check('de app weet bij welke bv een rekening hoort',
    /administratie\?: string/.test(types.slice(types.indexOf('interface Grootboek'))),
    'Grootboek heeft geen administratie')

  /*
   * Hier stond dat het scherm rekeningenVoor() moest aanroepen. Dat klopte
   * één ronde lang: toen kwam de lijst uit onze eigen kopie en moest het
   * scherm er zelf op filteren. Inmiddels haalt useRekeningen() het schema
   * van die bv op, en is rekeningenVoor() de terugval voor als er geen
   * verbinding is -- getest in groep 83 en 84.
   *
   * Wat hier overblijft is de vraag die niet verandert: krijgt de lijst de bv
   * van DEZE bon mee? Zonder dat is het weer één lijst voor alle
   * administraties, met welk mechanisme dan ook.
   */
  check('en het scherm laat alleen die van deze onderneming zien',
    /* Met of zonder komma erachter: sinds de lijsten in de hook zelf worden
       gelezen heeft de ene aanroep nog maar één argument. */
    (scherm.match(/useRekeningen\(\s*\n?\s*bv[,)]/g) ?? []).length >= 2,
    'niet elke rekeninglijst krijgt de bv van deze bon mee')

  /* Twee lijsten: de rekening van de bon, en die van elke regel van de
     verdeling. Eén ervan goed zetten is de andere laten staan. */
  check('ook bij de regels van een verdeling',
    /opties=\{rekeningOpties\}/.test(scherm),
    'de verdeling toont nog rekeningen van alle bv’s')

  /*
   * Welke bv het is, is dezelfde vraag als bon_administratie() in de database
   * beantwoordt (0079). Twee plekken die hetzelfde moeten zeggen.
   */
  check('en de bv wordt op dezelfde volgorde bepaald als in de database',
    boeking.includes('export function bvVanBon(')
    && /opDeBon[\s\S]{0,400}viaVestiging[\s\S]{0,200}hoofd/.test(boeking),
    'bvVanBon volgt niet bon → vestiging → hoofdadministratie')

  /* Een lege lijst hoort te zeggen dat het aan DEZE bv ligt; anders zoek je
     naar iets wat er voor een andere administratie wel is. */
  check('een lege lijst noemt de onderneming',
    /Exact kent voor onderneming/.test(scherm),
    'de lege lijst zegt niet dat het aan deze bv ligt')

  /* --- 2. het dagboek en de btw vraag je niet meer --- */

  /*
   * 0089 haalt ze al bij Exact op, per bv en per crediteur. De blokkadelijst
   * bleef intussen vragen of ze waren INGESTELD -- werk dat niemand hoeft te
   * doen, twintig bv's lang.
   */
  check('een ontbrekend dagboek blokkeert niet meer',
    !/'inkoopdagboek'/.test(m92) && !/'btw-code'/.test(m92),
    'bon_niet_boekbaar vraagt nog om een ingesteld dagboek of btw-code')

  /* En geen code meer lenen van een andere administratie: dagboek 70 bestaat
     niet in elke bv, en waar het bestaat kan het iets anders zijn. */
  check('en er wordt geen code van een andere bv geleend',
    !/exact_dagboek'/.test(m92) && !/exact_btw_21'/.test(m92),
    'bv_boekinstelling valt nog terug op de globale sleutel')

  /* --- 3. en de verdeling past in zijn eigen vak --- */

  check('de gegevenskolom mag meegroeien',
    /grid-template-columns: minmax\(420px, 900px\) minmax\(0, 1fr\)/.test(systeem),
    'de kolom staat nog op een vaste 420px')

  /*
   * De kern van de overloop: een VENSTER-mediaquery die een vak van 420px
   * bestuurt. @container meet het vak zelf.
   */
  check('en de verdeling meet zijn eigen vak, niet het venster',
    systeem.includes('container-type: inline-size')
    && /@container \(max-width: 760px\)/.test(thema),
    'de verdeling hangt nog alleen aan de vensterbreedte')

  check('en kan krimpen in plaats van zijn kaart uit te duwen',
    /\.verdeling \{[^}]*min-width: 0/.test(thema),
    'het raster mag niet krimpen en loopt dus over')
}

/* ==================================================================== *
 *  82. Vijf kleine dingen aan het factuurscherm
 *
 *  Casper, na een middag ermee werken: een zoekbalkje bij de
 *  grootboekrekening en de onderneming, de tijdlijn hoort in de historie en
 *  niet ook bovenaan, "gelezen door" en "bron" mogen weg, en de knop "sluit"
 *  bij de verdeling doet niks.
 *
 *  Die laatste was geen knop maar een status: de bedragen SLUITEN. Dat het
 *  als knop gelezen werd is geen vergissing van de lezer -- het is een groen
 *  pilletje naast een regel tekst, en "sluit" is ook een gebiedende wijs.
 *
 *  En er zat een zesde onder. Het schema per bv werd nergens overgenomen,
 *  want grootboek_overnemen() uit 0086 had geen knop. Alle rekeningen stonden
 *  dus zonder bv, en die "gelden overal" -- het filter uit de vorige ronde
 *  deed zijn werk en had niets om op te filteren.
 * ==================================================================== */

console.log('\n82. Vijf kleine dingen aan het factuurscherm')

{
  const { readFileSync } = await import('node:fs')
  const kiezer = readFileSync('src/components/ui/kiezer.tsx', 'utf8')
  const ui = readFileSync('src/components/ui/index.tsx', 'utf8')
  const scherm = readFileSync('src/dashboards/administratie/Kostenposten.tsx', 'utf8')
  const naarExact = readFileSync('src/dashboards/administratie/NaarExact.tsx', 'utf8')
  const thema = readFileSync('src/styles/theme.css', 'utf8')

  /* --- 1. zoeken in een lange lijst --- */

  check('er is één kiezer met een zoekveld',
    kiezer.includes('export function Kiezer(') && ui.includes("export * from './kiezer'"),
    'de kiezer bestaat niet of komt niet uit ./ui')

  /* Drie plekken: de rekening van de bon, de rekening van elke regel van de
     verdeling, en de onderneming. Eén ervan omzetten laat de andere staan. */
  check('en hij staat op alledrie de plekken',
    (scherm.match(/<Kiezer/g) ?? []).length >= 3,
    'niet elke lange keuzelijst heeft een zoekveld')

  /* Alle woorden moeten voorkomen, in willekeurige volgorde -- "4000 chemie"
     werkt dan net zo goed als "chemie 4000". Zo zoeken mensen. */
  check('zoeken gaat op losse woorden, in willekeurige volgorde',
    /t\.split\(\/\\s\+\/\)\.every/.test(kiezer),
    'de zoekterm wordt in zijn geheel vergeleken')

  /* Het paneel gaat door een portaal naar de body. Zonder dat verdwijnt het
     achter de volgende kaart of wordt het afgeknipt door de verdeling --
     dezelfde reden als bij Dropdown. */
  check('en het paneel wordt niet afgeknipt door de kaart eromheen',
    kiezer.includes('createPortal'),
    'de kiezer rendert binnen zijn kaart')

  /* --- 2. één tijdlijn en niet twee --- */

  check('het overzicht heeft geen eigen tijdlijn meer',
    !/const stappen: \{ wat: string/.test(scherm),
    'de korte tijdlijn staat nog in het Overzicht')

  /* Weg uit het overzicht is niet hetzelfde als weg: ze horen in de historie,
     tussen de opgeslagen gebeurtenissen op hun eigen moment. */
  check('maar staat wel in de historie',
    scherm.includes("soort: 'binnengekomen'") && scherm.includes("soort: 'voorgelezen'")
      && scherm.includes("binnengekomen: 'Binnengekomen per mail'"),
    'het binnenkomen en voorlezen staan nergens meer')

  /* --- 3. twee velden minder --- */

  check('“Bron” en “Gelezen door” staan er niet meer',
    !/label="Bron"/.test(scherm) && !/label="Gelezen door"/.test(scherm),
    'een van de twee velden staat er nog')

  /* --- 4. een status die niet op een knop lijkt --- */

  check('de verdeling meldt “precies” in plaats van “sluit”',
    scherm.includes('<Badge tone="ok" dot>precies</Badge>'),
    '“sluit” staat er nog en leest als een knop')

  /* --- 5. en het schema komt per bv binnen --- */

  /*
   * Hier stonden drie controles op een kaart die het schema per bv liet
   * overnemen. Die kaart is weg, en dat is geen stap terug maar het einde van
   * de tussenstap: bij een factuur komen de rekeningen van Exact zelf, en
   * sinds 0093 deelt factuur_indelen() ook in zonder dat er iets is
   * overgenomen. De kaart liet bij Casper overal 0 zien voor werk dat niet
   * meer hoefde.
   *
   * Wat ervoor in de plaats komt wordt getest in groep 86: dat het indelen
   * tegen exact_grootboek kijkt en dat de trefwoorden bij een code horen.
   * Hier blijft staan dat de kaart echt weg is -- anders komt hij bij een
   * volgende ronde terug omdat niemand meer weet waarom hij verdween.
   */
  check('de kaart die het schema per bv liet overnemen is weg',
    !naarExact.includes('<Schema') && !naarExact.includes('exactGrootboekOvernemen('),
    'de kaart met nullen staat er nog')

  /* --- 6. en de stijl staat erbij --- */

  check('de kiezer heeft stijl',
    thema.includes('.kiezer-paneel') && thema.includes('.kiezer-regel'),
    'de kiezer is niet opgemaakt')

  /* --- 7. en blijft staan terwijl je erin bladert --- */

  /*
   * De eerste versie sloot bij elke scroll. Die regel kwam van Dropdown, waar
   * hij klopt -- daar valt niets te scrollen. Hier zit de lijst zelf vol, en
   * een scroll daarbinnen bubbelt via capture omhoog naar window: je bladert
   * door de rekeningen en het paneel verdwijnt onder je muis.
   */
  check('scrollen in de lijst sluit het paneel niet',
    /if \(paneel\.current\?\.contains\(e\.target as Node\)\) return/.test(kiezer),
    'een scroll in het paneel telt nog als een scroll erbuiten')

  /* Buiten het paneel meeschuiven en niet sluiten: de kaart eronder mag best
     een stukje verschuiven terwijl je kiest. Pas als de knop uit beeld is
     hangt het paneel aan iets wat je niet meer ziet. */
  check('en buiten het paneel schuift het mee in plaats van dicht te klappen',
    kiezer.includes('r.bottom < 0 || r.top > window.innerHeight'),
    'het paneel sluit nog bij elke scroll van de pagina')

  check('en doorscrollen trekt de pagina eronder niet mee',
    /\.kiezer-lijst \{[^}]*overscroll-behavior: contain/.test(thema),
    'onderaan de lijst scrollt de pagina eronder door')
}

/* ==================================================================== *
 *  95. De hele keten in één scherm, en een weigering die je kunt lezen
 *
 *  Casper: "nu moet je nog naar een aparte gaan om hem naar exact te sturen,
 *  boekhouding, maar je moet deze knop eigenlijk bij te verwerken zetten voor
 *  nu, direct erbij, dus eerste goedkeuring (check ai), tweede en dan
 *  verstuur naar exact. Kon hij niet versturen de melding er netjes in
 *  zetten."
 *
 *  Twee dingen.
 *
 *  De werklijst liet zien WAT er moest gebeuren maar je kon het er niet
 *  doen: de enige knoppen waren "Lezen" en "Openen", en versturen zat op een
 *  ander scherm achter één knop die alles tegelijk pakte. Bij dertig
 *  facturen is dat dertig keer heen en terug.
 *
 *  En als Exact een boeking weigerde, stond de reden wel in de database maar
 *  nergens waar je hem zocht: niet bij de factuur, niet in zijn historie, en
 *  op het verzendscherm alleen als getal in een melding die na drie seconden
 *  verdween. De melding zei zelfs "de reden staat hieronder bij de factuur",
 *  en dat was niet waar -- de kaart eronder gaat over ontbrekende gegevens,
 *  niet over weigeringen.
 *
 *  Wat de database ervan doet staat in sqltest 66.
 * ==================================================================== */

console.log('\n95. De hele keten in één scherm')

{
  const { readFileSync } = await import('node:fs')
  const tv = readFileSync('src/dashboards/administratie/TeVerwerken.tsx', 'utf8')
  const ne = readFileSync('src/dashboards/administratie/NaarExact.tsx', 'utf8')
  const kp = readFileSync('src/dashboards/administratie/Kostenposten.tsx', 'utf8')
  const lib = readFileSync('src/lib/trucksupply.ts', 'utf8')
  const fn = readFileSync('supabase/functions/exact/index.ts', 'utf8')
  const m99 = readFileSync(
    'supabase/migrations/0099_een_weigering_die_je_terugvindt.sql', 'utf8')

  /* --- 1. de drie stappen staan in de rij --- */

  check('de werklijst kan zelf goedkeuren',
    tv.includes('expRepo.decide'),
    'goedkeuren kan alleen nog op het andere scherm')

  check('en zelf naar Exact sturen',
    tv.includes('exactStuurFacturen('),
    'versturen kan alleen nog in bulk op Boekhouding')

  /*
   * Eén knop per rij, niet drie. Een factuur heeft altijd precies één
   * volgende stap; drie knoppen naast elkaar laat de lezer kiezen tussen
   * dingen die elkaar uitsluiten.
   */
  check('en laat per factuur één volgende stap zien',
    /if \(stand === 'akkoord' \|\| stand === 'tweede'\)/.test(tv)
      && /if \(stand === 'boeken' \|\| stand === 'geweigerd'\)/.test(tv),
    'de knoppen hangen niet aan de stand van de factuur')

  /*
   * Wie zelf de eerste handtekening zette mag de tweede niet zetten. De
   * database bewaakt dat ook (0060/0096), maar een knop die je mag indrukken
   * en daarna een foutmelding geeft is een slechte knop.
   */
  check('wie zelf tekende kan de tweede niet zetten',
    /bon\.eersteDoor === user\.id/.test(tv),
    'je kunt je eigen tweede handtekening zetten en pas daarna de weigering lezen')

  /* Na het versturen wordt de bon op de SERVER bijgewerkt; zonder een ronde
     synchroniseren lijkt het of de knop niets deed. */
  check('en na het versturen wordt er opnieuw opgehaald',
    /exactStuurFacturen\(bon\.id\)[\s\S]{0,400}scheduleFlush\(0\)/.test(tv),
    'het scherm blijft de oude stand tonen')

  /* --- 2. één factuur kan apart --- */

  check('er kan één losse factuur verstuurd worden',
    /export async function exactStuurFacturen\(id\?: string\)/.test(lib)
      && fn.includes('const alleen = typeof body.id'),
    'versturen pakt nog altijd alles of niets')

  /*
   * En bij een losse bon geen bovengrens van 25, en geen stilzwijgen als hij
   * niet compleet is: "er gebeurde niets" is het slechtste antwoord op een
   * knop die je net indrukte.
   */
  check('en zegt waarom als dat niet kan',
    /Deze factuur kan nog niet geboekt worden/.test(fn),
    'een losse bon die niet weg kan levert een stille niets-gebeurt op')

  check('zonder de bovengrens van 25 die voor de stapel geldt',
    /alleen \? meedoen : meedoen\.slice\(0, 25\)/.test(fn),
    'de bovengrens van de stapel geldt ook voor één factuur')

  /* --- 3. de weigering is te lezen --- */

  check('de weigering staat bij de factuur zelf',
    /!bon\.exactId && bon\.exactFout/.test(kp),
    'de reden staat nergens op het scherm van de factuur')

  check('en in zijn historie',
    m99.includes("'exact_weigerde'") && m99.includes('expense_exact_fout_schrijf'),
    'een mislukte boeking laat geen spoor na in de historie')

  /*
   * En hij gaat weer weg. Hiervoor bleef een gerepareerde bon in het vak
   * "Exact weigert" staan met een reden die niet meer gold.
   */
  check('en verdwijnt als je oplost waar hij over ging',
    m99.includes('expense_exact_fout_opruimen'),
    'een opgeloste weigering blijft staan')

  /* --- 4. en het verzendscherm telt hem niet meer mee --- */

  check('een vastgelopen factuur telt niet als klaar om te versturen',
    /const klaar = alles\.filter\(\(b\) => b\.mist\.length === 0 && !b\.fout\)/.test(ne),
    'een geweigerde factuur gaat elke ronde opnieuw mee en loopt opnieuw vast')

  check('maar staat wel apart, met de reden erbij',
    ne.includes('Vastgelopen bij Exact') && /\{b\.fout\}/.test(ne),
    'de reden staat nergens op het verzendscherm')

  check('en kan er los opnieuw heen',
    ne.includes('stuurEen('),
    'alleen de hele stapel kan opnieuw')

  /*
   * En nee zeggen kan vanaf dezelfde regel als ja.
   *
   * Casper, nadat goedkeuren naar de werklijst was verhuisd: "ik kan niks
   * meer afkeuren." Afkeuren stond nog op het andere scherm, achter Openen.
   * Daarmee was goedkeuren een klik en afkeuren er drie -- een werklijst die
   * de makkelijke uitkomst makkelijker maakt dan de moeilijke, duwt. Juist
   * bij een factuur die niet deugt hoort de rem net zo dichtbij te zitten
   * als het gaspedaal.
   */
  check('en afkeuren kan vanaf dezelfde regel als goedkeuren',
    /function Afkeuren\(/.test(tv) && /'afgekeurd'/.test(tv),
    'afkeuren kan alleen nog op een ander scherm')

  /* Met een reden, want die komt bij de factuur en in de historie te staan. */
  check('met een reden erbij',
    /Deze komt bij de factuur te staan/.test(tv),
    'afkeuren kan zonder reden')

  /* Maar niet meer als hij al in Exact staat: die boeking is er, en daar is
     een creditnota voor. */
  check('en niet meer zodra hij in Exact staat',
    /if \(bon\.exactId\) return null/.test(tv),
    'een geboekte factuur is met een knop hier af te keuren')

  /* De melding beloofde iets dat er niet stond. Een onjuiste verwijzing is
     erger dan geen verwijzing: je gaat zoeken naar iets dat er niet is. */
  /*
   * De melding beloofde "de reden staat hieronder bij de factuur", en daar
   * stond hij niet. Controleer op de REGEL -- de melding draagt de reden
   * zelf -- en niet op de afwezigheid van die zin: die staat nu in het
   * commentaar dat uitlegt waarom hij weg moest, en daar struikelde deze
   * controle in eerste instantie over.
   */
  check('en de melding draagt de reden zelf',
    /toast\.error\([\s\S]{0,400}eerste\.reden/.test(ne),
    'de melding telt alleen hoeveel er vastliepen')
}
}
