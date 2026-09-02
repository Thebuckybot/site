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
 * rotsen. Vier vergelijkingen per blok om op te botsen, met de hand te lezen,
 * en het is dezelfde botsingscode als binnenshuis.
 *
 * DAT MODEL DOET MEER DAN HET LIJKT. Een boog om onderdoor te zwemmen is twee
 * pilaren met een blok erboven; een smalle doorgang is twee blokken met ruimte
 * ertussen; een gezonken romp is een schil van dunne blokken met een gat erin.
 * Er hoefde niets nieuws bedacht te worden voor "onderdoor zwemmen" - dat is
 * precies wat een zijaanzicht met massieve blokken vanzelf oplevert, en het is
 * ook wat het leuk maakt.
 *
 * DE ZUURSTOF IS DE SPANNINGSBOOG. Hij loopt af onder water en vult bij aan de
 * oppervlakte, dus hoe dieper een grot loopt, hoe verder je van de lucht bent -
 * de meetkunde doet het werk, er is geen extra straf voor nodig.
 *
 * En raakt hij op, dan verlies je NIETS: Bucky drijft naar boven en je staat
 * weer bij je boot, met alles wat je gevonden had. De spanning zit in of je het
 * haalt, niet in wat het kost als het niet lukt.
 */

import { START } from "./wereld.js";

/**
 * Waar je kunt duiken.
 *
 * De eerste ligt PAL BIJ HET STARTPUNT, en dat is een keuze en geen toeval.
 * Een duikplek is water dat er hetzelfde uitziet als al het andere water; wie
 * er niet toevallig overheen vaart ontdekt nooit dat duiken bestaat. Er een
 * onder je kiel leggen bij het begin lost dat op zonder uitlegscherm.
 */
export const DUIKPLEKKEN = [
    { id: "home-shallows", naam: "The Shallows",
      x: START.x + 30, y: START.y + 20, plek: "rif" },
    { id: "the-arches", naam: "The Arches", x: 2540, y: 2380, plek: "bogen" },
    { id: "blue-hole", naam: "Blue Hole", x: 1520, y: 2150, plek: "grot" },
    { id: "the-wreck", naam: "The Wreck", x: 4180, y: 1260, plek: "wrak" },
    { id: "deep-cut", naam: "Deep Cut", x: 3760, y: 3560, plek: "kloof" },
    { id: "the-chimney", naam: "The Chimney", x: 5900, y: 2600, plek: "grot" },
];

/** Hoeveel seconden lucht je hebt, zonder en met duikpak. */
export const ZUURSTOF_MAX = 26;
export const ZUURSTOF_MET_PAK = 52;

/**
 * De onderwaterplekken.
 *
 * `rots` zijn massieve blokken; alles daarbuiten is water. `kisten` liggen in
 * de gaten ertussen. De oppervlakte is y = 0; hoe hoger het getal, hoe dieper -
 * net als op een dieptekaart.
 *
 * Een kist met `pak: true` ligt zo diep dat je er zonder duikpak niet heen en
 * weer komt. Dat wordt NAGEREKEND in tests/test_boot_wereld.js: die zoekt de
 * kortste weg vanaf de oppervlakte en vergelijkt de zwemtijd heen en terug met
 * je luchtvoorraad. Zo kan er geen kist ontstaan die onbereikbaar is, en ook
 * geen "diepe" kist die je stiekem gewoon zonder pak haalt.
 */
