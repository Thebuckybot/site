/**
 * DE DIEPTE: ÉÉN SAMENHANGENDE ONDERWATERWERELD.
 *
 * Boven water kijk je van BOVEN; onder water kijk je van OPZIJ. Dat is een
 * andere camera en een ander soort ruimte, met opzet: een duik moet voelen als
 * ergens anders zijn en niet als hetzelfde spel met een blauw filter. Diepte is
 * in een zijaanzicht gewoon omlaag, zodat een zuurstofmeter en "boven komen"
 * betekenis hebben zonder uitleg.
 *
 * ====================================================================
 * DE RUIMTE WORDT BESCHREVEN, NIET DE ROTS
 * ====================================================================
 *
 * De vorige opzet was een lijst massieve blokken per duikplek. Dat werkt voor
 * één grot en breekt daarna, om twee redenen die allebei zijn opgetreden:
 *
 *   - Je beschrijft de ROTS en niet de RUIMTE, dus of er een weg is moet je
 *     achteraf uitrekenen. Mijn "bogen" bleken dichte nissen, en een gang bleek
 *     twintig eenheden hoog terwijl Bucky er tweeëntwintig breed is. Allebei
 *     zagen ze er in de getallen prima uit.
 *   - Elke duikplek was een eigen eilandje. Vier losse kamers zijn geen wereld,
 *     en er was geen reden om verder te zwemmen dan de eerste kist.
 *
 * Nu is het omgekeerd: er wordt beschreven WAAR WATER IS. Een KAMER is een
 * rechthoekige ruimte, een GANG verbindt twee kamers, en rots is per definitie
 * alles wat geen van beide is. Daarmee is samenhang geen eigenschap die je
 * hoopt maar een eigenschap die je OPSCHRIJFT: `GANGEN` is letterlijk de lijst
 * verbindingen, en de test loopt hem na om te bewijzen dat elke kamer vanaf de
 * oppervlakte te bereiken is.
 *
 * Een kamer erbij is één regel, een gang ernaartoe nog een. Dezelfde afweging
 * als bij de eilanden in `wereld.js`: uitbreiden moet goedkoop zijn.
 *
 * ====================================================================
 * VERTICALITEIT IS DE SPANNING
 * ====================================================================
 *
 * Vier lagen: de ingangen aan de oppervlakte, een ondiepe rand, een midden-
 * verdieping en de diepte. Hoe lager, hoe verder van de lucht - en dat is de
 * hele spanningsboog, zonder dat er een straf voor nodig is. De diepste kamers
 * zijn zonder duikpak niet heen-en-terug te doen, en dat wordt NAGEREKEND in
 * tests/test_boot_wereld.js in plaats van aangenomen.
 *
 * Raakt de lucht op, dan verlies je NIETS: je komt boven met alles wat je had.
 */

import { START } from "./wereld.js";

/** Hoeveel seconden lucht je hebt, zonder en met duikpak. */
export const ZUURSTOF_MAX = 26;
export const ZUURSTOF_MET_PAK = 52;

/** De maat van de onderwaterwereld. */
export const DIEPTE_WERELD = { breedte: 3200, diepte: 1750 };

/**
 * De kamers.
 *
 * `x`, `y` is de linkerbovenhoek; `y = 0` is de waterlijn. Een kamer met
 * `ingang` erbij raakt de oppervlakte: daar ga je te water en daar haal je adem.
 */
