/**
 * PseudoPythonRuntime — a safe, simulated Python execution layer.
 *
 * This is NOT real Python. It does not use eval, Function, exec, subprocess,
 * the real filesystem, or the network. It is a hand-written tokenizer +
 * indentation parser + tree-walking evaluator that interprets a deliberately
 * bounded subset of Python so Bucky VM operator scripts can "run" entirely
 * inside the sandbox.
 *
 * Phase 4.4 (BuckyCode Operating Environment) grew this module — in place —
 * from a line-based print/assignment toy into a real programmable runtime:
 *
 *   - literals          str / f-string / int / float / bool / None,
 *                       list [...] and dict {...} displays
 *   - variables         name = value, augmented (+= -= *= /= //= %=),
 *                       tuple unpack (a, b = ...)
 *   - operators         + - * / // % **, comparisons (== != < <= > >=,
 *                       in / not in / is / is not), and / or / not, unary -
 *   - control flow      if / elif / else, for ... in ..., while,
 *                       break / continue / pass
 *   - functions         def with params + defaults, return, lexical closures
 *   - data access       attribute (a.b), subscript (a[b]), method calls
 *   - imports           import x[.y] [as z], from x import a, b  /  *
 *   - builtins          print, len, range, str, int, float, bool, sorted,
 *                       sum, min, max, abs, round, enumerate, list, dict,
 *                       sum, type, repr, reversed (injected; host-extensible)
 *
 * DEFERRED (clear, friendly errors — never host execution):
 *   - class definitions          (a later Phase 4.4 pass)
 *   - interactive input()        (a later Phase 4.4 pass — pausable runtime)
 *
 * SAFETY MODEL
 *   The interpreter never reaches host code: no eval, no Function, no IO, no
 *   network. The original interpreter guaranteed termination by having no
 *   loops; now that loops and recursion exist, termination is guaranteed by
 *   hard budgets instead — a step budget, a per-loop iteration cap, a call
 *   recursion-depth cap and an output-line cap. Exceeding any budget yields a
 *   safe, displayed RuntimeError, never a frozen VM. Every other error is a
 *   normalized, displayable value (with line + offending name where known) —
 *   never a thrown exception that escapes the runtime.
 *
 * This module is the single interpreter every VM script runs through — see
 * core/execution.js (the dispatcher) and core/runtime/* (the bucky.* standard
 * library and capability model layered on top).
 */

// ----- Budgets (defence in depth; guarantee termination) ---------------------

const DEFAULT_LIMITS = {
    steps: 200000,   // total statement/iteration executions
    loops: 100000,   // iterations of any single loop
    depth: 200,      // call recursion depth
    output: 2000,    // printed lines
    range: 1000000   // max range() length
};

/**
 * The input() marker. input() is NOT a callable — it is a sentinel the
 * evaluator recognises in evalCall and turns into a runtime SUSPEND (`yield`).
 * Shared so stdlib modules (e.g. bucky.terminal.input) can map to the same
 * pausing behaviour via the `__input__` flag.
 */
export const INPUT = { __input__: true, pyName: "input" };

// ============================================================================
// 1. LEXER  — source -> tokens (with NEWLINE / INDENT / DEDENT)
// ============================================================================

const KEYWORDS = new Set([
    "def", "return", "if", "elif", "else", "for", "while", "in", "break",
    "continue", "pass", "import", "from", "as", "and", "or", "not", "is",
    "True", "False", "None", "class", "global", "nonlocal"
]);

// Multi-char operators, longest first so the scanner is greedy.
const OPERATORS = [
    "**=", "//=", "==", "!=", "<=", ">=", "**", "//", "+=", "-=", "*=", "/=",
    "%=", "->", "+", "-", "*", "/", "%", "<", ">", "=", "(", ")", "[", "]",
    "{", "}", ",", ":", ".", ";"
];

class SyntaxErr extends Error {
    constructor(message, line) {
        super(message);
        this.buckyType = "SyntaxError";
        this.line = line;
    }
}

function isIdentStart(ch) {
    return /[A-Za-z_]/.test(ch);
}
function isIdentPart(ch) {
    return /[A-Za-z0-9_]/.test(ch);
}
function isDigit(ch) {
    return ch >= "0" && ch <= "9";
}

/** Read a quoted string body starting at index `i` (which points at the quote). */
function readString(src, i, line, isF) {
    const quote = src[i];
    const triple = src[i + 1] === quote && src[i + 2] === quote;
    const start = i;
    i += triple ? 3 : 1;
    let body = "";
    let curLine = line;
    while (i < src.length) {
        const ch = src[i];
        if (ch === "\\") {
            const next = src[i + 1];
            if (next === undefined) throw new SyntaxErr("unterminated string literal", line);
            // Keep escapes raw for f-strings (decoded after interpolation);
            // decode now for plain strings.
            if (isF) {
                body += ch + next;
            } else {
                body += decodeEscape(next, quote);
            }
            i += 2;
            continue;
        }
        if (ch === "\n") {
            if (!triple) throw new SyntaxErr("unterminated string literal", line);
            curLine++;
            body += ch;
            i++;
            continue;
        }
        if (ch === quote) {
            if (triple) {
                if (src[i + 1] === quote && src[i + 2] === quote) {
                    return { value: body, next: i + 3, line: curLine };
                }
                body += ch;
                i++;
                continue;
            }
            return { value: body, next: i + 1, line: curLine };
        }
        body += ch;
        i++;
    }
    throw new SyntaxErr("unterminated string literal", line);
}

function decodeEscape(ch, quote) {
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    if (ch === "r") return "\r";
    if (ch === "0") return "\0";
    if (ch === "\\") return "\\";
    if (ch === quote) return quote;
    return ch;
}

