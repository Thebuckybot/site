/**
 * Runtime capability model — Phase 4.4, Part 22.
 *
 * Every bucky.* standard-library module declares a capability. A script's
 * imports are mapped to the set of capabilities it needs; the runtime decides
 * (a) which backend snapshots to pre-fetch and (b) which modules a script is
 * allowed to touch. Today operator scripts are granted the full present-day
 * surface (filesystem / profile / leaks / organizations / terminal); the
 * future surface (mail / database / missions) is *declared* here so the model
 * is forward-looking, and gated the same way when those subsystems land
 * (Phase 5.2+). This is the seam — not a sandbox boundary on its own; the
 * interpreter's no-host-execution guarantee is what isolates scripts.
 *
 * Pure runtime data — DOM-free, network-free, import-safe in any context
 * (browser or a headless test harness).
 */

/** The capability vocabulary. Present + declared-future. */
export const CAPABILITIES = {
    FILESYSTEM: "filesystem",
    PROFILE: "profile",
    LEAKS: "leaks",
    ORGANIZATIONS: "organizations",
    TERMINAL: "terminal",
    // Phase 4.5 — runtime + read-only game-system surface. Each module declares
    // exactly one capability; the UI toolkit (progress/table/form/menu/notify/
    // status) shares the `ui` capability. Data modules read the gateway snapshot
    // read-only; write paths (economy.transfer, hackbank, ...) route through the
    // Discord bridge and raise NotImplemented (the bot stays the sole authority).
    PROCESS: "process",
    UI: "ui",
    INVENTORY: "inventory",
    ECONOMY: "economy",
    SECURITY: "security",
    LEADERBOARDS: "leaderboards",
    HACKBANK: "hackbank",
    WATCHLIST: "watchlist",
    SEARCH: "search",
    REPORT: "report",
    EVENTS: "events",
    AUTOMATION: "automation",
    // Declared, gated for later phases (interface-only modules today).
    MAIL: "mail",
    DATABASE: "database",
    MISSIONS: "missions"
};

export const ALL_CAPABILITIES = Object.values(CAPABILITIES);

/** Capabilities granted to an operator script by default (Phase 4.4 + 4.5). */
export const DEFAULT_CAPABILITIES = [
    CAPABILITIES.FILESYSTEM,
    CAPABILITIES.PROFILE,
    CAPABILITIES.LEAKS,
    CAPABILITIES.ORGANIZATIONS,
    CAPABILITIES.TERMINAL,
    // Phase 4.5 surface — all granted to operator scripts today, exactly as the
    // present-day modules are. The capability is the seam (a future phase can
    // hand a narrower grant to an untrusted/marketplace script); granting the
    // full set here keeps every existing script working unchanged.
    CAPABILITIES.PROCESS,
    CAPABILITIES.UI,
    CAPABILITIES.INVENTORY,
    CAPABILITIES.ECONOMY,
    CAPABILITIES.SECURITY,
    CAPABILITIES.LEADERBOARDS,
    CAPABILITIES.HACKBANK,
    CAPABILITIES.WATCHLIST,
    CAPABILITIES.SEARCH,
    CAPABILITIES.REPORT,
    CAPABILITIES.EVENTS,
    CAPABILITIES.AUTOMATION,
    // Future modules are importable as interface stubs — granting the
    // capability lets the prepared `from bucky.mail import *` line resolve;
    // the stub members still raise NotImplemented when called.
    CAPABILITIES.MAIL,
    CAPABILITIES.DATABASE,
    CAPABILITIES.MISSIONS
];

