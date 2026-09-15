-- ===========================================================================
--  Een inkoopadres per onderneming, met een naam eraan
--
--  Casper: "We hebben meerdere bv's, en dat is prima, maar het moet
--  makkelijker gaan. De mailadressen moeten niet per vestiging, maar per
--  onderneming, je moet wel een vestiging kunnen koppelen aan een mailadres.
--  (...) de tweede goedkeuring moet dan komen te liggen bij een persoon, ik
--  stel voor dat we een werknemer (degene met de juiste rechten) kunnen
--  koppelen aan het mailadres."
--
--  Wat er stond
--  ------------
--
--  Het inkoopadres werd BEREKEND: inkoop.<website-slug>@<domein>, en de
--  vestiging werd er weer uit teruggerekend (0044). Dat is aardig zolang een
--  adres één ding betekent, en het breekt zodra er twee dingen aan hangen.
--
--  Want de bv is wat telt voor de boekhouding, en die volgt hier uit de
--  vestiging (0059/0079). Truckwash 1 Vastgoed heeft geen wasstraat en dus
--  geen vestiging -- en dus ook geen adres waarop zijn facturen kunnen
--  binnenkomen. De enige weg was: laten binnenkomen op een vestiging en
--  daarna met de hand de onderneming omzetten. Precies het werk dat weg moest.
--
--  Wat het wordt
--  -------------
--
--  Een adres is een eigen rij met drie dingen eraan:
--
--      administratie   VERPLICHT -- hier komen de facturen van die bv binnen
--      vestiging       mag, en dan draagt de bon ook meteen die vestiging
--      goedkeurder     wie de tweede handtekening zet
--
--  Daarmee is een adres geen afgeleide meer maar een afspraak, en kan er een
--  adres bestaan voor een bv zonder vestiging.
--
--  Waarom de goedkeurder hier hangt en niet bij de bv
--  --------------------------------------------------
--
--  Omdat het adres is wat de leverancier gebruikt, en dus wat bepaalt welke
--  stroom dit is. Twee adressen voor dezelfde bv -- inkoop.venlo@ en
--  inkoop.groep@ -- mogen bij verschillende mensen liggen, en dat is precies
--  hoe je het werk verdeelt zonder een tweede indeling te verzinnen.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. De adressen
-- ---------------------------------------------------------------------------

create table if not exists public.inkoop_adres (
  id            text primary key,
  /* Het volledige adres, zoals de leverancier het gebruikt. */
  adres         text not null,
  /* In welke bv de facturen van dit adres worden geboekt. Verplicht: een
     adres zonder administratie is een stapel die nergens heen kan. */
  administratie text not null,
  /* Optioneel. Staat hij er, dan draagt de bon ook meteen de vestiging --
     handig voor de kostenplaats en voor wie op die vestiging meekijkt. */
  location_id   text references public.locations(id) on delete set null,
  /* Wie de tweede handtekening zet. Leeg = zoals het was: iedereen die over
     kosten mag beslissen. */
  goedkeurder   text references public.profiles(id) on delete set null,
  omschrijving  text,
  actief        boolean not null default true,
  door          text,
  created_at    bigint not null default public.now_ms(),
  updated_at    bigint not null default public.now_ms()
);

/* Eén adres hoort bij één rij. Op lower(), want post is
   hoofdletterongevoelig en "Inkoop.Venlo@" is hetzelfde vak als
   "inkoop.venlo@". */
create unique index if not exists inkoop_adres_uniek
  on public.inkoop_adres (lower(adres));

create index if not exists inkoop_adres_bv_idx  on public.inkoop_adres (administratie);
create index if not exists inkoop_adres_wie_idx on public.inkoop_adres (goedkeurder);

comment on table public.inkoop_adres is
  'Waar facturen binnenkomen (0095), per ONDERNEMING en niet meer per '
  'vestiging. Een vestiging mag eraan hangen, en de persoon die de tweede '
  'handtekening zet ook. Vervangt het berekende inkoop.<slug>@<domein>.';

