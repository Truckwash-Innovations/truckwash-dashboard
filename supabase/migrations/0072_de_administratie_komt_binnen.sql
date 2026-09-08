-- ===========================================================================
--  De administratie komt binnen
--
--  Aanleiding: de verbouwing van het administratiedashboard. Voordat er ook
--  maar een scherm verhuist moet dit recht staan, want anders lever ik lege
--  schermen op.
--
--  Wat er aan de hand is
--  ---------------------
--
--  heeft_recht() kijkt uitsluitend naar profiles.grants. De rol administratie
--  krijgt admin.desk, finance.view en expenses.approve uit de ROL
--  (permissions.ts), en de app schrijft een rolrecht daar bewust niet in --
--  zie togglePermission: "if (enabled && !fromRole) grants.add(...)".
--
--  Gevolg: 22 policies staan op `is_management() or heeft_recht('admin.desk')`
--  en geven een echte administratiemedewerker nul rijen. Geen foutmelding,
--  geen lege staat, gewoon een tabel die leeg blijft: verkoopfactuur,
--  verkoopregel, betaalbatch, betaalregel, exact_relatie, company_exact,
--  grootboek, kosten_tags, instellingen. Dat geldt NU al voor Kostenposten;
--  het valt alleen niemand op omdat het account dat ermee werkt ook
--  management is.
--
--  Waarom niet: heeft_recht() alle roldefaults laten lezen
--  ------------------------------------------------------
--
--  Dat was de eerste ingeving en hij is fout. Nageteld welke rechten de
--  database via heeft_recht() gebruikt en wie ze er dan bij zou krijgen:
--
--    staff.view      6 policies  -> de leidinggevende krijgt het personeel
--    hours.approve   4 policies  -> idem
--    chat.manage     3 policies  -> idem
--
--  0056 legt met zoveel woorden vast dat staff.view voor een leidinggevende
--  juist false hoort te zijn. Een regel die dat stilletjes omdraait is precies
--  het soort wijziging waarvan je een half jaar later niet meer weet dat je
--  hem hebt gedaan. Dus niet alles, maar een lijst die je kunt lezen.
--
--  Wat het wel wordt: een brug die je kunt navragen
--  -----------------------------------------------
--
--  Een tabel, rol_recht, met precies de rolrechten die de database mag
--  afleiden. Vandaag staan daar alleen de vijf rijen van de administratie in.
--  Wil je er later een bij, dan is dat een regel in een migratie en geen
--  nieuwe policy -- en `select * from rol_recht` vertelt je zonder graven wat
--  de database aanneemt.
--
--  Een intrekking wint. Zet het management admin.desk bij iemand uit, dan gaat
--  de brug dicht. Dat werkte bij grants niet en werkt hier wel; de grants-kant
--  laat ik met opzet staan zoals hij was, dat is een aparte beslissing.
--
--  Verder in deze migratie
--  -----------------------
--
--    * mailbox_select/_update/_insert en post_lezen: de postbus en de
--      bijlagen. Select alleen verruimen is een val -- Postbus markeert een
--      bericht als gelezen zodra je erop klikt, dus zonder _update loopt de
--      wachtrij vast op elk geopend bericht.
--    * instellingen_insert/_update voor de boekhoudsleutels, naar het model
--      van is_trucksupply_instelling(). Niet alle sleutels: app_url en de
--      sleutels van de Exact-koppeling blijven van het management.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. De brug van rol naar recht
-- ---------------------------------------------------------------------------

create table if not exists public.rol_recht (
  rol        text not null,
  recht      text not null,
  waarom     text,
  primary key (rol, recht)
);

comment on table public.rol_recht is
  'Welke rechten de database uit een ROL mag afleiden. Bewust een korte lijst: permissions.ts geeft er veel meer, maar niet alles hoort de database te weten.';

alter table public.rol_recht enable row level security;

