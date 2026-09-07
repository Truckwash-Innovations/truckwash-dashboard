-- ===========================================================================
--  Verkoopfacturen: de andere kant van de factuurstroom
--
--  Casper: "Bij een factuur moet je zowel inkomend als uitkomend nadenken,
--  pas dit dan ook toe."
--
--  Tot nu toe kende dit systeem alleen de inkomende kant. Aan de klantzijde
--  stond wel een scherm "Facturen", maar dat was een BEREKENING: alle
--  gereedgemelde wasbeurten van een maand bij elkaar opgeteld. Handig om te
--  zien, en geen factuur -- er is geen nummer, geen datum, geen bedrag dat
--  vastligt, en dus ook niets om aan een betaling te koppelen of naar Exact
--  te sturen.
--
--  Waarom een berekening geen factuur is
--  -------------------------------------
--
--  Omdat een factuur een moment vastlegt. Wordt er na het versturen een
--  wasbeurt bijgeboekt of een prijs gecorrigeerd, dan verandert de berekening
--  mee en klopt hij niet meer met het papier dat de klant heeft. Daarom
--  worden de regels bij het opmaken overgenomen en niet later nog eens
--  uitgerekend.
--
--  Eén wasbeurt, één factuur
--  -------------------------
--
--  De belangrijkste regel hier. Zonder slot komt dezelfde wasbeurt op de
--  factuur van maart en die van april -- en dan heb je hem twee keer in
--  rekening gebracht bij een klant die dat wél opmerkt. Vandaar de unieke
--  index op de wasbeurt in de regels.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De nummering
--
--  Per administratie en per jaar, zoals een boekhouding het wil. Een eigen
--  tabelletje en niet max()+1 op de facturen: twee mensen die op hetzelfde
--  moment een factuur opmaken zouden dan hetzelfde nummer krijgen, en dat is
--  precies het geval waarin het niemand opvalt tot de accountant belt.
-- ---------------------------------------------------------------------------

create table if not exists public.verkoop_nummering (
  administratie text not null,
  jaar          integer not null,
  laatste       integer not null default 0,
  primary key (administratie, jaar)
);

