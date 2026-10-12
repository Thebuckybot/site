/*
 * DE VERSIESCHAKELAAR VAN DE SITE (docs/site-redesign-clean-epic.md, deel A0; sitebreed
 * sinds 13-10-2026).
 * ADR: docs/adr/0011-twee-voorpaginas-gekozen-door-de-config-en-een-router-in-de-head.md
 *
 * buckybot.app heeft twee versies naast elkaar: v1 (de huidige) en v2 ("Clean &
 * Epic", in v2/). Welke het publiek krijgt, zet de eigenaar met `+ownerconfig` in
 * site_features.json (`site.version`, tot 13-10-2026 `homepage.version`); de
 * backend geeft die stand mee in /api/site/features. Omzetten is dus geen deploy.
 *
 * DRIE SOORTEN PAGINA, gekozen met `data-page` op de scripttag:
 *   "v1" / "v2"  een pagina met een tegenhanger (`data-v1` / `data-v2`, relatief).
 *                Klopt de versie niet, dan gaat hij daarheen. Een pagina zonder
 *                tegenhanger (de org-pagina bestaat alleen in v2) wijst in
 *                `data-v1` naar wat v1 op die plek deed.
 *   "beide"      een pagina die in allebei hetzelfde is (de arcade). Geen sprong;
 *                de versie bepaalt alleen gedrag. Met `data-gate="login"` eist
 *                hij onder v2 een sessie: zonder gaat de bezoeker naar de login en
 *                daarna terug naar deze pagina. Dat is een nette deur aan de
 *                voorkant, geen beveiliging: de data achter de arcade bewaakt de
 *                backend zelf (elke persoonlijke route eist een sessie).
 * Pagina's zonder deze scripttag (de dashboards) zijn altijd v1.
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
    var POORT_MS = 2400;            // zo lang wacht de login-poort op /api/me (onder het vangnet)
    var SESSIE_SLEUTEL = "user_info";   // de sessiecache van js/nav-auth.js

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
                var v = geldig(body && body.site && body.site.version) || STANDAARD;
                schrijf("localStorage", CACHE_SLEUTEL, JSON.stringify({ v: v, at: Date.now() }));
                return v;
            });
    }

    var script = document.currentScript;
    var paginaRuw = script && script.getAttribute("data-page");
    var gedeeld = paginaRuw === "beide";
    var pagina = geldig(paginaRuw) || STANDAARD;
    var poort = script && script.getAttribute("data-gate");
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

    // ---- De login-poort (alleen op een gedeelde pagina, alleen onder v2) ----
    // Hergebruikt de sessie van de site: dezelfde /api/me die js/nav-auth.js
    // vraagt, en dezelfde cache (sessionStorage "user_info") die nav-auth.js
    // vult en bij uitloggen wist.
    function naarLogin() {
        // Terug naar deze pagina, relatief aan de site (backend: sessions.
        // safe_return_path laat alleen een eigen pagina toe, geen open redirect).
        var basis = new URL("../", script.src).href;
        var hier = window.location.href;
        var terug = hier.indexOf(basis) === 0 ? hier.slice(basis.length) : "";
        if (vangnet !== null) { clearTimeout(vangnet); vangnet = null; }
        root.style.visibility = "hidden";
        window.location.replace(API_URL + "/login?redirect=" + encodeURIComponent(terug));
    }

    function vraagSessie() {
        return fetch(API_URL + "/api/me", { credentials: "include" }).then(function (res) {
            if (res.status === 401) return false;
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.json().then(function (body) {
                if (body && body.logged_in && body.user) {
                    schrijf("sessionStorage", SESSIE_SLEUTEL, JSON.stringify(body.user));
                    return true;
                }
                return false;
            });
        });
    }

    function loginPoort() {
        var bekend = null;
        try { bekend = JSON.parse(lees("sessionStorage", SESSIE_SLEUTEL) || "null"); } catch (e) { bekend = null; }
        if (bekend) {
            // Ingelogd volgens deze tab: meteen tonen, op de achtergrond nagaan.
            // Verliep de sessie intussen, dan alsnog naar de login.
            toon();
            vraagSessie().then(function (ok) { if (!ok) naarLogin(); }, function () { /* onbekend: laten */ });
            return;
        }
        verberg();
        var klaar = false;
        // Onbereikbare backend: open laten (de data is zonder sessie toch dicht)
        // in plaats van een lege pagina of een lus naar een login die niet antwoordt.
        var klok = setTimeout(function () { if (!klaar) { klaar = true; toon(); } }, POORT_MS);
        vraagSessie().then(function (ok) {
            if (klaar) return;
            klaar = true;
            clearTimeout(klok);
            if (ok) toon(); else naarLogin();
        }, function () {
            if (klaar) return;
            klaar = true;
            clearTimeout(klok);
            toon();
        });
    }

    function ga(versie) {
        window.BuckySiteVersion.versie = versie;
        root.setAttribute("data-site-versie", versie);
        if (gedeeld) {
            if (versie === "v2" && poort === "login") loginPoort(); else toon();
            return;
        }
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
        // Een doel met een eigen anker (v1 van de org-pagina: arcade.html#the-vm)
        // houdt dat; anders gaat het anker van deze pagina mee.
        if (!doel.hash) doel.hash = window.location.hash;
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

    window.BuckySiteVersion = { kies: kies, pagina: gedeeld ? "beide" : pagina, besluit: besluit,
                                VERSIES: VERSIES, versie: null };

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
