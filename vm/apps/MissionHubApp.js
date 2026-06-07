/**
 * Mission Hub app — Three.js rendering prototype (v0.1 + v0.2).
 *
 * PURPOSE OF THIS PHASE
 * ---------------------
 * This app exists to prove ONE thing: that a Three.js scene can live inside a
 * standard Bucky VM application window and obey the VM's full window lifecycle
 * (mount / resize / maximize / restore / unmount) without leaking GPU
 * resources or zombie render loops. It is deliberately NOT a mission engine.
 * There is no progression, no nodes, no backend, no gameplay — only the
 * rendering pipeline:
 *
 *     Desktop → Mission Hub → Three.js scene → ground plane → Bucky (GLB / sphere)
 *
 * ARCHITECTURE NOTES (why it is written this way)
 * -----------------------------------------------
 * - Standard app contract. Like every other app under vm/apps/, this module
 *   exports createState / render / mount / unmount. It NEVER manages its own
 *   window chrome, z-order, drag, or maximize — those are inherited from the
 *   shell (see docs/architecture/desktop-shell.md, app-system.md).
 *
 * - Live app, mounted once. `render` returns a stable, empty stage container.
 *   All the heavy lifting (WebGL context, scene graph, animation loop) is set
 *   up imperatively in `mount`, which the runtime calls exactly once when the
 *   window element enters the DOM. The window body is never rebuilt on
 *   resize/maximize (the shell only patches the window's box), so the canvas
 *   and its GL context survive every geometry change.
 *
 * - Three.js is loaded on demand. The library is dynamically imported from a
 *   pinned CDN the first time the app opens, so it adds ZERO weight to VM boot
 *   and to every other app. This matches the project's existing CDN convention
 *   (index.html already loads GSAP from a CDN) and stays GitHub-Pages-safe
 *   (pure static hosting, no build step). If the import fails (offline), the
 *   app degrades to a readable message instead of crashing the desktop.
 *
 * - Asset path is resolved relatively. The model URL is computed from
 *   `import.meta.url`, so it resolves to site/vm/assets/models/bucky.glb
 *   regardless of where the site is hosted (GitHub Pages project subpath,
 *   custom domain, or localhost). No absolute paths are hardcoded.
 *
 * - Resize is observed, not polled. A single ResizeObserver on the stage
 *   element catches EVERY cause of a size change — window resize, maximize,
 *   restore, embedded↔expanded mode, tablet/mobile orientation — and updates
 *   the renderer + camera aspect. This is the one robust mechanism that covers
 *   all of the brief's responsive requirements at once.
 *
 * - Deterministic teardown. `unmount` stops the animation loop, disposes the
 *   renderer / geometries / materials / textures / controls, disconnects the
 *   ResizeObserver, removes the canvas, and nulls every reference. An async
 *   guard (`scene.disposed`) ensures that closing the window mid-load tears
 *   down cleanly even if Three.js or the GLB is still in flight.
 *
 * OUT OF SCOPE (future phases, intentionally absent): missions, nodes, portals,
 * NPCs, progression, rewards, multiplayer, backend APIs, mission data.
 */
import { debugLog, logError } from "../core/diagnostics.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Pinned Three.js version. esm.sh serves the core build and the jsm addons
// (OrbitControls, GLTFLoader) from the SAME pinned version, so the addons'
// internal `import 'three'` resolves to one shared instance — no "multiple
// instances of Three.js" warning, no import map required in the host page.
const THREE_VERSION = "0.160.0";
const THREE_CORE_URL = `https://esm.sh/three@${THREE_VERSION}`;
const ORBIT_CONTROLS_URL = `https://esm.sh/three@${THREE_VERSION}/examples/jsm/controls/OrbitControls.js`;
const GLTF_LOADER_URL = `https://esm.sh/three@${THREE_VERSION}/examples/jsm/loaders/GLTFLoader.js`;

// Runtime-reachable model, resolved relative to THIS module so it works under
// any GitHub Pages base path. The repo-root assets/models/bucky.glb is the
// authoring source-of-truth; this is the deployed copy the browser fetches.
const MODEL_URL = new URL("../assets/models/bucky.glb", import.meta.url).href;

