// Discord-markdown naar DOM, voor de transcriptpagina (3-11-2026).
//
// GEEN HTML-PARSER, NERGENS. De tekst wordt geknipt in stukjes; elk stukje wordt
// een element via `el(..., { text })` of een tekstknoop. Een `<script>` in een
// bericht blijft dus de letters `<script>`. Er staat in dit bestand geen
// `innerHTML` en geen `html:` (bucky1.0/tests/test_site_html_injectie.py).
//
// WAT HIJ KAN, zoals Discord: **vet**, *cursief* en _cursief_, __onderstreept__,
// ~~doorgestreept~~, `code`, ```codeblokken```, > citaten en >>> citaat tot het
// eind, lijsten (- * 1.), koppen (# ## ###), -# kleine tekst, ||spoilers||
// (klikbaar), [gemaskeerde links](https://...), kale links, <@gebruiker>,
// <@&rol>, <#kanaal>, @everyone/@here, </commando:id>, <t:tijdstempel:stijl>,
// eigen emoji <:naam:id> en \escapes.
//
// LINKS: alleen http(s); altijd target=_blank en rel="noopener noreferrer
// nofollow". PLAATJES: alleen van Discord (cdn.discordapp.com en
// media.discordapp.net, ook in de CSP); een ander adres laadt nooit, zodat het
// IP van de lezer niet bij een vreemde server terechtkomt.
import { el } from "./security/ui.js";

export const MEDIA_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];

export function veiligeUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch (_) {
    return null;
  }
}

// Een plaatje mag alleen van Discord komen, en alleen over https.
export function mediaUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && MEDIA_HOSTS.includes(u.hostname) ? u.href : null;
  } catch (_) {
    return null;
  }
}

export function link(href, kinderen, titel) {
  return el("a", { href, target: "_blank", rel: "noopener noreferrer nofollow", title: titel || null },
    [].concat(kinderen));
}

const lang = (typeof navigator !== "undefined" && navigator.language) || "en-GB";
const TIJD_STIJL = {
  t: { timeStyle: "short" }, T: { timeStyle: "medium" }, d: { dateStyle: "short" },
  D: { dateStyle: "long" }, f: { dateStyle: "long", timeStyle: "short" },
  F: { dateStyle: "full", timeStyle: "short" },
};

