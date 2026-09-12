/**
 * DE STEMSECTIE OP DE VOORPAGINA.
 *
 * Drie dingen, en niet meer: waar je kunt stemmen, wat het oplevert en wanneer
 * je weer mag. Alle drie komen uit `/api/site/vote`, en dat is `vote.json` uit
 * de bot-boom - hetzelfde bestand dat de trekking doet, de DM na een stem
 * schrijft en de kaart van `+vote` vult.
 *
 * ER STAAT DUS GEEN ENKEL BEDRAG IN DE HTML, en dat is de hele opzet. Tot
 * 12 september 2026 stonden de beloning en de wachttijd op drie plekken los
 * ingetypt in de bot; een sectie met haar eigen getallen zou de vierde zijn
 * geworden, en de enige die maanden verkeerd kan staan omdat niemand een
 * webpagina naast een Discord-DM legt.
 *
 * DE SECTIE BEGINT VERBORGEN en wordt pas getoond als er werkelijk iets te
 * tonen is. Dat is met opzet omgekeerd ten opzichte van de rest van de pagina:
 * een lege "Vote for Bucky"-kop zonder knoppen is erger dan geen sectie, want
 * hij belooft iets en levert niets. Valt de backend weg, staat de vlag `vote`
 * uit, of is de config onleesbaar, dan blijft de sectie dus gewoon weg.
 *
 * ALLES WORDT ALS TEKST GEZET (`textContent`) en nooit als HTML. De namen komen
 * uit een configbestand dat de eigenaar bijwerkt, en een naam met een `<` erin
 * hoort een naam met een `<` erin te blijven. De stem-URL's worden hier nog een
 * tweede keer op `https://` gecontroleerd; de backend doet het al, maar een
 * `href` op de voorpagina is de plek om niet op één controle te vertrouwen.
 */

import { API_URL } from "./config.js";

/** Een getal zoals een bezoeker het leest: 250,000 en niet 250000. */
function getal(n) {
    return Number(n).toLocaleString("en-US");
}

/** Wat er in een beloning zit, als één regel tekst. */
function inhoud(rij) {
    const delen = [];
    if (rij.shards) {
        const { min, max } = rij.shards;
        delen.push(min === max
            ? `${getal(min)} shards`
            : `${getal(min)}–${getal(max)} shards`);
    }
    for (const item of rij.items || []) {
        delen.push(`${item.amount}× ${item.label}`);
    }
    return delen.join(" + ");
}

/** Eén rij van de tabel: de kans, de naam, en wat erin zit. */
function beloningsRij(rij) {
    const el = document.createElement("li");
    el.className = "vote-row";

    const kans = document.createElement("span");
    kans.className = "vote-chance";
    // Afgerond op een heel procent. De gewichten in de config tellen op tot
    // honderd, dus dit is geen benadering maar precies wat er staat - en een
    // bezoeker heeft aan "3%" meer dan aan "3.0000%".
    kans.textContent = `${Math.round(rij.chance * 100)}%`;

    const naam = document.createElement("span");
    naam.className = "vote-name";
    naam.textContent = rij.name;

    const wat = document.createElement("span");
    wat.className = "vote-payout";
    wat.textContent = inhoud(rij);

    el.append(kans, naam, wat);
    return el;
}

/** Eén knop per stemlijst. */
function siteKnop(rij) {
    const a = document.createElement("a");
    a.className = "btn btn-primary vote-site";
    a.href = rij.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = `Vote on ${rij.name}`;
    return a;
}

/**
 * Vul de sectie, of laat hem verborgen.
 *
 * Geeft terug of er iets is getoond, zodat een test dat kan nalezen zonder in
 * de DOM te hoeven graven.
 */
export function rendervote(data) {
    const sectie = document.getElementById("vote");
    if (!sectie) return false;

    const sites = (data && Array.isArray(data.sites) ? data.sites : [])
        .filter((rij) => typeof rij.url === "string" && rij.url.startsWith("https://"));
    const beloningen = data && Array.isArray(data.rewards) ? data.rewards : [];

    // GEEN HALVE SECTIE. Zonder lijst valt er niet te stemmen, en zonder tabel
    // is er niets te winnen; in beide gevallen is de kop een belofte die niet
    // waargemaakt wordt.
    if (!sites.length || !beloningen.length) return false;

    const knoppen = sectie.querySelector("[data-vote-sites]");
    const tabel = sectie.querySelector("[data-vote-rewards]");
    const wacht = sectie.querySelectorAll("[data-vote-cooldown]");
    if (!knoppen || !tabel) return false;

    knoppen.replaceChildren(...sites.map(siteKnop));
    tabel.replaceChildren(...beloningen.map(beloningsRij));

    const uren = Number(data.cooldown_hours) || 12;
    for (const el of wacht) {
        el.textContent = String(uren);
    }

    // Hoeveel keer per dag er te stemmen valt: het aantal lijsten maal de
    // vensters per dag. Uit de data en niet uit een aanname, want een derde
    // lijst erbij is aan de botkant één regel config.
    const perDag = sites.length * Math.max(1, Math.floor(24 / uren));
    for (const el of sectie.querySelectorAll("[data-vote-per-day]")) {
        el.textContent = String(perDag);
    }

    sectie.hidden = false;
    sectie.removeAttribute("aria-hidden");

    // DE ANIMATIES MOETEN OPNIEUW METEN. `index.js` bouwt zijn ScrollTrigger-
    // posities bij het laden van de pagina, en op dat moment stond deze sectie
    // nog op `display: none` - dus alle posities eronder zijn verschoven en de
    // trigger van deze kop staat op de verkeerde plek. Zonder deze verversing
    // kan de kop op opacity 0 blijven staan: een sectie met twee panelen en
    // geen titel, en niets in de console dat zegt waarom.
    //
    // De IntersectionObserver van `initReveal()` heeft dit niet nodig - die
    // meet per scroll en merkt een element dat later een doos krijgt zelf.
    if (window.ScrollTrigger && typeof window.ScrollTrigger.refresh === "function") {
        window.ScrollTrigger.refresh();
    }
    return true;
}

/** Haal de stand op. Faalt stil: geen sectie is een compleet antwoord. */
export async function haalVote() {
    try {
        const res = await fetch(`${API_URL}/api/site/vote`);
        if (!res.ok) return null;               // 503 = de vlag staat uit
        return await res.json();
    } catch {
        return null;
    }
}

export async function initVote() {
    const data = await haalVote();
    return rendervote(data);
}

// Zelfstandig, net als `features.js`: een module die je moet aanroepen is een
// module die op de volgende pagina wordt vergeten.
if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => { initVote(); });
    } else {
        initVote();
    }
}
