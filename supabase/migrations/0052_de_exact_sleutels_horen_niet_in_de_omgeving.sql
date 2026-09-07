-- ===========================================================================
--  De Exact-sleutels verhuizen van de omgeving naar de database
--
--  De vraag van Casper: "ik heb nu een exact dev account, dus niet de
--  realtime, zorg dat je dit makkelijk in het dashboard bij ontwikkelaar kan
--  aanpassen dan wel aub".
--
--  Tot nu toe stonden EXACT_CLIENT_ID en EXACT_CLIENT_SECRET als geheim op
--  de server. Dat is een prima plek voor iets dat nooit verandert, en een
--  slechte plek voor iets dat je aan het uitproberen bent: elke wijziging is
--  "supabase secrets set" plus opnieuw uitrollen, en dat wil je niet doen
--  terwijl je nog aan het uitzoeken bent welke sleutels Exact eigenlijk
--  geeft.
--
--  Waarom hier en niet in instellingen
--  -----------------------------------
--
--  instellingen synchroniseert mee naar elke tablet en elke telefoon. Het
--  clientgeheim van Exact is de helft van de sleutel tot de boekhouding; dat
--  hoort daar dus niet. exact_koppeling heeft RLS aan zonder ook maar één
--  policy -- alleen de servicesleutel komt erbij, en dat is precies wat een
--  geheim nodig heeft. De tokens liggen daar al om dezelfde reden.
--
--  Proef of echt
--  -------------
--
--  Een dev-account van Exact en de echte administratie zien er in het
--  dashboard identiek uit, en dat is gevaarlijk: een testfactuur in de echte
--  boekhouding is werk voor de accountant, en een echte factuur in een
--  proefadministratie is een factuur die niemand meer terugvindt. Daarom
--  staat het er met zoveel woorden bij, zodat het scherm het kan tonen.
--
--  De basis-URL erbij
--  ------------------
--
--  Exact draait per land op een eigen adres, en een proefomgeving kan daar
--  weer van afwijken. Die stond hard in de functie. Nu niet meer -- maar wel
--  met een slot erop, want naar dat adres gaat het clientgeheim toe. Welke
--  adressen mogen staat in de Edge Function, niet hier: een controle die je
--  in de database zet geldt alleen voor wat via de database binnenkomt.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Wat erbij komt
-- ---------------------------------------------------------------------------

alter table public.exact_koppeling add column if not exists client_id      text;
alter table public.exact_koppeling add column if not exists client_geheim  text;
alter table public.exact_koppeling add column if not exists basis_url      text;
alter table public.exact_koppeling add column if not exists redirect_uri   text;
alter table public.exact_koppeling add column if not exists omgeving       text;

/* Wie de sleutels heeft gezet, en wanneer. Niet om iemand aan te wijzen maar
   om te kunnen zien of de sleutels van vandaag zijn of van drie maanden
   terug -- bij "het werkt ineens niet meer" is dat de eerste vraag. */
alter table public.exact_koppeling add column if not exists sleutels_door  text;
alter table public.exact_koppeling add column if not exists sleutels_at    bigint;

do $$
begin
  alter table public.exact_koppeling drop constraint if exists exact_koppeling_omgeving_check;
  alter table public.exact_koppeling add constraint exact_koppeling_omgeving_check
    check (omgeving is null or omgeving in ('proef', 'echt'));
exception when others then
  raise notice 'omgeving-controle niet gezet: %', sqlerrm;
end $$;

comment on column public.exact_koppeling.client_geheim is
  'Het clientgeheim van de Exact-app. Staat hier en niet in instellingen: '
  'instellingen synchroniseert mee naar elk apparaat, deze tabel niet (0052).';

comment on column public.exact_koppeling.omgeving is
  '"proef" voor een dev-account van Exact, "echt" voor de administratie waar '
  'de boekhouding in staat. Alleen om het in het dashboard te kunnen tonen; '
  'de koppeling zelf werkt hetzelfde (0052).';

comment on column public.exact_koppeling.basis_url is
  'Het adres van Exact, bijvoorbeeld https://start.exactonline.nl. Leeg = '
  'wat er in de Edge Function als standaard staat. Welke adressen zijn '
  'toegestaan bepaalt die functie, niet deze tabel: hier langs is niet de '
  'enige weg naar binnen (0052).';

-- ---------------------------------------------------------------------------
--  De rij moet bestaan
--
--  De functie doet een upsert en redt zich ook zonder, maar een lege rij die
--  er al staat maakt het scherm eerlijker: "nog niets ingesteld" in plaats
--  van "geen koppeling gevonden".
-- ---------------------------------------------------------------------------

insert into public.exact_koppeling (id, status, omgeving)
values ('exact', 'los', 'proef')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  Geen policy. Met opzet.
--
--  RLS staat aan op deze tabel en er hoort er nooit een bij te komen. Wie de
--  sleutels wil zien of zetten gaat langs de Edge Function, die kijkt wie er
--  belt. Een policy hier zou betekenen dat het clientgeheim in de gewone
--  synchronisatie terecht kan komen.
-- ---------------------------------------------------------------------------
