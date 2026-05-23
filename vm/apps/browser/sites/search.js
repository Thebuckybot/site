/**
 * PulseSearch — bucky://search
 *
 * The BuckyNet search engine. PulseSearch is a single SiteRegistry entry with
 * a render that branches on the query string:
 *   - bucky://search            -> the PulseSearch homepage
 *   - bucky://search?q=<terms>  -> a categorised results page
 *
 * Results are NOT a hardcoded list. PulseSearch ranks the live SiteRegistry
 * via `ctx.registry.search()`, so every page any site registers — now or in a
 * future phase — becomes searchable for free. This is the mechanism behind the
 * real-search-engine flow: a plain query opens a results page, it never
 * teleports the operator into a site.
 *
 * All query text and result metadata is HTML-escaped before rendering.
 */
import { escapeHtml, link } from "./kit.js";
import { buildSearchUrl } from "../router.js";

const SITE = "search";

/** Display name per owning-site id (used for result grouping + domain labels). */
const SITE_LABEL = {
    search: "PulseSearch",
    wiki: "BuckyWiki",
    tube: "BuckTube",
    dev: "Bucky Dev",
    leaks: "Leak Database"
};

/** Quick-access destinations shown on the PulseSearch homepage. */
const SHORTCUTS = [
    { url: "bucky://wiki", label: "BuckyWiki", note: "Encyclopedia" },
    { url: "bucky://tube", label: "BuckTube", note: "Video platform" },
    { url: "bucky://dev", label: "Bucky Dev", note: "Patch notes" },
    { url: "bucky://leaks", label: "Leak Database", note: "Breach archive" }
];

function siteLabel(siteId) {
    return SITE_LABEL[siteId] || "BuckyNet";
}

// ----- Shared fragments ------------------------------------------------------

/** The PulseSearch wordmark. `compact` is the small results-page variant. */
function wordmark(compact) {
    return `
        <div class="vm-pulse-mark${compact ? " is-compact" : ""}">
            <span class="vm-pulse-dot"></span>
            <span class="vm-pulse-word">Pulse<strong>Search</strong></span>
        </div>
    `;
}

/**
 * A PulseSearch input form. The browser's delegated submit handler reads any
 * form inside the viewport, so `data-bucky-search` is a hint for styling only.
 */
function searchForm(value, extraClass) {
    return `
        <form class="vm-pulse-form${extraClass ? ` ${extraClass}` : ""}" data-bucky-search>
            <span class="vm-pulse-form-glyph" aria-hidden="true">&#9906;</span>
            <input class="vm-pulse-input" type="text" value="${escapeHtml(value || "")}"
                   placeholder="Search BuckyNet or type a bucky:// address"
                   aria-label="Search BuckyNet" autocomplete="off" spellcheck="false">
            <button class="vm-pulse-submit" type="submit">Search</button>
        </form>
    `;
}

// ----- Homepage --------------------------------------------------------------

function renderRecent(recent) {
    const terms = (recent || []).filter(Boolean).slice(0, 6);
    if (!terms.length) return "";
    const chips = terms.map((term) =>
        `<a class="vm-pulse-recent-chip" data-bucky-link="${escapeHtml(buildSearchUrl(term))}">${escapeHtml(term)}</a>`
    ).join("");
    return `
        <div class="vm-pulse-recent">
            <span class="vm-pulse-recent-label">Recent searches</span>
            <div class="vm-pulse-recent-row">${chips}</div>
        </div>
    `;
}

function renderHome(ctx) {
    const shortcuts = SHORTCUTS.map((item) => `
        <a class="vm-pulse-shortcut" data-bucky-link="${escapeHtml(item.url)}">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.note)}</span>
        </a>
    `).join("");

    return `
        <div class="vm-pulse vm-pulse-home">
            <div class="vm-pulse-hero">
                ${wordmark(false)}
                <p class="vm-pulse-tag">Search the Grid.</p>
                ${searchForm("", "is-hero")}
                ${renderRecent(ctx.recent)}
                <p class="vm-pulse-hint">
                    Type <code>bucky://wiki</code> to go straight to a site, or search a word to see results.
                </p>
            </div>
            <div class="vm-pulse-shortcuts">${shortcuts}</div>
        </div>
    `;
}

