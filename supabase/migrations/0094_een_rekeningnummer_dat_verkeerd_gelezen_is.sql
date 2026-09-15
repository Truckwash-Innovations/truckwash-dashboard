-- ===========================================================================
--  Een rekeningnummer dat verkeerd gelezen is
--
--  Casper: "Bij betalen kan hij het niet aanmaken? waarom?"
--
--  Omdat de enige openstaande factuur een rekeningnummer draagt dat de
--  elfproef niet doorstaat:
--
--      NL55BNGH0285000122
--
--  Met dít rekeningnummer zouden de controlecijfers 65 moeten zijn en niet
--  55. De lezer heeft er dus één cijfer naast gezeten -- en dat is precies
--  waarvoor die controle er is: een bank weigert een heel bestand als er één
--  foute IBAN in staat, en dan blijft er van twintig betalingen niets over.
--
--  Waarom dat niet te herstellen was
--  ---------------------------------
--
--  betaalbaar() (0065) haalt de IBAN uit expenses.gelezen ->> 'iban'. Dat is
--  de LEZING, en die staat sinds 0029 met opzet vast: lezing_blijft_lezing()
--  zet elke wijziging vanuit de app terug. Terecht -- een verslag dat je
--  achteraf kunt bijschaven is geen verslag meer.
--
--  Maar daarmee was er geen enkele manier om een misgelezen cijfer recht te
--  zetten. De factuur kon nooit betaald worden vanuit de app, en het
--  antwoord was "dan maar met de hand".
--
--  Dus een eigen veld ernaast
--  --------------------------
--
--  expenses.betaal_iban: het rekeningnummer zoals een mens het heeft
--  nagekeken. De lezing blijft staan zoals hij was, en je kunt de twee naast
--  elkaar zien -- dat is juist bij een misgelezen cijfer wat je wilt.
--
--  Dezelfde opzet als bij de bv (0079): niet de gelezen waarde overschrijven
--  maar een veld ernaast, met de lezing als terugval.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Het veld
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists betaal_iban text;

comment on column public.expenses.betaal_iban is
  'Het rekeningnummer waarop betaald wordt, als een mens het heeft '
  'nagekeken (0094). Leeg = wat de lezer van de factuur haalde. De lezing '
  'zelf blijft onaangeraakt, zodat te zien is waar het verschil zit.';

-- ---------------------------------------------------------------------------
--  2. De elfproef, in de database
--
--  De verzendlus doet hem al (supabase/functions/_gedeeld/sepa.ts) en dat
--  blijft de plek waar een bestand op afketst. Maar een nummer dat de proef
--  niet doorstaat hoort er niet eens in te komen: dan staat er een correctie
--  in het veld die niets corrigeert, en dat merk je pas de volgende keer dat
--  je een bestand maakt.
--
--  Dezelfde berekening als overal: de eerste vier tekens naar achteren,
--  letters naar cijfers (A=10 ... Z=35), en de rest moet 1 zijn modulo 97.
--  In stukken rekenen, want een IBAN als getal past niet in een bigint.
-- ---------------------------------------------------------------------------

create or replace function public.iban_klopt(ruw text)
returns boolean
language plpgsql immutable as $$
declare
  schoon text := upper(regexp_replace(coalesce(ruw, ''), '[^A-Za-z0-9]', '', 'g'));
  omgezet text := '';
  teken text;
  rest bigint := 0;
  i integer;
begin
  if length(schoon) < 15 or length(schoon) > 34 then return false; end if;
  if schoon !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]+$' then return false; end if;

  /* De eerste vier tekens achteraan. */
  schoon := substr(schoon, 5) || substr(schoon, 1, 4);

  for i in 1..length(schoon) loop
    teken := substr(schoon, i, 1);
    if teken ~ '[0-9]' then
      omgezet := omgezet || teken;
    else
      omgezet := omgezet || (ascii(teken) - 55)::text;
    end if;
  end loop;

  /* Cijfer voor cijfer: een IBAN wordt tot 30 cijfers lang en dat past in
     geen enkel geheel getal. */
  for i in 1..length(omgezet) loop
    rest := (rest * 10 + substr(omgezet, i, 1)::bigint) % 97;
  end loop;

  return rest = 1;
