/* Genereert een losstaande statische website: één echt HTML-bestand per URL. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HIER = __dirname;
const WEB = process.env.UIT || path.join(HIER, "web");
const DATA = JSON.parse(fs.readFileSync(path.join(HIER, "site.json"), "utf8"));
const BEELD = JSON.parse(fs.readFileSync(path.join(HIER, "beeld.json"), "utf8"));
const SITE = "https://truckwash1group.nl";
/* Het domein waar deze gebouwde site echt wordt uitgerold. SITE hierboven is
   het oude merkdomein en blijft de canonical voor alle pagina's die daar ook
   bestaan. Voor een pagina die daar NIET bestaat klopt dat niet meer -- zie de
   route medewerkers verderop. */
const UITROL = "https://truckwash-workspace.com";

/* ---------- de wettelijk verplichte bedrijfsgegevens ----------
 *
 * Artikel 3:15d BW: wie langs elektronische weg diensten aanbiedt, moet zijn
 * identiteit, adres, e-mailadres, KvK-nummer en btw-identificatienummer
 * "gemakkelijk, rechtstreeks en permanent toegankelijk" maken. Niet ergens in
 * de kleine lettertjes van een offerte, maar op de site.
 *
 * De AVG legt daar bovenop dat een privacyverklaring moet zeggen WIE de
 * verwerkingsverantwoordelijke is. "Truckwash 1 Group" is een handelsnaam en
 * geen rechtspersoon; er moet een B.V. onder staan.
 *
 * Wat hier op null staat, staat niet op de site. Dat is met opzet: een
 * verzonnen KvK-nummer op een privacyverklaring is erger dan een ontbrekend
 * nummer -- het eerste is onjuiste informatie over een bedrijf, het tweede is
 * een gat dat je ziet. De bouw waarschuwt eronder.
 */
const BEDRIJF = {
  handelsnaam: "Truckwash 1 Group",
  /* De B.V. die deze site uitgeeft en die de verwerkingsverantwoordelijke is. */
  rechtspersoon: null,
  kvk: null,
  btw: null,
  straat: "Industriestraat 28",
  postcode: "4715 RL",
  plaats: "Rucphen",
  tel: "088 - 0600 100",
  telHref: "tel:0880600100",
  email: "info@truckwash1group.nl",
};

/* De datum onder de verklaringen. Met de hand, niet de bouwdatum: anders zegt
   de pagina dat de tekst is herzien terwijl er alleen een vestiging is
   bijgekomen. */
const VERKLARING_DATUM = "7 september 2026";

const ONTBREEKT = ["rechtspersoon", "kvk", "btw"].filter((k) => !BEDRIJF[k]);
if (ONTBREEKT.length) {
  console.warn("BEDRIJF mist: " + ONTBREEKT.join(", ") + " -- die regels blijven van de site weg.");
  console.warn("  Wettelijk verplicht (art. 3:15d BW). Invullen in bouw/webbouw.cjs.");
}


/* De releases van het dashboard, opgehaald door releases.cjs. Ontbreekt het
   bestand, dan bouwt de site gewoon door: /medewerkers/ wijst dan naar de
   releasepagina op GitHub in plaats van naar losse bestanden. Een bouw die
   omvalt op een ontbrekend cachebestand is erger dan een pagina zonder
   directe downloadknop. */
let RELEASES = [];
try {
  RELEASES = JSON.parse(fs.readFileSync(path.join(HIER, "releases.json"), "utf8")).releases || [];
} catch (e) {
  console.warn("releases.json ontbreekt of is stuk -- /medewerkers/ krijgt geen directe downloads.");
  console.warn("  Herstellen met:  node releases.cjs");
}

/* De vestigingen komen uit de database, opgehaald door vestigingen.cjs en
   vertaald door omzet.cjs. Ontbreekt het bestand of is het stuk, dan blijft
   site.json de bron -- precies zoals hierboven bij releases.json, en om
   dezelfde reden: de site hoort te bouwen met wat er ligt.

   DIT MOET HIER STAAN, boven vm.runInContext verderop. brok.js leest op zijn
   eerste regel document.getElementById("sitedata") en krijgt daarmee dit hele
   DATA-object. Zet je de omwisseling daarna, dan komen de routes, de voettekst
   en data.js uit de database terwijl de achttien pagina's zelf nog uit
   site.json komen: dezelfde site met twee waarheden erin, zonder foutmelding.

   Het is met opzet een regel op een plek. Alles verderop leest DATA.locaties --
   de routes, de JSON-LD, de sitemap, de voettekst, assets/data.js en de
   pagina's zelf. Een tweede variabele ernaast splitst de bron.

   MEDEWERKERS gaat als los getal de zandbak in, naast RELEASES. Zie de zin op
   /werken-bij/ in brok.js. */
