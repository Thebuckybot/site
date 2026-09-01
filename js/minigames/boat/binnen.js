/**
 * BINNENRUIMTES VOOR OPEN WATER.
 *
 * Een interieur is een RECHTHOEKIGE kamer met een lijst meubels, en meer is het
 * niet. Dat is met opzet:
 *
 *   - Meubels zijn assen-evenwijdige rechthoeken. Botsing is dan vier
 *     vergelijkingen en geen meetkunde, en dat is precies wat je wilt op een
 *     telefoon die ook nog het water tekent.
 *   - Een kamer is een blok data. Er een bij zetten is dit bestand openen en
 *     een blok kopiëren; er hoeft niets aan de tekenlus of aan de botsing te
 *     veranderen. Dezelfde keuze als bij de eilanden in `wereld.js`, en om
 *     dezelfde reden: uitbreiden moet goedkoop zijn.
 *
 * De kamer wordt altijd HELEMAAL in beeld gebracht. Binnen is de wereld klein
 * genoeg om in één blik te zien, en dan hoort de camera niet mee te schuiven -
 * dat maakt een kamer onnodig verwarrend, en op een telefoon kost het de helft
 * van je overzicht.
 */

/**
 * De soorten binnenruimte.
 *
 * `deur` is waar je weer naar buiten gaat. Hij ligt altijd in een muur, en de
 * speler komt er ook binnen: bij het betreden zet het spel je net BINNEN de
 * deur, zodat je niet meteen weer naar buiten stapt.
 */
export const INTERIEURS = {
    hut: {
        naam: "The Cabin",
        breedte: 360, hoogte: 260,
        vloer: "#5a4632",
        muur: "#3b2c1f",
        // Een woonhut: bed, kachel, tafel met twee krukken, een kast.
        meubels: [
            { x: 40, y: 48, w: 96, h: 60, soort: "bed" },
            { x: 250, y: 40, w: 62, h: 46, soort: "kachel" },
            { x: 150, y: 130, w: 84, h: 54, soort: "tafel" },
            { x: 126, y: 142, w: 22, h: 26, soort: "kruk" },
            { x: 238, y: 142, w: 22, h: 26, soort: "kruk" },
            { x: 40, y: 176, w: 54, h: 44, soort: "kast", kist: "hut-kast" },
        ],
        deur: { x: 168, y: 244, w: 48, h: 16 },
    },

    pakhuis: {
        naam: "The Warehouse",
        breedte: 460, hoogte: 320,
        vloer: "#4a4a52",
        muur: "#2b2b31",
        // Een pakhuis is gangen tussen stapels. De kisten staan in rijen zodat
        // er een route doorheen loopt en je niet zomaar overal langs kunt.
        meubels: [
            { x: 46, y: 50, w: 70, h: 70, soort: "kist", kist: "pak-a" },
            { x: 46, y: 140, w: 70, h: 70, soort: "kist" },
            { x: 160, y: 50, w: 70, h: 70, soort: "kist" },
            { x: 160, y: 140, w: 70, h: 70, soort: "kist", kist: "pak-b" },
            { x: 300, y: 50, w: 96, h: 44, soort: "rek" },
            { x: 300, y: 112, w: 96, h: 44, soort: "rek" },
            { x: 300, y: 174, w: 96, h: 44, soort: "rek" },
            { x: 60, y: 244, w: 120, h: 34, soort: "vat" },
        ],
        deur: { x: 218, y: 304, w: 54, h: 16 },
    },

    ruine: {
        naam: "The Ruin",
        breedte: 400, hoogte: 300,
        vloer: "#4b4a44",
        muur: "#33322d",
        // Iets vervallens: puin, een omgevallen balk, een half ingestorte muur
        // die binnen als obstakel staat. Onregelmatig, want dat is het punt.
        meubels: [
            { x: 0, y: 96, w: 132, h: 26, soort: "muurrest" },
            { x: 236, y: 40, w: 26, h: 130, soort: "muurrest" },
            { x: 92, y: 176, w: 78, h: 30, soort: "balk" },
            { x: 292, y: 210, w: 58, h: 46, soort: "puin", kist: "ruine-puin" },
            { x: 44, y: 44, w: 44, h: 38, soort: "puin" },
            { x: 300, y: 96, w: 52, h: 40, soort: "puin" },
        ],
        deur: { x: 176, y: 284, w: 48, h: 16 },
    },
};