function tokenize(src) {
    src = String(src == null ? "" : src).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const tokens = [];
    const indentStack = [0];
    let i = 0;
    let line = 1;
    let bracketDepth = 0;
    let atLineStart = true;

    const push = (type, value) => tokens.push({ type, value, line });

    while (i < src.length) {
        if (atLineStart && bracketDepth === 0) {
            // Measure indentation. Skip blank / comment-only lines entirely.
            let j = i;
            let indent = 0;
            while (j < src.length && (src[j] === " " || src[j] === "\t")) {
                indent += src[j] === "\t" ? 8 - (indent % 8) : 1;
                j++;
            }
            if (j >= src.length || src[j] === "\n" || src[j] === "#") {
                // Blank or comment-only line — consume to and including newline.
                while (j < src.length && src[j] !== "\n") j++;
                if (src[j] === "\n") {
                    line++;
                    j++;
                }
                i = j;
                continue;
            }
            const top = indentStack[indentStack.length - 1];
            if (indent > top) {
                indentStack.push(indent);
                push("INDENT");
            } else if (indent < top) {
                while (indentStack.length && indentStack[indentStack.length - 1] > indent) {
                    indentStack.pop();
                    push("DEDENT");
                }
                if (indentStack[indentStack.length - 1] !== indent) {
                    throw new SyntaxErr("inconsistent indentation", line);
                }
            }
            i = j;
            atLineStart = false;
        }

        const ch = src[i];
        if (ch === undefined) break;

        if (ch === " " || ch === "\t") {
            i++;
            continue;
        }
        if (ch === "#") {
            while (i < src.length && src[i] !== "\n") i++;
            continue;
        }
        if (ch === "\n") {
            line++;
            i++;
            if (bracketDepth === 0) {
                if (tokens.length && tokens[tokens.length - 1].type !== "NEWLINE") push("NEWLINE");
                atLineStart = true;
            }
            continue;
        }

        // f-string prefix
        if ((ch === "f" || ch === "F") && (src[i + 1] === '"' || src[i + 1] === "'")) {
            const r = readString(src, i + 1, line, true);
            tokens.push({ type: "FSTRING", value: r.value, line });
            line = r.line;
            i = r.next;
            continue;
        }
        if (ch === '"' || ch === "'") {
            const r = readString(src, i, line, false);
            tokens.push({ type: "STRING", value: r.value, line });
            line = r.line;
            i = r.next;
            continue;
        }
        if (isDigit(ch) || (ch === "." && isDigit(src[i + 1]))) {
            let num = "";
            while (i < src.length && (isDigit(src[i]) || src[i] === "." || src[i] === "_")) {
                if (src[i] !== "_") num += src[i];
                i++;
            }
            push("NUMBER", Number(num));
            continue;
        }
        if (isIdentStart(ch)) {
            let name = "";
            while (i < src.length && isIdentPart(src[i])) {
                name += src[i];
                i++;
            }
            push(KEYWORDS.has(name) ? "KEYWORD" : "NAME", name);
            continue;
        }

        let matched = null;
        for (const op of OPERATORS) {
            if (src.startsWith(op, i)) {
                matched = op;
                break;
            }
        }
        if (!matched) throw new SyntaxErr(`unexpected character '${ch}'`, line);
        if (matched === "(" || matched === "[" || matched === "{") bracketDepth++;
        else if (matched === ")" || matched === "]" || matched === "}") bracketDepth = Math.max(0, bracketDepth - 1);
        push("OP", matched);
        i += matched.length;
    }

    if (tokens.length && tokens[tokens.length - 1].type !== "NEWLINE") push("NEWLINE");
    while (indentStack.length > 1) {
        indentStack.pop();
        push("DEDENT");
    }
    push("EOF");
    return tokens;
}

// ============================================================================
// 2. PARSER — tokens -> AST
// ============================================================================

class Parser {
    constructor(tokens) {
        this.toks = tokens;
        this.pos = 0;
    }
    peek(offset = 0) {
        return this.toks[this.pos + offset] || { type: "EOF", line: 0 };
    }
    next() {
        return this.toks[this.pos++] || { type: "EOF", line: 0 };
    }
    at(type, value) {
        const t = this.peek();
        return t.type === type && (value === undefined || t.value === value);
    }
    eat(type, value) {
        if (!this.at(type, value)) {
            const t = this.peek();
            throw new SyntaxErr(
                `expected ${value || type} but found '${t.value != null ? t.value : t.type}'`,
                t.line
            );
        }
        return this.next();
    }
    skipNewlines() {
        while (this.at("NEWLINE")) this.next();
    }

    parseProgram() {
        const body = [];
        this.skipNewlines();
        while (!this.at("EOF")) {
            body.push(this.parseStatement());
            this.skipNewlines();
        }
        return { type: "Program", body };
    }

    parseStatement() {
        const t = this.peek();
        if (t.type === "KEYWORD") {
            switch (t.value) {
                case "if": return this.parseIf();
                case "for": return this.parseFor();
                case "while": return this.parseWhile();
                case "def": return this.parseDef();
                case "class":
                    throw new SyntaxErr(
                        "class definitions are not available yet (arriving in a later Phase 4.4 pass)",
                        t.line
                    );
            }
        }
        return this.parseSimpleStatement();
    }

    parseBlock() {
        // Inline block: "if x: stmt" on one line.
        if (!this.at("NEWLINE")) {
            return [this.parseSimpleStatement()];
        }
        this.eat("NEWLINE");
        this.eat("INDENT");
        const body = [];
        this.skipNewlines();
        while (!this.at("DEDENT") && !this.at("EOF")) {
            body.push(this.parseStatement());
            this.skipNewlines();
        }
        this.eat("DEDENT");
        if (!body.length) throw new SyntaxErr("expected an indented block", this.peek().line);
        return body;
    }

    parseIf() {
        const line = this.eat("KEYWORD", "if").line;
        const test = this.parseExpr();
        this.eat("OP", ":");
        const body = this.parseBlock();
        const clauses = [{ test, body }];
        let orelse = [];
        this.skipNewlines();
        while (this.at("KEYWORD", "elif")) {
            this.next();
            const t = this.parseExpr();
            this.eat("OP", ":");
            clauses.push({ test: t, body: this.parseBlock() });
            this.skipNewlines();
        }
        if (this.at("KEYWORD", "else")) {
            this.next();
            this.eat("OP", ":");
            orelse = this.parseBlock();
        }
        return { type: "If", clauses, orelse, line };
    }

    parseFor() {
        const line = this.eat("KEYWORD", "for").line;
        const targets = [this.eat("NAME").value];
        while (this.at("OP", ",")) {
            this.next();
            targets.push(this.eat("NAME").value);
        }
        this.eat("KEYWORD", "in");
        const iter = this.parseExpr();
        this.eat("OP", ":");
        const body = this.parseBlock();
        return { type: "For", targets, iter, body, line };
    }

    parseWhile() {
        const line = this.eat("KEYWORD", "while").line;
        const test = this.parseExpr();
        this.eat("OP", ":");
        const body = this.parseBlock();
        return { type: "While", test, body, line };
    }

    parseDef() {
        const line = this.eat("KEYWORD", "def").line;
        const name = this.eat("NAME").value;
        this.eat("OP", "(");
        const params = [];
        while (!this.at("OP", ")")) {
            const pname = this.eat("NAME").value;
            let dflt = null;
            if (this.at("OP", "=")) {
                this.next();
                dflt = this.parseExpr();
            }
            params.push({ name: pname, default: dflt });
            if (this.at("OP", ",")) this.next();
            else break;
        }
        this.eat("OP", ")");
        // Optional "-> type" annotation, ignored.
        if (this.at("OP", "->")) {
            this.next();
            this.parseExpr();
        }
        this.eat("OP", ":");
        const body = this.parseBlock();
        return { type: "FunctionDef", name, params, body, line };
    }

    parseSimpleStatement() {
        const t = this.peek();
        if (t.type === "KEYWORD") {
            if (t.value === "pass") { this.next(); this.endSimple(); return { type: "Pass", line: t.line }; }
            if (t.value === "break") { this.next(); this.endSimple(); return { type: "Break", line: t.line }; }
            if (t.value === "continue") { this.next(); this.endSimple(); return { type: "Continue", line: t.line }; }
            if (t.value === "return") {
                this.next();
                let value = null;
                if (!this.at("NEWLINE") && !this.at("EOF") && !this.at("DEDENT")) value = this.parseExpr();
                this.endSimple();
                return { type: "Return", value, line: t.line };
            }
            if (t.value === "import" || t.value === "from") return this.parseImport();
            if (t.value === "global" || t.value === "nonlocal") {
                // Accept + ignore scope declarations (single global scope model).
                this.next();
                while (this.at("NAME")) { this.next(); if (this.at("OP", ",")) this.next(); else break; }
                this.endSimple();
                return { type: "Pass", line: t.line };
            }
        }
        return this.parseExprOrAssign();
    }

    endSimple() {
        if (this.at("NEWLINE")) this.next();
        else if (!this.at("EOF") && !this.at("DEDENT")) {
            const t = this.peek();
            throw new SyntaxErr(`unexpected token '${t.value != null ? t.value : t.type}'`, t.line);
        }
    }

