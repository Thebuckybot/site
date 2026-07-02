// Centralized Security API client. The ONLY place the website talks to the
// backend. Reuses the site's existing apiFetch (auth/token/credentials) and
// API_URL. Returns the unwrapped `data` from the standard envelope, or throws an
// Error carrying status + code for the UI to surface.
import { API_URL } from "../config.js";
import { apiFetch } from "../dashboard.js";

const BASE = `${API_URL}/api/security`;

export function guildId() {
  return new URLSearchParams(window.location.search).get("guild_id");
}

async function call(method, path, body) {
  const gid = guildId();
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await apiFetch(`${BASE}/${gid}${path}`, opts);
  } catch (networkErr) {
    const e = new Error("Network error - the backend is unreachable.");
    e.code = "network";
    throw e;
  }
  let json = {};
  try { json = await res.json(); } catch (_) { /* non-JSON */ }
  if (!res.ok || json.ok === false) {
    const e = new Error((json && json.error && json.error.message) || `Request failed (${res.status}).`);
    e.status = res.status;
    e.code = (json && json.error && json.error.code) || "error";
    throw e;
  }
  return json; // {ok, data, page?, per_page?, total?}
}

let _permsCache = null;

export const api = {
  guildId,
  get: (p) => call("GET", p).then((j) => j.data),
  // paginated GETs need the envelope (page/total), so expose raw too
  getRaw: (p) => call("GET", p),
  post: (p, b) => call("POST", p, b).then((j) => j.data),
  patch: (p, b) => call("PATCH", p, b).then((j) => j.data),
  del: (p) => call("DELETE", p).then((j) => j.data),
  // The caller's permission tier for this guild (owner / security_admin /
  // read_only), fetched once and cached. Purely cosmetic — the backend
  // re-authorizes every write regardless of what this returns.
  me: async () => {
    if (_permsCache) return _permsCache;
    try { _permsCache = await call("GET", "/me").then((j) => j.data); }
    catch (_) { _permsCache = { can_view: true, can_edit: false, is_owner: false, tier: "read_only" }; }
    return _permsCache;
  },
};

// SOC (advanced) endpoints now live under the Security namespace:
//   /api/security/soc/*  (the legacy /api/soc/* is kept only as a temporary
//   backend compatibility alias during migration). SOC returns raw JSON (not the
//   v2 envelope). Fully integrated into the one Security Center; still 100%
//   server-authorized — the frontend makes no security decisions.
const SOC = `${API_URL}/api/security/soc`;
async function socCall(method, path, body, { scoped = true } = {}) {
  const gid = guildId();
  const base = scoped ? `${SOC}/${gid}` : SOC;
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  let res;
  try { res = await apiFetch(`${base}${path}`, opts); }
  catch (e) { const err = new Error("Network error - the backend is unreachable."); err.code = "network"; throw err; }
  let json = null;
  try { json = await res.json(); } catch (_) { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error((json && json.error) || `Request failed (${res.status}).`);
    err.status = res.status; throw err;
  }
  return json;
}

export const soc = {
  get: (p) => socCall("GET", p),
  post: (p, b) => socCall("POST", p, b),
  patch: (p, b) => socCall("PATCH", p, b),
  del: (p) => socCall("DELETE", p),
  // Rule contract / vocabulary — guild-independent, so not guild-scoped.
  registry: () => socCall("GET", "/rule-registry", undefined, { scoped: false }),
};
