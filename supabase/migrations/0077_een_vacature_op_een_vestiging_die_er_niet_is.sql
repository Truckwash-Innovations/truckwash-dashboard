-- ===========================================================================
--  Een vacature op een vestiging die niet op de website staat
--
--  Gevonden bij het bouwen van de herbouwstroom, door de twee functies naast
--  elkaar te leggen die allebei vestigingen naar buiten geven:
--
--    website_vestigingen()  gaf er 18
--    website_vacatures()    gaf er 19 in zijn keuzelijst
--
--  Die ene extra was de testvestiging die Casper op "niet op de website" had
--  gezet. Uit de vestigingenlijst verdween hij netjes; uit de keuzelijst waar
--  een sollicitant zijn vestiging aanwijst niet.
--
--  Waar het aan lag
--  ----------------
--
--  0033 legde vast wat er naar buiten mag, en de voorwaarde daar is drieledig:
--
--      where l.op_website and l.active and l.website_slug is not null
--
--  0068 schreef die voorwaarde over voor de vacatures en liet er één van weg:
--
--      where l.active and l.website_slug is not null
--
--  op_website is precies de schakelaar die zegt "dit adres is openbaar". Hem
--  hier vergeten betekent dat een vestiging die met opzet van de site is
--  gehaald -- een pand dat nog niet open is, het hoofdkantoor, een proefinvoer
--  -- toch aan bezoekers wordt getoond zodra er een vacature openstaat.
--
--  Waarom dat erger is dan een regel te veel in een lijst
--  -----------------------------------------------------
--
--  Er staat een sollicitatieformulier onder. Iemand kiest die vestiging, de
--  sollicitatie komt binnen met een location_id dat nergens op de site
--  bestaat, en de taak die 0068 daarvan maakt gaat naar de leiding van een
--  vestiging die niet publiek is. Wie er dan naar kijkt, is de vraag.
--
--  De hele voorwaarde staat nu op één plek in beide functies, woordelijk
--  gelijk. scripts/sqltest.mjs legt ze naast elkaar, zodat een volgende
--  wijziging ze niet opnieuw uit elkaar kan laten lopen.
--
--  Opnieuw draaien mag.
-- ===========================================================================

drop function if exists public.website_vacatures();

create function public.website_vacatures()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(v order by v.volgorde, v.titel), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'slug', va.slug,
               'titel', va.titel,
               'intro', va.intro,
               'tekst', va.tekst,
               'taken', to_jsonb(va.taken),
               'eisen', to_jsonb(va.eisen),
               'bieden', to_jsonb(va.bieden),
               'uren', va.uren,
               'functiegroep', va.functiegroep,
               /* Dezelfde drie voorwaarden als website_vestigingen() in 0033,
                  woordelijk. op_website ontbrak hier, en daarmee kwam een
                  vestiging die met opzet van de site was gehaald toch in de
                  keuzelijst van het sollicitatieformulier.

                  De SLUG gaat mee en niet het id -- zie 0068 voor waarom. */
               'locaties', (
                 select coalesce(jsonb_agg(jsonb_build_object('slug', l.website_slug,
                                                              'plaats', l.city)
                                           order by l.city), '[]'::jsonb)
                   from public.locations l
                  where l.op_website
                    and l.active
                    and l.website_slug is not null
                    and (cardinality(va.locaties) = 0 or l.id = any(va.locaties))
               )
             ) as v,
             va.volgorde, va.titel
        from public.vacature va
       where va.actief
    ) v;
$$;

/*
 * De rechten opnieuw zetten.
 *
 * "drop function" gooit ze weg, en Supabase geeft een nieuwe functie meteen
 * weer aan anon en authenticated via de standaardregel in het schema. Zonder
 * deze twee regels staat het gat uit 0033/0034 weer open en kan een bezoeker
 * zonder inlog de hele lijst zelf opvragen.
 */
revoke execute on function public.website_vacatures() from public, anon, authenticated;
grant  execute on function public.website_vacatures() to service_role;