/* Wie ingelogd is mag deze lijst lezen -- het is geen geheim wat de regels
   zijn, en heeft_recht() draait als security definer dus die komt er sowieso
   bij. Schrijven doet alleen een migratie. */
drop policy if exists rol_recht_select on public.rol_recht;
create policy rol_recht_select on public.rol_recht for select to authenticated
  using (true);

insert into public.rol_recht (rol, recht, waarom) values
  ('administratie', 'admin.desk',
   'De boekhouding: verkoopfacturen, betalen, relaties, grootboek, instellingen.'),
  ('administratie', 'finance.view',
   'Een kostenpost beoordelen zonder de maand te zien is stempelen.'),
  ('administratie', 'expenses.approve',
   'De eerste handtekening onder een bon.'),
  ('administratie', 'expenses.read',
   'De bon zelf mogen openen, niet alleen de regel eromheen.'),
  ('administratie', 'mail.read',
   'De inkoopmail is waar de bonnen vandaan komen.')
on conflict (rol, recht) do update set waarom = excluded.waarom;

-- ---------------------------------------------------------------------------
--  2. heeft_recht() kijkt ook over de brug
--
--  De grants-kant blijft letterlijk wat hij was. Erbij komt: het recht dat een
--  rol geeft en dat in rol_recht staat, tenzij het bij deze persoon is
--  ingetrokken.
-- ---------------------------------------------------------------------------

create or replace function public.heeft_recht(recht text)
returns boolean language sql stable security definer set search_path = public as $$
  select recht = any(
           coalesce((select grants from public.profiles where auth_id = auth.uid()),
                    array[]::text[]))
      or (
        not (recht = any(
               coalesce((select revokes from public.profiles where auth_id = auth.uid()),
                        array[]::text[])))
        and exists (
          select 1 from public.rol_recht rr
           where rr.recht = heeft_recht.recht
             and rr.rol = any(public.my_roles())
        )
      );
$$;

/* Supabase geeft elke nieuwe functie aan PUBLIC. Deze bestond al, maar
   `create or replace` zet de rechten niet vanzelf terug. */
