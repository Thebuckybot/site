/**
 * PseudoPythonRuntime — a safe, simulated Python execution layer.
 *
 * This is NOT real Python. It does not use eval, Function, exec, subprocess,
 * imports, the real filesystem, or the network. It interprets a deliberately
 * tiny subset of Python so Bucky VM mission scripts can "run" entirely inside
 * the sandbox:
 *
 *   - print(...)            one or more comma-separated arguments
 *   - # comments            whole-line and trailing
 *   - variables             name = value
 *   - simple expressions    string / number / boolean / None literals,
 *                           variable references, and the + operator
 *                           (numeric add, otherwise string concatenation)
 *
 * Anything outside that subset yields a safe, displayed error string — never
 * a thrown exception that escapes the runtime, and never host-code execution.
 * The interpreter has no loops or recursion, so a script always terminates;
 * output is additionally capped as defence in depth.
 *
 * This module is the foundation future systems (mission scripts, fake attack
 * tools, scanners) execute through — see core/execution.js.
 */

const MAX_OUTPUT_LINES = 500;

/** Split text on a separator char that appears at the top level only. */
function splitTopLevel(text, separator) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let buffer = "";
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            buffer += ch;
            if (ch === quote && text[i - 1] !== "\\") quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            buffer += ch;
            continue;
        }
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        if (ch === separator && depth === 0) {
            parts.push(buffer);
            buffer = "";
            continue;
        }
        buffer += ch;
    }
    parts.push(buffer);
    return parts;
}

/** Strip a trailing `# comment` that is not inside a string literal. */
function stripComment(line) {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === quote && line[i - 1] !== "\\") quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === "#") return line.slice(0, i);
    }
    return line;
}

/** Decode the escape sequences inside a string literal's body. */
function decodeString(literal) {
    const quote = literal[0];
    const body = literal.slice(1, -1);
    return body.replace(/\\(.)/g, (_match, ch) => {
        if (ch === "n") return "\n";
        if (ch === "t") return "\t";
        if (ch === "r") return "\r";
        if (ch === "0") return "\0";
        if (ch === "\\") return "\\";
        if (ch === quote) return quote;
        return ch;
    });
}

/** Render a runtime value the way Python's print would. */
function pyStr(value) {
    if (value === true) return "True";
    if (value === false) return "False";
    if (value === null) return "None";
    return String(value);
}

/** Evaluate a single operand (no operators). Returns { ok, value } | { ok:false, error }. */
function evalOperand(token, vars) {
    const tok = token.trim();
    if (!tok) return { ok: false, error: "SyntaxError: empty expression" };

    const isDouble = tok[0] === '"' && tok.length >= 2 && tok[tok.length - 1] === '"';
    const isSingle = tok[0] === "'" && tok.length >= 2 && tok[tok.length - 1] === "'";
    if (isDouble || isSingle) {
        // Reject a stray inner unescaped quote (e.g. two adjacent literals).
        const inner = tok.slice(1, -1);
        const stray = new RegExp(`(^|[^\\\\])${tok[0]}`).test(inner);
        if (stray) return { ok: false, error: "SyntaxError: invalid string literal" };
        return { ok: true, value: decodeString(tok) };
    }
    if (/^-?\d+(\.\d+)?$/.test(tok)) {
        return { ok: true, value: Number(tok) };
    }
    if (/^[A-Za-z_]\w*$/.test(tok)) {
        if (tok === "True") return { ok: true, value: true };
        if (tok === "False") return { ok: true, value: false };
        if (tok === "None") return { ok: true, value: null };
        if (Object.prototype.hasOwnProperty.call(vars, tok)) {
            return { ok: true, value: vars[tok] };
        }
        return { ok: false, error: `NameError: name '${tok}' is not defined` };
    }
    return { ok: false, error: `SyntaxError: cannot evaluate '${tok}'` };
}

/** Evaluate an expression: operands joined by the + operator. */
function evalExpr(expr, vars) {
    const terms = splitTopLevel(expr, "+");
    if (terms.length === 1) {
        return evalOperand(terms[0], vars);
    }
    let acc = null;
    let started = false;
    for (const term of terms) {
        const result = evalOperand(term, vars);
        if (!result.ok) return result;
        if (!started) {
            acc = result.value;
            started = true;
        } else if (typeof acc === "number" && typeof result.value === "number") {
            acc += result.value;
        } else {
            acc = pyStr(acc) + pyStr(result.value);
        }
    }
    return { ok: true, value: acc };
}

/**
 * Run a pseudo-Python source string.
 * @param {string} source
 * @returns {{ ok: boolean, output: string[], error: (string|null) }}
 */
export function runPython(source) {
    const output = [];
    const vars = Object.create(null);
    const lines = String(source == null ? "" : source).replace(/\r\n/g, "\n").split("\n");

    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        const line = stripComment(lines[i]).trim();
        if (!line) continue;

        if (output.length >= MAX_OUTPUT_LINES) {
            return { ok: false, output, error: "RuntimeError: output limit reached" };
        }

        const printMatch = line.match(/^print\s*\((.*)\)\s*$/);
        if (printMatch) {
            const argString = printMatch[1].trim();
            if (argString === "") {
                output.push("");
                continue;
            }
            const rendered = [];
            for (const arg of splitTopLevel(argString, ",")) {
                const result = evalExpr(arg, vars);
                if (!result.ok) {
                    return { ok: false, output, error: `Line ${lineNo}: ${result.error}` };
                }
                rendered.push(pyStr(result.value));
            }
            output.push(rendered.join(" "));
            continue;
        }

        // Assignment: name = expression. A comparison such as `x == 5` also
        // matches here (rhs becomes "= 5"), and then fails evaluation with a
        // safe SyntaxError — comparisons are intentionally unsupported.
        const assignMatch = line.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
        if (assignMatch) {
            const result = evalExpr(assignMatch[2], vars);
            if (!result.ok) {
                return { ok: false, output, error: `Line ${lineNo}: ${result.error}` };
            }
            vars[assignMatch[1]] = result.value;
            continue;
        }

        return {
            ok: false,
            output,
            error: `Line ${lineNo}: SyntaxError: unsupported statement (the VM runs a simplified Python subset)`
        };
    }

    return { ok: true, output, error: null };
}
