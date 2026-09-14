-- ===========================================================================
--  Een eigen werkadres
--
--  Casper: "voor werknemers moet ik een soort microsoft 365 kunnen aanklikken,
--  dan krijgen ze automatisch een mail, met hun voornaam@domein (...) De
--  communicatie moet wel nog naar hun persoonlijke mail (als ze een melding
--  krijgen ect)."
--
--  Dit is de eerste steen, en met opzet alleen de eerste. Er komt een postvak
--  achter, een mailprogramma en een documentmotor; die staan of vallen met
--  waar het gaat draaien. Wat hier gebeurt is nodig in elke variant daarvan,
--  en het is het stuk dat je later niet meer kunt rechtzetten: een adres dat
--  eenmaal is uitgedeeld staat op briefpapier, in handtekeningen en bij
--  klanten in hun adresboek.
--
--  Twee adressen, en waarom dat het hele punt is
--  ---------------------------------------------
--
--  profiles.email is het adres waarmee iemand inlogt en waar zijn meldingen
--  heen gaan. Dat is bijna altijd een privéadres -- gmail, hotmail -- en dat
--  blijft zo. Casper vroeg daar met zoveel woorden om.
--
--  Zonder deze splitsing zou "iemand een werkadres geven" betekenen dat al
--  zijn meldingen naar dat nieuwe postvak gaan. En dat postvak kan hij pas
--  openen als hij is ingelogd, waarvoor hij een wachtwoord nodig heeft dat in
--  een mail staat -- naar datzelfde postvak. Een kring waar niemand in komt.
--
--  Dus: werk_email komt ernaast te staan en taken_voor_mail() (0070) blijft
--  onaangeraakt p.email lezen. De zelftest houdt dat vast.
--
--  Waarom de server het adres bedenkt en niet het scherm
--  ----------------------------------------------------
--
--  Omdat twee mensen tegelijk "Jan" kunnen heten, en twee schermen die
--  allebei jan@ voorstellen geven allebei hetzelfde antwoord. De unieke index
--  vangt dat, maar dan is het al een foutmelding bij het opslaan. De functie
--  hieronder kijkt in dezelfde transactie wat vrij is.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Het adres op het dossier
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists werk_email     text;
alter table public.profiles add column if not exists werk_mail_aan  boolean not null default false;
alter table public.profiles add column if not exists werk_mail_sinds bigint;

comment on column public.profiles.werk_email is
  'Het werkadres: voornaam@<werk_domein> (0081). Staat NAAST email -- dat is '
  'het adres waarmee iemand inlogt en waar zijn meldingen heen gaan, en dat '
  'blijft het privéadres.';

comment on column public.profiles.werk_mail_aan is
  'Of het postvak openstaat. Uit betekent: het adres is gereserveerd maar er '
  'komt en gaat niets. Zo kun je iemand die weggaat afsluiten zonder het '
  'adres vrij te geven -- post die daarna nog binnenkomt hoort niet bij de '
  'volgende Jan terecht te komen.';

/*
 * Eén adres hoort bij één mens.
 *
 * Op lower(), want mailadressen zijn hoofdletterongevoelig en "Jan@" en "jan@"
 * zijn hetzelfde postvak. Een gedeeltelijke index: leeg telt niet mee, anders
 * kan er maar één iemand zonder werkadres zijn.
 */
create unique index if not exists profiles_werk_email_uniek
  on public.profiles (lower(werk_email)) where werk_email is not null;

-- ---------------------------------------------------------------------------
--  Een naam zonder tierlantijnen
--
--  Geen unaccent(): die uitbreiding is er op Supabase wel en in de testdatabase
--  niet (zie 0042, waar daar een stut voor staat). Een vaste vertaaltabel doet
--  wat hier nodig is en werkt overal hetzelfde -- en dit is een adres, dus
--  "overal hetzelfde" weegt zwaarder dan "volledig".
-- ---------------------------------------------------------------------------

create or replace function public.kaal_naam(ruw text)
returns text language sql immutable as $$
  select nullif(
    regexp_replace(
      translate(
        lower(coalesce(ruw, '')),
        'àáâãäåèéêëìíîïòóôõöùúûüýÿñçø',
        'aaaaaaeeeeiiiiooooouuuuyync o'
      ),
      '[^a-z0-9]', '', 'g'),
    '');
$$;

comment on function public.kaal_naam(text) is
  'Een naam zoals hij in een mailadres mag staan: kleine letters, geen '
  'leestekens, geen accenten (0081).';

-- ---------------------------------------------------------------------------
--  Welk adres krijgt deze persoon?
--
--  De volgorde is: voornaam, dan voornaam.achternaam, dan een cijfer erachter.
--  Dat is de volgorde die mensen zelf verwachten, en de eerste is verreweg de
--  prettigste om door de telefoon te spellen.
--
--  Geeft alleen een VOORSTEL. Het vastleggen gebeurt bij het aanzetten, en
--  daar bewaakt de unieke index het echte laatste woord.
-- ---------------------------------------------------------------------------

create or replace function public.werkadres_voorstel(
  wie text,
  domein_in text default null
)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  persoon   record;
  domein    text;
  voor      text;
  achter    text;
  kandidaat text;
  nr        integer := 2;
