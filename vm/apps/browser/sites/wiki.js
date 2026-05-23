/**
 * BuckyWiki — bucky://wiki
 *
 * The in-universe encyclopedia of the Bucky VM. Articles are authored as
 * DATA (the WIKI_ARTICLES array) and registered into the SiteRegistry one
 * page per entry. Adding an article is a pure data edit — no browser, router
 * or registry code changes (project principle: modular and scalable).
 *
 * Every page renders through the shared site kit, so all authored and
 * derived text is HTML-escaped before it reaches the browser viewport.
 *
 * Future systems (backend / Discord / mission-triggered lore) inject extra
 * articles by pushing onto this dataset or calling registry.register()
 * directly — see buckynet.js.
 */
import { escapeHtml, link, chip, sitePage } from "./kit.js";

const SITE = "wiki";
const DOMAIN = "BuckyWiki";

/** bucky:// address for a wiki article slug. */
function wikiUrl(slug) {
    return slug ? `bucky://wiki/${slug}` : "bucky://wiki";
}

/**
 * Authored wiki content. Each record is one encyclopedia page.
 *   slug        url segment (bucky://wiki/<slug>)
 *   title       page + search-result heading
 *   category    grouping on the wiki index
 *   description search snippet
 *   keywords    PulseSearch match terms
 *   tags        lore / category labels (also searched)
 *   lead        one-line summary under the title
 *   infobox     [label, value] fact rows
 *   sections    [heading, [paragraph, ...]] blocks
 *   seeAlso     slugs of related articles
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
                "BuckyNet is informally called the Grid — a closed, simulated network with no path to the real internet. Everything reachable from this browser is internal VM content. Sites, accounts, leaks and transmissions are all fictional.",
                "The Grid is deliberately small and knowable. Bucky logs every route an operator takes, which is why the wiki, the leak database and the developer feed all feel like they are watching back."
            ]],
            ["Operators", [
                "An operator is the human session driving the VM. The workstation is issued per session, all storage is temporary, and progress is expected to be carried out of the VM rather than saved inside it."
            ]]
        ],
        seeAlso: ["virus", "commands", "items"]
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
            ["Origin", "Unknown — see Unknown Transmission"],
            ["Behaviour", "Spreads node to node"],
            ["Threat level", "Severe"]
        ],
        sections: [
            ["Overview", [
                "The Virus is a fictional malware family and the central threat of the Bucky universe. It is written into the lore as a self-rewriting program: every time it is studied it has already changed, so no two analyses of the Virus ever fully agree.",
                "Within VM missions the Virus is the reason the workstation exists. Operators are trained against it, not expected to defeat it outright."
            ]],
            ["Behaviour", [
                "The Virus spreads across the Grid one node at a time, preferring nodes with weak or default credentials. It leaves fragments — corrupted files, half-finished transmissions — that operators can recover and study.",
                "It does not act with malice in the story so much as appetite. The Virus consumes attention, storage and trust, and the Grid is its feeding ground."
            ]],
            ["Countermeasures", [
                "Security scripts are the in-universe defence against the Virus. They will not remove it, but they slow it and make its movements visible."
            ]]
        ],
        seeAlso: ["attack-scripts", "security-scripts", "bucky"]
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
                "Collectables are cosmetic items scattered across the Grid in numbered series. They have no combat or economic effect; they are a record of where an operator has been. Future missions will tie collectable sets to BuckyNet locations."
            ]]
        ],
        seeAlso: ["bucky", "commands"]
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
                "cat prints a file to the screen. edit opens a file in BuckyCode, creating it if it does not exist. open routes a file to BuckyCode or a folder to the Files app.",
                "chmod +x marks a file executable so it can be run directly as ./script.py."
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
        seeAlso: ["security-scripts", "virus", "commands"]
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
        seeAlso: ["attack-scripts", "virus", "commands"]
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

function renderSeeAlso(slugs) {
    const items = (slugs || [])
        .map((slug) => BY_SLUG.get(slug))
        .filter(Boolean)
        .map((article) => `<li>${link(wikiUrl(article.slug), article.title)}</li>`)
        .join("");
    if (!items) return "";
    return `
        <section class="vm-wiki-section vm-wiki-seealso">
            <h2>See also</h2>
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
                ${renderSeeAlso(article.seeAlso)}
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
    const categories = [];
    WIKI_ARTICLES.forEach((article) => {
        let group = categories.find((entry) => entry.name === article.category);
        if (!group) {
            group = { name: article.category, articles: [] };
            categories.push(group);
        }
        group.articles.push(article);
    });

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
                BuckyWiki is the community knowledge base of BuckyNet. Every article below is
                internal VM content — lore, tools and threats of the Bucky universe.
            </p>
            <div class="vm-site-chiprow">${chip("Encyclopedia")}${chip("Lore")}${chip("Tools")}${chip("Threats")}</div>
            ${groupsHtml}
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
        description: "The community knowledge base of BuckyNet — lore, tools and threats of the Bucky universe.",
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
