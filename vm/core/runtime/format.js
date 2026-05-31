/**
 * Runtime presentation helpers — Phase 4.4, Parts 18 & 19.
 *
 * Pure string formatting for the terminal scrollback and BuckyCode output
 * panel. Returns plain string arrays (one entry per line) so callers stay in
 * control of how lines are themed/emitted; this module owns NO DOM.
 *
 *   RUNNING / COMPLETE banners give an interactive session a professional,
 *   consistent frame. The structured ERROR block replaces a raw interpreter
 *   trace with an operator-readable report (File / Line / Problem / Name).
 */

const RULE = "=================================";

/** The opening banner emitted before a script's output. */
export function runBanner(name) {
    return [RULE, `RUNNING ${name}`, RULE];
}

/** The closing banner. `ms` (optional) appends the runtime duration. */
export function completeBanner(ms) {
    const tail = typeof ms === "number" ? ` (${formatDuration(ms)})` : "";
    return [RULE, `COMPLETE${tail}`, RULE];
}

/** A simple full-width rule, e.g. for in-script section separators. */
export function rule() {
    return RULE;
}

/**
 * Render a structured error block from interpreter errorInfo.
 * @param {string} file        the script filename (e.g. "scanner.py")
 * @param {object} errorInfo   { type, line, problem, name }
 * @returns {string[]}
 */
export function errorBlock(file, errorInfo) {
    const info = errorInfo || {};
    const lines = [RULE, "ERROR"];
    lines.push(`File: ${file || "(script)"}`);
    if (info.line) lines.push(`Line: ${info.line}`);
    lines.push(`Problem: ${problemFor(info)}`);
    if (info.name) lines.push(`Name: ${info.name}`);
    if (info.type) lines.push(`Type: ${info.type}`);
    lines.push(RULE);
    return lines;
}

/** Map an error type to a short, human "Problem:" headline. */
function problemFor(info) {
    const byType = {
        NameError: "Variable not defined",
        SyntaxError: "Could not parse the script",
        TypeError: "Value used in the wrong way",
        IndexError: "Index is out of range",
        KeyError: "Key not found",
        AttributeError: "No such attribute or method",
        ImportError: "Module could not be imported",
        ZeroDivisionError: "Division by zero",
        ValueError: "Invalid value",
        RecursionError: "Too much recursion",
        CapabilityError: "Permission not granted",
        NotImplementedError: "Not available yet",
        RuntimeError: "Runtime limit or fault"
    };
    const head = byType[info.type];
    // Keep the precise interpreter message as the detail when we have a headline.
    if (head && info.problem && head.toLowerCase() !== String(info.problem).toLowerCase()) {
        return `${head} — ${info.problem}`;
    }
    return info.problem || head || "Unknown problem";
}

/** Humanise a millisecond duration. */
export function formatDuration(ms) {
    if (ms < 1) return "<1ms";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}
