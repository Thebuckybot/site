// De iconen van het Server Center. Zelfde vorm als js/security/icons.js: kale
// SVG-paden als CONSTANTEN, zodat `html:` in de bouwer nooit iets anders dan
// vaste tekst krijgt.
const S = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round" width="18" height="18"
        aria-hidden="true">${body}</svg>`;

export const ICONS = {
  overview: S('<path d="M4 13h6V4H4zM14 20h6V4h-6zM4 20h6v-5H4z"/>'),
  // Een prompt-teken: commando's zijn getypte tekst.
  commands: S('<path d="M4 5h16v14H4z"/><path d="M8 10l2.5 2L8 14"/><path d="M13 14h3"/>'),
  // Een strookje met een scheur: een ticket.
  tickets: S('<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2"/>'),
  // Een formulier met regels en een vinkje.
  applications: S('<path d="M6 3h9l5 5v13H6z"/><path d="M9 12h6M9 16h4"/><path d="M9 8h3"/>'),
  // Een postvak met iets erin: wat ligt te wachten op een beslissing.
  submissions: S('<path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>'),
};

export function icon(key) { return ICONS[key] || ICONS.overview; }
