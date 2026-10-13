/**
 * De org-pagina van v2: ledentallen en de knop "Open the org app"
 * (13-10-2026, ronde 2 deel E). Tests: site/tests/test_v2_orgs.py.
 *
 * DE ROUTE, in deze volgorde:
 *   1. niet ingelogd  -> Discord-login, terug op deze pagina met ?flow=org, en
 *                        dan gaat het vanzelf verder (geen tweede klik);
 *   2. breed scherm   -> de VM, gemaximaliseerd, met de org-app open (deel 0.2);
 *   3. telefoon       -> de bot stuurt een DM (POST /api/org/dm, deel 0.3);
 *   4. DM mislukt     -> dezelfde informatie op de pagina, met de melding dat de
 *                        DM niet lukte. Nooit stil: elke uitkomst krijgt tekst.
 *
 * Dezelfde sessie als overal (../../js/sessie.js): /api/me en de bestaande
 * Discord-login. Wie de DM krijgt bepaalt de backend uit de sessie; deze pagina
 * stuurt geen id mee.
 *
 * Alle tekst uit de API gaat via textContent de pagina in, nooit als HTML.
 */
import { API_URL } from "../../js/config.js";
import { fetchMetDeadline, haalLogin, loginUrl } from "../../js/sessie.js";

/** Vanaf hier kan de VM open. Daaronder sluit hij zich af: vm/styles/vm.css,
 *  `@media (max-width: 767px)`. Een test houdt die twee gelijk. */
export const VM_MIN_BREEDTE = 768;
export const VM_URL = "../arcade.html?app=org&maximize=1#the-vm";
/** Waar de login naar terugkeert (backend: sessions.safe_return_path). */
export const TERUG = "v2/organisations.html?flow=org";
const DISCORD_DMS = "https://discord.com/channels/@me";

const NAMEN = {
    nulldiv: "Null Division",
    vanta: "Vanta Collective",
    aether: "Aether Systems",
    cytek: "CyTek Industries",
};

// --------------------------------------------------------------------------
// Kleine DOM-hulp: elementen met tekst, nooit innerHTML.
// --------------------------------------------------------------------------
function el(tag, attrs = {}, ...kinderen) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") n.className = v;
        else n.setAttribute(k, v);
    }
    for (const k of kinderen) {
        if (k == null) continue;
        n.append(typeof k === "string" ? document.createTextNode(k) : k);
    }
    return n;
}

const cmd = (tekst) => el("code", {}, tekst);
const discordKnop = () =>
    el("a", { class: "btn btn-signal flow-knop", href: DISCORD_DMS, target: "_blank", rel: "noopener" }, "Open Discord");

function toon(vak, staat, ...inhoud) {
    vak.dataset.staat = staat;
    vak.replaceChildren(...inhoud);
    vak.hidden = false;
}

// --------------------------------------------------------------------------
// Ledentallen (publiek). Faalt dit, dan blijft het vak leeg: geen verzonnen getal.
// --------------------------------------------------------------------------
async function ledentallen() {
    try {
        const res = await fetchMetDeadline(`${API_URL}/api/player/organizations`);
        if (!res.ok) return null;
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        for (const o of items) {
            const n = Number(o.members);
            const vak = document.querySelector(`[data-leden="${CSS.escape(String(o.id))}"]`);
            if (!vak || !Number.isFinite(n) || n < 0) continue;
            vak.textContent = `${n.toLocaleString("en-US")} ${n === 1 ? "member" : "members"}`;
        }
        return items;
    } catch (_e) {
        return null;
    }
}

// --------------------------------------------------------------------------
// De route
// --------------------------------------------------------------------------
const breedGenoeg = () => window.matchMedia(`(min-width: ${VM_MIN_BREEDTE}px)`).matches;

