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
