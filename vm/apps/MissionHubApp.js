/**
 * Mission Hub app — V6 "Master World" runtime.
 *
 * WHAT THIS IS
 * -----------
 * One Blender-authored universe in one GLB (mission_hub_master.glb): the apartment
 * floats 500 m above the real-scale Bucky universe (Arc 1–5). The phone on the desk
 * is an open window — below its glass there is literally a hole in the desk and
 * 500 m of air down to the Arc 1 arrival pad. Clicking the phone flies THE camera
 * (the only camera) through the glass, down the drop, up over the universe for the
 * bird-eye reveal, then down into Arc 1.
 *
 * No portals. No render targets. No second scene. No overlays. No fades. No loading
 * screens. No runtime sky/HDRI/atmosphere — Blender authored all of it into the GLB
 * (sky dome, fog cards, sun + practical lights via KHR_lights_punctual, emissives).
 *
 * THE RUNTIME ONLY:
 *   1. preloads the master GLB at website startup (shared AssetCache, parse once),
 *   2. opens instantly from cache (clone, zero downloads),
 *   3. resolves the Blender anchors by name (fails loudly if any is missing),
 *   4. animates one camera along the anchor-built journey,
 *   5. handles pointer interaction + resize + deterministic teardown.
 *
 * BLENDER IS THE SOURCE OF TRUTH — anchors carried as empties in the GLB:
 *   CAM_ApartmentStart  — opening shot position
 *   CAM_PhoneHover      — above the phone, pre-entry
 *   CAM_GlassExit       — just below the pane (the "through" moment)
 *   CAM_DescentMid      — mid-air in the 500 m drop (same XY as the glass)
 *   CAM_BirdEye         — reveal apex: all five arcs in frame
 *   LOOK_Universe       — what the bird-eye looks at
 *   CAM_Arrival         — final position on the Arc 1 arrival pad
 *   Arc1_Arrival_Look   — final look target (the gate)
 * plus PhoneGlass / PhoneFrame / PhoneInteriorLip (interaction + framing) and
 * ARC1_PadRingOuter (the descent look target).
 *
 * MATERIAL POLICY: Blender materials ship as-is. The ONE exception is transmissive
 * glass — Three.js implements KHR transmission with an internal render target
 * (banned, and heavy on iPad), so every transmissive material is converted at mount
 * to plain transparent physical glass: subtle tint, subtle reflection, no glow.
 *
 * PERFORMANCE: one scene, one camera, one scene render per frame. Optional bloom
 * (threshold ≥ TRUE emissives only — the phone can never white-out) is skipped on
 * touch devices. No shadow maps. Pixel ratio capped. Far plane sized to the 7 km
 * world; near sized so the glass pass-through never clips.
 */
import { debugLog, logError } from "../core/diagnostics.js";
import { assetCache } from "../core/assetCache.js";

// ---------------------------------------------------------------------------
// CONFIG — the one place to tune the journey + look
// ---------------------------------------------------------------------------
const THREE_VERSION = "0.160.0";
const CDN = `https://esm.sh/three@${THREE_VERSION}`;
const JSM = `${CDN}/examples/jsm`;

const MODEL_URL = new URL("../assets/models/mission_hub_master.glb", import.meta.url).href;
const STYLE_ELEMENT_ID = "vm-missionhub-styles";

// Blender-authored anchor names (mount verifies every one and fails loudly).
const ANCHOR = {
    camStart: "CAM_ApartmentStart",
    camHover: "CAM_PhoneHover",
    camGlassExit: "CAM_GlassExit",
    camDescent: "CAM_DescentMid",
    camBirdEye: "CAM_BirdEye",
    camArrival: "CAM_Arrival",
    lookUniverse: "LOOK_Universe",
    lookArrival: "Arc1_Arrival_Look",
    glass: "PhoneGlass",
    frame: "PhoneFrame",
    lip: "PhoneInteriorLip",
    pad: "ARC1_PadRingOuter"
};
const REQUIRED_NODES = Object.values(ANCHOR);

