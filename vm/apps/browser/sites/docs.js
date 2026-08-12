/**
 * bucky://docs — the coding reference, generated from the runtime.
 *
 * WHY IT LIVES ON BUCKYNET AND NOT IN AN APP
 * A site gets deep links (`bucky://docs/economy`), a bookmark, PulseSearch
 * indexing and the browser's back button for free, and costs two lines in
 * buckynet.js. An app would need a registry entry, a desktop `.link`, a name in
 * apps.sys, and would still have none of those four.
 *
 * NOTHING HERE IS A LIST. `buildDocs()` reads the live module table and the
 * interpreter's own limits, builtins and method tables. This file is the
 * rendering half only — it decides what a page LOOKS like and never what is on
 * it. A method removed from the runtime disappears from the page the same day,
 * which is the only way a docs page stays worth reading.
 *
 * Render is synchronous and pure, as the SiteRegistry requires: the model is
 * rebuilt per render and costs nothing (no network, no filesystem, no DOM).
 */
import { buildDocs, helpDrift } from "../../../core/runtime/docs.js";
import { chip, crossRefs, escapeHtml, link, sitePage } from "./kit.js";

const SITE = "docs";
const DOMAIN = "docs.bucky.net";

/** A member row: signature, prose, and an honest badge when it only raises. */
function lidRegel(lid) {
    const badge = lid.status === "raises"
        ? ` <span class="vm-docs-badge is-stub">raises</span>` : "";
    const prose = lid.description
        ? `<div class="vm-docs-note">${escapeHtml(lid.description)}</div>`
        : `<div class="vm-docs-note is-missing">no description recorded</div>`;
    const reden = lid.reason
        ? `<div class="vm-docs-note is-missing">${escapeHtml(lid.reason)}</div>` : "";
    return `
        <li class="vm-docs-member">
            <code class="vm-docs-sig">${escapeHtml(lid.signature)}</code>${badge}
            ${prose}${reden}
        </li>`;
}

function moduleKaart(m) {
    const telling = m.raising
        ? `${m.working} working, ${m.raising} raising`
        : `${m.working} function${m.working === 1 ? "" : "s"}`;
    return `
        <li class="vm-docs-card">
            <div class="vm-docs-card-head">
                ${link(`bucky://docs/${m.name}`, m.name, "vm-docs-modname")}
                ${chip(telling)}
            </div>
            <div class="vm-docs-note">${escapeHtml(
                m.description || "no description recorded")}</div>
        </li>`;
}

function lijst(titel, waarden) {
    if (!waarden || !waarden.length) return "";
    return `
        <div class="vm-docs-block">
            <h3 class="vm-docs-h3">${escapeHtml(titel)}</h3>
            <p class="vm-docs-inline">${waarden.map(
                (w) => `<code>${escapeHtml(String(w))}</code>`).join(" ")}</p>
        </div>`;
}

/** The language half — every number in it comes from `languageSurface()`. */
function taalBlok(taal) {
    const grenzen = Object.keys(taal.limits).map(
        (k) => `<tr><td><code>${escapeHtml(k)}</code></td>`
             + `<td>${taal.limits[k].toLocaleString("en-GB")}</td></tr>`).join("");
    const uitgesteld = taal.deferred.map(
        ([vorm, wat]) => `<tr><td><code>${escapeHtml(vorm)}</code></td>`
                       + `<td>${escapeHtml(wat)}</td></tr>`).join("");
    return `
        <div class="vm-docs-block">
            <h2 class="vm-docs-h2">The language</h2>
            <p class="vm-docs-note">Not real Python - a bounded subset, running
            entirely inside the VM. No eval, no host filesystem, no network.</p>
            <h3 class="vm-docs-h3">What works</h3>
            <ul class="vm-docs-bullets">${taal.statements.map(
                (s) => `<li><code>${escapeHtml(s)}</code></li>`).join("")}</ul>
            ${lijst("Operators", taal.operators)}
            ${lijst("Built-in functions", taal.builtins)}
            ${lijst("String methods", taal.methods.str)}
            ${lijst("List methods", taal.methods.list)}
            ${lijst("Dict methods", taal.methods.dict)}
            <h3 class="vm-docs-h3">Not available yet</h3>
            <p class="vm-docs-note">These give a clear SyntaxError rather than
            failing halfway. Nothing on this list is a bug.</p>
            <div class="vm-docs-tablewrap"><table class="vm-docs-table">
                <tbody>${uitgesteld}</tbody></table></div>
            <h3 class="vm-docs-h3">Budgets</h3>
            <p class="vm-docs-note">A script cannot hang the VM. Cross one of
            these and the run stops with a RuntimeError.</p>
            <div class="vm-docs-tablewrap"><table class="vm-docs-table">
                <tbody>${grenzen}</tbody></table></div>
        </div>`;
}

function homePagina() {
    const model = buildDocs();
    const drift = helpDrift();
    const stuk = drift.invented.length + drift.missingEntry.length;
    // The page reports its own drift instead of hiding it. A generated page
    // that quietly papers over a gap is the failure mode this replaces.
    const waarschuwing = stuk ? `
        <div class="vm-docs-warn">
            <strong>${stuk}</strong> documentation entries do not match the
            runtime. The function lists below are still correct - they come from
            the runtime itself - but some prose is stale.
        </div>` : "";

    const body = `
        <div class="vm-docs">
            ${waarschuwing}
            <div class="vm-docs-block">
                <h2 class="vm-docs-h2">Start here</h2>
                <p class="vm-docs-note">Write a <code>.py</code> file in
                BuckyCode or the Files app and press Run, or type
                <code>python yourfile.py</code> in the Terminal. Every name
                below is available WITHOUT an import; the import forms work too.</p>
                <pre class="vm-docs-code"><code># no import needed
print('Level', profile.level(), '- coins', profile.coins())

# or be explicit
from bucky.leaderboards import richest
for r in richest(5):
    print(r['rank'], r['user_id'])</code></pre>
                <p class="vm-docs-note">In a script, <code>help()</code> and
                <code>dir()</code> answer the same questions this page does -
                try <code>help('economy')</code> or
                <code>dir(profile, True)</code>.</p>
            </div>
            <div class="vm-docs-block">
                <h2 class="vm-docs-h2">Modules (${model.modules.length})</h2>
                <ul class="vm-docs-cards">${
                    model.modules.map(moduleKaart).join("")}</ul>
                <p class="vm-docs-note"><strong>A script you received by mail
                gets fewer of these.</strong> Pressing Run on a mail attachment
                grants only <code>terminal</code>, <code>ui</code> and
                <code>process</code> - no filesystem, no profile, no economy,
                no mail. Save it and open it from Files to run it under your own
                grant.</p>
            </div>
            ${taalBlok(model.language)}
            ${crossRefs("Across BuckyNet", [
                { url: "bucky://profile", label: "Your operator profile",
                  note: "what profile.me() reads" },
                { url: "bucky://leaderboards", label: "Leaderboards",
                  note: "what leaderboards.top() reads" },
                { url: "bucky://leaks", label: "Leak Database",
                  note: "what leaks.latest() reads" }
            ])}
        </div>`;

    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · bucky://docs`,
        title: "Coding Reference",
        lead: "Everything the VM runtime actually offers, read straight off the runtime.",
        bodyHtml: body
    });
}

