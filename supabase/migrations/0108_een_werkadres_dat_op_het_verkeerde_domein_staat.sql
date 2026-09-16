-- ===========================================================================
--  Een werkadres dat op het verkeerde domein staat
--
--  Casper: "Ik heb hem hier op een ander domein dan bedoeld is... Kan je dit
--  fixen? gezien ik nu niks kan versturen of krijgen."
--
--  Zijn werkadres stond op casper@truckwash-workspace.com -- dat is het
--  domein van de app en van de website, niet dat van de post.
--
--  Wat er misging, en waarom het niets zei
--  ---------------------------------------
--
--  Het domein is een instelling (werk_domein, 0081). Uit die instelling wordt
--  een adres VOORGESTELD, en zodra iemand het uitdeelt staat het in
--  profiles.werk_email -- als tekst, los van de instelling.
--
--  Daarna kon het domein worden gewijzigd, en dan gebeurde er met de al
--  uitgedeelde adressen niets. Geen melding, geen lijst, geen manier om ze mee
--  te nemen. Het scherm bleef vrolijk "voornaam@nieuwdomein.nl" beloven
--  terwijl er drie mensen op het oude rondliepen.
--
--  En dat is niet alleen slordig: het betekent dat er niets meer werkt. Resend
--  verstuurt alleen vanaf een domein dat daar is geverifieerd, en post komt
--  alleen binnen op een domein waarvoor daar een route staat. Een adres op een
--  domein dat Resend niet kent is een adres waar niets heen gaat en niets
--  vandaan komt. Precies wat hij zag.
--
--  Wat het wordt
--  -------------
--
--    werkadressen_stand()       welke domeinen er in gebruik zijn, en hoeveel
--                               adressen er NIET op het ingestelde domein staan
--    werkadressen_verhuizen()   ze meenemen naar een ander domein, met een
--                               proefronde vooraf
--
--  De proefronde is geen franje. Een verhuizing kan botsen -- het nieuwe adres
--  bestaat al bij iemand anders, of het is het privéadres waarmee iemand
--  inlogt -- en dat wil je zien vóórdat je het doet, niet erna.
--
--  Wat hier NIET gebeurt
--  ---------------------
--
--  Het domein wordt niet gekozen. Dat kan deze database niet weten: welk
--  domein bij Resend is ingesteld staat bij Resend, en daar kan de database
--  niet bij. Wat hij wél doet is zeggen dat er adressen op een ánder domein
--  staan dan is ingesteld -- want dat wist hij allang en zei hij niet.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Wat er in gebruik is
-- ---------------------------------------------------------------------------

create or replace function public.werkadressen_stand()
returns table (
  domein        text,
  hoeveel       integer,
  is_ingesteld  boolean,
  open_postvak  integer
)
language sql stable security definer set search_path = public as $$
  with ingesteld as (
    select lower(nullif(trim(i.waarde), '')) as d
      from public.instellingen i where i.sleutel = 'werk_domein'
  )
  select lower(split_part(p.werk_email, '@', 2)) as domein,
         count(*)::integer,
         lower(split_part(p.werk_email, '@', 2)) is not distinct from (select d from ingesteld),
         count(*) filter (where p.werk_mail_aan)::integer
    from public.profiles p
   where p.werk_email is not null
     and p.archived_at is null
     and (public.is_management() or public.heeft_recht('staff.view'))
   group by 1
   order by 2 desc;
$$;

revoke execute on function public.werkadressen_stand() from public, anon;
grant  execute on function public.werkadressen_stand() to authenticated, service_role;

comment on function public.werkadressen_stand() is
  'Op welke domeinen de uitgedeelde werkadressen staan (0108), en of dat het '
  'ingestelde domein is. Een adres op een ander domein is een adres waar '
  'niets heen gaat: Resend kent dat domein niet.';

-- ---------------------------------------------------------------------------
--  2. Ze meenemen naar een ander domein
--
--  Met een proefronde: echt_doen = false laat zien wat er zou gebeuren en
--  verandert niets. Dat is niet netjes-doen maar noodzaak -- een botsing op
--  het unieke adres zou de hele verhuizing laten stranden, en dan weet je
--  niet welke helft er wel doorkwam.
-- ---------------------------------------------------------------------------

create or replace function public.werkadressen_verhuizen(
  naar_in    text,
  van_in     text default null,
  echt_doen  boolean default false
)
returns table (
  wie      text,
  naam     text,
  oud      text,
  nieuw    text,
  gelukt   boolean,
  waarom   text
)
language plpgsql security definer set search_path = public as $$
declare
  naar text := lower(trim(coalesce(naar_in, '')));
  van  text := lower(nullif(trim(coalesce(van_in, '')), ''));
  r    record;
  doel text;
  fout text;
begin
  if not public.is_management() then
    raise exception 'Alleen het management kan werkadressen verhuizen.'
      using errcode = 'insufficient_privilege';
  end if;

  naar := regexp_replace(naar, '^@', '');
  if naar = '' or naar like '%@%' or naar !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'Geef alleen het stuk ná de @, bijvoorbeeld truckwash1group.nl.'
      using errcode = 'invalid_parameter_value';
  end if;

  for r in
    select p.id, p.name, p.werk_email
      from public.profiles p
     where p.werk_email is not null
       and p.archived_at is null
       and (van is null or lower(split_part(p.werk_email, '@', 2)) = van)
       and lower(split_part(p.werk_email, '@', 2)) <> naar
     order by p.name
  loop
    doel := lower(split_part(r.werk_email, '@', 1)) || '@' || naar;
    fout := null;

    /* Botst het met een adres dat al is uitgedeeld? */
    if exists (
      select 1 from public.profiles q
       where q.id <> r.id and lower(q.werk_email) = doel)
    then
      fout := 'dat werkadres is al van iemand anders';
    end if;

    /*
     * Of met het adres waarmee iemand inlogt?
     *
     * Dat is geen technische botsing maar een echte: het werkadres staat
     * NAAST het privéadres en vervangt het niet (0081). Zijn ze hetzelfde,
     * dan komt de uitnodiging voor een postvak in dat postvak terecht, en
     * daar kun je pas bij als je hem hebt gelezen.
     */
    if fout is null and exists (
      select 1 from public.profiles q where lower(q.email) = doel)
    then
      fout := 'dat is het adres waarmee er wordt ingelogd; kies een ander domein';
    end if;

    if fout is null and echt_doen then
      begin
        update public.profiles set werk_email = doel, updated_at = public.now_ms()
         where id = r.id;
      exception when others then
        fout := sqlerrm;
      end;
    end if;

    wie := r.id; naam := r.name; oud := r.werk_email; nieuw := doel;
    gelukt := fout is null; waarom := fout;
    return next;
  end loop;
end $$;

revoke execute on function public.werkadressen_verhuizen(text, text, boolean) from public, anon;
grant  execute on function public.werkadressen_verhuizen(text, text, boolean) to authenticated, service_role;

comment on function public.werkadressen_verhuizen(text, text, boolean) is
  'Verhuist uitgedeelde werkadressen naar een ander domein (0108). Met '
  'echt_doen = false een proefronde die niets verandert; van_in beperkt het '
  'tot één oud domein.';
