/**
 * bucky.inventory — the operator's items, read-only (Phase 4.5, §10).
 *
 * Reads the inventory carried on the self-view profile snapshot captured at
 * script start (the same `/api/player/me` payload `bucky.profile` reads). The VM
 * is a read-only consumer: items are granted, traded and consumed through the
 * Discord bot, never a script. There is NO write path here.
 *
 *   items()           every item record (or bare name) the operator holds
 *   has(name)         True when an item with that name is held
 *   search(query)     items whose name / type / category / description match
 *   count([name])     total item count, or the quantity of one named item
 *
 * Item records are tolerated in several shapes — a bare string, or an object
 * with { name|item|id|label, quantity?, type?, category?, description? } — so the
 * module keeps working as the backend inventory shape firms up. Degrades to an
 * empty inventory when the operator is offline or has no items.
 */
import { mod, def, asList, matches } from "./kit.js";

export function createInventoryModule(ctx) {
    const view = () => (ctx.snapshot && ctx.snapshot.profile) || {};
    const rawItems = () => asList(view().items || view().inventory);
    const nameOf = (it) =>
        typeof it === "string" ? it : String((it && (it.name || it.item || it.id || it.label)) || "");
    // Quantity field. SOURCE OF TRUTH (Currency.py): items are stored as
    // { "id": <item_id>, "amount": <int> } (see buy/give/sell in Currency.py).
    // Phase 4.6 BUG-8 fix: read `amount` first — the old code only honoured
    // `quantity`, so every stack counted as 1 and inventory.count() undercounted
    // stacked items. Tolerate quantity/qty/count for non-bot shapes.
    const qtyOf = (it) => {
        if (!it || typeof it !== "object") return 1;
        const v = (typeof it.amount === "number") ? it.amount
            : (typeof it.quantity === "number") ? it.quantity
            : (typeof it.qty === "number") ? it.qty
            : (typeof it.count === "number") ? it.count
            : 1;
        return typeof v === "number" && v > 0 ? v : 1;
    };

    function items() {
        ctx.caps.require("inventory", "inventory.items");
        return rawItems().slice();
    }
    function has(name) {
        ctx.caps.require("inventory", "inventory.has");
        const q = String(name == null ? "" : name).toLowerCase();
        return rawItems().some((it) => nameOf(it).toLowerCase() === q);
    }
    function search(query) {
        ctx.caps.require("inventory", "inventory.search");
        const q = String(query == null ? "" : query);
        return rawItems().filter((it) =>
            matches(nameOf(it), q) ||
            (typeof it === "object" && it && (matches(it.type, q) || matches(it.category, q) || matches(it.description, q))));
    }
    function count(name) {
        ctx.caps.require("inventory", "inventory.count");
        const all = rawItems();
        if (name == null) {
            // No items list captured but the API gave a headline count — use it.
            if (!all.length && typeof view().inventory_count === "number") return view().inventory_count;
            return all.reduce((n, it) => n + qtyOf(it), 0);
        }
        const q = String(name).toLowerCase();
        return all.filter((it) => nameOf(it).toLowerCase() === q).reduce((n, it) => n + qtyOf(it), 0);
    }

    return mod("bucky.inventory", {
        items: def(items),
        has: def(has),
        search: def(search),
        count: def(count)
    });
}
