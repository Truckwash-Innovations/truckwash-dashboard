-- ===========================================================================
--  Van een kenteken naar de klant
--
--  Draai dit ná 0116. Opnieuw draaien mag.
--
--  Johannes, over de kentekencamera's: "waardoor we die later kunnen zien in
--  het systeem, op naam van die klant."
--
--  Dat is één vraag: van een kenteken naar een bedrijf. 0114 maakte de
--  schrijfwijze eenduidig en zette het wagenpark neer; hier wordt die vraag
--  beantwoordbaar.
--
--  Waarom geen wagen_id op de bon
--  ------------------------------
--
--  Het voor de hand liggende zou zijn: een kolom wagen_id op wash_jobs en
--  pos_sales, gevuld bij het aanmaken. Dat is hier de verkeerde keuze.
--
--  Het kenteken IS de sleutel. Het staat op de plaat, de balie tikt het in,
--  de camera leest het, en sinds 0114 is er één schrijfwijze. Een tweede
--  verwijzing ernaast levert vooral de mogelijkheid op dat de twee het
--  oneens worden -- een bon met wagen_id A en kenteken B is een vraag die
--  niemand kan beantwoorden.
--
--  Dus: koppelen op de kale vorm, met een index eronder zodat het snel gaat.
--  Wordt een wagen later aan een ander bedrijf overgedragen, dan verschuift
--  de historie mee. Dat is voor "wiens wagen is dit nu" juist goed; wie de
--  historie op het bedrijf van tóen wil, leest company_id op de bon zelf,
--  en dat blijft gewoon staan.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Zoeken op de kale vorm moet snel zijn
--
--  Zonder deze indexen leest elke zoekopdracht de hele tabel, want de
--  vergelijking staat op kenteken_kaal(plate) en niet op plate zelf.
-- ---------------------------------------------------------------------------

create index if not exists wash_jobs_kenteken_idx
  on public.wash_jobs (public.kenteken_kaal(plate));

create index if not exists pos_sales_kenteken_idx
  on public.pos_sales (public.kenteken_kaal(plate));

create index if not exists pos_subscriptions_kenteken_idx
  on public.pos_subscriptions (public.kenteken_kaal(plate));

-- ---------------------------------------------------------------------------
--  2. Wiens wagen is dit?
--
--  Eén rij per treffer. Meestal nul of één; twee bedrijven met hetzelfde
--  kenteken hoort niet te kunnen maar wordt hier niet weggemoffeld -- als het
--  gebeurt wil je het zien.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
--  Waarom de parameter niet kenteken heet
--
--  In een SQL-functie wint een KOLOM van een parameter met dezelfde naam. Een
--  functie wagen_zoeken(kenteken text) leest in zijn eigen where-voorwaarde
--  dus w.kenteken, en niet wat je meegaf:
--
--      where w.kenteken_kaal = public.kenteken_kaal(kenteken)
--
--  wordt dan kenteken_kaal = kenteken_kaal(w.kenteken), en dat is voor elke
--  rij waar. De functie geeft dan het hele wagenpark terug, ongeacht wat je
--  zocht -- zonder foutmelding. Met een handvol wagens in een proef valt dat
--  niet op; bij een klant met honderd trekkers wel.
--
--  Vandaar zoek_naar. kenteken_kaal() doet het sinds 0114 al zo, met invoer.
--
--  En drop ervoor: create or replace mag de naam van een parameter niet
--  wijzigen ("cannot change name of input parameter"). Zonder die regels
--  loopt een tweede ronde van bijwerken.sql hier stuk.
-- ---------------------------------------------------------------------------

drop function if exists public.wagen_zoeken(text);
drop function if exists public.wagen_historie(text, integer);

create or replace function public.wagen_zoeken(zoek_naar text)
returns table (
  wagen_id        text,
  kenteken_netjes text,
  werkgever_id    text,
  werkgever_naam  text,
  company_id      text,
  company_naam    text,
  chauffeur_naam  text,
  soort           text,
  actief          boolean
)
language sql stable security invoker set search_path = public as $$
  select w.id,
         w.kenteken,
         w.werkgever_id,
         e.naam,
         coalesce(w.company_id, e.company_id),
         c.name,
         nullif(w.chauffeur_naam, ''),
         w.soort,
         w.actief
    from public.wagen w
    left join public.employers e on e.id = w.werkgever_id
    left join public.companies c on c.id = coalesce(w.company_id, e.company_id)
   where w.kenteken_kaal = public.kenteken_kaal(zoek_naar)
   order by w.actief desc, w.kenteken;
