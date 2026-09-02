/**
 * DE WERELD VAN OPEN WATER, als beschrijving in plaats van als tekening.
 *
 * WAAROM DIT EEN EIGEN BESTAND IS
 * Fase 1 was: grotere eilanden, meer eilanden, en kusten met verschillende
 * aard. Met de oude opzet - een cirkel met een middelpunt en een straal, met de
 * hand neergezet - loopt dat meteen vast. Een cirkel heeft geen baai en geen
 * kaap, en tien met de hand geplaatste cirkels zijn tien plekken waar de
 * volgende wijziging fout kan gaan.
 *
 * DE VORM DIE IS GEKOZEN: EEN STRAALFUNCTIE MET HARMONISCHEN.
 * Een eiland is een middelpunt, een basisstraal, en een handvol golven die op
 * die straal worden opgeteld:
 *
 *     straal(hoek) = r * (1 + som van amp * cos(n * hoek + fase))
 *
 * Een golf met n=3 geeft drie brede uitstulpingen en drie baaien. n=7 met een
 * kleine amplitude geeft een gerafelde kust. Twee of drie golven zijn genoeg
 * voor een eiland dat er met de hand getekend uitziet, en het kost vier regels.
 *
 * Waarom dit en niet iets anders:
 *   - Een polygoon met punten geeft meer vrijheid, maar een eiland is dan
 *     dertig coördinaten die niemand meer kan lezen of aanpassen.
 *   - Ruis (Perlin en verwanten) geeft mooiere kusten, maar je kunt er niet
 *     gericht een baai in leggen, en je hebt een ruisfunctie nodig die er nu
 *     niet is.
 *   - Harmonischen zijn omkeerbaar te lezen: je ZIET aan `[3, 0.2, 0]` dat er
 *     drie bochten in zitten, en je kunt er een bij zetten zonder de rest te
 *     raken.
 *
 * Alles is deterministisch. Er komt geen `Math.random` aan te pas, want een
 * zeekaart die per sessie verandert is geen zeekaart: je kunt hem niet leren.
 *
 * KUSTSOORTEN staan als hoeksectoren op het eiland, niet per eiland. Zo kan één
 * eiland een strand aan de luwe kant hebben en een klif aan de kant waar de
 * wind vandaan komt, en dat is precies wat een eiland een plek maakt in plaats
 * van een vorm.
 */

export const WERELD = { w: 6400, h: 4400 };

/**
 * Waar de boot begint.
 *
 * DIT STAAT HIER OMDAT HET TWEE KEER IN DE CODE STOND. Eén keer bij het
 * aanmaken van de boot en één keer in `start()`, die alles terugzet. Toen de
 * wereld groter werd heb ik de eerste bijgewerkt en de tweede vergeten, en dus
 * begon het spel nog steeds op de oude plek - met een kompas dat keurig naar
 * het dichtstbijzijnde eiland wees en daardoor onzin leek te vertellen. Eén
 * plek, geen tweede kans om ze uit elkaar te laten lopen.
 *
 * De plek zelf is open water, maar niet MIDDEN op open water: pal ten westen
 * van The Mainland, ruim vijfhonderd eenheden van de steiger daar. Je begint
 * dus zonder land in beeld - het kompas moet iets te doen hebben - maar wie
 * rechtdoor vaart ziet binnen een paar seconden de kust opdoemen. Beginnen op
 * leeg water met niets in elke richting is een eerste indruk van een spel dat
 * niet af is, ook al klopt er alles aan.
 */
export const START = { x: 2900, y: 2900, hoek: 0 };

/** Hoeveel eenheden een graad kust ongeveer is; gebruikt voor sectoren. */
export const TAU = Math.PI * 2;

/**
 * De eilanden.
 *
 * Een eiland toevoegen is dit blok kopiëren en de getallen veranderen. Er is
 * geen tweede plek die bijgewerkt moet worden: tekenen, botsen, het kompas en
 * de steigers lezen allemaal uit deze lijst.
 */
