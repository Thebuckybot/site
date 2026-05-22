# Desktop Shell — Architecture Specification

> **Document status:** Source of truth.
> **Scope:** The visible operating-system shell — desktop, wallpaper, icons, apps menu, windows, taskbar, notifications, focus, and z-order.
> **Depends on:** `vm-runtime.md`, `render-system.md`, `app-system.md`.
> **Consumed by:** every app (apps live inside windows the shell manages).

---

## 1. Purpose

The desktop shell is the part of the Bucky VM the player perceives *as the operating system*. The runtime is the kernel; the shell is the face. Its job is to make the VM feel like a real desktop OS: a wallpaper with icons, draggable windows with title bars, a taskbar with a clock and running apps, an apps menu, and notifications.

The shell exists to:

1. **Host applications.** Apps do not render themselves to the page — they render *into windows*, and windows are owned by the shell. The shell is the container contract every app plugs into.
2. **Provide OS-grade interaction.** Drag, focus, minimize, maximize, restore, close, and z-ordering are shell concerns, implemented once and shared by every app, so no app re-implements window behavior.
3. **Sell the immersion.** The synthwave wallpaper, the boot/login/session sequences, the scanlines and CRT reflection, the cinematic notifications — these are the shell's responsibility and the reason the VM reads as a place, not a page.
4. **Stay out of the way.** The shell owns chrome and layout; it never owns app logic. An app is a black box that produces a body; the shell frames it.

---

## 2. Architecture Overview

### 2.1 Shell composition

The shell is the `desktop` phase of the runtime (`vm-runtime.md` §3). It is assembled from the components layer:

```
VMContainer            top-level frame, phase switch, mode (embedded/expanded)
  └─ DesktopManager    the desktop: wallpaper, brand, icon rail, window layer, taskbar
       ├─ desktop icons      launchers for registered desktop apps
       ├─ WindowManager      renders + binds every open window
       ├─ Taskbar            user chip, running-app buttons, status, clock
       └─ Notifications      transient toast stack
```

Each component is a pure `render(runtime) → htmlString` function plus, where it has interaction, a `bind(runtime)` function. State lives on the runtime (today directly; under the target architecture, in the `windowing`, `shell`, and `notifications` services — `vm-runtime.md` §4).

### 2.2 Shell services

| Service | Key | Owns |
|---------|-----|------|
| WindowService | `windowing` | The window collection, focus, z-order, geometry, window lifecycle. |
| ShellService | `shell` | Desktop icons, the apps menu/launcher, desktop layout, the focus model. |
| NotificationService | `notifications` | The toast queue and its expiry timers. |

These wrap concerns currently held directly on the runtime (`windows[]`, `activeWindowId`, `nextZ`, `desktopApps`, `notifications[]`, `notify()`).

### 2.3 The container and modes

`VMContainer` renders the outer frame and switches on `phase`. It also implements **mode**: `embedded` (the VM sits inline in the arcade cabinet) and `expanded` (focus mode — a backdrop dims the page and the VM enlarges). Mode is orthogonal to phase: the shell can be embedded or expanded in any phase, and switching mode never disturbs windows. A mobile-lock panel is rendered for viewports too small to host the desktop.

The container also renders the immersion layer — CRT reflection, scanlines, the expand/minimize controls — which sits above the desktop visually but below windows.

---

## 3. Desktop

### 3.1 Composition

The desktop (`DesktopManager`) is the `desktop`-phase surface. It renders, back to front: the **wallpaper** (synthwave sun, grid horizon, cityline), a **desktop brand** plate, the **icon rail**, the **window layer**, and the **taskbar**.

### 3.2 Desktop icons

The icon rail is generated from the runtime's `desktopApps` list — an ordered subset of registered apps chosen to appear on the desktop. Each icon renders the app's glyph and label and carries `data-open-app="<appId>"`. Activating an icon calls `openApp(appId)`.

Icons are **data-driven**: adding an app to the desktop is adding it to the desktop list, not writing markup. Icons reflect app availability — a locked or not-yet-unlocked app (`app-system.md`) renders in a locked style and, when activated, surfaces a notification instead of opening.

### 3.3 Apps menu / launcher

