export function renderPlaceholderApp(app) {
    return `
        <div class="vm-placeholder-app">
            <div class="vm-placeholder-orbit"></div>
            <h3>${app.title}</h3>
            <p>${app.description}</p>
            <span>Runtime slot reserved</span>
        </div>
    `;
}
