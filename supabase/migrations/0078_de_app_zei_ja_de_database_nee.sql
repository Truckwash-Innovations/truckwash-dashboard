-- ===========================================================================
--  De app zei ja en de database nee
--
--  Casper: "bij het downloaden krijg ik nog steeds die fout, evenals bij
--  verzenden in chat ... fix dit permanent"
--
--    docBestanden   new row violates row-level security policy for doc_bestand
--    chatMessages   new row violates row-level security policy for chat_messages
--
--  Niet gegokt maar nagespeeld
--  ---------------------------
--
--  scripts/naspeuren.mjs bouwt het hele schema op in een echte PostgreSQL,
--  zet een profiel neer zoals dat in productie staat -- rol management,
--  all_locations op de standaardwaarde, geen losse rechten -- en probeert
--  precies deze twee inserts. Uitkomst:
--
--    document zonder vestiging        LUKT
--    document op de EIGEN vestiging   LUKT
--    document op een ANDERE vestiging FAALT   <--
--
--    bericht in een open kanaal                  LUKT
--    bericht in een prive kanaal, geen lid       FAALT
--    bericht in een kanaal dat er niet is        FAALT   <--
--
--    een kanaal aanmaken zonder returning        LUKT
--    een kanaal aanmaken MET returning           FAALT   <--
--
--  Drie verschillende oorzaken achter een en dezelfde melding. Vandaar dat
--  dit niet eerder is gevonden: de foutmelding wijst naar de insertregel, en
--  bij twee van de drie is daar niets mis mee.
--
--  ========================================================================
--  1. sees_all_locations() kende de rechten van een ROL niet
--  ========================================================================
--
--  De oorzaak van het documentprobleem.
--
--      create function public.sees_all_locations() ...
--        select coalesce((select all_locations from profiles ...), false)
--            or 'locations.all' = any(coalesce((select grants from profiles ...), ...));
--
--  Hij leest de KOLOM all_locations en de losse GRANTS. Wat een rol
--  meebrengt, staat in geen van beide: de roldefaults staan in
--  src/lib/permissions.ts, en togglePermission() schrijft ze met opzet niet
--  in grants (`if (enabled && !fromRole) grants.add(...)`).
--
--  locations.all is een roldefault van vier rollen: management, developer,
--  administratie en trucksupply. Voor al die vier zei de app dus "je ziet
--  alle vestigingen" en de database "alleen die van jezelf". Zolang je iets
--  op je eigen vestiging deed viel dat niet op.
--
--  0072 heeft hiervoor de brug gebouwd -- de tabel rol_recht, gelezen door
--  heeft_recht(). Deze functie ging daar alleen niet langs; hij las grants
--  rechtstreeks. Nu wel.
--
--  DIT IS EEN VERRUIMING, en die hoort hardop te staan: de administratie ziet
--  hierna in elke in_my_locations-regel de gegevens van alle achttien
--  vestigingen. Dat is wat permissions.ts al beloofde en wat het werk ook
--  vraagt -- een inkoopfactuur van Venlo boeken kan niet als je Venlo niet
--  mag zien -- maar het is een verruiming en geen reparatie van een tikfout.
--
--  ========================================================================
--  2. Een leesregel die zijn eigen tabel opnieuw bevraagt
--  ========================================================================
--
--  De oorzaak van "een kanaal aanmaken MET returning faalt", en een landmijn
--  die er in twee tabellen lag.
--
--      channels_select     using (is_staff() and can_see_channel(id))
--      doc_bestand_select  using (mag_document(id))
--
--  Beide functies zijn `stable security definer` en doen een EIGEN query op
--  dezelfde tabel: "bestaat er een rij met dit id waar ik bij mag". Tijdens
--  een insert bestaat die rij nog niet in de momentopname die zo'n functie
--  ziet. Dus geeft hij onwaar, en wordt de RETURNING-select geweigerd --
--  waarna PostgreSQL meldt dat de NIEUWE RIJ de beveiligingsregel schendt.
--  Die melding wijst naar de insertregel, en daar is niets mis mee.
--
--  Bewezen in de naspeuring: dezelfde insert zonder returning lukt, en direct
--  daarna geeft mag_document() gewoon true.
--
--  Waarom dit nu geen storing is en toch gevaarlijk: de synchronisatie doet
--  een upsert zonder .select(), en dan stuurt PostgREST
--  "Prefer: return=minimal" en staat er geen returning in de opdracht. Eén
--  .select() erbij -- of een scherm dat zelf een kanaal aanmaakt en het
--  resultaat wil -- en het overleg valt om, met een foutmelding die de
--  verkeerde kant op wijst.
--
--  De regels lezen nu de kolommen van de rij zelf. Dat kan wel tijdens een
--  insert: die waarden staan in NEW.
--
--  ========================================================================
--  3. Een bericht in een kanaal dat alleen plaatselijk bestaat
--  ========================================================================
--
--  Daar kan de database niets aan doen, en dat hoort ook zo: een bericht
--  toelaten in een kanaal dat de server niet kent, betekent berichten
--  toelaten in elk verzonnen kanaal-id.
--
--  Dat deel is app-werk en staat in src/lib/sync.ts: wordt een bericht
--  geweigerd, dan wordt het kanaal opnieuw in de wachtrij gezet. Zie de
--  uitleg daar.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. De brug erbij, en de functie erlangs
-- ---------------------------------------------------------------------------

