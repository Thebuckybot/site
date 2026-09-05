import { soc, api } from "../api.js";
import { el, pageHeader, table, badge, toggle, toast, errorState, confirmDialog, emptyCard, alertBox } from "../ui.js";
const READONLY_TIP = "Only the Server Owner or a Trusted Administrator can modify Security settings.";

// SOC rules ARE user-created (unlike the predefined module chains). This page
// shows current usage vs the plan limit (from the centralized PlanLimits service)
// and gates creation when the limit is reached.
export default {
  async render(root) {
    let rules = [], usage = null, canEdit = false;
    const load = async () => {
      const [r, u, me] = await Promise.all([soc.get("/rules"), soc.get("/rules/usage").catch(() => null), api.me().catch(() => ({ can_edit: false }))]);
      rules = Array.isArray(r) ? r : (r && r.rules) || [];
      usage = u; canEdit = !!(me && me.can_edit);
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
      // Two states, no tier ladder: the cap is this server's own number, and
      // the only way up is a Security Boost. A boosted server at its cap just
      // hears that it is at its cap.
      const line = usage.boosted
        ? `This server is using all ${usage.limit} of its rules. Disable or delete one to add another.`
        : `You are using all ${usage.limit} rules this server may hold. A Security Boost raises the cap.`;
      return alertBox({ kind: "premium", title: "Maximum rules reached", icon: el("span", { text: "★" }), message: el("div", {}, [
        el("p", { class: "sec-muted", style: "margin:0 0 8px", text: line }),
      ]) });
    };

    const draw = () => {
      const canCreate = canEdit && (!usage || (!usage.at_limit));
      const head = root.querySelector("#soc-rules-head");
      const headKids = [usageBadge()];
      if (!canEdit) headKids.push(el("span", { class: "sec-muted", title: READONLY_TIP, text: "🔒 read-only" }));
      else if (canCreate) headKids.push(el("a", { class: "sec-btn sec-btn-primary", href: "#rulebuilder", text: "Open Rule Builder" }));
      else headKids.push(el("button", { class: "sec-btn", disabled: true, text: "Rule limit reached" }));
      head.replaceChildren(el("div", { class: "sec-actions", style: "align-items:center;gap:12px" }, headKids));
      // The tour reads these BEFORE it offers to create a rule: no rights or a
      // full limit means it says so and skips, instead of failing in the form.
      head.dataset.canEdit = canEdit ? "1" : "0";
      head.dataset.atLimit = usage && usage.at_limit ? "1" : "0";
      head.dataset.canCreate = canCreate ? "1" : "0";
      const body = root.querySelector("#soc-rules");
      const pc = premiumCard();
      if (!rules.length) {
        body.replaceChildren(pc || emptyCard({
          title: "No detection rules yet",
          message: "SOC rules are custom automations you build in the Rule Builder - WHEN an event fires, IF conditions match, THEN run actions. They complement the built-in modules.",
          actionLabel: canCreate ? "Open Rule Builder" : null, onAction: () => { window.location.hash = "#rulebuilder"; },
        }));
        return;
      }
      const tbl = table([
        { label: "Name", key: "name" },
        { label: "Event", render: (r) => r.event_type || "-" },
        { label: "Severity", render: (r) => badge("sev " + (r.severity ?? "?"), "muted") },
        { label: "Enabled", render: (r) => canEdit ? toggle(!!r.enabled, async (v) => {
          try { await soc.patch(`/rules/${r.id}/toggle`); r.enabled = v; toast("Rule updated."); }
          catch (e) { toast(e.message, "err"); draw(); }
        }) : badge(r.enabled ? "On" : "Off", r.enabled ? "ok" : "muted") },
        { label: "", render: (r) => canEdit ? el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "Delete", onclick: () => del(r) }) : el("span", { class: "sec-muted", text: "-" }) },
      ], rules, (r) => ({ "data-rule-id": String(r.id) }));
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
