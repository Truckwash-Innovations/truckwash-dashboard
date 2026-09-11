-- ===========================================================================
--  De bon weet zelf in welke bv hij hoort
--
--  Casper: "zorg ervoor dat je ai ook laat zoeken onder welke onderneming
--  vanuit exact het geboekt moet worden".
--
--  Wat er nu gebeurt
--  -----------------
--
--  bon_administratie() (0059) leidt de bv af uit de VESTIGING van de bon, en
--  die vestiging komt uit het mailadres waarop de factuur binnenkwam
--  (inkoop.venlo@...). Dat klopt zolang iedereen naar het juiste adres mailt.
--
--  In de praktijk niet. De boekhouding in Exact telt ruim twintig bv's, en
--  lang niet allemaal zijn ze een vestiging: Truckwash 1 Group, Truckwash 1
--  Vastgoed, Truckwash 1 Techniek & Beheer, Truckshop 1, Truckstop 8. Een
--  huurfactuur voor Vastgoed komt binnen op het adres van de vestiging waar
--  het pand staat, en boekt dan op de verkeerde bv. Dat is geen schoonheids-
--  foutje: dan staat een post in de jaarrekening van de verkeerde
--  vennootschap.
--
--  Wat een factuur zelf al weet
--  ----------------------------
--
--  Op elke inkoopfactuur staat aan wie hij gericht is. Niet in de mail, maar
--  op het stuk: bij "aan", "factuuradres", "t.a.v.", met KvK-nummer erbij.
--  Dat is de enige plek waar het antwoord met zekerheid staat -- de
--  leverancier heeft het er zelf op gezet omdat hij van ons te horen kreeg
--  naar wie hij moest factureren.
--
--  Dus laat de lezer dat overnemen, en zoeken we het hier op.
--
--  Waarom dit nu WEL op de bon staat
--  ---------------------------------
--
--  0059 zegt met zoveel woorden het tegenovergestelde:
--
--      "het staat hier en niet op de bon zelf, want dan zijn er twee plekken
--       die het kunnen weten en een dag waarop ze iets anders zeggen"
--
--  Dat argument klopte en is achterhaald door een beter antwoord. Toen was de
--  vestiging de enige aanwijzing die er was, en dan is een tweede plek
--  inderdaad alleen maar een tweede kans om het fout te hebben. Nu is er een
--  aanwijzing die stérker is dan de vestiging -- wat de leverancier zelf op
--  het stuk heeft gezet -- en die hoort niet weggegooid te worden omdat er
--  ooit maar een bron was.
--
--  De zorg uit 0059 wordt opgelost door de bron erbij te zetten, net als bij
--  de grootboekindeling (indeling_bron, 0044):
--
--      gelezen     van het stuk, en zeker -- het KvK-nummer of de naam klopte
--      vermoeden   van het stuk, maar het leek er alleen op. Hier kijkt iemand
--                  naar voordat er getekend wordt
--      vestiging   afgeleid, zoals het altijd ging
--      handmatig   iemand heeft het gezet, en dat wint van alledrie
--
--  Zo is er geen dag waarop twee plekken iets anders zeggen: er is er een die
--  antwoord geeft, en je kunt zien waarop dat antwoord berust.
--
--  Waarom "vermoeden" een eigen bron is en geen gok die stil doorgaat
--  -----------------------------------------------------------------
--
--  De verleiding is om een bijna-match gewoon als antwoord te nemen -- hij
--  klopt meestal. Maar "meestal" betekent hier dat er af en toe een factuur
--  in de jaarrekening van de verkeerde vennootschap belandt, en dat is precies
--  het soort fout dat pas bij de accountant bovenkomt en dan niemand meer weet
--  te plaatsen. Een vermoeden hoort dus zichtbaar te zijn en niet te bezinken.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. De bv op de bon
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists administratie      text;
alter table public.expenses add column if not exists administratie_bron text;

/* Aan wie de factuur volgens het stuk gericht is, letterlijk zoals het er
   staat. Ook als er geen bv bij te vinden was -- juist dan: dan kan een mens
   zien waar de lezer naar heeft gekeken in plaats van te moeten raden. */
alter table public.expenses add column if not exists geadresseerde text;

do $$
begin
  alter table public.expenses drop constraint if exists expenses_administratie_bron_check;
  alter table public.expenses add constraint expenses_administratie_bron_check
    check (administratie_bron is null
           or administratie_bron in ('gelezen', 'vermoeden', 'vestiging', 'handmatig'));
