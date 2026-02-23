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
    // Dashboard link
    const dashLi = document.createElement("li");
    dashLi.innerHTML = `<a id="dashboard-link" href="dashboard.html">Dashboard</a>`;
    navMenu.appendChild(dashLi);

    // 🔥 Arcade (NIEUW)
    const arcadeLi = document.createElement("li");
    arcadeLi.innerHTML = `<a id="arcade-link" href="arcade.html">Arcade</a>`;
    navMenu.appendChild(arcadeLi);

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
    renderNav(false);
  }
});

document.addEventListener("DOMContentLoaded", () => {
  storeTokenFromUrl();
  checkLogin();
});
