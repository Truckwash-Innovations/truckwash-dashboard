-- ===========================================================================
--  Een wekker die je zelf kunt laten afgaan
--
--  Casper: "Daarbuiten moet ik bij ontwikkelaar een knop hebben, zodat ik die
--  timers functie handmatig kan doen, zodat we gelijk zien of het werkt."
--
--  Wat er stond
--  ------------
--
--  Drie wekkers die om vier uur 's nachts en om het kwartier afgaan, en
--  verder niets. Wilde je weten of ze werkten, dan was het antwoord: wacht
--  tot morgenochtend en kijk dan in wekkers_stand(). Een koppeling die je pas
--  de volgende dag kunt controleren, controleer je niet.
--
--  Wat het wordt
--  -------------
--
--  Dezelfde opdracht, nu ook met de hand af te vuren. Letterlijk dezelfde:
--  de tekst die cron.schedule() krijgt en de tekst die de knop uitvoert komen
--  uit één functie. Zou de knop zijn eigen versie hebben, dan bewijst een
--  geslaagde klik alleen dat de KNOP werkt -- en dat is precies het soort
--  proef waar je niets aan hebt.
--
--  Wat je ervan ziet
--  -----------------
--
--  Het verzoeknummer, en daarmee het antwoord van de functie zelf. Dat is de
--  enige die zegt of er iets is gebeurd: net.http_post() is asynchroon, dus
--  "de opdracht is weggezet" zegt niets over wat de functie ervan vond.
--  Vandaar wekker_antwoord(): die kijkt in net._http_response, en werkt ook
--  op een database waar pg_cron niet eens aanstaat.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Welke wekkers er zijn, op één plek
--
--  Stond als een VALUES-lijst midden in wekkers_instellen(). Nu een functie,
--  zodat de knop dezelfde lijst ziet.
-- ---------------------------------------------------------------------------

create or replace function public.wekkers_lijst()
returns table (naam text, planning text, functie text, actie text, sleutel text)
language sql stable as $$
  select * from (values
    ('voorraad-direct',  '*/15 * * * *', 'trucksupply', 'direct',  'voorraad_cron_secret'),
    ('voorraad-ochtend', '0 4-9 * * *',  'trucksupply', 'ochtend', 'voorraad_cron_secret'),
    ('takenmail',        '0 4-14 * * *', 'takenmail',   'normaal', 'taken_cron_secret')
  ) as t(naam, planning, functie, actie, sleutel);
$$;

revoke execute on function public.wekkers_lijst() from public, anon;
grant  execute on function public.wekkers_lijst() to authenticated, service_role;

comment on function public.wekkers_lijst() is
  'De wekkers en wat ze aanroepen (0107). Eén lijst, gebruikt door zowel '
  'wekkers_instellen() als wekker_nu() -- anders bewijst een handmatige proef '
  'alleen dat de knop werkt.';

-- ---------------------------------------------------------------------------
--  2. De opdracht van één wekker
--
--  Geeft de SQL terug die de wekker uitvoert. Het geheim staat er niet in;
--  alleen de opzoekvraag (0102).
-- ---------------------------------------------------------------------------

