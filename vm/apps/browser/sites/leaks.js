/**
 * Leak Database — bucky://leaks  (Phase 4.3 OSINT expansion)
 *
 * The first true OSINT application inside the Bucky VM. This page is NO LONGER
 * a static lore archive — every record is REAL leak data served by the backend
 * osint_service (powered by player_exposures + the live `breached` flag):
 *
 *   bucky://leaks                      breach-database home:
 *                                        • statistics block
 *                                        • incident index (real incidents)
 *                                        • exposed-operator index (real ops)
 *                                        • live search + severity filter + paging
 *   bucky://leaks/incident/<LEAK-id>   incident detail: header + affected ops
 *
 * IN-UNIVERSE / SAFETY
 *   Operator handles come from the public Discord display name; the
 *   `<handle>@bucky.net` address is a FICTIONAL OSINT representation generated
 *   by the backend — real Discord emails are never read or shown. Credential
 *   snippets are masked snapshots (e.g. "2x7x"); the real bank code never
 *   leaves the bot.
 *
 * ARCHITECTURE (preserved)
 *   • SiteRegistry/EventBus/GatewayClient/BrowserApp untouched in spirit. The
 *     home reads from module caches and soft-refreshes on a TTL (the same
 *     pattern as profile.js); it dispatches `bucky:hydrated` so the BrowserApp
 *     re-renders in place. No websockets, no polling, no realtime sync.
 *   • Search / severity-filter / pagination are handled CLIENT-SIDE over a
 *     bounded operator window + the small incident set, via a tiny in-page
 *     controller registered on window.__buckyInpage (the generic BrowserApp
 *     hook). Live search updates only the result subtrees — the input keeps
 *     focus. Incident DETAIL is lazy-loaded on navigation.
 *
 * EXTENSION POINTS (Phase 4.4+, prepared not built)
 *   The controller + cache shape is reusable by future OSINT surfaces
 *   (Mail Relay, Database Viewer, Intelligence Reports, Network Recon,
 *   Exposure Correlation). They register sibling sites and a sibling
 *   controller id; nothing here needs to change.
 */
import { escapeHtml, link, chip, sitePage, crossRefs } from "./kit.js";
import { gatewayClient } from "../../../core/gatewayClient.js";

const SITE = "leaks";
const DOMAIN = "Leak Database";
const PAGE_SIZE = 50;
const TTL = gatewayClient.softRefreshTtl || 60000;

const DISCLAIMER =
    "Operator handles, @bucky.net addresses and masked credential snippets are " +
    "in-universe OSINT representations. No real email address or usable secret is shown.";

// Severity vocabulary (engine emits low|medium|high|severe).
const SEV = {
    low:    { label: "Low",    cls: "is-low" },
    medium: { label: "Medium", cls: "is-medium" },
    high:   { label: "High",   cls: "is-high" },
    severe: { label: "Severe", cls: "is-severe" },
};
const SEV_FILTERS = ["all", "low", "medium", "high", "severe"];

// ---------------------------------------------------------------------------
// Module state — caches + the client-side browse state.
// ---------------------------------------------------------------------------
const statsCache     = { status: "idle", data: null, fetchedAt: 0, inflight: false };
const incidentsCache = { status: "idle", items: [], fetchedAt: 0, inflight: false };
const operatorsCache = { status: "idle", records: [], fetchedAt: 0, inflight: false };
const detailCache    = new Map(); // "LEAK-0008::1" -> { status, data, fetchedAt, inflight }

const viewState = { q: "", severity: "all", incPage: 1, opPage: 1 };

// Simulation mode: when > 0, the page renders the FICTIONAL +leaks test dataset
// (bucky://leaks?test=N) through these exact same paths. 0 = live real data.
let testSize = 0;

// ===========================================================================
// Soft-refresh lifecycle (mirrors profile.js)
// ===========================================================================
function maybeRefresh(cache, fetchFn, assign) {
    if (cache.inflight) return;
    if (cache.fetchedAt && (Date.now() - cache.fetchedAt < TTL)) return;
    doRefresh(cache, fetchFn, assign);
}