/**
 * De huizen in de wereld.
 *
 * Net als de steigers: het EILAND, een hoek en hoe ver naar binnen. De plek
 * volgt daaruit, dus als de vorm van een eiland verandert schuift het huis mee
 * in plaats van in zee te komen staan.
 */
export const HUIZEN = [
    { eiland: "the-mainland", hoek: Math.PI * 0.95, deel: 0.55, soort: "hut" },
    { eiland: "the-mainland", hoek: Math.PI * 1.55, deel: 0.5, soort: "pakhuis" },
    { eiland: "the-mainland", hoek: Math.PI * 0.35, deel: 0.62, soort: "ruine" },
    { eiland: "still-harbour", hoek: Math.PI * 1.1, deel: 0.5, soort: "hut" },
    // Op 1.4*PI stond dit huis IN het binnenmeer van Low Hollow - het meer
    // ligt net ten noordoosten van het middelpunt, en op 45% naar binnen kom je
    // er precies in uit. Dat is niet aan de getallen te zien, alleen aan de
    // uitkomst, en daarom controleert tests/test_boot_wereld.js nu voor ELK
    // huis of het op begaanbaar land staat.
    { eiland: "low-hollow", hoek: Math.PI * 0.8, deel: 0.55, soort: "ruine" },
    { eiland: "quiet-shelf", hoek: Math.PI * 0.2, deel: 0.45, soort: "hut" },
    { eiland: "the-anvil", hoek: Math.PI * 3.2, deel: 0.4, soort: "pakhuis" },
];

/** Hoe groot een huisje van buiten is. */
export const HUIS_MAAT = { w: 76, h: 62 };

/**
 * Mag je hier staan, binnen deze kamer?
 *
 * Muren en meubels houden je tegen; de deur is een gat in de muur waar je
 * doorheen mag, want anders kun je er nooit uit.
 */
export function magLopenBinnen(kamer, x, y, straal) {
    // Binnen de muren blijven.
    if (x < straal || y < straal
        || x > kamer.breedte - straal || y > kamer.hoogte - straal) {
        // Tenzij je in de deuropening staat; daar mag je er half uit hangen.
        const d = kamer.deur;
        if (!(x > d.x && x < d.x + d.w && y > d.y - 10)) return false;
    }
    for (const m of kamer.meubels) {
        // Een cirkel tegen een rechthoek: het dichtstbijzijnde punt van de
        // rechthoek pakken en kijken of dat binnen de straal ligt. Zo blijf je
        // ook op de hoeken netjes buiten het meubel.
        const cx = Math.max(m.x, Math.min(x, m.x + m.w));
        const cy = Math.max(m.y, Math.min(y, m.y + m.h));
        if (Math.hypot(x - cx, y - cy) < straal) return false;
    }
    return true;
}

/**
 * Hoe ver voor de deur je nog "bij de deur" staat.
 *
 * DIT WAS TWEE VERSCHILLENDE GETALLEN, en dat is precies de fout die je niet
 * ziet. Je kwam binnen op 26 eenheden van de deur terwijl `bijDeur` bij 22
 * ophield, dus je stond bij binnenkomst net NIET bij je eigen deur: eerst een
 * stapje terug doen om weer naar buiten te kunnen. Een test op beide kanten
 * ving het; met één constante kan het niet meer uit elkaar lopen.
 */
export const DEUR_BEREIK = 30;

/** Waar je staat als je net binnen bent. Altijd binnen `DEUR_BEREIK`. */
export function deurStart(kamer) {
    return {
        x: kamer.deur.x + kamer.deur.w / 2,
        y: kamer.deur.y - DEUR_BEREIK * 0.7,
    };
}

/** Sta je in de deuropening, zodat je naar buiten kunt? */
export function bijDeur(kamer, x, y) {
    const d = kamer.deur;
    return x > d.x - 10 && x < d.x + d.w + 10 && y > d.y - DEUR_BEREIK;
}
