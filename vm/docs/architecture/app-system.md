# App System — Architecture Specification

> **Document status:** Source of truth.
> **Scope:** How applications are defined, registered, launched, hosted in windows, gated, installed, and how they communicate.
> **Depends on:** `vm-runtime.md`, `desktop-shell.md`, `render-system.md`, `filesystem.md`.
> **Consumed by:** every application module under `vm/apps/`.

---

## 1. Purpose

The app system is the framework that makes the Bucky VM a *platform* rather than a fixed program. Every visible tool — Files, Browser, Mail, BuckyCode, BuckyShark, the Leak Viewer, the Wiki, the Social platform, OSINT tooling — is an **app**: a self-contained module that satisfies a contract and is *registered*, not hard-wired.

The app system exists to guarantee:

1. **Uniform hosting.** Every app renders into a standard window with standard chrome. Apps never draw their own title bars, never manage their own z-order, never touch the page outside their window body.
2. **Trivial extensibility.** Adding the fiftieth app is the same operation as adding the second: write a module, register a definition. No existing app or component is edited.
3. **Isolation.** Apps never import each other. All cross-app interaction goes through runtime services and the event bus (`vm-runtime.md`). This keeps modules independently buildable and replaceable.
4. **Progression awareness.** Apps can be locked, level-gated, mission-gated, or installed. The set of usable apps is a function of account state, exactly like terminal tools.

This document specifies the app contract, the registry, the lifecycle, gating, app-to-app communication, and the design of **BuckyCode**, the VM's editor and developer environment.

---

## 2. Architecture Overview

### 2.1 Current implementation

`vmRuntime.js` builds an **app registry** (`createAppRegistry`) — a map of app definitions. Each definition has `id`, `title`, `label`, `icon`, preferred `width`/`height`, `singleInstance`, and functions `createState`, `render`, and `bind`. The runtime validates an app with `isLaunchableApp` (must have `id`, `title`, and a `render` function), opens it via `openApp`, and renders it with `renderApp` — both wrapped in try/catch so a faulty app is *contained* (a placeholder is shown) rather than crashing the VM. Apps that are not fully implemented use a shared `placeholder(...)` definition rendering `PlaceholderApp`.

Today the registry holds Terminal and Files as real apps and `textfile`, `notes` (Apps menu), `browser`, `mail`, `database`, `osint` as placeholders. This is the correct skeleton; the target architecture formalizes it into an `AppRegistry` service with lifecycle hooks, gating, permissions, and install flow.

### 2.2 Target architecture

```
AppRegistry (runtime.services.apps)
  ├─ definitions      id → app definition
  ├─ availability     registered / installable / locked / hidden per app
  ├─ install state    which apps are installed (session + persistent)
  └─ gating           level / mission / package rules
        │  consumed by
        ├─ ShellService     desktop icons + apps-menu launcher
        ├─ WindowService    creates windows that host apps
        └─ openApp flow     availability → state → window → mount
```

The runtime keeps `openApp`/`renderApp` as orchestration; the *policy* (what is available, what is gated) moves into `AppRegistry`.

### 2.3 Three-part app module

Each app is one module under `vm/apps/`, exporting:

- **A definition** — static metadata (`id`, `title`, `label`, `icon`, geometry, `singleInstance`, `gating`, `permissions`, `category`).
- **Render/lifecycle functions** — `createState`, `render`, `mount`, `update`, `unmount` (see §4).
- **Nothing else.** No exports consumed by other apps. An app's only outward surface is the events it emits and the services it calls.

---

## 3. App Definition Model

An app definition is the registry entry. It is pure data plus function references.

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Unique app id (`terminal`, `files`, `browser`, `mail`, `buckycode`, …). |
| `title` | string | Window title-bar text. |
| `label` | string | Short name for desktop icon / launcher. |
| `icon` | string | Glyph/asset for chrome, desktop, taskbar. |
| `category` | string | `system`, `tools`, `network`, `intel`, `comms`, `dev`. Drives apps-menu grouping. |
| `width`, `height` | number | Preferred initial window size (clamped to desktop bounds). |
| `singleInstance` | boolean | If true, a second `openApp` focuses the existing window instead of opening another. |
| `gating` | object | Availability rules — `level`, `mission`, `package` (§6). |
| `permissions` | string[] | Service capabilities the app requests (§5). |
| `createState` | function | Builds the app's `appState` for a new window. |
| `render` | function | `(runtime, windowState) → htmlString` for the window body. |
| `mount` | function | One-time setup when the window body enters the DOM. |
| `update` | function | Optional targeted update for a known change (`render-system.md`). |
| `unmount` | function | Optional resource release on window close. |

