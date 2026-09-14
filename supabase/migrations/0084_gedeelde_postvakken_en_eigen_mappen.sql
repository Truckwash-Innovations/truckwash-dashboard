-- ===========================================================================
--  Gedeelde postvakken, en eigen mappen om in te sorteren
--
--  Casper: "kan je gedeeltelijke postvakken erin zetten? en echt postvakken
--  kunnen maken ect, ook persoonlijke vakjes maken zodat je het beter kan
--  sorteren"
--
--  Drie dingen, en het eerste draait een keuze uit 0082 terug.
--
--  Wat 0082 zei, en waarom dat nu anders wordt
--  -------------------------------------------
--
--  Daar staat met zoveel woorden:
--
--      "Geen vrije mappen: vier vaste plekken is wat mensen werkelijk
--       gebruiken, en een mappenboom die iedereen zelf mag verzinnen is een
--       mappenboom waarin post zoekraakt."
--
--  Dat is een redenering over een POSTVAK VAN ÉÉN MENS, en daar klopt hij
--  ook: wie zijn eigen post in veertien mappen sorteert, zoekt hem daarna met
--  het zoekveld terug. Maar hij is hier gevraagd, en het argument dekt niet
--  wat er werkelijk speelt: dit is geen privépostvak meer zodra er een
--  info@ bij komt waar drie mensen in werken. Dan zijn mappen niet het
--  opbergen van je eigen rommel maar het verdelen van werk -- "afgehandeld",
--  "wacht op de klant", "voor Milos". En dat kan het zoekveld niet.
--
--  Dus komen ze er, met één rem die uit die oude redenering overblijft: de
--  vaste mappen (Postvak IN, Verzonden, Concepten, Archief, Prullenbak)
--  blijven staan en zijn niet te wijzigen of weg te gooien. Een eigen map
--  komt erbij, nooit in de plaats.
--
--  Een gedeeld postvak is iets anders dan een persoonlijk postvak
--  --------------------------------------------------------------
--
--  0082 zet er een streep onder: de post van een medewerker is van hem, en er
--  staat geen enkele regel in die het management toegang geeft. Dat blijft
--  precies zo. Een gedeeld postvak is geen uitzondering daarop maar een ander
--  ding: het hangt niet aan een mens maar aan een adres, en wie erbij mag
--  staat er met naam bij. info@truckwash1group.nl is van het bedrijf; jan@ is
--  van Jan.
--
--  Dat verschil staat in de rij zelf. Een bericht heeft OF een user_id (van
--  een mens) OF een postbus_id (van een gedeeld adres), nooit allebei en
--  nooit geen van beide.
--
--  Wat er met opzet NIET in zit
--  ----------------------------
--
--  Regels die post vanzelf in een map schuiven. Dat is de volgende vraag en
--  een eigen klus: een regel die verkeerd staat verstopt post zonder dat
--  iemand het merkt, en dat is erger dan ongesorteerde post. Eerst mappen die
--  je zelf vult.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Een gedeeld postvak
-- ---------------------------------------------------------------------------

create table if not exists public.postbus (
  id         text primary key,
  /* Het adres. Uniek en in kleine letters: "Info@" en "info@" zijn hetzelfde
     postvak, en twee rijen voor één adres betekent dat het maar net is welke
     de post aanneemt. */
  adres      text not null,
  naam       text not null default '',
  omschrijving text,
  /* Uit betekent: het adres blijft bezet maar er komt en gaat niets. Zelfde
     gedachte als bij een persoonlijk postvak (0081): een adres dat je vrij
     geeft is een adres waar de post van gisteren bij de verkeerde belandt. */
  actief     boolean not null default true,
  door       text,
  door_naam  text,
  created_at bigint not null default public.now_ms(),
  updated_at bigint not null default public.now_ms()
);

create unique index if not exists postbus_adres_uniek
  on public.postbus (lower(adres));

comment on table public.postbus is
  'Een gedeeld postvak: info@, verkoop@ (0084). Hangt aan een adres en niet '
  'aan een mens; wie erbij mag staat in postbus_lid.';

/*
 * Wie erbij mag.
 *
 * Een eigen id en niet (postbus_id, user_id) als sleutel -- zelfde reden als
 * bij doc_toegang (0071): de synchronisatie van de app vergelijkt elke tabel
 * op één kolom die id heet, en rij_bestaat() zoekt op id.
 */
