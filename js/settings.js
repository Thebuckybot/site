import { API_URL } from "./config.js";
import { apiFetch, storeTokenFromUrl } from './dashboard.js'; // Importeer storeTokenFromUrl

// Gebruik apiFetch(...)

const params = new URLSearchParams(window.location.search);
const guildId = params.get("guild_id");

// De knop naar Security v2 in de deprecatiebalk neemt de guild mee. Dit stond
// als inline <script> in settings.html; de Content Security Policy van de site
// staat geen inline scripts meer toe.
if (guildId) {
  const v2 = document.getElementById("v2-open");
  if (v2) v2.href = "security.html?guild_id=" + guildId;
}

// Een element met klasse en tekst - tekst altijd via textContent, nooit als HTML.
function maak(tag, className = "", text = null) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = String(text);
  return n;
}

// <label class="switch"><input type="checkbox" ...><span class="slider"></span></label>
function schakelaar(data, value, aan) {
  const label = maak("label", "switch");
  const input = document.createElement("input");
  input.type = "checkbox";
  for (const [k, v] of Object.entries(data)) input.dataset[k] = v;
  input.setAttribute("value", value);
  input.defaultChecked = aan;
  label.append(input, maak("span", "slider"));
  return label;
}

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

    const kop = maak("div", "cog-header")
    kop.append(
      maak("button", "cog-toggle", "▶"),
      maak("span", "cog-name", cog),
      schakelaar({ type: "cog" }, cog, !cogDisabled),
    )
    const commandList = maak("div", "command-list")
    cogDiv.append(kop, commandList)

    allCommands[cog].forEach(cmd => {

      const disabled = disabledCommands.includes(cmd)

      const row = document.createElement("div")
      row.className = "command-row"

      row.append(
        maak("span", "", cmd),
        schakelaar({ type: "command", cog }, cmd, !disabled),
      )

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
        const vinkje = document.createElement("input");
        vinkje.type = "checkbox";
        vinkje.id = key;
        vinkje.defaultChecked = !!securityData?.[key];
        label.append(` ${name}: `, vinkje, " ");
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

        const limiet = document.createElement("input");
        limiet.type = "number";
        limiet.dataset.key = action.limitKey;
        limiet.setAttribute("value", String(limitValue));
        limiet.min = "0";

        const keuze = document.createElement("select");
        keuze.dataset.key = action.punishmentKey;
        for (const p of action.punishments) {
          const tekst = p.charAt(0).toUpperCase() + p.slice(1);
          keuze.appendChild(new Option(tekst, p, p === punishmentValue, p === punishmentValue));
        }

        // De spaties staan er zoals het oude sjabloon ze na het inklappen van
        // witruimte opleverde: de labels zijn inline, dus ze tellen mee.
        const limietLabel = document.createElement("label");
        limietLabel.append("Limit: ", limiet, " ");
        const strafLabel = document.createElement("label");
        strafLabel.append("Punishment: ", keuze, " ");
        div.append(maak("h3", "", action.name), " ", limietLabel, " ", strafLabel, " ");
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

  // -----------------------------
  // COG TOGGLE
  // -----------------------------

    if(e.target.dataset.type === "cog"){

    const cog = e.target.value
    const enabled = e.target.checked

    const commands = document.querySelectorAll(`input[data-type="command"][data-cog="${cog}"]`)

    // Cog OFF → alles uit
    if(!enabled){
        commands.forEach(cmd=>{
        cmd.checked = false
        })
    }

    // Cog ON → alles aan
    if(enabled){
        commands.forEach(cmd=>{
        cmd.checked = true
        })
    }

    const block = e.target.closest(".cog-block")
    const list = block.querySelector(".command-list")
    const arrow = block.querySelector(".cog-toggle")

    list.classList.add("open")
    arrow.style.transform = "rotate(90deg)"
    }


  // -----------------------------
  // COMMAND TOGGLE
  // -----------------------------

  if(e.target.dataset.type === "command"){

    const cog = e.target.dataset.cog
    const cogToggle = document.querySelector(`input[data-type="cog"][value="${cog}"]`)

    // Command ON → cog automatisch ON
    if(e.target.checked){
      if(cogToggle && !cogToggle.checked){
        cogToggle.checked = true
      }
    }

    // Command OFF → niets met cog doen
  }

})

document.addEventListener("DOMContentLoaded", () => {
  storeTokenFromUrl();

  // Geen token-poort meer (sessiemodel, 27-9-2026): de sessie is een httpOnly-cookie
  // die JavaScript niet kan zien. Wie niet is ingelogd krijgt een 401 van de API;
  // dat is de echte poort, en die bestond al.

  // SOC is now a section of the one Security Center — link straight into the
  // SPA (security.html#soc), not the deprecated standalone soc.html shell.
  const socLink = document.getElementById("soc-link");
  if (socLink) {
    socLink.href = `security.html?guild_id=${guildId}#soc`;
  }

  loadSettings();
});
