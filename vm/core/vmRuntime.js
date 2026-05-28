/**
 * BuckyVMRuntime — the Bucky VM kernel.
 *
 * Owns the lifecycle, the shared runtime services (event bus + filesystem),
 * the window collection and the render orchestration. See
 * docs/architecture/vm-runtime.md and docs/architecture/render-system.md.
 *
 * Rendering model (Phase 1):
 *   - render()        full shell rebuild — used only for phase/mode changes.
 *   - syncWindows()   targeted window-layer reconciliation — create / patch /
 *                     remove window elements without rebuilding the desktop.
 *   - updateTaskbar() / updateNotifications() — targeted region updates.
 * Filesystem mutations never trigger a full rerender: apps subscribe to the
 * event bus and update their own DOM in place.
 */
import { createEventBus } from "./eventBus.js";
import { createVirtualFilesystem } from "./filesystem.js";
import { createWindow } from "./windowManager.js";
import { clamp, elementFromHtml } from "./util.js";
import { setDebugMode, debugLog, logError } from "./diagnostics.js";
import { renderVMContainer } from "../components/VMContainer.js";
import {
    renderWindowElement,
    patchWindowElement,
    bindWindowElement
} from "../components/WindowManager.js";
import { renderTaskApps, bindTaskbar } from "../components/Taskbar.js";
import { renderNotificationItems } from "../components/Notifications.js";
import {
    renderDesktopIcons,
    handleDesktopClick,
    handleDesktopDblClick
} from "../components/DesktopManager.js";
import {
    createTerminalState,
    renderTerminalApp,
    mountTerminalApp,
    unmountTerminalApp,
    focusTerminalApp
} from "../apps/TerminalApp.js";
import {
    createFilesState,
    renderFilesApp,
    mountFilesApp,
    unmountFilesApp,
    applyFilesIntent
} from "../apps/FilesApp.js";
import {
    createBuckyCodeState,
    renderBuckyCodeApp,
    mountBuckyCodeApp,
    unmountBuckyCodeApp,
    applyBuckyCodeIntent,
    focusBuckyCodeApp,
    matchBuckyCodeWindow
} from "../apps/BuckyCodeApp.js";
import {
    createBrowserState,
    renderBrowserApp,
    mountBrowserApp,
    unmountBrowserApp
} from "../apps/browser/BrowserApp.js";
import { renderPlaceholderApp } from "../apps/PlaceholderApp.js";
import { gatewayClient } from "./gatewayClient.js";

const FALLBACK_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

export class BuckyVMRuntime {
    constructor(root, user = {}, options = {}) {
        this.root = root;
        this.user = normalizeUser(user);
        // Phase 4.3 — propagate the operator's auth token into the gateway
        // BEFORE any identity-aware page (bucky://profile, leaderboards, etc.)
        // performs its first fetch. The token is what makes /api/player/me
        // resolve to a real identity instead of returning 401 (the previous
        // "anonymous visitor" failure mode).
        const token = user && (user.api_token || user.access_token || user.token);
        if (token) {
            gatewayClient.setAuthToken(token);
        }
        // Phase 4.3 polish — eagerly build the BuckyNet site registry so its
        // boot-time preload hooks fire NOW (before the user navigates to any
        // identity-aware page). Wrapped to never break VM boot if a site
        // module throws on first construction. The registry is built once and
        // memoised; subsequent browser-window opens reuse it.
        try {
            // Lazy import keeps the cycle clean: vmRuntime -> BrowserApp ->
            // buckynet is the normal path. Calling getBuckyNet() here just
            // primes the same singleton early.
            import("../apps/browser/buckynet.js")
                .then((m) => { try { m.getBuckyNet(); } catch (_e) {} })
                .catch(() => {});
        } catch (_e) { /* never block VM boot on preload priming */ }
        this.debug = Boolean(options.debug);
        setDebugMode(this.debug);
        this.mode = "embedded";
        this.phase = "boot";
        this.bootLines = [];
        this.sessionLines = [];
        this.windows = [];
        // id -> windowState for windows that currently have a mounted element.
        this.windowRegistry = new Map();
        // Desktop (filesystem-backed) view state.
        this.desktopSelection = null;
        this.desktopCleanups = [];
        this.notifications = [];
        this.activeWindowId = null;
        this.nextZ = 20;
        this.clock = "--:--";

        // Shared runtime services.
        this.bus = createEventBus();
        this.filesystem = createVirtualFilesystem(this.user.username, this.bus);

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

        this.resizeHandler = () => {
            if (this.phase !== "desktop") return;
            this.constrainWindows();
            this.syncWindows();
        };
    }

