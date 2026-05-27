/**
 * profile.js — bucky://profile (Phase 4.3, Part 6).
 *
 * IDENTITY-AWARE OPERATOR DASHBOARD
 *   `bucky://profile` is the first identity-aware VM page. It shows the
 *   calling operator's own self-view: organisation affiliation, level /
 *   prestige / titles, achievements, economy summary (own balances), security
 *   posture, and — critically for Phase 4.3 — the immutable credential-leak
 *   exposure archive.
 *
 *   A separate route `bucky://profile/<user_id>` renders the public projection
 *   of another player. Same render pipeline, fewer fields, no sensitive data.
 *
 * READ-ONLY BY CONSTRUCTION
 *   Both routes consume `/api/player/*`. There is no write path — Phase 4.3's
 *   identity foundation made the bot the sole authoritative writer of
 *   `profiles`, and this VM page honours that. Changes (rotate bank code,
 *   choose organisation, equip title) all flow through Discord.
 *
 * SOFT-REFRESH LIFECYCLE
 *   The page maintains a small per-route cache `{ status, item, fetchedAt }`.
 *   Each render triggers `maybeSoftRefresh()`; older-than-TTL caches
 *   re-fetch in the background, the current render is instant. Mirrors the
 *   Phase 4.2 worldfeed pattern.
 *
 * ARCHITECTURE PRESERVED
 *   - SiteRegistry / EventBus / browser runtime untouched.
 *   - render() stays synchronous and pure — fetch is fire-and-forget.
 *   - All authored text is HTML-escaped via the shared site kit.
 *
 * GRACEFUL DEGRADATION
 *   * /api/player/me returns first_run:true   → "no profile yet" panel.
 *   * /api/player/me returns 401              → "login on Discord to view".
 *   * backend offline                          → fallback frame with the
 *                                                "connect to BuckyNet first"
 *                                                message. Page never crashes.
 */
import { escapeHtml, link, chip, sitePage, crossRefs } from "./kit.js";
import { gatewayClient } from "../../../core/gatewayClient.js";

const SITE = "profile";
const SITE_URL = "bucky://profile";
const SITE_DOMAIN = "Operator Profile";

const TTL = gatewayClient.softRefreshTtl || 60000;

// Per-instance caches keyed by route. The "me" key holds the self-view.
const cache = {
    me: { status: "idle", item: null, error: null, fetchedAt: 0, inflight: false, firstRun: false, unauthenticated: false },
    publicById: new Map(),  // user_id -> { status, item, fetchedAt, inflight }
};

