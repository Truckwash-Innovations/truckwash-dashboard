/* Toestemming -- wat de bezoeker zelf mag beslissen.
 *
 * Waarom dit bestand bestaat
 * --------------------------
 *
 * Deze site is openbaar. Wie hier komt is geen medewerker met een
 * arbeidsovereenkomst maar een chauffeur, een planner of iemand die een
 * vacature zoekt, en die heeft niets getekend. Dan gelden de gewone regels:
 * je mag niets op zijn apparaat zetten en niets over hem wegsturen zonder dat
 * hij daar ja tegen heeft gezegd -- tenzij het echt nodig is om de pagina te
 * laten werken.
 *
 * Wat hier NIET in staat, en waarom dat het belangrijkste is
 * ----------------------------------------------------------
 *
 * Er zijn geen statistieken, geen advertentiepixels en geen cookies. Nul. Dit
 * bestand kan daardoor klein blijven: het hoeft geen scripts tegen te houden
 * die er niet zijn.
 *
 * De twee dingen die er wel waren -- de lettertypen bij Google en Three.js bij
 * cdnjs -- zijn niet met toestemming opgelost maar weggehaald. Ze staan nu op
 * onze eigen server (zie bouw/lettertypen.cjs en bouw/threejs.cjs). Dat is de
 * juiste volgorde: eerst zorgen dat er niets te vragen valt, en pas vragen over
 * wat overblijft. Een banner die toestemming vraagt voor een lettertype is een
 * banner die het probleem verplaatst naar de bezoeker.
 *
 * Wat overblijft is Trucky, en dat is een echte keuze: wat je hem typt gaat
 * naar onze server en van daar naar Claude om er een antwoord van te maken.
 * Dat is niet nodig om deze site te lezen. Dus staat hij uit tot je hem
 * aanzet, en wordt zijn script niet eens opgehaald zolang dat niet gebeurd is.
 *
 * Weigeren moet net zo makkelijk zijn als toestaan
 * -----------------------------------------------
 *
 * Twee knoppen naast elkaar, even groot, even opvallend, allebei één klik.
 * Geen vooraf aangevinkte schakelaars, geen "later" die eigenlijk ja betekent,
 * en geen muur voor de inhoud: wie de balk negeert leest de site gewoon, en er
 * gebeurt dan niets extra's. Dat laatste is het punt waar de meeste banners op
 * omvallen -- ze wachten niet af, ze beginnen alvast.
 */
