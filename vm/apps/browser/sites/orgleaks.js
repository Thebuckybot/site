/**
 * orgleaks.js — bucky://warroom  (v3 block 3: the war)
 *
 * What YOUR organisation has taken. Every row is one member of another
 * organisation whose bank code partially leaked during an attack you paid for.
 *
 *     bucky://warroom     the leak table: sort, filter, code search, paging
 *
 * WHY THIS IS A SEPARATE SITE FROM bucky://leaks
 *   bucky://leaks is the public OSINT archive: anonymous, world-wide, and
 *   powered by the leak engine (`player_exposures`). This one is private to a
 *   single organisation, powered by `org_leaks`, and it exists because that org
 *   spent credits on it. Same visual language, different ownership — and the
 *   ownership is the entire point, so it does not share a URL.
 *
 * WHY PAGING IS SERVER-SIDE HERE AND CLIENT-SIDE THERE
 *   bucky://leaks pages over a bounded window that fits in memory. This table
 *   can hold ten thousand rows for one org, and the interesting page is rarely
 *   the first. So the backend does keyset pagination (`?after_leaked_at=&
 *   after_id=`) and this module keeps a stack of the cursors it has walked.
 *   "Previous" pops that stack; it does not re-query with an offset, because
 *   there is no offset.
 *
 * WHAT IS DELIBERATELY MISSING
 *   There is no "dead" or "expired" marker. A leak whose victim rotated their
 *   code long ago sits between the fresh ones and looks exactly like them.
 *   Working out what is still worth trying is the game; a column that gives
 *   that away would remove it. The backend could not mark it anyway — the
 *   current bank code never leaves the bot.
 *
 * SAFETY
 *   Rows carry the MASKED snapshot only ("x7x3" = the second digit is a 7 and
 *   the fourth a 3). The full code is never stored here, never served and never
 *   rendered. Handles are the in-universe OSINT representation the rest of the
 *   VM already uses.
 *
 * ARCHITECTURE
 *   render() stays synchronous and pure; fetches happen beside it and dispatch
 *   `bucky:hydrated`. All text goes through the shared kit escaping.
 */
import { escapeHtml, link, chip, sitePage, crossRefs } from "./kit.js";
import { gatewayClient } from "../../../core/gatewayClient.js";

const SITE = "warroom";
const DOMAIN = "War Room";
const TTL = gatewayClient.softRefreshTtl || 60000;

const DISCLAIMER =
    "Every row is a partial snapshot taken at the moment of the attack. It is " +
    "not refreshed and it is not marked stale — an operator who has rotated " +
    "their code since looks exactly like one who has not.";

const SORTS = [
    { key: "recent", label: "Newest first" },
    { key: "revealed", label: "Most revealed" },
];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
const cache = { status: "idle", data: null, fetchedAt: 0, inflight: false, key: "" };

/**
 * `stack` is the cursor of every page BEFORE the current one, so "previous" is
 * a pop and not a second query language. The first entry is always null (the
 * first page has no cursor), which is why `page` is `stack.length`.
 */
const viewState = { sort: "recent", victimOrg: null, code: "", stack: [null] };

function currentCursor() { return viewState.stack[viewState.stack.length - 1]; }

function stateKey() {
    const c = currentCursor();
    return [viewState.sort, viewState.victimOrg || "", viewState.code,
            c ? `${c.revealed_count || ""}|${c.leaked_at || ""}|${c.id || ""}` : ""].join("::");
}

// ===========================================================================
// Fetching
// ===========================================================================
function maybeRefresh() {
    const key = stateKey();
    // EEN ANDERE FILTER IS EEN ANDERE VRAAG en geen verversing: zonder deze
    // vergelijking blijft de TTL van de vorige pagina staan en verspringt het
    // filter zonder dat de tabel meebeweegt.
    if (key !== cache.key) { cache.key = key; cache.fetchedAt = 0; }
    if (cache.inflight) return;
    if (cache.fetchedAt && (Date.now() - cache.fetchedAt < TTL)) return;
    doRefresh(key);
}

async function doRefresh(key) {
    cache.inflight = true;
    if (!cache.fetchedAt) cache.status = "loading";
    let res;
    try {
        res = await gatewayClient.fetchOrgLeaks({
            sort: viewState.sort,
            victim_org: viewState.victimOrg,
            code: viewState.code,
            cursor: currentCursor(),
        });
    } catch (_e) { res = { ok: false }; }
    cache.inflight = false;
    // EEN ANTWOORD OP EEN OUDE VRAAG WORDT WEGGEGOOID. Twee klikken snel achter
    // elkaar geven twee vluchten, en zonder deze regel wint de traagste.
    if (key !== cache.key) { notifyHydrated(); return; }
    cache.fetchedAt = Date.now();
    if (!res || !res.ok) { cache.status = "offline"; notifyHydrated(); return; }
    cache.data = (res.data && res.data.item) || null;
    cache.status = cache.data ? "loaded" : "empty";
    notifyHydrated();
}

