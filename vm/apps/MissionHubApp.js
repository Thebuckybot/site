/**
 * Mission Hub app — V9 "Arc 1 AAA" runtime.
 *
 * WHAT THIS IS
 * -----------
 * One Blender-authored universe in one GLB (mission_hub_master.glb). The apartment
 * floats at Z+3000 above the world map. Arc 1 is a fully rebuilt island: sculpted
 * terrain, a monotonic river in a carved gorge, a spawn village (5 unique houses +
 * townhall + plaza), Yggdrasil (a ~200 m hollow world-tree with a multi-floor
 * library inside) and instanced vegetation.
 *
 * V9 FLOW: apartment -> phone -> through the glass -> 2.9 km drop -> bird-eye
 * world reveal (apartment can never be in frame: it is 1250 m ABOVE the bird-eye
 * camera which looks straight down) -> descent to the Arc 1 pad -> BUCKY APPEARS
 * (visible third-person player entity) -> player control.
 *
 * V9 SYSTEMS (all owned by this mount, deterministically disposed):
 *   - Rapier physics (@dimforge/rapier3d-compat): static trimesh colliders for
 *     terrain / village / bridge / Yggdrasil / trees / rocks, dynamic ball body
 *     for Bucky. No walk-through anywhere. River current pushes the player
 *     downstream with real forces (no teleports).
 *   - Third-person Bucky: round body, emissive eyes, glow ring (authored in the
 *     GLB as BUCKY_Player/BUCKY_Body/BUCKY_Eyes/BUCKY_GlowRing). Runtime adds
 *     squash & stretch, idle bounce and movement-facing.
 *   - Day/night cycle (10 min): runtime sun (DirectionalLight) with realtime
 *     rotation, colour ramp (dawn/noon/dusk/night), hemisphere ambient ramp and
 *     sky-dome tinting. Shadows on desktop (single 2048 cascade over Arc 1),
 *     disabled on touch devices for iPad performance.
 *   - Wind: leaf/grass materials get a vertex sway via onBeforeCompile.
 *   - River: flow-animated water shader (scrolling waves + bank foam via UV).
 *   - Drifting clouds: ARC4_Cloud_* and the new high layer ARC1_CloudHi_*.
 *
 * BLENDER IS THE SOURCE OF TRUTH — anchors carried as empties in the GLB:
 *   CAM_ApartmentStart / CAM_PhoneHover / CAM_GlassExit / CAM_DescentMid /
 *   CAM_BirdEye / CAM_Arrival / LOOK_Universe / Arc1_Arrival_Look,
 *   plus PhoneGlass / PhoneFrame / PhoneInteriorLip / ARC1_PadRingOuter and the
 *   V9 player rig BUCKY_Player.
 *
 * MATERIAL POLICY: Blender materials ship as-is. Exceptions (each one cloned at
 * mount, owned + disposed by this mount, the cached clone is never mutated):
 *   1. transmissive glass -> plain transparent physical glass (KHR transmission
 *      would allocate an internal render target: banned, heavy on iPad),
 *   2. leaf/grass materials -> + wind vertex sway,
 *   3. river material -> + flow/foam shader,
 *   4. sky dome material -> + day/night tint.
 *
 * PERFORMANCE: one scene, one camera, one scene render per frame. Optional bloom
 * desktop-only. Draco-compressed GLB (decoded once in the shared AssetCache).
 * Pixel ratio capped. Vegetation pre-joined per type in Blender (6 draw calls
 * instead of 560 objects).
 */
import { debugLog, logError } from "../core/diagnostics.js";
import { assetCache } from "../core/assetCache.js";

// ---------------------------------------------------------------------------
// CONFIG — the one place to tune the journey + look
// ---------------------------------------------------------------------------
const THREE_VERSION = "0.160.0";
const CDN = `https://esm.sh/three@${THREE_VERSION}`;
const JSM = `${CDN}/examples/jsm`;
const RAPIER_CDN = "https://esm.sh/@dimforge/rapier3d-compat@0.12.0";

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
    pad: "ARC1_PadRingOuter",
    player: "BUCKY_Player"
};
const REQUIRED_NODES = Object.values(ANCHOR);

// Journey (V9): apartment (Z+3000) -> phone -> glass -> 2.9 km drop -> bird-eye
// reveal -> descend to the Arc 1 pad. Bucky appears at arrival.
const JOURNEY_DURATION = 20.0;
const JOURNEY_KEYS = [
    { t: 0.00, pos: "camStart",     look: "glassCenter", lens: 32 },
    { t: 0.11, pos: "camHover",     look: "glassCenter", lens: 44 },
    { t: 0.21, pos: "camHover",     look: "glassCenter", lens: 46 }, // HOLD — phone clearly in frame
    { t: 0.28, pos: "glassAbove",   look: "pad",         lens: 48 },
    { t: 0.35, pos: "camGlassExit", look: "pad",         lens: 48 }, // THROUGH the glass
    { t: 0.52, pos: "camDescent",   look: "pad",         lens: 40 }, // free fall
    { t: 0.68, pos: "camBirdEye",   look: "lookUniverse", lens: 26 }, // world reveal
    { t: 0.78, pos: "camBirdEye",   look: "lookUniverse", lens: 25 }, // DWELL
    { t: 1.00, pos: "camArrival",   look: "lookArrival",  lens: 40 }  // Arc 1 pad — Bucky appears
];

const LOOK = {
    exposure: 1.0,
    bloom: { strength: 0.22, radius: 0.55, threshold: 0.9 }
};
const GLASS = { color: 0x0a1018, opacity: 0.22, roughness: 0.06 };
const PERF = { maxPixelRatio: 1.75, bloomOnTouch: false, shadowsOnTouch: false };

