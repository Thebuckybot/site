import { api } from "../api.js";
import { el, pageHeader, table, badge, toast, errorState, formModal } from "../ui.js";

export default {
  async render(root) {
    let chains = [];
    const load = async () => { chains = await api.get("/punishments"); draw(); };

    const editChain = async (c) => {
      const vals = await formModal({
        title: `Edit chain: ${c.trigger_key} (${c.mode})`,
        fields: [
          { name: "name", label: "Name", value: c.name },
          { name: "stages", label: "Stages (JSON array)", type: "textarea", rows: 8,
            value: JSON.stringify(c.stages, null, 2) },
        ],
      });
      if (!vals) return;
      let stages;
      try { stages = JSON.parse(vals.stages); }
      catch (e) { toast("Stages must be valid JSON.", "err"); return; }
      try {
        await api.post("/punishment", { trigger_key: c.trigger_key, mode: c.mode, name: vals.name, stages });
        toast("Chain saved.");
        await load();
      } catch (e) { toast(e.message, "err"); }
    };

    const draw = () => {
      root.querySelector("#pun-body").replaceChildren(table([
        { label: "Trigger", key: "trigger_key" },
        { label: "Mode", render: (c) => badge(c.mode, "muted") },
        { label: "Name", key: "name" },
        { label: "Chain", render: (c) => el("span", { class: "sec-muted", text: c.stages.map((s) => s.type).join(" → ") }) },
        { label: "System", render: (c) => badge(c.is_system ? "template" : "custom", c.is_system ? "ok" : "muted") },
        { label: "", render: (c) => el("button", { class: "sec-btn sec-btn-sm", text: "Edit", onclick: () => editChain(c) }) },
      ], chains));
    };

    try {
      root.appendChild(pageHeader("Punishments", "Ordered action chains run when a module triggers. The backend validates every stage."));
      root.appendChild(el("div", { id: "pun-body" }));
      await load();
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
