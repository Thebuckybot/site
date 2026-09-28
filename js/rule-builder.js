import { API_URL } from "./config.js";
import { apiFetch, storeTokenFromUrl } from "./dashboard.js";

const params = new URLSearchParams(window.location.search);
const guildId = params.get("guild_id");

if (!guildId) {
  alert("No guild selected.");
  window.location.href = "dashboard.html";
}



document.addEventListener("DOMContentLoaded", async () => {
    storeTokenFromUrl();

    // Sidebar link fix
    const overviewLink = document.getElementById("overview-link");
    const settingsLink = document.getElementById("settings-link");
    const logsLink = document.getElementById("logs-link");

    if (guildId) {
        if (overviewLink)
            overviewLink.href = `soc.html?guild_id=${guildId}`;

        if (settingsLink)
            settingsLink.href = `settings.html?guild_id=${guildId}`;

        if (logsLink)
            logsLink.href = `soc.html?guild_id=${guildId}&view=logs`;
    }


    // Geen token-poort meer (sessiemodel, 27-9-2026): de sessie is een httpOnly-cookie
    // die JavaScript niet kan zien. Wie niet is ingelogd krijgt een 401 van de API;
    // dat is de echte poort, en die bestond al.

    // Back link fix
    const backLink = document.getElementById("back-link");
    if (backLink)
    backLink.href = `soc.html?guild_id=${guildId}`;

    await loadRegistry();
    await loadRules();
});


// Een element met klasse en tekst - tekst altijd via textContent.
function maak(tag, className = "", text = null) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = String(text);
  return n;
}

let registry;
const MAX_CONDITIONS = 3;
const MAX_ACTIONS = 3;


async function loadRegistry() {
  const res = await apiFetch(`${API_URL}/api/soc/rule-registry`);
  registry = await res.json();

  const eventSelect = document.getElementById("event-select");

  registry.events.forEach(ev => {
    const opt = document.createElement("option");
    opt.value = ev.value;
    opt.textContent = ev.label;
    eventSelect.appendChild(opt);
  });
}

document.getElementById("add-condition").addEventListener("click", () => {
  addConditionBlock();
});

document.getElementById("add-action").addEventListener("click", () => {
  addActionBlock();
});

document.getElementById("event-select").addEventListener("change", () => {
  document.getElementById("conditions-container").innerHTML = "";
  document.getElementById("actions-container").innerHTML = "";
});

function addConditionBlock() {

    const container = document.getElementById("conditions-container");

    if (container.children.length >= MAX_CONDITIONS) {
        alert("Maximum conditions reached.");
        return;
    }

    const block = document.createElement("div");
    block.className = "condition-block";

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.className = "remove-btn";
    removeBtn.onclick = () => block.remove();

    const select = document.createElement("select");

    // Placeholder option
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select condition...";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    const eventType = document.getElementById("event-select").value;
    const allowedConditions = registry.event_condition_map[eventType] || [];

    registry.conditions
    .filter(cond => allowedConditions.includes(cond.type))
    .forEach(cond => {
        const opt = document.createElement("option");
        opt.value = cond.type;
        opt.textContent = cond.label;
        select.appendChild(opt);
    });

    const fieldsContainer = document.createElement("div");

    select.addEventListener("change", () => {
        if (!select.value) return;  // voorkomt render bij placeholder
        renderFields(select.value, fieldsContainer, "condition");
  });

  block.append(removeBtn, select, fieldsContainer);
  container.appendChild(block);
  block.scrollIntoView({ behavior: "smooth", block: "center" });
}


function addActionBlock() {

    const container = document.getElementById("actions-container");

    if (container.children.length >= MAX_ACTIONS) {
        alert("Maximum actions reached.");
        return;
    }

    const eventType = document.getElementById("event-select").value;
    const allowedActions = registry.event_action_map[eventType] || [];

    const block = document.createElement("div");
    block.className = "action-block";

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.className = "remove-btn";
    removeBtn.onclick = () => block.remove();

    const select = document.createElement("select");

    // Placeholder
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select action...";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    registry.actions
    .filter(a => allowedActions.includes(a.action))
    .forEach(act => {
        const opt = document.createElement("option");
        opt.value = act.action;
        opt.textContent = act.label;
        select.appendChild(opt);
    });

    const fieldsContainer = document.createElement("div");

    select.addEventListener("change", () => {
        if (!select.value) return;
        renderFields(select.value, fieldsContainer, "action");
    });

    block.append(removeBtn, select, fieldsContainer);
    container.appendChild(block);
    block.scrollIntoView({ behavior: "smooth", block: "center" });
}


function renderFields(type, container, mode) {
  container.innerHTML = "";

  const source = mode === "condition"
    ? registry.conditions.find(c => c.type === type)
    : registry.actions.find(a => a.action === type);

  if (!source || !source.fields) return;

  source.fields.forEach(field => {
    let input;

    if (field.type === "select") {
      input = document.createElement("select");
      field.options.forEach(opt => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        input.appendChild(o);
      });
    } else {
      input = document.createElement("input");
      input.type = field.type;
      input.placeholder = field.placeholder;
    }

    input.dataset.field = field.name;
    container.appendChild(input);
  });
}