`createState` failures and `render` failures are contained: the runtime catches them, shows a placeholder, and notifies — a single broken app never takes down the desktop.

---

## 4. App Lifecycle

### 4.1 Lifecycle phases

```
register → (available?) → launch → createState → window created
        → mount → [ render ⇄ update ]* → unmount → window destroyed
```

| Phase | What happens |
|-------|--------------|
| **register** | The definition is added to `AppRegistry` at boot or on install. |
| **launch** | `openApp(id)` runs; availability and `singleInstance` are checked. |
| **createState** | `createState(user, services)` builds the per-window `appState`. |
| **window created** | `WindowService` creates the window, computes geometry, assigns z, focuses it. |
| **mount** | The window body is in the DOM; the app attaches its listeners and live sub-region controllers (once). |
| **render / update** | `render` produces the body; `update` applies targeted changes; the render scheduler decides which to call (`render-system.md` §6). |
| **unmount** | On close, the app releases timers, bus subscriptions, and pointer captures. |
| **window destroyed** | After the close animation, `WindowService` removes the window. |

### 4.2 The render/mount split

The current contract is `render` + `bind`. The target contract splits `bind` into **`mount`** (one-time: attach app-local listeners, capture sub-region nodes) and **`update`** (per-change: targeted DOM patching). This is what lets live apps (Terminal, BuckyCode, Browser) update at 60fps without re-running setup. The migration is mechanical: today's `bind` body is partitioned into setup-once and update-on-change halves.

### 4.3 Window ↔ app boundary

The window object (`desktop-shell.md` §4.1) is owned entirely by the shell *except* `appState`, which the shell never inspects. The app owns `appState` and nothing else about the window. The app reaches its window only through the `windowState` reference passed to its functions. This clean split means window behavior (drag, focus, maximize) is implemented once and inherited by every app.

### 4.4 Multi-instance vs single-instance

`singleInstance: true` apps (Terminal, Files, Mail, Browser, OSINT) keep one window; re-launching focuses it. Multi-instance apps (BuckyCode, for editing several files; a future viewer) open a fresh window with fresh `appState` each launch. The flag is a property of the definition; the launch flow honors it.

---

## 5. App Permissions

### 5.1 Concept

An app declares the **capabilities** it needs in `permissions`. Permissions are not a security sandbox against malicious code (all apps are first-party) — they are an *architectural contract* and a *clarity tool*: they document what an app touches, let the registry reason about apps, and let the system reveal capability requirements to the player as flavor ("Mail requests: mailbox access, filesystem write").

### 5.2 Capability set

| Permission | Grants access to |
|------------|------------------|
| `fs.read` / `fs.write` | Reading / mutating the virtual filesystem. |
| `net` | Issuing BuckyNet requests via NetworkService. |
| `mail` | Reading/sending through MailService. |
| `db` | Querying DatabaseService datasets. |
| `osint` | Using the OSINT correlation engine. |
| `missions` | Reading/advancing mission state. |
| `packages` | Installing packages/apps. |
| `windows` | Opening or messaging other apps' windows. |
| `notifications` | Posting toasts. |

The Command Context (`terminal-system.md` §3.4) is the analogous mechanism for terminal tools; permissions are its app-level counterpart. An app receives a services facade scoped to its granted permissions.

---

## 6. App Availability and Gating

Apps share the gating model with terminal tools (`terminal-system.md` §6). An app's `gating` composes three optional gates:

| Gate | Source |
|------|--------|
| `level` | Player progression level (`session` service). |
| `mission` | A mission flag/state (`mission-progression.md`). |
| `package` | The app is delivered by a package that must be installed (`packages` service). |

Resulting availability states:

