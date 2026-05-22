# Render System — Architecture Specification

> **Document status:** Source of truth.
> **Scope:** How the Bucky VM turns runtime state into DOM, how updates are scheduled, and how full rerenders are avoided.
> **Depends on:** `vm-runtime.md` (event bus, service registry, lifecycle).
> **Consumed by:** every component and every app.

---

## 1. Purpose

The render system decides *when* and *how much* of the VM's DOM is rebuilt in response to state changes. It exists to keep the desktop smooth as the system scales from two apps to dozens, with live terminals, streaming logs, scrolling mailboxes, and animated windows all on screen at once.

Rendering is the single largest scalability risk in the VM. The current implementation re-renders the *entire* VM on every state change, and the project principles explicitly require avoiding full rerenders. This document specifies the **RenderScheduler** — the `renderer` service — that replaces blunt full rerenders with batched, targeted, region-scoped updates.

The render system must guarantee:

1. **Correctness** — the DOM always reflects current runtime state after a frame settles.
2. **Performance** — a state change touches the minimum amount of DOM; unrelated regions are untouched.
3. **Transient-state preservation** — input focus, caret position, text selection, and scroll position survive an update unless the update logically destroys the element.
4. **Predictability** — multiple state changes in one tick produce exactly one paint.

---

## 2. Current Implementation and Its Limits

### 2.1 What exists today

The runtime's `render()` method does:

```
this.root.innerHTML = renderVMContainer(this);
this.bind();
```

`renderVMContainer` returns an HTML string for the *whole* VM — backdrop, shell, phase content, every window, the taskbar, notifications. `bind()` then re-attaches every event listener. Components and apps are pairs of pure `render(...) → htmlString` and `bind(...)` functions. State lives on the runtime; rendering is `state → string → innerHTML`.

This is clean and easy to reason about, and it is the correct *starting* point. It has three hard limits.

### 2.2 The three problems

**Problem 1 — Full DOM replacement.** Every state change (a keystroke in the terminal, a clock tick that *should* be surgical, a window drag commit) rebuilds and replaces the entire VM DOM. Cost grows with total on-screen content, not with the size of the change.

**Problem 2 — Transient state loss.** `innerHTML =` destroys and recreates every node. Input focus, caret position, selection, scroll offsets, and in-flight CSS transitions are lost. The terminal already works around this by re-focusing its input and re-scrolling its screen inside `bind()`. Every future live app (BuckyCode editor, mailbox, browser) would need the same manual restoration — an unscalable pattern.

**Problem 3 — Listener churn.** Every render re-creates every listener. With many windows this is wasted work and a source of subtle bugs (a listener attached to a node that is about to be replaced).

The clock tick is the one place the current code already does the right thing: `tickClock()` updates only `[data-vm-clock]` via `replaceChildren` instead of re-rendering. The RenderScheduler generalizes that surgical instinct to the whole VM.

---

## 3. Architecture Overview

### 3.1 The render pipeline

```
state change ──▶ markDirty(regionId) ──▶ dirty set
                                            │
                          requestAnimationFrame (coalesce)
                                            │
                                            ▼
                            flush(): for each dirty region
                                       reconcile(region)
                                            │
                                            ▼
                                     minimal DOM mutation
```

A state change does **not** render. It marks a *region* dirty. The scheduler coalesces all dirty regions queued within one frame and flushes them once, on the next animation frame.

### 3.2 Regions

The VM DOM is divided into independently renderable **regions**. A region is a named DOM subtree with a render function and a stable mount node. Top-level regions:

| Region | DOM node | Render function | Dirtied by |
|--------|----------|-----------------|------------|
| `phase` | phase container | `renderPhase` | phase changes |
| `boot-log` | boot copy | boot log renderer | boot line streamed |
| `session-log` | session frame | session log renderer | session line streamed |
| `desktop-icons` | icon rail | desktop icon renderer | app install/unlock |
| `window-layer` | `.vm-window-layer` | window list renderer | window opened/closed |
| `window:<id>` | a single `.vm-window` | window chrome + app body | that window's state |
| `taskbar` | `.vm-taskbar` | taskbar renderer | window list, clock |
| `clock` | `[data-vm-clock]` | clock renderer | clock tick |
| `notifications` | `.vm-notifications` | notification renderer | notification posted/expired |

