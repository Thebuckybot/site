/**
 * Bookmarks — the shared BuckyNet bookmark store.
 *
 * A single module-level store shared by every browser window, so a page
 * bookmarked in one window is bookmarked everywhere — the browser behaves
 * like one application, not a set of isolated windows.
 *
 * Persistence-ready: the store is a plain list behind a small API. A future
 * PersistenceService (per-user, backend-synced bookmarks) only needs to
 * hydrate `items` on load and observe `add`/`remove` — no browser, tab or
 * site code changes. That is the single seam Phase 3B leaves for the backend.
 *
 * DOM-free: the store holds data only. Windows read it when they render and
 * re-read it when they re-render; there is no global rerender and no pub/sub
 * to leak (project principle: avoid listener leaks, avoid full rerenders).
 */

/** @type {{url:string, title:string}[]} */
const items = [
    { url: "bucky://bucky", title: "Bucky" },
    { url: "bucky://wiki", title: "BuckyWiki" },
    { url: "bucky://community", title: "Bucky Community" }
];

/** Canonicalise a URL for identity comparison (mirrors the router/registry rule). */
function normalize(url) {
    return String(url || "").trim().toLowerCase().replace(/\/+$/, "");
}

export const bookmarkStore = {
    /** All bookmarks, newest-added last (a fresh array — callers cannot mutate the store). */
    list() {
        return items.map((item) => ({ ...item }));
    },

    /** True when a URL is bookmarked. */
    has(url) {
        const key = normalize(url);
        return items.some((item) => normalize(item.url) === key);
    },

    /** Add a bookmark (no-op if already present). */
    add(url, title) {
        if (!url || this.has(url)) return;
        items.push({ url: String(url), title: String(title || url) });
    },

    /** Remove a bookmark by URL. */
    remove(url) {
        const key = normalize(url);
        const index = items.findIndex((item) => normalize(item.url) === key);
        if (index !== -1) items.splice(index, 1);
    },

    /**
     * Toggle a URL's bookmark state.
     * @returns {boolean} the new state — true if now bookmarked.
     */
    toggle(url, title) {
        if (this.has(url)) {
            this.remove(url);
            return false;
        }
        this.add(url, title);
        return true;
    }
};
