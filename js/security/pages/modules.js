import { api } from "../api.js";
import { el, pageHeader, table, toggle, badge, toast, errorState, debounce, info } from "../ui.js";
import { moduleDesc } from "../descriptions.js";

const READONLY_TIP = "Only the Server Owner or a Trusted Administrator can modify Security settings.";

export default {
  async render(root) {
    let modules = [], canEdit = false;
    const state = { q: "", cat: "all" };

    const draw = () => {
      const body = root.querySelector("#mod-body");
      if (!body) return;
      const rows = modules.filter((m) =>
        (state.cat === "all" || m.category === state.cat) &&
        (!state.q || m.label.toLowerCase().includes(state.q) || m.key.includes(state.q)));
      body.replaceChildren(table([
        { label: "Module", render: (m) => el("div", {}, [el("strong", { text: m.label }), info(moduleDesc(m.key)), el("div", { class: "sec-muted", text: m.key })]) },
        { label: "Category", render: (m) => badge(m.category || "-", "muted") },
        // SV2-MAN-002: honest states — an unavailable module (no runtime
        // implementation, e.g. Vanity URL Change) can never look functional.
        { label: "Status", render: (m) => m.status === "unavailable"
            ? badge("Not available", "bad")
            : badge(m.enabled ? "Enabled" : "Disabled", m.enabled ? "ok" : "muted") },
        { label: "Trigger", render: (m) => badge(m.status === "unavailable" ? "-" : (m.trigger || "threshold"), "muted") },
        { label: "", render: (m) => {
          if (m.status === "unavailable") {
            return el("span", { class: "sec-muted",
              title: "This module has no runtime implementation yet and cannot be enabled.",
              text: "unavailable" });
          }
          return canEdit ? toggle(m.enabled, async (val) => {
            try { await api.post("/modules", { key: m.key, enabled: val }); m.enabled = val; toast(`${m.label} ${val ? "enabled" : "disabled"}.`); }
            catch (e) { toast(e.message, "err"); draw(); }
          }) : el("span", { class: "sec-muted", title: READONLY_TIP, text: "🔒" });
        } },
      ], rows));
    };

    try {
      [modules, { can_edit: canEdit }] = await Promise.all([api.get("/modules"), api.me().catch(() => ({ can_edit: false }))]);
      root.appendChild(pageHeader("Modules", "Enable or disable each protection. Changes apply to the bot immediately."));
      const cats = ["all", ...new Set(modules.map((m) => m.category).filter(Boolean))];
      const search = el("input", { class: "sec-input", type: "search", placeholder: "Search modules…" });
      search.addEventListener("input", debounce(() => { state.q = search.value.toLowerCase(); draw(); }));
      const catSel = el("select", { class: "sec-select" }, cats.map((c) => el("option", { value: c, text: c })));
      catSel.addEventListener("change", () => { state.cat = catSel.value; draw(); });
      root.appendChild(el("div", { class: "sec-toolbar" }, [search, catSel,
        el("span", { class: "sec-muted", text: `${modules.length} modules` })]));
      root.appendChild(el("div", { id: "mod-body" }));
      draw();
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
