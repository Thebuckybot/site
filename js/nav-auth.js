import { API_URL } from "./config.js";

const navMenu = document.getElementById("nav-menu");

// Deze elementen willen we altijd tonen, ongeacht login status
const essentialLinksHTML = `
  <li><a href="tos.html">Terms of Service</a></li>
  <li><a href="privacy.html">Privacy Policy</a></li>
`;

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
    const res = await fetch(`${API_URL}/api/premium/tiers`, {
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

    const res = await fetch(`${API_URL}/api/me`, {
      credentials: "include",
      headers
    });

    const data = await res.json();

    if (data.logged_in) {
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
  // DE BALK EERST, PREMIUM DAARNA. `checkLogin` rendert de nav; de premiumlink is
  // een toevoeging erop en wordt daarom apart gestart in plaats van ervoor of
  // erbinnen. Zo kan een langzame of stukke premium-endpoint de navigatie niet
  // vertragen en niet meenemen.
  checkLogin().finally(() => addPremiumLink());
});