drop trigger if exists stamp_inkoop_adres on public.inkoop_adres;
create trigger stamp_inkoop_adres before insert or update on public.inkoop_adres
  for each row execute function public.stamp_updated_at();

drop trigger if exists inkoop_adres_verwijderd on public.inkoop_adres;
create trigger inkoop_adres_verwijderd after delete on public.inkoop_adres
  for each row execute function public.meld_verwijdering();

-- ---------------------------------------------------------------------------
--  2. Wat er al was, komt mee
--
--  Elke actieve vestiging had een adres dat werd uitgerekend. Die adressen
--  zijn uitgedeeld en staan bij leveranciers in het adresboek; ze horen te
--  blijven werken. Dus worden ze hier rijen, met de bv van die vestiging
--  erbij.
--
--  Een vestiging zonder administratie krijgt de hoofdadministratie -- dat is
--  wat bon_administratie() er tot nu toe ook van maakte.
-- ---------------------------------------------------------------------------

insert into public.inkoop_adres (id, adres, administratie, location_id, omschrijving)
select
  'ia_' || l.id,
  lower(
    coalesce(nullif(trim(vv.waarde), ''), 'inkoop') || '.' || l.website_slug
    || '@' || nullif(trim(dm.waarde), '')),
  coalesce(
    nullif(trim(l.administratie), ''),
    (select a.code from public.exact_administratie a where a.hoofd limit 1)),
  l.id,
  'Overgenomen uit het berekende adres van ' || l.name || ' (0095)'
  from public.locations l
  left join public.instellingen vv on vv.sleutel = 'inkoop_voorvoegsel'
  left join public.instellingen dm on dm.sleutel = 'inkoop_domein'
 where l.active
   and l.website_slug is not null
   and nullif(trim(dm.waarde), '') is not null
   /* Zonder administratie én zonder hoofdadministratie valt er niets te
      vullen; die vestiging krijgt zijn rij zodra er een hoofd is aangewezen. */
   and coalesce(
         nullif(trim(l.administratie), ''),
         (select a.code from public.exact_administratie a where a.hoofd limit 1)
       ) is not null
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  3. Bij welk adres hoort deze post?
--
--  Eén plek, want de vraag wordt op twee plekken gesteld: door de post die
--  een bon aanmaakt, en door het scherm dat laat zien welke adressen er zijn.
--
--  Plusadressen tellen als hetzelfde vak -- inkoop.venlo+scan@ is
--  inkoop.venlo@. Sommige scanners plakken daar iets achter, en dat is geen
--  ander postvak maar hetzelfde met een merkteken.
-- ---------------------------------------------------------------------------

create or replace function public.inkoop_adres_van(adres_in text)
returns table (
  id text, adres text, administratie text, location_id text, goedkeurder text
)
language sql stable security definer set search_path = public as $$
  with schoon as (
    select lower(trim(coalesce(adres_in, ''))) as vol
  ),
  zonder_plus as (
    select case
             when position('+' in split_part(s.vol, '@', 1)) > 0
               then split_part(split_part(s.vol, '@', 1), '+', 1) || '@' || split_part(s.vol, '@', 2)
             else s.vol
           end as vol
      from schoon s
  )
  select a.id, a.adres, a.administratie, a.location_id, a.goedkeurder
    from public.inkoop_adres a, zonder_plus z
   where a.actief
     and lower(a.adres) = z.vol
   limit 1;
$$;

revoke execute on function public.inkoop_adres_van(text) from public, anon;
grant  execute on function public.inkoop_adres_van(text) to authenticated, service_role;

comment on function public.inkoop_adres_van(text) is
  'Bij welk inkoopadres hoort deze ontvanger (0095)? Plusadressen tellen als '
  'hetzelfde vak. Geen rij = een adres dat we niet kennen, en dan wordt het '
  'gewoon post.';

