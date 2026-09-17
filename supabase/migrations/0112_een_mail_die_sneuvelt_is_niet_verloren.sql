-- ===========================================================================
--  Een mail die sneuvelt is niet verloren
--
--  Casper: "Oke, en hoe stuur ik die notify's en dingen handmatig alsnog dan?
--  gezien ze niet gestuurd zijn door het systeem op de tijden"
--
--  Twee verschillende dingen, en ze vragen om iets anders.
--
--  1. Wat een wekker had moeten doen
--  ---------------------------------
--
--  Daar is de knop "Buiten het uur" voor (0111). Bij de takenmail deed die al
--  wat hij moest doen: iedereen krijgt zijn openstaande werk, en dat IS de
--  inhaalslag -- die taken staan er nog steeds.
--
--  Bij de ochtendmail van de voorraad niet. Die had twee remmen (het uur, en
--  één keer per dag) en de knop kon er niet omheen; hij kon alleen een
--  rapportje geven. Een gemiste ochtend bleef dus een gemiste ochtend. De
--  functie kent nu 'ochtend-nu', dat allebei die remmen overslaat, en de knop
--  gebruikt die.
--
--  2. Losse meldingen waarvan de mail sneuvelde
--  --------------------------------------------
--
--  Die zijn wél gemaakt -- de bel in de app is gegaan -- maar de mail werd
--  door Resend geweigerd. Opnieuw versturen kon niet: email_log bewaart het
--  onderwerp en de fout, maar niet de tekst, en er stond niet bij wáár die
--  mail vandaan kwam.
--
--  Nu staat dat er wel. Een mail draagt zijn herkomst: bron ('melding') en
--  bron_id (de melding zelf). De tekst hoeft niet bewaard te worden, want de
--  melding staat er nog -- en die is de bron van waarheid. Zo wordt opnieuw
--  versturen het opnieuw OPBOUWEN van dezelfde mail, en niet het napraten van
--  een kopie die intussen achterloopt.
--
--  Wat dit NIET repareert
--  ----------------------
--
--  De mails van vóór deze migratie. Die dragen geen herkomst, en de tekst is
--  nergens bewaard. Voor meldingen geldt: de bel staat nog in de app, dus het
--  werk is niet weg -- alleen het mailtje erover. Dat is te overzien; een
--  kopie van elke verstuurde mail bewaren om er ooit een te kunnen herhalen,
--  is dat niet.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Een mail draagt zijn herkomst
-- ---------------------------------------------------------------------------

alter table public.email_log add column if not exists bron    text;
alter table public.email_log add column if not exists bron_id text;

comment on column public.email_log.bron is
  'Waar deze mail vandaan kwam (0112): "melding" voor een bericht uit de app. '
  'Leeg voor alles van vóór deze migratie en voor mails zonder bron.';

comment on column public.email_log.bron_id is
  'De sleutel in die bron -- voor een melding: notifications.id. Daarmee is '
  'de mail opnieuw op te bouwen uit wat er nog staat.';

create index if not exists email_bron_idx
  on public.email_log (bron, bron_id) where bron is not null;

-- ---------------------------------------------------------------------------
--  2. Wat er mislukt is en opnieuw geprobeerd kan worden
--
--  Alleen wat een herkomst draagt en wat nog bestaat. Een melding die
--  inmiddels is weggegooid hoort niet alsnog de deur uit.
-- ---------------------------------------------------------------------------

create or replace function public.mail_opnieuw_te_proberen(hoeveel integer default 50)
returns table (
  id        text,
  bron      text,
  bron_id   text,
  naar      text,
  onderwerp text,
  fout      text,
  at        bigint
)
language sql stable security definer set search_path = public as $$
  select e.id, e.bron, e.bron_id, e.to_email, e.subject,
         coalesce(e.error, ''), e.at
    from public.email_log e
   where e.status = 'mislukt'
     and e.bron = 'melding'
     and exists (select 1 from public.notifications n where n.id = e.bron_id)
     /*
      * En niet als er daarna alsnog een geslaagde mail voor dezelfde melding
      * is uitgegaan. Anders staat hij hier eeuwig, en levert "opnieuw
      * proberen" een tweede mail op voor iets wat allang is aangekomen.
      */
     and not exists (
       select 1 from public.email_log g
        where g.bron = 'melding' and g.bron_id = e.bron_id
          and g.status = 'verstuurd' and g.at > e.at)
     and (public.is_management() or public.is_developer())
   order by e.at desc
   limit greatest(1, coalesce(hoeveel, 50));
$$;

revoke execute on function public.mail_opnieuw_te_proberen(integer) from public, anon;
grant  execute on function public.mail_opnieuw_te_proberen(integer) to authenticated, service_role;

comment on function public.mail_opnieuw_te_proberen(integer) is
  'Mislukte mails die opnieuw op te bouwen zijn uit hun bron (0112). Niet de '
  'mails van vóór deze migratie: die dragen geen herkomst.';

-- ---------------------------------------------------------------------------
--  3. En de wekker van de ochtendmail gaat nu echt als je hem forceert
-- ---------------------------------------------------------------------------

drop function if exists public.wekkers_lijst();

create or replace function public.wekkers_lijst()
returns table (
  naam      text,
  planning  text,
  functie   text,
  actie     text,
  sleutel   text,
  nu_actie  text,
  nu_uitleg text
)
language sql stable as $$
  select * from (values
    ('voorraad-direct',  '*/15 * * * *', 'trucksupply', 'direct',  'voorraad_cron_secret',
     'direct',
     'Doet hetzelfde als de wekker: kijkt welke vestigingen onder hun minimum zitten en mailt daarover. Deze kent geen uurgrens.'),
    ('voorraad-ochtend', '0 4-9 * * *',  'trucksupply', 'ochtend', 'voorraad_cron_secret',
     'ochtend-nu',
     'VERSTUURT NU ECHT de ochtendmail over alles waar niemand naar keek, ook buiten het ochtenduur en ook als die van vandaag al is gegaan.'),
    ('takenmail',        '0 4-14 * * *', 'takenmail',   'normaal', 'taken_cron_secret',
     'test',
     'VERSTUURT NU ECHT de takenmail naar iedereen met openstaand werk, ook buiten de ingestelde uren.')
  ) as t(naam, planning, functie, actie, sleutel, nu_actie, nu_uitleg);
$$;

revoke execute on function public.wekkers_lijst() from public, anon;
grant  execute on function public.wekkers_lijst() to authenticated, service_role;

comment on function public.wekkers_lijst() is
  'De wekkers, wat ze aanroepen, en hoe je ze buiten hun uur laat gaan (0107, '
  'uitgebreid in 0111 en 0112). Eén lijst, gebruikt door wekkers_instellen() '
  'én door de knoppen.';
