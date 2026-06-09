/**
 * Mission Hub app — "Phone is a window into BuckyWorld" (Phase v0.12 · RTT viewport).
 *
 * WHAT THIS IS
 * -----------
 * A real smartphone lies on a dark-oak desk in a moody, HDRI-lit office. The phone
 * is NOT a tunnel, NOT a portal and NOT a shaft — it is a VIEWPORT. The screen is a
 * pane of dark glass, and BuckyWorld is rendered LIVE behind it from the very first
 * frame: you already see another world (sky, terrain, trees, a glowing spire) through
 * the glass before you ever click. Clicking dollies the camera toward the screen, the
 * glass reflections fade, the world view grows to fill the frame and you are inside —
 * no loading screen, no white flash, no chamber.
 *
 * BOTH WORLDS EXIST AT ONCE
 * -------------------------
 *   roomScene   = mission_hub.glb        (the apartment + desk + phone)
 *   worldScene  = buckyworld.glb         (a real test world: terrain/sky/trees/spire/core)
 * worldScene is rendered every frame into a WebGLRenderTarget; that texture IS the phone
 * screen's image (and, during the "enter", is composited fullscreen). The two scenes are
 * independent, so BuckyWorld keeps its own sky, scale, fog and lighting and can never
 * z-fight the room, flicker the chair, or wash the screen white. This replaces the old
 * "miniature in a depth chamber" approach; the PHN_Chamber/PHN_Glow/PHN_Specks shaft
 * geometry in the GLB is simply hidden at runtime (no GLB change required).
 *
 * STARTUP / NETWORK (proof: zero GLB downloads after boot)
 * -------------------------------------------------------
 * Both GLBs are parsed ONCE into the shared AssetCache at WEBSITE STARTUP
 * (vmRuntime.preloadMissionHub -> preloadMissionHubAssets + preloadMissionWorld). Three.js,
 * GLTF/Draco and the post-FX modules are warmed at boot too. Opening Mission Hub, clicking
 * the phone and entering the world therefore clone already-decoded scenes and issue NO new
 * downloads. The cache is freed only when the VM unloads (runtime.dispose).
 *
 * ARCHITECTURE (unchanged app contract — see docs/architecture/07-stable-systems.md)
 * ---------------------------------------------------------------------------------
 * Exports createState / render / mount / unmount (+ preloadMissionHubAssets /
 * preloadMissionWorld / disposeMissionHubAssets) registered in vmRuntime.js. The scene is
 * built imperatively once in `mount` and never rebuilt on resize/maximize. Three.js + post
 * FX load on demand from pinned CDNs (GitHub-Pages-safe, no build step). One ResizeObserver
 * handles all size changes. `unmount` performs deterministic teardown; AssetCache clones are
 * DETACHED (their shared geometry/materials/textures belong to the cache), while this mount's
 * own resources (render target, glass material, overlay, env/PMREM, renderer) are disposed.
 *
 * TUNING: the CONFIG block is the single place to adjust look, the camera path, the glass,
 * the transition timing and the BuckyWorld camera. Knobs flagged "live-tune" are the ones
 * to nudge in an in-browser pass (e.g. RT orientation/exposure, screen framing).
 */
import { debugLog, logError } from "../core/diagnostics.js";
// The hero GLBs are parsed ONCE into the shared AssetCache and cloned on each open
// (no re-download / re-parse / re-decode). See core/assetCache.js.
import { assetCache } from "../core/assetCache.js";

// ---------------------------------------------------------------------------
// CONFIG — the one place to tune the look
// ---------------------------------------------------------------------------
const THREE_VERSION = "0.160.0";
const CDN = `https://esm.sh/three@${THREE_VERSION}`;
const JSM = `${CDN}/examples/jsm`;

const MODEL_URL = new URL("../assets/models/mission_hub.glb", import.meta.url).href;
const HDRI_URL = new URL("../assets/hdri/dusk_sky_1k.hdr", import.meta.url).href;
// BUCKY WORLD — a real test world GLB (terrain/sky/trees/spire/core), parsed at boot into
// the AssetCache. Rendered LIVE behind the phone glass; never a sphere, never a placeholder.
const BUCKYWORLD_URL = new URL("../assets/models/buckyworld.glb", import.meta.url).href;

const STYLE_ELEMENT_ID = "vm-missionhub-styles";
const TRANSITION_DURATION = 4.5; // seconds, click -> fully inside BuckyWorld