const STYLE_ELEMENT_ID = "vm-missionhub-styles";

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
        // "loading" | "ready" | "placeholder" | "error"
        status: "loading",
        // Human-readable detail shown in the HUD status line.
        detail: "Starting 3D runtime…"
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
            <div class="vm-missionhub-hud" data-missionhub-hud>
                <span class="vm-missionhub-tag">MISSION HUB · v0.2 PROTOTYPE</span>
                <span class="vm-missionhub-status" data-missionhub-statusline>${escapeText(state.detail || "")}</span>
                <span class="vm-missionhub-hint">drag to orbit · scroll to zoom</span>
            </div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Mount the Three.js scene into the window body. Called once by the runtime
 * when the window element is created. Asynchronous because Three.js is loaded
 * on demand; every async step re-checks `scene.disposed` so a window closed
 * mid-load tears down cleanly.
 */
export function mountMissionHubApp(runtime, windowState, element) {
    const view = windowState.view || (windowState.view = {});
    view.cleanups = view.cleanups || [];

    const stage = element.querySelector("[data-missionhub-stage]");
    const statusLine = element.querySelector("[data-missionhub-statusline]");
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
        controls: null,
        resizeObserver: null,
        bucky: null
    };
    view.scene = scene;

    const setStatus = (status, detail) => {
        if (windowState.appState) {
            windowState.appState.status = status;
            windowState.appState.detail = detail;
        }
        if (statusLine) statusLine.textContent = detail;
    };

    // Kick off the async build. We deliberately do NOT await it here — the
    // runtime's mount call is synchronous and its result is ignored; errors are
    // contained by the try/catch inside buildScene.
    buildScene(scene, stage, setStatus).catch((error) => {
        logError("MissionHub buildScene", error);
        setStatus("error", "3D runtime unavailable — check your connection and reopen.");
        // Leave whatever partial state exists to be cleaned by unmount.
    });
}

/**
 * Tear down everything the scene allocated. Safe to call at any point in the
 * lifecycle, including before the async build has finished. Idempotent.
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

async function buildScene(scene, stage, setStatus) {
    // 1) Load Three.js + addons on demand. esm.sh shares the core instance
    //    across the addons, so OrbitControls/GLTFLoader use the same THREE.
    let THREE, OrbitControls, GLTFLoader;
    try {
        [THREE, { OrbitControls }, { GLTFLoader }] = await Promise.all([
            import(/* @vite-ignore */ THREE_CORE_URL),
            import(/* @vite-ignore */ ORBIT_CONTROLS_URL),
            import(/* @vite-ignore */ GLTF_LOADER_URL)
        ]);
    } catch (error) {
        throw new Error(`Three.js failed to load: ${error && error.message}`);
    }
    if (scene.disposed) return; // window closed during import
    scene.THREE = THREE;

    // 2) Renderer. Pixel ratio capped at 2 to stay lightweight on retina/iPad.
    const { clientWidth, clientHeight } = stage;
    const width = Math.max(1, clientWidth);
    const height = Math.max(1, clientHeight);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.classList.add("vm-missionhub-canvas");
    // touch-action:none lets OrbitControls own touch gestures (iPad/mobile)
    // without the surrounding page trying to scroll/zoom.
    renderer.domElement.style.touchAction = "none";
    stage.appendChild(renderer.domElement);
    scene.renderer = renderer;

    // 3) Scene + simple cyberpunk-tinted background and depth fog.
    const sceneGraph = new THREE.Scene();
    sceneGraph.background = new THREE.Color(0x05070f);
    sceneGraph.fog = new THREE.Fog(0x05070f, 14, 34);
    scene.sceneGraph = sceneGraph;

    // 4) Perspective camera.
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(4.5, 3.2, 6.0);
    scene.camera = camera;

    // 5) Lighting — ambient fill + directional key (no shadow maps: lightweight).
    const ambient = new THREE.AmbientLight(0x88aacc, 0.65);
    sceneGraph.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 1.15);
    directional.position.set(5, 8, 4);
    sceneGraph.add(directional);

    // 6) Ground plane + on-theme grid (both lightweight).
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        new THREE.MeshStandardMaterial({ color: 0x0c1424, roughness: 0.95, metalness: 0.0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    sceneGraph.add(ground);

    const grid = new THREE.GridHelper(40, 40, 0x32d6ff, 0x163049);
    grid.position.y = 0.001; // avoid z-fighting with the plane
    sceneGraph.add(grid);

    // 7) OrbitControls — damped, with sensible limits so the camera can't fly
    //    under the floor or zoom into/away from the subject unboundedly.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 1, 0);
    controls.minDistance = 2.5;
    controls.maxDistance = 18;
    controls.maxPolarAngle = Math.PI * 0.495; // stay just above the horizon
    controls.update();
    scene.controls = controls;

    // 8) Bucky — load the GLB; fall back to a clearly-Bucky red sphere if the
    //    asset is missing or fails to parse. The placeholder guarantees the app
    //    is visually correct before any Blender export exists.
    setStatus("loading", "Loading bucky.glb…");
    try {
        const gltf = await loadGltf(GLTFLoader, MODEL_URL);
        if (scene.disposed) {
            disposeObject3D(gltf.scene);
            return;
        }
        const bucky = frameModel(THREE, gltf.scene, controls, camera);
        sceneGraph.add(bucky);
        scene.bucky = bucky;
        setStatus("ready", "Bucky loaded from bucky.glb");
        debugLog("MissionHub GLB loaded", MODEL_URL);
    } catch (error) {
        if (scene.disposed) return;
        debugLog("MissionHub GLB missing → placeholder", error && error.message);
        const placeholder = makeBuckyPlaceholder(THREE);
        sceneGraph.add(placeholder);
        scene.bucky = placeholder;
        setStatus("placeholder", "bucky.glb not found — showing placeholder Bucky");
    }

    if (scene.disposed) return;

    // 9) Responsive sizing. One ResizeObserver covers resize, maximize,
    //    restore, mode change, tablet/mobile and orientation changes.
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
    resize(); // correct for any size change that happened during async load

    // 10) Animation loop via setAnimationLoop (cleanly stopped with null on
    //     teardown — no manual requestAnimationFrame handle to track).
    renderer.setAnimationLoop(() => {
        if (scene.disposed) return;
        controls.update();
        renderer.render(sceneGraph, camera);
    });
    debugLog("MissionHub scene running");
}

/** Promise wrapper around GLTFLoader.load. */
function loadGltf(GLTFLoader, url) {
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
    });
}

