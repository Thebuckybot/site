/**
 * Files app.
 *
 * A visual surface over the shared FileSystemService. Directories and files
 * are clickable; navigation is nested with a breadcrumb path; selecting a
 * file shows a live preview and an "open in BuckyCode" action.
 *
 * Interaction model (stabilized in Phase 1.2): a single click on a directory
 * navigates into it; a click on an unselected file selects it (showing its
 * preview); a click on the already-selected file opens it in BuckyCode. A
 * fast mouse double-click is therefore naturally select-then-open, and a
 * touch user taps twice — neither path depends on `dblclick` timing. A
 * `dblclick` handler remains purely as a convenience accelerator.
 *
 * Rendering: the app holds only `cwd` + `selected` in its state. A single
 * delegated click listener lives on the `.vm-files-app` element; the inner
 * content is re-rendered on navigation and on fs:* events (live updates),
 * which never touches the rest of the desktop.
 */
import { escapeHtml, fileIcon } from "../core/util.js";
import { debugLog, logError } from "../core/diagnostics.js";
import { renderMarkdown, isMarkdownName } from "../core/markdown.js";

const FS_EVENTS = ["fs:node-created", "fs:node-updated", "fs:node-deleted"];

// ----- State -----------------------------------------------------------------

export function createFilesState(user, filesystem, payload) {
    const start = payload && payload.path && filesystem.isDir(payload.path)
        ? filesystem.normalize(payload.path)
        : filesystem.homePath;
    return {
        cwd: start,
        selected: null
    };
}

// ----- Rendering -------------------------------------------------------------

function renderSidebar(fs, cwd) {
    const rootButton = `
        <button class="vm-file-source${cwd === "/" ? " is-active" : ""}" type="button" data-files-nav data-path="/">
            <span>VM</span>root
        </button>
    `;
    const entries = fs.list("/").map((entry) => `
        <button class="vm-file-source${cwd === entry.path ? " is-active" : ""}" type="button" data-files-nav data-path="${escapeHtml(entry.path)}">
            <span>${entry.type === "dir" ? "DIR" : "TXT"}</span>${escapeHtml(entry.name)}
        </button>
    `).join("");
    return rootButton + entries;
}

function renderBreadcrumb(cwd) {
    const segments = cwd.split("/").filter(Boolean);
    const crumbs = [`<button class="vm-files-crumb" type="button" data-files-nav data-path="/">/</button>`];
    let accumulated = "";
    segments.forEach((segment) => {
        accumulated += `/${segment}`;
        crumbs.push(`<button class="vm-files-crumb" type="button" data-files-nav data-path="${escapeHtml(accumulated)}">${escapeHtml(segment)}</button>`);
    });
    return crumbs.join('<span class="vm-files-crumb-sep">›</span>');
}

function renderUpButton(cwd) {
    const atRoot = cwd === "/";
    return `<button class="vm-files-up" type="button" data-files-up${atRoot ? " disabled" : ""} aria-label="Go to parent folder" title="Parent folder">↑</button>`;
}

function renderGrid(entries, selected) {
    if (!entries.length) {
        return `
            <div class="vm-files-empty">
                <strong>This folder is empty</strong>
                <span>Create files and folders from the terminal with mkdir and touch — they appear here instantly.</span>
            </div>
        `;
    }
    return entries.map((entry) => {
        const isFile = entry.type === "file";
        const marker = isFile ? "data-files-file" : "data-files-dir";
        const active = isFile && entry.path === selected ? " is-selected" : "";
        const icon = isFile ? fileIcon(entry.name) : "DIR";
        const kindClass = isFile
            ? (isMarkdownName(entry.name) ? " vm-file-icon-md" : "")
            : " vm-file-icon-dir";
        return `
            <button class="vm-file-tile${active}" type="button" ${marker} data-path="${escapeHtml(entry.path)}">
                <div class="vm-file-icon${kindClass}">${escapeHtml(icon)}</div>
                <span>${escapeHtml(entry.name)}</span>
            </button>
        `;
    }).join("");
}

function renderPreview(fs, selected) {
    if (!selected) return "";
    const result = fs.read(selected);
    if (!result.ok) return "";
    const stat = fs.stat(selected);
    const name = stat ? stat.name : selected;
    const body = isMarkdownName(name)
        ? `<div class="vm-files-preview-body vm-files-preview-md">${renderMarkdown(result.content)}</div>`
        : `<pre class="vm-files-preview-body">${escapeHtml(result.content) || "(empty file)"}</pre>`;
    return `
        <div class="vm-files-preview">
            <div class="vm-files-preview-head">
                <strong>${escapeHtml(name)}</strong>
                <button class="vm-files-open-btn" type="button" data-files-open>Open in BuckyCode</button>
            </div>
            <div class="vm-files-preview-meta">owner: ${escapeHtml(stat ? stat.owner : "?")} · ${result.content.length} chars</div>
            ${body}
        </div>
    `;
}

