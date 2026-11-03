// Dashboard v2 (3-11-2026): wat het Server Center en het Security Center delen in
// het zijpaneel en de kale balk erboven.
//
//   * het ZOEKVELD in de balk ("/" zet de focus erin): filtert de knoppen in het
//     zijpaneel op hun naam, Enter opent de eerste treffer, Esc wist. Het zoekt
//     alleen in de namen van de schermen; er gaat niets naar de server.
//   * de GEBRUIKER onderin het paneel, uit dezelfde sessie als de rest van de
//     site (js/sessie.js: de cache, anders /api/me), met Log out.
//   * de BOVENTITEL boven de paginatitel (de groep waar het scherm in hoort),
//     zoals in de preview.
//
// Geen innerHTML: namen zijn tekst van Discord.
import { el, clear } from "./security/ui.js";
import { fetchMetDeadline, haalLogin, leesSessieCache, uitloggen } from "./sessie.js";
import { API_URL } from "./config.js";

// ---------------------------------------------------------------------------
// Zoeken in het zijpaneel
// ---------------------------------------------------------------------------
function filterNav(navEl, vraag) {
  const q = vraag.trim().toLowerCase();
  for (const knop of navEl.querySelectorAll(".sec-nav-item")) {
    const naam = (knop.textContent || "").trim().toLowerCase();
    knop.hidden = !!q && !naam.includes(q);
  }
  // Een groep zonder zichtbare knoppen verdwijnt mee, met zijn kop.
  for (const groep of navEl.querySelectorAll(".dv2-groep")) {
    const zichtbaar = [...groep.querySelectorAll(".sec-nav-item")].some((k) => !k.hidden);
    groep.hidden = !zichtbaar;
  }
}

function eersteTreffer(navEl) {
  return [...navEl.querySelectorAll(".sec-nav-item")].find((k) => !k.hidden && !k.closest("[hidden]"));
}

export function zoekveld(navEl) {
  const veld = document.getElementById("dv2-zoek");
  if (!veld || !navEl) return;
  veld.addEventListener("input", () => filterNav(navEl, veld.value));
  veld.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const knop = eersteTreffer(navEl);
      if (knop) { e.preventDefault(); knop.click(); veld.value = ""; filterNav(navEl, ""); veld.blur(); }
    } else if (e.key === "Escape") {
      veld.value = ""; filterNav(navEl, ""); veld.blur();
    }
  });
  // "/" zet de focus in het zoekveld, behalve als je al ergens typt.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (veld.offsetParent === null) return;          // verborgen (telefoon)
    e.preventDefault();
    veld.focus();
  });
}

// ---------------------------------------------------------------------------
// De gebruiker onderin het paneel
// ---------------------------------------------------------------------------
function initiaal(naam) {
  const t = String(naam || "?").trim();
  return (t[0] || "?").toUpperCase();
}