export const KAMERS = [
    // --- de oppervlakte: vier ingangen ---------------------------------
    { id: "in-shallows", x: 200, y: -40, w: 280, h: 320, ingang: "home-shallows" },
    { id: "in-arches", x: 980, y: -40, w: 260, h: 320, ingang: "the-arches" },
    { id: "in-wreck", x: 1780, y: -40, w: 280, h: 320, ingang: "the-wreck" },
    { id: "in-cut", x: 2600, y: -40, w: 260, h: 320, ingang: "deep-cut" },

    // --- de ondiepe rand ------------------------------------------------
    { id: "reef", naam: "The Shelf", x: 140, y: 400, w: 460, h: 240 },
    { id: "arch-hall", naam: "The Arches", x: 880, y: 400, w: 480, h: 240 },
    { id: "hold", naam: "The Hold", x: 1700, y: 400, w: 460, h: 240 },
    { id: "cut-mouth", naam: "The Mouth", x: 2520, y: 400, w: 420, h: 240 },

    // --- de middenverdieping --------------------------------------------
    // De lange galerij verbindt de westkant met het midden: dit is de reden om
    // verder te zwemmen dan de eerste kist.
    { id: "gallery", naam: "The Long Gallery", x: 300, y: 860, w: 900, h: 220 },
    { id: "crossing", naam: "The Crossing", x: 1480, y: 860, w: 720, h: 220 },
    { id: "vault", naam: "The Vault", x: 2440, y: 860, w: 500, h: 220 },

    // --- de diepte -------------------------------------------------------
    { id: "sump", naam: "The Sump", x: 480, y: 1340, w: 520, h: 260 },
    { id: "black", naam: "The Black Room", x: 1560, y: 1380, w: 620, h: 280 },
    { id: "throat", naam: "The Throat", x: 2500, y: 1400, w: 420, h: 300 },
];

/**
 * De gangen.
 *
 * Elke gang verbindt twee kamers en loopt in een knik: eerst horizontaal op de
 * hoogte van de bovenste kamer, dan verticaal omlaag. Dat is genoeg voor elke
 * verbinding die hier nodig is, en het is met twee rechthoeken te tekenen en te
 * botsen.
 *
 * ER ZITTEN LUSSEN IN, en dat is met opzet: de ondiepe rand is aan elkaar
 * geregen en de middenverdieping ook, dus er is meer dan één route naar
 * beneden. Een boom met alleen aftakkingen dwingt je steeds dezelfde weg terug;
 * met lussen kun je een ronde maken, en dan is verder zwemmen een keuze in
 * plaats van een omweg.
 */
export const GANGEN = [
    // De ingangen naar de ondiepe rand.
    { van: "in-shallows", naar: "reef", breedte: 84 },
    { van: "in-arches", naar: "arch-hall", breedte: 84 },
    { van: "in-wreck", naar: "hold", breedte: 84 },
    { van: "in-cut", naar: "cut-mouth", breedte: 84 },

    // De ondiepe rand aan elkaar: je kunt onder water van plek naar plek.
    { van: "reef", naar: "arch-hall", breedte: 68 },
    { van: "arch-hall", naar: "hold", breedte: 68 },
    { van: "hold", naar: "cut-mouth", breedte: 68 },

    // Naar beneden, op vier plekken - dus meer dan één manier de diepte in.
    { van: "reef", naar: "gallery", breedte: 62 },
    { van: "arch-hall", naar: "gallery", breedte: 62 },
    { van: "hold", naar: "crossing", breedte: 62 },
    { van: "cut-mouth", naar: "vault", breedte: 62 },

    // De middenverdieping aan elkaar.
    { van: "gallery", naar: "crossing", breedte: 58 },
    { van: "crossing", naar: "vault", breedte: 58 },

    // En naar de diepte. Deze zijn krap: het voelt als afdalen.
    { van: "gallery", naar: "sump", breedte: 50 },
    { van: "crossing", naar: "black", breedte: 50 },
    { van: "vault", naar: "throat", breedte: 50 },
    // Eén verbinding op de bodem, zodat de diepte ook een ronde heeft.
    { van: "sump", naar: "black", breedte: 46 },
];