-- ---------------------------------------------------------------------------
--  4. Wie de tweede handtekening zet, staat op de bon
--
--  Op de BON en niet alleen op het adres, want een adres kan later van
--  eigenaar wisselen en dan hoort een factuur van vorige maand niet ineens
--  bij iemand anders te liggen. Zelfde gedachte als bij de naam van de
--  goedkeurder (0060): vastleggen wat er gold op het moment zelf.
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists goedkeurder      text;
alter table public.expenses add column if not exists goedkeurder_naam text;
/* Het adres waarop hij binnenkwam. Puur om te kunnen zien waar een stapel
   vandaan komt; de bv en de vestiging staan al op de bon zelf. */
alter table public.expenses add column if not exists inkoop_adres_id  text;

create index if not exists expenses_goedkeurder_idx
  on public.expenses (goedkeurder) where goedkeurder is not null;

comment on column public.expenses.goedkeurder is
  'Bij wie de tweede handtekening ligt (0095). Komt van het inkoopadres '
  'waarop de factuur binnenkwam en wordt daar losgetrokken: wisselt dat adres '
  'later van eigenaar, dan blijft een oude factuur liggen waar hij lag.';

-- ---------------------------------------------------------------------------
--  5. En het adres is een bron voor de bv
--
--  0079 kent er vier: gelezen, vermoeden, vestiging, handmatig. Een adres is
--  er een tussenin -- sterker dan een naam die erop lijkt, zwakker dan een
--  KvK-nummer dat klopt. Het is namelijk het adres dat WIJ hebben uitgedeeld:
--  wie daarheen stuurt, factureert aan die bv.
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.expenses drop constraint if exists expenses_administratie_bron_check;
  alter table public.expenses add constraint expenses_administratie_bron_check
    check (administratie_bron is null
           or administratie_bron in ('gelezen', 'adres', 'vermoeden', 'vestiging', 'handmatig'));
exception when others then
  raise notice 'administratie_bron-controle niet gezet: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
--  6. Wie mag hierbij
--
--  Lezen: wie kosten beoordeelt -- je hoort te kunnen zien waar je stapel
--  vandaan komt. Wijzigen: het management en de administratie, want een adres
--  uitdelen is hetzelfde soort besluit als een werkadres uitdelen (0081): het
--  komt bij leveranciers in het adresboek te staan.
-- ---------------------------------------------------------------------------

alter table public.inkoop_adres enable row level security;

drop policy if exists inkoop_adres_select on public.inkoop_adres;
create policy inkoop_adres_select on public.inkoop_adres for select to authenticated
  using (public.mag_kosten_beslissen() or public.heeft_recht('admin.desk')
         or public.is_developer());

drop policy if exists inkoop_adres_insert on public.inkoop_adres;
create policy inkoop_adres_insert on public.inkoop_adres for insert to authenticated
  with check (
    /* rij_bestaat() vooraan: een upsert langs PostgREST wordt OOK tegen de
       insertregel gehouden. Zie 0031 en 0040. */
    public.rij_bestaat('public.inkoop_adres'::regclass, id)
    or public.is_management() or public.heeft_recht('admin.desk')
  );

drop policy if exists inkoop_adres_update on public.inkoop_adres;
create policy inkoop_adres_update on public.inkoop_adres for update to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'))
  with check (public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists inkoop_adres_delete on public.inkoop_adres;
create policy inkoop_adres_delete on public.inkoop_adres for delete to authenticated
  using (public.is_management());

-- ---------------------------------------------------------------------------
--  7. En bon_administratie() kent het adres
--
--  De volgorde met het adres erin:
--
--    1. wat op de bon staat      gelezen van het stuk, of gezet door een mens
--    2. die van zijn vestiging   zoals het sinds 0059 ging
--    3. de hoofdadministratie
--
--  Het adres staat hier niet apart in, en dat is met opzet: de post ZET de
--  administratie op de bon zodra hij het adres herkent (bron 'adres'), en dan
--  is stap 1 al het antwoord. Een tweede weg ernaartoe zou betekenen dat er
--  twee plekken zijn die het kunnen weten -- precies waar 0079 voor
--  waarschuwt.
--
--  Deze functie verandert dus niet. Dat staat hier opgeschreven omdat het
--  anders lijkt of het vergeten is.
-- ---------------------------------------------------------------------------
