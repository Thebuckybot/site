/**
 * bucky.files — VM filesystem API for scripts (Phase 4.4, Part 9).
 *
 * A thin, script-friendly facade over the shared FileSystemService. Relative
 * paths resolve against the script's working directory (the directory the
 * script lives in, or the terminal cwd). Every call asserts the `filesystem`
 * capability, then routes through the same FileSystemService the terminal,
 * Files app and BuckyCode use — so files a script creates appear live in the
 * desktop, and the EventBus fs:* events fire exactly as for a manual edit.
 * Nothing here touches the host filesystem.
 *
 *   read(path) write(path, text) append(path, text) delete(path)
 *   list([path]) exists(path) isdir(path) mkdir(path) copy(src, dst)
 *   move(src, dst)
 *
 * write() / append() / mkdir() auto-create any missing parent directories, so
 * writing a report into a fresh /projects/reports/<sub> path "just works".
 */
import { mod, def, raise } from "./kit.js";

export function createFilesModule(ctx) {
    const fs = ctx.filesystem;
    const owner = ctx.owner || "script";
    const resolve = (p) => fs.resolve(ctx.cwd || fs.homePath, p == null ? "." : String(p));

    // Create the parent directory tree for `target` if it does not exist.
    function ensureParent(target) {
        const info = fs.parentOf(target);
        if (info.parentPath && info.parentPath !== "/" && !fs.exists(info.parentPath)) {
            fs.mkdir(info.parentPath, { owner, source: "script", recursive: true });
        }
    }

    function read(path) {
        ctx.caps.require("filesystem", "files.read");
        const r = fs.read(resolve(path));
        if (!r.ok) raise("FileError", `cannot read '${path}': ${r.error}`, String(path));
        return r.content;
    }

    function write(path, text) {
        ctx.caps.require("filesystem", "files.write");
        const target = resolve(path);
        ensureParent(target);
        const r = fs.write(target, text == null ? "" : String(text), { owner, source: "script", create: true });
        if (!r.ok) raise("FileError", `cannot write '${path}': ${r.error}`, String(path));
        return true;
    }

    function append(path, text) {
        ctx.caps.require("filesystem", "files.append");
        const existing = fs.read(resolve(path));
        const base = existing.ok ? existing.content : "";
        return write(path, base + (text == null ? "" : String(text)));
    }

    function remove(path) {
        ctx.caps.require("filesystem", "files.delete");
        const r = fs.remove(resolve(path), { recursive: true });
        if (!r.ok) raise("FileError", `cannot delete '${path}': ${r.error}`, String(path));
        return true;
    }

    function list(path) {
        ctx.caps.require("filesystem", "files.list");
        const target = resolve(path == null ? "." : path);
        const node = fs.get(target);
        if (!node) raise("FileError", `no such directory '${path}'`, String(path));
        if (node.type !== "dir") raise("FileError", `'${path}' is not a directory`, String(path));
        return fs.list(target).map((entry) => entry.name);
    }

    function exists(path) {
        ctx.caps.require("filesystem", "files.exists");
        return fs.exists(resolve(path));
    }

    function isdir(path) {
        ctx.caps.require("filesystem", "files.isdir");
        return fs.isDir(resolve(path));
    }

    function mkdir(path) {
        ctx.caps.require("filesystem", "files.mkdir");
        const r = fs.mkdir(resolve(path), { owner, source: "script", recursive: true });
        if (!r.ok) raise("FileError", `cannot create '${path}': ${r.error}`, String(path));
        return true;
    }

    function copy(src, dst) {
        ctx.caps.require("filesystem", "files.copy");
        const r = fs.read(resolve(src));
        if (!r.ok) raise("FileError", `cannot read '${src}': ${r.error}`, String(src));
        return write(dst, r.content);
    }

    function move(src, dst) {
        ctx.caps.require("filesystem", "files.move");
        copy(src, dst);
        const r = fs.remove(resolve(src), { recursive: false });
        if (!r.ok) raise("FileError", `cannot move '${src}': ${r.error}`, String(src));
        return true;
    }

    return mod("bucky.files", {
        read: def(read),
        write: def(write),
        append: def(append),
        delete: def(remove),
        remove: def(remove),
        list: def(list),
        listdir: def(list),
        exists: def(exists),
        isdir: def(isdir),
        mkdir: def(mkdir),
        copy: def(copy),
        move: def(move)
    });
}
