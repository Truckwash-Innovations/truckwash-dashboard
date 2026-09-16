-- ===========================================================================
--  De tweede handtekening ligt bij iemand
--
--  Casper: "Het komt binnen, en ai moet dan lezen en alles erin zetten, is
--  het ok (bedrag hetzelfde als vorige, ander factuurdatum ectect) dan moet je
--  hem voor de tweede goedkeuring doen. De tweede goedkeuring moet dan komen
--  te liggen bij een persoon (...) daarbuiten moet iemand van management
--  altijd het kunnen doen (als iemand bijvoorbeeld op vakantie is ect)
--  daarbuiten moet je ervoor zorgen dat het dan op hun todo komt te staan,
--  maar ook in de lijst zoals op de foto van blue10."
--
--  Wat er al stond en wat er ontbrak
--  ---------------------------------
--
--  0050 keurt een factuur automatisch de eerste keer goed als dezelfde
--  leverancier al een aantal keer met de hand rond hetzelfde bedrag is
--  goedgekeurd -- precies "bedrag hetzelfde als vorige, andere factuurdatum".
--  En 0060 eist een tweede handtekening van iemand anders.
--
--  Die twee samen doen al wat er gevraagd wordt, met één gat erin: de tweede
--  handtekening lag bij NIEMAND. Hij mocht door "wie over kosten mag
--  beslissen", en dat is een groep. Werk dat bij een groep ligt, ligt bij
--  niemand: er staat geen naam bij, het komt op geen enkele takenlijst, en na
--  drie weken is de vraag "wie zou dit doen" niet te beantwoorden.
--
--  Drie dingen dus
--  ---------------
--
--    1. de tweede handtekening is van de aangewezen persoon, en anders van
--       het management -- want iemand kan op vakantie zijn
--    2. hij komt op zijn takenlijst (0067), en gaat er weer af als het
--       getekend is
--    3. en er is een lijst van wat er bij wie ligt, met de dingen erbij die
--       je nodig hebt om te beslissen
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Wie mag deze tweede handtekening zetten?
--
--  Eén plek, want dit wordt op drie plekken gevraagd: door de wacht op de bon,
--  door het scherm dat de knop toont, en door de lijst.
--
--  Ligt de bon bij niemand, dan blijft het zoals het was: wie over kosten mag
--  beslissen. Anders: die persoon, of het management. Dat laatste is geen
--  achterdeur maar de reden dat dit werkt -- zonder is een vakantie genoeg om
--  de hele stapel stil te zetten.
-- ---------------------------------------------------------------------------

