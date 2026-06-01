/**
 * Terminal app.
 *
 * A command line over the shared FileSystemService. Filesystem commands
 * mutate the one runtime filesystem, so directories and files created here
 * appear immediately in the Files app and BuckyCode (they observe fs:* events).
 *
 * Rendering: the terminal is a live app. After mount it appends scrollback
 * lines to its own DOM imperatively — it never triggers a full rerender and
 * never re-attaches its input listeners.
 */
import { escapeHtml } from "../core/util.js";
import { logError } from "../core/diagnostics.js";
import {
    startSession,
    executeFile,
    sessionProcesses,
    isRunnable,
    runtimeForName,
    runBanner,
    completeBanner,
    errorBlock
} from "../core/execution.js";

// Process-control words usable even while a foreground job holds the terminal
// (Phase 4.5). Typed at the locked prompt they manage the running job rather
// than being fed to it as input(); everything else is treated as script input.
const CONTROL_COMMANDS = new Set(["ps", "jobs", "top", "kill", "killall", "status"]);

// ----- State -----------------------------------------------------------------

export function createTerminalState(user, filesystem) {
    return {
        cwd: filesystem.homePath,
        input: "",
        history: [],
        historyIndex: 0,
        session: null,
        sessionName: null,
        sessionPrompt: "",
        foregroundPid: null,
        lines: [
            { type: "system", text: "Bucky VM terminal linked to the shared filesystem runtime." },
            { type: "system", text: `Authenticated profile: ${user.username || "operator"}` },
            { type: "system", text: "Type 'help' for available commands." }
        ]
    };
}

// ----- Prompt ----------------------------------------------------------------

