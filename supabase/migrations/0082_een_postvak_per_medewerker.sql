-- ===========================================================================
--  Een postvak per medewerker
--
--  Casper: "Vervolgens krijgen ze ook toegang tot een soort outlook omgeving
--  (...) Dit zorgt ervoor dat we alles van microsoft inruilen."
--
--  0081 gaf iedereen een adres. Hier komt het postvak erachter.
--
--  Hoe de post binnenkomt
--  ----------------------
--
--  Via Resend, net als de inkoopfacturen. Dat is nagekeken voordat dit werd
--  gebouwd, want het bepaalt of het überhaupt mag:
--
--    * Resend kan sinds 2025 post ONTVANGEN op een geverifieerd domein, als
--      webhook met de bijlagen erbij. Dat is dezelfde weg die ontvang-mail
--      al gebruikt.
--    * Hun voorwaarden verbieden gewone bedrijfscorrespondentie niet. Ze
--      verbieden ongevraagde post, en dat is iets anders.
--    * Ontvangen post telt mee voor de limiet. Op de gratis laag is dat 100
--      per dag inclusief inkomend, en dat is voor een bedrijf niets. Vanaf de
--      betaalde laag vervalt de daglimiet.
--
--  Er is dus geen IMAP en geen POP: de post staat hier, in onze database, en
--  het mailprogramma is een scherm in deze app. Dat is een keuze met een
--  gevolg dat je moet weten -- Outlook of de Mail-app van je telefoon kunnen
--  er niet bij. Wat je ervoor terugkrijgt is dat de post op dezelfde plek
--  staat als de facturen, de taken en de dossiers.
--
--  Van wie is een postvak
--  ----------------------
--
--  Van de medewerker. Niet van het management.
--
--  Dat is geen technische keuze maar een juridische: een werkgever mag niet
--  zomaar in de mail van een werknemer kijken. Er staat daarom geen enkele
--  regel in die het management toegang geeft -- ook niet "voor het geval
--  dat". Wie dat ooit nodig heeft (iemand valt uit, er loopt een onderzoek)
--  moet daar een aparte weg voor maken, met een reden die wordt vastgelegd.
--  Een deur die er al staat wordt gebruikt.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De post
-- ---------------------------------------------------------------------------

create table if not exists public.werkmail (
  id          text primary key,
  /* Van wie dit postvak is. Alles hangt hieraan, ook de beveiliging. */
  user_id     text not null references public.profiles(id) on delete cascade,

  richting    text not null default 'in' check (richting in ('in','uit')),
  /*
   * Waar hij staat. Geen vrije mappen: vier vaste plekken is wat mensen
   * werkelijk gebruiken, en een mappenboom die iedereen zelf mag verzinnen is
   * een mappenboom waarin post zoekraakt.
   */
  map         text not null default 'postvak'
              check (map in ('postvak','verzonden','concept','archief','prullenbak')),

  van         text not null default '',
  van_naam    text,
  /* Meerdere ontvangers. Als lijst en niet als tekst met komma's: "Jan, Piet"
     <jan@..> is een adres waar elke splitsing op stukloopt. */
  aan         text[] not null default '{}',
  cc          text[] not null default '{}',

  onderwerp   text not null default '',
  /*
   * Platte tekst. De app toont dit nooit als HTML -- een mail van buiten is
   * per definitie niet te vertrouwen, en dat is bij persoonlijke post nog
   * meer waar dan bij een factuur. Zelfde afspraak als bij mailbox (0011).
   */
  tekst       text not null default '',
  had_html    boolean not null default false,

  /*
   * De draad. Wat erbij hoort krijgt dezelfde waarde, zodat een gesprek als
   * gesprek te tonen is. Zie werkmail_draad() hieronder voor hoe hij wordt
   * bepaald; het staat als kolom en niet als berekening omdat het antwoord
   * niet mag veranderen als iemand later het onderwerp aanpast.
   */
  draad       text,
  /* De Message-ID van het bericht waarop dit een antwoord is. */
  antwoord_op text,
  /* De eigen Message-ID, zodat een antwoord van de ander terugvindt waar het
     bij hoort. */
  bericht_id  text,

  at          bigint not null default public.now_ms(),
  gelezen_at  bigint,
  ster        boolean not null default false,

  /* [{naam, mime, size, pad}] -- in de emmer werkmail, onder <user_id>/ */
  bijlagen    jsonb not null default '[]'::jsonb,

  /* Wat Resend ervan maakte; voor als er iets niet klopt. */
  provider_id text,
  /* Alleen bij richting 'uit' en alleen als het versturen misging. */
  fout        text,

  updated_at  bigint not null default public.now_ms()
);