The desktop icon rail shows a curated set. The full set of installed apps is reached through the **apps menu** — a launcher surface (the registered `notes`/"Apps" slot is its placeholder today). The launcher lists every app the player has installed and unlocked, grouped or searchable, and is the canonical place to open apps that are not pinned to the desktop. The launcher is a pure consumer of the `AppRegistry`: it lists what the registry reports as available.

### 3.4 Desktop shortcuts

The base filesystem seeds `/users/<username>/desktop` with `.link` entries (`terminal.link`, `files.link`). These are the data model for desktop shortcuts: a shortcut is a filesystem node of mime `application/bucky-link` whose content names a launch target (an app id, or later a BuckyNet URL or a file path). The desktop icon rail and the Files-app desktop view both read shortcuts from this directory, so creating a shortcut is a filesystem write and shortcuts persist with the filesystem.

---

## 4. Window System

### 4.1 Window state model

A window is created by `createWindow(app, index, appState)` and is a plain object:

| Field | Meaning |
|-------|---------|
| `id` | Unique window id (`<appId>-<timestamp>-<rand>`). |
| `appId` | The app rendered in this window. |
| `title`, `icon` | Chrome label and glyph, taken from the app definition. |
| `x`, `y`, `width`, `height` | Geometry within the window layer. |
| `z` | Stacking order; assigned from the runtime's monotonically increasing `nextZ`. |
| `focused` | Whether this is the active window. |
| `minimized`, `maximized` | Window display state. |
| `dragging` | True during a drag gesture (drives a CSS class, suppresses transitions). |
| `closing` | True during the close animation, before structural removal. |
| `restoreBounds` | Geometry to restore to after un-maximizing or un-minimizing. |
| `appState` | The app's own state object, opaque to the shell. |

The window object is the boundary between shell and app: the shell owns every field except `appState`, which it never inspects.

### 4.2 Window lifecycle

```
openApp(appId)
  → app availability checked (registered + unlocked)
  → singleInstance? focus the existing window instead of opening a second
  → app.createState() builds appState (failure → contained, notification shown)
  → createWindow() → geometry computed (getInitialWindowMetrics) → z assigned
  → window added, marked focused, becomes activeWindowId
  → render

focus      → all others unfocused, z bumped to ++nextZ, activeWindowId set
minimize   → minimized=true; focus passes to the next top visible window
maximize   → restoreBounds saved, geometry set to getMaximizedBounds(); toggles back
restore    → minimized=false, window focused
move       → during drag: style written directly; on drop: commitWindowPosition
close      → closing=true (plays exit animation), removed from collection after ~220ms
```

Every transition is a `windowing`-service method emitting a `window:*` event so the render scheduler and the taskbar update without polling.

### 4.3 Geometry and constraints

Window geometry is constrained to the desktop bounds. `getInitialWindowMetrics` cascades new windows (offset per index) and clamps them to the available area, sized from the app's preferred `width`/`height`. `constrainWindows` re-clamps every window when the desktop resizes or the mode changes, and re-applies maximized bounds to maximized windows. The window layer's measured rectangle (`getDesktopBounds`) is the authority for available space.

### 4.4 Focus model

