import { API_URL } from "./config.js";

document.addEventListener("DOMContentLoaded", () => {
  const navMenu = document.getElementById("nav-menu");

  // Controleer eerst of de gebruiker lokaal in de sessionStorage is opgeslagen
  const cachedUser = sessionStorage.getItem("user_info");
  if (cachedUser) {
    const data = { logged_in: true, user: JSON.parse(cachedUser) };
    renderNavMenu(data);
    return;
  }

  // Als er geen lokale data is, roep de API aan
  fetch(`${API_URL}/api/me`, { credentials: "include" })
    .then(res => res.json())
    .then(data => {
      // Sla de gebruikersdata op in sessionStorage als de gebruiker is ingelogd
      if (data.logged_in) {
        sessionStorage.setItem("user_info", JSON.stringify(data.user));
      } else {
        // Leeg de cache als de gebruiker niet is ingelogd
        sessionStorage.removeItem("user_info");
      }
      renderNavMenu(data);
    })
    .catch(err => {
      console.error("Error checking login status:", err);
      sessionStorage.removeItem("user_info");
      renderNavMenu({ logged_in: false });
    });
});

function renderNavMenu(data) {
  const navMenu = document.getElementById("nav-menu");

  const existingDashboard = document.getElementById("dashboard-link");
  if (existingDashboard) existingDashboard.remove();

  const existingLogin = document.getElementById("login-link");
  if (existingLogin) existingLogin.remove();

  if (data.logged_in) {
    const li = document.createElement("li");
    li.innerHTML = `<a id="dashboard-link" href="dashboard.html">Dashboard</a>`;
    navMenu.appendChild(li);

    const logoutLi = document.createElement("li");
    logoutLi.innerHTML = `<a href="${API_URL}/logout">Logout</a>`;
    navMenu.appendChild(logoutLi);
  } else {
    const loginLi = document.createElement("li");
    loginLi.innerHTML = `<a id="login-link" href="${API_URL}/login">
      <button id="discord-login-button">Login</button>
    </a>`;
    navMenu.appendChild(loginLi);
  }
}