| State | Meaning | Desktop / launcher behavior |
|-------|---------|-----------------------------|
| **available** | Registered, ungated or gates pass. | Normal icon; opens. |
| **installable** | Delivered by a known, uninstalled package. | "Install" affordance. |
| **locked** | Known but a level/mission gate fails. | Locked-style icon; opening explains the requirement via notification. |
| **hidden** | Not surfaced until unlocked (spoiler/late-game apps). | Absent from desktop and launcher until revealed. |

The current `openApp` already refuses unlaunchable apps with a notification ("Application unavailable"). Gating extends this with the *reason* and the path to access.

---

## 7. App Installation Flow

Apps can ship with the build or arrive as packages, exactly like tools:

- **Built-in apps** — registered at boot (Terminal, Files, the apps menu).
- **Packaged apps** — delivered by a PackageService package; installing the package registers the app definition into `AppRegistry` and emits `app:installed`.

```
install <package containing an app>
  → PackageService validates gating, plays the install animation
  → registers the package's command descriptors AND its app definition
  → emit app:installed → ShellService adds the icon / launcher entry
  → emit notification "App installed"
```

Unlocks (a mission completes, a level is reached, a Discord economy purchase syncs) flip gating flags via PersistenceService; `AppRegistry` re-evaluates availability and emits `app:unlocked`, and the desktop/launcher update. This is how apps become "unlockable" and "level-gated" without per-app special casing.

---

## 8. App-to-App Communication

Apps never call each other directly. Three sanctioned channels:

### 8.1 Shared services

The primary channel. Apps collaborate *through state*, not calls: the terminal writes a file, the Files app shows it, BuckyCode edits it — all via `FileSystemService`. Mail links to a browser page; the Browser opens it via `NetworkService`. The filesystem and the domain services are the integration surface.

### 8.2 The event bus

Apps emit and subscribe to bus events. The Browser emits `net:navigated`; a mission subscriber reacts. The filesystem emits `fs:node-created`; the Files app refreshes. No app names another.

### 8.3 Intents (launch-with-payload)

When one app must *hand off* to another, it uses an **intent**: a request to open an app with a payload, routed through the runtime.

```
runtime.openApp("buckycode", { intent: "edit-file", path: "/users/.../report.txt" })
runtime.openApp("browser",   { intent: "open-url",  url: "bnet://warren/article/gnawworm" })
runtime.openApp("osint",     { intent: "inspect-entity", entityId: "user:dustfinch" })
```

The launch flow passes the payload to the target app's `createState`, so opening Files → "open file" → BuckyCode, or Mail → "open link" → Browser, is a payloaded `openApp` and never an import. Intents are the formal version of what the terminal's `open` command already does when it routes a target through the Files runtime.

---

## 9. The Core Apps

Each app has (or will have) its own deeper spec; this section fixes their identity and contract.

| App | id | Role | Spec |
|-----|----|------|------|
| **Files** | `files` | Browse and interact with the VFS. | `filesystem.md` §6 |
| **Terminal** | `terminal` | Command line + tool runtime. | `terminal-system.md` |
| **Browser** | `browser` | Navigate the fake internet. | `browser-system.md` |
| **Mail** | `mail` | Read/send VM mail. | `mail-system.md` |
| **BuckyCode** | `buckycode` | Text/code editor and dev environment. | §10 below |
| **Database / Leak Viewer** | `database` | Browse leak/breach/user datasets. | `database-system.md` |
| **OSINT** | `osint` | Investigation and correlation toolkit. | `osint-system.md` |
| **Wiki** | (in-browser) | The `Warren` encyclopedia. | `fake-internet.md` |
| **Social** | (in-browser) | The `Hutch` social platform. | `fake-internet.md`, `osint-system.md` |
| **BuckyShark** | `buckyshark` | Packet-analyzer app (paired with the tool). | `terminal-system.md` §5.3 |

Wiki and Social are *content destinations inside the Browser*, not separate windowed apps — they are BuckyNet sites (`fake-internet.md`). A standalone OSINT app may additionally embed focused views of them.

---

## 10. BuckyCode — Editor and Developer Environment

### 10.1 Purpose

**BuckyCode** is the VM's text/code editor: the in-universe equivalent of a modern code editor, themed to Bucky. It is the app that makes files genuinely *editable* and turns the VM into a place where the player writes, not just reads. It serves four roles: text editor, code editor, mission utility, and developer environment.

