-- ===========================================================================
--  Betalen dat niet liegt
--
--  Casper: "Als wij moeten betalen, kan je er dan voor zorgen dat je de
--  status vanuit exact kan zien (of die al betaald is) (...) dit moet echt
--  feilloos zijn."
--
--  Wat "betaald" tot nu toe betekende
--  ----------------------------------
--
--  Dat iemand in het scherm op "Uitgevoerd" had geklikt. Meer niet. Er werd
--  een SEPA-bestand gemaakt, een mens zei dat de bank het had gedraaid, en
--  vanaf dat moment stond betaald_at gevuld. Of het geld werkelijk weg was
--  wist het systeem niet, en kon het ook niet weten -- dat staat op het
--  bankafschrift, en dat komt in Exact binnen.
--
--  Dat is precies het soort feilloos-lijkende oplossing die een half jaar
--  later niet klopt.
--
--  Drie standen in plaats van twee
--  -------------------------------
--
--    open          goedgekeurd, geboekt, nog nergens aangeboden
--    aangeboden    het bestand is gemaakt en bij de bank ingediend. Wij
--                  weten dat WIJ het hebben gedaan, niet dat het gelukt is.
--    betaald       Exact heeft hem afgeletterd tegen het bankafschrift.
--
--  Die laatste komt dus niet van ons. Exact kent per openstaande post een
--  Status (cashflow/Payments): 20 open, 30 geselecteerd, 40 verwerkt, 50
--  afgeletterd. Alleen 50 telt hier als betaald.
--
--  En zelfs 50 is "niet meer openstaand" en niet per se "er is geld
--  gegaan" -- de documentatie zegt letterlijk "matched with one or more
--  other outstanding items or financial statement lines", en dat eerste kan
--  een creditnota zijn. Vandaar dat de stand bewaard wordt als GETAL en niet
--  als vinkje: wie later preciezer wil zijn, kan dat dan nog.
--
--  Drie gaten die er los van stonden
--  ---------------------------------
--
--    1. betaalbaar() keek niet of de factuur in Exact geboekt was, terwijl
--       de kop van 0065 dat wel beloofde. Je kon dus iets betalen dat nooit
--       in de boekhouding is gekomen.
--
--    2. Het SEPA-bestand werd nergens bewaard. Mislukte de download, dan
--       zaten die facturen in een batch en kwamen ze nooit meer terug.
--
--    3. Een batch intrekken kon niet -- de stand bestond wel en werd door
--       niets gezet -- en dezelfde factuur nog eens in een batch zetten liep
--       stuk op een dubbele sleutel.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. De drie standen
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists aangeboden_at        bigint;
alter table public.expenses add column if not exists exact_betaalstatus   smallint;
alter table public.expenses add column if not exists exact_betaalstatus_at bigint;

comment on column public.expenses.aangeboden_at is
  'Wanneer deze factuur in een betaalbestand bij de bank is aangeboden '
  '(0100). Dat is iets anders dan betaald: wij weten dat WIJ het hebben '
  'gedaan, niet dat het gelukt is.';

comment on column public.expenses.exact_betaalstatus is
  'De stand van de openstaande post in Exact (0100), veld Status op '
  'cashflow/Payments: 20 open, 30 geselecteerd, 40 verwerkt, 50 afgeletterd. '
  'Alleen 50 telt hier als betaald -- en ook dat is "niet meer openstaand", '
  'want matchen kan ook tegen een creditnota.';

/*
 * Wat er al stond blijft staan.
 *
 * Bonnen die hiervoor op betaald zijn gezet, zijn dat door een mens die op
 * "Uitgevoerd" klikte. Dat is naar de nieuwe woorden "aangeboden", en dat
 * wordt hier ook zo genoteerd -- maar betaald_at blijft staan. Achteraf
 * honderden facturen op onbetaald zetten omdat het woord veranderd is, is
 * erger dan een oude rij die iets te stellig is.
 */
/*
 * En zonder de stempel: stamp_expenses zet updated_at op nu, en dan ziet elk
 * toestel elke ooit betaalde factuur als vers gewijzigd en haalt hij de hele
 * geschiedenis opnieuw op. Een eenmalige invulling van een nieuw veld hoort
 * geen synchronisatiestorm te zijn.
 */
alter table public.expenses disable trigger stamp_expenses;

