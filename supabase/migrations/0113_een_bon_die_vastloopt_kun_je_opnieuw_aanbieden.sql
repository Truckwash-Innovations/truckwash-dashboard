-- ===========================================================================
--  0113 -- Een bon die vastloopt, kun je opnieuw aanbieden
--
--  Casper: "Vastgelopen facturen weer vrijgeven."
--
--  Wat er misging
--  --------------
--
--  De lokale lezer (0049) kent vier standen: wacht, bezig, klaar, mislukt.
--  Drie daarvan komen vanzelf weer in beweging. "bezig" wordt na tien minuten
--  opnieuw uitgedeeld -- de pc kan halverwege zijn opgehouden, en dan hoort
--  die bon niet voor eeuwig geclaimd te blijven. "wacht" staat in de rij.
--  "klaar" is af.
--
--  "mislukt" is de enige stand zonder uitweg. Daar komt een bon terecht als
--  Ollama niet te bereiken was, als het model onzin teruggaf, of als er een
--  time-out overheen ging. Dat zijn stuk voor stuk redenen die morgen weg
--  kunnen zijn -- de pc stond uit, het model was aan het laden, het netwerk
--  hikte. Maar de bon bleef staan met een rood bolletje en "lezen mislukt",
--  en er was geen enkele manier om te zeggen: probeer het nog eens.
--
--  Het scherm liet het wél zien. Dat is het vervelende soort fout: alles
--  wees erop dat het systeem het wist, en er zat geen knop bij.
--
--  Waarom dit niet in de app kon
--  -----------------------------
--
--  lees_status staat sinds 0105 in kolom_van_de_server: "of het lezen lukte
--  bepaalt de lezer, niet het scherm". Dat klopt nog steeds -- je wilt niet
--  dat een scherm een mislukking op "klaar" kan zetten. Maar "zet hem terug
--  in de rij" is iets anders dan "vertel wat eruit kwam", en dat verschil
--  staat hieronder in code: deze functie kan de stand maar één kant op
--  duwen, naar wacht, en alleen vanaf mislukt of een vastgelopen bezig.
--
--  Wat er blijft staan
--  -------------------
--
--  De vorige lezing (gelezen) blijft. Die is een verslag van wat er toen
--  gebeurde, en dat wordt niet minder waar doordat we het opnieuw proberen.
--  De lezer overschrijft hem vanzelf als het deze keer wél lukt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Wie mag dit
--
--  Dezelfde mensen die een bon mogen goedkeuren. Opnieuw laten lezen kost
--  niets en gooit niets weg, maar het verandert wel wat er straks in Exact
--  belandt -- dus niet iedereen die een bon mág zien.
-- ---------------------------------------------------------------------------

create or replace function public.mag_opnieuw_laten_lezen()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_management() or public.heeft_recht('expenses.approve');
$$;

revoke execute on function public.mag_opnieuw_laten_lezen() from public, anon;
grant  execute on function public.mag_opnieuw_laten_lezen() to authenticated, service_role;

comment on function public.mag_opnieuw_laten_lezen() is
  'Wie een vastgelopen bon terug in de leesrij mag zetten (0113).';

-- ---------------------------------------------------------------------------
--  2. Terug in de rij
--
--  Eén functie voor één bon en voor de hele stapel. Geef je niets mee, dan
--  gaat alles wat vastzit; geef je een lijst mee, dan alleen die.
--
--  De voorwaarde staat in de where, niet in een if ervoor. Zo kan er tussen
--  het kijken en het zetten niets veranderen, en levert een bon die intussen
--  door de lezer is opgepakt gewoon nul rijen op in plaats van een
--  overschreven stand.
-- ---------------------------------------------------------------------------

drop function if exists public.bonnen_opnieuw_laten_lezen(text[]);