    parseImport() {
        const line = this.peek().line;
        if (this.at("KEYWORD", "from")) {
            this.next();
            const mod = this.parseDottedName();
            this.eat("KEYWORD", "import");
            const names = [];
            let star = false;
            if (this.at("OP", "*")) {
                this.next();
                star = true;
            } else {
                do {
                    const n = this.eat("NAME").value;
                    let alias = n;
                    if (this.at("KEYWORD", "as")) { this.next(); alias = this.eat("NAME").value; }
                    names.push({ name: n, alias });
                } while (this.at("OP", ",") && this.next());
            }
            this.endSimple();
            return { type: "ImportFrom", module: mod, names, star, line };
        }
        this.eat("KEYWORD", "import");
        const imports = [];
        do {
            const mod = this.parseDottedName();
            let alias = null;
            if (this.at("KEYWORD", "as")) { this.next(); alias = this.eat("NAME").value; }
            imports.push({ module: mod, alias });
        } while (this.at("OP", ",") && this.next());
        this.endSimple();
        return { type: "Import", imports, line };
    }

    parseDottedName() {
        let name = this.eat("NAME").value;
        while (this.at("OP", ".")) {
            this.next();
            name += "." + this.eat("NAME").value;
        }
        return name;
    }

    parseExprOrAssign() {
        const line = this.peek().line;
        const first = this.parseExpr();
        // Augmented assignment.
        const aug = ["+=", "-=", "*=", "/=", "//=", "%=", "**="];
        if (this.peek().type === "OP" && aug.includes(this.peek().value)) {
            const op = this.next().value;
            const value = this.parseExpr();
            this.endSimple();
            return { type: "AugAssign", target: first, op: op.slice(0, -1), value, line };
        }
        if (this.at("OP", "=")) {
            const targets = [first];
            while (this.at("OP", "=")) {
                this.next();
                targets.push(this.parseExpr());
            }
            const value = targets.pop();
            this.endSimple();
            return { type: "Assign", targets, value, line };
        }
        // Tuple-unpack target: "a, b = expr"
        if (this.at("OP", ",")) {
            const elts = [first];
            while (this.at("OP", ",")) {
                this.next();
                if (this.at("OP", "=")) break;
                elts.push(this.parseExpr());
            }
            if (this.at("OP", "=")) {
                this.next();
                const value = this.parseExpr();
                this.endSimple();
                return { type: "Assign", targets: [{ type: "Tuple", elts, line }], value, line };
            }
            this.endSimple();
            return { type: "ExprStmt", value: { type: "Tuple", elts, line }, line };
        }
        this.endSimple();
        return { type: "ExprStmt", value: first, line };
    }

    // --- Expression precedence climbing ---

    parseExpr() {
        return this.parseTernary();
    }

    parseTernary() {
        const expr = this.parseOr();
        if (this.at("KEYWORD", "if")) {
            this.next();
            const cond = this.parseOr();
            this.eat("KEYWORD", "else");
            const orelse = this.parseExpr();
            return { type: "Ternary", body: expr, test: cond, orelse, line: expr.line };
        }
        return expr;
    }

    parseOr() {
        let left = this.parseAnd();
        while (this.at("KEYWORD", "or")) {
            const line = this.next().line;
            left = { type: "BoolOp", op: "or", left, right: this.parseAnd(), line };
        }
        return left;
    }
    parseAnd() {
        let left = this.parseNot();
        while (this.at("KEYWORD", "and")) {
            const line = this.next().line;
            left = { type: "BoolOp", op: "and", left, right: this.parseNot(), line };
        }
        return left;
    }
    parseNot() {
        if (this.at("KEYWORD", "not")) {
            const line = this.next().line;
            return { type: "Unary", op: "not", operand: this.parseNot(), line };
        }
        return this.parseComparison();
    }
    parseComparison() {
        let left = this.parseArith();
        const compOps = ["==", "!=", "<", "<=", ">", ">="];
        while (true) {
            const t = this.peek();
            if (t.type === "OP" && compOps.includes(t.value)) {
                this.next();
                left = { type: "Compare", op: t.value, left, right: this.parseArith(), line: t.line };
            } else if (t.type === "KEYWORD" && (t.value === "in" || t.value === "is")) {
                this.next();
                let op = t.value;
                if (op === "is" && this.at("KEYWORD", "not")) { this.next(); op = "is not"; }
                left = { type: "Compare", op, left, right: this.parseArith(), line: t.line };
            } else if (t.type === "KEYWORD" && t.value === "not" && this.peek(1).type === "KEYWORD" && this.peek(1).value === "in") {
                this.next(); this.next();
                left = { type: "Compare", op: "not in", left, right: this.parseArith(), line: t.line };
            } else break;
        }
        return left;
    }
    parseArith() {
        let left = this.parseTerm();
        while (this.peek().type === "OP" && (this.peek().value === "+" || this.peek().value === "-")) {
            const op = this.next();
            left = { type: "BinOp", op: op.value, left, right: this.parseTerm(), line: op.line };
        }
        return left;
    }
    parseTerm() {
        let left = this.parseFactor();
        while (this.peek().type === "OP" && ["*", "/", "//", "%"].includes(this.peek().value)) {
            const op = this.next();
            left = { type: "BinOp", op: op.value, left, right: this.parseFactor(), line: op.line };
        }
        return left;
    }
    parseFactor() {
        const t = this.peek();
        if (t.type === "OP" && (t.value === "-" || t.value === "+")) {
            this.next();
            return { type: "Unary", op: t.value, operand: this.parseFactor(), line: t.line };
        }
        return this.parsePower();
    }
    parsePower() {
        const base = this.parseTrailer();
        if (this.at("OP", "**")) {
            const line = this.next().line;
            return { type: "BinOp", op: "**", left: base, right: this.parseFactor(), line };
        }
        return base;
    }
    parseTrailer() {
        let node = this.parseAtom();
        while (true) {
            if (this.at("OP", ".")) {
                const line = this.next().line;
                const attr = this.eat("NAME").value;
                node = { type: "Attribute", object: node, attr, line };
            } else if (this.at("OP", "(")) {
                const line = this.next().line;
                const args = [];
                while (!this.at("OP", ")")) {
                    // keyword arg name=value -> captured as positional value (kw ignored, bound by order is wrong;
                    // we keep the value and a kw tag for native funcs that accept kwargs object)
                    if (this.at("NAME") && this.peek(1).type === "OP" && this.peek(1).value === "=") {
                        const kw = this.next().value;
                        this.next(); // '='
                        args.push({ kw, value: this.parseExpr() });
                    } else {
                        args.push({ kw: null, value: this.parseExpr() });
                    }
                    if (this.at("OP", ",")) this.next();
                    else break;
                }
                this.eat("OP", ")");
                node = { type: "Call", callee: node, args, line };
            } else if (this.at("OP", "[")) {
                const line = this.next().line;
                // subscript or slice a[i] / a[i:j] / a[i:j:k]
                const parts = [null, null, null];
                let idx = 0;
                let isSlice = false;
                if (!this.at("OP", ":")) parts[0] = this.parseExpr();
                while (this.at("OP", ":") && idx < 2) {
                    isSlice = true;
                    this.next();
                    idx++;
                    if (!this.at("OP", ":") && !this.at("OP", "]")) parts[idx] = this.parseExpr();
                }
                this.eat("OP", "]");
                node = isSlice
                    ? { type: "Slice", object: node, start: parts[0], stop: parts[1], step: parts[2], line }
                    : { type: "Subscript", object: node, index: parts[0], line };
            } else break;
        }
        return node;
    }
    parseAtom() {
        const t = this.peek();
        if (t.type === "NUMBER") { this.next(); return { type: "Num", value: t.value, line: t.line }; }
        if (t.type === "STRING") { this.next(); return { type: "Str", value: t.value, line: t.line }; }
        if (t.type === "FSTRING") { this.next(); return { type: "FStr", value: t.value, line: t.line }; }
        if (t.type === "NAME") { this.next(); return { type: "Name", id: t.value, line: t.line }; }
        if (t.type === "KEYWORD") {
            if (t.value === "True") { this.next(); return { type: "Const", value: true, line: t.line }; }
            if (t.value === "False") { this.next(); return { type: "Const", value: false, line: t.line }; }
            if (t.value === "None") { this.next(); return { type: "Const", value: null, line: t.line }; }
        }
        if (this.at("OP", "(")) {
            this.next();
            if (this.at("OP", ")")) { this.next(); return { type: "Tuple", elts: [], line: t.line }; }
            const first = this.parseExpr();
            if (this.at("OP", ",")) {
                const elts = [first];
                while (this.at("OP", ",")) {
                    this.next();
                    if (this.at("OP", ")")) break;
                    elts.push(this.parseExpr());
                }
                this.eat("OP", ")");
                return { type: "Tuple", elts, line: t.line };
            }
            this.eat("OP", ")");
            return first;
        }
        if (this.at("OP", "[")) {
            this.next();
            const elts = [];
            while (!this.at("OP", "]")) {
                elts.push(this.parseExpr());
                if (this.at("OP", ",")) this.next();
                else break;
            }
            this.eat("OP", "]");
            return { type: "List", elts, line: t.line };
        }
        if (this.at("OP", "{")) {
            this.next();
            const keys = [];
            const values = [];
            while (!this.at("OP", "}")) {
                const k = this.parseExpr();
                this.eat("OP", ":");
                const v = this.parseExpr();
                keys.push(k);
                values.push(v);
                if (this.at("OP", ",")) this.next();
                else break;
            }
            this.eat("OP", "}");
            return { type: "Dict", keys, values, line: t.line };
        }
        throw new SyntaxErr(`unexpected token '${t.value != null ? t.value : t.type}'`, t.line);
    }
}

