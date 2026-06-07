/**
 * Mission Hub app — Cinematic Phone Intro (Phase v0.3).
 *
 * PURPOSE OF THIS PHASE
 * ---------------------
 * This is NOT the world, NOT Arc 1, NOT nodes, NOT missions. It is a single
 * cinematic moment whose only job is to make the player think "…what is inside
 * that phone?". The beat sheet:
 *
 *     Mission Hub opens
 *       → a realistic smartphone lies on a desk in a clean, sunlit room
 *       → the glass screen behaves like real glass: it only shows reflections
 *       → the player clicks the phone
 *       → the camera slowly pushes in toward the screen
 *       → the reflections gradually fade
 *       → a soft, vast, glowing world emerges from inside the device
 *       → the push-in stops on a "WORLD INITIALIZATION · COMING SOON" card
 *
 * The intended feeling is wonder / mystery / discovery — an Apple-keynote /
 * Pixar-reveal mood — NOT horror, NOT neon cyberpunk overload.
 *
 * ARCHITECTURE (deliberately unchanged from the v0.2 prototype)
 * ------------------------------------------------------------
 * - Standard app contract. Exports createState / render / mount / unmount,
 *   exactly like every other module under vm/apps/. It never manages window
 *   chrome, z-order, drag, or maximize (see docs/architecture/app-system.md,
 *   desktop-shell.md). Registered in vmRuntime.js.
 * - Live app, mounted once. `render` returns a stable, empty stage; the WebGL
 *   context + scene graph + animation loop are built imperatively in `mount`,
 *   which runs exactly once. The body is never rebuilt on resize/maximize, so
 *   the GL context survives every geometry change.
 * - Three.js is loaded on demand from a pinned CDN (esm.sh), adding zero weight
 *   to VM boot and staying GitHub-Pages-safe (no build step). Offline → the app
 *   degrades to a readable message instead of crashing the desktop.
 * - Asset path resolved via import.meta.url → site/vm/assets/models/, so it
 *   works under any GitHub Pages base path. No absolute paths hardcoded.
 * - Resize observed (one ResizeObserver), not polled.
 * - Deterministic teardown: the animation loop is stopped, every renderer /
 *   geometry / material / texture / environment map is disposed, pointer
 *   listeners are removed, and an async guard (`scene.disposed`) makes closing
 *   the window mid-load tear down cleanly.
 *
 * WHERE THE EFFECT LIVES (and why)
 * --------------------------------
 * A .glb is a *static* asset — it cannot do camera-distance-driven shader
 * animation. So the model carries only geometry + PBR materials (room, desk,
 * props, and the hero phone with a named `PhoneScreen` mesh). The reflection
 * illusion is composed at runtime:
 *   - Reflections come from a procedurally generated studio environment
 *     (RoomEnvironment → PMREM) — premium glass reflections with no external
 *     HDRI to ship.
 *   - The "world inside" is a self-contained GLSL portal plane sitting just
 *     under the glass. It is procedural (no second render pass, no render
 *     target) and is naturally clipped to the screen rectangle.
 *   - A single eased progress value drives BOTH the camera dolly and the
 *     crossfade: glass reflectivity/opacity fall while the portal reveals.
 *
 * OUT OF SCOPE (future phases, intentionally absent): the world itself, Arc 1,
 * nodes, portals-as-gameplay, NPCs, progression, rewards, backend APIs.
 */
import { debugLog, logError } from "../core/diagnostics.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Pinned Three.js version. esm.sh serves the core build and the jsm addons
// from the SAME pinned version, so the addons' internal `import 'three'`
// resolves to one shared instance — no "multiple instances" warning.
const THREE_VERSION = "0.160.0";
const THREE_CORE_URL = `https://esm.sh/three@${THREE_VERSION}`;
const GLTF_LOADER_URL = `https://esm.sh/three@${THREE_VERSION}/examples/jsm/loaders/GLTFLoader.js`;
const ROOM_ENV_URL = `https://esm.sh/three@${THREE_VERSION}/examples/jsm/environments/RoomEnvironment.js`;

