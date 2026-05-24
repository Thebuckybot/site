/**
 * BuckTube — bucky://tube
 *
 * The fictional video platform of BuckyNet. Videos are authored as DATA (the
 * VIDEOS array): the home grid and every watch page are generated from the
 * same records.
 *
 * Phase 3B expansion: channels with subscriber counts, publish timestamps,
 * richer comment threads (pinned comments, timestamps, like counts), a
 * related-videos sidebar, fuller video metadata, hidden hints seeded in
 * descriptions and comments, and cross-site references.
 *
 * The video record carries `comments`, `likes`, `views` and `subscribers`
 * already — the shape future backend / Discord-fed content will populate. For
 * Phase 3B the comments are authored statics; the renderer does not care
 * where they came from, which is the seam Phase 3C/backend plugs into.
 *
 * All authored and derived text is HTML-escaped through the site kit.
 */
import { escapeHtml, link, chip, sitePage, crossRefs } from "./kit.js";

const SITE = "tube";
const DOMAIN = "BuckTube";

function tubeUrl(slug) {
    return slug ? `bucky://tube/${slug}` : "bucky://tube";
}

/**
 * Authored BuckTube content.
 *   slug, title, channel, subscribers, duration, views, likes, published, category
 *   description  free text shown on the watch page (a prime hint location)
 *   comments     [{ author, text, likes, when, pinned? }]
 *   related      optional slugs for the sidebar (defaults to every other video)
 *   crossRefs    optional links to other BuckyNet sites
 *   keywords/tags/snippet  PulseSearch metadata
 */
