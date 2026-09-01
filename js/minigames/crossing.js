// crossing.js - "The Crossing": in sprongen het raster over naar de doellijn.
//
// DIT SPEL KEERT NIETS UIT. Geen netwerkverkeer, geen opslag van een saldo. Een
// browser kan zijn eigen score niet bewijzen: alles wat hier geteld wordt staat in
// het geheugen van deze tab en is met een console-regel te verzinnen. Het telt dus
// alleen voor de lol. Wie er ooit iets aan wil koppelen rekent de uitkomst
// serverkant opnieuw uit en vertrouwt dit bestand niet.
//
// DE TOETSEN HANGEN AAN HET CANVAS, NIET AAN WINDOW. Aan window zou dit spel de
// pijltjestoetsen van de hele pagina inpikken en het scrollen slopen, ook als de
// speler er niet in zit. Op het canvas werkt het alleen met focus, en dat is precies
// het moment waarop preventDefault te verdedigen is.

// Hex-waarden overgenomen uit site/css/tokens.css. Ze staan hier hard omdat een canvas
// geen CSS-variabelen leest en dit bestand ook zonder stylesheet moet kunnen tekenen.
const C = {
    bg: "#0b0f16", lane: "#151b28", laneAlt: "#1c2434", bank: "#26324a",
    line: "rgba(255,255,255,0.07)", hazard: "#8B1E3F", hazardEdge: "#c24f6f",
    player: "#eef1f6", goal: "#e0a53a", danger: "#d64f4f", muted: "#a7b0c2",
};

const MONO = "ui-monospace, Menlo, Consolas, monospace";
const COLS = 9;
const ROWS = 9;   // rij 0 is de doellijn, rij ROWS-1 de veilige berm

// Alleen deze toetsen krijgen preventDefault; de rest laat de pagina met rust.
const STEPS = {
    ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
};

