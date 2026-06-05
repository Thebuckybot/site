/**
 * mailAddress — the Bucky Mail address model (Phase 5.0).
 *
 * Bucky Mail uses DOT-form addresses: `local@host.tld`, e.g.
 *
 *     _.tommy___@bucky.net      (the operator, derived from the Discord name)
 *     security@bucky.net        system / security notices
 *     intel@shadownet.mail      NPC / story senders
 *
 * Every operator automatically receives `<DiscordUsername>@bucky.net` — there
 * is no registration. This module is the single parser/validator/formatter for
 * that form so addressing logic never leaks into the storage layer or the UI.
 *
 * Pure data — DOM-free, network-free, dependency-free.
 *
 * NOTE: an earlier architecture draft (vm/docs/architecture/mail-system.md §2)
 * specified a comma-form (`name@bucky,net`). Phase 5.0 deliberately implements
 * the dot-form shown in the product brief and the concept UI; this module is
 * the authority for the implemented scheme.
 */

export const DEFAULT_HOST = "bucky.net";

// A pragmatic dot-form matcher: a non-empty local part, '@', a host with at
// least one dot and an alphabetic TLD of 2+ chars. Permissive in the local
// part (the operator handle may contain dots/underscores like `_.tommy___`).
const ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

// `Display Name <local@host.tld>` form, used by some seed senders.
const DISPLAY_RE = /^\s*(.*?)\s*<\s*([^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,})\s*>\s*$/;

/**
 * Derive the operator's `<handle>@bucky.net` address from a Discord username.
 * Whitespace is stripped and any stray '@' removed; dots/underscores are kept
 * so `_.tommy___` round-trips to `_.tommy___@bucky.net`.
 */
export function fromUsername(username, host = DEFAULT_HOST) {
    const handle = String(username == null ? "" : username)
        .trim()
        .replace(/\s+/g, "")
        .replace(/@/g, "");
    return `${handle || "operator"}@${host}`;
}

/** True when `address` is a valid dot-form Bucky Mail address. */
export function isValid(address) {
    return typeof address === "string" && ADDRESS_RE.test(address.trim());
}

/**
 * Parse an address (bare or `Name <addr>`) into `{ local, host, display, address }`,
 * or null when it is not a valid dot-form address.
 */
export function parse(input) {
    if (typeof input !== "string") return null;
    const raw = input.trim();
    let display = "";
    let address = raw;

    const dm = raw.match(DISPLAY_RE);
    if (dm) {
        display = dm[1] || "";
        address = dm[2];
    }
    if (!isValid(address)) return null;

    const at = address.lastIndexOf("@");
    const local = address.slice(0, at);
    const host = address.slice(at + 1);
    return { local, host, display, address };
}

/** Format `{ local, host, display }` back to a string (with optional display). */
export function format(parts) {
    if (!parts) return "";
    const address = parts.address || `${parts.local}@${parts.host || DEFAULT_HOST}`;
    return parts.display ? `${parts.display} <${address}>` : address;
}

/** The bare address (strips any display name). Returns "" when invalid. */
export function bare(input) {
    const parsed = parse(input);
    return parsed ? parsed.address : "";
}

/** Case-insensitive comparison of two addresses by their bare form. */
export function equals(a, b) {
    const aa = bare(a).toLowerCase();
    const bb = bare(b).toLowerCase();
    return Boolean(aa) && aa === bb;
}

/** Normalise to a lowercase bare address for use as a match key. */
export function normalize(input) {
    return bare(input).toLowerCase();
}

/**
 * Split a recipient field ("a@bucky.net, b@bucky.net") into an array of bare
 * addresses, dropping blanks and anything that is not a valid dot-form address.
 */
export function splitList(value) {
    if (Array.isArray(value)) {
        return value.map((v) => bare(typeof v === "string" ? v : (v && v.address) || "")).filter(Boolean);
    }
    return String(value == null ? "" : value)
        .split(/[,;]/)
        .map((part) => bare(part))
        .filter(Boolean);
}

/** The local part before '@' ("security" from "security@bucky.net"), or "". */
export function localPart(input) {
    const parsed = parse(input);
    return parsed ? parsed.local : "";
}
