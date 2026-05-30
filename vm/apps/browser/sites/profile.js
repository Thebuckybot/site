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
// Self-view (the rich operator dashboard)
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
    const body = renderRichDashboard(view);

    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} ` + middot() + ` bucky://profile`,
        title: "Operator Profile",
        lead: "Your operator dashboard, the cyberworld’s read-only mirror.",
        bodyHtml: body,
    });
}

/**
 * Build the rich-dashboard body for the self-view. The layout intentionally
 * mirrors what `profile.py` shows in Discord, with the additions Phase 4.3
 * makes available: organisation affiliation, exposure archive and identity-
 * aware progression bars. Every numeric value the backend ships is presented
 * in a stat tile; the lists (achievements, titles, arcs) are surfaced as
 * compact chip rows so the page stays scannable.
 */
function renderRichDashboard(view) {
    const org = view.organization;
    const sec = view.security || {};
    const work = view.work || {};
    const wp = view.windpark || {};

    const orgChip = org
        ? `<span class="vm-site-chip">${escapeHtml(org.emblem || "")} ${escapeHtml(org.name || "")}</span>`
        : `<span class="vm-site-chip">Unaffiliated</span>`;

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
                ${orgChip}
                ${view.security && view.security.breached
                    ? `<span class="vm-site-chip vm-profile-alert">COMPROMISED</span>`
                    : (view.security && view.security.alert_triggered
                        ? `<span class="vm-site-chip vm-profile-alert">SECURITY ALERT</span>` : "")}
            </div>
        </header>
    `;

    const progressBar = renderXpBar(view);

    // Phase 4.3 audit pass — a prominent COMPROMISED status banner shown only
    // while the operator is breached. Empty string when secure, so a healthy
    // dashboard is unchanged.
    const compromised = renderCompromisedBanner(view);

    const orgBlock = renderOrgBlock(org);
    const economy = renderEconomyBlock(view);
    const progression = renderProgressionBlock(view);
    const inventory = renderInventoryBlock(view);
    const security = renderSecurityBlock(sec);
    const cosmetics = renderCosmeticsBlock(view);
    const operations = renderOperationsBlock(view, work, wp);
    const exposureBlock = renderExposureBlock(view.exposures || []);

    return `
        <div class="vm-wiki-body">
            ${banner}
            ${compromised}
            ${progressBar}
            <div class="vm-profile-columns">
                <div class="vm-profile-col">
                    ${orgBlock}
                    ${economy}
                    ${progression}
                </div>
                <div class="vm-profile-col">
                    ${inventory}
                    ${security}
                    ${operations}
                </div>
            </div>
            ${cosmetics}
            ${exposureBlock}
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://leaks", label: "Leak Database", note: "the public archive" },
                { url: "bucky://leaderboards", label: "Leaderboards", note: "where you rank" },
                { url: "bucky://organizations", label: "Organisations", note: "Grid factions" },
                { url: "bucky://pulse", label: "PulseNet", note: "live Grid state" }
            ])}
        </div>
    `;
}

/** A unicode middot constant kept out of long template strings (helps with
 *  multi-byte safety in edit tooling). */
function middot() { return "·"; }

function renderXpBar(view) {
    const into = Math.max(0, parseInt(view.xp_into_level || 0, 10));
    const next = Math.max(1, parseInt(view.xp_to_next_level || 1, 10));
    const pct = Math.min(100, Math.max(0, Math.round((into / next) * 100)));
    const totalXp = parseInt(view.xp || 0, 10);
    return `
        <section class="vm-profile-progress">
            <div class="vm-profile-progress-head">
                <span>Level ${escapeHtml(String(view.level || 1))} progression</span>
                <span>${escapeHtml(String(into))} / ${escapeHtml(String(next))} XP (${pct}%)</span>
            </div>
            <div class="vm-profile-progress-track">
                <div class="vm-profile-progress-fill" style="width:${pct}%"></div>
            </div>
            <div class="vm-profile-progress-foot">
                Lifetime XP: ${escapeHtml(String(totalXp))}
                ${view.prestige ? ` ${middot()} Prestige ${escapeHtml(String(view.prestige))}` : ""}
            </div>
        </section>
    `;
}

function renderOrgBlock(org) {
    if (!org) {
        return `
            <section class="vm-wiki-section vm-profile-block">
                <h2>Organisation</h2>
                <p class="vm-dev-note">
                    No affiliation yet. Run <code>+chooseorg</code> in Discord. The
                    choice is permanent and gates progression commands.
                </p>
                <div class="vm-leak-more">${link("bucky://organizations", "Browse the founding organisations")}</div>
            </section>
        `;
    }
    return `
        <section class="vm-wiki-section vm-profile-block">
            <h2>Organisation</h2>
            <div class="vm-profile-grid">
                ${statTile("Affiliation", `${escapeHtml(org.emblem || "")} ${escapeHtml(org.name || "")}`, true)}
                ${statTile("Rank", String(org.rank || "recruit"))}
                ${statTile("Reputation", String(org.reputation || 0))}
                ${statTile("Warnings", String(org.warnings != null ? org.warnings : 0))}
            </div>
            <div class="vm-leak-more">${link("bucky://organizations/" + (org.id || ""), "Open organisation page")}</div>
        </section>
    `;
}

function renderEconomyBlock(view) {
    const bonus = parseInt(view.bank_limit_bonus || 0, 10);
    return `
        <section class="vm-wiki-section vm-profile-block">
            <h2>Economy</h2>
            <div class="vm-profile-grid">
                ${statTile("Coins", formatNumber(view.coins))}
                ${statTile("Bank", formatNumber(view.bank))}
                ${statTile("Bank limit", formatNumber(view.bank_limit)
                    + (bonus ? ` (+${formatNumber(bonus)})` : ""))}
                ${statTile("Net worth", formatNumber(view.networth))}
            </div>
            <div class="vm-profile-substats">
                <span>Total given: <strong>${escapeHtml(formatNumber(view.total_given))}</strong></span>
                <span>Total received: <strong>${escapeHtml(formatNumber(view.total_received))}</strong></span>
            </div>
        </section>
    `;
}

function renderProgressionBlock(view) {
    const arc = view.current_arc || null;
    const completed = view.completed_arcs || [];
    const unlocked = view.unlocked_arcs || [];
    const arcsRow = `
        <div class="vm-profile-substats">
            <span>Current arc: <strong>${escapeHtml(arc || "none")}</strong></span>
            <span>Unlocked: <strong>${escapeHtml(String(unlocked.length))}</strong></span>
            <span>Completed: <strong>${escapeHtml(String(completed.length))}</strong></span>
            <span>Active quests: <strong>${escapeHtml(String(view.active_quests_count || 0))}</strong></span>
        </div>
    `;
    const completedChips = completed.length
        ? `<div class="vm-site-chiprow">${completed.slice(0, 12).map((a) => chip(String(a))).join("")}</div>`
        : "";
    return `
        <section class="vm-wiki-section vm-profile-block">
            <h2>Progression</h2>
            ${arcsRow}
            ${completedChips}
        </section>
    `;
}

function renderInventoryBlock(view) {
    return `
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
}

