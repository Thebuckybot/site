/**
 * De kaarteditor van v2 (fase 1, 11-11-2026): een preview van je profiel- en saldokaart, bladeren door de catalogus en een
 * keuze opslaan. Ontwerp: docs/website-kaarteditor-2026-11.md; besluit: ADR 0016. Tests: site/tests/test_v2_cards.py.
 *
 * DE BOT BLIJFT DE ENIGE SCHRIJVER. Deze pagina vraagt alleen: de catalogus (GET /api/v1/kaart/catalogus), de staat van de
 * ingelogde speler (GET /api/v1/me/kaart), een preview (POST .../preview), een keuze (POST .../keuze) en, voor de cijfers op
 * de preview, /api/player/me en /api/me. Er is geen koopknop: wat te koop is wordt alleen getoond.
 *
 * ACHTER DE VLAG `kaart_editor` (standaard uit): een 503 met `feature` geeft "this part of the site is switched off".
 *
 * VEILIGHEID
 *   * Alle tekst gaat met textContent de pagina in; nergens innerHTML, outerHTML of insertAdjacentHTML.
 *   * Een URL van een plaat komt alleen in een <img> als hij https is op api.buckybot.app onder /kaart/plaat/, of het
 *     relatieve pad van een persoonlijke previewplaat (daar komt de API-basis voor). Kleuren alleen na #RRGGBB.
 *   * De speler komt uit de sessie (cookie); de pagina stuurt nooit een user_id mee.
 *   * Geen inline script of stijl: kleuren gaan via style.setProperty (CSSOM, geen style-attribuut).
 *
 * VOLGORDE: eerst de staat lezen, pas dan previews (6 per minuut aan de serverkant), met een debounce bij snel wisselen en
 * hoogstens een preview tegelijk. Een keuze zet de knop uit tot het antwoord er is (geen dubbel klikken). Een 504 betekent
 * dat de keuze misschien gelukt is: eerst de staat opnieuw lezen, dan pas iets melden. Een 401 midden in een opslag betekent
 * dat er niets is opgeslagen; de pagina zegt dat en bewaart alleen het voorbeeld (nooit automatisch opslaan).
 */
import { API_URL } from "../../js/config.js";
import { loginUrl } from "../../js/sessie.js";
import { discordAvatar, el, plaatImg, tekenOpbouw, veiligeUrl, zetKleur } from "../../js/kaart-opbouw.js";

export { veiligeUrl };

export const TERUG = "v2/cards.html";
const API_HOST = new URL(API_URL).host;
const ID = /^[a-z0-9_]{3,40}$/;
const DEBOUNCE_MS = 350;
const CONCEPT = "kaart_concept";

/** Welke categorieën er per tabblad staan, als [kaart, categorie]. De bankskin hoort bij de kaart `bank`. */
const TABS = {
    profiel: {
        label: "Profile",
        cats: [["profiel", "banner"], ["profiel", "divider"], ["profiel", "titelachtergrond"], ["profiel", "titelkader"],
               ["profiel", "avatar"], ["profiel", "kaartthema"], ["profiel", "rand"]],
    },
    saldo: {
        label: "Balance",
        cats: [["saldo", "bankbanner"], ["saldo", "divider"], ["saldo", "kaartthema"], ["saldo", "rand"], ["bank", "bankkaart"]],
    },
};
/** De namen zoals ze in Discord staan (`+cardstyle`). */
const CAT_NAAM = {
    banner: "Banner", bankbanner: "Banner", divider: "Divider", titelachtergrond: "Title plaque", titelkader: "Avatar frame",
    avatar: "Avatar", kaartthema: "Card theme", rand: "Border", bankkaart: "Bank card skin",
};
const KAART_NAAM = { profiel: "profile", saldo: "balance", bank: "bank" };
const KAART_TITEL = { profiel: "Profile", saldo: "Balance", bank: "Bank" };
const MODUS_NAAM = { tekst: "plain text", plaat: "a bank card", tegels: "a bank card with tiles" };

/** Wat de speler leest bij een weigering of storing, per foutcode van de API. */
const REDEN = {
    tier_required: "That needs a premium tier you do not have right now.",
    level_required: "Your level is too low for that.",
    buy_in_discord: "Buy that one in Discord with +cardstyle.",
    unknown_item: "That item does not exist any more.",
    not_owned: "You do not own that yet.",
    not_on_card: "That does not fit on this card.",
    busy: "Your profile is busy for a moment. Try again.",
    bad_request: "That request did not look right. Reload the page and try again.",
    no_profile: "Play once in Discord first, then come back.",
    no_discord: "This account has no Discord account, so there are no cards to edit.",
    bot_unavailable: "Card editing is paused while Bucky restarts. Try again in a minute.",
    bot_timeout: "Bucky did not answer in time.",
    unsupported_media_type: "Something went wrong. Reload the page and try again.",
    bad_origin: "This request did not come from Bucky's website. Reload the page and try again.",
};

