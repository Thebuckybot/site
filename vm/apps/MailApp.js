/**
 * Mail app — the Bucky Mail Platform desktop client (Phase 5.0).
 *
 * A thin, Outlook-style client over MailService (`runtime.services.mail`). The
 * app holds NO mail data of its own: it reads inbox/sent views, message bodies
 * and attachments from the service, and writes only by calling `send`. It is a
 * single-instance app.
 *
 * Layout (matches the concept reference):
 *   sidebar   New Message · Inbox (unread badge) · Sent · All Messages
 *   list      sender · subject · preview · time · unread dot · attachment clip
 *   reader    sender · recipients · subject · body · attachments
 *   compose   To / Cc / Bcc / Subject / Body / Attachments / Send  (overlay)
 *
 * Rendering follows the VM convention (see FilesApp): the app holds only view
 * state (mailbox, selection, compose draft); a single delegated click listener
 * lives on `.vm-mail-app`; inner content is re-rendered on navigation and on
 * mail:* / fs:* events. Text inputs are never re-rendered mid-typing — the
 * compose draft is snapshotted from the DOM before any structural refresh, so
 * the caret is never lost while writing.
 */
import { escapeHtml } from "../core/util.js";
import { logError } from "../core/diagnostics.js";

const MAIL_EVENTS = ["mail:received", "mail:read", "mail:sent", "mail:updated"];
const LIST_LIMIT = 10;

// ----- State -----------------------------------------------------------------

export function createMailState() {
    return {
        mailbox: "inbox",        // "inbox" | "sent"
        selectedId: null,        // open message id
        openAttachmentId: null,  // attachment expanded inline in the reader
        composing: false,
        compose: emptyCompose()
    };
}

function emptyCompose() {
    return {
        draft: { to: "", cc: "", bcc: "", subject: "", body: "" },
        attachments: [],
        notice: ""
    };
}

function mailService(runtime) {
    return runtime.services && runtime.services.mail ? runtime.services.mail : null;
}

// ----- Time formatting -------------------------------------------------------

function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function formatTime(ts) {
    const today = startOfDay(Date.now());
    const day = startOfDay(ts);
    if (day === today) {
        return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
    }
    if (day === today - 86400000) return "Yesterday";
    return new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(new Date(ts));
}

function dayBucket(ts) {
    const today = startOfDay(Date.now());
    const day = startOfDay(ts);
    if (day === today) return "Today";
    if (day === today - 86400000) return "Yesterday";
    return "Earlier";
}

function avatarGlyph(item) {
    const base = (item.fromDisplay || item.from || "?").trim();
    return escapeHtml(base.slice(0, 1).toUpperCase() || "?");
}

function formatBytes(n) {
    const v = Number(n || 0);
    if (v < 1024) return `${v} B`;
    return `${(v / 1024).toFixed(1)} KB`;
}

// ----- Rendering: sidebar ----------------------------------------------------

function renderSidebar(runtime, state) {
    const svc = mailService(runtime);
    const counts = svc.counts();
    const usedKb = ((svc._storage.totals().messages * 0.14) + 1.28).toFixed(2);
    return `
        <aside class="vm-mail-sidebar">
            <button class="vm-mail-compose-btn" type="button" data-mail-action="compose">
                <span class="vm-mail-compose-ico">✚</span> New Message
            </button>
            <div class="vm-mail-nav-group">
                <div class="vm-mail-nav-label">Folders</div>
                <button class="vm-mail-folder${state.mailbox === "inbox" ? " is-active" : ""}" type="button" data-mail-folder="inbox">
                    <span class="vm-mail-folder-ico">▣</span>
                    <span class="vm-mail-folder-name">Inbox</span>
                    ${counts.inboxUnread ? `<span class="vm-mail-badge">${counts.inboxUnread}</span>` : ""}
                </button>
                <button class="vm-mail-folder${state.mailbox === "sent" ? " is-active" : ""}" type="button" data-mail-folder="sent">
                    <span class="vm-mail-folder-ico">➤</span>
                    <span class="vm-mail-folder-name">Sent</span>
                    ${counts.sentTotal ? `<span class="vm-mail-badge is-muted">${counts.sentTotal}</span>` : ""}
                </button>
            </div>
            <div class="vm-mail-nav-group">
                <div class="vm-mail-nav-label">Account</div>
                <div class="vm-mail-account">
                    <span class="vm-mail-account-ico">◑</span>
                    <span class="vm-mail-account-addr" title="${escapeHtml(svc.identity())}">${escapeHtml(svc.identity())}</span>
                </div>
            </div>
            <div class="vm-mail-storage">
                <div class="vm-mail-storage-label">Mail Storage</div>
                <div class="vm-mail-storage-bar"><span style="width:${Math.min(100, Number(usedKb) / 50 * 100).toFixed(1)}%"></span></div>
                <div class="vm-mail-storage-meta">${usedKb} MB / 50 MB</div>
            </div>
        </aside>
    `;
}

