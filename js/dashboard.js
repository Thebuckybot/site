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
  const navMenu = document.getElementById("nav-menu"); // Haal het element hier op.
  const dashboardLink = document.querySelector("#dashboard-link");
  const loginLink = document.querySelector("#login-link");
  const logoutBtn = document.querySelector("#logout-btn");

  // Check if navMenu exists before proceeding
  if (!navMenu) {
    const msg = "Error: The navigation menu element with ID 'nav-menu' was not found.";
    console.error(msg);
    alert(msg);
    return;
  }

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

  console.log("apiFetch - Using token:", token, "for URL:", url);

  if (token) {
    options.headers["Authorization"] = `Bearer ${token}`;
  } else {
    console.warn("apiFetch - No token found in localStorage.");
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
    const msg = "apiFetch - Fetch failed: " + (error && error.message ? error.message : error);
    console.error(msg);
    alert(msg);
    throw error;
  }
}

// Invite link genereren
function getInviteURL(guildId) {
  const permissions = 8;
  const scopes = "bot applications.commands";
  return `https://discord.com/oauth2/authorize?client_id=${BOT_ID}&scope=${scopes}&permissions=${permissions}&guild_id=${guildId}&response_type=code&redirect_uri=${API_URL}/callback`;
}

// Serverkaart genereren
function createGuildCard(guild, botInGuild) {
  const card = document.createElement("div");
  card.className = `guild-card ${botInGuild ? "green-border" : "red-border"}`;

  const img = document.createElement("img");
  img.src = guild.icon
    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
    : "https://cdn.discordapp.com/embed/avatars/0.png";
  img.alt = guild.name;
  img.className = "guild-icon";

  const name = document.createElement("h3");
  name.textContent = guild.name;

  card.appendChild(img);
  card.appendChild(name);

  card.onclick = () => {
    if (botInGuild) {
      // Pass the token along with the guild ID
      const token = getStoredToken();
      window.location.href = `settings.html?guild_id=${guild.id}&token=${encodeURIComponent(token)}`;
    } else {
      window.location.href = getInviteURL(guild.id);
    }
  };

  guildContainer.appendChild(card);
}

// Logout functie (POST naar backend + opruimen)
async function doLogout() {
  try {
    const res = await fetch(`${API_URL}/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      clearUserData();
      renderNav(false);
      userInfo.innerHTML = "";
      guildContainer.innerHTML = "";
      window.location.href = "index.html";
    } else {
      alert("Logout failed.");
    }
  } catch (err) {
    console.error("Logout error:", err);
  }
}

// Render functie
function renderGuilds(guilds) {
  guildContainer.innerHTML = "";
  guilds.forEach(guild => {
    const isAdmin = guild.permissions && (guild.permissions & 0x8);
    if (!isAdmin) return; // alleen servers waar je admin bent
    createGuildCard(guild, guild.bot_in_guild === true);
  });
}

// Dashboard laden
async function loadDashboard() {
  storeTokenFromUrl();

  const cachedGuilds = sessionStorage.getItem("user_guilds");
  const cachedUser = sessionStorage.getItem("user_info");

  if (cachedGuilds && cachedUser) {
    const guilds = JSON.parse(cachedGuilds);
    const user = JSON.parse(cachedUser);

    userInfo.innerHTML = `
      <img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png" class="avatar" />
      <span>${user.username}</span>
    `;

    renderGuilds(guilds);
    renderNav(true, user);
    return;
  }

  try {
    const res = await apiFetch(`${API_URL}/api/me`);
    const data = await res.json();

    if (!data.logged_in) {
      clearUserData();
      renderNav(false);
      const redirectUrl = encodeURIComponent(window.location.href);
      window.location.href = `${API_URL}/login?redirect=${redirectUrl}`;
      return;
    }

    // Dashboard link toevoegen als die er nog niet is (voor zekerheid)
    if (!document.querySelector("#dashboard-link")) {
      renderNav(true, data.user);
    }

    const user = data.user;

    sessionStorage.setItem("user_info", JSON.stringify(user));
    sessionStorage.setItem("user_guilds", JSON.stringify(data.guilds));

    userInfo.innerHTML = `
      <img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png" class="avatar" />
      <span>${user.username}</span>
    `;

    renderGuilds(data.guilds);
    renderNav(true, user);
  } catch (err) {
    const msg = "Error loading dashboard: " + (err && err.message ? err.message : err);
    console.error(msg);
    alert(msg); // zodat je het ook zonder console ziet
    clearUserData();
    renderNav(false);
    window.location.href = "/";
  }
}

// Start
window.addEventListener("DOMContentLoaded", loadDashboard);

// Use a single export statement for all functions you want to make available
export { apiFetch, storeTokenFromUrl };