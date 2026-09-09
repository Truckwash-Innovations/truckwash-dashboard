-- ===========================================================================
--  Klanten beheren
--
--  Casper: "Daarnaast moet je alle klanten, gebruikers ect kunnen beheren bij
--  managment, kunnen aanmaken."
--
--  Het beheerscherm zelf is app-werk; deze migratie is wat er in de database
--  moet staan vóórdat zo'n scherm veilig kan bestaan.
--
--  Waarom hij het niet kon vinden
--  ------------------------------
--
--  Drie dingen heten "Klant". public.companies is het factuuradres, een
--  Werkgever is het transportbedrijf waarvan de chauffeurs komen wassen, en de
--  rol customer is het inlogaccount dat aan een company hangt. Het menu-item
--  "Klanten" opent het werkgeversscherm. Een scherm voor companies bestond
--  niet -- en er is in de hele app ook geen enkele schrijfactie op die tabel.
--
--  companies_write staat al open voor het management, dus de database kon het
--  al. Wat eraan ontbrak zijn de twee dingen hieronder.
--
--  1. Een verwijdering die zichzelf meldt
--  --------------------------------------
--
--  0038 maakte meld_verwijdering() zodat een gewiste rij op elk apparaat
--  verdwijnt. Die trigger staat op notifications en signups, en verder
--  nergens. Gooi je nu een klant weg, dan blijft hij op elke telefoon en elke
--  laptop in de plaatselijke kopie staan -- de opruimmachinerie werkt wel,
--  maar krijgt niets te horen.
--
--  2. Een verwijdering die niet stil mislukt
--  -----------------------------------------
--
--  wash_jobs.company_id is on delete restrict (0001:75). Een klant met ook maar
--  één wasbeurt kan Postgres dus niet verwijderen; je krijgt foutcode 23001 met
--  een tekst over een vreemde sleutel. Dat is goed -- die wasbeurten zijn
--  omzet -- maar het is geen zin die je aan iemand kunt laten zien.
--
--  Erger is wat er NIET tegengehouden wordt: verkoopfactuur.company_id
--  (0064:83) en company_exact.company_id (0063:87) wijzen naar een klant maar
--  hebben helemaal geen vreemde sleutel. Gooi je die klant weg, dan blijven
--  zijn verkoopfacturen en zijn Exact-koppeling achter en wijzen ze naar een
--  bedrijf dat niet meer bestaat. Niets houdt dat tegen en niets meldt het.
--
--  Er komt geen vreemde sleutel bij: die zou nu al bestaande wezen weigeren en
--  daarmee de migratie laten omvallen op gegevens die er nu eenmaal zijn. In
--  plaats daarvan een trigger die vóór het verwijderen kijkt en met een leesbare
--  zin weigert.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Wat houdt het verwijderen van deze klant tegen?
--
--  Als functie, zodat het scherm het kan vragen VOORDAT iemand op verwijderen
--  drukt. Een knop die pas bij het indrukken vertelt dat het niet kan, is een
--  knop die je twee keer moet uitleggen.
-- ---------------------------------------------------------------------------

create or replace function public.klant_verwijderen_belet(klant_in text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  wasbeurten integer;
  facturen   integer;
  mensen     integer;
begin
  select count(*) into wasbeurten from public.wash_jobs   where company_id = klant_in;
  select count(*) into facturen   from public.verkoopfactuur where company_id = klant_in;
  select count(*) into mensen     from public.profiles    where company_id = klant_in;

  if wasbeurten > 0 then
    return 'Er staan ' || wasbeurten || ' wasbeurten op deze klant. Die zijn omzet '
        || 'en blijven bewaard, dus de klant kan niet weg.';
  end if;

  if facturen > 0 then
    return 'Er liggen ' || facturen || ' verkoopfacturen op deze klant. Een factuur '
        || 'zonder klant is een factuur die niemand meer kan thuisbrengen.';
  end if;

  /*
   * Profielen worden bij een verwijdering op null gezet (0001:66), dus
   * Postgres houdt dit niet tegen. Wel het melden waard: die mensen raken
   * daarmee hun klantenportaal kwijt.
   */
  if mensen > 0 then
    return 'Er hangen ' || mensen || ' inlogaccounts aan deze klant. Haal die er '
        || 'eerst af, anders komen ze nergens meer binnen.';
  end if;

  return null;
end $$;

revoke execute on function public.klant_verwijderen_belet(text) from public, anon;
grant  execute on function public.klant_verwijderen_belet(text) to authenticated, service_role;

comment on function public.klant_verwijderen_belet(text) is
  'Leeg als deze klant weg mag; anders een zin die zegt waarom niet. Bedoeld om te tonen voordat iemand op verwijderen drukt.';

-- ---------------------------------------------------------------------------
--  2. En dezelfde vraag als slot, vlak voor het verwijderen
--
--  Niet alleen in het scherm. Een verwijdering kan ook via de wachtrij van een
--  ander apparaat binnenkomen, of met de hand in de SQL-editor.
-- ---------------------------------------------------------------------------

create or replace function public.klant_niet_zomaar_weg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare reden text;
begin
  reden := public.klant_verwijderen_belet(old.id);
  if reden is not null then
    raise exception '%', reden using errcode = 'restrict_violation';
  end if;
  return old;
end $$;

revoke execute on function public.klant_niet_zomaar_weg() from public, anon, authenticated;

drop trigger if exists klant_niet_zomaar_weg_trg on public.companies;
create trigger klant_niet_zomaar_weg_trg
  before delete on public.companies
  for each row execute function public.klant_niet_zomaar_weg();

-- ---------------------------------------------------------------------------
--  3. En als hij dan weg mag: het melden
--
--  meld_verwijdering() bestaat sinds 0038 en stond op twee tabellen. Voor
--  companies werkt hij meteen: de tabelnaam in Postgres en de EntityName in de
--  app heten allebei 'companies'.
-- ---------------------------------------------------------------------------

drop trigger if exists companies_verwijderd on public.companies;
create trigger companies_verwijderd
  after delete on public.companies
  for each row execute function public.meld_verwijdering();
