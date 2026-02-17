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


    const token = localStorage.getItem("api_token");
    if (!token) {
        alert("You are not logged in.");
        window.location.href = "dashboard.html";
    }

    // Back link fix
    const backLink = document.getElementById("back-link");
    if (backLink)
    backLink.href = `soc.html?guild_id=${guildId}`;

    await loadRegistry();
    await loadRules();
});


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

  registry.conditions.forEach(cond => {
    const opt = document.createElement("option");
    opt.value = cond.type;
    opt.textContent = cond.label;
    select.appendChild(opt);
  });

  const fieldsContainer = document.createElement("div");

  select.addEventListener("change", () => {
    renderFields(select.value, fieldsContainer, "condition");
  });

  renderFields(select.value, fieldsContainer, "condition");

  block.append(removeBtn, select, fieldsContainer);
  container.appendChild(block);
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
    renderFields(select.value, fieldsContainer, "action");
  });

  renderFields(select.value, fieldsContainer, "action");

  block.append(removeBtn, select, fieldsContainer);
  container.appendChild(block);
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
      cond[field.dataset.field] = field.value;
    });

    conditions.push(cond);
  });

  const actions = [];
  document.querySelectorAll(".action-block").forEach(block => {
    const action = block.querySelector("select").value;
    const act = { action };

    block.querySelectorAll("[data-field]").forEach(field => {
      act[field.dataset.field] = field.value;
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

    card.innerHTML = `
      <div class="rule-header">
        <div>
          <div class="rule-title">${rule.name}</div>
          <div class="rule-meta">${rule.event_type} • Severity ${rule.severity}</div>
        </div>

        <div class="rule-controls">
          <label class="switch">
            <input type="checkbox" ${rule.enabled ? "checked" : ""} data-id="${rule.id}">
            <span class="slider"></span>
          </label>
          <button class="delete-btn" data-id="${rule.id}">⋮</button>
        </div>
      </div>

      <div class="rule-details hidden">
        Conditions & Actions configured
      </div>
    `;

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

    body.innerHTML = `
    <strong>Event:</strong> ${rule.event_type}<br>
    <strong>Severity:</strong> ${rule.severity}<br>
    <strong>Created:</strong> ${created}
    <br><br>

    <strong>Conditions:</strong>
    <pre>${JSON.stringify(rule.conditions_json, null, 2)}</pre>

    <strong>Actions:</strong>
    <pre>${JSON.stringify(rule.actions_json, null, 2)}</pre>
    `;


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
