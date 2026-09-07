-- ===========================================================================
--  Links in mails wijzen naar de site, niet naar GitHub
--
--  Casper: "kan je ervoor zorgen dat alle linken die in mails worden verstuurd
--  op de website uitkomen ipv de github release? evt al bij die app, zodat ze
--  misschien gelijk bij het bericht kunnen komen?"
--
--  Wat er stond
--  ------------
--
--  Twee serverfuncties (stuur-mail en nodig-uit) hadden allebei hun eigen
--  APP_LINK met dezelfde terugval naar de releasepagina op GitHub. Die secret
--  stond nergens gezet, dus die "terugval" was gewoon wat er gebeurde: wie een
--  mail kreeg dat zijn aanmelding was goedgekeurd, kwam uit op een pagina met
--  versienummers, losse .exe-bestanden en changelogs.
--
--  0055 zei het al met zoveel woorden -- "Casper wilde juist van dat
--  GitHub-adres af" -- maar toen ging het alleen over de terugkeer uit Exact.
--  Nu geldt het voor alles wat de deur uit gaat.
--
--  Wat erbij komt
--  --------------
--
--  Eén instelling: site_url. app_url stond er al (0055) en wijst naar de app;
--  dit wijst naar de website ernaast. Twee adressen omdat het twee vragen zijn:
--
--    "ik moet de app nog installeren"  ->  /medewerkers/ op de site
--    "er staat iets voor me klaar"     ->  de app zelf, meteen op het scherm
--                                          waar het klaarstaat
--
--  Laat je site_url leeg, dan neemt de serverfunctie de wortel van app_url.
--  Dat klopt zolang de site en de app op hetzelfde domein staan, en dat is nu
--  zo. Staat de app ooit ergens anders, dan zet je dit veld en is het weer
--  goed -- zonder nieuwe versie.
--
--  De automatische bijwerker blijft bij GitHub. Die haalt bestanden op, geen
--  mensen, en een releasepagina is daar precies goed voor.
--
--  Opnieuw draaien mag.
-- ===========================================================================

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_site_url', 'site_url', 'https://truckwash-workspace.com/',
   'Waar de website staat. Hier komen de links in mails uit die over de app '
   'zelf gaan, zoals /medewerkers/ om hem te downloaden. Moet https zijn; '
   'leeg laten betekent dat de serverfunctie de wortel van app_url pakt.')
on conflict (id) do nothing;
