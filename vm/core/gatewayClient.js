/**
 * GatewayClient — the VM's network abstraction to the backend gateway.
 *
 * Phase 4.1 (Part 11) built this as the FIRST real network layer of the VM:
 * a thin, well-behaved `fetch` wrapper for the dev-post feed. Phase 4.2 extends
 * it - additively - with the shared world-content read surface
 * (announcements, incidents, world events, broadcasts, maintenance, leaks),
 * which the new bucky://news site consumes.
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
 * SOFT REFRESH (Phase 4.2):
 *   This client stays a stateless transport. The lightweight refresh lifecycle
 *   - TTL-based feed invalidation, re-fetch without a full VM reload - lives in
 *     the site module that owns the feed state (site/vm/apps/browser/sites/
 *     news.js). `SOFT_REFRESH_TTL` is exported here as the single shared
 *     default so every feed module ages its cache consistently.
 *
 * FUTURE SEAMS (prepared, deliberately not built):
 *   - Auth: `request()` accepts `headers` and `credentials`; when the VM gains
 *     a session, an auth token is attached here and nowhere else.
 *   - Realtime: a websocket / subscribe channel would be added here as a
 *     sibling of `request()`. Phase 4.2 is request/response only — no sockets.
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

/**
 * Shared soft-refresh TTL (ms). A feed older than this is considered stale and
 * a feed module may quietly re-fetch it in the background. Exported so every
 * feed ages consistently; the refresh lifecycle itself lives in the feed
 * module, not here.
 */
const SOFT_REFRESH_TTL = 60000;

/** Resolve the backend base URL, honouring an embedder override. */
function resolveBase() {
    if (typeof window !== "undefined" && window.BUCKY_API_BASE) {
        return String(window.BUCKY_API_BASE).replace(/\/+$/, "");
    }
    return DEFAULT_BASE;
}

/**
 * Phase 4.3 — Bearer-token auth seam.
 *
 * The arcade flow (site/js/dashboard.js) holds an API token in localStorage
 * and attaches it as `Authorization: Bearer ...` on every site fetch. The VM
 * runs in the same browsing context but its gateway client used to rely only
 * on the cross-origin session cookie (`credentials: "include"`), which many
 * browsers drop in third-party / cross-origin contexts. The result was the
 * VM's `/api/player/me` call returning 401 even for fully-authenticated
 * operators ("anonymous visitor — no identity is bound to this VM yet").
 *
 * `setAuthToken(token)` is the additive fix: the embedder (arcade.js, or
 * vmRuntime when it receives a `user.api_token`) calls it once after login
 * and every subsequent gateway request carries the token. Same trust model
 * as the rest of the site; same `api_login_required` decorator on the
 * backend resolves it.
 *
 * Token storage is in-module — never persisted, never read from localStorage
 * by the gateway itself (the gateway stays portable across embedders).
 */
