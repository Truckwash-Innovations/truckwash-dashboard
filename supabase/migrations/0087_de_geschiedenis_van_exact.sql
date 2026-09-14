-- ===========================================================================
--  De geschiedenis van Exact
--
--  Casper: "Kan je zorgen dat je ook de geschiedenis van exact kan zien,
--  zodat je weet wat er door is gekomen ect? zodat alles zichtbaar is, en je
--  niks kan missen."
--
--  Wat er wél werd bijgehouden en nergens te zien was
--  --------------------------------------------------
--
--  Alles staat er al, verspreid over vier plekken:
--
--    expenses.exact_id / exact_at      wat er geboekt is, en wanneer
--    expenses.exact_fout               wat er misging bij de laatste poging
--    verkoopfactuur.exact_id / _fout   idem aan de verkoopkant
--    expense_gebeurtenis 'naar_exact'  de regel in de historie van één bon
--    exact_sync                        wanneer er voor het laatst iets ging
--
--  Wat ontbrak is het overzicht. Je kon per factuur zien of hij geboekt was --
--  als je die factuur openklikte. Er was geen enkele plek die zei: dit is er
--  deze maand doorgekomen, dit is blijven liggen, en dit is geprobeerd en
--  mislukt.
--
--  Dat is precies "je kan iets missen": een bon die op een fout is
--  vastgelopen ziet er in de lijst hetzelfde uit als een bon die net is
--  goedgekeurd. Niets telt hem, niets meldt hem, en over een maand staat hij
--  er nog.
--
--  Waarom één functie en geen tabel
--  --------------------------------
--
--  Er valt niets bij te houden dat er niet al staat. Een aparte logtabel zou
--  een tweede waarheid zijn die uit de pas kan lopen met expenses.exact_id --
--  en dan is de vraag "is deze factuur nou geboekt" niet meer te beantwoorden
--  zonder ze allebei te bekijken. Dit leest wat er is en zet het op een rij.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Wat er met Exact is gebeurd, nieuwste eerst
--
--  Drie soorten regels, en de tweede is waar het om begonnen was:
--
--    geboekt    er staat een boekingsnummer; dit is doorgekomen
--    mislukt    er is een poging gedaan en die is afgeketst, met de reden
--    wacht      goedgekeurd, nooit verstuurd, en er ontbreekt iets
--
--  Inkoop en verkoop door elkaar, want de vraag "wat is er deze maand naar
--  Exact gegaan" gaat over allebei. De kolom richting houdt ze uit elkaar.
-- ---------------------------------------------------------------------------

create or replace function public.exact_geschiedenis(
  vanaf_in bigint default null,
  bv_in text default null,
  hoeveel integer default 200
)
returns table (
  id            text,
  richting      text,
  stand         text,
  wie           text,
  nummer        text,
  bedrag        numeric,
  administratie text,
  boeking       text,
  at            bigint,
  reden         text
)
language sql stable security definer set search_path = public as $$
  with inkoop as (
    select
      e.id,
      'inkoop'::text as richting,
      case
        when e.exact_id is not null then 'geboekt'
        when coalesce(e.exact_fout, '') <> '' then 'mislukt'
        else 'wacht'
      end as stand,
      coalesce(e.supplier, '') as wie,
      e.factuurnummer as nummer,
      e.amount_excl as bedrag,
      public.bon_administratie(e.id) as administratie,
      e.exact_id as boeking,
      /* Wanneer het gebeurde. Bij een geboekte bon het moment van boeken, bij
         een mislukte het moment van de poging (updated_at, want exact_fout
         wordt daar samen mee gezet), en anders wanneer hij is goedgekeurd. */
      coalesce(e.exact_at, e.updated_at, e.approved_at, e.expense_date) as at,
      e.exact_fout as reden
      from public.expenses e
     where e.status = 'goedgekeurd'
  ),
  verkoop as (
    select
      f.id,
      'verkoop'::text,
      case
        when f.exact_id is not null then 'geboekt'
        when coalesce(f.exact_fout, '') <> '' then 'mislukt'
        else 'wacht'
      end,
      coalesce(f.company_naam, ''),
      f.nummer,
      f.bedrag_excl,
      f.administratie,
      f.exact_id,
      coalesce(f.exact_at, f.updated_at, f.datum),
      f.exact_fout
      from public.verkoopfactuur f
     where f.status <> 'concept'
  ),
  alles as (
    select * from inkoop
    union all
    select * from verkoop
  )
  select * from alles a
   where (vanaf_in is null or a.at >= vanaf_in)
     and (bv_in is null or a.administratie = bv_in)
   order by a.at desc
   limit greatest(1, least(coalesce(hoeveel, 200), 1000));
$$;

revoke execute on function public.exact_geschiedenis(bigint, text, integer) from public, anon;
grant  execute on function public.exact_geschiedenis(bigint, text, integer)
  to authenticated, service_role;

comment on function public.exact_geschiedenis(bigint, text, integer) is
  'Wat er met Exact is gebeurd (0087): geboekt, mislukt of nog wachtend, '
  'inkoop en verkoop door elkaar, nieuwste eerst. Leest wat er al staat -- '
  'een eigen logtabel zou een tweede waarheid zijn die uit de pas loopt met '
  'expenses.exact_id.';

-- ---------------------------------------------------------------------------
--  En de telling erboven
--
--  Voor de strook die zegt hoeveel er doorgekomen is en hoeveel er ligt. Die
--  twee getallen zijn de reden dat dit bestaat: zolang niemand ze ziet, ziet
--  een vastgelopen factuur er hetzelfde uit als een die net is goedgekeurd.
-- ---------------------------------------------------------------------------

create or replace function public.exact_stand_kort(vanaf_in bigint default null)
returns table (
  geboekt        integer,
  geboekt_bedrag numeric,
  mislukt        integer,
  wacht          integer,
  wacht_bedrag   numeric,
  oudste_wacht   bigint
)
language sql stable security definer set search_path = public as $$
  select
    count(*) filter (where g.stand = 'geboekt')::integer,
    coalesce(sum(g.bedrag) filter (where g.stand = 'geboekt'), 0),
    count(*) filter (where g.stand = 'mislukt')::integer,
    count(*) filter (where g.stand = 'wacht')::integer,
    coalesce(sum(g.bedrag) filter (where g.stand = 'wacht'), 0),
    min(g.at) filter (where g.stand = 'wacht')
  from public.exact_geschiedenis(vanaf_in, null, 1000) g;
$$;

revoke execute on function public.exact_stand_kort(bigint) from public, anon;
grant  execute on function public.exact_stand_kort(bigint) to authenticated, service_role;

comment on function public.exact_stand_kort(bigint) is
  'Hoeveel er naar Exact ging, vastliep of nog ligt (0087). De oudste '
  'wachtende erbij, want een factuur van drie maanden geleden die er nog '
  'staat is een ander verhaal dan een van gisteren.';