exception when others then
  raise notice 'administratie_bron-controle niet gezet: %', sqlerrm;
end $$;

comment on column public.expenses.administratie is
  'In welke bv deze factuur geboekt wordt (0079). Leeg = afleiden uit de '
  'vestiging, zoals het voor 0079 ging.';

comment on column public.expenses.administratie_bron is
  'Waar die bv vandaan komt: gelezen (zeker, van het stuk), vermoeden (het '
  'leek erop -- iemand kijkt er nog naar), vestiging (afgeleid) of handmatig '
  '(een mens). Handmatig wint van alledrie.';

comment on column public.expenses.geadresseerde is
  'Aan wie de factuur volgens het stuk gericht is, letterlijk. Blijft staan '
  'ook als er geen bv bij gevonden is -- dan kan een mens zien waarnaar is '
  'gekeken.';

-- ---------------------------------------------------------------------------
--  2. Waar een bv aan te herkennen is
--
--  De naam alleen is dun. "Truckwash 1 Asten B.V." en "Truckwash 1 Aalsmeer
--  B.V." schelen een woord, en een onscherpe scan maakt daar zo hetzelfde
--  van. Een KvK- of btw-nummer is een harde match: acht cijfers die maar bij
--  een vennootschap horen.
--
--  Ze staan leeg en dat is eerlijk: Exact geeft ze niet mee bij system/Divisions.
--  Wie ze invult krijgt een zekere match; wie ze leeg laat houdt het bij de
--  naam. Geen van beide is stil.
-- ---------------------------------------------------------------------------

alter table public.exact_administratie add column if not exists kvk        text;
alter table public.exact_administratie add column if not exists btw_nummer text;

/*
 * En de genormaliseerde naam, zodat zoeken niet elke keer opnieuw hoeft te
 * rekenen. Dezelfde functie als bij de crediteuren (0058): hoofdletters,
 * leestekens en de rechtsvorm eraf, zodat "Truckwash 1 Hazeldonk b.v." en
 * "TRUCKWASH 1 HAZELDONK BV" op hetzelfde uitkomen.
 */
alter table public.exact_administratie add column if not exists zoeknaam text;

update public.exact_administratie
   set zoeknaam = public.kaal_bedrijf(naam)
 where zoeknaam is distinct from public.kaal_bedrijf(naam);

create or replace function public.exact_administratie_zoeknaam()
returns trigger language plpgsql as $$
begin
  new.zoeknaam := public.kaal_bedrijf(new.naam);
  return new;
end $$;

drop trigger if exists exact_administratie_zoeknaam_trg on public.exact_administratie;
create trigger exact_administratie_zoeknaam_trg
  before insert or update of naam on public.exact_administratie
  for each row execute function public.exact_administratie_zoeknaam();

create index if not exists exact_administratie_zoeknaam_idx
  on public.exact_administratie (zoeknaam);

-- ---------------------------------------------------------------------------
--  3. Welke bv is dit?
--
--  Geeft de code terug, plus waarop de match berust en hoe zeker die is. Dat
--  laatste is geen sier: een match op KvK-nummer is een feit, een match op
--  naam is een gelijkenis, en het scherm hoort dat verschil te kunnen tonen.
--
--  Beslist niets zelf. Wat er met het antwoord gebeurt is aan de aanroeper --
--  zelfde afspraak als factuur_indelen() (0044) en
--  mag_automatisch_goedkeuren() (0050).
-- ---------------------------------------------------------------------------

create or replace function public.administratie_zoeken(
  naam_in text,
  kvk_in  text default null,
  btw_in  text default null
)
returns table (code text, naam text, zeker boolean, waarom text)
language plpgsql stable security definer set search_path = public as $$
declare
  /*
   * Alleen de cijfers. Een KvK-nummer wordt geschreven als "12345678",
   * "KvK 12345678" en "1234 5678", en dat zijn drie teksten voor een getal.
   */
  kvk_kaal  text := nullif(regexp_replace(coalesce(kvk_in, ''), '[^0-9]', '', 'g'), '');
  btw_kaal  text := nullif(upper(regexp_replace(coalesce(btw_in, ''), '[^A-Za-z0-9]', '', 'g')), '');
  zoek      text := public.kaal_bedrijf(naam_in);
  gevonden  record;
  hoeveel   integer;
