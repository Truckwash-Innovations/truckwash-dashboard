-- ===========================================================================
--  Betaald zetten, en een SEPA-bestand voor de bank
--
--  Casper: "Zorg ervoor dat je hem ook op betaald kan zetten, evt een sepa
--  bestand kan aanmaken ect."
--
--  Twee dingen die bij elkaar horen. Een factuur op betaald zetten is de
--  laatste stap van de keten -- daarna is hij klaar. En een SEPA-bestand is
--  hoe dat betalen in de praktijk gaat: je maakt één bestand met alle
--  openstaande facturen erin, laadt het bij de bank, en die maakt ze in één
--  keer over.
--
--  Waarom een batch en niet per factuur
--  ------------------------------------
--
--  Omdat de bank het zo wil, en omdat je anders niet terug kunt kijken. Een
--  batch is een moment: op 3 april is er voor 12.400 euro aan achttien
--  facturen weggezet. Zonder dat is er alleen een stapel facturen die
--  "betaald" heet en niets dat zegt wanneer en in welke opdracht.
--
--  Wat er NIET automatisch gebeurt
--  -------------------------------
--
--  Betaald zetten bij het maken van het bestand. Een bestand maken is niet
--  hetzelfde als geld overmaken -- er kan nog van alles tussen komen: de
--  bank weigert het, iemand vergeet het te fiatteren, het bestand blijft in
--  de map staan. Pas als iemand zegt dat het is uitgevoerd, gaan de facturen
--  op betaald. Dat is een handeling, met opzet.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Wanneer een factuur betaald is
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists betaald_at     bigint;
alter table public.expenses add column if not exists betaald_door   text;
alter table public.expenses add column if not exists betaalbatch_id text;

comment on column public.expenses.betaald_at is
  'Wanneer deze factuur is betaald (0065). Leeg = staat nog open.';

alter table public.verkoopfactuur add column if not exists betaald_door text;

-- ---------------------------------------------------------------------------
--  Van welke rekening er betaald wordt
--
--  Per bv, want elke administratie heeft zijn eigen bankrekening. Op de
--  administratie en niet in de instellingen: die zijn er één van elk, en dit
--  is er één per bv.
-- ---------------------------------------------------------------------------

alter table public.exact_administratie add column if not exists eigen_iban text;
alter table public.exact_administratie add column if not exists eigen_naam text;
alter table public.exact_administratie add column if not exists eigen_bic  text;

comment on column public.exact_administratie.eigen_iban is
  'De rekening waarvan deze bv betaalt (0065). Komt in het SEPA-bestand als '
  'de rekening van de opdrachtgever.';

-- ---------------------------------------------------------------------------
--  De betaalopdracht
-- ---------------------------------------------------------------------------

create table if not exists public.betaalbatch (
  id            text primary key,
  administratie text,
  /* Wat er in het bestand als MsgId staat. De bank gebruikt dat om een
     dubbel aangeleverd bestand te herkennen, dus hij moet uniek zijn. */
  bericht_id    text not null,
  bestandsnaam  text not null default '',
  aantal        integer not null default 0,
  totaal        numeric not null default 0,
  /* Uitvoeringsdatum die in het bestand staat. */
  uitvoeren_op  bigint,
  status        text not null default 'concept'
                check (status in ('concept', 'uitgevoerd', 'ingetrokken')),
  door          text,
  aangemaakt_at bigint not null default public.now_ms(),
  uitgevoerd_at bigint,
  updated_at    bigint not null default public.now_ms()
);

create unique index if not exists betaalbatch_bericht_uniek
  on public.betaalbatch (bericht_id);

create table if not exists public.betaalregel (
  id         text primary key,
  batch_id   text not null,
  expense_id text not null,
  naam       text not null default '',
  iban       text not null,
  bedrag     numeric not null default 0,
  /* Wat de leverancier op zijn afschrift ziet: het factuurnummer. */
  kenmerk    text,
  updated_at bigint not null default public.now_ms()
);

create index if not exists betaalregel_batch_idx on public.betaalregel (batch_id);

/*
 * Eén factuur in één lopende batch.
 *
 * Zonder dit staat dezelfde factuur in het bestand van dinsdag en dat van
 * donderdag, en wordt hij twee keer overgemaakt.
 *
 * Dit stond eerst als unieke index met "where batch_id in (select ...)". Dat
 * kan niet: een index mag geen subquery in zijn voorwaarde hebben, en de
 * migratie viel er in zijn geheel op om. Het staat nu in de trigger
 * hieronder, die er toch al was -- en die kan wél kijken of de batch waar de
 * andere regel in zit is ingetrokken. Ingetrokken batches tellen niet mee:
 * die zijn nooit bij de bank geweest.
 */

