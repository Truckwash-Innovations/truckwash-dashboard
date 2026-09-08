-- ===========================================================================
--  Een nagekomen wasbeurt blokkeert niet de hele ronde
--
--  Gevonden bij de verkenning voor de verbouwing van het administratie-
--  dashboard, en nagespeeld met PGlite. Het is geen theoretisch geval: het
--  gebeurt zodra iemand een wasbeurt achteraf gereedmeldt, en dat gebeurt.
--
--  Wat er misging
--  --------------
--
--  verkoopfacturen_opmaken() (0064) loopt per klant. Voor elke klant zoekt hij
--  eerst of er al een CONCEPT over die maand ligt om in bij te vullen. Ligt er
--  geen concept, dan maakt hij er een met een id dat volledig uit de maand en
--  het klantnummer wordt opgebouwd:
--
--      f_id := 'vf_' || replace(periode_in, '-', '') || '_' || klant.company_id
--
--  Dat id is dus altijd hetzelfde voor dezelfde klant en dezelfde maand. En
--  daar gaat het mis:
--
--    1. Klant A heeft een wasbeurt in mei. Opmaken geeft concept
--       vf_202605_co_a. Versturen zet hem op 'verstuurd' met een nummer.
--    2. Er komt een tweede wasbeurt van klant A over mei binnen. En een
--       eerste van klant B.
--    3. Opmaken loopt weer. Voor klant A is er geen concept (die staat op
--       verstuurd), dus bouwt hij hetzelfde id opnieuw. De insert doet niets
--       (on conflict do nothing) -- maar gemaakt wordt wel opgeteld.
--    4. Daarna schiet hij de nieuwe regel in factuur_id vf_202605_co_a, en dat
--       is de VERSTUURDE factuur. De trigger verkoopregel_op_slot (0064:161)
--       gooit er terecht een fout op: "Deze factuur is niet meer concept; de
--       regels liggen vast."
--    5. Die fout komt uit een functie, dus de hele ronde draait terug.
--       Klant B krijgt niets. En morgen weer niets, want de oorzaak blijft.
--
--  Eén nagekomen wasbeurt zet daarmee de facturatie van alle achttien
--  vestigingen stil, met een foutmelding die over factuur A gaat terwijl het
--  probleem is dat B niets krijgt.
--
--  Wat het nu doet
--  ---------------
--
--  Is het voor de hand liggende id al bezet, dan zoekt hij een vrij id met een
--  achtervoegsel (_na2, _na3). Die beurten zijn nagekomen en horen op een
--  eigen naregel-factuur -- niet in een factuur die de klant al op papier
--  heeft, en niet in een factuur die er niet komt.
--
--  En gemaakt wordt geteld met get diagnostics, dus alleen als er echt een rij
--  is bijgekomen. Dat is niet cosmetisch: het scherm meldt "3 concepten
--  opgemaakt" en daar hangt iemand zijn controle aan.
--
--  Wat er NIET verandert: de trigger blijft staan zoals hij is. Die had het
--  goed; hij hield tegen dat er in een verstuurde factuur werd geschreven.
--  Het was de aanroeper die hem in die situatie bracht.
--
--  Opnieuw draaien mag.
-- ===========================================================================

