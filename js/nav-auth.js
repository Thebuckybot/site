import { API_URL } from "./config.js";

document.addEventListener("DOMContentLoaded", () => {
  const navMenu = document.getElementById("nav-menu");

  // Token uit localStorage lezen
  const token = localStorage.getItem("api_token");

  // Headers instellen, eventueel met Authorization
  const headers = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  fetch(`${API_URL}/api/me`, {
    credentials: "include",
    headers: headers
  })
    .then(res => {
      if (res.status === 401) {
        // Ongeldig token? Verwijder en refresh
        localStorage.removeItem("api_token");
        return { logged_in: false };
      }
      return res.json();
    })
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
