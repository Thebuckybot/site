/**
 * worldfeed.js — generic world-content feed-site factory (Phase 4.2 stabilisation).
 *
 * WHAT THIS IS
 *   `createWorldFeedSite(config)` returns the `register / refresh / invalidate`
 *   trio for one VM site bound to one OR more `world_content` domains. It is
 *   the partitioning fix: every world-content VM page shares this proven
 *   machinery so each page renders ONLY its intended domain(s), and a new
 *   page is one config — no duplicated soft-refresh, no duplicated render.
 *
 * WHY A FACTORY (project rule: no duplicate logic)
 *   The Phase 4.1 dev-feed pattern (seed + live + soft refresh) and the Phase
 *   4.2 news-feed pattern are identical except for the domain set, the URL,
 *   and the bundled seed content. Copying that machinery for each new feed
 *   would duplicate the soft-refresh lifecycle 4+ times. The factory captures
 *   it once.
 *
 * PARTITIONING CONTRACT
 *   Each factory instance is bound to a fixed `config.domains` set. The fetch
 *   ALWAYS narrows to that set:
 *     - one domain  -> GET /api/worldcontent/<domain>  (server-side filter)
 *     - many        -> GET /api/worldcontent           (combined feed)
 *   On top of that, items are ALWAYS filtered client-side against the set, so
 *   nothing outside the site's domains can leak in (defensive partitioning).
 *
 * SHARED INFRASTRUCTURE
 *   - GatewayClient for the fetch (Phase 4.1 layer, untouched).
 *   - SiteRegistry for registration (project's stable seam, untouched).
 *   - The proven `vm-dev-*` feed styles (no VM stylesheet change needed).
 *   - The site kit (`./kit.js`) and `core/markdown.js` for safe rendering.
 *
 * SOFT REFRESH (preserved verbatim from the Phase 4.2 news lifecycle)
 *   `renderHome()` calls `maybeSoftRefresh()`. When `feedState.fetchedAt` is
 *   older than `gatewayClient.softRefreshTtl` and no fetch is in flight, a
 *   background re-fetch starts. The current render is unaffected and instant;
 *   the next render shows the fresh content. `invalidate()` forces staleness
 *   so the next render re-fetches immediately.
 *
 * COLLISION GUARDS
 *   - Reserved URL guard: if the site already has a non-feed page at the same
 *     URL (e.g. `bucky://leaks/exposed-accounts` is a Phase 4.1 page), the
 *     factory skips that live item registration. Core navigation always wins.
 *   - Item slugs are required and non-empty. Slug-less backend rows are dropped.
 *
 * Each `createWorldFeedSite(...)` call is an INDEPENDENT instance with its
 * own private state — calling it twice gives two unrelated sites.
 */
import { escapeHtml, link, chip, sitePage, crossRefs } from "./kit.js";
import { renderMarkdown } from "../../../core/markdown.js";
import { gatewayClient } from "../../../core/gatewayClient.js";

const DEFAULT_TTL = 60000;

/** Format an ISO timestamp into a short human date; pass other strings through. */
function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric"
    });
}

