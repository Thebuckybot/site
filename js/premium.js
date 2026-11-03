// premium.js — de premiumpagina: vier tiers, en wat je zelf hebt.
//
// GEEN TWEEDE LIJST IN DIT BESTAND. Elke regel onder "what's in the cache" komt
// uit /api/premium/tiers, dat hem uit `premium_catalog` haalt, dat door de bot is
// gevuld met `premium_packages.describe()` - dezelfde functie die `+premium` in
// Discord gebruikt. Zou de inhoud hier staan, dan liep hij binnen een maand uit de
// pas, precies zoals de twee retentietabellen die elkaar nu tegenspreken.
//
// NIETS ONGEESCAPEDS IN innerHTML. Elke waarde uit de API gaat via `textContent`
// of via `document.createTextNode`. De itemnamen komen uit een configbestand dat
// een mens bijhoudt, dus ze zijn niet vijandig - maar "de bron is te vertrouwen"
// is precies de aanname die een XSS over een half jaar mogelijk maakt, als er een
// veld bijkomt dat wél van buiten komt. De enige `innerHTML` in dit bestand
// bestaat niet.
//
// GEEN TOKEN IN DE URL. `/api/premium/me` leest de sessiecookie server-side.
// Een user id in een querystring belandt in access logs en in de Referer van elke
// uitgaande link op deze pagina.

import { API_URL } from "./config.js";

// Dezelfde deadline-regel als de navigatiebalk: een stille server mag deze
// pagina op "Loading..." zetten, maar nooit voor eeuwig - de statusregel moet
// binnen de deadline omslaan naar een echte melding.
const FETCH_DEADLINE_MS = 8000;

