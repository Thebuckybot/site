import { API_URL } from "./config.js";
import { apiFetch, storeTokenFromUrl } from './dashboard.js'; // Importeer storeTokenFromUrl

// Gebruik apiFetch(...)

const params = new URLSearchParams(window.location.search);
const guildId = params.get("guild_id");

if (!guildId) {
    alert("No guild selected.");
    window.location.href = "dashboard.html";
}



// settings.js - loadSettings function
async function loadSettings() {
  try {
    const res = await apiFetch(`${API_URL}/api/guild-settings/${guildId}`);

    if (res.status === 403) {
      alert("You do not have permission to view or change these settings.");
      window.location.href = "dashboard.html";
      return;
    }
    if (!res.ok) {
      // De foutmelding verfijnen om de statuscode te tonen
      throw new Error(`Could not fetch guild settings. Status: ${res.status}`);
    }
    const data = await res.json();
    if (!data.guild_id) return;

    renderGuildHeader(data);
    renderSecuritySettings(data.security);
    renderChannelSettings(data.channel_commands);
  } catch (err) {
    const msg = `Error loading settings: ${err.message}\n\nStack:\n${err.stack}`;
    console.error(msg);
    alert(msg); // toont het hele bericht en de stack
    }
}




function renderGuildHeader(data) {
    const iconUrl = data.icon 
        ? `https://cdn.discordapp.com/icons/${data.guild_id}/${data.icon}.png` 
        : "https://cdn.discordapp.com/embed/avatars/0.png";
    document.getElementById("guild-icon").src = iconUrl;
    document.getElementById("guild-name").textContent = data.guild_name || "Unknown server";
}