// ----- Rendering: message list ----------------------------------------------

function renderListItems(items, selectedId) {
    if (!items.length) {
        return `<div class="vm-mail-empty"><strong>No messages</strong><span>This folder is empty.</span></div>`;
    }
    let html = "";
    let lastBucket = null;
    items.forEach((item) => {
        const bucket = dayBucket(item.createdAt);
        if (bucket !== lastBucket) {
            html += `<div class="vm-mail-day">${bucket}</div>`;
            lastBucket = bucket;
        }
        const unread = item.isRead ? "" : " is-unread";
        const active = item.messageId === selectedId ? " is-selected" : "";
        const alert = item.priority === "alert" ? " is-alert" : (item.priority === "high" ? " is-high" : "");
        html += `
            <button class="vm-mail-item${unread}${active}${alert}" type="button" data-mail-open="${item.messageId}">
                <span class="vm-mail-item-avatar">${avatarGlyph(item)}</span>
                <span class="vm-mail-item-main">
                    <span class="vm-mail-item-row1">
                        <span class="vm-mail-item-from">${escapeHtml(item.fromDisplay || item.from)}</span>
                        <span class="vm-mail-item-time">${formatTime(item.createdAt)}</span>
                    </span>
                    <span class="vm-mail-item-subject">${escapeHtml(item.subject || "(no subject)")}</span>
                    <span class="vm-mail-item-preview">${escapeHtml(item.preview || "")}</span>
                </span>
                <span class="vm-mail-item-marks">
                    ${item.isRead ? "" : `<span class="vm-mail-dot" title="Unread"></span>`}
                    ${item.hasAttachments ? `<span class="vm-mail-clip" title="${item.attachmentCount} attachment(s)">⎙</span>` : ""}
                </span>
            </button>
        `;
    });
    return html;
}

function renderList(runtime, state) {
    const svc = mailService(runtime);
    const items = state.mailbox === "inbox" ? svc.getInbox(LIST_LIMIT) : svc.getSent(LIST_LIMIT);
    const counts = svc.counts();
    const title = state.mailbox === "inbox" ? "Inbox" : "Sent";
    const totalForBox = state.mailbox === "inbox" ? counts.inboxTotal : counts.sentTotal;
    const shown = Math.min(items.length, LIST_LIMIT);
    return `
        <section class="vm-mail-list">
            <header class="vm-mail-list-head">
                <strong>${title}</strong>
                <span class="vm-mail-list-count">${shown} of ${totalForBox}</span>
            </header>
            <div class="vm-mail-list-scroll">${renderListItems(items, state.selectedId)}</div>
            <footer class="vm-mail-statusbar">
                <span>${counts.inboxTotal} in Inbox · ${counts.sentTotal} Sent</span>
                <span class="vm-mail-conn"><span class="vm-mail-conn-dot"></span>Connected to Bucky Mail Service</span>
            </footer>
        </section>
    `;
}

// ----- Rendering: reader -----------------------------------------------------

