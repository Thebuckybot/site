import { api } from "../api.js";
import { el, pageHeader, table, badge, pager, errorState, fmtTime, debounce } from "../ui.js";

const SEV = { 5: "bad", 4: "bad", 3: "warn", 2: "muted", 1: "muted" };

export default {
  async render(root) {
    let page = 0, filters = { module: "", actor: "", severity: "" }, items = [];

    const load = async () => {
      const qs = new URLSearchParams({ page, per_page: 15 });
      for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
      const data = await api.get(`/incidents?${qs.toString()}`);
      items = data.items || [];
      draw(data);
    };

    const draw = (data) => {
      root.querySelector("#inc-body").replaceChildren(
        table([
          { label: "#", key: "id" },
          { label: "Module", render: (i) => i.module_key || i.event_type },
          { label: "Severity", render: (i) => badge("sev " + i.severity, SEV[i.severity] || "muted") },
          { label: "Executor", render: (i) => el("code", { text: i.actor_id || "?" }) },
          { label: "Confidence", render: (i) => badge(i.attribution_confidence || "—", i.attribution_confidence === "confirmed" ? "ok" : "muted") },
          { label: "Reason", render: (i) => el("span", { class: "sec-muted", text: (i.details && i.details.reason) || "—" }) },
          { label: "When", render: (i) => el("span", { text: fmtTime(i.created_at) }) },
        ], items),
        pager(page, items.length >= 15, (p) => { page = p; load(); }),
      );
    };

    try {
      root.appendChild(pageHeader("Incidents", "Every detection, newest first. Filter and page server-side."));
      const modIn = el("input", { class: "sec-input", placeholder: "module key…" });
      const actIn = el("input", { class: "sec-input", placeholder: "executor id…" });
      const sevSel = el("select", { class: "sec-select" }, [el("option", { value: "", text: "Any severity" }), 1, 2, 3, 4, 5].map((s) => typeof s === "string" ? s : el("option", { value: s, text: "sev " + s })));
      const apply = debounce(() => { filters = { module: modIn.value.trim(), actor: actIn.value.trim(), severity: sevSel.value }; page = 0; load(); });
      modIn.addEventListener("input", apply); actIn.addEventListener("input", apply); sevSel.addEventListener("change", apply);
      root.appendChild(el("div", { class: "sec-toolbar" }, [modIn, actIn, sevSel]));
      root.appendChild(el("div", { id: "inc-body" }));
      await load();
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