let MEDEWERKERS = null;
try {
  const { locaties } = require("./omzet.cjs");
  const rauw = JSON.parse(fs.readFileSync(path.join(HIER, "vestigingen.json"), "utf8"));
  DATA.locaties = locaties(rauw.vestigingen, DATA.locaties);

  /* De vacatures komen sinds 0068 uit de database en niet meer uit site.json.
     Ze worden hier omgezet naar precies de vorm die brok.js al tekende --
     kop, tekst, lijst -- zodat de pagina's er hetzelfde uitzien en er niets
     aan de tekenkant hoeft te veranderen.

     Ontbreekt de lijst (oude functie, geen bereik), dan blijft site.json de
     bron. Een vacaturepagina zonder vacatures is erger dan een verouderde. */
  if (Array.isArray(rauw.vacatures) && rauw.vacatures.length) {
    DATA.vacatures = rauw.vacatures.map((v) => {
      const inhoud = [];
      if (v.tekst) {
        for (const stuk of String(v.tekst).split(/\n{2,}/)) {
          if (stuk.trim()) inhoud.push({ type: "tekst", tekst: stuk.trim() });
        }
      }
      const lijst = (kop, punten) => {
        if (!Array.isArray(punten) || !punten.length) return;
        inhoud.push({ type: "kop", tekst: kop });
        inhoud.push({ type: "lijst", punten });
      };
      lijst("Wat ga je doen?", v.taken);
      lijst("Wie ben jij?", v.eisen);
      lijst("Wat bieden wij?", v.bieden);
      return {
        slug: v.slug,
        titel: v.titel,
        intro: v.intro || "",
        uren: v.uren || null,
        /* Waar je kunt solliciteren. Leeg zou betekenen dat het formulier geen
           vestiging kan aanbieden, en dan komt de sollicitatie bij niemand op
           het bord terecht -- zie de trigger in 0068. */
        locaties: Array.isArray(v.locaties) ? v.locaties : [],
        inhoud,
      };
    });
    console.log(`vacatures: ${DATA.vacatures.length} uit de database`);
  }
  MEDEWERKERS = Number.isInteger(rauw.medewerkers) ? rauw.medewerkers : null;

  /* Het aantal medewerkers wordt bij de bouw in de HTML gebakken en veroudert
     daarna. Dat is te dragen -- het verandert een paar keer per jaar -- maar
     niet eindeloos. Bij een bestand ouder dan negentig dagen bouwt de site wel
     door met de vestigingen (zonder vestigingen is er geen site), maar valt de
     zin weg (zonder die zin is er gewoon de pagina van nu). */
  const dagen = (Date.now() - Date.parse(rauw.opgehaald)) / 86400000;
  if (!(dagen < 90)) {
    console.warn("vestigingen.json is " +
      (isFinite(dagen) ? Math.round(dagen) + " dagen oud" : "niet te dateren") +
      " -- de zin met het aantal medewerkers blijft weg.");
    console.warn("  Verversen met:  node vestigingen.cjs");
    MEDEWERKERS = null;
  }
  console.log(`vestigingen: ${DATA.locaties.length} uit de database` +
    (MEDEWERKERS === null ? "" : `, ${MEDEWERKERS} medewerkers`));
} catch (e) {
  console.warn("vestigingen.json ontbreekt of is stuk -- site.json blijft de bron.");
  console.warn("  " + e.message);
  console.warn("  Herstellen met:  node vestigingen.cjs");
}

const esc = t => String(t == null ? "" : t)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- de paginafuncties uit de preview hergebruiken ---------- */
let brok = fs.readFileSync(path.join(HIER, "brok.js"), "utf8");
// afbeeldingen als losse bestanden in plaats van ingebakken data-URI's
brok = brok.replace('src="${b.uri}"', 'src="/assets/img/${rol}.webp"')
           .replace('loading="lazy">`;', 'loading="lazy" decoding="async">`;');

const soepel = () => new Proxy(function () {}, {
  get(t, k) {
    if (k === "textContent" || k === "innerHTML" || k === "value" || k === "className") return "";
    if (k === "style") return {};
    if (k === "classList") return { add() {}, remove() {}, toggle() { return false; } };
    if (k === "options" || k === "cells") return [];
    if (k === Symbol.toPrimitive || k === "toString") return () => "";
    return soepel();
  },
  set() { return true; },
  apply() { return soepel(); },
});

const doc = {
  getElementById(id) {
    if (id === "sitedata") return { textContent: JSON.stringify(DATA) };
    if (id === "beelddata") return { textContent: JSON.stringify(BEELD) };
    return soepel();
  },
  querySelector: () => soepel(),
  querySelectorAll: () => [],
  createElement: () => soepel(),
  images: [],
};

const zand = {
  document: doc,
  location: { hash: "#/" },
  addEventListener() {},
  requestAnimationFrame() {},
  scrollTo() {},
  matchMedia: () => ({ matches: false }),
  devicePixelRatio: 1,
  console,
  THREE: undefined,
  /* Vlag voor brok.js: hier wordt statisch gebouwd, dus new Date() is de
     bouwdag en niet het moment waarop iemand de pagina bekijkt. Wat van de tijd
     afhangt hoort dan niet in de HTML gebakken te worden. In de preview
     (template.html) bestaat deze vlag niet en rekent dezelfde code wel gewoon. */
  STATISCH: true,
  RELEASES,
  /* Het aantal medewerkers uit website_aantal_medewerkers(), of null. In de
     preview (template.html) bestaat deze variabele niet en hoort de pagina er
     uit te zien zoals de terugval: zonder de zin. brok.js gebruikt daarom een
     typeof-guard en niet alleen een waarheidstest. */
  MEDEWERKERS,
  JSON, Math, Date, Number, String, Array, Object, RegExp, isNaN, parseInt, parseFloat,
  encodeURIComponent, decodeURIComponent, Symbol, Proxy,
};
zand.window = zand;
zand.globalThis = zand;
vm.createContext(zand);
vm.runInContext(brok, zand, { filename: "brok.js" });

/* ---------- routes: hash -> echt pad ---------- */
const R = [];
R.push({ driedee: true, pad: "", fn: () => zand.paginaHome(), titel: `Vrachtwagen wassen bij Truckwash 1 | ${DATA.locaties.length} vestigingen in Nederland`,
  desc: `Vrachtwagen wassen zonder afspraak bij ${DATA.locaties.length} vestigingen in Nederland. Prijzen vooraf bekend, HACCP- en NAO-gecertificeerd.`, prio: "1.0" });
R.push({ driedee: true, kaart: true, pad: "locaties", fn: () => zand.paginaLocaties(), titel: `Alle ${DATA.locaties.length} vestigingen | Truckwash 1 Group`,
  desc: "Bekijk alle achttien Truckwash-vestigingen in Nederland met adres, openingstijden en route.", prio: "0.9" });
