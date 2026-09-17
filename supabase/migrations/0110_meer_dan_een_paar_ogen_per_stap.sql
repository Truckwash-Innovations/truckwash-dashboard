-- ===========================================================================
--  Meer dan één paar ogen per stap
--
--  Casper: "Kan je het mogelijk maken om meerdere mensen bij zowel de eerste
--  als tweede neer te zetten?"
--
--  Wat er stond
--  ------------
--
--  Overal één naam. expenses.goedkeurder is één persoon, inkoop_adres.
--  goedkeurder is één persoon, en bv_route.eerste (0106, gisteren) ook. Dat
--  maakt van elke stap een flessenhals met een naam: gaat die ene op vakantie,
--  dan staat de stapel stil tot het management ingrijpt.
--
--  En er was iets anders mis, dat deze vraag blootlegt: er was helemaal geen
--  eerste STAP in de routering. Wat 0106 "de eerste beoordelaar" noemde, vulde
--  in werkelijkheid de TWEEDE handtekening -- de eerste goedkeuring mocht
--  iedereen doen die over kosten beslist. Dat is precies de verwarring die uit
--  de vraag spreekt, en hij is terecht.
--
--  Wat het wordt
--  -------------
--
--  Twee stappen, elk met een groep:
--
--    eerste_bij     wie de eerste goedkeuring mag doen. Leeg = zoals het was:
--                   iedereen die over kosten mag beslissen.
--    goedkeurders   wie de tweede handtekening mag zetten. Leeg = iedereen
--                   die over kosten mag beslissen, zoals vóór 0096.
--
--  Allebei per bv in te stellen, en allebei een lijst. Eén van de groep is
--  genoeg -- het is "ligt bij ons", niet "iedereen moet tekenen". Vier ogen
--  blijft vier ogen: wie de eerste zette mag de tweede niet zetten, ook niet
--  als hij in allebei de groepen staat.
--
--  De oude kolommen blijven staan, als spiegel
--  -------------------------------------------
--
--  expenses.goedkeurder en inkoop_adres.goedkeurder verdwijnen niet. Ze
--  worden bijgehouden als eerste naam uit de lijst, en ze staan in
--  kolom_van_de_server (0105) zodat de app ze niet meer kan schrijven.
--
--  Dat is met opzet geen tweede waarheid maar een afgeleide: de app op de
--  tablets draait nog 1.91.0 en stuurt die kolom mee bij elke wijziging.
--  Zou ik hem weghalen, dan weigert PostgREST de hele rij en blijft het werk
--  van iedereen in de wachtrij staan tot het laatste toestel is bijgewerkt.
--  Weg mag hij zodra alles op 1.92 of hoger draait -- te zien bij
--  Ontwikkeling > Systeem.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. De factuur: twee groepen in plaats van één naam
-- ---------------------------------------------------------------------------

alter table public.expenses
  add column if not exists eerste_bij       text[] not null default '{}';
alter table public.expenses
  add column if not exists eerste_bij_naam  text[] not null default '{}';
alter table public.expenses
  add column if not exists goedkeurders     text[] not null default '{}';
alter table public.expenses
  add column if not exists goedkeurders_naam text[] not null default '{}';

comment on column public.expenses.eerste_bij is
  'Wie de eerste goedkeuring mag doen (0108). Leeg = iedereen die over kosten '
  'mag beslissen, zoals het vóór deze migratie ging.';

comment on column public.expenses.goedkeurders is
  'Wie de tweede handtekening mag zetten (0108, was goedkeurder). Eén van de '
  'groep is genoeg; vier ogen blijft gelden, dus de eerste tekenaar valt af.';

/* Wat er stond, overzetten. Eén naam is een lijst van één. */
update public.expenses
   set goedkeurders      = array[goedkeurder],
       goedkeurders_naam = array[coalesce(goedkeurder_naam, '')]
 where goedkeurder is not null
   and coalesce(array_length(goedkeurders, 1), 0) = 0;

create index if not exists expenses_goedkeurders_idx
  on public.expenses using gin (goedkeurders);
create index if not exists expenses_eerste_bij_idx
  on public.expenses using gin (eerste_bij);

