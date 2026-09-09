/* Zet een rij van public.website_vestigingen() om in een locatie zoals
   site.json hem kent. Meer doet dit bestand niet: geen netwerk, geen sleutels,
   geen bestanden. Daardoor is het los te lezen en los te testen, en staat de
   vertaaltabel op de plek waar iemand die webbouw.cjs leest hem tegenkomt.

   Waarom de vertaling hier hoort en niet in de edge function: de
   naamsverschillen zijn sitekennis. De database weet niet dat dit veld op de
   pagina "extra" heet. Zet je het daar, dan staat de valstrik hieronder in een
   andere repo, achter een uitrolcommando.

   DE VERTAALTABEL
     DATABASE          SITE.JSON      opmerking
     slug           -> slug
     naam           -> naam           'Truckwash Aalsmeer' -> 'Aalsmeer'. Niemand
                                      leest dit veld; het staat er alleen zodat
                                      het bestand veld voor veld tegen site.json
                                      te leggen is.
     adres          -> straat         andere naam
     postcode       -> postcode
     plaats         -> plaats         OOK de sorteersleutel, zie onderaan
     telefoon       -> tel            andere naam
     email          -> email
     lat            -> lat
     lon            -> lng            andere naam
     openingstijden -> uren           andere VORM, zie uren() hieronder
     intro          -> intro
     bereikbaar     -> extra          andere naam
     punten         -> diensten       DE VALSTRIK, zie hieronder
     diensten       -> gaat NIET mee  DE VALSTRIK
     wasstraten     -> gaat niet mee
     bijzonder      -> gaat niet mee
     fotos          -> fotos          andere VORM: [{url, alt}], omslag eerst,
                                      zie fotos() hieronder
     (geen kolom)   <- urenKoppen     blijft uit site.json komen
     (geen kolom)   <- urenVol        blijft uit site.json komen
     (geen kolom)   <- url, foto      vervallen; het oude enkelvoud `foto`
                                      wees naar wp-content van de oude site
                                      en is vervangen door de lijst `fotos`

   DE VALSTRIK. De site toont onder "Over deze vestiging" een opsomming van
   acht regels verkooptekst ("500 meter vanaf Flora Holland bloemenveiling").
   In site.json heet dat veld "diensten". In de database heet die tekst
   `punten`, en de kolom `diensten` bevat iets heel anders: sleutels naar
   dienstpagina's ('alcoa-velgen-reinigen'). Beide zijn text[], beide passen.
   Wissel je ze om, dan breekt er niets en meldt niemand iets -- er staat
   alleen op alle achttien pagina's een rijtje slugs met streepjes op de plek
   waar een chauffeur leest wat hij hier kan laten doen. */

/* De vaste zeven rijen, in de volgorde waarin de site ze toont. brok.js doet
   l.uren.map(...) zonder te kijken hoeveel er zijn, dus het moeten er altijd
   zeven zijn en altijd in deze volgorde. */
const DAGEN = [
  ["ma", "Maandag"], ["di", "Dinsdag"], ["wo", "Woensdag"], ["do", "Donderdag"],
  ["vr", "Vrijdag"], ["za", "Zaterdag"], ["zo", "Zondag"],
];

/* Velden waar de site op rekent. Ontbreekt er een, dan is dat geen reden om
   een lege regel te tonen maar om de hele rij te weigeren: brok.js doet
   l.tel.replace(...) zonder guard en laat de bouw dan omvallen met "Cannot
   read properties of null", zonder te zeggen welke vestiging het was. Liever
   hier een melding met de slug erbij. */
const MOETVOL = ["slug", "plaats", "adres", "postcode", "telefoon", "email"];

/* Regeleindes uit een tekst halen.

   Aanleiding: na de eerste bouw uit de database verschilden vier van de
   vijfenveertig pagina's van de nulmeting. De inhoud was gelijk; er stond een
   carriage return in de tekst -- onzichtbaar, en HTML vouwt witruimte toch
   samen, dus op de pagina zag je niets.

   Ze kwamen uit de migratie die de achttien vestigingen invoerde: die is op
   Windows geschreven en git zet .sql-bestanden daar om naar CRLF. In een
   tekst die over meerdere regels is samengesteld belandt dat teken binnen de
   waarde.

   De database is opgeruimd (migratie 0039), maar dat is de reparatie van één
   geval. Dit is de rem: wat er ook binnenkomt en waar het ook vandaan komt,
   er gaan geen regeleindes de HTML in. Zolang die er wel in kunnen, is elke
   vergelijking tussen site en database vals -- en een vergelijking die vals
   alarm geeft, ga je negeren. */