/**
 * De kisten, per kamer.
 *
 * `dx` is de plek BINNEN de kamer, van 0 tot 1. Zo schuift een kist mee als een
 * kamer van maat verandert en kan hij nooit per ongeluk in de rots belanden -
 * dezelfde reden waarom huizen en steigers uit hun eiland worden afgeleid in
 * plaats van ingetypt.
 *
 * ER IS GEEN `dy`, EN DAT IS EEN REPARATIE. Elke kist stond op een breuk van de
 * kamerhoogte, tussen 0,6 en 0,74, en dat is midden in het water. Een kist die
 * daar hangt is niet alleen raar om te zien; hij is bijna niet te pakken. Je
 * grijpt binnen 37 eenheden van het midden van de kist, drijfvermogen duwt je
 * omhoog zodra je loslaat, en de plek waar je vanzelf uitkomt als je omlaag
 * zwemt is de BODEM. Met een kist op 0,7 van een kamer van 240 hoog zit die
 * bodem er 61 onder: buiten bereik, terwijl je er recht onder ligt.
 *
 * Een kist ligt dus op de grond, net als op het land, en dat leidt hij af uit
 * zijn kamer. Alleen `dx` is nog een keuze.
 */
export const DIEPTE_KISTEN = [
    { id: "reef-1", kamer: "reef", dx: 0.25 },
    // Het duikpak. Ondiep en bij de eerste ingang, want een pak achter de
    // plekken die het opent is een deur waarvan de sleutel erachter ligt.
    { id: "reef-2", kamer: "reef", dx: 0.75, pak: true },
    { id: "arch-1", kamer: "arch-hall", dx: 0.3 },
    { id: "arch-2", kamer: "arch-hall", dx: 0.78 },
    { id: "hold-1", kamer: "hold", dx: 0.35 },
    { id: "mouth-1", kamer: "cut-mouth", dx: 0.6 },

    { id: "gallery-1", kamer: "gallery", dx: 0.18 },
    { id: "gallery-2", kamer: "gallery", dx: 0.82 },
    { id: "crossing-1", kamer: "crossing", dx: 0.5 },
    { id: "vault-1", kamer: "vault", dx: 0.7 },

    // De diepte: zonder duikpak kom je hier niet heen en weer.
    { id: "sump-1", kamer: "sump", dx: 0.3, diep: true },
    { id: "black-1", kamer: "black", dx: 0.5, diep: true },
    { id: "black-2", kamer: "black", dx: 0.85, diep: true },
    { id: "throat-1", kamer: "throat", dx: 0.5, diep: true },
];

/**
 * Hoe hoog het midden van een kist boven de bodem van zijn kamer ligt.
 *
 * De kist wordt getekend van `y - 15` tot `y + 15`, dus dit is precies de halve
 * hoogte: de onderkant raakt de bodem en niets steekt erdoorheen.
 */
export const KIST_HALVE_HOOGTE = 15;

/**
 * Hoe dicht het MIDDEN van Bucky bij het midden van een kist moet zijn om hem
 * te kunnen openen. Staat hier en niet in `boat.js`, zodat de wereldtest met
 * hetzelfde getal kan rekenen als het spel: een kist die je in theorie kunt
 * bereiken maar in de praktijk niet kunt pakken is nog steeds onbereikbaar, en
 * dat verschil was precies wat de vorige versie niet kon zien.
 */
export const GRIJP_AFSTAND = 37;

/** Welke kist het duikpak bevat. */
export const PAK_KIST = DIEPTE_KISTEN.find((k) => k.pak).id;

/** Hoeveel lucht je hebt, gegeven wat je bij je hebt. */
export function zuurstofVoorraad(heeftPak) {
    return heeftPak ? ZUURSTOF_MET_PAK : ZUURSTOF_MAX;
}

export function kamerOp(id) {
    return KAMERS.find((k) => k.id === id) || null;
}

function midden(kamer) {
    return { x: kamer.x + kamer.w / 2, y: kamer.y + kamer.h / 2 };
}

