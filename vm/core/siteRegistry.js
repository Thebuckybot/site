/**
 * SiteRegistry — the BuckyNet content registry.
 *
 * The scalable directory behind the VM browser. Every page of the fictional
 * internet registers exactly one entry here; the browser resolves a `bucky://`
 * URL to an entry and calls its `render()`, and PulseSearch ranks entries by
 * their authored metadata.
 *
 * DOM-free (project principle): entries carry pure `render(ctx)` functions
 * that return HTML strings — the registry itself never touches the DOM. This
 * module is the single seam future systems plug into: dynamic dev posts,
 * backend-driven content, Discord-fed pages, OSINT datasets and
 * mission-triggered site updates all arrive as `register()` calls and never
 * require a change to the browser core.
 *
 * Entry shape:
 *   {
 *     id:          unique entry id
 *     url:         canonical "bucky://..." address (the routing key)
 *     site:        owning site id ("wiki" | "tube" | "dev" | "leaks" | "search")
 *     title:       page title (chrome + search result heading)
 *     type:        content type ("home" | "article" | "video" | "post" | ...)
 *     searchable:  whether PulseSearch may surface this entry
 *     keywords:    string[] — search match terms
 *     description: short snippet (search result text + page summary)
 *     tags:        string[] — lore / mission / category labels
 *     render(ctx): (ctx) => htmlString  OR  (ctx) => { title, html }
 *   }
 */

/** Canonical form of a URL used as the routing key: lower-case, no query, no trailing slash. */
export function normalizeUrl(url) {
    let value = String(url || "").trim().toLowerCase();
    const cut = value.search(/[?#]/);
    if (cut !== -1) value = value.slice(0, cut);
    if (value.length > "bucky://".length && value.endsWith("/")) {
        value = value.replace(/\/+$/, "");
    }
    return value;
}

/** Score one entry against a set of lower-case query tokens. */
function scoreEntry(entry, tokens) {
    const title = String(entry.title || "").toLowerCase();
    const description = String(entry.description || "").toLowerCase();
    const keywords = (entry.keywords || []).map((k) => String(k).toLowerCase());
    const tags = (entry.tags || []).map((t) => String(t).toLowerCase());
    let score = 0;

    tokens.forEach((token) => {
        if (keywords.some((k) => k === token)) score += 5;
        else if (keywords.some((k) => k.includes(token) || token.includes(k))) score += 3;
        if (title.includes(token)) score += 2;
        if (tags.some((t) => t.includes(token))) score += 2;
        if (description.includes(token)) score += 1;
    });
    return score;
}

/**
 * Create a SiteRegistry instance.
 * @returns the registry API (register / resolve / search / list / has / sites)
 */
export function createSiteRegistry() {
    /** @type {Map<string, object>} url -> entry */
    const entries = new Map();
    /**
     * Pattern-matched entries (Phase 4.3). A matcher carries `match(url)` and
     * `render(ctx)` instead of a fixed URL — the registry consults them only
     * when an exact-URL lookup misses, so existing static routes always win.
     * Used by `bucky://profile/<id>` and any other dynamic-id route that
     * doesn't enumerate all possible URLs at register time.
     */
    /** @type {object[]} */
    const matchers = [];

    /** Register (or replace) a site page. Returns the stored entry. */
    function register(entry) {
        if (!entry || !entry.url || typeof entry.render !== "function") {
            throw new Error("SiteRegistry.register: entry needs a url and a render() function");
        }
        const stored = {
            id: entry.id || entry.url,
            url: entry.url,
            site: entry.site || "",
            title: entry.title || entry.url,
            type: entry.type || "page",
            searchable: entry.searchable !== false,
            keywords: entry.keywords || [],
            description: entry.description || "",
            tags: entry.tags || [],
            render: entry.render
        };
        entries.set(normalizeUrl(entry.url), stored);
        return stored;
    }

    /**
     * Register a pattern-matched entry (Phase 4.3). Used for dynamic URL
     * spaces — e.g. `bucky://profile/<id>` — where pre-registering every URL
     * is impossible. Matchers are consulted ONLY when `resolve(url)` would
     * otherwise return null, so an exact-URL entry always wins.
     *
     * The `match(url)` predicate returns truthy for URLs the matcher should
     * own; on match, `render(ctx)` is called with the original URL on ctx
     * so the entry can extract whatever id / params it needs.
     */
    function registerMatcher(entry) {
        if (!entry || typeof entry.match !== "function" || typeof entry.render !== "function") {
            throw new Error("SiteRegistry.registerMatcher: entry needs match() and render()");
        }
        matchers.push({
            id: entry.id || ("matcher-" + matchers.length),
            site: entry.site || "",
            title: entry.title || "",
            type: entry.type || "page",
            searchable: false,  // dynamic ids don't belong in PulseSearch
            keywords: entry.keywords || [],
            description: entry.description || "",
            tags: entry.tags || [],
            match: entry.match,
            render: entry.render,
        });
        return entry;
    }

    /** Resolve a URL (query/fragment ignored) to its entry, or null. */
    function resolve(url) {
        const exact = entries.get(normalizeUrl(url));
        if (exact) return exact;
        // Fall through to pattern-matched entries (Phase 4.3). The original
        // (un-normalised) URL is passed in: matchers may want to keep the
        // case-sensitive id intact (Discord ids are numeric, so this is
        // currently lossless either way — kept defensive for the future).
        for (const m of matchers) {
            if (m.match(url)) {
                // Bind the matcher to this URL so navigation chrome (title /
                // history) can read the resolved-against URL.
                return {
                    id: m.id,
                    url: String(url || ""),
                    site: m.site,
                    title: m.title,
                    type: m.type,
                    searchable: false,
                    keywords: m.keywords,
                    description: m.description,
                    tags: m.tags,
                    render: (ctx) => m.render(String(url || ""), ctx),
                };
            }
        }
        return null;
    }

    /** True when a URL maps to a registered page or a matcher. */
    function has(url) {
        if (entries.has(normalizeUrl(url))) return true;
        return matchers.some((m) => m.match(url));
    }

    /**
     * Rank searchable entries against a free-text query.
     * @returns {{entry:object, score:number, snippet:string}[]} best first
     */
    function search(query) {
        const tokens = String(query || "")
            .toLowerCase()
            .split(/\s+/)
            .map((t) => t.trim())
            .filter(Boolean);
        if (!tokens.length) return [];

        const ranked = [];
        entries.forEach((entry) => {
            if (!entry.searchable) return;
            const score = scoreEntry(entry, tokens);
            if (score > 0) {
                ranked.push({ entry, score, snippet: entry.description });
            }
        });
        ranked.sort((a, b) => (b.score - a.score)
            || String(a.entry.title).localeCompare(String(b.entry.title)));
        return ranked;
    }

    /** All registered entries (insertion order). */
    function list() {
        return [...entries.values()];
    }

    /** Distinct owning-site ids present in the registry. */
    function sites() {
        return [...new Set([...entries.values()].map((e) => e.site).filter(Boolean))];
    }

    return { register, registerMatcher, resolve, has, search, list, sites };
}
