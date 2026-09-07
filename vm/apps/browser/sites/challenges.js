/**
 * challenges.js - bucky://bucky/challenges (7 September 2026).
 *
 * THE PAGE NOBODY HAD
 *   Challenges opened every day, week and month, and nothing on the site said
 *   so. This is the page: what is open right now and how far you are, what
 *   exists and will come round, what each one pays, exactly what to do to
 *   finish it - and the day's code challenge, set and checked by the server.
 *
 * THREE FEEDS, ONE RENDER
 *   /api/org/challenges/catalogue   public   - what exists (every enabled
 *                                              definition, targets per cadence,
 *                                              reward ranges, the one-minute rule)
 *   /api/org/challenges             session  - what is open for YOU and your
 *                                              progress on it
 *   /api/minigames/coding/state     both     - the day's code task; the standing
 *                                              only with a session
 *   render() stays synchronous and pure; the fetches are fire-and-forget with
 *   the soft-refresh lifecycle every identity-aware page uses, and a
 *   `bucky:hydrated` event asks the browser to re-render when data lands.
 *
 * THE BROWSER CANNOT PROVE ITS OWN RESULT
 *   Everything that pays is scored elsewhere: challenge progress in the bot at
 *   the emit point, the code challenge on the backend that generated it. This
 *   page reads, and for the code challenge it sends ONE number and shows what
 *   the server said. There is no client-side judging anywhere in this file.
 *
 * NOT THE VM LOOK
 *   Deliberately a modern, quiet layout (cards, a progress bar per objective,
 *   three columns on a wide screen, one on a phone) inside the red/black
 *   bucky-site frame - this is the "official platform" page, not a terminal.
 */
import { escapeHtml, link, chip, sitePage, crossRefs } from "./kit.js";
import { gatewayClient } from "../../../core/gatewayClient.js";

const SITE = "bucky";
const SITE_URL = "bucky://bucky/challenges";
const TTL = gatewayClient.softRefreshTtl || 60000;
const CADENCES = ["daily", "weekly", "monthly"];
const CADENCE_LABEL = { daily: "Today", weekly: "This week", monthly: "This month" };
const CADENCE_WORD = { daily: "daily", weekly: "weekly", monthly: "monthly" };
const CATEGORY_LABEL = {
    economic: "Economy", social: "Social", org: "Organization", skill: "Skill",
    defence: "Defence", cooperation: "Together", general: "General"
};