document.getElementById("save-rule").addEventListener("click", async () => {

  const name = document.getElementById("rule-name").value;
  const eventType = document.getElementById("event-select").value;
  const severity = parseInt(document.getElementById("severity").value);

  const conditions = [];
  document.querySelectorAll(".condition-block").forEach(block => {
    const type = block.querySelector("select").value;
    const cond = { type };

    block.querySelectorAll("[data-field]").forEach(field => {

    let value = field.value;

    // Fallback naar placeholder indien leeg
    if (!value || value.trim() === "") {
        value = field.placeholder || null;
    }

    // Convert numbers properly
    if (field.type === "number" && value !== null) {
        value = parseInt(value);
    }

    cond[field.dataset.field] = value;
    });

    conditions.push(cond);
  });

  const actions = [];
  document.querySelectorAll(".action-block").forEach(block => {
    const action = block.querySelector("select").value;
    const act = { action };

    block.querySelectorAll("[data-field]").forEach(field => {

    let value = field.value;

    // Fallback naar placeholder indien leeg
    if (!value || value.trim() === "") {
        value = field.placeholder || null;
    }

    // Convert numbers properly
    if (field.type === "number" && value !== null) {
        value = parseInt(value);
    }

    act[field.dataset.field] = value;
    });


    actions.push(act);
  });

    const res = await apiFetch(`${API_URL}/api/soc/${guildId}/rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        name,
        event_type: eventType,
        conditions,
        actions,
        severity
    })
    });

    if (res.ok) {

    // Reset form
    document.getElementById("rule-name").value = "";
    document.getElementById("conditions-container").innerHTML = "";
    document.getElementById("actions-container").innerHTML = "";

    await loadRules();

    } else {
    const error = await res.json();
    alert(error.error || "Failed to create rule");
    }

});

async function loadRules() {

  const res = await apiFetch(`${API_URL}/api/soc/${guildId}/rules`);
  const data = await res.json();

  const list = document.getElementById("rule-list");
  list.innerHTML = "";

  data.forEach(rule => {

    const card = document.createElement("div");
    card.className = "rule-card";

    // Met DOM en textContent: naam, event_type en severity komen uit een
    // API-antwoord, en in het oude innerHTML-sjabloon voerde een <img onerror>
    // in die velden echt uit.
    const header = maak("div", "rule-header");
    const tekst = document.createElement("div");
    tekst.append(maak("div", "rule-title", `${rule.name}`),
                 maak("div", "rule-meta", `${rule.event_type} • Severity ${rule.severity}`));

    const controls = maak("div", "rule-controls");
    const schakelaar = maak("label", "switch");
    const vinkje = document.createElement("input");
    vinkje.type = "checkbox";
    vinkje.defaultChecked = !!rule.enabled;
    vinkje.dataset.id = rule.id;
    schakelaar.append(vinkje, maak("span", "slider"));
    const menu = maak("button", "delete-btn", "⋮");
    menu.dataset.id = rule.id;
    controls.append(schakelaar, menu);
    header.append(tekst, controls);

    card.append(header, maak("div", "rule-details hidden", "Conditions & Actions configured"));

    // Toggle enable
    card.querySelector("input").addEventListener("change", async e => {
      await apiFetch(`${API_URL}/api/soc/${guildId}/rules/${rule.id}/toggle`, {
        method: "PATCH"
      });
    });

    // Expand details
    card.querySelector(".rule-header").addEventListener("click", () => {
      card.querySelector(".rule-details").classList.toggle("hidden");
    });

    // Delete
    card.querySelector(".delete-btn").addEventListener("click", e => {
    e.stopPropagation();
    openRuleModal(rule);
    });


    list.appendChild(card);
  });
}


function openRuleModal(rule) {

  const modal = document.getElementById("rule-modal");
  const title = modal.querySelector(".modal-title");
  const body = modal.querySelector(".modal-body");
  const deleteBtn = modal.querySelector(".modal-delete");

  title.innerText = rule.name;

    const created = rule.created_at
    ? new Date(rule.created_at).toLocaleString()
    : "-";

    body.replaceChildren(
      maak("strong", "", "Event:"), ` ${rule.event_type}`, document.createElement("br"),
      maak("strong", "", "Severity:"), ` ${rule.severity}`, document.createElement("br"),
      maak("strong", "", "Created:"), ` ${created}`,
      document.createElement("br"), document.createElement("br"),
      maak("strong", "", "Conditions:"),
      maak("pre", "", `${JSON.stringify(rule.conditions_json, null, 2)}`),
      maak("strong", "", "Actions:"),
      maak("pre", "", `${JSON.stringify(rule.actions_json, null, 2)}`),
    );


  deleteBtn.onclick = async () => {
    await apiFetch(`${API_URL}/api/soc/${guildId}/rules/${rule.id}`, {
      method: "DELETE"
    });

    modal.classList.add("hidden");
    loadRules();
  };

  // Close on outside click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.classList.add("hidden");
    }
  };

  // Close on ESC
  document.onkeydown = (e) => {
    if (e.key === "Escape") {
      modal.classList.add("hidden");
    }
  };

  modal.classList.remove("hidden");
}
