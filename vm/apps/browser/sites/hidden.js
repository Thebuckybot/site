/**
 * Hidden pages — unindexed BuckyNet routes.
 *
 * Hidden pages are ordinary SiteRegistry entries with `searchable: false`:
 * they resolve by direct URL but never appear in PulseSearch. This is the
 * existing registry mechanism (PulseSearch itself is searchable:false) — no
 * core change is needed for the hidden-page system.
 *
 * `type` records the page's posture — "hidden", "private" or "archived" — a
 * label future mission/OSINT systems can read. Hidden pages are discovered by
 * reading: a leak record, a video comment or another hidden page points the
 * way. They are deliberate ARG surface and the seam for mission-gated content.
 *
 * Adding a hidden page is a pure data edit to HIDDEN_PAGES.
 */
import { escapeHtml, link, chip, sitePage, crossRefs } from "./kit.js";

/**
 * Authored hidden pages.
 *   slug      path after bucky://hidden/  (or a full custom url via `url`)
 *   type      "hidden" | "private" | "archived"
 *   posture   the label shown on the page
 *   sections  [heading, [paragraph,...]] blocks
 *   refs      cross-links surfaced at the foot of the page
 */
const HIDDEN_PAGES = [
    {
        slug: "sector-9",
        title: "Sector 9",
        type: "hidden",
        posture: "Unindexed sector",
        lead: "A region of the Grid PulseSearch will not return.",
        sections: [
            ["Status", [
                "Sector 9 is not on any BuckyNet index. You reached it because someone gave you the " +
                "address — a leak record, a comment, a serial fragment on a banknote.",
                "The sector is quiet. Nine nodes, eight of them dark. The ninth is still logging."
            ]],
            ["Notice", [
                "This page is preserved as found. Do not assume it is abandoned. The Virus prefers " +
                "sectors no one searches for, and Sector 9 has not been searched in a long time.",
                "If you are mapping hidden routes for the community hunt, the cold room is one node deeper."
            ]]
        ],
        refs: [
            { url: "bucky://hidden/cold-room", label: "The Cold Room", note: "one node deeper" },
            { url: "bucky://leaks", label: "Leak Database", note: "where the address surfaced" }
        ]
    },
    {
        slug: "cold-room",
        title: "The Cold Room",
        type: "private",
        posture: "Private node",
        lead: "A private node inside Sector 9. Access was never meant to be public.",
        sections: [
            ["Private", [
                "The cold room is a private node. There is no login here yet — the gate is simulated " +
                "and the door is, for now, simply unlocked.",
                "Whoever kept this node kept it cold on purpose: no index, no links in, no traffic. A " +
                "place to leave something and be sure no search would ever surface it."
            ]],
            ["What is here", [
                "An archived transmission and a single line repeated across every log file: " +
                "look where the search results stop.",
                "That line also appears under a BuckTube video. The two are the same recording."
            ]]
        ],
        refs: [
            { url: "bucky://archive/transmission-0", label: "Archived: Transmission 0", note: "the recording" },
            { url: "bucky://tube/unknown-transmission", label: "BuckTube: Unknown Transmission", note: "the same signal" }
        ]
    },
    {
        slug: "transmission-0",
        url: "bucky://archive/transmission-0",
        title: "Archived — Transmission 0",
        type: "archived",
        posture: "Archived record",
        lead: "An archived transmission. The archive keeps it; the index forgot it.",
        sections: [
            ["Archived record", [
                "This page is archived: kept for reference, removed from search. Archived pages are " +
                "how BuckyNet remembers things it no longer advertises.",
                "Transmission 0 predates the public Grid. Sixty-seven seconds of static and one " +
                "repeated string. No verified uploader."
            ]],
            ["Transcript fragment", [
                "// signal start //  the grid was smaller then  //  nine sectors, one of them mine  //  " +
                "if you are reading the archive you already know how to read the comments  //  signal end //"
            ]]
        ],
        refs: [
            { url: "bucky://hidden/sector-9", label: "Sector 9", note: "the sector it names" },
            { url: "bucky://wiki/virus", label: "BuckyWiki: The Virus", note: "context" }
        ]
    }
];

function hiddenUrl(page) {
    return page.url || `bucky://hidden/${page.slug}`;
}

function renderHidden(page) {
    const sections = page.sections.map(([heading, paragraphs]) => `
        <section class="vm-wiki-section">
            <h2>${escapeHtml(heading)}</h2>
            ${paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}
        </section>
    `).join("");

    const body = `
        <div class="vm-hidden-body">
            <div class="vm-hidden-banner">
                ${chip(page.posture, "vm-hidden-chip")}
                <span>This page is not indexed by PulseSearch — it is reachable only by direct address.</span>
            </div>
            <div class="vm-wiki-body">
                ${sections}
            </div>
            ${crossRefs("Follow the thread", page.refs)}
        </div>
    `;
    return sitePage({
        site: "hidden",
        domain: `HIDDEN · ${hiddenUrl(page)}`,
        title: page.title,
        lead: page.lead,
        bodyHtml: body
    });
}

// ----- Registration ----------------------------------------------------------

/** Register every hidden page. All are searchable:false — direct URL only. */
export function registerHiddenSites(registry) {
    HIDDEN_PAGES.forEach((page) => {
        registry.register({
            id: `hidden-${page.slug}`,
            url: hiddenUrl(page),
            site: "hidden",
            title: page.title,
            type: page.type,
            // The hidden-page mechanism: present in the registry, absent from search.
            searchable: false,
            keywords: [],
            description: page.lead,
            tags: ["hidden", page.type],
            render: () => renderHidden(page)
        });
    });
}