// --------------------------------------------------------------------------
// Kleine hulpen komen uit js/kaart-opbouw.js (el, veiligeUrl, plaatImg, zetKleur, tekenOpbouw): dezelfde als op het dashboard
// --------------------------------------------------------------------------
const $ = (sel, wortel = document) => wortel.querySelector(sel);
const getal = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString("en-US") : "0");

// --------------------------------------------------------------------------
// De API
// --------------------------------------------------------------------------
/**
 * Een aanroep. Altijd met de cookie (credentials include); een POST met Content-Type application/json. Geeft nooit een
 * uitzondering: `{ok, status, data, body, code, bericht, feature, retry, netwerk}`.
 *   code     error.code van de /api/v1-envelop (of null); een 503 van de vlag heeft `feature` in plaats van een code.
 *   retry    seconden uit `retry_after` in de body (de kop Retry-After is voor JavaScript niet leesbaar zonder
 *            Access-Control-Expose-Headers), anders uit de kop.
 */
async function vraag(pad, { methode = "GET", body = null, deadline = 15000 } = {}) {
    const ctl = new AbortController();
    const klok = setTimeout(() => ctl.abort(), deadline);
    try {
        const opties = { method: methode, credentials: "include", signal: ctl.signal, headers: { Accept: "application/json" } };
        if (body !== null) {
            opties.headers["Content-Type"] = "application/json";
            opties.body = JSON.stringify(body);
        }
        const res = await fetch(`${API_URL}${pad}`, opties);
        let ruw = null;
        try {
            ruw = await res.json();
        } catch (_e) {
            ruw = null;
        }
        const obj = ruw !== null && typeof ruw === "object" && !Array.isArray(ruw) ? ruw : {};
        const fout = obj.error;
        const envelop = fout !== null && typeof fout === "object" ? fout : null;
        let retry = Number(obj.retry_after);
        if (!Number.isFinite(retry) || retry <= 0) retry = Number(res.headers.get("Retry-After"));
        return {
            ok: res.ok && obj.ok !== false,
            status: res.status,
            body: obj,
            data: obj.ok === true ? obj.data : obj,
            code: envelop && typeof envelop.code === "string" ? envelop.code : null,
            bericht: envelop && typeof envelop.message === "string" ? envelop.message : null,
            feature: typeof obj.feature === "string" ? obj.feature : null,
            retry: Number.isFinite(retry) && retry > 0 ? Math.min(3600, Math.ceil(retry)) : null,
            netwerk: false,
        };
    } catch (_e) {
        return { ok: false, status: 0, body: {}, data: null, code: null, bericht: null, feature: null, retry: null, netwerk: true };
    } finally {
        clearTimeout(klok);
    }
}

// --------------------------------------------------------------------------
// De toestand van de pagina
// --------------------------------------------------------------------------
const S = {
    tab: "profiel",
    cat: "banner",
    catalogus: null,
    staat: null,
    speler: null,
    naam: "",
    avatarUrl: null,
    voorbeeld: { profiel: {}, saldo: {}, bank: {} },
    preview: null,            // {kaart, data} van de laatste geslaagde preview
    previewBezig: false,
    previewOpnieuw: false,
    pauzeTot: 0,
    previewKlok: 0,
    pauzeKlok: 0,
    bezig: false,             // een keuze loopt
    podium: "licht",
};

const staten = () => [...document.querySelectorAll("[data-kc-staat]")];

function toonStaat(naam, tekst = null) {
    for (const v of staten()) v.hidden = v.dataset.kcStaat !== naam;
    const editor = $("[data-kc-editor]");
    if (editor) editor.hidden = naam !== "editor";
    const doel = $(`[data-kc-staat="${naam}"] [data-kc-tekst]`);
    if (doel && tekst) doel.textContent = tekst;
    document.documentElement.dataset.kcToestand = naam;
}

/** Welke toestand hoort bij een mislukte aanroep? */
function staatVoor(r) {
    if (r.feature) return "uit";
    if (r.status === 401) return "login";
    if (r.code === "no_discord") return "nodiscord";
    if (r.code === "no_profile") return "geenprofiel";
    if (r.status === 429 || r.code === "rate_limited") return "wacht";
    return "fout";
}

let wachtKlok = 0;
function toonWacht(seconden) {
    clearInterval(wachtKlok);
    let rest = Math.max(1, seconden || 5);
    const vak = $("[data-kc-wacht]");
    const knop = $("[data-kc-wacht-opnieuw]");
    toonStaat("wacht");
    if (knop) knop.disabled = true;
    const teken = () => {
        if (vak) vak.textContent = String(rest);
    };
    teken();
    wachtKlok = setInterval(() => {
        rest -= 1;
        teken();
        if (rest <= 0) {
            clearInterval(wachtKlok);
            if (knop) knop.disabled = false;
        }
    }, 1000);
}

