/**
 * FileSystemService — the Bucky VM virtual filesystem (VFS).
 *
 * The shared data layer between the terminal, the Files app and BuckyCode.
 * See docs/architecture/filesystem.md.
 *
 * Model:
 *   - A directory node:  { type:"dir",  name, createdAt, modifiedAt, owner,
 *                          source, tags, flags, children }
 *   - A file node:       { type:"file", name, createdAt, modifiedAt, owner,
 *                          source, tags, flags, content, mime, size }
 *
 * Every mutation is routed through the service so it can stamp metadata and
 * emit fs:* events on the runtime event bus. Consumers never touch the raw
 * tree; they go through the query/mutation API below.
 *
 * Storage is session-based and in-memory: state feels persistent during a
 * session and resets on refresh (no backend sync in this phase).
 *
 * Rejected operations return { ok:false, error } and are surfaced (debug
 * mode only) through the diagnostics helper — they never throw.
 */
import { debugLog, debugWarn } from "./diagnostics.js";

const MIME_BY_EXTENSION = {
    txt: "text/plain",
    log: "text/log",
    json: "application/json",
    md: "text/markdown",
    sys: "text/plain",
    link: "application/bucky-link",
    pkg: "application/bucky-package",
    msg: "text/plain",
    bsh: "text/x-bucky-script"
};

function inferMime(name) {
    const extension = String(name).split(".").pop().toLowerCase();
    return MIME_BY_EXTENSION[extension] || "text/plain";
}

function safeUserName(username) {
    return String(username || "operator").replace(/[^\w.-]/g, "_");
}

function now() {
    return Date.now();
}

/** Build a rejected-operation result and log it (debug mode only). */
function fail(operation, error) {
    debugWarn(`fs.${operation} rejected: ${error}`);
    return { ok: false, error };
}

function makeDir(name, owner, source) {
    return {
        type: "dir",
        name,
        createdAt: now(),
        modifiedAt: now(),
        owner: owner || "system",
        source: source || "runtime",
        tags: [],
        flags: {},
        children: {}
    };
}

function makeFile(name, content, owner, source) {
    const text = content == null ? "" : String(content);
    return {
        type: "file",
        name,
        createdAt: now(),
        modifiedAt: now(),
        owner: owner || "system",
        source: source || "runtime",
        tags: [],
        flags: {},
        content: text,
        mime: inferMime(name),
        size: text.length
    };
}

/** Recursively convert a plain seed literal into node objects. */
function literalToNode(name, value, owner) {
    if (typeof value === "string") {
        const file = makeFile(name, value, owner, "seed");
        file.source = "seed";
        return file;
    }
    const dir = makeDir(name, owner, "seed");
    Object.entries(value).forEach(([childName, childValue]) => {
        dir.children[childName] = literalToNode(childName, childValue, owner);
    });
    return dir;
}

/** The authored base filesystem seeded into every session. */
function buildSeedTree(username) {
    const user = safeUserName(username);
    const literal = {
        users: {
            [user]: {
                home: {
                    "readme.txt":
                        `Welcome ${username || "operator"}.\n` +
                        "This is the Bucky VM virtual filesystem.\n" +
                        "Files and directories you create live for this session only.\n" +
                        "Try: mkdir ~/Desktop/intel and touch ~/Desktop/notes.txt — they appear on the desktop.",
                    "mission.txt":
                        "Objective: keep the arcade node warm.\n" +
                        "Inspect /logs, organise /downloads, and document findings.",
                    Desktop: {
                        "terminal.link": "terminal",
                        "files.link": "files",
                        "buckycode.link": "buckycode"
                    }
                }
            }
        },
        logs: {
            "boot.log": "INITIALIZING VM\nLOADING MEMORY\nCONNECTING SECURE NODE\nBOOTING BUCKY OS",
            "network.log": "127.0.0.1 arcade-node stable\nsecure relay simulated link active"
        },
        downloads: {
            "cipher.pkg": "48 45 4c 4c 4f 20 42 55 43 4b 59"
        },
        targets: {
            "arcade-node.json": '{ "target": "arcade-node", "status": "online", "risk": "low" }'
        },
        mail: {
            "welcome.msg": "Subject: Bucky VM\nThe workstation is online. More apps are coming."
        },
        system: {
            "version.sys": "Bucky OS 0.2 filesystem runtime",
            "apps.sys": "terminal files buckycode"
        }
    };

    const root = makeDir("", "system", "seed");
    Object.entries(literal).forEach(([name, value]) => {
        root.children[name] = literalToNode(name, value, "system");
    });
    return root;
}