export const EILANDEN = [
    {
        id: "still-harbour",
        naam: "Still Harbour",
        x: 2100, y: 1500, r: 300,
        // Drie brede bochten en een fijne rafeling.
        vorm: [[3, 0.16, 0.5], [7, 0.06, 2.1]],
        kust: "strand",
        // De noordkant is rots, de zuidoostkant een klif.
        banden: [
            { van: 4.2, tot: 5.4, soort: "rots" },
            { van: 0.5, tot: 1.4, soort: "klif" },
        ],
    },
    {
        id: "the-mainland",
        naam: "The Mainland",
        // HET ECHTE LAND. Groot genoeg om over te lopen, en met vorm: de
        // harmonische op n=2 maakt hem langgerekt, n=5 legt er baaien en een
        // kaap in, en n=11 rafelt de kustlijn.
        x: 4550, y: 2500, r: 900,
        vorm: [[2, 0.20, 1.1], [5, 0.13, 0.2], [11, 0.045, 3.0]],
        kust: "strand",
        banden: [
            { van: 2.2, tot: 3.6, soort: "klif" },
            { van: 5.0, tot: 6.1, soort: "rots" },
            { van: 0.0, tot: 0.7, soort: "rots" },
        ],
        // Een binnenmeer. Water in het land is een gat in de begaanbaarheid,
        // geen apart voorwerp: `opLand` trekt het er gewoon af.
        meren: [{ dx: -120, dy: 90, r: 190 }],
    },
    {
        id: "cape-light",
        naam: "Cape Light",
        x: 5250, y: 780, r: 210,
        vorm: [[4, 0.22, 0.9], [9, 0.05, 1.2]],
        kust: "rots",
        banden: [{ van: 3.0, tot: 4.2, soort: "strand" }],
    },
    {
        id: "the-teeth",
        naam: "The Teeth",
        x: 1150, y: 3350, r: 165,
        // Veel scherpe punten: dit is een rif dat net boven water uitkomt.
        vorm: [[6, 0.30, 0.0], [13, 0.10, 1.7]],
        kust: "rots",
        banden: [],
    },
    {
        id: "low-hollow",
        naam: "Low Hollow",
        x: 3100, y: 3700, r: 250,
        vorm: [[3, 0.24, 2.6], [8, 0.07, 0.4]],
        kust: "strand",
        banden: [{ van: 1.6, tot: 2.6, soort: "klif" }],
        meren: [{ dx: 40, dy: -30, r: 95 }],
    },
    {
        id: "quiet-shelf",
        naam: "Quiet Shelf",
        x: 900, y: 1100, r: 190,
        vorm: [[2, 0.18, 0.3], [6, 0.08, 2.8]],
        kust: "strand",
        banden: [{ van: 4.6, tot: 5.6, soort: "rots" }],
    },
    {
        id: "the-anvil",
        naam: "The Anvil",
        x: 5600, y: 3800, r: 230,
        vorm: [[2, 0.28, 0.0], [7, 0.06, 1.0]],
        kust: "klif",
        banden: [{ van: 2.8, tot: 3.9, soort: "strand" }],
    },
];

/**
 * De steigers.
 *
 * HIER ZAT HET OPEN PUNT. Een steiger was een rechthoek met een eigen x en y,
 * en die stond dwars over de kustlijn: half over het water, half over het gras.
 * Waar je ook aanlegde, je lag op de planken, want de planken lagen overal.
 *
 * Een steiger wordt nu beschreven door het EILAND, de HOEK op de kust en zijn
 * LENGTE. Waar hij begint volgt uit de kustlijn en niet uit een getal dat
 * iemand heeft overgetypt - dus als de vorm van het eiland verandert, schuift
 * de steiger vanzelf mee. Hij loopt vanaf de kust naar BUITEN, het water op,
 * zoals een steiger hoort te lopen.
 */
export const STEIGERS = [
    { eiland: "still-harbour", hoek: Math.PI, lengte: 150, breedte: 46 },
    { eiland: "the-mainland", hoek: Math.PI * 0.86, lengte: 175, breedte: 50 },
    { eiland: "the-mainland", hoek: Math.PI * 1.75, lengte: 150, breedte: 46 },
    { eiland: "cape-light", hoek: Math.PI * 0.62, lengte: 135, breedte: 44 },
    { eiland: "low-hollow", hoek: Math.PI * 1.35, lengte: 145, breedte: 46 },
    { eiland: "quiet-shelf", hoek: Math.PI * 0.15, lengte: 140, breedte: 44 },
];

