-- ===========================================================================
--  Wachtwoord vergeten -- een code in plaats van een link naar localhost
--
--  Casper: "je moet alle emails via resend doen, het vergeten wachtwoord knop
--  zit nu aan supabase, en stuurt je naar een localhost, wat niet kan?"
--
--  Hij had gelijk, en er zaten drie fouten onder elkaar:
--
--   1. De mail kwam van Supabase en niet van Resend. Alle andere post in dit
--      systeem gaat via Resend en laat een regel achter in email_log. Deze
--      niet: er was geen enkele manier om te zien of er iets was verstuurd.
--   2. resetPasswordForEmail() werd zonder redirectTo aangeroepen, dus
--      Supabase gebruikt zijn eigen Site URL. Die staat op localhost.
--   3. En zelfs met een goed adres was het dood: de client staat op
--      detectSessionInUrl: false en er is nergens een onAuthStateChange die
--      op PASSWORD_RECOVERY luistert. De link uit die mail kan in geen enkele
--      bouw (Electron, Android, web) een sessie opleveren.
--
--  Wat er in de plaats komt
--  ------------------------
--
--  Een code van acht tekens die per Resend-mail gaat, tien minuten geldig is,
--  en die je op het scherm intikt waar je hem hebt aangevraagd. Geen link, dus
--  geen adres dat ergens verkeerd kan staan -- en het werkt in de app op een
--  tablet net zo goed als in de browser.
--
--  Waarom een code en niet meteen een nieuw wachtwoord per mail
--  ------------------------------------------------------------
--
--  Dat laatste is eenvoudiger en het is precies wat de knop bij management
--  doet (1.75.0). Het verschil is wie er drukt. Bij management is dat iemand
--  die is ingelogd en die rol heeft. Hier is dat iedereen op internet die een
--  adres kan intypen. Zou dat meteen het wachtwoord vervangen, dan kan een
--  willekeurige voorbijganger elke medewerker van Truckwash1 buitensluiten
--  door een formulier in te vullen -- zonder toegang tot enig postvak.
--
--  Met een code blijft het oude wachtwoord werken tot iemand de code
--  intoetst, en die code staat alleen in het postvak van de eigenaar.
--
--  Wat hier NIET in staat
--  ----------------------
--
--  Geen policies. Deze tabel is er voor de serverfunctie en verder voor
--  niemand: RLS staat aan en er is geen enkele regel, dus authenticated en
--  anon komen er niet in. De functie werkt met de servicesleutel en gaat daar
--  langs. Precies zoals email_log het al doet (0007).
--
--  Dat is hier geen nettigheid. In deze rijen staat het mailadres van iedere
--  medewerker die ooit zijn wachtwoord kwijt was, plus het aantal pogingen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De tabel
-- ---------------------------------------------------------------------------

create table if not exists public.wachtwoord_herstel (
  id         text primary key,
  email      text   not null,
  -- Nooit de code zelf.
  --
  -- Er staat sha256(id || ':' || code). De id is een willekeurige uuid en
  -- doet dus dienst als zout. Zonder dat zou een lijst van alle 31^8 codes
  -- (ruim 800 miljard, eenmalig werk) op elke rij tegelijk passen; met het
  -- zout erin is elke rij apart werk, en die rij vervalt binnen tien minuten.
  code_hash  text   not null,
  verloopt   bigint not null,
  pogingen   int    not null default 0,
  gebruikt_at bigint,
  at         bigint not null default public.now_ms()
);

-- Zoeken gaat altijd op adres, en altijd naar de nieuwste. Zonder deze index
-- is dat een volledige tabelscan op een tabel die alleen maar groeit.
create index if not exists wachtwoord_herstel_email_idx
  on public.wachtwoord_herstel (email, at desc);

-- En voor het opruimen.
create index if not exists wachtwoord_herstel_verloopt_idx
  on public.wachtwoord_herstel (verloopt);

alter table public.wachtwoord_herstel enable row level security;

-- Geen policies, met opzet. Zie de kop.
--
-- Alleen: Supabase geeft anon en authenticated standaardrechten op nieuwe
-- tabellen in public. Met RLS aan en nul policies levert dat niets op, maar
-- het staat er wel, en een latere policy die per ongeluk breed is zou dan
-- meteen doorwerken. Dus intrekken.
revoke all on public.wachtwoord_herstel from anon, authenticated;
