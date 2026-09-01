// boat.js - "Downstream": een bootje op de rivier, stuur om de brokken heen.
//
// DIT SPEL KEERT NIETS UIT. Geen netwerkverkeer, geen saldo in de opslag. De
// afgelegde afstand staat in het geheugen van deze tab en is met een console-regel te
// verzinnen, dus hij telt alleen voor de lol. Wie er ooit iets aan wil koppelen rekent
// dat serverkant opnieuw uit en vertrouwt dit bestand niet.
//
// DE TOETSEN HANGEN AAN HET CANVAS, NIET AAN WINDOW. Aan window zou het bootje de
// pijltjestoetsen van de hele pagina afvangen en het scrollen slopen, ook als de speler
// er niet in zit. Op het canvas gebeurt dat alleen met focus, en dat is het enige
// moment waarop preventDefault te verdedigen is.

// Hex-waarden overgenomen uit site/css/tokens.css. Ze staan hier hard omdat een canvas
// geen CSS-variabelen leest en dit bestand ook zonder stylesheet moet kunnen tekenen.
const C = {
    water: "#0b0f16", waterDeep: "#141a26", bank: "#26324a", line: "rgba(255,255,255,0.07)",
    rock: "#8B1E3F", rockEdge: "#c24f6f", hull: "#eef1f6", deck: "#a3264d",
    accent: "#e0a53a", danger: "#d64f4f", muted: "#a7b0c2",
};

const MONO = "ui-monospace, Menlo, Consolas, monospace";
const BOAT_Y = 0.82;    // vaste plek van de boot; wereld-y loopt van 0 (boven) naar 1
const LANES = 5;        // alleen in stapmodus: de rivier wordt dan een raster
const ROW_STEP = 0.14;  // hoeveel de wereld per zet opschuift in stapmodus

// Alleen deze toetsen krijgen preventDefault; de rest laat de pagina met rust.
const LEFT = ["ArrowLeft", "KeyA"];
const RIGHT = ["ArrowRight", "KeyD"];
const CONFIRM = ["Space", "Enter"];

