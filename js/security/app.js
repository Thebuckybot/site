// Security Center bootstrap: wires the shell, grouped sidebar, routing, refresh.
// Every section — including SOC and the Rule Builder — is a lazily-imported page
// module exporting { render(root) }. Navigation only ever swaps the workspace;
// it never leaves the Security Center.
import { guildId, api } from "./api.js";
import { el, clear } from "./ui.js";
import { buildSidebar, setActive, sectionLabel, isInternal } from "./router.js";

// One place renders the read-only banner, driven by the server's /me tier.
async function applyPermissionBanner() {
  try {
    const perms = await api.me();
    if (perms && !perms.can_edit) {
      document.body.classList.add("sec-readonly");
      let banner = document.getElementById("sec-readonly-banner");
      if (!banner) {
        banner = el("div", { id: "sec-readonly-banner", class: "sec-readonly-banner" }, [
          el("span", { class: "ic", text: "🔒" }),
          el("span", { text: "Read-only — you can view everything, but only the server owner or a whitelisted Security Admin can make changes." }),
        ]);
        appEl.insertBefore(banner, appEl.firstChild);
      }
    }
  } catch (_) { /* non-fatal: reads still work, writes 403 server-side */ }
}

const appEl = document.getElementById("sec-app");
const nav = document.getElementById("sec-nav");
const content = document.getElementById("sec-content");
const breadcrumb = document.getElementById("sec-breadcrumb");

function currentKey() {
  const key = (window.location.hash || "#overview").slice(1);
  return isInternal(key) ? key : "overview";
}

function setBreadcrumb(key) {
  clear(breadcrumb);
  breadcrumb.appendChild(el("span", { text: "Security" }));
  breadcrumb.appendChild(el("span", { class: "sep", text: "/" }));
  breadcrumb.appendChild(el("span", { text: sectionLabel(key) }));
}

function navigate(key) {
  // Internal-only: switching a section just updates the hash; the hashchange
  // handler swaps the workspace inside the same shell.
  window.location.hash = "#" + key;
}

async function loadSection(key) {
  setActive(nav, key);
  setBreadcrumb(key);
  clear(content);
  content.appendChild(el("div", { class: "sec-loading", text: "Loading " + sectionLabel(key) + "…" }));
  try {
    const mod = await import(`./pages/${key}.js`);
    clear(content);
    await mod.default.render(content);
    content.focus();
  } catch (err) {
    clear(content);
    content.appendChild(el("div", { class: "sec-card" }, [
      el("div", { class: "sec-page-title", text: "Failed to load this page" }),
      el("p", { class: "sec-muted", text: (err && err.message) || String(err) }),
    ]));
    console.error(err);
  }
  appEl.classList.remove("nav-open");
}

function boot() {
  if (!guildId()) { window.location.href = "dashboard.html"; return; }
  document.getElementById("sec-guild-name").textContent = "Guild " + guildId();
  buildSidebar(nav, navigate);
  document.getElementById("sec-refresh").addEventListener("click", () => loadSection(currentKey()));
  document.getElementById("sec-burger").addEventListener("click", () => appEl.classList.toggle("nav-open"));
  window.addEventListener("hashchange", () => loadSection(currentKey()));
  appEl.setAttribute("aria-busy", "false");
  applyPermissionBanner();
  loadSection(currentKey());
}

boot();