    // ----- Lifecycle ---------------------------------------------------------

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
            this.render();
            this.notify("Desktop ready", "Open Terminal or Files from the desktop");
        }, 2300);
    }

    tickClock() {
        this.clock = new Intl.DateTimeFormat([], {
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date());
        this.root.querySelector("[data-vm-clock]")?.replaceChildren(this.clock);
    }

    // ----- Rendering ---------------------------------------------------------

    /** Full shell rebuild. Reserved for phase and mode changes. */
    render() {
        this.teardownWindows();
        this.teardownDesktopView();
        this.constrainWindows();
        this.root.innerHTML = renderVMContainer(this);
        this.bindShell();
        if (this.phase === "desktop") {
            this.syncWindows();
            this.mountDesktopView();
        }
    }

    /** Bind the static shell controls. Runs once per full render. */
    bindShell() {
        const root = this.root;
        root.querySelector("[data-vm-expand]")?.addEventListener("click", () => this.setMode("expanded"));
        root.querySelector("[data-vm-minimize]")?.addEventListener("click", () => this.setMode("embedded"));
        root.querySelector("[data-vm-backdrop]")?.addEventListener("click", () => this.setMode("embedded"));
        root.querySelector("[data-vm-login]")?.addEventListener("click", () => this.startDesktopBoot());
        bindTaskbar(this);
    }

    /**
     * Reconcile the window layer against `this.windows`.
     * Creates missing windows (and mounts their apps), patches existing ones
     * in place (no body rebuild), and drops orphaned elements.
     */
    syncWindows() {
        if (this.phase !== "desktop") return;
        const layer = this.root.querySelector(".vm-window-layer");
        if (!layer) return;

        // Remove window elements with no runtime state, fully unmounting their
        // app first so bus subscriptions never leak. syncWindows is the single
        // owner of window element create/remove.
        layer.querySelectorAll(".vm-window").forEach((element) => {
            const id = element.dataset.windowId;
            if (!this.windows.some((windowState) => windowState.id === id)) {
                const stale = this.windowRegistry.get(id);
                if (stale) this.unmountWindow(stale, element);
                this.windowRegistry.delete(id);
                element.remove();
                debugLog("window removed", id);
            }
        });

        // Create missing windows (mounting their apps); patch the rest in
        // place — an existing window's app body is never rebuilt here.
        this.windows.forEach((windowState) => {
            let element = layer.querySelector(`[data-window-id="${windowState.id}"]`);
            if (!element) {
                element = elementFromHtml(renderWindowElement(this, windowState));
                layer.appendChild(element);
                bindWindowElement(this, windowState, element);
                this.mountWindow(windowState, element);
            } else {
                patchWindowElement(this, windowState, element);
            }
        });
    }

    mountWindow(windowState, element) {
        const app = this.apps[windowState.appId];
        windowState.view = windowState.view || {};
        windowState.view.cleanups = windowState.view.cleanups || [];
        if (app && typeof app.mount === "function") {
            try {
                app.mount(this, windowState, element);
            } catch (error) {
                logError(`mount(${windowState.appId})`, error);
            }
        }
        this.windowRegistry.set(windowState.id, windowState);
        debugLog("window mounted", windowState.appId, windowState.id);
    }

    unmountWindow(windowState, element) {
        const app = this.apps[windowState.appId];
        if (app && typeof app.unmount === "function") {
            try {
                app.unmount(this, windowState, element);
            } catch (error) {
                logError(`unmount(${windowState.appId})`, error);
            }
        }
        windowState.view = {};
    }

    /** Unmount every currently mounted window (before a full render). */
    teardownWindows() {
        this.windows.forEach((windowState) => {
            const element = this.root.querySelector(`[data-window-id="${windowState.id}"]`);
            if (element) this.unmountWindow(windowState, element);
        });
        this.windowRegistry.clear();
    }

    /** Targeted update of the taskbar running-app region. */
    updateTaskbar() {
        const slot = this.root.querySelector(".vm-task-apps");
        if (!slot) return;
        slot.innerHTML = renderTaskApps(this);
        bindTaskbar(this);
    }

    /** Targeted update of the notification stack. */
    updateNotifications() {
        const layer = this.root.querySelector(".vm-notifications");
        if (layer) layer.innerHTML = renderNotificationItems(this);
    }

    /** Targeted update of the desktop icon area from the filesystem. */
    updateDesktopIcons() {
        const container = this.root.querySelector(".vm-desktop-icons");
        if (!container) return;
        if (this.desktopSelection && !this.filesystem.exists(this.desktopSelection)) {
            this.desktopSelection = null;
        }
        container.innerHTML = renderDesktopIcons(this);
    }

    /** Bind desktop-icon interaction and subscribe the desktop to fs:* events. */
    mountDesktopView() {
        const container = this.root.querySelector(".vm-desktop-icons");
        if (!container) return;
        container.addEventListener("click", (event) => handleDesktopClick(this, event));
        container.addEventListener("dblclick", (event) => handleDesktopDblClick(this, event));

        const desktopPath = this.filesystem.desktopPath;
        const onFsChange = (payload) => {
            if (!payload || payload.parentPath === desktopPath) this.updateDesktopIcons();
        };
        ["fs:node-created", "fs:node-updated", "fs:node-deleted"].forEach((eventName) => {
            this.desktopCleanups.push(this.bus.on(eventName, onFsChange));
        });
    }

    /** Release the desktop's fs:* subscriptions before a full render. */
    teardownDesktopView() {
        this.desktopCleanups.forEach((cleanup) => {
            try {
                cleanup();
            } catch (error) {
                logError("desktop teardown", error);
            }
        });
        this.desktopCleanups = [];
    }

    /**
     * Targeted update of a window's chrome title (and its taskbar entry).
     * Lets an app reflect document state — e.g. BuckyCode showing the open
     * filename — without a rerender.
     */
    setWindowTitle(id, title) {
        const windowState = this.getWindow(id);
        if (!windowState || windowState.title === title) return;
        windowState.title = title;
        const strong = this.root.querySelector(`[data-window-id="${id}"] .vm-window-title strong`);
        if (strong) strong.textContent = title;
        this.updateTaskbar();
    }

    setMode(mode) {
        this.mode = mode;
        const expanded = mode === "expanded";
        document.body.classList.toggle("vm-focus-active", expanded);

        // Targeted update: a mode change only toggles shell classes. Windows
        // and their apps are never torn down or rebuilt — no full rerender.
        const shell = this.root.querySelector(".bucky-vm-shell");
        if (shell) {
            shell.classList.toggle("is-expanded", expanded);
            shell.classList.toggle("is-embedded", !expanded);
        }
        const backdrop = this.root.querySelector(".bucky-vm-backdrop");
        if (backdrop) backdrop.classList.toggle("is-visible", expanded);

        if (this.phase === "desktop") {
            this.constrainWindows();
            this.syncWindows();
            window.requestAnimationFrame(() => {
                this.constrainWindows();
                this.syncWindows();
            });
        }
        debugLog("mode changed", mode);
    }

    // ----- Apps & windows ----------------------------------------------------

    openApp(appId, payload) {
        const app = this.apps[appId];
        if (!this.isLaunchableApp(app)) {
            this.notify("Application unavailable", `${appId || "Unknown"} is not registered yet`);
            return;
        }

        const existing = this.findReusableWindow(app, payload);
        if (existing) {
            if (payload && typeof app.applyIntent === "function") {
                try {
                    app.applyIntent(this, existing, payload);
                } catch (error) {
                    logError(`applyIntent(${appId})`, error);
                }
            }
            this.restoreWindow(existing.id);
            return;
        }

        let appState = {};
        try {
            appState = app.createState ? app.createState(this.user, this.filesystem, payload) : {};
        } catch (error) {
            logError(`createState(${appId})`, error);
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
        this.syncWindows();
        this.updateTaskbar();
        debugLog("app opened", appId, windowState.id);

        this.invokeOnFocus(windowState);
    }

    /**
     * Find an already-open window a launch should reuse instead of opening a
     * new one. A single-instance app reuses its sole window; a multi-instance
     * app that defines `matchWindow` reuses a window matching the payload
     * (e.g. BuckyCode keyed on the open file path). Closing windows are never
     * reused — reopening an app mid-close-animation must spawn a fresh window,
     * not silently target a window about to vanish (the cause of an app
     * appearing to need repeated clicks to reopen).
     */
    findReusableWindow(app, payload) {
        if (app.singleInstance) {
            return this.windows.find((item) => item.appId === app.id && !item.closing) || null;
        }
        if (typeof app.matchWindow === "function") {
            return this.windows.find((item) => {
                if (item.appId !== app.id || item.closing) return false;
                try {
                    return Boolean(app.matchWindow(this, item, payload));
                } catch (error) {
                    logError(`matchWindow(${app.id})`, error);
                    return false;
                }
            }) || null;
        }
        return null;
    }

    /** Re-assert an app's keyboard focus when its window becomes active. */
    invokeOnFocus(windowState) {
        const element = this.root.querySelector(`[data-window-id="${windowState.id}"]`);
        const app = this.apps[windowState.appId];
        if (element && app && typeof app.onFocus === "function") {
            try {
                app.onFocus(this, windowState, element);
            } catch (error) {
                logError(`onFocus(${windowState.appId})`, error);
            }
        }
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

    focusWindow(id) {
        const windowState = this.getWindow(id);
        if (!windowState || windowState.closing) return;

        // Already the active, top, visible window: skip window-layer and
        // taskbar reconciliation and only re-assert app focus. Every click
        // inside the active window's body routes here; without this guard each
        // one would needlessly patch every window and rebuild the taskbar.
        if (this.activeWindowId === id && windowState.focused && !windowState.minimized) {
            this.invokeOnFocus(windowState);
            return;
        }

        this.windows.forEach((item) => {
            item.focused = item.id === id;
        });
        windowState.z = ++this.nextZ;
        this.activeWindowId = id;
        this.syncWindows();
        this.updateTaskbar();
        this.invokeOnFocus(windowState);
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
        if (action === "minimize") this.minimizeWindow(id);
        else if (action === "maximize") this.toggleMaximizeWindow(id);
        else if (action === "close") this.closeWindow(id);
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

        this.syncWindows();
        this.updateTaskbar();
    }

    toggleMaximizeWindow(id) {
        const windowState = this.getWindow(id);
        if (!windowState || windowState.closing) return;

        if (windowState.minimized) windowState.minimized = false;

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
            const restoreBounds = windowState.restoreBounds
                || this.getInitialWindowMetrics(this.apps[windowState.appId] || {}, 0);
            Object.assign(windowState, restoreBounds);
            windowState.maximized = false;
            this.constrainWindows();
        }

        // focusWindow may early-return without reconciling when this window is
        // already active; syncWindows then guarantees the new maximize/restore
        // geometry is patched to the DOM. Without this, clicking maximize on
        // the already-focused window changed state but never re-rendered.
        this.focusWindow(id);
        this.syncWindows();
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

        // Patch in the closing animation, then drop the window from state.
        // syncWindows owns the actual element unmount + removal.
        this.syncWindows();
        this.updateTaskbar();

        window.setTimeout(() => {
            this.windows = this.windows.filter((item) => item.id !== id);
            this.syncWindows();
            this.updateTaskbar();
            debugLog("window closed", id);
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
            logError(`render(${windowState.appId})`, error);
            return renderPlaceholderApp({
                title: "Application Under Construction",
                description: "This app hit a simulated runtime fault and has been safely contained."
            });
        }
    }

    notify(title, message) {
        const id = `${Date.now()}-${Math.random()}`;
        this.notifications = [{ id, title, message }, ...this.notifications].slice(0, 2);
        this.updateNotifications();
        window.setTimeout(() => {
            this.notifications = this.notifications.filter((item) => item.id !== id);
            this.updateNotifications();
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
            mount: mountTerminalApp,
            unmount: unmountTerminalApp,
            onFocus: focusTerminalApp
        },
        files: {
            id: "files",
            title: "Files",
            label: "Files",
            icon: "FIL",
            width: 620,
            height: 400,
            singleInstance: true,
            createState: createFilesState,
            render: renderFilesApp,
            mount: mountFilesApp,
            unmount: unmountFilesApp,
            applyIntent: applyFilesIntent
        },
        buckycode: {
            id: "buckycode",
            title: "BuckyCode",
            label: "BuckyCode",
            icon: "COD",
            width: 640,
            height: 430,
            // Multi-instance: several files can be edited side by side. Opening
            // a file that is already open focuses that window (matchWindow)
            // instead of spawning a duplicate.
            singleInstance: false,
            matchWindow: matchBuckyCodeWindow,
            createState: createBuckyCodeState,
            render: renderBuckyCodeApp,
            mount: mountBuckyCodeApp,
            unmount: unmountBuckyCodeApp,
            onFocus: focusBuckyCodeApp,
            applyIntent: applyBuckyCodeIntent
        },
        browser: {
            id: "browser",
            title: "Browser",
            label: "Browser",
            icon: "NET",
            width: 760,
            height: 520,
            // Multi-instance: each browser window is an independent browsing
            // context with its own history and viewport. No matchWindow —
            // every launch opens a fresh window (Phase 3A; tabs are Phase 3B).
            singleInstance: false,
            createState: createBrowserState,
            render: renderBrowserApp,
            mount: mountBrowserApp,
            unmount: unmountBrowserApp
        },
        notes: placeholder("notes", "Apps", "Future app launcher and runtime registry under construction."),
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
