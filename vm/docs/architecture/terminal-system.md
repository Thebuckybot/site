# Terminal System — Architecture Specification

> **Document status:** Source of truth.
> **Scope:** The Terminal app — command registry, parser, built-in commands, installable tooling, the fake package manager, and gating.
> **Depends on:** `vm-runtime.md`, `filesystem.md`, `app-system.md`, `mission-progression.md`, `discord-integration.md`.
> **Consumed by:** the player directly; OSINT, mission, and progression systems via command output.

---

## 1. Purpose

The terminal is the player's primary instrument inside the Bucky VM. It is where the operating-system fantasy is densest: a command line that feels real, where commands manipulate a real (virtual) filesystem, launch apps, run cybersecurity tools, and — over the life of the game — *grow*. New commands and tools are not patched in by editing the terminal; they are **installed**, **unlocked**, and **earned**.

The terminal exists to:

1. **Drive the filesystem.** `ls`, `cd`, `cat`, `mkdir`, `touch`, `rm`, `open`, `edit`, `save` are the command-line face of the VFS (`filesystem.md`).
2. **Run the cybersecurity sandbox.** Fictional scanners, lookup tools, packet analyzers, tracers, and breach analyzers are terminal tools that generate output and write it to files.
3. **Be a progression surface.** The set of available commands and tools is gated by player level, mission state, and Discord unlocks. A new player has a basic shell; an advanced player has a toolkit.
4. **Stay extensible.** Adding the fiftieth command or the twentieth installable tool must be a registration, never a rewrite of the command loop.

The terminal is deliberately *not* a real shell. It is a curated, themed, progression-aware command environment whose realism is a design effect, not an emulation goal.

---

## 2. Architecture Overview

### 2.1 Current implementation

