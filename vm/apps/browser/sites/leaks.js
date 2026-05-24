/**
 * Leak Database — bucky://leaks
 *
 * The fictional breach / OSINT site of BuckyNet. Everything here is invented
 * in-universe content: fake breaches, fake usernames, fake accounts, fake
 * exposed credentials, fake incident reports. Nothing references a real
 * person, brand or service.
 *
 * Phase 3B expansion: breach categories, timestamps, organisation names,
 * per-breach incident report pages, per-account fake profile pages with
 * (masked, fictional) exposed credentials, and searchable leak entries. The
 * OSINT layer of a later phase will make these records correlatable; for now
 * they render as a deep, browsable, cross-linked archive.
 *
 * Content is authored as DATA (BREACHES, EXPOSED). The renderer does not care
 * whether a future OSINTService generated the records. Every field is
 * HTML-escaped through the site kit before it reaches the viewport.
 */
import { escapeHtml, link, chip, sitePage, crossRefs } from "./kit.js";

const SITE = "leaks";
const DOMAIN = "Leak Database";

/** Fictional breach reports. */
const BREACHES = [
    {
        id: "BRCH-0123",
        name: "Helix Dynamics Internal Relay",
        org: "Helix Dynamics",
        category: "Credential dump",
        date: "Cycle 311",
        records: "12,640",
        severity: "Severe",
        note: "An internal Helix relay was left on a default credential. Operator handles and masked credentials exposed.",
        detail: [
            "Helix Dynamics runs more nodes than it watches. Internal relay Helix-4 was reachable with a factory credential that was never rotated.",
            "The dump is large and clean — a Static Den signature. They did not break the relay; they walked in and copied the index.",
            "This is the breach that put Helix Dynamics back at the top of the database."
        ],
        wiki: "bucky://wiki/helix-dynamics"
    },
    {
        id: "BRCH-0117",
        name: "Unknown Relay — unsigned",
        org: "Unverified",
        category: "Unverified dump",
        date: "Cycle 309",
        records: "??",
        severity: "Severe",
        note: "Source unverified. The dump arrived with a transmission no creator will claim. Flagged for OSINT review.",
        detail: [
            "BRCH-0117 is the database's open question. The dump has no verified origin node and the record count never resolves.",
            "It arrived alongside a sixty-seven second transmission. The source address in the metadata resolves to an unindexed region of the Grid — the ninth sector.",
            "Operators mapping hidden routes use this incident as the entry point."
        ],
        wiki: "bucky://wiki/virus",
        lead: "bucky://hidden/sector-9"
    },
    {
        id: "BRCH-0130",
        name: "Northgate Freight Manifest",
        org: "Northgate Freight",
        category: "Records leak",
        date: "Cycle 312",
        records: "3,002",
        severity: "Moderate",
        note: "Shipping manifests and operator handles scraped from a Northgate logistics node.",
        detail: [
            "Northgate Freight moves cargo data across the Grid. A logistics node exposed manifest records and the handles of operators with access.",
            "No credentials in the set — handles and routes only. Low value alone, useful when correlated with another breach."
        ]
    },
    {
        id: "BRCH-0091",
        name: "LuckyChip Casino Node",
        org: "LuckyChip",
        category: "Token wallet dump",
        date: "Cycle 288",
        records: "4,210",
        severity: "Moderate",
        note: "Token wallets exposed after a default credential was left on the arcade relay. No Credits affected.",
        detail: [
            "The LuckyChip casino node exposed token wallet identifiers. Bucky Credits were never in scope — arcade tokens and Grid Credits are separate wallets.",
            "An old breach, kept because several handles in it reappear in newer dumps."
        ],
        wiki: "bucky://wiki/items"
    },
    {
        id: "BRCH-0102",
        name: "Arcade Node arcade-01",
        org: "Caldera Energy",
        category: "Session log scrape",
        date: "Cycle 297",
        records: "1,884",
        severity: "Low",
        note: "Session logs scraped from an unguarded node. Operator handles exposed; no passwords in the set.",
        detail: [
            "Caldera Energy runs the arcade relay. Node arcade-01 exposed session logs — handles, timestamps, last routes.",
            "Low severity, high usefulness: a session log is a map of where an operator has been."
        ],
        wiki: "bucky://wiki/caldera-energy"
    }
];

