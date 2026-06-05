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
import { mod, def, defEx, notImplemented } from "./kit.js";

const MAIL_MSG = "Mail is not available in this run — the MailService was not threaded into the runtime context.";
const SEARCH_MSG = "mail.search is not part of Phase 5.0 (search/filters arrive in a later phase).";
const DB_MSG = "Database Viewer (bucky.database) is not built yet — it arrives in a later phase. Interface-only seam.";
const MISSION_MSG = "Mission Board (bucky.missions) is not built yet — it arrives in a later phase. Interface-only seam.";

/** Derive the bucky.net mail handle from the operator's Discord username. */
function mailHandle(ctx) {
    const raw = String((ctx && ctx.user && (ctx.user.username || ctx.user.name)) || "operator");
    const handle = raw.trim().replace(/\s+/g, "").replace(/@/g, "") || "operator";
    return handle + "@bucky.net";
}

/**
 * Phase 5.0 — `bucky.mail` is LIVE when the MailService is threaded into the
 * runtime context (ctx.mail). The execution layer supplies the same service
 * instance the desktop Mail app uses, so a script's inbox/sent/read/send all
 * operate on the operator's real mailbox. When ctx.mail is absent (a bare
 * headless run) the foundation methods still answer and the transport methods
 * raise a clear NotImplemented.
 */
export function createMailModule(ctx) {
    const svc = ctx.mail || null;
    const requireSvc = (label) => {
        ctx.caps.require("mail", label);
        if (!svc) {
            const e = new Error(MAIL_MSG);
            e.buckyType = "NotImplementedError";
            throw e;
        }
        return svc;
    };
    return mod("bucky.mail", {
        // Foundation — answer with or without a live service.
        identity: def(() => { ctx.caps.require("mail", "mail.identity"); return svc ? svc.identity() : mailHandle(ctx); }),
        available: def(() => { ctx.caps.require("mail", "mail.available"); return Boolean(svc); }),
        inbox_count: def(() => { ctx.caps.require("mail", "mail.inbox_count"); return svc ? svc.counts().inboxTotal : 0; }),
        unread_count: def(() => { ctx.caps.require("mail", "mail.unread_count"); return svc ? svc.counts().inboxUnread : 0; }),
        // Live mailbox API (Phase 5.0).
        inbox: def((limit) => requireSvc("mail.inbox").getInbox(typeof limit === "number" ? limit : 10)),
        sent: def((limit) => requireSvc("mail.sent").getSent(typeof limit === "number" ? limit : 10)),
        unread: def(() => requireSvc("mail.unread").getInbox(0).filter((m) => !m.isRead)),
        read: def((id) => requireSvc("mail.read").openMessage(id)),
        attachments: def((id) => requireSvc("mail.attachments").listAttachments(id)),
        // send(to, subject, body, cc=..., bcc=...) — positional + kwargs.
        send: defEx((args, kwargs) => {
            const s = requireSvc("mail.send");
            const kw = kwargs || {};
            const to = args[0] != null ? args[0] : kw.to;
            const subject = args[1] != null ? args[1] : (kw.subject || "(no subject)");
            const body = args[2] != null ? args[2] : (kw.body || "");
            return s.send({ to, cc: kw.cc, bcc: kw.bcc, subject, body, attachments: kw.attachments });
        }),
        // Not part of Phase 5.0.
        search: notImplemented("mail.search", SEARCH_MSG)
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
