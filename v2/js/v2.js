/*
 * buckybot.app, voorpagina v2 ("Clean & Epic"). Alleen v2/index.html laadt dit.
 *
 * Wat er van de rest van de site gebruikt wordt, is infrastructuur en geen v1:
 * js/features.js (de aan/uit-vlaggen uit +ownerconfig, voor elk `data-feature`)
 * en js/config.js (het adres van de API). Geen van beide wordt hier aangepast.
 *
 * De pagina werkt zonder dit bestand: alle tekst staat in de HTML en is
 * zichtbaar. Dit voegt alleen toe: het menu op een telefoon, de echte cijfers,
 * en (als de bezoeker beweging toestaat) wat zachte beweging.
 */
import "../../js/features.js";
import { API_URL } from "../../js/config.js";

/** Staat de bezoeker beweging toe? Zo niet: alles staat meteen stil en klaar. */
const minderBeweging = window.matchMedia("(prefers-reduced-motion: reduce)");

/* ---- B1. Het menu ---------------------------------------------------------- */
function nav() {
    const kop = document.querySelector("[data-nav]");
    if (!kop) return;
    const knop = kop.querySelector(".nav-toggle");
    const menu = kop.querySelector("#nav-menu");

    const zet = (open) => {
        kop.classList.toggle("is-open", open);
        knop.setAttribute("aria-expanded", String(open));
    };
    knop.addEventListener("click", () => zet(!kop.classList.contains("is-open")));
    // Een link in het menu kiezen sluit het: het doel staat meestal op deze pagina.
    menu.addEventListener("click", (e) => {
        if (e.target.closest("a")) zet(false);
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && kop.classList.contains("is-open")) {
            zet(false);
            knop.focus();
        }
    });
    const breed = window.matchMedia("(min-width: 1080px)");
    breed.addEventListener("change", (e) => { if (e.matches) zet(false); });

    const gescrold = () => kop.classList.toggle("is-scrolled", window.scrollY > 8);
    gescrold();
    window.addEventListener("scroll", gescrold, { passive: true });
}

/* ---- C4. De stats-balk -------------------------------------------------------
   Uit /api/site/stats (backend/services/site_stats.py): dezelfde bronnen als
   +ownerstats. Alleen positieve gehele getallen komen op de pagina; wat
   ontbreekt, nul is of geen getal, valt weg. Is er niets, of faalt het
   ophalen, dan blijft de balk verborgen. Nooit een nul, nooit een gok. */
const STATS = [
    ["servers", "Discord servers"],
    ["players_week", "Players this week"],
    ["challenges", "Challenges finished"],
    ["organisations", "Organisations"],
];

async function haalStats() {
    const stop = new AbortController();
    const klok = setTimeout(() => stop.abort(), 5000);
    try {
        const res = await fetch(`${API_URL}/api/site/stats`, { credentials: "omit", signal: stop.signal });
        if (!res.ok) return null;
        const body = await res.json();
        return body && typeof body.stats === "object" && body.stats !== null ? body.stats : null;
    } catch {
        return null;
    } finally {
        clearTimeout(klok);
    }
}

function telOp(doos, vakken) {
    // Eerst de breedte van het eindgetal vastzetten: anders schuift de balk
    // mee terwijl de cijfers groeien (en dat telt als layout-shift).
    for (const [zicht] of vakken) {
        zicht.style.display = "inline-block";
        zicht.style.minWidth = `${Math.ceil(zicht.getBoundingClientRect().width)}px`;
    }
    const fmt = new Intl.NumberFormat("en");
    const start = () => {
        const begin = performance.now();
        const duur = 1100;
        const stap = (nu) => {
            const t = Math.min(1, (nu - begin) / duur);
            const zacht = 1 - Math.pow(1 - t, 3);
            for (const [zicht, n] of vakken) zicht.textContent = fmt.format(Math.round(n * zacht));
            if (t < 1) requestAnimationFrame(stap);
        };
        for (const [zicht] of vakken) zicht.textContent = fmt.format(0);
        requestAnimationFrame(stap);
    };
    if (!("IntersectionObserver" in window)) return;
    const kijker = new IntersectionObserver((items) => {
        if (items.some((i) => i.isIntersecting)) {
            kijker.disconnect();
            start();
        }
    }, { threshold: 0.6 });
    kijker.observe(doos);
}

async function stats() {
    const doos = document.querySelector("[data-stats]");
    const lijst = document.querySelector("[data-stats-list]");
    if (!doos || !lijst) return;
    const cijfers = await haalStats();
    if (!cijfers) return;

    const fmt = new Intl.NumberFormat("en");
    const vakken = [];
    for (const [sleutel, label] of STATS) {
        const n = cijfers[sleutel];
        if (!Number.isInteger(n) || n <= 0) continue;
        const groep = document.createElement("div");
        groep.className = "stat";
        const dt = document.createElement("dt");
        dt.className = "label";
        dt.textContent = label;
        const dd = document.createElement("dd");
        // Een schermlezer leest het eindgetal; het tellen is alleen voor het oog.
        const echt = document.createElement("span");
        echt.className = "sr-only";
        echt.textContent = fmt.format(n);
        const zicht = document.createElement("span");
        zicht.setAttribute("aria-hidden", "true");
        zicht.textContent = fmt.format(n);
        dd.append(echt, zicht);
        groep.append(dt, dd);
        lijst.append(groep);
        vakken.push([zicht, n]);
    }
    if (!vakken.length) return;
    doos.hidden = false;
    if (!minderBeweging.matches) telOp(doos, vakken);
}

nav();
stats();