/** Fictional exposed accounts. All names, handles, emails and credentials are invented. */
const EXPOSED = [
    {
        handle: "node_runner", email: "node.runner@bucky,net", source: "BRCH-0102",
        joined: "Cycle 304", lastSeen: "Cycle 312", exposed: "handle, session log",
        note: "A new operator. Active, careful, no faction ties on record.",
        credentials: [{ service: "BuckyNet session", secret: "••••••••", hint: "no password in this dump" }]
    },
    {
        handle: "halflight", email: "halflight@bucky,net", source: "BRCH-0091",
        joined: "Cycle 271", lastSeen: "Cycle 309", exposed: "handle, token wallet id",
        note: "Frequent BuckTube commenter. Spotted the banknote serial match on Unknown Transmission.",
        credentials: [{ service: "LuckyChip wallet", secret: "wallet:LC-••••", hint: "wallet id only — no key" }]
    },
    {
        handle: "trace_void", email: "trace.void@bucky,net", source: "BRCH-0123",
        joined: "Cycle 240", lastSeen: "Cycle 311", exposed: "handle, masked credential, last route",
        note: "Recurring handle across multiple breaches. Static Den suspect — unconfirmed.",
        faction: "Static Den (suspected)",
        credentials: [{ service: "Helix relay", secret: "••••••••••", hint: "reused across two nodes" }]
    },
    {
        handle: "gridhopper", email: "gridhopper@bucky,net", source: "BRCH-0091",
        joined: "Cycle 288", lastSeen: "Cycle 312", exposed: "handle, token balance",
        note: "Community creator. Runs arcade-night content. No security concern on record.",
        credentials: [{ service: "LuckyChip wallet", secret: "wallet:LC-••••", hint: "balance exposed, no key" }]
    },
    {
        handle: "anon_signal", email: "anon@bucky,net", source: "BRCH-0117",
        joined: "Cycle ???", lastSeen: "Cycle ???", exposed: "handle only — record incomplete",
        note: "Uploader of the Unknown Transmission. Join date predates the public Grid. Record incomplete.",
        faction: "Unknown",
        credentials: [{ service: "—", secret: "—", hint: "no credential data recovered" }]
    },
    {
        handle: "coldstart", email: "coldstart@bucky,net", source: "BRCH-0123",
        joined: "Cycle 290", lastSeen: "Cycle 312", exposed: "handle, masked credential",
        note: "Security-minded operator. Quotes the Security Awareness reel often.",
        credentials: [{ service: "Helix relay", secret: "••••••••", hint: "rotated after the breach" }]
    },
    {
        handle: "operator", email: "tommy@bucky,net", source: "BRCH-0102",
        joined: "Cycle 305", lastSeen: "Cycle 312", exposed: "handle, workstation id",
        note: "This workstation's operator handle. Exposed in a low-severity log scrape — a reminder that everyone is in here.",
        credentials: [{ service: "BuckyNet session", secret: "••••••••", hint: "this is a fictional record" }]
    }
];

const SEVERITY_CLASS = { Low: "is-low", Moderate: "is-mod", Severe: "is-sev" };
const BREACH_BY_ID = new Map(BREACHES.map((breach) => [breach.id, breach]));
const ACCOUNT_BY_HANDLE = new Map(EXPOSED.map((account) => [account.handle, account]));

const DISCLAIMER =
    "Every record in the Leak Database is fictional, in-universe VM content. No handle, email, " +
    "credential or breach here refers to a real person, account or organisation.";

function incidentUrl(id) {
    return `bucky://leaks/incident/${id.toLowerCase()}`;
}
function profileUrl(handle) {
    return `bucky://leaks/profile/${handle}`;
}

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
            <h3>${link(incidentUrl(breach.id), breach.name, "vm-leak-card-title")}</h3>
            <div class="vm-leak-card-stats">
                <span>${escapeHtml(breach.org)}</span>
                <span>${escapeHtml(breach.date)}</span>
                <span>${escapeHtml(breach.records)} records</span>
            </div>
            <div class="vm-site-chiprow">${chip(breach.category)}</div>
            <p>${escapeHtml(breach.note)}</p>
            <p class="vm-leak-more">${link(incidentUrl(breach.id), "Open incident report ›")}</p>
        </article>
    `).join("");
}

function renderExposedTable() {
    const rows = EXPOSED.map((account) => `
        <tr>
            <td class="vm-leak-handle">${link(profileUrl(account.handle), account.handle)}</td>
            <td>${escapeHtml(account.email)}</td>
            <td>${link(incidentUrl(account.source), account.source)}</td>
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

