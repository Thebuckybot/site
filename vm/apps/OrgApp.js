/**
 * OrgApp — the organization dashboard inside the VM.
 *
 * WHAT IT IS
 * Reading and talking. Choosing and buying happen in Discord, and every screen
 * where that matters says so in the place where somebody would otherwise look
 * for a button. That is not a limitation to apologise for: the bot locks its
 * writes inside its own process, so a second process spending shards is a race
 * nobody can win. What the app does instead is show the numbers and carry the
 * conversation.
 *
 * ONE NAVIGATION
 * A tab bar at the bottom and nothing else. No sidebar, no menu in the header,
 * no second row of filters. Every screen is reachable in one press from every
 * other screen, and the header only ever says which organization you are
 * looking at.
 *
 * THE NUMBERS ARE THE PRODUCT
 * This is a figures app. Secondary text runs at a much higher contrast than the
 * VM's usual dim grey, every number sits on tabular figures so digits do not
 * shift as they tick, and no bar or count is allowed to animate its value -
 * somebody who cannot tell whether they are reading 4,05% or 4,85% has stopped
 * trusting the app, and they are right to.
 *
 * AVATARS ARE FLATTENED ON PURPOSE
 * Discord avatars are user-supplied and some of them are pure white or a
 * strobing gif. One size, one radius, a thin ring in the organization colour and
 * a slight dim: a face stays recognisable and the dark theme survives.
 *
 * POLLING, AND WHY 15 SECONDS
 * There is no socket and none of the existing VM surfaces poll at all - they use
 * TTL-on-render or a one-shot fetch at mount. The feed needs more than that
 * because it is a conversation: a reply that shows up a minute late reads as a
 * reply that was lost. Fifteen seconds is under the point where that happens and
 * still cheap - four organizations of under ten members is well below one
 * request per second across the whole game, and the interval stops entirely when
 * the window is not on top. The other tabs poll at 30s, which is already faster
 * than the numbers behind them move: the bot redraws its own command board every
 * fifteen minutes.
 */

// De client is EEN named export met de verbs erin, geen losse functies. Een
// namespace-import geeft dan een object zonder `request` en de app valt om op
// de eerste fetch - stil, want het gebeurt in een promise.
import { gatewayClient } from "../core/gatewayClient.js";
import { applyOrgTheme, applyOrgMaterial, accentColour } from "./orgTheme.js";

const FEED_POLL_MS = 15000;
const DATA_POLL_MS = 30000;
const BODY_LIMIT = 500;

// De tabbalk, in de volgorde van de mockup. De glyph is een TEKEN en geen
// afbeelding: de hele VM rendert iconen als tekst, en een <img> hier zou het
// enige in zijn soort zijn.
const TABS = [
    { key: "overview", label: "Overzicht", glyph: "▣" },
    { key: "feed", label: "Feed", glyph: "▤" },
    { key: "upgrades", label: "Upgrades", glyph: "▦" },
    { key: "treasury", label: "Treasury", glyph: "▥" },
    { key: "election", label: "Verkiezing", glyph: "▧" },
    { key: "members", label: "Leden", glyph: "▢" },
    { key: "card", label: "Jij", glyph: "□" }
];