begin
  /* --- 1. het KvK-nummer: een feit --- */
  if kvk_kaal is not null then
    select a.code, a.naam into gevonden
      from public.exact_administratie a
     where a.actief
       and nullif(regexp_replace(coalesce(a.kvk, ''), '[^0-9]', '', 'g'), '') = kvk_kaal
     limit 1;
    if found then
      code := gevonden.code; naam := gevonden.naam; zeker := true;
      waarom := 'Het KvK-nummer op de factuur hoort bij deze bv.';
      return next; return;
    end if;
  end if;

  /* --- 2. het btw-nummer: ook een feit --- */
  if btw_kaal is not null then
    select a.code, a.naam into gevonden
      from public.exact_administratie a
     where a.actief
       and nullif(upper(regexp_replace(coalesce(a.btw_nummer, ''), '[^A-Za-z0-9]', '', 'g')), '') = btw_kaal
     limit 1;
    if found then
      code := gevonden.code; naam := gevonden.naam; zeker := true;
      waarom := 'Het btw-nummer op de factuur hoort bij deze bv.';
      return next; return;
    end if;
  end if;

  if zoek is null then
    return;
  end if;

  /* --- 3. de naam, en dan precies --- */
  select count(*) into hoeveel
    from public.exact_administratie a
   where a.actief and a.zoeknaam = zoek;

  if hoeveel = 1 then
    select a.code, a.naam into gevonden
      from public.exact_administratie a
     where a.actief and a.zoeknaam = zoek;
    code := gevonden.code; naam := gevonden.naam; zeker := true;
    waarom := 'De naam op de factuur is precies die van deze bv.';
    return next; return;
  end if;

  /*
   * Meer dan een met dezelfde naam. Dat komt voor: Truckwash 1 Group staat
   * in de lijst van Casper twee keer, een in euro en een in dollar. Dan is
   * kiezen raden, en raden is hier een boeking in de verkeerde vennootschap.
   */
  if hoeveel > 1 then
    waarom := format('Er zijn %s bv''s met deze naam; kies zelf welke.', hoeveel);
    code := null; naam := null; zeker := false;
    return next; return;
  end if;

  /*
   * --- 4. de bv-naam BEGINT met wat er op de factuur staat ---
   *
   * "Truckwash 1 Techniek" staat op het stuk, de bv heet "Truckwash 1 Techniek
   * & Beheer B.V.". Dat is een afkorting, en een aanwijzing waard.
   *
   * Eén richting, en dat is niet willekeurig. Hier stond eerst ook de andere
   * kant op -- "zoek zit ergens in de bv-naam, of de bv-naam zit ergens in
   * zoek" -- en die tweede helft is gevaarlijk. De testdatabase heeft een bv
   * die "Holding" heet, en daarmee gold:
   *
   *     'oude holding' like '%holding%'   ->  waar
   *
   * Een factuur gericht aan "Oude Holding B.V." werd dus toegewezen aan een
   * heel andere vennootschap. Precies de fout waarvoor deze hele migratie
   * bestaat, ingebouwd in de reparatie zelf. De sqltest ving hem.
   *
   * De asymmetrie die dat oplost: heeft de factuurnaam woorden die de bv niet
   * heeft ("oude"), dan noemt het stuk iets ANDERS en is dat een tegenspraak.
   * Heeft de bv woorden die de factuur niet noemt, dan heeft de leverancier
   * het korter opgeschreven. Alleen dat tweede telt.
   *
   * En alleen als er precies EEN zo te vinden is. Zijn het er meer -- er staat
   * alleen "Truckwash" op het stuk -- dan zegt de aanwijzing vooral dat alle
   * bv's op elkaar lijken, en dat wisten we.
   */
  select count(*) into hoeveel
    from public.exact_administratie a
   where a.actief
     and a.zoeknaam is not null
     and a.zoeknaam like zoek || '%';

  if hoeveel = 1 then
    select a.code, a.naam into gevonden
      from public.exact_administratie a
     where a.actief
       and a.zoeknaam is not null
       and a.zoeknaam like zoek || '%';
    code := gevonden.code; naam := gevonden.naam; zeker := false;
    waarom := format('De naam op de factuur lijkt op "%s". Kijk het na.', gevonden.naam);
    return next; return;
  end if;

  /* Niets gevonden. Geen rij: de aanroeper valt terug op de vestiging. */
  return;
end $$;

revoke execute on function public.administratie_zoeken(text, text, text) from public, anon;
grant  execute on function public.administratie_zoeken(text, text, text)
  to authenticated, service_role;

