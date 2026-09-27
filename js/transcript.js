// Een tickettranscript, opgebouwd uit de JSON van /api/tickets/transcripts/<id>.
//
// ALLES WAT UIT HET TICKET KOMT GAAT ERIN ALS TEKST. Berichten, namen, embeds en
// bestandsnamen zijn door gebruikers geschreven. Er staat in dit bestand geen
// enkele `html:` en geen `innerHTML`; opmaak (code, vermeldingen, links) ontstaat
// door de tekst te KNIPPEN en elk stuk in een eigen element te zetten, zoals
// js/server/welcome_preview.js dat doet. Twee scans bewaken dat:
// bucky1.0/tests/test_site_html_injectie.py (de regels) en
// bucky1.0/tests/test_transcript_pagina.py (de echte pagina met kwaadaardige invoer).
//
// Toegang zit NIET hier: de backend beslist wie wat ziet (opener, staff, niemand).
// Deze pagina toont alleen wat hij terugkrijgt.
import { API_URL } from "./config.js";
import { apiFetch } from "./dashboard.js";
import { el, clear } from "./security/ui.js";

const main = document.getElementById("tr-main");
const viewPill = document.getElementById("tr-view");

// Twee berichten van dezelfde persoon binnen zoveel minuten vormen één groep,
// zoals Discord ze toont.
const GROEP_MINUTEN = 7;


function ticketId() {
  const id = new URLSearchParams(window.location.search).get("id") || "";
  return /^\d{1,20}$/.test(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Tijd
// ---------------------------------------------------------------------------
const lang = navigator.language || "en-GB";
const fmtTijd = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });
const fmtDag = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtVol = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" });

function datum(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function tijdEl(iso, fmt = fmtTijd, klasse = "tr-time") {
  const d = datum(iso);
  if (!d) return el("span", { class: klasse, text: "" });
  return el("time", { class: klasse, datetime: d.toISOString(), title: fmtVol.format(d), text: fmt.format(d) });
}

// ---------------------------------------------------------------------------
// Tekst knippen: code, vermeldingen, tijdstempels, links. Nooit innerHTML.
// ---------------------------------------------------------------------------
function veiligeUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch (_) {
    return null;
  }
}

function inline(tekst, namen) {
  const uit = [];
  // Volgorde telt: inline code eerst, dan de Discord-tokens, dan kale links.
  const patroon = /(`[^`\n]+`)|<@!?(\d{5,20})>|<@&(\d{5,20})>|<#(\d{5,20})>|<t:(-?\d{1,12})(?::[tTdDfFR])?>|(https?:\/\/[^\s<>"']+)/g;
  let pos = 0;
  let m;
  while ((m = patroon.exec(tekst)) !== null) {
    if (m.index > pos) uit.push(document.createTextNode(tekst.slice(pos, m.index)));
    if (m[1]) {
      uit.push(el("code", { class: "tr-code", text: m[1].slice(1, -1) }));
    } else if (m[2]) {
      uit.push(el("span", { class: "tr-mention", text: "@" + (namen.get(m[2]) || "user") }));
    } else if (m[3]) {
      uit.push(el("span", { class: "tr-mention", text: "@role" }));
    } else if (m[4]) {
      uit.push(el("span", { class: "tr-mention", text: "#channel" }));
    } else if (m[5]) {
      const d = new Date(Number(m[5]) * 1000);
      uit.push(el("span", { class: "tr-chip", title: fmtVol.format(d), text: fmtVol.format(d) }));
    } else if (m[6]) {
      const href = veiligeUrl(m[6]);
      uit.push(href
        ? el("a", { href, target: "_blank", rel: "noopener noreferrer nofollow", text: m[6] })
        : document.createTextNode(m[6]));
    }
    pos = m.index + m[0].length;
  }
  if (pos < tekst.length) uit.push(document.createTextNode(tekst.slice(pos)));
  return uit;
}

function opgemaakt(tekst, namen, klasse = "tr-text") {
  const blok = el("div", { class: klasse });
  const delen = String(tekst || "").split(/```(?:[\w+-]{0,20}\n)?/);
  delen.forEach((deel, i) => {
    if (i % 2 === 1) {
      blok.appendChild(el("pre", { class: "tr-pre" }, [el("code", { text: deel.replace(/\n$/, "") })]));
    } else if (deel) {
      for (const knoop of inline(deel, namen)) blok.appendChild(knoop);
    }
  });
  return blok;
}

