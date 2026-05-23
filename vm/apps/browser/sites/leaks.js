/**
 * Leak Database — bucky://leaks
 *
 * The fictional breach / OSINT site of BuckyNet. Everything here is invented
 * in-universe content: fake breaches, fake usernames, fake accounts, fake
 * exposed emails. Nothing references a real person, brand or service.
 *
 * Content is authored as DATA (BREACHES and EXPOSED). Phase 3B's OSINT layer
 * will make these records investigable (correlation, pivots, mission hooks);
 * for Phase 3A they render as a read-only archive. The renderer reads the
 * arrays and does not care whether a future OSINTService generated them.
 *
 * Every field is HTML-escaped through the site kit before it reaches the
 * viewport — authored or future-dynamic content can never inject markup.
 */
import { escapeHtml, link, chip, sitePage } from "./kit.js";

const SITE = "leaks";
const DOMAIN = "Leak Database";

function leakUrl(slug) {
    return slug ? `bucky://leaks/${slug}` : "bucky://leaks";
}

/** Fictional breach reports. */
const BREACHES = [
    {
        id: "BRCH-0091",
        name: "LuckyChip Casino Node",
        date: "Cycle 288",
        records: "4,210",
        severity: "Moderate",
        note: "Token wallets exposed after a default credential was left on the arcade relay. No Credits affected."
    },
    {
        id: "BRCH-0102",
        name: "Arcade Node arcade-01",
        date: "Cycle 297",
        records: "1,884",
        severity: "Low",
        note: "Session logs scraped from an unguarded node. Operator handles exposed; no passwords in the set."
    },
    {
        id: "BRCH-0117",
        name: "Unknown Relay — unsigned",
        date: "Cycle 309",
        records: "??",
        severity: "Severe",
        note: "Source unverified. The dump arrived with a transmission no creator will claim. Flagged for OSINT review."
    }
];

/** Fictional exposed accounts. All names, handles and emails are invented. */
const EXPOSED = [
    { handle: "node_runner", email: "node.runner@bucky,net", source: "BRCH-0102", exposed: "handle, session log" },
    { handle: "halflight", email: "halflight@bucky,net", source: "BRCH-0091", exposed: "handle, token wallet id" },
    { handle: "trace_void", email: "trace.void@bucky,net", source: "BRCH-0102", exposed: "handle, last route" },
    { handle: "gridhopper", email: "gridhopper@bucky,net", source: "BRCH-0091", exposed: "handle, token balance" },
    { handle: "anon_signal", email: "anon@bucky,net", source: "BRCH-0117", exposed: "handle only — record incomplete" },
    { handle: "operator", email: "tommy@bucky,net", source: "BRCH-0102", exposed: "handle, workstation id" }
];

const SEVERITY_CLASS = { Low: "is-low", Moderate: "is-mod", Severe: "is-sev" };

// ----- Rendering -------------------------------------------------------------

function severityChip(severity) {
    const cls = SEVERITY_CLASS[severity] || "is-mod";
    return `<span class="vm-leak-sev ${cls}">${escapeHtml(severity)}</span>`;
}

function renderBreachCards() {
    return BREACHES.map((breach) => `
        <article class="vm-leak-card">
            <div class="vm-leak-card-head">
                <span class="vm-leak-id">${escapeHtml(breach.id)}</span>
                ${severityChip(breach.severity)}
            </div>
            <h3>${escapeHtml(breach.name)}</h3>
            <div class="vm-leak-card-stats">
                <span>${escapeHtml(breach.date)}</span>
                <span>${escapeHtml(breach.records)} records</span>
            </div>
            <p>${escapeHtml(breach.note)}</p>
        </article>
    `).join("");
}

