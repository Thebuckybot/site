/**
 * BuckyWiki — bucky://wiki
 *
 * The in-universe encyclopedia. Articles are authored as DATA (WIKI_ARTICLES)
 * and registered one page per entry; adding an article is a pure data edit.
 *
 * Phase 3B expansion: corporation and faction pages, a History category with
 * a timeline layout, richer infoboxes, related-article links and cross-site
 * references that wire the wiki into the wider BuckyNet ecosystem.
 *
 * Every page renders through the shared site kit, so all authored and derived
 * text is HTML-escaped before it reaches the browser viewport.
 */
import { escapeHtml, link, chip, sitePage, crossRefs } from "./kit.js";

const SITE = "wiki";
const DOMAIN = "BuckyWiki";

/** bucky:// address for a wiki article slug. */
function wikiUrl(slug) {
    return slug ? `bucky://wiki/${slug}` : "bucky://wiki";
}

/**
 * Authored wiki content. Each record is one encyclopedia page.
 *   slug, title, category, description, keywords, tags, lead
 *   infobox   [label, value] fact rows
 *   sections  [heading, [paragraph, ...]] blocks
 *   timeline  optional [date, event] rows (History articles)
 *   seeAlso   slugs of related wiki articles
 *   crossRefs optional [{url,label,note}] links to other BuckyNet sites
 */
