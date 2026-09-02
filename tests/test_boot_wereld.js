/**
 * De wereldbeschrijving van Open Water, zonder browser en zonder te sturen.
 *
 * WAAROM DIT ER NIET ALS SCHERMTEST IS
 * De eerste opzet reed de boot met pijltjestoetsen naar het gat in de kust en
 * las de kleur naast de romp uit. Dat werkte niet: sturen is te grof om een gat
 * van veertig eenheden mee te raken, dus dezelfde toetsaanslagen kwamen de ene
 * keer wel en de andere keer niet bij de steiger - en een test die met en zonder
 * de fout hetzelfde antwoord geeft, bewijst niets.
 *
 * De wereld is een som. Die hoort ook zo getest te worden: exact, op de rand,
 * en in een halve seconde.
 *
 * DRAAIEN:  node tests/test_boot_wereld.js
 */

import {
    EILANDEN, STEIGERS, eilandOp, straalOp, opLand, landOnder, kustSoort,
    steigerMaten, opSteiger, dichtstbijzijndeLand, huisMaten, START, WERELD,
} from "../js/minigames/boat/wereld.js";
import {
    INTERIEURS, HUIZEN, HUIS_MAAT, magLopenBinnen, bijDeur, deurStart,
} from "../js/minigames/boat/binnen.js";
import {
    DUIKPLEKKEN, DUIKPLAATSEN, magZwemmen, aanDeOppervlakte, ZUURSTOF_MAX,
    ZUURSTOF_MET_PAK, PAK_KIST, zuurstofVoorraad, afstandVanafDeLucht,
    instappunt,
} from "../js/minigames/boat/duiken.js";

let mislukt = 0;

function eis(beschrijving, gemeten, verwacht) {
    if (gemeten === verwacht) {
        console.log(`  OK   ${beschrijving}`);
    } else {
        console.log(`  FOUT ${beschrijving} (verwacht ${verwacht}, kreeg ${gemeten})`);
        mislukt++;
    }
}

function eisWaar(beschrijving, gemeten) { eis(beschrijving, !!gemeten, true); }

console.log("De wereld van Open Water\n");

// --- de vorm van een eiland ---------------------------------------------
console.log("De straalfunctie:");
for (const e of EILANDEN) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 720; i++) {
        const r = straalOp(e, (i / 720) * Math.PI * 2);
        if (r < min) min = r;
        if (r > max) max = r;
    }
    // Een eiland dat naar binnen klapt heeft een omtrek die zichzelf kruist, en
    // dan klopt geen enkele botsing meer. De ondergrens in `straalOp` hoort dat
    // te voorkomen, maar een vorm die hem NODIG heeft is een vorm die te wild
    // is afgesteld - dan hoort deze test om te vallen zodat iemand kijkt.
    eisWaar(`${e.naam}: de straal blijft positief (min ${Math.round(min)})`, min > 20);
    eisWaar(`${e.naam}: de vorm is niet ontaard (max/min = ${(max / min).toFixed(1)})`,
            max / min < 3.5);
}

// --- begaanbaarheid ------------------------------------------------------
console.log("\nWat land is en wat water:");
const land = eilandOp("the-mainland");
// NIET het middelpunt: daar ligt het binnenmeer. Mijn eerste versie van deze
// test nam aan dat het midden van een eiland vanzelf land is, en die aanname
// klopt precies niet meer sinds er water IN het land kan liggen. De test vond
// dus zijn eigen aanname, en niet een fout in de code.
eisWaar("een punt op The Mainland, buiten het meer, is land",
        opLand(land, land.x + 300, land.y - 200));
eisWaar("ver buiten The Mainland is geen land",
        !opLand(land, land.x + land.r * 2, land.y));

// Het binnenmeer is een gat in de begaanbaarheid.
const meer = land.meren[0];
eisWaar("het midden van het binnenmeer is GEEN land",
        !opLand(land, land.x + meer.dx, land.y + meer.dy));
eisWaar("net buiten het binnenmeer is wel land",
        opLand(land, land.x + meer.dx + meer.r + 30, land.y + meer.dy));

eis("open water hoort bij geen enkel eiland", landOnder(START.x, START.y), null);
eisWaar("het startpunt ligt binnen de wereld",
        START.x > 0 && START.x < WERELD.w && START.y > 0 && START.y < WERELD.h);