Each open window is its own region (`window:<id>`). Each app additionally owns one or more **sub-regions** inside its window body (see §6). This nesting is what makes a keystroke in one terminal touch only that terminal's output sub-region.

### 3.3 The renderer service

`RenderScheduler` is registered as `runtime.services.renderer`. API:

- **`markDirty(regionId)`** — flag a region for update; schedule a flush if not already scheduled.
- **`markDirtyAll()`** — flag every region (used only on phase change, mode change, resize).
- **`flush()`** — reconcile every dirty region now (called by the rAF callback; also callable synchronously for tests).
- **`registerRegion(id, descriptor)`** — register a region's render function, mount-node selector, and reconciliation strategy.
- **`onFlush(callback)`** — post-flush hook (used for transient-state restoration that cannot be expressed declaratively).

The scheduler subscribes to the event bus and maps events to dirty regions through a declarative table, so most subsystems never call `markDirty` directly — they emit an event and the scheduler knows which region it affects.

---

## 4. Update Strategies

A region declares one of four reconciliation strategies. The scheduler picks the cheapest correct one.

### 4.1 Replace

Rebuild the region's `innerHTML` and re-bind. Equivalent to today's behavior but *scoped to one region*. Correct for regions with no transient state and infrequent updates (notifications, desktop icons, the session log). Simple, and cheap when the region is small.

### 4.2 Patch (attribute/text)

Update specific attributes or text nodes without touching structure. Used when the change is known to be narrow: the clock (`replaceChildren` on one node — already done today), a window's title, a taskbar button's active class, a window's `style.left/top` during a drag (already done today in `WindowManager` and `vmRuntime.moveWindow`). The cheapest strategy; always preferred when the change is expressible as an attribute or text edit.

### 4.3 Keyed list reconciliation

For lists whose items have stable identity — windows in the window layer, messages in a mailbox, files in a directory grid, comments on a page — the region renders a list keyed by id. On flush the scheduler diffs keys: it creates new nodes, removes gone nodes, reorders survivors, and recurses into changed items only. Unchanged items keep their DOM and therefore their transient state and listeners. This is the strategy that lets a 200-message mailbox add one message without re-rendering 199.

### 4.4 Delegated / live sub-region

For app content that updates very frequently (terminal output, editor buffer, browser viewport), the app owns a sub-region and updates it imperatively through a small, blessed API (append a line, replace a buffer span). The scheduler does not reconcile these on every keystroke; the app pushes targeted mutations and only marks the sub-region dirty when a structural change occurs. See §6.

---

## 5. Event Delegation and Listener Lifecycle

### 5.1 The problem with per-render binding

Today every render re-binds every listener. The fix is **event delegation**: attach a small fixed set of listeners high in the tree and dispatch by inspecting `event.target`.

### 5.2 Delegated dispatch

The runtime attaches delegated listeners on the VM root for the common interaction classes, dispatching via `data-` attributes already present in the markup:

- `[data-open-app]` → open app
- `[data-window-action]` → window minimize/maximize/close
- `[data-task-window]` → taskbar restore/focus
- `[data-drag-handle]` → window drag start
- `[data-vm-expand]` / `[data-vm-minimize]` / `[data-vm-backdrop]` / `[data-vm-login]` → shell controls

Because these listeners live on the root, they survive any region update. Regions can be reconciled freely without listener churn.

### 5.3 App-local listeners

An app's own listeners (a terminal input, an editor surface) are attached once when the window's app body mounts, in the app's `mount` hook (`app-system.md`), not on every render. Keyed reconciliation preserves the app body's nodes across updates, so app listeners persist. An app only re-binds when its window is genuinely created.

### 5.4 Pointer-capture interactions

Drag and resize use pointer capture and write directly to `style` during the gesture (the current `WindowManager` drag loop already does this with `requestAnimationFrame`). These interactions bypass the scheduler entirely while in progress and commit a single `patch` update on pointer-up. This is the correct pattern for any continuous gesture and must not be replaced with scheduler round-trips.

---

## 6. App Rendering Model

### 6.1 App render contract

An app exposes (`app-system.md` is authoritative):

