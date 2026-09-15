-- ===========================================================================
--  De adressen maken zichzelf
--
--  Casper: "Zorg ervoor dat je de adressen automatisch aanmaakt, wel op het
--  domein van resend, waar je het eerder ook al op had. Het liefst gewoon de
--  plaatsnaam, of een afdelingsnaam, bijv inkoop.roosendaal@ en inkoop.td@.
--  Bekijk alles, en maak alles zo automatisch mogelijk aub."
--
--  Wat 0095 half deed
--  ------------------
--
--  Daar werd een adres van een BEREKENING een rij, en dat is goed: een adres
--  kan nu bij een bv zonder wasstraat horen, en er kan een naam aan hangen.
--  Maar het aanmaken werd daarmee handwerk -- twintig bv's, zelf intikken, en
--  wie er een vergeet merkt dat als er een maand geen facturen binnenkwamen.
--
--  Een berekening vervangen door een lijst is alleen winst als die lijst
--  zichzelf vult.
--
--  Hoe een adres heet
--  ------------------
--
--    een vestiging   de plaats zoals wij hem noemen -- de website-slug, want
--                    die IS de plaatsnaam, is al uniek en staat al in
--                    truckwash1group.nl/vestigingen/roosendaal. Geen slug?
--                    Dan de plaats, en anders de code.
--
--                    Zo blijven de adressen die al zijn uitgedeeld bovendien
--                    letterlijk hetzelfde. Ze staan bij leveranciers in het
--                    adresboek; daar mag geen letter aan veranderen.
--
--    een bv zonder   de naam, zonder rechtsvorm en zonder het stuk dat elke
--    vestiging       bv deelt. "Truckwash 1 Vastgoed B.V." wordt vastgoed,
--                    "Truckwash 1 Techniek & Beheer B.V." wordt techniek.
--
--  Dat laatste is een voorstel en geen wet. Wil Casper inkoop.td@, dan
--  hernoemt hij hem in het scherm -- en dan blijft dat zo staan, want deze
--  functie vult alleen gaten en raakt bestaande rijen niet aan.
--
--  Opnieuw draaien mag; de tweede keer valt er niets meer te vullen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Een stuk tekst dat in een mailadres past
--
--  Kleine letters, geen accenten, geen leestekens. Dezelfde vertaaltabel als
--  kaal_naam() (0081) en om dezelfde reden: unaccent() zit wel op Supabase en
--  niet in de testdatabase, en een adres hoort overal hetzelfde te worden.
-- ---------------------------------------------------------------------------

create or replace function public.inkoop_slug(ruw text)
returns text
language sql immutable as $$
  select nullif(
    regexp_replace(
      translate(
        lower(coalesce(ruw, '')),
        'àáâãäåèéêëìíîïòóôõöùúûüýÿñçø',
        'aaaaaaeeeeiiiiooooouuuuyync o'
      ),
      '[^a-z0-9]', '', 'g'),
    '');
$$;

comment on function public.inkoop_slug(text) is
  'Een stuk tekst zoals het in een mailadres mag staan (0097): kleine '
  'letters, geen accenten, geen leestekens.';

