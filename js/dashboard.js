const guildContainer = document.getElementById("guilds-container");
const userInfo = document.getElementById("user-info");

const BOT_ID = "907664862493167680"; // Jouw Bucky bot client ID

// Invite link genereren
function getInviteURL() {
  const permissions = 8; // Of specifieker
  const scopes = "bot applications.commands";
  return `https://discord.com/oauth2/authorize?client_id=${BOT_ID}&scope=${scopes}&permissions=${permissions}`;
}

// Serverkaart genereren
function createGuildCard(guild, botInGuild) {
  const card = document.createElement("div");
  card.className = "guild-card";
  card.style.border = `4px solid ${botInGuild ? "limegreen" : "crimson"}`;

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
      window.location.href = getInviteURL();
    }
  };

  guildContainer.appendChild(card);
}

// Eerst userdata ophalen van backend
fetch("http://localhost:5000/api/me", { credentials: "include" })
  .then(res => res.json())
  .then(async data => {
    if (!data.logged_in) {
      const redirectUrl = encodeURIComponent(window.location.href);
      window.location.href = `http://localhost:5000/login?redirect=${redirectUrl}`;
      return;
    }

    const user = data.user;
    userInfo.innerHTML = `
      <img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png" class="avatar" />
      <span>${user.username}#${user.discriminator}</span>
    `;

    // Nu access token ophalen van backend
    const tokenRes = await fetch("http://localhost:5000/api/token", { credentials: "include" });
    if (!tokenRes.ok) {
      console.error("Token ophalen mislukt");
      return;
    }
    const { access_token } = await tokenRes.json();

    // Guilds ophalen via Discord API met token
    const guildRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    if (!guildRes.ok) {
      console.error("Guilds ophalen mislukt");
      return;
    }
    const guilds = await guildRes.json();

    for (const guild of guilds) {
      const botInGuild = guild.permissions && (guild.permissions & 0x20); // MANAGE_GUILD
      createGuildCard(guild, botInGuild);
    }
  })
  .catch(err => {
    console.error("Error loading dashboard:", err);
    window.location.href = "/";
  });
