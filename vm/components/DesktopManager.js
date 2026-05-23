/**
 * DesktopManager component — the desktop surface and its icons.
 *
 * The desktop is a live view of the `~/Desktop` directory in the shared
 * runtime filesystem. Icons are not a hardcoded list: they are produced from
 * `fs.list(desktopPath)`, so anything created there (in the terminal, by an
 * app, anywhere) appears instantly.
 *
 * Rendering: `renderDesktop` paints the scaffold once. The runtime updates
 * only the `.vm-desktop-icons` container (see vmRuntime.updateDesktopIcons) in
 * response to fs:* events — never a full desktop rerender.
 *
 * Interaction model (stabilized in Phase 1.2):
 *   The desktop is driven entirely by `click`. A click on an unselected icon
 *   selects it; a click on an already-selected icon opens it. A fast mouse
 *   double-click is naturally select-then-open; a touch user taps once to
 *   select and once to open. This avoids depending on `dblclick` timing and,
 *   crucially, never rebuilds the icon DOM between the two interactions —
 *   selection is a targeted class patch, so the element a user is double-
 *   tapping is never destroyed mid-gesture (the old root cause of unreliable
 *   "spam clicking required" opening).
 *
 * Desktop item kinds:
 *   - dir   a directory          → opens it in the Files app
 *   - link  an application shortcut (.link file, content = app id)
 *                                → launches that app
 *   - file  any other file       → opens it in BuckyCode
 */
import { renderTaskbar } from "./Taskbar.js";
import { escapeHtml, fileIcon } from "../core/util.js";

/** Classify a `~/Desktop` entry into a renderable desktop item. */
function describeDesktopItem(runtime, entry) {
    if (entry.type === "dir") {
        return { kind: "dir", glyph: "DIR", label: entry.name, target: "" };
    }
    const isLink = Boolean(entry.node && entry.node.mime === "application/bucky-link");
    if (isLink) {
        const targetId = String((entry.node && entry.node.content) || "").trim();
        const app = runtime.apps[targetId];
        return {
            kind: "link",
            glyph: app ? app.icon : "APP",
            label: app ? app.label : entry.name.replace(/\.link$/, ""),
            target: targetId
        };
    }
    return { kind: "file", glyph: fileIcon(entry.name), label: entry.name, target: "" };
}

/** Render the contents of the `.vm-desktop-icons` container from the filesystem. */
export function renderDesktopIcons(runtime) {
    const fs = runtime.filesystem;
    const entries = fs.list(fs.desktopPath);

    if (!entries.length) {
        return `
            <p class="vm-desktop-empty">
                Your desktop is empty. Create items from the terminal —
                <br>mkdir ~/Desktop/intel · touch ~/Desktop/notes.txt
            </p>
        `;
    }

    return entries.map((entry) => {
        const item = describeDesktopItem(runtime, entry);
        const selected = runtime.desktopSelection === entry.path ? " is-selected" : "";
        return `
            <button class="vm-desktop-icon${selected}" type="button"
                    data-desktop-item data-kind="${item.kind}"
                    data-path="${escapeHtml(entry.path)}" data-target="${escapeHtml(item.target)}">
                <span class="vm-desktop-icon-glyph vm-glyph-${item.kind}">${escapeHtml(item.glyph)}</span>
                <span class="vm-desktop-icon-label">${escapeHtml(item.label)}</span>
            </button>
        `;
    }).join("");
}

export function renderDesktop(runtime) {
    return `
        <div class="vm-desktop">
            <div class="vm-wallpaper">
                <div class="vm-sun"></div>
                <div class="vm-grid-horizon"></div>
                <div class="vm-cityline"></div>
            </div>
            <div class="vm-desktop-brand">
                <span>BUCKY x ${escapeHtml(runtime.user.username)} VM</span>
                <strong>ARCADE WORKSTATION ONLINE</strong>
            </div>
            <div class="vm-desktop-icons" role="listbox" aria-label="Desktop">${renderDesktopIcons(runtime)}</div>
            <div class="vm-window-layer"></div>
            ${renderTaskbar(runtime)}
        </div>
    `;
}

// ----- Interaction -----------------------------------------------------------

/** Open a desktop item — folders in Files, links as apps, files in BuckyCode. */
function openDesktopItem(runtime, item) {
    const { kind, path, target } = item.dataset;
    if (kind === "dir") {
        runtime.openApp("files", { path });
    } else if (kind === "link") {
        if (target) runtime.openApp(target);
    } else if (path) {
        runtime.openApp("buckycode", { path });
    }
}

/**
 * Apply the desktop selection as a targeted class patch.
 * Never rebuilds the icon container, so a double-tap gesture is never
 * interrupted by DOM replacement.
 */
function setDesktopSelection(runtime, container, path, itemEl) {
    if (runtime.desktopSelection === path) return;
    if (container) {
        const previous = container.querySelector(".vm-desktop-icon.is-selected");
        if (previous) previous.classList.remove("is-selected");
        if (itemEl) itemEl.classList.add("is-selected");
    }
    runtime.desktopSelection = path;
}

/**
 * Desktop click handler (delegated, bound once on the icon container).
 * First click selects an icon; a second click on the same icon opens it.
 * A click on empty desktop space clears the selection.
 */
export function handleDesktopClick(runtime, event) {
    const container = event.currentTarget;
    const item = event.target.closest("[data-desktop-item]");

    if (!item) {
        setDesktopSelection(runtime, container, null, null);
        return;
    }

    const path = item.dataset.path;
    if (runtime.desktopSelection === path) {
        openDesktopItem(runtime, item);
        return;
    }
    setDesktopSelection(runtime, container, path, item);
}

/**
 * Double-click is a convenience accelerator: open immediately regardless of
 * prior selection. The click handler already makes two taps open reliably;
 * this simply lets an eager mouse double-click open an unselected icon in one
 * gesture. Re-opening an app is idempotent (single-instance focuses; file
 * apps de-duplicate), so the extra activation is harmless.
 */
export function handleDesktopDblClick(runtime, event) {
    const item = event.target.closest("[data-desktop-item]");
    if (!item) return;
    setDesktopSelection(runtime, event.currentTarget, item.dataset.path, item);
    openDesktopItem(runtime, item);
}
