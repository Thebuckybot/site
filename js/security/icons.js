// Minimal monochrome line icons (inherit currentColor via stroke) for the sidebar.
const S = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;

export const ICONS = {
  overview: S('<path d="M4 13h6V4H4zM14 20h6V4h-6zM4 20h6v-5H4z"/>'),
  incidents: S('<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>'),
  audit: S('<path d="M6 3h9l5 5v13H6z"/><path d="M9 12h7M9 16h7M9 8h4"/>'),
  analytics: S('<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>'),
  health: S('<path d="M3 12h4l2 5 4-12 2 7h6"/>'),
  modules: S('<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>'),
  thresholds: S('<path d="M4 8h16M8 4v8M4 16h16M16 12v8"/>'),
  punishments: S('<path d="M4 6h16M4 12h16M4 18h10"/><path d="M18 16l2 2-4 4"/>'),
  protection: S('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
  ignore: S('<path d="M4 4l16 16"/><path d="M12 5c5 0 8 4 9 7-.4 1-1 2-1.8 2.9M6 6.6C4.2 7.9 3.2 9.6 3 12c1 3 4 7 9 7 1.2 0 2.3-.2 3.3-.6"/>'),
  quarantine: S('<path d="M5 3h14v18l-7-3-7 3z"/><path d="M9 9h6M9 13h6"/>'),
  emergency: S('<path d="M12 3l9 16H3z"/><path d="M12 9v5M12 17h.01"/>'),
  snapshots: S('<path d="M4 7h4l2-2h4l2 2h4v12H4z"/><circle cx="12" cy="13" r="3"/>'),
  advanced: S('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
  settings: S('<circle cx="12" cy="12" r="3"/><path d="M4 12h2M18 12h2M12 4v2M12 18v2"/>'),
};

export function icon(key) { return ICONS[key] || ICONS.overview; }
