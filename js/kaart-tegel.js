/**
 * De tegel "Cards" op het dashboard (11-11-2026): een kleine preview van je profielkaart, zoals Discord hem toont, en een link naar
 * de editor (v2/cards.html).
 *
 * ALLEEN ALS DE VLAG `kaart_editor` AAN STAAT (kaart-ingang.js: bij uit, een mislukte aanroep of twijfel blijft de tegel verborgen
 * en gebeurt er niets). Is de vlag aan maar ben je niet ingelogd (401), dan gaat de tegel weer dicht. De preview is OPTIONEEL: faalt
 * die (te veel previews, de bot is weg, een oude bot zonder opbouw), dan blijft de tegel met alleen de link staan.
 *
 * Eén preview zodra de tegel in beeld komt (IntersectionObserver), 10 minuten onthouden in sessionStorage, via dezelfde route en dezelfde tekenroutine als de editor
 * (POST /api/v1/me/kaart/preview, js/kaart-opbouw.js): tekst als tekst, platen alleen van de API-host.
 */
import { API_URL } from "./config.js";
import { kaartEditorAan } from "./kaart-ingang.js";
import { discordAvatar, tekenOpbouw } from "./kaart-opbouw.js";

function bekendeSpeler() {
    try {
        const u = JSON.parse(sessionStorage.getItem("user_info") || "null");
        if (u && typeof u === "object") {
            return { id: String(u.id || ""), naam: String(u.global_name || u.username || "").slice(0, 60), avatarUrl: discordAvatar(String(u.id || ""), u.avatar) };
        }
    } catch (_e) { /* geen opslag */ }
    return { id: "", naam: "", avatarUrl: null };
}

const CACHE_SLEUTEL = "bucky_kaart_tegel_v1";
const CACHE_MS = 10 * 60 * 1000;

/* Het laatste antwoord 10 minuten onthouden (alleen deze tab, per speler), zodat heen en weer klikken geen preview kost.
   Zonder opslag of met een kapotte waarde werkt alles gewoon, alleen zonder cache. */
function uitCache(speler) {
    if (!speler) return null;                        // wie we niet kennen krijgt nooit de kaart van een ander
    try {
        const c = JSON.parse(sessionStorage.getItem(CACHE_SLEUTEL) || "null");
        if (c && typeof c === "object" && c.speler === speler && Date.now() - c.tijd < CACHE_MS && c.opbouw) return c;
    } catch (_e) { /* geen opslag */ }
    return null;
}

/* De sessiecache (user_info) wordt door de pagina zelf pas na het laden gevuld; ontbreekt het id nog, dan een paar keer later
   proberen. Zonder id wordt er niets bewaard: liever een aanroep te veel dan de kaart van de vorige speler. */
function inCache(data, poging = 0) {
    const speler = bekendeSpeler().id;
    if (!speler) {
        if (poging < 3) setTimeout(() => inCache(data, poging + 1), 1500);
        return;
    }
    try {
        sessionStorage.setItem(CACHE_SLEUTEL, JSON.stringify({ speler, tijd: Date.now(), opbouw: data.opbouw, platen: data.platen || {} }));
    } catch (_e) { /* geen opslag */ }
}

async function laadPreview(tegel, vak) {
    const speler = bekendeSpeler();
    const bewaard = uitCache(speler.id);
    if (bewaard) {
        tekenOpbouw(vak, bewaard.opbouw, { platen: bewaard.platen || {}, avatarUrl: speler.avatarUrl, naam: speler.naam });
        return;
    }
    const ctl = new AbortController();
    const klok = setTimeout(() => ctl.abort(), 15000);
    try {
        const res = await fetch(`${API_URL}/api/v1/me/kaart/preview`, {
            method: "POST", credentials: "include", signal: ctl.signal,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ kaart: "profiel", wijzig: {} }),
        });
        if (res.status === 401) {
            tegel.hidden = true;                     // niet ingelogd: er valt niets te tonen
            return;
        }
        const body = await res.json();
        const data = body && body.ok === true ? body.data : null;
        if (!res.ok || !data || !data.opbouw) return;
        inCache(data);
        tekenOpbouw(vak, data.opbouw, { platen: data.platen || {}, avatarUrl: speler.avatarUrl, naam: speler.naam });
    } catch (_e) {
        /* de preview is optioneel: de link blijft */
    } finally {
        clearTimeout(klok);
    }
}

async function start() {
    const tegel = document.querySelector("[data-kaart-tegel]");
    if (!tegel || !(await kaartEditorAan())) return;
    tegel.hidden = false;
    const vak = tegel.querySelector("[data-kaart-mini]");
    /* De preview kost de bot een tekenbeurt: pas halen als de tegel echt in beeld komt, en dan maar een keer. */
    if (typeof IntersectionObserver === "undefined") { laadPreview(tegel, vak); return; }
    const waarnemer = new IntersectionObserver((items) => {
        if (!items.some((i) => i.isIntersecting)) return;
        waarnemer.disconnect();
        laadPreview(tegel, vak);
    });
    waarnemer.observe(tegel);
}

if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
}
