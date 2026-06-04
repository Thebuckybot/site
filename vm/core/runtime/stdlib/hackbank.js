/**
 * bucky.hackbank - HackBank client foundation (Phase 4.5, S14; Phase 4.6 BUG-7 fix).
 *
 * IMPORTANT: HackBank authority remains the Discord bot. The VM is ONLY a
 * client. This module lets a script *inspect* whether HackBank is usable
 * (can the operator run a bank hack? is it off cooldown?) - it never performs a
 * HackBank run from the VM. The actual action routes through the Discord bridge
 * (core/runtime/extensions.js) and raises NotImplemented today.
 *
 *   owned()           True when the operator can run HackBank (owns >=1 attack script)
 *   available()       owned() AND not on cooldown - is a run possible right now?
 *   cooldown()        seconds remaining on the cooldown (0 when ready)
 *   status()          { owned, available, cooldown } in one call
 *   run(target)       -> NotImplemented (Discord bridge; authority stays Discord)
 *
 * OWNERSHIP - SOURCE OF TRUTH (Currency.py):
 *   The Discord `hackbank`/`hack`/`bankhack` command is gated SOLELY on the
 *   attacker owning at least one ATTACK script:
 *       if not attacker_profile.get("attack_scripts"):
 *           return "You don't own any attack scripts!"
 *   There is NO "hackbank" inventory item anywhere in the bot (shop/scripts/
 *   data). The Phase 4.5 spec's "Discord HackBank item" never existed, so the
 *   old item-name lookup (items[].name == "hackbank") was permanently False on
 *   real profiles. Ownership therefore == owning any attack script. NOTE: this
 *   is ATTACK scripts (offensive), not SECURITY scripts (defensive firewall/
 *   alert) - security_scripts do NOT grant HackBank capability.
 *
 *   Signal source (backend private_view / /api/player/me snapshot), in order:
 *     1. explicit profile.hackbank.owned (boolean) - lets Discord pin it directly
 *     2. profile.attack_scripts (list, Phase 4.6 backend addition) - length > 0
 *     3. profile.security.attack_scripts (list) / .attack_scripts_count (int)
 *
 * The VM cannot grant ownership or clear a cooldown - only Discord can.
 */
import { mod, def } from "./kit.js";
import { discordBridge } from "../extensions.js";

export function createHackbankModule(ctx) {
    const profile = () => (ctx.snapshot && ctx.snapshot.profile) || {};

    // Count the operator's owned attack scripts from whatever shape the snapshot
    // carries. Mirrors Currency.py's attack_scripts gate; tolerant so it keeps
    // working whether the backend ships the raw list or only the headline count.
    function attackScriptCount() {
        const p = profile();
        if (Array.isArray(p.attack_scripts)) return p.attack_scripts.length;
        const sec = (p.security && typeof p.security === "object") ? p.security : {};
        if (Array.isArray(sec.attack_scripts)) return sec.attack_scripts.length;
        const n = sec.attack_scripts_count;
        return typeof n === "number" && n > 0 ? n : 0;
    }

    function owned() {
        ctx.caps.require("hackbank", "hackbank.owned");
        const p = profile();
        // Explicit override always wins (Discord may pin ownership directly).
        if (p.hackbank && typeof p.hackbank.owned === "boolean") return p.hackbank.owned;
        // Source of truth: owning any attack script => HackBank is owned.
        return attackScriptCount() > 0;
    }
    function cooldown() {
        ctx.caps.require("hackbank", "hackbank.cooldown");
        const hb = profile().hackbank || {};
        const v = hb.cooldown != null ? hb.cooldown : hb.cooldown_seconds;
        return typeof v === "number" && v > 0 ? v : 0;
    }
    function available() {
        ctx.caps.require("hackbank", "hackbank.available");
        // The spec rule: no ownership => unavailable, full stop.
        return owned() && cooldown() === 0;
    }
    function status() {
        ctx.caps.require("hackbank", "hackbank.status");
        const own = owned();
        return {
            owned: own,
            available: own && cooldown() === 0,
            cooldown: cooldown(),
            note: own ? null : "HackBank locked - buy an attack script through Discord (+shop)."
        };
    }
    function run(target) {
        ctx.caps.require("hackbank", "hackbank.run");
        // No bypasses: the VM cannot execute a HackBank run. Route to Discord.
        return discordBridge.hackbank("run", { target });
    }

    return mod("bucky.hackbank", {
        owned: def(owned),
        available: def(available),
        cooldown: def(cooldown),
        status: def(status),
        run: def(run)
    });
}
