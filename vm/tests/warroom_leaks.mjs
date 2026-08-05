/**
 * War Room regression suite (headless) — bucky://warroom, v3 block 3.
 *
 * Guards the four things this page can get wrong while every backend test stays
 * green:
 *
 *   1. THE CURSOR STACK. Paging is keyset, so "previous" is a pop and "next" is
 *      a push. Get that wrong and the operator walks forward through a table
 *      they can never walk back out of — or worse, forward past rows that were
 *      never shown.
 *   2. A STALE RESPONSE WINNING. Two clicks in a row are two flights. Without
 *      the key check the slower one lands last and the table shows the page
 *      before the one the operator asked for.
 *   3. THE CODE PATTERN. `%` in a LIKE matches everything. The backend rejects
 *      it (a white list, not an escape), but the input here strips it first, so
 *      the table never blanks for a reason nobody can see.
 *   4. ESCAPING. Handles come from Discord display names, which are operator
 *      controlled. They are rendered into a table.
 *
 * Run:  bash site/vm/tests/run.sh   (this file runs alongside the phase 4.5B suite)
 */
import { gatewayClient } from "../core/gatewayClient.js";
import * as warroom from "../apps/browser/sites/orgleaks.js";

let failures = 0;
const okmsg = (m) => console.log("  PASS  " + m);
const fail = (m) => { console.log("  FAIL  " + m); failures++; };
const assert = (cond, m) => cond ? okmsg(m) : fail(m);

// ---------------------------------------------------------------------------
// Een nepbackend die opschrijft waar hij om gevraagd is
// ---------------------------------------------------------------------------
const gevraagd = [];
let antwoord = null;
let vertraging = 0;

function rij(id, extra = {}) {
    return {
        id, attack_id: 1, victim_id: String(4000 + id), handle: `op-${id}`,
        victim_org: { id: 2, slug: "nulldiv", name: "Null Division", emblem: "B" },
        masked_code: "x7x3", revealed: 2, combinations: 100,
        leaked_at: "2026-08-05T10:00:00", age_hours: 3.0, ...extra,
    };
}

function pagina(ids, next) {
    return {
        ok: true,
        data: {
            available: true,
            item: {
                items: ids.map((i) => rij(i)),
                next_cursor: next || null,
                total: 120, page_size: 25, retention_days: 10,
                sort: "recent", sorts: ["recent", "revealed"],
                sources: [{ org_id: 2, slug: "nulldiv", name: "Null Division",
                            emblem: "B", count: 120, latest: "2026-08-05T10:00:00" }],
            },
        },
    };
}

gatewayClient.fetchOrgLeaks = async (opts) => {
    gevraagd.push(JSON.parse(JSON.stringify(opts || {})));
    if (vertraging) await new Promise((r) => setTimeout(r, vertraging));
    return antwoord;
};

const rust = () => new Promise((r) => setTimeout(r, 5));

// ---------------------------------------------------------------------------
// De controller ligt op window; in Node bestaat dat niet, dus we zetten hem.
// ---------------------------------------------------------------------------
globalThis.window = globalThis.window || {};
if (!globalThis.window.dispatchEvent) globalThis.window.dispatchEvent = () => {};

function controller() {
    return globalThis.window.__buckyInpage && globalThis.window.__buckyInpage.warroom;
}