// ---------------------------------------------------------------------------
// Self-view
// ---------------------------------------------------------------------------
function renderSelfProfile() {
    maybeRefreshSelf();
    const c = cache.me;

    if (c.unauthenticated) return renderLoggedOut();
    if (c.firstRun) return renderFirstRun();
    if (c.status === "offline") return renderOffline();
    if (c.status === "idle" || c.status === "loading") return renderLoading();
    if (!c.item) return renderOffline();

    const view = c.item;
    const org = view.organization;

    const banner = `
        <header class="vm-profile-banner">
            <div class="vm-profile-banner-id">
                <div class="vm-profile-avatar" aria-hidden="true">${escapeHtml(initial(view))}</div>
                <div class="vm-profile-identity">
                    <div class="vm-profile-name">Operator <code>${escapeHtml(String(view.user_id))}</code></div>
                    <div class="vm-profile-title">${escapeHtml(view.equipped_title || "no equipped title")}</div>
                </div>
            </div>
            <div class="vm-profile-banner-meta">
                <span class="vm-site-chip">Level ${escapeHtml(String(view.level || 1))}</span>
                <span class="vm-site-chip">Prestige ${escapeHtml(String(view.prestige || 0))}</span>
                ${org ? `<span class="vm-site-chip" style="color:#10E0C8;">${escapeHtml(org.emblem || "")} ${escapeHtml(org.name || "")}</span>` : `<span class="vm-site-chip">Unaffiliated</span>`}
            </div>
        </header>
    `;

    const economy = `
        <section class="vm-wiki-section vm-profile-block">
            <h2>Economy</h2>
            <div class="vm-profile-grid">
                ${statTile("Coins", String(view.coins || 0))}
                ${statTile("Bank", String(view.bank || 0))}
                ${statTile("Bank limit", String(view.bank_limit || 0))}
                ${statTile("Net worth", String(view.networth || 0))}
            </div>
        </section>
    `;

    const inventory = `
        <section class="vm-wiki-section vm-profile-block">
            <h2>Inventory</h2>
            <div class="vm-profile-grid">
                ${statTile("Items", String(view.inventory_count || 0))}
                ${statTile("Active items", String(view.active_items_count || 0))}
                ${statTile("Achievements", String((view.achievements || []).length))}
                ${statTile("Titles", String((view.titles || []).length))}
            </div>
        </section>
    `;

    const security = `
        <section class="vm-wiki-section vm-profile-block">
            <h2>Security posture</h2>
            <div class="vm-profile-grid">
                ${statTile("Bank code", (view.security || {}).bank_code_set ? "rotated" : "default ⚠")}
                ${statTile("Firewall", String((view.security || {}).firewall_level || 0))}
                ${statTile("Breached", (view.security || {}).breached ? "yes" : "no")}
                ${statTile("Alert", (view.security || {}).alert_triggered ? "active" : "—")}
            </div>
            <p class="vm-leak-cred-note">
                Rotate your bank code in Discord with <code>/setbankcode</code> if it is still the default.
                A weak code raises the chance the leak engine will fingerprint your operator on its next run.
            </p>
        </section>
    `;

    const orgBlock = org ? `
        <section class="vm-wiki-section vm-profile-block">
            <h2>Organisation</h2>
            <div class="vm-profile-grid">
                ${statTile("Affiliation", `${escapeHtml(org.emblem || "")} ${escapeHtml(org.name || "")}`, true)}
                ${statTile("Rank", String(org.rank || "recruit"))}
                ${statTile("Reputation", String(org.reputation || 0))}
                ${statTile("Warnings", String(org.warnings != null ? org.warnings : 0))}
            </div>
            <div class="vm-leak-more">${link(`bucky://organizations/${escapeHtml(org.id || "")}`, "Open organisation page ›")}</div>
        </section>
    ` : `
        <section class="vm-wiki-section vm-profile-block">
            <h2>Organisation</h2>
            <p class="vm-dev-note">
                You haven't chosen an affiliation yet. Run <code>+chooseorg</code> in
                Discord — it's permanent, and gating commands require it.
            </p>
            <div class="vm-leak-more">${link("bucky://organizations", "Browse the founding organisations ›")}</div>
        </section>
    `;

    const exposures = view.exposures || [];
    const exposureBlock = `
        <section class="vm-wiki-section vm-profile-block">
            <h2>Exposure archive</h2>
            ${exposures.length === 0
                ? `<p class="vm-dev-note">No exposures on record. Either you've been lucky, or the engine hasn't ticked since you rotated.</p>`
                : `<div class="vm-leak-tablewrap"><table class="vm-leak-table">
                    <thead><tr><th>Snippet</th><th>Severity</th><th>Source</th><th>Logged</th></tr></thead>
                    <tbody>${exposures.map((e) => `
                        <tr>
                            <td class="vm-leak-cred">${escapeHtml(e.masked_credential || "")}</td>
                            <td>${chip(e.severity || "low")}</td>
                            <td>${e.incident_slug
                                ? link(`bucky://leaks/${escapeHtml(e.incident_slug)}`, e.incident_title || e.incident_slug)
                                : escapeHtml(e.incident_title || "—")}</td>
                            <td>${escapeHtml(formatDate(e.leaked_at))}</td>
                        </tr>
                    `).join("")}</tbody>
                </table></div>`
            }
            <p class="vm-leak-cred-note">
                Exposure rows are immutable. Rotating your bank code never deletes or rewrites historical leaks.
            </p>
        </section>
    `;

    const body = `
        <div class="vm-wiki-body">
            ${banner}
            ${orgBlock}
            ${economy}
            ${inventory}
            ${security}
            ${exposureBlock}
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://leaks", label: "Leak Database", note: "the public archive" },
                { url: "bucky://leaderboards", label: "Leaderboards", note: "where you rank" },
                { url: "bucky://organizations", label: "Organisations", note: "Grid factions" },
                { url: "bucky://pulse", label: "PulseNet", note: "live Grid state" }
            ])}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} · bucky://profile`,
        title: "Operator Profile",
        lead: "Your operator dashboard — read-only mirror of the Grid's state.",
        bodyHtml: body,
    });
}

