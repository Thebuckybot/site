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
import { haalLogin, leesSessieCache, loginUrl, uitloggen } from "../../js/nav-auth.js";

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
   Uit /api/site/stats (backend/services/site_stats.py), en die uit de bot zelf,
   zoals +ownerstats: servers, de leden van al die servers samen, en de
   commando's die een gewone gebruiker kan draaien. Alleen positieve gehele
   getallen komen op de pagina; wat ontbreekt, nul is of geen getal, valt weg.
   Is er niets, of faalt het ophalen, dan blijft de balk verborgen. Nooit een
   nul, nooit een gok. */
const STATS = [
    ["servers", "Discord servers"],
    ["members", "Members reached"],
    ["commands", "Commands"],
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

/* ---- G. Beweging, ingetogen -----------------------------------------------
   Secties komen zacht binnen (IntersectionObserver + CSS, geen bibliotheek) en
   het eiland in de hero schuift een paar pixels trager dan de pagina. Alles
   blijft stil bij prefers-reduced-motion, bij "data besparen" en op een zwak
   toestel; dan staat de inhoud er meteen, zonder beginstand. */
function zwakToestel() {
    const geheugen = navigator.deviceMemory;
    const kernen = navigator.hardwareConcurrency;
    const zuinig = navigator.connection && navigator.connection.saveData;
    return Boolean(zuinig) || (geheugen !== undefined && geheugen <= 2) || (kernen !== undefined && kernen <= 2);
}

function beweging() {
    if (minderBeweging.matches || zwakToestel() || !("IntersectionObserver" in window)) return;
    const root = document.documentElement;
    const items = [...document.querySelectorAll("[data-reveal]")];

    // Wat NU al in beeld staat (een link naar #security, of terug in de
    // geschiedenis) krijgt meteen zijn eindstand, in hetzelfde frame als de
    // klasse: anders verdwijnt het heel even en komt het dan pas binnen.
    const hoogte = window.innerHeight;
    for (const el of items) {
        const r = el.getBoundingClientRect();
        if (r.top < hoogte && r.bottom > 0) el.classList.add("is-in");
    }
    root.classList.add("v2-motion");

    const kijker = new IntersectionObserver((lijst) => {
        for (const i of lijst) {
            if (!i.isIntersecting) continue;
            i.target.classList.add("is-in");
            kijker.unobserve(i.target);
        }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    for (const el of items) if (!el.classList.contains("is-in")) kijker.observe(el);

    parallax(root);
}

function parallax(root) {
    const media = document.querySelector("[data-parallax]");
    const hero = document.querySelector(".hero");
    if (!media || !hero) return;
    const breed = window.matchMedia("(min-width: 1080px)");
    let gepland = false;

    const zet = () => {
        gepland = false;
        if (!breed.matches) {
            media.style.transform = "";
            return;
        }
        const y = Math.min(window.scrollY, hero.offsetHeight);
        media.style.transform = `translate3d(0, ${(y * 0.05).toFixed(1)}px, 0)`;
    };
    const vraag = () => {
        if (!gepland) {
            gepland = true;
            requestAnimationFrame(zet);
        }
    };
    root.classList.add("v2-parallax");
    window.addEventListener("scroll", vraag, { passive: true });
    breed.addEventListener("change", vraag);
    zet();
}

/* ---- A. Inloggen en uitloggen -------------------------------------------------
   Dezelfde sessie als v1 (js/nav-auth.js): de cache in sessionStorage voor de
   eerste tekening, /api/me als bevestiging, POST /logout om uit te loggen. Hier
   alleen de plek en de stijl. */
function avatarUrl(user) {
    if (user.avatar) {
        return `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.png?size=64`;
    }
    // Zonder eigen avatar: dezelfde standaardavatar als Discord zelf toont.
    let index = 0;
    try { index = Number((BigInt(user.id) >> 22n) % 6n); } catch (_e) { index = 0; }
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** Waar de login terugkomt: deze pagina, relatief aan de site (bijv. "v2/tos.html").
 *
 * Alleen het pad, als `.html`: dat is wat de backend toelaat (sessions.
 * safe_return_path). Een map wordt `index.html`; de query blijft weg (een
 * preview met ?site=v2 staat al in de sessionStorage van dit tabblad). */
function terugPad() {
    const basis = new URL("../../", import.meta.url).pathname;
    let pad = window.location.pathname;
    if (!pad.startsWith(basis)) return "";
    pad = pad.slice(basis.length);
    if (pad === "" || pad.endsWith("/")) pad += "index.html";
    return pad;
}

function tekenAuth(user) {
    const binnen = Boolean(user && user.id);
    for (const el of document.querySelectorAll("[data-auth-in]")) el.hidden = !binnen;
    for (const el of document.querySelectorAll("[data-auth-uit]")) el.hidden = binnen;
    if (!binnen) return;
    const naam = user.global_name || user.username || "Signed in";
    for (const el of document.querySelectorAll("[data-auth-naam]")) el.textContent = naam;
    for (const img of document.querySelectorAll("[data-auth-avatar]")) {
        img.src = avatarUrl(user);
        img.alt = "";
    }
}

function auth() {
    for (const a of document.querySelectorAll("[data-auth-login]")) a.href = loginUrl(terugPad());
    tekenAuth(leesSessieCache());
    haalLogin().then((stand) => tekenAuth(stand.loggedIn ? stand.user : null));

    const knop = document.querySelector(".nav-user-knop");
    const menu = document.getElementById("nav-user-menu");
    if (knop && menu) {
        const zet = (open) => {
            menu.hidden = !open;
            knop.setAttribute("aria-expanded", String(open));
        };
        knop.addEventListener("click", () => zet(menu.hidden));
        document.addEventListener("click", (e) => {
            if (!menu.hidden && !e.target.closest(".nav-user")) zet(false);
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !menu.hidden) { zet(false); knop.focus(); }
        });
    }
    for (const b of document.querySelectorAll("[data-auth-logout]")) {
        b.addEventListener("click", async () => {
            // Zoals v1 (doLogout): wissen, en dan naar de voorpagina.
            try {
                if (await uitloggen()) {
                    tekenAuth(null);
                    window.location.href = "index.html";
                } else {
                    alert("Logout failed.");
                }
            } catch (_e) {
                alert("Logout failed due to network error.");
            }
        });
    }
    // Uitloggen in een ander tabblad: hier ook.
    window.addEventListener("storage", (e) => {
        if (e.key === "user_info" && !e.newValue) tekenAuth(null);
    });
}

nav();
auth();
stats();
beweging();
