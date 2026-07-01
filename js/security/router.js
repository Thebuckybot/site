// Sidebar structure (flat items + collapsible groups), navigation and active
// highlighting. SOC and Rule Builder are integrated as an advanced group inside
// the one Security Center — not a separate product.
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
    { key: "soc", label: "SOC Dashboard" },
    { key: "rulebuilder", label: "Rule Builder", external: true },
    { key: "rules", label: "Detection Rules" },
    { key: "liveevents", label: "Live Events" },
  ] },
  { type: "group", key: "recovery", label: "Recovery", items: [
    { key: "snapshots", label: "Snapshots" },
    { key: "rollback", label: "Rollback" },
    { key: "emergency", label: "Emergency" },
  ] },
  { type: "item", key: "settings", label: "Settings" },
];

// flat lookup of every internal (SPA) section -> label, and which group it's in
const LABEL = {};
const GROUP_OF = {};
const INTERNAL = new Set();
const EXTERNAL = new Set();
for (const entry of NAV) {
  if (entry.type === "item") { LABEL[entry.key] = entry.label; INTERNAL.add(entry.key); }
  else {
    LABEL[entry.key] = entry.label;
    for (const it of entry.items) {
      LABEL[it.key] = it.label; GROUP_OF[it.key] = entry.key;
      (it.external ? EXTERNAL : INTERNAL).add(it.key);
    }
  }
}

export function sectionLabel(key) { return LABEL[key] || key; }
export function isInternal(key) { return INTERNAL.has(key); }
export function isExternal(key) { return EXTERNAL.has(key); }
export function groupOf(key) { return GROUP_OF[key]; }
export function externalUrl(key, guildId) {
  if (key === "rulebuilder") return `rule-builder.html?guild_id=${guildId}`;
  return "#";
}

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