async function vraagDm() {
    try {
        const res = await fetch(`${API_URL}/api/org/dm`, { method: "POST", credentials: "include" });
        let body = {};
        try {
            body = await res.json();
        } catch (_e) { /* een lege of kapotte body is gewoon een mislukte DM */ }
        if (res.ok && body.delivered) return { ok: true, kind: body.kind, repeat: !!body.repeat };
        return { ok: false, kind: body.kind || null, reason: body.reason || (res.status === 429 ? "busy" : "failed") };
    } catch (_e) {
        return { ok: false, kind: null, reason: "network" };
    }
}

function verstuurd(vak, uit) {
    const wat = {
        myorg: ["Bucky sent you your organisation card, the same as ", cmd("/myorg"), "."],
        chooseorg: ["Bucky sent you the four organisations to choose from, the same as ", cmd("/chooseorg"), "."],
        start: ["You don't have a Bucky profile yet. Bucky sent you how to start: run ", cmd("/start"), " first."],
    }[uit.kind] || ["Bucky sent you a message about your organisation."];
    toon(vak, "dm-verstuurd",
        el("p", { class: "flow-titel" }, uit.repeat ? "Already sent. Check your Discord DMs" : "Check your Discord DMs"),
        el("p", { class: "flow-tekst" }, ...wat),
        discordKnop());
}

const REDEN = {
    dms_closed: "Discord didn't let Bucky message you. Your DMs may be closed, or you don't share a server with Bucky.",
    unavailable: "Bucky is not reachable right now.",
    busy: "Too many requests in a short time.",
    network: "The connection dropped.",
    unknown_user: "Discord doesn't know this account.",
    failed: "Discord refused the message.",
};

/** De DM kwam niet aan: dezelfde informatie hier, met de reden erbij. */
async function terugval(vak, uit) {
    toon(vak, "bezig", el("p", { class: "flow-tekst" }, "Bucky couldn't DM you. Loading it here instead…"));

    let me = null;
    try {
        const res = await fetchMetDeadline(`${API_URL}/api/org/me`, { credentials: "include" });
        if (res.ok) me = await res.json();
    } catch (_e) { /* zonder org/me valt de soort terug op wat de DM-poging zei */ }

    let soort = uit.kind;
    if (me && me.viewer && me.org) soort = "myorg";
    else if (me && !soort) soort = "chooseorg";

    const delen = [
        el("p", { class: "flow-titel" }, "We couldn't DM you — open Discord"),
        el("p", { class: "flow-tekst" }, REDEN[uit.reason] || REDEN.failed, " Here is what Bucky would have sent."),
    ];

    if (soort === "myorg" && me && me.viewer && me.org) {
        const v = me.viewer;
        const o = me.org;
        const rij = (k, w) => el("div", {}, el("dt", {}, k), el("dd", {}, String(w)));
        delen.push(el("div", { class: "flow-kaart", "data-fallback": "myorg" },
            el("p", { class: "flow-kaart-titel" }, String(o.name || NAMEN[o.slug] || "Your organisation")),
            el("dl", { class: "flow-feiten" },
                rij("Rank", v.rank || "recruit"),
                rij("Specialisation", v.specialisation || "none"),
                rij("Members", Number(o.members) || 0),
                rij("Active this term", Number(o.active) || 0)),
            el("p", { class: "flow-tekst" }, "Your full card is in Discord: ", cmd("/myorg"), ".")));
    } else if (soort === "myorg") {
        delen.push(el("div", { class: "flow-kaart", "data-fallback": "myorg" },
            el("p", { class: "flow-tekst" }, "Your organisation card is in Discord: ", cmd("/myorg"), ".")));
    } else if (soort === "start") {
        delen.push(el("div", { class: "flow-kaart", "data-fallback": "start" },
            el("p", { class: "flow-kaart-titel" }, "No profile yet"),
            el("p", { class: "flow-tekst" }, "Run ", cmd("/start"), " in a server with Bucky to create your profile. The organisation chooser opens automatically.")));
    } else {
        const lijst = el("ul", { class: "flow-orgs" });
        for (const [slug, naam] of Object.entries(NAMEN)) {
            const tal = document.querySelector(`[data-leden="${slug}"]`);
            const anker = document.querySelector(`.op-${slug === "nulldiv" ? "null" : slug}`);
            lijst.append(el("li", {},
                el("a", { href: anker ? `#${anker.id}` : "#main" }, naam),
                tal && tal.textContent ? ` · ${tal.textContent}` : ""));
        }
        delen.push(el("div", { class: "flow-kaart", "data-fallback": "chooseorg" },
            el("p", { class: "flow-kaart-titel" }, "Choose your organisation"),
            el("p", { class: "flow-tekst" }, "You're not in an organisation yet. Read the four below, then pick one in Discord with ", cmd("/chooseorg"), ". Organisations that are already well staffed don't recruit while the others catch up, so Discord may offer fewer."),
            lijst,
            el("p", { class: "flow-tekst flow-klein" }, "No Bucky profile yet? Run ", cmd("/start"), " first.")));
    }
    delen.push(discordKnop());
    toon(vak, "dm-fallback", ...delen);
}

