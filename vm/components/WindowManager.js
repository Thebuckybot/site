export function renderWindows(runtime) {
    return runtime.windows.map((windowState) => {
        const active = runtime.activeWindowId === windowState.id ? " is-active" : "";
        const minimized = windowState.minimized ? " is-minimized" : "";
        const maximized = windowState.maximized ? " is-maximized" : "";
        const closing = windowState.closing ? " is-closing" : "";
        const dragging = windowState.dragging ? " is-dragging" : "";
        const style = `left:${windowState.x}px;top:${windowState.y}px;width:${windowState.width}px;height:${windowState.height}px;z-index:${windowState.z};`;

        return `
            <section class="vm-window${active}${minimized}${maximized}${closing}${dragging}" data-window-id="${windowState.id}" style="${style}">
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
    }).join("");
}

export function bindWindows(runtime) {
    runtime.root.querySelectorAll(".vm-window").forEach((windowElement) => {
        const id = windowElement.dataset.windowId;
        const handle = windowElement.querySelector("[data-drag-handle]");

        windowElement.addEventListener("pointerdown", (event) => {
            if (event.target.closest("[data-window-action]")) return;
            runtime.focusWindow(id, false);
        });

        windowElement.querySelectorAll("[data-window-action]").forEach((button) => {
            button.addEventListener("pointerdown", (event) => {
                event.stopPropagation();
                runtime.focusWindow(id, false);
            });

            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                runtime.windowAction(id, button.dataset.windowAction);
            });
        });

        if (!handle) return;

        handle.addEventListener("pointerdown", (event) => {
            const windowState = runtime.getWindow(id);
            if (!windowState || windowState.maximized || windowState.minimized || windowState.closing) return;

            event.preventDefault();
            event.stopPropagation();
            handle.setPointerCapture(event.pointerId);
            runtime.focusWindow(id, false);
            windowState.dragging = true;
            windowElement.classList.add("is-dragging");

            const bounds = runtime.getDesktopBounds();
            const startX = event.clientX;
            const startY = event.clientY;
            const initialX = windowState.x;
            const initialY = windowState.y;

            const move = (moveEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                const maxX = Math.max(10, bounds.width - windowState.width - 12);
                const maxY = Math.max(46, bounds.height - windowState.height - 12);

                runtime.moveWindow(
                    id,
                    clamp(initialX + dx, 10, maxX),
                    clamp(initialY + dy, 46, maxY)
                );
            };

            const up = () => {
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", up);
                handle.removeEventListener("pointercancel", up);
                windowState.dragging = false;
                windowElement.classList.remove("is-dragging");
                runtime.render();
            };

            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", up);
            handle.addEventListener("pointercancel", up);
        });
    });
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