create table if not exists public.postbus_lid (
  id         text primary key,
  postbus_id text not null references public.postbus(id) on delete cascade,
  user_id    text not null references public.profiles(id) on delete cascade,
  /* Mag deze persoon ook namens dit adres VERSTUREN? Lezen en versturen zijn
     niet hetzelfde: een stagiair mag meekijken in info@ zonder dat hij
     namens het bedrijf kan antwoorden. */
  mag_sturen boolean not null default true,
  door       text,
  created_at bigint not null default public.now_ms(),
  updated_at bigint not null default public.now_ms()
);

create unique index if not exists postbus_lid_uniek
  on public.postbus_lid (postbus_id, user_id);
create index if not exists postbus_lid_wie_idx on public.postbus_lid (user_id);

-- ---------------------------------------------------------------------------
--  2. Een bericht hoort bij een mens OF bij een gedeeld postvak
-- ---------------------------------------------------------------------------

alter table public.werkmail add column if not exists postbus_id text
  references public.postbus(id) on delete cascade;

/* user_id was verplicht. Dat kan niet blijven: een bericht in info@ is van
   niemand in het bijzonder. */
alter table public.werkmail alter column user_id drop not null;

create index if not exists werkmail_postbus_idx
  on public.werkmail (postbus_id, map, at desc) where postbus_id is not null;

/*
 * Precies één van de twee.
 *
 * Geen van beide zou een bericht opleveren dat niemand ooit ziet -- en dat is
 * geen theoretisch geval: de RLS hieronder laat zo'n rij aan niemand zien, en
 * dan staat er post in de database die nergens meer opduikt.
 *
 * NOT VALID, zodat het draaien op een bestaande database niet struikelt over
 * een rij die er al staat. Voor alles wat er vanaf nu in gaat geldt hij wel,
 * en dat is waar het om gaat.
 */
do $$
begin
  alter table public.werkmail drop constraint if exists werkmail_een_eigenaar;
  alter table public.werkmail add constraint werkmail_een_eigenaar
    check ((user_id is not null) <> (postbus_id is not null)) not valid;
exception when others then
  raise notice 'eigenaarscontrole niet gezet: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
--  3. Eigen mappen
--
--  Een map hoort bij een mens of bij een gedeeld postvak -- dezelfde
--  tweedeling als bij de post zelf, en om dezelfde reden.
-- ---------------------------------------------------------------------------

create table if not exists public.werkmail_map (
  id         text primary key,
  user_id    text references public.profiles(id) on delete cascade,
  postbus_id text references public.postbus(id) on delete cascade,
  naam       text not null,
  volgorde   integer not null default 0,
  created_at bigint not null default public.now_ms(),
  updated_at bigint not null default public.now_ms()
);

create index if not exists werkmail_map_wie_idx on public.werkmail_map (user_id);
create index if not exists werkmail_map_vak_idx on public.werkmail_map (postbus_id);

do $$
begin
  alter table public.werkmail_map drop constraint if exists werkmail_map_een_eigenaar;
  alter table public.werkmail_map add constraint werkmail_map_een_eigenaar
    check ((user_id is not null) <> (postbus_id is not null)) not valid;
exception when others then
  raise notice 'mapeigenaarscontrole niet gezet: %', sqlerrm;
end $$;

/* Twee mappen met dezelfde naam in hetzelfde postvak is er één te veel: dan
   sleep je post in "Facturen" en weet je niet in welke. */
create unique index if not exists werkmail_map_naam_uniek
  on public.werkmail_map (coalesce(user_id, postbus_id), lower(naam));

/*
 * En waar een bericht staat.
 *
 * Leeg = in de vaste map uit de kolom `map`. Gevuld = in die eigen map. De
 * kolom `map` blijft staan en verandert niet mee: haal je het bericht uit de
 * eigen map, dan is het weer waar het vandaan kwam in plaats van nergens.
 *
 * on delete set null: een map weggooien mag, en dan valt de post terug naar
 * Postvak IN. Post die verdwijnt omdat iemand een map opruimde is precies wat
 * niet mag -- dezelfde afspraak als bij de documentmappen (0071).
 */
alter table public.werkmail add column if not exists map_id text
  references public.werkmail_map(id) on delete set null;

create index if not exists werkmail_map_id_idx on public.werkmail (map_id)
  where map_id is not null;