/**
 * Create a FileSystemService bound to an event bus.
 * @param {string} username
 * @param {{emit:Function}} [bus]
 */
export function createVirtualFilesystem(username, bus) {
    const user = safeUserName(username);
    const homePath = `/users/${user}/home`;
    const desktopPath = `${homePath}/Desktop`;
    const tree = buildSeedTree(username);

    function emit(eventName, payload) {
        if (bus && typeof bus.emit === "function") bus.emit(eventName, payload);
    }

    /**
     * Resolve an input path against a working directory to an absolute path.
     * A leading "~" expands to the user's home directory (so "~/Desktop"
     * resolves to the desktop directory).
     */
    function resolve(cwd, input = "") {
        if (!input || input === ".") return cwd || "/";
        let raw = String(input);
        if (raw === "~" || raw.startsWith("~/")) {
            raw = homePath + raw.slice(1);
        }
        const parts = raw.startsWith("/")
            ? []
            : String(cwd || "/").split("/").filter(Boolean);

        raw.split("/").filter(Boolean).forEach((part) => {
            if (part === ".") return;
            if (part === "..") {
                parts.pop();
                return;
            }
            parts.push(part);
        });

        return "/" + parts.join("/");
    }

    /** Return the node at an absolute path, or null. The root is "/". */
    function nodeAt(path) {
        const parts = String(path).split("/").filter(Boolean);
        let node = tree;
        for (const part of parts) {
            if (!node || node.type !== "dir" || !node.children[part]) return null;
            node = node.children[part];
        }
        return node;
    }

    /** Resolve the parent directory + leaf name for an absolute path. */
    function parentOf(path) {
        const parts = String(path).split("/").filter(Boolean);
        const name = parts.pop();
        const parentPath = "/" + parts.join("/");
        return { parent: nodeAt(parentPath), name, parentPath };
    }

    function normalize(path) {
        return resolve("/", path);
    }

    // ----- Query API ---------------------------------------------------------

    function get(path) {
        return nodeAt(normalize(path));
    }

    function exists(path) {
        return Boolean(get(path));
    }

    function isDir(path) {
        const node = get(path);
        return Boolean(node && node.type === "dir");
    }

    function stat(path) {
        const node = get(path);
        if (!node) return null;
        const { type, name, createdAt, modifiedAt, owner, source, tags, flags } = node;
        return { type, name, path: normalize(path), createdAt, modifiedAt, owner, source, tags, flags };
    }

    /** List a directory. Returns [{ name, type, path, node }], dirs first. */
    function list(path) {
        const node = get(path);
        if (!node || node.type !== "dir") return [];
        const base = normalize(path);
        const prefix = base === "/" ? "" : base;
        return Object.values(node.children)
            .map((child) => ({
                name: child.name,
                type: child.type,
                path: `${prefix}/${child.name}`,
                node: child
            }))
            .sort((a, b) => {
                if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
    }

    /** Read a file's content. Returns { ok, content } or { ok:false, error }. */
    function read(path) {
        const target = normalize(path);
        const node = nodeAt(target);
        if (!node) return fail("read", `No such file '${path}'`);
        if (node.type === "dir") return fail("read", `'${path}' is a directory`);
        return { ok: true, content: node.content, node };
    }

    // ----- Mutation API ------------------------------------------------------

    function mkdir(path, options = {}) {
        const target = normalize(path);
        const { parent, name, parentPath } = parentOf(target);

        if (!name || name === "." || name === "..") {
            return fail("mkdir", `invalid path '${path}'`);
        }

        if (!parent) {
            if (options.recursive) {
                const parentResult = mkdir(parentPath, options);
                if (!parentResult.ok) return parentResult;
                return mkdir(target, options);
            }
            return fail("mkdir", `cannot create '${path}': parent directory does not exist`);
        }

        if (parent.type !== "dir") {
            return fail("mkdir", `'${parentPath}' is not a directory`);
        }

        const existing = parent.children[name];
        if (existing) {
            if (existing.type === "dir") return { ok: true, path: target, node: existing };
            return fail("mkdir", `cannot create directory '${path}': File exists`);
        }

        const node = makeDir(name, options.owner, options.source || "mkdir");
        parent.children[name] = node;
        parent.modifiedAt = now();
        debugLog("fs mkdir", target);
        emit("fs:node-created", { path: target, parentPath, node });
        return { ok: true, path: target, node };
    }

    function touch(path, options = {}) {
        const target = normalize(path);
        const { parent, name, parentPath } = parentOf(target);

        if (!name || name === "." || name === "..") {
            return fail("touch", `invalid path '${path}'`);
        }
        if (!parent || parent.type !== "dir") {
            return fail("touch", `cannot create '${path}': parent directory does not exist`);
        }

        const existing = parent.children[name];
        if (existing) {
            if (existing.type === "file") return { ok: true, path: target, node: existing };
            return fail("touch", `cannot create '${path}': Is a directory`);
        }

        const node = makeFile(name, "", options.owner, options.source || "touch");
        parent.children[name] = node;
        parent.modifiedAt = now();
        debugLog("fs touch", target);
        emit("fs:node-created", { path: target, parentPath, node });
        return { ok: true, path: target, node };
    }

    /** Write file content. Creates the file when options.create is set. */
    function write(path, content, options = {}) {
        const target = normalize(path);
        let node = nodeAt(target);

        if (!node) {
            if (!options.create) return fail("write", `No such file '${path}'`);
            const created = touch(target, options);
            if (!created.ok) return created;
            node = created.node;
        }

        if (node.type === "dir") {
            return fail("write", `'${path}' is a directory`);
        }

        const text = content == null ? "" : String(content);
        node.content = text;
        node.size = text.length;
        node.mime = inferMime(node.name);
        node.modifiedAt = now();
        if (options.owner) node.owner = options.owner;
        if (options.source) node.source = options.source;

        const { parentPath } = parentOf(target);
        debugLog("fs write", target, `(${text.length} chars)`);
        emit("fs:node-updated", { path: target, parentPath, node });
        return { ok: true, path: target, node };
    }

    function remove(path, options = {}) {
        const target = normalize(path);
        const { parent, name, parentPath } = parentOf(target);
        const node = parent && parent.children ? parent.children[name] : null;

        if (!node) return fail("remove", `No such file or directory '${path}'`);
        if (node.flags && (node.flags.readonly || node.flags.system || node.flags.locked)) {
            return fail("remove", `'${path}' is protected`);
        }
        if (node.type === "dir" && Object.keys(node.children).length && !options.recursive) {
            return fail("remove", `directory '${path}' is not empty`);
        }

        delete parent.children[name];
        parent.modifiedAt = now();
        debugLog("fs remove", target);
        emit("fs:node-deleted", { path: target, parentPath, node });
        return { ok: true, path: target };
    }

    return {
        // metadata
        username: user,
        homePath,
        desktopPath,
        // path engine
        resolve,
        normalize,
        parentOf,
        // query
        get,
        exists,
        isDir,
        stat,
        list,
        read,
        // mutation
        mkdir,
        touch,
        write,
        remove
    };
}
