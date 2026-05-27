/**
 * Bucky — bucky://bucky
 *
 * The flagship in-universe landing site: the "official platform" page for
 * Bucky, presented as the main product of the universe. Dramatic red/black
 * theme, distinct from the cyan BuckyNet site chrome.
 *
 * This page is authored as DATA (hero / feature / stat / lore blocks) so it
 * stays easy to extend. It carries the only authored external link in the VM
 * — the Discord bot invite — rendered through kit.extLink (opens in the
 * operator's real browser; the VM browser never fetches it).
 */
import { escapeHtml, link, extLink, chip, mediaBox, crossRefs } from "./kit.js";

/** The authored Discord bot invite. */
const BOT_INVITE =
    "https://discord.com/oauth2/authorize?client_id=907664862493167680&scope=bot+applications.commands&permissions=8";

const FEATURES = [
    {
        tag: "Workstation",
        title: "The Bucky VM",
        body: "A simulated cybersecurity workstation — terminal, filesystem, editor and browser. " +
            "Every operator gets a clean session and a node to keep warm."
    },
    {
        tag: "Network",
        title: "BuckyNet",
        body: "A closed, in-universe internet. A search engine, a wiki, a video platform, a leak " +
            "database — all fictional, all interconnected, all hiding something."
    },
    {
        tag: "Gameplay",
        title: "Missions & OSINT",
        body: "Investigations built from real cybersecurity ideas. Follow a handle, read a leaked " +
            "record, trace a transmission across the Grid."
    },
    {
        tag: "Economy",
        title: "Credits & LuckyChip",
        body: "Earn Bucky Credits from missions and spend them on tools and collectables. The " +
            "arcade economy runs on LuckyChip tokens."
    },
    {
        tag: "Tooling",
        title: "Terminal & Installable Tools",
        body: "A believable command line with installable tools and scripts — progression you " +
            "carry from one mission to the next."
    },
    {
        tag: "Live",
        title: "Discord-Linked Progression",
        body: "Bucky lives in your Discord server. Missions, the economy and global events sync " +
            "to the community — the VM is never played alone."
    }
];

const STATS = [
    ["48,210", "Operators linked"],
    ["1,337", "Missions run"],
    ["96", "Grid nodes online"],
    ["24/7", "BuckyNet uptime"]
];

const LORE = [
    "Bucky is the intelligence that runs the Grid — calm, dry, and always logging.",
    "The Virus is out there, rewriting itself between every scan. Operators do not defeat it. They learn to see it.",
    "Every page on BuckyNet is watching back. The good operators read the comments."
];

function renderHero() {
    return `
        <header class="vm-bucky-hero">
            <div class="vm-bucky-hero-glow" aria-hidden="true"></div>
            <span class="vm-bucky-kicker">OFFICIAL PLATFORM</span>
            <h1 class="vm-bucky-wordmark">BUCKY</h1>
            <p class="vm-bucky-tagline">
                The cybersecurity ARG that lives inside your Discord server — a simulated
                workstation, a fake internet, and a Virus that never stops moving.
            </p>
            <div class="vm-bucky-cta">
                ${extLink(BOT_INVITE, "Add Bucky to Discord", "vm-bucky-btn vm-bucky-btn-primary")}
                ${link("bucky://search", "Explore BuckyNet", "vm-bucky-btn vm-bucky-btn-ghost")}
            </div>
            <div class="vm-bucky-hero-meta">
                ${chip("Discord bot")}${chip("Virtual machine")}${chip("OSINT missions")}${chip("In-universe")}
            </div>
        </header>
    `;
}

function renderStats() {
    return `
        <section class="vm-bucky-stats">
            ${STATS.map(([value, label]) => `
                <div class="vm-bucky-stat">
                    <strong>${escapeHtml(value)}</strong>
                    <span>${escapeHtml(label)}</span>
                </div>
            `).join("")}
        </section>
    `;
}

