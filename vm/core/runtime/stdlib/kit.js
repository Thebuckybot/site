/**
 * Standard-library kit — shared helpers for bucky.* modules (Phase 4.4).
 *
 * The interpreter calls a native module member as `fn(argsArray, kwargs,
 * interp)`. Authoring every member against that low-level shape is noisy, so
 * `def()` adapts a friendly positional implementation to it. `mod()` stamps a
 * module object with the namespace marker the interpreter recognises.
 *
 * Pure data — DOM-free, network-free.
 */

/**
 * Wrap a positional implementation into the interpreter's native calling form.
 *
 * `opts.raises` marks a member that ALWAYS throws even though it has a real
 * body — `economy.transfer` and `hackbank.run` route through the Discord
 * bridge, which raises until the write path lands. Without the marker the
 * generated docs page presents them as ordinary calls, which is the one thing
 * a generated page must never do.
 */
export function def(impl, opts) {
    const wrapped = (args, kwargs, interp) => impl.apply(null, args || []);
    if (opts && opts.raises) {
        wrapped.__notImplemented__ = true;
        wrapped.__reason__ = opts.raises;
    }
    return wrapped;
}

/** Like def() but the implementation also receives ({ kwargs, interp }). */
export function defEx(impl) {
    return (args, kwargs, interp) => impl(args || [], kwargs || {}, interp);
}

/** Build a namespace/module object the interpreter can import + attribute-read. */
export function mod(name, members) {
    const m = Object.assign({ __module__: true, __name__: name }, members);
    // Stamp each callable member with a qualified pyName ("profile.level") so
    // reflection (help(profile.level), help(menu.show), help(leaderboards.richest))
    // can map a bound function back to its module.method. Interactive widgets
    // already carry an explicit pyName; never overwrite it. Phase 4.5B help-system.
    const short = String(name || "").replace(/^bucky\./, "");
    Object.keys(members || {}).forEach((key) => {
        const v = m[key];
        if (v && typeof v === "function" && !v.pyName) {
            try { v.pyName = short + "." + key; } catch (_e) { /* frozen fn - ignore */ }
        }
    });
    return m;
}

/**
 * A member that always raises NotImplemented (interface-only seams).
 *
 * The returned function CARRIES A MARKER. Without it, a member that always
 * raises is indistinguishable from one that works until you call it — and the
 * docs page generated from the live module table would then promise a surface
 * that answers with an exception. `label` and `message` ride along so the page
 * can print the real reason instead of a generic one.
 */
export function notImplemented(label, message) {
    const fn = () => {
        const err = new Error(message || `${label} is not available yet`);
        err.buckyType = "NotImplementedError";
        throw err;
    };
    fn.__notImplemented__ = true;
    fn.__reason__ = message || `${label} is not available yet`;
    return fn;
}

/** Raise a typed BuckyError-compatible error from inside a native member. */
export function raise(type, message, name) {
    const err = new Error(message);
    err.buckyType = type;
    if (name) err.varName = name;
    throw err;
}

/** Coerce a snapshot list field defensively to an array. */
export function asList(value) {
    return Array.isArray(value) ? value : [];
}

/** Case-insensitive substring match used by the search helpers. */
export function matches(haystack, needle) {
    return String(haystack == null ? "" : haystack).toLowerCase().includes(String(needle == null ? "" : needle).toLowerCase());
}
