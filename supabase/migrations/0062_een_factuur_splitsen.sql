-- ===========================================================================
--  Een factuur splitsen
--
--  Casper: "notities erbij zetten, splitsen, koppelen ect."
--
--  Eén factuur, meerdere regels. De rekening van Enexis is voor drie
--  vestigingen; de bon van de groothandel staat half op wasmiddelen en half
--  op klein materiaal. Tot nu toe kon dat niet: een kostenpost had één bedrag
--  en één grootboekrekening, en wie het wilde splitsen moest hem twee keer
--  invoeren -- met twee keer hetzelfde factuurnummer, wat de dubbelcontrole
--  juist tegenhoudt.
--
--  Hoe het werkt
--  -------------
--
--  Geen regels = zoals het was. Het bedrag en de rekening op de bon zelf
--  zijn dan de boeking. Dat is verreweg het meeste, en dat moet simpel
--  blijven.
--
--  Wél regels = de bon is de optelsom. Het bedrag op de bon blijft leidend --
--  dat is wat de leverancier vraagt -- en de regels moeten daarop uitkomen.
--
--  Waarom het optellen pas bij het goedkeuren wordt afgedwongen
--  -----------------------------------------------------------
--
--  Omdat je een splitsing opbouwt. Zet je de eis op elke regel die je
--  toevoegt, dan klopt hij per definitie niet zolang je bezig bent, en dan is
--  het onmogelijk om er een tweede regel bij te typen.
--
--  Bij het goedkeuren is het wél de vraag die telt: gaat er straks precies
--  het bedrag naar de boekhouding dat er op de factuur staat? Een verschil
--  van een cent is daar geen detail maar een boeking die niet sluit.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De regels
-- ---------------------------------------------------------------------------

create table if not exists public.expense_regel (
  /* De sleutel heet id, zoals overal (zie 0044). */
  id             text primary key,
  expense_id     text not null,
  /* Waar hij in de lijst staat. Niet af te leiden uit de tijd: iemand voegt
     er later een regel tussen. */
  volgorde       integer not null default 0,
  omschrijving   text not null default '',
  bedrag_excl    numeric not null default 0,
  btw_pct        integer not null default 21,
  grootboek_code text,
  /* De kostenplaats: welke vestiging deze regel draagt. Leeg = die van de
     bon zelf. Zo is één energierekening over drie vestigingen te verdelen. */
  location_id    text,
  updated_at     bigint not null default public.now_ms()
);

create index if not exists expense_regel_bon_idx
  on public.expense_regel (expense_id, volgorde);

comment on table public.expense_regel is
  'De regels van een gesplitste factuur (0062). Geen regels betekent: het '
  'bedrag en de rekening op de bon zelf zijn de boeking.';

-- ---------------------------------------------------------------------------
--  Wat er nog aan ontbreekt
--
--  Geeft het verschil tussen de optelsom van de regels en het bedrag op de
--  bon. Nul betekent dat het sluit; er zijn ook nul regels, en dan is er
--  niets te sluiten -- vandaar dat de functie null geeft als er geen regels
--  zijn, en dat is iets anders dan een verschil van nul.
-- ---------------------------------------------------------------------------

create or replace function public.expense_regels_verschil(expense_in text)
returns numeric
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.expense_regel r where r.expense_id = expense_in)
      then null
    else coalesce((select sum(r.bedrag_excl) from public.expense_regel r
                    where r.expense_id = expense_in), 0)
       - coalesce((select e.amount_excl from public.expenses e where e.id = expense_in), 0)
  end;
$$;

revoke execute on function public.expense_regels_verschil(text) from public, anon;
grant  execute on function public.expense_regels_verschil(text) to service_role, authenticated;