create index if not exists werkmail_postvak_idx on public.werkmail (user_id, map, at desc);
create index if not exists werkmail_draad_idx   on public.werkmail (user_id, draad, at);
create index if not exists werkmail_updated_idx on public.werkmail (updated_at);
/* Voor het terugvinden van de draad bij een binnenkomend antwoord. */
create index if not exists werkmail_bericht_idx on public.werkmail (bericht_id)
  where bericht_id is not null;

comment on table public.werkmail is
  'De persoonlijke post van een medewerker (0082). Van hem, niet van het '
  'management: er staat met opzet geen enkele regel in die een ander toegang '
  'geeft.';

drop trigger if exists stamp_werkmail on public.werkmail;
create trigger stamp_werkmail before insert or update on public.werkmail
  for each row execute function public.stamp_updated_at();

/* Verwijderingen melden, anders houdt elk toestel een leeggegooide prullenbak
   vol post die er niet meer is (0032, 0038). */
drop trigger if exists werkmail_verwijderd on public.werkmail;
create trigger werkmail_verwijderd after delete on public.werkmail
  for each row execute function public.meld_verwijdering();

-- ---------------------------------------------------------------------------
--  Welk postvak hoort bij dit adres?
--
--  Eén plek, want de post vraagt het bij elke binnenkomende mail en het
--  antwoord moet hetzelfde zijn als wat het scherm laat zien.
--
--  Alleen een postvak dat OPENSTAAT. Een adres dat gereserveerd is maar uit
--  staat hoort geen post aan te nemen -- dat is het verschil tussen "dit
--  adres is van Jan" en "Jan werkt hier nog".
-- ---------------------------------------------------------------------------

create or replace function public.werkmail_eigenaar(adres text)
returns text
language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
   where lower(p.werk_email) = lower(trim(coalesce(adres, '')))
     and p.werk_mail_aan
     and p.active
     and p.archived_at is null
   limit 1;
$$;

revoke execute on function public.werkmail_eigenaar(text) from public, anon;
grant  execute on function public.werkmail_eigenaar(text) to service_role;

-- ---------------------------------------------------------------------------
--  Bij welke draad hoort dit?
--
--  Eerst op het bericht waarop geantwoord wordt -- dat is hard. Anders op het
--  onderwerp zonder de voorvoegsels, want daar is het bij de meeste post aan
--  te herkennen.
--
--  Bewust niet slimmer. Twee losse mails met hetzelfde onderwerp aan elkaar
--  plakken is vervelend; een antwoord dat níet bij zijn vraag komt te staan is
--  erger, en dat is precies wat er gebeurt als je alleen op onderwerp gaat en
--  iemand "Re: " weglaat.
-- ---------------------------------------------------------------------------

create or replace function public.werkmail_draad(
  eigenaar text,
  onderwerp_in text,
  antwoord_op_in text
)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    /* 1. het bericht waarop dit een antwoord is */
    (select m.draad from public.werkmail m
      where m.user_id = eigenaar
        and m.bericht_id is not null
        and m.bericht_id = antwoord_op_in
      limit 1),
    /* 2. hetzelfde onderwerp, ontdaan van Re: en Fwd: */
    nullif(lower(trim(regexp_replace(
      coalesce(onderwerp_in, ''), '^((re|fw|fwd|antw)\s*(\[[0-9]+\])?\s*:\s*)+', '', 'i'))), ''),
    /* 3. geen onderwerp: dan staat hij op zichzelf */
    'los-' || md5(random()::text)
  );
$$;

