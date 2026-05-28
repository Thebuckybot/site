/**
 * organizations.js — bucky://organizations (Phase 4.3, Part 6).
 *
 * The public faction directory of the Grid. Renders:
 *
 *     bucky://organizations          home — every founding org side-by-side
 *     bucky://organizations/<slug>   one org — identity + member count + lore
 *
 * Data layer:
 *   /api/player/organizations     -> the static registry (always available)
 *   /api/player/organization/<id> -> identity + live member count
 *
 * The organisation registry itself is static (Phase 4.3, Part 4 — four
 * founding orgs); the LIVE field is the per-org `members` count. We re-fetch
 * the list periodically (soft refresh) so the count stays current without
 * requiring a full VM render.
 *
 * Architecture preserved (project rules):
 *   - SiteRegistry / EventBus / browser runtime untouched.
 *   - render() stays synchronous and pure; the soft-refresh fetch happens
 *     off to the side, inside this module.
 *   - All authored text is HTML-escaped via the shared site kit.
 */
import { escapeHtml, link, chip, sitePage, crossRefs } from "./kit.js";
import { gatewayClient } from "../../../core/gatewayClient.js";

const SITE = "organizations";
const SITE_URL = "bucky://organizations";
const SITE_DOMAIN = "Grid Organisations";

const TTL = gatewayClient.softRefreshTtl || 60000;

/**
 * Bundled seed — the four founding organisations. The brief sets them in
 * stone, and the registry stays bot-side + backend-side; this is the VM
 * fallback when the backend is briefly unreachable.
 */
const SEED_ORGS = [
    {
        id: "cytek", name: "CyTek Industries", emblem: "⧁", color: "#10E0C8",
        tagline: "Engineer the next layer of the Grid.",
        description: "CyTek Industries is the Grid's largest engineering conglomerate. They build the relays, the protocols and the tools every other operator depends on.",
        philosophy: "Build first, refine later. Tools beat manifestos.",
        security_ideology: "Pragmatic defense. Assume compromise, harden the next layer, ship the patch.",
        members: null,
    },
    {
        id: "null", name: "Null Division", emblem: "∅", color: "#9098A8",
        tagline: "Leave no trace. Trust no one. Move clean.",
        description: "Null Division does not announce itself. It operates out of the unindexed sectors and recruits operators who value disappearance over influence.",
        philosophy: "The cleanest signature is no signature at all.",
        security_ideology: "Offensive minimalism. Anonymity is the only armor that scales.",
        members: null,
    },
    {
        id: "aether", name: "Aether Systems", emblem: "⯂", color: "#E0A210",
        tagline: "Order through architecture.",
        description: "Aether Systems is the old establishment — the consortium that wrote the standards everyone else now follows.",
        philosophy: "Well-defined process is the only durable defence.",
        security_ideology: "Governance. Standards, audits, signed change records.",
        members: null,
    },
    {
        id: "vanta", name: "Vanta Collective", emblem: "▽", color: "#E0457B",
        tagline: "The Grid is no one's property.",
        description: "Vanta Collective is a loose, decentralised crew of operators who reject the corporate stack on principle.",
        philosophy: "Resilience is a swarm property. There is no centre.",
        security_ideology: "Collective defense. Every member is a node, every node is expendable.",
        members: null,
    },
];