/**
 * Phase 4.3 audit pass — the live "operator under incident" banner.
 *
 * Rendered only while `security.breached` is true. It turns the dashboard into
 * a live security console: a COMPROMISED headline, the breach timestamp and
 * source the backend now ships, the total exposure count, and the most recent
 * incident the operator appeared in. Returns an empty string when the operator
 * is secure, so a healthy profile is visually unchanged.
 */
function renderCompromisedBanner(view) {
    const sec = view.security || {};
    if (!sec.breached) return "";

    const exposures = view.exposures || [];
    const last = exposures[0] || {};
    const when = sec.last_breached_at ? formatDateTime(sec.last_breached_at) : "unknown";
    const source = sec.last_breached_by || "unknown source";
    const lastIncident = last.incident_title || last.incident_slug || "—";

    return `
        <section class="vm-profile-compromised" role="alert">
            <div class="vm-profile-compromised-head">
                <span class="vm-profile-compromised-badge">SECURITY STATUS: COMPROMISED</span>
                <span class="vm-profile-compromised-sub">Active incident — credentials exposed on BuckyNet</span>
            </div>
            <div class="vm-profile-grid vm-profile-compromised-grid">
                ${statTile("Breached at", escapeHtml(when))}
                ${statTile("Source", escapeHtml(String(source)))}
                ${statTile("Exposures on record", String(exposures.length))}
                ${statTile("Last incident", escapeHtml(String(lastIncident)), true)}
            </div>
            <p class="vm-profile-compromised-cta">
                Your account is flagged as compromised. Rotate your bank code in Discord with
                <code>+setbankcode</code> to clear this alert and return to <strong>SECURE</strong>.
                Historical exposures below remain immutable — recovery never erases them.
            </p>
        </section>
    `;
}

