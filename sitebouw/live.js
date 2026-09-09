"use strict";

/* Truckwash 1 Group -- de pagina haalt zijn eigen gegevens op.
 *
 * Casper: "als ik iets aanpas, dan moet je het wel live op de website
 * aanpassen, geheel de json weg" en "zorg ervoor dat de website live wordt
 * aangepast als ik een locatie in de app ect bijmaak, ook vacatures ect".
 *
 * Wat er misging
 * --------------
 *
 * De site werd gebouwd uit bouw/vestigingen.json, een momentopname die
 * iemand met de hand moest verversen. Die stond zes dagen stil en had de
 * vacatures nog helemaal niet, want die kwamen pas met migratie 0068. Gevolg:
 * "Er werken 5 mensen" terwijl het er tien waren, en vier vacatures terwijl
 * er vijf openstonden. Niemand die het merkte, want de site deed het gewoon.
 *
 * Wat dit bestand doet
 * --------------------
 *
 * Bij het openen van elke pagina één keer website-gegevens ophalen en
 * bijwerken wat er sinds de bouw kan zijn veranderd: de vestigingenlijst, de
 * vacaturelijst, de tellingen, en op een locatiepagina de openingstijden, het
 * adres en het telefoonnummer.
 *
 * Waarom de HTML nog steeds vooraf wordt gebouwd
 * ---------------------------------------------
 *
 * Omdat Google leest wat er in de HTML staat en niet wacht op een fetch. Een
 * lege pagina die zichzelf invult is voor een bezoeker hetzelfde, maar voor
 * de vindbaarheid niet. Dus: de gebouwde pagina is compleet en klopt op het
 * moment van bouwen, en dit script haalt hem bij zodra iemand kijkt.
 *
 * En waarom data.js blijft staan
 * ------------------------------
 *
 * Niet als tweede waarheid. assets/data.js wordt bij elke bouw uit dezelfde
 * database geschreven en is dus een kopie, geen bron. Hij blijft omdat de
 * postcodezoeker meteen moet werken, ook bij een trage verbinding of als de
 * functie plat ligt -- en omdat een zoeker die niets vindt erger is dan een
 * zoeker met de stand van vorige week. Zodra dit script antwoord heeft, wordt
 * die lijst ter plekke overschreven.
 *
 * Stil falen is hier de bedoeling
 * ------------------------------
 *
 * Gaat er iets mis -- geen verbinding, de functie geeft een fout, het antwoord
 * klopt niet -- dan blijft de gebouwde pagina staan zoals hij is. Dat is de
 * juiste terugval: de bezoeker ziet dan gegevens van de laatste bouw in plaats
 * van een half scherm.
 */

