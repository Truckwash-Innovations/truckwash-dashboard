/* Haalt de vestigingen en het aantal medewerkers op bij de edge function
   website-gegevens en legt er een klein bestand van neer: bouw/vestigingen.json.
   webbouw.cjs leest dat en bouwt er de achttien vestigingspagina's, de
   voettekst, de routes, de JSON-LD en assets/data.js uit.

   Waarom een LOS script en niet in webbouw.cjs: de sitebouw mag nooit van het
   netwerk afhangen. Zonder bereik hoort de site gewoon te bouwen met de
   gegevens die er al liggen. Dit script faalt daarom zacht, net als
   releases.cjs: gaat er iets mis, dan blijft vestigingen.json staan zoals hij
   is en is de afloop nog steeds 0.

   Waarom een edge function en niet rechtstreeks de database: public.
   website_vestigingen() en public.website_aantal_medewerkers() zijn security
   definer en mogen alleen door service_role worden aangeroepen (0033/0034, en
   scripts/sqltest.mjs in het dashboard faalt zodra dat terugkomt). De
   servicesleutel hoort niet in een sitebouw en staat ook niet op deze laptop.
   De functie draagt hem in haar eigen omgeving; wat er naar buiten mag staat
   vast in de SQL en nergens anders.

   WAT ER RAUW IN HET BESTAND KOMT. De databasenamen blijven staan: adres,
   telefoon, lon, punten. De vertaling naar de vorm die de site leest gebeurt in
   omzet.cjs, bij het bouwen. Dat is met opzet: gaat er straks iets mis, dan is
   aan dit bestand te zien of het ophalen of de vertaling de schuldige is. Er
   staat dus ook meer in dan de site gebruikt (wasstraten, bijzonder, de kolom
   diensten met paginasleutels) -- weglaten zou het antwoord van de functie
   stilzwijgend halveren.

   WAT DIT SCRIPT WEIGERT. Het schrijft niets weg als ook maar een van de rijen
   de controle van omzet.cjs niet doorstaat. Dat is geen overdreven
   voorzichtigheid: schrijft het een halve rij weg, dan valt webbouw.cjs bij
   elke bouw daarna terug op site.json en zijn ook de wijzigingen in de zeventien
   goede vestigingen stil weg. Nu blijft de laatste volledige momentopname
   staan en verandert er alleen niets.

   Draaien:   node vestigingen.cjs        (vanuit bouw/)
   Instellen: VESTIGINGEN_URL=https://.../functions/v1/website-gegevens
              SUPABASE_ANON_KEY=...
              DASHBOARD=../pad/naar/dashboard   (om beide daaruit te lezen) */
const fs = require("fs");
const path = require("path");
const { locaties, overlays } = require("./omzet.cjs");

const HIER = __dirname;
const UITBESTAND = path.join(HIER, "vestigingen.json");
const DASHBOARD = process.env.DASHBOARD || path.join(HIER, "..", "..", "dashboard");
const PROJECT = "yxsbmhavnttswxczeovt";
const WACHT = 20000;

function stop(reden) {
  console.warn("vestigingen.cjs: " + reden);
  console.warn("  vestigingen.json blijft zoals hij is; de site bouwt gewoon door.");
  process.exit(0);
}

/* Adres en sleutel komen bij voorkeur uit de omgeving. Staat er niets, dan uit
   dashboard/.env hiernaast -- dezelfde map die releases.cjs al voor de
   commit-koppen leest. Pas als ook dat niets oplevert valt hij terug op het
   projectnummer hieronder. De anon-sleutel is publiek (hij staat in de app en
   op de website), maar hij wordt hier nooit afgedrukt. */