async function doRefresh(cache, fetchFn, assign) {
    if (cache.inflight) return;
    cache.inflight = true;
    if (!cache.fetchedAt) cache.status = "loading";
    let res;
    try { res = await fetchFn(); } catch (_e) { res = { ok: false }; }
    cache.fetchedAt = Date.now();
    cache.inflight = false;
    if (!res || !res.ok) { cache.status = "offline"; notifyHydrated(); return; }
    try { assign(res.data || {}); } catch (_e) { /* keep last good */ }
    cache.status = "loaded";
    notifyHydrated();
}

function refreshHomeData() {
    const t = testSize || undefined;
    maybeRefresh(statsCache, () => gatewayClient.fetchLeakStats(t),
        (d) => { statsCache.data = d || {}; });
    maybeRefresh(incidentsCache, () => gatewayClient.fetchLeakIncidents(t),
        (d) => { incidentsCache.items = (d && d.items) || []; });
    maybeRefresh(operatorsCache, () => gatewayClient.fetchLeakOperators(undefined, t),
        (d) => { operatorsCache.records = (d && d.records) || []; });
}

function notifyHydrated() {
    if (typeof window === "undefined" || !window.dispatchEvent) return;
    try {
        window.dispatchEvent(new CustomEvent("bucky:hydrated", { detail: { source: "leaks" } }));
    } catch (_e) { /* noop */ }
}

// ===========================================================================
// Small render helpers
// ===========================================================================
function sevMeta(s) { return SEV[String(s || "").toLowerCase()] || SEV.low; }
function severityBadge(s) {
    const m = sevMeta(s);
    return `<span class="vm-leak-sev ${m.cls}">${escapeHtml(m.label)}</span>`;
}
function incidentUrl(id, test) {
    const base = `bucky://leaks/incident/${String(id || "").toLowerCase()}`;
    return test ? `${base}?test=${test}` : base;
}
function detailUrl(id, page, test) {
    const params = [];
    if (page && page > 1) params.push("page=" + page);
    if (test) params.push("test=" + test);
    return `bucky://leaks/incident/${String(id || "").toLowerCase()}` + (params.length ? "?" + params.join("&") : "");
}
function profileUrl(uid) { return `bucky://profile/${encodeURIComponent(String(uid || ""))}`; }

function renderSimBanner() {
    return `
        <div class="vm-osint-simbanner" role="status">
            <span class="vm-osint-simdot" aria-hidden="true"></span>
            <strong>SIMULATION MODE</strong> — showing ${testSize} fictional operators from
            <code>+leaks test ${testSize}</code>. No real exposures, profiles or DMs are involved.
            ${link("bucky://leaks", "Exit to live data")}
        </div>
    `;
}

function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function statTile(label, value, accentClass) {
    return `
        <div class="vm-osint-stat${accentClass ? " " + accentClass : ""}">
            <span class="vm-osint-stat-val">${value}</span>
            <span class="vm-osint-stat-label">${escapeHtml(label)}</span>
        </div>
    `;
}

// ===========================================================================
// Statistics block
// ===========================================================================
function renderStats() {
    const s = statsCache.data && statsCache.data.stats;
    if (!s) {
        const msg = statsCache.status === "offline"
            ? "Statistics feed offline; retrying shortly."
            : "Loading breach statistics from the Grid…";
        return `<div class="vm-osint-statbar is-empty"><span class="vm-dev-feeddot"></span>${escapeHtml(msg)}</div>`;
    }
    const hs = s.highest_severity ? sevMeta(s.highest_severity).label : "—";
    const recentTitle = (s.most_recent && s.most_recent.title) || "—";
    const recentAt = s.most_recent && s.most_recent.at ? formatDate(s.most_recent.at) : "";
    return `
        <div class="vm-osint-statbar">
            ${statTile("Leak incidents", String(s.total_incidents || 0))}
            ${statTile("Exposed operators", String(s.total_exposed_operators || 0))}
            ${statTile("Active compromised", String(s.active_compromised || 0), "is-alert")}
            ${statTile("Highest severity", escapeHtml(hs), "is-sevtile")}
            ${statTile("Most recent", `${escapeHtml(recentTitle)}${recentAt ? ` <small>${escapeHtml(recentAt)}</small>` : ""}`)}
        </div>
    `;
}