- **`render(runtime, windowState) → htmlString`** — full markup of the app body. Used on first mount and on `replace`-strategy updates.
- **`mount(runtime, windowState, element)`** — attach app-local listeners and live sub-region controllers. Called once when the window's body enters the DOM.
- **`update(runtime, windowState, element, change)`** *(optional)* — apply a targeted update for a known change without a full re-render. If absent, the scheduler falls back to `replace`.
- **`unmount(runtime, windowState, element)`** *(optional)* — release app-local resources.

The current apps expose `render` and `bind`; `bind` is renamed to `mount` and split so that one-time setup and per-update work are distinct. This is a small, mechanical migration.

### 6.2 Sub-regions inside an app

An app divides its window body into sub-regions just as the VM divides itself. The terminal, for example, has an `output` sub-region (keyed list of lines) and an `input-row` sub-region (patch-only). A keystroke marks `input-row` dirty; a command result appends to `output`. Neither touches the other, and neither touches the window chrome or any other window.

### 6.3 Live apps

Terminal, BuckyCode, and the Browser are *live* apps: their content changes faster than a comfortable reconcile cadence. They use the delegated sub-region strategy — they hold a reference to their content node from `mount` and mutate it imperatively (append a terminal line, patch an editor line, swap the browser viewport). The scheduler is involved only for structural changes (a new tab, a new pane). This keeps a fast-typing terminal at 60fps regardless of how much else is open.

---

## 7. Important Flows

### 7.1 Flow — terminal keystroke

```
keypress → CommandService updates terminal input state
         → emit terminal:input-changed
         → scheduler maps event → mark window:<id> sub-region "input-row" dirty
         → rAF flush → patch the input value + caret
Result: one attribute patch. No other window, no taskbar, no chrome touched.
```

### 7.2 Flow — terminal command produces output

```
Enter → CommandService runs command, appends N output lines
      → emit fs/command events as needed
      → emit terminal:lines-appended
      → scheduler marks "output" sub-region dirty (keyed list)
      → flush appends only the new line nodes; scroll pinned to bottom
Result: N nodes appended. Existing scrollback DOM untouched.
```

### 7.3 Flow — file created in terminal appears in Files app

```
mkdir/touch → FileSystemService mutates the tree
            → emit fs:node-created
            → scheduler marks: terminal "output" (success line)
                              + every open Files window's "grid" sub-region
            → flush: keyed reconciliation adds one tile to the Files grid
Result: the new node appears in Files with no app referencing the other.
```

### 7.4 Flow — window drag

```
pointerdown on handle → gesture begins, scheduler not involved
pointermove → style.left/top written directly, batched per rAF (current behavior)
pointerup → commitWindowPosition → single patch update of geometry
Result: zero reconciliation during the drag; one patch at the end.
```

### 7.5 Flow — open a new window

```
openApp → windowing creates window state → emit window:opened
        → scheduler marks window-layer dirty (keyed list) + taskbar dirty
        → flush: one new window node created and its app mounted;
                 existing windows' DOM and transient state untouched
```

### 7.6 Flow — phase change

```
phase boot→login→session→desktop → emit lifecycle event
   → scheduler markDirtyAll (phase transitions legitimately replace the screen)
   → flush rebuilds the phase region
Phase changes are the one sanctioned use of full-region replacement.
```

---

## 8. Data Models

### 8.1 Region descriptor

A region is registered with: a stable `id`, a `mountSelector` (how to find its DOM node), a `render` function, a `strategy` (`replace` | `patch` | `keyed` | `delegated`), and for keyed regions a `keyOf(item)` function.

### 8.2 Dirty set

The scheduler holds a `Set` of dirty region ids and a single scheduled-flag. `markDirty` adds to the set and schedules one rAF if none is pending. The set is drained and cleared on flush.

### 8.3 Event→region map

A declarative table mapping bus event names to the region ids they dirty. This table is the scheduler's knowledge of the system; subsystems extend it when they add events, rather than calling `markDirty` from scattered code.

### 8.4 Render output

Render functions return HTML strings (the current convention). The reconciler parses a string into nodes only for the regions/items that actually changed. The string-based approach is kept for simplicity; the optimization is *scope*, not a switch to a virtual DOM library — vanilla JavaScript only, per project principles.

---

## 9. Subsystem Responsibilities

