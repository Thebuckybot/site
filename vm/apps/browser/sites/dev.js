/**
 * Bucky Dev — bucky://dev
 *
 * The in-universe developer site: patch notes, announcements and hints. This
 * is the site Phase 3B's backend / Discord integration will feed, so it is
 * deliberately the most data-shaped of the four.
 *
 * The DEV_POSTS array is the single content seam. Today it holds authored
 * statics; a future DevService can replace or extend it (and re-register the
 * pages) without the renderer, router or browser changing. Each post already
 * carries the fields dynamic content will need: id, date, category, author,
 * tags, summary, body paragraphs, and an (empty for now) attachments slot.
 *
 * All authored and derived text is HTML-escaped through the site kit.
 */
import { escapeHtml, link, chip, sitePage } from "./kit.js";

const SITE = "dev";
const DOMAIN = "Bucky Dev";

function devUrl(slug) {
    return slug ? `bucky://dev/${slug}` : "bucky://dev";
}

/**
 * Authored developer posts. Newest first.
 *   slug, date, category, author, title, summary
 *   body         [paragraph, ...]
 *   tags         search + label terms
 *   keywords     PulseSearch match terms
 *   attachments  reserved for Phase 3B (images / files) — empty for now
 */
const DEV_POSTS = [
    {
        slug: "browser-layer-online",
        date: "Cycle 312",
        category: "Patch Notes",
        author: "Bucky Dev",
        title: "Patch 0.3 — Browser Layer Online",
        summary: "The BuckyNet browser, the PulseSearch engine and the first four sites are live.",
        keywords: ["patch", "browser", "update", "release", "pulsesearch", "buckynet", "developer", "dev", "log"],
        tags: ["dev", "patch", "release"],
        body: [
            "Patch 0.3 brings the browser layer online. The VM now ships an internal browser app with " +
            "back / forward / reload, an omnibox, per-window history and loading states.",
            "PulseSearch is the new search engine. Typing a bucky:// address navigates directly; typing " +
            "anything else opens a search results page first — the browser never teleports you straight " +
            "into a site from a plain query.",
            "Four sites are live at launch: BuckyWiki, BuckTube, this developer site, and the leak " +
            "database. All content is internal VM content. Known issue: the leak database is read-only " +
            "until the OSINT layer lands.",
            "Architecture note: every site is a SiteRegistry entry. Phase 3B can register new pages — " +
            "including Discord-fed posts — without touching the browser core."
        ],
        attachments: []
    },
    {
        slug: "buckynet-announcement",
        date: "Cycle 305",
        category: "Announcement",
        author: "Bucky Dev",
        title: "Announcement — BuckyNet Goes Online",
        summary: "The Grid is open. A first look at what the internal network is, and the roadmap toward OSINT and Discord progression.",
        keywords: ["announcement", "buckynet", "grid", "roadmap", "discord", "osint", "developer", "dev", "future"],
        tags: ["dev", "announcement", "roadmap"],
        body: [
            "BuckyNet is online. The Grid is a closed, simulated network built into the VM — no real " +
            "internet, no real services, no real accounts. Everything an operator finds here is " +
            "fictional and in-universe.",
            "The roadmap from here: an OSINT layer that makes the leak database investigable, a mail " +
            "system, and Discord-linked progression so missions can react to what an operator does on " +
            "the Grid.",
            "Hints will be seeded across the sites as missions arrive. If a page feels like it is " +
            "watching back — it is. Read the developer logs on BuckTube for the running commentary."
        ],
        attachments: []
    }
];

const BY_SLUG = new Map(DEV_POSTS.map((post) => [post.slug, post]));

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

/** Render one developer post page. */
function renderPost(post) {
    const body = `
        <div class="vm-dev-post">
            ${postMeta(post)}
            <div class="vm-wiki-body">
                ${post.body.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}
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
        <article class="vm-dev-card">
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
