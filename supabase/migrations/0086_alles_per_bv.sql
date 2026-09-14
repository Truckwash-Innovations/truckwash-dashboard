-- ===========================================================================
--  Alles per bv
--
--  Casper: "Hij wilt niks naar exact sturen. Per vestiging/bv heb je een
--  andere grootboek ect. Zorg dat je echt alles koppelt met exact per bv, dus
--  ook het inkomende mail ect. Nu is het te onduidelijk, en werkt het gewoon
--  niet."
--
--  En daarna: "Er zijn meer bv's dan vestigingen he, houdt hier rekening
--  mee." En: "Zorg er ook voor dat je alle huidige grootboeken in zijn geheel
--  vervangt voor die per bv dan."
--
--  Wat er aan de hand was
--  ----------------------
--
--  0059 heeft de DATABASE per bv ingericht: exact_grootboek kreeg de sleutel
--  (division, code), locations kreeg een administratie, de boeking gaat naar
--  de bv van de bon. Maar drie dingen zijn achtergebleven, en het zijn precies
--  de drie die een boeking nodig heeft:
--
--    de CREDITEUR    exact_leverancier heeft zoeknaam als sleutel en één
--                    exact_id. Een crediteur-guid hoort bij precies één
--                    administratie -- exact_relatie wordt per bv opgehaald --
--                    dus dezelfde Shell heeft in elke bv een ander id. Werd
--                    er gekoppeld in bv A, dan ging in bv B diezelfde guid
--                    mee, en die kent Exact daar niet.
--
--    het DAGBOEK     één sleutel exact_dagboek voor alle bv's. Dagboek 70
--                    bestaat niet gegarandeerd in elke administratie, en waar
--                    het een ander type heeft komt de boeking op de verkeerde
--                    plek. De proefrit gaf dat zelf al toe: "kies er een die
--                    overal bestaat, of boek in deze bv niet."
--
--    de BTW-CODE     idem: één code voor twintig administraties.
--
--  Het gevolg is niet "soms gaat er iets mis". Het gevolg is dat er vanaf de
--  tweede bv niets meer doorkomt, met een foutmelding van Exact die over een
--  onbekende relatie gaat en niet over onze inrichting.
--
--  Het grootboek gaat in zijn geheel om
--  ------------------------------------
--
--  0044 hield public.grootboek met opzet kort: "een compleet rekeningschema
--  overtypen levert een lijst op waar niemand doorheen komt." Dat argument
--  klopte toen er één administratie was. Met twintig is de uitkomst
--  omgekeerd: één korte lijst zonder bv betekent dat je een rekening kiest
--  die in de bv van díe bon niet bestaat, en dat merk je pas als Exact de
--  boeking weigert.
--
--  Dus wordt het schema van Exact de bron, per bv. Wat we zelf hadden
--  toegevoegd -- de trefwoorden waarop het automatisch indelen zoekt, en de
--  eigen naam -- blijft bewaard en wordt per code overgenomen. "Enexis boekt
--  op 4010" is waar in elke administratie; welke rekeningen er bestaan niet.
--
--  Meer bv's dan vestigingen
--  -------------------------
--
--  Truckwash 1 Group, Vastgoed, Techniek & Beheer, Truckshop, Truckstop: die
--  hebben geen wasstraat en dus geen vestiging. bon_administratie() kan ze
--  daarom nooit via de vestiging vinden -- alleen van het stuk (0079) of met
--  de hand. Dat is precies waarom de kolommen kvk en btw_nummer bestaan, en
--  waarom ze ingevuld moeten kunnen worden. Dat gebeurt in de app; hier wordt
--  alleen gezorgd dat een bv zonder vestiging geen tweederangs bv is.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. De crediteur hoort bij een bv
--
--  Zoals company_exact dat al deed sinds 0063: primary key (company_id,
--  division). De inkoopkant had die les nooit geleerd.
-- ---------------------------------------------------------------------------

alter table public.exact_leverancier add column if not exists administratie text;

/*
 * Wat er al gekoppeld is, hoort bij de bv waar het toen voor bedoeld was.
 *
 * Dat kunnen we niet weten -- er was maar één administratie in beeld. De
 * hoofdadministratie is de eerlijkste gok, en het is te herstellen: een
 * koppeling die nergens naar wijst wordt gemeld door de proefrit.
 */
