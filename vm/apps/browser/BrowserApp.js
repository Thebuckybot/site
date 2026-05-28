/**
 * Browser — the BuckyNet browser app.
 *
 * The in-universe web browser of the Bucky VM. It navigates and renders
 * BuckyNet: a window with a tab strip, back / forward / reload, an omnibox,
 * a bookmarks system, per-tab history, loading states, and a viewport that
 * renders bucky:// pages.
 *
 * Thin client. The browser resolves nothing itself: it asks the router to
 * classify the omnibox text, asks the SiteRegistry (via buckynet.js) to
 * resolve an address to a page, and renders the HTML string the page returns.
 *
 * Phase 3B — tabs:
 *   appState holds `tabs[]` and `activeTab`. Each tab is an independent
 *   browsing context with its own history, address, title, status and
 *   navigation token. Navigation always targets the active tab; a tab's
 *   in-flight load commits into THAT tab even if the operator has switched
 *   away — the viewport only swaps when the committing tab is still active.
 *
 * Live-app rendering discipline (see render-system.md):
 *   - render() builds the whole app body once and is the rebuild path after a
 *     full VM render — it reads state, never mutates it.
 *   - mount() captures nodes and binds two delegated listeners.
 *   - Navigation / tab ops patch the chrome and the tab strip and swap ONLY
 *     the viewport's innerHTML. The omnibox is never rebuilt, so its caret
 *     survives. No VM-wide rerender is ever triggered.
 *
 * Multi-instance: each launch opens an independent browser window.
 */
import { escapeHtml } from "../../core/util.js";
import { logError } from "../../core/diagnostics.js";
import { parseInput, parseUrl, pathSegments, buildSearchUrl } from "./router.js";
import { getBuckyNet } from "./buckynet.js";
import { bookmarkStore } from "./bookmarks.js";

/** Simulated BuckyNet latency (ms). Short, so rapid navigation stays smooth. */
const LOAD_MS = 220;
/** The PulseSearch homepage — the browser's start page and empty-address fallback. */
const HOME_URL = "bucky://search";
/** Per-tab history cap. */
const HISTORY_MAX = 50;

// ----- State -----------------------------------------------------------------

/** Build a fresh tab — an independent browsing context. */
function createTab(state, url) {
    state.tabSeq = (state.tabSeq || 0) + 1;
    const page = resolvePage(null, url, state.recent);
    return {
        id: `tab-${state.tabSeq}`,
        history: [url],
        index: 0,
        address: url,
        title: page.title,
        status: page.ok ? "loaded" : "error",
        navToken: 0,
        loadTimer: null
    };
}

export function createBrowserState(user, filesystem, payload) {
    let start = HOME_URL;
    if (payload && payload.url) {
        // The omnibox rule also governs intents: a bucky:// payload navigates
        // directly, anything else opens a PulseSearch results page.
        const parsed = parseInput(String(payload.url));
        start = parsed.kind === "url" ? parsed.url : buildSearchUrl(parsed.query);
    }
    if (start === "bucky://") start = HOME_URL;

    const state = { tabs: [], activeTab: 0, recent: [], tabSeq: 0 };
    recordSearchTerm(state, start);
    state.tabs.push(createTab(state, start));
    return state;
}

/** The focused tab. */
function activeTab(state) {
    return state.tabs[state.activeTab] || state.tabs[0] || null;
}

/** Current address of a tab (the history entry its index points at). */
function currentUrl(tab) {
    return tab.history[tab.index] || HOME_URL;
}

/** Append a navigation to a tab's history, truncating any forward entries. */
function pushHistory(tab, url) {
    tab.history = tab.history.slice(0, tab.index + 1);
    tab.history.push(url);
    if (tab.history.length > HISTORY_MAX) {
        tab.history = tab.history.slice(tab.history.length - HISTORY_MAX);
    }
    tab.index = tab.history.length - 1;
}

/** Record a search query into the per-window recent-searches list. */
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
        url, base, query,
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

// ----- Chrome rendering ------------------------------------------------------

