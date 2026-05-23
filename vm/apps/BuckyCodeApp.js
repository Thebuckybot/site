/**
 * BuckyCode — the Bucky VM text/code editor and lightweight dev environment.
 *
 * Phase 2A scope: open / edit / save files through the shared filesystem,
 * markdown preview, syntax highlighting, and running script files through the
 * simulated execution layer.
 *
 * Editing surface — the highlight overlay:
 *   A transparent <textarea> sits over a <pre> that shows the syntax-
 *   highlighted text. The textarea is the single source of truth and is NEVER
 *   rebuilt while editing, so caret, selection, focus and scroll are always
 *   preserved. A keystroke only re-paints the <pre> behind it (a sub-region
 *   update) — never a VM-wide rerender. This is the same targeted-rendering
 *   discipline the rest of the runtime follows.
 *
 * Running scripts:
 *   For script-capable files (.py) a Run button executes the file through
 *   core/execution.js — a sandboxed simulated runtime, no real code execution
 *   — and shows the result in an output panel. The panel is its own region,
 *   so showing/clearing output never disturbs the editor's caret.
 *
 * Multi-instance: BuckyCode windows are independent; `matchBuckyCodeWindow`
 * lets the launch flow focus an existing window for a file already open.
 */
import { escapeHtml } from "../core/util.js";
import { logError } from "../core/diagnostics.js";
import { renderMarkdown, isMarkdownName } from "../core/markdown.js";
import { highlight, languageForName } from "../core/highlight.js";
import { executeFile, isRunnable, runtimeLabel } from "../core/execution.js";

const INDENT = "  ";

// ----- State -----------------------------------------------------------------

