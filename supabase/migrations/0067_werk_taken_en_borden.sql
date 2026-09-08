-- ===========================================================================
--  Werk: taken, projecten en een bord
--
--  Casper: "Ik wil voor leidinggevende, management en ontwikkelaar een
--  volledige workflow, met todo's, projectmanagement, kanban board ect."
--
--  Wat er nu is en waarom dat niet genoeg is
--  -----------------------------------------
--
--  Er staat van alles in de app dat om aandacht vraagt: een factuur die op
--  goedkeuring wacht, een storing, een wijzigingsverzoek, een aanmelding. Elk
--  daarvan heeft zijn eigen tabblad met zijn eigen tellertje. Wie 's ochtends
--  wil weten wat er op zijn bord ligt, moet acht schermen langs -- en wat er
--  niet in een van die acht past (een gesprek voeren, een monteur bellen, een
--  contract nakijken) staat nergens.
--
--  Vandaar één plek waar werk staat. Niet ter vervanging van die tabbladen:
--  een factuur blijft een factuur. Maar wel als de lijst waar je naar kijkt.
--
--  De keuzes
--  ---------
--
--  Vier kolommen, vast: te doen, bezig, wacht, klaar. Geen instelbare
--  kolommen per bord. Dat klinkt als een beperking maar is er een die je wilt:
--  zodra iedereen zijn eigen kolommen mag verzinnen, betekent "klaar" op het
--  ene bord iets anders dan op het andere, en dan kun je er niets meer over
--  zeggen. "Wacht" is er wel bij, want dat is de stand waarin het meeste werk
--  hier verkeert: je wacht op iemand anders.
--
--  Een taak hangt aan een persoon OF aan een rol. Dat tweede is nodig voor
--  werk dat uit het systeem zelf komt -- een nieuwe sollicitatie is niet van
--  Jan, hij is van "de leiding op deze vestiging". Wie hem oppakt, zet hem op
--  zijn naam. Zonder die tussenstand krijg je of een taak die aan niemand
--  hangt en dus door niemand gedaan wordt, of een willekeurig aangewezen
--  eigenaar die er niets van weet.
--
--  Een taak hangt aan een vestiging. Dat is wat de leiding uit elkaar houdt:
--  een leidinggevende van Venlo hoort het werk van Venlo te zien en niet dat
--  van Groenlo. Management en ontwikkelaar zien alles.
--
--  Projecten zijn groepen. Een bord is geen apart ding: het is de taken van
--  een project (of van alles) in vier kolommen.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Een project: een groep werk met een naam
-- ---------------------------------------------------------------------------

create table if not exists public.taak_project (
  id           text primary key,
  naam         text not null,
  omschrijving text,
  /* Een naam en geen hexcode: de app kent de huisstijlkleuren, deze tabel
     hoort daar niets van te weten. Wat hier staat en de app niet kent, valt
     terug op de merkkleur. */
  kleur        text not null default 'brand',
  /* Null = niet aan een vestiging gebonden; iedereen met toegang ziet hem. */
  location_id  text,
  archief      boolean not null default false,
  volgorde     integer not null default 0,
  door         text,
  door_naam    text,
  created_at   bigint not null default public.now_ms(),
  updated_at   bigint not null default public.now_ms()
);

create index if not exists taak_project_loc_idx on public.taak_project (location_id);

comment on table public.taak_project is
  'Een groep werk met een naam (0067). Een bord is de taken hiervan in vier '
  'kolommen; er is geen aparte bordtabel.';

-- ---------------------------------------------------------------------------
--  De taak
-- ---------------------------------------------------------------------------

