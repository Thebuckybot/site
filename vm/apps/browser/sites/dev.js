/**
 * Bucky Dev — bucky://dev
 *
 * The in-universe developer site: patch notes, announcements and hints.
 *
 * Phase 4.1 — FIRST BACKEND-CONNECTED VM PAGE.
 *   This site is now wired to the live backend. On first load it fetches dev
 *   posts from the backend gateway (GET /api/devposts via core/gatewayClient)
 *   and renders them. The bundled DEV_POSTS array below is kept as the SEED /
 *   FALLBACK: it renders instantly and is what the site shows whenever the
 *   backend is unreachable, unconfigured, or has no posts yet — so a backend
 *   hiccup never breaks the VM sandbox (graceful degradation).
 *
 * Architecture preserved (project rules / Phase 4.1 Part 8):
 *   - The browser core, router and SiteRegistry are untouched. Live content
 *     arrives purely as `registry.register(...)` calls — exactly the seam the
 *     SiteRegistry was designed for.
 *   - The VM is a CONSUMER ONLY. It reads through the backend gateway; it
 *     never writes, never holds a DB connection, never reaches the bot.
 *   - render() functions stay synchronous and pure. The network fetch happens
 *     once, off to the side (refreshDevPosts), and updates module state +
 *     re-registers pages; renderers just read the current state.
 *
 * Rendering:
 *   - Live posts carry a markdown `body` (string) → core/markdown.js.
 *   - Seed posts keep the block-based `body` (array) → renderBlock().
 *   renderPostBody() branches on the body's type, so both render side by side.
 *
 * Future seams prepared, NOT built (Phase 4.1 Part 9): attachments/media,
 * embeds, categories, featured/pinned posts, patch-note & changelog blocks.
 * Comments/reactions and live push are explicitly out of scope.
 *
 * All authored and derived text is HTML-escaped through the site kit, and the
 * markdown renderer escapes before transforming — no unsafe HTML injection.
 */
import { escapeHtml, link, chip, sitePage, mediaBox, crossRefs } from "./kit.js";
import { renderMarkdown } from "../../../core/markdown.js";
import { gatewayClient } from "../../../core/gatewayClient.js";

const SITE = "dev";
const DOMAIN = "Bucky Dev";

function devUrl(slug) {
    return slug ? `bucky://dev/${slug}` : "bucky://dev";
}

/**
 * Bundled SEED posts — the fallback content. Newest first.
 *   slug, date, category, author, title, summary
 *   body         block list — ["p",text] | ["h",text] | ["note",text] | ["patch",[[kind,text]...]]
 *   attachments  [{kind,caption}] — rendered as media placeholders
 *   tags, keywords  PulseSearch metadata
 *   crossRefs    optional links to other BuckyNet sites
 *
 * A live post from the backend carries the same fields, except `body` is a
 * markdown string and `featured`/`priority` may be set.
 */
