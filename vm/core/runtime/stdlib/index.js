/**
 * Standard-library assembler — Phase 4.4 (Parts 2 & 3) + Phase 4.5 expansion.
 *
 * Builds, for one script run, the bucky.* module table the interpreter imports
 * from and the convenience "prelude" bound as builtins (so example scripts can
 * call `leaks.latest()` / `table.render(...)` / `economy.balance()` without an
 * import, while explicit imports — `from bucky.leaks import *`,
 * `import bucky.economy` — also work).
 *
 * Modules are constructed against a single context object:
 *   { filesystem, cwd, caps, owner, snapshot, user, refresh,
 *     processes, pid, automation, schedule, notify }   ← Phase 4.5 additions
 *
 * Registered extension modules (core/runtime/extensions.js, Part 23) are
 * merged in when their capability is granted — the seam future subsystems use.
 */
import { mod, def } from "./kit.js";
import { createFilesModule } from "./files.js";
import { createJsonModule } from "./json.js";
import { createLeaksModule } from "./leaks.js";
import { createProfileModule } from "./profile.js";
import { createOrganizationsModule } from "./organizations.js";
import { createTerminalModule } from "./terminal.js";
import { createMailModule, createDatabaseModule, createMissionsModule } from "./future.js";
// Phase 4.5 modules.
import { createProcessModule } from "./process.js";
import {
    createProgressModule, createTableModule, createStatusModule,
    createNotifyModule, createFormModule, createMenuModule, createUiModule
} from "./ui.js";
import { createInventoryModule } from "./inventory.js";
import { createEconomyModule } from "./economy.js";
import { createSecurityModule } from "./security.js";
import { createLeaderboardsModule } from "./leaderboards.js";
import { createHackbankModule } from "./hackbank.js";
import { createWatchlistModule } from "./watchlist.js";
import { createSearchModule } from "./search.js";
import { createReportModule } from "./report.js";
import { createEventsModule, createScheduleModule } from "./events.js";
import { registeredModules } from "../extensions.js";
import { moduleCapability } from "../capabilities.js";
import { HELP } from "./helptext.js";

