import { api } from "../api.js";
import { getRegistry } from "../registry.js";
import { el, pageHeader, table, badge, toast, errorState, formModal, confirmDialog } from "../ui.js";

export default {
  async render(root) {
    let entries = [], reg = { modules: [], ignore_target_types: [] };
    let module = "anti_links";

    const load = async () => {
      [entries, reg] = await Promise.all([api.get("/ignore"), getRegistry()]);
      if (reg.modules.length && !reg.modules.find((m) => m.key === module)) module = reg.modules[0].key;
      draw();
    };

    const add = async () => {
      const vals = await formModal({
        title: `Add ignore for ${module}`,
        fields: [
          { name: "target_type", label: "Target type", type: "select",
            options: reg.ignore_target_types.map((t) => ({ value: t, label: t })) },
          { name: "ref_id", label: "Target ID", placeholder: "channel / role / user ID" },
        ],
      });
      if (!vals || !vals.ref_id) return;
      try { await api.post("/ignore", { module_key: module, target_type: vals.target_type, ref_id: vals.ref_id }); toast("Added."); await load(); }
      catch (e) { toast(e.message, "err"); }
    };
    const remove = async (ig) => {
      if (!(await confirmDialog({ title: "Remove ignore", message: "Remove this ignore entry?", danger: true, confirmLabel: "Remove" }))) return;
      try { await api.del(`/ignore/${ig.id}`); toast("Removed."); await load(); }
      catch (e) { toast(e.message, "err"); }
    };

    const draw = () => {
      const body = root.querySelector("#ig-body");
      const rows = entries.filter((e) => e.module_key === module);
      body.replaceChildren(table([
        { label: "Type", render: (e) => badge(e.target_type, "muted") },
        { label: "Target", render: (e) => el("code", { text: e.ref_id }) },
        { label: "", render: (e) => el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "Remove", onclick: () => remove(e) }) },
      ], rows));
    };

    try {
      root.appendChild(pageHeader("Ignore Rules", "Exempt specific places or people from a protection. Categories cover channels; channels cover their threads."));
      const sel = el("select", { class: "sec-select" });
      const onload = async () => {
        const r = await getRegistry();
        sel.replaceChildren(...r.modules.map((m) => el("option", { value: m.key, text: m.label })));
        sel.value = module;
      };
      sel.addEventListener("change", () => { module = sel.value; draw(); });
      root.appendChild(el("div", { class: "sec-toolbar" }, [
        el("span", { class: "sec-muted", text: "Module:" }), sel,
        el("button", { class: "sec-btn sec-btn-primary sec-btn-sm", text: "+ Add Ignore", onclick: add }),
      ]));
      root.appendChild(el("div", { id: "ig-body" }));
      await load();
      await onload();
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
