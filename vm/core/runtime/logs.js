/**
 * Execution logs + script history — Phase 4.4, Parts 20 & 21.
 *
 * A small, capped, in-memory journal of script runs for the current VM
 * session. Lets an operator see what they ran, when, how long it took, and the
 * last output / error per script — so they can return to a project without
 * re-deriving its state. Session-scoped and ephemeral (mirrors the virtual
 * filesystem's "feels persistent within a session, resets on reload" model);
 * a future pass can persist this to /projects/data/.history.json behind the
 * same API.
 *
 * Pure data — DOM-free, network-free. A module-level default store backs the
 * single live VM; `createExecutionJournal()` returns an isolated instance for
 * tests or future multi-runtime use.
 */

const HISTORY_LIMIT = 50;

export function createExecutionJournal(limit = HISTORY_LIMIT) {
    /** @type {Array} most-recent-first list of run records. */
    let history = [];
    /** @type {Object<string, object>} path -> last run record. */
    const lastByPath = Object.create(null);

    /**
     * Record one completed run.
     * @param {object} entry { path, name, ok, durationMs, startedAt,
     *                         output (string[]), error, errorInfo, runtime, argv }
     */
    function record(entry) {
        const record = {
            path: entry.path || null,
            name: entry.name || (entry.path ? String(entry.path).split("/").pop() : "(script)"),
            ok: Boolean(entry.ok),
            durationMs: typeof entry.durationMs === "number" ? entry.durationMs : 0,
            startedAt: entry.startedAt || Date.now(),
            outputLines: Array.isArray(entry.output) ? entry.output.length : 0,
            lastOutput: Array.isArray(entry.output) ? entry.output.slice(-20) : [],
            error: entry.error || null,
            errorInfo: entry.errorInfo || null,
            runtime: entry.runtime || null,
            argv: Array.isArray(entry.argv) ? entry.argv.slice() : []
        };
        history = [record, ...history].slice(0, limit);
        if (record.path) lastByPath[record.path] = record;
        return record;
    }

    /** Recent runs, most recent first (optionally capped to `n`). */
    function recent(n) {
        return n ? history.slice(0, n) : history.slice();
    }

    /** The most recent run overall, or null. */
    function last() {
        return history[0] || null;
    }

    /** The last run record for a given script path, or null. */
    function lastRun(path) {
        return lastByPath[path] || null;
    }

    /** Distinct recently-run script paths, most recent first. */
    function recentScripts(n) {
        const seen = new Set();
        const paths = [];
        for (const r of history) {
            if (r.path && !seen.has(r.path)) {
                seen.add(r.path);
                paths.push(r.path);
            }
        }
        return n ? paths.slice(0, n) : paths;
    }

    function clear() {
        history = [];
        Object.keys(lastByPath).forEach((k) => delete lastByPath[k]);
    }

    return { record, recent, last, lastRun, recentScripts, clear };
}

/** The default session journal used by the live VM execution layer. */
export const executionJournal = createExecutionJournal();
