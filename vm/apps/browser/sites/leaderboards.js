/**
 * leaderboards.js — bucky://leaderboards (Phase 4.3, Part 8).
 *
 * The Grid's public rankings page. Renders four leaderboards backed by the
 * read-only `/api/leaderboards/*` surface:
 *
 *     richest        — net worth (amount NOT exposed, ranking only)
 *     level          — highest level / prestige
 *     org-reputation — top organisations by member-rep totals
 *     most-leaked    — operators with the most credential exposures
 *
 * Routes:
 *     bucky://leaderboards           home — strip view, top-N each
 *     bucky://leaderboards/<kind>    one board, full page
 *
 * PUBLIC PROJECTION ONLY (preserves Phase 4.3's visibility split)
 *   The backend service shapes each entry through `public_view` rules. The
 *   amount that drove the "richest" ranking is intentionally NOT returned —
 *   this page ranks operators by net worth without disclosing balances. The
 *   page reflects that contract: it shows the rank label, never a number for
 *   the richest board.
 */
import { escapeHtml, link, chip, sitePage, crossRefs } from "./kit.js";
import { gatewayClient } from "../../../core/gatewayClient.js";

const SITE = "leaderboards";
const SITE_URL = "bucky://leaderboards";
const SITE_DOMAIN = "Grid Leaderboards";
const TTL = gatewayClient.softRefreshTtl || 60000;

const KINDS = [
    { id: "richest",         title: "Richest Operators",  lead: "Ranked by net worth. The amount is private — only the position is shown." },
    { id: "level",           title: "Highest Level",       lead: "Top operators by level and prestige." },
    { id: "org-reputation",  title: "Organisation Reputation", lead: "Cumulative reputation across each org's members." },
    { id: "most-leaked",     title: "Most Leaked",         lead: "Operators with the most credential exposures on record." },
];

const state = {
    all: { status: "idle", items: [], fetchedAt: 0, inflight: false },
    byKind: new Map(),
};

// ---------------------------------------------------------------------------
// Home — strip view of every leaderboard
// ---------------------------------------------------------------------------
function renderHome() {
    maybeRefreshAll();
    const s = state.all;

    const sections = KINDS.map((k) => {
        const board = (s.items || []).find((b) => b && b.kind === k.id) || { items: [] };
        const items = (board.items || []).slice(0, 5);
        return `
            <article class="vm-leaderboard-strip">
                <header class="vm-leaderboard-strip-head">
                    <h3 class="vm-dev-card-title">${link(`bucky://leaderboards/${k.id}`, k.title)}</h3>
                    <p class="vm-dev-card-summary">${escapeHtml(k.lead)}</p>
                </header>
                ${items.length === 0
                    ? `<p class="vm-dev-note">No data yet.</p>`
                    : `<ol class="vm-leaderboard-list">${items.map(renderEntryRow).join("")}</ol>`
                }
                <div class="vm-leak-more">${link(`bucky://leaderboards/${k.id}`, "Open full board ›")}</div>
            </article>
        `;
    }).join("");

    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">
                Live rankings across the Grid. Every entry is a public projection — balances,
                inventory and security state are never shown here.
            </p>
            ${renderStatus(s)}
            <div class="vm-leaderboard-grid">${sections}</div>
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://organizations", label: "Organisations", note: "the four founders" },
                { url: "bucky://leaks", label: "Leak Database", note: "the most-leaked source" },
                { url: "bucky://profile", label: "Your profile", note: "see where you rank" }
            ])}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} · ${SITE_URL}`,
        title: "Grid Leaderboards",
        lead: "Live rankings — richest, highest-level, organisation reputation and most-leaked.",
        bodyHtml: body,
    });
}

// ---------------------------------------------------------------------------
// Per-kind full board
// ---------------------------------------------------------------------------
function renderKind(kindId) {
    maybeRefreshKind(kindId);
    const k = KINDS.find((x) => x.id === kindId);
    if (!k) return renderUnknownKind(kindId);

    const s = state.byKind.get(kindId) || { status: "idle", items: [], fetchedAt: 0 };
    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">${escapeHtml(k.lead)}</p>
            ${renderStatus(s)}
            ${s.items.length === 0
                ? `<p class="vm-dev-note">No entries on this board yet.</p>`
                : `<ol class="vm-leaderboard-list is-full">${s.items.map(renderEntryRow).join("")}</ol>`
            }
            <div class="vm-leak-more">${link(SITE_URL, "‹ Back to all leaderboards")}</div>
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} · bucky://leaderboards/${escapeHtml(kindId)}`,
        title: k.title,
        lead: k.lead,
        bodyHtml: body,
    });
}