/** Turn a category token ("patch_notes") into a label ("Patch Notes"). */
function prettyCategory(token, fallback) {
    const words = String(token || fallback || "general").split(/[_\s-]+/).filter(Boolean);
    if (!words.length) return fallback || "Update";
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Create a world-content feed site.
 *
 * @param {object} config
 * @param {string}   config.siteId         SiteRegistry site id (e.g. "news")
 * @param {string}   config.siteUrl        canonical home URL (e.g. "bucky://news")
 * @param {string}   config.siteTitle      page title
 * @param {string}   config.siteLead       page subhead lead
 * @param {string}   config.siteDomain     visible domain-bar label
 * @param {string}   config.introText      intro paragraph (plain text, escaped on render)
 * @param {string[]} config.domains        world_content domain set this site renders
 * @param {object[]} [config.seedItems]    bundled fallback items
 * @param {object[]} [config.crossRefs]    cross-refs for the home
 * @param {string[]} [config.homeKeywords] PulseSearch keywords for the home
 * @param {string[]} [config.homeTags]     PulseSearch tags for the home
 * @param {string}   [config.fallbackCategoryLabel]  label for missing categories
 * @param {string}   [config.fallbackAuthor]         label for missing authors
 * @param {number}   [config.ttlMs]        soft-refresh TTL (defaults to gateway shared TTL)
 *
 * @returns {{ register: function, refresh: function, invalidate: function, state: function }}
 */
export function createWorldFeedSite(config) {
    if (!config || !config.siteId || !config.siteUrl) {
        throw new Error("createWorldFeedSite: siteId and siteUrl are required");
    }
    const domains = Array.isArray(config.domains) ? config.domains.slice() : [];
    if (!domains.length) {
        throw new Error(`createWorldFeedSite[${config.siteId}]: at least one domain required`);
    }
    const domainSet = new Set(domains);

    const SITE = config.siteId;
    const SITE_URL = config.siteUrl;
    const SITE_DOMAIN = config.siteDomain || config.siteTitle || SITE;
    const SEED = Array.isArray(config.seedItems) ? config.seedItems.slice() : [];
    const HOME_KEYWORDS = config.homeKeywords || [SITE];
    const HOME_TAGS = config.homeTags || [SITE];
    const FALLBACK_CATEGORY = config.fallbackCategoryLabel || "Update";
    const FALLBACK_AUTHOR = config.fallbackAuthor || "Bucky Network";
    const TTL = Number(config.ttlMs || gatewayClient.softRefreshTtl || DEFAULT_TTL);

    // --- private per-instance state ---------------------------------------
    const feedState = { status: "seed", items: SEED.slice(), fetchedAt: 0 };
    let registry = null;
    let fetchInFlight = false;
    /** URLs we registered as live items, so we can avoid re-touching reserved pages. */
    const reservedSnapshot = new Set();

    function itemUrl(slug) {
        return slug ? `${SITE_URL}/${slug}` : SITE_URL;
    }

    /** Normalise a backend world-content item into the renderer shape. */
    function normalizeLiveItem(item) {
        const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
        return {
            slug: String(item.slug || ""),
            domain: String(item.domain || ""),
            date: formatDate(item.published_at || item.created_at),
            category: prettyCategory(item.category, FALLBACK_CATEGORY),
            author: item.author || FALLBACK_AUTHOR,
            title: item.title || "Untitled",
            summary: item.summary || "",
            keywords: tags,
            tags,
            body: typeof item.body === "string" ? item.body : "",
            crossRefs: [],
            featured: !!item.featured,
            priority: String(item.priority || "normal"),
            live: true
        };
    }

    // --- rendering --------------------------------------------------------
    function itemMeta(item) {
        const featured = item.featured
            ? `<span class="vm-dev-featured" title="Featured">★ Featured</span>`
            : "";
        const priority = (item.priority === "high" || item.priority === "critical")
            ? `<span class="vm-dev-priority vm-dev-priority-${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span>`
            : "";
        return `
            <div class="vm-dev-meta">
                ${chip(item.category)}
                ${featured}
                ${priority}
                <span class="vm-dev-date">${escapeHtml(item.date)}</span>
                <span class="vm-dev-author">${escapeHtml(item.author)}</span>
            </div>
        `;
    }

    function renderItemBody(item) {
        return `<div class="vm-dev-md">${renderMarkdown(String(item.body || ""))}</div>`;
    }

    function renderItem(item) {
        // In itemsOnly mode the host site owns the home so renderHome is never
        // the staleness trigger — let item-page renders carry that duty too.
        if (config.itemsOnly) maybeSoftRefresh();

        const body = `
            <div class="vm-dev-post">
                ${itemMeta(item)}
                <div class="vm-wiki-body">
                    ${renderItemBody(item)}
                    ${crossRefs("Across BuckyNet", item.crossRefs)}
                </div>
                <div class="vm-dev-back">${link(SITE_URL, "‹ All " + (config.backLabel || "items"))}</div>
            </div>
        `;
        return sitePage({
            site: SITE,
            domain: `${SITE_DOMAIN} · ${itemUrl(item.slug)}`,
            title: item.title,
            lead: item.summary,
            bodyHtml: body
        });
    }

    function renderFeedStatus() {
        const status = feedState.status;
        if (status === "live") {
            return `<div class="vm-dev-feedstatus is-live">
                <span class="vm-dev-feeddot"></span>Live feed online — ${feedState.items.length} item(s) served by the backend.
            </div>`;
        }
        if (status === "empty") {
            return `<div class="vm-dev-feedstatus is-idle">
                <span class="vm-dev-feeddot"></span>Live feed online — nothing published yet. Showing the bundled briefing.
            </div>`;
        }
        if (status === "offline") {
            return `<div class="vm-dev-feedstatus is-offline">
                <span class="vm-dev-feeddot"></span>Live feed offline — showing the bundled briefing.
            </div>`;
        }
        return `<div class="vm-dev-feedstatus is-loading">
            <span class="vm-dev-feeddot"></span>Connecting to the live feed…
        </div>`;
    }

    function renderHome() {
        // A render is itself the staleness trigger — fire-and-forget.
        maybeSoftRefresh();

        const items = feedState.items.slice().sort(
            (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0)
        );
        const feed = items.map((item) => `
            <article class="vm-dev-card vm-dev-card-${escapeHtml((item.category || SITE).toLowerCase().replace(/\s+/g, "-"))}${item.featured ? " vm-dev-card-featured" : ""}">
                ${itemMeta(item)}
                ${link(itemUrl(item.slug), item.title, "vm-dev-card-title")}
                <p class="vm-dev-card-summary">${escapeHtml(item.summary)}</p>
                <div class="vm-dev-card-foot">
                    <div class="vm-site-chiprow">${(item.tags || []).map((tag) => chip(tag)).join("")}</div>
                    ${link(itemUrl(item.slug), "Read ›")}
                </div>
            </article>
        `).join("");
        const intro = config.introText
            ? `<p class="vm-wiki-intro">${escapeHtml(config.introText)}</p>` : "";
        const refs = Array.isArray(config.crossRefs) && config.crossRefs.length
            ? crossRefs("Across BuckyNet", config.crossRefs) : "";
        const body = `
            <div class="vm-wiki-body">
                ${intro}
                ${renderFeedStatus()}
                <div class="vm-dev-feed">${feed || `<p class="vm-dev-note">Nothing to show yet.</p>`}</div>
                ${refs}
            </div>
        `;
        return sitePage({
            site: SITE,
            domain: `${SITE_DOMAIN} · ${SITE_URL}`,
            title: config.siteTitle || SITE,
            lead: config.siteLead || "",
            bodyHtml: body
        });
    }

    // --- registration -----------------------------------------------------
    function registerItemEntry(reg, item, searchable) {
        const url = itemUrl(item.slug);
        // Collision guard: never overwrite a reserved (non-feed) page that was
        // present at registerSite time (e.g. bucky://leaks/exposed-accounts).
        if (reservedSnapshot.has(url)) return;
        reg.register({
            id: `${SITE}-${item.slug}`,
            url,
            site: SITE,
            title: item.title,
            type: "post",
            searchable: searchable !== false,
            keywords: item.keywords || item.tags || [],
            description: item.summary,
            tags: item.tags || [],
            render: () => renderItem(item)
        });
    }

    function register(reg) {
        registry = reg;

        // Snapshot any URLs already registered under this site's URL prefix so
        // we never overwrite them with a colliding live-item slug.
        if (typeof reg.list === "function") {
            const prefix = SITE_URL + "/";
            reg.list().forEach((entry) => {
                if (entry && typeof entry.url === "string" && entry.url.startsWith(prefix)) {
                    reservedSnapshot.add(entry.url);
                }
            });
            // In itemsOnly mode the home is owned by another module (e.g. the
            // Phase 4.1 leaks.js owns bucky://leaks). Snapshot it too so we
            // never touch it.
            if (config.itemsOnly) {
                const homeEntry = reg.list().find((e) => e && e.url === SITE_URL);
                if (homeEntry) reservedSnapshot.add(SITE_URL);
            }
        }

        if (!config.itemsOnly) {
            // The home renderer reads feedState live — register it once.
            reg.register({
                id: `${SITE}-home`,
                url: SITE_URL,
                site: SITE,
                title: config.siteTitle || SITE,
                type: "home",
                keywords: HOME_KEYWORDS,
                description: config.siteLead || (config.siteTitle || SITE),
                tags: HOME_TAGS,
                render: () => renderHome()
            });
        }

        // Seed item pages — instantly available, offline fallback.
        SEED.forEach((item) => registerItemEntry(reg, item, true));

        // Kick the first live fetch (fire-and-forget; never blocks boot).
        refresh();
    }

    // --- soft refresh -----------------------------------------------------
    function invalidate() {
        feedState.fetchedAt = 0;
    }

    function maybeSoftRefresh() {
        if (fetchInFlight) return;
        const age = Date.now() - feedState.fetchedAt;
        if (feedState.fetchedAt !== 0 && age < TTL) return;
        refresh();
    }

    async function fetchForDomains() {
        // Single-domain pages use the server-side filtered endpoint; multi-
        // domain pages use the combined feed. Either way, we filter
        // client-side against `domainSet` as a defensive partition guard.
        if (domains.length === 1) {
            return gatewayClient.fetchWorldContentDomain(domains[0]);
        }
        return gatewayClient.fetchWorldContent();
    }

    async function refresh() {
        if (fetchInFlight) return;
        fetchInFlight = true;
        const firstLoad = feedState.fetchedAt === 0;
        if (firstLoad) feedState.status = "loading";

        let result;
        try {
            result = await fetchForDomains();
        } catch (_error) {
            result = { ok: false };
        } finally {
            fetchInFlight = false;
        }

        // Every completed attempt — success or failure — ages the feed.
        feedState.fetchedAt = Date.now();

        if (!result || !result.ok || !result.data) {
            feedState.status = "offline";
            return;
        }

        const data = result.data;
        const rawItems = Array.isArray(data.items) ? data.items : [];

        if (!data.available) {
            feedState.status = "offline";
            return;
        }
        if (!rawItems.length) {
            feedState.status = "empty";
            return;
        }

        // Defensive partition: keep only items in this site's domain set.
        // This is what guarantees, for example, that a leak never appears on
        // bucky://news even if a future endpoint accidentally returns one.
        const filtered = rawItems.filter((item) =>
            domainSet.has(String(item.domain || ""))
        );
        if (!filtered.length) {
            feedState.status = "empty";
            return;
        }

        const liveItems = filtered
            .map(normalizeLiveItem)
            .filter((item) => item.slug);

        if (!liveItems.length) {
            feedState.status = "empty";
            return;
        }

        // Featured first; backend already orders them, this is defensive.
        liveItems.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));

        if (registry) {
            liveItems.forEach((item) => registerItemEntry(registry, item, true));
            // Demote seed pages out of PulseSearch; they stay directly routable.
            SEED.forEach((item) => registerItemEntry(registry, item, false));
        }

        feedState.items = liveItems;
        feedState.status = "live";
    }

    return {
        register,
        refresh,
        invalidate,
        // Read-only state probe (for debugging / future hooks).
        state: () => ({ status: feedState.status, count: feedState.items.length,
                        fetchedAt: feedState.fetchedAt, domains: domains.slice() }),
    };
}