const state = {
    status: "seed",
    items: SEED_ORGS.slice(),
    fetchedAt: 0,
    inflight: false,
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderHome() {
    maybeRefresh();
    const cards = state.items.map((org) => `
        <article class="vm-org-card" style="--vm-org-accent:${escapeHtml(org.color || "#10E0C8")};">
            <header class="vm-org-card-head">
                <span class="vm-org-emblem" aria-hidden="true">${escapeHtml(org.emblem || "?")}</span>
                <div>
                    <h3 class="vm-dev-card-title">${link(`bucky://organizations/${escapeHtml(org.id)}`, org.name)}</h3>
                    <p class="vm-dev-card-summary">${escapeHtml(org.tagline)}</p>
                </div>
            </header>
            <p>${escapeHtml(org.description)}</p>
            <div class="vm-org-card-foot">
                <div class="vm-site-chiprow">${chip(formatMembers(org.members))}</div>
                ${link(`bucky://organizations/${escapeHtml(org.id)}`, "Open organisation ›")}
            </div>
        </article>
    `).join("");

    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">
                The four founding organisations of the Grid. Affiliation is permanent and is the
                anchor of the Phase 4.3 cyberworld — your rank, reputation and warnings all
                accrue against your chosen org.
            </p>
            ${renderFeedStatus()}
            <div class="vm-org-grid">${cards}</div>
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://leaderboards", label: "Leaderboards", note: "live rankings" },
                { url: "bucky://profile", label: "Your profile", note: "see your affiliation" },
                { url: "bucky://pulse", label: "PulseNet", note: "Grid-wide live state" }
            ])}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} · ${SITE_URL}`,
        title: "Grid Organisations",
        lead: "Four founding organisations. One permanent choice.",
        bodyHtml: body,
    });
}

function renderOrgPage(slug) {
    maybeRefresh();
    const org = state.items.find((o) => o.id === slug);
    if (!org) {
        return sitePage({
            site: SITE,
            domain: `${SITE_DOMAIN} · bucky://organizations/${escapeHtml(slug)}`,
            title: "Unknown organisation",
            lead: "No organisation matches this slug.",
            bodyHtml: `
                <div class="vm-wiki-body">
                    <p>The Grid has no record of <code>${escapeHtml(slug)}</code>.</p>
                    <div class="vm-leak-more">${link(SITE_URL, "‹ Back to all organisations")}</div>
                </div>
            `,
        });
    }
    const body = `
        <div class="vm-wiki-body">
            <header class="vm-org-banner" style="--vm-org-accent:${escapeHtml(org.color || "#10E0C8")};">
                <div class="vm-org-banner-id">
                    <span class="vm-org-emblem" aria-hidden="true">${escapeHtml(org.emblem || "?")}</span>
                    <div>
                        <h2 class="vm-site-h1" style="margin:0;">${escapeHtml(org.name)}</h2>
                        <p class="vm-site-lead" style="margin:0;">${escapeHtml(org.tagline)}</p>
                    </div>
                </div>
                <div class="vm-org-banner-stats">
                    <span class="vm-site-chip">${escapeHtml(formatMembers(org.members))}</span>
                    <span class="vm-site-chip">${escapeHtml(org.id)}</span>
                </div>
            </header>
            <section class="vm-wiki-section">
                <h2>About</h2>
                <p>${escapeHtml(org.description)}</p>
            </section>
            <section class="vm-wiki-section">
                <h2>Philosophy</h2>
                <p>${escapeHtml(org.philosophy || "—")}</p>
            </section>
            <section class="vm-wiki-section">
                <h2>Security ideology</h2>
                <p>${escapeHtml(org.security_ideology || "—")}</p>
            </section>
            <div class="vm-leak-more">${link(SITE_URL, "‹ Back to all organisations")}</div>
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://leaderboards/org-reputation", label: "Reputation board", note: "where this org ranks" },
                { url: "bucky://profile", label: "Your profile", note: "your affiliation" }
            ])}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${SITE_DOMAIN} · bucky://organizations/${escapeHtml(slug)}`,
        title: org.name,
        lead: org.tagline,
        bodyHtml: body,
    });
}

function renderFeedStatus() {
    if (state.status === "live") {
        return `<div class="vm-dev-feedstatus is-live">
            <span class="vm-dev-feeddot"></span>Live registry online — member counts are current.
        </div>`;
    }
    if (state.status === "offline") {
        return `<div class="vm-dev-feedstatus is-offline">
            <span class="vm-dev-feeddot"></span>Backend offline — showing the bundled registry.
        </div>`;
    }
    return `<div class="vm-dev-feedstatus is-loading">
        <span class="vm-dev-feeddot"></span>Connecting to the registry…
    </div>`;
}