begin
  select name, werk_email into persoon from public.profiles where id = wie;
  if not found then return null; end if;

  /* Heeft hij er al een, dan is dat het antwoord. Een tweede adres bedenken
     voor iemand die er een heeft is hoe je twee postvakken krijgt. */
  if persoon.werk_email is not null then return persoon.werk_email; end if;

  domein := coalesce(
    nullif(trim(domein_in), ''),
    (select nullif(trim(i.waarde), '') from public.instellingen i
      where i.sleutel = 'werk_domein'));
  if domein is null then return null; end if;

  /*
   * De naam staat als één veld op het dossier. Het eerste woord is de
   * voornaam, de rest de achternaam -- inclusief een tussenvoegsel, want
   * "jan.vandijk" is een adres en "jan.dijk" is een andere meneer.
   */
  voor   := public.kaal_naam(split_part(trim(persoon.name), ' ', 1));
  achter := public.kaal_naam(
    nullif(trim(substr(trim(persoon.name), length(split_part(trim(persoon.name), ' ', 1)) + 1)), ''));

  if voor is null then return null; end if;

  kandidaat := voor;
  if not exists (select 1 from public.profiles p
                  where lower(p.werk_email) = kandidaat || '@' || lower(domein)) then
    return kandidaat || '@' || domein;
  end if;

  if achter is not null then
    kandidaat := voor || '.' || achter;
    if not exists (select 1 from public.profiles p
                    where lower(p.werk_email) = kandidaat || '@' || lower(domein)) then
      return kandidaat || '@' || domein;
    end if;
  end if;

  /* Nog steeds bezet: een cijfer erachter. Boven de honderd houdt het op --
     dan is er iets anders aan de hand dan naamgenoten. */
  while nr <= 100 loop
    kandidaat := coalesce(voor || '.' || achter, voor) || nr::text;
    if not exists (select 1 from public.profiles p
                    where lower(p.werk_email) = kandidaat || '@' || lower(domein)) then
      return kandidaat || '@' || domein;
    end if;
    nr := nr + 1;
  end loop;

  return null;
end $$;

revoke execute on function public.werkadres_voorstel(text, text) from public, anon;
grant  execute on function public.werkadres_voorstel(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  Je eigen werkadres bepaal je niet zelf
--
--  De rem uit 0021 kent deze kolommen nog niet. Zonder dit kan een medewerker
--  zichzelf een ander adres geven -- of dat van een collega afpakken, want de
--  unieke index kijkt alleen of het vrij is en niet van wie het was.
--
--  Dit is dezelfde fout als in 0021 en 0023, voor de derde keer. Ze staan hier
--  daarom in dezelfde lijst en niet in een eigen trigger: één plek waar staat
--  wat er niet van jou is.
-- ---------------------------------------------------------------------------

create or replace function public.profiel_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null or public.is_management() then
    return new;
  end if;

  new.roles            := old.roles;
  new.grants           := old.grants;
  new.revokes          := old.revokes;
  new.active           := old.active;
  new.all_locations    := old.all_locations;
  new.manages          := old.manages;
  new.location_id      := old.location_id;
  new.company_id       := old.company_id;
  new.supervisor_id    := old.supervisor_id;
  new.personnel_number := old.personnel_number;
  new.job_title        := old.job_title;
  new.contract_hours   := old.contract_hours;
  new.start_date       := old.start_date;
  new.end_date         := old.end_date;
  new.hourly_rate      := old.hourly_rate;
  new.notes            := old.notes;
  new.email            := old.email;
  new.auth_id          := old.auth_id;
  new.archived_at      := old.archived_at;
  new.archived_by      := old.archived_by;
  new.archive_reason   := old.archive_reason;
  /* En het werkadres (0081). */
  new.werk_email       := old.werk_email;
  new.werk_mail_aan    := old.werk_mail_aan;
  new.werk_mail_sinds  := old.werk_mail_sinds;

  if new.must_change_password and not old.must_change_password then
    new.must_change_password := old.must_change_password;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
--  Het domein
--
--  Los van inkoop_domein. Dat is waar facturen binnenkomen en dat mag een
--  ander domein zijn dan waar mensen hun post op krijgen -- sterker nog, dat
--  is het nu ook (preview.truckwash.cloud).
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_werk_domein', 'werk_domein', '',
   'Het domein voor de werkadressen van medewerkers: voornaam@<dit>. Leeg '
   'betekent dat er geen werkadressen uitgedeeld kunnen worden. Het domein '
   'moet bij Resend geverifieerd zijn (SPF en DKIM), anders komt er niets aan '
   'en gaat er niets weg.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  Wat hier NIET verandert, en dat is met opzet
--
--  taken_voor_mail() (0070) leest p.email en blijft dat lezen. Dat is het
--  privéadres, en daar horen de meldingen heen te gaan -- anders staat de
--  uitnodiging voor een postvak in dat postvak.
--
--  Hetzelfde geldt voor nodig-uit en wachtwoord-vergeten: die gaan over
--  binnenkomen, en dan is een werkadres per definitie het verkeerde adres.
--
--  Dat staat hier opgeschreven omdat het anders lijkt of het vergeten is, en
--  omdat de verleiding groot is om het "netjes" te maken zodra de postvakken
--  werken. Zelftest 66 houdt het tegen.
-- ---------------------------------------------------------------------------
