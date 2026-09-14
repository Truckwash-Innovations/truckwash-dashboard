-- ===========================================================================
--  De koppeling die niemand terugvond
--
--  Casper: "Ik koppel hem steeds, hij geeft aan dat hij gekoppeld is en
--  vervolgens blijft hij erop staan dat die niet gekoppeld is."
--
--  Wat er gebeurde
--  ---------------
--
--  De koppeling werd wél opgeslagen. Alleen onder een naam waar niets naar
--  zoekt.
--
--  exact_facturen_wachtend() vindt de crediteur zo:
--
--      left join public.exact_leverancier l
--             on l.zoeknaam = public.kaal_bedrijf(b.supplier)
--            and l.administratie = b.adm
--
--  De zoeknaam moet dus precies zijn wat kaal_bedrijf() van de naam op de bon
--  maakt. Maar het scherm rekende hem zelf uit, met een nagebouwde versie van
--  diezelfde functie in JavaScript. En die twee liepen uit elkaar bij elke
--  B.V.:
--
--      "Van der Velden Amsterdam B.V."
--        database  ->  van der velden amsterdam
--        scherm    ->  van der velden amsterdam b v
--
--  0058 legt uit waarom de database de rechtsvorm als 'b\s*v' schrijft: na
--  het weghalen van de leestekens is "B.V." veranderd in "b v", en zonder die
--  spatie erin blijft hij staan. De nabouw in het scherm had die regel niet.
--
--  Het gevolg is de melding die Casper kreeg: opslaan lukt (er komt een rij,
--  er komt een bevestiging), terugvinden niet (de join zoekt op een andere
--  naam), en het scherm blijft dus zeggen dat er geen crediteur is. Elke
--  poging maakte er nog een.
--
--  De oorzaak is weg: het scherm stuurt de naam nu ruw op en de
--  serverfunctie haalt hem door kaal_bedrijf() -- één plek waar staat wat
--  "dezelfde naam" betekent, en dat is de plek waar ook de join staat.
--
--  Wat hier gebeurt
--  ----------------
--
--  De rijen rechtzetten die al scheef staan. Dat kan, want gezien_als bewaart
--  de naam zoals hij op de bon stond -- precies de tekst waar de join
--  kaal_bedrijf() overheen haalt. Wat daaruit komt is per definitie de naam
--  waaronder de rij gevonden moet worden.
--
--  Opnieuw draaien mag; de tweede keer staat er niets meer scheef.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Eerst de dubbelen
--
--  Is er in dezelfde bv al een rij met de JUISTE zoeknaam -- omdat het
--  automatisch koppelen hem wel goed had, of omdat er na de reparatie opnieuw
--  is gekoppeld -- dan kan de scheve rij niet worden bijgewerkt: (administratie,
--  zoeknaam) is de sleutel. Die scheve rij is dan bovendien overbodig.
--
--  Weggooien en niet overschrijven: de goede rij is de rij die werkt, en een
--  handmatige koppeling die daar overheen gaat is een keuze die niemand op dit
--  moment maakt.
-- ---------------------------------------------------------------------------

delete from public.exact_leverancier l
 where coalesce(trim(l.gezien_als), '') <> ''
   and public.kaal_bedrijf(l.gezien_als) is not null
   and l.zoeknaam is distinct from public.kaal_bedrijf(l.gezien_als)
   and exists (
     select 1 from public.exact_leverancier g
      where g.administratie = l.administratie
        and g.zoeknaam = public.kaal_bedrijf(l.gezien_als));

-- ---------------------------------------------------------------------------
--  En dan de rest rechtzetten
-- ---------------------------------------------------------------------------

do $$
declare
  geraakt integer;
begin
  update public.exact_leverancier l
     set zoeknaam   = public.kaal_bedrijf(l.gezien_als),
         updated_at = public.now_ms()
   where coalesce(trim(l.gezien_als), '') <> ''
     and public.kaal_bedrijf(l.gezien_als) is not null
     and l.zoeknaam is distinct from public.kaal_bedrijf(l.gezien_als);

  get diagnostics geraakt = row_count;
  if geraakt > 0 then
    raise notice 'Koppelingen rechtgezet: %', geraakt;
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  Wat er niet gebeurt
--
--  Rijen zonder gezien_als blijven staan zoals ze staan. Daar is niet uit af
--  te leiden wat de naam op de bon was, en een zoeknaam verzinnen is precies
--  hoe een koppeling bij de verkeerde crediteur belandt. Die vallen vanzelf
--  op: de factuur blijft in "Wat er nog blokkeert" staan, en één keer opnieuw
--  koppelen zet het goed.
-- ---------------------------------------------------------------------------
