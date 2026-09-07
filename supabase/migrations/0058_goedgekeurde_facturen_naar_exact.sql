-- ===========================================================================
--  Goedgekeurde facturen naar Exact
--
--  Casper: "uiteindelijk wil ik natuurlijk als er facturen goedgekeurd
--  worden, bij exact netjes komen, zodat we blue10 volledig weg kunnen halen.
--  Kan je dat wel alvast integreren, maar voor nu even uit laten zetten? bij
--  ontwikkelaar moet ik dat aan en uit kunnen zetten."
--
--  Dus: alles staat er, en er gaat niets. De schakelaar staat op uit, en
--  zolang die uit staat weigert de serverfunctie te versturen -- niet alleen
--  het scherm. Een knop die je verstopt is geen slot.
--
--  Wat een inkoopboeking bij Exact nodig heeft
--  -------------------------------------------
--
--  Drie dingen, en geen ervan is te verzinnen:
--
--    1. een DAGBOEK -- het inkoopdagboek, vaak 70. Staat in jullie eigen
--       administratie en verschilt per inrichting.
--    2. de LEVERANCIER als relatie in Exact. Een boeking wijst naar een
--       crediteur met een guid, niet naar "Shell Nederland" zoals het op de
--       bon staat. Daar is deze koppeltabel voor.
--    3. de BTW-CODE. 21% heet in Exact niet "21" maar een code die per
--       administratie kan verschillen.
--
--  Het rekeningschema was het vierde, en dat staat er al (0053/0057): een
--  boeking wijst naar de guid van de grootboekrekening, en die bewaren we
--  in exact_grootboek.exact_id.
--
--  Waarom de leverancier een eigen tabel krijgt
--  --------------------------------------------
--
--  expenses.supplier is vrije tekst van de factuur. Dezelfde leverancier
--  heet daar de ene keer "Shell Nederland Verkoopmij B.V." en de andere keer
--  "SHELL NEDERLAND VERKOOPMAATSCHAPPIJ BV". Op naam matchen tegen Exact
--  gaat dus soms goed en soms niet, en "soms" is bij een boeking niet goed
--  genoeg. Wat één keer met de hand is vastgelegd, blijft vastliggen.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De schakelaar en wat eromheen moet staan
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_exact_facturen', 'exact_facturen', 'uit',
   'Gaan goedgekeurde facturen naar Exact? "aan" of "uit". Staat standaard '
   'uit; de serverfunctie weigert te versturen zolang dat zo is.'),
  ('in_exact_dagboek', 'exact_dagboek', '',
   'Het inkoopdagboek in Exact waarin de boeking komt, vaak 70. Leeg = er '
   'wordt niets verstuurd, want Exact weigert een boeking zonder dagboek.'),
  ('in_exact_btw_21', 'exact_btw_21', '',
   'De btw-code in Exact voor het hoge tarief. Die code verschilt per '
   'administratie; hij is op te halen bij Exact zelf.'),
  ('in_exact_btw_9', 'exact_btw_9', '',
   'De btw-code in Exact voor het lage tarief.'),
  ('in_exact_btw_0', 'exact_btw_0', '',
   'De btw-code in Exact voor 0% of vrijgesteld.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  De crediteuren zoals Exact ze kent
--
--  Een kopie om in te kunnen zoeken, net als bij het rekeningschema en het
--  personeel. Wordt in zijn geheel bijgewerkt door de sync.
-- ---------------------------------------------------------------------------

create table if not exists public.exact_crediteur (
  /* De guid van Exact. Dit is wat er in de boeking komt te staan. */
  exact_id   text primary key,
  code       text,
  naam       text not null default '',
  /* Op deze genormaliseerde naam wordt automatisch gekoppeld: kleine letters,
     zonder rechtsvorm en zonder leestekens. Zie de functie hieronder. */
  zoeknaam   text,
  btw_nummer text,
  division   text,
  updated_at bigint not null default public.now_ms()
);

create index if not exists exact_crediteur_zoek_idx on public.exact_crediteur (zoeknaam);

comment on table public.exact_crediteur is
  'De crediteuren zoals Exact ze kent (0058). Een kopie om op te zoeken; de '
  'koppeling zelf staat in exact_leverancier.';

-- ---------------------------------------------------------------------------
--  Welke leverancier op onze bon welke crediteur in Exact is
-- ---------------------------------------------------------------------------

create table if not exists public.exact_leverancier (
  /* De genormaliseerde naam van de bon. Zie kaal_bedrijf() hieronder. */
  zoeknaam   text primary key,
  /* Zoals hij op de bon stond toen de koppeling werd gemaakt -- puur om in
     het scherm te kunnen tonen waar dit vandaan kwam. */
  gezien_als text,
  exact_id   text not null,
  exact_naam text,
  bron       text not null default 'handmatig'
             check (bron in ('naam', 'handmatig')),
  door       text,
  updated_at bigint not null default public.now_ms()
);

comment on table public.exact_leverancier is
  'Welke leverancier op onze bon welke crediteur in Exact is (0058). Nodig '
  'voordat een factuur verstuurd kan worden: een boeking wijst naar een guid.';

-- ---------------------------------------------------------------------------
--  Namen vergelijkbaar maken
--
--  "Shell Nederland Verkoopmij B.V." en "SHELL NEDERLAND VERKOOPMAATSCHAPPIJ
--  BV" zijn dezelfde firma en verschillende teksten. Deze functie haalt eraf
--  wat niets zegt: hoofdletters, leestekens, en de rechtsvorm achteraan.
--
--  Bewust NIET slimmer dan dit. Een fuzzy match die "Van Dijk Transport" aan
--  "Van Dijk Verhuur" koppelt, boekt een factuur bij de verkeerde crediteur
--  -- en dat is precies de fout die niemand terugvindt. Wat hier niet
--  vanzelf matcht, koppelt een mens.
-- ---------------------------------------------------------------------------

create or replace function public.kaal_bedrijf(naam text)
returns text
language sql immutable as $$
  /*
   * Eerst de leestekens eruit, dan pas de rechtsvorm. Andersom ging het mis:
   * "B.V." aan het eind bleef staan omdat de woordgrens na de laatste punt
   * niet matcht, terwijl "bv" zonder punten wel werd afgehaald. Dan komen
   * twee schrijfwijzen van dezelfde firma dus NIET op elkaar uit -- en dat is
   * precies waar deze functie voor bestaat. De zelftest ving het.
   *
   * Daarom staat de rechtsvorm hieronder ook als "b\s*v": na het weghalen van
   * de punten is "B.V." veranderd in "b v".
   */
  select nullif(
    trim(regexp_replace(
      trim(regexp_replace(lower(coalesce(naam, '')), '[^a-z0-9]+', ' ', 'g')),
      '\s+(b\s*v\s*b\s*a|b\s*v|n\s*v|v\s*o\s*f|c\s*v|gmbh|ltd|inc|s\s*a)$',
      '', 'g')),
    '');
$$;

comment on function public.kaal_bedrijf(text) is
  'Een bedrijfsnaam zonder hoofdletters, leestekens en rechtsvorm (0058), '
  'zodat twee schrijfwijzen van dezelfde firma op elkaar uitkomen.';

-- ---------------------------------------------------------------------------
--  Wie mag dit zien
--
--  Administratiewerk: het management en wie achter de balie zit. Schrijven
--  doet geen mens -- de Edge Function werkt met de servicesleutel.
-- ---------------------------------------------------------------------------

alter table public.exact_crediteur   enable row level security;
alter table public.exact_leverancier enable row level security;

do $$
declare t text;
begin
  foreach t in array array['exact_crediteur', 'exact_leverancier'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated '
      'using (public.is_management() or public.heeft_recht(''admin.desk'') '
      '       or public.heeft_recht(''dev.logs''))',
      t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  En het soort werk erbij
-- ---------------------------------------------------------------------------

insert into public.exact_sync (soort) values ('crediteuren'), ('facturen')
on conflict (soort) do nothing;

-- ---------------------------------------------------------------------------
--  De zoeknaam zetten en koppelen wat vanzelf kan
--
--  Na elke ophaalronde. Twee dingen, en het tweede is voorzichtig: alleen
--  koppelen als er precies EEN crediteur met die naam is. Zijn het er twee,
--  dan is een keuze maken raden -- en een factuur bij de verkeerde crediteur
--  boeken is de fout die niemand terugvindt.
-- ---------------------------------------------------------------------------

create or replace function public.exact_crediteuren_klaarzetten(door_in text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare gekoppeld integer;
begin
  update public.exact_crediteur
     set zoeknaam = public.kaal_bedrijf(naam)
   where zoeknaam is distinct from public.kaal_bedrijf(naam);

  with kandidaten as (
    select public.kaal_bedrijf(e.supplier) as zoeknaam,
           min(e.supplier)                 as gezien_als
      from public.expenses e
     where e.status = 'goedgekeurd'
       and e.exact_id is null
       and public.kaal_bedrijf(e.supplier) is not null
     group by 1
  ),
  eenduidig as (
    select k.zoeknaam, k.gezien_als, min(c.exact_id) as exact_id, min(c.naam) as naam
      from kandidaten k
      join public.exact_crediteur c on c.zoeknaam = k.zoeknaam
     where not exists (select 1 from public.exact_leverancier l where l.zoeknaam = k.zoeknaam)
     group by k.zoeknaam, k.gezien_als
    having count(*) = 1
  )
  insert into public.exact_leverancier (zoeknaam, gezien_als, exact_id, exact_naam, bron, door)
  select zoeknaam, gezien_als, exact_id, naam, 'naam', door_in from eenduidig
  on conflict (zoeknaam) do nothing;

  get diagnostics gekoppeld = row_count;
  return gekoppeld;
end $$;

revoke execute on function public.exact_crediteuren_klaarzetten(text) from public, anon, authenticated;
grant  execute on function public.exact_crediteuren_klaarzetten(text) to service_role;

-- ---------------------------------------------------------------------------
--  Wat er klaarstaat om verstuurd te worden
--
--  Alles wat de serverfunctie nodig heeft in één vraag: de bon, de gekoppelde
--  crediteur en de guid van de grootboekrekening. Hier stond eerst een lus
--  die per bon apart kaal_bedrijf() vroeg -- bij tweehonderd bonnen zijn dat
--  tweehonderd heen-en-weertjes, en het zette dezelfde kennis op twee plekken.
-- ---------------------------------------------------------------------------

/* Eerst weg. "create or replace" mag de vorm van een tabelfunctie niet
   wijzigen, en 0059 zet er een kolom bij (administratie). Zonder deze regel
   valt dit bestand om zodra het na 0059 nog eens gedraaid wordt -- en elke
   migratie hier belooft dat dat mag. */
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
  datum          bigint,
  fout           text
)
language sql stable security definer set search_path = public as $$
  select e.id,
         coalesce(e.supplier, ''),
         public.kaal_bedrijf(e.supplier),
         e.factuurnummer,
         e.amount_excl,
         e.vat_pct,
         e.grootboek_code,
         g.exact_id,
         l.exact_id,
         l.exact_naam,
         e.expense_date,
         e.exact_fout
    from public.expenses e
    left join public.exact_leverancier l on l.zoeknaam = public.kaal_bedrijf(e.supplier)
    left join public.exact_grootboek   g on g.code     = e.grootboek_code
   where e.status = 'goedgekeurd'
     and e.exact_id is null
   order by e.expense_date
   limit 200;
$$;

revoke execute on function public.exact_facturen_wachtend() from public, anon, authenticated;
grant  execute on function public.exact_facturen_wachtend() to service_role;
