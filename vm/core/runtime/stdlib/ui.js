/**
 * bucky UI toolkit — runtime widgets for scripts (Phase 4.5, §2, §4–7, §21, §26).
 *
 * Reusable, presentation-only widgets that render through the interpreter's
 * output stream (the same channel as print()), so they appear live in the
 * Terminal scrollback and the BuckyCode output panel. Nothing here owns DOM; the
 * terminal/editor styles the resulting lines.
 *
 *   progress  start/update/finish — a [#####-----] bar, also feeds the process
 *             table so `top` shows a script's live progress.
 *   table     render(rows[, columns]) — aligned columns from dicts or lists.
 *   status    card(title, fields) / line(label, value) — bordered status blocks.
 *   notify    notify(text[, level]) — a VM notification (desktop toast when a
 *             sink is attached) + an inline [NOTIFY] line.
 *   form      select(prompt, options) / confirm(prompt) / ask(prompt) — interactive
 *   menu      show(items[, title]) — a numbered menu returning the chosen index
 *
 * `form` and `menu` are INTERACTIVE: they suspend the run for terminal input via
 * the interpreter's `__interactive__` seam (a generalisation of input()), so they
 * only work in the interactive Terminal — in a non-interactive "Run" they raise
 * the same friendly "needs the interactive Terminal" error input() does.
 */
import { mod, def } from "./kit.js";

const RULE = "=================================";
const BAR_WIDTH = 14;

// ----- shared rendering helpers ---------------------------------------------

function renderBar(percent) {
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    const filled = Math.round((pct / 100) * BAR_WIDTH);
    return "[" + "#".repeat(filled) + "-".repeat(Math.max(0, BAR_WIDTH - filled)) + "] " + pct + "%";
}

function isPlainDict(v) {
    return v && typeof v === "object" && !Array.isArray(v);
}

function cellOf(row, col, i) {
    if (Array.isArray(row)) return row[i] == null ? "" : row[i];
    if (isPlainDict(row)) return row[col] == null ? "" : row[col];
    return row == null ? "" : row;
}

/** Build the aligned text rows for a table. Returns string[]. */
function tableLines(rows, columns) {
    const data = Array.isArray(rows) ? rows : [];
    let cols = Array.isArray(columns) && columns.length ? columns.slice() : null;
    if (!cols && data.length && isPlainDict(data[0])) cols = Object.keys(data[0]);

    if (cols) {
        const headers = cols.map((c) => String(c).toUpperCase());
        const widths = cols.map((c, i) => {
            let w = headers[i].length;
            data.forEach((r) => { w = Math.max(w, String(cellOf(r, c, i)).length); });
            return w;
        });
        const fmt = (cells) => cells.map((s, i) => String(s).padEnd(widths[i])).join("  ").replace(/\s+$/, "");
        const out = [fmt(headers)];
        data.forEach((r) => out.push(fmt(cols.map((c, i) => cellOf(r, c, i)))));
        return out;
    }
    // No column model: list of lists / scalars.
    return data.map((r) => (Array.isArray(r) ? r.map((x) => (x == null ? "" : String(x))).join("  ") : String(r == null ? "" : r)));
}

/** Print a numbered option list; returns the inline "Select [1-N]: " prompt. */
function printOptions(interp, options, title) {
    if (title) interp.print(String(title));
    const opts = Array.isArray(options) ? options : [];
    opts.forEach((o, i) => interp.print((i + 1) + ". " + labelOf(o)));
    return opts.length ? "Select [1-" + opts.length + "]: " : "Select: ";
}

function labelOf(o) {
    if (o == null) return "";
    if (typeof o === "string" || typeof o === "number") return String(o);
    if (isPlainDict(o)) return String(o.label || o.name || o.title || o.id || JSON.stringify(o));
    return String(o);
}

// ----- progress (§2) ---------------------------------------------------------

