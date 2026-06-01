/**
 * BuckyRuntime — the runtime abstraction layer (Phase 4.4, Part 1).
 *
 * The formal seam between a script and the VM's services. Execution flows:
 *
 *     script  ->  runtime  ->  VM services (filesystem, gateway snapshot, ...)
 *
 * The runtime owns: the granted capability set, the assembled bucky.* standard
 * library (built per run against a context), the script argument parser and the
 * help (describe) builtin, and the call into the sandboxed interpreter. Future
 * subsystems plug in through the extension registry — never into the
 * interpreter or an app — keeping the system modular and additive.
 *
 * DOM-free and network-free: the runtime consumes an already-captured snapshot
 * and a FileSystemService. Fetching the snapshot is the execution layer's job.
 * Both a non-interactive run() and an interactive session() are exposed.
 *
 * Phase 4.5 threads three more things through the per-run context: the shared
 * process table (so process.*/progress.* see the live process), an optional
 * desktop notification sink, and per-runtime automation/schedule registries.
 */
import { runPython, createScriptSession, SCRIPT_EXIT } from "../pseudoPython.js";
import { buildStandardLibrary } from "./stdlib/index.js";
import { createCapabilitySet, DEFAULT_CAPABILITIES } from "./capabilities.js";
import { buildArgs, makeDescribe } from "./args.js";
import { createAutomationRegistry, createScheduleRegistry } from "./extensions.js";

export function createRuntime(opts = {}) {
    const caps = createCapabilitySet(opts.granted || DEFAULT_CAPABILITIES);
    const baseCtx = {
        filesystem: opts.filesystem,
        user: opts.user || {},
        snapshot: opts.snapshot || { online: false },
        caps,
        owner: opts.owner || "script",
        cwd: opts.cwd || (opts.filesystem && opts.filesystem.homePath) || "/",
        refresh: typeof opts.refresh === "function" ? opts.refresh : null,
        // Phase 4.5 — the process table (shared session manager), an optional
        // desktop notification sink, and per-runtime automation/schedule
        // registries the events/schedule modules bind to (architecture-only).
        processes: opts.processes || null,
        notify: typeof opts.notify === "function" ? opts.notify : null,
        automation: opts.automation || createAutomationRegistry(),
        schedule: opts.schedule || createScheduleRegistry(),
        pid: opts.pid != null ? opts.pid : null
    };

    /** Assemble the stdlib + the per-run arg parser / help builtins. */
    function prepare(runOpts) {
        // A run may carry its own PID (the Terminal assigns one per launch) so
        // process.current() / progress.* resolve to the right process record.
        const ctx = { ...baseCtx, cwd: runOpts.cwd || baseCtx.cwd, pid: runOpts.pid != null ? runOpts.pid : baseCtx.pid };
        const { modules, builtins } = buildStandardLibrary(ctx);
        const argsObj = buildArgs(runOpts.argv || []);
        const richBuiltins = {
            ...builtins,
            args: argsObj,
            describe: makeDescribe(argsObj, SCRIPT_EXIT)
        };
        return { modules, builtins: richBuiltins };
    }

    /** Run a script to completion (non-interactive). */
    function run(source, runOpts = {}) {
        const { modules, builtins } = prepare(runOpts);
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
        const { modules, builtins } = prepare(runOpts);
        return createScriptSession(source, {
            argv: runOpts.argv || [],
            stdout: runOpts.stdout || null,
            limits: runOpts.limits || {},
            modules,
            builtins
        });
    }

    return {
        capabilities: caps,
        snapshot: baseCtx.snapshot,
        processes: baseCtx.processes,
        automation: baseCtx.automation,
        schedule: baseCtx.schedule,
        run,
        session
    };
}
