-- ===========================================================================
--  Een BSN uit Groenlo hoort niet in Venlo
--
--  Draai dit ná 0114. Opnieuw draaien mag.
--
--  Wat er stond
--  ------------
--
--  Sinds 0056 mag een leidinggevende de identiteitskant van het dossier zien
--  en wijzigen -- terecht, want die maakt nieuwe medewerkers aan en heeft
--  daar het BSN voor nodig. Maar de regel die dat toestaat kreeg als enige
--  in dit schema géén vestigingsfilter:
--
--      using (user_id = public.my_id()
--             or public.is_management()
--             or public.is_supervisor()
--             or public.heeft_recht('staff.view'));
--
--  Vrijwel elke andere regel op personeelsgegevens eindigt op
--  `in_my_locations(location_id)`. Deze niet. Een leidinggevende in Venlo kan
--  daardoor het BSN, de geboortedatum en het documentnummer van iemand in
--  Groenlo opvragen en aanpassen, terwijl hij die persoon niet in het
--  rooster ziet staan en er niets mee te maken heeft.
--
--  Dat is geen theoretisch gat. Het gaat om ongeveer 250 mensen, en het
--  documentnummer plus de geboortedatum plus het BSN is precies het pakket
--  waarmee identiteitsfraude wordt gepleegd.
--
--  Wat het wordt
--  -------------
--
--  Dezelfde toegang, maar begrensd tot de vestigingen waar je over gaat. Het
--  management en iedereen met `locations.all` merken er niets van -- die
--  zien alles, zoals eerst.
--
--  WAT HIER BEWUST NIET IS DICHTGEZET
--  ----------------------------------
--
--  Iemand zónder vestiging blijft zichtbaar voor elke leidinggevende. Dat is
--  wat `in_my_locations()` doet: een lege vestiging geeft `true`.
--
--  Bij het schrijven van deze migratie stond dat eerst dicht. Dat brak het
--  bestaande geval "een leidinggevende ziet het dossier van zijn team" --
--  terecht, want in dit systeem is een team een vestiging, en zonder
--  vestiging is er geen team om buiten te vallen. Belangrijker: `profiles`
--  zelf werkt al zo. Iemand zonder vestiging is daar voor elke leidinggevende
--  zichtbaar. Het dossier strenger maken dan het profiel eromheen levert
--  inconsistentie op, en sluit in het ergste geval leidinggevenden af van hun
--  eigen mensen zodra een vestiging niet is ingevuld.
--
--  Blijft staan als open punt: hoeveel profielen hebben er geen vestiging?
--  Zolang dat er meer dan een handvol zijn, is dit het echte gat en niet de
--  regel hierboven.
-- ===========================================================================

/*
 * Mag ik het dossier van deze persoon inzien, gelet op vestiging?
 *
 * Alleen de vestigingsvraag. Of je er überhaupt bij mag staat in de regel
 * zelf; deze functie snijdt daar de vestiging af.
 */
create or replace function public.dossier_in_bereik(persoon text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_management()
      or exists (
           select 1 from public.profiles p
            where p.id = persoon
              and public.in_my_locations(p.location_id)
         );
$$;

grant execute on function public.dossier_in_bereik(text) to authenticated;

/* Staat alleen in regels die voor ingelogde gebruikers gelden. Zie 0034. */
revoke execute on function public.dossier_in_bereik(text) from public, anon;

comment on function public.dossier_in_bereik(text) is
  'Of het dossier van deze persoon binnen jouw vestigingen valt (0115). '
  'Iemand zonder vestiging valt er binnen, net als bij profiles zelf.';

-- ---------------------------------------------------------------------------
--  De identiteitskant
-- ---------------------------------------------------------------------------

/*
 * mag_dossiers_beheren() komt uit 0074 en is precies de drie rollen uit de
 * oude regel: management, leidinggevende, of wie staff.view heeft. Daar komt
 * nu de vestiging bij.
 *
 * `user_id = my_id()` blijft er in allebei staan. In prive_write is dat geen
 * detail maar de hele reden dat 0074 bestaat: je eigen woonadres invullen
 * gaat via die rij, en de trigger eigen_rij_alleen_adres() zorgt dat je er
 * verder niets in kunt zetten. Wie die clausule weghaalt, breekt dat -- en
 * dat is precies wat er bij het schrijven van deze migratie eerst gebeurde.
 */

drop policy if exists prive_select on public.personnel_private;
create policy prive_select on public.personnel_private for select to authenticated
  using (
    user_id = public.my_id()
    or (public.mag_dossiers_beheren() and public.dossier_in_bereik(user_id))
  );

drop policy if exists prive_write on public.personnel_private;
create policy prive_write on public.personnel_private for all to authenticated
  using (
    user_id = public.my_id()
    or (public.mag_dossiers_beheren() and public.dossier_in_bereik(user_id))
  )
  with check (
    user_id = public.my_id()
    or (public.mag_dossiers_beheren() and public.dossier_in_bereik(user_id))
  );

-- ---------------------------------------------------------------------------
--  De geldkant blijft zoals hij was
--
--  loon_select en loon_write staan al op alleen het management en de persoon
--  zelf; daar zit geen leidinggevende tussen en dus ook geen gat. Bewust niet
--  aangeraakt: een regel die klopt hoef je niet te herschrijven.
-- ---------------------------------------------------------------------------
