// wordle.js - de client voor het enige webspel dat uitbetaalt.
//
// DEZE MODULE WEET HET ANTWOORD NIET, EN DAT IS HET HELE PUNT.
// Hij stuurt een woord naar de server en krijgt groen/geel/grijs terug. Er is
// hier geen woordenlijst, geen vergelijking, geen "heb ik gewonnen"-berekening
// en geen bedrag. Wie deze code openslaat of in de console gaat rommelen vindt
// niets wat hem verder helpt, want alles wat de uitslag bepaalt staat in
// `backend/api/minigames.py`.
//
// Dat is ook waarom dit spel wel shards uitkeert en de twee andere niet: de
// server kan een woordgok narekenen en een uitgeweken auto niet.

import { API_URL } from "../config.js";
import { apiFetch } from "../dashboard.js";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const TOETSENBORD = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

/**
 * Hangt de Wordle in `root`.
 * @returns {{destroy(): void}}
 */
export function createWordle(root, options = {}) {
    const zegStatus = options.onStatus || (() => {});

    let staat = null;       // de laatste servertoestand
    let invoer = "";        // wat de speler nu typt
    let bezig = false;      // een verzoek loopt
    let vernietigd = false;

    // --- opbouw ------------------------------------------------------------
    const bord = document.createElement("div");
    bord.className = "wordle-board";

    const melding = document.createElement("p");
    melding.className = "wordle-message";
    // aria-live: een schermlezer hoort de uitslag zonder dat de focus verspringt.
    melding.setAttribute("role", "status");
    melding.setAttribute("aria-live", "polite");

    const toetsen = document.createElement("div");
    toetsen.className = "wordle-keyboard";

    const knop = document.createElement("button");
    knop.type = "button";
    knop.className = "mg-btn wordle-start";
    knop.textContent = "Start a round";

    root.append(melding, bord, toetsen, knop);

    // --- tekenen -----------------------------------------------------------
    function tekenBord() {
        bord.textContent = "";
        if (!staat) return;

        const rijen = staat.max_guesses;
        const lengte = staat.length;
        const gedaan = staat.guesses || [];

        for (let r = 0; r < rijen; r++) {
            const rij = document.createElement("div");
            rij.className = "wordle-row";
            const gok = gedaan[r];
            const actief = !gok && r === gedaan.length && staat.status === "playing";

            for (let c = 0; c < lengte; c++) {
                const vak = document.createElement("div");
                vak.className = "wordle-tile";
                if (gok) {
                    // textContent, nooit innerHTML: dit komt van de server en
                    // hoort als tekst behandeld te worden.
                    vak.textContent = gok.word[c].toUpperCase();
                    vak.classList.add(`is-${gok.result[c]}`);
                    // NOOIT ALLEEN KLEUR (WCAG 1.4.1). Elke uitslag krijgt ook
                    // een woord mee dat een schermlezer voorleest, en de tegel
                    // draagt een symbool voor wie kleur niet onderscheidt.
                    vak.setAttribute("aria-label",
                        `${gok.word[c].toUpperCase()}, ${uitslagWoord(gok.result[c])}`);
                } else if (actief) {
                    vak.textContent = (invoer[c] || "").toUpperCase();
                    if (invoer[c]) vak.classList.add("is-filled");
                }
                rij.appendChild(vak);
            }
            bord.appendChild(rij);
        }
    }

    function uitslagWoord(soort) {
        if (soort === "correct") return "right letter, right place";
        if (soort === "present") return "right letter, wrong place";
        return "not in the word";
    }

    function tekenToetsen() {
        toetsen.textContent = "";
        // Wat we van elke letter al weten, opgebouwd uit de beoordeelde gokken.
        const bekend = {};
        for (const g of (staat && staat.guesses) || []) {
            g.word.split("").forEach((letter, i) => {
                const nu = g.result[i];
                const rang = { absent: 1, present: 2, correct: 3 };
                if (!bekend[letter] || rang[nu] > rang[bekend[letter]]) {
                    bekend[letter] = nu;
                }
            });
        }

        for (const rij of TOETSENBORD) {
            const el = document.createElement("div");
            el.className = "wordle-keyrow";
            if (rij === "zxcvbnm") el.appendChild(maakToets("Enter", "enter"));
            for (const letter of rij) {
                el.appendChild(maakToets(letter.toUpperCase(), letter, bekend[letter]));
            }
            if (rij === "zxcvbnm") el.appendChild(maakToets("Back", "back"));
            toetsen.appendChild(el);
        }
    }

    function maakToets(label, waarde, stand) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "wordle-key";
        b.textContent = label;
        b.dataset.key = waarde;
        if (stand) {
            b.classList.add(`is-${stand}`);
            b.setAttribute("aria-label", `${label}, ${uitslagWoord(stand)}`);
        }
        b.addEventListener("click", () => typ(waarde));
        return b;
    }

    // --- invoer ------------------------------------------------------------
    function typ(waarde) {
        if (!staat || staat.status !== "playing" || bezig) return;
        if (waarde === "enter") return stuurGok();
        if (waarde === "back") {
            invoer = invoer.slice(0, -1);
            return tekenBord();
        }
        if (LETTERS.includes(waarde) && invoer.length < staat.length) {
            invoer += waarde;
            tekenBord();
        }
    }

    function opToets(e) {
        if (!staat || staat.status !== "playing") return;
        // Alleen ingrijpen op wat we echt gebruiken, zodat tabben en
        // paginascroll blijven werken.
        if (e.key === "Enter") { e.preventDefault(); typ("enter"); }
        else if (e.key === "Backspace") { e.preventDefault(); typ("back"); }
        else if (e.key.length === 1 && LETTERS.includes(e.key.toLowerCase())) {
            e.preventDefault();
            typ(e.key.toLowerCase());
        }
    }

    // --- server ------------------------------------------------------------
    async function haal(pad, opties) {
        // `apiFetch` GOOIT bij een netwerkfout, hij geeft dan geen response
        // terug. Zonder deze vangst rendert de kaart helemaal niets als de API
        // onbereikbaar is - geen bord, geen melding, alleen een leeg vlak. Dat
        // is precies wat er gebeurde toen dit lokaal werd getest.
        try {
            const res = await apiFetch(`${API_URL}/api/minigames/wordle/${pad}`, opties);
            let body = {};
            try { body = await res.json(); } catch { body = {}; }
            return { ok: res.ok, status: res.status, body };
        } catch {
            return { ok: false, status: 0, body: {} };
        }
    }

    function zeg(tekst) {
        melding.textContent = tekst;
        zegStatus(tekst);
    }

    async function laad() {
        const { ok, status, body } = await haal("state");
        if (vernietigd) return;
        if (status === 401 || status === 403) {
            zeg("Log in with Discord to play for pixel shards.");
            knop.disabled = true;
            return;
        }
        if (status === 0) {
            zeg("We cannot reach the game server right now. Try again in a moment.");
            knop.disabled = true;
            return;
        }
        if (!ok || body.enabled === false) {
            zeg("The word game is closed right now.");
            knop.disabled = true;
            return;
        }
        staat = body.game;
        toonRuimte(body);
        tekenBord();
        tekenToetsen();
    }

    function toonRuimte(body) {
        const over = body.rewarded_wins_left;
        const rondes = body.plays_left;
        if (staat && staat.status === "playing") {
            zeg(`Guess the ${staat.length} letter word. ${rondes} rounds left today.`);
        } else if (rondes <= 0) {
            zeg("You have used all your rounds for today. Come back tomorrow.");
            knop.disabled = true;
        } else {
            const shards = (body.reward_shards || 0).toLocaleString("en-GB");
            zeg(over > 0
                ? `Solve it and ${shards} pixel shards go to your balance. ${over} paid wins left today.`
                : "You have had today's shards, but you can still play for fun.");
        }
    }

    async function start() {
        if (bezig) return;
        bezig = true;
        knop.disabled = true;
        const { ok, body } = await haal("start", { method: "POST" });
        bezig = false;
        if (vernietigd) return;
        if (!ok) {
            zeg(body.error || "That did not work. Try again in a moment.");
            return;
        }
        staat = body;
        invoer = "";
        zeg(`Guess the ${staat.length} letter word.`);
        tekenBord();
        tekenToetsen();
        bord.focus();
    }

    async function stuurGok() {
        if (invoer.length !== staat.length || bezig) return;
        bezig = true;
        const { ok, body } = await haal("guess", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guess: invoer }),
        });
        bezig = false;
        if (vernietigd) return;

        if (!ok) {
            zeg(body.error || "That guess was not accepted.");
            return;
        }
        staat = body;
        invoer = "";
        tekenBord();
        tekenToetsen();

        if (staat.status === "won") {
            // De tekst komt van de server, want die weet of er echt betaald is.
            zeg((body.reward && body.reward.message) || "Solved.");
            knop.textContent = "Play again";
            knop.disabled = false;
        } else if (staat.status === "lost") {
            zeg(`Out of guesses. The word was ${String(staat.answer || "").toUpperCase()}.`);
            knop.textContent = "Play again";
            knop.disabled = false;
        } else {
            const over = staat.max_guesses - staat.guesses.length;
            zeg(`${over} ${over === 1 ? "guess" : "guesses"} left.`);
        }
    }

    // --- aanhaken ----------------------------------------------------------
    bord.tabIndex = 0;
    bord.setAttribute("role", "group");
    bord.setAttribute("aria-label", "Word puzzle board. Type a word and press Enter.");
    bord.addEventListener("keydown", opToets);
    knop.addEventListener("click", start);

    laad();

    return {
        destroy() {
            vernietigd = true;
            bord.removeEventListener("keydown", opToets);
            knop.removeEventListener("click", start);
            root.textContent = "";
        },
    };
}