function toonGebruiker(user) {
  const naamEl = document.getElementById("dv2-ik-naam");
  const avatar = document.getElementById("dv2-avatar");
  if (!naamEl || !avatar) return;
  const naam = (user && (user.global_name || user.username)) || "Signed in";
  naamEl.textContent = naam;
  naamEl.title = user && user.username ? `@${user.username}` : "";
  clear(avatar);
  if (user && user.id && user.avatar && /^[a-zA-Z0-9_]{1,64}$/.test(String(user.avatar))
      && /^\d{5,20}$/.test(String(user.id))) {
    const img = el("img", { src: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`,
                            alt: "", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => { clear(avatar); avatar.textContent = initiaal(naam); });
    avatar.appendChild(img);
  } else {
    avatar.textContent = initiaal(naam);
  }
}

export function gebruiker() {
  toonGebruiker(leesSessieCache());
  haalLogin().then((r) => { if (r && r.loggedIn) toonGebruiker(r.user); }).catch(() => { /* blijft staan */ });
  const knop = document.getElementById("dv2-uitloggen");
  if (knop) {
    knop.addEventListener("click", async () => {
      knop.disabled = true;
      try { await uitloggen(); } catch (_) { /* lokaal is de sessie al gewist */ }
      window.location.href = "index.html";
    });
  }
}

// ---------------------------------------------------------------------------
// De naam van de server waar je in zit (uit de serverkeuze), of null
// ---------------------------------------------------------------------------
export function serverNaam() {
  const id = new URLSearchParams(window.location.search).get("guild_id");
  let g = null;
  try { g = JSON.parse(localStorage.getItem("bucky_active_guild") || "null"); } catch (_) { /* geen cache */ }
  return g && id && String(g.id) === String(id) && typeof g.name === "string" && g.name.trim() ? g.name : null;
}

// ---------------------------------------------------------------------------
// De server bovenaan het zijpaneel: icoon en naam
// ---------------------------------------------------------------------------
// Uit de keuze op dashboard.html (localStorage); zonder die cache staat er het
// id, en dat is eerlijker dan een extra netwerkverzoek voor een naam. Zonder
// icoon de initialen op een rood vlak, zoals in de serverkeuze.
export function initialen(naam) {
  const woorden = String(naam || "").trim().split(/\s+/).filter(Boolean);
  const letters = woorden.slice(0, 2).map((w) => Array.from(w)[0] || "").join("");
  return (letters || "?").toUpperCase();
}

export function serverKop(id) {
  const host = document.getElementById("sec-guild-name");
  if (!host) return;
  let g = null;
  try { g = JSON.parse(localStorage.getItem("bucky_active_guild") || "null"); } catch (_) { /* geen cache */ }
  clear(host);
  const bekend = g && id && String(g.id) === String(id) && typeof g.name === "string" && g.name;
  const naam = bekend ? g.name : "Server " + (id || "");
  let ic;
  if (bekend && g.icon && /^(a_)?[a-f0-9]{8,64}$/.test(String(g.icon)) && /^\d{5,20}$/.test(String(g.id))) {
    ic = el("img", { class: "sec-server-ic", alt: "", src: `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` });
  } else {
    ic = el("span", { class: "sec-server-ic dv2-initialen", "aria-hidden": "true", text: bekend ? initialen(naam) : "#" });
  }
  host.append(ic, el("span", { class: "sec-server-nm", text: naam, title: naam }));
  host.classList.add("has-server");
}

// ---------------------------------------------------------------------------
// De serverwisselaar
// ---------------------------------------------------------------------------
// De servernaam bovenaan het paneel opent een lijst met je servers (de huidige
// gemarkeerd) en onderaan "All servers" naar de serverkeuze. De lijst komt uit
// dezelfde cache als de serverkeuze (sessionStorage user_guilds, gevuld door
// /api/me); zonder cache een keer /api/me. Een server kiezen opent hetzelfde
// centrum voor die server. Toetsenbord: Enter/Spatie opent, pijlen lopen door
// de lijst, Esc sluit en zet de focus terug op de knop.
async function mijnServers() {
  try {
    const c = JSON.parse(sessionStorage.getItem("user_guilds") || "null");
    if (Array.isArray(c) && c.length) return c;
  } catch (_) { /* geen cache */ }
  try {
    const res = await fetchMetDeadline(`${API_URL}/api/me`, { credentials: "include" });
    const data = await res.json();
    const lijst = Array.isArray(data && data.guilds) ? data.guilds : [];
    try { sessionStorage.setItem("user_guilds", JSON.stringify(lijst)); } catch (_) { /* privevenster */ }
    return lijst;
  } catch (_) {
    return [];
  }
}

function serverIcoon(g) {
  if (g && g.icon && /^(a_)?[a-f0-9]{8,64}$/.test(String(g.icon)) && /^\d{5,20}$/.test(String(g.id))) {
    return el("img", { class: "dv2-wissel-ic", alt: "", src: `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` });
  }
  return el("span", { class: "dv2-wissel-ic dv2-initialen", "aria-hidden": "true", text: initialen(g && g.name) });
}

export function serverWissel(pagina, huidigId) {
  const knop = document.getElementById("dv2-server-knop");
  const paneel = document.getElementById("dv2-wissel");
  const lijst = document.getElementById("dv2-wissel-lijst");
  if (!knop || !paneel || !lijst) return;
  let geladen = false;

  const links = () => [...paneel.querySelectorAll("a")].filter((a) => a.offsetParent !== null);
  const zetPlek = () => {
    const r = knop.getBoundingClientRect();
    const rail = window.innerWidth >= 700 && window.innerWidth < 1100;
    const breed = Math.min(300, window.innerWidth - 20);
    let left = rail ? r.right + 12 : r.left;
    left = Math.max(10, Math.min(left, window.innerWidth - breed - 10));
    const top = rail ? r.top : r.bottom + 6;
    paneel.style.left = `${Math.round(left)}px`;
    paneel.style.top = `${Math.round(top)}px`;
    paneel.style.width = `${Math.round(breed)}px`;
    paneel.style.maxHeight = `${Math.max(180, Math.round(window.innerHeight - top - 16))}px`;
  };
  const vul = async () => {
    const servers = (await mijnServers()).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    clear(lijst);
    for (const g of servers) {
      if (!g || !/^\d{5,20}$/.test(String(g.id))) continue;
      const nu = String(g.id) === String(huidigId);
      const a = el("a", {
        class: "dv2-wissel-item" + (nu ? " is-nu" : ""),
        href: `${pagina}?guild_id=${encodeURIComponent(g.id)}`,
      }, [serverIcoon(g), el("span", { class: "dv2-wissel-naam", text: g.name || `Server ${g.id}` })]);
      if (nu) {
        a.setAttribute("aria-current", "page");
        a.appendChild(el("span", { class: "dv2-sr", text: " (current)" }));
      }
      a.addEventListener("click", () => {
        try { localStorage.setItem("bucky_active_guild", JSON.stringify({ id: g.id, name: g.name, icon: g.icon || null })); }
        catch (_) { /* opslag uit */ }
      });
      lijst.appendChild(el("li", {}, [a]));
    }
    lijst.hidden = !lijst.children.length;
    geladen = true;
  };
  const sluit = (terug) => {
    if (paneel.hidden) return;
    paneel.hidden = true;
    knop.setAttribute("aria-expanded", "false");
    if (terug) knop.focus();
  };
  const open = async () => {
    if (!geladen) await vul();
    zetPlek();
    paneel.hidden = false;
    knop.setAttribute("aria-expanded", "true");
    const doel = paneel.querySelector(".is-nu") || links()[0];
    if (doel) doel.focus();
  };

  knop.addEventListener("click", () => (paneel.hidden ? open() : sluit(true)));
  knop.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && paneel.hidden) { e.preventDefault(); open(); }
  });
  paneel.addEventListener("keydown", (e) => {
    const l = links();
    const i = l.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); sluit(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); (l[i + 1] || l[0]).focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (l[i - 1] || l[l.length - 1]).focus(); }
    else if (e.key === "Home") { e.preventDefault(); l[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); l[l.length - 1].focus(); }
  });
  // Tab uit de lijst, of ergens anders klikken: dicht.
  paneel.addEventListener("focusout", (e) => {
    if (!paneel.contains(e.relatedTarget) && e.relatedTarget !== knop) sluit(false);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!paneel.hidden && !paneel.contains(e.target) && !knop.contains(e.target)) sluit(false);
  });
  window.addEventListener("resize", () => sluit(false));
}

// ---------------------------------------------------------------------------
// De boventitel boven de paginatitel
// ---------------------------------------------------------------------------
export function boventitel(contentEl, tekst) {
  if (!contentEl || !tekst) return;
  if (contentEl.querySelector(".dv2-boven")) return;
  const kop = contentEl.querySelector(".srv-hero h1, h1.sec-page-title");
  if (!kop) return;
  kop.parentNode.insertBefore(el("p", { class: "dv2-boven", text: tekst }), kop);
}
