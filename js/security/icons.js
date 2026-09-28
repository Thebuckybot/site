// Minimal monochrome line icons (inherit currentColor via stroke) for the sidebar.
//
// De onderdelen staan hier als DATA ([tag, {attributen}]) en niet als
// SVG-markup: icon() bouwt er met createElementNS een <svg>-knoop van, die als
// kind in el() gaat. Zo loopt er geen enkele string door innerHTML.
import { svg } from "./ui.js";

export const ICONS = {
  overview: [["path", {d: "M4 13h6V4H4zM14 20h6V4h-6zM4 20h6v-5H4z"}]],
  incidents: [["path", {d: "M12 3l9 16H3z"}], ["path", {d: "M12 10v4M12 17h.01"}]],
  audit: [["path", {d: "M6 3h9l5 5v13H6z"}], ["path", {d: "M9 12h7M9 16h7M9 8h4"}]],
  analytics: [["path", {d: "M4 20V4M4 20h16"}], ["path", {d: "M8 16v-4M12 16V8M16 16v-6"}]],
  health: [["path", {d: "M3 12h4l2 5 4-12 2 7h6"}]],
  modules: [["path", {d: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"}]],
  thresholds: [["path", {d: "M4 8h16M8 4v8M4 16h16M16 12v8"}]],
  punishments: [["path", {d: "M4 6h16M4 12h16M4 18h10"}], ["path", {d: "M18 16l2 2-4 4"}]],
  protection: [["path", {d: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"}]],
  ignore: [["path", {d: "M4 4l16 16"}], ["path", {d: "M12 5c5 0 8 4 9 7-.4 1-1 2-1.8 2.9M6 6.6C4.2 7.9 3.2 9.6 3 12c1 3 4 7 9 7 1.2 0 2.3-.2 3.3-.6"}]],
  quarantine: [["path", {d: "M5 3h14v18l-7-3-7 3z"}], ["path", {d: "M9 9h6M9 13h6"}]],
  emergency: [["path", {d: "M12 3l9 16H3z"}], ["path", {d: "M12 9v5M12 17h.01"}]],
  snapshots: [["path", {d: "M4 7h4l2-2h4l2 2h4v12H4z"}], ["circle", {cx: "12", cy: "13", r: "3"}]],
  advanced: [["circle", {cx: "12", cy: "12", r: "3"}], ["path", {d: "M12 3v3M12 18v3M3 12h3M18 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"}]],
  settings: [["circle", {cx: "12", cy: "12", r: "3"}], ["path", {d: "M4 12h2M18 12h2M12 4v2M12 18v2"}]],
  monitoring: [["path", {d: "M3 12h4l2 5 4-12 2 7h6"}]],
  soc: [["path", {d: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"}], ["path", {d: "M12 9v3l2 1"}]],
  recovery: [["path", {d: "M4 12a8 8 0 1 1 2.3 5.6"}], ["path", {d: "M4 20v-4h4"}]],
  rules: [["path", {d: "M6 3h9l5 5v13H6z"}], ["path", {d: "M9 12h7M9 16h5"}], ["path", {d: "M9 8h3"}]],
  liveevents: [["circle", {cx: "12", cy: "12", r: "2.5"}], ["path", {d: "M5 12a7 7 0 0 1 14 0"}], ["path", {d: "M2 12a10 10 0 0 1 20 0"}]],
  rulebuilder: [["path", {d: "M4 7h16M4 12h10M4 17h7"}], ["path", {d: "M17 14l4 4-4 4", transform: "translate(0 -7)"}]],
  rollback: [["path", {d: "M4 12a8 8 0 1 1 2.3 5.6"}], ["path", {d: "M4 20v-4h4"}], ["path", {d: "M12 8v4l3 2"}]],
};

// Elke aanroep een nieuwe knoop: een DOM-knoop kan maar op één plek hangen.
export function icon(key) {
  return svg({ viewBox: "0 0 24 24", "aria-hidden": "true" }, ICONS[key] || ICONS.overview);
}