function renderEntryRow(entry) {
    if (!entry) return "";
    if (entry.org_id) {
        // Organisation row (org-reputation board).
        return `
            <li class="vm-leaderboard-row">
                <span class="vm-leaderboard-rank">#${escapeHtml(String(entry.rank || ""))}</span>
                <span class="vm-leaderboard-id">
                    <span class="vm-org-emblem" style="--vm-org-accent:${escapeHtml(normaliseColor(entry.color) || "#10E0C8")};">${escapeHtml(entry.emblem || "?")}</span>
                    ${link(`bucky://organizations/${escapeHtml(entry.org_id)}`, entry.name || entry.org_id)}
                </span>
                <span class="vm-leaderboard-score">${escapeHtml(String(entry.score_value != null ? entry.score_value : "—"))}</span>
                <span class="vm-leaderboard-meta">${entry.members != null ? escapeHtml(`${entry.members} members`) : ""}</span>
            </li>
        `;
    }
    // Operator row.
    const org = entry.organization;
    return `
        <li class="vm-leaderboard-row">
            <span class="vm-leaderboard-rank">#${escapeHtml(String(entry.rank || ""))}</span>
            <span class="vm-leaderboard-id">
                ${link(`bucky://profile/${escapeHtml(String(entry.user_id || ""))}`, `Operator ${entry.user_id || ""}`)}
                ${entry.equipped_title ? chip(entry.equipped_title) : ""}
            </span>
            <span class="vm-leaderboard-score">${escapeHtml(entry.score_value != null ? String(entry.score_value) : "—")}</span>
            <span class="vm-leaderboard-meta">
                ${org ? `${escapeHtml(org.emblem || "")} ${escapeHtml(org.name || "")}` : "—"}
            </span>
        </li>
    `;
}

function renderStatus(s) {
    if (s.status === "live") {
        return `<div class="vm-dev-feedstatus is-live">
            <span class="vm-dev-feeddot"></span>Live rankings online.
        </div>`;
    }
    if (s.status === "offline") {
        return `<div class="vm-dev-feedstatus is-offline">
            <span class="vm-dev-feeddot"></span>Rankings offline — try again in a moment.
        </div>`;
    }
    return `<div class="vm-dev-feedstatus is-loading">
        <span class="vm-dev-feeddot"></span>Loading rankings…
    </div>`;
}

function renderUnknownKind(kind) {
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} · bucky://leaderboards/${escapeHtml(kind)}`,
        title: "Unknown board",
        lead: "That leaderboard kind doesn't exist.",
        bodyHtml: `
            <div class="vm-wiki-body">
                <p>Pick one of the known boards: ${KINDS.map((k) => link(`bucky://leaderboards/${k.id}`, k.title)).join(" · ")}</p>
                <div class="vm-leak-more">${link(SITE_URL, "‹ Back to leaderboards")}</div>
            </div>
        `,
    });
}

// ---------------------------------------------------------------------------
// Soft-refresh
// ---------------------------------------------------------------------------
function maybeRefreshAll() {
    if (state.all.inflight) return;
    if (state.all.fetchedAt && (Date.now() - state.all.fetchedAt < TTL)) return;
    refreshAll();
}

async function refreshAll() {
    if (state.all.inflight) return;
    state.all.inflight = true;
    if (!state.all.fetchedAt) state.all.status = "loading";
    let res;
    try { res = await gatewayClient.fetchLeaderboards(5); }
    catch (_e) { res = { ok: false }; }
    state.all.fetchedAt = Date.now();
    state.all.inflight = false;
    if (!res || !res.ok || !res.data) {
        state.all.status = "offline";
        return;
    }
    state.all.items = res.data.boards || [];
    state.all.status = "live";
}

function maybeRefreshKind(kind) {
    let c = state.byKind.get(kind);
    if (!c) {
        c = { status: "idle", items: [], fetchedAt: 0, inflight: false };
        state.byKind.set(kind, c);
    }
    if (c.inflight) return;
    if (c.fetchedAt && (Date.now() - c.fetchedAt < TTL)) return;
    refreshKind(kind);
}

async function refreshKind(kind) {
    const c = state.byKind.get(kind);
    if (!c || c.inflight) return;
    c.inflight = true;
    if (!c.fetchedAt) c.status = "loading";
    let res;
    try { res = await gatewayClient.fetchLeaderboard(kind, 25); }
    catch (_e) { res = { ok: false }; }
    c.fetchedAt = Date.now();
    c.inflight = false;
    if (!res || !res.ok || !res.data) {
        c.status = "offline";
        return;
    }
    c.items = res.data.items || [];
    c.status = "live";
}

function normaliseColor(c) {
    if (c == null) return null;
    if (typeof c === "number") return "#" + c.toString(16).padStart(6, "0");
    return String(c);
}

const KIND_URL_RE = /^bucky:\/\/leaderboards\/([^/?#]+)$/;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
export function registerLeaderboardsSite(registry) {
    registry.register({
        id: "leaderboards-home",
        url: SITE_URL,
        site: SITE,
        title: "Grid Leaderboards",
        type: "home",
        keywords: ["leaderboards", "leaderboard", "rankings", "rank", "richest",
                   "level", "reputation", "leaked", "top", "best", "grid"],
        description: "Live Grid rankings — richest, highest-level, organisation reputation, most-leaked.",
        tags: ["leaderboards", "rankings"],
        render: () => renderHome(),
    });
    KINDS.forEach((k) => {
        registry.register({
            id: `leaderboards-${k.id}`,
            url: `bucky://leaderboards/${k.id}`,
            site: SITE,
            title: k.title,
            type: "index",
            keywords: ["leaderboard", k.id, "ranking", "top"],
            description: k.lead,
            tags: ["leaderboards", k.id],
            render: () => renderKind(k.id),
        });
    });
    if (typeof registry.registerMatcher === "function") {
        registry.registerMatcher({
            id: "leaderboards-by-kind",
            site: SITE,
            title: "Leaderboard",
            type: "index",
            match: (url) => KIND_URL_RE.test(String(url || "")),
            render: (url) => {
                const m = KIND_URL_RE.exec(String(url || ""));
                return renderKind(m ? m[1] : "");
            },
        });
    }
}

export function refreshLeaderboards() { return refreshAll(); }
export function invalidateLeaderboards() {
    state.all.fetchedAt = 0;
    state.byKind.forEach((v) => { v.fetchedAt = 0; });
}
