/**
 * MailAttachmentService — attachments + filesystem materialisation (Phase 5.0).
 *
 * A thin facade over MailStorage for attachment-specific operations, plus the
 * bridge from the inbox into the VM filesystem. Attachments support txt, json,
 * csv, reports and future custom VM files. Workflow:
 *
 *     upload  -> compress -> encrypt -> store        (MailStorage.insertAttachment)
 *     open    -> load -> decrypt -> decompress -> preview
 *     save    -> materialise into /mail/attachments/<name>  (a real VFS file)
 *
 * Materialising an attachment writes it through FileSystemService, so it
 * becomes a first-class file other apps and tools (Files, BuckyCode, terminal)
 * can use — the same `fs:node-created` event the rest of the VM reacts to.
 *
 * DOM-free. Constructed with the shared MailStorage and FileSystemService.
 */

const DEFAULT_DIR = "/mail/attachments";

export function createMailAttachmentService(storage, filesystem) {
    /** Persist a new attachment payload (sealed by the storage layer). */
    function store({ messageId, filename, mime, content }) {
        return storage.insertAttachment({ messageId, filename, mime, content });
    }

    /** Attachment metadata for a message (no payload) — for the reader's chips. */
    function listFor(messageId) {
        return storage.listAttachmentsMeta(messageId);
    }

    /** Open one attachment: returns { id, filename, mime, content } decrypted. */
    function open(attachmentId) {
        return storage.readAttachment(attachmentId);
    }

    /**
     * Materialise an attachment into the VFS at `<dir>/<filename>` (default
     * /mail/attachments). Creates the directory if needed and writes through
     * FileSystemService (emitting fs:node-created). Returns { ok, path, error }.
     */
    function materialize(attachmentId, options = {}) {
        const att = storage.readAttachment(attachmentId);
        if (!att) return { ok: false, error: "attachment not found" };
        if (!filesystem) return { ok: false, error: "no filesystem available" };

        const dir = options.dir || DEFAULT_DIR;
        if (!filesystem.isDir(dir)) {
            const made = filesystem.mkdir(dir, { recursive: true, owner: "mail", source: "mail" });
            if (made && made.ok === false) return { ok: false, error: made.error };
        }

        const safeName = sanitizeName(att.filename, attachmentId);
        const path = `${dir}/${safeName}`;
        const result = filesystem.write(path, att.content, {
            create: true,
            owner: "mail",
            source: "mail:attachment"
        });
        if (result && result.ok === false) return { ok: false, error: result.error };
        return { ok: true, path };
    }

    return { store, listFor, open, materialize, DEFAULT_DIR };
}

/** Keep a filename safe for the VFS; fall back to a generic name. */
function sanitizeName(name, id) {
    const cleaned = String(name || "").replace(/[\\/]+/g, "_").trim();
    return cleaned || `attachment_${id}.txt`;
}
