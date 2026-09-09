-- ===========================================================================
--  Je eigen woonadres invullen
--
--  Casper: "Daarnaast kan ik niet vinden waar ik iemand zijn adres moet
--  invullen voor kilometer vergoeding, of waar ze dit zelf kunnen doen."
--
--  Hij kon het niet vinden omdat het er niet was. Het woonadres staat op
--  personnel_private (address, postcode, city) en er is in de hele app geen
--  enkel scherm dat die drie velden invult -- niet bij het kantoor en niet bij
--  de medewerker zelf. Het ritformulier zegt intussen: "Je woonadres staat nog
--  niet in je dossier ... Vraag het kantoor om het toe te voegen." Het kantoor
--  had dat scherm ook niet.
--
--  Waarom dit niet alleen een schermwijziging is
--  ---------------------------------------------
--
--  prive_select laat je je eigen rij LEZEN (user_id = my_id()), prive_write
--  niet. Schrijven mag alleen management, een leidinggevende, of wie
--  staff.view heeft. Wil iemand zijn eigen adres invullen, dan moet die rij
--  dus open -- en RLS werkt per rij, niet per kolom. Zomaar openzetten
--  betekent dat iedereen zijn eigen BSN, documentnummer en vervaldatum kan
--  wijzigen. Dat is precies waarom 0056 die tabel heeft opgesplitst.
--
--  Hoe het dan wel kan
--  -------------------
--
--  Zelfde aanpak als lezing_blijft_lezing (0049): de policy gaat open, en een
--  trigger zet alles terug wat je niet mocht wijzigen. Schrijf je je eigen
--  rij en ben je geen personeelszaken, dan blijven alle kolommen behalve
--  address, postcode en city staan op hun oude waarde. Geen foutmelding, geen
--  half opgeslagen rij -- de wijziging gebeurt gewoon niet.
--
--  Dat past ook bij de rest van de app: die schrijft eerst lokaal en duwt het
--  daarna via de wachtrij naar de server. Een aparte functie aanroepen zou
--  betekenen dat je adres alleen te wijzigen is met verbinding.
--
--  Waarom dit geen goedkeuring nodig heeft
--  ---------------------------------------
--
--  Een rit legt zijn kilometers vast op het moment dat hij wordt aangemaakt
--  (Trip.km, met bron 'route'); een adreswijziging rekent oude ritten dus niet
--  opnieuw uit. Er valt met terugwerkende kracht niets te verdienen. En wie
--  een verkeerd adres invult benadeelt vooral zichzelf: dan klopt zijn eigen
--  woon-werkafstand niet.
--
--  Opnieuw draaien mag.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Mag deze persoon het dossier van een ander beheren?
--
--  Eén plek, want dit staat straks in de policy en in de trigger, en die twee
--  horen niet uit elkaar te lopen.
-- ---------------------------------------------------------------------------

create or replace function public.mag_dossiers_beheren()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_management()
      or public.is_supervisor()
      or public.heeft_recht('staff.view');
$$;

revoke execute on function public.mag_dossiers_beheren() from public, anon;
grant  execute on function public.mag_dossiers_beheren() to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  2. De rij gaat open voor de eigenaar
-- ---------------------------------------------------------------------------

drop policy if exists prive_write on public.personnel_private;
create policy prive_write on public.personnel_private for all to authenticated
  using (public.mag_dossiers_beheren() or user_id = public.my_id())
  with check (public.mag_dossiers_beheren() or user_id = public.my_id());

-- ---------------------------------------------------------------------------
--  3. ...maar dan alleen voor de drie adresvelden
--
--  De trigger draait ook bij een insert. Iemand die nog geen dossierrij heeft
--  en zijn adres invult maakt er een aan; alles wat hij verder meestuurt hoort
--  dan leeg te blijven.
-- ---------------------------------------------------------------------------

create or replace function public.eigen_rij_alleen_adres()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /* De server (serverfuncties met de servicesleutel) heeft geen my_id() en
     mag alles. Zelfde regel als lezing_blijft_lezing. */
  if public.my_id() is null then return new; end if;

  /* Personeelszaken mag alles wat de policy toelaat. */
  if public.mag_dossiers_beheren() then return new; end if;

  /* Blijft over: je eigen rij. Dan alleen het adres. */
  if tg_op = 'INSERT' then
    new.birth_date        := null;
    new.birth_place       := null;
    new.nationality       := null;
    new.document_type     := null;
    new.document_number   := null;
    new.document_expires  := null;
    new.document_verified := false;
    new.bsn               := null;
    new.emergency_name    := null;
    new.emergency_phone   := null;
    new.emergency_relation := null;
    return new;
  end if;

  new.birth_date         := old.birth_date;
  new.birth_place        := old.birth_place;
  new.nationality        := old.nationality;
  new.document_type      := old.document_type;
  new.document_number    := old.document_number;
  new.document_expires   := old.document_expires;
  new.document_verified  := old.document_verified;
  new.bsn                := old.bsn;
  new.emergency_name     := old.emergency_name;
  new.emergency_phone    := old.emergency_phone;
  new.emergency_relation := old.emergency_relation;
  /* En je kunt je rij niet aan iemand anders hangen. */
  new.user_id            := old.user_id;
  return new;
end;
$$;

revoke execute on function public.eigen_rij_alleen_adres() from public, anon, authenticated;

drop trigger if exists eigen_rij_alleen_adres_trg on public.personnel_private;
create trigger eigen_rij_alleen_adres_trg
  before insert or update on public.personnel_private
  for each row execute function public.eigen_rij_alleen_adres();

comment on function public.eigen_rij_alleen_adres() is
  'Wie zijn eigen dossierrij schrijft en geen personeelszaken is, mag alleen address, postcode en city zetten. De rest wordt teruggezet op de oude waarde -- RLS werkt per rij, niet per kolom.';