/** Render the Leak Database home. */
function renderHome() {
    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">
                The Leak Database is BuckyNet's breach archive — the future home of the OSINT layer.
                ${BREACHES.length} breach reports, ${EXPOSED.length} exposed accounts. Every entry is
                searchable and cross-linked.
            </p>
            <div class="vm-leak-notice">${escapeHtml(DISCLAIMER)}</div>
            <section class="vm-wiki-section">
                <h2>Breach reports</h2>
                <div class="vm-leak-grid">${renderBreachCards()}</div>
            </section>
            <section class="vm-wiki-section">
                <h2>Exposed accounts</h2>
                ${renderExposedTable()}
                <p class="vm-leak-more">${link("bucky://leaks/exposed-accounts", "Open the full exposed-account index ›")}</p>
            </section>
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://wiki/static-den", label: "BuckyWiki: The Static Den", note: "the crew behind the dumps" },
                { url: "bucky://community", label: "Bucky Community", note: "share OSINT finds" }
            ])}
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
                Every breach report filed on the Grid. Each is a fictional incident; open a report
                for the full write-up and the accounts it exposed.
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
                tied to fictional breaches. Open a handle for its full profile.
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

/** Render one breach incident report. */
function renderIncident(breach) {
    const affected = EXPOSED.filter((account) => account.source === breach.id);
    const affectedHtml = affected.length
        ? `<ul class="vm-wiki-links">${affected.map((account) =>
            `<li>${link(profileUrl(account.handle), account.handle)}
             <span class="vm-wiki-links-cat">${escapeHtml(account.exposed)}</span></li>`).join("")}</ul>`
        : `<p>No individual accounts are itemised for this incident.</p>`;

    const refs = [];
    if (breach.wiki) refs.push({ url: breach.wiki, label: "BuckyWiki context", note: "the organisation" });
    if (breach.lead) refs.push({ url: breach.lead, label: "Trace the source address", note: "unindexed route" });
    refs.push({ url: "bucky://leaks/breach-reports", label: "All breach reports", note: "back to the index" });

    const body = `
        <div class="vm-wiki-body">
            <div class="vm-leak-incident-head">
                <span class="vm-leak-id">${escapeHtml(breach.id)}</span>
                ${severityChip(breach.severity)}
                ${chip(breach.category)}
            </div>
            <div class="vm-leak-incident-grid">
                <div class="vm-wiki-info-row"><span>Organisation</span><strong>${escapeHtml(breach.org)}</strong></div>
                <div class="vm-wiki-info-row"><span>Filed</span><strong>${escapeHtml(breach.date)}</strong></div>
                <div class="vm-wiki-info-row"><span>Records</span><strong>${escapeHtml(breach.records)}</strong></div>
                <div class="vm-wiki-info-row"><span>Severity</span><strong>${escapeHtml(breach.severity)}</strong></div>
            </div>
            <div class="vm-leak-notice">${escapeHtml(DISCLAIMER)}</div>
            <section class="vm-wiki-section">
                <h2>Incident report</h2>
                ${breach.detail.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}
            </section>
            <section class="vm-wiki-section">
                <h2>Exposed accounts</h2>
                ${affectedHtml}
            </section>
            ${crossRefs("Follow the thread", refs)}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · ${incidentUrl(breach.id)}`,
        title: breach.name,
        lead: `${breach.id} · ${breach.org} · ${breach.severity}`,
        bodyHtml: body
    });
}

