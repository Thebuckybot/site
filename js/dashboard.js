// dashboard.js
import { API_URL } from "./config.js";

const guildContainer = document.getElementById("guilds-container");
const userInfo = document.getElementById("user-info");
const BOT_ID = "907664862493167680";

function clearUserData() {
  sessionStorage.removeItem("user_info");
  sessionStorage.removeItem("user_guilds");
  localStorage.removeItem("api_token");
}

function renderNav(loggedIn, user = null) {
  // Haal navMenu op binnen de functie.
  const navMenu = document.getElementById("nav-menu");

  // The dashboard nav (#nav-menu) only exists on dashboard.html. This module is
  // also imported by other pages (e.g. the Security v2 SPA) purely for apiFetch,
  // where there is legitimately no nav to render - so this is expected, not an
  // error. Return quietly instead of logging.
  if (!navMenu) {
    return;
  }

  const dashboardLink = document.querySelector("#dashboard-link");
  const loginLink = document.querySelector("#login-link");
  const logoutBtn = document.querySelector("#logout-btn");

  if (loggedIn && user) {
    if (!dashboardLink) {
      const li = document.createElement("li");
      li.innerHTML = `<a id="dashboard-link" href="dashboard.html">Dashboard</a>`;
      navMenu.appendChild(li);
    }
    if (!logoutBtn) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.id = "logout-btn";
      btn.textContent = "Logout";
      btn.style.cursor = "pointer";
      btn.addEventListener("click", doLogout);
      li.appendChild(btn);
      navMenu.appendChild(li);
    }
    if (loginLink) loginLink.remove();
  } else {
    if (dashboardLink) dashboardLink.remove();
    if (logoutBtn) logoutBtn.parentElement.remove();

    if (!loginLink) {
      const li = document.createElement("li");
      li.innerHTML = `<a id="login-link" href="${API_URL}/login"><button id="discord-login-button">Login</button></a>`;
      navMenu.appendChild(li);
    }
  }
}

// Helper: token uit URL halen en opslaan in localStorage, daarna token uit URL verwijderen
function storeTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (token) {
    localStorage.setItem("api_token", token);
    params.delete("token");
    const newUrl = window.location.pathname + (params.toString() ? "?" + params.toString() : "");
    window.history.replaceState({}, "", newUrl);
  }
}

function getStoredToken() {
  return localStorage.getItem("api_token");
}

// Fetch wrapper die Bearer token gebruikt als die er is
async function apiFetch(url, options = {}) {
  options.headers = options.headers || {};
  const token = getStoredToken();

  // SECURITY: never log the auth token (or the Authorization header). Logging the
  // bearer token to the browser console leaks it into console history / screen
  // shares / support attachments. Log presence only, never the value.
  if (token) {
    options.headers["Authorization"] = `Bearer ${token}`;
  }

  options.credentials = "include";

  try {
    const res = await fetch(url, options);

    if (res.status === 401) {
      console.warn("apiFetch - 401 Unauthorized. Clearing user data and redirecting.");
      clearUserData();
      renderNav(false);
      // Optioneel: redirect naar login of home
      // window.location.href = "index.html";
    }

    return res;
  } catch (error) {
    // FIN-002: no jarring alert() — callers render proper error/timeout states.
    console.error("apiFetch - Fetch failed:", error && error.message ? error.message : error);
    throw error;
  }
}


// Render the server list: premium cards, alphabetical, with search + count.
// Falls back to a polished empty state when there is nothing to manage.
function renderGuilds(guilds, guildContainer) {
    if (!guildContainer) return;
    guildContainer.innerHTML = "";
    const search = document.getElementById("picker-search");
    const count = document.getElementById("picker-count");

    if (!guilds || !guilds.length) {
      if (search) search.hidden = true;
      if (count) count.textContent = "";
      renderEmpty(guildContainer);
      return;
    }

    const sorted = guilds.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    sorted.forEach((guild) => createGuildCard(guild, guildContainer));

    if (count) count.textContent = `${sorted.length} server${sorted.length === 1 ? "" : "s"}`;
    if (search) {
      const show = sorted.length > 8;   // only surface search for long lists
      search.hidden = !show;
      if (show) wireFilter(guildContainer);
    }
}

// Live client-side filter (only wired when the search box is shown).
function wireFilter(guildContainer) {
    const input = document.getElementById("server-filter");
    if (!input || input._wired) return;
    input._wired = true;
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      guildContainer.querySelectorAll(".server-card").forEach((c) => {
        const match = !q || (c.getAttribute("data-name") || "").includes(q);
        c.style.display = match ? "" : "none";
        if (match) shown++;
      });
      const count = document.getElementById("picker-count");
      if (count) count.textContent = shown ? `${shown} server${shown === 1 ? "" : "s"}` : "No matches";
    });
}