function renderExposedTable() {
    const rows = EXPOSED.map((account) => `
        <tr>
            <td class="vm-leak-handle">${escapeHtml(account.handle)}</td>
            <td>${escapeHtml(account.email)}</td>
            <td>${escapeHtml(account.source)}</td>
            <td>${escapeHtml(account.exposed)}</td>
        </tr>
    `).join("");
    return `
        <div class="vm-leak-tablewrap">
            <table class="vm-leak-table">
                <thead>
                    <tr><th>Handle</th><th>Exposed email</th><th>Source</th><th>Exposed data</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

const DISCLAIMER =
    "Every record in the Leak Database is fictional, in-universe VM content. No handle, email or " +
    "breach here refers to a real person, account or organisation.";

/** Render the Leak Database home. */
function renderHome() {
    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">
                The Leak Database is BuckyNet's breach archive — the future home of the OSINT layer.
                Browse breach reports and the exposed-account index below.
            </p>
            <div class="vm-leak-notice">${escapeHtml(DISCLAIMER)}</div>
            <section class="vm-wiki-section">
                <h2>Breach reports</h2>
                <div class="vm-leak-grid">${renderBreachCards()}</div>
                <p class="vm-leak-more">${link("bucky://leaks/breach-reports", "Open the full breach report index ›")}</p>
            </section>
            <section class="vm-wiki-section">
                <h2>Exposed accounts</h2>
                ${renderExposedTable()}
                <p class="vm-leak-more">${link("bucky://leaks/exposed-accounts", "Open the full exposed-account index ›")}</p>
            </section>
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · bucky://leaks`,
        title: "Leak Database",
        lead: "BuckyNet's breach archive.",
        bodyHtml: body
    });
}

/** Render the standalone breach report index. */
function renderBreachReports() {
    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">
                Breach reports filed on the Grid. Each report is a fictional incident; the OSINT layer
                will make them investigable in a later phase.
            </p>
            <div class="vm-leak-notice">${escapeHtml(DISCLAIMER)}</div>
            <div class="vm-leak-grid">${renderBreachCards()}</div>
            <p class="vm-leak-more">${link("bucky://leaks", "‹ Back to the Leak Database")}</p>
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · bucky://leaks/breach-reports`,
        title: "Breach Reports",
        lead: "Fictional breach incidents filed on the Grid.",
        bodyHtml: body
    });
}

/** Render the standalone exposed-account index. */
function renderExposedAccounts() {
    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">
                The exposed-account index. Handles and emails below are invented in-universe content
                tied to fictional breaches.
            </p>
            <div class="vm-leak-notice">${escapeHtml(DISCLAIMER)}</div>
            ${renderExposedTable()}
            <p class="vm-leak-more">${link("bucky://leaks", "‹ Back to the Leak Database")}</p>
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · bucky://leaks/exposed-accounts`,
        title: "Exposed Accounts",
        lead: "The fictional exposed-account index.",
        bodyHtml: body
    });
}

// ----- Registration ----------------------------------------------------------

/** Register every Leak Database page into the given SiteRegistry. */
export function registerLeaksSite(registry) {
    registry.register({
        id: "leaks-home",
        url: "bucky://leaks",
        site: SITE,
        title: "Leak Database",
        type: "home",
        keywords: ["leaks", "leak", "bucky", "database", "breach", "breaches", "osint", "exposed", "dump"],
        description: "BuckyNet's breach archive — fictional breach reports and exposed accounts.",
        tags: ["leaks", "site", "osint"],
        render: () => renderHome()
    });

    registry.register({
        id: "leaks-breach-reports",
        url: "bucky://leaks/breach-reports",
        site: SITE,
        title: "Breach Reports",
        type: "index",
        keywords: ["breach", "breaches", "reports", "leaks", "leak", "bucky", "incident", "osint"],
        description: "The full index of fictional breach reports filed on the Grid.",
        tags: ["leaks", "breach", "osint"],
        render: () => renderBreachReports()
    });

    registry.register({
        id: "leaks-exposed-accounts",
        url: "bucky://leaks/exposed-accounts",
        site: SITE,
        title: "Exposed Accounts",
        type: "index",
        keywords: ["exposed", "accounts", "leaks", "leak", "bucky", "emails", "handles", "osint"],
        description: "The fictional exposed-account index — invented handles and emails.",
        tags: ["leaks", "accounts", "osint"],
        render: () => renderExposedAccounts()
    });
}