function renderReader(runtime, state) {
    const svc = mailService(runtime);
    if (state.selectedId == null) {
        return `
            <section class="vm-mail-reader is-empty">
                <div class="vm-mail-reader-empty">
                    <div class="vm-mail-reader-empty-ico">✉</div>
                    <strong>Select a message to read</strong>
                    <span>Your messages are stored compressed &amp; encrypted.</span>
                </div>
            </section>
        `;
    }
    const msg = svc.openMessage(state.selectedId, { markRead: false });
    if (!msg) {
        return `<section class="vm-mail-reader is-empty"><div class="vm-mail-reader-empty"><strong>Message not found</strong></div></section>`;
    }
    const recipients = [
        msg.to.length ? `To: ${escapeHtml(msg.to.join(", "))}` : "",
        msg.cc.length ? `Cc: ${escapeHtml(msg.cc.join(", "))}` : "",
        msg.bcc && msg.bcc.length ? `Bcc: ${escapeHtml(msg.bcc.join(", "))}` : ""
    ].filter(Boolean).join("<br>");

    const priorityTag = msg.priority === "alert"
        ? `<span class="vm-mail-tag is-alert">ALERT</span>`
        : (msg.priority === "high" ? `<span class="vm-mail-tag is-high">HIGH</span>` : "");

    return `
        <section class="vm-mail-reader">
            <div class="vm-mail-reader-head">
                <div class="vm-mail-reader-subject">${escapeHtml(msg.subject || "(no subject)")} ${priorityTag}</div>
                <div class="vm-mail-reader-sender">
                    <span class="vm-mail-reader-avatar">${avatarGlyph(msg)}</span>
                    <span class="vm-mail-reader-senderinfo">
                        <strong>${escapeHtml(msg.fromDisplay || msg.from)}</strong>
                        <span class="vm-mail-reader-addr">${escapeHtml(msg.from)}</span>
                    </span>
                    <span class="vm-mail-reader-time">${formatTime(msg.createdAt)}</span>
                </div>
                <div class="vm-mail-reader-recipients">${recipients}</div>
            </div>
            <div class="vm-mail-reader-body">${escapeHtml(msg.body).replace(/\n/g, "<br>")}</div>
            ${renderAttachments(msg, state)}
        </section>
    `;
}

function renderAttachments(msg, state) {
    if (!msg.attachments || !msg.attachments.length) return "";
    const chips = msg.attachments.map((a) => {
        const expanded = state.openAttachmentId === a.id;
        return `
            <div class="vm-mail-att${expanded ? " is-open" : ""}">
                <button class="vm-mail-att-chip" type="button" data-mail-att="${a.id}">
                    <span class="vm-mail-att-ico">📄</span>
                    <span class="vm-mail-att-info">
                        <span class="vm-mail-att-name">${escapeHtml(a.filename)}</span>
                        <span class="vm-mail-att-size">${formatBytes(a.originalSize)} · ${escapeHtml(a.mime)}</span>
                    </span>
                    <span class="vm-mail-att-caret">${expanded ? "▾" : "▸"}</span>
                </button>
                ${expanded ? renderAttachmentPreview(a) : ""}
            </div>
        `;
    }).join("");
    return `
        <div class="vm-mail-attachments">
            <div class="vm-mail-attachments-head">Attachments (${msg.attachments.length})</div>
            ${chips}
        </div>
    `;
}

function renderAttachmentPreview(a) {
    const content = a.__content != null ? a.__content : "";
    return `
        <div class="vm-mail-att-preview">
            <div class="vm-mail-att-actions">
                <button class="vm-mail-att-save" type="button" data-mail-att-save="${a.id}">Save to Files</button>
            </div>
            <pre class="vm-mail-att-body">${escapeHtml(content) || "(empty file)"}</pre>
        </div>
    `;
}

// ----- Rendering: compose ----------------------------------------------------

function renderCompose(state) {
    if (!state.composing) return "";
    const d = state.compose.draft;
    const atts = state.compose.attachments;
    const attList = atts.length
        ? `<div class="vm-mail-compose-atts">${atts.map((a, i) => `
                <span class="vm-mail-compose-att">
                    <span>📄 ${escapeHtml(a.filename)} (${formatBytes((a.content || "").length)})</span>
                    <button type="button" data-mail-att-remove="${i}" aria-label="Remove">✕</button>
                </span>`).join("")}</div>`
        : "";
    return `
        <div class="vm-mail-compose-overlay" data-mail-compose-overlay>
            <div class="vm-mail-compose">
                <div class="vm-mail-compose-head">
                    <strong>New Message</strong>
                    <button class="vm-mail-compose-close" type="button" data-mail-action="compose-cancel" aria-label="Close">✕</button>
                </div>
                <div class="vm-mail-compose-fields">
                    <label class="vm-mail-field"><span>To</span><input type="text" data-mail-input="to" value="${escapeHtml(d.to)}" placeholder="name@bucky.net, other@shadownet.mail"></label>
                    <label class="vm-mail-field"><span>Cc</span><input type="text" data-mail-input="cc" value="${escapeHtml(d.cc)}" placeholder="optional"></label>
                    <label class="vm-mail-field"><span>Bcc</span><input type="text" data-mail-input="bcc" value="${escapeHtml(d.bcc)}" placeholder="optional"></label>
                    <label class="vm-mail-field"><span>Subject</span><input type="text" data-mail-input="subject" value="${escapeHtml(d.subject)}" placeholder="Subject"></label>
                    <textarea class="vm-mail-compose-body" data-mail-input="body" placeholder="Write your message…">${escapeHtml(d.body)}</textarea>
                    ${attList}
                    <div class="vm-mail-compose-attach">
                        <input type="text" data-mail-input="attachpath" placeholder="Attach a VM file by path, e.g. /projects/reports/notes.txt">
                        <button type="button" class="vm-mail-attach-btn" data-mail-action="attach">Attach</button>
                    </div>
                    ${state.compose.notice ? `<div class="vm-mail-compose-notice">${escapeHtml(state.compose.notice)}</div>` : ""}
                </div>
                <div class="vm-mail-compose-foot">
                    <button class="vm-mail-send-btn" type="button" data-mail-action="send">Send</button>
                    <button class="vm-mail-cancel-btn" type="button" data-mail-action="compose-cancel">Discard</button>
                </div>
            </div>
        </div>
    `;
}