revoke execute on function public.werkmail_draad(text, text, text) from public, anon;
grant  execute on function public.werkmail_draad(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
--  Wie mag erbij
--
--  Alleen de eigenaar. Zie de kop voor waarom er geen regel voor het
--  management bij staat.
-- ---------------------------------------------------------------------------

alter table public.werkmail enable row level security;

drop policy if exists werkmail_select on public.werkmail;
create policy werkmail_select on public.werkmail for select to authenticated
  using (user_id = public.my_id());

/*
 * rij_bestaat() vooraan, om dezelfde reden als overal: de app stuurt een
 * gewijzigde rij als geheel op, en PostgREST beoordeelt die upsert óók tegen
 * de insertregel. Zonder deze uitweg wordt "als gelezen markeren" geweigerd
 * met een melding over een nieuwe rij. Zie 0031 en 0040.
 */
drop policy if exists werkmail_insert on public.werkmail;
create policy werkmail_insert on public.werkmail for insert to authenticated
  with check (
    public.rij_bestaat('public.werkmail'::regclass, id)
    or user_id = public.my_id()
  );

drop policy if exists werkmail_update on public.werkmail;
create policy werkmail_update on public.werkmail for update to authenticated
  using (user_id = public.my_id())
  with check (user_id = public.my_id());

drop policy if exists werkmail_delete on public.werkmail;
create policy werkmail_delete on public.werkmail for delete to authenticated
  using (user_id = public.my_id());

/*
 * Wat een mens aan zijn eigen post mag veranderen.
 *
 * Verplaatsen, als gelezen markeren, een ster erop -- dat is het. De inhoud
 * van een ontvangen bericht staat vast: een postvak waarin je de tekst van een
 * binnengekomen mail kunt herschrijven is geen postvak maar een kladblok, en
 * dan is er later niets meer mee aan te tonen.
 *
 * Een concept mag wél volledig gewijzigd worden -- daar ben je nog aan het
 * schrijven.
 */
create or replace function public.werkmail_bewaak()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /* De server (ontvangen en versturen) heeft geen my_id() en mag alles. */
  if public.my_id() is null then return new; end if;
  if old.map = 'concept' then return new; end if;

  new.van         := old.van;
  new.van_naam    := old.van_naam;
  new.aan         := old.aan;
  new.cc          := old.cc;
  new.onderwerp   := old.onderwerp;
  new.tekst       := old.tekst;
  new.bijlagen    := old.bijlagen;
  new.at          := old.at;
  new.richting    := old.richting;
  new.user_id     := old.user_id;
  new.draad       := old.draad;
  new.bericht_id  := old.bericht_id;
  new.provider_id := old.provider_id;
  return new;
end $$;

drop trigger if exists werkmail_bewaak_trg on public.werkmail;
create trigger werkmail_bewaak_trg before update on public.werkmail
  for each row execute function public.werkmail_bewaak();

-- ---------------------------------------------------------------------------
--  De bijlagen
--
--  Een eigen emmer, dicht. Het pad begint met het id van de eigenaar, en
--  daar hangt de leesregel aan -- zo kan niemand een bijlage van een collega
--  ophalen door het pad te raden.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('werkmail', 'werkmail', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists werkmail_bijlage_lezen on storage.objects;
create policy werkmail_bijlage_lezen on storage.objects for select to authenticated
  using (
    bucket_id = 'werkmail'
    /* Het eerste stuk van het pad is het id van de eigenaar. */
    and split_part(name, '/', 1) = public.my_id()
  );

drop policy if exists werkmail_bijlage_schrijven on storage.objects;
create policy werkmail_bijlage_schrijven on storage.objects for insert to authenticated
  with check (
    bucket_id = 'werkmail'
    and split_part(name, '/', 1) = public.my_id()
  );

drop policy if exists werkmail_bijlage_wissen on storage.objects;
create policy werkmail_bijlage_wissen on storage.objects for delete to authenticated
  using (
    bucket_id = 'werkmail'
    and split_part(name, '/', 1) = public.my_id()
  );

-- ---------------------------------------------------------------------------
--  Een handtekening onder de mail
--
--  Per persoon, want dat is wat het is. Leeg betekent geen handtekening.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists mail_handtekening text;

comment on column public.profiles.mail_handtekening is
  'Wat er onder een uitgaande mail komt (0082). Platte tekst; de app maakt er '
  'geen HTML van, want dan is het een opmaakprobleem in plaats van een naam.';

/*
 * En die mag je wél zelf zetten -- het is je eigen naam eronder. Dus hij komt
 * NIET in de rem van profiel_bewaak_wijziging(). Dat staat hier met zoveel
 * woorden omdat elke andere kolom die er de laatste migraties bij kwam juist
 * wél in die lijst hoort, en "vergeten" de gewone verklaring zou zijn.
 */
