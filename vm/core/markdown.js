/**
 * Markdown — a lightweight, dependency-free markdown renderer for the Bucky VM.
 *
 * Vanilla JavaScript only (project principle); no framework, no virtual DOM.
 * It turns a markdown source string into a safe HTML string for BuckyCode's
 * preview mode and the Files-app preview pane.
 *
 * Safety model: every character of the source is HTML-escaped *before* any
 * markdown transformation runs, so source text can never inject markup. The
 * only HTML that reaches the output is the small, fixed set of tags this
 * module emits. Link targets are scheme-checked — unknown schemes (including
 * `javascript:`) collapse to "#".
 *
 * Supported: # .. ###### headings, **bold** / __bold__, *italic* / _italic_,
 * `inline code`, fenced ``` code blocks, - / * / + and 1. ordered lists,
 * [label](url) links, --- horizontal rules, and paragraphs.
 *
 * Block parsing is line-based and single-pass — O(n) in the source length —
 * so rendering a preview is cheap enough to run on every toggle without any
 * impact on runtime performance.
 */
import { escapeHtml } from "./util.js";

/** Allow only safe link schemes; anything else collapses to a no-op anchor. */
function sanitizeUrl(url) {
    const trimmed = String(url || "").trim();
    if (/^(https?:|bnet:|mailto:|#|\/)/i.test(trimmed)) return trimmed;
    return "#";
}

/** Apply links / bold / italic to one non-code run of ALREADY-ESCAPED text. */
function formatInline(escaped) {
    let out = escaped;

    // Links — [label](url). The url is already escaped; sanitize the scheme.
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, url) =>
        `<a class="vm-md-link" href="${sanitizeUrl(url)}" rel="noopener">${label}</a>`);

    // Bold before italic so ** / __ are consumed first.
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");

    // Italic. Underscore italic only fires at word boundaries so identifiers
    // like snake_case_name are left untouched.
    out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    out = out.replace(/(^|[^A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, "$1<em>$2</em>");

    return out;
}

/**
 * Apply inline formatting to a run of text that is ALREADY HTML-escaped.
 * The text is split on backtick-delimited code spans; only the non-code
 * segments receive link/emphasis formatting, so a code span's contents are
 * never reinterpreted and no fragile placeholder substitution is needed.
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

/**
 * Render a markdown source string to a safe HTML string.
 * @param {string} source
 * @returns {string} HTML
 */
export function renderMarkdown(source) {
    const lines = String(source == null ? "" : source).replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let listType = null; // "ul" | "ol" | null
    let index = 0;

    const closeList = () => {
        if (listType) {
            html.push(`</${listType}>`);
            listType = null;
        }
    };

    const isBlockStart = (line) =>
        /^\s*$/.test(line)
        || /^(#{1,6})\s+/.test(line)
        || /^\s*```/.test(line)
        || /^\s*[-*+]\s+/.test(line)
        || /^\s*\d+[.)]\s+/.test(line)
        || /^\s*([-*_])\1\1+\s*$/.test(line);

    while (index < lines.length) {
        const raw = lines[index];

        // Fenced code block.
        if (/^\s*```/.test(raw)) {
            closeList();
            const body = [];
            index++;
            while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
                body.push(escapeHtml(lines[index]));
                index++;
            }
            index++; // consume the closing fence (if present)
            html.push(`<pre class="vm-md-pre"><code>${body.join("\n")}</code></pre>`);
            continue;
        }

        // Heading.
        const heading = raw.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            closeList();
            const level = heading[1].length;
            html.push(`<h${level} class="vm-md-h vm-md-h${level}">${renderInline(escapeHtml(heading[2]))}</h${level}>`);
            index++;
            continue;
        }

        // Horizontal rule.
        if (/^\s*([-*_])\1\1+\s*$/.test(raw)) {
            closeList();
            html.push(`<hr class="vm-md-hr">`);
            index++;
            continue;
        }

        // Unordered list item.
        const unordered = raw.match(/^\s*[-*+]\s+(.*)$/);
        if (unordered) {
            if (listType !== "ul") {
                closeList();
                html.push(`<ul class="vm-md-list">`);
                listType = "ul";
            }
            html.push(`<li>${renderInline(escapeHtml(unordered[1]))}</li>`);
            index++;
            continue;
        }

        // Ordered list item.
        const ordered = raw.match(/^\s*\d+[.)]\s+(.*)$/);
        if (ordered) {
            if (listType !== "ol") {
                closeList();
                html.push(`<ol class="vm-md-list">`);
                listType = "ol";
            }
            html.push(`<li>${renderInline(escapeHtml(ordered[1]))}</li>`);
            index++;
            continue;
        }

        // Blank line.
        if (/^\s*$/.test(raw)) {
            closeList();
            index++;
            continue;
        }

        // Paragraph — gather consecutive plain lines.
        closeList();
        const paragraph = [escapeHtml(raw)];
        index++;
        while (index < lines.length && !isBlockStart(lines[index])) {
            paragraph.push(escapeHtml(lines[index]));
            index++;
        }
        html.push(`<p class="vm-md-p">${renderInline(paragraph.join("<br>"))}</p>`);
    }

    closeList();
    return html.join("\n") || `<p class="vm-md-empty">This document is empty.</p>`;
}

/** True when a filename should be treated as markdown. */
export function isMarkdownName(name) {
    return /\.(md|markdown)$/i.test(String(name || ""));
}
