// Security Center bootstrap: wires the shell, grouped sidebar, routing, refresh.
// Every section — including SOC and the Rule Builder — is a lazily-imported page
// module exporting { render(root) }. Navigation only ever swaps the workspace;
// it never leaves the Security Center.
import { guildId, api } from "./api.js";
import { el, clear } from "./ui.js";
import { buildSidebar, setActive, sectionLabel, isInternal } from "./router.js";

// One place renders the read-only INDICATOR, driven by the server's /me tier. It
// adds the `sec-readonly` body class (which drives the write-hiding safety net) and
// a small pill inside the EXISTING topbar actions. It deliberately does NOT inject a
// banner or any new child into the `.sec-app` grid — a third grid item would break
// the two-column auto-placement and displace the sidebar/main (SV2-READONLY-002).
// The pill lives in `.sec-main`'s flow, so grid geometry is byte-identical to
// Administrator mode; the only visual differences are hidden write controls + pill.
async function applyReadonlyIndicator() {
  try {
    const perms = await api.me();
    if (!perms || perms.can_edit) return;
    document.body.classList.add("sec-readonly");
    if (document.getElementById("sec-readonly-pill")) return;
    const pill = el("span", {
      id: "sec-readonly-pill", class: "sec-readonly-pill", role: "status",
      title: "Read-only access — only the server owner or a whitelisted Security Admin can make changes.",
    }, [
      el("span", { class: "ic", "aria-hidden": "true", text: "🔒" }),
      el("span", { text: "Read Only" }),
    ]);
    const actions = document.querySelector(".sec-top-actions");
    const refresh = document.getElementById("sec-refresh");
    if (actions && refresh) actions.insertBefore(pill, refresh);
    else if (actions) actions.appendChild(pill);
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
  applyReadonlyIndicator();
  loadSection(currentKey());
}

boot();
