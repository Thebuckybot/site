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
async function loadSettings(){

  try{

    const [settingsRes, commandsRes] = await Promise.all([
      apiFetch(`${API_URL}/api/guild-settings/${guildId}`),
      apiFetch(`${API_URL}/api/bot/commands`)
    ])

    const settings = await settingsRes.json()
    const commands = await commandsRes.json()

    renderGuildHeader(settings)
    renderSecuritySettings(settings.security)

    renderCommandTree(commands, settings.server_commands)

  }
  catch(err){

    console.error(err)

  }

}

function renderCommandTree(allCommands, disabledData){

  const container = document.getElementById("command-tree")

  container.innerHTML = ""

  const disabledCommands = disabledData?.disabled_commands || []
  const disabledCogs = disabledData?.disabled_cogs || []

  for(const cog in allCommands){

    const cogDiv = document.createElement("div")
    cogDiv.className = "cog-block"

    const cogDisabled = disabledCogs.includes(cog)

    cogDiv.innerHTML = `
    
    <div class="cog-header">

      <button class="cog-toggle">▶</button>

      <span class="cog-name">${cog}</span>

      <label class="switch">
        <input type="checkbox" data-type="cog" value="${cog}" ${!cogDisabled ? "checked":""}>
        <span class="slider"></span>
      </label>

    </div>

    <div class="command-list"></div>
    
    `

    const commandList = cogDiv.querySelector(".command-list")

    allCommands[cog].forEach(cmd => {

      const disabled = disabledCommands.includes(cmd)

      const row = document.createElement("div")
      row.className = "command-row"

      row.innerHTML = `

        <span>${cmd}</span>

        <label class="switch">
          <input type="checkbox" data-type="command" data-cog="${cog}" value="${cmd}" ${!disabled ? "checked":""}>
          <span class="slider"></span>
        </label>

      `

      commandList.appendChild(row)

    })

    container.appendChild(cogDiv)

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



document.getElementById("save-settings").addEventListener("click", async () => {
    const security = getSecurityPayload();
    const serverCommands = getServerCommandsPayload();

    const payload = {
    security: security,
    server_commands: serverCommands
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

function getServerCommandsPayload(){

  const disabledCommands = []
  const disabledCogs = []

  document.querySelectorAll('input[data-type="command"]').forEach(el=>{

    if(!el.checked){

      disabledCommands.push(el.value)

    }

  })

  document.querySelectorAll('input[data-type="cog"]').forEach(el=>{

    if(!el.checked){

      disabledCogs.push(el.value)

    }

  })

  return{

    disabled_commands: disabledCommands,
    disabled_cogs: disabledCogs

  }

}


document.addEventListener("click", e => {

  if(e.target.classList.contains("cog-toggle")){

    const block = e.target.closest(".cog-block")
    const list = block.querySelector(".command-list")

    list.classList.toggle("open")

    if(list.classList.contains("open")){
      e.target.style.transform = "rotate(90deg)"
    }else{
      e.target.style.transform = "rotate(0deg)"
    }

  }

})

document.addEventListener("change", e => {

    if(e.target.dataset.type === "cog"){
        const cog = e.target.value
        const enabled = e.target.checked

        const commands = document.querySelectorAll(`input[data-type="command"][data-cog="${cog}"]`)

        commands.forEach(cmd => {
            cmd.checked = enabled
        })

        // open cog zodat user ziet wat er gebeurt
        const block = e.target.closest(".cog-block")
        const list = block.querySelector(".command-list")
        const arrow = block.querySelector(".cog-toggle")

        list.classList.add("open")
        arrow.style.transform = "rotate(90deg)"
    }

    if(e.target.dataset.type === "command"){

        const cog = e.target.dataset.cog

        const commands = document.querySelectorAll(`input[data-type="command"][data-cog="${cog}"]`)
        const cogSwitch = document.querySelector(`input[data-type="cog"][value="${cog}"]`)

        const allEnabled = [...commands].every(cmd => cmd.checked)

        cogSwitch.checked = allEnabled
    }

})

document.addEventListener("DOMContentLoaded", () => {
  storeTokenFromUrl();

  const token = localStorage.getItem("api_token");
  if (!token) {
    alert("You are not logged in. Redirecting to dashboard...");
    window.location.href = "dashboard.html";
    return;
  }

  // 👇 HIER TOEVOEGEN
  const socLink = document.getElementById("soc-link");
  if (socLink) {
    socLink.href = `soc.html?guild_id=${guildId}`;
  }

  loadSettings();
});
