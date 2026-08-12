import { soc } from "../api.js";
import { el, pageHeader, table, badge, errorState, fmtTime } from "../ui.js";

export default {
  async render(root) {
    // Refresh re-invokes render(); clear first so it never stacks a duplicate (FIN-002 M1).
    root.replaceChildren();
    try {
      const data = await soc.get("/incidents?page=1").catch(() => []);
      const list = Array.isArray(data) ? data : (data && data.incidents) || [];
      root.appendChild(pageHeader("Live Events", "The most recent detections processed by SOC."));
      root.appendChild(el("div", { class: "sec-actions" }, [
        el("button", { class: "sec-btn", text: "Refresh", onclick: () => this.render(root) }),
      ]));
      root.appendChild(table([
        { label: "#", key: "id" },
        { label: "Event", render: (i) => i.event_type || i.event || "-" },
        { label: "Severity", render: (i) => badge("sev " + (i.severity ?? "?"), "warn") },
        { label: "User", render: (i) => el("code", { text: i.user_id || "?" }) },
        { label: "Channel", render: (i) => el("code", { text: i.channel_id || "-" }) },
        { label: "When", render: (i) => el("span", { text: fmtTime(i.created_at) }) },
      ], list.slice(0, 25)));
      if (!list.length) root.appendChild(el("p", { class: "sec-muted", text: "No recent SOC events." }));
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
