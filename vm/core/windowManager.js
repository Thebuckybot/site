export function createWindow(app, index = 0, appState = {}) {
    return {
        id: `${app.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        appId: app.id,
        title: app.title,
        icon: app.icon,
        x: 78 + index * 34,
        y: 70 + index * 28,
        width: app.width || 620,
        height: app.height || 390,
        z: 10 + index,
        minimized: false,
        maximized: false,
        closing: false,
        appState
    };
}