update public.exact_leverancier
   set administratie = coalesce(
     (select a.code from public.exact_administratie a where a.hoofd limit 1),
     (select r.division from public.exact_relatie r
       where r.exact_id = public.exact_leverancier.exact_id limit 1))
 where administratie is null;

/* Wat daarna nog leeg is, hoort bij geen enkele bv en kan dus nooit boeken. */
delete from public.exact_leverancier where administratie is null;

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
     where table_schema = 'public' and table_name = 'exact_leverancier'
       and constraint_type = 'PRIMARY KEY'
  ) and not exists (
    select 1 from information_schema.key_column_usage
     where table_schema = 'public' and table_name = 'exact_leverancier'
       and constraint_name = 'exact_leverancier_pkey' and column_name = 'administratie'
  ) then
    alter table public.exact_leverancier drop constraint exact_leverancier_pkey;
    alter table public.exact_leverancier alter column administratie set not null;
    alter table public.exact_leverancier add primary key (administratie, zoeknaam);
    raise notice 'exact_leverancier is nu per administratie';
  end if;
end $$;

comment on table public.exact_leverancier is
  'Welke leverancier op onze bon welke crediteur in Exact is (0058), PER BV '
  '(0086). Een crediteur-guid hoort bij precies één administratie -- dezelfde '
  'Shell heeft in elke bv een ander id, en de guid van bv A wordt door bv B '
  'niet herkend.';

-- ---------------------------------------------------------------------------
--  2. Het dagboek en de btw-codes horen bij een bv
--
--  Op exact_administratie en niet in public.instellingen: die tabel is er één
--  van elk, en dit is er één per bv. Precies zoals eigen_iban daar in 0065 is
--  gezet, en om dezelfde reden.
--
--  De globale sleutels uit 0058 blijven bestaan als TERUGVAL. Dat is geen
--  halfheid maar wat er moet gebeuren bij het overgaan: er staat nu een
--  werkende waarde in, en die hoort te blijven werken voor de bv waar hij
--  voor was. Wie een bv zijn eigen dagboek geeft, overschrijft hem.
-- ---------------------------------------------------------------------------

alter table public.exact_administratie add column if not exists inkoop_dagboek  text;
alter table public.exact_administratie add column if not exists verkoop_dagboek text;
alter table public.exact_administratie add column if not exists btw_21 text;
alter table public.exact_administratie add column if not exists btw_9  text;
alter table public.exact_administratie add column if not exists btw_0  text;

comment on column public.exact_administratie.inkoop_dagboek is
  'Het inkoopdagboek van DEZE bv (0086). Leeg = de globale instelling '
  'exact_dagboek, die er was toen er nog één administratie was.';

/**
 * Wat er voor deze bv geldt: eigen waarde, anders de globale.
 *
 * Eén plek, want dit wordt op vier plekken gevraagd -- bij het boeken, bij
 * de proefrit, bij het tonen van wat er nog mist, en bij de keuzelijsten.
 * Vier keer dezelfde terugval overtypen is drie kansen om hem net anders op
 * te schrijven.
 */
create or replace function public.bv_boekinstelling(bv text)
returns table (inkoop_dagboek text, verkoop_dagboek text, btw_21 text, btw_9 text, btw_0 text)
language sql stable security definer set search_path = public as $$
  select
    coalesce(nullif(trim(a.inkoop_dagboek), ''),
             (select nullif(trim(i.waarde), '') from public.instellingen i
               where i.sleutel = 'exact_dagboek')),
    coalesce(nullif(trim(a.verkoop_dagboek), ''),
             (select nullif(trim(i.waarde), '') from public.instellingen i
               where i.sleutel = 'exact_verkoopdagboek')),
    coalesce(nullif(trim(a.btw_21), ''),
             (select nullif(trim(i.waarde), '') from public.instellingen i
               where i.sleutel = 'exact_btw_21')),
    coalesce(nullif(trim(a.btw_9), ''),
             (select nullif(trim(i.waarde), '') from public.instellingen i
               where i.sleutel = 'exact_btw_9')),
    coalesce(nullif(trim(a.btw_0), ''),
             (select nullif(trim(i.waarde), '') from public.instellingen i
               where i.sleutel = 'exact_btw_0'))
  from public.exact_administratie a
  where a.code = bv;
$$;

