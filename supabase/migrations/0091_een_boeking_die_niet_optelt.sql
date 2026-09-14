-- ===========================================================================
--  Een boeking die niet optelt gaat niet
--
--  Casper: "hij heeft het doorgezet, maar heeft niet alle bedragen
--  meegestuurd."
--
--  In Exact staat inkoopfactuur VF261203080 met één regel van € 51,86. Op het
--  papier staan er drie:
--
--      Storingsbus inclusief reinigingsunit      51,86
--      Uurloon monteur, Regulier tarief          88,85
--      Brandstoftoeslag Klein materieel           3,05
--                                             --------
--                                               143,76
--
--  Er is dus voor € 91,90 niet geboekt, en dat is aan niets te zien: de
--  boeking is aangemaakt, Exact gaf een boekstuknummer terug, en bij ons staat
--  de factuur op "doorgekomen". Alleen het bedrag klopt niet.
--
--  Waarom dat kon
--  --------------
--
--  De verzendlus maakt van elke regel van de verdeling (0062) een boekingsregel
--  en stuurt die op. Wat hij nooit deed is nakijken of die regels samen het
--  factuurbedrag zijn. Dat leek ook niet nodig -- 0062 zet er met zoveel
--  woorden bij:
--
--      "Dat de regels optellen tot het factuurbedrag is hier geen zorg meer:
--       de database laat een bon met een verschil niet eens goedkeuren."
--
--  Dat klopt, en het is niet genoeg. Die controle kijkt op het moment van
--  GOEDKEUREN, en hij slaat over als er dan nog geen regels zijn
--  (expense_regels_verschil geeft null bij nul regels). Komen de regels daarna
--  binnen -- uit de wachtrij van een ander toestel, of doordat er eentje wel
--  aankwam en de andere twee niet -- dan is er nooit meer iemand die telt.
--
--  Precies die situatie staat op het scherm: bij twee van de drie regels is de
--  grootboekrekening leeg. Zo'n regel had de verzendlus geweigerd. Er is er dus
--  één verstuurd en zijn er twee nooit op de server aangekomen.
--
--  Wat hier gebeurt
--  ----------------
--
--  De optelsom komt mee in exact_facturen_wachtend(), zodat het scherm
--  "Wat er nog blokkeert" hem kan laten zien VOORDAT er iets weggaat. De
--  harde stop staat in de verzendlus zelf (supabase/functions/exact): wat niet
--  optelt tot op de cent gaat er niet in.
--
--  Twee plekken voor dezelfde vraag, en dat is hier de bedoeling. De ene is er
--  om het te zien, de andere om het tegen te houden -- en de tweede is de enige
--  die er altijd bij is.
--
--  En waar de bijlage bleef
--  ------------------------
--
--  Casper: "Kan je ook de documenten mee sturen?" Dat kan, en het is een
--  aparte stap bij Exact (documents/Documents plus DocumentAttachments). Of
--  het gelukt is hoort navraagbaar te zijn, dus dat komt in een kolom te
--  staan in plaats van alleen in een logregel.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Waar de bijlage in Exact terechtkwam
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists exact_document text;
alter table public.expenses add column if not exists exact_document_fout text;

comment on column public.expenses.exact_document is
  'Het document-id in Exact waar de PDF van deze factuur aan hangt (0091). '
  'Leeg = er is geen bijlage meegegaan; waarom staat in exact_document_fout.';

comment on column public.expenses.exact_document_fout is
  'Waarom de bijlage niet naar Exact kon (0091). De boeking zelf gaat door: '
  'die staat er al, en hem laten mislukken om een bijlage zou betekenen dat '
  'dezelfde factuur de volgende ronde nog een keer wordt geboekt.';

