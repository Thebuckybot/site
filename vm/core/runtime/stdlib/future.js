/**
 * Future stdlib interfaces — Phase 4.4 Parts 24/23, with the Phase 4.5 §16 mail
 * FOUNDATION layered on.
 *
 * ARCHITECTURE-FORWARD. These modules let the prepared import lines resolve —
 *     from bucky.mail import *
 *     import bucky.database
 *     import bucky.missions
 * — and keep the method surface discoverable and stable. Database/Missions stay
 * interface-only (every member raises NotImplementedError). Mail gains its
 * Phase 4.5 FOUNDATION: a script can read its mail *identity* and availability
 * today; sending and inbox transport still raise NotImplemented until the Mail
 * Relay lands (Phase 5.2). No data, no transport, no write path here by design.
 */
import { mod, def, notImplemented } from "./kit.js";

const MAIL_MSG = "Mail Relay sending/inbox (bucky.mail) is not built yet — it arrives in Phase 5.2. The Phase 4.5 foundation exposes mail.identity()/available()/inbox_count()/unread_count() only.";
const DB_MSG = "Database Viewer (bucky.database) is not built yet — it arrives in a later phase. Interface-only seam.";
const MISSION_MSG = "Mission Board (bucky.missions) is not built yet — it arrives in a later phase. Interface-only seam.";

/** Derive the bucky.net mail handle from the operator's Discord username. */
function mailHandle(ctx) {
    const raw = String((ctx && ctx.user && (ctx.user.username || ctx.user.name)) || "operator");
    const handle = raw.trim().replace(/\s+/g, "").replace(/@/g, "") || "operator";
    return handle + "@bucky.net";
}

export function createMailModule(ctx) {
    return mod("bucky.mail", {
        // Phase 4.5 foundation — these work today.
        identity: def(() => { ctx.caps.require("mail", "mail.identity"); return mailHandle(ctx); }),
        available: def(() => { ctx.caps.require("mail", "mail.available"); return false; }),
        inbox_count: def(() => { ctx.caps.require("mail", "mail.inbox_count"); return 0; }),
        unread_count: def(() => { ctx.caps.require("mail", "mail.unread_count"); return 0; }),
        // Transport — deferred to the Mail Relay (Phase 5.2).
        send: notImplemented("mail.send", MAIL_MSG),
        inbox: notImplemented("mail.inbox", MAIL_MSG),
        search: notImplemented("mail.search", MAIL_MSG),
        read: notImplemented("mail.read", MAIL_MSG)
    });
}

export function createDatabaseModule() {
    return mod("bucky.database", {
        query: notImplemented("database.query", DB_MSG),
        tables: notImplemented("database.tables", DB_MSG),
        get: notImplemented("database.get", DB_MSG)
    });
}

export function createMissionsModule() {
    return mod("bucky.missions", {
        list: notImplemented("missions.list", MISSION_MSG),
        current: notImplemented("missions.current", MISSION_MSG),
        accept: notImplemented("missions.accept", MISSION_MSG),
        complete: notImplemented("missions.complete", MISSION_MSG)
    });
}
