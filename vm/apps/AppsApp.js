/**
 * Apps — the launcher (v3 blok 4, taak C4).
 *
 * WHY THIS EXISTS
 * Until now the only way to discover an application was to recognise an icon on
 * the desktop. Seven sit there; Mail arrived in Phase 5.0 and `bucky://docs` in
 * blok 4, and a player who never opens the browser learns of neither. Every
 * other part of the VM is discoverable from inside itself - `help()` lists the
 * modules, `ps` lists the processes, PulseSearch searches BuckyNet - and the
 * apps were the one thing you had to already know about.
 *
 * The registry entry was called "Apps" and rendered a placeholder saying a
 * launcher was under construction. This is that launcher.
 *
 * NOTHING HERE IS A LIST. The grid is built from `runtime.apps`, so an
 * application added tomorrow appears tomorrow - the same reasoning as the
 * configure table on the bot side and the docs page next door. A hand-kept list
 * of eleven names is exactly what would go stale first.
 *
 * DOM-light: one render, one delegated click handler, one input listener.
 */
import { escapeHtml } from "../core/util.js";

/** Apps that are never worth listing: this one, and anything unlaunchable. */
function launchable(runtime, id) {
    const app = runtime.apps[id];
    if (!app || id === "apps") return false;
    return Boolean(app.id && app.title);
}

/**
 * Every application, sorted so what works comes first.
 *
 * A locked or unbuilt module still appears — with a badge. Hiding it would
 * answer "where is Mission Hub?" with silence, and the whole point of this
 * screen is that the answer is on it.
 */
export function appLijst(runtime) {
    return Object.keys(runtime.apps)
        .filter((id) => launchable(runtime, id))
        .map((id) => {
            const app = runtime.apps[id];
            const staat = app.locked ? "locked"
                : (typeof app.createState === "function" || typeof app.mount === "function")
                    ? "ok" : "soon";
            return {
                id,
                title: app.title || id,
                icon: app.icon || String(id).slice(0, 3).toUpperCase(),
                description: app.description || "",
                state: staat
            };
        })
        .sort((a, b) => {
            const rang = { ok: 0, locked: 1, soon: 2 };
            if (rang[a.state] !== rang[b.state]) return rang[a.state] - rang[b.state];
            return a.title.localeCompare(b.title);
        });
}

/** Filter on title and id. Empty query returns everything. */
export function filterApps(apps, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) => a.title.toLowerCase().includes(q)
        || a.id.toLowerCase().includes(q)
        || (a.description || "").toLowerCase().includes(q));
}

export function createAppsState() {
    return { query: "" };
}

function tegel(app) {
    const badge = app.state === "locked"
        ? `<span class="vm-apps-badge is-locked">offline</span>`
        : app.state === "soon"
            ? `<span class="vm-apps-badge is-soon">soon</span>` : "";
    return `
        <button class="vm-apps-tile is-${app.state}" type="button"
                data-launch-app="${escapeHtml(app.id)}">
            <span class="vm-apps-icon">${escapeHtml(app.icon)}</span>
            <span class="vm-apps-name">${escapeHtml(app.title)}${badge}</span>
        </button>`;
}

export function renderAppsApp(runtime, windowState) {
    const state = windowState.app || {};
    const alles = appLijst(runtime);
    const zichtbaar = filterApps(alles, state.query);
    const raster = zichtbaar.length
        ? zichtbaar.map(tegel).join("")
        : `<p class="vm-apps-empty">Nothing matches “${escapeHtml(state.query)}”.</p>`;
    return `
        <div class="vm-apps">
            <input class="vm-apps-search" type="text" data-apps-search
                   placeholder="Search applications…"
                   value="${escapeHtml(state.query || "")}">
            <div class="vm-apps-grid" data-apps-grid>${raster}</div>
            <p class="vm-apps-foot">${zichtbaar.length} of ${alles.length} shown
            · press Enter to open the first match</p>
        </div>`;
}

export function mountAppsApp(runtime, windowState, element) {
    const zoek = element.querySelector("[data-apps-search]");
    const raster = element.querySelector("[data-apps-grid]");
    if (!zoek || !raster) return;

    const herteken = () => {
        const alles = appLijst(runtime);
        const zichtbaar = filterApps(alles, windowState.app.query);
        raster.innerHTML = zichtbaar.length
            ? zichtbaar.map(tegel).join("")
            : `<p class="vm-apps-empty">Nothing matches “${
                escapeHtml(windowState.app.query)}”.</p>`;
        const voet = element.querySelector(".vm-apps-foot");
        if (voet) {
            voet.textContent = `${zichtbaar.length} of ${alles.length} shown `
                + "· press Enter to open the first match";
        }
    };

    zoek.addEventListener("input", () => {
        windowState.app.query = zoek.value;
        herteken();
    });
    zoek.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        // ENTER OPENT DE EERSTE TREFFER, want dat is waarom je typt. Zonder dit
        // is het zoekveld een filter en geen launcher.
        const eerste = filterApps(appLijst(runtime), windowState.app.query)[0];
        if (eerste) runtime.openApp(eerste.id);
    });
    // Eén gedelegeerde handler op het raster, zodat hertekenen geen listeners
    // achterlaat - dat is precies hoe de desktop het ook doet.
    raster.addEventListener("click", (event) => {
        const knop = event.target.closest("[data-launch-app]");
        if (!knop) return;
        runtime.openApp(knop.dataset.launchApp);
    });

    windowState.view = windowState.view || {};
    windowState.view.refresh = herteken;
    try {
        zoek.focus();
    } catch (_e) { /* focus is nice, never required */ }
}

export function unmountAppsApp(_runtime, windowState) {
    if (windowState.view) windowState.view.refresh = null;
}

export function focusAppsApp(_runtime, _windowState, element) {
    try {
        element.querySelector("[data-apps-search]")?.focus();
    } catch (_e) { /* ignore */ }
}
