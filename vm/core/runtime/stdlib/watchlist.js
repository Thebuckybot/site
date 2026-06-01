/**
 * bucky.watchlist — operator / org / incident watchlists (Phase 4.5, §8).
 *
 * Watchlists are *local VM state*, not Discord-authoritative data, so this is a
 * real read/write module (unlike economy or hackbank). It persists to a single
 * JSON file in the VM filesystem — /projects/data/watchlists.json — through the
 * same FileSystemService every app shares, so a watchlist a script adds is
 * visible to the Files app and survives for the session exactly like any file.
 * (Cross-session persistence arrives when PersistenceService lands.)
 *
 *   add_operator(handle)   add_org(id)   add_incident(id)
 *   remove(category, value)               clear([category])
 *   list([category])       has(category, value)
 *   check()                cross-reference the watchlist against the live leak
 *                          archive; returns the watched entities now exposed
 *
 * Categories: "operators", "organizations", "incidents". The `filesystem`
 * capability is asserted alongside `watchlist` because the store is file-backed.
 */
import { mod, def, asList, raise } from "./kit.js";

const STORE = "/projects/data/watchlists.json";
const CATEGORIES = ["operators", "organizations", "incidents"];

export function createWatchlistModule(ctx) {
    const fs = ctx.filesystem;

    function ensureParent(path) {
        const info = fs.parentOf(path);
        if (info.parentPath && info.parentPath !== "/" && !fs.exists(info.parentPath)) {
            fs.mkdir(info.parentPath, { owner: ctx.owner || "script", source: "watchlist", recursive: true });
        }
    }
    function load() {
        const r = fs.read(STORE);
        if (!r.ok) return { operators: [], organizations: [], incidents: [] };
        try {
            const data = JSON.parse(r.content || "{}");
            return {
                operators: asList(data.operators),
                organizations: asList(data.organizations),
                incidents: asList(data.incidents)
            };
        } catch (_e) {
            return { operators: [], organizations: [], incidents: [] };
        }
    }
    function save(data) {
        ensureParent(STORE);
        const w = fs.write(STORE, JSON.stringify(data, null, 2), { owner: ctx.owner || "script", source: "watchlist", create: true });
        if (!w.ok) raise("FileError", `cannot write watchlist: ${w.error}`, STORE);
        return true;
    }
    function catKey(category) {
        const c = String(category == null ? "" : category).toLowerCase();
        if (!CATEGORIES.includes(c)) raise("ValueError", `unknown watchlist category '${category}' (use ${CATEGORIES.join(", ")})`);
        return c;
    }
    function add(category, value) {
        const c = catKey(category);
        const v = String(value == null ? "" : value);
        if (!v) raise("ValueError", "watchlist value must be non-empty");
        const data = load();
        if (!data[c].includes(v)) { data[c].push(v); save(data); return true; }
        return false; // already present
    }

    function add_operator(handle) { ctx.caps.require("watchlist", "watchlist.add_operator"); ctx.caps.require("filesystem", "watchlist.add_operator"); return add("operators", handle); }
    function add_org(id) { ctx.caps.require("watchlist", "watchlist.add_org"); ctx.caps.require("filesystem", "watchlist.add_org"); return add("organizations", id); }
    function add_incident(id) { ctx.caps.require("watchlist", "watchlist.add_incident"); ctx.caps.require("filesystem", "watchlist.add_incident"); return add("incidents", id); }

    function remove(category, value) {
        ctx.caps.require("watchlist", "watchlist.remove"); ctx.caps.require("filesystem", "watchlist.remove");
        const c = catKey(category);
        const v = String(value == null ? "" : value);
        const data = load();
        const before = data[c].length;
        data[c] = data[c].filter((x) => x !== v);
        if (data[c].length !== before) { save(data); return true; }
        return false;
    }
    function list(category) {
        ctx.caps.require("watchlist", "watchlist.list");
        const data = load();
        if (category == null) return data;
        return data[catKey(category)].slice();
    }
    function has(category, value) {
        ctx.caps.require("watchlist", "watchlist.has");
        return load()[catKey(category)].includes(String(value == null ? "" : value));
    }
    function clear(category) {
        ctx.caps.require("watchlist", "watchlist.clear"); ctx.caps.require("filesystem", "watchlist.clear");
        const data = load();
        if (category == null) { CATEGORIES.forEach((c) => { data[c] = []; }); }
        else data[catKey(category)] = [];
        save(data);
        return true;
    }
    function check() {
        ctx.caps.require("watchlist", "watchlist.check");
        const data = load();
        const ops = asList(ctx.snapshot && ctx.snapshot.leaks && ctx.snapshot.leaks.operators);
        const incidents = asList(ctx.snapshot && ctx.snapshot.leaks && ctx.snapshot.leaks.incidents);
        const hits = [];
        data.operators.forEach((handle) => {
            const found = ops.find((o) => String(o.handle || "") === handle);
            if (found) hits.push({ category: "operators", value: handle, severity: found.severity || null, incident: found.incident_id || null });
        });
        data.incidents.forEach((id) => {
            const found = incidents.find((i) => String(i.incident_id || "") === id);
            if (found) hits.push({ category: "incidents", value: id, title: found.title || null, severity: found.severity || null });
        });
        return hits;
    }

    return mod("bucky.watchlist", {
        add_operator: def(add_operator),
        add_org: def(add_org),
        add_incident: def(add_incident),
        remove: def(remove),
        list: def(list),
        has: def(has),
        clear: def(clear),
        check: def(check)
    });
}
