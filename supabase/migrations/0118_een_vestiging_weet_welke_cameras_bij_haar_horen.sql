-- ===========================================================================
--  Een vestiging weet welke camera's bij haar horen
--
--  Draai dit ná 0117. Opnieuw draaien mag.
--
--  Casper: "zorg dat het gemakkelijk is in te loggen als je de rechten hebt"
--  en "zorg dat iemand enkel bij eigen camera komt als degene vast op
--  vestiging staat."
--
--  Wat er stond
--  ------------
--
--  Aan de camerakant staat een portaal (camera.truckwash-workspace.com) met
--  precies één gebruikersnaam en één wachtwoord voor alles. Geen gebruikers,
--  geen rollen, geen vestigingen: wie binnen is, ziet elke camera van elke
--  vestiging. Dat is het gat dat deze migratie en wat eromheen gebouwd wordt
--  moeten dichten.
--
--  Waarom er eerst een sleutel moet zijn
--  ------------------------------------
--
--  De twee systemen hebben niets gemeenschappelijks. Een vestiging heet hier
--  loc_venlo; diezelfde installatie noemt zichzelf aan de camerakant
--  a3f91c2b04de -- een uuid die bij de eerste start wordt verzonnen
--  (config.py: uuid.uuid4().hex[:12]). Er valt dus niets te matchen op naam,
--  en dat is maar goed ook: een koppeling die op namen gokt, geeft vroeg of
--  laat iemand toegang tot de verkeerde vestiging.
--
--  Dus wordt het opgeschreven, hier, per vestiging. Eén keer overtikken uit
--  het portaal, en daarna weet het dashboard welke camera's bij welke
--  vestiging horen -- en kan het bepalen wie daar bij mag.
--
--  Waarom in het DASHBOARD en niet in het portaal
--  ----------------------------------------------
--
--  Omdat hier de vestigingen staan, de mensen, de rollen en de rechten. Het
--  portaal hoeft daar niets van te weten: het krijgt straks een ondertekend
--  briefje mee waarin staat welke installaties deze persoon mag zien, en
--  kijkt alleen of de installatie die hij opvraagt in dat lijstje staat.
--
--  Dat is met opzet de domme kant. Alles wat het portaal zelf zou moeten
--  weten over wie waar werkt, is iets wat op twee plekken bijgehouden moet
--  worden -- en dat loopt uit elkaar.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Welke camera-installatie bij deze vestiging hoort
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists camera_site_id text;

comment on column public.locations.camera_site_id is
  'Het site_id van de camera-installatie op deze vestiging (0118). Over te '
  'tikken uit het camerportaal; daar verzint elke installatie er bij de '
  'eerste start zelf een. Leeg betekent: deze vestiging heeft geen camera''s '
  'in het portaal, en niemand komt er via het dashboard binnen.';

/*
 * Eén installatie hoort bij één vestiging.
 *
 * Zonder dit kan dezelfde site_id bij twee vestigingen staan, en dan geeft
 * een koppeling aan de ene vestiging stilletjes toegang tot de camera's van
 * de andere. Precies het gat dat hier dichtgaat.
 */
create unique index if not exists locations_camera_site_uniek
  on public.locations (camera_site_id)
  where camera_site_id is not null;

-- ---------------------------------------------------------------------------
--  2. Mag deze persoon alle vestigingen zien?
--
--  sees_all_locations() beantwoordt die vraag al, maar alleen over DEGENE DIE
--  BELT -- hij leest profiles waar auth_id = auth.uid(). De serverfunctie die
--  het briefje ondertekent werkt met de servicesleutel en heeft dus geen
--  auth.uid(); die moet het over iemand anders kunnen vragen.
--
--  Woordelijk dezelfde regel als 0078, inclusief het stuk dat daar met zoveel
--  woorden is opgeschreven: een INTREKKING wint van alles. Dit is de deur
--  naar alle negentien vestigingen; zet iemand hem dicht bij een persoon, dan
--  is hij dicht -- ook als die persoon het recht ooit los heeft gekregen en
--  ook als de vlag all_locations nog op zijn dossier staat.
-- ---------------------------------------------------------------------------

create or replace function public.mag_alle_vestigingen(wie text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select (
        coalesce(p.all_locations, false)
        or 'locations.all' = any(coalesce(p.grants, array[]::text[]))
        or exists (
             select 1 from public.rol_recht rr
              where rr.recht = 'locations.all'
                and rr.rol = any(coalesce(p.roles, array[]::text[]))
           )
      )
      and not ('locations.all' = any(coalesce(p.revokes, array[]::text[])))
      from public.profiles p
     where p.id = wie
  ), false);
$$;

revoke execute on function public.mag_alle_vestigingen(text) from public, anon;
grant  execute on function public.mag_alle_vestigingen(text) to authenticated, service_role;

comment on function public.mag_alle_vestigingen(text) is
  'Of deze persoon alle vestigingen mag zien (0118). Dezelfde regel als '
  'sees_all_locations(), maar over iemand anders -- die kijkt alleen naar '
  'degene die belt, en de serverfunctie heeft geen auth.uid().';

