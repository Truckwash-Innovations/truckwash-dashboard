-- ===========================================================================
--  Een factuur weet bij wie hij hoort
--
--  Casper, met een schermafdruk van de suggestieroutes in Blue10: "Je moet dus
--  ai laten kijken, en evt direct laten daarzetten naar degene die akkoord
--  moet geven. Maar als AI hem nog niet kent ect, moet je hem onder de eerste
--  persoon zetten, degene met managment kan het override, maar krijgt hem niet
--  in zijn todo. Zorg dat je dit per bv kan instellen."
--
--  Wat er stond
--  ------------
--
--  Eén regel: de goedkeurder van het inkoopadres waarop de factuur binnenkwam
--  (0095). Staat daar niemand -- en dat is bij vrijwel elk adres zo, want die
--  namen zijn nooit ingevuld -- dan ligt de factuur bij niemand en gaat de
--  taak naar de rol administratie. Dat is een stapel, geen route.
--
--  Wat het wordt
--  -------------
--
--  Drie lagen, van sterk naar zwak, en elke factuur draagt welke het was:
--
--    adres       een mens heeft dit postvak aan iemand toegewezen. Dat is een
--                keuze, en die wint van alles wat wij afleiden.
--    geheugen    deze leverancier is in deze bv eerder door dezelfde persoon
--                getekend, vaak genoeg om het geen toeval te noemen. Dit is
--                het "AI kent hem" uit de vraag: hij mag er direct heen.
--    eerste      we kennen hem niet. Dan gaat hij naar de eerste persoon van
--                die bv -- iemand, met een naam, in plaats van een stapel.
--
--  Het geheugen leert van wat er echt gebeurt: wie de tweede handtekening
--  zet, wordt onthouden bij die leverancier in die bv.
--
--  Waarom niet van een automatische goedkeuring
--  --------------------------------------------
--
--  Dezelfde reden als bij het boeken (lib/boeking.ts): een geheugen dat leert
--  van zijn eigen gokken bevestigt voortaan zijn eigen vergissingen, en dan
--  is het geen geheugen meer maar een echo. Alleen een handtekening van een
--  mens telt.
--
--  En het management
--  -----------------
--
--  Dat mag altijd overschrijven -- de rem in expenses_vier_ogen() laat
--  is_management() er al door. Wat erbij komt is dat zo'n keuze blijft staan:
--  hij krijgt bron 'handmatig', en daar blijft de routering vanaf. Zonder dat
--  zou de eerstvolgende ronde de keuze van een mens overschrijven met een gok.
--
--  Wat het management NIET krijgt is de taak. Die volgt de goedkeurder, en
--  een rol-taak gaat naar de rol administratie -- niet naar management. Dat
--  was al zo (isVanMij in lib/werk.ts kijkt naar rollen, niet naar rechten);
--  hier wordt het alleen niet stukgemaakt.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Per bv: wie krijgt een factuur die we niet kennen
-- ---------------------------------------------------------------------------

create table if not exists public.bv_route (
  /*
   * De sleutel heet id en niet administratie, en dat is geen smaakkwestie.
   *
   * rij_bestaat() -- de uitweg uit de upsert-val hieronder -- zoekt hard op
   * "where id = $1". Een tabel met een andere sleutelnaam levert daar
   * stilletjes niets op, en dan zit die uitweg altijd dicht. Zelfde afspraak
   * als in 0044 en 0087; de sqltest bewaakt hem.
   *
   * De waarde is de administratiecode van Exact.
   */
  id            text primary key,
  /* Wie een onbekende factuur krijgt. Leeg = zoals het was: de rol
     administratie, en dan ligt hij bij iedereen en dus bij niemand. */
  eerste        text references public.profiles(id) on delete set null,
  /* Mag het geheugen een factuur direct bij de vorige tekenaar leggen? */
  ai_direct     boolean not null default true,
  /*
   * Vanaf hoeveel keer het geheugen meetelt.
   *
   * Eén keer is een aanwijzing, drie keer is een gewoonte. Hetzelfde getal
   * dat het automatisch goedkeuren gebruikt (0075), en om dezelfde reden:
   * een route op één waarneming is raden met een naam eronder.
   */
  vanaf_keren   integer not null default 3 check (vanaf_keren >= 1),
  updated_at    bigint not null default public.now_ms()
);

