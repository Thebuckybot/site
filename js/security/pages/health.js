import { api } from "../api.js";
import { el, badge, pageHeader, errorState } from "../ui.js";

export default {
  async render(root) {
    try {
      const h = await api.get("/health");
      root.appendChild(pageHeader("Security Health", "Computed by the backend - the website only renders the result."));
      const grade = h.score >= 75 ? "ok" : h.score >= 50 ? "warn" : "bad";
      root.appendChild(el("div", { class: "sec-card sec-score" }, [
        el("div", {}, [el("div", { class: "num", text: h.score }), el("div", { class: "grade" }, [badge("Grade " + h.grade, grade)])]),
        el("div", { class: "sec-muted", text: "Overall Security Score (0-100)" }),
      ]));

      const checks = el("div", { class: "sec-card", style: "margin-top:16px" }, [el("div", { class: "sec-page-title", text: "Checks" })]);
      (h.checks || []).forEach((c) => checks.appendChild(el("div", { class: "sec-check" }, [
        el("span", { class: `dot ${c.ok ? "ok" : "bad"}` }),
        el("span", { text: c.message }),
        el("span", { class: "sec-spacer" }),
        badge(c.severity, c.ok ? "ok" : c.severity === "critical" ? "bad" : "warn"),
      ])));
      root.appendChild(checks);

      if ((h.recommendations || []).length) {
        const rec = el("div", { class: "sec-card", style: "margin-top:16px" }, [el("div", { class: "sec-page-title", text: "Recommended Actions" })]);
        h.recommendations.forEach((r) => rec.appendChild(el("div", { class: "sec-check" }, [el("span", { class: "dot bad" }), el("span", { text: r })])));
        root.appendChild(rec);
      }
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