const cache = {
    catalogue: { status: "idle", data: null, fetchedAt: 0, inflight: false },
    mine: { status: "idle", data: null, fetchedAt: 0, inflight: false, unauthenticated: false },
    coding: { status: "idle", data: null, fetchedAt: 0, inflight: false, last: null, busy: false },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function num(n) {
    const v = Number(n) || 0;
    return v.toLocaleString("en-US");
}

function range(span) {
    if (!span) return "";
    const lo = Number(span.min) || 0;
    const hi = Number(span.max) || lo;
    return lo === hi ? num(lo) : `${num(lo)}–${num(hi)}`;
}

/** The noun behind a number - mirrors `unit_suffix` on the Discord card. */
function unitOf(o, count) {
    if (o.measure === "amount") {
        return Number(o.per) > 1 ? ` × ${num(o.per)} shards` : " shards";
    }
    const eigen = String(o.unit || "").trim();
    if (eigen) return count === 1 ? ` ${eigen}` : ` ${eigen}s`;
    return count === 1 ? " time" : " times";
}

function rewardText(reward) {
    const r = reward || {};
    const parts = [];
    if (r.shards) parts.push(`${num(r.shards)} shards`);
    if (r.rep) parts.push(`${num(r.rep)} REP`);
    if (r.chests) parts.push(`${num(r.chests)} chest${Number(r.chests) === 1 ? "" : "s"}`);
    if (r.org_shards) parts.push(`${num(r.org_shards)} shards for the winning faction`);
    return parts.join(" · ");
}

function rewardRangeText(reward) {
    const r = reward || {};
    const parts = [];
    if (r.shards) parts.push(`${range(r.shards)} shards`);
    if (r.rep) parts.push(`${range(r.rep)} REP`);
    if (r.chests && Number(r.chests.max) > 0) parts.push(`${range(r.chests)} chest`);
    if (r.org_shards) parts.push(`${range(r.org_shards)} for the winning treasury`);
    return parts.join(" · ");
}

function closesText(iso) {
    if (!iso) return "";
    const end = Date.parse(iso);
    if (Number.isNaN(end)) return "";
    const left = end - Date.now();
    if (left <= 0) return "closing";
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    if (h >= 48) return `closes in ${Math.floor(h / 24)} days`;
    if (h >= 1) return `closes in ${h}h ${m}m`;
    return `closes in ${m}m`;
}

function cooldownText(seconds) {
    const s = Number(seconds) || 0;
    if (s <= 0) return "every one counts";
    if (s <= 60) return "counted once per minute";
    return `counted once per ${s} seconds`;
}

function meter(percent, done) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    return `<div class="vm-chal-meter${done ? " is-done" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}">
        <span style="width:${p}%"></span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Open challenges (the operator's own board)
// ---------------------------------------------------------------------------
function renderObjective(o) {
    const target = Number(o.target) || 0;
    const value = Math.min(Number(o.value) || 0, target || Infinity);
    const raw = target ? Math.floor(value / target * 100) : 0;
    const percent = o.done ? 100 : (value > 0 ? Math.min(99, Math.max(2, raw)) : 0);
    const how = (o.how || "").trim() || "no description for this one";
    return `<li class="vm-chal-obj${o.done ? " is-done" : ""}">
        <div class="vm-chal-obj-row">
            <span class="vm-chal-obj-how">${o.done ? "✓ " : ""}${escapeHtml(how)}</span>
            <span class="vm-chal-obj-count">${num(value)}${target ? " / " + num(target) : ""}${escapeHtml(unitOf(o, target))}</span>
        </div>
        ${meter(percent, o.done)}
    </li>`;
}

function renderOpenCard(c) {
    const objectives = c.objectives || [];
    const done = objectives.filter((o) => o.done).length;
    return `<article class="vm-chal-card${c.done ? " is-done" : ""}">
        <header class="vm-chal-card-head">
            <div>
                <h3 class="vm-chal-title">${escapeHtml(c.title || c.definition_key || "?")}</h3>
                ${c.blurb ? `<p class="vm-chal-blurb">${escapeHtml(c.blurb)}</p>` : ""}
            </div>
            <div class="vm-chal-tags">
                ${chip(CATEGORY_LABEL[c.category] || c.category || "General")}
                ${c.scope === "global" ? chip("All factions") : chip("Your faction")}
            </div>
        </header>
        <ul class="vm-chal-objs">${objectives.map(renderObjective).join("")}</ul>
        <footer class="vm-chal-card-foot">
            <span class="vm-chal-reward">${escapeHtml(rewardText(c.reward))}</span>
            <span class="vm-chal-meta">${done}/${objectives.length} done · ${escapeHtml(closesText(c.ends_at))}</span>
        </footer>
    </article>`;
}

function renderOpenGroup(cadence, items) {
    return `<section class="vm-chal-group">
        <h2 class="vm-chal-h2">${escapeHtml(CADENCE_LABEL[cadence] || cadence)}</h2>
        <div class="vm-chal-grid">${items.map(renderOpenCard).join("")}</div>
    </section>`;
}

function renderBoard() {
    const m = cache.mine;
    if (m.unauthenticated) {
        return `<section class="vm-chal-note">
            <strong>Sign in to see your board.</strong> Log in on the arcade and this page shows
            what is open for you and how far you are. What exists is listed below either way.
        </section>`;
    }
    if (m.status === "offline") {
        return `<section class="vm-chal-note">BuckyNet could not reach the backend for your board. What exists is listed below.</section>`;
    }
    if (!m.data) {
        return `<section class="vm-chal-note vm-chal-loading">Loading your board…</section>`;
    }
    if (m.data.viewer === null) {
        return `<section class="vm-chal-note">
            <strong>You are not in an organization yet.</strong> Challenges score for members of
            one of the four factions: run <code>+chooseorg</code> in Discord, then come back.
        </section>`;
    }
    const items = m.data.items || [];
    if (!items.length) {
        return `<section class="vm-chal-note">Nothing is open right now. They rotate on their own; the short ones come back daily.</section>`;
    }
    const groups = CADENCES.map((c) => [c, items.filter((i) => i.cadence === c)]).filter(([, r]) => r.length);
    const rest = items.filter((i) => !CADENCES.includes(i.cadence));
    if (rest.length) groups.push(["other", rest]);
    return `<p class="vm-chal-status">${num(m.data.done_count || 0)} of ${num(items.length)} finished · a challenge pays when every line on it is full, at the moment it closes.</p>
        ${groups.map(([c, r]) => renderOpenGroup(c, r)).join("")}`;
}

// ---------------------------------------------------------------------------
// The catalogue: what exists and will come round
// ---------------------------------------------------------------------------
function renderCatalogueObjective(o, cadences) {
    const targets = cadences.map((c) => {
        const t = o.target && o.target[c];
        if (!t) return "";
        const hi = Number(t.max) || 0;
        return `<span class="vm-chal-target"><em>${escapeHtml(CADENCE_WORD[c] || c)}</em> ${range(t)}${escapeHtml(unitOf(o, hi))}</span>`;
    }).filter(Boolean).join("");
    return `<li class="vm-chal-cat-obj">
        <span class="vm-chal-obj-how">${escapeHtml(o.how || "")}</span>
        <span class="vm-chal-targets">${targets}</span>
        <span class="vm-chal-cd">${escapeHtml(cooldownText(o.cooldown_seconds))}</span>
    </li>`;
}

function renderCatalogueCard(d, openKeys) {
    const cadences = (d.cadences || []).filter((c) => CADENCES.includes(c));
    const isOpen = openKeys.has(d.key);
    const rewards = cadences.map((c) => `<span class="vm-chal-target"><em>${escapeHtml(CADENCE_WORD[c] || c)}</em> ${escapeHtml(rewardRangeText(d.reward && d.reward[c]))}</span>`).join("");
    return `<article class="vm-chal-card vm-chal-card-cat${isOpen ? " is-open" : ""}">
        <header class="vm-chal-card-head">
            <div>
                <h3 class="vm-chal-title">${escapeHtml(d.title)}</h3>
                ${d.blurb ? `<p class="vm-chal-blurb">${escapeHtml(d.blurb)}</p>` : ""}
            </div>
            <div class="vm-chal-tags">
                ${chip(CATEGORY_LABEL[d.category] || d.category || "General")}
                ${d.scope === "global" ? chip("All factions") : chip("Per faction")}
                ${d.needs_vm ? chip("Needs the VM") : ""}
                ${isOpen ? chip("Open now") : ""}
            </div>
        </header>
        <p class="vm-chal-cadences">Runs ${cadences.map((c) => escapeHtml(CADENCE_WORD[c] || c)).join(", ")}</p>
        <ul class="vm-chal-cat-objs">${(d.objectives || []).map((o) => renderCatalogueObjective(o, cadences)).join("")}</ul>
        <footer class="vm-chal-card-foot vm-chal-card-foot-stack">
            <span class="vm-chal-reward-label">Pays</span>
            <span class="vm-chal-targets">${rewards}</span>
        </footer>
    </article>`;
}

function renderCatalogue() {
    const c = cache.catalogue;
    if (c.status === "offline") {
        return `<section class="vm-chal-note">The catalogue could not be loaded. Connect to BuckyNet and try again.</section>`;
    }
    if (!c.data) {
        return `<section class="vm-chal-note vm-chal-loading">Loading the catalogue…</section>`;
    }
    const defs = c.data.definitions || [];
    const openKeys = new Set(((cache.mine.data && cache.mine.data.items) || []).map((i) => i.definition_key));
    const coming = defs.filter((d) => !openKeys.has(d.key));
    const open = defs.filter((d) => openKeys.has(d.key));
    const ordered = [...open, ...coming];
    return `<section class="vm-chal-group">
        <h2 class="vm-chal-h2">Coming up <span class="vm-chal-h2-sub">${num(defs.length)} kinds rotate · ${num(coming.length)} not open at the moment</span></h2>
        <p class="vm-chal-lead-small">Every kind below opens on its own, one per timescale per faction at a time. The numbers are ranges: each opening rolls its own target and reward inside them.</p>
        <div class="vm-chal-grid vm-chal-grid-cat">${ordered.map((d) => renderCatalogueCard(d, openKeys)).join("")}</div>
    </section>`;
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------
function renderRules() {
    const c = cache.catalogue.data || {};
    const cad = c.cadences || {};
    const x = (cadence, key) => {
        const v = cad[cadence] && cad[cadence][key];
        return v ? `${Number(v)}×` : "?";
    };
    const cooldown = cooldownText(c.cooldown_seconds);
    return `<section class="vm-chal-group vm-chal-rules">
        <h2 class="vm-chal-h2">How it works</h2>
        <div class="vm-chal-rules-grid">
            <div class="vm-chal-rule"><strong>Three timescales.</strong> A daily, a weekly and a monthly, always running. A weekly asks ${x("weekly", "target_multiplier")} the daily's target and pays ${x("weekly", "reward_multiplier")}; a monthly asks ${x("monthly", "target_multiplier")} and pays ${x("monthly", "reward_multiplier")}. The premium is on sticking with it.</div>
            <div class="vm-chal-rule"><strong>All or nothing.</strong> A challenge pays when every line on it is full, at the moment it closes. Finishing early does not pay early; it means you are in. Nothing is paid per objective.</div>
            <div class="vm-chal-rule"><strong>The one-minute rule.</strong> An objective that counts <em>activity</em> - any command - is ${escapeHtml(cooldown)}: ten commands inside a minute are one point. Objectives on a real action (a shift, a solved word, a bout, a sweep) count every time, because the action has its own cooldown.</div>
            <div class="vm-chal-rule"><strong>Where it is scored.</strong> In Discord, on the action itself. The card under <code>work</code>, <code>deposit</code>, <code>scan</code> and the word games tells you what it counted for - and says so when it did not. <code>org challenges</code> shows the same board as this page.</div>
            <div class="vm-chal-rule"><strong>Fair play.</strong> Rob and hack objectives never count against your own faction. Small amounts do not count for a haul. Saving counts only what is new: withdraw and redeposit adds nothing.</div>
        </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// The day's code challenge
// ---------------------------------------------------------------------------
function renderCoding() {
    const c = cache.coding;
    if (c.status === "offline") {
        return `<div class="vm-chal-note">The code challenge could not be loaded right now.</div>`;
    }
    if (!c.data) {
        return `<div class="vm-chal-note vm-chal-loading">Loading today's task…</div>`;
    }
    const d = c.data;
    const t = d.task || {};
    if (!d.enabled) {
        return `<div class="vm-chal-note">The code challenge is closed right now.</div>`;
    }
    const dataKeys = Object.keys(t.data || {});
    const dataLines = dataKeys.map((k) => `${k} = ${JSON.stringify(t.data[k])}`).join("\n");
    const last = c.last;
    let verdict = "";
    if (last && last.error) {
        verdict = `<p class="vm-chal-verdict is-bad">${escapeHtml(last.error)}</p>`;
    } else if (last && last.correct === true) {
        const paid = last.reward_result && last.reward_result.paid;
        verdict = `<p class="vm-chal-verdict is-good">Correct. ${paid ? `${num(paid)} shards landed on your profile.` : escapeHtml((last.reward_result && last.reward_result.message) || "Solved.")}</p>`;
    } else if (last && last.correct === false) {
        verdict = `<p class="vm-chal-verdict is-bad">Not it. ${num(last.attempts_left)} attempt${Number(last.attempts_left) === 1 ? "" : "s"} left today.</p>`;
    }
    let action;
    if (!d.signed_in) {
        action = `<p class="vm-chal-note">Sign in on the arcade to submit an answer. The task above is a public one; yours will differ.</p>`;
    } else if (d.solved) {
        action = `<p class="vm-chal-verdict is-good">Solved today${d.paid ? ` · ${num(d.paid)} shards paid` : ""}. A new one arrives at midnight UTC.</p>`;
    } else if (Number(d.attempts_left) <= 0) {
        action = `<p class="vm-chal-verdict is-bad">No attempts left today. Tomorrow brings a new task.</p>`;
    } else {
        // GEEN <form>: de browser-app vangt elke form-submit op als een
        // omnibox-zoekopdracht (zie BrowserApp.js). Een div met een knop die
        // via data-inpage-act bij de controller uitkomt is de weg die de
        // OSINT-pagina's ook gaan.
        action = `<div class="vm-chal-answer" data-chal="form">
            <label class="vm-chal-label" for="vm-chal-answer">Your answer (${escapeHtml(d.answer_format || "a whole number")})</label>
            <div class="vm-chal-answer-row">
                <input id="vm-chal-answer" class="vm-chal-input" type="text" inputmode="numeric" autocomplete="off" placeholder="42" data-chal="answer">
                <button type="button" class="vm-chal-btn" data-inpage-act="submit"${c.busy ? " disabled" : ""}>${c.busy ? "Checking…" : "Submit"}</button>
            </div>
            <p class="vm-chal-small">${num(d.attempts_left)} of ${num(d.attempts_per_day)} attempts left today · pays ${num(d.reward)} shards · counts for the Code Review challenge</p>
        </div>`;
    }
    return `<div class="vm-chal-coding-body">
        <div class="vm-chal-coding-task">
            <span class="vm-chal-kicker">${escapeHtml(t.date || "")} · ${escapeHtml(t.family || "")}</span>
            <h3 class="vm-chal-title">${escapeHtml(t.title || "Today's task")}</h3>
            <p class="vm-chal-statement">${escapeHtml(t.statement || "")}</p>
            <p class="vm-chal-small">Paste the data into the editor or the terminal, write the few lines, and enter the number it prints. The server checks the number, not your code - solve it any way you like.</p>
            <pre class="vm-chal-pre" data-chal="data">${escapeHtml(dataLines)}</pre>
            <details class="vm-chal-details">
                <summary>Show a starting point</summary>
                <pre class="vm-chal-pre">${escapeHtml(t.snippet || "")}</pre>
            </details>
        </div>
        <div class="vm-chal-coding-side">
            ${verdict}
            ${action}
            <p class="vm-chal-small">Why the server sets it: a browser cannot prove its own result. The task is generated for you, for today, and the answer is computed and checked on the server. See ${link("bucky://docs", "the coding reference")} for the language.</p>
        </div>
    </div>`;
}

function renderCodingSection() {
    return `<section class="vm-chal-group vm-chal-coding" data-inpage="challenges">
        <h2 class="vm-chal-h2">Code challenge of the day</h2>
        <div data-chal="coding">${renderCoding()}</div>
    </section>`;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
function renderPage() {
    maybeRefreshAll();
    const m = cache.mine.data;
    const openCount = m && m.items ? m.items.length : null;
    const lead = openCount === null
        ? "A daily, a weekly and a monthly, always running. Finish every line and it pays."
        : `${num(openCount)} open for you right now. Finish every line and it pays.`;
    const body = `
        <div class="vm-chal">
            <header class="vm-chal-hero">
                <span class="vm-bucky-kicker">CHALLENGES</span>
                <h1 class="vm-chal-h1">Something new every day</h1>
                <p class="vm-chal-lead">${escapeHtml(lead)}</p>
                <div class="vm-chal-hero-meta">${chip("Daily")}${chip("Weekly")}${chip("Monthly")}${chip("Code challenge")}</div>
            </header>
            ${renderBoard()}
            ${renderCodingSection()}
            ${renderCatalogue()}
            ${renderRules()}
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://bucky", label: "Bucky", note: "the official platform" },
                { url: "bucky://profile", label: "Operator profile", note: "titles, achievements, counters" },
                { url: "bucky://organizations", label: "Organisations", note: "the four factions" },
                { url: "bucky://docs", label: "Coding reference", note: "the VM's language" },
            ])}
        </div>`;
    return { title: "Bucky - Challenges", html: `<div class="vm-bucky-site">${body}</div>` };
}

// ---------------------------------------------------------------------------
// Fetching (soft refresh, never blocks render)
// ---------------------------------------------------------------------------
function stale(entry) {
    return !entry.inflight && (Date.now() - entry.fetchedAt) > TTL;
}

function maybeRefreshAll() {
    if (stale(cache.catalogue)) refreshCatalogue();
    if (stale(cache.mine)) refreshMine();
    if (stale(cache.coding)) refreshCoding();
}

async function refreshCatalogue() {
    const c = cache.catalogue;
    c.inflight = true;
    if (!c.data) c.status = "loading";
    let res;
    try { res = await gatewayClient.fetchChallengeCatalogue(); }
    catch (_e) { res = { ok: false, status: 0, data: null }; }
    c.inflight = false;
    c.fetchedAt = Date.now();
    if (res && res.ok && res.data) {
        c.status = "ready";
        c.data = res.data;
    } else if (!c.data) {
        c.status = "offline";
    }
    notifyHydrated();
}

async function refreshMine() {
    const m = cache.mine;
    m.inflight = true;
    if (!m.data) m.status = "loading";
    let res;
    try { res = await gatewayClient.fetchMyChallenges(); }
    catch (_e) { res = { ok: false, status: 0, data: null }; }
    m.inflight = false;
    m.fetchedAt = Date.now();
    if (res && res.ok && res.data) {
        m.status = "ready";
        m.unauthenticated = false;
        m.data = res.data;
    } else if (res && res.status === 401) {
        m.status = "ready";
        m.unauthenticated = true;
        m.data = null;
    } else if (!m.data) {
        m.status = "offline";
    }
    notifyHydrated();
}

async function refreshCoding() {
    const c = cache.coding;
    c.inflight = true;
    if (!c.data) c.status = "loading";
    let res;
    try { res = await gatewayClient.fetchCodingState(); }
    catch (_e) { res = { ok: false, status: 0, data: null }; }
    c.inflight = false;
    c.fetchedAt = Date.now();
    if (res && res.ok && res.data) {
        c.status = "ready";
        c.data = res.data;
    } else if (!c.data) {
        c.status = "offline";
    }
    notifyHydrated();
}

function notifyHydrated() {
    if (typeof window === "undefined" || !window.dispatchEvent) return;
    try {
        window.dispatchEvent(new CustomEvent("bucky:hydrated", { detail: { source: "challenges" } }));
    } catch (_e) { /* noop */ }
}

// ---------------------------------------------------------------------------
// In-page controller: the one action on this page is "submit"
// ---------------------------------------------------------------------------
function repaintCoding(host) {
    const scope = host || (typeof document !== "undefined" && document.querySelector('[data-inpage="challenges"]'));
    if (!scope) return;
    const el = scope.querySelector('[data-chal="coding"]');
    if (el) el.innerHTML = renderCoding();
}

const controller = {
    onAction(action, _value, host) {
        if (action !== "submit") return;
        const scope = host || (typeof document !== "undefined" && document.querySelector('[data-inpage="challenges"]'));
        const input = scope && scope.querySelector('[data-chal="answer"]');
        const answer = input ? String(input.value || "").trim() : "";
        if (!answer) return;
        submit(answer, scope);
    },
};

async function submit(answer, host) {
    const c = cache.coding;
    if (c.busy) return;
    c.busy = true;
    repaintCoding(host);
    let res;
    try { res = await gatewayClient.submitCodingAnswer(answer); }
    catch (_e) { res = { ok: false, status: 0, data: null }; }
    c.busy = false;
    if (res && res.data && typeof res.data === "object") {
        // The envelope the backend sends back is the fresh state; the verdict
        // rides on `correct` / `error`.
        const { correct, error, reward_result, ...state } = res.data;
        c.last = { correct, error, reward_result, attempts_left: state.attempts_left };
        if (state.task) c.data = state;
        c.fetchedAt = Date.now();
    } else if (res && res.status === 401) {
        c.last = { error: "Sign in on the arcade to submit." };
    } else {
        c.last = { error: "The answer could not be sent. Try again in a moment." };
    }
    repaintCoding(host);
}

function registerController() {
    if (typeof window === "undefined") return;
    window.__buckyInpage = window.__buckyInpage || {};
    window.__buckyInpage.challenges = controller;
}

// ---------------------------------------------------------------------------
// Registration + preload
// ---------------------------------------------------------------------------
export function registerChallengesSite(registry) {
    registerController();
    registry.register({
        id: "bucky-challenges",
        url: SITE_URL,
        site: SITE,
        title: "Bucky - Challenges",
        type: "page",
        keywords: ["challenge", "challenges", "daily", "weekly", "monthly", "reward",
                   "shards", "rep", "code", "coding", "puzzle", "task", "objective"],
        description: "What is open, how far you are, what is coming, what it pays - and the day's code challenge.",
        tags: ["bucky", "challenges", "official"],
        render: () => renderPage(),
    });
}

/** Boot-time preload. The catalogue is public; the board and the coding state
 *  only with a session, so a public visit costs one small request. */
export function preloadChallenges() {
    if (stale(cache.catalogue)) refreshCatalogue();
    if (gatewayClient.hasAuthToken && gatewayClient.hasAuthToken()) {
        if (stale(cache.mine)) refreshMine();
        if (stale(cache.coding)) refreshCoding();
    }
}

export function invalidateChallenges() {
    cache.catalogue.fetchedAt = 0;
    cache.mine.fetchedAt = 0;
    cache.coding.fetchedAt = 0;
}

export const _test = { cache, renderPage, renderCoding, submit, controller };