create table if not exists public.taak (
  id           text primary key,
  titel        text not null,
  omschrijving text,

  /* Vier vaste kolommen. Zie de kop: instelbare kolommen maken "klaar"
     betekenisloos zodra er meer dan één bord is. */
  status       text not null default 'te_doen'
               check (status in ('te_doen', 'bezig', 'wacht', 'klaar')),
  prioriteit   text not null default 'normaal'
               check (prioriteit in ('laag', 'normaal', 'hoog', 'urgent')),

  project_id   text references public.taak_project(id) on delete set null,
  location_id  text,

  /* Aan een persoon, aan een rol, of aan geen van beide. Zie de kop: werk dat
     uit het systeem komt hoort eerst bij een rol en pas daarna bij iemand. */
  toegewezen_aan  text,
  toegewezen_naam text,
  toegewezen_rol  text
                  check (toegewezen_rol is null or toegewezen_rol in
                    ('supervisor', 'management', 'developer', 'administratie',
                     'technician', 'employee', 'trucksupply')),

  deadline     bigint,
  /* Plek binnen de kolom. Slepen op het bord verandert dit en niets anders. */
  volgorde     integer not null default 0,

  /* Waar deze taak vandaan komt. 'handmatig' is iemand die hem intikt; de
     rest komt uit het systeem, en dan wijst bron_id naar het ding zelf --
     zodat je vanaf de taak naar de sollicitatie of de factuur kunt springen
     en er niet twee keer een taak voor hetzelfde ontstaat. */
  bron         text not null default 'handmatig'
               check (bron in ('handmatig', 'sollicitatie', 'factuur',
                               'storing', 'wijziging', 'aanmelding')),
  bron_id      text,

  klaar_at        bigint,
  klaar_door      text,
  klaar_door_naam text,

  door         text,
  door_naam    text,
  created_at   bigint not null default public.now_ms(),
  updated_at   bigint not null default public.now_ms()
);

create index if not exists taak_status_idx  on public.taak (status, volgorde);
create index if not exists taak_loc_idx     on public.taak (location_id);
create index if not exists taak_wie_idx     on public.taak (toegewezen_aan);
create index if not exists taak_rol_idx     on public.taak (toegewezen_rol);
create index if not exists taak_project_idx on public.taak (project_id);

/* Eén taak per ding dat uit het systeem komt. Zonder deze index maakt een
   tweede sync, een herstart of een dubbele trigger een tweede taak voor
   dezelfde sollicitatie -- en dan staat er twee keer hetzelfde op het bord
   zonder dat iemand weet welke de echte is. Handmatige taken vallen erbuiten:
   die mogen best twee keer hetzelfde heten. */
create unique index if not exists taak_bron_uniek
  on public.taak (bron, bron_id, coalesce(toegewezen_aan, ''), coalesce(toegewezen_rol, ''))
  where bron <> 'handmatig' and bron_id is not null;

comment on table public.taak is
  'Werk dat gedaan moet worden (0067). Aan een persoon of aan een rol, altijd '
  'met een vestiging erbij zodat de leiding van Venlo het werk van Venlo ziet.';

-- ---------------------------------------------------------------------------
--  Reacties: het gesprek dat bij een taak hoort
--
--  Zonder dit staat de overlegging over een taak in de chat, in de mail, of
--  nergens -- en dan is over een maand niet meer te zien waarom iets bleef
--  liggen.
-- ---------------------------------------------------------------------------

create table if not exists public.taak_reactie (
  id         text primary key,
  taak_id    text not null references public.taak(id) on delete cascade,
  tekst      text not null,
  door       text,
  door_naam  text,
  created_at bigint not null default public.now_ms(),
  updated_at bigint not null default public.now_ms()
);

create index if not exists taak_reactie_taak_idx on public.taak_reactie (taak_id, created_at);

-- ---------------------------------------------------------------------------
--  Klaar is klaar: wanneer en door wie
--
--  In een trigger en niet in de app. De app kan het vergeten, en een taak die
--  op klaar staat zonder datum is een taak waarvan niemand weet wanneer dat
--  gebeurde. Andersom net zo: gaat hij terug naar bezig, dan hoort de datum
--  weg -- anders staat er een afrondingsdatum bij werk dat nog loopt.
-- ---------------------------------------------------------------------------

create or replace function public.taak_klaar_stempel()
returns trigger language plpgsql as $$
begin
  if new.status = 'klaar' and (tg_op = 'INSERT' or old.status is distinct from 'klaar') then
    new.klaar_at := coalesce(new.klaar_at, public.now_ms());
  elsif new.status <> 'klaar' then
    new.klaar_at := null;
    new.klaar_door := null;
    new.klaar_door_naam := null;
  end if;
  return new;
end $$;

drop trigger if exists taak_klaar_stempel on public.taak;
create trigger taak_klaar_stempel
  before insert or update on public.taak
  for each row execute function public.taak_klaar_stempel();

