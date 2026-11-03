// Een tickettranscript, opgebouwd uit de JSON van /api/tickets/transcripts/<id>.
//
// ALLES WAT UIT HET TICKET KOMT GAAT ERIN ALS TEKST. Berichten, namen, embeds en
// bestandsnamen zijn door gebruikers geschreven. Er staat in dit bestand geen
// enkele `html:` en geen `innerHTML`; opmaak ontstaat door de tekst te KNIPPEN
// (js/transcript_md.js) en elk stuk in een eigen element te zetten. Twee scans
// bewaken dat: bucky1.0/tests/test_site_html_injectie.py (de regels) en
// bucky1.0/tests/test_transcript_pagina.py (de echte pagina met kwaadaardige invoer).
//
// ZOALS DISCORD (3-11-2026): donker, avatar en naam in de kleur van de hoogste
// rol, APP bij bots, berichten van dezelfde schrijver binnen 7 minuten samen,
// datumscheiding, (edited), antwoorden met de aangehaalde regel, systeemregels,
// embeds en Components V2-kaarten met uitgeschakelde knoppen, reacties.
// Snapshot versie 3 levert de extra gegevens (bucky1.0/cogs/tickets/
// transcript_data.py); versie 1 en 2 tekenen gewoon, met wat ze hebben.
//
// PLAATJES ALLEEN VAN DISCORD (transcript_md.mediaUrl, en de CSP van de pagina):
// een plaatje van een andere host laadt niet en wordt een plaatsvervanger, zodat
// het IP van de lezer niet bij een vreemde server terechtkomt.
//
// Toegang zit NIET hier: de backend beslist wie wat ziet (opener, staff, niemand).
import { API_URL } from "./config.js";
import { apiFetch } from "./dashboard.js";
import { el, clear } from "./security/ui.js";
import { markdown, inline, emojiEl, mediaUrl, veiligeUrl, link } from "./transcript_md.js";

const main = document.getElementById("tr-main");
const viewPill = document.getElementById("tr-view");

// Twee berichten van dezelfde persoon binnen zoveel minuten vormen één groep.
const GROEP_MINUTEN = 7;
// Zoveel berichten per keer op het scherm; de rest volgt bij het scrollen.
const STUK = 120;

function ticketId() {
  const id = new URLSearchParams(window.location.search).get("id") || "";
  return /^\d{1,20}$/.test(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Tijd
// ---------------------------------------------------------------------------
const lang = navigator.language || "en-GB";
const fmtTijd = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });
const fmtDag = new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric" });
const fmtVol = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" });
const fmtKort = new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short" });

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

