-- ===========================================================================
--  Een wekker die je ook buiten zijn uur kunt laten afgaan
--
--  Casper: "En hoe stuur ik die functies, zoals voorraad, taken ect, opnieuw
--  dan?"
--
--  Die knop is er sinds 0107 -- en bij twee van de drie doet hij niets, en
--  dat is precies waarom het lijkt alsof er niets werkt.
--
--  Wat er gebeurt als je nu op "Nu" drukt
--  --------------------------------------
--
--  De knop voert dezelfde opdracht uit als de cron. Dat is met opzet: anders
--  bewijst een geslaagde klik alleen dat de knop werkt. Maar de functies
--  bewaken zichzelf, en terecht:
--
--    takenmail          gaat alleen op de ingestelde uren, en één keer per
--                       uur. Druk je om half drie, dan antwoordt hij
--                       "overgeslagen: het is 14 uur" -- met een 200.
--    voorraad-ochtend   gaat alleen om het ingestelde ochtenduur, en één
--                       keer per dag.
--    voorraad-direct    heeft geen uurgrens; die doet wél gewoon zijn werk.
--
--  Dus: twee van de drie knoppen konden alleen zeggen "niet nu". Dat is
--  eerlijk, maar het is niet wat je wilt als je zit te kijken of de keten
--  overeind staat.
--
--  Wat het wordt
--  -------------
--
--  Een tweede knop, per wekker, die de functie aanroept met de actie waarmee
--  hij zijn eigen uurgrens overslaat. Wat die knop dan DOET verschilt per
--  functie, en dat is geen slordigheid maar hoe die functies zijn gebouwd:
--
--    takenmail          verstuurt nu echt, ook buiten het ingestelde uur
--    voorraad-ochtend   rapporteert alleen: hoeveel alarmen er open staan,
--                       hoe laat het is, naar wie het zou gaan, en of de
--                       mail is ingesteld
--    voorraad-direct    hetzelfde als de wekker; die kent geen uurgrens
--
--  Die uitleg staat in de database en komt op de knop te staan. Eén knop met
--  drie betekenissen en geen tekst erbij zou erger zijn dan geen knop: dan
--  druk je op "forceren" bij de takenmail en verstuur je ongemerkt post naar
--  iedereen.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. De lijst weet nu ook hoe je hem forceert
-- ---------------------------------------------------------------------------

drop function if exists public.wekkers_lijst();

create or replace function public.wekkers_lijst()
returns table (
  naam      text,
  planning  text,
  functie   text,
  actie     text,
  sleutel   text,
  /* De actie waarmee de functie zijn eigen uurgrens overslaat. */
  nu_actie  text,
  /* En wat dat dan doet. Staat op de knop; zie de kop. */
  nu_uitleg text
)
language sql stable as $$
  select * from (values
    ('voorraad-direct',  '*/15 * * * *', 'trucksupply', 'direct',  'voorraad_cron_secret',
     'direct',
     'Doet hetzelfde als de wekker: kijkt welke vestigingen onder hun minimum zitten en mailt daarover. Deze kent geen uurgrens.'),
    ('voorraad-ochtend', '0 4-9 * * *',  'trucksupply', 'ochtend', 'voorraad_cron_secret',
     'test',
     'Rapporteert alleen: hoeveel alarmen er open staan, hoe laat het is, naar wie het zou gaan en of de mail is ingesteld. Verstuurt niets.'),
    ('takenmail',        '0 4-14 * * *', 'takenmail',   'normaal', 'taken_cron_secret',
     'test',
     'VERSTUURT NU ECHT de takenmail naar iedereen met openstaand werk, ook buiten de ingestelde uren.')
  ) as t(naam, planning, functie, actie, sleutel, nu_actie, nu_uitleg);
$$;

revoke execute on function public.wekkers_lijst() from public, anon;
grant  execute on function public.wekkers_lijst() to authenticated, service_role;

comment on function public.wekkers_lijst() is
  'De wekkers, wat ze aanroepen, en hoe je ze buiten hun uur laat gaan (0107, '
  'uitgebreid in 0111). Eén lijst, gebruikt door wekkers_instellen() én door '
  'de knoppen -- anders bewijst een handmatige proef alleen dat de knop werkt.';

-- ---------------------------------------------------------------------------
--  2. De opdracht kan nu een andere actie meekrijgen
--
--  Een extra parameter met een standaardwaarde zou de oude vorm dubbelzinnig
--  maken -- met één argument passen dan allebei. Dus eerst de oude weg.
-- ---------------------------------------------------------------------------

drop function if exists public.wekker_opdracht(text);
drop function if exists public.wekker_opdracht(text, text);

create or replace function public.wekker_opdracht(
  naam_in  text,
  actie_in text default null
)
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
    w.naam, basis || '/' || w.functie,
    coalesce(nullif(trim(actie_in), ''), w.actie), w.sleutel);
end $$;

revoke execute on function public.wekker_opdracht(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
--  3. En de knop kan forceren
-- ---------------------------------------------------------------------------

drop function if exists public.wekker_nu(text);
drop function if exists public.wekker_nu(text, boolean);

create or replace function public.wekker_nu(
  naam_in   text,
  forceren  boolean default false
)
returns table (naam text, verzoek_id bigint, gelukt boolean, waarom text)
language plpgsql security definer set search_path = public as $$
declare
  lijf text;
  fout text;
  nr   bigint;
  w    record;
begin
  if not public.is_developer() then
    raise exception 'Alleen ontwikkeling kan een wekker met de hand laten afgaan.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into w from public.wekkers_lijst() l where l.naam = naam_in;
  if not found then
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

  lijf := public.wekker_opdracht(
    naam_in, case when forceren then w.nu_actie else null end);

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

revoke execute on function public.wekker_nu(text, boolean) from public, anon;
grant  execute on function public.wekker_nu(text, boolean) to authenticated, service_role;

comment on function public.wekker_nu(text, boolean) is
  'Laat één wekker nu afgaan (0107). Met forceren = true de actie waarmee de '
  'functie zijn eigen uurgrens overslaat -- wat dat doet verschilt per '
  'functie en staat in wekkers_lijst().nu_uitleg. Alleen voor ontwikkeling.';

-- ---------------------------------------------------------------------------
--  4. En de stand geeft die uitleg mee aan het scherm
-- ---------------------------------------------------------------------------

drop function if exists public.wekkers_overzicht(integer);

create or replace function public.wekkers_overzicht(hoeveel integer default 20)
returns table (
  naam          text,
  planning      text,
  actief        boolean,
  laatst_at     timestamptz,
  antwoord      integer,
  antwoord_hoe  text,
  inhoud        text,
  mislukt       integer,
  nu_uitleg     text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_developer() then
    raise exception 'Alleen ontwikkeling kan de stand van de wekkers zien.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select s.*, l.nu_uitleg
      from public.wekkers_stand(hoeveel) s
      left join public.wekkers_lijst() l on l.naam = s.naam;
end $$;

revoke execute on function public.wekkers_overzicht(integer) from public, anon;
grant  execute on function public.wekkers_overzicht(integer) to authenticated, service_role;
