-- ===========================================================================
--  Wat van de server is, staat in een lijst -- niet in een trigger erbij
--
--  Casper: "fix het allemaal" -- de vijfde van zes.
--
--  Wat er stond
--  ------------
--
--  Op public.expenses staan veertig toegevoegde kolommen en zes triggers die
--  vóór elke wijziging draaien. Dat is geen fout; het is een tabel die vier
--  levens tegelijk draagt:
--
--    het lezen       wat de AI van de factuur maakte
--    het goedkeuren  eerste handtekening, tweede, afkeuren
--    het boeken      wat Exact ervan vond
--    het betalen     wanneer het geld weg is
--
--  De app schrijft een kostenpost terug als HELE rij -- dat is hoe de
--  synchronisatie werkt. Daarmee zitten de kolommen van alle vier die levens
--  in elke wijziging, ook als iemand alleen een tag aanvinkt. Zonder rem kan
--  degene die een tag aanvinkt dus betaald_at zetten.
--
--  Er stonden twee triggers om dat tegen te houden, elk voor hun eigen groep
--  kolommen:
--
--    lezing_blijft_lezing()           0029, voor "gelezen"
--    betalen_blijft_van_de_server()   0100, voor acht betaal- en Exactvelden
--
--  Ze doen precies hetzelfde, en bij elke nieuwe kolom moest er een regel bij
--  -- of een derde trigger. Dat is het patroon dat hier wordt doorgeknipt.
--
--  Wat het wordt
--  -------------
--
--  Eén tabel die zegt welke kolommen van de server zijn, en één trigger die
--  ze terugzet. Een nieuwe serverkolom is dan een regel in een tabel, geen
--  nieuwe trigger en geen nieuwe migratie met plpgsql erin.
--
--  En er gaan er zes bij die er nooit in stonden, waaronder exact_id. Dat is
--  geen opruimwerk maar een gat: exact_id is het bewijs dat een factuur in
--  Exact geboekt IS. Kon de app hem overschrijven -- en sinds de wachtrij
--  een leeggemaakt veld als null meestuurt, kan dat -- dan staat een geboekte
--  factuur weer als ongeboekt in de rij. En dan wordt hij een tweede keer
--  geboekt.
--
--  Wat hier NIET gebeurt
--  ---------------------
--
--  De kolommen worden niet verplaatst. Betalen een eigen tabel geven zou
--  netter zijn, maar het raakt betaalbaar(), betaalstatus_bijwerken(),
--  betaal_blijft_hangen(), de edge function en vier schermen -- en dat
--  allemaal in de week dat de eerste echte facturen erdoorheen gaan. De
--  klacht was dat er bij elke wijziging een trigger bij moest; dát is
--  hiermee weg. Verhuizen kan later, met dezelfde tests eronder.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. De lijst
-- ---------------------------------------------------------------------------

create table if not exists public.kolom_van_de_server (
  tabel  text not null,
  kolom  text not null,
  /* Waarom deze kolom niet uit de app mag komen. Staat in de foutmelding van
     niemand, maar wel in de kop van de volgende die zich afvraagt waarom
     zijn wijziging niet aankomt. */
  waarom text not null default '',
  primary key (tabel, kolom)
);

comment on table public.kolom_van_de_server is
  'Kolommen die alleen de server schrijft (0105). De trigger '
  'blijft_van_de_server() zet ze terug zodra een gewone gebruiker ze '
  'meestuurt -- de app schrijft een rij altijd in zijn geheel terug.';

alter table public.kolom_van_de_server enable row level security;

/* Lezen mag wie binnen werkt; het is geen geheim en het scheelt zoeken.
   Schrijven doet niemand: dit is schema, geen gegevens. */
drop policy if exists kolom_van_de_server_lezen on public.kolom_van_de_server;
create policy kolom_van_de_server_lezen on public.kolom_van_de_server
  for select using (public.is_staff());

-- ---------------------------------------------------------------------------
--  2. De ene trigger
--
--  Via jsonb, want een trigger die met een lijst kolomnamen werkt kan er niet
--  met new.<naam> bij. to_jsonb en terug is hier goedkoop: het gaat om
--  hooguit een paar honderd wijzigingen per dag, niet om een kassastroom.
-- ---------------------------------------------------------------------------

create or replace function public.blijft_van_de_server()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  nieuw jsonb;
  oud   jsonb;
  k     text;
begin
  /* De serverfuncties werken met de servicesleutel en hebben geen my_id().
     Zij mogen alles; deze rem geldt alleen voor wat uit de app komt. */
  if public.my_id() is null then return new; end if;

  nieuw := to_jsonb(new);
  oud   := to_jsonb(old);

  for k in
    select kolom from public.kolom_van_de_server where tabel = tg_table_name
  loop
    /* Een kolom die niet (meer) bestaat stilletjes overslaan. jsonb_set geeft
       null terug zodra een van zijn argumenten null is, en dan zou één regel
       in deze tabel de hele wijziging wissen. */
    if oud ? k then
      nieuw := jsonb_set(nieuw, array[k], oud -> k);
    end if;
  end loop;

  return jsonb_populate_record(new, nieuw);
