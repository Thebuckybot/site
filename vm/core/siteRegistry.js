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

    /** Resolve a URL (query/fragment ignored) to its entry, or null. */
    function resolve(url) {
        return entries.get(normalizeUrl(url)) || null;
    }

    /** True when a URL maps to a registered page. */
    function has(url) {
        return entries.has(normalizeUrl(url));
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

    return { register, resolve, has, search, list, sites };
}