function notifyHydrated() {
    if (typeof window === "undefined" || !window.dispatchEvent) return;
    try {
        window.dispatchEvent(new CustomEvent("bucky:hydrated", { detail: { source: SITE } }));
    } catch (_e) { /* noop */ }
}

// ===========================================================================
// Rendering
// ===========================================================================
function fmtAge(hours) {
    const h = Number(hours);
    if (!isFinite(h)) return "";
    if (h < 1) return "just now";
    if (h < 48) return `${Math.round(h)}h ago`;
    return `${Math.round(h / 24)}d ago`;
}

function codeCells(masked) {
    const tekens = String(masked || "").padEnd(4, "x").slice(0, 4).split("");
    return tekens.map((t) => {
        const bekend = /[0-9]/.test(t);
        return `<span class="vm-code-cell${bekend ? " is-known" : ""}">${escapeHtml(bekend ? t : "·")}</span>`;
    }).join("");
}

function renderRow(item) {
    const org = item.victim_org || {};
    return `
        <tr class="vm-leak-row">
            <td class="vm-leak-code">${codeCells(item.masked_code)}</td>
            <td class="vm-leak-left">${escapeHtml(String(item.combinations || 0))}</td>
            <td class="vm-leak-op">
                ${escapeHtml(item.handle || "unknown")}
                <span class="vm-leak-id">${escapeHtml(item.victim_id || "")}</span>
            </td>
            <td>${chip(`${org.emblem || ""} ${org.name || "—"}`.trim())}</td>
            <td class="vm-leak-age" title="${escapeHtml(item.leaked_at || "")}">${escapeHtml(fmtAge(item.age_hours))}</td>
        </tr>
    `;
}

function renderTable() {
    if (cache.status === "loading" && !cache.data) {
        return `<p class="vm-site-note">Reading the archive…</p>`;
    }
    if (cache.status === "offline") {
        return `<p class="vm-site-note">The archive is unreachable right now. Nothing has been lost — try again in a moment.</p>`;
    }
    const data = cache.data;
    if (!data) {
        return `<p class="vm-site-note">You are not in an organisation, so there is no archive to read.</p>`;
    }
    const items = data.items || [];
    if (!items.length) {
        // DRIE VERSCHILLENDE LEGES, en ze betekenen niet hetzelfde: nooit iets
        // buitgemaakt, alles verlopen, of een filter dat niets vindt. Een
        // gedeelde "geen resultaten" laat een leider denken dat zijn aanval
        // niets deed.
        if (viewState.code || viewState.victimOrg) {
            return `<p class="vm-site-note">No rows match that filter. The archive holds ${escapeHtml(String(data.total || 0))} row(s) in total.</p>`;
        }
        return `<p class="vm-site-note">Nothing here yet. Leaks appear while an attack rolls out, and they are kept for ${escapeHtml(String(data.retention_days || 10))} days.</p>`;
    }
    return `
        <table class="vm-leak-table">
            <thead>
                <tr>
                    <th>Code</th><th>Left</th><th>Operator</th>
                    <th>Organisation</th><th>Leaked</th>
                </tr>
            </thead>
            <tbody>${items.map(renderRow).join("")}</tbody>
        </table>
    `;
}

function renderControls() {
    const data = cache.data || {};
    const bronnen = data.sources || [];
    const sortKnoppen = SORTS.map((s) => {
        const actief = viewState.sort === s.key ? " is-active" : "";
        return `<button class="vm-osint-filter${actief}" data-inpage-act="sort" data-inpage-val="${escapeHtml(s.key)}">${escapeHtml(s.label)}</button>`;
    }).join("");
    const bronKnoppen = [`<button class="vm-osint-filter${viewState.victimOrg ? "" : " is-active"}" data-inpage-act="source" data-inpage-val="">All</button>`]
        .concat(bronnen.map((b) => {
            const actief = String(viewState.victimOrg) === String(b.org_id) ? " is-active" : "";
            return `<button class="vm-osint-filter${actief}" data-inpage-act="source" data-inpage-val="${escapeHtml(String(b.org_id))}">${escapeHtml(`${b.emblem || ""} ${b.name || b.slug || b.org_id}`.trim())} <span class="vm-osint-count">${escapeHtml(String(b.count || 0))}</span></button>`;
        })).join("");

    return `
        <div class="vm-osint-controls" data-warroom="controls">
            <label class="vm-osint-search">
                <span>Code pattern</span>
                <input type="text" maxlength="4" placeholder="x7x3"
                       data-inpage-act="search" value="${escapeHtml(viewState.code)}">
            </label>
            <div class="vm-osint-filters">${sortKnoppen}</div>
            <div class="vm-osint-filters">${bronKnoppen}</div>
        </div>
    `;
}