export function createCrossing(canvas, options = {}) {
    const ctx = canvas.getContext("2d");
    const reduced = typeof options.reducedMotion === "boolean"
        ? options.reducedMotion
        : Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

    const handlers = { score: [], gameover: [] };
    const view = { w: 0, h: 0, cell: 0, ox: 0, oy: 0 };
    let lanes = [], player = { col: COLS >> 1, row: ROWS - 1 };
    let score = 0, running = false, over = false, focused = false, raf = 0, last = 0;

    const emit = (name, value) => handlers[name].forEach((fn) => fn(value));
    const say = (text) => { if (typeof options.onStatus === "function") options.onStatus(text); };
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const wrap = (x, lo, span) => lo + ((((x - lo) % span) + span) % span);

    // ---- Wereld ----

    // Alleen de oneven rijen krijgen verkeer. De even rijen ertussen zijn bermen waar
    // je kunt wachten; zonder die rustplekken moet je zeven banen in een keer goed
    // hebben en is de overkant met opzet spelen niet te halen. Gemeten met een bot die
    // alleen oversteekt als de cel voor hem vrij is: nul overtochten in honderden zetten.
    function buildLanes(level) {
        const rows = [];
        for (let row = 1; row < ROWS - 1; row += 2) {
            const dir = row % 4 === 1 ? 1 : -1;
            const len = Math.random() < 0.35 ? 2 : 1;
            // In stapmodus moet alles op hele cellen vallen, en moeten de gaten ruimer:
            // de banen schuiven een hele cel op bij elke zet, dus je landt altijd een cel
            // verder dan wat je zag. Met gat 2 staat er om de drie cellen een blok en is
            // er geen enkele zet die aantoonbaar veilig is; gemeten met een bot die de
            // cel ervoor controleert kwam die opstelling in dertig zetten nooit weg van
            // de startberm.
            const gap = reduced ? 3 + Math.floor(Math.random() * 2) : 2.4 + Math.random() * 1.6;
            const speed = Math.min(1 + level * 0.12 + Math.random(), 4.2);
            const blocks = [];
            for (let x = -len; x < COLS + len; x += len + gap) blocks.push(x);
            const span = blocks.length * (len + gap);
            const off = reduced ? Math.floor(Math.random() * span) : Math.random() * span;
            rows.push({ row, dir, len, speed, span, blocks: blocks.map((x) => wrap(x + off, -len, span)) });
        }
        return rows;
    }

    function shift(lane, cells) {
        for (let i = 0; i < lane.blocks.length; i++) {
            lane.blocks[i] = wrap(lane.blocks[i] + lane.dir * cells, -lane.len, lane.span);
        }
    }

    function isHit() {
        const lane = lanes.find((l) => l.row === player.row);
        // De marge is de inzet waarmee de blokken getekend worden. Zonder die marge is
        // een botsing mogelijk die er op het scherm geen botsing is.
        return !!lane && lane.blocks.some((x) => player.col + 1 > x + 0.14 && player.col < x + lane.len - 0.14);
    }

    function move(dc, dr) {
        if (!running || over) return;
        player.col = clamp(player.col + dc, 0, COLS - 1);
        player.row = clamp(player.row + dr, 0, ROWS - 1);
        // De zet van de speler IS de klok in stapmodus: zonder invoer beweegt er niets,
        // dus er hoeft geen frame-lus te lopen om dit speelbaar te houden.
        if (reduced) lanes.forEach((lane) => shift(lane, 1));
        if (isHit()) return gameOver();
        if (player.row === 0) crossed();
        render();
    }

    function crossed() {
        score += 1;
        player.row = ROWS - 1;
        lanes = buildLanes(score);
        emit("score", score);
        say(`Crossed. Score ${score}.`);
    }

    function gameOver() {
        over = true; running = false;
        cancelAnimationFrame(raf); raf = 0;
        render();
        say(`Run over. You were hit crossing the field. Final score ${score}. Press Space or Enter to play again.`);
        emit("gameover", { score });
    }

    function loop(now) {
        raf = requestAnimationFrame(loop);
        // Een tab die uit de achtergrond terugkomt levert een enorme delta op; die zou
        // de blokken dwars door de speler heen teleporteren.
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        lanes.forEach((lane) => shift(lane, lane.speed * dt));
        if (isHit()) return gameOver();
        render();
    }

    // ---- Tekenen ----

    function layout() {
        const w = Math.max(1, Math.round(canvas.clientWidth || 360));
        const h = Math.max(1, Math.round(canvas.clientHeight || 420));
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        view.w = w; view.h = h;
        view.cell = Math.min(w / COLS, h / ROWS);
        view.ox = (w - view.cell * COLS) / 2;
        view.oy = (h - view.cell * ROWS) / 2;
    }

    // Ronde hoeken als de browser ze kent, anders gewoon een rechthoek: de afronding
    // is versiering en mag geen reden zijn dat er niets getekend wordt.
    function boxPath(x, y, w, h, r) {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
        else ctx.rect(x, y, w, h);
    }

    function render() {
        const { w, h, cell, ox, oy } = view;
        ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);

        // Een berm is asfaltvrij en krijgt een stippellijn: veilig is te zien aan de
        // plek en aan het streepjespatroon, niet aan het kleurverschil alleen.
        for (let row = 0; row < ROWS; row++) {
            const traffic = row % 2 === 1;
            ctx.fillStyle = traffic ? C.lane : row === 0 ? C.laneAlt : C.bank;
            ctx.fillRect(ox, oy + row * cell, cell * COLS, cell);
            if (traffic || row === 0) continue;
            ctx.strokeStyle = C.muted; ctx.lineWidth = 1;
            ctx.setLineDash([cell * 0.18, cell * 0.18]);
            ctx.beginPath();
            ctx.moveTo(ox, oy + (row + 0.5) * cell); ctx.lineTo(ox + COLS * cell, oy + (row + 0.5) * cell);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath();
        for (let col = 0; col <= COLS; col++) { ctx.moveTo(ox + col * cell, oy); ctx.lineTo(ox + col * cell, oy + ROWS * cell); }
        for (let row = 0; row <= ROWS; row++) { ctx.moveTo(ox, oy + row * cell); ctx.lineTo(ox + COLS * cell, oy + row * cell); }
        ctx.stroke();

        drawGoal();
        drawHazards();
        drawPlayer();
        drawHud();
        if (!running) drawOverlay();
        if (focused) drawFocusRing();
    }

    // De doellijn is te herkennen aan de pijlpunten en aan het woord GOAL, niet aan de
    // kleur: wie geel niet van rood onderscheidt moet nog steeds zien waar hij heen moet.
    function drawGoal() {
        const { cell, ox, oy } = view;
        ctx.strokeStyle = C.goal; ctx.lineWidth = Math.max(2, cell * 0.08); ctx.beginPath();
        for (let col = 0; col < COLS; col++) {
            const cx = ox + (col + 0.5) * cell;
            ctx.moveTo(cx - cell * 0.22, oy + cell * 0.5);
            ctx.lineTo(cx, oy + cell * 0.26);
            ctx.lineTo(cx + cell * 0.22, oy + cell * 0.5);
        }
        ctx.stroke();
        ctx.fillStyle = C.goal; ctx.font = `${Math.max(9, cell * 0.26)}px ${MONO}`;
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText("GOAL", ox + (COLS * cell) / 2, oy + cell * 0.58);
    }

    function drawHazards() {
        const { cell, ox, oy } = view;
        ctx.save();
        ctx.beginPath(); ctx.rect(ox, oy, COLS * cell, ROWS * cell); ctx.clip();
        for (const lane of lanes) {
            const y = oy + lane.row * cell + cell * 0.16, hgt = cell * 0.68;
            for (const bx of lane.blocks) {
                const x = ox + (bx + 0.08) * cell, wid = lane.len * cell - cell * 0.16;
                // De rand doet het contrastwerk. Crimson op asfalt haalt maar 1.5:1, de
                // lichtere rand haalt 3.5:1, en dat is de grens die een vorm herkenbaar
                // moet maken zonder op kleur te leunen.
                ctx.fillStyle = C.hazard; ctx.strokeStyle = C.hazardEdge; ctx.lineWidth = Math.max(2, cell * 0.075);
                boxPath(x, y, wid, hgt, cell * 0.14); ctx.fill(); ctx.stroke();
                // De punt wijst de rijrichting aan. Dat is de enige manier waarop je op
                // een stilstaand beeld kunt zien welke kant het blok op komt.
                const cx = x + wid / 2, cy = y + hgt / 2, a = cell * 0.13;
                ctx.beginPath();
                ctx.moveTo(cx - a * lane.dir, cy - a);
                ctx.lineTo(cx + a * lane.dir, cy);
                ctx.lineTo(cx - a * lane.dir, cy + a);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    function drawPlayer() {
        const { cell, ox, oy } = view;
        const x = ox + player.col * cell, y = oy + player.row * cell, p = cell * 0.2;
        ctx.fillStyle = over ? C.muted : C.player;
        boxPath(x + p, y + p, cell - 2 * p, cell - 2 * p, cell * 0.16); ctx.fill();
        ctx.beginPath();   // neus naar boven: de vorm zegt welke kant vooruit is
        ctx.moveTo(x + cell * 0.5, y + p * 0.35);
        ctx.lineTo(x + cell * 0.68, y + p * 1.15);
        ctx.lineTo(x + cell * 0.32, y + p * 1.15);
        ctx.closePath(); ctx.fill();
        if (!over) return;
        ctx.strokeStyle = C.danger; ctx.lineWidth = Math.max(3, cell * 0.11); ctx.beginPath();
        ctx.moveTo(x + p, y + p); ctx.lineTo(x + cell - p, y + cell - p);
        ctx.moveTo(x + cell - p, y + p); ctx.lineTo(x + p, y + cell - p);
        ctx.stroke();
    }

    function drawHud() {
        const size = Math.max(11, Math.min(16, view.cell * 0.34)), label = `SCORE ${score}`;
        ctx.font = `${size}px ${MONO}`; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(11,15,22,0.78)";
        ctx.fillRect(6, 6, ctx.measureText(label).width + 18, size + 12);
        ctx.fillStyle = C.player; ctx.fillText(label, 15, 12);
    }

    function drawOverlay() {
        const { w, h } = view;
        ctx.fillStyle = "rgba(11,15,22,0.86)"; ctx.fillRect(0, 0, w, h);
        const lines = over
            ? ["RUN ENDED", `You were hit. Score ${score}.`, "Press Space or Enter to play again"]
            : ["THE CROSSING", "Press Space or Enter to start",
                reduced ? "Arrows or WASD to hop. The lanes move one step per hop."
                    : "Arrows or WASD to hop. Click to hop forward."];
        const size = Math.max(12, Math.min(22, w * 0.045));
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        lines.forEach((text, i) => {
            ctx.font = `${i === 0 ? size * 1.25 : size * 0.8}px ${MONO}`;
            ctx.fillStyle = i === 0 ? (over ? C.danger : C.goal) : i === 1 ? C.player : C.muted;
            ctx.fillText(text, w / 2, h / 2 + (i - 1) * size * 1.9);
        });
    }

    // Eigen focusring op het canvas: een pagina die outlines wegpoetst mag deze niet
    // kunnen wissen, en zonder ring is niet te zien waar de toetsen landen.
    function drawFocusRing() {
        ctx.strokeStyle = C.hazardEdge; ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, view.w - 3, view.h - 3);
        ctx.strokeStyle = C.bg; ctx.lineWidth = 1;
        ctx.strokeRect(3.5, 3.5, view.w - 7, view.h - 7);
    }

    // ---- Invoer en levenscyclus ----

    function onKey(e) {
        const step = STEPS[e.code], confirm = e.code === "Space" || e.code === "Enter";
        if (!step && !confirm) return;   // alleen onze eigen toetsen blokkeren
        e.preventDefault();
        if (e.repeat) return;            // een ingehouden toets mag niet doorratelen
        if (!running) { if (confirm) start(); return; }
        if (step) move(step[0], step[1]); else move(0, -1);
    }

    function onPointer() {
        canvas.focus();
        if (!running) start(); else move(0, -1);
    }

    const onFocus = () => { focused = true; render(); };
    const onBlur = () => { focused = false; render(); };
    const onResize = () => { layout(); render(); };

    function start() {
        score = 0; over = false; running = true;
        player = { col: COLS >> 1, row: ROWS - 1 };
        lanes = buildLanes(0);
        layout(); render();
        if (!reduced) { last = performance.now(); raf = requestAnimationFrame(loop); }
        say(reduced
            ? "Run started. The lanes move one step for every hop you make. Reach the top line."
            : "Run started. Hop with the arrow keys and reach the top line.");
    }

    function stop() {
        if (!running) return;
        running = false;
        cancelAnimationFrame(raf); raf = 0;
        render();
        say("Paused. Press Space or Enter to start a new run.");
    }

    canvas.setAttribute("tabindex", "0");
    canvas.addEventListener("keydown", onKey);
    canvas.addEventListener("pointerdown", onPointer);
    canvas.addEventListener("focus", onFocus);
    canvas.addEventListener("blur", onBlur);
    // ResizeObserver ziet de layout, window.resize ziet de verhuizing naar een scherm
    // met een andere devicePixelRatio. Voor scherpte zijn ze allebei nodig.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    ro?.observe(canvas);
    window.addEventListener("resize", onResize);
    layout();
    render();

    return {
        start,
        stop,
        destroy() {
            cancelAnimationFrame(raf); raf = 0; running = false;
            canvas.removeEventListener("keydown", onKey);
            canvas.removeEventListener("pointerdown", onPointer);
            canvas.removeEventListener("focus", onFocus);
            canvas.removeEventListener("blur", onBlur);
            window.removeEventListener("resize", onResize);
            ro?.disconnect();
            handlers.score.length = 0;
            handlers.gameover.length = 0;
        },
        isRunning: () => running,
        on(event, cb) {
            // Alleen eigen sleutels: "constructor" of "__proto__" mag hier niets raken.
            if (Object.prototype.hasOwnProperty.call(handlers, event) && typeof cb === "function") {
                handlers[event].push(cb);
            }
        },
    };
}