revoke execute on function public.bv_boekinstelling(text) from public, anon;
grant  execute on function public.bv_boekinstelling(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  3. Het grootboek in zijn geheel per bv
--
--  Casper: "Zorg er ook voor dat je alle huidige grootboeken in zijn geheel
--  vervangt voor die per bv dan."
--
--  Wat er nu staat is één lijst van twaalf zelfbedachte rekeningen zonder bv.
--  Die wordt vervangen door wat Exact per administratie werkelijk kent -- met
--  behoud van het enige dat van ons was en waarde had: de trefwoorden waarop
--  factuur_indelen() zoekt, en de eigen naam als die is aangepast.
-- ---------------------------------------------------------------------------

/*
 * De trefwoorden per code, los van de bv.
 *
 * "Enexis boekt op 4010" is waar in elke administratie; welke rekeningen er
 * bestaan niet. Door dit apart te zetten overleeft het werk dat iemand in de
 * trefwoorden heeft gestoken elke keer dat het schema opnieuw wordt
 * overgenomen -- anders is het na de eerste ophaalronde weg.
 */
create table if not exists public.grootboek_sjabloon (
  /* De sleutel heet id, zoals overal in dit schema. 0044 legt uit waarom dat
     geen smaakkwestie is: de synchronisatie vergelijkt elke binnengehaalde
     rij met de wachtrij op rij.id, en rij_bestaat() -- de uitweg uit de
     upsert-val -- zoekt hard op "where id = $1". Een tabel met een andere
     sleutelnaam levert daar stilletjes niets op. De sqltest bewaakt dit, en
     ving deze tabel meteen. */
  id          text primary key,
  code        text not null unique,
  naam        text,
  trefwoorden text[] not null default '{}',
  categorie   text,
  btw_pct     integer,
  updated_at  bigint not null default public.now_ms()
);

comment on table public.grootboek_sjabloon is
  'Onze eigen kennis per rekeningcode, los van de bv (0086): de trefwoorden '
  'waarop het indelen zoekt, en een eigen naam. Overleeft het opnieuw '
  'overnemen van het schema uit Exact.';

/* Wat er in public.grootboek stond wordt het sjabloon. Dat is het werk uit
   0044 plus alles wat er sindsdien met de hand bij is gezet. */
insert into public.grootboek_sjabloon (id, code, naam, trefwoorden, categorie, btw_pct)
select 'gs_' || g.code,
       g.code,
       min(g.naam),
       /* coalesce eromheen: array_agg met een filter geeft NULL terug als er
          geen enkel trefwoord is, en de kolom laat dat niet toe. Een rekening
          zonder trefwoorden is niet fout -- die wordt alleen nooit geraden. */
       coalesce(array_agg(distinct t) filter (where t is not null), '{}'),
       min(g.categorie),
       min(g.btw_pct)
  from public.grootboek g
  left join lateral unnest(g.trefwoorden) as t on true
 group by g.code
on conflict (id) do update
  set trefwoorden = case
        when cardinality(excluded.trefwoorden) > 0 then excluded.trefwoorden
        else public.grootboek_sjabloon.trefwoorden end,
      naam       = coalesce(public.grootboek_sjabloon.naam, excluded.naam),
      categorie  = coalesce(public.grootboek_sjabloon.categorie, excluded.categorie),
      updated_at = public.now_ms();

alter table public.grootboek_sjabloon enable row level security;

drop policy if exists grootboek_sjabloon_select on public.grootboek_sjabloon;
create policy grootboek_sjabloon_select on public.grootboek_sjabloon
  for select to authenticated using (public.is_staff());

drop policy if exists grootboek_sjabloon_insert on public.grootboek_sjabloon;
create policy grootboek_sjabloon_insert on public.grootboek_sjabloon
  for insert to authenticated
  with check (public.rij_bestaat('public.grootboek_sjabloon'::regclass, id)
              or public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists grootboek_sjabloon_update on public.grootboek_sjabloon;
create policy grootboek_sjabloon_update on public.grootboek_sjabloon
  for update to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'))
  with check (public.is_management() or public.heeft_recht('admin.desk'));

-- ---------------------------------------------------------------------------
--  Het schema van een bv overnemen
--
--  Neemt alles over wat Exact in die administratie kent en niet geblokkeerd
--  is. Wat er al stond blijft staan met zijn eigen naam en trefwoorden; wat
--  er nieuw is krijgt ze uit het sjabloon.
--
--  Wat er NIET gebeurt is weggooien wat er niet meer in Exact staat. Daar kan
--  op geboekt zijn, en 0057 laat een rekening met boekingen er niet uit. Wat
--  verdwenen is komt op actief = false te staan: dan kun je hem niet meer
--  kiezen en blijft de historie leesbaar.
-- ---------------------------------------------------------------------------

create or replace function public.grootboek_overnemen(bv text)
returns table (nieuw integer, bijgewerkt integer, uit integer)
language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  b integer := 0;
  u integer := 0;
begin
  if coalesce(trim(bv), '') = '' then
    raise exception 'Zonder bv is er geen schema om over te nemen';
  end if;

  /* Nieuw erbij, met de trefwoorden uit het sjabloon. */
  with binnen as (
    insert into public.grootboek (id, code, naam, administratie, trefwoorden, categorie, btw_pct, actief)
    select
      'gb_' || bv || '_' || e.code,
      e.code,
      coalesce(nullif(trim(s.naam), ''), nullif(trim(e.omschrijving), ''), e.code),
      bv,
      coalesce(s.trefwoorden, '{}'),
      coalesce(s.categorie, e.soort),
      coalesce(s.btw_pct, 21),
      not e.geblokkeerd
      from public.exact_grootboek e
      left join public.grootboek_sjabloon s on s.code = e.code
     where e.division = bv
    on conflict (id) do nothing
    returning 1
  )
  select count(*)::integer into n from binnen;

  /* Wat er al stond: de omschrijving van Exact bijwerken als wij geen eigen
     naam hebben, en de blokkade overnemen. De trefwoorden blijven van ons. */
  update public.grootboek g
     set actief = not e.geblokkeerd,
         updated_at = public.now_ms()
    from public.exact_grootboek e
   where e.division = bv
     and g.administratie = bv
     and g.code = e.code
     and g.actief is distinct from (not e.geblokkeerd);
  get diagnostics b = row_count;

  /* En wat Exact in deze bv niet (meer) kent, gaat uit. Niet weg: er kan op
     geboekt zijn, en dan is de historie onleesbaar zonder de naam. */
  update public.grootboek g
     set actief = false, updated_at = public.now_ms()
   where g.administratie = bv
     and g.actief
     and not exists (
       select 1 from public.exact_grootboek e
        where e.division = bv and e.code = g.code);
  get diagnostics u = row_count;

  nieuw := n; bijgewerkt := b; uit := u;
  return next;
end $$;

revoke execute on function public.grootboek_overnemen(text) from public, anon, authenticated;
grant  execute on function public.grootboek_overnemen(text) to service_role;

comment on function public.grootboek_overnemen(text) is
  'Neemt het rekeningschema van één bv over uit exact_grootboek (0086). '
  'Trefwoorden komen uit grootboek_sjabloon en blijven behouden; wat Exact '
  'niet meer kent gaat op inactief in plaats van weg.';

-- ---------------------------------------------------------------------------
--  Indelen kent nu de bv
--
--  factuur_indelen() koos een rekening uit de hele lijst, zonder te weten in
--  welke administratie de bon hoort. Met twintig bv's betekende dat: een code
--  die in de bv van díe bon niet bestaat, en een boeking die Exact weigert.
--
--  De oude vorm blijft bestaan (zonder bv) zodat niets stukloopt dat hem nog
--  aanroept; hij zoekt dan in het sjabloon, wat dichter bij het oude gedrag
--  ligt dan een willekeurige bv kiezen.
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
  -- 1. Kennen we deze leverancier? En bestaat die rekening in DEZE bv?
  uit_geheugen as (
    select b.grootboek_code, b.tags, 'geheugen'::text as bron
      from public.leverancier_boeking b, zoek z
     where b.leverancier = z.lev
       and b.grootboek_code is not null
       and exists (
         select 1 from public.grootboek g
          where g.code = b.grootboek_code
            and g.administratie = administratie_in
            and g.actief)
  ),
  -- 2. Zo niet: raden op trefwoorden, maar alleen binnen deze bv.
  geraden_rekening as (
    select g.code
      from public.grootboek g, zoek z
     where g.actief
       and g.administratie = administratie_in
       and exists (select 1 from unnest(g.trefwoorden) t
                    where t <> '' and z.alles like '%' || lower(t) || '%')
     order by g.code
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
  'Hoe deze factuur waarschijnlijk geboekt moet worden, BINNEN de opgegeven '
  'bv (0086). Een code die in die administratie niet bestaat is geen '
  'voorstel maar een boeking die Exact weigert.';

-- ---------------------------------------------------------------------------
--  En de wachtrij kijkt naar de crediteur van DEZE bv
--
--  De join stond op zoeknaam alleen. Daarmee kwam de guid van de ene bv mee
--  in de boeking van de andere.
-- ---------------------------------------------------------------------------

drop function if exists public.exact_facturen_wachtend();

create function public.exact_facturen_wachtend()
returns table (
  id             text,
  leverancier    text,
  zoeknaam       text,
  factuurnummer  text,
  bedrag         numeric,
  btw_pct        integer,
  grootboek_code text,
  grootboek_id   text,
  crediteur_id   text,
  crediteur_naam text,
  administratie  text,
  kenmerk        text,
  /* Het dagboek en de btw-code van DEZE bv (0086). Leeg = die bv heeft er
     geen, en dan kan de bon niet geboekt worden -- dat hoort te blijken
     vóór het versturen en niet als een 400 van Exact. */
  dagboek        text,
  btw_code       text,
  datum          bigint,
  fout           text
)
language sql stable security definer set search_path = public as $$
  with bonnen as (
    select e.*, public.bon_administratie(e.id) as adm
      from public.expenses e
     where e.status = 'goedgekeurd'
       and e.exact_id is null
  )
  select b.id,
         coalesce(b.supplier, ''),
         public.kaal_bedrijf(b.supplier),
         b.factuurnummer,
         b.amount_excl,
         b.vat_pct,
         b.grootboek_code,
         g.exact_id,
         l.exact_id,
         l.exact_naam,
         b.adm,
         nullif(trim(coalesce(b.gelezen ->> 'kenmerk', '')), ''),
         i.inkoop_dagboek,
         case coalesce(b.vat_pct, 21)
           when 9 then i.btw_9
           when 0 then i.btw_0
           else i.btw_21
         end,
         b.expense_date,
         b.exact_fout
    from bonnen b
    left join lateral public.bv_boekinstelling(b.adm) i on true
    left join public.exact_leverancier l on l.zoeknaam = public.kaal_bedrijf(b.supplier)
                                        and l.administratie = b.adm
    left join public.exact_grootboek   g on g.code = b.grootboek_code
                                        and g.division = b.adm
   order by b.expense_date
   limit 200;
$$;

revoke execute on function public.exact_facturen_wachtend() from public, anon, authenticated;
grant  execute on function public.exact_facturen_wachtend() to service_role;

-- ---------------------------------------------------------------------------
--  Het automatisch koppelen kent nu ook de bv
--
--  exact_relaties_klaarzetten() koppelde een leverancier op naam zonder
--  division. Met twintig bv's staat dezelfde Shell er twintig keer in, dus
--  "precies één met die naam" was nooit meer waar en er werd niets meer
--  gekoppeld. Nu per bv, en dan is eenduidig weer eenduidig.
-- ---------------------------------------------------------------------------

create or replace function public.exact_relaties_klaarzetten(door_in text default null)
returns table (leveranciers integer, bedrijven integer)
language plpgsql security definer set search_path = public as $$
begin
  update public.exact_relatie
     set zoeknaam = public.kaal_bedrijf(naam)
   where zoeknaam is distinct from public.kaal_bedrijf(naam);

  /* --- de leveranciers op onze bonnen, per bv --- */
  with kandidaten as (
    select public.kaal_bedrijf(e.supplier) as zoeknaam,
           public.bon_administratie(e.id)  as adm,
           min(e.supplier)                 as gezien_als
      from public.expenses e
     where e.status in ('open', 'eerste_akkoord', 'goedgekeurd')
       and e.exact_id is null
       and public.kaal_bedrijf(e.supplier) is not null
     group by 1, 2
  ),
  eenduidig as (
    select k.zoeknaam, k.adm, k.gezien_als,
           min(r.exact_id) as exact_id, min(r.naam) as naam
      from kandidaten k
      join public.exact_relatie r on r.zoeknaam = k.zoeknaam
                                 and r.is_leverancier
                                 and r.division = k.adm
     where k.adm is not null
       and not exists (select 1 from public.exact_leverancier l
                        where l.zoeknaam = k.zoeknaam and l.administratie = k.adm)
     group by k.zoeknaam, k.adm, k.gezien_als
    having count(*) = 1
  )
  insert into public.exact_leverancier
    (zoeknaam, administratie, gezien_als, exact_id, exact_naam, bron, door)
  select zoeknaam, adm, gezien_als, exact_id, naam, 'naam', door_in from eenduidig
  on conflict (administratie, zoeknaam) do nothing;

  get diagnostics leveranciers = row_count;

  /* --- en onze bedrijven (stond al per bv, sinds 0063) --- */
  with eenduidig as (
    select c.id as company_id, r.division, min(r.exact_id) as exact_id, min(r.naam) as naam
      from public.companies c
      join public.exact_relatie r on r.zoeknaam = public.kaal_bedrijf(c.name) and r.is_klant
     where not exists (select 1 from public.company_exact ce
                        where ce.company_id = c.id and ce.division = r.division)
     group by c.id, r.division
    having count(*) = 1
  )
  insert into public.company_exact (company_id, division, exact_id, exact_naam, bron, door)
  select company_id, division, exact_id, naam, 'naam', door_in from eenduidig
  on conflict (company_id, division) do nothing;

  get diagnostics bedrijven = row_count;

  return next;
end $$;

revoke execute on function public.exact_relaties_klaarzetten(text) from public, anon, authenticated;
grant  execute on function public.exact_relaties_klaarzetten(text) to service_role;

-- ---------------------------------------------------------------------------
--  Wat er aan een bon ontbreekt, in één vraag
--
--  bonnen_zonder_bv() uit 0079 keek alleen naar de bv en de rekening, en werd
--  bovendien nergens aangeroepen. Dit is de volledige lijst, inclusief de
--  crediteur, het dagboek en de btw-code van díe bv -- de vier dingen die een
--  boeking nodig heeft.
--
--  Bedoeld voor het scherm waar iemand goedkeurt. Daar stond tot nu toe
--  nergens dat een factuur nooit geboekt zou worden.
-- ---------------------------------------------------------------------------

create or replace function public.bon_niet_boekbaar()
returns table (id text, leverancier text, bedrag numeric, administratie text, wat text[], reden text)
language sql stable security definer set search_path = public as $$
  select w.id,
         w.leverancier,
         w.bedrag,
         w.administratie,
         array_remove(array[
           case when w.administratie is null then 'onderneming' end,
           case when w.grootboek_code is null then 'grootboekrekening' end,
           case when w.grootboek_code is not null and w.grootboek_id is null
                then 'rekening bestaat niet in deze bv' end,
           case when w.crediteur_id is null then 'crediteur' end,
           case when w.dagboek is null then 'inkoopdagboek' end,
           case when w.btw_code is null then 'btw-code' end
         ], null),
         case
           when w.administratie is null
             then 'Er is geen onderneming bekend om op te boeken. Kies er een bij de factuur.'
           when w.grootboek_code is null
             then 'Er staat geen grootboekrekening op.'
           when w.grootboek_id is null
             then format('Rekening %s bestaat niet in %s. Neem het schema van die bv over, of kies een andere rekening.',
                         w.grootboek_code, w.administratie)
           when w.crediteur_id is null
             then format('%s is in %s nog niet aan een crediteur gekoppeld.',
                         w.leverancier, w.administratie)
           when w.dagboek is null
             then format('Voor %s staat geen inkoopdagboek.', w.administratie)
           when w.btw_code is null
             then format('Voor %s staat geen btw-code voor %s%%.', w.administratie, coalesce(w.btw_pct, 21))
           else 'Onbekend'
         end
    from public.exact_facturen_wachtend() w
   where w.administratie is null
      or w.grootboek_id is null
      or w.crediteur_id is null
      or w.dagboek is null
      or w.btw_code is null;
$$;

revoke execute on function public.bon_niet_boekbaar() from public, anon;
grant  execute on function public.bon_niet_boekbaar() to authenticated, service_role;

comment on function public.bon_niet_boekbaar() is
  'Goedgekeurde facturen die niet naar Exact kunnen, met per stuk wat er '
  'ontbreekt en wat je eraan doet (0086). Voor het scherm waar iemand '
  'goedkeurt -- daar stond tot nu toe nergens dat een factuur zou blijven '
  'liggen.';