// Runtime-reachable model, resolved relative to THIS module so it works under
// any GitHub Pages base path. assets/models/phone_intro.glb (repo root) is the
// authoring source-of-truth; this is the deployed copy the browser fetches.
const MODEL_URL = new URL("../assets/models/phone_intro.glb", import.meta.url).href;

const STYLE_ELEMENT_ID = "vm-missionhub-styles";

// Seconds for the click → push-in reveal.
const REVEAL_DURATION = 3.8;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Per-window app state. Intentionally tiny and serialisable-friendly: the live
 * Three.js objects live on `windowState.view` (the shell's transient slot),
 * never here, so this state stays pure data.
 */
export function createMissionHubState() {
    return {
        // "loading" | "armed" | "revealing" | "complete" | "placeholder" | "error"
        status: "loading",
        detail: "Starting cinematic runtime…"
    };
}

// ---------------------------------------------------------------------------
// Rendering (markup only — the scene is built imperatively in mount)
// ---------------------------------------------------------------------------

export function renderMissionHubApp(runtime, windowState) {
    const state = windowState.appState || {};
    injectStyles();
    return `
        <div class="vm-missionhub" data-missionhub-root>
            <div class="vm-missionhub-stage" data-missionhub-stage></div>
            <div class="vm-missionhub-portalcard" data-missionhub-card aria-hidden="true">
                <div class="vm-missionhub-portalcard-inner">
                    <span class="vm-missionhub-card-kicker">World Initialization</span>
                    <span class="vm-missionhub-card-title">COMING SOON</span>
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

/**
 * Mount the cinematic scene into the window body. Called once by the runtime
 * when the window element is created. Asynchronous because Three.js is loaded
 * on demand; every async step re-checks `scene.disposed`.
 */
export function mountMissionHubApp(runtime, windowState, element) {
    const view = windowState.view || (windowState.view = {});
    view.cleanups = view.cleanups || [];

    const stage = element.querySelector("[data-missionhub-stage]");
    const statusLine = element.querySelector("[data-missionhub-statusline]");
    const card = element.querySelector("[data-missionhub-card]");
    const hint = element.querySelector("[data-missionhub-hint]");
    if (!stage) {
        logError("MissionHub mount", new Error("stage element missing"));
        return;
    }

    // The teardown handle. Created NOW (synchronously) so unmount always has a
    // disposer to call even if it fires before the async build finishes.
    const scene = {
        disposed: false,
        THREE: null,
        renderer: null,
        sceneGraph: null,
        camera: null,
        model: null,
        glass: null,
        portal: null,
        envTex: null,
        pmrem: null,
        resizeObserver: null,
        disposers: []
    };
    view.scene = scene;

    const setStatus = (status, detail) => {
        if (windowState.appState) {
            windowState.appState.status = status;
            windowState.appState.detail = detail;
        }
        if (statusLine) statusLine.textContent = detail;
    };

    // Kick off the async build (not awaited — runtime mount is synchronous).
    buildScene(scene, stage, setStatus, { card, hint }).catch((error) => {
        logError("MissionHub buildScene", error);
        setStatus("error", "3D runtime unavailable — check your connection and reopen.");
    });
}

/**
 * Tear down everything the scene allocated. Safe at any point in the lifecycle,
 * including before the async build finishes. Idempotent.
 */
export function unmountMissionHubApp(runtime, windowState) {
    const view = windowState.view || {};
    const scene = view.scene;
    (view.cleanups || []).forEach((cleanup) => {
        try { cleanup(); } catch (error) { logError("MissionHub cleanup", error); }
    });
    view.cleanups = [];
    if (scene) {
        disposeScene(scene);
        view.scene = null;
    }
    debugLog("MissionHub unmounted", windowState.id);
}

// ---------------------------------------------------------------------------
// Scene construction
// ---------------------------------------------------------------------------

async function buildScene(scene, stage, setStatus, ui) {
    // 1) Load Three.js + addons on demand (shared core instance via esm.sh).
    let THREE, GLTFLoader, RoomEnvironment;
    try {
        [THREE, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([
            import(/* @vite-ignore */ THREE_CORE_URL),
            import(/* @vite-ignore */ GLTF_LOADER_URL),
            import(/* @vite-ignore */ ROOM_ENV_URL)
        ]);
    } catch (error) {
        throw new Error(`Three.js failed to load: ${error && error.message}`);
    }
    if (scene.disposed) return;
    scene.THREE = THREE;

    // 2) Renderer — premium colour pipeline, pixel ratio capped for retina/iPad.
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.classList.add("vm-missionhub-canvas");
    renderer.domElement.style.touchAction = "none"; // app owns touch gestures
    stage.appendChild(renderer.domElement);
    scene.renderer = renderer;

    // 3) Scene + soft neutral background with gentle depth fog.
    const sceneGraph = new THREE.Scene();
    sceneGraph.background = new THREE.Color(0x0c0e12);
    sceneGraph.fog = new THREE.Fog(0x0c0e12, 2.6, 7.5);
    scene.sceneGraph = sceneGraph;

    // 4) Environment — procedural studio (RoomEnvironment → PMREM). Drives the
    //    glass + metal reflections; no external HDRI file is shipped.
    const pmrem = new THREE.PMREMGenerator(renderer);
    let envTex = null;
    try {
        const roomEnv = new RoomEnvironment();
        envTex = pmrem.fromScene(roomEnv, 0.04).texture;
        sceneGraph.environment = envTex;
        if (typeof roomEnv.dispose === "function") roomEnv.dispose();
    } catch (error) {
        debugLog("MissionHub environment unavailable", error && error.message);
    }
    scene.pmrem = pmrem;
    scene.envTex = envTex;

    // 5) Camera (driven on rails; user does not orbit during the intro).
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 100);
    scene.camera = camera;

    // 6) Lighting — soft daylight key (from the window), cool sky fill, ambient
    //    hemisphere. Shadows are cheap at this poly count and ground the phone.
    const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x191b22, 0.5);
    sceneGraph.add(hemi);

    const key = new THREE.DirectionalLight(0xfff1dd, 2.6);
    key.position.set(0.4, 1.9, -0.5); // streaming in from the window
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    {
        const c = key.shadow.camera;
        c.near = 0.4; c.far = 6.5;
        c.left = -1.1; c.right = 1.1; c.top = 1.1; c.bottom = -1.1;
        c.updateProjectionMatrix();
    }
    sceneGraph.add(key);
    sceneGraph.add(key.target);

    const fill = new THREE.DirectionalLight(0xaecbff, 0.55);
    fill.position.set(-1.0, 1.3, 1.3);
    sceneGraph.add(fill);

    // 7) Load the phone scene; fall back to a procedural phone if the GLB is
    //    missing, so the whole effect still works before any export exists.
    setStatus("loading", "Loading scene…");
    let model = null;
    let screenMesh = null;
    let isPlaceholder = false;
    try {
        const gltf = await loadGltf(GLTFLoader, MODEL_URL);
        if (scene.disposed) { disposeObject3D(gltf.scene); return; }
        model = gltf.scene;
        model.traverse((node) => {
            if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
        });
        sceneGraph.add(model);
        screenMesh = model.getObjectByName("PhoneScreen");
        debugLog("MissionHub GLB loaded", MODEL_URL);
    } catch (error) {
        if (scene.disposed) return;
        debugLog("MissionHub phone_intro.glb missing → placeholder", error && error.message);
        const ph = makePlaceholderPhone(THREE);
        sceneGraph.add(ph.group);
        model = ph.group;
        screenMesh = ph.screen;
        isPlaceholder = true;
    }
    scene.model = model;
    if (!screenMesh) screenMesh = model; // extreme fallback

    // Point the key light at the phone for a grounded contact shadow.
    screenMesh.updateWorldMatrix(true, true);
    const sc = new THREE.Vector3();
    screenMesh.getWorldPosition(sc);
    key.target.position.copy(sc);
    key.target.updateMatrixWorld();

    // 8) Glass — replace the screen material with physically based glass that
    //    reflects the studio environment. envMapIntensity / opacity / roughness
    //    are animated down during the reveal so reflections give way to the
    //    world beneath.
    const glass = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0x05070b),
        metalness: 0.0,
        roughness: 0.06,
        ior: 1.5,
        clearcoat: 1.0,
        clearcoatRoughness: 0.06,
        reflectivity: 0.9,
        envMap: envTex,
        envMapIntensity: 1.7,
        transparent: true,
        opacity: 1.0,
        depthWrite: false
    });
    applyMaterial(screenMesh, glass);
    screenMesh.renderOrder = 2;
    scene.glass = glass;

    // 9) Portal — the procedural "world inside". A plane coincident with the
    //    glass, drawn first, revealed as the glass fades.
    const portal = makePortal(THREE, sc);
    sceneGraph.add(portal.mesh);
    scene.portal = portal;
    scene.disposers.push(() => {
        portal.mesh.geometry.dispose();
        portal.material.dispose();
    });

    // 10) Camera waypoints, derived from the screen's world position so the
    //     framing is robust to the GLB's scale/placement.
    const wp = {
        camWide: new THREE.Vector3(sc.x + 0.85, sc.y + 0.34, sc.z + 1.22),
        lookWide: new THREE.Vector3(sc.x + 0.00, sc.y - 0.04, sc.z - 0.18),
        camClose: new THREE.Vector3(sc.x + 0.012, sc.y + 0.165, sc.z + 0.140),
        lookClose: sc.clone()
    };
    camera.position.copy(wp.camWide);
    camera.lookAt(wp.lookWide);

    const anim = { phase: "idle", t: 0, p: 0, carded: false, camStart: new THREE.Vector3(), lookStart: new THREE.Vector3() };

    setStatus(isPlaceholder ? "placeholder" : "armed",
        isPlaceholder ? "Placeholder phone (phone_intro.glb not found) — click it"
                      : "Click the phone to look closer…");

    // 11) Interaction — raycast the phone; click starts the reveal once.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const targets = [];
    ["PhoneScreen", "PhoneBody", "PhoneFrame"].forEach((name) => {
        const obj = model.getObjectByName ? model.getObjectByName(name) : null;
        if (obj) obj.traverse((c) => { if (c.isMesh) targets.push(c); });
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
        anim.phase = "revealing";
        anim.t = 0;
        anim.camStart.copy(camera.position);
        anim.lookStart.copy(wp.lookWide);
        if (ui.hint) ui.hint.textContent = "";
        setStatus("revealing", "Looking closer…");
        debugLog("MissionHub reveal start");
    };
    const onMove = (ev) => {
        if (anim.phase !== "idle") { renderer.domElement.style.cursor = "default"; return; }
        renderer.domElement.style.cursor = overPhone(ev) ? "pointer" : "default";
    };
    const onDown = (ev) => {
        if (anim.phase !== "idle") return;
        if (overPhone(ev)) startReveal();
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    scene.disposers.push(() => {
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerdown", onDown);
    });

    if (scene.disposed) return;

    // 12) Responsive sizing — one ResizeObserver covers resize / maximize /
    //     restore / mode change / tablet orientation.
    const resize = () => {
        if (scene.disposed || !scene.renderer || !scene.camera) return;
        const w = Math.max(1, stage.clientWidth);
        const h = Math.max(1, stage.clientHeight);
        scene.renderer.setSize(w, h);
        scene.camera.aspect = w / h;
        scene.camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    scene.resizeObserver = resizeObserver;
    resize();

    // 13) Per-frame update + render. Reusable temporaries avoid per-frame allocs.
    const clock = new THREE.Clock();
    const _off = new THREE.Vector3();
    const _look = new THREE.Vector3();

    const tick = (dt, time) => {
        if (portal) portal.material.uniforms.uTime.value = time;

        if (anim.phase === "idle") {
            // Gentle drift so the establishing shot feels alive.
            const a = time * 0.16;
            _off.set(Math.sin(a) * 0.05, Math.cos(a * 0.8) * 0.022, Math.sin(a * 0.6) * 0.03);
            camera.position.copy(wp.camWide).add(_off);
            camera.lookAt(wp.lookWide);
            // A barely-there breathing highlight invites a click without neon.
            if (glass) glass.envMapIntensity = 1.7 + Math.sin(time * 1.5) * 0.12;
            if (portal) portal.material.uniforms.uReveal.value = 0.0;
            return;
        }

        if (anim.phase === "revealing") {
            anim.t += dt / REVEAL_DURATION;
            const raw = clamp01(anim.t);
            const p = smootherstep(raw);
            anim.p = p;

            camera.position.lerpVectors(anim.camStart, wp.camClose, p);
            _look.lerpVectors(anim.lookStart, wp.lookClose, p);
            camera.lookAt(_look);

            if (glass) {
                glass.envMapIntensity = lerp(1.7, 0.10, p); // reflections fall away
                glass.opacity = lerp(1.0, 0.20, smoothstep01(p));
                glass.roughness = lerp(0.06, 0.16, p);
            }
            if (portal) {
                portal.material.uniforms.uReveal.value = smoothstepRange(0.18, 1.0, p);
                portal.material.uniforms.uParallax.value.set(Math.sin(time * 0.1) * 0.02, p * 0.06);
            }
            setStatus("revealing", revealLabel(p));

            if (raw >= 1) anim.phase = "complete";
            return;
        }

        if (anim.phase === "complete") {
            camera.position.copy(wp.camClose);
            camera.lookAt(wp.lookClose);
            if (portal) portal.material.uniforms.uParallax.value.set(Math.sin(time * 0.08) * 0.015, 0.06);
            if (!anim.carded) {
                anim.carded = true;
                if (ui.card) { ui.card.classList.add("is-visible"); ui.card.setAttribute("aria-hidden", "false"); }
                setStatus("complete", "World initialization · coming soon");
                debugLog("MissionHub intro complete");
            }
        }
    };

    renderer.setAnimationLoop(() => {
        if (scene.disposed) return;
        tick(clock.getDelta(), clock.elapsedTime);
        renderer.render(sceneGraph, camera);
    });
    debugLog("MissionHub cinematic scene running");
}

/** Promise wrapper around GLTFLoader.load. */
function loadGltf(GLTFLoader, url) {
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
    });
}

/** Replace every material on a mesh (or mesh subtree) with `mat`. */
function applyMaterial(target, mat) {
    target.traverse((node) => {
        if (!node.isMesh) return;
        if (Array.isArray(node.material)) node.material = node.material.map(() => mat);
        else node.material = mat;
    });
    if (target.isMesh && target.material !== mat) target.material = mat;
}

// ---------------------------------------------------------------------------
// The portal — a procedural "world inside the phone"
// ---------------------------------------------------------------------------

const PORTAL_VERT = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Authored in display space; toneMapped:false + raw gl_FragColor means colours
// land on screen as written. Soft luminous blues with a warm core, drifting
// haze, faint stars, and a few huge silhouettes against the glow — wonder, not
// neon. `uReveal` fades the whole world in.
const PORTAL_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uReveal;
uniform vec2  uParallax;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
    return v;
}
float skyline(float x){
    float h = 0.08;
    h += 0.11 * exp(-pow((x - 0.28) * 7.0, 2.0));
    h += 0.17 * exp(-pow((x - 0.50) * 8.5, 2.0));
    h += 0.09 * exp(-pow((x - 0.69) * 9.0, 2.0));
    h += 0.05 * exp(-pow((x - 0.83) * 12.0, 2.0));
    return h;
}
void main() {
    vec2 uv = vUv;
    vec2 p  = uv + uParallax;

    float horizon = 0.46;
    vec3 deep = vec3(0.02, 0.045, 0.09);
    vec3 halo = vec3(0.20, 0.55, 0.85);
    vec3 core = vec3(1.00, 0.82, 0.55);

    float above = clamp((uv.y - horizon) / (1.0 - horizon), 0.0, 1.0);
    vec3 col = mix(halo * 0.6, deep, above);

    float band = exp(-pow((uv.y - horizon) * 5.5, 2.0));
    col += core * band * 0.9;
    col += halo * exp(-pow((uv.y - horizon) * 2.2, 2.0)) * 0.5;

    float sun = exp(-pow(distance(p, vec2(0.5, horizon)) * 3.4, 2.0));
    col += core * sun * 1.2;

    float h1 = fbm(vec2(uv.x * 3.0, uv.y * 3.0) + vec2(uTime * 0.02, -uTime * 0.015));
    float h2 = fbm(vec2(uv.x * 6.0 - uTime * 0.03, uv.y * 6.0));
    float haze = mix(h1, h2, 0.5);
    col += halo * haze * 0.18 * above;

    float star = pow(hash(floor(uv * vec2(140.0, 90.0))), 40.0);
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + hash(floor(uv * 60.0)) * 30.0);
    col += vec3(0.8, 0.9, 1.0) * star * tw * above * 0.7;

    float sk = horizon + skyline(uv.x + uParallax.x * 0.5);
    float structure = smoothstep(0.012, 0.0, sk - uv.y);
    float rim = exp(-pow((uv.y - sk) * 60.0, 2.0));
    col = mix(col, deep * 0.35, structure * 0.92);
    col += core * rim * 0.5 * structure;
    float win = step(0.86, hash(floor(vec2(uv.x * 90.0, uv.y * 120.0))));
    col += vec3(1.0, 0.85, 0.6) * win * structure * 0.12;

    col *= mix(0.55, 1.0, smoothstep(0.0, 0.4, uv.y));

    float edge = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x)
               * smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
    float bright = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    float alpha = uReveal * edge * clamp(0.35 + bright, 0.0, 1.0);
    col *= uReveal;

    gl_FragColor = vec4(col, alpha);
}
`;

function makePortal(THREE, sc) {
    const geo = new THREE.PlaneGeometry(0.066, 0.140, 1, 1);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uReveal: { value: 0 },
            uParallax: { value: new THREE.Vector2(0, 0) }
        },
        vertexShader: PORTAL_VERT,
        fragmentShader: PORTAL_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
        blending: THREE.NormalBlending
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.rotation.x = -Math.PI / 2;                  // lie flat, normal +Y (like the glass)
    // Sit within the glass volume but clearly above the opaque body top, so the
    // world never z-fights with the phone shell. Compositing order vs the glass
    // is controlled by renderOrder (both are depthWrite:false), not by depth.
    mesh.position.set(sc.x, sc.y + 0.0003, sc.z);
    mesh.renderOrder = 1;
    return { mesh, material };
}

/**
 * Procedural fallback phone (rounded body + named screen + a slab of desk) used
 * when phone_intro.glb is unavailable, so the cinematic still plays.
 */
function makePlaceholderPhone(THREE) {
    const group = new THREE.Group();

    const desk = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.05, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x53361c, roughness: 0.6, metalness: 0.0 })
    );
    desk.position.set(0, 0.725, 0.0);
    desk.receiveShadow = true;
    group.add(desk);

    const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.072, 0.0085, 0.150),
        new THREE.MeshStandardMaterial({ color: 0x0a0c10, metalness: 1.0, roughness: 0.38 })
    );
    body.name = "PhoneBody";
    body.position.set(0, 0.7543, -0.10);
    body.castShadow = true; body.receiveShadow = true;
    group.add(body);

    const screen = new THREE.Mesh(
        new THREE.BoxGeometry(0.066, 0.001, 0.140),
        new THREE.MeshStandardMaterial({ color: 0x05070b, metalness: 0.0, roughness: 0.06 })
    );
    screen.name = "PhoneScreen";
    screen.position.set(0, 0.7592, -0.10);
    group.add(screen);

    return { group, screen };
}

