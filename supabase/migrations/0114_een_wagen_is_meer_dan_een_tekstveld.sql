-- ===========================================================================
--  Een wagen is meer dan een tekstveld
--
--  Johannes, over de kentekencamera's: "controleren of er voor elk kenteken
--  wel een order gemaakt is of dat er een vergeten is."
--
--  Dat kan niet zolang een kenteken nergens van iemand is.
--
--  Wat er stond
--  ------------
--
--  Kentekens liggen op vijf plekken, allemaal als vrije tekst:
--
--      wash_jobs.plate            de wasbeurt        (not null)
--      pos_sales.plate            de kassabon
--      pos_subscriptions.plate    de strippenkaart
--      employer_links.kentekens   wat een chauffeur mag brengen
--      employer_rules.kenteken    waarvoor een afspraak geldt
--
--  Er is geen wagen. Het "wagenpark" dat een werkgever in beeld krijgt wordt
--  live afgeleid uit de historie -- een Set over b.plate. Een wagen bestaat
--  dus pas nadat hij een keer gewassen is, en houdt op te bestaan zodra de
--  historie uit beeld loopt.
--
--  Erger is de schrijfwijze. Er zijn er nu twee in omloop: de kassa doet
--  toUpperCase().trim(), het zoeken haalt de streepjes eruit. "BX-JT-42",
--  "bxjt42" en "BX JT 42" zijn voor dit systeem drie verschillende wagens.
--  Wat een camera straks leest gaat daar nooit op matchen.
--
--  Wat het wordt
--  -------------
--
--  Een tabel waarin een bedrijf zijn eigen wagens zet, met het kenteken
--  twee keer: zoals iemand het intikt, en kaal. Die kale vorm wordt door de
--  database zelf gezet, niet door de app -- anders drift het opnieuw uit
--  elkaar zodra er een tweede plek bijkomt die wagens aanmaakt.
--
--  De wagen hangt aan de werkgever, want dat is het enige bedrijfsbegrip dat
--  zichzelf al mag beheren (employers.beheerders). Maar hij draagt ook het
--  company_id mee, zodat het factuuradres hetzelfde wagenpark ziet. In dit
--  bedrijf zijn dat dezelfde partij; in het schema zijn het twee tabellen
--  met employers.company_id ertussen.
--
--  Lezen mag dus langs twee routes, precies zoals jobs_select dat al doet
--  voor de wasbeurten. Schrijven mag alleen een beheerder van dat bedrijf,
--  precies zoals wgr_write dat al doet voor de afspraken. Een chauffeur die
--  aan het bedrijf gekoppeld is mag kijken, niet wijzigen -- mijn_werkgevers()
--  telt hem wel mee en is daarom als schrijfrecht ongeschikt.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Eén schrijfwijze, en die staat hier
--
--  Hoofdletters, en alles weg wat geen letter of cijfer is. Streepjes,
--  spaties en punten verdwijnen. Dit is de vorm waarop vergeleken wordt --
--  met wat de kassa intikte, en straks met wat een camera leest.
-- ---------------------------------------------------------------------------

create or replace function public.kenteken_kaal(invoer text)
returns text language sql immutable as $$
  select regexp_replace(upper(coalesce(invoer, '')), '[^A-Z0-9]', '', 'g');
$$;

grant execute on function public.kenteken_kaal(text) to authenticated;

comment on function public.kenteken_kaal(text) is
  'De vergelijkbare vorm van een kenteken (0114): hoofdletters, alleen '
  'letters en cijfers. BX-JT-42, bx jt 42 en BXJT42 geven alle drie BXJT42.';

-- ---------------------------------------------------------------------------
--  2. De wagen
-- ---------------------------------------------------------------------------

create table if not exists public.wagen (
  id                text primary key,

  -- Van wie hij is. Allebei mag, en minstens één moet -- want op dit moment
  -- staat er nog geen enkele klant in het systeem en is nog niet uitgemaakt
  -- of ze als werkgever of als facturatieklant worden ingevoerd. In dit
  -- bedrijf is dat dezelfde partij; het schema houdt beide deuren open tot
  -- de eerste klanten erin staan.
  werkgever_id      text references public.employers(id) on delete cascade,
  company_id        text references public.companies(id) on delete set null,

  constraint wagen_heeft_eigenaar
    check (werkgever_id is not null or company_id is not null),

  -- Zoals ingetikt, en zoals vergeleken. De kale vorm zet de trigger.
  kenteken          text not null,
  kenteken_kaal     text not null default '',

  soort             text check (soort is null or soort in
                      ('trekker','oplegger','bakwagen','bus','tank','anders')),
  omschrijving      text,

  -- De chauffeur die er vast op rijdt. Bij voorkeur een bestaande koppeling,
  -- want dan verdwijnt hij vanzelf uit beeld als die koppeling stopt. Een
  -- naam zonder account mag ook -- niet elke chauffeur heeft een inlog.
  chauffeur_link_id text references public.employer_links(id) on delete set null,
  chauffeur_naam    text not null default '',

  actief            boolean not null default true,
  notitie           text,

  door              text,
  created_at        bigint not null default public.now_ms(),
  updated_at        bigint not null default public.now_ms()
);

comment on table public.wagen is
  'Het wagenpark van een werkgever (0114). Een bedrijf zet hier zijn eigen '
  'wagens neer; kenteken_kaal is de vorm waarop een camerakenteken matcht.';

comment on column public.wagen.kenteken_kaal is
  'Wordt door de trigger gezet, nooit door de app. Niet met de hand vullen.';

