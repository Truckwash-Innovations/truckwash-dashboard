-- ===========================================================================
--  De server zegt zelf welke versie hij draait
--
--  Casper: "fix het allemaal" -- dit is de eerste van zes.
--
--  Wat er stond
--  ------------
--
--  Niets. Er was geen tabel, geen nummer, geen tijdstip. Het schema werd
--  bijgewerkt door supabase/bijwerken.sql met de hand in de SQL-editor te
--  plakken, en daarna was er geen enkele manier om te zien of dat gelukt was.
--
--  Dat betekende dat bij elke storing de eerste vraag "heb je de sql
--  gedraaid?" was, en het antwoord een herinnering. Een foutmelding over een
--  functie die niet bestaat ziet er namelijk precies zo uit als een functie
--  die stuk is.
--
--  Hetzelfde gold voor de edge functions: "npm run functions" vergeten is van
--  buitenaf niet te onderscheiden van een functie die het niet doet.
--
--  Wat het wordt
--  -------------
--
--  Twee tabellen die bijhouden wat er draait, en een functie die het in een
--  keer teruggeeft:
--
--    schema_stand    welke migraties zijn toegepast, en wanneer
--    functie_stand   welke versie elke edge function draait, en wanneer hij
--                    voor het laatst is opgestart
--
--  De migraties schrijven zichzelf in. Niet in het migratiebestand zelf --
--  dan zou ik er honderd moeten aanpassen -- maar in de uitdraai:
--  scripts/build-setup-sql.cjs en build-bijwerken-sql.cjs plakken achter elke
--  migratie een blokje dat migratie_gedaan() aanroept. Dat blokje kijkt eerst
--  of die functie al bestaat, zodat het in de migraties vóór deze een lege
--  handeling is.
--
--  Wat hier NIET gebeurt
--  ---------------------
--
--  Deze tabel maakt niets waar. Hij noteert wat er is gedraaid; hij
--  controleert niet of het schema klopt en hij draait niets na. Wie de
--  migraties in de verkeerde volgorde of half draait krijgt een nummer dat
--  liegt. Dat is een bewuste grens: een echte schemacontrole is een ander
--  gereedschap, en een half werkende zou erger zijn dan geen.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Welke migraties zijn toegepast
-- ---------------------------------------------------------------------------

create table if not exists public.schema_stand (
  /* Het nummer uit de bestandsnaam: 103 voor deze. */
  nummer       integer primary key,
  /* De eerste regel uit de kop van de migratie, zodat het nummer iets zegt. */
  naam         text not null default '',
  /*
   * Wanneer hij is gedraaid. Null betekent iets anders dan nul: "we nemen aan
   * dat hij gedraaid is, maar we hebben het niet zien gebeuren". Dat geldt
   * voor alles van vóór deze migratie -- die konden zichzelf nog niet
   * inschrijven, en dat verzwijgen zou precies de soort leugen zijn waar deze
   * tabel voor bedoeld is.
   */
  toegepast_at bigint
);

comment on table public.schema_stand is
  'Welke migraties deze database heeft gezien (0103). toegepast_at null = '
  'aangenomen omdat een latere migratie draaide, niet zelf waargenomen.';

alter table public.schema_stand enable row level security;

/* Lezen mag iedereen die binnen werkt: het staat ook op het
   ontwikkelaarsscherm. Schrijven doet alleen de functie hieronder, en die is
   security definer. */
drop policy if exists schema_stand_lezen on public.schema_stand;
create policy schema_stand_lezen on public.schema_stand
  for select using (public.is_staff());

-- ---------------------------------------------------------------------------
--  2. Een migratie schrijft zichzelf in
--
--  De aanroep hiervan staat niet in de migratiebestanden maar in de uitdraai
--  die de bouwscripts maken. Zie de kop.
-- ---------------------------------------------------------------------------

