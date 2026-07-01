import { api } from "../api.js";
import { getRegistry } from "../registry.js";
import { el, pageHeader, table, badge, toast, errorState, formModal } from "../ui.js";

export default {
  async render(root) {
    let mode = "normal";
    let thresholds = [];
    let reg = { bounds: { limit: [1, 1000], window: [1, 86400] } };

    const load = async () => {
      [thresholds, reg] = await Promise.all([api.get("/thresholds"), getRegistry()]);
      draw();
    };

    const edit = async (t) => {
      const vals = await formModal({
        title: `Edit ${t.event_type} (${t.mode})`,
        fields: [
          { name: "limit_count", label: `Limit (${reg.bounds.limit[0]}-${reg.bounds.limit[1]})`, type: "number", value: t.limit_count },
          { name: "window_seconds", label: `Window seconds (${reg.bounds.window[0]}-${reg.bounds.window[1]})`, type: "number", value: t.window_seconds },
          { name: "burst_limit", label: "Burst limit (optional)", type: "number", value: t.burst_limit ?? "" },
          { name: "burst_window_seconds", label: "Burst window seconds (optional)", type: "number", value: t.burst_window_seconds ?? "" },
        ],
      });
      if (!vals) return;
      try {
        await api.post("/threshold", {
          event_type: t.event_type, scope: t.scope, mode: t.mode,
          limit_count: Number(vals.limit_count), window_seconds: Number(vals.window_seconds),
          burst_limit: vals.burst_limit === "" ? null : Number(vals.burst_limit),
          burst_window_seconds: vals.burst_window_seconds === "" ? null : Number(vals.burst_window_seconds),
        });
        toast("Threshold saved.");
        await load();
      } catch (e) { toast(e.message, "err"); }
    };

    const draw = () => {
      const body = root.querySelector("#thr-body");
      const rows = thresholds.filter((t) => t.mode === mode || t.mode === "both");
      body.replaceChildren(table([
        { label: "Event", key: "event_type" },
        { label: "Scope", render: (t) => badge(t.scope, "muted") },
        { label: "Limit / Window", render: (t) => el("span", { text: `${t.limit_count} / ${t.window_seconds}s` }) },
        { label: "Burst", render: (t) => el("span", { text: t.burst_limit ? `${t.burst_limit}/${t.burst_window_seconds}s` : "—" }) },
        { label: "Scaling", render: (t) => badge(t.dynamic_scale ? "by size" : "fixed", t.dynamic_scale ? "ok" : "muted") },
        { label: "", render: (t) => el("button", { class: "sec-btn sec-btn-sm", text: "Edit", onclick: () => edit(t) }) },
      ], rows));
    };

    try {
      root.appendChild(pageHeader("Thresholds", "Detection limits per event. The backend validates every value."));
      const modeSel = el("select", { class: "sec-select" }, [
        el("option", { value: "normal", text: "Normal mode" }),
        el("option", { value: "hard", text: "Hard mode" }),
      ]);
      modeSel.addEventListener("change", () => { mode = modeSel.value; draw(); });
      root.appendChild(el("div", { class: "sec-toolbar" }, [el("span", { class: "sec-muted", text: "Showing mode:" }), modeSel]));
      root.appendChild(el("div", { id: "thr-body" }));
      await load();
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
