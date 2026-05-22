/**
 * Notifications component.
 *
 * The toast stack. The runtime re-renders only the items inside
 * `.vm-notifications` via updateNotifications — a targeted update.
 */

/** Render the toast items (contents of `.vm-notifications`). */
export function renderNotificationItems(runtime) {
    return runtime.notifications.map((item) => `
        <div class="vm-notification">
            <strong>${item.title}</strong>
            <span>${item.message}</span>
        </div>
    `).join("");
}

export function renderNotifications(runtime) {
    return `
        <div class="vm-notifications" aria-live="polite">
            ${renderNotificationItems(runtime)}
        </div>
    `;
}