export const DUIKPLAATSEN = {
    rif: {
        naam: "The Shelf",
        breedte: 900, diepte: 500,
        // Ondiep en open: dit is waar je leert dat duiken bestaat. Alles is
        // binnen bereik zonder pak, en je kunt altijd snel boven komen.
        rots: [
            { x: 0, y: 420, w: 900, h: 90 },        // de bodem
            { x: 120, y: 300, w: 190, h: 130 },
            { x: 430, y: 350, w: 120, h: 80 },
            { x: 640, y: 280, w: 210, h: 150 },
        ],
        kisten: [
            { id: "rif-1", x: 360, y: 385 },
            { id: "rif-2", x: 590, y: 390 },
        ],
    },

    bogen: {
        naam: "The Arches",
        breedte: 1200, diepte: 620,
        // Links van de eerste hangende muur, want in het midden hangt er een.
        instap: 110,
        // ONDERDOOR ZWEMMEN, EN DE EERSTE OPZET KON DAT NIET.
        //
        // Ik had bogen gemaakt van twee pilaren met een blok erboven. Dat ZIET
        // eruit als een boog, maar het is een nis: de pilaren staan op de bodem
        // en sluiten de zijkanten af, dus de ruimte eronder is nergens mee
        // verbonden. De drie kisten die eronder lagen waren letterlijk
        // onbereikbaar - de test die de kortste weg vanaf de oppervlakte
        // uitrekent gaf voor alle drie oneindig.
        //
        // Een boog om ONDERDOOR te zwemmen is geen paar pilaren maar een MUUR
        // DIE VAN BOVEN HANGT: massief van het dak tot halverwege, en daaronder
        // ruimte tot de bodem. Dan verbindt de opening links met rechts, en dat
        // is precies wat "eronderdoor" betekent.
        rots: [
            { x: 0, y: 520, w: 1200, h: 100 },      // de bodem
            // Drie hangende muren met steeds minder ruimte eronder. Je gaat er
            // van links naar rechts onderdoor, en elke volgende is krapper.
            { x: 220, y: 0, w: 90, h: 370 },        // ruim: 150 hoog eronder
            { x: 560, y: 0, w: 110, h: 420 },       // krapper: 100 hoog
            { x: 900, y: 0, w: 90, h: 450 },        // krap: 70 hoog
            // Losse rotsen op de bodem, om tussendoor te zwemmen.
            { x: 380, y: 430, w: 110, h: 90 },
            { x: 730, y: 450, w: 120, h: 70 },
        ],
        kisten: [
            { id: "bogen-1", x: 430, y: 400 },      // na de eerste boog
            { id: "bogen-2", x: 800, y: 415 },      // na de tweede
            { id: "bogen-3", x: 1090, y: 480 },     // achter de krapste
        ],
    },

    grot: {
        naam: "The Cave",
        breedte: 1200, diepte: 780,
        // EEN GANGENSTELSEL DAT ERGENS HEEN LEIDT.
        //
        // Vanaf de schacht in het midden loopt een gang naar links, die uitkomt
        // in een kamer; uit die kamer loopt een tweede, langere gang terug naar
        // rechts en dieper, naar de achterkamer. Geen enkele gang loopt dood:
        // elke gang komt uit in een ruimte met iets erin. Doodlopende gangen
        // zijn tijd die je kwijtraakt zonder er iets voor terug te krijgen, en
        // met een zuurstofmeter is dat straf in plaats van spanning.
        rots: [
            { x: 0, y: 700, w: 1200, h: 80 },       // de bodem
            // Het dak boven de eerste gang; de schacht ernaast blijft open.
            { x: 0, y: 150, w: 470, h: 260 },
            // De vloer van de eerste gang, met achterin een gat naar beneden.
            { x: 100, y: 500, w: 370, h: 60 },
            // De tussenwand die de tweede gang van de eerste scheidt.
            //
            // DE MAAT VAN EEN GANG IS EEN EIS EN GEEN SMAAK. Hier stond de
            // wand op y 620 met een dak op 560-600, en dat laat twintig
            // eenheden over terwijl Bucky er tweeëntwintig breed is. De gang
            // was dus dicht, en de kist erachter onbereikbaar - de test die de
            // kortste weg narekent gaf oneindig. Aan de getallen zie je zoiets
            // niet; je ziet vier rechthoeken die er redelijk uitzien.
            { x: 180, y: 640, w: 800, h: 60 },
            // Het dak van de tweede gang. Zestig eenheden ruimte ertussen: krap
            // genoeg om als gang te voelen, ruim genoeg om door te komen.
            { x: 260, y: 540, w: 940, h: 40 },
            // De rechterkant boven, zodat je niet rechtstreeks naar beneden kunt.
            { x: 620, y: 150, w: 580, h: 330 },
        ],
        kisten: [
            { id: "grot-gang", x: 240, y: 460 },    // in de eerste gang
            { id: "grot-kamer", x: 60, y: 620 },    // in de kamer eronder
            // Achterin de tweede gang, helemaal rechts: ver genoeg om zonder
            // pak niet heen en weer te komen.
            { id: "grot-achter", x: 1120, y: 660, pak: true },
        ],
    },

    wrak: {
        naam: "The Wreck",
        breedte: 1150, diepte: 660,
        // EEN GEZONKEN ROMP: een schil van dunne blokken met gaten erin, dus je
        // zwemt er onderdoor en er doorheen. Het ruim is alleen te bereiken via
        // het gat in het bovendek.
        rots: [
            { x: 0, y: 570, w: 1150, h: 90 },
            { x: 200, y: 280, w: 300, h: 26 },      // bovendek, voor
            { x: 580, y: 280, w: 300, h: 26 },      // bovendek, achter
            { x: 190, y: 280, w: 26, h: 180 },      // boeg
            { x: 864, y: 280, w: 26, h: 180 },      // spiegel
            { x: 190, y: 440, w: 260, h: 26 },      // benedendek, links
            { x: 620, y: 440, w: 270, h: 26 },      // benedendek, rechts
            { x: 980, y: 380, w: 170, h: 190 },     // een rots naast het wrak
        ],
        kisten: [
            { id: "wrak-dek", x: 320, y: 400 },     // tussen de dekken
            { id: "wrak-ruim", x: 540, y: 530 },    // in het ruim
        ],
    },

    kloof: {
        naam: "Deep Cut",
        breedte: 1000, diepte: 1400,
        // EEN SPLEET DIE ZIGZAGT NAAR BENEDEN.
        //
        // Hier doet de zuurstof precies wat hij moet doen: elke meter dieper is
        // een meter verder van de lucht. Een rechte koker zou dat ook doen, maar
        // die is te snel af - de eerste versie was 780 eenheden diep en daarmee
        // zonder pak ruim te halen, zodat het pak versiering werd. De richels
        // dwingen je heen en weer, en dan telt de WEG en niet de diepte.
        rots: [
            { x: 0, y: 1330, w: 1000, h: 70 },
            { x: 0, y: 120, w: 380, h: 1210 },      // de linkerwand
            { x: 620, y: 120, w: 380, h: 1210 },    // de rechterwand
            // Richels die om en om de spleet afsluiten, zodat je moet slalommen.
            { x: 380, y: 320, w: 170, h: 55 },
            { x: 450, y: 520, w: 170, h: 55 },
            { x: 380, y: 720, w: 170, h: 55 },
            { x: 450, y: 920, w: 170, h: 55 },
            { x: 380, y: 1120, w: 170, h: 55 },
        ],
        kisten: [
            { id: "kloof-boven", x: 500, y: 260 },
            { id: "kloof-diep", x: 500, y: 1280, pak: true },
        ],
    },
};

