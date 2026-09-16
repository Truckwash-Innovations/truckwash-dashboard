-- ===========================================================================
--  Een wekker die zegt of hij gehóórd is
--
--  0101 verhuisde de wekkers naar pg_cron, en wekkers_stand() las
--  cron.job_run_details uit. Dat leek genoeg. Het is het niet.
--
--  net.http_post is ASYNCHROON. De documentatie van pg_net zegt het met
--  zoveel woorden: het verzoek gaat pas de deur uit als de transactie is
--  vastgelegd. Voor pg_cron betekent dat: de taak is "succeeded" zodra het
--  verzoek in de wachtrij staat -- of de functie daarna een 403 teruggeeft
--  omdat het wachtwoord niet klopt, of een 500, of helemaal niets, staat
--  daar niet in.
--
--  Een statuspagina die groen staat terwijl er niets gebeurt is erger dan
--  geen statuspagina. Dan kijk je ernaar, ziet drie vinkjes, en zoekt de
--  oorzaak ergens anders.
--
--  Wat eraan ontbrak
--  -----------------
--
--  Het antwoord komt terecht in net._http_response, met status_code,
--  content, error_msg en timed_out. Maar dat is een losse tabel: er is niets
--  dat zegt WELKE wekker bij welk antwoord hoort. net.http_post geeft een
--  nummer terug, en dat nummer gooide de cron-taak weg.
--
--  Dus bewaart de taak het nu. Eén regel per ronde, met de naam van de
--  wekker en het nummer van het verzoek erbij. Daarmee is "de takenmail van
--  vanochtend zeven uur gaf 403" een vraag die te beantwoorden is.
--
--  En de antwoorden gaan na zes uur weg -- dat is de standaardinstelling van
--  pg_net en die laat ik met rust. De RONDES blijven wel staan, dus je ziet
--  daarna nog steeds DAT hij gelopen heeft, met erbij dat het antwoord niet
--  meer bewaard is. Dat is iets anders dan "het ging goed", en zo staat het
--  er ook.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Wat er gewekt is
-- ---------------------------------------------------------------------------

create table if not exists public.wekker_ronde (
  id         bigserial primary key,
  naam       text not null,
  /* Het nummer dat net.http_post teruggeeft; hierop is het antwoord terug te
     vinden zolang pg_net het bewaart. */
  verzoek_id bigint,
  gestart_at timestamptz not null default now()
);

create index if not exists wekker_ronde_naam_idx
  on public.wekker_ronde (naam, gestart_at desc);

comment on table public.wekker_ronde is
  'Eén regel per keer dat een wekker een functie heeft gewekt (0102), met het '
  'verzoeknummer van pg_net erbij. Zonder dit is niet te zeggen welk antwoord '
  'bij welke wekker hoorde -- en dus ook niet of het gelukt is.';

/* Niemand hoeft hier rechtstreeks bij; het gaat via wekkers_stand(). */
alter table public.wekker_ronde enable row level security;

-- ---------------------------------------------------------------------------
--  2. Oud opruimen
--
--  De antwoorden gooit pg_net zelf na zes uur weg. De rondes bewaren we
--  langer -- die zijn klein en je wilt kunnen zien of een wekker vorige week
--  ook al oversloeg -- maar niet eeuwig.
-- ---------------------------------------------------------------------------

create or replace function public.wekker_rondes_opruimen(dagen integer default 30)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.wekker_ronde
   where gestart_at < now() - (greatest(1, coalesce(dagen, 30)) || ' days')::interval;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.wekker_rondes_opruimen(integer) from public, anon, authenticated;
grant  execute on function public.wekker_rondes_opruimen(integer) to service_role;