revoke execute on function public.heeft_recht(text) from public, anon;
grant  execute on function public.heeft_recht(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  3. is_administratie(), voor policies die een rol noemen
--
--  Naast is_management() en is_trucksupply(). Nodig waar er geen recht in het
--  spel is maar een rol, zoals bij de postbus.
-- ---------------------------------------------------------------------------

create or replace function public.is_administratie()
returns boolean language sql stable security definer set search_path = public as $$
  select 'administratie' = any(public.my_roles());
$$;

revoke execute on function public.is_administratie() from public, anon;
grant  execute on function public.is_administratie() to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  4. De postbus
--
--  De app laat de administratie al binnen (permissions.ts geeft de rol
--  mail.read en Postbus.tsx kijkt daarnaar), de database niet. Dat levert geen
--  foutmelding op maar een leeg scherm -- erger dan geen toegang, want het
--  liegt.
--
--  _update moet mee. Postbus markeert een bericht als gelezen op het moment
--  dat je erop klikt; dat is een put, die gaat de wachtrij in, en een
--  weigering daar blijft staan en wordt elke synchronisatieronde opnieuw
--  geprobeerd.
-- ---------------------------------------------------------------------------

drop policy if exists mailbox_select on public.mailbox;
create policy mailbox_select on public.mailbox for select to authenticated
  using (public.is_management() or public.is_developer() or public.is_administratie());

drop policy if exists mailbox_update on public.mailbox;
create policy mailbox_update on public.mailbox for update to authenticated
  using (public.is_management() or public.is_developer() or public.is_administratie())
  with check (public.is_management() or public.is_developer() or public.is_administratie());

drop policy if exists mailbox_insert on public.mailbox;
create policy mailbox_insert on public.mailbox for insert to authenticated
  with check (
    public.rij_bestaat('public.mailbox'::regclass, id::text)
    or public.is_management() or public.is_developer() or public.is_administratie()
  );

/* Wissen blijft bij het management. Een bericht weggooien is iets anders dan
   het lezen, en de administratie heeft er geen reden voor. */

-- ---------------------------------------------------------------------------
--  5. De bijlagen bij die berichten
--
--  Zonder deze regel zie je de naam van de bijlage wel staan en gaat er niets
--  open: createSignedUrl faalt op de emmer. Precies de leesketen waar de
--  verbouwing een beeld-terugval op wil bouwen.
-- ---------------------------------------------------------------------------

drop policy if exists post_lezen on storage.objects;
create policy post_lezen on storage.objects for select to authenticated
  using (
    bucket_id = 'post'
    and (
      public.is_management() or public.is_developer() or public.is_administratie()
      or exists (
        select 1 from public.doc_bestand b
         where b.pad = storage.objects.name
           and b.emmer = 'post'
           and public.mag_document(b.id)
      )
    )
  );

-- ---------------------------------------------------------------------------
--  6. De instellingen die bij de boekhouding horen
--
--  instellingen_select liet admin.desk al door, _insert en _update niet. Dat
--  is de stilste fout van allemaal: Dexie slaat het lokaal op, het scherm zegt
--  "opgeslagen", en de rij blijft op een 42501 in de wachtrij hangen.
--
--  Niet alle sleutels. Naar het model van is_trucksupply_instelling(): een
--  lijst die je kunt lezen. app_url en site_url horen bij het management --
--  daar wijst elke knop in elke mail heen. exact_division ook niet: die staat
--  al op de lijst van trucksupply en wordt door de serverfunctie geschreven,
--  die met de servicesleutel werkt en dus buiten RLS om gaat.
-- ---------------------------------------------------------------------------

create or replace function public.is_boekhoud_instelling(sleutel text)
returns boolean language sql stable as $$
  /* Nageteld tegen de sleutels die echt bestaan, niet tegen wat logisch
     klinkt: een sleutel die nergens wordt gelezen staat hier voor niets, en
     een die ik verkeerd spel valt stil buiten de lijst. */
  select sleutel in (
    /* het lezen van facturen */
    'factuur_lezer', 'factuur_automatisch',
    'lezer_model', 'lezer_stand', 'lezer_laatst_gezien',
    'auto_goedkeuren', 'auto_goedkeuren_marge',
    'auto_goedkeuren_max', 'auto_goedkeuren_vanaf',
    'vier_ogen', 'vier_ogen_vanaf',
    /* waar het heen wordt geboekt */
    'exact_facturen', 'exact_dagboek', 'exact_verkoopdagboek',
    'exact_btw_21', 'exact_btw_9', 'exact_btw_0',
    /* de eigen gegevens op een verkoopfactuur */
    'eigen_kvk', 'eigen_btw', 'eigen_iban',
    /* waar de inkoopmail binnenkomt */
    'inkoop_domein', 'inkoop_voorvoegsel'
  )
$$;

revoke execute on function public.is_boekhoud_instelling(text) from public, anon;
grant  execute on function public.is_boekhoud_instelling(text) to authenticated, service_role;

drop policy if exists instellingen_insert on public.instellingen;
create policy instellingen_insert on public.instellingen for insert to authenticated
  with check (
    public.rij_bestaat('public.instellingen'::regclass, id)
    or public.is_management()
    or (public.heeft_recht('admin.desk') and public.is_boekhoud_instelling(sleutel))
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  );

drop policy if exists instellingen_update on public.instellingen;
create policy instellingen_update on public.instellingen for update to authenticated
  using (
    public.is_management()
    or (public.heeft_recht('admin.desk') and public.is_boekhoud_instelling(sleutel))
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  )
  with check (
    public.is_management()
    or (public.heeft_recht('admin.desk') and public.is_boekhoud_instelling(sleutel))
    or ((public.is_trucksupply() or public.heeft_recht('supply.settings'))
        and public.is_trucksupply_instelling(sleutel))
  );