async function main() {
    console.log("\nWAR ROOM — bucky://warroom\n");

    // -- 0. koude start: een leeg archief ------------------------------------
    //
    // DEZE STAAT MOET VOORAAN, en dat is geen testvolgorde maar een eigenschap
    // van de pagina: dezelfde vraag binnen de TTL is geen tweede vlucht. Wie
    // hem later zou willen meten, meet de cache.
    antwoord = { ok: true, data: { available: true, item: { items: [], total: 0,
        retention_days: 10, sources: [], next_cursor: null } } };
    let html = renderHome();
    await rust();
    html = renderHome();
    assert(html.includes("Nothing here yet"),
        "een leeg archief zegt dat er nog niets is");
    assert(html.includes("kept for 10 days"),
        "en het zegt hoe lang een lek blijft staan");

    // -- 1. de eerste pagina -------------------------------------------------
    antwoord = pagina([1, 2, 3], { leaked_at: "2026-08-05T09:00:00", id: 3 });
    controller().onAction("sort", "revealed", null);   // andere vraag, dus een vlucht
    await rust();
    controller().onAction("sort", "recent", null);
    await rust();
    html = renderHome();

    assert(gevraagd.length >= 1, "de eerste render vraagt een pagina op");
    assert(!gevraagd[0].cursor, "de eerste pagina gaat ZONDER cursor de deur uit");
    assert(html.includes("op-1") && html.includes("op-3"),
        "de rijen staan in de tabel");
    assert(html.includes("Next"), "er is een volgende pagina");

    // -- 2. de cursorstack ---------------------------------------------------
    const c = controller();
    assert(!!c, "de in-page controller is geregistreerd");

    const voor = gevraagd.length;
    antwoord = pagina([4, 5, 6], null);
    c.onAction("next", null, null);
    await rust();
    const laatste = gevraagd[gevraagd.length - 1];
    assert(gevraagd.length > voor, "op 'next' wordt er opnieuw gevraagd");
    assert(laatste.cursor && String(laatste.cursor.id) === "3",
        "de cursor van 'next' is die van de LAATSTE getoonde rij");

    html = renderHome();
    assert(html.includes("op-4") && !html.includes("op-1"),
        "de tweede pagina vervangt de eerste");
    assert(html.includes("Page 2"), "de teller staat op pagina 2");
    assert(!html.includes('data-inpage-act="next"'),
        "zonder next_cursor is 'Next' geen knop meer");

    antwoord = pagina([1, 2, 3], { leaked_at: "2026-08-05T09:00:00", id: 3 });
    c.onAction("prev", null, null);
    await rust();
    html = renderHome();
    assert(html.includes("Page 1"), "'previous' zet de stack terug op pagina 1");
    assert(!html.includes('data-inpage-act="prev"'),
        "op de eerste pagina is 'Previous' geen knop");

    // 'prev' op pagina 1 mag niet onder nul zakken
    c.onAction("prev", null, null);
    await rust();
    assert(renderHome().includes("Page 1"), "'previous' op pagina 1 doet niets");

    // -- 3. een filter begint weer vooraan -----------------------------------
    c.onAction("next", null, null);
    await rust();
    c.onAction("source", "2", null);
    await rust();
    assert(renderHome().includes("Page 1"),
        "een ander filter begint bij pagina 1 en niet halverwege de vorige vraag");
    assert(!gevraagd[gevraagd.length - 1].cursor,
        "en dus zonder cursor");

    // -- 4. het patroon ------------------------------------------------------
    c.onSearch("%7%%", null);
    await rust();
    assert(gevraagd[gevraagd.length - 1].code === "7",
        `een '%' wordt gestript voordat hij verstuurd wordt (kreeg ${JSON.stringify(gevraagd[gevraagd.length - 1].code)})`);

    c.onSearch("x7x3x9", null);
    await rust();
    assert(gevraagd[gevraagd.length - 1].code === "x7x3",
        "langer dan vier wordt afgekapt op vier");

    c.onSearch("'; DROP TABLE org_leaks; --", null);
    await rust();
    assert(gevraagd[gevraagd.length - 1].code === "",
        "een SQL-poging levert een leeg patroon op");

    // -- 5. een traag antwoord op een oude vraag verliest --------------------
    c.onSearch("", null);
    await rust();
    vertraging = 40;
    antwoord = pagina([90, 91], null);        // het TRAGE antwoord
    c.onAction("source", "2", null);          // vraag A
    vertraging = 0;
    antwoord = pagina([7, 8], null);          // het SNELLE antwoord
    c.onAction("source", "", null);           // vraag B, direct erachteraan
    await new Promise((r) => setTimeout(r, 80));
    html = renderHome();
    assert(html.includes("op-7") && !html.includes("op-90"),
        "het antwoord op de LAATSTE vraag staat op het scherm, niet het traagste");

    // -- 6. escaping ---------------------------------------------------------
    antwoord = pagina([1], null);
    antwoord.data.item.items[0].handle = '<img src=x onerror="alert(1)">';
    antwoord.data.item.sources[0].name = "<script>bad()</script>";
    c.onSearch("", null);
    await rust();
    html = renderHome();
    assert(!html.includes("<img src=x"), "een handle met markup wordt geëscaped");
    assert(!html.includes("<script>bad"), "een orgnaam met markup wordt geëscaped");

    // -- 7. de andere twee leges zeggen iets ANDERS -------------------------
    antwoord = { ok: true, data: { available: true, item: { items: [], total: 120,
        retention_days: 10, sources: [], next_cursor: null } } };
    c.onSearch("1234", null);
    await rust();
    html = renderHome();
    assert(html.includes("No rows match"),
        "een filter zonder treffers zegt dat het aan het FILTER ligt");

    antwoord = { ok: false };
    c.onSearch("5555", null);
    await rust();
    html = renderHome();
    assert(html.includes("unreachable"),
        "een dode backend zegt dat hij onbereikbaar is en niet dat er niets ligt");

    // -- 8. wat er NIET staat ------------------------------------------------
    antwoord = pagina([1, 2], null);
    c.onSearch("", null);
    await rust();
    // ALLEEN DE RIJEN, en niet de uitleg erboven: die legt juist uit DAT er
    // niets gemarkeerd wordt, en zou zichzelf hier anders omvergooien.
    const tbody = (renderHome().split("<tbody>")[1] || "").split("</tbody>")[0].toLowerCase();
    assert(tbody.includes("op-1"), "de rijen staan er (anders meet de test niets)");
    for (const verboden of ["dead", "expired", "stale", "no longer valid",
                            "invalid", "rotated"]) {
        assert(!tbody.includes(verboden),
            `de tabel markeert een oud lek niet als '${verboden}'`);
    }

    console.log(failures ? `\n${failures} GUARD(S) FAILED\n` : "\nALL GUARDS PASS\n");
    process.exit(failures ? 1 : 0);
}

/** De render van de site, via de registry zoals de browser hem aanroept. */
function renderHome() {
    const pagina_ = [];
    warroom.registerWarRoomSite({
        register: (spec) => pagina_.push(spec),
        registerMatcher: () => {},
    });
    return pagina_[0].render({ url: "bucky://warroom", query: {} });
}

main();