create or replace function public.wekker_opdracht(naam_in text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  basis text;
  w     record;
begin
  select nullif(trim(i.waarde), '') into basis
    from public.instellingen i where i.sleutel = 'functies_url';
  if basis is null then return null; end if;
  basis := rtrim(basis, '/');

  select * into w from public.wekkers_lijst() l where l.naam = naam_in;
  if not found then return null; end if;

  return format(
    $sql$insert into public.wekker_ronde (naam, verzoek_id)
         values (%L, net.http_post(
           url := %L,
           headers := jsonb_build_object('Content-Type', 'application/json'),
           body := jsonb_build_object(
             'actie', %L,
             'geheim', coalesce(public.wekker_geheim(%L), '')),
           timeout_milliseconds := 120000))$sql$,
    w.naam, basis || '/' || w.functie, w.actie, w.sleutel);
end $$;

revoke execute on function public.wekker_opdracht(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
--  3. Instellen gebruikt diezelfde opdracht
-- ---------------------------------------------------------------------------

create or replace function public.wekkers_instellen()
returns table (naam text, planning text, gelukt boolean, waarom text)
language plpgsql security definer set search_path = public as $$
declare
  w    record;
  lijf text;
  fout text;
  uit  record;
begin
  for w in
    select * from (values
      ('pg_cron', 'cron', 'schedule'),
      ('pg_net',  'net',  'http_post')
    ) as t(uitbreiding, schemanaam, functie)
  loop
    if not exists (
      select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = w.schemanaam and p.proname = w.functie)
    then
      return query select 'alle'::text, ''::text, false, (
        case
          when not exists (
            select 1 from pg_available_extensions a where a.name = w.uitbreiding)
            then format('%s is op deze database niet beschikbaar. Dat is een '
                        'grens van het platform, geen instelling.', w.uitbreiding)
          when exists (
            select 1 from pg_extension e where e.extname = w.uitbreiding)
            then format('%s staat aan, maar %I.%I bestaat niet. Dat is '
                        'ongewoon; draai "drop extension %s; create extension %s;".',
                        w.uitbreiding, w.schemanaam, w.functie,
                        w.uitbreiding, w.uitbreiding)
          else format('%s staat niet aan. Zet hem aan met: '
                      'create extension %s;', w.uitbreiding, w.uitbreiding)
        end)::text;
      return;
    end if;
  end loop;

  if public.wekker_opdracht((select l.naam from public.wekkers_lijst() l limit 1)) is null then
    return query select 'alle'::text, ''::text, false,
      'De instelling functies_url is leeg; vul daar het adres van de Edge '
      'Functions in.'::text;
    return;
  end if;

  for uit in select * from public.wekkers_lijst()
  loop
    begin
      execute format('select cron.unschedule(%L)', uit.naam);
    exception when others then
      null;
    end;

    lijf := public.wekker_opdracht(uit.naam);

    fout := null;
    begin
      execute format('select cron.schedule(%L, %L, %L)', uit.naam, uit.planning, lijf);
    exception when others then
      fout := sqlerrm;
    end;

    return query select uit.naam::text, uit.planning::text, fout is null, fout;
  end loop;
end $$;

revoke execute on function public.wekkers_instellen() from public, anon, authenticated;
grant  execute on function public.wekkers_instellen() to service_role;

-- ---------------------------------------------------------------------------
--  4. En hem nu laten afgaan
--
--  Alleen de ontwikkelaar: dit stuurt een verzoek naar buiten met een geheim
--  eraan, en dat is niets voor een knop die iedereen kan vinden.
-- ---------------------------------------------------------------------------

create or replace function public.wekker_nu(naam_in text)
returns table (naam text, verzoek_id bigint, gelukt boolean, waarom text)
language plpgsql security definer set search_path = public as $$
declare
  lijf text;
  fout text;
  nr   bigint;
begin
  if not public.is_developer() then
    raise exception 'Alleen ontwikkeling kan een wekker met de hand laten afgaan.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.wekkers_lijst() l where l.naam = naam_in) then
    return query select naam_in, null::bigint, false, 'Die wekker bestaat niet.'::text;
    return;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'net' and p.proname = 'http_post')
  then
    return query select naam_in, null::bigint, false,
      'pg_net staat niet aan; zonder die uitbreiding kan de database geen '
      'verzoek versturen.'::text;
    return;
  end if;

  lijf := public.wekker_opdracht(naam_in);
  if lijf is null then
    return query select naam_in, null::bigint, false,
      'De instelling functies_url is leeg; vul daar het adres van de Edge '
      'Functions in.'::text;
    return;
  end if;

  begin
    execute lijf;
  exception when others then
    fout := sqlerrm;
  end;

  if fout is not null then
    return query select naam_in, null::bigint, false, fout;
    return;
  end if;

  select r.verzoek_id into nr
    from public.wekker_ronde r
   where r.naam = naam_in
   order by r.gestart_at desc
   limit 1;

  return query select naam_in, nr, true, null::text;
end $$;

revoke execute on function public.wekker_nu(text) from public, anon;
grant  execute on function public.wekker_nu(text) to authenticated, service_role;

comment on function public.wekker_nu(text) is
  'Laat één wekker nu afgaan, met precies de opdracht die de cron ook '
  'uitvoert (0107). Alleen voor ontwikkeling.';

-- ---------------------------------------------------------------------------
--  5. Wat de functie ervan vond
--
--  net.http_post() is asynchroon: hij geeft een nummer terug en gaat verder.
--  Het antwoord komt later in net._http_response te staan, en dat is het
--  enige dat zegt of er werkelijk iets gebeurd is. Ze worden zes uur
--  bewaard.
-- ---------------------------------------------------------------------------

create or replace function public.wekker_antwoord(verzoek_in bigint)
returns table (klaar boolean, status_code integer, inhoud text, waarom text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_developer() then
    raise exception 'Alleen ontwikkeling kan het antwoord van een wekker opvragen.'
      using errcode = 'insufficient_privilege';
  end if;

  if to_regclass('net._http_response') is null then
    return query select false, null::integer, null::text,
      'pg_net bewaart hier geen antwoorden.'::text;
    return;
  end if;

  return query execute format($sql$
    select true,
           a.status_code,
           left(coalesce(a.content, ''), 2000),
           case
             when a.timed_out then 'de functie antwoordde niet op tijd'
             when a.error_msg is not null then a.error_msg
             when a.status_code between 200 and 299 then null
             else 'de functie gaf ' || a.status_code
           end::text
      from net._http_response a
     where a.id = %s
  $sql$, verzoek_in);

  if not found then
    return query select false, null::integer, null::text,
      'nog geen antwoord'::text;
  end if;
end $$;

revoke execute on function public.wekker_antwoord(bigint) from public, anon;
grant  execute on function public.wekker_antwoord(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  6. En de stand, voor het scherm
--
--  wekkers_stand() is sinds 0102 alleen voor de servicesleutel -- terecht: er
--  staan adressen en foutmeldingen in die niet voor iedereen zijn. Maar het
--  ontwikkelaarsscherm moet hem wel kunnen laten zien, anders is de knop
--  hierboven een klik zonder uitkomst.
--
--  Een dun laagje eromheen dus, met de vraag wie je bent. Geen tweede versie
--  van de stand zelf: dat zou betekenen dat het scherm iets anders toont dan
--  de cron doet, en dan bewijst een groene regel niets.
-- ---------------------------------------------------------------------------

create or replace function public.wekkers_overzicht(hoeveel integer default 20)
returns table (
  naam          text,
  planning      text,
  actief        boolean,
  laatst_at     timestamptz,
  antwoord      integer,
  antwoord_hoe  text,
  mislukt       integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_developer() then
    raise exception 'Alleen ontwikkeling kan de stand van de wekkers zien.'
      using errcode = 'insufficient_privilege';
  end if;

  return query select * from public.wekkers_stand(hoeveel);
end $$;

revoke execute on function public.wekkers_overzicht(integer) from public, anon;
grant  execute on function public.wekkers_overzicht(integer) to authenticated, service_role;

comment on function public.wekkers_overzicht(integer) is
  'wekkers_stand() voor het ontwikkelaarsscherm (0107). Zelfde antwoord, met '
  'de vraag wie je bent ervoor.';
