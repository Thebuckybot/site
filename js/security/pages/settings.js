import { api } from "../api.js";
import { el, badge, toast, errorState, infoTitle } from "../ui.js";
import { settingDesc } from "../descriptions.js";

export default {
  async render(root) {
    try {
      const s = await api.get("/settings");
      root.appendChild(infoTitle("Settings", "General configuration and data retention for this server."));
      root.appendChild(el("p", { class: "sec-page-sub", text: "The bot is always the authority - these settings are validated and applied server-side." }));

      // General
      root.appendChild(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "General" }),
        row("Mode", badge(String(s.mode).toUpperCase(), s.mode === "hard" ? "warn" : "ok"), settingDesc("mode")),
        row("Administrator immunity", el("span", { text: s.admin_immunity ? "On" : "Off" }), settingDesc("admin_immunity")),
        row("Owner-only immunity", el("span", { text: s.owner_only_immunity ? "On" : "Off" }), settingDesc("owner_only_immunity")),
        row("Config version", el("code", { text: s.config_version }), "Increments on every change; the bot reloads its cache when it changes."),
      ]));

      // Retention
      const tiers = (s.retention && s.retention.selectable) || [14];
      const premium = ((s.retention && s.retention.tiers && s.retention.tiers.premium) || []);
      const sel = el("select", { class: "sec-select" });
      tiers.forEach((d) => {
        const o = el("option", { value: d, text: d === 0 ? "Unlimited" : `${d} days` });
        if (d === s.retention_days) o.selected = true;
        sel.appendChild(o);
      });
      premium.forEach((d) => sel.appendChild(el("option", { value: d, disabled: true, text: `${d === 0 ? "Unlimited" : d + " days"} (Premium)` })));
      sel.addEventListener("change", async () => {
        try { await api.post("/settings/retention", { retention_days: Number(sel.value) }); toast("Retention updated."); }
        catch (e) { toast(e.message, "err"); sel.value = String(s.retention_days); }
      });
      root.appendChild(el("div", { class: "sec-card", style: "margin-top:16px" }, [
        infoTitle("Data Retention", settingDesc("retention"), "div", "sec-page-title"),
        el("p", { class: "sec-muted", text: "Incidents, audit logs and analytics older than this window are removed automatically." }),
        el("div", { class: "sec-settings-row" }, [
          el("div", { class: "k" }, [el("div", { text: "Keep security data for" })]),
          sel,
        ]),
        el("p", { class: "sec-muted", text: "Longer retention windows are available on Bucky Premium." }),
      ]));
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};

function row(label, valueNode, desc) {
  const k = el("div", { class: "k" }, [el("div", { text: label })]);
  if (desc) k.appendChild(el("div", { class: "desc", text: desc }));
  return el("div", { class: "sec-settings-row" }, [k, valueNode]);
}
