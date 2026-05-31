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
 */
import { runPython, createScriptSession, SCRIPT_EXIT } from "../pseudoPython.js";
import { buildStandardLibrary } from "./stdlib/index.js";
import { createCapabilitySet, DEFAULT_CAPABILITIES } from "./capabilities.js";
import { buildArgs, makeDescribe } from "./args.js";

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

    /** Assemble the stdlib + the per-run arg parser / help builtins. */
    function prepare(runOpts) {
        const ctx = { ...baseCtx, cwd: runOpts.cwd || baseCtx.cwd };
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

    return { capabilities: caps, snapshot: baseCtx.snapshot, run, session };
}