// --- kustsoorten ---------------------------------------------------------
console.log("\nKustsoorten:");
const soorten = new Set();
for (const e of EILANDEN) {
    for (let i = 0; i < 360; i++) soorten.add(kustSoort(e, (i / 360) * Math.PI * 2));
}
eisWaar(`er komen drie soorten kust voor (${[...soorten].sort().join(", ")})`,
        soorten.has("strand") && soorten.has("rots") && soorten.has("klif"));
// Een band die buiten zijn eiland valt is een tikfout die je nergens aan ziet.
for (const e of EILANDEN) {
    for (const band of e.banden || []) {
        eisWaar(`${e.naam}: band ${band.van}-${band.tot} ligt binnen een omloop`,
                band.van >= 0 && band.van <= Math.PI * 2
                && band.tot >= 0 && band.tot <= Math.PI * 2);
    }
}

// --- de steigers, en het open punt --------------------------------------
console.log("\nDe steigers:");
for (const st of STEIGERS) {
    const m = steigerMaten(st);
    const naam = `${m.eiland.naam} (hoek ${st.hoek.toFixed(2)})`;

    // HET OPEN PUNT. De steiger stak dwars door de kustlijn heen, dus je lag
    // altijd op de planken. Hij hoort vanaf de kust naar BUITEN te lopen: het
    // punt op zee ligt verder van het middelpunt dan de kustlijn daar.
    const totZee = Math.hypot(m.zee.x - m.eiland.x, m.zee.y - m.eiland.y);
    eisWaar(`${naam}: het uiteinde ligt op zee`,
            totZee > straalOp(m.eiland, st.hoek) + st.lengte * 0.8);
    eisWaar(`${naam}: het uiteinde is geen land`, landOnder(m.zee.x, m.zee.y) === null);

    // EN DE LIGPLAATS LIGT NAAST DE PLANKEN, niet erop. Dit is de eigenschap
    // waar het hele open punt om draaide.
    eisWaar(`${naam}: de ligplaats ligt NAAST de steiger`,
            !opSteiger(m.ligplaats.x, m.ligplaats.y, m));
    eisWaar(`${naam}: de ligplaats ligt op water`,
            landOnder(m.ligplaats.x, m.ligplaats.y) === null);
    // Maar wel binnen aanmeerbereik, anders kun je er nooit komen.
    const totMidden = Math.hypot(m.ligplaats.x - m.kust.x, m.ligplaats.y - m.kust.y);
    eisWaar(`${naam}: de ligplaats ligt binnen de lengte van de steiger`,
            totMidden < m.lengte + m.breedte);

    // De walkant is waar Bucky aan land stapt: die moet begaanbaar zijn.
    eisWaar(`${naam}: de walkant is land`,
            landOnder(m.walkant.x, m.walkant.y) !== null);

    // De plank zelf: het midden telt mee, ernaast niet.
    const midX = (m.kust.x + m.zee.x) / 2, midY = (m.kust.y + m.zee.y) / 2;
    eisWaar(`${naam}: het midden van de plank telt als steiger`,
            opSteiger(midX, midY, m));
    eisWaar(`${naam}: een plankbreedte opzij telt NIET meer`,
            !opSteiger(midX + m.dwars.x * (m.breedte + 4),
                       midY + m.dwars.y * (m.breedte + 4), m));
}

// --- de huizen -----------------------------------------------------------
console.log("\nDe huizen:");
for (const huis of HUIZEN) {
    const h = huisMaten(huis);
    const naam = `${h.eiland.naam} / ${huis.soort}`;

    // EEN HUIS IN HET WATER IS NIET AAN DE GETALLEN TE ZIEN. Er stond er een op
    // Low Hollow die precies in het binnenmeer viel: een hoek en een percentage
    // die er allebei redelijk uitzien, met een uitkomst die dat niet is. Dit is
    // de controle die dat vangt, en de reden dat het een berekende positie is en
    // geen ingetypte.
    eisWaar(`${naam}: staat op begaanbaar land`,
            landOnder(h.x, h.y, HUIS_MAAT.h) !== null);

    // En je moet er ook nog voor kunnen staan: de deur zit aan de onderkant.
    eisWaar(`${naam}: de plek voor de deur is begaanbaar`,
            landOnder(h.x, h.y + HUIS_MAAT.h, 8) !== null);

    eisWaar(`${naam}: er hoort een interieur bij`, !!INTERIEURS[huis.soort]);
}

