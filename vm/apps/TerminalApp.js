import { getNode, listNode, resolvePath } from "../core/filesystem.js";

const COMMANDS = [
    "help",
    "ls",
    "cd",
    "clear",
    "cat",
    "scan",
    "decrypt",
    "connect",
    "open",
    "files",
    "pwd"
];

export function createTerminalState(user, filesystem) {
    return {
        cwd: filesystem.cwd,
        input: "",
        lines: [
            { type: "system", text: "Bucky VM terminal linked to local simulation layer." },
            { type: "system", text: `Authenticated profile: ${user.username || "operator"}` },
            { type: "system", text: "Type 'help' for available commands." }
        ]
    };
}

export function windowsPath(path, username) {
    const safeUser = (username || "operator").replace(/[^\w.-]/g, "_");
    const relative = path.replace(`/users/${safeUser}`, "").replace(/\//g, "\\");
    return `C:\\Users\\${safeUser}${relative || "\\home"}`;
}

export function createPrompt(state, user) {
    return `${windowsPath(state.cwd, user.username)}> `;
}

export function runTerminalCommand(runtime, state, rawCommand) {
    const commandLine = rawCommand.trim();
    const [command = "", ...args] = commandLine.split(/\s+/);
    const next = {
        ...state,
        input: "",
        lines: [
            ...state.lines,
            { type: "prompt", text: `${createPrompt(state, runtime.user)}${commandLine}` }
        ]
    };

    if (!commandLine) return next;

    switch (command.toLowerCase()) {
        case "help":
            next.lines.push({ type: "output", text: `Commands: ${COMMANDS.join(", ")}` });
            next.lines.push({ type: "output", text: "Everything here is simulated in frontend state only." });
            return next;
        case "pwd":
            next.lines.push({ type: "output", text: state.cwd });
            return next;
        case "ls": {
            const targetPath = resolvePath(state.cwd, args[0] || ".");
            const node = getNode(runtime.filesystem.tree, targetPath);
            if (!node) {
                next.lines.push({ type: "error", text: `ls: cannot access '${args[0] || "."}'` });
                return next;
            }
            if (typeof node !== "object") {
                next.lines.push({ type: "output", text: targetPath.split("/").pop() });
                return next;
            }
            const entries = listNode(node)
                .map((entry) => `${entry.type === "dir" ? "<DIR>" : "     "} ${entry.name}`)
                .join("\n");
            next.lines.push({ type: "output", text: entries || "(empty)" });
            return next;
        }
        case "cd": {
            const targetPath = resolvePath(state.cwd, args[0] || runtime.filesystem.cwd);
            const node = getNode(runtime.filesystem.tree, targetPath);
            if (!node || typeof node !== "object") {
                next.lines.push({ type: "error", text: `cd: no such directory '${args[0] || ""}'` });
                return next;
            }
            next.cwd = targetPath;
            return next;
        }
        case "cat": {
            const targetPath = resolvePath(state.cwd, args[0] || "");
            const node = getNode(runtime.filesystem.tree, targetPath);
            if (typeof node !== "string") {
                next.lines.push({ type: "error", text: "cat: choose a text file" });
                return next;
            }
            next.lines.push({ type: "output", text: node });
            return next;
        }
        case "clear":
            return { ...next, lines: [] };
        case "scan":
            next.lines.push({ type: "output", text: "SCANNING LOCAL ARCADE NODE..." });
            next.lines.push({ type: "success", text: "2 open simulation channels, 0 real system calls, relay stable." });
            return next;
        case "decrypt":
            next.lines.push({ type: "output", text: "DECRYPTING SAMPLE PAYLOAD..." });
            next.lines.push({ type: "success", text: "HELLO BUCKY" });
            return next;
        case "connect":
            next.lines.push({ type: "output", text: `CONNECTING ${args[0] || "secure-node"}...` });
            next.lines.push({ type: "success", text: "SIMULATED LINK ESTABLISHED" });
            return next;
        case "open":
        case "files":
            runtime.openApp("files");
            next.lines.push({ type: "success", text: "Opening Files runtime..." });
            return next;
        default:
            next.lines.push({ type: "error", text: `${command}: command not found` });
            return next;
    }
}

export function renderTerminalApp(runtime, windowState) {
    const terminal = windowState.appState;
    const lines = terminal.lines.map((line) => {
        const text = escapeHtml(line.text).replace(/\n/g, "<br>");
        return `<div class="vm-terminal-line is-${line.type}">${text}</div>`;
    }).join("");

    return `
        <div class="vm-terminal" data-terminal-window="${windowState.id}">
            <div class="vm-terminal-screen">
                ${lines}
                <div class="vm-terminal-input-row">
                    <span class="vm-terminal-prompt">${escapeHtml(createPrompt(terminal, runtime.user))}</span>
                    <input class="vm-terminal-input" value="${escapeHtml(terminal.input)}" spellcheck="false" autocomplete="off" aria-label="Terminal command">
                    <span class="vm-terminal-cursor"></span>
                </div>
            </div>
        </div>
    `;
}

export function bindTerminalApp(runtime, windowState, element) {
    const input = element.querySelector(".vm-terminal-input");
    const screen = element.querySelector(".vm-terminal-screen");
    if (!input) return;

    if (runtime.activeWindowId === windowState.id && !windowState.minimized && !windowState.closing) {
        input.focus({ preventScroll: true });
    }
    if (screen) screen.scrollTop = screen.scrollHeight;

    input.addEventListener("input", (event) => {
        runtime.updateWindowAppState(windowState.id, { input: event.target.value });
    });

    input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const current = runtime.getWindow(windowState.id);
        if (!current) return;
        const nextState = runTerminalCommand(runtime, current.appState, event.target.value);
        runtime.updateWindowAppState(windowState.id, nextState);
        runtime.render();
    });
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