revoke execute on function public.inkoop_slug(text) from public, anon;
grant  execute on function public.inkoop_slug(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  2. Hoe een bv zonder vestiging gaat heten
--
--  De naam zonder rechtsvorm (kaal_bedrijf, 0058), zonder het stuk dat elke
--  bv deelt, en dan het eerste woord dat overblijft.
--
--  Dat gedeelde stuk wordt niet geraden maar geteld: het eerste woord van een
--  bv-naam telt als gedeeld zodra meer dan de helft van de actieve bv's ermee
--  begint. Bij Casper is dat "truckwash"; bij een ander bedrijf iets anders,
--  en dan werkt dit daar net zo goed. Een lijst met "truckwash" erin zou hier
--  een vaste aanname zijn over wiens administratie dit is.
-- ---------------------------------------------------------------------------

create or replace function public.inkoop_bv_slug(bv text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  kaal    text;
  woorden text[];
  gedeeld text;
  totaal  integer;
  hoeveel integer;
  w       text;
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

  /* Het eerste woord dat iets zegt. Een los cijfer ("Truckwash 1 Group")
     onderscheidt niets, dus dat wordt overgeslagen. */
  foreach w in array woorden loop
    if w !~ '^[0-9]+$' and length(w) > 1 then
      return public.inkoop_slug(w);
    end if;
  end loop;

  return public.inkoop_slug(array_to_string(woorden, ''));
end $$;

revoke execute on function public.inkoop_bv_slug(text) from public, anon;
grant  execute on function public.inkoop_bv_slug(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  3. En dan de gaten vullen
--
--  Idempotent, en dat is hier geen nettigheid maar de voorwaarde: hij wordt
--  aangeroepen door een trigger, door een knop en door deze migratie. Wat er
--  staat blijft staan -- ook een adres dat iemand heeft hernoemd.
-- ---------------------------------------------------------------------------

/* Eerst weg en dan opnieuw: 0098 geeft deze functie een kolom erbij, en
   "create or replace" mag de vorm van het antwoord niet veranderen. Zonder
   deze regel loopt een tweede ronde door alle migraties erop vast. */
drop function if exists public.inkoop_adressen_aanvullen();

create or replace function public.inkoop_adressen_aanvullen()
returns table (gemaakt integer, overgeslagen integer)
language plpgsql security definer set search_path = public as $$
declare
  domein      text;
  voorvoegsel text;
  r           record;
  stuk        text;
  volledig    text;   -- niet 'adres': dat is ook een kolomnaam, en dan
                      -- kan PL/pgSQL niet kiezen (42702).
  poging      integer;
  n           integer := 0;
  over        integer := 0;
begin
  select nullif(trim(waarde), '') into domein
    from public.instellingen where sleutel = 'inkoop_domein';
  select coalesce(nullif(trim(waarde), ''), 'inkoop') into voorvoegsel
    from public.instellingen where sleutel = 'inkoop_voorvoegsel';
  voorvoegsel := coalesce(voorvoegsel, 'inkoop');

  /* Zonder domein valt er geen adres te maken. Stil terug: dit draait ook
     vanuit een trigger, en daar hoort geen fout uit te komen omdat er een
     instelling leeg staat. */
  if domein is null then
    return query select 0, 0;
    return;
  end if;

  /* --- per vestiging --- */
  for r in
    select l.id,
           coalesce(
             public.inkoop_slug(l.website_slug),
             public.inkoop_slug(l.city),
             public.inkoop_slug(l.code)) as stuk,
           coalesce(
             nullif(trim(l.administratie), ''),
             (select a.code from public.exact_administratie a where a.hoofd limit 1)) as bv,
           l.name
      from public.locations l
     where l.active
       and not exists (select 1 from public.inkoop_adres ia where ia.location_id = l.id)
  loop
    if r.stuk is null or r.bv is null then
      over := over + 1;
      continue;
    end if;

    stuk := r.stuk;
    poging := 1;
    loop
      volledig := lower(voorvoegsel || '.' || stuk || '@' || domein);
      exit when not exists (
        select 1 from public.inkoop_adres ia where lower(ia.adres) = volledig);
      poging := poging + 1;
      stuk := r.stuk || poging::text;
      /* Tien naamgenoten is geen naamgenoot meer maar iets anders; dan
         liever niets dan inkoop.venlo11@. */
      if poging > 10 then exit; end if;
    end loop;

    if exists (select 1 from public.inkoop_adres ia where lower(ia.adres) = volledig) then
      over := over + 1;
      continue;
    end if;

    insert into public.inkoop_adres
      (id, adres, administratie, location_id, omschrijving)
    values ('ia_' || r.id, volledig, r.bv, r.id,
            'Vanzelf aangemaakt voor ' || r.name || ' (0097)')
    on conflict (id) do nothing;
    n := n + 1;
  end loop;

  /* --- en per bv die nog nergens post kan ontvangen --- */
  for r in
    select a.code, a.naam, public.inkoop_bv_slug(a.code) as stuk
      from public.exact_administratie a
     where a.actief
       and not exists (
         select 1 from public.inkoop_adres ia
          where ia.administratie = a.code and ia.actief)
  loop
    if r.stuk is null then
      over := over + 1;
      continue;
    end if;

    stuk := r.stuk;
    poging := 1;
    loop
      volledig := lower(voorvoegsel || '.' || stuk || '@' || domein);
      exit when not exists (
        select 1 from public.inkoop_adres ia where lower(ia.adres) = volledig);
      poging := poging + 1;
      stuk := r.stuk || poging::text;
      if poging > 10 then exit; end if;
    end loop;

    if exists (select 1 from public.inkoop_adres ia where lower(ia.adres) = volledig) then
      over := over + 1;
      continue;
    end if;

    insert into public.inkoop_adres
      (id, adres, administratie, omschrijving)
    values ('ia_bv_' || r.code, volledig, r.code,
            'Vanzelf aangemaakt voor ' || r.naam || ' (0097)')
    on conflict (id) do nothing;
    n := n + 1;
  end loop;

  return query select n, over;
end $$;

comment on function public.inkoop_adressen_aanvullen() is
  'Maakt de inkoopadressen die er nog niet zijn (0097): een per vestiging op '
  'de plaatsnaam, en een per bv die nog nergens post kan ontvangen. Raakt '
  'bestaande rijen niet aan, dus een hernoemd adres blijft hernoemd.';

revoke execute on function public.inkoop_adressen_aanvullen() from public, anon;
grant  execute on function public.inkoop_adressen_aanvullen() to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  4. Nu, en voortaan vanzelf
--
--  Een nieuwe vestiging of een bv die aangezet wordt, hoort meteen een adres
--  te hebben. Anders is "automatisch" iets wat één keer is gebeurd.
--
--  De trigger doet ALLE gaten en niet alleen die van de gewijzigde rij. Dat
--  is goedkoper dan het lijkt -- het zijn twee vragen over tabellen van
--  twintig rijen -- en het scheelt een tweede stuk code dat hetzelfde moet
--  zeggen.
-- ---------------------------------------------------------------------------

create or replace function public.inkoop_adres_bijhouden()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.inkoop_adressen_aanvullen();
  return null;
exception when others then
  /* Nooit de vestiging of de bv tegenhouden om een adres. Wat hier misgaat
     is te herstellen met de knop; een vestiging die niet opgeslagen kan
     worden is dat niet. */
  raise notice 'inkoopadres aanvullen mislukte: %', sqlerrm;
  return null;
end $$;

drop trigger if exists locations_inkoop_adres on public.locations;
create trigger locations_inkoop_adres
  after insert or update of active, administratie, website_slug, city on public.locations
  for each statement execute function public.inkoop_adres_bijhouden();

drop trigger if exists exact_administratie_inkoop_adres on public.exact_administratie;
create trigger exact_administratie_inkoop_adres
  after insert or update of actief, naam on public.exact_administratie
  for each statement execute function public.inkoop_adres_bijhouden();

/* En meteen de achterstand. */
do $$
declare uit record;
begin
  select * into uit from public.inkoop_adressen_aanvullen();
  raise notice 'Inkoopadressen: % aangemaakt, % overgeslagen', uit.gemaakt, uit.overgeslagen;
end $$;

-- ---------------------------------------------------------------------------
--  5. En de instelling zegt wat er nu klopt
--
--  De omschrijving beloofde "het adres per vestiging wordt
--  inkoop.<vestiging>@<domein>". Dat was een berekening en is sinds 0095 een
--  lijst; sinds 0097 vult die lijst zichzelf. Een omschrijving die iets
--  anders zegt dan wat er gebeurt is erger dan geen omschrijving.
-- ---------------------------------------------------------------------------

update public.instellingen
   set waarde = waarde,
       omschrijving =
         'Het domein waarop facturen binnenkomen; dit moet bij Resend zijn '
         'ingesteld, anders komt er niets aan. De adressen zelf staan in '
         'inkoop_adres en worden vanzelf aangemaakt (0097): per vestiging op '
         'de plaatsnaam (inkoop.roosendaal@) en per bv zonder vestiging op '
         'een korte naam (inkoop.vastgoed@). Hernoemen mag; wat er staat '
         'blijft staan.'
 where sleutel = 'inkoop_domein';
