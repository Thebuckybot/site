// De enige plek waar het Server Center met de backend praat.
//
// Zelfde vorm als js/security/api.js - dezelfde envelop {ok, data}, dezelfde
// timeout, dezelfde foutobjecten met status en code - maar met een eigen basis
// (/api/server) en zonder de read-only blokkade: in deze afdeling mag iedereen
// die mag kijken ook wijzigen (zie backend/api/server_center/auth.py).
//
// De timeout is er om dezelfde reden als daar: zonder grens blijft een pagina
// eeuwig "Loading…" tonen als de backend hangt, en dat is niet te onderscheiden
// van traag.
import { API_URL } from "../config.js";
import { apiFetch } from "../dashboard.js";

const BASE = `${API_URL}/api/server`;
const REQUEST_TIMEOUT_MS = 15000;

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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  opts.signal = ctrl.signal;

  let res;
  try {
    res = await apiFetch(`${BASE}/${gid}${path}`, opts);
  } catch (networkErr) {
    const timedOut = !!(networkErr && (networkErr.name === "AbortError" || ctrl.signal.aborted));
    const e = new Error(timedOut
      ? "The request timed out. The backend is slow or unreachable."
      : "Network error. The backend is unreachable.");
    e.code = timedOut ? "timeout" : "network";
    throw e;
  } finally {
    clearTimeout(timer);
  }

  let json = {};
  try { json = await res.json(); } catch (_) { /* geen JSON */ }
  if (!res.ok || json.ok === false) {
    const e = new Error((json && json.error && json.error.message) || `Request failed (${res.status}).`);
    e.status = res.status;
    e.code = (json && json.error && json.error.code) || "error";
    // 503 betekent hier iets specifieks: het onderdeel staat uit (sitevlag).
    if (res.status === 503) e.message = "The Server Center is switched off right now.";
    throw e;
  }
  return json;
}

let permsCache = null;

export const api = {
  get: async (path) => (await call("GET", path)).data,
  post: async (path, body) => (await call("POST", path, body || {})).data,
  patch: async (path, body) => (await call("PATCH", path, body || {})).data,
  del: async (path) => (await call("DELETE", path)).data,
  async me() {
    if (!permsCache) permsCache = (await call("GET", "/me")).data;
    return permsCache;
  },
};
