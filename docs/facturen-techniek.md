# De factuurketen, van binnen

Voor wie eraan bouwt. Wat de keten *doet* staat in
[facturen-verwerken.md](facturen-verwerken.md); dit gaat over hoe en waarom.

---

## De keten in één plaatje

```
  Resend webhook
        ↓
  functions/ontvang-mail          bericht + bijlagen opslaan, kostenpost maken
        ↓                          inkoop_adres_van() bepaalt de onderneming
        ↓
  _gedeeld/factuurlezer.ts        Claude leest de bijlage
   of  functions/lezer            de pc op kantoor leest hem (Ollama)
        ↓
  _gedeeld/verwerking.ts          verkoopcontrole, indelen, velden vullen,
        ↓                          eventueel de eerste handtekening (0050)
        ↓
  expenses                        de kostenpost, met .gelezen als verslag
        ↓
  lib/werklijst.ts                bepaalt de stand → scherm Te verwerken
        ↓
  repo.decide()                   eerste en tweede handtekening
        ↓
  functions/exact stuur-facturen  purchaseentry/PurchaseEntries + het document
        ↓
  betaalbaar() → maakSepa()       het betaalbestand
        ↓
  functions/exact betaalstatus    cashflow/Payments.Status uit Exact
```

---

## Waar staat wat

### Serverfuncties (`supabase/functions/`)

| Functie | Waarvoor | Bijzonder |
|---|---|---|
| `ontvang-mail` | de webhook van Resend | geen inlog; echtheid via het webhook-geheim |
| `_gedeeld/factuurlezer.ts` | een bijlage laten lezen door Claude | nooit goedkeuren of boeken — alleen lezen |
| `_gedeeld/verwerking.ts` | wat er ná het lezen gebeurt | één plek, zodat beide lezers hetzelfde resultaat geven |
| `lezer` | het loket waar de pc thuis werk komt halen | `--no-verify-jwt`; echtheid via `LEZER_SECRET` |
| `exact` | alles richting Exact | boeken, koppelen, betalen, betaalstatus |
| `takenmail`, `trucksupply` | de wekkers | worden gewekt door pg_cron (0101/0102) |

### Tabellen die de keten dragen

| Tabel | Waarvoor |
|---|---|
| `expenses` | de kostenpost zelf. `gelezen` is het verslag van de lezer |
| `expense_regel` | de verdeling over meerdere posten (0062) |
| `expense_gebeurtenis` | de historie van één factuur (0061) |
| `inkoop_adres` | waar post binnenkomt, per onderneming (0095) |
| `exact_administratie` | de bv's uit Exact |
| `exact_leverancier` | welke leverancier aan welke crediteur hangt, per bv |
| `betaalbatch` / `betaalregel` | een betaalopdracht en zijn regels |
| `wekker_ronde` | elke keer dat een wekker iets wekte (0102) |

### Schermen (`src/dashboards/administratie/`)

| Bestand | Scherm |
|---|---|
| `TeVerwerken.tsx` | de werklijst — indeling komt uit `lib/werklijst.ts` |
| `Kostenposten.tsx` | Inkoopfacturen: de tabbladen, het detail, alle handelingen |
| `NaarExact.tsx` | Boekhouding: versturen, blokkades, koppelingen, geschiedenis |
| `OpHandtekening.tsx` | wat op een tweede handtekening wacht, en bij wie |
| `Inkoopadressen.tsx` | de mailadressen per onderneming |

Betalen zit in `src/dashboards/developer/Exact.tsx` (`Betalen`), bereikbaar
vanuit Administratie.

---

## Beslissingen die je moet kennen voor je iets verandert

**De lezing is een verslag, geen invoer.** Wat de lezer vond staat in
`expenses.gelezen` en wordt nooit over de velden geschreven die een mens
invulde. Een trigger (`lezing_blijft_lezing`) zet terug wat de app probeert te
wijzigen. Zonder dat kun je een jaar later niet meer zien wie wat invulde.

**Meerdere velden zijn van de server.** Betaalvelden, leesstatus en de
weigering van Exact worden alleen door serverfuncties geschreven — die werken
met de servicesleutel en hebben geen `my_id()`. De app schrijft een kostenpost
als hele rij terug; zonder die rem zou een onschuldige wijziging een oude
waarde terugzetten.

**De onderneming van een bon komt uit `bon_administratie()`**, niet uit de
kolom `expenses.administratie`. Die functie kijkt ook naar de vestiging en de
hoofdadministratie. Wie de rauwe kolom gebruikt krijgt in de meeste gevallen
hetzelfde antwoord en in de lastige gevallen het verkeerde.

**Eén factuur past in één lopende betaalopdracht.** Dat is een unieke index op
`betaalregel(expense_id) where lopend`, geen trigger. Een trigger die eerst
leest en dan schrijft houdt twee gelijktijdige aanvragen niet tegen, en dan
gaat hetzelfde bedrag twee keer de deur uit.

**"Betaald" komt uit Exact.** Veld `Status` op `cashflow/Payments`: 20 open,
30 geselecteerd, 40 verwerkt, 50 afgeletterd. Alleen 50 telt. Gebruik *niet*
`Status` van `purchaseentry/PurchaseEntries` — dat is de verwerkingsstand van
de boeking, en een volstrekt onbetaalde factuur staat daar gewoon op 50.

