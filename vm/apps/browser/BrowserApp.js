/**
 * Browser — the BuckyNet browser app.
 *
 * The in-universe web browser of the Bucky VM. It navigates and renders
 * BuckyNet: a window with back / forward / reload, an omnibox, per-window
 * history, loading states, and a viewport that renders bucky:// pages.
 *
 * Thin client. The browser resolves nothing itself: it asks the router to
 * classify the omnibox text, asks the SiteRegistry (via buckynet.js) to
 * resolve an address to a page, and renders the HTML string the page returns.
 * All routing and content live behind those modules.
 *
 * Live-app rendering discipline (see render-system.md):
 *   - render() builds the whole app body once, on window creation, and is the
 *     rebuild path after a full VM render — it reads state, never mutates it.
 *   - mount() captures the chrome + viewport nodes and binds delegated
 *     listeners exactly once.
 *   - Navigation patches the chrome (button state, loading class, URL value)
 *     and swaps ONLY the viewport's innerHTML. The omnibox is never rebuilt,
 *     so its caret and focus survive every navigation. No VM-wide rerender is
 *     ever triggered.
 *
 * Multi-instance: each launch opens an independent browser window with its
 * own history and viewport — several investigation threads at once.
 */
import { escapeHtml } from "../../core/util.js";
import { logError } from "../../core/diagnostics.js";
import { parseInput, parseUrl, pathSegments, buildSearchUrl } from "./router.js";
import { getBuckyNet } from "./buckynet.js";

/** Simulated BuckyNet latency (ms). Short, so rapid navigation stays smooth. */
const LOAD_MS = 220;
/** The PulseSearch homepage — the browser's start page and empty-address fallback. */
const HOME_URL = "bucky://search";
/** Per-window history cap. */
const HISTORY_MAX = 50;

// ----- State -----------------------------------------------------------------

export function createBrowserState(user, filesystem, payload) {
    let start = HOME_URL;
    if (payload && payload.url) {
        // The omnibox rule also governs intents: a bucky:// payload navigates
        // directly, anything else opens a PulseSearch results page.
        const parsed = parseInput(String(payload.url));
        start = parsed.kind === "url" ? parsed.url : buildSearchUrl(parsed.query);
    }
    if (start === "bucky://") start = HOME_URL;

    const recent = [];
    recordSearchTerm({ recent }, start);
    const page = resolvePage(null, start, recent);

    return {
        history: [start],
        index: 0,
        address: start,
        title: page.title,
        status: page.ok ? "loaded" : "error",
        recent
    };
}

/** Current address (the history entry the index points at). */
function currentUrl(state) {
    return state.history[state.index] || HOME_URL;
}

/** Append a navigation to history, truncating any forward entries. */
function pushHistory(state, url) {
    state.history = state.history.slice(0, state.index + 1);
    state.history.push(url);
    if (state.history.length > HISTORY_MAX) {
        state.history = state.history.slice(state.history.length - HISTORY_MAX);
    }
    state.index = state.history.length - 1;
}

/** Record a search query into the recent-searches list (deduped, newest first). */
function recordSearchTerm(state, url) {
    const { base, query } = parseUrl(url);
    if (base !== "bucky://search") return;
    const term = String(query.q || "").trim();
    if (!term) return;
    const lower = term.toLowerCase();
    state.recent = [term, ...(state.recent || []).filter((t) => t.toLowerCase() !== lower)].slice(0, 8);
}

// ----- Page resolution -------------------------------------------------------

/**
 * Resolve a bucky:// address to a renderable page.
 * @returns {{ok:boolean, title:string, html:string}}
 */
function resolvePage(runtime, url, recent) {
    const { base, query } = parseUrl(url);
    const registry = getBuckyNet();
    const entry = registry.resolve(base);

    if (!entry) {
        return { ok: false, title: "Page not found", html: renderNotFound(url) };
    }

    const ctx = {
        url,
        base,
        query,
        segments: pathSegments(url),
        registry,
        recent: recent || [],
        runtime
    };

    let out;
    try {
        out = entry.render(ctx);
    } catch (error) {
        logError(`site render(${base})`, error);
        return { ok: false, title: "Page error", html: renderError(url) };
    }

    if (typeof out === "string") {
        return { ok: true, title: entry.title || base, html: out };
    }
    return {
        ok: true,
        title: (out && out.title) || entry.title || base,
        html: (out && out.html) || ""
    };
}

