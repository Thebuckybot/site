/**
 * MailEncryption — the Bucky Mail data-protection seam (Phase 5.0).
 *
 * The mail store NEVER keeps bodies or attachment payloads as plaintext: every
 * payload is COMPRESSED then ENCRYPTED on write, and DECRYPTED then
 * DECOMPRESSED on read. This module owns the encryption half.
 *
 * Implementation: a keyed stream cipher — a deterministic per-message
 * keystream (seeded from the configured key + a random per-payload nonce)
 * XOR'd over the (already-compressed) UTF-16 units. Synchronous,
 * dependency-free, browser + Node.
 *
 * HONEST SCOPE NOTE. This is the CLIENT seam. A purely client-side app served
 * from GitHub Pages cannot hold a real secret, so client encryption is
 * obfuscation-at-rest for the in-memory session store — it mirrors the
 * platform's encrypt/decrypt contract so nothing downstream sees plaintext, and
 * it is the swap point for the REAL encryption, which lives on the backend
 * (services/mail_crypto.py: AES-256-GCM, or an HMAC-keystream fallback). When
 * the VM flips from the in-memory store to the backend gateway, this module is
 * replaced by a call that lets the server hold the key — no other mail code
 * changes.
 */

// A non-secret default key. The seam exists so a backend-held key can replace
// it; on the client it only obfuscates the session's in-memory store.
const DEFAULT_KEY = "bucky-mail-client-seam-v1";
let _key = DEFAULT_KEY;

/** Override the client key (e.g. a per-session value). */
export function setKey(key) {
    _key = String(key || DEFAULT_KEY);
}

/** 53-bit string hash (cyrb53) — used only to seed the keystream PRNG. */
function hashSeed(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)) >>> 0;
}

/** mulberry32 PRNG — fast, deterministic, good enough for a keystream. */
function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0);
    };
}

/** A random nonce string (uses crypto when available, else Math.random). */
function makeNonce() {
    try {
        const g = (typeof globalThis !== "undefined") ? globalThis : {};
        if (g.crypto && g.crypto.getRandomValues) {
            const a = new Uint32Array(2);
            g.crypto.getRandomValues(a);
            return a[0].toString(36) + a[1].toString(36);
        }
    } catch (_e) { /* fall through */ }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Encrypt a string. Returns { algo:"xor1", data:string, nonce:string }.
 * `data` holds the XOR'd UTF-16 units; it is opaque ciphertext.
 */
export function encrypt(text) {
    const input = text == null ? "" : String(text);
    const nonce = makeNonce();
    const rand = mulberry32(hashSeed(_key + "|" + nonce));
    let data = "";
    for (let i = 0; i < input.length; i++) {
        const ks = rand() & 0xFFFF;
        data += String.fromCharCode((input.charCodeAt(i) ^ ks) & 0xFFFF);
    }
    return { algo: "xor1", data, nonce };
}

/** Decrypt a value produced by `encrypt()` back to its original string. */
export function decrypt(sealed) {
    if (!sealed || sealed.data == null) return "";
    const data = String(sealed.data);
    const nonce = sealed.nonce || "";
    const rand = mulberry32(hashSeed(_key + "|" + nonce));
    let out = "";
    for (let i = 0; i < data.length; i++) {
        const ks = rand() & 0xFFFF;
        out += String.fromCharCode((data.charCodeAt(i) ^ ks) & 0xFFFF);
    }
    return out;
}