create index if not exists wagen_werkgever_idx on public.wagen (werkgever_id);
create index if not exists wagen_company_idx   on public.wagen (company_id);
create index if not exists wagen_kenteken_idx  on public.wagen (kenteken_kaal);
create index if not exists wagen_updated_idx   on public.wagen (updated_at);

-- Eén wagen per bedrijf, op de kale vorm -- anders staat dezelfde wagen er
-- twee keer in omdat iemand de streepjes anders zette.
--
-- Twee indexen, want een wagen hangt aan een werkgever of aan een
-- facturatieklant. Postgres laat NULL's in een unieke index ongemoeid, dus
-- één index over beide kolommen zou de tweede soort niet afdekken.
create unique index if not exists wagen_uniek_werkgever
  on public.wagen (werkgever_id, kenteken_kaal)
  where werkgever_id is not null;

create unique index if not exists wagen_uniek_company
  on public.wagen (company_id, kenteken_kaal)
  where werkgever_id is null and company_id is not null;

-- ---------------------------------------------------------------------------
--  3. De kale vorm zet zichzelf
-- ---------------------------------------------------------------------------

create or replace function public.wagen_kenteken_zetten()
returns trigger language plpgsql as $$
begin
  new.kenteken      := upper(btrim(coalesce(new.kenteken, '')));
  new.kenteken_kaal := public.kenteken_kaal(new.kenteken);

  if new.kenteken_kaal = '' then
    raise exception 'Een wagen heeft een kenteken nodig.';
  end if;

  return new;
end;
$$;

drop trigger if exists wagen_kenteken on public.wagen;
create trigger wagen_kenteken before insert or update on public.wagen
  for each row execute function public.wagen_kenteken_zetten();

-- ---------------------------------------------------------------------------
--  4. Wat een bedrijf niet zelf mag verzetten
--
--  Een beheerder beheert zijn eigen wagenpark, niet bij wie het hoort. Zonder
--  deze rem kan hij zijn wagens aan een ander bedrijf hangen, of aan een
--  factuuradres dat niet van hem is.
-- ---------------------------------------------------------------------------

create or replace function public.wagen_bewaak()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_management() then
    return new;
  end if;

  new.werkgever_id := old.werkgever_id;
  new.company_id   := old.company_id;
  return new;
end;
$$;

drop trigger if exists wagen_bewaken on public.wagen;
create trigger wagen_bewaken before update on public.wagen
  for each row execute function public.wagen_bewaak();

-- ---------------------------------------------------------------------------
--  5. Stempel en melding
--
--  Zonder meld_verwijdering blijft een verwijderde wagen op elk apparaat in
--  de lokale kopie staan -- dezelfde fout die 0038 voor de andere tabellen
--  rechtzette.
-- ---------------------------------------------------------------------------

drop trigger if exists stamp_wagen on public.wagen;
create trigger stamp_wagen before insert or update on public.wagen
  for each row execute function public.stamp_updated_at();

drop trigger if exists wagen_verwijderd on public.wagen;
create trigger wagen_verwijderd after delete on public.wagen
  for each row execute function public.meld_verwijdering();

-- ---------------------------------------------------------------------------
--  6. Wie mag wat
--
--  Lezen: Truckwash1, het factuuradres, en iedereen die bij de werkgever
--  hoort -- beheerder of gekoppelde chauffeur. Dat is jobs_select, letterlijk.
--
--  Schrijven: het management, een beheerder van dát bedrijf, of het
--  facturatieaccount van dát bedrijf. Bewust NIET mijn_werkgevers(), want daar
--  zitten ook de gekoppelde chauffeurs in; die zouden dan het hele wagenpark
--  van hun werkgever kunnen wissen.
-- ---------------------------------------------------------------------------

/*
 * Mag ik deze wagen beheren?
 *
 * Staat apart omdat insert, update en delete hem alle drie nodig hebben, en
 * drie keer hetzelfde exists-blok overschrijven is precies hoe zulke regels
 * uit elkaar gaan lopen.
 */
create or replace function public.wagen_beheerder(wg_id text, co_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_management()
      or (wg_id is not null and exists (
            select 1 from public.employers e
             where e.id = wg_id
               and public.my_id() = any(e.beheerders)))
      or (co_id is not null and co_id = public.my_company());
$$;

grant execute on function public.wagen_beheerder(text, text) to authenticated;

/* De regels hierboven gelden alleen voor ingelogde gebruikers, dus anon heeft
   deze functie nooit nodig. Supabase deelt execute standaard uit aan iedereen;
   dat halen we er hier weer af. Zie 0034. */
revoke execute on function public.wagen_beheerder(text, text) from public, anon;

comment on function public.wagen_beheerder(text, text) is
  'Wie het wagenpark van een bedrijf mag wijzigen (0114): het management, een '
  'beheerder van de werkgever, of het facturatieaccount van dat bedrijf.';

alter table public.wagen enable row level security;

drop policy if exists wagen_select on public.wagen;
create policy wagen_select on public.wagen for select to authenticated
  using (
    public.is_staff()
    or (company_id is not null and company_id = public.my_company())
    or werkgever_id = any(public.mijn_werkgevers())
  );

drop policy if exists wagen_insert on public.wagen;
create policy wagen_insert on public.wagen for insert to authenticated
  with check (
    not public.rij_bestaat('public.wagen'::regclass, id)
    and public.wagen_beheerder(werkgever_id, company_id)
  );

drop policy if exists wagen_update on public.wagen;
create policy wagen_update on public.wagen for update to authenticated
  using      (public.wagen_beheerder(werkgever_id, company_id))
  with check (public.wagen_beheerder(werkgever_id, company_id));

drop policy if exists wagen_delete on public.wagen;
create policy wagen_delete on public.wagen for delete to authenticated
  using (public.wagen_beheerder(werkgever_id, company_id));
