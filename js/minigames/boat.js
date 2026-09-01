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
        // Fase 2 en verder vullen dit: huisjes, kisten, duikplekken. Wordt nu al
        // getekend zodat er straks niets aan de tekenlus hoeft te veranderen.
        dingen: [],
    };

    const boot = {
        x: 1430, y: 900,
        hoek: 0,          // radialen, 0 = naar rechts
        snelheid: 0,
        maxSnelheid: 210, // eenheden per seconde
        draaiSnelheid: 2.1,
    };

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
        maak("links", "Steer left", "◀");
        maak("gas", "Throttle forward", "▲");
        maak("rechts", "Steer right", "▶");
        maak("actie", "Moor or step aboard", "⚓");
        canvas.insertAdjacentElement("afterend", balk);
        return balk;
    }

    // --- de modi -----------------------------------------------------------
    // Elke modus is een klein object. Een fase erbij is hier een sleutel erbij.
    const MODI = {
        varen: {
            stap(dt) {
                if (knoppen.links) boot.hoek -= boot.draaiSnelheid * dt;
                if (knoppen.rechts) boot.hoek += boot.draaiSnelheid * dt;

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
            overgang(() => zetModus("aangemeerd"));
        } else if (staat.modus === "aangemeerd") {
            overgang(() => {
                staat.aangemeerd = false;
                speler.aanBoord = true;
                staat.schoon = true;
                zetModus("varen");
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
                for (const s of wereld.steigers) {
                    if (Math.abs(x - s.x) < s.w && Math.abs(y - s.y) < s.h) return false;
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

        // Camera volgt de boot en blijft binnen de wereld.
        camera.x = klem(boot.x - b / 2, 0, Math.max(0, WERELD.w - b));
        camera.y = klem(boot.y - h / 2, 0, Math.max(0, WERELD.h - h));

        ctx.fillStyle = KLEUR.diep;
        ctx.fillRect(0, 0, b, h);

        ctx.save();
        ctx.translate(-camera.x, -camera.y);

        tekenWater(b, h, tijd);
        for (const l of wereld.landen) tekenEiland(l);
        for (const s of wereld.steigers) tekenSteiger(s);
        tekenBoot();
        if (!speler.aanBoord) tekenBucky();

        ctx.restore();

        tekenHud(b, h);
        if (staat.overgang > 0) tekenOvergang(b, h);
        if (document.activeElement === canvas) tekenFocus(b, h);
    }

    function tekenWater(b, h, tijd) {
        // Golven als losse streepjes. Bij reduced motion staan ze stil: het
        // beeld blijft leesbaar, er beweegt alleen niets uit zichzelf.
        const t = minderBeweging ? 0 : tijd * 0.00035;
        const stap = 74;
        ctx.strokeStyle = KLEUR.golf;
        ctx.lineWidth = 2;
        const x0 = Math.floor(camera.x / stap) * stap;
        const y0 = Math.floor(camera.y / stap) * stap;
        for (let y = y0; y < camera.y + h + stap; y += stap) {
            for (let x = x0; x < camera.x + b + stap; x += stap) {
                const dy = Math.sin((x * 0.02) + t + y * 0.01) * 4;
                ctx.beginPath();
                ctx.moveTo(x, y + dy);
                ctx.lineTo(x + 26, y + dy);
                ctx.stroke();
            }
        }
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

    function tekenBoot() {
        if (!speler.aanBoord && staat.aangemeerd) {
            // De boot blijft liggen waar hij ligt.
        }
        ctx.save();
        ctx.translate(boot.x, boot.y);
        ctx.rotate(boot.hoek);
        ctx.fillStyle = KLEUR.boot;
        ctx.beginPath();
        ctx.moveTo(22, 0); ctx.lineTo(-14, -11);
        ctx.lineTo(-9, 0); ctx.lineTo(-14, 11);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = KLEUR.bootLicht;
        ctx.fillRect(-6, -4, 11, 8);
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
        },
        destroy() {
            this.stop();
            canvas.removeEventListener("keydown", keydown);
            canvas.removeEventListener("keydown", opInvoerBijMinderBeweging);
            canvas.removeEventListener("keyup", keyup);
            canvas.removeEventListener("blur", blur);
            if (bedieningen && bedieningen.parentElement) bedieningen.remove();
        },
        isRunning() { return draait; },
        on(gebeurtenis, cb) {
            if (Object.prototype.hasOwnProperty.call(luisteraars, gebeurtenis)) {
                luisteraars[gebeurtenis].push(cb);
            }
        },
    };
}