async function flow(vak, { naLogin = false } = {}) {
    toon(vak, "bezig", el("p", { class: "flow-tekst" }, "Checking your login…"));
    const { loggedIn } = await haalLogin();

    if (!loggedIn) {
        if (naLogin) {
            // Terug van Discord zonder sessie (afgebroken, of een cookie die niet
            // bleef hangen). Niet nog eens doorsturen: dat is een lus.
            toon(vak, "uitgelogd",
                el("p", { class: "flow-titel" }, "You're not logged in"),
                el("p", { class: "flow-tekst" }, "Log in with Discord to open the org app."),
                el("a", { class: "btn btn-signal flow-knop", href: loginUrl(TERUG) }, "Log in with Discord"));
            return;
        }
        toon(vak, "login", el("p", { class: "flow-tekst" }, "Taking you to Discord to log in…"));
        window.location.assign(loginUrl(TERUG));
        return;
    }

    if (breedGenoeg()) {
        toon(vak, "vm", el("p", { class: "flow-tekst" }, "Opening the org app…"));
        window.location.assign(VM_URL);
        return;
    }

    toon(vak, "bezig", el("p", { class: "flow-tekst" }, "Asking Bucky to DM you…"));
    const uit = await vraagDm();
    if (uit.ok) verstuurd(vak, uit);
    else await terugval(vak, uit);
}

function start() {
    const blokken = [...document.querySelectorAll("[data-org-flow]")];
    for (const blok of blokken) {
        const knop = blok.querySelector("[data-org-cta]");
        const vak = blok.querySelector("[data-flow]");
        if (!knop || !vak) continue;
        knop.addEventListener("click", async () => {
            if (knop.getAttribute("aria-busy") === "true") return;
            knop.setAttribute("aria-busy", "true");
            try {
                await flow(vak);
            } finally {
                knop.removeAttribute("aria-busy");
            }
        });
    }

    const tallen = ledentallen();

    // Terug van de login: de parameter weg (verversen mag geen tweede DM
    // sturen), en dan verder waar de bezoeker gebleven was.
    const params = new URLSearchParams(window.location.search);
    if (params.get("flow") === "org" && blokken.length) {
        params.delete("flow");
        const rest = params.toString();
        history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
        const vak = blokken[0].querySelector("[data-flow]");
        tallen.finally(() => flow(vak, { naLogin: true }));
    }
}

// Onder v1 stuurt site-version.js deze pagina weg; dan niets starten.
const besloten = window.BuckySiteVersion && window.BuckySiteVersion.versie;
if (besloten === "v2") {
    start();
} else if (!besloten) {
    document.addEventListener("bucky:site-versie", (e) => { if (e.detail === "v2") start(); }, { once: true });
}