const SEED_POSTS = [
    {
        slug: "tabs-and-bookmarks",
        date: "Cycle 312",
        category: "Patch Notes",
        author: "Bucky Dev",
        title: "Patch 0.4 — Tabs, Bookmarks & Ecosystem Expansion",
        summary: "Browser tabs, a bookmarks system, a bigger BuckyNet, hidden pages and a richer PulseSearch.",
        keywords: ["patch", "tabs", "bookmarks", "update", "release", "ecosystem", "developer", "dev", "log"],
        tags: ["dev", "patch", "release"],
        body: [
            ["p", "Patch 0.4 is the BuckyNet ecosystem expansion. The browser is now a multi-tab " +
                "application and the fake internet is meaningfully larger and more interconnected."],
            ["h", "Browser"],
            ["patch", [
                ["new", "Browser tabs — open, close and switch tabs, each with its own history."],
                ["new", "Bookmarks — star any page; reopen from the bookmarks panel."],
                ["add", "PulseSearch now highlights query matches and suggests related searches."],
                ["fix", "Rapid navigation no longer leaves a stale page mid-load."]
            ]],
            ["h", "BuckyNet"],
            ["patch", [
                ["new", "Two new sites: the Bucky landing page and the Bucky Community hub."],
                ["new", "Hidden pages — unindexed routes reachable only by direct address."],
                ["add", "BuckyWiki gained corporation, faction and timeline articles."],
                ["add", "Sites now cross-link — every page points somewhere else on the Grid."]
            ]],
            ["note", "Backend sync is not in this patch. The architecture is prepared for it — see " +
                "the roadmap post — but dev posts, leaks and counters are still authored content."]
        ],
        attachments: [
            { kind: "image", caption: "Browser tabs — multiple investigation threads" },
            { kind: "image", caption: "PulseSearch — categorised results with highlights" }
        ],
        crossRefs: [
            { url: "bucky://tube/devlog-1", label: "Developer Log #1", note: "the video version" }
        ]
    },
    {
        slug: "browser-layer-online",
        date: "Cycle 311",
        category: "Patch Notes",
        author: "Bucky Dev",
        title: "Patch 0.3 — Browser Layer Online",
        summary: "The BuckyNet browser, the PulseSearch engine and the first four sites are live.",
        keywords: ["patch", "browser", "update", "release", "pulsesearch", "buckynet", "developer", "dev", "log"],
        tags: ["dev", "patch", "release"],
        body: [
            ["p", "Patch 0.3 brought the browser layer online. The VM ships an internal browser app " +
                "with back / forward / reload, an omnibox, per-window history and loading states."],
            ["patch", [
                ["new", "Internal bucky:// router and the SiteRegistry."],
                ["new", "PulseSearch — search opens a results page, never teleports into a site."],
                ["new", "Four launch sites: BuckyWiki, BuckTube, Bucky Dev, Leak Database."]
            ]],
            ["p", "Every site is a SiteRegistry entry. Later patches register new pages — including " +
                "Discord-fed posts — without touching the browser core."]
        ],
        attachments: [],
        crossRefs: []
    },
    {
        slug: "buckynet-announcement",
        date: "Cycle 305",
        category: "Announcement",
        author: "Bucky Dev",
        title: "Announcement — BuckyNet Goes Online",
        summary: "The Grid is open. A first look at the internal network and the roadmap toward OSINT and Discord progression.",
        keywords: ["announcement", "buckynet", "grid", "roadmap", "discord", "osint", "developer", "dev", "future"],
        tags: ["dev", "announcement", "roadmap"],
        body: [
            ["p", "BuckyNet is online. The Grid is a closed, simulated network built into the VM — no " +
                "real internet, no real services. Everything an operator finds here is fictional."],
            ["p", "Hints will be seeded across the sites as missions arrive. If a page feels like it is " +
                "watching back — it is. Read the developer logs on BuckTube for the running commentary."]
        ],
        attachments: [],
        crossRefs: [
            { url: "bucky://bucky", label: "Bucky", note: "the official platform" }
        ]
    },
    {
        slug: "roadmap",
        date: "Cycle 312",
        category: "Announcement",
        author: "Bucky Dev",
        title: "The Road to Backend Integration",
        summary: "What is next for BuckyNet: backend-fed content, Discord integration, mail, missions and live updates.",
        keywords: ["roadmap", "backend", "future", "discord", "missions", "mail", "announcement", "developer", "dev"],
        tags: ["dev", "announcement", "roadmap"],
        body: [
            ["p", "Patch 0.4 finished the ecosystem expansion. The next phase is integration — wiring " +
                "BuckyNet to live, backend-fed content. Here is the plan."],
            ["h", "Coming next"],
            ["patch", [
                ["new", "Backend-fed dev posts and announcements — this feed goes live."],
                ["new", "Discord integration — community events and the economy sync to the Grid."],
                ["new", "Mail system — bucky,net addresses and an inbox app."],
                ["new", "Mission-triggered content — pages and leaks that change as operators progress."],
                ["new", "Accounts and comments — real profiles behind the handles you already see."]
            ]],
            ["note", "None of the above ships yet. Patch 0.4 only prepares the architecture: the " +
                "SiteRegistry, the dev-post data shape and the attachment slot are all backend-ready."]
        ],
        attachments: [
            { kind: "image", caption: "Roadmap — BuckyNet integration phases" }
        ],
        crossRefs: [
            { url: "bucky://community", label: "Bucky Community", note: "where live events will land" }
        ]
    }
];

const PATCH_LABEL = { new: "NEW", add: "ADD", fix: "FIX", known: "KNOWN" };

// ----- Live-feed state -------------------------------------------------------

/**
 * The feed state, read by the (synchronous) renderers.
 *   status : "seed"    initial — before the first fetch resolves
 *            "live"    backend reachable, returned posts
 *            "empty"   backend reachable, but it has no posts yet
 *            "offline" backend unreachable / unconfigured / errored
 *   posts  : the post objects the home feed renders
 */
const feedState = { status: "seed", posts: SEED_POSTS.slice() };