// ---------------------------------------------------------------------------
// Public-projection of another player
// ---------------------------------------------------------------------------
function renderPublicProfile(userId) {
    maybeRefreshPublic(userId);
    const c = cache.publicById.get(userId);
    if (!c || c.status === "idle" || c.status === "loading") return renderLoading(userId);
    if (c.status === "missing") return renderUnknownOperator(userId);
    if (c.status === "offline") return renderOffline();
    const view = c.item || {};
    const org = view.organization;
    const body = `
        <div class="vm-wiki-body">
            <header class="vm-profile-banner">
                <div class="vm-profile-banner-id">
                    <div class="vm-profile-avatar" aria-hidden="true">${escapeHtml(initial(view))}</div>
                    <div class="vm-profile-identity">
                        <div class="vm-profile-name">Operator <code>${escapeHtml(String(view.user_id))}</code></div>
                        <div class="vm-profile-title">${escapeHtml(view.equipped_title || "no equipped title")}</div>
                    </div>
                </div>
                <div class="vm-profile-banner-meta">
                    <span class="vm-site-chip">Level ${escapeHtml(String(view.level || 1))}</span>
                    <span class="vm-site-chip">Prestige ${escapeHtml(String(view.prestige || 0))}</span>
                    ${org ? `<span class="vm-site-chip">${escapeHtml(org.emblem || "")} ${escapeHtml(org.name || "")}</span>` : ""}
                </div>
            </header>
            <section class="vm-wiki-section vm-profile-block">
                <h2>Public profile</h2>
                <div class="vm-profile-grid">
                    ${statTile("Achievements", String(view.achievements_count || 0))}
                    ${statTile("Titles", String((view.titles || []).length))}
                    ${statTile("Joined", view.joined ? formatDate(view.joined) : "—")}
                    ${statTile("Organisation", org ? `${escapeHtml(org.emblem || "")} ${escapeHtml(org.name || "")}` : "—", true)}
                </div>
                <p class="vm-leak-cred-note">
                    Public projections never reveal balances, inventory, security state or warnings.
                </p>
            </section>
            <div class="vm-leak-more">${link("bucky://profile", "‹ Back to your own profile")}</div>
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} · bucky://profile/${escapeHtml(String(userId))}`,
        title: "Operator " + String(userId),
        lead: "Public projection of an operator. No sensitive fields are exposed.",
        bodyHtml: body,
    });
}

// ---------------------------------------------------------------------------
// Fallback states
// ---------------------------------------------------------------------------
function renderLoggedOut() {
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} · bucky://profile`,
        title: "Operator Profile",
        lead: "Log in on Discord to see your operator profile here.",
        bodyHtml: `
            <div class="vm-wiki-body">
                <div class="vm-dev-feedstatus is-idle">
                    <span class="vm-dev-feeddot"></span>
                    You're browsing BuckyNet as an anonymous visitor — no identity is bound to this VM yet.
                </div>
                <p>To see your own profile, achievements and exposure archive, link your Bucky session via Discord.</p>
                <div class="vm-leak-more">${link("bucky://organizations", "Browse the founding organisations ›")}</div>
            </div>
        `,
    });
}

function renderFirstRun() {
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} · bucky://profile`,
        title: "No operator profile yet",
        lead: "Run /start in Discord to begin your operator career.",
        bodyHtml: `
            <div class="vm-wiki-body">
                <p>The Grid doesn't know you yet. Run <code>/start</code> in any Bucky-enabled Discord server to create your profile. The organisation chooser opens automatically right after.</p>
                <div class="vm-leak-more">${link("bucky://organizations", "Preview the founding organisations ›")}</div>
            </div>
        `,
    });
}

function renderOffline() {
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} · bucky://profile`,
        title: "Operator Profile",
        lead: "The Grid is briefly unreachable.",
        bodyHtml: `
            <div class="vm-wiki-body">
                <div class="vm-dev-feedstatus is-offline">
                    <span class="vm-dev-feeddot"></span>
                    Live profile feed offline — try again in a moment.
                </div>
            </div>
        `,
    });
}

function renderLoading(userId) {
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} · ${userId ? `bucky://profile/${escapeHtml(String(userId))}` : "bucky://profile"}`,
        title: "Operator Profile",
        lead: "Resolving operator…",
        bodyHtml: `
            <div class="vm-wiki-body">
                <div class="vm-dev-feedstatus is-loading">
                    <span class="vm-dev-feeddot"></span>
                    Loading profile from the Grid…
                </div>
            </div>
        `,
    });
}

function renderUnknownOperator(userId) {
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} · bucky://profile/${escapeHtml(String(userId))}`,
        title: "Operator not found",
        lead: "No operator on record for this id.",
        bodyHtml: `
            <div class="vm-wiki-body">
                <p>The Grid has no profile for <code>${escapeHtml(String(userId))}</code>.</p>
                <div class="vm-leak-more">${link("bucky://leaderboards", "Browse known operators ›")}</div>
            </div>
        `,
    });
}

