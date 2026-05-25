/**
 * GatewayClient — the VM's network abstraction to the backend gateway.
 *
 * Phase 4.1 (Part 11). This is the FIRST real network layer of the VM. Until
 * now every VM page was local; the browser resolved bucky:// content entirely
 * in-process. The dev-post feed is the first content that lives in the
 * backend, so the VM needs exactly one, minimal, well-behaved way to read it.
 *
 * ARCHITECTURE RULES this module exists to keep (docs/phase4/01-ownership-matrix):
 *   - The VM is a CONSUMER ONLY. This client performs reads; it never writes.
 *   - The VM never holds a DB connection or credentials. It only ever talks to
 *     the backend gateway over HTTP. There is NO database logic here.
 *   - The VM never reaches the Discord bot or MySQL directly.
 *
 * DESIGN:
 *   - Thin wrapper over `fetch`. DOM-free. GitHub-Pages-safe (static module).
 *   - It NEVER throws into the UI: every call resolves to a result envelope
 *     `{ ok, status, error, data }`, so callers render graceful loading /
 *     error states instead of crashing the VM sandbox.
 *   - Timeout-guarded via AbortController so a hanging backend cannot freeze
 *     a VM page load.
 *
 * FUTURE SEAMS (prepared, deliberately not built — Phase 4.1 Part 11/12):
 *   - Auth: `request()` accepts `headers` and `credentials`; when the VM gains
 *     a session, an auth token is attached here and nowhere else.
 *   - Realtime: a websocket / subscribe channel would be added here as a
 *     sibling of `request()`. Phase 4.1 is request/response only — no sockets.
 *   - Caching: responses could be memoised here without any caller change.
 *
 * CONFIGURATION:
 *   The backend base URL defaults to the production gateway. An embedding page
 *   (e.g. site/vm/vm-test.html, or a local dev harness) may override it by
 *   setting `window.BUCKY_API_BASE` before the VM boots.
 */

/** Production backend gateway (matches site/js/config.js). */
const DEFAULT_BASE = "https://api.buckybot.app";

/** Default per-request timeout (ms). Kept short — VM pages must stay snappy. */
const DEFAULT_TIMEOUT = 8000;

/** Resolve the backend base URL, honouring an embedder override. */
function resolveBase() {
    if (typeof window !== "undefined" && window.BUCKY_API_BASE) {
        return String(window.BUCKY_API_BASE).replace(/\/+$/, "");
    }
    return DEFAULT_BASE;
}

/**
 * Perform one backend request.
 *
 * Always resolves (never rejects) to:
 *   { ok:boolean, status:number, error:string|null, data:object|null }
 *
 * @param {string} path     path beginning with "/", e.g. "/api/devposts"
 * @param {object} [options]
 * @param {string} [options.method="GET"]
 * @param {object} [options.headers]      extra headers (future-auth seam)
 * @param {string} [options.credentials="omit"]  fetch credentials mode
 * @param {number} [options.timeout]      per-request timeout in ms
 */
async function request(path, options = {}) {
    const url = resolveBase() + String(path || "");

    // No fetch (very old / non-browser host) — fail gracefully, never throw.
    if (typeof fetch !== "function") {
        return { ok: false, status: 0, error: "fetch unavailable", data: null };
    }

    const controller =
        typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = options.timeout || DEFAULT_TIMEOUT;
    const timer = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    try {
        const response = await fetch(url, {
            method: options.method || "GET",
            headers: { Accept: "application/json", ...(options.headers || {}) },
            // Future-auth seam: defaults to "omit" — public content needs no
            // credentials. Flip to "include" once the VM carries a session.
            credentials: options.credentials || "omit",
            signal: controller ? controller.signal : undefined,
        });

        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                error: `backend responded ${response.status}`,
                data: null,
            };
        }

        let data = null;
        try {
            data = await response.json();
        } catch (_parseError) {
            return {
                ok: false,
                status: response.status,
                error: "malformed backend response",
                data: null,
            };
        }
        return { ok: true, status: response.status, error: null, data };
    } catch (networkError) {
        const aborted = networkError && networkError.name === "AbortError";
        return {
            ok: false,
            status: 0,
            error: aborted
                ? "backend request timed out"
                : (networkError && networkError.message) || "network error",
            data: null,
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// Content reads — the VM-facing surface (read-only, Phase 4.1 Part 7/8)
// ---------------------------------------------------------------------------

/** Fetch the public dev-post feed. Resolves to a request envelope. */
function fetchDevPosts() {
    return request("/api/devposts");
}

/** Fetch featured / pinned dev posts. Resolves to a request envelope. */
function fetchFeaturedDevPosts() {
    return request("/api/devposts/featured");
}

/** Fetch a single dev post by numeric id or slug. Resolves to a request envelope. */
function fetchDevPost(ref) {
    return request("/api/devposts/" + encodeURIComponent(String(ref || "")));
}

/**
 * The shared GatewayClient instance. The VM has exactly one backend; one
 * client is enough. Import it where backend content is needed.
 */
export const gatewayClient = {
    base: resolveBase,
    request,
    fetchDevPosts,
    fetchFeaturedDevPosts,
    fetchDevPost,
};