export function createBuckyCodeState(user, filesystem, payload) {
    const state = {
        path: null,
        content: "",
        savedContent: "",
        dirty: false,
        preview: false,
        output: null
    };
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

function fileName(state) {
    return state.path ? state.path.split("/").pop() : "";
}

function isMarkdownState(state) {
    return Boolean(state.path) && isMarkdownName(fileName(state));
}

function isRunnableState(state) {
    return Boolean(state.path) && isRunnable(fileName(state));
}

/**
 * Launch-flow hook: report whether this window already holds the file the
 * launch targets, so the runtime focuses it instead of opening a duplicate.
 */
export function matchBuckyCodeWindow(runtime, windowState, payload) {
    if (!payload || !payload.path) return false;
    const state = windowState.appState;
    if (!state || !state.path) return false;
    return state.path === runtime.filesystem.normalize(payload.path);
}

// ----- Rendering -------------------------------------------------------------

function renderToolbar(state) {
    const runBtn = isRunnableState(state)
        ? `<button class="vm-code-run" type="button" data-code-run title="Run (Ctrl+Enter)">&#9654; Run</button>`
        : "";
    const previewToggle = isMarkdownState(state)
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
            ${runBtn}
            ${previewToggle}
            <button class="vm-code-save" type="button" data-code-save${state.dirty ? "" : " disabled"}>${state.dirty ? "Save" : "Saved"}</button>
        </div>
    `;
}

/**
 * The editor: an empty highlight <pre> + an empty <textarea>. Both are filled
 * by hydrateEditor() in JS — never via template text — so a file whose first
 * character is a newline is not mangled by the parser's leading-newline rule,
 * and the overlay stays pixel-aligned with the textarea.
 */
function renderEditor() {
    return `
        <div class="vm-code-editor" data-code-editor>
            <pre class="vm-code-highlight" aria-hidden="true"></pre>
            <textarea class="vm-code-area" data-code-area wrap="off" spellcheck="false"
                      autocomplete="off" autocapitalize="off" aria-label="File contents"></textarea>
        </div>
    `;
}

function renderWorkarea(state) {
    if (state.preview && isMarkdownState(state)) {
        return `<div class="vm-code-preview" data-code-preview-body>${renderMarkdown(state.content)}</div>`;
    }
    return renderEditor();
}

function renderOutputPanel(state) {
    const out = state.output;
    if (!out) return "";
    const lines = (out.lines || []).map((line) =>
        escapeHtml(line) || "&nbsp;");
    if (out.error) {
        lines.push(`<span class="vm-code-output-error">${escapeHtml(out.error)}</span>`);
    }
    if (!lines.length) {
        lines.push(`<span class="vm-code-output-dim">(no output)</span>`);
    }
    return `
        <div class="vm-code-output${out.error ? " is-error" : " is-ok"}">
            <div class="vm-code-output-head">
                <span>OUTPUT · ${escapeHtml(runtimeLabel(out.runtime))}</span>
                <button class="vm-code-output-clear" type="button" data-code-output-clear>Clear</button>
            </div>
            <pre class="vm-code-output-body">${lines.join("\n")}</pre>
        </div>
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
        <div class="vm-code-main" data-code-main>
            <div class="vm-code-workarea" data-code-workarea>${renderWorkarea(state)}</div>
            <div class="vm-code-outwrap" data-code-outwrap>${renderOutputPanel(state)}</div>
        </div>
        <div class="vm-code-status">${escapeHtml(state.path)}</div>
    `;
}

export function renderBuckyCodeApp(runtime, windowState) {
    return `<div class="vm-buckycode">${renderInner(windowState)}</div>`;
}

// ----- Helpers ---------------------------------------------------------------

function syncWindowTitle(runtime, windowState) {
    const state = windowState.appState;
    const title = state.path ? `${fileName(state)}${state.dirty ? " ●" : ""}` : "BuckyCode";
    runtime.setWindowTitle(windowState.id, title);
}

function applyContent(runtime, windowState, content) {
    const state = windowState.appState;
    state.content = content;
    // Re-paint the highlight overlay only — the textarea is untouched, so the
    // caret, selection and scroll position all survive the keystroke.
    if (windowState.view.refreshHighlight) windowState.view.refreshHighlight();
    const dirty = state.content !== state.savedContent;
    if (dirty !== state.dirty) {
        state.dirty = dirty;
        if (windowState.view.refreshToolbar) windowState.view.refreshToolbar();
        syncWindowTitle(runtime, windowState);
    }
}

function focusEditor(windowState) {
    const appElement = windowState.view && windowState.view.appElement;
    const area = appElement && appElement.querySelector(".vm-code-area");
    if (area) area.focus({ preventScroll: true });
}

// ----- Actions ---------------------------------------------------------------

function saveFile(runtime, windowState) {
    const state = windowState.appState;
    if (!state.path || !state.dirty) return false;
    const result = runtime.filesystem.write(state.path, state.content, {
        owner: "buckycode", source: "save", create: true
    });
    if (result.ok) {
        state.savedContent = state.content;
        state.dirty = false;
        if (windowState.view.refreshToolbar) windowState.view.refreshToolbar();
        syncWindowTitle(runtime, windowState);
        runtime.notify("Saved", fileName(state));
        return true;
    }
    runtime.notify("Save failed", result.error);
    return false;
}

/**
 * Run the open file. The buffer is persisted first so Run always executes
 * what is on screen and the on-disk file stays in sync (edit → save → run).
 * Execution is routed through the sandboxed execution layer — never real code.
 */
function runFile(runtime, windowState) {
    const state = windowState.appState;
    if (!isRunnableState(state)) return;

    if (state.dirty) {
        const written = runtime.filesystem.write(state.path, state.content, {
            owner: "buckycode", source: "run", create: true
        });
        if (written.ok) {
            state.savedContent = state.content;
            state.dirty = false;
            if (windowState.view.refreshToolbar) windowState.view.refreshToolbar();
            syncWindowTitle(runtime, windowState);
        }
    }

    const result = executeFile(runtime.filesystem, state.path);
    state.output = {
        ok: result.ok,
        lines: result.output || [],
        error: result.error,
        runtime: result.runtime
    };
    if (windowState.view.refreshOutput) windowState.view.refreshOutput();
    runtime.notify(result.ok ? "Run complete" : "Run failed", fileName(state));
}

function clearOutput(windowState) {
    windowState.appState.output = null;
    if (windowState.view.refreshOutput) windowState.view.refreshOutput();
}

function togglePreview(runtime, windowState) {
    const state = windowState.appState;
    if (!isMarkdownState(state)) return;
    state.preview = !state.preview;
    if (windowState.view.refreshToolbar) windowState.view.refreshToolbar();
    if (windowState.view.refreshWorkarea) windowState.view.refreshWorkarea();
    if (!state.preview) focusEditor(windowState);
}

function indentSelection(runtime, windowState, textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = textarea.value.slice(0, start) + INDENT + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + INDENT.length;
    applyContent(runtime, windowState, textarea.value);
}

// ----- Lifecycle -------------------------------------------------------------

export function mountBuckyCodeApp(runtime, windowState, element) {
    const view = windowState.view;
    view.cleanups = [];
    const appElement = element.querySelector(".vm-buckycode");
    view.appElement = appElement;
    if (!appElement) return;

    const state = () => windowState.appState;
    const q = (selector) => appElement.querySelector(selector);

    // Fill the editor's textarea + highlight overlay from state, in JS, so the
    // overlay is always aligned and leading newlines are never mangled.
    view.hydrateEditor = () => {
        const textarea = q(".vm-code-area");
        const pre = q(".vm-code-highlight");
        if (!textarea || !pre) return;
        textarea.value = state().content;
        pre.innerHTML = highlight(state().content, languageForName(fileName(state())));
        pre.scrollTop = textarea.scrollTop;
        pre.scrollLeft = textarea.scrollLeft;
    };
    // Re-paint only the highlight layer (per keystroke); keep it scroll-aligned.
    view.refreshHighlight = () => {
        const pre = q(".vm-code-highlight");
        const textarea = q(".vm-code-area");
        if (!pre) return;
        pre.innerHTML = highlight(state().content, languageForName(fileName(state())));
        if (textarea) {
            pre.scrollTop = textarea.scrollTop;
            pre.scrollLeft = textarea.scrollLeft;
        }
    };
    view.refreshToolbar = () => {
        const toolbar = q("[data-code-toolbar]");
        if (toolbar && state().path) toolbar.innerHTML = renderToolbar(state());
    };
    view.refreshWorkarea = () => {
        const workarea = q("[data-code-workarea]");
        if (workarea && state().path) {
            workarea.innerHTML = renderWorkarea(state());
            view.hydrateEditor();
        }
    };
    view.refreshOutput = () => {
        const outwrap = q("[data-code-outwrap]");
        if (outwrap) outwrap.innerHTML = renderOutputPanel(state());
    };
    view.refreshAll = () => {
        appElement.innerHTML = renderInner(windowState);
        view.hydrateEditor();
    };

    // Typing — re-highlight the overlay, never the textarea.
    appElement.addEventListener("input", (event) => {
        if (!event.target.classList.contains("vm-code-area")) return;
        applyContent(runtime, windowState, event.target.value);
    });

    // Keep the highlight layer aligned with the textarea's scroll. `scroll`
    // does not bubble, so this listener runs in the capture phase.
    appElement.addEventListener("scroll", (event) => {
        const target = event.target;
        if (!target || !target.classList || !target.classList.contains("vm-code-area")) return;
        const pre = q(".vm-code-highlight");
        if (pre) {
            pre.scrollTop = target.scrollTop;
            pre.scrollLeft = target.scrollLeft;
        }
    }, true);

    appElement.addEventListener("click", (event) => {
        if (event.target.closest("[data-code-save]")) {
            saveFile(runtime, windowState);
        } else if (event.target.closest("[data-code-run]")) {
            runFile(runtime, windowState);
        } else if (event.target.closest("[data-code-preview]")) {
            togglePreview(runtime, windowState);
        } else if (event.target.closest("[data-code-output-clear]")) {
            clearOutput(windowState);
        }
    });

    appElement.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            runFile(runtime, windowState);
            return;
        }
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
        const current = state();
        if (!current.path || payload.path !== current.path || current.dirty) return;
        const incoming = payload.node ? payload.node.content : null;
        if (incoming != null && incoming !== current.content) {
            current.content = incoming;
            current.savedContent = incoming;
            view.refreshWorkarea();
            syncWindowTitle(runtime, windowState);
        }
    }));

    view.cleanups.push(runtime.bus.on("fs:node-deleted", (payload) => {
        const current = state();
        if (current.path && payload.path === current.path) {
            current.path = null;
            current.content = "";
            current.savedContent = "";
            current.dirty = false;
            current.preview = false;
            current.output = null;
            view.refreshAll();
            syncWindowTitle(runtime, windowState);
        }
    }));

    view.hydrateEditor();
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
 * Reopening the SAME file only refocuses — it never reloads, which would
 * discard unsaved edits. Because windows are de-duplicated by path, the
 * runtime routes only same-path intents here in practice.
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
    state.output = null;
    if (windowState.view && windowState.view.refreshAll) {
        windowState.view.refreshAll();
        focusEditor(windowState);
    }
    syncWindowTitle(runtime, windowState);
}
