-- ===========================================================================
--  Schone lei
--
--  Casper: "buiten de gebruikers, ik wil de data (klanten, leveranciers,
--  prijzen, invoices ect) weg hebben om met een schone lei te beginnen."
--
--  DIT IS NIET TERUG TE DRAAIEN. Er zit geen prullenbak achter en er is geen
--  knop om het ongedaan te maken. Maak eerst een backup: Supabase ->
--  Database -> Backups, of `supabase db dump`. Dat is geen formaliteit --
--  hierna is het weg.
--
--  Het slot
--  --------
--
--  Dit bestand doet uit zichzelf niets. Onderaan in het blok staat
--
--      ik_weet_het_zeker boolean := false;
--
--  Zet die op true en draai het opnieuw. Eén blok, dus één transactie: het
--  gaat in zijn geheel goed of er verandert niets.
--
--  Wat er BLIJFT staan
--  -------------------
--
--    gebruikers            profiles, en hun dossier (personnel_private,
--                          personnel_loon). Een gebruiker zonder dossier is
--                          een halve gebruiker.
--    vestigingen           locations en de foto's -- daar draait de website op
--    instellingen          instellingen, exact_koppeling (je hoeft niet
--                          opnieuw te koppelen), rol_recht
--    de bv's               exact_administratie, inclusief de rekeningnummers
--                          die je er net in zet
--    het rekeningschema    grootboek en kosten_tags: dat is hoe je boekt, geen
--                          gegevens over klanten
--    de website-inhoud     vacature (de vacaturepagina) en trucky_vragen (de
--                          antwoorden van de chatbot)
--    opleidingen           courses. Wie wat heeft gehaald (course_progress)
--                          gaat wel weg.
--    de kassa's zelf       pos_registers en pos_safes: de apparatuur en de
--                          kluizen horen bij een vestiging, niet bij de
--                          gegevens. Alles wat erin zat gaat weg.
--
--  Twijfel je bij een van deze, laat hem dan staan en gooi hem later met de
--  hand weg. Te veel bewaren is terug te draaien; te weinig niet.
--
--  Wat er WEG gaat
--  ---------------
--
--    klanten, werkgevers en hun koppelingen, wasbeurten
--    inkoopfacturen met hun regels, historie en het postvak
--    verkoopfacturen, betaalbatches, de factuurnummering
--    de kopieën uit Exact (relaties, grootboek, personeel, crediteuren)
--    voorraad, mutaties, alarmen en bestellingen
--    kassabonnen, kasstanden, kluisboekingen, abonnementen, artikelen,
--    prijzen en pincodes
--    uren, roosters, urenverzoeken, ritten, dossierwijzigingen
--    installaties, storingen, werkbonnen, onderhoudsschema's
--    taken, projecten, documenten, sollicitaties
--    meldingen, overleg, berichten, logboeken, aanmeldingen
--
--  En daarna: de apparaten
--  -----------------------
--
--  Dit is het stuk dat je vergeet, en het is het belangrijkste.
--
--  Elk apparaat houdt een eigen kopie van alles. Leeggooien op de server
--  haalt die kopie niet weg: het ophalen vraagt "wat is er veranderd sinds
--  gisteren", en een rij die er niet meer is verandert nooit meer. Zonder de
--  stappen hieronder blijven de oude klanten en bonnen gewoon in beeld, en
--  wordt wat er in een wachtrij stond zelfs teruggeschreven.
--
--    1. Dashboard, telefoons, laptops: Instellingen -> Opnieuw ophalen. Dat
--       wist de lokale kopie en haalt alles opnieuw op. Op elk apparaat.
--
--    2. De kassa's. Die zet dit script op 'ingetrokken'. Dat is de weg die
--       er al voor is (migratie 0025): de kassa stuurt zijn wachtrij leeg,
--       wist zichzelf en logt uit. Daarna koppel je hem opnieuw met een
--       nieuwe code uit het dashboard.
--
--       Dat moet, en het is geen luiheid dat het niet anders kan. Zou de
--       kassa gekoppeld blijven terwijl de artikelen op de server weg zijn,
--       dan houdt hij zijn eigen lijst -- en verkoopt hij morgen tegen de
--       prijzen van vandaag.
--
--       Een kassa die uit staat krijgt de intrekking pas als hij weer
--       aangaat. Loop ze na.
--
--    3. De bestanden in de opslag (bijlagen bij bonnen, documenten) blijven
--       staan. Die zitten niet in de database maar in de buckets, en SQL
--       haalt daar alleen de administratie van weg. Wil je die ook leeg, zeg
--       het dan -- dat is een aparte stap.
--
--  Opnieuw draaien mag: wat weg is blijft weg.
-- ===========================================================================