-- ---------------------------------------------------------------------------
--  2. De optelsom van de verdeling komt mee
--
--  Twee kolommen en niet één: nul regels betekent "niet gesplitst, het bedrag
--  op de bon is de boeking", en dat is iets anders dan drie regels die samen
--  nul zijn. Met alleen een som zijn die twee niet uit elkaar te houden.
--
--  Waarom drop en create: Postgres weigert een vervanging zodra de
--  teruggegeven kolommen veranderen. Dezelfde reden als in 0035, 0059, 0085,
--  0086 en 0089, en met dezelfde valkuil -- bij de eerste keer draaien merk je
--  het niet, bij de tweede valt bijwerken.sql halverwege om.
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
  dagboek        text,
  btw_code       text,
  datum          bigint,
  vervaldatum    bigint,
  /* Hoeveel regels de verdeling heeft, en wat ze samen zijn (0091). Nul
     regels = niet gesplitst; dan is het bedrag op de bon de boeking. */
  regels         integer,
  regels_som     numeric,
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
         coalesce(r.aantal, 0),
         coalesce(r.som, 0),
         b.exact_fout
    from bonnen b
    left join lateral public.bv_boekinstelling(b.adm) i on true
    left join lateral (
      select count(*)::integer as aantal, coalesce(sum(x.bedrag_excl), 0) as som
        from public.expense_regel x where x.expense_id = b.id
    ) r on true
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
  'heeft in één vraag (0058/0059/0086). Sinds 0085 het kenmerk, sinds 0089 de '
  'vervaldatum en sinds 0091 de optelsom van de verdeling -- een boeking die '
  'niet optelt tot het factuurbedrag hoort niet weg te gaan.';

-- ---------------------------------------------------------------------------
--  3. En het staat bij wat er blokkeert
--
--  bon_niet_boekbaar() (0086) is de lijst voor het scherm waar iemand
--  goedkeurt. Een verdeling die niet sluit hoort daar bovenaan te staan: dat
--  is geld dat anders stilletjes niet geboekt wordt.
--
--  De functie is woordelijk die van 0086 met één geval erbij.
-- ---------------------------------------------------------------------------

create or replace function public.bon_niet_boekbaar()
returns table (id text, leverancier text, bedrag numeric, administratie text, wat text[], reden text)
language sql stable security definer set search_path = public as $$
  select w.id,
         w.leverancier,
         w.bedrag,
         w.administratie,
         array_remove(array[
           /* De verdeling vooraan, in dezelfde volgorde als de reden
              hieronder. Het scherm groepeert op het EERSTE tekort (wat[0]);
              stond dit achteraan, dan kwam een factuur onder de kop
              "crediteur" te staan met een zin over de verdeling eronder. */
           case when w.regels > 0 and abs(w.regels_som - coalesce(w.bedrag, 0)) >= 0.005
                then 'verdeling' end,
           case when w.administratie is null then 'onderneming' end,
           case when w.grootboek_code is null then 'grootboekrekening' end,
           case when w.grootboek_code is not null and w.grootboek_id is null
                then 'rekening bestaat niet in deze bv' end,
           case when w.crediteur_id is null then 'crediteur' end,
           case when w.dagboek is null then 'inkoopdagboek' end,
           case when w.btw_code is null then 'btw-code' end
         ], null),
         case
           /* De verdeling eerst: dit is het enige geval waarin er WEL iets
              geboekt zou worden, alleen niet alles. De rest houdt de boeking
              in zijn geheel tegen en valt dus vanzelf op. */
           when w.regels > 0 and abs(w.regels_som - coalesce(w.bedrag, 0)) >= 0.005
             then format('De verdeling telt op tot %s en de factuur is %s. Er zou %s te %s geboekt worden.',
                         trim(to_char(w.regels_som, 'FM999999990.00')),
                         trim(to_char(coalesce(w.bedrag, 0), 'FM999999990.00')),
                         trim(to_char(abs(w.regels_som - coalesce(w.bedrag, 0)), 'FM999999990.00')),
                         case when w.regels_som > coalesce(w.bedrag, 0) then 'veel' else 'weinig' end)
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
      or w.btw_code is null
      or (w.regels > 0 and abs(w.regels_som - coalesce(w.bedrag, 0)) >= 0.005);
$$;

revoke execute on function public.bon_niet_boekbaar() from public, anon;
grant  execute on function public.bon_niet_boekbaar() to authenticated, service_role;

comment on function public.bon_niet_boekbaar() is
  'Goedgekeurde facturen die niet naar Exact kunnen, met per stuk wat er '
  'ontbreekt en wat je eraan doet (0086). Sinds 0091 ook een verdeling die '
  'niet optelt tot het factuurbedrag -- het enige geval waarin er wel wat '
  'geboekt wordt en niet alles.';