const VIDEOS = [
    {
        slug: "welcome-to-the-grid",
        title: "Welcome to the Grid",
        channel: "BuckyNet Official",
        subscribers: "84.2K",
        duration: "4:12",
        views: "12,904",
        likes: 842,
        published: "Cycle 305",
        category: "Lore",
        snippet: "An orientation reel for new operators — what BuckyNet is, and what it is not.",
        keywords: ["welcome", "grid", "intro", "orientation", "bucky", "buckynet", "start", "new operator"],
        tags: ["tube", "lore", "intro"],
        description:
            "New to BuckyNet? Start here. The Grid is a closed, simulated network — there is no real " +
            "internet on the other side of this browser. Every site, account and transmission you find " +
            "is internal VM content. Take the tour, learn the omnibox, and remember: searching is not " +
            "the same as arriving.",
        comments: [
            { author: "BuckyNet Official", when: "Cycle 305", pinned: true, likes: 120,
              text: "Pinned: type a bucky:// address to go straight to a site, type anything else to search." },
            { author: "node_runner", when: "Cycle 306", likes: 54,
              text: "First day on the workstation. This actually explained the omnibox better than the docs." },
            { author: "halflight", when: "Cycle 308", likes: 31,
              text: "the part about 'searching is not arriving' clicked for me. you have to read the results." }
        ],
        crossRefs: [
            { url: "bucky://bucky", label: "Bucky", note: "the official platform" },
            { url: "bucky://wiki/bucky", label: "BuckyWiki: Bucky", note: "the lore" }
        ]
    },
    {
        slug: "devlog-1",
        title: "Developer Log #1",
        channel: "Bucky Dev",
        subscribers: "21.6K",
        duration: "7:38",
        views: "5,107",
        likes: 503,
        published: "Cycle 311",
        category: "Dev",
        snippet: "The first developer log — what shipped, what broke, and what is coming next to the VM.",
        keywords: ["developer", "dev", "log", "logs", "devlog", "patch", "build", "update", "grid", "changelog"],
        tags: ["tube", "dev", "dev-log", "developer"],
        description:
            "Developer Log #1. This build brought the browser layer online: an internal router, the " +
            "PulseSearch engine and the first BuckyNet sites. Next log covers browser tabs, bookmarks " +
            "and Discord-linked progression. Patch notes live on the Bucky Dev site.",
        comments: [
            { author: "Bucky Dev", when: "Cycle 311", pinned: true, likes: 88,
              text: "Reply: tabs and bookmarks landed in patch 0.3 — read the dev feed." },
            { author: "trace_void", when: "Cycle 311", likes: 67,
              text: "browser layer feels great. the search-results-first flow is the right call." },
            { author: "gridhopper", when: "Cycle 312", likes: 22,
              text: "waiting on the discord progression hook. any ETA?" }
        ],
        crossRefs: [
            { url: "bucky://dev", label: "Bucky Dev", note: "full patch notes" }
        ]
    },
    {
        slug: "security-awareness",
        title: "Security Awareness",
        channel: "Bucky Security",
        subscribers: "53.0K",
        duration: "5:54",
        views: "9,461",
        likes: 711,
        published: "Cycle 307",
        category: "Training",
        snippet: "A short training reel on spotting unsafe nodes before the Virus does.",
        keywords: ["security", "awareness", "training", "developer", "log", "safety", "phishing", "defense", "operator"],
        tags: ["tube", "dev-log", "training", "security"],
        description:
            "Security Awareness — operator training. The Virus does not break in; it is let in. This reel " +
            "covers the three tells of an unsafe node: default credentials, an unsigned transmission, and " +
            "a file that wants to be opened. When in doubt, run a security script and watch the logs.",
        comments: [
            { author: "Bucky Security", when: "Cycle 307", pinned: true, likes: 73,
              text: "Pinned: training continues in the Terminal Commands wiki article." },
            { author: "coldstart", when: "Cycle 309", likes: 95,
              text: "'the virus does not break in, it is let in' — putting that on a sticky note." },
            { author: "m1rror", when: "Cycle 310", likes: 40,
              text: "the unsigned transmission tell saved me a mission. good reel." }
        ],
        crossRefs: [
            { url: "bucky://wiki/security-scripts", label: "BuckyWiki: Security Scripts", note: "the defensive archetypes" },
            { url: "bucky://wiki/bucky-security", label: "BuckyWiki: Bucky Security", note: "who made this reel" }
        ]
    },
    {
        slug: "unknown-transmission",
        title: "Unknown Transmission",
        channel: "anon_signal",
        subscribers: "0",
        duration: "1:07",
        views: "47,330",
        likes: 1290,
        published: "Cycle ???",
        category: "Mystery",
        snippet: "A short, unsigned clip. No channel credit. The comments are louder than the video.",
        keywords: ["unknown", "transmission", "signal", "developer", "log", "mystery", "anon", "virus", "hint"],
        tags: ["tube", "dev-log", "mystery", "clue"],
        description:
            "// no description provided //\n" +
            "Transmission recovered from an unguarded node. Sixty-seven seconds of static and one " +
            "repeated string. BuckTube cannot verify the uploader. Cross-reference it in the leak " +
            "database — the address it came from is filed under BRCH-0117.",
        comments: [
            { author: "halflight", when: "Cycle 309", likes: 210,
              text: "the repeated string matches a serial fragment on a banknote. not joking." },
            { author: "trace_void", when: "Cycle 310", likes: 188,
              text: "uploader account has no other videos and a join date from before BuckyNet went online?" },
            { author: "node_runner", when: "Cycle 311", likes: 240,
              text: "BRCH-0117 had the source address. nine sectors. it points at sector nine." },
            { author: "anon_signal", when: "Cycle ???", likes: 666,
              text: "look where the search results stop." }
        ],
        crossRefs: [
            { url: "bucky://leaks/breach-reports", label: "Leak Database: BRCH-0117", note: "the source breach" },
            { url: "bucky://wiki/virus", label: "BuckyWiki: The Virus", note: "what it might be" }
        ]
    },
    {
        slug: "static-den-explained",
        title: "Who Are the Static Den?",
        channel: "BuckyNet Official",
        subscribers: "84.2K",
        duration: "8:21",
        views: "18,772",
        likes: 934,
        published: "Cycle 310",
        category: "Lore",
        snippet: "A breakdown of the Grid's most-named threat crew — and how operators trace them.",
        keywords: ["static", "den", "static den", "faction", "crew", "lore", "threat", "explained"],
        tags: ["tube", "lore", "faction"],
        description:
            "The Static Den are not the Virus — they are people, and that changes everything. This reel " +
            "explains how the crew operates, why patience is their signature, and how operators follow a " +
            "Den handle from BuckTube comments to the leak database and back.",
        comments: [
            { author: "BuckyNet Official", when: "Cycle 310", pinned: true, likes: 64,
              text: "Pinned: the full faction write-up is on BuckyWiki." },
            { author: "gridhopper", when: "Cycle 311", likes: 41,
              text: "did a whole mission just by following one handle across three sites. wild." }
        ],
        crossRefs: [
            { url: "bucky://wiki/static-den", label: "BuckyWiki: The Static Den", note: "the faction page" },
            { url: "bucky://leaks/exposed-accounts", label: "Leak Database", note: "where Den handles surface" }
        ]
    },
    {
        slug: "arcade-night",
        title: "Arcade Night — LuckyChip Run",
        channel: "gridhopper",
        subscribers: "9.4K",
        duration: "11:05",
        views: "6,612",
        likes: 388,
        published: "Cycle 312",
        category: "Arcade",
        snippet: "A community creator runs the LuckyChip casino node for a full arcade night.",
        keywords: ["arcade", "luckychip", "casino", "tokens", "community", "stream", "night"],
        tags: ["tube", "arcade", "community"],
        description:
            "Arcade night on the LuckyChip casino node. Tokens, collectables and a Series 3 giveaway run. " +
            "Community creator content — drop your node ID in the Bucky community server to get in on " +
            "the next one.",
        comments: [
            { author: "gridhopper", when: "Cycle 312", pinned: true, likes: 52,
              text: "Pinned: Series 3 giveaway details are in the community server." },
            { author: "coldstart", when: "Cycle 312", likes: 28,
              text: "luckychip and credits being separate wallets still trips people up. good explainer." }
        ],
        crossRefs: [
            { url: "bucky://community", label: "Bucky Community", note: "join the next arcade night" },
            { url: "bucky://wiki/items", label: "BuckyWiki: Items & Collectables", note: "tokens & collectables" }
        ]
    }
];

