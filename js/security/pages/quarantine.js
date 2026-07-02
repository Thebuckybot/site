import { api } from "../api.js";
import { el, pageHeader, table, badge, pager, toast, errorState, confirmDialog, fmtTime, debounce, info, infoTitle, formModal } from "../ui.js";
import { settingDesc } from "../descriptions.js";

export default {
  async render(root) {
    let page = 0, status = "active", q = "", data = { items: [], total: 0, per_page: 10 };
    let settings = {}, canEdit = false;

    try {
      [settings, { can_edit: canEdit }] = await Promise.all([
        api.get("/settings"), api.me().catch(() => ({ can_edit: false })),
      ]);
    } catch (err) { return errorState(root, err, () => this.render(root)); }

    const load = async () => {
      data = await api.get(`/quarantine?status=${status}&page=${page}&per_page=10`);
      draw();
    };

    const act = async (rec, action) => {
      const danger = action !== "release";
      if (!(await confirmDialog({
        title: `${action[0].toUpperCase() + action.slice(1)} member`,
        message: `${action} <@${rec.user_id}>? This is sent to the bot to perform.`,
        danger, confirmLabel: action,
      }))) return;
      try { await api.post(`/quarantine/${rec.id}`, { action }); toast(`Queued ${action} - the bot will execute shortly.`); setTimeout(load, 1200); }
      catch (e) { toast(e.message, "err"); }
    };

    // ---- configuration card -------------------------------------------- #
    const setRole = async () => {
      const vals = await formModal({ title: "Set quarantine role", fields: [{ name: "id", label: "Role ID", placeholder: "Right-click role → Copy ID" }], submitLabel: "Save" });
      if (!vals || !vals.id) return;
      try { await api.post("/settings/channels", { quarantine_role_id: vals.id.trim() }); toast("Quarantine role set."); this.render(clear(root)); }
      catch (e) { toast(e.message, "err"); }
    };
    const repair = async () => {
      if (!(await confirmDialog({ title: "Create / repair quarantine role", message: settingDesc("quarantine_repair") + " Continue?", confirmLabel: "Repair" }))) return;
      try { await api.post("/repair"); toast("Repair queued — the bot will create/fix the quarantine role shortly."); }
      catch (e) { toast(e.message, "err"); }
    };
    const clearRole = async () => {
      try { await api.post("/settings/channels", { quarantine_role_id: "" }); toast("Quarantine role cleared."); this.render(clear(root)); }
      catch (e) { toast(e.message, "err"); }
    };

    const configCard = () => {
      const rid = settings.quarantine_role_id;
      const statusRow = el("div", { class: "sec-settings-row" }, [
        el("div", { class: "k" }, ["Status ", info(settingDesc("quarantine_role"))]),
        rid ? badge(`Configured — role ${rid}`, "ok") : badge("Not configured", "warn"),
      ]);
      const permRow = el("div", { class: "sec-settings-row" }, [
        el("div", { class: "k" }, ["Permissions preview ", info(settingDesc("quarantine_perms"))]),
        el("div", { class: "sec-muted", style: "flex:2", text: settingDesc("quarantine_perms") }),
      ]);
      const controls = el("div", { class: "sec-actions", style: "margin-top:8px" });
      if (canEdit) {
        controls.append(
          el("button", { class: "sec-btn sec-btn-primary sec-btn-sm", text: rid ? "Change Role" : "Select Role", onclick: setRole }),
          el("button", { class: "sec-btn sec-btn-sm", text: rid ? "Repair Role" : "Create Role", onclick: repair }),
        );
        if (rid) controls.append(el("button", { class: "sec-btn sec-btn-ghost sec-btn-sm", text: "Clear", onclick: clearRole }));
      }
      const validation = rid ? null : el("p", { class: "sec-muted", text: "No quarantine role yet. Quarantine will auto-create one on first use, or press Create Role now so it's ready and locked down." });
      return el("div", { class: "sec-card" }, [
        infoTitle("Quarantine Role", "The locked role applied to caught members while their real roles are safely vaulted.", "div", "sec-page-title"),
        statusRow, permRow, controls, validation,
      ]);
    };

    const draw = () => {
      const body = root.querySelector("#q-body");
      const rows = (data.items || []).filter((r) => !q || String(r.user_id).includes(q) || (r.reason || "").toLowerCase().includes(q));
      body.replaceChildren(
        table([
          { label: "User", render: (r) => el("code", { text: r.user_id }) },
          { label: "Reason", render: (r) => el("span", { class: "sec-muted", text: r.reason || "—" }) },
          { label: "Status", render: (r) => badge(r.status, r.status === "active" ? "warn" : "muted") },
          { label: "Since", render: (r) => el("span", { text: fmtTime(r.quarantined_at) }) },
          { label: "Expires", render: (r) => el("span", { text: r.expires_at ? fmtTime(r.expires_at) : "never" }) },
          { label: "Actions", render: (r) => el("div", { class: "sec-row" }, r.status === "active" && canEdit ? [
            el("button", { class: "sec-btn sec-btn-sm", text: "Release", onclick: () => act(r, "release") }),
            el("button", { class: "sec-btn sec-btn-sm", text: "Kick", onclick: () => act(r, "kick") }),
            el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "Ban", onclick: () => act(r, "ban") }),
          ] : [el("span", { class: "sec-muted", text: "—" })]) },
        ], rows),
        pager(page, (page + 1) * (data.per_page || 10) < (data.total || 0), (p) => { page = p; load(); }),
      );
    };

    try {
      root.appendChild(pageHeader("Quarantine", "Configure the quarantine role and manage quarantined members. Actions are validated and executed by the bot."));
      root.appendChild(configCard());
      root.appendChild(el("div", { class: "sec-page-title", style: "margin-top:18px", text: "Quarantined members" }));
      const search = el("input", { class: "sec-input", type: "search", placeholder: "Search user / reason…" });
      search.addEventListener("input", debounce(() => { q = search.value.toLowerCase(); draw(); }));
      const statusSel = el("select", { class: "sec-select" }, [
        el("option", { value: "active", text: "Active" }),
        el("option", { value: "released", text: "Released" }),
        el("option", { value: "banned", text: "Banned" }),
      ]);
      statusSel.addEventListener("change", () => { status = statusSel.value; page = 0; load(); });
      root.appendChild(el("div", { class: "sec-toolbar" }, [search, statusSel]));
      root.appendChild(el("div", { id: "q-body" }));
      await load();
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};

function clear(root) { while (root.firstChild) root.removeChild(root.firstChild); return root; }
