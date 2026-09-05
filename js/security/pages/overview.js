import { api } from "../api.js";
import { el, statCard, badge, pageHeader, errorState, toast, fmtTime } from "../ui.js";
import { boostCard } from "./settings.js";

export default {
  async render(root) {
    // Re-entrant safe: quick actions call render() again to refresh, so clear
    // first — otherwise a second full copy of the page stacks on top (FIN-002 M1).
    root.replaceChildren();
    try {
      const [ov, em, health, incRaw, settings] = await Promise.all([
        api.get("/overview"),
        api.get("/emergency").catch(() => ({})),
        api.get("/health").catch(() => ({ checks: [], recommendations: [] })),
        api.getRaw("/incidents?per_page=5").catch(() => ({ data: { items: [] } })),
        // de boostkaart leest uit dezelfde instellingen-payload als Settings
        api.get("/settings").catch(() => null),
      ]);
      const incidents = (incRaw && incRaw.data && incRaw.data.items) || [];
      const grade = ov.security_score >= 75 ? "ok" : ov.security_score >= 50 ? "warn" : "bad";
      const protectedOk = ov.security_score >= 60 && !(health.checks || []).some((c) => c.key === "anti_nuke" && !c.ok);

      root.appendChild(pageHeader("Security Center", "Your server's protection at a glance."));

      // Row 1 — headline status
      root.appendChild(el("div", { class: "sec-grid sec-grid-4" }, [
        el("div", { class: "sec-card sec-score" }, [
          el("div", {}, [el("div", { class: "num", text: ov.security_score }), el("div", { class: "grade" }, [badge("Grade " + ov.grade, grade)])]),
          el("div", { class: "sec-muted", text: "Security Score" }),
        ]),
        statCard("Mode", String(ov.mode || "normal").toUpperCase()),
        el("div", { class: "sec-card sec-stat" }, [el("span", { class: "label", text: "Protection" }), el("span", { class: "value" }, [badge(protectedOk ? "Protected" : "At risk", protectedOk ? "ok" : "bad")])]),
        statCard("Active Modules", `${ov.modules_enabled}/${ov.modules_total}`),
      ]));

      // Row 2 — activity
      root.appendChild(el("div", { class: "sec-grid sec-grid-4", style: "margin-top:16px" }, [
        statCard("Incidents Today", ov.incidents_today),
        statCard("Quarantined", ov.quarantined),
        el("div", { class: "sec-card sec-stat" }, [el("span", { class: "label", text: "Last Detection" }), el("span", { class: "value", style: "font-size:15px", text: incidents.length ? fmtTime(incidents[0].created_at) : "None" })]),
        statCard("Risk Level", Math.round(ov.risk_level || 0)),
      ]));

      // Row 3 — quick actions. SV2-READONLY-001: the mode-switch is a WRITE, so it
      // is only rendered for editors; read-only users see the navigation shortcuts.
      const perms = await api.me().catch(() => ({ can_edit: false }));
      const canEdit = !!perms.can_edit;
      const hard = String(ov.mode) === "hard";
      const quickItems = [
        el("a", { href: "#modules" }, [el("span", { class: "qa-t", text: "Configure Modules" }), el("span", { class: "qa-d", text: "Turn protections on or off" })]),
      ];
      if (canEdit) {
        quickItems.push(el("button", { "data-write": "1", onclick: async () => {
          try { await api.post("/protection", { mode: hard ? "normal" : "hard" }); toast(`Mode set to ${hard ? "normal" : "hard"}.`); this.render(root); }
          catch (e) { toast(e.message, "err"); }
        } }, [el("span", { class: "qa-t", text: hard ? "Switch to Normal" : "Enable Hard Mode" }), el("span", { class: "qa-d", text: "Change detection strictness" })]));
      }
      quickItems.push(el("a", { href: "#soc" }, [el("span", { class: "qa-t", text: "Open SOC" }), el("span", { class: "qa-d", text: "Advanced rule-based detection" })]));
      quickItems.push(el("a", { href: "#emergency" }, [el("span", { class: "qa-t", text: "Emergency Center" }), el("span", { class: "qa-d", text: "Lockdown & emergency mode" })]));
      const quick = el("div", { class: "sec-quick", style: "margin-top:20px" }, quickItems);
      root.appendChild(el("h2", { class: "sec-page-title", style: "margin-top:26px;font-size:16px", text: "Quick Actions" }));
      root.appendChild(quick);

      // Row 4 — recent incidents + health
      const grid = el("div", { class: "sec-grid sec-grid-2", style: "margin-top:20px" });
      const recent = el("div", { class: "sec-card" }, [el("div", { class: "sec-page-title", style: "font-size:16px", text: "Recent Incidents" })]);
      if (incidents.length) {
        incidents.forEach((i) => recent.appendChild(el("div", { class: "sec-check" }, [
          badge("sev " + i.severity, i.severity >= 4 ? "bad" : "warn"),
          el("span", { text: i.module_key || i.event_type }),
          el("span", { class: "sec-spacer" }),
          el("span", { class: "sec-muted", text: fmtTime(i.created_at) }),
        ])));
      } else {
        recent.appendChild(el("p", { class: "sec-muted", text: "No incidents recorded." }));
      }
      recent.appendChild(el("div", { class: "sec-actions", style: "margin-top:12px" }, [el("a", { class: "sec-btn sec-btn-sm", href: "#incidents", text: "View all" })]));

      const hcard = el("div", { class: "sec-card" }, [el("div", { class: "sec-page-title", style: "font-size:16px", text: "Health & Recommendations" })]);
      const failed = (health.checks || []).filter((c) => !c.ok).slice(0, 4);
      if (failed.length) {
        failed.forEach((c) => hcard.appendChild(el("div", { class: "sec-check" }, [el("span", { class: "dot bad" }), el("span", { text: c.message })])));
      } else {
        hcard.appendChild(el("div", { class: "sec-check" }, [el("span", { class: "dot ok" }), el("span", { text: "All health checks passing." })]));
      }
      hcard.appendChild(el("div", { class: "sec-actions", style: "margin-top:12px" }, [el("a", { class: "sec-btn sec-btn-sm", href: "#health", text: "Security Health" })]));

      grid.appendChild(recent); grid.appendChild(hcard);
      if (settings) grid.appendChild(boostCard(settings.boost, settings.limits));
      root.appendChild(grid);
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
