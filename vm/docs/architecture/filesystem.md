# Virtual Filesystem — Architecture Specification

> **Document status:** Source of truth.
> **Scope:** The Bucky VM virtual filesystem (VFS) — the shared data layer between every app, the terminal, tools, and the browser.
> **Depends on:** `vm-runtime.md` (service registry, event bus, storage tiers).
> **Consumed by:** Files app, Terminal, BuckyCode, browser, mail, OSINT tools, database, missions.

---

## 1. Purpose

The virtual filesystem is the **shared data layer** of the Bucky VM. It is the one structure that the terminal, the Files app, BuckyCode, installable tools, the browser, and missions all read from and write to. When the project principles say "the filesystem acts as the shared data layer between apps," this document specifies that layer.

The VFS exists to provide:

1. **A universal data surface.** Any subsystem can persist structured or unstructured output as files and directories. A network scanner writes results to `/scans/`, an OSINT lookup writes to `/intel/`, the browser saves a download, BuckyCode edits a script. They never need a bespoke storage API — the filesystem is the API.
2. **Interactivity.** Files and directories are first-class interactive objects. In the Files app a directory is clickable and navigable; a file is clickable, openable, viewable, and editable. The filesystem is not a data structure hidden behind a CLI — it is a visible, manipulable part of the simulated OS.
3. **Cross-app coherence.** A file created in the terminal appears immediately in the Files app. A file edited in BuckyCode reflects in `cat`. There is one tree, one source of truth, and every consumer observes the same state.
4. **Session realism.** Within a session the filesystem feels fully persistent: `mkdir` and `touch` create entries that stay, edits hold, tools accumulate output. Across a refresh it resets unless a node is explicitly promoted to the synced storage tier.

---

## 2. Architecture Overview

### 2.1 The filesystem service

The VFS is owned by `FileSystemService`, registered as `runtime.services.fs`. The current implementation lives in `vm/core/filesystem.js` and is created per session by `createVirtualFilesystem(username)`. The service wraps the tree and exposes the mutation and query API; consumers never touch the raw tree.

### 2.2 Current implementation

Today the filesystem is a plain nested-object tree:

- A **directory** is a JavaScript object whose keys are child names.
- A **file** is a string whose value is the file content.
- The filesystem object carries `cwd` (a default working directory string) and `tree` (the root object).

Helper functions provide the algorithms: `resolvePath(cwd, input)` resolves relative/absolute paths and `.`/`..`; `getNode(tree, path)` walks to a node; `getParentNode(tree, path)` returns the parent plus the leaf name; `listNode(node)` returns `{name, type}` entries where `type` is `dir` or `file`.

This model is correct and minimal. It has two limitations the target architecture removes: a file *is* its content (no room for metadata), and mutations are silent (no events, so other apps cannot react).

### 2.3 Target architecture

The target VFS keeps the nested-tree shape — it is simple, fast, and serializes trivially — but upgrades nodes from bare values to **node objects** carrying metadata, and routes every mutation through the service so it can emit events. The tree remains the storage; the service becomes the gatekeeper.

```
FileSystemService (runtime.services.fs)
  ├─ tree            the root directory node
  ├─ path engine     resolve / getNode / getParentNode / list
  ├─ mutation API    mkdir / touch / write / read / move / remove
  ├─ metadata        timestamps, owner app, tags, flags
  ├─ event emission  fs:node-created / -updated / -deleted / cwd-changed
  └─ persistence     promotes flagged nodes to the synced tier
```

### 2.4 Working directory model

`cwd` ("current working directory") is **per consumer**, not global. The terminal has a `cwd`, the Files app has a `cwd`, a tool invocation has a `cwd`. The filesystem provides a default starting directory (`/users/<username>/home`) and the path engine; each consumer owns its own pointer. This is essential: a `cd` in one terminal must not move the Files app's location. The filesystem service offers `cwd-changed` events scoped to a consumer id so a UI can follow along when desired.

---

## 3. Data Models

### 3.1 Node object model

Every node — file or directory — is a node object. The two share a common envelope and differ in their payload.

**Common envelope (all nodes):**

| Field | Type | Meaning |
|-------|------|---------|
| `type` | `"file"` \| `"dir"` | Node kind. |
| `name` | string | Leaf name; unique within its parent. |
| `createdAt` | timestamp | Creation time (session clock). |
| `modifiedAt` | timestamp | Last mutation time. |
| `owner` | string | The app or tool that created the node — e.g. `terminal`, `buckycode`, `netmapper`, `browser`, `system`. |
| `source` | string | Provenance detail — the command, tool run, mission id, or event that produced it. |
| `tags` | string[] | Free-form labels used by tools, missions, and the Files app for filtering (`scan`, `intel`, `evidence`, `mission:<id>`). |
| `flags` | object | Behavior flags: `persistent`, `readonly`, `hidden`, `system`, `locked`. |

