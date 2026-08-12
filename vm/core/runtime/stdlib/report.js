/**
 * bucky.report — report builders + the export engine (Phase 4.5, §17 & §18).
 *
 * Turns script results into shareable artifacts. The builders are pure string
 * formatters (text / table / json); the export helpers persist content into the
 * three conventional workspace folders the VM seeds — /projects/reports,
 * /projects/exports, /projects/archives — through the shared FileSystemService,
 * so a generated report appears live in the Files app.
 *
 *   text(title, body)            a titled, ruled text block (string)
 *   table(title, rows[, cols])   a titled aligned table (string)
 *   json(obj)                    pretty-printed JSON (string)
 *   save(path, content)          write content to any VFS path → returns path
 *   to_reports(name, content)    write into /projects/reports/<name>
 *   to_exports(name, content)    write into /projects/exports/<name>
 *   to_archives(name, content)   write into /projects/archives/<name>
 *
 * Saving asserts both `report` and `filesystem` capabilities (it writes a file).
 */
import { mod, def, raise } from "./kit.js";
import { tableLines } from "./ui.js";

const RULE = "=================================";

export function createReportModule(ctx) {
    const fs = ctx.filesystem;

    function ensureParent(path) {
        const info = fs.parentOf(path);
        if (info.parentPath && info.parentPath !== "/" && !fs.exists(info.parentPath)) {
            fs.mkdir(info.parentPath, { owner: ctx.owner || "script", source: "report", recursive: true });
        }
    }
    function writeFile(path, content) {
        ctx.caps.require("report", "report.save");
        ctx.caps.require("filesystem", "report.save");
        ensureParent(path);
        const w = fs.write(path, content == null ? "" : String(content), { owner: ctx.owner || "script", source: "report", create: true });
        if (!w.ok) raise("FileError", `cannot write '${path}': ${w.error}`, String(path));
        return path;
    }

    function text(title, body) {
        ctx.caps.require("report", "report.text");
        const t = title == null ? "" : String(title);
        const b = body == null ? "" : String(body);
        return [RULE, " " + t, RULE, b].join("\n");
    }
    function table(title, rows, columns) {
        ctx.caps.require("report", "report.table");
        const head = title == null ? [] : [RULE, " " + String(title), RULE];
        return head.concat(tableLines(rows, columns)).join("\n");
    }
    function json(obj) {
        ctx.caps.require("report", "report.json");
        try { return JSON.stringify(obj == null ? null : obj, null, 2); }
        catch (_e) { return "null"; }
    }
    function save(path, content) { return writeFile(String(path), content); }
    function to_reports(name, content) { return writeFile("/projects/reports/" + String(name), content); }
    function to_exports(name, content) { return writeFile("/projects/exports/" + String(name), content); }
    function to_archives(name, content) { return writeFile("/projects/archives/" + String(name), content); }

    return mod("bucky.report", {
        text: def(text),
        create: def(text), // alias - build a titled text report block
        table: def(table),
        json: def(json),
        save: def(save),
        to_reports: def(to_reports),
        to_exports: def(to_exports),
        to_archives: def(to_archives)
    });
}