do $$
declare
  -- ----------------------------------------------------------------------
  --  ZET DIT OP true OM HET ECHT TE DOEN
  -- ----------------------------------------------------------------------
  ik_weet_het_zeker boolean := false;

  /*
   * De volgorde is kind voor ouder.
   *
   * Het meeste ruimt zichzelf op via "on delete cascade", maar niet alles, en
   * een tabel die al leeg is kost niets. Expliciet zijn is hier goedkoper dan
   * erachter komen dat er één verwijzing bleef hangen.
   */
  weg_lijst text[] := array[
    -- kassa: eerst de regels, dan de bonnen
    'pos_payments', 'pos_sale_lines', 'pos_sales',
    'pos_cash_moves', 'pos_cash_sessions',
    'pos_subscription_uses', 'pos_subscriptions',
    'pos_safe_moves', 'pos_pins', 'pos_products', 'pos_pairings',

    -- betalen en inkoop
    'betaalregel', 'betaalbatch',
    'expense_gebeurtenis', 'expense_regel', 'expenses',
    'mailbox', 'leverancier_boeking', 'exact_leverancier',

    -- verkoop
    'verkoopregel', 'verkoopfactuur', 'verkoop_nummering',

    -- klanten en werkgevers
    'company_exact', 'employer_links', 'employer_rules', 'employers',
    'wash_jobs', 'companies',

    -- de kopieën uit Exact. exact_administratie blijft: daar staan de bv's
    -- in, met de rekeningnummers.
    'exact_relatie', 'exact_grootboek', 'exact_personeel', 'exact_medewerker',
    'exact_sync',

    -- voorraad
    'voorraad_alarmen', 'bestelregels', 'bestellingen',
    'stock_movements', 'inventory_items',

    -- uren en wat daaraan hangt
    'time_entries', 'shifts', 'hour_requests', 'trips',
    'course_progress', 'change_requests',

    -- techniek
    'work_orders', 'faults', 'maintenance_plans', 'assets',

    -- werk en documenten
    'taak_document', 'taak_reactie', 'taak', 'taak_project',
    'doc_toegang', 'doc_bestand', 'doc_map', 'documents',

    -- werving. De vacatures blijven: die staan op de website.
    'sollicitatie',

    -- berichten, meldingen, logboeken
    'chat_messages', 'channel_reads', 'channels',
    'notifications', 'ticket_messages', 'tickets', 'dev_plans',
    'agenda_items', 'signups', 'email_log', 'log_events',
    'trucky_contact', 'trucky_gesprekken', 'ai_opdrachten',
    'wachtwoord_herstel', 'route_cache',

    -- en de lijst met verwijderingen zelf. Elk apparaat haalt hierna alles
    -- opnieuw op; dan is deze lijst zonder werk.
    'deletion_log'
  ];

  /*
   * De sloten die hier in de weg staan.
   *
   * Dat ze er zijn is geen ongemak maar het punt: een afgerekende bon, een
   * kluisboeking en een uitgevoerde betaalopdracht mogen niet verdwijnen. Ze
   * gaan hier één transactie lang uit en daarna meteen weer aan.
   *
   * Vorm: tabel|trigger.
   */
  sloten text[] := array[
    'pos_sales|pos_sales_niet_wissen',
    'pos_sale_lines|pos_sale_lines_vast',
    'pos_payments|pos_payments_vast',
    'pos_safe_moves|pos_safe_moves_niet_wissen',
    'expense_regel|expense_regel_op_slot_trg',
    'verkoopregel|verkoopregel_op_slot_trg',
    'betaalregel|betaalregel_op_slot_trg',
    'companies|klant_niet_zomaar_weg_trg',
    -- En de melders. Die schrijven per verwijderde rij een regel in
    -- deletion_log; bij duizenden bonnen is dat duizenden regels voor een
    -- lijst die we hieronder toch weggooien.
    'notifications|notifications_verwijderd',
    'signups|signups_verwijderd',
    'expenses|expenses_verwijderd',
    'companies|companies_verwijderd',
    'voorraad_alarmen|voorraad_alarmen_verwijderd',
    'bestellingen|bestellingen_verwijderd',
    'bestelregels|bestelregels_verwijderd'
  ];

  tabel   text;
  slot    text;
  stuk    text[];
  weg     bigint;
  totaal  bigint := 0;
  kassas  bigint;
