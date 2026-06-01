/**
 * bucky.search — the global query API (Phase 4.5, §19).
 *
 * A single entry point that searches across the captured snapshot sections so a
 * script does not have to know which dataset a term lives in. Read-only; it is a
 * convenience facade over `bucky.leaks` / `bucky.organizations` / the
 * leaderboard projections, never a new data source.
 *
 *   leaks(query)      exposed operators matching handle / incident / severity
 *   orgs(query)       organisations matching id / name / tagline / description
 *   players(query)    known operators (leaderboards + leak archive) by handle
 *   all(query)        { leaks, orgs, players } in one pass
 *
 * Every reader degrades to an empty list when the relevant section was not
 * captured or the operator is offline.
 */
import { mod, def, asList, matches } from "./kit.js";

export function createSearchModule(ctx) {
    const leaksRoot = () => (ctx.snapshot && ctx.snapshot.leaks) || {};
    const orgsRoot = () => (ctx.snapshot && ctx.snapshot.organizations) || {};
    const boardKinds = () => {
        const b = (ctx.snapshot && ctx.snapshot.leaderboards) || {};
        return b.kinds && typeof b.kinds === "object" ? b.kinds : {};
    };

    function leaks(query) {
        ctx.caps.require("search", "search.leaks");
        const q = String(query == null ? "" : query);
        return asList(leaksRoot().operators).filter((o) =>
            matches(o.handle, q) || matches(o.incident_id, q) || matches(o.incident_title, q) || matches(o.severity, q));
    }
    function orgs(query) {
        ctx.caps.require("search", "search.orgs");
        const q = String(query == null ? "" : query);
        return asList(orgsRoot().list).filter((o) =>
            matches(o.id, q) || matches(o.name, q) || matches(o.tagline, q) || matches(o.description, q));
    }
    function players(query) {
        ctx.caps.require("search", "search.players");
        const q = String(query == null ? "" : query);
        const seen = new Set();
        const out = [];
        const add = (handle, id, extra) => {
            // Dedup by handle first (the identifier common to both sources); an
            // operator may appear with a user_id in the leaderboard and without
            // one in the leak archive, so keying on id alone double-counts them.
            const key = String(handle || id || "").toLowerCase();
            if (!handle || seen.has(key)) return;
            seen.add(key);
            out.push(Object.assign({ handle, user_id: id || null }, extra || {}));
        };
        // Leaderboard rows first (richest/level/...), then leak-archive operators.
        Object.values(boardKinds()).forEach((rows) => asList(rows).forEach((r) => {
            if (matches(r.handle, q) || matches(r.user_id, q)) add(r.handle, r.user_id || r.id, { source: "leaderboard", value: r.value });
        }));
        asList(leaksRoot().operators).forEach((o) => {
            if (matches(o.handle, q) || matches(o.user_id, q)) add(o.handle, o.user_id, { source: "leak", severity: o.severity });
        });
        return out;
    }
    function all(query) {
        ctx.caps.require("search", "search.all");
        return { leaks: leaks(query), orgs: orgs(query), players: players(query) };
    }

    return mod("bucky.search", {
        leaks: def(leaks),
        orgs: def(orgs),
        players: def(players),
        all: def(all)
    });
}