comment on column public.werkmail.map_id is
  'In welke eigen map dit bericht staat (0084). Leeg = in de vaste map uit de '
  'kolom map. Die kolom verandert niet mee, zodat het bericht bij het '
  'weghalen uit een map terugvalt op waar het vandaan kwam.';

-- ---------------------------------------------------------------------------
--  4. Mag ik bij dit gedeelde postvak?
--
--  Als functie, en security definer. Zonder dat zou de regel op werkmail de
--  tabel postbus_lid moeten lezen terwijl daar zelf ook een regel op staat,
--  en dan draait het in een kringetje.
--
--  Twee functies, want lezen en versturen zijn niet hetzelfde: wie meekijkt
--  in info@ hoeft nog niet namens het bedrijf te kunnen antwoorden.
-- ---------------------------------------------------------------------------

create or replace function public.mag_postbus(vak text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.postbus_lid l
      join public.postbus p on p.id = l.postbus_id
     where l.postbus_id = vak
       and l.user_id = public.my_id()
       and p.actief
  );
$$;

create or replace function public.mag_postbus_sturen(vak text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.postbus_lid l
      join public.postbus p on p.id = l.postbus_id
     where l.postbus_id = vak
       and l.user_id = public.my_id()
       and l.mag_sturen
       and p.actief
  );
$$;

revoke execute on function public.mag_postbus(text) from public, anon;
revoke execute on function public.mag_postbus_sturen(text) from public, anon;
grant  execute on function public.mag_postbus(text) to authenticated, service_role;
grant  execute on function public.mag_postbus_sturen(text) to authenticated, service_role;

/** Welk gedeeld postvak hoort bij dit adres? Leeg als het er geen is. */
create or replace function public.postbus_van(adres text)
returns text language sql stable security definer set search_path = public as $$
  select p.id from public.postbus p
   where lower(p.adres) = lower(trim(coalesce(adres, '')))
     and p.actief
   limit 1;
$$;

revoke execute on function public.postbus_van(text) from public, anon;
grant  execute on function public.postbus_van(text) to service_role;

-- ---------------------------------------------------------------------------
--  5. De post: wie ziet wat
--
--  De regel van 0082 blijft woordelijk staan -- je eigen post is van jou --
--  en er komt één tak bij: de post van een gedeeld postvak waar je lid van
--  bent. Er komt nog steeds geen regel voor het management: wie in info@ wil
--  kijken, zet zichzelf erbij als lid, en dan staat dat ergens opgeschreven.
-- ---------------------------------------------------------------------------

drop policy if exists werkmail_select on public.werkmail;
create policy werkmail_select on public.werkmail for select to authenticated
  using (
    user_id = public.my_id()
    or (postbus_id is not null and public.mag_postbus(postbus_id))
  );

drop policy if exists werkmail_insert on public.werkmail;
create policy werkmail_insert on public.werkmail for insert to authenticated
  with check (
    /* rij_bestaat() vooraan: de app stuurt een gewijzigde rij als geheel op,
       en PostgREST beoordeelt die upsert óók tegen de insertregel. Zie 0031
       en 0040. */
    public.rij_bestaat('public.werkmail'::regclass, id)
    or user_id = public.my_id()
    or (postbus_id is not null and public.mag_postbus(postbus_id))
  );

drop policy if exists werkmail_update on public.werkmail;
create policy werkmail_update on public.werkmail for update to authenticated
  using (
    user_id = public.my_id()
    or (postbus_id is not null and public.mag_postbus(postbus_id))
  )
  with check (
    user_id = public.my_id()
    or (postbus_id is not null and public.mag_postbus(postbus_id))
  );

drop policy if exists werkmail_delete on public.werkmail;
create policy werkmail_delete on public.werkmail for delete to authenticated
  using (
    user_id = public.my_id()
    or (postbus_id is not null and public.mag_postbus(postbus_id))
  );

/*
 * En de rem op wat je mag wijzigen kent de twee nieuwe kolommen.
 *
 * Zonder dit kan iemand een bericht uit info@ naar zijn eigen postvak
 * verhuizen door user_id te zetten -- en dan is het weg uit het gedeelde
 * postvak zonder dat de anderen weten waarheen. Verplaatsen tussen mappen mag
 * wél; dat is waar de mappen voor zijn.
 */
