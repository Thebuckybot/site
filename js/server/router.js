// De zijbalk van het Server Center: welke schermen er zijn en in welke volgorde.
//
// GROEPEN ZOALS IN DE PREVIEW (dashboard v2, 3-11-2026): een vaste kop per groep
// (Server, Members, Roles and access, Bucky), geen uitklappen - negen ingangen
// passen zonder. Tickets en Waiting krijgen een teller uit het overzicht
// (`zetTellers`), dezelfde getallen die het overzicht zelf al toont.
import { el, clear } from "../security/ui.js";
import { icon } from "./icons.js";

export const NAV = [
  { key: "overview", label: "Overview", groep: "Server" },
  { key: "commands", label: "Commands", groep: "Server" },
  { key: "tickets", label: "Tickets", groep: "Members" },
  // Welcome en Goodbye samen onder een ingang: het is een scherm met twee
  // tabbladen, want het is hetzelfde werk met andere inhoud.
  { key: "welcome", label: "Welcome", groep: "Members" },
  { key: "applications", label: "Applications", groep: "Members" },
  // Het scherm achter het getal op het overzicht. Een eigen ingang en geen tab
  // binnen de bouwer: beslissen over een aanvraag is ander werk dan een vraag
  // schrijven, en het gebeurt door andere mensen.
  { key: "submissions", label: "Waiting", groep: "Members" },
  // De serverhulpmiddelen (2-11-2026). Alleen zichtbaar als de vlag aan staat
  // EN je Server beheren hebt (`tools` en `can_manage_server` uit /me); de
  // routes toetsen beide opnieuw.
  { key: "autorole", label: "Autorole", tool: "autorole", groep: "Roles and access" },
  { key: "verify", label: "Verify", tool: "verify", groep: "Roles and access" },
  { key: "botprofile", label: "Bot profile", groep: "Bucky" },
];

const LABEL = {};
const GROEP = {};
const INTERNAL = new Set();
for (const item of NAV) { LABEL[item.key] = item.label; GROEP[item.key] = item.groep; INTERNAL.add(item.key); }

/** De groep van een scherm, voor de boventitel boven de paginatitel. */
export function groepVan(key) { return GROEP[key] || "Server Center"; }

export function sectionLabel(key) { return LABEL[key] || key; }
export function isInternal(key) { return INTERNAL.has(key); }

export function buildSidebar(navEl, onNavigate, me = null) {
  clear(navEl);
  const tools = (me && me.tools) || {};
  const beheer = !!(me && me.can_manage_server);
  let groep = null;
  let lijst = null;
  for (const item of NAV) {
    if (item.tool && !(tools[item.tool] && beheer)) continue;
    if (item.groep !== groep) {
      groep = item.groep;
      lijst = el("div", { class: "dv2-groep", role: "group", "aria-label": groep }, [
        el("p", { class: "dv2-groep-naam", text: groep, "aria-hidden": "true" }),
      ]);
      navEl.appendChild(lijst);
    }
    lijst.appendChild(el("button", {
      class: "sec-nav-item", "data-key": item.key, type: "button",
      onclick: () => onNavigate(item.key),
    }, [
      // Het icoon is een <svg>-knoop uit icons.js, als kind meegegeven; er
      // gaat geen markup door innerHTML - zie de vangrail in
      // bucky1.0/tests/test_site_html_injectie.py.
      el("span", { class: "ic" }, [icon(item.key)]),
      el("span", { class: "dv2-nav-label", text: item.label }),
    ]));
  }
  zetTellers(navEl, LAATSTE_TELLERS);
}

// De tellers (open tickets, aanvragen die wachten). Onthouden, omdat de zijbalk
// na /me opnieuw wordt getekend.
let LAATSTE_TELLERS = {};

export function zetTellers(navEl, tellers) {
  LAATSTE_TELLERS = { ...LAATSTE_TELLERS, ...(tellers || {}) };
  for (const [key, n] of Object.entries(LAATSTE_TELLERS)) {
    const knop = navEl.querySelector(`.sec-nav-item[data-key="${key}"]`);
    if (!knop) continue;
    let teller = knop.querySelector(".dv2-teller");
    const getal = Number(n) || 0;
    if (!getal) { if (teller) teller.remove(); continue; }
    if (!teller) { teller = el("span", { class: "dv2-teller" }); knop.appendChild(teller); }
    teller.textContent = getal > 99 ? "99+" : String(getal);
    teller.setAttribute("aria-label", `${getal} waiting`);
  }
}

export function setActive(navEl, key) {
  navEl.querySelectorAll(".sec-nav-item").forEach((b) => {
    const actief = b.getAttribute("data-key") === key;
    b.classList.toggle("active", actief);
    if (actief) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
}
