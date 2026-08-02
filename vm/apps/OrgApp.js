/**
 * OrgApp — the organization dashboard inside the VM.
 *
 * WHAT IT IS
 * Reading and talking. Choosing and buying happen in Discord, and every screen
 * where that matters says so in the place where somebody would otherwise look
 * for a button. That is not a limitation to apologise for: the bot locks its
 * writes inside its own process, so a second process spending shards is a race
 * nobody can win. What the app does instead is show the numbers and carry the
 * conversation.
 *
 * ONE NAVIGATION
 * A tab bar at the bottom and nothing else. No sidebar, no menu in the header,
 * no second row of filters. Every screen is reachable in one press from every
 * other screen, and the header only ever says which organization you are
 * looking at.
 *
 * THE NUMBERS ARE THE PRODUCT
 * This is a figures app. Secondary text runs at a much higher contrast than the
 * VM's usual dim grey, every number sits on tabular figures so digits do not
 * shift as they tick, and no bar or count is allowed to animate its value -
 * somebody who cannot tell whether they are reading 4,05% or 4,85% has stopped
 * trusting the app, and they are right to.
 *
 * AVATARS ARE FLATTENED ON PURPOSE
 * Discord avatars are user-supplied and some of them are pure white or a
 * strobing gif. One size, one radius, a thin ring in the organization colour and
 * a slight dim: a face stays recognisable and the dark theme survives.
 *
 * POLLING, AND WHY 15 SECONDS
 * There is no socket and none of the existing VM surfaces poll at all - they use
 * TTL-on-render or a one-shot fetch at mount. The feed needs more than that
 * because it is a conversation: a reply that shows up a minute late reads as a
 * reply that was lost. Fifteen seconds is under the point where that happens and
 * still cheap - four organizations of under ten members is well below one
 * request per second across the whole game, and the interval stops entirely when
 * the window is not on top. The other tabs poll at 30s, which is already faster
 * than the numbers behind them move: the bot redraws its own command board every
 * fifteen minutes.
 */

// De client is EEN named export met de verbs erin, geen losse functies. Een
// namespace-import geeft dan een object zonder `request` en de app valt om op
// de eerste fetch - stil, want het gebeurt in een promise.
import { gatewayClient } from "../core/gatewayClient.js";

const FEED_POLL_MS = 15000;
const DATA_POLL_MS = 30000;
const BODY_LIMIT = 500;

const TABS = [
    { key: "overview", label: "Overview" },
    { key: "feed", label: "Feed" },
    { key: "treasury", label: "Treasury" },
    { key: "upgrades", label: "Research" },
    { key: "members", label: "Members" },
    { key: "election", label: "Election" },
    { key: "card", label: "You" }
];

