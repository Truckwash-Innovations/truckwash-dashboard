# Exact koppelen

Sinds versie 1.50.0 zet je de sleutels van Exact in het dashboard zelf, bij
**Ontwikkeling → Exact**. Daarvoor stonden ze als geheim op de server en was
elke wijziging een `supabase secrets set` plus opnieuw uitrollen. Dat is prima
voor iets dat nooit verandert en hopeloos als je nog aan het uitzoeken bent.

## Wat je nodig hebt

Een app in het [Exact App Center](https://apps.exactonline.com/). Daar
registreer je één keer een app en je krijgt twee dingen:

- een **client-id**, iets als `{a1b2c3d4-...}` — mét de accolades
- een **clientgeheim**, een lange reeks tekens

Een net geregistreerde app werkt eerst alleen op je eigen administratie. Dat is
precies genoeg om mee te proberen, en dat is ook wat een dev-account is.

## De volgorde die werkt

Doe het in deze volgorde. Andersom werkt ook, maar dan typ je het
terugkeeradres over uit je hoofd en dat is waar het meestal misgaat.

1. **Open Ontwikkeling → Exact in het dashboard.** Rechtsonder staat het
   kopje "Wat er in het Exact App Center moet staan", met daarin het
   terugkeeradres. Klik erin — hij selecteert zichzelf — en kopieer het.

2. **Zet dat adres in het App Center**, bij je app onder *Redirect URI*.
   Exact vergelijkt dit teken voor teken. Eén schuine streep te veel aan het
   eind en je krijgt een foutmelding die niet zegt waar het aan ligt.

3. **Plak het client-id en het clientgeheim** in het dashboard, zet
   **Omgeving** op *Proef* en klik Opslaan.

4. **Klik op Koppelen met Exact.** Er opent een venster waarin je bij Exact
   inlogt en toestemming geeft. Daarna mag je dat venster sluiten.

5. **Ververs de status** met het pijltje rechtsboven in "De koppeling". Er
   hoort nu *gekoppeld* te staan, met het administratienummer erachter.

## Als het misgaat

**"Deze koppelpoging is niet herkend of verlopen."** De poging is ouder dan
een kwartier, of er is er intussen een nieuwe gestart. Begin opnieuw bij stap 4.

**Exact zegt iets over een invalid redirect.** Het adres in het App Center
staat niet letterlijk gelijk aan wat het dashboard laat zien. Let op de
schuine streep aan het eind en op `http` versus `https`.

**"invalid_client".** Het client-id en het geheim horen niet bij elkaar. Sla
ze allebei opnieuw op — het geheim komt nooit terug naar het scherm, dus het
veld is altijd leeg als je binnenkomt. Leeg laten betekent *laat staan*; wil
je het vervangen, plak dan het nieuwe.

**De laatste vier tekens kloppen niet.** Onder het geheimveld staat waar het
opgeslagen geheim op eindigt. Komt dat niet overeen met wat je dacht te
plakken, dan is er onderweg iets afgekapt.

## Van proef naar echt

Zet **Omgeving** op *Echt* en sla op. Let op: dat maakt de koppeling los, met
opzet. Een token dat is opgehaald bij het proefaccount hoort niet te blijven
staan als je daarna in de echte boekhouding boekt. Koppel daarna opnieuw.

Zolang er *proefomgeving* staat, laat het statusblok dat zien. Staat er
*echte administratie*, dan is dat een rood label — dat is geen versiering.

## Wat er nog niet gebeurt

De koppeling verbindt en houdt het token bij. Er gaan nog **geen facturen naar
Exact**. Dat is de volgende stap; zie de plannen rond de inkoopfacturen.

## Voor de techniek

- De sleutels staan in `exact_koppeling` (migratie 0052), een tabel met RLS
  aan en zonder ook maar één policy: alleen de Edge Function komt erbij. Het
  clientgeheim gaat daarom nooit mee in de synchronisatie naar de tablets.
- `EXACT_CLIENT_ID` en `EXACT_CLIENT_SECRET` op de server blijven werken als
  terugval. Staat er een paar in de database, dan wint dat.
- Het adres van Exact is instelbaar maar niet vrij: alleen `exactonline.nl`,
  `.be`, `.de`, `.co.uk`, `.fr`, `.es` en `.com` worden geaccepteerd. Daar
  gaat het clientgeheim naartoe, dus dat veld is geen gewone instelling.
- Uitrollen na een wijziging: `npm run functions:open`. Nooit kaal
  `supabase functions deploy exact` — dan staat `verify_jwt` weer aan en
  weigert Supabase de terugkeer van Exact, die een gewone GET zonder token is.
