// Sidebar structure (flat items + collapsible groups), navigation and active
// highlighting. SOC and Rule Builder are fully integrated as an advanced group
// inside the one Security Center — every entry is an internal SPA workspace.
// There is no "external" navigation: nothing ever leaves the Security Center.
import { el, clear } from "./ui.js";
import { icon } from "./icons.js";

export const NAV = [
  { type: "item", key: "overview", label: "Overview" },
  { type: "item", key: "modules", label: "Modules" },
  { type: "item", key: "thresholds", label: "Thresholds" },
  { type: "item", key: "punishments", label: "Punishments" },
  { type: "item", key: "protection", label: "Protection" },
  { type: "item", key: "ignore", label: "Ignore Rules" },
  { type: "item", key: "quarantine", label: "Quarantine" },
  { type: "group", key: "monitoring", label: "Monitoring", items: [
    { key: "incidents", label: "Incidents" },
    { key: "audit", label: "Audit Logs" },
    { key: "analytics", label: "Analytics" },
    { key: "health", label: "Health" },
  ] },
  { type: "group", key: "soc", label: "SOC", items: [
    { key: "soc", label: "Overview" },
    { key: "rulebuilder", label: "Rule Builder" },
    { key: "rules", label: "Detection Rules" },
    { key: "liveevents", label: "Live Events" },
  ] },
  { type: "group", key: "recovery", label: "Recovery", items: [
    { key: "snapshots", label: "Snapshots" },
    { key: "rollback", label: "Restore" },
    { key: "emergency", label: "Emergency" },
  ] },
  { type: "item", key: "settings", label: "Settings" },
];

// flat lookup of every SPA section -> label, and which group it's in. Every
// section is internal (a lazily-imported page module under pages/<key>.js).
const LABEL = {};
const GROUP_OF = {};
// De naam van een groep apart: "soc" is zowel een groep als een item ("Overview").
const GROEP_LABEL = {};
const INTERNAL = new Set();
for (const entry of NAV) {
  if (entry.type === "item") { LABEL[entry.key] = entry.label; INTERNAL.add(entry.key); }
  else {
    LABEL[entry.key] = entry.label; GROEP_LABEL[entry.key] = entry.label;
    for (const it of entry.items) {
      LABEL[it.key] = it.label; GROUP_OF[it.key] = entry.key;
      INTERNAL.add(it.key);
    }
  }
}

// Secties die uit staan (zie site_features.json, omgezet met +ownerconfig).
//
// DIT KAN NIET MET `data-feature` IN DE HTML, en dat is de reden dat het hier
// staat: de zijbalk wordt door dit bestand getekend en bestaat op het moment
// dat de pagina laadt nog niet. Een attribuut op iets wat er nog niet is, doet
// niets. De vlaggen komen dus bij de router binnen voordat hij tekent.
const VERBORGEN = new Set();

export function verbergSecties(keys) {
  VERBORGEN.clear();
  for (const k of keys || []) VERBORGEN.add(k);
}

export function isVerborgen(key) { return VERBORGEN.has(key); }

export function sectionLabel(key) { return LABEL[key] || key; }

/** Bestaat deze sectie EN staat hij aan?
 *
 * Allebei in één vraag, want elke aanroeper wil hetzelfde weten: mag ik hier
 * naartoe. Zo valt een `#soc` in de adresbalk terug op de overzichtspagina in
 * plaats van een workspace te openen die uit staat - verbergen in de zijbalk
 * alleen zou een link zijn die je nog steeds kunt intypen.
 */
export function isInternal(key) { return INTERNAL.has(key) && !VERBORGEN.has(key); }
export function groupOf(key) { return GROUP_OF[key]; }

function navButton(item, onNavigate) {
  return el("button", { class: "sec-nav-item", "data-key": item.key, onclick: () => onNavigate(item.key) }, [
    el("span", { class: "ic" }, [icon(item.key)]),
    el("span", { class: "dv2-nav-label", text: item.label }),
  ]);
}

// DASHBOARD V2 (3-11-2026): vaste groepskoppen zoals in de preview, in plaats
// van uitklapbare groepen; elk scherm staat altijd in beeld. De losse items
// krijgen ook een kop (Protect, Setup), zodat het paneel leest als een lijst
// met hoofdstukken. Overview staat bovenaan, zonder kop. De `.sec-group` met
// `data-group` blijft bestaan (de rail op een tablet en setActive gebruiken hem).
const ITEM_KOP = {
  modules: "Protect", thresholds: "Protect", punishments: "Protect",
  protection: "Protect", ignore: "Protect", quarantine: "Protect",
  settings: "Setup",
};

/** De kop waar een scherm onder staat, voor de boventitel boven de paginatitel. */
export function kopVan(key) {
  if (GROUP_OF[key]) return GROEP_LABEL[GROUP_OF[key]];
  return ITEM_KOP[key] || "Security Center";
}

function groepMetKop(naam, sleutel, knoppen) {
  return el("div", { class: "sec-group dv2-groep open", "data-group": sleutel, role: "group", "aria-label": naam }, [
    el("p", { class: "dv2-groep-naam", text: naam, "aria-hidden": "true" }),
    el("div", { class: "sec-group-items" }, knoppen),
  ]);
}

export function buildSidebar(navEl, onNavigate) {
  clear(navEl);
  let kop = null;
  let knoppen = [];
  const sluit = () => {
    if (!knoppen.length) return;
    if (kop) navEl.appendChild(groepMetKop(kop, kop.toLowerCase(), knoppen));
    else knoppen.forEach((k) => navEl.appendChild(k));
    knoppen = [];
  };
  for (const entry of NAV) {
    if (entry.type === "item") {
      if (VERBORGEN.has(entry.key)) continue;
      const k = ITEM_KOP[entry.key] || null;
      if (k !== kop) { sluit(); kop = k; }
      knoppen.push(navButton(entry, onNavigate));
      continue;
    }
    sluit(); kop = null;
    const zichtbaar = entry.items.filter((it) => !VERBORGEN.has(it.key));
    // Een groep zonder overgebleven items is een kop naar niets. Blijft er één
    // over, dan blijft de groep staan - de indeling is geen gevolg van hoeveel
    // er toevallig aan staat.
    if (!zichtbaar.length) continue;
    navEl.appendChild(groepMetKop(entry.label, entry.key, zichtbaar.map((it) => navButton(it, onNavigate))));
  }
  sluit();
}

export function setActive(navEl, key) {
  navEl.querySelectorAll(".sec-nav-item").forEach((b) => {
    const actief = b.getAttribute("data-key") === key;
    b.classList.toggle("active", actief);
    if (actief) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  // auto-open the group that contains the active section
  const g = GROUP_OF[key];
  navEl.querySelectorAll(".sec-group").forEach((grp) => {
    if (grp.getAttribute("data-group") === g) grp.classList.add("open");
  });
}