create or replace function public.volgend_verkoopnummer(administratie_in text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  jr   integer := extract(year from now())::integer;
  vlgn integer;
begin
  insert into public.verkoop_nummering (administratie, jaar, laatste)
  values (coalesce(nullif(trim(administratie_in), ''), 'onbekend'), jr, 1)
  on conflict (administratie, jaar) do update
    set laatste = public.verkoop_nummering.laatste + 1
  returning laatste into vlgn;

  return jr::text || '-' || lpad(vlgn::text, 4, '0');
end $$;

revoke execute on function public.volgend_verkoopnummer(text) from public, anon;
grant  execute on function public.volgend_verkoopnummer(text) to service_role, authenticated;

comment on function public.volgend_verkoopnummer(text) is
  'Het volgende factuurnummer voor deze bv, per jaar (0064). Via een eigen '
  'teller en niet max()+1: twee mensen tegelijk zouden hetzelfde nummer '
  'krijgen, en dat valt niemand op tot de accountant belt.';

-- ---------------------------------------------------------------------------
--  De factuur
-- ---------------------------------------------------------------------------

create table if not exists public.verkoopfactuur (
  id            text primary key,
  /* Leeg zolang hij concept is. Een nummer uitgeven aan iets dat nog
     weggegooid kan worden, laat een gat in de reeks achter. */
  nummer        text,
  company_id    text not null,
  company_naam  text not null default '',
  administratie text,
  datum         bigint not null default public.now_ms(),
  vervaldatum   bigint,
  /* De maand waar hij over gaat, als 2026-03. Puur om te kunnen zien of een
     periode al gefactureerd is. */
  periode       text,
  bedrag_excl   numeric not null default 0,
  btw_bedrag    numeric not null default 0,
  bedrag_incl   numeric not null default 0,
  status        text not null default 'concept'
                check (status in ('concept', 'verstuurd', 'betaald', 'vervallen')),
  verstuurd_at  bigint,
  betaald_at    bigint,
  opmerking     text,
  /* Waar hij in Exact terechtkwam. Gevuld = geboekt en gaat niet nog eens. */
  exact_id      text,
  exact_at      bigint,
  exact_fout    text,
  updated_at    bigint not null default public.now_ms()
);

create index if not exists verkoopfactuur_klant_idx on public.verkoopfactuur (company_id, datum);
create index if not exists verkoopfactuur_status_idx on public.verkoopfactuur (status);

/* Een nummer is uniek binnen zijn administratie. Twee facturen met hetzelfde
   nummer is een boekhouding die niet meer te controleren is. */
create unique index if not exists verkoopfactuur_nummer_uniek
  on public.verkoopfactuur (coalesce(administratie, ''), nummer)
  where nummer is not null;

create unique index if not exists verkoopfactuur_exact_uniek
  on public.verkoopfactuur (exact_id) where exact_id is not null;

comment on table public.verkoopfactuur is
  'Een factuur aan een klant (0064). De regels liggen vast zodra hij is '
  'opgemaakt; het scherm bij de klant rekende ze tot nu toe elke keer '
  'opnieuw uit, en dan verandert een verstuurde factuur mee.';

-- ---------------------------------------------------------------------------
--  De regels
-- ---------------------------------------------------------------------------

create table if not exists public.verkoopregel (
  id            text primary key,
  factuur_id    text not null,
  volgorde      integer not null default 0,
  omschrijving  text not null default '',
  aantal        numeric not null default 1,
  prijs_excl    numeric not null default 0,
  btw_pct       integer not null default 21,
  grootboek_code text,
  /* Uit welke wasbeurt deze regel komt, als hij daaruit komt. */
  wash_job_id   text,
  updated_at    bigint not null default public.now_ms()
);

create index if not exists verkoopregel_factuur_idx on public.verkoopregel (factuur_id, volgorde);

/*
 * Eén wasbeurt kan maar op één factuur staan.
 *
 * Dit is het slot waar het om gaat. Zonder deze index komt dezelfde wasbeurt
 * op de factuur van maart én die van april, en dan heb je hem twee keer in
 * rekening gebracht bij een klant die dat wél opmerkt.
 */
create unique index if not exists verkoopregel_wasbeurt_uniek
  on public.verkoopregel (wash_job_id) where wash_job_id is not null;

-- ---------------------------------------------------------------------------
--  Een verstuurde factuur ligt vast
--
--  Zodra hij de deur uit is, heeft de klant papier met bedragen erop. Onze
--  regels daarna nog wijzigen betekent dat de twee iets anders zeggen. Wat
--  dan nog kan is een creditnota, en dat is een nieuwe factuur.
-- ---------------------------------------------------------------------------

create or replace function public.verkoopregel_op_slot()
returns trigger
language plpgsql security definer set search_path = public as $$
declare f_id text := coalesce(new.factuur_id, old.factuur_id);
begin
  if exists (select 1 from public.verkoopfactuur f
              where f.id = f_id and f.status <> 'concept') then
    raise exception 'Deze factuur is niet meer concept; de regels liggen vast.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists verkoopregel_op_slot_trg on public.verkoopregel;
create trigger verkoopregel_op_slot_trg
  before insert or update or delete on public.verkoopregel
  for each row execute function public.verkoopregel_op_slot();

-- ---------------------------------------------------------------------------
--  De bedragen komen uit de regels
--
--  Niet met de hand in te vullen. Een totaal dat los van de regels bestaat,
--  is een totaal dat er op een dag niet meer bij past -- en dan is niet te
--  zien welke van de twee klopt.
-- ---------------------------------------------------------------------------

create or replace function public.verkoopfactuur_tellen(factuur_in text)
returns void
language plpgsql security definer set search_path = public as $$
declare excl numeric; btw numeric;
begin
  select coalesce(sum(r.aantal * r.prijs_excl), 0),
         coalesce(sum(r.aantal * r.prijs_excl * r.btw_pct / 100.0), 0)
    into excl, btw
    from public.verkoopregel r where r.factuur_id = factuur_in;

  update public.verkoopfactuur
     set bedrag_excl = round(excl, 2),
         btw_bedrag  = round(btw, 2),
         bedrag_incl = round(excl + btw, 2),
         updated_at  = public.now_ms()
   where id = factuur_in;
end $$;

revoke execute on function public.verkoopfactuur_tellen(text) from public, anon;
grant  execute on function public.verkoopfactuur_tellen(text) to service_role, authenticated;

create or replace function public.verkoopregel_geteld()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.verkoopfactuur_tellen(coalesce(new.factuur_id, old.factuur_id));
  return coalesce(new, old);
end $$;

drop trigger if exists verkoopregel_geteld_trg on public.verkoopregel;
create trigger verkoopregel_geteld_trg
  after insert or update or delete on public.verkoopregel
  for each row execute function public.verkoopregel_geteld();

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  De administratie en het management maken ze op. En de klant ziet zijn
--  eigen facturen -- dat is het hele punt van dat scherm in zijn dashboard,
--  en het was tot nu toe een berekening die hij niet kon bewaren.
--
--  Een concept ziet hij niet: dat is werk in de maak, en een bedrag dat nog
--  verandert bij een klant in beeld levert een telefoontje op.
-- ---------------------------------------------------------------------------

alter table public.verkoopfactuur enable row level security;
alter table public.verkoopregel   enable row level security;

drop policy if exists verkoopfactuur_select on public.verkoopfactuur;
create policy verkoopfactuur_select on public.verkoopfactuur for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk')
         or public.heeft_recht('finance.view')
         or (status <> 'concept' and company_id = (
              select p.company_id from public.profiles p where p.id::text = public.my_id())));

