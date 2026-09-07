-- ===========================================================================
--  Meerdere bv's, elk met een eigen grootboek
--
--  Casper: "Ik heb in exact meerdere bv's, die hebben ook allemaal een eigen
--  grootboekrekening, fix dit."
--
--  Alles wat er tot nu toe staat gaat uit van één administratie. De koppeling
--  bewaart één division, het rekeningschema is één lijst, en een boeking gaat
--  naar "de" administratie. Dat klopt niet meer, en het klopt op een manier
--  die stil misgaat: rekening 4000 bestaat in elke bv en betekent er iets
--  anders. Een factuur van de wasstraat op de 4000 van de holding boeken
--  levert geen foutmelding op -- alleen een verkeerde boeking.
--
--  Daarom eerst dit, en pas daarna de rest. Elke andere stap (tweede
--  goedkeuring, splitsen, verkoopfacturen, betalingen) hangt aan de vraag "in
--  welke bv gebeurt dit", en die vraag moet één keer goed beantwoord zijn.
--
--  Wat er verandert
--  ----------------
--
--    exact_administratie   de bv's die Exact kent, en welke wij gebruiken
--    grootboek             krijgt een administratie; code is niet meer uniek
--                          op zichzelf maar samen met de bv
--    locations             weet bij welke bv hij hoort
--    exact_grootboek       per administratie in plaats van één lijst
--
--  Waarom de bv op de vestiging en niet op de bon
--  ----------------------------------------------
--
--  Een kostenpost weet al bij welke vestiging hij hoort, en een vestiging
--  hoort bij één bv. De bv op de bon zetten zou dat verdubbelen, en dan is er
--  een dag waarop die twee iets anders zeggen. Verhuist een vestiging ooit
--  naar een andere bv, dan is dat één veld -- en oude bonnen die al geboekt
--  zijn dragen hun boekingsnummer en veranderen niet meer.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De administraties
-- ---------------------------------------------------------------------------

create table if not exists public.exact_administratie (
  /* Het divisienummer van Exact. Dit staat in elk API-adres. */
  code       text primary key,
  naam       text not null default '',
  /* Doen we hier iets mee? Een administratie waar wij niets in boeken hoeft
     ook niet elke ophaalronde mee. */
  actief     boolean not null default false,
  /* De administratie waar iets in valt dat nergens anders bij hoort. */
  hoofd      boolean not null default false,
  updated_at bigint not null default public.now_ms()
);

comment on table public.exact_administratie is
  'De bv''s zoals Exact ze kent (0059). actief bepaalt of we er iets mee doen; '
  'hoofd is de terugval voor wat nergens anders bij hoort.';

/* Er kan er maar één de hoofdadministratie zijn. Twee zou betekenen dat de
   terugval afhangt van de volgorde waarin je toevallig leest. */
create unique index if not exists exact_administratie_een_hoofd
  on public.exact_administratie ((hoofd)) where hoofd;

-- ---------------------------------------------------------------------------
--  Het rekeningschema per bv
--
--  exact_grootboek was een lijst met de code als sleutel. Nu hoort dezelfde
--  code in elke administratie thuis, met een eigen omschrijving en een eigen
--  guid. Het is een kopie die bij elke ophaalronde opnieuw wordt gevuld, dus
--  hem leegmaken kost niets.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
     where table_schema = 'public' and table_name = 'exact_grootboek'
       and constraint_type = 'PRIMARY KEY' and constraint_name = 'exact_grootboek_pkey'
  ) and not exists (
    select 1 from information_schema.key_column_usage
     where table_schema = 'public' and table_name = 'exact_grootboek'
       and constraint_name = 'exact_grootboek_pkey' and column_name = 'division'
  ) then
    /* Leeg is goed: de eerstvolgende ophaalronde vult hem opnieuw, en dan
       meteen met de administratie erbij. */
    delete from public.exact_grootboek;
    alter table public.exact_grootboek drop constraint exact_grootboek_pkey;
    alter table public.exact_grootboek alter column division set not null;
    alter table public.exact_grootboek add primary key (division, code);
    raise notice 'exact_grootboek is nu per administratie';
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  Ons eigen grootboek per bv
--
--  Dit is de kern van de vraag. Rekening 4000 bestaat in elke bv en betekent
--  er iets anders, dus "code" alleen is geen sleutel meer.
--
--  Bestaande regels krijgen geen administratie: die stonden er toen er nog
--  één was. Ze blijven werken als "geldt overal", tot iemand ze toewijst.
--  Dat is met opzet -- ze stilzwijgend aan de hoofdadministratie hangen zou
--  een keuze zijn die niemand heeft gemaakt.
-- ---------------------------------------------------------------------------

alter table public.grootboek add column if not exists administratie text;