function uitDotEnv(naam) {
  try {
    const tekst = fs.readFileSync(path.join(DASHBOARD, ".env"), "utf8");
    for (const regel of tekst.split(/\r?\n/)) {
      const m = regel.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && m[1] === naam) return m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch (e) { /* geen .env: geen ramp, zie hieronder */ }
  return "";
}

const BASIS = (process.env.SUPABASE_URL || uitDotEnv("VITE_SUPABASE_URL") ||
  `https://${PROJECT}.supabase.co`).replace(/\/+$/, "");
const URL = process.env.VESTIGINGEN_URL || `${BASIS}/functions/v1/website-gegevens`;
const SLEUTEL = process.env.SUPABASE_ANON_KEY || uitDotEnv("VITE_SUPABASE_ANON_KEY");

/* De functie staat in de open lijst (functions:open, met --no-verify-jwt) en
   heeft de sleutel dus niet nodig. Hij gaat toch mee: rolt iemand hem ooit met
   een kaal `supabase functions deploy` uit, dan staat de jwt-controle weer aan
   en zou dit script zonder deze twee kopregels een 401 krijgen en maandenlang
   zacht falen zonder dat iemand het merkt. */
const KOPPEN = { Accept: "application/json" };
if (SLEUTEL) {
  KOPPEN.apikey = SLEUTEL;
  KOPPEN.Authorization = "Bearer " + SLEUTEL;
}

(async () => {
  let antwoord;
  try {
    antwoord = await fetch(URL, { headers: KOPPEN, signal: AbortSignal.timeout(WACHT) });
  } catch (e) {
    stop(`geen verbinding met ${URL} (${e.message}).`);
  }
  if (antwoord.status === 401 || antwoord.status === 403) {
    stop(`de functie wees ons af met status ${antwoord.status}.` +
      "\n  Dat betekent bijna altijd dat verify_jwt aan staat. Uitrollen met:" +
      "\n  npm run functions:open   (in de dashboard-map, mét --no-verify-jwt)");
  }
  if (!antwoord.ok) stop(`website-gegevens antwoordde met status ${antwoord.status}.`);

  let body;
  try {
    body = await antwoord.json();
  } catch (e) {
    stop("het antwoord was geen leesbare JSON (" + e.message + ").");
  }
  if (!body || typeof body !== "object") stop("onverwacht antwoord van website-gegevens.");
  if (body.ok !== true) stop("de functie meldde een fout: " + (body.reden || "geen reden gegeven") + ".");
  if (!Array.isArray(body.vestigingen)) stop("er zat geen lijst vestigingen in het antwoord.");
  if (!body.vestigingen.length) {
    stop("de lijst vestigingen is leeg. Staat op_website nog ergens aan?");
  }

  /* Eerst omzetten, dan pas schrijven. Deze aanroep gooit bij een rij zonder
     telefoon, zonder coordinaten of zonder openingstijden, en dan schrijven we
     niets: liever de momentopname van gisteren dan een bestand waar webbouw.cjs
     elke bouw op terugvalt. De uitkomst zelf gooien we weg -- webbouw.cjs zet
     hem straks zelf om, uit dezelfde rauwe rijen. */
  let OUD;
  try {
    OUD = JSON.parse(fs.readFileSync(path.join(HIER, "site.json"), "utf8")).locaties || [];
  } catch (e) {
    stop("site.json is niet te lezen (" + e.message + ") -- zonder die lijst is" +
      " Eindhovens urentabel niet over te nemen.");
  }
  let uit;
  try {
    uit = locaties(body.vestigingen, OUD);
  } catch (e) {
    stop("de database gaf een rij die de site niet kan tonen: " + e.message +
      "\n  Vul dat veld aan in het beheerscherm en draai dit script opnieuw.");
  }

  /* Het aantal medewerkers is een los getal en niet de reden dat dit script
     bestaat. Klopt het niet, dan gaat de lijst gewoon door en valt alleen de
     zin op /werken-bij/ weg. */
  let medewerkers = null;
  if (Number.isInteger(body.medewerkers) && body.medewerkers >= 0) {
    medewerkers = body.medewerkers;
  } else {
    console.warn("vestigingen.cjs: geen bruikbaar aantal medewerkers in het antwoord" +
      " -- de zin op /werken-bij/ blijft weg.");
  }

  /* De vacatures komen met dezelfde aanroep mee. Geen tweede script en geen
     tweede verzoek: het is dezelfde functie, dezelfde momentopname, en twee
     bestanden die op verschillende momenten zijn opgehaald lopen vroeg of laat
     uit elkaar.

     Een lege lijst is hier goed -- nul vacatures betekent dat er niemand
     gezocht wordt. Ontbreekt de sleutel helemaal, dan is de functie ouder dan
     deze site en blijft wat er lag staan. */
  let vacatures = null;
  if (Array.isArray(body.vacatures)) {
    vacatures = body.vacatures;
  } else {
    console.warn("vestigingen.cjs: geen vacatures in het antwoord" +
      " -- draait er een oude versie van website-gegevens?");
    try {
      vacatures = JSON.parse(fs.readFileSync(UITBESTAND, "utf8")).vacatures || null;
    } catch (e) { /* er lag nog niets; dan valt webbouw.cjs terug op site.json */ }
  }

  fs.writeFileSync(UITBESTAND, JSON.stringify({
    opgehaald: new Date().toISOString(),
    bron: URL,
    medewerkers,
    vestigingen: body.vestigingen,
    vacatures,
  }, null, 1) + "\n", "utf8");

  console.log(`vestigingen.json: ${uit.length} vestigingen` +
    (medewerkers === null ? "" : `, ${medewerkers} medewerkers`));
  console.log("  " + uit.map(l => l.slug).join(" "));

  /* Alles wat de database niet kon leveren en wat dus uit site.json is
     overgenomen. Dit is geen fout, maar het bevriest: zolang het hier staat,
     verandert die cel niet meer mee met het beheerscherm. */
  const rest = overlays(uit, OUD);
  if (rest.length) {
    console.log("  uit site.json overgenomen (de database heeft er geen kolom voor):");
    for (const r of rest) console.log("    " + r);
  }
})();
