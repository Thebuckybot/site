/**
 * Bucky News — bucky://news
 *
 * Phase 4.2 — the SHARED WORLD-CONTENT VM PAGE.
 *   bucky://news is the live feed for the shared `world_content` backend
 *   domain. Phase 4.1 wired bucky://dev to the dedicated `dev_posts` table;
 *   Phase 4.2 adds this sibling site for the multi-domain world-content layer.
 *   It renders the ANNOUNCEMENTS domain - the first proven world-content
 *   domain - and its renderers are written domain-agnostically, so pointing it
 *   at the combined `/api/worldcontent` feed later needs no rendering change.
 *
 *   On load it fetches announcements from the backend gateway
 *   (GET /api/worldcontent/announcement via core/gatewayClient) and renders
 *   them. The bundled SEED_NEWS array below is the SEED / FALLBACK: it renders
 *   instantly and is what the site shows whenever the backend is unreachable,
 *   unconfigured, or has no announcements yet - so a backend hiccup never
 *   breaks the VM sandbox (graceful degradation).
 *
 * SOFT REFRESH (Phase 4.2 — the lightweight refresh lifecycle):
 *   Unlike the Phase 4.1 dev feed, which fetches exactly once per VM session,
 *   bucky://news supports a SOFT REFRESH. `renderHome()` calls
 *   `maybeSoftRefresh()`: when the feed is older than the shared TTL it kicks a
 *   background re-fetch (fire-and-forget). The current render uses current
 *   state and is instant; the next render of the page - e.g. the operator
 *   hitting the browser's Reload button - shows the freshly-fetched content.
 *   No full VM / arcade reload is ever required. `invalidateNewsFeed()` is the
 *   explicit invalidation seam: it forces the next render to re-fetch.
 *
 * Architecture preserved (project rules):
 *   - The browser core, router and SiteRegistry are untouched. Live content
 *     arrives purely as `registry.register(...)` calls.
 *   - The VM is a CONSUMER ONLY. It reads through the backend gateway; it
 *     never writes, never holds a DB connection, never reaches the bot.
 *   - render() functions stay synchronous and pure: the network fetch happens
 *     off to the side (refreshNews), updates module state + re-registers
 *     pages, and renderers just read the current state.
 *   - It reuses the proven Phase 4.1 `vm-dev-*` feed styles and the shared
 *     site kit, so no change to the (stable) VM stylesheet is needed.
 *
 * All authored and derived text is HTML-escaped through the site kit, and the
 * markdown renderer escapes before transforming — no unsafe HTML injection.
 */
import { escapeHtml, link, chip, sitePage, crossRefs } from "./kit.js";
import { renderMarkdown } from "../../../core/markdown.js";
import { gatewayClient } from "../../../core/gatewayClient.js";

const SITE = "news";
const DOMAIN = "Bucky News";

/** The world-content domain this site renders (the proven Phase 4.2 domain). */
const FEED_DOMAIN = "announcement";

function newsUrl(slug) {
    return slug ? `bucky://news/${slug}` : "bucky://news";
}

/**
 * Bundled SEED announcements — the fallback content. Newest first.
 *   slug, date, category, author, title, summary
 *   body         markdown string  → core/markdown.js
 *   tags, keywords  PulseSearch metadata
 *   featured, priority  feed emphasis
 *   crossRefs    optional links to other BuckyNet sites
 *
 * A live announcement from the backend carries the same fields - its `body`
 * is also a markdown string, so seed and live items render identically.
 */
const SEED_NEWS = [
    {
        slug: "buckynet-news-online",
        date: "Cycle 313",
        category: "Launch",
        author: "Bucky Network",
        title: "Bucky News Goes Live on the Grid",
        summary: "The world-content channel is online — announcements, events and broadcasts now have a home at bucky://news.",
        keywords: ["news", "announcement", "launch", "buckynet", "grid", "world", "content"],
        tags: ["news", "launch", "buckynet"],
        featured: true,
        priority: "high",
        body: [
            "**bucky://news is online.** The Grid now has a dedicated channel for ",
            "world content — announcements, milestones, network broadcasts and live ",
            "events.\n\n",
            "## What lands here\n\n",
            "- **Announcements** — launches, events and community milestones.\n",
            "- **Broadcasts** — faction and network signals across BuckyNet.\n",
            "- **World events** — in-universe happenings as the world evolves.\n\n",
            "All of it is authored by the team and served live from the backend. ",
            "When the feed is quiet, the Grid simply shows its bundled briefing — ",
            "nothing ever breaks."
        ].join(""),
        crossRefs: [
            { url: "bucky://dev", label: "Bucky Dev", note: "patch notes & hints" },
            { url: "bucky://community", label: "Bucky Community", note: "events & giveaways" }
        ]
    },
    {
        slug: "world-content-channel",
        date: "Cycle 313",
        category: "Update",
        author: "Bucky Network",
        title: "One Channel, Every Kind of Signal",
        summary: "How the world-content feed unifies announcements, incidents, broadcasts and events behind a single Grid page.",
        keywords: ["news", "update", "world", "content", "incident", "broadcast", "event", "feed"],
        tags: ["news", "update"],
        featured: false,
        priority: "normal",
        body: [
            "Bucky News is a **unified feed**. Behind it, every kind of world ",
            "signal — an announcement, an incident notice, a maintenance window, ",
            "a faction broadcast — flows through one shared pipeline and renders ",
            "through one set of cards.\n\n",
            "That means the channel can grow without the browser changing: a new ",
            "kind of signal is new *data*, not a new page. Watch this feed — when ",
            "the Grid has something to say, it says it here first."
        ].join(""),
        crossRefs: []
    }
];