create or replace function public.migratie_gedaan(p_nummer integer, p_naam text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.schema_stand (nummer, naam, toegepast_at)
  values (p_nummer, coalesce(nullif(trim(p_naam), ''), ''), public.now_ms())
  on conflict (nummer) do update
    set naam = case
                 when excluded.naam <> '' then excluded.naam
                 else schema_stand.naam
               end,
        toegepast_at = excluded.toegepast_at;
$$;

revoke execute on function public.migratie_gedaan(integer, text) from public, anon, authenticated;

/*
 * En wat er vóór deze migratie draaide.
 *
 * Wie hier komt heeft 0001 tot en met 0102 gedraaid -- anders zou de helft
 * van wat hierboven staat niet bestaan. Dat mag dus aangenomen worden. Maar
 * het blijft een aanname, en daarom blijft toegepast_at leeg.
 */
insert into public.schema_stand (nummer, naam, toegepast_at)
select g, '', null from generate_series(1, 102) g
on conflict (nummer) do nothing;

-- ---------------------------------------------------------------------------
--  3. Welke versie draait elke edge function
--
--  De functies melden zich bij het opstarten. Dat gebeurt bij elke koude
--  start -- vaak genoeg om actueel te zijn, zelden genoeg om iets te kosten.
-- ---------------------------------------------------------------------------

create table if not exists public.functie_stand (
  /* De mapnaam onder supabase/functions, bijvoorbeeld "exact". */
  naam      text primary key,
  /* De versie uit package.json op het moment van uitrollen. */
  versie    text not null default '',
  /* Wanneer die uitrol is gemaakt, als ISO-tekst. */
  gebouwd   text not null default '',
  /* Wanneer deze functie voor het laatst is opgestart. */
  gezien_at bigint not null default public.now_ms()
);

comment on table public.functie_stand is
  'Welke versie elke edge function draait, gemeld bij elke koude start (0103). '
  'Een functie die hier ontbreekt of een oude versie toont, is niet uitgerold.';

alter table public.functie_stand enable row level security;

drop policy if exists functie_stand_lezen on public.functie_stand;
create policy functie_stand_lezen on public.functie_stand
  for select using (public.is_staff());

create or replace function public.functie_gezien(
  p_naam text, p_versie text, p_gebouwd text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.functie_stand (naam, versie, gebouwd, gezien_at)
  values (trim(p_naam), coalesce(p_versie, ''), coalesce(p_gebouwd, ''), public.now_ms())
  on conflict (naam) do update
    set versie    = excluded.versie,
        gebouwd   = excluded.gebouwd,
        gezien_at = excluded.gezien_at;
$$;

revoke execute on function public.functie_gezien(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
--  4. Alles in een keer, voor het scherm
--
--  Een aanroep in plaats van twee, zodat het scherm niet twee keer hoeft te
--  wachten en er geen half ingevulde stand in beeld kan staan.
-- ---------------------------------------------------------------------------

drop function if exists public.server_stand();

create or replace function public.server_stand()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'schema', jsonb_build_object(
      'nummer',     coalesce((select max(nummer) from public.schema_stand), 0),
      'naam',       (select naam from public.schema_stand order by nummer desc limit 1),
      'at',         (select toegepast_at from public.schema_stand
                      order by nummer desc limit 1),
      /* Tot hier hebben we het echt zien gebeuren. */
      'gezien',     coalesce((select max(nummer) from public.schema_stand
                               where toegepast_at is not null), 0),
      'aangenomen', (select count(*) from public.schema_stand where toegepast_at is null)
    ),
    'functies', coalesce((
      select jsonb_agg(jsonb_build_object(
               'naam', naam, 'versie', versie,
               'gebouwd', gebouwd, 'gezienAt', gezien_at)
             order by naam)
      from public.functie_stand
    ), '[]'::jsonb)
  )
  where public.is_staff();
$$;

revoke execute on function public.server_stand() from public, anon;
grant execute on function public.server_stand() to authenticated;
