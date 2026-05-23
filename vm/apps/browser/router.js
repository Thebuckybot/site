/**
 * Browser router — the omnibox brain and the bucky:// address parser.
 *
 * Decides whether a URL-bar submission is a DIRECT URL or a SEARCH QUERY, and
 * parses bucky:// addresses into a routable { base, query }.
 *
 * The rule (matches a real browser omnibox):
 *   - input beginning with "bucky://"  -> direct URL navigation
 *   - anything else                    -> a search query
 *
 * So `bucky://wiki` opens the wiki directly, while a bare `wiki` opens a
 * PulseSearch results page — a search never teleports the user into a site.
 *
 * Pure module — no DOM, no state.
 */

export const SCHEME = "bucky://";

/** True when the text is a direct bucky:// address. */
export function isUrl(text) {
    return String(text || "").trim().toLowerCase().startsWith(SCHEME);
}

/** Lower-case an address and drop any trailing slash (paths authored lower-case). */
export function normalizeAddress(url) {
    let value = String(url || "").trim().toLowerCase();
    if (value.length > SCHEME.length && value.endsWith("/")) {
        value = value.replace(/\/+$/, "");
    }
    return value;
}

/**
 * Classify a URL-bar submission.
 * @returns {{kind:"url", url:string} | {kind:"search", query:string}}
 */
export function parseInput(text) {
    const trimmed = String(text || "").trim();
    if (isUrl(trimmed)) {
        return { kind: "url", url: normalizeAddress(trimmed) };
    }
    return { kind: "search", query: trimmed };
}

/**
 * Split a bucky:// address into its routing base and decoded query map.
 * @returns {{base:string, query:Object<string,string>}}
 */
export function parseUrl(url) {
    const raw = String(url || "").trim();
    const noHash = raw.includes("#") ? raw.slice(0, raw.indexOf("#")) : raw;
    const qCut = noHash.indexOf("?");
    const base = qCut === -1 ? noHash : noHash.slice(0, qCut);
    const query = {};
    if (qCut !== -1) {
        noHash.slice(qCut + 1).split("&").forEach((pair) => {
            if (!pair) return;
            const eq = pair.indexOf("=");
            const key = eq === -1 ? pair : pair.slice(0, eq);
            const value = eq === -1 ? "" : pair.slice(eq + 1);
            try {
                query[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, " "));
            } catch (_) {
                query[key] = value;
            }
        });
    }
    return { base: normalizeAddress(base), query };
}

/** Build the canonical PulseSearch results address for a free-text query. */
export function buildSearchUrl(query) {
    return `${SCHEME}search?q=${encodeURIComponent(String(query || "").trim())}`;
}

/** Path segments after the scheme — e.g. bucky://wiki/bucky -> ["wiki","bucky"]. */
export function pathSegments(url) {
    return parseUrl(url).base.slice(SCHEME.length).split("/").filter(Boolean);
}