-- ---------------------------------------------------------------------------
--  2. Het inkoopadres: ook een groep
--
--  Een postvak kan door twee mensen gelezen worden. Dat was al zo in de
--  praktijk; alleen kon je het niet opschrijven.
-- ---------------------------------------------------------------------------

alter table public.inkoop_adres
  add column if not exists goedkeurders text[] not null default '{}';

update public.inkoop_adres
   set goedkeurders = array[goedkeurder]
 where goedkeurder is not null
   and coalesce(array_length(goedkeurders, 1), 0) = 0;

comment on column public.inkoop_adres.goedkeurders is
  'Wie de facturen van dit postvak aftekent (0108, was goedkeurder). Leeg = '
  'dan beslist de route van de bv.';

-- ---------------------------------------------------------------------------
--  3. De route per bv: twee groepen
--
--  bv_route.eerste was één naam en is één dag oud (0106). Hij wordt hier een
--  lijst, en er komt een tweede groep naast -- want dat was de vraag.
--
--  De verwijzing naar profiles gaat eraf: een array kan die niet dragen. Wat
--  hij bewaakte -- geen namen van mensen die niet bestaan -- doen de functies
--  hieronder zelf, en strenger: ze kijken ook of iemand nog actief is.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'bv_route'
       and column_name = 'eerste' and data_type <> 'ARRAY')
  then
    alter table public.bv_route drop constraint if exists bv_route_eerste_fkey;
    alter table public.bv_route
      alter column eerste drop default,
      alter column eerste type text[]
        using case when eerste is null then '{}'::text[] else array[eerste] end,
      alter column eerste set default '{}'::text[];
    update public.bv_route set eerste = '{}' where eerste is null;
    alter table public.bv_route alter column eerste set not null;
  end if;
end $$;

alter table public.bv_route
  add column if not exists tweede text[] not null default '{}';

comment on column public.bv_route.eerste is
  'Wie in deze bv de eerste goedkeuring doet (0108). Leeg = iedereen die over '
  'kosten mag beslissen.';

comment on column public.bv_route.tweede is
  'Wie in deze bv de tweede handtekening zet als we de leverancier niet '
  'kennen (0108). Leeg = iedereen die over kosten mag beslissen.';

-- ---------------------------------------------------------------------------
--  4. De spiegel, voor de toestellen die nog 1.91 draaien
-- ---------------------------------------------------------------------------

create or replace function public.eerste_naam_spiegelen()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'expenses' then
    new.goedkeurder      := new.goedkeurders[1];
    new.goedkeurder_naam := new.goedkeurders_naam[1];
  else
    new.goedkeurder := new.goedkeurders[1];
  end if;
  return new;
end $$;

revoke execute on function public.eerste_naam_spiegelen() from public, anon, authenticated;

/*
 * De naam bepaalt de volgorde. BEFORE-triggers lopen op alfabet, en deze moet
 * ná expenses_blijft_van_de_server -- die zet goedkeurder terug op wat er
 * stond, en pas daarna mag de spiegel hem gelijktrekken aan de lijst.
 * "spiegel" komt na "blijft", "btw", "exact_fout" en "route"; dat klopt.
 */
drop trigger if exists expenses_spiegel_goedkeurder on public.expenses;
create trigger expenses_spiegel_goedkeurder
  before insert or update on public.expenses
  for each row execute function public.eerste_naam_spiegelen();

drop trigger if exists inkoop_adres_spiegel_goedkeurder on public.inkoop_adres;
create trigger inkoop_adres_spiegel_goedkeurder
  before insert or update on public.inkoop_adres
  for each row execute function public.eerste_naam_spiegelen();

/* En de app mag ze niet meer schrijven: ze zijn afgeleid. */
insert into public.kolom_van_de_server (tabel, kolom, waarom) values
  ('expenses', 'goedkeurder',
   'afgeleid van goedkeurders[1]; alleen nog er voor toestellen op 1.91'),
  ('expenses', 'goedkeurder_naam',
   'afgeleid van goedkeurders_naam[1]')
on conflict (tabel, kolom) do update set waarom = excluded.waarom;