/**
 * De rechthoeken waaruit een gang bestaat.
 *
 * GANGEN VERBINDEN DE DICHTSTBIJZIJNDE WANDEN, niet de middelpunten.
 *
 * De eerste opzet liep van middelpunt naar middelpunt, en dat maakt van elke
 * verbinding een omweg: een kamer die recht onder een andere ligt kreeg eerst
 * een stuk opzij en dan pas omlaag. Gemeten kostte dat de galerij op de
 * middenverdieping zestienhonderd eenheden vanaf de lucht, oftewel tweeëndertig
 * seconden heen en weer tegen zesentwintig seconden voorraad - een verdieping
 * die alleen met duikpak te bezoeken was, terwijl hij juist bedoeld is als de
 * reden om verder te zwemmen VOORDAT je dat pak hebt.
 *
 * Nu: overlappen twee kamers in x, dan gaat de gang recht omlaag door die
 * overlap. Overlappen ze in y, dan recht opzij. Alleen als geen van beide, komt
 * er een knik - en dan nog vanaf de rand en niet vanaf het midden.
 */
export function gangDelen(gang) {
    const a = kamerOp(gang.van), b = kamerOp(gang.naar);
    if (!a || !b) return [];
    const halve = gang.breedte / 2;

    // HOE VER EEN GANG DE KAMER IN STEEKT, EN WAAROM DAT NIET KLEIN MAG ZIJN.
    //
    // Botsing werkt met een straal: je mag pas ergens staan als je er met je
    // hele omvang in past. Als een gang de kamer maar vier eenheden overlapt,
    // houdt de kamer op elf eenheden voor zijn rand op en begint de gang elf
    // eenheden na de zijne - en daartussen ligt een strook waar je niet mag
    // staan. De hele wereld was daardoor onbereikbaar terwijl elk los punt
    // gewoon zwembaar was: de gaten zaten precies op de naden.
    //
    // De overlap moet dus groter zijn dan Bucky's DIAMETER, niet dan zijn
    // straal. Dertig is ruim genoeg en valt niet op.
    const nis = 30;

    // Overlap in x: een verticale schacht door het gedeelde stuk.
    const xVan = Math.max(a.x, b.x), xTot = Math.min(a.x + a.w, b.x + b.w);
    if (xTot - xVan > gang.breedte) {
        const x = (xVan + xTot) / 2;
        const boven = a.y < b.y ? a : b;
        const onder = a.y < b.y ? b : a;
        return [{ x: x - halve, y: boven.y + boven.h - nis,
                  w: gang.breedte,
                  h: (onder.y - (boven.y + boven.h)) + nis * 2 }];
    }

    // Overlap in y: een horizontale gang door het gedeelde stuk.
    const yVan = Math.max(a.y, b.y), yTot = Math.min(a.y + a.h, b.y + b.h);
    if (yTot - yVan > gang.breedte) {
        const y = (yVan + yTot) / 2;
        const links = a.x < b.x ? a : b;
        const rechts = a.x < b.x ? b : a;
        return [{ x: links.x + links.w - nis, y: y - halve,
                  w: (rechts.x - (links.x + links.w)) + nis * 2,
                  h: gang.breedte }];
    }

    // Geen overlap: een knik van rand naar rand.
    const boven = a.y <= b.y ? a : b;
    const onder = a.y <= b.y ? b : a;
    const bx = boven.x + boven.w / 2;
    const ox = klem(bx, onder.x + halve + 4, onder.x + onder.w - halve - 4);
    const knikY = boven.y + boven.h + gang.breedte;
    return [
        { x: bx - halve, y: boven.y + boven.h - nis,
          w: gang.breedte, h: (knikY - boven.y - boven.h) + halve + nis },
        { x: Math.min(bx, ox) - halve, y: knikY - halve,
          w: Math.abs(ox - bx) + gang.breedte, h: gang.breedte },
        { x: ox - halve, y: knikY - halve,
          w: gang.breedte, h: (onder.y - knikY) + gang.breedte + nis },
    ];
}

/** Klemmen tussen twee grenzen. */
function klem(v, min, max) {
    return v < min ? min : (v > max ? max : v);
}

let gangCache = null;

/** Alle gangdelen, één keer uitgerekend. */
export function alleGangDelen() {
    if (!gangCache) {
        gangCache = GANGEN.flatMap((g) => gangDelen(g).map((d) => ({ ...d, gang: g })));
    }
    return gangCache;
}

