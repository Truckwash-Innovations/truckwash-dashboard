-- ===========================================================================
--  Relaties uit Exact: crediteuren én klanten
--
--  Casper: "In exact staan natuurlijk relaties, dat worden onze bedrijven,
--  sync dit dan ook."
--
--  In 0058 kwam er een tabel voor de crediteuren, omdat een inkoopboeking
--  naar een guid moet wijzen. Klanten hebben precies hetzelfde nodig zodra er
--  verkoopfacturen bijkomen -- en ze staan in Exact in dezelfde lijst
--  (crm/Accounts), met alleen een vlaggetje ertussen.
--
--  Twee tabellen die dezelfde lijst ophalen betekent twee keer hetzelfde
--  verkeer en twee plekken waar dezelfde relatie kan verschillen. Dus wordt
--  het er één: exact_relatie, met per rij of het een leverancier is, een
--  klant, of beide.
--
--  Weg met exact_crediteur
--  -----------------------
--
--  Die tabel is een kopie die bij elke ophaalronde opnieuw wordt gevuld, dus
--  hij kan gewoon verdwijnen -- de eerstvolgende sync zet alles terug in de
--  nieuwe. Wat NIET verdwijnt is exact_leverancier: daar staan de koppelingen
--  die met de hand zijn gelegd, en die zijn niet opnieuw te maken.
--
--  Onze bedrijven blijven van ons
--  ------------------------------
--
--  public.companies is geen kopie van Exact. Er hangen wasbeurten aan, en
--  klantenportalen, en profielen. Een sync die daar rijen overheen zet of
--  weggooit, sloopt verwijzingen die nergens anders vandaan komen.
--
--  Dus hetzelfde als bij het grootboek (0057): een kopie ernaast, een
--  koppeling ertussen, en overnemen is een handeling. Wat automatisch gaat is
--  alleen het koppelen op naam, en alleen als het eenduidig is.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De relaties zoals Exact ze kent
-- ---------------------------------------------------------------------------

create table if not exists public.exact_relatie (
  /* De guid van Exact. Dit komt in een boeking te staan. */
  exact_id       text primary key,
  /* In welke administratie. Dezelfde firma in twee bv's is twee relaties met
     elk een eigen guid, en dat moet ook: een boeking wijst naar die van díe
     bv. */
  division       text not null,
  code           text,
  naam           text not null default '',
  /* Genormaliseerd, om automatisch op te kunnen koppelen. Zie kaal_bedrijf(). */
  zoeknaam       text,
  is_leverancier boolean not null default false,
  is_klant       boolean not null default false,
  btw_nummer     text,
  email          text,
  telefoon       text,
  plaats         text,
  updated_at     bigint not null default public.now_ms()
);

create index if not exists exact_relatie_zoek_idx on public.exact_relatie (zoeknaam);
create index if not exists exact_relatie_div_idx  on public.exact_relatie (division);

comment on table public.exact_relatie is
  'De relaties zoals Exact ze kent (0063), crediteuren en klanten in één '
  'lijst -- zo staan ze daar ook. Een kopie; de koppelingen staan in '
  'exact_leverancier en company_exact.';

/* De oude, smallere kopie kan weg: hij wordt bij elke ophaalronde opnieuw
   gevuld en staat nu in exact_relatie. exact_leverancier blijft staan --
   daar zitten de koppelingen in die met de hand zijn gelegd. */
drop table if exists public.exact_crediteur;

-- ---------------------------------------------------------------------------
--  Welk bedrijf van ons is welke relatie in Exact
--
--  Per administratie, want dezelfde klant heeft in elke bv een eigen guid.
-- ---------------------------------------------------------------------------

create table if not exists public.company_exact (
  company_id text not null,
  division   text not null,
  exact_id   text not null,
  exact_naam text,
  bron       text not null default 'handmatig'
             check (bron in ('naam', 'handmatig')),
  door       text,
  updated_at bigint not null default public.now_ms(),
  primary key (company_id, division)
);

