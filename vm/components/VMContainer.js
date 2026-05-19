import { renderDesktop } from "./DesktopManager.js";
import { renderNotifications } from "./Notifications.js";

export function renderVMContainer(runtime) {
    const modeClass = runtime.mode === "expanded" ? " is-expanded" : " is-embedded";
    const phaseClass = ` is-${runtime.phase}`;

    return `
        <div class="bucky-vm-backdrop${runtime.mode === "expanded" ? " is-visible" : ""}" data-vm-backdrop></div>
        <div class="bucky-vm-shell${modeClass}">
            <div class="bucky-vm${phaseClass}" role="application" aria-label="Bucky VM">
                <div class="vm-reflection"></div>
                <div class="vm-scanlines"></div>
                <div class="vm-corner-hotspot" title="Expand focus mode">
                    <button class="vm-expand-button" type="button" data-vm-expand aria-label="Expand Bucky VM">[]</button>
                </div>
                ${runtime.mode === "expanded" ? `<button class="vm-minimize-button" type="button" data-vm-minimize aria-label="Minimize Bucky VM">-</button>` : ""}
                ${renderPhase(runtime)}
                ${renderNotifications(runtime)}
            </div>
        </div>
        <div class="bucky-vm-mobile-lock">
            <div class="vm-lock-mark"></div>
            <h2>Bucky VM Locked</h2>
            <p>Bucky VM requires a larger display.</p>
        </div>
    `;
}

function renderPhase(runtime) {
    if (runtime.phase === "boot") {
        return `
            <div class="vm-boot">
                <div class="vm-boot-core"></div>
                <div class="vm-boot-copy">
                    <span>BUCKY VM BOOT LAYER</span>
                    ${runtime.bootLines.map((line) => `<strong>${line}</strong>`).join("")}
                </div>
            </div>
        `;
    }

    if (runtime.phase === "login") {
        return `
            <div class="vm-login">
                <div class="vm-fingerprint"></div>
                <h2>BUCKY VM</h2>
                <span>SECURE ARCADE WORKSTATION</span>
                <label>
                    USERNAME
                    <input value="${runtime.user.username}" readonly>
                </label>
                <label>
                    PASSWORD
                    <input value="**********" readonly type="password">
                </label>
                <button type="button" data-vm-login>ENTER SYSTEM</button>
            </div>
        `;
    }

    return renderDesktop(runtime);
}
