/*
 * DE VERSIESCHAKELAAR VAN DE VOORPAGINA (docs/site-redesign-clean-epic.md, deel A0).
 * ADR: docs/adr/0011-twee-voorpaginas-gekozen-door-de-config-en-een-router-in-de-head.md
 *
 * buckybot.app heeft twee voorpagina's naast elkaar: v1 (index.html, de huidige)
 * en v2 (v2/index.html, "Clean & Epic"). Welke het publiek krijgt, zet de
 * eigenaar met `+ownerconfig` in site_features.json (`homepage.version`); de
 * backend geeft die stand mee in /api/site/features. Omzetten is dus geen deploy.
 *
 * DIT IS DE SCHAKELAAR EN GEEN VAN BEIDE VERSIES. Beide pagina's laden dit ene
 * bestand, met hun eigen naam erbij (`data-page`). Verder delen ze niets: geen
 * CSS, geen JS, geen tokens. Een wijziging aan v2 raakt v1 dus nooit.
 *
 * WAAROM EEN GEWOON SCRIPT IN DE <head> EN GEEN MODULE
 * Een module wacht tot de pagina geparset is; dan heeft de browser v1 al
 * getekend en springt hij daarna naar v2. Dit script blokkeert de parser heel
 * even en beslist VOOR de eerste paint. Inline kan niet: de CSP staat alleen
 * scripts uit eigen bestanden toe (bucky1.0/tests/test_site_csp.py).
 *
 * DE VOLGORDE VAN BESLISSEN
 *   1. `?site=v1` of `?site=v2` in de adresbalk: een preview, alleen voor dit
 *      tabblad (sessionStorage). Het publiek merkt er niets van. `?site=live`
 *      haalt de preview weer weg.
 *   2. De keuze uit de browser (localStorage), als die jonger is dan tien
 *      minuten: meteen, zonder verzoek.
 *   3. Een oudere keuze: meteen gebruiken, en op de achtergrond verversen voor
 *      het volgende bezoek. Een terugkerende bezoeker wacht dus nooit; een
 *      omschakeling bereikt hem een bezoek later.
 *   4. Geen keuze bekend (eerste bezoek): de pagina blijft heel kort leeg (de
 *      eigen achtergrond, geen inhoud) tot de backend antwoordt, hooguit
 *      WACHT_MS. Geen antwoord, een fout of een onzinwaarde: v1.
 *
 * GEEN FLITS: de verkeerde versie wordt nooit getekend. Moet er gewisseld
 * worden, dan blijft deze pagina onzichtbaar tot de andere er staat.
 */