// V9 third-person player + physics.
const PLAYER = {
    speed: 9.0,
    sprint: 14.0,
    jump: 11.0,
    radius: 0.58,
    camDist: 6.5,
    camHeight: 2.2,
    lookSpeed: 0.0042,
    gravity: -28.0
};
// Static collision sources (exact-name prefixes in the GLB).
const COLLIDE_RE = /^(ARC1_Terrain|ARC1_Gate|ARC1_Pad|VIL_House|VIL_Hut|VIL_Townhall|VIL_Fountain|VIL_Bridge|VIL_Lanterns|VIL_Benches|VIL_Plinths|YGG_Trunk|YGG_Branches|YGG_Entrance|VEGC_Trees|VEGC_Rocks|MTN_|MINE_Site|ARC_Bridge_(Deck|LowerDeck|Land))/;
// Wind-animated material names -> sway amplitude (m).
const WIND_MATS = {
    M_LeafOak: 0.20, M_LeafBirch: 0.22, M_LeafPine: 0.12,
    M_LeafCanopy: 0.45, M_LeafBush: 0.10, M_GrassTuft: 0.12,
    M_FlowerYellow: 0.08, M_FlowerRed: 0.08
};
// Day/night: full cycle seconds, and ramps (t: 0 dawn, .25 noon, .5 dusk, .75 night).
const DAYNIGHT = {
    cycleSeconds: 600,
    startT: 0.06, // arrive just after dawn
    keys: [
        { t: 0.00, sun: [1.00, 0.66, 0.45], i: 1.4, amb: [0.50, 0.45, 0.50], ai: 0.55, sky: [1.00, 0.82, 0.72] },
        { t: 0.25, sun: [1.00, 0.97, 0.90], i: 2.1, amb: [0.55, 0.65, 0.80], ai: 0.60, sky: [1.00, 1.00, 1.00] },
        { t: 0.50, sun: [1.00, 0.50, 0.30], i: 1.2, amb: [0.52, 0.42, 0.52], ai: 0.50, sky: [1.00, 0.72, 0.58] },
        { t: 0.75, sun: [0.45, 0.55, 0.85], i: 0.40, amb: [0.24, 0.28, 0.46], ai: 0.50, sky: [0.45, 0.50, 0.70] },
        { t: 1.00, sun: [1.00, 0.66, 0.45], i: 1.4, amb: [0.50, 0.45, 0.50], ai: 0.55, sky: [1.00, 0.82, 0.72] }
    ]
};
// River current: Blender-local polyline (ARC1_Root at world (0,-500,0)) converted
// to three.js space (x, z_blender, 500 - y_local). Water level: 94 - 72 t.
const RIVER_LOCAL = [[-200, -470], [-150, -380], [-90, -240], [-10, -60], [60, 120], [140, 330], [120, 480], [60, 700]];
const RIVER_PUSH = 16.0;   // m/s² downstream acceleration inside the current
const RIVER_HALF_WIDTH = 8.5;
const ORB_NAME = "PhoneSignalOrb";

