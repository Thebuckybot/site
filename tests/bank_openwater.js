// Het script van bank_openwater.html. Stond inline in de pagina; de Content
// Security Policy staat geen inline scripts toe.

import { createBoat } from "../js/minigames/boat.js";

const canvas = document.getElementById("mg-boat");
const spel = createBoat(canvas, {
    onStatus: (t) => { document.getElementById("mg-boat-status").textContent = t; },
});
spel.start();

// De meting wordt vanuit de test gestuurd; dit is alleen het gereedschap.
window.__bank = {
    meet(ms) {
        return new Promise((klaar) => {
            let n = 0, som = 0, ergste = 0, vorige = 0, id = 0;
            const eind = performance.now() + ms;
            const tik = (t) => {
                if (vorige) {
                    const dt = t - vorige;
                    n++; som += dt;
                    if (dt > ergste) ergste = dt;
                }
                vorige = t;
                if (t < eind) id = requestAnimationFrame(tik);
                else klaar({ frames: n, gemiddeld: som / Math.max(1, n), ergste });
            };
            id = requestAnimationFrame(tik);
        });
    },
    spel,
};