// Skeleton cards while the server list is loading (instead of a blank page).
function renderSkeleton(guildContainer, n = 8) {
    if (!guildContainer) return;
    guildContainer.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const card = document.createElement("div");
      card.className = "server-card skeleton";
      card.innerHTML = '<div class="sk sk-icon"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div>';
      guildContainer.appendChild(card);
    }
}

// Polished empty state: explains what happened + offers an obvious next step.
function renderEmpty(guildContainer) {
    const wrap = document.createElement("div");
    wrap.className = "picker-empty";
    wrap.innerHTML =
      '<div class="e-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="14" width="18" height="5" rx="1.5"/><path d="M7 6.5h.01M7 16.5h.01"/></svg></div>' +
      '<h2>No manageable servers yet</h2>' +
      '<p>You need <strong>Manage&nbsp;Server</strong> permission on a server that has Bucky. Invite Bucky to a server you manage, then refresh - it will appear here.</p>' +
      '<div class="e-actions"></div>';
    const actions = wrap.querySelector(".e-actions");
    const invite = document.createElement("a");
    invite.className = "btn btn-primary"; invite.href = getInviteURL(); invite.textContent = "Invite Bucky";
    const refresh = document.createElement("button");
    refresh.type = "button"; refresh.className = "btn btn-ghost"; refresh.textContent = "Refresh";
    refresh.addEventListener("click", () => { if (window.refreshServers) window.refreshServers(); });
    actions.append(invite, refresh);
    guildContainer.innerHTML = "";
    guildContainer.appendChild(wrap);
}


// Invite link genereren
function getInviteURL(guildId) {
  const permissions = 8;
  const scopes = "bot applications.commands";
  return `https://discord.com/oauth2/authorize?client_id=${BOT_ID}&scope=${scopes}&permissions=${permissions}&guild_id=${guildId}&response_type=code&redirect_uri=${API_URL}/callback`;
}

const inviteButton = document.getElementById("invite-button");
if (inviteButton) {
  inviteButton.href = getInviteURL(); // Vul de href met de invite URL
}


// Premium server card: icon + name + status + reveal CTA. Rendered as a <button>
// so keyboard/Enter selection and focus states work for free.
function createGuildCard(guild, guildContainer) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "server-card";
  card.setAttribute("data-name", (guild.name || "").toLowerCase());
  card.setAttribute("aria-label", `Open ${guild.name || "server"} dashboard`);

  const img = document.createElement("img");
  img.className = "s-icon";
  img.loading = "lazy";
  img.src = guild.icon
    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
    : "https://cdn.discordapp.com/embed/avatars/0.png";
  img.alt = "";

  const name = document.createElement("div");
  name.className = "s-name";
  name.textContent = guild.name || "Unnamed server";
  name.title = guild.name || "";

  const meta = document.createElement("div");
  meta.className = "s-meta";
  const dot = document.createElement("span"); dot.className = "dot";
  const mtext = document.createElement("span"); mtext.textContent = "Bucky active";
  meta.append(dot, mtext);

  const cta = document.createElement("div");
  cta.className = "s-cta";
  cta.textContent = "Open dashboard →";

  card.append(img, name, meta, cta);

  card.addEventListener("click", () => {
    // Remember the chosen server (name + icon) so the dashboard top bar can show
    // it without another round-trip. Frontend-only; no backend/SQL involved.
    try {
      localStorage.setItem("bucky_active_guild", JSON.stringify({ id: guild.id, name: guild.name, icon: guild.icon || null }));
    } catch (_) { /* storage disabled - dashboard falls back to the id */ }
    guildContainer.querySelectorAll(".server-card.selected").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    setTimeout(() => { window.location.href = `security.html?guild_id=${guild.id}`; }, 160);
  });

  guildContainer.appendChild(card);
}