**File payload:**

| Field | Type | Meaning |
|-------|------|---------|
| `content` | string | The file's textual content. |
| `mime` | string | Logical content type — `text/plain`, `text/log`, `application/json`, `text/markdown`, `application/bucky-package`, `image/sim`. Drives how apps render the file. |
| `size` | number | Derived from content length; maintained by the service. |

**Directory payload:**

| Field | Type | Meaning |
|-------|------|---------|
| `children` | map | Name → node object. |

The current bare-string representation is the degenerate case of this model (a file with only `content`). Migration wraps existing strings into node objects; the path engine and `listNode` are updated to read `children` and the envelope.

### 3.2 Path model

A path is an absolute, slash-delimited string rooted at `/`. The path engine (current `resolvePath`) handles: absolute paths (leading `/`), relative paths (resolved against a `cwd`), `.` (self), and `..` (parent, popping the stack). The engine is pure and is the *only* place path syntax is interpreted — no consumer parses paths itself.

### 3.3 The base filesystem (authored tier)

Every session is seeded with an authored base tree. The current seed establishes the shape and is extended over time:

| Path | Purpose |
|------|---------|
| `/users/<username>/home` | The player's home; readme and mission briefing files. |
| `/users/<username>/desktop` | Desktop shortcut entries. |
| `/logs` | System logs — `boot.log`, `network.log`. |
| `/downloads` | Files saved from the browser. |
| `/targets` | Authored target descriptors for missions and scans. |
| `/mail` | Filesystem-visible mail artifacts (the Mail app is authoritative; see `mail-system.md`). |
| `/system` | OS metadata — version, the app manifest. |

Tool- and mission-generated directories (`/scans`, `/intel`, `/evidence`) are *not* in the seed — they are created on demand (§5.3).

### 3.4 Filesystem snapshot (persistence)

For the synced storage tier, a node flagged `persistent` is serialized into a **filesystem snapshot**: a JSON projection of the flagged subtree, keyed by the linked Discord account. The snapshot is written through `PersistenceService` and re-hydrated into the base tree at boot. Non-flagged nodes are never serialized — they are ephemeral by design.

---

## 4. Filesystem Service API

The service exposes a stable API. All mutating methods accept the calling consumer's identity (`owner`) and emit events.

**Query**

- `resolve(cwd, input)` → absolute path.
- `get(path)` → node object or `null`.
- `getParent(path)` → `{ parent, name }`.
- `list(path)` → array of `{ name, type, ... }` entries for a directory.
- `exists(path)` → boolean.
- `read(path)` → file content, or error if missing/directory.

**Mutate**

- `mkdir(path, opts)` → create a directory; `opts.recursive` creates missing parents.
- `touch(path, opts)` → create an empty file (idempotent if the file exists).
- `write(path, content, opts)` → set file content; `opts.create` creates the file if absent; `opts.append` appends.
- `move(from, to)` → rename/relocate a node.
- `remove(path, opts)` → delete a node; `opts.recursive` for non-empty directories. Honors the `readonly`/`locked`/`system` flags.

**Metadata**

- `setTags(path, tags)`, `setFlag(path, flag, value)`, `stat(path)` → the full envelope.

**Persistence**

- `markPersistent(path)` → flag a subtree for the synced tier; subsequent mutations are queued to `PersistenceService`.

Every successful mutation updates `modifiedAt`, recomputes `size`, and emits the corresponding event.

---

## 5. Important Flows

### 5.1 Flow — `mkdir` from the terminal

```
mkdir /scans/network1
  → CommandService calls fs.mkdir("/scans/network1", { recursive: true }, owner:"terminal")
  → path engine resolves; service creates missing "scans", then "network1"
  → each new node stamped: createdAt, owner="terminal", source="mkdir"
  → emit fs:node-created for each
  → RenderScheduler dirties: terminal output + every open Files grid
Result: directory exists; visible in Files immediately (render-system §7.3).
```

### 5.2 Flow — `touch` and edit

```
touch report.txt        → fs.touch creates an empty file node (mime text/plain)
open report.txt         → Files/Terminal launches BuckyCode on that path
edit in BuckyCode        → fs.write(path, content) on save
  → modifiedAt updated, size recomputed
  → emit fs:node-updated
  → any view of that file (cat output, Files preview) refreshes
```