(function () {
  var BRON = window.LIVE_BRON;
  if (!BRON || typeof fetch !== "function") return;

  /* Een pagina die in een tabblad blijft staan hoeft niet elke keer opnieuw te
     vragen. Vijf minuten is kort genoeg om een wijziging snel te zien en lang
     genoeg om niet bij elke klik te bellen. */
  var BEWAAR = "tw-live";
  var HOUDBAAR = 5 * 60 * 1000;

  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  /* ---------------------------------------------------------------- *
   *  Ophalen
   * ---------------------------------------------------------------- */

  function uitVoorraad() {
    try {
      var rauw = sessionStorage.getItem(BEWAAR);
      if (!rauw) return null;
      var pak = JSON.parse(rauw);
      if (!pak || Date.now() - pak.op > HOUDBAAR) return null;
      return pak.data;
    } catch (e) { return null; }
  }

  function bewaar(data) {
    try {
      sessionStorage.setItem(BEWAAR, JSON.stringify({ op: Date.now(), data: data }));
    } catch (e) { /* prive-venster of volle opslag; niet erg */ }
  }

  function haal() {
    var klaar = uitVoorraad();
    if (klaar) return Promise.resolve(klaar);

    return fetch(BRON, { headers: { Accept: "application/json" } })
      .then(function (a) { return a.ok ? a.json() : null; })
      .then(function (b) {
        if (!b || b.ok !== true || !Array.isArray(b.vestigingen) || !b.vestigingen.length) {
          return null;
        }
        bewaar(b);
        return b;
      })
      .catch(function () { return null; });
  }

  /* ---------------------------------------------------------------- *
   *  Van de vorm van de database naar de vorm van de site
   *
   *  webbouw.cjs doet dit bij het bouwen ook; die twee horen hetzelfde te
   *  zeggen. Wat hier staat is met opzet het minimum: alleen de velden die
   *  op de pagina te zien zijn.
   * ---------------------------------------------------------------- */

  var DAGEN = [
    ["ma", "Maandag"], ["di", "Dinsdag"], ["wo", "Woensdag"], ["do", "Donderdag"],
    ["vr", "Vrijdag"], ["za", "Zaterdag"], ["zo", "Zondag"],
  ];

  function urenVan(v) {
    var open = v.openingstijden || {};
    return DAGEN.map(function (d) {
      var t = open[d[0]];
      return {
        dag: d[1],
        tijd: t && t.van && t.tot ? t.van + " - " + t.tot : "Gesloten",
      };
    });
  }

  function locatiesVan(body) {
    return body.vestigingen.map(function (v) {
      return {
        slug: v.slug,
        plaats: v.plaats,
        straat: v.adres,
        postcode: v.postcode,
        telefoon: v.telefoon,
        email: v.email,
        lat: v.lat,
        lng: v.lon,
        uren: urenVan(v),
      };
    });
  }

  /* ---------------------------------------------------------------- *
   *  Bijwerken
   * ---------------------------------------------------------------- */

  /**
   * De lijst voor de postcodezoeker.
   *
   * Ter plekke, niet vervangen. app.js doet bovenaan `const DATA =
   * window.SITE_DATA` en houdt die verwijzing vast; een nieuw object
   * toewijzen aan window.SITE_DATA ziet hij dus nooit. De array leegmaken en
   * opnieuw vullen ziet hij wel.
   */
  function zetLocaties(locaties) {
    var d = window.SITE_DATA;
    if (!d || !Array.isArray(d.locaties)) {
      window.SITE_DATA = { locaties: locaties };
      return;
    }
    d.locaties.length = 0;
    for (var i = 0; i < locaties.length; i++) d.locaties.push(locaties[i]);
  }

  /** De rij vestigingen op /locaties/. */
  function zetVestigingenlijst(locaties) {
    var eerste = document.querySelector("a.locrij");
    if (!eerste || !eerste.parentNode) return;
    var houder = eerste.parentNode;

    var html = locaties.map(function (l, i) {
      var nr = (i + 1) < 10 ? "0" + (i + 1) : String(i + 1);
      return '<a class="locrij" href="/locaties/' + esc(l.slug) + '/" data-i="' + i + '">'
        + '<span class="nr">' + nr + "</span>"
        + '<span class="naam">' + esc(l.plaats) + "</span>"
        + '<span class="plek">' + esc(l.straat) + "</span>"
        + "</a>";
    }).join("");

    /* Alleen de rijen vervangen; wat er verder in de houder staat blijft. */
    var oud = houder.querySelectorAll("a.locrij");
    for (var i = 0; i < oud.length; i++) oud[i].parentNode.removeChild(oud[i]);
    houder.insertAdjacentHTML("beforeend", html);
  }

  /** De vacatures op /werken-bij/. */
  function zetVacatures(vacatures) {
    var eerste = document.querySelector(".vacrij");
    if (!eerste || !eerste.parentNode) return;
    var houder = eerste.parentNode;

    var html = vacatures.map(function (v) {
      var tekst = String(v.intro || v.omschrijving || "");
      if (tekst.length > 150) tekst = tekst.slice(0, 149) + "…";
      return '<div class="vacrij"><div class="vi">'
        + "<h3>" + esc(v.titel) + "</h3>"
        + "<p>" + esc(tekst) + "</p>"
        + "</div>"
        + '<a class="knop knop-navy knop-klein" href="/werken-bij/' + esc(v.slug)
        + '/">Bekijk vacature</a></div>';
    }).join("");

    var oud = houder.querySelectorAll(".vacrij");
    for (var i = 0; i < oud.length; i++) oud[i].parentNode.removeChild(oud[i]);
    houder.insertAdjacentHTML("beforeend", html);
  }

  /**
   * De tellingen in de lopende tekst.
   *
   * Alleen waar een element met data-live erop staat. Zoeken op tekst zou
   * betekenen dat een zin die toevallig een getal bevat ook wordt aangepast,
   * en dat is precies hoe je een prijs verandert terwijl je een aantal
   * bedoelde.
   */
  function zetTellingen(body) {
    var n = body.vestigingen.length;
    var m = body.medewerkers;

    var vest = document.querySelectorAll('[data-live="vestigingen"]');
    for (var i = 0; i < vest.length; i++) vest[i].textContent = String(n);

    if (typeof m === "number" && isFinite(m)) {
      var mw = document.querySelectorAll('[data-live="medewerkers"]');
      for (var j = 0; j < mw.length; j++) mw[j].textContent = String(m);
    }
  }

  /**
   * De locatiepagina zelf: openingstijden, adres en telefoon.
   *
   * De slug staat in het pad. Staat deze vestiging niet meer in het antwoord
   * (uitgezet in de app), dan laten we de pagina met rust -- hem leegmaken zou
   * betekenen dat een bezoeker op een lege pagina staat waar Google hem net
   * naartoe heeft gestuurd.
   */
  function zetLocatiepagina(locaties) {
    var m = location.pathname.match(/^\/locaties\/([^/]+)\/?$/);
    if (!m) return;
    var l = null;
    for (var i = 0; i < locaties.length; i++) {
      if (locaties[i].slug === m[1]) { l = locaties[i]; break; }
    }
    if (!l) return;

    var tabel = document.querySelector("table.uren");
    if (tabel) {
      var rijen = tabel.querySelectorAll("tr");
      for (var r = 0; r < rijen.length; r++) {
        var cellen = rijen[r].cells;
        if (!cellen || cellen.length < 2) continue;
        var dag = (cellen[0].textContent || "").trim();
        for (var u = 0; u < l.uren.length; u++) {
          if (l.uren[u].dag === dag) { cellen[1].textContent = l.uren[u].tijd; break; }
        }
      }
    }

    var adres = document.querySelectorAll('[data-live="adres"]');
    for (var a = 0; a < adres.length; a++) {
      adres[a].textContent = l.straat + ", " + l.postcode + " " + l.plaats;
    }

    if (l.telefoon) {
      var tel = document.querySelectorAll('[data-live="telefoon"]');
      for (var t = 0; t < tel.length; t++) {
        tel[t].textContent = l.telefoon;
        if (tel[t].tagName === "A") tel[t].setAttribute("href", "tel:" + l.telefoon);
      }
    }
  }

  /* ---------------------------------------------------------------- *
   *  Doen
   * ---------------------------------------------------------------- */

  function doe(body) {
    if (!body) return;
    var locaties = locatiesVan(body);

    /* Elk stuk apart, zodat een fout in het ene het andere niet meesleept. */
    var stappen = [
      function () { zetLocaties(locaties); },
      function () { zetVestigingenlijst(locaties); },
      function () { zetVacatures(Array.isArray(body.vacatures) ? body.vacatures : []); },
      function () { zetTellingen(body); },
      function () { zetLocatiepagina(locaties); },
    ];
    for (var i = 0; i < stappen.length; i++) {
      try { stappen[i](); } catch (e) { /* de gebouwde pagina blijft staan */ }
    }

    /* Voor wie erop wil wachten (de 3D-kaart bijvoorbeeld). */
    try {
      window.dispatchEvent(new CustomEvent("tw-live", { detail: body }));
    } catch (e) { /* oude browser */ }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { haal().then(doe); });
  } else {
    haal().then(doe);
  }
})();