function schoon(tekst) {
  return String(tekst == null ? "" : tekst).replace(/\r/g, "");
}

function uren(openingstijden, oudeUren) {
  const oh = (openingstijden && typeof openingstijden === "object") ? openingstijden : {};
  const oud = new Map((oudeUren || []).map(u => [u.dag, u.tijd]));
  return DAGEN.map(([k, dag]) => {
    const v = oh[k];
    let tijd;
    if (v === null || v === undefined) {
      /* Twee verschillende dingen die in JSON allebei vals zijn:
           sleutel aanwezig, waarde null   = dicht         -> "Gesloten"
           sleutel ontbreekt               = niet ingevuld -> ""
         Het onderscheid is dus `k in oh` en niet de waarde. Op de pagina zie
         je het verschil niet (brok.js toont bij allebei "Gesloten"), maar
         assets/data.js schrijft de rauwe waarde weg. Zeventien vestigingen
         hebben "zo": null, Utrecht heeft helemaal geen "zo" -- en precies dat
         verschil staat vandaag zo in het gepubliceerde data.js. */
      tijd = (k in oh) ? "Gesloten" : "";
    } else if (v.van && v.tot) {
      tijd = `${v.van} - ${v.tot}`;
    } else {
      /* {"ma":{"van":"08:00"}} is geen gesloten maandag maar een halve invoer.
         Daar stil "Gesloten" van maken zet een vestiging dicht die open is. */
      throw new Error(`${dag}: halve openingstijd ${JSON.stringify(v)}`);
    }

    /* "Op afspraak" is geen tijd en past niet in de kolom opening_hours: die
       kent alleen een venster of null. Maasvlakte staat vandaag op zondag op
       "Op afspraak"; in de database is dat `zo: null` plus een losse zin in
       `bijzonder`. Dat gegeven kan de database dus niet leveren.

       Wat hier NIET gebeurt: die zin uitlezen. `bijzonder` is in het
       beheerscherm een vrij veld met als hulptekst "Wat hier anders is dan
       elders" -- niets zegt dat het over openingstijden gaat. Een regel die op
       het woord "afspraak" let, maakt van "Wij werken op afspraak voor
       tankreiniging; zondag dicht" een open zondag. Een dag openzetten op
       grond van een zin die daar niet over gaat is erger dan de dag missen.

       Wat er wel gebeurt: zegt de database dicht, en stond er in site.json op
       die dag geen tijd en geen "Gesloten" maar iets anders, dan blijft die
       oude tekst staan. Dezelfde overlay als urenKoppen/urenVol hieronder, met
       dezelfde prijs: hij bevriest. Stopt Maasvlakte met de zondagafspraken,
       dan blijft het er staan tot iemand site.json aanpast. vestigingen.cjs
       meldt daarom bij elke bouw welke cellen zo ontstaan.

       Dit eindigt pas echt als opening_hours een dagwaarde kan dragen die "op
       afspraak" zegt in plaats van null. Dat is een migratie plus een
       schermpje, en het hoort in de database en niet hier. */
    if (tijd === "Gesloten") {
      const o = oud.get(dag);
      if (o && o.trim() && !/gesloten/i.test(o) && !/\d/.test(o)) tijd = o;
    }
    return { dag, tijd };
  });
}

