/**
 * Execution layer — the Bucky VM's simulated runtime dispatcher (Phase 4.4).
 *
 * Given a file in the VM virtual filesystem, it selects a runtime and runs it
 * entirely inside the sandbox. NOTHING here reaches the host: no eval, no
 * Function, no real interpreters, no IO. The only outbound traffic is the
 * read-only backend SNAPSHOT captured before a run (gateway-snapshot-at-start),
 * cached for the whole session by the snapshot store.
 *
 * Flow (Phase 4.4):
 *   read file -> detect needed data capabilities from imports/prelude usage ->
 *   ensure snapshot sections (cached, fetched once) -> build the BuckyRuntime
 *   with the bucky.* standard library bound -> run (or start an interactive
 *   session) -> record an execution-log entry -> return a normalized result.
 *
 * Two entry points share that pipeline:
 *   executeFile()  — run to completion (BuckyCode "Run", `python file`).
 *   startSession() — interactive/pausable run for the Terminal (input()).
 *
 * Adding a new runtime is one registry entry plus one extension match; call
 * sites never change. The bucky.* library + capability model layer on top
 * (core/runtime/*).
 */
import { runPython } from "./pseudoPython.js";
import { gatewayClient } from "./gatewayClient.js";
import { createRuntime } from "./runtime/index.js";
import { createSnapshotStore } from "./runtime/snapshotStore.js";
import { scanImportedModules, requiredCapabilities } from "./runtime/capabilities.js";
import { executionJournal } from "./runtime/logs.js";
import { runBanner, completeBanner, errorBlock } from "./runtime/format.js";

/** Registered simulated runtimes: id -> { label }. The interpreter is shared. */
const RUNTIMES = {
    python: { label: "Python (simulated)" }
};

/** Filename extension -> runtime id. The sole place file type maps to runtime. */
const RUNTIME_BY_EXTENSION = { py: "python" };

/** Resolve a filename to a runtime id, or null when it is not runnable. */
export function runtimeForName(name) {
    const extension = String(name || "").split(".").pop().toLowerCase();
    return RUNTIME_BY_EXTENSION[extension] || null;
}

/** True when a filename is script-capable (a known runtime can run it). */
export function isRunnable(name) {
    return runtimeForName(name) !== null;
}

/** Human-readable label for a runtime id. */
export function runtimeLabel(runtimeId) {
    return (RUNTIMES[runtimeId] && RUNTIMES[runtimeId].label) || "runtime";
}

// ---------------------------------------------------------------------------
// Session snapshot store (one VM per page).
// ---------------------------------------------------------------------------
let _store = null;
function store() {
    if (!_store) _store = createSnapshotStore(gatewayClient);
    return _store;
}

/** Pre-load all snapshot sections (used at VM boot; never blocks). */
export function primeSnapshots() {
    return store().prime();
}

// At module load, prime snapshots in the background for an authenticated
// operator so the first data-script runs instantly ("loaded once at boot").
try {
    if (gatewayClient && typeof gatewayClient.hasAuthToken === "function" && gatewayClient.hasAuthToken()) {
        Promise.resolve().then(() => store().prime()).catch(() => {});
    }
} catch (_e) { /* never block module load */ }

/**
 * Which data sections a script needs — from explicit imports AND bare prelude
 * usage (leaks. / profile. / organizations. / orgs.), so the right snapshot
 * sections are captured before the run.
 */
function snapshotNeeds(source) {
    const needs = new Set();
    const caps = requiredCapabilities(scanImportedModules(source));
    ["leaks", "profile", "organizations"].forEach((c) => { if (caps.has(c)) needs.add(c); });
    if (/(^|[^.\w])leaks\s*\./.test(source)) needs.add("leaks");
    if (/(^|[^.\w])profile\s*\./.test(source)) needs.add("profile");
    if (/(^|[^.\w])(orgs|organizations)\s*\./.test(source)) needs.add("organizations");
    return needs;
}

