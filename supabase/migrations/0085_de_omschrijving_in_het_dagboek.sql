-- ===========================================================================
--  De omschrijving in het dagboek
--
--  Casper: "Je moet het echt vriendelijk maken voor exact."
--
--  Wat er in Exact terechtkwam
--  ---------------------------
--
--  Een boeking die niet gesplitst is, kreeg als regelomschrijving het
--  FACTUURNUMMER. In het inkoopdagboek staat dan:
--
--      Wairtec Chemie WT-2026-04412        WT-2026-04412
--
--  Twee keer hetzelfde nummer en nergens waar het over ging. Wie in Exact
--  terugzoekt waarom er in maart zoveel op 4000 stond, heeft daar niets aan
--  en moet de bon erbij pakken.
--
--  Wat er al wél was
--  -----------------
--
--  De lezer haalt uit elke factuur een kenmerk: "elektra maart",
--  "osmosefilters", "buitenwas en cabine". Dat staat in expenses.gelezen en
--  is precies de zin die in het dagboek hoort. Alleen kwam hij nooit verder
--  dan ons eigen scherm, want exact_facturen_wachtend() gaf hem niet terug.
--
--  Meer is het niet: één kolom erbij. De keuze wat ermee gebeurt staat in de
--  Edge Function -- kenmerk als die er is, anders het factuurnummer, zoals
--  het was.
--
--  Waarom drop en create
--  ---------------------
--
--  Postgres weigert een vervanging zodra de teruggegeven kolommen veranderen
--  ("cannot change return type of existing function"). Dezelfde reden als in
--  0035 en 0059, met dezelfde valkuil: bij de eerste keer draaien merk je het
--  niet, bij de tweede valt supabase/bijwerken.sql halverwege om. Dat bestand
--  belooft dat opnieuw draaien altijd mag, dus: eerst weg.
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
  /* Waar de factuur over gaat, zoals de lezer het van het papier haalde.
     Leeg bij bonnen die nooit gelezen zijn, en dan valt de boeking terug op
     het factuurnummer -- precies zoals het vóór deze migratie ging. */
  kenmerk        text,
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
         b.expense_date,
         b.exact_fout
    from bonnen b
    left join public.exact_leverancier l on l.zoeknaam = public.kaal_bedrijf(b.supplier)
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
  'heeft in één vraag (0058/0059). Sinds 0085 ook het kenmerk uit de lezing, '
  'zodat er in het inkoopdagboek staat waar de factuur over ging en niet nog '
  'een keer het factuurnummer.';
