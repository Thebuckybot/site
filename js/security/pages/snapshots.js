import { api } from "../api.js";
import { el, pageHeader, table, badge, toast, errorState, confirmDialog, fmtTime } from "../ui.js";

export default {
  async render(root) {
    const rollback = async () => {
      if (!(await confirmDialog({ title: "Roll back from latest snapshot", message: "Recreate deleted channels/roles from the most recent snapshot? Major action.", danger: true, confirmLabel: "Roll back" }))) return;
      try { await api.post("/recovery"); toast("Rollback queued - the bot will restore from the latest snapshot."); }
      catch (e) { toast(e.message, "err"); }
    };

    try {
      const snaps = await api.get("/snapshots");
      root.appendChild(pageHeader("Snapshots & Recovery", "Structure snapshots used for nuke rollback. Captured automatically by the bot."));
      root.appendChild(el("div", { class: "sec-actions" }, [
        el("button", { class: "sec-btn sec-btn-primary", text: "Roll Back From Latest", onclick: rollback }),
      ]));
      root.appendChild(table([
        { label: "#", key: "id" },
        { label: "Reason", render: (s) => badge(s.reason, "muted") },
        { label: "Channels", key: "channel_count" },
        { label: "Roles", key: "role_count" },
        { label: "Captured", render: (s) => el("span", { text: fmtTime(s.created_at) }) },
      ], snaps));
      if (!snaps.length) root.appendChild(el("p", { class: "sec-muted", text: "No snapshots yet - the bot captures them on join, on a schedule, and before destructive responses." }));
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
