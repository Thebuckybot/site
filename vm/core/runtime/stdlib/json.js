/**
 * json — first-class JSON helpers for automation (Phase 4.4, Part 11).
 *
 * Critical for the watchlist / tracker / report workflows: scripts persist and
 * reload structured state in /projects/data as JSON. Because the interpreter
 * represents Python dicts as plain objects and lists as arrays, host
 * JSON.parse / JSON.stringify interoperate directly with script values.
 *
 *   parse(text)            -> value          stringify(value[, indent]) -> text
 *   load(path)             -> value          save(path, value[, indent]) -> True
 *
 * parse / stringify are pure; load / save assert the `filesystem` capability,
 * route through the shared FileSystemService, and save() auto-creates any
 * missing parent directories.
 */
import { mod, def, raise } from "./kit.js";

export function createJsonModule(ctx) {
    const fs = ctx.filesystem;
    const owner = ctx.owner || "script";
    const resolve = (p) => fs.resolve(ctx.cwd || fs.homePath, String(p));

    function parse(text) {
        try {
            return JSON.parse(text == null ? "null" : String(text));
        } catch (e) {
            raise("ValueError", `invalid JSON: ${e.message}`);
        }
    }

    function stringify(value, indent) {
        try {
            return JSON.stringify(value, null, indent || 0);
        } catch (e) {
            raise("ValueError", `cannot serialise value to JSON: ${e.message}`);
        }
    }

    function load(path) {
        ctx.caps.require("filesystem", "json.load");
        const r = fs.read(resolve(path));
        if (!r.ok) raise("FileError", `cannot read '${path}': ${r.error}`, String(path));
        return parse(r.content || "null");
    }

    function save(path, value, indent) {
        ctx.caps.require("filesystem", "json.save");
        const text = stringify(value, indent == null ? 2 : indent);
        const target = resolve(path);
        const info = fs.parentOf(target);
        if (info.parentPath && info.parentPath !== "/" && !fs.exists(info.parentPath)) {
            fs.mkdir(info.parentPath, { owner, source: "script", recursive: true });
        }
        const r = fs.write(target, text, { owner, source: "script", create: true });
        if (!r.ok) raise("FileError", `cannot write '${path}': ${r.error}`, String(path));
        return true;
    }

    return mod("json", {
        parse: def(parse),
        loads: def(parse),
        stringify: def(stringify),
        dumps: def(stringify),
        load: def(load),
        save: def(save)
    });
}
