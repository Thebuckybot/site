import { api } from "../api.js";
import { el, badge, pageHeader, toast, errorState, confirmDialog } from "../ui.js";

export default {
  async render(root) {
    const load = async () => api.get("/emergency");

    const fire = async (action, label, danger) => {
      if (!(await confirmDialog({ title: label, message: `${label}? This is sent to the bot to execute.`, danger, confirmLabel: label }))) return;
      try { await api.post("/emergency", { action }); toast(`Queued: ${label}.`); setTimeout(() => this.render(root), 1200); }
      catch (e) { toast(e.message, "err"); }
    };
    const rollback = async () => {
      if (!(await confirmDialog({ title: "Roll back from snapshot", message: "Recreate channels/roles from the latest snapshot? This is a major action.", danger: true, confirmLabel: "Roll back" }))) return;
      try { await api.post("/recovery"); toast("Rollback queued."); }
      catch (e) { toast(e.message, "err"); }
    };

    try {
      const st = await load();
      const container = root;
      container.replaceChildren(
        pageHeader("Emergency Center", "High-impact controls. Every action is validated and executed by the bot."),
        el("div", { class: "sec-grid sec-grid-3" }, [
          el("div", { class: "sec-card sec-stat" }, [el("span", { class: "label", text: "Emergency Mode" }), el("span", { class: "value" }, [badge(st.emergency_mode ? "ACTIVE" : "Off", st.emergency_mode ? "bad" : "muted")])]),
          el("div", { class: "sec-card sec-stat" }, [el("span", { class: "label", text: "Server Locked" }), el("span", { class: "value" }, [badge(st.server_locked ? "LOCKED" : "Open", st.server_locked ? "bad" : "ok")])]),
          el("div", { class: "sec-card sec-stat" }, [el("span", { class: "label", text: "Raid Mode" }), el("span", { class: "value" }, [badge(st.raid_mode ? "ON" : "Off", st.raid_mode ? "warn" : "muted")])]),
        ]),
        el("div", { class: "sec-card", style: "margin-top:16px" }, [
          el("div", { class: "sec-page-title", text: "Actions" }),
          el("div", { class: "sec-actions" }, [
            el("button", { class: "sec-btn sec-btn-danger", text: st.emergency_mode ? "Disable Emergency" : "Enable Emergency", onclick: () => fire(st.emergency_mode ? "emergency_off" : "emergency_on", st.emergency_mode ? "Disable emergency mode" : "Enable emergency mode", true) }),
            el("button", { class: "sec-btn sec-btn-danger", text: st.server_locked ? "Unlock Server" : "Lock Server", onclick: () => fire(st.server_locked ? "unlock" : "lock", st.server_locked ? "Unlock the server" : "Lock the server", true) }),
            el("button", { class: "sec-btn", text: "Roll Back From Snapshot", onclick: rollback }),
          ]),
          el("p", { class: "sec-muted", text: "Queued actions execute within ~30s; refresh to see updated status." }),
        ]),
      );
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