create or replace function public.verkoopfacturen_opmaken(
  periode_in text,
  door_in    text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  vanaf   bigint;
  tot     bigint;
  klant   record;
  f_id    text;
  basis   text;
  poging  integer;
  gemaakt integer := 0;
  n       integer;
begin
  /* De maand als 2026-03. Begin en einde in milliseconden, want zo staat de
     tijd overal in dit schema. */
  vanaf := (extract(epoch from (periode_in || '-01')::date) * 1000)::bigint;
  tot   := (extract(epoch from ((periode_in || '-01')::date + interval '1 month')) * 1000)::bigint;

  for klant in
    select j.company_id, min(j.company_name) as naam, count(*) as beurten
      from public.wash_jobs j
     where j.status = 'gereed'
       and j.completed_at >= vanaf and j.completed_at < tot
       and coalesce(j.price_excl, 0) > 0
       and not exists (select 1 from public.verkoopregel r where r.wash_job_id = j.id)
     group by j.company_id
  loop
    /* Al een concept voor deze klant en deze maand? Dan daarin bijvullen in
       plaats van een tweede maken -- anders krijgt de klant twee facturen
       over dezelfde maand omdat er een beurt later is bijgeboekt. */
    select f.id into f_id
      from public.verkoopfactuur f
     where f.company_id = klant.company_id
       and f.periode = periode_in
       and f.status = 'concept'
     limit 1;

    if f_id is null then
      /*
       * Geen concept. Er kan wél een verstuurde, betaalde of vervallen
       * factuur over deze maand liggen, en dan is het voor de hand liggende
       * id al bezet. Vroeger werd dat id dan alsnog gebruikt, en gingen de
       * regels de verstuurde factuur in -- waar de trigger op afging en de
       * hele ronde mee omviel.
       *
       * Dus: een vrij id zoeken. De lus loopt hoogstens zo vaak als er al
       * facturen voor deze klant en maand zijn, en dat is een handvol.
       */
      basis := 'vf_' || replace(periode_in, '-', '') || '_' || klant.company_id;
      f_id := basis;
      poging := 1;
      while exists (select 1 from public.verkoopfactuur f where f.id = f_id) loop
        poging := poging + 1;
        f_id := basis || '_na' || poging;
      end loop;

      insert into public.verkoopfactuur
        (id, company_id, company_naam, periode, datum, vervaldatum, administratie, opmerking)
      values (
        f_id, klant.company_id, klant.naam, periode_in,
        tot - 1,
        tot - 1 + (30::bigint * 24 * 60 * 60 * 1000),
        (select a.code from public.exact_administratie a where a.hoofd limit 1),
        case
          when poging = 1 then 'Wasbeurten ' || periode_in
          /* Zeg op de factuur zelf waarom er een tweede is. Anders belt de
             klant en weet niemand het. */
          else 'Wasbeurten ' || periode_in || ' (nagekomen)'
        end)
      on conflict (id) do nothing;

      /*
       * Tellen wat er echt is bijgekomen. Hiervoor stond hier
       * `gemaakt := gemaakt + 1`, ook als de insert door on conflict niets
       * deed -- en dan meldde het scherm concepten die er niet waren.
       */
      get diagnostics n = row_count;
      gemaakt := gemaakt + n;

      /* Niets ingevoegd én geen concept gevonden: dan is er tussen het zoeken
         en het invoegen iets veranderd. Deze klant volgende ronde. */
      if n = 0 then
        f_id := null;
        continue;
      end if;
    end if;

    insert into public.verkoopregel
      (id, factuur_id, volgorde, omschrijving, aantal, prijs_excl, btw_pct, wash_job_id)
    select 'vr_' || j.id,
           f_id,
           row_number() over (order by j.completed_at),
           coalesce(nullif(j.service, ''), 'Wasbeurt') || ' · ' || j.plate,
           1,
           j.price_excl,
           21,
           j.id
      from public.wash_jobs j
     where j.company_id = klant.company_id
       and j.status = 'gereed'
       and j.completed_at >= vanaf and j.completed_at < tot
       and coalesce(j.price_excl, 0) > 0
       and not exists (select 1 from public.verkoopregel r where r.wash_job_id = j.id)
    on conflict (id) do nothing;

    perform public.verkoopfactuur_tellen(f_id);
    f_id := null;
  end loop;

  return gemaakt;
end $$;

/* Zelfde rechten als in 0064: alleen de serverfunctie mag dit. */
revoke execute on function public.verkoopfacturen_opmaken(text, text) from public, anon, authenticated;
grant  execute on function public.verkoopfacturen_opmaken(text, text) to service_role;

comment on function public.verkoopfacturen_opmaken(text, text) is
  'Maakt per klant een conceptverkoopfactuur uit de gereedgemelde wasbeurten van een maand. Ligt er al een verstuurde factuur over die maand, dan komt er een naregel-factuur met een eigen id; nagekomen beurten blokkeren zo niet de facturatie van de andere klanten.';
