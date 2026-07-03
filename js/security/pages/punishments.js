import { api } from "../api.js";
import { el, pageHeader, badge, toast, errorState, info, emptyCard } from "../ui.js";
import { getRegistry } from "../registry.js";
import { stageDesc, moduleDesc } from "../descriptions.js";

// Punishment chains are PREDEFINED — exactly one per module/mode (anti_nuke normal,
// anti_nuke hard, anti_spam, ...). Users edit the STAGES of an existing chain;
// they never create arbitrary chains or duplicate modules (that would make the
// engine unpredictable). SOC Rules are the user-creatable surface, not this one.
export default {
  async render(root) {
    let chains = [], reg = null, canEdit = false;
    let editing = null; // {trigger_key, mode, name, id, stages:[...]}

    try {
      [chains, reg, { can_edit: canEdit }] = await Promise.all([
        api.get("/punishments"), getRegistry(), api.me().catch(() => ({ can_edit: false })),
      ]);
    } catch (err) { return errorState(root, err, () => this.render(root)); }

    const stageTypes = reg.stages || [];
    const onFailures = reg.on_failure || ["continue", "abort"];
    const stageMeta = reg.stage_meta || {};
    const supportsDuration = (type) => !!(stageMeta[type] && stageMeta[type].duration);
    const maxWhenEmpty = (type) => !!(stageMeta[type] && stageMeta[type].max_only_when_empty);

    // Duration is stored as SECONDS everywhere; the unit picker is pure UX.
    const UNITS = [["seconds", 1], ["minutes", 60], ["hours", 3600], ["days", 86400]];
    const splitDuration = (seconds) => {
      if (seconds == null || seconds === "") return { value: "", unit: "seconds" };
      const s = Number(seconds);
      for (const [name, f] of [["days", 86400], ["hours", 3600], ["minutes", 60]]) {
        if (s >= f && s % f === 0) return { value: s / f, unit: name };
      }
      return { value: s, unit: "seconds" };
    };

    const reload = async () => { chains = await api.get("/punishments"); paint(); };

    // ---- persistence (edit the EXISTING chain only) --------------------- #
    const saveChain = async () => {
      if (!editing || !editing.stages.length) { toast("A chain needs at least one stage.", "err"); return; }
      const payload = {
        trigger_key: editing.trigger_key,   // locked — never changes
        mode: editing.mode,                 // locked — part of the identity
        name: editing.name || editing.trigger_key,
        stages: editing.stages.map((s) => ({
          type: s.type, params: s.params || {}, on_failure: s.on_failure || "continue",
          delay: s.delay === "" || s.delay == null ? null : Number(s.delay),
          duration: s.duration === "" || s.duration == null ? null : Number(s.duration),
        })),
      };
      try { await api.post("/punishment", payload); toast("Chain saved."); editing = null; await reload(); }
      catch (e) { toast(e.message, "err"); }
    };

    const openEdit = (c) => { editing = { trigger_key: c.trigger_key, mode: c.mode, name: c.name, id: c.id, stages: c.stages.map((s) => ({ ...s })) }; paint(); };

    // ---- stage rows ----------------------------------------------------- #
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= editing.stages.length) return; const [x] = editing.stages.splice(i, 1); editing.stages.splice(j, 0, x); paint(); };
    // Duration field = number + unit picker; writes back seconds to s.duration.
    const durationField = (s) => {
      const init = splitDuration(s.duration);
      const numI = el("input", { class: "sec-input sec-input-num", type: "number", min: "1",
        placeholder: maxWhenEmpty(s.type) ? "max" : "permanent", value: init.value });
      const unitS = el("select", { class: "sec-select sec-unit" }, UNITS.map(([n]) => {
        const o = el("option", { value: n, text: n }); if (n === init.unit) o.selected = true; return o;
      }));
      const recompute = () => {
        if (numI.value === "" || numI.value == null) { s.duration = null; return; }
        const f = (UNITS.find((u) => u[0] === unitS.value) || [null, 1])[1];
        s.duration = Math.round(Number(numI.value) * f);
      };
      numI.addEventListener("input", recompute);
      unitS.addEventListener("change", recompute);
      return el("div", { class: "sec-dur-field" }, [numI, unitS]);
    };

    const stageRow = (s, i) => {
      const typeSel = selectEl(stageTypes, s.type, (v) => {
        s.type = v;
        if (!supportsDuration(v)) s.duration = null;   // drop meaningless duration
        paint();                                       // re-render so fields match the stage
      });
      const failSel = selectEl(onFailures, s.on_failure || "continue", (v) => { s.on_failure = v; });
      const delay = numEl(s.delay, "sec", (v) => { s.delay = v; });
      const opts = [labelWrap("On fail", failSel), labelWrap("Delay (s)", delay)];
      // Duration ONLY for stages whose handler consumes it (server also enforces this).
      if (supportsDuration(s.type)) {
        const label = maxWhenEmpty(s.type) ? "Duration (empty = Discord max)"
          : "Duration (empty = permanent)";
        opts.push(labelWrap(label, durationField(s)));
      }
      return el("div", { class: "sec-stage-row" }, [
        el("span", { class: "sec-stage-num", text: String(i + 1) }),
        el("div", { class: "sec-stage-main" }, [
          el("div", { class: "sec-stage-type" }, [typeSel, info(stageDesc(s.type))]),
          el("div", { class: "sec-stage-opts" }, opts),
        ]),
        el("div", { class: "sec-stage-ctl" }, [
          iconBtn("↑", i === 0, () => move(i, -1)),
          iconBtn("↓", i === editing.stages.length - 1, () => move(i, 1)),
          el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "✕", onclick: () => { editing.stages.splice(i, 1); paint(); } }),
        ]),
      ]);
    };

    const editorPanel = () => {
      const stages = el("div", { class: "sec-stages" }, editing.stages.map((s, i) => stageRow(s, i)));
      if (!editing.stages.length) stages.appendChild(el("div", { class: "sec-muted", text: "No stages. Add the first action below." }));
      const addSel = selectEl(stageTypes, "", (v) => {
        if (!v) return;
        if (editing.stages.length >= 6) { toast("A chain may have at most 6 stages.", "err"); return; }
        editing.stages.push({ type: v, params: {}, on_failure: "continue", delay: null, duration: null }); paint();
      }, "+ Add stage…");
      const nameIn = el("input", { class: "sec-input", value: editing.name || "", placeholder: "Chain name" });
      nameIn.addEventListener("input", () => { editing.name = nameIn.value; });
      return el("div", { class: "sec-card sec-chain-editor" }, [
        el("div", { class: "sec-page-title" }, [`Edit chain — ${editing.trigger_key} `, badge(editing.mode, "muted")]),
        el("p", { class: "sec-muted", text: "This chain runs when this module triggers. Reorder stages, set a delay before a stage, a duration for timed actions (timeout/lock), and whether a failed stage continues or aborts the chain. The module and mode are fixed." }),
        el("div", { class: "sec-settings-row" }, [el("div", { class: "k" }, ["Name"]), nameIn]),
        el("div", { class: "sec-chain-stages-head", text: "Stages" }),
        stages,
        el("div", { class: "sec-actions", style: "margin-top:10px" }, [addSel]),
        el("div", { class: "sec-modal-actions", style: "margin-top:14px" }, [
          el("button", { class: "sec-btn sec-btn-ghost", text: "Cancel", onclick: () => { editing = null; paint(); } }),
          el("button", { class: "sec-btn sec-btn-primary", text: "Save chain", onclick: saveChain }),
        ]),
      ]);
    };

    const chainCard = (c) => el("div", { class: "sec-card sec-chain-card" }, [
      el("div", { class: "sec-chain-main" }, [
        el("div", { class: "sec-chain-title" }, [
          el("strong", { text: c.trigger_key }), " ", badge(c.mode, "muted"), " ",
          badge(c.is_system ? "default" : "customized", c.is_system ? "muted" : "ok"),
          " ", info(moduleDesc(c.trigger_key)),
        ]),
        el("div", { class: "sec-muted", text: c.name }),
        el("div", { class: "sec-chain-flow", text: c.stages.map((s) => s.type).join(" → ") || "no stages" }),
      ]),
      el("div", { class: "sec-chain-ctl" }, canEdit ? [el("button", { class: "sec-btn sec-btn-sm", text: "Edit stages", onclick: () => openEdit(c) })] : [el("span", { class: "sec-muted", text: "read-only" })]),
    ]);

    const paint = () => {
      const body = root.querySelector("#pun-body");
      if (editing) { body.replaceChildren(editorPanel()); return; }
      if (!chains.length) {
        body.replaceChildren(emptyCard({
          title: "No chains configured yet",
          message: "Punishment chains are created from defaults when you run setup. Open the Security Center wizard (or press Seed Defaults) to create the per-module chains, then edit their stages here.",
        }));
        return;
      }
      body.replaceChildren(...chains.map(chainCard));
    };

    root.appendChild(pageHeader("Punishments", "One predefined chain per module — edit its stages here. To build custom automations, use SOC Rules."));
    root.appendChild(el("div", { id: "pun-body" }));
    paint();
  },
};

// ---- builders ---------------------------------------------------------- #
function selectEl(options, value, onChange, placeholder = null) {
  const sel = el("select", { class: "sec-select" });
  if (placeholder != null) sel.appendChild(el("option", { value: "", text: placeholder }));
  for (const o of options) { const opt = el("option", { value: o, text: o }); if (o === value) opt.selected = true; sel.appendChild(opt); }
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}
function numEl(value, placeholder, onChange) {
  const inp = el("input", { class: "sec-input sec-input-num", type: "number", min: "0", placeholder, value: value == null ? "" : value });
  inp.addEventListener("input", () => onChange(inp.value));
  return inp;
}
function iconBtn(label, disabled, onClick) { return el("button", { class: "sec-btn sec-btn-sm", disabled: disabled || undefined, text: label, onclick: onClick }); }
function labelWrap(label, node) { return el("label", { class: "sec-stage-opt" }, [el("span", { class: "sec-stage-opt-l", text: label }), node]); }
