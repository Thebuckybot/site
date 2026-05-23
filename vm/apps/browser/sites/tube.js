/**
 * BuckTube — bucky://tube
 *
 * The fictional video platform of BuckyNet. Videos are authored as DATA (the
 * VIDEOS array): the home grid and every watch page are generated from the
 * same records, so adding a video is a pure data edit.
 *
 * The video record carries `comments`, `likes` and `views` already — the
 * shape future backend / Discord-fed content will populate. For Phase 3A the
 * comments are authored statics; the renderer does not care where they came
 * from, which is the seam Phase 3B plugs into.
 *
 * All authored and derived text is HTML-escaped through the site kit before
 * it reaches the browser viewport.
 */
import { escapeHtml, link, chip, sitePage } from "./kit.js";

const SITE = "tube";
const DOMAIN = "BuckTube";

function tubeUrl(slug) {
    return slug ? `bucky://tube/${slug}` : "bucky://tube";
}

/**
 * Authored BuckTube content.
 *   slug, title, creator, duration, views, likes, category
 *   description  free text shown on the watch page (a prime hint location)
 *   comments     [{ author, text, likes }]
 *   keywords/tags/snippet  PulseSearch metadata
 */
const VIDEOS = [
    {
        slug: "welcome-to-the-grid",
        title: "Welcome to the Grid",
        creator: "BuckyNet Official",
        duration: "4:12",
        views: "12,904",
        likes: 842,
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
            { author: "node_runner", text: "First day on the workstation. This actually explained the omnibox better than the docs.", likes: 54 },
            { author: "halflight", text: "the part about 'searching is not arriving' clicked for me. you have to read the results.", likes: 31 },
            { author: "BuckyNet Official", text: "Pinned: type a bucky:// address to go straight to a site, type anything else to search.", likes: 120 }
        ]
    },
    {
        slug: "devlog-1",
        title: "Developer Log #1",
        creator: "Bucky Dev",
        duration: "7:38",
        views: "5,107",
        likes: 503,
        category: "Dev",
        snippet: "The first developer log — what shipped, what broke, and what is coming next to the VM.",
        keywords: ["developer", "dev", "log", "logs", "devlog", "patch", "build", "update", "grid", "changelog"],
        tags: ["tube", "dev", "dev-log", "developer"],
        description:
            "Developer Log #1. This build brought the browser layer online: an internal router, the " +
            "PulseSearch engine and the first four BuckyNet sites. Known issue — the leak database is " +
            "still read-only. Next log covers Discord-linked progression. Patch notes live on the " +
            "Bucky Dev site.",
        comments: [
            { author: "trace_void", text: "browser layer feels great. the search-results-first flow is the right call.", likes: 67 },
            { author: "gridhopper", text: "waiting on the discord progression hook. any ETA?", likes: 22 },
            { author: "Bucky Dev", text: "Reply: progression sync is Phase 3B. Watch the dev feed.", likes: 88 }
        ]
    },
    {
        slug: "security-awareness",
        title: "Security Awareness",
        creator: "Bucky Security",
        duration: "5:54",
        views: "9,461",
        likes: 711,
        category: "Training",
        snippet: "A short training reel on spotting unsafe nodes before the Virus does.",
        keywords: ["security", "awareness", "training", "developer", "log", "safety", "phishing", "defense", "operator"],
        tags: ["tube", "dev-log", "training", "security"],
        description:
            "Security Awareness — operator training. The Virus does not break in; it is let in. This reel " +
            "covers the three tells of an unsafe node: default credentials, an unsigned transmission, and " +
            "a file that wants to be opened. When in doubt, run a security script and watch the logs.",
        comments: [
            { author: "coldstart", text: "'the virus does not break in, it is let in' — putting that on a sticky note.", likes: 95 },
            { author: "m1rror", text: "the unsigned transmission tell saved me a mission. good reel.", likes: 40 },
            { author: "Bucky Security", text: "Pinned: training continues in the Terminal Commands wiki article.", likes: 73 }
        ]
    },
    {
        slug: "unknown-transmission",
        title: "Unknown Transmission",
        creator: "anon_signal",
        duration: "1:07",
        views: "47,330",
        likes: 1290,
        category: "Mystery",
        snippet: "A short, unsigned clip. No creator credit. The comments are louder than the video.",
        keywords: ["unknown", "transmission", "signal", "developer", "log", "mystery", "anon", "virus", "hint"],
        tags: ["tube", "dev-log", "mystery", "clue"],
        description:
            "// no description provided //\n" +
            "Transmission recovered from an unguarded node. Sixty-seven seconds of static and one " +
            "repeated string. BuckTube cannot verify the uploader. If you recognise the signal, the leak " +
            "database is the place to cross-reference it.",
        comments: [
            { author: "halflight", text: "the repeated string matches a serial fragment on a banknote. not joking.", likes: 210 },
            { author: "trace_void", text: "uploader account has no other videos and a join date from before BuckyNet went online?", likes: 188 },
            { author: "anon_signal", text: "look where the search results stop.", likes: 666 }
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

function renderComments(comments) {
    const rows = (comments || []).map((comment) => `
        <li class="vm-tube-comment">
            <div class="vm-tube-comment-head">
                <strong>${escapeHtml(comment.author)}</strong>
                <span>&#9650; ${escapeHtml(String(comment.likes))}</span>
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

/** "Up next" rail — every other video. */
function renderUpNext(currentSlug) {
    const cards = VIDEOS.filter((video) => video.slug !== currentSlug).map((video) => `
        <article class="vm-tube-upnext-card">
            <div class="vm-tube-thumb"><span>${escapeHtml(video.duration)}</span></div>
            <div class="vm-tube-upnext-meta">
                ${link(tubeUrl(video.slug), video.title, "vm-tube-upnext-title")}
                <span>${escapeHtml(video.creator)} · ${escapeHtml(video.views)} views</span>
            </div>
        </article>
    `).join("");
    return `<aside class="vm-tube-upnext"><div class="vm-tube-upnext-head">Up next</div>${cards}</aside>`;
}

/** Render one BuckTube watch page. */
function renderWatch(video) {
    const body = `
        <div class="vm-tube-watch">
            <div class="vm-tube-main">
                ${videoFrame(video)}
                <div class="vm-tube-meta">
                    <div class="vm-tube-stats">
                        <span>${escapeHtml(video.views)} views</span>
                        <span class="vm-tube-likes">&#9650; ${escapeHtml(String(video.likes))}</span>
                        ${chip(video.category)}
                    </div>
                    <div class="vm-tube-creator">Uploaded by <strong>${escapeHtml(video.creator)}</strong></div>
                </div>
                <div class="vm-tube-description">${escapeHtml(video.description)}</div>
                ${renderComments(video.comments)}
            </div>
            ${renderUpNext(video.slug)}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · ${tubeUrl(video.slug)}`,
        title: video.title,
        lead: `${video.creator} · ${video.duration}`,
        bodyHtml: body
    });
}

/** Render the BuckTube home — a grid of video cards. */
function renderHome() {
    const cards = VIDEOS.map((video) => `
        <article class="vm-tube-card">
            <div class="vm-tube-thumb vm-tube-thumb-lg">
                <span>${escapeHtml(video.duration)}</span>
            </div>
            <div class="vm-tube-card-meta">
                ${link(tubeUrl(video.slug), video.title, "vm-tube-card-title")}
                <span class="vm-tube-card-creator">${escapeHtml(video.creator)}</span>
                <span class="vm-tube-card-stats">${escapeHtml(video.views)} views · &#9650; ${escapeHtml(String(video.likes))}</span>
                <p>${escapeHtml(video.snippet)}</p>
            </div>
        </article>
    `).join("");
    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">
                BuckTube is BuckyNet's video platform. Dev logs, lore, training reels and the occasional
                transmission no one will claim. Every video below is internal VM content.
            </p>
            <div class="vm-tube-grid">${cards}</div>
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
        description: "BuckyNet's video platform — dev logs, lore reels, training and transmissions.",
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
