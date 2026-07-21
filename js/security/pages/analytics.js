import { api } from "../api.js";
import { el, statCard, pageHeader, errorState } from "../ui.js";

export default {
  async render(root) {
    try {
      const [a, timeline] = await Promise.all([
        api.get("/analytics"),
        api.get("/analytics/timeline?days=14").catch(() => ({ points: [] })),
      ]);
      root.appendChild(pageHeader("Analytics", "Security activity and trends for this server."));
      root.appendChild(el("div", { class: "sec-grid sec-grid-4" }, [
        statCard("Incidents (24h)", a.incidents_today),
        statCard("Incidents (7d)", a.incidents_week),
        statCard("Quarantined", a.quarantined_active),
        statCard("Risk Level", Math.round(a.risk_score || 0)),
      ]));

      const card = el("div", { class: "sec-card", style: "margin-top:16px" }, [
        el("div", { class: "sec-page-title", text: "Top Triggered Modules (7d)" }),
      ]);
      const top = a.top_modules || [];
      if (!top.length) {
        card.appendChild(el("p", { class: "sec-muted", text: "No incidents in the last 7 days." }));
      } else if (window.Chart) {
        const canvas = el("canvas");
        card.appendChild(el("div", { class: "sec-chart" }, [canvas]));
        new window.Chart(canvas.getContext("2d"), {
          type: "bar",
          data: { labels: top.map((t) => t.module), datasets: [{ label: "Incidents", data: top.map((t) => t.count), backgroundColor: "#5865f2" }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#94a0bd" } }, y: { ticks: { color: "#94a0bd" }, beginAtZero: true } } },
        });
      } else {
        // graceful fallback bars if Chart.js did not load
        const max = Math.max(...top.map((t) => t.count), 1);
        top.forEach((t) => card.appendChild(el("div", { class: "sec-row", style: "margin:6px 0" }, [
          el("span", { style: "width:160px", text: t.module }),
          el("div", { style: `height:14px;border-radius:6px;background:#5865f2;width:${(t.count / max) * 100}%` }),
          el("span", { class: "sec-muted", text: String(t.count) }),
        ])));
      }
      root.appendChild(card);

      // Incident timeline (last 14 days)
      const tl = el("div", { class: "sec-card", style: "margin-top:16px" }, [
        el("div", { class: "sec-page-title", text: "Incident Timeline (14d)" }),
      ]);
      const pts = (timeline && timeline.points) || [];
      if (!pts.length) {
        tl.appendChild(el("p", { class: "sec-muted", text: "No incidents in the last 14 days." }));
      } else if (window.Chart) {
        const canvas = el("canvas");
        tl.appendChild(el("div", { class: "sec-chart" }, [canvas]));
        new window.Chart(canvas.getContext("2d"), {
          type: "line",
          data: { labels: pts.map((p) => p.day), datasets: [{ label: "Incidents", data: pts.map((p) => p.count), borderColor: "#5865f2", backgroundColor: "rgba(88,101,242,.2)", tension: .3, fill: true }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#94a0bd" } }, y: { ticks: { color: "#94a0bd" }, beginAtZero: true } } },
        });
      } else {
        pts.forEach((p) => tl.appendChild(el("div", { class: "sec-row", style: "margin:4px 0" }, [
          el("span", { style: "width:110px", class: "sec-muted", text: p.day }),
          el("span", { text: String(p.count) }),
        ])));
      }
      root.appendChild(tl);
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