const RANK_LABEL = {
    recruit: "Recruit", member: "Member", specialist: "Specialist",
    officer: "Officer", commander: "Commander", council: "Council",
    leader: "Leader"
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Thousands separators with a non-breaking thin space.
 *
 * A plain space lets a number wrap across a line, and a wrapped number is the
 * "broken line near a figure" this app is not allowed to have.
 */
function num(value) {
    const n = Math.trunc(Number(value) || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Two decimals, always both, so a column of rates lines up. */
function pct(value) {
    return (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
}

function avatar(userId) {
    // The default embed avatar. The real one needs a hash the backend does not
    // serve, and guessing a CDN path that 404s is worse than a consistent
    // placeholder - see the note in the notitie.
    //
    // BigInt THROWS on anything that is not a number, and this runs inside
    // `refresh()`, which has no catch: one non-numeric id would freeze the whole
    // app on its previous DOM. The candidate list comes out of bot-written JSON
    // and is numeric today - "today" is not a guarantee worth a frozen app.
    const raw = String(userId || "0");
    const index = /^\d+$/.test(raw) ? Number(BigInt(raw) % 5n) : 0;
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function userChip(userId, rank, extraClass) {
    const label = RANK_LABEL[rank] || "";
    return `<span class="vm-orgapp-user ${extraClass || ""}"
                  title="${escapeHtml(userId)}">
        <img class="vm-orgapp-avatar" alt="" src="${escapeHtml(avatar(userId))}">
        <span class="vm-orgapp-user-id">${escapeHtml(shortId(userId))}</span>
        ${label ? `<span class="vm-orgapp-badge">${escapeHtml(label)}</span>` : ""}
    </span>`;
}

/**
 * A Discord snowflake is eighteen digits and means nothing to a reader. The
 * last four are enough to tell two members apart in a list of ten, and the
 * whole id stays in the title attribute for anybody who needs it.
 */
function shortId(userId) {
    const s = String(userId || "");
    return s.length > 6 ? "…" + s.slice(-4) : s;
}

function bar(percent, full) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    return `<div class="vm-orgapp-bar${full ? " is-full" : ""}">
        <div class="vm-orgapp-bar-fill" style="width:${p}%"></div>
    </div>`;
}

function empty(title, body) {
    return `<div class="vm-orgapp-empty">
        <div class="vm-orgapp-empty-title">${escapeHtml(title)}</div>
        <div class="vm-orgapp-empty-body">${escapeHtml(body)}</div>
    </div>`;
}

/** Every screen that shows a price says where the button is. */
function discordNote(what) {
    return `<div class="vm-orgapp-note">${escapeHtml(what)}</div>`;
}

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */
export function createOrgState(user) {
    return {
        tab: "overview",
        user: user || null,
        viewer: null,
        loading: true,
        error: "",
        data: {},          // per tab, laatst opgehaalde payload
        fetchedAt: {},     // per tab
        standings: [],
        feed: { posts: [], can_post: false, can_moderate: false },
        draft: "",
        replyTo: null,
        posting: false,
        postError: "",
        campaignId: null,
        campagneGezocht: false,
        reported: {}
    };
}

/* ------------------------------------------------------------------ */
/* render                                                              */
/* ------------------------------------------------------------------ */
export function renderOrgApp(runtime, windowState) {
    return `<div class="vm-orgapp">${renderOrgInner(runtime, windowState)}</div>`;
}

function renderOrgInner(runtime, windowState) {
    const s = windowState.appState;
    const accent = (s.data.overview && s.data.overview.theme
        && s.data.overview.theme.color) || "#52fff3";

    if (s.loading && !s.viewer && !s.standings.length) {
        return `<div class="vm-orgapp-shell"><div class="vm-orgapp-body">
            ${empty("Loading", "Reading your organization…")}
        </div></div>`;
    }
    if (s.error) {
        return `<div class="vm-orgapp-shell"><div class="vm-orgapp-body">
            ${empty("Offline", s.error)}
        </div></div>`;
    }
    if (!s.viewer) {
        return `<div class="vm-orgapp-shell" style="--vm-org-accent:#52fff3">
            ${renderHeader(s, null)}
            <div class="vm-orgapp-body">${renderOutsider(s)}</div>
        </div>`;
    }

    return `<div class="vm-orgapp-shell" style="--vm-org-accent:${escapeHtml(accent)}">
        ${renderHeader(s, s.data.overview)}
        <div class="vm-orgapp-body" data-org-body>${renderTab(s)}</div>
        ${renderTabs(s)}
    </div>`;
}

function renderHeader(s, org) {
    if (!org) {
        return `<header class="vm-orgapp-head">
            <span class="vm-orgapp-emblem">◇</span>
            <span class="vm-orgapp-title">Organizations</span>
        </header>`;
    }
    return `<header class="vm-orgapp-head">
        <span class="vm-orgapp-emblem">${escapeHtml(org.emblem || "◇")}</span>
        <span class="vm-orgapp-title">${escapeHtml(org.name || org.slug || "")}</span>
        <span class="vm-orgapp-head-rep">${num(org.rep)} REP</span>
    </header>`;
}

function renderTabs(s) {
    return `<nav class="vm-orgapp-tabs">${TABS.map((t) => `
        <button class="vm-orgapp-tab${s.tab === t.key ? " is-active" : ""}"
                data-org-tab="${t.key}">${escapeHtml(t.label)}</button>`).join("")}
    </nav>`;
}

function renderTab(s) {
    switch (s.tab) {
        case "feed": return renderFeed(s);
        case "treasury": return renderTreasury(s);
        case "upgrades": return renderUpgrades(s);
        case "members": return renderMembers(s);
        case "election": return renderElection(s);
        case "card": return renderCard(s);
        default: return renderOverview(s);
    }
}

/* ---- niet-lid ---------------------------------------------------- */
function renderOutsider(s) {
    const rows = s.standings.map((o, i) => `
        <li class="vm-orgapp-rank-row" style="--vm-org-accent:${escapeHtml(o.theme.color)}">
            <span class="vm-orgapp-rank-pos">${i + 1}</span>
            <span class="vm-orgapp-rank-emblem">${escapeHtml(o.emblem || "◇")}</span>
            <span class="vm-orgapp-rank-name">${escapeHtml(o.name)}</span>
            <span class="vm-orgapp-rank-score">${num(o.score)}</span>
        </li>`).join("");
    return `
        ${empty("You are not in an organization",
                "Type +chooseorg in Discord to join one. It is permanent, so read "
                + "the four first — the board below is how they are doing right now.")}
        <h3 class="vm-orgapp-h">Reputation per active member</h3>
        <ol class="vm-orgapp-rank">${rows || ""}</ol>
        ${discordNote("Joining happens in Discord with +chooseorg.")}`;
}

/* ---- overzicht --------------------------------------------------- */
function renderOverview(s) {
    // `s.data.overview` is de UITGEPAKTE org. `load()` zette hier eerst de hele
    // envelope neer en overschreef die alleen als `item` waar was, dus bij een
    // lege org bleef een truthy envelope staan, sloeg de guard niet aan en
    // klapte de volgende regel op `org.credits`.
    const org = s.data.overview;
    if (!org || !org.credits) {
        return empty("Nothing yet", "This organization has no data yet.");
    }
    const c = org.campaign;
    const rows = s.standings.map((o, i) => `
        <li class="vm-orgapp-rank-row${o.org_id === org.org_id ? " is-you" : ""}"
            style="--vm-org-accent:${escapeHtml(o.theme.color)}">
            <span class="vm-orgapp-rank-pos">${i + 1}</span>
            <span class="vm-orgapp-rank-emblem">${escapeHtml(o.emblem || "◇")}</span>
            <span class="vm-orgapp-rank-name">${escapeHtml(o.name)}</span>
            <span class="vm-orgapp-rank-score">${num(o.score)}</span>
        </li>`).join("");

    return `
        <div class="vm-orgapp-stats">
            ${stat("Reputation", num(org.rep))}
            ${stat("Members", `${num(org.active)} / ${num(org.members)}`, "active this term")}
            ${stat("Credits", num(org.credits.available), "unspent")}
        </div>
        ${c ? renderCampaignBlock(c) : empty("No campaign running",
            "A leader opens one with +campaign in #treasury. Until then the "
            + "treasury just sits there.")}
        <h3 class="vm-orgapp-h">Reputation per active member</h3>
        <ol class="vm-orgapp-rank">${rows}</ol>`;
}

function stat(label, value, sub) {
    // Ook al geven alle aanroepers vandaag `num()`, `pct()` of een letterlijke
    // string mee: dit was de enige onbeschermde sink in het bestand, en een
    // aanroeper die er ooit een naam in stopt hoort geen gat te openen.
    return `<div class="vm-orgapp-stat">
        <div class="vm-orgapp-stat-value">${escapeHtml(value)}</div>
        <div class="vm-orgapp-stat-label">${escapeHtml(label)}</div>
        ${sub ? `<div class="vm-orgapp-stat-sub">${escapeHtml(sub)}</div>` : ""}
    </div>`;
}

function renderCampaignBlock(c) {
    return `<section class="vm-orgapp-card">
        <div class="vm-orgapp-card-head">
            <span class="vm-orgapp-card-title">${escapeHtml(c.title || "Campaign")}</span>
            <span class="vm-orgapp-card-pct">${c.percent}%</span>
        </div>
        ${bar(c.percent, c.full)}
        <div class="vm-orgapp-card-line">
            <span>${num(c.raised)}</span><span class="vm-orgapp-dim">of ${num(c.goal)}</span>
        </div>
        ${c.full ? `<div class="vm-orgapp-full">
            The pot is full — the leader can buy an upgrade now.</div>` : ""}
        ${c.donors && c.donors.length ? `<ul class="vm-orgapp-donors">${
            c.donors.map((d) => `<li>${userChip(d.user_id)}
                <span class="vm-orgapp-donor-amount">${num(d.amount)}</span></li>`).join("")
        }</ul>` : `<div class="vm-orgapp-dim">Nobody has donated yet.</div>`}
        ${discordNote("Donate with +org donate in Discord.")}
    </section>`;
}

/* ---- feed -------------------------------------------------------- */
function renderFeed(s) {
    const f = { ...s.feed, reported: s.reported };
    const byParent = new Map();
    (f.posts || []).forEach((p) => {
        const key = p.reply_to || 0;
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key).push(p);
    });
    const roots = byParent.get(0) || [];

    const list = roots.map((p) => renderPost(p, f, byParent.get(p.id) || [])).join("");

    const waar = s.campaignId
        ? "the thread of the campaign that is running"
        : "your organization's general thread";
    return `
        <div class="vm-orgapp-note">You are posting in ${escapeHtml(waar)}.</div>
        ${roots.length ? `<ul class="vm-orgapp-feed">${list}</ul>`
            : empty("Nothing here yet",
                    "Say something — this is where your organization talks.")}
        ${f.can_post ? renderComposer(s) : discordNote(
            // DE REDEN KOMT VAN DE SERVER. Hier "alleen leden kunnen posten"
            // hardcoderen was fout zodra er een tweede reden bijkwam: een lid
            // met de schrijfvlag uit kreeg te horen dat hij geen lid is.
            f.post_note || "Only members of this organization can post here.")}`;
}

function reportButton(p, f) {
    return f.reported && f.reported[p.id]
        ? `<span class="vm-orgapp-reported">Reported</span>`
        : `<button data-org-report="${p.id}">Report</button>`;
}


function renderPost(p, f, replies) {
    const canRemove = p.mine || f.can_moderate;
    return `<li class="vm-orgapp-post" data-post="${p.id}">
        <div class="vm-orgapp-post-head">
            ${userChip(p.author_id, p.author_rank)}
            <time class="vm-orgapp-post-time">${escapeHtml(shortTime(p.created_at))}</time>
        </div>
        <div class="vm-orgapp-post-body">${escapeHtml(p.body)}</div>
        <div class="vm-orgapp-post-tools">
            ${f.can_post ? `<button data-org-reply="${p.id}">Reply</button>` : ""}
            ${reportButton(p, f)}
            ${canRemove ? `<button data-org-delete="${p.id}">Remove</button>` : ""}
            ${p.reports ? `<span class="vm-orgapp-reports">${p.reports} report(s)</span>` : ""}
        </div>
        ${replies.length ? `<ul class="vm-orgapp-replies">${
            replies.map((r) => `<li class="vm-orgapp-post is-reply" data-post="${r.id}">
                <div class="vm-orgapp-post-head">
                    ${userChip(r.author_id, r.author_rank)}
                    <time class="vm-orgapp-post-time">${escapeHtml(shortTime(r.created_at))}</time>
                </div>
                <div class="vm-orgapp-post-body">${escapeHtml(r.body)}</div>
                <div class="vm-orgapp-post-tools">
                    ${reportButton(r, f)}
                    ${(r.mine || f.can_moderate)
                        ? `<button data-org-delete="${r.id}">Remove</button>` : ""}
                </div>
            </li>`).join("")}</ul>` : ""}
    </li>`;
}

function renderComposer(s) {
    const left = BODY_LIMIT - (s.draft || "").length;
    return `<form class="vm-orgapp-composer" data-org-composer>
        ${s.replyTo ? `<div class="vm-orgapp-replying">
            Replying to #${s.replyTo}
            <button type="button" data-org-cancel-reply>cancel</button></div>` : ""}
        <textarea data-org-draft maxlength="${BODY_LIMIT}"
            placeholder="Say something to your organization"
            ${s.posting ? "disabled" : ""}>${escapeHtml(s.draft || "")}</textarea>
        <div class="vm-orgapp-composer-foot">
            <span class="vm-orgapp-count${left < 0 ? " is-over" : ""}">${left}</span>
            <button type="submit" ${s.posting ? "disabled" : ""}>Post</button>
        </div>
        ${s.postError ? `<div class="vm-orgapp-error">${escapeHtml(s.postError)}</div>` : ""}
    </form>`;
}

function shortTime(iso) {
    if (!iso) return "";
    const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString([], { month: "short", day: "numeric",
                                  hour: "2-digit", minute: "2-digit" });
}

/* ---- treasury ---------------------------------------------------- */
function renderTreasury(s) {
    const d = s.data.treasury;
    if (!d || !d.item) return empty("Nothing yet", "No treasury for this organization.");
    const org = d.item;
    const c = org.campaign;
    const i = d.interest || {};
    return `
        <div class="vm-orgapp-stats">
            ${stat("Treasury", num(org.treasury.balance), "working capital")}
            ${stat("Bank", num(org.treasury.bank_balance), "member deposits")}
            ${stat("Donated", num(org.treasury.total_donated), "lifetime")}
        </div>
        ${c ? renderCampaignBlock(c) : empty("No campaign running",
            "The treasury only fills while a campaign is open.")}
        <h3 class="vm-orgapp-h">Bank rate</h3>
        <div class="vm-orgapp-rate">
            ${rateRow("Base", i.base)}
            ${rateRow("Organization", i.org)}
            ${rateRow("Your rank", i.rank)}
            ${rateRow("Research", i.upgrades)}
            <div class="vm-orgapp-rate-row is-total">
                <span>Total</span><span>${pct(i.total)}%</span></div>
        </div>
        ${i.enabled ? "" : discordNote("Interest is switched off right now.")}
        ${renderAnnouncements(d.announcements || [])}`;
}

function rateRow(label, value) {
    return `<div class="vm-orgapp-rate-row">
        <span>${escapeHtml(label)}</span><span>${pct(value)}%</span></div>`;
}

function renderAnnouncements(list) {
    if (!list.length) {
        return `<h3 class="vm-orgapp-h">Announcements</h3>${
            empty("No announcements", "Your leader posts these with +organnounce.")}`;
    }
    return `<h3 class="vm-orgapp-h">Announcements</h3>
        <ul class="vm-orgapp-announce">${list.map((a) => `
            <li><div class="vm-orgapp-post-head">${userChip(a.author_id)}
                <time class="vm-orgapp-post-time">${escapeHtml(shortTime(a.created_at))}</time></div>
            <div class="vm-orgapp-post-body">${escapeHtml(a.body)}</div></li>`).join("")}
        </ul>`;
}

/* ---- upgrades ---------------------------------------------------- */
function renderUpgrades(s) {
    const d = s.data.upgrades;
    if (!d || !d.item) return empty("Nothing yet", "No research data.");
    const u = d.item;
    if (!u.items.length) {
        return empty("No upgrades yet", "The catalogue is empty for now.");
    }
    const byCat = {};
    u.items.forEach((it) => { (byCat[it.category] = byCat[it.category] || []).push(it); });
    const cats = (u.categories.length ? u.categories
        : Object.keys(byCat).map((k) => ({ key: k, name: k })));

    return `
        <div class="vm-orgapp-stats">
            ${stat("Credits", num(u.credits.available), "unspent")}
            ${stat("Earned", num(u.credits.earned), "campaigns finished")}
            ${stat("Spent", num(u.credits.spent))}
        </div>
        ${cats.map((c) => {
            const items = byCat[c.key] || [];
            if (!items.length) return "";
            return `<h3 class="vm-orgapp-h">${escapeHtml(c.name || c.key)}</h3>
                <ul class="vm-orgapp-upgrades">${items.map(renderUpgrade).join("")}</ul>`;
        }).join("")}
        ${u.enabled ? "" : discordNote("Research is switched off right now.")}
        ${discordNote("Only the leader buys, and it happens in Discord in #command.")}`;
}

function renderUpgrade(it) {
    const pips = [];
    for (let i = 0; i < it.max_level; i += 1) {
        pips.push(`<span class="vm-orgapp-pip${i < it.level ? " is-on" : ""}"></span>`);
    }
    return `<li class="vm-orgapp-upgrade">
        <div class="vm-orgapp-upgrade-head">
            <span class="vm-orgapp-upgrade-name">${escapeHtml(it.name)}</span>
            <span class="vm-orgapp-pips">${pips.join("")}</span>
        </div>
        <div class="vm-orgapp-dim">${escapeHtml(it.blurb)}</div>
        <div class="vm-orgapp-upgrade-foot">
            <span>Level ${it.level} / ${it.max_level}</span>
            <span>${it.maxed ? "Maxed"
                : `Next: ${num(it.next_price)} credit(s)`}</span>
        </div>
    </li>`;
}

/* ---- leden ------------------------------------------------------- */
function renderMembers(s) {
    const d = s.data.members;
    if (!d || !d.items || !d.items.length) {
        return empty("No members yet", "Nobody has joined this organization.");
    }
    return `<ul class="vm-orgapp-members">${d.items.map((m) => `
        <li class="vm-orgapp-member${m.active ? "" : " is-idle"}">
            ${userChip(m.user_id, m.rank)}
            <span class="vm-orgapp-member-contrib">${num(m.contribution)}</span>
        </li>`).join("")}</ul>
        ${discordNote("Rank follows contribution. +myorg in Discord shows yours.")}`;
}

/* ---- verkiezing -------------------------------------------------- */
function renderElection(s) {
    const d = s.data.election;
    const e = d && d.item;
    if (!e) {
        return empty("No election yet",
            "Elections open once a term. The ballot appears in #announcements.");
    }
    const rows = e.candidates.map((c, i) => `
        <li class="vm-orgapp-cand${e.winner_user_id === c.user_id ? " is-winner" : ""}">
            <span class="vm-orgapp-rank-pos">${i + 1}</span>
            ${userChip(c.user_id)}
            <span class="vm-orgapp-cand-votes">${num(c.votes)} vote(s)</span>
        </li>`).join("");
    return `
        <div class="vm-orgapp-stats">
            ${stat("Term", num(e.term))}
            ${stat("Status", e.open ? "Open" : "Closed")}
        </div>
        ${e.candidates.length ? `<ul class="vm-orgapp-cands">${rows}</ul>`
            : empty("No candidates", "The shortlist is drawn from contribution.")}
        ${discordNote(e.open
            ? "Voting happens in Discord — the ballot is in #announcements."
            : "This election is closed.")}`;
}

/* ---- jouw kaart -------------------------------------------------- */
function renderCard(s) {
    const d = s.data.card;
    const v = s.viewer;
    if (!d || !d.item || !v) return empty("Nothing yet", "No card data.");
    const i = d.item.interest || {};
    const order = d.item.rank_order || [];
    const idx = order.indexOf(v.rank);
    return `
        <div class="vm-orgapp-you">
            ${userChip(v.user_id, v.rank, "is-big")}
        </div>
        <div class="vm-orgapp-stats">
            ${stat("Contribution", num(v.contribution), "lifetime")}
            ${stat("This term", num(v.season_contribution))}
            ${stat("Personal REP", num(v.personal_rep))}
        </div>
        <h3 class="vm-orgapp-h">Rank</h3>
        <div class="vm-orgapp-ladder">${order.map((r, n) => `
            <span class="vm-orgapp-rung${n <= idx ? " is-on" : ""}"
                  title="${escapeHtml(RANK_LABEL[r] || r)}"></span>`).join("")}
        </div>
        <div class="vm-orgapp-dim">${escapeHtml(RANK_LABEL[v.rank] || v.rank)}${
            d.item.leader_id === v.user_id ? " — you lead this organization" : ""}</div>
        <h3 class="vm-orgapp-h">Your bank rate</h3>
        <div class="vm-orgapp-rate">
            ${rateRow("Base", i.base)}
            ${rateRow("Organization", i.org)}
            ${rateRow("Your rank", i.rank)}
            ${rateRow("Research", i.upgrades)}
            <div class="vm-orgapp-rate-row is-total">
                <span>Total</span><span>${pct(i.total)}%</span></div>
        </div>
        <div class="vm-orgapp-dim">Paid every ${num(i.every_days)} days on your bank
            balance.</div>
        ${d.item.credits ? `<h3 class="vm-orgapp-h">Organization credits</h3>
            <div class="vm-orgapp-stats">
                ${stat("Available", num(d.item.credits.available))}
                ${stat("Earned", num(d.item.credits.earned))}
                ${stat("Spent", num(d.item.credits.spent))}
            </div>` : ""}`;
}

/* ------------------------------------------------------------------ */
/* mount                                                               */
/* ------------------------------------------------------------------ */
export function mountOrgApp(runtime, windowState, element) {
    const view = windowState.view;
    view.cleanups = [];
    const app = element.querySelector(".vm-orgapp");
    if (!app) return;
    view.appElement = app;

    view.refresh = () => {
        // The draft survives a redraw. A poll that lands while somebody is
        // typing must not eat the sentence.
        const veld = app.querySelector("[data-org-draft]");
        if (veld) windowState.appState.draft = veld.value;
        const pos = veld ? veld.selectionStart : null;
        app.innerHTML = renderOrgInner(runtime, windowState);
        const nieuw = app.querySelector("[data-org-draft]");
        if (nieuw && document.activeElement === veld) {
            nieuw.focus();
            if (pos !== null) nieuw.setSelectionRange(pos, pos);
        }
    };

    const onClick = (event) => handleClick(runtime, windowState, event);
    const onSubmit = (event) => {
        if (event.target && event.target.hasAttribute("data-org-composer")) {
            event.preventDefault();
            submitPost(runtime, windowState);
        }
    };
    const onInput = (event) => {
        if (event.target && event.target.hasAttribute("data-org-draft")) {
            windowState.appState.draft = event.target.value;
            const teller = app.querySelector(".vm-orgapp-count");
            if (teller) {
                const left = BODY_LIMIT - event.target.value.length;
                teller.textContent = String(left);
                teller.classList.toggle("is-over", left < 0);
            }
        }
    };
    app.addEventListener("click", onClick);
    app.addEventListener("submit", onSubmit);
    app.addEventListener("input", onInput);
    view.cleanups.push(() => app.removeEventListener("click", onClick));
    view.cleanups.push(() => app.removeEventListener("submit", onSubmit));
    view.cleanups.push(() => app.removeEventListener("input", onInput));

    load(runtime, windowState, true);

    const timer = setInterval(() => {
        // Only while this window is on top and the tab is visible. A background
        // window polling every fifteen seconds is a request nobody reads.
        if (document.hidden) return;
        // `runtime.windows` is OPENVOLGORDE en geen z-volgorde: `focusWindow`
        // verhoogt alleen `windowState.z` en laat de array met rust. Op de
        // laatste index kijken betekende dus: open de Terminal en de feed
        // ververst nooit meer, ook niet als je terugklikt.
        const actief = runtime.activeWindowId
            ? runtime.activeWindowId === windowState.id
            : true;
        const interval = windowState.appState.tab === "feed" ? FEED_POLL_MS : DATA_POLL_MS;
        const laatst = windowState.appState.fetchedAt[windowState.appState.tab] || 0;
        if (actief && (Date.now() - laatst) >= interval) load(runtime, windowState, false);
    }, 5000);
    view.cleanups.push(() => clearInterval(timer));
}

export function unmountOrgApp(runtime, windowState) {
    const view = windowState.view || {};
    (view.cleanups || []).forEach((fn) => { try { fn(); } catch (e) { /* leeg */ } });
    view.cleanups = [];
}

function handleClick(runtime, windowState, event) {
    const s = windowState.appState;
    const tab = event.target.closest("[data-org-tab]");
    if (tab) {
        s.tab = tab.getAttribute("data-org-tab");
        s.postError = "";
        windowState.view.refresh();
        load(runtime, windowState, true);
        return;
    }
    const reply = event.target.closest("[data-org-reply]");
    if (reply) {
        s.replyTo = Number(reply.getAttribute("data-org-reply"));
        windowState.view.refresh();
        return;
    }
    if (event.target.closest("[data-org-cancel-reply]")) {
        s.replyTo = null;
        windowState.view.refresh();
        return;
    }
    const report = event.target.closest("[data-org-report]");
    if (report) {
        const id = Number(report.getAttribute("data-org-report"));
        // IN DE STATE en niet alleen in de DOM: de eerstvolgende poll tekent
        // opnieuw, en dan stond de knop weer op "Report" alsof er niets was
        // gebeurd - waarna iemand nog een keer drukt op een melding die al
        // geteld is.
        s.reported[id] = true;
        gatewayClient.request(`/api/org/feed/${id}/report`, {
            method: "POST", body: { reason: "" }
        }).then(() => load(runtime, windowState, true));
        windowState.view.refresh();
        return;
    }
    const del = event.target.closest("[data-org-delete]");
    if (del) {
        const id = del.getAttribute("data-org-delete");
        del.disabled = true;
        gatewayClient.request(`/api/org/feed/${id}`, { method: "DELETE" })
            .then(() => load(runtime, windowState, true));
    }
}

/* ------------------------------------------------------------------ */
/* data                                                                */
/* ------------------------------------------------------------------ */
const ENDPOINT = {
    overview: "/api/org/overview",
    feed: "/api/org/feed",
    treasury: "/api/org/treasury",
    upgrades: "/api/org/upgrades",
    members: "/api/org/members",
    election: "/api/org/election",
    card: "/api/org/card"
};

function load(runtime, windowState, force) {
    const s = windowState.appState;
    const tab = s.tab;
    if (!force && s.inflight) return;
    s.inflight = true;

    const eerste = !s.viewer && !s.standings.length;
    let pad = ENDPOINT[tab] || ENDPOINT.overview;
    if (tab === "feed" && s.campaignId) pad += `?campaign_id=${s.campaignId}`;
    const taken = [gatewayClient.request(pad)];
    if (eerste || tab === "overview") taken.push(gatewayClient.request("/api/org/standings"));
    // De feed heeft de lopende campagne nodig om aan te hangen, en die staat in
    // het overzicht. Een keer ophalen zodra we hem nog niet kennen.
    const wilCampagne = tab === "feed" && s.campaignId === null && !s.campagneGezocht;
    if (wilCampagne) {
        s.campagneGezocht = true;
        gatewayClient.request(ENDPOINT.overview).then((r) => {
            const item = r.ok && (r.data || {}).item;
            if (item) {
                s.data.overview = item;
                if (item.campaign) {
                    s.campaignId = item.campaign.id;
                    load(runtime, windowState, true);
                }
            }
        });
    }

    Promise.all(taken).then(([hoofd, board]) => {
        s.inflight = false;
        s.loading = false;
        if (!hoofd.ok) {
            // 401 is not an error to shout about - it is "not logged in", and the
            // outsider screen is the honest answer to that.
            s.error = hoofd.status === 401 ? "" : (hoofd.error || "backend unreachable");
            s.viewer = hoofd.status === 401 ? null : s.viewer;
        } else {
            const d = hoofd.data || {};
            s.error = "";
            if (d.viewer !== undefined) s.viewer = d.viewer;
            if (tab === "feed") {
                s.feed = d.item || { posts: [], can_post: false, can_moderate: false };
            }
            s.data[tab] = d;
            if (tab === "overview" && d.item) s.data.overview = d.item;
            // DE FEED VOLGT DE LOPENDE CAMPAGNE. Zonder dit blijft `campaignId`
            // altijd null, hangt elke post aan de algemene draad, en is de
            // campagnefeed - inclusief het archiveren dat erbij hoort - een
            // tabel-kolom waar niets ooit in komt.
            if (d.item && d.item.campaign) {
                s.campaignId = d.item.campaign.id;
            } else if (tab === "overview" || tab === "treasury") {
                s.campaignId = null;
            }
            s.fetchedAt[tab] = Date.now();
        }
        if (board && board.ok) s.standings = (board.data || {}).items || [];
        if (windowState.view && windowState.view.refresh) windowState.view.refresh();
    }).catch(() => {
        s.inflight = false;
        s.loading = false;
        if (windowState.view && windowState.view.refresh) windowState.view.refresh();
    });
}

function submitPost(runtime, windowState) {
    const s = windowState.appState;
    const tekst = (s.draft || "").trim();
    s.postError = "";
    if (!tekst) return;
    if (tekst.length > BODY_LIMIT) {
        s.postError = `Keep it under ${BODY_LIMIT} characters.`;
        windowState.view.refresh();
        return;
    }
    s.posting = true;
    windowState.view.refresh();

    // A stable key per attempt: a retry of THIS post lands once, a second
    // sentence is a second attempt and gets its own key.
    const key = `${s.viewer ? s.viewer.user_id : "0"}-${Date.now()}-${
        Math.random().toString(36).slice(2, 8)}`;

    gatewayClient.request("/api/org/feed", {
        method: "POST",
        body: {
            body: tekst,
            campaign_id: s.campaignId || null,
            reply_to: s.replyTo || null,
            idempotency_key: key
        }
    }).then((res) => {
        s.posting = false;
        if (res.ok && (res.data || {}).ok) {
            s.draft = "";
            s.replyTo = null;
            // OOK HET VELD ZELF LEEGMAKEN. `refresh()` leest de textarea terug
            // in `s.draft` zodat een poll geen halve zin opeet - en dat wint het
            // anders van dit wissen, waarna de verzonden tekst blijft staan en
            // de teller op 485 hangt.
            const veld = windowState.view.appElement
                && windowState.view.appElement.querySelector("[data-org-draft]");
            if (veld) veld.value = "";
            load(runtime, windowState, true);
        } else {
            s.postError = ((res.data || {}).error) || res.error || "could not post";
            // De vlag kan omgaan terwijl iemand staat te typen. Dan hoort de
            // composer weg te gaan in plaats van de fout te blijven herhalen.
            if ((res.data || {}).disabled) load(runtime, windowState, true);
            windowState.view.refresh();
        }
    }).catch(() => {
        s.posting = false;
        s.postError = "could not reach the backend";
        windowState.view.refresh();
    });
}