comment on table public.betaalbatch is
  'Een betaalopdracht voor de bank (0065). Een batch is een moment: op 3 '
  'april is er voor 12.400 euro aan achttien facturen weggezet.';

-- ---------------------------------------------------------------------------
--  Een uitgevoerde batch ligt vast
-- ---------------------------------------------------------------------------

create or replace function public.betaalregel_op_slot()
returns trigger
language plpgsql security definer set search_path = public as $$
declare b_id text := coalesce(new.batch_id, old.batch_id);
begin
  if exists (select 1 from public.betaalbatch b
              where b.id = b_id and b.status = 'uitgevoerd') then
    raise exception 'Deze betaalopdracht is al uitgevoerd en ligt vast.'
      using errcode = 'check_violation';
  end if;

  /* En dezelfde factuur mag niet in twee lopende opdrachten staan -- dan
     wordt hij twee keer overgemaakt. Ingetrokken opdrachten tellen niet mee. */
  if tg_op = 'INSERT' and exists (
    select 1 from public.betaalregel r
      join public.betaalbatch b on b.id = r.batch_id
     where r.expense_id = new.expense_id
       and r.id <> new.id
       and b.status <> 'ingetrokken'
  ) then
    raise exception 'Deze factuur staat al in een betaalopdracht.'
      using errcode = 'unique_violation';
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists betaalregel_op_slot_trg on public.betaalregel;
create trigger betaalregel_op_slot_trg
  before insert or update or delete on public.betaalregel
  for each row execute function public.betaalregel_op_slot();

-- ---------------------------------------------------------------------------
--  Uitvoeren: de facturen op betaald
--
--  Eén handeling, en pas als iemand zegt dat de bank hem heeft gedraaid. Een
--  bestand maken is niet hetzelfde als geld overmaken.
-- ---------------------------------------------------------------------------

create or replace function public.betaalbatch_uitvoeren(batch_in text, door_in text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.expenses e
     set betaald_at = public.now_ms(),
         betaald_door = door_in,
         betaalbatch_id = batch_in,
         updated_at = public.now_ms()
    from public.betaalregel r
   where r.batch_id = batch_in
     and e.id = r.expense_id
     and e.betaald_at is null;

  get diagnostics n = row_count;

  update public.betaalbatch
     set status = 'uitgevoerd', uitgevoerd_at = public.now_ms(),
         door = coalesce(door_in, door), updated_at = public.now_ms()
   where id = batch_in;

  return n;
end $$;

revoke execute on function public.betaalbatch_uitvoeren(text, text) from public, anon, authenticated;
grant  execute on function public.betaalbatch_uitvoeren(text, text) to service_role;

-- ---------------------------------------------------------------------------
--  Wat er openstaat
--
--  Goedgekeurd, geboekt in Exact, nog niet betaald, en er staat een IBAN op.
--  Die laatste komt uit wat de lezer van de factuur heeft gehaald; zonder
--  rekeningnummer valt er niets over te maken.
-- ---------------------------------------------------------------------------

create or replace function public.betaalbaar()
returns table (
  id            text,
  leverancier   text,
  factuurnummer text,
  bedrag_incl   numeric,
  iban          text,
  administratie text,
  datum         bigint,
  vervaldatum   bigint
)
language sql stable security definer set search_path = public as $$
  select e.id,
         coalesce(e.supplier, ''),
         e.factuurnummer,
         round(coalesce(e.amount_excl, 0) * (1 + coalesce(e.vat_pct, 0) / 100.0), 2),
         upper(replace(coalesce(e.gelezen->>'iban', ''), ' ', '')),
         public.bon_administratie(e.id),
         e.expense_date,
         e.vervaldatum
    from public.expenses e
   where e.status = 'goedgekeurd'
     and e.betaald_at is null
     and coalesce(e.amount_excl, 0) > 0
     and not exists (
       select 1 from public.betaalregel r
         join public.betaalbatch b on b.id = r.batch_id
        where r.expense_id = e.id and b.status <> 'ingetrokken')
   order by coalesce(e.vervaldatum, e.expense_date);
$$;

revoke execute on function public.betaalbaar() from public, anon, authenticated;
grant  execute on function public.betaalbaar() to service_role;

-- ---------------------------------------------------------------------------
--  Wie mag wat
-- ---------------------------------------------------------------------------

alter table public.betaalbatch enable row level security;
alter table public.betaalregel enable row level security;

do $$
declare t text;
begin
  foreach t in array array['betaalbatch', 'betaalregel'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated '
      'using (public.is_management() or public.heeft_recht(''admin.desk''))',
      t, t);
  end loop;
end $$;
