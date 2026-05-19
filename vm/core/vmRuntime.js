import { createVirtualFilesystem } from "./filesystem.js";
import { createWindow } from "./windowManager.js";
import { renderVMContainer } from "../components/VMContainer.js";
import { bindWindows } from "../components/WindowManager.js";
import { bindTaskbar } from "../components/Taskbar.js";
import { bindTerminalApp, createTerminalState, renderTerminalApp } from "../apps/TerminalApp.js";
import { renderFilesApp } from "../apps/FilesApp.js";
import { renderPlaceholderApp } from "../apps/PlaceholderApp.js";

const FALLBACK_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

export class BuckyVMRuntime {
    constructor(root, user = {}) {
        this.root = root;
        this.user = normalizeUser(user);
        this.mode = "embedded";
        this.phase = "boot";
        this.bootLines = [];
        this.sessionLines = [];
        this.windows = [];
        this.notifications = [];
        this.activeWindowId = null;
        this.nextZ = 20;
        this.clock = "--:--";
        this.filesystem = createVirtualFilesystem(this.user.username);
        this.bootQueue = [
            "INITIALIZING VM",
            "LOADING MEMORY",
            "CONNECTING SECURE NODE",
            "BOOTING BUCKY OS"
        ];
        this.sessionQueue = [
            "INITIALIZING VM",
            "CONNECTING SECURE NODE",
            "LOADING USER SESSION",
            "BOOTING DESKTOP ENVIRONMENT"
        ];
        this.apps = createAppRegistry();
        this.desktopApps = [
            this.apps.terminal,
            this.apps.files,
            this.apps.textfile,
            this.apps.notes,
            this.apps.browser,
            this.apps.mail,
            this.apps.database,
            this.apps.osint
        ];
        this.resizeHandler = () => {
            if (this.phase !== "desktop") return;
            this.constrainWindows();
            this.render();
        };
    }

    start() {
        this.render();
        this.tickClock();
        this.clockTimer = window.setInterval(() => this.tickClock(), 1000);
        window.addEventListener("resize", this.resizeHandler);
        this.runBootSequence();
    }

    runBootSequence() {
        this.bootQueue.forEach((line, index) => {
            window.setTimeout(() => {
                this.bootLines = [...this.bootLines, line];
                this.render();
            }, 450 + index * 520);
        });

        window.setTimeout(() => {
            this.phase = "login";
            this.notify("Identity linked", `${this.user.username} profile injected`);
            this.render();
        }, 3100);
    }

