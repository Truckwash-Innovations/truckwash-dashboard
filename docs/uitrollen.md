# Uitrollen en beheer

Wat er moet gebeuren om een wijziging bij de mensen te krijgen, en waar je
kijkt als er iets stilstaat.

---

## De vier stappen

Er zijn vier dingen die los van elkaar uitgerold worden. Welke je nodig hebt
hangt af van wat er veranderd is.

| Veranderd in… | Dan | Commando |
|---|---|---|
| `supabase/migrations/` | de database bijwerken | plak `supabase/bijwerken.sql` in de SQL-editor |
| `supabase/functions/` | de serverfuncties uitrollen | `npm run functions` |
| `src/` | de app uitbrengen | versie ophogen, taggen, pushen (zie onder) |
| `lezer/` | de lezer op de pc herstarten | ophalen en opnieuw starten |

Ze zijn niet uitwisselbaar. Een migratie zonder de bijbehorende functie geeft
een functie die naar een kolom vraagt die er wel is maar niet gevuld wordt; een
functie zonder migratie geeft een fout over een kolom die niet bestaat. **Doe
ze in deze volgorde:** eerst de database, dan de functies, dan de app.

### De database

`supabase/bijwerken.sql` is gegenereerd uit de migraties en is idempotent —
opnieuw draaien mag. Plak hem in de SQL-editor van Supabase.

Let op: de editor toont **geen** `NOTICE`-meldingen. Staat er "Success. No
rows returned", dan betekent dat alleen dat er geen fout was. Wil je weten of
iets werkelijk gelukt is, vraag het dan met een `select` die rijen teruggeeft.

### De functies

```bash
npm run functions
```

Dat is twee stappen achter elkaar: `functions:open` voor de functies die
zonder inlog bereikbaar moeten zijn (de mailwebhook, de lezer, de wekkers) en
`functions:dicht` voor de rest. **Rol ze niet met de hand uit** — een kale
`supabase functions deploy` zet de JWT-controle weer aan, en dan komt er geen
post meer binnen.

Staat `supabase` niet op je PATH: hij zit in het project, dus gebruik `npx
supabase …`.

### De app

```bash
npm version 1.90.0 --no-git-tag-version
git commit -am "Versie 1.90.0: …"
git tag -a v1.90.0 -m "…"
git push && git push origin v1.90.0
```

De tag start de workflow *Release publiceren*, die de Windows-installer en de
Android-APK bouwt en onder Releases hangt. Daar haalt de geïnstalleerde app
zijn update vandaan.

Let op: **de kassa brengt ook versies uit vanuit deze repo.** Lees
`package.json` voordat je ophoogt.

### De lezer

Zie [lokale-lezer.md](lokale-lezer.md). Kort: op de pc op kantoor de nieuwe
code ophalen en `npm start` in `lezer/` opnieuw draaien.

---

## De wekkers

Sinds 0101/0102 draaien de wekkers in de database met `pg_cron`, naast de
functies die ze wekken. Dat was eerst GitHub Actions, en dat had drie
problemen: het is een omweg, GitHub laat geplande workflows bij drukte vallen,
en de uitkomst stond in een tabblad van een website in plaats van in iets wat
wij kunnen uitlezen.

| Wekker | Wanneer | Wekt |
|---|---|---|
| `voorraad-direct` | elk kwartier | `trucksupply`, actie `direct` |
| `voorraad-ochtend` | elk uur 4–9 UTC | `trucksupply`, actie `ochtend` |
| `takenmail` | elk uur 4–14 UTC | `takenmail`, actie `normaal` |

De uren zijn UTC en Nederland verzet twee keer per jaar de klok. Daarom loopt
de wekker elk heel uur binnen een venster langs en beslist de **functie** zelf
of het lokaal het ingestelde uur is. Zo werkt hetzelfde rooster zomer en
winter.

### Instellen of opnieuw instellen

```sql
select * from public.wekkers_instellen();
```

Geeft per wekker terug of het lukte, en zo niet waarom. Idempotent.

Nodig daarvoor:

- de instelling `functies_url` gevuld met het adres van de Edge Functions
- twee geheimen in de kluis: `voorraad_cron_secret` en `taken_cron_secret`,
  met dezelfde waarde als de functiegeheimen `VOORRAAD_CRON_SECRET` en
  `TAKEN_CRON_SECRET`

```sql
select vault.create_secret('<wachtwoord>', 'voorraad_cron_secret');
```

```bash
npx supabase secrets set VOORRAAD_CRON_SECRET=<hetzelfde> --project-ref <ref>
```

Komen die twee niet overeen, dan geeft de functie een 403 en gebeurt er niets.

### Kijken of ze het doen

```sql
select * from public.wekkers_stand();
```