function fetchMetDeadline(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

const grid = document.getElementById("pr-grid");
const status = document.getElementById("pr-status");
const you = document.getElementById("pr-you");
const youBody = document.getElementById("pr-you-body");

/** Eén element met tekst erin. De enige manier waarop deze pagina tekst plaatst. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

// DE BADGE IN EEN LICHTE VERSIE (4-11-2026). badge_url wijst naar de PNG van
// 600x600 in assets/badges/ (200-450 KB per stuk). Voor elke bekende badge staat
// er een WebP van 192 px in assets/images/premium/ (6-12 KB). Is er voor een
// badge geen WebP (een nieuwe tier), dan valt de img terug op badge_url zelf, en
// pas als ook die niet laadt verdwijnt hij - zoals voorheen.
function badgeImg(url, maat, lazy) {
  const badge = el("img", "pr-badge");
  const m = /\/assets\/badges\/([a-z0-9_]+)\.png$/.exec(String(url || ""));
  badge.src = m ? `assets/images/premium/badge-${m[1]}-192.webp` : url;
  badge.alt = "";                 // decoratief: de naam ernaast zegt hetzelfde
  badge.width = maat;
  badge.height = maat;
  badge.decoding = "async";
  if (lazy) badge.loading = "lazy";
  badge.addEventListener("error", () => {
    if (m && badge.getAttribute("src") !== url) badge.src = url;
    else badge.remove();
  });
  return badge;
}

function formatBoost(boost) {
  const n = Number(boost);
  if (!Number.isFinite(n)) return "";
  // `×1.2` en niet `×1.20`: twee decimalen suggereren een precisie die de config
  // niet heeft.
  return `×${n.toString()}`;
}

function formatShards(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString("en-US");
}

/**
 * Eén tierkaart.
 *
 * `<li>` in een `<ul>` omdat het een lijst van vier gelijkwaardige dingen is;
 * dat is wat een screenreader als "4 items" aankondigt, en het geeft de gebruiker
 * meteen te horen hoeveel keuzes er zijn.
 */
function card(tier, mine) {
  const item = el("li", "pr-card");
  if (mine) item.classList.add("pr-card-mine");
  // DE AANRADER KOMT UIT DE DATA, en de data komt uit de botconfig
  // (website.featured_tier) via de catalogus - hier staat geen tiernaam.
  if (tier.featured === true) item.classList.add("pr-card-featured");

  const head = el("div", "pr-card-head");
  const title = el("h2", "pr-card-title");
  // DE BADGE IS `badge_url` EN NIET `badge`, en dat onderscheid is de hele
  // reden dat er twee velden zijn.
  //
  // `badge` draagt de DISCORD-emoji (`<:elite:1537...>`). Die rendert binnen
  // Discord en nergens anders: als tekst in een `<span>` staat er letterlijk
  // `<:elite:1537...>` op de kaart. Tot 15 augustus 2026 stond er een
  // unicode-glyph in dat veld en viel dat niet op, want een glyph rendert
  // overal - het brak op de dag dat de echte emoji werd geüpload.
  //
  // `badge_url` is de PNG uit `site/assets/badges/<tier_key>.png`, afgeleid
  // door de bot via `cogs/assets.py` en dus uit dezelfde bron als elke andere
  // plaat. Hier staat geen pad: als het bestand er niet is stuurt de bot
  // `null`, en dan blijft de kaart gewoon staan zonder plaatje.
  if (tier.badge_url) {
    // Boven de vouw op een desktop, dus niet lazy; de maat staat vast (geen sprong).
    title.appendChild(badgeImg(tier.badge_url, 72, false));
  }
  title.appendChild(document.createTextNode(tier.name || tier.tier_key || ""));
  head.appendChild(title);

  if (tier.featured === true) {
    // TEKST EN NIET ALLEEN DE RAND: wie de kleur of de beweging niet ziet,
    // moet de aanbeveling nog steeds kunnen lezen.
    head.appendChild(el("p", "pr-featured-flag", "Recommended"));
  }
  if (mine) {
    // TEKST EN NIET ALLEEN EEN KLEUR. Dit is de reden dat deze regel bestaat:
    // wie de rand niet ziet, moet het nog steeds kunnen weten.
    head.appendChild(el("p", "pr-mine-flag", "Your tier"));
  }
  item.appendChild(head);

  // DE PRIJS, uit dezelfde bron als de rest (de catalogus die de bot vult) en
  // dus nooit hardgecodeerd hier. Een string die de portal-prijs herhaalt;
  // ontbreekt hij, dan staat er geen prijs in plaats van een verzonnen bedrag.
  if (tier.price) {
    head.appendChild(el("p", "pr-price", tier.price));
  }

  const stats = el("dl", "pr-stats");
  const rows = [
    ["Earnings boost", formatBoost(tier.boost)],
    ["Challenge bonus", `+${Number(tier.challenge_bonus) || 0}% on shards`],
    ["Monthly shards", formatShards(tier.shards_monthly)],
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    stats.appendChild(el("dt", null, label));
    const dd = el("dd", null, value);
    if (label === "Monthly shards") {
      // Het pictogram van de shard; decoratief, het label zegt het al.
      const ic = el("img", "pr-shard-ic");
      ic.src = "assets/images/premium/shard-48.webp"; ic.alt = ""; ic.width = 18; ic.height = 18;
      ic.addEventListener("error", () => ic.remove());
      dd.prepend(ic);
    }
    stats.appendChild(dd);
  }
  item.appendChild(stats);

  // DE UITKLAP. `<details>` is uit zichzelf toetsenbordbedienbaar en wordt als
  // uitvouwbaar aangekondigd; een zelfgebouwde accordeon met `aria-expanded` is
  // de versie die stukgaat.
  const lines = Array.isArray(tier.contents) ? tier.contents : [];
  if (lines.length) {
    const details = el("details", "pr-details");
    const summary = el("summary", "pr-summary");
    summary.appendChild(document.createTextNode("What's in the monthly cache"));
    summary.appendChild(el("span", "pr-count", `${lines.length} items`));
    details.appendChild(summary);
    const list = el("ul", "pr-contents");
    for (const line of lines) list.appendChild(el("li", null, line));
    details.appendChild(list);
    item.appendChild(details);
  }

  if (tier.store_url) {
    const link = el("a", "pr-buy", `Get ${tier.name || "this tier"}`);
    link.href = tier.store_url;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    // "opens in a new tab" hoort HOORBAAR te zijn, niet alleen zichtbaar aan een
    // icoontje dat er niet is.
    link.appendChild(el("span", "pr-sr", " (opens Discord in a new tab)"));
    item.appendChild(link);
  } else {
    item.appendChild(el("p", "pr-nolink", "Available in Discord."));
  }
  return item;
}

function say(text) {
  status.textContent = text;
  status.hidden = false;
}

async function load() {
  let tiers = [];
  try {
    const res = await fetchMetDeadline(`${API_URL}/api/premium/tiers`, {
      credentials: "include",
    });
    if (res.status === 404) {
      say("Premium isn't open yet. Check back soon.");
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    tiers = Array.isArray(data.tiers) ? data.tiers : [];
  } catch (err) {
    // EEN MISLUKTE FETCH MOET GEZEGD WORDEN. Stilte plus een leeg raster is voor
    // een screenreader niet te onderscheiden van "er is niets te koop".
    say("The tiers couldn't be loaded right now. Please try again later.");
    return;
  }

  // ÉÉN ANTWOORD, TWEE SOORTEN. De catalogus draagt sinds 0069 een `kind`: de
  // vier abonnementen (tier) en de vier Security Boosts (boost). Dezelfde bron,
  // dezelfde publicatie, twee rasters. Een rij zonder `kind` is een tier - dat is
  // wat een oudere catalogusrij was.
  const boosts = tiers.filter((r) => r && r.kind === "boost");
  // DRIE SOORTEN sinds 0075: de Cipher-pakketten (kind = cipher) krijgen hun
  // eigen raster, uit dezelfde publicatie.
  const cipher = tiers.filter((r) => r && r.kind === "cipher");
  tiers = tiers.filter((r) => !r || (r.kind !== "boost" && r.kind !== "cipher"));

  if (!tiers.length && !boosts.length && !cipher.length) {
    say("Premium isn't open yet. Check back soon.");
    return;
  }

  // De eigen stand is BIJZAAK: hij mag de tiers niet ophouden en niet meenemen
  // als hij faalt.
  let mine = null;
  try {
    const res = await fetchMetDeadline(`${API_URL}/api/premium/me`, {
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      if (data.signed_in && data.tier) {
        mine = data.tier.tier_key;
        const parts = [`You have ${data.tier.name}.`];
        if (data.waiting > 0) {
          parts.push(
            data.waiting === 1
              ? "1 cache is waiting - run premium in Discord to claim it."
              : `${data.waiting} caches are waiting - run premium in Discord to claim them.`
          );
        } else {
          parts.push("Nothing is waiting to be claimed right now.");
        }
        youBody.textContent = parts.join(" ");
        you.hidden = false;
      }
    }
  } catch (err) {
    /* niet ingelogd of even onbereikbaar: de pagina werkt zonder */
  }

  grid.replaceChildren(...tiers.map((tier) => card(tier, tier.tier_key === mine)));
  renderVergelijk(tiers, mine);
  renderBoosts(boosts);
  renderCipher(cipher);
  status.hidden = true;
}

/**
 * De looptijd van een boost, uit `duration_days`, in de woorden van de winkel.
 * Geen aparte tekstkolom: één getal, één omzetting, hier en in de bot dezelfde
 * regel (30 -> "1 month", 365 -> "1 year").
 */
function formatDuration(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return "";
  if (d % 365 === 0) { const n = d / 365; return `${n} year${n === 1 ? "" : "s"}`; }
  if (d % 30 === 0) { const n = d / 30; return `${n} month${n === 1 ? "" : "s"}`; }
  return `${d} days`;
}

/**
 * Eén boostkaart. Dezelfde bouwstenen als een tierkaart (`<li>` in een `<ul>`,
 * prijs uit de data, een `<details>` voor de inhoud, een koopknop naar Discord),
 * zodat een screenreader en een toetsenbord er hetzelfde doorheen komen.
 */
function boostCard(row) {
  const item = el("li", "pr-card pr-card-boost");
  const head = el("div", "pr-card-head");
  const title = el("h3", "pr-card-title");
  if (row.badge_url) {
    title.appendChild(badgeImg(row.badge_url, 56, true));
  }
  title.appendChild(document.createTextNode(row.name || row.tier_key || "Security Boost"));
  head.appendChild(title);
  // DE PRIJS MÉT DE KORTING, één string uit de catalogus ("$12.99 (13% off)"):
  // de site rekent geen procenten, dat doet de config, en zo staat overal
  // hetzelfde getal.
  if (row.price) head.appendChild(el("p", "pr-price", row.price));
  item.appendChild(head);

  const stats = el("dl", "pr-stats");
  const duration = formatDuration(row.duration_days);
  const rows = [
    ["Runs", duration ? `${duration}, from the day you assign it` : ""],
    ["Applies to", "one server you choose"],
    ["Move it", "after 7 days, to another server"],
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    stats.appendChild(el("dt", null, label));
    stats.appendChild(el("dd", null, value));
  }
  item.appendChild(stats);

  const lines = Array.isArray(row.contents) ? row.contents : [];
  if (lines.length) {
    const details = el("details", "pr-details");
    const summary = el("summary", "pr-summary");
    summary.appendChild(document.createTextNode("What the server gets"));
    summary.appendChild(el("span", "pr-count", `${lines.length} items`));
    details.appendChild(summary);
    const list = el("ul", "pr-contents");
    for (const line of lines) list.appendChild(el("li", null, line));
    details.appendChild(list);
    item.appendChild(details);
  }

  if (row.store_url) {
    const link = el("a", "pr-buy", `Buy ${duration || "this boost"}`);
    link.href = row.store_url;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    link.appendChild(el("span", "pr-sr", " (opens Discord in a new tab)"));
    item.appendChild(link);
  } else {
    item.appendChild(el("p", "pr-nolink", "Available in Discord."));
  }
  return item;
}

function renderBoosts(boosts) {
  const section = document.getElementById("pr-boosts");
  const boostGrid = document.getElementById("pr-boost-grid");
  if (!section || !boostGrid) return;
  if (!boosts.length) {
    section.hidden = true;
    return;
  }
  const sorted = [...boosts].sort((a, b) => (Number(a.tier_rank) || 0) - (Number(b.tier_rank) || 0));
  boostGrid.replaceChildren(...sorted.map(boostCard));
  section.hidden = false;
}

/**
 * Eén Cipher-kaart. Zelfde bouwstenen als de boostkaart; wat verschilt is dat
 * de PRIJS mag ontbreken (de config staat dat voor Cipher toe - een verkeerde
 * prijs is erger dan geen) en dat er geen looptijd is: Cipher landt en blijft.
 */
function cipherCard(row) {
  const item = el("li", "pr-card pr-card-cipher");
  const head = el("div", "pr-card-head");
  const title = el("h3", "pr-card-title");
  if (row.badge_url) {
    title.appendChild(badgeImg(row.badge_url, 56, true));
  }
  title.appendChild(document.createTextNode(row.name || row.tier_key || "Cipher"));
  head.appendChild(title);
  if (row.price) head.appendChild(el("p", "pr-price", row.price));
  item.appendChild(head);

  const stats = el("dl", "pr-stats");
  const rows = [
    ["Lands", "on your profile the moment the purchase goes through"],
    ["Spend it", "in the Cipher section of +shop"],
  ];
  for (const [label, value] of rows) {
    stats.appendChild(el("dt", null, label));
    stats.appendChild(el("dd", null, value));
  }
  item.appendChild(stats);

  const lines = Array.isArray(row.contents) ? row.contents : [];
  if (lines.length) {
    const details = el("details", "pr-details");
    const summary = el("summary", "pr-summary");
    summary.appendChild(document.createTextNode("What you get"));
    summary.appendChild(el("span", "pr-count", `${lines.length} items`));
    details.appendChild(summary);
    const list = el("ul", "pr-contents");
    for (const line of lines) list.appendChild(el("li", null, line));
    details.appendChild(list);
    item.appendChild(details);
  }

  if (row.store_url) {
    const link = el("a", "pr-buy", `Buy ${row.name || "Cipher"}`);
    link.href = row.store_url;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    link.appendChild(el("span", "pr-sr", " (opens Discord in a new tab)"));
    item.appendChild(link);
  } else {
    item.appendChild(el("p", "pr-nolink", "Available in Discord."));
  }
  return item;
}

function renderCipher(packs) {
  const section = document.getElementById("pr-cipher");
  const cipherGrid = document.getElementById("pr-cipher-grid");
  if (!section || !cipherGrid) return;
  if (!packs.length) {
    section.hidden = true;
    return;
  }
  const sorted = [...packs].sort((a, b) => (Number(a.tier_rank) || 0) - (Number(b.tier_rank) || 0));
  cipherGrid.replaceChildren(...sorted.map(cipherCard));
  section.hidden = false;
}

/**
 * DE VERGELIJKING (dashboard v2, 4-11-2026): de tiers naast elkaar, rij voor rij.
 * Uit DEZELFDE rijen als de kaarten en met dezelfde woorden en omzettingen
 * (formatBoost, formatShards, "N items"), dus nooit een tweede bron en nooit
 * een bewering die niet ook op een kaart staat. Een waarde die ontbreekt wordt
 * een streepje, geen verzonnen nul. Pas vanaf twee tiers; een vergelijking van
 * een is er geen.
 */
function renderVergelijk(tiers, mine) {
  const section = document.getElementById("pr-vergelijk");
  const wrap = document.getElementById("pr-vergelijk-wrap");
  if (!section || !wrap) return;
  if (tiers.length < 2) { section.hidden = true; return; }

  const table = el("table");
  const caption = el("caption", "pr-sr", "What each tier gives, side by side");
  table.appendChild(caption);
  const thead = el("thead");
  const kop = el("tr");
  const hoek = el("th"); hoek.scope = "col";
  hoek.appendChild(el("span", "pr-sr", "Tier"));
  kop.appendChild(hoek);
  for (const tier of tiers) {
    const th = el("th"); th.scope = "col";
    if (tier.featured === true) { th.classList.add("is-aanrader"); th.appendChild(el("span", "pr-featured-flag", "Recommended")); }
    th.appendChild(document.createTextNode(tier.name || tier.tier_key || ""));
    if (tier.price) th.appendChild(el("span", "pr-v-prijs", tier.price));
    if (tier.tier_key === mine) th.appendChild(el("span", "pr-v-prijs", "Your tier"));
    kop.appendChild(th);
  }
  thead.appendChild(kop);
  table.appendChild(thead);

  const rijen = [
    ["Earnings boost", (t) => formatBoost(t.boost)],
    ["Challenge bonus", (t) => `+${Number(t.challenge_bonus) || 0}% on shards`],
    ["Monthly shards", (t) => formatShards(t.shards_monthly)],
    ["What's in the monthly cache", (t) => (Array.isArray(t.contents) && t.contents.length ? `${t.contents.length} items` : "")],
  ];
  const tbody = el("tbody");
  for (const [label, waarde] of rijen) {
    const tr = el("tr");
    const th = el("th", null, label); th.scope = "row";
    tr.appendChild(th);
    for (const tier of tiers) {
      const td = el("td", tier.featured === true ? "is-aanrader" : null, waarde(tier) || "–");
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.replaceChildren(table);
  section.hidden = false;
}

// Klaar met laden (gelukt of niet): de noot en de uitleg mogen erbij. Zie
// premium.css "niets springt terwijl de tiers laden".
load().finally(() => document.body.classList.remove("pr-laden"));