export function createBoat(canvas, options = {}) {
    const ctx = canvas.getContext("2d");
    const reduced = typeof options.reducedMotion === "boolean"
        ? options.reducedMotion
        : Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

    const handlers = { score: [], gameover: [] };
    const view = { w: 0, h: 0, bank: 0, water: 0 };
    const held = new Set();
    let obstacles = [], boatX = 0.5, boatV = 0, lane = LANES >> 1, steps = 0;
    let distance = 0, milestone = 0, speed = 0.32, spawnIn = 0.8, streak = 0;
    let running = false, over = false, focused = false, raf = 0, last = 0;

    const emit = (name, value) => handlers[name].forEach((fn) => fn(value));
    const say = (text) => { if (typeof options.onStatus === "function") options.onStatus(text); };
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

    // ---- Wereld ----

    function makeObstacle(x, w) {
        const kind = Math.random() < 0.5 ? "log" : "rock";
        return { x, w, kind, y: -0.15, h: kind === "log" ? 0.05 : 0.075 };
    }

    function spawnDrift() {
        // Ondergrens op de tussenpoos: gemeten met een bot die naar de dichtstbijzijnde
        // vrije baan stuurt liep een run op 0.5 s dood rond 280 meter, en dat is te kort
        // om er iets van te leren.
        spawnIn = Math.max(0.66, 1.15 - distance / 4000);
        const placed = [];
        const count = Math.random() < 0.18 ? 2 : 1;
        for (let i = 0; i < count; i++) {
            const x = 0.1 + Math.random() * 0.8;
            // Twee brokken naast elkaar mogen de rivier nooit dichtzetten; die opening
            // is het verschil tussen moeilijk en onspeelbaar.
            if (placed.some((p) => Math.abs(p - x) < 0.36)) continue;
            placed.push(x);
            obstacles.push(makeObstacle(x, 0.13 + Math.random() * 0.13));
        }
    }

    function spawnRow() {
        const blocked = Math.random() < 0.3 ? 2 : 1;   // hoeveel van de vijf banen dichtgaan
        const picked = [];
        while (picked.length < blocked) {
            const l = Math.floor(Math.random() * LANES);
            if (!picked.includes(l)) picked.push(l);
        }
        picked.forEach((l) => obstacles.push(makeObstacle((l + 0.5) / LANES, 0.8 / LANES)));
    }

    function collides() {
        const bw = 0.05, bh = 0.05;
        return obstacles.some((o) =>
            Math.abs(o.x - boatX) < o.w / 2 + bw && Math.abs(o.y - BOAT_Y) < o.h / 2 + bh);
    }

    // Een aria-live regel die bij elk frame praat is onbruikbaar. Vandaar een melding
    // per honderd meter en een score-event per tien; de teller zelf loopt gewoon door.
    function markProgress() {
        const reached = Math.floor(distance / 10) * 10;
        if (reached <= milestone) return;
        milestone = reached;
        emit("score", milestone);
        if (milestone % 100 === 0) say(`${milestone} metres downstream.`);
    }

    // De toetsaanslag IS de klok in stapmodus: zonder invoer beweegt er niets, dus er
    // hoeft geen frame-lus te lopen om dit speelbaar te houden.
    function step(dir) {
        lane = clamp(lane + dir, 0, LANES - 1);
        boatX = (lane + 0.5) / LANES;
        obstacles.forEach((o) => { o.y += ROW_STEP; });
        obstacles = obstacles.filter((o) => o.y < 1.2);
        if (steps % 2 === 0) spawnRow();   // anders staat de rivier van boven tot onder vol
        steps += 1;
        distance += 10;
        streak = (streak + ROW_STEP) % 0.12;
        if (collides()) return gameOver();
        markProgress();
        render();
    }

    function update(dt) {
        speed = Math.min(0.32 + distance / 9000, 0.85);
        const dir = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
        boatV = clamp(boatV + dir * 1.9 * dt - boatV * 2.6 * dt, -0.9, 0.9);
        boatX += boatV * dt;
        if (boatX < 0.06) { boatX = 0.06; boatV = 0; }
        if (boatX > 0.94) { boatX = 0.94; boatV = 0; }

        obstacles.forEach((o) => { o.y += speed * dt; });
        obstacles = obstacles.filter((o) => o.y < 1.2);
        spawnIn -= dt;
        if (spawnIn <= 0) spawnDrift();
        distance += speed * dt * 100;
        streak = (streak + speed * dt) % 0.12;
        markProgress();
        if (collides()) gameOver();
    }

    function loop(now) {
        raf = requestAnimationFrame(loop);
        // Een tab die uit de achtergrond terugkomt levert een enorme delta op; die zou
        // de brokken dwars door de boot heen teleporteren.
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        update(dt);
        if (running) render();
    }

    function gameOver() {
        over = true; running = false;
        cancelAnimationFrame(raf); raf = 0;
        render();
        say(`Run over. The boat struck an obstacle after ${Math.floor(distance)} metres. Press Space or Enter to try again.`);
        emit("gameover", { score: Math.floor(distance) });
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
        view.bank = Math.max(10, w * 0.07);
        view.water = w - view.bank * 2;
    }

    const px = (x) => view.bank + x * view.water;
    const py = (y) => y * view.h;

    function render() {
        const { w, h, bank } = view;
        ctx.fillStyle = C.waterDeep; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = C.water; ctx.fillRect(bank, 0, view.water, h);
        ctx.fillStyle = C.bank; ctx.fillRect(0, 0, bank, h); ctx.fillRect(w - bank, 0, bank, h);
        ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(bank, 0); ctx.lineTo(bank, h);
        ctx.moveTo(w - bank, 0); ctx.lineTo(w - bank, h);
        ctx.stroke();

        drawCurrent();
        ctx.save();   // brokken horen in het water, niet half op de oever
        ctx.beginPath(); ctx.rect(bank, 0, view.water, h); ctx.clip();
        obstacles.forEach(drawObstacle);
        ctx.restore();
        drawBoat();
        drawHud();
        if (!running) drawOverlay();
        if (focused) drawFocusRing();
    }

    // Streepjes in de stroom. In stapmodus verschuiven ze alleen als de speler een zet
    // doet, dus er staat nooit iets uit zichzelf te bewegen.
    function drawCurrent() {
        ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath();
        for (let col = 1; col < 4; col++) {
            const x = px(col / 4);
            for (let y = -0.12 + streak; y < 1.1; y += 0.12) {
                ctx.moveTo(x, py(y)); ctx.lineTo(x, py(y + 0.05));
            }
        }
        ctx.stroke();
    }

    // Balk of rots: allebei gevaar, maar de silhouetten verschillen zodat het herkennen
    // niet van de kleur af hoeft te hangen.
    function drawObstacle(o) {
        const cx = px(o.x), cy = py(o.y), ow = o.w * view.water, oh = o.h * view.h;
        ctx.fillStyle = C.rock; ctx.strokeStyle = C.rockEdge; ctx.lineWidth = 2;
        if (o.kind === "log") {
            // Ronde hoeken als de browser ze kent: de afronding is versiering en mag
            // geen reden zijn dat er niets getekend wordt.
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(cx - ow / 2, cy - oh / 2, ow, oh, Math.min(oh / 2, ow / 2));
            else ctx.rect(cx - ow / 2, cy - oh / 2, ow, oh);
            ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx - ow * 0.3, cy); ctx.lineTo(cx + ow * 0.3, cy); ctx.stroke();
            return;
        }
        ctx.beginPath();
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2, rad = i % 2 ? 0.34 : 0.5;
            const x = cx + Math.cos(a) * ow * rad, y = cy + Math.sin(a) * oh * rad * 2;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    function drawBoat() {
        const cx = px(boatX), cy = py(BOAT_Y);
        const bw = 0.05 * view.water, bh = 0.05 * view.h;
        ctx.fillStyle = over ? C.muted : C.hull;
        ctx.beginPath();
        ctx.moveTo(cx, cy - bh * 1.5);   // de boeg wijst stroomopwaarts
        ctx.lineTo(cx + bw, cy - bh * 0.2);
        ctx.lineTo(cx + bw * 0.75, cy + bh * 1.3);
        ctx.lineTo(cx - bw * 0.75, cy + bh * 1.3);
        ctx.lineTo(cx - bw, cy - bh * 0.2);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = C.deck;
        ctx.fillRect(cx - bw * 0.45, cy - bh * 0.1, bw * 0.9, bh * 0.8);
        if (!over) return;
        ctx.strokeStyle = C.danger; ctx.lineWidth = Math.max(3, bw * 0.35); ctx.beginPath();
        ctx.moveTo(cx - bw, cy - bh); ctx.lineTo(cx + bw, cy + bh);
        ctx.moveTo(cx + bw, cy - bh); ctx.lineTo(cx - bw, cy + bh);
        ctx.stroke();
    }

    function drawHud() {
        const size = Math.max(11, Math.min(16, view.w * 0.04));
        const label = `DIST ${Math.floor(distance)} M`;
        ctx.font = `${size}px ${MONO}`; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(11,15,22,0.78)";
        ctx.fillRect(6, 6, ctx.measureText(label).width + 18, size + 12);
        ctx.fillStyle = C.hull; ctx.fillText(label, 15, 12);
    }

    function drawOverlay() {
        const { w, h } = view;
        ctx.fillStyle = "rgba(11,15,22,0.86)"; ctx.fillRect(0, 0, w, h);
        const lines = over
            ? ["RUN ENDED", `You struck an obstacle at ${Math.floor(distance)} m.`, "Press Space or Enter to try again"]
            : ["DOWNSTREAM", "Press Space or Enter to start",
                reduced ? "Left and Right steer. Space moves one length on."
                    : "Left and Right steer. Space steadies the boat."];
        const size = Math.max(12, Math.min(22, w * 0.045));
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        lines.forEach((text, i) => {
            ctx.font = `${i === 0 ? size * 1.25 : size * 0.8}px ${MONO}`;
            ctx.fillStyle = i === 0 ? (over ? C.danger : C.accent) : i === 1 ? C.hull : C.muted;
            ctx.fillText(text, w / 2, h / 2 + (i - 1) * size * 1.9);
        });
    }

    // Eigen focusring op het canvas: een pagina die outlines wegpoetst mag deze niet
    // kunnen wissen, en zonder ring is niet te zien waar de toetsen landen.
    function drawFocusRing() {
        ctx.strokeStyle = C.rockEdge; ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, view.w - 3, view.h - 3);
        ctx.strokeStyle = C.water; ctx.lineWidth = 1;
        ctx.strokeRect(3.5, 3.5, view.w - 7, view.h - 7);
    }

    // ---- Invoer en levenscyclus ----

    function onKeyDown(e) {
        const dir = LEFT.includes(e.code) ? -1 : RIGHT.includes(e.code) ? 1 : null;
        const confirm = CONFIRM.includes(e.code);
        if (dir === null && !confirm) return;   // alleen onze eigen toetsen blokkeren
        e.preventDefault();
        if (!running) { if (confirm && !e.repeat) start(); return; }
        if (reduced) { if (!e.repeat) step(dir ?? 0); return; }
        if (dir === null) boatV = 0;            // spatie legt de boot recht
        else held.add(dir < 0 ? "left" : "right");
    }

    function onKeyUp(e) {
        if (LEFT.includes(e.code)) held.delete("left");
        if (RIGHT.includes(e.code)) held.delete("right");
    }

    function onPointer(e) {
        canvas.focus();
        if (!running) return start();
        const dir = e.clientX < canvas.getBoundingClientRect().left + view.w / 2 ? -1 : 1;
        if (reduced) step(dir); else boatV = dir * 0.55;
    }

    const onFocus = () => { focused = true; render(); };
    // Focus kwijt met een toets nog ingedrukt: zonder deze clear stuurt de boot door.
    const onBlur = () => { focused = false; held.clear(); render(); };
    const onResize = () => { layout(); render(); };

    function start() {
        obstacles = []; held.clear();
        boatX = 0.5; boatV = 0; lane = LANES >> 1; steps = 0;
        distance = 0; milestone = 0; speed = 0.32; spawnIn = 0.8; streak = 0;
        over = false; running = true;
        layout(); render();
        if (!reduced) { last = performance.now(); raf = requestAnimationFrame(loop); }
        say(reduced
            ? "Run started. The river moves one length for every key you press. Steer with Left and Right."
            : "Run started. Steer with Left and Right to keep the boat clear of the rocks.");
    }

    function stop() {
        if (!running) return;
        running = false; held.clear();
        cancelAnimationFrame(raf); raf = 0;
        render();
        say("Paused. Press Space or Enter to start a new run.");
    }

    canvas.setAttribute("tabindex", "0");
    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("keyup", onKeyUp);
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
            cancelAnimationFrame(raf); raf = 0; running = false; held.clear();
            canvas.removeEventListener("keydown", onKeyDown);
            canvas.removeEventListener("keyup", onKeyUp);
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