R.push({ pad: "prijzen", fn: () => zand.paginaPrijzen(), titel: "Prijzen 2026 | Truckwash 1 Group",
  desc: "Alle tarieven voor vrachtwagen wassen, inwendig reinigen, toeslagen en wasboxen. Exclusief 21% btw.", prio: "0.9" });
R.push({ pad: "diensten", fn: () => zand.paginaDiensten(), titel: "Diensten en behandelingen | Truckwash 1 Group",
  desc: "Van Alcoa-velgen tot HACCP-reiniging, truckparking, truckshop en catering. Alles op één terrein.", prio: "0.8" });
R.push({ pad: "werken-bij", fn: () => zand.paginaWerkenBij(), titel: "Werken bij Truckwash 1 Group | Vacatures",
  desc: "Vacatures bij Truckwash 1 Group. Geen diploma's nodig, wel de wil om te leren. Bekijk het bruto uurloon.", prio: "0.8" });
R.push({ pad: "over-ons", fn: () => zand.paginaOverOns(), titel: "Over Truckwash 1 Group",
  desc: "Hoe Truckwash 1 Group de standaard werd in vrachtwagens wassen, met achttien vestigingen door heel Nederland.", prio: "0.6" });
R.push({ pad: "veelgestelde-vragen", fn: () => zand.paginaFaq(), titel: "Veelgestelde vragen | Truckwash 1 Group",
  desc: "Antwoord op de meestgestelde vragen over wassen, betalen, openingstijden en behandelingen.", prio: "0.6" });
R.push({ pad: "privacy", fn: () => paginaPrivacy(), titel: "Privacyverklaring | Truckwash 1 Group",
  desc: "Wat Truckwash 1 Group wel en niet vastlegt van bezoekers van deze site. Geen cookies, geen statistieken, geen trackers.", prio: "0.3" });
R.push({ pad: "cookies", fn: () => paginaCookies(), titel: "Cookies en opslag | Truckwash 1 Group",
  desc: "Deze site zet geen cookies. Wat er wel in je browser wordt opgeslagen, en hoe je je keuze over Trucky verandert.", prio: "0.3" });
R.push({ pad: "contact", fn: () => zand.paginaContact(), titel: "Contact | Truckwash 1 Group",
  desc: "Neem contact op met Truckwash 1 Group. Bel 088 - 0600 100 of mail info@truckwash1group.nl.", prio: "0.7" });

/* Deze pagina bestaat NIET op het oude merkdomein -- gemeten: truckwash1group.nl
   /medewerkers/ geeft 404, terwijl /contact/ daar wel 200 geeft. Daarom twee
   afwijkingen van de andere routes:
     canoniek      wijst naar het uitroldomein, waar de pagina echt staat. Een
                   canonical naar een 404 zorgt ervoor dat Google de pagina
                   helemaal niet opneemt.
     buitenSitemap want sitemap.xml wordt met SITE gestempeld en zou hier dus
                   een dood adres in de lijst zetten.
   De pagina blijft gewoon indexeerbaar: er staat geen noindex op en hij is
   vanaf elke pagina bereikbaar via de knop in de kop. */
R.push({ pad: "medewerkers", fn: () => zand.paginaMedewerkers(),
  titel: "De app voor medewerkers | Truckwash 1 Group",
  desc: "Voor wie bij Truckwash 1 werkt: de app downloaden voor Windows of Android, inloggen op de werkplek, en zien wat er per versie is veranderd.",
  canoniek: UITROL + "/medewerkers/", buitenSitemap: true, prio: "0.4" });

DATA.locaties.forEach(l => R.push({
  pad: `locaties/${l.slug}`, fn: () => zand.paginaLocatie(l.slug),
  titel: `Vrachtwagen wassen in ${l.plaats} | Truckwash 1 ${l.plaats}`,
  desc: `Truckwash 1 ${l.plaats} aan de ${l.straat}. Geen afspraak nodig. Bekijk openingstijden, route en prijzen.`,
  prio: "0.8", jsonld: localBusiness(l),
  /* Voor de onderbalk op de telefoon: op deze pagina gaat Route naar de
     routebeschrijving van deze vestiging en Bel ons naar haar eigen nummer. */
  loc: l,
}));
DATA.diensten.forEach(d => R.push({
  pad: `diensten/${d.slug.split("/").pop()}`, fn: () => zand.paginaDienst(d.slug),
  titel: `${d.titel} | Truckwash 1 Group`,
  desc: (d.tekst[0] || d.titel).slice(0, 155), prio: "0.6",
}));
DATA.vacatures.forEach(v => R.push({
  pad: `werken-bij/${v.slug}`, fn: () => zand.paginaVacature(v.slug),
  titel: `Vacature ${v.titel} | Werken bij Truckwash 1 Group`,
  desc: (v.intro || `Vacature ${v.titel} bij Truckwash 1 Group.`).slice(0, 155),
  prio: "0.7", jsonld: jobPosting(v),
}));

/* ---------- de verklaringen ----------
   Deze twee pagina's staan hier en niet in brok.js, omdat ze geen gegevens
   nodig hebben: het is vaste tekst en die hoort niet door de zandbak die
   brok.js draait. Wat er wel in staat -- de bedrijfsgegevens -- komt uit één
   plek hierboven, zodat de voettekst en de verklaringen niet uit elkaar
   kunnen lopen. */

function kop(label, titel, onder) {
  return `<div class="detailkop">
    <div class="shell">
      <p class="label">${esc(label)}</p>
      <h1 style="font-size:clamp(30px,4.6vw,50px)">${titel}</h1>
      ${onder ? `<p style="color:#c3d0e8;font-size:18px;max-width:60ch;margin:14px 0 0">${onder}</p>` : ""}
    </div>
  </div>`;
}

