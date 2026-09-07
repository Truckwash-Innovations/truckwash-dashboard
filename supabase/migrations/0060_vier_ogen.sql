-- ===========================================================================
--  Vier ogen: één die kijkt, één die tekent
--
--  Casper: "Daarnaast moet je zorgen dat je na de eerste check van een
--  factuur ect, ook een tweede persoon moet hebben om hem goed te keuren."
--
--  Dat is de gewoonte die in elk factuurpakket zit, en de reden ervoor is
--  saai maar hard: hier gaat geld weg. Eén iemand die zich vergist, of eén
--  iemand die het niet zo nauw neemt, is bij één handtekening genoeg.
--
--  Hoe het loopt
--  -------------
--
--    open              er is nog niemand langs geweest
--    eerste_akkoord    één iemand heeft hem nagekeken
--    goedgekeurd       een TWEEDE iemand heeft getekend
--    afgekeurd         iemand heeft hem tegengehouden
--
--  Afkeuren kan in elke stand en door één iemand. Dat is geen inconsistentie:
--  tegenhouden kan geen kwaad, doorlaten wel.
--
--  Waarom de tweede handtekening in de database wordt bewaakt
--  ---------------------------------------------------------
--
--  Het scherm kan de knop verbergen voor wie al getekend heeft. Maar de app
--  praat rechtstreeks met de database, en een wijziging die via de wachtrij
--  binnenkomt heeft geen scherm gezien. De regel "niet twee keer dezelfde
--  persoon" hoort dus hier te staan, waar hij altijd geldt.
--
--  De drempel
--  ----------
--
--  Standaard nul: alles langs twee mensen. Er staat een bedrag naast, want
--  bij een parkeerbon van drie euro is twee handtekeningen geen zorgvuldigheid
--  maar een rem. Wie dat wil, zet hem hoger; wie het zo wil houden, doet
--  niets.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De nieuwe stand
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.expenses drop constraint if exists expenses_status_check;
  alter table public.expenses add constraint expenses_status_check
    check (status in ('open', 'eerste_akkoord', 'goedgekeurd', 'afgekeurd'));
exception when others then
  raise notice 'status-controle niet gezet: %', sqlerrm;
end $$;

alter table public.expenses add column if not exists eerste_door      text;
alter table public.expenses add column if not exists eerste_door_naam text;
alter table public.expenses add column if not exists eerste_at        bigint;

comment on column public.expenses.eerste_door is
  'Wie als eerste akkoord gaf (0060). De tweede handtekening moet van iemand '
  'anders komen; dat wordt door een trigger bewaakt en niet door het scherm.';

-- ---------------------------------------------------------------------------
--  De instellingen
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_vier_ogen', 'vier_ogen', 'ja',
   'Moet een factuur langs twee mensen voordat hij is goedgekeurd? "ja" of '
   '"nee". Staat standaard aan.'),
  ('in_vier_ogen_vanaf', 'vier_ogen_vanaf', '0',
   'Bedrag exclusief btw waarboven twee handtekeningen nodig zijn. Nul '
   'betekent: altijd. Bij een parkeerbon van drie euro is twee keer tekenen '
   'geen zorgvuldigheid maar een rem.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  Geldt vier ogen voor deze bon?
-- ---------------------------------------------------------------------------

create or replace function public.vier_ogen_nodig(bedrag_in numeric)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
           (select lower(trim(i.waarde)) from public.instellingen i
             where i.sleutel = 'vier_ogen'), 'ja') = 'ja'
     and coalesce(bedrag_in, 0) >= coalesce(
           (select nullif(trim(i.waarde), '')::numeric from public.instellingen i
             where i.sleutel = 'vier_ogen_vanaf'), 0);
$$;

revoke execute on function public.vier_ogen_nodig(numeric) from public, anon;
grant  execute on function public.vier_ogen_nodig(numeric) to service_role, authenticated;

-- ---------------------------------------------------------------------------
--  De bewaking
--
--  Twee regels, en allebei alleen als vier ogen aanstaat:
--
--    1. van open naar goedgekeurd in één stap mag niet. Er hoort een
--       eerste_akkoord tussen te zitten.
--    2. de tweede handtekening mag niet van dezelfde persoon zijn als de
--       eerste. Dat is het hele punt.
--
--  Wat er automatisch is goedgekeurd (0050) valt hier buiten regel 1: dat
--  zet zichzelf op eerste_akkoord en laat de tweede aan een mens. Zie de
--  Edge Function; hier wordt alleen bewaakt dat het niet ineens doorschiet.
-- ---------------------------------------------------------------------------

create or replace function public.expenses_vier_ogen()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'goedgekeurd' then
    return new;
  end if;
  if coalesce(old.status, 'open') = 'goedgekeurd' then
    return new;  -- was al goed; hier verandert iets anders
  end if;
  if not public.vier_ogen_nodig(new.amount_excl) then
    return new;
  end if;

  if coalesce(old.status, 'open') = 'open' then
    raise exception 'Deze factuur moet eerst door iemand anders worden nagekeken '
                    '(vier ogen staat aan).'
      using errcode = 'check_violation';
  end if;

  if new.eerste_door is not null
     and new.approved_by is not null
     and new.eerste_door = new.approved_by then
    raise exception 'De tweede handtekening moet van iemand anders komen dan de eerste.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists expenses_vier_ogen_trg on public.expenses;
create trigger expenses_vier_ogen_trg
  before update on public.expenses
  for each row execute function public.expenses_vier_ogen();

comment on function public.expenses_vier_ogen() is
  'Bewaakt dat een factuur langs twee verschillende mensen gaat (0060). Staat '
  'in de database en niet in het scherm: de app praat rechtstreeks met de '
  'database, en een wijziging uit de wachtrij heeft geen scherm gezien.';