-- ---------------------------------------------------------------------------
--  Een splitsing die niet sluit gaat niet door
--
--  Bij het goedkeuren, en niet eerder. Zie de kop: een splitsing bouw je op,
--  en tussentijds klopt hij per definitie niet.
--
--  Dit hangt aan dezelfde trigger-plek als vier ogen (0060) maar is een eigen
--  functie: het zijn twee verschillende vragen, en samengevoegd zou de
--  foutmelding niet meer zeggen welke van de twee het was.
-- ---------------------------------------------------------------------------

create or replace function public.expenses_regels_sluiten()
returns trigger
language plpgsql security definer set search_path = public as $$
declare verschil numeric;
begin
  if new.status not in ('eerste_akkoord', 'goedgekeurd') then
    return new;
  end if;
  if coalesce(old.status, 'open') = new.status then
    return new;
  end if;

  verschil := public.expense_regels_verschil(new.id);
  if verschil is null then
    return new;  -- geen regels: niets te sluiten
  end if;

  if abs(verschil) >= 0.005 then
    raise exception 'De regels tellen op tot % te %, en dan sluit de boeking niet.',
      abs(round(verschil, 2)),
      case when verschil > 0 then 'veel' else 'weinig' end
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists expenses_regels_sluiten_trg on public.expenses;
create trigger expenses_regels_sluiten_trg
  before update on public.expenses
  for each row execute function public.expenses_regels_sluiten();

-- ---------------------------------------------------------------------------
--  Een geboekte factuur splitst niet meer
--
--  Zodra hij in Exact staat, staat de boeking daar. Onze regels daarna nog
--  wijzigen betekent dat de twee iets anders zeggen, en dan is er geen manier
--  meer om te weten welke klopt.
-- ---------------------------------------------------------------------------

create or replace function public.expense_regel_op_slot()
returns trigger
language plpgsql security definer set search_path = public as $$
declare bon_id text := coalesce(new.expense_id, old.expense_id);
begin
  if exists (select 1 from public.expenses e
              where e.id = bon_id and e.exact_id is not null) then
    raise exception 'Deze factuur staat al in Exact; de verdeling kan niet meer wijzigen.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists expense_regel_op_slot_trg on public.expense_regel;
create trigger expense_regel_op_slot_trg
  before insert or update or delete on public.expense_regel
  for each row execute function public.expense_regel_op_slot();

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  Dezelfde grens als de bon zelf: wie over kosten mag beslissen, en de
--  indiener zolang de bon nog open staat.
-- ---------------------------------------------------------------------------

alter table public.expense_regel enable row level security;

drop policy if exists expense_regel_select on public.expense_regel;
create policy expense_regel_select on public.expense_regel for select to authenticated
  using (public.mag_kosten_beslissen()
         or exists (select 1 from public.expenses e
                     where e.id = expense_id and e.submitted_by = public.my_id()));

drop policy if exists expense_regel_insert on public.expense_regel;
create policy expense_regel_insert on public.expense_regel for insert to authenticated
  /* rij_bestaat() vooraan, want een upsert langs PostgREST beoordeelt deze
     regel ook als de rij al bestaat -- zie 0044. */
  with check (public.rij_bestaat('public.expense_regel'::regclass, id)
              or public.mag_kosten_beslissen()
              or exists (select 1 from public.expenses e
                          where e.id = expense_id and e.submitted_by = public.my_id()
                            and e.status = 'open'));

drop policy if exists expense_regel_update on public.expense_regel;
create policy expense_regel_update on public.expense_regel for update to authenticated
  using (public.mag_kosten_beslissen()
         or exists (select 1 from public.expenses e
                     where e.id = expense_id and e.submitted_by = public.my_id()
                       and e.status = 'open'))
  with check (public.mag_kosten_beslissen()
              or exists (select 1 from public.expenses e
                          where e.id = expense_id and e.submitted_by = public.my_id()
                            and e.status = 'open'));

drop policy if exists expense_regel_delete on public.expense_regel;
create policy expense_regel_delete on public.expense_regel for delete to authenticated
  using (public.mag_kosten_beslissen());
