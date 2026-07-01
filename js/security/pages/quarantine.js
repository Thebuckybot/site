import { api } from "../api.js";
import { el, pageHeader, table, badge, pager, toast, errorState, confirmDialog, fmtTime, debounce } from "../ui.js";

export default {
  async render(root) {
    let page = 0, status = "active", q = "", data = { items: [], total: 0, per_page: 10 };

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
          { label: "Actions", render: (r) => el("div", { class: "sec-row" }, r.status === "active" ? [
            el("button", { class: "sec-btn sec-btn-sm", text: "Release", onclick: () => act(r, "release") }),
            el("button", { class: "sec-btn sec-btn-sm", text: "Kick", onclick: () => act(r, "kick") }),
            el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "Ban", onclick: () => act(r, "ban") }),
          ] : [el("span", { class: "sec-muted", text: "—" })]) },
        ], rows),
        pager(page, (page + 1) * (data.per_page || 10) < (data.total || 0), (p) => { page = p; load(); }),
      );
    };

    try {
      root.appendChild(pageHeader("Quarantine", "Manage quarantined members. Actions are validated and executed by the bot."));
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
