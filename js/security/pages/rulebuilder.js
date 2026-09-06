// SOC Rule Builder — now a first-class Security Center workspace page (no longer
// a standalone rule-builder.html app). Full port of js/rule-builder.js: the
// WHEN / IF / THEN flow, event-scoped condition/action allow-lists, per-field
// rendering, severity, create, list, enable-toggle, details modal and delete.
// Only the shell changed: it uses the shared sidebar, breadcrumb, router,
// ui.js helpers, the crimson design language and the unified `soc` API client
// (which talks to /api/security/soc/*). No functionality was dropped.
import { soc, api } from "../api.js";
import { el, clear, pageHeader, badge, toast, errorState, fmtTime, alertBox } from "../ui.js";

function usageBadge(u) {
  if (!u) return el("span", {});
  if (u.unlimited) return badge(`${u.used} rules · Unlimited`, "ok");
  const kind = u.at_limit ? "bad" : (u.used / u.limit >= 0.8 ? "warn" : "ok");
  return badge(`${u.used} / ${u.limit} rules used`, kind);
}
function premiumNotice(u) {
  // Two states, no tier ladder (see rules.js): the cap is this server's own
  // number and a Security Boost is the only way up.
  const line = u.boosted
    ? `This server is using all ${u.limit} of its rules. Disable or delete one to add another.`
    : `You are using all ${u.limit} rules this server may hold. A Security Boost raises the cap.`;
  return alertBox({ kind: "premium", title: "Maximum rules reached", icon: el("span", { text: "★" }), message: el("div", {}, [
    el("p", { class: "sec-muted", style: "margin:0 0 8px", text: line }),
  ]) });
}

const MAX_CONDITIONS = 3;
const MAX_ACTIONS = 3;