function parseExpressionString(text) {
    const toks = tokenize(text).filter((t) => !["NEWLINE", "INDENT", "DEDENT"].includes(t.type));
    const p = new Parser(toks);
    const expr = p.parseExpr();
    if (!p.at("EOF")) throw new SyntaxErr("invalid expression", p.peek().line);
    return expr;
}

// ============================================================================
// 3. RUNTIME VALUES + helpers
// ============================================================================

class BuckyError extends Error {
    constructor(type, message, line, name) {
        super(message);
        this.buckyType = type;
        this.line = line;
        this.varName = name || null;
    }
}

// Control-flow signals (not user-visible errors).
const BREAK = { signal: "break" };
const CONTINUE = { signal: "continue" };
class ReturnSignal {
    constructor(value) { this.value = value; }
}

class PyFunction {
    constructor(def, env) {
        this.def = def;
        this.env = env;
        this.__pyfunc__ = true;
    }
}

function isDict(v) {
    return v && typeof v === "object" && !Array.isArray(v) && !v.__pyfunc__ && !v.__module__;
}

/** Render a value the way Python's str()/print would. */
function pyStr(value) {
    if (value === true) return "True";
    if (value === false) return "False";
    if (value === null || value === undefined) return "None";
    if (typeof value === "string") return value;
    if (typeof value === "number") return numStr(value);
    if (Array.isArray(value)) return "[" + value.map(pyRepr).join(", ") + "]";
    if (value instanceof PyFunction) return `<function ${value.def.name}>`;
    if (value && value.__module__) return `<module ${value.__name__ || ""}>`;
    if (typeof value === "function") return `<builtin ${value.pyName || "fn"}>`;
    if (isDict(value)) {
        return "{" + Object.keys(value).map((k) => `${pyRepr(k)}: ${pyRepr(value[k])}`).join(", ") + "}";
    }
    return String(value);
}
function pyRepr(value) {
    if (typeof value === "string") return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
    return pyStr(value);
}
function numStr(n) {
    if (Number.isInteger(n)) return String(n);
    return String(n);
}
function truthy(v) {
    if (v === null || v === undefined || v === false) return false;
    if (v === 0 || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    if (isDict(v)) return Object.keys(v).length > 0;
    return Boolean(v);
}

// ============================================================================
// 4. EVALUATOR
// ============================================================================

class Scope {
    constructor(parent) {
        this.vars = Object.create(null);
        this.parent = parent || null;
    }
    has(name) {
        return name in this.vars || (this.parent ? this.parent.has(name) : false);
    }
    get(name) {
        if (name in this.vars) return this.vars[name];
        if (this.parent) return this.parent.get(name);
        return undefined;
    }
    hasLocalChain(name) {
        let s = this;
        while (s) { if (name in s.vars) return s; s = s.parent; }
        return null;
    }
    set(name, value) {
        this.vars[name] = value;
    }
}

class Interpreter {
    constructor(options = {}) {
        this.limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
        this.output = [];
        this.stdout = typeof options.stdout === "function" ? options.stdout : null;
        this.modules = options.modules || {};
        this.steps = 0;
        this.depth = 0;
        this.global = new Scope(null);
        this.installBuiltins(options.builtins || {});
        // Program arguments -> global `args` (user args, program name excluded).
        this.global.set("args", Array.isArray(options.argv) ? options.argv.slice() : []);
        this.global.set("argv", Array.isArray(options.argv) ? ["script", ...options.argv] : ["script"]);
    }

    tick() {
        if (++this.steps > this.limits.steps) {
            throw new BuckyError("RuntimeError", "step budget exceeded (possible infinite loop)", 0);
        }
    }

    print(...vals) {
        const line = vals.map(pyStr).join(" ");
        if (this.output.length >= this.limits.output) {
            throw new BuckyError("RuntimeError", "output limit reached", 0);
        }
        this.output.push(line);
        if (this.stdout) this.stdout(line);
        return null;
    }

    installBuiltins(extra) {
        const b = makeBuiltins(this);
        Object.keys(b).forEach((k) => this.global.set(k, b[k]));
        Object.keys(extra).forEach((k) => this.global.set(k, extra[k]));
    }

    // The evaluator is generator-based so a script can SUSPEND at input() and
    // RESUME when the host supplies a line — without rewriting the recursive
    // tree-walk. Pure helpers (binop, compare, subscript, getAttr, toIterable,
    // bindForTargets) stay synchronous; anything that can transitively reach a
    // call (and therefore input) is a generator delegated to with `yield*`.
    * run(source) {
        const ast = new Parser(tokenize(source)).parseProgram();
        yield* this.execBlock(ast.body, this.global);
    }

    * execBlock(stmts, scope) {
        for (const stmt of stmts) yield* this.execStmt(stmt, scope);
    }

    * execStmt(stmt, scope) {
        this.tick();
        switch (stmt.type) {
            case "ExprStmt":
                yield* this.eval(stmt.value, scope);
                return;
            case "Assign": {
                const value = yield* this.eval(stmt.value, scope);
                for (const target of stmt.targets) yield* this.assign(target, value, scope);
                return;
            }
            case "AugAssign": {
                const current = yield* this.eval(stmt.target, scope);
                const rhs = yield* this.eval(stmt.value, scope);
                yield* this.assign(stmt.target, this.binop(stmt.op, current, rhs, stmt.line), scope);
                return;
            }
            case "If": {
                for (const clause of stmt.clauses) {
                    if (truthy(yield* this.eval(clause.test, scope))) {
                        yield* this.execBlock(clause.body, scope);
                        return;
                    }
                }
                yield* this.execBlock(stmt.orelse, scope);
                return;
            }
            case "While": {
                let iters = 0;
                while (truthy(yield* this.eval(stmt.test, scope))) {
                    if (++iters > this.limits.loops) {
                        throw new BuckyError("RuntimeError", "loop iteration limit exceeded", stmt.line);
                    }
                    this.tick();
                    const sig = yield* this.runLoopBody(stmt.body, scope);
                    if (sig === BREAK) break;
                }
                return;
            }
            case "For": {
                const iterable = this.toIterable(yield* this.eval(stmt.iter, scope), stmt.line);
                let iters = 0;
                for (const item of iterable) {
                    if (++iters > this.limits.loops) {
                        throw new BuckyError("RuntimeError", "loop iteration limit exceeded", stmt.line);
                    }
                    this.tick();
                    this.bindForTargets(stmt.targets, item, scope, stmt.line);
                    const sig = yield* this.runLoopBody(stmt.body, scope);
                    if (sig === BREAK) break;
                }
                return;
            }
            case "FunctionDef":
                scope.set(stmt.name, new PyFunction(stmt, scope));
                return;
            case "Return": {
                const v = stmt.value ? (yield* this.eval(stmt.value, scope)) : null;
                throw new ReturnSignal(v);
            }
            case "Break":
                throw BREAK;
            case "Continue":
                throw CONTINUE;
            case "Pass":
                return;
            case "Import":
                stmt.imports.forEach((imp) => this.doImport(imp.module, imp.alias, scope, stmt.line));
                return;
            case "ImportFrom":
                this.doImportFrom(stmt, scope);
                return;
            default:
                throw new BuckyError("RuntimeError", `unsupported statement '${stmt.type}'`, stmt.line);
        }
    }

    * runLoopBody(body, scope) {
        try {
            yield* this.execBlock(body, scope);
        } catch (e) {
            if (e === BREAK) return BREAK;
            if (e === CONTINUE) return CONTINUE;
            throw e;
        }
        return null;
    }

    // --- imports ---

    resolveModule(name, line) {
        if (Object.prototype.hasOwnProperty.call(this.modules, name)) return this.modules[name];
        throw new BuckyError("ImportError", `no module named '${name}'`, line, name);
    }

    doImport(moduleName, alias, scope, line) {
        const mod = this.resolveModule(moduleName, line);
        if (alias) {
            scope.set(alias, mod);
            return;
        }
        // import a.b.c -> bind top name "a" with nested namespace objects.
        const parts = moduleName.split(".");
        if (parts.length === 1) {
            scope.set(parts[0], mod);
            return;
        }
        let root = scope.hasLocalChain(parts[0]) ? scope.get(parts[0]) : null;
        if (!isNamespace(root)) {
            root = { __module__: true, __name__: parts[0] };
            scope.set(parts[0], root);
        }
        let cur = root;
        for (let k = 1; k < parts.length; k++) {
            const full = parts.slice(0, k + 1).join(".");
            const sub = (k === parts.length - 1) ? mod : (this.modules[full] || { __module__: true, __name__: full });
            if (!isNamespace(cur[parts[k]])) cur[parts[k]] = sub;
            cur = cur[parts[k]];
        }
    }

    doImportFrom(stmt, scope) {
        const mod = this.resolveModule(stmt.module, stmt.line);
        if (stmt.star) {
            Object.keys(mod).forEach((k) => {
                if (k.startsWith("__")) return;
                scope.set(k, mod[k]);
            });
            return;
        }
        stmt.names.forEach(({ name, alias }) => {
            if (!(name in mod)) {
                throw new BuckyError("ImportError", `cannot import name '${name}' from '${stmt.module}'`, stmt.line, name);
            }
            scope.set(alias || name, mod[name]);
        });
    }

    // --- assignment targets ---

    * assign(target, value, scope) {
        if (target.type === "Name") {
            scope.set(target.id, value);
            return;
        }
        if (target.type === "Subscript") {
            const obj = yield* this.eval(target.object, scope);
            const key = yield* this.eval(target.index, scope);
            if (Array.isArray(obj)) {
                const idx = key < 0 ? obj.length + key : key;
                obj[idx] = value;
            } else if (isDict(obj)) {
                obj[String(key)] = value;
            } else {
                throw new BuckyError("TypeError", "object does not support item assignment", target.line);
            }
            return;
        }
        if (target.type === "Attribute") {
            const obj = yield* this.eval(target.object, scope);
            if (isDict(obj) || isNamespace(obj)) obj[target.attr] = value;
            else throw new BuckyError("TypeError", "cannot set attribute on this value", target.line);
            return;
        }
        if (target.type === "Tuple" || target.type === "List") {
            const arr = Array.from(this.toIterable(value, target.line));
            if (arr.length !== target.elts.length) {
                throw new BuckyError("ValueError", `cannot unpack ${arr.length} values into ${target.elts.length} targets`, target.line);
            }
            for (let idx = 0; idx < target.elts.length; idx++) yield* this.assign(target.elts[idx], arr[idx], scope);
            return;
        }
        throw new BuckyError("SyntaxError", "invalid assignment target", target.line);
    }

    bindForTargets(targets, item, scope, line) {
        if (targets.length === 1) {
            scope.set(targets[0], item);
            return;
        }
        const arr = Array.from(this.toIterable(item, line));
        if (arr.length !== targets.length) {
            throw new BuckyError("ValueError", `cannot unpack ${arr.length} values into ${targets.length} targets`, line);
        }
        targets.forEach((t, idx) => scope.set(t, arr[idx]));
    }

    toIterable(value, line) {
        if (Array.isArray(value)) return value;
        if (typeof value === "string") return value.split("");
        if (isDict(value)) return Object.keys(value);
        throw new BuckyError("TypeError", `'${typeName(value)}' object is not iterable`, line);
    }

    // --- expression evaluation ---

    * eval(node, scope) {
        switch (node.type) {
            case "Num": return node.value;
            case "Str": return node.value;
            case "Const": return node.value;
            case "FStr": return yield* this.evalFString(node.value, scope, node.line);
            case "Name": {
                const s = scope.hasLocalChain(node.id);
                if (!s) throw new BuckyError("NameError", `name '${node.id}' is not defined`, node.line, node.id);
                return s.vars[node.id];
            }
            case "List":
            case "Tuple": {
                const out = [];
                for (const e of node.elts) out.push(yield* this.eval(e, scope));
                return out;
            }
            case "Dict": {
                const obj = {};
                for (let i = 0; i < node.keys.length; i++) {
                    const k = yield* this.eval(node.keys[i], scope);
                    obj[String(k)] = yield* this.eval(node.values[i], scope);
                }
                return obj;
            }
            case "BoolOp": {
                const left = yield* this.eval(node.left, scope);
                if (node.op === "and") return truthy(left) ? (yield* this.eval(node.right, scope)) : left;
                return truthy(left) ? left : (yield* this.eval(node.right, scope));
            }
            case "Unary": {
                if (node.op === "not") return !truthy(yield* this.eval(node.operand, scope));
                const v = yield* this.eval(node.operand, scope);
                if (node.op === "-") return -v;
                return +v;
            }
            case "BinOp": {
                const l = yield* this.eval(node.left, scope);
                const r = yield* this.eval(node.right, scope);
                return this.binop(node.op, l, r, node.line);
            }
            case "Compare": {
                const l = yield* this.eval(node.left, scope);
                const r = yield* this.eval(node.right, scope);
                return this.compare(node.op, l, r, node.line);
            }
            case "Ternary":
                return truthy(yield* this.eval(node.test, scope))
                    ? (yield* this.eval(node.body, scope))
                    : (yield* this.eval(node.orelse, scope));
            case "Attribute":
                return this.getAttr(yield* this.eval(node.object, scope), node.attr, node.line);
            case "Subscript": {
                const obj = yield* this.eval(node.object, scope);
                const idx = yield* this.eval(node.index, scope);
                return this.subscript(obj, idx, node.line);
            }
            case "Slice":
                return yield* this.slice(node, scope);
            case "Call":
                return yield* this.evalCall(node, scope);
            default:
                throw new BuckyError("RuntimeError", `cannot evaluate '${node.type}'`, node.line);
        }
    }

    * evalFString(raw, scope, line) {
        let out = "";
        let i = 0;
        while (i < raw.length) {
            const ch = raw[i];
            if (ch === "{") {
                if (raw[i + 1] === "{") { out += "{"; i += 2; continue; }
                let depth = 1;
                let expr = "";
                i++;
                while (i < raw.length && depth > 0) {
                    if (raw[i] === "{") depth++;
                    else if (raw[i] === "}") { depth--; if (depth === 0) break; }
                    expr += raw[i];
                    i++;
                }
                i++; // closing }
                // Strip a trailing :format spec (best-effort; spec ignored).
                let exprText = expr;
                const colon = topLevelColon(expr);
                if (colon >= 0) exprText = expr.slice(0, colon);
                let astNode;
                try {
                    astNode = parseExpressionString(decodeFStringEscapes(exprText));
                } catch (e) {
                    throw new BuckyError("SyntaxError", `invalid f-string expression: ${exprText.trim()}`, line);
                }
                out += pyStr(yield* this.eval(astNode, scope));
                continue;
            }
            if (ch === "}") {
                if (raw[i + 1] === "}") { out += "}"; i += 2; continue; }
                out += "}";
                i++;
                continue;
            }
            if (ch === "\\") {
                out += decodeEscape(raw[i + 1], '"');
                i += 2;
                continue;
            }
            out += ch;
            i++;
        }
        return out;
    }

    binop(op, a, b, line) {
        switch (op) {
            case "+":
                if (typeof a === "number" && typeof b === "number") return a + b;
                if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
                if (typeof a === "string" || typeof b === "string") return pyStr(a) + pyStr(b);
                return a + b;
            case "-": return a - b;
            case "*":
                if (typeof a === "string" && typeof b === "number") return a.repeat(Math.max(0, b | 0));
                if (Array.isArray(a) && typeof b === "number") { const r = []; for (let k = 0; k < b; k++) r.push(...a); return r; }
                return a * b;
            case "/":
                if (b === 0) throw new BuckyError("ZeroDivisionError", "division by zero", line);
                return a / b;
            case "//":
                if (b === 0) throw new BuckyError("ZeroDivisionError", "integer division by zero", line);
                return Math.floor(a / b);
            case "%":
                if (b === 0) throw new BuckyError("ZeroDivisionError", "modulo by zero", line);
                if (typeof a === "number") return ((a % b) + b) % b;
                return a;
            case "**": return Math.pow(a, b);
            default:
                throw new BuckyError("RuntimeError", `unsupported operator '${op}'`, line);
        }
    }

    compare(op, a, b, line) {
        switch (op) {
            case "==": return pyEquals(a, b);
            case "!=": return !pyEquals(a, b);
            case "<": return a < b;
            case "<=": return a <= b;
            case ">": return a > b;
            case ">=": return a >= b;
            case "is": return a === b || pyEquals(a, b);
            case "is not": return !(a === b || pyEquals(a, b));
            case "in": return this.contains(b, a, line);
            case "not in": return !this.contains(b, a, line);
            default:
                throw new BuckyError("RuntimeError", `unsupported comparison '${op}'`, line);
        }
    }

    contains(container, item, line) {
        if (Array.isArray(container)) return container.some((x) => pyEquals(x, item));
        if (typeof container === "string") return container.includes(String(item));
        if (isDict(container)) return Object.prototype.hasOwnProperty.call(container, String(item));
        throw new BuckyError("TypeError", "argument is not iterable", line);
    }

    subscript(obj, key, line) {
        if (Array.isArray(obj) || typeof obj === "string") {
            let idx = key;
            if (typeof idx !== "number") throw new BuckyError("TypeError", "indices must be integers", line);
            if (idx < 0) idx += obj.length;
            if (idx < 0 || idx >= obj.length) throw new BuckyError("IndexError", "index out of range", line);
            return obj[idx];
        }
        if (isDict(obj)) {
            const k = String(key);
            if (!(k in obj)) throw new BuckyError("KeyError", `'${k}'`, line, k);
            return obj[k];
        }
        throw new BuckyError("TypeError", `'${typeName(obj)}' object is not subscriptable`, line);
    }

    * slice(node, scope) {
        const obj = yield* this.eval(node.object, scope);
        if (!Array.isArray(obj) && typeof obj !== "string") {
            throw new BuckyError("TypeError", "object is not sliceable", node.line);
        }
        const len = obj.length;
        let startRaw = 0;
        if (node.start != null) { startRaw = yield* this.eval(node.start, scope); if (startRaw < 0) startRaw += len; }
        let stopRaw = len;
        if (node.stop != null) { stopRaw = yield* this.eval(node.stop, scope); if (stopRaw < 0) stopRaw += len; }
        const start = Math.max(0, startRaw);
        const stop = Math.min(len, stopRaw);
        const step = node.step ? (yield* this.eval(node.step, scope)) : 1;
        if (step === 1) return obj.slice(start, stop);
        const out = [];
        for (let k = start; k < stop; k += step) out.push(obj[k]);
        return typeof obj === "string" ? out.join("") : out;
    }

    getAttr(obj, name, line) {
        if (isNamespace(obj)) {
            if (name in obj) return obj[name];
            throw new BuckyError("AttributeError", `module has no attribute '${name}'`, line, name);
        }
        const method = lookupMethod(obj, name, this);
        if (method) return method;
        if (isDict(obj) && name in obj) return obj[name];
        throw new BuckyError("AttributeError", `'${typeName(obj)}' object has no attribute '${name}'`, line, name);
    }

    * evalCall(node, scope) {
        const callee = yield* this.eval(node.callee, scope);
        // input() is the one builtin that can SUSPEND the runtime: it is a
        // sentinel (not a callable), recognised here. The interpreter yields an
        // input request; the host (interactive terminal) resumes the generator
        // with the typed line. A non-interactive host that supplies no input
        // turns this into a clean, displayed error (see the drivers below).
        if (callee && callee.__input__ === true) {
            let prompt = "";
            if (node.args.length) prompt = pyStr(yield* this.eval(node.args[0].value, scope));
            const value = yield { type: "input", prompt, line: node.line };
            return value == null ? "" : String(value);
        }
        const args = [];
        const kwargs = {};
        for (const a of node.args) {
            const v = yield* this.eval(a.value, scope);
            if (a.kw) kwargs[a.kw] = v;
            else args.push(v);
        }
        return yield* this.callValue(callee, args, kwargs, node.line);
    }

    * callValue(callee, args, kwargs, line) {
        if (callee instanceof PyFunction) {
            return yield* this.callPyFunction(callee, args, kwargs, line);
        }
        if (typeof callee === "function") {
            try {
                const r = callee(args, kwargs, this);
                return r === undefined ? null : r;
            } catch (e) {
                if (e instanceof BuckyError || e instanceof ReturnSignal || e === BREAK || e === CONTINUE) throw e;
                throw new BuckyError(e.buckyType || "RuntimeError", e.message || "call failed", line, e.varName || null);
            }
        }
        throw new BuckyError("TypeError", `'${typeName(callee)}' object is not callable`, line);
    }

    * callPyFunction(fn, args, kwargs, line) {
        if (++this.depth > this.limits.depth) {
            this.depth--;
            throw new BuckyError("RecursionError", "maximum recursion depth exceeded", line);
        }
        const scope = new Scope(fn.env);
        const params = fn.def.params;
        for (let idx = 0; idx < params.length; idx++) {
            const p = params[idx];
            if (idx < args.length) scope.set(p.name, args[idx]);
            else if (p.name in kwargs) scope.set(p.name, kwargs[p.name]);
            else if (p.default !== null) scope.set(p.name, yield* this.eval(p.default, fn.env));
            else { this.depth--; throw new BuckyError("TypeError", `${fn.def.name}() missing argument '${p.name}'`, line, p.name); }
        }
        try {
            yield* this.execBlock(fn.def.body, scope);
        } catch (e) {
            if (e instanceof ReturnSignal) { this.depth--; return e.value; }
            this.depth--;
            throw e;
        }
        this.depth--;
        return null;
    }
}

// ----- value helpers reused by methods/builtins -----------------------------

function isNamespace(v) {
    return v && typeof v === "object" && v.__module__ === true;
}
function typeName(v) {
    if (v === null || v === undefined) return "NoneType";
    if (typeof v === "boolean") return "bool";
    if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
    if (typeof v === "string") return "str";
    if (Array.isArray(v)) return "list";
    if (v instanceof PyFunction || typeof v === "function") return "function";
    if (isDict(v)) return "dict";
    return "object";
}
function pyEquals(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((x, i) => pyEquals(x, b[i]));
    }
    if (isDict(a) && isDict(b)) {
        const ka = Object.keys(a);
        const kb = Object.keys(b);
        return ka.length === kb.length && ka.every((k) => k in b && pyEquals(a[k], b[k]));
    }
    return false;
}
function topLevelColon(expr) {
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
        const c = expr[i];
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        else if (c === ":" && depth === 0) return i;
    }
    return -1;
}
function decodeFStringEscapes(text) {
    return text;
}