// ---------------------------------------------------------------------------
// Asset cache wiring — parse-once at website startup, clone per open
// ---------------------------------------------------------------------------
let _assetsRegistered = false;
function registerMissionHubAssets() {
    if (_assetsRegistered) return;
    _assetsRegistered = true;
    assetCache.registerAsset("mission_hub_master", MODEL_URL, {
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
            <div class="vm-missionhub-joy" data-missionhub-joy aria-hidden="true">
                <div class="vm-missionhub-joy-knob" data-missionhub-knob></div>
            </div>
            <button class="vm-missionhub-jump" data-missionhub-jump aria-hidden="true" type="button">⤒</button>
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
    const jumpBtn = element.querySelector("[data-missionhub-jump]");
    if (!stage) { logError("MissionHub mount", new Error("stage element missing")); return; }

    const scene = {
        disposed: false, THREE: null, renderer: null, composer: null, bloom: null,
        world: null, camera: null, model: null,
        ownMaterials: [], resizeObserver: null, disposers: [],
        physics: null, sun: null
    };
    view.scene = scene;

    const setStatus = (status, detail) => {
        if (windowState.appState) { windowState.appState.status = status; windowState.appState.detail = detail; }
        if (statusLine) statusLine.textContent = detail;
    };

    buildScene(scene, stage, setStatus, { hint, jumpBtn }).catch((error) => {
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
    const touch = isTouchDevice();
    const useBloom = PERF.bloomOnTouch || !touch;
    const useShadows = PERF.shadowsOnTouch || !touch;
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

    // ---- Renderer ----
    const W = () => Math.max(1, stage.clientWidth);
    const H = () => Math.max(1, stage.clientHeight);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PERF.maxPixelRatio));
    renderer.setSize(W(), H());
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = LOOK.exposure;
    renderer.shadowMap.enabled = useShadows;
    if (useShadows) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.classList.add("vm-missionhub-canvas");
    renderer.domElement.style.touchAction = "none";
    stage.appendChild(renderer.domElement);
    scene.renderer = renderer;

    const onCtxLost = (e) => { e.preventDefault(); debugLog("MissionHub WebGL context lost"); setStatus("paused", "Graphics paused — restoring…"); };
    const onCtxRestored = () => { debugLog("MissionHub WebGL context restored"); setStatus("armed", "Look into the phone…"); };
    renderer.domElement.addEventListener("webglcontextlost", onCtxLost, false);
    renderer.domElement.addEventListener("webglcontextrestored", onCtxRestored, false);
    scene.disposers.push(() => {
        renderer.domElement.removeEventListener("webglcontextlost", onCtxLost);
        renderer.domElement.removeEventListener("webglcontextrestored", onCtxRestored);
    });

    // ---- THE ONE SCENE ----
    const world = new THREE.Scene();
    world.background = new THREE.Color(0x05060a);
    const hemi = new THREE.HemisphereLight(0x32405e, 0x14110e, 0.45);
    world.add(hemi);
    scene.world = world;

    setStatus("loading", "Opening the world…");
    registerMissionHubAssets();
    let model = null;
    try {
        model = await assetCache.acquireScene("mission_hub_master");
        if (scene.disposed) { model = null; return; }
        if (!model) throw new Error("AssetCache returned no scene (parse failed or asset unavailable)");
        const missing = REQUIRED_NODES.filter((nm) => !model.getObjectByName(nm));
        if (missing.length) throw new Error(`mission_hub_master.glb missing required nodes: ${missing.join(", ")}`);
        world.add(model);
        debugLog("MissionHub master GLB clone acquired", MODEL_URL);
    } catch (error) {
        if (scene.disposed) return;
        throw new Error(`mission_hub_master.glb failed to load from ${MODEL_URL}: ${error && error.message ? error.message : error}`);
    }
    scene.model = model;

    // ---- V11 lift: AnimationMixer plays the baked lift clip (platform up/down, stops at levels) ----
    try {
        const clips = assetCache.acquireAnimations("mission_hub_master") || [];
        const liftClip = clips.find((c) => c.name === "YGG_LiftAction") || clips.find((c) => /lift/i.test(c.name || ""));
        if (liftClip) {
            const liftMixer = new THREE.AnimationMixer(model);
            liftMixer.clipAction(liftClip).play();
            scene.liftMixer = liftMixer;
            debugLog("MissionHub lift AnimationMixer started", liftClip.name, "clips:", clips.length);
        } else {
            debugLog("MissionHub: no lift animation clip in GLB", "clips:", clips.length);
        }
    } catch (e) { logError("MissionHub lift mixer init", e); }

    // ---- Light sanity clamp: a GLB exported in photometric SPEC mode carries
    // lux/candela intensities (sun ~1639 lux) that blow the whole frame to white
    // under ACES at exposure 1. The export now uses COMPAT mode; this clamp is a
    // guard so a future SPEC export can never white out the world again.
    model.traverse((n) => {
        if (!n.isLight) return;
        if (n.intensity > 50) {
            const fixed = n.intensity / 683; // photometric -> watt-ish authoring units
            debugLog("MissionHub clamped photometric light", { name: n.name, from: n.intensity, to: fixed });
            n.intensity = fixed;
        }
    });

    // ---- Glass policy (own materials, cache never mutated) ----
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
        scene.ownMaterials.push(override);
    });

    // ---- V9 wind: clone leaf/grass materials, inject vertex sway ----
    const windUniforms = [];
    const windCloned = new Map(); // source material uuid -> own clone
    model.traverse((n) => {
        if (!n.isMesh) return;
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        let changed = false;
        const next = mats.map((m) => {
            if (!m || !(m.name in WIND_MATS)) return m;
            if (windCloned.has(m.uuid)) { changed = true; return windCloned.get(m.uuid); }
            const own = m.clone();
            const amp = WIND_MATS[m.name];
            own.onBeforeCompile = (shader) => {
                shader.uniforms.uWindTime = { value: 0 };
                windUniforms.push(shader.uniforms.uWindTime);
                shader.vertexShader = shader.vertexShader
                    .replace("#include <common>", "#include <common>\nuniform float uWindTime;")
                    .replace("#include <begin_vertex>", [
                        "#include <begin_vertex>",
                        `float windA = ${amp.toFixed(3)};`,
                        "transformed.x += sin(uWindTime * 1.6 + position.x * 0.11 + position.z * 0.07) * windA;",
                        "transformed.z += cos(uWindTime * 1.25 + position.x * 0.06 + position.y * 0.09) * windA * 0.7;"
                    ].join("\n"));
            };
            own.customProgramCacheKey = () => `wind_${m.name}_${amp}`;
            windCloned.set(m.uuid, own);
            scene.ownMaterials.push(own);
            changed = true;
            return own;
        });
        if (changed) n.material = Array.isArray(n.material) ? next : next[0];
    });

    // ---- V9.2 water system: dual scrolling normals, fresnel, env reflections,
    // bank foam. One material owned by this mount, applied to river + pond.
    const riverMesh = model.getObjectByName("ARC1_River");
    const pondMesh = model.getObjectByName("ARC1_Pond");
    const riverUniforms = [];
    scene.ownTextures = scene.ownTextures || [];
    if (riverMesh) {
        const waterNormals = makeWaterNormalTexture(THREE);
        const skyEnv = makeSkyEnvTexture(THREE);
        scene.ownTextures.push(waterNormals, skyEnv);
        const water = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(0x123e4a),
            roughness: 0.10, metalness: 0.0,
            transparent: true, opacity: 0.88, depthWrite: false,
            side: THREE.DoubleSide,
            normalMap: waterNormals,
            normalScale: new THREE.Vector2(0.55, 0.55),
            envMap: skyEnv, envMapIntensity: 0.85
        });
        water.onBeforeCompile = (shader) => {
            shader.uniforms.uWaterTime = { value: 0 };
            riverUniforms.push(shader.uniforms.uWaterTime);
            shader.fragmentShader = shader.fragmentShader
                .replace("#include <common>", "#include <common>\nuniform float uWaterTime;")
                // dual-layer scrolling normal maps (flow runs along V = downstream)
                .replace("#include <normal_fragment_maps>", [
                    "vec3 mapN1 = texture2D( normalMap, vNormalMapUv * vec2( 3.0, 7.0 ) + vec2( 0.0, -uWaterTime * 0.13 ) ).xyz * 2.0 - 1.0;",
                    "vec3 mapN2 = texture2D( normalMap, vNormalMapUv * vec2( 6.0, 13.0 ) + vec2( uWaterTime * 0.05, -uWaterTime * 0.27 ) ).xyz * 2.0 - 1.0;",
                    "vec3 mapN = normalize( vec3( mapN1.xy + mapN2.xy, mapN1.z * mapN2.z ) );",
                    "mapN.xy *= normalScale;",
                    "normal = normalize( tbn * mapN );"
                ].join("\n"))
                // foam along banks + fresnel rim + subtle moving brightness
                .replace("#include <color_fragment>", [
                    "#include <color_fragment>",
                    "{",
                    "  vec3 V = normalize( vViewPosition );",
                    "  float fres = pow( 1.0 - clamp( dot( normalize( vNormal ), V ), 0.0, 1.0 ), 3.0 );",
                    "  diffuseColor.rgb += fres * vec3( 0.10, 0.16, 0.20 );",
                    "  diffuseColor.a = mix( diffuseColor.a, 0.97, fres );",
                    "  float fy = vUv.y * 10.0 - uWaterTime * 2.4;",
                    "  float wave = sin( fy + sin( vUv.x * 9.0 + uWaterTime * 1.3 ) * 0.8 ) * 0.5 + 0.5;",
                    "  diffuseColor.rgb += wave * vec3( 0.02, 0.05, 0.06 );",
                    "  float bank = smoothstep( 0.14, 0.0, min( vUv.x, 1.0 - vUv.x ) );",
                    "  float foamN = 0.5 + 0.5 * sin( vUv.y * 34.0 - uWaterTime * 3.5 + sin( vUv.x * 20.0 ) * 1.5 );",
                    "  float foam = bank * ( 0.45 + 0.55 * foamN );",
                    "  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.88, 0.94, 0.96 ), foam * 0.75 );",
                    "  diffuseColor.a = min( 1.0, diffuseColor.a + foam * 0.4 );",
                    "}"
                ].join("\n"));
        };
        water.defines = Object.assign({}, water.defines, { USE_UV: "" });
        water.customProgramCacheKey = () => "water_v92";
        riverMesh.material = water;
        if (pondMesh) pondMesh.material = water;
        scene.ownMaterials.push(water);
    }

    // ---- Water surface samples (sync — also used by physics current + underwater state) ----
    const riverSamples = buildRiverSamples();
    const underwater = { on: false, t: 0, depth: 0, fog: new THREE.FogExp2(0x0a3346, 0.04) };
    const _uwTint = new THREE.Color(0x1c4a66);
    const waterDepthAt = (p) => {
        let best = null, bd = 1e9;
        for (let i = 0; i < riverSamples.length; i++) {
            const s = riverSamples[i];
            const dx = p.x - s.x, dz = p.z - s.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bd) { bd = d2; best = s; }
        }
        if (!best) return -1;
        const r = (best.r || RIVER_HALF_WIDTH) + 2;
        if (bd > r * r) return -1;
        return best.y - p.y; // > 0 means below the surface
    };

    // ---- V9 day/night: runtime sun + sky-dome tint (own material) ----
    // The sun is OFF until the player arrives in Arc 1 — before that the GLB's
    // authored apartment/dusk lighting carries the frame (V9 regression fix:
    // an always-on runtime sun washed out the apartment).
    const sun = new THREE.DirectionalLight(0xffffff, 0.0);
    sun.position.set(400, 800, 300);
    world.add(sun);
    world.add(sun.target);
    scene.sun = sun;
    const islandCenter = new THREE.Vector3(0, 80, 450); // blender (0,-450,80) -> three
    sun.target.position.copy(islandCenter);
    if (useShadows) {
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        const sc = sun.shadow.camera;
        sc.left = -520; sc.right = 520; sc.top = 700; sc.bottom = -700;
        sc.near = 100; sc.far = 4000;
        sun.shadow.bias = -0.0006;
        // Only Arc 1 content participates (keeps the shadow pass cheap).
        model.traverse((n) => {
            if (!n.isMesh) return;
            const nm = n.name || "";
            if (/^(ARC1_Terrain|VIL_|YGG_|VEG_|ARC1_Gate|BUCKY_)/.test(nm)) {
                n.castShadow = !/^(ARC1_Terrain|VEG_Grass)/.test(nm);
                n.receiveShadow = true;
            }
        });
    }
    let skyTintTargets = [];
    const skyDome = model.getObjectByName("UNI_SkyDome");
    if (skyDome && skyDome.material) {
        const own = skyDome.material.clone();
        skyDome.material = own;
        scene.ownMaterials.push(own);
        skyTintTargets = [own];
    }
    const skyBase = skyTintTargets.map((m) => ({
        color: m.color ? m.color.clone() : null,
        emissive: m.emissive ? m.emissive.clone() : null
    }));
    const dayKeys = DAYNIGHT.keys;
    const _c0 = new THREE.Color(), _c1 = new THREE.Color();
    function sampleDay(t, prop, idxProp) {
        let a = dayKeys[0], b = dayKeys[dayKeys.length - 1];
        for (let i = 0; i < dayKeys.length - 1; i++) {
            if (t >= dayKeys[i].t && t <= dayKeys[i + 1].t) { a = dayKeys[i]; b = dayKeys[i + 1]; break; }
        }
        const s = (t - a.t) / Math.max(1e-5, b.t - a.t);
        if (idxProp) return lerp(a[idxProp], b[idxProp], s);
        _c0.fromArray(a[prop]); _c1.fromArray(b[prop]);
        return _c0.lerp(_c1, s);
    }
    function applyDayNight(dayT) {
        const ang = dayT * Math.PI * 2 - Math.PI / 2; // dawn at horizon
        const elev = Math.sin(ang + Math.PI / 2);
        const r = 2200;
        sun.position.set(
            islandCenter.x + Math.cos(ang) * r,
            islandCenter.y + Math.max(0.06, elev) * r * 0.8,
            islandCenter.z + Math.sin(ang * 0.7) * r * 0.5
        );
        sun.color.copy(sampleDay(dayT, "sun"));
        sun.intensity = sampleDay(dayT, null, "i");
        hemi.color.copy(sampleDay(dayT, "amb"));
        hemi.intensity = sampleDay(dayT, null, "ai");
        const skyTint = sampleDay(dayT, "sky");
        skyTintTargets.forEach((m, i) => {
            if (m.color && skyBase[i].color) m.color.copy(skyBase[i].color).multiply(skyTint);
            if (m.emissive && skyBase[i].emissive) m.emissive.copy(skyBase[i].emissive).multiply(skyTint);
        });
    }

    // ---- Resolve anchors ----
    model.updateWorldMatrix(true, true);
    const worldPos = (nm) => model.getObjectByName(nm).getWorldPosition(new THREE.Vector3());
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
        t: k.t, pos: points[k.pos].clone(), look: points[k.look].clone(), fov: lensToFov(k.lens)
    }));

    // ---- V10 chunked distance culling -------------------------------------
    // Vegetation is exported as spatial tiles (VEGC_<Type>_<i>_<j>). Each tile is
    // its own mesh, so three.js frustum culling works per tile; on top of that we
    // hide tiles beyond a per-type view distance. Big wins on iPad: only nearby
    // grass/flowers are ever drawn.
    const CULL_DIST = { Grass: 170, Flowers: 130, Shrubs: 260, Reeds: 150, Plants: 120, Mush: 110, Trees: 5000, Rocks: 500 };
    const cullChunks = [];
    model.traverse((n) => {
        if (!n.isMesh || n.name.indexOf("VEGC_") !== 0) return;
        const type = n.name.split("_")[1];
        if (!n.geometry.boundingSphere) n.geometry.computeBoundingSphere();
        const center = n.geometry.boundingSphere.center.clone().applyMatrix4(n.matrixWorld);
        // cull on edge-distance (center distance minus chunk radius): no popping of
        // chunks that are half inside the view distance (V10.2 clipping fix)
        const cut = (CULL_DIST[type] || 180) + n.geometry.boundingSphere.radius;
        cullChunks.push({ o: n, c: center, d2: cut * cut });
    });
    debugLog("MissionHub V10 culling chunks", cullChunks.length);

    const camera = new THREE.PerspectiveCamera(path[0].fov, W() / H(), 0.05, 14000);
    camera.position.copy(path[0].pos);
    camera.lookAt(path[0].look);
    scene.camera = camera;

    // ---- Bloom (desktop) ----
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

    // ---- V9 Bucky rig ----
    const bucky = model.getObjectByName(ANCHOR.player);
    const buckyBody = model.getObjectByName("BUCKY_Body");
    bucky.visible = false; // appears at arrival
    const buckySpawn = points.pad.clone();
    buckySpawn.y += 2.0;

    // ---- Ambient life: orb pulse + drifting clouds ----
    const orb = model.getObjectByName(ORB_NAME);
    if (orb && orb.material) {
        orb.material = orb.material.clone();
        scene.ownMaterials.push(orb.material);
    }
    const clouds = [];
    model.traverse((n) => {
        if (!n.isMesh) return;
        if (n.name.indexOf("ARC4_Cloud") === 0 || n.name.indexOf("ARC1_CloudHi") === 0) {
            clouds.push({ o: n, base: n.position.clone(), ph: Math.random() * 6.28, s: n.name.indexOf("ARC1_") === 0 ? 14 : 6 });
        }
    });
    // V10.2 mine life: spinning/bobbing drill + rising smoke puffs
    const drill = model.getObjectByName("MINE_DrillBit");
    const drillBaseY = drill ? drill.position.y : 0;
    const smokes = [];
    model.traverse((n) => {
        if (n.isMesh && n.name.indexOf("MINE_Smoke") === 0) {
            smokes.push({ o: n, base: n.position.clone(), ph: Math.random() * 6.28, s0: n.scale.x });
        }
    });

    // ---- V9 physics (Rapier) — built in the background during the journey ----
    const phys = { ready: false, RAPIER: null, world: null, body: null, river: null };
    scene.physics = phys;
    (async () => {
        try {
            const RAPIER = await import(/* @vite-ignore */ RAPIER_CDN);
            await RAPIER.init();
            if (scene.disposed) return;
            const pw = new RAPIER.World({ x: 0, y: PLAYER.gravity, z: 0 });
            // static trimesh colliders
            const tmp = new THREE.Vector3();
            let colliderCount = 0;
            model.updateWorldMatrix(true, true);
            model.traverse((n) => {
                if (!n.isMesh || !COLLIDE_RE.test(n.name || "")) return;
                if (n.name === "YGG_Trunk_LiftPlatform" || n.name === "YGG_Trunk_LiftRail") return; // animated lift -> no static collider (avoids a phantom collider stuck at ground)
                const geo = n.geometry;
                if (!geo || !geo.attributes.position) return;
                const pos = geo.attributes.position;
                const verts = new Float32Array(pos.count * 3);
                for (let i = 0; i < pos.count; i++) {
                    tmp.fromBufferAttribute(pos, i).applyMatrix4(n.matrixWorld);
                    verts[i * 3] = tmp.x; verts[i * 3 + 1] = tmp.y; verts[i * 3 + 2] = tmp.z;
                }
                let idx;
                if (geo.index) idx = new Uint32Array(geo.index.array);
                else { idx = new Uint32Array(pos.count); for (let i = 0; i < pos.count; i++) idx[i] = i; }
                pw.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.9));
                colliderCount++;
            });
            // Bucky: dynamic ball
            const bd = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(buckySpawn.x, buckySpawn.y, buckySpawn.z)
                .lockRotations()
                .setLinearDamping(0.18)
                .setCcdEnabled(true);
            const body = pw.createRigidBody(bd);
            pw.createCollider(RAPIER.ColliderDesc.ball(PLAYER.radius).setFriction(0.25).setRestitution(0.0), body);
            phys.RAPIER = RAPIER; phys.world = pw; phys.body = body; phys.river = riverSamples;
            // V11: kinematic collider so the animated lift platform is rideable (follows the baked clip)
            try {
                const liftPlat = model.getObjectByName("YGG_Trunk_LiftPlatform");
                if (liftPlat) {
                    liftPlat.updateWorldMatrix(true, false);
                    const wp = liftPlat.getWorldPosition(new THREE.Vector3());
                    const lbody = pw.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(wp.x, wp.y, wp.z));
                    pw.createCollider(RAPIER.ColliderDesc.cylinder(0.25, 4.5).setFriction(0.9), lbody);
                    phys.liftBody = lbody; phys.liftNode = liftPlat;
                    debugLog("MissionHub lift kinematic platform collider ready");
                }
            } catch (e) { logError("MissionHub lift kinematic collider", e); }
            phys.ready = true;
            debugLog("MissionHub V9 physics ready", { colliders: colliderCount, riverSamples: riverSamples.length });
        } catch (e) {
            logError("MissionHub Rapier init (walking falls back to no-clip ground snap)", e);
        }
    })();

    // ---- Interaction: click the phone -> journey ----
    const anim = { phase: "idle", t: 0, p: 0 };
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const targets = [];
    [ANCHOR.glass, ANCHOR.frame, ANCHOR.lip, ORB_NAME].forEach((nm) => {
        const o = model.getObjectByName(nm);
        if (o) o.traverse((c) => { if (c.isMesh) targets.push(c); });
    });

    // ---- input: keyboard + drag-look + joystick + jump ----
    const input = { f: 0, r: 0, joyF: 0, joyR: 0, dragging: false, lastX: 0, lastY: 0, yaw: 0, pitch: -0.25, jump: false, sprint: false };
    const keymap = { KeyW: [1, 0], ArrowUp: [1, 0], KeyS: [-1, 0], ArrowDown: [-1, 0], KeyA: [0, -1], ArrowLeft: [0, -1], KeyD: [0, 1], ArrowRight: [0, 1] };
    const keys = new Set();
    const updateKeys = () => {
        let f = 0, r = 0;
        keys.forEach((k) => { const m = keymap[k]; if (m) { f += m[0]; r += m[1]; } });
        input.f = Math.max(-1, Math.min(1, f)); input.r = Math.max(-1, Math.min(1, r));
    };
    const onKeyDown = (e) => {
        if (anim.phase !== "explore") return;
        if (keymap[e.code]) { keys.add(e.code); updateKeys(); e.preventDefault(); }
        if (e.code === "Space") { input.jump = true; e.preventDefault(); }
        if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.sprint = true;
    };
    const onKeyUp = (e) => {
        if (keymap[e.code]) { keys.delete(e.code); updateKeys(); }
        if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.sprint = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    scene.disposers.push(() => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); });

    const joyEl = stage.parentElement.querySelector("[data-missionhub-joy]");
    const knobEl = stage.parentElement.querySelector("[data-missionhub-knob]");
    let joyId = null, joyCx = 0, joyCy = 0;
    const onPointerDownStage = (ev) => {
        if (anim.phase !== "explore") return;
        const r = renderer.domElement.getBoundingClientRect();
        const isTouch = ev.pointerType === "touch";
        if (isTouch && joyId === null && ev.clientX - r.left < r.width * 0.4 && ev.clientY - r.top > r.height * 0.55) {
            joyId = ev.pointerId; joyCx = ev.clientX; joyCy = ev.clientY;
            if (joyEl) { joyEl.style.left = (ev.clientX - r.left - 55) + "px"; joyEl.style.top = (ev.clientY - r.top - 55) + "px"; joyEl.classList.add("is-active"); }
            return;
        }
        input.dragging = true; input.lastX = ev.clientX; input.lastY = ev.clientY;
    };
    const onPointerMoveStage = (ev) => {
        if (anim.phase !== "explore") return;
        if (ev.pointerId === joyId) {
            const dx = ev.clientX - joyCx, dy = ev.clientY - joyCy;
            const mag = Math.min(45, Math.hypot(dx, dy)) / 45;
            const ang = Math.atan2(dy, dx);
            input.joyR = Math.cos(ang) * mag; input.joyF = -Math.sin(ang) * mag;
            if (knobEl) knobEl.style.transform = `translate(${Math.cos(ang) * mag * 32}px, ${Math.sin(ang) * mag * 32}px)`;
            return;
        }
        if (input.dragging) {
            input.yaw -= (ev.clientX - input.lastX) * PLAYER.lookSpeed;
            input.pitch -= (ev.clientY - input.lastY) * PLAYER.lookSpeed;
            input.pitch = Math.max(-1.2, Math.min(0.55, input.pitch));
            input.lastX = ev.clientX; input.lastY = ev.clientY;
        }
    };
    const onPointerUpStage = (ev) => {
        if (ev.pointerId === joyId) {
            joyId = null; input.joyF = 0; input.joyR = 0;
            if (joyEl) joyEl.classList.remove("is-active");
            if (knobEl) knobEl.style.transform = "translate(0,0)";
            return;
        }
        input.dragging = false;
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDownStage);
    renderer.domElement.addEventListener("pointermove", onPointerMoveStage);
    renderer.domElement.addEventListener("pointerup", onPointerUpStage);
    renderer.domElement.addEventListener("pointercancel", onPointerUpStage);
    scene.disposers.push(() => {
        renderer.domElement.removeEventListener("pointerdown", onPointerDownStage);
        renderer.domElement.removeEventListener("pointermove", onPointerMoveStage);
        renderer.domElement.removeEventListener("pointerup", onPointerUpStage);
        renderer.domElement.removeEventListener("pointercancel", onPointerUpStage);
    });
    if (ui.jumpBtn) {
        const onJump = (ev) => { ev.preventDefault(); if (anim.phase === "explore") input.jump = true; };
        ui.jumpBtn.addEventListener("pointerdown", onJump);
        scene.disposers.push(() => ui.jumpBtn.removeEventListener("pointerdown", onJump));
    }

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

    // ---- no-physics fallback: raycast ground snap (only if Rapier failed) ----
    const walkables = [];
    model.traverse((n) => { if (n.isMesh && /^(ARC1_Terrain|VIL_Bridge|VIL_Townhall|ARC1_Pad)/.test(n.name || "")) walkables.push(n); });
    const _down = new THREE.Vector3(0, -1, 0);
    const groundRay = new THREE.Raycaster();

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

    // ---- Frame loop ----
    const clock = new THREE.Clock();
    const _off = new THREE.Vector3();
    const _pos = new THREE.Vector3();
    const _look = new THREE.Vector3();
    const _v = new THREE.Vector3();
    const idleP = path[0].pos.clone();
    const idleL = path[0].look.clone();
    const fovIdle = path[0].fov;
    let dayClock = DAYNIGHT.startT * DAYNIGHT.cycleSeconds;
    let buckyYaw = 0, buckyVy = 0, popT = -1;
    let camDistCur = PLAYER.camDist; // V10.1 camera collision: smoothed boom length

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
        // V10 distance culling (frustum culling per chunk is automatic in three)
        for (let i = 0; i < cullChunks.length; i++) {
            const ch = cullChunks[i];
            ch.o.visible = camera.position.distanceToSquared(ch.c) < ch.d2;
        }
        // ambient life
        if (orb) {
            const pulse = 1 + 0.18 * Math.sin(time * 3.2);
            orb.scale.setScalar(pulse);
            if (orb.material && orb.material.emissiveIntensity !== undefined) {
                orb.material.emissiveIntensity = 0.7 + 0.5 * (0.5 + 0.5 * Math.sin(time * 3.2));
            }
        }
        for (const c of clouds) {
            c.o.position.x = c.base.x + Math.sin(time * 0.05 + c.ph) * c.s;
            c.o.position.z = c.base.z + Math.cos(time * 0.04 + c.ph) * c.s * 0.8;
        }
        if (drill) {
            drill.rotation.y += dt * 7.0;                                    // boren
            drill.position.y = drillBaseY - 0.9 * (0.5 + 0.5 * Math.sin(time * 0.55)); // op en neer
        }
        for (const s of smokes) {
            const cyc = (time * 1.1 + s.ph) % 7;
            s.o.position.y = s.base.y + cyc * 1.6;
            const f = 1 - cyc / 7;
            s.o.scale.setScalar(s.s0 * (0.6 + cyc * 0.35));
            s.o.visible = f > 0.05;
        }
        for (const u of windUniforms) u.value = time;
        for (const u of riverUniforms) u.value = time;

        // day/night runs as soon as the player is in the world
        if (anim.phase === "explore") {
            dayClock += dt;
            applyDayNight((dayClock / DAYNIGHT.cycleSeconds) % 1);
            // ---- underwater state: blue fog, light absorption, smooth transition ----
            const depth = waterDepthAt(camera.position);
            const uwTarget = depth > 0.12 ? 1 : 0;
            underwater.t += (uwTarget - underwater.t) * Math.min(1, dt * 6); // ~0.3s fade
            if (underwater.t > 0.015) {
                if (!underwater.on) { underwater.on = true; world.fog = underwater.fog; debugLog("MissionHub underwater enter"); }
                if (depth > 0) underwater.depth = depth;
                const d = underwater.depth;
                underwater.fog.density = Math.min(0.11, (0.034 + d * 0.010) * underwater.t); // limited sight, worse with depth
                sun.intensity *= 1 - underwater.t * (1 - Math.exp(-d * 0.16));               // light absorption
                hemi.color.lerp(_uwTint, 0.85 * underwater.t);                               // colour shift
                hemi.intensity *= 1 - 0.25 * underwater.t;
                renderer.toneMappingExposure = LOOK.exposure * (1 - 0.18 * underwater.t);
            } else if (underwater.on) {
                underwater.on = false; underwater.depth = 0; world.fog = null;
                renderer.toneMappingExposure = LOOK.exposure;
                debugLog("MissionHub underwater exit");
            }
        }

        if (anim.phase === "idle") {
            _off.set(Math.sin(time * 0.14) * 0.02, Math.cos(time * 0.11) * 0.012, Math.sin(time * 0.09) * 0.016);
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
                anim.phase = "explore";
                bucky.visible = true;
                popT = 0; // spawn pop animation
                applyDayNight(DAYNIGHT.startT);
                const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
                input.yaw = e.y; input.pitch = -0.25;
                if (camera.fov !== 50) { camera.fov = 50; camera.updateProjectionMatrix(); }
                setStatus("explore", "Arc 1 — verken de wereld");
                if (ui.hint) ui.hint.textContent = isTouchDevice() ? "joystick: lopen — sleep: kijken — ⤒: springen" : "WASD: lopen — shift: rennen — spatie: springen — sleep: kijken";
                if (ui.jumpBtn && isTouchDevice()) ui.jumpBtn.classList.add("is-active");
                debugLog("MissionHub V9 arrived — Bucky spawned, explore mode");
            }
            return;
        }

        // ---- explore: third-person Bucky ----
        const f = (input.f || 0) + input.joyF;
        const r = (input.r || 0) + input.joyR;
        const moving = Math.abs(f) > 0.05 || Math.abs(r) > 0.05;
        const speed = input.sprint ? PLAYER.sprint : PLAYER.speed;
        const sinY = Math.sin(input.yaw), cosY = Math.cos(input.yaw);
        const dx = (-sinY * f + cosY * r);
        const dz = (-cosY * f - sinY * r);

        let bp; // bucky world position this frame
        if (phys.ready) {
            const body = phys.body;
            const lv = body.linvel();
            // grounded probe
            const origin = body.translation();
            const ray = new phys.RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: 0, y: -1, z: 0 });
            const hit = phys.world.castRay(ray, PLAYER.radius + 0.25, true);
            const grounded = !!hit;
            // desired horizontal velocity
            const tx = dx * speed, tz = dz * speed;
            const blend = grounded ? 0.55 : 0.08;
            let nvx = lv.x + (tx - lv.x) * blend;
            let nvz = lv.z + (tz - lv.z) * blend;
            let nvy = lv.y;
            if (input.jump && grounded) nvy = PLAYER.jump;
            input.jump = false;
            // river current
            const riv = phys.river;
            if (riv) {
                let best = null, bd = 1e9;
                for (let i = 0; i < riv.length; i++) {
                    const s = riv[i];
                    const ddx = origin.x - s.x, ddz = origin.z - s.z;
                    const d2 = ddx * ddx + ddz * ddz;
                    if (d2 < bd) { bd = d2; best = s; }
                }
                if (best && bd < RIVER_HALF_WIDTH * RIVER_HALF_WIDTH && origin.y < best.y + 1.2 && origin.y > best.y - 5) {
                    nvx += best.dx * RIVER_PUSH * dt * 12;
                    nvz += best.dz * RIVER_PUSH * dt * 12;
                    nvy = Math.min(nvy + 2.0 * dt, 1.5); // buoyancy
                    if (origin.y < best.y - 0.2) {
                        nvy += 6.0 * dt;        // stronger lift when submerged
                        nvx *= 0.93; nvz *= 0.93; // water drag — swimming is slower
                    }
                }
            }
            body.setLinvel({ x: nvx, y: nvy, z: nvz }, true);
            if (phys.liftBody && phys.liftNode) {
                phys.liftNode.updateWorldMatrix(true, false);
                const lp = phys.liftNode.getWorldPosition(new THREE.Vector3());
                phys.liftBody.setNextKinematicTranslation({ x: lp.x, y: lp.y, z: lp.z });
            }
            phys.world.timestep = Math.min(dt, 1 / 30);
            phys.world.step();
            const tr = body.translation();
            bp = _v.set(tr.x, tr.y - PLAYER.radius, tr.z);
            buckyVy = body.linvel().y;
            // fell off the world -> respawn on the pad
            if (tr.y < -150) {
                body.setTranslation({ x: buckySpawn.x, y: buckySpawn.y, z: buckySpawn.z }, true);
                body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            }
        } else {
            // fallback: direct move + raycast snap (no physics available)
            bucky.getWorldPosition(_v);
            _v.x += dx * speed * dt; _v.z += dz * speed * dt;
            _pos.copy(_v); _pos.y += 3;
            groundRay.set(_pos, _down); groundRay.far = 400;
            const hits = groundRay.intersectObjects(walkables, false);
            if (hits.length) _v.y = hits[0].point.y;
            bp = _v;
        }

        // place the rig (bucky is parented inside the model graph -> use world->local)
        const parent = bucky.parent;
        parent.updateWorldMatrix(true, false);
        bucky.position.copy(parent.worldToLocal(_pos.copy(bp)));

        // facing + squash & stretch + idle bounce
        if (moving) {
            // V10 fix: Bucky's face (local +Z after glTF Y-up conversion) must point
            // along the movement direction — no PI offset (it inverted the character).
            const targetYaw = Math.atan2(dx, dz);
            let d = targetYaw - buckyYaw;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            buckyYaw += d * Math.min(1, dt * 10);
        }
        bucky.rotation.y = buckyYaw;
        const stretch = clamp01(Math.abs(buckyVy) / 14);
        const sq = 1 + (buckyVy > 0 ? 0.22 : -0.16) * stretch;
        const bounce = moving ? 1 + 0.05 * Math.sin(time * 14) : 1 + 0.03 * Math.sin(time * 2.2);
        let pop = 1;
        if (popT >= 0) {
            popT += dt;
            pop = popT < 0.5 ? smoothstep01(popT / 0.5) * (1 + 0.3 * Math.sin(popT * 12)) : 1;
            if (popT > 0.8) popT = -1;
        }
        bucky.scale.set((2 - sq) * pop, sq * bounce * pop, (2 - sq) * pop);

        // ---- third-person camera with V10.1 collision ----
        // Raycast (Rapier, BVH-accelerated) from Bucky's head toward the desired
        // camera position; if a wall/ceiling/object is in between, the boom shortens
        // so the camera can never see through geometry. Snaps in instantly, eases out.
        const cd = PLAYER.camDist;
        const cp = Math.cos(input.pitch), sp = Math.sin(input.pitch);
        const headY = bp.y + 1.2;
        const desX = bp.x + sinY * cd * cp;
        const desY = bp.y + PLAYER.camHeight - sp * cd;
        const desZ = bp.z + cosY * cd * cp;
        let dirX = desX - bp.x, dirY = desY - headY, dirZ = desZ - bp.z;
        const boomLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
        dirX /= boomLen; dirY /= boomLen; dirZ /= boomLen;
        let targetLen = boomLen;
        if (phys.ready) {
            const ray = new phys.RAPIER.Ray({ x: bp.x, y: headY, z: bp.z }, { x: dirX, y: dirY, z: dirZ });
            const hit = phys.world.castRay(ray, boomLen, true, undefined, undefined, undefined, phys.body);
            if (hit) targetLen = Math.max(0.7, hit.toi - 0.35);
        }
        camDistCur = targetLen < camDistCur
            ? targetLen                                        // muur ertussen: direct inschuiven
            : camDistCur + (targetLen - camDistCur) * Math.min(1, dt * 4); // rustig uitschuiven
        camera.position.set(
            bp.x + dirX * camDistCur,
            headY + dirY * camDistCur,
            bp.z + dirZ * camDistCur
        );
        _look.set(bp.x, bp.y + 1.2, bp.z);
        camera.lookAt(_look);
    };

    renderer.setAnimationLoop(() => {
        if (scene.disposed) return;
        const dt = clock.getDelta(), time = clock.elapsedTime;
        if (scene.liftMixer) scene.liftMixer.update(dt);
        tick(dt, time);
        if (composer) composer.render(); else renderer.render(world, camera);
    });
    setStatus("armed", "Look into the phone…");
    debugLog("MissionHub V9 runtime running", { bloom: useBloom, shadows: useShadows });
}