update public.expenses e
   set aangeboden_at = e.betaald_at
 where e.betaald_at is not null
   and e.aangeboden_at is null
   and e.betaalbatch_id is not null;

alter table public.expenses enable trigger stamp_expenses;

-- ---------------------------------------------------------------------------
--  2. De betaalvelden zijn van de server
--
--  Dezelfde regel als bij de lezing (0029): de app schrijft een kostenpost
--  als hele rij terug, en dan zitten deze kolommen er ook in. Zonder rem kan
--  iedereen die over kosten mag beslissen betaald_at rechtstreeks zetten via
--  de synchronisatiewachtrij -- zonder batch, zonder bestand, zonder spoor.
--
--  Bij "dit moet echt feilloos zijn" hoort dat het niet met de hand te
--  zetten is.
-- ---------------------------------------------------------------------------

create or replace function public.betalen_blijft_van_de_server()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  /* De serverfuncties werken met de servicesleutel en hebben geen my_id(). */
  if public.my_id() is null then return new; end if;

  new.betaald_at            := old.betaald_at;
  new.betaald_door          := old.betaald_door;
  new.betaalbatch_id        := old.betaalbatch_id;
  new.aangeboden_at         := old.aangeboden_at;
  new.exact_betaalstatus    := old.exact_betaalstatus;
  new.exact_betaalstatus_at := old.exact_betaalstatus_at;

  /*
   * En de weigering van Exact (0099) hoort er ook bij.
   *
   * De app schrijft een kostenpost als HELE rij terug, met wat het toestel
   * het laatst zag. Stond daar een weigering in die intussen is opgelost,
   * dan schrijft een onschuldige wijziging die oude tekst terug -- en de
   * trigger eronder boekt dat als een nieuwe weigering, op naam van degene
   * die net een tag aanvinkte. Een gebeurtenis die nooit heeft
   * plaatsgevonden, met een naam eronder die er niets mee te maken had.
   *
   * Opruimen mag de app wel, want dat gebeurt hieronder in
   * expense_exact_fout_opruimen() op grond van wat er werkelijk veranderde.
   */
  new.exact_fout    := old.exact_fout;
  new.exact_fout_at := old.exact_fout_at;
  return new;
end $$;

revoke execute on function public.betalen_blijft_van_de_server() from public, anon, authenticated;

drop trigger if exists expenses_betalen_van_de_server on public.expenses;
create trigger expenses_betalen_van_de_server
  before update on public.expenses
  for each row execute function public.betalen_blijft_van_de_server();

-- ---------------------------------------------------------------------------
--  3. Het bestand blijft bewaard
--
--  Het stond alleen in het antwoord van de serverfunctie: ging de download
--  mis of sloot iemand het tabblad, dan was het weg -- en de facturen zaten
--  intussen in een batch en vielen daarmee uit betaalbaar(). Onherstelbaar,
--  zonder handwerk in de database.
--
--  Niet in de synchronisatie: betaalbatch gaat niet naar de toestellen, en
--  dat hoort zo te blijven. Dit is een bestand van tienduizenden tekens dat
--  precies één keer nodig is.
-- ---------------------------------------------------------------------------

alter table public.betaalbatch add column if not exists xml text;

comment on column public.betaalbatch.xml is
  'Het SEPA-bestand zelf (0100), zodat het opnieuw te downloaden is. Stond '
  'hiervoor alleen in het antwoord van de serverfunctie en was weg zodra de '
  'download misging.';

/*
 * En een vlaggetje ernaast, zodat het scherm kan vragen OF het bestand er is
 * zonder het op te halen. De stand van het betaalscherm wordt bij elke ronde
 * opgevraagd; dertig bestanden van tienduizenden tekens meesturen om een
 * knopje wel of niet te tonen is verspilling die je pas merkt als het traag
 * wordt.
 */
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'betaalbatch'
       and column_name = 'heeft_xml')
  then
    alter table public.betaalbatch
      add column heeft_xml boolean
      generated always as (xml is not null and xml <> '') stored;
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  4. Een batch intrekken
--
--  Alleen een concept. Is hij eenmaal aangeboden, dan ligt de opdracht bij
--  de bank en is intrekken hier een leugen: de facturen zouden terugkomen in
--  de betaallijst en een tweede keer overgemaakt worden. Dat terughalen doe
--  je bij de bank, en daarna zet je hem hier met de hand op ingetrokken --
--  wat deze functie dan weigert, en terecht.
-- ---------------------------------------------------------------------------

