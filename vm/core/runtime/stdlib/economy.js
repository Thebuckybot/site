/**
 * bucky.economy — the operator's economy, read-only first (Phase 4.5, §11).
 *
 * Reads coins / bank / net-worth from the self-view profile snapshot captured at
 * script start. Reads are free and synchronous; the WRITE path
 * (`economy.transfer`) is deliberately NOT implemented in the VM — it routes
 * through the Discord bridge (core/runtime/extensions.js), which raises
 * NotImplemented today. The Discord bot remains the sole authority over the
 * economy; the VM is a client that can look but not move money (Phase 4.5, §15).
 *
 *   balance()         spendable coins on hand
 *   bank()            banked coins
 *   networth()        total net worth
 *   summary()         { coins, bank, networth }
 *   transfer(to, amt) → NotImplemented (Discord bridge; arrives in a later phase)
 *
 * Degrades to zeros when the operator is offline or has no profile yet.
 */
import { mod, def } from "./kit.js";
import { discordBridge } from "../extensions.js";

export function createEconomyModule(ctx) {
    const view = () => (ctx.snapshot && ctx.snapshot.profile) || {};
    const num = (v, d) =>
        (typeof v === "number" ? v : (v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : d));

    function balance() { ctx.caps.require("economy", "economy.balance"); return num(view().coins, 0); }
    function bank() { ctx.caps.require("economy", "economy.bank"); return num(view().bank, 0); }
    function networth() { ctx.caps.require("economy", "economy.networth"); return num(view().networth, 0); }
    function summary() {
        ctx.caps.require("economy", "economy.summary");
        return { coins: balance(), bank: bank(), networth: networth() };
    }
    function transfer(to, amount) {
        ctx.caps.require("economy", "economy.transfer");
        // Routes VM → Gateway → Discord logic. The bridge stub raises a friendly
        // NotImplementedError until the write path lands (Phase 4.5, §15).
        return discordBridge.economy("transfer", { to, amount });
    }

    return mod("bucky.economy", {
        balance: def(balance),
        bank: def(bank),
        networth: def(networth),
        summary: def(summary),
        transfer: def(transfer)
    });
}
