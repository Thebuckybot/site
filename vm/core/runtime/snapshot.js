/**
 * Backend snapshot — gateway-snapshot-at-start (Phase 4.4, Parts 12–14).
 *
 * Before a script runs, the runtime captures a single read-only snapshot of
 * the backend data the script's imports require (leaks / profile /
 * organizations) via the existing GatewayClient. The bucky.* data modules then
 * read from this frozen snapshot, so script execution stays synchronous and
 * deterministic for the duration of one run — and the VM keeps its strict
 * read-only-consumer contract (the GatewayClient performs reads only).
 *
 * ENVELOPE UNWRAPPING
 *   The player gateway endpoints wrap their payload in a single-item envelope
 *   `{ available, item: {...} }` (and may signal `{ first_run: true,
 *   item: null }`). The leak endpoints use `{ stats }`, `{ items }` and
 *   `{ records }`. This module unwraps each to the bare object/array the
 *   bucky.* modules expect — defensively, tolerating either the enveloped or a
 *   bare shape, so an accessor like profile.level() reads the real value
 *   rather than a default.
 *
 * Every fetch is individually guarded: a failed or offline call degrades that
 * section to empty data and flips `online` to false, never throwing into the
 * run. The GatewayClient is injected (not imported) so this module stays
 * trivially testable headlessly with a fake gateway.
 */

function pick(...candidates) {
    for (const c of candidates) {
        if (Array.isArray(c)) return c;
    }
    return [];
}

/**
 * Normalise the /api/leaderboards payload to { kinds: { <kind>: rows[] } },
 * tolerating several wrapper shapes (a `boards`/`leaderboards`/`kinds` map, or
 * the bare object), so bucky.leaderboards reads a stable shape (Phase 4.5, §13).
 */
function normalizeLeaderboards(data) {
    const d = data || {};
    const kinds = {};
    // Backend shape (services/leaderboard_service.list_all):
    //   { available, kinds:[...names], boards:[ { kind, items:[...] }, ... ] }
    // `boards` is an ARRAY of per-kind envelopes — key each by its `kind`.
    if (Array.isArray(d.boards)) {
        d.boards.forEach((b) => { if (b && b.kind) kinds[b.kind] = Array.isArray(b.items) ? b.items : []; });
        return { kinds };
    }
    // Tolerate a map shape too ({ richest:[...] } or { richest:{ items:[...] } }).
    const src = d.boards || d.leaderboards || d.kinds || d;
    if (src && typeof src === "object" && !Array.isArray(src)) {
        Object.keys(src).forEach((k) => {
            const v = src[k];
            if (Array.isArray(v)) kinds[k] = v;
            else if (v && Array.isArray(v.items)) kinds[k] = v.items;
            else if (v && Array.isArray(v.rows)) kinds[k] = v.rows;
        });
    }
    return { kinds };
}

/**
 * Unwrap a player-style { available, item } envelope to its item object.
 * Tolerant of transport nesting ({ data: { available, item } }), `player` /
 * `profile` keys, and a bare profile shape, so profile.level()/coins()/xp() read
 * the real authenticated values rather than defaults.
 */
function unwrapItem(data) {
    let d = data || {};
    if (d.data && typeof d.data === "object" && !Array.isArray(d.data) &&
        (d.data.item || d.data.player || d.data.profile || typeof d.data.level === "number")) {
        d = d.data;
    }
    if (d.item && typeof d.item === "object") return d.item;
    if (d.player && typeof d.player === "object") return d.player;
    if (d.profile && typeof d.profile === "object") return d.profile;
    // Bare shape fallback: the payload's own fields (no envelope).
    if (typeof d.level === "number" || typeof d.coins === "number" || typeof d.xp === "number" || d.user_id) return d;
    return {};
}

/**
 * @param {object} gateway  the GatewayClient (or a compatible fake)
 * @param {Set<string>} needs  required capabilities (leaks|profile|organizations)
 * @returns {Promise<object>} the snapshot
 */
export async function prefetchSnapshot(gateway, needs) {
    const want = needs instanceof Set ? needs : new Set(needs || []);
    const snapshot = { generatedAt: Date.now(), online: false, leaks: null, profile: null, organizations: null, leaderboards: null };
    // Per-section success. A section is only worth CACHING when its backend
    // call actually succeeded — so a transient/early failure (e.g. an
    // /api/player/me 401 before auth settles) is NOT cached, and the next run
    // retries it instead of being stuck with an empty profile all session.
    snapshot.sectionOk = { leaks: false, profile: false, organizations: false, leaderboards: false };
    if (!gateway) return snapshot;

    let anyOk = false;
    const okWrap = async (fn) => {
        try {
            const res = await fn();
            if (res && res.ok) anyOk = true;
            return res || { ok: false, data: null };
        } catch (_e) {
            return { ok: false, data: null };
        }
    };

    const jobs = [];

    if (want.has("leaks")) {
        jobs.push((async () => {
            const [stats, incidents, operators, mine] = await Promise.all([
                okWrap(() => gateway.fetchLeakStats && gateway.fetchLeakStats()),
                okWrap(() => gateway.fetchLeakIncidents && gateway.fetchLeakIncidents()),
                okWrap(() => gateway.fetchLeakOperators && gateway.fetchLeakOperators()),
                okWrap(() => gateway.fetchMyLeaks && gateway.fetchMyLeaks())
            ]);
            snapshot.sectionOk.leaks = !!(stats.ok || incidents.ok || operators.ok || mine.ok);
            snapshot.leaks = {
                stats: (stats.data && (stats.data.stats || stats.data)) || {},
                incidents: pick(incidents.data && incidents.data.items, incidents.data && incidents.data.incidents, incidents.data),
                operators: pick(operators.data && operators.data.records, operators.data && operators.data.operators, operators.data),
                mine: pick(mine.data && mine.data.items, mine.data && mine.data.records, mine.data)
            };
        })());
    }

    if (want.has("profile")) {
        jobs.push((async () => {
            const me = await okWrap(() => gateway.fetchSelfPlayer && gateway.fetchSelfPlayer());
            snapshot.sectionOk.profile = !!me.ok;
            snapshot.profile = unwrapItem(me.data);
        })());
    }

    if (want.has("organizations")) {
        jobs.push((async () => {
            const [orgs, mine] = await Promise.all([
                okWrap(() => gateway.fetchOrganizations && gateway.fetchOrganizations()),
                okWrap(() => gateway.fetchMyOrganization && gateway.fetchMyOrganization())
            ]);
            snapshot.sectionOk.organizations = !!(orgs.ok || mine.ok);
            snapshot.organizations = {
                list: pick(orgs.data && orgs.data.items, orgs.data && orgs.data.organizations, orgs.data),
                current: (mine.data && (mine.data.item || mine.data.organization)) || null
            };
        })());
    }

    if (want.has("leaderboards")) {
        jobs.push((async () => {
            const board = await okWrap(() => gateway.fetchLeaderboards && gateway.fetchLeaderboards(25));
            snapshot.sectionOk.leaderboards = !!board.ok;
            snapshot.leaderboards = normalizeLeaderboards(board.data);
        })());
    }

    await Promise.all(jobs);
    snapshot.online = anyOk;
    return snapshot;
}
