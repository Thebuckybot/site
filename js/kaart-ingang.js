/**
 * De ingangen naar de kaarteditor (11-11-2026): "My cards" in het menu van het account-bolletje en de tegel op het dashboard.
 *
 * ALLEEN ALS DE VLAG `kaart_editor` AAN STAAT. Een element met `data-kaart-ingang` staat in de HTML met `hidden`; deze module
 * haalt `/api/site/features` op en maakt het pas zichtbaar als die precies `kaart_editor: true` meldt. Alles anders - de vlag uit,
 * de aanroep mislukt, een onleesbaar antwoord, een netwerkfout - laat het verborgen en doet niets. Dat is het omgekeerde van
 * features.js (bij twijfel TONEN): een ingang naar iets dat uit kan staan hoort er pas te zijn als de server het zegt.
 *
 * De server beslist ook zelf: met de vlag uit geven de routes 503, dus een verborgen ingang is geen beveiliging maar een
 * uitnodiging die er niet is zolang er niets te doen valt.
 */
import { API_URL } from "./config.js";

let belofte = null;

/** True als en alleen als de site meldt dat de kaarteditor aan staat. Nooit een uitzondering. */
export function kaartEditorAan() {
    if (!belofte) {
        belofte = (async () => {
            try {
                const res = await fetch(`${API_URL}/api/site/features`, { credentials: "include" });
                if (!res.ok) return false;
                const body = await res.json();
                return !!body && !!body.features && body.features.kaart_editor === true;
            } catch (_e) {
                return false;
            }
        })();
    }
    return belofte;
}

/** Maak elke ingang zichtbaar als de vlag aan staat. Geeft het aantal getoonde ingangen terug. */
export async function toonIngangen(wortel = document) {
    if (!(await kaartEditorAan())) return 0;
    let n = 0;
    for (const e of wortel.querySelectorAll("[data-kaart-ingang]")) {
        e.hidden = false;
        e.removeAttribute("aria-hidden");
        n += 1;
    }
    return n;
}

if (typeof document !== "undefined" && document.querySelector("[data-kaart-ingang]")) {
    toonIngangen();
}
