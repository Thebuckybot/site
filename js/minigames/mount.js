// mount.js - hangt de drie spellen onder de Deck aan de pagina.
//
// Waarom dit een apart bestand is en niet in arcade.js staat: arcade.js draait
// op elke bezoeker van de pagina en trekt de VM binnen, en de spellen hoeven
// pas te bestaan als iemand er ook echt bij komt. Zo blijft de eerste render
// van de pagina hetzelfde als hij was.

import { createWordle } from "./wordle.js";
import { createCrossing } from "./crossing.js";
import { createBoat } from "./boat.js";

const MINDER_BEWEGING = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Zet tekst in een aria-live-vak. textContent, nooit innerHTML. */
function statusIn(id) {
    const el = document.getElementById(id);
    return (tekst) => { if (el) el.textContent = tekst; };
}

/**
 * De streak, en waar hij NIET leeft.
 *
 * Hij staat in een variabele in deze module en nergens anders: geen
 * localStorage, geen server, geen profiel. Sluit je het tabblad, dan is hij
 * weg. Dat is met opzet en het is ook de enige eerlijke plek voor hem - een
 * streak die de browser bijhoudt kan de server niet controleren, dus hij mag
 * nooit ergens toe leiden. Hij is er voor de lol tijdens een sessie.
 *
 * Om diezelfde reden staat er "this session" bij op het scherm: niemand hoort
 * te denken dat hij ergens aan bouwt.
 */
function maakStreak(id) {
    const el = document.getElementById(id);
    let n = 0;
    const toon = () => {
        if (!el) return;
        el.textContent = n > 1 ? `Streak ${n} this session` : "";
    };
    return {
        raak() { n += 1; toon(); return n; },
        // De boot houdt zijn eigen streak bij (hij staat ook in zijn HUD) en
        // meldt de WAARDE. Die overnemen in plaats van er zelf bij op te tellen,
        // anders telt hetzelfde ding twee keer.
        zet(waarde) { n = Math.max(0, waarde | 0); toon(); },
        breek() { n = 0; toon(); },
        waarde() { return n; },
    };
}

/**
 * Een behendigheidsspel aan zijn canvas en knop hangen.
 *
 * DE KNOP DOET START EN STOP, want een spel dat begint zodra de pagina laadt is
 * op een lange pagina alleen maar lawaai, en iemand die verder wil scrollen moet
 * het kunnen stilzetten.
 */
function hangOp(fabriek, canvasId, knopSelector, statusId) {
    const canvas = document.getElementById(canvasId);
    const knop = document.querySelector(knopSelector);
    if (!canvas || !knop) return null;

    const zeg = statusIn(statusId);
    const streak = maakStreak(`${canvasId}-streak`);
    const spel = fabriek(canvas, { reducedMotion: MINDER_BEWEGING, onStatus: zeg });

    // Een gelukte poging telt op, een mislukte ronde zet hem terug. Wat "een
    // gelukte poging" is verschilt per spel en dat weet het spel zelf; hier
    // wordt alleen geteld.
    spel.on("score", () => streak.raak());
    spel.on("streak", (n) => streak.zet(n));

    spel.on("gameover", ({ score }) => {
        const had = streak.waarde();
        streak.breek();
        zeg(`Run over. Score ${score}.` + (had > 1 ? ` Streak of ${had} ended.` : "")
            + " Press Start to go again.");
        knop.textContent = "Start";
    });

    knop.addEventListener("click", () => {
        if (spel.isRunning()) {
            spel.stop();
            knop.textContent = "Start";
            zeg("Paused.");
        } else {
            spel.start();
            knop.textContent = "Stop";
            canvas.focus();
        }
    });

    return spel;
}

document.addEventListener("DOMContentLoaded", () => {
    const wordleRoot = document.getElementById("wordle-root");
    if (wordleRoot) {
        createWordle(wordleRoot, { onStatus: () => {} });
    }

    hangOp(createCrossing, "mg-crossing", '.mg-btn[data-game="crossing"]', "mg-crossing-status");
    hangOp(createBoat, "mg-boat", '.mg-btn[data-game="boat"]', "mg-boat-status");
});
