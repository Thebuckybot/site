export function renderPlaceholderApp(app) {
    const title = app?.title || "Application Under Construction";
    const description = app?.description || "This module is not yet available in the Bucky VM runtime.";

    return `
        <div class="vm-placeholder-app">
            <div class="vm-placeholder-orbit"></div>
            <h3>${title}</h3>
            <p>${description}</p>
            <span>Application Under Construction</span>
        </div>
    `;
}

/**
 * A module that EXISTS but is deliberately switched off, as opposed to one that
 * was never built. Mission Hub is the first: the arc missions and the 3D world
 * are parked, so opening it would download ~11 MB for a screen nobody can use.
 *
 * Kept visually distinct from the placeholder above on purpose. "Under
 * construction" invites people to wait for it; this one says the module is
 * intact and switched off, which is the honest description.
 */
export function renderLockedApp(app) {
    const title = app?.title || "Module Locked";
    const description = app?.description || "This module is temporarily unavailable.";
    const note = app?.lockNote || "";

    return `
        <div class="vm-placeholder-app vm-locked-app">
            <div class="vm-locked-badge">&#128274;</div>
            <h3>${title}</h3>
            <p>${description}</p>
            ${note ? `<p class="vm-locked-note">${note}</p>` : ""}
            <span>Offline &mdash; Coming Soon</span>
        </div>
    `;
}