create or replace function public.werkmail_bewaak()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /* De server (ontvangen en versturen) heeft geen my_id() en mag alles. */
  if public.my_id() is null then return new; end if;

  /* In welk postvak een bericht hangt, verandert nooit vanuit de app. */
  new.user_id     := old.user_id;
  new.postbus_id  := old.postbus_id;

  if old.map = 'concept' then return new; end if;

  new.van         := old.van;
  new.van_naam    := old.van_naam;
  new.aan         := old.aan;
  new.cc          := old.cc;
  new.onderwerp   := old.onderwerp;
  new.tekst       := old.tekst;
  new.bijlagen    := old.bijlagen;
  new.at          := old.at;
  new.richting    := old.richting;
  new.draad       := old.draad;
  new.bericht_id  := old.bericht_id;
  new.provider_id := old.provider_id;
  return new;
end $$;

/*
 * En een bericht hoort niet in de map van een ander postvak te kunnen.
 *
 * Zonder deze controle kan iemand zijn eigen bericht in een map van info@
 * zetten; het verdwijnt dan uit zijn eigen lijst en duikt op bij de anderen,
 * die er verder niets van weten. De database is hier de enige die het kan
 * zien -- het scherm toont alleen je eigen mappen en komt er dus nooit achter.
 */
create or replace function public.werkmail_map_klopt()
returns trigger language plpgsql security definer set search_path = public as $$
declare hoort text;
begin
  if new.map_id is null then return new; end if;

  select coalesce(m.user_id, m.postbus_id) into hoort
    from public.werkmail_map m where m.id = new.map_id;

  if hoort is distinct from coalesce(new.user_id, new.postbus_id) then
    raise exception 'Die map hoort bij een ander postvak.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists werkmail_map_klopt_trg on public.werkmail;
create trigger werkmail_map_klopt_trg
  before insert or update of map_id on public.werkmail
  for each row execute function public.werkmail_map_klopt();

-- ---------------------------------------------------------------------------
--  6. De mappen: wie ziet wat
-- ---------------------------------------------------------------------------

alter table public.werkmail_map enable row level security;

drop policy if exists werkmail_map_select on public.werkmail_map;
create policy werkmail_map_select on public.werkmail_map for select to authenticated
  using (
    user_id = public.my_id()
    or (postbus_id is not null and public.mag_postbus(postbus_id))
  );

drop policy if exists werkmail_map_insert on public.werkmail_map;
create policy werkmail_map_insert on public.werkmail_map for insert to authenticated
  with check (
    public.rij_bestaat('public.werkmail_map'::regclass, id)
    or user_id = public.my_id()
    or (postbus_id is not null and public.mag_postbus(postbus_id))
  );

drop policy if exists werkmail_map_update on public.werkmail_map;
create policy werkmail_map_update on public.werkmail_map for update to authenticated
  using (
    user_id = public.my_id()
    or (postbus_id is not null and public.mag_postbus(postbus_id))
  )
  with check (
    user_id = public.my_id()
    or (postbus_id is not null and public.mag_postbus(postbus_id))
  );

drop policy if exists werkmail_map_delete on public.werkmail_map;
create policy werkmail_map_delete on public.werkmail_map for delete to authenticated
  using (
    user_id = public.my_id()
    or (postbus_id is not null and public.mag_postbus(postbus_id))
  );

-- ---------------------------------------------------------------------------
--  7. De gedeelde postvakken zelf: aanmaken is management
--
--  Een adres uitdelen is hetzelfde soort besluit als een werkadres uitdelen
--  (0081): het komt op briefpapier terecht. Lezen mag ruimer -- wie lid is
--  moet kunnen zien hoe zijn eigen postvak heet.
-- ---------------------------------------------------------------------------

alter table public.postbus     enable row level security;
alter table public.postbus_lid enable row level security;

drop policy if exists postbus_select on public.postbus;
create policy postbus_select on public.postbus for select to authenticated
  using (public.is_management() or public.mag_postbus(id));

drop policy if exists postbus_insert on public.postbus;
create policy postbus_insert on public.postbus for insert to authenticated
  with check (
    public.rij_bestaat('public.postbus'::regclass, id)
    or public.is_management()
  );

drop policy if exists postbus_update on public.postbus;
create policy postbus_update on public.postbus for update to authenticated
  using (public.is_management()) with check (public.is_management());

