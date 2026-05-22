# VM Runtime — Architecture Specification

> **Document status:** Source of truth.
> **Scope:** The Bucky VM kernel — lifecycle, runtime services, the service registry, the event bus, and the contracts every other subsystem depends on.
> **Audience:** Engineers and AI agents extending the Bucky VM. Read this document first; every other architecture document assumes the vocabulary defined here.

---

## 1. Purpose

The VM Runtime is the kernel of the Bucky VM. It is the single long-lived object that owns session state, boots the desktop environment, hosts every application, and exposes the *runtime APIs* through which all subsystems communicate.

The Bucky VM is a fictional cybersecurity operating system inside the Bucky universe. It is not a website with a few interactive widgets — it is a simulated operating system with a desktop shell, a virtual filesystem, a fake internet, a mail system, databases, OSINT mechanics, installable terminal tooling, and a mission/progression layer linked to Discord. The runtime is the component that makes all of these feel like one coherent machine.

The runtime exists to guarantee four properties:

1. **Coherence.** Every app sees the same session, the same filesystem, the same clock, and the same progression state. There is one source of truth per concern, owned by the runtime.
2. **Isolation.** Apps never import or call each other directly. They communicate only through runtime services and the event bus. This keeps the system modular and lets new apps be added without touching existing ones.
3. **Immersion.** Within a session everything *feels* persistent: files created with `touch` stay, windows remember their position, notifications stack. The runtime maintains this illusion even though the underlying storage is ephemeral.
4. **Extensibility.** The runtime must support hundreds of apps, tools, pages, and missions over its lifetime without architectural rewrites. Every subsystem is registered, not hard-coded.

The runtime deliberately mediates *all* cross-cutting state. An app that wants to read a file, send mail, query a database, navigate the fake internet, or unlock a tool does so by calling a runtime service — never by reaching into another app.

---

## 2. Architecture Overview

### 2.1 Position in the stack

The Bucky VM is mounted inside the arcade page (`arcade.html`) at the DOM node `#bucky-vm-root`. It is bootstrapped by `js/arcade.js`, which constructs a `BuckyVMRuntime` instance, passes the authenticated Discord user, and calls `start()`. The runtime renders entirely inside its mount node and never assumes ownership of the rest of the page.

```
arcade.html
  └─ #bucky-vm-root
       └─ BuckyVMRuntime  (vm/core/vmRuntime.js)
            ├─ core/        kernel modules (filesystem, window model, services)
            ├─ components/  shell rendering (container, desktop, taskbar, windows)
            └─ apps/        application modules (terminal, files, …)
```

The three-layer split — `core/`, `components/`, `apps/` — is mandatory and is enforced by dependency direction (see §7).

### 2.2 Layer model

| Layer | Directory | Responsibility | May depend on |
|-------|-----------|----------------|---------------|
| **Core** | `vm/core/` | Kernel: runtime object, services, filesystem model, window model, event bus, render scheduler. No DOM rendering logic beyond orchestration. | Core only |
| **Components** | `vm/components/` | Shell rendering: the VM container, desktop, taskbar, window chrome, notifications. Pure render + bind functions. | Core |
| **Apps** | `vm/apps/` | Self-contained applications. Each app is a module that renders into a window body and binds its own events. | Core services, never other apps |