// The phone screen plane in Three.js (Y-up) world space (phone rests ON the desk).
const SCREEN = [-0.12, 0.6688, -1.48];

// Render-target for the world-through-glass. Portrait, to match a phone screen.
// live-tune: flipY toggles RT vertical orientation if the world reads upside-down.
const RT = { w: 600, h: 1180, flipY: false };

// Room camera path (Y-up). The camera stays ABOVE the screen — it NEVER passes through the
// glass into a shaft. "Entering" is done by the world overlay + the BuckyWorld camera dolly.
const CAM_PATH = [
    { t: 0.00, pos: [1.10, 2.05, 0.55],  look: [-0.12, 0.63, -1.30], lens: 34 }, // room overview
    { t: 0.45, pos: [0.30, 1.30, -0.92], look: [-0.12, 0.66, -1.46], lens: 40 }, // approach the phone
    { t: 0.80, pos: [-0.12, 0.95, -1.48], look: SCREEN,              lens: 50 }, // straight above the glass
    { t: 1.00, pos: [-0.12, 0.80, -1.48], look: SCREEN,              lens: 62 }  // screen fills the frame
];
const GLASS_FADE = [0.45, 0.82]; // p-range over which the glass reflections fade out
const ENTER_RAMP = [0.78, 1.00]; // p-range over which the world overlay grows to fullscreen

// BuckyWorld camera (its OWN scene + scale). Frames a vista: terrain -> trees -> spire/core.
const WORLD_CAM = {
    fov: 55,
    idlePos: [0, 7, 40],  idleLook: [0, 20, -40],
    enterPos: [0, 12, 6], enterLook: [0, 28, -40] // dolly toward the spire/core as we 'enter'
};

// Room look (dusk apartment). Toned so nothing blows white; the phone reads as dark glass.
const LOOK = {
    exposure: 1.0, bloomStrength: 0.14, bloomRadius: 0.5, bloomThreshold: 0.95,
    envIntensity: 0.9, keyIntensity: 2.6, lampIntensity: 2.2, fillIntensity: 0.5, hemiIntensity: 0.40
};
// BuckyWorld look. The neon (sky/spire glow/core) is unlit in the GLB and self-illuminates;
// these lights shade the terrain/trees/spire body.
const WORLD_LOOK = { sun: 2.6, sunColor: 0xffe6c2, hemiSky: 0x6fd0ff, hemiGround: 0x101826, hemi: 0.8, ambient: 0.25 };
const WORLD_BG = 0x140a33; // deep indigo fallback behind the sky dome

// ---------------------------------------------------------------------------
// Asset cache wiring
// ---------------------------------------------------------------------------
// Both hero GLBs are registered with the shared AssetCache (parse-once -> clone-per-open) and
// warmed at WEBSITE STARTUP by vmRuntime.preloadMissionHub. After boot, opening the app and
// entering the world clone already-decoded scenes — zero GLB fetches/parses.
let _assetsRegistered = false;
function registerMissionHubAssets() {
    if (_assetsRegistered) return;
    _assetsRegistered = true;
    assetCache.registerAsset("mission_hub", MODEL_URL, {
        // The Mission Hub export carries a known orphan image (Map #97.001) and can reference
        // a missing texture source; strip those from the GLB bytes ONCE so the cached parse —
        // and every clone — is clean.
        transformBuffer(rawBuffer) {
            const { buffer, fixes } = patchMissingTextureSources(rawBuffer);
            if (fixes.length) debugLog("MissionHub ignored missing GLB texture references", fixes);
            return buffer;
        }
    });
    // BuckyWorld is a plain (un-Draco) GLB; parses with the same loader, no decoder needed.
    assetCache.registerAsset("buckyworld", BUCKYWORLD_URL, { available: true });
}

/**
 * preloadMissionHubAssets — kick off the parse-once warm of the room GLB. Called from the VM
 * boot sequence during idle so the first open clones an already-parsed scene with no pop-in.
 * Idempotent + best-effort; returns the cache promise.
 */
export function preloadMissionHubAssets() {
    registerMissionHubAssets();
    return assetCache.preloadAsset("mission_hub");
}

/**
 * preloadMissionWorld — the named hook that warms BuckyWorld into the AssetCache (parse-once).
 * Called at WEBSITE STARTUP (vmRuntime.preloadMissionHub) AND at scene build, so the world is
 * ready to clone with no fetch/parse when the screen first renders it. Returns the cache promise.
 */