// ----- Live-feed state -------------------------------------------------------

/**
 * The feed state, read by the (synchronous) renderers.
 *   status    : "seed"    initial — before the first fetch resolves
 *               "loading" the first fetch is in flight
 *               "live"    backend reachable, returned announcements
 *               "empty"   backend reachable, but it has no announcements yet
 *               "offline" backend unreachable / unconfigured / errored
 *   items     : the announcement objects the home feed renders
 *   fetchedAt : epoch ms of the last completed fetch (0 = never) — the
 *               soft-refresh lifecycle ages the feed against this.
 */
const feedState = { status: "seed", items: SEED_NEWS.slice(), fetchedAt: 0 };

/** The SiteRegistry to register live items into (captured at registerNewsSite). */
let newsRegistry = null;
/** Guard: at most one fetch in flight at a time (re-fetch is allowed, overlap is not). */
let fetchInFlight = false;

/** Soft-refresh TTL (ms) — shared default from the gateway client. */
const SOFT_REFRESH_TTL = gatewayClient.softRefreshTtl || 60000;

// ----- Helpers ---------------------------------------------------------------

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
function prettyCategory(token) {
    const words = String(token || "general").split(/[_\s-]+/).filter(Boolean);
    if (!words.length) return "News";
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Normalise a backend world-content item into the shape the renderers expect. */
function normalizeLiveItem(item) {
    const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
    return {
        slug: String(item.slug || ""),
        date: formatDate(item.published_at || item.created_at),
        category: prettyCategory(item.category),
        author: item.author || "Bucky Network",
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

// ----- Rendering -------------------------------------------------------------

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

/**
 * Render an item body. Both seed and live items carry a markdown string. The
 * markdown renderer HTML-escapes before transforming, so a body can never
 * inject markup.
 */
function renderItemBody(item) {
    return `<div class="vm-dev-md">${renderMarkdown(String(item.body || ""))}</div>`;
}

/** Render one Bucky News item page. */
function renderItem(item) {
    const body = `
        <div class="vm-dev-post">
            ${itemMeta(item)}
            <div class="vm-wiki-body">
                ${renderItemBody(item)}
                ${crossRefs("Across BuckyNet", item.crossRefs)}
            </div>
            <div class="vm-dev-back">${link("bucky://news", "‹ All news")}</div>
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · ${newsUrl(item.slug)}`,
        title: item.title,
        lead: item.summary,
        bodyHtml: body
    });
}

/** A small banner telling the operator where the feed content is coming from. */
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
        <span class="vm-dev-feeddot"></span>Connecting to the live news feed…
    </div>`;
}

/** Render the Bucky News home — the world-content feed. */
function renderHome() {
    // Soft refresh: a render is also the trigger to age-check the feed. If it
    // is stale this quietly starts a background re-fetch; the current render is
    // unaffected and instant.
    maybeSoftRefresh();

    const items = feedState.items.slice().sort(
        (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0)
    );
    const feed = items.map((item) => `
        <article class="vm-dev-card vm-dev-card-${escapeHtml((item.category || "news").toLowerCase().replace(/\s+/g, "-"))}${item.featured ? " vm-dev-card-featured" : ""}">
            ${itemMeta(item)}
            ${link(newsUrl(item.slug), item.title, "vm-dev-card-title")}
            <p class="vm-dev-card-summary">${escapeHtml(item.summary)}</p>
            <div class="vm-dev-card-foot">
                <div class="vm-site-chiprow">${(item.tags || []).map((tag) => chip(tag)).join("")}</div>
                ${link(newsUrl(item.slug), "Read ›")}
            </div>
        </article>
    `).join("");
    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">
                Bucky News — announcements, events and network broadcasts from across
                the Grid. This feed is backend-connected: world content authored by
                staff appears here live, and refreshes itself in the background.
            </p>
            ${renderFeedStatus()}
            <div class="vm-dev-feed">${feed || "<p class=\"vm-dev-note\">No news to show yet.</p>"}</div>
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://dev", label: "Bucky Dev", note: "patch notes & hints" },
                { url: "bucky://community", label: "Bucky Community", note: "events & giveaways" }
            ])}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · bucky://news`,
        title: "Bucky News",
        lead: "Announcements, events and broadcasts from across the Grid.",
        bodyHtml: body
    });
}

