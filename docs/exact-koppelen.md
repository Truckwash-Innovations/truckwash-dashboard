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

## Het rekeningschema

Onderaan het scherm staat je grootboek naast dat van Exact. Klik op **Ophalen
uit Exact** en hij haalt het hele rekeningschema op.

Wat er *niet* gebeurt is dat schema over je eigen lijst heen zetten. Dat is
met opzet: een administratie in Exact heeft er al gauw een paar honderd, en
onze lijst is kort gehouden zodat de administratie bij een bon in één oogopslag
de juiste rekening vindt. Zouden we ze allemaal overnemen, dan zijn je eigen
namen en trefwoorden bovendien overschreven door de omschrijving uit Exact.

Wat je in plaats daarvan ziet is de vraag die ertoe doet: **bestaat elke code
waarop wij boeken ook in Exact, en heet hij daar hetzelfde?** Staat er een code
bij die Exact niet kent, dan wordt een factuur op die code straks geweigerd —
dat wil je weten voordat de factuur weg is, niet erna.

Standaard toont hij alleen wat afwijkt. Klopt alles, dan staat er één groene
regel en verder niets.

## Wat er nog niet gebeurt

De koppeling verbindt, houdt het token vers, en haalt het rekeningschema op.
Er gaan nog **geen facturen naar Exact**.

Dat is geen vergeten stap maar een wachtende: een inkoopboeking in Exact heeft
drie dingen nodig die we nog niet hebben, en die niet te verzinnen zijn.

1. **Een dagboek.** Exact wil weten in welk inkoopdagboek de boeking komt
   (vaak 70). Dat nummer staat in jullie administratie en moet hier ingesteld
   worden.
2. **De leverancier als relatie in Exact.** Een boeking verwijst naar een
   crediteur met een intern id van Exact, niet naar de naam op de factuur.
   Er moet dus een koppeling komen tussen "Shell Nederland" op de bon en het
   relatienummer in Exact — matchen op naam, en handmatig bijstellen waar dat
   misgaat.
3. **De btw-codes.** 21% heet in Exact niet "21" maar een code die per
   administratie kan verschillen.

Zodra de koppeling staat en het rekeningschema is opgehaald, zijn die drie uit
Exact zelf op te halen en in te stellen. Dat werkt niet blind: het moet tegen
een echte administratie aangelegd worden, ook al is het de proef.

## Personeel

**Personeel naar Exact exporteren kan niet.** Dat is geen keuze van ons: de
HRM-kant van de Exact-API is alleen-lezen. `payroll/Employees`, `Employments`,
`EmploymentContracts` en `EmploymentSalaries` ondersteunen GET en verder niets
— er is geen POST en geen PUT. Je kunt via de API dus geen medewerker
aanmaken of wijzigen.

Wat er wél is, staat onderaan het Exact-scherm: **Het personeel naast dat van
Exact**. Klik op *Ophalen uit Exact* en hij haalt iedereen op die Exact kent.
Wie op e-mailadres te koppelen is, koppelt hij meteen zelf.

De rest doe je met de knop in de kolom *Nummer*: die opent een zoeker waarin je
op naam, medewerkernummer of e-mailadres zoekt. Je ziet eerst wat Exact over
die persoon weet — alle velden die Exact meestuurt — en koppelt hem dan pas.
Een nummer dat al aan iemand anders hangt kun je niet kiezen.

Koppelen gaat automatisch alleen op **e-mailadres**, nooit op naam. Twee mensen
die De Vries heten is geen uitzondering, en een verkeerde koppeling stuurt
straks de uren van de een naar de loonstrook van de ander.

### Waar het scherm je op wijst

- **Uit dienst in Exact, hier nog actief.** Dat is iemand die weg is en nog
  steeds kan inloggen. Daar is dit scherm eigenlijk voor.
- **Nog niet gekoppeld.** Zolang dat zo is kunnen de uren van die persoon niet
  naar Exact.

### Wie het mag zien

Alleen het management. Strenger dan het rekeningschema (waar ontwikkeling
meekijkt), en met opzet: het volledige Exact-record kan een burgerservicenummer
bevatten, en dat ligt in migratie 0009 bij het management en bij de medewerker
zelf. Een tabel ernaast met dezelfde gegevens maar een ruimere deur zou die
afspraak waardeloos maken.

### De enige kant die Exact wél laat schrijven

`payroll/VariableMutations` — de variabele loonmutaties: gewerkte uren, verlof
en toeslagen per loonperiode. Precies het werk dat elke maand met de hand gaat.
Zo'n mutatie wijst naar een medewerkernummer, en dat is waarom bovenstaande
koppeling er eerst moet zijn. Wat er daarna nog voor nodig is: het loonjaar en
de periode, en per soort mutatie het juiste type (en bij een looncomponent de
code daarvan). Die zijn uit jullie eigen administratie te halen zodra de
koppeling staat.

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
- Het praten met Exact staat in `supabase/functions/_gedeeld/exact.ts`,
  inclusief het verversen van het token. Dat token leeft **tien minuten**, en
  Exact geeft bij elke verversing een nieuw refresh-token dat meteen opgeslagen
  moet worden — sla je dat niet op, dan overleeft de koppeling precies één
  verversing. De zelftest let daarop (`npm run selftest`, hoofdstuk 36).
- `npm run functietest` kijkt de Edge Functions na op syntaxfouten, onbekende
  namen en dubbele definities. Die draaien nergens anders langs een compiler
  en werden voorheen pas bij het uitrollen gecontroleerd.
