/**
 * De VM openen vanaf een link: `arcade.html?app=org&maximize=1#the-vm`.
 *
 * WAAROM DIT BESTAAT (13-10-2026). De org-pagina van v2 stuurt een bezoeker met
 * een groot genoeg scherm naar de VM, en daar hoort hij meteen in de org-app te
 * staan, niet voor een bureaublad waarop hij zelf moet zoeken. Tot nu toe las de
 * VM geen enkele parameter: `#the-vm` scrolde alleen naar de sectie.
 *
 * WAT HIER WEL EN NIET GEBEURT. Dit leest alleen. De runtime (vmRuntime.js)
 * doet het werk met wat hij al had: `startDesktopBoot()` (de ENTER SYSTEM-klik),
 * `setMode("expanded")` (de focusmodus), `openApp(id)` en `snapWindow("max")`.
 * Zonder parameters verandert er niets aan de VM.
 *
 * ALLEEN APPS UIT DEZE LIJST. Een link mag geen willekeurige app openen; de
 * org-app is de enige waar een pagina buiten de VM naartoe wijst.
 */
export const START_APPS = Object.freeze(["org"]);

/**
 * @param {string} search  location.search, bijv. "?app=org&maximize=1"
 * @returns {{app: string|null, maximize: boolean}|null}  null = gewoon opstarten
 */
export function leesStart(search) {
    let params;
    try {
        params = new URLSearchParams(search || "");
    } catch (_e) {
        return null;
    }
    const app = (params.get("app") || "").toLowerCase();
    const gekozen = START_APPS.includes(app) ? app : null;
    const maximize = params.get("maximize") === "1";
    if (!gekozen && !maximize) return null;
    return { app: gekozen, maximize };
}
