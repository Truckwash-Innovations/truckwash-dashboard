-- ===========================================================================
--  De AI leest ook een pasje
--
--  Casper: "De ai, kan je die niet gebruiken bij inscannen arbeidsovereenkomst
--  en id ect? gezien de ocr niet echt lekker werkt."
--
--  Wat er nu staat, en waarom
--  --------------------------
--
--  Het inlezen van een identiteitsbewijs gebeurt met Tesseract, in de browser
--  zelf. Bovenaan src/lib/scannen.ts staat waarom:
--
--      "Op het toestel zelf. Er gaat geen foto van een paspoort naar een
--       externe partij -- niet naar ons, niet naar een leverancier."
--
--  Dat is geen toevallige keuze en hij gaat hier niet zomaar overboord. Maar
--  het werkt niet goed, en dat is ook waar: Tesseract leest de machineleesbare
--  strook alleen bij een scherpe, rechte, goed belichte foto. Een kiek met een
--  telefoon onder tl-licht levert een half gelezen strook op, en dan is de
--  uitkomst een leeg formulier.
--
--  Wat hier bijkomt
--  ----------------
--
--  Dezelfde weg als bij de facturen (0049, 0051): de eigen pc met Ollama haalt
--  het werk op. Een Edge Function kan die pc niet bellen -- geen adres, geen
--  open poort -- dus ligt het werk in public.ai_opdrachten en komt de pc het
--  halen.
--
--  Daarmee gaat de foto wél het toestel af: naar onze eigen database, en van
--  daar naar de eigen machine. Niet naar een leverancier. Dat is een echte
--  wijziging van wat er in scannen.ts stond, en daarom staat het hier met
--  zoveel woorden in plaats van dat het gewoon gebeurt.
--
--  Drie standen, en géén terugval
--  ------------------------------
--
--  Bij de facturen bestaat "lokaal-terugval": lukt het lokaal niet, dan doet
--  Claude het alsnog. Die stand bestaat hier NIET, en dat is het belangrijkste
--  besluit in deze migratie.
--
--  Een paspoort hoort niet stilletjes naar de andere kant van de oceaan te
--  gaan omdat er een pc uit stond. Wie Claude wil gebruiken zet dat er met
--  zoveel woorden op; staat er "lokaal" en is de machine er niet, dan komt er
--  een nette melding en verder niets.
--
--  De foto blijft niet staan
--  -------------------------
--
--  De plaatjes worden gewist op het moment dat het antwoord binnenkomt -- niet
--  pas bij het opruimen een minuut later. Zie de functie lezer, actie
--  'ai-klaar'. Wat er overblijft is de lezing, en die bevat geen beeld.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De plaatjes bij een opdracht
--
--  Als jsonb en niet als text[]: het is een lijst van base64-strings en die
--  gaan via PostgREST heen en weer. jsonb is daar het eenvoudigst, en de
--  inhoud wordt nooit doorzocht.
-- ---------------------------------------------------------------------------

alter table public.ai_opdrachten add column if not exists plaatjes jsonb;

comment on column public.ai_opdrachten.plaatjes is
  'De afbeeldingen bij deze opdracht, als base64 zonder data-URI-kop (0080). '
  'Wordt op null gezet zodra het antwoord er is -- een foto van een paspoort '
  'hoort niet langer te blijven staan dan het lezen duurt.';

/*
 * Er staat geen controle op soort, en dat blijft zo.
 *
 * 0051 zette hem er bewust niet op ("Alleen voor het logboek en om te kunnen
 * zien welk werk blijft liggen"), en daarmee kan 'document' er zonder
 * wijziging bij. Een lijst met toegestane soorten zou betekenen dat elke
 * nieuwe plek waar een model meedenkt een migratie kost.
 */

-- ---------------------------------------------------------------------------
--  Wie leest een document
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_ai_documenten', 'ai_documenten', 'lokaal',
   'Wie een ingescand identiteitsbewijs of contract uitleest. "uit": alleen '
   'de leesmotor in de app zelf, er gaat geen foto het toestel af. "lokaal": '
   'de eigen pc met Ollama -- de foto gaat naar onze eigen database en van '
   'daar naar die machine. "claude": Claude in de cloud; dan gaat een foto '
   'van een paspoort naar een partij buiten het bedrijf, dus zet dat alleen '
   'aan als dat een bewuste keuze is. Er is met opzet GEEN terugval: staat er '
   '"lokaal" en is de machine niet bereikbaar, dan gebeurt er niets.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  En die instelling hoort bij de boekhoudkant van het beheer
--
--  is_boekhoud_instelling() (0072) bepaalt welke sleutels de administratie mag
--  zetten zonder management te zijn. Deze hoort daar niet bij: wie een
--  identiteitsbewijs leest valt onder personeelszaken, en waar die foto heen
--  gaat is een keuze van het management. De lijst blijft dus zoals hij is.
--
--  Dat staat hier opgeschreven omdat het anders lijkt of het vergeten is.
-- ---------------------------------------------------------------------------