### 10.2 Capabilities

| Capability | Description |
|------------|-------------|
| **Open files** | Launched from the Files app (click a file), from the terminal (`edit <file>` / `open <file>`), or via an `edit-file` intent. |
| **Edit files** | A full editing surface over a file's `content`, written back via `fs.write`. |
| **Save / write** | Explicit save (and a dirty indicator); save promotes a `persistent`-flagged file to the synced tier. |
| **View any text mime** | Plain text, logs, JSON, Markdown, `.bsh` scripts — chosen by the file's `mime`. |
| **Multiple tabs** | One window editing several files; each tab is an open-file buffer. |
| **Syntax highlighting** | Per-mime tokenization — JSON, `.bsh` scripts, log formats — added as a rendering layer. |
| **Mission scripting** | Authoring and editing `.bsh` scripts (`terminal-system.md` §7); BuckyCode is where mission automation is written. |
| **Tooling integration** | A "run" affordance executes the open `.bsh` through the terminal's CommandService; future integrations surface tool output inline. |

### 10.3 Architecture

BuckyCode is a multi-instance-capable app (`singleInstance: false` is acceptable, though a tabbed single window is the default). Its `appState`:

- `tabs[]` — open buffers, each `{ path, content, dirty, cursor, scroll, mime }`.
- `activeTab` — index of the focused buffer.
- `mode` — `text` / `code` (drives highlighting and gutter).

BuckyCode is a **live app** (`render-system.md` §6.3): the editing surface is a delegated sub-region updated imperatively; structural changes (open/close tab) go through the scheduler. It holds no file data of its own — buffers are loaded from and saved to `FileSystemService`, and it subscribes to `fs:node-updated` so it can detect that an open file changed underneath it.

### 10.4 Integration

BuckyCode is the editor end of the filesystem's "files are editable" requirement (`filesystem.md` §6). It is the target of `edit-file` intents from Files and the terminal. It writes through `fs` (permission `fs.write`), reads through `fs` (`fs.read`), and reaches the terminal's CommandService to run scripts (permission `packages`/`windows` as appropriate). It is, by design, the developer environment *inside* the VM — the place missions point the player when a task requires authoring or modifying a file.

### 10.5 Implementation order for BuckyCode

1. Single-buffer editor: open a file, edit, save through `fs.write`, dirty indicator.
2. Mime-aware viewing and a read-only mode for `system`/`readonly` files.
3. Multiple tabs.
4. Syntax highlighting per mime (JSON, `.bsh`, logs).
5. `.bsh` "run" integration with the terminal.
6. Inline tooling integration and mission-scripting affordances.

---

## 11. Data Models

| Model | Fields | Owner |
|-------|--------|-------|
| App definition | see §3 | AppRegistry |
| App availability | `available` / `installable` / `locked` / `hidden` + reason | AppRegistry |
| Window state | see `desktop-shell.md` §4.1 | WindowService |
| App state (`appState`) | app-specific; opaque to the shell | the app |
| Intent payload | `intent` name + app-specific fields | runtime launch flow |
| Permission grant | the permissions an app declared and was granted | AppRegistry |

---

## 12. Important Flows

### 12.1 Flow — launch an app

```
desktop icon / launcher / open command / intent
  → openApp(id, payload?)
  → AppRegistry availability check (registered? gated?) → ok | notify+stop
  → singleInstance + existing window? → focus it, stop
  → createState(user, services, payload) → appState  (failure → contained)
  → WindowService creates window, computes geometry, assigns z, focuses
  → render → window body in DOM → mount (listeners + sub-regions)
  → emit window:opened
```

### 12.2 Flow — Files opens a file in BuckyCode

```
click a text file in Files
  → Files issues intent: openApp("buckycode", { intent:"edit-file", path })
  → BuckyCode createState loads the buffer via fs.read
  → window opens with the file in a tab; edits saved via fs.write
```

### 12.3 Flow — install an app via a package

```
install <package> → PackageService registers the app definition into AppRegistry
                   → emit app:installed → ShellService adds icon/launcher entry
                   → app immediately launchable
```

