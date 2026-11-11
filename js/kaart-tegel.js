/**
 * De tegel "Cards" op het dashboard (11-11-2026): een kleine preview van je profielkaart, zoals Discord hem toont, en een link naar
 * de editor (v2/cards.html).
 *
 * ALLEEN ALS DE VLAG `kaart_editor` AAN STAAT (kaart-ingang.js: bij uit, een mislukte aanroep of twijfel blijft de tegel verborgen
 * en gebeurt er niets). Is de vlag aan maar ben je niet ingelogd (401), dan gaat de tegel weer dicht. De preview is OPTIONEEL: faalt
 * die (te veel previews, de bot is weg, een oude bot zonder opbouw), dan blijft de tegel met alleen de link staan.
 *
 * Eén preview per keer dat het dashboard opent, via dezelfde route en dezelfde tekenroutine als de editor
 * (POST /api/v1/me/kaart/preview, js/kaart-opbouw.js): tekst als tekst, platen alleen van de API-host.
 */
import { API_URL } from "./config.js";
import { kaartEditorAan } from "./kaart-ingang.js";
import { discordAvatar, tekenOpbouw } from "./kaart-opbouw.js";

function bekendeSpeler() {
    try {
        const u = JSON.parse(sessionStorage.getItem("user_info") || "null");
        if (u && typeof u === "object") {
            return { naam: String(u.global_name || u.username || "").slice(0, 60), avatarUrl: discordAvatar(String(u.id || ""), u.avatar) };
        }
    } catch (_e) { /* geen opslag */ }
    return { naam: "", avatarUrl: null };
}

async function start() {
    const tegel = document.querySelector("[data-kaart-tegel]");
    if (!tegel || !(await kaartEditorAan())) return;
    tegel.hidden = false;
    const vak = tegel.querySelector("[data-kaart-mini]");
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
        const speler = bekendeSpeler();
        tekenOpbouw(vak, data.opbouw, { platen: data.platen || {}, avatarUrl: speler.avatarUrl, naam: speler.naam });
    } catch (_e) {
        /* de preview is optioneel: de link blijft */
    } finally {
        clearTimeout(klok);
    }
}

if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
}