console.log("\nDe binnenruimtes:");
for (const [soort, kamer] of Object.entries(INTERIEURS)) {
    // De deur moet in een muur liggen, niet ergens in het midden zweven.
    eisWaar(`${soort}: de deur ligt in de onderste muur`,
            Math.abs(kamer.deur.y + kamer.deur.h - kamer.hoogte) < 2);
    eisWaar(`${soort}: de deur past binnen de breedte`,
            kamer.deur.x > 0 && kamer.deur.x + kamer.deur.w < kamer.breedte);

    // WAAR JE BINNENKOMT MOET BEGAANBAAR ZIJN. Zet iemand een kast voor de deur,
    // dan sta je bij het betreden vast in het meubel en kun je geen kant op -
    // en dat merk je pas als je het speelt.
    const { x: startX, y: startY } = deurStart(kamer);
    eisWaar(`${soort}: de plek net binnen de deur is vrij`,
            magLopenBinnen(kamer, startX, startY, 11));
    eisWaar(`${soort}: en daar sta je bij de deur`, bijDeur(kamer, startX, startY));

    // Elk meubel moet binnen de kamer liggen; een tafel die half door de muur
    // steekt is een botsing waar je niet omheen kunt.
    for (const m of kamer.meubels) {
        eisWaar(`${soort}: meubel ${m.soort} ligt binnen de kamer`,
                m.x >= 0 && m.y >= 0
                && m.x + m.w <= kamer.breedte && m.y + m.h <= kamer.hoogte);
    }

    // En er moet ergens iets STAAN, anders is het geen kamer maar een vloer.
    eisWaar(`${soort}: er staan meubels`, kamer.meubels.length >= 4);
}

// --- de duikplekken ------------------------------------------------------
console.log("\nDe duikplekken:");
for (const plek of DUIKPLEKKEN) {
    // EEN DUIKPLEK OP HET LAND IS NIET TE BEREIKEN, en dat zie je aan de
    // getallen niet - net als bij het huis dat in het binnenmeer stond.
    eisWaar(`${plek.naam}: ligt op open water`,
            landOnder(plek.x, plek.y, 60) === null);
    eisWaar(`${plek.naam}: ligt binnen de wereld`,
            plek.x > 0 && plek.x < WERELD.w && plek.y > 0 && plek.y < WERELD.h);
    eisWaar(`${plek.naam}: heeft een onderwaterplaats`, !!DUIKPLAATSEN[plek.plek]);
}

console.log("\nDe onderwaterplaatsen:");

// HOE SNEL BUCKY ONGEVEER ZWEMT, en met opzet aan de LAGE kant.
//
// Onder water heeft hij versnelling en waterweerstand, dus zijn werkelijke
// snelheid hangt af van hoe recht je zwemt en hoeveel bochten er in een gang
// zitten. Honderd eenheden per seconde is voorzichtiger dan hij op een recht
// stuk haalt, en dat is de goede kant om in te zitten: een kist die volgens
// deze test net haalbaar is, is het in het spel ruim.
const ZWEMSNELHEID = 100;

