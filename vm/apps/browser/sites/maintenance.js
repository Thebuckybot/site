/**
 * Bucky Maintenance — bucky://maintenance
 *
 * Phase 4.2 stabilisation — the maintenance page of the partitioned VM ecosystem.
 *
 *   bucky://maintenance is bound to ONE world-content domain:
 *   `maintenance_notice`. Items from any other domain are filtered out
 *   (defensively) so a maintenance window can never appear on bucky://news.
 *
 *   The site is a thin configuration over the shared factory in
 *   `./worldfeed.js`. The proven Phase 4.2 soft-refresh / seed+live / render
 *   machinery lives there once and is reused by every world-content page.
 *
 *   `+devportal maintenance` authors an item that lands on this page (its
 *   canonical URL is `bucky://maintenance/<slug>` — the backend
 *   `DOMAIN_VM_SITE` map is the single source of truth and routes it here).
 *
 *   The bundled SEED list renders instantly and is what the site shows when
 *   the backend is unreachable — graceful degradation, no broken page.
 *
 * Architecture preserved: SiteRegistry / EventBus / browser runtime untouched.
 */
import { createWorldFeedSite } from "./worldfeed.js";

/** Bundled seed maintenance notices — render instantly, fall back when offline. */
const SEED_MAINTENANCE = [
    {
        slug: "no-maintenance-scheduled",
        date: "Cycle 313",
        category: "Completed",
        author: "Grid Ops",
        title: "No Maintenance Scheduled",
        summary: "There is no scheduled maintenance on the Grid right now. Future windows will appear here with their start time and expected duration.",
        keywords: ["maintenance", "downtime", "scheduled", "window", "ops", "grid"],
        tags: ["maintenance", "ops"],
        featured: false,
        priority: "normal",
        body: [
            "No maintenance windows are currently scheduled.\n\n",
            "When a window opens it will appear here with one of these categories: ",
            "**scheduled**, **emergency**, **in progress**, **completed** or ",
            "**degraded**. The body carries the time window and the operator-facing ",
            "impact.\n\n",
            "Maintenance NEVER appears on `bucky://news`. This page is the only ",
            "channel for downtime traffic."
        ].join(""),
        crossRefs: []
    }
];

const maintenanceSite = createWorldFeedSite({
    siteId: "maintenance",
    siteUrl: "bucky://maintenance",
    siteTitle: "Bucky Maintenance",
    siteLead: "Scheduled and emergency maintenance windows for the Grid.",
    siteDomain: "Bucky Maintenance",
    introText: "Bucky Maintenance — the Grid's downtime channel. Scheduled and emergency " +
               "maintenance windows appear here live. This feed never carries announcements, " +
               "leaks or incidents; they each have their own dedicated page.",
    domains: ["maintenance_notice"],
    seedItems: SEED_MAINTENANCE,
    crossRefs: [
        { url: "bucky://news", label: "Bucky News", note: "announcements & broadcasts" },
        { url: "bucky://incidents", label: "Incidents", note: "live status feed" },
        { url: "bucky://leaks", label: "Leak Database", note: "leak intel" }
    ],
    homeKeywords: ["maintenance", "downtime", "scheduled", "emergency",
                   "in_progress", "completed", "degraded", "ops", "window", "grid"],
    homeTags: ["maintenance", "site", "ops"],
    fallbackCategoryLabel: "Maintenance",
    fallbackAuthor: "Grid Ops",
    backLabel: "maintenance",
});

export const registerMaintenanceSite = maintenanceSite.register;
export const refreshMaintenance = maintenanceSite.refresh;
export const invalidateMaintenanceFeed = maintenanceSite.invalidate;
