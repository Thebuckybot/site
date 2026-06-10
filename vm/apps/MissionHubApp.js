/**
 * Mission Hub app — "One GLB. One Scene. One Camera." (Phase V4 · single-world).
 *
 * WHAT THIS IS
 * -----------
 * A real smartphone lies on a dark-oak desk in a moody, HDRI-lit office. Below the
 * phone glass, INSIDE THE SAME GLB, sits the Arc1 miniature world (terrain, trees,
 * spire, gate, sky) parented under ARC1_Root at Blender-authored scale. The phone
 * screen is a pane of real glass geometry (PhoneGlass): dark and reflective from
 * across the room, with Arc1 already visible through it from frame 1. Clicking the
 * phone moves THE camera — the only camera — down through the glass, through the
 * phone throat, and into the Arc1 world. The world grows naturally through
 * perspective. No portal, no overlay, no render target, no scene swap, no loading.
 *
 * BLENDER IS THE SOURCE OF TRUTH
 * ------------------------------
 * mission_hub.glb (exported from mission_hub_v2.blend) carries the room, the phone,
 * the Arc1 prototype AND the camera-path anchors as empties:
 *   Phone_Entry        — hover point just above the glass
 *   Phone_Interior     — inside the phone throat
 *   Phone_Depth_Target — deep position at Arc1 level
 *   Arc1_Arrival_Look  — what the camera looks at on arrival
 * The runtime reads these nodes BY NAME at mount and builds the camera path from
 * their world transforms. No world-space coordinates are hardcoded here; only
 * relative offsets (room-overview framing) and timing/lens values are tuned below.
 *
 * STARTUP / NETWORK (proof: zero GLB downloads after boot)
 * -------------------------------------------------------
 * The single GLB is parsed ONCE into the shared AssetCache at WEBSITE STARTUP
 * (vmRuntime.preloadMissionHub -> preloadMissionHubAssets). Three.js, GLTF/Draco and
 * the post-FX modules are warmed at boot too. Opening Mission Hub clones the
 * already-decoded scene and issues NO new downloads. The cache is freed only when
 * the VM unloads (runtime.dispose).
 *
 * ARCHITECTURE (unchanged app contract — see docs/architecture/07-stable-systems.md)
 * ---------------------------------------------------------------------------------
 * Exports createState / render / mount / unmount (+ preloadMissionHubAssets /
 * disposeMissionHubAssets) registered in vmRuntime.js. The scene is built
 * imperatively once in `mount` and never rebuilt on resize/maximize. Three.js + post
 * FX load on demand from pinned CDNs (GitHub-Pages-safe, no build step). One
 * ResizeObserver handles all size changes. `unmount` performs deterministic teardown;
 * the AssetCache clone is DETACHED (its shared geometry/materials/textures belong to
 * the cache), while this mount's own resources (glass material, env/PMREM, renderer)
 * are disposed.
 *
 * TUNING: the CONFIG block is the single place to adjust look, journey timing, the
 * glass response and the keyframe lens values.
 */
import { debugLog, logError } from "../core/diagnostics.js";
// The hero GLB is parsed ONCE into the shared AssetCache and cloned on each open
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

const STYLE_ELEMENT_ID = "vm-missionhub-styles";
const TRANSITION_DURATION = 6.0; // seconds, click -> arrived at Arc1

// Blender-authored node names (the GLB is the source of truth — verified against the
// actual export; mount() re-verifies and fails loudly if any anchor is missing).
const NODE = {
    glass: "PhoneGlass",
    frame: "PhoneFrame",
    lip: "PhoneInteriorLip",
    entry: "Phone_Entry",
    interior: "Phone_Interior",
    depth: "Phone_Depth_Target",
    arrival: "Arc1_Arrival_Look",
    arcRoot: "ARC1_Root",
    phoneRig: "P_phone"
};
// Required at mount — a missing node is a hard, named error (never a silent guess).
const REQUIRED_NODES = [NODE.glass, NODE.frame, NODE.entry, NODE.interior, NODE.depth, NODE.arrival, NODE.arcRoot];
// Arc1 neon that slowly spins so the world feels alive through the glass.
const SPIN_NODES = ["BuckyCore", "BuckyRing", "SpireGlow"];

