-- ===========================================================================
--  De wekkers gaan naast wat ze wekken
--
--  Casper: "Die cronjobs op github lopen steeds vaker fout, kan dat niet via
--  iets anders?"
--
--  Wat er stond, en waarom
--  -----------------------
--
--  Twee wekkers in GitHub Actions: elk kwartier de voorraad, en elk heel uur
--  van 4 tot 14 UTC de takenmail. Allebei een curl naar een Edge Function.
--
--  De reden die erbij stond was: "een cron in de database (pg_cron) kan geen
--  mail versturen en de gratis laag heeft er geen". Dat eerste is waar en
--  niet ter zake -- hij hoeft geen mail te versturen, hij hoeft de functie te
--  WEKKEN, precies wat die curl doet. Het tweede is nooit nagekeken.
--
--  Waarom GitHub hier de verkeerde plek is
--  ---------------------------------------
--
--    het is een omweg      GitHub belt Supabase om iets te wekken dat op
--                          Supabase draait. Twee platforms voor een handeling
--                          die er maar een nodig heeft.
--
--    hij mag overslaan     GitHub zet geplande workflows bij drukte
--                          achteraan, en laat ze soms helemaal vallen. Dat
--                          staat in het commentaar van de wekker zelf, en
--                          */15 is bovendien het drukste moment dat er is --
--                          iedereen plant op het kwartier.
--
--    je ziet niets         of een ronde gelukt is, staat in het
--                          Actions-tabblad van een website. Niet in iets wat
--                          wij kunnen uitlezen of tonen.
--
--  Dat laatste is de echte winst. pg_cron schrijft elke ronde met zijn
--  uitkomst weg in cron.job_run_details, en dat is gewoon een tabel. Daarmee
--  kan een scherm zeggen "de voorraadwekker heeft vannacht drie keer gefaald"
--  in plaats van dat iemand het toevallig ontdekt.
--
--  Wat er NIET verandert
--  ---------------------
--
--  De tijden en de acties blijven precies gelijk, inclusief de omweg met de
--  zomertijd: pg_cron plant net als GitHub in UTC, dus de wekker loopt elk
--  heel uur langs en de FUNCTIE beslist of het lokaal het goede uur is. Die
--  redenering stond er al en was goed; hij verhuist mee zoals hij is.
--
--  En het geheim gaat niet in de cron-regel staan. Dat zou het in cron.job
--  zetten, en daarmee in elke back-up en elk databasedump. Het komt in de
--  kluis; de cron haalt het er per ronde uit.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. De twee uitbreidingen
--
--  Met dezelfde stut als 0042 voor pg_trgm: de testdatabase (PGlite) kent
--  geen uitbreidingen, en zonder deze vangst kan dit bestand daar niet eens
--  laden -- en dan is er van deze hele migratie niets te controleren.
--
--  Op Supabase hoort dit gewoon te lukken. Lukt het NIET, dan zegt de
--  meldingsregel dat, en weigert wekkers_instellen() hieronder eerlijk in
--  plaats van te doen alsof er iets gepland staat.
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron niet beschikbaar: % -- de wekkers blijven bij GitHub', sqlerrm;
end $$;

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net niet beschikbaar: % -- de wekkers blijven bij GitHub', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
--  2. Waar de functies staan
--
--  Geen geheim -- het is het adres dat in elke browser te zien is -- dus dit
--  mag gewoon een instelling zijn. Leeg laten betekent: de wekkers doen
--  niets, en zeggen waarom.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving)
values (
  'in_functies_url', 'functies_url', '',
  'Het adres waar de Edge Functions staan, bijvoorbeeld '
  'https://<project>.supabase.co/functions/v1. Nodig voor de wekkers (0101); '
  'leeg betekent dat die niets doen.')
on conflict (sleutel) do update set omschrijving = excluded.omschrijving;

-- ---------------------------------------------------------------------------
--  3. Het geheim uit de kluis halen
--
--  Apart, en niet in de cron-regel, om drie redenen: het staat dan niet in
--  cron.job, niet in een dump, en niet in het scherm waar de geplande taken
--  te zien zijn.
--
--  Geen kluis op deze database (PGlite), dan geeft dit netjes niets terug in
--  plaats van om te vallen.
-- ---------------------------------------------------------------------------

