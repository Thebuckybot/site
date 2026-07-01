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

export const api = {
  guildId,
  get: (p) => call("GET", p).then((j) => j.data),
  // paginated GETs need the envelope (page/total), so expose raw too
  getRaw: (p) => call("GET", p),
  post: (p, b) => call("POST", p, b).then((j) => j.data),
  patch: (p, b) => call("PATCH", p, b).then((j) => j.data),
  del: (p) => call("DELETE", p).then((j) => j.data),
};
