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

    // SV2-MAN-003: anti_bots incidents carry two entities + an attribution status
    // in details.evidence. Render them explicitly so it is impossible to confuse
    // the added bot with the responsible member.
    const ATTR_TONE = { resolved: "ok", ambiguous: "warn", unresolved: "muted", unavailable: "bad" };
    const isAntiBot = (i) => i.module_key === "anti_bots";
    const ev = (i) => (i.details && i.details.evidence) || {};

    const executorCell = (i) => {
      if (!isAntiBot(i)) return el("code", { text: i.actor_id || "?" });
      const e = ev(i);
      const bot = e.added_bot_id || "?";
      const actor = e.responsible_actor_id;
      return el("div", {}, [
        el("div", {}, [el("span", { class: "sec-muted", text: "Added bot: " }), el("code", { text: String(bot) })]),
        el("div", {}, [el("span", { class: "sec-muted", text: "Responsible member: " }),
          actor ? el("code", { text: String(actor) }) : el("em", { class: "sec-muted", text: "unresolved" })]),
      ]);
    };
    const confidenceCell = (i) => {
      if (isAntiBot(i)) {
        const st = ev(i).attribution_status || "unresolved";
        return badge("attr: " + st, ATTR_TONE[st] || "muted");
      }
      return badge(i.attribution_confidence || "—", i.attribution_confidence === "confirmed" ? "ok" : "muted");
    };

    const draw = (data) => {
      root.querySelector("#inc-body").replaceChildren(
        table([
          { label: "#", key: "id" },
          { label: "Module", render: (i) => i.module_key || i.event_type },
          { label: "Severity", render: (i) => badge("sev " + i.severity, SEV[i.severity] || "muted") },
          { label: "Executor / Entities", render: executorCell },
          { label: "Confidence", render: confidenceCell },
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
