/**
 * orgTheme — één organisatiekleur in, een compleet palet uit.
 *
 * DE REGEL DIE DIT BESTAND BESTAAT: alle vier de organisaties draaien exact
 * dezelfde app. Layout, componenten, afmetingen, spacing en navigatie zijn
 * honderd procent gelijk; alleen de visuele identiteit verschilt. Dat is alleen
 * vol te houden als het verschil DATA is en geen code — dus geen enkele tak op
 * een slug, nergens. Elk verschil dat je ziet komt uit de custom properties
 * hieronder, en die worden berekend uit `organizations.color`.
 *
 * DE HELDERHEIDSBODEM, en waarom hij er moet zijn.
 * De opgeslagen kleur is de IDENTITEITSkleur, niet de schermkleur. Aether staat
 * op `#102A54` — diep marineblauw, prachtig op een banner en volstrekt
 * onleesbaar als accent op een bijna-zwarte achtergrond (lichtheid 19%). Null
 * Division staat op een ontzadigd grijsblauw dat om de tegenovergestelde reden
 * wegvalt. Zonder correctie zou de app voor twee van de vier facties geen
 * zichtbaar accent hebben, en dan is "alle vier dezelfde app" op papier waar en
 * op het scherm niet.
 *
 * Dus: tint en verzadiging blijven precies zoals ze zijn opgeslagen, en alleen
 * de lichtheid wordt in een leesbaar bereik getild. Aether blijft marineblauw,
 * het is alleen marineblauw dat je kunt zien.
 */

/** `#RRGGBB` of `#RGB` -> `{h, s, l}` in graden/procenten. */
export function hexToHsl(hex) {
    let raw = String(hex || "").trim().replace(/^#/, "");
    if (raw.length === 3) raw = raw.split("").map((c) => c + c).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;

    const r = parseInt(raw.slice(0, 2), 16) / 255;
    const g = parseInt(raw.slice(2, 4), 16) / 255;
    const b = parseInt(raw.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** `hsl()` als string, met de waarden geklemd op wat CSS accepteert. */
function hsl(h, s, l, a) {
    const kleur = `hsl(${h.toFixed(1)} ${clamp(s, 0, 100).toFixed(1)}% ${clamp(l, 0, 100).toFixed(1)}%`;
    return a === undefined ? `${kleur})` : `${kleur} / ${a})`;
}

/**
 * De accentkleur zoals hij op het scherm mag verschijnen.
 *
 * Lichtheid tussen 52 en 74: onder 52 verdwijnt hij in de achtergrond, boven 74
 * wordt elke factie dezelfde pastelkleur en is het onderscheid weg. Verzadiging
 * krijgt een bodem van 30 zodat Null Division niet als vuilwit leest, en een dak
 * van 92 zodat CyTek niet gaat gloeien als een waarschuwingslamp.
 */
export function accentOf(hex) {
    const c = hexToHsl(hex) || { h: 155, s: 70, l: 60 };
    return { h: c.h, s: clamp(c.s, 30, 92), l: clamp(c.l, 52, 74) };
}

/**
 * Het materiaal: de tweede as, naast de kleur.
 *
 * Null Division is niet als kleur uit te drukken. Zijn identiteit is
 * AFWEZIGHEID - kaders die niet af zijn, een raster dat oplost, datacorruptie,
 * ontzadigde kunst - en dat zijn eigenschappen van het oppervlak en niet van de
 * tint. Zonder deze as zou hij een grijze Vanta zijn.
 *
 * Elk veld is een AMPLITUDE. Alle vier de organisaties dragen alle zeven, en
 * nul betekent uit. Daardoor draait iedereen exact dezelfde CSS en exact
 * dezelfde animaties: een factie die niet glitcht is geen aparte tak, hij staat
 * op nul. Dat is de hele reden dat deze aanpak de regel overeind houdt.
 */
const MATERIAL_DEFAULT = {
    edge_erase: 0, glitch: 0, grid: 0.5,
    noise: 0.035, scan: 0.6, void: 0.85, img_sat: 1
};

export function applyOrgMaterial(element, material) {
    if (!element) return;
    const m = { ...MATERIAL_DEFAULT, ...(material || {}) };
    const getal = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    element.style.setProperty("--org-edge-erase", getal(m.edge_erase, 0));
    element.style.setProperty("--org-glitch", getal(m.glitch, 0));
    element.style.setProperty("--org-grid", getal(m.grid, 0.5));
    element.style.setProperty("--org-noise", getal(m.noise, 0.035));
    element.style.setProperty("--org-scan", getal(m.scan, 0.6));
    element.style.setProperty("--org-void", getal(m.void, 0.85));
    element.style.setProperty("--org-img-sat", getal(m.img_sat, 1));
}

/**
 * Zet het hele palet op een element als custom properties.
 *
 * ALLES wat per organisatie aan KLEUR verschilt staat hier en nergens anders;
 * het materiaal zit in `applyOrgMaterial` hierboven. Wie een vijfde organisatie
 * toevoegt zet één hex in de database en zeven getallen in de config.
 */
export function applyOrgTheme(element, hex) {
    if (!element) return null;
    const a = accentOf(hex);
    const zet = (naam, waarde) => element.style.setProperty(naam, waarde);

    // Het accent, en twee afgeleiden ervan.
    zet("--org", hsl(a.h, a.s, a.l));
    zet("--org-glow", hsl(a.h, Math.min(a.s + 6, 96), Math.min(a.l + 16, 88)));
    zet("--org-dim", hsl(a.h, a.s * 0.55, a.l * 0.42));

    // De ondergrond. Bijna zwart, met net genoeg van de tint erin dat een
    // CyTek-scherm warm aanvoelt en een Aether-scherm koel, zonder dat je de
    // kleur als kleur herkent.
    zet("--org-bg", hsl(a.h, 14, 4));
    zet("--org-surface", hsl(a.h, 12, 7.5));
    zet("--org-raise", hsl(a.h, 12, 10.5));
    zet("--org-line", hsl(a.h, 14, 17));
    zet("--org-line-soft", hsl(a.h, 14, 13));

    // Tekst. De secundaire is bewust hoog: dit is een cijferapp, en wie moet
    // turen of er 4,05% of 4,85% staat vertrouwt hem niet meer.
    zet("--org-ink", hsl(a.h, 12, 92));
    zet("--org-ink-dim", hsl(a.h, 10, 74));
    zet("--org-ink-faint", hsl(a.h, 10, 52));

    // Transparante varianten, voor randen en gloed.
    zet("--org-a12", hsl(a.h, a.s, a.l, 0.12));
    zet("--org-a24", hsl(a.h, a.s, a.l, 0.24));
    zet("--org-a40", hsl(a.h, a.s, a.l, 0.4));
    zet("--org-a64", hsl(a.h, a.s, a.l, 0.64));
    return a;
}

/**
 * De accentkleur van EEN andere organisatie, voor de ranglijst.
 *
 * Daar staan alle vier de identiteiten naast elkaar, en dat is het enige scherm
 * waar dat gebeurt. Elke balk draagt de kleur van zijn eigen factie, door
 * dezelfde bodem gehaald zodat de vergelijking eerlijk blijft: anders zou Aether
 * op elke ranglijst de zwakste lijken omdat zijn balk het donkerst is.
 */
export function accentColour(hex) {
    const a = accentOf(hex);
    return hsl(a.h, a.s, a.l);
}