// ===========================================================================
// Search + filter chrome
// ===========================================================================
function renderControls() {
    return `
        <div class="vm-osint-controls">
            <div class="vm-osint-searchwrap">
                <span class="vm-osint-searchglyph" aria-hidden="true">&#9906;</span>
                <input class="vm-osint-search" type="text" spellcheck="false" autocomplete="off"
                       placeholder="Search operators, LEAK id, severity, incident…"
                       aria-label="Search the leak database"
                       data-inpage-act="search" value="${escapeHtml(viewState.q)}">
            </div>
            <div class="vm-osint-filters" data-osint="filters">${renderFilterChips()}</div>
        </div>
    `;
}

function renderFilterChips() {
    return SEV_FILTERS.map((f) => {
        const active = viewState.severity === f ? " is-active" : "";
        const label = f === "all" ? "All" : sevMeta(f).label;
        return `<button class="vm-osint-filter${active}" data-inpage-act="filter" data-inpage-val="${f}">${escapeHtml(label)}</button>`;
    }).join("");
}

// ===========================================================================
// Filtering + pagination (pure, client-side)
// ===========================================================================
function matchSeverity(sev) {
    return viewState.severity === "all" || String(sev || "").toLowerCase() === viewState.severity;
}
function q() { return viewState.q.trim().toLowerCase(); }

function filteredIncidents() {
    const query = q();
    return (incidentsCache.items || []).filter((i) => {
        if (!matchSeverity(i.severity)) return false;
        if (!query) return true;
        return String(i.title || "").toLowerCase().includes(query)
            || String(i.incident_id || "").toLowerCase().includes(query)
            || sevMeta(i.severity).label.toLowerCase() === query;
    });
}

function filteredOperators() {
    const query = q();
    return (operatorsCache.records || []).filter((o) => {
        if (!matchSeverity(o.severity)) return false;
        if (!query) return true;
        return String(o.handle || "").toLowerCase().includes(query)
            || String(o.email || "").toLowerCase().includes(query)
            || String(o.incident_title || "").toLowerCase().includes(query)
            || String(o.incident_id || "").toLowerCase().includes(query)
            || String(o.masked_credential || "").toLowerCase().includes(query)
            || sevMeta(o.severity).label.toLowerCase() === query;
    });
}

function pageCount(total) { return Math.max(1, Math.ceil(total / PAGE_SIZE)); }
function clampPage(n, pages) {
    const p = parseInt(n, 10);
    if (isNaN(p)) return 1;
    return Math.min(Math.max(1, p), pages);
}
function pageSlice(arr, page) {
    const start = (page - 1) * PAGE_SIZE;
    return arr.slice(start, start + PAGE_SIZE);
}

function pager(section, page, pages) {
    if (pages <= 1) return "";
    const btn = (target, label, disabled) => disabled
        ? `<span class="vm-osint-pgbtn is-disabled">${label}</span>`
        : `<button class="vm-osint-pgbtn" data-inpage-act="${section}page" data-inpage-val="${target}">${label}</button>`;
    return `
        <div class="vm-osint-pager">
            ${btn(page - 1, "&#8592; Previous", page <= 1)}
            <span class="vm-osint-pgnum">Page ${page} / ${pages}</span>
            ${btn(page + 1, "Next &#8594;", page >= pages)}
        </div>
    `;
}

