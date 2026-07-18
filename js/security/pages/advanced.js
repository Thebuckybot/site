import { api } from "../api.js";
import { el, badge, pageHeader, toast, errorState, formModal, confirmDialog } from "../ui.js";

export default {
  async render(root) {
    const load = async () => api.get("/export");

    const switchMode = async (cfg) => {
      const next = cfg.mode === "hard" ? "normal" : "hard";
      if (!(await confirmDialog({ title: "Switch mode", message: `Switch detection mode to ${next.toUpperCase()}?`, confirmLabel: "Switch" }))) return;
      try { await api.post("/protection", { mode: next }); toast(`Mode set to ${next}.`); this.render(root); }
      catch (e) { toast(e.message, "err"); }
    };
    const exportCfg = (cfg) => {
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
      const a = el("a", { href: URL.createObjectURL(blob), download: "security-config.json" });
      document.body.appendChild(a); a.click(); a.remove();
      toast("Configuration exported.");
    };
    const importCfg = async () => {
      const vals = await formModal({ title: "Import configuration", fields: [{ name: "json", label: "Paste configuration JSON", type: "textarea", rows: 10 }], submitLabel: "Import" });
      if (!vals) return;
      let parsed;
      try { parsed = JSON.parse(vals.json); } catch (e) { toast("Invalid JSON.", "err"); return; }
      try { await api.post("/import", parsed); toast("Imported and validated by the backend."); this.render(root); }
      catch (e) { toast(e.message, "err"); }
    };

    try {
      // SV2-READONLY-001: switch-mode and import are WRITES — render them only for
      // editors. Export (a read) stays available to everyone.
      const [cfg, perms] = await Promise.all([load(), api.me().catch(() => ({ can_edit: false }))]);
      const canEdit = !!perms.can_edit;
      const actions = [];
      if (canEdit) actions.push(el("button", { class: "sec-btn", "data-write": "1", text: "Switch Normal/Hard", onclick: () => switchMode(cfg) }));
      actions.push(el("button", { class: "sec-btn", text: "Export JSON", onclick: () => exportCfg(cfg) }));
      if (canEdit) actions.push(el("button", { class: "sec-btn sec-btn-primary", "data-write": "1", text: "Import JSON", onclick: importCfg }));
      root.replaceChildren(
        pageHeader("Advanced", "Mode, configuration export/import, and raw settings."),
        el("div", { class: "sec-grid sec-grid-3" }, [
          el("div", { class: "sec-card sec-stat" }, [el("span", { class: "label", text: "Mode" }), el("span", { class: "value" }, [badge(String(cfg.mode).toUpperCase(), cfg.mode === "hard" ? "warn" : "ok")])]),
          el("div", { class: "sec-card sec-stat" }, [el("span", { class: "label", text: "Admin Immunity" }), el("span", { class: "value", text: cfg.admin_immunity ? "On" : "Off" })]),
          el("div", { class: "sec-card sec-stat" }, [el("span", { class: "label", text: "Owner-only Immunity" }), el("span", { class: "value", text: cfg.owner_only_immunity ? "On" : "Off" })]),
        ]),
        el("div", { class: "sec-card", style: "margin-top:16px" }, [
          el("div", { class: "sec-page-title", text: "Configuration" }),
          el("div", { class: "sec-actions" }, actions),
          el("p", { class: "sec-muted", text: canEdit
            ? "Imports are validated server-side; malformed configurations are rejected."
            : "Read-only access — export is available; switching mode and importing are disabled." }),
        ]),
      );
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
