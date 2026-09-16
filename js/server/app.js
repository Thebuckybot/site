// Server Center — de shell: zijbalk, routering, verversen, de lade op een
// telefoon, en de wissel naar het Security Center.
//
// Dezelfde opzet als js/security/app.js, met één verschil dat je voelt: de
// overgang tussen schermen is geen harde sprong. Het oude scherm zakt 4px weg
// en vervaagt, het nieuwe komt op. Dat duurt 120 ms - lang genoeg om te zien
// dat er iets vervangen wordt, kort genoeg om nooit in de weg te zitten. Wie
// "reduce motion" aan heeft, krijgt de sprong zonder beweging.
import { guildId, api } from "./api.js";
import { el, clear, toast } from "../security/ui.js";
import { buildSidebar, setActive, sectionLabel, isInternal } from "./router.js";

const appEl = document.getElementById("sec-app");
const nav = document.getElementById("sec-nav");
const content = document.getElementById("sec-content");
const breadcrumb = document.getElementById("sec-breadcrumb");

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FADE_MS = REDUCED ? 0 : 120;

function currentKey() {
  const key = (window.location.hash || "#overview").slice(1);
  return isInternal(key) ? key : "overview";
}

function setBreadcrumb(key) {
  clear(breadcrumb);
  breadcrumb.appendChild(el("span", { class: "crumb-root", text: "Server" }));
  breadcrumb.appendChild(el("span", { class: "sep crumb-root", text: "/" }));
  breadcrumb.appendChild(el("span", { text: sectionLabel(key) }));
}

export function navigate(key) {
  window.location.hash = "#" + key;
}

function wacht(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let bezig = 0;

async function loadSection(key) {
  const beurt = ++bezig;
  setActive(nav, key);
  setBreadcrumb(key);

  // Uit beeld, dan pas wisselen. `opacity` en `transform` zijn de twee
  // eigenschappen die de browser zonder layout kan animeren.
  if (FADE_MS) {
    content.style.transition = `opacity ${FADE_MS}ms var(--ease), transform ${FADE_MS}ms var(--ease)`;
    content.style.opacity = "0";
    content.style.transform = "translateY(4px)";
    await wacht(FADE_MS);
  }
  if (beurt !== bezig) return;        // er is intussen ergens anders op geklikt

  clear(content);
  content.appendChild(el("div", { class: "sec-loading", text: `Loading ${sectionLabel(key)}…` }));
  content.style.opacity = "";
  content.style.transform = "";

  try {
    const mod = await import(`./pages/${key}.js`);
    if (beurt !== bezig) return;
    clear(content);
    await mod.default.render(content, { navigate });
    content.focus({ preventScroll: true });
  } catch (err) {
    if (beurt !== bezig) return;
    clear(content);
    content.appendChild(el("div", { class: "sec-card" }, [
      el("div", { class: "sec-page-title", text: "This page did not load" }),
      el("p", { class: "sec-muted", text: (err && err.message) || String(err) }),
      el("button", {
        class: "sec-btn sec-btn-primary sec-btn-sm", type: "button",
        text: "Try again", onclick: () => loadSection(key),
      }),
    ]));
    console.error(err);
  }
  appEl.classList.remove("nav-open");
}

// De servernaam boven in beeld. Komt uit de keuze op dashboard.html, die hem in
// localStorage zet; zonder die cache staat er het id, en dat is eerlijker dan
// een extra netwerkverzoek voor een naam.
function setServerChip() {
  const host = document.getElementById("sec-guild-name");
  if (!host) return;
  const id = guildId();
  let g = null;
  try { g = JSON.parse(localStorage.getItem("bucky_active_guild") || "null"); } catch (_) { /* uit */ }
  clear(host);
  if (g && String(g.id) === String(id) && g.name) {
    const img = document.createElement("img");
    img.className = "sec-server-ic"; img.alt = "";
    img.src = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`
                     : "https://cdn.discordapp.com/embed/avatars/0.png";
    host.append(img, el("span", { class: "sec-server-nm", text: g.name, title: g.name }));
    host.classList.add("has-server");
  } else {
    host.textContent = "Server " + (id || "");
  }
}

function wireDepartments() {
  const naarSecurity = document.getElementById("srv-to-security");
  if (naarSecurity) naarSecurity.href = `security.html?guild_id=${encodeURIComponent(guildId() || "")}`;
}

async function boot() {
  if (!guildId()) { window.location.href = "dashboard.html"; return; }
  setServerChip();
  wireDepartments();
  buildSidebar(nav, navigate);

  document.getElementById("sec-refresh").addEventListener("click", () => loadSection(currentKey()));
  document.getElementById("sec-burger").addEventListener("click", () => appEl.classList.toggle("nav-open"));
  const scrim = document.getElementById("sec-scrim");
  if (scrim) scrim.addEventListener("click", () => appEl.classList.remove("nav-open"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") appEl.classList.remove("nav-open");
  });
  window.addEventListener("hashchange", () => loadSection(currentKey()));
  appEl.setAttribute("aria-busy", "false");

  // Eén keer vragen of we hier mogen zijn. Een 403 hier is duidelijker dan vier
  // schermen die elk hun eigen foutmelding tonen.
  try {
    await api.me();
  } catch (err) {
    clear(content);
    content.appendChild(el("div", { class: "sec-card" }, [
      el("div", { class: "sec-page-title", text: "You cannot manage this server" }),
      el("p", { class: "sec-muted", text: (err && err.message) || "Ask an administrator of this server for access." }),
      el("a", { class: "sec-btn sec-btn-primary sec-btn-sm", href: "dashboard.html", text: "Pick another server" }),
    ]));
    return;
  }
  loadSection(currentKey());
}

boot().catch((err) => {
  console.error(err);
  toast("The Server Center did not start.", "err");
});
