/**
 * bucky.profile — the operator's own identity, read-only (Phase 4.4, Part 13).
 *
 * Reads the self-view captured from /api/player/me at script start. Strictly
 * read-only by construction: the Discord bot is the sole authoritative writer
 * of profiles, and this API honours that — there is no setter.
 *
 *   me()           level()      prestige()   xp()        coins()
 *   organization() reputation() exposures()  titles()    summary()
 *   refresh()      request a fresh snapshot for the NEXT run
 *
 * Degrades to safe defaults (level 1, 0 xp/coins, no org, empty exposures)
 * when the operator has no profile yet, is logged out, or the backend is
 * offline — so a script never crashes on identity.
 */
import { mod, def } from "./kit.js";

export function createProfileModule(ctx) {
    const view = () => (ctx.snapshot && ctx.snapshot.profile) || {};
    const num = (v, dflt) => (typeof v === "number" ? v : (v != null && !Number.isNaN(Number(v)) ? Number(v) : dflt));

    function me() {
        ctx.caps.require("profile", "profile.me");
        return Object.assign({}, view());
    }
    function level() { ctx.caps.require("profile", "profile.level"); return num(view().level, 1); }
    function prestige() { ctx.caps.require("profile", "profile.prestige"); return num(view().prestige, 0); }
    function xp() { ctx.caps.require("profile", "profile.xp"); return num(view().xp, 0); }
    function coins() { ctx.caps.require("profile", "profile.coins"); return num(view().coins, 0); }
    function organization() { ctx.caps.require("profile", "profile.organization"); return view().organization || null; }
    function reputation() {
        ctx.caps.require("profile", "profile.reputation");
        const v = view();
        if (v.organization && v.organization.reputation != null) return num(v.organization.reputation, 0);
        return num(v.reputation, 0);
    }
    function exposures() {
        ctx.caps.require("profile", "profile.exposures");
        return Array.isArray(view().exposures) ? view().exposures.slice() : [];
    }
    function titles() {
        ctx.caps.require("profile", "profile.titles");
        return Array.isArray(view().titles) ? view().titles.slice() : [];
    }
    function summary() {
        ctx.caps.require("profile", "profile.summary");
        const v = view();
        return {
            level: num(v.level, 1), prestige: num(v.prestige, 0), xp: num(v.xp, 0),
            coins: num(v.coins, 0), reputation: reputation(),
            organization: v.organization ? (v.organization.name || v.organization.id || null) : null,
            exposures: Array.isArray(v.exposures) ? v.exposures.length : 0,
            titles: Array.isArray(v.titles) ? v.titles.length : 0
        };
    }
    function refresh() {
        ctx.caps.require("profile", "profile.refresh");
        return ctx.refresh ? ctx.refresh("profile") : { refreshed: false };
    }

    return mod("bucky.profile", {
        me: def(me),
        level: def(level),
        prestige: def(prestige),
        xp: def(xp),
        coins: def(coins),
        organization: def(organization),
        reputation: def(reputation),
        exposures: def(exposures),
        titles: def(titles),
        summary: def(summary),
        refresh: def(refresh)
    });
}
