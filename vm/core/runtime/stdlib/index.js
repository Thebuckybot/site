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
import { mod } from "./kit.js";
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

    // Prelude: short names available without an import. `orgs` aliases
    // organizations; `notify` is the callable send helper (so `notify("...")`
    // works) while `bucky.notify` keeps send/info/warn/alert.
    const builtins = {
        files, json, leaks, profile, organizations, orgs: organizations, terminal, bucky,
        process, progress, table, status, form, menu, ui, notify: notify.send,
        inventory, economy, security, leaderboards, hackbank, watchlist, search, report,
        events, schedule
    };

    return { modules, builtins };
}