// Journey shape (RELATIVE framing only — every anchor position comes from the GLB).
// overviewOffset: room-overview camera placement relative to the phone-glass centre.
// hoverLift/hoverBack: phone-focus framing relative to Phone_Entry.
const JOURNEY = {
    overviewOffset: [1.22, 1.38, 2.03],
    hoverLift: 0.45,
    hoverBack: 0.35,
    // timing (t) + lens (mm, full-frame vertical) per keyframe; positions/looks are
    // resolved from the Blender anchors at mount.
    keys: [
        { t: 0.00, lens: 34 }, // room overview            (look: glass)
        { t: 0.32, lens: 42 }, // phone focus              (look: glass)
        { t: 0.52, lens: 50 }, // at Phone_Entry           (look: Phone_Interior)
        { t: 0.68, lens: 55 }, // through the glass        (look: Phone_Depth_Target)
        { t: 0.84, lens: 58 }, // at Phone_Interior        (look: Phone_Depth_Target)
        { t: 1.00, lens: 46 }  // at Phone_Depth_Target    (look: Arc1_Arrival_Look)
    ]
};

// Glass response (PhoneGlass is REAL geometry — a window, not a display).
// Dark + reflective from the room; reflection AND tint fade out across GLASS_FADE so
// the pane is fully clear (and harmless to pass through) before the camera crosses it.
const GLASS = {
    color: 0x0a1018,        // deep cold tint — never white
    idleOpacity: 0.55,      // dark from a distance, Arc1 still readable below
    idleEnv: 1.15,          // room-level reflectivity
    roughness: 0.08,
    fade: [0.30, 0.60]      // p-range over which reflection + tint fade to zero
};

// Room look (dusk apartment). Toned so nothing blows white; the phone reads as dark glass.
const LOOK = {
    exposure: 1.0, bloomStrength: 0.14, bloomRadius: 0.5, bloomThreshold: 0.95,
    envIntensity: 0.9, keyIntensity: 2.6, lampIntensity: 2.2, fillIntensity: 0.5, hemiIntensity: 0.40
};

// ---------------------------------------------------------------------------
// Asset cache wiring
// ---------------------------------------------------------------------------
// The single hero GLB is registered with the shared AssetCache (parse-once ->
// clone-per-open) and warmed at WEBSITE STARTUP by vmRuntime.preloadMissionHub.
let _assetsRegistered = false;
function registerMissionHubAssets() {
    if (_assetsRegistered) return;
    _assetsRegistered = true;
    assetCache.registerAsset("mission_hub", MODEL_URL, {
        // Defensive: strip any orphan image / missing texture source from the GLB
        // bytes ONCE so the cached parse — and every clone — is clean.
        transformBuffer(rawBuffer) {
            const { buffer, fixes } = patchMissingTextureSources(rawBuffer);
            if (fixes.length) debugLog("MissionHub ignored missing GLB texture references", fixes);
            return buffer;
        }
    });
}

/**
 * preloadMissionHubAssets — kick off the parse-once warm of the hub GLB. Called from
 * the VM boot sequence so the first open clones an already-parsed scene with no
 * pop-in and no network. Idempotent + best-effort; returns the cache promise.
 */
export function preloadMissionHubAssets() {
    registerMissionHubAssets();
    return assetCache.preloadAsset("mission_hub");
}

/**
 * disposeMissionHubAssets — free the cached hub GLB. Called ONLY when the VM fully
 * unloads (runtime.dispose). App open/close never touches the cache.
 */
