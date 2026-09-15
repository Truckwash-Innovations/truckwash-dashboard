-- ===========================================================================
--  Een vestiging hoort bij de bv die zo heet
--
--  Casper, bij een scherm met acht adressen en een rode melding dat zeventien
--  ondernemingen er geen hebben: "? waarom dit dan".
--
--  Wat er gebeurde
--  ---------------
--
--  0097 maakte per vestiging een adres op de plaatsnaam, en zocht de bv erbij
--  zo:
--
--      coalesce(vestiging.administratie, de hoofdadministratie)
--
--  Bij Casper staat locations.administratie leeg. Dus kwam elk adres --
--  inkoop.venlo@, inkoop.utrecht@, inkoop.roosendaal@ -- op de
--  HOOFDADMINISTRATIE te staan. En Truckwash 1 Venlo B.V. zelf had daarmee
--  nog steeds geen adres, want dat van Venlo was van de holding.
--
--  Daarna liep de tweede ronde ("elke bv die nog nergens post kan
--  ontvangen") langs diezelfde bv's, wilde inkoop.venlo@ maken, vond die
--  bezet, en maakte er inkoop.venlo2@ van. Een adres dat niemand ooit gaat
--  gebruiken, voor een bv die het adres zonder cijfer had horen te hebben.
--
--  Nagespeeld tegen een echte Postgres met zijn opstelling: 43 adressen, 19
--  daarvan op de holding, 17 met een cijfer erachter. De melding op zijn
--  scherm was dus geen foutje in de telling -- de telling was het enige dat
--  klopte.
--
--  Waarom die terugval er stond
--  ----------------------------
--
--  Omdat bon_administratie() (0059/0079) hem ook heeft: een bon zonder bv
--  gaat naar het hoofd. Dat is voor een BON verdedigbaar -- een bon moet
--  ergens landen. Voor een ADRES is het dat niet: een adres is geen noodweg
--  maar een afspraak, en een verkeerde afspraak boekt elke maand opnieuw de
--  kosten van Venlo in de holding.
--
--  Wat het wordt
--  -------------
--
--  De bv wordt bij de vestiging gezocht op de naam. "Truckwash 1 Venlo B.V."
--  hoort bij de vestiging in Venlo, en dat is niet geraden: het is de enige
--  actieve bv met dat woord in de naam. Is er geen of is er meer dan een, dan
--  gebeurt er niets en zegt de functie waarom -- liever geen koppeling dan de
--  verkeerde.
--
--  En omdat dezelfde vraag ("in welke bv hoort deze vestiging") ook onder
--  bon_administratie() ligt, wordt het antwoord meteen in
--  locations.administratie gezet waar dat leeg staat. Dan boekt niet alleen
--  de post maar ook de bon in de goede bv.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Welke bv heet naar deze vestiging
--
--  Twee eisen, en allebei om dezelfde reden: dit mag nooit een gok zijn.
--
--    het woord moet er helemaal in staan   "venlo" in "truckwash 1 venlo",
--                                          niet "elslo" in "elsloo".
--
--    en er mag er maar een zijn            twee bv's met "maasvlakte" erin
--                                          (de vestiging en de holding
--                                          erboven) is geen antwoord.
--
--  Op die tweede eis zit een uitzondering die precies zo'n geval oplost:
--  heet er een bv op het woord EINDIGT en de ander niet, dan is die eerste
--  het. "Truckwash 1 Maasvlakte" is de vestiging; "Truckwash 1 Maasvlakte
--  Holding" is wat erboven hangt.
-- ---------------------------------------------------------------------------

create or replace function public.bv_van_vestiging(loc text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  plaats  text;
  codes   text[];
begin
  /* De plaats zoals wij hem noemen. De website-slug eerst: die IS de
     plaatsnaam en is al uniek (0097 gebruikt hem voor het adres zelf). */
  select coalesce(
           public.inkoop_slug(l.website_slug),
           public.inkoop_slug(l.city))
    into plaats
    from public.locations l where l.id = loc;

  if coalesce(plaats, '') = '' or length(plaats) < 3 then
    return null;
  end if;

  /* Elke actieve bv met dat woord er los in. Op woorden en niet op een
     losse like: anders hoort Elsloo bij elke bv met "els" erin. */
  select array_agg(a.code order by a.code) into codes
    from public.exact_administratie a
   where a.actief
     and exists (
       select 1 from unnest(
         regexp_split_to_array(public.kaal_bedrijf(a.naam), '\s+')) w
        where public.inkoop_slug(w) = plaats);

  if codes is null then return null; end if;
  if array_length(codes, 1) = 1 then return codes[1]; end if;

  /* Meer dan een. Dan telt alleen de bv die ER OP EINDIGT -- en alleen als
     dat er precies een is. */
  select array_agg(a.code order by a.code) into codes
    from public.exact_administratie a
   where a.code = any(codes)
     and public.inkoop_slug(
           (regexp_split_to_array(public.kaal_bedrijf(a.naam), '\s+'))[
             array_length(regexp_split_to_array(public.kaal_bedrijf(a.naam), '\s+'), 1)]
         ) = plaats;

  if codes is not null and array_length(codes, 1) = 1 then return codes[1]; end if;
  return null;
end $$;

comment on function public.bv_van_vestiging(text) is
  'In welke bv deze vestiging hoort, gezocht op de naam (0098): de enige '
  'actieve bv met de plaatsnaam als los woord erin. Geen of meer dan een: '
  'null, want dan is het een gok.';

revoke execute on function public.bv_van_vestiging(text) from public, anon;
grant  execute on function public.bv_van_vestiging(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  2. En dat meteen invullen waar het leeg staat
--
--  Alleen waar het leeg staat. Wat iemand zelf heeft gekozen blijft staan,
--  ook als deze functie er iets anders van vindt -- die mens weet iets wat
--  een naam niet vertelt.
-- ---------------------------------------------------------------------------

create or replace function public.vestigingen_bv_aanvullen()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
begin
  /*
   * Eerst kijken of er iets te doen valt, en pas dan wijzigen.
   *
   * Dit hangt onder een trigger op locations die ook op administratie
   * afgaat. Een UPDATE die nul rijen raakt vuurt die trigger nog steeds af,
   * en dan roept hij zichzelf eeuwig aan. Met deze vraag ervoor stopt het na
   * een ronde: de tweede vindt niets meer en doet dus ook geen UPDATE.
   */
  if not exists (
    select 1 from public.locations l
     where l.active
       and coalesce(trim(l.administratie), '') = ''
       and public.bv_van_vestiging(l.id) is not null)
  then
    return 0;
  end if;

  with wel as (
    select l.id, public.bv_van_vestiging(l.id) as bv
      from public.locations l
     where l.active
       and coalesce(trim(l.administratie), '') = ''
  )
  update public.locations l
     set administratie = wel.bv,
         updated_at = public.now_ms()
    from wel
   where wel.id = l.id and wel.bv is not null;

  get diagnostics n = row_count;
  return n;
end $$;

comment on function public.vestigingen_bv_aanvullen() is
  'Zet bij elke vestiging zonder administratie de bv die naar die plaats '
  'heet (0098). Raakt een ingevulde administratie niet aan.';

revoke execute on function public.vestigingen_bv_aanvullen() from public, anon;
grant  execute on function public.vestigingen_bv_aanvullen() to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  3. Een tweede naam voordat er een cijfer achter komt
--
--  0097 plakte er bij een bezette naam meteen een cijfer achter. Zo werd
--  Truckwash 1 Maasvlakte Holding inkoop.maasvlakte2@, naast de
--  inkoop.maasvlakte@ van de vestiging.
--
--  Dat is niet alleen lelijk, het is gevaarlijk: twee adressen die een teken
--  schelen en naar verschillende bv's leiden. Een leverancier die het cijfer
--  vergeet boekt in de verkeerde vennootschap, en niemand ziet dat.
--
--  Dus eerst de langere naam proberen -- maasvlakteholding -- en pas als ook
--  die bezet is een cijfer. Een cijfer is de laatste uitweg en niet de
--  eerste.
-- ---------------------------------------------------------------------------

create or replace function public.inkoop_bv_slug(bv text, kort boolean)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  kaal    text;
  woorden text[];
  gedeeld text;
  totaal  integer;
  hoeveel integer;
  w       text;
  uit     text := '';
begin
  select public.kaal_bedrijf(a.naam) into kaal
    from public.exact_administratie a where a.code = bv;
  if coalesce(kaal, '') = '' then return null; end if;

  woorden := regexp_split_to_array(trim(kaal), '\s+');
  gedeeld := woorden[1];

  select count(*) into totaal from public.exact_administratie where actief;
  select count(*) into hoeveel
    from public.exact_administratie a
   where a.actief
     and public.kaal_bedrijf(a.naam) like gedeeld || ' %';

  /* Begint meer dan de helft er zo aan, dan zegt dat woord niets over WELKE
     bv dit is en gaat het eraf. Bij twee bv's is "meer dan de helft" al snel
     waar, vandaar de ondergrens van drie -- onder dat aantal is het geen
     patroon maar toeval. */
  if totaal >= 3 and hoeveel * 2 > totaal and array_length(woorden, 1) > 1 then
    woorden := woorden[2:array_length(woorden, 1)];
  end if;

  /* De woorden die iets zeggen. Een los cijfer ("Truckwash 1 Group")
     onderscheidt niets, dus dat telt niet mee. */
  foreach w in array woorden loop
    if w !~ '^[0-9]+$' and length(w) > 1 then
      if kort then return public.inkoop_slug(w); end if;
      uit := uit || w;
    end if;
  end loop;

  if uit <> '' then return public.inkoop_slug(uit); end if;
  return public.inkoop_slug(array_to_string(woorden, ''));
end $$;

comment on function public.inkoop_bv_slug(text, boolean) is
  'De naam van een bv zoals hij in een mailadres past (0098): kort is het '
  'eerste woord dat iets zegt (vastgoed), lang is alles wat iets zegt aan '
  'elkaar (maasvlakteholding) -- die tweede is er voor als de korte bezet is.';

revoke execute on function public.inkoop_bv_slug(text, boolean) from public, anon;
grant  execute on function public.inkoop_bv_slug(text, boolean) to authenticated, service_role;

/* De oude naam blijft werken en betekent nog steeds "de korte". */
create or replace function public.inkoop_bv_slug(bv text)
returns text
language sql stable security definer set search_path = public as $$
  select public.inkoop_bv_slug(bv, true);
$$;

revoke execute on function public.inkoop_bv_slug(text) from public, anon;
grant  execute on function public.inkoop_bv_slug(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  4. Het eerste adres uit een rijtje dat nog vrij is
--
--  Stond twee keer bijna hetzelfde in 0097, een keer voor vestigingen en een
--  keer voor bv's. Een keer opschrijven, en dan is het ook op een plek te
--  veranderen.
-- ---------------------------------------------------------------------------

create or replace function public.inkoop_vrij_adres(
  namen text[], voorvoegsel text, domein text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  naam     text;
  volledig text;
  poging   integer;
begin
  /* Eerst de echte namen: de plaats, of de korte en dan de lange naam van de
     bv. */
  foreach naam in array coalesce(namen, '{}'::text[]) loop
    if coalesce(naam, '') = '' then continue; end if;
    volledig := lower(voorvoegsel || '.' || naam || '@' || domein);
    if not exists (
      select 1 from public.inkoop_adres ia where lower(ia.adres) = volledig)
    then
      return volledig;
    end if;
  end loop;

  /* En pas dan een cijfer achter de eerste. Tien naamgenoten is geen
     naamgenoot meer maar iets anders; dan liever niets dan inkoop.venlo11@. */
  if coalesce(namen[1], '') = '' then return null; end if;
  for poging in 2..10 loop
    volledig := lower(voorvoegsel || '.' || namen[1] || poging::text || '@' || domein);
    if not exists (
      select 1 from public.inkoop_adres ia where lower(ia.adres) = volledig)
    then
      return volledig;
    end if;
  end loop;

  return null;
end $$;

comment on function public.inkoop_vrij_adres(text[], text, text) is
  'Het eerste adres uit dit rijtje namen dat nog vrij is (0098), en anders '
  'de eerste naam met een cijfer erachter. Null als het er tien bezet zijn.';

revoke execute on function public.inkoop_vrij_adres(text[], text, text) from public, anon;
grant  execute on function public.inkoop_vrij_adres(text[], text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  5. Het aanvullen zelf, nu met een reden erbij
--
--  "Overgeslagen: 17" is een getal waar je niets mee kunt. Wat er ontbrak
--  hoort erbij te staan, anders is de enige weg vooruit het opnieuw proberen
--  en hopen -- en dat is precies wat Casper deed.
-- ---------------------------------------------------------------------------

drop function if exists public.inkoop_adressen_aanvullen();

create or replace function public.inkoop_adressen_aanvullen()
returns table (gemaakt integer, overgeslagen integer, waarom text[])
language plpgsql security definer set search_path = public as $$
declare
  domein      text;
  voorvoegsel text;
  hoofd       text;
  r           record;
  volledig    text;   -- niet 'adres': dat is ook een kolomnaam, en dan
                      -- kan PL/pgSQL niet kiezen (42702).
  n           integer := 0;
  over        integer := 0;
  redenen     text[] := '{}';
begin
  select nullif(trim(waarde), '') into domein
    from public.instellingen where sleutel = 'inkoop_domein';
  select coalesce(nullif(trim(waarde), ''), 'inkoop') into voorvoegsel
    from public.instellingen where sleutel = 'inkoop_voorvoegsel';
  voorvoegsel := coalesce(voorvoegsel, 'inkoop');

  /* Zonder domein valt er geen adres te maken. Stil terug: dit draait ook
     vanuit een trigger, en daar hoort geen fout uit te komen omdat er een
     instelling leeg staat. Wel zeggen waarom. */
  if domein is null then
    return query select 0, 0, array[
      'Er staat geen domein bij de instelling inkoop_domein. Zonder domein '
      'is er geen adres te maken.']::text[];
    return;
  end if;

  /*
   * Eerst de vestigingen aan hun eigen bv hangen; daarna pas de adressen.
   * Andersom kwam inkoop.venlo@ op de holding te staan (0098).
   *
   * Die wijziging vuurt de trigger op locations af, en die zou hier dwars
   * doorheen precies hetzelfde gaan doen. Niet stuk, wel verwarrend: de
   * trigger maakt dan de adressen, deze functie vindt niets meer te doen en
   * meldt "0 aangemaakt" terwijl het scherm er twintig bij krijgt. Met dit
   * vlaggetje houdt de trigger zich stil zolang wij bezig zijn; het staat
   * alleen in deze transactie en verdwijnt vanzelf.
   */
  perform set_config('inkoop.bezig', '1', true);
  perform public.vestigingen_bv_aanvullen();

  select a.code into hoofd from public.exact_administratie a where a.hoofd limit 1;

  /* --- per vestiging --- */
  for r in
    select l.id,
           coalesce(
             public.inkoop_slug(l.website_slug),
             public.inkoop_slug(l.city),
             public.inkoop_slug(l.code)) as stuk,
           nullif(trim(l.administratie), '') as eigen,
           l.name
      from public.locations l
     where l.active
       and not exists (select 1 from public.inkoop_adres ia where ia.location_id = l.id)
  loop
    if r.stuk is null then
      over := over + 1;
      redenen := redenen || format(
        '%s heeft geen plaatsnaam, stad of code om een adres van te maken.', r.name);
      continue;
    end if;
    if coalesce(r.eigen, hoofd) is null then
      over := over + 1;
      redenen := redenen || format(
        '%s hoort bij geen enkele bv: er is geen bv die zo heet, de vestiging '
        'heeft er zelf geen, en er is geen hoofdadministratie aangewezen.', r.name);
      continue;
    end if;

    volledig := public.inkoop_vrij_adres(array[r.stuk], voorvoegsel, domein);
    if volledig is null then
      over := over + 1;
      redenen := redenen || format(
        '%s: er is al een adres op %s en op elk nummer daarachter.', r.name, r.stuk);
      continue;
    end if;

    insert into public.inkoop_adres
      (id, adres, administratie, location_id, omschrijving)
    values ('ia_' || r.id, volledig, coalesce(r.eigen, hoofd), r.id,
            'Vanzelf aangemaakt voor ' || r.name || ' (0097)')
    on conflict (id) do nothing;
    n := n + 1;
  end loop;

  /* --- en per bv die nog nergens post kan ontvangen --- */
  for r in
    select a.code, a.naam,
           public.inkoop_bv_slug(a.code, true)  as stuk,
           public.inkoop_bv_slug(a.code, false) as lang
      from public.exact_administratie a
     where a.actief
       and not exists (
         select 1 from public.inkoop_adres ia
          where ia.administratie = a.code and ia.actief)
  loop
    if r.stuk is null then
      over := over + 1;
      redenen := redenen || format(
        '%s levert geen bruikbare naam op voor een adres.', r.naam);
      continue;
    end if;

    /* Eerst de korte naam, dan de lange, en pas dan een cijfer. */
    volledig := public.inkoop_vrij_adres(array[r.stuk, r.lang], voorvoegsel, domein);
    if volledig is null then
      over := over + 1;
      redenen := redenen || format(
        '%s: er is al een adres op %s en op elk nummer daarachter.', r.naam, r.stuk);
      continue;
    end if;

    insert into public.inkoop_adres
      (id, adres, administratie, omschrijving)
    values ('ia_bv_' || r.code, volledig, r.code,
            'Vanzelf aangemaakt voor ' || r.naam || ' (0097)')
    on conflict (id) do nothing;
    n := n + 1;
  end loop;

  perform set_config('inkoop.bezig', '', true);
  return query select n, over, redenen;
end $$;

comment on function public.inkoop_adressen_aanvullen() is
  'Maakt de inkoopadressen die er nog niet zijn (0097, 0098): een per '
  'vestiging op de plaatsnaam en in de bv die naar die plaats heet, en een '
  'per bv die nog nergens post kan ontvangen. Raakt bestaande rijen niet '
  'aan. Wat niet lukte staat in waarom.';

revoke execute on function public.inkoop_adressen_aanvullen() from public, anon;
grant  execute on function public.inkoop_adressen_aanvullen() to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  6. De trigger doet nu allebei
-- ---------------------------------------------------------------------------

create or replace function public.inkoop_adres_bijhouden()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  /* Is het aanvullen zelf aan het werk, dan hoeft dit niet nog eens; zie het
     vlaggetje in inkoop_adressen_aanvullen(). */
  if coalesce(current_setting('inkoop.bezig', true), '') = '1' then
    return null;
  end if;
  perform public.vestigingen_bv_aanvullen();
  perform public.inkoop_adressen_aanvullen();
  return null;
exception when others then
  /* Nooit de vestiging of de bv tegenhouden om een adres. Wat hier misgaat
     is te herstellen met de knop; een vestiging die niet opgeslagen kan
     worden is dat niet. */
  raise notice 'inkoopadres aanvullen mislukte: %', sqlerrm;
  return null;
end $$;

revoke execute on function public.inkoop_adres_bijhouden() from public, anon;
grant  execute on function public.inkoop_adres_bijhouden() to service_role;

-- ---------------------------------------------------------------------------
--  7. En wat 0097 verkeerd heeft neergezet, rechtzetten
--
--  Alleen wat de automaat zelf heeft gemaakt en waar niemand daarna aan
--  gezeten heeft. Een adres dat iemand met de hand aan een bv heeft gehangen
--  is een keuze, en die wordt hier niet overruled.
-- ---------------------------------------------------------------------------

do $$
declare
  ingevuld    integer;
  verzet      integer;
  weg         integer;
  uit         record;
begin
  ingevuld := public.vestigingen_bv_aanvullen();

  /* a. adressen met een vestiging eraan gaan naar de bv van die vestiging */
  with juist as (
    select ia.id, l.administratie as bv
      from public.inkoop_adres ia
      join public.locations l on l.id = ia.location_id
     where ia.omschrijving like 'Vanzelf aangemaakt%'
        or ia.omschrijving like 'Overgenomen uit het berekende adres%'
  )
  update public.inkoop_adres ia
     set administratie = juist.bv, updated_at = public.now_ms()
    from juist
   where juist.id = ia.id
     and nullif(trim(juist.bv), '') is not null
     and juist.bv is distinct from ia.administratie;
  get diagnostics verzet = row_count;

  /*
   * b. en de adressen met een cijfer erachter die daardoor zijn ontstaan.
   *
   * inkoop.venlo2@ bestond alleen omdat inkoop.venlo@ bij de verkeerde bv
   * stond. Nu dat recht is, is dit een adres zonder reden.
   *
   * Weg mag alleen als het nooit gebruikt is: door de automaat gemaakt, geen
   * bon eraan, geen naam eraan, geen vestiging eraan. En dan nog maar in twee
   * gevallen, want alleen daar is weghalen aantoonbaar geen verlies:
   *
   *   die bv heeft al een adres      dan is dit cijfer puur restafval van de
   *   zonder cijfer                  verkeerde bv -- inkoop.venlo@ staat nu
   *                                  op Venlo, dus inkoop.venlo2@ hoeft niet.
   *
   *   of dit is het enige adres      dan maakt het aanvullen hieronder er
   *   dat die bv heeft               meteen weer een, met de beste naam die
   *                                  er nu is. Bij Maasvlakte Holding is dat
   *                                  maasvlakteholding; is er niets beters,
   *                                  dan komt hetzelfde adres gewoon terug.
   *
   * Bewust NIET: vragen welk adres er vrij is. Dat gaf het verkeerde antwoord
   * -- de rij die je wilt weghalen bezet dan zijn eigen naam nog.
   */
  delete from public.inkoop_adres ia
   where ia.omschrijving like 'Vanzelf aangemaakt%'
     and ia.location_id is null
     and ia.goedkeurder is null
     and split_part(ia.adres, '@', 1) ~ '[0-9]$'
     and not exists (select 1 from public.expenses e where e.inkoop_adres_id = ia.id)
     and (
       exists (
         select 1 from public.inkoop_adres z
          where z.administratie = ia.administratie and z.id <> ia.id and z.actief
            and split_part(z.adres, '@', 1) !~ '[0-9]$')
       or not exists (
         select 1 from public.inkoop_adres z
          where z.administratie = ia.administratie and z.id <> ia.id));
  get diagnostics weg = row_count;

  select * into uit from public.inkoop_adressen_aanvullen();

  raise notice 'Vestigingen aan hun bv: %. Adressen rechtgezet: %, opgeruimd: %, nieuw: %.',
    ingevuld, verzet, weg, uit.gemaakt;
end $$;