const WIKI_ARTICLES = [
    {
        slug: "bucky",
        title: "Bucky",
        category: "The Grid",
        description: "Bucky is the resident intelligence of the Bucky VM and the namesake of BuckyNet — the fictional network this workstation connects to.",
        keywords: ["bucky", "mascot", "intelligence", "ai", "grid", "buckynet", "lore", "universe", "operator"],
        tags: ["wiki", "lore", "core"],
        lead: "Resident intelligence of the Bucky VM and namesake of BuckyNet.",
        infobox: [
            ["Type", "Network intelligence"],
            ["Domain", "BuckyNet / The Grid"],
            ["First seen", "Boot layer 0.1"],
            ["Status", "Online"]
        ],
        sections: [
            ["Overview", [
                "Bucky is the in-universe intelligence that runs the Bucky VM, a fictional cybersecurity workstation. Bucky is not a person and not a real product — it is a character of the Bucky universe, woven through the terminal, the filesystem and the network you are browsing now.",
                "Operators interact with Bucky indirectly: every command, every file and every page on BuckyNet passes through systems Bucky maintains. The VM presents Bucky as calm, dry and faintly amused by the operators it supervises."
            ]],
            ["The Grid", [
                "BuckyNet is informally called the Grid — a closed, simulated network with no path to the real internet. Everything reachable from this browser is internal VM content.",
                "The Grid is deliberately small and knowable. Bucky logs every route an operator takes, which is why the wiki, the leak database and the developer feed all feel like they are watching back."
            ]],
            ["Operators", [
                "An operator is the human session driving the VM. The workstation is issued per session, all storage is temporary, and progress is expected to be carried out of the VM rather than saved inside it."
            ]]
        ],
        seeAlso: ["virus", "commands", "items", "grid-timeline"],
        crossRefs: [
            { url: "bucky://bucky", label: "Bucky — official platform", note: "the landing site" },
            { url: "bucky://community", label: "Bucky Community", note: "the support server" }
        ]
    },
    {
        slug: "virus",
        title: "The Virus",
        category: "Threats",
        description: "The Virus is the recurring antagonist of the Bucky universe — a fictional self-rewriting malware family that hunts the Grid for unguarded nodes.",
        keywords: ["virus", "the virus", "malware", "infection", "threat", "enemy", "attack", "worm", "payload"],
        tags: ["wiki", "lore", "threat", "enemy"],
        lead: "The recurring antagonist of the Bucky universe.",
        infobox: [
            ["Classification", "Self-rewriting malware"],
            ["Origin", "Unknown — see Transmission 0"],
            ["Behaviour", "Spreads node to node"],
            ["Threat level", "Severe"],
            ["First contained", "Cycle 188"]
        ],
        sections: [
            ["Overview", [
                "The Virus is a fictional malware family and the central threat of the Bucky universe. It is written into the lore as a self-rewriting program: every time it is studied it has already changed, so no two analyses of the Virus ever fully agree.",
                "Within VM missions the Virus is the reason the workstation exists. Operators are trained against it, not expected to defeat it outright."
            ]],
            ["Behaviour", [
                "The Virus spreads across the Grid one node at a time, preferring nodes with weak or default credentials. It leaves fragments — corrupted files, half-finished transmissions — that operators can recover and study.",
                "It does not act with malice in the story so much as appetite. The Virus consumes attention, storage and trust, and the Grid is its feeding ground. It favours sectors no one searches for."
            ]],
            ["Countermeasures", [
                "Security scripts are the in-universe defence against the Virus. They will not remove it, but they slow it and make its movements visible. Bucky Security trains every operator on the same principle: you cannot delete the Virus, but you can always see it."
            ]]
        ],
        seeAlso: ["attack-scripts", "security-scripts", "static-den", "bucky"],
        crossRefs: [
            { url: "bucky://leaks", label: "Leak Database", note: "incidents attributed to the Virus" },
            { url: "bucky://tube/unknown-transmission", label: "Unknown Transmission", note: "a recovered fragment" }
        ]
    },
    {
        slug: "items",
        title: "Items & Collectables",
        category: "The Grid",
        description: "A reference for Bucky-universe items: currency, banknotes, LuckyChip tokens and the collectables operators recover across the Grid.",
        keywords: ["items", "collectables", "collectibles", "currency", "banknote", "luckychip", "loot", "tokens", "economy"],
        tags: ["wiki", "lore", "economy", "items"],
        lead: "Currency, tokens and collectables of the Bucky economy.",
        infobox: [
            ["Currency", "Bucky Credits"],
            ["Tokens", "LuckyChip"],
            ["Collectables", "Series 1 — 3"],
            ["Tradeable", "In-universe only"]
        ],
        sections: [
            ["Currency", [
                "The Bucky economy runs on Bucky Credits, represented in-universe as printed banknotes. Credits are entirely fictional and exist only to drive missions and progression — they buy nothing real.",
                "Banknotes recovered from the Grid carry serial fragments. Some of those fragments are clues."
            ]],
            ["LuckyChip", [
                "LuckyChip tokens are the arcade-side currency of the Bucky universe, tied to the LuckyChip casino node. They are kept separate from Credits so arcade play and Grid work never share a wallet."
            ]],
            ["Collectables", [
                "Collectables are cosmetic items scattered across the Grid in numbered series. They have no combat or economic effect; they are a record of where an operator has been. Series 3 is the current giveaway set in the community server."
            ]]
        ],
        seeAlso: ["bucky", "commands"],
        crossRefs: [
            { url: "bucky://community", label: "Community giveaways", note: "Series 3 drop" }
        ]
    },
    {
        slug: "commands",
        title: "Terminal Commands",
        category: "Tools",
        description: "Reference for the Bucky VM terminal: the built-in commands an operator uses to move through the filesystem and run scripts.",
        keywords: ["terminal", "commands", "command", "cli", "shell", "ls", "cd", "mkdir", "help", "reference", "tools"],
        tags: ["wiki", "tools", "terminal", "reference"],
        lead: "The built-in command reference for the VM terminal.",
        infobox: [
            ["Subsystem", "VM Terminal"],
            ["Shell", "BuckyShell"],
            ["Scripts", "Simulated runtime only"],
            ["Network", "browser command"]
        ],
        sections: [
            ["Navigation", [
                "ls lists a directory, cd changes the working directory, and pwd prints it. The terminal shares one filesystem with the Files app and BuckyCode, so anything you create is visible everywhere at once.",
                "mkdir creates directories (nested paths supported) and touch creates empty files."
            ]],
            ["Files", [
                "cat prints a file to the screen. edit opens a file in BuckyCode, creating it if it does not exist. open routes a file to BuckyCode or a folder to the Files app. chmod +x marks a file executable so it can be run directly as ./script.py."
            ]],
            ["Scripts and the network", [
                "python runs a .py file through the VM's simulated execution layer — no real code is ever executed. The browser command opens BuckyNet in a new browser window and optionally navigates straight to a bucky:// address.",
                "Commands are intentionally close to a real shell so the skill transfers, while staying entirely inside the VM."
            ]]
        ],
        seeAlso: ["bucky", "security-scripts", "attack-scripts"]
    },
    {
        slug: "attack-scripts",
        title: "Attack Scripts",
        category: "Tools",
        description: "Fictional offensive tooling of the Bucky universe — the script archetypes operators study to understand how the Grid is attacked.",
        keywords: ["attack", "scripts", "attack scripts", "offensive", "exploit", "payload", "intrusion", "red team"],
        tags: ["wiki", "tools", "offensive", "scripts"],
        lead: "Fictional offensive script archetypes of the Grid.",
        infobox: [
            ["Category", "Offensive tooling"],
            ["Status", "Lore reference"],
            ["Real code", "None — fictional"],
            ["Counterpart", "Security Scripts"]
        ],
        sections: [
            ["About this page", [
                "This article is a lore reference. It describes attack scripts as fictional objects in the Bucky universe — it does not contain, teach or imply any real offensive technique. Everything here is set dressing for missions.",
                "In-universe, attack scripts are how the Virus and rival crews move through the Grid."
            ]],
            ["Archetypes", [
                "The universe groups attack scripts into archetypes: probes that map a node, keys that misuse weak credentials, and lures that trick an operator into opening something. Each archetype is a mission concept, not a tool.",
                "Operators study the archetypes so they can recognise an attack in progress on the Grid and respond with the matching security script."
            ]]
        ],
        seeAlso: ["security-scripts", "virus", "static-den"]
    },
    {
        slug: "security-scripts",
        title: "Security Scripts",
        category: "Tools",
        description: "Fictional defensive tooling of the Bucky universe — the security script archetypes operators run to harden and watch a node.",
        keywords: ["security", "scripts", "security scripts", "defensive", "firewall", "hardening", "protection", "blue team"],
        tags: ["wiki", "tools", "defensive", "scripts"],
        lead: "Fictional defensive script archetypes of the Grid.",
        infobox: [
            ["Category", "Defensive tooling"],
            ["Status", "Lore reference"],
            ["Real code", "None — fictional"],
            ["Counterpart", "Attack Scripts"]
        ],
        sections: [
            ["About this page", [
                "Like its counterpart, this article is pure lore. Security scripts are fictional objects used to give missions a defensive vocabulary — there is no real code here.",
                "In-universe, security scripts are the operator's standard answer to the Virus."
            ]],
            ["Archetypes", [
                "Defensive archetypes mirror the offensive ones: watchers that log every route into a node, walls that refuse weak credentials, and traces that follow an intrusion back through the Grid.",
                "A security script never removes the Virus. It buys time and visibility — and in the Bucky universe, visibility is usually enough to win the mission."
            ]]
        ],
        seeAlso: ["attack-scripts", "virus", "bucky-security"]
    },
    {
        slug: "helix-dynamics",
        title: "Helix Dynamics",
        category: "Corporations",
        description: "Helix Dynamics is a fictional Grid corporation — a data-logistics firm and a recurring target of BuckyNet incidents.",
        keywords: ["helix", "dynamics", "helix dynamics", "corporation", "company", "corp", "data", "logistics"],
        tags: ["wiki", "corporation", "corp"],
        lead: "Fictional data-logistics corporation operating on the Grid.",
        infobox: [
            ["Sector", "Data logistics"],
            ["Founded", "Cycle 140 (in-universe)"],
            ["Grid nodes", "Helix-1 — Helix-6"],
            ["Standing", "Breached — see Leak Database"]
        ],
        sections: [
            ["Overview", [
                "Helix Dynamics is a fictional corporation in the Bucky universe. It moves and stores data for other Grid organisations, which makes it a large, attractive surface for the Virus and for rival crews.",
                "Helix is written as competent but overextended: too many nodes, too few watchers. In missions it is usually the place an investigation starts, not ends."
            ]],
            ["Incidents", [
                "Helix Dynamics appears in the Leak Database more than any other corporation. Its public nodes are stable; its internal relays are where the breaches happen.",
                "The Static Den is the crew most often named in Helix incident reports."
            ]]
        ],
        seeAlso: ["caldera-energy", "static-den", "virus"],
        crossRefs: [
            { url: "bucky://leaks/breach-reports", label: "Breach Reports", note: "Helix incidents" }
        ]
    },
    {
        slug: "caldera-energy",
        title: "Caldera Energy",
        category: "Corporations",
        description: "Caldera Energy is a fictional Grid corporation — a power utility whose nodes keep the arcade and the Grid lit.",
        keywords: ["caldera", "energy", "caldera energy", "corporation", "company", "corp", "power", "utility"],
        tags: ["wiki", "corporation", "corp"],
        lead: "Fictional power utility keeping the Grid lit.",
        infobox: [
            ["Sector", "Energy / utilities"],
            ["Founded", "Cycle 96 (in-universe)"],
            ["Grid nodes", "Caldera core + arcade relay"],
            ["Standing", "Stable"]
        ],
        sections: [
            ["Overview", [
                "Caldera Energy is a fictional utility corporation. It runs the power nodes the rest of the Grid depends on, including the arcade relay that keeps the LuckyChip casino online.",
                "Caldera is written as old, slow and careful — the opposite of Helix Dynamics. Its nodes are rarely breached, which in the Bucky universe makes operators suspicious rather than reassured."
            ]],
            ["Role in missions", [
                "Caldera is the corporation missions use for infrastructure stakes: when a node goes dark, it is usually a Caldera relay, and the blackout is the timer the operator races."
            ]]
        ],
        seeAlso: ["helix-dynamics", "grid-timeline"]
    },
    {
        slug: "static-den",
        title: "The Static Den",
        category: "Factions",
        description: "The Static Den is a fictional threat crew of the Bucky universe — pseudonymous operators who trade in leaks and unguarded nodes.",
        keywords: ["static", "den", "static den", "faction", "crew", "threat", "hacker", "group"],
        tags: ["wiki", "faction", "threat"],
        lead: "Fictional threat crew that trades in leaks and unguarded nodes.",
        infobox: [
            ["Type", "Threat faction"],
            ["Members", "Pseudonymous"],
            ["Known for", "Leaks, breach trading"],
            ["Opposed by", "Bucky Security"]
        ],
        sections: [
            ["Overview", [
                "The Static Den is a fictional crew — a loose faction of pseudonymous operators. They are not the Virus; they are people. That makes them, in mission terms, the easier and the more dangerous threat: easier to trace, harder to predict.",
                "The Den's signature is patience. They do not break nodes. They wait for a node to be left open and walk in."
            ]],
            ["On the Grid", [
                "Static Den handles surface across BuckyNet — in leak records, in BuckTube comments, in forum chatter. Following a Den handle from one site to the next is a standard OSINT mission pattern.",
                "Several Helix Dynamics breaches are attributed to the Den."
            ]]
        ],
        seeAlso: ["virus", "helix-dynamics", "bucky-security"],
        crossRefs: [
            { url: "bucky://leaks/exposed-accounts", label: "Exposed Accounts", note: "Den handles surface here" }
        ]
    },
    {
        slug: "bucky-security",
        title: "Bucky Security",
        category: "Factions",
        description: "Bucky Security is the in-universe cybersecurity organisation that issues the VM and trains operators against the Virus.",
        keywords: ["bucky security", "security", "faction", "soc", "defenders", "training", "operators", "blue team"],
        tags: ["wiki", "faction", "defensive"],
        lead: "The in-universe organisation that issues the VM and trains operators.",
        infobox: [
            ["Type", "Defensive organisation"],
            ["Role", "Issues the Bucky VM"],
            ["Doctrine", "See, do not delete"],
            ["Opposes", "The Virus, the Static Den"]
        ],
        sections: [
            ["Overview", [
                "Bucky Security is the fictional cybersecurity organisation of the Bucky universe. It builds and issues the workstation you are using and writes the missions operators run.",
                "Its doctrine is simple and repeated everywhere: you cannot delete the Virus, so make sure you can always see it."
            ]],
            ["Training", [
                "Bucky Security produces the training reels on BuckTube and the tool documentation in this wiki. An operator's progression — levels, installed tools, mission flags — is tracked by Bucky Security and synced to the community."
            ]]
        ],
        seeAlso: ["security-scripts", "static-den", "commands"],
        crossRefs: [
            { url: "bucky://tube/security-awareness", label: "Security Awareness", note: "training reel" }
        ]
    },
    {
        slug: "grid-timeline",
        title: "Timeline of the Grid",
        category: "History",
        description: "A fictional in-universe history of BuckyNet — how the Grid was built, breached and brought online.",
        keywords: ["timeline", "history", "grid", "buckynet", "cycles", "events", "lore"],
        tags: ["wiki", "history", "timeline", "lore"],
        lead: "A fictional in-universe history of BuckyNet, cycle by cycle.",
        infobox: [
            ["Scope", "Cycle 0 — present"],
            ["Unit", "Cycle (in-universe)"],
            ["Status", "Maintained by Bucky Security"]
        ],
        sections: [
            ["About this timeline", [
                "Cycles are the Bucky universe's unit of in-universe time. This timeline is lore — it gives missions and articles a shared history to reference."
            ]]
        ],
        timeline: [
            ["Cycle 0", "The first Grid nodes come online. BuckyNet is a handful of sectors and no search engine."],
            ["Cycle 96", "Caldera Energy is founded; the arcade relay is built."],
            ["Cycle 140", "Helix Dynamics is founded. Data logistics make the Grid worth attacking."],
            ["Cycle 188", "The Virus is contained for the first time. It is never removed."],
            ["Cycle 240", "The Static Den is first named in a Helix incident report."],
            ["Cycle 305", "BuckyNet goes public. PulseSearch indexes the Grid."],
            ["Cycle 312", "The browser layer expands: tabs, bookmarks and the wider ecosystem."]
        ],
        seeAlso: ["bucky", "virus", "helix-dynamics"]
    }
];

