import { renderTaskbar } from "./Taskbar.js";

export function renderDesktop(runtime) {
    const icons = runtime.desktopApps.filter(Boolean).map((app) => `
        <button class="vm-desktop-icon" type="button" data-open-app="${app.id}">
            <span class="vm-desktop-icon-glyph">${app.icon}</span>
            <span>${app.label}</span>
        </button>
    `).join("");

    return `
        <div class="vm-desktop">
            <div class="vm-wallpaper">
                <div class="vm-sun"></div>
                <div class="vm-grid-horizon"></div>
                <div class="vm-cityline"></div>
            </div>
            <div class="vm-desktop-brand">
                <span>BUCKY x ${runtime.user.username} VM</span>
                <strong>ARCADE WORKSTATION ONLINE</strong>
            </div>
            <div class="vm-desktop-icons">${icons}</div>
            <div class="vm-window-layer"></div>
            ${renderTaskbar(runtime)}
        </div>
    `;
}
