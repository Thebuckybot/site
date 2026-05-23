/**
 * Site kit — shared rendering helpers for BuckyNet site modules.
 *
 * Keeps site content modules free of duplicated markup/escaping logic
 * (project principle: no duplicate utility logic). Every site renderer
 * returns a safe HTML string built through these helpers; all caller-facing
 * text is HTML-escaped, so authored or dynamic content can never inject
 * markup into the browser viewport.
 */
import { escapeHtml } from "../../../core/util.js";

export { escapeHtml };

/** An internal BuckyNet hyperlink — the browser turns data-bucky-link clicks into navigations. */
export function link(url, label, extraClass = "") {
    const cls = extraClass ? ` ${extraClass}` : "";
    return `<a class="vm-site-link${cls}" data-bucky-link="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

/** A small category / domain chip. */
export function chip(text) {
    return `<span class="vm-site-chip">${escapeHtml(text)}</span>`;
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
