/**
 * Standard-library assembler — Phase 4.4, Parts 2 & 3.
 *
 * Builds, for one script run, the bucky.* module table the interpreter imports
 * from and the convenience "prelude" bound as builtins (so example scripts can
 * call `leaks.latest()` / `files.read()` / `orgs.list()` without an import,
 * while explicit imports — `from bucky.leaks import *`, `import bucky.files` —
 * also work).
 *
 * Modules are constructed against a single context object:
 *   { filesystem, cwd, caps, owner, snapshot, user, refresh }
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
import { registeredModules } from "../extensions.js";
import { moduleCapability } from "../capabilities.js";

export function buildStandardLibrary(ctx) {
    const files = createFilesModule(ctx);
    const json = createJsonModule(ctx);
    const leaks = createLeaksModule(ctx);
    const profile = createProfileModule(ctx);
    const organizations = createOrganizationsModule(ctx);
    const terminal = createTerminalModule(ctx);
    const mail = createMailModule(ctx);
    const database = createDatabaseModule(ctx);
    const missions = createMissionsModule(ctx);

    // The unified `bucky` namespace (so `bucky.leaks.latest()` resolves with or
    // without an explicit import).
    const bucky = mod("bucky", {
        files, json, leaks, profile, organizations, terminal, mail, database, missions
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

    // Prelude: short names available without import. `orgs` aliases organizations.
    const builtins = { files, json, leaks, profile, organizations, orgs: organizations, terminal, bucky };

    return { modules, builtins };
}
