-- ===========================================================================
--  Het grootboek komt uit Exact
--
--  Casper: "kan je er niet voor zorgen dat de grootboeken uit exact bij ons in
--  het systeem komen met de knop ophalen? Zodat alle dingen opkomen, ook moet
--  je zorgen dat ik ze kan verwijderen, in een categorie kan plaatsen ect.
--  Wel met bevestiging uiteraard. Zodat we echt een sync hebben ipv alles
--  handmatig oppakken."
--
--  In 0053 stond nog waarom het schema NIET werd overgenomen: public.grootboek
--  is met opzet kort (0044), en een administratie in Exact heeft er honderden.
--  Die zorg blijft staan -- maar het antwoord erop is niet "dan niet", het is
--  gereedschap. Overnemen wat je nodig hebt, weggooien wat je niet gebruikt,
--  en een categorie eromheen zodat een lange lijst toch te overzien is.
--
--  Wat een overname NIET doet
--  --------------------------
--
--  Bestaande regels aanraken. "Inkoop wasmiddelen en chemie" is een naam die
--  iemand hier heeft bedacht omdat de administratie hem zo herkent; in Exact
--  heet diezelfde rekening iets als "Kosten grond- en hulpstoffen". Een sync
--  die dat overschrijft, wist elke keer opnieuw het werk van de vorige keer
--  -- en dat merk je pas als je bij een bon de rekening niet meer terugvindt.
--
--  Dus: alleen toevoegen wat er nog niet is. Wat er staat blijft van ons.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De categorie
--
--  Vrije tekst en geen vaste lijst. Bij het overnemen wordt hij gevuld met
--  wat Exact van de rekening vindt (Kosten, Omzet, Balans...), maar dat is
--  een beginwaarde en geen wet: wie zijn kosten liever splitst in "wasstraat"
--  en "wagenpark" moet dat gewoon kunnen typen.
-- ---------------------------------------------------------------------------

alter table public.grootboek add column if not exists categorie text;

create index if not exists grootboek_categorie_idx
  on public.grootboek (categorie);

comment on column public.grootboek.categorie is
  'Vrije groepering om een lang rekeningschema te kunnen overzien (0057). '
  'Bij overnemen uit Exact gevuld met hun soort; daarna van ons.';

-- ---------------------------------------------------------------------------
--  Weggooien wat in gebruik is, hoort niet te kunnen
--
--  Een rekening verwijderen waarop al geboekt is, laat kostenposten achter
--  met een code die nergens meer naar wijst. Het scherm vraagt dit na
--  voordat het de knop aanbiedt, maar een scherm is geen slot: dezelfde
--  vraag hoort in de database te staan, want die is de enige die er altijd
--  bij is.
--
--  Geeft het aantal kostenposten dat op deze code staat. Nul betekent:
--  weggooien mag.
-- ---------------------------------------------------------------------------

create or replace function public.grootboek_in_gebruik(code_in text)
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.expenses e
   where e.grootboek_code = code_in;
$$;

revoke execute on function public.grootboek_in_gebruik(text) from public, anon;
grant  execute on function public.grootboek_in_gebruik(text) to service_role, authenticated;

comment on function public.grootboek_in_gebruik(text) is
  'Hoeveel kostenposten op deze grootboekcode staan (0057). Nul betekent dat '
  'de rekening weg mag; daarboven laat je kostenposten achter met een code '
  'die nergens meer naar wijst.';
