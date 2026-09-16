// De zijbalk van het Server Center: welke schermen er zijn en in welke volgorde.
//
// VIER INGANGEN EN GEEN GROEPEN. Het Security Center heeft groepen omdat het er
// zeventien heeft; hier zijn het er vier. Een uitklapbare groep om twee items te
// verbergen kost een klik en levert niets.
import { el, clear } from "../security/ui.js";
import { icon } from "./icons.js";

export const NAV = [
  { key: "overview", label: "Overview" },
  { key: "commands", label: "Commands" },
  { key: "tickets", label: "Tickets" },
  { key: "applications", label: "Applications" },
];

const LABEL = {};
const INTERNAL = new Set();
for (const item of NAV) { LABEL[item.key] = item.label; INTERNAL.add(item.key); }

export function sectionLabel(key) { return LABEL[key] || key; }
export function isInternal(key) { return INTERNAL.has(key); }

export function buildSidebar(navEl, onNavigate) {
  clear(navEl);
  for (const item of NAV) {
    navEl.appendChild(el("button", {
      class: "sec-nav-item", "data-key": item.key, type: "button",
      onclick: () => onNavigate(item.key),
    }, [
      // `html:` krijgt hier uitsluitend een SVG-constante uit icons.js. Tekst
      // van een server gaat nooit door deze weg - zie de vangrail in
      // bucky1.0/tests/test_site_html_injectie.py.
      el("span", { class: "ic", html: icon(item.key) }),
      el("span", { text: item.label }),
    ]));
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
