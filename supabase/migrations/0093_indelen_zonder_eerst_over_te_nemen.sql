-- ===========================================================================
--  Indelen zonder eerst over te nemen
--
--  Casper: "Kan je dan die grootboekrekeningen in boekhouding niet weghalen
--  dan ook? daarnaast geeft hij aan bij trefwoorden per onderneming dat het er
--  ook 0 zijn?"
--
--  Allebei wijzen ze op hetzelfde: public.grootboek staat overal in de weg en
--  levert niets meer op.
--
--  Wat er gebeurd is
--  -----------------
--
--  Er staan twee rekeningschema's in dit systeem:
--
--      exact_grootboek     wat Exact kent, per administratie
--      public.grootboek    onze eigen korte lijst, per bv sinds 0086
--
--  Het factuurscherm haalt de rekeningen inmiddels uit de eerste -- dat is ook
--  de tabel waar exact_facturen_wachtend() de guid uit haalt, dus dat is wat
--  boekbaar is. public.grootboek was alleen nog nodig om er trefwoorden aan te
--  hangen, en voor die trefwoorden moest je per bv eerst een schema OVERNEMEN.
--
--  Dat is de reden dat er overal 0 staat: dat overnemen heeft nooit iemand
--  gedaan, want tot vandaag was er geen knop. En zolang het er niet stond,
--  deelde factuur_indelen() niets in -- die eiste namelijk
--  `g.administratie = administratie_in`.
--
--  Dus een lege lijst per bv, en een automatisch indelen dat er om die lege
--  lijst niets deed.
--
--  Wat hier verandert
--  ------------------
--
--  De twee vragen worden uit elkaar gehaald:
--
--      BESTAAT deze rekening in die bv?   exact_grootboek -- dat is wat Exact
--                                         kent en wat geboekt kan worden
--      WAAROP herken je hem?              de trefwoorden, en die horen bij een
--                                         CODE en niet bij een bv. "Enexis
--                                         boekt op 4010" is waar in elke
--                                         administratie; 0086 zette daar
--                                         grootboek_sjabloon voor neer
--
--  Daarmee werkt het indelen in elke bv zodra Exact daar een rekening met die
--  code kent -- zonder dat er iets is overgenomen. En public.grootboek is
--  nergens meer een voorwaarde; wat erin staat telt nog wel mee als bron van
--  trefwoorden, want daar staat het werk van 0044 in.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. De trefwoorden bij elkaar, los van de bv
--
--  Twee bronnen, want ze staan er allebei: grootboek_sjabloon (0086, bedoeld
--  als onze kennis per code) en public.grootboek (0044, waar het scherm nog
--  steeds in schrijft). De administratie doet er niet toe -- een trefwoord
--  hoort bij een rekeningnummer.
--
--  Een weergave en geen tabel: twee plekken samenvoegen tot een derde plek is
--  precies hoe ze uit elkaar gaan lopen.
-- ---------------------------------------------------------------------------

create or replace view public.grootboek_trefwoorden as
  select code,
         max(naam) filter (where naam is not null and naam <> '') as naam,
         /* Alles bij elkaar, zonder dubbele. Een trefwoord dat in het sjabloon
            staat en in de eigen lijst is één trefwoord. */
         coalesce(array_agg(distinct t) filter (where t is not null and t <> ''), '{}') as trefwoorden
    from (
      select s.code, s.naam, t
        from public.grootboek_sjabloon s
        left join lateral unnest(s.trefwoorden) as t on true
      union all
      select g.code, g.naam, t
        from public.grootboek g
        left join lateral unnest(g.trefwoorden) as t on true
       where g.actief
    ) alles
   group by code;

comment on view public.grootboek_trefwoorden is
  'Waaraan een rekeningnummer te herkennen is, los van de bv (0093). Een '
  'trefwoord hoort bij een code -- "Enexis boekt op 4010" is waar in elke '
  'administratie. Voegt grootboek_sjabloon (0086) en public.grootboek (0044) '
  'samen, want er wordt in allebei geschreven.';

