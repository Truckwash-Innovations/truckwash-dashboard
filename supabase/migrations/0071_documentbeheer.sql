-- ===========================================================================
--  Documentbeheer
--
--  Casper: "Nu moet je ook documentbeheer in de app maken (...) Je moet
--  documenten@domein doen, als het daarnaartoe gestuurd wordt, dan moet het
--  daarin komen, in een algemene postvak, en dan kan iemand het bij iemand,
--  afdeling (locatie) ect zetten. Je moet dingen kunnen afschermen, zichtbaar
--  voor jezelf hebben (...) Ook een soort verkenner idee erin (...) deze
--  documenten moet je ook aan een todo kunnen neerhangen."
--
--  Wat er al was en waarom dit er los naast staat
--  ---------------------------------------------
--
--  Er staan al bestanden in dit systeem, maar allemaal met een eigenaar die
--  ze vasthoudt: een bijlage hangt aan een kostenpost (emmer "post"), een
--  contract aan een dossier (emmer "dossiers"), een foto aan een vestiging.
--  Dat is geen documentbeheer maar een bijlage bij iets anders -- je kunt er
--  niet doorheen bladeren, niets verplaatsen, en niets bewaren dat nergens
--  bij hoort.
--
--  Dit is de map waar een document zelf het onderwerp is.
--
--  Drie tabellen en een reden
--  --------------------------
--
--    doc_map       de verkenner: mappen in mappen
--    doc_bestand   het document zelf
--    doc_toegang   met wie het los is gedeeld
--
--  De toegang staat NIET als lijst in een kolom op het bestand. Dat zou
--  kunnen, maar dan kun je niet vragen "welke documenten zijn met mij
--  gedeeld" zonder elke rij te openen, en kun je er ook niet bij zetten wie
--  het deelde en wanneer. Bij een document dat is afgeschermd is dat precies
--  wat je later wilt weten.
--
--  Waarom er een emmer en een pad in de rij staan
--  ----------------------------------------------
--
--  Casper: "uiteindelijk eentje die ik kan integreren met een NAS".
--
--  Die NAS bouw ik nu niet. Maar de plek waar een bestand ligt staat daarom
--  wel als gegeven in de rij en niet als aanname in de code: opslag zegt
--  WAAR het ligt, emmer en pad zeggen waar precies. Een document dat straks
--  op de NAS staat is dan een rij met opslag = 'nas' en verder hetzelfde --
--  en niet een tweede tabel naast deze.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Wie mag er bij het documentbeheer
--
--  Dezelfde drie als bij het werk: leidinggevende, management, ontwikkelaar.
--  Daarnaast ziet iedereen wat persoonlijk bij hem is neergelegd of met hem
--  is gedeeld -- anders kun je een loonstrook wel bij iemand zetten maar ziet
--  hij hem nooit.
-- ---------------------------------------------------------------------------

create or replace function public.mag_documenten()
returns boolean language sql stable as $$
  select public.is_lead() or public.is_developer();
$$;

grant execute on function public.mag_documenten() to authenticated;

-- ---------------------------------------------------------------------------
--  De mappen
-- ---------------------------------------------------------------------------

create table if not exists public.doc_map (
  id          text primary key,
  naam        text not null,
  /* De verkenner. cascade bij verwijderen: een map weggooien haalt de mappen
     eronder mee. De bestanden niet -- die vallen terug naar het postvak, zie
     doc_bestand.map_id. Een document dat verdwijnt omdat iemand een map
     opruimde is precies wat niet mag. */
  ouder_id    text references public.doc_map(id) on delete cascade,

  /* Van welke vestiging. Null = van het hele bedrijf. */
  location_id text,

  /* Gevuld = een privémap; alleen deze persoon ziet hem en wat erin zit.
     Dat is de "zichtbaar voor jezelf" uit de opdracht. */
  eigenaar    text,

  volgorde    integer not null default 0,
  door        text,
  door_naam   text,
  created_at  bigint not null default public.now_ms(),
  updated_at  bigint not null default public.now_ms()
);

