import { soc } from "../api.js";
import { el, pageHeader, table, badge, toggle, toast, errorState, confirmDialog } from "../ui.js";

export default {
  async render(root) {
    let rules = [];
    const load = async () => {
      const r = await soc.get("/rules");
      rules = Array.isArray(r) ? r : (r && r.rules) || [];
      draw();
    };
    const del = async (r) => {
      if (!(await confirmDialog({ title: "Delete rule", message: `Delete rule "${r.name}"?`, danger: true, confirmLabel: "Delete" }))) return;
      try { await soc.del(`/rules/${r.id}`); toast("Rule deleted."); await load(); }
      catch (e) { toast(e.message, "err"); }
    };
    const draw = () => {
      root.querySelector("#soc-rules").replaceChildren(table([
        { label: "Name", key: "name" },
        { label: "Event", render: (r) => r.event_type || "—" },
        { label: "Severity", render: (r) => badge("sev " + (r.severity ?? "?"), "muted") },
        { label: "Enabled", render: (r) => toggle(!!r.enabled, async (v) => {
          try { await soc.patch(`/rules/${r.id}/toggle`); r.enabled = v; toast("Rule updated."); }
          catch (e) { toast(e.message, "err"); draw(); }
        }) },
        { label: "", render: (r) => el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "Delete", onclick: () => del(r) }) },
      ], rules));
    };
    try {
      root.appendChild(pageHeader("Detection Rules", "Custom SOC rules. Create new rules in the advanced Rule Builder."));
      root.appendChild(el("div", { class: "sec-actions" }, [
        el("a", { class: "sec-btn sec-btn-primary", href: "#rulebuilder", text: "Open Rule Builder" }),
      ]));
      root.appendChild(el("div", { id: "soc-rules" }));
      await load();
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