(function () {
    "use strict";

    // Gelijk aan API_URL in js/config.js; site/tests/test_site_versie.py
    // houdt de twee gelijk. Dit script kan geen module importeren (zie boven).
    var API_URL = "https://api.buckybot.app";

    var VERSIES = ["v1", "v2"];
    var STANDAARD = "v1";
    var CACHE_SLEUTEL = "bucky.site.version";
    var PREVIEW_SLEUTEL = "bucky.site.preview";
    var SPRONG_SLEUTEL = "bucky.site.hop";
    var VERS_MS = 10 * 60 * 1000;   // zo lang telt een opgeslagen keuze als vers
    var WACHT_MS = 1200;            // langer wacht een eerste bezoek niet op de backend
    var VANGNET_MS = 2500;          // nooit langer dan dit een lege pagina
    var LUS_MS = 2000;              // twee sprongen heen en terug binnen dit venster = een lus

    function geldig(v) {
        return VERSIES.indexOf(v) !== -1 ? v : null;
    }

    // Opslag kan gooien (privévenster, geblokkeerde sitedata): dan geen cache,
    // wel een pagina.
    function lees(soort, sleutel) {
        try { return window[soort].getItem(sleutel); } catch (e) { return null; }
    }

    function schrijf(soort, sleutel, waarde) {
        try {
            if (waarde === null) window[soort].removeItem(sleutel);
            else window[soort].setItem(sleutel, waarde);
        } catch (e) { /* geen opslag: dan vraagt het volgende bezoek het opnieuw */ }
    }

    function leesCache() {
        var rauw = lees("localStorage", CACHE_SLEUTEL);
        if (!rauw) return null;
        var c;
        try { c = JSON.parse(rauw); } catch (e) { return null; }
        if (!c || !geldig(c.v) || typeof c.at !== "number") return null;
        return c;
    }

    /**
     * Het besluit, zonder bijwerkingen, zodat het los te testen is.
     *   invoer: { query, preview, cache, nu }
     *   uit:    { versie, bron, ophalen: "nee" | "achtergrond" | "wachten",
     *             preview: undefined (laten) | "" (wissen) | "v1"/"v2" (zetten) }
     */
    function kies(invoer) {
        var query = typeof invoer.query === "string" ? invoer.query.toLowerCase() : null;
        var nieuwePreview;
        if (geldig(query)) nieuwePreview = query;
        else if (query === "live") nieuwePreview = "";

        var preview = nieuwePreview !== undefined ? nieuwePreview : invoer.preview;
        if (geldig(preview)) {
            return { versie: preview, bron: "preview", ophalen: "nee", preview: nieuwePreview };
        }
        var c = invoer.cache;
        if (c && geldig(c.v)) {
            var leeftijd = invoer.nu - c.at;
            var vers = leeftijd >= 0 && leeftijd < VERS_MS;
            return { versie: c.v, bron: "cache", ophalen: vers ? "nee" : "achtergrond",
                     preview: nieuwePreview };
        }
        return { versie: null, bron: "geen", ophalen: "wachten", preview: nieuwePreview };
    }

    /** Vraagt de stand op. Geeft "v1"/"v2", of gooit bij een netwerk- of HTTP-fout. */
    function haal() {
        // `?switch=1` doet niets aan het antwoord; het maakt dit verzoek
        // herkenbaar naast dat van js/features.js (in de tests en in een log).
        return fetch(API_URL + "/api/site/features?switch=1", { credentials: "omit" })
            .then(function (res) {
                if (!res.ok) throw new Error("HTTP " + res.status);
                return res.json();
            })
            .then(function (body) {
                // Een backend zonder dit veld (van voor deze ronde) of met een
                // onzinwaarde betekent v1: dat is wat de eigenaar dan ook ziet.
                var v = geldig(body && body.homepage && body.homepage.version) || STANDAARD;
                schrijf("localStorage", CACHE_SLEUTEL, JSON.stringify({ v: v, at: Date.now() }));
                return v;
            });
    }

    var script = document.currentScript;
    var pagina = geldig(script && script.getAttribute("data-page")) || STANDAARD;
    var adressen = {
        v1: (script && script.getAttribute("data-v1")) || "./",
        v2: (script && script.getAttribute("data-v2")) || "v2/"
    };
    var root = document.documentElement;
    var vangnet = null;

    // Via de CSSOM en niet met een style-attribuut of een <style>: die blokkeert
    // de CSP, een eigenschap op `element.style` niet.
    function verberg() {
        root.style.visibility = "hidden";
        if (vangnet === null) vangnet = setTimeout(toon, VANGNET_MS);
    }

    function toon() {
        if (vangnet !== null) { clearTimeout(vangnet); vangnet = null; }
        root.style.visibility = "";
    }

    function ga(versie) {
        if (versie === pagina) { toon(); return; }
        // LUSBEVEILIGING. Kwamen we hier net met een sprong NAARTOE en willen we
        // meteen weer weg, dan zijn de twee pagina's het oneens (opslag die niet
        // werkt plus een backend die omzet). Dan blijven we staan.
        var sprong = null;
        try { sprong = JSON.parse(lees("sessionStorage", SPRONG_SLEUTEL) || "null"); } catch (e) { sprong = null; }
        if (sprong && sprong.naar === pagina && Date.now() - sprong.at < LUS_MS) { toon(); return; }
        schrijf("sessionStorage", SPRONG_SLEUTEL, JSON.stringify({ naar: versie, at: Date.now() }));

        var doel = new URL(adressen[versie], window.location.href);
        doel.search = window.location.search;
        doel.hash = window.location.hash;
        // Onzichtbaar blijven tot de andere versie er staat: geen vangnet meer,
        // want dat zou juist de verkeerde versie laten zien.
        if (vangnet !== null) { clearTimeout(vangnet); vangnet = null; }
        root.style.visibility = "hidden";
        window.location.replace(doel.href);
    }

    var besluit;
    try {
        var params = new URLSearchParams(window.location.search);
        besluit = kies({
            query: params.get("site"),
            preview: lees("sessionStorage", PREVIEW_SLEUTEL),
            cache: leesCache(),
            nu: Date.now()
        });
        if (besluit.preview !== undefined) {
            schrijf("sessionStorage", PREVIEW_SLEUTEL, besluit.preview === "" ? null : besluit.preview);
        }
    } catch (e) {
        besluit = { versie: STANDAARD, bron: "fout", ophalen: "nee" };
    }

    window.BuckySiteVersion = { kies: kies, pagina: pagina, besluit: besluit, VERSIES: VERSIES };

    if (besluit.ophalen === "wachten") {
        verberg();
        var klaar = false;
        var afronden = function (versie) {
            if (klaar) return;
            klaar = true;
            try { ga(versie); } catch (e) { toon(); }
        };
        setTimeout(function () { afronden(STANDAARD); }, WACHT_MS);
        try {
            // Niet afgebroken bij de deadline: het antwoord komt dan nog in de
            // cache, voor het volgende bezoek. Alleen deze pagina wacht niet meer.
            haal().then(afronden, function () { afronden(STANDAARD); });
        } catch (e) {
            afronden(STANDAARD);
        }
        return;
    }

    try { ga(besluit.versie); } catch (e) { toon(); }
    if (besluit.ophalen === "achtergrond") {
        try { haal().catch(function () { /* volgende keer opnieuw */ }); } catch (e) { /* idem */ }
    }
}());