/* Eén relatie in Exact hoort bij één bedrijf van ons. Twee zou betekenen dat
   twee klanten op dezelfde relatie boeken, en dan is niet meer te zien van
   wie een openstaande post is. */
create unique index if not exists company_exact_uniek
  on public.company_exact (division, exact_id);

comment on table public.company_exact is
  'Welk bedrijf van ons welke relatie in Exact is (0063), per administratie. '
  'Nodig zodra er verkoopfacturen heen gaan.';

-- ---------------------------------------------------------------------------
--  Klaarzetten na een ophaalronde
--
--  De zoeknaam vullen, en koppelen wat eenduidig te koppelen is -- zowel de
--  leveranciers op onze bonnen als onze bedrijven.
--
--  "Eenduidig" betekent: precies één relatie met die naam, binnen die
--  administratie. Zijn het er twee, dan is kiezen raden -- en een factuur bij
--  de verkeerde relatie boeken is de fout die niemand terugvindt.
-- ---------------------------------------------------------------------------

create or replace function public.exact_relaties_klaarzetten(door_in text default null)
returns table (leveranciers integer, bedrijven integer)
language plpgsql security definer set search_path = public as $$
begin
  update public.exact_relatie
     set zoeknaam = public.kaal_bedrijf(naam)
   where zoeknaam is distinct from public.kaal_bedrijf(naam);

  /* --- de leveranciers op onze bonnen --- */
  with kandidaten as (
    select public.kaal_bedrijf(e.supplier) as zoeknaam,
           min(e.supplier)                 as gezien_als
      from public.expenses e
     where e.status in ('open', 'eerste_akkoord', 'goedgekeurd')
       and e.exact_id is null
       and public.kaal_bedrijf(e.supplier) is not null
     group by 1
  ),
  eenduidig as (
    select k.zoeknaam, k.gezien_als, min(r.exact_id) as exact_id, min(r.naam) as naam
      from kandidaten k
      join public.exact_relatie r on r.zoeknaam = k.zoeknaam and r.is_leverancier
     where not exists (select 1 from public.exact_leverancier l where l.zoeknaam = k.zoeknaam)
     group by k.zoeknaam, k.gezien_als
    having count(*) = 1
  )
  insert into public.exact_leverancier (zoeknaam, gezien_als, exact_id, exact_naam, bron, door)
  select zoeknaam, gezien_als, exact_id, naam, 'naam', door_in from eenduidig
  on conflict (zoeknaam) do nothing;

  get diagnostics leveranciers = row_count;

  /* --- en onze bedrijven --- */
  with eenduidig as (
    select c.id as company_id, r.division, min(r.exact_id) as exact_id, min(r.naam) as naam
      from public.companies c
      join public.exact_relatie r on r.zoeknaam = public.kaal_bedrijf(c.name) and r.is_klant
     where not exists (select 1 from public.company_exact ce
                        where ce.company_id = c.id and ce.division = r.division)
     group by c.id, r.division
    having count(*) = 1
  )
  insert into public.company_exact (company_id, division, exact_id, exact_naam, bron, door)
  select company_id, division, exact_id, naam, 'naam', door_in from eenduidig
  on conflict (company_id, division) do nothing;

  get diagnostics bedrijven = row_count;

  return next;
end $$;

revoke execute on function public.exact_relaties_klaarzetten(text) from public, anon, authenticated;
grant  execute on function public.exact_relaties_klaarzetten(text) to service_role;

/* De oude naam bestaat niet meer; hij werkte op exact_crediteur. */
drop function if exists public.exact_crediteuren_klaarzetten(text);

-- ---------------------------------------------------------------------------
--  Wie mag dit zien
-- ---------------------------------------------------------------------------

alter table public.exact_relatie  enable row level security;
alter table public.company_exact  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['exact_relatie', 'company_exact'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated '
      'using (public.is_management() or public.heeft_recht(''admin.desk'') '
      '       or public.heeft_recht(''dev.logs''))',
      t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  En het soort werk
-- ---------------------------------------------------------------------------

insert into public.exact_sync (soort) values ('relaties')
on conflict (soort) do nothing;

delete from public.exact_sync where soort = 'crediteuren';
