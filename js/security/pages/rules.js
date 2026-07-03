import { soc } from "../api.js";
import { el, pageHeader, table, badge, toggle, toast, errorState, confirmDialog, emptyCard } from "../ui.js";

// SOC rules ARE user-created (unlike the predefined module chains). This page
// shows current usage vs the plan limit (from the centralized PlanLimits service)
// and gates creation when the limit is reached.
export default {
  async render(root) {
    let rules = [], usage = null;
    const load = async () => {
      const [r, u] = await Promise.all([soc.get("/rules"), soc.get("/rules/usage").catch(() => null)]);
      rules = Array.isArray(r) ? r : (r && r.rules) || [];
      usage = u;
      draw();
    };
    const del = async (r) => {
      if (!(await confirmDialog({ title: "Delete rule", message: `Delete rule "${r.name}"?`, danger: true, confirmLabel: "Delete" }))) return;
      try { await soc.del(`/rules/${r.id}`); toast("Rule deleted."); await load(); }
      catch (e) { toast(e.message, "err"); }
    };

    const usageBadge = () => {
      if (!usage) return el("span", {});
      if (usage.unlimited) return badge(`${usage.used} rules · Unlimited`, "ok");
      const kind = usage.at_limit ? "bad" : (usage.used / usage.limit >= 0.8 ? "warn" : "ok");
      return badge(`${usage.used} / ${usage.limit} rules used`, kind);
    };

    const premiumCard = () => {
      if (!usage || !usage.at_limit) return null;
      const ladder = (usage.premium || []).map((p) =>
        el("li", { text: `${p.tier.replace("_", " ")}: ${p.soc_rules == null ? "Unlimited" : p.soc_rules + " rules"}` }));
      return el("div", { class: "sec-card sec-premium-card" }, [
        el("div", { class: "sec-empty-title", text: "Maximum rules reached" }),
        el("p", { class: "sec-muted", text: `You are using all ${usage.limit} rules on the Free plan. Upgrade to Bucky Premium to unlock more:` }),
        el("ul", { class: "sec-premium-list" }, ladder),
        el("span", { class: "sec-badge muted", text: "Premium — coming soon" }),
      ]);
    };

    const draw = () => {
      const canCreate = !usage || (!usage.at_limit);
      const head = root.querySelector("#soc-rules-head");
      head.replaceChildren(
        el("div", { class: "sec-actions", style: "align-items:center;gap:12px" }, [
          usageBadge(),
          canCreate
            ? el("a", { class: "sec-btn sec-btn-primary", href: "#rulebuilder", text: "Open Rule Builder" })
            : el("button", { class: "sec-btn", disabled: true, text: "Rule limit reached" }),
        ]),
      );
      const body = root.querySelector("#soc-rules");
      const pc = premiumCard();
      if (!rules.length) {
        body.replaceChildren(pc || emptyCard({
          title: "No detection rules yet",
          message: "SOC rules are custom automations you build in the Rule Builder — WHEN an event fires, IF conditions match, THEN run actions. They complement the built-in modules.",
          actionLabel: canCreate ? "Open Rule Builder" : null, onAction: () => { window.location.hash = "#rulebuilder"; },
        }));
        return;
      }
      const tbl = table([
        { label: "Name", key: "name" },
        { label: "Event", render: (r) => r.event_type || "—" },
        { label: "Severity", render: (r) => badge("sev " + (r.severity ?? "?"), "muted") },
        { label: "Enabled", render: (r) => toggle(!!r.enabled, async (v) => {
          try { await soc.patch(`/rules/${r.id}/toggle`); r.enabled = v; toast("Rule updated."); }
          catch (e) { toast(e.message, "err"); draw(); }
        }) },
        { label: "", render: (r) => el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "Delete", onclick: () => del(r) }) },
      ], rules);
      body.replaceChildren(...(pc ? [pc, tbl] : [tbl]));
    };

    try {
      root.appendChild(pageHeader("Detection Rules", "Custom SOC rules you create in the Rule Builder. Usage and limits come from your plan."));
      root.appendChild(el("div", { id: "soc-rules-head" }));
      root.appendChild(el("div", { id: "soc-rules" }));
      await load();
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
