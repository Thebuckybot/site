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
 *   - site/vm/assets/models/mission_hub.glb       (Draco + WebP, ~1.5 MB)
 *   - site/vm/assets/hdri/terrace_night_1k.hdr    (env + reflections, ~1.8 MB)
 * The camera waypoints below were recorded from that .blend
 * (mission_hub_v2_waypoints.json) so the shot matches the rendered reference.
 *
 * ARCHITECTURE (unchanged contract — see docs/architecture/app-system.md)
 * ----------------------------------------------------------------------
 * Exports createState / render / mount / unmount, registered in vmRuntime.js.
 * The scene is built imperatively once in `mount`; the body is never rebuilt on
 * resize/maximize. Three.js + addons + the Draco decoder load on demand from
 * pinned CDNs (GitHub-Pages-safe, no build step). One ResizeObserver handles
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

// ---------------------------------------------------------------------------
// CONFIG — the one place to tune the look
// ---------------------------------------------------------------------------
const THREE_VERSION = "0.160.0";
const CDN = `https://esm.sh/three@${THREE_VERSION}`;
const JSM = `${CDN}/examples/jsm`;
const DRACO_DECODER = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";

const MODEL_URL = new URL("../assets/models/mission_hub.glb", import.meta.url).href;
const HDRI_URL = new URL("../assets/hdri/terrace_night_1k.hdr", import.meta.url).href;

const STYLE_ELEMENT_ID = "vm-missionhub-styles";
const REVEAL_DURATION = 5.0; // seconds, click → fully inside (was 4.0; slower = more "expensive")

// Camera waypoints in Three.js (Y-up) world space.
// v0.5 AUDIT: the original waypoints (kept below) framed the desk at only ~8°
// downward — a near-horizontal "table-height" view, the #1 reason the intro felt
// like a prototype. Retuned to an elevated, looking-down cinematic establishing
// shot (~30° down, desk dominant, phone the focal point) that dollies DOWN onto
// the flat screen (~40°) so the "world inside" reads face-on instead of edge-on.
// This CAM block is the single tuning surface for framing — nudge widePos.y / the
// look target to taste. (Window top crops a little past ~30°; that's the trade-off
// between a steep angle and showing the whole window — see audit.)
const CAM = {
    // v0.4 originals (too flat, ~8°): widePos [1.95,1.32,1.70] wideLook [-0.25,0.82,-1.00]
    //                                 closePos [-0.02,0.86,-0.46] closeLook [-0.08,0.787,-1.02]
    widePos: [1.10, 2.10, 0.70], wideLook: [-0.18, 0.84, -1.05], wideLens: 32,    // elevated establishing, ~30° down
    closePos: [-0.06, 1.10, -0.66], closeLook: [-0.08, 0.79, -1.02], closeLens: 50, // ends looking DOWN on the screen, ~40°
    screen: [-0.08, 0.789, -1.02]
};

