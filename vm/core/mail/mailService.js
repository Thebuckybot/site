/**
 * MailService — the Bucky Mail orchestration layer (Phase 5.0).
 *
 * Registered as `runtime.services.mail`; the Mail app is a thin client over it.
 * This is the MailManager: it composes addressing (mailAddress), the encrypted
 * store (mailStorage), attachments + filesystem materialisation
 * (mailAttachmentService), and the authored seed (mailSeed) into the platform's
 * verbs, and it emits `mail:*` events on the runtime bus so the desktop app and
 * notifications react without being called directly.
 *
 * EVENTS (on the shared bus):
 *   mail:received  { messageId, from, subject }   - new mail delivered to me
 *   mail:read      { messageId }                  - a message was opened/read
 *   mail:sent      { messageId }                  - I sent a message
 *   mail:updated   { }                            - counts/flags changed
 *
 * A module-level singleton (get/setMailService) lets the script execution layer
 * and the bucky.mail stdlib reach the same instance the desktop app uses — the
 * same pattern the snapshot store / process table use (one VM per page).
 *
 * GitHub Pages safe: entirely client-side and in-memory. The seam to the
 * backend (api/vm/mail/*) is documented in docs/phase5; swapping the store does
 * not change this service's surface.
 */
import { createMailStorage } from "./mailStorage.js";
import { createMailAttachmentService } from "./mailAttachmentService.js";
import { buildSeed } from "./mailSeed.js";
import * as MailAddress from "./mailAddress.js";

let _instance = null;

/** The shared MailService for this VM session (or null before boot). */
export function getMailService() {
    return _instance;
}

/** Register the shared MailService instance (called once at VM boot). */
export function setMailService(service) {
    _instance = service || null;
    return _instance;
}