comment on function public.administratie_zoeken(text, text, text) is
  'Welke bv hoort bij deze geadresseerde? Zoekt op KvK, btw-nummer en naam, '
  'in die volgorde, en zegt erbij hoe zeker het is. Geeft geen rij als er '
  'niets te vinden was; dan valt de aanroeper terug op de vestiging (0079).';

-- ---------------------------------------------------------------------------
--  4. En bon_administratie() kijkt eerst naar de bon zelf
--
--  De volgorde IS de regel:
--
--    1. wat op de bon staat  -- gelezen van het stuk, of gezet door een mens
--    2. de vestiging         -- zoals het sinds 0059 ging
--    3. de hoofdadministratie
--
--  Het onderste twee zijn woordelijk 0059. Er komt alleen een stap voor.
-- ---------------------------------------------------------------------------

create or replace function public.bon_administratie(expense_in text)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    -- 1. wat er op de bon zelf staat
    (select nullif(trim(e.administratie), '') from public.expenses e where e.id = expense_in),
    -- 2. die van zijn vestiging
    (select nullif(trim(l.administratie), '')
       from public.expenses e
       left join public.locations l on l.id = e.location_id
      where e.id = expense_in),
    -- 3. en anders de hoofdadministratie
    (select a.code from public.exact_administratie a where a.hoofd limit 1)
  );
$$;

revoke execute on function public.bon_administratie(text) from public, anon;
grant  execute on function public.bon_administratie(text) to service_role, authenticated;

comment on function public.bon_administratie(text) is
  'In welke bv deze kostenpost geboekt wordt: wat op de bon staat (0079), '
  'anders die van zijn vestiging (0059), anders de hoofdadministratie.';

-- ---------------------------------------------------------------------------
--  5. Een gewijzigde bv komt in de historie
--
--  0061 legt vast wat er met een factuur gebeurt: de stand, het bedrag, de
--  rekening, de leverancier, het factuurnummer. De bv hoort in dat rijtje --
--  het bepaalt in welke jaarrekening de post landt, en dat is geen detail
--  waarvan je achteraf wil moeten gissen wie het heeft omgezet.
--
--  De functie eronder is woordelijk die van 0061 met een blok erbij.
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

  /* --- en de bv (0079) --- */
  if new.administratie is distinct from old.administratie then
    insert into public.expense_gebeurtenis (id, expense_id, soort, veld, oud, nieuw, door, door_naam)
    values (new.id || '_bv_' || public.now_ms()::text, new.id, 'gewijzigd',
            'onderneming', old.administratie, new.administratie, wie, naam)
    on conflict (id) do nothing;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
--  6. Wat er nog nergens heen kan
--
--  Voor het scherm: welke goedgekeurde facturen kunnen niet geboekt worden
--  omdat hun bv onbekend is, of omdat de grootboekrekening niet in DIE bv
--  bestaat. Dat is precies de stapel waar in Blue10 het rode kruisje bij
--  "Boeken" op staat, en zonder deze vraag is hij alleen te vinden door alle
--  facturen een voor een te openen.
-- ---------------------------------------------------------------------------

create or replace function public.bonnen_zonder_bv()
returns table (id text, leverancier text, bedrag numeric, reden text)
language sql stable security definer set search_path = public as $$
  select e.id,
         coalesce(e.supplier, ''),
         e.amount_excl,
         case
           when public.bon_administratie(e.id) is null
             then 'Er is geen onderneming bekend om op te boeken.'
           when e.grootboek_code is null
             then 'Er staat geen grootboekrekening op.'
           else format('Rekening %s bestaat niet in %s.',
                       e.grootboek_code, public.bon_administratie(e.id))
         end
    from public.expenses e
   where e.status = 'goedgekeurd'
     and e.exact_id is null
     and (
       public.bon_administratie(e.id) is null
       or e.grootboek_code is null
       or not exists (
         select 1 from public.exact_grootboek g
          where g.code = e.grootboek_code
            and g.division = public.bon_administratie(e.id))
     )
   order by e.expense_date;
$$;

revoke execute on function public.bonnen_zonder_bv() from public, anon;
grant  execute on function public.bonnen_zonder_bv() to authenticated, service_role;

comment on function public.bonnen_zonder_bv() is
  'Goedgekeurde facturen die niet geboekt kunnen worden, met de reden erbij '
  '(0079). Zonder deze vraag is die stapel alleen te vinden door alles een '
  'voor een te openen.';