/*
 * De weergave erft de rechten niet van de tabellen eronder; hij draait onder
 * de aanroeper. Wie grootboek mag lezen mag dit dus ook, en verder niemand --
 * maar Supabase geeft een nieuwe weergave wel aan anon, dus die deur eerst
 * dicht.
 */
revoke all on public.grootboek_trefwoorden from public, anon;
grant select on public.grootboek_trefwoorden to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  2. Indelen kijkt naar wat Exact kent
--
--  De vorm blijft die van 0086 -- zelfde naam, zelfde parameters, zelfde
--  antwoord -- dus de post en de lezer merken er niets van behalve dat het nu
--  ook iets oplevert.
-- ---------------------------------------------------------------------------

create or replace function public.factuur_indelen(
  leverancier_in text,
  omschrijving_in text,
  administratie_in text
)
returns table (grootboek_code text, tags text[], bron text)
language sql stable security definer set search_path = public as $$
  with zoek as (
    select
      lower(trim(coalesce(leverancier_in, ''))) as lev,
      lower(coalesce(leverancier_in, '') || ' ' || coalesce(omschrijving_in, '')) as alles
  ),
  /*
   * Wat er in DEZE bv te boeken valt. Niet onze eigen lijst maar die van
   * Exact: daar haalt exact_facturen_wachtend() de guid uit, en een code die
   * daar niet staat is geen voorstel maar een boeking die geweigerd wordt.
   */
  bestaat as (
    select e.code
      from public.exact_grootboek e
     where e.division = administratie_in
       and not e.geblokkeerd
  ),
  -- 1. Kennen we deze leverancier? En bestaat die rekening in DEZE bv?
  uit_geheugen as (
    select b.grootboek_code, b.tags, 'geheugen'::text as bron
      from public.leverancier_boeking b, zoek z
     where b.leverancier = z.lev
       and b.grootboek_code is not null
       and exists (select 1 from bestaat x where x.code = b.grootboek_code)
  ),
  -- 2. Zo niet: raden op trefwoorden, binnen wat hier bestaat.
  geraden_rekening as (
    select w.code
      from public.grootboek_trefwoorden w, zoek z
     where exists (select 1 from bestaat x where x.code = w.code)
       and exists (select 1 from unnest(w.trefwoorden) t
                    where t <> '' and z.alles like '%' || lower(t) || '%')
     order by w.code
     limit 1
  ),
  geraden_tags as (
    select coalesce(array_agg(k.naam order by k.naam), '{}') as tags
      from public.kosten_tags k, zoek z
     where k.actief
       and exists (select 1 from unnest(k.trefwoorden) t
                    where t <> '' and z.alles like '%' || lower(t) || '%')
  )
  select * from uit_geheugen
  union all
  select (select code from geraden_rekening),
         (select tags from geraden_tags),
         'geraden'
   where not exists (select 1 from uit_geheugen)
  limit 1;
$$;

revoke execute on function public.factuur_indelen(text, text, text) from public, anon;
grant  execute on function public.factuur_indelen(text, text, text) to service_role, authenticated;

comment on function public.factuur_indelen(text, text, text) is
  'Hoe deze factuur waarschijnlijk geboekt moet worden, binnen de opgegeven bv '
  '(0086). Sinds 0093 tegen exact_grootboek in plaats van tegen onze eigen '
  'lijst: een rekening die Exact daar kent is boekbaar, of wij het schema '
  'hebben overgenomen of niet.';

-- ---------------------------------------------------------------------------
--  3. En het geheugen leert nog steeds bij
--
--  boeking_onthouden() (0044) schrijft alleen in leverancier_boeking en raakt
--  public.grootboek niet aan. Die blijft dus werken zoals hij werkte, en is
--  door het bovenstaande nu ook in een bv bruikbaar waar niets is overgenomen.
--
--  Dat staat hier opgeschreven omdat de verleiding bestaat hem "ook even mee
--  te nemen", en daar is geen reden voor.
-- ---------------------------------------------------------------------------