/** Index of slug -> article, for resolving seeAlso links to titles. */
const BY_SLUG = new Map(WIKI_ARTICLES.map((article) => [article.slug, article]));

// ----- Rendering -------------------------------------------------------------

function renderInfobox(rows) {
    if (!rows || !rows.length) return "";
    const body = rows.map(([label, value]) =>
        `<div class="vm-wiki-info-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
    ).join("");
    return `<aside class="vm-wiki-infobox"><div class="vm-wiki-info-head">Quick facts</div>${body}</aside>`;
}

function renderSections(sections) {
    return sections.map(([heading, paragraphs]) => `
        <section class="vm-wiki-section">
            <h2>${escapeHtml(heading)}</h2>
            ${paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}
        </section>
    `).join("");
}

function renderTimeline(rows) {
    if (!rows || !rows.length) return "";
    const items = rows.map(([date, event]) => `
        <li class="vm-wiki-tl-item">
            <span class="vm-wiki-tl-date">${escapeHtml(date)}</span>
            <span class="vm-wiki-tl-event">${escapeHtml(event)}</span>
        </li>
    `).join("");
    return `
        <section class="vm-wiki-section">
            <h2>Timeline</h2>
            <ul class="vm-wiki-timeline">${items}</ul>
        </section>
    `;
}

function renderSeeAlso(slugs) {
    const items = (slugs || [])
        .map((slug) => BY_SLUG.get(slug))
        .filter(Boolean)
        .map((article) => `<li>${link(wikiUrl(article.slug), article.title)}
            <span class="vm-wiki-links-cat">${escapeHtml(article.category)}</span></li>`)
        .join("");
    if (!items) return "";
    return `
        <section class="vm-wiki-section vm-wiki-seealso">
            <h2>Related articles</h2>
            <ul class="vm-wiki-links">${items}</ul>
        </section>
    `;
}

/** Render one wiki article page. */
function renderArticle(article) {
    const body = `
        <div class="vm-wiki-article">
            ${renderInfobox(article.infobox)}
            <div class="vm-wiki-body">
                ${renderSections(article.sections)}
                ${renderTimeline(article.timeline)}
                ${renderSeeAlso(article.seeAlso)}
                ${crossRefs("Across BuckyNet", article.crossRefs)}
            </div>
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · ${wikiUrl(article.slug)}`,
        title: article.title,
        lead: article.lead,
        bodyHtml: body
    });
}

/** Render the BuckyWiki index — articles grouped by category. */
function renderHome() {
    const ORDER = ["The Grid", "Threats", "Factions", "Corporations", "Tools", "History"];
    const categories = [];
    WIKI_ARTICLES.forEach((article) => {
        let group = categories.find((entry) => entry.name === article.category);
        if (!group) {
            group = { name: article.category, articles: [] };
            categories.push(group);
        }
        group.articles.push(article);
    });
    categories.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));

    const groupsHtml = categories.map((group) => `
        <section class="vm-wiki-section">
            <h2>${escapeHtml(group.name)}</h2>
            <div class="vm-wiki-index">
                ${group.articles.map((article) => `
                    <article class="vm-wiki-card">
                        ${link(wikiUrl(article.slug), article.title, "vm-wiki-card-title")}
                        <p>${escapeHtml(article.description)}</p>
                    </article>
                `).join("")}
            </div>
        </section>
    `).join("");

    const body = `
        <div class="vm-wiki-body">
            <p class="vm-wiki-intro">
                BuckyWiki is the community knowledge base of BuckyNet. ${WIKI_ARTICLES.length} articles
                cover the lore, tools, threats, factions and corporations of the Bucky universe — all
                internal VM content.
            </p>
            <div class="vm-site-chiprow">${["The Grid", "Threats", "Factions", "Corporations", "Tools", "History"].map((c) => chip(c)).join("")}</div>
            ${groupsHtml}
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://bucky", label: "Bucky", note: "the official platform" },
                { url: "bucky://leaks", label: "Leak Database", note: "incidents & breaches" },
                { url: "bucky://tube", label: "BuckTube", note: "lore & training reels" }
            ])}
        </div>
    `;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · bucky://wiki`,
        title: "BuckyWiki",
        lead: "The community knowledge base of BuckyNet.",
        bodyHtml: body
    });
}

// ----- Registration ----------------------------------------------------------

/** Register every BuckyWiki page into the given SiteRegistry. */
export function registerWikiSite(registry) {
    registry.register({
        id: "wiki-home",
        url: "bucky://wiki",
        site: SITE,
        title: "BuckyWiki",
        type: "home",
        keywords: ["wiki", "buckywiki", "encyclopedia", "knowledge", "articles", "reference", "bucky"],
        description: "The community knowledge base of BuckyNet — lore, tools, threats, factions and corporations.",
        tags: ["wiki", "site", "reference"],
        render: () => renderHome()
    });

    WIKI_ARTICLES.forEach((article) => {
        registry.register({
            id: `wiki-${article.slug}`,
            url: wikiUrl(article.slug),
            site: SITE,
            title: article.title,
            type: "article",
            keywords: article.keywords,
            description: article.description,
            tags: article.tags,
            render: () => renderArticle(article)
        });
    });
}
