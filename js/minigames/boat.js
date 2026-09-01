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

const TAU = Math.PI * 2;

// De wereld is veel groter dan het scherm. Dit is fase 1's maat; hij mag groeien
// zonder dat er iets anders verandert, want de camera klemt op deze waarden.
const WERELD = { w: 3200, h: 2200 };

/**
 * Ligt (x, y) op de plank van steiger `s`?
 *
 * DIT STAAT HIER BUITEN DE CLOSURE OMDAT HET DE ENIGE REGEL IS DIE STIL FOUT
 * KON ZIJN. De kust is dicht op één plek na: de steiger. Zolang die opening
 * niet precies zo groot is als de plank die je ziet, kun je door het gras
 * varen zonder dat er iets misgaat dat je kunt aflezen - geen fout, geen
 * melding, alleen een boot die ergens ligt waar hij niet hoort.
 *
 * En zo was het ook: er stond `s.w` en `s.h` terwijl de steiger wordt getekend
 * vanaf `s.x - s.w / 2` over een breedte `s.w`. De opening was dus twee keer
 * zo breed en twee keer zo hoog als de plank. In de code ziet `s.w` er prima
 * uit; het viel alleen op een screenshot op.
 *
 * Als losse functie is de regel te controleren zonder browser, zonder spel en
 * zonder te hoeven sturen - en sturen bleek te grof om er een test op te
 * bouwen. Zie tests/test_boot_wereld.js.
 */
export function opSteiger(x, y, s) {
    return Math.abs(x - s.x) < s.w / 2 && Math.abs(y - s.y) < s.h / 2;
}

