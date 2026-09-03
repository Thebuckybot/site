// boat.js - Bucky op het water. FASE 1 van een kleine open wereld.
//
// WAT ER IN FASE 1 ZIT
//   * een boot die je stuurt, op een speelveld dat veel groter is dan het scherm
//   * bediening die op pc, tablet en telefoon werkt (toetsen, knoppen, aanraken)
//   * een camera die meeloopt en binnen de wereld blijft
//   * een eiland met een steiger waar je kunt aanmeren en uitstappen
//   * een streak die ALLEEN in deze sessie leeft en niets uitkeert
//
// WAT ER NIET IN ZIT, EN WAAROM DE OPZET ER AL OP WACHT
// De latere fases (het land verkennen met botsing, een huisje met een
// overgangsscherm, schatkisten, duiken met zuurstof) zijn hier niet gebouwd,
// maar de vorm is er wel op gekozen:
//
//   MODI. Alles wat de speler doet zit in een `modus` met vier haken: `binnen`,
//   `stap`, `teken` en `invoer`. Een fase erbij is een modus erbij en niet een
//   verbouwing van de lus. `VAREN` en `AANGEMEERD` staan er nu; `AAN_LAND`,
//   `BINNEN` en `DUIKEN` passen er zonder iets te verplaatsen bij.
//
//   WERELD ALS DATA. Het eiland is een vorm in `wereld.landen`, geen code. Een
//   tweede eiland is een tweede vorm. Huisjes en kisten worden `wereld.dingen`
//   met een `soort`, wat nu al wordt getekend en genegeerd waar het niet hoort.
//
//   BOTSING BESTAAT AL. `raaktLand()` wordt in fase 1 gebruikt om de boot te
//   laten afstuiten. Dezelfde functie is straks wat een speler tegen een muur
//   of een bank laat lopen; alleen de vorm die je erin stopt verandert.
//
//   OVERGANG. `overgang()` dimt het beeld en roept je terug. Fase 1 gebruikt
//   hem bij het uitstappen. Het huisje-scherm is dezelfde aanroep.
//
// DIT SPEL BETAALT NIETS, om dezelfde reden als het oversteekspel: de server
// kan niet narekenen of je echt om een rots bent gevaren. Er is geen fetch, geen
// opslag, geen bedrag. Komen er later kisten die WEL uitkeren, dan moet de
// server hun inhoud bepalen en de vondst kunnen verifieren - de plek daarvoor is
// een endpoint dat een kist-id inruilt, niet een score die de browser meldt.

import {
    WERELD, START, EILANDEN, STEIGERS, eilandOp, straalOp, opLand, landOnder,
    kustSoort, steigerMaten, opSteiger, dichtstbijzijndeLand, huisMaten,
    aanloopRem, AANLOOP_STRAAL,
} from "./boat/wereld.js";
import {
    INTERIEURS, HUIZEN, HUIS_MAAT, magLopenBinnen, bijDeur, deurStart,
} from "./boat/binnen.js";
import {
    SPULLEN, vraagInhoud, laadInventory, bewaarInventory,
    laadGeopend, bewaarGeopend,
} from "./boat/loot.js";
import {
    DUIKPLEKKEN, DIEPTE_WERELD, KAMERS, DIEPTE_KISTEN, ZUURSTOF_MAX,
    ZUURSTOF_MET_PAK, PAK_KIST, zuurstofVoorraad, magZwemmen, aanDeOppervlakte,
    instappunt, alleGangDelen, kistPositie,
} from "./boat/duiken.js";

const TAU = Math.PI * 2;

/**
 * DIEPTE IN EEN PLATTE TEKENING.
 *
 * Alles hier is 2D en blijft 2D: er is geen perspectief, geen horizon en geen
 * camera met een hoek. Wat er wel is, is een AFSPRAAK over waar het licht
 * vandaan komt, en die afspraak staat op één plek zodat elk voorwerp hem
 * volgt. Zodra twee dingen een schaduw de andere kant op werpen, valt het hele
 * effect uit elkaar en ziet het er goedkoop uit.
 *
 * Het licht komt van linksboven. Daaruit volgt alles:
 *   - slagschaduwen vallen naar rechtsonder (SCHADUW_X, SCHADUW_Y)
 *   - de bovenkant van iets dat uitsteekt schuift naar linksboven (HOOGTE)
 *   - de lichte rand ligt linksboven, de donkere zijkant rechtsonder
 *
 * Hoogte tekenen we door een voorwerp TWEE KEER te zetten: eerst de zijkant op
 * de grondpositie, dan het bovenvlak een paar pixels naar linksboven. Het
 * randje zijkant dat daaronder uitsteekt IS de hoogte. Meer is het niet, en
 * meer is er ook niet nodig.
 */
const LICHT = {
    // Waar de slagschaduw heen valt, in wereldeenheden.
    SCHADUW_X: 9,
    SCHADUW_Y: 13,
};

const KLEUR = {
    diep: "#071426",
    ondiep: "#0d2c47",
    golf: "rgba(130, 210, 255, .10)",
    // Het eiland in lagen, van onder naar boven: natte rand, zand, het talud
    // (de zijkant van de verhoging) en het gras erbovenop. Het talud is
    // donkerder dan allebei zijn buren, want dat is de kant waar geen licht op
    // valt - daar komt de hoogte vandaan.
    land: "#2c5a3d",        // gras, bovenvlak
    landLicht: "#3d7350",   // de belichte rand linksboven
    talud: "#1a3524",       // de zijkant onder het gras
    strand: "#c8b183",      // zand, en dat is nu echt zandkleur
    strandNat: "#9d8760",   // de natte rand waar het water tegenaan komt
    steiger: "#6b4a2f",
    steigerLicht: "#8a6340",
    steigerDonker: "#3f2a1a",
    steigerRand: "#8a6340",
    boot: "#c1304a",
    bootLicht: "#e8637c",
    bucky: "#e03a56",
    hud: "#dbe7f5",
    accent: "#52fff3",
};