function renderFeatures() {
    return `
        <section class="vm-bucky-section">
            <h2 class="vm-bucky-h2">What Bucky is</h2>
            <div class="vm-bucky-features">
                ${FEATURES.map((feature) => `
                    <article class="vm-bucky-feature">
                        <span class="vm-bucky-feature-tag">${escapeHtml(feature.tag)}</span>
                        <h3>${escapeHtml(feature.title)}</h3>
                        <p>${escapeHtml(feature.body)}</p>
                    </article>
                `).join("")}
            </div>
        </section>
    `;
}

function renderShowcase() {
    return `
        <section class="vm-bucky-section">
            <h2 class="vm-bucky-h2">Inside the VM</h2>
            <div class="vm-bucky-shots">
                ${mediaBox("Bucky VM — desktop & terminal", "shot")}
                ${mediaBox("BuckyNet browser — PulseSearch", "shot")}
                ${mediaBox("Leak Database — OSINT investigation", "shot")}
            </div>
        </section>
    `;
}

function renderLore() {
    return `
        <section class="vm-bucky-section vm-bucky-lore">
            <h2 class="vm-bucky-h2">The world</h2>
            ${LORE.map((line) => `<p class="vm-bucky-lore-line">${escapeHtml(line)}</p>`).join("")}
            <p class="vm-bucky-lore-foot">
                Read the full story on ${link("bucky://wiki", "BuckyWiki")} — start with
                ${link("bucky://wiki/bucky", "Bucky")} and ${link("bucky://wiki/virus", "The Virus")}.
            </p>
        </section>
    `;
}

function renderConnect() {
    return `
        <section class="vm-bucky-connect">
            <div class="vm-bucky-connect-glow" aria-hidden="true"></div>
            <h2 class="vm-bucky-h2">Connect to Discord</h2>
            <p>
                Bucky runs as a Discord bot. Add it to your server to link operators, sync the
                economy, and unlock mission progression. The VM is the workstation — Discord is
                the world around it.
            </p>
            <div class="vm-bucky-cta">
                ${extLink(BOT_INVITE, "Add Bucky to your server", "vm-bucky-btn vm-bucky-btn-primary")}
                ${link("bucky://community", "Visit the community", "vm-bucky-btn vm-bucky-btn-ghost")}
            </div>
            <p class="vm-bucky-connect-fine">
                Requires Manage Server permission. Bucky is a fictional in-universe project.
            </p>
        </section>
    `;
}

function renderBuckyHome() {
    const body = `
        <div class="vm-bucky-site">
            ${renderHero()}
            ${renderStats()}
            ${renderFeatures()}
            ${renderShowcase()}
            ${renderLore()}
            ${renderConnect()}
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://community", label: "Bucky Community", note: "events, giveaways, support" },
                { url: "bucky://dev", label: "Bucky Dev", note: "patch notes & announcements" },
                { url: "bucky://tube/welcome-to-the-grid", label: "Welcome to the Grid", note: "orientation reel" },
                { url: "bucky://wiki/bucky", label: "BuckyWiki: Bucky", note: "the lore entry" },
                // Phase 4.3 — identity-aware pages.
                { url: "bucky://profile", label: "Operator profile", note: "your dashboard" },
                { url: "bucky://organizations", label: "Organisations", note: "the four founders" },
                { url: "bucky://leaderboards", label: "Leaderboards", note: "live rankings" },
                { url: "bucky://pulse", label: "PulseNet", note: "Grid-wide live state" }
            ])}
        </div>
    `;
    return { title: "Bucky — Official Platform", html: body };
}

// ----- Registration ----------------------------------------------------------

/** Register the Bucky landing site into the given SiteRegistry. */
export function registerBuckySite(registry) {
    registry.register({
        id: "bucky-home",
        url: "bucky://bucky",
        site: "bucky",
        title: "Bucky — Official Platform",
        type: "landing",
        keywords: ["bucky", "bot", "discord", "home", "official", "platform", "app", "invite"],
        description: "The official Bucky platform — the cybersecurity ARG that lives in your Discord server.",
        tags: ["bucky", "official", "discord"],
        render: () => renderBuckyHome()
    });
}