// ----- string / list / dict methods -----------------------------------------

function native(name, fn) {
    fn.pyName = name;
    return fn;
}

function lookupMethod(obj, name, interp) {
    if (typeof obj === "string") return STRING_METHODS[name] ? bindMethod(STRING_METHODS[name], obj) : null;
    if (Array.isArray(obj)) return LIST_METHODS[name] ? bindMethod(LIST_METHODS[name], obj) : null;
    if (isDict(obj)) return DICT_METHODS[name] ? bindMethod(DICT_METHODS[name], obj) : null;
    return null;
}
function bindMethod(fn, self) {
    return native(fn.pyName || "method", (args, kwargs, interp) => fn(self, args, kwargs, interp));
}

const STRING_METHODS = {
    upper: native("upper", (s) => s.toUpperCase()),
    lower: native("lower", (s) => s.toLowerCase()),
    strip: native("strip", (s, a) => a && a[0] ? trimChars(s, a[0], true, true) : s.trim()),
    lstrip: native("lstrip", (s, a) => a && a[0] ? trimChars(s, a[0], true, false) : s.replace(/^\s+/, "")),
    rstrip: native("rstrip", (s, a) => a && a[0] ? trimChars(s, a[0], false, true) : s.replace(/\s+$/, "")),
    title: native("title", (s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())),
    capitalize: native("capitalize", (s) => s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s),
    replace: native("replace", (s, a) => s.split(a[0]).join(a[1])),
    split: native("split", (s, a) => (a && a[0] != null ? s.split(a[0]) : s.trim().split(/\s+/).filter(Boolean))),
    join: native("join", (s, a) => (a[0] || []).map(pyStr).join(s)),
    startswith: native("startswith", (s, a) => s.startsWith(a[0])),
    endswith: native("endswith", (s, a) => s.endsWith(a[0])),
    find: native("find", (s, a) => s.indexOf(a[0])),
    count: native("count", (s, a) => a[0] === "" ? s.length + 1 : s.split(a[0]).length - 1),
    zfill: native("zfill", (s, a) => s.padStart(a[0], "0")),
    ljust: native("ljust", (s, a) => s.padEnd(a[0], a[1] || " ")),
    rjust: native("rjust", (s, a) => s.padStart(a[0], a[1] || " ")),
    format: native("format", (s, a) => {
        let idx = 0;
        return s.replace(/\{\}/g, () => pyStr(a[idx++]));
    })
};
function trimChars(s, chars, left, right) {
    let start = 0;
    let end = s.length;
    if (left) while (start < end && chars.includes(s[start])) start++;
    if (right) while (end > start && chars.includes(s[end - 1])) end--;
    return s.slice(start, end);
}