const BY_SLUG = new Map(VIDEOS.map((video) => [video.slug, video]));

// ----- Rendering -------------------------------------------------------------

/** A screen placeholder — BuckTube never embeds real media. */
function videoFrame(video) {
    return `
        <div class="vm-tube-frame" role="img" aria-label="Video placeholder">
            <div class="vm-tube-frame-glow"></div>
            <button class="vm-tube-play" type="button" aria-label="Play (simulated)">&#9654;</button>
            <span class="vm-tube-duration">${escapeHtml(video.duration)}</span>
        </div>
    `;
}

/** A thumbnail placeholder with the video's category + duration. */
function thumb(video, large) {
    return `
        <div class="vm-tube-thumb${large ? " vm-tube-thumb-lg" : ""}">
            <span class="vm-tube-thumb-cat">${escapeHtml(video.category)}</span>
            <span class="vm-tube-thumb-dur">${escapeHtml(video.duration)}</span>
        </div>
    `;
}

function renderComments(comments) {
    const ordered = [...comments].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    const rows = ordered.map((comment) => `
        <li class="vm-tube-comment${comment.pinned ? " is-pinned" : ""}">
            <div class="vm-tube-comment-head">
                <strong>${escapeHtml(comment.author)}</strong>
                ${comment.pinned ? `<span class="vm-tube-pin">Pinned</span>` : ""}
                <span class="vm-tube-comment-when">${escapeHtml(comment.when || "")}</span>
                <span class="vm-tube-comment-likes">&#9650; ${escapeHtml(String(comment.likes))}</span>
            </div>
            <p>${escapeHtml(comment.text)}</p>
        </li>
    `).join("");
    return `
        <section class="vm-tube-comments">
            <h2>${escapeHtml(String(comments.length))} comments</h2>
            <ul class="vm-tube-comment-list">${rows}</ul>
        </section>
    `;
}

/** Related-videos sidebar. */
function renderRelated(video) {
    const slugs = video.related && video.related.length
        ? video.related
        : VIDEOS.filter((v) => v.slug !== video.slug).map((v) => v.slug);
    const cards = slugs
        .map((slug) => BY_SLUG.get(slug))
        .filter(Boolean)
        .map((other) => `
            <article class="vm-tube-related-card">
                ${thumb(other, false)}
                <div class="vm-tube-related-meta">
                    ${link(tubeUrl(other.slug), other.title, "vm-tube-related-title")}
                    <span>${escapeHtml(other.channel)}</span>
                    <span>${escapeHtml(other.views)} views · ${escapeHtml(other.published)}</span>
                </div>
            </article>
        `).join("");
    return `<aside class="vm-tube-related"><div class="vm-tube-related-head">Related videos</div>${cards}</aside>`;
}

