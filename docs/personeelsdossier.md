# Het personeelsdossier: wie ziet wat

Sinds versie 1.54.0 valt het dossier uiteen in twee helften. Dit is wat dat
voor jou betekent.

## Waarom

Een leidinggevende die iemand aanneemt moet zijn papieren kunnen invullen —
geboortedatum, identiteitsbewijs, **BSN**, noodcontact. Dat kon niet: het hele
dossier stond op "jezelf of het management", en een leidinggevende is geen van
beide.

Die deur zomaar openzetten kon ook niet. In dezelfde tabel stonden het
rekeningnummer, het uurloon en de interne notities van het management over die
persoon. De beveiliging van de database werkt per **rij**, niet per kolom — dus
één regel verruimen betekende dat elke leidinggevende meteen ook zag wat zijn
team verdient en wat er over hem was opgeschreven.

Dus is het dossier gesplitst langs de lijn die er altijd al in zat.

## Wie ziet wat

| | Jijzelf | Leidinggevende | Management |
|---|---|---|---|
| Geboortedatum, plaats, nationaliteit | ✓ | ✓ | ✓ |
| Identiteitsbewijs en vervaldatum | ✓ | ✓ | ✓ |
| **Burgerservicenummer** | ✓ | ✓ | ✓ |
| Noodcontact | ✓ | ✓ | ✓ |
| Rekeningnummer | ✓ | — | ✓ |
| Uurtarief | ✓ | — | ✓ |
| Interne notitie | — | — | ✓ |

Een leidinggevende mag de identiteitsgegevens ook **wijzigen**. Dat volgt uit
"iemand aannemen": wie het invult moet een typefout kunnen herstellen.

De geldkant staat er voor hem niet grijs of leeg, maar helemaal niet. Een lege
regel "Uurtarief —" laat je je afvragen of er iets stuk is.

## Wat dit betekent voor het toestel

Het dossier synchroniseert mee naar het apparaat. Nu leidinggevenden erbij
mogen, betekent dat dat er **BSN's in de lokale opslag van hun tablet komen te
staan**. Dat is een bewuste keuze en geen bijverschijnsel — het staat hier
zodat het een besluit blijft.

Wat dat praktisch betekent: een tablet die in een wasstraat blijft liggen en
waarop een leidinggevende ingelogd blijft, draagt die gegevens. Uitloggen wist
ze (dat is getest), maar het scherm op slot is geen vervanging voor uitloggen.

Wil je dat liever anders — bijvoorbeeld dat een leidinggevende het BSN alleen
online kan opvragen en het nooit op zijn toestel staat — dan is dat te bouwen,
maar dan werkt het dossier voor hem niet meer offline.

## Voor de techniek

- Migratie **0056**. `personnel_private` houdt de identiteit,
  `personnel_loon` het geld. De migratie verplaatst de gegevens en verwijdert
  daarna de drie kolommen uit de oude tabel — draai hem in zijn geheel.
- De regel staat op de **rol**: `is_supervisor() or is_management()`, plus
  `heeft_recht('staff.view')` voor wie het los toegekend kreeg. Niet alleen op
  het recht: `heeft_recht()` kijkt uitsluitend naar losse toekenningen, en wat
  een rol standaard meebrengt staat in `permissions.ts` — daar weet de
  database niets van. Een policy die alleen op `heeft_recht('staff.view')`
  leunt, laat geen énkele leidinggevende binnen.
- Niet `is_lead()`: daar zit de technische dienst in, en die neemt geen mensen
  aan.
- In de app schrijft `dossier.save()` alleen de identiteit en
  `dossier.saveLoon()` alleen het geld. Twee aanroepen, zodat een
  leidinggevende die een geboortedatum invult geen afwijzing krijgt over een
  uurloon dat hij niet eens ziet.
- `npm run selftest` (hoofdstuk 41) en `npm run sqltest` (hoofdstukken 13 en
  40) bewaken allebei die grens — de een aan de kant van het scherm, de ander
  aan de kant van de database.
