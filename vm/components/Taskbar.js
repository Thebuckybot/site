/**
 * Taskbar component.
 *
 * Renders the persistent desktop foot strip. The running-app zone is a
 * targeted-update region: the runtime re-renders only `.vm-task-apps` when
 * the window collection changes (see vmRuntime.updateTaskbar).
 */

/** Render the running-app buttons (the contents of `.vm-task-apps`). */
export function renderTaskApps(runtime) {
    return runtime.windows.map((windowState) => {
        const active = runtime.activeWindowId === windowState.id ? " is-active" : "";
        const minimized = windowState.minimized ? " is-minimized" : "";
        const closing = windowState.closing ? " is-closing" : "";
        return `
            <button class="vm-task-app${active}${minimized}${closing}" type="button" data-task-window="${windowState.id}">
                <span>${windowState.icon}</span>${windowState.title}
            </button>
        `;
    }).join("");
}

export function renderTaskbar(runtime) {
    return `
        <footer class="vm-taskbar">
            <div class="vm-task-user">
                <img src="${runtime.user.avatarUrl}" alt="">
                <div>
                    <strong>BUCKY VM</strong>
                    <span>${runtime.user.username}</span>
                </div>
            </div>
            <div class="vm-task-apps">${renderTaskApps(runtime)}</div>
            <div class="vm-task-status">
                <span class="vm-status-icon" title="Secure network">NET</span>
                <span class="vm-status-icon" title="Battery">89%</span>
                <time data-vm-clock>${runtime.clock}</time>
            </div>
        </footer>
    `;
}

/** Bind the running-app buttons. Safe to call repeatedly after a targeted update. */
export function bindTaskbar(runtime) {
    runtime.root.querySelectorAll("[data-task-window]").forEach((button) => {
        if (button.dataset.bound === "1") return;
        button.dataset.bound = "1";
        button.addEventListener("click", () => {
            const windowState = runtime.getWindow(button.dataset.taskWindow);
            if (!windowState) return;
            if (windowState.minimized) {
                runtime.restoreWindow(windowState.id);
                return;
            }
            runtime.focusWindow(windowState.id);
        });
    });
}