// ===========================================================================
// Incident list
// ===========================================================================
function renderIncidentResults() {
    const all = filteredIncidents();
    const pages = pageCount(all.length);
    viewState.incPage = Math.min(viewState.incPage, pages);
    if (!incidentsCache.items.length) {
        const msg = incidentsCache.status === "offline"
            ? "Incident feed offline; retrying shortly."
            : (incidentsCache.status === "loaded"
                ? "No leak incidents recorded yet. When the leak engine fires, real incidents appear here."
                : "Loading incidents…");
        return `<p class="vm-dev-note">${escapeHtml(msg)}</p>`;
    }
    if (!all.length) return `<p class="vm-dev-note">No incidents match the current search / filter.</p>`;
    const cards = pageSlice(all, viewState.incPage).map((i) => `
        <article class="vm-leak-card">
            <div class="vm-leak-card-head">
                <span class="vm-leak-id">${escapeHtml(i.incident_id || "LEAK-????")}</span>
                ${severityBadge(i.severity)}
            </div>
            <h3>${link(incidentUrl(i.incident_id, testSize), i.title || "Untitled incident", "vm-leak-card-title")}</h3>
            <div class="vm-leak-card-stats">
                <span>${escapeHtml(String(i.affected_operators || 0))} operators</span>
                <span>${escapeHtml(String(i.exposure_count || 0))} exposures</span>
                <span>${escapeHtml(formatDate(i.last_seen))}</span>
            </div>
            <p class="vm-leak-more">${link(incidentUrl(i.incident_id, testSize), "Open incident &#8250;")}</p>
        </article>
    `).join("");
    return `<div class="vm-leak-grid">${cards}</div>`;
}

function renderIncidentPager() {
    return pager("inc", viewState.incPage, pageCount(filteredIncidents().length));
}

// ===========================================================================
// Exposed-operator index
// ===========================================================================
function renderOperatorResults() {
    const all = filteredOperators();
    const pages = pageCount(all.length);
    viewState.opPage = Math.min(viewState.opPage, pages);
    if (!operatorsCache.records.length) {
        const msg = operatorsCache.status === "offline"
            ? "Operator index offline; retrying shortly."
            : (operatorsCache.status === "loaded"
                ? "No exposed operators on record yet."
                : "Loading exposed operators…");
        return `<p class="vm-dev-note">${escapeHtml(msg)}</p>`;
    }
    if (!all.length) return `<p class="vm-dev-note">No operators match the current search / filter.</p>`;
    const rows = pageSlice(all, viewState.opPage).map((o) => `
        <tr>
            <td class="vm-leak-handle">${link(profileUrl(o.user_id), o.handle || "operator")}</td>
            <td class="vm-osint-email">${escapeHtml(o.email || "")}</td>
            <td class="vm-leak-cred">${escapeHtml(o.masked_credential || "")}</td>
            <td>${severityBadge(o.severity)}</td>
            <td>${o.incident_id ? link(incidentUrl(o.incident_id, testSize), o.incident_id) : escapeHtml(o.incident_title || "—")}</td>
            <td>${escapeHtml(formatDate(o.leaked_at))}</td>
        </tr>
    `).join("");
    return `
        <div class="vm-leak-tablewrap">
            <table class="vm-leak-table vm-osint-optable">
                <thead><tr>
                    <th>Operator</th><th>Exposed address</th><th>Snippet</th>
                    <th>Severity</th><th>Incident</th><th>Logged</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function renderOperatorPager() {
    return pager("op", viewState.opPage, pageCount(filteredOperators().length));
}

function renderSummary() {
    const inc = filteredIncidents().length;
    const ops = filteredOperators().length;
    const scope = viewState.q || viewState.severity !== "all" ? "match" : "on record";
    return `${inc} incident${inc === 1 ? "" : "s"} &middot; ${ops} exposure${ops === 1 ? "" : "s"} ${escapeHtml(scope)}`;
}

// ===========================================================================
// The home page
// ===========================================================================
function renderHome(ctx) {
    // Simulation-mode switch — read ?test=N and reset caches when it changes.
    const t = parseInt((ctx && ctx.query && ctx.query.test) || "0", 10);
    const newTest = (!isNaN(t) && t > 0) ? Math.min(t, 500) : 0;
    if (newTest !== testSize) {
        testSize = newTest;
        statsCache.fetchedAt = 0;
        incidentsCache.fetchedAt = 0;
        operatorsCache.fetchedAt = 0;
        viewState.incPage = 1;
        viewState.opPage = 1;
    }
    refreshHomeData();
    registerController();

    const body = `
        <div class="vm-wiki-body vm-osint" data-inpage="leaks">
            ${testSize ? renderSimBanner() : ""}
            ${renderStats()}
            <div class="vm-leak-notice">${escapeHtml(DISCLAIMER)}</div>
            ${renderControls()}
            <div class="vm-osint-summary" data-osint="summary">${renderSummary()}</div>

            <section class="vm-wiki-section">
                <h2>Incidents</h2>
                <div data-osint="incidents-results">${renderIncidentResults()}</div>
                <div data-osint="incidents-pager">${renderIncidentPager()}</div>
            </section>

            <section class="vm-wiki-section">
                <h2>Exposed operators</h2>
                <div data-osint="operators-results">${renderOperatorResults()}</div>
                <div data-osint="operators-pager">${renderOperatorPager()}</div>
            </section>

            ${crossRefs("Across BuckyNet", [
                { url: "bucky://profile", label: "Your operator profile", note: "your own exposure archive" },
                { url: "bucky://leaderboards", label: "Leaderboards", note: "most-leaked operators" },
                { url: "bucky://wiki/static-den", label: "BuckyWiki: The Static Den", note: "OSINT lore" }
            ])}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} &middot; bucky://leaks`,
        title: "Leak Database",
        lead: "Live OSINT breach archive — real incidents, real exposed operators.",
        bodyHtml: body,
    });
}