/** Render the inner content of the Files app for the current state. */
function renderFilesInner(runtime, windowState) {
    const fs = runtime.filesystem;
    const state = windowState.appState;
    // Drop a selection whose file no longer exists, so a deleted file never
    // lingers as a stale highlight or a dead preview.
    if (state.selected && !fs.exists(state.selected)) {
        state.selected = null;
    }
    // Fall back to root if the current directory was removed underneath us.
    if (!fs.isDir(state.cwd)) {
        state.cwd = "/";
    }
    const { cwd, selected } = state;
    const entries = fs.list(cwd);
    return `
        <aside class="vm-files-sidebar">${renderSidebar(fs, cwd)}</aside>
        <section class="vm-files-main">
            <div class="vm-files-path">${renderUpButton(cwd)}${renderBreadcrumb(cwd)}</div>
            <div class="vm-files-grid${entries.length ? "" : " is-empty"}">${renderGrid(entries, selected)}</div>
            ${renderPreview(fs, selected)}
        </section>
    `;
}

export function renderFilesApp(runtime, windowState) {
    return `<div class="vm-files-app">${renderFilesInner(runtime, windowState)}</div>`;
}

// ----- Interaction -----------------------------------------------------------

function handleClick(runtime, windowState, event) {
    const state = windowState.appState;

    const up = event.target.closest("[data-files-up]");
    if (up) {
        if (state.cwd !== "/") {
            const parts = state.cwd.split("/").filter(Boolean);
            parts.pop();
            state.cwd = parts.length ? `/${parts.join("/")}` : "/";
            state.selected = null;
            windowState.view.refresh();
        }
        return;
    }

    const nav = event.target.closest("[data-files-nav]");
    if (nav) {
        state.cwd = nav.dataset.path || "/";
        state.selected = null;
        windowState.view.refresh();
        return;
    }

    const directory = event.target.closest("[data-files-dir]");
    if (directory) {
        state.cwd = directory.dataset.path;
        state.selected = null;
        windowState.view.refresh();
        return;
    }

    const file = event.target.closest("[data-files-file]");
    if (file) {
        const path = file.dataset.path;
        if (state.selected === path) {
            // Second activation of the selected file opens it.
            runtime.openApp("buckycode", { path });
        } else {
            state.selected = path;
            windowState.view.refresh();
        }
        return;
    }

    const open = event.target.closest("[data-files-open]");
    if (open && state.selected) {
        runtime.openApp("buckycode", { path: state.selected });
    }
}

// ----- Lifecycle -------------------------------------------------------------

export function mountFilesApp(runtime, windowState, element) {
    const view = windowState.view;
    view.cleanups = [];
    const appElement = element.querySelector(".vm-files-app");
    view.appElement = appElement;
    if (!appElement) return;

    view.refresh = () => {
        appElement.innerHTML = renderFilesInner(runtime, windowState);
    };

    appElement.addEventListener("click", (event) => handleClick(runtime, windowState, event));

    // Double-click a file is a convenience accelerator: open immediately.
    // Opening BuckyCode is de-duplicated by path, so this is idempotent even
    // when it follows the click-to-open above.
    appElement.addEventListener("dblclick", (event) => {
        const file = event.target.closest("[data-files-file]");
        if (!file) return;
        windowState.appState.selected = file.dataset.path;
        view.refresh();
        runtime.openApp("buckycode", { path: file.dataset.path });
    });

    // Live updates: re-render only when a filesystem change affects this
    // window's view — its current directory, the root sidebar, or the
    // selected file. Unrelated changes elsewhere never re-render this app.
    const onFsChange = (payload) => {
        const state = windowState.appState;
        if (!payload
            || payload.parentPath === state.cwd
            || payload.parentPath === "/"
            || payload.path === state.cwd
            || payload.path === state.selected) {
            view.refresh();
            debugLog("files refreshed", state.cwd);
        }
    };
    FS_EVENTS.forEach((eventName) => {
        view.cleanups.push(runtime.bus.on(eventName, onFsChange));
    });
}

export function unmountFilesApp(runtime, windowState) {
    (windowState.view.cleanups || []).forEach((cleanup) => {
        try {
            cleanup();
        } catch (error) {
            logError("Files cleanup", error);
        }
    });
}

/** Navigate an already-open Files window to a directory (intent). */
export function applyFilesIntent(runtime, windowState, payload) {
    if (!payload || !payload.path || !runtime.filesystem.isDir(payload.path)) return;
    const state = windowState.appState;
    state.cwd = runtime.filesystem.normalize(payload.path);
    state.selected = null;
    if (windowState.view && windowState.view.refresh) windowState.view.refresh();
}
