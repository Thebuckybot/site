/**
 * The documentation MODEL — built from the runtime, never written by hand.
 *
 * WHY THIS FILE EXISTS
 * The coding layer has been sitting there unused because nobody could find out
 * what it offers without guessing. The obvious fix is a documentation page. The
 * non-obvious part is where its content comes from, and that decision is the
 * whole design:
 *
 *   NOT from helptext.js. That map is prose somebody typed, and it has already
 *   drifted. Measured on 5 August 2026: `HELP.mail` still says "sending
 *   arrives in Phase 5.2" while mail has been live since 5.0; four modules have
 *   no entry at all; thirteen have members nobody documented; `HELP.notify`
 *   documents a member called `notify` that does not exist (it is `send`); and
 *   four of the runnable examples do not parse, because they use a semicolon
 *   this interpreter rejects. A page generated from that map inherits every one
 *   of those, and then the docs are worse than none — they are confidently
 *   wrong.
 *
 *   FROM THE LIVE MODULE TABLE. `buildStandardLibrary()` is called here with a
 *   throwaway context and every module's real members are read off the object.
 *   A method that gets removed disappears from the page the same day. HELP is
 *   layered on top as PROSE ONLY, and where prose is missing the page says so
 *   instead of leaving a gap that reads like completeness.
 *
 * The language section works the same way: `languageSurface()` in the
 * interpreter exports its own limits, builtins and method tables, so the page
 * cannot claim a string method the runtime dropped.
 *
 * Pure data. DOM-free, network-free, import-safe in a headless test.
 */
import { buildStandardLibrary } from "./stdlib/index.js";
import { createCapabilitySet, MODULE_CAPABILITY } from "./capabilities.js";
import { HELP } from "./stdlib/helptext.js";
import { languageSurface } from "../pseudoPython.js";

/** A context that is enough to CONSTRUCT every module and to run none of them. */
function inspectieContext() {
    return {
        caps: createCapabilitySet(),
        filesystem: null,
        snapshot: {},
        user: {},
        cwd: "/projects",
        owner: "docs",
        processes: null,
        mail: null
    };
}

/** Short module key ("bucky.economy" -> "economy") — the key HELP uses. */
function kort(naam) {
    return String(naam || "").replace(/^bucky\./, "");
}

/**
 * Find the HELP signature for a bare member name, using the SAME matching the
 * runtime's own `help()` uses — including the slash-grouped keys like
 * "info/warn/alert(text)". Duplicating the rule here would be a second opinion
 * about what is documented, and then the page and `help()` disagree.
 */
function helpVoor(sleutel, lid) {
    const h = HELP[sleutel];
    if (!h || !h.methods) return null;
    const sig = Object.keys(h.methods).find(
        (s) => s.replace(/[\s(].*$/, "") === lid
            || s.split("/").some((alt) => alt.replace(/[\s(].*$/, "").trim() === lid));
    return sig ? { signature: sig, description: h.methods[sig] } : null;
}

/**
 * One module's documentation, assembled from what it really has.
 * `status` is "ok" | "raises" — derived from the marker `notImplemented()`
 * stamps, so a stub can never be presented as a working call.
 */
export function moduleDocs(naam, moduleObject) {
    const sleutel = kort(naam);
    const h = HELP[sleutel] || {};
    const leden = Object.keys(moduleObject)
        .filter((k) => k !== "__module__" && k !== "__name__")
        .sort()
        .map((lid) => {
            const waarde = moduleObject[lid];
            const hit = helpVoor(sleutel, lid);
            const stub = Boolean(waarde && waarde.__notImplemented__);
            return {
                name: lid,
                signature: hit ? `${sleutel}.${hit.signature}` : `${sleutel}.${lid}(...)`,
                description: hit ? hit.description : "",
                documented: Boolean(hit),
                status: stub ? "raises" : "ok",
                reason: stub ? (waarde.__reason__ || "") : "",
                submodule: Boolean(waarde && waarde.__module__)
            };
        });
    return {
        name: sleutel,
        module: naam,
        capability: MODULE_CAPABILITY[naam] || null,
        description: h.description || "",
        described: Boolean(h.description),
        example: h.example || "",
        members: leden,
        working: leden.filter((m) => m.status === "ok").length,
        raising: leden.filter((m) => m.status === "raises").length,
        undocumented: leden.filter((m) => !m.documented && !m.submodule).length
    };
}

/** The whole documentation model: the language plus every bucky.* module. */
export function buildDocs() {
    const { modules, builtins } = buildStandardLibrary(inspectieContext());
    const namen = Object.keys(modules)
        .filter((n) => n.startsWith("bucky.") && n !== "bucky")
        .sort();
    // De-duplicate on the module OBJECT, not the name: `bucky.report` and
    // `bucky.reports` are the same module under two names, and listing it twice
    // would suggest there are two.
    const gezien = new Set();
    const docs = [];
    namen.forEach((n) => {
        const m = modules[n];
        if (gezien.has(m)) return;
        gezien.add(m);
        docs.push(moduleDocs(n, m));
    });
    const preludeNamen = Object.keys(builtins)
        .filter((n) => n !== "dir" && n !== "help")
        .sort();
    return { language: languageSurface(), modules: docs, prelude: preludeNamen };
}

/**
 * Everything HELP claims that the runtime does not have.
 *
 * This is the guard the whole "generated, not written" promise rests on: it is
 * what a test asserts is empty, and what the page shows when it is not. Without
 * it the prose layer drifts again and the page drifts with it.
 */
export function helpDrift() {
    const { modules } = buildStandardLibrary(inspectieContext());
    const verzonnen = [];
    const zonderEntry = [];
    const ongedocumenteerd = [];
    const gezien = new Set();

    Object.keys(modules).forEach((naam) => {
        if (!naam.startsWith("bucky.") || naam === "bucky") return;
        const m = modules[naam];
        if (gezien.has(m)) return;
        gezien.add(m);
        const sleutel = kort(naam);
        const h = HELP[sleutel];
        if (!h) {
            zonderEntry.push(sleutel);
            return;
        }
        const echte = new Set(Object.keys(m).filter(
            (k) => k !== "__module__" && k !== "__name__"));
        Object.keys(h.methods || {}).forEach((sig) => {
            // A slash-grouped key documents several members at once; it counts
            // as invented only when NONE of its alternatives exists.
            const alts = sig.split("/").map((a) => a.replace(/[\s(].*$/, "").trim());
            if (!alts.some((a) => echte.has(a))) verzonnen.push(`${sleutel}.${sig}`);
        });
        echte.forEach((lid) => {
            if (m[lid] && m[lid].__module__) return;    // submodule, not a call
            if (!helpVoor(sleutel, lid)) ongedocumenteerd.push(`${sleutel}.${lid}`);
        });
    });
    return {
        invented: verzonnen.sort(),
        missingEntry: zonderEntry.sort(),
        undocumented: ongedocumenteerd.sort()
    };
}