function toonFout(r) {
    const staat = staatVoor(r);
    if (staat === "wacht") return toonWacht(r.retry);
    if (staat === "fout") {
        const tekst = r.code && REDEN[r.code] ? REDEN[r.code] : "Something went wrong while loading your cards.";
        return toonStaat("fout", r.netwerk ? "We could not reach Bucky. Check your connection and try again." : tekst);
    }
    return toonStaat(staat);
}

// --------------------------------------------------------------------------
// De catalogus en de staat
// --------------------------------------------------------------------------
function alleItems() {
    const lijst = new Map();
    for (const x of (S.catalogus && S.catalogus.items) || []) lijst.set(x.id, x);
    for (const x of (S.staat && S.staat.verborgen_bezit) || []) if (x && ID.test(x.id)) lijst.set(x.id, x);
    return [...lijst.values()];
}

const statusVan = (id) => (S.staat && S.staat.items && S.staat.items[id])
    || ((S.staat && S.staat.verborgen_bezit) || []).some((x) => x && x.id === id) && "owned" || null;
const catsVanTab = () => TABS[S.tab].cats.filter(([kaart, cat]) => {
    const toegestaan = S.catalogus && S.catalogus.kaarten && S.catalogus.kaarten[kaart];
    return Array.isArray(toegestaan) && toegestaan.includes(cat);
});
const actieveKaart = () => (TABS[S.tab].cats.find(([, cat]) => cat === S.cat) || TABS[S.tab].cats[0])[0];
const gekozenVan = (kaart, cat) => {
    const pk = S.staat && S.staat.per_kaart && S.staat.per_kaart[kaart];
    return (pk && pk.gekozen && pk.gekozen[cat]) || null;
};
const getoondVan = (kaart, cat) => {
    const pk = S.staat && S.staat.per_kaart && S.staat.per_kaart[kaart];
    return (pk && pk.getoond && pk.getoond[cat]) || `${cat}_standaard`;
};

function itemsVoor(kaart, cat) {
    const lijst = alleItems().filter((x) => x.categorie === cat && Array.isArray(x.kaarten) && x.kaarten.includes(kaart)
        && ID.test(x.id) && (statusVan(x.id) || x.id === `${cat}_standaard`));
    const rang = (x) => (x.id === `${cat}_standaard` ? 0 : ["owned", "free", "claimable"].includes(statusVan(x.id)) ? 1
        : statusVan(x.id) === "for_sale" ? 2 : 3);
    return lijst.sort((a, b) => rang(a) - rang(b) || String(a.naam).localeCompare(String(b.naam)));
}

/** Het item dat nu op de kaart staat voor deze categorie, met het voorbeeld erbovenop. */
function gekozenOfVoorbeeld(kaart, cat) {
    return S.voorbeeld[kaart][cat] || getoondVan(kaart, cat);
}

function prijsTekst(x) {
    const p = x.prijs || {};
    if (p.soort === "shards") return p.bedrag ? `${getal(p.bedrag)} shards` : "Free";
    if (p.soort === "cipher") return p.bedrag ? `${getal(p.bedrag)} Cipher` : "Free";
    if (p.soort === "level") return `Level ${getal(p.bedrag)}`;
    return "Free";
}

/** De korte status op een tegel, en een langere uitleg voor de actiebalk. */
function statusTekst(x) {
    const st = x.id.endsWith("_standaard") ? "free" : statusVan(x.id);
    switch (st) {
        case "free": return "Free";
        case "owned": return "Owned";
        case "claimable": return x.prijs && x.prijs.soort === "level" ? "Free at your level" : "Free to claim";
        case "for_sale": return prijsTekst(x);
        case "locked_tier": return `Needs ${x.tier || "a premium tier"}`;
        case "locked_level": return `Level ${getal((x.prijs || {}).bedrag)}`;
        default: return "";
    }
}

// --------------------------------------------------------------------------
// De preview (het "podium")
// --------------------------------------------------------------------------
function podiumKaart() {
    return S.preview && S.preview.kaart === actieveKaart() ? S.preview.data : null;
}

function regel(label, waarde) {
    return el("p", { class: "kc-pod-regel" }, el("span", { class: "kc-pod-label" }, label), el("span", { class: "kc-pod-waarde" }, waarde));
}