export function windowsPath(path, username) {
    const safeUser = String(username || "operator").replace(/[^\w.-]/g, "_");
    const relative = String(path).replace(`/users/${safeUser}`, "").replace(/\//g, "\\");
    return `C:\\Users\\${safeUser}${relative || "\\home"}`;
}

export function createPrompt(state, user) {
    return `${windowsPath(state.cwd, user.username)}> `;
}

// ----- Command parsing -------------------------------------------------------

function tokenize(commandLine) {
    if (!commandLine) return [];
    const matches = commandLine.match(/"([^"]*)"|'([^']*)'|\S+/g) || [];
    return matches.map((item) => item.replace(/^["']|["']$/g, ""));
}

/**
 * Validate a directly-invoked path (./script.py, ~/bin/tool.py, /abs/path) and
 * return an exec descriptor { path, argv }, or null after reporting why it
 * cannot run. Like a real shell this requires the executable flag (chmod +x).
 * Execution itself flows through the async interactive session in the Enter
 * handler — no real code ever runs (see core/execution.js).
 */
function resolveDirectExec(runtime, state, command, args, out) {
    const fs = runtime.filesystem;
    const targetPath = fs.resolve(state.cwd, command);
    const node = fs.get(targetPath);
    if (!node) {
        out("error", `${command}: No such file or directory`);
        return null;
    }
    if (node.type === "dir") {
        out("error", `${command}: Is a directory`);
        return null;
    }
    if (!node.flags || !node.flags.executable) {
        out("error", `${command}: Permission denied — run: chmod +x ${command}`);
        return null;
    }
    if (!isRunnable(node.name)) {
        out("error", `${command}: no VM runtime can execute this file`);
        return null;
    }
    return { path: targetPath, argv: args };
}

/**
 * Run one command line. Mutates `state` (cwd, lines, history) and the shared
 * filesystem. Returns { cleared, lines } where `lines` are the new scrollback
 * entries to append to the DOM.
 */
function execCommand(runtime, state, raw) {
    const commandLine = raw.trim();
    const promptLine = { type: "prompt", text: `${createPrompt(state, runtime.user)}${commandLine}` };
    state.lines.push(promptLine);
    const appended = [promptLine];
    const out = (type, text) => {
        const line = { type, text };
        state.lines.push(line);
        appended.push(line);
    };
    let execRequest = null;

    if (!commandLine) return { cleared: false, lines: appended };

    state.history.push(commandLine);
    state.historyIndex = state.history.length;

    // Phase 4.5 — a trailing `&` requests a background launch (handled by the
    // run/python/./ cases). Strip it before tokenizing.
    let background = false;
    let effective = commandLine;
    const bgMatch = effective.match(/^(.*?\S)\s*&\s*$/);
    if (bgMatch) { background = true; effective = bgMatch[1].trim(); }

    const [command = "", ...args] = tokenize(effective);
    const fs = runtime.filesystem;
    const procs = sessionProcesses();

    switch (command.toLowerCase()) {
        case "clear":
            state.lines = [];
            return { cleared: true, lines: [] };

        case "help":
            out("system", "Bucky VM terminal — command reference");
            out("output", "  help            show this command list");
            out("output", "  ls [-alR][path] list a directory (-a hidden, -l long, -R recursive)");
            out("output", "  cd [path]       change the working directory");
            out("output", "  pwd             print the working directory");
            out("output", "  mkdir <dir>     create a directory (nested paths supported)");
            out("output", "  touch <file>    create an empty file");
            out("output", "  cat <file>      print a file's contents");
            out("output", "  edit <file>     open a file in BuckyCode (creates it if missing)");
            out("output", "  open <target>   open a file in BuckyCode, or open the Files app");
            out("output", "  files           open the Files app");
            out("output", "  browser [url]   open the BuckyNet browser (optionally at a bucky:// url)");
            out("output", "  chmod +x <file> mark a file executable (VM metadata only)");
            out("output", "  python <file>   run a Python file in the simulated VM runtime");
            out("output", "  run <file>      run a script (args supported: run tool.py LEAK-0004)");
            out("output", "  ./<file>        run an executable script directly");
            out("output", "  ./<file> &      run a script as a background job");
            out("system", "Processes (Phase 4.5):");
            out("output", "  ps / jobs / top list processes; jobs+top show active only");
            out("output", "  kill <pid>      terminate a process; killall <name>");
            out("output", "  status [pid]    show a process's details; fg / bg job control");
            out("system", "Filesystem inspection:");
            out("output", "  find [path] -name <pat>   tree [path]   du [path]");
            out("output", "  head/tail [-n N] <file>   grep [-i] <pattern> <file>");
            out("output", "  clear           clear the terminal screen");
            out("system", "Files and folders you create are shared live with Files and BuckyCode.");
            out("system", "Use the up and down arrows to recall previous commands.");
            break;

        case "pwd":
            out("output", state.cwd);
            break;

        case "ls": {
            // Flags may be combined (-al) or separate (-a -l). Path is the
            // first non-flag operand. Unknown flag chars are ignored.
            const flags = args.filter((a) => a.startsWith("-")).join("").replace(/-/g, "");
            const pathArg = args.find((a) => !a.startsWith("-"));
            const opt = { all: flags.includes("a"), long: flags.includes("l"), recursive: flags.includes("R") };
            const targetPath = fs.resolve(state.cwd, pathArg || ".");
            const node = fs.get(targetPath);
            if (!node) {
                out("error", `ls: cannot access '${pathArg || "."}': No such file or directory`);
                break;
            }
            if (node.type !== "dir") {
                out("output", lsLine({ node, name: node.name }, opt));
                break;
            }
            if (opt.recursive) lsRecursive(fs, targetPath, opt, out);
            else lsDir(fs, targetPath, opt, out);
            break;
        }

        case "cd": {
            const targetPath = fs.resolve(state.cwd, args[0] || fs.homePath);
            const node = fs.get(targetPath);
            if (!node || node.type !== "dir") {
                out("error", `cd: no such directory: ${args[0] || ""}`);
                break;
            }
            state.cwd = targetPath;
            break;
        }

        case "cat": {
            if (!args[0]) {
                out("error", "cat: missing file operand");
                break;
            }
            const result = fs.read(fs.resolve(state.cwd, args[0]));
            if (!result.ok) {
                out("error", `cat: ${args[0]}: ${result.error}`);
                break;
            }
            out("output", result.content || "(empty file)");
            break;
        }

        case "mkdir": {
            if (!args[0]) {
                out("error", "mkdir: missing directory operand");
                break;
            }
            args.forEach((name) => {
                const result = fs.mkdir(fs.resolve(state.cwd, name), {
                    owner: "terminal",
                    source: "mkdir",
                    recursive: true
                });
                if (result.ok) out("success", `created directory ${result.path}`);
                else out("error", `mkdir: ${result.error}`);
            });
            break;
        }

        case "touch": {
            if (!args[0]) {
                out("error", "touch: missing file operand");
                break;
            }
            args.forEach((name) => {
                const result = fs.touch(fs.resolve(state.cwd, name), {
                    owner: "terminal",
                    source: "touch"
                });
                if (result.ok) out("success", `touched ${result.path}`);
                else out("error", `touch: ${result.error}`);
            });
            break;
        }

        case "edit": {
            if (!args[0]) {
                out("error", "edit: missing file operand");
                break;
            }
            const targetPath = fs.resolve(state.cwd, args[0]);
            const node = fs.get(targetPath);
            if (node && node.type === "dir") {
                out("error", `edit: ${args[0]}: Is a directory`);
                break;
            }
            if (!node) {
                const created = fs.touch(targetPath, { owner: "terminal", source: "edit" });
                if (!created.ok) {
                    out("error", `edit: ${created.error}`);
                    break;
                }
            }
            runtime.openApp("buckycode", { path: targetPath });
            out("success", `opening ${targetPath} in BuckyCode`);
            break;
        }

        case "open": {
            if (!args[0] || args[0] === "files") {
                runtime.openApp("files");
                out("success", "Opening Files runtime...");
                break;
            }
            const targetPath = fs.resolve(state.cwd, args[0]);
            const node = fs.get(targetPath);
            if (!node) {
                out("error", `open: ${args[0]}: No such file or directory`);
                break;
            }
            if (node.type === "dir") {
                runtime.openApp("files");
                out("success", "Opening Files runtime...");
                break;
            }
            runtime.openApp("buckycode", { path: targetPath });
            out("success", `opening ${targetPath} in BuckyCode`);
            break;
        }

        case "files":
            runtime.openApp("files");
            out("success", "Opening Files runtime...");
            break;

        case "browser": {
            const target = args.join(" ").trim();
            runtime.openApp("browser", target ? { url: target } : undefined);
            out("success", target
                ? `Opening BuckyNet browser → ${target}`
                : "Opening BuckyNet browser...");
            break;
        }

        case "chmod": {
            const mode = args[0];
            const fileArg = args[1];
            if (!mode || !fileArg) {
                out("error", "chmod: usage: chmod +x <file>");
                break;
            }
            if (mode !== "+x" && mode !== "-x") {
                out("error", `chmod: unsupported mode '${mode}' (use +x or -x)`);
                break;
            }
            const targetPath = fs.resolve(state.cwd, fileArg);
            const node = fs.get(targetPath);
            if (!node) {
                out("error", `chmod: cannot access '${fileArg}': No such file or directory`);
                break;
            }
            if (node.type === "dir") {
                out("error", `chmod: '${fileArg}': Is a directory`);
                break;
            }
            const result = fs.setFlag(targetPath, "executable", mode === "+x");
            if (result.ok) {
                out("success", `${mode === "+x" ? "marked executable" : "cleared executable bit"}: ${result.path}`);
            } else {
                out("error", `chmod: ${result.error}`);
            }
            break;
        }

        case "python":
        case "python3": {
            if (!args[0]) {
                out("error", "python: usage: python <file.py>");
                break;
            }
            const targetPath = fs.resolve(state.cwd, args[0]);
            const node = fs.get(targetPath);
            if (!node) {
                out("error", `python: can't open file '${args[0]}': No such file or directory`);
                break;
            }
            if (node.type === "dir") {
                out("error", `python: '${args[0]}': is a directory`);
                break;
            }
            if (runtimeForName(node.name) !== "python") {
                out("error", `python: '${args[0]}': not a Python (.py) file`);
                break;
            }
            execRequest = { path: targetPath, argv: args.slice(1) };
            break;
        }

        case "run": {
            if (!args[0]) {
                out("error", "run: usage: run <file.py> [args...]");
                break;
            }
            const targetPath = fs.resolve(state.cwd, args[0]);
            const node = fs.get(targetPath);
            if (!node) {
                out("error", `run: can't open file '${args[0]}': No such file or directory`);
                break;
            }
            if (node.type === "dir") {
                out("error", `run: '${args[0]}': is a directory`);
                break;
            }
            if (runtimeForName(node.name) !== "python") {
                out("error", `run: '${args[0]}': not a runnable (.py) file`);
                break;
            }
            execRequest = { path: targetPath, argv: args.slice(1) };
            break;
        }

        // ----- Phase 4.5 — process table -----
        case "ps":
            renderProcTable(procs.list(), out, "PROCESSES");
            break;

        case "jobs":
            renderProcTable(procs.active(), out, "JOBS (active)");
            break;

        case "top": {
            const s = procs.stats();
            const done = (s.completed || 0) + (s.failed || 0) + (s.terminated || 0);
            out("system", `tasks ${s.total}  •  running ${s.running || 0}  waiting ${s.waiting || 0}  sleeping ${s.sleeping || 0}  done ${done}`);
            renderProcTable(procs.active(), out, "ACTIVE");
            break;
        }

        case "kill": {
            if (!args[0]) { out("error", "kill: usage: kill <pid>"); break; }
            const pid = parseInt(args[0], 10);
            const target = procs.get(pid);
            if (!target) { out("error", `kill: no such process: ${args[0]}`); break; }
            if (procs.kill(pid)) out("success", `terminated PID ${pid} (${target.name})`);
            else out("error", `kill: PID ${pid} is already ${target.state}`);
            break;
        }

        case "killall": {
            if (!args[0]) { out("error", "killall: usage: killall <name>"); break; }
            const n = procs.killall(args[0]);
            if (n > 0) out("success", `terminated ${n} process(es) named ${args[0]}`);
            else out("output", `killall: no active process named ${args[0]}`);
            break;
        }

        case "status": {
            const p = args[0] ? procs.get(parseInt(args[0], 10)) : procs.foreground();
            if (!p) { out("output", args[0] ? `status: no such process ${args[0]}` : "status: no active foreground process"); break; }
            renderProcStatus(p, out);
            break;
        }

        case "fg": {
            const f = procs.foreground();
            if (f) out("system", `foreground: ${f.name} (PID ${f.pid}) — ${f.state}`);
            else out("output", "fg: no current job");
            break;
        }

        case "bg":
            out("system", "bg: launch a background job with a trailing & — e.g. ./scanner.py &");
            break;

        // ----- Phase 4.5 — virtual filesystem inspection -----
        case "find": {
            const pathArg = args.find((a) => !a.startsWith("-")) || ".";
            const nameIdx = args.indexOf("-name");
            const pattern = nameIdx >= 0 ? args[nameIdx + 1] : null;
            const base = fs.resolve(state.cwd, pathArg);
            if (!fs.get(base)) { out("error", `find: '${pathArg}': No such file or directory`); break; }
            const results = fsFind(fs, base, pattern);
            out("output", results.length ? results.join("\n") : "(no matches)");
            break;
        }

        case "tree": {
            const pathArg = args.find((a) => !a.startsWith("-")) || ".";
            const base = fs.resolve(state.cwd, pathArg);
            if (!fs.get(base)) { out("error", `tree: '${pathArg}': No such file or directory`); break; }
            out("output", base);
            fsTree(fs, base, "", out);
            break;
        }

        case "du": {
            const pathArg = args.find((a) => !a.startsWith("-")) || ".";
            const base = fs.resolve(state.cwd, pathArg);
            if (!fs.get(base)) { out("error", `du: '${pathArg}': No such file or directory`); break; }
            fsDu(fs, base, out);
            break;
        }

        case "head":
        case "tail": {
            const nIdx = args.indexOf("-n");
            const count = nIdx >= 0 ? (parseInt(args[nIdx + 1], 10) || 10) : 10;
            const fileArg = args.find((a, i) => !a.startsWith("-") && !(nIdx >= 0 && i === nIdx + 1));
            if (!fileArg) { out("error", `${command}: missing file operand`); break; }
            const r = fs.read(fs.resolve(state.cwd, fileArg));
            if (!r.ok) { out("error", `${command}: ${fileArg}: ${r.error}`); break; }
            const lines = String(r.content || "").split("\n");
            const sel = command === "head" ? lines.slice(0, count) : lines.slice(-count);
            out("output", sel.join("\n"));
            break;
        }

        case "grep": {
            const flags = args.filter((a) => a.startsWith("-")).join("");
            const rest = args.filter((a) => !a.startsWith("-"));
            const pattern = rest[0];
            const fileArg = rest[1];
            if (!pattern || !fileArg) { out("error", "grep: usage: grep [-i] <pattern> <file>"); break; }
            const r = fs.read(fs.resolve(state.cwd, fileArg));
            if (!r.ok) { out("error", `grep: ${fileArg}: ${r.error}`); break; }
            const ci = flags.includes("i");
            const needle = ci ? pattern.toLowerCase() : pattern;
            const hits = String(r.content || "").split("\n").filter((l) => (ci ? l.toLowerCase() : l).includes(needle));
            out("output", hits.length ? hits.join("\n") : "(no matches)");
            break;
        }

        default:
            // A path invoked directly — ./script.py, ~/tool.py, /abs/path.
            if (/^(\.\/|\.\.\/|\/|~\/)/.test(command)) {
                execRequest = resolveDirectExec(runtime, state, command, args, out);
                break;
            }
            out("error", `${command}: command not found`);
    }

    if (execRequest) execRequest.background = background;
    return { cleared: false, lines: appended, exec: execRequest };
}

// ----- Rendering -------------------------------------------------------------

function lineMarkup(line) {
    return `<div class="vm-terminal-line is-${line.type}">${escapeHtml(line.text).replace(/\n/g, "<br>")}</div>`;
}

export function renderTerminalApp(runtime, windowState) {
    const state = windowState.appState;
    const lines = state.lines.map(lineMarkup).join("");
    return `
        <div class="vm-terminal" data-terminal-window="${windowState.id}">
            <div class="vm-terminal-screen">
                ${lines}
                <div class="vm-terminal-input-row">
                    <span class="vm-terminal-prompt">${escapeHtml(createPrompt(state, runtime.user))}</span>
                    <input class="vm-terminal-input" value="${escapeHtml(state.input)}" spellcheck="false" autocomplete="off" aria-label="Terminal command">
                    <span class="vm-terminal-cursor"></span>
                </div>
            </div>
        </div>
    `;
}

function appendLines(view, lineObjects) {
    if (!view.screen || !view.inputRow) return;
    lineObjects.forEach((line) => {
        const element = document.createElement("div");
        element.className = `vm-terminal-line is-${line.type}`;
        element.innerHTML = escapeHtml(line.text).replace(/\n/g, "<br>");
        view.screen.insertBefore(element, view.inputRow);
    });
    view.screen.scrollTop = view.screen.scrollHeight;
}

// ----- Interactive script sessions (Phase 4.4) -------------------------------

/** Append a line to the live DOM and to scrollback state (survives rerender). */
function pushLine(view, state, line) {
    state.lines.push(line);
    appendLines(view, [line]);
}

// ----- ls helpers (Phase 4.4 — -a hidden, -l long, -R recursive) -------------

/** A node's display name, with a trailing "*" executable indicator. */
function lsName(node) {
    const star = node.type === "file" && node.flags && node.flags.executable ? "*" : "";
    return node.name + star;
}

/** One listing row, plain or long (-l: type, exec bit, size, name). */
function lsLine(entry, opt) {
    const node = entry.node;
    if (opt.long) {
        const t = node.type === "dir" ? "d" : "-";
        const x = node.flags && node.flags.executable ? "x" : "-";
        const size = node.type === "dir" ? "-" : String(node.size || 0);
        return `${t}${x}  ${size.padStart(7)}  ${lsName(node)}`;
    }
    return `${node.type === "dir" ? "<DIR>" : "     "} ${lsName(node)}`;
}

/** List one directory (non-recursive), honouring the -a hidden filter. */
function lsDir(fs, path, opt, out) {
    const entries = fs.list(path).filter((e) => opt.all || !e.name.startsWith("."));
    out("output", entries.length ? entries.map((e) => lsLine(e, opt)).join("\n") : "(empty)");
}

/** Recursive listing: a `path:` header per directory, depth-first. */
function lsRecursive(fs, path, opt, out) {
    out("output", path + ":");
    lsDir(fs, path, opt, out);
    fs.list(path)
        .filter((e) => e.type === "dir" && (opt.all || !e.name.startsWith(".")))
        .forEach((e) => { out("output", ""); lsRecursive(fs, e.path, opt, out); });
}

// ----- Process table rendering (Phase 4.5) -----------------------------------

/** Map a process state to a coloured scrollback line type (see vm.css). */
function procLineType(state) {
    if (state === "running") return "proc-running";
    if (state === "waiting" || state === "sleeping") return "proc-waiting";
    if (state === "failed" || state === "terminated") return "proc-failed";
    return "proc-done"; // completed
}

/** Render a `ps`/`jobs`/`top` table; each row is coloured by its state. */
function renderProcTable(list, out, title) {
    if (title) out("system", title);
    if (!list.length) { out("output", "(no processes)"); return; }
    out("output", "  PID  STATE       PROG  OWNER      NAME");
    list.forEach((p) => {
        const pid = String(p.pid).padStart(4);
        const st = String(p.state).padEnd(10);
        const pr = (p.progress != null ? p.progress + "%" : "-").padStart(4);
        const ow = String(p.owner || "").padEnd(9);
        out(procLineType(p.state), ` ${pid}  ${st}  ${pr}  ${ow}  ${p.name}${p.background ? " &" : ""}`);
    });
}

/** Render the `status` detail block for one process. */
function renderProcStatus(p, out) {
    out("system", `PID ${p.pid}`);
    out("output", `NAME      ${p.name}`);
    out(procLineType(p.state), `STATE     ${p.state}`);
    out("output", `OWNER     ${p.owner}`);
    if (p.progress != null) out("output", `PROGRESS  ${p.progress}%`);
    out("output", `ELAPSED   ${Math.max(0, Math.round(p.elapsedMs || 0))}ms`);
    if (p.exitCode != null) out("output", `EXIT      ${p.exitCode}`);
}

// ----- Virtual filesystem inspection (Phase 4.5) -----------------------------

/** Recursive path search under `base`, optionally filtered by a -name glob. */
function fsFind(fs, base, pattern) {
    const results = [];
    const match = (name) => {
        if (!pattern) return true;
        if (pattern.includes("*")) {
            const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i");
            return re.test(name);
        }
        return name.toLowerCase().includes(pattern.toLowerCase());
    };
    const walk = (path) => {
        const node = fs.get(path);
        if (!node) return;
        const name = path.split("/").pop() || path;
        if (match(name)) results.push(path);
        if (node.type === "dir") fs.list(path).forEach((e) => walk(e.path));
    };
    walk(base);
    return results;
}

/** Depth-first ASCII tree of a directory. */
function fsTree(fs, path, prefix, out) {
    const entries = fs.list(path);
    entries.forEach((e, i) => {
        const last = i === entries.length - 1;
        out("output", prefix + (last ? "└─ " : "├─ ") + e.name + (e.type === "dir" ? "/" : ""));
        if (e.type === "dir") fsTree(fs, e.path, prefix + (last ? "   " : "│  "), out);
    });
}

/** Disk-usage summary: each immediate subdirectory total, then the base total. */
function fsDu(fs, base, out) {
    const sizeOf = (p) => {
        const node = fs.get(p);
        if (!node) return 0;
        if (node.type !== "dir") return node.size || 0;
        return fs.list(p).reduce((s, e) => s + sizeOf(e.path), 0);
    };
    const node = fs.get(base);
    if (node && node.type === "dir") {
        fs.list(base).filter((e) => e.type === "dir").forEach((e) => out("output", `${String(sizeOf(e.path)).padStart(8)}  ${e.path}`));
    }
    out("output", `${String(sizeOf(base)).padStart(8)}  ${base}`);
}

/** Filesystem/launch verbs blocked while a foreground job holds the terminal. */
const SHELL_VERBS = new Set([
    "ls", "cd", "pwd", "cat", "mkdir", "touch", "edit", "open", "files",
    "browser", "chmod", "python", "python3", "run", "find", "tree", "du", "head", "tail", "grep"
]);
function isShellVerb(word) {
    return SHELL_VERBS.has(word);
}

/** Tear down the active foreground session (e.g. after a kill). */
function endForegroundSession(runtime, windowState, view, reason) {
    const state = windowState.appState;
    pushLine(view, state, { type: "system", text: `[${reason}] ${state.sessionName || "process"} (PID ${state.foregroundPid}) ended.` });
    state.session = null;
    state.sessionName = null;
    state.sessionPrompt = "";
    state.foregroundPid = null;
    view.promptEl.textContent = createPrompt(state, runtime.user);
}

/**
 * Run a script as a background job (Phase 4.5). It runs non-interactively (so it
 * never blocks the prompt or reads input()); output streams live and the run is
 * recorded in the process table as a background process.
 */
async function startBackground(runtime, windowState, view, exec) {
    const state = windowState.appState;
    const fs = runtime.filesystem;
    const name = fs.normalize(exec.path).split("/").pop();
    pushLine(view, state, { type: "system", text: `[bg] ${name} launched` });
    const stdout = (line) => pushLine(view, state, { type: "output", text: line });
    const notify = (title, message) => { try { runtime.notify && runtime.notify(title, message); } catch (_e) { /* no-op */ } };
    let result;
    try {
        result = await executeFile(fs, exec.path, { argv: exec.argv, user: runtime.user, stdout, owner: "terminal", background: true, notify });
    } catch (error) {
        pushLine(view, state, { type: "error", text: `bg: ${error && error.message ? error.message : error}` });
        return;
    }
    if (result.ok) {
        pushLine(view, state, { type: "success", text: `[bg] PID ${result.pid} (${name}) completed` });
    } else if (result.errorInfo) {
        pushLine(view, state, { type: "system", text: `[bg] PID ${result.pid} (${name}) failed` });
        errorBlock(name, result.errorInfo).forEach((t) => pushLine(view, state, { type: "error", text: t }));
    } else {
        pushLine(view, state, { type: "error", text: `[bg] ${name}: ${result.error || "failed"}` });
    }
}

/**
 * Begin running a script as an interactive session. Output streams live; if
 * the script calls input() the session suspends and the terminal feeds the
 * next typed line back in (see the Enter handler).
 */
async function startScript(runtime, windowState, view, exec) {
    const state = windowState.appState;
    const fs = runtime.filesystem;
    const name = fs.normalize(exec.path).split("/").pop();
    runBanner(name).forEach((t) => pushLine(view, state, { type: "system", text: t }));

    const stdout = (line) => pushLine(view, state, { type: "output", text: line });
    const notify = (title, message) => { try { runtime.notify && runtime.notify(title, message); } catch (_e) { /* no-op */ } };
    let driver;
    try {
        driver = await startSession(fs, exec.path, { argv: exec.argv, user: runtime.user, stdout, notify, exclusive: true });
    } catch (error) {
        pushLine(view, state, { type: "error", text: `run: ${error && error.message ? error.message : error}` });
        return;
    }
    if (!driver.ok) {
        pushLine(view, state, { type: "error", text: `run: ${driver.error}` });
        return;
    }
    state.session = driver;
    state.sessionName = name;
    state.foregroundPid = driver.pid;
    pushLine(view, state, { type: "system", text: `PID ${driver.pid} Started.` });
    handleSessionStep(runtime, windowState, view, driver.step());
}

/** Render one step of a session: suspend at a prompt, or finish with a banner. */
function handleSessionStep(runtime, windowState, view, step) {
    const state = windowState.appState;
    if (step.status === "input") {
        state.sessionPrompt = step.prompt ? `${step.prompt} ` : "";
        view.promptEl.textContent = state.sessionPrompt || "> ";
        view.screen.scrollTop = view.screen.scrollHeight;
        return;
    }
    const result = step.result || {};
    if (result.ok) {
        completeBanner(result.durationMs).forEach((t) => pushLine(view, state, { type: "system", text: t }));
    } else if (result.errorInfo) {
        errorBlock(state.sessionName || "script", result.errorInfo).forEach((t) => pushLine(view, state, { type: "error", text: t }));
    } else {
        pushLine(view, state, { type: "error", text: result.error || "run failed" });
    }
    state.session = null;
    state.sessionName = null;
    state.sessionPrompt = "";
    state.foregroundPid = null;
    view.promptEl.textContent = createPrompt(state, runtime.user);
}

// ----- Lifecycle -------------------------------------------------------------

export function mountTerminalApp(runtime, windowState, element) {
    const view = windowState.view;
    view.input = element.querySelector(".vm-terminal-input");
    view.screen = element.querySelector(".vm-terminal-screen");
    view.inputRow = element.querySelector(".vm-terminal-input-row");
    view.promptEl = element.querySelector(".vm-terminal-prompt");
    if (!view.input || !view.screen) return;

    view.input.addEventListener("input", (event) => {
        windowState.appState.input = event.target.value;
    });

    view.input.addEventListener("keydown", async (event) => {
        const state = windowState.appState;

        if (event.key === "Enter") {
            event.preventDefault();
            const value = view.input.value;
            state.input = "";
            view.input.value = "";

            // Mid-interactive-script: the terminal is LOCKED to the foreground
            // job (Phase 4.5). Process-control words manage it; shell/launch
            // verbs are refused as "Terminal busy"; anything else answers the
            // script's input()/form/menu prompt.
            if (state.session) {
                const trimmed = value.trim();
                const word = (trimmed.split(/\s+/)[0] || "").toLowerCase();
                if (CONTROL_COMMANDS.has(word)) {
                    const ctl = execCommand(runtime, state, value);
                    appendLines(view, ctl.lines);
                    if ((word === "kill" || word === "killall") && state.foregroundPid != null) {
                        const fp = sessionProcesses().get(state.foregroundPid);
                        if (!fp || ["terminated", "completed", "failed"].includes(fp.state)) {
                            endForegroundSession(runtime, windowState, view, "killed");
                        }
                    }
                    return;
                }
                if (isShellVerb(word) || /^(\.\/|\.\.\/|\/|~\/)/.test(trimmed)) {
                    pushLine(view, state, { type: "prompt", text: `${state.sessionPrompt || ""}${value}` });
                    pushLine(view, state, { type: "error", text: `Terminal busy. Active process: ${state.sessionName} (PID ${state.foregroundPid}). Use ps / kill ${state.foregroundPid}.` });
                    return;
                }
                pushLine(view, state, { type: "prompt", text: `${state.sessionPrompt || ""}${value}` });
                handleSessionStep(runtime, windowState, view, state.session.step(value));
                return;
            }

            const result = execCommand(runtime, state, value);
            if (result.cleared) {
                view.screen.querySelectorAll(".vm-terminal-line").forEach((node) => node.remove());
            } else {
                appendLines(view, result.lines);
            }
            view.promptEl.textContent = createPrompt(state, runtime.user);

            if (result.exec) {
                if (result.exec.background) await startBackground(runtime, windowState, view, result.exec);
                else await startScript(runtime, windowState, view, result.exec);
            }
            return;
        }

        if (state.session) return; // command history is disabled mid-script

        if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!state.history.length) return;
            state.historyIndex = Math.max(0, state.historyIndex - 1);
            view.input.value = state.history[state.historyIndex] || "";
            state.input = view.input.value;
            return;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!state.history.length) return;
            state.historyIndex = Math.min(state.history.length, state.historyIndex + 1);
            view.input.value = state.history[state.historyIndex] || "";
            state.input = view.input.value;
        }
    });

    // Tapping anywhere on the screen focuses the prompt — important on touch
    // devices where the input row is a small target at the bottom.
    view.screen.addEventListener("click", () => {
        const selection = window.getSelection && String(window.getSelection());
        if (selection) return;
        view.input.focus({ preventScroll: true });
    });

    if (runtime.activeWindowId === windowState.id) {
        view.input.focus({ preventScroll: true });
    }
    view.screen.scrollTop = view.screen.scrollHeight;
}

export function unmountTerminalApp(runtime, windowState) {
    (windowState.view.cleanups || []).forEach((cleanup) => {
        try {
            cleanup();
        } catch (error) {
            logError("Terminal cleanup", error);
        }
    });
}

export function focusTerminalApp(runtime, windowState) {
    const input = windowState.view && windowState.view.input;
    if (input && !windowState.minimized) input.focus({ preventScroll: true });
}