const LOOK = {
    exposure: 1.15,            // ACES tone-mapping exposure
    bloomStrength: 0.42,       // was 0.55 — softer, avoids the blown "orb" bloom on the lamp
    bloomRadius: 0.5,
    bloomThreshold: 0.9,       // was 0.85 — only the brightest highlights bloom
    envIntensity: 1.1,         // was 1.0 — HDRI a touch stronger (ambient fill + glass/metal reflections)
    keyIntensity: 3.0,         // was 3.4 — cool window key light (PRIMARY light)
    lampIntensity: 9.0,        // was 14 — warm desk-lamp ACCENT, not the main source
    fillIntensity: 0.6,        // was 0.5 — lift camera-side shadows now that we look down
    hemiIntensity: 0.35        // was 0.25 — gentle ambient so the dark floor/desk still reads
};

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
        sceneGraph: null, camera: null, model: null, glass: null, portal: null,
        envTex: null, pmrem: null, draco: null, resizeObserver: null, disposers: []
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
    let THREE, GLTFLoader, DRACOLoader, RGBELoader, EffectComposer, RenderPass, UnrealBloomPass, OutputPass;
    try {
        [THREE, { GLTFLoader }, { DRACOLoader }, { RGBELoader },
         { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
            import(/* @vite-ignore */ CDN),
            import(/* @vite-ignore */ `${JSM}/loaders/GLTFLoader.js`),
            import(/* @vite-ignore */ `${JSM}/loaders/DRACOLoader.js`),
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

    // ---- Scene ----
    const sceneGraph = new THREE.Scene();
    sceneGraph.background = new THREE.Color(0x07080b);
    sceneGraph.fog = new THREE.Fog(0x07080b, 4.0, 12.0);
    scene.sceneGraph = sceneGraph;

    // ---- HDRI environment (reflections + ambient) ----
    setStatus("loading", "Loading environment…");
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    scene.pmrem = pmrem;
    try {
        const hdr = await new Promise((res, rej) => new RGBELoader().load(HDRI_URL, res, undefined, rej));
        if (scene.disposed) { hdr.dispose(); return; }
        const envTex = pmrem.fromEquirectangular(hdr).texture;
        sceneGraph.environment = envTex;
        if ("environmentIntensity" in sceneGraph) sceneGraph.environmentIntensity = LOOK.envIntensity;
        scene.envTex = envTex;
        hdr.dispose();
    } catch (error) {
        debugLog("MissionHub HDRI unavailable", error && error.message);
    }

    // ---- Lights (reproduce the Blender key/lamp/fill that GLB can't carry) ----
    const hemi = new THREE.HemisphereLight(0x9fb6e0, 0x14110d, LOOK.hemiIntensity);
    sceneGraph.add(hemi);

    const key = new THREE.DirectionalLight(0xbcd2ff, LOOK.keyIntensity); // cool, from window
    key.position.set(-0.5, 2.2, -2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004; key.shadow.radius = 5;
    { const c = key.shadow.camera; c.near = 0.5; c.far = 8; c.left = -2; c.right = 2; c.top = 2; c.bottom = -2; c.updateProjectionMatrix(); }
    key.target.position.set(-0.1, 0.78, -1.0);
    sceneGraph.add(key); sceneGraph.add(key.target);

    const lamp = new THREE.PointLight(0xffb060, LOOK.lampIntensity, 6, 2.0); // warm desk lamp
    lamp.position.set(0.62, 1.12, -1.55);
    lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.0006;
    sceneGraph.add(lamp);

    const fill = new THREE.DirectionalLight(0x9db4e8, LOOK.fillIntensity); // cool camera-side fill
    fill.position.set(2.0, 1.4, 1.6);
    sceneGraph.add(fill);

    // ---- Load the GLB scene ----
    setStatus("loading", "Loading scene…");
    const draco = new DRACOLoader(); draco.setDecoderPath(DRACO_DECODER); scene.draco = draco;
    const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
    let model = null, screenMesh = null;
    try {
        const gltf = await new Promise((res, rej) => loader.load(MODEL_URL, res, undefined, rej));
        if (scene.disposed) { disposeObject3D(gltf.scene); return; }
        model = gltf.scene;
        model.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
        tuneSceneAfterLoad(THREE, model);   // v0.5 audit: hide exported rig gizmos + warm the lamp
        sceneGraph.add(model);
        screenMesh = model.getObjectByName("PhoneScreen");
        debugLog("MissionHub GLB loaded", MODEL_URL);
    } catch (error) {
        if (scene.disposed) return;
        debugLog("MissionHub mission_hub.glb missing → placeholder", error && error.message);
        const ph = makePlaceholder(THREE); sceneGraph.add(ph.group); model = ph.group; screenMesh = ph.screen;
        setStatus("placeholder", "mission_hub.glb not found — placeholder");
    }
    scene.model = model;
    if (!screenMesh) screenMesh = model;

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

    // ---- Portal: procedural "world inside", aligned to the real screen ----
    const portal = makePortal(THREE);
    portal.mesh.quaternion.copy(sQuat);
    portal.mesh.position.copy(sPos).addScaledVector(sNormal, 0.0004);
    portal.mesh.renderOrder = 1;
    sceneGraph.add(portal.mesh);
    scene.portal = portal;
    scene.disposers.push(() => { portal.mesh.geometry.dispose(); portal.material.dispose(); });

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
    const closeP = new THREE.Vector3().fromArray(CAM.closePos);
    const closeL = new THREE.Vector3().fromArray(CAM.closeLook);
    const anim = { phase: "idle", t: 0, p: 0, carded: false,
                   camStart: new THREE.Vector3(), lookStart: new THREE.Vector3() };

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const targets = [];
    ["PhoneScreen", "PhoneBody", "PhoneFrame"].forEach((n) => {
        const o = model.getObjectByName ? model.getObjectByName(n) : null;
        if (o) o.traverse((c) => { if (c.isMesh) targets.push(c); });
    });
    if (!targets.length) model.traverse((c) => { if (c.isMesh) targets.push(c); });

    const overPhone = (ev) => {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
        ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
        raycaster.setFromCamera(ndc, camera);
        return raycaster.intersectObjects(targets, true).length > 0;
    };
    const startReveal = () => {
        if (anim.phase !== "idle") return;
        anim.phase = "revealing"; anim.t = 0;
        anim.camStart.copy(camera.position); anim.lookStart.copy(wideL);
        if (ui.hint) ui.hint.textContent = "";
        setStatus("revealing", "Looking closer…");
        debugLog("MissionHub reveal start");
    };
    const onMove = (ev) => {
        if (anim.phase !== "idle") { renderer.domElement.style.cursor = "default"; return; }
        renderer.domElement.style.cursor = overPhone(ev) ? "pointer" : "default";
    };
    const onDown = (ev) => { if (anim.phase === "idle" && overPhone(ev)) startReveal(); };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    scene.disposers.push(() => {
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerdown", onDown);
    });

    setStatus(scene.model && scene.model.userData ? "armed" : "armed", "Click the phone to look closer…");

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
    const _look = new THREE.Vector3();
    const fovWide = lensToFov(CAM.wideLens), fovClose = lensToFov(CAM.closeLens);

    const tick = (dt, time) => {
        if (portal) portal.material.uniforms.uTime.value = time;

        if (anim.phase === "idle") {
            _off.set(Math.sin(time * 0.16) * 0.05, Math.cos(time * 0.13) * 0.025, Math.sin(time * 0.1) * 0.04);
            camera.position.copy(wideP).add(_off);
            camera.lookAt(wideL);
            if (camera.fov !== fovWide) { camera.fov = fovWide; camera.updateProjectionMatrix(); }
            if (glass) glass.envMapIntensity = 1.8 + Math.sin(time * 1.4) * 0.12;
            if (portal) portal.material.uniforms.uReveal.value = 0.0;
            return;
        }
        if (anim.phase === "revealing") {
            anim.t += dt / REVEAL_DURATION;
            const raw = clamp01(anim.t), p = smootherstep(raw); anim.p = p;
            camera.position.lerpVectors(anim.camStart, closeP, p);
            _look.lerpVectors(anim.lookStart, closeL, p);
            camera.lookAt(_look);
            camera.fov = lerp(fovWide, fovClose, p); camera.updateProjectionMatrix();
            if (glass) {
                glass.envMapIntensity = lerp(1.8, 0.10, p);
                glass.opacity = lerp(1.0, 0.18, smoothstep01(p));
                glass.roughness = lerp(0.045, 0.16, p);
            }
            if (portal) {
                portal.material.uniforms.uReveal.value = smoothstepRange(0.2, 1.0, p);
                portal.material.uniforms.uParallax.value.set(Math.sin(time * 0.1) * 0.02, p * 0.06);
            }
            setStatus("revealing", revealLabel(p));
            if (raw >= 1) anim.phase = "complete";
            return;
        }
        if (anim.phase === "complete") {
            camera.position.copy(closeP); camera.lookAt(closeL);
            if (portal) portal.material.uniforms.uParallax.value.set(Math.sin(time * 0.08) * 0.015, 0.06);
            if (!anim.carded) {
                anim.carded = true;
                if (ui.card) { ui.card.classList.add("is-visible"); ui.card.setAttribute("aria-hidden", "false"); }
                setStatus("complete", "Bucky world · initializing");
                debugLog("MissionHub intro complete");
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

    // v0.5 — preload seam for the future PHONE-WORLD scene (design-only; no world yet).
    // The room is lightweight and now idle: this is where background loading of the
    // SEPARATE world scene will begin so the click→inside hand-off is instant. Kept
    // inert until the world module exists. See the audit report's preload section.
    schedulePhoneWorldPreload(scene);
}

/**
 * EXTENSION POINT (v0.5, design-only) — background preload of the PHONE-WORLD scene.
 *
 * Architecture intent (NOT implemented here — full design lives in the audit report):
 *   - The Mission Hub ROOM and the PHONE-WORLD are two SEPARATE scenes; the room
 *     stays mounted and lit the whole time.
 *   - While the user looks at the room (idle/armed), the world's GLB/textures/shaders
 *     are fetched + GPU-uploaded in the background via requestIdleCallback, exposing a
 *     promise on `scene.worldPreload`.
 *   - On reveal-complete the already-ready world is swapped in — no fetch, no hitch,
 *     no asset popping.
 * Wiring this must not touch the room's EventBus / mount-update-unmount / dispose
 * contract; teardown should also abort an in-flight preload.
 */
function schedulePhoneWorldPreload(scene) {
    if (!scene || scene.worldPreload !== undefined) return;
    // No world-scene module exists yet — this is the seam where it will plug in.
    // Intended shape (kept inert on purpose):
    //   const idle = (cb) => (window.requestIdleCallback || ((f) => setTimeout(f, 200)))(cb);
    //   scene.worldPreload = new Promise((resolve) => idle(() => resolve(/* loadPhoneWorld(scene.THREE) */ null)));
    scene.worldPreload = null;
}

// ---------------------------------------------------------------------------
// Portal — procedural "world inside the phone"
// ---------------------------------------------------------------------------
const PORTAL_VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;
const PORTAL_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime; uniform float uReveal; uniform vec2 uParallax;
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p);
  float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
  vec2 u=f*f*(3.0-2.0*f); return mix(mix(a,b,u.x),mix(c,d,u.x),u.y); }
float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){v+=a*noise(p);p*=2.0;a*=0.5;} return v; }
float skyline(float x){ float h=0.08;
  h+=0.11*exp(-pow((x-0.28)*7.0,2.0)); h+=0.17*exp(-pow((x-0.50)*8.5,2.0));
  h+=0.09*exp(-pow((x-0.69)*9.0,2.0)); h+=0.05*exp(-pow((x-0.83)*12.0,2.0)); return h; }
void main(){
  vec2 uv=vUv; vec2 p=uv+uParallax; float horizon=0.46;
  vec3 deep=vec3(0.02,0.045,0.09), halo=vec3(0.20,0.55,0.85), core=vec3(1.0,0.82,0.55);
  float above=clamp((uv.y-horizon)/(1.0-horizon),0.0,1.0);
  vec3 col=mix(halo*0.6,deep,above);
  col+=core*exp(-pow((uv.y-horizon)*5.5,2.0))*0.9;
  col+=halo*exp(-pow((uv.y-horizon)*2.2,2.0))*0.5;
  col+=core*exp(-pow(distance(p,vec2(0.5,horizon))*3.4,2.0))*1.2;
  float h1=fbm(vec2(uv.x*3.0,uv.y*3.0)+vec2(uTime*0.02,-uTime*0.015));
  float h2=fbm(vec2(uv.x*6.0-uTime*0.03,uv.y*6.0));
  col+=halo*mix(h1,h2,0.5)*0.18*above;
  float star=pow(hash(floor(uv*vec2(140.0,90.0))),40.0);
  col+=vec3(0.8,0.9,1.0)*star*(0.6+0.4*sin(uTime*2.0+hash(floor(uv*60.0))*30.0))*above*0.7;
  float sk=horizon+skyline(uv.x+uParallax.x*0.5);
  float structure=smoothstep(0.012,0.0,sk-uv.y);
  col=mix(col,deep*0.35,structure*0.92);
  col+=core*exp(-pow((uv.y-sk)*60.0,2.0))*0.5*structure;
  col+=vec3(1.0,0.85,0.6)*step(0.86,hash(floor(vec2(uv.x*90.0,uv.y*120.0))))*structure*0.12;
  col*=mix(0.55,1.0,smoothstep(0.0,0.4,uv.y));
  float edge=smoothstep(0.0,0.05,uv.x)*smoothstep(1.0,0.95,uv.x)*smoothstep(0.0,0.05,uv.y)*smoothstep(1.0,0.95,uv.y);
  float bright=clamp(max(col.r,max(col.g,col.b)),0.0,1.0);
  gl_FragColor=vec4(col*uReveal, uReveal*edge*clamp(0.35+bright,0.0,1.0));
}
`;
function makePortal(THREE) {
    const geo = new THREE.PlaneGeometry(0.066, 0.142, 1, 1);
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uParallax: { value: new THREE.Vector2(0, 0) } },
        vertexShader: PORTAL_VERT, fragmentShader: PORTAL_FRAG,
        transparent: true, depthWrite: false, depthTest: true, toneMapped: false, blending: THREE.NormalBlending
    });
    return { mesh: new THREE.Mesh(geo, material), material };
}

/**
 * v0.5 audit fixes that do NOT require re-exporting the .blend (the GLB is the
 * source of truth for geometry; these are runtime overrides only):
 *  - Hide chair-rig CONTROL gizmos that Blender exported with NO material, so
 *    three.js gives them the default white standard material and they appear as
 *    stray pale shapes on the floor: GearCBS, LevelCBS, Post0CBS, Post_UpnDownCBS.
 *    (The visible chair — Base/Casing/Seat/Wheels/Posts — is untouched.)
 *  - Warm the lamp bulb's white-hot emissive so it reads as a cosy accent rather
 *    than a blue-white orb under bloom, and gently lift the "outside" glow so the
 *    view through the window feels brighter than the room.
 * If the .blend is ever re-exported with these gizmos excluded / the lamp tinted,
 * this becomes a harmless no-op.
 */
function tuneSceneAfterLoad(THREE, root) {
    if (!root || typeof root.getObjectByName !== "function") return;
    ["GearCBS", "LevelCBS", "Post0CBS", "Post_UpnDownCBS"].forEach((name) => {
        const o = root.getObjectByName(name);
        if (o) o.visible = false;
    });
    root.traverse((n) => {
        if (!n.isMesh || !n.material) return;
        (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => {
            if (!m || !m.name) return;
            if (m.name === "Lamp") {                 // the tiny emissive bulb mesh
                m.emissive = new THREE.Color(0xff9d4d);
                if ("emissiveIntensity" in m) m.emissiveIntensity = 2.0;
            } else if (m.name === "OutsideGlow") {   // what's "outside" the window
                m.emissive = new THREE.Color(0x9fb6e0);
                if ("emissiveIntensity" in m) m.emissiveIntensity = 1.5;
            }
        });
    });
}

/** Minimal fallback if the GLB can't load. */
function makePlaceholder(THREE) {
    const group = new THREE.Group();
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x2a1a0e, roughness: 0.6 }));
    desk.position.set(0, 0.74, -1.0); desk.receiveShadow = true; group.add(desk);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.009, 0.150),
        new THREE.MeshStandardMaterial({ color: 0x0a0c10, metalness: 1, roughness: 0.4 }));
    body.name = "PhoneBody"; body.position.set(-0.08, 0.77, -1.02); group.add(body);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.001, 0.142),
        new THREE.MeshStandardMaterial({ color: 0x05070b }));
    screen.name = "PhoneScreen"; screen.position.set(-0.08, 0.775, -1.02); group.add(screen);
    return { group, screen };
}

// ---------------------------------------------------------------------------
// Helpers
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
function revealLabel(p) {
    if (p < 0.25) return "reflection 80% · world 20%";
    if (p < 0.50) return "reflection 50% · world 50%";
    if (p < 0.78) return "reflection 20% · world 80%";
    return "reflection 0% · world 100%";
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
    if (scene.sceneGraph) { try { disposeObject3D(scene.sceneGraph); } catch (e) { logError("MissionHub disposeGraph", e); } scene.sceneGraph = null; }
    if (scene.envTex) { try { scene.envTex.dispose(); } catch (_) {} scene.envTex = null; }
    if (scene.pmrem) { try { scene.pmrem.dispose(); } catch (_) {} scene.pmrem = null; }
    if (scene.draco) { try { scene.draco.dispose(); } catch (_) {} scene.draco = null; }
    if (scene.renderer) {
        try {
            const canvas = scene.renderer.domElement;
            scene.renderer.dispose();
            if (typeof scene.renderer.forceContextLoss === "function") scene.renderer.forceContextLoss();
            if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        } catch (e) { logError("MissionHub disposeRenderer", e); }
        scene.renderer = null;
    }
    scene.model = null; scene.glass = null; scene.portal = null; scene.camera = null; scene.THREE = null;
}
function disposeObject3D(root) {
    if (!root || typeof root.traverse !== "function") return;
    root.traverse((node) => {
        if (node.geometry && typeof node.geometry.dispose === "function") node.geometry.dispose();
        const material = node.material; if (!material) return;
        (Array.isArray(material) ? material : [material]).forEach((mat) => {
            if (!mat) return;
            Object.keys(mat).forEach((k) => { const v = mat[k]; if (v && v.isTexture && typeof v.dispose === "function") v.dispose(); });
            if (typeof mat.dispose === "function") mat.dispose();
        });
    });
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