// ===========================================================================
// In-page controller (registered for the generic BrowserApp hook)
// ===========================================================================
const controller = {
    onSearch(value, host) {
        viewState.q = String(value || "");
        viewState.incPage = 1;
        viewState.opPage = 1;
        repaintAll(host);
    },
    onAction(act, val, host) {
        if (act === "filter") {
            viewState.severity = SEV_FILTERS.includes(val) ? val : "all";
            viewState.incPage = 1;
            viewState.opPage = 1;
            repaintAll(host);
            setHtml(host, '[data-osint="filters"]', renderFilterChips());
        } else if (act === "incpage") {
            viewState.incPage = clampPage(val, pageCount(filteredIncidents().length));
            setHtml(host, '[data-osint="incidents-results"]', renderIncidentResults());
            setHtml(host, '[data-osint="incidents-pager"]', renderIncidentPager());
        } else if (act === "oppage") {
            viewState.opPage = clampPage(val, pageCount(filteredOperators().length));
            setHtml(host, '[data-osint="operators-results"]', renderOperatorResults());
            setHtml(host, '[data-osint="operators-pager"]', renderOperatorPager());
        }
    },
};

function repaintAll(host) {
    setHtml(host, '[data-osint="summary"]', renderSummary());
    setHtml(host, '[data-osint="incidents-results"]', renderIncidentResults());
    setHtml(host, '[data-osint="incidents-pager"]', renderIncidentPager());
    setHtml(host, '[data-osint="operators-results"]', renderOperatorResults());
    setHtml(host, '[data-osint="operators-pager"]', renderOperatorPager());
}

function setHtml(host, selector, html) {
    const scope = host || (typeof document !== "undefined" && document.querySelector('[data-inpage="leaks"]'));
    if (!scope) return;
    const el = scope.querySelector(selector);
    if (el) el.innerHTML = html;
}

function registerController() {
    if (typeof window === "undefined") return;
    window.__buckyInpage = window.__buckyInpage || {};
    window.__buckyInpage.leaks = controller;
}

// ===========================================================================
// Incident detail page (lazy-loaded on navigation)
// ===========================================================================
function detailKey(id, page, test) { return `${String(id).toUpperCase()}::${page}::${test || 0}`; }

