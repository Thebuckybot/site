/**
 * Session snapshot store — Phase 4.4, Part 5 (snapshot-backed live data).
 *
 * Holds the backend read-snapshot for the whole VM session. Each data section
 * (leaks / profile / organizations) is fetched ONCE on first use and then
 * reused for every subsequent script run — so scripts read live-but-cached
 * data with NO per-call backend requests. `refresh(section)` marks a section
 * stale and kicks a background reload, so the NEXT run sees fresh data without
 * the current (synchronous) run ever blocking on the network.
 *
 * The GatewayClient is injected so this is trivially testable with a fake.
 */
import { prefetchSnapshot } from "./snapshot.js";

const SECTIONS = ["leaks", "profile", "organizations", "leaderboards"];

export function createSnapshotStore(gateway) {
    const cache = { leaks: null, profile: null, organizations: null, leaderboards: null };
    const fetchedAt = { leaks: 0, profile: 0, organizations: 0, leaderboards: 0 };
    let online = false;

    function current() {
        return {
            online,
            generatedAt: Math.max(fetchedAt.leaks, fetchedAt.profile, fetchedAt.organizations, fetchedAt.leaderboards),
            leaks: cache.leaks,
            profile: cache.profile,
            organizations: cache.organizations,
            leaderboards: cache.leaderboards
        };
    }

    /** Ensure the requested sections are cached; fetch only what is missing. */
    async function ensure(needs) {
        const want = (needs instanceof Set ? [...needs] : (needs || [])).filter((s) => SECTIONS.includes(s));
        const missing = want.filter((s) => !fetchedAt[s]);
        if (missing.length) {
            const snap = await prefetchSnapshot(gateway, new Set(missing));
            if (snap.online) online = true;
            const stamp = snap.generatedAt || Date.now();
            const sectionOk = snap.sectionOk || {};
            missing.forEach((s) => {
                cache[s] = snap[s];
                // Only mark a section "fetched" when its backend call SUCCEEDED.
                // A failed/empty authenticated fetch (e.g. an early /api/player/me
                // 401) stays unfetched so the next run retries it — rather than
                // serving an empty profile for the rest of the session.
                if (sectionOk[s]) fetchedAt[s] = stamp;
            });
        }
        return current();
    }

    function markStale(section) {
        if (section && Object.prototype.hasOwnProperty.call(fetchedAt, section)) fetchedAt[section] = 0;
        else SECTIONS.forEach((s) => { fetchedAt[s] = 0; });
    }

    /** Mark stale + reload in the background; returns immediately. */
    function refresh(section) {
        markStale(section);
        const want = section && SECTIONS.includes(section) ? [section] : SECTIONS.slice();
        Promise.resolve().then(() => ensure(new Set(want))).catch(() => {});
        return { refreshed: true, section: section || "all" };
    }

    /** Pre-load every section (e.g. at VM boot). */
    function prime() {
        return ensure(new Set(SECTIONS)).catch(() => current());
    }

    return { ensure, current, markStale, refresh, prime };
}
