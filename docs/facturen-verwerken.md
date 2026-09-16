# Facturen verwerken

Voor wie de inkoopfacturen doet. Geen techniek — dat staat in
[facturen-techniek.md](facturen-techniek.md).

---

## De weg die een factuur aflegt

```
  de leverancier mailt
          ↓
  inkoop.<plaats>@<domein>          het adres bepaalt de onderneming
          ↓
  de lezer vult hem in              een model leest het PDF-bestand
          ↓
  Te verwerken                      jij kijkt ernaar
          ↓
  eerste handtekening
          ↓
  tweede handtekening               moet iemand anders zijn
          ↓
  naar Exact                        de boeking, met de PDF eraan
          ↓
  betalen                           SEPA-bestand → bank
          ↓
  betaald                           dit zegt Exact, niet wij
```

Elke stap kan blijven hangen, en dat is niet erg zolang je kunt zien wáár.
Daar is het scherm **Te verwerken** voor.

---

## Te verwerken

Dit is je werklijst. Alles wat binnenkwam en nog een stap nodig heeft staat
erin, op volgorde van wat het eerst aandacht vraagt: eerst wat stuk is, dan
wat op jou wacht, en wat vanzelf verdergaat onderaan.

Per regel staat één knop: de vólgende stap voor die factuur. Niet drie knoppen
naast elkaar, want een factuur heeft ook maar één volgende stap. Daarnaast
staat altijd **Openen** — een bedrag nakijken tegen het papier doe je niet
vanaf een regel in een lijst — en een rood kruisje om af te keuren.

### De standen

| Stand | Wat het betekent | Wat jij doet |
|---|---|---|
| **Vastgelopen** | Het lezen is niet gelukt | Opnieuw laten lezen, of met de hand invullen |
| **Exact weigert** | De boeking is teruggestuurd | De reden staat erbij; los dat op en druk Opnieuw |
| **Wordt gelezen** | Staat in de wachtrij bij de lezer | Niets |
| **Aanvullen** | Gelezen, maar er ontbreekt iets | Vul aan wat er in de kolom staat |
| **Wacht op akkoord** | Compleet | Goedkeuren of afkeuren |
| **Tweede handtekening** | De eerste staat er | Tekenen — maar niet als jij de eerste was |
| **Naar Exact** | Goedgekeurd en klaar | Versturen |
| **Te betalen** | Geboekt, nog niet betaald | Gaat via *Betalen*, niet via deze lijst |

Staat er niets? Dan is alles verwerkt. Dat is geen foutmelding.

---

## Goedkeuren, en waarom het er twee zijn

Boven een ingesteld bedrag moeten er twee mensen naar kijken. Dat is geen
wantrouwen maar de gewone regel bij uitgaven: wie de factuur nakijkt en wie
hem goedkeurt zijn niet dezelfde persoon.

Praktisch betekent dat:

- De eerste handtekening kan **automatisch** gaan. Heeft een mens dezelfde
  leverancier al een paar keer voor ongeveer hetzelfde bedrag goedgekeurd, dan
  mag de volgende vanzelf door de eerste stap. Dan is jouw blik de enige
  menselijke — en dat staat er ook bij, met een eigen merkteken.
- De tweede handtekening moet **altijd** van een mens komen, en van een ander
  dan de eerste. De knop is grijs als jij de eerste was; dat is geen storing.
- Ligt een factuur bij een bepaalde persoon, dan kan alleen die persoon
  tekenen — of iemand van het management. Dat laatste is er voor vakanties en
  ziekte: één afwezige mag de stapel niet stilzetten.

Wat er op een tweede handtekening wacht en bij wie, staat in het scherm **Op
handtekening**, met erbij hoeveel dagen het er al ligt. Boven de veertien
dagen wordt dat oranje.

---

## Afkeuren

Rood kruisje, en dan een reden. Die reden komt bij de factuur te staan én in
zijn historie, dus schrijf iets waar je over een half jaar nog iets aan hebt —
"dubbel ontvangen" of "hoort bij een andere bv", niet "nee".

Afkeuren kan zolang er nog iets te beslissen valt. Staat de factuur eenmaal in
Exact, dan is de knop weg: die boeking bestaat, en die haal je niet terug met
een knop hier. Daar is een creditnota voor.

---

## Naar Exact

Kan per factuur, vanuit Te verwerken, of in één keer voor de hele stapel bij
**Boekhouding**. Die laatste doet er hoogstens 25 per keer; druk daarna nog
eens voor de volgende.

Lukt het niet, dan staat de reden op drie plekken: in de melding die je meteen
krijgt, bij de factuur zelf, en in zijn historie. Veelvoorkomende redenen:

