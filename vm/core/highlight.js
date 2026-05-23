/**
 * Syntax highlighter — lightweight, dependency-free token highlighting.
 *
 * Vanilla JavaScript only; no Monaco, no CodeMirror, no editor framework. It
 * turns a source string into a safe HTML string of <span class="tok-*"> runs
 * for BuckyCode's edit overlay.
 *
 * Safety: every slice of source is HTML-escaped before any span is wrapped
 * around it, so source text can never inject markup — the only tags emitted
 * are this module's own fixed <span> set.
 *
 * Languages: python, json, javascript, markdown, log. Unknown types fall back
 * to plain escaped text. Regex tokenizing is intentionally approximate — it
 * is a readability aid, not a parser, and stays O(n) over the source.
 */
import { escapeHtml } from "./util.js";

const PY_KEYWORDS = new Set([
    "def", "class", "return", "if", "elif", "else", "for", "while", "import",
    "from", "as", "in", "is", "not", "and", "or", "pass", "break", "continue",
    "with", "try", "except", "finally", "raise", "lambda", "global", "nonlocal",
    "yield", "assert", "del", "async", "await"
]);
const PY_CONSTANTS = new Set(["True", "False", "None"]);
const PY_BUILTINS = new Set([
    "print", "len", "range", "str", "int", "float", "bool", "list", "dict",
    "set", "tuple", "input", "open", "type", "abs", "min", "max", "sum",
    "sorted", "enumerate", "zip", "map", "filter", "round"
]);
const JS_KEYWORDS = new Set([
    "const", "let", "var", "function", "return", "if", "else", "for", "while",
    "class", "new", "import", "export", "default", "from", "this", "typeof",
    "instanceof", "in", "of", "do", "switch", "case", "break", "continue",
    "try", "catch", "finally", "throw", "async", "await", "yield", "delete", "void"
]);
const JS_CONSTANTS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

const PY_RE = /(?<comment>#[^\n]*)|(?<string>"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(?<number>\b\d[\d_]*\.?\d*\b)|(?<word>[A-Za-z_]\w*)/g;
const JS_RE = /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(?<number>\b\d[\d_.]*\b)|(?<word>[A-Za-z_$][\w$]*)/g;
const JSON_RE = /(?<string>"(?:[^"\\]|\\.)*")|(?<number>-?\b\d[\d.eE+-]*\b)|(?<literal>\b(?:true|false|null)\b)|(?<punct>[{}\[\],:])/g;

/** Walk regex matches, escaping gaps and wrapping classified tokens. */
function scan(code, regex, classify) {
    let out = "";
    let last = 0;
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(code)) !== null) {
        if (match.index > last) out += escapeHtml(code.slice(last, match.index));
        const cls = classify(match, code);
        const text = escapeHtml(match[0]);
        out += cls ? `<span class="${cls}">${text}</span>` : text;
        last = match.index + match[0].length;
        if (match[0].length === 0) regex.lastIndex++;
    }
    out += escapeHtml(code.slice(last));
    return out;
}

function classifyPython(match, code) {
    const g = match.groups;
    if (g.comment) return "tok-comment";
    if (g.string) return "tok-string";
    if (g.number) return "tok-number";
    if (g.word) {
        if (code[match.index + match[0].length] === "(") return "tok-fn";
        if (PY_KEYWORDS.has(g.word)) return "tok-keyword";
        if (PY_CONSTANTS.has(g.word)) return "tok-const";
        if (PY_BUILTINS.has(g.word)) return "tok-builtin";
    }
    return "";
}

function classifyJs(match, code) {
    const g = match.groups;
    if (g.comment) return "tok-comment";
    if (g.string) return "tok-string";
    if (g.number) return "tok-number";
    if (g.word) {
        if (JS_KEYWORDS.has(g.word)) return "tok-keyword";
        if (JS_CONSTANTS.has(g.word)) return "tok-const";
        if (code[match.index + match[0].length] === "(") return "tok-fn";
    }
    return "";
}

function classifyJson(match, code) {
    const g = match.groups;
    if (g.string) {
        let i = match.index + match[0].length;
        while (i < code.length && /\s/.test(code[i])) i++;
        return code[i] === ":" ? "tok-key" : "tok-string";
    }
    if (g.number) return "tok-number";
    if (g.literal) return "tok-const";
    if (g.punct) return "tok-punct";
    return "";
}

/** Markdown source highlighting — line oriented, escape-first. */
function highlightMarkdown(code) {
    return code.split("\n").map((line) => {
        if (/^\s*#{1,6}\s/.test(line)) {
            return `<span class="tok-md-heading">${escapeHtml(line)}</span>`;
        }
        if (/^\s*>/.test(line)) {
            return `<span class="tok-md-quote">${escapeHtml(line)}</span>`;
        }
        if (/^\s*```/.test(line)) {
            return `<span class="tok-md-fence">${escapeHtml(line)}</span>`;
        }
        let out = escapeHtml(line);
        out = out.replace(/^(\s*)([-*+]|\d+\.)(\s)/, '$1<span class="tok-md-marker">$2</span>$3');
        out = out.replace(/`[^`]+`/g, (m) => `<span class="tok-md-code">${m}</span>`);
        out = out.replace(/\*\*[^*]+\*\*/g, (m) => `<span class="tok-md-strong">${m}</span>`);
        out = out.replace(/\[[^\]]+\]\([^)\s]+\)/g, (m) => `<span class="tok-md-link">${m}</span>`);
        return out;
    }).join("\n");
}

/** Log highlighting — severity words and timestamps. */
function highlightLog(code) {
    let out = escapeHtml(code);
    out = out.replace(/\b(ERROR|FAILED|FAILURE|FAIL|CRITICAL|FATAL)\b/g, '<span class="tok-log-error">$1</span>');
    out = out.replace(/\b(WARNING|WARN)\b/g, '<span class="tok-log-warn">$1</span>');
    out = out.replace(/\b(INFO|SUCCESS|PASSED|PASS|DEBUG|OK)\b/g, '<span class="tok-log-info">$1</span>');
    out = out.replace(/\b(\d{1,4}[-/]\d{2}[-/]\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?|\d{2}:\d{2}:\d{2})\b/g,
        '<span class="tok-log-time">$1</span>');
    return out;
}

/** Map a filename to a highlighter language id. */
export function languageForName(name) {
    const extension = String(name || "").split(".").pop().toLowerCase();
    if (extension === "py") return "python";
    if (extension === "json") return "json";
    if (extension === "js" || extension === "mjs") return "javascript";
    if (extension === "md" || extension === "markdown") return "markdown";
    if (extension === "log") return "log";
    return "plain";
}

/**
 * Highlight a source string. Returns a safe HTML string; newlines preserved
 * so it can back a <pre> overlay aligned to a <textarea>.
 * @param {string} code
 * @param {string} lang  one of: python json javascript markdown log plain
 */
export function highlight(code, lang) {
    const src = String(code == null ? "" : code);
    switch (lang) {
        case "python": return scan(src, PY_RE, classifyPython);
        case "javascript": return scan(src, JS_RE, classifyJs);
        case "json": return scan(src, JSON_RE, classifyJson);
        case "markdown": return highlightMarkdown(src);
        case "log": return highlightLog(src);
        default: return escapeHtml(src);
    }
}