// ---------------------------------------------------------------------------
// Helpers — GLB byte-patcher (strip orphan texture references before parse)
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
// Helpers — water system
// ---------------------------------------------------------------------------
/** River + pond surface samples in three.js space (x, surfaceY, z, flow dir, radius). */
function buildRiverSamples() {
    const samples = [];
    let total = 0;
    const segs = [];
    for (let i = 0; i < RIVER_LOCAL.length - 1; i++) {
        const L = Math.hypot(RIVER_LOCAL[i + 1][0] - RIVER_LOCAL[i][0], RIVER_LOCAL[i + 1][1] - RIVER_LOCAL[i][1]);
        segs.push(L); total += L;
    }
    let acc = 0;
    for (let i = 0; i < RIVER_LOCAL.length - 1; i++) {
        const [ax, ay] = RIVER_LOCAL[i], [bx, by] = RIVER_LOCAL[i + 1];
        const n = Math.max(2, Math.round(segs[i] / 12));
        for (let k = 0; k < n; k++) {
            const tt = k / n;
            const t = (acc + segs[i] * tt) / total;
            const lx = ax + (bx - ax) * tt, ly = ay + (by - ay) * tt;
            const surfaceY = 95 - 72 * t; // matches the authored water mesh (bed + 1)
            const dirx = (bx - ax) / segs[i], diry = (by - ay) / segs[i];
            // blender (x,y,z) -> three (x, z, 500 - y)
            samples.push({ x: lx, y: surfaceY, z: 500 - ly, dx: dirx, dz: -diry, r: RIVER_HALF_WIDTH });
        }
        acc += segs[i];
    }
    // source pond: blender local (-200,-470), surface z 95, radius 30
    for (let gx = -1; gx <= 1; gx++) {
        for (let gz = -1; gz <= 1; gz++) {
            samples.push({ x: -200 + gx * 13, y: 95.0, z: 970 + gz * 13, dx: 0, dz: 0, r: 16 });
        }
    }
    return samples;
}

