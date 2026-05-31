/**
 * Script argument parser — Phase 4.4 continuation (Task 3).
 *
 * Builds the script-facing `args` value. It is a real list of the POSITIONAL
 * arguments (so existing scripts keep working: `args[0]`, `len(args)`,
 * `for a in args`), with a small flag-aware parser attached as own methods —
 * resolved by the interpreter's own-function-property fallback in getAttr:
 *
 *   args.raw()            -> every original token (flags included)
 *   args.has("--verbose") -> True when the flag is present (bare or key:val)
 *   args.get("--user")    -> value for --user:VALUE / --user=VALUE / --user VAL
 *   args.get("--x", "d")  -> default "d" when absent
 *   args.flags()          -> the flag tokens present
 *   args.positional()     -> the positional arguments (same as iterating args)
 *
 * Recognised flag forms:  --flag   --key:value   --key=value   --key value
 * The methods use the interpreter's native calling convention (argsArray, ...).
 */

function isFlag(token) {
    return token.length > 1 && token[0] === "-";
}

export function buildArgs(rawList) {
    const raw = (Array.isArray(rawList) ? rawList : []).map(String);
    const positionals = raw.filter((t) => !isFlag(t));
    const arr = positionals.slice();

    function valueFor(key) {
        const k = String(key);
        for (let i = 0; i < raw.length; i++) {
            const t = raw[i];
            if (t === k) {
                // --key value (space form) takes the next non-flag token;
                // otherwise it is a bare boolean flag.
                if (i + 1 < raw.length && !isFlag(raw[i + 1])) return raw[i + 1];
                return true;
            }
            if (t.startsWith(k + ":")) return t.slice(k.length + 1);
            if (t.startsWith(k + "=")) return t.slice(k.length + 1);
        }
        return undefined;
    }

    arr.raw = () => raw.slice();
    arr.has = (a) => {
        const k = String(a && a[0] != null ? a[0] : "");
        return raw.some((t) => t === k || t.startsWith(k + ":") || t.startsWith(k + "="));
    };
    arr.get = (a) => {
        const v = valueFor(a && a[0] != null ? a[0] : "");
        if (v === undefined || v === true) return a && a.length > 1 ? a[1] : null;
        return v;
    };
    arr.flags = () => raw.filter(isFlag);
    arr.positional = () => positionals.slice();

    // Internal (JS-side) — used by describe() to auto-show help.
    arr.hasHelp = raw.includes("--help") || raw.includes("-h");
    return arr;
}

/**
 * Build the describe() builtin bound to a parsed args list. When the script is
 * run with --help / -h it prints a NAME / DESCRIPTION / USAGE / OPTIONS block
 * and raises the clean exit signal; otherwise it is a no-op that returns the
 * metadata (so the script continues).
 */
export function makeDescribe(argsObj, scriptExit) {
    return (callArgs, kwargs, interp) => {
        const meta = callArgs && callArgs[0] && typeof callArgs[0] === "object" && !Array.isArray(callArgs[0])
            ? callArgs[0] : {};
        if (!argsObj.hasHelp) return meta;
        const name = meta.name || "script";
        interp.print("NAME        " + name);
        if (meta.description) interp.print("DESCRIPTION " + meta.description);
        if (meta.version) interp.print("VERSION     " + meta.version);
        interp.print("USAGE       " + (meta.usage || (name + " [options]")));
        const opts = meta.options;
        if (Array.isArray(opts) && opts.length) {
            interp.print("OPTIONS     " + opts.map(String).join("  "));
        } else if (opts && typeof opts === "object") {
            interp.print("OPTIONS");
            Object.keys(opts).forEach((k) => interp.print("  " + k + "   " + opts[k]));
        }
        throw scriptExit;
    };
}