export function disposeMissionHubAssets() {
    assetCache.disposeAsset("mission_hub");
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
            <div class="vm-missionhub-arrivalcard" data-missionhub-card aria-hidden="true">
                <div class="vm-missionhub-arrivalcard-inner">
                    <span class="vm-missionhub-card-kicker">You've arrived</span>
                    <span class="vm-missionhub-card-title">ARC 1</span>
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
        glass: null, spin: [], envTex: null, bgTex: null, pmrem: null,
        resizeObserver: null, disposers: []
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

    // ======================= THE ONE SCENE =======================
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
    // Arc1 ships its OWN lights inside the GLB (ARC1_KeyLight / ARC1_FillLight via
    // KHR_lights_punctual) plus unlit neon; these lights shade the room only.
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

    // ---- The GLB (parse-once cache -> clone). Room + phone + Arc1, one file. ----
    setStatus("loading", "Loading scene…");
    registerMissionHubAssets();
    let model = null;
    try {
        model = await assetCache.acquireScene("mission_hub");
        if (scene.disposed) { model = null; return; }
        if (!model) throw new Error("AssetCache returned no scene (parse failed or asset unavailable)");

        // HIERARCHY VERIFICATION — every Blender anchor must exist, by exact name.
        const missing = REQUIRED_NODES.filter((nm) => !model.getObjectByName(nm));
        if (missing.length) throw new Error(`mission_hub.glb missing required nodes: ${missing.join(", ")}`);

        const arcRoot = model.getObjectByName(NODE.arcRoot);
        model.traverse((n) => {
            if (!n.isMesh) return;
            const name = typeof n.name === "string" ? n.name : "";
            const noShadow = name.indexOf("EXT_") === 0;
            n.castShadow = !noShadow; n.receiveShadow = !noShadow;
        });
        // The Arc1 miniature never participates in room shadow maps (perf: the whole
        // sub-world stays out of the shadow pass; it lights itself).
        arcRoot.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; } });

        roomScene.add(model);
        debugLog("MissionHub GLB clone acquired", MODEL_URL);
    } catch (error) {
        if (scene.disposed) return;
        throw new Error(`mission_hub.glb failed to load from ${MODEL_URL}: ${error && error.message ? error.message : error}`);
    }
    scene.model = model;
    scene.modelShared = true; // shared AssetCache clone: detach on unmount, never deep-dispose

    // ---- Resolve the Blender anchors (world space, post-add) ----
    model.updateWorldMatrix(true, true);
    const worldPosOf = (nm) => {
        const o = model.getObjectByName(nm);
        const v = new THREE.Vector3();
        o.getWorldPosition(v);
        return v;
    };
    const glassMesh = model.getObjectByName(NODE.glass);
    const glassCenter = new THREE.Box3().setFromObject(glassMesh).getCenter(new THREE.Vector3());
    const pEntry = worldPosOf(NODE.entry);
    const pInterior = worldPosOf(NODE.interior);
    const pDepth = worldPosOf(NODE.depth);
    const pArrival = worldPosOf(NODE.arrival);

    // Spin targets (Arc1 neon) — optional, never required.
    SPIN_NODES.forEach((nm) => {
        const o = model.getObjectByName(nm);
        if (o) scene.spin.push(o);
    });

    // ---- Glass: a real window into Arc1 (this mount's OWN material — the cached
    // clone's shared transmission material is replaced, never mutated) ----
    const glass = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(GLASS.color),
        metalness: 0.0, roughness: GLASS.roughness, ior: 1.45,
        transparent: true, opacity: GLASS.idleOpacity, depthWrite: false,
        side: THREE.DoubleSide,
        clearcoat: 0.6, clearcoatRoughness: 0.12,
        envMap: scene.envTex || null, envMapIntensity: GLASS.idleEnv
    });
    glass.toneMapped = true;
    applyMaterial(glassMesh, glass);
    glassMesh.castShadow = false;
    glassMesh.renderOrder = 3;
    scene.glass = glass;

    // ---- Camera path — built ENTIRELY from the Blender anchors above ----
    const horizBack = new THREE.Vector3(JOURNEY.overviewOffset[0], 0, JOURNEY.overviewOffset[2]).normalize();
    const positions = [
        glassCenter.clone().add(new THREE.Vector3().fromArray(JOURNEY.overviewOffset)),       // overview (relative framing)
        pEntry.clone().addScaledVector(horizBack, JOURNEY.hoverBack).add(new THREE.Vector3(0, JOURNEY.hoverLift, 0)), // phone focus
        pEntry.clone(),                                                                       // at Phone_Entry
        pEntry.clone().lerp(pInterior, 0.5),                                                  // through the glass
        pInterior.clone(),                                                                    // at Phone_Interior
        pDepth.clone()                                                                        // at Phone_Depth_Target
    ];
    const looks = [
        glassCenter.clone(),  // overview
        glassCenter.clone(),  // phone focus
        pInterior.clone(),    // at entry: look down the throat
        pDepth.clone(),       // through glass: look at depth
        pDepth.clone(),       // interior: still at depth
        pArrival.clone()      // arrival: Arc1_Arrival_Look
    ];
    const path = JOURNEY.keys.map((k, i) => ({ t: k.t, pos: positions[i], look: looks[i], fov: lensToFov(k.lens) }));

    // ---- The ONE camera ----
    // near is tight (0.008) because the journey ends inside the Arc1 miniature
    // (Blender scale 0.0046); far covers the apartment exterior + Arc1 sky dome.
    const camera = new THREE.PerspectiveCamera(path[0].fov, W() / H(), 0.008, 120);
    camera.position.copy(path[0].pos);
    camera.lookAt(path[0].look);
    scene.roomCam = camera;

    // ---- Post-processing (bloom + filmic output) — ONE render pass ----
    const composer = new EffectComposer(renderer);
    composer.setSize(W(), H());
    composer.addPass(new RenderPass(roomScene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), LOOK.bloomStrength, LOOK.bloomRadius, LOOK.bloomThreshold);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    scene.composer = composer; scene.bloom = bloom;

    // ---- Interaction ----
    const wideP = path[0].pos.clone();
    const wideL = path[0].look.clone();
    const anim = { phase: "idle", t: 0, p: 0, carded: false };

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const targets = [];
    [NODE.glass, NODE.frame, NODE.lip].forEach((nm) => {
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
        setStatus("entering", "Descending into Arc 1…");
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
    const resize = () => {
        if (scene.disposed || !scene.renderer) return;
        const w = W(), h = H();
        renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
        camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(stage); scene.resizeObserver = ro; resize();
    if (scene.disposed) return;

    // ---- Debug hook (used by the in-browser validation pass) ----
    if (typeof window !== "undefined") {
        window.__missionHubDebug = () => {
            const v3 = (v) => v.toArray().map((x) => +x.toFixed(4));
            return {
                phase: anim.phase, p: anim.p,
                anchors: {
                    entry: v3(pEntry), interior: v3(pInterior),
                    depth: v3(pDepth), arrival: v3(pArrival), glass: v3(glassCenter)
                },
                glassOpacity: glass.opacity, glassEnv: glass.envMapIntensity,
                arcRootPresent: !!model.getObjectByName(NODE.arcRoot),
                requiredNodes: REQUIRED_NODES.map((nm) => ({ name: nm, found: !!model.getObjectByName(nm) })),
                camera: { pos: v3(camera.position), fov: +camera.fov.toFixed(2) }
            };
        };
        scene.disposers.push(() => { try { delete window.__missionHubDebug; } catch (_e) {} });
    }

    // ---- Frame loop — ONE scene, ONE camera, ONE render ----
    const clock = new THREE.Clock();
    const _off = new THREE.Vector3();
    const _pos = new THREE.Vector3();
    const _look = new THREE.Vector3();
    const fovWide = path[0].fov;

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
        // Arc1 neon breathes whether you're in the room or inside the world.
        for (const o of scene.spin) { o.rotation.y = time * 0.25; }

        if (anim.phase === "idle") {
            _off.set(Math.sin(time * 0.16) * 0.05, Math.cos(time * 0.13) * 0.025, Math.sin(time * 0.1) * 0.04);
            camera.position.copy(wideP).add(_off);
            camera.lookAt(wideL);
            if (camera.fov !== fovWide) { camera.fov = fovWide; camera.updateProjectionMatrix(); }
            glass.envMapIntensity = GLASS.idleEnv + Math.sin(time * 1.2) * 0.05;
            return;
        }
        if (anim.phase === "entering") {
            anim.t += dt / TRANSITION_DURATION;
            const raw = clamp01(anim.t), p = smootherstep(raw); anim.p = p;
            samplePath(p);
            // Reflection + tint fade BEFORE the camera crosses the pane (no white
            // screen, no clipped-plane artifact — the glass is air by then).
            const fade = 1 - smoothstepRange(GLASS.fade[0], GLASS.fade[1], p);
            glass.envMapIntensity = GLASS.idleEnv * fade;
            glass.clearcoat = 0.6 * fade;
            glass.opacity = GLASS.idleOpacity * fade;
            setStatus("entering", enterLabel(p));
            if (raw >= 1) anim.phase = "arrived";
            return;
        }
        if (anim.phase === "arrived") {
            samplePath(1);
            glass.envMapIntensity = 0; glass.clearcoat = 0; glass.opacity = 0;
            if (!anim.carded) {
                anim.carded = true;
                if (ui.card) { ui.card.classList.add("is-visible"); ui.card.setAttribute("aria-hidden", "false"); }
                setStatus("arrived", "Arc 1");
                debugLog("MissionHub arrived at Arc 1");
            }
        }
    };

    renderer.setAnimationLoop(() => {
        if (scene.disposed) return;
        const dt = clock.getDelta(), time = clock.elapsedTime;
        tick(dt, time);
        composer.render();
    });
    setStatus("armed", "Look into the phone…");
    debugLog("MissionHub single-world scene running");
}

// ---------------------------------------------------------------------------
// Helpers — GLB byte-patcher: strip a known orphan image / missing texture source
// from the JSON chunk ONCE before the AssetCache parse.
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
    if (p < 0.32) return "approaching the phone";
    if (p < 0.60) return "looking into the glass";
    if (p < 0.84) return "passing through";
    if (p < 1.0) return "descending into Arc 1";
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
    if (scene.roomScene && scene.model) { try { scene.roomScene.remove(scene.model); } catch (_) {} }
    scene.model = null; scene.spin = [];

    // This mount's OWN GPU resources are released here.
    if (scene.glass) { try { scene.glass.dispose(); } catch (_) {} scene.glass = null; }
    if (scene.envTex) { try { scene.envTex.dispose(); } catch (_) {} scene.envTex = null; }
    if (scene.bgTex) { try { scene.bgTex.dispose(); } catch (_) {} scene.bgTex = null; }
    if (scene.pmrem) { try { scene.pmrem.dispose(); } catch (_) {} scene.pmrem = null; }
    scene.roomScene = null;

    if (scene.renderer) {
        try {
            const canvas = scene.renderer.domElement;
            scene.renderer.dispose();
            if (typeof scene.renderer.forceContextLoss === "function") scene.renderer.forceContextLoss();
            if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        } catch (e) { logError("MissionHub disposeRenderer", e); }
        scene.renderer = null;
    }
    scene.roomCam = null; scene.bloom = null; scene.THREE = null;
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
.vm-missionhub-arrivalcard { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  pointer-events:none; opacity:0; transition:opacity 1.2s ease; z-index:3; }
.vm-missionhub-arrivalcard.is-visible { opacity:1; }
.vm-missionhub-arrivalcard-inner { display:flex; flex-direction:column; align-items:center; gap:6px; text-align:center;
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
