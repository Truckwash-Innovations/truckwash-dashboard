-- ===========================================================================
--  Een weigering die je terugvindt, en die weggaat als je hem oplost
--
--  Casper: "kon hij niet versturen de melding er netjes in zetten."
--
--  Wat er stond
--  ------------
--
--  De reden stond wél in expenses.exact_fout -- daar is niets mis mee. Wat
--  eromheen ontbrak was alles:
--
--    geen tijdstip      exact_fout werd overschreven zonder wanneer. Drie
--                       keer dezelfde bon proberen liet één regel achter, en
--                       "hoe oud is deze melding" was niet te beantwoorden.
--
--    niet in de         de historie van een factuur (0061) kreeg een regel
--    historie           bij goedkeuren, afkeuren en bij een geslaagde
--                       boeking. Bij een mislukte boeking niet. Precies de
--                       gebeurtenis waar je een maand later naar zoekt.
--
--    ging nooit weg     exact_fout werd alleen op null gezet als het alsnog
--                       lukte. Repareer je de crediteur of de rekening, dan
--                       bleef de bon in de werklijst staan onder "Exact
--                       weigert" met een reden die niet meer gold.
--
--  Wat het wordt
--  -------------
--
--  Een tijdstip erbij, een regel in de historie, en de melding verdwijnt
--  zodra iemand iets verandert waar de weigering over ging.
--
--  Dat laatste is met opzet eng-nauw gehouden: alleen de velden waarop
--  bon_niet_boekbaar() en het boeken zelf afgaan. Een tag die iemand
--  aanvinkt is geen reden om een weigering te laten verdwijnen -- dan zou de
--  melding wegvallen zonder dat er iets is opgelost, en dat is erger dan een
--  melding die te lang blijft staan.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Wanneer het misging
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists exact_fout_at bigint;

comment on column public.expenses.exact_fout_at is
  'Wanneer Exact deze boeking voor het laatst weigerde (epoch ms, 0099). '
  'Leeg zodra het alsnog lukte of iemand het probleem oploste.';

-- ---------------------------------------------------------------------------
--  2. Een weigering is een gebeurtenis
--
--  De historie kende alleen 'naar_exact', en die wordt geschreven als het
--  gelukt is. Een eigen soort, want het is iets anders: niet "dit is er
--  gebeurd met de boeking" maar "dit is er NIET gebeurd, en waarom".
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.expense_gebeurtenis drop constraint if exists expense_gebeurtenis_soort_check;
  alter table public.expense_gebeurtenis
    add constraint expense_gebeurtenis_soort_check
    check (soort in ('aangemaakt', 'gewijzigd', 'eerste_akkoord',
                     'goedgekeurd', 'afgekeurd', 'heropend',
                     'notitie', 'naar_exact', 'exact_weigerde'));
end $$;

-- ---------------------------------------------------------------------------
--  3. Hem opschrijven
--
--  Alleen bij een NIEUWE of een ANDERE reden. Drie keer dezelfde knop met
--  dezelfde uitkomst is één gebeurtenis; anders staat de historie vol met
--  regels die hetzelfde zeggen en is de regel die ertoe doet niet meer te
--  vinden.
-- ---------------------------------------------------------------------------

create or replace function public.expense_exact_fout_schrijf()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  wie  text := public.my_id();
  naam text;
begin
  if coalesce(new.exact_fout, '') = '' then return new; end if;
  if new.exact_fout is not distinct from old.exact_fout then return new; end if;

  if wie is not null then
    select p.name into naam from public.profiles p where p.id::text = wie;
  end if;

  insert into public.expense_gebeurtenis
    (id, expense_id, soort, tekst, door, door_naam)
  values (
    new.id || '_weiger_' || public.now_ms()::text, new.id, 'exact_weigerde',
    new.exact_fout,
    /* Dit gebeurt in de serverfunctie, met de servicesleutel: dan is my_id()
       leeg en hoort er geen naam bij te staan alsof een mens het deed. */
    wie, naam)
  on conflict (id) do nothing;

  return new;
end $$;

revoke execute on function public.expense_exact_fout_schrijf() from public, anon, authenticated;

drop trigger if exists expenses_exact_fout on public.expenses;
create trigger expenses_exact_fout
  after update of exact_fout on public.expenses
  for each row execute function public.expense_exact_fout_schrijf();

-- ---------------------------------------------------------------------------
--  4. En hem laten verdwijnen als je hem oplost
--
--  Deze staat BEFORE en niet AFTER: hij verandert de rij die wordt
--  weggeschreven, in plaats van er een tweede schrijfronde overheen te doen.
--
--  De lijst velden is precies wat het boeken nodig heeft. Verandert daar
--  iets, dan is de vorige weigering niet meer bewezen -- misschien is hij
--  opgelost, misschien niet, maar hem laten staan betekent dat de bon in de
--  werklijst blijft hangen onder een reden die nergens meer op slaat.
--
--  Wat hier NIET in staat, en dat is een grens en geen vergissing: de
--  koppeling van de leverancier aan een crediteur (exact_leverancier) en de
--  verdeling over meerdere posten (expense_regel). Die staan in eigen
--  tabellen en raken deze rij niet aan, dus een trigger op expenses ziet ze
--  niet gebeuren. Voor die twee is er de knop "Opnieuw" bij de factuur: die
--  probeert het gewoon nog eens, en dan blijkt vanzelf of het is opgelost.
-- ---------------------------------------------------------------------------

create or replace function public.expense_exact_fout_opruimen()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.exact_fout, '') = '' then return new; end if;
  /* Zet de serverfunctie zelf een nieuwe fout, dan is dat geen oplossing. */
  if new.exact_fout is distinct from old.exact_fout then return new; end if;

  if new.administratie    is distinct from old.administratie
     or new.grootboek_code is distinct from old.grootboek_code
     or new.amount_excl    is distinct from old.amount_excl
     or new.vat_pct        is distinct from old.vat_pct
     or new.supplier       is distinct from old.supplier
     or new.factuurnummer  is distinct from old.factuurnummer
  then
    new.exact_fout := null;
    new.exact_fout_at := null;
  end if;

  return new;
end $$;

revoke execute on function public.expense_exact_fout_opruimen() from public, anon, authenticated;

drop trigger if exists expenses_exact_fout_opruimen on public.expenses;
create trigger expenses_exact_fout_opruimen
  before update on public.expenses
  for each row execute function public.expense_exact_fout_opruimen();
