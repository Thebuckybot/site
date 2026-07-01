import { api } from "../api.js";
import { el, statCard, badge, pageHeader, errorState } from "../ui.js";

export default {
  async render(root) {
    try {
      const [ov, em] = await Promise.all([api.get("/overview"), api.get("/emergency")]);
      root.appendChild(pageHeader("Overview", "Live security status for this server."));
      const grade = ov.security_score >= 75 ? "ok" : ov.security_score >= 50 ? "warn" : "bad";

      root.appendChild(el("div", { class: "sec-grid sec-grid-4" }, [
        el("div", { class: "sec-card sec-score" }, [
          el("div", {}, [
            el("div", { class: "num", text: ov.security_score }),
            el("div", { class: "grade" }, [badge("Grade " + ov.grade, grade)]),
          ]),
          el("div", { class: "sec-muted", text: "Security Score" }),
        ]),
        statCard("Mode", String(ov.mode || "normal").toUpperCase()),
        statCard("Modules On", `${ov.modules_enabled}/${ov.modules_total}`),
        statCard("Risk Level", Math.round(ov.risk_level || 0)),
      ]));

      root.appendChild(el("div", { class: "sec-grid sec-grid-4", style: "margin-top:16px" }, [
        statCard("Incidents (24h)", ov.incidents_today),
        statCard("Incidents (7d)", ov.incidents_week),
        statCard("Quarantined", ov.quarantined),
        statCard("Emergency", em.emergency_mode ? "ACTIVE" : "Off"),
      ]));

      const warnCard = el("div", { class: "sec-card", style: "margin-top:16px" }, [
        el("div", { class: "sec-page-title", text: "Warnings" }),
      ]);
      if ((ov.warnings || []).length) {
        ov.warnings.forEach((w) => warnCard.appendChild(
          el("div", { class: "sec-check" }, [el("span", { class: "dot bad" }), el("span", { text: w })])));
      } else {
        warnCard.appendChild(el("p", { class: "sec-muted", text: "No warnings - configuration looks healthy." }));
      }
      root.appendChild(warnCard);

      root.appendChild(el("div", { class: "sec-actions", style: "margin-top:16px" }, [
        el("a", { class: "sec-btn sec-btn-primary", href: "#modules", text: "Manage Modules" }),
        el("a", { class: "sec-btn", href: "#health", text: "Security Health" }),
        el("a", { class: "sec-btn", href: "#incidents", text: "View Incidents" }),
        el("a", { class: "sec-btn", href: "#emergency", text: "Emergency Center" }),
      ]));
    } catch (err) {
      errorState(root, err, () => this.render(root));
    }
  },
};