-- ---------------------------------------------------------------------------
--  3. De taak bewaart voortaan zijn verzoeknummer
--
--  Zelfde opzet als 0101, één verschil: het nummer dat net.http_post
--  teruggeeft gaat niet meer verloren.
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
          then format(
            '%s is op deze database niet te installeren -- hij staat niet in '
            'pg_available_extensions. Dat is een grens van het platform of het '
            'abonnement; de wekkers blijven dan bij GitHub.', w.uitbreiding)
          when exists (
            select 1 from pg_available_extensions a
             where a.name = w.uitbreiding and a.installed_version is null)
          then format(
            '%s is wél beschikbaar maar staat nog niet aan. Zet hem aan bij '
            'Database, Extensions -- of draai: create extension %s;',
            w.uitbreiding, w.uitbreiding)
          else format(
            '%s staat aan, maar %s.%s bestaat niet. Dat hoort niet te kunnen; '
            'kijk naar de installatie van die uitbreiding.',
            w.uitbreiding, w.schemanaam, w.functie)
        end)::text;
      return;
    end if;
  end loop;

  select nullif(trim(i.waarde), '') into basis
    from public.instellingen i where i.sleutel = 'functies_url';
  if basis is null then
    return query select 'alle'::text, ''::text, false,
      'De instelling functies_url is leeg; vul daar het adres van de Edge '
      'Functions in.'::text;
    return;
  end if;
  basis := rtrim(basis, '/');

  for w in
    select * from (values
      ('voorraad-direct',  '*/15 * * * *', 'trucksupply', 'direct',  'voorraad_cron_secret'),
      ('voorraad-ochtend', '0 4-9 * * *',  'trucksupply', 'ochtend', 'voorraad_cron_secret'),
      ('takenmail',        '0 4-14 * * *', 'takenmail',   'normaal', 'taken_cron_secret')
    ) as t(naam, planning, functie, actie, sleutel)
  loop
    begin
      execute format('select cron.unschedule(%L)', w.naam);
    exception when others then
      null;
    end;

    /*
     * Het verzoeknummer wordt bewaard (0102). Zonder dit is de cron-taak
     * "geslaagd" zodra het verzoek is weggezet -- ook als de functie er een
     * 403 op teruggeeft -- en is niet te achterhalen welk antwoord bij welke
     * wekker hoorde.
     *
     * Het geheim staat nog steeds niet in deze tekst; alleen de opzoekvraag.
     */
    lijf := format(
      $sql$insert into public.wekker_ronde (naam, verzoek_id)
           values (%L, net.http_post(
             url := %L,
             headers := jsonb_build_object('Content-Type', 'application/json'),
             body := jsonb_build_object(
               'actie', %L,
               'geheim', coalesce(public.wekker_geheim(%L), '')),
             timeout_milliseconds := 120000))$sql$,
      w.naam, basis || '/' || w.functie, w.actie, w.sleutel);

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

-- ---------------------------------------------------------------------------
--  4. En de stand zegt wat de functie ERVAN VOND
--
--  Drie dingen naast elkaar, want ze betekenen alle drie iets anders:
--
--    gepland     staat hij in de planning en is hij aan
--    gelopen     heeft de taak gedraaid (cron.job_run_details)
--    gehoord     en wat gaf de functie terug (net._http_response)
--
--  Die laatste is de enige die zegt of er werkelijk iets is gebeurd.
-- ---------------------------------------------------------------------------

drop function if exists public.wekkers_stand(integer);

create or replace function public.wekkers_stand(hoeveel integer default 20)
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
  if to_regclass('cron.job') is null then return; end if;

  return query execute format($sql$
    select j.jobname::text,
           j.schedule::text,
           j.active,
           r.gestart_at,
           a.status_code,
           (case
              when a.id is null and r.gestart_at is null then 'nog niet gelopen'
              when a.id is null then
                'antwoord niet (meer) bewaard -- pg_net houdt ze zes uur'
              when a.timed_out then 'de functie antwoordde niet op tijd'
              when a.error_msg is not null then a.error_msg
              when a.status_code between 200 and 299 then 'aangenomen'
              else coalesce(left(a.content, 200), 'geweigerd')
            end)::text,
           coalesce(m.mislukt, 0)::integer
      from cron.job j
      left join lateral (
        select w.gestart_at, w.verzoek_id
          from public.wekker_ronde w
         where w.naam = j.jobname
         order by w.gestart_at desc
         limit 1
      ) r on true
      left join net._http_response a on a.id = r.verzoek_id
      left join lateral (
        select count(*) filter (
                 where h.id is null or h.status_code is null or h.status_code >= 400
               )::integer as mislukt
          from (select * from public.wekker_ronde w2
                 where w2.naam = j.jobname
                 order by w2.gestart_at desc
                 limit %s) v
          left join net._http_response h on h.id = v.verzoek_id
      ) m on true
     order by j.jobname
  $sql$, greatest(1, coalesce(hoeveel, 20)));
exception when others then
  /* Geen pg_net op deze database, of de tabel heet anders: dan liever niets
     dan een scherm dat omvalt. */
  return;
end $$;

revoke execute on function public.wekkers_stand(integer) from public, anon, authenticated;
grant  execute on function public.wekkers_stand(integer) to service_role;

comment on function public.wekkers_stand(integer) is
  'Wat de wekkers deden, en wat de functie ervan vond (0102). De cron-taak '
  'slaagt al zodra het verzoek is weggezet; pas status_code uit '
  'net._http_response zegt of de functie het aannam.';

-- ---------------------------------------------------------------------------
--  5. En de nieuwe taken meteen plannen
--
--  Stil overslaan mag hier niet: wie 0101 al heeft gedraaid heeft nu taken
--  die hun verzoeknummer weggooien, en die moeten vervangen worden.
-- ---------------------------------------------------------------------------

do $$
declare r record;
begin
  for r in select * from public.wekkers_instellen() loop
    raise notice 'Wekker %: % (%)', r.naam,
      case when r.gelukt then 'gepland' else 'NIET gepland' end,
      coalesce(r.waarom, r.planning);
  end loop;
end $$;