export function preloadMissionWorld() {
    registerMissionHubAssets();
    return assetCache.preloadAsset("buckyworld");
}

/**
 * disposeMissionHubAssets — free the cached room GLB + BuckyWorld. Called ONLY when the VM
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
                    <span class="vm-missionhub-card-kicker">You're inside</span>
                    <span class="vm-missionhub-card-title">BUCKY WORLD</span>
                </div>
            </div>
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
    const card = element.querySelector("[data-missionhub-card]");
    const hint = element.querySelector("[data-missionhub-hint]");
    if (!stage) { logError("MissionHub mount", new Error("stage element missing")); return; }

    const scene = {
        disposed: false, THREE: null, renderer: null, composer: null, bloom: null,
        roomScene: null, roomCam: null, model: null, modelShared: false,
        worldScene: null, worldCam: null, worldRT: null, worldClone: null, worldSpin: [],
        overlayScene: null, overlayCam: null, overlayMesh: null, overlayMat: null,
        glass: null, envTex: null, bgTex: null, pmrem: null, resizeObserver: null, disposers: []
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
    // Warm BuckyWorld into the AssetCache NOW (parallel with the room GLB) so the clone is
    // ready when we mount it below. After boot this is a no-op (already parsed).
    try { preloadMissionWorld(); } catch (_e) { /* never block the room on preload */ }

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

    // black-screen guard: a lost WebGL context (GPU reset, iPad backgrounding) leaves a frozen
    // black canvas unless we preventDefault so the browser restores it. three re-inits on restore.
    const onCtxLost = (e) => { e.preventDefault(); debugLog("MissionHub WebGL context lost"); setStatus("paused", "Graphics paused — restoring…"); };
    const onCtxRestored = () => { debugLog("MissionHub WebGL context restored"); setStatus("armed", "Look into the phone…"); };
    renderer.domElement.addEventListener("webglcontextlost", onCtxLost, false);
    renderer.domElement.addEventListener("webglcontextrestored", onCtxRestored, false);
    scene.disposers.push(() => {
        renderer.domElement.removeEventListener("webglcontextlost", onCtxLost);
        renderer.domElement.removeEventListener("webglcontextrestored", onCtxRestored);
    });

    // ======================= ROOM SCENE =======================
    const roomScene = new THREE.Scene();
    roomScene.background = new THREE.Color(0x141019);
    roomScene.fog = new THREE.Fog(0x2b2533, 8.0, 165.0);
    scene.roomScene = roomScene;

    // ---- HDRI environment (room reflections + ambient) ----
    setStatus("loading", "Loading environment…");
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    scene.pmrem = pmrem;
    try {
        const hdr = await new Promise((res, rej) => new RGBELoader().load(HDRI_URL, res, undefined, rej));
        if (scene.disposed) { hdr.dispose(); return; }
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        const envTex = pmrem.fromEquirectangular(hdr).texture;
        roomScene.environment = envTex;
        if ("environmentIntensity" in roomScene) roomScene.environmentIntensity = LOOK.envIntensity;
        roomScene.background = hdr;
        if ("backgroundIntensity" in roomScene) roomScene.backgroundIntensity = 0.45;
        if ("backgroundBlurriness" in roomScene) roomScene.backgroundBlurriness = 0.0;
        scene.envTex = envTex;
        scene.bgTex = hdr;
    } catch (error) {
        // NEVER leave the scene without an environment (the classic "black room" failure).
        debugLog("MissionHub HDRI unavailable → procedural fallback env", error && error.message);
        try {
            const { RoomEnvironment } = await import(/* @vite-ignore */ `${JSM}/environments/RoomEnvironment.js`);
            if (scene.disposed) return;
            const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
            roomScene.environment = envTex;
            if ("environmentIntensity" in roomScene) roomScene.environmentIntensity = LOOK.envIntensity;
            scene.envTex = envTex;
        } catch (e2) {
            debugLog("MissionHub fallback env failed", e2 && e2.message);
        }
    }

    // ---- Room lights (reproduce the Blender key/lamp/fill a GLB can't carry) ----
    roomScene.add(new THREE.HemisphereLight(0x9fb6e0, 0x14110d, LOOK.hemiIntensity));
    const key = new THREE.DirectionalLight(0xffca7a, LOOK.keyIntensity);
    key.position.set(-0.5, 2.4, -3.4); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.radius = 5;
    { const c = key.shadow.camera; c.near = 0.5; c.far = 8; c.left = -2; c.right = 2; c.top = 2; c.bottom = -2; c.updateProjectionMatrix(); }
    key.target.position.set(-0.12, 0.78, -1.46);
    roomScene.add(key); roomScene.add(key.target);
    const lamp = new THREE.PointLight(0xffb060, LOOK.lampIntensity, 6, 2.0);
    lamp.position.set(0.45, 1.00, -1.78); lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.0006;
    roomScene.add(lamp);
    const fill = new THREE.DirectionalLight(0x9db4e8, LOOK.fillIntensity);
    fill.position.set(2.0, 1.4, 1.6); roomScene.add(fill);

    // ---- Room GLB (parse-once cache -> clone) ----
    setStatus("loading", "Loading scene…");
    registerMissionHubAssets();
    let model = null, screenMesh = null;
    try {
        model = await assetCache.acquireScene("mission_hub");
        if (scene.disposed) { model = null; return; }
        if (!model) throw new Error("AssetCache returned no scene (parse failed or asset unavailable)");
        model.traverse((n) => {
            if (!n.isMesh) return;
            const name = typeof n.name === "string" ? n.name : "";
            // Hide the legacy depth-shaft geometry entirely — the phone is a window now, not a tunnel.
            if (name.indexOf("PHN_") === 0) { n.visible = false; return; }
            const noShadow = name.indexOf("EXT_") === 0;
            n.castShadow = !noShadow; n.receiveShadow = !noShadow;
        });
        // Also hide the shaft empties / containers by name (harmless if they are not meshes).
        ["PHN_Chamber", "PHN_Glow", "PHN_Specks"].forEach((nm) => {
            const o = model.getObjectByName && model.getObjectByName(nm);
            if (o) o.visible = false;
        });
        roomScene.add(model);
        screenMesh = model.getObjectByName("PhoneScreen");
        const missing = ["PhoneBody", "PhoneFrame", "PhoneScreen"].filter((nm) => !model.getObjectByName(nm));
        if (missing.length) throw new Error(`mission_hub.glb missing required phone nodes: ${missing.join(", ")}`);
        debugLog("MissionHub GLB clone acquired", MODEL_URL);
    } catch (error) {
        if (scene.disposed) return;
        throw new Error(`mission_hub.glb failed to load from ${MODEL_URL}: ${error && error.message ? error.message : error}`);
    }
    scene.model = model;
    scene.modelShared = true; // shared AssetCache clone: detach on unmount, never deep-dispose

    // ======================= BUCKY WORLD SCENE (its own scale/sky/lighting) =======================
    const worldScene = new THREE.Scene();
    worldScene.background = new THREE.Color(WORLD_BG);
    worldScene.fog = new THREE.Fog(0x2a1550, 120, 760);
    scene.worldScene = worldScene;
    worldScene.add(new THREE.HemisphereLight(WORLD_LOOK.hemiSky, WORLD_LOOK.hemiGround, WORLD_LOOK.hemi));
    worldScene.add(new THREE.AmbientLight(0xffffff, WORLD_LOOK.ambient));
    const wsun = new THREE.DirectionalLight(WORLD_LOOK.sunColor, WORLD_LOOK.sun);
    wsun.position.set(40, 120, -140); worldScene.add(wsun);
    try {
        registerMissionHubAssets();
        const world = await assetCache.acquireScene("buckyworld");
        if (world && !scene.disposed) {
            world.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; } });
            worldScene.add(world);
            scene.worldClone = world;
            // Collect the neon parts so they breathe/spin while the world is alive in the glass.
            ["BuckyCore", "BuckyRing", "SpireGlow"].forEach((nm) => {
                const o = world.getObjectByName && world.getObjectByName(nm);
                if (o) scene.worldSpin.push(o);
            });
            debugLog("MissionHub BuckyWorld scene mounted");
        } else if (!world) {
            debugLog("MissionHub BuckyWorld unavailable — glass shows the indigo fallback sky");
        }
    } catch (e) { logError("MissionHub mount BuckyWorld", e); }
    if (scene.disposed) return;

    const worldCam = new THREE.PerspectiveCamera(WORLD_CAM.fov, RT.w / RT.h, 0.5, 2200);
    worldCam.position.fromArray(WORLD_CAM.idlePos);
    worldCam.lookAt(new THREE.Vector3().fromArray(WORLD_CAM.idleLook));
    scene.worldCam = worldCam;

    const worldRT = new THREE.WebGLRenderTarget(RT.w, RT.h, { samples: 4 });
    worldRT.texture.colorSpace = THREE.SRGBColorSpace;
    worldRT.texture.flipY = RT.flipY; // live-tune
    scene.worldRT = worldRT;

    // ---- Glass screen: dark glass that SHOWS BuckyWorld and reflects the room ----
    // The world image is the emissive (so it "lights up" like a display regardless of the dim
    // room); the diffuse is near-black; a clearcoat + env reflection layer reads as glass and
    // FADES OUT on approach so the world view is clean by the time the screen fills the frame.
    screenMesh.updateWorldMatrix(true, true);
    const glass = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0x05070c),
        emissive: new THREE.Color(0xffffff), emissiveMap: worldRT.texture, emissiveIntensity: 1.0,
        metalness: 0.0, roughness: 0.18, ior: 1.45,
        clearcoat: 0.6, clearcoatRoughness: 0.18, reflectivity: 0.3,
        envMap: scene.envTex || null, envMapIntensity: 0.9
    });
    glass.toneMapped = true;
    applyMaterial(screenMesh, glass);
    screenMesh.renderOrder = 3;
    scene.glass = glass;

    // ---- Fullscreen world overlay (the "enter": world view grows to fill the canvas) ----
    // A clip-space quad textured with the SAME worldRT. Its UVs are recomputed on resize to
    // "cover" the canvas with the portrait RT (no distortion), so fading it in reads as the
    // screen's content taking over the whole view. Opacity is driven by anim.enter.
    const overlayScene = new THREE.Scene();
    const overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    const overlayGeo = new THREE.PlaneGeometry(2, 2);
    const overlayMat = new THREE.MeshBasicMaterial({ map: worldRT.texture, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    overlayMat.toneMapped = true;
    const overlayMesh = new THREE.Mesh(overlayGeo, overlayMat);
    overlayMesh.position.z = -1; overlayMesh.frustumCulled = false;
    overlayScene.add(overlayMesh);
    scene.overlayScene = overlayScene; scene.overlayCam = overlayCam;
    scene.overlayMesh = overlayMesh; scene.overlayMat = overlayMat;

    // ---- Room camera ----
    const camera = new THREE.PerspectiveCamera(lensToFov(CAM_PATH[0].lens), W() / H(), 0.01, 100);
    camera.position.fromArray(CAM_PATH[0].pos);
    camera.lookAt(new THREE.Vector3().fromArray(CAM_PATH[0].look));
    scene.roomCam = camera;

    // ---- Post-processing (bloom + filmic output) on the ROOM ----
    const composer = new EffectComposer(renderer);
    composer.setSize(W(), H());
    composer.addPass(new RenderPass(roomScene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), LOOK.bloomStrength, LOOK.bloomRadius, LOOK.bloomThreshold);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    scene.composer = composer; scene.bloom = bloom;

    // ---- Interaction ----
    const wideP = new THREE.Vector3().fromArray(CAM_PATH[0].pos);
    const wideL = new THREE.Vector3().fromArray(CAM_PATH[0].look);
    const path = CAM_PATH.map((k) => ({
        t: k.t, pos: new THREE.Vector3().fromArray(k.pos), look: new THREE.Vector3().fromArray(k.look), fov: lensToFov(k.lens)
    }));
    const anim = { phase: "idle", t: 0, p: 0, enter: 0, carded: false };

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const targets = [];
    ["PhoneScreen", "PhoneBody", "PhoneFrame"].forEach((nm) => {
        const o = model.getObjectByName ? model.getObjectByName(nm) : null;
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
        setStatus("entering", "Entering BuckyWorld…");
        debugLog("MissionHub enter start");
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
    const updateOverlayUVs = () => {
        // "cover": fill the canvas with the portrait RT, cropping the long axis, no distortion.
        const texA = RT.w / RT.h, viewA = W() / H();
        let ru = 1, rv = 1, ou = 0, ov = 0;
        if (viewA > texA) { rv = texA / viewA; ov = (1 - rv) / 2; } // canvas wider -> crop height
        else { ru = viewA / texA; ou = (1 - ru) / 2; }              // canvas taller -> crop width
        const uv = overlayGeo.attributes.uv;
        // PlaneGeometry uv corner order: (0,1)(1,1)(0,0)(1,0)
        const corners = [[0, 1], [1, 1], [0, 0], [1, 0]];
        for (let i = 0; i < 4; i++) { uv.setXY(i, ou + corners[i][0] * ru, ov + corners[i][1] * rv); }
        uv.needsUpdate = true;
    };
    const resize = () => {
        if (scene.disposed || !scene.renderer) return;
        const w = W(), h = H();
        renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
        camera.aspect = w / h; camera.updateProjectionMatrix();
        updateOverlayUVs();
    };
    const ro = new ResizeObserver(resize); ro.observe(stage); scene.resizeObserver = ro; resize();
    if (scene.disposed) return;

    // ---- Debug hook (used by the in-browser validation pass) ----
    if (typeof window !== "undefined") {
        window.__missionHubDebug = () => {
            const bounds = (nm) => {
                const o = model.getObjectByName && model.getObjectByName(nm);
                if (!o) return null;
                const b = new THREE.Box3().setFromObject(o);
                return { min: b.min.toArray().map((v) => +v.toFixed(4)), max: b.max.toArray().map((v) => +v.toFixed(4)) };
            };
            const phone = bounds("PhoneBody"), desk = bounds("Wooden modern Desk") || bounds("P_desk");
            const gap = (phone && desk) ? +(phone.min[1] - desk.max[1]).toFixed(4) : null;
            return {
                phaseEnter: anim.enter, phase: anim.phase,
                phoneBottomY: phone ? phone.min[1] : null,
                deskTopY: desk ? desk.max[1] : null,
                phoneRestsOnDesk: gap, // ~0 means resting; >0 floating; <0 sunk
                screen: bounds("PhoneScreen"),
                shaftHidden: !((model.getObjectByName("PHN_Chamber") || {}).visible),
                worldNodes: scene.worldClone ? scene.worldClone.children.map((c) => c.name) : []
            };
        };
        scene.disposers.push(() => { try { delete window.__missionHubDebug; } catch (_e) {} });
    }

    // ---- Frame loop ----
    const clock = new THREE.Clock();
    const _off = new THREE.Vector3();
    const _pos = new THREE.Vector3();
    const _look = new THREE.Vector3();
    const _wp = new THREE.Vector3();
    const _wl = new THREE.Vector3();
    const fovWide = lensToFov(CAM_PATH[0].lens);

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

    // Keep BuckyWorld alive (and dolly its camera in as we enter).
    const updateWorld = (time, enter) => {
        for (const o of scene.worldSpin) { o.rotation.y = time * 0.25; }
        const e = enter * enter; // ease the dolly
        _wp.set(lerp(WORLD_CAM.idlePos[0], WORLD_CAM.enterPos[0], e),
                lerp(WORLD_CAM.idlePos[1], WORLD_CAM.enterPos[1], e),
                lerp(WORLD_CAM.idlePos[2], WORLD_CAM.enterPos[2], e));
        _wl.set(lerp(WORLD_CAM.idleLook[0], WORLD_CAM.enterLook[0], e),
                lerp(WORLD_CAM.idleLook[1], WORLD_CAM.enterLook[1], e),
                lerp(WORLD_CAM.idleLook[2], WORLD_CAM.enterLook[2], e));
        // gentle idle breathing so the world feels alive through the glass
        _wp.x += Math.sin(time * 0.18) * 0.6 * (1 - e);
        _wp.y += Math.cos(time * 0.15) * 0.3 * (1 - e);
        worldCam.position.copy(_wp);
        worldCam.lookAt(_wl);
    };

    const tick = (dt, time) => {
        if (anim.phase === "idle") {
            _off.set(Math.sin(time * 0.16) * 0.05, Math.cos(time * 0.13) * 0.025, Math.sin(time * 0.1) * 0.04);
            camera.position.copy(wideP).add(_off);
            camera.lookAt(wideL);
            if (camera.fov !== fovWide) { camera.fov = fovWide; camera.updateProjectionMatrix(); }
            if (glass) glass.envMapIntensity = 0.9 + Math.sin(time * 1.2) * 0.05;
            anim.enter = 0;
            return;
        }
        if (anim.phase === "entering") {
            anim.t += dt / TRANSITION_DURATION;
            const raw = clamp01(anim.t), p = smootherstep(raw); anim.p = p;
            samplePath(p);
            if (glass) {
                const fade = 1 - smoothstepRange(GLASS_FADE[0], GLASS_FADE[1], p);
                glass.envMapIntensity = 0.9 * fade;
                glass.clearcoat = 0.6 * fade;
            }
            anim.enter = smoothstepRange(ENTER_RAMP[0], ENTER_RAMP[1], p);
            setStatus("entering", enterLabel(p));
            if (raw >= 1) anim.phase = "arrived";
            return;
        }
        if (anim.phase === "arrived") {
            samplePath(1);
            anim.enter = 1;
            if (glass) { glass.envMapIntensity = 0; glass.clearcoat = 0; }
            if (!anim.carded) {
                anim.carded = true;
                if (ui.card) { ui.card.classList.add("is-visible"); ui.card.setAttribute("aria-hidden", "false"); }
                setStatus("arrived", "BuckyWorld");
                debugLog("MissionHub inside BuckyWorld");
            }
        }
    };

    renderer.setAnimationLoop(() => {
        if (scene.disposed) return;
        const dt = clock.getDelta(), time = clock.elapsedTime;
        // 1) render BuckyWorld into the render target (its texture is the phone screen image)
        updateWorld(time, anim.enter);
        renderer.setRenderTarget(worldRT);
        renderer.clear();
        renderer.render(worldScene, worldCam);
        renderer.setRenderTarget(null);
        // 2) advance the room camera / glass / enter ramp, then render the room (+ bloom)
        tick(dt, time);
        composer.render();
        // 3) composite the growing fullscreen world view over the room during the enter
        if (anim.enter > 0.0005) {
            overlayMat.opacity = anim.enter;
            renderer.autoClear = false;
            renderer.clearDepth();
            renderer.render(overlayScene, overlayCam);
            renderer.autoClear = true;
        }
    });
    setStatus("armed", "Look into the phone…");
    debugLog("MissionHub viewport scene running");
}

// ---------------------------------------------------------------------------
// Helpers — GLB byte-patcher (room GLB only): strip a known orphan image / missing
// texture source from the JSON chunk ONCE before the AssetCache parse.
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
// Helpers — math + material
// ---------------------------------------------------------------------------
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
function enterLabel(p) {
    if (p < 0.45) return "approaching the phone";
    if (p < 0.80) return "looking into the glass";
    if (p < 1.0) return "the world fills the view";
    return "BuckyWorld";
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

    // AssetCache clones (room model + world) are SHARED — detach, never deep-dispose; their
    // geometry/materials/textures belong to the cache and are reused by the next open.
    if (scene.roomScene && scene.model) { try { scene.roomScene.remove(scene.model); } catch (_) {} }
    if (scene.worldScene && scene.worldClone) { try { scene.worldScene.remove(scene.worldClone); } catch (_) {} }
    scene.model = null; scene.worldClone = null; scene.worldSpin = [];

    // This mount's OWN GPU resources are released here.
    if (scene.glass) { try { scene.glass.dispose(); } catch (_) {} scene.glass = null; }
    if (scene.overlayMesh) { try { scene.overlayMesh.geometry.dispose(); } catch (_) {} scene.overlayMesh = null; }
    if (scene.overlayMat) { try { scene.overlayMat.dispose(); } catch (_) {} scene.overlayMat = null; }
    if (scene.worldRT) { try { scene.worldRT.dispose(); } catch (_) {} scene.worldRT = null; }
    if (scene.envTex) { try { scene.envTex.dispose(); } catch (_) {} scene.envTex = null; }
    if (scene.bgTex) { try { scene.bgTex.dispose(); } catch (_) {} scene.bgTex = null; }
    if (scene.pmrem) { try { scene.pmrem.dispose(); } catch (_) {} scene.pmrem = null; }
    scene.roomScene = null; scene.worldScene = null; scene.overlayScene = null;

    if (scene.renderer) {
        try {
            const canvas = scene.renderer.domElement;
            scene.renderer.dispose();
            if (typeof scene.renderer.forceContextLoss === "function") scene.renderer.forceContextLoss();
            if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        } catch (e) { logError("MissionHub disposeRenderer", e); }
        scene.renderer = null;
    }
    scene.roomCam = null; scene.worldCam = null; scene.overlayCam = null; scene.bloom = null; scene.THREE = null;
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
