# DMARC aanscherpen voor truckwash1group.nl

Aanleiding: melding M-2609-0012. Er zijn een paar keer interne mails verstuurd
die uit iemands naam leken te komen.

Dit document is bedoeld om door te sturen naar Prodacom. Zij beheren de DNS
(`ns1.prodacom.nl`, `ns2`, `ns3`) en ook het DMARC-record zelf.

---

## Waarom dit geen dashboardprobleem is

De verstuurde mail kwam niet uit onze eigen applicatie. Die verstuurt altijd
vanaf één vast afzenderadres met een vaste reply-to, en legt elke verzending
vast in een logboek. Er bestaat geen pad waarlangs de app namens een medewerker
kan mailen.

Wat er wel gebeurt: iemand van buiten zet ons domein in de afzender. Dat is
mogelijk omdat DMARC bij ons meekijkt maar niets tegenhoudt.

## Wat er nu staat

```
truckwash1group.nl        TXT    v=spf1 include:spf.protection.outlook.com
                                 include:sendgrid.net include:spf.flowmailer.net
                                 include:email-od.com include:spf.routit.net
                                 include:emailsrvr.com include:_spf.prodacom.net
                                 ip4:206.189.99.136 ip4:188.166.72.67 -all

_dmarc.truckwash1group.nl CNAME  _dmarc.prodacom.net
_dmarc.prodacom.net       TXT    v=DMARC1; p=none; sp=none; np=quarantine;
```

Drie dingen vallen op.

**`p=none` houdt niets tegen.** Dit is de stand "kijk mee en rapporteer", niet
"weiger". Een mail die zegt van ons domein te komen maar dat niet is, wordt
gewoon bezorgd. Dit is de directe oorzaak van de melding.

**Er staat geen `rua=`.** Er worden dus nergens rapportages verzameld. Niemand
kan op dit moment zien wie er namens ons domein mailt — ook niet of het vaker
gebeurt dan de paar keer die is opgevallen.

**Het record is een CNAME naar `_dmarc.prodacom.net`.** Ons beleid is daarmee
hetzelfde als dat van alle andere klanten die naar dat record wijzen. Wij kunnen
het niet apart aanpassen zonder dat het een eigen record wordt.

De SPF is streng (`-all`) en dat is goed, maar SPF kijkt naar het envelop-adres
en niet naar de afzender die de ontvanger in beeld krijgt. Precies dat gat dicht
DMARC.

## Wat wel goed staat

DKIM voor Microsoft 365 is correct ingericht: beide selectors staan er.

```
selector1._domainkey  CNAME  selector1-truckwash1group-nl._domainkey.vrachtwagenwassen.onmicrosoft.com
selector2._domainkey  CNAME  selector2-truckwash1group-nl._domainkey.vrachtwagenwassen.onmicrosoft.com
```

Onze gewone kantoormail via Outlook is dus al ondertekend en uitgelijnd. Die
loopt bij een strenger beleid geen gevaar.

---

## Het verzoek

### Stap 1 — nu: een eigen record met rapportage

Vervang de CNAME door een eigen TXT-record:

```
_dmarc.truckwash1group.nl   TXT   "v=DMARC1; p=none; sp=none; adkim=r; aspf=r; fo=1; rua=mailto:dmarc@truckwash1group.nl"
```

Wat hier verandert en waarom:

- **een eigen record** in plaats van de CNAME, zodat ons beleid van ons is
- **`rua=`** zodat de ontvangende partijen dagelijks rapporteren wie er namens
  ons mailt. Zonder deze stap is stap 2 gokken.
- **`p=none` blijft nog staan.** Deze stap verandert bewust niets aan de
  bezorging; hij zet alleen het licht aan.

Het adres `dmarc@truckwash1group.nl` moet bestaan en post kunnen ontvangen. De
rapportages zijn XML in een zip-bestand; die zijn los te lezen of door een
verwerker te halen.

### Stap 2 — na twee tot vier weken: quarantaine

Als uit de rapportages blijkt dat alle echte verzenders uitgelijnd zijn:

```
_dmarc.truckwash1group.nl   TXT   "v=DMARC1; p=quarantine; pct=100; sp=quarantine; adkim=r; aspf=r; fo=1; rua=mailto:dmarc@truckwash1group.nl"
```

Vanaf hier belandt vervalste post in de map ongewenst in plaats van in de inbox.

### Stap 3 — daarna: weigeren

```
_dmarc.truckwash1group.nl   TXT   "v=DMARC1; p=reject; pct=100; sp=reject; adkim=r; aspf=r; fo=1; rua=mailto:dmarc@truckwash1group.nl"
```

Dan wordt vervalste post geweigerd en komt hij nergens meer aan.

## Waarom niet meteen naar reject

Onze SPF noemt zeven verzendende partijen en twee losse IP-adressen:

- `spf.protection.outlook.com` — Microsoft 365, onze kantoormail
- `sendgrid.net`
- `spf.flowmailer.net`
- `email-od.com`
- `spf.routit.net`
- `emailsrvr.com`
- `_spf.prodacom.net`
- `206.189.99.136` en `188.166.72.67`

Van Microsoft 365 weten we dat DKIM goed staat. Van de andere zes weten we dat
niet. Zet je meteen `p=reject` en is er één bij die niet uitgelijnd verstuurt,
dan verdwijnt die post zonder dat iemand het merkt — facturen, wachtwoordmails,
bevestigingen aan klanten. Vandaar eerst kijken en dan pas dichtdraaien.

## Wat wij aan onze kant al doen

In het dashboard staat sinds versie 1.47.0 een scherm **Beveiliging** onder
Ontwikkeling. Daar is te zien wat er in de systemen verwijderd is en welke
apparaten opvallen. Wat daar niet in staat en ook niet in kan: mail die buiten
onze applicatie om verstuurd wordt. Dat is precies waar dit DNS-record over
gaat.