const RANK_LABEL = {
    recruit: "Recruit", member: "Member", specialist: "Specialist",
    officer: "Officer", commander: "Commander", council: "Council",
    leader: "Leader"
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Thousands separators with a non-breaking thin space.
 *
 * A plain space lets a number wrap across a line, and a wrapped number is the
 * "broken line near a figure" this app is not allowed to have.
 */
function num(value) {
    const n = Math.trunc(Number(value) || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Two decimals, always both, so a column of rates lines up. */
function pct(value) {
    return (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
}

/**
 * De avatar van een speler.
 *
 * WAT ER WEL EN NIET KAN. Een echte Discord-avatar vraagt een hash, en die
 * wordt nergens opgeslagen: `profiles.data` kent geen `avatar`, geen
 * `avatar_hash` en geen `username`. Voor ANDERE leden is er dus geen bron, en
 * dat is geen veld dat de backend even kan toevoegen - het vraagt dat de bot de
 * hash gaat wegschrijven bij elk commando.
 *
 * Voor JEZELF is hij er wel: `/api/me` levert hem en de VM geeft hem door aan
 * elke app. Die wordt hier gebruikt zodra het om de ingelogde speler gaat, en
 * de rest valt terug op de standaardavatar - geen gegokt CDN-pad dat 404't.
 */
function avatar(userId, eigen) {
    if (eigen) return eigen;
    //
    // BigInt THROWS on anything that is not a number, and this runs inside
    // `refresh()`, which has no catch: one non-numeric id would freeze the whole
    // app on its previous DOM. The candidate list comes out of bot-written JSON
    // and is numeric today - "today" is not a guarantee worth a frozen app.
    const raw = String(userId || "0");
    const index = /^\d+$/.test(raw) ? Number(BigInt(raw) % 5n) : 0;
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/**
 * Een persoon: avatar, korte id, rangbadge.
 *
 * De avatar is VIERKANT met afgeronde hoeken en niet rond, zodat hij bij de
 * avatartegel van de organisatie hoort in plaats van bij de taakbalk van de VM.
 * Eén maat, een rand in de organisatiekleur en een lichte demping: spelers
 * kiezen hun eigen pfp en sommige zijn spierwit of knipperen.
 */
function userChip(userId, rank, extraClass, eigen) {
    const label = RANK_LABEL[rank] || "";
    return `<span class="og-user ${extraClass || ""}" title="${escapeHtml(userId)}">
        <img class="og-avatar" alt="" src="${escapeHtml(avatar(userId, eigen))}">
        <span class="og-user-id og-mono">${escapeHtml(shortId(userId))}</span>
        ${label ? `<span class="og-badge">${escapeHtml(label)}</span>` : ""}
    </span>`;
}

/**
 * A Discord snowflake is eighteen digits and means nothing to a reader. The
 * last four are enough to tell two members apart in a list of ten, and the
 * whole id stays in the title attribute for anybody who needs it.
 */
function shortId(userId) {
    const s = String(userId || "");
    return s.length > 6 ? "…" + s.slice(-4) : s;
}


function empty(title, body) {
    return `<div class="vm-orgapp-empty">
        <div class="vm-orgapp-empty-title">${escapeHtml(title)}</div>
        <div class="vm-orgapp-empty-body">${escapeHtml(body)}</div>
    </div>`;
}

/** Every screen that shows a price says where the button is. */
function discordNote(what) {
    return `<div class="vm-orgapp-note">${escapeHtml(what)}</div>`;
}

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */
export function createOrgState(user) {
    return {
        tab: "overview",
        user: user || null,
        viewer: null,
        loading: true,
        error: "",
        data: {},          // per tab, laatst opgehaalde payload
        fetchedAt: {},     // per tab
        standings: [],
        feed: { posts: [], can_post: false, can_moderate: false },
        draft: "",
        replyTo: null,
        posting: false,
        postError: "",
        campaignId: null,
        campagneGezocht: false,
        upgradeCat: "",
        reported: {}
    };
}

/* ------------------------------------------------------------------ */
/* render                                                              */
/* ------------------------------------------------------------------ */
export function renderOrgApp(runtime, windowState) {
    return `<div class="vm-orgapp">${renderOrgInner(runtime, windowState)}</div>`;
}

function renderOrgInner(runtime, windowState) {
    const s = windowState.appState;

    if (s.loading && !s.viewer && !s.standings.length) {
        return shell(s, `<p class="og-boot"><span class="og-boot-dot"></span>
            verbinden met de organisatie…</p>`, false);
    }
    if (s.error) {
        return shell(s, empty("Geen verbinding", s.error), false);
    }
    if (!s.viewer) {
        return shell(s, renderOutsider(s), false);
    }
    return shell(s, renderTab(s), true);
}

/**
 * De schil: textuur, kop, inhoud, tabbalk.
 *
 * De vier textuurlagen staan in de markup en niet als pseudo-elementen op de
 * body, omdat ze alle vier tegelijk moeten kunnen en er maar twee pseudo's per
 * element zijn. Ze liggen onder de inhoud en boven de achtergrond, met
 * `pointer-events: none`, dus ze vangen niets af.
 */
function shell(s, inhoud, chroom) {
    const org = s.data.overview;
    const slug = (org && org.slug) || (s.viewer ? "" : "publiek");
    return `<div class="og-shell">
        <div class="og-texture" aria-hidden="true">
            <i class="og-grid"></i><i class="og-scan"></i>
            <i class="og-noise"></i><i class="og-vignette"></i>
        </div>
        <header class="og-head">
            <span class="og-head-mark">▚</span>
            <span class="og-head-path">ORG://${escapeHtml(slug)}</span>
            <span class="og-head-live"><i></i>LIVE</span>
        </header>
        <div class="og-body" data-org-body>${inhoud}</div>
        ${chroom ? renderTabs(s) : ""}
    </div>`;
}

function renderTabs(s) {
    return `<nav class="og-tabs">${TABS.map((t) => `
        <button class="og-tab${s.tab === t.key ? " is-active" : ""}"
                data-org-tab="${t.key}">
            <span class="og-tab-glyph">${t.glyph}</span>
            <span class="og-tab-label">${escapeHtml(t.label)}</span>
        </button>`).join("")}
    </nav>`;
}

function renderTab(s) {
    switch (s.tab) {
        case "feed": return renderFeed(s);
        case "treasury": return renderTreasury(s);
        case "upgrades": return renderUpgrades(s);
        case "members": return renderMembers(s);
        case "election": return renderElection(s);
        case "card": return renderCard(s);
        default: return renderOverview(s);
    }
}

/* ---- niet-lid ---------------------------------------------------- */
/**
 * Wat iemand ziet die (nog) nergens bij hoort.
 *
 * Links waarom hij hier niets kan, rechts het enige dat wel openbaar is: de
 * ranglijst. Dat is geen troostprijs maar precies de informatie waar iemand die
 * nog moet kiezen iets aan heeft - hoe de vier ervoor staan.
 *
 * De knop opent niets. `+chooseorg` gebeurt in Discord, en een knop die alleen
 * een commando toont is eerlijker dan een knop die doet alsof hij je aanmeldt.
 */
function renderOutsider(s) {
    const top = Math.max(1, ...s.standings.map((o) => Number(o.score) || 0));
    const rijen = s.standings.map((o, i) => `
        <li class="og-rank-row" style="--row:${accentColour((o.theme || {}).color)}">
            <span class="og-rank-pos og-mono">${i + 1}</span>
            <span class="og-rank-mark">${escapeHtml(o.emblem || "◇")}</span>
            <span class="og-rank-name">${escapeHtml(o.name)}</span>
            <span class="og-rank-bar"><i style="--fill:${
                Math.max(4, Math.round((Number(o.score) || 0) / top * 100))}%"></i></span>
            <span class="og-rank-score og-mono">${num(o.score)}</span>
        </li>`).join("");

    return `<div class="og-split">
        <div class="og-col og-col-main">
            <section class="og-panel og-locked">${CORRUPT}
                <span class="og-locked-mark">■</span>
                <h2>Alleen leden</h2>
                <p>Je kijkt van buitenaf naar deze organisatie. De ranglijst is
                    openbaar; de feed, de treasury, de upgrades en de verkiezing
                    zijn dat niet.</p>
                <button class="og-join" data-org-join>
                    Hoe word ik lid? <code>+chooseorg</code>
                </button>
                <p class="og-faint">Je kiest één keer, en die keuze is
                    permanent. Lees de vier eerst.</p>
            </section>
        </div>
        <div class="og-col og-col-side">
            <section class="og-panel og-rank">${CORRUPT}
                <div class="og-eyebrow">Ranglijst — REP per actief lid</div>
                <ol class="og-rank-list">${rijen}</ol>
                <p class="og-faint">Dit is wat iedereen mag zien, ook zonder
                    organisatie.</p>
            </section>
        </div>
    </div>`;
}

/* ---- overzicht --------------------------------------------------- */
/**
 * Het overzicht, in twee kolommen op breed en onder elkaar op smal.
 *
 * WAAROM TWEE KOLOMMEN. De mockups zijn staand ontworpen; dit venster is
 * liggend. Die kolom uitrekken geeft een strook tekst in een leeg landschap, en
 * dat is erger dan wat er stond. De splitsing zit niet willekeurig in het
 * midden maar op een naad die er al was: identiteit, termijn en aankondiging
 * lees je van boven naar beneden (verhaal), terwijl de ranglijst en de treasury
 * dingen zijn waar je even naar kijkt en die je vergelijkt (referentie). Het
 * verhaal houdt links een leesbare regellengte, de referentie staat rechts waar
 * je hem in een oogopslag pakt. Onder 620 px vallen ze in precies de volgorde
 * van de mockup onder elkaar - dezelfde componenten, andere plaatsing.
 */
function renderOverview(s) {
    // `s.data.overview` is de UITGEPAKTE org. `load()` zette hier eerst de hele
    // envelope neer en overschreef die alleen als `item` waar was, dus bij een
    // lege org bleef een truthy envelope staan, sloeg de guard niet aan en
    // klapte de volgende regel op `org.credits`.
    const org = s.data.overview;
    if (!org || !org.credits) {
        return empty("Nog niets", "Deze organisatie heeft nog geen gegevens.");
    }
    const aankondiging = ((s.data.overview_env || {}).announcements || [])[0];

    return `
        ${renderIdentity(org, s)}
        <div class="og-split">
            <div class="og-col og-col-main">
                ${renderTerm(org)}
                ${renderAnnouncementCard(aankondiging)}
            </div>
            <div class="og-col og-col-side">
                ${renderStandings(s, org)}
                ${renderTreasurySummary(org)}
            </div>
        </div>`;
}

/**
 * De kop van het scherm: banner, avatar, naam, en de cijfers die je meteen wilt.
 *
 * DE BANNER IS DE HELD. Hij stond al in de database, de backend serveerde hem
 * al, en de app las hem niet - dat was het grootste zichtbare verschil met de
 * mockup voor precies deze regel werk. De gradient eroverheen is functioneel en
 * geen decoratie: zonder verdwijnt de naam in de kunst.
 */
/** Twee banden die over een paneel schuiven. Op amplitude nul onzichtbaar, dus
 *  hij mag onvoorwaardelijk in de markup staan - geen tak, geen conditie. */
const CORRUPT = `<span class="og-corrupt" aria-hidden="true"><i></i><i></i></span>`;

function renderIdentity(org, s) {
    const t = org.theme || {};
    const mij = s.standings.findIndex((o) => o.org_id === org.org_id);
    return `<header class="og-ident">${CORRUPT}
        <div class="og-banner${t.banner_url ? "" : " is-blank"}"
             ${t.banner_url ? `style="--shot:url('${escapeHtml(t.banner_url)}')"` : ""}>
            <span class="og-banner-fade"></span>
        </div>
        <div class="og-ident-row">
            <div class="og-avatar-tile${t.avatar_url ? "" : " is-blank"}"
                 ${t.avatar_url ? `style="--shot:url('${escapeHtml(t.avatar_url)}')"` : ""}
                 aria-hidden="true">${t.avatar_url ? "" : escapeHtml(org.emblem || "◇")}</div>
            <div class="og-ident-name">
                <h1>${escapeHtml(org.name || org.slug || "")}</h1>
                <p class="og-slug">${escapeHtml(org.slug || "")}</p>
                ${t.tagline ? `<p class="og-motto">// ${escapeHtml(t.tagline)}</p>` : ""}
            </div>
            <dl class="og-ident-rep">
                <dt>REP deze termijn</dt>
                <dd data-count="${Number(org.rep) || 0}">${num(org.rep)}</dd>
            </dl>
        </div>
        <div class="og-ident-facts">
            ${fact("Leden", `${num(org.active)} / ${num(org.members)}`)}
            ${fact("Ranglijst", mij >= 0 ? `#${mij + 1} / ${s.standings.length}` : "—")}
            ${fact("Credits", num(org.credits.available))}
        </div>
    </header>`;
}

function fact(label, value) {
    return `<div class="og-fact">
        <span class="og-fact-label">${escapeHtml(label)}</span>
        <span class="og-fact-value">${escapeHtml(value)}</span>
    </div>`;
}

/**
 * De termijnbalk.
 *
 * De mockup telt de dagen van de TERMIJN af. Die datum wordt nergens geserveerd
 * - `org_elections` kent een termijnnummer maar geen begin, en de kwartaalpas
 * heeft alleen een interval. Een aftelling verzinnen op een cyclus die ik niet
 * ken is precies het soort getal waar deze app niet omheen mag liegen, dus
 * staat hier de DEADLINE VAN DE CAMPAGNE: dezelfde vorm, een klok die echt
 * loopt, en zonder campagne een blok dat zegt dat er niets loopt.
 */
function renderTerm(org) {
    const c = org.campaign;
    if (!c) {
        return `<section class="og-panel og-term is-idle">
            <div class="og-eyebrow">Campagne</div>
            <p class="og-term-idle">Er loopt geen campagne. De leider opent er een
                met <code>+campaign</code> in #treasury.</p>
        </section>`;
    }
    const dagen = dagenTot(c.deadline);
    return `<section class="og-panel og-term">${CORRUPT}
        <div class="og-term-head">
            <span class="og-eyebrow">Campagne</span>
            <span class="og-term-name">${escapeHtml(c.title || "")}</span>
            <span class="og-term-left">${dagen === null ? "—"
                : `nog ${num(dagen)} ${dagen === 1 ? "dag" : "dagen"}`}</span>
        </div>
        ${meter(c.percent, c.full)}
        <div class="og-term-foot">
            <span class="og-mono">${num(c.raised)}</span>
            <span class="og-faint">van ${num(c.goal)}</span>
            <span class="og-term-pct og-mono">${c.percent}%</span>
        </div>
        ${c.full ? `<p class="og-flag">Pot is vol — de Leader kan nu kopen.</p>` : ""}
    </section>`;
}

function dagenTot(iso) {
    if (!iso) return null;
    const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
    if (isNaN(d.getTime())) return null;
    return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
}

/**
 * De meter. `--fill` in plaats van `width`, zodat de CSS hem kan animeren
 * zonder dat de renderlaag iets van tijd hoeft te weten.
 */
function meter(percent, vol) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    return `<div class="og-meter${vol ? " is-full" : ""}" role="progressbar"
         aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100">
        <i style="--fill:${p}%"></i>
    </div>`;
}

/**
 * De ranglijst, en het enige moment waarop alle vier de identiteiten tegelijk
 * op het scherm staan.
 *
 * Elke balk draagt de kleur van ZIJN EIGEN organisatie, door dezelfde
 * helderheidsbodem gehaald als het eigen thema - anders zou Aether op elke
 * ranglijst de zwakste lijken omdat zijn marineblauw het donkerst is, en dat is
 * een oordeel dat een balk niet mag vellen.
 */
function renderStandings(s, org) {
    const top = Math.max(1, ...s.standings.map((o) => Number(o.score) || 0));
    const rijen = s.standings.map((o, i) => {
        const breedte = Math.max(4, Math.round((Number(o.score) || 0) / top * 100));
        return `<li class="og-rank-row${o.org_id === org.org_id ? " is-you" : ""}"
            style="--row:${accentColour((o.theme || {}).color)}">
            <span class="og-rank-pos og-mono">${i + 1}</span>
            <span class="og-rank-mark">${escapeHtml(o.emblem || "◇")}</span>
            <span class="og-rank-name">${escapeHtml(o.name)}</span>
            <span class="og-rank-bar"><i style="--fill:${breedte}%"></i></span>
            <span class="og-rank-score og-mono">${num(o.score)}</span>
        </li>`;
    }).join("");
    return `<section class="og-panel og-rank">${CORRUPT}
        <div class="og-eyebrow">Ranglijst — REP per actief lid</div>
        <ol class="og-rank-list">${rijen}</ol>
    </section>`;
}

/** De avatar-URL van de ingelogde speler, als de VM hem kent. */
function mijnAvatar(s) {
    return (s.user && s.user.avatarUrl) || "";
}

function renderAnnouncementCard(a) {
    if (!a) {
        return `<section class="og-panel og-ann is-empty">
            <div class="og-eyebrow">Recente aankondiging</div>
            <p class="og-faint">Nog niets aangekondigd. De leider plaatst er een
                met <code>+organnounce</code>.</p>
        </section>`;
    }
    return `<section class="og-panel og-ann">${CORRUPT}
        <div class="og-eyebrow">Recente aankondiging</div>
        <div class="og-ann-head">
            ${userChip(a.author_id, "leader")}
            <time class="og-faint og-mono">${escapeHtml(shortTime(a.created_at))}</time>
        </div>
        <p class="og-ann-body">${escapeHtml(a.body)}</p>
    </section>`;
}

function renderTreasurySummary(org) {
    const c = org.campaign;
    const pctVol = c ? c.percent : 0;
    return `<section class="og-panel og-treas">${CORRUPT}
        <div class="og-eyebrow">Treasury</div>
        <div class="og-treas-row">
            <div class="og-treas-figure">
                <span class="og-treas-amount og-mono"
                      data-count="${Number(org.treasury.balance) || 0}">${num(org.treasury.balance)}</span>
                <span class="og-faint">shards</span>
            </div>
            ${donut(pctVol)}
        </div>
        <div class="og-treas-goal">
            <span class="og-faint">Doel: volgende upgrade</span>
            <span class="og-mono">${c ? num(c.goal) : "—"}</span>
        </div>
        ${meter(pctVol, c && c.full)}
    </section>`;
}

/** De donut. Eén conic-gradient, geen SVG en geen library. */
function donut(percent) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    return `<div class="og-donut" style="--fill:${p}"><span class="og-mono">${p}%</span></div>`;
}



/* ---- feed -------------------------------------------------------- */
/**
 * De feed, in twee kolommen zoals de rest.
 *
 * Links het gesprek, rechts wat je nodig hebt om eraan mee te doen: waar je
 * praat en wat de regels zijn. Dat tweede is geen decoratie - het is de plek
 * waar staat dat posten uitstaat, en die zin komt van de SERVER en niet uit dit
 * bestand.
 */
function renderFeed(s) {
    const f = { ...s.feed, reported: s.reported,
                mijnAvatar: mijnAvatar(s) };
    const perOuder = new Map();
    (f.posts || []).forEach((p) => {
        const sleutel = p.reply_to || 0;
        if (!perOuder.has(sleutel)) perOuder.set(sleutel, []);
        perOuder.get(sleutel).push(p);
    });
    const wortels = perOuder.get(0) || [];

    const lijst = wortels
        .map((p) => renderPost(p, f, perOuder.get(p.id) || [])).join("");

    return `<div class="og-split">
        <div class="og-col og-col-main">
            ${f.can_post ? renderComposer(s) : renderPostingOff(f)}
            ${wortels.length ? `<ul class="og-feed">${lijst}</ul>` : empty(
                "Nog geen gesprek",
                f.can_post
                    ? "Jij mag als eerste iets zeggen. Alles wat hier staat is "
                      + "zichtbaar voor je hele organisatie."
                    : "Er is hier nog niets gezegd.")}
        </div>
        <div class="og-col og-col-side">
            ${renderFeedContext(s, f)}
        </div>
    </div>`;
}

/**
 * Waar de composer hoort te staan als er niet gepost mag worden.
 *
 * De tekst komt uit `post_note`, dus de app verzint geen reden. Er waren er al
 * twee - "je bent geen lid" en "posten staat uit" - en een derde komt er zonder
 * dat dit bestand verandert.
 */
function renderPostingOff(f) {
    return `<section class="og-panel og-composer is-off">${CORRUPT}
        <div class="og-eyebrow">Praten</div>
        <p class="og-off">
            <span class="og-off-mark">\u25A0</span>
            ${escapeHtml(f.post_note || "Alleen leden van deze organisatie "
                + "kunnen hier posten.")}
        </p>
        <p class="og-faint">Lezen, melden en verwijderen blijven werken.</p>
    </section>`;
}

function renderFeedContext(s, f) {
    const org = s.data.overview || {};
    const c = org.campaign;
    return `<section class="og-panel">${CORRUPT}
        <div class="og-eyebrow">Waar je praat</div>
        <p class="og-thread">
            <span class="og-thread-mark">\u25B8</span>
            ${s.campaignId && c
                ? `de draad van <strong>${escapeHtml(c.title || "de campagne")}</strong>`
                : "de algemene draad van je organisatie"}
        </p>
        <div class="og-eyebrow">Huisregels</div>
        <ul class="og-rules">
            <li>Maximaal ${num(BODY_LIMIT)} tekens per bericht.</li>
            <li>Een paar seconden tussen twee berichten.</li>
            <li>Meld wat niet hoort — dat telt, en de leiding ziet het.</li>
            ${f.can_moderate ? `<li class="og-rule-mod">Jij mag berichten van
                anderen verwijderen.</li>` : ""}
        </ul>
    </section>`;
}

function reportButton(p, f) {
    return f.reported && f.reported[p.id]
        ? `<span class="og-reported og-mono">Gemeld</span>`
        : `<button data-org-report="${p.id}">Melden</button>`;
}

/**
 * Een bericht, met zijn antwoorden EEN niveau diep.
 *
 * De "open vraag"-tag komt niet uit een veld dat de backend stuurt - dat veld
 * bestaat niet. Hij wordt afgeleid uit de tekst: een bericht van de leiding dat
 * eindigt op een vraagteken IS een open vraag, en dat is precies waar de tag in
 * de mockup staat. Afleiden is hier eerlijker dan een leeg veld tonen, en het
 * kost geen route.
 */
function renderPost(p, f, antwoorden) {
    const magWeg = p.mine || f.can_moderate;
    const vraag = isOpenVraag(p);
    return `<li class="og-post${p.mine ? " is-mine" : ""}" data-post="${p.id}">
        <div class="og-post-head">
            ${userChip(p.author_id, p.author_rank, "", p.mine ? f.mijnAvatar : "")}
            ${vraag ? `<span class="og-tag">Open vraag</span>` : ""}
            <time class="og-post-time og-mono">${escapeHtml(shortTime(p.created_at))}</time>
        </div>
        <div class="og-post-body">${escapeHtml(p.body)}</div>
        <div class="og-post-tools">
            ${f.can_post ? `<button data-org-reply="${p.id}">Antwoord</button>` : ""}
            ${reportButton(p, f)}
            ${magWeg ? `<button data-org-delete="${p.id}">Verwijder</button>` : ""}
            ${antwoorden.length ? `<span class="og-chip og-mono">
                <i>\u25AD</i>${antwoorden.length}</span>` : ""}
            ${p.reports ? `<span class="og-chip is-warn og-mono">
                <i>\u25B3</i>${p.reports}</span>` : ""}
        </div>
        ${antwoorden.length ? `<ul class="og-replies">${
            antwoorden.map((r) => renderReply(r, f)).join("")}</ul>` : ""}
    </li>`;
}

function renderReply(r, f) {
    return `<li class="og-post is-reply" data-post="${r.id}">
        <div class="og-post-head">
            ${userChip(r.author_id, r.author_rank, "", r.mine ? f.mijnAvatar : "")}
            <time class="og-post-time og-mono">${escapeHtml(shortTime(r.created_at))}</time>
        </div>
        <div class="og-post-body">${escapeHtml(r.body)}</div>
        <div class="og-post-tools">
            ${reportButton(r, f)}
            ${(r.mine || f.can_moderate)
                ? `<button data-org-delete="${r.id}">Verwijder</button>` : ""}
            ${r.reports ? `<span class="og-chip is-warn og-mono">
                <i>\u25B3</i>${r.reports}</span>` : ""}
        </div>
    </li>`;
}

/**
 * Leiding + een vraagteken = een vraag die openstaat.
 *
 * Op de laatste REGEL kijken was de eerste vorm, en die miste precies het
 * bericht uit de mockup: daar staat de vraag in het midden en is de laatste zin
 * "laat je stem horen in Discord". Een vraag is waar hij staat, niet waar hij
 * eindigt.
 */
function isOpenVraag(p) {
    const leiding = p.author_rank === "leader" || p.author_rank === "council";
    return Boolean(leiding && !p.reply_to && (p.body || "").includes("?"));
}

function renderComposer(s) {
    const over = BODY_LIMIT - (s.draft || "").length;
    const bijna = over <= 60;
    return `<form class="og-panel og-composer" data-org-composer>${CORRUPT}
        ${s.replyTo ? `<div class="og-replying og-mono">
            <span>Antwoord op #${s.replyTo}</span>
            <button type="button" data-org-cancel-reply>annuleer</button></div>` : ""}
        <div class="og-composer-row">
            <img class="og-avatar" alt=""
                 src="${escapeHtml(avatar(s.viewer ? s.viewer.user_id : "0",
                                          mijnAvatar(s)))}">
            <textarea data-org-draft maxlength="${BODY_LIMIT}"
                placeholder="Wat wil je delen met je organisatie?"
                ${s.posting ? "disabled" : ""}>${escapeHtml(s.draft || "")}</textarea>
        </div>
        <div class="og-composer-foot">
            <span class="og-count og-mono${over < 0 ? " is-over" : bijna ? " is-near" : ""}"
                  >${over}</span>
            <button type="submit" ${s.posting ? "disabled" : ""}>Plaatsen</button>
        </div>
        ${s.postError ? `<p class="og-error">${escapeHtml(s.postError)}</p>` : ""}
    </form>`;
}

function shortTime(iso) {
    if (!iso) return "";
    const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString([], { month: "short", day: "numeric",
                                  hour: "2-digit", minute: "2-digit" });
}

/* ---- treasury ---------------------------------------------------- */
/**
 * De treasury: wat de organisatie heeft, wat het doel is, en wie het bracht.
 *
 * Links het geld, rechts de rente en de bank. De transactielijst is AFGELEID
 * uit de donaties van de lopende campagne - er is geen transactieroute, en die
 * bouwen zou een backendwijziging zijn in een visuele ronde. Wat er staat is
 * dus waar; er staat alleen niet alles.
 */
function renderTreasury(s) {
    const d = s.data.treasury || s.data.overview_env || {};
    const org = d.item || s.data.overview;
    if (!org || !org.treasury) {
        return empty("Nog geen treasury",
            "Zodra je organisatie een campagne afrondt komt hier geld te staan.");
    }
    const c = org.campaign;
    const pctVol = c ? c.percent : 0;
    const rente = d.interest || {};

    return `<div class="og-split">
        <div class="og-col og-col-main">
            <section class="og-panel og-treas">${CORRUPT}
                <div class="og-eyebrow">Saldo</div>
                <div class="og-treas-row">
                    <div class="og-treas-figure">
                        <span class="og-treas-amount og-mono"
                              >${num(org.treasury.balance)}</span>
                        <span class="og-faint">shards</span>
                    </div>
                    ${donut(pctVol)}
                </div>
                <div class="og-treas-goal">
                    <span class="og-faint">${c ? "Doel: volgende upgrade"
                        : "Geen doel — er loopt geen campagne"}</span>
                    <span class="og-mono">${c ? num(c.goal) : "—"}</span>
                </div>
                ${meter(pctVol, c && c.full)}
                ${c && c.full ? `<p class="og-flag">Pot is vol — de Leader kan nu
                    kopen.</p>` : ""}
            </section>
            ${renderDonors(c)}
            ${renderTransactions(c)}
        </div>
        <div class="og-col og-col-side">
            ${renderBank(org)}
            ${renderRate(rente, "Bankrente van je organisatie")}
        </div>
    </div>`;
}

function renderDonors(c) {
    const donateurs = (c && c.donors) || [];
    if (!donateurs.length) {
        return `<section class="og-panel">${CORRUPT}
            <div class="og-eyebrow">Top-donateurs</div>
            <p class="og-faint">Nog niemand heeft gedoneerd. Met
                <code>+org donate</code> in Discord sta jij hier als eerste.</p>
        </section>`;
    }
    const top = Math.max(1, ...donateurs.map((d) => Number(d.amount) || 0));
    return `<section class="og-panel">${CORRUPT}
        <div class="og-eyebrow">Top-donateurs — deze campagne</div>
        <ol class="og-donors">${donateurs.map((d, i) => `
            <li class="og-donor">
                <span class="og-donor-pos og-mono">${i + 1}</span>
                <img class="og-avatar" alt="" src="${escapeHtml(avatar(d.user_id))}">
                <span class="og-donor-id og-mono">${escapeHtml(shortId(d.user_id))}</span>
                <span class="og-donor-bar"><i style="--fill:${
                    Math.max(4, Math.round((Number(d.amount) || 0) / top * 100))
                }%"></i></span>
                <span class="og-donor-amount og-mono">${num(d.amount)}</span>
            </li>`).join("")}</ol>
    </section>`;
}

/**
 * Recente transacties.
 *
 * AFGELEID uit wat er wel is: elke donatie aan de lopende campagne is een plus,
 * en wat uit de organisatiebank is doorgeschoven staat er als eigen regel bij.
 * Een echte grootboeklijst vraagt een route die er niet is - liever vijf regels
 * die kloppen dan tien die verzonnen zijn.
 */
function renderTransactions(c) {
    if (!c) {
        return `<section class="og-panel">${CORRUPT}
            <div class="og-eyebrow">Recente bewegingen</div>
            <p class="og-faint">Er is nog niets bewogen. Bewegingen verschijnen
                zodra er een campagne loopt.</p>
        </section>`;
    }
    const rijen = (c.donors || []).map((d) => ({
        soort: "in", label: `Donatie van ${shortId(d.user_id)}`, bedrag: d.amount
    }));
    if (Number(c.from_bank) > 0) {
        rijen.push({ soort: "in", label: "Overboeking uit de org-bank",
                     bedrag: c.from_bank });
    }
    if (!rijen.length) {
        return `<section class="og-panel">${CORRUPT}
            <div class="og-eyebrow">Recente bewegingen</div>
            <p class="og-faint">Nog geen bewegingen op deze campagne.</p>
        </section>`;
    }
    return `<section class="og-panel">${CORRUPT}
        <div class="og-eyebrow">Recente bewegingen</div>
        <ul class="og-ledger">${rijen.map((r) => `
            <li class="og-ledger-row is-${r.soort}">
                <span class="og-ledger-sign og-mono">${r.soort === "in" ? "+" : "−"}</span>
                <span class="og-ledger-label">${escapeHtml(r.label)}</span>
                <span class="og-ledger-amount og-mono">${num(r.bedrag)}</span>
            </li>`).join("")}</ul>
        <p class="og-faint">Alleen de bewegingen van de lopende campagne. De
            volledige historie staat in #treasury.</p>
    </section>`;
}

function renderBank(org) {
    const cr = org.credits || { earned: 0, spent: 0, available: 0 };
    return `<section class="og-panel">${CORRUPT}
        <div class="og-eyebrow">Org-bank</div>
        <div class="og-bank-row">
            <span class="og-bank-amount og-mono">${num(org.treasury.bank_balance)}</span>
            <span class="og-faint">shards van de leden</span>
        </div>
        <p class="og-faint">Alleen de Leader schuift hier iets uit door, en nooit
            meer dan de campagne nog nodig heeft.</p>
        <div class="og-eyebrow">Credits</div>
        <div class="og-credits">
            ${creditCell("Beschikbaar", cr.available, true)}
            ${creditCell("Verdiend", cr.earned)}
            ${creditCell("Uitgegeven", cr.spent)}
        </div>
        <p class="og-faint">Eén afgeronde campagne is één credit.</p>
    </section>`;
}

function creditCell(label, waarde, nadruk) {
    return `<div class="og-credit${nadruk ? " is-main" : ""}">
        <span class="og-credit-value og-mono">${num(waarde)}</span>
        <span class="og-credit-label">${escapeHtml(label)}</span>
    </div>`;
}

/** De rentesplitsing. Eén component, twee gebruikers: treasury en jouw kaart. */
function renderRate(i, kop) {
    return `<section class="og-panel">${CORRUPT}
        <div class="og-eyebrow">${escapeHtml(kop)}</div>
        <div class="og-rate">
            ${rateRow("Basisrente", i.base)}
            ${rateRow("Org bonus", i.org, true)}
            ${rateRow("Rank bonus", i.rank, true)}
            ${rateRow("Research bonus", i.upgrades, true)}
            <div class="og-rate-row is-total">
                <span>Totaal</span><span class="og-mono">${pct(i.total)}%</span></div>
        </div>
        <p class="og-faint">${i.enabled
            ? `Uitbetaald elke ${num(i.every_days)} dagen op je banksaldo.`
            : "Rente staat nog uit."}</p>
    </section>`;
}

function rateRow(label, waarde, plus) {
    const v = Number(waarde) || 0;
    return `<div class="og-rate-row">
        <span>${escapeHtml(label)}</span>
        <span class="og-mono">${plus && v > 0 ? "+" : ""}${pct(v)}%</span>
    </div>`;
}

/* ---- upgrades ----------------------------------------------------- */
/**
 * De catalogus, met de categorieën als tabs.
 *
 * ATTACK staat er leeg en op slot in. Dat is geen decoratie: een leider die
 * niet ziet dat er een hele tak aan komt, denkt dat de catalogus af is. De
 * categorieën komen uit de config, dus v3 hoeft alleen het slotje weg te halen.
 */
function renderUpgrades(s) {
    const d = s.data.upgrades || {};
    const u = d.item;
    if (!u) return empty("Nog geen research", "Er is nog niets te onderzoeken.");
    if (!u.items.length) {
        return `<div class="og-split"><div class="og-col og-col-main">
            ${empty("De catalogus is leeg",
                "Zodra er upgrades zijn verschijnen ze hier. Credits verdien je "
                + "door campagnes af te ronden.")}
        </div><div class="og-col og-col-side">
            ${renderCreditPanel(u.credits, u.enabled)}
        </div></div>`;
    }

    const perCat = {};
    u.items.forEach((it) => { (perCat[it.category] = perCat[it.category] || []).push(it); });
    const cats = u.categories.length ? u.categories
        : Object.keys(perCat).map((k) => ({ key: k, name: k }));
    const actief = s.upgradeCat && perCat[s.upgradeCat] ? s.upgradeCat
        : (cats.find((c) => !c.locked && (perCat[c.key] || []).length) || cats[0]).key;
    const items = perCat[actief] || [];

    return `<div class="og-split">
        <div class="og-col og-col-main">
            <nav class="og-cats">${cats.map((c) => {
                const leeg = !(perCat[c.key] || []).length;
                return `<button class="og-cat${c.key === actief ? " is-active" : ""}${
                    leeg ? " is-locked" : ""}" data-org-cat="${escapeHtml(c.key)}"
                    ${leeg ? "disabled" : ""}>
                    ${escapeHtml(c.name || c.key)}
                    ${leeg ? `<span class="og-lock">▮</span>` : ""}
                </button>`;
            }).join("")}</nav>
            ${items.length ? `<ul class="og-upgrades">${
                items.map((it) => renderUpgrade(it, u)).join("")}</ul>`
                : empty("Komt in v3",
                        "Deze tak bestaat al in de interface maar nog niet in het "
                        + "spel. Hij verschijnt zodra hij aan gaat.")}
        </div>
        <div class="og-col og-col-side">
            ${renderCreditPanel(u.credits, u.enabled)}
        </div>
    </div>`;
}

function renderCreditPanel(cr, aan) {
    const c = cr || { earned: 0, spent: 0, available: 0 };
    return `<section class="og-panel">${CORRUPT}
        <div class="og-eyebrow">Credits</div>
        <div class="og-credits">
            ${creditCell("Beschikbaar", c.available, true)}
            ${creditCell("Verdiend", c.earned)}
            ${creditCell("Uitgegeven", c.spent)}
        </div>
        <p class="og-faint">Eén afgeronde campagne is één credit. Een campagne
            die faalt levert er geen op.</p>
        ${aan ? "" : `<p class="og-off"><span class="og-off-mark">■</span>
            Research staat nog uit.</p>`}
        <p class="og-faint">Kiezen en kopen doet de Leader in #command.</p>
    </section>`;
}

function renderUpgrade(it, u) {
    const pips = [];
    for (let i = 0; i < it.max_level; i += 1) {
        pips.push(`<i class="${i < it.level ? "is-on" : ""}"></i>`);
    }
    const genoeg = !it.maxed && u.enabled
        && Number(u.credits.available) >= Number(it.next_price);
    const deel = it.maxed ? 100 : Math.min(100, Math.round(
        (Number(u.credits.available) || 0) / Math.max(1, Number(it.next_price)) * 100));
    return `<li class="og-upgrade${genoeg ? " is-ready" : ""}">${CORRUPT}
        <div class="og-upgrade-head">
            <span class="og-upgrade-icon">◈</span>
            <span class="og-upgrade-name">${escapeHtml(it.name)}</span>
            <span class="og-upgrade-level og-mono">Level ${it.level} / ${it.max_level}</span>
        </div>
        <p class="og-upgrade-blurb">${escapeHtml(it.blurb || "")}</p>
        ${it.effect ? `<p class="og-upgrade-effect">
            <span class="og-faint">Effect</span>
            <span>${escapeHtml(it.effect)}</span></p>` : ""}
        <div class="og-pips">${pips.join("")}</div>
        ${it.maxed ? `<p class="og-upgrade-max og-mono">Maximaal niveau bereikt</p>` : `
            <div class="og-upgrade-cost">
                <span class="og-faint">Kost volgend level</span>
                <span class="og-mono">${num(it.next_price)} credits</span>
            </div>
            ${meter(deel, genoeg)}`}
        ${genoeg ? `<p class="og-flag">Beschikbaar — de Leader kiest in Discord.</p>` : ""}
    </li>`;
}

/* ---- verkiezing --------------------------------------------------- */
/**
 * Twee toestanden uit één component.
 *
 * Gesloten toont de zittende leider en met welke uitslag; open toont de
 * kandidaten met hun stemmen. Het stemmen zelf gebeurt in Discord, en dat staat
 * op het scherm waar iemand anders naar een knop zou zoeken.
 */
function renderElection(s) {
    const e = (s.data.election || {}).item;
    if (!e) {
        return `<div class="og-split"><div class="og-col og-col-main">
            ${empty("Nog geen verkiezing",
                "Elke termijn gaat de top op contributie automatisch op de "
                + "kandidatenlijst. Er is niets om je voor aan te melden.")}
        </div><div class="og-col og-col-side">${renderBallotNote(null)}</div></div>`;
    }
    const totaal = e.candidates.reduce((n, c) => n + (Number(c.votes) || 0), 0);
    const winnaar = e.candidates.find((c) => c.user_id === e.winner_user_id);
    return `<div class="og-split">
        <div class="og-col og-col-main">
            ${e.open ? renderBallot(e, totaal) : renderIncumbent(e, winnaar, totaal)}
        </div>
        <div class="og-col og-col-side">
            ${renderBallotNote(e)}
        </div>
    </div>`;
}

function renderIncumbent(e, winnaar, totaal) {
    const stemmen = winnaar ? Number(winnaar.votes) || 0 : 0;
    const deel = totaal ? Math.round(stemmen / totaal * 100) : 0;
    const dagen = dagenSinds(e.closed_at);
    return `<section class="og-panel og-leader">${CORRUPT}
        <div class="og-eyebrow">Huidige leider — termijn ${num(e.term)}</div>
        <div class="og-leader-row">
            <img class="og-leader-avatar" alt=""
                 src="${escapeHtml(avatar(e.winner_user_id))}">
            <div class="og-leader-name">
                <strong>${escapeHtml(shortId(e.winner_user_id))}</strong>
                <span class="og-badge">Leader</span>
                <p class="og-faint">${dagen === null ? "gekozen"
                    : `sinds ${num(dagen)} ${dagen === 1 ? "dag" : "dagen"}`}</p>
            </div>
        </div>
        <div class="og-leader-result">
            <span class="og-mono">${num(stemmen)} / ${num(totaal)} stemmen</span>
            <span class="og-mono og-leader-pct">${deel}%</span>
        </div>
        ${meter(deel)}
        <p class="og-closed og-mono">Gesloten</p>
    </section>`;
}

function renderBallot(e, totaal) {
    const dagen = dagenTot(e.closes_at);
    return `<section class="og-panel">${CORRUPT}
        <div class="og-ballot-head">
            <span class="og-eyebrow">Kandidaten — termijn ${num(e.term)}</span>
            <span class="og-term-left og-mono">${dagen === null ? "open"
                : `nog ${num(dagen)} ${dagen === 1 ? "dag" : "dagen"}`}</span>
        </div>
        <ol class="og-cands">${e.candidates.map((c, i) => {
            const stemmen = Number(c.votes) || 0;
            const deel = totaal ? Math.round(stemmen / totaal * 100) : 0;
            return `<li class="og-cand">
                <span class="og-rank-pos og-mono">${i + 1}</span>
                <img class="og-avatar" alt="" src="${escapeHtml(avatar(c.user_id))}">
                <div class="og-cand-who">
                    <span class="og-mono">${escapeHtml(shortId(c.user_id))}</span>
                    <span class="og-faint og-mono">${num(c.contribution)}</span>
                </div>
                <span class="og-cand-bar"><i style="--fill:${deel}%"></i></span>
                <span class="og-cand-pct og-mono">${deel}%</span>
            </li>`;
        }).join("")}</ol>
    </section>`;
}

function renderBallotNote(e) {
    return `<section class="og-panel">${CORRUPT}
        <div class="og-eyebrow">Stemmen doe je in Discord</div>
        <p class="og-faint">Het stembiljet staat in <code>#announcements</code>.
            Dit scherm is het venster erop — hier valt niets te klikken, en dat is
            met opzet: één stembus.</p>
        ${e && e.open ? `<p class="og-faint">Je mag je stem wijzigen zolang de
            bus open is.</p>` : ""}
        <div class="og-eyebrow">Hoe je op de lijst komt</div>
        <p class="og-faint">Automatisch. De hoogste contributies van de termijn
            staan op het biljet — er is niets om je voor aan te melden.</p>
    </section>`;
}

function dagenSinds(iso) {
    if (!iso) return null;
    const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
    if (isNaN(d.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

/* ---- leden -------------------------------------------------------- */
/**
 * Gegroepeerd op rang, hoogste eerst.
 *
 * De volgorde komt uit `rank_index` dat de backend meestuurt, niet uit een
 * lijst hier: de rangorde staat in het servertemplate en hoort op één plek te
 * leven.
 */
function renderMembers(s) {
    const d = s.data.members || {};
    const leden = d.items || [];
    if (!leden.length) {
        return empty("Nog geen leden",
            "Zodra spelers zich aansluiten staan ze hier, op rang gegroepeerd.");
    }
    const groepen = new Map();
    leden.forEach((m) => {
        if (!groepen.has(m.rank)) groepen.set(m.rank, []);
        groepen.get(m.rank).push(m);
    });
    const volgorde = [...groepen.entries()].sort(
        (a, b) => (b[1][0].rank_index || 0) - (a[1][0].rank_index || 0));

    const leiderId = (s.data.overview || {}).leader_id;
    const helft = Math.ceil(volgorde.length / 2);
    const kolom = (paar) => paar.map(([rang, rijen]) => `
        <section class="og-panel">${CORRUPT}
            <div class="og-group-head">
                <span class="og-eyebrow">${escapeHtml(RANK_LABEL[rang] || rang)}</span>
                <span class="og-group-count og-mono">${rijen.length}</span>
            </div>
            <ul class="og-members">${rijen.map((m) => `
                <li class="og-member">
                    <img class="og-avatar" alt="" src="${escapeHtml(avatar(m.user_id,
                        m.user_id === (s.viewer || {}).user_id ? mijnAvatar(s) : ""))}">
                    <span class="og-member-id og-mono">${escapeHtml(shortId(m.user_id))}</span>
                    ${String(m.user_id) === String(leiderId)
                        ? `<span class="og-crown" title="Leader">♔</span>` : ""}
                    <span class="og-member-contrib og-mono">${num(m.contribution)}</span>
                    <span class="og-dot${m.active ? " is-on" : ""}"
                          title="${m.active ? "actief deze termijn" : "niet actief"}"></span>
                </li>`).join("")}</ul>
        </section>`).join("");

    return `<div class="og-split">
        <div class="og-col og-col-main">${kolom(volgorde.slice(0, helft))}</div>
        <div class="og-col og-col-side">${kolom(volgorde.slice(helft))}
            <section class="og-panel">${CORRUPT}
                <div class="og-eyebrow">Rang volgt contributie</div>
                <p class="og-faint">De eerste rangen verdien je vanzelf. Officer en
                    hoger wijst de Leader aan. Het bolletje betekent: deze termijn
                    iets bijgedragen.</p>
            </section>
        </div>
    </div>`;
}

/* ---- jouw kaart --------------------------------------------------- */
function renderCard(s) {
    const d = (s.data.card || {}).item;
    const v = s.viewer;
    if (!d || !v) return empty("Nog geen kaart", "Je gegevens laden nog.");
    const orde = d.rank_order || [];
    const idx = orde.indexOf(v.rank);
    const leden = ((s.data.members || {}).items) || [];
    const plek = leden.length
        ? leden.findIndex((m) => String(m.user_id) === String(v.user_id)) + 1 : 0;

    return `<div class="og-split">
        <div class="og-col og-col-main">
            <section class="og-panel">${CORRUPT}
                <div class="og-you">
                    <img class="og-leader-avatar" alt=""
                         src="${escapeHtml(avatar(v.user_id, mijnAvatar(s)))}">
                    <div class="og-leader-name">
                        <strong>${escapeHtml(shortId(v.user_id))}</strong>
                        <span class="og-badge">${escapeHtml(RANK_LABEL[v.rank] || v.rank)}</span>
                        ${String(v.user_id) === String(d.leader_id)
                            ? `<p class="og-faint">Jij leidt deze organisatie.</p>`
                            : `<p class="og-faint">Lid van deze organisatie.</p>`}
                    </div>
                </div>
                <div class="og-ident-facts og-you-facts">
                    ${fact("Deze termijn", num(v.season_contribution))}
                    ${fact("Levenslang", num(v.contribution))}
                    ${fact("In de org", plek ? `#${plek} / ${num(leden.length)}` : "—")}
                </div>
                <div class="og-eyebrow">Rang</div>
                <div class="og-ladder">${orde.map((r, n) => `
                    <span class="og-rung${n <= idx ? " is-on" : ""}"
                          title="${escapeHtml(RANK_LABEL[r] || r)}"></span>`).join("")}
                </div>
                <p class="og-faint">${idx >= 0 && idx < orde.length - 1
                    ? `Volgende rang: ${escapeHtml(RANK_LABEL[orde[idx + 1]] || orde[idx + 1])}`
                    : "Hoogste rang."}</p>
            </section>
            ${renderCipher(d)}
        </div>
        <div class="og-col og-col-side">
            ${renderRate(d.interest || {}, "Jouw bankrente")}
            ${renderCreditPanel(d.credits, true)}
        </div>
    </div>`;
}

function renderCipher(d) {
    return `<section class="og-panel">${CORRUPT}
        <div class="og-eyebrow">Cipher-saldo</div>
        <div class="og-cipher">
            <span class="og-cipher-mark">◆</span>
            <span class="og-cipher-value og-mono">${num(d.cipher || 0)}</span>
            <span class="og-faint">cipher</span>
        </div>
        <p class="og-faint">Premiumvaluta uit de kwartaaluitkering. Telt niet mee
            in je net worth.</p>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* mount                                                               */
/* ------------------------------------------------------------------ */
export function mountOrgApp(runtime, windowState, element) {
    const view = windowState.view;
    view.cleanups = [];
    const app = element.querySelector(".vm-orgapp");
    if (!app) return;
    view.appElement = app;
    // `element` IS het vensterelement (`mountWindow` geeft de hele section
    // door), dus hier kan de app zijn eigen lijst inkleuren.
    view.windowElement = element.classList
        && element.classList.contains("vm-window") ? element : null;
    paintTheme(runtime, windowState);

    view.refresh = () => {
        // The draft survives a redraw. A poll that lands while somebody is
        // typing must not eat the sentence.
        const veld = app.querySelector("[data-org-draft]");
        if (veld) windowState.appState.draft = veld.value;
        const pos = veld ? veld.selectionStart : null;
        app.innerHTML = renderOrgInner(runtime, windowState);
        const nieuw = app.querySelector("[data-org-draft]");
        if (nieuw && document.activeElement === veld) {
            nieuw.focus();
            if (pos !== null) nieuw.setSelectionRange(pos, pos);
        }
    };

    const onClick = (event) => handleClick(runtime, windowState, event);
    const onSubmit = (event) => {
        if (event.target && event.target.hasAttribute("data-org-composer")) {
            event.preventDefault();
            submitPost(runtime, windowState);
        }
    };
    const onInput = (event) => {
        if (event.target && event.target.hasAttribute("data-org-draft")) {
            windowState.appState.draft = event.target.value;
            const teller = app.querySelector(".vm-orgapp-count");
            if (teller) {
                const left = BODY_LIMIT - event.target.value.length;
                teller.textContent = String(left);
                teller.classList.toggle("is-over", left < 0);
            }
        }
    };
    app.addEventListener("click", onClick);
    app.addEventListener("submit", onSubmit);
    app.addEventListener("input", onInput);
    view.cleanups.push(() => app.removeEventListener("click", onClick));
    view.cleanups.push(() => app.removeEventListener("submit", onSubmit));
    view.cleanups.push(() => app.removeEventListener("input", onInput));

    load(runtime, windowState, true);

    const timer = setInterval(() => {
        // Only while this window is on top and the tab is visible. A background
        // window polling every fifteen seconds is a request nobody reads.
        if (document.hidden) return;
        // `runtime.windows` is OPENVOLGORDE en geen z-volgorde: `focusWindow`
        // verhoogt alleen `windowState.z` en laat de array met rust. Op de
        // laatste index kijken betekende dus: open de Terminal en de feed
        // ververst nooit meer, ook niet als je terugklikt.
        const actief = runtime.activeWindowId
            ? runtime.activeWindowId === windowState.id
            : true;
        const interval = windowState.appState.tab === "feed" ? FEED_POLL_MS : DATA_POLL_MS;
        const laatst = windowState.appState.fetchedAt[windowState.appState.tab] || 0;
        if (actief && (Date.now() - laatst) >= interval) load(runtime, windowState, false);
    }, 5000);
    view.cleanups.push(() => clearInterval(timer));
}

export function unmountOrgApp(runtime, windowState) {
    const view = windowState.view || {};
    // De vensterkleur weer weghalen: het element kan hergebruikt worden en een
    // achtergebleven accent zou een andere app inkleuren.
    if (view.windowElement) {
        view.windowElement.style.removeProperty("--vm-window-accent");
        view.windowElement.style.removeProperty("--vm-window-glow");
    }
    (view.cleanups || []).forEach((fn) => { try { fn(); } catch (e) { /* leeg */ } });
    view.cleanups = [];
}

function handleClick(runtime, windowState, event) {
    const s = windowState.appState;
    const cat = event.target.closest("[data-org-cat]");
    if (cat) {
        s.upgradeCat = cat.getAttribute("data-org-cat");
        windowState.view.refresh();
        return;
    }
    const tab = event.target.closest("[data-org-tab]");
    if (tab) {
        s.tab = tab.getAttribute("data-org-tab");
        s.postError = "";
        windowState.view.refresh();
        load(runtime, windowState, true);
        return;
    }
    const reply = event.target.closest("[data-org-reply]");
    if (reply) {
        s.replyTo = Number(reply.getAttribute("data-org-reply"));
        windowState.view.refresh();
        return;
    }
    if (event.target.closest("[data-org-cancel-reply]")) {
        s.replyTo = null;
        windowState.view.refresh();
        return;
    }
    const report = event.target.closest("[data-org-report]");
    if (report) {
        const id = Number(report.getAttribute("data-org-report"));
        // IN DE STATE en niet alleen in de DOM: de eerstvolgende poll tekent
        // opnieuw, en dan stond de knop weer op "Report" alsof er niets was
        // gebeurd - waarna iemand nog een keer drukt op een melding die al
        // geteld is.
        s.reported[id] = true;
        gatewayClient.request(`/api/org/feed/${id}/report`, {
            method: "POST", body: { reason: "" }
        }).then(() => load(runtime, windowState, true));
        windowState.view.refresh();
        return;
    }
    const del = event.target.closest("[data-org-delete]");
    if (del) {
        const id = del.getAttribute("data-org-delete");
        del.disabled = true;
        gatewayClient.request(`/api/org/feed/${id}`, { method: "DELETE" })
            .then(() => load(runtime, windowState, true));
    }
}

/* ------------------------------------------------------------------ */
/* data                                                                */
/* ------------------------------------------------------------------ */
const ENDPOINT = {
    // HET OVERZICHT LEEST DE TREASURY-ROUTE, en dat is geen slordigheid: die
    // geeft de overview-payload PLUS de aankondigingen en de rentesplitsing in
    // een antwoord, en het overzichtsscherm toont de laatste aankondiging. Een
    // eigen route ervoor zou een backendwijziging zijn voor data die al over de
    // draad komt.
    overview: "/api/org/treasury",
    feed: "/api/org/feed",
    treasury: "/api/org/treasury",
    upgrades: "/api/org/upgrades",
    members: "/api/org/members",
    election: "/api/org/election",
    card: "/api/org/card"
};

function load(runtime, windowState, force) {
    const s = windowState.appState;
    const tab = s.tab;
    if (!force && s.inflight) return;
    s.inflight = true;

    const eerste = !s.viewer && !s.standings.length;
    let pad = ENDPOINT[tab] || ENDPOINT.overview;
    if (tab === "feed" && s.campaignId) pad += `?campaign_id=${s.campaignId}`;
    const taken = [gatewayClient.request(pad)];
    if (eerste || tab === "overview") taken.push(gatewayClient.request("/api/org/standings"));
    // De feed heeft de lopende campagne nodig om aan te hangen, en die staat in
    // het overzicht. Een keer ophalen zodra we hem nog niet kennen.
    const wilCampagne = tab === "feed" && s.campaignId === null && !s.campagneGezocht;
    if (wilCampagne) {
        s.campagneGezocht = true;
        gatewayClient.request(ENDPOINT.overview).then((r) => {
            const item = r.ok && (r.data || {}).item;
            if (item) {
                s.data.overview = item;
                if (item.campaign) {
                    s.campaignId = item.campaign.id;
                    load(runtime, windowState, true);
                }
            }
        });
    }

    Promise.all(taken).then(([hoofd, board]) => {
        s.inflight = false;
        s.loading = false;
        if (!hoofd.ok) {
            // 401 is not an error to shout about - it is "not logged in", and the
            // outsider screen is the honest answer to that.
            s.error = hoofd.status === 401 ? "" : (hoofd.error || "backend unreachable");
            s.viewer = hoofd.status === 401 ? null : s.viewer;
        } else {
            const d = hoofd.data || {};
            s.error = "";
            if (d.viewer !== undefined) s.viewer = d.viewer;
            if (tab === "feed") {
                s.feed = d.item || { posts: [], can_post: false, can_moderate: false };
            }
            s.data[tab] = d;
            if (tab === "overview" && d.item) {
                // TWEE DINGEN ONDER EEN SLEUTEL. `s.data.overview` is de
                // uitgepakte organisatie omdat elke render die verwacht; de
                // envelope eromheen draagt de aankondigingen en de rente, en
                // die zou hier anders verdwijnen.
                s.data.overview = d.item;
                s.data.overview_env = d;
            }
            // DE FEED VOLGT DE LOPENDE CAMPAGNE. Zonder dit blijft `campaignId`
            // altijd null, hangt elke post aan de algemene draad, en is de
            // campagnefeed - inclusief het archiveren dat erbij hoort - een
            // tabel-kolom waar niets ooit in komt.
            if (d.item && d.item.campaign) {
                s.campaignId = d.item.campaign.id;
            } else if (tab === "overview" || tab === "treasury") {
                s.campaignId = null;
            }
            s.fetchedAt[tab] = Date.now();
        }
        if (board && board.ok) s.standings = (board.data || {}).items || [];
        paintTheme(runtime, windowState);
        if (windowState.view && windowState.view.refresh) windowState.view.refresh();
    }).catch(() => {
        s.inflight = false;
        s.loading = false;
        if (windowState.view && windowState.view.refresh) windowState.view.refresh();
    });
}

/**
 * Zet het palet op de app EN op het venster eromheen.
 *
 * DE VENSTERRAND. Een actief VM-venster heeft een magenta rand; dat is een
 * eigenschap van de vensterlaag en niet van deze app. Hij is toch te sturen
 * zonder de WindowManager aan te raken: `mount` krijgt het venster-element
 * zelf mee, en `patchWindowElement` schrijft losse style-properties
 * (`element.style.left`, niet `cssText`), dus een custom property overleeft elke
 * herteken. De CSS heeft er een terugval voor, dus elke andere app rendert
 * byte-voor-byte hetzelfde - die zetten de variabele nooit.
 */
function paintTheme(runtime, windowState) {
    const thema = (s0(windowState).data.overview || {}).theme || {};
    const kleur = thema.color;
    const view = windowState.view || {};
    if (view.appElement) {
        applyOrgTheme(view.appElement, kleur);
        applyOrgMaterial(view.appElement, thema.material);
    }
    if (view.windowElement) {
        const a = applyOrgTheme(view.windowElement, kleur);
        if (a) {
            view.windowElement.style.setProperty("--vm-window-accent",
                `hsl(${a.h.toFixed(1)} ${a.s.toFixed(1)}% ${a.l.toFixed(1)}% / .62)`);
            view.windowElement.style.setProperty("--vm-window-glow",
                `hsl(${a.h.toFixed(1)} ${a.s.toFixed(1)}% ${a.l.toFixed(1)}% / .24)`);
        }
    }
}

const s0 = (windowState) => windowState.appState;


function submitPost(runtime, windowState) {
    const s = windowState.appState;
    const tekst = (s.draft || "").trim();
    s.postError = "";
    if (!tekst) return;
    if (tekst.length > BODY_LIMIT) {
        s.postError = `Keep it under ${BODY_LIMIT} characters.`;
        windowState.view.refresh();
        return;
    }
    s.posting = true;
    windowState.view.refresh();

    // A stable key per attempt: a retry of THIS post lands once, a second
    // sentence is a second attempt and gets its own key.
    const key = `${s.viewer ? s.viewer.user_id : "0"}-${Date.now()}-${
        Math.random().toString(36).slice(2, 8)}`;

    gatewayClient.request("/api/org/feed", {
        method: "POST",
        body: {
            body: tekst,
            campaign_id: s.campaignId || null,
            reply_to: s.replyTo || null,
            idempotency_key: key
        }
    }).then((res) => {
        s.posting = false;
        if (res.ok && (res.data || {}).ok) {
            s.draft = "";
            s.replyTo = null;
            // OOK HET VELD ZELF LEEGMAKEN. `refresh()` leest de textarea terug
            // in `s.draft` zodat een poll geen halve zin opeet - en dat wint het
            // anders van dit wissen, waarna de verzonden tekst blijft staan en
            // de teller op 485 hangt.
            const veld = windowState.view.appElement
                && windowState.view.appElement.querySelector("[data-org-draft]");
            if (veld) veld.value = "";
            load(runtime, windowState, true);
        } else {
            s.postError = ((res.data || {}).error) || res.error || "could not post";
            // De vlag kan omgaan terwijl iemand staat te typen. Dan hoort de
            // composer weg te gaan in plaats van de fout te blijven herhalen.
            if ((res.data || {}).disabled) load(runtime, windowState, true);
            windowState.view.refresh();
        }
    }).catch(() => {
        s.posting = false;
        s.postError = "could not reach the backend";
        windowState.view.refresh();
    });
}