// ----- Inner render ----------------------------------------------------------

function renderMailInner(runtime, windowState) {
    const svc = mailService(runtime);
    const state = windowState.appState;
    if (!svc) {
        return `<div class="vm-mail-empty"><strong>Mail service unavailable</strong><span>The mail runtime did not initialise.</span></div>`;
    }
    // Drop a selection that no longer exists.
    if (state.selectedId != null && !svc._storage.getMessageMeta(state.selectedId)) {
        state.selectedId = null;
    }
    return `
        ${renderSidebar(runtime, state)}
        ${renderList(runtime, state)}
        ${renderReader(runtime, state)}
        ${renderCompose(state)}
    `;
}

export function renderMailApp(runtime, windowState) {
    return `<div class="vm-mail-app">${renderMailInner(runtime, windowState)}</div>`;
}

// ----- Interaction -----------------------------------------------------------

function snapshotCompose(appElement, state) {
    if (!state.composing) return;
    const get = (name) => {
        const el = appElement.querySelector(`[data-mail-input="${name}"]`);
        return el ? el.value : "";
    };
    state.compose.draft = {
        to: get("to"), cc: get("cc"), bcc: get("bcc"),
        subject: get("subject"), body: get("body")
    };
}

function handleClick(runtime, windowState, event) {
    const svc = mailService(runtime);
    if (!svc) return;
    const state = windowState.appState;
    const appElement = windowState.view.appElement;
    const refresh = () => windowState.view.refresh();

    // Folder switch
    const folder = event.target.closest("[data-mail-folder]");
    if (folder) {
        state.mailbox = folder.dataset.mailFolder;
        state.selectedId = null;
        state.openAttachmentId = null;
        refresh();
        return;
    }

    // Generic actions (compose open/cancel/send/attach)
    const action = event.target.closest("[data-mail-action]");
    if (action) {
        const name = action.dataset.mailAction;
        if (name === "compose") { state.composing = true; state.compose = emptyCompose(); refresh(); return; }
        if (name === "compose-cancel") { state.composing = false; state.compose = emptyCompose(); refresh(); return; }
        if (name === "attach") { doAttach(runtime, windowState); return; }
        if (name === "send") { doSend(runtime, windowState); return; }
    }

    // Dismiss compose by clicking the dimmed backdrop (not the panel).
    if (event.target.matches("[data-mail-compose-overlay]")) {
        snapshotCompose(appElement, state);
        // Only close on backdrop click if nothing typed, to avoid losing a draft.
        const d = state.compose.draft;
        if (!d.to && !d.cc && !d.bcc && !d.subject && !d.body && !state.compose.attachments.length) {
            state.composing = false; refresh();
        }
        return;
    }

    // Remove a compose attachment
    const removeAtt = event.target.closest("[data-mail-att-remove]");
    if (removeAtt) {
        snapshotCompose(appElement, state);
        const idx = Number(removeAtt.dataset.mailAttRemove);
        state.compose.attachments.splice(idx, 1);
        refresh();
        return;
    }

    // Open a message
    const open = event.target.closest("[data-mail-open]");
    if (open) {
        const id = Number(open.dataset.mailOpen);
        state.selectedId = id;
        state.openAttachmentId = null;
        svc.openMessage(id); // marks read + emits mail:read (refreshes via event)
        refresh();
        return;
    }

    // Toggle an attachment preview in the reader
    const att = event.target.closest("[data-mail-att]");
    if (att) {
        const id = Number(att.dataset.mailAtt);
        state.openAttachmentId = state.openAttachmentId === id ? null : id;
        refresh();
        return;
    }

    // Save an attachment to the VFS
    const save = event.target.closest("[data-mail-att-save]");
    if (save) {
        const id = Number(save.dataset.mailAttSave);
        const result = svc.saveAttachment(id);
        if (result && result.ok) runtime.notify("Attachment saved", result.path);
        else runtime.notify("Save failed", (result && result.error) || "unknown error");
        return;
    }
}

