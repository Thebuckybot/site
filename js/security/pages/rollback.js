import { api } from "../api.js";
import { el, pageHeader, table, badge, toast, errorState, confirmDialog, fmtTime } from "../ui.js";

export default {
  async render(root) {
    const rollback = async () => {
      if (!(await confirmDialog({ title: "Roll back from snapshot", message: "Recreate deleted channels and roles from the latest snapshot? This is a major action.", danger: true, confirmLabel: "Roll back" }))) return;
      try { await api.post("/recovery"); toast("Rollback queued - the bot will restore from the latest snapshot."); }
      catch (e) { toast(e.message, "err"); }
    };
    try {
      const [snaps, { can_edit: canEdit }] = await Promise.all([api.get("/snapshots"), api.me().catch(() => ({ can_edit: false }))]);
      root.appendChild(pageHeader("Rollback", "Restore the server's structure from a snapshot after an attack. Use this only after a nuke has been contained — it recreates what was deleted and never removes anything."));
      const actions = [el("a", { class: "sec-btn", href: "#snapshots", text: "View Snapshots" })];
      if (canEdit) actions.unshift(el("button", { class: "sec-btn sec-btn-primary", text: "Roll Back Now", onclick: rollback }));
      else actions.unshift(el("span", { class: "sec-muted", title: "Only the Server Owner or a Trusted Administrator can perform recovery.", text: "🔒 read-only" }));
      root.appendChild(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "Roll back from the latest snapshot" }),
        el("p", { class: "sec-muted", text: `${snaps.length} snapshot(s) available. Rollback recreates deleted channels and roles from the most recent capture.` }),
        el("div", { class: "sec-actions" }, actions),
      ]));
      root.appendChild(table([
        { label: "#", key: "id" },
        { label: "Reason", render: (s) => badge(s.reason, "muted") },
        { label: "Channels", key: "channel_count" },
        { label: "Roles", key: "role_count" },
        { label: "Captured", render: (s) => el("span", { text: fmtTime(s.created_at) }) },
      ], snaps));
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
