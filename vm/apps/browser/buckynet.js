/**
 * BuckyNet — the assembled fake internet.
 *
 * Builds the one shared SiteRegistry for the whole VM and registers every
 * site's content into it. The browser app resolves and searches bucky://
 * addresses against the registry this module returns.
 *
 * Single registry, built lazily, shared by every browser window:
 *   - content is registered exactly once, on first access;
 *   - multiple browser windows read the same registry (cheap, consistent);
 *   - the registry is the single seam for future content. A backend feed, a
 *     Discord-linked dev post, an OSINT dataset or a mission-triggered page
 *     all arrive as `getBuckyNet().register(...)` calls and require no change
 *     to the browser, the router or the existing sites.
 *
 * This module is the ONLY place that knows the full set of sites, so adding a
 * site is: write the site module, import its register function here, call it.
 */
import { createSiteRegistry } from "../../core/siteRegistry.js";
import { registerSearchSite } from "./sites/search.js";
import { registerWikiSite } from "./sites/wiki.js";
import { registerTubeSite } from "./sites/tube.js";
import { registerDevSite } from "./sites/dev.js";
import { registerNewsSite } from "./sites/news.js";
import { registerLeaksSite } from "./sites/leaks.js";
import { registerBuckySite } from "./sites/bucky.js";
import { registerCommunitySite } from "./sites/community.js";
import { registerHiddenSites } from "./sites/hidden.js";

/** @type {ReturnType<typeof createSiteRegistry>|null} */
let registry = null;

/**
 * Get the shared BuckyNet SiteRegistry, building and seeding it on first call.
 * @returns the registry API (register / resolve / has / search / list / sites)
 */
export function getBuckyNet() {
    if (registry) return registry;

    registry = createSiteRegistry();

    // Order is cosmetic — resolution is keyed by URL, search is keyed by score.
    registerSearchSite(registry);
    registerBuckySite(registry);
    registerWikiSite(registry);
    registerTubeSite(registry);
    registerDevSite(registry);
    registerNewsSite(registry);
    registerLeaksSite(registry);
    registerCommunitySite(registry);
    // Hidden pages are searchable:false — present for direct routing, absent
    // from PulseSearch. Registered last; order does not affect resolution.
    registerHiddenSites(registry);

    return registry;
}