-- ---------------------------------------------------------------------------
--  3. Bij welke camera's mag deze persoon?
--
--  Dit is de lijst die straks in het ondertekende briefje komt.
--
--  De regel is die van Casper: wie niet overal mag komen, komt alleen bij de
--  vestiging waar hij vast staat -- plus de vestigingen waar hij leiding over
--  heeft, want dat is in dit systeem hetzelfde begrip (my_locations()).
--
--  En alleen vestigingen die AAN staan. Een vestiging die uit staat is een
--  vestiging waar niemand meer hoort te kijken; dat die camera's misschien
--  nog draaien maakt het eerder erger dan beter.
-- ---------------------------------------------------------------------------

create or replace function public.camera_sites_voor(wie text)
returns table (site_id text, location_id text, naam text)
language sql stable security definer set search_path = public as $$
  with mens as (
    select p.id,
           coalesce(p.location_id, '')            as eigen,
           coalesce(p.manages, array[]::text[])   as leidt,
           coalesce(p.active, false)              as actief,
           p.archived_at
      from public.profiles p
     where p.id = wie
  )
  select nullif(trim(l.camera_site_id), ''), l.id, l.name
    from public.locations l, mens m
   where l.active
     and nullif(trim(l.camera_site_id), '') is not null
     /* Uitgeschreven of op non-actief: dan niets. Een account dat niet meer
        in het dashboard komt, hoort ook niet meer bij de camera's te komen. */
     and m.actief
     and m.archived_at is null
     and (
       public.mag_alle_vestigingen(m.id)
       or l.id = m.eigen
       or l.id = any(m.leidt)
     )
   order by l.name;
$$;

revoke execute on function public.camera_sites_voor(text) from public, anon;
grant  execute on function public.camera_sites_voor(text) to authenticated, service_role;

comment on function public.camera_sites_voor(text) is
  'Bij welke camera-installaties deze persoon mag (0118): alle, of alleen die '
  'van zijn eigen vestiging en de vestigingen waar hij leiding over heeft. '
  'Dit is de lijst die in het ondertekende briefje naar het portaal gaat.';

-- ---------------------------------------------------------------------------
--  4. En wie mag er überhaupt naar de camera's kijken
--
--  Een eigen recht, want "mag bij de beelden" is iets anders dan "werkt hier".
--  Op een camerabeeld staan klanten, chauffeurs en collega's; dat is niet
--  iets waar iedereen met een inlog bij hoort te kunnen.
--
--  Via rol_recht (0072), zodat de database het net zo ziet als de app. De
--  drie rollen die het standaard krijgen staan ook in permissions.ts; wie het
--  bij iemand anders wil, deelt het los uit.
-- ---------------------------------------------------------------------------

insert into public.rol_recht (rol, recht, waarom) values
  ('management', 'camera.view',
   'Het kantoor kijkt mee op alle vestigingen; dat is waar de meldkamer voor is.'),
  ('developer', 'camera.view',
   'Meekijken en storingen opsporen kan niet zonder beeld.'),
  ('technician', 'camera.view',
   'De technische dienst kijkt of een installatie het nog doet.')
on conflict (rol, recht) do update set waarom = excluded.waarom;

-- ---------------------------------------------------------------------------
--  5. Wat er nog niet gekoppeld is
--
--  Voor het scherm: welke vestigingen nog geen camera-installatie hebben. Zo
--  lang die lijst niet leeg is, komt er op die vestigingen niemand binnen --
--  en dat hoort te blijken uit een lijst, niet uit een gebruiker die belt dat
--  het niet werkt.
-- ---------------------------------------------------------------------------

create or replace function public.vestigingen_zonder_camera()
returns table (location_id text, naam text, plaats text)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.city
    from public.locations l
   where l.active
     and l.kind = 'vestiging'
     and nullif(trim(l.camera_site_id), '') is null
     and (public.is_management() or public.heeft_recht('camera.view'))
   order by l.name;
$$;

revoke execute on function public.vestigingen_zonder_camera() from public, anon;
grant  execute on function public.vestigingen_zonder_camera() to authenticated, service_role;

comment on function public.vestigingen_zonder_camera() is
  'Vestigingen waar nog geen camera-installatie aan gekoppeld is (0118). '
  'Zolang die lijst niet leeg is, komt daar via het dashboard niemand binnen.';

-- ---------------------------------------------------------------------------
--  6. Waar het portaal staat
--
--  In de instellingen en niet in de code, om dezelfde reden als app_url
--  (0055) en site_url (0066): het adres is al een keer verhuisd en zal dat
--  weer doen. Casper vroeg er met zoveel woorden om -- "maak het makkelijk
--  aanpasbaar".
--
--  Het GEHEIM waarmee het toegangsbriefje wordt ondertekend staat hier met
--  opzet NIET bij. Deze tabel synchroniseert mee naar elke tablet en elke
--  telefoon; een geheim waarmee je je eigen toegangsbriefje kunt schrijven
--  hoort niet op het toestel van degene die dat briefje krijgt. Dat staat in
--  de omgeving van de serverfunctie, net als de Exact-sleutels sinds 0052:
--
--      supabase secrets set CAMPORTAL_SECRET=<hetzelfde als in het portaal>
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_camera_portaal_url', 'camera_portaal_url',
   'https://camera.truckwash-workspace.com',
   'Waar het camerportaal staat. Hier komt iemand terecht die vanuit het '
   'dashboard op de camera''s klikt. Leeg betekent dat die knop niets doet. '
   'Het geheim waarmee het toegangsbriefje wordt ondertekend staat NIET hier '
   'maar in de omgeving van de serverfunctie (CAMPORTAL_SECRET) -- deze tabel '
   'gaat mee naar elk toestel.')
on conflict (id) do nothing;
