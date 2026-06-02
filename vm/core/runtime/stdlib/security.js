/**
 * bucky.security — the operator's security posture, read-only (Phase 4.5, §12).
 *
 * Composes a security view from two snapshot sections captured at script start:
 * the self-view profile (firewall/defence fields + recorded exposures) and the
 * leak archive (whether the operator currently appears as breached). All reads,
 * no writes — defensive *actions* (raising a firewall, clearing an exposure)
 * route through the Discord bridge in a later phase, never a script.
 *
 *   status()          composite posture { breached, exposures, firewall, score }
 *   firewall()        { enabled, tier } defence summary
 *   exposures()       the operator's recorded exposure list
 *   breached()        True when the operator appears in the live leak archive
 *
 * Degrades to a safe "no data" posture (not breached, empty exposures) when the
 * operator is offline or nothing was captured — a script never crashes.
 */
import { mod, def, asList } from "./kit.js";

export function createSecurityModule(ctx) {
    const profile = () => (ctx.snapshot && ctx.snapshot.profile) || {};
    const leaks = () => (ctx.snapshot && ctx.snapshot.leaks) || {};
    const num = (v, d) =>
        (typeof v === "number" ? v : (v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : d));

    function exposures() {
        ctx.caps.require("security", "security.exposures");
        const p = profile();
        if (Array.isArray(p.exposures)) return p.exposures.slice();
        // Fall back to the operator's own leak history if the profile omits it.
        return asList(leaks().mine).slice();
    }
    function breached() {
        ctx.caps.require("security", "security.breached");
        // The backend self-view exposes an explicit `security.breached` flag;
        // honour it, then fall back to the exposure list.
        const sec = profile().security || {};
        if (typeof sec.breached === "boolean") return sec.breached || exposures().length > 0;
        return exposures().length > 0;
    }
    function firewall() {
        ctx.caps.require("security", "security.firewall");
        const sec = profile().security || {};
        // The backend self-view (services/player_service._security_view) ships
        // `firewall_level` (an int), NOT a boolean. Map it: level 0 = none,
        // 1–2 = basic, 3+ = hardened. Tolerate an explicit boolean/tier too.
        const lvl = num(sec.firewall_level, sec.firewall === true ? 1 : (sec.firewall === false ? 0 : 0));
        const enabled = lvl > 0 || sec.firewall === true;
        const tier = sec.firewall_tier || sec.tier || (lvl >= 3 ? "hardened" : lvl >= 1 ? "basic" : "none");
        return { enabled, tier, level: lvl };
    }
    function status() {
        ctx.caps.require("security", "security.status");
        const exp = exposures();
        const fw = firewall();
        // A coarse 0–100 posture score: start hardened, subtract for each
        // exposure, add for an active firewall. Presentation-only flavour.
        let score = 100 - Math.min(80, exp.length * 15);
        if (fw.enabled) score = Math.min(100, score + 10);
        return {
            breached: exp.length > 0,
            exposures: exp.length,
            firewall: fw,
            score: Math.max(0, score),
            posture: exp.length === 0 ? (fw.enabled ? "secure" : "exposed-soft") : "compromised"
        };
    }

    return mod("bucky.security", {
        status: def(status),
        firewall: def(firewall),
        exposures: def(exposures),
        breached: def(breached)
    });
}