// ---------------------------------------------------------------------------
// Soft-refresh
// ---------------------------------------------------------------------------
function maybeRefreshSelf() {
    const c = cache.me;
    if (c.inflight) return;
    if (c.fetchedAt && (Date.now() - c.fetchedAt < TTL)) return;
    refreshSelf();
}

async function refreshSelf() {
    const c = cache.me;
    if (c.inflight) return;
    c.inflight = true;
    if (!c.fetchedAt) c.status = "loading";
    let res;
    try { res = await gatewayClient.fetchSelfPlayer(); }
    catch (_e) { res = { ok: false }; }
    c.fetchedAt = Date.now();
    c.inflight = false;
    if (!res || !res.ok) {
        if (res && res.status === 401) {
            c.unauthenticated = true;
            c.status = "loaded";
            return;
        }
        c.status = "offline";
        return;
    }
    const data = res.data || {};
    if (data.first_run) {
        c.firstRun = true;
        c.status = "loaded";
        c.item = null;
        return;
    }
    c.unauthenticated = false;
    c.firstRun = false;
    c.item = data.item || null;
    c.status = c.item ? "loaded" : "offline";
}

function maybeRefreshPublic(userId) {
    const c = cache.publicById.get(userId);
    if (c && c.inflight) return;
    if (c && c.fetchedAt && (Date.now() - c.fetchedAt < TTL)) return;
    refreshPublic(userId);
}

async function refreshPublic(userId) {
    let c = cache.publicById.get(userId);
    if (!c) {
        c = { status: "loading", item: null, fetchedAt: 0, inflight: false };
        cache.publicById.set(userId, c);
    }
    c.inflight = true;
    if (!c.fetchedAt) c.status = "loading";
    let res;
    try { res = await gatewayClient.fetchPublicPlayer(userId); }
    catch (_e) { res = { ok: false }; }
    c.fetchedAt = Date.now();
    c.inflight = false;
    if (!res || !res.ok) {
        c.status = res && res.status === 404 ? "missing" : "offline";
        return;
    }
    const data = res.data || {};
    c.item = data.item || null;
    c.status = c.item ? "loaded" : "missing";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function statTile(label, value, wide) {
    return `
        <div class="vm-wiki-info-row${wide ? " is-wide" : ""}">
            <span>${escapeHtml(label)}</span>
            <strong>${value}</strong>
        </div>
    `;
}

function initial(view) {
    if (view && view.equipped_title) return view.equipped_title.charAt(0).toUpperCase();
    const id = String(view && view.user_id || "?");
    return id.charAt(0);
}

function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
const PUBLIC_URL_RE = /^bucky:\/\/profile\/([^/?#]+)$/;

/**
 * Register the bucky://profile + bucky://profile/<id> routes. The dynamic
 * per-id route uses a `resolve` predicate so we don't need to pre-register
 * every user — the SiteRegistry calls our handler whenever a URL matches.
 */
export function registerProfileSite(registry) {
    registry.register({
        id: "profile-home",
        url: SITE_URL,
        site: SITE,
        title: "Operator Profile",
        type: "home",
        keywords: ["profile", "operator", "me", "dashboard", "self", "level",
                   "prestige", "title", "achievement", "exposure", "leak", "rank"],
        description: "Your operator dashboard — identity, economy summary and exposure archive.",
        tags: ["profile", "identity"],
        render: () => renderSelfProfile(),
    });

    // Public profile by id — we register a single entry whose `resolve`
    // predicate matches any `bucky://profile/<id>` URL. The siteRegistry
    // calls `render` with the matched URL so we can extract the id.
    if (typeof registry.registerMatcher === "function") {
        registry.registerMatcher({
            id: "profile-public-by-id",
            site: SITE,
            title: "Operator Profile",
            type: "profile",
            keywords: ["profile", "operator", "public"],
            tags: ["profile", "identity"],
            match: (url) => PUBLIC_URL_RE.test(String(url || "")),
            render: (url) => {
                const m = PUBLIC_URL_RE.exec(String(url || ""));
                return renderPublicProfile(m ? m[1] : "");
            },
        });
    }
}

// Exposed for future hooks / tests.
export function refreshProfile() { return refreshSelf(); }
export function invalidateProfile() { cache.me.fetchedAt = 0; cache.publicById.clear(); }