function renderSecurityBlock(sec) {
    const codeState = sec.bank_code_set ? "rotated" : "default - rotate!";
    const breach = sec.breached ? "COMPROMISED" : "secure";
    return `
        <section class="vm-wiki-section vm-profile-block">
            <h2>Security posture</h2>
            <div class="vm-profile-grid">
                ${statTile("Bank code", codeState)}
                ${statTile("Firewall", "Lv " + String(sec.firewall_level || 0))}
                ${statTile("Status", breach)}
                ${statTile("Alert", sec.alert_triggered ? "ACTIVE" : "clear")}
            </div>
            <div class="vm-profile-substats">
                <span>Equipped attack: <strong>${escapeHtml(sec.active_attack || "none")}</strong>
                    (${escapeHtml(String(sec.attack_scripts_count || 0))} owned)</span>
                <span>Equipped defence: <strong>${escapeHtml(sec.active_security || "none")}</strong>
                    (${escapeHtml(String(sec.security_scripts_count || 0))} owned)</span>
            </div>
            <p class="vm-leak-cred-note">
                Rotate your bank code in Discord with <code>/setbankcode</code> if it is still the default.
                A weak code raises the chance the leak engine fingerprints your operator on its next run.
            </p>
        </section>
    `;
}

function renderCosmeticsBlock(view) {
    const titles = view.titles || [];
    const achievements = view.achievements || [];
    const eq = view.equipped_title || "";
    const titleChips = titles.length
        ? titles.slice(0, 24).map((t) => {
            const isEq = String(t) === String(eq);
            return `<span class="vm-site-chip${isEq ? " is-equipped" : ""}">${escapeHtml(String(t))}${isEq ? " " + middot() + " equipped" : ""}</span>`;
        }).join("")
        : `<span class="vm-dev-note">No titles unlocked yet.</span>`;
    const achChips = achievements.length
        ? achievements.slice(0, 24).map((a) => chip(String(a))).join("")
        : `<span class="vm-dev-note">No achievements yet.</span>`;
    return `
        <section class="vm-wiki-section vm-profile-block">
            <h2>Cosmetics &amp; recognition</h2>
            <h3 class="vm-profile-subh">Titles (${titles.length})</h3>
            <div class="vm-site-chiprow">${titleChips}</div>
            <h3 class="vm-profile-subh">Achievements (${achievements.length})</h3>
            <div class="vm-site-chiprow">${achChips}</div>
        </section>
    `;
}