`TerminalApp.js` today is a single-window app with: a hard-coded `COMMANDS` list; `createTerminalState` (the app's `appState`: `cwd`, `input`, `lines`); `runTerminalCommand`, a `switch` over the command word; a tokenizer (`tokenizeCommand`) that handles quotes; a Windows-style prompt renderer; and `render`/`bind`. Filesystem commands call the path engine and mutate the tree directly. The scrollback is an array of typed `lines` (`system`, `prompt`, `output`, `error`, `success`).

This is a correct, working v1. It does not scale: every new command grows the `switch`, there is no notion of installable or gated commands, and command logic is fused to the app.

### 2.2 Target architecture

The terminal is decomposed into a **CommandService** (`runtime.services.commands`) plus a thin Terminal *app* that is only an I/O surface.

```
Terminal app (apps/TerminalApp.js)
  └─ I/O surface only: scrollback, input line, prompt, history nav
        │  submits a raw command string
        ▼
CommandService (runtime.services.commands)
  ├─ Parser           tokenize → { command, args, flags, pipes }
  ├─ Command Registry map: name/alias → command descriptor
  ├─ Alias table      name → canonical command
  ├─ Resolver         gating checks (installed? unlocked? level? mission?)
  ├─ Executor         runs the command's handler in a Command Context
  └─ History          per-terminal command history
        │  uses
        ▼
PackageService (runtime.services.packages)
  └─ installable command bundles and apps; install state; unlock gating
```

The Terminal app holds presentation state; the CommandService holds the command system; the PackageService holds the installable catalog. New commands plug into the registry; new tools plug into the package catalog.

---

## 3. Command Pipeline

### 3.1 Parser

The parser turns a raw line into a structured invocation:

```
"netmapper scan arcade-node --depth 2 -v"
  → { command: "netmapper",
      args: ["scan", "arcade-node"],
      flags: { depth: "2", v: true },
      raw: "...", pipes: [] }
```

It extends the current tokenizer (quote-aware) with flag parsing (`--name value`, `--name`, `-x`), and reserves pipe/redirect tokens (`|`, `>`, `>>`) for a future composition stage (§11). The parser is pure and has no knowledge of which commands exist.

### 3.2 Command registry

Every command — built-in or installed — is a **command descriptor**:

| Field | Meaning |
|-------|---------|
| `name` | Canonical command word. |
| `aliases` | Alternate words mapping to this command. |
| `summary` | One-line help text. |
| `usage` | Argument/flag synopsis for `help <command>`. |
| `category` | `filesystem`, `system`, `network`, `intel`, `forensics`, `meta`. |
| `gating` | Availability rules — `level`, `mission`, `package` (see §6). |
| `handler` | The function that executes the command (§3.4). |

The registry is a map keyed by name and alias. `help` is generated from the registry, so it is always accurate. The current `COMMANDS` array becomes the seed registration of built-ins.

### 3.3 Resolver and gating

Before execution the resolver checks, in order: is the command *known*? is its package *installed*? is it *unlocked* (level/mission)? If a command is known but gated off, the resolver returns a themed, informative refusal (e.g. "tracekit: tool not installed — try `install tracekit`" or "breachscan: requires clearance level 4"). An *unknown* command returns `command not found`. This distinction matters: the player should learn that locked tools exist.

### 3.4 Command context and execution

The executor invokes the handler with a **Command Context** — the command's sandbox and its only interface to the VM:

| Context member | Purpose |
|----------------|---------|
| `args`, `flags` | Parsed invocation. |
| `cwd` | The terminal's working directory. |
| `fs` | The filesystem service (`filesystem.md`). |
| `runtime` | For service access (`apps`, `net`, `db`, `missions`, `bus`). |
| `print(line, type)` | Emit a scrollback line (`output`/`error`/`success`/`system`). |
| `printBlock(text)` | Emit a multi-line block. |
| `progress(stage)` | Emit staged progress lines (used by long-running tools). |
| `setCwd(path)` | Move the terminal's working directory. |
| `done(result)` | Finish; optional structured result for missions/scripting. |

A handler is **synchronous or asynchronous**. Tools that simulate work (a scan, a trace) are async: they `progress(...)` through stages on timers, then `done()`. The context is the security boundary — a command can only do what the context exposes, which keeps tools sandboxed and uniform.

### 3.5 Aliases

The alias table maps words to canonical commands (`la → ls`, `cls → clear`, themed shortcuts). Aliases are resolved before registry lookup. Players may define session aliases via an `alias` command; mission/progression systems may grant aliases as flavor rewards.

### 3.6 History

Each terminal instance keeps a command history on its `appState`. `history` prints it; Up/Down arrows navigate it; it is ephemeral per session. History is structured so a future progression system can inspect *what the player has run* — e.g. detecting that a mission's required command was executed.

---

## 4. Built-in Commands

Built-ins ship with every shell and are not gated. They are registered at boot as the seed of the command registry.

### 4.1 Filesystem commands

| Command | Behavior |
|---------|----------|
| `ls [path]` | List a directory via `fs.list`; `<DIR>`/file markers; supports `.`/`..`/relative/absolute. |
| `cd [path]` | Move the terminal `cwd` via the path engine; error on non-directory. |
| `pwd` | Print the working directory. |
| `cat <file>` | Print file content via `fs.read`; errors on missing file / directory. |
| `mkdir <path>` | Create a directory (`fs.mkdir`), `--recursive` for parents. |
| `touch <file...>` | Create empty file(s) (`fs.touch`); idempotent. |
| `rm <path>` | Delete a node (`fs.remove`); `--recursive` for directories; refuses `readonly`/`system`. |
| `open <target>` | Open a file in its mime-appropriate app, or launch an app by id (`runtime.openApp`). |
| `edit <file>` | Open a file in BuckyCode for editing (`app-system.md`). |
| `save` | Promote session state / the current file to the persistent tier (`filesystem.md` §3.4, `discord-integration.md`). |

### 4.2 System / meta commands

| Command | Behavior |
|---------|----------|
| `help [command]` | Registry-generated help; lists available commands or details one. |
| `clear` | Empties the scrollback. |
| `history` | Prints command history. |
| `alias [name=command]` | Lists or defines aliases. |
| `install <package>` | Installs a tool/app package via PackageService (§5). |
| `run <script>` | Executes a script file (§7) — a mission/automation utility. |
| `whoami` | Prints the linked operator identity. |
| `clearance` | Prints current level and unlocked tool tiers. |

The current demo commands (`scan`, `decrypt`, `connect`, `files`) are folded in: `files` becomes `open files`; `scan`/`decrypt`/`connect` become early flavor entries that the real tooling (§5) supersedes.

---

## 5. Installable Tooling and the Package Manager

### 5.1 Concept

Beyond built-ins, the terminal's power comes from **installable tools**. A tool is a package — a named bundle of one or more command descriptors (and optionally an app, see `app-system.md`). Tools are not present by default; the player installs them, and installation is gated.

The fictional package manager is **`bpkg`** ("Bucky Package"), invoked through `install` and an `apt`-style alias so both of these work:

```
install netmapper
apt install buckyshark
install tracekit
```

`apt` here is a Bucky-universe alias for `bpkg`, kept because it reads naturally; it is not a real package manager. There is no real network — see §10.

### 5.2 PackageService

`PackageService` (`runtime.services.packages`) owns:

- **The catalog** — every known package: `id`, display name, summary, the command descriptors it provides, the app it provides (if any), its gating rules, and an install "size"/duration for flavor.
- **Install state** — which packages are installed this session, and which are persistently owned by the linked account.
- **Install flow** — validate gating, play a staged install animation in the terminal, register the package's commands into the command registry and its app into the app registry, emit `app:installed` / a `package:installed` event.
- **Unlock state** — packages may be *visible but locked* (the player sees they exist) or *hidden until unlocked* by a mission/level.

### 5.3 Tool catalog (fictional cybersecurity tooling)

All tools are fictional, Bucky-themed, and operate only on the simulated VM. The catalog grows over time; the canonical first wave:

| Package | Class | What it simulates | Output |
|---------|-------|-------------------|--------|
| `netmapper` | Network scanner | An `nmap`-style host/port discovery scan of a BuckyNet target. | `/scans/<target>/hosts.json`, `summary.log` |
| `tracekit` | Network tracer | A route/path trace between BuckyNet nodes. | `/captures/<session>/path.log` |
| `buckyshark` | Packet analyzer | A packet-capture/inspection tool over simulated traffic. | `/captures/<session>/packets.log` |
| `lookout` | Lookup / WHOIS | Domain/host/handle registration and ownership lookup. | `/intel/<entity-type>/<id>.json` |
| `breachscan` | Breach analyzer | Cross-references a target against the leak/breach database. | `/evidence/<case>/findings.log` |
| `siftcli` | Search client | Command-line queries against the fake search index. | `/intel/search/<query>.txt` |
| `decryptor` | Crypto utility | Decrypts `cipher`-class files given a key. | edits/creates the target file |

Each tool follows the **filesystem output convention** (`filesystem.md` §5.3): it auto-creates its `/`-namespaced directory and writes structured + human-readable output. Missions detect tool use by reading those conventional paths and by inspecting command history.

### 5.4 Tool execution model

A tool command is an async handler:

```
netmapper scan arcade-node
  → resolver: installed? unlocked? → ok
  → handler: print("SCANNING arcade-node…")
           → progress stages on timers ("enumerating hosts", "probing ports"…)
           → compute a deterministic result from the network/db datasets
           → fs.mkdir("/scans/arcade-node"), fs.write(hosts.json), fs.write(summary.log)
           → print success summary; done({ scanId, hostCount })
  → emits fs:node-created; Files app updates; mission service may advance
```

Results are **deterministic** functions of the simulated datasets (`networking-system.md`, `database-system.md`) so investigations are reproducible and missions are solvable.

---

## 6. Gating: Levels, Missions, and Discord Unlocks

Command/tool availability is governed by a `gating` rule on the descriptor or package. Three gate types compose (all must pass):

| Gate | Source | Example |
|------|--------|---------|
| `level` | Player progression level (`session` service). | `breachscan` requires clearance level 4. |
| `mission` | A mission flag/state (`mission-progression.md`). | `decryptor` unlocks on completing the "First Cipher" mission. |
| `package` | The owning package is installed (PackageService). | `netmapper`'s `scan` needs the `netmapper` package. |

Gating outcomes:

- **Available** — registered and runnable.
- **Installable** — package known, not installed; `install` will work if level/mission gates pass.
- **Locked** — known but a level/mission gate fails; the resolver explains the requirement.
- **Hidden** — not surfaced at all until an unlock reveals it (used for late-game/spoiler tools).

Unlocks arrive through the **Discord progression bridge** (`discord-integration.md`): completing missions, reaching levels, or buying/earning tools in the Discord economy flips unlock flags that PersistenceService syncs into the session. On sync, PackageService re-evaluates gating and emits `app:unlocked` / `package:unlocked`; the terminal can surface "New tool available" feedback. This is how the terminal "supports future progression systems" — the command set is a function of account state.

---

## 7. Scripting and Automation (`run`)

`run <script>` executes a **script file** from the VFS — a newline-delimited list of terminal commands with comment (`#`) support. Scripts make the terminal a mission and automation utility:

- Missions ship script files as objectives or hints; `run mission.bsh` walks a guided sequence.
- Players author scripts in BuckyCode to automate multi-step tool chains.
- The executor runs lines through the same parser/registry/resolver path, so scripts cannot do anything an interactive session cannot, and gating still applies.

Scripts are the bridge between the terminal, the filesystem (where scripts live), BuckyCode (where they are edited), and missions (which use them) — see §9.

---

## 8. Data Models

| Model | Fields | Owner |
|-------|--------|-------|
| Terminal state (`appState`) | `cwd`, `input`, `lines[]`, `history[]`, `historyIndex`, `aliases` | Terminal app |
| Scrollback line | `type` (`system`/`prompt`/`output`/`error`/`success`), `text` | Terminal app |
| Parsed invocation | `command`, `args[]`, `flags{}`, `pipes[]`, `raw` | CommandService parser |
| Command descriptor | `name`, `aliases[]`, `summary`, `usage`, `category`, `gating`, `handler` | Command registry |
| Command context | `args`, `flags`, `cwd`, `fs`, `runtime`, `print`, `progress`, `setCwd`, `done` | Executor (per invocation) |
| Package descriptor | `id`, `name`, `summary`, `commands[]`, `app?`, `gating`, install meta | PackageService catalog |
| Install record | `packageId`, `installedAt`, `persistent` | PackageService |

---

## 9. Important Flows

### 9.1 Flow — a command end to end

```
input "cat /logs/boot.log" → Enter
  → Terminal app appends a prompt line, submits raw string to CommandService
  → parser → { command:"cat", args:["/logs/boot.log"] }
  → alias resolve → cat; registry lookup → descriptor
  → resolver: built-in, ungated → ok
  → executor builds Command Context, runs handler
  → handler: fs.read → context.print(content,"output")
  → Terminal app appends output lines; render scheduler updates the output sub-region
```

### 9.2 Flow — install a tool

```
"apt install buckyshark"
  → apt alias → install; install handler → PackageService.install("buckyshark")
  → gating checked (level/mission) → staged install animation printed
  → buckyshark's command descriptors registered into the command registry
  → packet-analyzer app (if any) registered into the app registry
  → emit package:installed (+ app:installed); notification "buckyshark installed"
  → `help` now lists buckyshark; `buckyshark` is runnable
```

### 9.3 Flow — a tool writes output that drives a mission

```
"netmapper scan arcade-node"
  → async tool runs, writes /scans/arcade-node/hosts.json
  → emit fs:node-created
  → MissionService subscriber sees a scan artifact at a conventional path
  → mission step "scan the arcade node" marked complete
  → emit mission:state-changed → notification; maybe unlocks the next tool
```

### 9.4 Flow — running a mission script

```
"run /users/<user>/home/mission.bsh"
  → run handler reads the script file via fs
  → each non-comment line → parser → registry → resolver → executor
  → gating still enforced per line; output streamed to the scrollback
```

---

## 10. Dependencies

- **CommandService / PackageService** — registered runtime services.
- **Filesystem** (`filesystem.md`) — every filesystem command and every tool's output.
- **App system** (`app-system.md`) — `open`/`edit` launch apps; packages may deliver apps.
- **Render system** (`render-system.md`) — the terminal is a *live* app with delegated output/input sub-regions.
- **Mission & progression** (`mission-progression.md`) — mission gates, command-history inspection, script-driven objectives.
- **Discord integration** (`discord-integration.md`) — level/economy unlocks flip package gating flags.
- **Networking & database** (`networking-system.md`, `database-system.md`) — the datasets tools compute their deterministic results from.

**No real network.** `install`/`apt` never make HTTP requests. The package catalog is a local authored dataset; "downloading" is a flavor animation. The only egress anywhere in the VM is PersistenceService syncing progression to the BuckyBot API (`vm-runtime.md` §6.4).

---

## 11. Extension Points

- **New command** — register a command descriptor; `help` updates automatically.
- **New tool/package** — add a package descriptor to the catalog with its commands, output convention, and gating.
- **New gate type** — extend the `gating` schema (e.g. a `faction` or `region` gate) and the resolver.
- **Command composition** — pipes (`|`) and redirects (`>`, `>>`) routing one command's `done` result into another or into a file; the parser already reserves the tokens.
- **Output formats** — tools can emit structured results (tables, trees) by adding scrollback line types.
- **Scripting language growth** — variables, conditionals, and loops in `.bsh` scripts for advanced mission automation.
- **Themed prompt / shell skins** — progression-reward prompt styles.
- **Tab completion** — completion over registry commands and filesystem paths.

---

## 12. Scalability Concerns

| Concern | Mitigation |
|---------|------------|
| `switch`-based command loop | Replaced by the command registry — adding commands is registration, not editing a loop. |
| Unbounded scrollback | Cap retained lines; older lines trimmed or virtualized (`render-system.md`). |
| Per-keystroke rendering | Terminal is a live app: input/output are delegated sub-regions; a keystroke patches only the input line. |
| Many installed tools | Tools are data in the package catalog; `help`/`clearance` page or group large command sets. |
| Async tools blocking UX | Tools run async via `progress`/`done`; the terminal stays interactive during a scan. |
| Determinism for missions | Tool results are pure functions of authored datasets, so investigations are reproducible. |
| Gating evaluation cost | Gating is a cheap flag check re-run only on progression-sync events. |

---

## 13. Future Systems

- **Command pipelines and redirects** for tool chaining.
- **`bpkg` package metadata UI** — a graphical package manager app listing the catalog with install state.
- **Advanced scripting** — control flow in `.bsh` for complex mission automation.
- **Tab completion and inline hints.**
- **Background tools** — long-running tools that report into the system tray instead of blocking the terminal.
- **Tool reputation / cooldowns** — economy-linked limits on powerful tools (`discord-integration.md`).
- **Multi-terminal sessions** with shared history and named workspaces.
- **A "man page" corpus** — wiki-linked documentation for every command and tool (`fake-internet.md`).

---

## 14. Recommended Implementation Order

1. **Extract `CommandService`** — move parsing and execution off `TerminalApp`; the app becomes an I/O surface.
2. **Build the command registry** — convert every built-in from the `switch` into a registered descriptor; generate `help` from the registry.
3. **Add the parser upgrade** — flags and reserved pipe/redirect tokens; add `history` + arrow navigation and the Command Context.
4. **Complete the filesystem command set** — `rm`, `edit`, `save`, recursive `mkdir`, mime-aware `open` (depends on `filesystem.md` and `app-system.md`).
5. **Build `PackageService`** and the `install`/`apt` flow with the staged install animation.
6. **Ship the first tool wave** — `netmapper`, `lookout`, then `tracekit`/`buckyshark`/`breachscan` — each following the filesystem output convention.
7. **Wire gating** — level/mission/package gates and the resolver's locked/installable/hidden outcomes.
8. **Add `run` and `.bsh` scripting** so missions can ship guided sequences.
9. **Connect Discord unlocks** — progression sync flips package gating; emit unlock notifications.
10. **Add composition, completion, and the graphical `bpkg` app** as the toolset matures.

Steps 1–4 turn the terminal into a registry-driven, scalable command system; steps 5–9 make it the progression-aware cybersecurity sandbox the project is built around.