// ----- Results ---------------------------------------------------------------

/** Group ranked results by owning site, groups ordered by best score. */
function groupResults(ranked) {
    const groups = [];
    ranked.forEach((result) => {
        const siteId = result.entry.site || "buckynet";
        let group = groups.find((entry) => entry.siteId === siteId);
        if (!group) {
            group = { siteId, results: [], topScore: result.score };
            groups.push(group);
        }
        group.results.push(result);
        group.topScore = Math.max(group.topScore, result.score);
    });
    groups.sort((a, b) => b.topScore - a.topScore);
    return groups;
}

function resultCard(result) {
    const { entry, snippet } = result;
    const desc = snippet || entry.description || "";
    return `
        <article class="vm-pulse-result">
            <div class="vm-pulse-result-domain">
                <span class="vm-pulse-result-site">${escapeHtml(siteLabel(entry.site))}</span>
                <span class="vm-pulse-result-url">${escapeHtml(entry.url)}</span>
            </div>
            ${link(entry.url, entry.title, "vm-pulse-result-title")}
            <p class="vm-pulse-result-snippet">${escapeHtml(desc)}</p>
        </article>
    `;
}

function renderEmpty(query) {
    return `
        <div class="vm-pulse-empty">
            <strong>No BuckyNet results for "${escapeHtml(query)}"</strong>
            <p>
                PulseSearch only indexes the Grid. Try a broader word — for example
                <a class="vm-pulse-recent-chip" data-bucky-link="${escapeHtml(buildSearchUrl("wiki"))}">wiki</a>,
                <a class="vm-pulse-recent-chip" data-bucky-link="${escapeHtml(buildSearchUrl("developer logs"))}">developer logs</a>
                or
                <a class="vm-pulse-recent-chip" data-bucky-link="${escapeHtml(buildSearchUrl("bucky leaks"))}">bucky leaks</a>.
            </p>
        </div>
    `;
}

function renderResults(ctx, query) {
    const ranked = ctx.registry.search(query);
    const summary = ranked.length
        ? `About ${ranked.length} result${ranked.length === 1 ? "" : "s"} on the Grid for "${escapeHtml(query)}"`
        : "";

    let resultsHtml;
    if (!ranked.length) {
        resultsHtml = renderEmpty(query);
    } else {
        resultsHtml = groupResults(ranked).map((group) => `
            <section class="vm-pulse-group">
                <header class="vm-pulse-group-head">
                    <span class="vm-pulse-group-site">${escapeHtml(siteLabel(group.siteId))}</span>
                    <span class="vm-pulse-group-count">${group.results.length} result${group.results.length === 1 ? "" : "s"}</span>
                </header>
                ${group.results.map(resultCard).join("")}
            </section>
        `).join("");
    }

    return `
        <div class="vm-pulse vm-pulse-results">
            <header class="vm-pulse-resultbar">
                ${wordmark(true)}
                ${searchForm(query, "is-bar")}
            </header>
            ${summary ? `<p class="vm-pulse-summary">${summary}</p>` : ""}
            <div class="vm-pulse-resultlist">${resultsHtml}</div>
        </div>
    `;
}

// ----- Registration ----------------------------------------------------------

/**
 * PulseSearch render — branches on the query.
 * @returns {{title:string, html:string}}
 */
function renderSearch(ctx) {
    const query = String((ctx.query && ctx.query.q) || "").trim();
    if (!query) {
        return { title: "PulseSearch", html: renderHome(ctx) };
    }
    return { title: `${query} — PulseSearch`, html: renderResults(ctx, query) };
}

/** Register PulseSearch into the given SiteRegistry. */
export function registerSearchSite(registry) {
    registry.register({
        id: "pulse-search",
        url: "bucky://search",
        site: SITE,
        title: "PulseSearch",
        type: "home",
        // PulseSearch never lists itself in its own results.
        searchable: false,
        keywords: ["search", "pulsesearch", "pulse"],
        description: "The BuckyNet search engine.",
        tags: ["search", "site"],
        render: renderSearch
    });
}
