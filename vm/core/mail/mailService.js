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

    // Phase 5.0A — backend gateway (optional). When present AND the operator is
    // authenticated, the service runs in ONLINE mode: mailboxes are mirrored
    // from the real backend (api/vm/mail/*) and sends are POSTed there, which is
    // what makes cross-user (multiplayer) delivery work. With no gateway / no
    // token (GitHub Pages, offline), it stays in OFFLINE mode over the local
    // encrypted store seeded with authored demo mail — the existing behaviour.
    const gateway = options.gateway || null;
    const _remote = { inbox: [], sent: [], counts: null, bodies: new Map(), hydrated: false };

    function online() {
        return Boolean(gateway && typeof gateway.hasAuthToken === "function" && gateway.hasAuthToken());
    }

    function emit(name, payload) {
        if (bus && typeof bus.emit === "function") bus.emit(name, payload || {});
    }

    // ----- Backend view mappers (backend JSON -> the app's view shapes) ------
    function toMs(value) {
        if (value == null) return Date.now();
        const t = Date.parse(value);
        return Number.isNaN(t) ? Date.now() : t;
    }
    function mapInboxItem(m) {
        return {
            messageId: m.message_id,
            from: m.from_email,
            fromDisplay: m.from_display || MailAddress.localPart(m.from_email) || m.from_email,
            subject: m.subject || "",
            preview: m.preview || "",
            isRead: Boolean(m.is_read),
            hasAttachments: Boolean(m.has_attachments),
            attachmentCount: Number(m.attachment_count || 0),
            priority: m.priority || "normal",
            recipientType: m.recipient_type || "TO",
            createdAt: toMs(m.created_at)
        };
    }
    function mapSentItem(m) {
        return {
            messageId: m.message_id,
            from: m.from_email,
            fromDisplay: operator.display,
            to: Array.isArray(m.to) ? m.to : [],
            subject: m.subject || "",
            preview: m.preview || "",
            isRead: true,
            hasAttachments: Boolean(m.has_attachments),
            attachmentCount: Number(m.attachment_count || 0),
            priority: m.priority || "normal",
            createdAt: toMs(m.created_at)
        };
    }
    function mapFullMessage(m) {
        return {
            id: m.id,
            mailbox: MailAddress.normalize(m.sender_email) === MailAddress.normalize(operator.address) ? "sent" : "inbox",
            from: m.sender_email,
            fromDisplay: m.sender_display || MailAddress.localPart(m.sender_email) || m.sender_email,
            to: Array.isArray(m.to) ? m.to : [],
            cc: Array.isArray(m.cc) ? m.cc : [],
            bcc: [],
            subject: m.subject || "",
            body: m.body || "",
            attachments: (m.attachments || []).map((a) => ({
                id: a.id, filename: a.filename, mime: a.mime_type || a.mime || "text/plain",
                originalSize: a.original_size != null ? a.original_size : a.originalSize
            })),
            priority: m.priority || "normal",
            source: m.source,
            isRead: true,
            createdAt: toMs(m.created_at)
        };
    }
    function recomputeRemoteCounts() {
        _remote.counts = {
            inboxTotal: _remote.inbox.length,
            inboxUnread: _remote.inbox.filter((m) => !m.isRead).length,
            sentTotal: _remote.sent.length,
            total: _remote.inbox.length + _remote.sent.length
        };
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
        if (online() && _remote.counts) return { ..._remote.counts };
        return {
            inboxTotal: storage.countInbox(who, false),
            inboxUnread: storage.countInbox(who, true),
            sentTotal: storage.listSent(who, 0).length,
            total: storage.totals().messages
        };
    }

    function getInbox(limit = 10) {
        if (online()) {
            const rows = _remote.inbox;
            return typeof limit === "number" && limit > 0 ? rows.slice(0, limit) : rows.slice();
        }
        return storage.listInbox(who, limit).map(inboxView);
    }

    function getSent(limit = 10) {
        if (online()) {
            const rows = _remote.sent;
            return typeof limit === "number" && limit > 0 ? rows.slice(0, limit) : rows.slice();
        }
        return storage.listSent(who, limit).map(sentView);
    }

    /** Full message for the reader. Marks the operator's copy read by default. */
    function openMessage(messageId, opts = {}) {
        // ONLINE: render from the backend body cache (populated by openRemote()).
        // Return a lightweight placeholder until the async load resolves so the
        // reader never blocks.
        if (online()) {
            const cached = _remote.bodies.get(Number(messageId));
            if (cached) return cached;
            const item = _remote.inbox.concat(_remote.sent).find((m) => Number(m.messageId) === Number(messageId));
            return item ? {
                id: Number(messageId), mailbox: "inbox", from: item.from, fromDisplay: item.fromDisplay,
                to: [], cc: [], bcc: [], subject: item.subject, body: "Loading…",
                attachments: [], priority: item.priority, source: "", isRead: true, createdAt: item.createdAt
            } : null;
        }
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

    // ----- ONLINE (backend-backed) operations --------------------------------
    // These async methods are what the app uses when the operator is
    // authenticated; they mirror the real backend (multiplayer). Each falls back
    // to the synchronous local path when offline, so a single app code path
    // works in both modes.

    /** Pull inbox + sent from the backend into the remote cache. */
    async function hydrate() {
        if (!online()) return { ok: false, offline: true };
        try {
            const [inboxRes, sentRes] = await Promise.all([
                gateway.fetchMailInbox(operator.address),
                gateway.fetchMailSent(operator.address)
            ]);
            if (inboxRes && inboxRes.ok && inboxRes.data) {
                _remote.inbox = (inboxRes.data.messages || []).map(mapInboxItem);
            }
            if (sentRes && sentRes.ok && sentRes.data) {
                _remote.sent = (sentRes.data.messages || []).map(mapSentItem);
            }
            _remote.hydrated = true;
            recomputeRemoteCounts();
            emit("mail:updated", {});
            return { ok: true, available: Boolean(inboxRes && inboxRes.data && inboxRes.data.available) };
        } catch (_e) {
            return { ok: false, error: "hydrate failed" };
        }
    }

    /** Fetch one message's full body+attachments from the backend; mark read. */
    async function openRemote(messageId) {
        if (!online()) return openMessage(messageId);
        try {
            const res = await gateway.fetchMailMessage(messageId, operator.address);
            if (!res || !res.ok || !res.data || !res.data.message) return null;
            const view = mapFullMessage(res.data.message);
            _remote.bodies.set(Number(messageId), view);
            const item = _remote.inbox.find((m) => Number(m.messageId) === Number(messageId));
            if (item && !item.isRead) { item.isRead = true; recomputeRemoteCounts(); }
            emit("mail:read", { messageId });
            emit("mail:updated", {});
            return view;
        } catch (_e) {
            return null;
        }
    }

    /** Compose + send. ONLINE -> POST to backend (cross-user) + re-hydrate. */
    async function submit(payload = {}) {
        if (!online()) return send(payload);
        const to = MailAddress.splitList(payload.to);
        const cc = MailAddress.splitList(payload.cc);
        const bcc = MailAddress.splitList(payload.bcc);
        if (!to.length && !cc.length && !bcc.length) {
            return { ok: false, messageId: null, error: "at least one recipient is required" };
        }
        const body = {
            sender_email: operator.address,
            sender_display: operator.display,
            address: operator.address,
            subject: payload.subject || "(no subject)",
            body: payload.body || "",
            to, cc, bcc,
            attachments: (Array.isArray(payload.attachments) ? payload.attachments : []).map((a) => ({
                filename: a.filename, mime_type: a.mime || a.mime_type || "text/plain", content: a.content || ""
            })),
            priority: payload.priority || "normal"
        };
        try {
            const res = await gateway.sendMail(body);
            if (res && res.ok && res.data && res.data.ok) {
                emit("mail:sent", { messageId: res.data.message_id });
                await hydrate();
                return { ok: true, messageId: res.data.message_id, error: null };
            }
            return { ok: false, messageId: null, error: (res && res.error) || (res && res.data && res.data.error) || "send failed" };
        } catch (_e) {
            return { ok: false, messageId: null, error: "send failed" };
        }
    }

    /** Mark a backend message unread (online) or local (offline). */
    async function markUnreadRemote(messageId) {
        if (!online()) return markUnread(messageId);
        try {
            await gateway.markMailRead(messageId, false, operator.address);
            const item = _remote.inbox.find((m) => Number(m.messageId) === Number(messageId));
            if (item) { item.isRead = false; recomputeRemoteCounts(); }
            const cached = _remote.bodies.get(Number(messageId));
            if (cached) cached.isRead = false;
            emit("mail:updated", {});
            return true;
        } catch (_e) { return false; }
    }

    /** Fetch a decrypted attachment from the backend (online) or local (offline). */
    async function getAttachmentRemote(attachmentId) {
        if (!online()) return getAttachment(attachmentId);
        try {
            const res = await gateway.fetchMailAttachment(attachmentId);
            if (res && res.ok && res.data && res.data.attachment) {
                const a = res.data.attachment;
                return { id: a.id, filename: a.filename, mime: a.mime_type || "text/plain", content: a.content || "" };
            }
            return null;
        } catch (_e) { return null; }
    }

    /** Save an attachment to the VFS. ONLINE fetches then writes; OFFLINE materialises locally. */
    async function saveAttachmentToVfs(attachmentId, opts = {}) {
        if (!online()) return saveAttachment(attachmentId, opts);
        const att = await getAttachmentRemote(attachmentId);
        if (!att) return { ok: false, error: "attachment not found" };
        if (!filesystem) return { ok: false, error: "no filesystem available" };
        const dir = opts.dir || "/mail/attachments";
        if (!filesystem.isDir(dir)) {
            const made = filesystem.mkdir(dir, { recursive: true, owner: "mail", source: "mail" });
            if (made && made.ok === false) return { ok: false, error: made.error };
        }
        const safe = String(att.filename || ("attachment_" + attachmentId + ".txt")).replace(/[\\/]+/g, "_");
        const path = `${dir}/${safe}`;
        const result = filesystem.write(path, att.content, { create: true, owner: "mail", source: "mail:attachment" });
        if (result && result.ok === false) return { ok: false, error: result.error };
        return { ok: true, path };
    }

    // Offline mode seeds the authored demo mailbox; online mode mirrors the
    // backend (no seed) and hydrates on first app open.
    if (!online()) seedIfEmpty();

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
        // Phase 5.0A — online (backend / multiplayer) operations
        online,
        hydrate,
        openRemote,
        submit,
        markUnreadRemote,
        getAttachmentRemote,
        saveAttachmentToVfs,
        // diagnostics / tests
        _storage: storage,
        _remote
    };
}