const LIST_METHODS = {
    append: native("append", (l, a) => { l.push(a[0]); return null; }),
    extend: native("extend", (l, a) => { (a[0] || []).forEach((x) => l.push(x)); return null; }),
    insert: native("insert", (l, a) => { l.splice(a[0], 0, a[1]); return null; }),
    pop: native("pop", (l, a) => (a.length ? l.splice(a[0], 1)[0] : l.pop())),
    remove: native("remove", (l, a) => { const i = l.findIndex((x) => pyEquals(x, a[0])); if (i >= 0) l.splice(i, 1); return null; }),
    index: native("index", (l, a) => l.findIndex((x) => pyEquals(x, a[0]))),
    count: native("count", (l, a) => l.filter((x) => pyEquals(x, a[0])).length),
    sort: native("sort", (l, a, kw) => { sortInPlace(l, kw); return null; }),
    reverse: native("reverse", (l) => { l.reverse(); return null; }),
    copy: native("copy", (l) => l.slice())
};
function sortInPlace(l, kw) {
    const rev = kw && truthy(kw.reverse);
    l.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    if (rev) l.reverse();
}

const DICT_METHODS = {
    keys: native("keys", (d) => Object.keys(d)),
    values: native("values", (d) => Object.values(d)),
    items: native("items", (d) => Object.keys(d).map((k) => [k, d[k]])),
    get: native("get", (d, a) => (a[0] in d ? d[a[0]] : (a.length > 1 ? a[1] : null))),
    copy: native("copy", (d) => ({ ...d })),
    update: native("update", (d, a) => { Object.assign(d, a[0] || {}); return null; }),
    pop: native("pop", (d, a) => { const k = String(a[0]); if (k in d) { const v = d[k]; delete d[k]; return v; } return a.length > 1 ? a[1] : null; })
};

