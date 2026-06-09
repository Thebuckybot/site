/**
 * Mission Hub app — Cinematic Phone Intro (Phase v0.4 · "real scene").
 *
 * WHAT THIS IS
 * -----------
 * A real-time, in-browser approximation of a AAA game intro. A realistic
 * smartphone lies on a dark-oak desk in a moody, HDRI-lit office (the Bucky
 * poster watches from the left wall). The glass shows only reflections until
 * the player clicks it; the camera then makes a slow, expensive dolly toward
 * the screen, the reflections fade, and a vast glowing world emerges from
 * inside the device, ending on a "BUCKY WORLD INITIALIZING" card.
 *
 * The Blender file assets/blender/mission_hub_v2.blend is the SOURCE OF TRUTH.
 * This runtime consumes its optimised export:
 *   - site/vm/assets/models/mission_hub.glb       (Draco + WebP, ~1.5 MB; parsed
 *     ONCE by core/assetCache.js at boot and CLONED per open — no re-download,
 *     re-parse or re-decode on reopen; freed only when the VM unloads)
 *   - site/vm/assets/hdri/dusk_sky_1k.hdr         (env + reflections, ~1.3 MB)
 * The camera waypoints below were recorded from that .blend
 * (mission_hub_v2_waypoints.json) so the shot matches the rendered reference.
 *
 * ARCHITECTURE (unchanged contract — see docs/architecture/app-system.md)
 * ----------------------------------------------------------------------
 * Exports createState / render / mount / unmount (+ preloadMissionHubAssets /
 * disposeMissionHubAssets for the boot preload + VM-unload teardown), registered
 * in vmRuntime.js. The scene is built imperatively once in `mount`; the body is
 * never rebuilt on resize/maximize. Three.js + post-FX load on demand from pinned
 * CDNs (GitHub-Pages-safe, no build step); the GLB + Draco decoder are owned by
 * the shared AssetCache (core/assetCache.js). One ResizeObserver handles
 * all size changes. `unmount` performs deterministic teardown (loop stopped;
 * renderer, composer, passes, geometries, materials, textures, env map and
 * PMREM disposed), with an async `scene.disposed` guard for close-during-load.
 *
 * RENDERING NOTES
 * ---------------
 * - HDRI → PMREM drives image-based lighting + glass/metal reflections.
 * - A cool window key light (with shadows) + a warm lamp light reproduce the
 *   Blender lighting that does NOT travel inside a GLB.
 * - Post: ACES filmic tone mapping + UnrealBloom for the cinematic glow.
 * - The "world inside" is the same self-contained procedural GLSL portal as the
 *   prototype (no extra render pass), revealed as the glass reflection fades.
 *
 * TUNING: the CONFIG block is the single place to adjust look (exposure,
 * bloom, light intensities, reveal timing, camera waypoints).
 */
import { debugLog, logError } from "../core/diagnostics.js";
// v0.8 (Phase 2) — the hero GLB is now parsed ONCE into the shared AssetCache and
// cloned on each open (no re-download / re-parse / re-decode). See core/assetCache.js.
import { assetCache } from "../core/assetCache.js";

// ---------------------------------------------------------------------------
// CONFIG — the one place to tune the look
// ---------------------------------------------------------------------------
const THREE_VERSION = "0.160.0";
const CDN = `https://esm.sh/three@${THREE_VERSION}`;
const JSM = `${CDN}/examples/jsm`;

const MODEL_URL = new URL("../assets/models/mission_hub.glb", import.meta.url).href;
// v0.7 (V3 env pass): dusk/sunset sky — drives the warm "evening apartment" look and
// the reflections in the phone glass. (Was terrace_night_1k.hdr.)
const HDRI_URL = new URL("../assets/hdri/dusk_sky_1k.hdr", import.meta.url).href;
// v0.9 (Phase 4) — BUCKY WORLD. The phone is a real entry point: at Phone_Depth_Target
// the runtime loads this world GLB (a placeholder Sphere today) to PROVE the
// MissionHub → Phone Interior → BuckyWorld handoff. Resolved via import.meta.url
// (GitHub-Pages-safe) and registered in the AssetCache with preload capability.
const BUCKYWORLD_URL = new URL("../assets/models/buckyworld.glb", import.meta.url).href;

const STYLE_ELEMENT_ID = "vm-missionhub-styles";
const DESCENT_DURATION = 5.5; // seconds, click → arrive at Phone_Depth_Target (slow, "expensive" descent)