const KLEUR = {
    diep: "#071426",
    ondiep: "#0d2c47",
    golf: "rgba(130, 210, 255, .10)",
    land: "#1d3b2a",
    strand: "#3f5a3a",
    steiger: "#6b4a2f",
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
    // Landen zijn cirkels: goedkoop om te tekenen en goedkoop om op te botsen,
    // en genoeg vorm voor een eiland. Een latere fase mag hier polygonen van
    // maken zonder dat de rest het merkt, zolang `raaktLand` blijft kloppen.
    const wereld = {
        landen: [
            { x: 2100, y: 900, r: 260, naam: "Still Harbour" },
        ],
        // De steiger is waar je mag aanmeren. Hij hoort bij een eiland en steekt
        // het water in.
        steigers: [
            { x: 1840, y: 900, w: 180, h: 44, eiland: 0 },
        ],
        // IETS OM NAAR TE KIJKEN, EN GENOEG ERVAN.
        //
        // Eerst stonden hier zeven dingen op een wereld van 3200 bij 2200. Met
        // de camera op zoom 1.75 zie je daar ongeveer 460 bij 330 van, oftewel
        // een zevende deel in de breedte - dus zeven dingen betekent dat er
        // gemiddeld nul in beeld staan. Op de preview was het dan ook leeg
        // water, en op leeg water voel je geen vaart en zie je geen richting.
        //
        // Daarom een ROOSTER met verspringing in plaats van een handjevol
        // losse punten: overal waar je vaart staat er iets binnen een halve
        // schermbreedte. De verspringing komt uit de index en niet uit
        // Math.random, zodat de wereld er elke ronde hetzelfde uitziet - een
        // zeekaart die per sessie verandert is geen zeekaart.
        //
        // Dit zijn ankers voor het oog, geen obstakels: je vaart er dwars
        // doorheen. Ze staan met een `soort` in dezelfde lijst waar fase 4
        // (schatkisten) in komt, en de tekenlus negeert wat hij niet kent.
        dingen: (() => {
            const uit = [{ soort: "vuurtoren", x: 2380, y: 640 }];
            const eiland = { x: 2100, y: 900, r: 260 };
            let n = 0;
            for (let gy = 260; gy < 2100; gy += 300) {
                for (let gx = 260; gx < 3050; gx += 340) {
                    n++;
                    // Verspringing per rij, zodat het geen ruitjespapier wordt.
                    const x = gx + ((gy / 300) % 2 ? 150 : 0) + ((n * 53) % 90) - 45;
                    const y = gy + ((n * 37) % 70) - 35;
                    // Niets bovenop het eiland of de vuurtoren.
                    if (Math.hypot(x - eiland.x, y - eiland.y) < eiland.r + 90) continue;
                    if (Math.hypot(x - 2380, y - 640) < 150) continue;
                    // Ongeveer één op de vier is een rots, de rest een boei.
                    if (n % 4 === 0) {
                        uit.push({ soort: "rots", x, y, r: 22 + ((n * 17) % 16) });
                    } else {
                        uit.push({ soort: "boei", x, y });
                    }
                }
            }
            return uit;
        })(),
        // Vogels bewegen zelf; ze krijgen een eigen lijst omdat hun positie per
        // frame verandert en `dingen` juist stilstaat.
        vogels: Array.from({ length: 14 }, (_, i) => ({
            x: 200 + i * 230,
            y: 220 + ((i * 311) % 1800),
            snelheid: 22 + (i % 5) * 7,
            fase: i * 1.3,
        })),
    };

    const boot = {
        x: 1430, y: 900,
        hoek: 0,          // radialen, 0 = naar rechts
        snelheid: 0,
        maxSnelheid: 210, // eenheden per seconde
        draaiSnelheid: 2.1,
        // SLAGZIJ. Een boot die draait helt over, en dat is het verschil tussen
        // een pijl die roteert en iets dat vaart. Loopt achter op de stuurinvoer
        // aan zodat hij overhelt en weer terugkomt in plaats van te klikken.
        helling: 0,
        // Het kielzog: een spoor van punten achter de boot dat vervaagt.
        kielzog: [],
    };
    const KIELZOG_MAX = 26;
    // Vaste vergroting van de wereld. Zie de toelichting in `teken`.
    const ZOOM = 1.75;

    const camera = { x: 0, y: 0 };
    const speler = {
        aanBoord: true,
        x: 0, y: 0,       // alleen gebruikt als hij uitgestapt is
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
    const knoppen = { links: false, rechts: false, gas: false, actie: false };
    const TOETSEN = {
        ArrowLeft: "links", KeyA: "links",
        ArrowRight: "rechts", KeyD: "rechts",
        ArrowUp: "gas", KeyW: "gas",
        Space: "actie", Enter: "actie",
    };

    function opToets(e, aan) {
        const naam = TOETSEN[e.code];
        if (!naam) return;
        e.preventDefault();
        if (naam === "actie" && aan && !e.repeat) doeActie();
        knoppen[naam] = aan;
    }
    const keydown = (e) => opToets(e, true);
    const keyup = (e) => opToets(e, false);
    const blur = () => { for (const k in knoppen) knoppen[k] = false; };

    // De schermknoppen. Ze staan in de DOM naast het canvas en niet erin
    // getekend, want een getekende knop is niet focusbaar en niet voorleesbaar.
    const bedieningen = maakBediening();

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

    function maakBediening() {
        const balk = document.createElement("div");
        balk.className = "mg-touch";
        const maak = (naam, label, tekst) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "mg-touch-btn";
            b.textContent = tekst;
            b.setAttribute("aria-label", label);
            const aan = (e) => { e.preventDefault(); knoppen[naam] = true; };
            const uit = (e) => { e.preventDefault(); knoppen[naam] = false; };
            b.addEventListener("pointerdown", aan);
            b.addEventListener("pointerup", uit);
            b.addEventListener("pointerleave", uit);
            b.addEventListener("pointercancel", uit);
            // Toetsenbord: een druk op de knop is een losse actie, geen houden.
            b.addEventListener("click", (e) => {
                e.preventDefault();
                if (naam === "actie") doeActie();
            });
            balk.appendChild(b);
            return b;
        };
        maak("links", "Steer left", "â—€");
        maak("gas", "Throttle forward", "â–²");
        maak("rechts", "Steer right", "â–¶");
        maak("actie", "Moor or step aboard", "âš“");

        // De geluidsknop is geen stuurknop, dus hij gaat niet door `maak`: die
        // zet een knop ingedrukt zolang je hem vasthoudt, en dat is hier
        // precies verkeerd. Een schakelaar hoort `aria-pressed` te dragen, en
        // de tekst verandert mee zodat de stand niet alleen aan een pictogram
        // hangt - iemand die het icoon niet kan duiden leest gewoon SOUND OFF.
        const geluidKnop = document.createElement("button");
        geluidKnop.type = "button";
        geluidKnop.className = "mg-touch-btn mg-touch-toggle";
        geluidKnop.textContent = "â™ª OFF";
        geluidKnop.setAttribute("aria-pressed", "false");
        geluidKnop.setAttribute("aria-label", "Sound off. Activate to turn sound on.");
        geluidKnop.addEventListener("click", (e) => {
            e.preventDefault();
            const wil = !geluid.aan;
            const gelukt = geluid.zet(wil);
            const nu = gelukt && wil;
            geluidKnop.setAttribute("aria-pressed", nu ? "true" : "false");
            geluidKnop.textContent = nu ? "â™ª ON" : "â™ª OFF";
            geluidKnop.setAttribute("aria-label", nu
                ? "Sound on. Activate to turn sound off."
                : "Sound off. Activate to turn sound on.");
            zeg(nu ? "Sound on." : "Sound off.");
            if (!gelukt && wil) zeg("This browser blocked audio.");
        });
        balk.appendChild(geluidKnop);

        canvas.insertAdjacentElement("afterend", balk);
        return balk;
    }

    // --- de modi -----------------------------------------------------------
    // Elke modus is een klein object. Een fase erbij is hier een sleutel erbij.
    const MODI = {
        varen: {
            stap(dt) {
                const stuur = (knoppen.rechts ? 1 : 0) - (knoppen.links ? 1 : 0);
                if (stuur) boot.hoek += stuur * boot.draaiSnelheid * dt;

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
                const gas = knoppen.gas;
                const doel = gas ? boot.maxSnelheid : 0;
                const traagheid = gas ? 3.0 : 0.6;
                boot.snelheid += (doel - boot.snelheid) * Math.min(1, dt * traagheid);

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
                const s = dichtsteSteiger();
                speler.x = s.x - 30;
                speler.y = s.y;
                staat.streak += staat.schoon ? 1 : 0;
                meld("streak", staat.streak);
                zeg(staat.schoon
                    ? `Moored at ${wereld.landen[s.eiland].naam}. Clean run, streak ${staat.streak}.`
                    : `Moored at ${wereld.landen[s.eiland].naam}. Streak reset by the scrape.`);
                if (!staat.schoon) { staat.streak = 0; meld("streak", 0); }
            },
            stap() {
                // FASE 1 STOPT HIER. Rondlopen op het eiland is fase 2; nu kun
                // je alleen weer aan boord. De modus bestaat al zodat die fase
                // alleen zijn eigen `stap` hoeft in te vullen.
                boot.snelheid = 0;
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
        if (staat.modus === "varen") {
            const s = dichtsteSteiger();
            const dichtbij = s && afstandTot(s.x, s.y) < 140;
            const langzaam = Math.abs(boot.snelheid) < 95;
            if (!dichtbij) return zeg("Steer up to the jetty to moor.");
            if (!langzaam) return zeg("Too fast to moor. Ease off the throttle.");
            geluid.piep(660);
            overgang(() => zetModus("aangemeerd"));
        } else if (staat.modus === "aangemeerd") {
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

    function raaktLand(x, y, marge) {
        for (const l of wereld.landen) {
            if (Math.hypot(x - l.x, y - l.y) < l.r + marge) {
                // De steiger is een gat in de kust: daar mag je wel komen.
                //
                // HIER STOND s.w EN s.h EN DAT WAS TWEE KEER TE GROOT. De
                // steiger wordt getekend vanaf s.x - s.w / 2 over een breedte
                // s.w, dus zijn halve maat is s.w / 2 - maar het gat gebruikte
                // de HELE maat. Het gevolg was een opening in de kustlijn die
                // twee keer zo breed en twee keer zo hoog was als de plank die
                // je ziet: je kon er naast varen, dwars het groen op, en dan
                // lag je midden op het eiland. Zo kwam ik het ook tegen, op een
                // screenshot en niet in de code.
                for (const s of wereld.steigers) {
                    if (opSteiger(x, y, s)) return false;
                }
                return true;
            }
        }
        return false;
    }

    function dichtsteSteiger() {
        let beste = null, best = Infinity;
        for (const s of wereld.steigers) {
            const d = afstandTot(s.x, s.y);
            if (d < best) { best = d; beste = s; }
        }
        return beste;
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
        camera.x = klem(boot.x - zb / 2, 0, Math.max(0, WERELD.w - zb));
        camera.y = klem(boot.y - zh / 2, 0, Math.max(0, WERELD.h - zh));

        ctx.fillStyle = KLEUR.diep;
        ctx.fillRect(0, 0, b, h);

        ctx.save();
        ctx.scale(ZOOM, ZOOM);
        ctx.translate(-camera.x, -camera.y);

        tekenWater(zb, zh, tijd);
        tekenWolkenschaduw(zb, zh, tijd);
        tekenKielzog();
        for (const d of wereld.dingen) tekenDing(d, tijd);
        for (const l of wereld.landen) tekenEiland(l);
        for (const s of wereld.steigers) tekenSteiger(s);
        tekenBoot(tijd);
        if (!speler.aanBoord) tekenBucky();
        tekenVogels(tijd);

        ctx.restore();

        tekenHud(b, h);
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
        const drift = minderBeweging ? 0 : tijd * 0.006;
        const eigen = 0.55; // trager dan de camera, dus ze blijven achter
        const g = 420;
        const ox = camera.x * (1 - eigen) + drift;
        const x0 = Math.floor((camera.x - ox) / g) * g;
        const y0 = Math.floor(camera.y / g) * g;
        ctx.fillStyle = "rgba(6, 16, 34, .17)";
        for (let y = y0 - g; y < camera.y + h + g; y += g) {
            for (let x = x0 - g; x < camera.x + b + g; x += g) {
                const cx = x + ox + Math.sin(y * 0.01) * 90;
                const cy = y + Math.cos(x * 0.008) * 60;
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
            ctx.fillStyle = "rgba(10, 22, 40, .35)";
            ctx.beginPath(); ctx.ellipse(d.x, d.y + 8, 13, 5, 0, 0, TAU); ctx.fill();
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

    function tekenEiland(l) {
        ctx.fillStyle = KLEUR.ondiep;
        ctx.beginPath(); ctx.arc(l.x, l.y, l.r + 46, 0, TAU); ctx.fill();
        ctx.fillStyle = KLEUR.strand;
        ctx.beginPath(); ctx.arc(l.x, l.y, l.r + 12, 0, TAU); ctx.fill();
        ctx.fillStyle = KLEUR.land;
        ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, TAU); ctx.fill();

        ctx.fillStyle = "rgba(219, 231, 245, .82)";
        ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(l.naam, l.x, l.y - l.r - 22);
        ctx.textAlign = "left";
    }

    function tekenSteiger(s) {
        ctx.fillStyle = KLEUR.steiger;
        ctx.fillRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
        ctx.strokeStyle = KLEUR.steigerRand;
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);

        // Aanlegmarkering: nooit alleen kleur, er staat ook een woord.
        const dichtbij = afstandTot(s.x, s.y) < 140;
        if (dichtbij && staat.modus === "varen") {
            ctx.fillStyle = KLEUR.accent;
            ctx.font = "700 13px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("MOOR", s.x, s.y - 30);
            ctx.textAlign = "left";
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
        ctx.fillStyle = KLEUR.bucky;
        ctx.beginPath(); ctx.arc(speler.x, speler.y, 9, 0, TAU); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(speler.x - 3, speler.y - 2, 2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(speler.x + 3, speler.y - 2, 2, 0, TAU); ctx.fill();
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
            ctx.fillStyle = "rgba(4, 8, 18, .72)";
            ctx.fillRect(0, h - 30, b, 30);
            ctx.fillStyle = KLEUR.hud;
            ctx.fillText("Ashore. Press the anchor to get back aboard.", 10, h - 11);
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
            boot.x = 1430; boot.y = 900; boot.hoek = 0; boot.snelheid = 0;
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
