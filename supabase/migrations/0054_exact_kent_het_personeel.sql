-- ===========================================================================
--  Exact kent het personeel, en wij weten wie wie is
--
--  Casper: "voor personeel mag je alles doen."
--
--  Wat er dan niet blijkt te kunnen
--  --------------------------------
--
--  Personeel naar Exact exporteren kan niet. De HRM-kant van de Exact-API is
--  alleen-lezen: payroll/Employees, Employments, EmploymentContracts en
--  EmploymentSalaries ondersteunen GET en verder niets. Er is geen POST en
--  geen PUT -- je kunt via de API geen medewerker aanmaken of wijzigen.
--
--  Dat is geen tekortkoming van deze migratie maar van wat Exact aanbiedt, en
--  het is maar goed ook dat het hier staat: een export bouwen die stilzwijgend
--  door Exact wordt geweigerd is werk dat er af uitziet en niets doet.
--
--  Eén ding is wél te schrijven: payroll/VariableMutations (GET, POST, PUT).
--  Dat zijn de variabele loonmutaties -- gewerkte uren, verlof, toeslagen per
--  loonperiode. Precies het werk dat elke maand met de hand gaat. Daar is deze
--  migratie de voorbereiding voor, want zo'n mutatie wijst naar een
--  EmployeeHID en die moeten we eerst kennen.
--
--  Wat er dus wel gebeurt
--  ----------------------
--
--    exact_personeel   wie Exact kent, opgehaald en verder onaangeraakt
--    exact_medewerker  wie bij ons wie is daar
--
--  Twee tabellen en geen kolom op profiles, met opzet. profiles gaat mee in
--  de synchronisatie naar elk apparaat; een koppeltabel die alleen de server
--  leest, blijft op de server.
--
--  De vergelijking beantwoordt drie vragen, en de derde is de belangrijkste:
--  wie staat in Exact uit dienst terwijl hij hier nog actief is? Dat is
--  iemand die weg is en nog steeds kan inloggen.
--
--  Het hele record, en wat dat betekent voor wie erbij mag
--  -------------------------------------------------------
--
--  Casper wil bij een medewerker de bijbehorende Exact-medewerker kunnen
--  opzoeken "waar dus ook alle dingen bij meekomen". Daarom komt het hele
--  antwoord van Exact mee, in kolom ruw. Dat is niet luiheid: een vaste
--  lijst velden opgeven betekent dat je ze allemaal bij naam moet kennen,
--  en één verzonnen veldnaam in een $select laat Exact het hele verzoek
--  weigeren. Wat we zeker weten staat in eigen kolommen; de rest blijft
--  bewaard zoals het binnenkwam.
--
--  Daar hangt wel iets aan. In dat hele record kunnen het
--  burgerservicenummer en de geboortedatum zitten, en dat is precies wat in
--  0009 achter slot ligt: personnel_private is te lezen door het management
--  en door jezelf, en door verder niemand. Zou deze tabel ruimer staan --
--  bijvoorbeeld op staff.view, waar een leidinggevende onder valt -- dan is
--  het BSN via de achterdeur alsnog breder te zien dan via het dossier.
--
--  Vandaar: alleen het management. Dezelfde grens als het dossier zelf,
--  want het zijn dezelfde gegevens.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Wie Exact kent
-- ---------------------------------------------------------------------------

create table if not exists public.exact_personeel (
  /* Het medewerkernummer van Exact. Dit is waar een loonmutatie naar wijst,
     en daarom de sleutel: het is het enige dat straks nog meetelt. */
  employee_hid   integer primary key,
  /* Het interne id (een guid). Sommige aanroepen willen die in plaats van
     het nummer. */
  exact_id       text,
  volledige_naam text not null default '',
  voornaam       text,
  achternaam     text,
  email          text,
  prive_email    text,
  in_dienst_per  bigint,
  uit_dienst_per bigint,
  actief         boolean not null default true,
  /* Alles wat Exact meestuurde, onaangeraakt. Hierin kan een BSN zitten;
     zie de kop voor waarom deze tabel daarom management-only is. */
  ruw            jsonb,
  division       text,
  updated_at     bigint not null default public.now_ms()
);

/* Voor wie de migratie al eens draaide toen deze kolom er nog niet was. */
alter table public.exact_personeel add column if not exists ruw jsonb;

create index if not exists exact_personeel_email_idx
  on public.exact_personeel (lower(email));

comment on table public.exact_personeel is
  'Het personeel zoals Exact het kent (0054). Alleen-lezen aan de kant van '
  'Exact: er is geen POST of PUT op payroll/Employees. Kolom ruw bevat het '
  'volledige antwoord en kan een BSN bevatten -- daarom management-only, '
  'dezelfde grens als personnel_private (0009).';

-- ---------------------------------------------------------------------------
--  Wie bij ons wie is daar
--
--  Los van profiles gehouden: die tabel synchroniseert mee naar elke tablet,
--  en dit is serverwerk.
-- ---------------------------------------------------------------------------

create table if not exists public.exact_medewerker (
  /* profiles.id, als tekst. De rest van dit schema doet hetzelfde. */
  user_id      text primary key,
  employee_hid integer not null,
  /* Hoe de koppeling tot stand kwam: 'email', 'naam' of 'handmatig'. Bij een
     verschil van mening wil je weten of een mens het zei of een regel. */
  bron         text not null default 'handmatig'
               check (bron in ('email', 'naam', 'handmatig')),
  door         text,
  updated_at   bigint not null default public.now_ms()
);

/* Eén iemand hier hoort bij één iemand daar, en andersom. Zonder dit kunnen
   twee medewerkers aan hetzelfde loonnummer hangen, en dan komen de uren van
   twee mensen op één loonstrook terecht. */
create unique index if not exists exact_medewerker_hid_uniek
  on public.exact_medewerker (employee_hid);

comment on table public.exact_medewerker is
  'Welke medewerker hier welk medewerkernummer in Exact heeft (0054). Nodig '
  'voordat er loonmutaties heen kunnen.';

-- ---------------------------------------------------------------------------
--  Wat er wanneer is opgehaald
-- ---------------------------------------------------------------------------

insert into public.exact_sync (soort) values ('personeel')
on conflict (soort) do nothing;

-- ---------------------------------------------------------------------------
--  Wie mag dit zien
--
--  Alleen het management, en dat is strenger dan bij het rekeningschema
--  (waar ontwikkeling meekijkt) én strenger dan staff.view. De reden staat
--  in de kop: in kolom ruw kan een BSN zitten, en dat is in 0009 met opzet
--  beperkt tot het management en de medewerker zelf. Een tabel ernaast die
--  hetzelfde bevat maar ruimer openstaat, maakt die afspraak waardeloos.
--
--  Schrijven doet geen mens: de Edge Function werkt met de servicesleutel.
-- ---------------------------------------------------------------------------

alter table public.exact_personeel  enable row level security;
alter table public.exact_medewerker enable row level security;

do $$
declare t text;
begin
  foreach t in array array['exact_personeel', 'exact_medewerker'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated '
      'using (public.is_management())',
      t, t);
  end loop;
end $$;
