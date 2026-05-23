/**
 * WindowManager component — per-window rendering and interaction.
 *
 * The runtime owns the window collection and reconciles the window layer
 * (see vmRuntime.syncWindows). This module renders a single window element,
 * patches an existing one in place, and binds drag + window controls.
 *
 * Targeted updates only: patching a window never rebuilds its app body, so
 * app DOM, focus and listeners survive window-state changes.
 */
import { clamp } from "../core/util.js";

function windowClassList(windowState, isActive) {
    return [
        "vm-window",
        isActive ? "is-active" : "",
        windowState.minimized ? "is-minimized" : "",
        windowState.maximized ? "is-maximized" : "",
        windowState.closing ? "is-closing" : "",
        windowState.dragging ? "is-dragging" : ""
    ].filter(Boolean).join(" ");
}

function windowStyle(windowState) {
    return [
        `left:${windowState.x}px`,
        `top:${windowState.y}px`,
        `width:${windowState.width}px`,
        `height:${windowState.height}px`,
        `z-index:${windowState.z}`
    ].join(";") + ";";
}

/** Render the full markup for one window (chrome + app body). */
export function renderWindowElement(runtime, windowState) {
    const isActive = runtime.activeWindowId === windowState.id;
    return `
        <section class="${windowClassList(windowState, isActive)}" data-window-id="${windowState.id}" style="${windowStyle(windowState)}">
            <header class="vm-window-titlebar" data-drag-handle>
                <div class="vm-window-title">
                    <span>${windowState.icon}</span>
                    <strong>${windowState.title}</strong>
                </div>
                <div class="vm-window-controls">
                    <button type="button" data-window-action="minimize" aria-label="Minimize">_</button>
                    <button type="button" data-window-action="maximize" aria-label="Maximize">[]</button>
                    <button type="button" data-window-action="close" aria-label="Close">x</button>
                </div>
            </header>
            <div class="vm-window-body">${runtime.renderApp(windowState)}</div>
        </section>
    `;
}

/** Patch an existing window element's chrome to match its state (no body rebuild). */
export function patchWindowElement(runtime, windowState, element) {
    const isActive = runtime.activeWindowId === windowState.id;
    const nextClass = windowClassList(windowState, isActive);
    if (element.className !== nextClass) element.className = nextClass;

    element.style.left = `${windowState.x}px`;
    element.style.top = `${windowState.y}px`;
    element.style.width = `${windowState.width}px`;
    element.style.height = `${windowState.height}px`;
    element.style.zIndex = String(windowState.z);
}

/** Minimum pointer travel (px) before a titlebar press becomes a drag. */
const DRAG_THRESHOLD = 4;

/**
 * Bind drag + window controls for a single window element.
 *
 * Runs exactly once, when the element is created (vmRuntime.syncWindows).
 * Listeners live on the element and its children, so they are released
 * automatically when the element is removed — no manual teardown, no leaks.
 */
export function bindWindowElement(runtime, windowState, element) {
    const id = windowState.id;
    const handle = element.querySelector("[data-drag-handle]");

    // Any pointer press inside the window focuses it. A control press stops
    // propagation (below) so this never runs for a control — the control just
    // performs its action.
    element.addEventListener("pointerdown", () => runtime.focusWindow(id));

    // ----- Window controls: minimize / maximize / close ---------------------
    element.querySelectorAll("[data-window-action]").forEach((button) => {
        // Stop the press here: it must not bubble to the titlebar (drag) or the
        // window (focus). Without this a press on a control could be read as a
        // drag start, which is what made the controls feel unreliable.
        button.addEventListener("pointerdown", (event) => event.stopPropagation());
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            runtime.windowAction(id, button.dataset.windowAction);
        });
    });

    if (!handle) return;

    // Double-click the titlebar toggles maximize (standard desktop behaviour).
    handle.addEventListener("dblclick", (event) => {
        if (event.target.closest("[data-window-action]")) return;
        runtime.windowAction(id, "maximize");
    });

    // ----- Titlebar drag ----------------------------------------------------
    handle.addEventListener("pointerdown", (event) => {
        // A press on a control is never a drag (defence-in-depth: the control
        // also stops propagation, but the titlebar must not assume that).
        if (event.target.closest("[data-window-action]")) return;
        event.stopPropagation();

        const current = runtime.getWindow(id);
        runtime.focusWindow(id);
        if (!current || current.maximized || current.minimized || current.closing) return;

        const startX = event.clientX;
        const startY = event.clientY;
        const initialX = current.x;
        const initialY = current.y;
        let nextX = initialX;
        let nextY = initialY;
        let dragging = false;
        let frameId = null;
        let bounds = runtime.getDesktopBounds();

        // Pointer capture keeps events flowing to the handle even when the
        // pointer leaves the VM; the move/up listeners on `window` are the
        // robust fallback if capture is unavailable.
        try { handle.setPointerCapture(event.pointerId); } catch (_) { /* non-fatal */ }

        const applyPosition = () => {
            frameId = null;
            element.style.left = `${nextX}px`;
            element.style.top = `${nextY}px`;
        };

        const move = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;

            if (!dragging) {
                if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
                const live = runtime.getWindow(id);
                if (!live || live.maximized || live.minimized || live.closing) return;
                dragging = true;
                live.dragging = true;
                element.classList.add("is-dragging");
                bounds = runtime.getDesktopBounds();
            }

            const maxX = Math.max(10, bounds.width - current.width - 12);
            const maxY = Math.max(46, bounds.height - current.height - 12);
            nextX = clamp(initialX + dx, 10, maxX);
            nextY = clamp(initialY + dy, 46, maxY);
            if (frameId === null) frameId = window.requestAnimationFrame(applyPosition);
        };

        const finish = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", finish);
            try { handle.releasePointerCapture(event.pointerId); } catch (_) { /* non-fatal */ }
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
                applyPosition();
            }
            if (dragging) {
                const live = runtime.getWindow(id);
                if (live) live.dragging = false;
                element.classList.remove("is-dragging");
                runtime.commitWindowPosition(id, nextX, nextY);
            }
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
    });
}
