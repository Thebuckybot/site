/**
 * bucky.events + bucky.schedule — the runtime-event & automation foundation
 * (Phase 4.5, §3 & §24).
 *
 * ARCHITECTURE ONLY — by design. A script can *register* handlers for runtime
 * events (on_leak, on_mail, on_incident, on_mission, on_levelup) and *declare*
 * scheduled tasks (hourly / daily / weekly / once), but nothing dispatches or
 * fires them in this phase: the trigger sources (the leak engine, mail relay,
 * mission board) and the scheduler daemon are not bridged into the VM yet. This
 * establishes the exact shape future automation binds to, so wiring it later is
 * purely additive — no script written today needs to change.
 *
 *   events.list()                 the event vocabulary
 *   events.on(event, handler)     register a handler (stored, not dispatched)
 *   events.registered()           handler counts per event
 *
 *   schedule.cadences()           the cadence vocabulary
 *   schedule.hourly(name, fn)     declare an hourly task
 *   schedule.daily(name, fn)      declare a daily task
 *   schedule.weekly(name, fn)     declare a weekly task
 *   schedule.once(name, fn)       declare a one-shot task
 *   schedule.list()               declared tasks
 */
import { mod, def } from "./kit.js";

export function createEventsModule(ctx) {
    const reg = () => ctx.automation || null;

    function list() { ctx.caps.require("events", "events.list"); const r = reg(); return r ? r.events() : []; }
    function on(event, handler) {
        ctx.caps.require("events", "events.on");
        const r = reg();
        if (!r) return false;
        r.on(String(event), handler);
        return true;
    }
    function registered() { ctx.caps.require("events", "events.registered"); const r = reg(); return r ? r.registered() : {}; }

    return mod("bucky.events", {
        list: def(list),
        on: def(on),
        registered: def(registered)
    });
}

export function createScheduleModule(ctx) {
    const reg = () => ctx.schedule || null;
    const add = (cadence, name, handler) => {
        const r = reg();
        if (!r) return null;
        return r.add(cadence, name, handler);
    };

    function cadences() { ctx.caps.require("automation", "schedule.cadences"); const r = reg(); return r ? r.cadences() : []; }
    function hourly(name, fn) { ctx.caps.require("automation", "schedule.hourly"); return add("hourly", name, fn); }
    function daily(name, fn) { ctx.caps.require("automation", "schedule.daily"); return add("daily", name, fn); }
    function weekly(name, fn) { ctx.caps.require("automation", "schedule.weekly"); return add("weekly", name, fn); }
    function once(name, fn) { ctx.caps.require("automation", "schedule.once"); return add("once", name, fn); }
    function list() { ctx.caps.require("automation", "schedule.list"); const r = reg(); return r ? r.list() : []; }

    return mod("bucky.schedule", {
        cadences: def(cadences),
        hourly: def(hourly),
        daily: def(daily),
        weekly: def(weekly),
        once: def(once),
        list: def(list)
    });
}