-- ---------------------------------------------------------------------------
--  Wie mag hierbij
--
--  De rollen die dit gebruiken zijn leidinggevende, management en
--  ontwikkelaar. Daarnaast mag iedereen zien wat aan hemzelf is toegewezen --
--  anders kan een monteur een taak krijgen die hij nooit te zien krijgt.
--
--  De vestiging bepaalt de rest: in_my_locations() geeft management en wie
--  all_locations heeft alles, en een leidinggevende zijn eigen vestigingen.
--  Een taak zonder vestiging is voor iedereen met toegang.
-- ---------------------------------------------------------------------------

create or replace function public.mag_taken()
returns boolean language sql stable as $$
  select public.is_lead() or public.is_developer();
$$;

grant execute on function public.mag_taken() to authenticated;

alter table public.taak         enable row level security;
alter table public.taak_project enable row level security;
alter table public.taak_reactie enable row level security;

/* --- de taak zelf --- */

drop policy if exists taak_select on public.taak;
create policy taak_select on public.taak
  for select to authenticated
  using (
    toegewezen_aan = public.my_id()
    or (public.mag_taken() and public.in_my_locations(location_id))
  );

drop policy if exists taak_insert on public.taak;
create policy taak_insert on public.taak
  for insert to authenticated
  /* rij_bestaat() vooraan, om dezelfde reden als overal: een upsert langs
     PostgREST beoordeelt deze insert-regel OOK bij een gewone wijziging, en
     weigert die dan met "new row violates row-level security policy". Zie
     0044. */
  with check (public.rij_bestaat('public.taak'::regclass, id)
              or (public.mag_taken() and public.in_my_locations(location_id)));

drop policy if exists taak_update on public.taak;
create policy taak_update on public.taak
  for update to authenticated
  using (
    toegewezen_aan = public.my_id()
    or (public.mag_taken() and public.in_my_locations(location_id))
  )
  with check (
    toegewezen_aan = public.my_id()
    or (public.mag_taken() and public.in_my_locations(location_id))
  );

/* Weggooien mag alleen de leiding, en alleen bij eigen werk. Werk dat uit het
   systeem komt hoort niet gewist te worden maar afgevinkt: anders is de
   sollicitatie waar hij bij hoorde straks door niemand behandeld en staat er
   ook nergens meer dat het is blijven liggen. */
drop policy if exists taak_delete on public.taak;
create policy taak_delete on public.taak
  for delete to authenticated
  using (public.mag_taken() and public.in_my_locations(location_id)
         and bron = 'handmatig');

/* --- projecten --- */

drop policy if exists taak_project_select on public.taak_project;
create policy taak_project_select on public.taak_project
  for select to authenticated
  using (public.mag_taken() and public.in_my_locations(location_id));

drop policy if exists taak_project_insert on public.taak_project;
create policy taak_project_insert on public.taak_project
  for insert to authenticated
  with check (public.rij_bestaat('public.taak_project'::regclass, id)
              or (public.mag_taken() and public.in_my_locations(location_id)));

drop policy if exists taak_project_update on public.taak_project;
create policy taak_project_update on public.taak_project
  for update to authenticated
  using (public.mag_taken() and public.in_my_locations(location_id))
  with check (public.mag_taken() and public.in_my_locations(location_id));

drop policy if exists taak_project_delete on public.taak_project;
create policy taak_project_delete on public.taak_project
  for delete to authenticated
  using (public.is_management() or public.is_developer());

/* --- reacties --- */

drop policy if exists taak_reactie_select on public.taak_reactie;
create policy taak_reactie_select on public.taak_reactie
  for select to authenticated
  using (exists (select 1 from public.taak t where t.id = taak_id));

drop policy if exists taak_reactie_insert on public.taak_reactie;
create policy taak_reactie_insert on public.taak_reactie
  for insert to authenticated
  with check (public.rij_bestaat('public.taak_reactie'::regclass, id)
              or (door = public.my_id()
                  and exists (select 1 from public.taak t where t.id = taak_id)));

/* Een reactie mag je bijwerken zolang hij van jou is. Wissen niet: dan
   verdwijnt het antwoord waar iemand anders op reageerde. */
drop policy if exists taak_reactie_update on public.taak_reactie;
create policy taak_reactie_update on public.taak_reactie
  for update to authenticated
  using (door = public.my_id())
  with check (door = public.my_id());
