/**
 * Bucky Community — bucky://community
 *
 * The in-universe community hub: the page that promotes the Discord support
 * server. Discord-inspired dark theme with a cyberpunk edge.
 *
 * Authored as DATA (channels / events / feed). The "online" and "members"
 * counters are static authored numbers — a future backend can feed live
 * counts and update-feed posts into these same structures without changing
 * the renderer.
 */
import { escapeHtml, link, extLink, chip, crossRefs } from "./kit.js";

/** The authored Discord community invite. */
const COMMUNITY_INVITE = "https://discord.gg/5sjdzJy9AP";

const COUNTERS = [
    ["3,914", "Members"],
    ["612", "Online now"],
    ["48", "In a mission"],
    ["7", "Live events"]
];

const CHANNELS = [
    { name: "announcements", note: "Patch drops and Grid-wide alerts.", kind: "text" },
    { name: "operator-lounge", note: "General chat for linked operators.", kind: "text" },
    { name: "mission-help", note: "Stuck on an investigation? Ask here.", kind: "text" },
    { name: "leak-board", note: "Community OSINT finds and breach chatter.", kind: "text" },
    { name: "arcade", note: "LuckyChip scores and collectable trades.", kind: "text" },
    { name: "the-grid", name2: "voice", note: "Co-op voice channel for night runs.", kind: "voice" }
];

const EVENTS = [
    {
        tag: "Giveaway",
        title: "Collectable Series 3 Drop",
        when: "This cycle",
        body: "Five Series 3 collectables up for grabs. Earn entries by completing any mission " +
            "and posting your node ID in #arcade."
    },
    {
        tag: "Event",
        title: "Grid Night — Co-op OSINT Run",
        when: "Weekend",
        body: "Squad up in #the-grid and work a shared investigation. Credits doubled for the " +
            "duration of the event."
    },
    {
        tag: "Contest",
        title: "Hidden Page Hunt",
        when: "Ongoing",
        body: "BuckyNet has unindexed pages. First operator to map a new hidden route and report " +
            "it in #leak-board takes the prize pool."
    }
];

const FEED = [
    { who: "Bucky Dev", when: "Cycle 312", text: "Browser tabs and bookmarks are live. Patch notes on the dev site." },
    { who: "Community Team", when: "Cycle 311", text: "Welcome to the 3,900+ operators who linked this cycle. Grid Night returns this weekend." },
    { who: "Bucky", when: "Cycle 309", text: "A new transmission surfaced on BuckTube. I did not upload it." }
];

function renderHeader() {
    return `
        <header class="vm-comm-hero">
            <div class="vm-comm-hero-glow" aria-hidden="true"></div>
            <span class="vm-comm-kicker">COMMUNITY HUB</span>
            <h1 class="vm-comm-wordmark">Bucky Community</h1>
            <p class="vm-comm-tagline">
                The support server for the Grid — operators, mission help, events, giveaways and
                the people who keep BuckyNet alive.
            </p>
            <div class="vm-comm-cta">
                ${extLink(COMMUNITY_INVITE, "Join the Community", "vm-comm-btn vm-comm-btn-primary")}
                ${link("bucky://bucky", "Back to Bucky", "vm-comm-btn vm-comm-btn-ghost")}
            </div>
            <div class="vm-comm-counters">
                ${COUNTERS.map(([value, label]) => `
                    <div class="vm-comm-counter">
                        <strong>${escapeHtml(value)}</strong>
                        <span>${escapeHtml(label)}</span>
                    </div>
                `).join("")}
            </div>
        </header>
    `;
}

function renderChannels() {
    return `
        <section class="vm-comm-section">
            <h2 class="vm-comm-h2">Inside the server</h2>
            <div class="vm-comm-channels">
                ${CHANNELS.map((channel) => `
                    <div class="vm-comm-channel vm-comm-channel-${escapeHtml(channel.kind)}">
                        <span class="vm-comm-channel-glyph" aria-hidden="true">${channel.kind === "voice" ? "&#128266;" : "#"}</span>
                        <div class="vm-comm-channel-body">
                            <strong>${escapeHtml(channel.kind === "voice" ? (channel.name2 || channel.name) : channel.name)}</strong>
                            <span>${escapeHtml(channel.note)}</span>
                        </div>
                    </div>
                `).join("")}
            </div>
        </section>
    `;
}

function renderEvents() {
    return `
        <section class="vm-comm-section">
            <h2 class="vm-comm-h2">Events & giveaways</h2>
            <div class="vm-comm-events">
                ${EVENTS.map((event) => `
                    <article class="vm-comm-event">
                        <div class="vm-comm-event-head">
                            ${chip(event.tag)}
                            <span class="vm-comm-event-when">${escapeHtml(event.when)}</span>
                        </div>
                        <h3>${escapeHtml(event.title)}</h3>
                        <p>${escapeHtml(event.body)}</p>
                    </article>
                `).join("")}
            </div>
        </section>
    `;
}

function renderFeed() {
    return `
        <section class="vm-comm-section">
            <h2 class="vm-comm-h2">Community feed</h2>
            <ul class="vm-comm-feed">
                ${FEED.map((post) => `
                    <li class="vm-comm-feed-item">
                        <div class="vm-comm-feed-head">
                            <strong>${escapeHtml(post.who)}</strong>
                            <span>${escapeHtml(post.when)}</span>
                        </div>
                        <p>${escapeHtml(post.text)}</p>
                    </li>
                `).join("")}
            </ul>
        </section>
    `;
}

function renderJoin() {
    return `
        <section class="vm-comm-join">
            <h2 class="vm-comm-h2">Join the Community</h2>
            <p>
                Link up with other operators, get mission help, catch events and giveaways, and be
                first to hear when the Grid changes. The server is the social entrypoint to Bucky.
            </p>
            ${extLink(COMMUNITY_INVITE, "Open the Discord invite", "vm-comm-btn vm-comm-btn-primary vm-comm-btn-lg")}
            <p class="vm-comm-join-fine">discord.gg/5sjdzJy9AP · a fictional in-universe community.</p>
        </section>
    `;
}

function renderCommunityHome() {
    const body = `
        <div class="vm-comm-site">
            ${renderHeader()}
            ${renderChannels()}
            ${renderEvents()}
            ${renderFeed()}
            ${renderJoin()}
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://bucky", label: "Bucky", note: "the official platform" },
                { url: "bucky://dev", label: "Bucky Dev", note: "patch notes" },
                { url: "bucky://leaks", label: "Leak Database", note: "community OSINT finds" }
            ])}
        </div>
    `;
    return { title: "Bucky Community", html: body };
}

// ----- Registration ----------------------------------------------------------

/** Register the Bucky Community site into the given SiteRegistry. */
export function registerCommunitySite(registry) {
    registry.register({
        id: "community-home",
        url: "bucky://community",
        site: "community",
        title: "Bucky Community",
        type: "community",
        keywords: ["community", "discord", "server", "support", "events", "giveaway", "join", "social"],
        description: "The Bucky community hub — Discord support server, events, giveaways and updates.",
        tags: ["community", "discord", "social"],
        render: () => renderCommunityHome()
    });
}