function xpBalk(sp) {
    const naar = Number(sp.xp_to_next_level);
    const in_ = Number(sp.xp_into_level);
    if (!Number.isFinite(naar) || naar <= 0 || !Number.isFinite(in_)) return null;
    const pct = Math.max(0, Math.min(100, Math.round((in_ / naar) * 100)));
    const balk = el("span", { class: "kc-xp-vul" });
    balk.style.setProperty("--p", String(pct));
    return el("div", { class: "kc-xp" }, el("div", { class: "kc-xp-spoor", role: "img", "aria-label": `${pct} percent to the next level` }, balk),
        el("p", { class: "kc-pod-klein" }, `${getal(in_)} / ${getal(naar)} XP`));
}

function tekenPodium() {
    const vak = $("[data-kc-pod]");
    const kader = $("[data-kc-podium-vak]");
    if (!vak || !kader) return;
    const kaart = actieveKaart();
    const data = podiumKaart();
    const platen = (data && data.platen) || {};
    const sp = S.speler || {};
    kader.dataset.podium = S.podium;
    if (data && data.opbouw) {
        // DE INDELING KOMT VAN DE BOT: dezelfde bouwcode als het Discord-bericht; hier wordt alleen de omlijsting getekend.
        kader.dataset.weergave = "discord";
        tekenOpbouw(vak, data.opbouw, { platen, avatarUrl: S.avatarUrl, naam: S.naam });
        return;
    }
    kader.dataset.weergave = "eenvoudig";        // een oudere bot of een mislukte opbouw: de eenvoudige preview
    zetKleur(kader, "--kc-accent", data && data.accent);
    const rand = data && data.rand;
    zetKleur(kader, "--kc-rand", rand && rand.rand);
    if (rand && Number.isInteger(rand.dikte)) kader.style.setProperty("--kc-rand-dikte", `${rand.dikte}px`);
    else kader.style.removeProperty("--kc-rand-dikte");
    kader.dataset.randStijl = rand && ["effen", "dubbel", "gloed"].includes(rand.stijl) ? rand.stijl : "geen";

    const kinderen = [];
    const naam = S.naam || "Your name";
    const embleem = plaatImg(platen.embleem, "Your avatar with the chosen frame", "kc-pod-embleem");
    const avatar = embleem || avatarImg();
    const kop = el("div", { class: "kc-pod-kop" },
        el("div", { class: "kc-pod-kopTekst" },
            el("h3", { class: "kc-pod-naam" }, naam),
            el("p", { class: "kc-pod-klein" }, `${KAART_TITEL[kaart]} card`)),
        avatar || el("span", { class: "kc-pod-initiaal", "aria-hidden": "true" }, (naam.trim()[0] || "?").toUpperCase()));
    kinderen.push(kop);

    const plaquette = plaatImg(platen.plaquette, "Your title on the chosen plaque", "kc-pod-plaquette");
    if (plaquette) kinderen.push(plaquette);
    const banner = plaatImg(platen.banner, "The chosen banner", "kc-pod-banner");
    if (banner) kinderen.push(banner);

    if (kaart === "profiel") {
        const regels = el("div", { class: "kc-pod-regels" });
        if (Number.isFinite(Number(sp.level))) regels.append(regel("Level", getal(sp.level)));
        if (sp.equipped_title) regels.append(regel("Title", String(sp.equipped_title)));
        if (Number.isFinite(Number(sp.coins))) regels.append(regel("Shards", getal(sp.coins)));
        if (Number.isFinite(Number(sp.bank))) regels.append(regel("Bank", getal(sp.bank)));
        kinderen.push(regels);
        const balk = xpBalk(sp);
        if (balk) kinderen.push(balk);
    } else {
        const regels = el("div", { class: "kc-pod-regels" });
        if (Number.isFinite(Number(sp.coins))) regels.append(regel("Shards in hand", getal(sp.coins)));
        if (Number.isFinite(Number(sp.bank))) regels.append(regel("Bank", getal(sp.bank)));
        kinderen.push(regels);
    }

    if (kaart !== "bank") {
        const scheiding = plaatImg(platen.divider, "The chosen divider", "kc-pod-divider");
        kinderen.push(scheiding || el("hr", { class: "kc-pod-hr" }));
    }
    for (const [sleutel, alt] of [["bank", "Your bank card with the chosen skin"], ["tegels", "Your balance tiles"]]) {
        const img = plaatImg(platen[sleutel], alt, "kc-pod-bank");
        if (img) kinderen.push(img);
    }
    if (kaart === "bank" && !platen.bank) {
        kinderen.push(el("p", { class: "kc-pod-klein" }, "Pick a bank card skin to see your bank card."));
    }
    vak.replaceChildren(...kinderen);
}

