/**
 * bucky.hackbank — HackBank client foundation (Phase 4.5, §14).
 *
 * IMPORTANT: HackBank authority remains the Discord bot. The VM is ONLY a
 * client. This module lets a script *inspect* whether HackBank is usable
 * (does the operator own the Discord item? is it off cooldown?) — it never
 * performs a HackBank run from the VM. The actual action routes through the
 * Discord bridge (core/runtime/extensions.js) and raises NotImplemented today.
 *
 *   owned()           True when the operator owns the Discord HackBank item
 *   available()       owned() AND not on cooldown — is a run possible right now?
 *   cooldown()        seconds remaining on the cooldown (0 when ready)
 *   status()          { owned, available, cooldown } in one call
 *   run(target)       → NotImplemented (Discord bridge; authority stays Discord)
 *
 * RULE (spec §14): if the player does not own the Discord item, every readiness
 * reader reports unavailable. Reads come from the profile/inventory snapshot;
 * the VM cannot grant ownership or clear a cooldown — only Discord can.
 */
import { mod, def, asList } from "./kit.js";
import { discordBridge } from "../extensions.js";

const HACKBANK_ITEM = "hackbank";

export function createHackbankModule(ctx) {
    const profile = () => (ctx.snapshot && ctx.snapshot.profile) || {};
    const itemNames = () => asList(profile().items || profile().inventory).map((it) =>
        (typeof it === "string" ? it : String((it && (it.name || it.item || it.id || it.label)) || "")).toLowerCase());

    function owned() {
        ctx.caps.require("hackbank", "hackbank.owned");
        const p = profile();
        if (p.hackbank && typeof p.hackbank.owned === "boolean") return p.hackbank.owned;
        return itemNames().some((n) => n.includes(HACKBANK_ITEM));
    }
    function cooldown() {
        ctx.caps.require("hackbank", "hackbank.cooldown");
        const hb = profile().hackbank || {};
        const v = hb.cooldown != null ? hb.cooldown : hb.cooldown_seconds;
        return typeof v === "number" && v > 0 ? v : 0;
    }
    function available() {
        ctx.caps.require("hackbank", "hackbank.available");
        // The spec rule: no ownership ⇒ unavailable, full stop.
        return owned() && cooldown() === 0;
    }
    function status() {
        ctx.caps.require("hackbank", "hackbank.status");
        const own = owned();
        return {
            owned: own,
            available: own && cooldown() === 0,
            cooldown: cooldown(),
            note: own ? null : "HackBank item not owned — acquire it through Discord."
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