for (const [soort, plaats] of Object.entries(DUIKPLAATSEN)) {
    // WAAR JE TE WATER GAAT MOET VRIJ ZIJN. Kom je neer in de rots, dan zit je
    // vast op het moment dat je begint.
    const instap = instappunt(plaats);
    eisWaar(`${soort}: de plek waar je begint is vrij`,
            magZwemmen(plaats, instap.x, instap.y, 11));
    eisWaar(`${soort}: en daar kun je ademhalen`, aanDeOppervlakte(instap.y));

    const totLucht = afstandVanafDeLucht(plaats);

    for (const k of plaats.kisten) {
        const naam = `${soort}/${k.id}`;
        eisWaar(`${naam}: ligt in het water en niet in de rots`,
                magZwemmen(plaats, k.x, k.y, 11));
        eisWaar(`${naam}: ligt binnen de ruimte`,
                k.x > 0 && k.x < plaats.breedte && k.y > 0 && k.y < plaats.diepte);

        // EN JE MOET ER HEEN EN WEER KUNNEN BINNEN JE LUCHT.
        //
        // Bereikbaar zijn is niet genoeg: een grot waar je wel IN komt maar niet
        // meer UIT is geen uitdaging maar een val, en aan de coördinaten zie je
        // dat niet. Dit rekent de kortste zwemweg vanaf de oppervlakte uit en
        // vergelijkt de tijd heen en terug met je voorraad.
        const weg = totLucht(k.x, k.y);
        eisWaar(`${naam}: is bereikbaar vanaf de oppervlakte`, weg < Infinity);
        if (weg === Infinity) continue;

        const heenEnWeer = (weg * 2) / ZWEMSNELHEID;
        const zonder = zuurstofVoorraad(false);
        const met = zuurstofVoorraad(true);
        const secs = heenEnWeer.toFixed(1);

        if (k.pak) {
            // Een kist die om het pak vraagt moet ook ECHT te ver zijn zonder.
            // Anders is het pak een versiering en geen sleutel.
            eisWaar(`${naam}: is zonder pak te ver (${secs}s heen en weer, `
                    + `${zonder}s lucht)`, heenEnWeer > zonder * 0.92);
            eisWaar(`${naam}: is MET pak wel te halen`, heenEnWeer < met * 0.88);
        } else {
            eisWaar(`${naam}: is zonder pak te halen (${secs}s heen en weer, `
                    + `${zonder}s lucht)`, heenEnWeer < zonder * 0.85);
        }
    }
}

// HET DUIKPAK MOET TE VINDEN ZIJN ZONDER PAK. Anders is het een deur waarvan de
// sleutel achter diezelfde deur ligt.
console.log("\nHet duikpak:");
{
    const [soort, kistId] = PAK_KIST.split("/");
    const plaats = DUIKPLAATSEN[soort];
    eisWaar(`het pak ligt in een bestaande plaats (${soort})`, !!plaats);
    if (plaats) {
        const kist = plaats.kisten.find((k) => k.id === kistId);
        eisWaar(`het pak ligt in een bestaande kist (${kistId})`, !!kist);
        if (kist) {
            eisWaar("en die kist vraagt zelf NIET om het pak", !kist.pak);
            const weg = afstandVanafDeLucht(plaats)(kist.x, kist.y);
            eisWaar(`en is zonder pak te halen `
                    + `(${((weg * 2) / ZWEMSNELHEID).toFixed(1)}s)`,
                    (weg * 2) / ZWEMSNELHEID < ZUURSTOF_MAX * 0.85);
        }
    }
    eisWaar("met pak heb je meer lucht dan zonder", ZUURSTOF_MET_PAK > ZUURSTOF_MAX);
    // Er moet ergens iets zijn dat het pak nodig heeft, anders doet het niets.
    const diepe = Object.values(DUIKPLAATSEN)
        .flatMap((pl) => pl.kisten).filter((k) => k.pak).length;
    eisWaar(`er zijn ${diepe} kisten die het pak nodig hebben`, diepe >= 2);
}

eisWaar(`je hebt ${ZUURSTOF_MAX} seconden lucht, genoeg om iets te doen`,
        ZUURSTOF_MAX >= 15 && ZUURSTOF_MAX <= 60);

// --- het kompas ----------------------------------------------------------
console.log("\nHet kompas:");
const vanaf = dichtstbijzijndeLand(START.x, START.y);
eisWaar(`vanaf het startpunt wijst het naar ${vanaf.eiland.naam}`, !!vanaf.eiland);
eisWaar("en de afstand is positief, want daar is geen land",
        vanaf.afstand > 0);
// Op een eiland staan hoort een afstand rond nul te geven, niet een negatieve
// die als "nog ver" wordt getoond.
const opHetLand = dichtstbijzijndeLand(land.x, land.y);
eis("midden op het land is het dichtstbijzijnde land dat eiland zelf",
    opHetLand.eiland.id, "the-mainland");

console.log(mislukt
    ? `\n${mislukt} controle(s) mislukt.`
    : "\nDe wereld klopt met zichzelf.");
process.exit(mislukt ? 1 : 0);
