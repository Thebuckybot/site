export function renderTaskbar(runtime) {
    const activeApps = runtime.windows.map((windowState) => {
        const active = runtime.activeWindowId === windowState.id ? " is-active" : "";
        const minimized = windowState.minimized ? " is-minimized" : "";
        return `
            <button class="vm-task-app${active}${minimized}" type="button" data-task-window="${windowState.id}">
                <span>${windowState.icon}</span>${windowState.title}
            </button>
        `;
    }).join("");

    return `
        <footer class="vm-taskbar">
            <div class="vm-task-user">
                <img src="${runtime.user.avatarUrl}" alt="">
                <div>
                    <strong>BUCKY VM</strong>
                    <span>${runtime.user.username}</span>
                </div>
            </div>
            <div class="vm-task-apps">${activeApps}</div>
            <div class="vm-task-status">
                <span class="vm-status-icon" title="Secure network">NET</span>
                <span class="vm-status-icon" title="Battery">89%</span>
                <time data-vm-clock>${runtime.clock}</time>
            </div>
        </footer>
    `;
}

export function bindTaskbar(runtime) {
    runtime.root.querySelectorAll("[data-task-window]").forEach((button) => {
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
