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
const INTERNAL = new Set();
for (const entry of NAV) {
  if (entry.type === "item") { LABEL[entry.key] = entry.label; INTERNAL.add(entry.key); }
  else {
    LABEL[entry.key] = entry.label;
    for (const it of entry.items) {
      LABEL[it.key] = it.label; GROUP_OF[it.key] = entry.key;
      INTERNAL.add(it.key);
    }
  }
}

export function sectionLabel(key) { return LABEL[key] || key; }
export function isInternal(key) { return INTERNAL.has(key); }
export function groupOf(key) { return GROUP_OF[key]; }

function navButton(item, onNavigate) {
  return el("button", { class: "sec-nav-item", "data-key": item.key, onclick: () => onNavigate(item.key) }, [
    el("span", { class: "ic", html: icon(item.key) }),
    el("span", { text: item.label }),
  ]);
}

export function buildSidebar(navEl, onNavigate) {
  clear(navEl);
  for (const entry of NAV) {
    if (entry.type === "item") {
      navEl.appendChild(navButton(entry, onNavigate));
      continue;
    }
    const items = el("div", { class: "sec-group-items" }, entry.items.map((it) => navButton(it, onNavigate)));
    const head = el("button", { class: "sec-group-head", type: "button" }, [
      el("span", { class: "ic", html: icon(entry.key) }),
      el("span", { text: entry.label }),
      el("span", { class: "chev", html: "&#8250;" }),
    ]);
    const group = el("div", { class: "sec-group", "data-group": entry.key }, [head, items]);
    head.addEventListener("click", () => group.classList.toggle("open"));
    navEl.appendChild(group);
  }
}

export function setActive(navEl, key) {
  navEl.querySelectorAll(".sec-nav-item").forEach((b) =>
    b.classList.toggle("active", b.getAttribute("data-key") === key));
  // auto-open the group that contains the active section
  const g = GROUP_OF[key];
  navEl.querySelectorAll(".sec-group").forEach((grp) => {
    if (grp.getAttribute("data-group") === g) grp.classList.add("open");
  });
}