insert into public.rol_recht (rol, recht, waarom) values
  ('management',    'locations.all', 'Het management werkt over alle vestigingen; permissions.ts zegt dat al.'),
  ('developer',     'locations.all', 'Meekijken en fouten opsporen kan niet op een van de achttien.'),
  ('administratie', 'locations.all', 'Een inkoopfactuur van Venlo boeken kan niet als je Venlo niet mag zien.'),
  ('trucksupply',   'locations.all', 'De leverancier ziet de voorraad van alle vestigingen (0048).')
on conflict (rol, recht) do update set waarom = excluded.waarom;

create or replace function public.sees_all_locations()
returns boolean language sql stable security definer set search_path = public as $$
  select (
      coalesce(
        (select all_locations from public.profiles where auth_id = auth.uid()),
        false
      )
      /*
       * Via heeft_recht() en niet rechtstreeks in grants kijken.
       *
       * Hier stond een eigen select op de kolom grants. Die kolom bevat
       * alleen wat er LOS is toegekend; wat een rol meebrengt staat in
       * permissions.ts en wordt daar met opzet niet in weggeschreven.
       * Gevolg: vier rollen die volgens de app alle vestigingen zien, zagen
       * er in de database een.
       */
      or public.heeft_recht('locations.all')
    )
    /*
     * En een intrekking wint van alles.
     *
     * Dit stukje staat er niet voor de sier. heeft_recht() laat een LOS
     * toegekend recht voorgaan op een intrekking -- dat is daar met opzet zo
     * (0072), want een grant is een uitdrukkelijke keuze van het management.
     * Hier hoort het andersom: dit is de deur naar alle achttien
     * vestigingen, en als iemand hem bij een persoon dichtzet, dan is hij
     * dicht -- ook als diezelfde persoon het recht ooit los heeft gekregen
     * en ook als de vlag all_locations nog op zijn dossier staat.
     *
     * sqltest hoofdstuk 12 legt dat vast ("intrekken wint van toekennen") en
     * viel om toen deze functie via heeft_recht ging. Dat is precies waarvoor
     * die controle er staat: de afspraak stond in een test en niet in mijn
     * hoofd.
     */
    and not ('locations.all' = any(coalesce(
      (select revokes from public.profiles where auth_id = auth.uid()),
      array[]::text[]
    )));
$$;

/* Zie 0034: Supabase geeft elke nieuwe functie aan PUBLIC en anon. */
revoke execute on function public.sees_all_locations() from public, anon;
grant  execute on function public.sees_all_locations() to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  2. Twee leesregels die naar de rij zelf kijken
--
--  Woordelijk dezelfde voorwaarden als in de functies -- alleen niet meer
--  opgehaald met een tweede query, maar gelezen uit de kolommen van de rij
--  die er is (of die er net in gaat).
-- ---------------------------------------------------------------------------

drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels for select to authenticated
  using (
    public.is_staff()
    and (
      -- lid van het kanaal
      public.my_id() = any(member_ids)
      -- of het is open, en geen vestigingskanaal van een andere vestiging
      or (
        private = false
        and (
          kind <> 'vestiging'
          or public.sees_all_locations()
          or public.is_management()
          or channels.location_id = any(public.my_locations())
        )
      )
    )
  );

drop policy if exists doc_bestand_select on public.doc_bestand;
create policy doc_bestand_select on public.doc_bestand for select to authenticated
  using (
    /* Van mij, bij mij neergelegd, of met mij gedeeld. Deze drie gelden
       altijd -- ook zonder documentrechten, anders kun je een contract wel
       bij iemand neerleggen maar ziet hij het nooit. */
    eigenaar = public.my_id()
    or toegewezen_aan = public.my_id()
    or exists (
      select 1 from public.doc_toegang t
       where t.document_id = doc_bestand.id and t.profile_id = public.my_id()
    )
    /* En de brede standen, alleen voor wie bij het documentbeheer mag. */
    or (public.mag_documenten() and (
          zichtbaarheid = 'iedereen'
          or (zichtbaarheid = 'rollen' and rollen && public.my_roles())
          or (zichtbaarheid = 'vestiging' and public.in_my_locations(location_id))
        ))
  );

/*
 * mag_document() blijft bestaan en verandert niet.
 *
 * Hij wordt op drie andere plekken gebruikt -- doc_toegang, taak_document en
 * de leesregel op de emmer -- en daar gaat het altijd om een document dat er
 * al is. Daar is een tweede query geen probleem, en de functie houdt de
 * voorwaarden op een plek voor die drie.
 *
 * Alleen de leesregel op doc_bestand zelf mocht hem niet gebruiken, en dat
 * is precies de plek waar de rij nog niet bestaat.
 */