| Kolom | Betekent |
|---|---|
| `actief` | staat hij in de planning |
| `laatst_at` | wanneer hij voor het laatst iets wekte |
| `antwoord` | de HTTP-status die de functie teruggaf |
| `antwoord_hoe` | in woorden |
| `mislukt` | hoeveel van de laatste rondes geen antwoord of een fout gaven |

**Let op het verschil tussen "gelopen" en "gehoord".** `net.http_post` is
asynchroon: de cron-taak slaagt zodra het verzoek is weggezet, óók als de
functie er een 403 op teruggeeft. Alleen `antwoord` zegt of er werkelijk iets
gebeurd is.

Antwoorden worden door pg_net zes uur bewaard. Daarna staat er "antwoord niet
(meer) bewaard" — dat betekent dat hij gelopen heeft en dat we niet meer weten
hoe het afliep. Dat is bewust iets anders dan "gelukt".

### Terug naar GitHub

De workflows staan er nog, zonder planning maar met de handknop. Wil je terug,
zet dan de `schedule:`-regels terug onder `on:` in
`.github/workflows/taken.yml` en `voorraad.yml`, en haal de cron-taken weg:

```sql
select cron.unschedule('voorraad-direct');
select cron.unschedule('voorraad-ochtend');
select cron.unschedule('takenmail');
```

---

## Instellingen

Ze staan in de tabel `instellingen` en zijn te zien bij Beheer. De belangrijke:

| Sleutel | Waarvoor |
|---|---|
| `functies_url` | adres van de Edge Functions; nodig voor de wekkers |
| `inkoop_domein` | het domein waarop facturen binnenkomen. Moet bij Resend ingesteld zijn |
| `inkoop_voorvoegsel` | het stuk vóór de punt, standaard `inkoop` |
| `werk_domein` | het domein voor werkmail |
| `factuur_lezer` | wie de facturen leest: leeg, `lokaal` of `lokaal-terugval` |
| `factuur_automatisch` | staat het automatisch verwerken aan |
| `vier_ogen` / `vier_ogen_vanaf` | of en vanaf welk bedrag er twee handtekeningen nodig zijn |
| `auto_goedkeuren` en `auto_goedkeuren_*` | of de eerste handtekening vanzelf mag, en binnen welke grenzen |
| `exact_dagboek` / `exact_verkoopdagboek` | terugval als een bv geen eigen dagboek heeft |
| `trucksupply_ochtend_uur` | op welk lokaal uur het voorraadoverzicht gaat |
| `lezer_laatst_gezien` / `lezer_model` | door de lezer zelf bijgehouden; hier kijk je of hij nog leeft |

---

## Als er iets stilstaat

Loop dit langs. Het staat op volgorde van hoe vaak het de oorzaak is.

**1. Draait de lezer nog?**

```sql
select waarde from public.instellingen where sleutel = 'lezer_laatst_gezien';
```

Dat is een tijdstip in milliseconden. Ouder dan een paar minuten betekent dat
het programma op de pc niet loopt.

**2. Lopen de wekkers?** `select * from public.wekkers_stand();` — kijk naar
`antwoord`, niet naar `actief`.

**3. Staan er facturen vast?** Kijk in *Te verwerken* naar de vakken
Vastgelopen en Exact weigert. Bij elke factuur staat de reden.

**4. Ligt er iets te lang bij de bank?** Het betaalscherm meldt facturen die
meer dan tien dagen op *aangeboden* staan.

**5. Komt er post binnen?** Kijk bij *Inkoopadressen* of het adres nog actief
is, en of elke onderneming er een heeft.

**6. Is Exact nog gekoppeld?** Zie [exact-koppelen.md](exact-koppelen.md). Een
token is tien minuten geldig en wordt automatisch ververst; gaat dát mis, dan
staat de koppeling op *los* en moet je opnieuw koppelen.

---

## Wat er nog niet is

Eerlijk, zodat niemand het zoekt:

- **Er is geen proefomgeving.** Alles gaat naar het enige systeem dat er is,
  met de echte boekhouding en de kassa eraan vast.
- **Er is geen scherm dat zegt wat er stilstaat.** De gegevens zijn er
  (`wekkers_stand()`, `lezer_laatst_gezien`, `betaal_blijft_hangen()`), maar
  je moet het zelf gaan vragen. In `statuspagina/` staat een begin dat niet in
  git zit en sinds 1 september niet meer heeft gemeten.
- **Uitrollen is vier losse handelingen** en er is niets dat laat zien welke
  er gedaan zijn. Er is geen manier om te zien welke migratie de server heeft
  of welke versie de functies draaien.
- **Gelijktijdigheid wordt niet getest.** Geen enkele test doet twee dingen
  tegelijk, terwijl daar wel al een fout in heeft gezeten.
