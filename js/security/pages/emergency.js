import { api } from "../api.js";
import { el, badge, pageHeader, toast, errorState, confirmDialog, info, infoTitle } from "../ui.js";
import { settingDesc } from "../descriptions.js";

// Emergency Center — every control is self-explanatory: a tooltip on each stat and
// button explains what it does, when to use it, and what happens internally.
export default {
  async render(root) {
    const load = async () => api.get("/emergency");

    const fire = async (action, label, danger, explain) => {
      if (!(await confirmDialog({ title: label, message: `${explain} Continue?`, danger, confirmLabel: label }))) return;
      try { await api.post("/emergency", { action }); toast(`Queued: ${label}.`); setTimeout(() => this.render(root), 1200); }
      catch (e) { toast(e.message, "err"); }
    };
    // SV2-MAN-006: Emergency NEVER fires a blind rollback. "Roll Back From Snapshot"
    // routes into the central Restore console (select snapshot -> mode -> Preview ->
    // confirm -> execute -> convergence), which enforces the full safety workflow —
    // including the strong destructive confirmation for Full Restore. No shortcut.
    const rollback = () => {
      toast("Opening the Restore console…");
      window.location.hash = "#rollback";
    };

    try {
      const [st, perms] = await Promise.all([load(), api.me().catch(() => ({ can_edit: false }))]);
      const canEdit = !!(perms && perms.can_edit);
      const stat = (label, on, onKind, offText, onText, desc) =>
        el("div", { class: "sec-card sec-stat" }, [
          el("span", { class: "label" }, [label + " ", info(desc)]),
          el("span", { class: "value" }, [badge(on ? onText : offText, on ? onKind : "muted")]),
        ]);

      const actions = el("div", { class: "sec-actions" });
      if (canEdit) {
        actions.append(
          btn(st.emergency_mode ? "Disable Emergency" : "Enable Emergency", "sec-btn-danger",
            settingDesc(st.emergency_mode ? "lift_lockdown" : "emergency_enable"),
            () => fire(st.emergency_mode ? "emergency_off" : "emergency_on",
              st.emergency_mode ? "Disable emergency mode" : "Enable emergency mode", true,
              settingDesc(st.emergency_mode ? "lift_lockdown" : "emergency_enable"))),
          btn(st.server_locked ? "Unlock Server" : "Lock Server", "sec-btn-danger",
            settingDesc(st.server_locked ? "lift_lockdown" : "server_lock"),
            () => fire(st.server_locked ? "unlock" : "lock",
              st.server_locked ? "Unlock the server" : "Lock the server", true,
              settingDesc(st.server_locked ? "lift_lockdown" : "server_lock"))),
          btn("Roll Back From Snapshot", "sec-btn", settingDesc("rollback_action"), rollback),
        );
      } else {
        actions.append(el("span", { class: "sec-muted", text: "Read-only - emergency controls require the owner or a whitelisted Security Admin." }));
      }

      root.replaceChildren(
        infoTitle("Emergency Center", "High-impact, reversible controls for an active incident. Every action is validated and executed by the bot.", "h1", "sec-page-title"),
        el("div", { class: "sec-grid sec-grid-3" }, [
          stat("Emergency Mode", st.emergency_mode, "bad", "Off", "ACTIVE", settingDesc("emergency_enable")),
          stat("Server Locked", st.server_locked, "bad", "Open", "LOCKED", settingDesc("server_lock")),
          stat("Raid Mode", st.raid_mode, "warn", "Off", "ON", "Automatically raised when a join-raid is detected; relaxes as the raid subsides."),
        ]),
        el("div", { class: "sec-card", style: "margin-top:16px" }, [
          el("div", { class: "sec-page-title", text: "Actions" }),
          actions,
          el("p", { class: "sec-muted", style: "margin-top:10px", text: "Queued actions execute within ~30s; refresh to see updated status. Everything here is reversible." }),
        ]),
        el("div", { class: "sec-card", style: "margin-top:16px" }, [
          el("div", { class: "sec-page-title", text: "When to use what" }),
          guide("Enable Emergency", settingDesc("emergency_enable")),
          guide("Lock Server", settingDesc("server_lock")),
          guide("Lift / Unlock", settingDesc("lift_lockdown")),
          guide("Roll Back From Snapshot", settingDesc("rollback_action")),
        ]),
      );
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};

function btn(label, cls, desc, onClick) {
  return el("span", { class: "sec-btn-wrap" }, [
    el("button", { class: `sec-btn ${cls}`, text: label, onclick: onClick }),
    info(desc),
  ]);
}
function guide(title, text) {
  return el("div", { class: "sec-settings-row" }, [
    el("div", { class: "k" }, [el("strong", { text: title })]),
    el("div", { class: "sec-muted", style: "flex:2", text }),
  ]);
}
