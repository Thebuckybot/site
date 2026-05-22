/**
 * BuckyCode (lite) — the Bucky VM text/code editor.
 *
 * Phase 1 scope: open, edit and save a single file through the shared
 * FileSystemService. No syntax highlighting or tabs yet — the focus is real
 * filesystem interaction (see docs/architecture/app-system.md section 10).
 *
 * Rendering: a single delegated listener lives on the stable `.vm-buckycode`
 * element. Typing patches only the toolbar (dirty indicator) so the caret is
 * never lost; opening another file re-renders the inner content.
 */
import { escapeHtml } from "../core/util.js";
import { logError } from "../core/diagnostics.js";

// ----- State -----------------------------------------------------------------

export function createBuckyCodeState(user, filesystem, payload) {
    const state = { path: null, content: "", savedContent: "", dirty: false };
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

// ----- Rendering -------------------------------------------------------------

function renderToolbar(state) {
    const name = state.path ? state.path.split("/").pop() : "";
    return `
        <div class="vm-code-file">
            <span class="vm-code-dot${state.dirty ? " is-dirty" : ""}"></span>
            <strong>${escapeHtml(name)}</strong>
        </div>
        <button class="vm-code-save" type="button" data-code-save${state.dirty ? "" : " disabled"}>Save</button>
    `;
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
        <textarea class="vm-code-area" spellcheck="false" aria-label="File contents">${escapeHtml(state.content)}</textarea>
        <div class="vm-code-status">${escapeHtml(state.path)}</div>
    `;
}

export function renderBuckyCodeApp(runtime, windowState) {
    return `<div class="vm-buckycode">${renderInner(windowState)}</div>`;
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
        runtime.notify("File saved", state.path);
    } else {
        runtime.notify("Save failed", result.error);
    }
}

// ----- Lifecycle -------------------------------------------------------------

export function mountBuckyCodeApp(runtime, windowState, element) {
    const view = windowState.view;
    view.cleanups = [];
    const appElement = element.querySelector(".vm-buckycode");
    view.appElement = appElement;
    if (!appElement) return;

    view.refreshAll = () => {
        appElement.innerHTML = renderInner(windowState);
    };
    view.refreshToolbar = () => {
        const toolbar = appElement.querySelector("[data-code-toolbar]");
        if (toolbar && windowState.appState.path) {
            toolbar.innerHTML = renderToolbar(windowState.appState);
        }
    };

    appElement.addEventListener("input", (event) => {
        if (!event.target.classList.contains("vm-code-area")) return;
        const state = windowState.appState;
        state.content = event.target.value;
        const dirty = state.content !== state.savedContent;
        if (dirty !== state.dirty) {
            state.dirty = dirty;
            view.refreshToolbar();
        }
    });

    appElement.addEventListener("click", (event) => {
        if (event.target.closest("[data-code-save]")) saveFile(runtime, windowState);
    });

    appElement.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "S")) {
            event.preventDefault();
            saveFile(runtime, windowState);
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
        }
    }));

    view.cleanups.push(runtime.bus.on("fs:node-deleted", (payload) => {
        const state = windowState.appState;
        if (state.path && payload.path === state.path) {
            state.path = null;
            state.content = "";
            state.savedContent = "";
            state.dirty = false;
            view.refreshAll();
        }
    }));
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

/** Load a different file into an already-open BuckyCode window (intent). */
export function applyBuckyCodeIntent(runtime, windowState, payload) {
    if (!payload || !payload.path) return;
    const result = runtime.filesystem.read(payload.path);
    if (!result.ok) {
        runtime.notify("Cannot open", `${payload.path}: ${result.error}`);
        return;
    }
    const state = windowState.appState;
    state.path = runtime.filesystem.normalize(payload.path);
    state.content = result.content;
    state.savedContent = result.content;
    state.dirty = false;
    if (windowState.view && windowState.view.refreshAll) windowState.view.refreshAll();
}
