/**
 * Diagnostics — lightweight developer logging for the Bucky VM.
 *
 * Debug mode is opt-in. Production (the arcade page) never enables it, so
 * `debugLog` / `debugWarn` stay completely silent there — they do not affect
 * the production runtime. The standalone test harness (vm-test.html) enables
 * debug mode so filesystem activity and lifecycle events are visible.
 *
 * `logError` always logs: a caught exception is a real fault worth surfacing
 * even in production.
 */
let debugEnabled = false;

/** Enable or disable debug diagnostics. Called once by the runtime at boot. */
export function setDebugMode(enabled) {
    debugEnabled = Boolean(enabled);
}

export function isDebugMode() {
    return debugEnabled;
}

/** Verbose lifecycle/filesystem log. Silent unless debug mode is on. */
export function debugLog(...args) {
    if (debugEnabled) console.log("[BuckyVM]", ...args);
}

/** Non-fatal warning (e.g. a rejected filesystem operation). Silent unless debug mode is on. */
export function debugWarn(...args) {
    if (debugEnabled) console.warn("[BuckyVM]", ...args);
}

/** Real fault (a caught exception). Always logged, in every environment. */
export function logError(scope, error) {
    console.error(`[BuckyVM] ${scope}`, error);
}
