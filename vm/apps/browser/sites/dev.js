/**
 * Bucky Dev — bucky://dev
 *
 * The in-universe developer site: patch notes, announcements and hints. This
 * is the site Phase 3B's backend / Discord integration will feed, so it is
 * deliberately the most data-shaped of the sites.
 *
 * Phase 3B expansion: a block-based post body (paragraphs, headings, patch
 * notes, callouts), announcement cards, image-placeholder support and an
 * `attachments` slot — the architecture a future system uses to render
 * uploaded screenshots and Discord-fed posts. No backend sync is implemented;
 * only the data shape and renderer are prepared.
 *
 * The DEV_POSTS array is the single content seam. A future DevService can
 * replace or extend it (and re-register the pages) without the renderer,
 * router or browser changing.
 *
 * All authored and derived text is HTML-escaped through the site kit.
 */
import { escapeHtml, link, chip, sitePage, mediaBox, crossRefs } from "./kit.js";

const SITE = "dev";
const DOMAIN = "Bucky Dev";

function devUrl(slug) {
    return slug ? `bucky://dev/${slug}` : "bucky://dev";
}

/**
 * Authored developer posts. Newest first.
 *   slug, date, category, author, title, summary
 *   body         block list — ["p",text] | ["h",text] | ["note",text] | ["patch",[[kind,text]...]]
 *   attachments  [{kind,caption}] — rendered as media placeholders (Phase 3B prep)
 *   tags, keywords  PulseSearch metadata
 *   crossRefs    optional links to other BuckyNet sites
 */
const DEV_POSTS = [
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

const BY_SLUG = new Map(DEV_POSTS.map((post) => [post.slug, post]));
const PATCH_LABEL = { new: "NEW", add: "ADD", fix: "FIX", known: "KNOWN" };

// ----- Rendering -------------------------------------------------------------

function postMeta(post) {
    return `
        <div class="vm-dev-meta">
            ${chip(post.category)}
            <span class="vm-dev-date">${escapeHtml(post.date)}</span>
            <span class="vm-dev-author">${escapeHtml(post.author)}</span>
        </div>
    `;
}

/** Render one body block. */
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
                ${post.body.map(renderBlock).join("")}
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

/** Render the Bucky Dev home — the post feed. */
function renderHome() {
    const feed = DEV_POSTS.map((post) => `
        <article class="vm-dev-card vm-dev-card-${escapeHtml((post.category || "post").toLowerCase().replace(/\s+/g, "-"))}">
            ${postMeta(post)}
            ${link(devUrl(post.slug), post.title, "vm-dev-card-title")}
            <p class="vm-dev-card-summary">${escapeHtml(post.summary)}</p>
            <div class="vm-dev-card-foot">
                <div class="vm-site-chiprow">${post.tags.map((tag) => chip(tag)).join("")}</div>
                ${link(devUrl(post.slug), "Read post ›")}
            </div>
        </article>
    `).join("");
    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">
                The Bucky Dev feed — patch notes, announcements and hints, straight from the team
                behind the VM. Posts are internal VM content and update as the universe grows.
            </p>
            <div class="vm-dev-feed">${feed}</div>
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

/** Register every Bucky Dev page into the given SiteRegistry. */
export function registerDevSite(registry) {
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

    DEV_POSTS.forEach((post) => {
        registry.register({
            id: `dev-${post.slug}`,
            url: devUrl(post.slug),
            site: SITE,
            title: post.title,
            type: "post",
            keywords: post.keywords,
            description: post.summary,
            tags: post.tags,
            render: () => renderPost(post)
        });
    });
}