// ----- Status pages ----------------------------------------------------------

function renderNotFound(url) {
    return `
        <div class="vm-browser-statuspage vm-browser-notfound">
            <span class="vm-browser-status-code">404</span>
            <h1>Node not found on the Grid</h1>
            <p>BuckyNet has no page at <code>${escapeHtml(url)}</code>.</p>
            <p>
                Check the address, or
                <a class="vm-site-link" data-bucky-link="${escapeHtml(HOME_URL)}">return to PulseSearch</a>.
            </p>
        </div>
    `;
}

function renderError(url) {
    return `
        <div class="vm-browser-statuspage vm-browser-notfound">
            <span class="vm-browser-status-code">ERR</span>
            <h1>This page hit a simulated fault</h1>
            <p>The BuckyNet node at <code>${escapeHtml(url)}</code> could not finish rendering.</p>
            <p>
                Try again, or
                <a class="vm-site-link" data-bucky-link="${escapeHtml(HOME_URL)}">return to PulseSearch</a>.
            </p>
        </div>
    `;
}

// ----- Rendering -------------------------------------------------------------

export function renderBrowserApp(runtime, windowState) {
    const state = windowState.appState;
    const url = currentUrl(state);
    const page = resolvePage(runtime, url, state.recent);
    const canBack = state.index > 0;
    const canForward = state.index < state.history.length - 1;

    return `
        <div class="vm-browser" data-browser-window="${windowState.id}">
            <div class="vm-browser-chrome">
                <div class="vm-browser-nav">
                    <button class="vm-browser-btn" type="button" data-browser-back
                            ${canBack ? "" : "disabled"} aria-label="Back" title="Back">&#8249;</button>
                    <button class="vm-browser-btn" type="button" data-browser-fwd
                            ${canForward ? "" : "disabled"} aria-label="Forward" title="Forward">&#8250;</button>
                    <button class="vm-browser-btn" type="button" data-browser-reload
                            aria-label="Reload" title="Reload">&#8635;</button>
                </div>
                <form class="vm-browser-omnibox" data-browser-omnibox>
                    <span class="vm-browser-omni-glyph" aria-hidden="true">&#9670;</span>
                    <input class="vm-browser-url" data-browser-url type="text"
                           value="${escapeHtml(url)}" spellcheck="false" autocomplete="off"
                           autocapitalize="off" aria-label="Address and search bar">
                </form>
                <div class="vm-browser-progress" data-browser-progress aria-hidden="true"></div>
            </div>
            <div class="vm-browser-viewport" data-browser-viewport>${page.html}</div>
        </div>
    `;
}

// ----- Navigation ------------------------------------------------------------

/**
 * Begin a navigation. Sets the loading state immediately (chrome patch only),
 * then commits after a short simulated latency. A navigation token makes the
 * latest navigation win — rapid clicks never produce a stale render.
 */
function navigate(runtime, windowState, url, opts) {
    const view = windowState.view;
    const state = windowState.appState;
    if (!view) return;

    let target = String(url || "").trim();
    if (!target || target === "bucky://") target = HOME_URL;

    const push = !opts || opts.push !== false;
    const token = (view.navToken || 0) + 1;
    view.navToken = token;

    state.status = "loading";
    if (view.refreshChrome) view.refreshChrome();

    window.clearTimeout(view.loadTimer);
    view.loadTimer = window.setTimeout(() => {
        if (token !== windowState.view.navToken) return; // superseded
        commitNavigation(runtime, windowState, target, push);
    }, LOAD_MS);
}

