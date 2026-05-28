/**
 * pulse.js — bucky://pulse (Phase 4.3, Part 6).
 *
 * PulseNet — the Grid's combined live state. A single page that aggregates
 * the high-velocity signals from across BuckyNet:
 *
 *   * Live incidents (world_content domain="incident")
 *   * Recent credential leaks (player_exposures via /api/leaks/recent)
 *   * Top of every active leaderboard (richest / level / org-rep / most-leaked)
 *   * Newest world events / broadcasts (world_content news domains)
 *
 * It is read-only and consumes ONLY existing public endpoints:
 *   /api/worldcontent/incident, /api/worldcontent (news), /api/leaks/recent,
 *   /api/leaderboards
 *
 * Architecture preserved (project rules):
 *   - SiteRegistry / EventBus / browser runtime untouched.
 *   - render() stays synchronous and pure; soft refresh happens off to the side.
 *   - All authored text is HTML-escaped via the shared site kit.
 *   - No write paths. The VM remains a consumer.
 */
import { escapeHtml, link, chip, sitePage, crossRefs } from "./kit.js";
import { gatewayClient } from "../../../core/gatewayClient.js";

const SITE = "pulse";
const SITE_URL = "bucky://pulse";
const SITE_DOMAIN = "PulseNet";
const TTL = gatewayClient.softRefreshTtl || 60000;