/** Het eiland bij een id. */
export function eilandOp(id) {
    return EILANDEN.find((e) => e.id === id) || null;
}

/** De straal van `eiland` in de richting `hoek`. */
export function straalOp(eiland, hoek) {
    let f = 1;
    for (const [n, amp, fase] of eiland.vorm) {
        f += amp * Math.cos(n * hoek + fase);
    }
    // Nooit naar binnen klappen: een straal onder nul geeft een vorm die
    // zichzelf doorkruist en dan klopt geen enkele botsing meer.
    return eiland.r * Math.max(0.25, f);
}

/** Ligt (x, y) op dit eiland? Binnenmeren tellen als water. */
export function opLand(eiland, x, y, marge = 0) {
    const dx = x - eiland.x, dy = y - eiland.y;
    const afstand = Math.hypot(dx, dy);
    if (afstand > eiland.r * 1.6) return false;   // snelle afwijzing
    if (afstand >= straalOp(eiland, Math.atan2(dy, dx)) - marge) return false;
    for (const meer of eiland.meren || []) {
        if (Math.hypot(x - (eiland.x + meer.dx), y - (eiland.y + meer.dy))
            < meer.r + marge) return false;
    }
    return true;
}

/** Het eiland waar (x, y) op ligt, of null. */
export function landOnder(x, y, marge = 0) {
    for (const e of EILANDEN) {
        if (opLand(e, x, y, marge)) return e;
    }
    return null;
}

/** Welke kustsoort ligt er op deze hoek van dit eiland? */
export function kustSoort(eiland, hoek) {
    const h = ((hoek % TAU) + TAU) % TAU;
    for (const band of eiland.banden || []) {
        if (band.van <= band.tot) {
            if (h >= band.van && h <= band.tot) return band.soort;
        } else if (h >= band.van || h <= band.tot) {
            // Een band die over 0 heen loopt.
            return band.soort;
        }
    }
    return eiland.kust;
}

/**
 * De meetkunde van een steiger, afgeleid uit het eiland.
 *
 * Geeft het punt op de kust, het punt op zee, de richting, en de LIGPLAATS:
 * waar de boot komt te liggen als je aanmeert. Die ligplaats ligt NAAST de
 * planken en niet erop - dat was het hele punt.
 */
export function steigerMaten(steiger) {
    const eiland = eilandOp(steiger.eiland);
    if (!eiland) return null;
    const dx = Math.cos(steiger.hoek), dy = Math.sin(steiger.hoek);
    const straal = straalOp(eiland, steiger.hoek);

    // Iets IN het land beginnen, zodat er geen kier tussen plank en kust valt.
    const kustX = eiland.x + dx * (straal - 18);
    const kustY = eiland.y + dy * (straal - 18);
    const zeeX = eiland.x + dx * (straal + steiger.lengte);
    const zeeY = eiland.y + dy * (straal + steiger.lengte);

    // De ligplaats: halverwege het stuk dat OVER WATER ligt, een halve
    // plankbreedte plus een halve boot opzij. De boot komt dus evenwijdig aan
    // de steiger te liggen, ernaast, met zijn neus naar open zee.
    const overWater = 0.62;   // hoe ver naar buiten op de steiger
    const midX = kustX + (zeeX - kustX) * overWater;
    const midY = kustY + (zeeY - kustY) * overWater;
    const nx = -dy, ny = dx;                    // dwars op de steiger
    const opzij = steiger.breedte / 2 + 15;

    return {
        eiland,
        kust: { x: kustX, y: kustY },
        zee: { x: zeeX, y: zeeY },
        richting: { x: dx, y: dy },
        dwars: { x: nx, y: ny },
        lengte: Math.hypot(zeeX - kustX, zeeY - kustY),
        breedte: steiger.breedte,
        // Waar de boot komt te liggen, en met welke koers.
        ligplaats: {
            x: midX + nx * opzij,
            y: midY + ny * opzij,
            hoek: steiger.hoek,
        },
        // Waar Bucky aan wal stapt: op de kust, net binnen het land.
        walkant: {
            x: eiland.x + dx * (straal - 30),
            y: eiland.y + dy * (straal - 30),
        },
    };
}