| Wat Exact zegt | Wat eraan scheelt |
|---|---|
| geen crediteur gekoppeld | De leverancier hangt nog niet aan een relatie in Exact. Koppelen kan bij Boekhouding |
| rekening … bestaat niet in Exact | De grootboekrekening bestaat niet in díé onderneming |
| staat al in Exact als boekstuk … | Hij is er al. Nakijken en hier met de hand afhandelen |
| geen betalingsconditie | De crediteur in Exact heeft er geen |

Los je het op, dan verdwijnt de melding vanzelf zodra je iets verandert waar
hij over ging. Blijft hij staan terwijl je denkt dat het klopt — bijvoorbeeld
omdat je de crediteur hebt gekoppeld — druk dan gewoon op **Opnieuw**. Dat
probeert het nog een keer, en dan blijkt het vanzelf.

---

## Betalen

Bij **Betalen** kies je een onderneming en maak je een betaalbestand. Dat is
een SEPA-bestand dat je bij de bank aanlevert.

Drie standen, en het verschil is belangrijk:

| Stand | Betekent |
|---|---|
| **open** | Goedgekeurd, geboekt in Exact, nog nergens aangeboden |
| **aangeboden** | Het bestand is gemaakt en bij de bank neergezet. Wij weten dat *wij* het gedaan hebben |
| **betaald** | Exact heeft de betaling afgeletterd tegen het bankafschrift |

Die laatste komt dus **niet** van ons. Wij kunnen niet weten of de bank de
opdracht heeft uitgevoerd; dat staat op het afschrift, en dat komt in Exact
binnen. Druk op **Betaalstatus ophalen** om te vragen wat Exact inmiddels
weet.

Een paar dingen die goed zijn om te weten:

- Een factuur die **nog niet in Exact staat** kun je niet betalen. Dat is met
  opzet: anders maak je geld over voor iets dat in de boekhouding niet
  bestaat. Staan er zulke facturen, dan zegt het scherm dat.
- Een opdracht die je per ongeluk hebt gemaakt kun je **intrekken**, zolang je
  hem nog niet op *aangeboden* hebt gezet. Daarna niet meer — dan ligt hij bij
  de bank, en intrekken hier zou betekenen dat dezelfde facturen een tweede
  keer in een bestand komen.
- Het bestand blijft bewaard. Ging de download mis, dan haal je hem opnieuw op
  met de knop **Bestand**.
- Ligt een factuur langer dan tien dagen bij de bank zonder dat Exact hem
  heeft afgeletterd, dan meldt het scherm dat. Dat is het soort ding dat
  anders een half jaar onopgemerkt blijft.

---

## Waar facturen binnenkomen

Elke onderneming heeft een eigen mailadres, en die maken zichzelf aan: een
vestiging krijgt er een op de plaatsnaam (`inkoop.roosendaal@`), een
onderneming zonder vestiging een korte naam (`inkoop.vastgoed@`). Je kunt ze
hernoemen — wat je wijzigt blijft staan.

Bij elk adres kun je een **persoon** zetten die de tweede handtekening zet.
Dat is een aanrader: staat er niemand, dan ligt het werk bij de hele groep
administratie, en werk dat bij een groep ligt, ligt bij niemand.

Een factuur die op zo'n adres binnenkomt draagt meteen de onderneming van dat
adres. Staat er op het stuk zélf een KvK- of btw-nummer van een andere bv, dan
wint dat — dat is harder dan een adres.

---

## Als er iets vastzit

**Een factuur staat op "Vastgelopen".** Het lezen lukte niet. Bij de factuur
staat waarom. Een te groot bestand, een PDF met een wachtwoord, of een scan
die te onscherp is. Je kunt hem opnieuw laten lezen, of de velden met de hand
invullen — dat staat er dan ook bij als handmatig.

**Er komt niets meer binnen.** Kijk of het adres waar de leverancier naartoe
mailt nog bestaat en actief staat bij *Inkoopadressen*. En of de onderneming
waar het aan hangt nog een adres heeft — daar staat een waarschuwing bij als
dat niet zo is.

**Alles staat op "Wordt gelezen" en er gebeurt niets.** Dan is de lezer stil.
Draait het lezen op de pc op kantoor, kijk dan of dat programma nog loopt; zie
[lokale-lezer.md](lokale-lezer.md).

**Een factuur is betaald maar staat nog op aangeboden.** Druk op
*Betaalstatus ophalen*. Blijft hij staan, kijk dan in Exact of het
bankafschrift van die dag is ingelezen — zolang dat niet gebeurd is, weet
Exact het ook niet.
