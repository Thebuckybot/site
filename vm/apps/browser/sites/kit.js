/**
 * Site kit — shared rendering helpers for BuckyNet site modules.
 *
 * Keeps site content modules free of duplicated markup/escaping logic
 * (project principle: no duplicate utility logic). Every site renderer
 * returns a safe HTML string built through these helpers; all caller-facing
 * text is HTML-escaped, so authored or dynamic content can never inject
 * markup into the browser viewport.
 *
 * Phase 3B adds external-link, media-placeholder and cross-reference helpers
 * for the expanded, interconnected ecosystem.
 */
import { escapeHtml } from "../../../core/util.js";

export { escapeHtml };

/** An internal BuckyNet hyperlink — the browser turns data-bucky-link clicks into navigations. */
export function link(url, label, extraClass = "") {
    const cls = extraClass ? ` ${extraClass}` : "";
    return `<a class="vm-site-link${cls}" data-bucky-link="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

/**
 * An EXTERNAL hyperlink — opens in the operator's real browser. Used only for
 * the authored Discord invite URLs. It carries no data-bucky-link, so the VM
 * browser ignores it and the anchor's native target="_blank" handles it.
 * `noopener noreferrer` is mandatory for any new-tab external link.
 */
export function extLink(url, label, extraClass = "") {
    const cls = extraClass ? ` ${extraClass}` : "";
    return `<a class="vm-site-extlink${cls}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

/** A small category / domain chip. */
export function chip(text, extraClass = "") {
    const cls = extraClass ? ` ${extraClass}` : "";
    return `<span class="vm-site-chip${cls}">${escapeHtml(text)}</span>`;
}

/**
 * A media placeholder frame. BuckyNet never embeds real media — screenshots,
 * video stills and dev attachments are all rendered as themed placeholders.
 * The shape (label + kind) is what a future media system will populate.
 */
export function mediaBox(label, kind = "image") {
    return `
        <div class="vm-site-media vm-site-media-${escapeHtml(kind)}" role="img" aria-label="${escapeHtml(label)}">
            <span class="vm-site-media-grid" aria-hidden="true"></span>
            <span class="vm-site-media-label">${escapeHtml(label)}</span>
        </div>
    `;
}

/**
 * A cross-reference panel — the "this connects to elsewhere on BuckyNet" box
 * that makes the fake internet feel interlinked.
 * @param {string} heading panel heading (e.g. "Across BuckyNet", "Mentioned on")
 * @param {{url:string,label:string,note?:string}[]} refs internal links
 */
export function crossRefs(heading, refs) {
    const items = (refs || []).filter((ref) => ref && ref.url).map((ref) => `
        <li class="vm-site-xref-item">
            ${link(ref.url, ref.label)}
            ${ref.note ? `<span class="vm-site-xref-note">${escapeHtml(ref.note)}</span>` : ""}
        </li>
    `).join("");
    if (!items) return "";
    return `
        <aside class="vm-site-xref">
            <div class="vm-site-xref-head">${escapeHtml(heading)}</div>
            <ul class="vm-site-xref-list">${items}</ul>
        </aside>
    `;
}

/**
 * Standard site page frame.
 * @param {{site:string, domain:string, title:string, lead?:string, bodyHtml:string}} opts
 *   `bodyHtml` is trusted authored markup assembled via these helpers.
 */
export function sitePage(opts) {
    const lead = opts.lead ? `<p class="vm-site-lead">${escapeHtml(opts.lead)}</p>` : "";
    const domain = opts.domain ? `<span class="vm-site-domain">${escapeHtml(opts.domain)}</span>` : "";
    return `
        <article class="vm-site vm-site-${escapeHtml(opts.site || "page")}">
            <header class="vm-site-head">
                ${domain}
                <h1 class="vm-site-h1">${escapeHtml(opts.title || "")}</h1>
                ${lead}
            </header>
            <div class="vm-site-content">${opts.bodyHtml || ""}</div>
        </article>
    `;
}