/**
 * De straal van de AANLOOPZONE rond een ligplaats.
 *
 * Binnen deze afstand remt de boot vanzelf af, en hoe dichterbij hoe sterker.
 * Aanmeren vroeg daarvoor dat je zelf precies genoeg gas terugnam: te weinig en
 * je schoot voorbij, te veel en je kwam er niet. Dat is doseren op een joystick
 * met een duim, en dat is geen leuke vaardigheid maar een lastige.
 *
 * De zone is ONZICHTBAAR maar wel voelbaar - je merkt dat de boot inhoudt. Er
 * wordt geen cirkel getekend: een harde rand maakt van een soepele hulp een
 * regel waar je overheen kunt, en dan zit je weer te mikken.
 *
 * Hij hangt aan de LIGPLAATS en niet aan de steiger als geheel, want dat is de
 * plek waar je heen wilt. En omdat hij hier staat, geldt hij vanzelf voor elke
 * steiger die erbij komt - net als de ligplaats zelf.
 */
export const AANLOOP_STRAAL = 300;

/**
 * Hoe hard de boot wordt afgeremd op (x, y), van 0 (niets) tot 1 (maximaal).
 *
 * Kwadratisch, niet lineair: aan de rand van de zone merk je bijna niets, en
 * vlak bij de ligplaats knijpt hij stevig. Lineair voelt als een muur waar je
 * tegenaan loopt; kwadratisch voelt als water dat dikker wordt.
 */
export function aanloopRem(maten, x, y) {
    if (!maten) return 0;
    const d = Math.hypot(x - maten.ligplaats.x, y - maten.ligplaats.y);
    if (d >= AANLOOP_STRAAL) return 0;
    const nabij = 1 - d / AANLOOP_STRAAL;
    return nabij * nabij;
}

/**
 * Ligt (x, y) op de planken van deze steiger?
 *
 * De rechthoek staat schuin, dus het punt wordt eerst naar de assen van de
 * steiger gedraaid en daarna gewoon met een rechthoek vergeleken. Dit is de
 * regel die eerder `s.w` gebruikte waar `s.w / 2` hoorde te staan, waardoor het
 * gat in de kust twee keer zo groot was als de plank die je zag.
 */
export function opSteiger(x, y, maten) {
    if (!maten) return false;
    const dx = x - maten.kust.x, dy = y - maten.kust.y;
    const langs = dx * maten.richting.x + dy * maten.richting.y;
    const dwars = dx * maten.dwars.x + dy * maten.dwars.y;
    return langs >= 0 && langs <= maten.lengte
        && Math.abs(dwars) <= maten.breedte / 2;
}

/**
 * Waar een huis staat, afgeleid uit zijn eiland.
 *
 * Net als bij de steigers: een huis wordt beschreven met een hoek en hoe ver
 * naar binnen, niet met een x en een y. Verandert de vorm van het eiland, dan
 * schuift het huis mee in plaats van in zee te komen staan.
 */
export function huisMaten(huis) {
    const eiland = eilandOp(huis.eiland);
    if (!eiland) return null;
    const straal = straalOp(eiland, huis.hoek);
    const d = straal * huis.deel;
    return {
        eiland,
        x: eiland.x + Math.cos(huis.hoek) * d,
        y: eiland.y + Math.sin(huis.hoek) * d,
        soort: huis.soort,
    };
}

/**
 * Het dichtstbijzijnde land, voor het kompas.
 *
 * Geeft de richting en de afstand tot de KUST (niet tot het middelpunt), want
 * "nog 400 naar het midden van een eiland met straal 300" is misleidend.
 */
export function dichtstbijzijndeLand(x, y) {
    let beste = null;
    for (const e of EILANDEN) {
        const dx = e.x - x, dy = e.y - y;
        const hoek = Math.atan2(-dy, -dx);   // vanaf het eiland gezien
        const totMidden = Math.hypot(dx, dy);
        const afstand = totMidden - straalOp(e, hoek);
        if (!beste || afstand < beste.afstand) {
            beste = { eiland: e, afstand, richting: Math.atan2(dy, dx) };
        }
    }
    return beste;
}
