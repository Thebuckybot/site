export function createWindow(app, index = 0, appState = {}) {
    const x = 78 + index * 34;
    const y = 70 + index * 28;
    const width = app.width || 620;
    const height = app.height || 390;

    return {
        id: `${app.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        appId: app.id,
        title: app.title,
        icon: app.icon,
        x,
        y,
        width,
        height,
        z: 10 + index,
        visible: true,
        focused: false,
        dragging: false,
        minimized: false,
        maximized: false,
        restoreBounds: { x, y, width, height },
        closing: false,
        appState
    };
}
