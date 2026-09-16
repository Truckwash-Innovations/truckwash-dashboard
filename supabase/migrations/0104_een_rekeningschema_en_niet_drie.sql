-- ===========================================================================
--  Eén rekeningschema, en niet drie
--
--  Casper: "fix het allemaal" -- de derde van zes.
--
--  Wat er stond
--  ------------
--
--  Drie tabellen die alle drie antwoord gaven op "welke rekening bestaat er":
--
--    exact_grootboek     wat Exact kent, per administratie. De waarheid: bij
--                        het boeken wordt hier de guid opgezocht.
--    grootboek           een kopie van datzelfde schema, per bv, met onze
--                        trefwoorden eraan geplakt
--    grootboek_sjabloon  een derde lijst met trefwoorden per code, gebruikt
--                        op het moment dat een bv wordt overgenomen
--
--  Dat kostte niet alleen ruimte. Het brak iets.
--
--  factuur_indelen() zocht de rekening in public.grootboek, met
--  "g.administratie = administratie_in". Een trefwoord was daarmee een feit
--  van één bv. Typ je bij bv A op rekening 4010 het woord "shell", dan doet
--  bv B daar niets mee -- daar staat een eigen rij 4010 zonder trefwoorden.
--  Met twintig bv's betekende dat: twintig keer hetzelfde intikken, of
--  negentien bv's waar niets zichzelf indeelt.
--
--  Dát is waarom Casper op dat scherm honderden regels zag met overal "geen,
--  deze wordt nooit geraden". Niet omdat er niets was ingevuld, maar omdat
--  wat er was ingevuld maar op één plek telde.
--
--  Wat het wordt
--  -------------
--
--  Het schema is van Exact. Van ons zijn alleen de trefwoorden, en die horen
--  bij een CODE en niet bij een kopie van een rij.
--
--    1. exact_grootboek krijgt een id en mag door de app gelezen worden. Dan
--       heeft het scherm het echte schema, ook zonder verbinding, en is er
--       geen reden meer om er een tweede van te bewaren.
--
--    2. factuur_indelen() kijkt voor "bestaat deze rekening hier?" in
--       exact_grootboek, en voor "waaraan herken ik hem?" in grootboek, op
--       code, ongeacht bv. Een trefwoord dat je één keer intikt werkt overal.
--
--    3. grootboek_overnemen() kopieert geen rekeningen meer waar wij niets
--       over te zeggen hebben, en wat er als kopie staat wordt opgeruimd --
--       behalve wat iets van ons draagt of waar op geboekt is.
--
--  Wat hier NIET gebeurt
--  ---------------------
--
--  grootboek_sjabloon blijft staan. Dat is de lijst waarmee een verse
--  installatie begint, en die heeft een eigen rol: hij zegt wat er
--  gebruikelijk is, niet wat er is. Hem samenvoegen met grootboek zou
--  betekenen dat het opstartlijstje en de eigen keuzes door elkaar lopen.
--
--  En er verdwijnt geen enkele rekening uit Exact. Wat hier wordt opgeruimd
--  is de kopie; het origineel staat in exact_grootboek en dat is de rij waar
--  de boeking altijd al op leunde.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Het schema van Exact mag gelezen worden door wie boekt
--
--  De synchronisatie vergelijkt elke binnengehaalde rij met de wachtrij op
--  rij.id -- voor alle tabellen, zonder uitzondering (zie de kop van 0044).
--  Deze tabel had geen id; hij is opgebouwd rond (division, code). Een
--  gegenereerde kolom lost dat op zonder dat er iets te onderhouden valt:
--  Postgres houdt hem gelijk aan de twee kolommen waar hij uit volgt.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'exact_grootboek'
       and column_name = 'id')
  then
    alter table public.exact_grootboek
      add column id text generated always as (division || '::' || code) stored;
  end if;
end $$;

create unique index if not exists exact_grootboek_id_idx
  on public.exact_grootboek (id);

comment on column public.exact_grootboek.id is
  'division::code, alleen zodat de synchronisatie hem kan behandelen als elke '
  'andere tabel (0104). Wordt nooit door de app geschreven.';