**Bij Exact wordt niets geraden.** Elke veldnaam in deze keten is nagekeken in
hun documentatie. Er is geen endpoint om een betaling terug te schrijven of af
te letteren — dat is gezocht over alle resources en bestaat niet. Wat wij
kunnen is lezen.

---

## Twee lezers, één uitkomst

De factuur kan gelezen worden door Claude of door de pc op kantoor (Ollama).
De instelling `factuur_lezer` bepaalt wie:

| Waarde | Betekent |
|---|---|
| leeg / `claude` | Claude leest |
| `lokaal` | de pc leest; lukt het niet, dan mislukt de bon |
| `lokaal-terugval` | de pc leest; lukt het niet, dan leest Claude alsnog |

Wat er ná het lezen gebeurt is voor beide gelijk — dat staat in
`_gedeeld/verwerking.ts`, en dat is met opzet één plek. Daardoor is een lokaal
gelezen bon in de app niet te onderscheiden van een die Claude las, op het
veld `lezer` na.

De pc kent **geen** servicesleutel en geen API-sleutel. Hij heeft één geheim
(`LEZER_SECRET`), krijgt tijdelijke links naar bijlagen, en stuurt het ruwe
antwoord van zijn model terug. Alles wat er daarna mee gebeurt is server-werk.
Houd dat zo.

---

## Grenzen waar je tegenaan loopt

| Grens | Waarde | Waar het pijn doet |
|---|---|---|
| Edge Function geheugen | 256 MB | grote bijlagen |
| Edge Function CPU | 2 s per verzoek | base64 van een grote PDF |
| Edge Function wandklok | 150 s (gratis) / 400 s | een worker die actief blijft, wordt opgeruimd |
| bijlage die gelezen wordt | 12 MB | de post accepteert 25 MB — daartussen wordt hij bewaard en nooit gelezen |
| Exact request | 32 MB, 600 bladzijden | |
| pg_net antwoorden | 6 uur bewaard | daarna weet je nog dát een wekker liep, niet meer hoe |

Die wandklok is de oorzaak van een terugkerende storing geweest: een lange
lijn die 25 seconden openhangt, houdt een worker continu actief, en die wordt
dan elke 150 seconden opgeruimd. Valt dat middenin een verzoek, dan krijgt de
pc een ECONNRESET. Dat is gedocumenteerd gedrag, geen netwerkstoring.

---

## De tests

Drie suites, en ze bewijzen niet hetzelfde:

```bash
npm run selftest     # ~1980 controles
npm run sqltest      # ~1170 controles
npm run functietest  # de Edge Functions
npx tsc --noEmit
npm run build
```

**`sqltest` draait het schema écht**, in een PostgreSQL die in Node draait
(PGlite). Die functies worden aangeroepen, met gegevens erin, en de uitkomst
wordt nagerekend. Dit is de suite die fouten vindt.

**`selftest` is grotendeels tekstcontrole.** Hij kijkt of een regel nog in de
code staat en waarom. Dat vangt "iemand heeft dit per ongeluk weggehaald",
maar het kan niet vangen "dit is fout". Een groene selftest is geen bewijs dat
iets werkt.

Weet dat als je een test schrijft: **laat hem draaien wat hij controleert.**
Er is een bug doorheen geglipt omdat de test alleen keek óf een functie werd
aangeroepen, niet wát eruit kwam.

En twee valkuilen die er in de praktijk telkens weer inlopen:

- Schrijf de controle als de **regel**, niet als de letterlijke tekst. Een
  check op `klaar.slice(0, 25)` breekt zodra de variabele anders heet,
  terwijl de regel ("hoogstens 25 per ronde") gewoon klopt.
- Controleer niet op de **afwezigheid** van een zin die je zelf in het
  commentaar uitlegt. Dat is hier al drie keer misgegaan.

---

## Migraties

Ze staan in `supabase/migrations/`, genummerd, en worden met
`npm run sql:bouw` samengevoegd tot `supabase/setup.sql` (alles) en
`supabase/bijwerken.sql` (vanaf 0017). Die twee zijn gegenereerd — bewerk ze
niet met de hand.

Drie regels die niet onderhandelbaar zijn:

1. **Na elke `drop function` opnieuw de rechten zetten.** Supabase geeft
   `anon` standaard uitvoerrecht op nieuwe functies. Dus altijd
   `revoke execute … from public, anon` erachteraan.
2. **Verandert het antwoord van een functie van vorm, dan moet de oudere
   migratie hem eerst weghalen.** `create or replace` mag de vorm niet
   veranderen, en bij een tweede ronde door alle migraties loopt dat vast.
   Dit is al drie keer gebeurd.
3. **Opnieuw draaien moet veilig zijn.** De sqltest draait alles twee keer en
   controleert dat.

Wat de factuurketen betreft, in volgorde: 0044 (de post maakt zelf
kostenposten, en rekende toen nog het inkoopadres uit), 0049 (lokale
lezer), 0050 (automatische eerste goedkeuring), 0059/0079 (de bv op de bon),
0060/0096 (vier ogen en de tweede handtekening bij een persoon), 0061
(historie), 0062 (splitsen), 0065/0094 (betalen en SEPA), 0086 (per bv),
0090–0093 (boekstuknummer, documenten, grootboek), 0095–0098 (inkoopadressen),
0099 (weigeringen zichtbaar), 0100 (betaalstanden), 0101/0102 (de wekkers).

De koppen van die bestanden leggen uit *waarom* iets zo is. Lees ze voordat je
iets terugdraait.