// ----- builtins --------------------------------------------------------------

function makeBuiltins(interp) {
    return {
        print: native("print", (args) => interp.print(...args)),
        len: native("len", (a) => {
            const v = a[0];
            if (typeof v === "string" || Array.isArray(v)) return v.length;
            if (isDict(v)) return Object.keys(v).length;
            throw new BuckyError("TypeError", `object of type '${typeName(v)}' has no len()`, 0);
        }),
        range: native("range", (a) => {
            let start = 0, stop = 0, step = 1;
            if (a.length === 1) stop = a[0];
            else if (a.length >= 2) { start = a[0]; stop = a[1]; if (a.length >= 3) step = a[2]; }
            if (step === 0) throw new BuckyError("ValueError", "range() step must not be zero", 0);
            const out = [];
            if (step > 0) for (let k = start; k < stop; k += step) { if (out.length > interp.limits.range) break; out.push(k); }
            else for (let k = start; k > stop; k += step) { if (out.length > interp.limits.range) break; out.push(k); }
            return out;
        }),
        str: native("str", (a) => (a.length ? pyStr(a[0]) : "")),
        repr: native("repr", (a) => pyRepr(a[0])),
        int: native("int", (a) => {
            const v = a[0];
            if (typeof v === "boolean") return v ? 1 : 0;
            const n = parseInt(v, a[1] || 10);
            if (Number.isNaN(n)) throw new BuckyError("ValueError", `invalid literal for int(): '${pyStr(v)}'`, 0);
            return n;
        }),
        float: native("float", (a) => {
            const n = parseFloat(a[0]);
            if (Number.isNaN(n)) throw new BuckyError("ValueError", `could not convert to float: '${pyStr(a[0])}'`, 0);
            return n;
        }),
        bool: native("bool", (a) => truthy(a[0])),
        list: native("list", (a) => (a.length ? Array.from(interp.toIterable(a[0], 0)) : [])),
        dict: native("dict", (a) => (a.length && isDict(a[0]) ? { ...a[0] } : {})),
        abs: native("abs", (a) => Math.abs(a[0])),
        round: native("round", (a) => (a.length > 1 ? Number(a[0].toFixed(a[1])) : Math.round(a[0]))),
        min: native("min", (a) => reduceNums(a, "min")),
        max: native("max", (a) => reduceNums(a, "max")),
        sum: native("sum", (a) => { const l = a[0] || []; return l.reduce((s, x) => s + x, a.length > 1 ? a[1] : 0); }),
        sorted: native("sorted", (a, kw) => { const l = Array.from(interp.toIterable(a[0], 0)); sortInPlace(l, kw); return l; }),
        reversed: native("reversed", (a) => Array.from(interp.toIterable(a[0], 0)).reverse()),
        enumerate: native("enumerate", (a) => {
            const l = Array.from(interp.toIterable(a[0], 0));
            const start = a.length > 1 ? a[1] : 0;
            return l.map((x, i) => [i + start, x]);
        }),
        zip: native("zip", (a) => {
            const lists = a.map((x) => Array.from(interp.toIterable(x, 0)));
            const n = Math.min(...lists.map((l) => l.length));
            for (let i = 0; i < n; i++) out.push(lists.map((l) => l[i]));
            return out;
        }),
        type: native("type", (a) => typeName(a[0])),
        input: INPUT
    };
}
function reduceNums(args, mode) {
    let list = args;
    if (args.length === 1 && Array.isArray(args[0])) list = args[0];
    if (!list.length) throw new BuckyError("ValueError", `${mode}() arg is an empty sequence`, 0);
    return list.reduce((acc, x) => (mode === "min" ? (x < acc ? x : acc) : (x > acc ? x : acc)));
}

