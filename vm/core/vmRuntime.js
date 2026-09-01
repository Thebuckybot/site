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
    createOrgState,
    renderOrgApp,
    mountOrgApp,
    unmountOrgApp
} from "../apps/OrgApp.js";
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
import {
    createMailState,
    renderMailApp,
    mountMailApp,
    unmountMailApp
} from "../apps/MailApp.js";
// MissionHubApp is NOT imported statically. It is locked (see the `missionhub`
// entry in createAppRegistry), and a static import would keep its ~68 KB in the
// initial module graph for a module nobody can open. It is pulled in on demand
// by loadMissionHubModule() below, which is what the preload and dispose paths
// use once the app is unlocked again.
import { renderPlaceholderApp, renderLockedApp } from "../apps/PlaceholderApp.js";
// v3 blok 4 - de launcher. De registry-entry heette al "Apps" en toonde een
// placeholder die zei dat er een launcher in aanbouw was; dit is die launcher.
import {
    createAppsState,
    renderAppsApp,
    mountAppsApp,
    unmountAppsApp,
    focusAppsApp
} from "../apps/AppsApp.js";
import { gatewayClient } from "./gatewayClient.js";
import { assetCache } from "./assetCache.js";
import { createMailService, setMailService } from "./mail/mailService.js";

const FALLBACK_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

