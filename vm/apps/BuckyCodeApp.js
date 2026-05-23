/**
 * BuckyCode (lite) — the Bucky VM text/code editor.
 *
 * Phase 1 scope: open, edit and save a single file through the shared
 * FileSystemService, plus a markdown preview mode. No syntax highlighting or
 * tabs yet — the focus is reliable filesystem interaction (see
 * docs/architecture/app-system.md section 10).
 *
 * Multi-instance: BuckyCode windows are independent, so several files can be
 * edited side by side. `matchBuckyCodeWindow` lets the launch flow focus an
 * existing window when the same file is opened again instead of spawning a
 * duplicate (see vmRuntime.findReusableWindow).
 *
 * Rendering: a single delegated listener lives on the stable `.vm-buckycode`
 * element. Typing patches only the toolbar (dirty indicator) so the caret is
 * never lost; the editor body (`[data-code-main]`) is rebuilt only on a
 * structural change — opening another file, or toggling markdown preview.
 * None of this ever triggers a VM-wide rerender.
 */
import { escapeHtml } from "../core/util.js";
import { logError } from "../core/diagnostics.js";
import { renderMarkdown, isMarkdownName } from "../core/markdown.js";

const INDENT = "  ";

// ----- State -----------------------------------------------------------------

export function createBuckyCodeState(user, filesystem, payload) {
    const state = { path: null, content: "", savedContent: "", dirty: false, preview: false };
    if (payload && payload.path) {
        const result = filesystem.read(payload.path);
        if (result.ok) {
            state.path = filesystem.normalize(payload.path);
            state.content = result.content;
            state.savedContent = result.content;
        }
    }
    return state;
}

/** Filename of the open buffer, or "" when no file is open. */
function fileName(state) {
    return state.path ? state.path.split("/").pop() : "";
}

/** True when the open buffer is a markdown document. */
function isMarkdownState(state) {
    return Boolean(state.path) && isMarkdownName(fileName(state));
}

/**
 * Launch-flow hook: report whether this BuckyCode window already holds the
 * file the launch is targeting, so the runtime can focus it instead of
 * opening a duplicate window.
 */
export function matchBuckyCodeWindow(runtime, windowState, payload) {
    if (!payload || !payload.path) return false;
    const state = windowState.appState;
    if (!state || !state.path) return false;
    return state.path === runtime.filesystem.normalize(payload.path);
}

// ----- Rendering -------------------------------------------------------------

function renderToolbar(state) {
    const markdown = isMarkdownState(state);
    const previewToggle = markdown
        ? `<button class="vm-code-preview-toggle${state.preview ? " is-active" : ""}" type="button"
                   data-code-preview>${state.preview ? "Edit" : "Preview"}</button>`
        : "";
    return `
        <div class="vm-code-file">
            <span class="vm-code-dot${state.dirty ? " is-dirty" : ""}"></span>
            <strong>${escapeHtml(fileName(state))}</strong>
            <span class="vm-code-state${state.dirty ? " is-dirty" : ""}">${state.dirty ? "unsaved changes" : "all changes saved"}</span>
        </div>
        <div class="vm-code-actions">
            ${previewToggle}
            <button class="vm-code-save" type="button" data-code-save${state.dirty ? "" : " disabled"}>${state.dirty ? "Save" : "Saved"}</button>
        </div>
    `;
}

/** Render the editor body — the markdown preview, or the editable textarea. */
function renderMain(state) {
    if (state.preview && isMarkdownState(state)) {
        return `<div class="vm-code-preview" data-code-preview-body>${renderMarkdown(state.content)}</div>`;
    }
    return `<textarea class="vm-code-area" spellcheck="false" aria-label="File contents">${escapeHtml(state.content)}</textarea>`;
}

function renderInner(windowState) {
    const state = windowState.appState;
    if (!state.path) {
        return `
            <div class="vm-code-empty">
                <strong>No file open</strong>
                <span>Open a file from the Files app, or run "edit &lt;file&gt;" in the terminal.</span>
            </div>
        `;
    }
    return `
        <div class="vm-code-toolbar" data-code-toolbar>${renderToolbar(state)}</div>
        <div class="vm-code-main" data-code-main>${renderMain(state)}</div>
        <div class="vm-code-status">${escapeHtml(state.path)}</div>
    `;
}

export function renderBuckyCodeApp(runtime, windowState) {
    return `<div class="vm-buckycode">${renderInner(windowState)}</div>`;
}

// ----- Helpers ---------------------------------------------------------------

/** Reflect the open file (and its dirty state) in the window title. */
function syncWindowTitle(runtime, windowState) {
    const state = windowState.appState;
    const title = state.path
        ? `${fileName(state)}${state.dirty ? " ●" : ""}`
        : "BuckyCode";
    runtime.setWindowTitle(windowState.id, title);
}

/** Apply edited content to state, updating the dirty indicator + title. */
function applyContent(runtime, windowState, content) {
    const state = windowState.appState;
    state.content = content;
    const dirty = state.content !== state.savedContent;
    if (dirty !== state.dirty) {
        state.dirty = dirty;
        if (windowState.view.refreshToolbar) windowState.view.refreshToolbar();
        syncWindowTitle(runtime, windowState);
    }
}

/** Focus the editor textarea, if one is mounted (no-op in preview mode). */
function focusEditor(windowState) {
    const appElement = windowState.view && windowState.view.appElement;
    const area = appElement && appElement.querySelector(".vm-code-area");
    if (area) area.focus({ preventScroll: true });
}

