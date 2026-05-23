/**
 * Markdown - a lightweight, dependency-free markdown renderer for the Bucky VM.
 *
 * Vanilla JavaScript only (project principle); no framework, no virtual DOM.
 * It turns a markdown source string into a safe HTML string for BuckyCode's
 * preview mode and the Files-app preview pane.
 *
 * Safety: every character of the source is HTML-escaped before any markdown
 * transformation runs, so source text can never inject markup. The only HTML
 * that reaches the output is the small fixed set of tags this module emits.
 * A short allow-list of inert tags - br, details, summary - may be authored
 * in source; they are matched only in their bare form (no attributes), so a
 * tag carrying an attribute or handler stays escaped and harmless. Link
 * targets are scheme-checked; unknown schemes (including javascript) become #.
 *
 * Supported features: headings, bold, italic, inline code, fenced code
 * blocks (with an optional language label), ordered and unordered lists
 * with nesting by indentation, blockquotes, links, horizontal rules, line
 * breaks, collapsible details and summary blocks, and paragraphs.
 *
 * Parsing is line-based and single-pass - O(n) over the source.
 */
import { escapeHtml } from "./util.js";

/** Allow only safe link schemes; anything else collapses to a no-op anchor. */
function sanitizeUrl(url) {
    const trimmed = String(url || "").trim();
    if (/^(https?:|bnet:|mailto:|#|\/)/i.test(trimmed)) return trimmed;
    return "#";
}

/** Apply links / bold / italic / line-breaks to one non-code run of ESCAPED text. */
function formatInline(escaped) {
    let out = escaped;

    // Allow-listed inline HTML: <br> only (bare form). Because renderInline
    // splits code spans out first, this never touches text inside code spans.
    out = out.replace(/&lt;br\s*\/?&gt;/gi, "<br>");

    // Links - [label](url). The url is already escaped; sanitize the scheme.
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, url) =>
        `<a class="vm-md-link" href="${sanitizeUrl(url)}" rel="noopener">${label}</a>`);

    // Bold before italic so the double markers are consumed first.
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");

    // Italic. Underscore italic only fires at word boundaries so identifiers
    // like snake_case_name are left untouched.
    out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    out = out.replace(/(^|[^A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, "$1<em>$2</em>");

    return out;
}

/**
 * Inline formatting for a run of ALREADY-ESCAPED text. The text is split on
 * backtick code spans; only the non-code segments are formatted, so a code
 * span's contents are never reinterpreted.
 */
function renderInline(escaped) {
    return String(escaped)
        .split(/(`[^`]+`)/)
        .map((part) => {
            if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
                return `<code class="vm-md-code">${part.slice(1, -1)}</code>`;
            }
            return formatInline(part);
        })
        .join("");
}

/** Build a (possibly nested) list from gathered items keyed by indentation. */
function buildList(items) {
    let i = 0;
    function build() {
        const level = items[i].indent;
        const ordered = items[i].ordered;
        const tag = ordered ? "ol" : "ul";
        let out = `<${tag} class="vm-md-list">`;
        while (i < items.length && items[i].indent >= level) {
            if (items[i].indent > level) break; // jagged indent - stop safely
            let li = `<li>${renderInline(escapeHtml(items[i].text))}`;
            i++;
            if (i < items.length && items[i].indent > level) {
                li += build();
            }
            out += `${li}</li>`;
        }
        return `${out}</${tag}>`;
    }
    return build();
}

/** A line that begins a list item. */
function isListLine(line) {
    return /^(\s*)([-*+]|\d+[.)])\s+/.test(line);
}

/**
 * Render a markdown source string to a safe HTML string.
 * @param {string} source
 * @returns {string} HTML
 */
export function renderMarkdown(source) {
    const lines = String(source == null ? "" : source).replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let index = 0;

    const isBlockStart = (line) =>
        /^\s*$/.test(line)
        || /^(#{1,6})\s+/.test(line)
        || /^\s*```/.test(line)
        || /^\s*>/.test(line)
        || isListLine(line)
        || /^\s*([-*_])\1\1+\s*$/.test(line)
        || /^\s*<\/?(details|summary)\b/i.test(line);

    while (index < lines.length) {
        const raw = lines[index];

        // Fenced code block, with an optional language label.
        if (/^\s*```/.test(raw)) {
            const lang = raw.replace(/^\s*```/, "").trim();
            const body = [];
            index++;
            while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
                body.push(escapeHtml(lines[index]));
                index++;
            }
            index++; // consume the closing fence (if present)
            const label = lang
                ? `<span class="vm-md-fence-lang">${escapeHtml(lang)}</span>`
                : "";
            html.push(`<pre class="vm-md-pre">${label}<code>${body.join("\n")}</code></pre>`);
            continue;
        }

        // Allow-listed block HTML: details / summary tags on their own line.
        const blockTag = raw.trim().match(/^<(\/?)(details|summary)>$/i);
        if (blockTag) {
            html.push(`<${blockTag[1]}${blockTag[2].toLowerCase()}>`);
            index++;
            continue;
        }
        const summaryLine = raw.trim().match(/^<summary>([\s\S]*)<\/summary>$/i);
        if (summaryLine) {
            html.push(`<summary>${renderInline(escapeHtml(summaryLine[1]))}</summary>`);
            index++;
            continue;
        }

        // Heading.
        const heading = raw.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            const level = heading[1].length;
            html.push(`<h${level} class="vm-md-h vm-md-h${level}">${renderInline(escapeHtml(heading[2]))}</h${level}>`);
            index++;
            continue;
        }

        // Horizontal rule.
        if (/^\s*([-*_])\1\1+\s*$/.test(raw)) {
            html.push(`<hr class="vm-md-hr">`);
            index++;
            continue;
        }

        // Blockquote - consecutive lines beginning with >.
        if (/^\s*>/.test(raw)) {
            const quote = [];
            while (index < lines.length && /^\s*>/.test(lines[index])) {
                quote.push(escapeHtml(lines[index].replace(/^\s*>\s?/, "")));
                index++;
            }
            html.push(`<blockquote class="vm-md-quote">${renderInline(quote.join("<br>"))}</blockquote>`);
            continue;
        }

        // List - consecutive list lines, nested by indentation.
        if (isListLine(raw)) {
            const items = [];
            while (index < lines.length && isListLine(lines[index])) {
                const match = lines[index].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
                items.push({
                    indent: match[1].replace(/\t/g, "  ").length,
                    ordered: /\d/.test(match[2]),
                    text: match[3]
                });
                index++;
            }
            html.push(buildList(items));
            continue;
        }

        // Blank line.
        if (/^\s*$/.test(raw)) {
            index++;
            continue;
        }

        // Paragraph - gather consecutive plain lines.
        const paragraph = [escapeHtml(raw)];
        index++;
        while (index < lines.length && !isBlockStart(lines[index])) {
            paragraph.push(escapeHtml(lines[index]));
            index++;
        }
        html.push(`<p class="vm-md-p">${renderInline(paragraph.join("<br>"))}</p>`);
    }

    return html.join("\n") || `<p class="vm-md-empty">This document is empty.</p>`;
}

/** True when a filename should be treated as markdown. */
export function isMarkdownName(name) {
    return /\.(md|markdown)$/i.test(String(name || ""));
}