/*
 * Eerst de verwijzing eruit die eraan hangt.
 *
 * leverancier_boeking.grootboek_code verwees naar grootboek(code) -- het
 * geheugen "deze leverancier boekt meestal op 4031". Dat kan niet blijven
 * zodra dezelfde code in meerdere bv's bestaat: er is dan geen één rij meer
 * om naar te wijzen.
 *
 * En dat hoeft ook niet. Het geheugen onthoudt een CODE, niet een rij; welke
 * bv erbij hoort komt van de vestiging op de bon. "Enexis boekt op 4010" is
 * waar in elke administratie.
 *
 * Wat we ermee kwijtraken is "on delete set null": gooi je een rekening weg,
 * dan blijft die code in het geheugen staan. Dat is te overzien -- het
 * geheugen is een suggestie, en factuur_indelen() zoekt de code alsnog op.
 * 0057 laat een rekening waarop geboekt is bovendien niet weggooien.
 */
do $$
declare c text;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     t on t.oid = con.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'leverancier_boeking'
       and con.contype = 'f'
  loop
    execute format('alter table public.leverancier_boeking drop constraint %I', c);
    raise notice 'verwijzing van leverancier_boeking naar grootboek weg: %', c;
  end loop;
end $$;

/*
 * De oude "uniek op code" eraf, hoe hij ook heet.
 *
 * In 0044 staat hij als "code text not null unique" in de tabeldefinitie, en
 * dan verzint Postgres de naam. Meestal grootboek_code_key, maar daarop
 * gokken is precies het soort aanname dat pas opvalt als er twee bv's zijn en
 * de tweede zijn eigen 4000 niet kwijt kan. Dus opzoeken.
 */
do $$
declare c text;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     t on t.oid = con.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'grootboek'
       and con.contype = 'u'
       and array_length(con.conkey, 1) = 1
       and (select a.attname from pg_attribute a
             where a.attrelid = t.oid and a.attnum = con.conkey[1]) = 'code'
  loop
    execute format('alter table public.grootboek drop constraint %I', c);
    raise notice 'oude unieke sleutel op grootboek.code weg: %', c;
  end loop;
end $$;

/* Uniek per bv. Een lege administratie telt als zijn eigen groep, zodat de
   oude regels ("geldt overal") elkaar nog steeds niet dubbel kunnen zijn. */
create unique index if not exists grootboek_code_per_bv
  on public.grootboek (coalesce(administratie, ''), code);

comment on column public.grootboek.administratie is
  'In welke bv deze rekening geldt (0059). Leeg = geldt overal, zoals het was '
  'voordat er meer dan één administratie was.';

-- ---------------------------------------------------------------------------
--  Welke vestiging in welke bv zit
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists administratie text;

comment on column public.locations.administratie is
  'In welke bv deze vestiging boekt (0059). Leeg = de hoofdadministratie.';

-- ---------------------------------------------------------------------------
--  Wie mag de administraties zien
-- ---------------------------------------------------------------------------

alter table public.exact_administratie enable row level security;

drop policy if exists exact_administratie_select on public.exact_administratie;
create policy exact_administratie_select on public.exact_administratie
  for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk')
         or public.heeft_recht('dev.logs'));

-- ---------------------------------------------------------------------------
--  In welke bv hoort deze bon
--
--  Via de vestiging, met de hoofdadministratie als terugval. Eén plek, want
--  deze vraag komt straks op drie plekken terug -- bij het boeken, bij het
--  tonen en bij het controleren of de rekening wel bestaat.
-- ---------------------------------------------------------------------------

create or replace function public.bon_administratie(expense_in text)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(trim(l.administratie), '')
       from public.expenses e
       left join public.locations l on l.id = e.location_id
      where e.id = expense_in),
    (select a.code from public.exact_administratie a where a.hoofd limit 1)
  );
$$;

revoke execute on function public.bon_administratie(text) from public, anon;
grant  execute on function public.bon_administratie(text) to service_role, authenticated;

comment on function public.bon_administratie(text) is
  'In welke bv deze kostenpost geboekt wordt (0059): die van zijn vestiging, '
  'anders de hoofdadministratie.';

-- ---------------------------------------------------------------------------
--  En de wachtrij kijkt nu ook naar de administratie
--
--  De grootboekrekening moet in DIE bv bestaan. Rekening 4000 van de holding
--  is niet de 4000 van de wasstraat, en zonder deze voorwaarde zou hij de
--  eerste de beste pakken.
-- ---------------------------------------------------------------------------

/* Eerst weg: "create or replace" mag de vorm van een tabelfunctie niet
   wijzigen, en er komt een kolom bij (administratie). Zonder deze regel valt
   de hele migratie om met "cannot change return type of existing function" --
   en dan is er ook niets anders gedraaid. */
drop function if exists public.exact_facturen_wachtend();

create or replace function public.exact_facturen_wachtend()
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
         b.expense_date,
         b.exact_fout
    from bonnen b
    left join public.exact_leverancier l on l.zoeknaam = public.kaal_bedrijf(b.supplier)
    left join public.exact_grootboek   g on g.code = b.grootboek_code
                                        and g.division = b.adm
   order by b.expense_date
   limit 200;
$$;

revoke execute on function public.exact_facturen_wachtend() from public, anon, authenticated;
grant  execute on function public.exact_facturen_wachtend() to service_role;