// Journey: timing (t), anchor-resolved position/look, lens (mm full-frame vertical).
// Built at mount from world transforms — no world coordinates live in this file.
const JOURNEY_DURATION = 16.0; // seconds, click -> standing on the arrival pad
const JOURNEY_KEYS = [
    { t: 0.00, pos: "camStart",     look: "glassCenter", lens: 32 }, // apartment
    { t: 0.16, pos: "camHover",     look: "glassCenter", lens: 42 }, // over the phone
    { t: 0.26, pos: "glassAbove",   look: "pad",         lens: 46 }, // nose on the pane
    { t: 0.34, pos: "camGlassExit", look: "pad",         lens: 46 }, // THROUGH the glass
    { t: 0.52, pos: "camDescent",   look: "pad",         lens: 40 }, // free fall
    { t: 0.70, pos: "camBirdEye",   look: "lookUniverse", lens: 36 }, // reveal: Arc 1–5
    { t: 1.00, pos: "camArrival",   look: "lookArrival",  lens: 40 }  // Arc 1 arrival pad
];

// Look: tone + bloom + one hemisphere ambient. The GLB carries the sun, practicals,
// emissives, sky dome and fog cards from Blender. The ONE thing glTF cannot carry is
// indirect/ambient bounce (no GI in three) — Phase E's "indirect ambient fill" is a
// single HemisphereLight whose colors are sampled from the Blender sky-dome gradient
// (zenith / ground haze). It is fill only — direction and mood still come from the GLB.
const LOOK = {
    exposure: 1.0,
    ambient: { sky: 0x32405e, ground: 0x14110e, intensity: 0.45 },
    bloom: { strength: 0.22, radius: 0.55, threshold: 0.9 } // emissives only — glass can never bloom
};

// Glass override (the one permitted material change; see MATERIAL POLICY above).
const GLASS = {
    color: 0x0a1018,   // subtle cold tint — never white, never emissive
    opacity: 0.22,
    roughness: 0.06
};

const PERF = {
    maxPixelRatio: 1.75,
    bloomOnTouch: false // iPad: skip the bloom passes, render the scene directly
};

// ---------------------------------------------------------------------------
// Asset cache wiring — parse-once at website startup, clone per open
// ---------------------------------------------------------------------------
let _assetsRegistered = false;
function registerMissionHubAssets() {
    if (_assetsRegistered) return;
    _assetsRegistered = true;
    assetCache.registerAsset("mission_hub_master", MODEL_URL, {
        // The export carries one known orphan image reference; strip it ONCE from the
        // bytes so the cached parse — and every clone — is clean.
        transformBuffer(rawBuffer) {
            const { buffer, fixes } = patchMissingTextureSources(rawBuffer);
            if (fixes.length) debugLog("MissionHub ignored missing GLB texture references", fixes);
            return buffer;
        }
    });
}

/** Warm the master-world GLB into the shared AssetCache (idempotent, boot-time). */
export function preloadMissionHubAssets() {
    registerMissionHubAssets();
    return assetCache.preloadAsset("mission_hub_master");
}

/** Free the cached GLB. Called only when the whole VM unloads. */
export function disposeMissionHubAssets() {
    assetCache.disposeAsset("mission_hub_master");
}

// ---------------------------------------------------------------------------
// State + markup
// ---------------------------------------------------------------------------
export function createMissionHubState() {
    return { status: "loading", detail: "Starting runtime…" };
}

