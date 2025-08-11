import { API_URL } from "./config.js";

const guildContainer = document.getElementById("guilds-container");
const userInfo = document.getElementById("user-info");

const BOT_ID = "907664862493167680";

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
      window.location.href = `settings.html?guild_id=${guild.id}`;
    } else {
      window.location.href = getInviteURL(guild.id);
    }
  };

  guildContainer.appendChild(card);
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

// Data ophalen (met sessionStorage caching)
function loadDashboard() {
  const cached = sessionStorage.getItem("user_guilds");
  const cachedUser = sessionStorage.getItem("user_info");

  if (cached && cachedUser) {
    const guilds = JSON.parse(cached);
    const user = JSON.parse(cachedUser);
    
    // Render de gebruiker eerst
    userInfo.innerHTML = `
      <img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png" class="avatar" />
      <span>${user.username}</span>
    `;

    renderGuilds(guilds);
    return;
  }

  fetch(`${API_URL}/api/me`, { credentials: "include" })
    .then(res => res.json())
    .then(data => {
      const navMenu = document.getElementById("nav-menu");

      if (!data.logged_in) {
        const dashboardLink = document.querySelector("#dashboard-link");
        if (dashboardLink) dashboardLink.remove();

        const redirectUrl = encodeURIComponent(window.location.href);
        window.location.href = `${API_URL}/login?redirect=${redirectUrl}`;
        return;
      }

      // Dashboard link toevoegen
      if (!document.querySelector("#dashboard-link")) {
        const li = document.createElement("li");
        li.innerHTML = `<a id="dashboard-link" href="dashboard.html">Dashboard</a>`;
        navMenu.appendChild(li);
      }

      const user = data.user;
      
      // Gebruikersinfo en guilds in sessionStorage zetten
      sessionStorage.setItem("user_info", JSON.stringify(user));
      sessionStorage.setItem("user_guilds", JSON.stringify(data.guilds));
      
      // Render de gebruiker eerst
      userInfo.innerHTML = `
        <img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png" class="avatar" />
        <span>${user.username}</span>
      `;
      
      // Render daarna de guilds
      renderGuilds(data.guilds);
    })
    .catch(err => {
      console.error("Error loading dashboard:", err);
      window.location.href = "/";
    });
}

// Start
loadDashboard();