/** De wereldpositie van een kist: op `dx` in zijn kamer, op de BODEM. */
export function kistPositie(kist) {
    const kamer = kamerOp(kist.kamer);
    if (!kamer) return null;
    return {
        x: kamer.x + kamer.w * kist.dx,
        y: kamer.y + kamer.h - KIST_HALVE_HOOGTE,
        kamer,
    };
}

/** Ligt (x, y) in open water - dus in een kamer of in een gang? */
export function inRuimte(x, y, straal = 0) {
    for (const k of KAMERS) {
        if (x > k.x + straal && x < k.x + k.w - straal
            && y > k.y + straal && y < k.y + k.h - straal) return true;
    }
    for (const d of alleGangDelen()) {
        if (x > d.x + straal && x < d.x + d.w - straal
            && y > d.y + straal && y < d.y + d.h - straal) return true;
    }
    return false;
}

/** Mag Bucky hier zwemmen? */
export function magZwemmen(x, y, straal) {
    if (x < 0 || x > DIEPTE_WERELD.breedte) return false;
    if (y > DIEPTE_WERELD.diepte) return false;
    return inRuimte(x, y, straal);
}

/** Is hij aan de oppervlakte, waar hij kan ademen? */
export function aanDeOppervlakte(y) {
    return y < 26;
}

/** Waar je te water gaat, gegeven de duikplek waar je boven ligt. */
export function instappunt(duikplekId) {
    const kamer = KAMERS.find((k) => k.ingang === duikplekId) || KAMERS[0];
    return { x: kamer.x + kamer.w / 2, y: 12, kamer };
}

/**
 * De kortste zwemafstand vanaf de lucht naar elk punt.
 *
 * Hiermee wordt nagerekend of een kist te halen is: heen en terug binnen je
 * voorraad. Dat is de enige manier om te WETEN dat een grot een uitdaging is en
 * geen val - aan de coördinaten zie je het niet, en dat is hier al drie keer
 * gebleken.
 */
export function afstandVanafDeLucht(straal = 11, stap = 20) {
    const kolommen = Math.ceil(DIEPTE_WERELD.breedte / stap) + 1;
    const rijen = Math.ceil((DIEPTE_WERELD.diepte + 80) / stap) + 1;
    const afstand = new Float64Array(kolommen * rijen).fill(Infinity);
    const index = (i, j) => j * kolommen + i;
    const punt = (i, j) => [i * stap, j * stap - 60];
    const rij = [];

    for (let i = 0; i < kolommen; i++) {
        for (let j = 0; j < rijen; j++) {
            const [x, y] = punt(i, j);
            if (!aanDeOppervlakte(y)) break;
            if (!magZwemmen(x, y, straal)) continue;
            afstand[index(i, j)] = 0;
            rij.push([i, j]);
        }
    }

    let kop = 0;
    while (kop < rij.length) {
        const [i, j] = rij[kop++];
        const hier = afstand[index(i, j)];
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= kolommen || nj >= rijen) continue;
            if (afstand[index(ni, nj)] <= hier + stap) continue;
            const [x, y] = punt(ni, nj);
            if (!magZwemmen(x, y, straal)) continue;
            afstand[index(ni, nj)] = hier + stap;
            rij.push([ni, nj]);
        }
    }

    return (x, y) => {
        const i = Math.round(x / stap), j = Math.round((y + 60) / stap);
        if (i < 0 || j < 0 || i >= kolommen || j >= rijen) return Infinity;
        return afstand[index(i, j)];
    };
}

/** Waar je kunt duiken, boven water. */
export const DUIKPLEKKEN = [
    { id: "home-shallows", naam: "The Shallows",
      x: START.x + 30, y: START.y + 20 },
    { id: "the-arches", naam: "The Arches", x: 2540, y: 2380 },
    { id: "the-wreck", naam: "The Wreck", x: 4180, y: 1260 },
    { id: "deep-cut", naam: "Deep Cut", x: 3760, y: 3560 },
];
