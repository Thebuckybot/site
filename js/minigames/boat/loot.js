/**
 * KISTEN, SPULLEN EN DE INVENTORY VAN OPEN WATER.
 *
 * ====================================================================
 * WAT JE HIER VINDT, BLIJFT HIER. DIT IS DE BELANGRIJKSTE REGEL.
 * ====================================================================
 *
 * Er zit niets in deze kisten dat buiten Open Water waarde heeft. Geen pixel
 * shards, geen items die de bot kent, niets dat je kunt verkopen of ruilen.
 *
 * Dat is geen bescheidenheid maar rekenkunde. Een browser kan niet BEWIJZEN dat
 * hij een kist heeft gevonden: alles wat de client zegt, kan de client ook
 * verzinnen. Zou een kist shards uitkeren, dan is de opbrengst voor wie de
 * JavaScript openslaat oneindig, en oneindig is precies wat we bij de Wordle en
 * bij het gokspel hebben weggehaald. Een spel waar je vrij in rondloopt is
 * daar juist gevoeliger voor dan een puzzel met vaste rondes.
 *
 * ====================================================================
 * MAAR HET MOET LATER WEL KUNNEN, EN DAAROM STAAT HET ZO
 * ====================================================================
 *
 * Als de server ooit de inhoud bepaalt en de vondst kan verifiëren, hoort dat
 * erin te passen zonder verbouwing. Vandaar drie dingen:
 *
 *   1. `vraagInhoud()` geeft een PROMISE terug, ook al rekent hij nu lokaal.
 *      De aanroepende kant wacht dus al op een antwoord dat er niet meteen is,
 *      en dat is precies het gedrag dat een netwerkaanroep nodig heeft. Er
 *      hoeft later geen enkele aanroepplek te veranderen.
 *   2. Elke kist heeft een STABIELE `id` die uit zijn plek volgt. Dat is wat de
 *      server nodig heeft om te zeggen "deze kist heb je al gehad" en om te
 *      controleren of je er wel bij kon staan.
 *   3. De inhoud komt uit een tabel die de client alleen maar TOONT. Nu staat
 *      die tabel hier; straks staat hij op de server en komt hij via dezelfde
 *      functie binnen. De tekentaak weet het verschil niet.
 *
 * Wat er dan bij moet komen, en wat er NU met opzet niet is:
 *   - de server kiest de inhoud met zijn eigen toeval, per speler en per kist;
 *   - de server houdt bij welke kisten al open zijn, want anders is een kist
 *     een knop die je opnieuw kunt indrukken;
 *   - de server controleert of de speler er PLAUSIBEL bij kon: is die kist
 *     bereikbaar, is er genoeg tijd overheen gegaan, klopt de volgorde;
 *   - pas als die drie er zijn mag er iets in zitten dat waarde heeft.
 *
 * ====================================================================
 * WAAR DE INVENTORY BLIJFT: IN DE BROWSER
 * ====================================================================
 *
 * `localStorage`, en niet op de server. Er hangt geen waarde aan, dus opslaan
 * op de server zou een tabel, een route en een migratie kosten om iets te
 * bewaren dat niemand kan verliezen. Alleen binnen de sessie bewaren is het
 * andere uiterste: dan ben je je vondsten kwijt bij een verversing, en dat
 * voelt als straf voor iets wat je niet fout deed.
 *
 * Zodra er wel waarde aan hangt, hoort het naar de server te verhuizen - en dan
 * is de browserkopie hooguit nog een weergave. Dat is dezelfde grens als bij de
 * Wordle: de client mag tonen, de server beslist.
 */

/** De spullen die er zijn. Puur om te vinden en te bekijken. */
export const SPULLEN = {
    schelp: { naam: "Spiral Shell", kleur: "#e8d5b0", zeldzaam: 0 },
    glas: { naam: "Sea Glass", kleur: "#7fd4c1", zeldzaam: 0 },
    touw: { naam: "Coil of Rope", kleur: "#c2a878", zeldzaam: 0 },
    lantaarn: { naam: "Storm Lantern", kleur: "#f2c14e", zeldzaam: 1 },
    kompas: { naam: "Brass Compass", kleur: "#d4a34a", zeldzaam: 1 },
    kaart: { naam: "Torn Chart", kleur: "#ddd0a8", zeldzaam: 1 },
    sleutel: { naam: "Rusted Key", kleur: "#a56b42", zeldzaam: 2 },
    parel: { naam: "Black Pearl", kleur: "#5b5f7a", zeldzaam: 2 },
    fluit: { naam: "Bone Whistle", kleur: "#e2ddcd", zeldzaam: 2 },

    // HET DUIKPAK IS HET ENIGE VOORWERP DAT IETS DOET.
    //
    // De rest is om te vinden en te bekijken; dit verdubbelt je lucht, en
    // daarmee gaan plekken open die eerst niet te halen waren. Dat is het
    // verschil tussen spullen verzamelen en ergens VOOR terugkomen.
    //
    // Het blijft binnen dit spel - het verlengt een timer in Open Water en
    // verder niets. Zie de kop van dit bestand: er zit niets in deze kisten dat
    // buiten het spel waarde heeft, en een duikpak dat alleen hier bestaat
    // verandert daar niets aan.
    duikpak: { naam: "Diving Suit", kleur: "#5fd4a8", zeldzaam: 3, werkt: true },
};