// Logout functie (POST naar backend + opruimen)
async function doLogout() {
  clearUserData(); // altijd eerst lokaal wissen, ongeacht resultaat van backend

  try {
    const res = await fetch(`${API_URL}/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });

    if (res.ok) {
      renderNav(false);

      // Controleer of de elementen bestaan voordat je ze probeert te manipuleren
      const userInfo = document.getElementById("user-info");
      const guildContainer = document.getElementById("guilds-container");

      if (userInfo) {
        userInfo.innerHTML = "";
      }
      if (guildContainer) {
        guildContainer.innerHTML = "";
      }

      window.location.href = "index.html";
    } else {
      alert("Logout failed.");
      // Toch blijven we uitgelogd, want clearUserData is al gedaan
      renderNav(false);
      window.location.href = "index.html";
    }
  } catch (err) {
    console.error("Logout error:", err);
    // Bij een fout ook uitloggen
    renderNav(false);
    window.location.href = "index.html";
  }
}


// Dashboard laden

// SV2-FIN-001: multi-tab dedup — one tab's fresh /api/me result is broadcast to
// the others so they update WITHOUT their own Discord round-trip.
const guildChannel = ("BroadcastChannel" in window) ? new BroadcastChannel("bucky-guilds") : null;

function paintMe(data) {
    const userInfo = document.getElementById("user-info");
    const guildContainer = document.getElementById("guilds-container");
    if (!data || !data.user) return;
    if (userInfo) {
        // Build via DOM (never innerHTML with a username) to avoid HTML injection.
        userInfo.innerHTML = "";
        const av = document.createElement("img");
        av.src = data.user.avatar
          ? `https://cdn.discordapp.com/avatars/${data.user.id}/${data.user.avatar}.png?size=64`
          : "https://cdn.discordapp.com/embed/avatars/0.png";
        av.alt = "";
        const meta = document.createElement("div");
        const nm = document.createElement("div"); nm.className = "u-name"; nm.textContent = data.user.username || "You";
        const role = document.createElement("div"); role.className = "u-role"; role.textContent = "Signed in";
        meta.append(nm, role);
        userInfo.append(av, meta);
    }
    if (guildContainer) renderGuilds(data.guilds || [], guildContainer);
    renderNav(true, data.user);
}

if (guildChannel) {
    guildChannel.onmessage = (ev) => {
        if (ev && ev.data && ev.data.type === "me" && ev.data.payload) {
            sessionStorage.setItem("user_info", JSON.stringify(ev.data.payload.user));
            sessionStorage.setItem("user_guilds", JSON.stringify(ev.data.payload.guilds || []));
            paintMe(ev.data.payload);
        }
    };
}

// Revalidate against the backend. force=true bypasses the server-side cache
// (used by "Refresh servers"). Normal loads hit the fast per-user cache.
async function fetchMe(force) {
    const res = await apiFetch(`${API_URL}/api/me${force ? "?refresh=1" : ""}`);
    const data = await res.json();
    if (!data.logged_in) {
        clearUserData();
        renderNav(false);
        const redirectUrl = encodeURIComponent(window.location.href);
        window.location.href = `${API_URL}/login?redirect=${redirectUrl}`;
        return null;
    }
    sessionStorage.setItem("user_info", JSON.stringify(data.user));
    sessionStorage.setItem("user_guilds", JSON.stringify(data.guilds || []));
    if (guildChannel) guildChannel.postMessage({ type: "me", payload: data });
    return data;
}

async function loadDashboard() {
    storeTokenFromUrl();
    // 1) PAINT-FIRST from the last known list for an instant UI — this is a
    //    placeholder ONLY, never a substitute for revalidation (the old code
    //    returned here and never refetched, so a refresh showed stale servers).
    try {
        const cu = sessionStorage.getItem("user_info");
        const cg = sessionStorage.getItem("user_guilds");
        if (cu && cg) paintMe({ user: JSON.parse(cu), guilds: JSON.parse(cg) });
        else renderSkeleton(document.getElementById("guilds-container"));
    } catch (_) { renderSkeleton(document.getElementById("guilds-container")); }

    // 2) ALWAYS revalidate — presence is fresh (bot_guilds), the admin set is
    //    short-TTL. A plain refresh now reflects join/leave/admin changes.
    try {
        const data = await fetchMe(false);
        if (data) paintMe(data);
    } catch (err) {
        console.error("Error loading dashboard:", err && err.message ? err.message : err);
        // Only hard-fail to home if we had nothing to show at all.
        if (!sessionStorage.getItem("user_guilds")) {
            clearUserData();
            renderNav(false);
            window.location.href = "/";
        }
    }
}

// Manual "Refresh servers" — force a hard revalidation (e.g. right after
// inviting/removing the bot). Exposed globally + wired to #refresh-servers if present.
async function refreshServers() {
    try {
        const data = await fetchMe(true);
        if (data) paintMe(data);
    } catch (err) {
        console.error("Refresh failed:", err);
    }
}
window.refreshServers = refreshServers;

// Start
window.addEventListener("DOMContentLoaded", () => {
    storeTokenFromUrl(); // <-- Token uit ?token=... opslaan
    const refreshBtn = document.getElementById("refresh-servers");
    if (refreshBtn) refreshBtn.addEventListener("click", refreshServers);
    loadDashboard();
});

// Use a single export statement for all functions you want to make available
export { apiFetch, storeTokenFromUrl };