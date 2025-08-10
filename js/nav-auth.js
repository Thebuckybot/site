import { API_URL } from "./config.js";

document.addEventListener("DOMContentLoaded", () => {
  const navMenu = document.getElementById("nav-menu");

  fetch(`${API_URL}/api/me`, { credentials: "include" })
    .then(res => res.json())
    .then(data => {
      // Verwijder bestaande login/dashboard elementen
      const existingDashboard = document.getElementById("dashboard-link");
      if (existingDashboard) existingDashboard.remove();

      const existingLogin = document.getElementById("login-link");
      if (existingLogin) existingLogin.remove();

      if (data.logged_in) {
        // Dashboard link toevoegen
        const li = document.createElement("li");
        li.innerHTML = `<a id="dashboard-link" href="dashboard.html">Dashboard</a>`;
        navMenu.appendChild(li);

        // Logout link toevoegen
        const logoutLi = document.createElement("li");
        logoutLi.innerHTML = `<a href="${API_URL}/logout">Logout</a>`;
        navMenu.appendChild(logoutLi);
      } else {
        // Login knop toevoegen
        const loginLi = document.createElement("li");
        loginLi.innerHTML = `<a id="login-link" href="${API_URL}/login">
          <button id="discord-login-button">Login</button>
        </a>`;
        navMenu.appendChild(loginLi);
      }
    })
    .catch(err => {
      console.error("Error checking login status:", err);
    });
});