### 5.3 Flow — a tool auto-generates output directories

Tools follow a fixed convention so their output is discoverable and consistent:

```
netmapper scan arcade-node
  → tool computes a result set
  → tool calls fs.mkdir("/scans/arcade-node", { recursive: true }, owner:"netmapper")
  → tool calls fs.write("/scans/arcade-node/hosts.json", json, { create:true })
  → tool calls fs.write("/scans/arcade-node/summary.log", text, { create:true })
  → nodes stamped owner="netmapper", source="scan arcade-node", tags:["scan"]
Result: /scans/<target>/ created automatically; output saved as files.
```

Canonical tool output locations:

| Tool class | Directory | Example |
|------------|-----------|---------|
| Network scanners | `/scans/<target>/` | `netmapper` → `/scans/network1/hosts.json` |
| Lookup / WHOIS-style tools | `/intel/<entity-type>/` | a user lookup → `/intel/users/<handle>.json` |
| Breach / forensic tools | `/evidence/<case>/` | breach analysis → `/evidence/case-04/findings.log` |
| Packet/trace tools | `/captures/<session>/` | a trace → `/captures/trace-01/path.log` |

Missions read these conventional paths to detect that a step was completed (`mission-progression.md`).

### 5.4 Flow — the browser saves data to a file

```
Browser "download" / "save page" action
  → browser calls fs.write("/downloads/<name>", content, { create:true }, owner:"browser")
  → node tagged ["download"], source = the BuckyNet URL
Result: browser output becomes a filesystem artifact, usable by other apps and tools.
```

### 5.5 Flow — apps receive filesystem updates

No app polls the tree. Every app that displays filesystem content subscribes to `fs:*` events on the bus:

```
fs.mkdir/touch/write/remove → emit fs:node-* event
  → Files app subscriber marks its grid sub-region dirty (if the change is in its cwd)
  → Terminal subscriber may surface a notice
  → BuckyCode subscriber reloads the buffer if the open file changed underneath it
```

This subscription model is why files and directories stay consistent across apps without any app importing another.

---

## 6. Interactivity Model (Files App Contract)

The Files app is the primary visual surface of the VFS. Its contract with the filesystem:

- **Directories are clickable and navigable.** Clicking a directory tile sets the Files app's `cwd` to that path and re-lists. A sidebar lists root-level entries as jump targets.
- **Files are clickable and openable.** Clicking a file opens it according to its `mime`: text-like files open in BuckyCode (or a viewer), JSON opens in a structured viewer, package files open an install prompt, image-sim files open an image viewer.
- **Files are viewable.** Selecting a file shows its content (the current "directory empty / file tile" UI grows a preview pane).
- **Files are editable.** The open action routes editable mime types to BuckyCode, which writes back through `fs.write`.
- **Breadcrumb navigation.** The path bar reflects `cwd` and each segment is a clickable jump target.
- **Metadata is surfaced.** Tiles can show `owner`, `modifiedAt`, and `tags`, so a player can see that `/scans/network1/` came from `netmapper`.

The Files app holds *only* a `cwd` pointer and selection state. All data and all mutations go through `runtime.services.fs`. The full Files app spec is in `app-system.md`; this section defines the filesystem-side contract it must honor.

---

## 7. Metadata, Timestamps, and Ownership

### 7.1 Timestamps

`createdAt` and `modifiedAt` use the **session clock**, not wall-clock real time, so timestamps are coherent within the simulation and deterministic for missions. Authored seed nodes carry authored timestamps so the base filesystem has a believable history.

### 7.2 Ownership and source

`owner` answers "which app/tool made this"; `source` answers "exactly what produced it." Together they let the Files app attribute artifacts, let missions verify that a file came from the *right* tool, and let the OSINT system treat tool output as evidence with provenance.

### 7.3 Tags and flags

Tags are the cross-cutting index. Missions tag evidence files `mission:<id>`; tools tag their output by class; the Files app filters by tag. Flags govern behavior: `persistent` (synced tier), `readonly`/`locked` (mutation refused), `system` (hidden from normal listing, protected from `rm`), `hidden` (dotfile-style concealment).

---

## 8. Subsystem Responsibilities

