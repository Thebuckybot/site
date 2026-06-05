/**
 * MailStorage — the Bucky Mail in-memory message store (Phase 5.0).
 *
 * The client-side analogue of the backend's three mail tables
 * (mail_messages / mail_recipients / mail_attachments, migration 0005). It is
 * the VM's "mail database": session-based and in-memory, so it feels persistent
 * during a session and resets on refresh — exactly the model the VM filesystem
 * uses (no backend sync in this phase, GitHub Pages safe).
 *
 * SECURITY CONTRACT. Bodies and attachment payloads are NEVER held as
 * plaintext. Every write runs COMPRESS -> ENCRYPT (MailCompression then
 * MailEncryption); every read runs DECRYPT -> DECOMPRESS. The stored `blob` is
 * opaque. This is the same contract the backend honours with zlib + AES-GCM, so
 * the store can be swapped for the gateway without changing callers.
 *
 * This module is pure data/logic — DOM-free. The Mail app and the MailService
 * are the only callers; they never reach into the raw arrays.
 */
import * as MailCompression from "./mailCompression.js";
import * as MailEncryption from "./mailEncryption.js";
import { normalize as normAddr } from "./mailAddress.js";

const CIPHER = "lzw1+xor1"; // compression algo + encryption algo marker

/** COMPRESS then ENCRYPT a plaintext string into an opaque stored blob. */
function seal(text) {
    const comp = MailCompression.compress(text);
    const enc = MailEncryption.encrypt(comp.data);
    return {
        blob: { cipher: CIPHER, data: enc.data, nonce: enc.nonce },
        originalSize: comp.originalSize,
        compressedSize: comp.compressedSize
    };
}

/** DECRYPT then DECOMPRESS a stored blob back to plaintext. */
function open(blob) {
    if (!blob) return "";
    try {
        const compData = MailEncryption.decrypt({ data: blob.data, nonce: blob.nonce });
        return MailCompression.decompress(compData);
    } catch (_e) {
        return "[unable to decrypt]";
    }
}

