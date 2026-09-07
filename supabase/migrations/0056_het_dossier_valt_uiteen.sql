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
