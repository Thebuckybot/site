/**
 * Shared runtime utilities.
 *
 * Small, dependency-free helpers used across core, components and apps.
 * Keeping them here avoids duplicate utility logic (see project principles).
 */

/** Escape a value for safe insertion into HTML markup. */
export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        // DE APOSTROF HOORT ERBIJ, ook al gebruikt geen enkel attribuut in de VM
        // vandaag enkele quotes. Dat is precies waarom hij er in stond te
        // ontbreken: de functie was correct voor élk bestaand aanroeppunt en
        // fout voor het eerste dat anders geschreven zou worden. Een escaper
        // die van zijn aanroepers afhangt, is geen escaper.
        // `&#39;` en niet `&apos;`: die laatste is XML/HTML5 en wordt door oude
        // HTML-parsers niet herkend. Getalsvorm werkt overal.
        .replace(/'/g, "&#39;");
}

/** Clamp a number between a minimum and maximum. */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/** Build a single DOM element from an HTML string (first element only). */
export function elementFromHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
}

/** Short uppercase glyph for a file, derived from its extension. */
export function fileIcon(name) {
    const extension = String(name).split(".").pop().toUpperCase();
    return extension && extension.length <= 4 ? extension : "TXT";
}