/* Eén keer gelijktrekken voor wat er al staat. */
update public.expenses set updated_at = updated_at
 where goedkeurder is distinct from goedkeurders[1];
update public.inkoop_adres set updated_at = updated_at
 where goedkeurder is distinct from goedkeurders[1];

-- ---------------------------------------------------------------------------
--  5. Wie mag wat
--
--  Twee vragen die op elkaar lijken en het niet zijn. Allebei met dezelfde
--  drie uitwegen: staat er niemand, dan mag iedereen die over kosten
--  beslist; het management mag altijd; en de serverfuncties vallen erbuiten.
-- ---------------------------------------------------------------------------

create or replace function public.mag_eerste_beoordeling(expense_in text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not public.mag_kosten_beslissen() then false
    else coalesce(
      (select coalesce(array_length(e.eerste_bij, 1), 0) = 0
              or public.my_id() = any(e.eerste_bij)
              or public.is_management()
         from public.expenses e where e.id = expense_in),
      true)
  end;
$$;

revoke execute on function public.mag_eerste_beoordeling(text) from public, anon;
grant  execute on function public.mag_eerste_beoordeling(text) to authenticated, service_role;

comment on function public.mag_eerste_beoordeling(text) is
  'Mag ik de eerste goedkeuring op DEZE factuur doen (0108)? Iemand uit de '
  'groep of het management; staat er niemand, dan iedereen die over kosten '
  'mag beslissen.';

create or replace function public.mag_tweede_handtekening(expense_in text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not public.mag_kosten_beslissen() then false
    else coalesce(
      (select coalesce(array_length(e.goedkeurders, 1), 0) = 0
              or public.my_id() = any(e.goedkeurders)
              or public.is_management()
         from public.expenses e where e.id = expense_in),
      true)
  end;
$$;

revoke execute on function public.mag_tweede_handtekening(text) from public, anon;
grant  execute on function public.mag_tweede_handtekening(text) to authenticated, service_role;

comment on function public.mag_tweede_handtekening(text) is
  'Mag ik de tweede handtekening onder DEZE factuur zetten (0095/0096, een '
  'groep sinds 0108)? Iemand uit de groep of het management; ligt hij bij '
  'niemand, dan iedereen die over kosten mag beslissen.';

-- ---------------------------------------------------------------------------
--  6. En de rem bij het tekenen kijkt naar de groep
-- ---------------------------------------------------------------------------

create or replace function public.expenses_vier_ogen()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  /* --- de eerste stap ligt bij een groep --- */
  if new.status = 'eerste_akkoord'
     and coalesce(old.status, 'open') = 'open'
     and public.my_id() is not null
     and coalesce(array_length(new.eerste_bij, 1), 0) > 0
     and not (public.my_id() = any(new.eerste_bij))
     and not public.is_management()
  then
    raise exception 'Deze factuur ligt bij % voor de eerste beoordeling.',
      coalesce(array_to_string(nullif(new.eerste_bij_naam, '{}'), ', '), 'iemand anders')
      using errcode = 'check_violation';
  end if;

  if new.status <> 'goedgekeurd' then
    return new;
  end if;
  if coalesce(old.status, 'open') = 'goedgekeurd' then
    return new;  -- was al goed; hier verandert iets anders
  end if;
  if not public.vier_ogen_nodig(new.amount_excl) then
    return new;
  end if;

  if coalesce(old.status, 'open') = 'open' then
    raise exception 'Deze factuur moet eerst door iemand anders worden nagekeken '
                    '(vier ogen staat aan).'
      using errcode = 'check_violation';
  end if;

  if new.eerste_door is not null
     and new.approved_by is not null
     and new.eerste_door = new.approved_by then
    raise exception 'De tweede handtekening moet van iemand anders komen dan de eerste.'
      using errcode = 'check_violation';
  end if;

  /*
   * En hij ligt bij een groep (0096, een groep sinds 0108).
   *
   * my_id() is leeg bij de serverfuncties -- die werken met de servicesleutel
   * en vallen hier buiten, net als overal.
   */
  if public.my_id() is not null
     and coalesce(array_length(new.goedkeurders, 1), 0) > 0
     and not (public.my_id() = any(new.goedkeurders))
     and not public.is_management()
  then
    raise exception 'Deze factuur ligt bij % voor de tweede handtekening.',
      coalesce(array_to_string(nullif(new.goedkeurders_naam, '{}'), ', '), 'iemand anders')
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
--  7. De taak komt bij iedereen uit de groep op de lijst
--
--  Eén taak per persoon, met een eigen sleutel. Dat is niet netter dan één
--  taak met een groep eraan -- het is de enige manier die werkt met wat er
--  is: een taak hangt aan één naam of aan één rol, en "deze drie mensen" is
--  geen van beide.
--
--  Tekent er een, dan gaan ze alle drie van de lijst. Werk dat gedaan is,
--  hoort bij niemand meer te staan.
-- ---------------------------------------------------------------------------

create or replace function public.expense_tweede_handtekening_taak()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  bedrag  text := trim(to_char(coalesce(new.amount_excl, 0), 'FM999999990.00'));
  titel   text;
  uitleg  text;
  spoed   text;
  i       integer;
begin
  titel := 'Tweede handtekening: ' || coalesce(nullif(new.supplier, ''), 'factuur')
           || ' — € ' || bedrag;

  uitleg := coalesce(nullif(new.factuurnummer, ''), 'zonder factuurnummer')
            || coalesce(', ' || nullif(new.administratie, ''), '')
            || E'\n'
            || case
                 when new.goedkeuring_bron = 'automatisch'
                   /* Zeggen dat de eerste vanzelf ging. Anders lijkt het alsof
                      er al iemand naar gekeken heeft, en dan is de tweede
                      handtekening een formaliteit in plaats van de enige. */
                   then 'De eerste goedkeuring ging automatisch omdat deze leverancier '
                        || 'eerder voor ongeveer hetzelfde bedrag is goedgekeurd. Jij bent '
                        || 'dus de eerste die ernaar kijkt.'
                 else 'Eerste akkoord door '
                      || coalesce(nullif(new.eerste_door_naam, ''), 'een collega') || '.'
               end;

  /* Een factuur die vervalt is dringender dan een die net binnen is. Geen
     datum: dan normaal, want dringend zonder reden leest niemand meer. */
  spoed := case
             when new.vervaldatum is not null
                  and new.vervaldatum < public.now_ms() + (7::bigint * 24 * 60 * 60 * 1000)
               then 'hoog'
             else 'normaal'
           end;

  /* --- er komt werk bij, of de groep verandert terwijl het er ligt --- */
  if new.status = 'eerste_akkoord'
     and (coalesce(old.status, '') <> 'eerste_akkoord'
          or new.goedkeurders is distinct from old.goedkeurders)
  then
    /* Wie er niet meer bij hoort, gaat van de lijst. Een taak laten staan bij
       iemand die er niets meer mee te maken heeft, is erger dan geen taak. */
    delete from public.taak t
     where t.bron = 'factuur' and t.bron_id = new.id
       and t.id like 'taak_bon2\_%'
       and t.status <> 'klaar'
       and (t.toegewezen_aan is null
            or not (t.toegewezen_aan = any(new.goedkeurders)));

    if coalesce(array_length(new.goedkeurders, 1), 0) = 0 then
      /* Bij niemand: dan naar de rol, zoals het ging. Werk dat bij een groep
         ligt, ligt bij niemand -- maar ergens staan is beter dan nergens. */
      insert into public.taak (
        id, titel, omschrijving, status, prioriteit,
        location_id, toegewezen_aan, toegewezen_naam, toegewezen_rol,
        bron, bron_id, door_naam
      ) values (
        'taak_bon2_' || new.id, titel, uitleg, 'te_doen', spoed,
        new.location_id, null, null, 'administratie',
        'factuur', new.id, 'De factuurstroom'
      )
      on conflict do nothing;
    else
      for i in 1 .. array_length(new.goedkeurders, 1) loop
        insert into public.taak (
          id, titel, omschrijving, status, prioriteit,
          location_id, toegewezen_aan, toegewezen_naam, toegewezen_rol,
          bron, bron_id, door_naam
        ) values (
          'taak_bon2_' || new.id || '_' || new.goedkeurders[i],
          titel, uitleg, 'te_doen', spoed,
          new.location_id, new.goedkeurders[i], new.goedkeurders_naam[i], null,
          'factuur', new.id, 'De factuurstroom'
        )
        on conflict do nothing;
      end loop;
    end if;

    return new;
  end if;

  /* --- of het is gebeurd --- */
  if coalesce(old.status, '') = 'eerste_akkoord'
     and new.status in ('goedgekeurd', 'afgekeurd', 'open')
  then
    update public.taak
       set status = 'klaar',
           klaar_door = coalesce(new.approved_by, public.my_id()),
           klaar_door_naam = new.approved_by_name,
           updated_at = public.now_ms()
     where bron = 'factuur' and bron_id = new.id
       and id like 'taak_bon2\_%'
       and status <> 'klaar';
  end if;

  return new;
end $$;

comment on function public.expense_tweede_handtekening_taak() is
  'Zet een factuur die op de tweede handtekening wacht op de takenlijst van '
  'iedereen uit de groep (0096, een groep sinds 0108), en haalt hem er bij '
  'allemaal weer af zodra er een tekent.';

-- ---------------------------------------------------------------------------
--  8. De lijst: wat ligt er bij mij
-- ---------------------------------------------------------------------------

drop function if exists public.facturen_op_handtekening(text);

create or replace function public.facturen_op_handtekening(wie text default null)
returns table (
  id              text,
  leverancier     text,
  factuurnummer   text,
  factuurdatum    bigint,
  vervaldatum     bigint,
  administratie   text,
  bedrag_excl     numeric,
  bedrag_incl     numeric,
  ligt_bij        text[],
  ligt_bij_naam   text[],
  eerste_door_naam text,
  automatisch     boolean,
  dagen           integer,
  route_bron      text
)
language sql stable security definer set search_path = public as $$
  select e.id,
         coalesce(e.supplier, ''),
         e.factuurnummer,
         e.expense_date,
         e.vervaldatum,
         public.bon_administratie(e.id),
         e.amount_excl,
         round(coalesce(e.amount_excl, 0) * (1 + coalesce(e.vat_pct, 0) / 100.0), 2),
         e.goedkeurders,
         e.goedkeurders_naam,
         e.eerste_door_naam,
         coalesce(e.goedkeuring_bron, '') = 'automatisch',
         greatest(0, ((public.now_ms() - coalesce(e.eerste_at, e.expense_date))
                      / (24 * 60 * 60 * 1000))::integer),
         e.route_bron
    from public.expenses e
   where e.status = 'eerste_akkoord'
     and (wie is null
          or wie = any(e.goedkeurders)
          or coalesce(array_length(e.goedkeurders, 1), 0) = 0)
   order by coalesce(e.vervaldatum, e.expense_date);
$$;

revoke execute on function public.facturen_op_handtekening(text) from public, anon;
grant  execute on function public.facturen_op_handtekening(text) to authenticated, service_role;

comment on function public.facturen_op_handtekening(text) is
  'Wat er op de tweede handtekening wacht, met bij wie het ligt, waarom het '
  'daar ligt en hoeveel dagen het er staat (0096, een groep sinds 0108).';

-- ---------------------------------------------------------------------------
--  9. Het inkoopadres geeft een groep terug
-- ---------------------------------------------------------------------------

drop function if exists public.inkoop_adres_van(text);

create or replace function public.inkoop_adres_van(adres_in text)
returns table (
  id text, adres text, administratie text, location_id text, goedkeurders text[]
)
language sql stable security definer set search_path = public as $$
  with schoon as (
    select lower(trim(coalesce(adres_in, ''))) as vol
  ),
  zonder_plus as (
    select case
             when position('+' in split_part(s.vol, '@', 1)) > 0
               then split_part(split_part(s.vol, '@', 1), '+', 1) || '@' || split_part(s.vol, '@', 2)
             else s.vol
           end as vol
      from schoon s
  )
  select a.id, a.adres, a.administratie, a.location_id, a.goedkeurders
    from public.inkoop_adres a, zonder_plus z
   where a.actief
     and lower(a.adres) = z.vol
   limit 1;
$$;

revoke execute on function public.inkoop_adres_van(text) from public, anon;
grant  execute on function public.inkoop_adres_van(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  10. De routering vult nu twee groepen
--
--  0106 gaf één naam terug en zette die op goedkeurder -- de tweede
--  handtekening. De eerste stap had helemaal geen route: die mocht iedereen
--  doen die over kosten beslist. Dat is precies wat er ontbrak, en wat uit
--  de vraag sprak.
--
--  Nu twee antwoorden uit één vraag:
--
--    eerste    de groep van de bv. Geen geheugen en geen adres: wie de
--              EERSTE beoordeling doet hangt niet aan de leverancier maar
--              aan de organisatie.
--    tweede    adres, dan geheugen, dan de groep van de bv. Die volgorde is
--              ongewijzigd; alleen is het einde nu een groep.
-- ---------------------------------------------------------------------------

drop function if exists public.factuur_route(text, text, text);
drop function if exists public.factuur_route(text, text, text[]);

create or replace function public.factuur_route(
  administratie_in text,
  leverancier_in   text,
  adres_wie_in     text[] default null
)
returns table (
  eerste       text[],
  eerste_naam  text[],
  tweede       text[],
  tweede_naam  text[],
  bron         text
)
language plpgsql stable security definer set search_path = public as $$
declare
  sleutel text := lower(trim(coalesce(leverancier_in, '')));
  bv      record;
begin
  select * into bv from public.bv_route b where b.id = administratie_in;

  /* --- de eerste stap: de groep van deze bv --- */

  eerste := '{}'; eerste_naam := '{}';
  if bv.eerste is not null then
    select coalesce(array_agg(p.id order by p.name), '{}'),
           coalesce(array_agg(p.name order by p.name), '{}')
      into eerste, eerste_naam
      from public.profiles p
     where p.id = any(bv.eerste) and p.active;
  end if;

  /* --- de tweede stap: adres, dan geheugen, dan de groep van de bv --- */

  /* 1. het adres: een mens heeft dat postvak aan iemand gegeven */
  if coalesce(array_length(adres_wie_in, 1), 0) > 0 then
    select coalesce(array_agg(p.id order by p.name), '{}'),
           coalesce(array_agg(p.name order by p.name), '{}')
      into tweede, tweede_naam
      from public.profiles p
     where p.id = any(adres_wie_in) and p.active;

    if coalesce(array_length(tweede, 1), 0) > 0 then
      bron := 'adres';
      return next; return;
    end if;
  end if;

  /* 2. het geheugen: deze leverancier ging hier al vaker heen.
        Eén naam, want dit is wie er eerder tekende -- geen groep. */
  if sleutel <> '' and coalesce(bv.ai_direct, true) then
    select array[lr.goedkeurder], array[p.name] into tweede, tweede_naam
      from public.leverancier_route lr
      join public.profiles p on p.id = lr.goedkeurder
     where lr.administratie = administratie_in
       and lr.leverancier = sleutel
       and lr.keren >= coalesce(bv.vanaf_keren, 3)
       and p.active;
    if found then
      bron := 'geheugen';
      return next; return;
    end if;
  end if;

  /* 3. de tweede groep van deze bv */
  if bv.tweede is not null then
    select coalesce(array_agg(p.id order by p.name), '{}'),
           coalesce(array_agg(p.name order by p.name), '{}')
      into tweede, tweede_naam
      from public.profiles p
     where p.id = any(bv.tweede) and p.active;

    if coalesce(array_length(tweede, 1), 0) > 0 then
      bron := 'eerste';
      return next; return;
    end if;
  end if;

  /* 4. niemand: dan de stapel, zoals het was */
  tweede := '{}'; tweede_naam := '{}'; bron := null;
  return next;
end $$;

revoke execute on function public.factuur_route(text, text, text[]) from public, anon;
grant  execute on function public.factuur_route(text, text, text[]) to authenticated, service_role;

comment on function public.factuur_route(text, text, text[]) is
  'Bij welke groepen deze factuur hoort te liggen, en waarom (0106, twee '
  'stappen sinds 0110). Verandert niets; het scherm gebruikt hem ook om te '
  'laten zien wat er zou gebeuren.';

-- ---------------------------------------------------------------------------
--  11. En ze op de bon zetten
-- ---------------------------------------------------------------------------

drop function if exists public.factuur_route_zetten(text);

create or replace function public.factuur_route_zetten(expense_in text)
returns table (eerste text[], tweede text[], tweede_naam text[], bron text)
language plpgsql security definer set search_path = public as $$
declare
  e record;
  r record;
begin
  select id, supplier, goedkeurders, goedkeurders_naam, eerste_bij,
         route_bron, inkoop_adres_id, status
    into e from public.expenses where id = expense_in;
  if not found then return; end if;

  /* Een keuze van een mens blijft staan. */
  if e.route_bron = 'handmatig' then
    eerste := e.eerste_bij; tweede := e.goedkeurders;
    tweede_naam := e.goedkeurders_naam; bron := 'handmatig';
    return next; return;
  end if;

  /*
   * En een factuur die al getekend is ook. Verplaatsen wat al door de tweede
   * handtekening heen is, zou de historie laten liegen over waar hij lag.
   */
  if e.status in ('goedgekeurd', 'afgekeurd') then
    eerste := e.eerste_bij; tweede := e.goedkeurders;
    tweede_naam := e.goedkeurders_naam; bron := e.route_bron;
    return next; return;
  end if;

  select * into r from public.factuur_route(
    public.bon_administratie(e.id),
    e.supplier,
    (select ia.goedkeurders from public.inkoop_adres ia where ia.id = e.inkoop_adres_id)
  );

  update public.expenses
     set eerste_bij        = r.eerste,
         eerste_bij_naam   = r.eerste_naam,
         goedkeurders      = r.tweede,
         goedkeurders_naam = r.tweede_naam,
         route_bron        = r.bron
   where id = e.id;

  eerste := r.eerste; tweede := r.tweede;
  tweede_naam := r.tweede_naam; bron := r.bron;
  return next;
end $$;

revoke execute on function public.factuur_route_zetten(text) from public, anon;
grant  execute on function public.factuur_route_zetten(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  12. Een keuze van een mens blijft een keuze
--
--  Dezelfde regel als in 0106, nu op de groepen.
-- ---------------------------------------------------------------------------

create or replace function public.route_handmatig()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  /* De server routeert zelf en zet de bron er dan bij; dit gaat over wat
     iemand in het scherm doet. */
  if public.my_id() is null then return new; end if;

  if (new.goedkeurders is distinct from old.goedkeurders
      or new.eerste_bij is distinct from old.eerste_bij)
     and new.route_bron is not distinct from old.route_bron then
    new.route_bron := 'handmatig';
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
--  13. Het overzicht voor het scherm: twee groepen per bv
-- ---------------------------------------------------------------------------

drop function if exists public.bv_routes();

create or replace function public.bv_routes()
returns table (
  administratie text,
  bv_naam       text,
  eerste        text[],
  eerste_naam   text[],
  tweede        text[],
  tweede_naam   text[],
  ai_direct     boolean,
  vanaf_keren   integer,
  onthouden     integer,
  wachtend      integer
)
language sql stable security definer set search_path = public as $$
  select a.code,
         a.naam,
         coalesce(r.eerste, '{}'),
         coalesce((select array_agg(p.name order by p.name) from public.profiles p
                    where p.id = any(coalesce(r.eerste, '{}'::text[]))), '{}'),
         coalesce(r.tweede, '{}'),
         coalesce((select array_agg(p.name order by p.name) from public.profiles p
                    where p.id = any(coalesce(r.tweede, '{}'::text[]))), '{}'),
         coalesce(r.ai_direct, true),
         coalesce(r.vanaf_keren, 3),
         (select count(*)::integer from public.leverancier_route lr
           where lr.administratie = a.code),
         (select count(*)::integer from public.expenses e
           where e.status = 'eerste_akkoord'
             and public.bon_administratie(e.id) = a.code)
    from public.exact_administratie a
    left join public.bv_route r on r.id = a.code
   where a.actief
     and public.is_staff()
   order by a.hoofd desc nulls last, a.naam;
$$;

revoke execute on function public.bv_routes() from public, anon;
grant  execute on function public.bv_routes() to authenticated, service_role;