    tickClock() {
        this.clock = new Intl.DateTimeFormat([], {
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date());
        this.root.querySelector("[data-vm-clock]")?.replaceChildren(this.clock);
    }

    render() {
        this.constrainWindows();
        this.root.innerHTML = renderVMContainer(this);
        this.bind();
    }

    bind() {
        this.root.querySelector("[data-vm-expand]")?.addEventListener("click", () => this.setMode("expanded"));
        this.root.querySelector("[data-vm-minimize]")?.addEventListener("click", () => this.setMode("embedded"));
        this.root.querySelector("[data-vm-backdrop]")?.addEventListener("click", () => this.setMode("embedded"));
        this.root.querySelector("[data-vm-login]")?.addEventListener("click", () => this.startDesktopBoot());

        this.root.querySelectorAll("[data-open-app]").forEach((button) => {
            button.addEventListener("dblclick", () => this.openApp(button.dataset.openApp));
            button.addEventListener("click", () => this.openApp(button.dataset.openApp));
        });

        bindWindows(this);
        bindTaskbar(this);

        this.windows.forEach((windowState) => {
            const element = this.root.querySelector(`[data-window-id="${windowState.id}"]`);
            if (!element) return;
            const app = this.apps[windowState.appId];
            if (app?.bind) app.bind(this, windowState, element);
        });
    }

    setMode(mode) {
        this.mode = mode;
        document.body.classList.toggle("vm-focus-active", mode === "expanded");
        this.render();
        if (this.phase === "desktop") {
            window.requestAnimationFrame(() => {
                this.constrainWindows();
                this.render();
            });
        }
    }

    startDesktopBoot() {
        this.phase = "session";
        this.sessionLines = [];
        this.windows = [];
        this.activeWindowId = null;
        this.render();

        this.sessionQueue.forEach((line, index) => {
            window.setTimeout(() => {
                this.sessionLines = [...this.sessionLines, line];
                this.render();
            }, 180 + index * 430);
        });

        window.setTimeout(() => {
            this.phase = "desktop";
            this.notify("Desktop ready", "Open Terminal from the desktop");
            this.render();
        }, 2300);
    }

    openApp(appId) {
        const app = this.apps[appId];
        if (!this.isLaunchableApp(app)) {
            this.notify("Application unavailable", `${appId || "Unknown"} is not registered yet`);
            return;
        }

        const existing = this.windows.find((item) => item.appId === appId && app.singleInstance);
        if (existing) {
            this.restoreWindow(existing.id);
            return;
        }

        let appState = {};
        try {
            appState = app.createState ? app.createState(this.user, this.filesystem) : {};
        } catch (error) {
            console.error("Failed to create app state:", appId, error);
            this.notify("Application paused", `${app.title || appId} could not start`);
            return;
        }
        const windowState = createWindow(app, this.windows.length, appState);
        const metrics = this.getInitialWindowMetrics(app, this.windows.length);
        Object.assign(windowState, metrics);
        windowState.restoreBounds = { ...metrics };
        windowState.z = ++this.nextZ;
        windowState.focused = true;
        this.windows.forEach((item) => {
            item.focused = false;
        });
        this.windows = [...this.windows, windowState];
        this.activeWindowId = windowState.id;
        this.render();
    }

    isLaunchableApp(app) {
        return Boolean(app && app.id && app.title && typeof app.render === "function");
    }

    getInitialWindowMetrics(app, index) {
        const bounds = this.getDesktopBounds();
        const vmWidth = bounds.width;
        const vmHeight = bounds.height + 54;
        const iconRail = 98;
        const availableWidth = Math.max(330, vmWidth - iconRail - 26);
        const availableHeight = Math.max(230, vmHeight - 118);
        const width = Math.min(app.width || 620, availableWidth);
        const height = Math.min(app.height || 390, availableHeight);

        return {
            width,
            height,
            x: Math.min(iconRail + index * 18, Math.max(12, vmWidth - width - 12)),
            y: Math.min(62 + index * 18, Math.max(46, vmHeight - height - 66))
        };
    }

    getDesktopBounds() {
        const layerRect = this.root.querySelector(".vm-window-layer")?.getBoundingClientRect();
        const vmRect = this.root.querySelector(".bucky-vm")?.getBoundingClientRect();
        return {
            width: layerRect?.width || vmRect?.width || 900,
            height: layerRect?.height || Math.max(360, (vmRect?.height || 520) - 54)
        };
    }

    getMaximizedBounds() {
        const bounds = this.getDesktopBounds();
        const leftInset = bounds.width < 720 ? 86 : 102;

        return {
            x: leftInset,
            y: 12,
            width: Math.max(330, bounds.width - leftInset - 14),
            height: Math.max(230, bounds.height - 22)
        };
    }

    constrainWindows() {
        if (!this.windows.length) return;
        const bounds = this.getDesktopBounds();
        const vmWidth = bounds.width;
        const vmHeight = bounds.height + 54;
        const maxWidth = Math.max(330, vmWidth - 112);
        const maxHeight = Math.max(230, vmHeight - 118);

        this.windows.forEach((windowState) => {
            if (windowState.maximized) {
                Object.assign(windowState, this.getMaximizedBounds());
                return;
            }
            windowState.width = Math.min(windowState.width, maxWidth);
            windowState.height = Math.min(windowState.height, maxHeight);
            windowState.x = clamp(windowState.x, 10, Math.max(10, vmWidth - windowState.width - 12));
            windowState.y = clamp(windowState.y, 46, Math.max(46, vmHeight - windowState.height - 66));
        });
    }

    getWindow(id) {
        return this.windows.find((windowState) => windowState.id === id);
    }

    focusWindow(id, shouldRender = true) {
        const windowState = this.getWindow(id);
        if (!windowState || windowState.closing) return;
        this.windows.forEach((item) => {
            item.focused = item.id === id;
        });
        windowState.z = ++this.nextZ;
        this.activeWindowId = id;
        if (shouldRender) {
            this.render();
        } else {
            this.syncWindowDomFocus(id);
        }
    }

    syncWindowDomFocus(id) {
        this.root.querySelectorAll(".vm-window").forEach((element) => {
            const isActive = element.dataset.windowId === id;
            element.classList.toggle("is-active", isActive);
            const windowState = this.getWindow(element.dataset.windowId);
            if (windowState) element.style.zIndex = windowState.z;
        });
    }

    moveWindow(id, x, y) {
        const windowState = this.getWindow(id);
        if (!windowState || windowState.maximized || windowState.minimized || windowState.closing) return;
        windowState.x = x;
        windowState.y = y;
        const element = this.root.querySelector(`[data-window-id="${id}"]`);
        if (element) {
            element.style.left = `${x}px`;
            element.style.top = `${y}px`;
        }
    }

    commitWindowPosition(id, x, y) {
        const windowState = this.getWindow(id);
        if (!windowState || windowState.maximized || windowState.minimized || windowState.closing) return;
        windowState.x = x;
        windowState.y = y;
        windowState.restoreBounds = {
            x,
            y,
            width: windowState.width,
            height: windowState.height
        };
    }

    windowAction(id, action) {
        if (action === "minimize") {
            this.minimizeWindow(id);
            return;
        }

        if (action === "maximize") {
            this.toggleMaximizeWindow(id);
            return;
        }

        if (action === "close") {
            this.closeWindow(id);
            return;
        }
    }

    minimizeWindow(id) {
        const windowState = this.getWindow(id);
        if (!windowState || windowState.closing) return;

        windowState.minimized = true;
        windowState.focused = false;

        if (this.activeWindowId === id) {
            const nextWindow = this.getTopVisibleWindow(id);
            this.activeWindowId = nextWindow?.id || null;
            if (nextWindow) nextWindow.focused = true;
        }

        this.render();
    }

    toggleMaximizeWindow(id) {
        const windowState = this.getWindow(id);
        if (!windowState || windowState.closing) return;

        if (windowState.minimized) {
            windowState.minimized = false;
        }

        if (!windowState.maximized) {
            windowState.restoreBounds = {
                x: windowState.x,
                y: windowState.y,
                width: windowState.width,
                height: windowState.height
            };
            Object.assign(windowState, this.getMaximizedBounds());
            windowState.maximized = true;
        } else {
            const restoreBounds = windowState.restoreBounds || this.getInitialWindowMetrics(this.apps[windowState.appId] || {}, 0);
            Object.assign(windowState, restoreBounds);
            windowState.maximized = false;
            this.constrainWindows();
        }

        this.focusWindow(id, false);
        this.render();
    }

    closeWindow(id) {
        const windowState = this.getWindow(id);
        if (!windowState || windowState.closing) return;

        windowState.closing = true;
        windowState.focused = false;
        if (this.activeWindowId === id) {
            const nextWindow = this.getTopVisibleWindow(id);
            this.activeWindowId = nextWindow?.id || null;
            if (nextWindow) nextWindow.focused = true;
        }

        this.render();
        window.setTimeout(() => {
            this.windows = this.windows.filter((item) => item.id !== id);
            this.render();
        }, 220);
    }

    getTopVisibleWindow(exceptId = null) {
        return this.windows
            .filter((item) => item.id !== exceptId && !item.minimized && !item.closing)
            .sort((a, b) => b.z - a.z)[0];
    }

    restoreWindow(id) {
        const windowState = this.getWindow(id);
        if (!windowState || windowState.closing) return;
        windowState.minimized = false;
        this.focusWindow(id);
    }

    updateWindowAppState(id, patch) {
        const windowState = this.getWindow(id);
        if (!windowState) return;
        windowState.appState = typeof patch === "function"
            ? patch(windowState.appState)
            : { ...windowState.appState, ...patch };
    }

    renderApp(windowState) {
        const app = this.apps[windowState.appId];
        if (!this.isLaunchableApp(app)) {
            return renderPlaceholderApp({
                title: "Application Under Construction",
                description: "This runtime slot is not available yet."
            });
        }

        try {
            return app.render(this, windowState);
        } catch (error) {
            console.error("Failed to render app:", windowState.appId, error);
            return renderPlaceholderApp({
                title: "Application Under Construction",
                description: "This app hit a simulated runtime fault and has been safely contained."
            });
        }
    }

    notify(title, message) {
        const id = Date.now();
        this.notifications = [{ id, title, message }, ...this.notifications].slice(0, 2);
        window.setTimeout(() => {
            this.notifications = this.notifications.filter((item) => item.id !== id);
            this.render();
        }, 3600);
    }
}

function createAppRegistry() {
    return {
        terminal: {
            id: "terminal",
            title: "Terminal",
            label: "Terminal",
            icon: "TER",
            width: 650,
            height: 400,
            singleInstance: true,
            createState: createTerminalState,
            render: renderTerminalApp,
            bind: bindTerminalApp
        },
        files: {
            id: "files",
            title: "Files",
            label: "Files",
            icon: "FIL",
            width: 600,
            height: 370,
            singleInstance: true,
            render: renderFilesApp
        },
        textfile: placeholder("textfile", "TextFile", "Encrypted note viewer under construction."),
        notes: placeholder("notes", "Apps", "Future app launcher and runtime registry under construction."),
        browser: placeholder("browser", "Browser", "Internal browser sandbox under construction."),
        mail: placeholder("mail", "Mail", "Secure mailbox under construction."),
        database: placeholder("database", "Database", "Database viewer under construction."),
        osint: placeholder("osint", "OSINT", "Investigation toolkit under construction.")
    };
}

function placeholder(id, label, description) {
    return {
        id,
        title: label,
        label,
        description,
        icon: label.slice(0, 3).toUpperCase(),
        width: 470,
        height: 300,
        singleInstance: true,
        render: (runtime) => renderPlaceholderApp(runtime.apps[id])
    };
}

function normalizeUser(user) {
    const username = user?.username || "operator";
    const avatarUrl = user?.avatarUrl || (user?.id && user?.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : FALLBACK_AVATAR);

    return { ...user, username, avatarUrl };
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
