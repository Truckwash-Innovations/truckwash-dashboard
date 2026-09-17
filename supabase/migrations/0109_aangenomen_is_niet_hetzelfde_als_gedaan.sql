-- ===========================================================================
--  "Aangenomen" is niet hetzelfde als "gedaan"
--
--  Casper, bij het scherm met de wekkers: "Maar hij heeft nooit iets
--  gestuurd?"
--
--  Er stond bij takenmail: een uur geleden gelopen, antwoord "aangenomen".
--  En er was geen mail verstuurd. Allebei waar.
--
--  Wat er stond
--  ------------
--
--  wekkers_stand() gaf de statuscode terug en vertaalde 2xx naar
--  "aangenomen". Dat is precies één laag te vroeg stoppen. De functie NEEMT
--  het verzoek aan en besluit daarna zelf of er iets te doen valt:
--
--      {"ok":true,"overgeslagen":"het is 14 uur"}
--      {"ok":true,"overgeslagen":"deze ronde is al geweest"}
--      {"ok":true,"uur":6,"mensen":12,"verstuurd":9,"mislukt":0}
--
--  Alle drie zijn 200. Alle drie heetten "aangenomen". En alleen de laatste
--  heeft post verstuurd.
--
--  Dat is dezelfde fout als waar 0102 over ging, één niveau dieper. Toen was
--  het: de cron-taak slaagt zodra het verzoek is weggezet, dus kijk naar het
--  antwoord. Nu: het antwoord is 200 zodra de functie het verzoek aanneemt,
--  dus kijk naar wat er IN dat antwoord staat.
--
--  Wat het wordt
--  -------------
--
--  Het antwoord van de functie komt erbij, letterlijk. Niet samengevat en
--  niet vertaald -- wat de functie zegt is wat er staat. "aangenomen" blijft
--  als het antwoord leeg is; anders staat er wat hij deed.
--
--  Opnieuw draaien mag.
-- ===========================================================================

drop function if exists public.wekkers_stand(integer);

create or replace function public.wekkers_stand(hoeveel integer default 20)
returns table (
  naam          text,
  planning      text,
  actief        boolean,
  laatst_at     timestamptz,
  antwoord      integer,
  antwoord_hoe  text,
  /* Wat de functie zelf terugstuurde. Hier zit het verschil tussen "hij nam
     het aan" en "hij heeft iets gedaan". */
  inhoud        text,
  mislukt       integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('cron.job') is null then return; end if;

  return query execute format($sql$
    select j.jobname::text,
           j.schedule::text,
           j.active,
           r.gestart_at,
           a.status_code,
           (case
              when a.id is null and r.gestart_at is null then 'nog niet gelopen'
              when a.id is null then
                'antwoord niet (meer) bewaard -- pg_net houdt ze zes uur'
              when a.timed_out then 'de functie antwoordde niet op tijd'
              when a.error_msg is not null then a.error_msg
              when a.status_code between 200 and 299 then 'aangenomen'
              else coalesce(left(a.content, 200), 'geweigerd')
            end)::text,
           left(coalesce(a.content, ''), 500)::text,
           coalesce(m.mislukt, 0)::integer
      from cron.job j
      left join lateral (
        select w.gestart_at, w.verzoek_id
          from public.wekker_ronde w
         where w.naam = j.jobname
         order by w.gestart_at desc
         limit 1
      ) r on true
      left join net._http_response a on a.id = r.verzoek_id
      left join lateral (
        select count(*) filter (
                 where h.id is null or h.status_code is null or h.status_code >= 400
               )::integer as mislukt
          from (select * from public.wekker_ronde w2
                 where w2.naam = j.jobname
                 order by w2.gestart_at desc
                 limit %s) v
          left join net._http_response h on h.id = v.verzoek_id
      ) m on true
     order by j.jobname
  $sql$, greatest(1, coalesce(hoeveel, 20)));
exception when others then
  /* Geen pg_net op deze database, of de tabel heet anders: dan liever niets
     dan een scherm dat omvalt. */
  return;
end $$;

revoke execute on function public.wekkers_stand(integer) from public, anon, authenticated;
grant  execute on function public.wekkers_stand(integer) to service_role;

comment on function public.wekkers_stand(integer) is
  'Wat de wekkers deden, en wat de functie ervan vond (0102, met het antwoord '
  'zelf sinds 0109). Een 200 betekent dat de functie het verzoek aannam -- '
  'wat hij vervolgens deed staat in de inhoud.';

-- ---------------------------------------------------------------------------
--  En het scherm mag het ook zien
-- ---------------------------------------------------------------------------

drop function if exists public.wekkers_overzicht(integer);

create or replace function public.wekkers_overzicht(hoeveel integer default 20)
returns table (
  naam          text,
  planning      text,
  actief        boolean,
  laatst_at     timestamptz,
  antwoord      integer,
  antwoord_hoe  text,
  inhoud        text,
  mislukt       integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_developer() then
    raise exception 'Alleen ontwikkeling kan de stand van de wekkers zien.'
      using errcode = 'insufficient_privilege';
  end if;

  return query select * from public.wekkers_stand(hoeveel);
end $$;

revoke execute on function public.wekkers_overzicht(integer) from public, anon;
grant  execute on function public.wekkers_overzicht(integer) to authenticated, service_role;