export function createProgressModule(ctx) {
    // Per-run convenience state so progress.update()/finish() work without a
    // handle (one active bar). A handle (returned by start) is also accepted.
    let current = null;

    const syncProcess = (pct, label) => {
        if (ctx.processes && ctx.pid != null) ctx.processes.setProgress(ctx.pid, pct, label);
    };
    const pctFrom = (value, total) => {
        const t = total && total > 0 ? total : 100;
        return t === 100 ? value : (value / t) * 100;
    };

    return mod("bucky.progress", {
        start: (args, kwargs, interp) => {
            const label = args && args[0] != null ? String(args[0]) : "Progress";
            const total = args && typeof args[1] === "number" ? args[1] : 100;
            current = { label, total, value: 0 };
            interp.print(label + ": " + renderBar(0));
            syncProcess(0, label);
            return { __progress__: true, label, total };
        },
        update: (args, kwargs, interp) => {
            // update(value[, label]) or update(handle, value[, label])
            let value, label, handle = current;
            if (args && args[0] && typeof args[0] === "object" && args[0].__progress__) {
                handle = args[0]; value = args[1]; label = args[2];
            } else {
                value = args && args[0]; label = args && args[1];
            }
            const h = handle || current || { label: "Progress", total: 100 };
            const pct = pctFrom(typeof value === "number" ? value : 0, h.total);
            if (label != null) h.label = String(label);
            const text = h.label + ": " + renderBar(pct);
            interp.print(text);
            syncProcess(pct, h.label);
            return text;
        },
        finish: (args, kwargs, interp) => {
            const label = args && args[0] != null ? String(args[0]) : ((current && current.label) || "Progress");
            const text = label + ": " + renderBar(100) + " done";
            interp.print(text);
            syncProcess(100, label);
            current = null;
            return text;
        },
        bar: (args) => renderBar(args && typeof args[0] === "number" ? args[0] : 0)
    });
}

// ----- table (§4) -------------------------------------------------------------

export function createTableModule(ctx) {
    return mod("bucky.table", {
        // render() PRINTS the table to the output stream AND returns the rendered
        // text, so it is useful both for display and for capture/reporting. It
        // always prints — the return is additive, not a mode switch.
        render: (args, kwargs, interp) => {
            const rows = args && args[0];
            const cols = (args && args[1]) || (kwargs && kwargs.columns);
            const lines = tableLines(rows, cols);
            lines.forEach((line) => interp.print(line));
            return lines.join("\n");
        },
        // format() returns the rendered text WITHOUT printing.
        format: (args) => tableLines(args && args[0], args && args[1]).join("\n")
    });
}

// ----- status cards (§21) -----------------------------------------------------

export function createStatusModule(ctx) {
    // Render one field value readably: booleans Python-style, nested dicts/lists
    // flattened, None as "-". Keeps card content meaningful (never blank).
    const renderValue = (v) => {
        if (v === true) return "True";
        if (v === false) return "False";
        if (v == null) return "-";
        if (Array.isArray(v)) return v.map(renderValue).join(", ");
        if (isPlainDict(v)) return Object.keys(v).map((k) => k + "=" + renderValue(v[k])).join("  ");
        return String(v);
    };
    return mod("bucky.status", {
        // card(title, fields) — fields may be a dict (positional) or kwargs.
        // Prints a bordered block AND returns the rendered text.
        card: (args, kwargs, interp) => {
            const title = args && args[0] != null ? String(args[0]) : "STATUS";
            const fields = (args && args[1] != null && isPlainDict(args[1])) ? args[1]
                : (isPlainDict(kwargs) && Object.keys(kwargs).length ? kwargs : {});
            const out = [RULE, " " + title, RULE];
            const keys = Object.keys(fields);
            if (keys.length) {
                const w = keys.reduce((m, k) => Math.max(m, k.length), 0);
                keys.forEach((k) => out.push(" " + k.padEnd(w) + "  " + renderValue(fields[k])));
            } else {
                out.push(" (no fields)");
            }
            out.push(RULE);
            out.forEach((l) => interp.print(l));
            return out.join("\n");
        },
        line: (args, kwargs, interp) => {
            const label = args && args[0] != null ? String(args[0]) : "";
            const value = args && args[1] != null ? renderValue(args[1]) : "";
            const text = label + ": " + value;
            interp.print(text);
            return text;
        }
    });
}

