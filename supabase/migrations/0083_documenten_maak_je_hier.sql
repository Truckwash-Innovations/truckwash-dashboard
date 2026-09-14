-- ===========================================================================
--  Documenten maak je hier
--
--  Casper: "dingen zoals pdf's ect kunnen maken, downloaden, printen ect."
--
--  Het documentbeheer (0071) bewaart bestanden die van elders komen: een
--  upload, een bijlage uit de mail, een scan. Wat er niet is, is de andere
--  kant -- iets zelf opschrijven. En dat is nou juist waar Word voor gebruikt
--  wordt: een brief, een verslag, een protocol, een verklaring.
--
--  Hoe dat hier werkt
--  ------------------
--
--  Niet als .docx. Dat formaat is duizenden pagina's specificatie en daar
--  bestaan hele projecten voor (OnlyOffice, Collabora); die komen zodra er
--  een server is om ze op te zetten. Wat hier komt is het stuk dat zonder
--  server kan en dat het meeste dagelijkse werk dekt: een document van koppen,
--  alinea's en lijsten, dat je opslaat, als PDF ophaalt en print.
--
--  De inhoud staat als jsonb in de rij en niet als bestand in de emmer. Dat
--  is met opzet:
--
--    * je wilt erin kunnen zoeken, en een blob in een emmer doorzoek je niet
--    * hij moet te bewerken zijn, en dat is een bestand dat je eerst moet
--      ophalen en daarna terugzetten niet
--    * hij komt mee met de gewone synchronisatie, dus je kunt eraan werken
--      zonder verbinding
--
--  De PDF wordt gemaakt op het moment dat je hem vraagt, uit diezelfde
--  inhoud. Hem opslaan zou betekenen dat er twee versies zijn -- de inhoud en
--  een PDF van gisteren -- en dat de tweede stilletjes veroudert.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De inhoud
-- ---------------------------------------------------------------------------

alter table public.doc_bestand add column if not exists inhoud jsonb;

comment on column public.doc_bestand.inhoud is
  'De blokken van een document dat hier is gemaakt (0083): koppen, alinea''s, '
  'lijsten. Leeg bij een bestand dat van elders komt -- dat staat in de emmer.';

/*
 * En een derde plek waar een document kan staan.
 *
 * 0071 zette er twee neer, supabase en nas, met de kanttekening dat dit als
 * gegeven in de rij hoort "zodat een NAS later geen tweede tabel wordt".
 * Dezelfde redenering geldt hier: een document dat in de database zelf staat
 * is een derde plek, geen tweede tabel.
 */
do $$
begin
  alter table public.doc_bestand drop constraint if exists doc_bestand_opslag_check;
  alter table public.doc_bestand add constraint doc_bestand_opslag_check
    check (opslag in ('supabase', 'nas', 'app'));
exception when others then
  raise notice 'opslag-controle niet gezet: %', sqlerrm;
end $$;

/*
 * Een document dat hier is gemaakt heeft geen pad.
 *
 * De kolom is not null met een lege standaard, dus dat komt vanzelf goed --
 * maar het hoort er als regel te staan, want anders staat er ooit een pad bij
 * dat nergens naar wijst en gaat iemand dat bestand zoeken.
 */
do $$
begin
  alter table public.doc_bestand drop constraint if exists doc_bestand_app_zonder_pad;
  alter table public.doc_bestand add constraint doc_bestand_app_zonder_pad
    check (opslag <> 'app' or pad = '') not valid;
exception when others then
  raise notice 'pad-controle niet gezet: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
--  En "gemaakt" is een eigen herkomst
--
--  bron zei tot nu toe waar een bestand vandaan kwam: upload, mail of scan.
--  Een document dat hier is geschreven komt nergens vandaan.
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.doc_bestand drop constraint if exists doc_bestand_bron_check;
  alter table public.doc_bestand add constraint doc_bestand_bron_check
    check (bron in ('upload', 'mail', 'scan', 'gemaakt'));
exception when others then
  raise notice 'bron-controle niet gezet: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
--  Wie mag een document maken
--
--  Dezelfde grens als uploaden: wie bij het documentbeheer mag. De
--  insertregel uit 0071 dekt dit al -- daar staat mag_documenten() plus de
--  vestiging, en dat geldt onverkort voor een document dat hier ontstaat.
--
--  Dat staat hier opgeschreven omdat de verleiding bestaat er een aparte
--  regel voor te maken, en twee regels voor dezelfde vraag is hoe ze uit
--  elkaar gaan lopen.
-- ---------------------------------------------------------------------------