// ============================================================================
// 5. PUBLIC ENTRY
// ============================================================================

/** Build the normalized { ok, output, error, errorInfo } result envelope. */
function buildResult(interp, error) {
    if (!error || error instanceof ReturnSignal) {
        return { ok: true, output: interp.output, error: null, errorInfo: null };
    }
    const info = toErrorInfo(error);
    const errorLine = info.line
        ? `Line ${info.line}: ${info.type}: ${info.problem}`
        : `${info.type}: ${info.problem}`;
    return { ok: false, output: interp.output, error: errorLine, errorInfo: info };
}

/**
 * Run a pseudo-Python source string to completion (non-interactive driver).
 *
 * The evaluator is a generator so it can suspend at input(); this driver
 * resolves those suspensions synchronously:
 *   - options.inputs    a string[] queue consumed in order (great for tests)
 *   - options.onInput   (prompt) => string, a synchronous supplier
 * With neither, hitting input() yields a clean, displayed error directing the
 * operator to the interactive Terminal — so BuckyCode "Run" never hangs.
 */
export function runPython(source, options = {}) {
    const interp = new Interpreter(options);
    const inputs = Array.isArray(options.inputs) ? options.inputs.slice() : null;
    const gen = interp.run(source);
    try {
        let res = gen.next();
        while (!res.done) {
            const req = res.value || {};
            let value;
            if (inputs && inputs.length) value = inputs.shift();
            else if (typeof options.onInput === "function") value = options.onInput(req.prompt || "");
            else {
                throw new BuckyError(
                    "NotImplementedError",
                    "input() is only available when a script is run in the interactive Terminal",
                    req.line || 0
                );
            }
            res = gen.next(value);
        }
        return buildResult(interp, null);
    } catch (error) {
        return buildResult(interp, error);
    }
}

/**
 * Create an interactive script session (pausable driver, Phase 4.4, Part 4).
 *
 * Returns a controller the host (the Terminal) drives step by step:
 *   start()        -> begin execution; runs until the first input() or the end
 *   provide(line)  -> resume a suspended run with the typed line
 * Each step returns:
 *   { status:"input", prompt, line }   suspended at input() — show the prompt
 *   { status:"done",  result }         finished; result is the run envelope
 * Output streams live through options.stdout as it is produced.
 */
export function createScriptSession(source, options = {}) {
    const interp = new Interpreter(options);
    const gen = interp.run(source);
    let finished = false;

    function step(input) {
        if (finished) return { status: "done", result: buildResult(interp, null) };
        try {
            const res = gen.next(input);
            if (res.done) {
                finished = true;
                return { status: "done", result: buildResult(interp, null) };
            }
            const req = res.value || {};
            return { status: "input", prompt: req.prompt || "", line: req.line || 0 };
        } catch (error) {
            finished = true;
            return { status: "done", result: buildResult(interp, error) };
        }
    }

    return {
        start: () => step(undefined),
        provide: (line) => step(line),
        get output() { return interp.output; },
        get finished() { return finished; }
    };
}

function toErrorInfo(error) {
    if (error instanceof BuckyError || error instanceof SyntaxErr) {
        return {
            type: error.buckyType || "Error",
            line: error.line || 0,
            problem: error.message,
            name: error.varName || null
        };
    }
    return {
        type: "RuntimeError",
        line: 0,
        problem: (error && error.message) || "unknown runtime fault",
        name: null
    };
}

// Exposed for headless testing / future tooling. Not used by the VM UI.
export const __internals = { tokenize, Parser, Interpreter };