// Camera-into-phone path, Three.js (Y-up) world space.
// v0.9 (Phase 4): the click no longer dollies onto a portal plane — the camera
// physically ENTERS the device. CAM.entry/interior/depthTarget ARE the real Blender
// Phone_Entry / Phone_Interior / Phone_Depth_Target empties (Y-up = [x, z, -y], from
// mission_hub_v2_phone_path.json). The descent: room overview → approach → align
// straight above the glass (looking DOWN) → descend vertically through the glass
// (which fades) → through Entry and Interior → arrive at Depth_Target, where Bucky
// World loads. No portal, no light beam, no pillar — a real vertical descent.
const CAM = {
    widePos: [1.10, 2.05, 0.55], wideLook: [-0.12, 0.74, -1.30], wideLens: 34, // room overview
    screen:      [-0.12, 0.7817, -1.48], // PhoneScreen glass plane
    entry:       [-0.12, 0.8517, -1.48], // Phone_Entry  — just above the glass
    interior:    [-0.12, 0.2317, -1.48], // Phone_Interior — mid depth chamber
    depthTarget: [-0.12, -0.3583, -1.48] // Phone_Depth_Target — the Bucky World loading area
};
// Descent keyframes (t 0..1). pos = camera position, look = aim point, lens = mm.
const CAM_PATH = [
    { t: 0.00, pos: [1.10, 2.05, 0.55],    look: [-0.12, 0.74, -1.30],  lens: 34 }, // overview: desk + poster + phone
    { t: 0.30, pos: [0.34, 1.46, -0.86],   look: [-0.12, 0.80, -1.46],  lens: 40 }, // approach the phone
    { t: 0.52, pos: [-0.12, 0.95, -1.48],  look: [-0.12, 0.781, -1.48], lens: 46 }, // align straight above the screen, looking DOWN
    { t: 0.76, pos: [-0.12, 0.33, -1.48],  look: [-0.12, -0.30, -1.48], lens: 40 }, // descend through Entry → Interior
    { t: 1.00, pos: [-0.12, -0.30, -1.48], look: [-0.12, -0.66, -1.48], lens: 35 }  // arrive at Depth_Target (Bucky World loads)
];

// v0.7 (V3): tuned for the DUSK env + the building now visible through the window.
// Key light is now WARM (golden sunset rake from the window) instead of cool.
const LOOK = {
    exposure: 1.10,            // ACES tone-mapping exposure
    bloomStrength: 0.42,       // softer, avoids the blown "orb" bloom on the lamp
    bloomRadius: 0.5,
    bloomThreshold: 0.9,       // only the brightest highlights bloom
    envIntensity: 1.0,         // dusk HDRI: ambient fill + glass/metal reflections
    keyIntensity: 3.2,         // WARM window key (PRIMARY light) — the setting sun
    lampIntensity: 9.0,        // warm desk-lamp ACCENT, not the main source
    fillIntensity: 0.5,        // cool sky-bounce fill on the camera side
    hemiIntensity: 0.40        // gentle ambient floor so nothing reads pure black
};

// ---------------------------------------------------------------------------
// Asset cache wiring (Phase 2 · Tasks 4 + 5)
// ---------------------------------------------------------------------------
// The hero room GLB is registered with the shared AssetCache, which parses it
// ONCE and hands every open a clone (shared geometry/materials/textures). Bucky
// World is registered with the SAME parse-once/clone path (preload capability),
// preloaded in the background when Mission Hub opens — not at site startup.
let _assetsRegistered = false;
function registerMissionHubAssets() {
    if (_assetsRegistered) return;
    _assetsRegistered = true;
    assetCache.registerAsset("mission_hub", MODEL_URL, {
        // Mission Hub's Blender export carries a known orphan image (Map #97.001)
        // and can reference a missing texture source; strip those from the GLB
        // bytes ONCE here so the cached parse — and every clone — is clean.
        transformBuffer(rawBuffer) {
            const { buffer, fixes } = patchMissingTextureSources(rawBuffer);
            if (fixes.length) debugLog("MissionHub ignored missing GLB texture references", fixes);
            return buffer;
        }
    });
    // Phase 4 — BUCKY WORLD. The GLB ships now, registered with preload capability
    // (available:true) but NOT eagerly fetched at site startup — its preload is kicked
    // off when Mission Hub opens (schedulePreload) so it is cached before the camera
    // arrives at Phone_Depth_Target. Same parse-once/clone path as the room GLB.
    assetCache.registerAsset("buckyworld", BUCKYWORLD_URL, { available: true });
}

/**
 * preloadMissionHubAssets — kick off the parse-once warm of the hero GLB.
 * Called from the VM boot sequence (vmRuntime.preloadMissionHub) during idle so
 * the first open clones an already-parsed scene with no loading screen / pop-in.
 * Idempotent + best-effort; returns the cache promise (resolves to the entry).
 */
