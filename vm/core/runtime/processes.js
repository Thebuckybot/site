/**
 * Process Manager — the Bucky VM's simulated process table (Phase 4.5, §1).
 *
 * Scripts in the VM stopped being "run instantly and forgotten" in Phase 4.5:
 * a launched script becomes a *process* with a PID, a state, and a lifecycle the
 * operator can inspect (`ps`, `jobs`, `top`) and control (`kill`, `killall`).
 * This module is the in-memory registry behind all of that — one table per VM
 * session, shared by the Terminal (which registers foreground/background runs)
 * and by the `bucky.process` standard-library module (which reads/controls it).
 *
 * It is pure runtime data: DOM-free, network-free, no real OS processes, no
 * threads, no timers of its own. The interpreter remains synchronous and
 * single-threaded; a "process" here is a *record + state machine*, not preemptive
 * multitasking. Concurrency stays cooperative (a foreground process locks the
 * terminal; a background `&` process records its run without holding the prompt).
 * That keeps the stable runtime untouched while giving the OS fantasy real teeth.
 *
 * State machine:
 *
 *     spawn() ─▶ running ──▶ completed        (normal finish)
 *                  │   │ ╰──▶ failed           (raised an error)
 *                  │   ╰────▶ terminated       (kill / killall)
 *                  ├──▶ waiting   (blocked on input()/a form)
 *                  ╰──▶ sleeping  (cooperative yield / scheduled wait)
 *
 * Terminal states (completed/failed/terminated) are final. An optional event
 * sink (the EventBus) receives `process:*` events so future subsystems — the
 * task tray, notifications, missions — can react without this module knowing
 * about them. Nothing is wired to dispatch yet beyond what the Terminal emits.
 */

/** The canonical process states. */
export const PROCESS_STATES = {
    RUNNING: "running",
    WAITING: "waiting",
    SLEEPING: "sleeping",
    COMPLETED: "completed",
    FAILED: "failed",
    TERMINATED: "terminated"
};

const ACTIVE_STATES = new Set([
    PROCESS_STATES.RUNNING,
    PROCESS_STATES.WAITING,
    PROCESS_STATES.SLEEPING
]);

const FINAL_STATES = new Set([
    PROCESS_STATES.COMPLETED,
    PROCESS_STATES.FAILED,
    PROCESS_STATES.TERMINATED
]);

/** True when a state is one a process can no longer leave. */
export function isFinalState(state) {
    return FINAL_STATES.has(state);
}

/**
 * Create a session process manager.
 * @param {object} [opts]
 * @param {(event:string, payload:object)=>void} [opts.emit]  optional event sink (EventBus)
 * @param {()=>number} [opts.now]  injectable clock (tests)
 */
