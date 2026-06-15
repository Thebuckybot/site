/**
 * AssetCache — parse-once, clone-on-demand GLB asset cache for the Bucky VM.
 *
 * WHY
 * ---
 * Heavy 3D apps (Mission Hub today, the Arc 1 world tomorrow) must never
 * re-download, re-parse, or re-decode their GLB every time their window opens.
 * This core service fetches + GLTF-parses a model ONCE, keeps the parsed
 * THREE.Scene in memory for the life of the VM, and hands every consumer a
 * lightweight CLONE. Clones share geometry, materials and textures by
 * reference, so across the whole session:
 *   - the bytes are downloaded once  (then HTTP-cached anyway),
 *   - the GLTF/Draco parse runs once,
 *   - the WebP textures decode + the typed-array geometry build run once,
 *   - the decoded Texture objects are reused — no re-decode, no re-create.
 * The cache survives app open/close; its GPU/CPU resources are freed only when
 * the VM unloads (runtime.dispose() -> disposeAll()).
 *
 * Note on GPU uploads: a Texture uploads to a given WebGL context the first
 * time that context renders it. Because every cloned scene shares the same
 * Texture objects, a context never uploads the same texture twice. The runtime
 * deliberately keeps its existing per-open renderer lifecycle (stability), so a
 * brand-new context still performs that one upload on first render; persisting
 * the renderer/context to remove even that is a clean, optional follow-up that
 * layers on top of this cache without changing it.
 *
 * LAYERING
 * --------
 * Core service (vm/core). Depends only on diagnostics + the pinned Three.js CDN
 * (loaded lazily, exactly like MissionHubApp). It imports NO app and NO DOM.
 * Apps + the kernel consume it; it consumes neither. This is the clean
 * extension point the future Arc 1 world plugs into via registerAsset() /
 * preloadAsset() — no kernel rewrite required.
 *
 * GitHub-Pages-safe: callers pass URLs they resolved via import.meta.url; the
 * cache never hard-codes an asset path (runtime logic stays separate from
 * content/data). The deps/fetch seams are injectable so the cache is exercised
 * headless (no CDN, no WebGL) in tests.
 */
import { debugLog, logError } from "./diagnostics.js";

// Pinned to the SAME Three.js the apps import, so a scene parsed here is the
// exact same THREE.Object3D type the renderer consumes (ESM caches one module
// instance per URL -> one THREE). Keep in lockstep with MissionHubApp.js.
const THREE_VERSION = "0.160.0";
const CDN = `https://esm.sh/three@${THREE_VERSION}`;
const JSM = `${CDN}/examples/jsm`;
const DEFAULT_DRACO_DECODER = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";

const STATUS = Object.freeze({
    IDLE: "idle",
    LOADING: "loading",
    READY: "ready",
    ERROR: "error",
    UNAVAILABLE: "unavailable"
});

class AssetCache {
    constructor() {
        this._registry = new Map(); // key -> descriptor { url, parse, transformBuffer, available, dracoPath }
        this._entries = new Map();  // key -> entry { status, promise, gltf, scene, bytes, parseMs, parsedAt, error, useCount }
        this._deps = null;          // memoised { THREE, GLTFLoader, DRACOLoader, SkeletonUtils, draco }
        this._depsPromise = null;
        // Injectable seams — tests override these; production uses the defaults.
        this._loadDepsImpl = null;  // async () => deps
        this._fetchImpl = null;     // (url) => Promise<Response>
    }

    /** TEST-ONLY: inject fake deps/fetch so the cache runs headless (no CDN, no WebGL). */
    __configureForTest({ loadDeps = null, fetchImpl = null } = {}) {
        this._loadDepsImpl = loadDeps;
        this._fetchImpl = fetchImpl;
        this._deps = null;
        this._depsPromise = null;
    }

    /**
     * Declare an asset. Idempotent: a live (READY/LOADING) asset's descriptor is
     * never mutated; a stale (idle/unavailable/error) entry is cleared so the new
     * descriptor takes effect on the next preload. `available:false` registers a
     * FUTURE asset (e.g. arc1_world) so preloadAsset(key) is callable + inert
     * until the file ships — architecture without implementation.
     */
    registerAsset(key, url, options = {}) {
        if (!key) return this;
        const prior = this._registry.get(key);
        const entry = this._entries.get(key);
        if (entry && (entry.status === STATUS.READY || entry.status === STATUS.LOADING)) {
            return this; // never disturb a live asset
        }
        if (entry) this._entries.delete(key); // stale -> allow re-evaluation
        this._registry.set(key, {
            url: url || (prior && prior.url) || null,
            parse: options.parse !== false,
            transformBuffer: options.transformBuffer || (prior && prior.transformBuffer) || null,
            available: options.available !== false,
            dracoPath: options.dracoPath || (prior && prior.dracoPath) || DEFAULT_DRACO_DECODER
        });
        return this;
    }