// ----- Registration ----------------------------------------------------------

/** Register (or replace) one item's page in the registry. */
function registerItemEntry(registry, item, searchable) {
    registry.register({
        id: `news-${item.slug}`,
        url: newsUrl(item.slug),
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

/** Register every Bucky News page into the given SiteRegistry. */
export function registerNewsSite(registry) {
    newsRegistry = registry;

    // The home renderer reads feedState live, so it is registered once and
    // never needs re-registering when the feed switches to live content.
    registry.register({
        id: "news-home",
        url: "bucky://news",
        site: SITE,
        title: "Bucky News",
        type: "home",
        keywords: ["news", "announcements", "events", "broadcasts", "updates", "grid", "world"],
        description: "Bucky News — announcements, events and network broadcasts from across the Grid.",
        tags: ["news", "site", "world"],
        render: () => renderHome()
    });

    // Seed item pages — instantly available and the offline fallback.
    SEED_NEWS.forEach((item) => registerItemEntry(registry, item, true));

    // Kick off the first live fetch (fire-and-forget; never blocks boot).
    refreshNews();
}

// ----- Soft-refresh lifecycle ------------------------------------------------

/**
 * Force the feed to be considered stale, so the next render re-fetches it.
 * The explicit feed-invalidation seam: a future "content published" signal
 * (e.g. an EventBus listener) can call this to refresh the page without a
 * full VM reload.
 */
export function invalidateNewsFeed() {
    feedState.fetchedAt = 0;
}

/**
 * If the feed is stale and no fetch is in flight, start a background re-fetch.
 * Called from renderHome — so navigating to (or reloading) bucky://news is
 * itself the soft-refresh trigger. Fire-and-forget: it never blocks a render.
 */
function maybeSoftRefresh() {
    if (fetchInFlight) return;
    const age = Date.now() - feedState.fetchedAt;
    if (feedState.fetchedAt !== 0 && age < SOFT_REFRESH_TTL) return;
    refreshNews();
}

/**
 * Fetch the live announcements feed from the backend and, on success, register
 * the live item pages and flip the home feed to live content. On any failure
 * the site stays on its bundled seed briefing — the platform degrades
 * gracefully and never breaks.
 *
 * Unlike the Phase 4.1 dev feed this is RE-CALLABLE: it is the soft-refresh
 * worker. `fetchInFlight` prevents overlapping fetches; the very first call
 * shows the "loading" banner, later (soft) refreshes update silently so the
 * feed never flickers back to a loading state.
 */
export async function refreshNews() {
    if (fetchInFlight) return;
    fetchInFlight = true;
    const firstLoad = feedState.fetchedAt === 0;
    if (firstLoad) feedState.status = "loading";

    let result;
    try {
        result = await gatewayClient.fetchWorldContentDomain(FEED_DOMAIN);
    } catch (_error) {
        result = { ok: false };
    } finally {
        fetchInFlight = false;
    }

    // Every completed attempt — success or failure — ages the feed, so a
    // failed soft refresh waits a full TTL before trying again.
    feedState.fetchedAt = Date.now();

    if (!result || !result.ok || !result.data) {
        feedState.status = "offline";
        return;
    }

    const data = result.data;
    const items = Array.isArray(data.items) ? data.items : [];

    if (!data.available) {
        feedState.status = "offline";
        return;
    }
    if (!items.length) {
        feedState.status = "empty";
        return;
    }

    const liveItems = items
        .map(normalizeLiveItem)
        .filter((item) => item.slug);

    if (!liveItems.length) {
        feedState.status = "empty";
        return;
    }

    // Featured first; the backend already orders them, this is defensive.
    liveItems.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));

    if (newsRegistry) {
        // Register / replace the live item pages...
        liveItems.forEach((item) => registerItemEntry(newsRegistry, item, true));
        // ...and demote the bundled seed pages out of PulseSearch. They stay
        // directly routable; the live feed becomes the canonical, searchable
        // news content. (No SiteRegistry "unregister" — the stable registry
        // API is preserved.)
        SEED_NEWS.forEach((item) => registerItemEntry(newsRegistry, item, false));
    }

    feedState.items = liveItems;
    feedState.status = "live";
}
