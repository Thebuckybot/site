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
            this.apps.notes,
            this.apps.textfile,
            this.apps.browser,
            this.apps.mail,
            this.apps.database,
            this.apps.osint
        ];
    }

    start() {
        this.render();
        this.tickClock();
        this.clockTimer = window.setInterval(() => this.tickClock(), 1000);
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
        document.body.style.overflow = mode === "expanded" ? "hidden" : "auto";
        this.render();
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
        if (!app) return;

        const existing = this.windows.find((item) => item.appId === appId && app.singleInstance);
        if (existing) {
            this.restoreWindow(existing.id);
            return;
        }

        const appState = app.createState ? app.createState(this.user, this.filesystem) : {};
        const windowState = createWindow(app, this.windows.length, appState);
        const metrics = this.getInitialWindowMetrics(app, this.windows.length);
        Object.assign(windowState, metrics);
        windowState.z = ++this.nextZ;
        this.windows = [...this.windows, windowState];
        this.activeWindowId = windowState.id;
        this.render();
    }

    getInitialWindowMetrics(app, index) {
        const vmRect = this.root.querySelector(".bucky-vm")?.getBoundingClientRect();
        const vmWidth = vmRect?.width || 900;
        const vmHeight = vmRect?.height || 520;
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

    getWindow(id) {
        return this.windows.find((windowState) => windowState.id === id);
    }

    focusWindow(id, shouldRender = true) {
        const windowState = this.getWindow(id);
        if (!windowState) return;
        windowState.z = ++this.nextZ;
        windowState.minimized = false;
        this.activeWindowId = id;
        if (shouldRender) this.render();
    }

    moveWindow(id, x, y) {
        const windowState = this.getWindow(id);
        if (!windowState) return;
        windowState.x = x;
        windowState.y = y;
        const element = this.root.querySelector(`[data-window-id="${id}"]`);
        if (element) {
            element.style.left = `${x}px`;
            element.style.top = `${y}px`;
        }
    }

    windowAction(id, action) {
        const windowState = this.getWindow(id);
        if (!windowState) return;

        if (action === "minimize") {
            windowState.minimized = true;
            this.activeWindowId = null;
        }

        if (action === "maximize") {
            windowState.maximized = !windowState.maximized;
            windowState.z = ++this.nextZ;
            this.activeWindowId = id;
        }

        if (action === "close") {
            this.windows = this.windows.filter((item) => item.id !== id);
            if (this.activeWindowId === id) {
                const nextWindow = this.windows
                    .filter((item) => !item.minimized)
                    .sort((a, b) => b.z - a.z)[0];
                this.activeWindowId = nextWindow?.id || null;
            }
        }

        this.render();
    }

    restoreWindow(id) {
        const windowState = this.getWindow(id);
        if (!windowState) return;
        windowState.minimized = false;
        windowState.z = ++this.nextZ;
        this.activeWindowId = id;
        this.render();
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
        return app?.render ? app.render(this, windowState) : "";
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
        notes: placeholder("notes", "Apps", "Future app launcher and runtime registry."),
        textfile: placeholder("textfile", "TextFile", "Encrypted note viewer placeholder."),
        browser: placeholder("browser", "Browser", "Future internal browser sandbox."),
        mail: placeholder("mail", "Mail", "Future secure mailbox."),
        database: placeholder("database", "Database", "Future database viewer."),
        osint: placeholder("osint", "OSINT", "Future investigation toolkit.")
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