    isRegistered(key) { return this._registry.has(key); }
    isReady(key) { const e = this._entries.get(key); return !!e && e.status === STATUS.READY; }
    getStatus(key) { const e = this._entries.get(key); return e ? e.status : STATUS.IDLE; }

    /**
     * Fetch + parse a registered asset ONCE. Idempotent — concurrent/repeat
     * calls return the same in-flight promise. Best-effort: never throws; a
     * failure is recorded on the entry (status ERROR) and surfaced via getStats.
     * Unavailable (future) assets resolve to an inert entry with no network.
     */
    preloadAsset(key) {
        const existing = this._entries.get(key);
        if (existing && existing.promise) return existing.promise;

        const desc = this._registry.get(key);
        if (!desc) {
            const entry = { status: STATUS.ERROR, error: new Error(`asset '${key}' not registered`), useCount: 0 };
            entry.promise = Promise.resolve(entry);
            this._entries.set(key, entry);
            return entry.promise;
        }
        if (!desc.available || !desc.url) {
            const entry = { status: STATUS.UNAVAILABLE, error: null, useCount: 0 };
            entry.promise = Promise.resolve(entry);
            this._entries.set(key, entry);
            debugLog("AssetCache: registered inert (future) asset", key);
            return entry.promise;
        }

        const entry = { status: STATUS.LOADING, error: null, useCount: 0 };
        entry.promise = this._loadAndParse(key, desc, entry)
            .then(() => entry)
            .catch((error) => {
                entry.status = STATUS.ERROR;
                entry.error = error;
                logError(`AssetCache preload(${key})`, error);
                return entry;
            });
        this._entries.set(key, entry);
        return entry.promise;
    }

    async _loadAndParse(key, desc, entry) {
        const t0 = nowMs();
        const deps = await this._ensureDeps();

        const res = await this._doFetch(desc.url);
        if (res && res.ok === false) throw new Error(`fetch ${desc.url} -> HTTP ${res.status}`);
        let buffer = await res.arrayBuffer();
        entry.bytes = buffer.byteLength;

        if (desc.parse === false) {
            // Bytes-only warm: populate the HTTP cache without parsing (rare path).
            entry.scene = null; entry.gltf = null;
            entry.status = STATUS.READY; entry.parseMs = nowMs() - t0; entry.parsedAt = Date.now();
            debugLog(`AssetCache: warmed '${key}' (bytes only)`, fmtMB(entry.bytes));
            return;
        }

        if (typeof desc.transformBuffer === "function") {
            try {
                const out = desc.transformBuffer(buffer);
                if (out) buffer = out;
            } catch (e) {
                debugLog("AssetCache transformBuffer failed; using raw buffer", key, e && e.message);
            }
        }

        const loader = new deps.GLTFLoader();
        if (deps.draco && typeof loader.setDRACOLoader === "function") loader.setDRACOLoader(deps.draco);
        const path = desc.url.slice(0, desc.url.lastIndexOf("/") + 1);
        const gltf = await new Promise((resolve, reject) => loader.parse(buffer, path, resolve, reject));

        entry.gltf = gltf;
        entry.scene = gltf.scene; // pristine ORIGINAL — never added to a live scene; only cloned
        entry.status = STATUS.READY;
        entry.parseMs = nowMs() - t0;
        entry.parsedAt = Date.now();
        debugLog(`AssetCache: parsed '${key}' once`, fmtMB(entry.bytes), `${entry.parseMs.toFixed(0)}ms`);
    }

    /**
     * Return a fresh CLONE of the cached scene, kicking off a parse on demand if
     * a preload was never started. Clones share geometry/materials/textures with
     * the cached original and with each other, so opening the app N times costs
     * one download + one parse + one decode. Returns null if unavailable/failed.
     */
    async acquireScene(key) {
        let entry = this._entries.get(key);
        if (!entry) {
            await this.preloadAsset(key);
        } else if (entry.promise) {
            await entry.promise;
        }
        entry = this._entries.get(key);
        if (!entry || entry.status !== STATUS.READY || !entry.scene) return null;
        const deps = await this._ensureDeps();
        return this._cloneEntry(key, entry, deps);
    }

    /** Animation clips parsed from the GLB (shared data; bind to a mixer root). */
    acquireAnimations(key) {
        const entry = this._entries.get(key);
        if (!entry || entry.status !== STATUS.READY || !entry.gltf) return [];
        return entry.gltf.animations || [];
    }

    /** Synchronous clone if already parsed, else null (never triggers a load). */
    peekScene(key) {
        const entry = this._entries.get(key);
        if (!entry || entry.status !== STATUS.READY || !entry.scene || !this._deps) return null;
        return this._cloneEntry(key, entry, this._deps);
    }

    _cloneEntry(key, entry, deps) {
        const clone = cloneScene(deps, entry.scene);
        clone.userData = clone.userData || {};
        clone.userData.__assetCacheKey = key; // provenance: a shared clone; never deep-dispose on app close
        entry.useCount = (entry.useCount || 0) + 1;
        return clone;
    }