export function createMailService(options = {}) {
    const user = options.user || {};
    const bus = options.bus || null;
    const filesystem = options.filesystem || null;

    const operator = {
        userId: user.id != null ? String(user.id) : null,
        address: MailAddress.fromUsername(user.username),
        display: user.username || "operator"
    };
    const who = { userId: operator.userId, email: operator.address };

    const storage = createMailStorage();
    const attachmentsSvc = createMailAttachmentService(storage, filesystem);

    function emit(name, payload) {
        if (bus && typeof bus.emit === "function") bus.emit(name, payload || {});
    }

    // ----- Seed --------------------------------------------------------------
    function seedIfEmpty() {
        if (!storage.isEmpty()) return;
        const { inbox, sent } = buildSeed(operator.address);
        const now = Date.now();

        // Seed oldest-first so auto-increment ids track chronology.
        [...inbox].sort((a, b) => b.ago - a.ago).forEach((spec) => {
            const createdAt = now - spec.ago;
            const atts = spec.attachments || [];
            const messageId = storage.insertMessage({
                senderUserId: null,
                senderEmail: spec.from,
                senderDisplay: spec.display || null,
                subject: spec.subject,
                body: spec.body,
                source: spec.source || "authored",
                priority: spec.priority || "normal",
                hasAttachments: atts.length > 0,
                attachmentCount: atts.length,
                createdAt
            });
            atts.forEach((a) => attachmentsSvc.store({
                messageId, filename: a.filename, mime: a.mime, content: a.content
            }));
            storage.insertRecipient({
                messageId,
                recipientUserId: operator.userId,
                recipientEmail: operator.address,
                recipientType: "TO",
                isRead: Boolean(spec.read),
                createdAt
            });
        });

        [...sent].sort((a, b) => b.ago - a.ago).forEach((spec) => {
            const createdAt = now - spec.ago;
            const messageId = storage.insertMessage({
                senderUserId: operator.userId,
                senderEmail: operator.address,
                senderDisplay: operator.display,
                subject: spec.subject,
                body: spec.body,
                source: spec.source || "composed",
                priority: "normal",
                hasAttachments: false,
                attachmentCount: 0,
                createdAt
            });
            (spec.to || []).forEach((addr) => storage.insertRecipient({
                messageId,
                recipientUserId: null,
                recipientEmail: addr,
                recipientType: "TO",
                isRead: true,
                createdAt
            }));
        });
    }

    // ----- Helpers -----------------------------------------------------------
    function preview(messageId) {
        const body = storage.readBody(messageId);
        return String(body || "").replace(/\s+/g, " ").trim().slice(0, 90);
    }

    function isFromOperator(meta) {
        return (operator.userId != null && String(meta.senderUserId) === operator.userId) ||
            MailAddress.normalize(meta.senderEmail) === MailAddress.normalize(operator.address);
    }

    function inboxView(row) {
        return {
            messageId: row.messageId,
            from: row.senderEmail,
            fromDisplay: row.senderDisplay || MailAddress.localPart(row.senderEmail) || row.senderEmail,
            subject: row.subject,
            preview: preview(row.messageId),
            isRead: row.isRead,
            hasAttachments: row.hasAttachments,
            attachmentCount: row.attachmentCount,
            priority: row.priority,
            recipientType: row.recipientType,
            createdAt: row.createdAt
        };
    }

    function sentView(row) {
        const recips = storage.listRecipients(row.messageId);
        return {
            messageId: row.messageId,
            from: row.senderEmail,
            fromDisplay: operator.display,
            to: recips.filter((r) => r.recipientType === "TO").map((r) => r.recipientEmail),
            subject: row.subject,
            preview: preview(row.messageId),
            isRead: true,
            hasAttachments: row.hasAttachments,
            attachmentCount: row.attachmentCount,
            priority: row.priority,
            createdAt: row.createdAt
        };
    }

    // ----- Public API --------------------------------------------------------
    function identity() {
        return operator.address;
    }

    function counts() {
        return {
            inboxTotal: storage.countInbox(who, false),
            inboxUnread: storage.countInbox(who, true),
            sentTotal: storage.listSent(who, 0).length,
            total: storage.totals().messages
        };
    }

    function getInbox(limit = 10) {
        return storage.listInbox(who, limit).map(inboxView);
    }

    function getSent(limit = 10) {
        return storage.listSent(who, limit).map(sentView);
    }

    /** Full message for the reader. Marks the operator's copy read by default. */
    function openMessage(messageId, opts = {}) {
        const meta = storage.getMessageMeta(messageId);
        if (!meta) return null;
        const markRead = opts.markRead !== false;
        const sent = isFromOperator(meta);

        let becameRead = false;
        if (markRead && !sent) becameRead = storage.markRead(who, messageId, true);

        const recips = storage.listRecipients(messageId);
        const myRow = recips.find((r) =>
            (operator.userId != null && String(r.recipientUserId) === operator.userId) ||
            MailAddress.normalize(r.recipientEmail) === MailAddress.normalize(operator.address));

        const view = {
            id: meta.id,
            mailbox: sent ? "sent" : "inbox",
            from: meta.senderEmail,
            fromDisplay: meta.senderDisplay || MailAddress.localPart(meta.senderEmail) || meta.senderEmail,
            to: recips.filter((r) => r.recipientType === "TO").map((r) => r.recipientEmail),
            cc: recips.filter((r) => r.recipientType === "CC").map((r) => r.recipientEmail),
            bcc: sent ? recips.filter((r) => r.recipientType === "BCC").map((r) => r.recipientEmail) : [],
            subject: meta.subject,
            body: storage.readBody(messageId),
            attachments: storage.listAttachmentsMeta(messageId),
            priority: meta.priority,
            source: meta.source,
            isRead: sent ? true : (myRow ? myRow.isRead : true),
            createdAt: meta.createdAt
        };

        if (becameRead) {
            emit("mail:read", { messageId });
            emit("mail:updated", {});
        }
        return view;
    }

    function markRead(messageId) {
        const changed = storage.markRead(who, messageId, true);
        if (changed) { emit("mail:read", { messageId }); emit("mail:updated", {}); }
        return changed;
    }

    function markUnread(messageId) {
        const changed = storage.markRead(who, messageId, false);
        if (changed) emit("mail:updated", {});
        return changed;
    }

    /**
     * Compose + send. `payload` = { to, cc, bcc, subject, body, attachments }.
     * to/cc/bcc accept a comma list string or an array of addresses.
     * attachments: [{ filename, mime, content }]. Returns { ok, messageId, error }.
     */
    function send(payload = {}) {
        const to = MailAddress.splitList(payload.to);
        const cc = MailAddress.splitList(payload.cc);
        const bcc = MailAddress.splitList(payload.bcc);
        if (!to.length && !cc.length && !bcc.length) {
            return { ok: false, messageId: null, error: "at least one recipient is required" };
        }
        const atts = Array.isArray(payload.attachments) ? payload.attachments : [];
        const messageId = storage.insertMessage({
            senderUserId: operator.userId,
            senderEmail: operator.address,
            senderDisplay: operator.display,
            subject: payload.subject || "(no subject)",
            body: payload.body || "",
            source: "composed",
            priority: payload.priority || "normal",
            hasAttachments: atts.length > 0,
            attachmentCount: atts.length,
            createdAt: Date.now()
        });
        atts.forEach((a) => attachmentsSvc.store({
            messageId, filename: a.filename, mime: a.mime, content: a.content
        }));
        const add = (list, type) => list.forEach((addr) => storage.insertRecipient({
            messageId, recipientUserId: null, recipientEmail: addr, recipientType: type, isRead: true
        }));
        add(to, "TO"); add(cc, "CC"); add(bcc, "BCC");

        emit("mail:sent", { messageId });
        // Self-addressed mail also lands in the inbox.
        if ([...to, ...cc, ...bcc].some((a) => MailAddress.normalize(a) === MailAddress.normalize(operator.address))) {
            emit("mail:received", { messageId, from: operator.address, subject: payload.subject || "" });
        }
        emit("mail:updated", {});
        return { ok: true, messageId, error: null };
    }

    /**
     * Deliver a system/NPC/generated message TO the operator (the in-VM analogue
     * of the backend generators and owner.py mail commands). Returns messageId.
     */
    function deliver(payload = {}) {
        const atts = Array.isArray(payload.attachments) ? payload.attachments : [];
        const createdAt = payload.createdAt != null ? payload.createdAt : Date.now();
        const messageId = storage.insertMessage({
            senderUserId: payload.senderUserId != null ? payload.senderUserId : null,
            senderEmail: payload.from || "system@bucky.net",
            senderDisplay: payload.display || null,
            subject: payload.subject || "(no subject)",
            body: payload.body || "",
            source: payload.source || "system",
            priority: payload.priority || "normal",
            hasAttachments: atts.length > 0,
            attachmentCount: atts.length,
            createdAt
        });
        atts.forEach((a) => attachmentsSvc.store({
            messageId, filename: a.filename, mime: a.mime, content: a.content
        }));
        storage.insertRecipient({
            messageId,
            recipientUserId: operator.userId,
            recipientEmail: operator.address,
            recipientType: "TO",
            isRead: false,
            createdAt
        });
        emit("mail:received", { messageId, from: payload.from || "system@bucky.net", subject: payload.subject || "" });
        emit("mail:updated", {});
        return messageId;
    }

    function getAttachment(attachmentId) {
        return attachmentsSvc.open(attachmentId);
    }

    function listAttachments(messageId) {
        return attachmentsSvc.listFor(messageId);
    }

    /** Materialise an attachment into the VFS (/mail/attachments/<name>). */
    function saveAttachment(attachmentId, opts) {
        return attachmentsSvc.materialize(attachmentId, opts || {});
    }

    seedIfEmpty();

    return {
        // identity / metrics
        identity,
        operator: () => ({ ...operator }),
        counts,
        // mailbox reads
        getInbox,
        getSent,
        openMessage,
        // mutations
        markRead,
        markUnread,
        send,
        deliver,
        // attachments
        getAttachment,
        listAttachments,
        saveAttachment,
        // diagnostics / tests
        _storage: storage
    };
}