function maybeRefreshDetail(id, page, test) {
    const key = detailKey(id, page, test);
    let c = detailCache.get(key);
    if (!c) { c = { status: "idle", data: null, fetchedAt: 0, inflight: false }; detailCache.set(key, c); }
    if (c.inflight) return c;
    if (c.fetchedAt && (Date.now() - c.fetchedAt < TTL)) return c;
    c.inflight = true;
    if (!c.fetchedAt) c.status = "loading";
    gatewayClient.fetchLeakIncident(id, page, test || undefined).then((res) => {
        c.fetchedAt = Date.now();
        c.inflight = false;
        if (!res || !res.ok) { c.status = res && res.status === 404 ? "missing" : "offline"; notifyHydrated(); return; }
        c.data = (res.data && res.data.incident) || null;
        c.status = c.data ? "loaded" : "missing";
        notifyHydrated();
    }).catch(() => { c.inflight = false; c.status = "offline"; notifyHydrated(); });
    return c;
}

function renderIncidentDetail(ctx) {
    ctx = (ctx && typeof ctx === "object") ? ctx : {};
    // id from the resolved path segments; fall back to parsing the raw url.
    let id = (ctx.segments && ctx.segments[ctx.segments.length - 1]) || "";
    if (!id && ctx.url) {
        const m = /\/incident\/([^/?#]+)/i.exec(String(ctx.url));
        id = m ? m[1] : "";
    }
    const page = Math.max(1, parseInt((ctx.query && ctx.query.page) || "1", 10) || 1);
    const t = parseInt((ctx.query && ctx.query.test) || "0", 10);
    const test = (!isNaN(t) && t > 0) ? Math.min(t, 500) : 0;
    const c = maybeRefreshDetail(id, page, test);
    const backUrl = test ? `bucky://leaks?test=${test}` : "bucky://leaks";

    let body;
    if (c.status === "missing") {
        body = `<div class="vm-wiki-body"><p>No incident on record for <code>${escapeHtml(String(id).toUpperCase())}</code>.</p>
            <p class="vm-leak-more">${link(backUrl, "&#8249; Back to the Leak Database")}</p></div>`;
    } else if (c.status === "offline") {
        body = `<div class="vm-wiki-body"><div class="vm-dev-feedstatus is-offline"><span class="vm-dev-feeddot"></span>
            Incident feed offline; try again in a moment.</div></div>`;
    } else if (!c.data) {
        body = `<div class="vm-wiki-body"><div class="vm-dev-feedstatus is-loading"><span class="vm-dev-feeddot"></span>
            Loading incident from the Grid…</div></div>`;
    } else {
        body = renderIncidentDetailBody(c.data, test, backUrl);
    }
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} &middot; bucky://leaks/incident/${escapeHtml(String(id).toLowerCase())}`,
        title: (c.data && c.data.title) || String(id).toUpperCase(),
        lead: c.data ? `${c.data.incident_id} &middot; ${sevMeta(c.data.severity).label} severity` : "Incident report",
        bodyHtml: body,
    });
}