function relatief(d) {
  const sec = Math.round((d.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const stappen = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [eenheid, s] of stappen) if (Math.abs(sec) >= s) return rtf.format(Math.round(sec / s), eenheid);
  return rtf.format(sec, "second");
}

function hexKleur(n) {
  // Alleen een echt getal uit de snapshot wordt een kleur; al het andere geen.
  const g = typeof n === "number" ? n : NaN;
  return Number.isInteger(g) && g > 0 && g <= 0xFFFFFF ? "#" + g.toString(16).padStart(6, "0") : null;
}

// Een chip voor een vermelding. `kleur` komt als getal uit de snapshot en gaat
// als CSS-kleur via de CSSOM (geen style-attribuut in de HTML, CSP blijft strikt).
function chip(tekst, klasse, kleur) {
  const n = el("span", { class: `tr-mention ${klasse}`, text: tekst });
  const k = hexKleur(kleur);
  if (k) { n.style.color = k; n.style.backgroundColor = k + "26"; }
  return n;
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------
// Elke regel: [naam, regex (sticky), maak(m, ctx, diepte) -> Node | Node[]].
// De volgorde is die van Discord: escape, code, dan opmaak, dan tokens.
const REGELS = [
  ["escape", /\\([^0-9A-Za-z\s])/y, (m) => document.createTextNode(m[1])],
  ["code", /(`+)([\s\S]*?[^`])\1(?!`)/y, (m) => el("code", { class: "tr-code", text: m[2] })],
  ["spoiler", /\|\|([\s\S]+?)\|\|/y, (m, ctx, d) => spoiler(inline(m[1], ctx, d + 1))],
  ["bold", /\*\*([\s\S]+?)\*\*(?!\*)/y, (m, ctx, d) => el("strong", {}, inline(m[1], ctx, d + 1))],
  ["underline", /__([\s\S]+?)__(?!_)/y, (m, ctx, d) => el("u", {}, inline(m[1], ctx, d + 1))],
  ["em", /\*(?=\S)((?:\*\*|\\[\s\S]|\s+(?:\\[\s\S]|[^\s*\\]|\*\*)|[^\s*\\])+?)\*(?!\*)/y,
    (m, ctx, d) => el("em", {}, inline(m[1], ctx, d + 1))],
  ["em_", /_((?:__|\\[\s\S]|[^\\_])+?)_(?![A-Za-z0-9_])/y, (m, ctx, d) => el("em", {}, inline(m[1], ctx, d + 1))],
  ["strike", /~~([\s\S]+?)~~/y, (m, ctx, d) => el("s", {}, inline(m[1], ctx, d + 1))],
  ["masked", /\[((?:\[[^\]]*\]|[^[\]])*)\]\(\s*<?((?:\([^)\s]*\)|[^\s\\()<>])*?)>?\s*\)/y, (m, ctx, d) => {
    const href = veiligeUrl(m[2]);
    const tekst = inline(m[1], { ...ctx, geenLinks: true }, d + 1);
    return href && !ctx.geenLinks ? link(href, tekst, href) : [document.createTextNode(m[0])];
  }],
  ["autolink", /<(https?:\/\/[^\s>]+)>/y, (m, ctx) => {
    const href = veiligeUrl(m[1]);
    return href && !ctx.geenLinks ? link(href, m[1]) : document.createTextNode(m[1]);
  }],
  ["url", /https?:\/\/[^\s<]+[^<.,:;"')\]\s]/y, (m, ctx) => {
    const href = veiligeUrl(m[0]);
    return href && !ctx.geenLinks ? link(href, m[0]) : document.createTextNode(m[0]);
  }],
  ["user", /<@!?(\d{15,20})>/y, (m, ctx) => {
    const u = (ctx.refs.users || {})[m[1]];
    const naam = u ? u.name : (ctx.namen && ctx.namen.get(m[1])) || "unknown-user";
    return chip("@" + naam, "tr-mention-user");
  }],
  ["role", /<@&(\d{15,20})>/y, (m, ctx) => {
    const r = (ctx.refs.roles || {})[m[1]];
    return chip("@" + (r ? r.name : "deleted-role"), "tr-mention-role", r && r.color);
  }],
  ["channel", /<#(\d{15,20})>/y, (m, ctx) => {
    const c = (ctx.refs.channels || {})[m[1]];
    return chip(c ? "#" + c.name : "#unknown", "tr-mention-channel");
  }],
  ["everyone", /@(everyone|here)(?![A-Za-z0-9_])/y, (m) => chip("@" + m[1], "tr-mention-role")],
  ["command", /<\/([\w-]{1,32}(?: [\w-]{1,32}){0,2}):\d{15,20}>/y, (m) => chip("/" + m[1], "tr-mention-command")],
  ["time", /<t:(-?\d{1,13})(?::([tTdDfFR]))?>/y, (m) => {
    const d = new Date(Number(m[1]) * 1000);
    if (Number.isNaN(d.getTime())) return document.createTextNode(m[0]);
    const stijl = m[2] || "f";
    const tekst = stijl === "R" ? relatief(d) : new Intl.DateTimeFormat(lang, TIJD_STIJL[stijl]).format(d);
    return el("time", { class: "tr-timestamp", datetime: d.toISOString(),
                        title: new Intl.DateTimeFormat(lang, TIJD_STIJL.F).format(d), text: tekst });
  }],
  ["emoji", /<(a?):(\w{2,32}):(\d{15,20})>/y, (m, ctx) => emojiEl({ name: m[2], id: m[3], animated: !!m[1] }, ctx.jumbo)],
];

// Waar een regel kan beginnen. Alles daartussen is gewone tekst; zo hoeft niet
// bij elk teken elke regel geprobeerd te worden (een lang transcript blijft snel).
const STARTERS = new Set(["\\", "`", "|", "*", "_", "~", "[", "<", "h", "@"]);

export function emojiEl(e, jumbo = false) {
  if (!e) return null;
  if (e.id && /^\d{15,20}$/.test(String(e.id))) {
    const url = `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "webp"}?size=${jumbo ? 96 : 48}`;
    const naam = `:${String(e.name || "emoji")}:`;
    const img = el("img", { class: "tr-emoji" + (jumbo ? " tr-emoji-jumbo" : ""), src: url, alt: naam, title: naam,
                            loading: "lazy", referrerpolicy: "no-referrer", draggable: "false" });
    img.addEventListener("error", () => img.replaceWith(document.createTextNode(naam)));
    return img;
  }
  return el("span", { class: "tr-emoji-text" + (jumbo ? " tr-emoji-jumbo" : ""), text: String(e.name || "") });
}

function spoiler(kinderen) {
  const s = el("span", { class: "tr-spoiler", role: "button", tabindex: "0", "aria-expanded": "false",
                         "aria-label": "Spoiler, press to reveal" }, [].concat(kinderen));
  const open = () => {
    s.classList.add("is-open");
    s.setAttribute("aria-expanded", "true");
    s.removeAttribute("role");
    s.removeAttribute("tabindex");
    s.removeAttribute("aria-label");
  };
  s.addEventListener("click", open);
  s.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  return s;
}

const MAX_DIEPTE = 8;

export function inline(tekst, ctx = {}, diepte = 0) {
  ctx = { refs: {}, ...ctx };
  const uit = [];
  let buffer = "";
  const spoel = () => {
    if (!buffer) return;
    const delen = buffer.split("\n");
    delen.forEach((deel, i) => {
      if (i) uit.push(el("br"));
      if (deel) uit.push(document.createTextNode(deel));
    });
    buffer = "";
  };
  if (diepte > MAX_DIEPTE) return [document.createTextNode(tekst)];
  let i = 0;
  while (i < tekst.length) {
    const ch = tekst[i];
    let gevonden = false;
    if (STARTERS.has(ch)) {
      for (const [naam, re, maak] of REGELS) {
        // _cursief_ alleen aan het begin van een woord, zoals Discord (\b_).
        if (naam === "em_" && i > 0 && /[A-Za-z0-9_]/.test(tekst[i - 1])) continue;
        if (naam === "url" && i > 0 && /[A-Za-z0-9]/.test(tekst[i - 1])) continue;
        re.lastIndex = i;
        const m = re.exec(tekst);
        if (!m) continue;
        spoel();
        const knoop = maak(m, ctx, diepte);
        for (const k of [].concat(knoop)) if (k) uit.push(k);
        i += m[0].length;
        gevonden = true;
        break;
      }
    }
    if (!gevonden) { buffer += ch; i += 1; }
  }
  spoel();
  return uit;
}

// ---------------------------------------------------------------------------
// Blokken
// ---------------------------------------------------------------------------
const CODEBLOK = /```(?:([A-Za-z0-9_+\-.#]{1,20})\n)?\n?([\s\S]*?)```/g;

// Alleen emoji (tot 30, zoals Discord): dan worden ze groot.
function alleenEmoji(tekst) {
  const zonder = String(tekst).replace(/<a?:\w{2,32}:\d{15,20}>/g, "E").replace(/\s+/g, "");
  if (!zonder) return false;
  const tellen = [...zonder.matchAll(/E|\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu)];
  return tellen.length > 0 && tellen.length <= 30 && tellen.map((m) => m[0]).join("") === zonder;
}

function lijstBlok(regels, ctx, diepte) {
  // regels: [{inspring, geordend, tekst}]
  const wortel = el(regels[0].geordend ? "ol" : "ul", { class: "tr-list" });
  const stapel = [{ niveau: regels[0].inspring, lijst: wortel }];
  for (const r of regels) {
    while (stapel.length > 1 && r.inspring < stapel[stapel.length - 1].niveau) stapel.pop();
    let top = stapel[stapel.length - 1];
    if (r.inspring > top.niveau && stapel.length < 3 && top.lijst.lastElementChild) {
      const sub = el(r.geordend ? "ol" : "ul", { class: "tr-list" });
      top.lijst.lastElementChild.appendChild(sub);
      stapel.push({ niveau: r.inspring, lijst: sub });
      top = stapel[stapel.length - 1];
    }
    top.lijst.appendChild(el("li", {}, inline(r.tekst, ctx, diepte + 1)));
  }
  return wortel;
}

function blokkenUitTekst(tekst, ctx, diepte, inCitaat = false) {
  const uit = [];
  const regels = tekst.split("\n");
  let alinea = [];
  const sluitAlinea = () => {
    if (!alinea.length) return;
    uit.push(el("div", { class: "tr-p" }, inline(alinea.join("\n"), ctx, diepte + 1)));
    alinea = [];
  };
  for (let i = 0; i < regels.length; i++) {
    const regel = regels[i];
    let m;
    if (!inCitaat && (m = /^>>> ?([\s\S]*)$/.exec(regel))) {
      sluitAlinea();
      const rest = [m[1], ...regels.slice(i + 1)].join("\n");
      uit.push(el("blockquote", { class: "tr-quote" }, blokkenUitTekst(rest, ctx, diepte + 1, true)));
      break;
    }
    if (!inCitaat && /^> ?/.test(regel)) {
      sluitAlinea();
      const blok = [];
      while (i < regels.length && /^> ?/.test(regels[i])) { blok.push(regels[i].replace(/^> ?/, "")); i++; }
      i--;
      uit.push(el("blockquote", { class: "tr-quote" }, blokkenUitTekst(blok.join("\n"), ctx, diepte + 1, true)));
      continue;
    }
    if ((m = /^(#{1,3}) +(\S.*)$/.exec(regel))) {
      sluitAlinea();
      uit.push(el("div", { class: `tr-h tr-h${m[1].length}`, role: "heading", "aria-level": String(m[1].length + 2) },
        inline(m[2], ctx, diepte + 1)));
      continue;
    }
    if ((m = /^-# +(\S.*)$/.exec(regel))) {
      sluitAlinea();
      uit.push(el("div", { class: "tr-subtext" }, inline(m[1], ctx, diepte + 1)));
      continue;
    }
    if (/^(\s*)([-*]|\d{1,9}\.) +\S/.test(regel)) {
      sluitAlinea();
      const items = [];
      while (i < regels.length && (m = /^(\s*)([-*]|\d{1,9}\.) +(\S.*)$/.exec(regels[i]))) {
        items.push({ inspring: m[1].length, geordend: /\d/.test(m[2]), tekst: m[3] });
        i++;
      }
      i--;
      uit.push(lijstBlok(items, ctx, diepte));
      continue;
    }
    alinea.push(regel);
  }
  sluitAlinea();
  return uit;
}

// De hele tekst van een bericht, een embed of een tekstcomponent.
export function markdown(tekst, ctx = {}, klasse = "tr-text") {
  ctx = { refs: {}, ...ctx, jumbo: ctx.jumbo === undefined ? alleenEmoji(tekst) : ctx.jumbo };
  const blok = el("div", { class: klasse + (ctx.jumbo ? " tr-jumbo" : "") });
  const bron = String(tekst || "");
  let pos = 0;
  CODEBLOK.lastIndex = 0;
  let m;
  while ((m = CODEBLOK.exec(bron)) !== null) {
    const voor = bron.slice(pos, m.index).replace(/\n$/, "");
    if (voor.trim()) for (const n of blokkenUitTekst(voor, ctx, 0)) blok.appendChild(n);
    blok.appendChild(el("pre", { class: "tr-pre" }, [
      el("code", { "data-lang": m[1] || null, text: m[2].replace(/\n$/, "") })]));
    pos = m.index + m[0].length;
    if (bron[pos] === "\n") pos += 1;
  }
  const rest = bron.slice(pos);
  if (rest.trim()) for (const n of blokkenUitTekst(rest, ctx, 0)) blok.appendChild(n);
  return blok;
}