create or replace function public.mag_tweede_handtekening(expense_in text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not public.mag_kosten_beslissen() then false
    else coalesce(
      (select e.goedkeurder is null
              or e.goedkeurder = public.my_id()
              or public.is_management()
         from public.expenses e where e.id = expense_in),
      true)
  end;
$$;

revoke execute on function public.mag_tweede_handtekening(text) from public, anon;
grant  execute on function public.mag_tweede_handtekening(text) to authenticated, service_role;

comment on function public.mag_tweede_handtekening(text) is
  'Mag ik de tweede handtekening onder DEZE factuur zetten (0095/0096)? De '
  'aangewezen persoon of het management; ligt hij bij niemand, dan iedereen '
  'die over kosten mag beslissen, zoals het voor 0096 ging.';

-- ---------------------------------------------------------------------------
--  2. En de wacht op de bon houdt zich eraan
--
--  Woordelijk die van 0060, met één voorwaarde erbij. Dit staat in de
--  database en niet in het scherm, om dezelfde reden als toen: de app praat
--  rechtstreeks met de database, en een wijziging uit de wachtrij heeft geen
--  scherm gezien.
-- ---------------------------------------------------------------------------

create or replace function public.expenses_vier_ogen()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
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
   * En hij ligt bij iemand (0096).
   *
   * my_id() is leeg bij de serverfuncties -- die werken met de servicesleutel
   * en vallen hier buiten, net als overal. Wat er langs de app binnenkomt
   * wordt wel nagekeken.
   */
  if public.my_id() is not null
     and new.goedkeurder is not null
     and new.goedkeurder <> public.my_id()
     and not public.is_management()
  then
    raise exception 'Deze factuur ligt bij % voor de tweede handtekening.',
      coalesce(new.goedkeurder_naam, 'iemand anders')
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
--  3. Hij komt op de takenlijst
--
--  Dezelfde opzet als bij een sollicitatie (0068): een trigger maakt de taak,
--  met een vast id zodat hij nooit dubbel komt.
--
--  Ligt de bon bij niemand, dan gaat de taak naar de ROL administratie -- werk
--  dat bij een groep ligt hoort in ieder geval ergens te STAAN. Wie hem oppakt
--  zet hem op zijn naam; zo werkt een taak op een rol sinds 0067.
-- ---------------------------------------------------------------------------

create or replace function public.expense_tweede_handtekening_taak()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  wie    text;
  naam   text;
  bedrag text := trim(to_char(coalesce(new.amount_excl, 0), 'FM999999990.00'));
begin
  /* --- er komt werk bij --- */
  if new.status = 'eerste_akkoord' and coalesce(old.status, '') <> 'eerste_akkoord' then
    wie  := new.goedkeurder;
    naam := new.goedkeurder_naam;

    insert into public.taak (
      id, titel, omschrijving, status, prioriteit,
      location_id, toegewezen_aan, toegewezen_naam, toegewezen_rol,
      bron, bron_id, door_naam
    ) values (
      'taak_bon2_' || new.id,
      'Tweede handtekening: ' || coalesce(nullif(new.supplier, ''), 'factuur')
        || ' — € ' || bedrag,
      coalesce(nullif(new.factuurnummer, ''), 'zonder factuurnummer')
        || coalesce(', ' || nullif(new.administratie, ''), '')
        || E'\n'
        || case
             when new.goedkeuring_bron = 'automatisch'
               /* Zeggen dat de eerste vanzelf ging. Anders lijkt het alsof er
                  al iemand naar gekeken heeft, en dan is de tweede
                  handtekening een formaliteit in plaats van de enige. */
               then 'De eerste goedkeuring ging automatisch omdat deze leverancier '
                    || 'eerder voor ongeveer hetzelfde bedrag is goedgekeurd. Jij bent '
                    || 'dus de eerste die ernaar kijkt.'
             else 'Eerste akkoord door '
                  || coalesce(nullif(new.eerste_door_naam, ''), 'een collega') || '.'
           end,
      'te_doen',
      /* Een factuur die vervalt is dringender dan een die net binnen is. Geen
         datum: dan normaal, want dringend zonder reden leest niemand meer. */
      case
        when new.vervaldatum is not null
             and new.vervaldatum < public.now_ms() + (7::bigint * 24 * 60 * 60 * 1000)
          then 'hoog'
        else 'normaal'
      end,
      new.location_id,
      wie,
      naam,
      case when wie is null then 'administratie' else null end,
      'factuur',
      new.id,
      'De factuurstroom'
    )
    on conflict do nothing;
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
     where id = 'taak_bon2_' || new.id
       and status <> 'klaar';
  end if;

  return new;
end $$;

drop trigger if exists expense_tweede_handtekening_taak_trg on public.expenses;
create trigger expense_tweede_handtekening_taak_trg
  after update on public.expenses
  for each row execute function public.expense_tweede_handtekening_taak();

comment on function public.expense_tweede_handtekening_taak() is
  'Zet een factuur die op de tweede handtekening wacht op iemands takenlijst '
  '(0096), en haalt hem er weer af als het getekend is. Werk dat bij een '
  'groep ligt, ligt bij niemand.';

-- ---------------------------------------------------------------------------
--  4. En de lijst: wat ligt er bij wie
--
--  De kolommen van het scherm dat Casper liet zien: leverancier, factuurdatum,
--  vervaldatum, bedrijf, factuurnummer, bedrag, bij wie het ligt en hoeveel
--  dagen het er al staat. Dat laatste is waar het om gaat -- een factuur van
--  vier maanden oud ziet er in een lijst hetzelfde uit als een van gisteren.
--
--  Zonder `wie` alles wat openstaat; met `wie` wat er bij die persoon ligt.
-- ---------------------------------------------------------------------------

/* Eerst weg: 0106 geeft deze functie een kolom erbij, en create or replace
   kan het teruggegeven type niet veranderen. Zonder deze regel loopt een
   tweede ronde van bijwerken.sql hier stuk op "cannot change return type of
   existing function" -- de derde keer dat die val hier toeslaat. */
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
  dagen           integer
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
                      / (24 * 60 * 60 * 1000))::integer)
    from public.expenses e
   where e.status = 'eerste_akkoord'
     and (wie is null or e.goedkeurder = wie or e.goedkeurder is null)
   order by coalesce(e.vervaldatum, e.expense_date);
$$;

revoke execute on function public.facturen_op_handtekening(text) from public, anon;
grant  execute on function public.facturen_op_handtekening(text) to authenticated, service_role;

comment on function public.facturen_op_handtekening(text) is
  'Wat er op de tweede handtekening wacht, met bij wie het ligt en hoeveel '
  'dagen het er staat (0096). Zonder `wie` alles; met `wie` wat er bij die '
  'persoon ligt plus wat bij niemand ligt.';