export function createMailStorage() {
    const messages = [];     // mail_messages rows
    const recipients = [];   // mail_recipients rows
    const attachments = [];  // mail_attachments rows
    const seq = { message: 0, recipient: 0, attachment: 0 };

    const matchRecipient = (r, who) =>
        (who.userId != null && who.userId !== "" && String(r.recipientUserId) === String(who.userId)) ||
        (who.email && normAddr(r.recipientEmail) === normAddr(who.email));

    // ----- Writes ------------------------------------------------------------

    function insertMessage(fields) {
        const sealed = seal(fields.body || "");
        const row = {
            id: ++seq.message,
            senderUserId: fields.senderUserId != null ? String(fields.senderUserId) : null,
            senderEmail: String(fields.senderEmail || ""),
            senderDisplay: fields.senderDisplay || null,
            subject: String(fields.subject || ""),
            body: sealed.blob,
            originalSize: sealed.originalSize,
            compressedSize: sealed.compressedSize,
            cipher: CIPHER,
            hasAttachments: Boolean(fields.hasAttachments),
            attachmentCount: Number(fields.attachmentCount || 0),
            source: fields.source || "composed",
            priority: fields.priority || "normal",
            metadata: fields.metadata || null,
            createdAt: fields.createdAt != null ? Number(fields.createdAt) : Date.now()
        };
        messages.push(row);
        return row.id;
    }

    function insertRecipient(fields) {
        const rtype = String(fields.recipientType || "TO").toUpperCase();
        const row = {
            id: ++seq.recipient,
            messageId: Number(fields.messageId),
            recipientUserId: fields.recipientUserId != null ? String(fields.recipientUserId) : null,
            recipientEmail: String(fields.recipientEmail || ""),
            recipientType: ["TO", "CC", "BCC"].includes(rtype) ? rtype : "TO",
            isRead: Boolean(fields.isRead),
            readAt: fields.readAt != null ? Number(fields.readAt) : null,
            createdAt: fields.createdAt != null ? Number(fields.createdAt) : Date.now()
        };
        recipients.push(row);
        return row.id;
    }

    function insertAttachment(fields) {
        const sealed = seal(fields.content || "");
        const row = {
            id: ++seq.attachment,
            messageId: Number(fields.messageId),
            filename: String(fields.filename || "attachment.txt"),
            mime: String(fields.mime || "text/plain"),
            blob: sealed.blob,
            originalSize: sealed.originalSize,
            compressedSize: sealed.compressedSize,
            cipher: CIPHER,
            createdAt: fields.createdAt != null ? Number(fields.createdAt) : Date.now()
        };
        attachments.push(row);
        return row.id;
    }

    // ----- Reads -------------------------------------------------------------

    function messageMeta(row) {
        if (!row) return null;
        const { body, ...meta } = row; // never expose the sealed body in meta
        return meta;
    }

    function getMessageMeta(id) {
        return messageMeta(messages.find((m) => m.id === Number(id)) || null);
    }

    function readBody(id) {
        const row = messages.find((m) => m.id === Number(id));
        return row ? open(row.body) : "";
    }

    function byNewest(a, b) {
        return b.createdAt - a.createdAt || b.id - a.id;
    }

    /** A recipient's inbox: their delivery rows joined to message metadata. */
    function listInbox(who, limit = 10) {
        const mine = recipients.filter((r) => matchRecipient(r, who)).sort((a, b) => {
            const ma = messages.find((m) => m.id === a.messageId);
            const mb = messages.find((m) => m.id === b.messageId);
            return byNewest(ma || { createdAt: 0, id: 0 }, mb || { createdAt: 0, id: 0 });
        });
        const rows = mine.map((r) => {
            const m = messages.find((msg) => msg.id === r.messageId) || {};
            return {
                recipientRowId: r.id,
                messageId: r.messageId,
                recipientType: r.recipientType,
                isRead: r.isRead,
                readAt: r.readAt,
                senderUserId: m.senderUserId,
                senderEmail: m.senderEmail,
                senderDisplay: m.senderDisplay,
                subject: m.subject,
                hasAttachments: m.hasAttachments,
                attachmentCount: m.attachmentCount,
                priority: m.priority,
                source: m.source,
                createdAt: m.createdAt
            };
        });
        return typeof limit === "number" && limit > 0 ? rows.slice(0, limit) : rows;
    }

    /** A sender's sent box. */
    function listSent(who, limit = 10) {
        const rows = messages.filter((m) =>
            (who.userId != null && who.userId !== "" && String(m.senderUserId) === String(who.userId)) ||
            (who.email && normAddr(m.senderEmail) === normAddr(who.email))
        ).sort(byNewest).map((m) => ({
            messageId: m.id,
            senderUserId: m.senderUserId,
            senderEmail: m.senderEmail,
            senderDisplay: m.senderDisplay,
            subject: m.subject,
            hasAttachments: m.hasAttachments,
            attachmentCount: m.attachmentCount,
            priority: m.priority,
            source: m.source,
            createdAt: m.createdAt
        }));
        return typeof limit === "number" && limit > 0 ? rows.slice(0, limit) : rows;
    }

    function listRecipients(messageId) {
        return recipients.filter((r) => r.messageId === Number(messageId))
            .map((r) => ({
                id: r.id,
                recipientUserId: r.recipientUserId,
                recipientEmail: r.recipientEmail,
                recipientType: r.recipientType,
                isRead: r.isRead,
                readAt: r.readAt
            }));
    }

    function listAttachmentsMeta(messageId) {
        return attachments.filter((a) => a.messageId === Number(messageId))
            .map((a) => ({
                id: a.id,
                messageId: a.messageId,
                filename: a.filename,
                mime: a.mime,
                originalSize: a.originalSize,
                compressedSize: a.compressedSize
            }));
    }

    function readAttachment(attachmentId) {
        const a = attachments.find((x) => x.id === Number(attachmentId));
        if (!a) return null;
        return {
            id: a.id,
            messageId: a.messageId,
            filename: a.filename,
            mime: a.mime,
            originalSize: a.originalSize,
            content: open(a.blob)
        };
    }

    function markRead(who, messageId, read = true) {
        let changed = false;
        recipients.forEach((r) => {
            if (r.messageId === Number(messageId) && matchRecipient(r, who)) {
                if (r.isRead !== Boolean(read)) {
                    r.isRead = Boolean(read);
                    r.readAt = read ? Date.now() : null;
                    changed = true;
                }
            }
        });
        return changed;
    }

    function countInbox(who, unreadOnly = false) {
        return recipients.filter((r) => matchRecipient(r, who) && (!unreadOnly || !r.isRead)).length;
    }

    return {
        // writes
        insertMessage,
        insertRecipient,
        insertAttachment,
        // reads
        getMessageMeta,
        readBody,
        listInbox,
        listSent,
        listRecipients,
        listAttachmentsMeta,
        readAttachment,
        markRead,
        countInbox,
        // diagnostics
        totals: () => ({
            messages: messages.length,
            recipients: recipients.length,
            attachments: attachments.length
        }),
        isEmpty: () => messages.length === 0,
        // expose seal/open for tests of the crypto seam
        _seal: seal,
        _open: open
    };
}