function doAttach(runtime, windowState) {
    const state = windowState.appState;
    const appElement = windowState.view.appElement;
    snapshotCompose(appElement, state);
    const pathEl = appElement.querySelector('[data-mail-input="attachpath"]');
    const path = pathEl ? pathEl.value.trim() : "";
    if (!path) { state.compose.notice = "Enter a file path to attach."; windowState.view.refresh(); return; }
    const read = runtime.filesystem.read(path);
    if (!read.ok) {
        state.compose.notice = `Cannot attach '${path}': ${read.error}`;
        windowState.view.refresh();
        return;
    }
    const name = path.split("/").pop();
    const stat = runtime.filesystem.stat(path);
    state.compose.attachments.push({
        filename: name,
        mime: (stat && stat.node && stat.node.mime) || "text/plain",
        content: read.content
    });
    state.compose.notice = "";
    windowState.view.refresh();
}

function doSend(runtime, windowState) {
    const svc = mailService(runtime);
    const state = windowState.appState;
    const appElement = windowState.view.appElement;
    snapshotCompose(appElement, state);
    const d = state.compose.draft;
    const result = svc.send({
        to: d.to, cc: d.cc, bcc: d.bcc,
        subject: d.subject || "(no subject)",
        body: d.body,
        attachments: state.compose.attachments
    });
    if (!result.ok) {
        state.compose.notice = result.error || "Could not send.";
        windowState.view.refresh();
        return;
    }
    runtime.notify("Message sent", `To ${d.to || d.cc || d.bcc}`);
    state.composing = false;
    state.compose = emptyCompose();
    state.mailbox = "sent";
    state.selectedId = result.messageId;
    windowState.view.refresh();
}

// ----- Lifecycle -------------------------------------------------------------

export function mountMailApp(runtime, windowState, element) {
    const view = windowState.view;
    view.cleanups = [];
    const appElement = element.querySelector(".vm-mail-app");
    view.appElement = appElement;
    if (!appElement) return;

    view.refresh = () => {
        // Hydrate decrypted attachment content for an expanded reader chip so
        // the render stays a pure string build (no async in render).
        const svc = mailService(runtime);
        const state = windowState.appState;
        if (svc && state.openAttachmentId != null) {
            const att = svc.getAttachment(state.openAttachmentId);
            view._attCache = att ? { id: att.id, content: att.content } : null;
        } else {
            view._attCache = null;
        }
        appElement.innerHTML = renderMailInner(runtime, windowState);
        // Inject the decrypted attachment content into the just-rendered chip.
        if (view._attCache) {
            const body = appElement.querySelector(".vm-mail-att.is-open .vm-mail-att-body");
            if (body) body.textContent = view._attCache.content || "(empty file)";
        }
    };

    appElement.addEventListener("click", (event) => {
        try { handleClick(runtime, windowState, event); }
        catch (error) { logError("Mail click", error); }
    });

    // Live updates: re-render when mail state changes. Skip refresh while the
    // user is mid-typing in compose to avoid disturbing the caret (the compose
    // overlay is unaffected by background mail events anyway).
    const onMailChange = () => {
        if (windowState.appState.composing) return;
        view.refresh();
    };
    MAIL_EVENTS.forEach((name) => view.cleanups.push(runtime.bus.on(name, onMailChange)));
}

export function unmountMailApp(runtime, windowState) {
    (windowState.view.cleanups || []).forEach((cleanup) => {
        try { cleanup(); } catch (error) { logError("Mail cleanup", error); }
    });
}