function renderSecuritySettings(securityData) {
    const antiModeContainer = document.getElementById("anti-mode-toggles");
    antiModeContainer.innerHTML = "";

    const punishmentSettings = securityData?.punishment_settings || {};
    const detectionThresholds = securityData?.detection_thresholds || {};

    const allSettings = { ...punishmentSettings, ...detectionThresholds };
    
    const antiModes = {
        "Anti-nuke": "anti_nuke_enabled", "Anti-raid": "anti_raid_enabled", "Anti-link": "anti_link_enabled",
        "Anti-spam": "anti_spam_enabled", "Anti-mention-spam": "anti_mention_spam_enabled",
        "Anti-token": "anti_token_enabled", "Anti-webhook": "anti_webhook_enabled", "Anti-bot": "anti_bot_enabled",
    };
    
    for (const [name, key] of Object.entries(antiModes)) {
        const label = document.createElement("label");
        label.innerHTML = `
            ${name}:
            <input type="checkbox" id="${key}" ${securityData?.[key] ? 'checked' : ''} />
        `;
        antiModeContainer.appendChild(label);
    }
    
    const punishmentOptionsContainer = document.getElementById("punishment-options");
    punishmentOptionsContainer.innerHTML = "";

    const allActions = [
      { name: "Ban", limitKey: "ban_limit", punishmentKey: "ban_punishment", punishments: ["ban", "kick", "timeout", "take_roles", "none"] },
      { name: "Kick", limitKey: "kick_limit", punishmentKey: "kick_punishment", punishments: ["ban", "kick", "timeout", "take_roles", "none"] },
      { name: "Timeout", limitKey: "timeout_limit", punishmentKey: "timeout_punishment", punishments: ["ban", "kick", "timeout", "take_roles", "none"] },
      { name: "Role Create", limitKey: "role_create_limit", punishmentKey: "role_create_punishment", punishments: ["ban", "kick", "timeout", "take_roles", "none"] },
      { name: "Role Delete", limitKey: "role_delete_limit", punishmentKey: "role_delete_punishment", punishments: ["ban", "kick", "timeout", "take_roles", "none"] },
      { name: "Role Update", limitKey: "role_update_limit", punishmentKey: "role_update_punishment", punishments: ["ban", "kick", "timeout", "take_roles", "none"] },
      { name: "Channel Create", limitKey: "channel_create_limit", punishmentKey: "channel_create_punishment", punishments: ["ban", "kick", "timeout", "take_roles", "none"] },
      { name: "Channel Delete", limitKey: "channel_delete_limit", punishmentKey: "channel_delete_punishment", punishments: ["ban", "kick", "timeout", "take_roles", "none"] },
      { name: "Channel Update", limitKey: "channel_update_limit", punishmentKey: "channel_update_punishment", punishments: ["ban", "kick", "timeout", "take_roles", "none"] },
      { name: "Webhook Create", limitKey: "webhook_create_limit", punishmentKey: "webhook_create_punishment", punishments: ["ban", "kick", "timeout", "take_roles", "none"] },
      { name: "Webhook Delete", limitKey: "webhook_delete_limit", punishmentKey: "webhook_delete_punishment", punishments: ["ban", "kick", "timeout", "take_roles", "none"] },
    ];
    
    allActions.forEach(action => {
        const div = document.createElement("div");
        div.className = "punishment-block";

        const limitValue = allSettings[action.limitKey] !== undefined ? allSettings[action.limitKey] : 0;
        const punishmentValue = allSettings[action.punishmentKey] || 'none';

        div.innerHTML = `
            <h3>${action.name}</h3>
            <label>Limit:
                <input type="number" data-key="${action.limitKey}" value="${limitValue}" min="0" />
            </label>
            <label>Punishment:
                <select data-key="${action.punishmentKey}">
                    ${action.punishments.map(p => `<option value="${p}" ${p === punishmentValue ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`).join('')}
                </select>
            </label>
        `;
        punishmentOptionsContainer.appendChild(div);
    });
}

function renderChannelSettings(channelCommandsData) {
    const container = document.getElementById("channel-settings-container");
    container.innerHTML = "";

    channelCommandsData.forEach(channel => {
        const channelDiv = document.createElement("div");
        channelDiv.className = "channel-card";
        channelDiv.dataset.channelId = channel.channel_id;
        channelDiv.dataset.channelName = channel.channel_name || 'Unknown channel';

        const disabledCommandsHTML = channel.disabled_commands.map(cmd => `
            <label>
                <input type="checkbox" name="command" value="${cmd}" checked /> ${cmd}
            </label>
        `).join('');

        const disabledCogsHTML = channel.disabled_cogs.map(cog => `
            <label>
                <input type="checkbox" name="cog" value="${cog}" checked /> ${cog}
            </label>
        `).join('');

        channelDiv.innerHTML = `
            <h3># ${channel.channel_name || 'Unknown Channel'} <span class="channel-id">(${channel.channel_id})</span></h3>
            <h4>Disabled Commands</h4>
            <div class="disabled-commands-list">
                ${disabledCommandsHTML || '<i>No command\'s disabled in this channel.</i>'}
            </div>
            <h4>Disabled Cogs</h4>
            <div class="disabled-cogs-list">
                ${disabledCogsHTML || '<i>No cogs disabled in this channel.</i>'}
            </div>
        `;
        container.appendChild(channelDiv);
    });
}

document.getElementById("save-settings").addEventListener("click", async () => {
  const security = getSecurityPayload();
  const channelCommands = getChannelCommandsPayload();

  const payload = {
    security: security,
    channel_commands: channelCommands
  };

  console.log("Payload die naar de backend wordt gestuurd:", JSON.stringify(payload, null, 2));

  try {
    const res = await apiFetch(`${API_URL}/api/guild-settings/${guildId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    if (res.status === 403) {
      alert("You do not have permission to save these settings.");
      return;
    }

    if (!res.ok) {
      alert("An error occurred while saving. Status: " + res.status);
      return;
    }

    const data = await res.json();

    if (data && data.success) {
      alert(data.message || "Settings saved!");
    }

  } catch (err) {
    console.error("Error saving settings:", err);
  }
});



function getSecurityPayload() {
    const punishmentSettings = {};
    
    document.querySelectorAll('.punishment-block').forEach(block => {
        const limitInput = block.querySelector('input[type="number"]');
        if (limitInput) {
            punishmentSettings[limitInput.dataset.key] = parseInt(limitInput.value, 10);
        }

        const punishmentSelect = block.querySelector('select');
        if (punishmentSelect) {
            punishmentSettings[punishmentSelect.dataset.key] = punishmentSelect.value;
        }
    });

    const antiModes = {
        "anti_nuke_enabled": document.getElementById("anti_nuke_enabled")?.checked,
        "anti_raid_enabled": document.getElementById("anti_raid_enabled")?.checked,
        "anti_link_enabled": document.getElementById("anti_link_enabled")?.checked,
        "anti_spam_enabled": document.getElementById("anti_spam_enabled")?.checked,
        "anti_mention_spam_enabled": document.getElementById("anti_mention_spam_enabled")?.checked,
        "anti_token_enabled": document.getElementById("anti_token_enabled")?.checked,
        "anti_webhook_enabled": document.getElementById("anti_webhook_enabled")?.checked,
        "anti_bot_enabled": document.getElementById("anti_bot_enabled")?.checked,
    };

    return {
        ...antiModes,
        punishment_settings: punishmentSettings
    };
}

function getChannelCommandsPayload() {
    const channelCommandsData = [];
    document.querySelectorAll('.channel-card').forEach(card => {
        const channelId = card.dataset.channelId;
        const channelName = card.dataset.channelName;
        
        const disabledCommands = Array.from(card.querySelectorAll('.disabled-commands-list input:checked'))
            .map(input => input.value);
        
        const disabledCogs = Array.from(card.querySelectorAll('.disabled-cogs-list input:checked'))
            .map(input => input.value);
        
        channelCommandsData.push({
            channel_id: channelId,
            channel_name: channelName,
            disabled_commands: disabledCommands,
            disabled_cogs: disabledCogs
        });
    });
    return channelCommandsData;
}


document.addEventListener("DOMContentLoaded", () => {
  storeTokenFromUrl();

  const token = localStorage.getItem("api_token");
  if (!token) {
    alert("You are not logged in. Redirecting to dashboard...");
    window.location.href = "dashboard.html";
    return;
  }

  loadSettings();
});
