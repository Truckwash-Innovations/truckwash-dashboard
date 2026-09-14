-- ===========================================================================
--  Niet meer per bv instellen wat Exact al weet
--
--  Casper: "als ik bij boeking een andere onderneming pak, moet je die
--  grootboekrekeningen laten zien.... datzelfde met de inkoopdagboek, btw
--  codes ect, zorg dat je die juist per onderneming zelf pakt, want anders
--  blijf ik bezig"
--
--  Het rekeningschema is schermwerk en staat in Kostenposten.tsx: de lijst
--  toonde alle bv's door elkaar. Dit bestand gaat over het tweede deel, en
--  daar zat een tegenstrijdigheid in.
--
--  Wat er niet klopte
--  ------------------
--
--  0089 liet de verzendlus het dagboek en de btw-code bij EXACT ophalen, per
--  bv en per crediteur -- precies wat hier gevraagd wordt. Alleen bleef de
--  blokkadelijst eromheen staan zoals 0086 hem achterliet: een factuur heet
--  daar "niet boekbaar" zolang er geen inkoopdagboek is INGESTELD.
--
--  Dus stond er op het scherm dat je iets moest invullen dat de verzendlus
--  zelf al opzocht. Twintig bv's, twee velden elk, allemaal met de hand --
--  "anders blijf ik bezig", en terecht.
--
--  Weg dus. Wat Exact weet wordt aan Exact gevraagd; wat er dan nog misgaat
--  blijkt bij het versturen, met de reden erbij (kiesDagboek en kiesBtw
--  weigeren te raden en zeggen waarom).
--
--  En de globale terugval eronder
--  ------------------------------
--
--  bv_boekinstelling() valt sinds 0086 terug op de globale sleutels
--  exact_dagboek en exact_btw_21. Dat stond er met een reden: er was toen
--  geen andere bron, en de bv waarvoor het werkte moest blijven werken.
--
--  Maar een dagboekcode uit de ene administratie in de andere gebruiken is
--  een gok. Dagboek 70 bestaat niet in elke bv, en waar het bestaat kan het
--  iets anders zijn -- de proefrit waarschuwde daar zelf al voor. Sinds 0089
--  is er wél een betere bron, dus de gok kan eruit: geen eigen instelling
--  betekent nu "vraag het aan Exact" in plaats van "neem die van de buren".
--
--  Een eigen instelling per bv blijft gewoon werken en gaat nog steeds voor,
--  zolang Exact hem toestaat. Dat nakijken doet kiesDagboek() al.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Geen code meer lenen van een andere bv
-- ---------------------------------------------------------------------------

create or replace function public.bv_boekinstelling(bv text)
returns table (inkoop_dagboek text, verkoop_dagboek text, btw_21 text, btw_9 text, btw_0 text)
language sql stable security definer set search_path = public as $$
  /*
   * Alleen wat bij DEZE bv staat.
   *
   * Hier stond coalesce(..., de globale sleutel). Dat was de terugval uit
   * 0086, van voor er een betere bron was: een dagboekcode uit een andere
   * administratie is een gok, en waar hij toevallig bestaat kan hij iets
   * anders zijn. Sinds 0089 haalt de verzendlus het bij Exact op als hier
   * niets staat, en dat is een antwoord in plaats van een gok.
   */
  select
    nullif(trim(a.inkoop_dagboek), ''),
    nullif(trim(a.verkoop_dagboek), ''),
    nullif(trim(a.btw_21), ''),
    nullif(trim(a.btw_9), ''),
    nullif(trim(a.btw_0), '')
  from public.exact_administratie a
  where a.code = bv;
$$;

revoke execute on function public.bv_boekinstelling(text) from public, anon;
grant  execute on function public.bv_boekinstelling(text) to authenticated, service_role;

comment on function public.bv_boekinstelling(text) is
  'Het dagboek en de btw-codes die voor DEZE bv zijn ingesteld (0086). Leeg '
  'betekent sinds 0092: de verzendlus zoekt ze bij Exact op (0089). Niet meer '
  'terugvallen op de globale sleutels -- een code uit een andere '
  'administratie is een gok.';

-- ---------------------------------------------------------------------------
--  2. En de blokkadelijst eist ze niet meer
--
--  Woordelijk die van 0091, met twee gevallen eruit. Wat overblijft is wat een
--  mens werkelijk moet doen: een onderneming kiezen, een rekening kiezen, een
--  crediteur koppelen, of een verdeling rechtzetten.
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
              hieronder. Het scherm groepeert op het EERSTE tekort (wat[0]). */
           case when w.regels > 0 and abs(w.regels_som - coalesce(w.bedrag, 0)) >= 0.005
                then 'verdeling' end,
           case when w.administratie is null then 'onderneming' end,
           case when w.grootboek_code is null then 'grootboekrekening' end,
           case when w.grootboek_code is not null and w.grootboek_id is null
                then 'rekening bestaat niet in deze bv' end,
           case when w.crediteur_id is null then 'crediteur' end
         ], null),
         case
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
           else 'Onbekend'
         end
    from public.exact_facturen_wachtend() w
   where w.administratie is null
      or w.grootboek_id is null
      or w.crediteur_id is null
      or (w.regels > 0 and abs(w.regels_som - coalesce(w.bedrag, 0)) >= 0.005);
$$;

revoke execute on function public.bon_niet_boekbaar() from public, anon;
grant  execute on function public.bon_niet_boekbaar() to authenticated, service_role;

comment on function public.bon_niet_boekbaar() is
  'Goedgekeurde facturen die niet naar Exact kunnen, met per stuk wat er '
  'ontbreekt en wat je eraan doet (0086/0091). Sinds 0092 staan het dagboek '
  'en de btw-code er NIET meer bij: die zoekt de verzendlus zelf op bij Exact '
  '(0089), en erom vragen is werk dat niemand hoeft te doen.';
