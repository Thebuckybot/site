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
    const spel = fabriek(canvas, { reducedMotion: MINDER_BEWEGING, onStatus: zeg });

    spel.on("gameover", ({ score }) => {
        zeg(`Run over. Score ${score}. Press Start to go again.`);
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