create index if not exists doc_map_ouder_idx on public.doc_map (ouder_id);
create index if not exists doc_map_loc_idx   on public.doc_map (location_id);

comment on table public.doc_map is
  'De mappenstructuur van het documentbeheer (0071). eigenaar gevuld = een '
  'privémap.';

-- ---------------------------------------------------------------------------
--  Het document
-- ---------------------------------------------------------------------------

create table if not exists public.doc_bestand (
  id           text primary key,
  naam         text not null,
  omschrijving text,

  /* Leeg = het algemene postvak. Daar komt binnen wat per mail arriveert, en
     daar blijft het tot iemand het ergens neerzet. */
  map_id       text references public.doc_map(id) on delete set null,

  /* Waar het bestand ligt. Zie de kop: dit staat als gegeven in de rij zodat
     een NAS later geen tweede tabel wordt. */
  opslag       text not null default 'supabase'
               check (opslag in ('supabase', 'nas')),
  emmer        text not null default 'documenten',
  pad          text not null,
  mime         text,
  grootte      bigint,

  bron         text not null default 'upload'
               check (bron in ('upload', 'mail', 'scan')),
  /* Bij bron = mail: het bericht waar hij uit kwam, zodat je van het document
     terug kunt naar de mail met de afzender erbij. */
  bron_id      text,

  /*
   * Wie het mag zien.
   *
   *   prive      alleen de eigenaar (en wie het los gedeeld heeft gekregen)
   *   personen   alleen wie in doc_toegang staat
   *   vestiging  iedereen met documentrechten op die vestiging
   *   rollen     iedereen met documentrechten in een van deze rollen
   *   iedereen   iedereen met documentrechten
   *
   * Standaard "vestiging" en niet "iedereen": een document hoort niet breder
   * te staan dan waar het over gaat, en de smalle stand is de stand die je
   * per ongeluk goed hebt.
   */
  zichtbaarheid text not null default 'vestiging'
                check (zichtbaarheid in ('prive', 'personen', 'vestiging', 'rollen', 'iedereen')),
  eigenaar     text,
  location_id  text,
  rollen       text[] not null default '{}',

  /* Bij wie het is neergelegd. Die ziet het altijd, ook zonder
     documentrechten -- anders kun je een contract wel bij iemand zetten maar
     krijgt hij het nooit te zien. */
  toegewezen_aan  text,
  toegewezen_naam text,

  door         text,
  door_naam    text,
  created_at   bigint not null default public.now_ms(),
  updated_at   bigint not null default public.now_ms()
);

create index if not exists doc_bestand_map_idx  on public.doc_bestand (map_id);
create index if not exists doc_bestand_loc_idx  on public.doc_bestand (location_id);
create index if not exists doc_bestand_wie_idx  on public.doc_bestand (toegewezen_aan);
create index if not exists doc_bestand_bron_idx on public.doc_bestand (bron, bron_id);

/* Eén document per bijlage uit één mail. Zonder dit maakt een mail die twee
   keer wordt aangeboden -- en dat gebeurt, webhooks worden opnieuw geprobeerd
   -- twee identieke rijen in het postvak. */
create unique index if not exists doc_bestand_uit_mail
  on public.doc_bestand (bron_id, pad) where bron = 'mail';

comment on table public.doc_bestand is
  'Documenten (0071). map_id leeg = het algemene postvak. Wie het mag zien '
  'staat in zichtbaarheid; mag_document() rekent het uit.';

-- ---------------------------------------------------------------------------
--  Los gedeeld
-- ---------------------------------------------------------------------------

create table if not exists public.doc_toegang (
  /* Een eigen id en niet document_id + profile_id als sleutel. Twee redenen,
     en de tweede is de zwaarste: de synchronisatie van de app vergelijkt elke
     tabel op één kolom die id heet, en een samengestelde sleutel komt daar
     nooit doorheen. De eerste is rij_bestaat() -- de uitweg uit de upsert-val
     (0044) zoekt op id. */
  id          text primary key,
  document_id text not null references public.doc_bestand(id) on delete cascade,
  profile_id  text not null,
  door        text,
  door_naam   text,
  created_at  bigint not null default public.now_ms(),
  updated_at  bigint not null default public.now_ms()
);

