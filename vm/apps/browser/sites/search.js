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
 * future phase — becomes searchable for free. A plain query opens a results
 * page; it never teleports the operator into a site.
 *
 * Phase 3B expansion: highlighted query matches, related searches derived
 * from result metadata, result-type metadata on each card, richer cards and
 * grouping. All query text and result metadata is HTML-escaped before render.
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
    leaks: "Leak Database",
    bucky: "Bucky",
    community: "Bucky Community",
    hidden: "Unindexed"
};

/** Human label per result type. */
const TYPE_LABEL = {
    home: "Site", article: "Article", video: "Video", post: "Update",
    incident: "Incident report", profile: "Account", index: "Index",
    landing: "Official site", community: "Community"
};

/** Quick-access destinations shown on the PulseSearch homepage. */
const SHORTCUTS = [
    { url: "bucky://bucky", label: "Bucky", note: "Official platform" },
    { url: "bucky://wiki", label: "BuckyWiki", note: "Encyclopedia" },
    { url: "bucky://tube", label: "BuckTube", note: "Video platform" },
    { url: "bucky://dev", label: "Bucky Dev", note: "Patch notes" },
    { url: "bucky://leaks", label: "Leak Database", note: "Breach archive" },
    { url: "bucky://community", label: "Community", note: "Discord hub" }
];

function siteLabel(siteId) {
    return SITE_LABEL[siteId] || "BuckyNet";
}
function typeLabel(type) {
    return TYPE_LABEL[type] || "Page";
}

/** Split a query into lower-case tokens. */
function tokenize(query) {
    return String(query || "").toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
}

/** Escape a string for safe use inside a RegExp. */
function regexEscape(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Highlight query tokens within raw text. Matching is done on the RAW text;
 * every segment (matched and unmatched) is HTML-escaped individually, so the
 * output is always safe and entities are never split.
 */
function highlight(raw, tokens) {
    const text = String(raw || "");
    const usable = tokens.filter(Boolean);
    if (!usable.length) return escapeHtml(text);

    const pattern = usable.map(regexEscape).sort((a, b) => b.length - a.length).join("|");
    const re = new RegExp(`(${pattern})`, "gi");
    let out = "";
    let last = 0;
    text.replace(re, (match, _group, offset) => {
        out += escapeHtml(text.slice(last, offset));
        out += `<mark class="vm-pulse-hl">${escapeHtml(match)}</mark>`;
        last = offset + match.length;
        return match;
    });
    out += escapeHtml(text.slice(last));
    return out;
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

/** A PulseSearch input form. The browser's delegated submit handler reads any form. */
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

/** A row of query chips (recent searches, related searches). */
function queryChips(terms) {
    return terms.filter(Boolean).map((term) =>
        `<a class="vm-pulse-recent-chip" data-bucky-link="${escapeHtml(buildSearchUrl(term))}">${escapeHtml(term)}</a>`
    ).join("");
}

// ----- Homepage --------------------------------------------------------------

function renderRecent(recent) {
    const terms = (recent || []).filter(Boolean).slice(0, 6);
    if (!terms.length) return "";
    return `
        <div class="vm-pulse-recent">
            <span class="vm-pulse-recent-label">Recent searches</span>
            <div class="vm-pulse-recent-row">${queryChips(terms)}</div>
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

/** Derive related-search terms from the metadata of the ranked results. */
function relatedSearches(ranked, queryTokens) {
    const skip = new Set(queryTokens);
    skip.add("site");
    const counts = new Map();
    ranked.slice(0, 10).forEach((result) => {
        (result.entry.tags || []).forEach((tag) => {
            const term = String(tag).toLowerCase();
            if (term.length < 3 || skip.has(term)) return;
            counts.set(term, (counts.get(term) || 0) + 1);
        });
    });
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([term]) => term);
}

function resultCard(result, tokens) {
    const { entry, snippet } = result;
    const desc = snippet || entry.description || "";
    const tags = (entry.tags || []).filter((t) => t !== "site").slice(0, 3);
    return `
        <article class="vm-pulse-result">
            <div class="vm-pulse-result-domain">
                <span class="vm-pulse-result-site">${escapeHtml(siteLabel(entry.site))}</span>
                <span class="vm-pulse-result-url">${escapeHtml(entry.url)}</span>
                <span class="vm-pulse-result-type">${escapeHtml(typeLabel(entry.type))}</span>
            </div>
            <a class="vm-site-link vm-pulse-result-title" data-bucky-link="${escapeHtml(entry.url)}">${highlight(entry.title, tokens)}</a>
            <p class="vm-pulse-result-snippet">${highlight(desc, tokens)}</p>
            ${tags.length ? `<div class="vm-pulse-result-tags">${tags.map((t) =>
                `<span class="vm-pulse-result-tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        </article>
    `;
}

function renderRelated(ranked, tokens) {
    const related = relatedSearches(ranked, tokens);
    if (!related.length) return "";
    return `
        <div class="vm-pulse-related">
            <span class="vm-pulse-recent-label">Related searches</span>
            <div class="vm-pulse-recent-row">${queryChips(related)}</div>
        </div>
    `;
}

function renderEmpty(query) {
    return `
        <div class="vm-pulse-empty">
            <strong>No BuckyNet results for "${escapeHtml(query)}"</strong>
            <p>
                PulseSearch only indexes the Grid, and some pages are unindexed by design. Try a
                broader word — for example
                ${queryChips(["wiki", "virus", "developer logs", "bucky leaks"])}
            </p>
        </div>
    `;
}

function renderResults(ctx, query) {
    const tokens = tokenize(query);
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
                ${group.results.map((result) => resultCard(result, tokens)).join("")}
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
            ${ranked.length ? renderRelated(ranked, tokens) : ""}
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