/**
 * Center the loaded model on the ground, scale it to a sensible size, and aim
 * the camera/controls at its middle. Keeps any GLB (whatever Blender exports)
 * framed correctly without per-asset tuning.
 */
function frameModel(THREE, model, controls, camera) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.4 / maxDim;
    model.scale.setScalar(scale);

    // Recompute after scaling, then sit the model on the ground plane.
    const scaledBox = new THREE.Box3().setFromObject(model);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    model.position.x -= scaledCenter.x;
    model.position.z -= scaledCenter.z;
    model.position.y -= scaledBox.min.y; // base rests at y = 0

    const focusY = (scaledBox.max.y - scaledBox.min.y) / 2;
    controls.target.set(0, focusY, 0);
    controls.update();
    return model;
}

/** A clearly-Bucky red sphere used when no GLB asset is available. */
function makeBuckyPlaceholder(THREE) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
        new THREE.SphereGeometry(1, 48, 32),
        new THREE.MeshStandardMaterial({
            color: 0xff3344,
            roughness: 0.35,
            metalness: 0.1,
            emissive: 0x330008,
            emissiveIntensity: 0.6
        })
    );
    body.position.y = 1;
    group.add(body);
    group.userData.isPlaceholder = true;
    return group;
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
    if (scene.resizeObserver) {
        try { scene.resizeObserver.disconnect(); } catch (_) { /* noop */ }
        scene.resizeObserver = null;
    }
    if (scene.controls) {
        try { scene.controls.dispose(); } catch (_) { /* noop */ }
        scene.controls = null;
    }
    if (scene.sceneGraph) {
        try { disposeObject3D(scene.sceneGraph); } catch (error) { logError("MissionHub disposeGraph", error); }
        scene.sceneGraph = null;
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
    scene.bucky = null;
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
            // Dispose any texture maps the material references.
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
    background: #05070f;
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
.vm-missionhub-hud {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px;
    border: 1px solid rgba(82, 255, 243, .28);
    border-radius: 10px;
    background: rgba(5, 9, 18, .58);
    backdrop-filter: blur(6px);
    pointer-events: none;
    font-family: "Segoe UI", system-ui, sans-serif;
    z-index: 2;
}
.vm-missionhub-tag {
    font-size: 10px;
    letter-spacing: 1.4px;
    color: #52fff3;
}
.vm-missionhub-status {
    font-size: 12px;
    color: #e8ffff;
}
.vm-missionhub-hint {
    font-size: 10px;
    color: rgba(232, 255, 255, .55);
}
    `;
    document.head.appendChild(style);
}