export function createBoat(canvas, options = {}) {
    const minderBeweging = typeof options.reducedMotion === "boolean"
        ? options.reducedMotion
        : window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const zegStatus = options.onStatus || (() => {});

    const ctx = canvas.getContext("2d");
    const luisteraars = { score: [], gameover: [], streak: [] };
    let rafId = null;
    let draait = false;
    let vorigeTijd = 0;

    // --- de wereld ---------------------------------------------------------
    //
    // De eilanden, de kusten en de steigers staan in `boat/wereld.js`, als
    // beschrijving en niet als tekening. Zie daar waarom: met de hand geplaatste
    // cirkels houden geen baai vast en schalen niet naar tien eilanden.
    //
    // Hier blijft alleen wat PER SESSIE verschilt: de losse dingen op het water
    // en de vogels. Die horen niet in de wereldbeschrijving omdat ze geen
    // meetkunde hebben waar iets op botst.
    const steigerlijst = STEIGERS.map(steigerMaten).filter(Boolean);
    const huizenlijst = HUIZEN.map(huisMaten).filter(Boolean);

    const wereld = {
        // Boeien, rotsen en de vuurtoren: ankers voor het oog. Je vaart er
        // dwars doorheen; het zijn geen obstakels.
        //
        // Een ROOSTER met verspringing, geen handjevol losse punten. Met zoom
        // 1.75 zie je ongeveer 460 bij 330 van een wereld van 6400 bij 4400,
        // dus losse punten betekent gemiddeld niets in beeld - en op leeg water
        // voel je geen vaart en zie je geen richting. De verspringing komt uit
        // de index en niet uit Math.random, zodat de zeekaart elke ronde
        // hetzelfde is.
        dingen: (() => {
            const uit = [];
            let n = 0;
            for (let gy = 260; gy < WERELD.h - 200; gy += 320) {
                for (let gx = 260; gx < WERELD.w - 200; gx += 360) {
                    n++;
                    const x = gx + ((gy / 320) % 2 ? 160 : 0) + ((n * 53) % 90) - 45;
                    const y = gy + ((n * 37) % 70) - 35;
                    // Niets op het land, en niets vlak voor een kust.
                    if (landOnder(x, y, -70)) continue;
                    uit.push(n % 4 === 0
                        ? { soort: "rots", x, y, r: 22 + ((n * 17) % 16) }
                        : { soort: "boei", x, y });
                }
            }
            // De vuurtoren staat op Cape Light, niet op een roosterpunt.
            const kaap = eilandOp("cape-light");
            if (kaap) {
                uit.push({ soort: "vuurtoren", x: kaap.x, y: kaap.y - kaap.r * 0.35 });
            }
            return uit;
        })(),
        vogels: Array.from({ length: 22 }, (_, i) => ({
            x: 200 + i * 290,
            y: 220 + ((i * 311) % (WERELD.h - 400)),
            snelheid: 22 + (i % 5) * 7,
            fase: i * 1.3,
        })),
    };

    const boot = {
        x: START.x, y: START.y,
        hoek: START.hoek,          // radialen, 0 = naar rechts
        snelheid: 0,
        maxSnelheid: 210, // eenheden per seconde
        draaiSnelheid: 2.1,
        // SLAGZIJ. Een boot die draait helt over, en dat is het verschil tussen
        // een pijl die roteert en iets dat vaart. Loopt achter op de stuurinvoer
        // aan zodat hij overhelt en weer terugkomt in plaats van te klikken.
        helling: 0,
        // Het kielzog: een spoor van punten achter de boot dat vervaagt.
        kielzog: [],
        // Hoe sterk de aanloopzone op dit moment knijpt, 0 tot 1.
        rem: 0,
    };
    const KIELZOG_MAX = 26;
    // Vaste vergroting van de wereld. Zie de toelichting in `teken`.
    const ZOOM = 1.75;

    const camera = { x: 0, y: 0 };
    // WAT DE SPELER HEEFT GEVONDEN.
    //
    // Alles hierin blijft in dit spel: er zit niets in dat buiten Open Water
    // waarde heeft. Zie de kop van boat/loot.js voor waarom dat een harde regel
    // is en niet een keuze, en wat er zou moeten gebeuren voordat het anders
    // mag.
    const inventory = laadInventory();
    const geopend = laadGeopend();
    let inventoryOpen = false;
    let laatsteVondst = null;   // wat er net is gevonden, om te tonen

    // Waar Bucky is als hij duikt.
    const duik = {
        plek: null,        // de duikplek boven water waar je te water ging
        actief: false,     // duik je?
        x: 0, y: 0,
        vx: 0, vy: 0,
        zuurstof: ZUURSTOF_MAX,
        voorraad: ZUURSTOF_MAX,   // hangt af van het duikpak
        kijk: 1,           // 1 = naar rechts, -1 = naar links
    };

    // Waar Bucky is als hij binnen staat. `kamer` is null zolang hij buiten is.
    const binnenIn = { kamer: null, huis: null, x: 0, y: 0 };

    const speler = {
        aanBoord: true,
        x: 0, y: 0,       // alleen gebruikt als hij uitgestapt is
        kijk: 0,          // radialen; waar hij naartoe kijkt
        snelheid: 118,    // eenheden per seconde, lopend
        straal: 11,       // even groot als hoe hij getekend wordt

        // HET LOOPGEVOEL. Bucky bewoog als een bal die je over een tafel duwt:
        // meteen op snelheid, meteen stil, en verder niets. Drie dingen samen
        // maken er lopen van, en geen ervan gaat over de VORM - het blijft een
        // rode bol, dus het moet uit de beweging komen.
        //
        //   `vaart`  loopt op en af in plaats van te springen: een aanzet en
        //            een afremming. Dit is wat "glijden" wegneemt.
        //   `pas`    telt door zolang hij loopt en stuurt de op-en-neer. Hij
        //            telt op de AFGELEGDE AFSTAND en niet op de tijd, want
        //            anders blijft hij wiebelen als je tegen een muur duwt.
        //   `veer`   is het kort indrukken bij starten en stoppen. Een korte
        //            impuls die vanzelf uitdempt.
        vaart: 0,
        pas: 0,
        veer: 0,
    };

    const staat = {
        modus: "varen",
        afstand: 0,
        streak: 0,
        schoon: true,     // deze aanvaart nog zonder de kust te raken
        aangemeerd: false,
        overgang: 0,      // 0..1, dekking van het overgangsscherm
        overgangNa: null,
    };

    // --- invoer ------------------------------------------------------------
    // DRIE APPARATEN, EEN MODEL. Toetsen, schermknoppen en aanraken zetten
    // allemaal dezelfde vlaggen; niets in de spelcode weet waar een druk
    // vandaan komt. Dat is de reden dat de telefoonbediening geen tweede
    // codepad is.
    // DE BEDIENINGSSTAAT, één model achter joystick, toetsenbord en muis.
    // `richting` is een vector van -1 tot 1 (x naar rechts, y naar beneden) en
    // `sterkte` hoe ver de stick is uitgeslagen. De spellogica kijkt alleen
    // hiernaar en weet niet waar het vandaan komt.
    const bediening = { richting: { x: 0, y: 0 }, sterkte: 0, gas: false };
    const TOETSEN = {
        // DE PIJLEN GEVEN EEN RICHTING, net als de joystick, en niet meer
        // links/rechts/gas. ArrowUp betekende gas geven; nu betekent het
        // noord. Wie een pijl vasthoudt vaart die kant op, want een volle
        // uitslag zet het gas vanzelf aan (zie de vaarstap). Shift is er voor
        // wie het gas los wil kunnen bedienen.
        ArrowLeft: "links", KeyA: "links",
        ArrowRight: "rechts", KeyD: "rechts",
        ArrowUp: "omhoog", KeyW: "omhoog",
        ArrowDown: "omlaag", KeyS: "omlaag",
        ShiftLeft: "gas", ShiftRight: "gas",
        Space: "actie", Enter: "actie",
    };

    // Welke pijltjes op dit moment ingedrukt zijn. Het toetsenbord levert een
    // RICHTING aan, net als de joystick, in plaats van losse links/rechts-
    // vlaggen. Zo is er maar één pad naar de spellogica en gedraagt varen met
    // toetsen zich precies als varen met een duim.
    const ingedrukt = new Set();

    function werkRichtingBij() {
        let x = 0, y = 0;
        if (ingedrukt.has("links")) x -= 1;
        if (ingedrukt.has("rechts")) x += 1;
        if (ingedrukt.has("omhoog")) y -= 1;
        if (ingedrukt.has("omlaag")) y += 1;
        const lengte = Math.hypot(x, y);
        if (lengte === 0) {
            bediening.richting.x = 0;
            bediening.richting.y = 0;
            bediening.sterkte = 0;
        } else {
            // Genormaliseerd, anders is schuin sneller dan recht - de klassieke
            // fout waarbij diagonaal lopen 1,41 keer zo hard gaat.
            bediening.richting.x = x / lengte;
            bediening.richting.y = y / lengte;
            bediening.sterkte = 1;
        }
    }

    function opToets(e, aan) {
        const naam = TOETSEN[e.code];
        if (!naam) return;
        e.preventDefault();
        if (naam === "actie") {
            if (aan && !e.repeat) doeActie();
            return;
        }
        if (naam === "gas") {
            bediening.gas = aan;
            return;
        }
        if (aan) ingedrukt.add(naam); else ingedrukt.delete(naam);
        werkRichtingBij();
    }
    const keydown = (e) => opToets(e, true);
    const keyup = (e) => opToets(e, false);
    const blur = () => {
        // Focus kwijt betekent: alles los. Anders blijft de boot varen omdat
        // de browser de keyup nooit meer levert - dat is hoe je met een
        // alt-tab terugkomt bij een schip dat tegen de kust ligt te duwen.
        ingedrukt.clear();
        bediening.richting.x = 0;
        bediening.richting.y = 0;
        bediening.sterkte = 0;
        bediening.gas = false;
    };

    // De schermknoppen. Ze staan in de DOM naast het canvas en niet erin
    // getekend, want een getekende knop is niet focusbaar en niet voorleesbaar.
    const bedieningen = maakHud();

    // --- geluid ------------------------------------------------------------
    // STANDAARD UIT, en dat is geen instelling maar de enige juiste stand:
    // dit spel staat op een pagina die iemand kan openen met de koptelefoon op.
    // Bovendien mag een AudioContext van geen enkele browser starten zonder
    // gebaar, dus zelfs een aan-stand zou hier niet werken - hij wordt pas
    // gebouwd op de klik die hem aanzet.
    //
    // Er zit geen bestand achter. Twee oscillatoren en wat ruis geven de motor
    // en het water, en dat scheelt een download op een pagina zonder buildstap.
    const geluid = {
        ctx: null, aan: false, motor: null, motorGain: null,
        waterGain: null, hoofdGain: null,

        bouw() {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return false;
            const ac = new AC();
            this.ctx = ac;

            this.hoofdGain = ac.createGain();
            this.hoofdGain.gain.value = 0.0;
            this.hoofdGain.connect(ac.destination);

            // Motor: een lage zaagtand door een laagdoorlaatfilter.
            this.motor = ac.createOscillator();
            this.motor.type = "sawtooth";
            this.motor.frequency.value = 46;
            const filter = ac.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.value = 260;
            this.motorGain = ac.createGain();
            this.motorGain.gain.value = 0;
            this.motor.connect(filter);
            filter.connect(this.motorGain);
            this.motorGain.connect(this.hoofdGain);
            this.motor.start();

            // Water: witte ruis in een lus, door een banddoorlaat.
            const lengte = ac.sampleRate * 2;
            const buffer = ac.createBuffer(1, lengte, ac.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < lengte; i++) data[i] = Math.random() * 2 - 1;
            const ruis = ac.createBufferSource();
            ruis.buffer = buffer;
            ruis.loop = true;
            const band = ac.createBiquadFilter();
            band.type = "bandpass";
            band.frequency.value = 780;
            band.Q.value = 0.7;
            this.waterGain = ac.createGain();
            this.waterGain.gain.value = 0;
            ruis.connect(band);
            band.connect(this.waterGain);
            this.waterGain.connect(this.hoofdGain);
            ruis.start();
            return true;
        },

        zet(aan) {
            if (aan && !this.ctx && !this.bouw()) return false;
            this.aan = aan;
            if (!this.ctx) return false;
            if (aan && this.ctx.state === "suspended") this.ctx.resume();
            const nu = this.ctx.currentTime;
            this.hoofdGain.gain.cancelScheduledValues(nu);
            this.hoofdGain.gain.setTargetAtTime(aan ? 0.5 : 0, nu, 0.15);
            return true;
        },

        // Elke frame bijstellen op de vaart. Toonhoogte EN volume, want alleen
        // volume klinkt als een radio die harder gaat en niet als gas geven.
        volg(vaart) {
            if (!this.aan || !this.ctx) return;
            const nu = this.ctx.currentTime;
            this.motor.frequency.setTargetAtTime(44 + vaart * 34, nu, 0.12);
            this.motorGain.gain.setTargetAtTime(0.05 + vaart * 0.16, nu, 0.12);
            this.waterGain.gain.setTargetAtTime(0.012 + vaart * 0.05, nu, 0.2);
        },

        // Een korte toon bij aanmeren en van boord stappen.
        piep(hz) {
            if (!this.aan || !this.ctx) return;
            const nu = this.ctx.currentTime;
            const o = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            o.type = "sine";
            o.frequency.value = hz;
            g.gain.setValueAtTime(0.0001, nu);
            g.gain.exponentialRampToValueAtTime(0.22, nu + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, nu + 0.5);
            o.connect(g); g.connect(this.hoofdGain);
            o.start(nu); o.stop(nu + 0.55);
        },

        stop() {
            if (this.ctx) { try { this.ctx.close(); } catch (e) { /* al dicht */ } }
            this.ctx = null; this.aan = false;
        },
    };

    /**
     * DE BEDIENING LIGT OP HET SPEL, NIET ERONDER.
     *
     * Hier stond een rij knoppen onder het canvas. Dat werkt op een muis en
     * verder eigenlijk niet: op een telefoon staat je duim dan onder het beeld
     * in plaats van erop, je moet kijken waar je drukt, en sturen is aan- en
     * uitzetten in plaats van sturen. Een spel bedien je zonder ernaar te
     * hoeven kijken.
     *
     * Nu: een joystick linksonder voor de richting, drie knoppen rechtsonder
     * voor gas, anker en geluid, allebei OVER het speelveld. Dat is de plek
     * waar je duimen al liggen als je een telefoon met twee handen vasthoudt.
     *
     * DE JOYSTICK GEEFT EEN RICHTING, GEEN LINKS-OF-RECHTS. Dat is nodig voor
     * fase 2: aan land loopt Bucky gewoon de kant op die je aangeeft, en op het
     * water stuurt de boot naar die richting toe. Eén bedieningsmodel voor
     * twee spelvormen, in plaats van twee sets knoppen die elkaar afwisselen.
     */
    function maakHud() {
        const hoes = document.createElement("div");
        hoes.className = "mg-hud";

        // --- de joystick ---------------------------------------------------
        const stick = document.createElement("div");
        stick.className = "mg-stick";
        // Een joystick is bedienbaar met het toetsenbord, dus hij is een knop
        // en geen div met een muisluisteraar. Zonder tabindex en rol is dit
        // voor een schermlezer een decoratief vlak.
        stick.tabIndex = 0;
        stick.setAttribute("role", "application");
        stick.setAttribute("aria-label",
            "Steering stick. Drag it, or use the arrow keys, to steer.");
        const knop = document.createElement("div");
        knop.className = "mg-stick-knob";
        stick.appendChild(knop);

        const STRAAL = 44;   // hoe ver de knop uit het midden mag
        let stickId = null;  // welke vinger de stick vasthoudt

        const zetKnop = (x, y) => {
            knop.style.transform = `translate(${x}px, ${y}px)`;
        };

        const stuurUit = (x, y) => {
            // Buiten de straal wordt de uitslag geknepen, niet afgekapt: de
            // richting blijft kloppen ook als je verder trekt dan de ring.
            const lengte = Math.hypot(x, y);
            const f = lengte > STRAAL ? STRAAL / lengte : 1;
            const kx = x * f, ky = y * f;
            zetKnop(kx, ky);
            // DODE ZONE. Zonder deze drempel stuurt een duim die stil ligt nog
            // steeds een klein beetje, en dan dobbert de boot uit zichzelf weg.
            const sterkte = Math.hypot(kx, ky) / STRAAL;
            if (sterkte < 0.18) {
                bediening.richting.x = 0;
                bediening.richting.y = 0;
                bediening.sterkte = 0;
            } else {
                bediening.richting.x = kx / STRAAL;
                bediening.richting.y = ky / STRAAL;
                bediening.sterkte = Math.min(1, sterkte);
            }
        };

        const losLaten = () => {
            stickId = null;
            zetKnop(0, 0);
            bediening.richting.x = 0;
            bediening.richting.y = 0;
            bediening.sterkte = 0;
            stick.classList.remove("is-actief");
        };

        stick.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            stickId = e.pointerId;
            stick.setPointerCapture(e.pointerId);
            stick.classList.add("is-actief");
            const r = stick.getBoundingClientRect();
            stuurUit(e.clientX - (r.left + r.width / 2),
                     e.clientY - (r.top + r.height / 2));
        });
        stick.addEventListener("pointermove", (e) => {
            if (e.pointerId !== stickId) return;
            e.preventDefault();
            const r = stick.getBoundingClientRect();
            stuurUit(e.clientX - (r.left + r.width / 2),
                     e.clientY - (r.top + r.height / 2));
        });
        for (const soort of ["pointerup", "pointercancel", "lostpointercapture"]) {
            stick.addEventListener(soort, (e) => {
                if (e.pointerId !== stickId) return;
                losLaten();
            });
        }
        // Het toetsenbord stuurt dezelfde waarden als de duim, zodat er maar
        // één pad naar de spellogica is.
        stick.addEventListener("keydown", (e) => {
            const kaart = {
                ArrowLeft: [-1, 0], ArrowRight: [1, 0],
                ArrowUp: [0, -1], ArrowDown: [0, 1],
                a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1],
            };
            const v = kaart[e.key] || kaart[e.key.toLowerCase()];
            if (!v) return;
            e.preventDefault();
            stuurUit(v[0] * STRAAL, v[1] * STRAAL);
        });
        stick.addEventListener("keyup", (e) => {
            if (e.key.startsWith("Arrow") || "wasd".includes(e.key.toLowerCase())) {
                losLaten();
            }
        });
        stick.addEventListener("blur", losLaten);

        // --- de knoppen rechts ---------------------------------------------
        const rechts = document.createElement("div");
        rechts.className = "mg-knoppen";

        const maakKnop = (klasse, label, tekst, opties = {}) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = `mg-knop ${klasse}`;
            b.setAttribute("aria-label", label);
            const span = document.createElement("span");
            span.className = "mg-knop-teken";
            span.textContent = tekst;
            b.appendChild(span);
            if (opties.vasthouden) {
                // Gas is een knop die je INDRUKT EN VASTHOUDT. Een click-
                // luisteraar zou hem een tik maken, en dan kun je niet varen.
                const aan = (e) => { e.preventDefault(); bediening.gas = true;
                                     b.classList.add("is-in"); };
                const uit = (e) => { e.preventDefault(); bediening.gas = false;
                                     b.classList.remove("is-in"); };
                b.addEventListener("pointerdown", aan);
                for (const soort of ["pointerup", "pointerleave", "pointercancel"]) {
                    b.addEventListener(soort, uit);
                }
                // En met het toetsenbord: spatie of enter ingedrukt houden.
                b.addEventListener("keydown", (e) => {
                    if (e.key === " " || e.key === "Enter") { e.preventDefault(); aan(e); }
                });
                b.addEventListener("keyup", (e) => {
                    if (e.key === " " || e.key === "Enter") { e.preventDefault(); uit(e); }
                });
                b.addEventListener("blur", () => { bediening.gas = false;
                                                   b.classList.remove("is-in"); });
            } else if (opties.klik) {
                b.addEventListener("click", (e) => { e.preventDefault(); opties.klik(b); });
            }
            rechts.appendChild(b);
            return b;
        };

        maakKnop("mg-knop-gas", "Throttle. Hold to sail forward.", "▲",
                 { vasthouden: true });
        maakKnop("mg-knop-anker", "Moor at the jetty, or step back aboard.", "⚓",
                 { klik: () => doeActie() });

        const tasKnop = maakKnop("mg-knop-tas", "Open your finds.", "▤", {
            klik: (knop) => {
                inventoryOpen = !inventoryOpen;
                knop.setAttribute("aria-pressed", inventoryOpen ? "true" : "false");
                knop.classList.toggle("is-aan", inventoryOpen);
                const n = Object.values(inventory).reduce((a, b) => a + b, 0);
                zeg(inventoryOpen
                    ? (n ? `Your finds: ${beschrijfInventory()}` : "You have not found anything yet.")
                    : "Finds closed.");
            },
        });
        tasKnop.setAttribute("aria-pressed", "false");

        const geluidKnop = maakKnop("mg-knop-geluid", "Sound off. Activate to turn sound on.",
                                    "♪", { klik: (b) => {
            const wil = !geluid.aan;
            const gelukt = geluid.zet(wil);
            const nu = gelukt && wil;
            b.setAttribute("aria-pressed", nu ? "true" : "false");
            b.classList.toggle("is-aan", nu);
            // NOOIT ALLEEN KLEUR: het opschrift onder het notenteken zegt de
            // stand, en het aria-label zegt hem ook.
            b.querySelector(".mg-knop-stand").textContent = nu ? "ON" : "OFF";
            b.setAttribute("aria-label", nu
                ? "Sound on. Activate to turn sound off."
                : "Sound off. Activate to turn sound on.");
            zeg(nu ? "Sound on." : "Sound off.");
            if (!gelukt && wil) zeg("This browser blocked audio.");
        } });
        geluidKnop.setAttribute("aria-pressed", "false");
        const stand = document.createElement("span");
        stand.className = "mg-knop-stand";
        stand.textContent = "OFF";
        geluidKnop.appendChild(stand);

        hoes.append(stick, rechts);
        // In de hoes om het canvas, zodat de bediening er OVERHEEN ligt.
        const veld = canvas.parentElement.classList.contains("mg-veld")
            ? canvas.parentElement
            : (() => {
                const v = document.createElement("div");
                v.className = "mg-veld";
                canvas.parentNode.insertBefore(v, canvas);
                v.appendChild(canvas);
                return v;
            })();
        veld.appendChild(hoes);
        return hoes;
    }

    // --- de modi -----------------------------------------------------------
    // Elke modus is een klein object. Een fase erbij is hier een sleutel erbij.
    const MODI = {
        varen: {
            stap(dt) {
                // STUREN NAAR EEN RICHTING, niet links-of-rechts.
                //
                // De joystick zegt welke kant je op wilt; de boot draait
                // daarnaartoe over de KORTSTE weg. Dat is wat een stick
                // intuïtief maakt: je wijst waar je heen wilt en het schip
                // komt daar. Met alleen links/rechts moet je zelf uitrekenen
                // welke kant het dichtst is, en dat voelt als besturen van een
                // machine in plaats van varen.
                //
                // De uitslag van de stick begrenst hoe hard er gedraaid wordt,
                // dus een klein duwtje geeft een flauwe correctie en een volle
                // uitslag het roer helemaal om.
                let stuur = 0;
                if (bediening.sterkte > 0) {
                    const doelhoek = Math.atan2(bediening.richting.y, bediening.richting.x);
                    // Verschil netjes terugbrengen naar het bereik -PI..PI,
                    // anders draait hij de lange kant om bij de overgang.
                    let verschil = doelhoek - boot.hoek;
                    while (verschil > Math.PI) verschil -= TAU;
                    while (verschil < -Math.PI) verschil += TAU;
                    stuur = klem(verschil * 2.2, -1, 1) * bediening.sterkte;
                    boot.hoek += stuur * boot.draaiSnelheid * dt;
                }

                // SLAGZIJ. De helling loopt ACHTER de stuurinvoer aan in plaats
                // van hem te volgen. Daardoor helt de boot in een bocht over en
                // komt hij daarna terug, en dat is het verschil tussen iets dat
                // roteert en iets dat vaart. Hij schaalt mee met de snelheid:
                // stilliggend draaien geeft geen slagzij, want dat is duwen en
                // geen sturen.
                const vaart = Math.abs(boot.snelheid) / boot.maxSnelheid;
                const doelHelling = stuur * vaart * 0.9;
                boot.helling += (doelHelling - boot.helling) * Math.min(1, dt * 3.4);

                // TWEE VERSCHILLENDE CONSTANTEN, en dat is waar het eerst
                // misging. Optrekken en uitrollen deelden er een (1.4), met als
                // gevolg dat de boot traag op gang kwam EN meteen stilviel als
                // je losliet: gemeten kwam hij in drie seconden vol gas maar
                // 151 eenheden vooruit, op een eiland dat 410 verderop ligt.
                //
                // Een boot hoort andersom te voelen: rustig op gang, en dan
                // lang doorglijden. Optrekken op 3.0 zit in ongeveer een
                // seconde op snelheid; uitrollen op 0.6 glijdt ruim driehonderd
                // eenheden door. Dat maakt afremmen voor de steiger een keuze
                // in plaats van een formaliteit - je moet op tijd gas loslaten.
                // Gas komt van de knop, of van de stick zelf zodra je hem
                // ver genoeg uitslaat. Met één duim varen moet kunnen; wie
                // liever apart gas geeft houdt de knop rechts.
                const gas = bediening.gas || bediening.sterkte > 0.6;

                // DE AANLOOPZONE. Binnen driehonderd eenheden van een ligplaats
                // remt de boot vanzelf af, kwadratisch sterker naarmate je
                // dichterbij komt. Aanmeren vroeg hiervoor dat je zelf precies
                // genoeg gas terugnam - te weinig en je schoot voorbij, te veel
                // en je kwam er niet - en dat is doseren met een duim op een
                // joystick. Geen leuke vaardigheid, wel een lastige.
                //
                // Hij is onzichtbaar maar voelbaar: je MERKT dat de boot
                // inhoudt. Er wordt geen cirkel getekend, want een harde rand
                // maakt van een soepele hulp een grens waar je op gaat mikken.
                boot.rem = 0;
                for (const m of steigerlijst) {
                    const r = aanloopRem(m, boot.x, boot.y);
                    if (r > boot.rem) boot.rem = r;
                }

                const doel = gas ? boot.maxSnelheid * (1 - boot.rem * 0.94) : 0;
                // In de zone rolt hij ook sneller uit, zodat loslaten daar echt
                // iets doet in plaats van driehonderd eenheden door te glijden.
                const traagheid = gas ? 3.0 : 0.6 + boot.rem * 4.5;
                boot.snelheid += (doel - boot.snelheid) * Math.min(1, dt * traagheid);

                // EN EEN HARDE BOVENGRENS, want anders draagt de vaart die je
                // AL had je er dwars doorheen. Alleen het gasdoel verlagen liet
                // de boot met zijn opgebouwde snelheid de zone in schieten en
                // er aan de andere kant weer uit; gemeten haalde hij het in
                // zesentwintig seconden geen enkele keer.
                //
                // Vlak bij de ligplaats blijft er ongeveer een tiende van de
                // topsnelheid over: genoeg om te manoeuvreren, te weinig om
                // eroverheen te schieten.
                const plafond = boot.maxSnelheid * (1 - boot.rem * 0.9);
                if (boot.snelheid > plafond) {
                    boot.snelheid += (plafond - boot.snelheid) * Math.min(1, dt * 6);
                }

                const nx = boot.x + Math.cos(boot.hoek) * boot.snelheid * dt;
                const ny = boot.y + Math.sin(boot.hoek) * boot.snelheid * dt;

                if (raaktLand(nx, ny, 14)) {
                    // Afstuiten. Dit is dezelfde controle die in fase 2 een
                    // speler tegen een muur laat lopen.
                    boot.snelheid = -Math.abs(boot.snelheid) * 0.35;
                    if (staat.schoon) {
                        staat.schoon = false;
                        zeg("You scraped the shore. The run is no longer clean.");
                    }
                } else {
                    staat.afstand += Math.hypot(nx - boot.x, ny - boot.y);
                    boot.x = nx; boot.y = ny;
                }
                boot.x = klem(boot.x, 20, WERELD.w - 20);
                boot.y = klem(boot.y, 20, WERELD.h - 20);

                // HET KIELZOG. Punten komen achter de SPIEGEL te liggen en niet
                // op het midden van de boot; anders lijkt het spoor uit de romp
                // te groeien in plaats van eruit te lopen. Alleen bij echte
                // vaart, want stilliggend hoort er geen spoor te ontstaan.
                if (Math.abs(boot.snelheid) > 26) {
                    boot.kielzog.push({
                        x: boot.x - Math.cos(boot.hoek) * 20,
                        y: boot.y - Math.sin(boot.hoek) * 20,
                        hoek: boot.hoek,
                        leeftijd: 0,
                        kracht: Math.min(1, Math.abs(boot.snelheid) / boot.maxSnelheid),
                    });
                    if (boot.kielzog.length > KIELZOG_MAX) boot.kielzog.shift();
                }
                for (const k of boot.kielzog) k.leeftijd += dt;
                while (boot.kielzog.length && boot.kielzog[0].leeftijd > 1.6) {
                    boot.kielzog.shift();
                }
            },
        },
        aangemeerd: {
            binnen() {
                staat.aangemeerd = true;
                speler.aanBoord = false;
                const m = dichtsteSteiger();

                // DE BOOT LEGT AAN NAAST DE PLANKEN. Dit was het open punt.
                //
                // De steiger liep dwars over de kustlijn - half over water,
                // half over gras - dus waar je ook aanlegde, je lag op het dek.
                // Nu steekt de steiger vanaf de kust het water op, en bij het
                // aanmeren gaat de boot naar zijn LIGPLAATS: evenwijdig aan de
                // steiger, een halve plankbreedte plus een halve boot opzij.
                //
                // Dat is een verplaatsing en geen vrije keuze, en dat is precies
                // wat aanmeren is. In elk bootspel legt het schip netjes aan
                // zodra je aanmeert; je hoeft hem niet op de pixel te parkeren.
                // Elke nieuwe steiger erft dit vanzelf, want de ligplaats wordt
                // uit de kustlijn afgeleid en niet per steiger overgetypt.
                boot.x = m.ligplaats.x;
                boot.y = m.ligplaats.y;
                boot.hoek = m.ligplaats.hoek;
                boot.snelheid = 0;
                boot.helling = 0;
                boot.kielzog.length = 0;

                // Bucky stapt aan wal aan de landkant van de steiger.
                speler.x = m.walkant.x;
                speler.y = m.walkant.y;
                speler.kijk = Math.atan2(m.richting.y, m.richting.x) + Math.PI;

                staat.streak += staat.schoon ? 1 : 0;
                meld("streak", staat.streak);
                zeg(staat.schoon
                    ? `Moored at ${m.eiland.naam}. Clean run, streak ${staat.streak}.`
                    : `Moored at ${m.eiland.naam}. Streak reset by the scrape.`);
                if (!staat.schoon) { staat.streak = 0; meld("streak", 0); }
            },
            stap(dt) {
                boot.snelheid = 0;

                // FASE 2: LOPEN OVER HET EILAND, met dezelfde joystick.
                //
                // Dit is precies waarom de bediening een RICHTING geeft en geen
                // links/rechts. Aan land is er niets te sturen - je loopt de
                // kant op die je aanwijst - en op het water stuur je naartoe.
                // Eén stick, twee betekenissen, geen tweede set knoppen.
                // AANZET EN AFREMMING. De snelheid loopt naar zijn doel toe in
                // plaats van er meteen te staan. Optrekken mag sneller dan
                // afremmen: dat leest als iemand die op gang komt en daarna
                // nog even doorloopt, en niet als een schakelaar.
                const doel = bediening.sterkte;
                const traag = doel > speler.vaart ? 9 : 7;
                const vorige = speler.vaart;
                speler.vaart += (doel - speler.vaart) * Math.min(1, dt * traag);
                if (speler.vaart < 0.02) speler.vaart = 0;

                // KORT INDRUKKEN bij het starten en bij het stoppen. Een
                // verandering in vaart is de impuls; hij dempt vanzelf uit.
                speler.veer += Math.abs(speler.vaart - vorige) * 2.6;
                speler.veer *= Math.pow(0.02, dt);

                if (bediening.sterkte > 0) {
                    speler.kijk = Math.atan2(bediening.richting.y,
                                             bediening.richting.x);
                }
                if (speler.vaart <= 0) return;

                const rx = Math.cos(speler.kijk), ry = Math.sin(speler.kijk);
                const stap = speler.snelheid * speler.vaart * dt;
                const nx = speler.x + rx * stap;
                const ny = speler.y + ry * stap;

                // BOTSING MET DE RAND, en wel per as. Bij een botsing helemaal
                // stoppen laat je vastplakken zodra je schuin tegen de kust
                // aanloopt: je staat stil terwijl er een richting is waarin je
                // best kunt. Door x en y los te proberen glijd je langs de rand
                // in plaats van erin te blijven hangen, en dat is wat lopen
                // langs een kustlijn hoort te doen.
                const voorX = speler.x, voorY = speler.y;
                if (magLopen(nx, speler.y)) speler.x = nx;
                if (magLopen(speler.x, ny)) speler.y = ny;
                // DE PAS TELT OP AFGELEGDE AFSTAND. Op tijd tellen laat hem
                // doorwiebelen terwijl hij tegen een kust of een muur staat te
                // duwen, en dan loopt hij ter plaatse.
                speler.pas += Math.hypot(speler.x - voorX, speler.y - voorY) * 0.14;
            },
        },

        duiken: {
            binnen() {
                zeg(`Diving at ${duik.plek.naam}. Surface to breathe.`);
            },
            stap(dt) {

                // ZWEMMEN IS NIET LOPEN. Onder water heb je traagheid en een
                // beetje drijfvermogen: laat je de stick los, dan kom je
                // langzaam omhoog in plaats van stil te hangen. Dat maakt
                // "boven komen" iets dat vanzelf gaat als je niets doet, en dat
                // is precies de goede kant op voor een spel met zuurstof erin.
                const versnelling = 340;
                if (bediening.sterkte > 0) {
                    duik.vx += bediening.richting.x * versnelling * bediening.sterkte * dt;
                    duik.vy += bediening.richting.y * versnelling * bediening.sterkte * dt;
                    if (Math.abs(bediening.richting.x) > 0.2) {
                        duik.kijk = bediening.richting.x > 0 ? 1 : -1;
                    }
                }
                duik.vy -= 34 * dt;                    // drijfvermogen
                duik.vx *= Math.pow(0.12, dt);         // water remt
                duik.vy *= Math.pow(0.12, dt);
                const maxV = 190;
                const v = Math.hypot(duik.vx, duik.vy);
                if (v > maxV) { duik.vx *= maxV / v; duik.vy *= maxV / v; }

                const nx = duik.x + duik.vx * dt;
                const ny = duik.y + duik.vy * dt;
                // Per as, zoals overal: langs een rots glijden in plaats van
                // eraan plakken.
                if (magZwemmen(nx, duik.y, speler.straal)) duik.x = nx;
                else duik.vx = 0;
                if (magZwemmen(duik.x, ny, speler.straal)) duik.y = ny;
                else duik.vy = 0;
                duik.y = Math.max(-30, duik.y);

                // De lucht.
                if (aanDeOppervlakte(duik.y)) {
                    duik.zuurstof = Math.min(duik.voorraad, duik.zuurstof + dt * 9);
                } else {
                    duik.zuurstof -= dt;
                    if (duik.zuurstof <= 0) {
                        // GEEN STRAF DIE VOORTGANG WIST. Je raakt buiten westen
                        // en komt bij in je boot, met alles wat je gevonden
                        // hebt. De spanning zit in of je het haalt, niet in wat
                        // je kwijtraakt - en een spel waar je voor je plezier
                        // in rondvaart hoort je niet af te straffen voor
                        // nieuwsgierigheid.
                        duik.zuurstof = 0;
                        return overgang(() => {
                            zetModus("varen");
                            duik.actief = false;
                            zeg("Out of air. You surfaced, and kept everything.");
                        });
                    }
                }
            },
        },

        binnen: {
            binnen() {
                zeg(`Inside ${binnenIn.kamer.naam}. Walk to the door to leave.`);
            },
            stap(dt) {
                // Zelfde loopgevoel als buiten: aanzet, afremming, pas en veer
                // staan op `speler` en niet op de modus, juist zodat lopen
                // overal hetzelfde aanvoelt.
                const doel = bediening.sterkte;
                const traag = doel > speler.vaart ? 9 : 7;
                const vorige = speler.vaart;
                speler.vaart += (doel - speler.vaart) * Math.min(1, dt * traag);
                if (speler.vaart < 0.02) speler.vaart = 0;
                speler.veer += Math.abs(speler.vaart - vorige) * 2.6;
                speler.veer *= Math.pow(0.02, dt);
                if (bediening.sterkte > 0) {
                    speler.kijk = Math.atan2(bediening.richting.y,
                                             bediening.richting.x);
                }
                if (speler.vaart <= 0) return;
                const rx = Math.cos(speler.kijk), ry = Math.sin(speler.kijk);
                const stap = speler.snelheid * speler.vaart * dt;
                const nx = binnenIn.x + rx * stap;
                const ny = binnenIn.y + ry * stap;
                // PER AS, net als buiten. Bij een botsing helemaal stoppen laat
                // je vastplakken tegen een tafel zodra je er schuin tegenaan
                // loopt; los proberen laat je erlangs glijden.
                const r = speler.straal;
                const voorX = binnenIn.x, voorY = binnenIn.y;
                if (magLopenBinnen(binnenIn.kamer, nx, binnenIn.y, r)) binnenIn.x = nx;
                if (magLopenBinnen(binnenIn.kamer, binnenIn.x, ny, r)) binnenIn.y = ny;
                speler.pas += Math.hypot(binnenIn.x - voorX,
                                         binnenIn.y - voorY) * 0.14;
            },
        },
    };

    function zetModus(naam) {
        staat.modus = naam;
        const m = MODI[naam];
        if (m && m.binnen) m.binnen();
    }

    function doeActie() {
        if (!draait) return;
        // TIJDENS EEN OVERGANG GEBEURT ER NIETS.
        //
        // Zonder deze regel start elke nieuwe druk op het anker de overgang
        // opnieuw. Wie het knopje twee keer aantikt - of het ingedrukt houdt,
        // of ongeduldig is - zet het scherm dus in een fade die nooit afloopt,
        // en dan lijkt aanmeren kapot terwijl het elke keer keurig begint.
        //
        // Gevonden doordat een test het anker om de halve seconde probeerde tot
        // het pakte, en het daardoor veertien keer opnieuw liet beginnen.
        if (staat.overgang > 0) return;
        if (staat.modus === "varen") {
            // EERST DE DUIKPLEK. Lig je op een duikplek, dan duik je; anders
            // gaat het anker over aanmeren. Dezelfde regel als aan land: één
            // knop die doet wat er op die plek te doen is.
            const plek = dichtsteDuikplek();
            if (plek) {
                return overgang(() => {
                    duik.plek = plek;
                    duik.actief = true;
                    const instap = instappunt(plek.id);
                    duik.x = instap.x;
                    duik.y = instap.y;
                    duik.vx = 0; duik.vy = 0;
                    // De voorraad hangt af van wat je bij je hebt, en wordt bij
                    // ELKE duik opnieuw bepaald - vind je het pak halverwege een
                    // sessie, dan geldt het meteen bij de volgende duik.
                    duik.voorraad = zuurstofVoorraad(!!inventory.duikpak);
                    duik.zuurstof = duik.voorraad;
                    zetModus("duiken");
                });
            }

            const s = dichtsteSteiger();
            const dichtbij = s && afstandTot(s.ligplaats.x, s.ligplaats.y) < 150;
            const langzaam = Math.abs(boot.snelheid) < 95;
            if (!dichtbij) return zeg("Steer up to the jetty to moor.");
            if (!langzaam) return zeg("Too fast to moor. Ease off the throttle.");
            geluid.piep(660);
            overgang(() => zetModus("aangemeerd"));
        } else if (staat.modus === "duiken") {
            const kist = kistOnderWater();
            if (kist) return void openKist(kist);
            if (!aanDeOppervlakte(duik.y)) {
                return zeg("Swim up to the surface to climb back aboard.");
            }
            overgang(() => {
                zetModus("varen");
                duik.actief = false;
                zeg("Back in the boat.");
            });
        } else if (staat.modus === "binnen") {
            // EERST DE KIST. Sta je bij een kist, dan is dat wat het anker
            // doet; sta je bij de deur, dan ga je naar buiten. Eén knop die het
            // meest voor de hand liggende doet op de plek waar je staat, in
            // plaats van een knop per handeling die je speelveld opeet.
            const kist = kistBijSpeler();
            if (kist) return void openKist(kist);

            // Naar buiten kan alleen BIJ DE DEUR. Anders is een huis geen kamer
            // met een deur maar een kamer met een knop, en dan had de deur ook
            // niet getekend hoeven worden.
            if (!bijDeur(binnenIn.kamer, binnenIn.x, binnenIn.y)) {
                return zeg("Walk to the door to step outside.");
            }
            overgang(() => {
                // Net BUITEN het huis neerzetten, onder de deur, zodat je niet
                // meteen weer naar binnen loopt.
                speler.x = binnenIn.huis.x;
                speler.y = binnenIn.huis.y + HUIS_MAAT.h * 1.1;
                speler.kijk = Math.PI / 2;
                binnenIn.kamer = null;
                binnenIn.huis = null;
                zetModus("aangemeerd");
                zeg("Back outside.");
            });
        } else if (staat.modus === "aangemeerd") {
            // EERST DE DEUR, DAN DE BOOT. Sta je voor een huis, dan doet het
            // anker het enige dat daar logisch is: naar binnen. Zo is er één
            // actieknop voor alles wat er te doen valt, en komt er geen tweede
            // knop bij die negen van de tien keer niets doet - op een telefoon
            // is elke knop die je erbij zet een stuk speelveld dat je kwijt bent.
            const huis = dichtsteHuis();
            if (huis) {
                const kamer = INTERIEURS[huis.soort];
                return overgang(() => {
                    binnenIn.kamer = kamer;
                    binnenIn.huis = huis;
                    // Net BINNEN de deur, zodat je niet meteen weer buiten
                    // staat - maar wel binnen het deurbereik, anders moet je
                    // eerst een stapje terug om weer naar buiten te kunnen.
                    const start = deurStart(kamer);
                    binnenIn.x = start.x;
                    binnenIn.y = start.y;
                    speler.kijk = -Math.PI / 2;
                    zetModus("binnen");
                });
            }

            // Alleen aan boord als je bij de boot staat. Anders kun je van het
            // andere eind van het eiland teleporteren, en dan is een steiger
            // geen plek meer maar een knop.
            const m = dichtsteSteiger();
            const bij = m && Math.hypot(speler.x - boot.x, speler.y - boot.y) < 120;
            if (!bij) return zeg("Walk back to the boat to cast off.");
            overgang(() => {
                staat.aangemeerd = false;
                speler.aanBoord = true;
                staat.schoon = true;
                zetModus("varen");
                geluid.piep(880);
                zeg("Back aboard. Open water ahead.");
            });
        }
    }

    /**
     * Het overgangsscherm. Fase 1 gebruikt hem bij aanmeren en instappen; het
     * huisje in een latere fase is exact dezelfde aanroep met een andere
     * callback. Bij `prefers-reduced-motion` gebeurt de wissel meteen.
     */
    function overgang(daarna) {
        if (minderBeweging) return daarna();
        staat.overgang = 0.001;
        staat.overgangNa = daarna;
    }

    // --- hulpjes -----------------------------------------------------------
    const klem = (v, a, b) => Math.max(a, Math.min(b, v));
    const afstandTot = (x, y) => Math.hypot(boot.x - x, boot.y - y);

    /**
     * Mag Bucky op (x, y) staan?
     *
     * Het spiegelbeeld van `raaktLand`: de boot mag NIET op het land komen en
     * Bucky mag er niet AF. Het gaat om dezelfde cirkel, dus het hoort ook
     * dezelfde som te zijn - anders lopen die twee op den duur uit elkaar en
     * ontstaat er een rand waar de een wel komt en de ander niet.
     *
     * Hij mag tot aan het droge zand (`l.r + 13`, dezelfde waarde als waar
     * `tekenEiland` het strand tekent) en niet in de natte rand. De steiger
     * telt mee, want daar stapt hij aan wal.
     */
    /**
     * Mag Bucky op (x, y) staan?
     *
     * Het spiegelbeeld van `raaktLand`: de boot mag niet OP het land en Bucky
     * mag er niet AF. Dezelfde kustlijn, dus dezelfde som - anders lopen die
     * twee uit elkaar en ontstaat er een rand waar de een wel komt en de ander
     * niet.
     */
    function magLopen(x, y) {
        for (const m of steigerlijst) {
            if (opSteiger(x, y, m)) return true;
        }
        // Een marge zo groot als Bucky zelf, zodat hij niet half in zee staat.
        return landOnder(x, y, speler.straal) !== null;
    }

    /** Raakt de boot land? De steiger is een gat in de kust. */
    function raaktLand(x, y, marge) {
        for (const m of steigerlijst) {
            if (opSteiger(x, y, m)) return false;
        }
        return landOnder(x, y, -marge) !== null;
    }

    /**
     * De kist waar Bucky binnen voor staat, of null.
     *
     * De id is `soort/meubelnaam`, dus stabiel over sessies heen en afleidbaar
     * uit de plek. Dat is wat een server later nodig heeft om te zeggen "die
     * heb je al gehad" - zie boat/loot.js.
     */
    function kistBijSpeler() {
        if (staat.modus !== "binnen" || !binnenIn.kamer) return null;
        for (const m of binnenIn.kamer.meubels) {
            if (!m.kist) continue;
            const cx = Math.max(m.x, Math.min(binnenIn.x, m.x + m.w));
            const cy = Math.max(m.y, Math.min(binnenIn.y, m.y + m.h));
            // RUIM GENOEG OM NAAST TE STAAN. Op 16 eenheden reikwijdte mist
            // je de kast in de hut met twee eenheden als je langs de muur
            // loopt - de kast staat tegen de wand en jij ook, maar er zit een
            // meubel tussen. Dezelfde afweging als bij de huisdeur: een eis
            // "sta precies daar" is op een joystick een eis die de speler
            // verliest, en er valt hier niets te winnen met nauwkeurigheid.
            if (Math.hypot(binnenIn.x - cx, binnenIn.y - cy) < speler.straal + 26) {
                return { meubel: m, id: `${binnenIn.huis.soort}/${m.kist}` };
            }
        }
        return null;
    }

    /**
     * Een kist openen.
     *
     * `vraagInhoud` geeft een promise terug, ook al rekent hij nu lokaal. Dat
     * is met opzet: als de server dit later overneemt hoeft hier niets te
     * veranderen, want er wordt al gewacht op een antwoord dat er niet meteen
     * is. Zie de kop van boat/loot.js.
     */
    async function openKist(kist) {
        if (geopend.has(kist.id)) {
            return zeg("You have already emptied this one.");
        }
        // Het duikpak ligt op één afgesproken plek en niet in de trekking:
        // een voorwerp dat iets DOET hoort niet van geluk af te hangen. En het
        // ligt in het ondiepe rif, want anders is het een deur waarvan de
        // sleutel achter diezelfde deur ligt.
        //
        // LET OP DE VORM VAN DE ID. Een kist onder water heet in het spel
        // `dive/<duikplek>/<kist>`, want die moet uniek zijn over de hele
        // wereld. `PAK_KIST` beschrijft een plek in een PLAATS - `rif/rif-2` -
        // want dezelfde onderwaterplaats kan door meer dan een duikplek worden
        // gebruikt. Die twee vergelijken gaf nooit een treffer, en dus zat het
        // duikpak nergens in: het spel deed niets fout, het vond alleen nooit
        // wat het zocht.
        const extras = (kist.meubel && kist.meubel.id === PAK_KIST
                        && !inventory.duikpak) ? ["duikpak"] : [];
        const uit = await vraagInhoud(kist.id, extras);
        // PAS AFVINKEN ALS DE INHOUD ER IS.
        //
        // Eerst stond `geopend.add` hierboven, vóór het wachten. Toen de
        // aanroep daarna stukliep (`vernietigd` bestaat in dit bestand niet -
        // die naam kwam uit een ander spel) was de kist wél als leeg
        // gemarkeerd en had de speler niets: een kist die je één keer kunt
        // openen en die dan niets geeft, zonder dat er iets zichtbaar misgaat.
        //
        // Dat is precies wat er straks ook fout kan gaan als de server de
        // inhoud bepaalt en het netwerk hapert. Eerst hebben, dan afvinken.
        if (!draait) return;
        geopend.add(kist.id);
        bewaarGeopend(geopend);
        const namen = [];
        for (const sleutel of uit.spullen) {
            inventory[sleutel] = (inventory[sleutel] || 0) + 1;
            namen.push(SPULLEN[sleutel].naam);
        }
        bewaarInventory(inventory);
        laatsteVondst = { spullen: uit.spullen, tijd: performance.now() };
        zeg(`Found: ${namen.join(", ")}.`);
    }

    /** De duikplek waar de boot boven ligt, of null. */
    function dichtsteDuikplek() {
        if (!speler.aanBoord) return null;
        for (const p of DUIKPLEKKEN) {
            // Hetzelfde bereik als waarbinnen de plek zichtbaar oplicht, zodat
            // "ik zie hem" en "ik kan hier duiken" hetzelfde betekenen. Op 90
            // was het doel bovendien zo klein dat je er met een halve seconde
            // gas overheen schiet.
            if (Math.hypot(boot.x - p.x, boot.y - p.y) < DUIK_BEREIK) return p;
        }
        return null;
    }

    /** De kist waar Bucky onder water naast zwemt, of null. */
    function kistOnderWater() {
        if (staat.modus !== "duiken") return null;
        for (const k of DIEPTE_KISTEN) {
            const pos = kistPositie(k);
            if (!pos) continue;
            if (Math.hypot(duik.x - pos.x, duik.y - pos.y) < speler.straal + 26) {
                // De id hangt aan de KIST en niet aan de duikplek waar je te
                // water ging: het is één wereld, dus dezelfde kist is dezelfde
                // kist, ook als je via een andere ingang binnenkomt.
                return { meubel: k, pos, id: `dive/${k.id}` };
            }
        }
        return null;
    }

    /** Het huis waar Bucky voor staat, of null. */
    function dichtsteHuis() {
        if (speler.aanBoord) return null;
        // BIJ HET HUIS STAAN IS GENOEG; niet PRECIES voor de deur.
        //
        // Eerst moest je onder het huisje staan, binnen een strook zo breed als
        // de deur. Dat is te nauwkeurig voor een duim op een joystick: je loopt
        // er drie keer langs en denkt dat er niets te doen is. Op een telefoon
        // is elke eis "sta precies daar" een eis die de speler verliest.
        //
        // Een cirkel om het huis heen is ruimhartig genoeg om te vinden en nog
        // steeds klein genoeg om niet per ongeluk te openen. De deur blijft
        // getekend waar hij hoort - hij zegt waar het huis zijn voorkant heeft,
        // en dat is een ander soort informatie dan een botsingsregel.
        let beste = null, best = Infinity;
        for (const h of huizenlijst) {
            const d = Math.hypot(speler.x - h.x, speler.y - h.y);
            if (d < HUIS_MAAT.w * 0.95 && d < best) { best = d; beste = h; }
        }
        return beste;
    }

    function dichtsteSteiger() {
        let beste = null, best = Infinity;
        for (const m of steigerlijst) {
            const d = afstandTot(m.ligplaats.x, m.ligplaats.y);
            if (d < best) { best = d; beste = m; }
        }
        return beste;
    }

    /**
     * De inventory als zin.
     *
     * NIET ALLEEN EEN TEKENING. De vondsten staan straks als vakjes op het
     * scherm, en vakjes met kleuren zijn voor een schermlezer niets. Deze zin
     * gaat naar het aria-live-vak, dus wie het paneel niet kan zien krijgt
     * dezelfde inhoud voorgelezen.
     */
    function beschrijfInventory() {
        const regels = [];
        for (const [sleutel, aantal] of Object.entries(inventory)) {
            if (!SPULLEN[sleutel] || !aantal) continue;
            regels.push(aantal > 1 ? `${SPULLEN[sleutel].naam} x${aantal}`
                                   : SPULLEN[sleutel].naam);
        }
        return regels.length ? regels.join(", ") : "nothing yet";
    }

    function zeg(tekst) { zegStatus(tekst); }
    function meld(naam, waarde) {
        for (const cb of luisteraars[naam] || []) cb(waarde);
    }

    // --- tekenen -----------------------------------------------------------
    function maatVoeren() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const b = canvas.clientWidth || 420;
        const h = canvas.clientHeight || 300;
        if (canvas.width !== Math.round(b * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(b * dpr);
            canvas.height = Math.round(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { b, h };
    }

    function teken(tijd) {
        const { b, h } = maatVoeren();

        // BINNEN IS EEN ANDERE WERELD. Geen water, geen camera die volgt, geen
        // kompas: één kamer die helemaal in beeld past. De HUD en de overgang
        // komen er wel overheen, want die horen bij het spel en niet bij de
        // plek waar je staat.
        if (staat.modus === "duiken") {
            tekenDuik(b, h, tijd);
            tekenHud(b, h);
            tekenZuurstof(b, h);
            tekenDiepte(b, h);
            if (inventoryOpen) tekenInventory(b, h);
            tekenVondst(b, h);
            if (staat.overgang > 0) tekenOvergang(b, h);
            if (document.activeElement === canvas) tekenFocus(b, h);
            return;
        }

        if (staat.modus === "binnen") {
            tekenBinnen(b, h, tijd);
            tekenHud(b, h);
            if (inventoryOpen) tekenInventory(b, h);
            tekenVondst(b, h);
            if (staat.overgang > 0) tekenOvergang(b, h);
            if (document.activeElement === canvas) tekenFocus(b, h);
            return;
        }

        // ZOOM. De wereld werd op 1:1 getekend, en op een canvas van 800 breed
        // is een boot van 46 eenheden dan een stipje: je ziet dat er iets vaart
        // maar niet WAT. Een vaste vergroting maakt de romp leesbaar zonder de
        // fysica of de afstanden aan te raken - die staan allemaal in
        // wereldeenheden en blijven precies zoals ze waren.
        //
        // Het gevolg is wel dat het zichtbare stuk wereld kleiner is dan het
        // canvas, dus alles wat "vul het beeld" doet moet in ZICHT-eenheden
        // rekenen en niet in schermpixels. Vandaar zb en zh hieronder.
        const zb = b / ZOOM;
        const zh = h / ZOOM;
        // DE CAMERA VOLGT WIE ER SPEELT. Aan land is dat Bucky en niet de boot;
        // die ligt dan aan de steiger en gaat nergens heen. Zonder dit loop je
        // zo het beeld uit en zie je jezelf niet meer.
        const volgX = speler.aanBoord ? boot.x : speler.x;
        const volgY = speler.aanBoord ? boot.y : speler.y;
        camera.x = klem(volgX - zb / 2, 0, Math.max(0, WERELD.w - zb));
        camera.y = klem(volgY - zh / 2, 0, Math.max(0, WERELD.h - zh));

        ctx.fillStyle = KLEUR.diep;
        ctx.fillRect(0, 0, b, h);

        ctx.save();
        ctx.scale(ZOOM, ZOOM);
        ctx.translate(-camera.x, -camera.y);

        tekenWater(zb, zh, tijd);
        tekenWolkenschaduw(zb, zh, tijd);
        tekenKielzog();
        // ALLEEN WAT IN BEELD STAAT. De wereld is van 3200x2200 naar 6400x4400
        // gegaan en heeft nu honderden boeien; die allemaal per frame tekenen
        // is werk voor niets, want je ziet er hooguit een paar. Een rechthoek-
        // controle vooraf is een vergelijking per ding en scheelt het tekenen.
        const inBeeld = (x, y, rand) =>
            x > camera.x - rand && x < camera.x + zb + rand
            && y > camera.y - rand && y < camera.y + zh + rand;

        // De duikplekken liggen ONDER alles: het is het water zelf dat er
        // anders uitziet, en een boei of een boot hoort er gewoon overheen.
        for (const plek of DUIKPLEKKEN) {
            if (inBeeld(plek.x, plek.y, 180)) tekenDuikplek(plek, tijd);
        }
        for (const d of wereld.dingen) {
            if (inBeeld(d.x, d.y, 120)) tekenDing(d, tijd);
        }
        for (const l of EILANDEN) {
            if (inBeeld(l.x, l.y, l.r * 1.8)) tekenEiland(l, zb, zh);
        }
        for (const m of steigerlijst) {
            if (inBeeld(m.kust.x, m.kust.y, m.lengte + 120)) tekenSteiger(m);
        }
        for (const h of huizenlijst) {
            if (inBeeld(h.x, h.y, 120)) tekenHuis(h, tijd);
        }
        tekenBoot(tijd);
        if (!speler.aanBoord) tekenBucky();
        tekenVogels(tijd);

        ctx.restore();

        tekenHud(b, h);
        if (staat.modus === "varen") tekenKompas(b, h);
        if (inventoryOpen) tekenInventory(b, h);
        tekenVondst(b, h);
        if (staat.overgang > 0) tekenOvergang(b, h);
        if (document.activeElement === canvas) tekenFocus(b, h);
    }

    function tekenWater(b, h, tijd) {
        // DRIE LAGEN, want een enkele rij streepjes leest als behang en niet
        // als water. Onderop een trage deining die het beeld laat ademen,
        // daarboven de golfstreepjes, en daar bovenop losse glinsteringen.
        //
        // Bij reduced motion staat alles stil: het beeld blijft compleet en
        // leesbaar, er beweegt alleen niets uit zichzelf. Dat is een ANDERE
        // tekening, niet dezelfde tekening op lage snelheid.
        const t = minderBeweging ? 0 : tijd * 0.00035;
        const traag = minderBeweging ? 0 : tijd * 0.00011;
        const stap = 74;
        const x0 = Math.floor(camera.x / stap) * stap;
        const y0 = Math.floor(camera.y / stap) * stap;

        // Deining: brede banden die langzaam door het beeld schuiven.
        ctx.fillStyle = "rgba(96, 178, 232, .055)";
        for (let y = y0 - stap * 2; y < camera.y + h + stap * 2; y += stap * 2) {
            const deining = Math.sin(y * 0.004 + traag * 6) * 26;
            ctx.fillRect(camera.x - 40, y + deining, b + 80, stap * 0.7);
        }

        ctx.strokeStyle = KLEUR.golf;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        for (let y = y0; y < camera.y + h + stap; y += stap) {
            for (let x = x0; x < camera.x + b + stap; x += stap) {
                const dy = Math.sin((x * 0.02) + t + y * 0.01) * 4;
                const breedte = 20 + Math.cos(x * 0.013 + t * 1.4) * 8;
                // VERSPRINGING PER RIJ. Zonder deze regel beginnen alle
                // streepjes op dezelfde x-waarden en leest het water als
                // gelinieerd papier: nette kolommen, en water heeft geen
                // kolommen. De halve stap breekt het raster zonder dat er
                // toeval aan te pas komt.
                const schuif = ((y / stap) % 2) * (stap / 2);
                ctx.beginPath();
                ctx.moveTo(x + schuif, y + dy);
                ctx.lineTo(x + schuif + breedte, y + dy);
                ctx.stroke();
            }
        }

        // Glinstering, met opzet op een ANDER raster (stap maal 1.618). Op
        // hetzelfde raster ziet het oog ruitjes, en ruitjes zien er niet uit
        // als water.
        const g = stap * 1.618;
        const gx = Math.floor(camera.x / g) * g;
        const gy = Math.floor(camera.y / g) * g;
        for (let y = gy; y < camera.y + h + g; y += g) {
            for (let x = gx; x < camera.x + b + g; x += g) {
                const puls = Math.sin(x * 0.05 + y * 0.03 + t * 3.1);
                if (puls < 0.55) continue;
                ctx.fillStyle = "rgba(214, 240, 255, " + ((puls - 0.55) * 0.5) + ")";
                ctx.fillRect(x + 18, y + 24, 7, 2);
            }
        }
        ctx.lineCap = "butt";
    }

    function tekenWolkenschaduw(b, h, tijd) {
        // SNELHEID VOEL JE ALLEEN TEGEN IETS. In een bovenaanzicht is er geen
        // horizon om langs te schuiven, dus neemt deze laag die rol over:
        // wolkenschaduwen die op een ANDERE snelheid dan de camera meelopen.
        // Dat parallax-verschil lees je als vaart. Op leeg water lijkt volle
        // kracht op stilliggen, en dat was precies de klacht.
        const eigen = 0.55; // trager dan de camera, dus ze blijven achter
        const g = 420;

        // MODULO HET ROOSTERHOK, EN DAT IS EEN REPARATIE.
        //
        // Hier stond `ox = camera.x * (1 - eigen) + drift` met een drift die
        // gewoon `tijd * 0.006` was, en de lus liep van `(camera.x - ox) / g`
        // tot `camera.x + b + g`. Die twee lopen UIT ELKAAR: de ondergrens
        // zakt mee met de drift, de bovengrens niet. Hoe langer je speelde en
        // hoe verder je van de oorsprong voer, hoe meer wolken er per frame
        // werden getekend - na tien minuten was dat een veelvoud van het begin.
        //
        // Niemand ziet dat gebeuren, want het is een geleidelijke vertraging
        // zonder foutmelding, en op een desktop val je er nooit doorheen. Op
        // een telefoon wel.
        //
        // Het rooster is oneindig en herhaalt zich elke `g`, dus alleen de REST
        // doet ertoe. Zo blijft het aantal wolken per frame constant, wat de
        // camerastand of de speelduur ook is.
        const drift = minderBeweging ? 0 : (tijd * 0.006) % g;
        const ox = (((camera.x * (1 - eigen) + drift) % g) + g) % g;
        const oy = (((camera.y * (1 - eigen)) % g) + g) % g;
        const x0 = Math.floor(camera.x / g) * g;
        const y0 = Math.floor(camera.y / g) * g;
        ctx.fillStyle = "rgba(6, 16, 34, .17)";
        for (let y = y0 - g; y < camera.y + h + g; y += g) {
            for (let x = x0 - g; x < camera.x + b + g; x += g) {
                const cx = x + ox + Math.sin(y * 0.01) * 90;
                const cy = y + oy + Math.cos(x * 0.008) * 60;
                ctx.beginPath();
                ctx.ellipse(cx, cy, 150, 84, 0.4, 0, TAU);
                ctx.fill();
            }
        }
    }

    function tekenKielzog() {
        // VIERDE VERSIE, EN DE EERSTE DRIE FAALDEN OP DEZELFDE MANIER.
        //
        // 1. Twee streepjes per punt        -> las als een ritssluiting.
        // 2. Eén gevuld vlak met een kernlijn -> las als een grijze sigaar met
        //                                       een kralensnoer erdoor.
        // 3. Ribbels tussen twee randlijnen -> las als een rups, of eerlijker:
        //                                      als een visgraat.
        //
        // Drie keer een ander recept en drie keer dezelfde klacht, dus het
        // recept was niet het probleem. Wat ze deelden is dat het VERBONDEN
        // vorm was: een omtrek, een vlak, of sporten tussen twee lijnen. Alles
        // wat aan elkaar vastzit leest als een voorwerp dat achter de boot aan
        // sleept, hoe zwak je het ook maakt.
        //
        // Schuim is geen vorm. Het zijn losse plukken die toevallig in een V
        // liggen. Dus: alleen korte, LOSSE streepjes, nergens iets dat sluit of
        // doorloopt. Dat kan niet als voorwerp lezen, want er is geen omtrek.
        const punten = boot.kielzog;
        if (punten.length < 2) return;

        ctx.lineCap = "round";
        for (let i = 1; i < punten.length; i++) {
            const k = punten[i];
            const leven = klem(1 - k.leeftijd / 1.6, 0, 1);
            if (leven <= 0) continue;

            // De V loopt naar achteren UIT elkaar: ouder is verder weg is
            // breder. De kracht bepaalt hoe fel het schuim is, niet hoe breed -
            // dat scheelde vorige versie, toen een langzame start de staart tot
            // een punt liet knijpen.
            const spreiding = 4 + (1 - leven) * 19;
            const nx = -Math.sin(k.hoek), ny = Math.cos(k.hoek);
            const dx = Math.cos(k.hoek), dy = Math.sin(k.hoek);
            const alfa = leven * leven * 0.42 * k.kracht;

            for (const zijde of [-1, 1]) {
                const px = k.x + nx * spreiding * zijde;
                const py = k.y + ny * spreiding * zijde;
                ctx.strokeStyle = "rgba(232, 249, 255, " + alfa + ")";
                ctx.lineWidth = 1 + leven * 1.6;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px - dx * (5 + leven * 5), py - dy * (5 + leven * 5));
                ctx.stroke();
            }

            // Een pluk woelwater in het midden, alleen vlak achter de boot waar
            // de schroef staat. Om en om, zodat het niet als een lijn leest.
            if (i % 2 === 0 && leven > 0.55) {
                ctx.strokeStyle = "rgba(214, 242, 255, " + (alfa * 0.8) + ")";
                ctx.lineWidth = 1;
                const wiebel = ((i * 7) % 5) - 2;
                ctx.beginPath();
                ctx.moveTo(k.x + nx * wiebel, k.y + ny * wiebel);
                ctx.lineTo(k.x - dx * 4 + nx * wiebel, k.y - dy * 4 + ny * wiebel);
                ctx.stroke();
            }
        }
        ctx.lineCap = "butt";
    }

    function tekenDing(d, tijd) {
        const t = minderBeweging ? 0 : tijd * 0.001;
        if (d.soort === "boei") {
            // Dobbert. Een boei die stilstaat op bewegend water valt op als fout.
            const bob = Math.sin(t * 1.9 + d.x * 0.01) * 3;
            grondSchaduw(d.x, d.y + 8, 24, 22, 0.35);
            // Een KEGEL OP EEN BOL, en niet alleen een driehoek: met een vlakke
            // voet leest een boei als een pylon die op het water staat in
            // plaats van als iets dat erin drijft. De bol steekt half door de
            // waterlijn, precies zoals bij het echte ding.
            ctx.fillStyle = "#e8603f";
            ctx.beginPath();
            ctx.moveTo(d.x, d.y - 13 + bob);
            ctx.lineTo(d.x + 6, d.y + 2 + bob);
            ctx.lineTo(d.x - 6, d.y + 2 + bob);
            ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.arc(d.x, d.y + 2 + bob, 6.5, 0, TAU); ctx.fill();
            ctx.fillStyle = "rgba(255, 240, 232, .9)";
            ctx.fillRect(d.x - 5, d.y - 4 + bob, 10, 3);
            // De waterlijn: een streepje water over de onderkant van de bol.
            ctx.fillStyle = "rgba(11, 30, 52, .5)";
            ctx.fillRect(d.x - 7, d.y + 5 + bob, 14, 4);
            return;
        }
        if (d.soort === "rots") {
            ctx.fillStyle = "rgba(120, 190, 232, .18)";
            ctx.beginPath(); ctx.arc(d.x, d.y, d.r + 14, 0, TAU); ctx.fill();
            ctx.fillStyle = "#3d4a5e";
            ctx.beginPath();
            for (let i = 0; i < 7; i++) {
                const a = (i / 7) * TAU;
                const r = d.r * (0.72 + ((i * 37) % 11) / 26);
                const fx = d.x + Math.cos(a) * r, fy = d.y + Math.sin(a) * r;
                if (i) ctx.lineTo(fx, fy); else ctx.moveTo(fx, fy);
            }
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "rgba(190, 214, 238, .3)";
            ctx.beginPath();
            ctx.arc(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.35, 0, TAU);
            ctx.fill();
            return;
        }
        if (d.soort === "vuurtoren") {
            // De draaiende bundel is het enige dat je van ver ziet, en daarmee
            // een oriëntatiepunt: je weet waar je bent zonder kaart.
            const hoek = minderBeweging ? -0.9 : t * 0.7;
            if (!minderBeweging) {
                const bundel = ctx.createRadialGradient(d.x, d.y, 10, d.x, d.y, 300);
                bundel.addColorStop(0, "rgba(255, 236, 170, .34)");
                bundel.addColorStop(1, "rgba(255, 236, 170, 0)");
                ctx.fillStyle = bundel;
                ctx.beginPath();
                ctx.moveTo(d.x, d.y);
                ctx.arc(d.x, d.y, 300, hoek - 0.2, hoek + 0.2);
                ctx.closePath(); ctx.fill();
            }
            ctx.fillStyle = "#f2f5fa";
            ctx.beginPath();
            ctx.moveTo(d.x - 13, d.y + 30);
            ctx.lineTo(d.x - 8, d.y - 26);
            ctx.lineTo(d.x + 8, d.y - 26);
            ctx.lineTo(d.x + 13, d.y + 30);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#d4453a";
            ctx.fillRect(d.x - 11, d.y - 4, 22, 11);
            ctx.fillRect(d.x - 12.5, d.y + 18, 25, 9);
            ctx.fillStyle = "#ffe9a8";
            ctx.beginPath(); ctx.arc(d.x, d.y - 30, 6, 0, TAU); ctx.fill();
            ctx.fillStyle = "rgba(219, 231, 245, .8)";
            ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("Cape Light", d.x, d.y + 48);
            ctx.textAlign = "left";
        }
    }

    function tekenVogels(tijd) {
        // Meeuwen. Ze gaan over alles heen, dus ze horen als laatste op het doek
        // en niet tussen de wereld. Iets dat boven je langs vliegt is het
        // goedkoopste bewijs dat de wereld doorloopt buiten het scherm.
        const t = minderBeweging ? 0 : tijd * 0.001;
        ctx.strokeStyle = "rgba(232, 242, 252, .78)";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        for (const v of wereld.vogels) {
            const x = ((v.x + t * v.snelheid) % (WERELD.w + 400)) - 200;
            const klap = minderBeweging ? 0 : Math.sin(t * 6 + v.fase) * 5;
            ctx.beginPath();
            ctx.moveTo(x - 8, v.y + klap);
            ctx.quadraticCurveTo(x - 4, v.y - 3, x, v.y);
            ctx.quadraticCurveTo(x + 4, v.y - 3, x + 8, v.y + klap);
            ctx.stroke();
        }
        ctx.lineCap = "butt";
    }

    /**
     * DE SCHADUW VAN IETS DAT OP DE GROND STAAT.
     *
     * Eén functie voor alles wat ergens op staat, want er waren er drie en dat
     * is te zien. De struiken en Bucky kregen een platte ellips op hun voet -
     * dat werkt - maar het huisje kreeg een RECHTHOEK ZO GROOT ALS ZICHZELF,
     * inclusief het dak, verschoven naar rechtsonder. Een dak raakt de grond
     * niet, dus die schaduw lag achter het huis in plaats van eronder, en dan
     * zweeft het.
     *
     * Wat een voorwerp op de grond zet is niet de richting van de schaduw maar
     * WAAR HIJ VANDAAN KOMT: het contactvlak. Een schaduw hoort dus:
     *   - plat te zijn (breder dan hoog), want hij ligt op de grond;
     *   - te beginnen bij de VOET en niet bij het midden van het silhouet;
     *   - mee te schuiven in de lichtrichting, maar niet verder dan zijn hoogte.
     *
     * `voetX`/`voetY` is waar het voorwerp de grond raakt, `breedte` hoe breed
     * het daar is, en `hoogte` hoe hoog het uitsteekt - dat laatste bepaalt hoe
     * ver de schaduw wegvalt. Alles gebruikt dit nu: huisjes, struiken, Bucky,
     * boeien, meubels en de kisten onder water.
     */
    function grondSchaduw(voetX, voetY, breedte, hoogte, alfa = 0.4) {
        const ver = Math.min(1, hoogte / 60);
        ctx.fillStyle = `rgba(6, 16, 26, ${alfa})`;
        ctx.beginPath();
        ctx.ellipse(voetX + LICHT.SCHADUW_X * ver * 0.8,
                    voetY + LICHT.SCHADUW_Y * ver * 0.28,
                    breedte * 0.56, breedte * 0.2, 0, 0, TAU);
        ctx.fill();
    }

    // --- eilanden ----------------------------------------------------------
    //
    // LIVE GETEKEND, NA EEN OMWEG DIE IK NIET HAD MOETEN NEMEN.
    //
    // Mijn eerste opzet bakte elk eiland één keer op een eigen canvas en zette
    // dat daarna alleen nog maar neer. Dat klonk als de juiste zet, maar het
    // was een oplossing voor een probleem dat ik niet had gemeten - en het
    // bracht twee echte problemen mee:
    //
    //   - The Mainland (straal 900) wordt dan een doek van 4300 bij 4300, en
    //     dat is 18,5 megapixel. Een telefoon geeft daar geen canvas voor terug
    //     maar een LEEG canvas: geen fout, geen melding, alleen een eiland dat
    //     er als een grijze vlek uitziet. Precies wat er op de preview stond.
    //   - Begrens je het doek wel, dan wordt het grote land op een derde
    //     gebakken en drie keer opgeschaald, en dan is de kust zichtbaar wazig.
    //
    // Er is geen maat waarop allebei goed gaat, want een eiland van 2000
    // eenheden past niet scherp op een doek dat een telefoon aankan. Dus wordt
    // het weer live getekend, met twee dingen die het goedkoop houden:
    //
    //   1. De verlopen worden ÉÉN keer gemaakt en bewaard. Een
    //      `createLinearGradient` per frame per eiland was het duurste deel.
    //   2. Alleen de kustsectoren die in beeld staan worden getekend. Van de
    //      96 sectoren zie je er hooguit een stuk of tien tegelijk.
    //
    // De framerate is daarna gemeten op een telefoonprofiel; zie de commit.
    const eilandVerlopen = new Map();

    function verloopVan(eiland) {
        let v = eilandVerlopen.get(eiland.id);
        if (v) return v;
        const LICHTHOEK = -Math.PI * 0.75;
        const lx = Math.cos(LICHTHOEK), ly = Math.sin(LICHTHOEK);
        const maak = (straal, van, tot) => {
            const g = ctx.createLinearGradient(
                eiland.x + lx * straal, eiland.y + ly * straal,
                eiland.x - lx * straal, eiland.y - ly * straal);
            g.addColorStop(0, van);
            g.addColorStop(1, tot);
            return g;
        };
        v = {
            talud: maak(eiland.r, "#5f9a6f", "#12281b"),
            graskant: maak(eiland.r, "rgba(122, 186, 140, .8)", "rgba(8, 22, 14, .55)"),
        };
        eilandVerlopen.set(eiland.id, v);
        return v;
    }

    /**
     * De omtrek van een eiland, ÉÉN KEER uitgerekend.
     *
     * De vorm van een eiland verandert nooit, maar hij werd wel elk frame
     * opnieuw uitgerekend: vijf paden van 128 punten, elk met een `straalOp`
     * die drie cosinussen optelt. Dat is ruim drieduizend keer `Math.cos` per
     * eiland per beeld, voor een antwoord dat altijd hetzelfde is.
     *
     * De tabel bevat de straal en de eenheidsrichting per hoek, want die
     * sinus en cosinus zijn precies zo constant. Het scheelt vrijwel alle
     * trigonometrie in de tekenlus.
     */
    const OMTREK_PUNTEN = 128;
    const omtrekTabellen = new Map();

    function omtrekTabel(eiland) {
        let t = omtrekTabellen.get(eiland.id);
        if (t) return t;
        const n = OMTREK_PUNTEN;
        t = { r: new Float64Array(n + 1), cx: new Float64Array(n + 1),
              sy: new Float64Array(n + 1) };
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * TAU;
            t.r[i] = straalOp(eiland, a);
            t.cx[i] = Math.cos(a);
            t.sy[i] = Math.sin(a);
        }
        omtrekTabellen.set(eiland.id, t);
        return t;
    }

    /**
     * Een RING langs de omtrek, tussen twee opslagen op de straal.
     *
     * DIT IS DEZELFDE LES ALS BIJ DE KUSTBANDEN, en ik had hem maar half
     * toegepast. De banden werden taartpunten vanaf het middelpunt; die zijn
     * ringstukken geworden. Maar het ondiepe water, het talud en de schaduw
     * bleven VOLLE SCHIJVEN, en die overtekenen elkaar precies zo: van een
     * eiland met straal 900 zie je alleen de buitenste vijftig eenheden, en
     * daar lagen vier schijven van 900 overheen.
     *
     * Buitenrand heen, binnenrand terug. Het gat in het midden wordt nooit
     * aangeraakt.
     */
    function ringPad(eiland, binnen, buiten) {
        const t = omtrekTabel(eiland);
        const n = OMTREK_PUNTEN;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const r = t.r[i] + buiten;
            const x = eiland.x + t.cx[i] * r, y = eiland.y + t.sy[i] * r;
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        for (let i = n; i >= 0; i--) {
            const r = t.r[i] + binnen;
            ctx.lineTo(eiland.x + t.cx[i] * r, eiland.y + t.sy[i] * r);
        }
        ctx.closePath();
    }

    /** Een pad langs de omtrek, met een opslag `extra` op de straal. */
    function omtrekPad(eiland, extra) {
        const t = omtrekTabel(eiland);
        const n = OMTREK_PUNTEN;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const r = t.r[i] + extra;
            const x = eiland.x + t.cx[i] * r;
            const y = eiland.y + t.sy[i] * r;
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.closePath();
    }

    const KUSTKLEUR = {
        nat: { strand: KLEUR.strandNat, rots: "#4a5563", klif: "#3c4450" },
        droog: { strand: KLEUR.strand, rots: "#5d6b7a", klif: "#4d5766" },
    };

    function tekenEiland(eiland, zb, zh) {
        const v = verloopVan(eiland);

        // 1. Slagschaduw op het water: een verschoven RING, zonder blur.
        //    Een `filter: blur()` per frame is een van de duurste dingen die
        //    canvas kent, en op deze schaal zie je het verschil niet.
        ctx.save();
        ctx.translate(LICHT.SCHADUW_X, LICHT.SCHADUW_Y);
        ringPad(eiland, 10, 24);
        ctx.fillStyle = "rgba(2, 10, 22, .34)";
        ctx.fill();
        ctx.restore();

        // 2. Ondiep water rond de kust: alleen de ring die je ziet. De banden
        //    hieronder beginnen op +30, dus daaronder valt niets te tekenen.
        ringPad(eiland, 28, 52);
        ctx.fillStyle = KLEUR.ondiep;
        ctx.fill();

        // 3. DE KUSTSOORTEN, als taartpunten - maar alleen die in beeld staan.
        //    Dit is wat het eiland een PLEK maakt in plaats van een vorm:
        //    strand, rots en klif zien er anders uit, en welke je krijgt hangt
        //    af van waar je aan land komt.
        const SECTOREN = 96;
        // Welke hoeken zijn zichtbaar? De hoek van elk hoekpunt van het beeld
        // ten opzichte van het eiland, plus alles ertussen. Staat het eiland
        // gedeeltelijk om het beeld heen, dan is dat alles.
        const hoeken = [];
        for (const [hx, hy] of [[camera.x, camera.y], [camera.x + zb, camera.y],
                                [camera.x, camera.y + zh], [camera.x + zb, camera.y + zh]]) {
            hoeken.push(Math.atan2(hy - eiland.y, hx - eiland.x));
        }
        const middenIn = eiland.x > camera.x && eiland.x < camera.x + zb
                      && eiland.y > camera.y && eiland.y < camera.y + zh;

        for (let i = 0; i < SECTOREN; i++) {
            const a0 = (i / SECTOREN) * TAU;
            const a1 = ((i + 1.4) / SECTOREN) * TAU;
            const mid = (a0 + a1) / 2;
            if (!middenIn && !hoekInBeeld(eiland, mid, hoeken)) continue;
            const soort = kustSoort(eiland, mid);
            // RINGSTUKKEN, GEEN TAARTPUNTEN. Hier liep een driehoek van het
            // MIDDELPUNT naar de kust, en dat is voor een eiland van straal 900
            // een enorm vlak - 96 sectoren maal twee banden is dus twee keer de
            // hele schijf overtekenen, terwijl je er alleen de buitenste dertig
            // eenheden van ziet: het gras en het talud gaan er meteen weer
            // overheen. Gemeten kostte het eiland daardoor 45% van de
            // framerate op een telefoonprofiel.
            //
            // Alleen de ring tekenen die zichtbaar is, scheelt vrijwel al dat
            // vlak. Buitenrand heen, binnenrand terug.
            for (const [binnen, buiten, tabel] of [
                [15, 30, KUSTKLEUR.nat], [0, 15, KUSTKLEUR.droog],
            ]) {
                ctx.fillStyle = tabel[soort] || tabel.strand;
                ctx.beginPath();
                for (let t = 0; t <= 5; t++) {
                    const a = a0 + (a1 - a0) * (t / 5);
                    const r = straalOp(eiland, a) + buiten;
                    const x = eiland.x + Math.cos(a) * r, y = eiland.y + Math.sin(a) * r;
                    if (t) ctx.lineTo(x, y); else ctx.moveTo(x, y);
                }
                for (let t = 5; t >= 0; t--) {
                    const a = a0 + (a1 - a0) * (t / 5);
                    const r = straalOp(eiland, a) + binnen;
                    ctx.lineTo(eiland.x + Math.cos(a) * r, eiland.y + Math.sin(a) * r);
                }
                ctx.closePath(); ctx.fill();
            }
        }

        // 4. Het talud: een RING met een verloop langs de lichtas. Geen reeks
        //    streken - dat gaf eerder een kras of een streepjespatroon, want een
        //    helling is een oppervlak en geen stapel lijnen.
        ringPad(eiland, -21, 1);
        ctx.fillStyle = v.talud;
        ctx.fill();

        // 5. Het gras. Dit is de ENIGE laag die het binnenste nodig heeft, en
        //    zelfs die hoeft niet verder te reiken dan het beeld: knippen op de
        //    kustlijn en dan de zichtbare rechthoek vullen kost hetzelfde
        //    ongeacht hoe groot het eiland is. Op The Mainland scheelt dat een
        //    vulling van twee miljoen vierkante eenheden per frame.
        ctx.save();
        omtrekPad(eiland, -20);
        ctx.clip();
        ctx.fillStyle = KLEUR.land;
        ctx.fillRect(camera.x - 10, camera.y - 10, zb + 20, zh + 20);
        // De belichte graskant, binnen dezelfde knip zodat hij niet uitloopt.
        omtrekPad(eiland, -20);
        ctx.lineWidth = 16;
        ctx.strokeStyle = v.graskant;
        ctx.stroke();
        ctx.restore();

        // 6. Binnenmeren: water IN het land, met een oever eromheen.
        for (const meer of eiland.meren || []) {
            const mx = eiland.x + meer.dx, my = eiland.y + meer.dy;
            ctx.fillStyle = KLEUR.strand;
            ctx.beginPath(); ctx.arc(mx, my, meer.r + 14, 0, TAU); ctx.fill();
            ctx.fillStyle = KLEUR.ondiep;
            ctx.beginPath(); ctx.arc(mx, my, meer.r + 4, 0, TAU); ctx.fill();
            ctx.fillStyle = KLEUR.diep;
            ctx.beginPath(); ctx.arc(mx, my, meer.r - 6, 0, TAU); ctx.fill();
        }

        // 7. Struiken, alleen die in beeld staan.
        const struiken = Math.round(eiland.r / 22);
        for (let i = 0; i < struiken; i++) {
            const a = (i / struiken) * TAU + 0.4;
            const d = straalOp(eiland, a) * (0.22 + ((i * 29) % 15) / 26);
            const bx = eiland.x + Math.cos(a) * d;
            const by = eiland.y + Math.sin(a) * d;
            if (bx < camera.x - 40 || bx > camera.x + zb + 40
                || by < camera.y - 40 || by > camera.y + zh + 40) continue;
            let inMeer = false;
            for (const meer of eiland.meren || []) {
                if (Math.hypot(bx - (eiland.x + meer.dx), by - (eiland.y + meer.dy))
                    < meer.r + 24) inMeer = true;
            }
            if (inMeer) continue;
            const rr = 10 + ((i * 17) % 11);
            grondSchaduw(bx, by + rr * 0.55, rr * 2, rr * 1.6, 0.42);
            const bol = ctx.createRadialGradient(bx - rr * 0.35, by - rr * 0.4,
                                                 rr * 0.1, bx, by, rr);
            bol.addColorStop(0, "#4a8a5c");
            bol.addColorStop(1, "#1e4530");
            ctx.fillStyle = bol;
            ctx.beginPath(); ctx.arc(bx, by, rr, 0, TAU); ctx.fill();
        }

        // De naam, alleen als het middelpunt in de buurt van het beeld ligt -
        // anders zweeft er een label over open water waar geen eiland te zien is.
        if (Math.abs(eiland.x - (camera.x + zb / 2)) < zb * 0.9
            && Math.abs(eiland.y - (camera.y + zh / 2)) < zh * 0.9) {
            ctx.fillStyle = "rgba(233, 243, 252, .9)";
            ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(eiland.naam, eiland.x, eiland.y - eiland.r - 26);
            ctx.textAlign = "left";
        }
    }

    /** Ligt de kust op hoek `a` binnen het bereik dat het beeld beslaat? */
    function hoekInBeeld(eiland, a, hoeken) {
        for (const h of hoeken) {
            let d = a - h;
            while (d > Math.PI) d -= TAU;
            while (d < -Math.PI) d += TAU;
            if (Math.abs(d) < 1.1) return true;
        }
        return false;
    }

    /**
     * Een binnenruimte, altijd HELEMAAL in beeld.
     *
     * Buiten volgt de camera de speler, want de wereld is groter dan het
     * scherm. Binnen is dat juist verkeerd: een kamer past in één blik, en een
     * camera die dan meeschuift maakt hem onnodig verwarrend en kost op een
     * telefoon de helft van je overzicht. De schaal wordt dus uit de kamer
     * berekend in plaats van vastgezet, zodat elke kamer past - ook een pakhuis
     * dat groter is dan een hut.
     */
    function tekenBinnen(b, h, tijd) {
        const kamer = binnenIn.kamer;
        if (!kamer) return;

        // Ruimte vrijhouden voor de HUD boven en de bediening onder.
        const marge = 18;
        const bovenkant = 34;
        const bruikbaarB = b - marge * 2;
        const bruikbaarH = h - bovenkant - 96;
        const schaal = Math.min(bruikbaarB / kamer.breedte, bruikbaarH / kamer.hoogte);
        const ox = (b - kamer.breedte * schaal) / 2;
        const oy = bovenkant + (bruikbaarH - kamer.hoogte * schaal) / 2;

        // Buiten de kamer is donker, zodat de kamer een kamer is en geen vlak.
        ctx.fillStyle = "#05080f";
        ctx.fillRect(0, 0, b, h);

        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(schaal, schaal);

        const K = kamer;

        // 1. De muren: een rand om de vloer heen, met dikte.
        ctx.fillStyle = K.muur;
        ctx.beginPath();
        ctx.roundRect(-16, -16, K.breedte + 32, K.hoogte + 32, 8);
        ctx.fill();

        // 2. De vloer, met planken zodat er richting in zit.
        ctx.fillStyle = K.vloer;
        ctx.fillRect(0, 0, K.breedte, K.hoogte);
        ctx.strokeStyle = "rgba(0, 0, 0, .16)";
        ctx.lineWidth = 1.5;
        for (let y = 26; y < K.hoogte; y += 26) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(K.breedte, y); ctx.stroke();
        }

        // 3. Schaduw langs de muren, want licht komt door de deur en de ramen.
        //    Zonder dit is de vloer een egaal vlak en voelt de kamer plat.
        const rand = ctx.createLinearGradient(0, 0, 0, K.hoogte);
        rand.addColorStop(0, "rgba(0, 0, 0, .34)");
        rand.addColorStop(0.35, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = rand;
        ctx.fillRect(0, 0, K.breedte, K.hoogte);

        // 4. De deur, als opening in de muur.
        ctx.fillStyle = "#1b1509";
        ctx.fillRect(K.deur.x, K.deur.y, K.deur.w, K.deur.h + 16);
        ctx.fillStyle = "rgba(255, 226, 150, .28)";
        ctx.fillRect(K.deur.x + 3, K.deur.y - 26, K.deur.w - 6, 26);
        ctx.fillStyle = KLEUR.accent;
        ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("EXIT", K.deur.x + K.deur.w / 2, K.deur.y + 13);
        ctx.textAlign = "left";

        // 5. De meubels. Elk krijgt een schaduw en een lichte bovenkant, zodat
        //    ze op de vloer STAAN in plaats van erop geplakt te zijn - dezelfde
        //    afspraak over het licht als buiten.
        for (const m of K.meubels) tekenMeubel(m);

        // 6. Bucky.
        tekenBuckyOp(binnenIn.x, binnenIn.y);

        ctx.restore();
    }

    const MEUBELKLEUR = {
        bed: ["#7a5c3e", "#c9b48c"],
        kachel: ["#2f3338", "#4a5058"],
        tafel: ["#6b4a2f", "#8a6340"],
        kruk: ["#5a3f28", "#7a5636"],
        kast: ["#5f4227", "#7d5a35"],
        kist: ["#6b4a2f", "#8a6340"],
        rek: ["#4a4038", "#6a5c50"],
        vat: ["#3f4a52", "#5a6a74"],
        muurrest: ["#4a473f", "#66625a"],
        balk: ["#5a4b34", "#77664a"],
        puin: ["#4d4a44", "#6a665e"],
    };

    function tekenMeubel(m) {
        const [donker, licht] = MEUBELKLEUR[m.soort] || ["#5a4b34", "#77664a"];
        // Een kist die nog wat bevat krijgt een gloed. NOOIT ALLEEN KLEUR: er
        // staat OPEN bij zodra je ernaast staat, en de statusregel zegt het ook.
        const teOpenen = m.kist && !geopend.has(
            binnenIn.huis ? `${binnenIn.huis.soort}/${m.kist}` : "");
        const hoogte = 7;

        // Schaduw op de vloer, op de voet van het meubel. Een meubel is laag,
        // dus de schaduw valt maar een klein stukje weg - dat is precies wat
        // `grondSchaduw` met de hoogte doet.
        grondSchaduw(m.x + m.w / 2, m.y + m.h + 1, m.w * 1.1, hoogte * 2, 0.36);

        // De zijkant: hetzelfde vlak op grondhoogte. Wat eronder uitsteekt is
        // de hoogte - dezelfde truc als bij het dek van de steiger.
        ctx.fillStyle = donker;
        ctx.beginPath();
        ctx.roundRect(m.x, m.y, m.w, m.h + hoogte, 3);
        ctx.fill();

        // Het bovenvlak.
        ctx.fillStyle = licht;
        ctx.beginPath();
        ctx.roundRect(m.x, m.y - 2, m.w, m.h, 3);
        ctx.fill();

        if (teOpenen) {
            ctx.strokeStyle = "rgba(255, 214, 120, .85)";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.roundRect(m.x - 2, m.y - 4, m.w + 4, m.h + 4, 4);
            ctx.stroke();
            const bij = kistBijSpeler();
            if (bij && bij.meubel === m) {
                ctx.fillStyle = KLEUR.accent;
                ctx.font = "700 12px ui-sans-serif, system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("OPEN", m.x + m.w / 2, m.y - 10);
                ctx.textAlign = "left";
            }
        }

        // Een paar kenmerken per soort, zodat een kist geen tafel is.
        ctx.strokeStyle = "rgba(0, 0, 0, .3)";
        ctx.lineWidth = 1.5;
        if (m.soort === "bed") {
            ctx.fillStyle = "#e6e0d0";
            ctx.beginPath();
            ctx.roundRect(m.x + 5, m.y + 2, m.w - 10, m.h * 0.42, 3);
            ctx.fill();
        } else if (m.soort === "kist" || m.soort === "kast") {
            ctx.beginPath();
            ctx.moveTo(m.x, m.y + m.h / 2 - 2);
            ctx.lineTo(m.x + m.w, m.y + m.h / 2 - 2);
            ctx.stroke();
            ctx.fillStyle = "#c9a martial".slice(0, 7);
            ctx.fillStyle = "#c9a24a";
            ctx.fillRect(m.x + m.w / 2 - 4, m.y + m.h / 2 - 6, 8, 8);
        } else if (m.soort === "kachel") {
            ctx.fillStyle = "rgba(255, 150, 60, .85)";
            ctx.fillRect(m.x + m.w * 0.3, m.y + m.h * 0.4, m.w * 0.4, m.h * 0.4);
        } else if (m.soort === "rek") {
            for (let i = 1; i < 3; i++) {
                ctx.beginPath();
                ctx.moveTo(m.x + (m.w / 3) * i, m.y - 2);
                ctx.lineTo(m.x + (m.w / 3) * i, m.y + m.h - 2);
                ctx.stroke();
            }
        } else if (m.soort === "vat") {
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.arc(m.x + 20 + i * 40, m.y + m.h / 2 - 2, m.h * 0.42, 0, TAU);
                ctx.stroke();
            }
        }
    }

    /** Hoe dichtbij je moet zijn om te kunnen duiken. */
    const DUIK_BEREIK = 130;

    function tekenDuikplek(plek, tijd) {
        // DUIKPLEKKEN WAREN ONZICHTBAAR, EN DAT WAS EEN GAT.
        //
        // Ze werkten wel - varen, drukken, duiken - maar er stond niets op het
        // water. Een duikplek is dan een stukje zee dat er precies zo uitziet
        // als al het andere, en je vindt hem alleen door er toevallig overheen
        // te varen met de actieknop in je hand. De enige die ooit werd gevonden
        // was die bij het startpunt, en dat was omdat hij daar met opzet lag.
        //
        // Dit is wat een duikplek op het water ECHT verraadt: het water is er
        // rustiger en helderder, en er komen belletjes op. Geen ring, geen
        // pictogram - een plek in plaats van een knop.
        const t = minderBeweging ? 0 : tijd * 0.001;
        const R = DUIK_BEREIK;

        // Kalmer, lichter water. DRIE VLAKKE RINGEN en geen verloop.
        //
        // Een radiaal verloop zag er iets zachter uit, maar het is een
        // berekening PER PIXEL, en deze vlek is ruim tweehonderd schermpixels
        // breed. Gemeten kostte dat de helft van de framerate op open water:
        // van twintig naar zeven fps, en met het verloop bewaard nog altijd
        // maar negen. Drie cirkels met aflopende dekking kosten vrijwel niets
        // en zien er op deze maat hetzelfde uit - de randen lopen door de
        // doorzichtigheid heen toch in elkaar over.
        // Zeven ringen in plaats van drie: met drie zie je de randen als
        // stappen staan, met zeven lopen ze in elkaar over. Het kost zeven
        // cirkelvullingen, en dat is nog altijd bijna niets vergeleken met een
        // berekening per pixel.
        ctx.fillStyle = "rgba(120, 210, 255, .028)";
        for (let i = 7; i >= 1; i--) {
            ctx.beginPath();
            ctx.arc(plek.x, plek.y, R * (i / 7), 0, TAU);
            ctx.fill();
        }

        // Belletjes die opkomen. Vaste plaatsen uit de index, want een plek die
        // per ronde anders borrelt is geen herkenningspunt.
        if (!minderBeweging) {
            for (let i = 0; i < 7; i++) {
                const f = ((t * 0.5) + i * 0.143) % 1;
                const bx = plek.x + Math.sin(i * 2.4) * R * 0.45
                         + Math.sin(f * 5 + i) * 4;
                const by = plek.y + R * 0.45 - f * R * 0.9;
                ctx.fillStyle = `rgba(214, 240, 255, ${(1 - f) * 0.5})`;
                ctx.beginPath();
                ctx.arc(bx, by, 2.4 - f * 1.2, 0, TAU);
                ctx.fill();
            }
        }

        // En de naam zodra je erbij bent. NOOIT ALLEEN EEN BEELD: er staat een
        // woord bij, net als MOOR aan de steiger.
        if (staat.modus === "varen"
            && Math.hypot(boot.x - plek.x, boot.y - plek.y) < DUIK_BEREIK) {
            ctx.fillStyle = KLEUR.accent;
            ctx.font = "700 12px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("DIVE", plek.x, plek.y - R * 0.35);
            ctx.font = "600 10px ui-monospace, monospace";
            ctx.fillStyle = "rgba(219, 231, 245, .8)";
            ctx.fillText(plek.naam.toUpperCase(), plek.x, plek.y - R * 0.35 + 13);
            ctx.textAlign = "left";
        }
    }

    function tekenHuis(h, tijd) {
        const W = HUIS_MAAT.w, H = HUIS_MAAT.h;
        const x = h.x - W / 2, y = h.y - H / 2;

        // De schaduw ligt op de VOET van het huis, niet achter het silhouet.
        // Hier stond een rechthoek zo groot als het hele huisje, dak en al, en
        // daardoor hing hij erboven te zweven.
        grondSchaduw(h.x, y + H - 4, W * 1.06, H, 0.42);

        const stijl = {
            hut: { muur: "#8a6a45", dak: "#7a3a2c", dakLicht: "#a35442" },
            pakhuis: { muur: "#7a7f88", dak: "#4a5560", dakLicht: "#66727e" },
            ruine: { muur: "#6d6a60", dak: "#4a463d", dakLicht: "#5d584d" },
        }[h.soort] || { muur: "#8a6a45", dak: "#7a3a2c", dakLicht: "#a35442" };

        // De muur: het stuk dat je van opzij ziet, onderaan.
        ctx.fillStyle = stijl.muur;
        ctx.beginPath();
        ctx.roundRect(x, y + H * 0.42, W, H * 0.58, 4);
        ctx.fill();

        // Het dak, iets over de muur heen. Het licht komt van linksboven, dus
        // de linkerhelft is de lichte kant - net als bij het talud en de boot.
        ctx.fillStyle = stijl.dak;
        ctx.beginPath();
        ctx.moveTo(x - 5, y + H * 0.5);
        ctx.lineTo(x + W / 2, y - 4);
        ctx.lineTo(x + W + 5, y + H * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = stijl.dakLicht;
        ctx.beginPath();
        ctx.moveTo(x - 5, y + H * 0.5);
        ctx.lineTo(x + W / 2, y - 4);
        ctx.lineTo(x + W / 2, y + H * 0.5);
        ctx.closePath();
        ctx.fill();

        // De deur, aan de onderkant. Dit is niet decoratie: `dichtsteHuis`
        // kijkt of je eronder staat, dus wat je ziet is waar je moet zijn.
        ctx.fillStyle = "#3a2a1c";
        ctx.beginPath();
        ctx.roundRect(x + W / 2 - 10, y + H * 0.62, 20, H * 0.38, 2);
        ctx.fill();

        if (h.soort === "ruine") {
            // Een gat in het dak, zodat je van buiten al ziet dat het vervallen
            // is - anders is het verschil pas binnen te zien.
            ctx.fillStyle = "rgba(12, 14, 16, .8)";
            ctx.beginPath();
            ctx.ellipse(x + W * 0.62, y + H * 0.28, 11, 7, 0.3, 0, TAU);
            ctx.fill();
        } else {
            // Een raampje dat licht geeft; op een ruine brandt niets.
            ctx.fillStyle = "rgba(255, 226, 150, .85)";
            ctx.fillRect(x + W * 0.16, y + H * 0.56, 12, 10);
        }

        // ENTER staat erbij als je ervoor staat. Nooit alleen een vorm: er komt
        // een woord bij, net als bij MOOR aan de steiger.
        if (staat.modus === "aangemeerd" && dichtsteHuis() === h) {
            ctx.fillStyle = KLEUR.accent;
            ctx.font = "700 12px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("ENTER", h.x, y - 12);
            ctx.textAlign = "left";
        }
    }

    function tekenSteiger(m) {
        // De steiger loopt nu SCHUIN: van de kust naar buiten, in de richting
        // van zijn eigen hoek. Alles hieronder wordt in de assen van de steiger
        // getekend en daarna meegedraaid, zodat de code niet per steiger
        // opnieuw hoeft na te denken over welke kant het water op ligt.
        const hoek = Math.atan2(m.richting.y, m.richting.x);
        const L = m.lengte, B = m.breedte;
        const DIKTE = 7;

        ctx.save();
        ctx.translate(m.kust.x, m.kust.y);
        ctx.rotate(hoek);
        // Vanaf hier: +x is naar zee, y is dwars op de steiger.

        // 1. De slagschaduw van het hele dek op het water.
        ctx.save();
        ctx.rotate(-hoek);
        ctx.translate(LICHT.SCHADUW_X, LICHT.SCHADUW_Y);
        ctx.rotate(hoek);
        ctx.fillStyle = "rgba(3, 12, 24, .38)";
        ctx.beginPath();
        ctx.roundRect(0, -B / 2, L, B + DIKTE, 4);
        ctx.fill();
        ctx.restore();

        // 2. De palen. Alleen waar er water onder zit - een paal op het gras is
        //    een tafelpoot. Ze steken onder de plank uit, dus ze gaan eerst.
        const PAAL = 13;
        for (let d = 22; d < L - 10; d += 44) {
            const wx = m.kust.x + m.richting.x * d;
            const wy = m.kust.y + m.richting.y * d;
            if (landOnder(wx, wy, 0)) continue;
            for (const zijde of [-1, 1]) {
                const py = zijde * (B / 2 - 5);
                ctx.fillStyle = "rgba(3, 12, 24, .34)";
                ctx.beginPath();
                ctx.ellipse(d + 3, py + PAAL + 4, 8, 3.5, 0, 0, TAU);
                ctx.fill();
                ctx.fillStyle = KLEUR.steigerDonker;
                ctx.fillRect(d - 4.5, py, 9, PAAL);
                ctx.fillStyle = "#54371f";
                ctx.fillRect(d - 4.5, py, 3, PAAL);
            }
        }

        // 3. De zijkant van het dek, op grondhoogte.
        ctx.fillStyle = KLEUR.steigerDonker;
        ctx.beginPath();
        ctx.roundRect(0, -B / 2, L, B + DIKTE, 3);
        ctx.fill();

        // 4. Het dek, met losse planken in de LENGTE van de steiger.
        ctx.fillStyle = KLEUR.steiger;
        ctx.beginPath();
        ctx.roundRect(0, -B / 2 - 2, L, B, 3);
        ctx.fill();

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(0, -B / 2 - 2, L, B, 3);
        ctx.clip();
        const plankB = B / 4;
        for (let i = 0; i < 4; i++) {
            const py = -B / 2 - 2 + i * plankB;
            ctx.fillStyle = i % 2 ? "rgba(138, 99, 64, .38)" : "rgba(63, 42, 26, .22)";
            ctx.fillRect(0, py, L, plankB - 1.5);
            ctx.fillStyle = "rgba(30, 18, 10, .55)";
            ctx.fillRect(0, py + plankB - 1.5, L, 1.5);
        }
        ctx.fillStyle = "rgba(214, 180, 138, .5)";
        ctx.fillRect(0, -B / 2 - 2, L, 2);
        ctx.restore();

        ctx.strokeStyle = "rgba(30, 18, 10, .6)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(0, -B / 2 - 2, L, B, 3);
        ctx.stroke();

        // 5. Bolders langs de kant waar de boot ligt, zodat te zien is WAAR je
        //    aanlegt. Zonder dat is een ligplaats een onzichtbare afspraak.
        const kant = Math.sign(
            (m.ligplaats.x - m.kust.x) * m.dwars.x
            + (m.ligplaats.y - m.kust.y) * m.dwars.y) || 1;
        for (const d of [L * 0.45, L * 0.78]) {
            ctx.fillStyle = "#2b2119";
            ctx.beginPath();
            ctx.ellipse(d, kant * (B / 2 - 4), 4.5, 5.5, 0, 0, TAU);
            ctx.fill();
        }

        ctx.restore();

        // Aanlegmarkering: nooit alleen kleur, er staat ook een woord.
        //
        // Er staat nu al iets zodra je de AANLOOPZONE binnenvaart, en niet pas
        // als aanmeren mag. Anders is de eerste helft van de zone iets dat je
        // wel voelt maar nergens aan kunt zien, en dat is verwarrend in plaats
        // van behulpzaam. Dichtbij wordt het MOOR; daarbuiten alleen een pijl
        // die zegt: hier is het.
        if (staat.modus === "varen") {
            const d = afstandTot(m.ligplaats.x, m.ligplaats.y);
            if (d < 150) {
                ctx.fillStyle = KLEUR.accent;
                ctx.font = "700 13px ui-sans-serif, system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("MOOR", m.ligplaats.x, m.ligplaats.y - 26);
                ctx.textAlign = "left";
            } else if (d < AANLOOP_STRAAL) {
                const flauw = 1 - (d - 150) / (AANLOOP_STRAAL - 150);
                ctx.fillStyle = `rgba(82, 255, 243, ${0.2 + flauw * 0.5})`;
                ctx.beginPath();
                ctx.moveTo(m.ligplaats.x, m.ligplaats.y - 20);
                ctx.lineTo(m.ligplaats.x - 6, m.ligplaats.y - 30);
                ctx.lineTo(m.ligplaats.x + 6, m.ligplaats.y - 30);
                ctx.closePath();
                ctx.fill();
            }
        }
    }

    function tekenBoot(tijd) {
        // EEN BOOT, GEEN PIJL. De vorige tekening was een driehoek met een
        // vlekje erin, en dat leest als een cursor die toevallig op water ligt.
        // Wat een boot een boot maakt is niet detail maar ASYMMETRIE over de
        // lengte: een spitse boeg voorin, de grootste breedte iets achter het
        // midden, en een rechte spiegel achter. Een driehoek heeft dat niet,
        // en daarom kun je er niet aan zien welke kant voor is zodra hij
        // stilligt.
        //
        // Alles hieronder staat in bootcoördinaten: +x is naar VOREN, +y is
        // stuurboord. Boeg op 26, spiegel op -20, halve breedte 11.
        const t = minderBeweging ? 0 : tijd * 0.001;
        const vaart = Math.abs(boot.snelheid) / boot.maxSnelheid;

        ctx.save();
        ctx.translate(boot.x, boot.y);

        // Dobberen. Ook stilliggend, want een boot op water staat nooit stil -
        // en juist dat kleine beetje leven scheelt het meest.
        if (!minderBeweging) {
            const dobber = Math.sin(t * 2.2) * (1 - vaart * 0.6);
            ctx.translate(Math.cos(t * 1.7) * 0.8, dobber * 1.6);
        }

        // Schaduw op het water, VOOR het draaien zodat hij niet meekantelt.
        ctx.fillStyle = "rgba(6, 20, 40, .28)";
        ctx.beginPath();
        ctx.ellipse(2, 6, 25, 13, boot.hoek, 0, TAU);
        ctx.fill();

        ctx.rotate(boot.hoek);

        // DE SLAGZIJ. In een bovenaanzicht zie je overhellen niet als kantelen
        // maar als SMALLER WORDEN: de romp draait van je weg, dus de zichtbare
        // breedte loopt terug en het dek schuift naar de hoge kant. Een scale
        // op de dwarsas doet precies dat, en is bovendien het enige dat de
        // vorm niet vervormt.
        const helling = boot.helling;
        ctx.scale(1, 1 - Math.abs(helling) * 0.24);
        const dek = -helling * 2.6; // het dek wijkt naar de hoge zijde

        // De romp.
        ctx.beginPath();
        ctx.moveTo(26, 0);                            // boeg
        ctx.bezierCurveTo(20, -7, 8, -11, -4, -11);   // stuurboordboeg naar de kim
        ctx.lineTo(-18, -9);                          // naar de spiegel
        ctx.quadraticCurveTo(-21, 0, -18, 9);         // ronde spiegel
        ctx.lineTo(-4, 11);
        ctx.bezierCurveTo(8, 11, 20, 7, 26, 0);       // bakboord terug naar de boeg
        ctx.closePath();
        ctx.fillStyle = KLEUR.boot;
        ctx.fill();
        ctx.strokeStyle = "rgba(8, 18, 34, .55)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Het dek: dezelfde vorm, kleiner, en verschoven met de slagzij mee.
        ctx.save();
        ctx.translate(0, dek);
        ctx.beginPath();
        ctx.moveTo(20, 0);
        ctx.bezierCurveTo(15, -5, 6, -7.5, -3, -7.5);
        ctx.lineTo(-14, -6);
        ctx.quadraticCurveTo(-16, 0, -14, 6);
        ctx.lineTo(-3, 7.5);
        ctx.bezierCurveTo(6, 7.5, 15, 5, 20, 0);
        ctx.closePath();
        ctx.fillStyle = "#e6d4b4";  // hout, niet dezelfde kleur als de romp
        ctx.fill();

        // De stuurhut, achter het midden waar hij hoort.
        ctx.fillStyle = KLEUR.bootLicht;
        ctx.beginPath();
        ctx.roundRect(-11, -5, 13, 10, 2.5);
        ctx.fill();
        ctx.fillStyle = "rgba(24, 44, 72, .8)";
        ctx.fillRect(-8.5, -3.2, 3, 6.4);   // raam, aan de voorkant van de hut

        // DE BOEG MOET TE ZIEN ZIJN, ook als de boot stilligt en je hem van
        // opzij bekijkt. Een lichte punt op het voordek plus een streep die
        // naar voren wijst doen dat zonder tekst.
        ctx.fillStyle = "rgba(255, 252, 244, .92)";
        ctx.beginPath();
        ctx.moveTo(20, 0); ctx.lineTo(11, -4.5); ctx.lineTo(11, 4.5);
        ctx.closePath(); ctx.fill();
        ctx.restore();

        // HET TEKEN DAT JE IN DE AANLOOPZONE BENT.
        //
        // De zone hoort onzichtbaar te zijn maar wel voelbaar. Een cirkel op
        // het water tekenen zou hem juist zichtbaar maken, en dan ga je op die
        // rand mikken in plaats van gewoon te varen.
        //
        // Dit is wat een boot ECHT doet als hij vaart mindert: het water aan de
        // boeg gaat liggen en er komt een rimpeling langszij. Twee dunne
        // strepen naast de romp, die met de rem meegroeien. Je ziet niet WAAR
        // de zone ophoudt, je ziet dat de boot inhoudt - en dat is precies het
        // verschil dat gevraagd werd.
        if (boot.rem > 0.06 && !minderBeweging) {
            const kracht = Math.min(1, boot.rem * 1.3);
            ctx.strokeStyle = `rgba(198, 236, 255, ${kracht * 0.34})`;
            ctx.lineWidth = 1.4;
            ctx.lineCap = "round";
            for (const zijde of [-1, 1]) {
                for (let i = 0; i < 3; i++) {
                    const d = 6 - i * 9;
                    const uit = (13 + i * 3) * zijde;
                    const golf = Math.sin(t * 5 + i * 1.6 + zijde) * kracht * 1.6;
                    ctx.beginPath();
                    ctx.moveTo(d - 5, uit + golf);
                    ctx.lineTo(d + 5, uit + golf);
                    ctx.stroke();
                }
            }
            ctx.lineCap = "butt";
        }

        // Boeggolf: twee schuimstrepen die met de vaart meegroeien.
        if (vaart > 0.12) {
            ctx.strokeStyle = "rgba(238, 250, 255, " + (vaart * 0.75) + ")";
            ctx.lineWidth = 2;
            ctx.lineCap = "round";
            // KLEIN EN TEGEN DE ROMP AAN. Twee versies lang was dit een wijde
            // chevron: eerst boldde hij vooruit doordat het controlepunt vóór
            // beide eindpunten lag, en daarna liep hij tot 19 eenheden uit de
            // as terwijl de romp maar 11 breed is. Dat leest niet als water dat
            // van de boeg af krult maar als een beugel die om de boot heen
            // hangt - het ding was groter dan het schip.
            //
            // Een boeggolf hoort NET buiten de romp te blijven: van de boeg tot
            // ongeveer het midden, en een paar eenheden breder dan de kim.
            for (const zijde of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(24, 1.5 * zijde);
                ctx.quadraticCurveTo(17, (8 + vaart * 2) * zijde,
                                     7, (12 + vaart * 3) * zijde);
                ctx.stroke();
            }
            ctx.lineCap = "butt";
        }

        // De vlag hangt naar achteren en gaat verder liggen naarmate je harder
        // vaart. Dat is de goedkoopste snelheidsmeter die er is.
        ctx.strokeStyle = "rgba(226, 238, 252, .85)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-16, dek); ctx.lineTo(-16, dek - 12); ctx.stroke();
        ctx.fillStyle = KLEUR.accent;
        const wapper = minderBeweging ? 0 : Math.sin(t * 7) * 1.6 * (0.3 + vaart);
        ctx.beginPath();
        ctx.moveTo(-16, dek - 12);
        ctx.lineTo(-16 - 4 - vaart * 6, dek - 10 + wapper);
        ctx.lineTo(-16, dek - 7.5);
        ctx.closePath(); ctx.fill();

        ctx.restore();
    }

    function tekenBucky() {
        tekenBuckyOp(speler.x, speler.y);
    }

    function tekenBuckyOp(px, py) {
        // EEN BOL DIE LOOPT, en dat moet helemaal uit de BEWEGING komen - de
        // vorm blijft een rode bol. Drie dingen samen doen het:
        //
        //   1. Op-en-neer op de pas. Een lopend poppetje wipt; een bal die je
        //      over een tafel duwt niet. Dat verschil is bijna alles.
        //   2. Indrukken bij het starten en stoppen (`veer`). Een lichaam dat
        //      op gang komt zakt even door, en een dat stilvalt ook.
        //   3. De schaduw doet mee: hoe hoger hij wipt, hoe kleiner en lichter
        //      zijn schaduw. Zonder dat lijkt de wip een tekenfoutje in plaats
        //      van hoogte.
        //
        // Bij reduced motion staat de wip stil: dan is het weer een bol die
        // verplaatst, en dat is precies wat daar hoort te gebeuren.
        const r = 11;
        const loopt = speler.vaart > 0.05 && !minderBeweging;

        // De wip. `pas` telt op afgelegde afstand, dus staan-en-duwen wipt niet.
        const wip = loopt ? Math.abs(Math.sin(speler.pas)) : 0;
        const hoog = wip * 3.4 * Math.min(1, speler.vaart);

        // Indrukken: bij het starten en stoppen even platter en breder. Volume
        // blijft ongeveer gelijk, want dat is wat indrukken doet.
        const veer = minderBeweging ? 0 : Math.min(0.34, speler.veer);
        const knijp = veer * 0.5 + wip * 0.06 * Math.min(1, speler.vaart);
        const breed = 1 + knijp * 0.55;
        const plat = 1 - knijp * 0.55;

        const x = px, y = py - hoog;

        // 1. De schaduw blijft op de GROND liggen, ook als hij wipt - dat is
        //    wat de wip zichtbaar maakt als hoogte. Hij wordt kleiner en
        //    lichter naarmate hij hoger is.
        const schaduwBreed = (1 - wip * 0.22) * breed;
        grondSchaduw(px, py + r * 0.85, r * 2 * schaduwBreed, r * 1.6,
                     0.44 - wip * 0.14);

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(breed, plat);

        // 2. De bol. Het lichtpunt zit linksboven, dus het verloop begint daar
        //    en niet in het midden - dat is het verschil tussen een bal en een
        //    cirkel met een gloed.
        const bol = ctx.createRadialGradient(
            -r * 0.36, -r * 0.44, r * 0.12, 0, 0, r * 1.06);
        bol.addColorStop(0, "#ff8ea1");
        bol.addColorStop(0.45, KLEUR.bucky);
        bol.addColorStop(1, "#8e1f33");
        ctx.fillStyle = bol;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();

        // 3. Randlicht linksboven: een dunne sikkel net binnen de rand.
        ctx.save();
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.clip();
        ctx.strokeStyle = "rgba(255, 214, 224, .55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(1, 1, r - 1, Math.PI * 0.8, Math.PI * 1.75);
        ctx.stroke();
        ctx.restore();

        // 4. Een glansplekje, klein en hoog.
        ctx.fillStyle = "rgba(255, 250, 252, .75)";
        ctx.beginPath();
        ctx.ellipse(-r * 0.34, -r * 0.46, r * 0.22, r * 0.16, -0.6, 0, TAU);
        ctx.fill();

        // 5. De ogen kijken de kant op die hij loopt, en ze WIEGEN mee met de
        //    pas. Dat laatste is klein maar het is precies wat een bol een
        //    poppetje maakt: er zit iets in dat meebeweegt.
        const kijk = speler.kijk || 0;
        const ox = Math.cos(kijk) * 2.2, oy = Math.sin(kijk) * 2.2;
        const wieg = loopt ? Math.sin(speler.pas * 2) * 0.6 : 0;
        for (const zijde of [-1, 1]) {
            const ex = zijde * 3.4 + ox * 0.5 + wieg * 0.4;
            const ey = -1.6 + oy * 0.5;
            ctx.fillStyle = "#fff";
            ctx.beginPath(); ctx.arc(ex, ey, 2.4, 0, TAU); ctx.fill();
            ctx.fillStyle = "#1b1f2a";
            ctx.beginPath();
            ctx.arc(ex + ox * 0.6, ey + oy * 0.6, 1.2, 0, TAU);
            ctx.fill();
        }
        ctx.restore();
    }

    function tekenKompas(b, h) {
        // VERDWALEN OP LEEG WATER IS NIET LEUK, en met een wereld van 6400 bij
        // 4400 waarvan je 460 bij 330 ziet, is verdwalen de normale toestand.
        //
        // Een kaartje zou het ook oplossen, maar een kaart moet je LEZEN: hij
        // vraagt aandacht van het scherm terwijl je vaart, en op een telefoon
        // is er geen ruimte om hem naast het spel te leggen. Een naald die naar
        // de dichtstbijzijnde kust wijst geeft dezelfde informatie in één blik
        // en kost een hoek in beeld.
        //
        // De afstand staat er in cijfers bij, want een richting zonder afstand
        // laat je niet kiezen of je erheen vaart. En de naam van het land staat
        // erbij, want dan is het geen richting maar een bestemming.
        const doel = dichtstbijzijndeLand(boot.x, boot.y);
        if (!doel) return;

        const straal = 26;
        const cx = b - straal - 14;
        const cy = 30 + straal + 10;

        ctx.fillStyle = "rgba(4, 10, 22, .62)";
        ctx.beginPath(); ctx.arc(cx, cy, straal, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(130, 226, 255, .34)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // De naald. Als je AL op het land staat wijst hij nergens heen, dus
        // dan wordt het een stip: geen valse richting geven.
        if (doel.afstand < 10) {
            ctx.fillStyle = KLEUR.accent;
            ctx.beginPath(); ctx.arc(cx, cy, 5, 0, TAU); ctx.fill();
        } else {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(doel.richting);
            ctx.fillStyle = KLEUR.accent;
            ctx.beginPath();
            ctx.moveTo(straal - 7, 0);
            ctx.lineTo(-4, -6);
            ctx.lineTo(-1, 0);
            ctx.lineTo(-4, 6);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "rgba(219, 231, 245, .5)";
            ctx.beginPath();
            ctx.moveTo(-straal + 7, 0);
            ctx.lineTo(-4, -4);
            ctx.lineTo(-4, 4);
            ctx.closePath(); ctx.fill();
            ctx.restore();
        }

        ctx.fillStyle = "rgba(219, 231, 245, .92)";
        ctx.font = "700 10px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(doel.eiland.naam.toUpperCase().slice(0, 14), cx, cy + straal + 13);
        ctx.fillText(`${Math.max(0, Math.round(doel.afstand / 10))} m`,
                     cx, cy + straal + 24);
        ctx.textAlign = "left";
    }

    /**
     * De onderwaterwereld, van OPZIJ.
     *
     * Net als binnenshuis past de hele ruimte in beeld en volgt de camera niet
     * mee: je moet kunnen zien waar de oppervlakte is, want daar gaat de hele
     * duik over. Een camera die meeschuift zou dat juist wegnemen.
     */
    /**
     * HOEVEEL DIEPTE JE ONDER WATER IN BEELD HEBT.
     *
     * Hier paste eerst de HELE duikplek in beeld, met de schaal berekend uit
     * zijn maten. Voor een kamer van 900 bij 500 gaat dat nog; voor een kloof
     * van 1400 diep werd de schaal 0,33 en was alles een postzegel - "je ziet
     * te weinig", en terecht.
     *
     * Nu is er een vaste hoeveelheid wereld in beeld en volgt de camera je,
     * net als boven water. Zeshonderd eenheden hoogte is ongeveer twee kamers
     * plus de gang ertussen: genoeg om te zien waar je heen zwemt en waar je
     * vandaan kwam.
     *
     * DE VERHOUDING BLIJFT STAAND OP EEN TELEFOON, en dat is een keuze.
     * Varen is een spel van richting en dan wil je breedte; duiken is een spel
     * van DIEPTE. Elke eenheid naar beneden is een eenheid verder van de lucht,
     * en het enige dat je echt moet kunnen inschatten is de weg terug naar
     * boven. Breder maken zou meer grot laten zien en minder van die weg. Het
     * canvas wisselt bovendien niet van vorm als je duikt: een speelveld dat
     * onder je handen van maat verandert is op een telefoon oriëntatieverlies.
     */
    const DUIK_ZICHT_HOOGTE = 600;

    function tekenDuik(b, h, tijd) {
        const boven = 34;
        const zicht = h - boven;
        const schaal = zicht / DUIK_ZICHT_HOOGTE;
        const zb = b / schaal;
        const zh = zicht / schaal;

        // De camera volgt Bucky en klemt op de wereld, net als boven water.
        // Bovenaan mag hij iets voorbij de waterlijn, zodat je de lucht ziet.
        const cx = klem(duik.x - zb / 2, 0, Math.max(0, DIEPTE_WERELD.breedte - zb));
        const cy = klem(duik.y - zh / 2, -70,
                        Math.max(-70, DIEPTE_WERELD.diepte - zh));

        // 1. Alles is ROTS tot het tegendeel blijkt. Dat is de kern van het
        //    model: we beschrijven waar water is, dus alles daarbuiten is steen.
        ctx.fillStyle = "#1b2735";
        ctx.fillRect(0, 0, b, h);

        ctx.save();
        ctx.translate(0, boven);
        ctx.beginPath();
        ctx.rect(0, 0, b, zicht);
        ctx.clip();
        ctx.scale(schaal, schaal);
        ctx.translate(-cx, -cy);

        const inBeeld = (x, y, w, hh) =>
            x < cx + zb && x + w > cx && y < cy + zh && y + hh > cy;

        // 2. De lucht boven de waterlijn.
        if (cy < 0) {
            ctx.fillStyle = "#0d1f38";
            ctx.fillRect(cx - 10, cy - 10, zb + 20, -cy + 10);
        }

        // 3. Het water: elke kamer en elke gang, met een kleur die met de
        //    DIEPTE donkerder wordt. Zo zie je aan de tint hoe diep je zit,
        //    ook als de oppervlakte allang uit beeld is.
        const waterKleur = (y) => {
            const t = klem(y / DIEPTE_WERELD.diepte, 0, 1);
            const r = Math.round(29 - t * 23);
            const g = Math.round(95 - t * 73);
            const bl = Math.round(134 - t * 86);
            return `rgb(${r}, ${g}, ${bl})`;
        };

        const ruimtes = [];
        for (const k of KAMERS) {
            if (inBeeld(k.x, k.y, k.w, k.h)) ruimtes.push(k);
        }
        for (const d of alleGangDelen()) {
            if (inBeeld(d.x, d.y, d.w, d.h)) ruimtes.push(d);
        }

        for (const r of ruimtes) {
            ctx.fillStyle = waterKleur(r.y + r.h / 2);
            ctx.beginPath();
            ctx.roundRect(r.x, r.y, r.w, r.h, 14);
            ctx.fill();
        }

        // 4. Een randje licht langs de bovenkant van elke ruimte: dat is waar
        //    het licht van boven op de rots valt, en het maakt van vlakken een
        //    grot. Zelfde afspraak over het licht als overal: van linksboven.
        ctx.strokeStyle = "rgba(150, 200, 235, .16)";
        ctx.lineWidth = 3;
        for (const r of ruimtes) {
            ctx.beginPath();
            ctx.moveTo(r.x + 12, r.y + 1.5);
            ctx.lineTo(r.x + r.w - 12, r.y + 1.5);
            ctx.stroke();
        }

        // 5. De waterlijn, met golfjes. Hier haal je adem, dus hij moet opvallen.
        if (cy < 40) {
            ctx.strokeStyle = "rgba(220, 245, 255, .7)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            const golf = minderBeweging ? 0 : tijd * 0.003;
            for (let x = cx - 20; x <= cx + zb + 20; x += 22) {
                const y = Math.sin(x * 0.03 + golf) * 4;
                if (x === cx - 20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // 6. Lichtbundels van boven, GEKNIPT OP HET WATER.
        //
        // Zonder die knip liepen ze dwars over de rots heen, en dan is het geen
        // licht dat door water valt maar een streep over het beeld. Licht komt
        // alleen daar waar water is, en dat is precies de vorm die we hierboven
        // al hebben getekend.
        //
        // Dieper dan negenhonderd komt er niets meer door; daar is het donker,
        // en dat hoort ook zo.
        if (!minderBeweging && cy < 900) {
            ctx.save();
            ctx.beginPath();
            for (const r of ruimtes) ctx.rect(r.x, r.y, r.w, r.h);
            ctx.clip();
            const t = tijd * 0.0004;
            ctx.fillStyle = "rgba(150, 220, 255, .06)";
            for (let i = 0; i < 5; i++) {
                const x = cx + ((i * 397 + Math.sin(t + i) * 60) % zb);
                ctx.beginPath();
                ctx.moveTo(x, Math.max(0, cy));
                ctx.lineTo(x + 70, Math.max(0, cy));
                ctx.lineTo(x + 190, 900);
                ctx.lineTo(x + 60, 900);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        }

        // 7. De kisten. Een gloed zolang er nog iets in zit, en OPEN zodra je
        //    ernaast zwemt - nooit alleen een kleur.
        const bij = kistOnderWater();
        for (const k of DIEPTE_KISTEN) {
            const pos = kistPositie(k);
            if (!pos || !inBeeld(pos.x - 24, pos.y - 20, 48, 44)) continue;
            const leeg = geopend.has(`dive/${k.id}`);
            grondSchaduw(pos.x, pos.y + 15, 40, 28, 0.45);
            ctx.fillStyle = leeg ? "#4a3a28" : "#6b4a2f";
            ctx.beginPath(); ctx.roundRect(pos.x - 18, pos.y - 13, 36, 28, 4); ctx.fill();
            ctx.fillStyle = leeg ? "#5d4a34" : "#8a6340";
            ctx.beginPath(); ctx.roundRect(pos.x - 18, pos.y - 15, 36, 13, 4); ctx.fill();
            if (!leeg) {
                ctx.strokeStyle = "rgba(255, 214, 120, .85)";
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.roundRect(pos.x - 21, pos.y - 18, 42, 34, 5);
                ctx.stroke();
            }
            if (bij && bij.meubel === k && !leeg) {
                ctx.fillStyle = KLEUR.accent;
                ctx.font = "700 13px ui-sans-serif, system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("OPEN", pos.x, pos.y - 26);
                ctx.textAlign = "left";
            }
        }

        // 8. De naam van de kamer waar je in zit, groot en vaag op de achtergrond.
        //    Zo weet je waar je bent zonder een kaart te hoeven openen.
        for (const k of KAMERS) {
            if (!k.naam) continue;
            if (duik.x < k.x || duik.x > k.x + k.w
                || duik.y < k.y || duik.y > k.y + k.h) continue;
            ctx.fillStyle = "rgba(190, 225, 250, .13)";
            ctx.font = "700 34px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(k.naam, k.x + k.w / 2, k.y + 46);
            ctx.textAlign = "left";
        }

        // 9. Bucky, met luchtbelletjes zodat je ziet dat hij ademt - en dat hij
        //    dat onder water niet kan blijven doen.
        tekenBuckyOp(duik.x, duik.y);
        if (!minderBeweging && !aanDeOppervlakte(duik.y)) {
            const t = tijd * 0.002;
            ctx.fillStyle = "rgba(220, 245, 255, .5)";
            for (let i = 0; i < 3; i++) {
                const f = (t + i * 0.37) % 1;
                ctx.beginPath();
                ctx.arc(duik.x + duik.kijk * 6 + Math.sin(f * 6 + i) * 4,
                        duik.y - 12 - f * 60, 2.5 - f * 1.4, 0, TAU);
                ctx.fill();
            }
        }

        ctx.restore();
    }

    function tekenDiepte(b, h) {
        // HOE DIEP JE ZIT, IN CIJFERS.
        //
        // De camera volgt je nu, dus de oppervlakte is meestal niet in beeld -
        // en dan is "hoe ver moet ik terug" iets dat je niet kunt zien. Eén
        // getal linksboven lost dat op zonder een kaart.
        // RECHTSBOVEN, ONDER DE LUCHTMETER. Linksboven leek vrij, maar daar ligt
        // op de arcade de vastgezette spelerskaart overheen - dezelfde plek waar
        // het inventarispaneel eerder al achter verdween. De twee getallen die
        // een duik bepalen horen bovendien bij elkaar te staan: hoeveel lucht
        // heb ik nog, en hoe ver moet ik terug.
        const diep = Math.max(0, Math.round(duik.y / 10));
        const bx = b - 108 - 14;
        ctx.fillStyle = "rgba(4, 10, 22, .72)";
        ctx.beginPath(); ctx.roundRect(bx - 4, 76, 112, 20, 6); ctx.fill();
        ctx.fillStyle = "rgba(219, 231, 245, .92)";
        ctx.font = "700 11px ui-monospace, monospace";
        ctx.textAlign = "right";
        ctx.fillText(`DEPTH ${diep} m`, bx + 100, 90);
        ctx.textAlign = "left";
    }

    function tekenZuurstof(b, h) {
        // RECHTSBOVEN, en groot genoeg om in je ooghoek te zien. Dit is het
        // enige getal waar een duik om draait.
        const breedte = 108, hoogte = 14;
        const x = b - breedte - 14, y = 40;
        const deel = Math.max(0, duik.zuurstof / duik.voorraad);

        ctx.fillStyle = "rgba(4, 10, 22, .72)";
        ctx.beginPath(); ctx.roundRect(x - 4, y - 4, breedte + 8, hoogte + 8, 6); ctx.fill();
        ctx.fillStyle = "rgba(255, 255, 255, .12)";
        ctx.beginPath(); ctx.roundRect(x, y, breedte, hoogte, 4); ctx.fill();

        // NOOIT ALLEEN KLEUR: er staat AIR bij met de seconden, dus wie het
        // verschil tussen blauw en rood niet ziet leest het gewoon.
        ctx.fillStyle = deel > 0.3 ? "#52d6ff" : "#ff7a6b";
        ctx.beginPath();
        ctx.roundRect(x, y, Math.max(2, breedte * deel), hoogte, 4);
        ctx.fill();

        ctx.fillStyle = "#dbe7f5";
        ctx.font = "700 10px ui-monospace, monospace";
        ctx.textAlign = "right";
        ctx.fillText(`AIR ${Math.ceil(duik.zuurstof)}s`, x + breedte, y + hoogte + 14);
        ctx.textAlign = "left";

        if (deel <= 0.3) {
            ctx.fillStyle = "#ff7a6b";
            ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("SURFACE", b / 2, 54);
            ctx.textAlign = "left";
        }
    }

    function tekenInventory(b, h) {
        const sleutels = Object.keys(inventory).filter((k) => SPULLEN[k] && inventory[k]);

        const kolommen = 3;
        const vak = 46, gat = 8;
        const rijen = Math.max(1, Math.ceil(sleutels.length / kolommen));
        const paneelB = kolommen * vak + (kolommen + 1) * gat;
        const paneelH = rijen * vak + (rijen + 1) * gat + 26;
        // IN HET MIDDEN, want alle vier de hoeken zijn bezet.
        //
        // Linksboven leek vrij, maar daar ligt op de arcade de vastgezette
        // spelerskaart overheen - op de preview zag je van het paneel alleen
        // nog een randje. Rechtsboven is het kompas, linksonder de stick,
        // rechtsonder de knoppen. Het midden is wat overblijft, en dat is voor
        // een paneel dat je bewust opent ook de juiste plek: je kijkt ernaar,
        // je speelt er niet doorheen.
        const px = (b - paneelB) / 2;
        const py = Math.max(44, (h - paneelH) / 2 - 20);

        ctx.fillStyle = "rgba(6, 14, 28, .92)";
        ctx.beginPath();
        ctx.roundRect(px, py, paneelB, paneelH, 10);
        ctx.fill();
        ctx.strokeStyle = "rgba(130, 226, 255, .34)";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "rgba(219, 231, 245, .9)";
        ctx.font = "700 11px ui-monospace, monospace";
        ctx.fillText("FINDS", px + gat, py + 18);

        if (!sleutels.length) {
            ctx.fillStyle = "rgba(219, 231, 245, .55)";
            ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
            ctx.fillText("nothing yet", px + gat, py + 42);
            return;
        }

        sleutels.forEach((sleutel, i) => {
            const spul = SPULLEN[sleutel];
            const kx = px + gat + (i % kolommen) * (vak + gat);
            const ky = py + 26 + gat + Math.floor(i / kolommen) * (vak + gat);

            ctx.fillStyle = "rgba(255, 255, 255, .06)";
            ctx.beginPath(); ctx.roundRect(kx, ky, vak, vak, 6); ctx.fill();

            // Het voorwerp als bolletje met een schaduw: dezelfde afspraak over
            // het licht als in de rest van het spel, ook in een menu.
            ctx.fillStyle = "rgba(0, 0, 0, .35)";
            ctx.beginPath();
            ctx.ellipse(kx + vak / 2 + 2, ky + vak / 2 + 9, 11, 4, 0, 0, TAU);
            ctx.fill();
            const bol = ctx.createRadialGradient(
                kx + vak / 2 - 4, ky + vak / 2 - 5, 2,
                kx + vak / 2, ky + vak / 2, 13);
            bol.addColorStop(0, "#ffffff");
            bol.addColorStop(0.35, spul.kleur);
            bol.addColorStop(1, "rgba(0, 0, 0, .55)");
            ctx.fillStyle = bol;
            ctx.beginPath();
            ctx.arc(kx + vak / 2, ky + vak / 2 - 2, 12, 0, TAU);
            ctx.fill();

            if (inventory[sleutel] > 1) {
                ctx.fillStyle = "rgba(8, 16, 30, .9)";
                ctx.beginPath();
                ctx.roundRect(kx + vak - 20, ky + vak - 15, 18, 13, 4);
                ctx.fill();
                ctx.fillStyle = "#dbe7f5";
                ctx.font = "700 10px ui-monospace, monospace";
                ctx.textAlign = "center";
                ctx.fillText(`${inventory[sleutel]}`, kx + vak - 11, ky + vak - 5);
                ctx.textAlign = "left";
            }
        });
    }

    function tekenVondst(b, h) {
        // Wat je net gevonden hebt, een paar seconden groot in beeld. Zonder dit
        // is een kist openen een regel tekst die je mist terwijl je kijkt waar
        // je staat.
        // Niet naast het inventarispaneel: dat staat in het midden en deze
        // melding ook, en dan liggen ze over elkaar heen. Heb je de tas open,
        // dan zie je de vondst daar al staan.
        if (!laatsteVondst || inventoryOpen) return;
        const leeftijd = (performance.now() - laatsteVondst.tijd) / 1000;
        if (leeftijd > 2.8) { laatsteVondst = null; return; }
        const alfa = leeftijd < 2.2 ? 1 : (2.8 - leeftijd) / 0.6;

        const n = laatsteVondst.spullen.length;
        const breedte = n * 52 + 24;
        const x = (b - breedte) / 2, y = h * 0.18;

        ctx.globalAlpha = alfa;
        ctx.fillStyle = "rgba(6, 14, 28, .92)";
        ctx.beginPath(); ctx.roundRect(x, y, breedte, 74, 10); ctx.fill();
        ctx.strokeStyle = KLEUR.accent;
        ctx.lineWidth = 2;
        ctx.stroke();

        laatsteVondst.spullen.forEach((sleutel, i) => {
            const spul = SPULLEN[sleutel];
            const cx = x + 12 + 26 + i * 52;
            const bol = ctx.createRadialGradient(cx - 5, y + 24, 2, cx, y + 29, 15);
            bol.addColorStop(0, "#ffffff");
            bol.addColorStop(0.35, spul.kleur);
            bol.addColorStop(1, "rgba(0, 0, 0, .55)");
            ctx.fillStyle = bol;
            ctx.beginPath(); ctx.arc(cx, y + 29, 14, 0, TAU); ctx.fill();
        });
        ctx.fillStyle = "#dbe7f5";
        ctx.font = "700 11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText("FOUND", b / 2, y + 63);
        ctx.textAlign = "left";
        ctx.globalAlpha = 1;
    }

    function tekenHud(b, h) {
        ctx.fillStyle = "rgba(4, 8, 18, .62)";
        ctx.fillRect(0, 0, b, 30);
        ctx.fillStyle = KLEUR.hud;
        ctx.font = "600 12px ui-monospace, monospace";
        ctx.fillText(`DIST ${Math.round(staat.afstand / 10)} m`, 10, 20);
        ctx.fillText(`STREAK ${staat.streak}`, 130, 20);
        ctx.fillStyle = staat.schoon ? KLEUR.accent : "rgba(219, 231, 245, .5)";
        // Woord, geen kleurvlek: leesbaar zonder kleur te kunnen zien.
        ctx.fillText(staat.schoon ? "CLEAN" : "SCRAPED", 240, 20);

        if (staat.modus === "aangemeerd") {
            // BOVENIN EN NIET ONDERIN. Deze regel stond onderaan het beeld, en
            // daar ligt sinds de joystick de bediening. De tekst liep dwars
            // door de stick heen en was op een telefoon half door een duim
            // bedekt. Boven is de enige rand die vrij is.
            const tekst = "Ashore. Walk with the stick; the anchor takes you back aboard.";
            ctx.fillStyle = "rgba(4, 8, 18, .72)";
            ctx.fillRect(0, 30, b, 26);
            ctx.fillStyle = KLEUR.hud;
            ctx.font = "600 12px ui-monospace, monospace";
            ctx.fillText(tekst, 10, 47);
        }
    }

    function tekenOvergang(b, h) {
        ctx.fillStyle = `rgba(3, 6, 14, ${Math.min(1, staat.overgang)})`;
        ctx.fillRect(0, 0, b, h);
    }

    function tekenFocus(b, h) {
        // Zichtbare focus op het canvas zelf, zodat hij niet weg te stylen is.
        ctx.strokeStyle = KLEUR.accent;
        ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, b - 3, h - 3);
    }

    // --- de lus ------------------------------------------------------------
    function lus(tijd) {
        if (!draait) return;
        const dt = Math.min(0.05, (tijd - vorigeTijd) / 1000 || 0);
        vorigeTijd = tijd;

        if (staat.overgang > 0) {
            // Fade uit, wissel, fade in.
            staat.overgang += dt * 2.6 * (staat.overgangNa ? 1 : -1);
            if (staat.overgang >= 1 && staat.overgangNa) {
                staat.overgangNa();
                staat.overgangNa = null;
            }
            if (staat.overgang <= 0) staat.overgang = 0;
        } else {
            const m = MODI[staat.modus];
            if (m && m.stap) m.stap(dt);
            geluid.volg(Math.abs(boot.snelheid) / boot.maxSnelheid);
        }

        teken(tijd);
        rafId = requestAnimationFrame(lus);
    }

    // Bij reduced motion loopt er GEEN lus. De wereld beweegt alleen als de
    // speler iets doet, en dan precies een stap. Dat is een ander spel dan
    // "hetzelfde maar langzamer", en dat is de bedoeling.
    function stapEenKeer() {
        if (!draait) return;
        const m = MODI[staat.modus];
        if (m && m.stap) m.stap(0.16);
        teken(performance.now());
    }

    function opInvoerBijMinderBeweging(e) {
        if (!minderBeweging || !draait) return;
        if (TOETSEN[e.code]) stapEenKeer();
    }

    // --- publiek -----------------------------------------------------------
    canvas.tabIndex = 0;
    canvas.addEventListener("keydown", keydown);
    canvas.addEventListener("keydown", opInvoerBijMinderBeweging);
    canvas.addEventListener("keyup", keyup);
    canvas.addEventListener("blur", blur);
    canvas.addEventListener("focus", () => teken(performance.now()));
    canvas.addEventListener("pointerdown", () => canvas.focus());

    teken(0);

    return {
        start() {
            if (draait) return;
            draait = true;
            staat.afstand = 0;
            staat.streak = 0;
            staat.schoon = true;
            staat.modus = "varen";
            staat.aangemeerd = false;
            speler.aanBoord = true;
            boot.x = START.x; boot.y = START.y;
            boot.hoek = START.hoek; boot.snelheid = 0;
            meld("streak", 0);
            zeg(minderBeweging
                ? "Underway. Press a key to advance one step at a time."
                : "Underway. Steer with the arrows, throttle with up, anchor to moor.");
            if (minderBeweging) {
                teken(performance.now());
            } else {
                vorigeTijd = performance.now();
                rafId = requestAnimationFrame(lus);
            }
        },
        stop() {
            draait = false;
            if (rafId) cancelAnimationFrame(rafId);
            rafId = null;
            blur();
            // De motor mag niet doorlopen als het spel weg is. Zonder deze
            // regel blijft een gesloten venster brommen op een pagina die
            // verder stil is, en dat is een AudioContext die niemand meer
            // kan uitzetten.
            geluid.zet(false);
        },
        destroy() {
            this.stop();
            canvas.removeEventListener("keydown", keydown);
            canvas.removeEventListener("keydown", opInvoerBijMinderBeweging);
            canvas.removeEventListener("keyup", keyup);
            canvas.removeEventListener("blur", blur);
            if (bedieningen && bedieningen.parentElement) bedieningen.remove();
            geluid.stop();
        },
        isRunning() { return draait; },
        on(gebeurtenis, cb) {
            if (Object.prototype.hasOwnProperty.call(luisteraars, gebeurtenis)) {
                luisteraars[gebeurtenis].push(cb);
            }
        },
    };
}
