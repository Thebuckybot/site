import { soc, guildId } from "../api.js";
import { el, statCard, pageHeader, table, badge, errorState, fmtTime } from "../ui.js";

export default {
  async render(root) {
    try {
      const [risk, incidents] = await Promise.all([
        soc.get("/risk").catch(() => ({})),
        soc.get("/incidents?page=1").catch(() => []),
      ]);
      root.appendChild(pageHeader("SOC Dashboard", "Security Operations Center — advanced, rule-based detection inside the Security Center."));
      const score = Number((risk && (risk.risk_score ?? risk.score ?? risk.risk)) || 0);
      root.appendChild(el("div", { class: "sec-grid sec-grid-3" }, [
        statCard("Risk Score", Math.round(score)),
        statCard("Server Locked", risk && risk.server_locked ? "Yes" : "No"),
        statCard("Raid Mode", risk && risk.raid_mode ? "On" : "Off"),
      ]));
      const list = Array.isArray(incidents) ? incidents : (incidents && incidents.incidents) || [];
      root.appendChild(el("div", { class: "sec-card", style: "margin-top:16px" }, [
        el("div", { class: "sec-page-title", text: "Recent SOC Incidents" }),
        table([
          { label: "#", key: "id" },
          { label: "Event", render: (i) => i.event_type || i.event || "—" },
          { label: "Severity", render: (i) => badge("sev " + (i.severity ?? "?"), "warn") },
          { label: "User", render: (i) => el("code", { text: i.user_id || "?" }) },
          { label: "When", render: (i) => el("span", { text: fmtTime(i.created_at) }) },
        ], list.slice(0, 15)),
      ]));
      root.appendChild(el("div", { class: "sec-actions", style: "margin-top:16px" }, [
        el("a", { class: "sec-btn sec-btn-primary", href: "#rules", text: "Manage Detection Rules" }),
        el("a", { class: "sec-btn", href: "#liveevents", text: "Live Events" }),
        el("a", { class: "sec-btn", href: `rule-builder.html?guild_id=${guildId()}`, text: "Open Rule Builder" }),
      ]));
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