/** Render the tab strip from state. */
function renderTabs(state) {
    const active = activeTab(state);
    const tabs = state.tabs.map((tab) => `
        <div class="vm-browser-tab${tab === active ? " is-active" : ""}${tab.status === "loading" ? " is-loading" : ""}"
             data-browser-tab="${escapeHtml(tab.id)}" title="${escapeHtml(tab.title)}">
            <span class="vm-browser-tab-dot" aria-hidden="true"></span>
            <span class="vm-browser-tab-title">${escapeHtml(tab.title)}</span>
            <button class="vm-browser-tab-close" type="button"
                    data-browser-tab-close="${escapeHtml(tab.id)}" aria-label="Close tab">&#10005;</button>
        </div>
    `).join("");
    return `${tabs}<button class="vm-browser-newtab" type="button" data-browser-newtab
            aria-label="New tab" title="New tab">+</button>`;
}

/** Render the bookmarks dropdown panel from the shared store. */
function renderBookmarksPanel() {
    const items = bookmarkStore.list();
    const head = `<div class="vm-browser-bm-head">Bookmarks</div>`;
    if (!items.length) {
        return `${head}<p class="vm-browser-bm-empty">No bookmarks yet — use the star to save a page.</p>`;
    }
    const rows = items.map((item) => `
        <div class="vm-browser-bm-row">
            <button class="vm-browser-bm-open" type="button" data-browser-bm-open="${escapeHtml(item.url)}">
                <span class="vm-browser-bm-title">${escapeHtml(item.title)}</span>
                <span class="vm-browser-bm-url">${escapeHtml(item.url)}</span>
            </button>
            <button class="vm-browser-bm-remove" type="button"
                    data-browser-bm-remove="${escapeHtml(item.url)}" aria-label="Remove bookmark">&#10005;</button>
        </div>
    `).join("");
    return `${head}<div class="vm-browser-bm-list">${rows}</div>`;
}

export function renderBrowserApp(runtime, windowState) {
    const state = windowState.appState;
    const tab = activeTab(state);
    const url = currentUrl(tab);
    const page = resolvePage(runtime, url, state.recent);
    const canBack = tab.index > 0;
    const canForward = tab.index < tab.history.length - 1;
    const marked = bookmarkStore.has(url);

    return `
        <div class="vm-browser" data-browser-window="${windowState.id}">
            <div class="vm-browser-tabstrip" data-browser-tabs>${renderTabs(state)}</div>
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
                <div class="vm-browser-tools">
                    <button class="vm-browser-btn vm-browser-star${marked ? " is-active" : ""}" type="button"
                            data-browser-bookmark aria-pressed="${marked ? "true" : "false"}"
                            title="${marked ? "Remove bookmark" : "Bookmark this page"}">&#9733;</button>
                    <button class="vm-browser-btn" type="button" data-browser-bm-toggle
                            aria-label="Bookmarks" title="Bookmarks">&#9776;</button>
                </div>
                <div class="vm-browser-progress" data-browser-progress aria-hidden="true"></div>
            </div>
            <div class="vm-browser-bmpanel" data-browser-bm-panel hidden>${renderBookmarksPanel()}</div>
            <div class="vm-browser-viewport" data-browser-viewport>${page.html}</div>
        </div>
    `;
}

// ----- Targeted refreshers ---------------------------------------------------

/** Patch the chrome — button enablement, loading class, bookmark star. */
function refreshChrome(windowState) {
    const view = windowState.view;
    const tab = activeTab(windowState.appState);
    if (!view || !view.appElement || !tab) return;
    if (view.backBtn) view.backBtn.disabled = tab.index <= 0;
    if (view.fwdBtn) view.fwdBtn.disabled = tab.index >= tab.history.length - 1;
    view.appElement.classList.toggle("is-loading", tab.status === "loading");
    view.appElement.classList.toggle("is-error", tab.status === "error");
    if (view.bookmarkBtn) {
        const marked = bookmarkStore.has(currentUrl(tab));
        view.bookmarkBtn.classList.toggle("is-active", marked);
        view.bookmarkBtn.setAttribute("aria-pressed", marked ? "true" : "false");
        view.bookmarkBtn.title = marked ? "Remove bookmark" : "Bookmark this page";
    }
}