// ----- notify (§7) ------------------------------------------------------------

export function createNotifyModule(ctx) {
    const send = (args, kwargs, interp) => {
        const text = args && args[0] != null ? String(args[0]) : "";
        const level = args && args[1] != null ? String(args[1]) : "info";
        // Post to the desktop NotificationService when the terminal attached a
        // sink; always echo an inline line so it is visible headlessly too.
        if (typeof ctx.notify === "function") {
            try { ctx.notify(text, level); } catch (_e) { /* never break a run */ }
        }
        interp.print("[NOTIFY] " + text);
        return text;
    };
    return mod("bucky.notify", {
        send,
        info: (args, kwargs, interp) => send([args && args[0], "info"], kwargs, interp),
        warn: (args, kwargs, interp) => send([args && args[0], "warn"], kwargs, interp),
        alert: (args, kwargs, interp) => send([args && args[0], "alert"], kwargs, interp)
    });
}

// ----- form (§5, interactive) -------------------------------------------------

export function createFormModule(ctx) {
    const select = {
        __interactive__: true,
        pyName: "form.select",
        prompt: (args, interp) => printOptions(interp, args && args[1], args && args[0]),
        resume: (line, args) => {
            const options = Array.isArray(args && args[1]) ? args[1] : [];
            const n = parseInt(line, 10);
            if (!Number.isNaN(n) && n >= 1 && n <= options.length) return options[n - 1];
            // Allow choosing by label text too.
            const match = options.find((o) => labelOf(o).toLowerCase() === String(line).toLowerCase());
            return match !== undefined ? match : null;
        }
    };
    const confirm = {
        __interactive__: true,
        pyName: "form.confirm",
        prompt: (args) => (args && args[0] != null ? String(args[0]) : "Confirm?") + " [y/n]: ",
        resume: (line) => /^\s*(y|yes|1|true)\s*$/i.test(String(line))
    };
    const ask = {
        __interactive__: true,
        pyName: "form.ask",
        prompt: (args) => (args && args[0] != null ? String(args[0]) + " " : ""),
        resume: (line) => String(line == null ? "" : line)
    };
    // `input` is an alias of `ask` — free-text prompt that returns the line.
    return mod("bucky.form", { select, confirm, ask, input: ask });
}

// ----- menu (§6, interactive) -------------------------------------------------

export function createMenuModule(ctx) {
    const show = {
        __interactive__: true,
        pyName: "menu.show",
        prompt: (args, interp) => printOptions(interp, args && args[0], args && args[1]),
        resume: (line, args) => {
            const items = Array.isArray(args && args[0]) ? args[0] : [];
            const n = parseInt(line, 10);
            let idx = -1;
            if (!Number.isNaN(n) && n >= 1 && n <= items.length) idx = n - 1;
            else { const m = items.findIndex((o) => labelOf(o).toLowerCase() === String(line).toLowerCase()); if (m >= 0) idx = m; }
            // Meaningful selection: { index (1-based), label, value }, or None.
            if (idx < 0) return null;
            return { index: idx + 1, label: labelOf(items[idx]), value: items[idx] };
        }
    };
    return mod("bucky.menu", { show });
}

// ----- umbrella (§26) ---------------------------------------------------------

/** `bucky.ui` — one namespace bundling the whole toolkit. */
export function createUiModule(ctx, parts) {
    return mod("bucky.ui", {
        progress: parts.progress,
        table: parts.table,
        status: parts.status,
        notify: parts.notify.send,
        form: parts.form,
        menu: parts.menu
    });
}

export { renderBar, tableLines };