$$;

grant execute on function public.wagen_zoeken(text) to authenticated;

comment on function public.wagen_zoeken(text) is
  'Van een kenteken naar het bedrijf waar die wagen bij hoort (0117). '
  'Ongevoelig voor schrijfwijze. security invoker: je ziet alleen wagens '
  'waar je volgens wagen_select bij mag.';

-- ---------------------------------------------------------------------------
--  3. Wat is er met deze wagen gedaan?
--
--  De wasbeurten van één kenteken, ongeacht hoe het destijds is ingetikt.
--  Dit is wat "later kunnen zien in het systeem" praktisch betekent: iemand
--  belt over een wagen en je wilt weten wanneer hij hier was.
--
--  Let op: dit leest wash_jobs, en daar geldt jobs_select. Een werkgever ziet
--  dus zijn eigen beurten en niet die van een ander -- de functie hoeft dat
--  niet zelf af te schermen en doet dat bewust ook niet.
-- ---------------------------------------------------------------------------

create or replace function public.wagen_historie(zoek_naar text, hoeveel integer default 50)
returns table (
  job_id       text,
  ticket       text,
  company_id   text,
  company_naam text,
  plate        text,
  service      text,
  status       text,
  gepland_op   bigint,
  gereed_op    bigint,
  prijs_excl   numeric
)
language sql stable security invoker set search_path = public as $$
  select j.id, j.ticket, j.company_id, j.company_name, j.plate, j.service,
         j.status, j.scheduled_at, j.completed_at, j.price_excl
    from public.wash_jobs j
   where public.kenteken_kaal(j.plate) = public.kenteken_kaal(zoek_naar)
   order by j.scheduled_at desc
   limit greatest(1, least(coalesce(hoeveel, 50), 500));
$$;

grant execute on function public.wagen_historie(text, integer) to authenticated;

comment on function public.wagen_historie(text, integer) is
  'De wasbeurten van één kenteken, ongeacht schrijfwijze (0117). Leest '
  'wash_jobs, dus jobs_select bepaalt wat je ervan ziet.';

-- ---------------------------------------------------------------------------
--  4. Welke kentekens kennen we nog niet?
--
--  De andere kant op, en dit is de vraag waar het project voor bestaat:
--  "controleren of er voor elk kenteken wel een order gemaakt is."
--
--  Zolang er geen camera-events zijn, is de beste benadering: kentekens die
--  in de wasbeurten voorkomen maar in geen enkel wagenpark staan. Dat is het
--  werk dat er ligt voordat de camera erbij komt -- en straks de lijst waar
--  een gelezen kenteken tegenaan gehouden wordt.
-- ---------------------------------------------------------------------------

create or replace function public.kentekens_zonder_wagen(sinds bigint default 0)
returns table (
  kenteken_kaal text,
  voorbeeld     text,
  hoeveel       bigint,
  laatst_op     bigint,
  bedrijven     bigint
)
language sql stable security invoker set search_path = public as $$
  select public.kenteken_kaal(j.plate)     as kenteken_kaal,
         min(j.plate)                      as voorbeeld,
         count(*)                          as hoeveel,
         max(j.scheduled_at)               as laatst_op,
         count(distinct j.company_id)      as bedrijven
    from public.wash_jobs j
   where j.scheduled_at >= coalesce(sinds, 0)
     and public.kenteken_kaal(j.plate) <> ''
     and not exists (
           select 1 from public.wagen w
            where w.kenteken_kaal = public.kenteken_kaal(j.plate)
         )
   group by 1
   order by max(j.scheduled_at) desc;
$$;

grant execute on function public.kentekens_zonder_wagen(bigint) to authenticated;

comment on function public.kentekens_zonder_wagen(bigint) is
  'Kentekens die zijn gewassen maar in geen enkel wagenpark staan (0117). '
  'De aanvullijst, en straks waar een camerakenteken tegenaan gehouden wordt.';