export function preloadMissionHubAssets() {
    registerMissionHubAssets();
    return assetCache.preloadAsset("mission_hub");
}

/**
 * disposeMissionHubAssets — free the cached room GLB + Bucky World. This is the
 * ONLY place the hero assets are released and it is called solely when the VM
 * fully unloads (runtime.dispose). App open/close never touches the cache.
 */
export function disposeMissionHubAssets() {
    assetCache.disposeAsset("mission_hub");
    assetCache.disposeAsset("buckyworld");
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
export function createMissionHubState() {
    return { status: "loading", detail: "Starting cinematic runtime…" };
}

// ---------------------------------------------------------------------------
// Markup (the scene is built imperatively in mount)
// ---------------------------------------------------------------------------
export function renderMissionHubApp(runtime, windowState) {
    const state = windowState.appState || {};
    injectStyles();
    return `
        <div class="vm-missionhub" data-missionhub-root>
            <div class="vm-missionhub-stage" data-missionhub-stage></div>
            <div class="vm-missionhub-vignette"></div>
            <div class="vm-missionhub-portalcard" data-missionhub-card aria-hidden="true">
                <div class="vm-missionhub-portalcard-inner">
                    <span class="vm-missionhub-card-kicker">Bucky World</span>
                    <span class="vm-missionhub-card-title">INITIALIZING</span>
                    <span class="vm-missionhub-card-sub">Something is waking up inside the device.</span>
                </div>
            </div>
            <div class="vm-missionhub-hud" data-missionhub-hud>
                <span class="vm-missionhub-tag">MISSION HUB</span>
                <span class="vm-missionhub-status" data-missionhub-statusline>${escapeText(state.detail || "")}</span>
                <span class="vm-missionhub-hint" data-missionhub-hint>click the phone</span>
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
    const card = element.querySelector("[data-missionhub-card]");
    const hint = element.querySelector("[data-missionhub-hint]");
    if (!stage) { logError("MissionHub mount", new Error("stage element missing")); return; }

    const scene = {
        disposed: false, THREE: null, renderer: null, composer: null,
        sceneGraph: null, camera: null, model: null, modelShared: false, glass: null, chamber: null, world: null,
        envTex: null, bgTex: null, pmrem: null, resizeObserver: null, disposers: []
    };
    view.scene = scene;

    const setStatus = (status, detail) => {
        if (windowState.appState) { windowState.appState.status = status; windowState.appState.detail = detail; }
        if (statusLine) statusLine.textContent = detail;
    };

    buildScene(scene, stage, setStatus, { card, hint }).catch((error) => {
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
// Scene construction
// ---------------------------------------------------------------------------
async function buildScene(scene, stage, setStatus, ui) {
    // GLTF/Draco loading now lives in core/assetCache.js (parse-once), so the app
    // only imports what it still owns per-open: the renderer env loader + post FX.
    let THREE, RGBELoader, EffectComposer, RenderPass, UnrealBloomPass, OutputPass;
    try {
        [THREE, { RGBELoader },
         { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
            import(/* @vite-ignore */ CDN),
            import(/* @vite-ignore */ `${JSM}/loaders/RGBELoader.js`),
            import(/* @vite-ignore */ `${JSM}/postprocessing/EffectComposer.js`),
            import(/* @vite-ignore */ `${JSM}/postprocessing/RenderPass.js`),
            import(/* @vite-ignore */ `${JSM}/postprocessing/UnrealBloomPass.js`),
            import(/* @vite-ignore */ `${JSM}/postprocessing/OutputPass.js`)
        ]);
    } catch (error) {
        throw new Error(`Three.js failed to load: ${error && error.message}`);
    }
    if (scene.disposed) return;
    scene.THREE = THREE;

    // ---- Renderer ----
    const W = () => Math.max(1, stage.clientWidth);
    const H = () => Math.max(1, stage.clientHeight);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W(), H());
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = LOOK.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.classList.add("vm-missionhub-canvas");
    renderer.domElement.style.touchAction = "none";
    stage.appendChild(renderer.domElement);
    scene.renderer = renderer;

    // v0.7 (V3) black-screen guard: a lost WebGL context (GPU reset, iPad tab/app
    // backgrounding, driver hiccup) leaves a FROZEN BLACK canvas unless we
    // preventDefault so the browser will RESTORE it. three.js re-inits its GL state
    // on restore and the setAnimationLoop resumes automatically.
    const onCtxLost = (e) => { e.preventDefault(); debugLog("MissionHub WebGL context lost"); setStatus("paused", "Graphics paused — restoring…"); };
    const onCtxRestored = () => { debugLog("MissionHub WebGL context restored"); setStatus("armed", "Click the phone to look closer…"); };
    renderer.domElement.addEventListener("webglcontextlost", onCtxLost, false);
    renderer.domElement.addEventListener("webglcontextrestored", onCtxRestored, false);
    scene.disposers.push(() => {
        renderer.domElement.removeEventListener("webglcontextlost", onCtxLost);
        renderer.domElement.removeEventListener("webglcontextrestored", onCtxRestored);
    });

    // ---- Scene ----
    const sceneGraph = new THREE.Scene();
    // v0.7 (V3): the exterior building/trees now live in the GLB, ~25–55 units out
    // through the window. The OLD fog far (12) would have FOGGED THE BUILDING OUT
    // entirely. Fog is widened + tinted to a dusk haze so the city reads with gentle
    // atmospheric depth. The sky itself becomes the HDRI once it loads; this solid
    // dusk tone is also the SAFE fallback background if the HDRI never arrives.
    sceneGraph.background = new THREE.Color(0x141019);
    sceneGraph.fog = new THREE.Fog(0x2b2533, 8.0, 165.0);
    scene.sceneGraph = sceneGraph;

    // ---- HDRI environment (reflections + ambient) ----
    setStatus("loading", "Loading environment…");
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    scene.pmrem = pmrem;
    try {
        const hdr = await new Promise((res, rej) => new RGBELoader().load(HDRI_URL, res, undefined, rej));
        if (scene.disposed) { hdr.dispose(); return; }
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        const envTex = pmrem.fromEquirectangular(hdr).texture;
        sceneGraph.environment = envTex;
        if ("environmentIntensity" in sceneGraph) sceneGraph.environmentIntensity = LOOK.envIntensity;
        // Show the real dusk sky THROUGH the window, kept tame so it doesn't blow out
        // behind the building. `hdr` stays alive as the background → disposed in teardown.
        sceneGraph.background = hdr;
        if ("backgroundIntensity" in sceneGraph) sceneGraph.backgroundIntensity = 0.45;
        if ("backgroundBlurriness" in sceneGraph) sceneGraph.backgroundBlurriness = 0.0;
        scene.envTex = envTex;
        scene.bgTex = hdr;
    } catch (error) {
        // NEVER leave the scene without an environment — that is the classic "black
        // room" failure (no image-based lighting → dark PBR materials). Fall back to a
        // procedural neutral studio env so geometry is ALWAYS lit + reflective.
        debugLog("MissionHub HDRI unavailable → procedural fallback env", error && error.message);
        try {
            const { RoomEnvironment } = await import(/* @vite-ignore */ `${JSM}/environments/RoomEnvironment.js`);
            if (scene.disposed) return;
            const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
            sceneGraph.environment = envTex;
            if ("environmentIntensity" in sceneGraph) sceneGraph.environmentIntensity = LOOK.envIntensity;
            scene.envTex = envTex;
        } catch (e2) {
            debugLog("MissionHub fallback env failed", e2 && e2.message);
        }
    }

    // ---- Lights (reproduce the Blender key/lamp/fill that GLB can't carry) ----
    const hemi = new THREE.HemisphereLight(0x9fb6e0, 0x14110d, LOOK.hemiIntensity);
    sceneGraph.add(hemi);

    const key = new THREE.DirectionalLight(0xffca7a, LOOK.keyIntensity); // WARM sunset rake from the window
    key.position.set(-0.5, 2.4, -3.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004; key.shadow.radius = 5;
    { const c = key.shadow.camera; c.near = 0.5; c.far = 8; c.left = -2; c.right = 2; c.top = 2; c.bottom = -2; c.updateProjectionMatrix(); }
    key.target.position.set(-0.12, 0.78, -1.46);
    sceneGraph.add(key); sceneGraph.add(key.target);

    const lamp = new THREE.PointLight(0xffb060, LOOK.lampIntensity, 6, 2.0); // warm desk lamp
    lamp.position.set(0.45, 1.00, -1.78);
    lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.0006;
    sceneGraph.add(lamp);

    const fill = new THREE.DirectionalLight(0x9db4e8, LOOK.fillIntensity); // cool camera-side fill
    fill.position.set(2.0, 1.4, 1.6);
    sceneGraph.add(fill);

    // ---- GLB scene (parse-once cache -> clone) ----
    // v0.8 (Phase 2 · Task 4): the GLB is parsed ONCE by the AssetCache (warmed at
    // boot). Here we receive a lightweight CLONE that shares geometry/materials/
    // textures with every other open — no re-download, no re-parse, no re-decode.
    // The cached original is freed only when the VM unloads (runtime.dispose).
    setStatus("loading", "Loading scene…");
    registerMissionHubAssets();
    let model = null, screenMesh = null;
    try {
        model = await assetCache.acquireScene("mission_hub");
        // Close-during-load: drop the clone and bail. The shared cache is untouched
        // (a clone's shared resources are never deep-disposed) and the clone is GC'd.
        if (scene.disposed) { model = null; return; }
        if (!model) throw new Error("AssetCache returned no scene (parse failed or asset unavailable)");
        // Shadow flags are runtime-only; object transforms and visibility remain from the GLB.
        model.traverse((n) => {
            if (!n.isMesh) return;
            // exterior city + the hidden depth chamber carry no shadow work
            const noShadow = typeof n.name === "string" && (n.name.indexOf("EXT_") === 0 || n.name.indexOf("PHN_") === 0);
            n.castShadow = !noShadow;
            n.receiveShadow = !noShadow;
        });
        sceneGraph.add(model);
        screenMesh = model.getObjectByName("PhoneScreen");
        const missingPhoneNodes = ["PhoneBody", "PhoneFrame", "PhoneScreen"].filter((name) => !model.getObjectByName(name));
        if (missingPhoneNodes.length) {
            throw new Error(`mission_hub.glb missing required phone nodes: ${missingPhoneNodes.join(", ")}`);
        }
        debugLog("MissionHub GLB clone acquired", MODEL_URL);
    } catch (error) {
        if (scene.disposed) return;
        throw new Error(`mission_hub.glb failed to load from ${MODEL_URL}: ${error && error.message ? error.message : error}`);
    }
    scene.model = model;
    scene.modelShared = true; // a shared AssetCache clone: detach on unmount, never deep-dispose

    // ---- Glass screen (100% reflection at start) ----
    screenMesh.updateWorldMatrix(true, true);
    const sPos = new THREE.Vector3(); screenMesh.getWorldPosition(sPos);
    const sQuat = new THREE.Quaternion(); screenMesh.getWorldQuaternion(sQuat);
    const sNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(sQuat).normalize(); // screen top normal

    const glass = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0x04060a), metalness: 0.0, roughness: 0.045, ior: 1.5,
        clearcoat: 1.0, clearcoatRoughness: 0.04, reflectivity: 0.9,
        envMap: scene.envTex || null, envMapIntensity: 1.8,
        transparent: true, opacity: 1.0, depthWrite: false
    });
    applyMaterial(screenMesh, glass);
    screenMesh.renderOrder = 2;
    scene.glass = glass;

    // ---- Phone Depth Chamber (real GLB geometry; hidden until the descent) ----
    // The PHN_* nodes are the hidden depth chamber beneath the glass. In the room
    // overview they are INVISIBLE (no glow leak, no pillar, no portal plane). They are
    // revealed only once the camera starts descending THROUGH the screen.
    const chamber = [];
    ["PHN_Chamber", "PHN_Glow", "PHN_Specks"].forEach((n) => {
        const o = model.getObjectByName ? model.getObjectByName(n) : null;
        if (o) { o.visible = false; chamber.push(o); }
    });
    scene.chamber = chamber;
    debugLog("MissionHub depth chamber nodes", chamber.map((o) => o.name));

    // ---- Camera ----
    const camera = new THREE.PerspectiveCamera(lensToFov(CAM.wideLens), W() / H(), 0.01, 100);
    camera.position.fromArray(CAM.widePos);
    camera.lookAt(new THREE.Vector3().fromArray(CAM.wideLook));
    scene.camera = camera;

    // ---- Post-processing (bloom + filmic output) ----
    const composer = new EffectComposer(renderer);
    composer.setSize(W(), H());
    composer.addPass(new RenderPass(sceneGraph, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), LOOK.bloomStrength, LOOK.bloomRadius, LOOK.bloomThreshold);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    scene.composer = composer;

    // ---- Interaction ----
    const wideP = new THREE.Vector3().fromArray(CAM.widePos);
    const wideL = new THREE.Vector3().fromArray(CAM.wideLook);
    // Pre-bake the descent keyframes as Vector3s + FOVs (the single camera path).
    const path = CAM_PATH.map((k) => ({
        t: k.t,
        pos: new THREE.Vector3().fromArray(k.pos),
        look: new THREE.Vector3().fromArray(k.look),
        fov: lensToFov(k.lens)
    }));
    const anim = { phase: "idle", t: 0, p: 0, carded: false };

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const targets = [];
    ["PhoneScreen", "PhoneBody", "PhoneFrame"].forEach((n) => {
        const o = model.getObjectByName ? model.getObjectByName(n) : null;
        if (o) o.traverse((c) => { if (c.isMesh) targets.push(c); });
    });

    const overPhone = (ev) => {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
        ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
        raycaster.setFromCamera(ndc, camera);
        return raycaster.intersectObjects(targets, true).length > 0;
    };
    const startDescent = () => {
        if (anim.phase !== "idle") return;
        anim.phase = "descending"; anim.t = 0;
        // reveal the hidden depth chamber now that the camera is going IN
        (scene.chamber || []).forEach((o) => { o.visible = true; });
        if (ui.hint) ui.hint.textContent = "";
        setStatus("descending", "Entering the device…");
        debugLog("MissionHub descent start");
    };
    const onMove = (ev) => {
        if (anim.phase !== "idle") { renderer.domElement.style.cursor = "default"; return; }
        renderer.domElement.style.cursor = overPhone(ev) ? "pointer" : "default";
    };
    const onDown = (ev) => { if (anim.phase === "idle" && overPhone(ev)) startDescent(); };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    scene.disposers.push(() => {
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerdown", onDown);
    });

    setStatus("armed", "Click the phone to look closer…");

    // ---- Responsive ----
    const resize = () => {
        if (scene.disposed || !scene.renderer) return;
        const w = W(), h = H();
        renderer.setSize(w, h);
        composer.setSize(w, h);
        bloom.setSize(w, h);
        camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(stage); scene.resizeObserver = ro; resize();

    if (scene.disposed) return;

    // ---- Frame loop ----
    const clock = new THREE.Clock();
    const _off = new THREE.Vector3();
    const _pos = new THREE.Vector3();
    const _look = new THREE.Vector3();
    const fovWide = lensToFov(CAM.wideLens);

    // Sample the keyframe path at progress p (0..1): drives camera pos/look/fov.
    const samplePath = (p) => {
        let a = path[0], b = path[path.length - 1];
        for (let i = 0; i < path.length - 1; i++) {
            if (p >= path[i].t && p <= path[i + 1].t) { a = path[i]; b = path[i + 1]; break; }
        }
        const seg = smoothstep01((p - a.t) / Math.max(1e-5, b.t - a.t)); // ease each segment
        _pos.lerpVectors(a.pos, b.pos, seg);
        _look.lerpVectors(a.look, b.look, seg);
        camera.position.copy(_pos);
        camera.lookAt(_look);
        const fov = lerp(a.fov, b.fov, seg);
        if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    };

    const tick = (dt, time) => {
        if (anim.phase === "idle") {
            // gentle handheld bob over the room overview (desk + poster + phone)
            _off.set(Math.sin(time * 0.16) * 0.05, Math.cos(time * 0.13) * 0.025, Math.sin(time * 0.1) * 0.04);
            camera.position.copy(wideP).add(_off);
            camera.lookAt(wideL);
            if (camera.fov !== fovWide) { camera.fov = fovWide; camera.updateProjectionMatrix(); }
            if (glass) glass.envMapIntensity = 1.8 + Math.sin(time * 1.4) * 0.12;
            return;
        }
        if (anim.phase === "descending") {
            anim.t += dt / DESCENT_DURATION;
            const raw = clamp01(anim.t), p = smootherstep(raw); anim.p = p;
            samplePath(p);
            // the glass fades as the camera passes DOWN through the screen plane
            // (~p 0.50..0.64) so it sees INTO the dark chamber, not a reflection.
            if (glass) {
                const through = smoothstepRange(0.50, 0.64, p);
                glass.opacity = lerp(1.0, 0.0, through);
                glass.envMapIntensity = lerp(1.8, 0.05, through);
                glass.roughness = lerp(0.045, 0.18, through);
            }
            setStatus("descending", descentLabel(p));
            if (raw >= 1) anim.phase = "arrived";
            return;
        }
        if (anim.phase === "arrived") {
            samplePath(1); // hold at Phone_Depth_Target
            if (!anim.carded) {
                anim.carded = true;
                setStatus("arrived", "Bucky World · loading");
                debugLog("MissionHub arrived at Phone_Depth_Target");
                MissionWorldEntry.enterBuckyWorld(scene, { card: ui.card }); // Phase 4 handoff
            }
        }
    };

    renderer.setAnimationLoop(() => {
        if (scene.disposed) return;
        tick(clock.getDelta(), clock.elapsedTime);
        composer.render();
    });
    setStatus("armed", "Click the phone to look closer…");
    debugLog("MissionHub cinematic scene running");

    // v0.9 (Phase 4): begin background preload of Bucky World now, while the user
    // still looks at the room, so the descent → handoff has no fetch/parse hitch.
    MissionWorldEntry.schedulePreload(scene);
}

/**
 * MissionWorldEntry — Phase 4 PRELOAD + HANDOFF.
 *
 *     MissionHubRoom ──(click phone)──► descend through glass ──► Phone Depth Chamber
 *        ──(arrive Phone_Depth_Target)──► Bucky World
 *
 *   1. PRELOAD (schedulePreload / preloadMissionWorld) — while the room is idle, warm
 *      buckyworld.glb into the shared AssetCache (parse once) so the handoff is instant.
 *      Promise stored on `scene.worldPreload`. The room stays mounted + lit throughout.
 *   2. HANDOFF (enterBuckyWorld) — fired once when the camera reaches Phone_Depth_Target:
 *      clone the (already-parsed) world from the cache and drop it into the loading area
 *      to PROVE the transition works. No gameplay, no interactions — only the handoff.
 *
 * Contract preserved: this never touches the EventBus / mount-update-unmount / dispose
 * paths; the world is a shared cache clone (detached on unmount, never deep-disposed);
 * assets resolve via import.meta.url (GitHub-Pages-safe), exactly like the room GLB.
 */
const MissionWorldEntry = {
    // Phase 4 — background preload of Bucky World (idempotent; real, not inert).
    schedulePreload(scene) {
        if (!scene || scene.worldPreload !== undefined) return;
        scene.worldPreload = null;            // becomes the cache promise below
        try {
            const idle = (cb) => (typeof window !== "undefined" && window.requestIdleCallback
                ? window.requestIdleCallback(cb, { timeout: 1500 })
                : setTimeout(cb, 200));
            idle(() => {
                if (scene.disposed || scene.worldPreload) return;
                scene.worldPreload = preloadMissionWorld();  // warms buckyworld into the AssetCache
            });
        } catch (_e) { /* never block the room on preload */ }
    },
    // Phase 4 — fired once at Phone_Depth_Target. Clones the preloaded world + adds it.
    enterBuckyWorld(scene, ui) {
        if (!scene || scene.worldEntered) return;
        scene.worldEntered = true;            // fire-once guard
        const THREE = scene.THREE;
        Promise.resolve(scene.worldPreload || preloadMissionWorld())
            .then(() => assetCache.acquireScene("buckyworld"))
            .then((world) => {
                if (!world || scene.disposed || !scene.sceneGraph) {
                    debugLog("MissionHub: Bucky World unavailable for handoff");
                    return;
                }
                // place + scale the world into the loading area at Phone_Depth_Target
                const dt = new THREE.Vector3().fromArray(CAM.depthTarget);
                const box = new THREE.Box3().setFromObject(world);
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z) || 1;
                world.scale.setScalar(0.26 / maxDim);        // fit inside the chamber bottom
                world.position.set(dt.x, dt.y - 0.13, dt.z);  // centered just below the camera
                world.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; } });
                scene.sceneGraph.add(world);
                scene.world = world;                          // shared clone: detached (not freed) on unmount
                // a soft fill so the world reads inside the dark chamber
                const wl = new THREE.PointLight(0x9fd8ff, 6.0, 2.2, 2.0);
                wl.position.set(dt.x, dt.y + 0.16, dt.z);
                scene.sceneGraph.add(wl);
                scene.disposers.push(() => { try { scene.sceneGraph && scene.sceneGraph.remove(wl); } catch (_e) {} });
                if (ui && ui.card) { ui.card.classList.add("is-visible"); ui.card.setAttribute("aria-hidden", "false"); }
                debugLog("MissionHub → Bucky World handoff complete (world clone added at Depth_Target)");
            })
            .catch((e) => logError("MissionHub Bucky World handoff", e));
    }
};

/**
 * preloadMissionWorld() — the named Phase 4 hook for Bucky World. Delegates to the
 * shared AssetCache (parse-once). The GLB ships today, so this returns a real cache
 * promise resolving to a ready-to-clone world; enterBuckyWorld clones it with no
 * fetch + no re-parse. Exported so the boot/runtime can warm it on demand.
 */
export function preloadMissionWorld() {
    registerMissionHubAssets();
    return assetCache.preloadAsset("buckyworld");
}

// ---------------------------------------------------------------------------
// (v0.9 · Phase 4) The procedural GLSL "portal" was REMOVED. The phone is no
// longer a glowing plane on the screen — it is a real depth chamber (PHN_* GLB
// geometry) the camera physically descends INTO, ending at Phone_Depth_Target
// where Bucky World loads. No portal plane, no light beam, no pillar, no column.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// GLB byte-patcher: the Mission Hub Blender export carries a known orphan image
// (Map #97.001) and can reference a missing texture source. We strip those
// references from the GLB JSON chunk ONCE, before the AssetCache parse, so the
// cached scene + every clone is clean. Passed to assetCache as `transformBuffer`.
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

function lensToFov(lens) { return 2 * Math.atan(24 / (2 * lens)) * 180 / Math.PI; } // 36x24 full-frame, vertical
function applyMaterial(target, mat) {
    target.traverse((n) => {
        if (!n.isMesh) return;
        n.material = Array.isArray(n.material) ? n.material.map(() => mat) : mat;
    });
    if (target.isMesh) target.material = mat;
}
function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep01(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
function smootherstep(x) { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); }
function smoothstepRange(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
// Status line during the descent — names the Blender empties as they are passed.
function descentLabel(p) {
    if (p < 0.30) return "approaching the phone";
    if (p < 0.52) return "aligning above the screen";
    if (p < 0.64) return "Phone_Entry · through the glass";
    if (p < 0.86) return "Phone_Interior · descending";
    return "arriving at Phone_Depth_Target";
}

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------
function disposeScene(scene) {
    if (!scene || scene.disposed) { if (scene) scene.disposed = true; return; }
    scene.disposed = true;
    if (scene.renderer) { try { scene.renderer.setAnimationLoop(null); } catch (_) {} }
    (scene.disposers || []).forEach((fn) => { try { fn(); } catch (e) { logError("MissionHub disposer", e); } });
    scene.disposers = [];
    if (scene.resizeObserver) { try { scene.resizeObserver.disconnect(); } catch (_) {} scene.resizeObserver = null; }
    if (scene.composer) { try { scene.composer.dispose && scene.composer.dispose(); } catch (_) {} scene.composer = null; }

    // v0.8 (Phase 2 · Task 4): the room model is a SHARED AssetCache clone. DETACH
    // it but NEVER free its geometry/materials/textures here — they belong to the
    // cache and are reused by the next open (freed only on runtime.dispose). Only
    // the per-instance GPU resources this mount created are released: the glass
    // material (below), the portal (via disposers above), and the env/PMREM (below).
    if (scene.sceneGraph && scene.model) { try { scene.sceneGraph.remove(scene.model); } catch (_) {} }
    // Bucky World (if the handoff fired) is ALSO a shared AssetCache clone — detach it,
    // never deep-dispose it; its resources belong to the cache (freed on VM unload).
    if (scene.sceneGraph && scene.world) { try { scene.sceneGraph.remove(scene.world); } catch (_) {} }
    scene.world = null; scene.chamber = null;
    if (scene.glass) { try { scene.glass.dispose(); } catch (_) {} scene.glass = null; }
    scene.sceneGraph = null; // lights carry no GPU resources; the clones were detached above

    if (scene.envTex) { try { scene.envTex.dispose(); } catch (_) {} scene.envTex = null; }
    if (scene.bgTex) { try { scene.bgTex.dispose(); } catch (_) {} scene.bgTex = null; }   // v0.7 (V3): dusk-sky background texture
    if (scene.pmrem) { try { scene.pmrem.dispose(); } catch (_) {} scene.pmrem = null; }
    if (scene.renderer) {
        try {
            const canvas = scene.renderer.domElement;
            scene.renderer.dispose();
            if (typeof scene.renderer.forceContextLoss === "function") scene.renderer.forceContextLoss();
            if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        } catch (e) { logError("MissionHub disposeRenderer", e); }
        scene.renderer = null;
    }
    scene.model = null; scene.modelShared = false; scene.camera = null; scene.THREE = null;
}

// ---------------------------------------------------------------------------
// Helpers (markup + styles)
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
.vm-missionhub { position:relative; width:100%; height:100%; background:#07080b; overflow:hidden; }
.vm-missionhub-stage { position:absolute; inset:0; width:100%; height:100%; }
.vm-missionhub-canvas { display:block; width:100%; height:100%; }
.vm-missionhub-vignette { position:absolute; inset:0; pointer-events:none; z-index:1;
  background:radial-gradient(120% 120% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%); }
.vm-missionhub-portalcard { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  pointer-events:none; opacity:0; transition:opacity 1.2s ease; z-index:3; }
.vm-missionhub-portalcard.is-visible { opacity:1; }
.vm-missionhub-portalcard-inner { display:flex; flex-direction:column; align-items:center; gap:6px; text-align:center;
  padding:18px 34px; border-radius:16px;
  background:radial-gradient(120% 120% at 50% 30%, rgba(24,46,78,.34), rgba(5,9,18,0));
  font-family:"Segoe UI", system-ui, sans-serif; }
.vm-missionhub-card-kicker { font-size:11px; letter-spacing:5px; text-transform:uppercase; color:#9fd8ff; }
.vm-missionhub-card-title { font-size:30px; letter-spacing:7px; font-weight:600; color:#eaf6ff;
  text-shadow:0 0 26px rgba(120,200,255,.6); }
.vm-missionhub-card-sub { font-size:12px; letter-spacing:1px; color:rgba(220,235,255,.72); }
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
