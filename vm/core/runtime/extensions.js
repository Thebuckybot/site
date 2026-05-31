/**
 * Extension system + future seams — Phase 4.4, Parts 23, 25 & 26.
 *
 * The runtime is designed so later subsystems (Mail Relay, Database Viewer,
 * Intelligence, Mission Board, Automation, Scheduler) plug into it without
 * touching the interpreter, the standard-library core, or any existing app.
 * This module is that plug board. It ships THREE seams, all architecture-only:
 *
 *   1. MODULE REGISTRY (Part 23) — register a bucky.* module factory under a
 *      name + capability; the stdlib assembler merges registered modules into
 *      the import table. A new module is one `registerRuntimeModule(...)` call.
 *
 *   2. AUTOMATION HOOKS (Part 26) — the event vocabulary (on_leak, on_mail,
 *      on_incident, on_levelup) and a registry for handlers. The dispatcher is
 *      deliberately NOT wired to anything yet; this declares the shape future
 *      automation scripts and the scheduler will bind to.
 *
 *   3. DISCORD BRIDGE (Part 25) — the interface a later phase implements so VM
 *      tools can trigger hackbank / missions / economy / security actions
 *      through the bot. Every method is a stub that raises NotImplemented;
 *      there is no transport here, by design.
 *
 * Pure data — DOM-free, network-free.
 */

// ---------------------------------------------------------------------------
// 1. Module registry (Part 23)
// ---------------------------------------------------------------------------

/** name -> { factory(ctx) -> moduleObject, capability } */
const moduleRegistry = new Map();

/**
 * Register a runtime module factory. Idempotent by name (last write wins).
 * @param {string} name        fully-qualified module name, e.g. "bucky.intel"
 * @param {Function} factory   (ctx) => module object ({ __module__, ...members })
 * @param {object} [meta]      { capability }
 */
export function registerRuntimeModule(name, factory, meta = {}) {
    if (!name || typeof factory !== "function") return;
    moduleRegistry.set(name, { factory, capability: meta.capability || null });
}

/** Snapshot of the registered modules (name -> entry). */
export function registeredModules() {
    return new Map(moduleRegistry);
}

// ---------------------------------------------------------------------------
// 2. Automation hooks (Part 26 — seam only, NOT dispatched yet)
// ---------------------------------------------------------------------------

/** The automation event vocabulary future scripts/scheduler bind to. */
export const AUTOMATION_EVENTS = ["on_leak", "on_mail", "on_incident", "on_levelup"];

export function createAutomationRegistry() {
    const handlers = new Map(AUTOMATION_EVENTS.map((e) => [e, []]));
    return {
        events: () => AUTOMATION_EVENTS.slice(),
        on(event, handler) {
            if (!handlers.has(event)) {
                const err = new Error(`unknown automation event '${event}'`);
                err.buckyType = "ValueError";
                throw err;
            }
            handlers.get(event).push(handler);
            return () => {
                const list = handlers.get(event);
                const i = list.indexOf(handler);
                if (i >= 0) list.splice(i, 1);
            };
        },
        /**
         * Dispatch is intentionally inert in Phase 4.4. The trigger source
         * (leak engine, mail, level-up) is not bridged into the VM yet; this
         * records the call shape so wiring it later is additive.
         */
        dispatch() {
            return { dispatched: false, reason: "automation dispatch arrives in a later phase" };
        },
        registered: () => Object.fromEntries([...handlers].map(([e, l]) => [e, l.length]))
    };
}

// ---------------------------------------------------------------------------
// 3. Discord bridge interface (Part 25 — interface only)
// ---------------------------------------------------------------------------

function notBridged(action) {
    const err = new Error(
        `Discord bridge action '${action}' is not implemented yet — the VM is a read-only ` +
        "consumer in Phase 4.4. Write paths (hackbank, missions, economy, security) flow " +
        "through the Discord bot and arrive in a later phase."
    );
    err.buckyType = "NotImplementedError";
    throw err;
}

/**
 * The shape a future phase implements. Kept as an explicit object so the
 * contract is discoverable and type-stable; nothing here performs IO.
 */
export const discordBridge = {
    hackbank: (...args) => notBridged("hackbank"),
    missions: (...args) => notBridged("missions"),
    economy: (...args) => notBridged("economy"),
    security: (...args) => notBridged("security")
};