/*
 * Lezen mag wie binnen werkt, net als bij grootboek_sjabloon. Schrijven mag
 * niemand: deze tabel is een kopie van Exact, en de enige die hem bijwerkt is
 * "sync-grootboek" met de servicesleutel. Er staat dus met opzet geen enkele
 * policy voor insert, update of delete -- met RLS aan betekent dat: dicht.
 */
drop policy if exists exact_grootboek_select on public.exact_grootboek;
create policy exact_grootboek_select on public.exact_grootboek
  for select to authenticated using (public.is_staff());

-- ---------------------------------------------------------------------------
--  2. Indelen kijkt in het echte schema, en herkent op de code
--
--  Twee wijzigingen, en ze horen bij elkaar:
--
--    bestaat deze rekening in deze bv?   exact_grootboek, niet onze kopie.
--                                        Daarmee werkt het ook voor een bv
--                                        waarvan we het schema nooit hebben
--                                        overgenomen -- en dat zijn er
--                                        negentien van de twintig.
--
--    waaraan herken ik hem?              grootboek, op code, ongeacht bv.
--                                        Een trefwoord is een eigenschap van
--                                        rekening 4010, niet van de kopie van
--                                        4010 in bv A.
-- ---------------------------------------------------------------------------

create or replace function public.factuur_indelen(
  leverancier_in text,
  omschrijving_in text,
  administratie_in text
)
returns table (grootboek_code text, tags text[], bron text)
language sql stable security definer set search_path = public as $$
  with zoek as (
    select
      lower(trim(coalesce(leverancier_in, ''))) as lev,
      lower(coalesce(leverancier_in, '') || ' ' || coalesce(omschrijving_in, '')) as alles
  ),
  -- 1. Kennen we deze leverancier? En kent Exact die rekening in DEZE bv?
  uit_geheugen as (
    select b.grootboek_code, b.tags, 'geheugen'::text as bron
      from public.leverancier_boeking b, zoek z
     where b.leverancier = z.lev
       and b.grootboek_code is not null
       and exists (
         select 1 from public.exact_grootboek e
          where e.code = b.grootboek_code
            and e.division = administratie_in
            and not e.geblokkeerd)
  ),
  -- 2. Zo niet: raden op trefwoorden. Die horen bij de code, niet bij de bv.
  geraden_rekening as (
    select e.code
      from public.exact_grootboek e, zoek z
     where e.division = administratie_in
       and not e.geblokkeerd
       and exists (
         select 1
           from public.grootboek g, unnest(g.trefwoorden) t
          where g.code = e.code
            and g.actief
            and t <> ''
            and z.alles like '%' || lower(t) || '%')
     order by e.code
     limit 1
  ),
  geraden_tags as (
    select coalesce(array_agg(k.naam order by k.naam), '{}') as tags
      from public.kosten_tags k, zoek z
     where k.actief
       and exists (select 1 from unnest(k.trefwoorden) t
                    where t <> '' and z.alles like '%' || lower(t) || '%')
  )
  select * from uit_geheugen
  union all
  select (select code from geraden_rekening),
         (select tags from geraden_tags),
         'geraden'
   where not exists (select 1 from uit_geheugen)
  limit 1;
$$;

revoke execute on function public.factuur_indelen(text, text, text) from public, anon;
grant  execute on function public.factuur_indelen(text, text, text) to service_role, authenticated;

comment on function public.factuur_indelen(text, text, text) is
  'Waar een factuur waarschijnlijk op geboekt wordt (0086, herzien in 0104). '
  'Of een rekening in deze bv bestaat komt uit exact_grootboek; waaraan hij te '
  'herkennen is uit grootboek, op code en ongeacht bv -- een trefwoord hoort '
  'bij rekening 4010 en niet bij de kopie van 4010 in één administratie.';

-- ---------------------------------------------------------------------------
--  3. Overnemen kopieert alleen nog wat iets van ons draagt
--
--  Wat hier stond maakte een rij voor elke rekening die Exact kende. Die rij
--  bevatte dan de omschrijving van Exact, een lege trefwoordenlijst en 21%
--  btw -- met andere woorden: niets wat er niet al stond.
-- ---------------------------------------------------------------------------

create or replace function public.grootboek_overnemen(bv text)
returns table (nieuw integer, bijgewerkt integer, uit integer)
language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  b integer := 0;
  u integer := 0;
