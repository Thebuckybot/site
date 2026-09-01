/**
 * DUIKEN IN OPEN WATER.
 *
 * Boven water kijk je van BOVEN; onder water kijk je van OPZIJ. Dat is een
 * andere camera en een ander soort ruimte, en dat is met opzet: een duik moet
 * voelen als ergens anders zijn en niet als hetzelfde spel met een blauw
 * filter. Het scheelt bovendien dat diepte in een zijaanzicht gewoon omlaag is,
 * zodat een zuurstofmeter en "boven komen" betekenis hebben zonder uitleg.
 *
 * DE RUIMTE IS EEN LIJST RECHTHOEKEN, net als een interieur. Rots is massief,
 * de rest is water, en een grot is dus niet een voorwerp maar een GAT tussen de
 * rotsen. Dat kost vier vergelijkingen per blok om op te botsen, het is met de
 * hand te lezen, en het is precies dezelfde botsingscode als binnenshuis - er
 * hoefde niets nieuws voor bedacht te worden.
 *
 * DE ZUURSTOF loopt af zolang je onder water bent en vult zich bij aan de
 * oppervlakte. Raakt hij op, dan verlies je NIETS: Bucky drijft vanzelf naar
 * boven en je staat weer bij je boot, met alles wat je gevonden had. Straf in
 * de vorm van voortgang afnemen hoort niet in een spel waar je voor je plezier
 * rondvaart - de spanning zit in of je het haalt, niet in wat je kwijtraakt.
 */

import { START } from "./wereld.js";

/**
 * Waar je kunt duiken. Open water, dus gewoon een plek met een naam.
 *
 * De eerste ligt PAL BIJ HET STARTPUNT, en dat is een keuze en geen toeval.
 * Duiken is de enige werkwoord in dit spel dat je nergens aan ziet: een steiger
 * en een huis staan in beeld, maar een duikplek is een stukje water dat er
 * hetzelfde uitziet als al het andere water. Wie er niet toevallig overheen
 * vaart, ontdekt nooit dat het bestaat. Er een onder je kiel leggen bij het
 * begin lost dat op zonder een uitlegscherm.
 */
export const DUIKPLEKKEN = [
    { id: "home-shallows", naam: "The Shallows",
      x: START.x + 30, y: START.y + 20, plek: "rif" },
    { id: "the-shelf", naam: "The Shelf", x: 2540, y: 2380, plek: "rif" },
    { id: "blue-hole", naam: "Blue Hole", x: 1520, y: 2150, plek: "grot" },
    { id: "the-wreck", naam: "The Wreck", x: 4180, y: 1260, plek: "wrak" },
    { id: "deep-cut", naam: "Deep Cut", x: 3760, y: 3560, plek: "grot" },
];

/**
 * De onderwaterplekken.
 *
 * `rots` zijn massieve blokken; alles daarbuiten is water. `kisten` liggen in
 * de gaten ertussen, dus je moet de grot echt in om erbij te komen.
 *
 * De oppervlakte is y = 0. Hoe hoger het getal, hoe dieper - net als op een
 * dieptekaart, en net als de intuïtie van iemand die naar het scherm kijkt.
 */
export const DUIKPLAATSEN = {
    rif: {
        naam: "The Shelf",
        breedte: 900, diepte: 560,
        // Een open rif: makkelijk, ondiep, en je kunt altijd snel boven komen.
        rots: [
            { x: 0, y: 470, w: 900, h: 90 },        // de bodem
            { x: 120, y: 330, w: 190, h: 150 },
            { x: 420, y: 380, w: 130, h: 100 },
            { x: 640, y: 300, w: 210, h: 180 },
        ],
        kisten: [
            { id: "rif-1", x: 350, y: 430 },
            { id: "rif-2", x: 590, y: 440 },
        ],
    },

    grot: {
        naam: "The Cave",
        breedte: 1000, diepte: 700,
        // Een grot: een gang die naar links wegloopt onder een dik rotsdak. Je
        // moet er echt in, en dan is boven komen niet meer een kwestie van
        // omhoog zwemmen - dat is waar de zuurstofmeter over gaat.
        rots: [
            { x: 0, y: 610, w: 1000, h: 90 },       // de bodem
            { x: 0, y: 250, w: 420, h: 250 },       // het dak van de gang
            { x: 0, y: 560, w: 300, h: 60 },        // de vloer van de gang
            { x: 560, y: 180, w: 440, h: 200 },
            { x: 760, y: 430, w: 240, h: 190 },
        ],
        kisten: [
            { id: "grot-diep", x: 90, y: 530 },     // achterin de gang
            { id: "grot-rand", x: 640, y: 560 },
        ],
    },

    wrak: {
        naam: "The Wreck",
        breedte: 1000, diepte: 640,
        // Een gezonken romp die op de bodem ligt: twee dekken met een gat
        // ertussen waar je doorheen moet.
        rots: [
            { x: 0, y: 550, w: 1000, h: 90 },
            { x: 180, y: 300, w: 620, h: 40 },      // bovendek
            { x: 180, y: 440, w: 260, h: 40 },      // benedendek, links
            { x: 560, y: 440, w: 240, h: 40 },      // benedendek, rechts
            { x: 180, y: 300, w: 40, h: 180 },      // de boeg
            { x: 760, y: 300, w: 40, h: 180 },      // de spiegel
        ],
        kisten: [
            { id: "wrak-ruim", x: 490, y: 510 },
            { id: "wrak-dek", x: 300, y: 400 },
        ],
    },
};

/** Hoeveel seconden lucht je hebt. */
export const ZUURSTOF_MAX = 26;

/** Zit (x, y) in de rots? */
export function inRots(plaats, x, y, straal) {
    for (const r of plaats.rots) {
        const cx = Math.max(r.x, Math.min(x, r.x + r.w));
        const cy = Math.max(r.y, Math.min(y, r.y + r.h));
        if (Math.hypot(x - cx, y - cy) < straal) return true;
    }
    return false;
}

/** Mag Bucky hier zwemmen? */
export function magZwemmen(plaats, x, y, straal) {
    if (x < straal || x > plaats.breedte - straal) return false;
    if (y > plaats.diepte - straal) return false;
    // Boven de waterlijn mag hij wel - dat is juist waar hij lucht haalt.
    return !inRots(plaats, x, y, straal);
}

/** Is hij aan de oppervlakte, waar hij kan ademen? */
export function aanDeOppervlakte(y) {
    return y < 26;
}
