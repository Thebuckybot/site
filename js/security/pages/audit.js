import { api } from "../api.js";
import { el, pageHeader, table, badge, pager, errorState, fmtTime, toast, debounce } from "../ui.js";

export default {
  async render(root) {
    let page = 0, filters = { action: "", module: "", target: "" }, items = [];

    const load = async () => {
      const qs = new URLSearchParams({ page, per_page: 20 });
      for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
      const data = await api.get(`/audit?${qs.toString()}`);
      items = data.items || [];
      draw();
    };

    const exportCsv = () => {
      const head = ["id", "action", "module_key", "actor_id", "target_id", "moderator_id", "result", "created_at"];
      const lines = [head.join(",")].concat(items.map((r) => head.map((h) => JSON.stringify(r[h] ?? "")).join(",")));
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const a = el("a", { href: URL.createObjectURL(blob), download: "security-audit.csv" });
      document.body.appendChild(a); a.click(); a.remove();
      toast("Exported current page.");
    };

    const draw = () => {
      root.querySelector("#aud-body").replaceChildren(
        table([
          { label: "Action", render: (a) => el("code", { text: a.action }) },
          { label: "Result", render: (a) => badge(a.result, a.result === "success" ? "ok" : a.result === "failed" ? "bad" : "muted") },
          { label: "Module", render: (a) => a.module_key || "-" },
          { label: "Target", render: (a) => el("code", { text: a.target_id || "-" }) },
          { label: "Source", render: (a) => badge(a.source || "-", "muted") },
          { label: "When", render: (a) => el("span", { text: fmtTime(a.created_at) }) },
        ], items),
        pager(page, items.length >= 20, (p) => { page = p; load(); }),
      );
    };

    try {
      root.appendChild(pageHeader("Audit Logs", "Every security action taken, automated or manual."));
      const actIn = el("input", { class: "sec-input", placeholder: "action…" });
      const modIn = el("input", { class: "sec-input", placeholder: "module…" });
      const tgtIn = el("input", { class: "sec-input", placeholder: "target id…" });
      const apply = debounce(() => { filters = { action: actIn.value.trim(), module: modIn.value.trim(), target: tgtIn.value.trim() }; page = 0; load(); });
      [actIn, modIn, tgtIn].forEach((i) => i.addEventListener("input", apply));
      root.appendChild(el("div", { class: "sec-toolbar" }, [actIn, modIn, tgtIn,
        el("span", { class: "sec-spacer" }),
        el("button", { class: "sec-btn sec-btn-sm", text: "Export CSV", onclick: exportCsv })]));
      root.appendChild(el("div", { id: "aud-body" }));
      await load();
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