/* Twee keer dezelfde persoon bij hetzelfde document is geen tweede deling. */
create unique index if not exists doc_toegang_uniek
  on public.doc_toegang (document_id, profile_id);
create index if not exists doc_toegang_wie_idx on public.doc_toegang (profile_id);

comment on table public.doc_toegang is
  'Met wie een afgeschermd document los is gedeeld (0071), met wie het deelde '
  'en wanneer -- juist bij een afgeschermd document is dat wat je later wilt '
  'weten.';

-- ---------------------------------------------------------------------------
--  Aan een taak hangen
--
--  Casper: "deze documenten moet je ook aan een todo kunnen neerhangen".
--
--  Een eigen tabel en geen kolom op de taak: aan één taak kunnen meer
--  documenten hangen, en hetzelfde document kan bij meer taken horen -- een
--  keuringsrapport hoort bij de reparatie én bij de jaarlijkse controle.
-- ---------------------------------------------------------------------------

create table if not exists public.taak_document (
  /* Zie doc_toegang hierboven voor waarom hier een eigen id staat. */
  id          text primary key,
  taak_id     text not null references public.taak(id) on delete cascade,
  document_id text not null references public.doc_bestand(id) on delete cascade,
  door        text,
  created_at  bigint not null default public.now_ms(),
  updated_at  bigint not null default public.now_ms()
);

create unique index if not exists taak_document_uniek
  on public.taak_document (taak_id, document_id);
create index if not exists taak_document_doc_idx on public.taak_document (document_id);

-- ---------------------------------------------------------------------------
--  Mag ik bij dit document?
--
--  Op één plek, want dit wordt op vier plekken gevraagd: bij het document
--  zelf, bij de losse deling, bij de koppeling aan een taak, en bij het
--  bestand in de opslag. Vier keer dezelfde regel overtypen is drie kansen om
--  hem net iets anders op te schrijven.
--
--  security definer omdat hij doc_bestand leest terwijl er juist een regel op
--  doc_bestand wordt beoordeeld.
-- ---------------------------------------------------------------------------

create or replace function public.mag_document(doc text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.doc_bestand b
     where b.id = doc
       and (
         /* Van mij, bij mij neergelegd, of met mij gedeeld. Deze drie gelden
            altijd -- ook zonder documentrechten, anders kun je een contract
            wel bij iemand zetten maar ziet hij het nooit. */
         b.eigenaar = public.my_id()
         or b.toegewezen_aan = public.my_id()
         or exists (select 1 from public.doc_toegang t
                     where t.document_id = b.id and t.profile_id = public.my_id())

         /* En de brede standen, alleen voor wie bij het documentbeheer mag. */
         or (public.mag_documenten() and (
               b.zichtbaarheid = 'iedereen'
               or (b.zichtbaarheid = 'rollen' and b.rollen && public.my_roles())
               or (b.zichtbaarheid = 'vestiging' and public.in_my_locations(b.location_id))
             ))
       )
  );
$$;

/* Supabase geeft een nieuwe functie standaard aan PUBLIC, en daarmee ook aan
   anon. Bij een security definer-functie die leest wie wat mag zien, is dat
   een open deur -- vandaar eerst intrekken en dan gericht uitdelen. */
revoke execute on function public.mag_document(text) from public, anon;
grant  execute on function public.mag_document(text) to authenticated;

-- ---------------------------------------------------------------------------
--  Wie mag hierbij
-- ---------------------------------------------------------------------------

alter table public.doc_map       enable row level security;
alter table public.doc_bestand   enable row level security;
alter table public.doc_toegang   enable row level security;
alter table public.taak_document enable row level security;

/* --- mappen --- */

drop policy if exists doc_map_select on public.doc_map;
create policy doc_map_select on public.doc_map
  for select to authenticated
  using (
    eigenaar = public.my_id()
    or (eigenaar is null and public.mag_documenten() and public.in_my_locations(location_id))
  );