// ----- Actions ---------------------------------------------------------------

function saveFile(runtime, windowState) {
    const state = windowState.appState;
    if (!state.path || !state.dirty) return;

    const result = runtime.filesystem.write(state.path, state.content, {
        owner: "buckycode",
        source: "save",
        create: true
    });

    if (result.ok) {
        state.savedContent = state.content;
        state.dirty = false;
        if (windowState.view.refreshToolbar) windowState.view.refreshToolbar();
        syncWindowTitle(runtime, windowState);
        runtime.notify("Saved", fileName(state));
    } else {
        runtime.notify("Save failed", result.error);
    }
}

/** Insert an indent at the caret (Tab key) and keep state in sync. */
function indentSelection(runtime, windowState, textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = textarea.value.slice(0, start) + INDENT + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + INDENT.length;
    applyContent(runtime, windowState, textarea.value);
}

/** Toggle markdown preview / edit mode for the open buffer. */
function togglePreview(runtime, windowState) {
    const state = windowState.appState;
    if (!isMarkdownState(state)) return;
    state.preview = !state.preview;
    if (windowState.view.refreshToolbar) windowState.view.refreshToolbar();
    if (windowState.view.refreshMain) windowState.view.refreshMain();
    if (!state.preview) focusEditor(windowState);
}

// ----- Lifecycle -------------------------------------------------------------

export function mountBuckyCodeApp(runtime, windowState, element) {
    const view = windowState.view;
    view.cleanups = [];
    const appElement = element.querySelector(".vm-buckycode");
    view.appElement = appElement;
    if (!appElement) return;

    // Rebuild the whole app body (used when the open file changes).
    view.refreshAll = () => {
        appElement.innerHTML = renderInner(windowState);
    };
    // Rebuild only the toolbar — caret in the textarea is untouched.
    view.refreshToolbar = () => {
        const toolbar = appElement.querySelector("[data-code-toolbar]");
        if (toolbar && windowState.appState.path) {
            toolbar.innerHTML = renderToolbar(windowState.appState);
        }
    };
    // Rebuild only the editor body — used when toggling markdown preview.
    view.refreshMain = () => {
        const main = appElement.querySelector("[data-code-main]");
        if (main && windowState.appState.path) {
            main.innerHTML = renderMain(windowState.appState);
        }
    };

    appElement.addEventListener("input", (event) => {
        if (!event.target.classList.contains("vm-code-area")) return;
        applyContent(runtime, windowState, event.target.value);
    });

    appElement.addEventListener("click", (event) => {
        if (event.target.closest("[data-code-save]")) {
            saveFile(runtime, windowState);
        } else if (event.target.closest("[data-code-preview]")) {
            togglePreview(runtime, windowState);
        }
    });

    appElement.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "S")) {
            event.preventDefault();
            saveFile(runtime, windowState);
            return;
        }
        if (event.key === "Tab" && event.target.classList.contains("vm-code-area")) {
            event.preventDefault();
            indentSelection(runtime, windowState, event.target);
        }
    });

    // Reflect external changes to the open file when there are no local edits.
    view.cleanups.push(runtime.bus.on("fs:node-updated", (payload) => {
        const state = windowState.appState;
        if (!state.path || payload.path !== state.path || state.dirty) return;
        const incoming = payload.node ? payload.node.content : null;
        if (incoming != null && incoming !== state.content) {
            state.content = incoming;
            state.savedContent = incoming;
            view.refreshAll();
            syncWindowTitle(runtime, windowState);
        }
    }));

    view.cleanups.push(runtime.bus.on("fs:node-deleted", (payload) => {
        const state = windowState.appState;
        if (state.path && payload.path === state.path) {
            state.path = null;
            state.content = "";
            state.savedContent = "";
            state.dirty = false;
            state.preview = false;
            view.refreshAll();
            syncWindowTitle(runtime, windowState);
        }
    }));

    syncWindowTitle(runtime, windowState);
    if (runtime.activeWindowId === windowState.id) focusEditor(windowState);
}

export function unmountBuckyCodeApp(runtime, windowState) {
    (windowState.view.cleanups || []).forEach((cleanup) => {
        try {
            cleanup();
        } catch (error) {
            logError("BuckyCode cleanup", error);
        }
    });
}

export function focusBuckyCodeApp(runtime, windowState) {
    if (!windowState.minimized) focusEditor(windowState);
}

/**
 * Load a different file into an already-open BuckyCode window (intent).
 *
 * Reopening the SAME file is a no-op beyond refocusing — it must never reload
 * the buffer, which would silently discard unsaved edits. Because BuckyCode
 * windows are de-duplicated by path (matchBuckyCodeWindow), the runtime only
 * routes a same-path intent here, so in practice this is the refocus path.
 */
export function applyBuckyCodeIntent(runtime, windowState, payload) {
    if (!payload || !payload.path) return;
    const state = windowState.appState;
    const target = runtime.filesystem.normalize(payload.path);

    if (state.path === target) {
        focusEditor(windowState);
        return;
    }

    const result = runtime.filesystem.read(target);
    if (!result.ok) {
        runtime.notify("Cannot open", `${payload.path}: ${result.error}`);
        return;
    }
    state.path = target;
    state.content = result.content;
    state.savedContent = result.content;
    state.dirty = false;
    state.preview = false;
    if (windowState.view && windowState.view.refreshAll) {
        windowState.view.refreshAll();
        focusEditor(windowState);
    }
    syncWindowTitle(runtime, windowState);
}
