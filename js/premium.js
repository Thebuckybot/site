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
  if (tier.badge) {
    // De badge is decoratief: de naam ernaast zegt hetzelfde. `aria-hidden`
    // voorkomt dat een screenreader "circled ring operator Elite" voorleest.
    const badge = el("span", "pr-badge", tier.badge);
    badge.setAttribute("aria-hidden", "true");
    title.appendChild(badge);
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
    stats.appendChild(el("dd", null, value));
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

  if (!tiers.length) {
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
              ? "1 cache is waiting — run premium in Discord to claim it."
              : `${data.waiting} caches are waiting — run premium in Discord to claim them.`
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
  status.hidden = true;
}

load();