/* De regel met KvK en btw. Wat ontbreekt blijft weg -- zie BEDRIJF. */
function bedrijfsregels() {
  const r = [
    `${esc(BEDRIJF.rechtspersoon || BEDRIJF.handelsnaam)}`,
    `${esc(BEDRIJF.straat)}, ${esc(BEDRIJF.postcode)} ${esc(BEDRIJF.plaats)}`,
    `<a href="${BEDRIJF.telHref}">${esc(BEDRIJF.tel)}</a>`,
    `<a href="mailto:${esc(BEDRIJF.email)}">${esc(BEDRIJF.email)}</a>`,
  ];
  if (BEDRIJF.kvk) r.push(`KvK ${esc(BEDRIJF.kvk)}`);
  if (BEDRIJF.btw) r.push(`Btw-id ${esc(BEDRIJF.btw)}`);
  return r.join("<br>");
}

function paginaPrivacy() {
  return kop("Privacy", "Wat we <em>wel</em> en <em>niet</em> van je weten",
    "Geen cookies, geen bezoekersteller, en niets dat je over het internet volgt. Hieronder staat in gewone taal wat er dan w&eacute;l gebeurt.") +
`<section class="blok licht" style="padding-top:var(--s4)">
  <div class="shell verklaring" style="max-width:780px">

    <h2>Wie dit is</h2>
    <p>${bedrijfsregels()}</p>
    ${BEDRIJF.rechtspersoon ? "" : "<p><em>De rechtspersoon en de registratienummers worden hier ingevuld.</em></p>"}

    <h2>Wat we niet doen</h2>
    <p>Het korte antwoord is: bijna niets. Er staan <strong>geen cookies</strong> op deze
      site, van ons niet en van een ander niet. We tellen je niet mee, we
      verkopen niets door, en er staan geen advertentieknoppen of meekijkende
      deelknoppen van sociale media op.</p>
    <p>Ook de letters en de bewegende kaart komen van onze eigen site. Dat klinkt
      als een detail, maar het scheelt wel iets: stonden die ergens anders, dan
      zou jouw computer bij het openen van deze pagina eerst even bij dat
      andere bedrijf langsgaan, en dat bedrijf ziet dan waar je vandaan komt.
      Zonder dat je er iets over te zeggen had. Vandaar dat we alles zelf in
      huis hebben gehaald.</p>

    <h2>Wat er dan wel wordt vastgelegd</h2>
    <p>Het bedrijf dat deze site voor ons online houdt, legt vast wat elke
      webserver vastlegt: je IP-adres, het tijdstip, welke pagina je opvroeg en
      met welke browser. Dat is er om de site in de lucht en veilig te houden
      &mdash; storingen opsporen, misbruik tegenhouden. We gebruiken het niet om
      je te volgen, we koppelen het niet aan wie je bent, en het wordt niet
      langer bewaard dan daarvoor nodig is. De wet noemt dat een gerechtvaardigd
      belang (artikel 6 lid 1 sub f AVG).</p>

    <h2>Trucky, die je vragen beantwoordt</h2>
    <p>Rechtsonder kan een gele knop staan waar je iets kunt vragen over
      openingstijden, prijzen of een vacature. <strong>Trucky staat uit tot je hem
      zelf aanzet</strong> &mdash; zolang je dat niet doet, wordt hij niet eens
      ingeladen. Zet je hem aan, dan is dit wat er gebeurt:</p>
    <ul>
      <li>Je vraag gaat naar ons toe, en wij laten er door slimme software een
        antwoord op opstellen. Die software staat bij een gespecialiseerd
        bedrijf in de Verenigde Staten; onze eigen gegevens staan in Ierland.</li>
      <li>Van het gesprek houden we alleen bij dat er &eacute;&eacute;n is geweest: een
        willekeurig nummer, het tijdstip en hoeveel vragen er zijn gesteld. Dat
        is er om de kosten in de hand te houden. <strong>Wat je hebt getypt bewaren
        we niet.</strong></li>
      <li>Vraag je Trucky om het gesprek per mail toe te sturen, of laat je een
        vraag achter voor een collega, dan bewaren we w&eacute;l wat je invult: je
        naam, e-mailadres, telefoonnummer, bedrijf, je vraag en wat er in het
        gesprek is gezegd. Zonder dat kunnen we je niet terugbellen.</li>
    </ul>
    <p>Dit gebeurt alleen omdat je er ja tegen hebt gezegd, en je kunt dat op elk
      moment terugdraaien: <a href="/cookies/">op de cookiepagina</a> of
      <button type="button" class="tekstknop" data-toestemming>hier meteen</button>.
      Zet je hem uit, dan verdwijnt de knop en wordt gewist wat er in je browser
      stond.</p>

    <h2>Contact opnemen</h2>
    <p>Er staan twee formulieren op <a href="/contact/">de contactpagina</a>, en ze
      werken niet hetzelfde.</p>
    <p>Het <strong>contactformulier</strong> stuurt niets naar ons: het opent je eigen
      e-mailprogramma met de tekst er alvast in. Wat je daarna verstuurt is een
      gewone e-mail, en die behandelen we zoals alle post die binnenkomt &mdash; we
      bewaren hem zolang dat nodig is om je vraag af te handelen en om te weten
      wat er is afgesproken.</p>
    <p>Het formulier <strong>&ldquo;Klant worden&rdquo;</strong> doet dat w&eacute;l. Wat je invult
      &mdash; je naam, e-mailadres, telefoonnummer, bedrijf, het aantal wagens, de
      vestiging van je voorkeur en je opmerking &mdash; gaat naar onze eigen server
      en komt in ons dashboard terecht, waar administratie en management het
      oppakken. Je krijgt een bevestiging per e-mail. Dat
      doen we om je aanmelding te kunnen behandelen (artikel 6 lid 1 sub b AVG:
      de aanloop naar een overeenkomst). Word je klant, dan gaan die gegevens
      mee naar de klantadministratie; word je het niet, dan bewaren we ze niet
      langer dan nodig is om de aanmelding af te handelen.</p>

    <h2>Solliciteren</h2>
    <p>De sollicitatieknoppen bij de vacatures gaan naar
      <span style="white-space:nowrap">truckwash.trainstation.nl</span>, het
      systeem waar onze sollicitaties in binnenkomen. Dat is een andere partij
      met een eigen privacyverklaring; wat je daar invult valt onder die
      verklaring en die van ons als werkgever.</p>

    <h2>De pagina voor medewerkers</h2>
    <p>Op <a href="/medewerkers/">de pagina voor medewerkers</a> staat de lijst met
      versies van onze app. Die lijst wordt opgehaald bij de partij waar die
      bestanden staan, en die ziet daarbij je IP-adres. Dat is de enige pagina
      waar dat gebeurt.</p>

    <h2>Wat er op je apparaat wordt opgeslagen</h2>
    <p>Geen cookies. Wel een paar dingen in de opslag van je browser, allemaal
      met een reden en geen ervan geschikt om je mee te volgen. Ze staan een
      voor een op de <a href="/cookies/">cookie- en opslagpagina</a>.</p>

    <h2>Wie we inschakelen</h2>
    <p>We doen niet alles zelf. De wet wil dat we opschrijven wie ons daarbij
      helpt en waarvoor, dus daar is deze lijst voor. Geen van deze partijen mag
      jouw gegevens voor iets anders gebruiken.</p>
    <div class="tblwrap">
      <table>
        <thead><tr><th>Partij</th><th>Waarvoor</th><th>Waar</th></tr></thead>
        <tbody>
          <tr><td>Cloudflare</td><td>Deze site online houden</td><td>Wereldwijd netwerk</td></tr>
          <tr><td>Supabase</td><td>Onze gegevens bewaren: aanmeldingen en gesprekken</td><td>Ierland (EU)</td></tr>
          <tr><td>Anthropic</td><td>Het antwoord van Trucky opstellen</td><td>Verenigde Staten</td></tr>
          <tr><td>Resend</td><td>De bevestigingsmail versturen</td><td>Verenigde Staten</td></tr>
          <tr><td>GitHub</td><td>De app-bestanden voor medewerkers</td><td>Verenigde Staten</td></tr>
          <tr><td>Trainstation</td><td>Sollicitaties verwerken</td><td>Nederland</td></tr>
        </tbody>
      </table>
    </div>
    <p>De drie in de Verenigde Staten komen alleen in beeld als het nodig is: als
      je Trucky aanzet, als er een mail de deur uit moet, of als je de pagina
      voor medewerkers opent. Voor die doorgifte gelden de standaardbepalingen
      van de Europese Commissie.</p>

    <h2>Wat jij kunt vragen</h2>
    <p>Je mag altijd opvragen wat we van je hebben, het laten verbeteren of laten
      wissen, bezwaar maken, of vragen of je het mee kunt krijgen. Een mailtje is
      genoeg:
      <a href="mailto:${esc(BEDRIJF.email)}">${esc(BEDRIJF.email)}</a>. We reageren
      binnen een maand.</p>
    <p>Kom je er met ons niet uit, dan kun je klagen bij de Autoriteit
      Persoonsgegevens,
      <a href="https://autoriteitpersoonsgegevens.nl/" target="_blank" rel="noopener">autoriteitpersoonsgegevens.nl</a>.</p>

    <h2>Als dit verandert</h2>
    <p>Verandert er iets, dan verandert deze tekst mee en komt er een nieuwe datum
      onder te staan. Gaat het om iets waar je ja tegen hebt gezegd, dan vragen
      we het je gewoon opnieuw &mdash; een oud vinkje geldt niet voor iets nieuws.</p>

    <p style="margin-top:var(--s4);color:var(--inkt-3)">Laatst bijgewerkt op ${VERKLARING_DATUM}.</p>
  </div>
</section>`;
}

