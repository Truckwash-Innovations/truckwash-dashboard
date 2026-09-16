# Wegwijzer

Er staat veel documentatie, en het probleem was nooit dat er te weinig was —
het was dat niemand wist waar hij moest kijken. Dit is die lijst.

Begin bij wie je bent.

---

## Ik verwerk facturen

| Ik wil… | Lees |
|---|---|
| weten hoe een factuur van mail tot betaling loopt | [facturen-verwerken.md](facturen-verwerken.md) |
| weten wat een stand in *Te verwerken* betekent | [facturen-verwerken.md](facturen-verwerken.md#de-standen) |
| weten waarom een factuur vastzit | [facturen-verwerken.md](facturen-verwerken.md#als-er-iets-vastzit) |
| voorraad bestellen of ontvangen | [trucksupply.md](trucksupply.md) |

## Ik beheer het systeem

| Ik wil… | Lees |
|---|---|
| een nieuwe versie uitrollen | [uitrollen.md](uitrollen.md) |
| weten of de wekkers nog lopen | [uitrollen.md](uitrollen.md#de-wekkers) |
| de lokale lezer herstarten of instellen | [lokale-lezer.md](lokale-lezer.md) |
| Exact koppelen of opnieuw koppelen | [exact-koppelen.md](exact-koppelen.md) |
| weten welke instellingen er zijn en wat ze doen | [uitrollen.md](uitrollen.md#instellingen) |
| de mailbeveiliging aanscherpen | [dmarc-aanscherpen.md](dmarc-aanscherpen.md) |

## Ik bouw eraan

| Ik wil… | Lees |
|---|---|
| de app lokaal draaien, bouwen, uitbrengen | [../README.md](../README.md) |
| begrijpen hoe de factuurketen in elkaar zit | [facturen-techniek.md](facturen-techniek.md) |
| weten welke tabel of functie waarvoor is | [facturen-techniek.md](facturen-techniek.md#waar-staat-wat) |
| weten hoe de tests werken en wat ze wel en niet bewijzen | [facturen-techniek.md](facturen-techniek.md#de-tests) |
| iets aan het personeelsdossier veranderen | [personeelsdossier.md](personeelsdossier.md) |
| iets aan de kassa veranderen | [kassa-sessie-trucksupply.md](kassa-sessie-trucksupply.md) |

---

## De grote lijn, in één alinea

Facturen komen per mail binnen op een adres per onderneming. Een model leest
ze — in de cloud of op de pc op kantoor — en vult de velden in. Een mens kijkt
ernaar en tekent; boven een bedrag moet een tweede mens meetekenen. Daarna
gaat de boeking naar Exact, met de PDF eraan. Betalen gebeurt met een
SEPA-bestand dat je bij de bank aanlevert, en of er werkelijk betaald is komt
terug uit Exact — niet uit een vinkje bij ons.

Alles daartussen staat in [facturen-verwerken.md](facturen-verwerken.md) als
je het moet dóén, en in [facturen-techniek.md](facturen-techniek.md) als je
het moet begrijpen.

---

## Twee dingen die overal gelden

**De app werkt offline.** Wat je invult gaat eerst naar je eigen toestel en
daarna naar de server. Zie je iets niet meteen bij een collega staan, wacht
dan een ronde. Het omgekeerde ook: wat de server bijwerkt — een boeking, een
betaalstand — zie je pas na een ronde synchroniseren.

**De database is van de server.** Sommige velden kun je in de app wel zíén
maar niet wijzigen: de lezing van een factuur, de betaalstand, wat Exact
terugstuurde. Dat is met opzet. Ze worden geschreven door de serverfuncties en
de app zou ze bij het terugschrijven van een hele rij anders overschrijven met
iets ouds.