/* De foto's uit het beheerscherm, in de vorm die de pagina nodig heeft.

   De database geeft per foto {pad, bijschrift, cover, volgorde} en de edge
   function zet er een volledige `url` bij -- de site hoeft dus niet te weten
   waar de opslag staat. Wat de pagina wil is alleen een adres en een alt-
   tekst, en die twee staan hier.

   Omslag eerst. De database sorteert al zo, maar dat is een eigenschap van
   een functie in een andere repo; hier wordt hij nog een keer afgedwongen,
   want de eerste foto is de foto die groot op de pagina komt en dat hoort
   niet af te hangen van hoe een lijst toevallig is aangeleverd.

   Een foto zonder url wordt overgeslagen en niet geweigerd: een vestiging
   zonder foto's is geen fout (de pagina valt dan terug op de standaardfoto),
   dus een halve foto hoort ook geen bouw om te gooien.

   De alt-tekst: het bijschrift als dat er is, en anders "Truckwash 1 Venlo".
   Een lege alt is voor een schermlezer een plaatje zonder betekenis, en een
   zoekmachine weet dan niet dat dit de wasstraat in Venlo is. */
function fotos(lijst, plaats) {
  if (!Array.isArray(lijst)) return [];
  return lijst
    .filter(f => f && typeof f === "object" && typeof f.url === "string" && f.url.trim())
    .slice()
    .sort((a, b) =>
      (b.cover ? 1 : 0) - (a.cover ? 1 : 0) ||
      (Number(a.volgorde) || 0) - (Number(b.volgorde) || 0))
    .map(f => ({
      url: f.url.trim(),
      alt: schoon(f.bijschrift).trim() || `Truckwash 1 ${plaats}`,
    }));
}

function eenVestiging(v, oud) {
  const o = oud || {};
  if (!v || !v.slug) throw new Error("vestiging zonder slug");
  for (const veld of MOETVOL) {
    if (!v[veld] || !String(v[veld]).trim()) throw new Error(`${v.slug}: ${veld} is leeg`);
  }
  /* Zonder coordinaten staat de vestiging niet op de 3D-kaart en kan de
     postcodezoeker hem nooit als dichtstbijzijnde aanwijzen. Allebei gebeurt
     zonder foutmelding, dus ook dit is een weigering en geen waarschuwing. */
  if (typeof v.lat !== "number" || typeof v.lon !== "number" ||
      !isFinite(v.lat) || !isFinite(v.lon)) {
    throw new Error(`${v.slug}: lat/lon ontbreken of zijn geen getal`);
  }
  /* De kolom opening_hours heeft in de database standaard '{}' (0026:42). Zonder
     deze controle levert een vestiging die wel op de website is gezet maar
     waarvan de tijden nog niet zijn ingevuld, zeven keer "Gesloten" op de
     pagina en een lege openingHoursSpecification in de JSON-LD voor Google.
     Dat is geen ontbrekend gegeven meer, dat is een stellige onwaarheid. */
  const oh = v.openingstijden;
  if (!oh || typeof oh !== "object" || !DAGEN.some(([k]) => k in oh)) {
    throw new Error(`${v.slug}: openingstijden zijn leeg`);
  }

  let rijen;
  try {
    rijen = uren(oh, o.uren);
  } catch (e) {
    throw new Error(`${v.slug}: ${e.message}`);
  }

  return {
    slug: v.slug,
    /* In de database heet hij 'Truckwash Aalsmeer', op de site 'Aalsmeer'. */
    naam: String(v.naam || "").replace(/^Truckwash\s+/i, ""),
    lat: v.lat,
    lng: v.lon,
    tel: v.telefoon,
    email: v.email,
    straat: v.adres,
    postcode: v.postcode,
    plaats: v.plaats,
    uren: rijen,
    /* Eindhoven heeft als enige een tabel "Openingstijden per onderdeel" met
       drie kolommen (Shop / restaurant, Keuken, Wasstraat) en samengevoegde
       dagbereiken. De kolom opening_hours kan dat niet: die heeft een venster
       per dag en verder niets. Tot er een kolom voor is komen deze twee velden
       uit de oude site.json, op slug gezocht. Verandert Eindhovens slug in de
       app, dan verdwijnt die tabel -- vestigingen.cjs meldt dat. */
    urenKoppen: o.urenKoppen || [],
    urenVol: o.urenVol || [],
    /* schoon() haalt regeleindes uit de tekst. Zie de uitleg bij die functie. */
    intro: schoon(v.intro),
    extra: schoon(v.bereikbaar),
    /* Uit `punten`, niet uit `diensten`. Zie de valstrik bovenaan. */
    diensten: Array.isArray(v.punten) ? v.punten.map(schoon) : [],
    /* De echte foto's van deze vestiging, omslag eerst. Leeg als er in het
       beheerscherm nog geen zijn geupload; de pagina toont dan de
       standaardfoto, zoals hij altijd deed. */
    fotos: fotos(v.fotos, v.plaats),
    /* Wat hier bewust NIET staat:
         url         niemand leest het, en het staat bij hazeldonk en
                     doetinchem al op een adres dat de site niet bouwt --
                     precies wat er gebeurt met een veld dat niemand leest.
         foto        het oude enkelvoud uit site.json wees naar wp-content van
                     de oude site en niemand las het; de lijst `fotos`
                     hierboven vervangt het.
         wasstraten  de database geeft het (kolom bays), maar alle achttien
                     rijen staan op de standaardwaarde 2 en die is nooit
                     nagekeken. Utrecht staat in de app op 3 terwijl zijn eigen
                     introtekst 2 zegt. Een niet-nagekeken getal publiceren is
                     erger dan het weglaten.
         diensten    de kolom met paginasleutels. Zie de valstrik.
         bijzonder   staat vandaag nergens op de site. Wil je het tonen, dan is
                     dat een nieuw blok op de pagina en geen vertaling. */
  };
}