A dependency that points "upward" (core importing an app, a component importing an app's internals) is an architectural violation.

### 2.3 The runtime object

`BuckyVMRuntime` is a class. One instance exists per page load. It is intentionally a *single mutable object* — the desktop is a stateful application, not a pure function of props, and pretending otherwise would add ceremony without benefit. Discipline comes from the service boundaries, not from immutability.

Current responsibilities held directly on the instance:

- **Lifecycle / phase state** — `mode`, `phase`, `bootLines`, `sessionLines`.
- **Window collection** — `windows[]`, `activeWindowId`, `nextZ`.
- **Identity** — `user` (normalized Discord profile).
- **Filesystem** — `filesystem` (the session VFS).
- **App registry** — `apps`, `desktopApps`.
- **Notifications** — `notifications[]`.
- **Clock** — `clock`, `clockTimer`.

The **target architecture** factors these concerns into named *services* registered under a stable namespace (`runtime.services`, see §4). The current instance fields are the first generation of those services; migration is incremental and additive.

---

## 3. Runtime Lifecycle

The runtime is a phase machine. `phase` is the authoritative state; the renderer is a pure function of it.

### 3.1 Phases

| Phase | Trigger | Visible state | Exit condition |
|-------|---------|---------------|----------------|
| `boot` | `start()` | Boot core animation, streaming boot log lines | Boot queue drained (~3.1s) |
| `login` | Boot complete | Login panel with injected identity | User clicks **ENTER SYSTEM** |
| `session` | Login confirmed | Session handshake loader, streaming session log | Session queue drained (~2.3s) |
| `desktop` | Session complete | Full desktop shell: wallpaper, icons, windows, taskbar | Runtime teardown |

`mode` is an orthogonal axis: `embedded` (VM sits inline in the arcade cabinet) or `expanded` (focus mode with a backdrop). Mode can change in any phase and never resets `phase`.

### 3.2 Boot sequence

`start()` performs: first render, clock start (1s interval), `resize` listener registration, then `runBootSequence()`. The boot sequence streams `bootQueue` lines into `bootLines` on staggered timers, re-rendering after each. When the queue is drained the runtime transitions to `login`, emits an "Identity linked" notification, and re-renders.

### 3.3 Session boot

`startDesktopBoot()` (fired by the login button) sets `phase = "session"`, clears windows and active window, then streams `sessionQueue` lines into `sessionLines`. When complete it sets `phase = "desktop"`, emits a "Desktop ready" notification, and re-renders.

### 3.4 Teardown

Teardown is currently implicit (page unload). The **target architecture** adds an explicit `dispose()` that clears the clock interval, removes the `resize` listener, flushes the persistence queue (see §6), and unsubscribes all event-bus listeners. Any subsystem that registers a timer or global listener must register a matching teardown hook so `dispose()` stays complete as the system grows.

### 3.5 Lifecycle diagram

```
 start()
   │
   ▼
[boot] ──boot queue drained──▶ [login] ──ENTER SYSTEM──▶ [session]
                                                            │
                                              session queue drained
                                                            ▼
                                                        [desktop] ──▶ dispose()

 mode: embedded ⇄ expanded   (orthogonal, available in every phase)
```

---

## 4. The Service Registry

### 4.1 Concept

A **service** is a long-lived object owned by the runtime that exposes a stable API for one concern (filesystem, mail, windows, missions, …). Services are the *runtime APIs* referred to throughout the project principles. The rule is absolute: **apps and components consume services; they never consume each other.**

The service registry is the namespace `runtime.services`. Each service is registered once during runtime construction with a stable string key. A service is a plain object (or class instance) exposing methods and emitting events on the bus.

### 4.2 Canonical service list

This table is the canonical registry. Every other architecture document refers to these keys. "Current" means the concern already exists on the runtime in some form; "Planned" means the document for that subsystem defines the target.

| Key | Service | Owns | State | Spec |
|-----|---------|------|-------|------|
| `session` | SessionService | Identity, Discord link, progression level, profile | Current (`runtime.user`) | `discord-integration.md` |
| `fs` | FileSystemService | The virtual filesystem (shared data layer) | Current (`runtime.filesystem`) | `filesystem.md` |
| `windowing` | WindowService | Window collection, focus, z-order, geometry | Current (`runtime.windows`) | `desktop-shell.md` |
| `apps` | AppRegistry | App definitions, install/unlock state | Current (`runtime.apps`) | `app-system.md` |
| `bus` | EventBus | Pub/sub message delivery | Planned | this document, §5 |
| `renderer` | RenderScheduler | Render batching, dirty-region tracking | Planned | `render-system.md` |
| `notifications` | NotificationService | Toast notification queue | Current (`runtime.notify`) | `desktop-shell.md` |
| `shell` | ShellService | Apps menu, launcher, desktop icons, focus | Current (`DesktopManager`) | `desktop-shell.md` |
| `commands` | CommandService | Terminal command registry, parser, aliases | Current (`TerminalApp`) | `terminal-system.md` |
| `packages` | PackageService | Installable terminal tools and apps | Planned | `terminal-system.md` |
| `net` | NetworkService | BuckyNet request routing, DNS, host registry | Planned | `networking-system.md` |
| `mail` | MailService | Mailboxes, threads, message generation | Planned | `mail-system.md` |
| `db` | DatabaseService | Leak/user/breach/mission/content datasets | Planned | `database-system.md` |
| `osint` | OsintService | Entity graph, traces, correlation engine | Planned | `osint-system.md` |
| `missions` | MissionService | Mission state, clue chains, unlock gating | Planned | `mission-progression.md` |
| `persistence` | PersistenceService | Backend sync to the BuckyBot API | Planned | `database-system.md`, `discord-integration.md` |

### 4.3 Service contract

Every service must satisfy:

- **`init(runtime)`** — called once after all services are registered. May read other services. Must not render.
- **`dispose()`** — called by `runtime.dispose()`. Releases timers, listeners, and bus subscriptions.
- **Event emission** — state changes are announced on the bus (§5) so that the renderer and other subsystems can react. A service never re-renders directly.
- **No DOM ownership** — services hold data and logic; the components layer renders it.

### 4.4 Service registration order

Services are registered before `start()` runs. Order matters because `init()` may depend on earlier services:

```
1. bus            (everything publishes here)
2. session        (identity needed by fs, missions)
3. fs             (shared data layer)
4. db             (datasets; depends on fs for file-backed records)
5. persistence    (depends on session + db)
6. net            (depends on db for page content)
7. mail           (depends on net + db + session)
8. osint          (depends on db + net + mail)
9. missions       (depends on osint, mail, fs, net, db)
10. packages      (depends on missions for unlock gating)
11. commands      (depends on fs, packages)
12. apps          (depends on packages, missions for gating)
13. windowing     (depends on apps)
14. shell         (depends on apps, windowing)
15. notifications (independent; registered late, no dependents)
16. renderer      (registered last; observes the bus)
```

This list is also the recommended implementation order for the whole project (see §10).

---

## 5. The Event Bus

### 5.1 Purpose

The event bus is the runtime's nervous system. It decouples *producers* of state change from *consumers*. When the filesystem service creates a file, it does not know that the Files app, the terminal, and BuckyCode might all care — it simply publishes `fs:node-created`. Subscribers react. This is what allows files and directories created in the terminal to instantly appear in the Files app without either app referencing the other.

### 5.2 API

```
bus.on(eventName, handler)      → returns an unsubscribe function
bus.once(eventName, handler)    → auto-unsubscribes after first delivery
bus.emit(eventName, payload)    → synchronous fan-out to all subscribers
bus.off(eventName, handler)     → explicit unsubscribe
```

Delivery is synchronous and ordered by subscription order. Handlers must not throw; the bus wraps each handler so one failing subscriber cannot break the others (the same defensive pattern the runtime already uses around `app.render`).

### 5.3 Event namespace convention

Events are namespaced `domain:verb-noun`, lower-kebab. The namespace is the owning service. Canonical events used across documents:

| Event | Emitted by | Meaning |
|-------|-----------|---------|
| `fs:node-created` | fs | A file or directory was created |
| `fs:node-updated` | fs | File content changed |
| `fs:node-deleted` | fs | A node was removed |
| `fs:cwd-changed` | fs | A consumer's working directory moved |
| `window:opened` / `window:closed` | windowing | Window lifecycle |
| `window:focus-changed` | windowing | Active window changed |
| `app:installed` / `app:unlocked` | apps | App availability changed |
| `net:navigated` | net | The browser loaded a BuckyNet page |
| `mail:received` | mail | A message arrived in a mailbox |
| `db:record-leaked` | db | A breach event exposed new records |
| `mission:state-changed` | missions | A mission advanced, unlocked, or completed |
| `mission:clue-found` | missions | The player discovered a clue |
| `progression:level-changed` | session | The player's level changed (Discord sync) |
| `notification:posted` | notifications | A toast was queued |

Each subsystem document owns and extends its own namespace. New events are added by documentation, not invented ad hoc.

### 5.4 Why a bus and not direct calls

Direct calls scale as O(n²) wiring between subsystems. A bus scales as O(n) — each subsystem knows only its own events. With a dozen apps and a dozen services, the bus is the only structure that keeps cross-cutting reactions (a leak event updating the database, a browser page, a mail, and a mission simultaneously) maintainable.

---

## 6. Session, Persistence, and Storage Boundaries

### 6.1 Session model

A **session** is one page load of the VM. It begins at `new BuckyVMRuntime()` and ends at page unload or `dispose()`. All runtime state — the filesystem, open windows, terminal history, mail, database mutations — lives in memory for the duration of the session.

The core principle: **everything feels persistent during the session; nothing survives a refresh unless explicitly promised to the backend.**

### 6.2 Three storage tiers

| Tier | Lifetime | Examples | Mechanism |
|------|----------|----------|-----------|
| **Ephemeral** | Until refresh | Terminal scrollback, window positions, files created by `touch`, in-session scan output | In-memory runtime state |
| **Synced** | Across sessions for the linked Discord account | Progression level, unlocked tools/apps, completed missions, persistent mission files | PersistenceService → BuckyBot API |
| **Authored** | Permanent, ships with the build | Fake internet pages, wiki articles, seed mail, base filesystem, mission definitions | Static datasets loaded at boot |

The runtime never blurs these tiers. An app that wants something to survive a refresh must route it through `persistence`; otherwise it is ephemeral by design and that is correct behavior, not a bug.

### 6.3 PersistenceService

`PersistenceService` is the only component permitted to talk to the backend (`API_URL = https://api.buckybot.app`, see `js/config.js`). It exposes:

- **`load(scope)`** — fetch a persisted scope (`progression`, `missions`, `persistent-files`) at boot.
- **`queue(scope, patch)`** — enqueue a change; the service debounces and batches writes.
- **`flush()`** — force-write the queue; called by `dispose()` and at safe checkpoints (mission completion, level change).

Persistence is *write-behind*: the VM never blocks the UI on the network. If a sync fails the session continues; the queue retries with backoff. This keeps the "no real internet access" principle intact at the VM layer — the only egress is the trusted BuckyBot API, and the VM degrades gracefully without it.

### 6.4 Sandbox guarantee

There is no real network egress from inside the simulation. The fake internet, mail, and OSINT systems are entirely local datasets and generators. The *only* network calls the VM makes are PersistenceService calls to the BuckyBot API, and those carry progression data only — never simulated traffic. This boundary is a hard security and design invariant.

---

## 7. Subsystem Responsibilities

| Subsystem | Responsibility | Document |
|-----------|----------------|----------|
| VM Runtime | Lifecycle, service registry, event bus, render orchestration, session/storage tiers | this document |
| Render System | Render scheduling, dirty-region updates, avoiding full rerenders | `render-system.md` |
| Filesystem | The shared virtual filesystem and its data model | `filesystem.md` |
| Desktop Shell | Wallpaper, icons, taskbar, apps menu, window chrome, focus, z-order | `desktop-shell.md` |
| App System | App registry, lifecycle, permissions, install/unlock, app-to-app messaging | `app-system.md` |
| Terminal System | Command registry, parser, package manager, installable tooling | `terminal-system.md` |
| Networking System | BuckyNet request routing, DNS, host registry, the network simulation layer | `networking-system.md` |
| Fake Internet | The content universe: search, video, wiki, social, corporate, forums, news | `fake-internet.md` |
| Browser System | The Browser app: page routing, rendering, history, embedded hints | `browser-system.md` |
| Mail System | Mailboxes, threads, message generation, event-driven mail | `mail-system.md` |
| Database System | Leak/user/breach/mission/content datasets, runtime cache, leak events | `database-system.md` |
| OSINT System | Entity graph, traces, correlation, investigation mechanics | `osint-system.md` |
| Mission & Progression | Missions, clue chains, mission state, unlock gating | `mission-progression.md` |
| Discord Integration | Account linking, progression sync, economy, heists, unlocks | `discord-integration.md` |

The runtime's own responsibility is strictly the kernel: it owns no domain logic. Domain logic lives in services; the runtime owns the *structure* that services plug into.

---

## 8. Dependencies

### 8.1 Inbound (what depends on the runtime)

Everything. Every component and every app receives the `runtime` reference and reaches services and the bus through it. The runtime is the universal dependency.

### 8.2 Outbound (what the runtime depends on)

- **Core modules** — `filesystem.js`, `windowManager.js`, and (target) `eventBus.js`, `renderScheduler.js`, `serviceRegistry.js`.
- **Components** — `VMContainer`, `DesktopManager`, `WindowManager`, `Taskbar`, `Notifications` for rendering.
- **Apps** — only through the app registry; the runtime imports app modules to register them but treats them as opaque definitions satisfying the app contract (`app-system.md`).
- **Host page** — `arcade.js` for instantiation and the Discord user object; `config.js` for `API_URL`.
- **Browser APIs** — `setInterval`, `setTimeout`, `requestAnimationFrame`, `addEventListener`, `Intl.DateTimeFormat`. All wrapped so teardown is complete.

### 8.3 Dependency rules

1. Core never imports components or apps' internals.
2. Components never import apps' internals.
3. Apps never import other apps.
4. All cross-subsystem communication goes through `runtime.services` and `runtime.services.bus`.
5. Only `PersistenceService` performs network I/O.

A violation of any rule is a defect, regardless of whether it "works."

---

## 9. Extension Points

The runtime is designed to be extended without modification:

- **Register a service.** Add a new concern by registering it in the service registry with a stable key and an `init`/`dispose` pair. Existing services are untouched.
- **Register an app.** Apps are registered as definitions in the app registry (`app-system.md`). Adding the hundredth app is the same operation as adding the second.
- **Register a command or tool.** The terminal's command registry and PackageService accept new commands and installable tools as data (`terminal-system.md`).
- **Subscribe to the bus.** Any subsystem can react to existing events without the producer knowing. New cross-cutting features are often pure subscribers.
- **Add a phase or mode.** The phase machine is a switch on `phase`; a new phase (e.g. a `locked` screensaver) is an added branch plus a renderer case.
- **Add an event namespace.** New subsystems claim a namespace and document their events.

The guiding test for any extension: *can this be added by registration and subscription alone, without editing unrelated files?* If not, the extension point is missing and should be designed before the feature.

---

## 10. Scalability Concerns

| Concern | Risk | Mitigation |
|---------|------|------------|
| **Full rerenders** | `render()` rebuilds the entire VM DOM (`root.innerHTML = …`) on every state change. With many windows and live apps this drops frames and resets transient DOM state (input focus, scroll, selection). | Migrate to the RenderScheduler with dirty-region updates. This is the single most important scalability item — see `render-system.md`. |
| **Monolithic runtime object** | All state on one object invites accidental coupling as subsystems multiply. | The service registry partitions state by concern; each service is independently testable and replaceable. |
| **Event-bus storms** | A leak event fanning out to many subscribers could cause cascading re-renders. | Renderer batches per animation frame; subscribers mark regions dirty rather than rendering synchronously. |
| **Dataset size** | Hundreds of fake-internet pages, wiki articles, and database records loaded eagerly would bloat boot. | Datasets are lazy-loaded per domain by the services that own them; the runtime only guarantees the loading contract. |
| **Timer/listener leaks** | Each subsystem adds timers and listeners; without discipline `dispose()` rots. | Mandatory `dispose()` on every service; teardown reviewed whenever a service is added. |
| **Z-index inflation** | `nextZ` increments forever. | Cosmetic only within a session; a periodic z-order compaction pass is a future optimization, not a correctness issue. |

---

## 11. Future Systems

The runtime is the platform these systems plug into; each is specified in its own document but depends on runtime primitives defined here.

- **RenderScheduler** — replaces full rerenders with batched, targeted updates.
- **PackageService** — installable terminal tools and apps, level- and mission-gated.
- **NetworkService + Fake Internet** — the BuckyNet routing layer and its content universe.
- **MailService** — mailboxes with event-driven, mission-aware message generation.
- **DatabaseService** — the leak/breach/OSINT datasets and the leak-event engine.
- **OsintService** — the cross-dataset correlation engine that powers investigations.
- **MissionService** — clue chains, mission state machines, and unlock gating.
- **PersistenceService + Discord economy** — progression, heists, bankcodes, and rewards synced to the BuckyBot ecosystem.
- **Multi-instance windows & app-to-app messaging** — richer window and IPC semantics on top of the window model.

Each future system is additive: it registers a service, claims an event namespace, and is consumed through the registry. None requires re-architecting the kernel.

---

## 12. Recommended Implementation Order

The order below is dependency-correct. Each step is shippable and leaves the VM in a working state.

1. **Event bus.** Introduce `EventBus` as a core module and register it. Nothing else can be cleanly decoupled until this exists.
2. **Service registry.** Formalize `runtime.services`; wrap the existing `filesystem`, `apps`, `windows`, and `notify` concerns as registered services without changing behavior.
3. **Render scheduler.** Replace `render()` with the batched, dirty-region scheduler (`render-system.md`). This unblocks performant live apps.
4. **Filesystem service hardening.** Add metadata, timestamps, ownership, `rm`, and event emission to the VFS (`filesystem.md`).
5. **App system formalization.** Lift the app contract, lifecycle hooks, permissions, and unlock gating into `AppRegistry` (`app-system.md`).
6. **Terminal + PackageService.** Command registry, parser, aliases, and the installable-tool/package manager (`terminal-system.md`).
7. **Persistence service.** Backend sync for progression and persistent files; defines the synced storage tier.
8. **Networking + fake internet + browser.** The BuckyNet stack and its content universe.
9. **Mail + database services.** Mailboxes and the leak/breach datasets, including event-driven leaks.
10. **OSINT + missions + Discord economy.** The investigation correlation engine, mission state machines, and full Discord progression/economy sync.

Steps 1–3 are the foundation and should not be deferred — every later subsystem is cleaner, smaller, and more testable once the bus, the registry, and the scheduler exist.

---

## 13. Glossary

| Term | Definition |
|------|------------|
| **Runtime** | The single `BuckyVMRuntime` instance; the kernel. |
| **Service** | A runtime-owned object exposing a stable API for one concern, registered in the service registry. |
| **Service registry** | The `runtime.services` namespace mapping keys to services. |
| **Event bus** | The synchronous pub/sub channel (`runtime.services.bus`) for cross-subsystem communication. |
| **Phase** | The lifecycle state of the runtime: `boot`, `login`, `session`, `desktop`. |
| **Mode** | The display state: `embedded` or `expanded`. Orthogonal to phase. |
| **Session** | One page load of the VM; the lifetime of ephemeral state. |
| **Storage tier** | One of ephemeral, synced, or authored — the persistence class of a piece of state. |
| **VFS** | The virtual filesystem; the shared data layer between apps (`filesystem.md`). |
| **BuckyNet** | The fictional internet simulated by the NetworkService (`networking-system.md`). |