begin
  if not ik_weet_het_zeker then
    raise exception
      'Er is niets gebeurd. Lees de kop van dit bestand, maak een backup, en '
      'zet dan ik_weet_het_zeker op true.';
  end if;

  /* --- de sloten open --- */
  foreach slot in array sloten loop
    stuk := string_to_array(slot, '|');
    /* Ook op de trigger zelf kijken en niet alleen op de tabel. Een migratie
       die hier niet gedraaid is laat de tabel bestaan zonder zijn slot, en
       "disable trigger" op iets dat er niet is gooit de hele transactie om --
       op de stap die juist voorbereiding was. */
    if exists (
      select 1 from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
       where c.relname = stuk[1] and t.tgname = stuk[2] and not t.tgisinternal
    ) then
      execute format('alter table public.%I disable trigger %I', stuk[1], stuk[2]);
    end if;
  end loop;

  /*
   * De klanten losmaken van de gebruikers.
   *
   * Een klantaccount wijst met company_id naar een bedrijf. Dat bedrijf gaat
   * weg, de gebruiker blijft. De vreemde sleutel zet het bij het verwijderen
   * zelf op null, maar de wacht op companies telt die verwijzingen en weigert
   * zolang er nog aan hangt -- dus eerst dit, en dan pas de bedrijven.
   */
  update public.profiles set company_id = null where company_id is not null;
  get diagnostics weg = row_count;
  if weg > 0 then
    raise notice '% gebruiker(s) losgemaakt van een klant', weg;
  end if;

  /* --- en dan het wissen --- */
  foreach tabel in array weg_lijst loop
    if to_regclass('public.' || tabel) is null then
      continue;  -- een migratie die hier niet gedraaid is
    end if;
    execute format('delete from public.%I', tabel);
    get diagnostics weg = row_count;
    totaal := totaal + weg;
    if weg > 0 then
      raise notice '  %  %', lpad(weg::text, 8), tabel;
    end if;
  end loop;

  /*
   * De kassa's intrekken.
   *
   * Niet de rijen weggooien: dan hoort het apparaat het nooit en houdt het
   * zijn eigen kopie van de artikelen -- en verkoopt het morgen tegen de
   * prijzen van vandaag. Op 'ingetrokken' zetten is de weg die er al voor is
   * (0025): de kassa stuurt zijn wachtrij leeg, wist zichzelf en logt uit.
   *
   * De rij blijft staan tot hij wiped_at meldt. Daarna mag hij weg, en koppel
   * je het apparaat opnieuw met een verse code.
   */
  update public.pos_devices
     set status = 'ingetrokken',
         note = coalesce(nullif(note, '') || ' · ', '')
                || 'ingetrokken bij de schoonmaak',
         updated_at = (extract(epoch from now()) * 1000)::bigint
   where status <> 'ingetrokken';
  get diagnostics kassas = row_count;

  /* --- de sloten weer dicht --- */
  foreach slot in array sloten loop
    stuk := string_to_array(slot, '|');
    if exists (
      select 1 from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
       where c.relname = stuk[1] and t.tgname = stuk[2] and not t.tgisinternal
    ) then
      execute format('alter table public.%I enable trigger %I', stuk[1], stuk[2]);
    end if;
  end loop;

  /*
   * De bestelnummering terug naar het begin. Een schone lei die bij TS-2026-
   * 0247 begint is geen schone lei.
   */
  if to_regclass('public.bestelnummer_seq') is not null then
    perform setval('public.bestelnummer_seq', 1, false);
  end if;

  raise notice 'Schoonmaak klaar: % rijen weg, % kassa-apparaten ingetrokken.',
    totaal, kassas;
end $$;

-- ---------------------------------------------------------------------------
--  Wat er is weggegaan
--
--  Per tabel een regel, in het berichtenvenster van de SQL-editor (Messages).
--  Geen tijdelijke tabel met een verslag erin: die leeft zo lang als de
--  sessie, en als de editor er een nieuwe opent is het verslag weg -- dan
--  valt de controle om op een tabel die niet bestaat, ná een wissing die wel
--  gelukt is. De telling hieronder is de echte controle: die vraagt het aan
--  de tabellen zelf.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
--  Wat er nog staat
--
--  Een controle achteraf, zodat je niet op je geheugen hoeft te vertrouwen.
--  Hier hoort te staan wat er BLIJFT: de gebruikers, de vestigingen, de
--  instellingen en de inrichting.
-- ---------------------------------------------------------------------------

select 'gebruikers'        as wat, count(*) from public.profiles
union all select 'waarvan kassa-accounts', count(*) from public.profiles where is_device
union all select 'vestigingen',           count(*) from public.locations
union all select 'foto''s bij vestigingen', count(*) from public.location_photos
union all select 'instellingen',          count(*) from public.instellingen
union all select 'bv''s in Exact',         count(*) from public.exact_administratie
union all select 'grootboekrekeningen',   count(*) from public.grootboek
union all select 'vacatures',             count(*) from public.vacature
union all select 'vragen van Trucky',     count(*) from public.trucky_vragen
union all select 'kassa''s (apparatuur)',  count(*) from public.pos_registers
union all select 'kluizen',               count(*) from public.pos_safes
union all select 'klanten',               count(*) from public.companies
union all select 'inkoopfacturen',        count(*) from public.expenses
union all select 'wasbeurten',            count(*) from public.wash_jobs
union all select 'kassabonnen',           count(*) from public.pos_sales
order by 1;