/** Render one fake account profile. */
function renderProfile(account) {
    const breach = BREACH_BY_ID.get(account.source);
    const creds = account.credentials.map((cred) => `
        <tr>
            <td>${escapeHtml(cred.service)}</td>
            <td class="vm-leak-cred">${escapeHtml(cred.secret)}</td>
            <td>${escapeHtml(cred.hint)}</td>
        </tr>
    `).join("");

    const refs = [
        { url: incidentUrl(account.source), label: `Incident ${account.source}`, note: "the breach" },
        { url: "bucky://leaks/exposed-accounts", label: "Exposed accounts", note: "the full index" }
    ];
    if (account.faction && account.faction.indexOf("Static Den") !== -1) {
        refs.push({ url: "bucky://wiki/static-den", label: "BuckyWiki: The Static Den", note: "suspected faction" });
    }

    const body = `
        <div class="vm-wiki-body">
            <div class="vm-leak-profile-head">
                <span class="vm-leak-avatar" aria-hidden="true">${escapeHtml(account.handle.slice(0, 1).toUpperCase())}</span>
                <div>
                    <div class="vm-leak-profile-handle">${escapeHtml(account.handle)}</div>
                    <div class="vm-leak-profile-email">${escapeHtml(account.email)}</div>
                </div>
            </div>
            <div class="vm-leak-notice">${escapeHtml(DISCLAIMER)}</div>
            <div class="vm-leak-incident-grid">
                <div class="vm-wiki-info-row"><span>Joined</span><strong>${escapeHtml(account.joined)}</strong></div>
                <div class="vm-wiki-info-row"><span>Last seen</span><strong>${escapeHtml(account.lastSeen)}</strong></div>
                <div class="vm-wiki-info-row"><span>Source breach</span><strong>${escapeHtml(account.source)}</strong></div>
                <div class="vm-wiki-info-row"><span>Faction</span><strong>${escapeHtml(account.faction || "None on record")}</strong></div>
            </div>
            <section class="vm-wiki-section">
                <h2>Profile note</h2>
                <p>${escapeHtml(account.note)}</p>
                ${breach ? `<p>Exposed in <strong>${escapeHtml(breach.name)}</strong> (${escapeHtml(breach.date)}).</p>` : ""}
            </section>
            <section class="vm-wiki-section">
                <h2>Exposed credentials</h2>
                <p class="vm-leak-cred-note">Credentials are masked and entirely fictional — no usable secret is shown.</p>
                <div class="vm-leak-tablewrap">
                    <table class="vm-leak-table">
                        <thead><tr><th>Service</th><th>Credential</th><th>Note</th></tr></thead>
                        <tbody>${creds}</tbody>
                    </table>
                </div>
            </section>
            ${crossRefs("Follow the thread", refs)}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · ${profileUrl(account.handle)}`,
        title: account.handle,
        lead: `Exposed account · source ${account.source}`,
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
        description: "BuckyNet's breach archive — fictional breach reports, incident reports and exposed accounts.",
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
        keywords: ["exposed", "accounts", "leaks", "leak", "bucky", "emails", "handles", "osint", "credentials"],
        description: "The fictional exposed-account index — invented handles, emails and masked credentials.",
        tags: ["leaks", "accounts", "osint"],
        render: () => renderExposedAccounts()
    });

    // Per-breach incident reports — each a searchable leak entry.
    BREACHES.forEach((breach) => {
        registry.register({
            id: `leaks-incident-${breach.id}`,
            url: incidentUrl(breach.id),
            site: SITE,
            title: breach.name,
            type: "incident",
            keywords: ["breach", "incident", breach.id.toLowerCase(), breach.org.toLowerCase(),
                breach.category.toLowerCase(), "leak", "leaks"],
            description: `${breach.id} — ${breach.category} · ${breach.org} · ${breach.note}`,
            tags: ["leaks", "incident", "breach"],
            render: () => renderIncident(breach)
        });
    });

    // Per-account fake profiles — each a searchable leak entry.
    EXPOSED.forEach((account) => {
        registry.register({
            id: `leaks-profile-${account.handle}`,
            url: profileUrl(account.handle),
            site: SITE,
            title: account.handle,
            type: "profile",
            keywords: ["account", "profile", "handle", account.handle.toLowerCase(),
                "exposed", "leak", "leaks", "osint"],
            description: `Exposed account ${account.handle} — ${account.note}`,
            tags: ["leaks", "profile", "account"],
            render: () => renderProfile(account)
        });
    });
}