/** Tileable procedural water normal map (sum of integer-wavenumber sines). */
function makeWaterNormalTexture(THREE) {
    const S = 256;
    const data = new Uint8Array(S * S * 4);
    const TWO_PI = Math.PI * 2;
    const waves = [[3, 2, 0.55], [7, -5, 0.30], [13, 11, 0.18], [2, -9, 0.12]];
    const h = (x, y) => {
        let v = 0;
        for (const [kx, ky, a] of waves) v += a * Math.sin(TWO_PI * (kx * x + ky * y) / S);
        return v;
    };
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const dx = h(x + 1, y) - h(x - 1, y);
            const dy = h(x, y + 1) - h(x, y - 1);
            const inv = 1 / Math.hypot(dx, dy, 2.0);
            const i = (y * S + x) * 4;
            data[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
            data[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
            data[i + 2] = Math.round((2.0 * inv * 0.5 + 0.5) * 255);
            data[i + 3] = 255;
        }
    }
    const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
}

/** Tiny gradient sky cubemap for water reflections (PMREM'd internally by three). */
function makeSkyEnvTexture(THREE) {
    const S = 64;
    const face = (top, bottom) => {
        const c = document.createElement("canvas");
        c.width = S; c.height = S;
        const g = c.getContext("2d");
        const grad = g.createLinearGradient(0, 0, 0, S);
        grad.addColorStop(0, top); grad.addColorStop(1, bottom);
        g.fillStyle = grad; g.fillRect(0, 0, S, S);
        return c;
    };
    const sky = "#a8c8e8", horizon = "#d8d2c4", ground = "#1a2026";
    const px = face(sky, horizon), nx = face(sky, horizon);
    const pz = face(sky, horizon), nz = face(sky, horizon);
    const py = face("#bcd8f0", sky), ny = face(ground, ground);
    const tex = new THREE.CubeTexture([px, nx, py, ny, pz, nz]);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
}

