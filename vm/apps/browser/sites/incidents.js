/**
 * Bucky Incidents — bucky://incidents
 *
 * Phase 4.2 stabilisation — the incidents page of the partitioned VM ecosystem.
 *
 *   bucky://incidents is bound to ONE world-content domain: `incident`. Items
 *   from any other domain are filtered out (defensively) so an incident notice
 *   can never appear on bucky://news and an announcement can never appear here.
 *
 *   The site is a thin configuration over the shared factory in
 *   `./worldfeed.js`. The proven Phase 4.2 soft-refresh / seed+live / render
 *   machinery lives there once and is reused by every world-content page.
 *
 *   `+devportal incident` authors an item that lands on this page (its
 *   canonical URL is `bucky://incidents/<slug>` — the backend
 *   `DOMAIN_VM_SITE` map is the single source of truth and routes it here).
 *
 *   The bundled SEED list renders instantly and is what the site shows when
 *   the backend is unreachable — graceful degradation, no broken page.
 *
 * Architecture preserved: SiteRegistry / EventBus / browser runtime untouched.
 */
import { createWorldFeedSite } from "./worldfeed.js";

/** Bundled seed incidents — render instantly, fall back when the backend is down. */
const SEED_INCIDENTS = [
    {
        slug: "all-quiet",
        date: "Cycle 313",
        category: "Resolved",
        author: "Grid Ops",
        title: "All Systems Nominal",
        summary: "No active incidents on the Grid. The status channel will publish here as soon as anything changes.",
        keywords: ["incidents", "status", "ops", "nominal", "all", "quiet", "grid"],
        tags: ["incidents", "status"],
        featured: false,
        priority: "normal",
        body: [
            "All Grid systems are currently nominal. There are no active incidents.\n\n",
            "When an incident opens it will appear here with a category showing its ",
            "lifecycle stage: **investigating → identified → monitoring → resolved**, ",
            "with an optional **postmortem** once the incident is closed.\n\n",
            "Incidents NEVER appear on `bucky://news`. This page is the only channel ",
            "for incident traffic — a real status feed."
        ].join(""),
        crossRefs: []
    }
];

const incidentsSite = createWorldFeedSite({
    siteId: "incidents",
    siteUrl: "bucky://incidents",
    siteTitle: "Bucky Incidents",
    siteLead: "Live incident lifecycle — investigating, identified, monitoring, resolved.",
    siteDomain: "Bucky Incidents",
    introText: "Bucky Incidents — the Grid's status channel. Active incidents and their " +
               "lifecycle stages appear here live. This feed never carries announcements, " +
               "leaks or maintenance notices; they each have their own dedicated page.",
    domains: ["incident"],
    seedItems: SEED_INCIDENTS,
    crossRefs: [
        { url: "bucky://news", label: "Bucky News", note: "announcements & broadcasts" },
        { url: "bucky://maintenance", label: "Maintenance", note: "scheduled downtime" },
        { url: "bucky://leaks", label: "Leak Database", note: "leak intel" }
    ],
    homeKeywords: ["incidents", "incident", "status", "ops", "investigating",
                   "identified", "monitoring", "resolved", "postmortem", "grid"],
    homeTags: ["incidents", "site", "status"],
    fallbackCategoryLabel: "Incident",
    fallbackAuthor: "Grid Ops",
    backLabel: "incidents",
});

export const registerIncidentsSite = incidentsSite.register;
export const refreshIncidents = incidentsSite.refresh;
export const invalidateIncidentsFeed = incidentsSite.invalidate;