// ---------------------------------------------------------------------------
// Easing helpers
// ---------------------------------------------------------------------------

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep01(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
function smootherstep(x) { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); }
function smoothstepRange(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

/** Status-line nod to the brief's reflection→world crossfade. */
function revealLabel(p) {
    if (p < 0.25) return "reflection 80% · world 20%";
    if (p < 0.50) return "reflection 50% · world 50%";
    if (p < 0.78) return "reflection 20% · world 80%";
    return "reflection 0% · world 100%";
}

// ---------------------------------------------------------------------------
// Disposal — no GPU leaks, no zombie loops
// ---------------------------------------------------------------------------

function disposeScene(scene) {
    if (!scene || scene.disposed) {
        if (scene) scene.disposed = true;
        return;
    }
    scene.disposed = true;

    if (scene.renderer) {
        try { scene.renderer.setAnimationLoop(null); } catch (_) { /* noop */ }
    }
    (scene.disposers || []).forEach((fn) => { try { fn(); } catch (error) { logError("MissionHub disposer", error); } });
    scene.disposers = [];

    if (scene.resizeObserver) {
        try { scene.resizeObserver.disconnect(); } catch (_) { /* noop */ }
        scene.resizeObserver = null;
    }
    if (scene.sceneGraph) {
        try { disposeObject3D(scene.sceneGraph); } catch (error) { logError("MissionHub disposeGraph", error); }
        scene.sceneGraph = null;
    }
    if (scene.envTex) {
        try { scene.envTex.dispose(); } catch (_) { /* noop */ }
        scene.envTex = null;
    }
    if (scene.pmrem) {
        try { scene.pmrem.dispose(); } catch (_) { /* noop */ }
        scene.pmrem = null;
    }
    if (scene.renderer) {
        try {
            const canvas = scene.renderer.domElement;
            scene.renderer.dispose();
            if (typeof scene.renderer.forceContextLoss === "function") {
                scene.renderer.forceContextLoss();
            }
            if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        } catch (error) {
            logError("MissionHub disposeRenderer", error);
        }
        scene.renderer = null;
    }
    scene.model = null;
    scene.glass = null;
    scene.portal = null;
    scene.camera = null;
    scene.THREE = null;
}

/** Recursively dispose geometries, materials and their textures. */
function disposeObject3D(root) {
    if (!root || typeof root.traverse !== "function") return;
    root.traverse((node) => {
        if (node.geometry && typeof node.geometry.dispose === "function") {
            node.geometry.dispose();
        }
        const material = node.material;
        if (!material) return;
        const materials = Array.isArray(material) ? material : [material];
        materials.forEach((mat) => {
            if (!mat) return;
            Object.keys(mat).forEach((key) => {
                const value = mat[key];
                if (value && value.isTexture && typeof value.dispose === "function") {
                    value.dispose();
                }
            });
            if (typeof mat.dispose === "function") mat.dispose();
        });
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeText(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/** Inject the app's scoped styles once (keeps the module self-contained). */
function injectStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ELEMENT_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    style.textContent = `
.vm-missionhub {
    position: relative;
    width: 100%;
    height: 100%;
    background: #0c0e12;
    overflow: hidden;
}
.vm-missionhub-stage {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}
.vm-missionhub-canvas {
    display: block;
    width: 100%;
    height: 100%;
}
.vm-missionhub-portalcard {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    opacity: 0;
    transition: opacity 1.1s ease;
    z-index: 3;
}
.vm-missionhub-portalcard.is-visible { opacity: 1; }
.vm-missionhub-portalcard-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    text-align: center;
    padding: 18px 32px;
    border-radius: 16px;
    background: radial-gradient(120% 120% at 50% 30%, rgba(24,46,78,.34), rgba(5,9,18,0));
    font-family: "Segoe UI", system-ui, sans-serif;
}
.vm-missionhub-card-kicker {
    font-size: 11px;
    letter-spacing: 4px;
    text-transform: uppercase;
    color: #9fd8ff;
}
.vm-missionhub-card-title {
    font-size: 30px;
    letter-spacing: 6px;
    font-weight: 600;
    color: #eaf6ff;
    text-shadow: 0 0 24px rgba(120,200,255,.55);
}
.vm-missionhub-card-sub {
    font-size: 12px;
    letter-spacing: 1px;
    color: rgba(220,235,255,.72);
}
.vm-missionhub-hud {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px;
    border: 1px solid rgba(120,200,255,.26);
    border-radius: 10px;
    background: rgba(8,12,20,.52);
    backdrop-filter: blur(6px);
    pointer-events: none;
    font-family: "Segoe UI", system-ui, sans-serif;
    z-index: 2;
}
.vm-missionhub-tag {
    font-size: 10px;
    letter-spacing: 1.6px;
    color: #7fd0ff;
}
.vm-missionhub-status {
    font-size: 12px;
    color: #eaf6ff;
}
.vm-missionhub-hint {
    font-size: 10px;
    color: rgba(220,235,255,.55);
}
    `;
    document.head.appendChild(style);
}