/** Re-render the tab strip (a small, transient-state-free sub-region). */
function refreshTabs(windowState) {
    const view = windowState.view;
    if (view && view.tabStrip) view.tabStrip.innerHTML = renderTabs(windowState.appState);
}

/** Re-render the bookmarks panel contents. */
function refreshBookmarks(windowState) {
    const view = windowState.view;
    if (view && view.bmPanel) view.bmPanel.innerHTML = renderBookmarksPanel();
}

/** Render the active tab's current page into the viewport and sync chrome. */
function showActiveTab(runtime, windowState) {
    const view = windowState.view;
    const state = windowState.appState;
    const tab = activeTab(state);
    if (!view || !view.viewport || !tab) return;
    const page = resolvePage(runtime, currentUrl(tab), state.recent);
    view.viewport.innerHTML = page.html;
    view.viewport.scrollTop = 0;
    if (view.urlInput) view.urlInput.value = tab.address;
    refreshChrome(windowState);
    runtime.setWindowTitle(windowState.id, tab.title);
}

// ----- Navigation ------------------------------------------------------------

/**
 * Begin a navigation on the active tab. Sets the loading state immediately
 * (chrome + tab-strip patch), then commits after a short simulated latency. A
 * per-tab navigation token makes the latest navigation win.
 */
function navigate(runtime, windowState, url, opts) {
    const view = windowState.view;
    const tab = activeTab(windowState.appState);
    if (!view || !tab) return;

    let target = String(url || "").trim();
    if (!target || target === "bucky://") target = HOME_URL;

    const push = !opts || opts.push !== false;
    const token = (tab.navToken || 0) + 1;
    tab.navToken = token;

    tab.status = "loading";
    refreshChrome(windowState);
    refreshTabs(windowState);

    window.clearTimeout(tab.loadTimer);
    tab.loadTimer = window.setTimeout(() => {
        if (token !== tab.navToken) return; // superseded
        commitNavigation(runtime, windowState, tab, target, push);
    }, LOAD_MS);
}

/** Land a navigation into its tab. The viewport only swaps if the tab is active. */
function commitNavigation(runtime, windowState, tab, url, push) {
    const view = windowState.view;
    const state = windowState.appState;
    if (!view) return;

    const page = resolvePage(runtime, url, state.recent);
    if (push) pushHistory(tab, url);

    tab.address = url;
    tab.title = page.title;
    tab.status = page.ok ? "loaded" : "error";
    recordSearchTerm(state, url);

    if (activeTab(state) === tab && view.viewport) {
        view.viewport.innerHTML = page.html;
        view.viewport.scrollTop = 0;
        if (view.urlInput) view.urlInput.value = url;
        refreshChrome(windowState);
        runtime.setWindowTitle(windowState.id, page.title);
    }
    refreshTabs(windowState);
}

function goBack(runtime, windowState) {
    const tab = activeTab(windowState.appState);
    if (!tab || tab.index <= 0) return;
    tab.index -= 1;
    navigate(runtime, windowState, currentUrl(tab), { push: false });
}

function goForward(runtime, windowState) {
    const tab = activeTab(windowState.appState);
    if (!tab || tab.index >= tab.history.length - 1) return;
    tab.index += 1;
    navigate(runtime, windowState, currentUrl(tab), { push: false });
}

function reload(runtime, windowState) {
    const tab = activeTab(windowState.appState);
    if (tab) navigate(runtime, windowState, currentUrl(tab), { push: false });
}

/** Omnibox / in-page search submit — classify the text, then navigate. */
function submitQuery(runtime, windowState, text) {
    const parsed = parseInput(text);
    const url = parsed.kind === "url" ? parsed.url : buildSearchUrl(parsed.query);
    navigate(runtime, windowState, url, { push: true });
}

// ----- Tab operations --------------------------------------------------------

function focusOmnibox(windowState) {
    const input = windowState.view && windowState.view.urlInput;
    if (input) input.focus({ preventScroll: true });
}

function switchTab(runtime, windowState, tabId) {
    const state = windowState.appState;
    const index = state.tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1 || index === state.activeTab) return;
    state.activeTab = index;
    refreshTabs(windowState);
    showActiveTab(runtime, windowState);
    closeBookmarksPanel(windowState);
}