export default {
  async render(root) {
    let registry = null;
    let rules = [];

    // ---- data ---------------------------------------------------------------
    let usage = null;
    const loadRegistry = async () => { registry = await soc.registry(); };
    const loadRules = async () => {
      const r = await soc.get("/rules");
      rules = Array.isArray(r) ? r : (r && r.rules) || [];
    };
    const loadUsage = async () => { usage = await soc.get("/rules/usage").catch(() => null); };

    // ---- field rendering (select / input) with data-field = field name ------
    const renderFields = (typeValue, container, mode) => {
      clear(container);
      const source = mode === "condition"
        ? (registry.conditions || []).find((c) => c.type === typeValue)
        : (registry.actions || []).find((a) => a.action === typeValue);
      if (!source || !source.fields) return;
      for (const field of source.fields) {
        let input;
        if (field.type === "select") {
          input = el("select", { class: "sec-select" },
            (field.options || []).map((opt) => el("option", { value: opt, text: opt })));
        } else {
          input = el("input", { class: "sec-input", type: field.type || "text", placeholder: field.placeholder || "" });
        }
        input.dataset.field = field.name;
        container.appendChild(input);
      }
    };

    // ---- condition / action blocks -----------------------------------------
    const addBlock = (mode, scroll = true) => {
      const isCond = mode === "condition";
      const container = root.querySelector(isCond ? "#sec-rb-conditions" : "#sec-rb-actions");
      const max = isCond ? MAX_CONDITIONS : MAX_ACTIONS;
      if (container.children.length >= max) {
        toast(`Maximum ${isCond ? "conditions" : "actions"} reached (${max}).`, "err");
        return;
      }
      const eventType = root.querySelector("#sec-rb-event").value;
      const allowed = isCond
        ? (registry.event_condition_map[eventType] || [])
        : (registry.event_action_map[eventType] || []);
      const options = (isCond ? registry.conditions : registry.actions)
        .filter((x) => allowed.includes(isCond ? x.type : x.action));

      const select = el("select", { class: "sec-select" }, [
        el("option", { value: "", text: isCond ? "Select condition…" : "Select action…", disabled: true, selected: true }),
        ...options.map((x) => el("option", { value: isCond ? x.type : x.action, text: x.label })),
      ]);
      const fields = el("div", { class: "sec-rb-fields" });
      select.addEventListener("change", () => { if (select.value) renderFields(select.value, fields, mode); });

      const removeBtn = el("button", { class: "sec-rb-remove", type: "button", title: "Remove", "aria-label": "Remove", text: "✕" });
      const block = el("div", { class: `sec-rb-item ${isCond ? "cond" : "act"}` }, [removeBtn, select, fields]);
      removeBtn.addEventListener("click", () => block.remove());
      container.appendChild(block);
      // a block added by hand scrolls into view; a template fill does not, so
      // whoever filled it (the tour) keeps control of where the page is
      if (scroll) block.scrollIntoView({ behavior: "smooth", block: "center" });
      return block;
    };

    // ---- a template from outside (the onboarding tour) ----------------------
    // The tour fills in a harmless rule and lets the visitor press Create Rule
    // themselves. Same code path as typing it by hand: blocks are added through
    // addBlock, selects fire change so their fields render, values land in the
    // same inputs collect() reads.
    const fillTemplate = (t) => {
      if (!t || !root.isConnected) return;
      const nameInput = root.querySelector("#sec-rb-name");
      const eventSelect = root.querySelector("#sec-rb-event");
      if (!nameInput || !eventSelect) return;
      nameInput.value = t.name || "";
      if (t.event_type) { eventSelect.value = t.event_type; eventSelect.dispatchEvent(new Event("change")); }
      const place = (mode, items, keyName) => {
        for (const item of items || []) {
          const block = addBlock(mode, false);
          if (!block) return;
          const select = block.querySelector("select");
          select.value = item[keyName] || "";
          select.dispatchEvent(new Event("change"));
          block.querySelectorAll("[data-field]").forEach((field) => {
            if (item[field.dataset.field] !== undefined) field.value = String(item[field.dataset.field]);
          });
        }
      };
      place("condition", t.conditions, "type");
      place("action", t.actions, "action");
      const sev = root.querySelector("#sec-rb-severity");
      if (sev && t.severity) sev.value = String(t.severity);
    };
    if (document.__rbTemplate) document.removeEventListener("bucky:rulebuilder-template", document.__rbTemplate);
    document.__rbTemplate = (e) => fillTemplate(e.detail);
    document.addEventListener("bucky:rulebuilder-template", document.__rbTemplate);

    // ---- collect payload from the DOM (placeholder fallback + int coercion) --
    const collect = (selector, keyName) => {
      const out = [];
      root.querySelectorAll(selector).forEach((block) => {
        const type = block.querySelector("select").value;
        if (!type) return;
        const entry = { [keyName]: type };
        block.querySelectorAll("[data-field]").forEach((field) => {
          let value = field.value;
          if (!value || String(value).trim() === "") value = field.placeholder || null;
          if (field.type === "number" && value !== null) value = parseInt(value, 10);
          entry[field.dataset.field] = value;
        });
        out.push(entry);
      });
      return out;
    };

    const saveRule = async () => {
      const name = root.querySelector("#sec-rb-name").value.trim();
      const eventType = root.querySelector("#sec-rb-event").value;
      const severity = parseInt(root.querySelector("#sec-rb-severity").value, 10);
      const conditions = collect(".sec-rb-item.cond", "type");
      const actions = collect(".sec-rb-item.act", "action");
      try {
        const result = await soc.post("/rules", { name, event_type: eventType, conditions, actions, severity });
        toast("Rule created.");
        root.querySelector("#sec-rb-name").value = "";
        clear(root.querySelector("#sec-rb-conditions"));
        clear(root.querySelector("#sec-rb-actions"));
        await loadRules();
        drawRules();
        // Tell whoever is listening (the onboarding tour) which rule this became:
        // the id from the backend, or the newest rule with this name.
        let created = result && result.id ? rules.find((r) => Number(r.id) === Number(result.id)) : null;
        if (!created) created = rules.filter((r) => r.name === name).sort((a, b) => Number(b.id) - Number(a.id))[0];
        const id = created ? created.id : (result && result.id) || null;
        if (id != null) document.dispatchEvent(new CustomEvent("bucky:soc-rule-created", { detail: { id, name } }));
      } catch (e) {
        toast(e.message || "Failed to create rule", "err");
      }
    };

    // ---- existing rules list -----------------------------------------------
    const openDetails = async (rule) => {
      const created = rule.created_at ? fmtTime(rule.created_at) : "—";
      const body = [
        el("div", { class: "sec-muted", html:
          `<strong>Event:</strong> ${rule.event_type}<br>` +
          `<strong>Severity:</strong> ${rule.severity}<br>` +
          `<strong>Created:</strong> ${created}` }),
        el("div", { class: "sec-rb-code-label", text: "Conditions" }),
        el("pre", { class: "sec-rb-code", text: JSON.stringify(rule.conditions_json ?? [], null, 2) }),
        el("div", { class: "sec-rb-code-label", text: "Actions" }),
        el("pre", { class: "sec-rb-code", text: JSON.stringify(rule.actions_json ?? [], null, 2) }),
      ];
      const host = document.getElementById("sec-modal-host");
      const close = () => { host.classList.remove("open"); host.setAttribute("aria-hidden", "true"); clear(host); };
      const del = async () => {
        try { await soc.del(`/rules/${rule.id}`); toast("Rule deleted."); close(); await loadRules(); drawRules(); }
        catch (e) { toast(e.message, "err"); }
      };
      const modal = el("div", { class: "sec-modal" }, [
        el("h3", { text: rule.name }), ...body,
        el("div", { class: "sec-modal-actions" }, [
          el("button", { class: "sec-btn sec-btn-ghost", onclick: close, text: "Close" }),
          el("button", { class: "sec-btn sec-btn-danger", onclick: del, text: "Delete Rule" }),
        ]),
      ]);
      clear(host); host.appendChild(modal); host.classList.add("open"); host.setAttribute("aria-hidden", "false");
    };

    const drawRules = () => {
      const list = root.querySelector("#sec-rb-list");
      clear(list);
      if (!rules.length) { list.appendChild(el("div", { class: "sec-empty", text: "No rules yet. Create your first rule above." })); return; }
      for (const rule of rules) {
        const enabledToggle = el("input", { type: "checkbox" });
        enabledToggle.checked = !!rule.enabled;
        enabledToggle.addEventListener("change", async (e) => {
          e.stopPropagation();
          try { await soc.patch(`/rules/${rule.id}/toggle`); rule.enabled = enabledToggle.checked; toast("Rule updated."); }
          catch (err) { toast(err.message, "err"); enabledToggle.checked = !enabledToggle.checked; }
        });
        const card = el("div", { class: "sec-card sec-rb-rule", "data-rule-id": String(rule.id) }, [
          el("div", { class: "sec-rb-rule-main" }, [
            el("div", { class: "sec-rb-rule-title", text: rule.name }),
            el("div", { class: "sec-muted", text: `${rule.event_type} • Severity ${rule.severity}` }),
          ]),
          el("div", { class: "sec-rb-rule-ctl" }, [
            badge(rule.enabled ? "Enabled" : "Disabled", rule.enabled ? "ok" : "muted"),
            el("label", { class: "sec-switch" }, [enabledToggle, el("span", { class: "track" })]),
            el("button", { class: "sec-btn sec-btn-sm", text: "Details", onclick: () => openDetails(rule) }),
          ]),
        ]);
        list.appendChild(card);
      }
    };

    // ---- initial paint ------------------------------------------------------
    try {
      const [, , , me] = await Promise.all([loadRegistry(), loadRules(), loadUsage(), api.me().catch(() => ({ can_edit: false }))]);
      const canEdit = !!(me && me.can_edit);
      const atLimit = !!(usage && usage.at_limit);

      root.appendChild(pageHeader("Rule Builder",
        "Compose custom SOC detection rules — WHEN an event fires, IF conditions match, THEN run actions. Part of the Security Center."));
      root.appendChild(el("div", { class: "sec-actions", style: "margin-bottom:12px" }, [usageBadge(usage)]));
      if (!canEdit) root.appendChild(alertBox({ kind: "warn", icon: el("span", { text: "🔒" }),
        message: "Read-only — only the Server Owner or a Trusted Administrator can create or edit SOC rules. You can view existing rules below." }));
      if (atLimit && canEdit) root.appendChild(premiumNotice(usage));

      const eventSelect = el("select", { id: "sec-rb-event", class: "sec-select sec-rb-event" },
        (registry.events || []).map((ev) => el("option", { value: ev.value, text: ev.label })));
      eventSelect.addEventListener("change", () => {
        clear(root.querySelector("#sec-rb-conditions"));
        clear(root.querySelector("#sec-rb-actions"));
      });

      // ids on the form and its Create button: the onboarding tour lights up
      // exactly what the visitor has to use at the "create a rule" step
      const flow = el("div", { class: "sec-card", id: "sec-rb-form" }, [
        el("div", { class: "sec-settings-row" }, [
          el("div", { class: "k" }, [el("label", { class: "sec-rb-flow-label", text: "Rule Name" })]),
          el("input", { id: "sec-rb-name", class: "sec-input", placeholder: "Example: Mention Spam Protection", style: "min-width:280px" }),
        ]),
        el("div", { class: "sec-rb-flow" }, [
          el("div", { class: "sec-rb-block when" }, [el("div", { class: "sec-rb-tag", text: "WHEN" }), eventSelect]),
          el("div", { class: "sec-rb-connector", text: "↓" }),
          el("div", { class: "sec-rb-block if" }, [
            el("div", { class: "sec-rb-tag", text: "IF" }),
            el("div", { id: "sec-rb-conditions", class: "sec-rb-container" }),
            el("button", { class: "sec-rb-add", type: "button", text: "+ Add Condition", onclick: () => addBlock("condition") }),
          ]),
          el("div", { class: "sec-rb-connector", text: "↓" }),
          el("div", { class: "sec-rb-block then" }, [
            el("div", { class: "sec-rb-tag", text: "THEN" }),
            el("div", { id: "sec-rb-actions", class: "sec-rb-container" }),
            el("button", { class: "sec-rb-add", type: "button", text: "+ Add Action", onclick: () => addBlock("action") }),
          ]),
        ]),
        el("div", { class: "sec-settings-row" }, [
          el("div", { class: "k" }, [el("label", { class: "sec-rb-flow-label", text: "Severity" })]),
          el("select", { id: "sec-rb-severity", class: "sec-select" }, [
            el("option", { value: "1", text: "Low" }),
            el("option", { value: "2", text: "Medium" }),
            el("option", { value: "3", text: "High" }),
            el("option", { value: "4", text: "Critical" }),
          ]),
        ]),
        el("div", { class: "sec-actions", style: "margin-top:16px" }, [
          (!canEdit || atLimit)
            ? el("button", { class: "sec-btn", disabled: true, text: !canEdit ? "Read-only" : "Rule limit reached" })
            : el("button", { class: "sec-btn sec-btn-primary", id: "sec-rb-create", text: "Create Rule", onclick: saveRule }),
          el("a", { class: "sec-btn", href: "#rules", text: "View Detection Rules" }),
        ]),
      ]);
      root.appendChild(flow);

      root.appendChild(el("div", { class: "sec-card", style: "margin-top:16px" }, [
        el("div", { class: "sec-page-title", text: "Existing Rules" }),
        el("div", { id: "sec-rb-list", class: "sec-rb-rules" }),
      ]));
      drawRules();
    } catch (err) {
      errorState(root, err, () => this.render(root));
    }
  },
};