| Component | Responsibility |
|-----------|----------------|
| RenderScheduler (`renderer` service) | Owns the dirty set, the rAF coalescing, the event→region map, and `flush`. |
| Region descriptors | Each component/app registers its regions and strategies. |
| Components | Provide pure `render` functions; never call `innerHTML` on the VM root. |
| Apps | Provide `render`/`mount`/`update`; own their sub-regions and live mutations. |
| Runtime | Attaches delegated root listeners; calls `markDirtyAll` on phase/mode/resize. |
| Event bus | Carries the change notifications the scheduler maps to regions. |

---

## 10. Dependencies

- **Event bus** (`vm-runtime.md` §5) — the scheduler is a bus subscriber; without it, change detection regresses to manual `markDirty` calls.
- **Window model** (`desktop-shell.md`) — each window is a region keyed by window id.
- **App contract** (`app-system.md`) — `render`/`mount`/`update`/`unmount` hooks.
- **Browser APIs** — `requestAnimationFrame` for coalescing, `cancelAnimationFrame` for teardown.

The render system depends on no domain subsystem (mail, OSINT, missions); those depend on *it* only indirectly, by emitting events.

---

## 11. Extension Points

- **New region** — register a descriptor; the scheduler manages it like any other.
- **New strategy** — the four strategies cover known needs; a new one (e.g. virtualized list for very long mailboxes) is added to the reconciler and opted into per region.
- **New event mapping** — extend the event→region table when a subsystem adds events.
- **Virtualized lists** — long keyed lists (a 500-entry leak database view) can opt into windowed rendering without changing their region contract.
- **Render profiling** — a debug overlay can subscribe to `onFlush` and report per-region reconcile cost; this is a pure addition.

---

## 12. Scalability Concerns

| Concern | Mitigation |
|---------|------------|
| Full rerenders (current behavior) | Region-scoped reconciliation; `markDirtyAll` reserved for phase/mode/resize only. |
| Many open windows | Each window is an independent region; an update to one never reconciles another. |
| Very long lists (mail, leak DB, comments) | Keyed reconciliation now; windowed virtualization as an opt-in strategy later. |
| High-frequency apps (terminal/editor) | Delegated sub-regions with imperative mutation; scheduler bypassed for content churn. |
| Event-bus storms | Per-frame coalescing — N events in one tick produce one flush. |
| Layout thrash | Reads (`getBoundingClientRect`) and writes are separated; geometry reads are cached per flush. |
| Animation conflicts | Continuous gestures write `style` directly and bypass the scheduler; closing animations use an `is-closing` class and a delayed structural removal (current pattern). |

---

## 13. Future Systems

- **Windowed virtualization** for lists that can reach thousands of rows.
- **Offscreen window suspension** — minimized windows skip reconciliation entirely until restored.
- **Render budget** — if a flush exceeds a frame budget, low-priority regions defer to the next frame.
- **Snapshot/restore** — serialize region state for fast session restore after a refresh, complementing PersistenceService.
- **Debug render inspector** — a developer overlay visualizing dirty regions and reconcile timings.

---

## 14. Recommended Implementation Order

1. **Introduce the event bus** (prerequisite, owned by `vm-runtime.md`).
2. **Build RenderScheduler** with `markDirty`, rAF coalescing, and the `replace` strategy. At this point full rerenders become region-scoped — the biggest single win.
3. **Define top-level regions** (§3.2) and register them; route the runtime's existing render triggers through `markDirty`.
4. **Add the `patch` strategy** and convert the clock, window geometry, and titlebar to it.
5. **Add keyed reconciliation** and convert the window layer, taskbar, Files grid, and notifications.
6. **Add delegated root listeners**; remove per-render `bind()` of shell controls.
7. **Split the app contract** into `render`/`mount`/`update`/`unmount`; migrate Terminal and Files.
8. **Add the delegated sub-region strategy** for live apps; migrate the terminal output/input.
9. **Wire the event→region map** so subsystems dirty regions by emitting events, not by calling `markDirty`.
10. **Add virtualization** once mail/database views exist and can grow large.

Steps 1–5 eliminate the full-rerender problem and should land before any data-heavy app (mail, database, OSINT) is built — those apps assume scoped rendering exists.