| Component | Responsibility |
|-----------|----------------|
| FileSystemService | Owns the tree, the path engine, all mutation, metadata, and event emission. |
| Path engine | Sole interpreter of path syntax (`resolve`, `getNode`, `getParent`, `list`). |
| Files app | Visual navigation and interaction; holds only `cwd` + selection. |
| Terminal / CommandService | `ls`/`cd`/`cat`/`mkdir`/`touch`/`rm` map onto the service API. |
| BuckyCode | Reads and writes file content through the service. |
| Tools | Generate directories and files via the service following the output-path convention. |
| PersistenceService | Serializes and re-hydrates `persistent`-flagged subtrees. |
| RenderScheduler | Maps `fs:*` events to dirty regions. |

---

## 9. Dependencies

- **Runtime service registry + event bus** — the service is registered and emits on the bus.
- **Session service** — supplies the username that seeds `/users/<username>/`.
- **Render system** — consumes `fs:*` events to update views.
- **Persistence service** — backs the synced storage tier.

The filesystem depends on no app and no domain subsystem; it is a foundational layer that domain subsystems depend on.

---

## 10. Extension Points

- **New mime types** — register a mime and the app that handles its `open` action; the Files app routes by mime.
- **New node flags** — add a flag and the behavior it gates; the envelope is open.
- **New tool output conventions** — a new tool class declares its `/`-prefixed output directory; missions and the Files app pick it up via tags.
- **Mounted datasets** — large authored datasets (the leak database, fake-internet content) can be exposed as read-only mounted subtrees so they are browsable without bloating the editable tree.
- **Virtual/computed directories** — a directory whose `children` are produced on access (e.g. `/proc`-style live views of running tools) by giving the directory a generator instead of a static map.
- **Filesystem search** — a service method indexing names, tags, and content for a future Files-app search and for OSINT correlation.

---

## 11. Scalability Concerns

| Concern | Mitigation |
|---------|------------|
| Large trees from accumulated tool output | Tool output is namespaced under `/scans`, `/intel`, etc.; the Files app lists one directory at a time; deep trees never render whole. |
| Rendering large directories | Files grid uses keyed reconciliation (`render-system.md`); long directories opt into virtualization. |
| Mutation events flooding the bus | Bulk operations (a tool writing many files) batch into a single composite event where possible; the scheduler coalesces per frame. |
| Snapshot size for persistence | Only `persistent`-flagged subtrees are serialized; the bulk of the tree is ephemeral and never synced. |
| Path-resolution cost on deep trees | Resolution is O(path depth); node lookup is map-keyed O(depth). Acceptable; a path→node cache is available if profiling demands it. |
| Name collisions across tools | The output-path convention namespaces by tool class and target, making collisions structurally unlikely. |

---

## 12. Future Systems

- **Permissions model** — per-node read/write permissions tied to progression level, so some directories unlock with rank.
- **Mounted read-only datasets** — the leak database and fake-internet corpus surfaced as browsable mounts.
- **Filesystem search and indexing** — name/tag/content search powering Files search and OSINT correlation.
- **Computed/virtual directories** — live views of running tools and network state.
- **File versioning** — keep prior `content` revisions for mission-critical files so an investigation can show tampering.
- **Encrypted files** — files that require a key (from a mission, mail, or `decrypt`) to reveal content, formalizing the existing `cipher.pkg`/`decrypt` motif.
- **Quotas** — a soft cap on ephemeral tree size with cleanup of stale tool output.

---

## 13. Recommended Implementation Order

1. **Wrap nodes in the node object model** (§3.1) — upgrade files from bare strings to objects with envelope + payload; update the path engine and `listNode`.
2. **Route all mutation through `FileSystemService`** and emit `fs:*` events on every change.
3. **Add metadata** — timestamps, `owner`, `source`, `tags`, `flags` — stamped on every create/write.
4. **Make the Files app interactive** — clickable directories (navigation), clickable files (open by mime), a preview pane, breadcrumb path.
5. **Implement `rm`/`move`** with flag enforcement (`readonly`, `system`, `locked`).
6. **Wire BuckyCode** to `read`/`write` so files are editable end to end.
7. **Establish tool output conventions** (`/scans`, `/intel`, `/evidence`, `/captures`) and the auto-`mkdir` helper tools use.
8. **Add the `persistent` flag + snapshot serialization** through `PersistenceService`.
9. **Add filesystem search/indexing** once mail, database, and OSINT need cross-content correlation.
10. **Add mounted datasets and the permissions model** as the content universe and progression mature.

Steps 1–4 deliver the visible, interactive filesystem the project requires; steps 5–7 make it the working data layer for tools; steps 8+ extend it for persistence and investigation.