/**
 * Wat er in een kist zit.
 *
 * Deterministisch uit de id, zodat dezelfde kist twee keer hetzelfde geeft en
 * je hem niet kunt "herrollen" door de pagina te verversen. Dat is nu vooral
 * netjes; zodra de server dit overneemt is het zijn probleem, en dan hoort het
 * ook echt afgedwongen te worden.
 */
function inhoudVan(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    // Het duikpak doet NIET mee in de trekking: dat ligt op één afgesproken
    // plek (zie `PAK_KIST` in duiken.js). Een voorwerp dat iets doet en dat
    // overal kan opduiken maakt de rest van de wereld afhankelijk van geluk.
    const sleutels = Object.keys(SPULLEN).filter((k) => !SPULLEN[k].werkt);
    const aantal = 1 + (h % 2);
    const uit = [];
    for (let i = 0; i < aantal; i++) {
        h = (h * 1103515245 + 12345) >>> 0;
        uit.push(sleutels[h % sleutels.length]);
    }
    return uit;
}

/**
 * Vraag wat er in een kist zit.
 *
 * Geeft een promise, ook al is het antwoord er meteen. Zie de kop van dit
 * bestand: dit is de vorm die een serveraanroep straks nodig heeft, en de
 * aanroepende kant hoort er nu al op te wachten.
 */
export function vraagInhoud(kistId, extras = []) {
    // `extras` is wat er op deze plek VAST in zit, boven op de trekking - nu
    // alleen het duikpak. Als de server dit later overneemt is dit precies het
    // soort ding dat hij zelf bepaalt; de vorm van de aanroep verandert niet.
    return Promise.resolve({
        id: kistId,
        spullen: [...extras, ...inhoudVan(kistId)],
    });
}

// --- de inventory --------------------------------------------------------

const SLEUTEL = "openwater.inventory.v1";

/** Wat de speler heeft, als { spul: aantal }. */
export function laadInventory() {
    try {
        const ruw = window.localStorage.getItem(SLEUTEL);
        if (!ruw) return {};
        const uit = JSON.parse(ruw);
        // Alleen bekende spullen overnemen. Wie de opslag met de hand bewerkt
        // krijgt geen onbekende voorwerpen in beeld; het is geen beveiliging -
        // er valt niets te beveiligen - maar het houdt de tekening heel.
        const schoon = {};
        for (const [k, v] of Object.entries(uit || {})) {
            if (SPULLEN[k] && Number.isFinite(v) && v > 0) schoon[k] = Math.min(99, v | 0);
        }
        return schoon;
    } catch {
        // Privémodus, geblokkeerde opslag, vol quotum: dan speel je gewoon
        // zonder dat het bewaard wordt. Dit mag het spel nooit stukmaken.
        return {};
    }
}

export function bewaarInventory(inv) {
    try {
        window.localStorage.setItem(SLEUTEL, JSON.stringify(inv));
        return true;
    } catch {
        return false;
    }
}

/** Welke kisten al open zijn geweest. */
const KISTEN_SLEUTEL = "openwater.chests.v1";

export function laadGeopend() {
    try {
        const ruw = window.localStorage.getItem(KISTEN_SLEUTEL);
        const lijst = ruw ? JSON.parse(ruw) : [];
        return new Set(Array.isArray(lijst) ? lijst.filter((x) => typeof x === "string") : []);
    } catch {
        return new Set();
    }
}

export function bewaarGeopend(set) {
    try {
        window.localStorage.setItem(KISTEN_SLEUTEL,
                                    JSON.stringify([...set].slice(-200)));
        return true;
    } catch {
        return false;
    }
}
