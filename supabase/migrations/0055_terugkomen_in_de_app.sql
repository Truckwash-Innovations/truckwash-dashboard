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
