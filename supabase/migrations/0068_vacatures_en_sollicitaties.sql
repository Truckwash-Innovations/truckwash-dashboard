-- ===========================================================================
--  Vacatures en sollicitaties in eigen huis
--
--  Casper: "je moet de sollicitaties ook aanpassen ipv trainstation, ik heb je
--  een pdf gestuurd, die vragen moeten er dan inkomen (wel gerichte vragen
--  voor sollicitant). Als iemand gesolliciteerd heeft, moet je het automatisch
--  op leiding en managment hun todo zetten (wel enkel als ze toegang tot de
--  gekozen locatie hebben)."
--
--  Wat er was
--  ----------
--
--  Vier vacatures, met de hand in site.json gezet, en een sollicitatieknop die
--  naar truckwash.trainstation.nl wees -- een systeem van een andere partij.
--  Wat daar binnenkwam kwam hier nooit aan: geen melding, geen taak, geen
--  dossier. En bij de pendelchauffeur wees de knop naar vacaturenummer 1,
--  hetzelfde nummer als de truckwashmedewerker, zodat een sollicitatie op de
--  verkeerde vacature belandde.
--
--  De vragen
--  ---------
--
--  Uit het gespreksformulier dat Casper stuurde. Niet alle vragen daaruit:
--  dat is een template voor het GESPREK, en de helft ervan hoort daar ook te
--  blijven ("algemene indruk", de proefdag, de doorgroeimogelijkheden die je
--  bespreekt). Wat een sollicitant zelf kan invullen staat hier; wat de
--  gespreksvoerder invult staat er als aparte velden bij en is voor de
--  sollicitant niet zichtbaar.
--
--  Eén vraag is bewust anders gesteld. Het formulier vraagt "wat is je
--  leeftijd", en dat is een antwoord dat na een jaar niet meer klopt -- terwijl
--  het loon uit de salaristabel er wél aan hangt. Dus: geboortedatum. De
--  leeftijd volgt daaruit, elke dag opnieuw.
--
--  De beschikbaarheid staat als jsonb en niet als veertien kolommen: het is
--  één ding dat je in één keer invult en in één keer terugleest, en zeven
--  dagen maal drie velden als kolommen maakt elke query onleesbaar.
--
--  Waarom er meteen een taak van komt
--  ----------------------------------
--
--  Een sollicitatie die in een lijst belandt waar niemand naar kijkt is een
--  sollicitatie die je kwijt bent. Vandaar de trigger onderaan: zodra er een
--  binnenkomt staat hij op het bord van de mensen die er iets mee kunnen --
--  en alleen bij hen, want de leiding van Venlo hoort niet de sollicitaties
--  van Groenlo te zien.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De vacature
-- ---------------------------------------------------------------------------

create table if not exists public.vacature (
  id           text primary key,
  /* Het pad op de website. Uniek, want twee vacatures op één adres betekent
     dat er één onbereikbaar is. */
  slug         text not null unique,
  titel        text not null,
  /* FG1 t/m FG5 uit de salaristabel; leeg mag ook. Alleen om de vacature aan
     een schaal te hangen -- de bedragen zelf staan hier niet, die horen in de
     loonadministratie en niet op een website. */
  functiegroep text check (functiegroep is null or functiegroep in ('FG1','FG2','FG3','FG4','FG5')),
  intro        text not null default '',
  tekst        text not null default '',
  taken        text[] not null default '{}',
  eisen        text[] not null default '{}',
  bieden       text[] not null default '{}',
  /* "Bijbaan", "32-38 uur", "in overleg" -- vrije tekst, want dit is wat er op
     de site komt te staan en niet iets waarop gerekend wordt. */
  uren         text,

  /* Op welke vestigingen. Een lege lijst betekent: alle. Dat is de gewone
     stand voor een vacature als "washeld" die overal openstaat, en het scheelt
     achttien vinkjes zetten bij elke nieuwe vacature. */
  locaties     text[] not null default '{}',

  actief       boolean not null default true,
  volgorde     integer not null default 0,
  door         text,
  door_naam    text,
  created_at   bigint not null default public.now_ms(),
  updated_at   bigint not null default public.now_ms()
);

create index if not exists vacature_actief_idx on public.vacature (actief, volgorde);

comment on table public.vacature is
  'De vacatures, zoals ze op de website komen (0068). Leeg locaties[] betekent '
  'alle vestigingen.';

-- ---------------------------------------------------------------------------
--  De sollicitatie
-- ---------------------------------------------------------------------------