function renderOperationsBlock(view, work, wp) {
    const jobLine = work.job
        ? `<span>Job: <strong>${escapeHtml(work.job)}</strong></span>
           <span>Shifts today: <strong>${escapeHtml(String(work.daily_shifts_done || 0))}</strong></span>
           <span>Strikes: <strong>${escapeHtml(String(work.strikes || 0))}</strong></span>`
        : `<span>No job assigned</span>`;
    const windLine = wp.unlocked
        ? `<span>Windfarm level: <strong>${escapeHtml(String(wp.farm_level || 0))}</strong></span>
           <span>Datafarm: <strong>${wp.datafarm_unlocked ? "Lv " + escapeHtml(String(wp.datafarm_level || 0)) : "locked"}</strong></span>
           <span>Energy: <strong>${escapeHtml(String(wp.energy || 0))}</strong></span>
           <span>Efficiency: <strong>${(wp.efficiency || 0).toFixed(2)}x</strong></span>
           <span>Stability: <strong>${Math.round((wp.stability || 0) * 100)}%</strong></span>`
        : `<span>Windpark not unlocked yet.</span>`;
    return `
        <section class="vm-wiki-section vm-profile-block">
            <h2>Operations</h2>
            <h3 class="vm-profile-subh">Work</h3>
            <div class="vm-profile-substats">${jobLine}</div>
            <h3 class="vm-profile-subh">Windpark</h3>
            <div class="vm-profile-substats">${windLine}</div>
            <h3 class="vm-profile-subh">Activity</h3>
            <div class="vm-profile-substats">
                <span>Streak: <strong>${escapeHtml(String(view.streak || 0))}</strong></span>
                <span>Hours worked: <strong>${escapeHtml(String(view.hours_worked || 0))}</strong></span>
                <span>Total logins: <strong>${escapeHtml(String(view.total_logins || 0))}</strong></span>
                <span>Joined: <strong>${escapeHtml(formatDate(view.joined))}</strong></span>
            </div>
        </section>
    `;
}

function renderExposureBlock(exposures) {
    if (exposures.length === 0) {
        return `
            <section class="vm-wiki-section vm-profile-block">
                <h2>Exposure archive</h2>
                <p class="vm-dev-note">No exposures on record. Either you have been lucky, or the engine has not ticked since you rotated.</p>
            </section>
        `;
    }
    const rows = exposures.map((e) => `
        <tr>
            <td class="vm-leak-cred">${escapeHtml(e.masked_credential || "")}</td>
            <td>${chip(e.severity || "low")}</td>
            <td>${e.incident_slug
                ? link("bucky://leaks/" + (e.incident_slug || ""), e.incident_title || e.incident_slug)
                : escapeHtml(e.incident_title || "-")}</td>
            <td>${escapeHtml(formatDate(e.leaked_at))}</td>
        </tr>
    `).join("");
    return `
        <section class="vm-wiki-section vm-profile-block">
            <h2>Exposure archive (${exposures.length})</h2>
            <div class="vm-leak-tablewrap"><table class="vm-leak-table">
                <thead><tr><th>Snippet</th><th>Severity</th><th>Source</th><th>Logged</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>
            <p class="vm-leak-cred-note">
                Exposure rows are immutable. Rotating your bank code never deletes or rewrites historical leaks.
            </p>
        </section>
    `;
}

/** Format an integer with thousand-separators. Accepts strings/null safely. */
function formatNumber(value) {
    if (value == null || value === "") return "0";
    const n = parseInt(value, 10);
    if (isNaN(n)) return String(value);
    return n.toLocaleString("en-GB");
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
        domain: `${SITE_DOMAIN} ` + middot() + ` bucky://profile`,
        title: "Operator Profile",
        lead: "Log in on Discord to see your operator profile here.",
        bodyHtml: `
            <div class="vm-wiki-body">
                <div class="vm-dev-feedstatus is-idle">
                    <span class="vm-dev-feeddot"></span>
                    You are browsing BuckyNet as an anonymous visitor; no identity is bound to this VM session.
                </div>
                <p>To see your own profile, achievements and exposure archive, log in to the Bucky dashboard with Discord.</p>
                <div class="vm-leak-more">${link("bucky://organizations", "Browse the founding organisations")}</div>
            </div>
        `,
    });
}

function renderFirstRun() {
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} ` + middot() + ` bucky://profile`,
        title: "No operator profile yet",
        lead: "Run /start in Discord to begin your operator career.",
        bodyHtml: `
            <div class="vm-wiki-body">
                <p>The Grid does not know you yet. Run <code>/start</code> in any Bucky-enabled Discord server to create your profile. The organisation chooser opens automatically right after.</p>
                <div class="vm-leak-more">${link("bucky://organizations", "Preview the founding organisations")}</div>
            </div>
        `,
    });
}

