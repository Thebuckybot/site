// Thresholds — MODULE-oriented (SV2-MAN-002). Administrators reason about
// modules ("Anti-Spam"), not raw event keys ("message"), so this page renders
// one card per module from the registry's machine-readable trigger contract:
//   status: active | unavailable
//   trigger: threshold | fixed | specialized | unavailable
//   threshold_events / scope / cooldown_seconds / field_labels / description
// The event-keyed storage/API underneath is unchanged: rows are still
// (event_type, scope, mode[, role_id]) and every write bumps config_version.
import { api } from "../api.js";
import { getRegistry } from "../registry.js";
import { el, pageHeader, badge, toast, errorState, formModal, info } from "../ui.js";

const TRIGGER_BADGE = {
  threshold: ["threshold-driven", "ok"],
  specialized: ["specialized", "warn"],
  fixed: ["fixed trigger", "muted"],
  unavailable: ["unavailable", "bad"],
};

// Default labels for ordinary sliding-window thresholds; specialized modules
// override these via registry `field_labels` (e.g. Anti-Mention-Spam).
const DEFAULT_LABELS = {
  limit_count: "Limit (events in window)",
  window_seconds: "Window (seconds)",
  burst_limit: "Burst limit (optional)",
  burst_window_seconds: "Burst window seconds (optional)",
};