function paginaCookies() {
  return kop("Cookies", "We zetten er <em>geen</em>",
    "Geen enkele. Er worden wel een paar dingen in je browser onthouden, en je hoort te weten welke.") +
`<section class="blok licht" style="padding-top:var(--s4)">
  <div class="shell verklaring" style="max-width:780px">

    <h2>Cookies: nul</h2>
    <p>Deze site zet geen cookies. Niet voor statistieken, niet voor advertenties,
      en ook geen "functionele". Dat is geen belofte voor later maar hoe het nu
      is, en je kunt het zelf controleren.</p>

    <h2>Wat er wel wordt onthouden</h2>
    <p>Vier dingen, en ze blijven allemaal op je eigen apparaat &mdash; er gaat
      niets van naar ons toe.</p>
    <div class="tblwrap">
      <table>
        <thead><tr><th>Naam</th><th>Waarvoor</th><th>Hoe lang</th></tr></thead>
        <tbody>
          <tr>
            <td>tw-toestemming</td>
            <td>Wat je hieronder kiest, zodat we het niet elke keer vragen</td>
            <td>Tot je het verandert of je browsergegevens wist</td>
          </tr>
          <tr>
            <td>trucky-gesprek</td>
            <td>Alleen met Trucky aan: zodat je gesprek doorloopt als je verder klikt</td>
            <td>Tot je het tabblad sluit</td>
          </tr>
          <tr>
            <td>trucky-uitnodiging</td>
            <td>Alleen met Trucky aan: zodat hij niet twee keer om je aandacht vraagt</td>
            <td>Tot je het tabblad sluit</td>
          </tr>
          <tr>
            <td>tw_releases</td>
            <td>Alleen op de medewerkerspagina: de lijst met versies even onthouden</td>
            <td>Tot je het tabblad sluit</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>Er zit niets bij waarmee je te herkennen bent, en niets ervan wordt met een
      andere site gedeeld.</p>

    <h2 id="keuze">Jouw keuze</h2>
    <p>Er valt &eacute;&eacute;n ding te kiezen, en je mag het hier zo vaak veranderen als je
      wilt. Uitzetten kost precies evenveel moeite als aanzetten.</p>
    <div id="toestemming-keuzes"></div>

    <h2>Zelf wissen</h2>
    <p>Alles hierboven zit gewoon in je browser. Wis je je browsergegevens voor
      deze site, dan is het weg &mdash; en vragen we het je bij je volgende bezoek
      opnieuw.</p>

    <p style="margin-top:var(--s4);color:var(--inkt-3)">Laatst bijgewerkt op ${VERKLARING_DATUM}. Zie ook de <a href="/privacy/">privacyverklaring</a>.</p>
  </div>
</section>`;
}

