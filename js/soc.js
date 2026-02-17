import { API_URL } from "./config.js";
import { apiFetch, storeTokenFromUrl } from "./dashboard.js";

const params = new URLSearchParams(window.location.search);
const guildId = params.get("guild_id");

if (!guildId) {
  alert("No guild selected.");
  window.location.href = "dashboard.html";
}

const backLink = document.getElementById("back-link");
if (backLink) {
  backLink.href = `settings.html?guild_id=${guildId}`;
}


document.addEventListener("DOMContentLoaded", () => {
  storeTokenFromUrl();
  loadSOC();
});

async function loadSOC() {
  await loadRisk();
  await loadTimeline();
  await loadSeverity();
  await loadIncidents();
}

async function loadRisk() {
  const res = await apiFetch(`${API_URL}/api/soc/${guildId}/risk`);
  const data = await res.json();

  document.getElementById("risk-score").textContent = data.risk_score.toFixed(2);
  document.getElementById("server-locked").textContent = data.server_locked ? "Yes" : "No";
  document.getElementById("raid-mode").textContent = data.raid_mode ? "Enabled" : "Disabled";

  const badge = document.getElementById("risk-level");
  badge.textContent = data.risk_level;

  badge.className = "risk-badge " + data.risk_level.toLowerCase();
}

let timelineChart;

async function loadTimeline(hours = 24) {
  const res = await apiFetch(
    `${API_URL}/api/soc/${guildId}/incidents/timeline?hours=${hours}`
  );

  const data = await res.json();

  const labels = data.map(row => row.bucket);
  const values = data.map(row => row.count);

  if (timelineChart) timelineChart.destroy();

  timelineChart = new Chart(document.getElementById("timelineChart"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: "#3b82f6",
        tension: 0.3,
        fill: false
      }]
    },
    options: {
      plugins: { legend: { display: false } }
    }
  });
}

document.getElementById("time-filter").addEventListener("change", e => {
  loadTimeline(e.target.value);
});


async function loadSeverity() {
  const res = await apiFetch(`${API_URL}/api/soc/${guildId}/incidents/severity`);
  const data = await res.json();

  const labels = data.map(row => "Severity " + row.severity);
  const values = data.map(row => row.count);

  new Chart(document.getElementById("severityChart"), {
    type: "pie",
    data: {
      labels: labels,
      datasets: [{
        data: values
      }]
    }
  });
}

async function loadIncidents() {
  const res = await apiFetch(`${API_URL}/api/soc/${guildId}/incidents`);
  const data = await res.json();

  const tbody = document.querySelector("#incident-table tbody");
  tbody.innerHTML = "";

  data.forEach(row => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${row.created_at}</td>
      <td>${row.event_type}</td>
      <td>${row.user_id || "-"}</td>
      <td>${row.severity}</td>
    `;

    tbody.appendChild(tr);
  });
}

const token = localStorage.getItem("api_token");
if (!token) {
  alert("You are not logged in.");
  window.location.href = "dashboard.html";
}