function openTab(runtime, windowState) {
    const state = windowState.appState;
    state.tabs.push(createTab(state, HOME_URL));
    state.activeTab = state.tabs.length - 1;
    refreshTabs(windowState);
    showActiveTab(runtime, windowState);
    closeBookmarksPanel(windowState);
    focusOmnibox(windowState);
}

/** Close a tab. Closing the last tab closes the browser window. */
function closeTab(runtime, windowState, tabId) {
    const state = windowState.appState;
    if (state.tabs.length <= 1) {
        runtime.closeWindow(windowState.id);
        return;
    }
    const index = state.tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1) return;

    const wasActive = activeTab(state);
    const closing = state.tabs[index];
    window.clearTimeout(closing.loadTimer);
    closing.navToken = (closing.navToken || 0) + 1; // invalidate any in-flight load

    state.tabs.splice(index, 1);
    if (index < state.activeTab) state.activeTab -= 1;
    else if (index === state.activeTab) state.activeTab = Math.min(index, state.tabs.length - 1);

    refreshTabs(windowState);
    if (activeTab(state) !== wasActive) showActiveTab(runtime, windowState);
}

// ----- Bookmark operations ---------------------------------------------------

function toggleBookmark(runtime, windowState) {
    const tab = activeTab(windowState.appState);
    if (!tab) return;
    bookmarkStore.toggle(currentUrl(tab), tab.title);
    refreshChrome(windowState);
    if (windowState.view.bookmarksOpen) refreshBookmarks(windowState);
}

function closeBookmarksPanel(windowState) {
    const view = windowState.view;
    if (!view || !view.bookmarksOpen) return;
    view.bookmarksOpen = false;
    if (view.bmPanel) view.bmPanel.hidden = true;
}

function toggleBookmarksPanel(windowState) {
    const view = windowState.view;
    if (!view || !view.bmPanel) return;
    view.bookmarksOpen = !view.bookmarksOpen;
    if (view.bookmarksOpen) refreshBookmarks(windowState);
    view.bmPanel.hidden = !view.bookmarksOpen;
}

// ----- Lifecycle -------------------------------------------------------------