comment on table public.bv_route is
  'Per bv: wie een onbekende inkoopfactuur krijgt, en of het geheugen hem '
  'direct bij de vorige tekenaar mag leggen (0106).';

alter table public.bv_route enable row level security;

drop policy if exists bv_route_select on public.bv_route;
create policy bv_route_select on public.bv_route
  for select to authenticated using (public.is_staff());

drop policy if exists bv_route_insert on public.bv_route;
create policy bv_route_insert on public.bv_route
  for insert to authenticated
  /* rij_bestaat() is de uitweg uit de upsert-val (0033): een upsert op een
     rij die al bestaat wordt door PostgREST als INSERT aangeboden, en zonder
     deze regel weigert de insert-policy een gewone wijziging met "new row
     violates row-level security policy". */
  with check (public.rij_bestaat('public.bv_route'::regclass, id)
              or public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists bv_route_update on public.bv_route;
create policy bv_route_update on public.bv_route
  for update to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'))
  with check (public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists bv_route_delete on public.bv_route;
create policy bv_route_delete on public.bv_route
  for delete to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'));

-- ---------------------------------------------------------------------------
--  2. Het geheugen: wie tekent de facturen van deze leverancier
-- ---------------------------------------------------------------------------

create table if not exists public.leverancier_route (
  /* Per bv, want dezelfde leverancier kan in twee administraties bij twee
     verschillende mensen liggen. */
  administratie text not null,
  /* lower(trim(naam)), zoals in leverancier_boeking. */
  leverancier   text not null,
  goedkeurder   text not null references public.profiles(id) on delete cascade,
  keren         integer not null default 1,
  laatst_at     bigint not null default public.now_ms(),
  updated_at    bigint not null default public.now_ms(),
  primary key (administratie, leverancier)
);

comment on table public.leverancier_route is
  'Wie de facturen van deze leverancier in deze bv tekent (0106). Geleerd van '
  'echte handtekeningen, niet van automatische goedkeuringen.';

alter table public.leverancier_route enable row level security;

/* Lezen mag wie erbij hoort te kunnen; schrijven doet de trigger hieronder,
   en die is security definer. */
drop policy if exists leverancier_route_select on public.leverancier_route;
create policy leverancier_route_select on public.leverancier_route
  for select to authenticated using (public.is_staff());

/* Wissen mag de administratie wel: een route die niet meer klopt moet je
   kunnen vergeten zonder in de database te hoeven. */
drop policy if exists leverancier_route_delete on public.leverancier_route;
create policy leverancier_route_delete on public.leverancier_route
  for delete to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'));

-- ---------------------------------------------------------------------------
--  3. Waarom een factuur ligt waar hij ligt
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists route_bron text;

do $$
begin
  alter table public.expenses drop constraint if exists expenses_route_bron_check;
  alter table public.expenses add constraint expenses_route_bron_check
    check (route_bron is null
           or route_bron in ('adres', 'geheugen', 'eerste', 'handmatig'));
exception when others then
  raise notice 'route_bron-controle niet gezet: %', sqlerrm;
end $$;

comment on column public.expenses.route_bron is
  'Waarom deze factuur bij deze persoon ligt (0106): adres, geheugen, eerste '
  'of handmatig. Handmatig blijft staan -- de routering overschrijft nooit '
  'een keuze van een mens.';

-- ---------------------------------------------------------------------------
--  4. Bij wie hoort deze factuur?
--
--  Puur een vraag; hij verandert niets. Zo is hij ook te gebruiken om op het
--  scherm te laten zien wat er ZOU gebeuren.
-- ---------------------------------------------------------------------------

drop function if exists public.factuur_route(text, text, text);

create or replace function public.factuur_route(
  administratie_in text,
  leverancier_in   text,
  adres_wie_in     text default null
)
returns table (wie text, naam text, bron text)
language plpgsql stable security definer set search_path = public as $$
declare
  sleutel text := lower(trim(coalesce(leverancier_in, '')));
  r       record;
  bv      record;
begin
  /* --- 1. het adres: een mens heeft dit postvak aan iemand gegeven --- */
  if coalesce(trim(adres_wie_in), '') <> '' then
    select p.id, p.name into r from public.profiles p where p.id = adres_wie_in;
    if found then
      wie := r.id; naam := r.name; bron := 'adres';
      return next; return;
    end if;
  end if;

  select * into bv from public.bv_route b where b.id = administratie_in;

  /* --- 2. het geheugen: deze leverancier ging hier al vaker heen --- */
  if sleutel <> '' and coalesce(bv.ai_direct, true) then
    select lr.goedkeurder, p.name, lr.keren into r
      from public.leverancier_route lr
      join public.profiles p on p.id = lr.goedkeurder
     where lr.administratie = administratie_in
       and lr.leverancier = sleutel
       and lr.keren >= coalesce(bv.vanaf_keren, 3)
       and p.active;
    if found then
      wie := r.goedkeurder; naam := r.name; bron := 'geheugen';
      return next; return;
    end if;
  end if;

  /* --- 3. de eerste persoon van deze bv --- */
  if bv.eerste is not null then
    select p.id, p.name into r from public.profiles p
     where p.id = bv.eerste and p.active;
    if found then
      wie := r.id; naam := r.name; bron := 'eerste';
      return next; return;
    end if;
  end if;

  /* --- 4. niemand: dan de stapel, zoals het was --- */
  wie := null; naam := null; bron := null;
  return next;
end $$;

revoke execute on function public.factuur_route(text, text, text) from public, anon;
grant  execute on function public.factuur_route(text, text, text) to authenticated, service_role;

comment on function public.factuur_route(text, text, text) is
  'Bij wie deze factuur hoort te liggen, en waarom (0106). Verandert niets; '
  'het scherm gebruikt hem ook om te laten zien wat er zou gebeuren.';

-- ---------------------------------------------------------------------------
--  5. En hem erop zetten
--
--  Apart van de vraag, zodat het scherm kan kijken zonder iets te doen.
--
--  Wat er NIET gebeurt: een keuze van een mens overschrijven. Staat er
--  'handmatig', dan blijft het zoals het staat -- ook als het geheugen
--  inmiddels iets anders zou zeggen. Zonder die regel zou de eerstvolgende
--  ronde de beslissing van het management terugdraaien, en dat merkt niemand.
-- ---------------------------------------------------------------------------

drop function if exists public.factuur_route_zetten(text);

create or replace function public.factuur_route_zetten(expense_in text)
returns table (wie text, naam text, bron text)
language plpgsql security definer set search_path = public as $$
declare
  e   record;
  r   record;
begin
  select id, supplier, goedkeurder, route_bron, inkoop_adres_id, status
    into e from public.expenses where id = expense_in;
  if not found then return; end if;

  /* Een keuze van een mens blijft staan. */
  if e.route_bron = 'handmatig' then
    wie := e.goedkeurder;
    select p.name into naam from public.profiles p where p.id = e.goedkeurder;
    bron := 'handmatig';
    return next; return;
  end if;

  /*
   * En een factuur die al getekend is ook. Verplaatsen wat al door de tweede
   * handtekening heen is, zou de historie laten liegen over waar hij lag.
   */
  if e.status in ('goedgekeurd', 'afgekeurd') then
    wie := e.goedkeurder;
    select p.name into naam from public.profiles p where p.id = e.goedkeurder;
    bron := e.route_bron;
    return next; return;
  end if;

  select * into r from public.factuur_route(
    public.bon_administratie(e.id),
    e.supplier,
    (select ia.goedkeurder from public.inkoop_adres ia where ia.id = e.inkoop_adres_id)
  );

  update public.expenses
     set goedkeurder      = r.wie,
         goedkeurder_naam = r.naam,
         route_bron       = r.bron
   where id = e.id;

  wie := r.wie; naam := r.naam; bron := r.bron;
  return next;
end $$;

revoke execute on function public.factuur_route_zetten(text) from public, anon;
grant  execute on function public.factuur_route_zetten(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  6. Het geheugen leert van echte handtekeningen
-- ---------------------------------------------------------------------------

create or replace function public.route_onthouden()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sleutel text := lower(trim(coalesce(new.supplier, '')));
  bv      text;
begin
  /* Alleen op het moment dat hij goedgekeurd RAAKT. */
  if new.status <> 'goedgekeurd' or coalesce(old.status, '') = 'goedgekeurd' then
    return null;
  end if;

  /*
   * En alleen als een mens tekende. Een geheugen dat leert van zijn eigen
   * automatische goedkeuringen bevestigt voortaan zijn eigen vergissingen.
   */
  if coalesce(new.goedkeuring_bron, '') = 'automatisch' then return null; end if;
  if new.approved_by is null or sleutel = '' then return null; end if;

  bv := public.bon_administratie(new.id);
  if coalesce(bv, '') = '' then return null; end if;

  /*
   * En alleen als die persoon een dossier heeft.
   *
   * approved_by verwijst niet naar profiles -- dat is een tekstveld dat ook
   * gevuld kan zijn met iemand die er niet (meer) is. Zonder deze vraag
   * loopt het geheugen tegen zijn eigen verwijzing aan, en dan MISLUKT DE
   * GOEDKEURING. Een handtekening die stukloopt omdat er iets te onthouden
   * viel, is het omgekeerde van wat dit moet doen.
   */
  if not exists (select 1 from public.profiles p where p.id = new.approved_by) then
    return null;
  end if;

  insert into public.leverancier_route
    (administratie, leverancier, goedkeurder, keren, laatst_at, updated_at)
  values (bv, sleutel, new.approved_by, 1, public.now_ms(), public.now_ms())
  on conflict (administratie, leverancier) do update
    set keren = case
                  /* Dezelfde persoon: een keer erbij. Een ander: dan is de
                     gewoonte veranderd en begint het tellen opnieuw -- anders
                     blijft een vertrokken collega jaren de route bepalen. */
                  when public.leverancier_route.goedkeurder = excluded.goedkeurder
                    then public.leverancier_route.keren + 1
                  else 1
                end,
        goedkeurder = excluded.goedkeurder,
        laatst_at   = excluded.laatst_at,
        updated_at  = excluded.updated_at;

  return null;
exception when others then
  /*
   * Wat er ook misgaat aan het onthouden: de goedkeuring gaat door.
   *
   * Dit is een AFTER-trigger op de factuur zelf, dus een fout hier draait de
   * hele handtekening terug. Dat mag nooit -- het geheugen is een gemak, de
   * handtekening is het werk.
   */
  raise warning 'route onthouden mislukte voor %: %', new.id, sqlerrm;
  return null;
end $$;

revoke execute on function public.route_onthouden() from public, anon, authenticated;

drop trigger if exists expenses_route_onthouden on public.expenses;
create trigger expenses_route_onthouden
  after update on public.expenses
  for each row execute function public.route_onthouden();

-- ---------------------------------------------------------------------------
--  7. Een keuze van een mens is een keuze
--
--  Zet iemand de goedkeurder met de hand om -- en dat mag alleen het
--  management, of degene bij wie hij ligt -- dan is de bron vanaf dat moment
--  'handmatig'. Anders zou de volgende ronde het terugdraaien.
-- ---------------------------------------------------------------------------

create or replace function public.route_handmatig()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  /* De server routeert zelf en zet de bron er dan bij; dit gaat over wat
     iemand in het scherm doet. */
  if public.my_id() is null then return new; end if;

  if new.goedkeurder is distinct from old.goedkeurder
     and new.route_bron is not distinct from old.route_bron then
    new.route_bron := 'handmatig';
  end if;

  return new;
end $$;

revoke execute on function public.route_handmatig() from public, anon, authenticated;

/*
 * De naam bepaalt de volgorde: BEFORE UPDATE-triggers lopen op alfabet, en
 * deze moet ná expenses_blijft_van_de_server draaien -- die zet kolommen
 * terug, en daarna pas is te zien wat er werkelijk verandert. "route" komt
 * na "blijft", "btw" en "exact_fout"; dat klopt.
 */
drop trigger if exists expenses_route_handmatig on public.expenses;
create trigger expenses_route_handmatig
  before update on public.expenses
  for each row execute function public.route_handmatig();

-- ---------------------------------------------------------------------------
--  8. Wat er per bv staat, in één vraag
--
--  Voor het scherm: elke actieve bv, met de route die er staat en hoeveel het
--  geheugen er inmiddels van weet.
-- ---------------------------------------------------------------------------

/*
 * Alleen zolang bv_route.eerste nog één naam is.
 *
 * Dit is een SQL-functie, en die wordt bij het AANMAKEN al nagekeken -- niet
 * pas bij het uitvoeren, zoals plpgsql. Zodra 0110 van die kolom een lijst
 * maakt, is "p.id = r.eerste" een vergelijking van text met text[], en dan
 * valt deze migratie om bij een tweede ronde van bijwerken.sql.
 *
 * Een "drop function if exists" helpt hier niet: het probleem is niet het
 * teruggegeven type maar de inhoud. Dus wordt hij overgeslagen zodra 0110
 * er is geweest -- die maakt hem toch meteen daarna opnieuw, met twee
 * groepen.
 */
do $bv$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'bv_route'
       and column_name = 'eerste' and data_type <> 'ARRAY')
  then
    execute $f$
      create or replace function public.bv_routes()
      returns table (
        administratie text,
        bv_naam       text,
        eerste        text,
        eerste_naam   text,
        ai_direct     boolean,
        vanaf_keren   integer,
        onthouden     integer,
        wachtend      integer
      )
      language sql stable security definer set search_path = public as $q$
        select a.code,
               a.naam,
               r.eerste,
               p.name,
               coalesce(r.ai_direct, true),
               coalesce(r.vanaf_keren, 3),
               (select count(*)::integer from public.leverancier_route lr
                 where lr.administratie = a.code),
               (select count(*)::integer from public.expenses e
                 where e.status = 'eerste_akkoord'
                   and public.bon_administratie(e.id) = a.code)
          from public.exact_administratie a
          left join public.bv_route r on r.id = a.code
          left join public.profiles  p on p.id = r.eerste
         where a.actief
           and public.is_staff()
         order by a.hoofd desc nulls last, a.naam;
      $q$;
    $f$;

    execute 'revoke execute on function public.bv_routes() from public, anon';
    execute 'grant  execute on function public.bv_routes() to authenticated, service_role';
  end if;
end $bv$;

-- ---------------------------------------------------------------------------
--  9. En de werklijst zegt erbij waarom
--
--  "Ligt bij Milos" is een feit zonder reden. Staat er niet bij waar dat
--  vandaan komt, dan is de enige manier om te zien of de routering doet wat
--  je hebt ingesteld: wachten tot het een keer misgaat.
--
--  drop eerst: het antwoord krijgt een kolom erbij, en create or replace kan
--  het teruggegeven type niet veranderen.
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
  ligt_bij        text,
  ligt_bij_naam   text,
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
         e.goedkeurder,
         e.goedkeurder_naam,
         e.eerste_door_naam,
         coalesce(e.goedkeuring_bron, '') = 'automatisch',
         /* Sinds hij op de tweede handtekening wacht, en anders sinds hij
            binnenkwam. In hele dagen; uren zeggen hier niets. */
         greatest(0, ((public.now_ms() - coalesce(e.eerste_at, e.expense_date))
                      / (24 * 60 * 60 * 1000))::integer),
         e.route_bron
    from public.expenses e
   where e.status = 'eerste_akkoord'
     and (wie is null or e.goedkeurder = wie or e.goedkeurder is null)
   order by coalesce(e.vervaldatum, e.expense_date);
$$;

revoke execute on function public.facturen_op_handtekening(text) from public, anon;
grant  execute on function public.facturen_op_handtekening(text) to authenticated, service_role;

comment on function public.facturen_op_handtekening(text) is
  'Wat er op de tweede handtekening wacht, met bij wie het ligt, waarom het '
  'daar ligt en hoeveel dagen het er staat (0096, uitgebreid in 0106).';

-- ---------------------------------------------------------------------------
--  10. En route_bron is van de server
--
--  De app schrijft een kostenpost terug als HELE rij. Staat daar een oude
--  route_bron in -- bijvoorbeeld 'eerste', terwijl het management hem
--  intussen met de hand ergens anders heeft gelegd -- dan zou die oude waarde
--  de 'handmatig' overschrijven. En dan pakt de eerstvolgende ronde de
--  factuur alsnog af van degene bij wie hij was neergelegd.
--
--  Dit is precies waar de lijst uit 0105 voor is: een kolom beschermen is
--  sindsdien een regel in een tabel, geen nieuwe trigger.
--
--  De goedkeurder zelf blijft WEL van de app: die mag een mens veranderen,
--  en dat is de override waar de vraag over ging. De volgorde van de
--  triggers maakt dat rond -- expenses_blijft_van_de_server zet route_bron
--  terug, en daarna ziet expenses_route_handmatig dat de goedkeurder is
--  gewijzigd en zet er 'handmatig' op.
-- ---------------------------------------------------------------------------

insert into public.kolom_van_de_server (tabel, kolom, waarom) values
  ('expenses', 'route_bron',
   'waarom een factuur ligt waar hij ligt; de app kent alleen wat hij het '
   'laatst zag, en zou een handmatige keuze terugdraaien')
on conflict (tabel, kolom) do update set waarom = excluded.waarom;

-- ---------------------------------------------------------------------------
--  11. En wat er nu al ligt
--
--  De routering pakt een factuur op het moment dat hij gelezen wordt. Wat er
--  vandaag al in de rij staat is toen niet geroute-erd -- dat ligt dus bij
--  niemand, en blijft daar liggen tot iemand het met de hand doet.
--
--  Dat zou betekenen dat je de instelling zet en er een week lang niets van
--  merkt. Vandaar deze: alles wat nog open staat opnieuw indelen.
--
--  Wat hij NIET aanraakt: een keuze van een mens ('handmatig') en alles wat
--  al getekend of afgekeurd is. Dat zijn dezelfde twee uitzonderingen als in
--  factuur_route_zetten() -- ze staan daar, zodat er één plek is waar die
--  regel leeft.
-- ---------------------------------------------------------------------------

create or replace function public.facturen_routeren()
returns table (bekeken integer, verplaatst integer, bij_niemand integer)
language plpgsql security definer set search_path = public as $$
declare
  e   record;
  r   record;
  n   integer := 0;
  v   integer := 0;
  z   integer := 0;
begin
  if not (public.is_management() or public.heeft_recht('admin.desk')) then
    raise exception 'Alleen de administratie kan de facturen opnieuw indelen.'
      using errcode = 'insufficient_privilege';
  end if;

  for e in
    select id, goedkeurder from public.expenses
     where status in ('open', 'eerste_akkoord')
       and coalesce(route_bron, '') <> 'handmatig'
     order by expense_date
  loop
    n := n + 1;
    select * into r from public.factuur_route_zetten(e.id);
    if r.wie is null then z := z + 1;
    elsif r.wie is distinct from e.goedkeurder then v := v + 1;
    end if;
  end loop;

  bekeken := n; verplaatst := v; bij_niemand := z;
  return next;
end $$;

revoke execute on function public.facturen_routeren() from public, anon;
grant  execute on function public.facturen_routeren() to authenticated, service_role;

comment on function public.facturen_routeren() is
  'Deelt alles wat nog open staat opnieuw in volgens de routes (0106). Laat '
  'een keuze van een mens en al getekende facturen met rust.';