drop policy if exists doc_map_insert on public.doc_map;
create policy doc_map_insert on public.doc_map
  for insert to authenticated
  /* rij_bestaat() vooraan om dezelfde reden als overal: een upsert langs
     PostgREST beoordeelt deze regel OOK bij een gewone wijziging. Zie 0044. */
  with check (public.rij_bestaat('public.doc_map'::regclass, id)
              or (public.mag_documenten()
                  and (eigenaar is null or eigenaar = public.my_id())
                  and public.in_my_locations(location_id)));

drop policy if exists doc_map_update on public.doc_map;
create policy doc_map_update on public.doc_map
  for update to authenticated
  using (eigenaar = public.my_id()
         or (eigenaar is null and public.mag_documenten() and public.in_my_locations(location_id)))
  with check (eigenaar = public.my_id()
              or (eigenaar is null and public.mag_documenten() and public.in_my_locations(location_id)));

/* Een map weggooien haalt de mappen eronder mee (cascade) maar de bestanden
   niet: die vallen terug naar het postvak. Daarom mag dit alleen wie de map
   ook mocht maken. */
drop policy if exists doc_map_delete on public.doc_map;
create policy doc_map_delete on public.doc_map
  for delete to authenticated
  using (eigenaar = public.my_id()
         or (eigenaar is null and public.mag_documenten() and public.in_my_locations(location_id)));

/* --- documenten --- */

drop policy if exists doc_bestand_select on public.doc_bestand;
create policy doc_bestand_select on public.doc_bestand
  for select to authenticated using (public.mag_document(id));

drop policy if exists doc_bestand_insert on public.doc_bestand;
create policy doc_bestand_insert on public.doc_bestand
  for insert to authenticated
  with check (public.rij_bestaat('public.doc_bestand'::regclass, id)
              or (public.mag_documenten() and public.in_my_locations(location_id)));

drop policy if exists doc_bestand_update on public.doc_bestand;
create policy doc_bestand_update on public.doc_bestand
  for update to authenticated
  using (public.mag_documenten() and public.mag_document(id))
  with check (public.mag_documenten() and public.in_my_locations(location_id));

/* Wissen doet alleen wie er ook bij mag, en het bestand in de opslag gaat
   apart -- die twee kunnen niet in één handeling, dus de app ruimt op. */
drop policy if exists doc_bestand_delete on public.doc_bestand;
create policy doc_bestand_delete on public.doc_bestand
  for delete to authenticated
  using (public.mag_documenten() and public.mag_document(id));

/* --- delingen --- */

drop policy if exists doc_toegang_select on public.doc_toegang;
create policy doc_toegang_select on public.doc_toegang
  for select to authenticated
  using (profile_id = public.my_id() or public.mag_document(document_id));

drop policy if exists doc_toegang_insert on public.doc_toegang;
create policy doc_toegang_insert on public.doc_toegang
  for insert to authenticated
  with check (public.rij_bestaat('public.doc_toegang'::regclass, id)
              or (public.mag_documenten() and public.mag_document(document_id)));

drop policy if exists doc_toegang_delete on public.doc_toegang;
create policy doc_toegang_delete on public.doc_toegang
  for delete to authenticated
  using (public.mag_documenten() and public.mag_document(document_id));

/* --- aan een taak --- */

drop policy if exists taak_document_select on public.taak_document;
create policy taak_document_select on public.taak_document
  for select to authenticated using (public.mag_document(document_id));

drop policy if exists taak_document_insert on public.taak_document;
create policy taak_document_insert on public.taak_document
  for insert to authenticated
  with check (public.rij_bestaat('public.taak_document'::regclass, id)
              or (public.mag_document(document_id)
                  and exists (select 1 from public.taak t where t.id = taak_id)));

drop policy if exists taak_document_delete on public.taak_document;
create policy taak_document_delete on public.taak_document
  for delete to authenticated using (public.mag_document(document_id));