    /** Structural + timing stats for one asset (used by the validation report). */
    getStats(key) {
        const desc = this._registry.get(key) || {};
        const entry = this._entries.get(key) || {};
        const counts = countScene(entry.scene);
        return {
            key,
            status: entry.status || STATUS.IDLE,
            available: desc.available !== false,
            url: desc.url || null,
            bytes: entry.bytes || 0,
            parseMs: Math.round(entry.parseMs || 0),
            parsedAt: entry.parsedAt || 0,
            useCount: entry.useCount || 0,
            nodes: counts.nodes,
            meshes: counts.meshes,
            materials: counts.materials,
            textures: counts.textures,
            error: entry.error ? String(entry.error.message || entry.error) : null
        };
    }

    listStats() { return Array.from(this._registry.keys()).map((k) => this.getStats(k)); }

    /** Free a single cached asset's GPU/CPU resources. Call only when the VM unloads. */
    disposeAsset(key) {
        const entry = this._entries.get(key);
        if (entry && entry.scene) {
            try { deepDispose(entry.scene); } catch (e) { logError(`AssetCache dispose(${key})`, e); }
        }
        this._entries.delete(key);
    }

    /** Free every cached asset + the shared Draco decoder. Called by runtime.dispose(). */
    disposeAll() {
        Array.from(this._entries.keys()).forEach((k) => this.disposeAsset(k));
        if (this._deps && this._deps.draco && typeof this._deps.draco.dispose === "function") {
            try { this._deps.draco.dispose(); } catch (_e) { /* ignore */ }
        }
        debugLog("AssetCache: disposed all assets");
    }

    // ----- deps / fetch (overridable for tests) ------------------------------
    _ensureDeps() {
        if (this._deps) return Promise.resolve(this._deps);
        if (this._depsPromise) return this._depsPromise;
        const load = this._loadDepsImpl ? this._loadDepsImpl() : this._defaultLoadDeps();
        this._depsPromise = Promise.resolve(load).then((deps) => { this._deps = deps; return deps; });
        return this._depsPromise;
    }

    async _defaultLoadDeps() {
        const [THREE, gltfMod, dracoMod, skelMod] = await Promise.all([
            import(/* @vite-ignore */ CDN),
            import(/* @vite-ignore */ `${JSM}/loaders/GLTFLoader.js`),
            import(/* @vite-ignore */ `${JSM}/loaders/DRACOLoader.js`),
            import(/* @vite-ignore */ `${JSM}/utils/SkeletonUtils.js`)
        ]);
        const draco = new dracoMod.DRACOLoader();
        draco.setDecoderPath(DEFAULT_DRACO_DECODER);
        return {
            THREE,
            GLTFLoader: gltfMod.GLTFLoader,
            DRACOLoader: dracoMod.DRACOLoader,
            SkeletonUtils: { clone: skelMod.clone },
            draco
        };
    }

    _doFetch(url) {
        const f = this._fetchImpl || (typeof fetch === "function" ? fetch : null);
        if (!f) return Promise.reject(new Error("no fetch implementation available"));
        return Promise.resolve(f(url));
    }
}

// SkeletonUtils.clone is correct for skinned/animated rigs (the room has a
// rigged office chair); it still shares geometry + materials like Object3D.clone,
// so GPU resources stay shared across clones.
function cloneScene(deps, scene) {
    if (deps && deps.SkeletonUtils && typeof deps.SkeletonUtils.clone === "function") {
        return deps.SkeletonUtils.clone(scene);
    }
    return scene.clone(true);
}

function countScene(scene) {
    const out = { nodes: 0, meshes: 0, materials: 0, textures: 0 };
    if (!scene || typeof scene.traverse !== "function") return out;
    const mats = new Set();
    const texs = new Set();
    scene.traverse((n) => {
        out.nodes++;
        if (!n.isMesh) return;
        out.meshes++;
        const list = Array.isArray(n.material) ? n.material : (n.material ? [n.material] : []);
        list.forEach((m) => {
            if (!m) return;
            mats.add(m);
            Object.keys(m).forEach((k) => { const v = m[k]; if (v && v.isTexture) texs.add(v); });
        });
    });
    out.materials = mats.size;
    out.textures = texs.size;
    return out;
}

function deepDispose(root) {
    if (!root || typeof root.traverse !== "function") return;
    root.traverse((node) => {
        if (node.geometry && typeof node.geometry.dispose === "function") node.geometry.dispose();
        const material = node.material;
        if (!material) return;
        (Array.isArray(material) ? material : [material]).forEach((mat) => {
            if (!mat) return;
            Object.keys(mat).forEach((k) => { const v = mat[k]; if (v && v.isTexture && typeof v.dispose === "function") v.dispose(); });
            if (typeof mat.dispose === "function") mat.dispose();
        });
    });
}

function nowMs() {
    return (typeof performance !== "undefined" && performance && performance.now) ? performance.now() : Date.now();
}
function fmtMB(bytes) { return `${(bytes / 1024 / 1024).toFixed(2)}MB`; }

export const assetCache = new AssetCache();
export { STATUS as ASSET_STATUS };
