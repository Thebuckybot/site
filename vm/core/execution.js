/**
 * Execution layer — the Bucky VM's simulated runtime dispatcher.
 *
 * Given a file in the VM virtual filesystem, it selects a runtime and runs it
 * entirely inside the sandbox. NOTHING here reaches the host: no eval, no
 * Function, no real interpreters, no IO, no network. Output is plain data
 * returned to the caller (BuckyCode's Run panel, the terminal's `python`
 * command).
 *
 * This module is the single chokepoint future systems run through — mission
 * scripts, fake attack tools, scanners, automation. Adding a new runtime is
 * one registry entry plus one extension match; call sites never change.
 */
import { runPython } from "./pseudoPython.js";

/** Registered simulated runtimes: id -> { label, run(source) }. */
const RUNTIMES = {
    python: { label: "Python (simulated)", run: runPython }
};

/** Filename extension -> runtime id. The sole place file type maps to runtime. */
const RUNTIME_BY_EXTENSION = {
    py: "python"
};

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

/**
 * Execute a VM file through its runtime.
 * Never throws — every outcome is a normalized, displayable result:
 *   { ok, output: string[], error: string|null, runtime: string|null }
 *
 * @param {object} filesystem  the VM FileSystemService
 * @param {string} path        absolute or relative VM path
 */
export function executeFile(filesystem, path) {
    const read = filesystem.read(path);
    if (!read.ok) {
        return { ok: false, output: [], error: read.error, runtime: null };
    }
    const name = filesystem.normalize(path).split("/").pop();
    const runtimeId = runtimeForName(name);
    if (!runtimeId) {
        return {
            ok: false,
            output: [],
            error: `cannot execute '${name}': no runtime is registered for this file type`,
            runtime: null
        };
    }
    try {
        const result = RUNTIMES[runtimeId].run(read.content);
        return {
            ok: Boolean(result && result.ok),
            output: (result && result.output) || [],
            error: (result && result.error) || null,
            runtime: runtimeId
        };
    } catch (error) {
        // A runtime must not throw, but contain it defensively all the same.
        return {
            ok: false,
            output: [],
            error: `runtime fault: ${error && error.message ? error.message : "unknown"}`,
            runtime: runtimeId
        };
    }
}