export default {
  async render(root) {
    let mode = "normal";
    let thresholds = [];
    let reg = { modules: [], bounds: { limit: [1, 1000], window: [1, 86400] } };
    let canEdit = false;
    const state = { cat: "all" };

    const load = async () => {
      [thresholds, reg, { can_edit: canEdit }] = await Promise.all([
        api.get("/thresholds"), getRegistry(), api.me().catch(() => ({ can_edit: false })),
      ]);
      draw();
    };

    const bounds = () => reg.bounds || { limit: [1, 1000], window: [1, 86400] };
    const labelsFor = (m) => ({ ...DEFAULT_LABELS, ...(m.field_labels || {}) });

    // rows visible under the selected mode for one event key (base + role overrides)
    const rowsFor = (event) =>
      thresholds.filter((t) => t.event_type === event && (t.mode === mode || t.mode === "both"));

    const save = async (payload) => {
      await api.post("/threshold", payload);
      toast("Threshold saved.");
      await load();
    };

    const editRow = async (m, t) => {
      const L = labelsFor(m);
      const b = bounds();
      const vals = await formModal({
        title: `${m.label} - ${t.event_type} (${t.mode})`,
        fields: [
          { name: "limit_count", label: `${L.limit_count} [${b.limit[0]}-${b.limit[1]}]`, type: "number", value: t.limit_count },
          { name: "window_seconds", label: `${L.window_seconds} [${b.window[0]}-${b.window[1]}]`, type: "number", value: t.window_seconds },
          { name: "burst_limit", label: L.burst_limit, type: "number", value: t.burst_limit ?? "" },
          { name: "burst_window_seconds", label: L.burst_window_seconds, type: "number", value: t.burst_window_seconds ?? "" },
        ],
      });
      if (!vals) return;
      try {
        await save({
          event_type: t.event_type, scope: t.scope, mode: t.mode,
          role_id: t.role_id && t.role_id !== "0" ? t.role_id : null, // preserve role overrides
          limit_count: Number(vals.limit_count), window_seconds: Number(vals.window_seconds),
          burst_limit: vals.burst_limit === "" ? null : Number(vals.burst_limit),
          burst_window_seconds: vals.burst_window_seconds === "" ? null : Number(vals.burst_window_seconds),
          dynamic_scale: !!t.dynamic_scale,
        });
      } catch (e) { toast(e.message, "err"); }
    };

    // create a MISSING default row — only for module/event/scope/mode combos the
    // registry declares (arbitrary events are impossible; backend re-validates).
    const createRow = async (m, event) => {
      const L = labelsFor(m);
      const b = bounds();
      const vals = await formModal({
        title: `Create threshold - ${m.label} (${event}, ${mode})`,
        fields: [
          { name: "limit_count", label: `${L.limit_count} [${b.limit[0]}-${b.limit[1]}]`, type: "number", value: "" },
          { name: "window_seconds", label: `${L.window_seconds} [${b.window[0]}-${b.window[1]}]`, type: "number", value: "" },
        ],
      });
      if (!vals) return;
      try {
        await save({
          event_type: event, scope: m.scope || "user", mode,
          limit_count: Number(vals.limit_count), window_seconds: Number(vals.window_seconds),
          burst_limit: null, burst_window_seconds: null, dynamic_scale: false,
        });
      } catch (e) { toast(e.message, "err"); }
    };

    const lockIcon = () => el("span", {
      class: "sec-muted", text: "🔒",
      title: "Only the Server Owner or a Trusted Administrator can modify Security settings.",
    });

    // ---- per-module threshold table ------------------------------------- #
    const thresholdTable = (m) => {
      const wrap = el("div", { class: "sec-mod-thresholds" });
      const L = labelsFor(m);
      for (const event of m.threshold_events || []) {
        const rows = rowsFor(event);
        const head = el("div", { class: "sec-settings-row" }, [
          el("div", { class: "k" }, [el("strong", { text: event }),
            info(`security_thresholds rows this module reads (event "${event}", scope "${m.scope || "user"}").`)]),
        ]);
        wrap.appendChild(head);
        if (!rows.length) {
          wrap.appendChild(el("div", { class: "sec-settings-row" }, [
            el("span", { class: "sec-muted", text: `No ${mode}-mode row configured - the module cannot fire on this event in ${mode} mode.` }),
            canEdit
              ? el("button", { class: "sec-btn sec-btn-sm sec-btn-primary", text: "Create", onclick: () => createRow(m, event) })
              : lockIcon(),
          ]));
          continue;
        }
        for (const t of rows) {
          const parts = [
            badge(t.scope, "muted"),
            badge(t.mode, "muted"),
            el("span", { text: `${L.limit_count.split(" [")[0]}: ${t.limit_count}` }),
            el("span", { text: `${L.window_seconds.split(" [")[0]}: ${t.window_seconds}s` }),
          ];
          if (m.trigger !== "specialized" && t.burst_limit) {
            parts.push(el("span", { text: `burst ${t.burst_limit}/${t.burst_window_seconds}s` }));
          }
          if (t.dynamic_scale) parts.push(badge("scales by size", "ok"));
          if (t.role_id && t.role_id !== "0") parts.push(badge(`role override ${t.role_id}`, "warn"));
          parts.push(canEdit
            ? el("button", { class: "sec-btn sec-btn-sm", text: "Edit", onclick: () => editRow(m, t) })
            : lockIcon());
          wrap.appendChild(el("div", { class: "sec-settings-row sec-thr-row" }, parts));
        }
      }
      return wrap;
    };

    // ---- module card ------------------------------------------------------ #
    const card = (m) => {
      const [tLabel, tKind] = TRIGGER_BADGE[m.trigger] || ["unknown", "muted"];
      const head = el("div", { class: "sec-chain-title" }, [
        el("strong", { text: m.label }), " ",
        badge(m.category || "-", "muted"), " ",
        badge(tLabel, tKind),
        m.status === "unavailable" ? badge("NOT AVAILABLE", "bad") : "",
      ]);
      const body = [head,
        el("p", { class: "sec-muted", text: m.description || "" }),
        el("div", { class: "sec-muted", text: `Events: ${(m.events || []).join(", ") || "-"}` })];

      if (m.status === "unavailable") {
        body.push(el("p", { class: "sec-muted", text: "This module has no runtime implementation yet. It cannot be enabled and cannot be tested as functional." }));
      } else if (m.trigger === "fixed") {
        body.push(el("p", { class: "sec-muted", text:
          `Fixed trigger - fires on the first occurrence; repeats are deduplicated for ${m.cooldown_seconds}s. ` +
          "There is NO threshold to edit for this module (the cooldown is fixed in the bot)." }));
      } else {
        if (m.trigger === "specialized") {
          body.push(el("p", { class: "sec-muted", text: "⚠ Specialized threshold - the fields below do NOT mean \"X events in Y seconds\" for this module; labels show their real meaning." }));
        }
        body.push(thresholdTable(m));
      }
      return el("div", { class: "sec-card sec-chain-card", style: "display:block" }, body);
    };

    const draw = () => {
      const body = root.querySelector("#thr-body");
      if (!body) return;
      const mods = (reg.modules || []).filter((m) => state.cat === "all" || m.category === state.cat);
      // active first, unavailable last; stable by label
      mods.sort((a, b) => (a.status === "unavailable") - (b.status === "unavailable")
        || String(a.label).localeCompare(String(b.label)));
      body.replaceChildren(...mods.map(card));
    };

    try {
      root.appendChild(pageHeader("Thresholds & Triggers",
        "Every module, its trigger behavior, and where to configure it. Threshold edits apply to the bot within one event (config version reload)."));
      const modeSel = el("select", { class: "sec-select" }, [
        el("option", { value: "normal", text: "Normal mode" }),
        el("option", { value: "hard", text: "Hard mode" }),
      ]);
      modeSel.addEventListener("change", () => { mode = modeSel.value; draw(); });
      const catSel = el("select", { class: "sec-select" }, [
        el("option", { value: "all", text: "all categories" }),
        el("option", { value: "messages", text: "messages" }),
        el("option", { value: "members", text: "members" }),
        el("option", { value: "structure", text: "structure" }),
      ]);
      catSel.addEventListener("change", () => { state.cat = catSel.value; draw(); });
      root.appendChild(el("div", { class: "sec-toolbar" }, [
        el("span", { class: "sec-muted", text: "Showing mode:" }), modeSel, catSel,
      ]));
      root.appendChild(el("div", { id: "thr-body" }));
      await load();
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
