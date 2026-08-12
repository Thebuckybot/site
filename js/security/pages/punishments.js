import { api } from "../api.js";
import { el, pageHeader, badge, toast, errorState, info, emptyCard } from "../ui.js";
import { getRegistry } from "../registry.js";
import { stageDesc, moduleDesc, antibotStageDesc, ANTIBOT_TARGET_LABEL, ANTIBOT_TARGET_DESC } from "../descriptions.js";

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

    // SV2-FIN-002: structural-only stages (e.g. snapshot_rollback) are offered ONLY
    // on structural modules (Anti-Nuke, mass channel/role/permission changes). The
    // contract comes from the registry — never hardcoded here — and the backend
    // re-validates. An existing legacy value is still shown so editing never drops it.
    const structuralOnly = new Set(reg.structural_only_stages || []);
    const structuralCats = new Set(reg.structural_module_categories || ["structure"]);
    const moduleCat = (key) => { const m = (reg.modules || []).find((x) => x.key === key); return m && m.category; };
    const isStructuralModule = () => editing && structuralCats.has(moduleCat(editing.trigger_key));
    const allowedStages = (currentType) => {
      let base = stageTypes;
      if (editing && !isStructuralModule()) base = stageTypes.filter((s) => !structuralOnly.has(s));
      if (currentType && !base.includes(currentType)) return [currentType, ...base];  // keep legacy value
      return base;
    };

    // SV2-MAN-003: Anti-Bot explicit-target contract (from the registry — never
    // hardcoded here). A targetable stage in an anti_bots chain MUST pick a target;
    // the dropdown only offers targets valid for that stage type.
    const antibotTargets = reg.antibot_targets || [];
    const antibotTargetActions = reg.antibot_target_actions || {};
    const antibotTargetable = new Set(reg.antibot_targetable_stages || []);
    const legacyTarget = reg.antibot_legacy_default_target || "added_bot";
    const isAntiBot = () => editing && editing.trigger_key === "anti_bots";
    const targetableHere = (type) => isAntiBot() && antibotTargetable.has(type);
    const validTargetsFor = (type) => antibotTargets.filter(
      (t) => (antibotTargetActions[t] || []).includes(type));

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

    // SV2-MAN-001: `params.seconds` is the RETIRED legacy timeout-duration key.
    // When loading a not-yet-normalized chain, surface the legacy value as the
    // canonical stage-level duration so the editor shows what actually executes,
    // and drop the legacy key so saving can never re-persist a hidden override.
    const normalizeStage = (s, triggerKey) => {
      const st = { ...s, params: { ...(s.params || {}) } };
      if (st.type === "timeout" && st.params.seconds != null) {
        if (st.duration == null) st.duration = Number(st.params.seconds);
        delete st.params.seconds;
      }
      // SV2-MAN-003 legacy compatibility: a targetable anti_bots stage saved
      // before explicit targets existed defaults to the ADDED BOT — so the editor
      // shows exactly who it acts on and a save can never silently change it.
      if (triggerKey === "anti_bots" && antibotTargetable.has(st.type)
          && (st.target == null || st.target === "")) {
        st.target = legacyTarget;
      }
      return st;
    };

    // ---- persistence (edit the EXISTING chain only) --------------------- #
    const saveChain = async () => {
      if (!editing || !editing.stages.length) { toast("A chain needs at least one stage.", "err"); return; }
      const payload = {
        trigger_key: editing.trigger_key,   // locked - never changes
        mode: editing.mode,                 // locked - part of the identity
        name: editing.name || editing.trigger_key,
        stages: editing.stages.map((s) => {
          const params = { ...(s.params || {}) };
          if (s.type === "timeout") delete params.seconds; // retired legacy key - never re-persist
          const out = {
            type: s.type, params, on_failure: s.on_failure || "continue",
            delay: s.delay === "" || s.delay == null ? null : Number(s.delay),
            duration: s.duration === "" || s.duration == null ? null : Number(s.duration),
          };
          // Persist an explicit target only for anti_bots targetable stages.
          if (editing.trigger_key === "anti_bots" && antibotTargetable.has(s.type) && s.target) {
            out.target = s.target;
          }
          return out;
        }),
      };
      try { await api.post("/punishment", payload); toast("Chain saved."); editing = null; await reload(); }
      catch (e) { toast(e.message, "err"); }
    };

    const openEdit = (c) => { editing = { trigger_key: c.trigger_key, mode: c.mode, name: c.name, id: c.id, stages: c.stages.map((s) => normalizeStage(s, c.trigger_key)) }; paint(); };

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

    // Ensure a targetable anti_bots stage always carries a VALID target for its type.
    const fixTarget = (s) => {
      if (!targetableHere(s.type)) { delete s.target; return; }
      const valid = validTargetsFor(s.type);
      if (!valid.includes(s.target)) s.target = valid[0] || legacyTarget;
    };

    const stageRow = (s, i) => {
      const typeSel = selectEl(allowedStages(s.type), s.type, (v) => {
        s.type = v;
        if (!supportsDuration(v)) s.duration = null;   // drop meaningless duration
        fixTarget(s);                                  // reset target to a valid one
        paint();                                       // re-render so fields match the stage
      });
      const failSel = selectEl(onFailures, s.on_failure || "continue", (v) => { s.on_failure = v; });
      const delay = numEl(s.delay, "sec", (v) => { s.delay = v; });
      const opts = [labelWrap("On fail", failSel), labelWrap("Delay (s)", delay)];
      // SV2-MAN-003: explicit recipient selector for anti_bots targetable stages.
      // Only targets valid for this stage type are offered (no bad combinations).
      let targetNote = null;
      if (targetableHere(s.type)) {
        fixTarget(s);
        const valid = validTargetsFor(s.type);
        const targetSel = selectEl(valid.map((t) => ANTIBOT_TARGET_LABEL[t] || t), ANTIBOT_TARGET_LABEL[s.target] || s.target, (label) => {
          const picked = valid.find((t) => (ANTIBOT_TARGET_LABEL[t] || t) === label) || valid[0];
          s.target = picked; paint();
        });
        opts.push(labelWrap("Target", targetSel));
        targetNote = el("div", { class: "sec-muted", style: "margin-top:4px",
          text: ANTIBOT_TARGET_DESC[s.target] || "" });
      }
      // Duration ONLY for stages whose handler consumes it (server also enforces this).
      if (supportsDuration(s.type)) {
        const label = maxWhenEmpty(s.type) ? "Duration (empty = Discord max, ~28 days)"
          : "Duration (empty = permanent)";
        opts.push(labelWrap(label, durationField(s)));
      }
      const desc = targetableHere(s.type) ? antibotStageDesc(s.type, s.target) : stageDesc(s.type);
      return el("div", { class: "sec-stage-row" }, [
        el("span", { class: "sec-stage-num", text: String(i + 1) }),
        el("div", { class: "sec-stage-main" }, [
          el("div", { class: "sec-stage-type" }, [typeSel, info(desc)]),
          el("div", { class: "sec-stage-opts" }, opts),
          ...(targetNote ? [targetNote] : []),
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
      const addSel = selectEl(allowedStages(), "", (v) => {
        if (!v) return;
        if (editing.stages.length >= 6) { toast("A chain may have at most 6 stages.", "err"); return; }
        const st = { type: v, params: {}, on_failure: "continue", delay: null, duration: null };
        fixTarget(st);   // default a valid target if this is a targetable anti_bots stage
        editing.stages.push(st); paint();
      }, "+ Add stage…");
      const nameIn = el("input", { class: "sec-input", value: editing.name || "", placeholder: "Chain name" });
      nameIn.addEventListener("input", () => { editing.name = nameIn.value; });
      return el("div", { class: "sec-card sec-chain-editor" }, [
        el("div", { class: "sec-page-title" }, [`Edit chain - ${editing.trigger_key} `, badge(editing.mode, "muted")]),
        el("p", { class: "sec-muted", text: "This chain runs when this module triggers. Reorder stages, set a delay before a stage, a duration for timed actions (timeout/lock), and whether a failed stage continues or aborts the chain. The module and mode are fixed." }),
        el("p", { class: "sec-muted", text: "Timeout can never be permanent: an empty duration applies Discord's maximum (28 days, executed with a small safety margin below the hard cap). For indefinite containment use Quarantine or Ban instead." }),
        ...(isAntiBot() ? [el("div", { class: "sec-callout", style: "border-left:3px solid #7aa2f7;padding:8px 12px;margin:8px 0;background:rgba(122,162,247,.08)" }, [
          el("strong", { text: "Anti-Bot targets two different entities." }),
          el("p", { class: "sec-muted", style: "margin:6px 0 0", text: "Every removal/containment stage must say WHO it acts on: the Added Bot (the bot that joined) or the Responsible Member (the human who added it). The Responsible Member is only known when Discord's audit log identifies them - if attribution is unresolved, Responsible-Member stages are SKIPPED and never fall back to the bot. Choose 'Added Bot' to remove the unauthorized bot; choose 'Responsible Member' to punish the human." }),
        ])] : []),
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
        el("div", { class: "sec-chain-flow", text: c.stages.map((s) => {
          const label = (c.trigger_key === "anti_bots" && s.target) ? `${s.type}→${ANTIBOT_TARGET_LABEL[s.target] || s.target}` : s.type;
          return label;
        }).join("  ·  ") || "no stages" }),
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

    root.appendChild(pageHeader("Punishments", "One predefined chain per module - edit its stages here. To build custom automations, use SOC Rules."));
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