/*
 * Weggooien kan niet, ook niet door het management.
 *
 * Er hangt post aan, en die gaat met "on delete cascade" mee. Een postvak dat
 * je niet meer gebruikt zet je op inactief; dan blijft het adres bezet en
 * blijft de post staan. Hetzelfde als bij een sollicitatie (0068) en om
 * dezelfde reden: "weg" is hier hetzelfde als "kwijt".
 */

drop policy if exists postbus_lid_select on public.postbus_lid;
create policy postbus_lid_select on public.postbus_lid for select to authenticated
  using (public.is_management() or user_id = public.my_id()
         or public.mag_postbus(postbus_id));

drop policy if exists postbus_lid_write on public.postbus_lid;
create policy postbus_lid_write on public.postbus_lid for all to authenticated
  using (public.is_management()) with check (public.is_management());

-- ---------------------------------------------------------------------------
--  8. De bijlagen van een gedeeld postvak
--
--  Het pad begint met het id van het postvak waar het bericht in hangt -- bij
--  een mens zijn user_id, bij een gedeeld postvak het postbus_id. De
--  leesregel van 0082 keek alleen naar het eerste; zonder deze verruiming zie
--  je in info@ wel de naam van de bijlage staan en gaat er niets open.
-- ---------------------------------------------------------------------------

drop policy if exists werkmail_bijlage_lezen on storage.objects;
create policy werkmail_bijlage_lezen on storage.objects for select to authenticated
  using (
    bucket_id = 'werkmail'
    and (
      split_part(name, '/', 1) = public.my_id()
      or public.mag_postbus(split_part(name, '/', 1))
    )
  );

drop policy if exists werkmail_bijlage_schrijven on storage.objects;
create policy werkmail_bijlage_schrijven on storage.objects for insert to authenticated
  with check (
    bucket_id = 'werkmail'
    and (
      split_part(name, '/', 1) = public.my_id()
      or public.mag_postbus_sturen(split_part(name, '/', 1))
    )
  );

drop policy if exists werkmail_bijlage_wissen on storage.objects;
create policy werkmail_bijlage_wissen on storage.objects for delete to authenticated
  using (
    bucket_id = 'werkmail'
    and (
      split_part(name, '/', 1) = public.my_id()
      or public.mag_postbus(split_part(name, '/', 1))
    )
  );

-- ---------------------------------------------------------------------------
--  9. De draad kijkt naar het postvak en niet naar de persoon
--
--  werkmail_draad() (0082) zocht op user_id. In een gedeeld postvak staat
--  daar niets, en dan valt elk antwoord buiten zijn eigen gesprek -- precies
--  waar een gedeeld postvak het meest last van heeft, want daar is het
--  gesprek het werk.
--
--  De rest van de functie is woordelijk 0082.
-- ---------------------------------------------------------------------------

create or replace function public.werkmail_draad(
  eigenaar text,
  onderwerp_in text,
  antwoord_op_in text
)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    /* 1. het bericht waarop dit een antwoord is */
    (select m.draad from public.werkmail m
      where coalesce(m.user_id, m.postbus_id) = eigenaar
        and m.bericht_id is not null
        and m.bericht_id = antwoord_op_in
      limit 1),
    /* 2. hetzelfde onderwerp, ontdaan van Re: en Fwd: */
    nullif(lower(trim(regexp_replace(
      coalesce(onderwerp_in, ''), '^((re|fw|fwd|antw)\s*(\[[0-9]+\])?\s*:\s*)+', '', 'i'))), ''),
    /* 3. geen onderwerp: dan staat hij op zichzelf */
    'los-' || md5(random()::text)
  );
$$;

revoke execute on function public.werkmail_draad(text, text, text) from public, anon;
grant  execute on function public.werkmail_draad(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
--  10. Tijdstempels en verwijderingen
--
--  Zelfde twee triggers als op elke gesynchroniseerde tabel: de server zet
--  updated_at (0001), en een verwijdering meldt zichzelf (0038). Zonder die
--  tweede houdt elk toestel een weggegooide map die er niet meer is, en
--  blijft hij in de lijst staan tot iemand alles opnieuw ophaalt.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['postbus', 'postbus_lid', 'werkmail_map'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);

    execute format('drop trigger if exists %1$s_verwijderd on public.%1$I', t);
    execute format(
      'create trigger %1$s_verwijderd after delete on public.%1$I
       for each row execute function public.meld_verwijdering()', t);
  end loop;
end $$;
