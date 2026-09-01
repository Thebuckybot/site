/**
 * Taskbar component.
 *
 * Renders the persistent desktop foot strip. The running-app zone is a
 * targeted-update region: the runtime re-renders only `.vm-task-apps` when
 * the window collection changes (see vmRuntime.updateTaskbar).
 */
import { escapeHtml } from "../core/util.js";

/** Render the running-app buttons (the contents of `.vm-task-apps`). */
export function renderTaskApps(runtime) {
    return runtime.windows.map((windowState) => {
        const active = runtime.activeWindowId === windowState.id ? " is-active" : "";
        const minimized = windowState.minimized ? " is-minimized" : "";
        const closing = windowState.closing ? " is-closing" : "";
        // TITEL EN ICOON ZIJN NIET VAN ONS. Een venstertitel komt uit de app:
        // BuckyCode zet er een bestandsnaam in en de browser een paginatitel,
        // en die laatste bevat bij PulseSearch de zoekterm van de speler. Via
        // innerHTML is dat een injectiepad; setWindowTitle schreef al met
        // textContent, deze regel deed dat niet.
        return `
            <button class="vm-task-app${active}${minimized}${closing}" type="button" data-task-window="${escapeHtml(windowState.id)}">
                <span>${escapeHtml(windowState.icon)}</span>${escapeHtml(windowState.title)}
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
    // DE STRIP SCHUIFT HORIZONTAAL, en met genoeg vensters valt een knop erbuiten.
    // Chrome schuift zo'n knop bij toetsenbordfocus niet vanzelf in beeld - de VM
    // zit in een afgesneden container - dus een knop kon focus krijgen terwijl hij
    // onzichtbaar was. Eén gedelegeerde luisteraar op de strip zelf; de strip blijft
    // hetzelfde element bij een gerichte update, alleen zijn inhoud wordt vervangen.
    const strip = runtime.root.querySelector(".vm-task-apps");
    if (strip && strip.dataset.scrollBound !== "1") {
        strip.dataset.scrollBound = "1";
        strip.addEventListener("focusin", (event) => {
            const button = event.target.closest("[data-task-window]");
            if (!button) return;
            try {
                button.scrollIntoView({ block: "nearest", inline: "nearest" });
            } catch (_e) { /* scrolling is a courtesy, never required */ }
        });
    }

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
