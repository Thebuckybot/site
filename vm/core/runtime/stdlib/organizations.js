/**
 * bucky.organizations — the organisation registry, read-only (Phase 4.4, Part 14).
 *
 * Reads the founding-organisation registry and the caller's affiliation,
 * captured at script start. Public read-model only (the bot owns membership).
 * Also bound to the short prelude name `orgs`.
 *
 *   current()      list()       get(id)      search(query)
 *   members(id)    leaderboard()             refresh()
 *
 * Organisation records mirror the registry shape:
 *   { id, name, tagline, description, members, reputation?, color, emblem,
 *     philosophy, security_ideology }
 */
import { mod, def, asList, matches } from "./kit.js";

export function createOrganizationsModule(ctx) {
    const root = () => (ctx.snapshot && ctx.snapshot.organizations) || {};
    const allOrgs = () => asList(root().list);

    function current() { ctx.caps.require("organizations", "organizations.current"); return root().current || null; }
    function list() { ctx.caps.require("organizations", "organizations.list"); return allOrgs().slice(); }
    function get(id) {
        ctx.caps.require("organizations", "organizations.get");
        const key = String(id == null ? "" : id).toLowerCase();
        return allOrgs().find((o) =>
            String(o.id || "").toLowerCase() === key || String(o.name || "").toLowerCase() === key) || null;
    }
    function search(query) {
        ctx.caps.require("organizations", "organizations.search");
        const q = String(query == null ? "" : query);
        return allOrgs().filter((o) =>
            matches(o.id, q) || matches(o.name, q) || matches(o.tagline, q) || matches(o.description, q));
    }
    function members(id) {
        ctx.caps.require("organizations", "organizations.members");
        const org = id == null ? current() : get(id);
        if (!org) return 0;
        return typeof org.members === "number" ? org.members : 0;
    }
    function leaderboard() {
        ctx.caps.require("organizations", "organizations.leaderboard");
        const rank = (o) => (typeof o.reputation === "number" ? o.reputation : (typeof o.members === "number" ? o.members : 0));
        return allOrgs().slice().sort((a, b) => rank(b) - rank(a));
    }
    function refresh() {
        ctx.caps.require("organizations", "organizations.refresh");
        return ctx.refresh ? ctx.refresh("organizations") : { refreshed: false };
    }

    return mod("bucky.organizations", {
        current: def(current),
        mine: def(current), // alias - the caller's own organisation
        list: def(list),
        get: def(get),
        search: def(search),
        members: def(members),
        leaderboard: def(leaderboard),
        refresh: def(refresh)
    });
}