/* ---------- structuurdata ---------- */
function localBusiness(l) {
  const dag = { Maandag: "Monday", Dinsdag: "Tuesday", Woensdag: "Wednesday", Donderdag: "Thursday",
                Vrijdag: "Friday", Zaterdag: "Saturday", Zondag: "Sunday" };
  const uren = (l.uren || []).filter(u => u.tijd && !/gesloten/i.test(u.tijd)).map(u => {
    const m = u.tijd.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return { "@type": "OpeningHoursSpecification", dayOfWeek: dag[u.dag],
             opens: `${m[1].padStart(2, "0")}:${m[2]}`, closes: `${m[3].padStart(2, "0")}:${m[4]}` };
  }).filter(Boolean);
  return {
    "@context": "https://schema.org", "@type": "AutoWash",
    "@id": `${SITE}/locaties/${l.slug}/#business`,
    name: `Truckwash 1 ${l.plaats}`,
    url: `${SITE}/locaties/${l.slug}/`,
    telephone: l.tel, email: l.email, priceRange: "$$",
    currenciesAccepted: "EUR", paymentAccepted: "Cash, Credit Card, Pin, CargoCard, DKV",
    address: { "@type": "PostalAddress", streetAddress: l.straat, postalCode: l.postcode,
               addressLocality: l.plaats, addressCountry: "NL" },
    geo: l.lat != null ? { "@type": "GeoCoordinates", latitude: l.lat, longitude: l.lng } : undefined,
    openingHoursSpecification: uren,
    parentOrganization: { "@type": "Organization", name: "Truckwash 1 Group", url: SITE + "/" },
  };
}
function jobPosting(v) {
  return {
    "@context": "https://schema.org", "@type": "JobPosting",
    title: v.titel,
    description: v.inhoud.map(s => s.type === "lijst" ? s.punten.join(". ") : s.tekst).join(" ").slice(0, 1800),
    datePosted: "2026-08-01", employmentType: "PART_TIME",
    hiringOrganization: { "@type": "Organization", name: "Truckwash 1 Group", sameAs: SITE + "/" },
    jobLocation: DATA.locaties.slice(0, 6).map(l => ({
      "@type": "Place",
      address: { "@type": "PostalAddress", streetAddress: l.straat, postalCode: l.postcode,
                 addressLocality: l.plaats, addressCountry: "NL" } })),
    directApply: false, url: `${SITE}/werken-bij/${v.slug}/`,
  };
}

/* ---------- hash-links omzetten naar echte paden ---------- */
function paden(html) {
  return html
    .replace(/href="#\/locatie\/([^"]+)"/g, 'href="/locaties/$1/"')
    .replace(/href="#\/dienst\/([^"]+)"/g, (_m, s) => `href="/diensten/${s.split("/").pop()}/"`)
    .replace(/href="#\/vacature\/([^"]+)"/g, 'href="/werken-bij/$1/"')
    .replace(/href="#\/faq"/g, 'href="/veelgestelde-vragen/"')
    .replace(/href="#\/([a-z-]+)"/g, 'href="/$1/"')
    .replace(/href="#\/"/g, 'href="/"');
}

const MENU = [["/locaties/", "Vestigingen"], ["/prijzen/", "Prijzen"], ["/diensten/", "Diensten"],
              ["/werken-bij/", "Werken bij"], ["/over-ons/", "Over ons"], ["/contact/", "Contact"],
              ["https://truckshop.nl/", "Webshop", true],
              ["/medewerkers/", "Inloggen", "werkplek"]];

