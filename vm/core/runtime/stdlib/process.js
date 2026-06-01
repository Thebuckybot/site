/**
 * bucky.process — the script-facing view of the process table (Phase 4.5, §1).
 *
 * A thin standard-library facade over the session ProcessManager
 * (core/runtime/processes.js). It lets a running script inspect the VM's
 * processes and control them — the same table the `ps` / `jobs` / `top` /
 * `kill` terminal commands read. A script's own PID is injected as `ctx.pid`,
 * so `process.current()` returns its own record.
 *
 *   list()            every process, oldest PID first (what `ps` shows)
 *   active() / jobs() running / waiting / sleeping processes
 *   get(pid)          one process record, or None
 *   current()         the calling script's own process record
 *   pid()             the calling script's PID
 *   kill(pid)         terminate a process (True on success)
 *   killall(name)     terminate every active process with that name (count)
 *   stats()           counts by state
 *
 * Degrades gracefully (empty table / no-op control) when no process manager is
 * attached to the run — e.g. a trivial BuckyCode "Run" of a data-free script.
 */
import { mod, def } from "./kit.js";

export function createProcessModule(ctx) {
    const mgr = () => ctx.processes || null;

    function list() { ctx.caps.require("process", "process.list"); const m = mgr(); return m ? m.list() : []; }
    function active() { ctx.caps.require("process", "process.active"); const m = mgr(); return m ? m.active() : []; }
    function get(pid) { ctx.caps.require("process", "process.get"); const m = mgr(); return m ? m.get(pid) : null; }
    function current() {
        ctx.caps.require("process", "process.current");
        const m = mgr();
        return m && ctx.pid != null ? m.get(ctx.pid) : null;
    }
    function pid() { ctx.caps.require("process", "process.pid"); return ctx.pid != null ? ctx.pid : null; }
    function kill(target) { ctx.caps.require("process", "process.kill"); const m = mgr(); return m ? m.kill(target) : false; }
    function killall(name) { ctx.caps.require("process", "process.killall"); const m = mgr(); return m ? m.killall(name) : 0; }
    function stats() { ctx.caps.require("process", "process.stats"); const m = mgr(); return m ? m.stats() : { total: 0 }; }

    return mod("bucky.process", {
        list: def(list),
        ps: def(list),
        active: def(active),
        jobs: def(active),
        get: def(get),
        current: def(current),
        pid: def(pid),
        kill: def(kill),
        killall: def(killall),
        stats: def(stats)
    });
}