/** The SiteRegistry to register live posts into (captured at registerDevSite). */
let devRegistry = null;
/** Guard so the one-shot live fetch runs at most once per VM session. */
let refreshStarted = false;

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
    const words = String(token || "update").split(/[_\s-]+/).filter(Boolean);
    if (!words.length) return "Update";
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Normalise a backend dev-post item into the shape the renderers expect. */
function normalizeLivePost(item) {
    const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
    return {
        slug: String(item.slug || ""),
        date: formatDate(item.published_at || item.created_at),
        category: prettyCategory(item.category),
        author: item.author || "Bucky Dev",
        title: item.title || "Untitled post",
        summary: item.summary || "",
        keywords: tags,
        tags,
        // A string body marks a live post — renderPostBody() renders markdown.
        body: typeof item.body === "string" ? item.body : "",
        attachments: Array.isArray(item.media) ? item.media : [],
        crossRefs: [],
        featured: !!item.featured,
        priority: String(item.priority || "normal"),
        live: true
    };
}

// ----- Rendering -------------------------------------------------------------

function postMeta(post) {
    const featured = post.featured
        ? `<span class="vm-dev-featured" title="Featured post">★ Featured</span>`
        : "";
    const priority = (post.priority === "high" || post.priority === "critical")
        ? `<span class="vm-dev-priority vm-dev-priority-${escapeHtml(post.priority)}">${escapeHtml(post.priority)}</span>`
        : "";
    return `
        <div class="vm-dev-meta">
            ${chip(post.category)}
            ${featured}
            ${priority}
            <span class="vm-dev-date">${escapeHtml(post.date)}</span>
            <span class="vm-dev-author">${escapeHtml(post.author)}</span>
        </div>
    `;
}

/** Render one block of a SEED post's block-based body. */
function renderBlock(block) {
    const [kind, value] = block;
    if (kind === "h") return `<h3 class="vm-dev-h3">${escapeHtml(value)}</h3>`;
    if (kind === "note") return `<p class="vm-dev-note">${escapeHtml(value)}</p>`;
    if (kind === "patch") {
        const lines = value.map(([type, text]) => `
            <li class="vm-dev-patch-line">
                <span class="vm-dev-patch-tag vm-dev-patch-${escapeHtml(type)}">${escapeHtml(PATCH_LABEL[type] || type)}</span>
                <span>${escapeHtml(text)}</span>
            </li>
        `).join("");
        return `<ul class="vm-dev-patch">${lines}</ul>`;
    }
    return `<p>${escapeHtml(value)}</p>`;
}

/**
 * Render a post body. Live posts carry a markdown string; seed posts carry a
 * block array. The markdown renderer HTML-escapes before transforming, so a
 * live body can never inject markup.
 */
function renderPostBody(post) {
    if (Array.isArray(post.body)) {
        return post.body.map(renderBlock).join("");
    }
    return `<div class="vm-dev-md">${renderMarkdown(String(post.body || ""))}</div>`;
}

function renderAttachments(attachments) {
    if (!attachments || !attachments.length) return "";
    return `
        <section class="vm-wiki-section">
            <h2>Attachments</h2>
            <div class="vm-dev-attachments">
                ${attachments.map((item) => mediaBox(item.caption, item.kind === "file" ? "file" : "image")).join("")}
            </div>
        </section>
    `;
}

/** Render one developer post page. */
function renderPost(post) {
    const body = `
        <div class="vm-dev-post">
            ${postMeta(post)}
            <div class="vm-wiki-body">
                ${renderPostBody(post)}
                ${renderAttachments(post.attachments)}
                ${crossRefs("Across BuckyNet", post.crossRefs)}
            </div>
            <div class="vm-dev-back">${link("bucky://dev", "‹ All posts")}</div>
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · ${devUrl(post.slug)}`,
        title: post.title,
        lead: post.summary,
        bodyHtml: body
    });
}

/** A small banner telling the operator where the feed content is coming from. */
function renderFeedStatus() {
    const status = feedState.status;
    if (status === "live") {
        return `<div class="vm-dev-feedstatus is-live">
            <span class="vm-dev-feeddot"></span>Live feed online — ${feedState.posts.length} post(s) served by the backend.
        </div>`;
    }
    if (status === "empty") {
        return `<div class="vm-dev-feedstatus is-idle">
            <span class="vm-dev-feeddot"></span>Live feed online — no posts published yet. Showing bundled posts.
        </div>`;
    }
    if (status === "offline") {
        return `<div class="vm-dev-feedstatus is-offline">
            <span class="vm-dev-feeddot"></span>Live feed offline — showing bundled posts.
        </div>`;
    }
    return `<div class="vm-dev-feedstatus is-loading">
        <span class="vm-dev-feeddot"></span>Connecting to the live dev feed…
    </div>`;
}

