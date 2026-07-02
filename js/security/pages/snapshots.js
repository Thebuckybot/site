import { api } from "../api.js";
import { el, table, badge, toast, errorState, confirmDialog, fmtTime, infoTitle, emptyCard } from "../ui.js";
import { settingDesc } from "../descriptions.js";

export default {
  async render(root) {
    const [snaps, perms] = await Promise.all([
      api.get("/snapshots").catch((e) => { throw e; }),
      api.me().catch(() => ({ can_edit: false })),
    ]).catch((err) => { errorState(root, err, () => this.render(root)); return [null, null]; });
    if (snaps === null) return;
    const canEdit = !!(perms && perms.can_edit);

    const rollback = async () => {
      if (!(await confirmDialog({ title: "Roll back from latest snapshot", message: "Recreate deleted channels and roles from the most recent snapshot? Recovery only re-creates what is missing — it never deletes your work.", danger: true, confirmLabel: "Roll back" }))) return;
      try { await api.post("/recovery"); toast("Rollback queued — the bot will restore from the latest snapshot."); }
      catch (e) { toast(e.message, "err"); }
    };

    root.appendChild(infoTitle("Snapshots & Recovery", settingDesc("recovery"), "h1", "sec-page-title"));
    root.appendChild(el("p", { class: "sec-page-sub", text: "Structure snapshots used for nuke rollback. Captured automatically by the bot." }));

    if (!snaps.length) {
      // Informative empty state instead of a bare "None".
      root.appendChild(emptyCard({
        title: "No recovery points available yet",
        message: "The bot captures a snapshot when it joins, on a schedule, and just before any destructive response. As soon as one exists you'll be able to roll back deleted channels and roles from here.",
      }));
      return;
    }

    if (canEdit) {
      root.appendChild(el("div", { class: "sec-actions" }, [
        el("button", { class: "sec-btn sec-btn-primary", text: "Roll Back From Latest", onclick: rollback }),
      ]));
    }
    root.appendChild(table([
      { label: "#", key: "id" },
      { label: "Reason", render: (s) => badge(s.reason, "muted") },
      { label: "Channels", key: "channel_count" },
      { label: "Roles", key: "role_count" },
      { label: "Captured", render: (s) => el("span", { text: fmtTime(s.created_at) }) },
    ], snaps));
  },
};
