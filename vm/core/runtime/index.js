/**
 * BuckyRuntime — the runtime abstraction layer (Phase 4.4, Part 1).
 *
 * The formal seam between a script and the VM's services. Instead of the
 * interpreter reaching into the VM directly, execution flows:
 *
 *     script  ->  runtime  ->  VM services (filesystem, gateway snapshot, ...)
 *
 * The runtime owns: the granted capability set, the assembled bucky.* standard
 * library (built per run against a context), and the call into the sandboxed
 * interpreter. Future subsystems (mail, database, missions, automation,
 * scheduler) plug into the runtime through the extension registry — never into
 * the interpreter or an app — keeping the whole system modular and additive.
 *
 * DOM-free and network-free: the runtime consumes an already-captured snapshot
 * and a FileSystemService. Fetching the snapshot is the execution layer's job
 * (core/execution.js), which keeps this layer synchronous and unit-testable.
 * Both a non-interactive run() and an interactive session() are exposed.
 */
import { runPython, createScriptSession } from "../pseudoPython.js";
import { buildStandardLibrary } from "./stdlib/index.js";
import { createCapabilitySet, DEFAULT_CAPABILITIES } from "./capabilities.js";

/**
 * @param {object} opts
 * @param {object} opts.filesystem   the VM FileSystemService
 * @param {object} [opts.user]       the operator (for identity-aware context)
 * @param {object} [opts.snapshot]   backend snapshot (see runtime/snapshot.js)
 * @param {string[]} [opts.granted]  granted capabilities (defaults to operator set)
 * @param {string} [opts.cwd]        working directory for relative paths
 * @param {string} [opts.owner]      fs owner label stamped on writes
 * @param {Function} [opts.refresh]  (section) => status — request a fresh snapshot
 */
export function createRuntime(opts = {}) {
    const caps = createCapabilitySet(opts.granted || DEFAULT_CAPABILITIES);
    const baseCtx = {
        filesystem: opts.filesystem,
        user: opts.user || {},
        snapshot: opts.snapshot || { online: false },
        caps,
        owner: opts.owner || "script",
        cwd: opts.cwd || (opts.filesystem && opts.filesystem.homePath) || "/",
        refresh: typeof opts.refresh === "function" ? opts.refresh : null
    };

    function libFor(runOpts) {
        const ctx = { ...baseCtx, cwd: runOpts.cwd || baseCtx.cwd };
        return buildStandardLibrary(ctx);
    }

    /** Run a script to completion (non-interactive). */
    function run(source, runOpts = {}) {
        const { modules, builtins } = libFor(runOpts);
        return runPython(source, {
            argv: runOpts.argv || [],
            stdout: runOpts.stdout || null,
            limits: runOpts.limits || {},
            inputs: runOpts.inputs || null,
            onInput: runOpts.onInput || null,
            modules,
            builtins
        });
    }

    /** Begin an interactive (pausable) session — the Terminal drives it. */
    function session(source, runOpts = {}) {
        const { modules, builtins } = libFor(runOpts);
        return createScriptSession(source, {
            argv: runOpts.argv || [],
            stdout: runOpts.stdout || null,
            limits: runOpts.limits || {},
            modules,
            builtins
        });
    }

    return { capabilities: caps, snapshot: baseCtx.snapshot, run, session };
}