export function createProcessManager(opts = {}) {
    const emit = typeof opts.emit === "function" ? opts.emit : () => {};
    const now = typeof opts.now === "function" ? opts.now : () => Date.now();

    /** pid -> record */
    const table = new Map();
    let nextPid = 1;

    function publicCopy(rec) {
        if (!rec) return null;
        return {
            pid: rec.pid,
            name: rec.name,
            owner: rec.owner,
            state: rec.state,
            background: rec.background,
            exclusive: rec.exclusive,
            progress: rec.progress,
            label: rec.label,
            note: rec.note,
            exitCode: rec.exitCode,
            startedAt: rec.startedAt,
            endedAt: rec.endedAt,
            elapsedMs: (rec.endedAt || now()) - rec.startedAt
        };
    }

    /**
     * Register a new process.
     * @param {object} info
     * @param {string} info.name        script/command name (e.g. "bruteforce.py")
     * @param {string} [info.owner]     who launched it ("terminal" / "script")
     * @param {boolean} [info.background]  launched with a trailing `&`
     * @param {boolean} [info.exclusive]  locks the terminal while running
     * @param {string} [info.note]      free-form note shown by `ps`
     * @returns {object} a read-only copy of the new record
     */
    function spawn(info = {}) {
        const pid = nextPid++;
        const rec = {
            pid,
            name: String(info.name || "process"),
            owner: String(info.owner || "script"),
            state: PROCESS_STATES.RUNNING,
            background: !!info.background,
            // Background jobs never lock the terminal; foreground jobs default
            // to exclusive unless explicitly told otherwise.
            exclusive: info.background ? false : (info.exclusive !== false),
            progress: null,
            label: info.label != null ? String(info.label) : null,
            note: info.note != null ? String(info.note) : null,
            exitCode: null,
            startedAt: now(),
            endedAt: null
        };
        table.set(pid, rec);
        emit("process:spawned", publicCopy(rec));
        return publicCopy(rec);
    }

    function get(pid) {
        return publicCopy(table.get(Number(pid)));
    }

    /** Every process, oldest PID first. */
    function list() {
        return [...table.values()].sort((a, b) => a.pid - b.pid).map(publicCopy);
    }

    /** Active (running/waiting/sleeping) processes — what `jobs`/`top` show. */
    function active() {
        return list().filter((r) => ACTIVE_STATES.has(r.state));
    }

    function byState(state) {
        const s = String(state || "").toLowerCase();
        return list().filter((r) => r.state === s);
    }

    /** The exclusive active process that currently locks the terminal, or null. */
    function foreground() {
        const rec = [...table.values()].find((r) => ACTIVE_STATES.has(r.state) && r.exclusive && !r.background);
        return publicCopy(rec) || null;
    }

    function setState(pid, state) {
        const rec = table.get(Number(pid));
        if (!rec || FINAL_STATES.has(rec.state)) return false;
        if (!ACTIVE_STATES.has(state) && !FINAL_STATES.has(state)) return false;
        rec.state = state;
        if (FINAL_STATES.has(state)) rec.endedAt = now();
        emit("process:state-changed", publicCopy(rec));
        return true;
    }

    /** Update a process's progress (0–100) and optional stage label. */
    function setProgress(pid, percent, label) {
        const rec = table.get(Number(pid));
        if (!rec || FINAL_STATES.has(rec.state)) return false;
        if (typeof percent === "number") rec.progress = Math.max(0, Math.min(100, Math.round(percent)));
        if (label != null) rec.label = String(label);
        emit("process:progress", publicCopy(rec));
        return true;
    }

    /** Finish a process normally (ok=true → completed) or in error (failed). */
    function complete(pid, ok = true, exitCode) {
        const rec = table.get(Number(pid));
        if (!rec || FINAL_STATES.has(rec.state)) return false;
        rec.state = ok ? PROCESS_STATES.COMPLETED : PROCESS_STATES.FAILED;
        rec.endedAt = now();
        rec.exitCode = typeof exitCode === "number" ? exitCode : (ok ? 0 : 1);
        if (ok && rec.progress != null) rec.progress = 100;
        emit("process:exited", publicCopy(rec));
        return true;
    }

    /** Force a process into the terminated state (the `kill` action). */
    function terminate(pid) {
        const rec = table.get(Number(pid));
        if (!rec || FINAL_STATES.has(rec.state)) return false;
        rec.state = PROCESS_STATES.TERMINATED;
        rec.endedAt = now();
        rec.exitCode = 137; // SIGKILL-flavoured, for the OS feel
        emit("process:terminated", publicCopy(rec));
        return true;
    }

    /** kill <pid> — terminate one active process. Returns true on success. */
    function kill(pid) {
        return terminate(pid);
    }

    /** killall <name> — terminate every active process matching a name. */
    function killall(name) {
        const target = String(name || "").toLowerCase();
        let count = 0;
        [...table.values()].forEach((rec) => {
            if (ACTIVE_STATES.has(rec.state) && rec.name.toLowerCase() === target) {
                if (terminate(rec.pid)) count++;
            }
        });
        return count;
    }

    /** Counts by state — feeds `top`'s header line. */
    function stats() {
        const out = { total: table.size };
        Object.values(PROCESS_STATES).forEach((s) => { out[s] = 0; });
        table.forEach((rec) => { out[rec.state] = (out[rec.state] || 0) + 1; });
        return out;
    }

    /** Drop finished records (keeps the table from growing without bound). */
    function reap() {
        let removed = 0;
        [...table.entries()].forEach(([pid, rec]) => {
            if (FINAL_STATES.has(rec.state)) { table.delete(pid); removed++; }
        });
        return removed;
    }

    return {
        states: PROCESS_STATES,
        spawn,
        get,
        list,
        active,
        byState,
        foreground,
        setState,
        setProgress,
        complete,
        terminate,
        kill,
        killall,
        stats,
        reap
    };
}