function renderIncidentDetailBody(d, test, backUrl) {
    const rows = (d.operators || []).map((o) => `
        <tr>
            <td class="vm-leak-handle">${link(profileUrl(o.user_id), o.handle || "operator")}</td>
            <td class="vm-osint-email">${escapeHtml(o.email || "")}</td>
            <td class="vm-leak-cred">${escapeHtml(o.masked_credential || "")}</td>
            <td>${severityBadge(o.severity)}</td>
            <td>${escapeHtml(formatDate(o.leaked_at))}</td>
        </tr>
    `).join("");

    const opsTable = (d.operators && d.operators.length)
        ? `<div class="vm-leak-tablewrap"><table class="vm-leak-table vm-osint-optable">
               <thead><tr><th>Operator</th><th>Exposed address</th><th>Snippet</th><th>Severity</th><th>Logged</th></tr></thead>
               <tbody>${rows}</tbody></table></div>`
        : `<p class="vm-dev-note">No affected operators on this page.</p>`;

    // Detail pagination is navigation-based (lazy detail load), one page of 50.
    let detailPager = "";
    if ((d.pages || 1) > 1) {
        const prev = d.page > 1
            ? link(detailUrl(d.incident_id, d.page - 1, test), "&#8592; Previous")
            : `<span class="vm-osint-pgbtn is-disabled">&#8592; Previous</span>`;
        const next = d.page < d.pages
            ? link(detailUrl(d.incident_id, d.page + 1, test), "Next &#8594;")
            : `<span class="vm-osint-pgbtn is-disabled">Next &#8594;</span>`;
        detailPager = `<div class="vm-osint-pager">${prev}<span class="vm-osint-pgnum">Page ${d.page} / ${d.pages}</span>${next}</div>`;
    }

    return `
        <div class="vm-wiki-body">
            <div class="vm-leak-incident-head">
                <span class="vm-leak-id">${escapeHtml(d.incident_id || "")}</span>
                ${severityBadge(d.severity)}
            </div>
            <div class="vm-leak-incident-grid">
                <div class="vm-wiki-info-row"><span>Severity</span><strong>${escapeHtml(sevMeta(d.severity).label)}</strong></div>
                <div class="vm-wiki-info-row"><span>Affected operators</span><strong>${escapeHtml(String(d.affected_operators || 0))}</strong></div>
                <div class="vm-wiki-info-row"><span>Exposures</span><strong>${escapeHtml(String(d.exposure_count || 0))}</strong></div>
                <div class="vm-wiki-info-row"><span>First seen</span><strong>${escapeHtml(formatDate(d.first_seen))}</strong></div>
                <div class="vm-wiki-info-row"><span>Last seen</span><strong>${escapeHtml(formatDate(d.last_seen))}</strong></div>
            </div>
            <div class="vm-leak-notice">${escapeHtml(DISCLAIMER)}</div>
            <section class="vm-wiki-section">
                <h2>Incident report</h2>
                <p>${escapeHtml(d.description || "")}</p>
            </section>
            <section class="vm-wiki-section">
                <h2>Affected operators (${escapeHtml(String(d.total || (d.operators || []).length))})</h2>
                ${opsTable}
                ${detailPager}
            </section>
            <p class="vm-leak-more">${link(backUrl || "bucky://leaks", "&#8249; Back to the Leak Database")}</p>
        </div>
    `;
}

// ===========================================================================
// Registration
// ===========================================================================
const INCIDENT_URL_RE = /^bucky:\/\/leaks\/incident\/[^/?#]+$/i;

export function registerLeaksSite(registry) {
    registry.register({
        id: "leaks-home",
        url: "bucky://leaks",
        site: SITE,
        title: "Leak Database",
        type: "home",
        keywords: ["leaks", "leak", "breach", "breaches", "osint", "exposed", "dump",
                   "incident", "credential", "compromised", "operators", "database"],
        description: "BuckyNet's live OSINT breach database — real incidents and exposed operators.",
        tags: ["leaks", "site", "osint"],
        render: (ctx) => renderHome(ctx),
    });

    if (typeof registry.registerMatcher === "function") {
        registry.registerMatcher({
            id: "leaks-incident-detail",
            site: SITE,
            title: "Leak Incident",
            type: "incident",
            keywords: ["leak", "incident", "breach", "osint"],
            tags: ["leaks", "incident", "osint"],
            match: (url) => INCIDENT_URL_RE.test(String(url || "")),
            // SiteRegistry invokes a matcher as render(url, ctx) — the URL is
            // the FIRST arg, the context object the SECOND. We pass the ctx
            // through (with the url as a fallback) so the id / page / test are
            // read from the real context, not the URL string.
            render: (url, ctx) => renderIncidentDetail(ctx || { url: String(url || "") }),
        });
    }
}

/** Boot-time preload (additive, fire-and-forget) — mirrors the other live pages. */
export function preloadLeaks() {
    try { refreshHomeData(); } catch (_e) { /* never block VM boot */ }
}

export function invalidateLeaks() {
    statsCache.fetchedAt = 0;
    incidentsCache.fetchedAt = 0;
    operatorsCache.fetchedAt = 0;
    detailCache.clear();
}
