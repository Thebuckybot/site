/**
 * leaksLive.js — live world_content leak items registered into bucky://leaks
 * (Phase 4.2 stabilisation).
 *
 *   The Phase 4.1 `leaks.js` Leak Database (its hardcoded BREACHES, EXPOSED
 *   accounts, breach-report and profile sub-pages) is a stable system. This
 *   module does NOT modify it. Instead it augments `bucky://leaks` ADDITIVELY:
 *   live items authored via `+devportal leak` are registered as individual
 *   `bucky://leaks/<slug>` pages so the canonical URL the backend reports for
 *   a leak (the `DOMAIN_VM_SITE` map's `leaks` partition) actually resolves.
 *
 *   It uses the shared `createWorldFeedSite` factory in `itemsOnly: true`
 *   mode: the factory registers ONLY item pages (no home — Phase 4.1
 *   `leaks.js` owns `bucky://leaks`) and its collision guard skips any URL
 *   already registered by `leaks.js` (e.g. `bucky://leaks/breach-reports`).
 *
 *   The factory's soft-refresh lifecycle still works: each live item-page
 *   render triggers `maybeSoftRefresh()`, so the live leak set ages and
 *   re-fetches under the same TTL as every other world-content page.
 *
 *   Result: `+devportal leak` → backend reports `bucky://leaks/<slug>` →
 *   navigating to that URL renders the live leak — partitioning honoured,
 *   Phase 4.1 `leaks.js` untouched, no cross-domain contamination.
 */
import { createWorldFeedSite } from "./worldfeed.js";

const leaksLiveSite = createWorldFeedSite({
    siteId: "leaks",
    siteUrl: "bucky://leaks",
    siteTitle: "Bucky Leaks",
    siteLead: "Live leak intel.",
    siteDomain: "Leak Database",
    introText: "", // unused in itemsOnly mode
    domains: ["leak"],
    seedItems: [],  // Phase 4.1 leaks.js owns the seed/lore content
    homeKeywords: ["leaks"],
    homeTags: ["leaks"],
    fallbackCategoryLabel: "Leak",
    fallbackAuthor: "Anonymous Source",
    backLabel: "leaks",
    itemsOnly: true,
});

export const registerLeaksLive = leaksLiveSite.register;
export const refreshLeaksLive = leaksLiveSite.refresh;
export const invalidateLeaksLive = leaksLiveSite.invalidate;