/**
 * Waar het duikpak ligt.
 *
 * In het rif, dat de ondiepste plek is en pal bij het startpunt ligt. Het pak
 * moet te VINDEN zijn zonder pak, anders is het een deur waarvan de sleutel
 * achter diezelfde deur ligt.
 */
export const PAK_KIST = "rif/rif-2";

/**
 * Waar je te water gaat op een duikplaats.
 *
 * Het midden is de terugval, maar dat is niet altijd goed: op The Arches hangt
 * daar een muur van boven, en dan kom je neer IN de rots en zit je vast op het
 * moment dat je begint. Een instappunt is dus iets van de plaats zelf, en niet
 * iets dat je uit zijn breedte afleidt.
 */
export function instappunt(plaats) {
    return {
        x: plaats.instap !== undefined ? plaats.instap : plaats.breedte / 2,
        y: 12,
    };
}

/** Hoeveel lucht je hebt, gegeven wat je bij je hebt. */
export function zuurstofVoorraad(heeftPak) {
    return heeftPak ? ZUURSTOF_MET_PAK : ZUURSTOF_MAX;
}

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
    // Boven de waterlijn mag hij wel - daar haalt hij juist lucht.
    return !inRots(plaats, x, y, straal);
}

/** Is hij aan de oppervlakte, waar hij kan ademen? */
export function aanDeOppervlakte(y) {
    return y < 26;
}

/**
 * De kortste zwemafstand van de oppervlakte naar elk punt, als raster.
 *
 * Hiermee wordt in de test nagerekend of een kist te halen is: heen en terug
 * binnen je luchtvoorraad. Dat is de enige manier om te WETEN dat een grot een
 * uitdaging is en geen val - aan de coördinaten zie je het niet.
 *
 * Geeft een functie terug die voor een punt de afstand geeft, of Infinity als
 * het niet te bereiken is.
 */
export function afstandVanafDeLucht(plaats, straal = 11, stap = 10) {
    const kolommen = Math.ceil(plaats.breedte / stap) + 1;
    const rijen = Math.ceil(plaats.diepte / stap) + 2;
    const afstand = new Float64Array(kolommen * rijen).fill(Infinity);
    const index = (i, j) => j * kolommen + i;
    const rij = [];

    // Alles wat aan de oppervlakte ligt is een startpunt: daar is lucht.
    for (let i = 0; i < kolommen; i++) {
        const x = i * stap;
        for (let j = 0; j < rijen; j++) {
            const y = j * stap - 10;
            if (!aanDeOppervlakte(y)) break;
            if (!magZwemmen(plaats, x, y, straal)) continue;
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
            const x = ni * stap, y = nj * stap - 10;
            if (!magZwemmen(plaats, x, y, straal)) continue;
            afstand[index(ni, nj)] = hier + stap;
            rij.push([ni, nj]);
        }
    }

    return (x, y) => {
        const i = Math.round(x / stap);
        const j = Math.round((y + 10) / stap);
        if (i < 0 || j < 0 || i >= kolommen || j >= rijen) return Infinity;
        return afstand[index(i, j)];
    };
}