// ---------------------------------------------------------------------------
// Helpers — math + device
// ---------------------------------------------------------------------------
function lensToFov(lens) { return 2 * Math.atan(24 / (2 * lens)) * 180 / Math.PI; }
function isTouchDevice() {
    try { return typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 1; } catch (_e) { return false; }
}
function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep01(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
function smootherstep(x) { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); }
function enterLabel(p) {
    if (p < 0.21) return "approaching the phone";
    if (p < 0.35) return "through the glass";
    if (p < 0.52) return "falling — 2.9 km to go";
    if (p < 0.72) return "the world below";
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

    // physics (this mount's own world)
    if (scene.physics && scene.physics.world) {
        try { scene.physics.world.free(); } catch (_) {}
        scene.physics = null;
    }
    if (scene.sun) {
        try { if (scene.world) { scene.world.remove(scene.sun.target); scene.world.remove(scene.sun); } } catch (_) {}
        try { if (scene.sun.shadow && scene.sun.shadow.map) scene.sun.shadow.map.dispose(); } catch (_) {}
        scene.sun = null;
    }

    // The AssetCache clone is SHARED — detach, never deep-dispose.
    if (scene.world && scene.model) { try { scene.world.remove(scene.model); } catch (_) {} }
    scene.model = null;

    (scene.ownMaterials || []).forEach((m) => { try { m.dispose(); } catch (_) {} });
    scene.ownMaterials = [];
    (scene.ownTextures || []).forEach((t) => { try { t.dispose(); } catch (_) {} });
    scene.ownTextures = [];
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
.vm-missionhub-joy { position:absolute; width:110px; height:110px; border-radius:50%;
  border:2px solid rgba(120,200,255,.35); background:rgba(10,16,26,.35);
  display:none; align-items:center; justify-content:center; pointer-events:none; z-index:3; }
.vm-missionhub-joy.is-active { display:flex; }
.vm-missionhub-joy-knob { width:44px; height:44px; border-radius:50%;
  background:rgba(120,200,255,.45); border:1px solid rgba(180,225,255,.6); }
.vm-missionhub-jump { position:absolute; right:18px; bottom:22px; width:62px; height:62px; border-radius:50%;
  border:2px solid rgba(120,200,255,.4); background:rgba(10,16,26,.45); color:#bfe6ff; font-size:24px;
  display:none; align-items:center; justify-content:center; z-index:3; touch-action:none; }
.vm-missionhub-jump.is-active { display:flex; }
    `;
    document.head.appendChild(style);
}