// ---------------------------------------------------------------------------
// Onderdelen van een bericht
// ---------------------------------------------------------------------------
function initiaal(naam) {
  const t = String(naam || "?").trim();
  return (t[0] || "?").toUpperCase();
}

function avatar(bericht) {
  const url = veiligeUrl(bericht.avatar_url);
  const val = el("span", { class: "tr-avatar tr-avatar-fallback", "aria-hidden": "true", text: initiaal(bericht.display_name || bericht.author_name) });
  if (!url) return val;
  const img = el("img", { class: "tr-avatar", src: url, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
  img.addEventListener("error", () => img.replaceWith(val));
  return img;
}

function bijlage(b) {
  const url = veiligeUrl(b.url);
  const naam = String(b.filename || "attachment");
  const kaart = el("div", { class: "tr-file" }, [
    el("span", { class: "tr-file-icon", "aria-hidden": "true", text: "📄" }),
    url
      ? el("a", { class: "tr-file-name", href: url, target: "_blank", rel: "noopener noreferrer nofollow", text: naam })
      : el("span", { class: "tr-file-name", text: naam }),
    el("span", { class: "tr-file-note", text: "Discord removes attachment links after about a day." }),
  ]);
  if (!b.is_image || !url) return kaart;
  // Een afbeelding zolang de link van Discord nog werkt; daarna de kaart.
  const img = el("img", { class: "tr-image", src: url, alt: naam, loading: "lazy", referrerpolicy: "no-referrer" });
  const link = el("a", { class: "tr-image-link", href: url, target: "_blank", rel: "noopener noreferrer nofollow" }, [img]);
  img.addEventListener("error", () => link.replaceWith(kaart));
  return link;
}

function embed(e, namen) {
  const delen = [];
  if (e.title) {
    const url = veiligeUrl(e.url);
    delen.push(url
      ? el("a", { class: "tr-embed-title", href: url, target: "_blank", rel: "noopener noreferrer nofollow", text: e.title })
      : el("div", { class: "tr-embed-title", text: e.title }));
  }
  if (e.description) delen.push(opgemaakt(e.description, namen, "tr-embed-desc"));
  const velden = (e.fields || []).map((f) => el("div", { class: "tr-embed-field" }, [
    el("div", { class: "tr-embed-field-name", text: f.name || "" }),
    opgemaakt(f.value || "", namen, "tr-embed-field-value"),
  ]));
  if (velden.length) delen.push(el("div", { class: "tr-embed-fields" }, velden));
  if (e.footer) delen.push(el("div", { class: "tr-embed-footer", text: e.footer }));
  return el("div", { class: "tr-embed" }, delen);
}

function inhoud(bericht, namen) {
  const delen = [];
  if (bericht.content) delen.push(opgemaakt(bericht.content, namen));
  for (const b of bericht.attachments || []) delen.push(bijlage(b));
  for (const e of bericht.embeds || []) delen.push(embed(e, namen));
  for (const s of bericht.stickers || []) delen.push(el("div", { class: "tr-sticker", text: `Sticker: ${s.name || "sticker"}` }));
  if (!delen.length) delen.push(el("div", { class: "tr-text tr-muted", text: "No text content." }));
  return delen;
}

// ---------------------------------------------------------------------------
// De stroom: dagscheiding, groepen per auteur, systeemmeldingen apart
// ---------------------------------------------------------------------------
function isSysteem(b) {
  return !!(b.system || b.is_bot);
}

function systeemRegel(b, namen) {
  return el("li", { class: "tr-system" }, [
    el("span", { class: "tr-system-icon", "aria-hidden": "true", text: b.system ? "›" : "⚙" }),
    el("div", { class: "tr-system-body" }, [
      el("div", { class: "tr-system-head" }, [
        el("span", { class: "tr-system-name", text: b.display_name || b.author_name || "System" }),
        b.is_bot ? el("span", { class: "tr-tag", text: "BOT" }) : null,
        tijdEl(b.created_at),
      ]),
      ...inhoud(b, namen),
    ]),
  ]);
}

function groep(berichten, namen, rolVan) {
  const eerste = berichten[0];
  const rol = rolVan(eerste.author_id);
  const kop = el("div", { class: "tr-group-head" }, [
    el("span", { class: "tr-author", text: eerste.display_name || eerste.author_name || "Unknown" }),
    rol ? el("span", { class: `tr-role tr-role-${rol.key}`, text: rol.label }) : null,
    // Alleen de tijd: de dagscheiding erboven noemt de datum al. De volle
    // datum staat in de title, net als bij Discord.
    tijdEl(eerste.created_at),
  ]);
  const regels = berichten.map((b, i) => el("div", { class: "tr-line" }, [
    i === 0 ? null : tijdEl(b.created_at, fmtTijd, "tr-line-time"),
    el("div", { class: "tr-line-body" }, inhoud(b, namen)),
  ]));
  return el("li", { class: "tr-group" }, [
    el("div", { class: "tr-group-avatar" }, [avatar(eerste)]),
    el("div", { class: "tr-group-main" }, [kop, ...regels]),
  ]);
}

function stroom(berichten, namen, rolVan) {
  const lijst = el("ol", { class: "tr-stream", "aria-label": "Messages" });
  let dag = null;
  let huidig = [];
  const sluitGroep = () => {
    if (huidig.length) lijst.appendChild(groep(huidig, namen, rolVan));
    huidig = [];
  };
  for (const b of berichten) {
    const d = datum(b.created_at);
    const dagSleutel = d ? d.toDateString() : "";
    if (dagSleutel !== dag) {
      sluitGroep();
      dag = dagSleutel;
      if (d) lijst.appendChild(el("li", { class: "tr-day", role: "separator" }, [el("span", { text: fmtDag.format(d) })]));
    }
    if (isSysteem(b)) {
      sluitGroep();
      lijst.appendChild(systeemRegel(b, namen));
      continue;
    }
    const vorige = huidig[huidig.length - 1];
    const zelfde = vorige && vorige.author_id === b.author_id
      && datum(b.created_at) && datum(vorige.created_at)
      && (datum(b.created_at) - datum(vorige.created_at)) < GROEP_MINUTEN * 60000;
    if (!zelfde) sluitGroep();
    huidig.push(b);
  }
  sluitGroep();
  if (!berichten.length) lijst.appendChild(el("li", { class: "tr-empty", text: "No messages were recorded in this ticket." }));
  return lijst;
}

// ---------------------------------------------------------------------------
// De kop
// ---------------------------------------------------------------------------
function persoon(p) {
  if (!p) return el("span", { class: "tr-muted", text: "Nobody" });
  return el("span", { class: "tr-person", title: p.name ? `@${p.name}` : "" }, [p.display || p.name || "Unknown"]);
}

function feit(label, waarde, onder) {
  return el("div", { class: "tr-fact" }, [
    el("dt", { text: label }),
    el("dd", {}, [waarde, onder ? el("div", { class: "tr-fact-sub" }, [onder]) : null]),
  ]);
}

function kop(data) {
  const t = data.ticket || {};
  const titel = el("div", { class: "tr-head-title" }, [
    el("h1", { text: `Ticket #${t.id ?? ""}` }),
    el("span", { class: "tr-type", text: t.type_label || "Ticket" }),
  ]);
  const plaats = el("p", { class: "tr-head-sub" }, [
    t.guild_name || "",
    t.channel_name ? el("span", { class: "tr-muted", text: `  ·  #${t.channel_name}` }) : null,
  ]);
  const feiten = el("dl", { class: "tr-facts" }, [
    feit("Opened by", persoon(data.owner), tijdEl(t.created_at, fmtVol, "tr-muted")),
    feit("Handled by", persoon(data.claimer), t.claimed_at ? tijdEl(t.claimed_at, fmtVol, "tr-muted") : null),
    feit("Closed by", persoon(data.closer), tijdEl(data.closed_at || t.closed_at, fmtVol, "tr-muted")),
    feit("Messages", el("span", { text: String(t.message_count ?? (data.messages || []).length) }),
      t.reopen_count ? el("span", { class: "tr-muted", text: `Reopened ${t.reopen_count}×` }) : null),
  ]);
  const deelnemers = (data.participants || []).length
    ? el("p", { class: "tr-participants" }, [
        el("span", { class: "tr-muted", text: "Also in this ticket: " }),
        (data.participants || []).map((p) => p.name || "user").join(", "),
      ])
    : null;
  const verloopt = datum(data.expires_at);
  const bewaar = verloopt
    ? el("p", { class: "tr-retention" }, [
        el("span", { "aria-hidden": "true", text: "⏳ " }),
        `This transcript is deleted on ${fmtVol.format(verloopt)}, 48 hours after the ticket closed.`,
      ])
    : null;
  return el("section", { class: "tr-card tr-head", "aria-label": "Ticket details" }, [titel, plaats, feiten, deelnemers, bewaar]);
}

function notities(data) {
  if (data.view !== "staff") return null;
  const lijst = (data.notes || []).map((n) => el("li", { class: "tr-note" }, [
    el("div", { class: "tr-note-head" }, [
      el("span", { class: "tr-author", text: n.author_name || "Staff" }),
      tijdEl(n.created_at, fmtVol),
    ]),
    opgemaakt(n.content || "", new Map()),
  ]));
  return el("section", { class: "tr-card tr-notes", "aria-label": "Staff notes" }, [
    el("h2", { text: "Staff notes" }),
    el("p", { class: "tr-notes-warn", text: "Only staff see these. The person who opened the ticket does not." }),
    lijst.length ? el("ul", { class: "tr-note-list" }, lijst) : el("p", { class: "tr-muted", text: "No staff notes were added." }),
  ]);
}

// ---------------------------------------------------------------------------
// Toestanden
// ---------------------------------------------------------------------------
function toestand(titel, tekst, knop) {
  clear(main);
  main.setAttribute("aria-busy", "false");
  main.appendChild(el("section", { class: "tr-card tr-state-card" }, [
    el("h1", { text: titel }),
    el("p", { text: tekst }),
    knop || null,
  ]));
}

// Na het inloggen stuurt de backend je terug naar deze pagina. Hij neemt alleen
// een pagina van de site zelf aan (services/sessions.py, safe_return_path).
function loginKnop(id) {
  const terug = encodeURIComponent(`transcript.html?id=${id}`);
  return el("a", { class: "tr-btn", href: `${API_URL}/login?redirect=${terug}`, text: "Log in with Discord" });
}

function toon(data) {
  clear(main);
  main.setAttribute("aria-busy", "false");
  document.title = `Ticket #${(data.ticket || {}).id ?? ""} · Bucky`;

  viewPill.hidden = false;
  viewPill.textContent = data.view === "staff" ? "Staff view" : "Your copy";
  viewPill.classList.toggle("tr-pill-staff", data.view === "staff");

  const namen = new Map();
  const rollen = new Map();
  const zet = (p, key, label) => {
    if (!p || !p.id) return;
    namen.set(String(p.id), p.display || p.name || "user");
    if (!rollen.has(String(p.id))) rollen.set(String(p.id), { key, label });
  };
  zet(data.owner, "owner", "Opened the ticket");
  zet(data.claimer, "staff", "Staff");
  zet(data.closer, "staff", "Staff");
  for (const p of data.participants || []) if (p.id) namen.set(String(p.id), p.name || "user");
  for (const b of data.messages || []) if (b.author_id && !namen.has(String(b.author_id))) namen.set(String(b.author_id), b.display_name || b.author_name || "user");

  main.appendChild(kop(data));
  const n = notities(data);
  if (n) main.appendChild(n);
  main.appendChild(el("section", { class: "tr-card tr-conversation", "aria-label": "Conversation" }, [
    stroom(data.messages || [], namen, (id) => rollen.get(String(id)) || null),
  ]));
}

async function start() {
  const id = ticketId();
  if (!id) {
    toestand("No ticket chosen", "This link is missing its ticket number. Use the button in the message Bucky sent you.");
    return;
  }
  let res;
  try {
    res = await apiFetch(`${API_URL}/api/tickets/transcripts/${id}`);
  } catch (_) {
    toestand("Could not reach Bucky", "The website cannot reach the server right now. Try again in a minute.");
    return;
  }
  let body = {};
  try { body = await res.json(); } catch (_) { /* geen JSON */ }

  if (res.status === 401) {
    toestand("Log in to read this transcript",
      "Transcripts are private. Log in with the Discord account that opened the ticket, or as staff of the server.",
      loginKnop(id));
    return;
  }
  if (res.status === 404) {
    toestand("Transcript not available", (body.error && body.error.message)
      || "This transcript does not exist, was deleted, or is not yours to see.");
    return;
  }
  if (res.status === 429) {
    toestand("Slow down", "Too many requests in a short time. Try again in a minute.");
    return;
  }
  if (!res.ok || body.ok === false || !body.data) {
    toestand("Something went wrong", "The transcript could not be loaded. Try again in a minute.");
    return;
  }
  toon(body.data);
}

start();