// V6 — at WEBSITE STARTUP parse THE master-world GLB ONCE into the in-memory
// AssetCache — mission_hub_master.glb (apartment @ +500 m, Arc 1–5, sky dome,
// lights: ONE file, the whole universe). Opening Mission Hub has NO load screen /
// pop-in and the phone journey issues ZERO extra downloads: everything lives in
// the one cached scene. No HDRI, no env maps — Blender authored sky + lighting
// into the GLB. The cache is freed only when the VM unloads (see dispose()).
// Fire-once, best-effort, never blocks boot. GitHub-Pages-safe: URLs resolve from
// import.meta.url (vm/core/ → vm/assets/…), exactly like MissionHubApp.js does.
let _missionHubPreloaded = false;
// Resolved module promise, or null while Mission Hub has never been touched.
// dispose() checks it so it never imports the module just to tear down assets
// that were never loaded.
let _missionHubModule = null;
function loadMissionHubModule() {
    if (!_missionHubModule) {
        _missionHubModule = import("../apps/MissionHubApp.js");
    }
    return _missionHubModule;
}
function preloadMissionHub() {
    if (_missionHubPreloaded || typeof window === "undefined") return;
    _missionHubPreloaded = true;
    const warm = () => {
        // The master GLB parse-once into the AssetCache at WEBSITE STARTUP (download +
        // GLTF/Draco parse + texture decode), so opening Mission Hub clones the
        // already-cached scene and issues ZERO GLB fetches/parses.
        loadMissionHubModule()
            .then((m) => { try { m.preloadMissionHubAssets(); } catch (_e) {} })
            .catch(() => {}); // mission_hub_master.glb
        // Warm the optional bloom post-FX ESM modules MissionHub may import on open
        // (desktop only — touch devices render directly), so the FIRST open is a
        // module-cache hit. Three core + GLTF/Draco are already warmed by the
        // AssetCache parse above. Keep the version in lockstep with
        // MissionHubApp.js / assetCache.js (three 0.160.0).
        try {
            const JSM = "https://esm.sh/three@0.160.0/examples/jsm";
            [
                `${JSM}/postprocessing/EffectComposer.js`,
                `${JSM}/postprocessing/RenderPass.js`,
                `${JSM}/postprocessing/UnrealBloomPass.js`,
                `${JSM}/postprocessing/OutputPass.js`
            ].forEach((u) => { import(/* @vite-ignore */ u).catch(() => {}); });
        } catch (_e) { /* never block boot on module warm */ }
    };
    // Preload IMMEDIATELY at website start (next tick — never blocks the boot frame).
    setTimeout(warm, 0);
}

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
        // Mission Hub is LOCKED (arc missions + 3D world parked), so priming its
        // assets here would be ~11 MB on every page load for something nobody can
        // open. preloadMissionHub() is deliberately NOT called at boot any more.
        //
        // Nothing else pulls three.js in: MissionHubApp.js and assetCache.js have
        // no static imports at all, and the CDN modules arrive only through
        // AssetCache._defaultLoadDeps()'s dynamic import(). Dropping this call
        // therefore drops three.js, GLTFLoader, DRACOLoader, SkeletonUtils, the
        // Draco decoder wasm and the bloom post-FX modules with it - measured, not
        // assumed. Rapier was already lazy.
        //
        // When Mission Hub is unlocked again, call preloadMissionHub() from the
        // app's open path, not from this constructor.
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

        // Phase 5.0 — the Bucky Mail Platform. MailService owns the encrypted
        // (compress→encrypt) in-memory message store and is registered as
        // runtime.services.mail; the Mail app is a thin client over it. The
        // module singleton lets the script execution layer reach the same
        // instance the desktop app uses (one VM per page). Wrapped so a mail
        // fault never blocks VM boot.
        this.services = {};
        try {
            this.services.mail = setMailService(createMailService({
                user: this.user,
                bus: this.bus,
                filesystem: this.filesystem,
                // Phase 5.0A — the backend gateway enables ONLINE (multiplayer)
                // mail when the operator is authenticated; offline it falls back
                // to the local seeded store (GitHub Pages safe).
                gateway: gatewayClient
            }));
        } catch (error) {
            logError("MailService init", error);
            this.services.mail = null;
        }

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
        // v0.8 (Phase 2) — "VM fully unloads" trigger. pagehide is the real
        // end-of-session; dispose() then frees the AssetCache (and timers/listeners).
        // Guarded against bfcache (event.persisted) so a restored page keeps working.
        this._onPageHide = (event) => { if (!event || !event.persisted) this.dispose(); };
        window.addEventListener("pagehide", this._onPageHide);
        // Win+Pijl schikt het actieve venster. Alleen op het bureaublad, en
        // alleen als de toetsaanslag niet in een invoerveld gebeurt - anders
        // zou een speler die in BuckyCode typt zijn venster verspringen.
        this._onKeyDown = (event) => {
            if (this.phase !== "desktop" || !event.metaKey || event.ctrlKey) return;
            const doel = event.target;
            const naam = doel && doel.tagName ? doel.tagName.toLowerCase() : "";
            if (naam === "input" || naam === "textarea"
                || (doel && doel.isContentEditable)) return;
            const kant = { ArrowLeft: "left", ArrowRight: "right",
                           ArrowUp: "max", ArrowDown: "restore" }[event.key];
            if (!kant) return;
            event.preventDefault();
            this.snapWindow(kant);
        };
        window.addEventListener("keydown", this._onKeyDown);
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
        // MAXIMALISEREN DEKT DE ICONEN AF, en dat is de reparatie van "de
        // maximaliseerknop doet niets".
        //
        // Hier stond een inspringing van 102px links om de iconenrail vrij te
        // houden. Het gevolg was dat een gemaximaliseerd venster 659px breed
        // werd terwijl een venster standaard al 620px is: 39 pixels erbij, wat
        // niet te zien is. De knop wérkte (de klasse ging om, de geometrie
        // veranderde) maar deed zichtbaar niets, en dat is hetzelfde als stuk.
        //
        // Op elk echt bureaublad dekt een gemaximaliseerd venster de iconen af.
        // Dat mag hier ook: vensters staan op z-index 21 en de iconenrail op
        // 18, dus dat klopt vanzelf. De 12px rondom houdt de afgeronde hoek van
        // de VM zichtbaar, zodat het venster niet uit zijn kast lijkt te lopen.
        const rand = 12;
        return {
            x: rand,
            y: rand,
            width: Math.max(330, bounds.width - rand * 2),
            height: Math.max(230, bounds.height - rand - 10)
        };
    }

    /**
     * Half the desktop, left or right — the geometry behind Win+Arrow.
     *
     * Dragging worked; putting two windows side by side did not, and that is
     * exactly what you do the moment you write a script and want to watch its
     * output: BuckyCode next to Terminal. Derived from the maximised bounds so
     * the insets stay in one place.
     */
    getSnapBounds(side) {
        const vol = this.getMaximizedBounds();
        const half = Math.max(330, Math.floor(vol.width / 2) - 4);
        return {
            x: side === "right" ? vol.x + vol.width - half : vol.x,
            y: vol.y,
            width: half,
            height: vol.height
        };
    }

    /**
     * Snap the active window. `side` is "left" | "right" | "max" | "restore".
     *
     * Deliberately a no-op without an active window rather than an error: a
     * stray keypress on an empty desktop is not a fault.
     */
    snapWindow(side) {
        const windowState = this.getWindow(this.activeWindowId);
        if (!windowState || windowState.closing) return;
        if (side === "max") {
            if (!windowState.maximized) this.toggleMaximizeWindow(windowState.id);
            return;
        }
        if (side === "restore") {
            if (windowState.maximized) this.toggleMaximizeWindow(windowState.id);
            else this.minimizeWindow(windowState.id);
            return;
        }
        // Een gesnapt venster is NIET gemaximaliseerd: anders zou de
        // herstelknop hem naar volle breedte brengen in plaats van terug.
        windowState.maximized = false;
        if (windowState.minimized) windowState.minimized = false;
        Object.assign(windowState, this.getSnapBounds(side));
        windowState.restoreBounds = { ...this.getSnapBounds(side) };
        this.focusWindow(windowState.id);
        this.syncWindows();
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

    /**
     * v0.8 (Phase 2) — explicit teardown for when the VM fully unloads (the target
     * of vm-runtime.md §3.4). Idempotent. Clears the clock + resize/pagehide
     * listeners, unmounts windows and the desktop view, and — the Phase 2 addition —
     * frees the shared AssetCache. The Mission Hub GLB cache survives every app
     * open/close; THIS is the only place it is released.
     */
    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        try { if (this.clockTimer) window.clearInterval(this.clockTimer); } catch (_e) { /* ignore */ }
        this.clockTimer = null;
        try { window.removeEventListener("resize", this.resizeHandler); } catch (_e) { /* ignore */ }
        try { if (this._onPageHide) window.removeEventListener("pagehide", this._onPageHide); } catch (_e) { /* ignore */ }
        try { if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown); } catch (_e) { /* ignore */ }
        try { this.teardownWindows(); } catch (_e) { /* ignore */ }
        try { this.teardownDesktopView(); } catch (_e) { /* ignore */ }
        // Only if Mission Hub was actually loaded this session — otherwise there
        // is nothing to dispose and importing the module now would defeat the
        // point of keeping it out of the graph. assetCache.disposeAll() below
        // covers the shared cache either way.
        if (_missionHubModule) {
            _missionHubModule
                .then((m) => { try { m.disposeMissionHubAssets(); } catch (_e) {} })
                .catch(() => {});
        }
        try { assetCache.disposeAll(); } catch (_e) { /* ignore */ }
        debugLog("BuckyVMRuntime disposed");
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
        org: {
            id: "org",
            title: "Organization",
            label: "Org",
            // Drieletterglyph, want dat is wat de titelbalk en de taakbalk
            // renderen - zie de notitie voor waarom het icoon geen avatar is.
            icon: "ORG",
            width: 680,
            height: 520,
            singleInstance: true,
            createState: createOrgState,
            render: renderOrgApp,
            mount: mountOrgApp,
            unmount: unmountOrgApp
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
        apps: {
            id: "apps",
            title: "Apps",
            label: "Apps",
            icon: "APP",
            width: 520,
            height: 430,
            singleInstance: true,
            description: "Every application in the VM, with a search box.",
            createState: createAppsState,
            render: renderAppsApp,
            mount: mountAppsApp,
            unmount: unmountAppsApp,
            onFocus: focusAppsApp
        },
        mail: {
            id: "mail",
            title: "Mail",
            label: "Mail",
            icon: "MAI",
            // Outlook-style three-pane client needs room; clamped to desktop bounds.
            width: 880,
            height: 560,
            singleInstance: true,
            createState: createMailState,
            render: renderMailApp,
            mount: mountMailApp,
            unmount: unmountMailApp
        },
        // Mission Hub — LOCKED. The V6 master-world runtime is intact (apartment
        // → through the phone glass → 500 m drop → Arc 1 arrival), but the arc
        // missions and the 3D world are parked, so opening it would pull ~11 MB
        // for a screen with nothing behind it.
        //
        // The app stays in the registry rather than being removed: the taskbar,
        // `missionhub.link` on the desktop and `apps.sys` all reference it, and
        // an entry that opens to a clear "switched off" panel is better than a
        // dead icon or a missing one. To restore it, put back createState /
        // render / mount / unmount from MissionHubApp.js (dynamically imported
        // via loadMissionHubModule) and drop the `locked` flag.
        missionhub: {
            id: "missionhub",
            title: "Mission Hub",
            label: "Mission Hub",
            icon: "HUB",
            width: 470,
            height: 390,
            singleInstance: true,
            locked: true,
            description: "Mission Hub is offline while the arc missions and the 3D world are being built.",
            lockNote: "Your organization, economy and progression are unaffected.",
            render: (runtime) => renderLockedApp(runtime.apps.missionhub)
        },
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