// ---------------------------------------------------------------------------
// Soft-refresh — re-fetch the live member counts
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
    let res;
    try { res = await gatewayClient.fetchOrganizations(); }
    catch (_e) { res = { ok: false }; }
    state.fetchedAt = Date.now();
    state.inflight = false;
    if (!res || !res.ok || !res.data || !Array.isArray(res.data.items)) {
        state.status = "offline";
        return;
    }
    // Merge live data into the seed shape (seed has lore we want to keep
    // if the backend doesn't ship it).
    const merged = SEED_ORGS.map((seed) => {
        const live = res.data.items.find((o) => o && o.id === seed.id);
        if (!live) return seed;
        return {
            ...seed,
            ...live,
            color: normaliseColor(live.color) || seed.color,
        };
    });
    // Any live orgs we didn't have seeded — append them (forward-safe).
    res.data.items.forEach((live) => {
        if (!merged.find((m) => m.id === live.id)) {
            merged.push({
                ...live,
                color: normaliseColor(live.color) || "#10E0C8",
            });
        }
    });
    state.items = merged;
    state.status = "live";
    notifyHydrated("organizations");
}

/**
 * Phase 4.3 polish — emit a `bucky:hydrated` event so the BrowserApp can
 * re-render the active tab if the user is sitting on a freshly-hydrated page.
 * Same pattern across organizations / leaderboards / pulse / profile.
 */
function notifyHydrated(source) {
    if (typeof window === "undefined" || !window.dispatchEvent) return;
    try {
        window.dispatchEvent(new CustomEvent("bucky:hydrated", { detail: { source } }));
    } catch (_e) { /* noop */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatMembers(members) {
    if (members == null) return "members: —";
    if (members === 0) return "no members yet";
    if (members === 1) return "1 member";
    return `${members} members`;
}

function normaliseColor(c) {
    if (c == null) return null;
    if (typeof c === "number") {
        return "#" + c.toString(16).padStart(6, "0");
    }
    return String(c);
}

const ORG_URL_RE = /^bucky:\/\/organizations\/([^/?#]+)$/;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
export function registerOrganizationsSite(registry) {
    registry.register({
        id: "organizations-home",
        url: SITE_URL,
        site: SITE,
        title: "Grid Organisations",
        type: "home",
        keywords: ["organizations", "organisations", "factions", "orgs", "cytek",
                   "null", "aether", "vanta", "affiliation", "guild"],
        description: "The four founding organisations of the Grid — permanent affiliations and their philosophies.",
        tags: ["organizations", "identity"],
        render: () => renderHome(),
    });

    // Direct per-slug routes (4 static; cheap to register up-front).
    SEED_ORGS.forEach((org) => {
        registry.register({
            id: `organizations-${org.id}`,
            url: `bucky://organizations/${org.id}`,
            site: SITE,
            title: org.name,
            type: "page",
            keywords: [org.id, org.name.toLowerCase(), "organization", "faction"],
            description: org.tagline,
            tags: ["organizations", org.id],
            render: () => renderOrgPage(org.id),
        });
    });

    // Forward-safe: a future org that ships only backend-side still resolves.
    if (typeof registry.registerMatcher === "function") {
        registry.registerMatcher({
            id: "organizations-by-slug",
            site: SITE,
            title: "Organisation",
            type: "page",
            match: (url) => ORG_URL_RE.test(String(url || "")),
            render: (url) => {
                const m = ORG_URL_RE.exec(String(url || ""));
                return renderOrgPage(m ? m[1] : "");
            },
        });
    }
}

export function refreshOrganizations() { return refresh(); }
export function invalidateOrganizations() { state.fetchedAt = 0; }

/**
 * Phase 4.3 polish - boot-time preload. Idempotent + TTL-respecting; called
 * by buckynet.js right after registration so live member counts are hydrated
 * before the user opens bucky://organizations.
 */
export function preloadOrganizations() { return refresh(); }