/** Which capability a fully-qualified module name belongs to. */
export const MODULE_CAPABILITY = {
    "bucky.files": CAPABILITIES.FILESYSTEM,
    "bucky.json": CAPABILITIES.FILESYSTEM,
    json: CAPABILITIES.FILESYSTEM,
    "bucky.leaks": CAPABILITIES.LEAKS,
    "bucky.profile": CAPABILITIES.PROFILE,
    "bucky.organizations": CAPABILITIES.ORGANIZATIONS,
    "bucky.terminal": CAPABILITIES.TERMINAL,
    // Phase 4.5 modules.
    "bucky.process": CAPABILITIES.PROCESS,
    "bucky.progress": CAPABILITIES.UI,
    "bucky.ui": CAPABILITIES.UI,
    "bucky.table": CAPABILITIES.UI,
    "bucky.form": CAPABILITIES.UI,
    "bucky.menu": CAPABILITIES.UI,
    "bucky.notify": CAPABILITIES.UI,
    "bucky.status": CAPABILITIES.UI,
    "bucky.inventory": CAPABILITIES.INVENTORY,
    "bucky.economy": CAPABILITIES.ECONOMY,
    "bucky.security": CAPABILITIES.SECURITY,
    "bucky.leaderboards": CAPABILITIES.LEADERBOARDS,
    "bucky.hackbank": CAPABILITIES.HACKBANK,
    "bucky.watchlist": CAPABILITIES.WATCHLIST,
    "bucky.search": CAPABILITIES.SEARCH,
    "bucky.report": CAPABILITIES.REPORT,
    "bucky.events": CAPABILITIES.EVENTS,
    "bucky.schedule": CAPABILITIES.AUTOMATION,
    // Future / interface-only.
    "bucky.mail": CAPABILITIES.MAIL,
    "bucky.database": CAPABILITIES.DATABASE,
    "bucky.missions": CAPABILITIES.MISSIONS
};

/** Capability for a module name, or null when the module needs none. */
export function moduleCapability(moduleName) {
    return MODULE_CAPABILITY[moduleName] || null;
}

/**
 * Derive the set of capabilities a list of imported module names requires.
 * @param {string[]} moduleNames
 * @returns {Set<string>}
 */
export function requiredCapabilities(moduleNames) {
    const set = new Set();
    (moduleNames || []).forEach((name) => {
        const cap = moduleCapability(name);
        if (cap) set.add(cap);
    });
    return set;
}

/**
 * Build a capability set object the stdlib calls to assert access.
 * `require(cap)` throws a capability error (caught + formatted by the runtime)
 * when the capability was not granted. With the default grant it is a no-op.
 *
 * @param {string[]} [granted=DEFAULT_CAPABILITIES]
 */
export function createCapabilitySet(granted) {
    const set = new Set(granted || DEFAULT_CAPABILITIES);
    return {
        has(cap) {
            return set.has(cap);
        },
        require(cap, context) {
            if (!set.has(cap)) {
                const where = context ? ` (${context})` : "";
                const err = new Error(`capability '${cap}' is not granted to this script${where}`);
                err.buckyType = "CapabilityError";
                throw err;
            }
            return true;
        },
        list() {
            return [...set];
        }
    };
}

/**
 * Scan source for imported module names — used to decide snapshot prefetch and
 * capability requirements before execution. Deliberately a light textual scan
 * (the interpreter does the authoritative parse); it only needs the module
 * names, never the full AST. Recognises:
 *   import a.b[.c] [as x][, ...]
 *   from a.b import ...
 */
export function scanImportedModules(source) {
    const names = new Set();
    const text = String(source || "");
    const lines = text.split("\n");
    for (const raw of lines) {
        const line = raw.replace(/#.*$/, "").trim();
        let m = line.match(/^from\s+([A-Za-z_][\w.]*)\s+import\b/);
        if (m) {
            names.add(m[1]);
            continue;
        }
        m = line.match(/^import\s+(.+)$/);
        if (m) {
            m[1].split(",").forEach((part) => {
                const mod = part.trim().split(/\s+as\s+/)[0].trim();
                if (/^[A-Za-z_][\w.]*$/.test(mod)) names.add(mod);
            });
        }
    }
    return [...names];
}