/* De database sorteert op naam (`order by l.name`, 0035:223), de site staat op
   plaats -- zo maakt bouw/extract.py hem ook: sorted(..., key=d["plaats"]).
   Dat is geen detail. "Truckwash Hazeldonk" staat in Breda, dus op naam staat
   hij negende en op plaats vijfde. Sorteren op naam verandert daarmee de
   voettekst op elke pagina, de nummering 01..18 op /locaties/, de volgorde in
   sitemap.xml en assets/data.js, en -- het stilst -- de eerste zes vestigingen
   in de JSON-LD van elke vacature (webbouw.cjs doet daar slice(0, 6)), waar
   Breda dan wordt vervangen door Ede. Elk veld klopt en toch is de hele site
   anders.

   Slug als tweede sleutel, zodat twee vestigingen in dezelfde plaats niet van
   de volgorde van de database afhangen. */
function locaties(rijen, oudeLijst) {
  if (!Array.isArray(rijen) || !rijen.length) throw new Error("lege lijst vestigingen");
  const oud = new Map((oudeLijst || []).map(l => [l.slug, l]));
  const uit = rijen.map(v => eenVestiging(v, oud.get(v.slug)));
  const gezien = new Set();
  for (const l of uit) {
    if (gezien.has(l.slug)) throw new Error(`slug ${l.slug} komt twee keer voor`);
    gezien.add(l.slug);
  }
  return uit.sort((a, b) =>
    a.plaats < b.plaats ? -1 : a.plaats > b.plaats ? 1 :
    a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}

/* Wat er aan een omgezette lijst opvalt zonder dat het fout is: cellen die uit
   de oude site.json komen in plaats van uit de database. Die wil je bij elke
   bouw een keer zien, anders bevriezen ze ongemerkt. */
function overlays(nieuw, oudeLijst) {
  const oud = new Map((oudeLijst || []).map(l => [l.slug, l]));
  const uit = [];
  for (const l of nieuw) {
    const o = oud.get(l.slug) || {};
    for (const u of l.uren) {
      if (!u.tijd || /\d/.test(u.tijd) || /gesloten/i.test(u.tijd)) continue;
      uit.push(`${l.slug} ${u.dag} "${u.tijd}" komt uit site.json, niet uit de database`);
    }
    if (l.urenVol.length) {
      uit.push(`${l.slug} tabel "Openingstijden per onderdeel" komt uit site.json`);
    }
  }
  /* Een vestiging die in site.json staat en die de database niet meer noemt is
     geen fout -- hij kan uitgezet zijn -- maar zijn overlay is dan wel weg. */
  for (const [slug, o] of oud) {
    if (!nieuw.some(l => l.slug === slug) && (o.urenVol || []).length) {
      uit.push(`${slug} had een tabel "Openingstijden per onderdeel" en staat niet meer in de database`);
    }
  }
  return uit;
}

module.exports = { locaties, uren, eenVestiging, fotos, overlays, DAGEN };