drop policy if exists verkoopfactuur_write on public.verkoopfactuur;
create policy verkoopfactuur_write on public.verkoopfactuur for all to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'))
  with check (public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists verkoopregel_select on public.verkoopregel;
create policy verkoopregel_select on public.verkoopregel for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk')
         or public.heeft_recht('finance.view')
         or exists (select 1 from public.verkoopfactuur f
                     where f.id = factuur_id and f.status <> 'concept'
                       and f.company_id = (select p.company_id from public.profiles p
                                            where p.id::text = public.my_id())));

drop policy if exists verkoopregel_write on public.verkoopregel;
create policy verkoopregel_write on public.verkoopregel for all to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'))
  with check (public.is_management() or public.heeft_recht('admin.desk'));

-- ---------------------------------------------------------------------------
--  Het verkoopdagboek
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_exact_verkoopdagboek', 'exact_verkoopdagboek', '',
   'Het verkoopdagboek in Exact waarin een verkoopfactuur wordt geboekt. '
   'Leeg = er gaat niets heen, want Exact weigert een boeking zonder dagboek.')
on conflict (id) do nothing;

insert into public.exact_sync (soort) values ('verkoopfacturen')
on conflict (soort) do nothing;

-- ---------------------------------------------------------------------------
--  Facturen opmaken uit de wasbeurten
--
--  Per klant één concept over een maand, met een regel per wasbeurt. Wat al
--  op een factuur staat wordt overgeslagen -- de unieke index op wash_job_id
--  bewaakt dat, maar hier wordt het al netjes weggefilterd zodat er geen
--  botsing hoeft te ontstaan.
--
--  Alleen gereedgemelde beurten, want alleen die zijn geleverd. En alleen
--  klanten die een bedrag hebben: een maand met alleen beurten van nul euro
--  levert een factuur op waar niemand iets aan heeft.
--
--  Concept, met opzet. Er komt geen nummer aan te pas en er gaat niets de
--  deur uit; iemand kijkt ernaar en verstuurt hem. Een factuur die zichzelf
--  verstuurt is een factuur die je niet meer kunt tegenhouden.
-- ---------------------------------------------------------------------------