export function renderMissionHubApp(runtime, windowState) {
    const state = windowState.appState || {};
    injectStyles();
    return `
        <div class="vm-missionhub" data-missionhub-root>
            <div class="vm-missionhub-stage" data-missionhub-stage></div>
            <div class="vm-missionhub-hud" data-missionhub-hud>
                <span class="vm-missionhub-tag">MISSION HUB</span>
                <span class="vm-missionhub-status" data-missionhub-statusline>${escapeText(state.detail || "")}</span>
                <span class="vm-missionhub-hint" data-missionhub-hint>look into the phone</span>
            </div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
export function mountMissionHubApp(runtime, windowState, element) {
    const view = windowState.view || (windowState.view = {});
    view.cleanups = view.cleanups || [];
    const stage = element.querySelector("[data-missionhub-stage]");
    const statusLine = element.querySelector("[data-missionhub-statusline]");
    const hint = element.querySelector("[data-missionhub-hint]");
    if (!stage) { logError("MissionHub mount", new Error("stage element missing")); return; }

    const scene = {
        disposed: false, THREE: null, renderer: null, composer: null, bloom: null,
        world: null, camera: null, model: null,
        glassMaterials: [], resizeObserver: null, disposers: []
    };
    view.scene = scene;

    const setStatus = (status, detail) => {
        if (windowState.appState) { windowState.appState.status = status; windowState.appState.detail = detail; }
        if (statusLine) statusLine.textContent = detail;
    };

    buildScene(scene, stage, setStatus, { hint }).catch((error) => {
        logError("MissionHub buildScene", error);
        setStatus("error", "3D runtime unavailable — check your connection and reopen.");
    });
}

export function unmountMissionHubApp(runtime, windowState) {
    const view = windowState.view || {};
    const scene = view.scene;
    (view.cleanups || []).forEach((c) => { try { c(); } catch (e) { logError("MissionHub cleanup", e); } });
    view.cleanups = [];
    if (scene) { disposeScene(scene); view.scene = null; }
    debugLog("MissionHub unmounted", windowState.id);
}

// ---------------------------------------------------------------------------
// Scene construction — load GLB, resolve anchors, build journey. Nothing else.
// ---------------------------------------------------------------------------
async function buildScene(scene, stage, setStatus, ui) {
    const useBloom = PERF.bloomOnTouch || !isTouchDevice();
    let THREE, EffectComposer, RenderPass, UnrealBloomPass, OutputPass;
    try {
        const mods = await Promise.all([
            import(/* @vite-ignore */ CDN),
            useBloom ? import(/* @vite-ignore */ `${JSM}/postprocessing/EffectComposer.js`) : null,
            useBloom ? import(/* @vite-ignore */ `${JSM}/postprocessing/RenderPass.js`) : null,
            useBloom ? import(/* @vite-ignore */ `${JSM}/postprocessing/UnrealBloomPass.js`) : null,
            useBloom ? import(/* @vite-ignore */ `${JSM}/postprocessing/OutputPass.js`) : null
        ]);
        THREE = mods[0];
        if (useBloom) {
            EffectComposer = mods[1].EffectComposer; RenderPass = mods[2].RenderPass;
            UnrealBloomPass = mods[3].UnrealBloomPass; OutputPass = mods[4].OutputPass;
        }
    } catch (error) {
        throw new Error(`Three.js failed to load: ${error && error.message}`);
    }
    if (scene.disposed) return;
    scene.THREE = THREE;

    // ---- Renderer (ONE pass of ONE scene per frame) ----
    const W = () => Math.max(1, stage.clientWidth);
    const H = () => Math.max(1, stage.clientHeight);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PERF.maxPixelRatio));
    renderer.setSize(W(), H());
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = LOOK.exposure;
    renderer.shadowMap.enabled = false; // dusk look is sky/emissive-driven; biggest iPad win
    renderer.domElement.classList.add("vm-missionhub-canvas");
    renderer.domElement.style.touchAction = "none";
    stage.appendChild(renderer.domElement);
    scene.renderer = renderer;

    // Lost-context guard (GPU reset / iPad backgrounding).
    const onCtxLost = (e) => { e.preventDefault(); debugLog("MissionHub WebGL context lost"); setStatus("paused", "Graphics paused — restoring…"); };
    const onCtxRestored = () => { debugLog("MissionHub WebGL context restored"); setStatus("armed", "Look into the phone…"); };
    renderer.domElement.addEventListener("webglcontextlost", onCtxLost, false);
    renderer.domElement.addEventListener("webglcontextrestored", onCtxRestored, false);
    scene.disposers.push(() => {
        renderer.domElement.removeEventListener("webglcontextlost", onCtxLost);
        renderer.domElement.removeEventListener("webglcontextrestored", onCtxRestored);
    });

    // ---- THE ONE SCENE — everything visual comes from the GLB ----
    const world = new THREE.Scene();
    world.background = new THREE.Color(0x05060a); // only ever visible if the sky dome is culled
    // Indirect ambient fill (see LOOK.ambient) — glTF carries no GI/ambient term.
    world.add(new THREE.HemisphereLight(LOOK.ambient.sky, LOOK.ambient.ground, LOOK.ambient.intensity));
    scene.world = world;

    setStatus("loading", "Opening the world…");
    registerMissionHubAssets();
    let model = null;
    try {
        model = await assetCache.acquireScene("mission_hub_master");
        if (scene.disposed) { model = null; return; }
        if (!model) throw new Error("AssetCache returned no scene (parse failed or asset unavailable)");

        // ANCHOR VERIFICATION — every Blender anchor must exist, by exact name.
        const missing = REQUIRED_NODES.filter((nm) => !model.getObjectByName(nm));
        if (missing.length) throw new Error(`mission_hub_master.glb missing required nodes: ${missing.join(", ")}`);

        world.add(model);
        debugLog("MissionHub master GLB clone acquired", MODEL_URL);
    } catch (error) {
        if (scene.disposed) return;
        throw new Error(`mission_hub_master.glb failed to load from ${MODEL_URL}: ${error && error.message ? error.message : error}`);
    }
    scene.model = model; // shared AssetCache clone: detach on unmount, never deep-dispose

    // ---- Glass: convert EVERY transmissive material to plain transparent glass.
    // KHR transmission would make Three.js allocate an internal render target
    // (banned + expensive). Subtle tint, subtle reflection, physically believable,
    // no glow. These override materials are THIS MOUNT'S OWN (disposed on unmount);
    // the cached clone's shared materials are never mutated.
    const glassMeshes = [];
    model.traverse((n) => {
        if (!n.isMesh) return;
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        if (mats.some((m) => m && (m.transmission > 0 || m._isGlassOverride))) glassMeshes.push(n);
    });
    glassMeshes.forEach((mesh) => {
        const override = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(GLASS.color),
            metalness: 0, roughness: GLASS.roughness, ior: 1.45,
            transparent: true, opacity: GLASS.opacity, depthWrite: false,
            side: THREE.DoubleSide
        });
        override.toneMapped = true;
        override._isGlassOverride = true;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(() => override) : override;
        mesh.castShadow = false;
        scene.glassMaterials.push(override);
    });
    debugLog("MissionHub transmissive materials converted to simple glass", glassMeshes.map((m) => m.name));

    // ---- Resolve anchors (world space, post-add) ----
    model.updateWorldMatrix(true, true);
    const worldPos = (nm) => {
        const o = model.getObjectByName(nm);
        return o.getWorldPosition(new THREE.Vector3());
    };
    const glassMesh = model.getObjectByName(ANCHOR.glass);
    const glassCenter = new THREE.Box3().setFromObject(glassMesh).getCenter(new THREE.Vector3());
    const points = {
        camStart: worldPos(ANCHOR.camStart),
        camHover: worldPos(ANCHOR.camHover),
        camGlassExit: worldPos(ANCHOR.camGlassExit),
        camDescent: worldPos(ANCHOR.camDescent),
        camBirdEye: worldPos(ANCHOR.camBirdEye),
        camArrival: worldPos(ANCHOR.camArrival),
        lookUniverse: worldPos(ANCHOR.lookUniverse),
        lookArrival: worldPos(ANCHOR.lookArrival),
        pad: worldPos(ANCHOR.pad),
        glassCenter,
        glassAbove: glassCenter.clone().add(new THREE.Vector3(0, 0, 0.07))
    };
    const path = JOURNEY_KEYS.map((k) => ({
        t: k.t,
        pos: points[k.pos].clone(),
        look: points[k.look].clone(),
        fov: lensToFov(k.lens)
    }));

    // ---- The ONE camera. near: glass pass-through must not clip; far: the 7 km world.
    const camera = new THREE.PerspectiveCamera(path[0].fov, W() / H(), 0.05, 12000);
    camera.position.copy(path[0].pos);
    camera.lookAt(path[0].look);
    scene.camera = camera;

    // ---- Optional bloom (desktop): emissives only. Otherwise: direct render. ----
    let composer = null, bloom = null;
    if (useBloom) {
        composer = new EffectComposer(renderer);
        composer.setSize(W(), H());
        composer.addPass(new RenderPass(world, camera));
        bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), LOOK.bloom.strength, LOOK.bloom.radius, LOOK.bloom.threshold);
        composer.addPass(bloom);
        composer.addPass(new OutputPass());
        scene.composer = composer; scene.bloom = bloom;
    }

    // ---- Interaction: click the phone -> start the journey ----
    const anim = { phase: "idle", t: 0, p: 0 };
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const targets = [];
    [ANCHOR.glass, ANCHOR.frame, ANCHOR.lip].forEach((nm) => {
        const o = model.getObjectByName(nm);
        if (o) o.traverse((c) => { if (c.isMesh) targets.push(c); });
    });
    const overPhone = (ev) => {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
        ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
        raycaster.setFromCamera(ndc, camera);
        return raycaster.intersectObjects(targets, true).length > 0;
    };
    const startEnter = () => {
        if (anim.phase !== "idle") return;
        anim.phase = "entering"; anim.t = 0;
        if (ui.hint) ui.hint.textContent = "";
        setStatus("entering", "Falling into the world…");
        debugLog("MissionHub journey start");
    };
    const onMove = (ev) => {
        if (anim.phase !== "idle") { renderer.domElement.style.cursor = "default"; return; }
        renderer.domElement.style.cursor = overPhone(ev) ? "pointer" : "default";
    };
    const onDown = (ev) => { if (anim.phase === "idle" && overPhone(ev)) startEnter(); };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    scene.disposers.push(() => {
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerdown", onDown);
    });

    // ---- Responsive ----
    const resize = () => {
        if (scene.disposed || !scene.renderer) return;
        const w = W(), h = H();
        renderer.setSize(w, h);
        if (composer) { composer.setSize(w, h); bloom.setSize(w, h); }
        camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(stage); scene.resizeObserver = ro; resize();
    if (scene.disposed) return;

    // ---- Frame loop — ONE scene, ONE camera, ONE scene render ----
    const clock = new THREE.Clock();
    const _off = new THREE.Vector3();
    const _pos = new THREE.Vector3();
    const _look = new THREE.Vector3();
    const idleP = path[0].pos.clone();
    const idleL = path[0].look.clone();
    const fovIdle = path[0].fov;

    const samplePath = (p) => {
        let a = path[0], b = path[path.length - 1];
        for (let i = 0; i < path.length - 1; i++) {
            if (p >= path[i].t && p <= path[i + 1].t) { a = path[i]; b = path[i + 1]; break; }
        }
        const seg = smoothstep01((p - a.t) / Math.max(1e-5, b.t - a.t));
        _pos.lerpVectors(a.pos, b.pos, seg);
        _look.lerpVectors(a.look, b.look, seg);
        camera.position.copy(_pos);
        camera.lookAt(_look);
        const fov = lerp(a.fov, b.fov, seg);
        if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    };

    const tick = (dt, time) => {
        if (anim.phase === "idle") {
            _off.set(Math.sin(time * 0.16) * 0.05, Math.cos(time * 0.13) * 0.025, Math.sin(time * 0.1) * 0.04);
            camera.position.copy(idleP).add(_off);
            camera.lookAt(idleL);
            if (camera.fov !== fovIdle) { camera.fov = fovIdle; camera.updateProjectionMatrix(); }
            return;
        }
        if (anim.phase === "entering") {
            anim.t += dt / JOURNEY_DURATION;
            const raw = clamp01(anim.t), p = smootherstep(raw); anim.p = p;
            samplePath(p);
            setStatus("entering", enterLabel(p));
            if (raw >= 1) {
                anim.phase = "arrived";
                setStatus("arrived", "Arc 1 — arrival pad");
                debugLog("MissionHub arrived at Arc 1");
            }
            return;
        }
        samplePath(1); // arrived
    };

    renderer.setAnimationLoop(() => {
        if (scene.disposed) return;
        const dt = clock.getDelta(), time = clock.elapsedTime;
        tick(dt, time);
        if (composer) composer.render(); else renderer.render(world, camera);
    });
    setStatus("armed", "Look into the phone…");
    debugLog("MissionHub V6 master-world runtime running", { bloom: useBloom });
}

// ---------------------------------------------------------------------------
// Helpers — GLB byte-patcher: strip orphan image / missing texture references
// from the JSON chunk ONCE before the AssetCache parse (the V6 export carries one).
// ---------------------------------------------------------------------------
function patchMissingTextureSources(arrayBuffer) {
    const input = arrayBuffer instanceof ArrayBuffer ? new Uint8Array(arrayBuffer) : new Uint8Array(arrayBuffer.buffer);
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    if (input.length < 20 || readAscii(input, 0, 4) !== "glTF" || view.getUint32(4, true) !== 2) {
        return { buffer: arrayBuffer, fixes: [] };
    }
    let offset = 12;
    const chunks = [];
    let jsonChunk = null;
    while (offset + 8 <= input.length) {
        const length = view.getUint32(offset, true); offset += 4;
        const type = view.getUint32(offset, true); offset += 4;
        const start = offset;
        const end = start + length;
        if (end > input.length) return { buffer: arrayBuffer, fixes: [] };
        const data = input.slice(start, end);
        const chunk = { type, data };
        chunks.push(chunk);
        if (type === 0x4e4f534a) jsonChunk = chunk;
        offset = end;
    }
    if (!jsonChunk) return { buffer: arrayBuffer, fixes: [] };
    const json = JSON.parse(new TextDecoder().decode(jsonChunk.data));
    const fixes = removeMissingTextureReferences(json);
    if (!fixes.length) return { buffer: arrayBuffer, fixes };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const paddedJson = padChunk(jsonBytes, 0x20);
    jsonChunk.data = paddedJson;
    const totalLength = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.data.length, 0);
    const output = new Uint8Array(totalLength);
    const outView = new DataView(output.buffer);
    output.set(input.slice(0, 4), 0);
    outView.setUint32(4, 2, true);
    outView.setUint32(8, totalLength, true);
    let outOffset = 12;
    chunks.forEach((chunk) => {
        outView.setUint32(outOffset, chunk.data.length, true); outOffset += 4;
        outView.setUint32(outOffset, chunk.type, true); outOffset += 4;
        output.set(chunk.data, outOffset); outOffset += chunk.data.length;
    });
    return { buffer: output.buffer, fixes };
}

function removeMissingTextureReferences(json) {
    const fixes = [];
    const textures = json.textures || [];
    const images = json.images || [];
    const hasValidImage = (source) => Number.isInteger(source) && !!images[source];
    const hasValidTexture = (index) => {
        const texture = textures[index];
        if (!texture) return false;
        if (hasValidImage(texture.source)) return true;
        const webp = texture.extensions && texture.extensions.EXT_texture_webp;
        return !!(webp && hasValidImage(webp.source));
    };
    const walk = (value, path) => {
        if (!value || typeof value !== "object") return;
        Object.keys(value).forEach((key) => {
            const child = value[key];
            const childPath = path ? `${path}.${key}` : key;
            if (key.endsWith("Texture") && child && typeof child === "object" && Number.isInteger(child.index) && !hasValidTexture(child.index)) {
                fixes.push({ path: childPath, textureIndex: child.index });
                delete value[key];
                return;
            }
            walk(child, childPath);
        });
    };
    walk(json, "");
    return fixes;
}

function padChunk(bytes, padByte) {
    const paddedLength = Math.ceil(bytes.length / 4) * 4;
    const out = new Uint8Array(paddedLength);
    out.set(bytes);
    out.fill(padByte, bytes.length);
    return out;
}
function readAscii(bytes, start, length) {
    let s = "";
    for (let i = 0; i < length; i++) s += String.fromCharCode(bytes[start + i]);
    return s;
}

// ---------------------------------------------------------------------------
// Helpers — math + device
// ---------------------------------------------------------------------------
function lensToFov(lens) { return 2 * Math.atan(24 / (2 * lens)) * 180 / Math.PI; } // 36x24 full-frame, vertical
function isTouchDevice() {
    try { return typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 1; } catch (_e) { return false; }
}
function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep01(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
function smootherstep(x) { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); }
function enterLabel(p) {
    if (p < 0.16) return "approaching the phone";
    if (p < 0.34) return "through the glass";
    if (p < 0.52) return "falling — 500 m to go";
    if (p < 0.70) return "the universe below";
    if (p < 1.0) return "descending to Arc 1";
    return "Arc 1";
}

// ---------------------------------------------------------------------------
// Disposal — deterministic teardown
// ---------------------------------------------------------------------------
function disposeScene(scene) {
    if (!scene || scene.disposed) { if (scene) scene.disposed = true; return; }
    scene.disposed = true;
    if (scene.renderer) { try { scene.renderer.setAnimationLoop(null); } catch (_) {} }
    (scene.disposers || []).forEach((fn) => { try { fn(); } catch (e) { logError("MissionHub disposer", e); } });
    scene.disposers = [];
    if (scene.resizeObserver) { try { scene.resizeObserver.disconnect(); } catch (_) {} scene.resizeObserver = null; }
    if (scene.composer) { try { scene.composer.dispose && scene.composer.dispose(); } catch (_) {} scene.composer = null; }

    // The AssetCache clone is SHARED — detach, never deep-dispose; its
    // geometry/materials/textures belong to the cache and are reused by the next open.
    if (scene.world && scene.model) { try { scene.world.remove(scene.model); } catch (_) {} }
    scene.model = null;

    // This mount's OWN GPU resources.
    (scene.glassMaterials || []).forEach((m) => { try { m.dispose(); } catch (_) {} });
    scene.glassMaterials = [];
    scene.world = null;

    if (scene.renderer) {
        try {
            const canvas = scene.renderer.domElement;
            scene.renderer.dispose();
            if (typeof scene.renderer.forceContextLoss === "function") scene.renderer.forceContextLoss();
            if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        } catch (e) { logError("MissionHub disposeRenderer", e); }
        scene.renderer = null;
    }
    scene.camera = null; scene.bloom = null; scene.THREE = null;
}

// ---------------------------------------------------------------------------
// Helpers — markup + styles
// ---------------------------------------------------------------------------
function escapeText(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function injectStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ELEMENT_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
.vm-missionhub { position:relative; width:100%; height:100%; background:#05060a; overflow:hidden; }
.vm-missionhub-stage { position:absolute; inset:0; width:100%; height:100%; }
.vm-missionhub-canvas { display:block; width:100%; height:100%; }
.vm-missionhub-hud { position:absolute; left:12px; bottom:12px; display:flex; flex-direction:column; gap:2px;
  padding:8px 12px; border:1px solid rgba(120,200,255,.26); border-radius:10px;
  background:rgba(8,12,20,.5); backdrop-filter:blur(6px); pointer-events:none;
  font-family:"Segoe UI", system-ui, sans-serif; z-index:2; }
.vm-missionhub-tag { font-size:10px; letter-spacing:1.6px; color:#7fd0ff; }
.vm-missionhub-status { font-size:12px; color:#eaf6ff; }
.vm-missionhub-hint { font-size:10px; color:rgba(220,235,255,.55); }
    `;
    document.head.appendChild(style);
}
