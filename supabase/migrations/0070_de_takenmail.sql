-- ===========================================================================
--  De takenmail: om 7 en om 15 uur wat er bij je ligt
--
--  Casper: "zorg ook ervoor dat iedereen om 7 uur en 15:00 uur een mail
--  krijgen met al hun todo's".
--
--  Waarom de lijst hier wordt gemaakt en niet in de serverfunctie
--  --------------------------------------------------------------
--
--  "Wat ligt er bij mij" is niet één kolom. Het is: alles wat op mijn naam
--  staat, plus alles wat bij mijn rol ligt op een vestiging waar ik bij mag --
--  want dat tweede is werk dat nog door niemand is opgepakt, en juist dat
--  hoort in een ochtendmail te staan.
--
--  Dat is dezelfde regel als isVanMij() in de app en als de policy op taak in
--  0067. Die drie horen hetzelfde te zeggen. Door hem hier neer te zetten
--  hoeft de serverfunctie niets van rollen, vestigingen of manages[] te weten
--  en kan hij niet stilletjes uit de pas gaan lopen.
--
--  Wie krijgt er een mail
--  ----------------------
--
--  Iedereen die iets open heeft staan. Niet "alle leidinggevenden": wie niets
--  te doen heeft krijgt niets, want een mail die drie keer per week leeg is,
--  is een mail die je na twee weken niet meer opent.
--
--  Uitgeschreven mensen en mensen zonder e-mailadres vallen af. Dat laatste
--  komt voor: een dossier kan bestaan zonder inlogaccount.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  De uren waarop hij gaat
--
--  Als instelling en niet als vaste waarde: de serverfunctie draait elk uur
--  langs en kijkt hier of het zover is. Zeven en vijftien nu; wil Casper er
--  een derde bij, dan is dat een regel in dit veld en geen nieuwe versie.
-- ---------------------------------------------------------------------------

insert into public.instellingen (id, sleutel, waarde, omschrijving) values
  ('in_taken_mail_uren', 'taken_mail_uren', '7,15',
   'Op welke hele uren (Nederlandse tijd) de takenmail wordt verstuurd. '
   'Komma''s ertussen. Leeg laten zet hem uit.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
--  Wat er bij wie ligt
--
--  Eén rij per persoon die iets open heeft staan, met zijn taken als jsonb.
--  De serverfunctie hoeft er alleen nog een mail van te maken.
-- ---------------------------------------------------------------------------

drop function if exists public.taken_voor_mail();

create function public.taken_voor_mail()
returns table (
  profile_id text,
  naam       text,
  email      text,
  aantal     integer,
  te_laat    integer,
  taken      jsonb
)
language sql stable security definer set search_path = public as $$
  with mens as (
    select p.id, p.name, p.email,
           coalesce(p.roles, array[]::text[]) as roles,
           coalesce(p.all_locations, false)   as overal,
           /* Zijn eigen vestiging plus de vestigingen waar hij leiding over
              heeft -- dezelfde optelsom als my_locations(), maar dan voor een
              wíllekeurige persoon en niet voor de beller. */
           array_remove(
             coalesce(p.manages, array[]::text[]) || coalesce(p.location_id, ''),
             ''
           ) as locaties
      from public.profiles p
     where p.active
       and coalesce(p.email, '') <> ''
       /* Uitgeschreven staat als archived_at op het dossier; zie 0023. */
       and p.archived_at is null
  ),
  paren as (
    /* Kolom voor kolom en niet t.*: de taak heeft ook een id, en dan is "id"
       verderop dubbelzinnig -- Postgres weigert de query en zegt precies dat. */
    select m.id as wie, m.name as wie_naam, m.email as wie_mail,
           t.titel, t.prioriteit, t.status, t.deadline, t.bron,
           t.toegewezen_aan, t.created_at
      from mens m
      join public.taak t
        on t.status <> 'klaar'
       and (
             /* op zijn naam */
             t.toegewezen_aan = m.id
             /* of bij zijn rol, op een vestiging waar hij bij mag */
             or (t.toegewezen_aan is null
                 and t.toegewezen_rol is not null
                 and t.toegewezen_rol = any(m.roles)
                 and (t.location_id is null
                      or m.overal
                      or t.location_id = any(m.locaties)))
           )
  )
  select
    wie,
    wie_naam,
    wie_mail,
    count(*)::integer,
    count(*) filter (where deadline is not null
                       and deadline < (extract(epoch from now()) * 1000)::bigint)::integer,
    jsonb_agg(
      jsonb_build_object(
        'titel', titel,
        'prioriteit', prioriteit,
        'status', status,
        'deadline', deadline,
        'bron', bron,
        'vanRol', toegewezen_aan is null
      )
      /* Het dringendst bovenaan, net als in het scherm: urgent voor hoog voor
         normaal voor laag, en binnen dezelfde prioriteit de vroegste deadline.
         nulls last, want een taak zonder datum is niet dringender dan een die
         morgen af moet. */
      order by case prioriteit
                 when 'urgent' then 0 when 'hoog' then 1
                 when 'normaal' then 2 else 3 end,
               deadline nulls last,
               created_at
    )
  from paren
  group by wie, wie_naam, wie_mail;
$$;

/* Alleen de serverfunctie. Deze functie leest langs RLS heen -- ze moet wel,
   want ze maakt de lijst voor iemand anders dan de beller -- en dat is precies
   waarom niemand anders haar mag aanroepen. */
revoke execute on function public.taken_voor_mail() from public, anon, authenticated;
grant  execute on function public.taken_voor_mail() to service_role;