(function () {
  "use strict";

  /* Gaat omhoog als de keuze niet meer dekt wat er gebeurt -- bijvoorbeeld
     als er een soort bij komt. Een oude keuze telt dan niet meer en de vraag
     komt opnieuw. Stilzwijgend een nieuwe verwerking onder een oud vinkje
     schuiven is precies wat niet mag. */
  var VERSIE = 1;
  var SLEUTEL = "tw-toestemming";

  var SOORTEN = [
    {
      id: "noodzakelijk",
      naam: "Noodzakelijk",
      vast: true,
      uitleg: "Het onthouden van deze keuze, en verder niets. Geen cookies, " +
              "geen statistieken, niets dat je over de site heen volgt.",
    },
    {
      id: "trucky",
      naam: "Trucky, de assistent",
      vast: false,
      uitleg: "De chatknop rechtsonder. Wat je hem vraagt gaat naar onze " +
              "server en naar Claude (Anthropic) om er een antwoord van te " +
              "maken. Staat uit tot je hem aanzet.",
    },
  ];

  /* ---------------- opslag ----------------
     In een privévenster gooit localStorage. Dan onthouden we de keuze alleen
     zolang de pagina open staat: de vraag komt volgende keer terug, en dat is
     beter dan een keuze die we niet kunnen bewaren stilletjes als ja tellen. */
  var inGeheugen = null;

  function lees() {
    if (inGeheugen) return inGeheugen;
    try {
      var o = JSON.parse(localStorage.getItem(SLEUTEL) || "null");
      if (o && o.v === VERSIE && o.keuze) return o;
    } catch (e) {}
    return null;
  }

  function schrijf(keuze) {
    var o = { v: VERSIE, keuze: keuze, op: new Date().toISOString() };
    inGeheugen = o;
    try { localStorage.setItem(SLEUTEL, JSON.stringify(o)); } catch (e) {}
    return o;
  }

  function mag(id) {
    if (id === "noodzakelijk") return true;
    var o = lees();
    return !!(o && o.keuze[id]);
  }

  /* ---------------- Trucky aan en uit ----------------
     Aanzetten haalt het script op; uitzetten haalt zijn vensters weg en wist
     wat hij had onthouden. Het script zelf blijft in het geheugen van de
     browser staan -- dat kan niet anders -- maar zonder zijn knoppen doet het
     niets meer, en bij de volgende pagina wordt het niet meer opgehaald. */
  var truckyGeladen = false;

  function truckyAan() {
    if (truckyGeladen) return;
    truckyGeladen = true;
    var s = document.createElement("script");
    s.src = "/assets/trucky.js";
    s.defer = true;
    document.body.appendChild(s);
  }

  function truckyUit() {
    /* :not(.trucky-uit), want de stub hieronder draagt dezelfde klasse voor
       zijn plaatsing rechtsonder. Zonder die uitzondering haalt deze regel de
       stub weg die stubAan() er meteen daarna weer neerzet. */
    var el = document.querySelector(".trucky:not(.trucky-uit)");
    if (el) el.remove();
    try {
      sessionStorage.removeItem("trucky-gesprek");
      sessionStorage.removeItem("trucky-uitnodiging");
    } catch (e) {}
    truckyGeladen = false;
  }

  /* De knop die er staat zolang Trucky uit is. Zonder deze knop is Trucky
     onvindbaar voor iedereen die één keer op "alleen noodzakelijk" heeft
     gedrukt, en dan is de keuze in de praktijk onomkeerbaar. Hij ziet er
     bewust anders uit dan Trucky zelf: dit is de uitnodiging, niet de
     assistent. */
  function stubAan() {
    if (document.querySelector(".trucky-uit")) return;
    var d = document.createElement("div");
    d.className = "trucky trucky-uit";
    d.innerHTML =
      '<button class="trucky-knop" type="button" ' +
        'aria-label="Trucky aanzetten, de assistent van Truckwash 1">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<path fill="currentColor" d="M12 3c5 0 9 3.1 9 7s-4 7-9 7c-.9 0-1.8-.1-2.6-.3L5 19l.9-3.3C4.1 14.4 3 12.3 3 10c0-3.9 4-7 9-7z"/>' +
        "</svg>" +
      "</button>";
    d.querySelector("button").addEventListener("click", function () {
      paneel("trucky");
    });
    document.body.appendChild(d);
  }

  function stubUit() {
    var el = document.querySelector(".trucky-uit");
    if (el) el.remove();
  }

  /* ---------------- toepassen ---------------- */
  function pas() {
    if (mag("trucky")) { stubUit(); truckyAan(); }
    else {
      truckyUit();
      /* Niet zolang de balk er staat: die dekt de rechteronderhoek af, en de
         vraag staat er dan toch al. */
      if (balk) stubUit(); else stubAan();
    }

    /* Zodat andere scripts kunnen meeluisteren zonder dit bestand te kennen. */
    try {
      window.dispatchEvent(new CustomEvent("toestemming", { detail: lees() }));
    } catch (e) {}

    tekenKeuzes();
  }

  function bewaar(keuze) {
    schrijf(keuze);
    balkWeg();
    paneelWeg();
    pas();
  }

  /* ---------------- de balk ---------------- */
  var balk = null;

  function balkAan() {
    if (balk) return;
    balk = document.createElement("div");
    balk.className = "toestemming-balk";
    balk.setAttribute("role", "region");
    balk.setAttribute("aria-label", "Keuze over Trucky");
    balk.innerHTML =
      '<div class="toestemming-binnen">' +
        "<div class=\"toestemming-tekst\">" +
          "<strong>Deze site zet geen cookies en telt je niet mee.</strong> " +
          "Er is één ding dat je zelf mag kiezen: Trucky, de assistent " +
          "rechtsonder. Wat je hem vraagt gaat naar onze server en naar Claude " +
          "om er een antwoord van te maken. " +
          '<a href="/cookies/">Wat er precies wordt opgeslagen</a>.' +
        "</div>" +
        '<div class="toestemming-knoppen">' +
          '<button type="button" class="knop knop-rand" data-keus="nee">Alleen noodzakelijk</button>' +
          '<button type="button" class="knop knop-geel" data-keus="ja">Trucky aanzetten</button>' +
        "</div>" +
      "</div>";

    balk.querySelector('[data-keus="nee"]').addEventListener("click", function () {
      bewaar({ trucky: false });
    });
    balk.querySelector('[data-keus="ja"]').addEventListener("click", function () {
      bewaar({ trucky: true });
    });

    document.body.appendChild(balk);
  }

  function balkWeg() {
    if (balk) { balk.remove(); balk = null; }
  }

  /* ---------------- het paneel met de schakelaars ---------------- */
  var venster = null;
  var kwamVan = null;

  function paneel(nadruk) {
    if (venster) return;
    kwamVan = document.activeElement;
    var nu = lees();

    venster = document.createElement("div");
    venster.className = "toestemming-laag";
    venster.innerHTML =
      '<div class="toestemming-venster" role="dialog" aria-modal="true" ' +
           'aria-labelledby="toestemming-titel">' +
        '<h2 id="toestemming-titel">Wat mag deze site?</h2>' +
        '<p class="toestemming-inleiding">Er staan geen cookies op deze site en ' +
          "er wordt niet bijgehouden wat je bekijkt. Alleen dit valt te kiezen.</p>" +
        '<div class="toestemming-lijst">' +
          SOORTEN.map(function (s) {
            var aan = s.vast || (nu ? !!nu.keuze[s.id] : false);
            return '<label class="toestemming-regel' +
                     (nadruk === s.id ? " toestemming-nadruk" : "") + '">' +
              '<input type="checkbox" data-soort="' + s.id + '"' +
                (aan ? " checked" : "") + (s.vast ? " disabled" : "") + ">" +
              "<span><strong>" + s.naam + (s.vast ? " (altijd aan)" : "") +
                "</strong><span>" + s.uitleg + "</span></span>" +
            "</label>";
          }).join("") +
        "</div>" +
        '<p class="toestemming-inleiding">Statistieken en advertenties staan er ' +
          "niet in, want ze worden niet gebruikt. Komt daar ooit iets bij, dan " +
          "verschijnt hier een schakelaar en wordt het opnieuw gevraagd &mdash; " +
          "een bestaande keuze telt daar niet voor. " +
          '<a href="/privacy/">Privacyverklaring</a>.</p>' +
        '<div class="toestemming-knoppen">' +
          '<button type="button" class="knop knop-rand" data-keus="nee">Alles uit</button>' +
          '<button type="button" class="knop knop-geel" data-keus="bewaar">Bewaren</button>' +
        "</div>" +
      "</div>";

    venster.addEventListener("click", function (e) {
      if (e.target === venster) paneelWeg();
    });
    venster.querySelector('[data-keus="nee"]').addEventListener("click", function () {
      bewaar({ trucky: false });
    });
    venster.querySelector('[data-keus="bewaar"]').addEventListener("click", function () {
      var keuze = {};
      SOORTEN.forEach(function (s) {
        if (s.vast) return;
        var v = venster.querySelector('[data-soort="' + s.id + '"]');
        keuze[s.id] = !!(v && v.checked);
      });
      bewaar(keuze);
    });

    document.body.appendChild(venster);

    var eerste = venster.querySelector("input:not([disabled])") ||
                 venster.querySelector("button");
    if (eerste) eerste.focus();
  }

  function paneelWeg() {
    if (!venster) return;
    venster.remove();
    venster = null;
    if (kwamVan && kwamVan.focus) kwamVan.focus();
    kwamVan = null;
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && venster) paneelWeg();
  });

  /* ---------------- de schakelaars op /cookies/ ----------------
     De verklaring is ook de plek waar je je bedenkt. Een pagina die uitlegt
     wat er gebeurt maar je ervoor terugstuurt naar een balk die er niet meer
     is, maakt intrekken moeilijker dan toestaan. */
  function tekenKeuzes() {
    var vak = document.getElementById("toestemming-keuzes");
    if (!vak) return;
    var nu = lees();

    vak.innerHTML =
      '<div class="toestemming-lijst">' +
        SOORTEN.filter(function (s) { return !s.vast; }).map(function (s) {
          return '<label class="toestemming-regel">' +
            '<input type="checkbox" data-hier="' + s.id + '"' +
              (nu && nu.keuze[s.id] ? " checked" : "") + ">" +
            "<span><strong>" + s.naam + "</strong><span>" + s.uitleg + "</span></span>" +
          "</label>";
        }).join("") +
      "</div>" +
      '<p class="toestemming-stand">' +
        (nu
          ? "Je keuze is opgeslagen op " +
            new Date(nu.op).toLocaleDateString("nl-NL", {
              day: "numeric", month: "long", year: "numeric",
            }) + "."
          : "Je hebt nog niets gekozen; alles wat te kiezen valt staat uit.") +
      "</p>";

    vak.querySelectorAll("[data-hier]").forEach(function (v) {
      v.addEventListener("change", function () {
        var keuze = {};
        SOORTEN.forEach(function (s) {
          if (s.vast) return;
          var el = vak.querySelector('[data-hier="' + s.id + '"]');
          keuze[s.id] = !!(el && el.checked);
        });
        schrijf(keuze);
        balkWeg();
        pas();
      });
    });
  }

  /* ---------------- naar buiten ---------------- */
  window.Toestemming = {
    mag: mag,
    open: function () { paneel(); },
    zet: function (id, aan) {
      var nu = lees();
      var keuze = nu ? JSON.parse(JSON.stringify(nu.keuze)) : {};
      keuze[id] = !!aan;
      bewaar(keuze);
    },
  };

  /* Elke knop of link met data-toestemming opent het paneel. Zo hoeft de
     voettekst dit bestand niet te kennen. */
  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-toestemming]");
    if (!el) return;
    e.preventDefault();
    paneel();
  });

  /* ---------------- starten ---------------- */
  function start() {
    if (!lees()) balkAan();
    pas();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
