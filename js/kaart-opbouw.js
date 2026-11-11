/**
 * De kaartpreview van de site: een look-alike van Discords container, getekend uit de BESCHRIJVING van de bot (11-11-2026).
 *
 * De bot bouwt het Discord-bericht (`+profile`, `+balance`) met zijn eigen bouwcode en geeft er een eenvoudige beschrijving van
 * mee (bucky1.0/cogs/kaart_beschrijving.py): `{accent, onderdelen: [{type, ...}]}` in de volgorde van het bericht. Deze module
 * tekent die beschrijving. Het enige wat de browser zelf maakt is de OMLIJSTING: een donkere kaart met een accentstreep links
 * en afgeronde hoeken. Wat erin staat (volgorde, tekstregels, scheidingen, platen) komt uit de beschrijving.
 *
 *   sectie     tekst naast een klein plaatje (de titel naast de ring of de avatar)
 *   tekst      markdown-tekst
 *   media      een plaat over de volle breedte (banner, divider, plaquette, bankplaat, ...)
 *   scheiding  een dunne lijn
 *   knoppen    wordt niet getekend: de preview heeft geen knoppen
 *
 * VEILIGHEID: alle tekst gaat met textContent/createTextNode de pagina in; nergens innerHTML. Een plaat is een VERWIJZING
 * (`plaat:<naam>` of `avatar:discord`) die hier wordt omgezet naar de plaat uit `platen` of de avatar; een URL komt alleen in een
 * <img> als `veiligeUrl` hem goedkeurt (https op api.buckybot.app onder /kaart/plaat/, of het relatieve pad van een persoonlijke
 * previewplaat). Een kleur gaat via style.setProperty en alleen na #RRGGBB. Een eigen Discord-emoji komt van cdn.discordapp.com.
 *
 * Tests: site/tests/test_v2_cards.py en site/tests/test_kaart_ingangen.py.
 */
import { API_URL } from "./config.js";

const API_HOST = new URL(API_URL).host;
const PERSOONLIJK = /^\/api\/v1\/me\/kaart\/preview\/[0-9a-f]{40}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const VERWIJZING = /^(plaat:[a-z]{3,12}|avatar:discord)$/;
const EMOJI = /^<(a?):([A-Za-z0-9_]{1,32}):([0-9]{5,25})>$/;
const DISCORD_ID = /^[0-9]{5,25}$/;
const DISCORD_HASH = /^[a-z0-9_]{1,64}$/;

export const minderBeweging = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Een element met tekst, nooit innerHTML. */
export function el(tag, attrs = {}, ...kinderen) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") n.className = v;
        else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const k of kinderen) {
        if (k === null || k === undefined) continue;
        n.append(typeof k === "string" ? document.createTextNode(k) : k);
    }
    return n;
}

/** Een URL van een plaat, of null. Alleen https op de API-host onder /kaart/plaat/, of het relatieve pad van een persoonlijke
 *  previewplaat (daar komt de API-basis voor). Alles anders, ook http, een andere host of een URL met gebruikersnaam, wordt
 *  niet geladen. */
export function veiligeUrl(waarde) {
    if (typeof waarde !== "string" || waarde.length > 300) return null;
    if (PERSOONLIJK.test(waarde)) return API_URL + waarde;
    let u;
    try {
        u = new URL(waarde);
    } catch (_e) {
        return null;
    }
    if (u.protocol !== "https:" || u.host !== API_HOST || u.username || u.password) return null;
    if (!u.pathname.startsWith("/kaart/plaat/")) return null;
    return u.href;
}

export function discordAvatar(id, hash) {
    if (typeof id !== "string" || !DISCORD_ID.test(id) || typeof hash !== "string" || !DISCORD_HASH.test(hash)) return null;
    return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`;
}

export function zetKleur(doel, naam, hex) {
    if (typeof hex === "string" && HEX.test(hex)) doel.style.setProperty(naam, hex);
    else doel.style.removeProperty(naam);
}

/** Een <img> voor een plaat `{url, beweegt, stil}` of null. Bewegende platen tonen eerst `stil` en spelen bij hover (muis) of
 *  tik/Enter (aanraking, toetsenbord); met prefers-reduced-motion spelen ze nooit. Een plaat die niet laadt verdwijnt (geen
 *  kapot plaatje). */
export function plaatImg(p, alt, klasse) {
    if (!p || typeof p !== "object") return null;
    const anim = veiligeUrl(p.url);
    const stil = veiligeUrl(p.stil);
    if (!anim && !stil) return null;
    const img = el("img", { class: klasse, alt, loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => img.remove(), { once: true });
    if (!p.beweegt) {
        img.src = anim || stil;
        return img;
    }
    if (!stil) {
        if (minderBeweging() || !anim) return null;
        img.src = anim;
        return img;
    }
    img.src = stil;
    if (anim) {
        img.tabIndex = 0;
        const speel = () => {
            if (!minderBeweging()) img.src = anim;
        };
        const stop = () => {
            img.src = stil;
        };
        // Muis: spelen zolang je erover staat. Aanraking en toetsenbord: tikken (of Enter of spatie) zet de animatie aan en
        // uit; bij aanraking volgt pointerleave direct op de tik, dus daar mag hij de animatie niet stoppen.
        img.addEventListener("pointerenter", (e) => {
            if (e.pointerType === "mouse") speel();
        });
        img.addEventListener("pointerleave", (e) => {
            if (e.pointerType === "mouse") stop();
        });
        img.addEventListener("focus", speel);
        img.addEventListener("blur", stop);
        const wissel = () => (img.src === anim ? stop() : speel());
        img.addEventListener("click", (e) => {
            if (e.pointerType !== "mouse") wissel();
        });
        img.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                wissel();
            }
        });
    }
    return img;
}

// --------------------------------------------------------------------------
// Discord-markdown (de kleine verzameling die de berichten gebruiken) naar DOM
// --------------------------------------------------------------------------
const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|<a?:[A-Za-z0-9_]{1,32}:[0-9]{5,25}>|\*[^*\s][^*]*\*)/;

/** Inline-opmaak: **vet**, *schuin*, `code` en eigen emoji. Alles als DOM-knopen, nooit als HTML. */
function inline(tekst) {
    const uit = [];
    for (const deel of String(tekst).split(TOKEN)) {
        if (!deel) continue;
        if (deel.startsWith("**") && deel.endsWith("**") && deel.length > 4) {
            uit.push(el("strong", {}, ...inline(deel.slice(2, -2))));
        } else if (deel.startsWith("`") && deel.endsWith("`") && deel.length > 2) {
            uit.push(el("code", {}, deel.slice(1, -1)));
        } else if (EMOJI.test(deel)) {
            const [, anim, naam, id] = EMOJI.exec(deel);
            const img = el("img", { class: "kc-dc-emoji", alt: `:${naam}:`, width: "20", height: "20", loading: "lazy",
                                    referrerpolicy: "no-referrer" });
            img.src = `https://cdn.discordapp.com/emojis/${id}.${anim ? "gif" : "webp"}?size=48`;
            img.addEventListener("error", () => img.replaceWith(document.createTextNode(`:${naam}:`)), { once: true });
            uit.push(img);
        } else if (deel.startsWith("*") && deel.endsWith("*") && deel.length > 2) {
            uit.push(el("em", {}, deel.slice(1, -1)));
        } else {
            uit.push(document.createTextNode(deel));
        }
    }
    return uit;
}