create or replace function public.verkoopfacturen_opmaken(
  periode_in text,
  door_in    text default null
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  vanaf  bigint;
  tot    bigint;
  klant  record;
  f_id   text;
  gemaakt integer := 0;
  n      integer;
begin
  /* De maand als 2026-03. Begin en einde in milliseconden, want zo staat de
     tijd overal in dit schema. */
  vanaf := (extract(epoch from (periode_in || '-01')::date) * 1000)::bigint;
  tot   := (extract(epoch from ((periode_in || '-01')::date + interval '1 month')) * 1000)::bigint;

  for klant in
    select j.company_id, min(j.company_name) as naam, count(*) as beurten
      from public.wash_jobs j
     where j.status = 'gereed'
       and j.completed_at >= vanaf and j.completed_at < tot
       and coalesce(j.price_excl, 0) > 0
       and not exists (select 1 from public.verkoopregel r where r.wash_job_id = j.id)
     group by j.company_id
  loop
    /* Al een concept voor deze klant en deze maand? Dan daarin bijvullen in
       plaats van een tweede maken -- anders krijgt de klant twee facturen
       over dezelfde maand omdat er een beurt later is bijgeboekt. */
    select f.id into f_id
      from public.verkoopfactuur f
     where f.company_id = klant.company_id
       and f.periode = periode_in
       and f.status = 'concept'
     limit 1;

    if f_id is null then
      f_id := 'vf_' || replace(periode_in, '-', '') || '_' || klant.company_id;
      insert into public.verkoopfactuur
        (id, company_id, company_naam, periode, datum, vervaldatum, administratie, opmerking)
      values (
        f_id, klant.company_id, klant.naam, periode_in,
        tot - 1,
        tot - 1 + (30::bigint * 24 * 60 * 60 * 1000),
        (select a.code from public.exact_administratie a where a.hoofd limit 1),
        'Wasbeurten ' || periode_in)
      on conflict (id) do nothing;
      gemaakt := gemaakt + 1;
    end if;

    insert into public.verkoopregel
      (id, factuur_id, volgorde, omschrijving, aantal, prijs_excl, btw_pct, wash_job_id)
    select 'vr_' || j.id,
           f_id,
           row_number() over (order by j.completed_at),
           coalesce(nullif(j.service, ''), 'Wasbeurt') || ' · ' || j.plate,
           1,
           j.price_excl,
           21,
           j.id
      from public.wash_jobs j
     where j.company_id = klant.company_id
       and j.status = 'gereed'
       and j.completed_at >= vanaf and j.completed_at < tot
       and coalesce(j.price_excl, 0) > 0
       and not exists (select 1 from public.verkoopregel r where r.wash_job_id = j.id)
    on conflict (id) do nothing;

    perform public.verkoopfactuur_tellen(f_id);
    f_id := null;
  end loop;

  return gemaakt;
end $$;

revoke execute on function public.verkoopfacturen_opmaken(text, text) from public, anon, authenticated;
grant  execute on function public.verkoopfacturen_opmaken(text, text) to service_role;

comment on function public.verkoopfacturen_opmaken(text, text) is
  'Maakt per klant een conceptfactuur over een maand uit de gereedgemelde '
  'wasbeurten (0064). Wat al op een factuur staat wordt overgeslagen. '
  'Concept met opzet: een factuur die zichzelf verstuurt kun je niet meer '
  'tegenhouden.';

-- ---------------------------------------------------------------------------
--  Versturen: het nummer erop
--
--  Pas hier krijgt hij een nummer, en daarna liggen de regels vast. Een
--  nummer uitgeven aan een concept dat nog weggegooid kan worden, laat een
--  gat in de reeks achter -- en een boekhouding met gaten is een boekhouding
--  waar de accountant vragen over stelt.
-- ---------------------------------------------------------------------------

create or replace function public.verkoopfactuur_versturen(factuur_in text)
returns text
language plpgsql security definer set search_path = public as $$
declare f record; nr text;
begin
  select * into f from public.verkoopfactuur where id = factuur_in;
  if f is null then
    raise exception 'Die factuur bestaat niet.' using errcode = 'no_data_found';
  end if;
  if f.status <> 'concept' then
    return f.nummer;  -- al verstuurd; niets te doen
  end if;
  if coalesce(f.bedrag_excl, 0) <= 0 then
    raise exception 'Een factuur van nul euro versturen heeft geen zin.'
      using errcode = 'check_violation';
  end if;

  nr := public.volgend_verkoopnummer(f.administratie);

  update public.verkoopfactuur
     set nummer = nr, status = 'verstuurd',
         verstuurd_at = public.now_ms(), updated_at = public.now_ms()
   where id = factuur_in;

  return nr;
end $$;

revoke execute on function public.verkoopfactuur_versturen(text) from public, anon, authenticated;
grant  execute on function public.verkoopfactuur_versturen(text) to service_role;
