import { API_URL } from "./config.js";

const navMenu = document.getElementById("nav-menu");

// Deze elementen willen we altijd tonen, ongeacht login status
const essentialLinksHTML = `
  <li><a href="tos.html">Terms of Service</a></li>
  <li><a href="privacy.html">Privacy Policy</a></li>
`;

// DE BALK HANGT AAN GEEN ENKELE FETCH. Dat is de les van 12 augustus: de HTML
// heeft een leeg <ul>, renderNav was de enige vuller, en die draaide pas nadat
// /api/me had geantwoord - zonder timeout. Eén hangend of door CORS geblokkeerd
// antwoord en de héle balk bleef leeg, op elke pagina. De premiumlink kreeg
// eerder al zijn eigen vangrails, maar de balk zelf was altijd al gegijzeld
// door de login-check.
//
// Daarom: (1) de balk wordt METEEN getekend, voordat er ook maar één request
// vertrekt - uitgelogd als default, ingelogd als er een sessiecache ligt;
// (2) elke fetch hier draagt een deadline, zodat "traag" nooit "nooit" wordt.
const FETCH_DEADLINE_MS = 8000;

function fetchMetDeadline(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function renderNavDirect() {
  // Ingelogd tekenen als de vorige pagina dat wist, anders uitgelogd. Beide
  // zijn compleet; checkLogin werkt het daarna bij als de server iets anders
  // zegt. Een verkeerde eerste gok kost een knopwissel - een lege balk kost
  // de hele navigatie.
  let user = null;
  try {
    user = JSON.parse(sessionStorage.getItem("user_info") || "null");
  } catch (err) {
    user = null;
  }
  renderNav(Boolean(user), user);
}

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


function clearUserData() {
  sessionStorage.removeItem("user_info");
  sessionStorage.removeItem("user_guilds");
  localStorage.removeItem("api_token"); // consistent met dashboard.js
}

function renderNav(loggedIn, user = null) {
  navMenu.innerHTML = essentialLinksHTML; // toon eerst altijd cruciale links

  if (loggedIn && user) {
    // 🔥 Arcade (NIEUW)
    const arcadeLi = document.createElement("li");
    arcadeLi.innerHTML = `<a id="arcade-link" href="arcade.html">Arcade</a>`;
    navMenu.appendChild(arcadeLi);


    // Dashboard link
    const dashLi = document.createElement("li");
    dashLi.innerHTML = `<a id="dashboard-link" href="dashboard.html">Dashboard</a>`;
    navMenu.appendChild(dashLi);

    // Logout knop
    const logoutLi = document.createElement("li");
    const logoutBtn = document.createElement("button");
    logoutBtn.id = "logout-btn";
    logoutBtn.textContent = "Logout";
    logoutBtn.style.cursor = "pointer";
    logoutBtn.addEventListener("click", doLogout);
    logoutLi.appendChild(logoutBtn);
    navMenu.appendChild(logoutLi);

  } else {
    // Login knop
    const loginLi = document.createElement("li");
    loginLi.innerHTML = `<a id="login-link" href="${API_URL}/login">
      <button id="discord-login-button">Login</button>
    </a>`;
    navMenu.appendChild(loginLi);
  }
}

// --- Premium in de navigatiebalk -------------------------------------------
//
// DE VLAG IS NIET DE BRON, DE GEPUBLICEERDE DATA IS DAT. `website.enabled` staat
// in een configbestand van de bot; de site kan dat niet lezen en hoort dat ook
// niet te willen. Wat de site wél kan zien is of er tiers zijn om te tonen, en
// dat is precies hetzelfde feit één stap later: de bot schrijft de tiers pas weg
// mét `published = 1` als de vlag aanstaat.
//
// Daarmee bestaat het venster niet meer waarin de vlag aanstaat en de pagina nog
// niets heeft. De link verschijnt op hetzelfde moment als de inhoud, want het IS
// de inhoud.
//
// DIT MAG DE REST VAN DE NAVIGATIE NOOIT OPHOUDEN OF SLOPEN. Daarom staat het in
// een eigen functie die NA `renderNav` draait, niets await wat de nav blokkeert,
// en zijn eigen fouten opeet. Een navigatiebalk die verdwijnt omdat één extra
// link niet op te halen was, is oneindig erger dan een ontbrekende link.
async function addPremiumLink() {
  if (!navMenu) return;
  try {
    const res = await fetchMetDeadline(`${API_URL}/api/premium/tiers`, {
      credentials: "include",
    });
    if (!res.ok) return;                 // 404 = nog niet open, 503 = even niet
    const data = await res.json();
    if (!data || data.available !== true) return;
    if (!Array.isArray(data.tiers) || data.tiers.length === 0) return;
    if (navMenu.querySelector("#premium-link")) return;

    const li = document.createElement("li");
    const a = document.createElement("a");
    a.id = "premium-link";
    a.href = "premium.html";
    a.textContent = "Premium";
    li.appendChild(a);
    navMenu.appendChild(li);
  } catch (err) {
    /* geen premium in de balk; de rest van de balk staat er al */
  }
}

async function checkLogin() {
  try {
    const token = localStorage.getItem("api_token");
    const headers = {};

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // MET DEADLINE. Zonder abort hangt een stille server deze promise voor
    // eeuwig op - en al hangt de balk daar sinds 12 augustus niet meer aan,
    // een login-status die nooit komt is nog steeds een kapotte upgrade.
    const res = await fetchMetDeadline(`${API_URL}/api/me`, {
      credentials: "include",
      headers
    });

    const data = await res.json();

    if (data.logged_in) {
      try {
        sessionStorage.setItem("user_info", JSON.stringify(data.user));
      } catch (err) { /* private mode: geen cache, wel een balk */ }
      renderNav(true, data.user);
    } else {
      clearUserData();
      renderNav(false);
    }
  } catch (err) {
    console.error("Error checking login status:", err);
    clearUserData();
    renderNav(false);
  }
}


async function doLogout() {
  try {
    const res = await fetch(`${API_URL}/logout`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      }
    });

    // Wis altijd direct, ongeacht serverresponse
    clearUserData();

    if (res.ok) {
      renderNav(false);
      window.location.href = "index.html";
    } else {
      alert("Logout failed.");
    }
  } catch (err) {
    console.error("Logout error:", err);
    alert("Logout failed due to network error.");
  }
}


// Sync logout/login over meerdere tabs
window.addEventListener("storage", (event) => {
  if (event.key === "user_info" && !event.newValue) {
    // `renderNav` begint met `innerHTML = essentialLinksHTML` en veegt de
    // premiumlink dus weg. Hij hoort daarna opnieuw te komen, want uitloggen in
    // een ander tabblad verandert niets aan of premium open staat.
    renderNav(false);
    addPremiumLink();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  storeTokenFromUrl();
  // TEKENEN VOOR HET NETWERK. De balk staat er vanaf de eerste tick, uit de
  // sessiecache of als uitgelogde default; checkLogin is daarna een UPGRADE en
  // geen voorwaarde. Premium blijft erachter gehaakt omdat renderNav het menu
  // wist - maar met de deadline op /api/me vuurt die finally altijd binnen
  // acht seconden, ook als de server zwijgt.
  renderNavDirect();
  checkLogin().finally(() => addPremiumLink());
});