/** Land a navigation: resolve the page, update history, swap the viewport. */
function commitNavigation(runtime, windowState, url, push) {
    const view = windowState.view;
    const state = windowState.appState;
    if (!view || !view.viewport) return;

    const page = resolvePage(runtime, url, state.recent);
    if (push) pushHistory(state, url);

    state.address = url;
    state.title = page.title;
    state.status = page.ok ? "loaded" : "error";

    view.viewport.innerHTML = page.html;
    view.viewport.scrollTop = 0;
    if (view.urlInput) view.urlInput.value = url;
    if (view.refreshChrome) view.refreshChrome();

    runtime.setWindowTitle(windowState.id, page.title);
    recordSearchTerm(state, url);
}

function goBack(runtime, windowState) {
    const state = windowState.appState;
    if (state.index <= 0) return;
    state.index -= 1;
    navigate(runtime, windowState, currentUrl(state), { push: false });
}

function goForward(runtime, windowState) {
    const state = windowState.appState;
    if (state.index >= state.history.length - 1) return;
    state.index += 1;
    navigate(runtime, windowState, currentUrl(state), { push: false });
}

function reload(runtime, windowState) {
    navigate(runtime, windowState, currentUrl(windowState.appState), { push: false });
}

/** Omnibox / in-page search submit — classify the text, then navigate. */
function submitQuery(runtime, windowState, text) {
    const parsed = parseInput(text);
    const url = parsed.kind === "url" ? parsed.url : buildSearchUrl(parsed.query);
    navigate(runtime, windowState, url, { push: true });
}

// ----- Lifecycle -------------------------------------------------------------

export function mountBrowserApp(runtime, windowState, element) {
    const view = windowState.view;
    view.cleanups = [];
    view.navToken = 0;
    view.loadTimer = null;

    const appElement = element.querySelector(".vm-browser");
    view.appElement = appElement;
    if (!appElement) return;

    view.urlInput = appElement.querySelector("[data-browser-url]");
    view.viewport = appElement.querySelector("[data-browser-viewport]");
    view.backBtn = appElement.querySelector("[data-browser-back]");
    view.fwdBtn = appElement.querySelector("[data-browser-fwd]");

    // Targeted chrome patch — button enablement + the loading class. Never
    // rebuilds the chrome and never touches the omnibox value (commit does
    // that), so a caret in the URL bar always survives.
    view.refreshChrome = () => {
        const state = windowState.appState;
        if (view.backBtn) view.backBtn.disabled = state.index <= 0;
        if (view.fwdBtn) view.fwdBtn.disabled = state.index >= state.history.length - 1;
        appElement.classList.toggle("is-loading", state.status === "loading");
        appElement.classList.toggle("is-error", state.status === "error");
    };

    // Both the omnibox and any in-page PulseSearch box are <form>s; one
    // delegated submit handler classifies and routes them identically.
    appElement.addEventListener("submit", (event) => {
        const form = event.target.closest("form");
        if (!form) return;
        event.preventDefault();
        const input = form.querySelector("input");
        if (input) submitQuery(runtime, windowState, input.value);
    });

    // Delegated clicks: navigation controls + every internal bucky:// link.
    appElement.addEventListener("click", (event) => {
        if (event.target.closest("[data-browser-back]")) {
            goBack(runtime, windowState);
            return;
        }
        if (event.target.closest("[data-browser-fwd]")) {
            goForward(runtime, windowState);
            return;
        }
        if (event.target.closest("[data-browser-reload]")) {
            reload(runtime, windowState);
            return;
        }
        const linkEl = event.target.closest("[data-bucky-link]");
        if (linkEl) {
            event.preventDefault();
            const dest = linkEl.getAttribute("data-bucky-link");
            if (dest) navigate(runtime, windowState, dest, { push: true });
        }
    });

    view.refreshChrome();

    // A fresh window focuses the omnibox — standard new-window behaviour.
    if (runtime.activeWindowId === windowState.id && view.urlInput) {
        view.urlInput.focus({ preventScroll: true });
    }
}

export function unmountBrowserApp(runtime, windowState) {
    const view = windowState.view || {};
    window.clearTimeout(view.loadTimer);
    (view.cleanups || []).forEach((cleanup) => {
        try {
            cleanup();
        } catch (error) {
            logError("Browser cleanup", error);
        }
    });
}
