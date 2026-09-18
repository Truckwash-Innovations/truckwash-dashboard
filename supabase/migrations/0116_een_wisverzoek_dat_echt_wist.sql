-- ===========================================================================
--  Een wisverzoek dat echt wist
--
--  Draai dit ná 0115. Opnieuw draaien mag.
--
--  Wat er stond
--  ------------
--
--  De knop "wissen" in het medewerkerscherm is bedoeld voor het zwaarste
--  geval: iemand wil dat zijn gegevens weg zijn. De serverfunctie schrijft
--  een regel in het verwijderlogboek, haalt het inlogaccount weg en
--  verwijdert de rij in profiles.
--
--  Daar houdt het op. En `user_id` in de dossiertabellen is een gewone
--  tekstkolom zonder foreign key, dus er cascadeert niets:
--
--      personnel_private   geboortedatum, nationaliteit, documentnummer, BSN
--      personnel_loon      rekeningnummer, uurloon, interne notities
--      documents           de dossierstukken, waaronder de scan van het
--                          identiteitsbewijs -- voor- én achterkant
--      change_requests     de wijzigingsverzoeken op dat dossier
--
--  Die vier blijven staan. Iemand die om verwijdering vraagt en dat
--  bevestigd krijgt, houdt zijn paspoort bij ons in het systeem. Er is geen
--  scherm waarop dat nog te zien is, dus het valt ook niet op.
--
--  Wat het wordt
--  -------------
--
--  Een trigger op profiles die de vier meeneemt. Bewust hier en niet in de
--  serverfunctie: dit moet ook gelden als iemand ooit een rij rechtstreeks
--  weghaalt, en een regel die je kunt omzeilen door een andere deur te
--  nemen is geen regel.
--
--  De vier tabellen krijgen er ook een verwijdermelding bij. Zonder die
--  melding blijven de rijen in de lokale kopie op elk toestel staan -- dan
--  heb je ze centraal gewist en staan ze nog op vijf tablets. Dat is dezelfde
--  fout die 0038 voor de andere tabellen rechtzette.
--
--  WAT DEZE MIGRATIE NIET KAN
--  --------------------------
--
--  De bestanden zelf. Een scan van een identiteitsbewijs staat in de
--  opslagemmer `dossiers`, en daar komt de database niet bij. Die moeten weg
--  via de serverfunctie; zie supabase/functions/medewerker/index.ts. Blijft
--  dat achterwege, dan is de databaserij weg en het plaatje niet.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Het dossier gaat mee
-- ---------------------------------------------------------------------------

create or replace function public.dossier_mee_verwijderen()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.change_requests   where user_id = old.id;
  delete from public.documents         where user_id = old.id;
  delete from public.personnel_loon    where user_id = old.id;
  delete from public.personnel_private where user_id = old.id;
  return old;
end;
$$;

comment on function public.dossier_mee_verwijderen() is
  'Haalt het dossier weg zodra het profiel weggaat (0116). De bestanden in de '
  'emmer dossiers vallen hierbuiten; die doet de serverfunctie.';

drop trigger if exists profiel_neemt_dossier_mee on public.profiles;
create trigger profiel_neemt_dossier_mee after delete on public.profiles
  for each row execute function public.dossier_mee_verwijderen();

-- ---------------------------------------------------------------------------
--  2. En elk toestel hoort het
--
--  De vier tabellen hadden geen verwijdermelding. Zonder die melding weet een
--  tablet niet dat er iets weg is en blijft de rij in de lokale kopie staan.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['personnel_private', 'personnel_loon',
                           'documents', 'change_requests'] loop
    execute format('drop trigger if exists %1$s_verwijderd on public.%1$I', t);
    execute format(
      'create trigger %1$s_verwijderd after delete on public.%1$I
       for each row execute function public.meld_verwijdering()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  3. Wat er nu nog staat van mensen die al weg zijn
--
--  Deze migratie repareert de regel voor de toekomst. Wat er in het verleden
--  is blijven staan gaat niet vanzelf weg -- dat zijn dossierrijen van
--  profielen die niet meer bestaan.
--
--  Bewust GEEN automatische opruiming hier. Een migratie die ongevraagd
--  persoonsgegevens verwijdert is precies het soort ding dat je niet wilt
--  als de aanname eronder niet klopt. Kijk eerst wat er staat:
--
--      select * from public.dossier_wezen();
--
--  en ruim daarna gericht op, met de uitkomst erbij in het dossier van het
--  AVG-verzoek waar het bij hoort.
-- ---------------------------------------------------------------------------

create or replace function public.dossier_wezen()
returns table (tabel text, hoeveel bigint)
language sql stable security definer set search_path = public as $$
  select 'personnel_private', count(*) from public.personnel_private x
    where not exists (select 1 from public.profiles p where p.id = x.user_id)
  union all
  select 'personnel_loon', count(*) from public.personnel_loon x
    where not exists (select 1 from public.profiles p where p.id = x.user_id)
  union all
  select 'documents', count(*) from public.documents x
    where not exists (select 1 from public.profiles p where p.id = x.user_id)
  union all
  select 'change_requests', count(*) from public.change_requests x
    where not exists (select 1 from public.profiles p where p.id = x.user_id);
$$;

revoke execute on function public.dossier_wezen() from public, anon, authenticated;

comment on function public.dossier_wezen() is
  'Hoeveel dossierrijen er nog staan van profielen die niet meer bestaan '
  '(0116). Alleen voor de server; draai hem voordat je opruimt.';
