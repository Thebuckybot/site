/**
 * Bucky News — bucky://news
 *
 * Phase 4.2 — the shared world-content VM page (news channel).
 *
 *   bucky://news is bound to the news-class world-content domains:
 *       announcement  +  world_event  +  broadcast
 *   Leaks, incidents and maintenance notices each have their own dedicated
 *   page and never appear here (Phase 4.2 stabilisation partitioning).
 *
 *   The site is a thin configuration over the shared factory in
 *   `./worldfeed.js` — the proven Phase 4.2 soft-refresh / seed+live / render
 *   machinery lives there once and is reused by every world-content page. The
 *   public API (`registerNewsSite`, `refreshNews`, `invalidateNewsFeed`) is
 *   preserved verbatim so the rest of the VM (buckynet.js) needs no change.
 *
 *   The bundled SEED_NEWS array is the seed / fallback: it renders instantly
 *   and is what the site shows whenever the backend is unreachable. The live
 *   feed is fetched through the GatewayClient and filtered, defensively, to
 *   exactly the news-class domains — no cross-domain contamination possible.
 *
 * Architecture preserved (project rules):
 *   - SiteRegistry / EventBus / browser runtime untouched.
 *   - render() stays synchronous and pure; the soft-refresh fetch happens off
 *     to the side, inside the factory.
 *   - All authored text is HTML-escaped through the site kit; markdown bodies
 *     are escaped before transformation in core/markdown.js.
 */
import { createWorldFeedSite } from "./worldfeed.js";

/**
 * Bundled SEED announcements — the fallback content. Newest first.
 *   slug, date, category, author, title, summary, body (markdown), tags
 *
 * A live news item carries the same shape; both render identically.
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
            "Leaks, incidents and maintenance each have their own dedicated page on ",
            "the Grid and never show up here. When this feed is quiet, the Grid ",
            "shows its bundled briefing — nothing ever breaks."
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
        summary: "How the world-content feed unifies announcements, world events and broadcasts behind a single Grid page.",
        keywords: ["news", "update", "world", "content", "broadcast", "event", "feed"],
        tags: ["news", "update"],
        featured: false,
        priority: "normal",
        body: [
            "Bucky News is the Grid's **news channel** — the page that carries the ",
            "three news-class signals: **announcements**, **world events** and ",
            "**broadcasts**. They render through one shared pipeline and one set ",
            "of cards.\n\n",
            "Other kinds of signal route to their own pages: leak intel goes to ",
            "`bucky://leaks`, incident notices to `bucky://incidents`, maintenance ",
            "windows to `bucky://maintenance`. Each page renders only its kind. ",
            "Watch this feed for the news; watch the others for the rest."
        ].join(""),
        crossRefs: []
    }
];

// The factory owns the soft-refresh lifecycle, the render pipeline and the
// registry registrations. We give it exactly the news-class domain set.
const newsSite = createWorldFeedSite({
    siteId: "news",
    siteUrl: "bucky://news",
    siteTitle: "Bucky News",
    siteLead: "Announcements, events and broadcasts from across the Grid.",
    siteDomain: "Bucky News",
    introText: "Bucky News — announcements, events and network broadcasts from across the Grid. " +
               "This feed is backend-connected: world content authored by staff appears here live, " +
               "and refreshes itself in the background.",
    domains: ["announcement", "world_event", "broadcast"],
    seedItems: SEED_NEWS,
    crossRefs: [
        { url: "bucky://dev", label: "Bucky Dev", note: "patch notes & hints" },
        { url: "bucky://leaks", label: "Leak Database", note: "leak intel" },
        { url: "bucky://incidents", label: "Incidents", note: "status feed" },
        { url: "bucky://maintenance", label: "Maintenance", note: "downtime notices" },
        { url: "bucky://community", label: "Bucky Community", note: "events & giveaways" }
    ],
    homeKeywords: ["news", "announcements", "events", "broadcasts", "updates",
                   "grid", "world", "world-event", "broadcast"],
    homeTags: ["news", "site", "world"],
    fallbackCategoryLabel: "News",
    fallbackAuthor: "Bucky Network",
    backLabel: "news",
});

// Public API preserved verbatim — buckynet.js calls registerNewsSite, future
// hooks can call refreshNews / invalidateNewsFeed.
export const registerNewsSite = newsSite.register;
export const refreshNews = newsSite.refresh;
export const invalidateNewsFeed = newsSite.invalidate;
