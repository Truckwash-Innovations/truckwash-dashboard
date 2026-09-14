-- ===========================================================================
--  Het nummer waarop je een boeking in Exact terugvindt
--
--  Casper: "Ik kan hem nergens in exact vinden, kan het zijn omdat er in
--  exact al eentje staat?"
--
--  Nee. De boeking is wel degelijk gelukt -- in de historie van de factuur
--  staat "Naar Exact ... Boeking 56fd8776-b77a-421d-af26-f0d92aea22f2". Het
--  probleem is dat nummer zelf.
--
--  Wij bewaarden de EntryID
--  ------------------------
--
--  Exact geeft bij een geslaagde boeking twee dingen terug:
--
--      EntryID      een guid, het sleutelveld van de API
--      EntryNumber  het boekstuknummer, wat er op zijn schermen staat
--
--  Wij namen de guid, want die is uniek en stabiel. Alleen: die guid staat
--  in geen enkel scherm van Exact en is er ook niet op te zoeken. We gaven
--  dus een nummer terug waarmee je niets kunt.
--
--  Allebei bewaren dus. De guid blijft waar hij is -- daar hangt de
--  uniciteitsindex van 0053 aan en daarmee de garantie dat we een factuur
--  niet twee keer boeken. Het boekstuknummer komt ernaast, puur om te tonen.
--
--  En het dagboek erbij
--  --------------------
--
--  Sinds 0089 kiest de verzendlus het inkoopdagboek zelf, per bv en per
--  crediteur, uit wat Exact toestaat. Welk dagboek dat werd legden we
--  nergens vast. Een boekstuknummer zonder dagboek is in Exact nog steeds
--  zoeken: nummers lopen per dagboek.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. De twee kolommen
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists exact_nummer  text;
alter table public.expenses add column if not exists exact_dagboek text;

comment on column public.expenses.exact_nummer is
  'Het boekstuknummer dat Exact teruggaf (EntryNumber, 0090). Hierop vind je '
  'de boeking terug in Exact; op exact_id (de guid) niet -- die staat op geen '
  'enkel scherm van Exact.';

comment on column public.expenses.exact_dagboek is
  'In welk dagboek de boeking terechtkwam (0090). De verzendlus kiest dat '
  'sinds 0089 zelf per bv, en boekstuknummers lopen per dagboek.';

-- ---------------------------------------------------------------------------
--  2. De historieregel noemt het nummer waar je iets aan hebt
--
--  Dezelfde functie als in 0079, met alleen de tekst van de exact-regel
--  anders. Hij staat hier in zijn geheel omdat "create or replace" van een
--  functie geen halve wijziging kent.
-- ---------------------------------------------------------------------------

create or replace function public.expense_gebeurtenis_schrijf()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  wie   text := public.my_id();
  naam  text;
  nieuw_id text;
begin
  if wie is not null then
    select p.name into naam from public.profiles p where p.id::text = wie;
  end if;

  /* --- de stand --- */
  if tg_op = 'INSERT' then
    insert into public.expense_gebeurtenis (id, expense_id, soort, tekst, door, door_naam)
    values (new.id || '_aan', new.id, 'aangemaakt',
            coalesce(nullif(new.source, ''), 'app'), wie, naam)
    on conflict (id) do nothing;
    return new;
  end if;

  if new.status is distinct from old.status then
    nieuw_id := new.id || '_' || new.status || '_' || public.now_ms()::text;
    insert into public.expense_gebeurtenis (id, expense_id, soort, tekst, door, door_naam)
    values (
      nieuw_id, new.id,
      case new.status
        when 'eerste_akkoord' then 'eerste_akkoord'
        when 'goedgekeurd'    then 'goedgekeurd'
        when 'afgekeurd'      then 'afgekeurd'
        else 'heropend'
      end,
      coalesce(
        case when new.status = 'afgekeurd' then new.reject_reason
             when new.status = 'goedgekeurd' then new.goedkeuring_reden
        end, ''),
      coalesce(new.approved_by, new.eerste_door, wie),
      coalesce(new.approved_by_name, new.eerste_door_naam, naam))
    on conflict (id) do nothing;
  end if;

  /* --- naar Exact --- */
  if new.exact_id is not null and old.exact_id is null then
    insert into public.expense_gebeurtenis (id, expense_id, soort, tekst, door, door_naam)
    values (new.id || '_exact', new.id, 'naar_exact',
            /* Het boekstuknummer als we het hebben, en anders de guid.
               Op dat nummer vind je de boeking in Exact terug; op de guid
               niet -- die staat nergens op een scherm van Exact. Het dagboek
               en de administratie erbij, want zonder die twee weet je nog
               steeds niet waar je moet kijken. */
            'Boeking '
            || coalesce(nullif(new.exact_nummer, ''), new.exact_id)
            || coalesce(' in dagboek ' || nullif(new.exact_dagboek, ''), '')
            || coalesce(' van ' || nullif(new.administratie, ''), ''),
            wie, naam)
    on conflict (id) do nothing;
  end if;

  /* --- de vier velden waar het geld aan hangt --- */
  if new.amount_excl is distinct from old.amount_excl then
    insert into public.expense_gebeurtenis (id, expense_id, soort, veld, oud, nieuw, door, door_naam)
    values (new.id || '_bedrag_' || public.now_ms()::text, new.id, 'gewijzigd',
            'bedrag', old.amount_excl::text, new.amount_excl::text, wie, naam)
    on conflict (id) do nothing;
  end if;

  if new.grootboek_code is distinct from old.grootboek_code then
    insert into public.expense_gebeurtenis (id, expense_id, soort, veld, oud, nieuw, door, door_naam)
    values (new.id || '_rek_' || public.now_ms()::text, new.id, 'gewijzigd',
            'grootboekrekening', old.grootboek_code, new.grootboek_code, wie, naam)
    on conflict (id) do nothing;
  end if;

  if new.supplier is distinct from old.supplier then
    insert into public.expense_gebeurtenis (id, expense_id, soort, veld, oud, nieuw, door, door_naam)
    values (new.id || '_lev_' || public.now_ms()::text, new.id, 'gewijzigd',
            'leverancier', old.supplier, new.supplier, wie, naam)
    on conflict (id) do nothing;
  end if;

  if new.factuurnummer is distinct from old.factuurnummer then
    insert into public.expense_gebeurtenis (id, expense_id, soort, veld, oud, nieuw, door, door_naam)
    values (new.id || '_nr_' || public.now_ms()::text, new.id, 'gewijzigd',
            'factuurnummer', old.factuurnummer, new.factuurnummer, wie, naam)
    on conflict (id) do nothing;
  end if;

  /* --- en de bv (0079) --- */
  if new.administratie is distinct from old.administratie then
    insert into public.expense_gebeurtenis (id, expense_id, soort, veld, oud, nieuw, door, door_naam)
    values (new.id || '_bv_' || public.now_ms()::text, new.id, 'gewijzigd',
            'onderneming', old.administratie, new.administratie, wie, naam)
    on conflict (id) do nothing;
  end if;

  return new;
end $$;

/*
 * De trigger zelf blijft staan.
 *
 * "create or replace function" vervangt alleen de inhoud; de trigger die
 * eraan hangt wijst naar dezelfde naam en hoeft niet opnieuw. En de rechten
 * blijven ook staan: dit is geen drop.
 */