end $$;

revoke execute on function public.blijft_van_de_server() from public, anon, authenticated;

comment on function public.blijft_van_de_server() is
  'Zet de kolommen uit public.kolom_van_de_server terug op wat er stond '
  '(0105). Vervangt lezing_blijft_lezing() en betalen_blijft_van_de_server(), '
  'die hetzelfde deden voor twee vaste groepen kolommen.';

-- ---------------------------------------------------------------------------
--  3. Welke kolommen dat zijn, op expenses
-- ---------------------------------------------------------------------------

insert into public.kolom_van_de_server (tabel, kolom, waarom) values
  /* Het lezen (0029). Wie dit in de app zou aanpassen, maakt van een verslag
     een bewering. */
  ('expenses', 'gelezen',          'de uitkomst van het lezen is een verslag, geen invulveld'),
  ('expenses', 'lees_status',      'of het lezen lukte bepaalt de lezer, niet het scherm'),
  ('expenses', 'lees_geclaimd_at', 'de wachtrij van de lezer'),
  ('expenses', 'lezer',            'welk model het las'),

  /* Het boeken (0086, 0099). exact_id is het bewijs dat er geboekt IS. */
  ('expenses', 'exact_id',         'het bewijs dat deze factuur in Exact staat; overschrijven betekent dubbel boeken'),
  ('expenses', 'exact_at',         'wanneer Exact hem aannam'),
  ('expenses', 'exact_nummer',     'het boekstuknummer van Exact'),
  ('expenses', 'exact_document',   'de bijlage zoals Exact hem kent'),
  ('expenses', 'exact_document_fout', 'waarom de bijlage niet aankwam'),
  ('expenses', 'exact_fout',       'de weigering van Exact; de app zou een opgeloste weigering terugschrijven'),
  ('expenses', 'exact_fout_at',    'wanneer die weigering kwam'),

  /* Het betalen (0100). "Dit moet echt feilloos zijn." */
  ('expenses', 'betaald_at',       'betaald is een feit van de bank, geen klik'),
  ('expenses', 'betaald_door',     'wie de opdracht uitvoerde'),
  ('expenses', 'betaalbatch_id',   'in welke opdracht hij zit'),
  ('expenses', 'aangeboden_at',    'wanneer hij naar de bank ging'),
  ('expenses', 'exact_betaalstatus',    'wat Exact van de betaling vindt'),
  ('expenses', 'exact_betaalstatus_at', 'wanneer dat is opgehaald')
on conflict (tabel, kolom) do update set waarom = excluded.waarom;

-- ---------------------------------------------------------------------------
--  4. De twee oude triggers eruit, de nieuwe erin
--
--  De naam luistert nauw. Postgres laat BEFORE UPDATE-triggers op alfabet
--  lopen, en die volgorde draagt hier betekenis:
--
--    expenses_blijft_van_de_server   zet exact_fout terug op wat er stond
--    expenses_btw_bedrag_volgt
--    expenses_exact_fout_opruimen    en wist hem als er iets is opgelost
--
--  Andersom zou de opruiming ongedaan worden gemaakt door de rem, en bleef
--  een weigering staan die allang verholpen was. "blijft" sorteert vóór
--  "btw"; dat is geen toeval maar een keuze, en er staat een controle op.
-- ---------------------------------------------------------------------------

drop trigger if exists expenses_lezing on public.expenses;
drop trigger if exists expenses_betalen_van_de_server on public.expenses;

drop trigger if exists expenses_blijft_van_de_server on public.expenses;
create trigger expenses_blijft_van_de_server
  before update on public.expenses
  for each row execute function public.blijft_van_de_server();

/*
 * De oude functies blijven staan, en dat is met opzet.
 *
 * Wie bijwerken.sql draait terwijl er een oudere app tegen praat, heeft er
 * geen last van -- ze worden door geen enkele trigger meer aangeroepen. Ze
 * weggooien zou betekenen dat een half bijgewerkte database een functie mist
 * die een oudere migratie nog noemt, en dat is een foutmelding die niets
 * verklaart. Ze doen niets meer; dat staat in hun commentaar.
 */
comment on function public.lezing_blijft_lezing() is
  'NIET MEER IN GEBRUIK sinds 0105. Wat deze deed staat nu in '
  'public.kolom_van_de_server, en blijft_van_de_server() voert het uit.';

comment on function public.betalen_blijft_van_de_server() is
  'NIET MEER IN GEBRUIK sinds 0105. Wat deze deed staat nu in '
  'public.kolom_van_de_server, en blijft_van_de_server() voert het uit.';
