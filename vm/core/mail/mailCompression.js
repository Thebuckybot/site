/**
 * MailCompression — the Bucky Mail storage-compression seam (Phase 5.0).
 *
 * Compression and encryption are DISTINCT goals (per the Phase 5.0 brief):
 * compression is for STORAGE EFFICIENCY; encryption is for DATA PROTECTION.
 * The mail store always applies COMPRESS -> ENCRYPT on write and DECRYPT ->
 * DECOMPRESS on read; this module owns the first/last of those.
 *
 * Implementation: a classic byte-oriented LZW over the UTF-8 bytes of the
 * input, so it is lossless for ANY text (accents, emoji, JSON, logs). The
 * dictionary is FROZEN once it fills the 16-bit code space, which keeps every
 * emitted code packable into a single UTF-16 unit and keeps the encoder and
 * decoder trivially in lockstep. It is synchronous, dependency-free, and runs
 * identically in the browser (GitHub Pages) and Node (tests) — no
 * CompressionStream, no WASM, no network.
 *
 * This is the CLIENT seam. The authoritative, production compression is the
 * backend's zlib (services/mail_crypto.py); both honour the same
 * compress→store→decompress contract, so the VM can flip from this in-memory
 * store to the backend without the app or the rest of the mail layer changing.
 */

const MAX_CODE = 0xFFFF; // dictionary freezes here; every code fits one UTF-16 unit
const _encoder = new TextEncoder();
const _decoder = new TextDecoder();

/**
 * Compress a string. Returns:
 *   { algo:"lzw1", data:string, originalSize:number, compressedSize:number }
 * `originalSize` is the UTF-8 byte length; `compressedSize` is the emitted code
 * count (each code is one UTF-16 unit in `data`).
 */
export function compress(text) {
    const bytes = _encoder.encode(text == null ? "" : String(text));
    const originalSize = bytes.length;
    if (originalSize === 0) return { algo: "lzw1", data: "", originalSize: 0, compressedSize: 0 };

    const dict = new Map();   // multi-byte sequence -> code
    let nextCode = 256;       // 0..255 reserved for single literal bytes
    const out = [];
    let w = "";               // current match (string of single-byte chars)

    for (let i = 0; i < bytes.length; i++) {
        const c = String.fromCharCode(bytes[i]);
        const wc = w + c;
        if (w === "" || wc.length === 1 || dict.has(wc)) {
            w = wc; // extend the current match (single bytes are always "known")
        } else {
            out.push(codeOf(w, dict));
            if (nextCode <= MAX_CODE) dict.set(wc, nextCode++); // else: frozen
            w = c;
        }
    }
    if (w !== "") out.push(codeOf(w, dict));

    let data = "";
    for (let i = 0; i < out.length; i++) data += String.fromCharCode(out[i]);
    return { algo: "lzw1", data, originalSize, compressedSize: out.length };
}

/** Code for a match: a literal byte (length 1) or its dictionary code. */
function codeOf(w, dict) {
    return w.length === 1 ? w.charCodeAt(0) : dict.get(w);
}

/** Decompress a value produced by `compress()` (its packed `data` string). */
export function decompress(packed) {
    if (packed == null) return "";
    const data = typeof packed === "string" ? packed : (packed.data || "");
    if (data === "") return "";

    const codes = new Array(data.length);
    for (let i = 0; i < data.length; i++) codes[i] = data.charCodeAt(i);

    const dict = [];          // code -> array of bytes
    let nextCode = 256;
    const bytes = [];
    const seq = (code) => (code < 256 ? [code] : dict[code]);

    let prev = seq(codes[0]);
    if (!prev) return "";     // corrupt input - fail safe to empty
    pushAll(bytes, prev);

    for (let i = 1; i < codes.length; i++) {
        const code = codes[i];
        let entry;
        if (code < 256) entry = [code];
        else if (dict[code]) entry = dict[code];
        else if (code === nextCode) entry = prev.concat(prev[0]); // KwKwK
        else return _decoder.decode(new Uint8Array(bytes)); // unexpected - stop safely
        pushAll(bytes, entry);
        if (nextCode <= MAX_CODE) dict[nextCode++] = prev.concat(entry[0]); // else frozen
        prev = entry;
    }
    return _decoder.decode(new Uint8Array(bytes));
}

function pushAll(target, arr) {
    for (let b = 0; b < arr.length; b++) target.push(arr[b]);
}