### 12.4 Flow — an app unlocks through progression

```
mission completes / level up / Discord economy purchase
  → PersistenceService syncs unlock flags into the session
  → AppRegistry re-evaluates gating → app:unlocked
  → desktop + launcher update; notification "New app available"
```

---

## 13. Subsystem Responsibilities

| Component | Responsibility |
|-----------|----------------|
| AppRegistry | App definitions, availability, gating, install state, install/unlock events. |
| Runtime launch flow | `openApp`, `createState` invocation, error containment, intent payload routing. |
| WindowService | Hosting apps in windows (`desktop-shell.md`). |
| ShellService | Desktop icons and the apps-menu launcher derived from the registry. |
| Render scheduler | Calling `render`/`update`; managing per-window and sub-region regions. |
| PackageService | Delivering apps as packages; gating installs. |
| Each app module | Implementing the contract; isolation; emitting events; calling services only. |

---

## 14. Dependencies

- **Runtime** — service registry, event bus, `openApp`/`renderApp`, error containment.
- **Desktop shell** (`desktop-shell.md`) — windows, icons, taskbar, launcher.
- **Render system** (`render-system.md`) — the render/mount/update contract.
- **Filesystem** (`filesystem.md`) — most apps read/write the VFS; BuckyCode especially.
- **Package, mission, session services** — gating and install delivery.

Apps depend on services; services and the shell never depend on a specific app.

---

## 15. Extension Points

- **New app** — add a module under `vm/apps/`, register its definition. Nothing else changes.
- **New permission** — extend the capability set and the scoped services facade.
- **New gate type** — extend the shared gating schema (`terminal-system.md` §6).
- **New intent** — define an intent name and the payload its target app expects.
- **App categories** — drive apps-menu grouping; new categories are data.
- **Embedded app surfaces** — an app may host another app's view through a sanctioned embed API (e.g. OSINT embedding a Browser viewport) rather than importing it.

---

## 16. Scalability Concerns

| Concern | Mitigation |
|---------|------------|
| Hundreds of apps | Apps are registry data; the launcher groups/searches; the desktop stays curated. |
| App faults breaking the VM | `createState`/`render` are wrapped; a faulty app is contained behind a placeholder. |
| Per-app window-behavior duplication | Window behavior is the shell's; apps inherit it. |
| Render cost of many open apps | Each window is a render region; live apps use delegated sub-regions. |
| Cross-app coupling creep | Hard rule: no app imports another; services + bus + intents only. |
| Listener churn | `mount` attaches listeners once; delegated root listeners for chrome. |
| Gating recomputation | Re-run only on progression-sync events; cheap flag checks. |

---

## 17. Future Systems

- **Apps-menu launcher** with categories, search, and install affordances (`desktop-shell.md`).
- **App settings** — per-app preferences persisted with the account.
- **Embedded/companion views** — apps surfacing slices of other apps via the embed API.
- **App update channel** — packaged apps gaining new versions through PackageService.
- **Background apps** — apps that run without a window, reporting into the system tray.
- **App marketplace flavor** — an in-universe catalog of installable apps tied to the Discord economy.

---

## 18. Recommended Implementation Order

1. **Extract `AppRegistry`** as a service; move availability/gating policy off the runtime.
2. **Formalize the app definition model** (§3) including `permissions`, `category`, `gating`.
3. **Split `bind` into `mount` + `update`**; migrate Terminal and Files to the new lifecycle (`render-system.md`).
4. **Add intents** to the launch flow so apps hand off with payloads.
5. **Build BuckyCode v1** — single-buffer editor reading/writing through `fs`; wire `edit`/`open` and the Files click-to-edit path.
6. **Wire gating + install flow** — packaged apps register into `AppRegistry`; desktop/launcher react to `app:installed`/`app:unlocked`.
7. **Replace placeholders with real apps** — Browser, Mail, Database/Leak Viewer, OSINT — each per its own spec.
8. **Grow BuckyCode** — tabs, syntax highlighting, `.bsh` run integration.
9. **Add app settings, background apps, and embedded views** as the platform matures.

Steps 1–5 turn the registry skeleton into a real app platform with a working editor; steps 6+ populate it with the domain apps and progression behavior.