function renderSummary() {
    const data = cache.data || {};
    const pagina = viewState.stack.length;
    const getoond = (data.items || []).length;
    return `<p class="vm-osint-summary-line">Page ${escapeHtml(String(pagina))} · ${escapeHtml(String(getoond))} of ${escapeHtml(String(data.total || 0))} row(s) · kept for ${escapeHtml(String(data.retention_days || 10))} days</p>`;
}

function renderPager() {
    const data = cache.data || {};
    const terug = viewState.stack.length > 1
        ? `<button class="vm-osint-pgbtn" data-inpage-act="prev">Previous</button>`
        : `<span class="vm-osint-pgbtn is-off">Previous</span>`;
    const verder = data.next_cursor
        ? `<button class="vm-osint-pgbtn" data-inpage-act="next">Next</button>`
        : `<span class="vm-osint-pgbtn is-off">Next</span>`;
    return `${terug}${verder}`;
}

function renderHome() {
    maybeRefresh();
    registerController();

    const body = `
        <div class="vm-wiki-body vm-osint" data-inpage="${SITE}">
            <div class="vm-leak-notice">${escapeHtml(DISCLAIMER)}</div>
            ${renderControls()}
            <div class="vm-osint-summary" data-warroom="summary">${renderSummary()}</div>
            <div data-warroom="table">${renderTable()}</div>
            <div data-warroom="pager">${renderPager()}</div>
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://leaks", label: "Leak Database", note: "the public OSINT archive" },
                { url: "bucky://organizations", label: "Organisations", note: "who you are up against" },
                { url: "bucky://profile", label: "Your operator profile", note: "your own exposure" },
            ])}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · bucky://warroom`,
        title: "War Room",
        lead: "What your organisation has taken. Fresh rows are worth more than old ones.",
        bodyHtml: body,
    });
}

// ===========================================================================
// In-page controller
// ===========================================================================
const controller = {
    onSearch(value, host) {
        // ALLEEN CIJFERS EN JOKERS, en hoogstens vier. De backend wijst de rest
        // toch af (een witte lijst, geen escape), maar dan is de tabel al leeg
        // geweest - hier filteren betekent dat er niets gebeurt wat er niet
        // hoort te gebeuren.
        viewState.code = String(value || "").replace(/[^0-9xX?]/g, "").slice(0, 4);
        viewState.stack = [null];
        repaint(host);
    },
    onAction(act, val, host) {
        if (act === "sort") {
            viewState.sort = SORTS.some((s) => s.key === val) ? val : "recent";
            viewState.stack = [null];
        } else if (act === "source") {
            const n = parseInt(val, 10);
            viewState.victimOrg = isFinite(n) && n > 0 ? n : null;
            viewState.stack = [null];
        } else if (act === "next") {
            const volgende = (cache.data || {}).next_cursor;
            if (!volgende) return;
            viewState.stack.push(volgende);
        } else if (act === "prev") {
            if (viewState.stack.length <= 1) return;
            viewState.stack.pop();
        } else {
            return;
        }
        repaint(host);
    },
};

function repaint(host) {
    maybeRefresh();
    setHtml(host, '[data-warroom="controls"]', renderControls());
    setHtml(host, '[data-warroom="summary"]', renderSummary());
    setHtml(host, '[data-warroom="table"]', renderTable());
    setHtml(host, '[data-warroom="pager"]', renderPager());
}

function setHtml(host, selector, html) {
    const scope = host || (typeof document !== "undefined" && document.querySelector(`[data-inpage="${SITE}"]`));
    if (!scope) return;
    const el = scope.querySelector(selector);
    if (el) el.innerHTML = html;
}

function registerController() {
    if (typeof window === "undefined") return;
    window.__buckyInpage = window.__buckyInpage || {};
    window.__buckyInpage[SITE] = controller;
}

// ===========================================================================
// Registration
// ===========================================================================
export function registerWarRoomSite(registry) {
    registry.register({
        id: "warroom-home",
        url: "bucky://warroom",
        site: SITE,
        title: "War Room",
        type: "home",
        keywords: ["warroom", "war", "leaks", "org", "organisation", "attack",
                   "bank code", "archive", "intel", "haul"],
        description: "Your organisation's private leak archive — what its attacks have taken.",
        tags: ["warroom", "site", "osint", "org"],
        render: () => renderHome(),
    });
}

/** Boot-time preload. No-op without a session: this page is members-only. */
export function preloadWarRoom() {
    if (!gatewayClient.hasAuthToken || !gatewayClient.hasAuthToken()) return;
    maybeRefresh();
}