export function mountBrowserApp(runtime, windowState, element) {
    const view = windowState.view;
    view.cleanups = [];
    view.bookmarksOpen = false;

    const appElement = element.querySelector(".vm-browser");
    view.appElement = appElement;
    if (!appElement) return;

    view.tabStrip = appElement.querySelector("[data-browser-tabs]");
    view.urlInput = appElement.querySelector("[data-browser-url]");
    view.viewport = appElement.querySelector("[data-browser-viewport]");
    view.backBtn = appElement.querySelector("[data-browser-back]");
    view.fwdBtn = appElement.querySelector("[data-browser-fwd]");
    view.bookmarkBtn = appElement.querySelector("[data-browser-bookmark]");
    view.bmPanel = appElement.querySelector("[data-browser-bm-panel]");

    // Both the omnibox and any in-page PulseSearch box are <form>s; one
    // delegated submit handler classifies and routes them identically.
    appElement.addEventListener("submit", (event) => {
        const form = event.target.closest("form");
        if (!form) return;
        event.preventDefault();
        const input = form.querySelector("input");
        if (input) submitQuery(runtime, windowState, input.value);
    });

    // One delegated click handler for the whole app — controls, tabs,
    // bookmarks and every internal bucky:// link.
    appElement.addEventListener("click", (event) => {
        const target = event.target;

        if (target.closest("[data-browser-back]")) { goBack(runtime, windowState); return; }
        if (target.closest("[data-browser-fwd]")) { goForward(runtime, windowState); return; }
        if (target.closest("[data-browser-reload]")) { reload(runtime, windowState); return; }

        const closeEl = target.closest("[data-browser-tab-close]");
        if (closeEl) { closeTab(runtime, windowState, closeEl.getAttribute("data-browser-tab-close")); return; }
        const tabEl = target.closest("[data-browser-tab]");
        if (tabEl) { switchTab(runtime, windowState, tabEl.getAttribute("data-browser-tab")); return; }
        if (target.closest("[data-browser-newtab]")) { openTab(runtime, windowState); return; }

        if (target.closest("[data-browser-bookmark]")) { toggleBookmark(runtime, windowState); return; }
        if (target.closest("[data-browser-bm-toggle]")) { toggleBookmarksPanel(windowState); return; }
        const bmOpen = target.closest("[data-browser-bm-open]");
        if (bmOpen) {
            closeBookmarksPanel(windowState);
            navigate(runtime, windowState, bmOpen.getAttribute("data-browser-bm-open"), { push: true });
            return;
        }
        const bmRemove = target.closest("[data-browser-bm-remove]");
        if (bmRemove) {
            bookmarkStore.remove(bmRemove.getAttribute("data-browser-bm-remove"));
            refreshBookmarks(windowState);
            refreshChrome(windowState);
            return;
        }

        const linkEl = target.closest("[data-bucky-link]");
        if (linkEl) {
            event.preventDefault();
            const dest = linkEl.getAttribute("data-bucky-link");
            if (dest) navigate(runtime, windowState, dest, { push: true });
            return;
        }

        // A click anywhere else closes an open bookmarks panel.
        if (view.bookmarksOpen && !target.closest("[data-browser-bm-panel]")) {
            closeBookmarksPanel(windowState);
        }
    });

    refreshChrome(windowState);

    // Phase 4.3 polish - re-render the active tab on late hydration.
    // The identity-aware sites (profile / organizations / leaderboards /
    // pulse) emit `bucky:hydrated` after a successful soft-refresh. If the
    // user is currently sitting on an identity-aware URL whose data was
    // still being fetched at first render, the page re-renders in place
    // with the fresh content. We target ONLY identity-aware URLs so a
    // hydration event doesn't disturb static lore pages, and we never
    // disturb a tab that is currently loading another navigation. A small
    // debounce coalesces back-to-back hydrations (e.g. pulse fans out four
    // parallel fetches that all land within ~20ms).
    let hydrationTimer = null;
    const hydrationListener = (_event) => {
        if (hydrationTimer) return;
        hydrationTimer = setTimeout(() => {
            hydrationTimer = null;
            try {
                const tab = activeTab(windowState.appState);
                if (!tab) return;
                const url = String(tab.address || "");
                if (!isIdentityAwareUrl(url)) return;
                if (tab.status === "loading") return;
                // resolvePage is pure + idempotent and the site cache now
                // holds fresh data, so render() picks it up.
                showActiveTab(runtime, windowState);
            } catch (error) {
                logError("Hydration re-render", error);
            }
        }, 30);
    };
    if (typeof window !== "undefined" && window.addEventListener) {
        window.addEventListener("bucky:hydrated", hydrationListener);
        view.cleanups.push(() => {
            if (hydrationTimer) { clearTimeout(hydrationTimer); hydrationTimer = null; }
            window.removeEventListener("bucky:hydrated", hydrationListener);
        });
    }

    // A fresh window focuses the omnibox - standard new-window behaviour.
    if (runtime.activeWindowId === windowState.id) focusOmnibox(windowState);
}

/**
 * Phase 4.3 polish - URLs that consume identity-aware backend data and
 * therefore benefit from re-rendering on late hydration. Static lore pages
 * (wiki, tube, bucky, etc.) deliberately stay out of this set so a hydration
 * event never re-renders pages that don't depend on fetched state.
 */
function isIdentityAwareUrl(url) {
    if (!url) return false;
    const u = String(url).toLowerCase();
    return u.startsWith("bucky://profile")
        || u.startsWith("bucky://organizations")
        || u.startsWith("bucky://leaderboards")
        || u.startsWith("bucky://pulse")
        || u.startsWith("bucky://leaks")
        || u.startsWith("bucky://incidents");
}

export function unmountBrowserApp(runtime, windowState) {
    const state = windowState.appState || {};
    (state.tabs || []).forEach((tab) => window.clearTimeout(tab.loadTimer));
    const view = windowState.view || {};
    (view.cleanups || []).forEach((cleanup) => {
        try {
            cleanup();
        } catch (error) {
            logError("Browser cleanup", error);
        }
    });
}