let _bearerToken = null;
function setAuthToken(token) {
    _bearerToken = token ? String(token) : null;
}
function clearAuthToken() {
    _bearerToken = null;
}
function hasAuthToken() {
    return Boolean(_bearerToken);
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

    // Compose headers: caller-supplied first, then the Phase 4.3 Bearer
    // header if a token has been set via `setAuthToken`. The caller may still
    // override `Authorization` explicitly by passing it in options.headers.
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (_bearerToken && !headers.Authorization && !headers.authorization) {
        headers.Authorization = "Bearer " + _bearerToken;
    }

    // Phase 5.0A — JSON body support (the mail platform is the VM's first WRITE
    // surface: send / mark-read are POSTs). A body is serialised to JSON and the
    // Content-Type set unless the caller already provided one.
    let bodyPayload;
    if (options.body !== undefined && options.body !== null) {
        bodyPayload = typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body);
        if (!headers["Content-Type"] && !headers["content-type"]) {
            headers["Content-Type"] = "application/json";
        }
    }

    try {
        const response = await fetch(url, {
            method: options.method || "GET",
            headers,
            // When a Bearer token is set, the gateway is operator-authenticated.
            // Default to `include` so the session cookie also flows on
            // same-site setups; the explicit `omit` request still wins when
            // an unauthenticated public read is intended.
            credentials: options.credentials
                || (_bearerToken ? "include" : "omit"),
            body: bodyPayload,
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
// Dev-post reads — Phase 4.1 surface (read-only)
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

// ---------------------------------------------------------------------------
// World-content reads — Phase 4.2 surface (read-only, shared multi-domain)
// ---------------------------------------------------------------------------

/** Fetch the combined public world-content feed (every domain). */
function fetchWorldContent() {
    return request("/api/worldcontent");
}

/**
 * Fetch one world-content domain's public feed.
 * @param {string} domain  e.g. "announcement" | "incident" | "broadcast"
 */
function fetchWorldContentDomain(domain) {
    return request("/api/worldcontent/" + encodeURIComponent(String(domain || "")));
}

/**
 * Fetch the announcements feed — the proven Phase 4.2 world-content domain
 * rendered live at bucky://news.
 */
function fetchAnnouncements() {
    return fetchWorldContentDomain("announcement");
}

/** Fetch a single world-content item by (domain, numeric id | slug). */
function fetchWorldContentItem(domain, ref) {
    return request(
        "/api/worldcontent/" + encodeURIComponent(String(domain || "")) +
        "/" + encodeURIComponent(String(ref || ""))
    );
}

// ---------------------------------------------------------------------------
// Phase 4.3 — player identity surface (read-only)
// ---------------------------------------------------------------------------
// All identity-aware VM pages (bucky://profile, bucky://organizations,
// bucky://leaderboards, bucky://pulse) consume this surface. Two flavours:
//   * unauthenticated public projections — `/api/player/public/<id>`, the
//     `/api/player/organizations` list, the per-org views;
//   * the self view — `/api/player/me`, which requires the OAuth session.
// The self-view request uses `credentials: "include"` so the browser sends
// the existing session cookie. Public reads stay credential-free for
// cacheability and to keep the architecture's read-only contract obvious.

/** Fetch the current operator's self-view (login required, sensitive fields). */
function fetchSelfPlayer() {
    return request("/api/player/me", { credentials: "include" });
}

/** Fetch a public player projection (no auth — public read-model). */
function fetchPublicPlayer(userId) {
    return request("/api/player/public/" + encodeURIComponent(String(userId || "")));
}

/** Fetch the static organisation registry (4 founding orgs + member counts). */
function fetchOrganizations() {
    return request("/api/player/organizations");
}

/** Fetch one organisation by slug. */
function fetchOrganization(slug) {
    return request("/api/player/organization/" + encodeURIComponent(String(slug || "")));
}

/** Fetch the calling operator's organisation (login required). */
function fetchMyOrganization() {
    return request("/api/player/organization/me", { credentials: "include" });
}

/**
 * One page of YOUR organisation's leak archive (login required).
 *
 * The org is never a parameter — the backend reads it from the session, and
 * that is the whole access rule for this table. `cursor` is the `next_cursor`
 * of the previous page, straight back as query parameters; there is no offset,
 * because ten thousand rows with an offset is ten thousand rows read.
 */
function fetchOrgLeaks(opts) {
    const o = opts || {};
    const q = new URLSearchParams();
    if (o.sort) q.set("sort", String(o.sort));
    if (o.victim_org) q.set("victim_org", String(o.victim_org));
    if (o.victim_id) q.set("victim_id", String(o.victim_id));
    if (o.code) q.set("code", String(o.code));
    if (o.limit) q.set("limit", String(o.limit));
    const c = o.cursor || null;
    if (c) {
        if (c.leaked_at) q.set("after_leaked_at", String(c.leaked_at));
        if (c.id) q.set("after_id", String(c.id));
        if (c.revealed_count !== undefined && c.revealed_count !== null) {
            q.set("after_revealed", String(c.revealed_count));
        }
    }
    const qs = q.toString();
    return request("/api/org/leaks" + (qs ? "?" + qs : ""), { credentials: "include" });
}

// ---------------------------------------------------------------------------
// Phase 4.3 — leaderboards (read-only public projections)
// ---------------------------------------------------------------------------
/** Fetch every known leaderboard (top-N each). */
function fetchLeaderboards(limitPerKind) {
    const q = limitPerKind ? "?limit=" + encodeURIComponent(String(limitPerKind)) : "";
    return request("/api/leaderboards" + q);
}

/** Fetch one leaderboard kind (richest | level | org-reputation | most-leaked). */
function fetchLeaderboard(kind, limit) {
    const q = limit ? "?limit=" + encodeURIComponent(String(limit)) : "";
    return request("/api/leaderboards/" + encodeURIComponent(String(kind || "")) + q);
}

// ---------------------------------------------------------------------------
// Phase 4.3 - leak engine (public reads only; Owner triggers go through the
// Discord bot, never the VM)
// ---------------------------------------------------------------------------
/** Fetch recent exposures across the Grid (public, masked-only). */
function fetchRecentLeaks(limit) {
    const q = limit ? "?limit=" + encodeURIComponent(String(limit)) : "";
    return request("/api/leaks/recent" + q);
}

/** Fetch the caller\'s own exposure history (login required). */
function fetchMyLeaks(limit) {
    const q = limit ? "?limit=" + encodeURIComponent(String(limit)) : "";
    return request("/api/leaks/me" + q, { credentials: "include" });
}

// ---------------------------------------------------------------------------
// Phase 4.3 OSINT expansion — the live Leak Database (read-only).
// All powered by REAL player_exposures via the backend osint_service.
// Mixed auth: stats and the incident INDEX are aggregates and stay anonymous;
// the operator window and one incident's DETAIL carry resolved identities and
// are login-gated, so those two send credentials.
// ---------------------------------------------------------------------------
// `test` (a positive integer) switches any read to the fictional simulation
// dataset (the `+leaks test N` tooling) — visualisation only, never the DB.
function _qs(parts) {
    const kv = Object.entries(parts).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== 0);
    return kv.length ? "?" + kv.map(([k, v]) => k + "=" + encodeURIComponent(String(v))).join("&") : "";
}

/** Headline statistics for bucky://leaks (incidents, operators, severity, ...). */
function fetchLeakStats(test) {
    return request("/api/leaks/stats" + _qs({ test }));
}

/** The incident index — one entry per real leak incident, newest first. */
function fetchLeakIncidents(test) {
    return request("/api/leaks/incidents" + _qs({ test }));
}

/**
 * One incident + a page of its affected operators (lazy detail load).
 * Login required — see the note on fetchLeakOperators.
 */
function fetchLeakIncident(incidentId, page, test) {
    return request(
        "/api/leaks/incident/" + encodeURIComponent(String(incidentId || "")) + _qs({ page, test }),
        { credentials: "include" }
    );
}

/**
 * The bounded exposed-operator window the VM browses client-side.
 *
 * Login required. These two reads used to be anonymous, but they resolve the
 * operator's handle and email from the real Discord username, so the backend now
 * gates them with `api_login_required`. `credentials: "include"` is what makes an
 * operator who is signed in but has no localStorage api_token (the Bearer seam
 * below is only primed when the VM is mounted with one) still authenticate, via
 * the session cookie — same as every other gated call in this module.
 */
function fetchLeakOperators(limit, test) {
    return request("/api/leaks/operators" + _qs({ limit, test }), { credentials: "include" });
}

// ---------------------------------------------------------------------------
// Phase 5.0A — Mail Platform surface (the VM's first authenticated WRITE path).
// All login-gated; the operator's own address is passed so the backend can
// resolve their inbox (cross-user mail is addressed by email, recipient_user_id
// is NULL). All resolve to the standard { ok, status, error, data } envelope.
// ---------------------------------------------------------------------------
function fetchMailInbox(address) {
    return request("/api/vm/mail/inbox" + _qs({ address }), { credentials: "include" });
}
function fetchMailSent(address) {
    return request("/api/vm/mail/sent" + _qs({ address }), { credentials: "include" });
}
function fetchMailMessage(messageId, address) {
    return request(
        "/api/vm/mail/message/" + encodeURIComponent(String(messageId)) + _qs({ address }),
        { credentials: "include" }
    );
}
function fetchMailAttachment(attachmentId) {
    return request("/api/vm/mail/attachment/" + encodeURIComponent(String(attachmentId)), { credentials: "include" });
}
function sendMail(payload) {
    return request("/api/vm/mail/send", { method: "POST", body: payload || {}, credentials: "include" });
}
function markMailRead(messageId, read, address) {
    return request(
        "/api/vm/mail/message/" + encodeURIComponent(String(messageId)) + "/read",
        { method: "POST", body: { read: read !== false, address }, credentials: "include" }
    );
}

/**
 * The shared GatewayClient instance. The VM has exactly one backend; one
 * client is enough. Import it where backend content is needed.
 */
export const gatewayClient = {
    base: resolveBase,
    request,
    // Phase 4.3 - Bearer-token auth seam (additive).
    setAuthToken,
    clearAuthToken,
    hasAuthToken,
    softRefreshTtl: SOFT_REFRESH_TTL,
    // Phase 4.1 - dev posts
    fetchDevPosts,
    fetchFeaturedDevPosts,
    fetchDevPost,
    // Phase 4.2 - shared world content
    fetchWorldContent,
    fetchWorldContentDomain,
    fetchAnnouncements,
    fetchWorldContentItem,
    // Phase 4.3 - identity surface
    fetchSelfPlayer,
    fetchPublicPlayer,
    fetchOrganizations,
    fetchOrganization,
    fetchMyOrganization,
    // v3 blok 3 - de eigen leakarchief van je organisatie
    fetchOrgLeaks,
    // Phase 4.3 - leaderboards
    fetchLeaderboards,
    fetchLeaderboard,
    // Phase 4.3 - leaks
    fetchRecentLeaks,
    fetchMyLeaks,
    // Phase 4.3 OSINT expansion - live Leak Database
    fetchLeakStats,
    fetchLeakIncidents,
    fetchLeakIncident,
    fetchLeakOperators,
    // Phase 5.0A - Mail Platform (authenticated reads + writes)
    fetchMailInbox,
    fetchMailSent,
    fetchMailMessage,
    fetchMailAttachment,
    sendMail,
    markMailRead,
};
