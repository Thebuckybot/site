/**
 * bucky.leaks — OSINT leak-database API for scripts (Phase 4.4, Part 12).
 *
 * Reads the real leak data the Leak Database (bucky://leaks) renders, captured
 * as a snapshot when the script started (gateway-snapshot-at-start). The VM is
 * a read-only consumer: there is NO write path here — leak triggers run through
 * the Discord bot, never a script.
 *
 *   latest([limit])     recently exposed operators (newest first)
 *   mine()              the calling operator's own exposure history
 *   search(query)       operators whose handle / incident / severity match
 *   incident(id)        one incident record by LEAK-id
 *   incidents()         the incident index
 *   bySeverity(sev)     operators at a severity (low|medium|high|severe)
 *   statistics()/stats()  headline counts
 *   refresh()           request a fresh snapshot for the NEXT run
 *
 * Operator records mirror the backend osint_service shape:
 *   { user_id, handle, severity, incident_id, incident_title }
 * Incident records: { incident_id, title, severity, affected_operators }.
 * Degrades gracefully to empty results when offline / no leak data captured.
 */
import { mod, def, asList, matches } from "./kit.js";

export function createLeaksModule(ctx) {
    const data = () => (ctx.snapshot && ctx.snapshot.leaks) || {};
    const operators = () => asList(data().operators);

    function latest(limit) {
        ctx.caps.require("leaks", "leaks.latest");
        const ops = operators();
        return typeof limit === "number" && limit > 0 ? ops.slice(0, limit) : ops.slice();
    }
    function mine() {
        ctx.caps.require("leaks", "leaks.mine");
        return asList(data().mine).slice();
    }
    function incidents() {
        ctx.caps.require("leaks", "leaks.incidents");
        return asList(data().incidents).slice();
    }
    function search(query) {
        ctx.caps.require("leaks", "leaks.search");
        const q = String(query == null ? "" : query);
        return operators().filter((o) =>
            matches(o.handle, q) || matches(o.incident_id, q) ||
            matches(o.incident_title, q) || matches(o.severity, q));
    }
    function incident(id) {
        ctx.caps.require("leaks", "leaks.incident");
        const key = String(id == null ? "" : id).toLowerCase();
        return asList(data().incidents).find((i) => String(i.incident_id || "").toLowerCase() === key) || null;
    }
    function bySeverity(sev) {
        ctx.caps.require("leaks", "leaks.bySeverity");
        const s = String(sev == null ? "" : sev).toLowerCase();
        return operators().filter((o) => String(o.severity || "").toLowerCase() === s);
    }
    function statistics() {
        ctx.caps.require("leaks", "leaks.statistics");
        return Object.assign({}, data().stats || {});
    }
    function refresh() {
        ctx.caps.require("leaks", "leaks.refresh");
        return ctx.refresh ? ctx.refresh("leaks") : { refreshed: false };
    }

    return mod("bucky.leaks", {
        latest: def(latest),
        recent: def(latest), // alias — recently exposed operators (newest first)
        mine: def(mine),
        incidents: def(incidents),
        search: def(search),
        incident: def(incident),
        bySeverity: def(bySeverity),
        statistics: def(statistics),
        stats: def(statistics),
        refresh: def(refresh)
    });
}
