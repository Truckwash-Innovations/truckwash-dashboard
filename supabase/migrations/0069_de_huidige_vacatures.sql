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