function avatarImg() {
    if (!S.avatarUrl) return null;
    const img = el("img", { class: "kc-pod-embleem", alt: "Your Discord avatar", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
    img.src = S.avatarUrl;
    img.addEventListener("error", () => img.remove(), { once: true });
    return img;
}

function previewStatus(tekst) {
    const v = $("[data-kc-previewstatus]");
    if (v) v.textContent = tekst || "";
}

function planPreview(direct = false) {
    clearTimeout(S.previewKlok);
    S.previewKlok = setTimeout(vraagPreview, direct ? 0 : DEBOUNCE_MS);
}

async function vraagPreview() {
    if (S.previewBezig) {
        S.previewOpnieuw = true;
        return;
    }
    const nu = Date.now();
    if (nu < S.pauzeTot) {
        clearTimeout(S.pauzeKlok);
        S.pauzeKlok = setTimeout(vraagPreview, S.pauzeTot - nu + 50);
        return;
    }
    S.previewBezig = true;
    const kaart = actieveKaart();
    const wijzig = { ...S.voorbeeld[kaart] };
    previewStatus("Updating the preview...");
    const r = await vraag("/api/v1/me/kaart/preview", { methode: "POST", body: { kaart, wijzig } });
    S.previewBezig = false;
    if (r.ok && r.data && typeof r.data === "object") {
        S.preview = { kaart, data: r.data };
        previewStatus("");
    } else if (r.status === 401) {
        bewaarConcept();
        previewStatus("Your session has ended. Log in again to keep editing.");
        toonSessieVoorbij();
    } else if (r.status === 429 || r.code === "rate_limited") {
        const s = r.retry || 10;
        S.pauzeTot = Date.now() + s * 1000;
        previewStatus(`Too many previews. The preview updates again in ${s} seconds.`);
        clearTimeout(S.pauzeKlok);
        S.pauzeKlok = setTimeout(vraagPreview, s * 1000 + 50);
    } else {
        previewStatus(r.code && REDEN[r.code] ? `Preview unavailable. ${REDEN[r.code]}` : "The preview is unavailable right now. You can still equip.");
    }
    tekenPodium();
    if (S.previewOpnieuw) {
        S.previewOpnieuw = false;
        planPreview();
    }
}

// --------------------------------------------------------------------------
// De catalogusweergave: tabs, categorieen, raster, actiebalk
// --------------------------------------------------------------------------
function tekenTabs() {
    for (const knop of document.querySelectorAll("[data-kc-tab]")) {
        const actief = knop.dataset.kcTab === S.tab;
        knop.setAttribute("aria-selected", String(actief));
        knop.tabIndex = actief ? 0 : -1;
    }
}

function tekenCats() {
    const vak = $("[data-kc-cats]");
    const cats = catsVanTab();
    if (!cats.some(([, c]) => c === S.cat)) S.cat = cats.length ? cats[0][1] : S.cat;
    vak.replaceChildren(...cats.map(([kaart, cat]) => {
        const knop = el("button", { type: "button", class: "kc-zij", "aria-pressed": String(cat === S.cat), "data-kc-cat": cat, "data-kc-kaart": kaart },
            CAT_NAAM[cat] || cat);
        knop.addEventListener("click", () => {
            S.cat = cat;
            tekenCats();
            tekenRaster();
            tekenActie();
            planPreview();
        });
        return knop;
    }));
}

function swatch(x) {
    const k = x.kleur || {};
    const vlak = el("span", { class: "kc-sw", "aria-hidden": "true" });
    zetKleur(vlak, "--sw-a", k.accent);
    zetKleur(vlak, "--sw-r", k.rand);
    if (k.dikte && Number.isInteger(k.dikte)) vlak.style.setProperty("--sw-d", `${k.dikte}px`);
    if (k.stijl) vlak.dataset.stijl = ["effen", "dubbel", "gloed"].includes(k.stijl) ? k.stijl : "effen";
    return vlak;
}

function tegel(x, kaart, cat, gekozen, geselecteerd) {
    const standaard = x.id === `${cat}_standaard`;
    const naam = standaard ? "Back to free" : String(x.naam);
    const status = statusTekst(x);
    const uitgerust = x.id === gekozen;
    const label = `${naam}. ${uitgerust ? "Equipped. " : ""}${status}`;
    const knop = el("button", {
        type: "button", class: "kc-tegel", role: "radio", "aria-checked": String(geselecteerd), "aria-label": label,
        "data-kc-item": x.id, "data-status": standaard ? "free" : (statusVan(x.id) || ""), tabindex: geselecteerd ? "0" : "-1",
    });
    let beeld = null;
    const staal = x.staal && typeof x.staal === "object" ? veiligeUrl(x.staal.stil) : null;
    if (staal) {
        beeld = el("img", { class: "kc-tegel-beeld", alt: "", width: "240", height: "108", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
        beeld.src = staal;
        beeld.addEventListener("error", () => beeld.replaceWith(el("span", { class: "kc-tegel-leeg", "aria-hidden": "true" }, naam.slice(0, 1).toUpperCase())), { once: true });
    } else if (x.kleur) {
        beeld = swatch(x);
    } else {
        beeld = el("span", { class: "kc-tegel-leeg", "aria-hidden": "true" }, naam.slice(0, 1).toUpperCase());
    }
    knop.append(beeld, el("span", { class: "kc-tegel-naam" }, naam),
        el("span", { class: "kc-tegel-status" }, uitgerust ? `Equipped${status ? ` - ${status}` : ""}` : status));
    knop.addEventListener("click", () => kiesVoorbeeld(kaart, cat, x.id));
    knop.addEventListener("keydown", (e) => {
        const vorige = ["ArrowLeft", "ArrowUp"].includes(e.key);
        const volgende = ["ArrowRight", "ArrowDown"].includes(e.key);
        if (!vorige && !volgende) return;
        e.preventDefault();
        const alle = [...document.querySelectorAll("[data-kc-item]")];
        const i = alle.indexOf(knop);
        const doel = alle[(i + (volgende ? 1 : -1) + alle.length) % alle.length];
        if (doel) {
            doel.focus();
            doel.click();
        }
    });
    return knop;
}

function tekenRaster() {
    const raster = $("[data-kc-grid]");
    const kaart = actieveKaart();
    const cat = S.cat;
    const items = itemsVoor(kaart, cat);
    const gekozen = getoondVan(kaart, cat);
    const geselecteerd = gekozenOfVoorbeeld(kaart, cat);
    const titel = $("[data-kc-cat-titel]");
    titel.textContent = `${CAT_NAAM[cat] || cat} (${KAART_NAAM[kaart]} card)`;
    raster.setAttribute("aria-label", `${CAT_NAAM[cat] || cat} for your ${KAART_NAAM[kaart]} card`);
    raster.replaceChildren(...items.map((x) => tegel(x, kaart, cat, gekozen, x.id === geselecteerd)));
    if (!items.length) raster.append(el("p", { class: "kc-leeg" }, "There is nothing to pick here yet."));
    // Opgeslagen maar nu niet getoond (een tier die niet meer geldt, of een ongeldig item): zeg het.
    const opgeslagen = gekozenVan(kaart, cat);
    const vak = $("[data-kc-gekozen]");
    if (opgeslagen && opgeslagen !== getoondVan(kaart, cat)) {
        const item = alleItems().find((x) => x.id === opgeslagen);
        const tier = item && item.tier ? ` Shown again when your ${item.tier} tier is active.` : "";
        vak.textContent = `Saved, but not shown right now.${tier}`;
    } else {
        vak.textContent = "";
    }
    const modus = $("[data-kc-modus]");
    modus.hidden = kaart === "profiel";
    modus.textContent = S.staat && S.staat.bank_modus
        ? `On +balance your bank shows as ${MODUS_NAAM[S.staat.bank_modus] || "plain text"}. Change that in Discord with +cardstyle.` : "";
}

function kiesVoorbeeld(kaart, cat, id) {
    if (!ID.test(id)) return;
    const hadFocus = !!(document.activeElement && document.activeElement.hasAttribute && document.activeElement.hasAttribute("data-kc-item"));
    const nu = getoondVan(kaart, cat);
    if (id === nu) delete S.voorbeeld[kaart][cat];
    else S.voorbeeld[kaart][cat] = id;
    tekenRaster();
    tekenActie();
    if (hadFocus) {
        const nieuw = $(`[data-kc-item="${CSS.escape(id)}"]`);
        if (nieuw) nieuw.focus();
    }
    planPreview();
}

function actieInfo() {
    const kaart = actieveKaart();
    const cat = S.cat;
    const id = gekozenOfVoorbeeld(kaart, cat);
    const x = alleItems().find((i) => i.id === id);
    return { kaart, cat, id, x };
}

function tekenActie() {
    const tekst = $("[data-kc-actie-tekst]");
    const knop = $("[data-kc-equip]");
    const { kaart, cat, id, x } = actieInfo();
    knop.hidden = true;
    knop.disabled = S.bezig;
    if (!x) {
        tekst.textContent = "";
        return;
    }
    const huidig = getoondVan(kaart, cat);
    const standaard = id === `${cat}_standaard`;
    const st = standaard ? "free" : statusVan(id);
    const naam = standaard ? "the free default" : String(x.naam);
    if (id === huidig && !S.voorbeeld[kaart][cat]) {
        tekst.textContent = `${standaard ? "The free default" : String(x.naam)} is what you use on your ${KAART_NAAM[kaart]} card now.`;
        return;
    }
    if (st === "free" || st === "owned" || st === "claimable") {
        knop.hidden = false;
        knop.textContent = standaard ? "Back to free" : "Equip";
        tekst.textContent = st === "claimable"
            ? `${naam} is free for you. Equip adds it to your cards and uses it on your ${KAART_NAAM[kaart]} card.`
            : `Use ${naam} on your ${KAART_NAAM[kaart]} card.`;
    } else if (st === "for_sale") {
        tekst.textContent = `${naam}: ${prijsTekst(x)}. ${REDEN.buy_in_discord}`;
    } else if (st === "locked_tier") {
        tekst.textContent = `${naam}: needs ${x.tier || "a premium tier"}. ${REDEN.tier_required}`;
    } else if (st === "locked_level") {
        tekst.textContent = `${naam}: reach level ${getal((x.prijs || {}).bedrag)}. ${REDEN.level_required}`;
    } else {
        tekst.textContent = "";
    }
}

function melding(tekst, soort = "info") {
    const v = $("[data-kc-melding]");
    v.textContent = tekst || "";
    v.dataset.soort = soort;
}

// --------------------------------------------------------------------------
// Opslaan
// --------------------------------------------------------------------------
function bewaarConcept() {
    try {
        sessionStorage.setItem(CONCEPT, JSON.stringify({ tab: S.tab, voorbeeld: S.voorbeeld }));
    } catch (_e) { /* geen opslag: dan blijft alleen de pagina zelf */ }
}

function leesConcept() {
    try {
        const ruw = sessionStorage.getItem(CONCEPT);
        sessionStorage.removeItem(CONCEPT);
        const c = JSON.parse(ruw || "null");
        if (!c || !TABS[c.tab]) return null;
        const schoon = { profiel: {}, saldo: {}, bank: {} };
        for (const kaart of Object.keys(schoon)) {
            const bron = c.voorbeeld && typeof c.voorbeeld[kaart] === "object" && c.voorbeeld[kaart] ? c.voorbeeld[kaart] : {};
            for (const [cat, id] of Object.entries(bron)) if (typeof id === "string" && ID.test(id) && /^[a-z_]{3,20}$/.test(cat)) schoon[kaart][cat] = id;
        }
        return { tab: c.tab, voorbeeld: schoon };
    } catch (_e) {
        return null;
    }
}

function toonSessieVoorbij() {
    const vak = $("[data-kc-melding]");
    vak.dataset.soort = "fout";
    vak.replaceChildren(document.createTextNode("Your session has ended, so nothing was saved. "),
        el("a", { href: loginUrl(TERUG), class: "kc-link" }, "Log in again"),
        document.createTextNode(" to keep editing."));
}

async function leesStaatOpnieuw() {
    const r = await vraag("/api/v1/me/kaart");
    if (r.ok && r.data && typeof r.data === "object" && r.data.per_kaart) {
        S.staat = r.data;
        return true;
    }
    return false;
}

async function equip() {
    if (S.bezig) return;
    const { kaart, cat, id, x } = actieInfo();
    if (!x || !ID.test(id)) return;
    const standaard = id === `${cat}_standaard`;
    const st = standaard ? "free" : statusVan(id);
    if (!["free", "owned", "claimable"].includes(st)) return;
    const naam = standaard ? "the free default" : String(x.naam);
    S.bezig = true;
    const knop = $("[data-kc-equip]");
    knop.disabled = true;
    knop.setAttribute("aria-busy", "true");
    melding("Saving...", "info");
    try {
        const r = await vraag("/api/v1/me/kaart/keuze", { methode: "POST", body: { kaart, item_id: id } });
        if (r.ok) {
            delete S.voorbeeld[kaart][cat];
            const geclaimd = !!(r.data && r.data.geclaimd);
            const gelezen = await leesStaatOpnieuw();
            if (!gelezen && r.data && r.data.per_kaart && S.staat && S.staat.per_kaart) S.staat.per_kaart[kaart] = r.data.per_kaart;
            if (!gelezen && r.data && r.data.item && S.staat) S.staat.items[r.data.item.id] = r.data.item.status;
            melding(standaard ? `Back to the free default on your ${KAART_NAAM[kaart]} card.`
                : `${geclaimd ? "Claimed and equipped" : "Equipped"} ${naam} on your ${KAART_NAAM[kaart]} card.`, "goed");
            tekenRaster();
            planPreview(true);
        } else if (r.status === 504 || r.code === "bot_timeout") {
            // Misschien gelukt: eerst de staat lezen, dan pas iets melden.
            const gelezen = await leesStaatOpnieuw();
            if (gelezen && gekozenVan(kaart, cat) === id) {
                delete S.voorbeeld[kaart][cat];
                melding(`Equipped ${naam} on your ${KAART_NAAM[kaart]} card. Bucky answered slowly.`, "goed");
                tekenRaster();
                planPreview(true);
            } else if (gelezen) {
                melding("That was not saved: Bucky did not answer in time. Try again.", "fout");
            } else {
                melding("We could not confirm whether that was saved. Reload the page to check.", "fout");
            }
        } else if (r.status === 401) {
            bewaarConcept();
            toonSessieVoorbij();
        } else if (r.status === 429 || r.code === "rate_limited") {
            melding(`Too many changes. Try again in ${r.retry || 10} seconds.`, "fout");
        } else if (r.feature) {
            toonStaat("uit");
        } else if (r.netwerk) {
            melding("We could not reach Bucky. Nothing was saved. Try again.", "fout");
        } else {
            const tekst = r.code && REDEN[r.code] ? REDEN[r.code] : "That did not work. Nothing was saved.";
            melding(r.code === "busy" ? `${tekst}` : `${tekst} Nothing was changed.`, "fout");
            if (r.code === "no_profile") toonStaat("geenprofiel");
        }
    } finally {
        S.bezig = false;
        knop.removeAttribute("aria-busy");
        tekenActie();
    }
}

// --------------------------------------------------------------------------
// Laden
// --------------------------------------------------------------------------
async function laadSpeler() {
    const [pm, me] = await Promise.all([vraag("/api/player/me"), vraag("/api/me")]);
    if (pm.ok && pm.body && pm.body.item && typeof pm.body.item === "object") S.speler = pm.body.item;
    const u = me.ok && me.body && me.body.logged_in && me.body.user && typeof me.body.user === "object" ? me.body.user : null;
    if (u) {
        const naam = u.global_name || u.username;
        S.naam = typeof naam === "string" ? naam.slice(0, 60) : "";
        S.avatarUrl = discordAvatar(String(u.id || ""), u.avatar);
    }
}

async function laad() {
    toonStaat("laden");
    clearInterval(wachtKlok);
    const [staat, catalogus] = await Promise.all([vraag("/api/v1/me/kaart"), vraag("/api/v1/kaart/catalogus")]);
    if (!staat.ok) return toonFout(staat);
    if (!catalogus.ok) return toonFout(catalogus);
    if (!staat.data || !staat.data.per_kaart || !catalogus.data || !Array.isArray(catalogus.data.items)) {
        return toonStaat("fout", "Bucky answered in a way we did not expect. Try again in a minute.");
    }
    S.staat = staat.data;
    S.catalogus = catalogus.data;
    await laadSpeler();
    const concept = leesConcept();
    if (concept) {
        S.tab = concept.tab;
        S.voorbeeld = concept.voorbeeld;
    }
    S.cat = catsVanTab().length ? catsVanTab()[0][1] : "banner";
    toonStaat("editor");
    tekenTabs();
    tekenCats();
    tekenRaster();
    tekenActie();
    tekenPodium();
    if (concept) melding("We kept your unsaved preview. Nothing is saved until you press Equip.", "info");
    planPreview(true);
}

function koppel() {
    for (const knop of document.querySelectorAll("[data-kc-tab]")) {
        knop.addEventListener("click", () => zetTab(knop.dataset.kcTab));
        knop.addEventListener("keydown", (e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            const sleutels = Object.keys(TABS);
            const i = sleutels.indexOf(S.tab);
            const n = e.key === "Home" ? 0 : e.key === "End" ? sleutels.length - 1
                : (i + (e.key === "ArrowRight" ? 1 : -1) + sleutels.length) % sleutels.length;
            zetTab(sleutels[n]);
            $(`[data-kc-tab="${sleutels[n]}"]`).focus();
        });
    }
    $("[data-kc-equip]").addEventListener("click", equip);
    $("[data-kc-podium]").addEventListener("click", () => {
        S.podium = S.podium === "donker" ? "licht" : "donker";
        $("[data-kc-podium]").setAttribute("aria-pressed", String(S.podium === "donker"));
        $("[data-kc-podium]").textContent = S.podium === "donker" ? "Discord dark" : "Discord light";
        tekenPodium();
    });
    for (const knop of document.querySelectorAll("[data-kc-opnieuw], [data-kc-wacht-opnieuw]")) knop.addEventListener("click", laad);
    for (const a of document.querySelectorAll("[data-kc-login]")) a.setAttribute("href", loginUrl(TERUG));
}

function zetTab(naam) {
    if (!TABS[naam] || naam === S.tab) return;
    S.tab = naam;
    S.cat = catsVanTab().length ? catsVanTab()[0][1] : S.cat;
    tekenTabs();
    tekenCats();
    tekenRaster();
    tekenActie();
    melding("");
    planPreview();
}

function start() {
    if (!$("[data-kc-editor]")) return;
    S.podium = document.documentElement.dataset.thema === "donker" ? "donker" : "licht";
    const knop = $("[data-kc-podium]");
    knop.setAttribute("aria-pressed", String(S.podium === "donker"));
    knop.textContent = S.podium === "donker" ? "Discord dark" : "Discord light";
    koppel();
    laad();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