/** Read + validate a script file; returns { ok, source?, name?, cwd?, error? }. */
function loadScript(filesystem, path) {
    const read = filesystem.read(path);
    if (!read.ok) return { ok: false, error: read.error };
    const normalized = filesystem.normalize(path);
    const name = normalized.split("/").pop();
    if (!runtimeForName(name)) {
        return { ok: false, error: `cannot execute '${name}': no runtime is registered for this file type` };
    }
    const cwd = filesystem.parentOf(normalized).parentPath || filesystem.homePath;
    return { ok: true, source: read.content, name, cwd };
}

async function buildRuntimeFor(filesystem, source, cwd, opts) {
    const snapshot = await store().ensure(snapshotNeeds(source));
    return createRuntime({
        filesystem,
        user: opts.user || {},
        snapshot,
        cwd,
        owner: opts.owner || "buckycode",
        refresh: (section) => store().refresh(section)
    });
}

function logRun(path, name, argv, startedAt, result) {
    executionJournal.record({
        path, name, ok: result.ok,
        durationMs: Date.now() - startedAt,
        output: result.output, error: result.error,
        errorInfo: result.errorInfo, runtime: "python", argv
    });
}

/**
 * Execute a VM file to completion (non-interactive). Never throws.
 * @returns {Promise<{ ok, output:string[], error, errorInfo, runtime, durationMs, name }>}
 */
export async function executeFile(filesystem, path, opts = {}) {
    const loaded = loadScript(filesystem, path);
    if (!loaded.ok) {
        return { ok: false, output: [], error: loaded.error, errorInfo: null, runtime: null, durationMs: 0, name: null };
    }
    const argv = opts.argv || [];
    const startedAt = Date.now();
    try {
        const runtime = await buildRuntimeFor(filesystem, loaded.source, loaded.cwd, opts);
        const result = runtime.run(loaded.source, { argv, stdout: opts.stdout || null, cwd: loaded.cwd });
        const durationMs = Date.now() - startedAt;
        logRun(path, loaded.name, argv, startedAt, result);
        return { ...result, runtime: "python", durationMs, name: loaded.name };
    } catch (error) {
        const result = { ok: false, output: [], error: `runtime fault: ${error && error.message ? error.message : "unknown"}`, errorInfo: null };
        logRun(path, loaded.name, argv, startedAt, result);
        return { ...result, runtime: "python", durationMs: Date.now() - startedAt, name: loaded.name };
    }
}

/**
 * Start an interactive (pausable) session for the Terminal. Returns a small
 * driver:
 *   { ok, name, runtime, step(input) }
 * where step() begins the run and step(line) resumes a suspended input(). Each
 * step returns { status:"input", prompt, line } or { status:"done", result }.
 * The execution-log entry is recorded automatically on completion.
 */
export async function startSession(filesystem, path, opts = {}) {
    const loaded = loadScript(filesystem, path);
    if (!loaded.ok) return { ok: false, error: loaded.error };

    const argv = opts.argv || [];
    const startedAt = Date.now();
    let runtime;
    try {
        runtime = await buildRuntimeFor(filesystem, loaded.source, loaded.cwd, opts);
    } catch (error) {
        return { ok: false, error: `runtime fault: ${error && error.message ? error.message : "unknown"}` };
    }
    const session = runtime.session(loaded.source, { argv, stdout: opts.stdout || null, cwd: loaded.cwd });
    let logged = false;
    const record = (result) => {
        if (logged) return;
        logged = true;
        logRun(path, loaded.name, argv, startedAt, result);
    };

    function step(input) {
        const s = input === undefined ? session.start() : session.provide(input);
        if (s.status === "done") record(s.result);
        return s;
    }

    return { ok: true, name: loaded.name, runtime: "python", step };
}

/** Presentation helpers re-exported so apps share one banner/error style. */
export { runBanner, completeBanner, errorBlock };

/**
 * Backwards-compatible synchronous runner for trivial, data-free scripts
 * (no imports, no snapshot, no interactive input). Retained for any caller
 * that cannot await; prefer executeFile().
 */
export function runScriptSourceSync(source, opts = {}) {
    return runPython(source, opts);
}
