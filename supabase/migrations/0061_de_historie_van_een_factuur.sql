-- ===========================================================================
--  De historie van een factuur, en notities erbij
--
--  Casper: "je moet de historie zien van dat factuur, goed kunnen zoeken,
--  notities erbij zetten".
--
--  Er wás al een tijdlijn in het scherm, maar die werd afgeleid uit de velden
--  op de bon: binnengekomen, voorgelezen, goedgekeurd. Dat werkt zolang er
--  drie momenten zijn en elk moment zijn eigen kolom heeft. Zodra iemand een
--  bedrag corrigeert, een rekening omzet of een tweede handtekening zet, is
--  er niets meer wat dat onthoudt -- en juist dát is wat je wilt terugzien
--  als een boeking achteraf niet klopt.
--
--  Waarom een trigger en niet de app
--  ---------------------------------
--
--  Omdat er drie wegen naar een kostenpost lopen. De app (via de wachtrij),
--  de post die een factuur binnenhaalt, en de lezer die hem invult. Alle drie
--  zouden ze netjes een regel moeten schrijven, en op een dag doet er een dat
--  niet -- en dan mist er een gebeurtenis zonder dat iemand het merkt.
--
--  Een trigger ziet alles, ook wat langs de wachtrij binnenkomt. Wat hij niet
--  ziet is WAAROM iets veranderde; daar zijn de notities voor.
--
--  Wat er NIET in komt
--  -------------------
--
--  Elke wijziging van elk veld. Dat levert een lijst op waar niemand
--  doorheen komt, met tien regels "updated_at gewijzigd" per bon. Alleen wat
--  ertoe doet: de stand, het bedrag, de rekening, de leverancier, het
--  factuurnummer, en de gang naar Exact.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Wat er gebeurd is
-- ---------------------------------------------------------------------------

create table if not exists public.expense_gebeurtenis (
  /* De sleutel heet id, zoals overal: de synchronisatie vergelijkt elke
     binnengehaalde rij met de wachtrij op rij.id (zie 0044). */
  id          text primary key,
  expense_id  text not null,
  at          bigint not null default public.now_ms(),
  /* Wat voor gebeurtenis. 'notitie' is de enige die een mens zelf maakt; de
     rest schrijft de trigger. */
  soort       text not null
              check (soort in ('aangemaakt', 'gewijzigd', 'eerste_akkoord',
                               'goedgekeurd', 'afgekeurd', 'heropend',
                               'notitie', 'naar_exact')),
  tekst       text not null default '',
  /* Bij 'gewijzigd': welk veld, en van wat naar wat. Als tekst bewaard, want
     het gaat om lezen en niet om rekenen. */
  veld        text,
  oud         text,
  nieuw       text,
  door        text,
  door_naam   text,
  updated_at  bigint not null default public.now_ms()
);

create index if not exists gebeurtenis_bon_idx
  on public.expense_gebeurtenis (expense_id, at);

comment on table public.expense_gebeurtenis is
  'De historie van een kostenpost (0061): standwijzigingen, correcties, de '
  'gang naar Exact, en notities. Grotendeels geschreven door een trigger, '
  'want er lopen drie wegen naar een bon en er zou er altijd een vergeten.';

-- ---------------------------------------------------------------------------
--  De trigger
--
--  Alleen wat ertoe doet. Bij een stand die verandert een regel met die
--  stand als soort; bij de vier velden waar het geld aan hangt een regel
--  'gewijzigd' met van-en-naar erbij.
--
--  Wie het deed: my_id() als het uit de app komt, en anders niets -- dan
--  staat er in het scherm "door het systeem", wat eerlijker is dan een naam
--  verzinnen.
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
            'Boeking ' || new.exact_id, wie, naam)
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

  return new;
end $$;

drop trigger if exists expense_gebeurtenis_trg on public.expenses;
create trigger expense_gebeurtenis_trg
  after insert or update on public.expenses
  for each row execute function public.expense_gebeurtenis_schrijf();

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  Lezen: wie de kostenposten mag zien. Schrijven: alleen notities, en
--  alleen op eigen naam -- een regel in de historie op naam van een collega
--  zetten maakt de hele historie waardeloos.
--
--  Wijzigen en weggooien kan niemand. Een spoor dat je kunt bijschaven is
--  geen spoor; dezelfde afspraak als bij expenses.gelezen (0049).
-- ---------------------------------------------------------------------------

alter table public.expense_gebeurtenis enable row level security;

drop policy if exists gebeurtenis_select on public.expense_gebeurtenis;
create policy gebeurtenis_select on public.expense_gebeurtenis
  for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk')
         or public.heeft_recht('expenses.read') or public.heeft_recht('expenses.approve')
         or exists (select 1 from public.expenses e
                     where e.id = expense_id and e.submitted_by = public.my_id()));

drop policy if exists gebeurtenis_insert on public.expense_gebeurtenis;
create policy gebeurtenis_insert on public.expense_gebeurtenis
  for insert to authenticated
  /* rij_bestaat() staat vooraan om dezelfde reden als overal: een upsert
     langs PostgREST beoordeelt deze insert-regel OOK als de rij al bestaat,
     en dan wordt een gewone wijziging geweigerd met "new row violates
     row-level security policy". Zie 0044. */
  with check (public.rij_bestaat('public.expense_gebeurtenis'::regclass, id)
              or (soort = 'notitie' and door = public.my_id()));
