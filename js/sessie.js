/**
 * De sessie van de site, zonder bijwerkingen (13-10-2026, ronde 2).
 *
 * Kwam uit js/nav-auth.js, dat bij het laden ook meteen de v1-balk tekent in elk
 * `#nav-menu`. v2 (eigen balk) en de arcade (eigen nav, zie arcade-uitloggen.js)
 * hebben de sessie nodig zonder die balk; nav-auth.js importeert dit en doet
 * daarmee precies wat het deed. Geen nieuwe login: dezelfde /api/me, dezelfde
 * cache (sessionStorage "user_info") en dezelfde POST /logout.
 */
import { API_URL } from "./config.js";

const FETCH_DEADLINE_MS = 8000;

function fetchMetDeadline(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function clearUserData() {
  // Elke opslag apart en zonder te gooien: een in-app browser (Discord) kan
  // localStorage/sessionStorage missen of laten gooien. Dan is er ook niets te
  // wissen; een fout hier liet haalLogin() afbreken in plaats van "uitgelogd"
  // te zeggen, en de org-knop bleef stil hangen (13-10-2026).
  try { sessionStorage.removeItem("user_info"); } catch (err) { /* geen opslag */ }
  try { sessionStorage.removeItem("user_guilds"); } catch (err) { /* geen opslag */ }
  try { localStorage.removeItem("api_token"); } catch (err) { /* consistent met dashboard.js */ }
}

/**
 * De sessie bij de server nagaan: `{loggedIn, user}`. Werkt de cache bij, of
 * wist hem. Gedeeld door de v1-balk (checkLogin) en de v2-balk.
 */
async function haalLogin() {
  try {
    // MET DEADLINE. Zonder abort hangt een stille server deze promise voor
    // eeuwig op - en al hangt de balk daar sinds 12 augustus niet meer aan,
    // een login-status die nooit komt is nog steeds een kapotte upgrade.
    const res = await fetchMetDeadline(`${API_URL}/api/me`, {
      credentials: "include"
    });

    const data = await res.json();

    if (data.logged_in) {
      try {
        sessionStorage.setItem("user_info", JSON.stringify(data.user));
      } catch (err) { /* private mode: geen cache, wel een balk */ }
      return { loggedIn: true, user: data.user };
    }
    clearUserData();
    return { loggedIn: false, user: null };
  } catch (err) {
    console.error("Error checking login status:", err);
    clearUserData();
    return { loggedIn: false, user: null };
  }
}

/** De sessie zoals deze tab hem kent (zonder netwerk), of null. */
function leesSessieCache() {
  try {
    return JSON.parse(sessionStorage.getItem("user_info") || "null");
  } catch (err) {
    return null;
  }
}

/** Waar de login begint; met een terugkeerpagina (backend: safe_return_path). */
function loginUrl(terug) {
  return terug ? `${API_URL}/login?redirect=${encodeURIComponent(terug)}` : `${API_URL}/login`;
}

/** Uitloggen bij de server en de cache wissen. `true` als de server het bevestigde. */
async function uitloggen() {
  const res = await fetch(`${API_URL}/logout`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    }
  });
  // Wis altijd direct, ongeacht serverresponse
  clearUserData();
  return res.ok;
}

export { FETCH_DEADLINE_MS, clearUserData, fetchMetDeadline, haalLogin, leesSessieCache, loginUrl, uitloggen };
