-- ===========================================================================
--  Exact kent het rekeningschema, en de bon weet waar hij heen ging
--
--  De vraag van Casper: "zorg dat ik op een goeie manier een koppeling kan
--  maken met exact, en vanuit daar ook dingen kan exporteren (personeel,
--  facturen ect) grootboekrekeningen moeten ook met exact syncen, zodat
--  alles netjes kan staan".
--
--  Waarom het rekeningschema NIET over public.grootboek heen gaat
--  --------------------------------------------------------------
--
--  Dat lijkt de kortste weg en het is de verkeerde. In 0044 staat er met
--  zoveel woorden bij waarom grootboek klein is: "alleen de rekeningen die
--  hier werkelijk gebruikt worden. Een compleet rekeningschema overtypen
--  levert een lijst op waar niemand doorheen komt." Een administratie in
--  Exact heeft er al gauw een paar honderd. Wie die er allemaal in kiepert,
--  krijgt bij elke bon een keuzelijst waar de administratie niet meer in
--  vindt wat ze zoekt -- en de zorgvuldig gekozen namen en trefwoorden zijn
--  dan bovendien overschreven door de omschrijving uit Exact.
--
--  Dus twee lijsten, met een brug ertussen:
--
--    public.grootboek        wat WIJ gebruiken, kort en met eigen woorden
--    public.exact_grootboek  wat EXACT kent, compleet en onaangeraakt
--
--  Daarmee kan het scherm de vraag beantwoorden waar het echt om gaat:
--  bestaat elke code waarop wij boeken ook in Exact, en heet hij daar
--  hetzelfde? Een code die hier wel bestaat en daar niet, is een boeking die
--  straks geweigerd wordt -- dat wil je zien vóórdat de factuur weg is, niet
--  erna. En een rekening uit Exact overnemen is dan één handeling.
--
--  Wat er van een bon bijkomt
--  --------------------------
--
--  Drie velden op expenses: waar hij in Exact terechtkwam, wanneer, en wat
--  er misging als het niet lukte. Zonder dat eerste veld is er geen manier
--  om te weten of een bon al verstuurd is, en dan staat dezelfde factuur na
--  een tweede poging twee keer in de boekhouding.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Het rekeningschema zoals Exact het kent
--
--  Een kopie, geen bron. Hij wordt in zijn geheel bijgewerkt door de sync en
--  door niemand anders geschreven. Daarom geen id-kolom met een eigen
--  naamgeving: de sleutel is de code zoals Exact hem gebruikt.
-- ---------------------------------------------------------------------------

create table if not exists public.exact_grootboek (
  /* De code uit Exact, bijvoorbeeld 4031. Dit is wat op een boeking staat en
     waar public.grootboek.code op moet aansluiten. */
  code         text primary key,
  omschrijving text not null default '',
  /* Het interne id van Exact (een guid). Nodig zodra we een boeking maken:
     Exact wil daar zijn eigen sleutel zien en niet de code. */
  exact_id     text,
  /* Wat voor rekening het is volgens Exact (kosten, balans, ...). Als tekst
     bewaard: de nummers die Exact daarvoor gebruikt zeggen niemand iets. */
  soort        text,
  geblokkeerd  boolean not null default false,
  /* Uit welke administratie deze lijst komt. Wisselt iemand van proef naar
     echt, dan hoort de oude lijst niet stilletjes te blijven staan. */
  division     text,
  updated_at   bigint not null default public.now_ms()
);

create index if not exists exact_grootboek_division_idx
  on public.exact_grootboek (division);

comment on table public.exact_grootboek is
  'Het rekeningschema zoals het in Exact staat (0053). Een kopie die de sync '
  'bijwerkt; public.grootboek blijft de korte lijst die wij zelf gebruiken.';

-- ---------------------------------------------------------------------------
--  Wat er wanneer is opgehaald of verstuurd
--
--  Eén rij per soort werk. Geen aan/uit-vlag: wat er gesynchroniseerd wordt
--  bepaalt de knop die je indrukt, en een vlag die standaard aan staat is een
--  achtergrondproces dat je niet ziet draaien.
-- ---------------------------------------------------------------------------

create table if not exists public.exact_sync (
  soort      text primary key,
  laatst_at  bigint,
  aantal     integer not null default 0,
  laatste_fout text,
  door       text,
  updated_at bigint not null default public.now_ms()
);

insert into public.exact_sync (soort) values
  ('grootboek'), ('facturen')
on conflict (soort) do nothing;

comment on table public.exact_sync is
  'Wanneer er voor het laatst met Exact is uitgewisseld, per soort (0053).';

-- ---------------------------------------------------------------------------
--  Waar de bon in Exact terechtkwam
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists exact_id   text;
alter table public.expenses add column if not exists exact_at   bigint;
alter table public.expenses add column if not exists exact_fout text;

/* Twee keer dezelfde bon versturen is twee keer dezelfde factuur in de
   boekhouding. Uniek dus -- en dat vangt ook het geval waarin twee mensen
   tegelijk op "versturen" drukken, want dan verliest de tweede. */
create unique index if not exists expenses_exact_id_uniek
  on public.expenses (exact_id) where exact_id is not null;

comment on column public.expenses.exact_id is
  'Het id van de boeking in Exact (0053). Gevuld = deze bon is verstuurd en '
  'gaat niet nog een keer.';

-- ---------------------------------------------------------------------------
--  Wie mag wat zien
--
--  Lezen: iedereen die bij de administratie hoort, want het scherm dat de
--  twee lijsten naast elkaar zet is een administratiescherm. Schrijven: geen
--  mens. Deze tabellen worden alleen door de Edge Function bijgewerkt, met de
--  servicesleutel, en die trekt zich van RLS niets aan.
--
--  Er staat dus met opzet geen insert- of update-policy. Dat is niet
--  vergeten: een kopie die iemand met de hand kan bijwerken is geen kopie
--  meer, en dan weet je bij een verschil niet meer wie er gelijk heeft.
-- ---------------------------------------------------------------------------

alter table public.exact_grootboek enable row level security;
alter table public.exact_sync      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['exact_grootboek', 'exact_sync'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated '
      'using (public.is_management() or public.heeft_recht(''admin.desk'') '
      '       or public.heeft_recht(''dev.logs''))',
      t, t);
  end loop;
end $$;
