-- ===========================================================================
--  Bijwerken: migratie 0017 tot en met 0071
--
--  Plak dit in de SQL-editor van Supabase en druk op Run. Opnieuw draaien mag.
--
--  Twijfel je of je een eerdere migratie hebt gedraaid, neem dan
--  supabase/setup.sql -- dat is het geheel, en dat mag ook opnieuw.
--
--  Dit bestand wordt gemaakt door scripts/build-bijwerken-sql.cjs. Wijzig de
--  migraties in supabase/migrations, niet dit bestand: de handgeschreven
--  versie liep uit de pas met de migraties, en dat kwam er pas uit toen het
--  in de echte database misging.
--
--  Wat erin zit:
--    0017  Berichten over de grens van het eigen bedrijf heen
--    0018  In- en uitklokken gaat via de kassa
--    0019  Een bericht als gelezen kunnen melden
--    0020  Van melding naar plan
--    0021  Wat je aan je eigen dossier mag veranderen, en de rondleiding
--    0022  Bijwerken is geen aanmaken
--    0023  Uitnodigen en uitschrijven
--    0024  Uren rechtzetten en kilometers verantwoorden
--    0025  De kluis, en het koppelen van een kassa
--    0026  De vestigingen zelf beheren
--    0027  Een foto bij het artikel
--    0028  Een kassa is geen aanmelding
--    0029  De administratie
--    0030  Gewone facturen stonden als verdacht in de postbus
--    0031  Bijwerken is nog steeds geen aanmaken
--    0032  Wat weg is, moet ook wegblijven
--    0033  De vestiging vult de website
--    0034  Anon hoort hier niet bij te kunnen
--    0035  De achttien vestigingen komen naar binnen
--    0036  Utrecht bleef op "kasweg 2112" staan
--    0037  Een kassa mag klokken
--    0038  Een verwijdering moet zichzelf melden
--    0039  Verdwaalde regeleindes in de vestigingsteksten
--    0040  Bijwerken is nog steeds geen aanmaken -- nu op alle tabellen
--    0041  Trucky praat met bezoekers
--    0042  Trucky kent de antwoorden zelf
--    0043  De app en de database waren het oneens over wie een kanaal mag maken
--    0044  Facturen boeken zichzelf
--    0045  Een kassa ziet wie er bij hem mag werken
--    0046  De foto's gaan mee naar de website
--    0047  Een verkoopfactuur is geen kostenpost
--    0048  Trucksupply ziet de voorraad
--    0049  De factuur kan ook thuis gelezen worden
--    0050  Wat drie keer hetzelfde was, hoeft de vierde keer niet opnieuw
--    0051  De eigen AI mag ook meedenken
--    0052  De Exact-sleutels verhuizen van de omgeving naar de database
--    0053  Exact kent het rekeningschema, en de bon weet waar hij heen ging
--    0054  Exact kent het personeel, en wij weten wie wie is
--    0055  Terugkomen in de app na het koppelen
--    0056  Het dossier valt uiteen: identiteit apart van geld
--    0057  Het grootboek komt uit Exact
--    0058  Goedgekeurde facturen naar Exact
--    0059  Meerdere bv's, elk met een eigen grootboek
--    0060  Vier ogen: één die kijkt, één die tekent
--    0061  De historie van een factuur, en notities erbij
--    0062  Een factuur splitsen
--    0063  Relaties uit Exact: crediteuren én klanten
--    0064  Verkoopfacturen: de andere kant van de factuurstroom
--    0065  Betaald zetten, en een SEPA-bestand voor de bank
--    0066  Links in mails wijzen naar de site, niet naar GitHub
--    0067  Werk: taken, projecten en een bord
--    0068  Vacatures en sollicitaties in eigen huis
--    0069  De vacatures die nu op de site staan komen naar binnen
--    0070  De takenmail: om 7 en om 15 uur wat er bij je ligt
--    0071  Documentbeheer
-- ===========================================================================

-- ===========================================================================
--  Berichten over de grens van het eigen bedrijf heen
--
--  Draai dit ná 0016. Opnieuw draaien mag.
--
--  De fout:
--
--      opslaan in notifications: new row violates row-level security
--      policy for table "notifications"
--
--  Dit is de tweede keer dat deze regel omvalt, en om dezelfde reden als de
--  eerste keer (0013): hij noemt wie er mag sturen in plaats van wat er
--  gestuurd wordt. Elke keer dat er iemand bij komt die geen wasser is,
--  breekt hij opnieuw.
--
--  0013 zette hem op `is_staff()` -- werknemer of management. Daar vallen
--  buiten:
--
--    * een werkgever die een chauffeur uitnodigt of loskoppelt
--    * een chauffeur die een koppelverzoek aanneemt of weigert; die heeft
--      vaak helemaal geen rol, hij rijdt alleen voor een bedrijf
--    * een werkgever die zich aanmeldt en dat bij het kantoor meldt
--    * de ontwikkelaar die op een melding antwoordt -- 'developer' is geen
--      'employee', dus die stond er ook buiten
--
--  Het bericht hoort bij de handeling. Wordt het geweigerd, dan blijft het
--  in de wachtrij staan en gaat er niets meer doorheen.
--
--  Wat blijft staan
--  ----------------
--
--  De twee dingen die er werkelijk toe doen, veranderen niet:
--
--    * je stuurt nooit op andermans naam  (from_user_id = my_id())
--    * een bericht aan een hele rol blijft voor een leidinggevende
--
--  Wat verandert is wíé je mag bereiken, en dat wordt nu een vraag over de
--  verhouding tussen twee mensen in plaats van over een rollijst:
--
--    1. wie hier werkt, bereikt zijn collega's
--    2. iedereen bereikt het kantoor -- dat is waar je heen gaat met iets
--    3. een werkgever en zijn chauffeur bereiken elkaar, beide kanten op
--
--  Wat daarmee níét kan: een klant of een chauffeur die zomaar een
--  willekeurige wasmedewerker aanschrijft. Daar is de verhouding niet, dus
--  daar gaat het bericht niet heen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Mijn eigen mailadres
--
--  Nodig omdat een uitnodiging aan een mailadres hangt en niet aan een
--  dossier: op het moment dat een chauffeur ja zegt, staat zijn id nog niet
--  op de koppeling.
-- ---------------------------------------------------------------------------

create or replace function public.my_email()
returns text language sql stable security definer set search_path = public as $$
  select email from public.profiles where auth_id = auth.uid();
$$;

grant execute on function public.my_email() to authenticated;

-- ---------------------------------------------------------------------------
--  Mag ik deze persoon een bericht sturen?
-- ---------------------------------------------------------------------------

create or replace function public.mag_bericht_sturen(doel text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- 1. Wie hier werkt, bereikt zijn collega's.
    --
    --    Ruimer dan is_staff(), want een monteur en de ontwikkelaar werken
    --    hier ook. Dat die er tot nu toe buiten vielen was geen keuze maar
    --    een gevolg van een lijst die niet is meegegroeid.
    public.is_staff()
    or 'technician' = any(public.my_roles())
    or 'developer'  = any(public.my_roles())

    -- 2. Iedereen bereikt het kantoor.
    --
    --    Een werkgever die zich aanmeldt, een klant met een vraag: die
    --    hebben één adres, en dat is management. Eén kant op: hieruit volgt
    --    niet dat management iedereen bereikt -- dat volgt al uit 1.
    or exists (
      select 1 from public.profiles p
       where p.id = doel and p.active and 'management' = any(p.roles)
    )

    -- 3. Een werkgever en zijn chauffeur bereiken elkaar.
    --
    --    De koppeling zelf is het bewijs van de verhouding. Ook een
    --    beëindigde telt hier: juist bij het loskoppelen moet het bericht
    --    aankomen, en dat gaat over dezelfde rij.
    or exists (
      select 1
        from public.employer_links l
        join public.employers e on e.id = l.werkgever_id
       where (
               -- ik ben de chauffeur, het doel beheert het bedrijf
               (l.user_id = public.my_id()
                or lower(l.email) = lower(coalesce(public.my_email(), '')))
               and doel = any(e.beheerders)
             )
          or (
               -- ik beheer het bedrijf, het doel is de chauffeur
               public.my_id() = any(e.beheerders)
               and (
                 l.user_id = doel
                 or lower(l.email) = lower(coalesce(
                      (select p.email from public.profiles p where p.id = doel), ''))
               )
             )
    );
$$;

grant execute on function public.mag_bericht_sturen(text) to authenticated;

-- ---------------------------------------------------------------------------
--  De regel zelf
-- ---------------------------------------------------------------------------

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (
    from_user_id = public.my_id()
    and (
      case
        when to_user_id is not null then public.mag_bericht_sturen(to_user_id)
        -- Een bericht aan een hele rol bereikt iedereen tegelijk. Dat hoort
        -- niet bij iemand te kunnen die alleen zijn collega wil bereiken.
        else public.is_lead()
      end
    )
  );

-- ===========================================================================
--  In- en uitklokken gaat via de kassa
--
--  Draai dit ná 0017. Opnieuw draaien mag.
--
--  Tot nu toe kon iedereen in het dashboard op "Starten" drukken en daarmee
--  zijn eigen urenstaat schrijven. Dat hoort niet thuis in een app die op
--  ieders telefoon staat: dan is inklokken iets wat je vanaf de bank doet.
--
--  Klokken hoort bij het apparaat op de vestiging. Daar toets je je
--  persoonlijke code in of scan je je badge (pos_pins), en dáármee ontstaat
--  de urenregel -- op de plek waar je ook werkelijk staat.
--
--  De regel op time_entries stond op:
--
--      using (public.is_management() or user_id = public.my_id())
--
--  Dat tweede deel is precies de zelfbediening die eruit moet. Maar het
--  eerste deel was ook niet genoeg: de kassa schrijft een urenregel voor de
--  persoon die zich zojuist heeft gemeld, en dat is een ander dossier dan
--  dat van het kassa-account zelf. Met de oude regel kon de kassa dus
--  helemaal niets wegschrijven.
--
--  Vandaar een eigen recht: hours.clock. Dat kent het management toe aan het
--  kassa-account, net zoals pos.manage. Het dashboard vraagt er nooit om.
--
--  Kijken blijft zoals het was -- je eigen uren zie je gewoon, en een
--  leidinggevende die van zijn team -- met één toevoeging: het kassa-account
--  moet ook kunnen kijken. Anders vindt het de openstaande regel niet die
--  het wil afsluiten.
-- ===========================================================================

-- De oude regel deed insert, update én delete in één keer.
drop policy if exists time_write on public.time_entries;

/*
 * En de kassa moet ook kunnen kijken.
 *
 * Niet vanzelfsprekend, dus expliciet: om iemand uit te klokken moet het
 * apparaat de regel kunnen vinden die nog openstaat. Zonder leesrecht raakt
 * die update nul rijen en gebeurt er stilletjes niets -- geen foutmelding,
 * alleen een uitklokking die er nooit is gekomen.
 *
 * Het is een apparaat op de vestiging, geen persoon: het ziet urenregels en
 * verder niets. Uurlonen en dossiers zitten in personnel_private en daar
 * komt het niet.
 */
drop policy if exists time_select on public.time_entries;
create policy time_select on public.time_entries for select to authenticated
  using (
    public.is_lead()
    or user_id = public.my_id()
    or public.heeft_recht('hours.clock')
  );

/*
 * Schrijven doet de kassa, of het kantoor als er iets rechtgezet moet
 * worden. Een medewerker schrijft niet in zijn eigen urenstaat -- ook niet
 * als klopt wat hij zou schrijven. Een urenstaat die je zelf kunt bijwerken
 * is geen urenstaat maar een voorstel.
 */
drop policy if exists time_insert on public.time_entries;
create policy time_insert on public.time_entries for insert to authenticated
  with check (public.is_management() or public.heeft_recht('hours.clock'));

/*
 * Bijwerken: de kassa, het kantoor, en -- alleen om een lopende regel af te
 * sluiten -- een leidinggevende. Die staat erbij als iemand aan het eind van
 * de dag vergeet uit te klokken, en zonder dat blijft zo'n regel eeuwig
 * openstaan. Wat hij precies mag bewaakt de trigger hieronder.
 */
drop policy if exists time_update on public.time_entries;
create policy time_update on public.time_entries for update to authenticated
  using (
    public.is_management()
    or public.heeft_recht('hours.clock')
    or (public.is_supervisor() and ended_at is null)
  )
  with check (
    public.is_management()
    or public.heeft_recht('hours.clock')
    or public.is_supervisor()
  );

/*
 * Weggooien doet alleen het kantoor. Een verkeerd gezette uitklokking
 * corrigeer je; een gewerkt uur dat verdwijnt is een gewerkt uur dat niet
 * wordt uitbetaald.
 */
drop policy if exists time_delete on public.time_entries;
create policy time_delete on public.time_entries for delete to authenticated
  using (public.is_management());

-- ---------------------------------------------------------------------------
--  Wat een leidinggevende precies mag
--
--  Beveiligingsregels kijken naar de nieuwe rij, niet naar het verschil met
--  de oude. "Alleen de eindtijd zetten" is een verschil, dus dat hoort in een
--  trigger. Zonder deze zou een leidinggevende via een openstaande regel het
--  begin, de persoon of de vestiging kunnen verzetten.
-- ---------------------------------------------------------------------------

create or replace function public.time_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_management() or public.heeft_recht('hours.clock') then
    return new;
  end if;

  if public.is_supervisor()
     and old.ended_at is null
     and new.ended_at is not null
     and new.user_id     is not distinct from old.user_id
     and new.started_at  is not distinct from old.started_at
     and new.location_id is not distinct from old.location_id
  then
    return new;
  end if;

  raise exception 'Uren schrijf je aan de kassa, niet hier';
end;
$$;

drop trigger if exists time_bewaak on public.time_entries;
create trigger time_bewaak before update on public.time_entries
  for each row execute function public.time_bewaak_wijziging();

-- ===========================================================================
--  Een bericht als gelezen kunnen melden
--
--  Draai dit ná 0018. Opnieuw draaien mag.
--
--  De fout:
--
--      opslaan in notifications: new row violates row-level security
--      policy for table "notifications"
--
--  ...op een bericht met een id als nt_mb_<mailid>_<baas>. Dat zijn de
--  seintjes die de postbus-serverfunctie maakt als er post binnenkomt. Die
--  worden dus niet door de app verstuurd -- ze worden alleen gelézen.
--
--  En daar zat het. De app kent één manier om iets naar de server te
--  brengen: de hele regel opsturen, en de database beslist of dat een nieuwe
--  regel is of een wijziging. Dat is een upsert, en bij een upsert kijkt
--  Postgres naar de regel voor INSERT én naar die voor UPDATE. Allebei
--  moeten ze meewerken.
--
--  De regel voor INSERT zegt: `from_user_id = my_id()`. Terecht -- je
--  verstuurt niet op andermans naam. Maar hij gold ook voor het openklikken
--  van een bericht dat er allang stond. Daarmee kon je alleen berichten als
--  gelezen melden die je zelf had verstuurd, en dat is nou net de categorie
--  die je niet krijgt.
--
--  Bij de seintjes uit de postbus viel het extra hard op: die hebben
--  helemaal geen afzender -- ze komen van "Postbus", niet van een persoon.
--
--  Wat er nu gebeurt: bestaat de regel al, dan is dit geen verzending maar
--  een wijziging, en dan beslist de regel voor UPDATE. Wat je aan een
--  bestaand bericht mag veranderen bewaakt de trigger eronder, en dat is
--  precies één ding: of je het gelezen hebt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Bestaat dit bericht al?
--
--  Als losse functie, want een regel op notifications die zelf notifications
--  leest draait in een kringetje. Met security definer gaat de vraag langs
--  de regels heen -- en meer dan "ja of nee" komt er niet uit.
-- ---------------------------------------------------------------------------

create or replace function public.bericht_bestaat(bericht_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.notifications n where n.id = bericht_id);
$$;

grant execute on function public.bericht_bestaat(text) to authenticated;

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (
    -- Een bestaande regel: dit is een wijziging, geen verzending.
    public.bericht_bestaat(id)
    -- Een nieuwe regel: dan gelden de eisen aan versturen onverkort.
    or (
      from_user_id = public.my_id()
      and (
        case
          when to_user_id is not null then public.mag_bericht_sturen(to_user_id)
          else public.is_lead()
        end
      )
    )
  );

-- ---------------------------------------------------------------------------
--  Wat je aan een bestaand bericht mag veranderen
--
--  Zonder dit zou de ontvanger de tekst van zijn eigen bericht kunnen
--  herschrijven. Dat is niet erg in de zin dat er iets uitlekt, maar een
--  bericht dat achteraf iets anders zegt dan er is verstuurd is geen bericht
--  meer.
--
--  De afzender mag zijn eigen bericht wel bijwerken -- die heeft het
--  geschreven. En het management sowieso.
-- ---------------------------------------------------------------------------

create or replace function public.notif_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Geen ingelogde gebruiker: dan is dit de server zelf (de serverfuncties
  -- draaien met de servicesleutel). Die komt hier niet aan banden te liggen.
  if public.my_id() is null then return new; end if;

  if public.is_management() or old.from_user_id = public.my_id() then
    return new;
  end if;

  if new.to_user_id   is not distinct from old.to_user_id
     and new.to_role  is not distinct from old.to_role
     and new.kind     is not distinct from old.kind
     and new.title    is not distinct from old.title
     and new.body     is not distinct from old.body
     and new.link     is not distinct from old.link
     and new.from_user_id is not distinct from old.from_user_id
     and new.from_name    is not distinct from old.from_name
     and new.created_at   is not distinct from old.created_at
  then
    -- Alleen read_at is veranderd. Dat is het openklikken van de bel.
    return new;
  end if;

  raise exception 'Aan een bericht van iemand anders verandert alleen of je het gelezen hebt';
end;
$$;

drop trigger if exists notif_bewaak on public.notifications;
create trigger notif_bewaak before update on public.notifications
  for each row execute function public.notif_bewaak_wijziging();

-- ===========================================================================
--  Van melding naar plan
--
--  Draai dit ná 0019. Opnieuw draaien mag.
--
--  Een melding is zelden meteen een opdracht. "Hij doet het niet" is waar en
--  onbruikbaar; "kan dit handiger" ook. Wat eraan ontbreekt zijn de vragen
--  die je anders drie dagen later alsnog stelt, als de melder allang is
--  vergeten wat hij precies deed.
--
--  Daarom: eerst een gesprek met de melder -- dat staat als gewone berichten
--  bij de melding, dus daar is hier geen tabel voor nodig -- en daarna een
--  plan in stappen.
--
--  De stappen staan als jsonb in één rij en niet als losse tabel. Ze worden
--  altijd samen gelezen en samen bijgewerkt (iemand loopt het plan langs en
--  zet vinkjes), dus een tweede tabel zou alleen maar een tweede plek zijn
--  waar het uit de pas kan lopen.
--
--  Wie wat mag:
--
--    lezen      wie meldingen mag zien -- de ontwikkelaar en het management
--    maken      wie plannen mag maken (dev.plan)
--    beslissen  het management, of wie dev.approve heeft gekregen
--
--  De melder ziet het plan niet. Hij ziet wél wat eruit besloten is: dat komt
--  als bericht bij zijn melding te staan, inclusief wat er niet gebeurt en
--  waarom. Een half plan lezen is verwarrender dan de uitkomst horen.
-- ===========================================================================

create table if not exists public.dev_plans (
  id                  text primary key,
  ticket_id           text not null references public.tickets(id) on delete cascade,
  ticket_number       text not null default '',
  titel               text not null default '',
  aanleiding          text not null default '',

  -- [{id,titel,wat,waarom,raakt,risico,omvang,gekozen,opmerking}]
  stappen             jsonb not null default '[]'::jsonb,
  buiten_scope        text,

  status              text not null default 'concept'
                      check (status in ('concept','ter beoordeling','goedgekeurd','afgewezen','uitgevoerd')),
  bron                text not null default 'handmatig'
                      check (bron in ('gesprek','vragenlijst','handmatig')),

  gemaakt_door        text,
  gemaakt_door_naam   text default '',
  gemaakt_op          bigint not null default public.now_ms(),

  beoordeeld_door     text,
  beoordeeld_door_naam text,
  beoordeeld_op       bigint,
  opmerking           text,

  uitgevoerd_in       text,
  uitgevoerd_op       bigint,

  updated_at          bigint not null default public.now_ms()
);

create index if not exists dev_plans_ticket_idx  on public.dev_plans (ticket_id);
create index if not exists dev_plans_status_idx  on public.dev_plans (status);
create index if not exists dev_plans_updated_idx on public.dev_plans (updated_at);

drop trigger if exists stamp_dev_plans on public.dev_plans;
create trigger stamp_dev_plans before insert or update on public.dev_plans
  for each row execute function public.stamp_updated_at();

-- ---------------------------------------------------------------------------
--  Beveiliging
-- ---------------------------------------------------------------------------

alter table public.dev_plans enable row level security;

create or replace function public.mag_plannen()
returns boolean language sql stable as $$
  select public.is_management()
      or 'developer' = any(public.my_roles())
      or public.heeft_recht('dev.plan');
$$;

create or replace function public.mag_plan_beslissen()
returns boolean language sql stable as $$
  select public.is_management() or public.heeft_recht('dev.approve');
$$;

grant execute on function public.mag_plannen(), public.mag_plan_beslissen() to authenticated;

drop policy if exists dev_plans_select on public.dev_plans;
create policy dev_plans_select on public.dev_plans for select to authenticated
  using (public.mag_plannen() or public.mag_plan_beslissen());

drop policy if exists dev_plans_insert on public.dev_plans;
create policy dev_plans_insert on public.dev_plans for insert to authenticated
  with check (public.mag_plannen());

drop policy if exists dev_plans_update on public.dev_plans;
create policy dev_plans_update on public.dev_plans for update to authenticated
  using (public.mag_plannen() or public.mag_plan_beslissen())
  with check (public.mag_plannen() or public.mag_plan_beslissen());

drop policy if exists dev_plans_delete on public.dev_plans;
create policy dev_plans_delete on public.dev_plans for delete to authenticated
  using (public.is_management());

/*
 * Wie het plan maakt, keurt het niet zelf goed.
 *
 * Niet omdat de ontwikkelaar niet te vertrouwen is, maar omdat dat het hele
 * punt van deze stap is: er zit iemand tussen die bepaalt wat er gebouwd
 * wordt. Valt die weg, dan is het een formulier en geen beslissing.
 *
 * En een plan dat eenmaal is uitgevoerd staat vast. Achteraf de stappen
 * bijstellen zou betekenen dat er iets anders in de app zit dan er in het
 * plan staat, en dan kun je er niet meer op terugkijken.
 */
create or replace function public.plan_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null then return new; end if;

  if old.status = 'uitgevoerd' and not public.is_management() then
    raise exception 'Een uitgevoerd plan staat vast';
  end if;

  if new.status is distinct from old.status
     and new.status in ('goedgekeurd', 'afgewezen')
  then
    if not public.mag_plan_beslissen() then
      raise exception 'Beslissen over een plan doet het management';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists plan_bewaak on public.dev_plans;
create trigger plan_bewaak before update on public.dev_plans
  for each row execute function public.plan_bewaak_wijziging();

-- ===========================================================================
--  Wat je aan je eigen dossier mag veranderen, en de rondleiding
--
--  Draai dit ná 0020. Opnieuw draaien mag.
--
--  Dit had er vanaf het begin moeten staan.
--
--  De regel op profiles luidt:
--
--      using (public.is_management() or auth_id = auth.uid())
--
--  Dat is prima voor wíé er mag schrijven, maar het zegt niets over wát.
--  Beveiligingsregels in PostgreSQL werken per rij en niet per kolom, dus
--  "je mag je eigen rij bijwerken" betekende letterlijk: je hele rij. Ook de
--  kolom `roles`.
--
--  Daarmee kon iedereen met een account zichzelf management maken. Eén
--  update op zijn eigen profiel en hij zag de omzet, de dossiers, de
--  uurlonen en de rechten van iedereen. Niet via een omweg of een truc --
--  gewoon, omdat het mocht.
--
--  Wat een kolom is die niemand over zichzelf hoort te bepalen, staat
--  hieronder. De rest -- je naam, je telefoonnummer, je voorkeuren -- mag je
--  gewoon zelf zetten, en dat blijft zo.
--
--  De rem zet zo'n kolom stilletjes terug in plaats van de hele wijziging te
--  weigeren. Dat is geen slapheid: de app stuurt een gewijzigd dossier als
--  hele rij op, met wat er lokaal bekend was, dus wie offline zijn naam
--  wijzigt terwijl het kantoor ondertussen zijn rol aanpast stuurt die oude
--  rol mee zonder iets van plan te zijn. Weigeren zou daar een wachtrij
--  opleveren die niet meer leegloopt. Wie het wél probeert bereikt precies
--  hetzelfde als hij nu bereikt: niets.
--
--  En meteen de kolom erbij voor de rondleiding: welke uitleg iemand al
--  heeft gezien. Dat hoort bij het profiel en niet op het apparaat, want
--  anders begint hij op elke telefoon opnieuw.
-- ===========================================================================

alter table public.profiles
  add column if not exists seen_tours text[] not null default '{}';

-- ---------------------------------------------------------------------------
--  De rem
-- ---------------------------------------------------------------------------

create or replace function public.profiel_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- De server zelf (serverfuncties met de servicesleutel) en het management.
  if public.my_id() is null or public.is_management() then
    return new;
  end if;

  /*
   * Iemand anders zijn dossier komt hier niet eens langs -- daar houdt de
   * beveiligingsregel hem al tegen. Wat hier gebeurt is de tweede helft: op
   * je eigen rij zijn dit de kolommen die niet van jou zijn.
   *
   * Terugzetten in plaats van weigeren, met opzet. De app stuurt een
   * gewijzigd dossier als hele rij op, met wat er lokaal bekend was. Heeft
   * het kantoor ondertussen je rol aangepast terwijl jij offline was, dan
   * stuur je die oude rol dus mee zonder dat je iets van plan bent -- en dan
   * hoort er niets te gebeuren, geen foutmelding die de wachtrij laat
   * vastlopen. Wie het wél probeert, bereikt precies hetzelfde: niets.
   */
  new.roles            := old.roles;
  new.grants           := old.grants;
  new.revokes          := old.revokes;
  new.active           := old.active;
  new.all_locations    := old.all_locations;
  new.manages          := old.manages;
  new.location_id      := old.location_id;
  new.company_id       := old.company_id;
  new.supervisor_id    := old.supervisor_id;
  new.personnel_number := old.personnel_number;
  new.job_title        := old.job_title;
  new.contract_hours   := old.contract_hours;
  new.start_date       := old.start_date;
  new.end_date         := old.end_date;
  new.hourly_rate      := old.hourly_rate;
  new.notes            := old.notes;
  new.email            := old.email;
  new.auth_id          := old.auth_id;

  /*
   * Het vinkje "moet zijn wachtwoord nog wijzigen" mag je zelf uitzetten --
   * dat is precies wat er gebeurt als je het hebt gewijzigd. Aanzetten hoort
   * bij het uitnodigen, en dat doet de server.
   */
  if new.must_change_password and not old.must_change_password then
    new.must_change_password := old.must_change_password;
  end if;

  return new;
end;
$$;

drop trigger if exists profiel_bewaak on public.profiles;
create trigger profiel_bewaak before update on public.profiles
  for each row execute function public.profiel_bewaak_wijziging();

-- ===========================================================================
--  Bijwerken is geen aanmaken
--
--  Draai dit ná 0021. Opnieuw draaien mag.
--
--  De fout:
--
--      De database weigert dit voor "expenses": new row violates row-level
--      security policy for table "expenses"
--
--  Dit is dezelfde valstrik als bij de berichten in 0019, en hij zit op meer
--  tabellen dan ik toen doorhad.
--
--  De app kent één manier om iets naar de server te brengen: de hele rij
--  opsturen, en de database laten bepalen of dat nieuw is of een wijziging.
--  Dat is een upsert. En bij een upsert kijkt Postgres naar de regel voor
--  INSERT én naar die voor UPDATE -- allebei moeten ze meewerken.
--
--  Zodra de regel voor INSERT iets zegt over wie de rij heeft gemaakt, gaat
--  dat mis bij elke wijziging door iemand anders:
--
--    expenses         `submitted_by = my_id()`. Een bon die per mail
--                     binnenkwam heeft helemaal geen indiener. Het management
--                     kon hem dus openen, maar niet goedkeuren.
--
--    employer_links   alleen de beheerder van het bedrijf mag er een maken.
--                     Maar een chauffeur die zijn koppelverzoek aanneemt
--                     werkt diezelfde rij bij -- en die is geen beheerder.
--
--    agenda_items     `created_by = my_id()`. Een afspraak van een collega
--                     bijwerken kon dus niet, ook niet als je erbij hoort.
--
--  De regel: bestaat de rij al, dan is dit geen aanmaken maar een wijziging,
--  en dan beslist de regel voor UPDATE. Die stond in alle drie de gevallen
--  al goed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Bestaat deze rij al?
--
--  Als losse functie, want een regel op een tabel die zichzelf leest draait
--  in een kringetje. Met security definer gaat de vraag langs de regels heen,
--  en er komt niet meer uit dan ja of nee.
--
--  Het type regclass in plaats van tekst is met opzet: daarmee kan er geen
--  tabelnaam in worden gesmokkeld die er niet hoort.
-- ---------------------------------------------------------------------------

create or replace function public.rij_bestaat(tabel regclass, sleutel text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare gevonden boolean;
begin
  execute format('select exists (select 1 from %s where id = $1)', tabel)
    into gevonden using sleutel;
  return gevonden;
end;
$$;

grant execute on function public.rij_bestaat(regclass, text) to authenticated;

-- ---------------------------------------------------------------------------
--  Bonnen
--
--  Een bon die per mail binnenkwam heeft geen indiener -- die komt van de
--  postbus. Het management hoort hem gewoon te kunnen invullen en afhandelen.
-- ---------------------------------------------------------------------------

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (
    public.rij_bestaat('public.expenses'::regclass, id)
    or public.is_management()
    or (public.is_staff() and submitted_by = public.my_id())
  );

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (
    public.is_management()
    or (submitted_by = public.my_id() and status = 'open')
  )
  with check (
    public.is_management()
    or (submitted_by = public.my_id() and status = 'open')
  );

-- ---------------------------------------------------------------------------
--  Koppelingen met een werkgever
--
--  Aannemen of weigeren van een koppelverzoek is een wijziging van een rij
--  die er al staat. Wie dat mag, staat in wgk_update.
-- ---------------------------------------------------------------------------

drop policy if exists wgk_insert on public.employer_links;
create policy wgk_insert on public.employer_links for insert to authenticated
  with check (
    public.rij_bestaat('public.employer_links'::regclass, id)
    or public.is_management()
    or exists (
      select 1 from public.employers e
       where e.id = werkgever_id
         and e.status = 'actief'
         and public.my_id() = any(e.beheerders)
    )
  );

-- ---------------------------------------------------------------------------
--  De agenda
-- ---------------------------------------------------------------------------

drop policy if exists agenda_insert on public.agenda_items;
create policy agenda_insert on public.agenda_items for insert to authenticated
  with check (
    public.rij_bestaat('public.agenda_items'::regclass, id)
    or (public.is_staff() and created_by = public.my_id())
  );

-- ===========================================================================
--  Uitnodigen en uitschrijven
--
--  Draai dit ná 0022. Opnieuw draaien mag.
--
--  Twee gaten die aan elkaar hangen.
--
--  1. Dubbele mensen
--
--     Het kantoor maakt een dossier aan. Diezelfde persoon meldt zich daarna
--     zelf aan, want er kwam geen uitnodiging -- en doet dat met zijn privé-
--     adres. De koppeling in handle_new_user kijkt op e-mailadres, dus die
--     ziet twee verschillende mensen. Twee dossiers, twee personeelsnummers,
--     twee keer dezelfde man in het rooster.
--
--     De oplossing zit vooral in het uitnodigen: wie een uitnodiging krijgt
--     hoeft zich niet aan te melden. Wat hier bij komt is de vangnet-kant --
--     bij het toelaten van een aanmelding zien of er al iemand met die naam
--     staat, en dan kunnen koppelen in plaats van een tweede aanmaken.
--
--  2. Niemand kon iemand weghalen
--
--     Er stond geen enkele regel voor verwijderen op profiles. Zonder regel
--     mag het niet, dus een dossier dat er per ongeluk stond bleef er staan.
--
--     Twee manieren, want het is niet één ding:
--
--       uitschrijven   inlog en dossier gaan dicht, de persoon is nergens
--                      meer te kiezen, maar zijn uren, wasbeurten en
--                      getekende contracten blijven staan. Dit is wat de
--                      bewaarplicht van je vraagt: loonadministratie en
--                      contracten zeven jaar.
--
--       wissen         werkelijk alles weg. Voor een AVG-verzoek, en pas als
--                      de bewaarplicht voorbij is. Onomkeerbaar, dus met een
--                      reden erbij die blijft staan nadat de persoon weg is.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Uitgeschreven
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists archived_at     bigint,
  add column if not exists archived_by     text,
  add column if not exists archive_reason  text;

create index if not exists profiles_archived_idx on public.profiles (archived_at);

/*
 * De rem uit 0021 kent deze kolommen nog niet. Zonder dit zou een
 * medewerker zichzelf kunnen uitschrijven -- of erger, zichzelf weer
 * terugzetten nadat het kantoor hem eruit heeft gehaald.
 */
create or replace function public.profiel_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null or public.is_management() then
    return new;
  end if;

  new.roles            := old.roles;
  new.grants           := old.grants;
  new.revokes          := old.revokes;
  new.active           := old.active;
  new.all_locations    := old.all_locations;
  new.manages          := old.manages;
  new.location_id      := old.location_id;
  new.company_id       := old.company_id;
  new.supervisor_id    := old.supervisor_id;
  new.personnel_number := old.personnel_number;
  new.job_title        := old.job_title;
  new.contract_hours   := old.contract_hours;
  new.start_date       := old.start_date;
  new.end_date         := old.end_date;
  new.hourly_rate      := old.hourly_rate;
  new.notes            := old.notes;
  new.email            := old.email;
  new.auth_id          := old.auth_id;
  new.archived_at      := old.archived_at;
  new.archived_by      := old.archived_by;
  new.archive_reason   := old.archive_reason;

  if new.must_change_password and not old.must_change_password then
    new.must_change_password := old.must_change_password;
  end if;

  return new;
end;
$$;

drop trigger if exists profiel_bewaak on public.profiles;
create trigger profiel_bewaak before update on public.profiles
  for each row execute function public.profiel_bewaak_wijziging();

-- ---------------------------------------------------------------------------
--  Wissen: wat er overblijft als de persoon weg is
--
--  Een dossier dat verdwijnt laat niets achter, en dat is precies het
--  probleem: dan kan later niemand meer nagaan dat het is gebeurd, door wie
--  en waarom. Deze regel blijft, met alleen wat nodig is om die vraag te
--  beantwoorden -- geen gegevens van de persoon zelf behalve zijn naam.
-- ---------------------------------------------------------------------------

create table if not exists public.deletion_log (
  id            text primary key,
  soort         text not null default 'medewerker',
  naam          text not null default '',
  /* Het personeelsnummer, zodat een oude urenlijst nog te plaatsen is */
  kenmerk       text,
  reden         text not null default '',
  door          text,
  door_naam     text not null default '',
  at            bigint not null default public.now_ms(),
  updated_at    bigint not null default public.now_ms()
);

create index if not exists deletion_log_at_idx on public.deletion_log (at);

alter table public.deletion_log enable row level security;

drop policy if exists deletion_log_select on public.deletion_log;
create policy deletion_log_select on public.deletion_log for select to authenticated
  using (public.is_management());

/* Schrijven doet de serverfunctie met de servicesleutel, niemand anders. */
drop policy if exists deletion_log_write on public.deletion_log;
create policy deletion_log_write on public.deletion_log for all to authenticated
  using (false) with check (false);

-- ---------------------------------------------------------------------------
--  Verwijderen mag het management
--
--  De serverfunctie doet het echte werk -- die haalt ook het inlogaccount
--  weg, en daar heb je de servicesleutel voor nodig. Maar zonder deze regel
--  zou zelfs dát niet lukken vanuit de app, en dan blijft een verkeerd
--  aangemaakt dossier eeuwig staan.
-- ---------------------------------------------------------------------------

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.is_management() and id <> public.my_id());

-- ---------------------------------------------------------------------------
--  Wie is uitgeschreven, telt niet meer mee
--
--  Alleen voor het lezen van de lijst. Wie uitgeschreven is verdwijnt uit
--  het beeld van collega's, maar het management blijft hem zien -- anders
--  kun je een vergissing niet terugdraaien.
-- ---------------------------------------------------------------------------

create or replace function public.is_uitgeschreven(dossier text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select archived_at is not null from public.profiles where id = dossier),
    false);
$$;

grant execute on function public.is_uitgeschreven(text) to authenticated;

-- ===========================================================================
--  Uren rechtzetten en kilometers verantwoorden
--
--  Draai dit ná 0023. Opnieuw draaien mag.
--
--  Twee dingen die een medewerker over zichzelf moet kunnen zeggen, en één
--  ding dat hij juist niet zelf mag bepalen.
--
--  1. Uren rechtzetten
--
--     Klokken gaat sinds 0018 via de kassa, en dat is goed: waar je werkt
--     hoort te blijken uit waar je inklokt. Maar iemand die vergeet in te
--     klokken staat nu met lege handen -- hij was er wel, het staat er niet,
--     en hij kan er zelf niets aan doen.
--
--     Vandaar een verzoek: hij geeft aan wat er had moeten staan en waarom,
--     zijn leidinggevende kijkt ernaar. Niet hijzelf, want dan is het geen
--     urenstaat meer maar een voorstel -- precies wat we in 0018 hebben
--     dichtgezet.
--
--     Alles blijft staan: wat hij vroeg, wat het was, wie besliste en
--     wanneer. Een urenstaat waarin achteraf iets is veranderd zonder spoor
--     is een urenstaat waar je niets meer aan hebt.
--
--  2. Kilometers
--
--     Van adres naar adres, uitgerekend over de weg. Losse kilometers
--     intypen kan niet, en dat is de hele bedoeling: een vergoeding waarbij
--     iedereen zijn eigen getal invult is geen vergoeding maar een
--     vertrouwenskwestie.
--
--     De afstand wordt één keer opgezocht en dan onthouden. Woon-werk is
--     elke dag dezelfde route; die hoeft niet elke dag opnieuw berekend te
--     worden.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Waar iemand woont
--
--  Hoort bij het afgeschermde deel: het adres van een collega gaat niemand
--  anders aan, en zonder adres valt woon-werkverkeer niet uit te rekenen.
-- ---------------------------------------------------------------------------

alter table public.personnel_private
  add column if not exists address  text,
  add column if not exists postcode text,
  add column if not exists city     text;

-- ---------------------------------------------------------------------------
--  Een verzoek om de uren recht te zetten
-- ---------------------------------------------------------------------------

create table if not exists public.hour_requests (
  id             text primary key,
  user_id        text not null,
  user_name      text not null default '',
  /* De regel waar het over gaat; leeg betekent: die is er helemaal niet */
  entry_id       text,
  location_id    text references public.locations(id) on delete set null,

  soort          text not null default 'vergeten'
                 check (soort in ('vergeten','verkeerde tijd','te vroeg uitgeklokt','anders')),
  /* Wat er volgens de medewerker had moeten staan */
  van            bigint not null,
  tot            bigint,
  toelichting    text not null default '',

  status         text not null default 'nieuw'
                 check (status in ('nieuw','goedgekeurd','afgewezen','ingetrokken')),
  aangevraagd_op bigint not null default public.now_ms(),

  beslist_door      text,
  beslist_door_naam text,
  beslist_op        bigint,
  beslissing_reden  text,

  updated_at     bigint not null default public.now_ms()
);

create index if not exists hr_user_idx    on public.hour_requests (user_id);
create index if not exists hr_status_idx  on public.hour_requests (status);
create index if not exists hr_updated_idx on public.hour_requests (updated_at);

-- ---------------------------------------------------------------------------
--  Ritten
-- ---------------------------------------------------------------------------

create table if not exists public.trips (
  id            text primary key,
  user_id       text not null,
  user_name     text not null default '',
  op            bigint not null,

  van_label     text not null default '',
  naar_label    text not null default '',
  /* Wat er werkelijk is opgezocht; hiermee is de afstand na te rekenen */
  van_adres     text not null default '',
  naar_adres    text not null default '',

  /* Kilometers over de weg, één kant op */
  km            numeric not null default 0,
  retour        boolean not null default false,
  doel          text not null default 'woon-werk'
                check (doel in ('woon-werk','klant','vestiging','anders')),
  toelichting   text,

  /* Waar de afstand vandaan komt; 'handmatig' bestaat met opzet niet */
  bron          text not null default 'route'
                check (bron in ('route','vast')),

  status        text not null default 'nieuw'
                check (status in ('nieuw','goedgekeurd','afgewezen')),
  beslist_door      text,
  beslist_door_naam text,
  beslist_op        bigint,

  updated_at    bigint not null default public.now_ms()
);

create index if not exists trips_user_idx    on public.trips (user_id);
create index if not exists trips_op_idx      on public.trips (op);
create index if not exists trips_updated_idx on public.trips (updated_at);

/*
 * Niemand vult zijn eigen kilometers in.
 *
 * Dit staat hier en niet alleen in het scherm, want een scherm is een
 * afspraak en dit is een regel. De afstand komt van de routedienst; de
 * serverfunctie schrijft hem weg.
 */
create or replace function public.rit_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null or public.is_lead() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.km <> 0 then
      raise exception 'De kilometers worden uitgerekend, niet ingevuld';
    end if;
    return new;
  end if;

  if new.km is distinct from old.km
     or new.van_adres is distinct from old.van_adres
     or new.naar_adres is distinct from old.naar_adres
     or new.status is distinct from old.status
  then
    raise exception 'De afstand en de beoordeling bepaal je niet zelf';
  end if;
  return new;
end;
$$;

drop trigger if exists rit_bewaak on public.trips;
create trigger rit_bewaak before insert or update on public.trips
  for each row execute function public.rit_bewaak_wijziging();

-- ---------------------------------------------------------------------------
--  Het geheugen van de routedienst
--
--  Woon-werk is elke dag dezelfde route. Die hoeft niet elke dag opnieuw te
--  worden opgevraagd -- dat kost tijd, en bij een betaalde dienst geld.
-- ---------------------------------------------------------------------------

create table if not exists public.route_cache (
  id          text primary key,
  van         text not null,
  naar        text not null,
  km          numeric not null,
  minuten     integer,
  dienst      text not null default 'ors',
  at          bigint not null default public.now_ms(),
  updated_at  bigint not null default public.now_ms()
);

-- ---------------------------------------------------------------------------
--  Tijdstempels
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['hour_requests','trips','route_cache'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Beveiliging
-- ---------------------------------------------------------------------------

alter table public.hour_requests enable row level security;
alter table public.trips         enable row level security;
alter table public.route_cache   enable row level security;

/* --- urenverzoeken --- */

drop policy if exists hr_select on public.hour_requests;
create policy hr_select on public.hour_requests for select to authenticated
  using (user_id = public.my_id() or public.is_lead());

drop policy if exists hr_insert on public.hour_requests;
create policy hr_insert on public.hour_requests for insert to authenticated
  with check (
    public.rij_bestaat('public.hour_requests'::regclass, id)
    or (public.is_staff() and user_id = public.my_id() and status = 'nieuw')
  );

-- Beslissen doet de leidinggevende; intrekken mag de aanvrager zelf.
drop policy if exists hr_update on public.hour_requests;
create policy hr_update on public.hour_requests for update to authenticated
  using (public.is_lead() or user_id = public.my_id())
  with check (public.is_lead() or user_id = public.my_id());

create or replace function public.hr_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null or public.is_lead() then return new; end if;

  -- De aanvrager mag precies één ding: zijn eigen verzoek intrekken.
  if new.status = 'ingetrokken'
     and old.status = 'nieuw'
     and old.user_id = public.my_id()
     and new.van is not distinct from old.van
     and new.tot is not distinct from old.tot
  then
    return new;
  end if;

  raise exception 'Over je eigen urenverzoek beslist je leidinggevende';
end;
$$;

drop trigger if exists hr_bewaak on public.hour_requests;
create trigger hr_bewaak before update on public.hour_requests
  for each row execute function public.hr_bewaak_wijziging();

drop policy if exists hr_delete on public.hour_requests;
create policy hr_delete on public.hour_requests for delete to authenticated
  using (public.is_management());

/* --- ritten --- */

drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (user_id = public.my_id() or public.is_lead());

drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips for insert to authenticated
  with check (
    public.rij_bestaat('public.trips'::regclass, id)
    or (public.is_staff() and user_id = public.my_id())
  );

drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips for update to authenticated
  using (public.is_lead() or (user_id = public.my_id() and status = 'nieuw'))
  with check (public.is_lead() or (user_id = public.my_id() and status = 'nieuw'));

drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips for delete to authenticated
  using (public.is_lead() or (user_id = public.my_id() and status = 'nieuw'));

/* --- het routegeheugen --- */

drop policy if exists route_select on public.route_cache;
create policy route_select on public.route_cache for select to authenticated
  using (public.is_staff());

-- Schrijven doet de serverfunctie met de servicesleutel. Zou de app hier
-- mogen schrijven, dan kon iedereen zijn eigen afstand "onthouden".
drop policy if exists route_write on public.route_cache;
create policy route_write on public.route_cache for all to authenticated
  using (false) with check (false);

-- ===========================================================================
--  De kluis, en het koppelen van een kassa
--
--  Twee dingen die bij elkaar horen, want ze gaan over hetzelfde: wie mag er
--  aan het geld, en welk apparaat mag er meepraten.
--
--  ------------------------------------------------------------------------
--  1. De kluis
--  ------------------------------------------------------------------------
--
--  Naast de lade van de kassa staat er op elke vestiging een kluis. Daar gaat
--  de omzet in die niet in de lade hoort, en daar komt het wisselgeld uit.
--  Tot nu toe was dat een boek op de balie; hier wordt het een administratie.
--
--  De keuze die alles verklaart: er worden briefjes en munten geteld, geen
--  bedragen ingetikt.
--
--  Bij een kluis werkt dat namelijk anders dan bij een bon. Wie 340 euro
--  afstort, legt drie briefjes van honderd, twee van twintig en dat kleine
--  beetje neer -- en juist bij dat laatste gaat het mis. Iemand tikt 340 in
--  terwijl er 240 ligt, en dat verschil komt drie weken later boven water,
--  als niemand meer weet wie er die dag stond. Dus slaan we op wat er
--  fysiek bewoog, en rekent de database het bedrag daaruit uit.
--
--   * pos_safes        de kluis, één per vestiging
--   * pos_safe_moves   elke beweging, met de briefjes en munten erbij
--
--  Het saldo is geen kolom maar een som -- net als bij een strippenkaart, en
--  om dezelfde reden: twee mensen die tegelijk offline iets uit de kluis
--  halen zouden elkaars saldo overschrijven.
--
--  Een telling is het enige dat het saldo hard zet. Wat er geteld is staat
--  erin, samen met wat er verwacht werd en het verschil. Dat verschil wordt
--  bewaard zoals het die avond is vastgesteld en nooit stilletjes
--  weggerekend.
--
--  ------------------------------------------------------------------------
--  2. Een kassa koppelen
--  ------------------------------------------------------------------------
--
--  Tot nu toe richtte je een kassa in door er met een account op in te
--  loggen en zelf een kassa aan te maken. Dat werkt, maar het betekent dat
--  op elke tablet achter de balie iemands wachtwoord staat, en dat het
--  kantoor niet weet welke apparaten er meedoen.
--
--  Nu gaat het andersom. Het kantoor maakt de kassa aan en zet er een code
--  bij die één keer geldig is. Die code wordt op de kassa ingetoetst, en de
--  serverfunctie kassa-koppelen geeft dat apparaat zijn eigen inlog. Zo
--  hoort er bij elk apparaat een naam in een lijst, en kan het kantoor er
--  van een afstand de stekker uit trekken.
--
--   * pos_pairings     de eenmalige codes
--   * pos_devices      welk apparaat op welke kassa staat, en of het nog mag
--
--  Waarom "eruit gooien" twee stappen is: op een kassa kan omzet staan die
--  nog niet verstuurd is. Trek je de inlog er direct onderuit, dan komt die
--  omzet nergens meer aan. Dus zet het kantoor het apparaat op
--  'ingetrokken'; de kassa ziet dat, stuurt eerst zijn wachtrij leeg, wist
--  zichzelf en meldt dat terug met wiped_at. Daarna kan het account weg.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De kluis
-- ---------------------------------------------------------------------------

create table if not exists public.pos_safes (
  id          text primary key,
  location_id text references public.locations(id) on delete cascade,
  name        text not null default 'Kluis',
  active      boolean not null default true,
  note        text,
  updated_at  bigint not null default public.now_ms()
);

-- Eén kluis per vestiging. Twee zou betekenen dat het geld in de ene of in
-- de andere kan zitten, en dan telt niemand meer iets.
create unique index if not exists pos_safes_location_key
  on public.pos_safes (location_id);

/*
 * Elke vestiging krijgt zijn kluis, ook de vestigingen die er al zijn.
 *
 * Dit gebeurt hier en niet in de app, om een simpele reden: de kassa mag
 * geen kluizen aanmaken. Zou hij dat wel mogen, dan maakt een apparaat met
 * een verkeerd ingestelde vestiging een tweede kluis aan, en verdwijnt het
 * geld in een administratie die niemand bekijkt.
 */
insert into public.pos_safes (id, location_id, name)
select 'kluis_' || l.id, l.id, 'Kluis ' || l.name
  from public.locations l
 where not exists (select 1 from public.pos_safes s where s.location_id = l.id)
on conflict do nothing;

create or replace function public.pos_kluis_bij_vestiging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.pos_safes (id, location_id, name)
  values ('kluis_' || new.id, new.id, 'Kluis ' || new.name)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists locations_kluis on public.locations;
create trigger locations_kluis after insert on public.locations
  for each row execute function public.pos_kluis_bij_vestiging();

-- ---------------------------------------------------------------------------
--  Bewegingen in de kluis
--
--  De richting zit in `soort` en niet in het teken van het bedrag. Dat is
--  met opzet: een min die je zelf moet intikken is een min die iemand ooit
--  vergeet. Wat erin gaat is een afstorting, wisselgeld of een inleg; wat
--  eruit gaat gaat naar de bank, naar de lade of naar een uitgave.
--
--  `coins` is altijd een positief aantal per soort briefje of munt:
--  {"b100": 3, "b20": 2, "m50": 1}. De sleutels zijn b<euro> voor briefjes
--  en m<cent> voor munten -- b5 is dus het briefje van vijf, m5 de munt van
--  vijf cent.
-- ---------------------------------------------------------------------------

create table if not exists public.pos_safe_moves (
  id           text primary key,
  safe_id      text not null references public.pos_safes(id) on delete cascade,
  location_id  text references public.locations(id) on delete set null,
  soort        text not null default 'inleg'
               check (soort in ('afstorting','wisselgeld','naar-bank',
                                'van-bank','uitgave','inleg','telling')),
  -- Wat er fysiek bewoog. Bij een telling leeg; daar staat het in counted.
  coins        jsonb not null default '{}'::jsonb,
  -- Alleen bij een telling: de volledige samenstelling zoals geteld. Dit is
  -- het enige dat het saldo hard zet.
  counted      jsonb,
  -- Het bedrag met teken, afgeleid uit coins en soort en hier vastgelegd.
  -- Vastgelegd en niet berekend bij het opvragen: als er later een beweging
  -- bijkomt die nog in een wachtrij stond, moet je kunnen zien wat het die
  -- dag was.
  amount       numeric not null default 0,
  -- Alleen bij een telling.
  expected     numeric,
  difference   numeric,
  -- Waar het vandaan kwam of naartoe ging, als dat de kassalade was.
  session_id   text references public.pos_cash_sessions(id) on delete set null,
  register_id  text references public.pos_registers(id) on delete set null,
  reason       text not null default '',
  user_id      text references public.profiles(id) on delete set null,
  user_name    text not null default '',
  at           bigint not null default public.now_ms(),
  updated_at   bigint not null default public.now_ms()
);

create index if not exists pos_safe_moves_safe_idx    on public.pos_safe_moves (safe_id, at);
create index if not exists pos_safe_moves_session_idx on public.pos_safe_moves (session_id);
create index if not exists pos_safe_moves_updated_idx on public.pos_safe_moves (updated_at);

-- ---------------------------------------------------------------------------
--  Een beweging in de kluis staat vast
--
--  Om dezelfde reden als bij een afgerekende bon: een kasadministratie die je
--  achteraf kunt bijschaven is geen administratie. Een vergissing corrigeer
--  je met een tegenboeking of met een telling, niet met de gum.
--
--  Opnieuw versturen mag wél. Een kassa die zijn wachtrij twee keer
--  aanbiedt, biedt dezelfde waarden aan; `is distinct from` laat dat door.
-- ---------------------------------------------------------------------------

create or replace function public.pos_kluis_vastzetten()
returns trigger language plpgsql as $$
begin
  if new.soort    is distinct from old.soort
  or new.coins    is distinct from old.coins
  or new.counted  is distinct from old.counted
  or new.amount   is distinct from old.amount
  or new.safe_id  is distinct from old.safe_id
  or new.at       is distinct from old.at
  or new.user_id  is distinct from old.user_id
  then
    raise exception 'Deze kluisboeking staat vast. Zet een tegenboeking of een telling tegenover een vergissing.';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_safe_moves_vast on public.pos_safe_moves;
create trigger pos_safe_moves_vast before update on public.pos_safe_moves
  for each row execute function public.pos_kluis_vastzetten();

create or replace function public.pos_kluis_niet_wissen()
returns trigger language plpgsql as $$
begin
  raise exception 'Een kluisboeking mag niet verwijderd worden. Zet er een tegenboeking tegenover; dan blijft te zien wat er gebeurd is.';
end;
$$;

drop trigger if exists pos_safe_moves_niet_wissen on public.pos_safe_moves;
create trigger pos_safe_moves_niet_wissen before delete on public.pos_safe_moves
  for each row execute function public.pos_kluis_niet_wissen();

/**
 * Wat één briefje of munt waard is, uit zijn sleutel.
 *
 * b100 -> 100.00, m50 -> 0.50. Een onbekende sleutel is nul en geen fout:
 * komt er ooit een nieuwe munt bij, dan moet een oude telling nog leesbaar
 * zijn in plaats van de hele functie te laten omvallen.
 */
create or replace function public.pos_munt_waarde(sleutel text)
returns numeric language sql immutable as $$
  select case
    when sleutel ~ '^b[0-9]+$' then substring(sleutel from 2)::numeric
    when sleutel ~ '^m[0-9]+$' then substring(sleutel from 2)::numeric / 100
    else 0
  end;
$$;

grant execute on function public.pos_munt_waarde(text) to authenticated;

-- ---------------------------------------------------------------------------
--  Wat er in de kluis zit
--
--  Voor het dashboard, dat niet de hele geschiedenis van een kluis wil
--  ophalen om één getal te laten zien. De kassa rekent hetzelfde uit in
--  src/lib/kluis.ts, en die moet het offline kunnen -- vandaar dat het op
--  twee plekken staat. De regel is dezelfde: vanaf de laatste telling
--  optellen, en zonder telling vanaf nul.
--
--  Waarom er op (at, id) gesorteerd wordt en niet alleen op at: twee boekingen
--  kunnen in dezelfde milliseconde vallen. Stond hier alleen `at > telling.at`,
--  dan viel een boeking van hetzelfde moment als de telling uit het saldo --
--  geen fout, alleen een bedrag dat niet klopt. Het id erbij maakt de volgorde
--  overal dezelfde. Willekeurig, maar overal op dezelfde manier willekeurig, en
--  dat is precies wat hier nodig is.
-- ---------------------------------------------------------------------------

create or replace function public.pos_kluis_saldo(kluis text)
returns numeric language sql stable security definer set search_path = public as $$
  with laatste as (
    -- Op tijd én id, want twee boekingen kunnen in dezelfde milliseconde
    -- vallen. Zie de kanttekening hieronder.
    select at, id,
           coalesce((select sum((value)::numeric * public.pos_munt_waarde(key))
                       from jsonb_each_text(m.counted)), 0) as basis
      from public.pos_safe_moves m
     where m.safe_id = kluis and m.soort = 'telling' and m.counted is not null
     order by m.at desc, m.id desc
     limit 1
  )
  select coalesce((select basis from laatste), 0)
       + coalesce((
           select sum(m.amount) from public.pos_safe_moves m
            where m.safe_id = kluis
              and m.soort <> 'telling'
              and (
                not exists (select 1 from laatste)
                or (m.at, m.id) > (select at, id from laatste)
              )
         ), 0);
$$;

grant execute on function public.pos_kluis_saldo(text) to authenticated;

-- ---------------------------------------------------------------------------
--  Eenmalige codes om een kassa te koppelen
--
--  De code staat leesbaar in de tabel, en dat hoort ook: iemand van het
--  kantoor leest hem van zijn scherm en tikt hem op de kassa in. Wat hem
--  veilig maakt is niet dat hij geheim is opgeslagen maar dat hij één keer
--  werkt en verloopt -- en dat alleen wie kassa's mag beheren hem kan zien.
-- ---------------------------------------------------------------------------

create table if not exists public.pos_pairings (
  id              text primary key,
  code            text not null,
  location_id     text not null references public.locations(id) on delete cascade,
  -- Voor welke kassa. Het kantoor maakt de kassa aan en dan de code; zo weet
  -- het apparaat meteen welke code op zijn bonnen komt.
  register_id     text references public.pos_registers(id) on delete cascade,
  created_by      text references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  expires_at      bigint not null,
  used_at         bigint,
  used_by_device  text,
  note            text,
  updated_at      bigint not null default public.now_ms()
);

create unique index if not exists pos_pairings_code_key on public.pos_pairings (code);
create index if not exists pos_pairings_location_idx on public.pos_pairings (location_id);

-- ---------------------------------------------------------------------------
--  De apparaten
--
--  Elk apparaat heeft zijn eigen inlog. Niet het account van een medewerker:
--  dan staat er een wachtwoord van een mens op een tablet achter de balie,
--  en verliest die mens zijn toegang als het apparaat wordt geblokkeerd.
--
--  status:
--    actief        doet mee
--    geblokkeerd   tijdelijk uit; de kassa gaat op slot maar blijft zijn
--                  wachtrij versturen. Precies wat je wil als een tablet
--                  kwijt is en de omzet er nog op staat.
--    ingetrokken   eruit. De kassa stuurt zijn wachtrij leeg, wist zichzelf
--                  en zet wiped_at. Daarna mag het account weg.
-- ---------------------------------------------------------------------------

create table if not exists public.pos_devices (
  id           text primary key,
  register_id  text references public.pos_registers(id) on delete cascade,
  location_id  text references public.locations(id) on delete set null,
  -- Wat het apparaat van zichzelf weet. Blijft staan als de app opnieuw
  -- wordt geïnstalleerd, zodat hetzelfde apparaat niet twee keer in de
  -- lijst komt.
  device_key   text not null default '',
  name         text not null default '',
  platform     text not null default '',
  app_version  text,
  -- Het inlogaccount dat bij dit apparaat hoort.
  auth_user_id uuid,
  profile_id   text references public.profiles(id) on delete set null,
  status       text not null default 'actief'
               check (status in ('actief','geblokkeerd','ingetrokken')),
  paired_at    bigint not null default public.now_ms(),
  last_seen_at bigint,
  wiped_at     bigint,
  note         text,
  updated_at   bigint not null default public.now_ms()
);

/*
 * Eén apparaat per kassa.
 *
 * Twee apparaten op dezelfde kassa geven dezelfde bonnummers, en dan blijft
 * de tweede bon in de wachtrij hangen met een fout over een dubbele sleutel.
 * De app waarschuwde daarvoor; nu houdt de database het tegen. Een
 * ingetrokken apparaat telt niet mee -- de opvolger moet erin kunnen.
 */
create unique index if not exists pos_devices_register_key
  on public.pos_devices (register_id)
  where status in ('actief','geblokkeerd');

create index if not exists pos_devices_location_idx on public.pos_devices (location_id);
create index if not exists pos_devices_updated_idx  on public.pos_devices (updated_at);

-- ---------------------------------------------------------------------------
--  Een apparaat is geen medewerker
--
--  Het inlogaccount van een kassa heeft een personeelsdossier nodig, want
--  daar hangt alles aan: welke vestiging, en dus welke gegevens het apparaat
--  mag zien. Maar het is geen mens. Zonder dit vlaggetje staat "Kassa
--  KAS-UTR-1" tussen het personeel in het rooster, in de urenstaat en in de
--  lijst waaruit je aan de kassa iemand kiest.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists is_device boolean not null default false;

create index if not exists profiles_is_device_idx on public.profiles (is_device);

-- ---------------------------------------------------------------------------
--  Het bonnummer komt van de kassa, de bovengrens van de server
--
--  De kassa nummert zijn bonnen zelf door, op het apparaat, zodat het ook
--  zonder internet doorloopt. last_seq is de hoogste die de server gezien
--  heeft; een opnieuw ingericht apparaat telt daar vanaf verder.
--
--  Dat getal stuurde de kassa eerst zelf mee. Dat kan niet meer: een
--  apparaataccount mag geen kassa's wijzigen -- en dat is goed, want dan kan
--  een apparaat ook zijn eigen instellingen niet omzetten. Dus rekent de
--  server het uit op het moment dat er een bon binnenkomt. Dat is
--  bovendien betrouwbaarder: het volgt de bonnen die er echt zijn.
-- ---------------------------------------------------------------------------

create or replace function public.pos_seq_bijwerken()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.register_id is not null and new.seq is not null then
    update public.pos_registers
       set last_seq = greatest(last_seq, new.seq)
     where id = new.register_id and last_seq < new.seq;
  end if;
  return new;
end;
$$;

drop trigger if exists pos_sales_seq on public.pos_sales;
create trigger pos_sales_seq after insert on public.pos_sales
  for each row execute function public.pos_seq_bijwerken();

-- ---------------------------------------------------------------------------
--  Tijdstempels
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'pos_safes','pos_safe_moves','pos_pairings','pos_devices'
  ] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Beveiliging op rijniveau
--
--  Dezelfde verdeling als bij de rest van de kassa: wie op een vestiging
--  werkt mag de kluis van die vestiging zien en erin boeken; de app bepaalt
--  wie er daadwerkelijk bij mag met het recht pos.safe. Dat de app dat doet
--  en niet de database heeft een reden: de rollen staan in permissions.ts en
--  die kan de database niet narekenen.
--
--  Wat de database wél hard afdwingt, en dat is het belangrijkste:
--  boekingen kunnen niet meer gewijzigd of gewist worden.
-- ---------------------------------------------------------------------------

alter table public.pos_safes      enable row level security;
alter table public.pos_safe_moves enable row level security;
alter table public.pos_pairings   enable row level security;
alter table public.pos_devices    enable row level security;

-- ------------------------------- de kluis ---------------------------------

drop policy if exists pos_safes_select on public.pos_safes;
create policy pos_safes_select on public.pos_safes for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

-- Aanmaken en omzetten doet het kantoor. De kassa leest alleen.
drop policy if exists pos_safes_write on public.pos_safes;
create policy pos_safes_write on public.pos_safes for all to authenticated
  using (public.mag_kassa_beheren() and public.in_my_locations(location_id))
  with check (public.mag_kassa_beheren() and public.in_my_locations(location_id));

drop policy if exists pos_safe_moves_select on public.pos_safe_moves;
create policy pos_safe_moves_select on public.pos_safe_moves for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_safe_moves_insert on public.pos_safe_moves;
create policy pos_safe_moves_insert on public.pos_safe_moves for insert to authenticated
  with check (public.is_staff() and public.in_my_locations(location_id));

-- Wijzigen mag; de trigger hierboven bepaalt dat er niets te wijzigen valt
-- behalve de toelichting. Zonder deze regel zou een kassa die zijn wachtrij
-- opnieuw aanbiedt vastlopen op een rij die er al staat.
drop policy if exists pos_safe_moves_update on public.pos_safe_moves;
create policy pos_safe_moves_update on public.pos_safe_moves for update to authenticated
  using (public.is_staff() and public.in_my_locations(location_id))
  with check (public.is_staff() and public.in_my_locations(location_id));

-- ------------------------------- de codes ---------------------------------

-- Een koppelcode is een sleutel tot de gegevens van een vestiging. Alleen
-- wie kassa's beheert ziet hem, en niemand anders -- ook geen collega op
-- dezelfde vestiging.
drop policy if exists pos_pairings_all on public.pos_pairings;
create policy pos_pairings_all on public.pos_pairings for all to authenticated
  using (public.mag_kassa_beheren() and public.in_my_locations(location_id))
  with check (public.mag_kassa_beheren() and public.in_my_locations(location_id));

-- --------------------- de kassa mag zijn eigen instelling ------------------

/*
 * Een apparaat mag van zijn eigen kassa de printer en de pinautomaat zetten.
 *
 * Dat hoort namelijk bij het apparaat en niet bij het kantoor: welke bonprinter
 * er aan deze balie hangt, weet degene die ervoor staat. Zonder deze regel is
 * de enige manier om dat in te stellen een account met kassabeheer -- en dan
 * kan datzelfde apparaat ook aan de prijzen.
 *
 * Wat er niet bij hoort: de code, de naam, de vestiging en het aan-uitvinkje.
 * Daar zit de rem eronder voor.
 */
drop policy if exists pos_registers_eigen on public.pos_registers;
create policy pos_registers_eigen on public.pos_registers for update to authenticated
  using (exists (
    select 1 from public.pos_devices d
     where d.register_id = pos_registers.id
       and d.auth_user_id = auth.uid()
       and d.status = 'actief'))
  with check (exists (
    select 1 from public.pos_devices d
     where d.register_id = pos_registers.id
       and d.auth_user_id = auth.uid()
       and d.status = 'actief'));

create or replace function public.pos_kassa_eigen_instelling()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /*
   * Het bonnummer gaat nooit achteruit -- voor niemand, ook niet voor het
   * kantoor.
   *
   * last_seq is een hoogwatermerk: de hoogste bon die de server gezien heeft.
   * Een kassa stuurt bij het opslaan van zijn printerinstelling de hele regel
   * mee, inclusief het nummer dat híj kende. Is dat een oud nummer -- omdat er
   * inmiddels bonnen van een ander apparaat binnenkwamen -- dan zou de
   * bovengrens zakken, en begint een volgend apparaat opnieuw te tellen bij
   * een nummer dat al bestaat. Dan blijven bonnen in de wachtrij hangen op een
   * dubbele sleutel, en dat is precies de fout die nergens hardop klinkt.
   */
  if new.last_seq < old.last_seq then
    new.last_seq := old.last_seq;
  end if;

  if public.mag_kassa_beheren() then return new; end if;

  -- Gaat dit niet over het apparaat zelf, dan bepaalt de regel erboven al of
  -- het mag; hier valt niets te knijpen.
  if auth.uid() is null
  or not exists (select 1 from public.pos_devices d
                  where d.register_id = old.id and d.auth_user_id = auth.uid())
  then
    return new;
  end if;

  if new.code        is distinct from old.code
  or new.name        is distinct from old.name
  or new.location_id is distinct from old.location_id
  or new.active      is distinct from old.active
  then
    raise exception 'Een kassa mag van zichzelf alleen de printer en de pinautomaat zetten. De code, de naam en de vestiging komen uit het dashboard.';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_registers_eigen_instelling on public.pos_registers;
create trigger pos_registers_eigen_instelling before update on public.pos_registers
  for each row execute function public.pos_kassa_eigen_instelling();

-- ----------------------------- de apparaten -------------------------------

drop policy if exists pos_devices_select on public.pos_devices;
create policy pos_devices_select on public.pos_devices for select to authenticated
  using (public.is_staff() and public.in_my_locations(location_id));

drop policy if exists pos_devices_write on public.pos_devices;
create policy pos_devices_write on public.pos_devices for all to authenticated
  using (public.mag_kassa_beheren() and public.in_my_locations(location_id))
  with check (public.mag_kassa_beheren() and public.in_my_locations(location_id));

/*
 * Een apparaat mag van zijn eigen regel bijhouden dat hij er nog is, en
 * melden dat hij zichzelf gewist heeft. Niets anders -- de trigger eronder
 * houdt de rest tegen.
 *
 * Dat laatste is wat "op afstand eruit gooien" werkend maakt: het kantoor
 * zet de status op ingetrokken, de kassa stuurt zijn wachtrij leeg en zet
 * wiped_at. Pas dan mag het account weg, want anders zou de omzet die nog
 * op dat apparaat stond nergens meer aankomen.
 */
drop policy if exists pos_devices_eigen on public.pos_devices;
create policy pos_devices_eigen on public.pos_devices for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create or replace function public.pos_apparaat_eigen_regel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /*
   * Deze rem geldt alleen voor het apparaat zelf.
   *
   * Eerst stond hier "wie geen kassa's beheert mag niets", en dat leek
   * hetzelfde. Het was het niet: bij een serverfunctie en bij een migratie is
   * auth.uid() leeg, dus mag_kassa_beheren() is dan onwaar -- en dan hield
   * deze trigger juist de kant tegen die er wel over gaat. Op afstand
   * intrekken werkte daardoor niet.
   *
   * Wie überhaupt aan deze tabel mag komen, bepalen de regels erboven. Hier
   * gaat het alleen om wat een apparaat aan zijn eigen regel mag veranderen.
   */
  if old.auth_user_id is null
  or auth.uid() is null
  or old.auth_user_id <> auth.uid()
  or public.mag_kassa_beheren()
  then
    return new;
  end if;

  if new.register_id  is distinct from old.register_id
  or new.location_id  is distinct from old.location_id
  or new.status       is distinct from old.status
  or new.auth_user_id is distinct from old.auth_user_id
  or new.profile_id   is distinct from old.profile_id
  or new.device_key   is distinct from old.device_key
  then
    raise exception 'Een kassa mag van zijn eigen regel alleen bijhouden dat hij er nog is. Blokkeren en intrekken gebeurt in het dashboard.';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_devices_eigen_regel on public.pos_devices;
create trigger pos_devices_eigen_regel before update on public.pos_devices
  for each row execute function public.pos_apparaat_eigen_regel();

-- ===========================================================================
--  De vestigingen zelf beheren
--
--  De vestigingen stonden er wel, maar er was geen enkele manier om er een
--  bij te maken, er een te wijzigen of er een weg te halen. Ze kwamen uit de
--  eerste vulling en daar bleef het bij.
--
--  Drie dingen gebeuren hier:
--
--    1. de vestiging krijgt de gegevens die je van een vestiging wil hebben:
--       e-mailadres, openingstijden, een notitie, en de coordinaten die bij
--       het adres horen
--    2. er komen foto's bij, in een eigen emmer
--    3. wissen wordt afgeschermd -- en dat is het belangrijkste stuk
--
--  Waarom dat derde. Op locations hangen tweeentwintig verwijzingen, en een
--  flink deel daarvan staat op "on delete cascade": installaties, storingen,
--  werkbonnen, onderhoudsschema's, voorraad, overlegkanalen en de kluis.
--  Een vestiging wissen zou die allemaal meenemen zonder een woord. De rest
--  staat op "set null", wat net zo stil is: negentien mensen die opeens geen
--  vestiging meer hebben.
--
--  Dus: de database weigert het, en zegt erbij wat eraan hangt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De vestiging zelf
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists email         text;
alter table public.locations add column if not exists notes         text;

-- Wat de kaartendienst van het adres maakte. geo_label is wat er gevonden is,
-- en dat is met opzet apart van wat er is ingetikt: als die twee uit elkaar
-- lopen wil je dat zien en niet dat de app je adres stilletjes herschrijft.
alter table public.locations add column if not exists lat           double precision;
alter table public.locations add column if not exists lon           double precision;
alter table public.locations add column if not exists geo_label     text;
alter table public.locations add column if not exists geo_at        bigint;

-- {"ma":{"van":"07:00","tot":"18:00"}, "zo":null, ...}  null = dicht
alter table public.locations add column if not exists opening_hours jsonb
  not null default '{}'::jsonb;

-- Waarom een vestiging uit staat. Zonder reden is "actief = false" over een
-- half jaar een raadsel.
alter table public.locations add column if not exists inactive_reason text;
alter table public.locations add column if not exists inactive_at     bigint;

-- ---------------------------------------------------------------------------
--  Wie mag dit?
--
--  Tot nu toe alleen het management. Het recht locations.manage bestond al in
--  de app maar de database keek er niet naar, dus uitdelen had geen effect.
-- ---------------------------------------------------------------------------

create or replace function public.mag_vestigingen_beheren()
returns boolean language sql stable as $$
  select public.is_management() or public.heeft_recht('locations.manage');
$$;

grant execute on function public.mag_vestigingen_beheren() to authenticated;

drop policy if exists locations_write on public.locations;
create policy locations_write on public.locations for all to authenticated
  using (public.mag_vestigingen_beheren())
  with check (public.mag_vestigingen_beheren());

-- ---------------------------------------------------------------------------
--  Foto's
--
--  Een eigen tabel en niet een kolom op locations. Er zijn er meer dan een,
--  ze hebben een volgorde en een bijschrift, en een rij met een lijst erin is
--  een rij die je bij elke wijziging in zijn geheel moet overschrijven.
-- ---------------------------------------------------------------------------

create table if not exists public.location_photos (
  id               text primary key,
  location_id      text not null references public.locations(id) on delete cascade,
  storage_path     text not null,
  mime             text not null,
  size_bytes       integer not null default 0,
  width            integer,
  height           integer,
  caption          text,
  sort             integer not null default 0,
  is_cover         boolean not null default false,
  uploaded_by      text,
  uploaded_by_name text,
  uploaded_at      bigint not null default public.now_ms(),
  updated_at       bigint not null default public.now_ms()
);

create index if not exists location_photos_loc_idx
  on public.location_photos (location_id, sort);
create index if not exists location_photos_updated_idx
  on public.location_photos (updated_at);

-- Een vestiging heeft er hoogstens een die vooraan staat. Zonder deze index
-- kun je er twee aanzetten en is het maar net welke de lijst als eerste ziet.
create unique index if not exists location_photos_cover_idx
  on public.location_photos (location_id) where is_cover;

drop trigger if exists stamp_location_photos on public.location_photos;
create trigger stamp_location_photos before insert or update on public.location_photos
  for each row execute function public.stamp_updated_at();

alter table public.location_photos enable row level security;

-- Iedereen die is ingelogd mag ze zien, net als de vestigingen zelf. Het is
-- een foto van een wasstraat langs de snelweg; die staat ook op de website.
drop policy if exists location_photos_select on public.location_photos;
create policy location_photos_select on public.location_photos for select to authenticated
  using (true);

drop policy if exists location_photos_write on public.location_photos;
create policy location_photos_write on public.location_photos for all to authenticated
  using (public.mag_vestigingen_beheren())
  with check (public.mag_vestigingen_beheren());

-- ---------------------------------------------------------------------------
--  De emmer
--
--  Openbaar leesbaar, anders dan de dossiers. Dat is een keuze en geen
--  slordigheid: een foto van een vestiging is geen geheim, en negentien
--  ondertekende adressen ophalen bij elke keer dat het scherm opengaat maakt
--  de lijst traag en offline leeg.
--
--  Schrijven mag alleen wie vestigingen beheert. Openbaar lezen is niet
--  hetzelfde als openbaar volzetten.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vestigingen', 'vestigingen', true, 10485760,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists vestigingen_lezen on storage.objects;
create policy vestigingen_lezen on storage.objects for select to authenticated
  using (bucket_id = 'vestigingen');

drop policy if exists vestigingen_schrijven on storage.objects;
create policy vestigingen_schrijven on storage.objects for insert to authenticated
  with check (bucket_id = 'vestigingen' and public.mag_vestigingen_beheren());

drop policy if exists vestigingen_bijwerken on storage.objects;
create policy vestigingen_bijwerken on storage.objects for update to authenticated
  using (bucket_id = 'vestigingen' and public.mag_vestigingen_beheren())
  with check (bucket_id = 'vestigingen' and public.mag_vestigingen_beheren());

drop policy if exists vestigingen_wissen on storage.objects;
create policy vestigingen_wissen on storage.objects for delete to authenticated
  using (bucket_id = 'vestigingen' and public.mag_vestigingen_beheren());

-- ---------------------------------------------------------------------------
--  Wat hangt er aan deze vestiging?
--
--  Geeft per soort terug hoeveel er zijn. Het scherm gebruikt dit om te
--  vertellen waarom wissen niet kan; de trigger hieronder gebruikt hetzelfde
--  antwoord om het ook echt tegen te houden. Een van de twee zou niet genoeg
--  zijn: een scherm is te omzeilen en een trigger legt niets uit.
-- ---------------------------------------------------------------------------

create or replace function public.vestiging_bezet(loc text)
returns table (wat text, aantal bigint)
language sql stable security definer set search_path = public as $$
  select 'medewerkers'::text, count(*) from public.profiles
   where location_id = loc or loc = any(coalesce(manages, array[]::text[]))
  union all select 'wasbeurten',   count(*) from public.wash_jobs        where location_id = loc
  union all select 'diensten',     count(*) from public.shifts           where location_id = loc
  union all select 'urenregels',   count(*) from public.time_entries     where location_id = loc
  union all select 'installaties', count(*) from public.assets           where location_id = loc
  union all select 'storingen',    count(*) from public.faults           where location_id = loc
  union all select 'werkbonnen',   count(*) from public.work_orders      where location_id = loc
  union all select 'onderhoud',    count(*) from public.maintenance_plans where location_id = loc
  union all select 'voorraad',     count(*) from public.inventory_items  where location_id = loc
  union all select 'kassa''s',     count(*) from public.pos_registers    where location_id = loc
  union all select 'kluisboekingen', count(*) from public.pos_safe_moves where location_id = loc
  union all select 'overlegkanalen', count(*) from public.channels       where location_id = loc
$$;

grant execute on function public.vestiging_bezet(text) to authenticated;

create or replace function public.vestiging_bewaak_wissen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  bezet text;
begin
  select string_agg(wat || ': ' || aantal, ', ' order by aantal desc)
    into bezet
    from public.vestiging_bezet(old.id)
   where aantal > 0;

  if bezet is not null then
    raise exception
      'Deze vestiging kan niet weg, er hangt nog van alles aan (%). Zet hem uit in plaats van hem te wissen.',
      bezet
      using errcode = 'foreign_key_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists vestiging_wissen on public.locations;
create trigger vestiging_wissen before delete on public.locations
  for each row execute function public.vestiging_bewaak_wissen();

-- ---------------------------------------------------------------------------
--  Een nieuwe vestiging krijgt een kluis
--
--  0025 gaf elke bestaande vestiging er een. Wie er daarna een aanmaakt hoort
--  er ook een te krijgen, anders staat er bij de eerste afstorting op de
--  kassa geen kluis om in te boeken.
--
--  Het aanmaken gebeurt hier en niet in de app: de app die de vestiging maakt
--  is niet altijd dezelfde als de app die de kassa neerzet.
-- ---------------------------------------------------------------------------

create or replace function public.vestiging_krijgt_kluis()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.pos_safes (id, location_id, name)
  values ('kluis_' || new.id, new.id, 'Kluis ' || new.name)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists vestiging_kluis on public.locations;
create trigger vestiging_kluis after insert on public.locations
  for each row execute function public.vestiging_krijgt_kluis();

-- ===========================================================================
--  Een foto bij het artikel
--
--  Aan een balie zoek je niet op naam maar op hoe iets eruitziet. Twee flessen
--  ruitenwisservloeistof van hetzelfde merk verschillen in de winter en de
--  zomer een letter in de naam en een kleur op het etiket; wie er de hele dag
--  staat kiest op die kleur, niet op die letter.
--
--  Waarom de foto in de rij staat en niet in een bucket
--  ---------------------------------------------------
--
--  Supabase heeft opslag voor bestanden, en dat is de gewone plek voor een
--  plaatje. Hier niet, om één reden: de kassa moet het zonder internet doen.
--  Een foto achter een URL is een foto die er niet is als de lijn eruit ligt --
--  en dan staat er op het kassascherm een rij grijze vlakken op precies het
--  moment dat het rustig moet blijven werken.
--
--  Een foto in de rij komt mee met dezelfde synchronisatie als de prijs, staat
--  daarna in de lokale cache van elk apparaat, en werkt dus altijd. De prijs
--  daarvan is grootte, en die houden we klein: de kassa verkleint elke foto
--  vóór het opslaan tot een paar tienden van een kilobyte. Zie
--  src/lib/afbeelding.ts in de kassa-app.
--
--  De grens hieronder is de rem daaronder. Zonder die rem zet iemand ooit een
--  foto van vier megabyte in een artikel, en dan sleept elke kassa die bij
--  elke synchronisatie mee.
-- ===========================================================================

alter table public.pos_products
  add column if not exists image text;

/*
 * Een data-URI van maximaal ongeveer 150 kB.
 *
 * Ruim boven wat de kassa maakt (die mikt op 48 kB aan beeldgegevens, wat als
 * base64 zo'n 64 kB wordt), zodat een foto die elders is toegevoegd er ook
 * langs komt. En ruim onder wat een tabel met artikelen zwaar maakt.
 *
 * De controle staat er als NOT VALID: dan geldt hij voor alles wat er vanaf nu
 * in gaat, zonder dat het draaien van deze migratie op een bestaande database
 * kan struikelen over een rij die er al staat. Nieuwe rijen zijn waar het om
 * gaat -- een bestaande te grote foto is een last, geen fout.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pos_products_image_maat'
       and conrelid = 'public.pos_products'::regclass
  ) then
    alter table public.pos_products
      add constraint pos_products_image_maat
      check (image is null or length(image) <= 150000) not valid;
  end if;
end $$;

-- ===========================================================================
--  Een kassa is geen aanmelding
--
--  Toen de eerste kassa met een koppelcode werd gekoppeld, stond hij daarna in
--  het dashboard onder Aanmeldingen -- met een melding aan het management erbij
--  dat er iemand nieuw was. Dat is niet zomaar lelijk: het management moet dan
--  een beslissing nemen over een apparaat dat het zelf heeft aangezet, en een
--  lijst waar dingen in staan die niemand hoeft te beoordelen is een lijst die
--  je op een gegeven moment niet meer opent.
--
--  Waar het vandaan kwam: handle_new_user() draait bij elk nieuw inlogaccount.
--  Vindt hij geen dossier op dat e-mailadres, dan is het volgens hem een
--  aanmelding -- dossier op inactief, rij in signups, seintje naar het
--  management. Dat is precies goed voor een mens die zich meldt.
--
--  Maar de serverfunctie kassa-koppelen maakt ook een inlogaccount aan: elk
--  apparaat krijgt zijn eigen inlog, zodat er geen wachtwoord van een mens op
--  een tablet achter de balie staat. En dat account liep door dezelfde trechter.
--
--  Vanaf nu stapt de trigger daar uit. Het dossier van een apparaat wordt door
--  kassa-koppelen zelf gezet, met is_device erop, en er komt geen aanmelding en
--  geen melding bij.
--
--  Waarom het vlaggetje uit de metagegevens mag komen
--  -------------------------------------------------
--
--  In 0007 staat met nadruk dat rollen niet uit de gegevens van de client
--  worden overgenomen: die zijn niet te vertrouwen. Dat geldt hier ook, en
--  toch mag dit -- omdat deze vlag alleen maar minder kan opleveren.
--
--  Zet iemand bij het aanmelden zelf 'apparaat' in zijn metagegevens, dan
--  krijgt hij geen dossier en geen aanmelding, en dus nergens toegang: geen
--  rollen, geen vestiging, is_staff() onwaar. Hij heeft dan een inlog waarmee
--  je niets kunt. Een vlag die alleen deuren kan sluiten, hoeft niet
--  gecontroleerd te worden.
-- ===========================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  existing_id text;
  nieuw_id    text;
  aanmelding  text;
  volle_naam  text;
  soort       text;
begin
  /*
   * Een apparaat, geen mens.
   *
   * kassa-koppelen zet in de metagegevens dat dit een kassa is, en zet daarna
   * zelf het dossier neer -- met is_device, met de vestiging en op actief. Hier
   * hoeft dus niets te gebeuren, en er hoort vooral geen aanmelding te komen.
   */
  if coalesce(new.raw_user_meta_data->>'apparaat', '') = 'true' then
    return new;
  end if;

  volle_naam := coalesce(
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    split_part(new.email, '@', 1));

  -- 1. Staat er al een dossier klaar op dit e-mailadres? Dan koppelen we dat.
  --    Het management heeft die persoon dus zelf toegevoegd; de rollen die
  --    daar staan gelden, en hij kan meteen aan de slag.
  select id into existing_id
    from public.profiles
   where lower(email) = lower(new.email)
     and auth_id is null
   limit 1;

  if existing_id is not null then
    update public.profiles set auth_id = new.id where id = existing_id;
    return new;
  end if;

  -- 2. Anders is dit een aanmelding. Het dossier komt er wel, maar zonder
  --    rollen en op inactief: een account is nog geen toegang.
  nieuw_id := 'u_' || replace(new.id::text, '-', '');

  insert into public.profiles (id, auth_id, email, name, roles, active, phone, location_id)
  values (
    nieuw_id,
    new.id,
    new.email,
    volle_naam,
    array[]::text[],
    false,
    nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'location_id', '')), '')
  )
  on conflict (id) do nothing;

  soort := coalesce(new.raw_user_meta_data->>'signup_kind', 'werknemer');
  if soort not in ('werknemer', 'klant') then
    soort := 'werknemer';
  end if;

  aanmelding := 'sg_' || replace(new.id::text, '-', '');

  insert into public.signups (
    id, name, email, phone, kind, company_name, location_id, message,
    status, created_at, auth_id, profile_id)
  values (
    aanmelding,
    volle_naam,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), ''),
    soort,
    nullif(trim(coalesce(new.raw_user_meta_data->>'company_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'location_id', '')), ''),
    left(coalesce(new.raw_user_meta_data->>'message', ''), 600),
    'nieuw',
    public.now_ms(),
    new.id,
    nieuw_id
  )
  on conflict (id) do nothing;

  -- 3. Het management een seintje geven, zodat de aanmelding niet weken
  --    blijft liggen omdat niemand toevallig op dat tabblad keek.
  insert into public.notifications (
    id, to_role, kind, title, body, from_user_id, from_name, created_at, link)
  values (
    'nt_' || aanmelding,
    'management',
    'taak',
    'Nieuwe aanmelding: ' || volle_naam,
    volle_naam || ' meldt zich aan als ' || soort || ' (' || new.email || ').',
    -- Bewust zonder afzender: dit bericht komt van het systeem, niet van de
    -- aanmelder. Stond zijn eigen id hier, dan zou hij zijn eigen aanmelding
    -- in zijn berichten terugzien -- de regels laten je zien wat je zelf
    -- verstuurt.
    null,
    'Aanmelding',
    public.now_ms(),
    'aanmeldingen'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
--  Opruimen wat er al ligt
--
--  De kassa's die vóór deze migratie gekoppeld zijn, staan als aanmelding in de
--  lijst. Die halen we hier weg -- en niet alleen de aanmelding zelf, ook het
--  seintje eraan, want een melding die naar een aanmelding wijst die niet meer
--  bestaat is erger dan geen melding.
--
--  Herkennen doen we ze aan het vlaggetje op het inlogaccount, en niet aan
--  is_device op het dossier. Dat laatste lijkt logischer maar werkt hier niet:
--  is_device komt er pas op als kassa-koppelen het dossier heeft bijgewerkt, en
--  bij een kassa die halverwege is blijven steken is dat juist niet gebeurd.
--  Het vlaggetje staat er vanaf het moment dat het account gemaakt is.
-- ---------------------------------------------------------------------------

create or replace function public.is_apparaataccount(wie uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select coalesce(u.raw_user_meta_data->>'apparaat', '') = 'true'
       from auth.users u where u.id = wie),
    false);
$$;

delete from public.notifications
 where id in (
   select 'nt_' || s.id from public.signups s
    where s.auth_id is not null and public.is_apparaataccount(s.auth_id)
 );

delete from public.signups s
 where s.auth_id is not null and public.is_apparaataccount(s.auth_id);

-- ---------------------------------------------------------------------------
--  Een apparaat telt niet mee als medewerker
--
--  Dit is de kant die de app niet kan afdwingen. Overal waar in het dashboard
--  mensen worden opgesomd -- personeel, rooster, urenstaat, keuzelijsten --
--  hoort is_device eruit gefilterd te worden. Dat gebeurt in de app, en dat
--  blijft zo: de database weet niet wat een lijst is.
--
--  Wat de database wél kan, is ervoor zorgen dat een apparaat nooit per
--  ongeluk als mens in beeld komt doordat iemand er rollen aan hangt. Een
--  kassa heeft precies één rol nodig -- employee, voor de leesrechten op zijn
--  vestiging -- en verder niets.
-- ---------------------------------------------------------------------------

create or replace function public.apparaat_blijft_apparaat()
returns trigger language plpgsql as $$
begin
  if new.is_device then
    if new.roles is distinct from array['employee']::text[] then
      raise exception
        'Een kassa-account houdt de rol employee en niets anders. Wil je dit een medewerker maken, haal dan eerst is_device eraf.';
    end if;
    if new.manages is not null and array_length(new.manages, 1) > 0 then
      raise exception 'Een kassa-account heeft geen leiding over vestigingen.';
    end if;
    if coalesce(new.all_locations, false) then
      raise exception 'Een kassa-account hoort bij één vestiging, niet bij alle.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_apparaat on public.profiles;
create trigger profiles_apparaat before insert or update on public.profiles
  for each row execute function public.apparaat_blijft_apparaat();

-- ===========================================================================
--  De administratie
--
--  Er is een rol bij gekomen. Wat er goedgekeurd moet worden -- kostenposten,
--  urenwijzigingen, aanpassingen in een dossier, aanmeldingen -- stond in
--  vier verschillende schermen van het managementdashboard. Wie vier lijsten
--  moet openen om te weten of hij klaar is, denkt op een gegeven moment dat
--  hij klaar is.
--
--  Deze migratie doet drie dingen:
--
--    1. de administratie telt mee als personeel (is_staff)
--    2. wie kosten mag goedkeuren, mag ze ook zien en aftekenen -- tot nu toe
--       stond daar alleen "management", en het recht expenses.approve deed
--       in de database dus niets
--    3. er komt een veld bij waar in staat wat er uit een factuur is gelezen
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De administratie is personeel
--
--  is_staff() bepaalt op tientallen plekken of je iets mag zien: het rooster,
--  de wasbeurten, de voorraad, de berichten. Iemand van de administratie is
--  gewoon iemand die hier werkt, dus die hoort erbij.
--
--  Let op wat dit niet doet: het geeft geen enkel recht om iets te wijzigen.
--  Dat staat per tabel apart geregeld, en daar staat management of een
--  specifiek recht.
-- ---------------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean language sql stable as $$
  select 'employee' = any(public.my_roles())
      or 'administratie' = any(public.my_roles())
      or 'management' = any(public.my_roles());
$$;

-- ---------------------------------------------------------------------------
--  Wie mag kosten beoordelen
--
--  Het recht expenses.approve bestond al in de app, maar de database keek er
--  niet naar: daar gold alleen is_management(). Je kon het dus uitdelen zonder
--  dat er iets veranderde. Dat is het gevaarlijkste soort recht -- een dat er
--  is en niets doet.
-- ---------------------------------------------------------------------------

create or replace function public.mag_kosten_beslissen()
returns boolean language sql stable as $$
  select public.is_management() or public.heeft_recht('expenses.approve');
$$;

grant execute on function public.mag_kosten_beslissen() to authenticated;

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (
    public.mag_kosten_beslissen()
    or submitted_by = public.my_id()
  );

/*
 * De insertregel blijft zoals 0022 hem achterliet: rij_bestaat() vooraan,
 * anders valt een bijwerkende upsert over de insertcontrole. Alleen
 * is_management() is vervangen door de nieuwe functie.
 */
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (
    public.rij_bestaat('public.expenses'::regclass, id)
    or public.mag_kosten_beslissen()
    or (public.is_staff() and submitted_by = public.my_id())
  );

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (
    public.mag_kosten_beslissen()
    or (submitted_by = public.my_id() and status = 'open')
  )
  with check (
    public.mag_kosten_beslissen()
    or (submitted_by = public.my_id() and status = 'open')
  );

-- ---------------------------------------------------------------------------
--  Wat er uit de factuur is gelezen
--
--  Een eigen veld, en niet in supplier / amount_excl / vat_pct. Dat is het
--  hele punt: wat de app eruit haalt is een voorstel, wat in die velden staat
--  is wat een mens heeft goedgekeurd. Landen ze op dezelfde plek, dan kun je
--  een jaar later niet meer nagaan wie wat heeft ingevuld -- en dat is
--  precies de vraag die dan gesteld wordt.
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists gelezen jsonb;

/*
 * De uitkomst van het lezen hoort niet met de hand bijgewerkt te worden.
 * Hij komt van de serverfunctie, die met de servicesleutel werkt en dus
 * buiten deze regel valt. Wie hem in de app zou aanpassen, maakt van een
 * verslag een bewering.
 */
create or replace function public.lezing_blijft_lezing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- De serverfunctie schrijft hem; die werkt met de servicesleutel en heeft
  -- dus geen my_id(). Alleen wat uit de app komt wordt teruggezet.
  if public.my_id() is null then return new; end if;

  if new.gelezen is distinct from old.gelezen then
    new.gelezen := old.gelezen;
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_lezing on public.expenses;
create trigger expenses_lezing before update on public.expenses
  for each row execute function public.lezing_blijft_lezing();

-- ---------------------------------------------------------------------------
--  Wat de administratie verder moet kunnen zien
--
--  Urenwijzigingen en dossierwijzigingen stonden op "de leidinggevende of
--  het management". De administratie beoordeelt ze ook, dus die komt erbij --
--  via het recht dat er al voor bestaat en niet via de rolnaam. Dan kun je
--  het per persoon dichtzetten zonder dat je de rol hoeft af te pakken.
-- ---------------------------------------------------------------------------

drop policy if exists hr_select on public.hour_requests;
create policy hr_select on public.hour_requests for select to authenticated
  using (
    user_id = public.my_id()
    or public.is_lead()
    or public.heeft_recht('hours.approve')
  );

drop policy if exists hr_update on public.hour_requests;
create policy hr_update on public.hour_requests for update to authenticated
  using (public.is_lead() or public.heeft_recht('hours.approve') or user_id = public.my_id())
  with check (public.is_lead() or public.heeft_recht('hours.approve') or user_id = public.my_id());

/*
 * En de wacht op die tabel moet hem ook als beslisser zien. Zonder dit stukje
 * mag de administratie het verzoek wél openen en wél opslaan, maar zet de
 * trigger de beslissing terug -- en dat is precies het soort stilte waar je
 * een middag aan kwijt bent.
 */
create or replace function public.hr_bewaak_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.my_id() is null
     or public.is_lead()
     or public.heeft_recht('hours.approve')
  then
    return new;
  end if;

  -- De aanvrager mag precies één ding: zijn eigen verzoek intrekken.
  if new.status = 'ingetrokken'
     and old.status = 'nieuw'
     and old.user_id = public.my_id()
     and new.van is not distinct from old.van
     and new.tot is not distinct from old.tot
  then
    return new;
  end if;

  raise exception 'Over je eigen urenverzoek beslist je leidinggevende';
end;
$$;

-- ===========================================================================
--  Gewone facturen stonden als verdacht in de postbus
--
--  De bijlagecontrole hield een PDF tegen zodra er /OpenAction, /AA,
--  /EmbeddedFile of /RichMedia in stond. Dat leek redelijk en was het niet:
--
--    /OpenAction   staat in bijna elke PDF uit Word, InDesign of LaTeX en zet
--                  meestal alleen de beginweergave
--    /AA           hangt aan de formuliervelden van elke invulbare factuur
--    /EmbeddedFile is juist het kenmerk van een ZUGFeRD- of Factur-X-factuur:
--                  de Europese e-factuur met de gegevens als XML erin
--
--  Gevolg was dubbel. De bijlage ging op slot in het scherm, dus niemand kon
--  de factuur bekijken. En de AI las hem ook niet, want die sloeg alles over
--  wat niet 'schoon' was. Precies bij de bon die aandacht vroeg gebeurde er
--  dus niets, zonder dat iemand zag waarom.
--
--  De controle zelf is aangepast (supabase/functions/ontvang-mail/controle.ts).
--  Maar wat er al is binnengekomen draagt die uitkomst met zich mee, en dat
--  repareert zichzelf niet. Deze migratie haalt de uitkomst weg bij precies
--  die vier redenen -- niet bij alle verdachte bijlagen, want JavaScript en
--  /Launch blijven een reden om iets tegen te houden.
--
--  Zonder uitkomst geldt een bijlage als "van vóór de controle": hij gaat open
--  met een waarschuwing erbij. Dat is wat we willen -- niet stilletjes op
--  schoon zetten, want gecontroleerd is hij niet.
-- ===========================================================================

do $$
declare
  geraakt integer;
begin
  if not exists (select 1 from pg_tables
                  where schemaname = 'public' and tablename = 'mailbox') then
    return;
  end if;

  /*
   * De bijlagen staan als jsonb-array op het bericht. Uitpakken, de regels
   * bijwerken die het betreft, en weer inpakken -- met behoud van de volgorde,
   * want die bepaalt welke bijlage het scherm als eerste toont.
   */
  with geraakte as (
    select
      m.id,
      jsonb_agg(
        case
          when b.waarde ->> 'controle' = 'verdacht'
           and b.waarde ->> 'controleReden' ~ '(OpenAction|automatische actie|ingesloten bestand|ingesloten media|een actie die bij het openen afgaat)'
          then (b.waarde - 'controle' - 'controleReden' - 'controleOp')
               || jsonb_build_object(
                    'controleHersteld',
                    'De bijlagecontrole hield dit bestand eerder tegen om een reden die '
                    || 'niet klopte. Hij is nooit opnieuw nagekeken.')
          else b.waarde
        end
        order by b.volgnr
      ) as nieuw
      from public.mailbox m
      cross join lateral jsonb_array_elements(m.attachments)
                 with ordinality as b(waarde, volgnr)
     where m.attachments is not null
       and jsonb_typeof(m.attachments) = 'array'
     group by m.id
    having bool_or(
      b.waarde ->> 'controle' = 'verdacht'
      and b.waarde ->> 'controleReden' ~ '(OpenAction|automatische actie|ingesloten bestand|ingesloten media|een actie die bij het openen afgaat)'
    )
  )
  update public.mailbox m
     set attachments = g.nieuw
    from geraakte g
   where g.id = m.id;

  get diagnostics geraakt = row_count;
  raise notice 'Bijlagen vrijgegeven op % berichten', geraakt;
end $$;

-- ===========================================================================
--  Bijwerken is nog steeds geen aanmaken
--
--  Migratie 0022 repareerde dit voor expenses, employer_links en agenda_items.
--  Het bleek geen eigenschap van die drie tabellen te zijn maar van de manier
--  waarop de app opslaat, en dus zat het er nog op zes andere.
--
--  Wat er aan de hand is, nog een keer, want het is niet vanzelfsprekend:
--
--  De app stuurt een gewijzigde rij als geheel op, met een upsert. PostgREST
--  maakt daar "insert ... on conflict do update" van. PostgreSQL evalueert bij
--  zo'n opdracht de WITH CHECK van de INSERT-regel, óók als de rij allang
--  bestaat en er alleen wordt bijgewerkt.
--
--  Staat er in die insertregel iets over eigendom -- "je mag alleen namens
--  jezelf melden" -- dan klopt dat bij het aanmaken en klopt het niet meer
--  zodra iemand anders de rij bijwerkt. De ontwikkelaar die een melding
--  afhandelt is niet de melder. De leidinggevende die een wijzigingsverzoek
--  goedkeurt is niet de aanvrager. En de status is dan geen 'open' meer.
--
--  Het gevolg is een foutmelding die over rechten gaat terwijl er niets mis
--  is met de rechten, en een wijziging die in de wachtrij blijft staan.
--
--  De oplossing is dezelfde als in 0022: bestaat de rij al, dan is dit geen
--  aanmaken en gaat de insertregel opzij. Wat er dan wél mag, bepaalt de
--  updateregel -- en die staat er al, ongewijzigd. Er gaat dus geen deur
--  open die dicht hoorde te zijn; de deur die dicht zat was de verkeerde.
--
--  Niet aangeraakt: pos_safe_moves. Daar kan dit niet gebeuren, want een
--  kluisboeking wordt nooit bijgewerkt -- er staat een trigger op die dat
--  weigert. Wat niet wordt bijgewerkt, kan niet over deze val struikelen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Meldingen
--
--  Dit is de fout die gemeld werd. De ontwikkelaar die een melding oppakt,
--  van status verandert of er een reactie op zet, is niet degene die hem heeft
--  gemaakt -- en de insertregel eist dat wel.
-- ---------------------------------------------------------------------------

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert to authenticated
  with check (
    public.rij_bestaat('public.tickets'::regclass, id)
    or reported_by = public.my_id()
  );

drop policy if exists messages_insert on public.ticket_messages;
create policy messages_insert on public.ticket_messages for insert to authenticated
  with check (
    public.rij_bestaat('public.ticket_messages'::regclass, id)
    or (
      author_id = public.my_id()
      and (
        public.is_developer()
        or exists (
          select 1 from public.tickets t
           where t.id = ticket_id and t.reported_by = public.my_id()
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
--  Wijzigingsverzoeken op een dossier
--
--  Deze was gegarandeerd stuk en het is nooit gemeld. De insertregel eist
--  status = 'open' én dat jij de aanvrager bent. Op het moment dat iemand het
--  verzoek goedkeurt is de status geen 'open' meer en is de beslisser niet de
--  aanvrager -- dus faalt precies de handeling waar het verzoek voor bestaat.
-- ---------------------------------------------------------------------------

drop policy if exists cr_insert on public.change_requests;
create policy cr_insert on public.change_requests for insert to authenticated
  with check (
    public.rij_bestaat('public.change_requests'::regclass, id)
    or (
      public.is_lead()
      and aangevraagd_door = public.my_id()
      and status = 'open'
    )
  );

-- ---------------------------------------------------------------------------
--  Werkgevers
--
--  Zelfde verhaal: een aanvraag komt binnen met status 'aangevraagd' op naam
--  van de aanvrager. Zodra het management hem goedkeurt klopt geen van beide
--  voorwaarden meer.
-- ---------------------------------------------------------------------------

drop policy if exists wg_insert on public.employers;
create policy wg_insert on public.employers for insert to authenticated
  with check (
    public.rij_bestaat('public.employers'::regclass, id)
    or public.is_management()
    or (status = 'aangevraagd' and aangevraagd_door = public.my_id())
  );

-- ---------------------------------------------------------------------------
--  Overleg
--
--  Een bericht bijwerken -- een correctie, of het weghalen door iemand die
--  mag modereren -- struikelt over "author_id = mijn id". Een kanaal
--  bijwerken struikelt over de voorwaarden waaronder je er een mag aanmaken.
-- ---------------------------------------------------------------------------

drop policy if exists chat_insert on public.chat_messages;
create policy chat_insert on public.chat_messages for insert to authenticated
  with check (
    public.rij_bestaat('public.chat_messages'::regclass, id)
    or (
      public.is_staff()
      and author_id = public.my_id()
      and public.can_see_channel(channel_id)
    )
  );

drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check (
    public.rij_bestaat('public.channels'::regclass, id)
    or (
      public.is_staff()
      and (
        public.is_management()
        or public.is_supervisor()
        or (kind = 'gesprek' and public.my_id() = any(member_ids))
      )
    )
  );

-- ---------------------------------------------------------------------------
--  Opleiding
--
--  De minst waarschijnlijke van het stel -- een leidinggevende valt al onder
--  is_lead() -- maar de val zit er wel, en hem hier laten zitten betekent dat
--  iemand er over een half jaar opnieuw achter komt.
-- ---------------------------------------------------------------------------

drop policy if exists progress_insert on public.course_progress;
create policy progress_insert on public.course_progress for insert to authenticated
  with check (
    public.rij_bestaat('public.course_progress'::regclass, id)
    or user_id = public.my_id()
    or public.is_lead()
  );

-- ===========================================================================
--  Wat weg is, moet ook wegblijven
--
--  Een gewiste medewerker bleef in elk apparaat staan. Niet als restje in de
--  database -- daar was hij echt weg -- maar in de kopie die elke app lokaal
--  bijhoudt. Gevolg: hij stond nog in de personeelslijst, en je kon hem niet
--  opnieuw aanmaken omdat de dubbelcontrole hem daar zag staan.
--
--  Waarom dat gebeurde
--  -------------------
--
--  De app haalt wijzigingen op met "geef me alles wat is veranderd sinds
--  <tijdstip>" en zet die er lokaal overheen. Dat werkt voor nieuwe en
--  gewijzigde rijen, en het kan per definitie niet werken voor verwijderde
--  rijen: een rij die er niet meer is, komt niet mee in een lijst van rijen
--  die er wel zijn. Er was dus geen enkele manier waarop een apparaat kon
--  wéten dat er iets was weggehaald.
--
--  Dit is geen fout in één functie maar een gat in de opzet. Het raakt elke
--  harde verwijdering, niet alleen die van een medewerker.
--
--  De oplossing
--  ------------
--
--  Er was al een deletion_log -- die bestond om te kunnen navertellen wie wat
--  wanneer heeft gewist. Alleen stond er niet in wélke rij het betrof, dus je
--  kon er niets mee opruimen. Met die twee velden erbij wordt hij tegelijk de
--  lijst waaraan de apps kunnen zien wat ze moeten weggooien.
--
--  Bewust geen "verwijderd"-vlaggetje op de rij zelf. Dan blijft een gewist
--  personeelsdossier met BSN en rekeningnummer gewoon staan, en dat is precies
--  wat wissen niet moet zijn.
-- ===========================================================================

alter table public.deletion_log add column if not exists tabel     text;
alter table public.deletion_log add column if not exists record_id text;

create index if not exists deletion_log_record_idx
  on public.deletion_log (tabel, record_id);

/*
 * De oude regels weten niet welke rij het was; die zijn geschreven voordat
 * deze kolommen bestonden. Voor medewerkers valt dat te herstellen: het
 * dossier-id is niet bewaard, maar de naam wel, en de app kan daar niets mee.
 *
 * Dus laten we ze leeg. Een lege waarde betekent "onbekend, sla over", en dat
 * is eerlijker dan iets verzinnen. De apparaten die nu een spook hebben staan
 * ruimen dat op bij de eerstvolgende volledige verversing.
 */

comment on column public.deletion_log.tabel is
  'Welke tabel de rij in stond, in de naamgeving van de app (users, expenses, ...). Leeg bij regels van vóór deze migratie.';
comment on column public.deletion_log.record_id is
  'Het id van de rij die is weggehaald, zodat elk apparaat weet wat het lokaal moet weggooien.';

-- ---------------------------------------------------------------------------
--  Wie mag dit lezen
--
--  Iedereen die is ingelogd. Er staat niets gevoeligs in -- een naam, een
--  personeelsnummer en een reden -- en elk apparaat moet kunnen ophalen wat er
--  is weggehaald. Zonder leesrecht blijft het spook staan, en dan lost deze
--  migratie niets op.
--
--  Schrijven blijft bij het management, zoals het al was.
-- ---------------------------------------------------------------------------

drop policy if exists deletion_log_select on public.deletion_log;
create policy deletion_log_select on public.deletion_log for select to authenticated
  using (true);

-- ===========================================================================
--  De vestiging vult de website
--
--  De vestigingen staan in de app: adres, telefoon, openingstijden, foto's,
--  het aantal wasstraten. Op de website staan dezelfde achttien vestigingen
--  nog een keer, met de hand geschreven, in gegenereerde HTML.
--
--  Dat is één keer bijhouden te veel. Verhuist een vestiging of gaat er een
--  uur af op zaterdag, dan klopt de ene plek en de andere niet -- en de plek
--  die niet klopt is precies de plek waar de chauffeur kijkt.
--
--  Hier komen de velden bij die een openbare pagina nodig heeft en die er nog
--  niet waren. De rest -- adres, openingstijden, foto's -- staat er al sinds
--  0026.
--
--  Wat hier NIET gebeurt
--  ---------------------
--
--  De dienstenlijst van de app (buitenwas, cabine binnen, combi,
--  tankreiniging, polijsten) blijft ongemoeid. Dat is wat de wasstraat boekt
--  en afrekent, en dat type wordt letterlijk naar de kassa-repo gekopieerd --
--  daar iets aan veranderen raakt negentien kassa's.
--
--  Wat je verkoopt is een andere lijst en langer: veertien, met truckparking,
--  catering, HACCP en de wasboxen erbij. Die krijgt een eigen veld.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Welke pagina op de website hoort hierbij
--
--  Expliciet, en niet op naam raden. De site heeft vaste paden (/locaties/
--  utrecht/), de app heeft namen die iemand kan wijzigen. Koppelen op naam
--  betekent dat één hernoeming een pagina breekt zonder dat iemand het ziet.
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists website_slug text;

-- Twee vestigingen op dezelfde pagina kan niet: dan is het maar net welke de
-- lijst als eerste ziet, en dat verschilt per keer.
create unique index if not exists locations_slug_idx
  on public.locations (website_slug) where website_slug is not null;

-- ---------------------------------------------------------------------------
--  De tekst op de pagina
--
--  Drie soorten, want ze horen op verschillende plekken en hebben een
--  verschillend publiek:
--
--    intro       de alinea bovenaan de pagina -- waarom je hier komt
--    bereikbaar  hoe je er komt: de afrit, de oprit, waar de ingang zit.
--                Dit is het stukje waar een chauffeur die er nog nooit is
--                geweest werkelijk iets aan heeft.
--    bijzonder   wat hier anders is dan elders. Mag leeg blijven.
--
--  Losse velden en geen groot tekstvak: dan staat op elke pagina hetzelfde
--  soort informatie op dezelfde plek, en hoeft niemand na te denken over
--  opmaak.
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists intro      text;
alter table public.locations add column if not exists bereikbaar text;
alter table public.locations add column if not exists bijzonder  text;

-- ---------------------------------------------------------------------------
--  Wat kan hier
--
--  De sleutels komen overeen met de mappen op de website, zodat de pagina
--  rechtstreeks kan doorlinken naar de dienst. Vandaar de streepjes.
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists diensten text[] not null default '{}';

comment on column public.locations.diensten is
  'Sleutels van de diensten op de website: alcoa-velgen-reinigen, bus-wasstraat, '
  'camper-wasstraat, catering-op-locatie, haal-en-brengservice, '
  'haccp-certificaat-en-behandeling, interieur-reinigen, nao-wasplaats, '
  'truck-shop, truckparking, vogelgriep, vrachtwagen-polijsten, wasboxen, '
  'wegrestaurant-a2. Los van SERVICES in de app -- dat is wat de kassa boekt.';

-- ---------------------------------------------------------------------------
--  Hoort deze vestiging op de website
--
--  Niet elke vestiging is een publiek adres. Het hoofdkantoor hoort er niet
--  op, en een locatie die net is aangekocht ook nog niet. Standaard uit, want
--  per ongeluk iets publiceren is erger dan per ongeluk iets weglaten.
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists op_website boolean not null default false;

-- ---------------------------------------------------------------------------
--  Wat er publiek te zien is
--
--  Een openbare bezoeker heeft geen inlog, dus die kan de tabel locations niet
--  lezen -- en dat hoort ook zo: daar staat de vestigingsmanager in, de
--  interne notitie en welke vestigingen uit staan.
--
--  Deze functie geeft precies de velden terug die op een openbare pagina
--  horen, en alleen van vestigingen die daarvoor zijn aangewezen. Zo staat op
--  één plek in de database wat er naar buiten mag, en niet verspreid over de
--  code die het opvraagt.
-- ---------------------------------------------------------------------------

/*
 * Eerst weg, dan opnieuw -- en niet "create or replace".
 *
 * Postgres weigert een vervanging zodra de teruggegeven kolommen veranderen:
 * "cannot change return type of existing function". Dat is precies wat er
 * gebeurde toen 0035 er een kolom bij zette. Bij de eerste keer draaien merk
 * je dat niet; bij de TWEEDE keer wel, want dan komt dit bestand langs terwijl
 * de functie al de nieuwe vorm heeft, en dan valt supabase/bijwerken.sql
 * halverwege om. En dat bestand belooft juist dat opnieuw draaien altijd mag.
 */
drop function if exists public.website_vestigingen();

create function public.website_vestigingen()
returns table (
  slug        text,
  naam        text,
  adres       text,
  postcode    text,
  plaats      text,
  telefoon    text,
  email       text,
  lat         double precision,
  lon         double precision,
  wasstraten  integer,
  openingstijden jsonb,
  intro       text,
  bereikbaar  text,
  bijzonder   text,
  diensten    text[]
)
language sql stable security definer set search_path = public as $$
  select
    l.website_slug, l.name, l.address, l.postcode, l.city,
    l.phone, l.email, l.lat, l.lon, l.bays,
    l.opening_hours, l.intro, l.bereikbaar, l.bijzonder, l.diensten
  from public.locations l
  where l.op_website
    and l.active
    and l.website_slug is not null
  order by l.name;
$$;

/*
 * Hoeveel mensen er werken.
 *
 * Voor de vacaturepagina: "sluit je aan bij de andere zoveel". Eén getal, en
 * verder niets -- geen namen, geen verdeling over vestigingen. Dat laatste is
 * een landkaart van waar het bedrijf dun bezet is.
 *
 * Apparaten tellen niet mee. Een kassa is geen collega.
 */
create or replace function public.website_aantal_medewerkers()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.profiles
   where active
     and not coalesce(is_device, false)
     and archived_at is null
     and 'customer' <> all(coalesce(roles, array[]::text[]))
     and 'employer' <> all(coalesce(roles, array[]::text[]));
$$;

/*
 * Uitvoerrecht.
 *
 * Eerst intrekken, dan uitdelen -- en die volgorde is het hele punt.
 *
 * Postgres geeft het uitvoerrecht op een nieuwe functie uit zichzelf aan
 * PUBLIC. Alleen "grant to service_role" laat die standaard gewoon staan:
 * iedereen kan de functie dan aanroepen. En omdat het security definer-
 * functies zijn, stapt zo'n aanroep dwars door de beveiligingsregels op
 * locations en profiles heen. Dat is het omgekeerde van wat hierboven staat.
 *
 * Waarom anon en authenticated er apart bij staan
 * -----------------------------------------------
 *
 * Omdat "revoke from public" ze op Supabase NIET raakt. Supabase zet in elk
 * project een standaardregel klaar:
 *
 *   alter default privileges in schema public
 *     grant execute on functions to anon, authenticated, service_role;
 *
 * Daardoor krijgt elke nieuwe functie een EIGEN recht voor anon en
 * authenticated, en niet een recht via PUBLIC. Intrekken bij PUBLIC haalt die
 * eigen rechten er niet af. Gemeten op de echte database:
 *
 *   anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
 *
 * De eerste versie van deze migratie trok alleen bij PUBLIC in en leek te
 * werken, want in de test (PGlite) bestaat die standaardregel niet en erft
 * anon wél via PUBLIC. De test stond groen en het gat stond open. De stub in
 * scripts/sqltest.mjs bootst die regel nu na, zodat dit verschil niet meer
 * tussen wal en schip valt.
 *
 * De website haalt dit op via een serverfunctie met de servicesleutel. Anon
 * uitvoerrecht geven kan later alsnog, maar dan als besluit en niet als
 * bijvangst van een standaardinstelling.
 */
revoke execute on function public.website_vestigingen()        from public, anon, authenticated;
revoke execute on function public.website_aantal_medewerkers() from public, anon, authenticated;

grant execute on function public.website_vestigingen() to service_role;
grant execute on function public.website_aantal_medewerkers() to service_role;

-- ===========================================================================
--  Anon hoort hier niet bij te kunnen
--
--  Aanleiding: bij het nameten van 0033 bleek dat een bezoeker zonder inlog,
--  met alleen de publieke sleutel, twee functies kon aanroepen die daar niet
--  voor bedoeld zijn. Gemeten via de REST-laag, zonder enige sessie:
--
--    POST /rest/v1/rpc/pos_kluis_saldo  {"kluis":"..."}   -> 200, een bedrag
--    POST /rest/v1/rpc/vestiging_bezet  {"loc":"..."}     -> 200, een lijst
--
--  Dat is geen bewuste keuze geweest. In 0025 en 0026 staat letterlijk:
--
--    grant execute on function public.pos_kluis_saldo(text)  to authenticated;
--    grant execute on function public.vestiging_bezet(text)  to authenticated;
--
--  "to authenticated" betekent: ingelogd, en verder niemand. Maar Supabase
--  zet in elk project deze standaardregel klaar:
--
--    alter default privileges in schema public
--      grant execute on functions to anon, authenticated, service_role;
--
--  Daardoor krijgt elke nieuwe functie er anon gratis bij. De grant erna
--  bevestigt alleen wat er al stond; hij neemt niets weg. Deze migratie laat
--  de code dus doen wat er al stond -- ze verandert geen bedoeling.
--
--  Waarom dit veilig is
--  --------------------
--
--  Beide functies zijn security definer: ze draaien met de rechten van de
--  eigenaar en stappen dwars door de regels op de onderliggende tabellen
--  heen. Precies daarom moet de deur ervoor kloppen.
--
--  Nagekeken voordat dit werd ingetrokken:
--
--    - Geen van beide komt voor in een beveiligingsregel (using / with check).
--      Zat er wel een in, dan zou intrekken bij anon elke anonieme aanvraag op
--      die tabel een foutmelding geven in plaats van een lege lijst.
--    - Geen van beide apps roept ze aan. De enige rpc-aanroep in het dashboard
--      en de kassa samen is server_time_ms.
--    - vestiging_bezet wordt wel gebruikt binnen een trigger (0026, regel
--      196). Een trigger draait onder de eigenaar en heeft dit recht niet
--      nodig.
--
--  authenticated houdt zijn recht. Alleen anon gaat eraf.
--
--  LET OP: pos_kluis_saldo hoort bij de kassa (0025). Dit raakt geen enkele
--  regel van die functie zelf -- alleen wie hem mag aanroepen, en dat wordt
--  wat er in 0025 al als bedoeling staat.
-- ===========================================================================

-- Waarom PUBLIC er ook bij staat, en niet alleen anon
-- --------------------------------------------------
--
-- Er zitten twee rechten op deze functies, en je moet ze allebei weghalen:
--
--   =X/postgres        het recht van PUBLIC -- van Postgres zelf
--   anon=X/postgres    het eigen recht van anon -- van Supabase' standaardregel
--
-- anon is lid van PUBLIC. Trek je alleen het eigen recht in, dan kan anon het
-- nog steeds via PUBLIC. Trek je alleen bij PUBLIC in, dan kan anon het nog
-- steeds via zijn eigen recht. Precies die eerste helft ging in de eerste
-- versie van 0033 mis, en de tweede helft in de eerste versie van dit
-- bestand. Allebei betrapt door de controle in scripts/sqltest.mjs.
--
-- authenticated raakt zijn recht via PUBLIC hier ook kwijt, en krijgt het
-- daarom hieronder expliciet terug. Dat is meteen netter: dan staat er in de
-- rechten wie het mag in plaats van "iedereen behalve".

revoke execute on function public.pos_kluis_saldo(text) from public, anon;
revoke execute on function public.vestiging_bezet(text) from public, anon;

-- En teruggeven wat de bedoeling was, zodat opnieuw draaien altijd mag.
grant execute on function public.pos_kluis_saldo(text) to authenticated;
grant execute on function public.vestiging_bezet(text) to authenticated;

-- ===========================================================================
--  De achttien vestigingen komen naar binnen
--
--  Tot nu toe stonden de vestigingen op twee plekken, en geen van beide was
--  compleet. De app kende er twee -- het hoofdkantoor en een proefinvoer met
--  het adres "kasweg 2112". De website kende er achttien, met echte adressen,
--  telefoonnummers en openingstijden, maar die stonden in met de hand
--  geschreven HTML.
--
--  Vanaf hier is de app de bron. Deze migratie zet de achttien erin, precies
--  zoals ze op de site staan, zodat de site er daarna hetzelfde uitziet en
--  alleen zijn gegevens ergens anders vandaan haalt. Wie voortaan een adres
--  wijzigt of een uur van zaterdag afhaalt, doet dat op een plek.
--
--  Waar de gegevens vandaan komen
--  ------------------------------
--
--  Uit bouw/site.json van het merksiteproject. Dat bestand is destijds van
--  truckwash1group.nl geschraapt en is de bron waaruit de achttien
--  vestigingspagina's worden gegenereerd. Adres, postcode, plaats, telefoon,
--  e-mail, coordinaten, openingstijden, de introtekst en de routebeschrijving
--  zijn een-op-een overgenomen.
--
--  Wat NIET is overgenomen, en waarom
--  ----------------------------------
--
--    het aantal wasstraten   staat nergens op de site. Elke vestiging krijgt
--                            de standaardwaarde. Dit is het enige veld dat
--                            met de hand moet worden nagelopen, en tot dat
--                            gebeurd is hoort het niet op de site te staan.
--
--    de foto's               de site verwijst naar afbeeldingen op
--                            truckwash1group.nl. Die kopieren hoort bij het
--                            fotoscherm van de vestiging, niet bij een
--                            migratie.
--
--  Opnieuw draaien mag
--  -------------------
--
--  "on conflict do nothing", en niet "do update". Dat is met opzet: dit
--  bestand komt in supabase/bijwerken.sql terecht, en dat mag altijd opnieuw.
--  Met "do update" zou een tweede keer draaien alles terugzetten naar wat de
--  site ooit zei -- en daarmee elke wijziging wissen die daarna in de app is
--  gemaakt. Een importmigratie hoort een keer te importeren en zich daarna
--  stil te houden.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De punten op de vestigingspagina
--
--  Per vestiging staat er een lijstje op de site: "500 meter vanaf Flora
--  Holland", "Handwash met spons", "Haal en brengservice". Dat is geen
--  dienstenlijst maar het rijtje redenen om juist hier te stoppen, en het
--  verschilt echt per vestiging -- van de achttien lijsten zijn er twaalf
--  verschillend.
--
--  Los van de kolom diensten. Die bevat sleutels die naar een dienstpagina
--  wijzen; dit is vrije tekst die alleen op deze pagina staat.
-- ---------------------------------------------------------------------------

alter table public.locations
  add column if not exists punten text[] not null default '{}';

comment on column public.locations.punten is
  'Opsomming op de vestigingspagina van de website. Vrije tekst, een regel per '
  'punt. Los van de kolom diensten -- dat zijn sleutels naar een dienstpagina.';

-- ---------------------------------------------------------------------------
--  De achttien
-- ---------------------------------------------------------------------------

insert into public.locations (
  id, code, name, address, postcode, city, phone, email, lat, lon,
  opening_hours, website_slug, intro, bereikbaar, bijzonder, diensten, punten,
  kind, active, op_website
)
select
  v.id, v.code, v.name, v.address, v.postcode, v.city, v.phone, v.email,
  v.lat, v.lon, v.opening_hours, v.website_slug, v.intro, v.bereikbaar,
  v.bijzonder, v.diensten, v.punten,
  'vestiging', true, true
from (values
  ('loc_aalsmeer', 'TW-AAL', 'Truckwash Aalsmeer', 'Afmijnstraat 4', '1187 ZZ', 'Amstelveen', '0203035112', 'aalsmeer@truckwash1group.nl', 52.2606023, 4.7997808, '{"ma":{"van":"07:00","tot":"19:00"},"di":{"van":"07:00","tot":"19:00"},"wo":{"van":"07:00","tot":"19:00"},"do":{"van":"07:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"15:00"},"zo":null}'::jsonb, 'aalsmeer', 'Je vindt Truckwash 1 Aalsmeer op het bedrijventerrein Greenpoort aan de Afmijnstraat 4 in Amstelveen, langs de N201. Truckwash Aalsmeer is vanaf de A4 makkelijk te bereiken.', 'Vanuit Amsterdam neem je afslag 3 richting Hoofddorp en vervolgens via de N201. Vanuit Den Haag neem je ook afslag 3 richting Aalsmeer en vervolgens via de N201.', null, array['alcoa-velgen-reinigen', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['500 meter vanaf Flora Holland bloemenveiling', '5 minuten vanaf Schiphol Airport', '8 minuten vanaf snelweg A4', 'Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren']::text[]),
  ('loc_amsterdam', 'TW-AMS', 'Truckwash Amsterdam', 'Galwin 4', '1046AW', 'Amsterdam', '0203035135', 'amsterdam@truckwash1group.nl', 52.3956631, 4.8003185, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'amsterdam', 'Welkom bij Truckwash 1 Amsterdam, dé toonaangevende bestemming voor het grondig reinigen van vrachtwagens. Je vindt onze wasstraat aan Galwin 4 op bedrijventerrein Sloterdijk, nabij industriewijk Westpoort. Vanaf de A5 neem je afslag 3 Amsterdam-Westpoort.', 'Met twee moderne wasstraten is Truckwash 1 Amsterdam perfect uitgerust voor het reinigen van alle soorten vrachtwagens en bestelwagens. Onze wasstraten voldoen aan strenge normen en maken gebruik van de nieuwste reinigingsprogramma’s, waardoor je voertuig weer in optimale staat wordt gebracht. Terwijl ons gespecialiseerde personeel aan de slag gaat, kun je een kop koffie nuttigen in de wachtruimte.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_asten', 'TW-AST', 'Truckwash Asten', 'Nobisweg 5', '5721 VA', 'Asten', '+31(0)493 670242', 'asten@truckwash1group.nl', 51.4162996, 5.7567305, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"14:00"},"zo":null}'::jsonb, 'asten', 'Je vindt Truckwash 1 Asten direct langs de A67 in Asten, op het terrein van truckstop Nobis aan de Nobisweg 5.', 'Truckwash 1 Asten beschikt over 2 professionele wasstraten, geschikt voor alle soorten vrachtwagens en bestelwagens. Onze wasstraten voldoen aan de hoogste eisen en beschikken over de modernste reinigingsprogramma’s om jou wagen weer spik en span te maken.', null, array['alcoa-velgen-reinigen']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Velgen reinigen', 'Alcoa reiniging', 'Velgen reiniging', 'Zuren / Ontvetten', 'Wassen met spons']::text[]),
  ('loc_bodegraven', 'TW-BOD', 'Truckwash Bodegraven', 'Europaweg 1e', '2411 NE', 'Bodegraven', '0172619499', 'bodegraven@truckwash1group.nl', 52.0698105, 4.7445157, '{"ma":{"van":"08:00","tot":"19:00"},"di":{"van":"08:00","tot":"19:00"},"wo":{"van":"08:00","tot":"19:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"13:00"},"zo":null}'::jsonb, 'bodegraven', 'Je vindt Truckwash 1 Bodegraven op het bedrijven terrein Broekvelden aan de Europaweg 1e in Bodegraven, naast Goedhart Motoren. Truckwash Bodegraven is het beste te bereiken vanaf de A12 afslag 12a of afslag 12 Reeuwijk of vanaf de N11 afslag Bodegraven. Truckwash Bodegraven beschikt over 3 moderne wasstraten waarvan 1 LZV straat.', 'Twee straten zijn voorzien van een onderwasser voor de onderkant van jouw wagen. Elke straat is voorzien van een warmwatercleaner zodat we in elke hal de trailer inwendig kunnen reinigen. Door de drie straten en het efficiënt reinigen van jouw voertuigen verlagen wij de wachttijden tot een minimum.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_hazeldonk', 'TW-HAZ', 'Truckwash Hazeldonk', 'Hazeldonk 6005', '4836 LA', 'Breda', '076 596 3278', 'breda@truckwash1group.nl', 51.4902708, 4.7441562, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"12:00"},"zo":null}'::jsonb, 'hazeldonk', 'Truckwash 1 Hazeldonk is gevestigd in de voormalige Truckwash Hazeldonk locatie aan de Hazeldonk 6005, naast de Q8.
De Truckwash 1 locatie ligt strategisch gelegen aan de A16, bij de grens tussen België en Nederland.', 'De Truckwash wordt compleet gerenoveerd en krijgt een nieuwe machine, en word ingericht op de mogelijkheid om te kunnen voorwassen zodat het proces efficiënt verloopt.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling']::text[], array['We zullen van Maandag t/m Zaterdag geopend zijn', 'We accepteren alle betaalmogelijkheden die u van ons gewend bent', 'We bieden speciale behandelingen aan zoals een alcoa behandeling', 'Chauffeurs kunnen sparen voor leuke truck accessoires', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging', 'HACCP reiniging']::text[]),
  ('loc_doetinchem', 'TW-DOE', 'Truckwash Doetinchem', 'Braamtseweg 10', '7007 CK', 'Doetinchem', '088-0600 100', 'doetinchem@truckwash1group.nl', 51.9463034, 6.2834481, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'doetinchem', 'De nieuwe vestiging in Doetinchem ligt direct aan de A18 (afslag 3), een van de belangrijkste oost-westas voor het vrachtverkeer in de Achterhoek en het grensgebied met Duitsland. De locatie is daarmee ideaal bereikbaar voor transporteurs die rijden op de corridors richting het Ruhrgebied, Münster en verder.', 'Route plannen 
 Openingstijden 
 Vandaag geopend van 08.00 - 18.00', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_ede', 'TW-EDE', 'Truckwash Ede', 'Francis Baconstraat 2', '6718 XA', 'Ede', '0318452282', 'ede@truckwash1group.nl', 52.0356369, 5.6076683, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'ede', 'Je vindt Truckwash 1 Ede op het bedrijventerrein BT A12 op een A locatie op nog geen 5 minuten van de A12 (knooppunt Maanderbroek), en maar 2 minuten van de afslag 1 van de A30 (achter het Plantion).', 'Truckwash Ede beschikt over 2 moderne wasstraten en in 1 straat een onderwas voor de onderkant van jouw wagen. Door de twee straten en het efficiënt reinigen van jouw voertuigen verlagen wij de wachttijden tot een minimum. Je kunt ook een bezoek brengen aan onze shop of natuurlijk een kop koffie nuttigen.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats', 'vogelgriep']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van jouw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Bodemreiniging', 'Vogelgriep reiniging en desinfectie', 'Haal en brengservice (informeer contactpersoon)']::text[]),
  ('loc_eindhoven', 'TW-EIN', 'Truckwash Eindhoven', 'Het Schakelplein 30', '5651 GR', 'Eindhoven', '+31 (0) 40 262 02 22', 'eindhoven@truckwash1group.nl', 51.4659684, 5.4186163, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"12:00"},"zo":null}'::jsonb, 'eindhoven', 'Je vindt Truckwash 1 Eindhoven vlak bij de A2 (afrit 29, Eindhoven Airport/acht) en Eindhoven Airport (volg de N2). Op het bedrijventerrein Eindhoven-acht.', 'Truckwash 1 Eindhoven beschikt over 3 moderne wasstraten, speciaal voor vrachtwagens en bestelwagens, die voldoen aan de hoogste eisen. Kan je bedrijfswagen weer een wasbeurt gebruiken? Rij dan door de modernste wasstraat van Eindhoven en terwijl je wagen wordt gewassen, kun je een gratis kopje koffie halen bij ons restaurant. Of je nu het chassis, de buitenzijde of de binnenkant van de oplegger wilt laten reinigen: bij ons is (bijna) alles mogelijk. Onze wasstraat is bijzonder milieuvriendelijk.', null, array['alcoa-velgen-reinigen', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van jouw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Alcoa reiniging', 'HACCP reiniging', 'Velgen reiniging']::text[]),
  ('loc_groenlo', 'TW-GRO', 'Truckwash Groenlo', 'Noordgang 8', '7141JP', 'Groenlo', '0544745006', 'groenlo@truckwash1group.nl', 52.0616814, 6.6250053, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"14:00"},"zo":null}'::jsonb, 'groenlo', 'Truckwash 1 Groenlo is uitstekend bereikbaar via de N18 (Twenteroute) en vormt een logische stop voor chauffeurs in de Achterhoek en richting Duitsland. Dankzij de ligging vlak bij deze hoofdroute ben je snel van de weg af en eenvoudig weer onderweg.', 'Route plannen 
 Openingstijden 
 Vandaag geopend van 08.00 - 18.00', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_holten', 'TW-HOL', 'Truckwash Holten', 'Handelsweg 34', '7451PJ', 'Holten', '0548855574', 'holten@truckwash1group.nl', 52.2755805, 6.4011927, '{"ma":{"van":"07:00","tot":"18:00"},"di":{"van":"07:00","tot":"18:00"},"wo":{"van":"07:00","tot":"18:00"},"do":{"van":"07:00","tot":"18:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"13:00"},"zo":null}'::jsonb, 'holten', 'Welkom bij Truckwash 1 Holten, dé toonaangevende bestemming in Twente voor het grondig reinigen van vrachtwagens. Je vindt onze vrachtwagen wasstraat aan de Handelsweg 34, aan de N332.', 'Truckwash 1 Holten is uitgerust met maar liefst 5 banen. Drie moderne wasstraten voor het reinigen van alle soorten vrachtwagens en bestelwagens. Daarnaast hebben we nog twee plaatsen voor het uitspuiten van de binnenkant. Onze wasstraten voldoen aan strenge normen en maken gebruik van effectieve reinigingsprogramma’s, waardoor je voertuig weer in optimale staat wordt gebracht. Terwijl ons gespecialiseerde personeel aan de slag gaat, kun je in onze wachtruimte genieten van een kop koffie.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van je laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_maasvlakte', 'TW-MAA', 'Truckwash Maasvlakte', 'Luzonstraat 10', '3199 KX', 'Maasvlakte', '0181 44 25 60', 'maasvlakte@truckwash1group.nl', 51.9276713, 4.023263, '{"ma":{"van":"08:00","tot":"21:00"},"di":{"van":"08:00","tot":"21:00"},"wo":{"van":"08:00","tot":"21:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'maasvlakte', 'Je vindt Truckwash 1 Maasvlakte op de Maasvlakte Plaza in Rotterdam aan de Luzonstraat 10. Truckwash Maasvlakte is de grootste Truckwash van Europa en is het beste te bereiken via de A15 naar de N15. Naast ons terrein zit de Maasvlakte Plaza, chauffeur restaurant genaamd Routiers, en de Maasvlakte Plaza Truckparking.', 'Truckwash 1 Maasvlakte beschikt over 6 wasstraten. Door de vier straten en het efficiënt reinigen van jouw voertuigen verlagen wij de wachttijden tot een minimum.', 'Op zondag alleen op afspraak.', array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats', 'truckparking', 'wegrestaurant-a2']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van je laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_rilland', 'TW-RIL', 'Truckwash Rilland', 'De Poort 24a', '4411PA', 'Rilland', '0113560028', 'rilland@truckwash1group.nl', 51.4222148, 4.1914538, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"07:00","tot":"16:00"},"zo":null}'::jsonb, 'rilland', 'Je vindt Truckwash 1 Rilland op het bedrijventerrein De Poort, naast het tankstation De Meeuw. Onze locatie is het best te bereiken via de A58. We zijn gevestigd op De Poort 24a.', 'We beschikken over 2 moderne wasstraten en 1 hal in het midden die gebruikt kan worden voor het inwendig reinigen van trailers en/of zelfservice.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_roosendaal', 'TW-ROO', 'Truckwash Roosendaal', 'Stepvelden 23', '4704RM', 'Roosendaal', '0165529496', 'roosendaal@truckwash1group.nl', 51.5539283, 4.4635791, '{"ma":{"van":"07:00","tot":"21:00"},"di":{"van":"07:00","tot":"21:00"},"wo":{"van":"07:00","tot":"21:00"},"do":{"van":"07:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"16:00"},"zo":null}'::jsonb, 'roosendaal', 'Je vindt Truckwash 1 Roosendaal op het bedrijventerrein de Borchwerf aan de Stepvelden 23, Roosendaal. Jouw locatie is het best te bereiken via de A17 afslag 20. We beschikken over 2 moderne wasstraten van 35 meter lang. Alle voertuigen die niet in een normale wasstraat passen kunnen bij ons terecht.', 'Ben je op zoek naar een truckwash in de buurt van Hazeldonk (Breda )? Dan is Truckwash 1 in Roosendaal het dichtste bij jou in de buurt.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van jouw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Stickerverwijdering in trailers', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)']::text[]),
  ('loc_rotterdam', 'TW-ROT', 'Truckwash Rotterdam', 'Tweedweg 20', '3197 LM', 'Rotterdam-Botlek', '0102967764', 'rotterdam@truckwash1group.nl', 51.8734417, 4.2631194, '{"ma":{"van":"07:00","tot":"21:00"},"di":{"van":"07:00","tot":"21:00"},"wo":{"van":"07:00","tot":"21:00"},"do":{"van":"07:00","tot":"21:00"},"vr":{"van":"07:00","tot":"21:00"},"za":{"van":"07:00","tot":"16:00"},"zo":null}'::jsonb, 'rotterdam', 'Truckwash 1 Rotterdam zit in de Botlek aan de Tweedweg 20. Bereikbaar via de A15 (afslag 15). Met 4 wasstraten is dit een van onze grootste locaties. Naast het terrein: een ADR truckparking (betaald), truckerrestaurant Routiers, een Q8 truck-tankstation en een gratis parkeerplaats. Kortom alles op één plek. Geen afspraak nodig.', 'Door de vier straten en het efficiënt reinigen van je voertuigen verlagen we de wachttijden tot een minimum. Elke hal beschikt over een warmwater cleaner zodat we op iedere baan ook de trailer inwendig kunnen reinigen. Moet je even wachten? Dan kun je gebruik maken van de stofzuiger om je cabine schoon te maken. Je kunt ook een bezoek brengen aan onze shop of natuurlijk een kop koffie nuttigen. Lang onderweg geweest? Je kunt bij ons gebruik maken van de douches.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats', 'truckparking', 'wegrestaurant-a2']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_steenwijk', 'TW-STE', 'Truckwash Steenwijk', 'Oostermeentherand 8', '8332JZ', 'Steenwijk', '0521745003', 'Steenwijk@truckwash1group.nl', 52.7974282, 6.1293435, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"18:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'steenwijk', 'Truckwash 1 Steenwijk ligt op korte afstand van de A32 (afslag Steenwijk) en is daarmee ideaal bereikbaar voor chauffeurs die rijden tussen Zwolle, Meppel en Leeuwarden. De aanrijroute is overzichtelijk en geschikt voor zwaar transport.', 'Door de combinatie van moderne apparatuur en een vlot werkend team kun je hier rekenen op een snelle doorloop zonder concessies te doen aan kwaliteit. Efficiënt wassen met een schoon en representatief resultaat.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_utrecht', 'TW-UTR', 'Truckwash Utrecht', 'Reactorweg 27', '3542 AD', 'Utrecht', '0307740744', 'utrecht@truckwash1group.nl', 52.10574, 5.0633264, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"}}'::jsonb, 'utrecht', 'Je vindt Truckwash 1 Utrecht op het bedrijventerrein Lage Weide aan de Reactorweg 27. Lage Weide is het best te bereiken vanaf de A2 afslag 7. (In het pand van Van Leeuwen Trucks & vans). Truckwash Utrecht beschikt over 2 moderne wasstraten.', 'Door de twee straten en het efficiënt reinigen van je voertuigen verlagen we de wachttijden tot een minimum. Moet je even wachten? Dan kun je gebruik maken van de stofzuiger om je cabine schoon te maken. Je kunt ook een bezoek brengen aan onze shop of natuurlijk een kop koffie nuttigen.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Alcoa / Dura Bright behandeling', 'Handwash met spons', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van je laadruimtes (HACCP & NAO):', 'Ontsmetten en/of desinfecteren', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_venlo', 'TW-VEN', 'Truckwash Venlo', 'Columbusweg 47', '5928LA', 'Venlo', '0773230405', 'venlo@truckwash1group.nl', 51.3958245, 6.0898586, '{"ma":{"van":"08:00","tot":"19:00"},"di":{"van":"08:00","tot":"19:00"},"wo":{"van":"08:00","tot":"19:00"},"do":{"van":"08:00","tot":"21:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"13:00"},"zo":null}'::jsonb, 'venlo', 'Welkom bij Truckwash 1 Venlo, dé toonaangevende bestemming in Venlo en omstreken voor het grondig reinigen van vrachtwagens. Je vindt onze wasstraat aan de Columbusweg 47 op bedrijventerrein Trade Port West. Vanaf de A67 neem je afslag 39 Sevenum.', 'Truckwash 1 Venlo is uitgerust met twee moderne wasstraten voor het reinigen van alle soorten vrachtwagens en bestelwagens. Onze wasstraten voldoen aan strenge normen en maken gebruik van de nieuwste reinigingsprogramma’s, waardoor uw voertuig weer in optimale staat wordt gebracht. Wassen gebeurt bovendien op een duurzame manier . Terwijl ons gespecialiseerde personeel aan de slag gaat, kun je in onze wachtruimte genieten van een kop koffie.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van uw laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[]),
  ('loc_wehl', 'TW-WEH', 'Truckwash Wehl', 'Kryptonstraat 6A', '7031GG', 'Wehl', '088-0600100', 'holten@truckwash1group.nl', 51.9464915, 6.2251281, '{"ma":{"van":"08:00","tot":"18:00"},"di":{"van":"08:00","tot":"18:00"},"wo":{"van":"08:00","tot":"18:00"},"do":{"van":"08:00","tot":"18:00"},"vr":{"van":"08:00","tot":"21:00"},"za":{"van":"08:00","tot":"16:00"},"zo":null}'::jsonb, 'wehl', 'Truckwash 1 Wehl is goed bereikbaar via de A18 (afslag Wehl/Doetinchem) en ligt centraal in de Achterhoek. De ligging maakt deze locatie een vaste stop voor transportbewegingen in Oost-Nederland en richting Duitsland.', 'De locatie is volledig ingericht op efficiënt werken, met aandacht voor kwaliteit en zorgvuldige reiniging. Zo vervolg je je route met een schone vrachtwagen en minimale tijd van de weg.', null, array['alcoa-velgen-reinigen', 'haal-en-brengservice', 'haccp-certificaat-en-behandeling', 'nao-wasplaats']::text[], array['Ontsmetten en/of desinfecteren', 'Handwash met spons', 'Alcoa / Dura Bright behandeling', 'Het reinigen van alle aluminium onderdelen', 'Het inwendig reinigen van laadruimtes (HACCP & NAO)', 'Haal en brengservice (informeer contactpersoon)', 'Wassen op afspraak (informeer contactpersoon)', 'Alcoa reiniging']::text[])
) as v (
  id, code, name, address, postcode, city, phone, email, lat, lon,
  opening_hours, website_slug, intro, bereikbaar, bijzonder, diensten, punten
)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
--  De proefinvoer bijwerken
--
--  Er stond al een "Truckwash Utrecht" met de code TW-UTR en het adres
--  "kasweg 2112". Die code botst met de echte Utrecht-vestiging hierboven, dus
--  die is door "do nothing" overgeslagen -- en dan bleef de proefinvoer staan
--  met het verkeerde adres erin.
--
--  Bijwerken en niet weggooien: er kunnen al uren, wasbeurten of roosters aan
--  deze vestiging hangen, en die verwijzen naar dit id. Een nieuwe rij naast
--  de oude zou Utrecht twee keer in elke keuzelijst zetten.
--
--  De voorwaarde op het adres maakt dit eenmalig. Heeft iemand het adres al
--  goedgezet -- met de hand of door deze migratie -- dan gebeurt er niets meer,
--  en blijft alles wat daarna in de app is gewijzigd gewoon staan.
-- ---------------------------------------------------------------------------

update public.locations bestaand
   set name          = echt.name,
       address       = echt.address,
       postcode      = echt.postcode,
       city          = echt.city,
       phone         = echt.phone,
       email         = echt.email,
       lat           = echt.lat,
       lon           = echt.lon,
       opening_hours = echt.opening_hours,
       website_slug  = echt.website_slug,
       intro         = echt.intro,
       bereikbaar    = echt.bereikbaar,
       diensten      = echt.diensten,
       punten        = echt.punten,
       op_website    = true,
       updated_at    = public.now_ms()
  from public.locations echt
 where bestaand.code = 'TW-UTR'
   and echt.id       = 'loc_utrecht'
   and bestaand.id  <> echt.id
   and lower(trim(coalesce(bestaand.address, ''))) = 'kasweg 2112';

-- De rij waaruit is overgenomen mag daarna weg: hij is nooit in gebruik
-- geweest en zou Utrecht anders dubbel in de lijst zetten.
delete from public.locations
 where id = 'loc_utrecht'
   and exists (
     select 1 from public.locations b
      where b.code = 'TW-UTR' and b.id <> 'loc_utrecht'
        and b.website_slug = 'utrecht');

-- ---------------------------------------------------------------------------
--  Hoeveel mensen er werken
--
--  De telling voor de vacaturepagina zat er naast. Hij sloot iedereen uit met
--  de rol "klant" of "werkgever", en dat is te streng: rollen stapelen in dit
--  systeem. Wie werknemer is en daarnaast een klantaccount heeft, is nog
--  steeds gewoon een collega. Gemeten op de echte database gaf dat 1 in plaats
--  van 6 -- en 1 is een getal dat je niet op een vacaturepagina wilt zetten
--  voor een bedrijf met negentien vestigingen.
--
--  De nieuwe regel is eenvoudiger en zegt wat hij bedoelt: iedereen die de rol
--  werknemer heeft, actief is, niet is uitgeschreven, en geen kassa is.
-- ---------------------------------------------------------------------------

create or replace function public.website_aantal_medewerkers()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.profiles
   where active
     and archived_at is null
     and not coalesce(is_device, false)
     and 'employee' = any(coalesce(roles, array[]::text[]));
$$;

-- ---------------------------------------------------------------------------
--  De punten mee naar buiten
--
--  website_vestigingen() gaf ze nog niet terug, en zonder die lijst kan de
--  site de vestigingspagina niet maken zoals hij nu is.
-- ---------------------------------------------------------------------------

drop function if exists public.website_vestigingen();

create function public.website_vestigingen()
returns table (
  slug        text,
  naam        text,
  adres       text,
  postcode    text,
  plaats      text,
  telefoon    text,
  email       text,
  lat         double precision,
  lon         double precision,
  wasstraten  integer,
  openingstijden jsonb,
  intro       text,
  bereikbaar  text,
  bijzonder   text,
  diensten    text[],
  punten      text[]
)
language sql stable security definer set search_path = public as $$
  select
    l.website_slug, l.name, l.address, l.postcode, l.city,
    l.phone, l.email, l.lat, l.lon, l.bays,
    l.opening_hours, l.intro, l.bereikbaar, l.bijzonder, l.diensten, l.punten
  from public.locations l
  where l.op_website
    and l.active
    and l.website_slug is not null
  order by l.name;
$$;

/*
 * De rechten opnieuw zetten.
 *
 * "drop function" gooit ook de rechten weg, en de nieuwe functie krijgt van
 * Supabase weer automatisch anon en authenticated erbij -- zie 0033 en 0034.
 * Zonder deze twee regels staat het gat dat daar is gedicht meteen weer open.
 */
revoke execute on function public.website_vestigingen()        from public, anon, authenticated;
revoke execute on function public.website_aantal_medewerkers() from public, anon, authenticated;

grant execute on function public.website_vestigingen()        to service_role;
grant execute on function public.website_aantal_medewerkers() to service_role;

-- ===========================================================================
--  Utrecht bleef op "kasweg 2112" staan
--
--  0035 zou achttien vestigingen invoeren en heeft er zeventien gedaan.
--  Utrecht ontbreekt, en de proefinvoer met het adres "kasweg 2112" staat er
--  nog. Gemeten na afloop: 19 rijen, 17 met punten, en de rij met code TW-UTR
--  heeft geen website_slug.
--
--  Waarom het misging
--  ------------------
--
--  0035 voegt in met "on conflict (code) do nothing". Dat is met opzet -- een
--  importmigratie mag bij een tweede keer draaien niets overschrijven. Maar de
--  code TW-UTR was al bezet door de proefinvoer, dus de echte Utrecht werd
--  overgeslagen en de rij loc_utrecht is nooit ontstaan.
--
--  En precies die rij had de reparatie eronder als bron nodig:
--
--    update ... from public.locations echt where echt.id = 'loc_utrecht'
--
--  Geen bronrij, geen update. Geen foutmelding ook: nul rijen bijwerken is
--  voor Postgres een geldig antwoord. De migratie meldde succes en deed de
--  helft.
--
--  Waarom de test het niet ving
--  ----------------------------
--
--  Die botsing bestond in de test ook -- een fixture maakte een vestiging aan
--  met de code TW-UTR. Toen 0035 daarop stukliep is de fixture hernoemd naar
--  TST-UTR. Daarmee verdween de botsing uit de test, en dus ook het enige
--  geval waarvoor de reparatie geschreven was. De test werd groen door het
--  probleem weg te halen in plaats van het na te rekenen.
--
--  In scripts/sqltest.mjs wordt de situatie nu nagebouwd zoals hij op de
--  echte database was, en pas daarna wordt dit bestand gedraaid.
--
--  Wat deze migratie doet
--  ----------------------
--
--  De bestaande rij bijwerken, niet vervangen. Aan die rij kunnen uren,
--  wasbeurten, roosters en een kluis hangen, en die verwijzen naar zijn id.
--  Weggooien en opnieuw invoeren zou dat meenemen.
--
--  Het aantal wasstraten blijft staan zoals het staat. De site zegt "2
--  moderne wasstraten" in de introtekst, maar in de app staat 3 -- met de hand
--  ingevuld, en dat is vermoedelijk de werkelijkheid. Een migratie hoort geen
--  getal te overschrijven dat iemand zelf heeft nagekeken.
-- ===========================================================================

update public.locations
   set name          = 'Truckwash Utrecht',
       address       = 'Reactorweg 27',
       postcode      = '3542 AD',
       city          = 'Utrecht',
       phone         = '0307740744',
       email         = 'utrecht@truckwash1group.nl',
       lat           = 52.10574,
       lon           = 5.0633264,
       opening_hours = '{"ma":{"van":"08:00","tot":"18:00"},'
                       '"di":{"van":"08:00","tot":"18:00"},'
                       '"wo":{"van":"08:00","tot":"18:00"},'
                       '"do":{"van":"08:00","tot":"18:00"},'
                       '"vr":{"van":"08:00","tot":"21:00"},'
                       '"za":{"van":"08:00","tot":"13:00"}}'::jsonb,
       website_slug  = 'utrecht',
       intro         = 'Je vindt Truckwash 1 Utrecht op het bedrijventerrein '
                       'Lage Weide aan de Reactorweg 27. Lage Weide is het best '
                       'te bereiken vanaf de A2 afslag 7. (In het pand van Van '
                       'Leeuwen Trucks & vans). Truckwash Utrecht beschikt over '
                       '2 moderne wasstraten.',
       bereikbaar    = 'Door de twee straten en het efficiënt reinigen van je '
                       'voertuigen verlagen we de wachttijden tot een minimum. '
                       'Moet je even wachten? Dan kun je gebruik maken van de '
                       'stofzuiger om je cabine schoon te maken. Je kunt ook een '
                       'bezoek brengen aan onze shop of natuurlijk een kop '
                       'koffie nuttigen.',
       diensten      = array[
                         'alcoa-velgen-reinigen',
                         'haal-en-brengservice',
                         'haccp-certificaat-en-behandeling',
                         'nao-wasplaats'
                       ]::text[],
       punten        = array[
                         'Alcoa / Dura Bright behandeling',
                         'Handwash met spons',
                         'Het reinigen van alle aluminium onderdelen',
                         'Het inwendig reinigen van je laadruimtes (HACCP & NAO):',
                         'Ontsmetten en/of desinfecteren',
                         'Haal en brengservice (informeer contactpersoon)',
                         'Wassen op afspraak (informeer contactpersoon)',
                         'Alcoa reiniging'
                       ]::text[],
       op_website    = true,
       updated_at    = public.now_ms()
 where code = 'TW-UTR'
   -- Eenmalig, en daarmee opnieuw te draaien: zodra het adres klopt, of zodra
   -- iemand er in de app iets aan heeft veranderd, gebeurt hier niets meer.
   and lower(trim(coalesce(address, ''))) = 'kasweg 2112';

/*
 * Het gat dat 0035 openliet.
 *
 * Was er nooit een proefinvoer geweest, dan had 0035 Utrecht gewoon ingevoerd
 * en doet de update hierboven niets. Deze regel vangt dat geval af, zodat dit
 * bestand op elke database hetzelfde eindresultaat geeft: precies een Utrecht,
 * op de website, met een slug.
 *
 * De insert vindt geen bestaande rij met deze code, want die zou hierboven al
 * zijn bijgewerkt en dan is aan de where-voorwaarde voldaan.
 */
insert into public.locations (
  id, code, name, address, postcode, city, phone, email, lat, lon,
  website_slug, kind, active, op_website
)
select
  'loc_utrecht', 'TW-UTR', 'Truckwash Utrecht', 'Reactorweg 27', '3542 AD',
  'Utrecht', '0307740744', 'utrecht@truckwash1group.nl', 52.10574, 5.0633264,
  'utrecht', 'vestiging', true, true
where not exists (
  select 1 from public.locations where website_slug = 'utrecht'
);

-- ===========================================================================
--  Een kassa mag klokken
--
--  Wat er gebeurde: iemand klokte in op de kassa, zag "is ingeklokt", stond
--  onder "Nu aan het werk" -- en de urenregel kwam nooit in de administratie.
--  De database weigerde hem, en de kassa gooide hem na acht pogingen weg.
--
--  Dat weggooien is in de kassa rechtgezet (versie 0.10.0: zo'n weigering
--  verbruikt geen pogingen meer en er komt een melding aan de balie). Dit is
--  de andere helft: de weigering zelf.
--
--  Waarom hij geweigerd werd
--  -------------------------
--
--  Sinds 0018 gaat klokken via de kassa, en de regel daar is:
--
--      insert on time_entries: is_management() or heeft_recht('hours.clock')
--
--  heeft_recht() kijkt in profiles.grants. Een gekoppelde kassa krijgt sinds
--  0025 zijn eigen inlogaccount met een dossier erbij -- rol employee, een
--  vestiging, en verder niets. Geen grants dus, en dus geen hours.clock.
--
--  De rechten van de kassa en de rechten van de medewerker zijn twee
--  verschillende dingen, en dat is precies waar dit misging. In de app wordt
--  gekeken of degene die er staat mag klokken; de database kijkt naar het
--  apparaat dat het verzoek stuurt. Beide horen te kloppen, en van die tweede
--  was niemand zich bewust.
--
--  Waarom juist dit recht, en niet meer
--  ------------------------------------
--
--  Klokken is het enige wat een kassa doet en wat niet elders kan: mensen
--  klokken in bij het apparaat waar ze langslopen. Alles wat de kassa verder
--  wegschrijft -- bonnen, kasmutaties, kluisboekingen, wasopdrachten, voorraad
--  -- komt al langs op is_staff() plus de eigen vestiging, en dat heeft dit
--  dossier.
--
--  pos.manage krijgt hij níet. Dat zou betekenen dat de inloggegevens van een
--  tablet achter de balie genoeg zijn om prijzen te wijzigen. Wat daar nog wél
--  aan vastzit staat onderaan dit bestand.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De kassa's die er al staan
-- ---------------------------------------------------------------------------

update public.profiles
   set grants = (
     select array_agg(distinct g)
       from unnest(coalesce(grants, array[]::text[]) || array['hours.clock']) as g
   )
 where is_device
   and not ('hours.clock' = any(coalesce(grants, array[]::text[])));

-- ---------------------------------------------------------------------------
--  En de kassa's die er nog bij komen
--
--  De serverfunctie kassa-koppelen zet dit recht ook zelf op het dossier. Deze
--  trigger is de rem eronder: hij vult het aan als het er niet op staat.
--
--  Twee plekken voor hetzelfde is meestal een fout, hier niet. De functie is de
--  gewone weg; deze trigger vangt de gevallen die daar niet langskomen -- een
--  dossier dat met de hand op is_device wordt gezet, of een kassa die gekoppeld
--  is met een oudere versie van de functie. Een kassa waarvan de uren stil
--  wegvallen is te duur om van één plek af te laten hangen.
-- ---------------------------------------------------------------------------

create or replace function public.apparaat_mag_klokken()
returns trigger language plpgsql as $$
begin
  if new.is_device
     and not ('hours.clock' = any(coalesce(new.grants, array[]::text[])))
  then
    new.grants := coalesce(new.grants, array[]::text[]) || array['hours.clock'];
  end if;
  return new;
end;
$$;

/*
 * Vóór profiles_apparaat, want die controleert wat er op het dossier staat en
 * deze vult het aan. Triggers met dezelfde tijd lopen op alfabet, en
 * "profiles_apparaat_klokken" komt na "profiles_apparaat" -- dus krijgt hij een
 * naam die eerder komt. Dat is lelijk en het staat er daarom bij.
 */
drop trigger if exists profiles_a_klokken on public.profiles;
create trigger profiles_a_klokken before insert or update on public.profiles
  for each row execute function public.apparaat_mag_klokken();

-- ---------------------------------------------------------------------------
--  Wat de kassa hierna nog steeds niet mag, en waarom dat een keuze is
--
--  Twee schermen in de kassa schrijven naar tabellen die mag_kassa_beheren()
--  vragen, en dat heeft een apparaataccount niet:
--
--    Beheer -> Artikelen        pos_products
--    Beheer -> Nummers, badges  pos_pins
--
--  Die blijven dus weigeren. Dat is geen vergissing maar het is ook niet af:
--  een scherm dat invoer aanneemt en het daarna niet kan opslaan, is dezelfde
--  soort fout als de inklokking die verdween -- alleen valt hij nu wél op,
--  want de kassa laat sinds 0.10.0 zien wat er in de wachtrij vastzit.
--
--  Er zijn twee eerlijke uitkomsten, en het is een keuze welke:
--
--    1. Prijzen en badges horen bij het kantoor, zoals vestigingen, kassa's en
--       kluizen. Dan gaan die twee schermen uit de kassa en komen ze in het
--       dashboard.
--    2. De kassa mag het. Dan krijgt het apparaataccount pos.manage, en zijn de
--       inloggegevens van een tablet achter de balie genoeg om prijzen te
--       wijzigen.
--
--  Zolang die keuze niet gemaakt is, doet deze migratie het minste van de twee:
--  klokken werkt, en prijzen blijven waar ze zijn.
-- ---------------------------------------------------------------------------

-- ===========================================================================
--  Een verwijdering moet zichzelf melden
--
--  Wat er gebeurde
--  ---------------
--
--  Op een werkplek stonden twee meldingen eeuwig in de wachtrij:
--
--    notifications  nt_sg_6fef2842...  111 pogingen
--    notifications  nt_sg_c2606e6b...  111 pogingen
--    "new row violates row-level security policy for table notifications"
--
--  Die twee waren gemaakt door de edge function kassa-koppelen bij een
--  aanmelding van een kassa, en door diezelfde functie weer weggehaald zodra
--  de kassa gekoppeld was (kassa-koppelen/index.ts, regel 425):
--
--    await admin.from('notifications').delete().eq('id', `nt_sg_${...}`)
--
--  Op de server klopte dat. Alleen: het ophalen vraagt om alles wat sinds de
--  vorige keer is veranderd, en een rij die er niet meer is verandert nooit
--  meer. De werkplek hield dus twee meldingen die nergens anders bestonden.
--
--  Daarna ging het pas mis. Zodra iemand ze als gelezen aanvinkte, ging er een
--  wijziging de wachtrij in. PostgREST maakt van een wijziging op een
--  verdwenen rij een nieuwe rij, en dan geldt de insert-regel:
--
--    bericht_bestaat(id) or (from_user_id = my_id() and ...)
--
--  Het origineel bestond niet meer, dus die eerste helft was onwaar. En de
--  afzender was de edge function en niet degene die zat te klikken, dus de
--  tweede ook. Terecht geweigerd -- en daarmee een regel die nooit meer weg
--  zou gaan.
--
--  De oorzaak, en waar hij zit
--  ---------------------------
--
--  0032 heeft hiervoor de verwijderlijst gemaakt: schrijf bij een verwijdering
--  op wélke rij van wélke tabel weg is, dan kan het ophalen dat doorgeven. Die
--  lijst werd alleen met de hand gevuld, op de plekken waar toen aan gedacht
--  is -- bij het wissen van een medewerker. Elke andere verwijdering, waar dan
--  ook vandaan, bleef stil.
--
--  Dus niet kassa-koppelen aanpassen. Dat repareert dit ene geval en laat de
--  volgende open. Een trigger op de tabel vangt élke verwijdering: uit een
--  edge function, uit de SQL-editor, uit een andere app, of uit een migratie.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De trigger
--
--  security definer, want wie de rij mag verwijderen hoeft daarmee nog geen
--  schrijfrecht op de verwijderlijst te hebben. Zonder dat zou een verwijdering
--  die wél is toegestaan alsnog stukbreken op het opschrijven ervan.
--
--  Hij mag nooit de verwijdering zelf tegenhouden. Vandaar de exception-vanger:
--  een rij die niet in de lijst komt is vervelend, een rij die niet weg kan is
--  erger.
-- ---------------------------------------------------------------------------

create or replace function public.meld_verwijdering()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.deletion_log (id, soort, tabel, record_id, naam, reden)
    values (
      'dl_' || replace(gen_random_uuid()::text, '-', ''),
      tg_table_name,
      tg_table_name,
      old.id,
      -- Een naam als de tabel er een heeft, anders het id. De lijst wordt ook
      -- door mensen gelezen.
      coalesce(
        case when to_jsonb(old) ? 'name'  then to_jsonb(old)->>'name'
             when to_jsonb(old) ? 'title' then to_jsonb(old)->>'title'
             when to_jsonb(old) ? 'naam'  then to_jsonb(old)->>'naam'
        end,
        old.id),
      'verwijderd');
  exception when others then
    -- Nooit de verwijdering blokkeren om het logboek.
    null;
  end;
  return old;
end;
$$;

comment on function public.meld_verwijdering() is
  'Schrijft elke verwijdering in deletion_log, zodat het ophalen hem kan '
  'doorgeven. Zonder dit houdt elk apparaat een rij die nergens meer bestaat, '
  'en probeert die bij de eerste wijziging terug te schrijven.';

-- ---------------------------------------------------------------------------
--  Waar hij op staat
--
--  De tabellen waar de server rijen weghaalt achter de app om, en waar de app
--  een eigen kopie van bewaart. notifications is de gemeten aanleiding;
--  signups gaat langs dezelfde weg -- kassa-koppelen raakt ze allebei aan.
--
--  Niet op alles gezet. Een trigger op elke tabel klinkt grondig, maar dan
--  loopt de verwijderlijst vol met rijen waar geen apparaat een kopie van
--  heeft, en wordt het ophalen duurder zonder dat iemand er iets aan heeft.
-- ---------------------------------------------------------------------------

drop trigger if exists notifications_verwijderd on public.notifications;
create trigger notifications_verwijderd
  after delete on public.notifications
  for each row execute function public.meld_verwijdering();

drop trigger if exists signups_verwijderd on public.signups;
create trigger signups_verwijderd
  after delete on public.signups
  for each row execute function public.meld_verwijdering();

-- ---------------------------------------------------------------------------
--  De twee die er al stonden
--
--  Ze zijn weggehaald voordat deze trigger bestond, dus staan ze in geen
--  enkele verwijderlijst. Voor de apparaten die ze nog hebben is dat het
--  verschil tussen "gaat vanzelf over" en "blijft eeuwig hangen".
--
--  Alleen die twee met de hand toevoegen zou dit ene geval oplossen. Beter is
--  de hele klasse: elke melding die met nt_sg_ begint hoort bij een
--  kassa-aanmelding en wordt door kassa-koppelen weggehaald zodra de kassa
--  gekoppeld is. Voor elke kassa die al gekoppeld is, staat die melding dus
--  nergens meer -- terwijl een werkplek hem nog kan hebben.
--
--  We weten niet welke ids dat waren; die rijen zijn weg. Maar we weten wel
--  welke aanmeldingen er zijn geweest, en het id was daaruit af te leiden:
--  'nt_sg_' plus het aanmeld-id zonder streepjes.
-- ---------------------------------------------------------------------------

insert into public.deletion_log (id, soort, tabel, record_id, naam, reden)
select
  'dl_sg_' || replace(s.id, '-', ''),
  'notifications',
  'notifications',
  'nt_sg_' || replace(s.id, '-', ''),
  'Aanmelding ' || coalesce(s.name, s.id),
  'de kassa is gekoppeld; de melding is toen weggehaald'
from public.signups s
where not exists (
        select 1 from public.notifications n
         where n.id = 'nt_sg_' || replace(s.id, '-', ''))
  and not exists (
        select 1 from public.deletion_log d
         where d.tabel = 'notifications'
           and d.record_id = 'nt_sg_' || replace(s.id, '-', ''))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  En de twee die niemand meer kan afleiden
--
--  De regel hierboven leidt het meldings-id af uit de aanmelding. Dat werkt
--  alleen zolang die aanmelding er nog staat -- en bij deze twee is ook die
--  weg. Ze zijn afgelezen van een werkplek waar ze vastzaten:
--
--    notifications  nt_sg_6fef28421615442aa565a91e03cdc657  111 pogingen
--    notifications  nt_sg_c2606e6bf5b54f1380dce4748bcb90a6  111 pogingen
--
--  Twee ids met de hand in een migratie is lelijk, en dat is het eerlijke
--  woord ervoor. Het alternatief is een werkplek die blijft klagen over twee
--  meldingen die nergens meer bestaan, en dat is erger. Voor elk apparaat dat
--  ze niet heeft is dit een regel die niets doet.
-- ---------------------------------------------------------------------------

insert into public.deletion_log (id, soort, tabel, record_id, naam, reden)
values
  ('dl_nt_6fef28421615442aa565a91e03cdc657', 'notifications', 'notifications',
   'nt_sg_6fef28421615442aa565a91e03cdc657', 'Aanmelding van een kassa',
   'weggehaald bij het koppelen, voordat verwijderingen werden gemeld'),
  ('dl_nt_c2606e6bf5b54f1380dce4748bcb90a6', 'notifications', 'notifications',
   'nt_sg_c2606e6bf5b54f1380dce4748bcb90a6', 'Aanmelding van een kassa',
   'weggehaald bij het koppelen, voordat verwijderingen werden gemeld')
on conflict (id) do nothing;

-- ===========================================================================
--  Verdwaalde regeleindes in de vestigingsteksten
--
--  Bij het naderhand vergelijken van de site met de nulmeting bleken vier van
--  de vijfenveertig pagina's te verschillen. De inhoud was gelijk; het enige
--  verschil was een onzichtbaar teken:
--
--    ...naast de Q8.^M
--
--  Dat is een carriage return (chr(13)), het regeleindeteken van Windows. Hij
--  staat in de tekst zelf, niet aan het eind van de regel in het bestand.
--
--  Waar hij vandaan komt
--  ---------------------
--
--  De achttien vestigingen zijn met 0035 ingevoerd uit site.json. Die migratie
--  is op een Windows-machine geschreven, en git zet .sql-bestanden daar om naar
--  CRLF -- de waarschuwing "LF will be replaced by CRLF" kwam bij elke commit
--  langs. In een tekst die over meerdere regels is samengesteld belandt dat
--  teken binnen de waarde in plaats van erbuiten.
--
--  Gemeten: 1 intro en 2 bereikbaar-teksten, van de achttien.
--
--  Waarom het opruimen hoort
--  -------------------------
--
--  Het valt niemand op. Het is geen zichtbaar teken, de pagina ziet er goed
--  uit, en HTML vouwt witruimte toch samen. Maar zolang het er staat is elke
--  vergelijking tussen de site en de database vals: er verschijnen verschillen
--  die geen verschillen zijn, en dan leer je die vergelijking negeren -- en
--  precies dan glipt er een keer een echt verschil doorheen.
--
--  Ook de andere kant is nu afgedekt: bouw/omzet.cjs in het siteproject haalt
--  regeleindes eruit voordat er HTML van wordt gemaakt. Dit repareert wat er
--  staat, dat voorkomt dat het langs een andere weg terugkomt.
--
--  Opnieuw draaien mag; de tweede keer valt er niets meer op te ruimen.
-- ===========================================================================

update public.locations
   set intro      = nullif(replace(coalesce(intro, ''),      chr(13), ''), ''),
       bereikbaar = nullif(replace(coalesce(bereikbaar, ''), chr(13), ''), ''),
       bijzonder  = nullif(replace(coalesce(bijzonder, ''),  chr(13), ''), ''),
       punten     = (
         select coalesce(array_agg(replace(p, chr(13), '') order by nr), '{}')
           from unnest(punten) with ordinality as t(p, nr)
       ),
       updated_at = public.now_ms()
 where intro      like '%' || chr(13) || '%'
    or bereikbaar like '%' || chr(13) || '%'
    or bijzonder  like '%' || chr(13) || '%'
    or exists (select 1 from unnest(punten) p where p like '%' || chr(13) || '%');

-- ===========================================================================
--  Bijwerken is nog steeds geen aanmaken -- nu op alle tabellen
--
--  "De database weigert dit voor X: new row violates row-level security
--  policy" is in dit project inmiddels vijf keer gemeld, elke keer op een
--  andere tabel: log_events, tickets, notifications, en nu channels. Steeds
--  dezelfde oorzaak, steeds één tabel tegelijk gerepareerd. Dat is vier keer
--  het symptoom behandelen.
--
--  Wat er aan de hand is
--  ---------------------
--
--  De app stuurt wijzigingen als een upsert: "zet deze rij neer, en bestaat
--  hij al, werk hem dan bij". PostgREST beoordeelt zo'n verzoek altijd óók
--  tegen de insert-regel -- ook als het feitelijk een bijwerking is.
--
--  Het gevolg: je mag een rij wijzigen, je mag hem niet aanmaken, en dus
--  wordt je wijziging geweigerd. De foutmelding zegt "new row", terwijl er
--  geen nieuwe rij is.
--
--  In de praktijk gebeurt dat zo. Iemand haalt een overlegkanaal op, leest het
--  laatste bericht, en de app schrijft terug wanneer hij het gelezen heeft. Op
--  dat moment is hij geen beheerder van dat kanaal -- hij hoeft het ook niet
--  aan te maken, het bestaat al -- maar de insert-regel kijkt daar niet naar.
--
--  De oplossing die er al was
--  --------------------------
--
--  0031 heeft daarvoor rij_bestaat() gemaakt: bestaat de rij al, dan mag het
--  verzoek door, en beslist de update-regel wat er werkelijk gewijzigd mag
--  worden. Dat geeft dus niets weg -- wie niets mag wijzigen, wijzigt nog
--  steeds niets. Het haalt alleen de verkeerde vraag weg.
--
--  Die reparatie is toen op zes tabellen gezet. Gemeten vandaag: dertien
--  tabellen hebben hem nog steeds niet.
--
--    dev_plans   documents   faults   mailbox   profiles   signups
--    stock_movements   time_entries   wash_jobs
--    pos_safe_moves   pos_sales   pos_subscriptions   pos_subscription_uses
--
--  Hier krijgen ze hem alle dertien. De oorspronkelijke regel blijft er
--  woordelijk in staan -- er komt alleen een uitweg vóór, voor het geval de
--  rij er al is.
--
--  log_events staat er niet bij: die laat invoegen al onvoorwaardelijk toe.
--
--  Over de pos_-tabellen
--  ---------------------
--
--  Die horen bij de kassa. Dit raakt geen enkele regel over wie wat mag: de
--  toegevoegde tak staat alleen toe wat de update-regel van diezelfde tabel al
--  toestond. Ze staan er wel bij, want een klasse half repareren is precies
--  hoe dit vier keer eerder is teruggekomen.
--
--  Vanaf nu bewaakt scripts/sqltest.mjs dit: komt er een tabel bij zonder de
--  uitweg, dan valt de bouw om in plaats van dat iemand er over een half jaar
--  tegenaan loopt.
--
--  Opnieuw draaien mag.
-- ===========================================================================

drop policy if exists dev_plans_insert on public.dev_plans;
create policy dev_plans_insert on public.dev_plans for insert to authenticated
  with check (
    public.rij_bestaat('public.dev_plans'::regclass, id::text)
    or (public.mag_plannen())
  );

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (
    public.rij_bestaat('public.documents'::regclass, id::text)
    or (public.is_management())
  );

drop policy if exists faults_insert on public.faults;
create policy faults_insert on public.faults for insert to authenticated
  with check (
    public.rij_bestaat('public.faults'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists mailbox_insert on public.mailbox;
create policy mailbox_insert on public.mailbox for insert to authenticated
  with check (
    public.rij_bestaat('public.mailbox'::regclass, id::text)
    or (public.is_management() or public.is_developer())
  );

drop policy if exists pos_safe_moves_insert on public.pos_safe_moves;
create policy pos_safe_moves_insert on public.pos_safe_moves for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_safe_moves'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists pos_sales_insert on public.pos_sales;
create policy pos_sales_insert on public.pos_sales for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_sales'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists pos_subscription_uses_insert on public.pos_subscription_uses;
create policy pos_subscription_uses_insert on public.pos_subscription_uses for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_subscription_uses'::regclass, id::text)
    or (public.is_staff())
  );

drop policy if exists pos_subscriptions_insert on public.pos_subscriptions;
create policy pos_subscriptions_insert on public.pos_subscriptions for insert to authenticated
  with check (
    public.rij_bestaat('public.pos_subscriptions'::regclass, id::text)
    or (public.is_staff() and public.in_my_locations(location_id))
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (
    public.rij_bestaat('public.profiles'::regclass, id::text)
    or (public.is_management())
  );

drop policy if exists signups_insert on public.signups;
create policy signups_insert on public.signups for insert to authenticated
  with check (
    public.rij_bestaat('public.signups'::regclass, id::text)
    or (public.is_management())
  );

drop policy if exists stock_insert on public.stock_movements;
create policy stock_insert on public.stock_movements for insert to authenticated
  with check (
    public.rij_bestaat('public.stock_movements'::regclass, id::text)
    or (public.is_staff())
  );

drop policy if exists time_insert on public.time_entries;
create policy time_insert on public.time_entries for insert to authenticated
  with check (
    public.rij_bestaat('public.time_entries'::regclass, id::text)
    or (public.is_management() or public.heeft_recht('hours.clock'))
  );

drop policy if exists wash_jobs_insert on public.wash_jobs;
create policy wash_jobs_insert on public.wash_jobs for insert to authenticated
  with check (
    public.rij_bestaat('public.wash_jobs'::regclass, id::text)
    or (public.is_staff() or company_id = public.my_company())
  );

-- ===========================================================================
--  Trucky praat met bezoekers
--
--  Een chatbot op de website, met Claude erachter. Deze tabel bestaat om één
--  reden: de kosten begrenzen.
--
--  Waarom dat hier moet en niet in de browser
--  ------------------------------------------
--
--  Het adres van de chatfunctie staat open -- dat moet ook, anders kan een
--  bezoeker zonder inlog er niet bij. Alles wat de browser meestuurt is dus
--  door diezelfde bezoeker te veranderen: het gespreks-id, het aantal vragen
--  dat hij al gesteld heeft, alles. Een teller in JavaScript houdt niemand
--  tegen die de ontwikkelaarsconsole weet te vinden.
--
--  De teller staat daarom hier, en de functie leest en schrijft hem met de
--  servicesleutel. Wat er in de browser gebeurt is dan hoogstens een
--  vriendelijke waarschuwing vooraf.
--
--  Drie grenzen, en waarom drie
--  ----------------------------
--
--    per gesprek    een bezoeker die doorvraagt is prima; een bezoeker die
--                   honderd keer doorvraagt is geen bezoeker meer.
--    per dag        beschermt tegen het geval dat iemand tienduizend
--                   gesprekken begint. Zonder deze grens is de eerste twee
--                   waardeloos: nieuwe gesprekken zijn gratis te maken.
--    tokens per dag de echte rekening. Vragen tellen zegt weinig -- iemand
--                   die een lap tekst plakt kost meer dan honderd korte
--                   vragen.
--
--  De grenzen zelf staan in de functie en niet hier, zodat bijstellen geen
--  migratie kost.
-- ===========================================================================

create table if not exists public.trucky_gesprekken (
  id              text primary key,
  begonnen_at     bigint not null default public.now_ms(),
  laatst_at       bigint not null default public.now_ms(),
  aantal_vragen   integer not null default 0,
  invoer_tokens   integer not null default 0,
  uitvoer_tokens  integer not null default 0,
  /* Alleen gevuld als de bezoeker om een verslag heeft gevraagd. Zolang dat
     niet gebeurt weten we niet wie er heeft zitten typen, en dat hoort ook zo:
     een chauffeur die vraagt hoe laat Venlo opengaat laat geen adres achter. */
  email           text,
  verslag_at      bigint,
  updated_at      bigint not null default public.now_ms()
);

comment on table public.trucky_gesprekken is
  'Eén rij per chatgesprek op de website. Bestaat om de kosten te begrenzen: '
  'de tellers moeten op de server staan, want het chatadres is openbaar en '
  'alles wat de browser meestuurt is door de bezoeker te veranderen.';

create index if not exists trucky_gesprekken_dag_idx
  on public.trucky_gesprekken (begonnen_at);

-- ---------------------------------------------------------------------------
--  Niemand mag hierbij
--
--  Ook niet wie is ingelogd. Hier staan vragen van bezoekers in, en die zijn
--  van niemand in de organisatie. De functie leest en schrijft met de
--  servicesleutel; die gaat langs de regels heen en heeft er dus geen nodig.
--
--  Row level security AAN met nul regels betekent: dicht voor iedereen.
-- ---------------------------------------------------------------------------

alter table public.trucky_gesprekken enable row level security;
alter table public.trucky_gesprekken force row level security;

revoke all on public.trucky_gesprekken from anon, authenticated;

-- ---------------------------------------------------------------------------
--  Wat er vandaag al is verstookt
--
--  Eén vraag in plaats van drie, en de functie hoeft niet te weten hoe de
--  tabel eruitziet. security definer omdat de tabel voor iedereen dicht staat.
-- ---------------------------------------------------------------------------

create or replace function public.trucky_verbruik_vandaag()
returns table (gesprekken integer, tokens integer)
language sql stable security definer set search_path = public as $$
  select
    count(*)::integer,
    coalesce(sum(invoer_tokens + uitvoer_tokens), 0)::integer
  from public.trucky_gesprekken
  where begonnen_at > (extract(epoch from now()) * 1000)::bigint - 86400000;
$$;

/*
 * Rechten. Zie 0033 en 0034: Postgres geeft het uitvoerrecht op een nieuwe
 * functie aan PUBLIC, en Supabase geeft er anon en authenticated bovenop. Bij
 * een security definer-functie is dat een open deur, dus allebei eraf.
 */
revoke execute on function public.trucky_verbruik_vandaag() from public, anon, authenticated;
grant  execute on function public.trucky_verbruik_vandaag() to service_role;

-- ===========================================================================
--  Trucky kent de antwoorden zelf
--
--  Tot nu toe ging elke vraag naar het model. Dat is duur voor vragen die
--  iedereen stelt -- "hoe laat zijn jullie open", "kan ik zonder afspraak
--  terecht", "wat kost een buitenwas" -- en het antwoord kan per keer nét
--  anders uitvallen, terwijl je bij zulke vragen juist wilt dat er altijd
--  hetzelfde staat.
--
--  Vanaf hier staan de vragen en antwoorden in de database. De volgorde is:
--
--    1. zoeken in deze tabel. Gevonden? Dan dat antwoord, woordelijk, gratis.
--    2. niets gevonden? Dan het model -- maar met de dichtstbijzijnde
--       antwoorden erbij, zodat het niet gaat verzinnen wat hier al staat.
--    3. mag of kan het model het niet? Dan een contactformulier.
--
--  Zoeken dat tegen een typefout kan
--  ---------------------------------
--
--  Een chauffeur op een telefoon in een wasstraat typt "opeingstijden". Zoeken
--  op exacte woorden vindt dan niets, en dan gaat er een dure vraag naar het
--  model voor iets wat hier gewoon staat.
--
--  Vandaar twee manieren naast elkaar, en de beste van de twee telt:
--
--    woorden      Postgres' eigen tekstzoeken in het Nederlands. Vangt
--                 verbuigingen: "openingstijd" vindt "openingstijden".
--    letters      trigram-gelijkenis. Vangt tikfouten: "opeingstijden" lijkt
--                 voor 80% op "openingstijden", ook al is geen woord gelijk.
--
--  Alleen woorden is te streng, alleen letters is te dom -- die vindt
--  "wasstraat" ook in "waspoeder".
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De twee uitbreidingen, en waarom er een terugval onder staat
--
--  pg_trgm en unaccent zitten in Supabase. In de testdatabase (PGlite, waar
--  scripts/sqltest.mjs op draait) niet -- die kent geen uitbreidingen. Zonder
--  terugval kan dit bestand daar niet eens laden, en dan is er van deze hele
--  migratie niets te controleren.
--
--  De terugval hieronder wordt daarom alleen aangemaakt als de echte functie
--  ontbreekt. Op Supabase gebeurt dat nooit. Het is een stut voor de test, en
--  hij zegt dat ook van zichzelf.
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_trgm;
exception when others then
  raise notice 'pg_trgm niet beschikbaar -- terugval wordt gebruikt';
end $$;

do $$
begin
  create extension if not exists unaccent;
exception when others then
  raise notice 'unaccent niet beschikbaar -- terugval wordt gebruikt';
end $$;

do $$
begin
  if to_regprocedure('unaccent(text)') is null then
    execute $f$
      create function public.unaccent(t text) returns text
      language sql immutable as 'select t';
    $f$;
  end if;

  if to_regprocedure('similarity(text,text)') is null then
    /*
     * Grove vervanger: hoeveel van de woorden komen in allebei voor. Vangt
     * geen tikfouten -- dat is nou juist wat trigrammen wél doen -- maar is
     * genoeg om de rest van dit bestand te laten laden en te controleren.
     * Draait alleen waar pg_trgm ontbreekt, dus nooit op Supabase.
     */
    execute $f$
      create function public.similarity(a text, b text) returns real
      language sql immutable as $s$
        select case
          when coalesce(a,'') = '' or coalesce(b,'') = '' then 0::real
          else (
            select count(*)::real / greatest(1, array_length(
              string_to_array(lower(b), ' '), 1))
              from unnest(string_to_array(lower(a), ' ')) w
             where w <> '' and lower(b) like '%' || w || '%'
          )::real
        end;
      $s$;
    $f$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  De vragen en antwoorden
-- ---------------------------------------------------------------------------

create table if not exists public.trucky_vragen (
  id          text primary key,
  vraag       text not null,
  antwoord    text not null,
  /* Andere manieren waarop mensen ernaar vragen. "wanneer open", "hoe laat",
     "openingstijden" horen bij dezelfde vraag, en dit is goedkoper dan er drie
     rijen van maken die je alle drie moet bijwerken. */
  trefwoorden text[] not null default '{}',
  /* Waar de bezoeker verder kan lezen. Wordt een knop onder het antwoord. */
  pagina      text,
  actief      boolean not null default true,
  /* Hoe vaak dit antwoord is gegeven zonder dat het model eraan te pas kwam.
     Zegt welke vragen echt leven -- en dus welke het waard zijn om scherp te
     houden. */
  gebruikt    integer not null default 0,
  updated_at  bigint not null default public.now_ms()
);

comment on table public.trucky_vragen is
  'Vaste vragen en antwoorden voor de chatbot op de website. Wordt eerst '
  'doorzocht; pas als er niets past komt het model eraan te pas.';

/*
 * De index hoort bij pg_trgm en kan er dus alleen zijn waar die uitbreiding is.
 * Bij een handvol vragen maakt hij nog niets uit; hij staat er voor als de
 * lijst groeit.
 */
do $$
begin
  create index if not exists trucky_vragen_vraag_trgm
    on public.trucky_vragen using gin (vraag gin_trgm_ops);
exception when others then
  raise notice 'trigram-index overgeslagen -- pg_trgm ontbreekt';
end $$;

-- ---------------------------------------------------------------------------
--  Wat een bezoeker achterlaat als niemand het kon beantwoorden
--
--  Hier staan naam, adres en telefoonnummer van mensen buiten het bedrijf in.
--  Dat is de reden dat deze tabel strenger dicht zit dan de vragenlijst.
-- ---------------------------------------------------------------------------

create table if not exists public.trucky_contact (
  id            text primary key,
  naam          text not null,
  email         text not null,
  telefoon      text,
  bedrijf       text,
  vraag         text not null,
  /* Het gesprek waar dit uit voortkwam, zodat je ziet wat eraan voorafging. */
  gesprek       text,
  /* Wat er in de chat is gezegd. Zonder dat is de vraag vaak niet te plaatsen:
     "ja graag, om 9 uur" zegt weinig zonder de vraag ervoor. */
  verloop       text,
  status        text not null default 'nieuw'
                check (status in ('nieuw', 'opgepakt', 'beantwoord')),
  antwoord      text,
  behandeld_door      text,
  behandeld_door_naam text,
  behandeld_at  bigint,
  created_at    bigint not null default public.now_ms(),
  updated_at    bigint not null default public.now_ms()
);

comment on table public.trucky_contact is
  'Vragen die de chatbot niet kon of mocht beantwoorden. Komen in het '
  'dashboard bij administratie en management terecht.';

create index if not exists trucky_contact_status_idx
  on public.trucky_contact (status, created_at desc);

-- ---------------------------------------------------------------------------
--  Instellingen die het management zelf zet
--
--  Begonnen om één reden -- naar welk adres een contactverzoek gaat -- maar
--  bewust als lijst en niet als losse kolom ergens. Er komt altijd een tweede.
-- ---------------------------------------------------------------------------

create table if not exists public.instellingen (
  /* id én sleutel: de synchronisatie van de app gaat overal uit van een kolom
     id, en daar een uitzondering voor maken kost meer dan deze kolom. sleutel
     is wat je in de code opzoekt en blijft uniek. */
  id          text primary key,
  sleutel     text not null unique,
  waarde      text not null default '',
  omschrijving text not null default '',
  updated_at  bigint not null default public.now_ms()
);

insert into public.instellingen (id, sleutel, waarde, omschrijving)
values (
  'in_contact_mail',
  'contact_mail',
  'casper@truckwash1group.nl',
  'Naar welk adres een contactverzoek van de website gaat. Meerdere adressen '
  'mag, gescheiden door een komma.'
)
on conflict (sleutel) do nothing;

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  De vragenlijst: iedereen die hier werkt mag hem lezen -- hij staat toch op
--  de website. Wijzigen is management, want dit is wat het bedrijf naar buiten
--  zegt.
--
--  De contactverzoeken: administratie en management. Daar staan gegevens van
--  buitenstaanders in, en dat hoeft de wasstraat niet te zien.
--
--  Overal de uitweg voor de upsert-val erbij; zie 0040 voor waarom.
-- ---------------------------------------------------------------------------

alter table public.trucky_vragen  enable row level security;
alter table public.trucky_contact enable row level security;
alter table public.instellingen   enable row level security;

drop policy if exists trucky_vragen_select on public.trucky_vragen;
create policy trucky_vragen_select on public.trucky_vragen for select to authenticated
  using (public.is_staff() or 'technician' = any(public.my_roles())
         or 'developer' = any(public.my_roles()));

drop policy if exists trucky_vragen_insert on public.trucky_vragen;
create policy trucky_vragen_insert on public.trucky_vragen for insert to authenticated
  with check (public.rij_bestaat('public.trucky_vragen'::regclass, id) or public.is_management());

drop policy if exists trucky_vragen_update on public.trucky_vragen;
create policy trucky_vragen_update on public.trucky_vragen for update to authenticated
  using (public.is_management()) with check (public.is_management());

drop policy if exists trucky_vragen_delete on public.trucky_vragen;
create policy trucky_vragen_delete on public.trucky_vragen for delete to authenticated
  using (public.is_management());

/* Administratie of management. heeft_recht() kijkt naar de losse rechten op
   het dossier; is_management() vangt de rol af. */
drop policy if exists trucky_contact_select on public.trucky_contact;
create policy trucky_contact_select on public.trucky_contact for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists trucky_contact_insert on public.trucky_contact;
create policy trucky_contact_insert on public.trucky_contact for insert to authenticated
  with check (public.rij_bestaat('public.trucky_contact'::regclass, id)
              or public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists trucky_contact_update on public.trucky_contact;
create policy trucky_contact_update on public.trucky_contact for update to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'))
  with check (public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists instellingen_select on public.instellingen;
create policy instellingen_select on public.instellingen for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists instellingen_insert on public.instellingen;
create policy instellingen_insert on public.instellingen for insert to authenticated
  with check (public.rij_bestaat('public.instellingen'::regclass, id)
              or public.is_management());

drop policy if exists instellingen_update on public.instellingen;
create policy instellingen_update on public.instellingen for update to authenticated
  using (public.is_management()) with check (public.is_management());

-- ---------------------------------------------------------------------------
--  Zoeken
--
--  Geeft de beste treffers terug met een cijfer tussen 0 en 1. De functie
--  bepaalt niet wat "goed genoeg" is -- dat staat in de edge function, zodat
--  bijstellen geen migratie kost.
-- ---------------------------------------------------------------------------

create or replace function public.trucky_zoek(vraag_in text, hoeveel integer default 3)
returns table (id text, vraag text, antwoord text, pagina text, score real)
language sql stable security definer set search_path = public as $$
  with schoon as (
    select lower(unaccent(coalesce(vraag_in, ''))) as q
  )
  select
    v.id, v.vraag, v.antwoord, v.pagina,
    greatest(
      -- op letters: vangt tikfouten
      similarity(s.q, lower(unaccent(v.vraag))),
      -- op letters, tegen de trefwoorden
      coalesce((
        select max(similarity(s.q, lower(unaccent(t))))
          from unnest(v.trefwoorden) t
      ), 0),
      -- op woorden: vangt verbuigingen. ts_rank geeft kleine getallen, dus
      -- opgetrokken naar dezelfde schaal als de rest.
      least(1.0, ts_rank(
        to_tsvector('dutch',
          v.vraag || ' ' || coalesce(array_to_string(v.trefwoorden, ' '), '')),
        plainto_tsquery('dutch', s.q)
      ) * 8)
    )::real as score
  from public.trucky_vragen v, schoon s
  where v.actief
    and length(s.q) > 2
  order by score desc
  limit greatest(1, least(hoeveel, 10));
$$;

/* Zie 0033/0034: nieuwe functies krijgen anon er gratis bij. Dit is een
   security definer-functie, dus die deur gaat dicht. De edge function draait
   met de servicesleutel. */
revoke execute on function public.trucky_zoek(text, integer) from public, anon, authenticated;
grant  execute on function public.trucky_zoek(text, integer) to service_role;

/*
 * De teller ophogen.
 *
 * Een eigen functie omdat PostgREST geen "gebruikt = gebruikt + 1" kent -- via
 * de REST-laag zou het lezen-en-terugschrijven worden, en dan telt bij twee
 * bezoekers tegelijk één van de twee niet mee.
 */
create or replace function public.trucky_vraag_gebruikt(vraag_id text)
returns void
language sql security definer set search_path = public as $$
  update public.trucky_vragen
     set gebruikt = gebruikt + 1, updated_at = public.now_ms()
   where id = vraag_id;
$$;

revoke execute on function public.trucky_vraag_gebruikt(text) from public, anon, authenticated;
grant  execute on function public.trucky_vraag_gebruikt(text) to service_role;

-- ---------------------------------------------------------------------------
--  Een startlijst
--
--  Twaalf vragen die op elke wasstraat langskomen. Bedoeld om meteen iets te
--  hebben; het management kan ze in de app wijzigen en aanvullen.
--
--  De antwoorden zijn met opzet kort en zonder cijfers die verouderen -- voor
--  prijzen en tijden verwijzen ze naar de pagina waar het echte getal staat.
-- ---------------------------------------------------------------------------

insert into public.trucky_vragen (id, vraag, antwoord, trefwoorden, pagina) values
  ('tv_afspraak', 'Moet ik een afspraak maken?',
   'Nee, je kunt zonder afspraak langskomen bij al onze vestigingen. Even bellen mag natuurlijk altijd als je zeker wilt weten dat het rustig is.',
   array['afspraak','reserveren','zonder afspraak','moet ik bellen'], '/locaties/'),

  ('tv_open', 'Hoe laat zijn jullie open?',
   'Dat verschilt per vestiging. Op de locatiepagina staan de openingstijden van elke vestiging, en je kunt daar ook op postcode zoeken welke het dichtst bij je is.',
   array['openingstijden','hoe laat open','wanneer open','tijden','geopend'], '/locaties/'),

  ('tv_prijs', 'Wat kost een wasbeurt?',
   'Alle tarieven staan op de prijzenpagina, inclusief de toeslagen. De prijzen zijn exclusief 21% btw.',
   array['prijs','kosten','tarief','wat kost','hoeveel kost'], '/prijzen/'),

  ('tv_waar', 'Waar zitten jullie?',
   'We hebben achttien vestigingen door heel Nederland. Op de locatiepagina vind je ze allemaal op de kaart, en kun je op postcode zoeken welke het dichtst bij je is.',
   array['vestigingen','locaties','waar zitten jullie','adres','dichtstbijzijnde'], '/locaties/'),

  ('tv_betalen', 'Hoe kan ik betalen?',
   'Pinnen kan bij elke vestiging. Rijd je vaker bij ons binnen, dan is een account op rekening vaak handiger -- bel daarvoor 088 - 0600 100.',
   array['betalen','pinnen','pin','contant','op rekening','factuur'], '/contact/'),

  ('tv_haccp', 'Reinigen jullie ook laadruimtes?',
   'Ja, we reinigen laadruimtes inwendig, HACCP- en NAO-gecertificeerd. Ontsmetten en desinfecteren kan ook.',
   array['haccp','nao','laadruimte','inwendig','ontsmetten','desinfecteren','tank'],
   '/diensten/haccp-certificaat-en-behandeling/'),

  ('tv_alcoa', 'Poetsen jullie ook velgen?',
   'Ja, we doen Alcoa- en Dura Bright-behandelingen en reinigen alle aluminium onderdelen.',
   array['velgen','alcoa','dura bright','aluminium','polijsten'],
   '/diensten/alcoa-velgen-reinigen/'),

  ('tv_camper', 'Wassen jullie ook campers en bussen?',
   'Ja, campers en bussen kunnen bij ons terecht. Kijk even op de dienstenpagina welke vestiging bij jouw voertuig past.',
   array['camper','bus','bussen','touringcar','bestelbus'], '/diensten/'),

  ('tv_vacature', 'Hebben jullie vacatures?',
   'Ja, we zoeken regelmatig mensen. Je hebt er geen diploma voor nodig, wel de wil om te leren. Op de vacaturepagina staan de openstaande functies en kun je meteen solliciteren.',
   array['vacature','werken','baan','solliciteren','werk','personeel gezocht'],
   '/werken-bij/'),

  ('tv_wachttijd', 'Hoe lang duurt een wasbeurt?',
   'Een buitenwas duurt ongeveer een half uur. Bij drukte kan het wat langer zijn; op de meeste vestigingen kun je ondertussen wachten met een kop koffie.',
   array['hoe lang','wachttijd','duur','snel klaar'], '/locaties/'),

  ('tv_truckparking', 'Kan ik bij jullie parkeren of overnachten?',
   'Op een aantal vestigingen is truckparking. Op de dienstenpagina zie je waar dat kan.',
   array['parkeren','truckparking','overnachten','slapen','parking'],
   '/diensten/truckparking/'),

  ('tv_contact', 'Hoe kan ik contact opnemen?',
   'Bel 088 - 0600 100 of mail info@truckwash1group.nl. Elke vestiging heeft ook een eigen nummer; dat staat op de locatiepagina.',
   array['contact','bellen','telefoonnummer','mailen','e-mail'], '/contact/')
on conflict (id) do nothing;

-- ===========================================================================
--  De app en de database waren het oneens over wie een kanaal mag maken
--
--  Gemeld: drieëntwintig overlegkanalen, honderd pogingen elk, allemaal
--  geweigerd met "new row violates row-level security policy for table
--  channels". De kanalen deugden, de regel deugde, en toch kwam er niets door.
--
--  Wat er aan de hand was
--  ----------------------
--
--  Twee plekken beslissen of je een kanaal mag aanmaken, en ze kijken naar
--  verschillende dingen.
--
--    de app         perms.can('chat.manage')  -- een RECHT
--    de database    is_management() or is_supervisor()  -- een ROL
--
--  Zolang die twee samenvallen merkt niemand het. Maar het recht chat.manage
--  is ook los toe te kennen aan iemand zonder die rollen, en dan zegt de app
--  ja en de database nee.
--
--  Het gevolg is erger dan een geweigerde knop. Het overlegscherm zet bij het
--  eerste bezoek de vaste kanalen klaar -- vijf algemene plus een per
--  vestiging. Sinds er achttien vestigingen in staan zijn dat er drieëntwintig
--  in één keer. Allemaal lokaal aangemaakt, allemaal de wachtrij in, en
--  allemaal voor altijd geweigerd.
--
--  Nagemeten in de testdatabase, met dezelfde regels en dezelfde rijen:
--
--    management     mag
--    leidinggevende mag
--    medewerker     new row violates row-level security policy
--
--  Woordelijk de melding uit productie.
--
--  Wat hier verandert
--  ------------------
--
--  De database gaat naar hetzelfde kijken als de app: het recht. De rollen
--  blijven staan -- management en een leidinggevende hebben chat.manage toch
--  al, dus voor hen verandert er niets, en zonder die takken zou een verkeerd
--  gezette instelling het hele overleg op slot zetten.
--
--  heeft_recht() is precies waarvoor dit soort gevallen bestaat; het wordt in
--  dit schema al gebruikt voor hours.clock en admin.desk.
--
--  Waarom niet andersom -- de app strenger maken
--  ---------------------------------------------
--
--  Dan zou een los toegekend recht in de app zichtbaar zijn en niet werken, en
--  dat is precies het soort stilte waar dit probleem uit voortkwam. Eén plek
--  hoort te beslissen, en dat is de database.
--
--  Opnieuw draaien mag.
-- ===========================================================================

drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check (
    -- De uitweg voor de upsert-val; zie 0031 en 0040.
    public.rij_bestaat('public.channels'::regclass, id)
    or (
      public.is_staff()
      and (
        public.is_management()
        or public.is_supervisor()
        or public.heeft_recht('chat.manage')
        -- Een gesprek mag je aanmaken als je er zelf in zit. Dat is geen
        -- beheer maar iemand aanspreken, en daar is geen recht voor nodig.
        or (kind = 'gesprek' and public.my_id() = any(member_ids))
      )
    )
  );

/*
 * En bijwerken op dezelfde voet.
 *
 * Zou dat achterblijven, dan kun je een kanaal aanmaken en daarna de naam niet
 * meer wijzigen -- en dat is precies het soort halve toestemming waar niemand
 * iets aan heeft.
 */
drop policy if exists channels_update on public.channels;
create policy channels_update on public.channels for update to authenticated
  using (
    public.is_management()
    or public.is_supervisor()
    or public.heeft_recht('chat.manage')
    or (kind = 'gesprek' and public.my_id() = any(member_ids))
  )
  with check (
    public.is_management()
    or public.is_supervisor()
    or public.heeft_recht('chat.manage')
    or (kind = 'gesprek' and public.my_id() = any(member_ids))
  );

-- ===========================================================================
--  Facturen boeken zichzelf
--
--  Wat er nu gebeurt: er komt een factuur binnen per mail, ontvang-mail zet er
--  een kostenpost van met bedrag 0, en daar blijft het. Het uitlezen gebeurt
--  pas als iemand in de app op "laat de factuur voorlezen" drukt. Dat is
--  precies het handwerk dat weg moest.
--
--  Wat hier bijkomt is wat er nodig is om dat automatisch te doen: een
--  grootboek om op te boeken, tags om op te sorteren, en een geheugen dat
--  onthoudt hoe een leverancier de vorige keer is geboekt.
--
--  Het geheugen is het belangrijkste stuk
--  --------------------------------------
--
--  Raden op trefwoorden werkt één keer. Daarna weet je iets beters: hoe die
--  leverancier de vorige keer is geboekt, door een mens die ernaar keek. Dat
--  is een veel sterker signaal dan welk trefwoord ook.
--
--  Dus twee lagen. Kent het geheugen deze leverancier, dan die boeking. Zo
--  niet, dan trefwoorden als eerste gok, duidelijk gemarkeerd als gok. En elke
--  keer dat iemand een kostenpost goedkeurt, leert het geheugen bij.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Het grootboek
--
--  Alleen de rekeningen die hier werkelijk gebruikt worden. Een compleet
--  rekeningschema overtypen levert een lijst op waar niemand doorheen komt.
-- ---------------------------------------------------------------------------

create table if not exists public.grootboek (
  /* De sleutel heet id en niet code, en dat is geen smaakkwestie.
     De synchronisatie in de app vergelijkt elke binnengehaalde rij met wat er
     nog in de wachtrij staat, en doet dat op rij.id -- voor alle tabellen,
     zonder uitzondering. Een tabel met een andere sleutelnaam levert daar
     stilletjes "undefined" op, en dan overschrijft binnenkomende post een
     wijziging die nog niet verstuurd was. Eén afwijkende tabel is die klasse
     fouten niet waard. */
  id          text primary key,
  code        text not null unique,
  naam        text not null,
  /* Waar deze rekening op te herkennen is, als het geheugen nog niets weet. */
  trefwoorden text[] not null default '{}',
  /* Het gebruikelijke btw-percentage. Wat op de factuur staat gaat altijd
     voor -- dit is alleen een vangnet voor een onleesbare bon. */
  btw_pct     integer not null default 21,
  actief      boolean not null default true,
  updated_at  bigint not null default public.now_ms()
);

comment on table public.grootboek is
  'De grootboekrekeningen waarop kosten worden geboekt. Klein gehouden: '
  'alleen wat hier echt gebruikt wordt.';

-- ---------------------------------------------------------------------------
--  De tags
--
--  Losse etiketten om op te filteren, naast de grootboekrekening. Een factuur
--  van Enexis is "elektra" en boekt op energie; die twee zijn niet hetzelfde
--  en het een vervangt het ander niet.
-- ---------------------------------------------------------------------------

create table if not exists public.kosten_tags (
  -- Zelfde reden als bij grootboek hierboven: de sleutel heet id.
  id          text primary key,
  naam        text not null unique,
  trefwoorden text[] not null default '{}',
  actief      boolean not null default true,
  updated_at  bigint not null default public.now_ms()
);

-- ---------------------------------------------------------------------------
--  Het geheugen
--
--  Eén regel per leverancier: zo is hij de vorige keer geboekt. Wordt bij elke
--  goedkeuring bijgewerkt, zodat de tweede factuur van dezelfde partij vanzelf
--  goed staat.
--
--  De sleutel is de leveranciersnaam in kleine letters. Niet het btw-nummer:
--  dat staat lang niet op elke bon, en dan zou het geheugen juist bij de
--  slordige leveranciers niets onthouden.
-- ---------------------------------------------------------------------------

create table if not exists public.leverancier_boeking (
  leverancier    text primary key,
  grootboek_code text references public.grootboek(code) on delete set null,
  tags           text[] not null default '{}',
  /* Hoe vaak het zo is geboekt. Eén keer is een aanwijzing, tien keer is een
     gewoonte -- en dat verschil wil je kunnen zien voordat je erop vertrouwt. */
  keren          integer not null default 1,
  laatst_at      bigint not null default public.now_ms(),
  updated_at     bigint not null default public.now_ms()
);

-- ---------------------------------------------------------------------------
--  Wat er op de kostenpost bijkomt
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists tags           text[] not null default '{}';
alter table public.expenses add column if not exists grootboek_code text;
alter table public.expenses add column if not exists factuurnummer  text;
alter table public.expenses add column if not exists vervaldatum    bigint;
alter table public.expenses add column if not exists btw_bedrag     numeric(12,2);
/* Waar de indeling vandaan komt: uit het geheugen, geraden, of met de hand
   gezet. Zonder dit weet niemand of dat rekeningnummer een gok is. */
alter table public.expenses add column if not exists indeling_bron  text
  check (indeling_bron in ('geheugen', 'geraden', 'handmatig'));

comment on column public.expenses.indeling_bron is
  'Waar grootboek_code en tags vandaan komen. "geraden" betekent: op '
  'trefwoorden gegokt omdat deze leverancier nog niet bekend was -- daar hoort '
  'iemand naar te kijken.';

-- ---------------------------------------------------------------------------
--  Voorstellen
--
--  Geeft terug hoe deze factuur waarschijnlijk geboekt moet worden. Beslist
--  niets: de aanroeper zet het op de kostenpost en een mens keurt goed.
-- ---------------------------------------------------------------------------

create or replace function public.factuur_indelen(
  leverancier_in text,
  omschrijving_in text default ''
)
returns table (grootboek_code text, tags text[], bron text)
language sql stable security definer set search_path = public as $$
  with zoek as (
    select
      lower(trim(coalesce(leverancier_in, ''))) as lev,
      lower(coalesce(leverancier_in, '') || ' ' || coalesce(omschrijving_in, '')) as alles
  ),
  -- 1. Kennen we deze leverancier?
  uit_geheugen as (
    select b.grootboek_code, b.tags, 'geheugen'::text as bron
      from public.leverancier_boeking b, zoek z
     where b.leverancier = z.lev
       and b.grootboek_code is not null
  ),
  -- 2. Zo niet: raden op trefwoorden.
  geraden_rekening as (
    select g.code
      from public.grootboek g, zoek z
     where g.actief
       and exists (select 1 from unnest(g.trefwoorden) t
                    where t <> '' and z.alles like '%' || lower(t) || '%')
     order by g.code
     limit 1
  ),
  geraden_tags as (
    select coalesce(array_agg(k.naam order by k.naam), '{}') as tags
      from public.kosten_tags k, zoek z
     where k.actief
       and exists (select 1 from unnest(k.trefwoorden) t
                    where t <> '' and z.alles like '%' || lower(t) || '%')
  )
  select * from uit_geheugen
  union all
  select (select code from geraden_rekening),
         (select tags from geraden_tags),
         'geraden'
   where not exists (select 1 from uit_geheugen)
  limit 1;
$$;

/*
 * Leren van een goedkeuring.
 *
 * Wordt aangeroepen als iemand een kostenpost akkoord geeft. Vanaf dat moment
 * staat de volgende factuur van diezelfde partij meteen goed.
 */
create or replace function public.boeking_onthouden(
  leverancier_in text,
  grootboek_in text,
  tags_in text[]
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  sleutel text := lower(trim(coalesce(leverancier_in, '')));
begin
  /*
   * Wie hier niets te zoeken heeft, leert het geheugen ook niets.
   *
   * Deze functie is security definer en stond open voor iedere ingelogde
   * gebruiker. Een monteur ziet geen enkele kostenpost, maar kon wel bepalen
   * op welke rekening de facturen van een leverancier voortaan landen -- en
   * dat zou niemand merken, want het is precies wat de functie hoort te doen.
   *
   * Stil weglopen en niet klagen: dit wordt aangeroepen naast een
   * goedkeuring, en die mag niet stuklopen op een recht dat er toch al voor
   * zorgt dat je hier niet komt.
   */
  if not (public.is_management() or public.heeft_recht('admin.desk')) then
    return;
  end if;

  if sleutel = '' or grootboek_in is null then return; end if;

  insert into public.leverancier_boeking
    (leverancier, grootboek_code, tags, keren, laatst_at, updated_at)
  values (sleutel, grootboek_in, coalesce(tags_in, '{}'), 1,
          public.now_ms(), public.now_ms())
  on conflict (leverancier) do update
    set grootboek_code = excluded.grootboek_code,
        tags           = excluded.tags,
        -- Doortellen, niet resetten: het aantal keren is het vertrouwen.
        keren          = public.leverancier_boeking.keren + 1,
        laatst_at      = public.now_ms(),
        updated_at     = public.now_ms();
end;
$$;

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  Het grootboek en de tags mag iedereen die kosten ziet ook lezen -- anders
--  staat er een code op een bon waar niemand de naam bij weet. Wijzigen is
--  administratie of management.
-- ---------------------------------------------------------------------------

alter table public.grootboek           enable row level security;
alter table public.kosten_tags         enable row level security;
alter table public.leverancier_boeking enable row level security;

do $$
declare t text;
begin
  /* leverancier_boeking staat hier niet bij: die tabel heeft geen id-kolom
     en wordt ook nooit rechtstreeks geschreven -- dat gaat via
     boeking_onthouden(). Lezen mag wel, en dat staat hieronder los. */
  foreach t in array array['grootboek', 'kosten_tags'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (public.is_staff())',
      t, t);

    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      /* De sleutelkolom heet id, en dat moet ook: rij_bestaat kijkt hard
         naar "where id = $1". Hier stond per tabel een andere kolom (code,
         naam, leverancier), en dan zoekt hij een rij met id = '4031' terwijl
         die id gb_4031 heet. Die vlucht slaat dan altijd mis, en dan is dit
         weer een tabel die "new row violates row-level security" geeft zodra
         de app een bestaande rij bijwerkt met een upsert. */
      'create policy %I_insert on public.%I for insert to authenticated '
      'with check (public.rij_bestaat(''public.%I''::regclass, id) '
      '            or public.is_management() or public.heeft_recht(''admin.desk''))',
      t, t, t);

    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated '
      'using (public.is_management() or public.heeft_recht(''admin.desk'')) '
      'with check (public.is_management() or public.heeft_recht(''admin.desk''))',
      t, t);
  end loop;
end $$;

revoke execute on function public.factuur_indelen(text, text) from public, anon, authenticated;
grant  execute on function public.factuur_indelen(text, text) to service_role, authenticated;
revoke execute on function public.boeking_onthouden(text, text, text[]) from public, anon;
grant  execute on function public.boeking_onthouden(text, text, text[]) to service_role, authenticated;

-- ---------------------------------------------------------------------------
--  Een begin
--
--  De rekeningen en tags die in de huidige administratie voorkomen. Bedoeld om
--  meteen iets te hebben; aanvullen gaat in de app.
-- ---------------------------------------------------------------------------

insert into public.grootboek (id, code, naam, trefwoorden, btw_pct)
select 'gb_' || v.code, v.code, v.naam, v.trefwoorden, v.btw_pct
from (values
  ('4000', 'Inkoop wasmiddelen en chemie',
   array['wasmiddel','chemie','shampoo','ontvetter','zeep','wairtec','cemex'], 21),
  ('4010', 'Energie',
   array['enexis','eneco','vattenfall','essent','elektra','stroom','gas','energie'], 21),
  ('4015', 'Water en osmose',
   array['water','osmose','vitens','brabant water','evides'], 9),
  ('4020', 'Afval en milieu',
   array['afval','prezero','renewi','container','milieu','suez'], 21),
  ('4025', 'Onderhoud en reparatie',
   array['onderhoud','reparatie','installatie','monteur','service','storing'], 21),
  ('4031', 'Contributies en heffingen',
   array['contributie','lidmaatschap','heffing','mkb','kamer van koophandel','kvk'], 0),
  ('4040', 'Huur en huisvesting',
   array['huur','pacht','huisvesting','erfpacht'], 21),
  ('4050', 'Verzekeringen',
   array['verzekering','polis','assurantie','premie'], 0),
  ('4060', 'Kantoor en administratie',
   array['kantoor','administratie','accountant','boekhoud','tork','papier'], 21),
  ('4070', 'Telefoon en internet',
   array['telefoon','internet','kpn','vodafone','ziggo','t-mobile','odido'], 21),
  ('4080', 'Vervoer en brandstof',
   array['brandstof','diesel','tankpas','shell','bp','total','leasing','lease'], 21),
  ('4090', 'Overige bedrijfskosten', array[]::text[], 21)
) as v(code, naam, trefwoorden, btw_pct)
/* Op id en niet op code. Sinds 0059 is de code niet meer op zichzelf uniek --
   dezelfde rekening bestaat in elke bv -- en dan is er geen sleutel om op te
   botsen. De id is er altijd geweest en is hier ook de natuurlijke: deze
   startlijst is er één, met vaste id's. */
on conflict (id) do nothing;

insert into public.kosten_tags (id, naam, trefwoorden)
select 'tag_' || v.naam, v.naam, v.trefwoorden
from (values
  ('afval',    array['afval','container','prezero','renewi','suez']),
  ('cemex',    array['cemex']),
  ('elektra',  array['elektra','stroom','enexis','eneco','vattenfall','essent']),
  ('enexis',   array['enexis']),
  ('finance',  array['bank','rente','financiering','lease','verzekering']),
  ('gas',      array['gas','aardgas']),
  ('osmose',   array['osmose','waterontharding','omgekeerde osmose']),
  ('prezero',  array['prezero']),
  ('tork',     array['tork']),
  ('wairtec',  array['wairtec'])
) as v(naam, trefwoorden)
on conflict (naam) do nothing;

-- ---------------------------------------------------------------------------
--  Waar facturen binnenkomen
--
--  Per vestiging een eigen adres: inkoop.<vestiging>@<domein>. Dan hoeft
--  niemand achteraf uit te zoeken bij welke vestiging een bon hoort -- dat
--  staat al in het adres waar hij op binnenkwam.
--
--  Het domein is een instelling en geen vaste waarde in de code. Nu is dat het
--  huidige adres; gaat er later een eigen domein komen, dan is dat één regel
--  wijzigen in plaats van een nieuwe versie uitbrengen.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_inkoop_domein', 'inkoop_domein', 'preview.truckwash.cloud',
   'Het domein waarop facturen binnenkomen. Het adres per vestiging wordt '
   'inkoop.<vestiging>@<domein>, bijvoorbeeld inkoop.venlo@preview.truckwash.cloud. '
   'Let op: een nieuw domein moet eerst bij Resend zijn ingesteld voordat er '
   'post op binnenkomt.'),
  ('in_inkoop_voorvoegsel', 'inkoop_voorvoegsel', 'inkoop',
   'Het deel vóór de punt in het factuuradres. Standaard "inkoop", dus '
   'inkoop.venlo@... Wijzig dit alleen als de mailroutering meeverandert.'),
  ('in_factuur_automatisch', 'factuur_automatisch', 'ja',
   'Of een binnengekomen factuur meteen wordt uitgelezen en ingedeeld. Op '
   '"nee" blijft hij staan tot iemand in de app op voorlezen drukt.')
on conflict (id) do nothing;

-- ===========================================================================
--  Een kassa ziet wie er bij hem mag werken
--
--  De kassa gaat afdwingen dat iemand alleen aanmeldt op de vestiging waar hij
--  staat -- wie op Asten staat, mag de kassa van Asten en verder geen enkele.
--  Wie overal mag werken, mag elke kassa.
--
--  Dat tweede deel werkte niet, en niet door de kassa maar door deze regel:
--
--      profiles_select:  auth_id = auth.uid()
--                        or sees_all_locations()
--                        or (is_staff() and in_my_locations(location_id))
--
--  sees_all_locations() gaat over wie kíjkt, niet over wie bekeken wordt. Een
--  kassa in Asten ziet dus: zijn eigen dossier, iedereen op Asten, en iedereen
--  zonder vestiging (want in_my_locations(null) is waar). Iemand van het
--  kantoor die overal mag werken staat op de vestiging van het kantoor -- en
--  die is voor de kassa in Asten onzichtbaar. Zijn nummer staat niet in de
--  cache, dus "dat personeelsnummer is niet bekend op deze vestiging".
--
--  Met één vestiging viel dat niet op. Met achttien wel.
--
--  Waarom dit alleen voor een kassa geldt
--  -------------------------------------
--
--  Een dossier bevat meer dan een naam: telefoonnummer, uurloon, aantekeningen.
--  Zou deze regel voor iedereen gelden, dan zag elke werknemer op elke
--  vestiging het dossier van iedereen die overal mag werken. Dat is een prijs
--  die niemand gevraagd heeft.
--
--  Een apparaataccount is wat anders. Dat is geen mens die rondkijkt maar een
--  kassa die moet weten wie er voor hem staat, en het is nodig voor precies
--  één ding: een nummer of een badge herkennen.
--
--  Wat er niet mee opgelost is
--  ---------------------------
--
--  De kassa haalt hele dossierrijen op en bewaart die in zijn eigen cache. Er
--  staat vanaf nu dus ook het uurloon van het kantoor op een tablet achter de
--  balie. Dat was al zo voor iedereen op die vestiging; dit maakt de kring
--  groter en niet anders. De echte oplossing is dat de kassa een smalle
--  weergave leest met alleen wat hij nodig heeft -- naam, nummer, rollen,
--  vestiging -- en dat is een eigen klus. Zolang die er niet is, hoort dit
--  hardop te staan.
-- ===========================================================================

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    auth_id = auth.uid()
    or public.sees_all_locations()
    or (public.is_staff() and public.in_my_locations(location_id))
    /*
     * En dit is nieuw: een kassa mag zien wie er bij hem mag werken.
     *
     * Twee gevallen, en ze volgen precies de regel die de kassa daarna zelf
     * toetst (magOpKassa in src/lib/code.ts):
     *
     *   all_locations   deze persoon mag overal werken, dus ook hier
     *   manages         hij heeft leiding over de vestiging van deze kassa
     */
    or (
      public.is_apparaataccount(auth.uid())
      and (
        coalesce(all_locations, false)
        or (manages is not null and manages && public.my_locations())
      )
    )
  );

-- ===========================================================================
--  De foto's gaan mee naar de website
--
--  De vestigingspagina op de site toont een vaste stockfoto: dezelfde
--  wasstraat voor Aalsmeer, Venlo en Maasvlakte, met twee uitzonderingen die
--  met de hand in brok.js staan. Terwijl in het beheerscherm per vestiging
--  echte foto's zijn geupload, met een bijschrift en een omslag die vooraan
--  staat. Die kwamen niet verder dan de app.
--
--  Vanaf hier geeft website_vestigingen() ze mee, als een lijst per
--  vestiging. De omslag staat vooraan en daarna komt de volgorde zoals die
--  in het scherm is gesleept -- dat is dezelfde volgorde die de app zelf
--  toont, zodat wat je in het beheerscherm ziet ook is wat de site laat zien.
--
--  Wat er per foto meegaat
--  -----------------------
--
--    pad         het pad in de emmer "vestigingen" (die is openbaar leesbaar,
--                zie 0026); de serverfunctie maakt er de volledige url van
--    bijschrift  wat er in het scherm bij is getikt, of null
--    cover       staat deze vooraan
--    volgorde    het sorteergetal uit het scherm
--
--  En met opzet NIET: wie hem heeft geupload, wanneer, hoe groot het
--  bestand is, welk id de regel heeft. Dat is administratie van binnen en
--  hoort niet op een openbare pagina. scripts/sqltest.mjs bewaakt dat.
--
--  Waarom drop + create: de functie krijgt een kolom erbij, en bij een
--  "returns table" kan dat niet met "create or replace". Dezelfde reden als
--  in 0035, en met dezelfde valkuil: het droppen gooit de rechten weg, dus
--  die staan onderaan opnieuw.
-- ===========================================================================

drop function if exists public.website_vestigingen();

create function public.website_vestigingen()
returns table (
  slug        text,
  naam        text,
  adres       text,
  postcode    text,
  plaats      text,
  telefoon    text,
  email       text,
  lat         double precision,
  lon         double precision,
  wasstraten  integer,
  openingstijden jsonb,
  intro       text,
  bereikbaar  text,
  bijzonder   text,
  diensten    text[],
  punten      text[],
  fotos       jsonb
)
language sql stable security definer set search_path = public as $$
  select
    l.website_slug, l.name, l.address, l.postcode, l.city,
    l.phone, l.email, l.lat, l.lon, l.bays,
    l.opening_hours, l.intro, l.bereikbaar, l.bijzonder, l.diensten, l.punten,
    /*
     * Een lege lijst en geen null: het bouwscript van de site doet
     * fotos.map(...) en moet dat kunnen doen zonder eerst te kijken.
     *
     * De volgorde staat IN de aggregatie. Een "order by" op de buitenste
     * select zou de vestigingen sorteren en de foto's laten staan zoals
     * ze toevallig uit de tabel komen.
     */
    coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'pad',        f.storage_path,
                 'bijschrift', f.caption,
                 'cover',      f.is_cover,
                 'volgorde',   f.sort)
               order by f.is_cover desc, f.sort asc, f.uploaded_at asc)
        from public.location_photos f
       where f.location_id = l.id
    ), '[]'::jsonb)
  from public.locations l
  where l.op_website
    and l.active
    and l.website_slug is not null
  order by l.name;
$$;

/*
 * De rechten opnieuw zetten, precies zoals in 0033.
 *
 * "drop function" gooit ook de rechten weg, en de nieuwe functie krijgt van
 * Supabase weer automatisch anon en authenticated erbij via de standaardregel
 * in het schema. Intrekken bij PUBLIC alleen haalt die eigen rechten er niet
 * af -- daarom staan anon en authenticated er apart bij. Zonder deze regels
 * staat het gat dat in 0033 en 0034 is gedicht meteen weer open, en dan kan
 * een onbekende bezoeker de hele lijst zelf opvragen.
 */
revoke execute on function public.website_vestigingen() from public, anon, authenticated;
grant  execute on function public.website_vestigingen() to service_role;

-- ===========================================================================
--  Een verkoopfactuur is geen kostenpost
--
--  Draai dit ná 0046. Opnieuw draaien mag.
--
--  Wat er misging
--  --------------
--
--  Alles wat met een PDF op een inkoopadres binnenkwam werd een kostenpost.
--  Ook een factuur die Truckwash zélf aan een klant had gestuurd -- een klant
--  die hem terugmailt met een vraag, een collega die hem doorstuurt "voor de
--  administratie". Die stond dan aan de kostenkant, met het eigen btw-nummer
--  als leverancier, en niemand zag het verschil met een echte rekening.
--
--  De lezer kijkt nu wie er bovenaan het stuk staat. Is dat Truckwash, dan
--  haalt de post de zojuist aangemaakte kostenpost weer weg en zet op het
--  bericht dat het een verkoopfactuur is. Daarvoor is deze kolom.
--
--  Bewust geen verkoopadministratie. Alleen herkennen, apart zetten en
--  duidelijk laten zien; wat er verder mee moet is aan de administratie.
-- ===========================================================================

alter table public.mailbox add column if not exists soort text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mailbox_soort_check') then
    alter table public.mailbox
      add constraint mailbox_soort_check
      check (soort is null or soort in ('inkoop','verkoop','overig'));
  end if;
end $$;

comment on column public.mailbox.soort is
  'Wat de post ervan maakte: inkoop (er is een kostenpost van gemaakt), '
  'verkoop (een factuur van Truckwash zelf, geen kostenpost) of overig (geen '
  'bijlage om te lezen). Leeg zolang de lezer er nog niet naar keek of het '
  'niet zeker wist, en bij post van vóór deze migratie.';

-- Het scherm zet de verkoopfacturen bij elkaar; dat hoort niet de hele
-- postbus door te lopen.
create index if not exists mailbox_soort_idx on public.mailbox (soort) where soort is not null;

-- ---------------------------------------------------------------------------
--  De eigen nummers, voor het tweede slot
--
--  De post haalt een kostenpost pas weg als het stuk naast de lezing
--  "verkoop" van het model óók een nummer van Truckwash zelf draagt: KvK,
--  btw-nummer of IBAN. Het model alleen is niet genoeg -- een andere wasserij
--  met "Truckwash" in de naam of een scan met een stempel "ontvangen" leest
--  het soms als verkoop, en een weggehaalde kostenpost komt niet vanzelf
--  terug.
--
--  Bewust leeg aangemaakt. Zolang ze leeg zijn wordt er niets weggehaald en
--  blijft elke factuur een kostenpost, met de twijfel erop. Invullen in het
--  ontwikkelaarsscherm bij de inkoopadressen, of hier met een update.
--  Meerdere nummers mag, met een komma ertussen (één per werkmaatschappij).
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_eigen_kvk', 'eigen_kvk', '',
   'Het KvK-nummer van Truckwash 1 Group (meerdere mag, met een komma). De '
   'post gebruikt het om een doorgestuurde verkoopfactuur van Truckwash zelf '
   'te herkennen; leeg betekent dat er nooit een kostenpost wordt weggehaald.'),
  ('in_eigen_btw', 'eigen_btw', '',
   'Het btw-nummer van Truckwash 1 Group, bijvoorbeeld NL123456789B01 '
   '(meerdere mag, met een komma). Zelfde doel als het KvK-nummer.'),
  ('in_eigen_iban', 'eigen_iban', '',
   'De eigen bankrekening(en) van Truckwash, met een komma ertussen. Zelfde '
   'doel als het KvK-nummer: staat deze op een factuur als rekening om op te '
   'betalen, dan is het een factuur van Truckwash zelf.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  De verwijdering moet zichzelf melden
--
--  Dit is de eerste plek waar de server een kostenpost weghaalt achter de app
--  om. Een apparaat dat de bon net had opgehaald houdt hem anders in zijn
--  lokale kopie staan -- precies het spook uit 0032 en 0038, nu op expenses.
--  Dezelfde trigger als daar, zodat elk apparaat hem bij het volgende ophalen
--  opruimt.
-- ---------------------------------------------------------------------------

drop trigger if exists expenses_verwijderd on public.expenses;
create trigger expenses_verwijderd
  after delete on public.expenses
  for each row execute function public.meld_verwijdering();

-- ===========================================================================
--  Trucksupply ziet de voorraad
--
--  Draai dit ná 0047. Opnieuw draaien mag.
--
--  Waar het om gaat
--  ----------------
--
--  De vestigingen bestellen hun spullen -- shampoo, ontvetter, doeken -- bij
--  één leverancier, Trucksupply. Tot nu toe ging dat zo: iemand op de
--  vestiging ziet dat de ontvetter op is, belt of appt, en hoopt dat het
--  aankomt voordat de laatste fles leeg is. Niemand aan de leverancierskant
--  ziet de standen, dus die kan niets zien aankomen.
--
--  Vanaf nu kijkt Trucksupply mee. Een eigen rol, die op alle vestigingen de
--  voorraad ziet maar verder geen personeel is: geen rooster, geen uren, geen
--  dossiers. Zakt een stand onder het minimum, dan ontstaat er een alarm dat
--  bij de leverancier binnenkomt -- meteen, en 's ochtends nog eens als
--  niemand ernaar keek. Van een alarm wordt een bestelling gemaakt, met een
--  nummer, een pakbon en een verzendstatus.
--
--  Wat hier in de database komt: de rol, de kolommen die een artikel voor de
--  leverancier bruikbaar maken (artikelnummer, foto, inkoopprijs), de
--  alarmen, de bestellingen met hun regels, en een eerste plek voor de
--  koppeling met Exact. De mails en de wekker staan in een Edge Function
--  (supabase/functions/trucksupply) en een GitHub-workflow
--  (.github/workflows/voorraad.yml).
--
--  Twee reparaties die onderweg meekomen
--  -------------------------------------
--
--  a. is_staff() is in 0029 ingekort. Die migratie voegde de administratie
--     toe en schreef de functie opnieuw uit als employee / administratie /
--     management -- en liet daarmee supervisor, technician en developer
--     vallen, die 0006 er eerder in had gezet. Sindsdien ziet een
--     leidinggevende met alléén de rol supervisor het rooster niet meer, en
--     de monteur de storingen niet. Het viel niet op omdat vrijwel iedereen
--     de rol employee ernaast heeft. Hier staan ze alle zes; trucksupply
--     bewust NIET, dat is geen personeel.
--
--  b. notifications.to_role kent een vaste lijst rollen (0007). Een
--     bestelaanvraag van een vestiging is een bericht aan "wie de inkoop
--     doet", en dat is een rol, geen persoon: wie er vandaag bij Trucksupply
--     achter het scherm zit weet de vestiging niet, en hoort dat ook niet te
--     hoeven weten. Dus komt trucksupply in de lijst. to_user_id blijft
--     bestaan voor het geval iemand tóch één persoon wil aanspreken.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De rol
--
--  Twee functies. is_trucksupply() zegt wie je bent; mag_leverancier() zegt
--  wat je mag, en daar valt ook het management onder en iedereen met het
--  losse recht supply.orders -- zodat een medewerker van kantoor kan
--  invallen zonder dat je hem van rol hoeft te laten wisselen.
-- ---------------------------------------------------------------------------

create or replace function public.is_trucksupply()
returns boolean language sql stable as $$
  select 'trucksupply' = any(public.my_roles());
$$;

create or replace function public.mag_leverancier()
returns boolean language sql stable as $$
  select public.is_trucksupply()
      or public.is_management()
      or public.heeft_recht('supply.orders');
$$;

/* Geen security definer, maar wel dezelfde hygiëne als in 0034: anon krijgt
   elke nieuwe functie standaard, en er is geen enkele reden waarom een
   bezoeker zonder inlog zou mogen vragen of hij Trucksupply is. */
revoke execute on function public.is_trucksupply()   from public, anon;
revoke execute on function public.mag_leverancier()  from public, anon;
grant  execute on function public.is_trucksupply()   to authenticated, service_role;
grant  execute on function public.mag_leverancier()  to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  Reparatie a: is_staff() is weer compleet
--
--  Woordelijk de lijst van 0006, plus de administratie uit 0029. Volgorde en
--  vorm als toen, zodat een volgende die hier iets aan toevoegt ziet dat het
--  een lijst is en niet drie losse gevallen.
-- ---------------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean language sql stable as $$
  select 'employee'      = any(public.my_roles())
      or 'supervisor'    = any(public.my_roles())
      or 'technician'    = any(public.my_roles())
      or 'administratie' = any(public.my_roles())
      or 'management'    = any(public.my_roles())
      or 'developer'     = any(public.my_roles());
$$;

-- ---------------------------------------------------------------------------
--  Reparatie b: een melding mag aan de leverancier gericht zijn
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_to_role_allowed;
alter table public.notifications
  add constraint notifications_to_role_allowed
  check (to_role is null or to_role in
    ('employee','supervisor','technician','customer','management','developer',
     'trucksupply'));

-- ---------------------------------------------------------------------------
--  Wat een artikel voor de leverancier nodig heeft
--
--  De voorraadtabel is gemaakt voor de vestiging: naam, stand, minimum. De
--  leverancier heeft meer nodig om er een bestelling van te maken. Alles met
--  add column if not exists, want de tabel staat vol.
-- ---------------------------------------------------------------------------

alter table public.inventory_items add column if not exists sku               text;
alter table public.inventory_items add column if not exists omschrijving      text;
alter table public.inventory_items add column if not exists image             text;
/* Wat er standaard per keer wordt meegestuurd. Een alarm op ontvetter
   betekent niet "stuur één liter" maar "stuur wat er altijd gaat". */
alter table public.inventory_items add column if not exists bestelhoeveelheid numeric not null default 0;
/* Wat Trucksupply ervoor rekent. price_per_unit blijft de interne waarde
   waarmee de vestiging zijn verbruik waardeert; die twee lopen uiteen. */
alter table public.inventory_items add column if not exists inkoopprijs       numeric;
alter table public.inventory_items add column if not exists actief            boolean not null default true;
/* De artikelcode in Exact. Nog nergens voor gebruikt; staat er zodat de
   koppeling straks geen tweede kolomronde nodig heeft. */
alter table public.inventory_items add column if not exists exact_code        text;

/*
 * Dezelfde rem als op pos_products.image (0027), om dezelfde reden: de foto
 * komt mee in elke synchronisatie van elk apparaat. NOT VALID, zodat een
 * bestaande database er niet op struikelt.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'inventory_items_image_maat'
       and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
      add constraint inventory_items_image_maat
      check (image is null or length(image) <= 150000) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  De alarmen
--
--  Eén rij per keer dat een artikel onder zijn minimum zakt, en die rij
--  blijft bestaan tot de stand weer goed is. Het is dus geen momentopname
--  maar een geschiedenis: wanneer het begon, wie ernaar keek, wanneer er
--  over gemaild is en wanneer het over was. Dat laatste is wat je later wilt
--  weten -- "hoe lang zat Venlo zonder ontvetter" is een vraag die alleen te
--  beantwoorden is als je het hebt opgeschreven.
--
--  item_naam en stand staan er dubbel in, met opzet: een alarm van drie weken
--  terug moet nog leesbaar zijn als het artikel inmiddels is hernoemd of weg.
-- ---------------------------------------------------------------------------

create table if not exists public.voorraad_alarmen (
  id                text primary key,
  item_id           text references public.inventory_items(id) on delete cascade,
  item_naam         text not null default '',
  location_id       text,
  stand             numeric not null default 0,
  minimum           numeric not null default 0,
  ontstaan_at       bigint not null default public.now_ms(),
  gezien_at         bigint,
  gezien_door       text,
  gezien_door_naam  text,
  /* De directe mail, binnen een kwartier na het ontstaan. */
  gemaild_at        bigint,
  /* De ochtendmail, voor alles wat niemand gezien heeft. */
  ochtend_gemaild_at bigint,
  opgelost_at       bigint,
  updated_at        bigint not null default public.now_ms()
);

create index if not exists voorraad_alarmen_open_idx
  on public.voorraad_alarmen (item_id) where opgelost_at is null;
create index if not exists voorraad_alarmen_updated_idx
  on public.voorraad_alarmen (updated_at);

comment on table public.voorraad_alarmen is
  'Eén rij per keer dat een artikel onder zijn minimum zakte. Wordt door een '
  'trigger op inventory_items gemaakt en gesloten; de app zet alleen gezien_at.';

/*
 * De wacht op de voorraad.
 *
 * Bij elke wijziging van stand of minimum: onder het minimum en nog geen open
 * alarm, dan komt er een. Weer op of boven het minimum, dan gaat het open
 * alarm dicht. Precies één open alarm per artikel -- een tweede afboeking
 * terwijl het al onder het minimum staat is geen nieuw feit.
 *
 * Security definer, want wie een liter afboekt heeft daarmee geen
 * schrijfrecht op de alarmen, en dat hoort ook niet: de alarmen zijn van de
 * server. Bewust "stock < min_stock" en niet "<=": op het minimum staan is
 * de grens halen, niet eronder zitten. Een minimum van 0 geeft dus nooit een
 * alarm, en dat is de manier om een artikel buiten de bewaking te houden.
 */
create or replace function public.voorraad_alarm_bewaken()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  open_id text;
begin
  select id into open_id
    from public.voorraad_alarmen
   where item_id = new.id and opgelost_at is null
   limit 1;

  if new.stock < new.min_stock then
    if open_id is null then
      insert into public.voorraad_alarmen
        (id, item_id, item_naam, location_id, stand, minimum, ontstaan_at, updated_at)
      values
        ('va_' || replace(gen_random_uuid()::text, '-', ''),
         new.id, new.name, new.location_id, new.stock, new.min_stock,
         public.now_ms(), public.now_ms());
    else
      -- Het alarm staat er al; alleen de stand bijhouden, zodat de mail het
      -- laatste getal noemt en niet het getal van het moment van ontstaan.
      update public.voorraad_alarmen
         set stand = new.stock, minimum = new.min_stock, updated_at = public.now_ms()
       where id = open_id;
    end if;
  elsif open_id is not null then
    update public.voorraad_alarmen
       set opgelost_at = public.now_ms(), stand = new.stock, updated_at = public.now_ms()
     where id = open_id;
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_items_alarm on public.inventory_items;
create trigger inventory_items_alarm
  after insert or update of stock, min_stock on public.inventory_items
  for each row execute function public.voorraad_alarm_bewaken();

/*
 * Wat er nú al onder het minimum staat.
 *
 * De trigger kijkt alleen bij een wijziging. Een artikel dat al weken onder
 * zijn minimum staat en waar niemand meer aan komt, zou dus nooit een alarm
 * krijgen -- terwijl dat precies het artikel is waar het om gaat. Eén keer
 * aanraken is genoeg: "update of stock" gaat af zodra de kolom in de SET
 * staat, ook als de waarde gelijk blijft. Bij opnieuw draaien gebeurt er
 * niets: de trigger maakt geen tweede open alarm.
 */
update public.inventory_items set stock = stock
 where stock < min_stock
   and not exists (select 1 from public.voorraad_alarmen a
                    where a.item_id = inventory_items.id and a.opgelost_at is null);

-- ---------------------------------------------------------------------------
--  De bestellingen
--
--  Een bestelling is van de leverancier: die maakt hem, pakt hem in en
--  verstuurt hem. De vestiging kan er een aanvragen (bron 'aanvraag'); de
--  status is niet van haar -- ook 'ontvangen' zet de leverancier of het
--  management, want bestellingen_update laat alleen die twee door. Wil de
--  vestiging zelf aftekenen, dan is dat een aparte policy in een latere
--  migratie, niet iets wat de app stilletjes probeert.
--
--  Het nummer (TS-2026-0001) komt uit bestelnummer(), niet uit de app. Twee
--  apparaten die tegelijk een bestelling maken krijgen anders hetzelfde
--  nummer, en een pakbon met een dubbel nummer is precies het soort fout
--  waar je een maand later een uur naar zoekt.
-- ---------------------------------------------------------------------------

create table if not exists public.bestellingen (
  id                   text primary key,
  nummer               text unique,
  location_id          text references public.locations(id) on delete set null,
  status               text not null default 'concept'
                       check (status in ('concept','bevestigd','ingepakt','verzonden','ontvangen','geannuleerd')),
  /* Waar hij vandaan komt: uit een alarm (voorraad), door de leverancier
     zelf (handmatig) of aangevraagd door de vestiging (aanvraag). */
  bron                 text not null default 'handmatig'
                       check (bron in ('voorraad','handmatig','aanvraag')),
  aangemaakt_door      text,
  aangemaakt_door_naam text,
  aangemaakt_at        bigint not null default public.now_ms(),
  bevestigd_at         bigint,
  verzonden_at         bigint,
  ontvangen_at         bigint,
  vervoerder           text,
  track_trace          text,
  opmerking            text,
  /* Als de pakbon per mail naar een ander is gegaan -- een magazijn, een
     vervoerder. Naar wie en wanneer, zodat "is hij al doorgestuurd" geen
     vraag is die je in je mailbox moet beantwoorden. */
  doorgestuurd_naar    text,
  doorgestuurd_at      bigint,
  updated_at           bigint not null default public.now_ms()
);

create index if not exists bestellingen_location_idx on public.bestellingen (location_id);
create index if not exists bestellingen_status_idx   on public.bestellingen (status);
create index if not exists bestellingen_updated_idx  on public.bestellingen (updated_at);

create table if not exists public.bestelregels (
  id             text primary key,
  bestelling_id  text not null references public.bestellingen(id) on delete cascade,
  item_id        text references public.inventory_items(id) on delete set null,
  /* Nogmaals de naam, om dezelfde reden als bij de alarmen: een pakbon van
     vorig jaar moet nog kloppen als het artikel weg is. */
  item_naam      text not null default '',
  aantal         numeric not null default 0,
  eenheid        text not null default 'stuk',
  prijs          numeric,
  /* Wat er werkelijk meegaat. Leeg tot de leverancier bij het inpakken
     invult wat er echt in de doos zit; bij verzenden wordt dít bijgeboekt,
     en anders het bestelde aantal. */
  geleverd       numeric,
  updated_at     bigint not null default public.now_ms()
);

create index if not exists bestelregels_bestelling_idx on public.bestelregels (bestelling_id);
create index if not exists bestelregels_updated_idx    on public.bestelregels (updated_at);

/*
 * Het bestelnummer.
 *
 * Een sequence voor het volgnummer; het jaar ervoor. Bij het eerste nummer
 * van een nieuw jaar begint de teller opnieuw -- dat is wat mensen van zo'n
 * nummer verwachten, en het maakt "hoeveel bestellingen dit jaar" een blik op
 * het laatste nummer.
 *
 * Het jaar zit in de sequence zelf: de waarde is jaar * 10000 + volgnummer.
 * Zo weet de sequence uit zichzelf of hij nog in het goede jaar zit, zonder
 * een aparte teller en zonder in de tabel te kijken. Dat laatste was de
 * eerste versie, en die zat fout: zolang er nog geen bestelling van dit jaar
 * ís opgeslagen begon hij bij élke aanroep opnieuw, en gaf dus twee keer
 * 0001 aan wie twee nummers vroeg voordat hij de eerste had bewaard.
 *
 * Twee bestellingen op precies hetzelfde moment op 1 januari kunnen nog
 * steeds botsen: allebei zien ze een oud jaar, allebei zetten ze de teller
 * terug. De unieke sleutel op nummer vangt dat, en de tweede probeert het
 * opnieuw. Hoogstens één keer per jaar, en dan nog alleen op die seconde.
 *
 * Security definer, zodat de aanroeper geen recht op de sequence zelf nodig
 * heeft; en dus met de gebruikelijke revoke, zie 0034.
 */
create sequence if not exists public.bestelnummer_seq;

create or replace function public.bestelnummer()
returns text language plpgsql security definer set search_path = public as $$
declare
  jaar   integer := extract(year from now() at time zone 'Europe/Amsterdam')::integer;
  ondergrens bigint := jaar::bigint * 10000;
  laatste bigint;
  waarde bigint;
begin
  select last_value into laatste from public.bestelnummer_seq;
  if laatste < ondergrens then
    perform setval('public.bestelnummer_seq', ondergrens + 1, false);
  end if;
  waarde := nextval('public.bestelnummer_seq');
  return 'TS-' || jaar::text || '-' || lpad((waarde - ondergrens)::text, 4, '0');
end;
$$;

revoke execute on function public.bestelnummer() from public, anon, authenticated;
grant  execute on function public.bestelnummer() to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  De koppeling met Exact
--
--  Eén rij, met de tokens erin. Daarom RLS aan en géén enkele policy: niets
--  wat via de app binnenkomt mag hier bij, ook het management niet. De
--  Edge Function exact werkt met de servicesleutel en is de enige die leest
--  en schrijft. Een toegangstoken in een tabel die de app kan synchroniseren
--  is een toegangstoken op elke tablet.
-- ---------------------------------------------------------------------------

create table if not exists public.exact_koppeling (
  id                 text primary key default 'exact',
  division           text,
  access_token       text,
  refresh_token      text,
  token_verloopt_at  bigint,
  status             text not null default 'los',
  verbonden_door     text,
  verbonden_at       bigint,
  laatste_fout       text,
  /* De state van een lopende koppelpoging: uitgegeven bij verbind-url,
     gecontroleerd bij de terugkeer van Exact. Een eigen kolom en niet
     laatste_fout, want een fout en een lopende poging zijn twee dingen. */
  state              text,
  /* Wanneer die state is uitgegeven. Een poging die niet binnen een kwartier
     terugkomt vervalt vanzelf; anders blijft een verlaten koppelpoging voor
     altijd een geldige deur. */
  state_at           bigint,
  updated_at         bigint not null default public.now_ms()
);

alter table public.exact_koppeling add column if not exists state text;
alter table public.exact_koppeling add column if not exists state_at bigint;
alter table public.exact_koppeling enable row level security;

comment on table public.exact_koppeling is
  'De OAuth-tokens van Exact Online. RLS aan zonder policies: alleen de '
  'servicesleutel (Edge Function exact) komt erbij. Nooit een policy op zetten.';

-- ---------------------------------------------------------------------------
--  Instellingen
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_trucksupply_mail', 'trucksupply_mail', 'casper@truckwash1group.nl',
   'Het adres waar voorraadalarmen en de ochtendmail naartoe gaan. Meerdere '
   'mag, met een komma ertussen.'),
  ('in_trucksupply_ochtend_uur', 'trucksupply_ochtend_uur', '8',
   'Het uur (Nederlandse tijd) waarop de ochtendmail met alle nog niet '
   'geziene alarmen wordt verstuurd. De wekker (.github/workflows/voorraad.yml) '
   'loopt elk heel uur van 4 tot en met 9 UTC; de functie kijkt zelf of het '
   'lokaal dit uur is. Daardoor werkt 6 tot en met 10; een ander uur komt de '
   'wekker nooit langs en dan gaat er geen ochtendmail.'),
  ('in_exact_division', 'exact_division', '',
   'De administratie (division) in Exact Online. Leeg betekent: de standaard '
   'van het gekoppelde account.')
on conflict (id) do nothing;

/* De tabel instellingen was van het management (0042: lezen ook met
   admin.desk). Deze drie sleutels zijn van de leverancier: het is zíjn
   mailadres en zíjn ochtendmail. Zonder deze verruiming las het scherm
   Instellingen van Trucksupply een lege tabel en toonde het de terugval, en
   een Opslaan bleef in de wachtrij hangen op een RLS-fout terwijl de app
   "opgeslagen" zei. Alleen deze drie: het inkoopdomein en het adres van
   Trucky blijven van het management. */

create or replace function public.is_trucksupply_instelling(sleutel text)
returns boolean
language sql
stable
as $$
  select sleutel in ('trucksupply_mail', 'trucksupply_ochtend_uur', 'exact_division')
$$;

revoke execute on function public.is_trucksupply_instelling(text) from public, anon;
grant  execute on function public.is_trucksupply_instelling(text) to authenticated, service_role;

drop policy if exists instellingen_select on public.instellingen;
create policy instellingen_select on public.instellingen for select to authenticated
  using (
    public.is_management() or public.heeft_recht('admin.desk')
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  );

drop policy if exists instellingen_insert on public.instellingen;
create policy instellingen_insert on public.instellingen for insert to authenticated
  with check (
    public.rij_bestaat('public.instellingen'::regclass, id)
    or public.is_management()
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  );

drop policy if exists instellingen_update on public.instellingen;
create policy instellingen_update on public.instellingen for update to authenticated
  using (
    public.is_management()
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  )
  with check (
    public.is_management()
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  );

-- ---------------------------------------------------------------------------
--  Tijdstempels en verwijderingen
--
--  Zelfde twee triggers als op elke gesynchroniseerde tabel: de server zet
--  updated_at (0001), en een verwijdering meldt zichzelf (0038). Zonder de
--  tweede houdt elk apparaat een verwijderde conceptbestelling als spook.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['voorraad_alarmen', 'bestellingen', 'bestelregels', 'exact_koppeling'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$I', t);
    execute format(
      'create trigger stamp_%1$s before insert or update on public.%1$I
       for each row execute function public.stamp_updated_at()', t);
  end loop;

  foreach t in array array['voorraad_alarmen', 'bestellingen', 'bestelregels'] loop
    execute format('drop trigger if exists %1$s_verwijderd on public.%1$I', t);
    execute format(
      'create trigger %1$s_verwijderd after delete on public.%1$I
       for each row execute function public.meld_verwijdering()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  De leverancier ziet de voorraad van álle vestigingen; dat is het hele
--  punt. De regel van 0004 blijft woordelijk staan, met de leverancier als
--  extra tak -- zodat een medewerker nog steeds alleen zijn eigen vestiging
--  ziet.
-- ---------------------------------------------------------------------------

drop policy if exists inventory_select on public.inventory_items;
create policy inventory_select on public.inventory_items for select to authenticated
  using (
    (public.is_staff() and public.in_my_locations(location_id))
    or public.is_trucksupply()
  );

drop policy if exists inventory_write on public.inventory_items;
create policy inventory_write on public.inventory_items for all to authenticated
  using (
    (public.is_staff() and public.in_my_locations(location_id))
    or public.is_trucksupply()
  )
  with check (
    (public.is_staff() and public.in_my_locations(location_id))
    or public.is_trucksupply()
  );

/* De mutaties mag hij lezen (wat is er verbruikt), niet schrijven: afboeken
   doet de vestiging. stock_insert blijft zoals 0040 hem achterliet. */
drop policy if exists stock_select on public.stock_movements;
create policy stock_select on public.stock_movements for select to authenticated
  using (public.is_staff() or public.is_trucksupply());

-- --- alarmen ---

alter table public.voorraad_alarmen enable row level security;

drop policy if exists voorraad_alarmen_select on public.voorraad_alarmen;
create policy voorraad_alarmen_select on public.voorraad_alarmen for select to authenticated
  using (
    public.mag_leverancier()
    or (public.is_staff() and public.in_my_locations(location_id))
  );

/* Alarmen ontstaan in de trigger, die als eigenaar draait en hier niet langs
   komt. Deze regel is er voor de upsert-val (0040): de app zet gezien_at met
   een upsert, en die wordt óók tegen de insert-regel gehouden. */
drop policy if exists voorraad_alarmen_insert on public.voorraad_alarmen;
create policy voorraad_alarmen_insert on public.voorraad_alarmen for insert to authenticated
  with check (
    public.rij_bestaat('public.voorraad_alarmen'::regclass, id)
    or public.mag_leverancier()
  );

drop policy if exists voorraad_alarmen_update on public.voorraad_alarmen;
create policy voorraad_alarmen_update on public.voorraad_alarmen for update to authenticated
  using (public.mag_leverancier() or public.is_management())
  with check (public.mag_leverancier() or public.is_management());

-- --- bestellingen ---

alter table public.bestellingen enable row level security;
alter table public.bestelregels enable row level security;

drop policy if exists bestellingen_select on public.bestellingen;
create policy bestellingen_select on public.bestellingen for select to authenticated
  using (
    public.mag_leverancier()
    or (public.is_staff() and public.in_my_locations(location_id))
  );

/* Een vestiging mag alleen een aanvraag neerleggen, en alleen voor zichzelf.
   De rest van het maken is aan de leverancier. De 'is not null' staat er
   omdat in_my_locations(null) waar is (0004): zonder die regel kon elke
   medewerker een aanvraag voor niemand neerleggen, en die staat dan bij de
   leverancier zonder adres op de pakbon. */
drop policy if exists bestellingen_insert on public.bestellingen;
create policy bestellingen_insert on public.bestellingen for insert to authenticated
  with check (
    public.rij_bestaat('public.bestellingen'::regclass, id)
    or public.mag_leverancier()
    or (public.is_staff() and bron = 'aanvraag' and location_id is not null
        and public.in_my_locations(location_id))
  );

drop policy if exists bestellingen_update on public.bestellingen;
create policy bestellingen_update on public.bestellingen for update to authenticated
  using (public.mag_leverancier() or public.is_management())
  with check (public.mag_leverancier() or public.is_management());

/* Weg mag alleen wat nog nergens is: een concept. Een verzonden bestelling
   is een feit, en feiten annuleer je (status), je wist ze niet. */
drop policy if exists bestellingen_delete on public.bestellingen;
create policy bestellingen_delete on public.bestellingen for delete to authenticated
  using (public.mag_leverancier() and status = 'concept');

-- --- regels: alles loopt via de bestelling waar ze bij horen ---

drop policy if exists bestelregels_select on public.bestelregels;
create policy bestelregels_select on public.bestelregels for select to authenticated
  using (
    public.mag_leverancier()
    or exists (
      select 1 from public.bestellingen b
       where b.id = bestelling_id
         and public.is_staff() and public.in_my_locations(b.location_id))
  );

drop policy if exists bestelregels_insert on public.bestelregels;
create policy bestelregels_insert on public.bestelregels for insert to authenticated
  with check (
    public.rij_bestaat('public.bestelregels'::regclass, id)
    or public.mag_leverancier()
    or exists (
      select 1 from public.bestellingen b
       where b.id = bestelling_id
         and b.bron = 'aanvraag'
         and public.is_staff() and public.in_my_locations(b.location_id))
  );

drop policy if exists bestelregels_update on public.bestelregels;
create policy bestelregels_update on public.bestelregels for update to authenticated
  using (public.mag_leverancier() or public.is_management())
  with check (public.mag_leverancier() or public.is_management());

drop policy if exists bestelregels_delete on public.bestelregels;
create policy bestelregels_delete on public.bestelregels for delete to authenticated
  using (
    public.mag_leverancier()
    and exists (
      select 1 from public.bestellingen b
       where b.id = bestelling_id and b.status = 'concept')
  );

-- ---------------------------------------------------------------------------
--  Een artikel naar de kassa
--
--  De kassa verkoopt uit dezelfde voorraad, maar heeft zijn eigen
--  artikeltabel (pos_products, 0012). Die tabel is van de kassa: geen nieuwe
--  kolom, geen andere policy -- dat is een afspraak, zie 0040 en 0045.
--
--  Deze functie is daarom de enige deur. Ze maakt de kassarij aan als die er
--  nog niet is, en werkt hem anders bij; de koppeling is inventory_item_id,
--  die kolom bestond al. Wie mag: de leverancier, of wie de kassa toch al
--  beheert.
-- ---------------------------------------------------------------------------

create or replace function public.supply_artikel_naar_kassa(
  item_id    text,
  prijs_incl numeric,
  groep      text default null
)
returns text language plpgsql security definer set search_path = public as $$
declare
  artikel public.inventory_items%rowtype;
  product_id text;
begin
  if not (public.mag_leverancier() or public.mag_kassa_beheren()) then
    raise exception 'Alleen de leverancier of wie de kassa beheert zet een artikel op de kassa';
  end if;

  select * into artikel from public.inventory_items where id = item_id;
  if not found then
    raise exception 'Artikel % bestaat niet', item_id;
  end if;

  select id into product_id
    from public.pos_products
   where inventory_item_id = item_id
   order by updated_at desc
   limit 1;

  if product_id is null then
    product_id := 'pp_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.pos_products
      (id, location_id, code, name, group_name, unit, price_incl, kind,
       inventory_item_id, image, active, updated_at)
    values
      (product_id, artikel.location_id, coalesce(artikel.sku, ''), artikel.name,
       coalesce(nullif(trim(groep), ''), 'Overig'), artikel.unit,
       coalesce(prijs_incl, 0), 'artikel',
       artikel.id, artikel.image, artikel.actief, public.now_ms());
  else
    update public.pos_products
       set name        = artikel.name,
           unit        = artikel.unit,
           image       = artikel.image,
           location_id = artikel.location_id,
           code        = coalesce(artikel.sku, code),
           /* Geen prijs meegegeven: de kassaprijs blijft staan. */
           price_incl  = coalesce(prijs_incl, price_incl),
           group_name  = coalesce(nullif(trim(groep), ''), group_name),
           kind        = 'artikel',
           active      = artikel.actief,
           updated_at  = public.now_ms()
     where id = product_id;
  end if;

  return product_id;
end;
$$;

revoke execute on function public.supply_artikel_naar_kassa(text, numeric, text) from public, anon, authenticated;
grant  execute on function public.supply_artikel_naar_kassa(text, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  Wat de kassa van een artikel weet -- alleen lezen
--
--  De leverancier zet een artikel op de kassa via de deur hierboven, maar kon
--  daarna niet zien of het er stond en voor welke prijs: pos_products_select
--  (0012) is voor personeel, en Trucksupply is bewust geen personeel. Het
--  scherm verborg de kolom dan maar. Dat is eerlijk, maar niet handig: wie
--  de prijs zet hoort hem terug te kunnen lezen.
--
--  Dus een tweede deur, en die kan alleen kijken. Geen naam, geen barcode,
--  geen omzet -- alleen wat er nodig is om naast het artikel te tonen: welk
--  kassaproduct eraan hangt, de prijs en of het aanstaat. Wie de kassa mag
--  lezen krijgt niets nieuws; wie de kassa beheert of levert krijgt precies
--  dit. En de pos_*-tabellen blijven ongewijzigd: geen kolom, geen policy.
-- ---------------------------------------------------------------------------

create or replace function public.supply_kassa_prijzen()
returns table (inventory_item_id text, product_id text, price_incl numeric, active boolean)
language sql stable security definer set search_path = public as $$
  select p.inventory_item_id, p.id, p.price_incl, p.active
    from public.pos_products p
   where p.inventory_item_id is not null
     and (public.mag_leverancier() or public.mag_kassa_beheren() or public.is_staff())
   order by p.updated_at desc;
$$;

revoke execute on function public.supply_kassa_prijzen() from public, anon, authenticated;
grant  execute on function public.supply_kassa_prijzen() to authenticated, service_role;

-- ===========================================================================
--  De factuur kan ook thuis gelezen worden
--
--  Draai dit ná 0048. Opnieuw draaien mag.
--
--  Waar het om gaat
--  ----------------
--
--  Elke factuur die per mail binnenkomt gaat nu naar Claude om gelezen te
--  worden. Dat werkt, maar het kost per stuk geld en de bon gaat het huis uit.
--  Casper heeft een pc met een RTX 5090 staan waarop Ollama met gemma4:26b
--  draait, en een proef met hetzelfde systeemprompt las een testfactuur in
--  acht seconden foutloos uit -- IBAN, btw-nummer, KvK en alle regels erbij.
--  Dus mag die pc het ook doen.
--
--  Twee dingen zijn daarbij met opzet zo:
--
--  a. De uitkomst moet DEZELFDE zijn als bij Claude. Daarom leest de pc
--     alleen. Het opschonen, de verkoopcontrole, het indelen en het
--     wegschrijven gebeuren nog steeds op de server, in dezelfde code
--     (supabase/functions/_gedeeld/verwerking.ts). Wie er leest is een
--     instelling; wat er daarna gebeurt niet.
--
--  b. De richting is omgedraaid. Niet de server die de pc belt -- dan moet er
--     op het thuisnetwerk een poort open en een adres bekend zijn -- maar de
--     pc die elke halve minuut bij de server komt vragen of er werk ligt
--     (Edge Function lezer). De pc kent alleen één geheim en praat alleen
--     met die functie en met Ollama op localhost. Geen servicesleutel, geen
--     API-sleutel, geen open poort.
--
--  Wat hier in de database komt: drie kolommen op expenses waarmee de server
--  en de pc het werk overdragen, en de instelling die zegt wie er leest.
--  Geen RLS-wijziging: de functie lezer werkt met de servicesleutel, en de
--  app leest de nieuwe kolommen mee via de bestaande policies op expenses.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De overdracht
--
--    lees_status       wacht    de post heeft hem klaargezet voor de pc
--                      bezig    de pc heeft hem opgehaald (lees_geclaimd_at)
--                      klaar    gelezen en verwerkt
--                      mislukt  de pc kon het niet; de reden staat in de
--                               twijfel van de lezing, zodat de app hem toont
--                      leeg     niet via de pc gegaan (Claude, of van vóór
--                               deze migratie)
--    lees_geclaimd_at  wanneer de pc hem pakte. Staat een bon langer dan
--                      tien minuten op bezig, dan is de pc er halverwege mee
--                      opgehouden en mag de volgende ronde hem opnieuw pakken.
--    lezer             wie las: 'claude', 'claude (terugval)' of
--                      'lokaal: <model>'. Zodat je achteraf kunt zien welke
--                      lezer een fout maakte, als er een gemaakt is.
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists lees_status      text;
alter table public.expenses add column if not exists lees_geclaimd_at bigint;
alter table public.expenses add column if not exists lezer            text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_lees_status_check') then
    alter table public.expenses
      add constraint expenses_lees_status_check
      check (lees_status is null or lees_status in ('wacht','bezig','klaar','mislukt'));
  end if;
end $$;

comment on column public.expenses.lees_status is
  'Overdracht aan de lokale lezer: wacht (klaargezet), bezig (opgehaald), '
  'klaar (gelezen en verwerkt), mislukt (reden staat in de twijfel van de '
  'lezing). Leeg als de bon niet via de lokale lezer ging.';

comment on column public.expenses.lees_geclaimd_at is
  'Wanneer de lokale lezer de bon pakte (epoch ms). Ouder dan tien minuten op '
  'bezig telt als vastgelopen en mag opnieuw gepakt worden.';

comment on column public.expenses.lezer is
  'Wie de factuur las: claude, claude (terugval) of lokaal: <model>.';

-- ---------------------------------------------------------------------------
--  Wie leest
--
--  Standaard blijft Claude het doen: zonder pc die werk komt halen zou
--  "lokaal" betekenen dat elke bon op wacht blijft staan. De twee sleutels
--  eronder schrijft de functie lezer bij elke ronde, zodat het
--  ontwikkelaarsscherm kan laten zien of de pc er nog is.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_factuur_lezer', 'factuur_lezer', 'claude',
   'Wie een binnengekomen factuur uitleest. "claude": Claude in de cloud, '
   'zoals altijd. "lokaal": alleen de eigen pc met Ollama; is die er niet, '
   'dan blijft de bon op wacht staan. "lokaal-terugval": de eigen pc, en als '
   'die het niet vertrouwt of niet kan lezen alsnog Claude. Wat er ná het '
   'lezen gebeurt is in alle drie de standen hetzelfde.'),
  ('in_lezer_laatst_gezien', 'lezer_laatst_gezien', '',
   'Wanneer de lokale lezer voor het laatst om werk kwam vragen (epoch ms). '
   'Schrijft de functie lezer zelf; niet met de hand aanpassen.'),
  ('in_lezer_model', 'lezer_model', '',
   'Het model dat de lokale lezer de laatste keer opgaf, bijvoorbeeld '
   'gemma4:26b. Schrijft de functie lezer zelf.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  De overdracht blijft van de server
--
--  De app schrijft een kostenpost altijd als hele rij terug (goedkeuren is
--  een upsert van alles wat het toestel het laatst zag), en daar zitten deze
--  drie kolommen nu ook in. Keurt iemand een bon goed tussen het moment dat
--  de pc hem op "klaar" zette en de volgende keer dat de app hem ophaalt,
--  dan zou lees_status terug naar "wacht" of "bezig" gaan -- en dan pakt de
--  pc een goedgekeurde bon opnieuw en schrijft de lezing over wat een mens
--  had beoordeeld. Voor gelezen bestaat hiervoor sinds 0029 de trigger
--  lezing_blijft_lezing; die krijgt de drie nieuwe kolommen erbij, met
--  dezelfde regel: wat uit de app komt wordt teruggezet, de server (geen
--  my_id()) mag alles.
-- ---------------------------------------------------------------------------

create or replace function public.lezing_blijft_lezing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- De serverfunctie schrijft hem; die werkt met de servicesleutel en heeft
  -- dus geen my_id(). Alleen wat uit de app komt wordt teruggezet.
  if public.my_id() is null then return new; end if;

  if new.gelezen is distinct from old.gelezen then
    new.gelezen := old.gelezen;
  end if;

  -- De overdracht aan de lokale lezer (0049) is ook van de server.
  new.lees_status      := old.lees_status;
  new.lees_geclaimd_at := old.lees_geclaimd_at;
  new.lezer            := old.lezer;
  return new;
end;
$$;

revoke execute on function public.lezing_blijft_lezing() from public, anon, authenticated;

-- ===========================================================================
--  Wat drie keer hetzelfde was, hoeft de vierde keer niet opnieuw
--
--  De vraag van Casper: "Als hij 3x is goedgekeurd, en de volgende is
--  hetzelfde, maar met een andere datum en factuurnummer, dan mag je hem
--  automatisch goedkeuren."
--
--  Dat is een goede regel, en tegelijk de gevaarlijkste die in dit systeem
--  zit: hier gaat er geld weg zonder dat iemand keek. Daarom staat hij
--  standaard UIT, en zitten er vier sloten op.
--
--  Slot 1: alleen wat een MENS drie keer goedkeurde
--  -----------------------------------------------
--
--  De drie eerdere goedkeuringen moeten van een mens zijn. Zou een
--  automatische goedkeuring meetellen, dan bevestigt het systeem na verloop
--  van tijd zijn eigen vergissingen -- precies het gat dat bij het
--  grootboekgeheugen (0044) al is dichtgezet. Nu blijft het oordeel altijd
--  terug te voeren op drie mensen die ja zeiden.
--
--  Slot 2: hetzelfde bedrag, binnen een marge
--  ------------------------------------------
--
--  "Hetzelfde" is bij een maandfactuur nooit tot op de cent hetzelfde: een
--  afvalcontainer verschilt met de weegbon, elektra met het verbruik. Daarom
--  een marge (standaard 2%) ten opzichte van de MEDIAAN van de drie, niet van
--  de laatste. Eén uitschieter verschuift de mediaan niet, en dus ook niet wat
--  er voortaan vanzelf doorgaat.
--
--  Slot 3: een plafond
--  -------------------
--
--  Boven een bedrag (standaard 500 euro exclusief btw) gaat er nooit iets
--  vanzelf doorheen, hoe vertrouwd de leverancier ook is. Een leverancier die
--  elke maand 40 euro stuurt en ineens 4.000, is geen gewoonte maar een vraag.
--
--  Slot 4: geen twijfel, geen dubbele
--  ----------------------------------
--
--  Wat de lezer niet zeker wist gaat nooit vanzelf door, en een factuurnummer
--  dat al bij deze leverancier bestaat al helemaal niet -- dat is een
--  herinnering of een dubbele, en die betaal je niet twee keer.
--
--  Wat je terugziet
--  ----------------
--
--  Een automatisch goedgekeurde bon draagt goedkeuring_bron = 'automatisch',
--  de naam "Automatisch" bij de goedkeurder en een zin in goedkeuring_reden
--  die zegt waaróm. Het management krijgt er een melding van. Afkeuren kan
--  gewoon; dan wordt het weer mensenwerk.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Wat er op de kostenpost bijkomt
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists goedkeuring_bron text;

do $$
begin
  alter table public.expenses drop constraint if exists expenses_goedkeuring_bron_check;
  alter table public.expenses add constraint expenses_goedkeuring_bron_check
    check (goedkeuring_bron is null or goedkeuring_bron in ('mens', 'automatisch'));
exception when others then
  raise notice 'goedkeuring_bron-controle niet gezet: %', sqlerrm;
end $$;

/* Waarom hij vanzelf doorging. Eén zin, voor op het scherm en voor later. */
alter table public.expenses add column if not exists goedkeuring_reden text;

comment on column public.expenses.goedkeuring_bron is
  'Wie deze kostenpost heeft goedgekeurd: "mens" of "automatisch" (0050). '
  'Leeg bij bonnen van voor die migratie en bij alles wat nog openstaat.';

-- ---------------------------------------------------------------------------
--  De instellingen
--
--  Standaard uit. Dit is de enige plek in het systeem waar geld wordt
--  goedgekeurd zonder dat er iemand kijkt; dat zet je zelf aan, bewust, als
--  je de eerste maanden hebt gezien dat de lezer klopt.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_auto_goedkeuren', 'auto_goedkeuren', 'nee',
   'Mag een factuur zichzelf goedkeuren als dezelfde leverancier voor '
   'ongeveer hetzelfde bedrag al een aantal keer door een mens is '
   'goedgekeurd? "ja" of "nee". Standaard nee.'),
  ('in_auto_goedkeuren_vanaf', 'auto_goedkeuren_vanaf', '3',
   'Hoeveel keer een mens dezelfde leverancier voor ongeveer hetzelfde bedrag '
   'moet hebben goedgekeurd voordat de volgende vanzelf doorgaat. Minimaal 2.'),
  ('in_auto_goedkeuren_marge', 'auto_goedkeuren_marge', '2',
   'Hoeveel procent het bedrag mag afwijken van de mediaan van de eerdere '
   'goedkeuringen en toch "hetzelfde" heet. Standaard 2.'),
  ('in_auto_goedkeuren_max', 'auto_goedkeuren_max', '500',
   'Bedrag exclusief btw waarboven nooit iets vanzelf wordt goedgekeurd, hoe '
   'vertrouwd de leverancier ook is. Standaard 500 euro.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  Het oordeel
--
--  Eén functie die alles nakijkt en zegt wat hij vindt, met de reden erbij.
--  Beslissen doet hij niet: hij geeft antwoord, en de aanroeper (de post, via
--  _gedeeld/verwerking.ts) keurt goed of laat hem staan. Zo is dit oordeel los
--  te lezen, los te testen, en straks ook los aan te roepen vanuit een scherm
--  dat wil laten zien waarom iets wel of niet vanzelf doorging.
--
--  security definer omdat hij over alle vestigingen heen telt; wie hem mag
--  aanroepen staat onderaan.
-- ---------------------------------------------------------------------------

create or replace function public.mag_automatisch_goedkeuren(
  leverancier_in    text,
  bedrag_in         numeric,
  factuurnummer_in  text default null,
  expense_in        text default null
)
returns table (mag boolean, waarom text, keren integer, gewoonte numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  /*
   * De leverancier heet hier partij en niet sleutel.
   *
   * Dat is geen smaak: instellingen heeft een kolom die sleutel heet, en
   * PL/pgSQL kiest bij gelijke namen de variabele. Elke select op de
   * instellingen viel daardoor om met "column reference sleutel is
   * ambiguous" -- pas bij het draaien, niet bij het aanmaken.
   */
  partij    text := lower(trim(coalesce(leverancier_in, '')));
  aan       text;
  vanaf     integer;
  marge     numeric;
  plafond   numeric;
  bedragen  numeric[];
  midden    numeric;
  afwijking numeric;
  al_gezien integer;
begin
  keren := 0;
  gewoonte := null;

  select lower(trim(coalesce(i.waarde, 'nee'))) into aan
    from public.instellingen i where i.sleutel = 'auto_goedkeuren';
  if coalesce(aan, 'nee') <> 'ja' then
    mag := false; waarom := 'Automatisch goedkeuren staat uit.'; return next; return;
  end if;

  if partij = '' then
    mag := false; waarom := 'Geen leverancier op het stuk.'; return next; return;
  end if;
  if bedrag_in is null or bedrag_in <= 0 then
    mag := false; waarom := 'Geen bedrag gelezen.'; return next; return;
  end if;

  /* De instellingen, met een bodem eronder: een "vanaf 1" zou betekenen dat
     één goedkeuring genoeg is, en dat is geen gewoonte maar een toevalstreffer. */
  select greatest(2, coalesce(nullif(trim(i.waarde), '')::integer, 3)) into vanaf
    from public.instellingen i where i.sleutel = 'auto_goedkeuren_vanaf';
  vanaf := coalesce(vanaf, 3);

  select greatest(0, least(25, coalesce(nullif(trim(i.waarde), '')::numeric, 2))) into marge
    from public.instellingen i where i.sleutel = 'auto_goedkeuren_marge';
  marge := coalesce(marge, 2);

  select coalesce(nullif(trim(i.waarde), '')::numeric, 500) into plafond
    from public.instellingen i where i.sleutel = 'auto_goedkeuren_max';
  plafond := coalesce(plafond, 500);

  if bedrag_in > plafond then
    mag := false;
    waarom := format('Boven het plafond van %s euro; hier kijkt altijd iemand naar.',
                     trim(to_char(plafond, 'FM999999990.99')));
    return next; return;
  end if;

  /*
   * Een factuurnummer dat al bij deze leverancier staat is een herinnering of
   * een dubbele. Nooit vanzelf. De eigen rij telt niet mee -- die staat er op
   * dit moment al.
   */
  if coalesce(trim(factuurnummer_in), '') <> '' then
    select count(*)::integer into al_gezien
      from public.expenses e
     where lower(trim(coalesce(e.supplier, ''))) = partij
       and trim(coalesce(e.factuurnummer, '')) = trim(factuurnummer_in)
       and (expense_in is null or e.id <> expense_in);
    if coalesce(al_gezien, 0) > 0 then
      mag := false;
      waarom := format('Factuurnummer %s staat al bij deze leverancier.', trim(factuurnummer_in));
      return next; return;
    end if;
  end if;

  /*
   * De eerdere goedkeuringen, nieuwste eerst, en alleen die van een mens.
   * goedkeuring_bron is leeg bij alles van voor deze migratie; dat is
   * mensenwerk geweest en telt dus mee.
   */
  select array_agg(recent.b order by recent.d desc nulls last) into bedragen
    from (
      select e.amount_excl as b, e.approved_at as d
        from public.expenses e
       where lower(trim(coalesce(e.supplier, ''))) = partij
         and e.status = 'goedgekeurd'
         and coalesce(e.goedkeuring_bron, 'mens') = 'mens'
         and e.amount_excl > 0
         and (expense_in is null or e.id <> expense_in)
       order by e.approved_at desc nulls last
       limit 12
    ) recent;

  keren := coalesce(array_length(bedragen, 1), 0);
  if keren < vanaf then
    mag := false;
    waarom := format('Deze leverancier is %s keer door een mens goedgekeurd; er zijn er %s nodig.',
                     keren, vanaf);
    return next; return;
  end if;

  /*
   * De mediaan van de laatste <vanaf> bedragen, niet het gemiddelde: één
   * jaarafrekening ertussen zou het gemiddelde optillen en daarmee de grens
   * verschuiven voor alles wat daarna komt.
   */
  select percentile_cont(0.5) within group (order by w.b) into midden
    from unnest(bedragen[1:vanaf]) as w(b);
  gewoonte := round(midden, 2);

  if midden is null or midden <= 0 then
    mag := false; waarom := 'Geen bruikbaar bedrag om mee te vergelijken.'; return next; return;
  end if;

  afwijking := abs(bedrag_in - midden) / midden * 100;
  if afwijking > marge then
    mag := false;
    waarom := format('Wijkt %s%% af van de gebruikelijke %s euro; dat is meer dan de %s%% die mag.',
                     trim(to_char(afwijking, 'FM999990.9')),
                     trim(to_char(midden, 'FM999999990.99')),
                     trim(to_char(marge, 'FM999990.99')));
    return next; return;
  end if;

  mag := true;
  waarom := format('%s eerdere facturen van deze leverancier zijn met de hand goedgekeurd rond %s euro; dit bedrag wijkt %s%% af.',
                   vanaf,
                   trim(to_char(midden, 'FM999999990.99')),
                   trim(to_char(afwijking, 'FM999990.9')));
  return next;
end;
$$;

revoke execute on function public.mag_automatisch_goedkeuren(text, numeric, text, text)
  from public, anon, authenticated;
grant  execute on function public.mag_automatisch_goedkeuren(text, numeric, text, text)
  to authenticated, service_role;

comment on function public.mag_automatisch_goedkeuren(text, numeric, text, text) is
  'Mag deze factuur zichzelf goedkeuren? Geeft ja/nee met de reden, hoe vaak '
  'deze leverancier eerder door een mens is goedgekeurd, en het bedrag dat '
  'daarbij gebruikelijk was. Beslist niets zelf.';

-- ===========================================================================
--  De eigen AI mag ook meedenken
--
--  De factuurlezer kan sinds 0049 lokaal draaien. De vraag daarna: "eigenlijk
--  voor alles waar we nu ai hebben, laten instellen om de local ai te
--  gebruiken, kijken of dat gaat."
--
--  Er zijn er nog twee:
--
--    melding-gesprek   doorvragen bij een melding, en er een plan van maken
--    trucky            de chatbot op de website
--
--  Waarom dit een tabel is en geen HTTP-adres
--  ------------------------------------------
--
--  Bij de facturen is de richting omgedraaid: niet de cloud belt de pc, maar
--  de pc haalt werk op. Dat moest, want een pc thuis heeft geen adres dat de
--  cloud kan bellen, en een poort openzetten is precies wat je niet wilt.
--
--  Hier speelt hetzelfde, met één verschil: er zit iemand te wachten. Een
--  bezoeker die een vraag stelt, of een monteur die een melding invult. Dus
--  kan het niet "over dertig seconden een keer" -- het antwoord moet er
--  binnen een paar tellen zijn.
--
--  Vandaar deze tabel als postvak. De serverfunctie legt er een opdracht in
--  en kijkt elke paar honderd milliseconden of er antwoord is. De pc hangt
--  aan de andere kant aan een lange lijn (de functie lezer, actie ai-werk):
--  die houdt zijn verzoek open tot er werk is, en geeft het dan meteen door.
--  Zo is de vertraging een fractie van een seconde en zijn het toch maar een
--  paar verzoeken per minuut.
--
--  Wat er NIET in deze tabel hoort
--  -------------------------------
--
--  Persoonsgegevens. De opdracht bevat de tekst die naar het model gaat, en
--  die is er al: de melding die iemand intikte, de vraag van een bezoeker.
--  Maar de rij wordt weggegooid zodra hij beantwoord is (of na een uur), en
--  er zit RLS op zonder één policy: alleen de servicesleutel komt erbij, net
--  als bij exact_koppeling.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Het postvak
-- ---------------------------------------------------------------------------

create table if not exists public.ai_opdrachten (
  id          text primary key,
  /* Wie het vroeg: 'melding' of 'trucky'. Alleen voor het logboek en om te
     kunnen zien welk werk blijft liggen. */
  soort       text not null,
  status      text not null default 'wacht'
              check (status in ('wacht', 'bezig', 'klaar', 'mislukt')),
  /* Wat er naar het model gaat. */
  systeem     text not null,
  gebruiker   text not null,
  /* Welk model de server graag wil; de pc mag een ander nemen als hij dat
     niet heeft, en zet dan in gebruikt_model wat het werkelijk werd. */
  model       text,
  gebruikt_model text,
  /* Moet het antwoord geldige JSON zijn? Dan krijgt Ollama een schema mee. */
  schema      jsonb,
  antwoord    text,
  fout        text,
  geclaimd_at bigint,
  klaar_at    bigint,
  created_at  bigint not null default public.now_ms(),
  updated_at  bigint not null default public.now_ms()
);

create index if not exists ai_opdrachten_wacht_idx
  on public.ai_opdrachten (status, created_at);

/*
 * Dicht. Geen enkele policy, net als exact_koppeling: hier staat de vraag van
 * een bezoeker in, en die gaat niemand buiten de server iets aan.
 */
alter table public.ai_opdrachten enable row level security;

-- ---------------------------------------------------------------------------
--  Opruimen
--
--  Een postvak dat niet wordt geleegd is na een jaar een archief van alles
--  wat mensen ooit hebben ingetikt. Beantwoorde opdrachten mogen meteen weg;
--  wat na een uur nog ligt is blijven hangen en heeft geen waarde meer.
--
--  Wordt aangeroepen door de functie lezer bij elke ronde -- geen pg_cron
--  nodig, en het gebeurt dus alleen als er iets draait.
-- ---------------------------------------------------------------------------

create or replace function public.ai_opdrachten_opruimen()
returns integer language plpgsql security definer set search_path = public as $$
declare weg integer;
begin
  delete from public.ai_opdrachten
   where (status in ('klaar', 'mislukt') and klaar_at < public.now_ms() - 60000)
      or created_at < public.now_ms() - 3600000;
  get diagnostics weg = row_count;
  return weg;
end;
$$;

revoke execute on function public.ai_opdrachten_opruimen() from public, anon, authenticated;
grant  execute on function public.ai_opdrachten_opruimen() to service_role;

-- ---------------------------------------------------------------------------
--  De instellingen
--
--  Per plek apart, want ze zijn niet hetzelfde waard. Bij een melding zit
--  iemand van het bedrijf te wachten en mag het best drie tellen duren; bij
--  Trucky staat een chauffeur op een parkeerplaats naar zijn telefoon te
--  kijken en is elke seconde er een.
--
--  Allebei standaard op claude: er verandert niets tot je het zelf omzet.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_ai_melding', 'ai_melding', 'claude',
   'Wie denkt mee bij een melding: "claude", "lokaal" (Ollama op de eigen pc) '
   'of "lokaal-terugval" (lokaal, en Claude als de pc niet op tijd antwoordt).'),
  ('in_ai_trucky', 'ai_trucky', 'claude',
   'Wie de chatbot op de website laat antwoorden: "claude", "lokaal" of '
   '"lokaal-terugval". Let op: hier staat een bezoeker te wachten.'),
  ('in_ai_lokaal_model', 'ai_lokaal_model', 'gemma4:26b',
   'Het Ollama-model voor deze twee. Hoeft geen plaatjes te kunnen lezen; dat '
   'is alleen voor facturen.'),
  ('in_ai_wachttijd', 'ai_wachttijd', '20',
   'Hoeveel seconden de server op de eigen pc wacht voordat hij het opgeeft. '
   'Daarna komt er een nette melding, of Claude bij "lokaal-terugval".')
on conflict (id) do nothing;

comment on table public.ai_opdrachten is
  'Postvak tussen de serverfuncties en de eigen AI op de pc (0051). De '
  'functie legt er een opdracht in en wacht op het antwoord; het programma in '
  'lezer/ haalt hem op via de functie lezer. Rijen worden na afhandeling '
  'weggegooid.';

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

-- ===========================================================================
--  Terugkomen in de app na het koppelen
--
--  Casper: "zodat ik erop kan klikken, en erop terug kom, evt dat je
--  webbrowser opent ervoor?"
--
--  Wat er nu gebeurt is een halve rondgang. Je klikt op Koppelen, je browser
--  opent, je logt in bij Exact, en dan kom je uit op een kaal pagina'tje van
--  de serverfunctie: "Gekoppeld. Je kunt dit venster sluiten." Daarna moet je
--  zelf terug naar de app en zelf op het pijltje drukken om te zien of het
--  gelukt is. Dat is drie handelingen te veel, en het ergste is dat je bij
--  twijfel niet weet of het nou wel of niet gelukt is.
--
--  Waarom dit een instelling is en geen vaste waarde
--  -------------------------------------------------
--
--  De serverfunctie moet weten waar hij je heen moet sturen, en dat adres
--  staat nergens in de database. Het hoort ook niet in de code: er is een
--  proefomgeving, er is de echte, en het uitroldomein is al een keer
--  verhuisd. Een verhuizing zou anders betekenen dat de koppeling stilvalt
--  tot er iemand een nieuwe versie uitbrengt.
--
--  Let op wat het NIET is. Er staat al een APP_LINK op de server, en die
--  wijst naar de releasepagina op GitHub -- dat is de plek waar je de app
--  ophaalt, en dat is iets anders dan de plek waar de app draait. Casper
--  wilde juist van dat GitHub-adres af, dus die twee blijven gescheiden.
--
--  Opnieuw draaien mag.
-- ===========================================================================

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_app_url', 'app_url', 'https://truckwash-workspace.com/app/',
   'Waar de app draait. Hier komt iemand terug nadat hij bij Exact op '
   'toestaan heeft geklikt. Moet https zijn; leeg laten betekent dat de '
   'serverfunctie zijn eigen pagina toont in plaats van je terug te sturen.')
on conflict (id) do nothing;

-- ===========================================================================
--  Het dossier valt uiteen: identiteit apart van geld
--
--  Casper: "maar als leidinggevende een medewerker aanmaken, moeten hun ook
--  gewoon een BSN zien."
--
--  Dat kon niet, en niet omdat het dichtgezet was: personnel_private staat
--  sinds 0009 op "jezelf of het management", en een leidinggevende is geen
--  van beide. Wie iemand aanneemt kon dus zijn identiteitsgegevens niet
--  invullen.
--
--  Waarom de deur niet gewoon opengaat
--  -----------------------------------
--
--  In diezelfde tabel staan het rekeningnummer, het uurloon en de interne
--  notities van het management over die persoon. RLS werkt per rij en niet
--  per kolom: één policy verruimen betekent dat een leidinggevende ook ziet
--  wat zijn team verdient en wat er over hem is opgeschreven. Dat is niet
--  gevraagd, en het is precies het soort ding dat je pas merkt als iemand
--  het al gelezen heeft.
--
--  Dus valt het dossier uiteen langs de lijn die er altijd al in zat:
--
--    personnel_private   wie iemand is -- geboorte, document, BSN, noodgeval
--    personnel_loon      wat hij kost -- rekeningnummer, uurloon, notities
--
--  De eerste gaat open voor wie personeel mag inzien. De tweede houdt exact
--  de grens die het hele dossier had: jezelf, of het management.
--
--  Waarom op de ROL en niet op een recht
--  -------------------------------------
--
--  Voor de hand liggend zou heeft_recht('staff.view') zijn. Dat werkt niet,
--  en het werkt op een manier die je pas merkt als je het probeert: die
--  functie kijkt alleen naar de kolom grants -- de rechten die iemand LOS
--  heeft gekregen. Wat een rol standaard meebrengt staat in permissions.ts,
--  in de app, en daar weet de database niets van. Een leidinggevende heeft
--  staff.view via zijn rol, dus heeft_recht('staff.view') is voor hem
--  gewoon false.
--
--  Dus: is_supervisor() of is_management(), plus heeft_recht('staff.view')
--  voor wie het los toegekend kreeg. Niet is_lead(), want daar zit de
--  technische dienst in en die neemt geen mensen aan.
--
--  Het gevolg is wel dat een leidinggevende het dossier van een collega ook
--  kan wijzigen, niet alleen lezen. Dat volgt uit "een medewerker aanmaken":
--  wie het invult moet een typefout kunnen herstellen.
--
--  Wat dit betekent voor het apparaat
--  ----------------------------------
--
--  personnel_private synchroniseert mee. Leidinggevenden erbij laten betekent
--  dat er BSN's in de lokale opslag van hun tablet komen te staan. Dat is
--  bewust zo besloten; het staat hier zodat het een besluit blijft en geen
--  bijverschijnsel.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Wat iemand kost
--
--  De sleutel heet id, net als overal: de synchronisatie vergelijkt elke
--  binnengehaalde rij met de wachtrij op rij.id, voor alle tabellen zonder
--  uitzondering (zie 0044). Hij draagt dezelfde waarde als het dossier-id,
--  zodat de twee helften op elkaar aansluiten.
-- ---------------------------------------------------------------------------

create table if not exists public.personnel_loon (
  id             text primary key,
  user_id        text not null,
  iban           text,
  hourly_rate    numeric,
  /* Notities van het management. De medewerker ziet deze nooit -- daarom
     stonden ze niet in profiles.notes, en daarom staan ze nu hier en niet
     bij de identiteitsgegevens. */
  internal_notes text,
  updated_at     bigint not null default public.now_ms()
);

create index if not exists loon_user_idx on public.personnel_loon (user_id);

comment on table public.personnel_loon is
  'De geldkant van het personeelsdossier (0056): rekeningnummer, uurloon en '
  'interne notities. Apart van personnel_private omdat die sinds 0056 ook '
  'voor leidinggevenden te lezen is en dit niet.';

-- ---------------------------------------------------------------------------
--  Verhuizen wat er staat
--
--  Alleen als de kolommen er nog zijn. Wie deze migratie twee keer draait,
--  vindt ze de tweede keer niet meer -- en dan is er niets te verhuizen en
--  ook niets kapot te maken.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'personnel_private'
       and column_name = 'iban'
  ) then
    execute $v$
      insert into public.personnel_loon (id, user_id, iban, hourly_rate, internal_notes, updated_at)
      select p.id, p.user_id, p.iban, p.hourly_rate, p.internal_notes, p.updated_at
        from public.personnel_private p
       where p.iban is not null or p.hourly_rate is not null or p.internal_notes is not null
      on conflict (id) do nothing
    $v$;
    raise notice 'personnel_loon gevuld vanuit personnel_private';
  end if;
end $$;

/* En weg uit de oude tabel. Dit moet: zolang ze daar staan, ziet iedereen
   die het dossier mag lezen ze ook -- en dat is straks een grotere groep. */
alter table public.personnel_private drop column if exists iban;
alter table public.personnel_private drop column if exists hourly_rate;
alter table public.personnel_private drop column if exists internal_notes;

comment on table public.personnel_private is
  'De identiteitskant van het personeelsdossier: geboorte, document, BSN en '
  'noodcontact. Sinds 0056 ook te lezen en in te vullen door wie personeel '
  'mag inzien, zodat een leidinggevende iemand kan aannemen. Het geld staat '
  'in personnel_loon.';

-- ---------------------------------------------------------------------------
--  Wie mag wat
-- ---------------------------------------------------------------------------

alter table public.personnel_loon enable row level security;

/* De geldkant houdt exact de grens die het hele dossier had. */
drop policy if exists loon_select on public.personnel_loon;
create policy loon_select on public.personnel_loon for select to authenticated
  using (user_id = public.my_id() or public.is_management());

drop policy if exists loon_write on public.personnel_loon;
create policy loon_write on public.personnel_loon for all to authenticated
  using (public.is_management()) with check (public.is_management());

/* En de identiteitskant gaat open voor wie personeel mag inzien. */
drop policy if exists prive_select on public.personnel_private;
create policy prive_select on public.personnel_private for select to authenticated
  using (user_id = public.my_id()
         or public.is_management()
         or public.is_supervisor()
         or public.heeft_recht('staff.view'));

drop policy if exists prive_write on public.personnel_private;
create policy prive_write on public.personnel_private for all to authenticated
  using (public.is_management() or public.is_supervisor()
         or public.heeft_recht('staff.view'))
  with check (public.is_management() or public.is_supervisor()
              or public.heeft_recht('staff.view'));

-- ===========================================================================
--  Het grootboek komt uit Exact
--
--  Casper: "kan je er niet voor zorgen dat de grootboeken uit exact bij ons in
--  het systeem komen met de knop ophalen? Zodat alle dingen opkomen, ook moet
--  je zorgen dat ik ze kan verwijderen, in een categorie kan plaatsen ect.
--  Wel met bevestiging uiteraard. Zodat we echt een sync hebben ipv alles
--  handmatig oppakken."
--
--  In 0053 stond nog waarom het schema NIET werd overgenomen: public.grootboek
--  is met opzet kort (0044), en een administratie in Exact heeft er honderden.
--  Die zorg blijft staan -- maar het antwoord erop is niet "dan niet", het is
--  gereedschap. Overnemen wat je nodig hebt, weggooien wat je niet gebruikt,
--  en een categorie eromheen zodat een lange lijst toch te overzien is.
--
--  Wat een overname NIET doet
--  --------------------------
--
--  Bestaande regels aanraken. "Inkoop wasmiddelen en chemie" is een naam die
--  iemand hier heeft bedacht omdat de administratie hem zo herkent; in Exact
--  heet diezelfde rekening iets als "Kosten grond- en hulpstoffen". Een sync
--  die dat overschrijft, wist elke keer opnieuw het werk van de vorige keer
--  -- en dat merk je pas als je bij een bon de rekening niet meer terugvindt.
--
--  Dus: alleen toevoegen wat er nog niet is. Wat er staat blijft van ons.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De categorie
--
--  Vrije tekst en geen vaste lijst. Bij het overnemen wordt hij gevuld met
--  wat Exact van de rekening vindt (Kosten, Omzet, Balans...), maar dat is
--  een beginwaarde en geen wet: wie zijn kosten liever splitst in "wasstraat"
--  en "wagenpark" moet dat gewoon kunnen typen.
-- ---------------------------------------------------------------------------

alter table public.grootboek add column if not exists categorie text;

create index if not exists grootboek_categorie_idx
  on public.grootboek (categorie);

comment on column public.grootboek.categorie is
  'Vrije groepering om een lang rekeningschema te kunnen overzien (0057). '
  'Bij overnemen uit Exact gevuld met hun soort; daarna van ons.';

-- ---------------------------------------------------------------------------
--  Weggooien wat in gebruik is, hoort niet te kunnen
--
--  Een rekening verwijderen waarop al geboekt is, laat kostenposten achter
--  met een code die nergens meer naar wijst. Het scherm vraagt dit na
--  voordat het de knop aanbiedt, maar een scherm is geen slot: dezelfde
--  vraag hoort in de database te staan, want die is de enige die er altijd
--  bij is.
--
--  Geeft het aantal kostenposten dat op deze code staat. Nul betekent:
--  weggooien mag.
-- ---------------------------------------------------------------------------

create or replace function public.grootboek_in_gebruik(code_in text)
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.expenses e
   where e.grootboek_code = code_in;
$$;

revoke execute on function public.grootboek_in_gebruik(text) from public, anon;
grant  execute on function public.grootboek_in_gebruik(text) to service_role, authenticated;

comment on function public.grootboek_in_gebruik(text) is
  'Hoeveel kostenposten op deze grootboekcode staan (0057). Nul betekent dat '
  'de rekening weg mag; daarboven laat je kostenposten achter met een code '
  'die nergens meer naar wijst.';

-- ===========================================================================
--  Goedgekeurde facturen naar Exact
--
--  Casper: "uiteindelijk wil ik natuurlijk als er facturen goedgekeurd
--  worden, bij exact netjes komen, zodat we blue10 volledig weg kunnen halen.
--  Kan je dat wel alvast integreren, maar voor nu even uit laten zetten? bij
--  ontwikkelaar moet ik dat aan en uit kunnen zetten."
--
--  Dus: alles staat er, en er gaat niets. De schakelaar staat op uit, en
--  zolang die uit staat weigert de serverfunctie te versturen -- niet alleen
--  het scherm. Een knop die je verstopt is geen slot.
--
--  Wat een inkoopboeking bij Exact nodig heeft
--  -------------------------------------------
--
--  Drie dingen, en geen ervan is te verzinnen:
--
--    1. een DAGBOEK -- het inkoopdagboek, vaak 70. Staat in jullie eigen
--       administratie en verschilt per inrichting.
--    2. de LEVERANCIER als relatie in Exact. Een boeking wijst naar een
--       crediteur met een guid, niet naar "Shell Nederland" zoals het op de
--       bon staat. Daar is deze koppeltabel voor.
--    3. de BTW-CODE. 21% heet in Exact niet "21" maar een code die per
--       administratie kan verschillen.
--
--  Het rekeningschema was het vierde, en dat staat er al (0053/0057): een
--  boeking wijst naar de guid van de grootboekrekening, en die bewaren we
--  in exact_grootboek.exact_id.
--
--  Waarom de leverancier een eigen tabel krijgt
--  --------------------------------------------
--
--  expenses.supplier is vrije tekst van de factuur. Dezelfde leverancier
--  heet daar de ene keer "Shell Nederland Verkoopmij B.V." en de andere keer
--  "SHELL NEDERLAND VERKOOPMAATSCHAPPIJ BV". Op naam matchen tegen Exact
--  gaat dus soms goed en soms niet, en "soms" is bij een boeking niet goed
--  genoeg. Wat één keer met de hand is vastgelegd, blijft vastliggen.
--
--  Waar de crediteuren zelf staan
--  ------------------------------
--
--  In exact_relatie, en dat wordt in 0063 aangemaakt. Hier stond eerst een
--  eigen tabel exact_crediteur, die 0063 vervolgens weer weggooide omdat
--  klanten en crediteuren bij Exact in dezelfde lijst staan.
--
--  Die tabel bestond daarmee alleen tussen twee migraties in, en dat is
--  precies het soort tussenstand waar een half gedraaid bijwerkbestand op
--  stukloopt: "relation public.exact_crediteur does not exist", terwijl er
--  in het eindresultaat helemaal geen exact_crediteur hoort te zijn.
--
--  Dus is hij hier weggehaald. Het eindresultaat is hetzelfde en er is één
--  tussenstand minder om in te blijven steken.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De schakelaar en wat eromheen moet staan
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_exact_facturen', 'exact_facturen', 'uit',
   'Gaan goedgekeurde facturen naar Exact? "aan" of "uit". Staat standaard '
   'uit; de serverfunctie weigert te versturen zolang dat zo is.'),
  ('in_exact_dagboek', 'exact_dagboek', '',
   'Het inkoopdagboek in Exact waarin de boeking komt, vaak 70. Leeg = er '
   'wordt niets verstuurd, want Exact weigert een boeking zonder dagboek.'),
  ('in_exact_btw_21', 'exact_btw_21', '',
   'De btw-code in Exact voor het hoge tarief. Die code verschilt per '
   'administratie; hij is op te halen bij Exact zelf.'),
  ('in_exact_btw_9', 'exact_btw_9', '',
   'De btw-code in Exact voor het lage tarief.'),
  ('in_exact_btw_0', 'exact_btw_0', '',
   'De btw-code in Exact voor 0% of vrijgesteld.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  Welke leverancier op onze bon welke crediteur in Exact is
-- ---------------------------------------------------------------------------

create table if not exists public.exact_leverancier (
  /* De genormaliseerde naam van de bon. Zie kaal_bedrijf() hieronder. */
  zoeknaam   text primary key,
  /* Zoals hij op de bon stond toen de koppeling werd gemaakt -- puur om in
     het scherm te kunnen tonen waar dit vandaan kwam. */
  gezien_als text,
  exact_id   text not null,
  exact_naam text,
  bron       text not null default 'handmatig'
             check (bron in ('naam', 'handmatig')),
  door       text,
  updated_at bigint not null default public.now_ms()
);

comment on table public.exact_leverancier is
  'Welke leverancier op onze bon welke crediteur in Exact is (0058). Nodig '
  'voordat een factuur verstuurd kan worden: een boeking wijst naar een guid.';

-- ---------------------------------------------------------------------------
--  Namen vergelijkbaar maken
--
--  "Shell Nederland Verkoopmij B.V." en "SHELL NEDERLAND VERKOOPMAATSCHAPPIJ
--  BV" zijn dezelfde firma en verschillende teksten. Deze functie haalt eraf
--  wat niets zegt: hoofdletters, leestekens, en de rechtsvorm achteraan.
--
--  Bewust NIET slimmer dan dit. Een fuzzy match die "Van Dijk Transport" aan
--  "Van Dijk Verhuur" koppelt, boekt een factuur bij de verkeerde crediteur
--  -- en dat is precies de fout die niemand terugvindt. Wat hier niet
--  vanzelf matcht, koppelt een mens.
-- ---------------------------------------------------------------------------

create or replace function public.kaal_bedrijf(naam text)
returns text
language sql immutable as $$
  /*
   * Eerst de leestekens eruit, dan pas de rechtsvorm. Andersom ging het mis:
   * "B.V." aan het eind bleef staan omdat de woordgrens na de laatste punt
   * niet matcht, terwijl "bv" zonder punten wel werd afgehaald. Dan komen
   * twee schrijfwijzen van dezelfde firma dus NIET op elkaar uit -- en dat is
   * precies waar deze functie voor bestaat. De zelftest ving het.
   *
   * Daarom staat de rechtsvorm hieronder ook als "b\s*v": na het weghalen van
   * de punten is "B.V." veranderd in "b v".
   */
  select nullif(
    trim(regexp_replace(
      trim(regexp_replace(lower(coalesce(naam, '')), '[^a-z0-9]+', ' ', 'g')),
      '\s+(b\s*v\s*b\s*a|b\s*v|n\s*v|v\s*o\s*f|c\s*v|gmbh|ltd|inc|s\s*a)$',
      '', 'g')),
    '');
$$;

comment on function public.kaal_bedrijf(text) is
  'Een bedrijfsnaam zonder hoofdletters, leestekens en rechtsvorm (0058), '
  'zodat twee schrijfwijzen van dezelfde firma op elkaar uitkomen.';

-- ---------------------------------------------------------------------------
--  Wie mag dit zien
--
--  Administratiewerk: het management en wie achter de balie zit. Schrijven
--  doet geen mens -- de Edge Function werkt met de servicesleutel.
-- ---------------------------------------------------------------------------

alter table public.exact_leverancier enable row level security;

drop policy if exists exact_leverancier_select on public.exact_leverancier;
create policy exact_leverancier_select on public.exact_leverancier
  for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk')
         or public.heeft_recht('dev.logs'));

-- ---------------------------------------------------------------------------
--  En het soort werk erbij
-- ---------------------------------------------------------------------------

insert into public.exact_sync (soort) values ('facturen')
on conflict (soort) do nothing;

-- ---------------------------------------------------------------------------
--  Wat er klaarstaat om verstuurd te worden
--
--  Alles wat de serverfunctie nodig heeft in één vraag: de bon, de gekoppelde
--  crediteur en de guid van de grootboekrekening. Hier stond eerst een lus
--  die per bon apart kaal_bedrijf() vroeg -- bij tweehonderd bonnen zijn dat
--  tweehonderd heen-en-weertjes, en het zette dezelfde kennis op twee plekken.
-- ---------------------------------------------------------------------------

/* Eerst weg. "create or replace" mag de vorm van een tabelfunctie niet
   wijzigen, en 0059 zet er een kolom bij (administratie). Zonder deze regel
   valt dit bestand om zodra het na 0059 nog eens gedraaid wordt -- en elke
   migratie hier belooft dat dat mag. */
drop function if exists public.exact_facturen_wachtend();

create or replace function public.exact_facturen_wachtend()
returns table (
  id             text,
  leverancier    text,
  zoeknaam       text,
  factuurnummer  text,
  bedrag         numeric,
  btw_pct        integer,
  grootboek_code text,
  grootboek_id   text,
  crediteur_id   text,
  crediteur_naam text,
  datum          bigint,
  fout           text
)
language sql stable security definer set search_path = public as $$
  select e.id,
         coalesce(e.supplier, ''),
         public.kaal_bedrijf(e.supplier),
         e.factuurnummer,
         e.amount_excl,
         e.vat_pct,
         e.grootboek_code,
         g.exact_id,
         l.exact_id,
         l.exact_naam,
         e.expense_date,
         e.exact_fout
    from public.expenses e
    left join public.exact_leverancier l on l.zoeknaam = public.kaal_bedrijf(e.supplier)
    left join public.exact_grootboek   g on g.code     = e.grootboek_code
   where e.status = 'goedgekeurd'
     and e.exact_id is null
   order by e.expense_date
   limit 200;
$$;

revoke execute on function public.exact_facturen_wachtend() from public, anon, authenticated;
grant  execute on function public.exact_facturen_wachtend() to service_role;

-- ===========================================================================
--  Meerdere bv's, elk met een eigen grootboek
--
--  Casper: "Ik heb in exact meerdere bv's, die hebben ook allemaal een eigen
--  grootboekrekening, fix dit."
--
--  Alles wat er tot nu toe staat gaat uit van één administratie. De koppeling
--  bewaart één division, het rekeningschema is één lijst, en een boeking gaat
--  naar "de" administratie. Dat klopt niet meer, en het klopt op een manier
--  die stil misgaat: rekening 4000 bestaat in elke bv en betekent er iets
--  anders. Een factuur van de wasstraat op de 4000 van de holding boeken
--  levert geen foutmelding op -- alleen een verkeerde boeking.
--
--  Daarom eerst dit, en pas daarna de rest. Elke andere stap (tweede
--  goedkeuring, splitsen, verkoopfacturen, betalingen) hangt aan de vraag "in
--  welke bv gebeurt dit", en die vraag moet één keer goed beantwoord zijn.
--
--  Wat er verandert
--  ----------------
--
--    exact_administratie   de bv's die Exact kent, en welke wij gebruiken
--    grootboek             krijgt een administratie; code is niet meer uniek
--                          op zichzelf maar samen met de bv
--    locations             weet bij welke bv hij hoort
--    exact_grootboek       per administratie in plaats van één lijst
--
--  Waarom de bv op de vestiging en niet op de bon
--  ----------------------------------------------
--
--  Een kostenpost weet al bij welke vestiging hij hoort, en een vestiging
--  hoort bij één bv. De bv op de bon zetten zou dat verdubbelen, en dan is er
--  een dag waarop die twee iets anders zeggen. Verhuist een vestiging ooit
--  naar een andere bv, dan is dat één veld -- en oude bonnen die al geboekt
--  zijn dragen hun boekingsnummer en veranderen niet meer.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De administraties
-- ---------------------------------------------------------------------------

create table if not exists public.exact_administratie (
  /* Het divisienummer van Exact. Dit staat in elk API-adres. */
  code       text primary key,
  naam       text not null default '',
  /* Doen we hier iets mee? Een administratie waar wij niets in boeken hoeft
     ook niet elke ophaalronde mee. */
  actief     boolean not null default false,
  /* De administratie waar iets in valt dat nergens anders bij hoort. */
  hoofd      boolean not null default false,
  updated_at bigint not null default public.now_ms()
);

comment on table public.exact_administratie is
  'De bv''s zoals Exact ze kent (0059). actief bepaalt of we er iets mee doen; '
  'hoofd is de terugval voor wat nergens anders bij hoort.';

/* Er kan er maar één de hoofdadministratie zijn. Twee zou betekenen dat de
   terugval afhangt van de volgorde waarin je toevallig leest. */
create unique index if not exists exact_administratie_een_hoofd
  on public.exact_administratie ((hoofd)) where hoofd;

-- ---------------------------------------------------------------------------
--  Het rekeningschema per bv
--
--  exact_grootboek was een lijst met de code als sleutel. Nu hoort dezelfde
--  code in elke administratie thuis, met een eigen omschrijving en een eigen
--  guid. Het is een kopie die bij elke ophaalronde opnieuw wordt gevuld, dus
--  hem leegmaken kost niets.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
     where table_schema = 'public' and table_name = 'exact_grootboek'
       and constraint_type = 'PRIMARY KEY' and constraint_name = 'exact_grootboek_pkey'
  ) and not exists (
    select 1 from information_schema.key_column_usage
     where table_schema = 'public' and table_name = 'exact_grootboek'
       and constraint_name = 'exact_grootboek_pkey' and column_name = 'division'
  ) then
    /* Leeg is goed: de eerstvolgende ophaalronde vult hem opnieuw, en dan
       meteen met de administratie erbij. */
    delete from public.exact_grootboek;
    alter table public.exact_grootboek drop constraint exact_grootboek_pkey;
    alter table public.exact_grootboek alter column division set not null;
    alter table public.exact_grootboek add primary key (division, code);
    raise notice 'exact_grootboek is nu per administratie';
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  Ons eigen grootboek per bv
--
--  Dit is de kern van de vraag. Rekening 4000 bestaat in elke bv en betekent
--  er iets anders, dus "code" alleen is geen sleutel meer.
--
--  Bestaande regels krijgen geen administratie: die stonden er toen er nog
--  één was. Ze blijven werken als "geldt overal", tot iemand ze toewijst.
--  Dat is met opzet -- ze stilzwijgend aan de hoofdadministratie hangen zou
--  een keuze zijn die niemand heeft gemaakt.
-- ---------------------------------------------------------------------------

alter table public.grootboek add column if not exists administratie text;

/*
 * Eerst de verwijzing eruit die eraan hangt.
 *
 * leverancier_boeking.grootboek_code verwees naar grootboek(code) -- het
 * geheugen "deze leverancier boekt meestal op 4031". Dat kan niet blijven
 * zodra dezelfde code in meerdere bv's bestaat: er is dan geen één rij meer
 * om naar te wijzen.
 *
 * En dat hoeft ook niet. Het geheugen onthoudt een CODE, niet een rij; welke
 * bv erbij hoort komt van de vestiging op de bon. "Enexis boekt op 4010" is
 * waar in elke administratie.
 *
 * Wat we ermee kwijtraken is "on delete set null": gooi je een rekening weg,
 * dan blijft die code in het geheugen staan. Dat is te overzien -- het
 * geheugen is een suggestie, en factuur_indelen() zoekt de code alsnog op.
 * 0057 laat een rekening waarop geboekt is bovendien niet weggooien.
 */
do $$
declare c text;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     t on t.oid = con.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'leverancier_boeking'
       and con.contype = 'f'
  loop
    execute format('alter table public.leverancier_boeking drop constraint %I', c);
    raise notice 'verwijzing van leverancier_boeking naar grootboek weg: %', c;
  end loop;
end $$;

/*
 * De oude "uniek op code" eraf, hoe hij ook heet.
 *
 * In 0044 staat hij als "code text not null unique" in de tabeldefinitie, en
 * dan verzint Postgres de naam. Meestal grootboek_code_key, maar daarop
 * gokken is precies het soort aanname dat pas opvalt als er twee bv's zijn en
 * de tweede zijn eigen 4000 niet kwijt kan. Dus opzoeken.
 */
do $$
declare c text;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     t on t.oid = con.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'grootboek'
       and con.contype = 'u'
       and array_length(con.conkey, 1) = 1
       and (select a.attname from pg_attribute a
             where a.attrelid = t.oid and a.attnum = con.conkey[1]) = 'code'
  loop
    execute format('alter table public.grootboek drop constraint %I', c);
    raise notice 'oude unieke sleutel op grootboek.code weg: %', c;
  end loop;
end $$;

/* Uniek per bv. Een lege administratie telt als zijn eigen groep, zodat de
   oude regels ("geldt overal") elkaar nog steeds niet dubbel kunnen zijn. */
create unique index if not exists grootboek_code_per_bv
  on public.grootboek (coalesce(administratie, ''), code);

comment on column public.grootboek.administratie is
  'In welke bv deze rekening geldt (0059). Leeg = geldt overal, zoals het was '
  'voordat er meer dan één administratie was.';

-- ---------------------------------------------------------------------------
--  Welke vestiging in welke bv zit
-- ---------------------------------------------------------------------------

alter table public.locations add column if not exists administratie text;

comment on column public.locations.administratie is
  'In welke bv deze vestiging boekt (0059). Leeg = de hoofdadministratie.';

-- ---------------------------------------------------------------------------
--  Wie mag de administraties zien
-- ---------------------------------------------------------------------------

alter table public.exact_administratie enable row level security;

drop policy if exists exact_administratie_select on public.exact_administratie;
create policy exact_administratie_select on public.exact_administratie
  for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk')
         or public.heeft_recht('dev.logs'));

-- ---------------------------------------------------------------------------
--  In welke bv hoort deze bon
--
--  Via de vestiging, met de hoofdadministratie als terugval. Eén plek, want
--  deze vraag komt straks op drie plekken terug -- bij het boeken, bij het
--  tonen en bij het controleren of de rekening wel bestaat.
-- ---------------------------------------------------------------------------

create or replace function public.bon_administratie(expense_in text)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(trim(l.administratie), '')
       from public.expenses e
       left join public.locations l on l.id = e.location_id
      where e.id = expense_in),
    (select a.code from public.exact_administratie a where a.hoofd limit 1)
  );
$$;

revoke execute on function public.bon_administratie(text) from public, anon;
grant  execute on function public.bon_administratie(text) to service_role, authenticated;

comment on function public.bon_administratie(text) is
  'In welke bv deze kostenpost geboekt wordt (0059): die van zijn vestiging, '
  'anders de hoofdadministratie.';

-- ---------------------------------------------------------------------------
--  En de wachtrij kijkt nu ook naar de administratie
--
--  De grootboekrekening moet in DIE bv bestaan. Rekening 4000 van de holding
--  is niet de 4000 van de wasstraat, en zonder deze voorwaarde zou hij de
--  eerste de beste pakken.
-- ---------------------------------------------------------------------------

/* Eerst weg: "create or replace" mag de vorm van een tabelfunctie niet
   wijzigen, en er komt een kolom bij (administratie). Zonder deze regel valt
   de hele migratie om met "cannot change return type of existing function" --
   en dan is er ook niets anders gedraaid. */
drop function if exists public.exact_facturen_wachtend();

create or replace function public.exact_facturen_wachtend()
returns table (
  id             text,
  leverancier    text,
  zoeknaam       text,
  factuurnummer  text,
  bedrag         numeric,
  btw_pct        integer,
  grootboek_code text,
  grootboek_id   text,
  crediteur_id   text,
  crediteur_naam text,
  administratie  text,
  datum          bigint,
  fout           text
)
language sql stable security definer set search_path = public as $$
  with bonnen as (
    select e.*, public.bon_administratie(e.id) as adm
      from public.expenses e
     where e.status = 'goedgekeurd'
       and e.exact_id is null
  )
  select b.id,
         coalesce(b.supplier, ''),
         public.kaal_bedrijf(b.supplier),
         b.factuurnummer,
         b.amount_excl,
         b.vat_pct,
         b.grootboek_code,
         g.exact_id,
         l.exact_id,
         l.exact_naam,
         b.adm,
         b.expense_date,
         b.exact_fout
    from bonnen b
    left join public.exact_leverancier l on l.zoeknaam = public.kaal_bedrijf(b.supplier)
    left join public.exact_grootboek   g on g.code = b.grootboek_code
                                        and g.division = b.adm
   order by b.expense_date
   limit 200;
$$;

revoke execute on function public.exact_facturen_wachtend() from public, anon, authenticated;
grant  execute on function public.exact_facturen_wachtend() to service_role;

-- ===========================================================================
--  Vier ogen: één die kijkt, één die tekent
--
--  Casper: "Daarnaast moet je zorgen dat je na de eerste check van een
--  factuur ect, ook een tweede persoon moet hebben om hem goed te keuren."
--
--  Dat is de gewoonte die in elk factuurpakket zit, en de reden ervoor is
--  saai maar hard: hier gaat geld weg. Eén iemand die zich vergist, of eén
--  iemand die het niet zo nauw neemt, is bij één handtekening genoeg.
--
--  Hoe het loopt
--  -------------
--
--    open              er is nog niemand langs geweest
--    eerste_akkoord    één iemand heeft hem nagekeken
--    goedgekeurd       een TWEEDE iemand heeft getekend
--    afgekeurd         iemand heeft hem tegengehouden
--
--  Afkeuren kan in elke stand en door één iemand. Dat is geen inconsistentie:
--  tegenhouden kan geen kwaad, doorlaten wel.
--
--  Waarom de tweede handtekening in de database wordt bewaakt
--  ---------------------------------------------------------
--
--  Het scherm kan de knop verbergen voor wie al getekend heeft. Maar de app
--  praat rechtstreeks met de database, en een wijziging die via de wachtrij
--  binnenkomt heeft geen scherm gezien. De regel "niet twee keer dezelfde
--  persoon" hoort dus hier te staan, waar hij altijd geldt.
--
--  De drempel
--  ----------
--
--  Standaard nul: alles langs twee mensen. Er staat een bedrag naast, want
--  bij een parkeerbon van drie euro is twee handtekeningen geen zorgvuldigheid
--  maar een rem. Wie dat wil, zet hem hoger; wie het zo wil houden, doet
--  niets.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De nieuwe stand
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.expenses drop constraint if exists expenses_status_check;
  alter table public.expenses add constraint expenses_status_check
    check (status in ('open', 'eerste_akkoord', 'goedgekeurd', 'afgekeurd'));
exception when others then
  raise notice 'status-controle niet gezet: %', sqlerrm;
end $$;

alter table public.expenses add column if not exists eerste_door      text;
alter table public.expenses add column if not exists eerste_door_naam text;
alter table public.expenses add column if not exists eerste_at        bigint;

comment on column public.expenses.eerste_door is
  'Wie als eerste akkoord gaf (0060). De tweede handtekening moet van iemand '
  'anders komen; dat wordt door een trigger bewaakt en niet door het scherm.';

-- ---------------------------------------------------------------------------
--  De instellingen
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_vier_ogen', 'vier_ogen', 'ja',
   'Moet een factuur langs twee mensen voordat hij is goedgekeurd? "ja" of '
   '"nee". Staat standaard aan.'),
  ('in_vier_ogen_vanaf', 'vier_ogen_vanaf', '0',
   'Bedrag exclusief btw waarboven twee handtekeningen nodig zijn. Nul '
   'betekent: altijd. Bij een parkeerbon van drie euro is twee keer tekenen '
   'geen zorgvuldigheid maar een rem.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  Geldt vier ogen voor deze bon?
-- ---------------------------------------------------------------------------

create or replace function public.vier_ogen_nodig(bedrag_in numeric)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
           (select lower(trim(i.waarde)) from public.instellingen i
             where i.sleutel = 'vier_ogen'), 'ja') = 'ja'
     and coalesce(bedrag_in, 0) >= coalesce(
           (select nullif(trim(i.waarde), '')::numeric from public.instellingen i
             where i.sleutel = 'vier_ogen_vanaf'), 0);
$$;

revoke execute on function public.vier_ogen_nodig(numeric) from public, anon;
grant  execute on function public.vier_ogen_nodig(numeric) to service_role, authenticated;

-- ---------------------------------------------------------------------------
--  De bewaking
--
--  Twee regels, en allebei alleen als vier ogen aanstaat:
--
--    1. van open naar goedgekeurd in één stap mag niet. Er hoort een
--       eerste_akkoord tussen te zitten.
--    2. de tweede handtekening mag niet van dezelfde persoon zijn als de
--       eerste. Dat is het hele punt.
--
--  Wat er automatisch is goedgekeurd (0050) valt hier buiten regel 1: dat
--  zet zichzelf op eerste_akkoord en laat de tweede aan een mens. Zie de
--  Edge Function; hier wordt alleen bewaakt dat het niet ineens doorschiet.
-- ---------------------------------------------------------------------------

create or replace function public.expenses_vier_ogen()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'goedgekeurd' then
    return new;
  end if;
  if coalesce(old.status, 'open') = 'goedgekeurd' then
    return new;  -- was al goed; hier verandert iets anders
  end if;
  if not public.vier_ogen_nodig(new.amount_excl) then
    return new;
  end if;

  if coalesce(old.status, 'open') = 'open' then
    raise exception 'Deze factuur moet eerst door iemand anders worden nagekeken '
                    '(vier ogen staat aan).'
      using errcode = 'check_violation';
  end if;

  if new.eerste_door is not null
     and new.approved_by is not null
     and new.eerste_door = new.approved_by then
    raise exception 'De tweede handtekening moet van iemand anders komen dan de eerste.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists expenses_vier_ogen_trg on public.expenses;
create trigger expenses_vier_ogen_trg
  before update on public.expenses
  for each row execute function public.expenses_vier_ogen();

comment on function public.expenses_vier_ogen() is
  'Bewaakt dat een factuur langs twee verschillende mensen gaat (0060). Staat '
  'in de database en niet in het scherm: de app praat rechtstreeks met de '
  'database, en een wijziging uit de wachtrij heeft geen scherm gezien.';

-- ===========================================================================
--  De historie van een factuur, en notities erbij
--
--  Casper: "je moet de historie zien van dat factuur, goed kunnen zoeken,
--  notities erbij zetten".
--
--  Er wás al een tijdlijn in het scherm, maar die werd afgeleid uit de velden
--  op de bon: binnengekomen, voorgelezen, goedgekeurd. Dat werkt zolang er
--  drie momenten zijn en elk moment zijn eigen kolom heeft. Zodra iemand een
--  bedrag corrigeert, een rekening omzet of een tweede handtekening zet, is
--  er niets meer wat dat onthoudt -- en juist dát is wat je wilt terugzien
--  als een boeking achteraf niet klopt.
--
--  Waarom een trigger en niet de app
--  ---------------------------------
--
--  Omdat er drie wegen naar een kostenpost lopen. De app (via de wachtrij),
--  de post die een factuur binnenhaalt, en de lezer die hem invult. Alle drie
--  zouden ze netjes een regel moeten schrijven, en op een dag doet er een dat
--  niet -- en dan mist er een gebeurtenis zonder dat iemand het merkt.
--
--  Een trigger ziet alles, ook wat langs de wachtrij binnenkomt. Wat hij niet
--  ziet is WAAROM iets veranderde; daar zijn de notities voor.
--
--  Wat er NIET in komt
--  -------------------
--
--  Elke wijziging van elk veld. Dat levert een lijst op waar niemand
--  doorheen komt, met tien regels "updated_at gewijzigd" per bon. Alleen wat
--  ertoe doet: de stand, het bedrag, de rekening, de leverancier, het
--  factuurnummer, en de gang naar Exact.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Wat er gebeurd is
-- ---------------------------------------------------------------------------

create table if not exists public.expense_gebeurtenis (
  /* De sleutel heet id, zoals overal: de synchronisatie vergelijkt elke
     binnengehaalde rij met de wachtrij op rij.id (zie 0044). */
  id          text primary key,
  expense_id  text not null,
  at          bigint not null default public.now_ms(),
  /* Wat voor gebeurtenis. 'notitie' is de enige die een mens zelf maakt; de
     rest schrijft de trigger. */
  soort       text not null
              check (soort in ('aangemaakt', 'gewijzigd', 'eerste_akkoord',
                               'goedgekeurd', 'afgekeurd', 'heropend',
                               'notitie', 'naar_exact')),
  tekst       text not null default '',
  /* Bij 'gewijzigd': welk veld, en van wat naar wat. Als tekst bewaard, want
     het gaat om lezen en niet om rekenen. */
  veld        text,
  oud         text,
  nieuw       text,
  door        text,
  door_naam   text,
  updated_at  bigint not null default public.now_ms()
);

create index if not exists gebeurtenis_bon_idx
  on public.expense_gebeurtenis (expense_id, at);

comment on table public.expense_gebeurtenis is
  'De historie van een kostenpost (0061): standwijzigingen, correcties, de '
  'gang naar Exact, en notities. Grotendeels geschreven door een trigger, '
  'want er lopen drie wegen naar een bon en er zou er altijd een vergeten.';

-- ---------------------------------------------------------------------------
--  De trigger
--
--  Alleen wat ertoe doet. Bij een stand die verandert een regel met die
--  stand als soort; bij de vier velden waar het geld aan hangt een regel
--  'gewijzigd' met van-en-naar erbij.
--
--  Wie het deed: my_id() als het uit de app komt, en anders niets -- dan
--  staat er in het scherm "door het systeem", wat eerlijker is dan een naam
--  verzinnen.
-- ---------------------------------------------------------------------------

create or replace function public.expense_gebeurtenis_schrijf()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  wie   text := public.my_id();
  naam  text;
  nieuw_id text;
begin
  if wie is not null then
    select p.name into naam from public.profiles p where p.id::text = wie;
  end if;

  /* --- de stand --- */
  if tg_op = 'INSERT' then
    insert into public.expense_gebeurtenis (id, expense_id, soort, tekst, door, door_naam)
    values (new.id || '_aan', new.id, 'aangemaakt',
            coalesce(nullif(new.source, ''), 'app'), wie, naam)
    on conflict (id) do nothing;
    return new;
  end if;

  if new.status is distinct from old.status then
    nieuw_id := new.id || '_' || new.status || '_' || public.now_ms()::text;
    insert into public.expense_gebeurtenis (id, expense_id, soort, tekst, door, door_naam)
    values (
      nieuw_id, new.id,
      case new.status
        when 'eerste_akkoord' then 'eerste_akkoord'
        when 'goedgekeurd'    then 'goedgekeurd'
        when 'afgekeurd'      then 'afgekeurd'
        else 'heropend'
      end,
      coalesce(
        case when new.status = 'afgekeurd' then new.reject_reason
             when new.status = 'goedgekeurd' then new.goedkeuring_reden
        end, ''),
      coalesce(new.approved_by, new.eerste_door, wie),
      coalesce(new.approved_by_name, new.eerste_door_naam, naam))
    on conflict (id) do nothing;
  end if;

  /* --- naar Exact --- */
  if new.exact_id is not null and old.exact_id is null then
    insert into public.expense_gebeurtenis (id, expense_id, soort, tekst, door, door_naam)
    values (new.id || '_exact', new.id, 'naar_exact',
            'Boeking ' || new.exact_id, wie, naam)
    on conflict (id) do nothing;
  end if;

  /* --- de vier velden waar het geld aan hangt --- */
  if new.amount_excl is distinct from old.amount_excl then
    insert into public.expense_gebeurtenis (id, expense_id, soort, veld, oud, nieuw, door, door_naam)
    values (new.id || '_bedrag_' || public.now_ms()::text, new.id, 'gewijzigd',
            'bedrag', old.amount_excl::text, new.amount_excl::text, wie, naam)
    on conflict (id) do nothing;
  end if;

  if new.grootboek_code is distinct from old.grootboek_code then
    insert into public.expense_gebeurtenis (id, expense_id, soort, veld, oud, nieuw, door, door_naam)
    values (new.id || '_rek_' || public.now_ms()::text, new.id, 'gewijzigd',
            'grootboekrekening', old.grootboek_code, new.grootboek_code, wie, naam)
    on conflict (id) do nothing;
  end if;

  if new.supplier is distinct from old.supplier then
    insert into public.expense_gebeurtenis (id, expense_id, soort, veld, oud, nieuw, door, door_naam)
    values (new.id || '_lev_' || public.now_ms()::text, new.id, 'gewijzigd',
            'leverancier', old.supplier, new.supplier, wie, naam)
    on conflict (id) do nothing;
  end if;

  if new.factuurnummer is distinct from old.factuurnummer then
    insert into public.expense_gebeurtenis (id, expense_id, soort, veld, oud, nieuw, door, door_naam)
    values (new.id || '_nr_' || public.now_ms()::text, new.id, 'gewijzigd',
            'factuurnummer', old.factuurnummer, new.factuurnummer, wie, naam)
    on conflict (id) do nothing;
  end if;

  return new;
end $$;

drop trigger if exists expense_gebeurtenis_trg on public.expenses;
create trigger expense_gebeurtenis_trg
  after insert or update on public.expenses
  for each row execute function public.expense_gebeurtenis_schrijf();

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  Lezen: wie de kostenposten mag zien. Schrijven: alleen notities, en
--  alleen op eigen naam -- een regel in de historie op naam van een collega
--  zetten maakt de hele historie waardeloos.
--
--  Wijzigen en weggooien kan niemand. Een spoor dat je kunt bijschaven is
--  geen spoor; dezelfde afspraak als bij expenses.gelezen (0049).
-- ---------------------------------------------------------------------------

alter table public.expense_gebeurtenis enable row level security;

drop policy if exists gebeurtenis_select on public.expense_gebeurtenis;
create policy gebeurtenis_select on public.expense_gebeurtenis
  for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk')
         or public.heeft_recht('expenses.read') or public.heeft_recht('expenses.approve')
         or exists (select 1 from public.expenses e
                     where e.id = expense_id and e.submitted_by = public.my_id()));

drop policy if exists gebeurtenis_insert on public.expense_gebeurtenis;
create policy gebeurtenis_insert on public.expense_gebeurtenis
  for insert to authenticated
  /* rij_bestaat() staat vooraan om dezelfde reden als overal: een upsert
     langs PostgREST beoordeelt deze insert-regel OOK als de rij al bestaat,
     en dan wordt een gewone wijziging geweigerd met "new row violates
     row-level security policy". Zie 0044. */
  with check (public.rij_bestaat('public.expense_gebeurtenis'::regclass, id)
              or (soort = 'notitie' and door = public.my_id()));

-- ===========================================================================
--  Een factuur splitsen
--
--  Casper: "notities erbij zetten, splitsen, koppelen ect."
--
--  Eén factuur, meerdere regels. De rekening van Enexis is voor drie
--  vestigingen; de bon van de groothandel staat half op wasmiddelen en half
--  op klein materiaal. Tot nu toe kon dat niet: een kostenpost had één bedrag
--  en één grootboekrekening, en wie het wilde splitsen moest hem twee keer
--  invoeren -- met twee keer hetzelfde factuurnummer, wat de dubbelcontrole
--  juist tegenhoudt.
--
--  Hoe het werkt
--  -------------
--
--  Geen regels = zoals het was. Het bedrag en de rekening op de bon zelf
--  zijn dan de boeking. Dat is verreweg het meeste, en dat moet simpel
--  blijven.
--
--  Wél regels = de bon is de optelsom. Het bedrag op de bon blijft leidend --
--  dat is wat de leverancier vraagt -- en de regels moeten daarop uitkomen.
--
--  Waarom het optellen pas bij het goedkeuren wordt afgedwongen
--  -----------------------------------------------------------
--
--  Omdat je een splitsing opbouwt. Zet je de eis op elke regel die je
--  toevoegt, dan klopt hij per definitie niet zolang je bezig bent, en dan is
--  het onmogelijk om er een tweede regel bij te typen.
--
--  Bij het goedkeuren is het wél de vraag die telt: gaat er straks precies
--  het bedrag naar de boekhouding dat er op de factuur staat? Een verschil
--  van een cent is daar geen detail maar een boeking die niet sluit.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De regels
-- ---------------------------------------------------------------------------

create table if not exists public.expense_regel (
  /* De sleutel heet id, zoals overal (zie 0044). */
  id             text primary key,
  expense_id     text not null,
  /* Waar hij in de lijst staat. Niet af te leiden uit de tijd: iemand voegt
     er later een regel tussen. */
  volgorde       integer not null default 0,
  omschrijving   text not null default '',
  bedrag_excl    numeric not null default 0,
  btw_pct        integer not null default 21,
  grootboek_code text,
  /* De kostenplaats: welke vestiging deze regel draagt. Leeg = die van de
     bon zelf. Zo is één energierekening over drie vestigingen te verdelen. */
  location_id    text,
  updated_at     bigint not null default public.now_ms()
);

create index if not exists expense_regel_bon_idx
  on public.expense_regel (expense_id, volgorde);

comment on table public.expense_regel is
  'De regels van een gesplitste factuur (0062). Geen regels betekent: het '
  'bedrag en de rekening op de bon zelf zijn de boeking.';

-- ---------------------------------------------------------------------------
--  Wat er nog aan ontbreekt
--
--  Geeft het verschil tussen de optelsom van de regels en het bedrag op de
--  bon. Nul betekent dat het sluit; er zijn ook nul regels, en dan is er
--  niets te sluiten -- vandaar dat de functie null geeft als er geen regels
--  zijn, en dat is iets anders dan een verschil van nul.
-- ---------------------------------------------------------------------------

create or replace function public.expense_regels_verschil(expense_in text)
returns numeric
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.expense_regel r where r.expense_id = expense_in)
      then null
    else coalesce((select sum(r.bedrag_excl) from public.expense_regel r
                    where r.expense_id = expense_in), 0)
       - coalesce((select e.amount_excl from public.expenses e where e.id = expense_in), 0)
  end;
$$;

revoke execute on function public.expense_regels_verschil(text) from public, anon;
grant  execute on function public.expense_regels_verschil(text) to service_role, authenticated;

-- ---------------------------------------------------------------------------
--  Een splitsing die niet sluit gaat niet door
--
--  Bij het goedkeuren, en niet eerder. Zie de kop: een splitsing bouw je op,
--  en tussentijds klopt hij per definitie niet.
--
--  Dit hangt aan dezelfde trigger-plek als vier ogen (0060) maar is een eigen
--  functie: het zijn twee verschillende vragen, en samengevoegd zou de
--  foutmelding niet meer zeggen welke van de twee het was.
-- ---------------------------------------------------------------------------

create or replace function public.expenses_regels_sluiten()
returns trigger
language plpgsql security definer set search_path = public as $$
declare verschil numeric;
begin
  if new.status not in ('eerste_akkoord', 'goedgekeurd') then
    return new;
  end if;
  if coalesce(old.status, 'open') = new.status then
    return new;
  end if;

  verschil := public.expense_regels_verschil(new.id);
  if verschil is null then
    return new;  -- geen regels: niets te sluiten
  end if;

  if abs(verschil) >= 0.005 then
    raise exception 'De regels tellen op tot % te %, en dan sluit de boeking niet.',
      abs(round(verschil, 2)),
      case when verschil > 0 then 'veel' else 'weinig' end
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists expenses_regels_sluiten_trg on public.expenses;
create trigger expenses_regels_sluiten_trg
  before update on public.expenses
  for each row execute function public.expenses_regels_sluiten();

-- ---------------------------------------------------------------------------
--  Een geboekte factuur splitst niet meer
--
--  Zodra hij in Exact staat, staat de boeking daar. Onze regels daarna nog
--  wijzigen betekent dat de twee iets anders zeggen, en dan is er geen manier
--  meer om te weten welke klopt.
-- ---------------------------------------------------------------------------

create or replace function public.expense_regel_op_slot()
returns trigger
language plpgsql security definer set search_path = public as $$
declare bon_id text := coalesce(new.expense_id, old.expense_id);
begin
  if exists (select 1 from public.expenses e
              where e.id = bon_id and e.exact_id is not null) then
    raise exception 'Deze factuur staat al in Exact; de verdeling kan niet meer wijzigen.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists expense_regel_op_slot_trg on public.expense_regel;
create trigger expense_regel_op_slot_trg
  before insert or update or delete on public.expense_regel
  for each row execute function public.expense_regel_op_slot();

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  Dezelfde grens als de bon zelf: wie over kosten mag beslissen, en de
--  indiener zolang de bon nog open staat.
-- ---------------------------------------------------------------------------

alter table public.expense_regel enable row level security;

drop policy if exists expense_regel_select on public.expense_regel;
create policy expense_regel_select on public.expense_regel for select to authenticated
  using (public.mag_kosten_beslissen()
         or exists (select 1 from public.expenses e
                     where e.id = expense_id and e.submitted_by = public.my_id()));

drop policy if exists expense_regel_insert on public.expense_regel;
create policy expense_regel_insert on public.expense_regel for insert to authenticated
  /* rij_bestaat() vooraan, want een upsert langs PostgREST beoordeelt deze
     regel ook als de rij al bestaat -- zie 0044. */
  with check (public.rij_bestaat('public.expense_regel'::regclass, id)
              or public.mag_kosten_beslissen()
              or exists (select 1 from public.expenses e
                          where e.id = expense_id and e.submitted_by = public.my_id()
                            and e.status = 'open'));

drop policy if exists expense_regel_update on public.expense_regel;
create policy expense_regel_update on public.expense_regel for update to authenticated
  using (public.mag_kosten_beslissen()
         or exists (select 1 from public.expenses e
                     where e.id = expense_id and e.submitted_by = public.my_id()
                       and e.status = 'open'))
  with check (public.mag_kosten_beslissen()
              or exists (select 1 from public.expenses e
                          where e.id = expense_id and e.submitted_by = public.my_id()
                            and e.status = 'open'));

drop policy if exists expense_regel_delete on public.expense_regel;
create policy expense_regel_delete on public.expense_regel for delete to authenticated
  using (public.mag_kosten_beslissen());

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

/* Voor wie 0058 heeft gedraaid toen die nog een eigen exact_crediteur
   aanmaakte: die kopie kan weg. Hij werd bij elke ophaalronde opnieuw
   gevuld en staat nu in exact_relatie. exact_leverancier blijft staan --
   daar zitten de koppelingen in die met de hand zijn gelegd.

   Sinds de herziening maakt 0058 hem niet meer aan; deze regel staat er nog
   voor databases die er al een hebben. "if exists" doet de rest. */
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

/* Idem: hij werkte op exact_crediteur en bestaat sinds de herziening van
   0058 niet meer. Weg als hij er nog is. */
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

-- ===========================================================================
--  Verkoopfacturen: de andere kant van de factuurstroom
--
--  Casper: "Bij een factuur moet je zowel inkomend als uitkomend nadenken,
--  pas dit dan ook toe."
--
--  Tot nu toe kende dit systeem alleen de inkomende kant. Aan de klantzijde
--  stond wel een scherm "Facturen", maar dat was een BEREKENING: alle
--  gereedgemelde wasbeurten van een maand bij elkaar opgeteld. Handig om te
--  zien, en geen factuur -- er is geen nummer, geen datum, geen bedrag dat
--  vastligt, en dus ook niets om aan een betaling te koppelen of naar Exact
--  te sturen.
--
--  Waarom een berekening geen factuur is
--  -------------------------------------
--
--  Omdat een factuur een moment vastlegt. Wordt er na het versturen een
--  wasbeurt bijgeboekt of een prijs gecorrigeerd, dan verandert de berekening
--  mee en klopt hij niet meer met het papier dat de klant heeft. Daarom
--  worden de regels bij het opmaken overgenomen en niet later nog eens
--  uitgerekend.
--
--  Eén wasbeurt, één factuur
--  -------------------------
--
--  De belangrijkste regel hier. Zonder slot komt dezelfde wasbeurt op de
--  factuur van maart en die van april -- en dan heb je hem twee keer in
--  rekening gebracht bij een klant die dat wél opmerkt. Vandaar de unieke
--  index op de wasbeurt in de regels.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De nummering
--
--  Per administratie en per jaar, zoals een boekhouding het wil. Een eigen
--  tabelletje en niet max()+1 op de facturen: twee mensen die op hetzelfde
--  moment een factuur opmaken zouden dan hetzelfde nummer krijgen, en dat is
--  precies het geval waarin het niemand opvalt tot de accountant belt.
-- ---------------------------------------------------------------------------

create table if not exists public.verkoop_nummering (
  administratie text not null,
  jaar          integer not null,
  laatste       integer not null default 0,
  primary key (administratie, jaar)
);

create or replace function public.volgend_verkoopnummer(administratie_in text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  jr   integer := extract(year from now())::integer;
  vlgn integer;
begin
  insert into public.verkoop_nummering (administratie, jaar, laatste)
  values (coalesce(nullif(trim(administratie_in), ''), 'onbekend'), jr, 1)
  on conflict (administratie, jaar) do update
    set laatste = public.verkoop_nummering.laatste + 1
  returning laatste into vlgn;

  return jr::text || '-' || lpad(vlgn::text, 4, '0');
end $$;

revoke execute on function public.volgend_verkoopnummer(text) from public, anon;
grant  execute on function public.volgend_verkoopnummer(text) to service_role, authenticated;

comment on function public.volgend_verkoopnummer(text) is
  'Het volgende factuurnummer voor deze bv, per jaar (0064). Via een eigen '
  'teller en niet max()+1: twee mensen tegelijk zouden hetzelfde nummer '
  'krijgen, en dat valt niemand op tot de accountant belt.';

-- ---------------------------------------------------------------------------
--  De factuur
-- ---------------------------------------------------------------------------

create table if not exists public.verkoopfactuur (
  id            text primary key,
  /* Leeg zolang hij concept is. Een nummer uitgeven aan iets dat nog
     weggegooid kan worden, laat een gat in de reeks achter. */
  nummer        text,
  company_id    text not null,
  company_naam  text not null default '',
  administratie text,
  datum         bigint not null default public.now_ms(),
  vervaldatum   bigint,
  /* De maand waar hij over gaat, als 2026-03. Puur om te kunnen zien of een
     periode al gefactureerd is. */
  periode       text,
  bedrag_excl   numeric not null default 0,
  btw_bedrag    numeric not null default 0,
  bedrag_incl   numeric not null default 0,
  status        text not null default 'concept'
                check (status in ('concept', 'verstuurd', 'betaald', 'vervallen')),
  verstuurd_at  bigint,
  betaald_at    bigint,
  opmerking     text,
  /* Waar hij in Exact terechtkwam. Gevuld = geboekt en gaat niet nog eens. */
  exact_id      text,
  exact_at      bigint,
  exact_fout    text,
  updated_at    bigint not null default public.now_ms()
);

create index if not exists verkoopfactuur_klant_idx on public.verkoopfactuur (company_id, datum);
create index if not exists verkoopfactuur_status_idx on public.verkoopfactuur (status);

/* Een nummer is uniek binnen zijn administratie. Twee facturen met hetzelfde
   nummer is een boekhouding die niet meer te controleren is. */
create unique index if not exists verkoopfactuur_nummer_uniek
  on public.verkoopfactuur (coalesce(administratie, ''), nummer)
  where nummer is not null;

create unique index if not exists verkoopfactuur_exact_uniek
  on public.verkoopfactuur (exact_id) where exact_id is not null;

comment on table public.verkoopfactuur is
  'Een factuur aan een klant (0064). De regels liggen vast zodra hij is '
  'opgemaakt; het scherm bij de klant rekende ze tot nu toe elke keer '
  'opnieuw uit, en dan verandert een verstuurde factuur mee.';

-- ---------------------------------------------------------------------------
--  De regels
-- ---------------------------------------------------------------------------

create table if not exists public.verkoopregel (
  id            text primary key,
  factuur_id    text not null,
  volgorde      integer not null default 0,
  omschrijving  text not null default '',
  aantal        numeric not null default 1,
  prijs_excl    numeric not null default 0,
  btw_pct       integer not null default 21,
  grootboek_code text,
  /* Uit welke wasbeurt deze regel komt, als hij daaruit komt. */
  wash_job_id   text,
  updated_at    bigint not null default public.now_ms()
);

create index if not exists verkoopregel_factuur_idx on public.verkoopregel (factuur_id, volgorde);

/*
 * Eén wasbeurt kan maar op één factuur staan.
 *
 * Dit is het slot waar het om gaat. Zonder deze index komt dezelfde wasbeurt
 * op de factuur van maart én die van april, en dan heb je hem twee keer in
 * rekening gebracht bij een klant die dat wél opmerkt.
 */
create unique index if not exists verkoopregel_wasbeurt_uniek
  on public.verkoopregel (wash_job_id) where wash_job_id is not null;

-- ---------------------------------------------------------------------------
--  Een verstuurde factuur ligt vast
--
--  Zodra hij de deur uit is, heeft de klant papier met bedragen erop. Onze
--  regels daarna nog wijzigen betekent dat de twee iets anders zeggen. Wat
--  dan nog kan is een creditnota, en dat is een nieuwe factuur.
-- ---------------------------------------------------------------------------

create or replace function public.verkoopregel_op_slot()
returns trigger
language plpgsql security definer set search_path = public as $$
declare f_id text := coalesce(new.factuur_id, old.factuur_id);
begin
  if exists (select 1 from public.verkoopfactuur f
              where f.id = f_id and f.status <> 'concept') then
    raise exception 'Deze factuur is niet meer concept; de regels liggen vast.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists verkoopregel_op_slot_trg on public.verkoopregel;
create trigger verkoopregel_op_slot_trg
  before insert or update or delete on public.verkoopregel
  for each row execute function public.verkoopregel_op_slot();

-- ---------------------------------------------------------------------------
--  De bedragen komen uit de regels
--
--  Niet met de hand in te vullen. Een totaal dat los van de regels bestaat,
--  is een totaal dat er op een dag niet meer bij past -- en dan is niet te
--  zien welke van de twee klopt.
-- ---------------------------------------------------------------------------

create or replace function public.verkoopfactuur_tellen(factuur_in text)
returns void
language plpgsql security definer set search_path = public as $$
declare excl numeric; btw numeric;
begin
  select coalesce(sum(r.aantal * r.prijs_excl), 0),
         coalesce(sum(r.aantal * r.prijs_excl * r.btw_pct / 100.0), 0)
    into excl, btw
    from public.verkoopregel r where r.factuur_id = factuur_in;

  update public.verkoopfactuur
     set bedrag_excl = round(excl, 2),
         btw_bedrag  = round(btw, 2),
         bedrag_incl = round(excl + btw, 2),
         updated_at  = public.now_ms()
   where id = factuur_in;
end $$;

revoke execute on function public.verkoopfactuur_tellen(text) from public, anon;
grant  execute on function public.verkoopfactuur_tellen(text) to service_role, authenticated;

create or replace function public.verkoopregel_geteld()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.verkoopfactuur_tellen(coalesce(new.factuur_id, old.factuur_id));
  return coalesce(new, old);
end $$;

drop trigger if exists verkoopregel_geteld_trg on public.verkoopregel;
create trigger verkoopregel_geteld_trg
  after insert or update or delete on public.verkoopregel
  for each row execute function public.verkoopregel_geteld();

-- ---------------------------------------------------------------------------
--  Wie mag wat
--
--  De administratie en het management maken ze op. En de klant ziet zijn
--  eigen facturen -- dat is het hele punt van dat scherm in zijn dashboard,
--  en het was tot nu toe een berekening die hij niet kon bewaren.
--
--  Een concept ziet hij niet: dat is werk in de maak, en een bedrag dat nog
--  verandert bij een klant in beeld levert een telefoontje op.
-- ---------------------------------------------------------------------------

alter table public.verkoopfactuur enable row level security;
alter table public.verkoopregel   enable row level security;

drop policy if exists verkoopfactuur_select on public.verkoopfactuur;
create policy verkoopfactuur_select on public.verkoopfactuur for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk')
         or public.heeft_recht('finance.view')
         or (status <> 'concept' and company_id = (
              select p.company_id from public.profiles p where p.id::text = public.my_id())));

drop policy if exists verkoopfactuur_write on public.verkoopfactuur;
create policy verkoopfactuur_write on public.verkoopfactuur for all to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'))
  with check (public.is_management() or public.heeft_recht('admin.desk'));

drop policy if exists verkoopregel_select on public.verkoopregel;
create policy verkoopregel_select on public.verkoopregel for select to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk')
         or public.heeft_recht('finance.view')
         or exists (select 1 from public.verkoopfactuur f
                     where f.id = factuur_id and f.status <> 'concept'
                       and f.company_id = (select p.company_id from public.profiles p
                                            where p.id::text = public.my_id())));

drop policy if exists verkoopregel_write on public.verkoopregel;
create policy verkoopregel_write on public.verkoopregel for all to authenticated
  using (public.is_management() or public.heeft_recht('admin.desk'))
  with check (public.is_management() or public.heeft_recht('admin.desk'));

-- ---------------------------------------------------------------------------
--  Het verkoopdagboek
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_exact_verkoopdagboek', 'exact_verkoopdagboek', '',
   'Het verkoopdagboek in Exact waarin een verkoopfactuur wordt geboekt. '
   'Leeg = er gaat niets heen, want Exact weigert een boeking zonder dagboek.')
on conflict (id) do nothing;

insert into public.exact_sync (soort) values ('verkoopfacturen')
on conflict (soort) do nothing;

-- ---------------------------------------------------------------------------
--  Facturen opmaken uit de wasbeurten
--
--  Per klant één concept over een maand, met een regel per wasbeurt. Wat al
--  op een factuur staat wordt overgeslagen -- de unieke index op wash_job_id
--  bewaakt dat, maar hier wordt het al netjes weggefilterd zodat er geen
--  botsing hoeft te ontstaan.
--
--  Alleen gereedgemelde beurten, want alleen die zijn geleverd. En alleen
--  klanten die een bedrag hebben: een maand met alleen beurten van nul euro
--  levert een factuur op waar niemand iets aan heeft.
--
--  Concept, met opzet. Er komt geen nummer aan te pas en er gaat niets de
--  deur uit; iemand kijkt ernaar en verstuurt hem. Een factuur die zichzelf
--  verstuurt is een factuur die je niet meer kunt tegenhouden.
-- ---------------------------------------------------------------------------

create or replace function public.verkoopfacturen_opmaken(
  periode_in text,
  door_in    text default null
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  vanaf  bigint;
  tot    bigint;
  klant  record;
  f_id   text;
  gemaakt integer := 0;
  n      integer;
begin
  /* De maand als 2026-03. Begin en einde in milliseconden, want zo staat de
     tijd overal in dit schema. */
  vanaf := (extract(epoch from (periode_in || '-01')::date) * 1000)::bigint;
  tot   := (extract(epoch from ((periode_in || '-01')::date + interval '1 month')) * 1000)::bigint;

  for klant in
    select j.company_id, min(j.company_name) as naam, count(*) as beurten
      from public.wash_jobs j
     where j.status = 'gereed'
       and j.completed_at >= vanaf and j.completed_at < tot
       and coalesce(j.price_excl, 0) > 0
       and not exists (select 1 from public.verkoopregel r where r.wash_job_id = j.id)
     group by j.company_id
  loop
    /* Al een concept voor deze klant en deze maand? Dan daarin bijvullen in
       plaats van een tweede maken -- anders krijgt de klant twee facturen
       over dezelfde maand omdat er een beurt later is bijgeboekt. */
    select f.id into f_id
      from public.verkoopfactuur f
     where f.company_id = klant.company_id
       and f.periode = periode_in
       and f.status = 'concept'
     limit 1;

    if f_id is null then
      f_id := 'vf_' || replace(periode_in, '-', '') || '_' || klant.company_id;
      insert into public.verkoopfactuur
        (id, company_id, company_naam, periode, datum, vervaldatum, administratie, opmerking)
      values (
        f_id, klant.company_id, klant.naam, periode_in,
        tot - 1,
        tot - 1 + (30::bigint * 24 * 60 * 60 * 1000),
        (select a.code from public.exact_administratie a where a.hoofd limit 1),
        'Wasbeurten ' || periode_in)
      on conflict (id) do nothing;
      gemaakt := gemaakt + 1;
    end if;

    insert into public.verkoopregel
      (id, factuur_id, volgorde, omschrijving, aantal, prijs_excl, btw_pct, wash_job_id)
    select 'vr_' || j.id,
           f_id,
           row_number() over (order by j.completed_at),
           coalesce(nullif(j.service, ''), 'Wasbeurt') || ' · ' || j.plate,
           1,
           j.price_excl,
           21,
           j.id
      from public.wash_jobs j
     where j.company_id = klant.company_id
       and j.status = 'gereed'
       and j.completed_at >= vanaf and j.completed_at < tot
       and coalesce(j.price_excl, 0) > 0
       and not exists (select 1 from public.verkoopregel r where r.wash_job_id = j.id)
    on conflict (id) do nothing;

    perform public.verkoopfactuur_tellen(f_id);
    f_id := null;
  end loop;

  return gemaakt;
end $$;

revoke execute on function public.verkoopfacturen_opmaken(text, text) from public, anon, authenticated;
grant  execute on function public.verkoopfacturen_opmaken(text, text) to service_role;

comment on function public.verkoopfacturen_opmaken(text, text) is
  'Maakt per klant een conceptfactuur over een maand uit de gereedgemelde '
  'wasbeurten (0064). Wat al op een factuur staat wordt overgeslagen. '
  'Concept met opzet: een factuur die zichzelf verstuurt kun je niet meer '
  'tegenhouden.';

-- ---------------------------------------------------------------------------
--  Versturen: het nummer erop
--
--  Pas hier krijgt hij een nummer, en daarna liggen de regels vast. Een
--  nummer uitgeven aan een concept dat nog weggegooid kan worden, laat een
--  gat in de reeks achter -- en een boekhouding met gaten is een boekhouding
--  waar de accountant vragen over stelt.
-- ---------------------------------------------------------------------------

create or replace function public.verkoopfactuur_versturen(factuur_in text)
returns text
language plpgsql security definer set search_path = public as $$
declare f record; nr text;
begin
  select * into f from public.verkoopfactuur where id = factuur_in;
  if f is null then
    raise exception 'Die factuur bestaat niet.' using errcode = 'no_data_found';
  end if;
  if f.status <> 'concept' then
    return f.nummer;  -- al verstuurd; niets te doen
  end if;
  if coalesce(f.bedrag_excl, 0) <= 0 then
    raise exception 'Een factuur van nul euro versturen heeft geen zin.'
      using errcode = 'check_violation';
  end if;

  nr := public.volgend_verkoopnummer(f.administratie);

  update public.verkoopfactuur
     set nummer = nr, status = 'verstuurd',
         verstuurd_at = public.now_ms(), updated_at = public.now_ms()
   where id = factuur_in;

  return nr;
end $$;

revoke execute on function public.verkoopfactuur_versturen(text) from public, anon, authenticated;
grant  execute on function public.verkoopfactuur_versturen(text) to service_role;

-- ===========================================================================
--  Betaald zetten, en een SEPA-bestand voor de bank
--
--  Casper: "Zorg ervoor dat je hem ook op betaald kan zetten, evt een sepa
--  bestand kan aanmaken ect."
--
--  Twee dingen die bij elkaar horen. Een factuur op betaald zetten is de
--  laatste stap van de keten -- daarna is hij klaar. En een SEPA-bestand is
--  hoe dat betalen in de praktijk gaat: je maakt één bestand met alle
--  openstaande facturen erin, laadt het bij de bank, en die maakt ze in één
--  keer over.
--
--  Waarom een batch en niet per factuur
--  ------------------------------------
--
--  Omdat de bank het zo wil, en omdat je anders niet terug kunt kijken. Een
--  batch is een moment: op 3 april is er voor 12.400 euro aan achttien
--  facturen weggezet. Zonder dat is er alleen een stapel facturen die
--  "betaald" heet en niets dat zegt wanneer en in welke opdracht.
--
--  Wat er NIET automatisch gebeurt
--  -------------------------------
--
--  Betaald zetten bij het maken van het bestand. Een bestand maken is niet
--  hetzelfde als geld overmaken -- er kan nog van alles tussen komen: de
--  bank weigert het, iemand vergeet het te fiatteren, het bestand blijft in
--  de map staan. Pas als iemand zegt dat het is uitgevoerd, gaan de facturen
--  op betaald. Dat is een handeling, met opzet.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Wanneer een factuur betaald is
-- ---------------------------------------------------------------------------

alter table public.expenses add column if not exists betaald_at     bigint;
alter table public.expenses add column if not exists betaald_door   text;
alter table public.expenses add column if not exists betaalbatch_id text;

comment on column public.expenses.betaald_at is
  'Wanneer deze factuur is betaald (0065). Leeg = staat nog open.';

alter table public.verkoopfactuur add column if not exists betaald_door text;

-- ---------------------------------------------------------------------------
--  Van welke rekening er betaald wordt
--
--  Per bv, want elke administratie heeft zijn eigen bankrekening. Op de
--  administratie en niet in de instellingen: die zijn er één van elk, en dit
--  is er één per bv.
-- ---------------------------------------------------------------------------

alter table public.exact_administratie add column if not exists eigen_iban text;
alter table public.exact_administratie add column if not exists eigen_naam text;
alter table public.exact_administratie add column if not exists eigen_bic  text;

comment on column public.exact_administratie.eigen_iban is
  'De rekening waarvan deze bv betaalt (0065). Komt in het SEPA-bestand als '
  'de rekening van de opdrachtgever.';

-- ---------------------------------------------------------------------------
--  De betaalopdracht
-- ---------------------------------------------------------------------------

create table if not exists public.betaalbatch (
  id            text primary key,
  administratie text,
  /* Wat er in het bestand als MsgId staat. De bank gebruikt dat om een
     dubbel aangeleverd bestand te herkennen, dus hij moet uniek zijn. */
  bericht_id    text not null,
  bestandsnaam  text not null default '',
  aantal        integer not null default 0,
  totaal        numeric not null default 0,
  /* Uitvoeringsdatum die in het bestand staat. */
  uitvoeren_op  bigint,
  status        text not null default 'concept'
                check (status in ('concept', 'uitgevoerd', 'ingetrokken')),
  door          text,
  aangemaakt_at bigint not null default public.now_ms(),
  uitgevoerd_at bigint,
  updated_at    bigint not null default public.now_ms()
);

create unique index if not exists betaalbatch_bericht_uniek
  on public.betaalbatch (bericht_id);

create table if not exists public.betaalregel (
  id         text primary key,
  batch_id   text not null,
  expense_id text not null,
  naam       text not null default '',
  iban       text not null,
  bedrag     numeric not null default 0,
  /* Wat de leverancier op zijn afschrift ziet: het factuurnummer. */
  kenmerk    text,
  updated_at bigint not null default public.now_ms()
);

create index if not exists betaalregel_batch_idx on public.betaalregel (batch_id);

/*
 * Eén factuur in één lopende batch.
 *
 * Zonder dit staat dezelfde factuur in het bestand van dinsdag en dat van
 * donderdag, en wordt hij twee keer overgemaakt.
 *
 * Dit stond eerst als unieke index met "where batch_id in (select ...)". Dat
 * kan niet: een index mag geen subquery in zijn voorwaarde hebben, en de
 * migratie viel er in zijn geheel op om. Het staat nu in de trigger
 * hieronder, die er toch al was -- en die kan wél kijken of de batch waar de
 * andere regel in zit is ingetrokken. Ingetrokken batches tellen niet mee:
 * die zijn nooit bij de bank geweest.
 */

comment on table public.betaalbatch is
  'Een betaalopdracht voor de bank (0065). Een batch is een moment: op 3 '
  'april is er voor 12.400 euro aan achttien facturen weggezet.';

-- ---------------------------------------------------------------------------
--  Een uitgevoerde batch ligt vast
-- ---------------------------------------------------------------------------

create or replace function public.betaalregel_op_slot()
returns trigger
language plpgsql security definer set search_path = public as $$
declare b_id text := coalesce(new.batch_id, old.batch_id);
begin
  if exists (select 1 from public.betaalbatch b
              where b.id = b_id and b.status = 'uitgevoerd') then
    raise exception 'Deze betaalopdracht is al uitgevoerd en ligt vast.'
      using errcode = 'check_violation';
  end if;

  /* En dezelfde factuur mag niet in twee lopende opdrachten staan -- dan
     wordt hij twee keer overgemaakt. Ingetrokken opdrachten tellen niet mee. */
  if tg_op = 'INSERT' and exists (
    select 1 from public.betaalregel r
      join public.betaalbatch b on b.id = r.batch_id
     where r.expense_id = new.expense_id
       and r.id <> new.id
       and b.status <> 'ingetrokken'
  ) then
    raise exception 'Deze factuur staat al in een betaalopdracht.'
      using errcode = 'unique_violation';
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists betaalregel_op_slot_trg on public.betaalregel;
create trigger betaalregel_op_slot_trg
  before insert or update or delete on public.betaalregel
  for each row execute function public.betaalregel_op_slot();

-- ---------------------------------------------------------------------------
--  Uitvoeren: de facturen op betaald
--
--  Eén handeling, en pas als iemand zegt dat de bank hem heeft gedraaid. Een
--  bestand maken is niet hetzelfde als geld overmaken.
-- ---------------------------------------------------------------------------

create or replace function public.betaalbatch_uitvoeren(batch_in text, door_in text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.expenses e
     set betaald_at = public.now_ms(),
         betaald_door = door_in,
         betaalbatch_id = batch_in,
         updated_at = public.now_ms()
    from public.betaalregel r
   where r.batch_id = batch_in
     and e.id = r.expense_id
     and e.betaald_at is null;

  get diagnostics n = row_count;

  update public.betaalbatch
     set status = 'uitgevoerd', uitgevoerd_at = public.now_ms(),
         door = coalesce(door_in, door), updated_at = public.now_ms()
   where id = batch_in;

  return n;
end $$;

revoke execute on function public.betaalbatch_uitvoeren(text, text) from public, anon, authenticated;
grant  execute on function public.betaalbatch_uitvoeren(text, text) to service_role;

-- ---------------------------------------------------------------------------
--  Wat er openstaat
--
--  Goedgekeurd, geboekt in Exact, nog niet betaald, en er staat een IBAN op.
--  Die laatste komt uit wat de lezer van de factuur heeft gehaald; zonder
--  rekeningnummer valt er niets over te maken.
-- ---------------------------------------------------------------------------

create or replace function public.betaalbaar()
returns table (
  id            text,
  leverancier   text,
  factuurnummer text,
  bedrag_incl   numeric,
  iban          text,
  administratie text,
  datum         bigint,
  vervaldatum   bigint
)
language sql stable security definer set search_path = public as $$
  select e.id,
         coalesce(e.supplier, ''),
         e.factuurnummer,
         round(coalesce(e.amount_excl, 0) * (1 + coalesce(e.vat_pct, 0) / 100.0), 2),
         upper(replace(coalesce(e.gelezen->>'iban', ''), ' ', '')),
         public.bon_administratie(e.id),
         e.expense_date,
         e.vervaldatum
    from public.expenses e
   where e.status = 'goedgekeurd'
     and e.betaald_at is null
     and coalesce(e.amount_excl, 0) > 0
     and not exists (
       select 1 from public.betaalregel r
         join public.betaalbatch b on b.id = r.batch_id
        where r.expense_id = e.id and b.status <> 'ingetrokken')
   order by coalesce(e.vervaldatum, e.expense_date);
$$;

revoke execute on function public.betaalbaar() from public, anon, authenticated;
grant  execute on function public.betaalbaar() to service_role;

-- ---------------------------------------------------------------------------
--  Wie mag wat
-- ---------------------------------------------------------------------------

alter table public.betaalbatch enable row level security;
alter table public.betaalregel enable row level security;

do $$
declare t text;
begin
  foreach t in array array['betaalbatch', 'betaalregel'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated '
      'using (public.is_management() or public.heeft_recht(''admin.desk''))',
      t, t);
  end loop;
end $$;

-- ===========================================================================
--  Links in mails wijzen naar de site, niet naar GitHub
--
--  Casper: "kan je ervoor zorgen dat alle linken die in mails worden verstuurd
--  op de website uitkomen ipv de github release? evt al bij die app, zodat ze
--  misschien gelijk bij het bericht kunnen komen?"
--
--  Wat er stond
--  ------------
--
--  Twee serverfuncties (stuur-mail en nodig-uit) hadden allebei hun eigen
--  APP_LINK met dezelfde terugval naar de releasepagina op GitHub. Die secret
--  stond nergens gezet, dus die "terugval" was gewoon wat er gebeurde: wie een
--  mail kreeg dat zijn aanmelding was goedgekeurd, kwam uit op een pagina met
--  versienummers, losse .exe-bestanden en changelogs.
--
--  0055 zei het al met zoveel woorden -- "Casper wilde juist van dat
--  GitHub-adres af" -- maar toen ging het alleen over de terugkeer uit Exact.
--  Nu geldt het voor alles wat de deur uit gaat.
--
--  Wat erbij komt
--  --------------
--
--  Eén instelling: site_url. app_url stond er al (0055) en wijst naar de app;
--  dit wijst naar de website ernaast. Twee adressen omdat het twee vragen zijn:
--
--    "ik moet de app nog installeren"  ->  /medewerkers/ op de site
--    "er staat iets voor me klaar"     ->  de app zelf, meteen op het scherm
--                                          waar het klaarstaat
--
--  Laat je site_url leeg, dan neemt de serverfunctie de wortel van app_url.
--  Dat klopt zolang de site en de app op hetzelfde domein staan, en dat is nu
--  zo. Staat de app ooit ergens anders, dan zet je dit veld en is het weer
--  goed -- zonder nieuwe versie.
--
--  De automatische bijwerker blijft bij GitHub. Die haalt bestanden op, geen
--  mensen, en een releasepagina is daar precies goed voor.
--
--  Opnieuw draaien mag.
-- ===========================================================================

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_site_url', 'site_url', 'https://truckwash-workspace.com/',
   'Waar de website staat. Hier komen de links in mails uit die over de app '
   'zelf gaan, zoals /medewerkers/ om hem te downloaden. Moet https zijn; '
   'leeg laten betekent dat de serverfunctie de wortel van app_url pakt.')
on conflict (id) do nothing;

-- ===========================================================================
--  Werk: taken, projecten en een bord
--
--  Casper: "Ik wil voor leidinggevende, management en ontwikkelaar een
--  volledige workflow, met todo's, projectmanagement, kanban board ect."
--
--  Wat er nu is en waarom dat niet genoeg is
--  -----------------------------------------
--
--  Er staat van alles in de app dat om aandacht vraagt: een factuur die op
--  goedkeuring wacht, een storing, een wijzigingsverzoek, een aanmelding. Elk
--  daarvan heeft zijn eigen tabblad met zijn eigen tellertje. Wie 's ochtends
--  wil weten wat er op zijn bord ligt, moet acht schermen langs -- en wat er
--  niet in een van die acht past (een gesprek voeren, een monteur bellen, een
--  contract nakijken) staat nergens.
--
--  Vandaar één plek waar werk staat. Niet ter vervanging van die tabbladen:
--  een factuur blijft een factuur. Maar wel als de lijst waar je naar kijkt.
--
--  De keuzes
--  ---------
--
--  Vier kolommen, vast: te doen, bezig, wacht, klaar. Geen instelbare
--  kolommen per bord. Dat klinkt als een beperking maar is er een die je wilt:
--  zodra iedereen zijn eigen kolommen mag verzinnen, betekent "klaar" op het
--  ene bord iets anders dan op het andere, en dan kun je er niets meer over
--  zeggen. "Wacht" is er wel bij, want dat is de stand waarin het meeste werk
--  hier verkeert: je wacht op iemand anders.
--
--  Een taak hangt aan een persoon OF aan een rol. Dat tweede is nodig voor
--  werk dat uit het systeem zelf komt -- een nieuwe sollicitatie is niet van
--  Jan, hij is van "de leiding op deze vestiging". Wie hem oppakt, zet hem op
--  zijn naam. Zonder die tussenstand krijg je of een taak die aan niemand
--  hangt en dus door niemand gedaan wordt, of een willekeurig aangewezen
--  eigenaar die er niets van weet.
--
--  Een taak hangt aan een vestiging. Dat is wat de leiding uit elkaar houdt:
--  een leidinggevende van Venlo hoort het werk van Venlo te zien en niet dat
--  van Groenlo. Management en ontwikkelaar zien alles.
--
--  Projecten zijn groepen. Een bord is geen apart ding: het is de taken van
--  een project (of van alles) in vier kolommen.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Een project: een groep werk met een naam
-- ---------------------------------------------------------------------------

create table if not exists public.taak_project (
  id           text primary key,
  naam         text not null,
  omschrijving text,
  /* Een naam en geen hexcode: de app kent de huisstijlkleuren, deze tabel
     hoort daar niets van te weten. Wat hier staat en de app niet kent, valt
     terug op de merkkleur. */
  kleur        text not null default 'brand',
  /* Null = niet aan een vestiging gebonden; iedereen met toegang ziet hem. */
  location_id  text,
  archief      boolean not null default false,
  volgorde     integer not null default 0,
  door         text,
  door_naam    text,
  created_at   bigint not null default public.now_ms(),
  updated_at   bigint not null default public.now_ms()
);

create index if not exists taak_project_loc_idx on public.taak_project (location_id);

comment on table public.taak_project is
  'Een groep werk met een naam (0067). Een bord is de taken hiervan in vier '
  'kolommen; er is geen aparte bordtabel.';

-- ---------------------------------------------------------------------------
--  De taak
-- ---------------------------------------------------------------------------

create table if not exists public.taak (
  id           text primary key,
  titel        text not null,
  omschrijving text,

  /* Vier vaste kolommen. Zie de kop: instelbare kolommen maken "klaar"
     betekenisloos zodra er meer dan één bord is. */
  status       text not null default 'te_doen'
               check (status in ('te_doen', 'bezig', 'wacht', 'klaar')),
  prioriteit   text not null default 'normaal'
               check (prioriteit in ('laag', 'normaal', 'hoog', 'urgent')),

  project_id   text references public.taak_project(id) on delete set null,
  location_id  text,

  /* Aan een persoon, aan een rol, of aan geen van beide. Zie de kop: werk dat
     uit het systeem komt hoort eerst bij een rol en pas daarna bij iemand. */
  toegewezen_aan  text,
  toegewezen_naam text,
  toegewezen_rol  text
                  check (toegewezen_rol is null or toegewezen_rol in
                    ('supervisor', 'management', 'developer', 'administratie',
                     'technician', 'employee', 'trucksupply')),

  deadline     bigint,
  /* Plek binnen de kolom. Slepen op het bord verandert dit en niets anders. */
  volgorde     integer not null default 0,

  /* Waar deze taak vandaan komt. 'handmatig' is iemand die hem intikt; de
     rest komt uit het systeem, en dan wijst bron_id naar het ding zelf --
     zodat je vanaf de taak naar de sollicitatie of de factuur kunt springen
     en er niet twee keer een taak voor hetzelfde ontstaat. */
  bron         text not null default 'handmatig'
               check (bron in ('handmatig', 'sollicitatie', 'factuur',
                               'storing', 'wijziging', 'aanmelding')),
  bron_id      text,

  klaar_at        bigint,
  klaar_door      text,
  klaar_door_naam text,

  door         text,
  door_naam    text,
  created_at   bigint not null default public.now_ms(),
  updated_at   bigint not null default public.now_ms()
);

create index if not exists taak_status_idx  on public.taak (status, volgorde);
create index if not exists taak_loc_idx     on public.taak (location_id);
create index if not exists taak_wie_idx     on public.taak (toegewezen_aan);
create index if not exists taak_rol_idx     on public.taak (toegewezen_rol);
create index if not exists taak_project_idx on public.taak (project_id);

/* Eén taak per ding dat uit het systeem komt. Zonder deze index maakt een
   tweede sync, een herstart of een dubbele trigger een tweede taak voor
   dezelfde sollicitatie -- en dan staat er twee keer hetzelfde op het bord
   zonder dat iemand weet welke de echte is. Handmatige taken vallen erbuiten:
   die mogen best twee keer hetzelfde heten. */
create unique index if not exists taak_bron_uniek
  on public.taak (bron, bron_id, coalesce(toegewezen_aan, ''), coalesce(toegewezen_rol, ''))
  where bron <> 'handmatig' and bron_id is not null;

comment on table public.taak is
  'Werk dat gedaan moet worden (0067). Aan een persoon of aan een rol, altijd '
  'met een vestiging erbij zodat de leiding van Venlo het werk van Venlo ziet.';

-- ---------------------------------------------------------------------------
--  Reacties: het gesprek dat bij een taak hoort
--
--  Zonder dit staat de overlegging over een taak in de chat, in de mail, of
--  nergens -- en dan is over een maand niet meer te zien waarom iets bleef
--  liggen.
-- ---------------------------------------------------------------------------

create table if not exists public.taak_reactie (
  id         text primary key,
  taak_id    text not null references public.taak(id) on delete cascade,
  tekst      text not null,
  door       text,
  door_naam  text,
  created_at bigint not null default public.now_ms(),
  updated_at bigint not null default public.now_ms()
);

create index if not exists taak_reactie_taak_idx on public.taak_reactie (taak_id, created_at);

-- ---------------------------------------------------------------------------
--  Klaar is klaar: wanneer en door wie
--
--  In een trigger en niet in de app. De app kan het vergeten, en een taak die
--  op klaar staat zonder datum is een taak waarvan niemand weet wanneer dat
--  gebeurde. Andersom net zo: gaat hij terug naar bezig, dan hoort de datum
--  weg -- anders staat er een afrondingsdatum bij werk dat nog loopt.
-- ---------------------------------------------------------------------------

create or replace function public.taak_klaar_stempel()
returns trigger language plpgsql as $$
begin
  if new.status = 'klaar' and (tg_op = 'INSERT' or old.status is distinct from 'klaar') then
    new.klaar_at := coalesce(new.klaar_at, public.now_ms());
  elsif new.status <> 'klaar' then
    new.klaar_at := null;
    new.klaar_door := null;
    new.klaar_door_naam := null;
  end if;
  return new;
end $$;

drop trigger if exists taak_klaar_stempel on public.taak;
create trigger taak_klaar_stempel
  before insert or update on public.taak
  for each row execute function public.taak_klaar_stempel();

-- ---------------------------------------------------------------------------
--  Wie mag hierbij
--
--  De rollen die dit gebruiken zijn leidinggevende, management en
--  ontwikkelaar. Daarnaast mag iedereen zien wat aan hemzelf is toegewezen --
--  anders kan een monteur een taak krijgen die hij nooit te zien krijgt.
--
--  De vestiging bepaalt de rest: in_my_locations() geeft management en wie
--  all_locations heeft alles, en een leidinggevende zijn eigen vestigingen.
--  Een taak zonder vestiging is voor iedereen met toegang.
-- ---------------------------------------------------------------------------

create or replace function public.mag_taken()
returns boolean language sql stable as $$
  select public.is_lead() or public.is_developer();
$$;

grant execute on function public.mag_taken() to authenticated;

alter table public.taak         enable row level security;
alter table public.taak_project enable row level security;
alter table public.taak_reactie enable row level security;

/* --- de taak zelf --- */

drop policy if exists taak_select on public.taak;
create policy taak_select on public.taak
  for select to authenticated
  using (
    toegewezen_aan = public.my_id()
    or (public.mag_taken() and public.in_my_locations(location_id))
  );

drop policy if exists taak_insert on public.taak;
create policy taak_insert on public.taak
  for insert to authenticated
  /* rij_bestaat() vooraan, om dezelfde reden als overal: een upsert langs
     PostgREST beoordeelt deze insert-regel OOK bij een gewone wijziging, en
     weigert die dan met "new row violates row-level security policy". Zie
     0044. */
  with check (public.rij_bestaat('public.taak'::regclass, id)
              or (public.mag_taken() and public.in_my_locations(location_id)));

drop policy if exists taak_update on public.taak;
create policy taak_update on public.taak
  for update to authenticated
  using (
    toegewezen_aan = public.my_id()
    or (public.mag_taken() and public.in_my_locations(location_id))
  )
  with check (
    toegewezen_aan = public.my_id()
    or (public.mag_taken() and public.in_my_locations(location_id))
  );

/* Weggooien mag alleen de leiding, en alleen bij eigen werk. Werk dat uit het
   systeem komt hoort niet gewist te worden maar afgevinkt: anders is de
   sollicitatie waar hij bij hoorde straks door niemand behandeld en staat er
   ook nergens meer dat het is blijven liggen. */
drop policy if exists taak_delete on public.taak;
create policy taak_delete on public.taak
  for delete to authenticated
  using (public.mag_taken() and public.in_my_locations(location_id)
         and bron = 'handmatig');

/* --- projecten --- */

drop policy if exists taak_project_select on public.taak_project;
create policy taak_project_select on public.taak_project
  for select to authenticated
  using (public.mag_taken() and public.in_my_locations(location_id));

drop policy if exists taak_project_insert on public.taak_project;
create policy taak_project_insert on public.taak_project
  for insert to authenticated
  with check (public.rij_bestaat('public.taak_project'::regclass, id)
              or (public.mag_taken() and public.in_my_locations(location_id)));

drop policy if exists taak_project_update on public.taak_project;
create policy taak_project_update on public.taak_project
  for update to authenticated
  using (public.mag_taken() and public.in_my_locations(location_id))
  with check (public.mag_taken() and public.in_my_locations(location_id));

drop policy if exists taak_project_delete on public.taak_project;
create policy taak_project_delete on public.taak_project
  for delete to authenticated
  using (public.is_management() or public.is_developer());

/* --- reacties --- */

drop policy if exists taak_reactie_select on public.taak_reactie;
create policy taak_reactie_select on public.taak_reactie
  for select to authenticated
  using (exists (select 1 from public.taak t where t.id = taak_id));

drop policy if exists taak_reactie_insert on public.taak_reactie;
create policy taak_reactie_insert on public.taak_reactie
  for insert to authenticated
  with check (public.rij_bestaat('public.taak_reactie'::regclass, id)
              or (door = public.my_id()
                  and exists (select 1 from public.taak t where t.id = taak_id)));

/* Een reactie mag je bijwerken zolang hij van jou is. Wissen niet: dan
   verdwijnt het antwoord waar iemand anders op reageerde. */
drop policy if exists taak_reactie_update on public.taak_reactie;
create policy taak_reactie_update on public.taak_reactie
  for update to authenticated
  using (door = public.my_id())
  with check (door = public.my_id());

-- ===========================================================================
--  Vacatures en sollicitaties in eigen huis
--
--  Casper: "je moet de sollicitaties ook aanpassen ipv trainstation, ik heb je
--  een pdf gestuurd, die vragen moeten er dan inkomen (wel gerichte vragen
--  voor sollicitant). Als iemand gesolliciteerd heeft, moet je het automatisch
--  op leiding en managment hun todo zetten (wel enkel als ze toegang tot de
--  gekozen locatie hebben)."
--
--  Wat er was
--  ----------
--
--  Vier vacatures, met de hand in site.json gezet, en een sollicitatieknop die
--  naar truckwash.trainstation.nl wees -- een systeem van een andere partij.
--  Wat daar binnenkwam kwam hier nooit aan: geen melding, geen taak, geen
--  dossier. En bij de pendelchauffeur wees de knop naar vacaturenummer 1,
--  hetzelfde nummer als de truckwashmedewerker, zodat een sollicitatie op de
--  verkeerde vacature belandde.
--
--  De vragen
--  ---------
--
--  Uit het gespreksformulier dat Casper stuurde. Niet alle vragen daaruit:
--  dat is een template voor het GESPREK, en de helft ervan hoort daar ook te
--  blijven ("algemene indruk", de proefdag, de doorgroeimogelijkheden die je
--  bespreekt). Wat een sollicitant zelf kan invullen staat hier; wat de
--  gespreksvoerder invult staat er als aparte velden bij en is voor de
--  sollicitant niet zichtbaar.
--
--  Eén vraag is bewust anders gesteld. Het formulier vraagt "wat is je
--  leeftijd", en dat is een antwoord dat na een jaar niet meer klopt -- terwijl
--  het loon uit de salaristabel er wél aan hangt. Dus: geboortedatum. De
--  leeftijd volgt daaruit, elke dag opnieuw.
--
--  De beschikbaarheid staat als jsonb en niet als veertien kolommen: het is
--  één ding dat je in één keer invult en in één keer terugleest, en zeven
--  dagen maal drie velden als kolommen maakt elke query onleesbaar.
--
--  Waarom er meteen een taak van komt
--  ----------------------------------
--
--  Een sollicitatie die in een lijst belandt waar niemand naar kijkt is een
--  sollicitatie die je kwijt bent. Vandaar de trigger onderaan: zodra er een
--  binnenkomt staat hij op het bord van de mensen die er iets mee kunnen --
--  en alleen bij hen, want de leiding van Venlo hoort niet de sollicitaties
--  van Groenlo te zien.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De vacature
-- ---------------------------------------------------------------------------

create table if not exists public.vacature (
  id           text primary key,
  /* Het pad op de website. Uniek, want twee vacatures op één adres betekent
     dat er één onbereikbaar is. */
  slug         text not null unique,
  titel        text not null,
  /* FG1 t/m FG5 uit de salaristabel; leeg mag ook. Alleen om de vacature aan
     een schaal te hangen -- de bedragen zelf staan hier niet, die horen in de
     loonadministratie en niet op een website. */
  functiegroep text check (functiegroep is null or functiegroep in ('FG1','FG2','FG3','FG4','FG5')),
  intro        text not null default '',
  tekst        text not null default '',
  taken        text[] not null default '{}',
  eisen        text[] not null default '{}',
  bieden       text[] not null default '{}',
  /* "Bijbaan", "32-38 uur", "in overleg" -- vrije tekst, want dit is wat er op
     de site komt te staan en niet iets waarop gerekend wordt. */
  uren         text,

  /* Op welke vestigingen. Een lege lijst betekent: alle. Dat is de gewone
     stand voor een vacature als "washeld" die overal openstaat, en het scheelt
     achttien vinkjes zetten bij elke nieuwe vacature. */
  locaties     text[] not null default '{}',

  actief       boolean not null default true,
  volgorde     integer not null default 0,
  door         text,
  door_naam    text,
  created_at   bigint not null default public.now_ms(),
  updated_at   bigint not null default public.now_ms()
);

create index if not exists vacature_actief_idx on public.vacature (actief, volgorde);

comment on table public.vacature is
  'De vacatures, zoals ze op de website komen (0068). Leeg locaties[] betekent '
  'alle vestigingen.';

-- ---------------------------------------------------------------------------
--  De sollicitatie
-- ---------------------------------------------------------------------------

create table if not exists public.sollicitatie (
  id             text primary key,

  vacature_id    text references public.vacature(id) on delete set null,
  /* De titel erbij, want een vacature kan worden hernoemd of ingetrokken en
     dan hoort er bij de sollicitatie nog steeds te staan waarop iemand
     solliciteerde. */
  vacature_titel text,
  location_id    text,

  /* --- wie --- */
  naam           text not null,
  email          text not null,
  telefoon       text,
  /* Geen leeftijd maar een geboortedatum; zie de kop. */
  geboortedatum  date,
  woonplaats     text,

  /* --- school en werk --- */
  school         boolean,
  opleiding      text,
  niveau         text,
  leerjaar       text,
  ervaring       text,
  hoe_gevonden   text,
  motivatie      text,

  /* --- inzet --- */
  hoe_lang       text,
  beperkingen    text,

  /* --- vervoer --- */
  vervoer        text,
  rijbewijs      boolean,
  reistijd       text,
  andere_vestiging boolean,

  /* Zeven regels van {dag, van, tot, opmerking}. Zie de kop voor waarom dit
     geen veertien kolommen zijn. */
  beschikbaarheid jsonb not null default '[]'::jsonb,

  /* --- de afhandeling; niet zichtbaar voor de sollicitant --- */
  status         text not null default 'nieuw'
                 check (status in ('nieuw', 'gesprek', 'proefdag', 'aangenomen',
                                   'afgewezen', 'ingetrokken')),
  indruk         text,
  notities       text,
  gesprek_at     bigint,
  proefdag_at    bigint,
  functiegroep   text check (functiegroep is null or functiegroep in ('FG1','FG2','FG3','FG4','FG5')),
  behandeld_door text,
  behandeld_door_naam text,
  behandeld_at   bigint,
  afwijs_reden   text,

  /* Het dossier dat hieruit is gemaakt. Gevuld zodra iemand op "medewerker
     aanmaken" heeft gedrukt, zodat dat niet twee keer kan. */
  profile_id     text,

  created_at     bigint not null default public.now_ms(),
  updated_at     bigint not null default public.now_ms()
);

create index if not exists sollicitatie_status_idx on public.sollicitatie (status, created_at desc);
create index if not exists sollicitatie_loc_idx    on public.sollicitatie (location_id);

comment on table public.sollicitatie is
  'Sollicitaties die via de website binnenkomen (0068). Vervangt het formulier '
  'bij trainstation; wat hier binnenkomt maakt meteen een taak aan.';

-- ---------------------------------------------------------------------------
--  Een sollicitatie wordt werk
--
--  Eén taak, niet één per persoon. Vijf mensen die allemaal hetzelfde vinkje
--  moeten zetten is vier keer werk te veel, en na de eerste blijven er vier
--  openstaan alsof er niets is gebeurd.
--
--  De taak hangt aan een ROL en aan de vestiging. Wie hem oppakt zet hem op
--  zijn naam (zie 0067). Ligt er een leidinggevende op die vestiging, dan gaat
--  hij naar de leiding; is die er niet, dan naar het management -- anders
--  hangt hij aan een rol die daar niemand heeft en ziet niemand hem.
--
--  Het management ziet hem hoe dan ook: die kijkt op alle vestigingen mee.
-- ---------------------------------------------------------------------------

create or replace function public.sollicitatie_wordt_taak()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  heeft_leiding boolean;
  rol           text;
  waar          text;
begin
  select exists (
    select 1 from public.profiles p
     where p.active
       and 'supervisor' = any(p.roles)
       and (p.all_locations
            or p.location_id = new.location_id
            or new.location_id = any(coalesce(p.manages, array[]::text[])))
  ) into heeft_leiding;

  rol := case when heeft_leiding then 'supervisor' else 'management' end;

  select coalesce(l.name, '') into waar
    from public.locations l where l.id = new.location_id;

  insert into public.taak (
    id, titel, omschrijving, status, prioriteit,
    location_id, toegewezen_rol, bron, bron_id, door_naam
  ) values (
    'taak_sol_' || new.id,
    'Sollicitatie: ' || new.naam ||
      case when coalesce(new.vacature_titel, '') = '' then ''
           else ' (' || new.vacature_titel || ')' end,
    'Kwam binnen via de website' ||
      case when coalesce(waar, '') = '' then '' else ' voor ' || waar end ||
      '. Bel of mail om een gesprek in te plannen.' ||
      case when coalesce(new.telefoon, '') = '' then '' else E'\n' || new.telefoon end ||
      E'\n' || new.email,
    'te_doen',
    'hoog',
    new.location_id,
    rol,
    'sollicitatie',
    new.id,
    'De website'
  )
  /* De unieke index uit 0067 zou hier een fout gooien als dezelfde
     sollicitatie twee keer binnenkwam. Een sollicitatie die niet wordt
     opgeslagen omdat er al een taak voor was, is erger dan een dubbele taak
     die er niet komt. */
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists sollicitatie_wordt_taak on public.sollicitatie;
create trigger sollicitatie_wordt_taak
  after insert on public.sollicitatie
  for each row execute function public.sollicitatie_wordt_taak();

-- ---------------------------------------------------------------------------
--  Wat de website mag weten
--
--  Dezelfde lijn als website_vestigingen() in 0033: één functie die precies
--  bepaalt wat er naar buiten gaat, alleen aan te roepen door service_role.
--  Hier staat dus wat er op de site komt, en niets anders -- geen tellers,
--  geen wie-hem-aanmaakte, geen vestigingen die uit staan.
-- ---------------------------------------------------------------------------

drop function if exists public.website_vacatures();

create function public.website_vacatures()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(v order by v.volgorde, v.titel), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'slug', va.slug,
               'titel', va.titel,
               'intro', va.intro,
               'tekst', va.tekst,
               'taken', to_jsonb(va.taken),
               'eisen', to_jsonb(va.eisen),
               'bieden', to_jsonb(va.bieden),
               'uren', va.uren,
               'functiegroep', va.functiegroep,
               /* Alleen vestigingen die ook echt open zijn, en die een plek op
                  de site hebben. Een vacature voor een vestiging die uit staat
                  is een sollicitatie die nergens heen kan.

                  De SLUG gaat mee en niet het id. Zo doet website_vestigingen()
                  het ook (0033), en met reden: de site hoeft onze sleutels niet
                  te kennen, en een id dat eenmaal in een openbare pagina staat
                  is een id dat je nooit meer verandert. De serverfunctie zoekt
                  de vestiging er straks bij op de slug. */
               'locaties', (
                 select coalesce(jsonb_agg(jsonb_build_object('slug', l.website_slug,
                                                              'plaats', l.city)
                                           order by l.city), '[]'::jsonb)
                   from public.locations l
                  where l.active
                    and l.website_slug is not null
                    and (cardinality(va.locaties) = 0 or l.id = any(va.locaties))
               )
             ) as v,
             va.volgorde, va.titel
        from public.vacature va
       where va.actief
    ) v;
$$;

revoke execute on function public.website_vacatures() from public, anon, authenticated;
grant  execute on function public.website_vacatures() to service_role;

-- ---------------------------------------------------------------------------
--  Wie mag hierbij
-- ---------------------------------------------------------------------------

alter table public.vacature     enable row level security;
alter table public.sollicitatie enable row level security;

/* --- vacatures ---
   Lezen mag iedereen die bij taken mag; aanmaken en wijzigen mag de leiding
   voor haar eigen vestigingen en het management voor alles. Dat laatste zit in
   de regel hieronder: een vacature zonder vestiging (= alle) mag alleen wie
   overal mag. */

create or replace function public.mag_vacature(loc text[])
returns boolean language sql stable as $$
  select public.is_management() or public.is_developer()
      or (public.is_supervisor()
          and cardinality(loc) > 0
          and loc <@ public.my_locations());
$$;

grant execute on function public.mag_vacature(text[]) to authenticated;

drop policy if exists vacature_select on public.vacature;
create policy vacature_select on public.vacature
  for select to authenticated using (public.mag_taken());

drop policy if exists vacature_insert on public.vacature;
create policy vacature_insert on public.vacature
  for insert to authenticated
  with check (public.rij_bestaat('public.vacature'::regclass, id)
              or public.mag_vacature(locaties));

drop policy if exists vacature_update on public.vacature;
create policy vacature_update on public.vacature
  for update to authenticated
  using (public.mag_vacature(locaties))
  with check (public.mag_vacature(locaties));

drop policy if exists vacature_delete on public.vacature;
create policy vacature_delete on public.vacature
  for delete to authenticated
  using (public.is_management() or public.is_developer());

/* --- sollicitaties ---
   Alleen wie bij die vestiging mag. Hier staat een geboortedatum, een
   telefoonnummer en een motivatiebrief in; dat is niet iets om aan alle
   leidinggevenden van het land te laten zien. */

drop policy if exists sollicitatie_select on public.sollicitatie;
create policy sollicitatie_select on public.sollicitatie
  for select to authenticated
  using (public.mag_taken() and public.in_my_locations(location_id));

/* Aanmaken doet de website, met de servicesleutel, langs de RLS heen. Wat hier
   staat is voor de app zelf -- iemand die aan de balie een sollicitatie
   overtypt. */
drop policy if exists sollicitatie_insert on public.sollicitatie;
create policy sollicitatie_insert on public.sollicitatie
  for insert to authenticated
  with check (public.rij_bestaat('public.sollicitatie'::regclass, id)
              or (public.mag_taken() and public.in_my_locations(location_id)));

drop policy if exists sollicitatie_update on public.sollicitatie;
create policy sollicitatie_update on public.sollicitatie
  for update to authenticated
  using (public.mag_taken() and public.in_my_locations(location_id))
  with check (public.mag_taken() and public.in_my_locations(location_id));

/* Wissen kan niet, ook niet door het management. Een afgewezen sollicitant
   hoort te worden opgeruimd op tijd en niet op knopdruk -- en zolang iemand in
   procedure is, is "weg" hetzelfde als "kwijt". Wat weg moet krijgt de status
   ingetrokken. */

-- ===========================================================================
--  De vacatures die nu op de site staan komen naar binnen
--
--  Casper: "je moet ook zorgen dat de huidige vacatures meekomen".
--
--  Woordelijk overgenomen uit bouw/site.json van de website, met een script en
--  niet met de hand -- de teksten zijn van Casper en horen precies over te
--  komen. Wat daar een lijst onder een kop was is hier taken / eisen / bieden
--  geworden; de rest is lopende tekst.
--
--  Alle vier staan op alle vestigingen (lege locaties[]). Dat is hoe ze op de
--  site stonden: er stond nergens bij waar ze golden. Wie dat wil bijstellen
--  doet dat in het scherm, niet hier.
--
--  Alleen als ze er nog niet zijn: "on conflict do nothing". Deze migratie is
--  een startpunt en geen bron -- wat er daarna mee gebeurt is aan het scherm.
--
--  Opnieuw draaien mag.
-- ===========================================================================

insert into public.vacature
  (id, slug, titel, intro, tekst, taken, eisen, bieden, uren, locaties, volgorde)
values
  ('vac_washeld_worden', 'washeld-worden', 'Werken bij Truckwash', 'Wij zijn op zoek naar WASHELDEN . Heb jij interesse en ben je gemotiveerd om deel uit te maken van een superteam? Vul dan snel onderstaand formulier in voor het werken bij Truckwash1group', '', '{}'::text[], '{}'::text[], '{}'::text[], null, '{}'::text[], 0),
  ('vac_pendelchauffeur', 'pendelchauffeur', 'Pendelchauffeur', 'Zie jij jezelf al rondrijden voor Truckwash 1 Group? Solliciteer vandaag nog! Laat je gegevens en een korte motivatie achter via onderstaand formulier of neem contact met ons op. Ook als er op dit moment geen ritten beschikbaar zijn, nemen we je graag op in ons chauffeursnetwerk', '', array['Je rijdt vrachtwagens van klanten naar de wasstraat en weer terug.', 'Je schakelt soepel tussen verschillende voertuigen en locaties.', 'Je bent het vriendelijke en representatieve aanspreekpunt voor onze klanten.'], array['Je hebt een geldig vrachtwagenrijbewijs (C of CE) .', 'Je bent klantvriendelijk, betrouwbaar en representatief.', 'Je bent flexibel inzetbaar en houdt ervan om onderweg te zijn.', 'Je werkt zelfstandig en denkt mee in oplossingen.'], array['3 tot 10 uur per week soms wat meer, soms wat minder.', 'Werk op vaste basis of als oproep-/invalchauffeur .', 'Werken vanuit één van onze vestigingen (locatie in overleg).', 'Salaris in overleg , afhankelijk van ervaring en inzet.', 'Een prettige, informele werksfeer in een enthousiast team.', 'Toegankelijk voor iedereen met rijbewijs C of CE ook als je al met pensioen bent!'], null, '{}'::text[], 1),
  ('vac_horeca_medewerker_bediening', 'horeca-medewerker-bediening', 'Horeca medewerker', 'Wanneer jij de persoon bent die bij ons komt werken, dan ga je in teamverband werken in de bediening en achter de bar. Je hebt een zelfstandige functie waarin je veel verantwoordelijkheid draagt. Je bent actief met het opnemen, wegbrengen en afrekenen van bestellingen en het klaarmaken van tafels voor onze volgende gasten. Dit alles doe je met gevoel voor goede service.', 'Wil je meer weten over ons bedrijf Lees dan hier verder.

Je kunt je aanmelden via het formulier onderstaand. Wil je liever bellen of heb je vooraf vragen dan kun je ons bereiken op 06-51001528', '{}'::text[], array['Je weet op een enthousiaste en persoonlijke manier met de gasten om te gaan', 'Je bent een teamplayer', 'Je hebt een representatieve uitstraling', 'Je kan organiseren, motiveren en instrueren', 'Je bent flexibel inzetbaar', 'Uiteraard heb je horeca ervaring', 'Je hebt goede beheersing van de Nederlandse taal, Engels is een pre', 'Je houdt van een uitdaging'], array['Een gezellige werksfeer in een bedrijf met korte lijntjes', 'Uitstekende primaire en secundaire arbeidsvoorwaarden', 'Per direct een functie bij een dynamisch en solide bedrijf', 'Leuke teamuitjes'], null, '{}'::text[], 2),
  ('vac_open_sollicitatie', 'open-sollicitatie', 'Open Sollicitatie', 'Op dit moment geen passend vacature voor jou? En wil je wel graag werken bij Truckwash 1 Group? Laat het ons weten via onderstaand formulier.', '', '{}'::text[], '{}'::text[], '{}'::text[], null, '{}'::text[], 3)
on conflict (id) do nothing;

-- ===========================================================================
--  De takenmail: om 7 en om 15 uur wat er bij je ligt
--
--  Casper: "zorg ook ervoor dat iedereen om 7 uur en 15:00 uur een mail
--  krijgen met al hun todo's".
--
--  Waarom de lijst hier wordt gemaakt en niet in de serverfunctie
--  --------------------------------------------------------------
--
--  "Wat ligt er bij mij" is niet één kolom. Het is: alles wat op mijn naam
--  staat, plus alles wat bij mijn rol ligt op een vestiging waar ik bij mag --
--  want dat tweede is werk dat nog door niemand is opgepakt, en juist dat
--  hoort in een ochtendmail te staan.
--
--  Dat is dezelfde regel als isVanMij() in de app en als de policy op taak in
--  0067. Die drie horen hetzelfde te zeggen. Door hem hier neer te zetten
--  hoeft de serverfunctie niets van rollen, vestigingen of manages[] te weten
--  en kan hij niet stilletjes uit de pas gaan lopen.
--
--  Wie krijgt er een mail
--  ----------------------
--
--  Iedereen die iets open heeft staan. Niet "alle leidinggevenden": wie niets
--  te doen heeft krijgt niets, want een mail die drie keer per week leeg is,
--  is een mail die je na twee weken niet meer opent.
--
--  Uitgeschreven mensen en mensen zonder e-mailadres vallen af. Dat laatste
--  komt voor: een dossier kan bestaan zonder inlogaccount.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De uren waarop hij gaat
--
--  Als instelling en niet als vaste waarde: de serverfunctie draait elk uur
--  langs en kijkt hier of het zover is. Zeven en vijftien nu; wil Casper er
--  een derde bij, dan is dat een regel in dit veld en geen nieuwe versie.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_taken_mail_uren', 'taken_mail_uren', '7,15',
   'Op welke hele uren (Nederlandse tijd) de takenmail wordt verstuurd. '
   'Komma''s ertussen. Leeg laten zet hem uit.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  Wat er bij wie ligt
--
--  Eén rij per persoon die iets open heeft staan, met zijn taken als jsonb.
--  De serverfunctie hoeft er alleen nog een mail van te maken.
-- ---------------------------------------------------------------------------

drop function if exists public.taken_voor_mail();

create function public.taken_voor_mail()
returns table (
  profile_id text,
  naam       text,
  email      text,
  aantal     integer,
  te_laat    integer,
  taken      jsonb
)
language sql stable security definer set search_path = public as $$
  with mens as (
    select p.id, p.name, p.email,
           coalesce(p.roles, array[]::text[]) as roles,
           coalesce(p.all_locations, false)   as overal,
           /* Zijn eigen vestiging plus de vestigingen waar hij leiding over
              heeft -- dezelfde optelsom als my_locations(), maar dan voor een
              wíllekeurige persoon en niet voor de beller. */
           array_remove(
             coalesce(p.manages, array[]::text[]) || coalesce(p.location_id, ''),
             ''
           ) as locaties
      from public.profiles p
     where p.active
       and coalesce(p.email, '') <> ''
       /* Uitgeschreven staat als archived_at op het dossier; zie 0023. */
       and p.archived_at is null
  ),
  paren as (
    /* Kolom voor kolom en niet t.*: de taak heeft ook een id, en dan is "id"
       verderop dubbelzinnig -- Postgres weigert de query en zegt precies dat. */
    select m.id as wie, m.name as wie_naam, m.email as wie_mail,
           t.titel, t.prioriteit, t.status, t.deadline, t.bron,
           t.toegewezen_aan, t.created_at
      from mens m
      join public.taak t
        on t.status <> 'klaar'
       and (
             /* op zijn naam */
             t.toegewezen_aan = m.id
             /* of bij zijn rol, op een vestiging waar hij bij mag */
             or (t.toegewezen_aan is null
                 and t.toegewezen_rol is not null
                 and t.toegewezen_rol = any(m.roles)
                 and (t.location_id is null
                      or m.overal
                      or t.location_id = any(m.locaties)))
           )
  )
  select
    wie,
    wie_naam,
    wie_mail,
    count(*)::integer,
    count(*) filter (where deadline is not null
                       and deadline < (extract(epoch from now()) * 1000)::bigint)::integer,
    jsonb_agg(
      jsonb_build_object(
        'titel', titel,
        'prioriteit', prioriteit,
        'status', status,
        'deadline', deadline,
        'bron', bron,
        'vanRol', toegewezen_aan is null
      )
      /* Het dringendst bovenaan, net als in het scherm: urgent voor hoog voor
         normaal voor laag, en binnen dezelfde prioriteit de vroegste deadline.
         nulls last, want een taak zonder datum is niet dringender dan een die
         morgen af moet. */
      order by case prioriteit
                 when 'urgent' then 0 when 'hoog' then 1
                 when 'normaal' then 2 else 3 end,
               deadline nulls last,
               created_at
    )
  from paren
  group by wie, wie_naam, wie_mail;
$$;

/* Alleen de serverfunctie. Deze functie leest langs RLS heen -- ze moet wel,
   want ze maakt de lijst voor iemand anders dan de beller -- en dat is precies
   waarom niemand anders haar mag aanroepen. */
revoke execute on function public.taken_voor_mail() from public, anon, authenticated;
grant  execute on function public.taken_voor_mail() to service_role;

-- ===========================================================================
--  Documentbeheer
--
--  Casper: "Nu moet je ook documentbeheer in de app maken (...) Je moet
--  documenten@domein doen, als het daarnaartoe gestuurd wordt, dan moet het
--  daarin komen, in een algemene postvak, en dan kan iemand het bij iemand,
--  afdeling (locatie) ect zetten. Je moet dingen kunnen afschermen, zichtbaar
--  voor jezelf hebben (...) Ook een soort verkenner idee erin (...) deze
--  documenten moet je ook aan een todo kunnen neerhangen."
--
--  Wat er al was en waarom dit er los naast staat
--  ---------------------------------------------
--
--  Er staan al bestanden in dit systeem, maar allemaal met een eigenaar die
--  ze vasthoudt: een bijlage hangt aan een kostenpost (emmer "post"), een
--  contract aan een dossier (emmer "dossiers"), een foto aan een vestiging.
--  Dat is geen documentbeheer maar een bijlage bij iets anders -- je kunt er
--  niet doorheen bladeren, niets verplaatsen, en niets bewaren dat nergens
--  bij hoort.
--
--  Dit is de map waar een document zelf het onderwerp is.
--
--  Drie tabellen en een reden
--  --------------------------
--
--    doc_map       de verkenner: mappen in mappen
--    doc_bestand   het document zelf
--    doc_toegang   met wie het los is gedeeld
--
--  De toegang staat NIET als lijst in een kolom op het bestand. Dat zou
--  kunnen, maar dan kun je niet vragen "welke documenten zijn met mij
--  gedeeld" zonder elke rij te openen, en kun je er ook niet bij zetten wie
--  het deelde en wanneer. Bij een document dat is afgeschermd is dat precies
--  wat je later wilt weten.
--
--  Waarom er een emmer en een pad in de rij staan
--  ----------------------------------------------
--
--  Casper: "uiteindelijk eentje die ik kan integreren met een NAS".
--
--  Die NAS bouw ik nu niet. Maar de plek waar een bestand ligt staat daarom
--  wel als gegeven in de rij en niet als aanname in de code: opslag zegt
--  WAAR het ligt, emmer en pad zeggen waar precies. Een document dat straks
--  op de NAS staat is dan een rij met opslag = 'nas' en verder hetzelfde --
--  en niet een tweede tabel naast deze.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Wie mag er bij het documentbeheer
--
--  Dezelfde drie als bij het werk: leidinggevende, management, ontwikkelaar.
--  Daarnaast ziet iedereen wat persoonlijk bij hem is neergelegd of met hem
--  is gedeeld -- anders kun je een loonstrook wel bij iemand zetten maar ziet
--  hij hem nooit.
-- ---------------------------------------------------------------------------

create or replace function public.mag_documenten()
returns boolean language sql stable as $$
  select public.is_lead() or public.is_developer();
$$;

grant execute on function public.mag_documenten() to authenticated;

-- ---------------------------------------------------------------------------
--  De mappen
-- ---------------------------------------------------------------------------

create table if not exists public.doc_map (
  id          text primary key,
  naam        text not null,
  /* De verkenner. cascade bij verwijderen: een map weggooien haalt de mappen
     eronder mee. De bestanden niet -- die vallen terug naar het postvak, zie
     doc_bestand.map_id. Een document dat verdwijnt omdat iemand een map
     opruimde is precies wat niet mag. */
  ouder_id    text references public.doc_map(id) on delete cascade,

  /* Van welke vestiging. Null = van het hele bedrijf. */
  location_id text,

  /* Gevuld = een privémap; alleen deze persoon ziet hem en wat erin zit.
     Dat is de "zichtbaar voor jezelf" uit de opdracht. */
  eigenaar    text,

  volgorde    integer not null default 0,
  door        text,
  door_naam   text,
  created_at  bigint not null default public.now_ms(),
  updated_at  bigint not null default public.now_ms()
);

create index if not exists doc_map_ouder_idx on public.doc_map (ouder_id);
create index if not exists doc_map_loc_idx   on public.doc_map (location_id);

comment on table public.doc_map is
  'De mappenstructuur van het documentbeheer (0071). eigenaar gevuld = een '
  'privémap.';

-- ---------------------------------------------------------------------------
--  Het document
-- ---------------------------------------------------------------------------

create table if not exists public.doc_bestand (
  id           text primary key,
  naam         text not null,
  omschrijving text,

  /* Leeg = het algemene postvak. Daar komt binnen wat per mail arriveert, en
     daar blijft het tot iemand het ergens neerzet. */
  map_id       text references public.doc_map(id) on delete set null,

  /* Waar het bestand ligt. Zie de kop: dit staat als gegeven in de rij zodat
     een NAS later geen tweede tabel wordt. */
  opslag       text not null default 'supabase'
               check (opslag in ('supabase', 'nas')),
  emmer        text not null default 'documenten',
  pad          text not null,
  mime         text,
  grootte      bigint,

  bron         text not null default 'upload'
               check (bron in ('upload', 'mail', 'scan')),
  /* Bij bron = mail: het bericht waar hij uit kwam, zodat je van het document
     terug kunt naar de mail met de afzender erbij. */
  bron_id      text,

  /*
   * Wie het mag zien.
   *
   *   prive      alleen de eigenaar (en wie het los gedeeld heeft gekregen)
   *   personen   alleen wie in doc_toegang staat
   *   vestiging  iedereen met documentrechten op die vestiging
   *   rollen     iedereen met documentrechten in een van deze rollen
   *   iedereen   iedereen met documentrechten
   *
   * Standaard "vestiging" en niet "iedereen": een document hoort niet breder
   * te staan dan waar het over gaat, en de smalle stand is de stand die je
   * per ongeluk goed hebt.
   */
  zichtbaarheid text not null default 'vestiging'
                check (zichtbaarheid in ('prive', 'personen', 'vestiging', 'rollen', 'iedereen')),
  eigenaar     text,
  location_id  text,
  rollen       text[] not null default '{}',

  /* Bij wie het is neergelegd. Die ziet het altijd, ook zonder
     documentrechten -- anders kun je een contract wel bij iemand zetten maar
     krijgt hij het nooit te zien. */
  toegewezen_aan  text,
  toegewezen_naam text,

  door         text,
  door_naam    text,
  created_at   bigint not null default public.now_ms(),
  updated_at   bigint not null default public.now_ms()
);

create index if not exists doc_bestand_map_idx  on public.doc_bestand (map_id);
create index if not exists doc_bestand_loc_idx  on public.doc_bestand (location_id);
create index if not exists doc_bestand_wie_idx  on public.doc_bestand (toegewezen_aan);
create index if not exists doc_bestand_bron_idx on public.doc_bestand (bron, bron_id);

/* Eén document per bijlage uit één mail. Zonder dit maakt een mail die twee
   keer wordt aangeboden -- en dat gebeurt, webhooks worden opnieuw geprobeerd
   -- twee identieke rijen in het postvak. */
create unique index if not exists doc_bestand_uit_mail
  on public.doc_bestand (bron_id, pad) where bron = 'mail';

comment on table public.doc_bestand is
  'Documenten (0071). map_id leeg = het algemene postvak. Wie het mag zien '
  'staat in zichtbaarheid; mag_document() rekent het uit.';

-- ---------------------------------------------------------------------------
--  Los gedeeld
-- ---------------------------------------------------------------------------

create table if not exists public.doc_toegang (
  /* Een eigen id en niet document_id + profile_id als sleutel. Twee redenen,
     en de tweede is de zwaarste: de synchronisatie van de app vergelijkt elke
     tabel op één kolom die id heet, en een samengestelde sleutel komt daar
     nooit doorheen. De eerste is rij_bestaat() -- de uitweg uit de upsert-val
     (0044) zoekt op id. */
  id          text primary key,
  document_id text not null references public.doc_bestand(id) on delete cascade,
  profile_id  text not null,
  door        text,
  door_naam   text,
  created_at  bigint not null default public.now_ms(),
  updated_at  bigint not null default public.now_ms()
);

/* Twee keer dezelfde persoon bij hetzelfde document is geen tweede deling. */
create unique index if not exists doc_toegang_uniek
  on public.doc_toegang (document_id, profile_id);
create index if not exists doc_toegang_wie_idx on public.doc_toegang (profile_id);

comment on table public.doc_toegang is
  'Met wie een afgeschermd document los is gedeeld (0071), met wie het deelde '
  'en wanneer -- juist bij een afgeschermd document is dat wat je later wilt '
  'weten.';

-- ---------------------------------------------------------------------------
--  Aan een taak hangen
--
--  Casper: "deze documenten moet je ook aan een todo kunnen neerhangen".
--
--  Een eigen tabel en geen kolom op de taak: aan één taak kunnen meer
--  documenten hangen, en hetzelfde document kan bij meer taken horen -- een
--  keuringsrapport hoort bij de reparatie én bij de jaarlijkse controle.
-- ---------------------------------------------------------------------------

create table if not exists public.taak_document (
  /* Zie doc_toegang hierboven voor waarom hier een eigen id staat. */
  id          text primary key,
  taak_id     text not null references public.taak(id) on delete cascade,
  document_id text not null references public.doc_bestand(id) on delete cascade,
  door        text,
  created_at  bigint not null default public.now_ms(),
  updated_at  bigint not null default public.now_ms()
);

create unique index if not exists taak_document_uniek
  on public.taak_document (taak_id, document_id);
create index if not exists taak_document_doc_idx on public.taak_document (document_id);

-- ---------------------------------------------------------------------------
--  Mag ik bij dit document?
--
--  Op één plek, want dit wordt op vier plekken gevraagd: bij het document
--  zelf, bij de losse deling, bij de koppeling aan een taak, en bij het
--  bestand in de opslag. Vier keer dezelfde regel overtypen is drie kansen om
--  hem net iets anders op te schrijven.
--
--  security definer omdat hij doc_bestand leest terwijl er juist een regel op
--  doc_bestand wordt beoordeeld.
-- ---------------------------------------------------------------------------

create or replace function public.mag_document(doc text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.doc_bestand b
     where b.id = doc
       and (
         /* Van mij, bij mij neergelegd, of met mij gedeeld. Deze drie gelden
            altijd -- ook zonder documentrechten, anders kun je een contract
            wel bij iemand zetten maar ziet hij het nooit. */
         b.eigenaar = public.my_id()
         or b.toegewezen_aan = public.my_id()
         or exists (select 1 from public.doc_toegang t
                     where t.document_id = b.id and t.profile_id = public.my_id())

         /* En de brede standen, alleen voor wie bij het documentbeheer mag. */
         or (public.mag_documenten() and (
               b.zichtbaarheid = 'iedereen'
               or (b.zichtbaarheid = 'rollen' and b.rollen && public.my_roles())
               or (b.zichtbaarheid = 'vestiging' and public.in_my_locations(b.location_id))
             ))
       )
  );
$$;

/* Supabase geeft een nieuwe functie standaard aan PUBLIC, en daarmee ook aan
   anon. Bij een security definer-functie die leest wie wat mag zien, is dat
   een open deur -- vandaar eerst intrekken en dan gericht uitdelen. */
revoke execute on function public.mag_document(text) from public, anon;
grant  execute on function public.mag_document(text) to authenticated;

-- ---------------------------------------------------------------------------
--  Wie mag hierbij
-- ---------------------------------------------------------------------------

alter table public.doc_map       enable row level security;
alter table public.doc_bestand   enable row level security;
alter table public.doc_toegang   enable row level security;
alter table public.taak_document enable row level security;

/* --- mappen --- */

drop policy if exists doc_map_select on public.doc_map;
create policy doc_map_select on public.doc_map
  for select to authenticated
  using (
    eigenaar = public.my_id()
    or (eigenaar is null and public.mag_documenten() and public.in_my_locations(location_id))
  );

drop policy if exists doc_map_insert on public.doc_map;
create policy doc_map_insert on public.doc_map
  for insert to authenticated
  /* rij_bestaat() vooraan om dezelfde reden als overal: een upsert langs
     PostgREST beoordeelt deze regel OOK bij een gewone wijziging. Zie 0044. */
  with check (public.rij_bestaat('public.doc_map'::regclass, id)
              or (public.mag_documenten()
                  and (eigenaar is null or eigenaar = public.my_id())
                  and public.in_my_locations(location_id)));

drop policy if exists doc_map_update on public.doc_map;
create policy doc_map_update on public.doc_map
  for update to authenticated
  using (eigenaar = public.my_id()
         or (eigenaar is null and public.mag_documenten() and public.in_my_locations(location_id)))
  with check (eigenaar = public.my_id()
              or (eigenaar is null and public.mag_documenten() and public.in_my_locations(location_id)));

/* Een map weggooien haalt de mappen eronder mee (cascade) maar de bestanden
   niet: die vallen terug naar het postvak. Daarom mag dit alleen wie de map
   ook mocht maken. */
drop policy if exists doc_map_delete on public.doc_map;
create policy doc_map_delete on public.doc_map
  for delete to authenticated
  using (eigenaar = public.my_id()
         or (eigenaar is null and public.mag_documenten() and public.in_my_locations(location_id)));

/* --- documenten --- */

drop policy if exists doc_bestand_select on public.doc_bestand;
create policy doc_bestand_select on public.doc_bestand
  for select to authenticated using (public.mag_document(id));

drop policy if exists doc_bestand_insert on public.doc_bestand;
create policy doc_bestand_insert on public.doc_bestand
  for insert to authenticated
  with check (public.rij_bestaat('public.doc_bestand'::regclass, id)
              or (public.mag_documenten() and public.in_my_locations(location_id)));

drop policy if exists doc_bestand_update on public.doc_bestand;
create policy doc_bestand_update on public.doc_bestand
  for update to authenticated
  using (public.mag_documenten() and public.mag_document(id))
  with check (public.mag_documenten() and public.in_my_locations(location_id));

/* Wissen doet alleen wie er ook bij mag, en het bestand in de opslag gaat
   apart -- die twee kunnen niet in één handeling, dus de app ruimt op. */
drop policy if exists doc_bestand_delete on public.doc_bestand;
create policy doc_bestand_delete on public.doc_bestand
  for delete to authenticated
  using (public.mag_documenten() and public.mag_document(id));

/* --- delingen --- */

drop policy if exists doc_toegang_select on public.doc_toegang;
create policy doc_toegang_select on public.doc_toegang
  for select to authenticated
  using (profile_id = public.my_id() or public.mag_document(document_id));

drop policy if exists doc_toegang_insert on public.doc_toegang;
create policy doc_toegang_insert on public.doc_toegang
  for insert to authenticated
  with check (public.rij_bestaat('public.doc_toegang'::regclass, id)
              or (public.mag_documenten() and public.mag_document(document_id)));

drop policy if exists doc_toegang_delete on public.doc_toegang;
create policy doc_toegang_delete on public.doc_toegang
  for delete to authenticated
  using (public.mag_documenten() and public.mag_document(document_id));

/* --- aan een taak --- */

drop policy if exists taak_document_select on public.taak_document;
create policy taak_document_select on public.taak_document
  for select to authenticated using (public.mag_document(document_id));

drop policy if exists taak_document_insert on public.taak_document;
create policy taak_document_insert on public.taak_document
  for insert to authenticated
  with check (public.rij_bestaat('public.taak_document'::regclass, id)
              or (public.mag_document(document_id)
                  and exists (select 1 from public.taak t where t.id = taak_id)));

drop policy if exists taak_document_delete on public.taak_document;
create policy taak_document_delete on public.taak_document
  for delete to authenticated using (public.mag_document(document_id));

-- ---------------------------------------------------------------------------
--  De emmer
--
--  Dicht, net als "dossiers" en "post". Downloaden gaat met een ondertekende
--  link van zestig seconden; er is geen openbaar adres.
--
--  De leesregel hangt aan mag_document(), zodat de afscherming niet te
--  omzeilen is door het bestand rechtstreeks op te vragen. Dat is precies de
--  fout die een documentsysteem onbruikbaar maakt: de lijst verbergt iets wat
--  de opslag gewoon uitdeelt.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documenten', 'documenten', false, 52428800,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]
)
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists documenten_lezen on storage.objects;
create policy documenten_lezen on storage.objects for select to authenticated
  using (
    bucket_id = 'documenten'
    and exists (
      select 1 from public.doc_bestand b
       where b.pad = storage.objects.name
         and b.emmer = 'documenten'
         and public.mag_document(b.id)
    )
  );

/* Neerzetten mag wie bij het documentbeheer mag. De rij ernaast wordt door de
   app in dezelfde handeling gemaakt; komt die er niet, dan ligt er een
   bestand dat niemand kan lezen (de leesregel hierboven vindt geen rij) en
   dat de opruiming hieronder weghaalt. */
drop policy if exists documenten_schrijven on storage.objects;
create policy documenten_schrijven on storage.objects for insert to authenticated
  with check (bucket_id = 'documenten' and public.mag_documenten());

drop policy if exists documenten_wissen on storage.objects;
create policy documenten_wissen on storage.objects for delete to authenticated
  using (
    bucket_id = 'documenten'
    and public.mag_documenten()
    and (
      /* Het bestand van een document dat ik mag beheren, of een bestand
         waar geen rij (meer) bij hoort -- dat laatste is een halve upload en
         die hoort opgeruimd te kunnen worden. */
      exists (select 1 from public.doc_bestand b
               where b.pad = storage.objects.name and b.emmer = 'documenten'
                 and public.mag_document(b.id))
      or not exists (select 1 from public.doc_bestand b
                      where b.pad = storage.objects.name and b.emmer = 'documenten')
    )
  );

-- ---------------------------------------------------------------------------
--  En de emmer waar de post al in ligt
--
--  Een bijlage die per mail binnenkomt blijft staan waar hij staat: in de
--  emmer "post". Hem overzetten naar "documenten" zou hetzelfde bestand twee
--  keer opslaan, en de rij zegt al waar hij ligt (emmer + pad).
--
--  Maar de leesregel op die emmer (0011) laat alleen management en
--  ontwikkelaar toe. Een leidinggevende zou een document in het postvak dus
--  wél zien staan en het niet kunnen openen -- een lijst die iets toont wat
--  de opslag weigert, en dat is precies het soort fout waarvan je denkt dat
--  het aan je verbinding ligt.
--
--  Vandaar deze regel erbij. De oude voorwaarde blijft ongewijzigd staan; er
--  komt alleen een tweede weg naast: er hangt een document aan dit bestand en
--  je mag bij dat document.
-- ---------------------------------------------------------------------------

drop policy if exists post_lezen on storage.objects;
create policy post_lezen on storage.objects for select to authenticated
  using (
    bucket_id = 'post'
    and (
      public.is_management() or public.is_developer()
      or exists (
        select 1 from public.doc_bestand b
         where b.pad = storage.objects.name
           and b.emmer = 'post'
           and public.mag_document(b.id)
      )
    )
  );

-- ---------------------------------------------------------------------------
--  Het adres waar documenten binnenkomen
--
--  Casper: "Je moet documenten@domein doen".
--
--  Als instelling en niet in de code: het domein staat al als
--  inkoop_domein en het voorvoegsel hoort daar naast te kunnen staan zonder
--  dat er een versie voor uit hoeft.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_documenten_voorvoegsel', 'documenten_voorvoegsel', 'documenten',
   'Het postvak waar documenten binnenkomen, vóór de @. Post aan dit adres '
   'wordt geen kostenpost maar belandt in het algemene postvak van het '
   'documentbeheer. Leeg laten zet het uit.')
on conflict (id) do nothing;
