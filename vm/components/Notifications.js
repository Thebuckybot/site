export function renderNotifications(runtime) {
    return `
        <div class="vm-notifications" aria-live="polite">
            ${runtime.notifications.map((item) => `
                <div class="vm-notification">
                    <strong>${item.title}</strong>
                    <span>${item.message}</span>
                </div>
            `).join("")}
        </div>
    `;
}