/** Render the Bucky Dev home — the post feed. */
function renderHome() {
    const posts = feedState.posts.slice().sort(
        (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0)
    );
    const feed = posts.map((post) => `
        <article class="vm-dev-card vm-dev-card-${escapeHtml((post.category || "post").toLowerCase().replace(/\s+/g, "-"))}${post.featured ? " vm-dev-card-featured" : ""}">
            ${postMeta(post)}
            ${link(devUrl(post.slug), post.title, "vm-dev-card-title")}
            <p class="vm-dev-card-summary">${escapeHtml(post.summary)}</p>
            <div class="vm-dev-card-foot">
                <div class="vm-site-chiprow">${(post.tags || []).map((tag) => chip(tag)).join("")}</div>
                ${link(devUrl(post.slug), "Read post ›")}
            </div>
        </article>
    `).join("");
    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">
                The Bucky Dev feed — patch notes, announcements and hints, straight from the team
                behind the VM. This feed is now backend-connected: posts authored by staff appear
                here live.
            </p>
            ${renderFeedStatus()}
            <div class="vm-dev-feed">${feed || "<p class=\"vm-dev-note\">No posts to show yet.</p>"}</div>
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://community", label: "Bucky Community", note: "events & giveaways" },
                { url: "bucky://tube/devlog-1", label: "BuckTube: Developer Log #1", note: "video logs" }
            ])}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · bucky://dev`,
        title: "Bucky Dev",
        lead: "Patch notes, announcements and hints.",
        bodyHtml: body
    });
}

// ----- Registration ----------------------------------------------------------

/** Register (or replace) one post's page in the registry. */
function registerPostEntry(registry, post, searchable) {
    registry.register({
        id: `dev-${post.slug}`,
        url: devUrl(post.slug),
        site: SITE,
        title: post.title,
        type: "post",
        searchable: searchable !== false,
        keywords: post.keywords || post.tags || [],
        description: post.summary,
        tags: post.tags || [],
        render: () => renderPost(post)
    });
}

/** Register every Bucky Dev page into the given SiteRegistry. */
export function registerDevSite(registry) {
    devRegistry = registry;

    // The home renderer reads feedState live, so it is registered once and
    // never needs re-registering when the feed switches to live content.
    registry.register({
        id: "dev-home",
        url: "bucky://dev",
        site: SITE,
        title: "Bucky Dev",
        type: "home",
        keywords: ["dev", "developer", "patch", "notes", "updates", "announcements", "changelog", "team"],
        description: "The Bucky Dev feed — patch notes, announcements and hints from the VM team.",
        tags: ["dev", "site", "updates"],
        render: () => renderHome()
    });

    // Seed post pages — instantly available and the offline fallback.
    SEED_POSTS.forEach((post) => registerPostEntry(registry, post, true));

    // Kick off the one-shot live fetch (fire-and-forget; never blocks boot).
    refreshDevPosts();
}

/**
 * Fetch the live dev-post feed from the backend and, on success, register the
 * live post pages and flip the home feed to live content. On any failure the
 * site simply stays on its bundled seed posts — the platform degrades
 * gracefully and never breaks.
 *
 * This runs at most once per VM session. A browser window already showing
 * bucky://dev when the fetch resolves keeps its rendered page until the
 * operator reloads — the live-update hook is a deliberate future seam
 * (Phase 4.1 Part 8), not built here.
 */
export async function refreshDevPosts() {
    if (refreshStarted) return;
    refreshStarted = true;
    feedState.status = "loading";

    let result;
    try {
        result = await gatewayClient.fetchDevPosts();
    } catch (_error) {
        result = { ok: false };
    }

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

    const livePosts = items
        .map(normalizeLivePost)
        .filter((post) => post.slug);

    if (!livePosts.length) {
        feedState.status = "offline";
        return;
    }

    // Featured posts first; the backend already orders them, this is defensive.
    livePosts.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));

    if (devRegistry) {
        // Register the live post pages...
        livePosts.forEach((post) => registerPostEntry(devRegistry, post, true));
        // ...and demote the bundled seed pages out of PulseSearch. They stay
        // directly routable (no SiteRegistry "unregister" — and none added:
        // the stable registry API is preserved), but the live feed becomes
        // the canonical, searchable dev content.
        SEED_POSTS.forEach((post) => registerPostEntry(devRegistry, post, false));
    }

    feedState.posts = livePosts;
    feedState.status = "live";
}
