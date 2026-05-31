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

/** Unwrap a player-style { available, item } envelope to its item object. */
function unwrapItem(data) {
    const d = data || {};
    if (d.item && typeof d.item === "object") return d.item;
    if (d.player && typeof d.player === "object") return d.player;
    // Bare shape fallback: the payload's own fields (no envelope).
    if (typeof d.level === "number" || typeof d.coins === "number" || d.user_id) return d;
    return {};
}

/**
 * @param {object} gateway  the GatewayClient (or a compatible fake)
 * @param {Set<string>} needs  required capabilities (leaks|profile|organizations)
 * @returns {Promise<object>} the snapshot
 */
export async function prefetchSnapshot(gateway, needs) {
    const want = needs instanceof Set ? needs : new Set(needs || []);
    const snapshot = { generatedAt: Date.now(), online: false, leaks: null, profile: null, organizations: null };
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
            snapshot.profile = unwrapItem(me.data);
        })());
    }

    if (want.has("organizations")) {
        jobs.push((async () => {
            const [orgs, mine] = await Promise.all([
                okWrap(() => gateway.fetchOrganizations && gateway.fetchOrganizations()),
                okWrap(() => gateway.fetchMyOrganization && gateway.fetchMyOrganization())
            ]);
            snapshot.organizations = {
                list: pick(orgs.data && orgs.data.items, orgs.data && orgs.data.organizations, orgs.data),
                current: (mine.data && (mine.data.item || mine.data.organization)) || null
            };
        })());
    }

    await Promise.all(jobs);
    snapshot.online = anyOk;
    return snapshot;
}
