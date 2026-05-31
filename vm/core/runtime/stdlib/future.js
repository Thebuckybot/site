/**
 * Future stdlib interfaces — Phase 4.4, Parts 24 (mail) + 23 (database, missions).
 *
 * ARCHITECTURE ONLY. These modules exist so the prepared import lines resolve
 * today —
 *     from bucky.mail import *
 *     import bucky.database
 *     import bucky.missions
 * — and so the method surface (mail.send / mail.inbox / mail.search, etc.) is
 * discoverable and stable. Every member raises NotImplementedError; there is
 * NO transport, NO data, NO write path here by design. Phase 5.2 (Mail Relay)
 * and later phases implement these behind the exact same names, additively.
 */
import { mod, notImplemented } from "./kit.js";

const MAIL_MSG = "Mail Relay (bucky.mail) is not built yet — it arrives in Phase 5.2. This is an interface-only seam.";
const DB_MSG = "Database Viewer (bucky.database) is not built yet — it arrives in a later phase. Interface-only seam.";
const MISSION_MSG = "Mission Board (bucky.missions) is not built yet — it arrives in a later phase. Interface-only seam.";

export function createMailModule() {
    return mod("bucky.mail", {
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
