/**
 * DesktopManager component — the desktop surface and its icons.
 *
 * The desktop is a live view of the `~/Desktop` directory in the shared
 * runtime filesystem. Icons are not a hardcoded list: they are produced from
 * `fs.list(desktopPath)`, so anything created there (in the terminal, by an
 * app, anywhere) appears instantly.
 *
 * Rendering: `renderDesktop` paints the scaffold once. After that the runtime
 * updates only the `.vm-desktop-icons` container (see vmRuntime.updateDesktopIcons)
 * in response to fs:* events — never a full desktop rerender.
 *
 * Desktop item kinds:
 *   - dir   a directory          → double-click opens it in the Files app
 *   - link  an application shortcut (.link file, content = app id)
 *                                → double-click launches that app
 *   - file  any other file       → double-click opens it in BuckyCode
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
            <div class="vm-desktop-icons">${renderDesktopIcons(runtime)}</div>
            <div class="vm-window-layer"></div>
            ${renderTaskbar(runtime)}
        </div>
    `;
}

// ----- Interaction -----------------------------------------------------------

/** Single click: select an icon (or clear the selection on empty space). */
export function handleDesktopClick(runtime, event) {
    const item = event.target.closest("[data-desktop-item]");
    const nextSelection = item ? item.dataset.path : null;
    if (runtime.desktopSelection === nextSelection) return;
    runtime.desktopSelection = nextSelection;
    runtime.updateDesktopIcons();
}

/** Double click: open the item — folders in Files, links as apps, files in BuckyCode. */
export function handleDesktopDblClick(runtime, event) {
    const item = event.target.closest("[data-desktop-item]");
    if (!item) return;
    const { kind, path, target } = item.dataset;
    if (kind === "dir") {
        runtime.openApp("files", { path });
    } else if (kind === "link") {
        runtime.openApp(target);
    } else {
        runtime.openApp("buckycode", { path });
    }
}
