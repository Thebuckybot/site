// Sidebar sections, navigation, and active-page highlighting.
import { el, clear } from "./ui.js";

export const SECTIONS = [
  { key: "overview", label: "Overview", group: "Monitor" },
  { key: "incidents", label: "Incidents", group: "Monitor" },
  { key: "audit", label: "Audit Logs", group: "Monitor" },
  { key: "analytics", label: "Analytics", group: "Monitor" },
  { key: "health", label: "Security Health", group: "Monitor" },
  { key: "modules", label: "Modules", group: "Configure" },
  { key: "thresholds", label: "Thresholds", group: "Configure" },
  { key: "punishments", label: "Punishments", group: "Configure" },
  { key: "protection", label: "Protection", group: "Configure" },
  { key: "ignore", label: "Ignore Rules", group: "Configure" },
  { key: "quarantine", label: "Quarantine", group: "Operate" },
  { key: "emergency", label: "Emergency", group: "Operate" },
  { key: "snapshots", label: "Snapshots & Recovery", group: "Operate" },
  { key: "advanced", label: "Advanced", group: "Operate" },
];

const MAP = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));

export function buildSidebar(navEl, onNavigate) {
  clear(navEl);
  const groups = [...new Set(SECTIONS.map((s) => s.group))];
  for (const g of groups) {
    navEl.appendChild(el("div", { class: "sec-nav-group", text: g }));
    for (const s of SECTIONS.filter((x) => x.group === g)) {
      navEl.appendChild(el("button", {
        class: "sec-nav-item", "data-key": s.key, text: s.label,
        onclick: () => onNavigate(s.key),
      }));
    }
  }
}

export function setActive(navEl, key) {
  navEl.querySelectorAll(".sec-nav-item").forEach((b) =>
    b.classList.toggle("active", b.getAttribute("data-key") === key));
}

export function sectionLabel(key) { return (MAP[key] && MAP[key].label) || key; }
export function isSection(key) { return !!MAP[key]; }