const state = {
    fetchedAt: 0,
    inflight: false,
    status: "idle",            // idle | loading | live | partial | offline
    incidents: [],
    leaks: [],
    news: [],
    leaderboards: { boards: [] },
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderHome() {
    maybeRefresh();
    const incidentsBlock = renderIncidents();
    const leaksBlock = renderLeaks();
    const newsBlock = renderNews();
    const boardsBlock = renderTopOfBoards();

    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">
                PulseNet is the Grid's heartbeat — the live combined feed of incidents,
                credential leaks, news and rankings. Everything here is real-time and
                drawn from the same backend the VM consumes elsewhere.
            </p>
            ${renderStatus()}
            <div class="vm-pulse-grid">
                <section class="vm-pulse-block">
                    <h2 class="vm-pulse-h">Live incidents</h2>
                    ${incidentsBlock}
                    <div class="vm-leak-more">${link("bucky://incidents", "Open the incident feed ›")}</div>
                </section>
                <section class="vm-pulse-block">
                    <h2 class="vm-pulse-h">Recent leaks</h2>
                    ${leaksBlock}
                    <div class="vm-leak-more">${link("bucky://leaks", "Open the leak archive ›")}</div>
                </section>
                <section class="vm-pulse-block">
                    <h2 class="vm-pulse-h">News & broadcasts</h2>
                    ${newsBlock}
                    <div class="vm-leak-more">${link("bucky://news", "Open Bucky News ›")}</div>
                </section>
                <section class="vm-pulse-block">
                    <h2 class="vm-pulse-h">Top of the boards</h2>
                    ${boardsBlock}
                    <div class="vm-leak-more">${link("bucky://leaderboards", "Open the leaderboards ›")}</div>
                </section>
            </div>
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://profile", label: "Your profile", note: "your operator state" },
                { url: "bucky://organizations", label: "Organisations", note: "the four founders" }
            ])}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} · ${SITE_URL}`,
        title: "PulseNet",
        lead: "The Grid's combined live state.",
        bodyHtml: body,
    });
}

function renderIncidents() {
    if (state.incidents.length === 0) {
        return `<p class="vm-dev-note">No active incidents.</p>`;
    }
    return `<ul class="vm-pulse-list">${state.incidents.slice(0, 5).map((it) => `
        <li class="vm-pulse-row">
            ${chip(prettyCategory(it.category, "incident"))}
            ${link(`bucky://incidents/${escapeHtml(it.slug || "")}`, it.title || "(untitled)")}
            <span class="vm-pulse-meta">${escapeHtml(formatDate(it.published_at || it.created_at))}</span>
        </li>
    `).join("")}</ul>`;
}

function renderLeaks() {
    if (state.leaks.length === 0) {
        return `<p class="vm-dev-note">No recent leaks on record.</p>`;
    }
    return `<ul class="vm-pulse-list">${state.leaks.slice(0, 5).map((leak) => `
        <li class="vm-pulse-row">
            ${chip(leak.severity || "low")}
            <span class="vm-leak-cred">${escapeHtml(leak.masked_credential || "")}</span>
            <span class="vm-pulse-meta">${leak.incident_slug
                ? link(`bucky://leaks/${escapeHtml(leak.incident_slug)}`, leak.incident_title || leak.incident_slug)
                : escapeHtml(leak.incident_title || "—")}</span>
            <span class="vm-pulse-meta">${escapeHtml(formatDate(leak.leaked_at))}</span>
        </li>
    `).join("")}</ul>`;
}

function renderNews() {
    if (state.news.length === 0) {
        return `<p class="vm-dev-note">No news ready.</p>`;
    }
    return `<ul class="vm-pulse-list">${state.news.slice(0, 5).map((post) => `
        <li class="vm-pulse-row">
            ${chip(prettyCategory(post.category, "news"))}
            ${link(`bucky://news/${escapeHtml(post.slug || "")}`, post.title || "(untitled)")}
            <span class="vm-pulse-meta">${escapeHtml(formatDate(post.published_at || post.created_at))}</span>
        </li>
    `).join("")}</ul>`;
}

function renderTopOfBoards() {
    const boards = (state.leaderboards && state.leaderboards.boards) || [];
    if (boards.length === 0) {
        return `<p class="vm-dev-note">Rankings warming up.</p>`;
    }
    return `<div class="vm-pulse-boards">${boards.map((board) => {
        const top = (board.items || [])[0];
        const title = labelForKind(board.kind);
        if (!top) {
            return `<div class="vm-pulse-board"><span class="vm-leaderboard-rank">#1</span> <span>${escapeHtml(title)}: <em>—</em></span></div>`;
        }
        const who = top.org_id
            ? `${escapeHtml(top.emblem || "")} ${escapeHtml(top.name || top.org_id)}`
            : `Operator ${escapeHtml(String(top.user_id || ""))}`;
        return `
            <div class="vm-pulse-board">
                <span class="vm-leaderboard-rank">#1</span>
                <span>${escapeHtml(title)}: ${link(boardUrl(board.kind), who)}</span>
                ${top.score_value != null ? chip(String(top.score_value)) : ""}
            </div>
        `;
    }).join("")}</div>`;
}

function renderStatus() {
    if (state.status === "live") {
        return `<div class="vm-dev-feedstatus is-live">
            <span class="vm-dev-feeddot"></span>PulseNet online — incidents, leaks, news and rankings refreshing in the background.
        </div>`;
    }
    if (state.status === "partial") {
        return `<div class="vm-dev-feedstatus is-idle">
            <span class="vm-dev-feeddot"></span>PulseNet partial — some channels are still warming up.
        </div>`;
    }
    if (state.status === "offline") {
        return `<div class="vm-dev-feedstatus is-offline">
            <span class="vm-dev-feeddot"></span>PulseNet offline — backend unreachable.
        </div>`;
    }
    return `<div class="vm-dev-feedstatus is-loading">
        <span class="vm-dev-feeddot"></span>Connecting to PulseNet…
    </div>`;
}

// ---------------------------------------------------------------------------
// Soft-refresh
// ---------------------------------------------------------------------------
function maybeRefresh() {
    if (state.inflight) return;
    if (state.fetchedAt && (Date.now() - state.fetchedAt < TTL)) return;
    refresh();
}

async function refresh() {
    if (state.inflight) return;
    state.inflight = true;
    if (!state.fetchedAt) state.status = "loading";

    // Fan out in parallel — every fetch resolves to an envelope and never throws.
    const [incidentsR, leaksR, newsR, boardsR] = await Promise.all([
        safe(() => gatewayClient.fetchWorldContentDomain("incident")),
        safe(() => gatewayClient.fetchRecentLeaks(10)),
        safe(() => gatewayClient.fetchWorldContent()),
        safe(() => gatewayClient.fetchLeaderboards(3)),
    ]);

    state.fetchedAt = Date.now();
    state.inflight = false;

    let okCount = 0;
    const totalProbes = 4;

    if (incidentsR && incidentsR.ok && incidentsR.data) {
        state.incidents = Array.isArray(incidentsR.data.items) ? incidentsR.data.items : [];
        okCount += 1;
    }
    if (leaksR && leaksR.ok && leaksR.data) {
        state.leaks = Array.isArray(leaksR.data.items) ? leaksR.data.items : [];
        okCount += 1;
    }
    if (newsR && newsR.ok && newsR.data) {
        const all = Array.isArray(newsR.data.items) ? newsR.data.items : [];
        // Filter to news-class domains so the pulse "news" column doesn't
        // accidentally mirror incidents/leaks we already render separately.
        state.news = all.filter((i) =>
            i && (i.domain === "announcement" || i.domain === "world_event" || i.domain === "broadcast")
        );
        okCount += 1;
    }
    if (boardsR && boardsR.ok && boardsR.data) {
        state.leaderboards = boardsR.data;
        okCount += 1;
    }

    if (okCount === 0) state.status = "offline";
    else if (okCount < totalProbes) state.status = "partial";
    else state.status = "live";
    notifyHydrated("pulse");
}

/** Phase 4.3 polish — hydration signal (same pattern across identity sites). */
function notifyHydrated(source) {
    if (typeof window === "undefined" || !window.dispatchEvent) return;
    try {
        window.dispatchEvent(new CustomEvent("bucky:hydrated", { detail: { source } }));
    } catch (_e) { /* noop */ }
}

async function safe(fn) {
    try { return await fn(); }
    catch (_e) { return { ok: false }; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function prettyCategory(token, fallback) {
    const words = String(token || fallback || "general").split(/[_\s-]+/).filter(Boolean);
    if (!words.length) return fallback || "Update";
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function formatDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function labelForKind(kind) {
    if (kind === "richest") return "Richest";
    if (kind === "level") return "Highest level";
    if (kind === "org-reputation") return "Top organisation";
    if (kind === "most-leaked") return "Most leaked";
    return String(kind || "Board");
}

function boardUrl(kind) {
    return `bucky://leaderboards/${kind}`;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
export function registerPulseSite(registry) {
    registry.register({
        id: "pulse-home",
        url: SITE_URL,
        site: SITE,
        title: "PulseNet",
        type: "home",
        keywords: ["pulse", "pulsenet", "grid", "live", "feed", "dashboard",
                   "incidents", "leaks", "news", "rankings", "world", "state"],
        description: "The Grid's combined live state - incidents, leaks, news and the top of every leaderboard.",
        tags: ["pulse", "live", "dashboard"],
        render: () => renderHome(),
    });
}

export function refreshPulse() { return refresh(); }
export function invalidatePulse() { state.fetchedAt = 0; }

/**
 * Phase 4.3 polish - boot-time preload. PulseNet aggregates four independent
 * feeds; preloading at boot avoids the partial-state flicker the first time
 * the user navigates here.
 */
export function preloadPulse() { return refresh(); }