create table if not exists public.sollicitatie (
  id             text primary key,

  vacature_id    text references public.vacature(id) on delete set null,
  /* De titel erbij, want een vacature kan worden hernoemd of ingetrokken en
     dan hoort er bij de sollicitatie nog steeds te staan waarop iemand
     solliciteerde. */
  vacature_titel text,
  location_id    text,

  /* --- wie --- */
  naam           text not null,
  email          text not null,
  telefoon       text,
  /* Geen leeftijd maar een geboortedatum; zie de kop. */
  geboortedatum  date,
  woonplaats     text,

  /* --- school en werk --- */
  school         boolean,
  opleiding      text,
  niveau         text,
  leerjaar       text,
  ervaring       text,
  hoe_gevonden   text,
  motivatie      text,

  /* --- inzet --- */
  hoe_lang       text,
  beperkingen    text,

  /* --- vervoer --- */
  vervoer        text,
  rijbewijs      boolean,
  reistijd       text,
  andere_vestiging boolean,

  /* Zeven regels van {dag, van, tot, opmerking}. Zie de kop voor waarom dit
     geen veertien kolommen zijn. */
  beschikbaarheid jsonb not null default '[]'::jsonb,

  /* --- de afhandeling; niet zichtbaar voor de sollicitant --- */
  status         text not null default 'nieuw'
                 check (status in ('nieuw', 'gesprek', 'proefdag', 'aangenomen',
                                   'afgewezen', 'ingetrokken')),
  indruk         text,
  notities       text,
  gesprek_at     bigint,
  proefdag_at    bigint,
  functiegroep   text check (functiegroep is null or functiegroep in ('FG1','FG2','FG3','FG4','FG5')),
  behandeld_door text,
  behandeld_door_naam text,
  behandeld_at   bigint,
  afwijs_reden   text,

  /* Het dossier dat hieruit is gemaakt. Gevuld zodra iemand op "medewerker
     aanmaken" heeft gedrukt, zodat dat niet twee keer kan. */
  profile_id     text,

  created_at     bigint not null default public.now_ms(),
  updated_at     bigint not null default public.now_ms()
);

create index if not exists sollicitatie_status_idx on public.sollicitatie (status, created_at desc);
create index if not exists sollicitatie_loc_idx    on public.sollicitatie (location_id);

comment on table public.sollicitatie is
  'Sollicitaties die via de website binnenkomen (0068). Vervangt het formulier '
  'bij trainstation; wat hier binnenkomt maakt meteen een taak aan.';

-- ---------------------------------------------------------------------------
--  Een sollicitatie wordt werk
--
--  Eén taak, niet één per persoon. Vijf mensen die allemaal hetzelfde vinkje
--  moeten zetten is vier keer werk te veel, en na de eerste blijven er vier
--  openstaan alsof er niets is gebeurd.
--
--  De taak hangt aan een ROL en aan de vestiging. Wie hem oppakt zet hem op
--  zijn naam (zie 0067). Ligt er een leidinggevende op die vestiging, dan gaat
--  hij naar de leiding; is die er niet, dan naar het management -- anders
--  hangt hij aan een rol die daar niemand heeft en ziet niemand hem.
--
--  Het management ziet hem hoe dan ook: die kijkt op alle vestigingen mee.
-- ---------------------------------------------------------------------------

create or replace function public.sollicitatie_wordt_taak()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  heeft_leiding boolean;
  rol           text;
  waar          text;
begin
  select exists (
    select 1 from public.profiles p
     where p.active
       and 'supervisor' = any(p.roles)
       and (p.all_locations
            or p.location_id = new.location_id
            or new.location_id = any(coalesce(p.manages, array[]::text[])))
  ) into heeft_leiding;

  rol := case when heeft_leiding then 'supervisor' else 'management' end;

  select coalesce(l.name, '') into waar
    from public.locations l where l.id = new.location_id;

  insert into public.taak (
    id, titel, omschrijving, status, prioriteit,
    location_id, toegewezen_rol, bron, bron_id, door_naam
  ) values (
    'taak_sol_' || new.id,
    'Sollicitatie: ' || new.naam ||
      case when coalesce(new.vacature_titel, '') = '' then ''
           else ' (' || new.vacature_titel || ')' end,
    'Kwam binnen via de website' ||
      case when coalesce(waar, '') = '' then '' else ' voor ' || waar end ||
      '. Bel of mail om een gesprek in te plannen.' ||
      case when coalesce(new.telefoon, '') = '' then '' else E'\n' || new.telefoon end ||
      E'\n' || new.email,
    'te_doen',
    'hoog',
    new.location_id,
    rol,
    'sollicitatie',
    new.id,
    'De website'
  )
  /* De unieke index uit 0067 zou hier een fout gooien als dezelfde
     sollicitatie twee keer binnenkwam. Een sollicitatie die niet wordt
     opgeslagen omdat er al een taak voor was, is erger dan een dubbele taak
     die er niet komt. */
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists sollicitatie_wordt_taak on public.sollicitatie;
create trigger sollicitatie_wordt_taak
  after insert on public.sollicitatie
  for each row execute function public.sollicitatie_wordt_taak();