create or replace function public.betaalbatch_intrekken(batch_in text, door_in text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  stand text;
  n     integer;
begin
  select b.status into stand from public.betaalbatch b where b.id = batch_in;
  if stand is null then
    raise exception 'Die betaalopdracht bestaat niet.' using errcode = 'no_data_found';
  end if;
  if stand <> 'concept' then
    raise exception
      'Deze betaalopdracht is al %; intrekken kan alleen zolang hij concept is.', stand
      using errcode = 'check_violation';
  end if;

  update public.betaalbatch
     set status = 'ingetrokken', door = coalesce(door_in, door),
         updated_at = public.now_ms()
   where id = batch_in;

  /* En de facturen los, zodat ze gewoon weer in de betaallijst komen. */
  update public.expenses e
     set betaalbatch_id = null, aangeboden_at = null, updated_at = public.now_ms()
    from public.betaalregel r
   where r.batch_id = batch_in and e.id = r.expense_id;

  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.betaalbatch_intrekken(text, text) from public, anon, authenticated;
grant  execute on function public.betaalbatch_intrekken(text, text) to service_role;

-- ---------------------------------------------------------------------------
--  5. Uitvoeren betekent aangeboden, niet betaald
-- ---------------------------------------------------------------------------

create or replace function public.betaalbatch_uitvoeren(batch_in text, door_in text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.expenses e
     set aangeboden_at = public.now_ms(),
         betaald_door = door_in,
         betaalbatch_id = batch_in,
         updated_at = public.now_ms()
    from public.betaalregel r
   where r.batch_id = batch_in
     and e.id = r.expense_id
     and e.aangeboden_at is null;

  get diagnostics n = row_count;

  update public.betaalbatch
     set status = 'uitgevoerd', uitgevoerd_at = public.now_ms(),
         door = coalesce(door_in, door), updated_at = public.now_ms()
   where id = batch_in;

  return n;
end $$;

revoke execute on function public.betaalbatch_uitvoeren(text, text) from public, anon, authenticated;
grant  execute on function public.betaalbatch_uitvoeren(text, text) to service_role;

comment on function public.betaalbatch_uitvoeren(text, text) is
  'De facturen van deze opdracht op AANGEBODEN zetten (0100). Betaald komt '
  'uit Exact, niet uit een klik: zie betaalstatus_bijwerken().';

-- ---------------------------------------------------------------------------
--  6. En betaald komt uit Exact
--
--  Eén plek waar de stand van Exact een betekenis krijgt, zodat de regel na
--  te rekenen is zonder de Edge Function te draaien.
-- ---------------------------------------------------------------------------

create or replace function public.betaalstatus_bijwerken(
  bon_in text, status_in integer, eind_in bigint default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  was integer;
begin
  select e.exact_betaalstatus into was from public.expenses e where e.id = bon_in;

  update public.expenses e
     set exact_betaalstatus = status_in,
         exact_betaalstatus_at = public.now_ms(),
         /*
          * Alleen 50 telt als betaald. 40 heet in Exact "processed", maar dat
          * betekent dat het bestand is klaargezet -- niet dat er geld is
          * gegaan. Bij ons, waar het bestand buiten Exact om wordt gemaakt,
          * komt 40 zelfs helemaal niet voor.
          *
          * De datum van Exact gaat voor onze klok: dat is de dag waarop de
          * post niet meer openstond, en die hoort in de administratie te
          * kloppen, niet de dag waarop wij toevallig keken.
          */
         betaald_at = case
           when status_in = 50 then coalesce(e.betaald_at, eind_in, public.now_ms())
           /*
            * En terug kan ook.
            *
            * Stond hij op 50 en zegt Exact nu iets lagers, dan is de post
            * daar weer open -- een storno, een teruggedraaide aflettering,
            * een verkeerd gematchte creditnota. Bleef betaald_at dan staan,
            * dan is de enige stand die niet meer kan veranderen juist de
            * stand die geld betekent. Exact is hier de bron, ook als het de
            * verkeerde kant op gaat.
            */
           when was = 50 and status_in < 50 then null
           else e.betaald_at
         end,
         updated_at = public.now_ms()
   where e.id = bon_in;

  return was is distinct from status_in;
end $$;

revoke execute on function public.betaalstatus_bijwerken(text, integer, bigint)
  from public, anon, authenticated;
grant  execute on function public.betaalstatus_bijwerken(text, integer, bigint)
  to service_role;

comment on function public.betaalstatus_bijwerken(text, integer, bigint) is
  'De betaalstand uit Exact vastleggen (0100, cashflow/Payments.Status). '
  'Alleen 50 (afgeletterd) zet betaald_at; geeft terug of de stand veranderde.';

-- ---------------------------------------------------------------------------
--  7. En wat er te betalen valt, moet wél geboekt zijn
--
--  De kop van 0065 beloofde "Goedgekeurd, geboekt in Exact, nog niet
--  betaald", maar die middelste stond niet in de vraag. Je kon dus een
--  factuur betalen die nooit in de boekhouding is gekomen -- en dan is hij
--  hier afgehandeld en in Exact onbekend.
--
--  Meteen ook het bedrag uit btw_bedrag als dat er staat. Hier werd het
--  uitgerekend als excl * (1 + pct/100), terwijl het btw-bedrag van de
--  factuur zelf een kolom verderop staat. Twee manieren om "wat er weg moet"
--  uit te rekenen is er één te veel, en de grofste stond op de betaalkant.
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
         round(
           coalesce(e.amount_excl, 0)
           + coalesce(
               e.btw_bedrag,
               coalesce(e.amount_excl, 0) * coalesce(e.vat_pct, 0) / 100.0),
           2),
         /* Wat een mens heeft nagekeken gaat voor wat de lezer ervan maakte. */
         coalesce(
           nullif(upper(replace(coalesce(e.betaal_iban, ''), ' ', '')), ''),
           upper(replace(coalesce(e.gelezen->>'iban', ''), ' ', ''))),
         public.bon_administratie(e.id),
         e.expense_date,
         e.vervaldatum
    from public.expenses e
   where e.status = 'goedgekeurd'
     /* Geboekt in Exact. Zonder boeking is er niets om tegen af te letteren,
        en dan kan de betaalstand ook nooit terugkomen. */
     and e.exact_id is not null
     and e.betaald_at is null
     and e.aangeboden_at is null
     and coalesce(e.amount_excl, 0) > 0
     and not exists (
       select 1 from public.betaalregel r
         join public.betaalbatch b on b.id = r.batch_id
        where r.expense_id = e.id and b.status <> 'ingetrokken')
   order by coalesce(e.vervaldatum, e.expense_date);
$$;

revoke execute on function public.betaalbaar() from public, anon, authenticated;
grant  execute on function public.betaalbaar() to service_role;

comment on function public.betaalbaar() is
  'Wat er openstaat om betaald te worden (0065, 0094, 0100): goedgekeurd, '
  'geboekt in Exact, nog niet aangeboden en nog niet betaald, met een '
  'rekeningnummer erop.';

-- ---------------------------------------------------------------------------
--  8. Wat er wacht op de boeking
--
--  Nu betaalbaar() een boeking eist, verdwijnen facturen die daar nog niet
--  zijn stilletjes uit de betaallijst. Stil is hier het probleem: dan lijkt
--  het of er niets te betalen valt. Deze telt ze, zodat het scherm kan
--  zeggen wat er aan de hand is.
-- ---------------------------------------------------------------------------

create or replace function public.betaalbaar_wacht_op_boeking()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.expenses e
   where e.status = 'goedgekeurd'
     and e.exact_id is null
     and e.betaald_at is null
     and e.aangeboden_at is null
     and coalesce(e.amount_excl, 0) > 0;
$$;

revoke execute on function public.betaalbaar_wacht_op_boeking() from public, anon, authenticated;
grant  execute on function public.betaalbaar_wacht_op_boeking() to service_role;

-- ---------------------------------------------------------------------------
--  9. Eén factuur in één lopende opdracht -- als harde regel
--
--  Hier ging het in de eerste versie van deze migratie mis, en het is het
--  ergste soort fout: een bestaande garantie weghalen zonder het te merken.
--
--  De sleutel van een betaalregel was 'br_' + factuur-id. Dat was geen
--  naamgeving maar een SLOT: dezelfde factuur kon nooit in twee regels
--  staan, want de database weigerde het. Om na een intrekking opnieuw te
--  kunnen betalen werd die sleutel 'br_' + opdracht + factuur -- en daarmee
--  viel het slot weg.
--
--  Wat overbleef was betaalregel_op_slot(), en die doet een gewone select.
--  Onder READ COMMITTED ziet de ene transactie de nog niet vastgelegde regel
--  van de andere niet: twee mensen die tegelijk een bestand maken krijgen
--  allebei dezelfde factuur mee, en die wordt twee keer overgemaakt.
--
--  Dus komt het slot terug, nu als partiële index. Een index kan geen
--  subquery, dus staat de stand op de regel zelf: lopend = true zolang de
--  opdracht niet is ingetrokken. Daarmee is "één factuur in één lopende
--  opdracht" weer een regel van de database en niet van de volgorde waarin
--  het toevallig gebeurt.
-- ---------------------------------------------------------------------------

alter table public.betaalregel add column if not exists lopend boolean not null default true;

comment on column public.betaalregel.lopend is
  'Hoort deze regel bij een opdracht die nog meetelt? (0100) False zodra de '
  'opdracht is ingetrokken. Draagt de partiele unieke index die voorkomt dat '
  'dezelfde factuur in twee lopende opdrachten staat.';

/* Bestaande regels: ingetrokken opdrachten tellen niet mee. */
update public.betaalregel r
   set lopend = (b.status <> 'ingetrokken')
  from public.betaalbatch b
 where b.id = r.batch_id
   and r.lopend <> (b.status <> 'ingetrokken');

create unique index if not exists betaalregel_een_per_factuur
  on public.betaalregel (expense_id) where lopend;

/*
 * En de stand volgt de opdracht. Zonder dit zou intrekken de regels laten
 * staan als "lopend" en blijft de factuur geblokkeerd -- precies wat
 * intrekken moest oplossen.
 */
create or replace function public.betaalregel_volgt_opdracht()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    update public.betaalregel r
       set lopend = (new.status <> 'ingetrokken'), updated_at = public.now_ms()
     where r.batch_id = new.id
       and r.lopend is distinct from (new.status <> 'ingetrokken');
  end if;
  return new;
end $$;

revoke execute on function public.betaalregel_volgt_opdracht() from public, anon, authenticated;

drop trigger if exists betaalbatch_regels_volgen on public.betaalbatch;
create trigger betaalbatch_regels_volgen
  after update of status on public.betaalbatch
  for each row execute function public.betaalregel_volgt_opdracht();

-- ---------------------------------------------------------------------------
--  10. Een uitgevoerde opdracht is niet opnieuw uit te voeren
--
--  betaalbatch_uitvoeren() keek niet naar de stand van de opdracht en zette
--  hem aan het eind onvoorwaardelijk op 'uitgevoerd'. Op een INGETROKKEN
--  opdracht draaide dat de intrekking stil terug: de facturen kregen
--  aangeboden_at, de opdracht heette weer uitgevoerd, en niemand die het zag.
-- ---------------------------------------------------------------------------

create or replace function public.betaalbatch_uitvoeren(batch_in text, door_in text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  stand text;
  n     integer;
begin
  select b.status into stand from public.betaalbatch b where b.id = batch_in;
  if stand is null then
    raise exception 'Die betaalopdracht bestaat niet.' using errcode = 'no_data_found';
  end if;
  if stand <> 'concept' then
    raise exception
      'Deze betaalopdracht is al %; hem nog eens uitvoeren kan niet.', stand
      using errcode = 'check_violation';
  end if;

  update public.expenses e
     set aangeboden_at = public.now_ms(),
         betaald_door = door_in,
         betaalbatch_id = batch_in,
         updated_at = public.now_ms()
    from public.betaalregel r
   where r.batch_id = batch_in
     and e.id = r.expense_id
     and e.aangeboden_at is null;

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
--  11. Een bedrag dat met de factuur meebeweegt
--
--  betaalbaar() rekent met btw_bedrag als dat er staat -- dat is het bedrag
--  van de factuur zelf en preciezer dan een percentage. Maar btw_bedrag komt
--  van de lezer en wordt daarna nooit meer aangeraakt, terwijl een mens in
--  het scherm alleen bedrag en percentage kan corrigeren.
--
--  Dan betaal je het oude btw-bedrag bij een nieuw factuurbedrag. Dus:
--  wijzigt iemand het bedrag of het percentage zonder het btw-bedrag mee te
--  geven, dan is dat btw-bedrag niet meer van deze factuur en gaat het eraf.
--  betaalbaar() valt dan terug op de berekening, en die klopt weer.
-- ---------------------------------------------------------------------------

create or replace function public.btw_bedrag_volgt_de_factuur()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.btw_bedrag is distinct from old.btw_bedrag then return new; end if;
  if new.btw_bedrag is null then return new; end if;

  if new.amount_excl is distinct from old.amount_excl
     or new.vat_pct is distinct from old.vat_pct
  then
    new.btw_bedrag := null;
  end if;

  return new;
end $$;

revoke execute on function public.btw_bedrag_volgt_de_factuur() from public, anon, authenticated;

drop trigger if exists expenses_btw_bedrag_volgt on public.expenses;
create trigger expenses_btw_bedrag_volgt
  before update on public.expenses
  for each row execute function public.btw_bedrag_volgt_de_factuur();

-- ---------------------------------------------------------------------------
--  12. Welke facturen de betaalstand moeten laten nakijken
--
--  In de serverfunctie stond de administratie uit de rauwe kolom
--  expenses.administratie. Zo wordt er niet geboekt: dat gaat via
--  bon_administratie(), die ook naar de vestiging en de hoofdadministratie
--  kijkt. Verschilden die twee, dan werd de betaalstand in de verkeerde bv
--  opgevraagd, kwam er nooit een match, en bleef de factuur eeuwig op
--  aangeboden staan -- zonder een woord.
--
--  Dezelfde vraag hoort hetzelfde antwoord te geven, dus staat hij hier en
--  niet nog een keer in TypeScript. Met een vaste volgorde en een
--  bovengrens, zodat een halve ronde herkenbaar is als een halve ronde.
-- ---------------------------------------------------------------------------

create or replace function public.betaalstatus_te_controleren(hoeveel integer default 500)
returns table (id text, exact_id text, administratie text)
language sql stable security definer set search_path = public as $$
  select e.id, e.exact_id, public.bon_administratie(e.id)
    from public.expenses e
   where e.exact_id is not null
     and e.betaald_at is null
     and e.aangeboden_at is not null
   order by e.aangeboden_at, e.id
   limit greatest(1, coalesce(hoeveel, 500));
$$;

revoke execute on function public.betaalstatus_te_controleren(integer) from public, anon, authenticated;
grant  execute on function public.betaalstatus_te_controleren(integer) to service_role;

comment on function public.betaalstatus_te_controleren(integer) is
  'De facturen waarvan de betaalstand bij Exact nagekeken moet worden (0100): '
  'geboekt, aangeboden, nog niet betaald. De bv komt uit bon_administratie() '
  'en niet uit de rauwe kolom -- daar wordt ook op geboekt.';

-- ---------------------------------------------------------------------------
--  13. En wat er blijft hangen
--
--  Een factuur die is aangeboden maar nooit is afgeletterd staat in GEEN
--  enkele lijst: niet bij wat te betalen valt, niet bij wat op een boeking
--  wacht, en niet bij wat betaald is. Dat is het soort stilte waar je een
--  half jaar later achter komt, en precies wat "feilloos" uitsluit.
-- ---------------------------------------------------------------------------

create or replace function public.betaal_blijft_hangen(dagen integer default 10)
returns table (
  id            text,
  leverancier   text,
  factuurnummer text,
  bedrag_incl   numeric,
  administratie text,
  aangeboden_at bigint,
  stand         smallint
)
language sql stable security definer set search_path = public as $$
  select e.id,
         coalesce(e.supplier, ''),
         e.factuurnummer,
         round(
           coalesce(e.amount_excl, 0)
           + coalesce(
               e.btw_bedrag,
               coalesce(e.amount_excl, 0) * coalesce(e.vat_pct, 0) / 100.0),
           2),
         public.bon_administratie(e.id),
         e.aangeboden_at,
         e.exact_betaalstatus
    from public.expenses e
   where e.aangeboden_at is not null
     and e.betaald_at is null
     and e.aangeboden_at < public.now_ms() - (greatest(1, coalesce(dagen, 10)) * 86400000)::bigint
   order by e.aangeboden_at;
$$;

revoke execute on function public.betaal_blijft_hangen(integer) from public, anon, authenticated;
grant  execute on function public.betaal_blijft_hangen(integer) to service_role;

comment on function public.betaal_blijft_hangen(integer) is
  'Facturen die al dagen bij de bank liggen en in Exact nog niet zijn '
  'afgeletterd (0100). Staan in geen enkele andere lijst; zonder deze vraag '
  'verdwijnen ze stil.';
