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
        return exposures().length > 0;
    }
    function firewall() {
        ctx.caps.require("security", "security.firewall");
        const sec = profile().security || {};
        // Read explicit defence fields when present; otherwise derive a sensible
        // posture from progression (a higher-level operator has a hardened node).
        const enabled = sec.firewall != null ? !!sec.firewall : num(profile().level, 1) >= 3;
        const tier = sec.firewall_tier || sec.tier || (enabled ? "standard" : "none");
        return { enabled, tier };
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