-- ---------------------------------------------------------------------------
--  Wat de website mag weten
--
--  Dezelfde lijn als website_vestigingen() in 0033: één functie die precies
--  bepaalt wat er naar buiten gaat, alleen aan te roepen door service_role.
--  Hier staat dus wat er op de site komt, en niets anders -- geen tellers,
--  geen wie-hem-aanmaakte, geen vestigingen die uit staan.
-- ---------------------------------------------------------------------------

drop function if exists public.website_vacatures();

create function public.website_vacatures()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(v order by v.volgorde, v.titel), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'slug', va.slug,
               'titel', va.titel,
               'intro', va.intro,
               'tekst', va.tekst,
               'taken', to_jsonb(va.taken),
               'eisen', to_jsonb(va.eisen),
               'bieden', to_jsonb(va.bieden),
               'uren', va.uren,
               'functiegroep', va.functiegroep,
               /* Alleen vestigingen die ook echt open zijn, en die een plek op
                  de site hebben. Een vacature voor een vestiging die uit staat
                  is een sollicitatie die nergens heen kan.

                  De SLUG gaat mee en niet het id. Zo doet website_vestigingen()
                  het ook (0033), en met reden: de site hoeft onze sleutels niet
                  te kennen, en een id dat eenmaal in een openbare pagina staat
                  is een id dat je nooit meer verandert. De serverfunctie zoekt
                  de vestiging er straks bij op de slug. */
               'locaties', (
                 select coalesce(jsonb_agg(jsonb_build_object('slug', l.website_slug,
                                                              'plaats', l.city)
                                           order by l.city), '[]'::jsonb)
                   from public.locations l
                  where l.active
                    and l.website_slug is not null
                    and (cardinality(va.locaties) = 0 or l.id = any(va.locaties))
               )
             ) as v,
             va.volgorde, va.titel
        from public.vacature va
       where va.actief
    ) v;
$$;

revoke execute on function public.website_vacatures() from public, anon, authenticated;
grant  execute on function public.website_vacatures() to service_role;

-- ---------------------------------------------------------------------------
--  Wie mag hierbij
-- ---------------------------------------------------------------------------

alter table public.vacature     enable row level security;
alter table public.sollicitatie enable row level security;

/* --- vacatures ---
   Lezen mag iedereen die bij taken mag; aanmaken en wijzigen mag de leiding
   voor haar eigen vestigingen en het management voor alles. Dat laatste zit in
   de regel hieronder: een vacature zonder vestiging (= alle) mag alleen wie
   overal mag. */

create or replace function public.mag_vacature(loc text[])
returns boolean language sql stable as $$
  select public.is_management() or public.is_developer()
      or (public.is_supervisor()
          and cardinality(loc) > 0
          and loc <@ public.my_locations());
$$;

grant execute on function public.mag_vacature(text[]) to authenticated;

drop policy if exists vacature_select on public.vacature;
create policy vacature_select on public.vacature
  for select to authenticated using (public.mag_taken());

drop policy if exists vacature_insert on public.vacature;
create policy vacature_insert on public.vacature
  for insert to authenticated
  with check (public.rij_bestaat('public.vacature'::regclass, id)
              or public.mag_vacature(locaties));

drop policy if exists vacature_update on public.vacature;
create policy vacature_update on public.vacature
  for update to authenticated
  using (public.mag_vacature(locaties))
  with check (public.mag_vacature(locaties));

drop policy if exists vacature_delete on public.vacature;
create policy vacature_delete on public.vacature
  for delete to authenticated
  using (public.is_management() or public.is_developer());

/* --- sollicitaties ---
   Alleen wie bij die vestiging mag. Hier staat een geboortedatum, een
   telefoonnummer en een motivatiebrief in; dat is niet iets om aan alle
   leidinggevenden van het land te laten zien. */

drop policy if exists sollicitatie_select on public.sollicitatie;
create policy sollicitatie_select on public.sollicitatie
  for select to authenticated
  using (public.mag_taken() and public.in_my_locations(location_id));

/* Aanmaken doet de website, met de servicesleutel, langs de RLS heen. Wat hier
   staat is voor de app zelf -- iemand die aan de balie een sollicitatie
   overtypt. */
drop policy if exists sollicitatie_insert on public.sollicitatie;
create policy sollicitatie_insert on public.sollicitatie
  for insert to authenticated
  with check (public.rij_bestaat('public.sollicitatie'::regclass, id)
              or (public.mag_taken() and public.in_my_locations(location_id)));

drop policy if exists sollicitatie_update on public.sollicitatie;
create policy sollicitatie_update on public.sollicitatie
  for update to authenticated
  using (public.mag_taken() and public.in_my_locations(location_id))
  with check (public.mag_taken() and public.in_my_locations(location_id));

/* Wissen kan niet, ook niet door het management. Een afgewezen sollicitant
   hoort te worden opgeruimd op tijd en niet op knopdruk -- en zolang iemand in
   procedure is, is "weg" hetzelfde als "kwijt". Wat weg moet krijgt de status
   ingetrokken. */