function renderOffline() {
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} ` + middot() + ` bucky://profile`,
        title: "Operator Profile",
        lead: "The Grid is briefly unreachable.",
        bodyHtml: `
            <div class="vm-wiki-body">
                <div class="vm-dev-feedstatus is-offline">
                    <span class="vm-dev-feeddot"></span>
                    Live profile feed offline; try again in a moment.
                </div>
            </div>
        `,
    });
}

function renderLoading(userId) {
    const pathLabel = userId ? `bucky://profile/${userId}` : "bucky://profile";
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} ` + middot() + ` ${pathLabel}`,
        title: "Operator Profile",
        lead: "Resolving operator...",
        bodyHtml: `
            <div class="vm-wiki-body">
                <div class="vm-dev-feedstatus is-loading">
                    <span class="vm-dev-feeddot"></span>
                    Loading profile from the Grid...
                </div>
            </div>
        `,
    });
}

function renderUnknownOperator(userId) {
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} ` + middot() + ` bucky://profile/${userId}`,
        title: "Operator not found",
        lead: "No operator on record for this id.",
        bodyHtml: `
            <div class="vm-wiki-body">
                <p>The Grid has no profile for <code>${escapeHtml(String(userId))}</code>.</p>
                <div class="vm-leak-more">${link("bucky://leaderboards", "Browse known operators")}</div>
            </div>
        `,
    });
}

// ---------------------------------------------------------------------------
// Soft-refresh lifecycle (TTL-based; identical pattern to the worldfeed factory).
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
    // Reset per-state sentinels: a token arriving after a first failed fetch
    // would otherwise leave them stuck even when the new response is good.
    c.unauthenticated = false;
    c.firstRun = false;
    if (!res || !res.ok) {
        if (res && res.status === 401) {
            c.unauthenticated = true;
            c.status = "loaded";
            notifyHydrated();
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
        notifyHydrated();
        return;
    }
    c.item = data.item || null;
    c.status = c.item ? "loaded" : "offline";
    notifyHydrated();
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
// Helpers (kept ASCII-safe to stay portable across edit tooling)
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
    if (!value) return "-";
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Date + time, for breach provenance (the COMPROMISED banner). */
function formatDateTime(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
    });
}

/**
 * Phase 4.3 polish - hydration signal.
 *
 * After a successful refresh we fire a `bucky:hydrated` custom DOM event so
 * the BrowserApp can re-render its viewport if the user is currently sitting
 * on bucky://profile (or any identity-aware page). This eliminates the
 * "first render shows stale data" flicker without coupling the gateway to
 * the browser app or introducing realtime sync.
 */
function notifyHydrated() {
    if (typeof window === "undefined" || !window.dispatchEvent) return;
    try {
        window.dispatchEvent(new CustomEvent("bucky:hydrated", {
            detail: { source: "profile" }
        }));
    } catch (_e) { /* CustomEvent unsupported - noop */ }
}

const PUBLIC_URL_RE = /^bucky:\/\/profile\/([^/?#]+)$/;

// ---------------------------------------------------------------------------
// Registration + preload hook (Phase 4.3 polish)
// ---------------------------------------------------------------------------
export function registerProfileSite(registry) {
    registry.register({
        id: "profile-home",
        url: SITE_URL,
        site: SITE,
        title: "Operator Profile",
        type: "home",
        keywords: ["profile", "operator", "me", "dashboard", "self", "level",
                   "prestige", "title", "achievement", "exposure", "leak", "rank"],
        description: "Your operator dashboard: identity, economy summary, progression and exposure archive.",
        tags: ["profile", "identity"],
        render: () => renderSelfProfile(),
    });

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

/**
 * Phase 4.3 - boot-time preload.
 *
 * Called by buckynet.js right after the registry is built so the operator
 * identity is hydrated before the user navigates to bucky://profile. Idempotent
 * and TTL-respecting: if the cache is already fresh, this is a no-op. We only
 * preload when an auth token is available - public visits skip the fetch.
 */
export function preloadProfile() {
    if (!gatewayClient.hasAuthToken || !gatewayClient.hasAuthToken()) return;
    return refreshSelf();
}

export function refreshProfile() { return refreshSelf(); }
export function invalidateProfile() {
    cache.me.fetchedAt = 0;
    cache.publicById.clear();
}