export function buildStandardLibrary(ctx) {
    // Phase 4.4 core.
    const files = createFilesModule(ctx);
    const json = createJsonModule(ctx);
    const leaks = createLeaksModule(ctx);
    const profile = createProfileModule(ctx);
    const organizations = createOrganizationsModule(ctx);
    const terminal = createTerminalModule(ctx);
    const mail = createMailModule(ctx);
    const database = createDatabaseModule(ctx);
    const missions = createMissionsModule(ctx);

    // Phase 4.5 — process, UI toolkit, read-only game-system APIs, foundations.
    const process = createProcessModule(ctx);
    const progress = createProgressModule(ctx);
    const table = createTableModule(ctx);
    const status = createStatusModule(ctx);
    const notify = createNotifyModule(ctx);
    const form = createFormModule(ctx);
    const menu = createMenuModule(ctx);
    const ui = createUiModule(ctx, { progress, table, status, notify, form, menu });
    const inventory = createInventoryModule(ctx);
    const economy = createEconomyModule(ctx);
    const security = createSecurityModule(ctx);
    const leaderboards = createLeaderboardsModule(ctx);
    const hackbank = createHackbankModule(ctx);
    const watchlist = createWatchlistModule(ctx);
    const search = createSearchModule(ctx);
    const report = createReportModule(ctx);
    const events = createEventsModule(ctx);
    const schedule = createScheduleModule(ctx);

    // The unified `bucky` namespace (so `bucky.economy.balance()` resolves with
    // or without an explicit import).
    const bucky = mod("bucky", {
        files, json, leaks, profile, organizations, terminal, mail, database, missions,
        process, progress, table, status, notify, form, menu, ui,
        inventory, economy, security, leaderboards, hackbank, watchlist, search, report,
        events, schedule
    });

    const modules = {
        "bucky.files": files,
        "bucky.json": json,
        json,
        "bucky.leaks": leaks,
        "bucky.profile": profile,
        "bucky.organizations": organizations,
        "bucky.terminal": terminal,
        "bucky.mail": mail,
        "bucky.database": database,
        "bucky.missions": missions,
        "bucky.process": process,
        "bucky.progress": progress,
        "bucky.table": table,
        "bucky.status": status,
        "bucky.notify": notify,
        "bucky.form": form,
        "bucky.menu": menu,
        "bucky.ui": ui,
        "bucky.inventory": inventory,
        "bucky.economy": economy,
        "bucky.security": security,
        "bucky.leaderboards": leaderboards,
        "bucky.hackbank": hackbank,
        "bucky.watchlist": watchlist,
        "bucky.search": search,
        "bucky.report": report,
        "bucky.reports": report,
        "bucky.events": events,
        "bucky.schedule": schedule,
        bucky
    };

    // Merge registered extension modules whose capability is granted.
    registeredModules().forEach((entry, name) => {
        const cap = entry.capability || moduleCapability(name);
        if (cap && !ctx.caps.has(cap)) return;
        try {
            const m = entry.factory(ctx);
            if (m) {
                modules[name] = m;
                const short = name.startsWith("bucky.") ? name.slice("bucky.".length) : null;
                if (short && !bucky[short]) bucky[short] = m;
            }
        } catch (_e) {
            // A faulty extension factory must never break script execution.
        }
    });

    // dir() — reflection. dir() lists the available modules; dir(module) or
    // dir("economy") lists a module's members. Aids discoverability from a
    // script or the Terminal without external docs.
    // Short module key for HELP lookups ("bucky.economy" -> "economy").
    const shortName = (m) => (m && m.__name__ ? String(m.__name__).replace(/^bucky\./, "") : null);
    const resolveModule = (target) => {
        if (typeof target === "string") {
            const base = target.split(".")[0];
            return bucky[base] && bucky[base].__module__ ? bucky[base] : null;
        }
        if (target && typeof target === "object" && target.__module__ === true) return target;
        return null;
    };
    const memberNames = (m) => Object.keys(m).filter((k) => k !== "__module__" && k !== "__name__").sort();
    // Find the HELP signature/doc for a bare method name (matches "name(" key).
    const helpFor = (key, method) => {
        const h = HELP[key];
        if (!h || !h.methods) return null;
        const sigKey = Object.keys(h.methods).find((s) => s.replace(/[\s(].*$/, "") === method
            || s.split("/").some((alt) => alt.replace(/[\s(].*$/, "").trim() === method));
        return sigKey ? { signature: sigKey, description: h.methods[sigKey] } : null;
    };

    // dir(target[, detailed]) — RETURNS a list. Bare → module names; a module/
    // name → its members; detailed=True → [{name, signature, description}].
    function dirImpl(args, kwargs) {
        const target = args && args.length ? args[0] : null;
        const detailed = (args && args[1] === true) || (kwargs && (kwargs.detailed === true || kwargs.detail === true));
        const mod = resolveModule(target);
        if (mod) {
            const key = shortName(mod);
            const members = memberNames(mod);
            if (!detailed) return members;
            return members.map((m) => {
                const hit = helpFor(key, m);
                return { name: m, signature: hit ? hit.signature : (m + "(...)"), description: hit ? hit.description : "" };
            });
        }
        const names = Object.keys(bucky).filter((k) => k !== "__module__" && k !== "__name__");
        names.push("orgs", "reports");
        return Array.from(new Set(names)).sort();
    }

    // help([target[, member]]) — PRINTS a help screen and returns the text.
    //   help()                 -> module index
    //   help(profile)          -> module description + functions
    //   help("profile")        -> same, by name
    //   help("profile.level")  -> one method's signature + doc + example
    //   help(profile, "level") -> same
    function helpImpl(args, kwargs, interp) {
        const lines = [];
        const emit = (s) => { lines.push(s); if (interp && interp.print) interp.print(s); };
        let target = args && args.length ? args[0] : null;
        let member = args && args.length > 1 ? args[1] : null;
        // help(callable) — map a bound function / interactive widget back to its
        // "module.method" name via its pyName (stamped in mod()), so help(menu.show),
        // help(profile.level) and help(leaderboards.richest) all resolve. Phase 4.5B.
        if (target && (typeof target === "function" || target.__interactive__ === true) && typeof target.pyName === "string") {
            target = target.pyName.replace(/^bucky\./, "");
        }
        if (typeof target === "string" && target.indexOf(".") >= 0 && member == null) {
            member = target.split(".").slice(1).join(".");
        }
        const mod = resolveModule(target);
        if (!mod) {
            emit("Bucky VM — available modules (use help(name) for detail):");
            const names = Object.keys(bucky).filter((k) => k !== "__module__" && k !== "__name__").sort();
            names.forEach((n) => { const h = HELP[n]; emit("  " + n.padEnd(15) + (h ? h.description : "")); });
            emit("Try: help('profile'), help('profile.level'), dir(profile, detailed=True)");
            return lines.join("\n");
        }
        const key = shortName(mod);
        const h = HELP[key] || { description: "", methods: {} };
        if (member != null) {
            const hit = helpFor(key, String(member));
            if (hit) { emit(key + "." + hit.signature); emit("  " + hit.description); }
            else emit("No help for '" + key + "." + member + "'. Try help('" + key + "').");
            return lines.join("\n");
        }
        emit("MODULE  " + key);
        if (h.description) emit("  " + h.description);
        emit("FUNCTIONS");
        if (h.methods && Object.keys(h.methods).length) {
            Object.keys(h.methods).forEach((sig) => emit("  " + key + "." + sig + "  —  " + h.methods[sig]));
        } else {
            memberNames(mod).forEach((m) => emit("  " + key + "." + m + "()"));
        }
        if (h.example) emit("EXAMPLE  " + h.example);
        return lines.join("\n");
    }

    // Prelude: short names available without an import. `orgs` aliases
    // organizations; `reports` aliases `report`; `notify` is the callable send
    // helper (so `notify("...")` works) while `bucky.notify` keeps
    // send/info/warn/alert. `dir` is the reflection builtin.
    const builtins = {
        files, json, leaks, profile, organizations, orgs: organizations, terminal, bucky,
        process, progress, table, status, form, menu, ui, notify: notify.send,
        inventory, economy, security, leaderboards, hackbank, watchlist, search,
        report, reports: report, events, schedule,
        // mail (foundation) + database/missions (interface stubs) are bound as
        // prelude names too, so `mail.identity()` resolves without an import
        // (previously "mail is not defined"); stub methods still raise NotImplemented.
        mail, database, missions,
        // Raw native bindings (they read kwargs / print via interp directly).
        dir: dirImpl, help: helpImpl
    };

    return { modules, builtins };
}
