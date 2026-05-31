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

/** Wrap a positional implementation into the interpreter's native calling form. */
export function def(impl) {
    const wrapped = (args, kwargs, interp) => impl.apply(null, args || []);
    return wrapped;
}

/** Like def() but the implementation also receives ({ kwargs, interp }). */
export function defEx(impl) {
    return (args, kwargs, interp) => impl(args || [], kwargs || {}, interp);
}

/** Build a namespace/module object the interpreter can import + attribute-read. */
export function mod(name, members) {
    return Object.assign({ __module__: true, __name__: name }, members);
}

/** A member that always raises NotImplemented (interface-only seams). */
export function notImplemented(label, message) {
    return () => {
        const err = new Error(message || `${label} is not available yet`);
        err.buckyType = "NotImplementedError";
        throw err;
    };
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