begin
  if coalesce(trim(bv), '') = '' then
    raise exception 'Zonder bv is er geen schema om over te nemen';
  end if;

  /*
   * Alleen de rekeningen waar het sjabloon iets over zegt, en alleen als er
   * nog nergens een rij voor die code staat. Sinds hierboven geldt een
   * trefwoord voor alle bv's, dus een tweede rij met dezelfde code voegt
   * niets toe behalve een plek waar het anders kan gaan staan.
   */
  with binnen as (
    insert into public.grootboek (id, code, naam, administratie, trefwoorden, categorie, btw_pct, actief)
    select
      'gb_' || bv || '_' || e.code,
      e.code,
      coalesce(nullif(trim(s.naam), ''), nullif(trim(e.omschrijving), ''), e.code),
      bv,
      coalesce(s.trefwoorden, '{}'),
      coalesce(s.categorie, e.soort),
      coalesce(s.btw_pct, 21),
      not e.geblokkeerd
      from public.exact_grootboek e
      join public.grootboek_sjabloon s on s.code = e.code
     where e.division = bv
       and (coalesce(array_length(s.trefwoorden, 1), 0) > 0
            or s.categorie is not null
            or s.btw_pct is not null)
       and not exists (select 1 from public.grootboek g where g.code = e.code)
    on conflict (id) do nothing
    returning 1
  )
  select count(*)::integer into n from binnen;

  /* Wat er al stond van deze bv: de blokkade van Exact overnemen. De naam en
     de trefwoorden blijven van ons. */
  update public.grootboek g
     set actief = not e.geblokkeerd,
         updated_at = public.now_ms()
    from public.exact_grootboek e
   where e.division = bv
     and g.administratie = bv
     and g.code = e.code
     and g.actief is distinct from (not e.geblokkeerd);
  get diagnostics b = row_count;

  /* En wat Exact in deze bv niet (meer) kent, gaat uit. Niet weg: er kan op
     geboekt zijn, en dan is de historie onleesbaar zonder de naam. */
  update public.grootboek g
     set actief = false, updated_at = public.now_ms()
   where g.administratie = bv
     and g.actief
     and not exists (
       select 1 from public.exact_grootboek e
        where e.division = bv and e.code = g.code);
  get diagnostics u = row_count;

  nieuw := n; bijgewerkt := b; uit := u;
  return next;
end $$;

revoke execute on function public.grootboek_overnemen(text) from public, anon, authenticated;
grant  execute on function public.grootboek_overnemen(text) to service_role;

comment on function public.grootboek_overnemen(text) is
  'Zet de trefwoorden uit het sjabloon klaar voor de rekeningen die deze bv '
  'kent (0086, herzien in 0104). Kopieert het schema zelf niet meer: dat staat '
  'in exact_grootboek en daar leest het boeken het ook.';

-- ---------------------------------------------------------------------------
--  4. En de kopie die er al staat opruimen
--
--  Alleen rijen die aantoonbaar niets toevoegen:
--
--    - geen trefwoorden
--    - dezelfde naam als Exact geeft (of de code zelf)
--    - de standaard 21% btw
--    - geen eigen categorie, of dezelfde als die van Exact
--    - Exact kent de code in die bv nog, zodat we zeker weten dat het een
--      kopie is en geen rij die iets bewaart wat nergens anders staat
--    - en er staat geen enkele kostenpost op die code
--
--  Alles wat daar niet aan voldoet blijft staan. Een rij te veel is hier
--  goedkoper dan een trefwoord dat iemand kwijt is.
-- ---------------------------------------------------------------------------

do $$
declare weg integer := 0;
begin
  delete from public.grootboek g
   using public.exact_grootboek e
   where e.division = coalesce(g.administratie, '')
     and e.code = g.code
     and coalesce(array_length(g.trefwoorden, 1), 0) = 0
     and trim(coalesce(g.naam, '')) in (trim(coalesce(e.omschrijving, '')), g.code)
     and coalesce(g.btw_pct, 21) = 21
     and (g.categorie is null or g.categorie is not distinct from e.soort)
     and not exists (
       select 1 from public.expenses x where x.grootboek_code = g.code)
     and not exists (
       select 1 from public.leverancier_boeking b where b.grootboek_code = g.code);

  get diagnostics weg = row_count;
  if weg > 0 then
    raise notice 'grootboek: % kopieën van het schema van Exact opgeruimd', weg;
  end if;
end $$;