function omhulsel(r, inhoud) {
  const url = SITE + "/" + (r.pad ? r.pad + "/" : "");
  const actief = "/" + (r.pad ? r.pad.split("/")[0] + "/" : "");
  const org = r.pad === "" ? {
    "@context": "https://schema.org", "@type": "Organization", name: "Truckwash 1 Group",
    url: SITE + "/", telephone: "088-0600 100", email: "info@truckwash1group.nl",
    address: { "@type": "PostalAddress", streetAddress: "Industriestraat 28",
               postalCode: "4715 RL", addressLocality: "Rucphen", addressCountry: "NL" },
    department: DATA.locaties.map(l => ({ "@type": "AutoWash", name: `Truckwash 1 ${l.plaats}`,
      url: `${SITE}/locaties/${l.slug}/` })),
  } : null;
  const lds = [org, r.jsonld].filter(Boolean);
  /* De onderbalk voor de telefoon (css verbergt hem boven 900px). De knoppen
     zelf komen uit onderbalk() in brok.js, zodat preview en site dezelfde balk
     tonen; alleen de adressen verschillen per pagina. Op een vestigingspagina
     springt Locatie naar het adresblok op de pagina zelf (#adres), gaat Route
     naar Google Maps voor die vestiging -- dezelfde routeUrl() die ook onder
     het adres staat -- en belt Bel ons de vestiging via telHref(), die ook
     op de kaart Contact staat en de netnummer-nul achter +31 weghaalt. Elders de
     vestigingenpagina en het algemene nummer. Klant worden gaat altijd naar
     het aanmeldformulier op /contact/. */
  const l = r.loc || null;
  const balk = zand.onderbalk({
    locatie: l ? "#adres" : "/locaties/",
    route: l ? zand.routeUrl(l) : "/locaties/",
    bel: l ? zand.telHref(l) : "tel:0880600100",
    klant: "/contact/#klant-worden",
  });
  /* Uit eigen huis, niet van cdnjs -- zie bouw/threejs.cjs. Een <script> naar
     een vreemde server is een verzoek met het IP-adres van de bezoeker erin,
     en dat gebeurt voordat er iets te kiezen valt. */
  const drieTag = r.driedee
    ? '<script src="/assets/three.min.js" defer></script>\n'
    : "";
  /* De landkaart is 80 kB en wordt op precies één pagina gebruikt. Hij stond
     als constante in app.js, en die staat op alle 47. */
  const kaartTag = r.kaart
    ? '<script src="/assets/nlkaart.js" defer></script>\n'
    : "";
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.titel)}</title>
<meta name="description" content="${esc(r.desc)}">
${r.geenIndex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${r.canoniek || url}">`}
<meta property="og:type" content="website">
<meta property="og:locale" content="nl_NL">
<meta property="og:site_name" content="Truckwash 1 Group">
<meta property="og:title" content="${esc(r.titel)}">
<meta property="og:description" content="${esc(r.desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/assets/img/hero.webp">
<meta name="theme-color" content="#07132e">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/fonts/letters.css">
<link rel="stylesheet" href="/assets/style.css">
${lds.map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body>
<a class="overslaan" href="#inhoud">Naar de inhoud</a>
<header class="kop">
  <div class="shell">
    <a class="merk" href="/">Truckwash<span class="een">1</span></a>
    <button class="hamburger" id="hamburger" aria-expanded="false" aria-controls="menu">Menu</button>
    <nav class="menu" id="menu" aria-label="Hoofdmenu">
      ${MENU.map(([h, t, soort]) => soort === true
        ? `<a class="webshop" href="${h}" target="_blank" rel="noopener">${t} <span aria-hidden="true">&#8599;</span></a>`
        : soort === "werkplek"
        ? `<a class="werkplek" href="${h}"${h === actief ? ' aria-current="page"' : ""}>${t}</a>`
        : `<a href="${h}"${h === actief ? ' aria-current="page"' : ""}>${t}</a>`).join("\n      ")}
    </nav>
    <a class="beltel" href="tel:0880600100">088 &ndash; 0600 100</a>
  </div>
</header>
<main id="inhoud">${inhoud}</main>
<nav class="onderbalk" aria-label="Snel naar">${balk}</nav>
<footer class="voet">
  <div class="shell">
    <div class="voetraster">
      <div>
        <a class="merk" href="/" style="margin-bottom:14px">Truckwash<span class="een">1</span></a>
        <p style="margin:0 0 6px">De standaard in vrachtwagens wassen.<br>${DATA.locaties.length} vestigingen door heel Nederland.</p>
        <p style="margin:14px 0 0"><b style="color:#fff">Correspondentieadres</b><br>${esc(BEDRIJF.straat)}<br>${esc(BEDRIJF.postcode)} ${esc(BEDRIJF.plaats)}</p>
        ${BEDRIJF.rechtspersoon || BEDRIJF.kvk || BEDRIJF.btw ? `<p style="margin:10px 0 0">${[
          BEDRIJF.rechtspersoon && esc(BEDRIJF.rechtspersoon),
          BEDRIJF.kvk && `KvK ${esc(BEDRIJF.kvk)}`,
          BEDRIJF.btw && `Btw-id ${esc(BEDRIJF.btw)}`,
        ].filter(Boolean).join("<br>")}</p>` : ""}
      </div>
      <div><h4>Wassen</h4>
        <a href="/prijzen/">Prijzen</a><a href="/diensten/">Diensten</a>
        <a href="/locaties/">Vestigingen</a><a href="/veelgestelde-vragen/">Veelgestelde vragen</a>
        <a href="https://truckshop.nl/" target="_blank" rel="noopener">Webshop &#8599;</a></div>
      <div><h4>Bedrijf</h4>
        <a href="/over-ons/">Over ons</a><a href="/werken-bij/">Werken bij</a><a href="/contact/">Contact</a>
        <a href="/medewerkers/">Voor medewerkers</a>
        <a href="/privacy/">Privacyverklaring</a><a href="/cookies/">Cookies en opslag</a></div>
      <div><h4>Contact</h4>
        <a href="tel:0880600100">088 &ndash; 0600 100</a>
        <a href="mailto:info@truckwash1group.nl">info@truckwash1group.nl</a>
        <a href="mailto:administratie@truckwash1group.nl">administratie@truckwash1group.nl</a></div>
    </div>
    <div class="voet-locaties">
      <h4>Alle vestigingen</h4>
      ${DATA.locaties.map(l => `<a href="/locaties/${l.slug}/">${esc(l.plaats)}</a>`).join("")}
    </div>
    <div class="onder">
      <span>&copy; 2026 ${esc(BEDRIJF.handelsnaam)}</span>
      <span>Alle prijzen exclusief 21% btw</span>
      <!-- Intrekken moet net zo makkelijk zijn als toestaan; daarom vanaf elke
           pagina bereikbaar en niet alleen in de balk die je één keer ziet. -->
      <button type="button" class="tekstknop" data-toestemming>Cookievoorkeuren</button>
    </div>
  </div>
</footer>
<script src="/assets/data.js" defer></script>
${drieTag}${kaartTag}<script src="/assets/app.js" defer></script>
<!-- live.js haalt bij het openen de actuele gegevens op en werkt bij wat er
     sinds de bouw kan zijn veranderd: de vestigingen, de vacatures, de
     tellingen en de openingstijden. Na app.js, want hij past window.SITE_DATA
     ter plekke aan en die moet dan al bestaan. Gaat het ophalen mis, dan
     blijft deze gebouwde pagina gewoon staan. -->
<script src="/assets/live.js" defer></script>
<!-- trucky.js staat hier met opzet NIET. toestemming.js haalt hem pas op als
     de bezoeker hem aanzet: er gaat dan een vraag naar onze server, en dat is
     niet nodig om deze site te lezen. -->
<script src="/assets/toestemming.js" defer></script>
</body>
</html>`;
}

/* ---------- schrijven ---------- */
let n = 0;
for (const r of R) {
  const map = path.join(WEB, r.pad);
  fs.mkdirSync(map, { recursive: true });
  const html = omhulsel(r, paden(r.fn()));
  fs.writeFileSync(path.join(map, "index.html"), html, "utf8");
  n++;
}

/* ---------- de 404 ----------
   Buiten R, want hij hoort niet in de sitemap. Wel door hetzelfde omhulsel:
   verandert het menu of de voettekst, dan verandert deze mee. Een met de hand
   gemaakte 404 loopt binnen een maand uit de pas met de rest van de site.

   Hij komt als 404.html in de wortel te staan en niet als map met een
   index.html: Cloudflare loopt vanaf het aangevraagde pad omhoog tot hij een
   404.html tegenkomt, en een in de wortel dekt daarmee de hele site. */
fs.writeFileSync(path.join(WEB, "404.html"), omhulsel({
  pad: "404", geenIndex: true,
  titel: "Pagina niet gevonden | Truckwash 1 Group",
  desc: "Deze pagina bestaat niet (meer).",
}, paden(`<div class="detailkop">
  <div class="shell">
    <p class="label">404</p>
    <h1 style="font-size:clamp(32px,5vw,56px);margin-bottom:14px">Deze pagina<br><em>bestaat niet</em></h1>
    <p style="color:#c3d0e8;font-size:19px;max-width:52ch;margin:0">Het adres klopt niet, of de pagina is verhuisd. Hieronder kom je wel verder.</p>
  </div>
</div>
<section class="blok licht" style="padding-top:var(--s4)">
  <div class="shell">
    <p style="display:flex;flex-wrap:wrap;gap:12px;margin:0">
      <a class="knop knop-geel" href="/locaties/">Alle ${DATA.locaties.length} vestigingen</a>
      <a class="knop knop-rand" href="/diensten/">Wat we doen</a>
      <a class="knop knop-rand" href="/contact/">Contact</a>
    </p>
  </div>
</section>`)), "utf8");

/* sitemap + robots */
const nu = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(WEB, "sitemap.xml"),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${R.filter(r => !r.buitenSitemap).map(r => `  <url><loc>${SITE}/${r.pad ? r.pad + "/" : ""}</loc><lastmod>${nu}</lastmod><priority>${r.prio}</priority></url>`).join("\n")}
</urlset>\n`);
fs.writeFileSync(path.join(WEB, "robots.txt"),
`User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

/* data.js: dezelfde openingstijden en coordinaten die ook in de urentabel en de
   JSON-LD op de pagina's staan. Dit bestand werd tot nu toe met de hand
   bijgehouden en was daardoor scheefgegroeid: bij alle achttien vestigingen
   ontbrak de maandag, en bij Eindhoven en Utrecht nog drie dagen meer. De
   postcodezoeker meldde op maandag dus overal "Vandaag gesloten" boven een tabel
   die 08:00 - 18:00 zei. Door het hier uit site.json te schrijven kan dat niet
   meer uit elkaar lopen. */
/* live.js: hetzelfde bestand voor elke bouw, met het adres van de
   serverfunctie erin gebakken. Dat adres staat in vestigingen.json onder
   "bron" -- dus dezelfde plek waar deze bouw zijn gegevens vandaan haalde, en
   niet nog een keer los opgeschreven. */
{
  const bron = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(HIER, "vestigingen.json"), "utf8")).bron;
    } catch (e) { return null; }
  })();

  if (!bron) {
    console.warn("live.js: geen bron in vestigingen.json -- de site wordt niet live.");
    console.warn("  Verversen met:  node vestigingen.cjs");
  }

  fs.writeFileSync(path.join(WEB, "assets", "live.js"),
    (bron ? `window.LIVE_BRON=${JSON.stringify(bron)};\n` : "")
    + fs.readFileSync(path.join(HIER, "live.js"), "utf8"));
}

fs.writeFileSync(path.join(WEB, "assets", "data.js"),
  "window.SITE_DATA=" + JSON.stringify({
    /* Dezelfde velden die live.js hierna ter plekke overschrijft. Wijkt dit
       rijtje af, dan verandert de postcodezoeker van vorm zodra het ophalen
       lukt -- en dat is een fout die alleen optreedt als alles het doet. */
    locaties: DATA.locaties.map(l => ({
      slug: l.slug, plaats: l.plaats, straat: l.straat, postcode: l.postcode,
      telefoon: l.telefoon, email: l.email,
      lat: l.lat, lng: l.lng, uren: l.uren,
    })),
  }) + ";\n");

/* favicon */
fs.writeFileSync(path.join(WEB, "assets", "favicon.svg"),
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#11255d"/><rect x="12" y="26" width="26" height="16" rx="2" fill="#fff"/><rect x="38" y="30" width="14" height="12" rx="2" fill="#ffb400"/><circle cx="20" cy="46" r="5" fill="#0a1220"/><circle cx="45" cy="46" r="5" fill="#0a1220"/><rect x="12" y="18" width="40" height="5" rx="2" fill="#ffb400"/></svg>\n`);

console.log(`${n} pagina's geschreven in web/`);
console.log("  " + R.slice(0, 9).map(r => "/" + r.pad).join("  "));
console.log(`  + ${DATA.locaties.length} locaties, ${DATA.diensten.length} diensten, ${DATA.vacatures.length} vacatures`);
