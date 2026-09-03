/**
 * DE AAN/UIT-SCHAKELAARS VAN DE SITE, aan de browserkant.
 *
 * De echte schakelaar staat in `site_features.json` in de bot-boom en wordt
 * omgezet met `+ownerconfig`. De backend leest hem en WEIGERT de bijbehorende
 * endpoints als iets uit staat; deze module haalt dezelfde stand op zodat de
 * pagina het onderdeel ook niet toont.
 *
 * DAT ZIJN TWEE HELFTEN VAN ÉÉN EIS, en de volgorde is belangrijk. Verbergen
 * alleen is niet uit: wie de URL kent praat gewoon door met de server. Weigeren
 * alleen is ook niet uit: dan staat er een kaart op de pagina die bij elke klik
 * een foutmelding geeft, en dat ziet eruit als kapot in plaats van als
 * afgesloten. De server bepaalt, de pagina volgt.
 *
 * WAT ER GEBEURT ALS DE STAND NIET OP TE HALEN IS
 * Dan wordt er NIETS verborgen. Dat is met opzet: de backend weigert dan nog
 * steeds wat uit staat, dus het ergste geval is een kaart die niet werkt - en
 * dat is beter dan een halve site die verdwijnt omdat het netwerk hikte. De
 * beslissing ligt bij de server; dit is de weergave.
 *
 * MARKEREN GAAT MET EEN ATTRIBUUT, NIET MET EEN LIJST HIER
 * Een element krijgt `data-feature="wordle"` in de HTML, en dan regelt dit
 * bestand de rest. Zo staat op de plek zelf wat er bij hoort, en hoeft er geen
 * tweede lijst met selectors te worden bijgehouden die uit de pas kan lopen.
 */

import { API_URL } from "./config.js";

let standCache = null;

/** Haalt de stand op. Faalt stil: bij twijfel tonen we alles. */
export async function haalFeatures() {
    if (standCache) return standCache;
    try {
        const res = await fetch(`${API_URL}/api/site/features`, {
            credentials: "include",
        });
        if (!res.ok) return {};
        const body = await res.json();
        standCache = body.features || {};
        return standCache;
    } catch {
        return {};
    }
}

/**
 * Verbergt elk element met een `data-feature` dat uit staat.
 *
 * `hidden` én `display: none`, want een klasseregel die zelf een `display` zet
 * wint van het `hidden`-attribuut - dat is precies hoe het winpaneel van de
 * Wordle maandenlang zichtbaar bleef terwijl het attribuut er netjes op stond.
 * Het element wordt bovendien uit de toetsvolgorde gehaald: onzichtbaar maar
 * wel te taben is voor een schermlezer nog steeds aanwezig.
 */
export function pasFeaturesToe(stand) {
    const uit = [];
    for (const el of document.querySelectorAll("[data-feature]")) {
        const naam = el.getAttribute("data-feature");
        if (!(naam in stand)) continue;      // onbekend: laten staan
        if (stand[naam]) continue;
        el.hidden = true;
        el.style.display = "none";
        el.setAttribute("aria-hidden", "true");
        for (const focusbaar of el.querySelectorAll(
                "a, button, input, select, textarea, canvas, [tabindex]")) {
            focusbaar.setAttribute("tabindex", "-1");
        }
        uit.push(naam);
    }
    return uit;
}

/** Haalt de stand op en past hem toe. Roep dit aan bij het laden. */
export async function initFeatures() {
    const stand = await haalFeatures();
    return pasFeaturesToe(stand);
}

// DIT BESTAND WORDT ALS MODULE OP ELKE PAGINA GELADEN, dus het doet zijn werk
// zelf. Een module die je moet aanroepen is een module die op de volgende
// pagina wordt vergeten - en dan staat er iets dat uit hoort te staan.
if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => { initFeatures(); });
    } else {
        initFeatures();
    }
}
