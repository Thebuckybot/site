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
    steigerMaten, opSteiger, dichtstbijzijndeLand, START, WERELD,
} from "../js/minigames/boat/wereld.js";

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
