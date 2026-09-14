-- ===========================================================================
--  Wat Exact zelf al wist
--
--  Casper stuurde wat Exact terugstuurde bij de eerste echte boeking:
--
--      Verplicht: Vervaldatum
--      Verplicht: Betalingsconditie
--      Ongeldig: Dagboek (Type)
--      Ongeldig: U kunt geen btw-code van het type 'Verkoop' gebruiken
--      De crediteurenrekening van deze relatie is niet gelijk aan die van
--      het dagboek
--
--  En daarbij: "zoveel mogelijk uit exact gebruiken."
--
--  Vier van de vijf staan in Exact zelf
--  ------------------------------------
--
--  Het dagboektype, het type van een btw-code, de crediteurenrekening van
--  een relatie en haar betalingsconditie -- dat staat allemaal aan de andere
--  kant. Wij vroegen het niet en lieten het met de hand instellen, en dan is
--  elke instelling een kans om het mis te hebben. Dat is serverwerk en staat
--  in supabase/functions/exact.
--
--  De vijfde niet: de vervaldatum staat op het PAPIER
--  ---------------------------------------------------
--
--  Wanneer déze factuur vervalt weet Exact niet -- dat is precies wat wij van
--  de bon aflezen, en het staat sinds 0044 in expenses.vervaldatum. Alleen
--  gaf exact_facturen_wachtend() hem niet mee, en dus kon de verzendlus hem
--  niet meesturen.
--
--  Meer is dit niet: één kolom erbij, zoals 0085 het kenmerk toevoegde.
--
--  Waarom drop en create
--  ---------------------
--
--  Postgres weigert een vervanging zodra de teruggegeven kolommen veranderen.
--  Dezelfde reden als in 0035, 0059, 0085 en 0086, met dezelfde valkuil: bij
--  de eerste keer draaien merk je het niet, bij de tweede valt bijwerken.sql
--  halverwege om. En dat bestand belooft dat opnieuw draaien altijd mag.
--
--  Opnieuw draaien mag.
-- ===========================================================================

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
  dagboek        text,
  btw_code       text,
  datum          bigint,
  /* Wanneer de factuur vervalt, zoals het op het stuk staat (0089). Exact
     eist een vervaldatum bij een inkoopboeking en kan hem niet zelf weten.
     Leeg = de verzendlus neemt de factuurdatum; een termijn erbij verzinnen
     zou bepalen wanneer er betaald wordt. */
  vervaldatum    bigint,
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
         b.vervaldatum,
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

/*
 * De rechten opnieuw zetten.
 *
 * "drop function" gooit ze weg, en Supabase geeft een nieuwe functie meteen
 * weer aan anon en authenticated via de standaardregel in het schema. Zonder
 * deze twee regels staat het gat uit 0033 en 0034 weer open -- en deze
 * functie leest langs RLS heen wat er aan facturen klaarstaat.
 */
revoke execute on function public.exact_facturen_wachtend() from public, anon, authenticated;
grant  execute on function public.exact_facturen_wachtend() to service_role;

comment on function public.exact_facturen_wachtend() is
  'Wat er klaarstaat om naar Exact te gaan, met alles wat een boeking nodig '
  'heeft in één vraag (0058/0059/0086). Sinds 0085 het kenmerk uit de lezing '
  'en sinds 0089 de vervaldatum -- Exact eist die bij een inkoopboeking en '
  'kan hem niet zelf weten.';
