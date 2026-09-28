// De iconen van het Server Center. Zelfde vorm als js/security/icons.js: de
// onderdelen als DATA ([tag, {attributen}]), en icon() bouwt er met
// createElementNS een <svg>-knoop van. Er gaat geen markup-string door innerHTML.
import { svg } from "../security/ui.js";

export const ICONS = {
  overview: [["path", {d: "M4 13h6V4H4zM14 20h6V4h-6zM4 20h6v-5H4z"}]],
  // Een prompt-teken: commando's zijn getypte tekst.
  commands: [["path", {d: "M4 5h16v14H4z"}], ["path", {d: "M8 10l2.5 2L8 14"}], ["path", {d: "M13 14h3"}]],
  // Een strookje met een scheur: een ticket.
  tickets: [["path", {d: "M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"}], ["path", {d: "M14 6v12", "stroke-dasharray": "2 2"}]],
  // Een formulier met regels en een vinkje.
  applications: [["path", {d: "M6 3h9l5 5v13H6z"}], ["path", {d: "M9 12h6M9 16h4"}], ["path", {d: "M9 8h3"}]],
  // Een open deur met een pijl naar binnen: binnenkomen en weggaan.
  welcome: [["path", {d: "M14 3h5a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-5"}], ["path", {d: "M10 8l4 4-4 4"}], ["path", {d: "M14 12H4"}]],
  // Een gezicht in een kader: hoe de bot eruitziet in deze server.
  botprofile: [["rect", {x: "3", y: "3", width: "18", height: "18", rx: "4"}], ["circle", {cx: "12", cy: "10", r: "3"}], ["path", {d: "M7 18c1.2-2.4 3-3.5 5-3.5s3.8 1.1 5 3.5"}]],
  // Een postvak met iets erin: wat ligt te wachten op een beslissing.
  submissions: [["path", {d: "M4 13l2.5-8h11L20 13v6H4z"}], ["path", {d: "M4 13h5l1 2h4l1-2h5"}]],
};

const SVG_ATTRS = {
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.7",
  "stroke-linecap": "round", "stroke-linejoin": "round", width: "18", height: "18",
  "aria-hidden": "true",
};

// Elke aanroep een nieuwe knoop: een DOM-knoop kan maar op één plek hangen.
export function icon(key) { return svg(SVG_ATTRS, ICONS[key] || ICONS.overview); }
