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

/** Bind drag + window controls for a single window element. */
export function bindWindowElement(runtime, windowState, element) {
    const id = windowState.id;
    const handle = element.querySelector("[data-drag-handle]");

    element.addEventListener("pointerdown", (event) => {
        if (event.target.closest("[data-window-action]")) return;
        runtime.focusWindow(id);
    });

    element.querySelectorAll("[data-window-action]").forEach((button) => {
        button.addEventListener("pointerdown", (event) => {
            event.stopPropagation();
            runtime.focusWindow(id);
        });
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            runtime.windowAction(id, button.dataset.windowAction);
        });
    });

    if (!handle) return;

    handle.addEventListener("pointerdown", (event) => {
        const current = runtime.getWindow(id);
        if (!current || current.maximized || current.minimized || current.closing) return;

        event.preventDefault();
        event.stopPropagation();
        handle.setPointerCapture(event.pointerId);
        runtime.focusWindow(id);
        current.dragging = true;
        element.classList.add("is-dragging");

        const bounds = runtime.getDesktopBounds();
        const startX = event.clientX;
        const startY = event.clientY;
        const initialX = current.x;
        const initialY = current.y;
        let nextX = initialX;
        let nextY = initialY;
        let frameId = null;

        const applyPosition = () => {
            frameId = null;
            element.style.left = `${nextX}px`;
            element.style.top = `${nextY}px`;
        };

        const move = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            const maxX = Math.max(10, bounds.width - current.width - 12);
            const maxY = Math.max(46, bounds.height - current.height - 12);
            nextX = clamp(initialX + dx, 10, maxX);
            nextY = clamp(initialY + dy, 46, maxY);
            if (frameId === null) frameId = window.requestAnimationFrame(applyPosition);
        };

        const up = () => {
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
                applyPosition();
            }
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", up);
            handle.removeEventListener("pointercancel", up);
            current.dragging = false;
            element.classList.remove("is-dragging");
            runtime.commitWindowPosition(id, nextX, nextY);
        };

        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
    });
}