create or replace function public.bonnen_opnieuw_laten_lezen(welke text[] default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  hoeveel integer;
begin
  if not public.mag_opnieuw_laten_lezen() then
    raise exception 'Je mag geen bonnen opnieuw laten lezen';
  end if;

  update public.expenses
     set lees_status      = 'wacht',
         lees_geclaimd_at = null
   where (welke is null or id = any (welke))
     /* Alleen wat echt vastzit. Een bon op wacht staat al in de rij, een bon
        op klaar is af, en een bon die net is uitgedeeld hoort niet onder de
        voeten van de pc vandaan getrokken te worden. */
     and (
       lees_status = 'mislukt'
       /* lees_geclaimd_at is een epoch in milliseconden (0049), geen tijdstip.
          Tien minuten is dus 600000, en niet een interval. */
       or (lees_status = 'bezig' and lees_geclaimd_at < public.now_ms() - 600000)
     );

  get diagnostics hoeveel = row_count;
  return hoeveel;
end $$;

revoke execute on function public.bonnen_opnieuw_laten_lezen(text[]) from public, anon;
grant  execute on function public.bonnen_opnieuw_laten_lezen(text[]) to authenticated, service_role;

comment on function public.bonnen_opnieuw_laten_lezen(text[]) is
  'Vastgelopen bonnen terug op "wacht" zetten zodat de lokale lezer ze opnieuw '
  'oppakt (0113). Zonder lijst: alles wat vastzit. Geeft terug hoeveel er '
  'daadwerkelijk zijn vrijgegeven.';

-- ---------------------------------------------------------------------------
--  3. Hoeveel er vastzitten
--
--  Zodat het scherm een getal kan noemen zonder zelf over lees_status te
--  hoeven redeneren -- en zodat "hoeveel zitten er vast" en "welke geef ik
--  vrij" niet uit elkaar kunnen lopen: het is dezelfde voorwaarde.
-- ---------------------------------------------------------------------------

drop function if exists public.bonnen_vastgelopen();

create or replace function public.bonnen_vastgelopen()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.expenses
   where lees_status = 'mislukt'
      or (lees_status = 'bezig' and lees_geclaimd_at < public.now_ms() - 600000);
$$;

revoke execute on function public.bonnen_vastgelopen() from public, anon;
grant  execute on function public.bonnen_vastgelopen() to authenticated, service_role;

comment on function public.bonnen_vastgelopen() is
  'Hoeveel bonnen bij de lokale lezer vastzitten (0113). Dezelfde voorwaarde '
  'als bonnen_opnieuw_laten_lezen(), zodat het getal en de knop het over '
  'hetzelfde hebben.';

-- ---------------------------------------------------------------------------
--  4. En een melding weet voortaan waaróver hij gaat
--
--  Casper: "Nu kom ik nog aan bij het begin, maar het is toch fijner dat ik
--  in dit geval uit zou komen bij dat specifieke gedeelte van het rooster?"
--
--  De knop in een mail wees al naar een scherm (?open=rooster, 0108). Maar
--  een scherm is niet hetzelfde als een ding: je kwam uit op de week van
--  vandaag, terwijl het bericht ging over een dienst over twee weken. Dan mag
--  je zelf gaan bladeren, en dat is precies het werk dat een link hoort weg
--  te nemen.
--
--  De serverfunctie kon dit al: adressen.ts zet ?id= achter het adres zodra
--  hij er een krijgt, en stuur-mail leest vars.id uit. Alleen gaf de app hem
--  nooit mee, want er was geen plek om hem te bewaren. Die plek is dit.
--
--  Bewust los van link. Een scherm bestaat altijd; een ding kan intussen weg
--  zijn. Vindt de app het niet meer, dan blijft het scherm over -- nog altijd
--  beter dan de startpagina.
-- ---------------------------------------------------------------------------

alter table public.notifications add column if not exists link_id text;

comment on column public.notifications.link_id is
  'Waarover de melding gaat, binnen het scherm dat in link staat (0113). Bij '
  'een roosterwijziging het id van de dienst. Belandt als ?id= in de knop van '
  'de mail; de app negeert wat hij niet terugvindt.';