Exactly one window is `focused`; its id is `activeWindowId`. Focus is acquired on pointer-down anywhere in a window (the shell's delegated handler), on taskbar activation, and on open. Losing focus is implicit — focusing window B unfocuses all others. When the active window is minimized or closed, focus falls to the top-most remaining visible window (`getTopVisibleWindow`). Focus drives chrome styling, taskbar highlighting, and which app receives keyboard input.

`focusWindow` supports a render-suppressing fast path (`syncWindowDomFocus`) that patches the `is-active` class and `z-index` directly instead of re-rendering — the pattern the render system generalizes (`render-system.md` §4.2).

### 4.5 Z-order management

Stacking is a single integer per window, `z`, assigned from the runtime's `nextZ` counter. Focusing a window sets its `z` to `++nextZ`, lifting it above all others. Because `nextZ` only increases, relative order is always correct within a session. The counter growing unbounded is cosmetic; a z-order compaction pass (renumber windows 1..n by current order) is an available future optimization, not a correctness need.

The shell reserves z-index *bands* so layers never collide: wallpaper and immersion layer at the bottom, the window layer in the middle (per-window `z` values live here), the taskbar above windows, notifications above the taskbar, and the expanded-mode backdrop above all desktop content but below the VM frame controls.

### 4.6 Window chrome

`WindowManager` renders each window: a title bar (`data-drag-handle`) with the app icon, title, and minimize/maximize/close controls, and a body containing `runtime.renderApp(windowState)`. Chrome is identical for every app — apps never draw their own title bar. The body is the app's canvas.

### 4.7 Drag and resize

Dragging uses pointer capture on the title bar. During the gesture, position is written straight to `style.left/top`, batched with `requestAnimationFrame`, and clamped to desktop bounds — the scheduler is not involved (`render-system.md` §5.4). On pointer-up, `commitWindowPosition` writes the final geometry and `restoreBounds`. Resizing follows the same gesture pattern from window edges/corners and is the natural extension of the current drag implementation. Maximized and minimized windows are not draggable.

---

## 5. Taskbar

The taskbar (`Taskbar`) is the persistent strip at the foot of the desktop. It renders three zones:

- **User chip** — the linked Discord avatar and username, branding the workstation.
- **Running apps** — one button per open window, reflecting `focused`/`minimized`/`closing` state. Activating a button restores a minimized window or focuses a visible one.
- **Status cluster** — network indicator, battery, and the live clock (`[data-vm-clock]`, patched every second without a full render).

The taskbar is a pure projection of the window collection plus session identity. Its only interaction is window activation, handled by a delegated listener. As the system grows, the taskbar is the natural home for a system tray (background tools, mission/notification indicators) and an apps-menu trigger.

---

## 6. Notifications

`NotificationService` owns a short queue of transient toasts. `notify(title, message)` pushes a toast, caps the queue (newest few kept), and schedules each toast's expiry. `Notifications` renders the stack with `aria-live` for accessibility.

Notifications are the shell's event-feedback channel: identity linked, desktop ready, app unavailable, mission updated, mail received, leak detected. Any subsystem raises one via the service; the service never carries domain logic, only presentation and timing. A future notification center (history, click-through actions, severity levels) is an extension of this service, not a new system.

---

## 7. Important Flows

### 7.1 Flow — boot to desktop

```
start() → [boot] streams boot log → [login] panel with injected identity
        → ENTER SYSTEM → [session] handshake loader
        → [desktop]: wallpaper + icons + empty window layer + taskbar rendered
        → "Desktop ready" notification
```

### 7.2 Flow — open an app from a desktop icon

```
click desktop icon (data-open-app)
  → openApp(appId) → availability + singleInstance checks
  → window created, focused, placed; taskbar gains a button
  → render scheduler dirties window-layer + taskbar
```

### 7.3 Flow — multi-window focus

```
windows A, B, C open; C focused (top z)
click on A → A.focused=true, others false, A.z=++nextZ
           → A rises above B and C; taskbar highlight moves to A
           → keyboard input now routes to A's app
```

### 7.4 Flow — minimize and restore

```
minimize B → B.minimized=true; focus falls to top visible (A or C)
click B's taskbar button → restoreWindow(B): minimized=false, B focused and raised
```

### 7.5 Flow — expand to focus mode

```
click expand → mode=expanded → backdrop fades in, VM enlarges
             → constrainWindows re-clamps windows to the new bounds
             → phase unchanged, windows preserved
click backdrop / minimize → mode=embedded → windows re-clamped again
```

---

## 8. Data Models

| Model | Fields | Owner |
|-------|--------|-------|
| Window | see §4.1 | WindowService |
| Desktop icon | `appId`, glyph, label, availability | ShellService (derived from AppRegistry) |
| Desktop shortcut | filesystem node, mime `application/bucky-link`, target | Filesystem (`/users/<user>/desktop`) |
| Notification | `id`, `title`, `message`, severity (future), expiry | NotificationService |
| Desktop bounds | measured `width`/`height` of the window layer | WindowService (`getDesktopBounds`) |
| Z-bands | wallpaper / windows / taskbar / notifications / backdrop | ShellService (constants) |

---

## 9. Subsystem Responsibilities

| Component | Responsibility |
|-----------|----------------|
| VMContainer | Outer frame, phase switch, mode, immersion layer, mobile lock. |
| DesktopManager | Wallpaper, brand, icon rail, window-layer mount, taskbar mount. |
| WindowManager (component) | Window chrome rendering and drag/resize/focus binding. |
| WindowService | Window collection, lifecycle, focus, z-order, geometry, constraints. |
| ShellService | Desktop icons, apps menu/launcher, shortcuts, focus model, z-bands. |
| Taskbar | Running-app projection, status cluster, clock. |
| NotificationService + Notifications | Toast queue, timing, and rendering. |

---

## 10. Dependencies

- **Runtime** — phase/mode state, the service registry, the event bus.
- **App system** (`app-system.md`) — window content (`renderApp`), app definitions, availability/unlock state for icons and the launcher.
- **Render system** (`render-system.md`) — window-layer, per-window, taskbar, and notification regions; delegated listeners; the focus fast-path.
- **Filesystem** (`filesystem.md`) — desktop shortcuts stored under `/users/<user>/desktop`.
- **Session service** — avatar and username for the taskbar user chip.

The shell depends on no domain subsystem; domain apps depend on the shell to be hosted.

---

## 11. Extension Points

- **New shell component** — a system tray, a global search bar, a start-menu launcher: each is a component registered as a render region.
- **New window state** — pinned/always-on-top, snap-to-edge tiling, or grouped windows extend the window model and the `windowing` service.
- **Notification severity and actions** — info/success/warning/alert styling and click-through actions extend `NotificationService`.
- **Themeable wallpaper** — wallpaper as a data-driven, swappable asset (unlockable through progression).
- **Desktop widgets** — non-window desktop surfaces (a clock widget, a mission tracker) registered as desktop regions.
- **Workspaces** — multiple virtual desktops, each a window-collection scope.
- **Lock screen** — an idle/lock phase reusing the login surface.

Every extension is additive: register a component/region, extend a shell service, or add a window field — never edit unrelated apps.

---

## 12. Scalability Concerns

| Concern | Mitigation |
|---------|------------|
| Many open windows re-rendering together | Each window is an independent render region (`render-system.md`); one window's update never reconciles another. |
| Listener churn across windows | Delegated listeners on the VM root for `data-open-app`, `data-window-action`, `data-task-window`, `data-drag-handle`. |
| Taskbar crowding with many apps | Running-app buttons collapse/group; an overflow menu and a system tray absorb the excess. |
| Desktop icon sprawl | The desktop rail stays curated; the apps menu/launcher is the scalable surface for the full app set. |
| Z-index inflation | Cosmetic within a session; optional z-order compaction pass. |
| Resize storms | `constrainWindows` is O(windows) and cheap; resize handling is debounced through the render scheduler. |
| Drag performance | Pointer-capture gestures write `style` directly and bypass the scheduler. |

---

## 13. Future Systems

- **Apps-menu launcher** with search and grouping over the full installed-app set.
- **System tray** for background tools, mission indicators, and connection status.
- **Notification center** with history, severity, and actionable toasts.
- **Window snapping/tiling** and multi-workspace support.
- **Lock screen / idle state** as an additional phase.
- **Themeable, unlockable wallpapers and desktop widgets** tied to progression.
- **Desktop context menu** for creating shortcuts, folders, and arranging icons.

---

## 14. Recommended Implementation Order

1. **Extract `WindowService`** — move `windows`, `activeWindowId`, `nextZ`, and the window lifecycle methods off the runtime into a registered service emitting `window:*` events.
2. **Extract `ShellService`** — desktop icons, focus model, z-bands as constants.
3. **Extract `NotificationService`** — queue, timers, and `notify` as a service emitting `notification:posted`.
4. **Adopt render regions** — window-layer, per-window, taskbar, notifications as scheduler regions with delegated root listeners (`render-system.md`).
5. **Window resize** — add edge/corner resize using the existing drag-gesture pattern.
6. **Apps-menu launcher** — build the launcher over the AppRegistry; wire the placeholder Apps slot.
7. **Desktop shortcuts** — formalize `.link` nodes (`application/bucky-link`) and render the desktop rail from `/users/<user>/desktop`.
8. **System tray + notification center** — once background tools and event-driven notifications (mail, leaks, missions) exist.
9. **Window snapping, workspaces, lock screen** — richer shell behavior as the app count grows.
10. **Themeable wallpaper and desktop widgets** — cosmetic progression rewards.

Steps 1–4 turn the shell from runtime-coupled code into clean services with scoped rendering; everything after is additive feature work.