function zelfdeDag(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Zoals Discord: "Today at 14:02", "Yesterday at 09:10", anders de korte datum.
function kopTijd(iso) {
  const d = datum(iso);
  if (!d) return el("span", { class: "tr-time" });
  const nu = new Date();
  const gisteren = new Date(nu.getTime() - 86400000);
  const tekst = zelfdeDag(d, nu) ? `Today at ${fmtTijd.format(d)}`
    : zelfdeDag(d, gisteren) ? `Yesterday at ${fmtTijd.format(d)}` : fmtKort.format(d);
  return el("time", { class: "tr-time", datetime: d.toISOString(), title: fmtVol.format(d), text: tekst });
}

function grootte(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  const eenheden = ["B", "KB", "MB", "GB"];
  let i = 0;
  let w = n;
  while (w >= 1024 && i < eenheden.length - 1) { w /= 1024; i++; }
  return `${w.toFixed(i ? 1 : 0)} ${eenheden[i]}`;
}

function hexKleur(n) {
  // Alleen een echt getal uit de snapshot wordt een kleur; al het andere geen.
  const g = typeof n === "number" ? n : NaN;
  return Number.isInteger(g) && g > 0 && g <= 0xFFFFFF ? "#" + g.toString(16).padStart(6, "0") : null;
}

// ---------------------------------------------------------------------------
// Context: wie is wie
// ---------------------------------------------------------------------------
let CTX = { refs: { users: {}, roles: {}, channels: {} }, namen: new Map() };

function persoonVan(id) {
  return (CTX.refs.users || {})[String(id)] || null;
}

function md(tekst, klasse) {
  return markdown(tekst, CTX, klasse);
}

// ---------------------------------------------------------------------------
// Onderdelen van een bericht
// ---------------------------------------------------------------------------
function initiaal(naam) {
  const t = String(naam || "?").trim();
  return (t[0] || "?").toUpperCase();
}

function avatar(bericht, klasse = "tr-avatar") {
  const val = el("span", { class: `${klasse} tr-avatar-fallback`, "aria-hidden": "true",
                           text: initiaal(bericht.display_name || bericht.author_name) });
  const url = mediaUrl(bericht.avatar_url);
  if (!url) return val;
  const img = el("img", { class: klasse, src: url, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
  img.addEventListener("error", () => img.replaceWith(val));
  return img;
}

function naamEl(bericht) {
  const p = persoonVan(bericht.author_id);
  const n = el("span", { class: "tr-author", text: bericht.display_name || bericht.author_name || "Unknown",
                         title: bericht.author_name ? `@${bericht.author_name}` : null });
  const k = hexKleur(p && p.color);
  if (k) n.style.color = k;
  return n;
}

function appLabel(bericht) {
  return bericht.is_bot || bericht.webhook ? el("span", { class: "tr-app", text: "APP" }) : null;
}

// Een plaatsvervanger voor iets dat niet (meer) te tonen is.
function plaatsvervanger(titel, uitleg, href) {
  return el("div", { class: "tr-file tr-file-gone" }, [
    el("span", { class: "tr-file-icon", "aria-hidden": "true", text: "⊘" }),
    el("div", { class: "tr-file-text" }, [
      href ? link(href, el("span", { class: "tr-file-name", text: titel })) : el("span", { class: "tr-file-name", text: titel }),
      el("span", { class: "tr-file-note", text: uitleg }),
    ]),
  ]);
}

function verlopen(b) {
  const d = datum(b.expires_at);
  return !!(d && d.getTime() < Date.now());
}

function metSpoiler(knoop, aan) {
  if (!aan) return knoop;
  const s = el("div", { class: "tr-spoiler-media", role: "button", tabindex: "0", "aria-label": "Spoiler, press to reveal" }, [
    knoop, el("span", { class: "tr-spoiler-label", text: "SPOILER" })]);
  const open = () => { s.classList.add("is-open"); s.removeAttribute("role"); s.removeAttribute("tabindex"); s.removeAttribute("aria-label"); };
  s.addEventListener("click", open, { once: true });
  s.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  return s;
}

function bijlage(b) {
  const naam = String(b.filename || "attachment").replace(/^SPOILER_/, "");
  const url = veiligeUrl(b.url);
  const maat = grootte(b.size);
  if (verlopen(b) || !url) {
    return plaatsvervanger(naam, "No longer available: Discord removes attachment links after about a day."
      + (maat ? ` (${maat})` : ""));
  }
  const rij = el("div", { class: "tr-file" }, [
    el("span", { class: "tr-file-icon", "aria-hidden": "true", text: "📄" }),
    el("div", { class: "tr-file-text" }, [
      link(url, el("span", { class: "tr-file-name", text: naam })),
      el("span", { class: "tr-file-note", text: [maat, b.content_type].filter(Boolean).join(" · ") }),
    ]),
  ]);
  const beeld = b.is_image ? mediaUrl(b.url) : null;
  if (!beeld) return rij;
  const attrs = { class: "tr-image", src: beeld, alt: b.description || naam, loading: "lazy", referrerpolicy: "no-referrer" };
  if (b.width && b.height) { attrs.width = String(b.width); attrs.height = String(b.height); }
  const img = el("img", attrs);
  const knoop = link(beeld, img);
  knoop.classList.add("tr-image-link");
  img.addEventListener("error", () => knoop.replaceWith(
    plaatsvervanger(naam, "This image could not be loaded; the link has probably expired.")));
  return metSpoiler(knoop, b.spoiler);
}

// Een plaatje uit een embed of kaart: alleen Discord-media, anders een melding.
function beeldOfMelding(url, klasse, alt = "") {
  const goed = mediaUrl(url);
  if (goed) {
    const img = el("img", { class: klasse, src: goed, alt, loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => img.replaceWith(el("span", { class: "tr-muted tr-small", text: "Image no longer available." })));
    return img;
  }
  const href = veiligeUrl(url);
  let host = "";
  try { host = new URL(url).hostname; } catch (_) { /* geen url */ }
  return href ? el("div", { class: "tr-ext-image" }, [
    el("span", { text: `Image from ${host || "another site"}, not loaded to protect your privacy. ` }),
    link(href, "Open it"),
  ]) : null;
}

function embed(e) {
  const delen = [];
  if (e.author && e.author.name) {
    const icoon = e.author.icon_url ? mediaUrl(e.author.icon_url) : null;
    const naam = veiligeUrl(e.author.url) ? link(veiligeUrl(e.author.url), e.author.name) : el("span", { text: e.author.name });
    delen.push(el("div", { class: "tr-embed-author" }, [
      icoon ? el("img", { class: "tr-embed-author-icon", src: icoon, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : null,
      naam]));
  }
  if (e.title) {
    const url = veiligeUrl(e.url);
    delen.push(url ? el("div", { class: "tr-embed-title" }, [link(url, inline(e.title, { ...CTX, geenLinks: true }))])
      : el("div", { class: "tr-embed-title" }, inline(e.title, CTX)));
  }
  if (e.description) delen.push(md(e.description, "tr-embed-desc"));
  const velden = (e.fields || []).map((f) => el("div", { class: "tr-embed-field" + (f.inline ? " is-inline" : "") }, [
    el("div", { class: "tr-embed-field-name" }, inline(f.name || "", CTX)),
    md(f.value || "", "tr-embed-field-value"),
  ]));
  if (velden.length) delen.push(el("div", { class: "tr-embed-fields" }, velden));
  if (e.image) { const b = beeldOfMelding(e.image, "tr-embed-image"); if (b) delen.push(b); }
  if (e.footer || e.timestamp) {
    delen.push(el("div", { class: "tr-embed-footer" }, [
      e.footer ? el("span", { text: e.footer }) : null,
      e.footer && e.timestamp ? el("span", { text: " • " }) : null,
      e.timestamp ? tijdEl(e.timestamp, fmtVol, "") : null,
    ]));
  }
  const duim = e.thumbnail ? beeldOfMelding(e.thumbnail, "tr-embed-thumb") : null;
  const kaart = el("div", { class: "tr-embed" }, [el("div", { class: "tr-embed-body" }, delen), duim]);
  const k = hexKleur(e.color);
  if (k) kaart.style.borderLeftColor = k;
  return kaart;
}

// ---------------------------------------------------------------------------
// Components V2 en knoppen, statisch
// ---------------------------------------------------------------------------
const KNOPSTIJL = { primary: "primary", secondary: "secondary", success: "success", danger: "danger",
                    link: "secondary", premium: "primary" };

function knop(k) {
  const href = k.url ? veiligeUrl(k.url) : null;
  return el("button", { class: `tr-button tr-button-${KNOPSTIJL[k.style] || "secondary"}`, type: "button",
                        disabled: "disabled", title: href ? `Link: ${href}` : "Buttons do not work in a transcript" }, [
    k.emoji ? emojiEl(k.emoji) : null,
    k.label ? el("span", { text: k.label }) : null,
    href ? el("span", { class: "tr-button-ext", "aria-hidden": "true", text: "↗" }) : null,
  ]);
}

function component(k) {
  if (!k || typeof k !== "object") return null;
  switch (k.type) {
    case "text": return md(k.content || "", "tr-text tr-v2-text");
    case "row": return el("div", { class: "tr-row" }, (k.children || []).map(component));
    case "button": return knop(k);
    case "select": return el("div", { class: "tr-select", text: k.placeholder || "Make a selection" });
    case "separator": return el("div", { class: `tr-sep${k.visible === false ? " is-invisible" : ""}${k.large ? " is-large" : ""}`, role: "separator" });
    case "section": {
      const rechts = k.accessory ? (k.accessory.type === "thumbnail"
        ? beeldOfMelding(k.accessory.url, "tr-v2-thumb") : component(k.accessory)) : null;
      return el("div", { class: "tr-section" }, [
        el("div", { class: "tr-section-main" }, (k.children || []).map(component)),
        rechts ? el("div", { class: "tr-section-accessory" }, [rechts]) : null,
      ]);
    }
    case "thumbnail": return beeldOfMelding(k.url, "tr-v2-thumb");
    case "gallery": return el("div", { class: "tr-gallery" }, (k.items || []).map((i) => {
      const b = beeldOfMelding(i.url, "tr-gallery-image");
      return b ? metSpoiler(b, i.spoiler) : null;
    }));
    case "file": return plaatsvervanger(k.name || "file", grootte(k.size) || "File");
    case "container": {
      const kaart = el("div", { class: "tr-v2" }, (k.children || []).map(component));
      const kleur = hexKleur(k.accent);
      if (kleur) kaart.style.borderLeftColor = kleur;
      return metSpoiler(kaart, k.spoiler);
    }
    default: return null;
  }
}

function reacties(lijst) {
  if (!lijst || !lijst.length) return null;
  return el("div", { class: "tr-reactions" }, lijst.map((r) => el("span", { class: "tr-reaction",
    title: r.emoji && r.emoji.name ? `:${r.emoji.name}:` : "" }, [emojiEl(r.emoji), el("span", { text: String(r.count || 0) })])));
}

function inhoud(bericht) {
  const delen = [];
  if (bericht.content) {
    const tekst = md(bericht.content);
    if (bericht.edited_at) {
      const laatste = tekst.lastElementChild || tekst;
      laatste.appendChild(el("span", { class: "tr-edited", title: `Edited ${fmtVol.format(datum(bericht.edited_at) || new Date())}`, text: " (edited)" }));
    }
    delen.push(tekst);
  }
  for (const b of bericht.attachments || []) delen.push(bijlage(b));
  for (const e of bericht.embeds || []) delen.push(embed(e));
  for (const c of bericht.components || []) { const n = component(c); if (n) delen.push(n); }
  for (const s of bericht.stickers || []) {
    const url = s.id && /^\d{15,20}$/.test(s.id) ? `https://media.discordapp.net/stickers/${s.id}.webp?size=160` : null;
    const plaat = url ? el("img", { class: "tr-sticker-img", src: url, alt: `Sticker: ${s.name || ""}`, loading: "lazy", referrerpolicy: "no-referrer" }) : null;
    const tekst = el("div", { class: "tr-sticker", text: `Sticker: ${s.name || "sticker"}` });
    if (plaat) plaat.addEventListener("error", () => plaat.replaceWith(tekst));
    delen.push(plaat || tekst);
  }
  const r = reacties(bericht.reactions);
  if (r) delen.push(r);
  if (!delen.length) delen.push(el("div", { class: "tr-text tr-muted", text: "No text content." }));
  return delen;
}

// De regel boven een antwoord: wie, en het begin van wat er stond.
function antwoordRegel(b) {
  const r = b.reply_to;
  if (!r) return null;
  if (r.deleted || !r.author_id) {
    return el("div", { class: "tr-reply" }, [el("span", { class: "tr-reply-spine", "aria-hidden": "true" }),
      el("span", { class: "tr-muted tr-small", text: "Original message was deleted" })]);
  }
  const p = persoonVan(r.author_id);
  const naam = el("span", { class: "tr-reply-name", text: "@" + (p ? p.name : r.author_name || "unknown") });
  const k = hexKleur(p && p.color);
  if (k) naam.style.color = k;
  const regel = el("button", { class: "tr-reply", type: "button", "aria-label": "Jump to the replied message" }, [
    el("span", { class: "tr-reply-spine", "aria-hidden": "true" }),
    naam,
    el("span", { class: "tr-reply-text" }, inline(String(r.content || "Click to see attachment").split("\n")[0], { ...CTX, geenLinks: true })),
  ]);
  regel.addEventListener("click", () => springNaar(r.message_id));
  return regel;
}

function interactieRegel(b) {
  const i = b.interaction;
  if (!i || !i.name) return null;
  return el("div", { class: "tr-reply" }, [
    el("span", { class: "tr-reply-spine", "aria-hidden": "true" }),
    el("span", { class: "tr-reply-name", text: i.user_name || "Someone" }),
    el("span", { class: "tr-muted", text: " used " }),
    el("span", { class: "tr-mention tr-mention-command", text: "/" + i.name }),
  ]);
}

// ---------------------------------------------------------------------------
// De stroom: dagscheiding, groepen per auteur, systeemmeldingen apart
// ---------------------------------------------------------------------------
function isSysteem(b) {
  return !!b.system;
}

function systeemRegel(b) {
  return el("li", { class: "tr-system", id: b.id ? `msg-${b.id}` : null }, [
    el("span", { class: "tr-system-icon", "aria-hidden": "true", text: "→" }),
    el("div", { class: "tr-system-body" }, [
      el("span", {}, inline(b.content || "", { ...CTX, geenLinks: true })),
      el("span", { class: "tr-system-time" }, [kopTijd(b.created_at)]),
    ]),
  ]);
}

function bericht(b, eerste) {
  const kop = eerste ? el("div", { class: "tr-msg-head" }, [naamEl(b), appLabel(b), kopTijd(b.created_at)]) : null;
  return el("div", { class: `tr-msg${eerste ? " is-first" : ""}`, id: b.id ? `msg-${b.id}` : null }, [
    eerste ? el("div", { class: "tr-msg-gutter" }, [avatar(b)])
      : el("div", { class: "tr-msg-gutter" }, [tijdEl(b.created_at, fmtTijd, "tr-hover-time")]),
    el("div", { class: "tr-msg-main" }, [kop, ...inhoud(b)]),
  ]);
}

function groep(berichten) {
  const delen = [];
  berichten.forEach((b, i) => {
    const voor = antwoordRegel(b) || interactieRegel(b);
    if (voor) delen.push(voor);
    delen.push(bericht(b, i === 0));
  });
  return el("li", { class: "tr-group" }, delen);
}

// Alles wat getekend moet worden, als lijst van stukjes; het tekenen gaat in
// porties (STUK berichten), zodat een transcript van 3000 berichten niet in één
// keer duizenden knopen bouwt.
function stukken(berichten) {
  const uit = [];
  let dag = null;
  let huidig = [];
  const sluit = () => { if (huidig.length) uit.push({ soort: "groep", berichten: huidig }); huidig = []; };
  for (const b of berichten) {
    const d = datum(b.created_at);
    const dagSleutel = d ? d.toDateString() : "";
    if (dagSleutel !== dag) {
      sluit();
      dag = dagSleutel;
      if (d) uit.push({ soort: "dag", datum: d });
    }
    if (isSysteem(b)) { sluit(); uit.push({ soort: "systeem", bericht: b }); continue; }
    const vorige = huidig[huidig.length - 1];
    const zelfde = vorige && vorige.author_id === b.author_id && !b.reply_to && !b.interaction
      && datum(b.created_at) && datum(vorige.created_at)
      && (datum(b.created_at) - datum(vorige.created_at)) < GROEP_MINUTEN * 60000;
    if (!zelfde) sluit();
    huidig.push(b);
  }
  sluit();
  return uit;
}

function tekenStuk(s) {
  if (s.soort === "dag") return el("li", { class: "tr-day", role: "separator" }, [el("span", { text: fmtDag.format(s.datum) })]);
  if (s.soort === "systeem") return systeemRegel(s.bericht);
  return groep(s.berichten);
}

let rest = [];
let lijstEl = null;
let wachter = null;

function tekenVolgende() {
  let teller = 0;
  const fragment = document.createDocumentFragment();
  while (rest.length && teller < STUK) {
    const s = rest.shift();
    teller += s.soort === "groep" ? s.berichten.length : 1;
    fragment.appendChild(tekenStuk(s));
  }
  lijstEl.appendChild(fragment);
  if (!rest.length && wachter) { wachter.remove(); wachter = null; }
}

function springNaar(id) {
  if (!id) return;
  let doel = document.getElementById(`msg-${id}`);
  while (!doel && rest.length) { tekenVolgende(); doel = document.getElementById(`msg-${id}`); }
  if (!doel) return;
  doel.scrollIntoView({ block: "center", behavior: "smooth" });
  doel.classList.add("is-flash");
  setTimeout(() => doel.classList.remove("is-flash"), 1600);
}

function stroom(berichten) {
  lijstEl = el("ol", { class: "tr-stream", "aria-label": "Messages" });
  rest = stukken(berichten);
  if (!berichten.length) {
    lijstEl.appendChild(el("li", { class: "tr-empty", text: "No messages were recorded in this ticket." }));
    return [lijstEl];
  }
  tekenVolgende();
  if (!rest.length) return [lijstEl];
  const meer = el("button", { class: "tr-btn tr-more", type: "button", text: "Show more messages" });
  meer.addEventListener("click", tekenVolgende);
  wachter = el("div", { class: "tr-more-wrap" }, [meer]);
  if ("IntersectionObserver" in window) {
    const kijker = new IntersectionObserver((ingangen) => {
      if (ingangen.some((i) => i.isIntersecting)) tekenVolgende();
      if (!wachter) kijker.disconnect();
    }, { rootMargin: "800px 0px" });
    kijker.observe(wachter);
  }
  return [lijstEl, wachter];
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
        `This transcript is deleted on ${fmtVol.format(verloopt)}, 48 hours after the ticket closed.`,
      ])
    : null;
  return el("section", { class: "tr-card tr-head", "aria-label": "Ticket details" }, [titel, plaats, feiten, deelnemers, bewaar]);
}

// DE OPENING (snapshot versie 2): welkomsttekst en formulierantwoorden. Vanaf
// versie 3 staat het ticketpaneel zelf in de berichten, en dan is dit dubbel.
function opening(data) {
  const o = data.opening;
  if ((data.version || 1) >= 3) return null;
  if (!o || (!o.welcome_text && !(o.answers || []).length)) return null;
  const delen = [el("h2", { text: "How the ticket opened" })];
  if (o.welcome_text) delen.push(el("p", { class: "tr-opening-welcome", text: o.welcome_text }));
  const antwoorden = (o.answers || []).filter((a) => a && typeof a === "object");
  if (antwoorden.length) {
    delen.push(el("dl", { class: "tr-answers" }, antwoorden.flatMap((a) => [
      el("dt", { text: String(a.label || "Question") }),
      el("dd", { text: String(a.answer || "(no answer)") }),
    ])));
  }
  return el("section", { class: "tr-card tr-opening", "aria-label": "How the ticket opened" }, delen);
}

function notities(data) {
  if (data.view !== "staff") return null;
  const lijst = (data.notes || []).map((n) => el("li", { class: "tr-note" }, [
    el("div", { class: "tr-note-head" }, [
      el("span", { class: "tr-author", text: n.author_name || "Staff" }),
      tijdEl(n.created_at, fmtVol),
    ]),
    md(n.content || ""),
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
function toestand(titel, tekst, knopEl) {
  clear(main);
  main.setAttribute("aria-busy", "false");
  main.appendChild(el("section", { class: "tr-card tr-state-card" }, [
    el("h1", { text: titel }),
    el("p", { text: tekst }),
    knopEl || null,
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

  // Namen voor vermeldingen: eerst wat de snapshot (versie 3) meegeeft, anders
  // wat er uit de berichten zelf te halen valt.
  const namen = new Map();
  const zet = (p) => { if (p && p.id) namen.set(String(p.id), p.display || p.name || "user"); };
  zet(data.owner); zet(data.claimer); zet(data.closer);
  for (const p of data.participants || []) if (p.id) namen.set(String(p.id), p.name || "user");
  for (const b of data.messages || []) if (b.author_id && !namen.has(String(b.author_id))) namen.set(String(b.author_id), b.display_name || b.author_name || "user");
  const refs = (data.refs && typeof data.refs === "object") ? data.refs : {};
  CTX = { refs: { users: refs.users || {}, roles: refs.roles || {}, channels: refs.channels || {} }, namen };

  main.appendChild(kop(data));
  const o = opening(data);
  if (o) main.appendChild(o);
  const n = notities(data);
  if (n) main.appendChild(n);
  main.appendChild(el("section", { class: "tr-conversation", "aria-label": "Conversation" }, stroom(data.messages || [])));
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