create or replace function public.wekker_geheim(naam_in text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  uit text;
begin
  if to_regclass('vault.decrypted_secrets') is null then return null; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into uit using naam_in;
  return uit;
exception when others then
  return null;
end $$;

revoke execute on function public.wekker_geheim(text) from public, anon, authenticated;
grant  execute on function public.wekker_geheim(text) to service_role;

-- ---------------------------------------------------------------------------
--  4. De wekkers instellen
--
--  Idempotent: eerst weghalen wat er staat, dan opnieuw plannen. Zo is dit
--  bestand de enige waarheid over wat er gepland staat, en niet "wat er ooit
--  een keer is ingetikt".
--
--  Alles via execute, zodat dit bestand ook laadt op een database zonder
--  pg_cron -- daar bestaat cron.schedule niet, en een functielichaam dat er
--  rechtstreeks naar verwijst zou al bij het aanmaken struikelen.
-- ---------------------------------------------------------------------------

create or replace function public.wekkers_instellen()
returns table (naam text, planning text, gelukt boolean, waarom text)
language plpgsql security definer set search_path = public as $$
declare
  basis text;
  w     record;
  lijf  text;
  fout  text;
begin
  if to_regproc('cron.schedule') is null then
    return query select 'alle'::text, ''::text, false,
      'pg_cron staat niet aan op deze database.'::text;
    return;
  end if;
  if to_regproc('net.http_post') is null then
    return query select 'alle'::text, ''::text, false,
      'pg_net staat niet aan; zonder die uitbreiding kan een cron geen '
      'functie wekken.'::text;
    return;
  end if;

  select nullif(trim(i.waarde), '') into basis
    from public.instellingen i where i.sleutel = 'functies_url';
  if basis is null then
    return query select 'alle'::text, ''::text, false,
      'De instelling functies_url is leeg; vul daar het adres van de Edge '
      'Functions in.'::text;
    return;
  end if;
  basis := rtrim(basis, '/');

  /*
   * De wekkers zoals ze bij GitHub stonden, met dezelfde tijden en dezelfde
   * acties. De functie beslist zelf of het lokaal het goede uur is -- dat
   * was zo, en dat blijft zo, want pg_cron plant net als GitHub in UTC.
   */
  for w in
    select * from (values
      ('voorraad-direct',  '*/15 * * * *', 'trucksupply', 'direct',  'voorraad_cron_secret'),
      ('voorraad-ochtend', '0 4-9 * * *',  'trucksupply', 'ochtend', 'voorraad_cron_secret'),
      ('takenmail',        '0 4-14 * * *', 'takenmail',   'normaal', 'taken_cron_secret')
    ) as t(naam, planning, functie, actie, sleutel)
  loop
    /* Weghalen mag mislukken: de eerste keer staat hij er nog niet. */
    begin
      execute format('select cron.unschedule(%L)', w.naam);
    exception when others then
      null;
    end;

    /*
     * Het geheim staat NIET in deze tekst -- alleen de opzoekvraag. Wat er
     * in cron.job belandt is dus "haal sleutel X uit de kluis", en niet de
     * sleutel zelf.
     */
    lijf := format(
      $sql$select net.http_post(
             url := %L,
             headers := jsonb_build_object('Content-Type', 'application/json'),
             body := jsonb_build_object(
               'actie', %L,
               'geheim', coalesce(public.wekker_geheim(%L), '')),
             timeout_milliseconds := 120000)$sql$,
      basis || '/' || w.functie, w.actie, w.sleutel);

    fout := null;
    begin
      execute format('select cron.schedule(%L, %L, %L)', w.naam, w.planning, lijf);
    exception when others then
      fout := sqlerrm;
    end;

    return query select w.naam::text, w.planning::text, fout is null, fout;
  end loop;
end $$;

revoke execute on function public.wekkers_instellen() from public, anon, authenticated;
grant  execute on function public.wekkers_instellen() to service_role;

comment on function public.wekkers_instellen() is
  'Plant de wekkers in de database (0101): voorraad elk kwartier, het '
  'voorraadoverzicht en de takenmail elk heel uur binnen hun venster. '
  'Idempotent. Geeft per wekker terug of het lukte en zo niet waarom.';

-- ---------------------------------------------------------------------------
--  5. En of ze het doen
--
--  Dit is waarom de verhuizing de moeite waard is. Bij GitHub stond de
--  uitkomst van een ronde in het Actions-tabblad van een website; hier staat
--  hij in een tabel, en kan een scherm hem laten zien.
-- ---------------------------------------------------------------------------

create or replace function public.wekkers_stand(hoeveel integer default 20)
returns table (
  naam       text,
  planning   text,
  actief     boolean,
  laatst_at  timestamptz,
  laatst_hoe text,
  mislukt    integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('cron.job') is null then return; end if;

  return query execute format($sql$
    select j.jobname::text,
           j.schedule::text,
           j.active,
           l.laatst,
           l.hoe::text,
           coalesce(l.mislukt, 0)::integer
      from cron.job j
      left join lateral (
        select max(d.start_time) as laatst,
               (array_agg(d.status order by d.start_time desc))[1] as hoe,
               count(*) filter (where d.status <> 'succeeded') as mislukt
          from (select * from cron.job_run_details r
                 where r.jobid = j.jobid
                 order by r.start_time desc
                 limit %s) d
      ) l on true
     order by j.jobname
  $sql$, greatest(1, coalesce(hoeveel, 20)));
end $$;

revoke execute on function public.wekkers_stand(integer) from public, anon, authenticated;
grant  execute on function public.wekkers_stand(integer) to service_role;

comment on function public.wekkers_stand(integer) is
  'Wat de wekkers de laatste rondes deden (0101), uit cron.job_run_details. '
  'Leeg op een database zonder pg_cron.';

-- ---------------------------------------------------------------------------
--  6. En meteen proberen
--
--  Zonder adres of zonder pg_cron gebeurt er niets en staat er een melding.
--  Dat is het antwoord op "kan dit gratis": deze migratie zoekt het uit en
--  zegt het, in plaats van dat iemand het moet aannemen.
-- ---------------------------------------------------------------------------

do $$
declare r record;
begin
  for r in select * from public.wekkers_instellen() loop
    if r.gelukt then
      raise notice 'Wekker % gepland (%)', r.naam, r.planning;
    else
      raise notice 'Wekker % NIET gepland: %', r.naam, r.waarom;
    end if;
  end loop;
end $$;