function modulePagina(naam) {
    const model = buildDocs();
    const m = model.modules.find((x) => x.name === naam);
    if (!m) {
        return sitePage({
            site: SITE,
            domain: `${DOMAIN} · bucky://docs/${escapeHtml(naam)}`,
            title: "Unknown module",
            lead: `There is no module called "${naam}".`,
            bodyHtml: `<div class="vm-docs"><div class="vm-docs-block">
                <p class="vm-docs-note">${link("bucky://docs", "Back to the module index")}</p>
                </div></div>`
        });
    }
    const stub = m.raising && m.raising === m.members.length;
    const kop = stub ? `
        <div class="vm-docs-warn">
            This module is an INTERFACE ONLY. Every member raises
            NotImplemented; it exists so the import resolves and the shape is
            stable for when the subsystem lands.
        </div>` : "";
    const body = `
        <div class="vm-docs">
            ${kop}
            <div class="vm-docs-block">
                <p class="vm-docs-note">
                    ${chip(`import bucky.${m.name}`)}
                    ${chip(`from bucky.${m.name} import *`)}
                    ${m.capability ? chip(`capability: ${m.capability}`) : ""}
                </p>
                ${m.example ? `<pre class="vm-docs-code"><code>${
                    escapeHtml(m.example)}</code></pre>` : ""}
            </div>
            <div class="vm-docs-block">
                <h2 class="vm-docs-h2">Functions (${m.members.length})</h2>
                <ul class="vm-docs-members">${
                    m.members.map(lidRegel).join("")}</ul>
            </div>
            ${crossRefs("More", [
                { url: "bucky://docs", label: "All modules", note: "the index" }
            ])}
        </div>`;
    return sitePage({
        site: SITE,
        domain: `${DOMAIN} · bucky://docs/${escapeHtml(m.name)}`,
        title: `bucky.${m.name}`,
        lead: m.description || "No description recorded for this module.",
        bodyHtml: body
    });
}

/**
 * Register bucky://docs and one page per module.
 *
 * The per-module pages are registered from the LIVE model, so a module added to
 * the stdlib gets its own searchable page with no edit here. Keywords come from
 * the member names, which is what somebody actually searches for.
 */
export function registerDocsSite(registry) {
    registry.register({
        id: "docs",
        url: "bucky://docs",
        site: SITE,
        title: "Coding Reference",
        type: "home",
        description: "What the VM runtime offers: modules, functions, language and limits.",
        tags: ["docs", "reference", "code", "python", "scripting"],
        keywords: ["docs", "documentation", "reference", "help", "api",
                   "python", "scripting", "bucky", "manual"],
        render: () => homePagina()
    });

    let modules = [];
    try {
        modules = buildDocs().modules;
    } catch (_e) {
        // A faulty module factory must never take BuckyNet down with it; the
        // index page above still renders and reports the problem itself.
        modules = [];
    }
    modules.forEach((m) => {
        registry.register({
            id: `docs-${m.name}`,
            url: `bucky://docs/${m.name}`,
            site: SITE,
            title: `bucky.${m.name}`,
            type: "article",
            description: m.description || `The bucky.${m.name} module.`,
            tags: ["docs", "reference", m.name],
            keywords: ["docs", m.name, `bucky.${m.name}`,
                       ...m.members.map((lid) => lid.name)],
            render: () => modulePagina(m.name)
        });
    });
}