-- ---------------------------------------------------------------------------
--  De emmer
--
--  Dicht, net als "dossiers" en "post". Downloaden gaat met een ondertekende
--  link van zestig seconden; er is geen openbaar adres.
--
--  De leesregel hangt aan mag_document(), zodat de afscherming niet te
--  omzeilen is door het bestand rechtstreeks op te vragen. Dat is precies de
--  fout die een documentsysteem onbruikbaar maakt: de lijst verbergt iets wat
--  de opslag gewoon uitdeelt.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documenten', 'documenten', false, 52428800,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]
)
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists documenten_lezen on storage.objects;
create policy documenten_lezen on storage.objects for select to authenticated
  using (
    bucket_id = 'documenten'
    and exists (
      select 1 from public.doc_bestand b
       where b.pad = storage.objects.name
         and b.emmer = 'documenten'
         and public.mag_document(b.id)
    )
  );

/* Neerzetten mag wie bij het documentbeheer mag. De rij ernaast wordt door de
   app in dezelfde handeling gemaakt; komt die er niet, dan ligt er een
   bestand dat niemand kan lezen (de leesregel hierboven vindt geen rij) en
   dat de opruiming hieronder weghaalt. */
drop policy if exists documenten_schrijven on storage.objects;
create policy documenten_schrijven on storage.objects for insert to authenticated
  with check (bucket_id = 'documenten' and public.mag_documenten());

drop policy if exists documenten_wissen on storage.objects;
create policy documenten_wissen on storage.objects for delete to authenticated
  using (
    bucket_id = 'documenten'
    and public.mag_documenten()
    and (
      /* Het bestand van een document dat ik mag beheren, of een bestand
         waar geen rij (meer) bij hoort -- dat laatste is een halve upload en
         die hoort opgeruimd te kunnen worden. */
      exists (select 1 from public.doc_bestand b
               where b.pad = storage.objects.name and b.emmer = 'documenten'
                 and public.mag_document(b.id))
      or not exists (select 1 from public.doc_bestand b
                      where b.pad = storage.objects.name and b.emmer = 'documenten')
    )
  );

-- ---------------------------------------------------------------------------
--  En de emmer waar de post al in ligt
--
--  Een bijlage die per mail binnenkomt blijft staan waar hij staat: in de
--  emmer "post". Hem overzetten naar "documenten" zou hetzelfde bestand twee
--  keer opslaan, en de rij zegt al waar hij ligt (emmer + pad).
--
--  Maar de leesregel op die emmer (0011) laat alleen management en
--  ontwikkelaar toe. Een leidinggevende zou een document in het postvak dus
--  wél zien staan en het niet kunnen openen -- een lijst die iets toont wat
--  de opslag weigert, en dat is precies het soort fout waarvan je denkt dat
--  het aan je verbinding ligt.
--
--  Vandaar deze regel erbij. De oude voorwaarde blijft ongewijzigd staan; er
--  komt alleen een tweede weg naast: er hangt een document aan dit bestand en
--  je mag bij dat document.
-- ---------------------------------------------------------------------------

drop policy if exists post_lezen on storage.objects;
create policy post_lezen on storage.objects for select to authenticated
  using (
    bucket_id = 'post'
    and (
      public.is_management() or public.is_developer()
      or exists (
        select 1 from public.doc_bestand b
         where b.pad = storage.objects.name
           and b.emmer = 'post'
           and public.mag_document(b.id)
      )
    )
  );

-- ---------------------------------------------------------------------------
--  Het adres waar documenten binnenkomen
--
--  Casper: "Je moet documenten@domein doen".
--
--  Als instelling en niet in de code: het domein staat al als
--  inkoop_domein en het voorvoegsel hoort daar naast te kunnen staan zonder
--  dat er een versie voor uit hoeft.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_documenten_voorvoegsel', 'documenten_voorvoegsel', 'documenten',
   'Het postvak waar documenten binnenkomen, vóór de @. Post aan dit adres '
   'wordt geen kostenpost maar belandt in het algemene postvak van het '
   'documentbeheer. Leeg laten zet het uit.')
on conflict (id) do nothing;