/** Render one BuckTube watch page. */
function renderWatch(video) {
    const body = `
        <div class="vm-tube-watch">
            <div class="vm-tube-main">
                ${videoFrame(video)}
                <h2 class="vm-tube-video-title">${escapeHtml(video.title)}</h2>
                <div class="vm-tube-meta">
                    <div class="vm-tube-stats">
                        <span>${escapeHtml(video.views)} views</span>
                        <span>${escapeHtml(video.published)}</span>
                        <span class="vm-tube-likes">&#9650; ${escapeHtml(String(video.likes))}</span>
                        ${chip(video.category)}
                    </div>
                    <div class="vm-tube-channel">
                        <span class="vm-tube-avatar" aria-hidden="true">${escapeHtml(video.channel.slice(0, 1).toUpperCase())}</span>
                        <div class="vm-tube-channel-meta">
                            <strong>${escapeHtml(video.channel)}</strong>
                            <span>${escapeHtml(video.subscribers)} subscribers</span>
                        </div>
                        <button class="vm-tube-sub" type="button">Subscribe</button>
                    </div>
                </div>
                <div class="vm-tube-description">${escapeHtml(video.description)}</div>
                ${renderComments(video.comments)}
                ${crossRefs("Across BuckyNet", video.crossRefs)}
            </div>
            ${renderRelated(video)}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · ${tubeUrl(video.slug)}`,
        title: video.title,
        lead: `${video.channel} · ${video.duration} · ${video.published}`,
        bodyHtml: body
    });
}

/** Render the BuckTube home — a grid of video cards. */
function renderHome() {
    const cards = VIDEOS.map((video) => `
        <article class="vm-tube-card">
            ${thumb(video, true)}
            <div class="vm-tube-card-meta">
                ${link(tubeUrl(video.slug), video.title, "vm-tube-card-title")}
                <span class="vm-tube-card-creator">${escapeHtml(video.channel)} · ${escapeHtml(video.subscribers)} subs</span>
                <span class="vm-tube-card-stats">${escapeHtml(video.views)} views · ${escapeHtml(video.published)} · &#9650; ${escapeHtml(String(video.likes))}</span>
                <p>${escapeHtml(video.snippet)}</p>
            </div>
        </article>
    `).join("");
    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">
                BuckTube is BuckyNet's video platform. Dev logs, lore, training reels, arcade nights and
                the occasional transmission no one will claim. ${VIDEOS.length} videos — all internal VM content.
            </p>
            <div class="vm-tube-grid">${cards}</div>
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://wiki", label: "BuckyWiki", note: "the lore behind the reels" },
                { url: "bucky://dev", label: "Bucky Dev", note: "developer logs" },
                { url: "bucky://community", label: "Bucky Community", note: "creator content" }
            ])}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · bucky://tube`,
        title: "BuckTube",
        lead: "BuckyNet's video platform.",
        bodyHtml: body
    });
}

// ----- Registration ----------------------------------------------------------

/** Register every BuckTube page into the given SiteRegistry. */
export function registerTubeSite(registry) {
    registry.register({
        id: "tube-home",
        url: "bucky://tube",
        site: SITE,
        title: "BuckTube",
        type: "home",
        keywords: ["tube", "bucktube", "video", "videos", "watch", "channel", "buckynet"],
        description: "BuckyNet's video platform — dev logs, lore reels, training, arcade nights and transmissions.",
        tags: ["tube", "site", "video"],
        render: () => renderHome()
    });

    VIDEOS.forEach((video) => {
        registry.register({
            id: `tube-${video.slug}`,
            url: tubeUrl(video.slug),
            site: SITE,
            title: video.title,
            type: "video",
            keywords: video.keywords,
            description: video.snippet,
            tags: video.tags,
            render: () => renderWatch(video)
        });
    });
}