end $$;

comment on function public.iban_klopt(text) is
  'De elfproef op een IBAN (0094): mod 97 moet 1 zijn. Dezelfde berekening '
  'als in _gedeeld/sepa.ts -- een bank weigert een heel bestand om één fout '
  'nummer.';

revoke execute on function public.iban_klopt(text) from public, anon;
grant  execute on function public.iban_klopt(text) to authenticated, service_role;

do $$
begin
  alter table public.expenses drop constraint if exists expenses_betaal_iban_klopt;
  /* NOT VALID: wat er al staat wordt niet nagerekend -- er staat nog niets,
     en een migratie hoort niet om te vallen op gegevens van gisteren. Voor
     alles wat er vanaf nu in gaat geldt hij wel, en daar is het om begonnen. */
  alter table public.expenses add constraint expenses_betaal_iban_klopt
    check (betaal_iban is null or public.iban_klopt(betaal_iban)) not valid;
exception when others then
  raise notice 'iban-controle niet gezet: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
--  3. En betaalbaar() neemt hem
--
--  Woordelijk die van 0065, met één coalesce erbij. De correctie gaat voor,
--  de lezing is de terugval.
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
         /* Wat een mens heeft nagekeken gaat voor wat de lezer ervan maakte. */
         coalesce(
           nullif(upper(replace(coalesce(e.betaal_iban, ''), ' ', '')), ''),
           upper(replace(coalesce(e.gelezen->>'iban', ''), ' ', ''))),
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

comment on function public.betaalbaar() is
  'Wat er openstaat om betaald te worden (0065). Sinds 0094 met het '
  'rekeningnummer dat een mens heeft nagekeken vóór dat van de lezer -- een '
  'misgelezen cijfer was anders niet te herstellen.';

-- ---------------------------------------------------------------------------
--  4. En een gecorrigeerd rekeningnummer komt in de historie
--
--  Dit is geld dat ergens anders heen gaat. Dat hoort in hetzelfde rijtje als
--  het bedrag en de rekening (0061/0079/0090), en niet stil te gebeuren.
--
--  Dezelfde functie als in 0090, met één blok erbij.
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
            'Boeking '
            || coalesce(nullif(new.exact_nummer, ''), new.exact_id)
            || coalesce(' in dagboek ' || nullif(new.exact_dagboek, ''), '')
            || coalesce(' van ' || nullif(new.administratie, ''), ''),
            wie, naam)
    on conflict (id) do nothing;
  end if;

  /* --- de velden waar het geld aan hangt --- */
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

  /* --- de bv (0079) --- */
  if new.administratie is distinct from old.administratie then
    insert into public.expense_gebeurtenis (id, expense_id, soort, veld, oud, nieuw, door, door_naam)
    values (new.id || '_bv_' || public.now_ms()::text, new.id, 'gewijzigd',
            'onderneming', old.administratie, new.administratie, wie, naam)
    on conflict (id) do nothing;
  end if;

  /* --- en het rekeningnummer waarop betaald wordt (0094) --- */
  if new.betaal_iban is distinct from old.betaal_iban then
    insert into public.expense_gebeurtenis (id, expense_id, soort, veld, oud, nieuw, door, door_naam)
    values (new.id || '_iban_' || public.now_ms()::text, new.id, 'gewijzigd',
            'rekeningnummer',
            coalesce(old.betaal_iban, nullif(old.gelezen ->> 'iban', '')),
            new.betaal_iban, wie, naam)
    on conflict (id) do nothing;
  end if;

  return new;
end $$;
