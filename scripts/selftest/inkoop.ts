/**
 * Waar facturen binnenkomen: adressen per onderneming
 *
 * Onderdeel van de zelftest; zie scripts/selftest.ts voor hoe dit draait en
 * waarom het is opgesplitst.
 */

import { api, check, db, eq, zonderCommentaar } from './kern.ts'

export async function groepen() {
/* ==================================================================== *
 *  90. Een adres per onderneming, en een handtekening met een naam erbij
 *
 *  Casper: "De mailadressen moeten niet per vestiging, maar per onderneming,
 *  je moet wel een vestiging kunnen koppelen aan een mailadres. (...) de
 *  tweede goedkeuring moet dan komen te liggen bij een persoon (...)
 *  daarbuiten moet iemand van management altijd het kunnen doen (als iemand
 *  bijvoorbeeld op vakantie is ect) daarbuiten moet je ervoor zorgen dat het
 *  dan op hun todo komt te staan, maar ook in de lijst zoals op de foto van
 *  blue10."
 *
 *  Twee dingen die aan elkaar hangen.
 *
 *  Het adres werd UITGEREKEND uit de website-slug van een vestiging (0044), en
 *  de bv volgde uit die vestiging (0059). Een bv zonder wasstraat -- Vastgoed,
 *  Techniek & Beheer -- had dus geen adres waarop zijn facturen konden
 *  binnenkomen; die moesten op een vestiging landen en daarna met de hand
 *  worden omgezet.
 *
 *  En de tweede handtekening lag bij een GROEP. Werk dat bij een groep ligt,
 *  ligt bij niemand: er staat geen naam bij, het komt op geen enkele
 *  takenlijst, en na drie weken is "wie zou dit doen" niet te beantwoorden.
 * ==================================================================== */

console.log('\n90. Een adres per onderneming, en een handtekening met een naam')

{
  const { readFileSync } = await import('node:fs')
  const m95 = readFileSync(
    'supabase/migrations/0095_een_inkoopadres_per_onderneming.sql', 'utf8')
  const m96 = readFileSync(
    'supabase/migrations/0096_de_tweede_handtekening_ligt_bij_iemand.sql', 'utf8')
  const post = readFileSync('supabase/functions/ontvang-mail/index.ts', 'utf8')
  const scherm = readFileSync('src/dashboards/administratie/Inkoopadressen.tsx', 'utf8')
  const lijst = readFileSync('src/dashboards/administratie/OpHandtekening.tsx', 'utf8')
  const dash = readFileSync('src/dashboards/administratie/AdministratieDashboard.tsx', 'utf8')

  /* --- 1. het adres is een afspraak, geen berekening --- */

  check('een inkoopadres is een eigen rij',
    m95.includes('create table if not exists public.inkoop_adres'),
    'het adres wordt nog steeds uitgerekend')

  /* De bv is verplicht: een adres zonder administratie is een stapel die
     nergens heen kan. De vestiging niet, want een holding heeft er geen. */
  check('met de onderneming verplicht en de vestiging niet',
    /administratie text not null/.test(m95)
      && /location_id   text references public\.locations\(id\)/.test(m95),
    'de bv is niet verplicht, of de vestiging juist wel')

  /*
   * De adressen die al zijn uitgedeeld staan bij leveranciers in het
   * adresboek. Die horen te blijven werken, dus komen ze mee als rij.
   */
  check('en wat er al was komt mee',
    /insert into public\.inkoop_adres[\s\S]{0,600}from public\.locations l/.test(m95),
    'de bestaande adressen worden niet overgenomen')

  check('de post zoekt het adres op',
    post.includes('welkInkoopadres') && post.includes('inkoop_adres_van'),
    'de post rekent de vestiging nog steeds uit')

  /* En valt terug op de oude weg. Een adres dat nog geen rij heeft hoort niet
     ineens nergens meer aan te komen. */
  check('en valt terug op de oude weg als hij het adres niet kent',
    /adres\?\.locationId \?\? await welkeVestiging\(aan\.adres\)/.test(post),
    'een onbekend adres levert geen vestiging meer op')

  /* De bv van het adres gaat mee, met een eigen bron: sterker dan een naam
     die erop lijkt, zwakker dan een KvK-nummer op het stuk. */
  check('de bv van het adres komt op de bon',
    /administratie_bron: 'adres'/.test(post) && m95.includes("'adres'"),
    'de onderneming van het adres wordt niet meegegeven')

  /* --- 2. de tweede handtekening ligt bij iemand --- */

  check('de goedkeurder staat op de bon',
    m95.includes('add column if not exists goedkeurder'),
    'er is geen veld voor wie moet tekenen')

  /*
   * Op de BON en niet alleen op het adres. Een adres kan van eigenaar
   * wisselen; een factuur van vorige maand hoort dan niet ineens bij iemand
   * anders te liggen.
   */
  check('en wordt bij het binnenkomen losgetrokken van het adres',
    /goedkeurder: adres\?\.goedkeurder/.test(post)
      && /goedkeurder_naam: adres\?\.goedkeurderNaam/.test(post),
    'de goedkeurder wordt niet op de bon vastgelegd')

  check('en alleen hij of het management mag tekenen',
    m96.includes('create or replace function public.mag_tweede_handtekening'),
    'iedereen die over kosten beslist kan nog tekenen')

  /* Het management mag altijd. Zonder dat is een vakantie genoeg om de hele
     stapel stil te zetten -- precies wat Casper erbij zei. */
  check('en het management kan er altijd bij',
    /public\.is_management\(\)/.test(m96)
      && /new\.goedkeurder <> public\.my_id\(\)[\s\S]{0,80}not public\.is_management/.test(m96),
    'het management kan niet invallen als iemand er niet is')

  /* Dit staat in de database en niet in het scherm, om dezelfde reden als in
     0060: de app praat rechtstreeks met de database. */
  check('en dat wordt in de database bewaakt, niet in het scherm',
    /raise exception 'Deze factuur ligt bij %/.test(m96),
    'de regel staat alleen in het scherm')

  /* --- 3. op de todo en in de lijst --- */

  check('het komt op iemands takenlijst',
    m96.includes('taak_bon2_') && m96.includes("bron, bron_id"),
    'er wordt geen taak gemaakt')

  /* En hij gaat er weer af. Een takenlijst die alleen groeit is een
     takenlijst die niemand meer opent. */
  check('en gaat er weer af als het getekend is',
    /set status = 'klaar'[\s\S]{0,400}where id = 'taak_bon2_'/.test(m96),
    'de taak blijft staan nadat er getekend is')

  /* Ligt hij bij niemand, dan naar de rol -- werk hoort in ieder geval ergens
     te STAAN. */
  check('ligt hij bij niemand, dan naar de administratie',
    /when wie is null then 'administratie'/.test(m96),
    'een factuur zonder goedkeurder komt nergens terecht')

  check('en er is een lijst van wat bij wie ligt',
    m96.includes('create or replace function public.facturen_op_handtekening')
      && lijst.includes('facturenOpHandtekening'),
    'er is geen lijst zoals die van Blue10')

  /*
   * Hoeveel dagen het er ligt is de kolom waar het om begonnen is. Een
   * factuur van vier maanden ziet er in een gewone lijst hetzelfde uit als
   * een van gisteren, en blijft daarom vier maanden liggen.
   */
  check('met hoeveel dagen hij er al ligt',
    m96.includes('dagen') && lijst.includes('r.dagen'),
    'je ziet niet hoe lang iets er ligt')

  /* --- 4. en het staat op het scherm --- */

  check('de adressen zijn te beheren',
    scherm.includes('export default function Inkoopadressen(')
      && dash.includes('<Inkoopadressen />'),
    'er is geen scherm om een adres in te stellen')

  check('en de lijst staat bovenaan bij Boekhouding',
    dash.includes('<OpHandtekening />'),
    'de lijst staat nergens')

  /* Twee lijsten met adressen op één scherm is er één te veel. */
  check('de oude, berekende adressenlijst staat er niet meer naast',
    /adressen=\{false\}/.test(dash),
    'de berekende adressen staan er nog naast')

  /* Een bv zonder adres kan geen facturen ontvangen. Dat hoort te blijken
     voordat er een maand niets binnenkomt. */
  check('en een bv zonder adres wordt gemeld',
    scherm.includes('nog geen adres'),
    'een onderneming zonder adres blijft onopgemerkt')
}

/* ==================================================================== *
 *  91. De adressen maken zichzelf
 *
 *  Casper: "Zorg ervoor dat je de adressen automatisch aanmaakt (...) Bekijk
 *  alles, en maak alles zo automatisch mogelijk aub."
 *
 *  0095 maakte van een BEREKENING een lijst, en dat is goed -- maar daarmee
 *  werd het aanmaken handwerk. Een berekening vervangen door een lijst is
 *  alleen winst als die lijst zichzelf vult.
 *
 *  Wat er uit die namen komt staat in sqltest 64: daar draait de functie echt,
 *  tegen een opstelling die op zijn administratie lijkt. Hier staat wat er
 *  omheen moet kloppen.
 * ==================================================================== */

console.log('\n91. De adressen maken zichzelf')

{
  const { readFileSync } = await import('node:fs')
  const m97 = readFileSync(
    'supabase/migrations/0097_de_adressen_maken_zichzelf.sql', 'utf8')
  const scherm = readFileSync('src/dashboards/administratie/Inkoopadressen.tsx', 'utf8')

  check('er is een functie die de gaten vult',
    m97.includes('create or replace function public.inkoop_adressen_aanvullen'),
    'adressen moeten nog met de hand worden aangemaakt')

  /* Vanzelf betekent: ook morgen. Een functie die één keer door een migratie
     is aangeroepen is geen automaat maar een eenmalige actie. */
  check('en hij draait vanzelf bij een nieuwe vestiging of bv',
    /create trigger locations_inkoop_adres/.test(m97)
      && /create trigger exact_administratie_inkoop_adres/.test(m97),
    'nieuwe vestigingen en bv-en krijgen niet vanzelf een adres')

  /* Op het domein dat er al stond: dat is bij Resend ingesteld, en een ander
     domein betekent dat er niets aankomt. */
  check('op het domein uit de instellingen',
    /where sleutel = 'inkoop_domein'/.test(m97),
    'het domein wordt niet uit de instellingen gehaald')

  /*
   * Zonder domein niets doen, en vooral niet omvallen: dit draait vanuit een
   * trigger, en een vestiging die niet opgeslagen kan worden omdat er een
   * instelling leeg staat is erger dan een vestiging zonder adres.
   */
  check('en zonder domein gebeurt er niets, zonder fout',
    /if domein is null then\s*\n\s*return query select 0, 0;/.test(m97),
    'zonder domein gaat er iets stuk')

  check('een vestiging krijgt de plaatsnaam',
    /public\.inkoop_slug\(l\.website_slug\),\s*\n\s*public\.inkoop_slug\(l\.city\)/.test(m97),
    'de plaatsnaam wordt niet gebruikt')

  /*
   * Het gedeelde woord wordt geteld en niet geraden. Een lijst met
   * "truckwash" erin zou een vaste aanname zijn over wiens administratie dit
   * is; bij een ander bedrijf werkt het dan niet.
   */
  check('en een bv een korte naam, zonder het woord dat ze allemaal delen',
    m97.includes('inkoop_bv_slug') && /hoeveel \* 2 > totaal/.test(m97),
    'het gedeelde woord staat als vaste lijst in de code')

  /* Alleen gaten vullen. Wie een adres hernoemt naar inkoop.td@ hoort dat de
     volgende ronde nog terug te zien. */
  check('wat er staat blijft staan',
    /not exists \(select 1 from public\.inkoop_adres ia where ia\.location_id = l\.id\)/.test(m97),
    'bestaande adressen worden overschreven')

  check('en er is een knop voor wie niet wil wachten',
    scherm.includes('inkoopAdressenAanvullen()') && scherm.includes('Aanvullen'),
    'aanvullen kan alleen door iets anders te wijzigen')
}

/* ==================================================================== *
 *  92. Een vestiging hoort bij de bv die zo heet
 *
 *  Casper, bij een scherm met acht adressen en een rode melding dat zeventien
 *  ondernemingen er geen hebben: "? waarom dit dan".
 *
 *  Het antwoord: 0097 zocht de bv bij een vestiging op als
 *  coalesce(vestiging.administratie, hoofdadministratie), en bij hem staat
 *  die eerste leeg. Dus ging inkoop.venlo@ naar de holding, bleef Truckwash 1
 *  Venlo B.V. zonder adres, en maakte de tweede ronde er inkoop.venlo2@ van.
 *
 *  Wat de functies DOEN staat in sqltest 65 -- daar draaien ze echt, tegen
 *  een opstelling die op zijn administratie lijkt. Hier staat wat er omheen
 *  moet kloppen.
 * ==================================================================== */

console.log('\n92. Een vestiging hoort bij de bv die zo heet')

{
  const { readFileSync } = await import('node:fs')
  const m98 = readFileSync(
    'supabase/migrations/0098_een_vestiging_hoort_bij_de_bv_die_zo_heet.sql', 'utf8')
  const m97 = readFileSync(
    'supabase/migrations/0097_de_adressen_maken_zichzelf.sql', 'utf8')
  const scherm = readFileSync('src/dashboards/administratie/Inkoopadressen.tsx', 'utf8')
  const lib = readFileSync('src/lib/trucksupply.ts', 'utf8')

  check('een vestiging zoekt zijn eigen bv op de naam',
    m98.includes('create or replace function public.bv_van_vestiging'),
    'de bv van een vestiging valt nog terug op de hoofdadministratie')

  /*
   * Op hele woorden. Een like op een stuk tekst laat Elsloo bij elke bv met
   * "els" erin horen, en een verkeerde koppeling is hier erger dan geen: dan
   * boekt elke factuur van die vestiging een jaar lang in de verkeerde bv.
   */
  check('op hele woorden en niet op een stuk tekst',
    /regexp_split_to_array\(public\.kaal_bedrijf\(a\.naam\), '.s\+'\)/.test(m98),
    'de naam wordt met een like vergeleken')

  /* Twee kandidaten is geen antwoord. Liever niets dan de verkeerde. */
  check('en bij twijfel gebeurt er niets',
    /array_length\(codes, 1\) = 1/.test(m98),
    'bij meer dan een bv wordt er alsnog een gekozen')

  /*
   * Dezelfde vraag ligt onder bon_administratie(). Het antwoord hoort dus bij
   * de vestiging te landen, anders klopt de post wel en de bon niet.
   */
  check('en het antwoord landt bij de vestiging zelf',
    m98.includes('create or replace function public.vestigingen_bv_aanvullen')
      && /update public\.locations/.test(m98),
    'alleen het adres wordt rechtgezet, de bon boekt nog in de verkeerde bv')

  /* Maar alleen waar het leeg staat: een keuze van een mens blijft staan. */
  check('alleen waar het leeg staat',
    /coalesce\(trim\(l\.administratie\), ''\) = ''/.test(m98),
    'een ingestelde administratie wordt overschreven')

  /*
   * Deze functie wijzigt locations, en er hangt een trigger op locations die
   * hem aanroept. Zonder rem roept dat zichzelf eeuwig aan -- een UPDATE die
   * nul rijen raakt vuurt de trigger namelijk gewoon af.
   */
  check('en hij roept zichzelf niet eeuwig aan',
    /if not exists \([\s\S]{0,240}then\s*\n\s*return 0;/.test(m98),
    'de trigger kan zichzelf blijven aanroepen')

  /*
   * Een cijfer achter een adres is de laatste uitweg. inkoop.maasvlakte@ en
   * inkoop.maasvlakte2@ die naar verschillende vennootschappen leiden is een
   * valstrik voor elke leverancier die het cijfer vergeet.
   */
  check('een tweede naam komt voor een cijfer',
    m98.includes('inkoop_vrij_adres')
      && /public\.inkoop_bv_slug\(a\.code, false\)/.test(m98),
    'bij een bezette naam komt er meteen een cijfer achter')

  /* Wat 0097 verkeerd neerzette hoort rechtgezet te worden; anders moet hij
     twintig rijen met de hand omzetten. */
  check('en wat er verkeerd staat wordt rechtgezet',
    /update public\.inkoop_adres[\s\S]{0,400}set administratie = juist\.bv/.test(m98),
    'de adressen die op de holding staan blijven daar staan')

  /* Maar niet wat iemand zelf heeft gezet: dat is te herkennen aan de
     omschrijving die de automaat er zelf bij schrijft. */
  check('behalve wat iemand zelf heeft gezet',
    /omschrijving like 'Vanzelf aangemaakt%'/.test(m98),
    'ook adressen die met de hand zijn omgezet worden overruled')

  /* Een adres waar al post op binnenkwam gaat nooit weg. */
  check('en een adres waar al een bon aan hangt gaat nooit weg',
    /not exists \(select 1 from public\.expenses e where e\.inkoop_adres_id = ia\.id\)/.test(m98),
    'een gebruikt adres kan worden opgeruimd')

  /*
   * 0097 krijgt er een kolom bij. "create or replace" mag de vorm van het
   * antwoord niet veranderen, dus moet 0097 zijn eigen functie eerst weghalen
   * -- anders loopt een tweede ronde door alle migraties vast.
   */
  check('en alle migraties mogen nog een tweede keer',
    /drop function if exists public\.inkoop_adressen_aanvullen\(\);/.test(m97),
    'opnieuw draaien loopt vast op de gewijzigde retourvorm')

  /* --- en het scherm zegt wat er misging --- */

  check('wat niet lukte komt terug in gewone taal',
    /returns table \(gemaakt integer, overgeslagen integer, waarom text\[\]\)/.test(m98)
      && lib.includes('waarom: string[]'),
    'het scherm krijgt alleen een getal terug')

  check('en staat op het scherm',
    scherm.includes('redenen') && /redenen\.map/.test(scherm),
    'de reden blijft in de database hangen')
}
}
