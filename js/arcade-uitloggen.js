/**
 * Uitloggen op de arcade, alleen onder v2 (13-10-2026, ronde 2 deel C).
 *
 * Onder v2 staat de arcade achter de login (js/site-version.js, data-gate). Wie
 * binnen is, moet er ook weer uit kunnen; de nav van de arcade had alleen
 * "Home". Dit zet er één item bij, als gewone link in de bestaande stijl: de
 * arcade ziet er verder precies zo uit. Zonder JavaScript leidt de link naar de
 * voorpagina, en dat is ook waar uitloggen eindigt.
 *
 * Dezelfde sessie als overal: js/sessie.js (haalLogin en uitloggen, ook gebruikt door
 * js/nav-auth.js). Onder v1
 * doet dit bestand niets.
 */
import { haalLogin, leesSessieCache, uitloggen } from "./sessie.js";

function zetKnop() {
    const menu = document.getElementById("nav-menu");
    if (!menu || menu.querySelector("[data-uitloggen]")) return;
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "index.html";
    a.textContent = "Log out";
    a.setAttribute("data-uitloggen", "");
    a.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
            await uitloggen();
        } catch (_e) {
            /* de cache is al gewist; de voorpagina toont de echte stand */
        }
        window.location.href = "index.html";
    });
    li.appendChild(a);
    menu.appendChild(li);
}

async function alsV2(versie) {
    if (versie !== "v2") return;
    if (leesSessieCache()) zetKnop();
    const stand = await haalLogin();
    if (stand.loggedIn) zetKnop();
}

const bekend = window.BuckySiteVersion && window.BuckySiteVersion.versie;
if (bekend) {
    alsV2(bekend);
} else {
    document.addEventListener("bucky:site-versie", (e) => alsV2(e.detail), { once: true });
}