/** Een tekstblok (meerdere regels) als DOM: koppen (#, ##, ###), kleine tekst (-#), opsommingen (-) en gewone regels. */
export function markdown(tekst, klasse = "kc-dc-tekst") {
    const vak = el("div", { class: klasse });
    for (const regel of String(tekst).split("\n")) {
        let m;
        if (regel.trim() === "") {
            vak.append(el("div", { class: "kc-dc-leeg" }));
        } else if ((m = /^(#{1,3}) (.*)$/.exec(regel))) {
            vak.append(el(`h${m[1].length + 1}`, { class: `kc-dc-kop kc-dc-kop${m[1].length}` }, ...inline(m[2])));
        } else if ((m = /^-# (.*)$/.exec(regel))) {
            vak.append(el("p", { class: "kc-dc-klein" }, ...inline(m[1])));
        } else if ((m = /^[-*] (.*)$/.exec(regel))) {
            vak.append(el("p", { class: "kc-dc-punt" }, ...inline(m[1])));
        } else {
            vak.append(el("p", { class: "kc-dc-regel" }, ...inline(regel)));
        }
    }
    return vak;
}

// --------------------------------------------------------------------------
// De container
// --------------------------------------------------------------------------
/** Zet een verwijzing om naar een <img>: `plaat:<naam>` uit `platen`, `avatar:discord` naar de avatar van de speler. */
function verwijsImg(verwijzing, ctx, alt, klasse) {
    if (typeof verwijzing !== "string" || !VERWIJZING.test(verwijzing)) return null;
    if (verwijzing === "avatar:discord") {
        if (!ctx.avatarUrl) return null;
        const img = el("img", { class: klasse, alt: alt || "Your Discord avatar", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
        img.src = ctx.avatarUrl;
        img.addEventListener("error", () => img.remove(), { once: true });
        return img;
    }
    const naam = verwijzing.slice("plaat:".length);
    return plaatImg((ctx.platen || {})[naam], alt || naam, klasse);
}

/**
 * Teken de beschrijving in `doel` (de inhoud wordt vervangen).
 *   opbouw  {accent, onderdelen} van de bot
 *   ctx     {platen, avatarUrl, naam}: de platen uit de preview, de avatar van de speler en zijn naam (voor de initiaal)
 * Geeft de lijst `type`s terug die getekend zijn, in volgorde (voor tests en voor de aanroeper).
 */
export function tekenOpbouw(doel, opbouw, ctx = {}) {
    const container = el("div", { class: "kc-dc", role: "group", "aria-label": "Preview of your card" });
    zetKleur(container, "--kc-accent", opbouw && opbouw.accent);
    const getekend = [];
    for (const o of (opbouw && Array.isArray(opbouw.onderdelen) ? opbouw.onderdelen : [])) {
        if (!o || typeof o !== "object") continue;
        if (o.type === "sectie") {
            const plaatje = verwijsImg(o.plaat, ctx, "", "kc-dc-duim")
                || (o.plaat === "avatar:discord" ? el("span", { class: "kc-dc-duim kc-dc-initiaal", "aria-hidden": "true" },
                    ((ctx.naam || "?").trim()[0] || "?").toUpperCase()) : null);
            container.append(el("div", { class: "kc-dc-sectie" }, markdown(o.tekst || ""), plaatje));
        } else if (o.type === "tekst") {
            container.append(markdown(o.tekst || ""));
        } else if (o.type === "media") {
            const img = verwijsImg(o.plaat, ctx, o.alt || "", "kc-dc-media");
            if (!img) continue;
            container.append(img);
        } else if (o.type === "scheiding") {
            container.append(el("hr", { class: "kc-dc-hr" }));
        } else {
            continue;                                   // knoppen: de preview heeft er geen
        }
        getekend.push(o.type);
    }
    doel.replaceChildren(container);
    return getekend;
}
