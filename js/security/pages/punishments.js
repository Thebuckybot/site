import { api } from "../api.js";
import { el, pageHeader, badge, toast, errorState, confirmDialog, info, emptyCard } from "../ui.js";
import { getRegistry } from "../registry.js";
import { stageDesc, moduleDesc } from "../descriptions.js";

// Full punishment-chain editor: create / edit / duplicate / delete chains, and
// add / remove / reorder stages with per-stage delay, duration and on-failure.
// The backend validates every stage (unknown type / bad on_failure -> 400), so
// this UI is convenience over an authoritative server.
export default {
  async render(root) {
    let chains = [], reg = null, canEdit = false;
    let editing = null; // {trigger_key, mode, name, stages:[...], isNew, id}

    try {
      [chains, reg, { can_edit: canEdit }] = await Promise.all([
        api.get("/punishments"), getRegistry(), api.me().catch(() => ({ can_edit: false })),
      ]);
    } catch (err) { return errorState(root, err, () => this.render(root)); }

    const moduleKeys = (reg.modules || []).map((m) => m.key || m);
    const stageTypes = reg.stages || [];
    const modes = reg.modes || ["normal", "hard", "both"];
    const onFailures = reg.on_failure || ["continue", "abort"];

    const reload = async () => { chains = await api.get("/punishments"); paint(); };

    // ---- persistence ---------------------------------------------------- #
    const saveChain = async () => {
      if (!editing) return;
      if (!editing.trigger_key) { toast("Pick a trigger module.", "err"); return; }
      if (!editing.stages.length) { toast("A chain needs at least one stage.", "err"); return; }
      const payload = {
        trigger_key: editing.trigger_key,
        mode: editing.mode,
        name: editing.name || editing.trigger_key,
        stages: editing.stages.map((s) => ({
          type: s.type,
          params: s.params || {},
          on_failure: s.on_failure || "continue",
          delay: s.delay === "" || s.delay == null ? null : Number(s.delay),
          duration: s.duration === "" || s.duration == null ? null : Number(s.duration),
        })),
      };
      try {
        await api.post("/punishment", payload);
        toast("Chain saved."); editing = null; await reload();
      } catch (e) { toast(e.message, "err"); }
    };

    const deleteChain = async (c) => {
      if (c.is_system) { toast("Shipped templates cannot be deleted — edit or duplicate instead.", "err"); return; }
      if (!(await confirmDialog({ title: "Delete chain", message: `Delete the ${c.trigger_key} (${c.mode}) chain? The module falls back to its default response.`, danger: true, confirmLabel: "Delete" }))) return;
      try { await api.del(`/punishment/${c.id}`); toast("Chain deleted."); await reload(); }
      catch (e) { toast(e.message, "err"); }
    };

    // ---- editor state helpers ------------------------------------------ #
    const newChain = () => { editing = { trigger_key: "", mode: "both", name: "", stages: [], isNew: true }; paint(); };
    const openEdit = (c) => { editing = { trigger_key: c.trigger_key, mode: c.mode, name: c.name, stages: c.stages.map((s) => ({ ...s })), isNew: false, id: c.id }; paint(); };
    const duplicate = (c) => { editing = { trigger_key: "", mode: c.mode, name: c.name + " (copy)", stages: c.stages.map((s) => ({ ...s })), isNew: true }; paint(); toast("Pick a different trigger for the copy."); };

    // ---- rendering ------------------------------------------------------ #
    const stageRow = (s, i) => {
      const typeSel = selectEl(stageTypes, s.type, (v) => { s.type = v; });
      const failSel = selectEl(onFailures, s.on_failure || "continue", (v) => { s.on_failure = v; });
      const delay = numEl(s.delay, "delay s", (v) => { s.delay = v; });
      const dur = numEl(s.duration, "duration s", (v) => { s.duration = v; });
      const up = iconBtn("↑", i === 0, () => { move(i, -1); });
      const down = iconBtn("↓", i === editing.stages.length - 1, () => { move(i, 1); });
      const rm = el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "✕", onclick: () => { editing.stages.splice(i, 1); paint(); } });
      return el("div", { class: "sec-stage-row" }, [
        el("span", { class: "sec-stage-num", text: String(i + 1) }),
        el("div", { class: "sec-stage-main" }, [
          el("div", { class: "sec-stage-type" }, [typeSel, info(stageDesc(s.type))]),
          el("div", { class: "sec-stage-opts" }, [
            labelWrap("On fail", failSel), labelWrap("Delay", delay), labelWrap("Duration", dur),
          ]),
        ]),
        el("div", { class: "sec-stage-ctl" }, [up, down, rm]),
      ]);
    };

    const move = (i, d) => {
      const j = i + d;
      if (j < 0 || j >= editing.stages.length) return;
      const [x] = editing.stages.splice(i, 1);
      editing.stages.splice(j, 0, x); paint();
    };

    const editorPanel = () => {
      const trigSel = selectEl(moduleKeys, editing.trigger_key, (v) => { editing.trigger_key = v; }, !editing.isNew, "Select trigger module…");
      const modeSel = selectEl(modes, editing.mode, (v) => { editing.mode = v; });
      const nameIn = el("input", { class: "sec-input", value: editing.name || "", placeholder: "Chain name" });
      nameIn.addEventListener("input", () => { editing.name = nameIn.value; });

      const stages = el("div", { class: "sec-stages" }, editing.stages.map((s, i) => stageRow(s, i)));
      if (!editing.stages.length) stages.appendChild(el("div", { class: "sec-muted", text: "No stages yet. Add the first action below." }));

      const addSel = selectEl(stageTypes, "", (v) => {
        if (!v) return;
        editing.stages.push({ type: v, params: {}, on_failure: "continue", delay: null, duration: null });
        paint();
      }, false, "+ Add stage…");

      return el("div", { class: "sec-card sec-chain-editor" }, [
        el("div", { class: "sec-page-title", text: editing.isNew ? "New punishment chain" : `Edit chain — ${editing.trigger_key} (${editing.mode})` }),
        el("p", { class: "sec-muted", text: "WHEN this trigger fires, run these stages in order. Delay waits before a stage; Duration applies to timed actions (timeout/lock). On-fail decides whether to continue or abort the chain." }),
        el("div", { class: "sec-settings-row" }, [el("div", { class: "k" }, ["Trigger ", info("The module/event whose detection runs this chain.")]), trigSel]),
        el("div", { class: "sec-settings-row" }, [el("div", { class: "k" }, ["Mode ", info("Which detection mode this chain applies to (Normal, Hard, or Both).")]), modeSel]),
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

    const chainCard = (c) => {
      const flow = c.stages.map((s) => s.type).join(" → ") || "no stages";
      const ctl = [];
      if (canEdit) {
        ctl.push(el("button", { class: "sec-btn sec-btn-sm", text: "Edit", onclick: () => openEdit(c) }));
        ctl.push(el("button", { class: "sec-btn sec-btn-sm", text: "Duplicate", onclick: () => duplicate(c) }));
        if (!c.is_system) ctl.push(el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "Delete", onclick: () => deleteChain(c) }));
      }
      return el("div", { class: "sec-card sec-chain-card" }, [
        el("div", { class: "sec-chain-main" }, [
          el("div", { class: "sec-chain-title" }, [
            el("strong", { text: c.trigger_key }), " ", badge(c.mode, "muted"), " ",
            badge(c.is_system ? "template" : "custom", c.is_system ? "ok" : "muted"),
            " ", info(moduleDesc(c.trigger_key)),
          ]),
          el("div", { class: "sec-muted", text: c.name }),
          el("div", { class: "sec-chain-flow", text: flow }),
        ]),
        el("div", { class: "sec-chain-ctl" }, ctl),
      ]);
    };

    const paint = () => {
      const body = root.querySelector("#pun-body");
      const kids = [];
      if (canEdit && !editing) kids.push(el("div", { class: "sec-actions", style: "margin-bottom:12px" }, [
        el("button", { class: "sec-btn sec-btn-primary", text: "+ New Chain", onclick: newChain }),
      ]));
      if (editing) kids.push(editorPanel());
      if (!chains.length && !editing) {
        kids.push(emptyCard({ title: "No punishment chains yet", message: "Chains decide what Security does when a module triggers — e.g. Anti-Spam → delete messages → timeout → log. Create one, or rely on the shipped defaults.", actionLabel: canEdit ? "New Chain" : null, onAction: newChain }));
      } else if (!editing) {
        for (const c of chains) kids.push(chainCard(c));
      }
      body.replaceChildren(...kids);
    };

    root.appendChild(pageHeader("Punishments", "Ordered action chains run when a module triggers. Create, edit, reorder and configure every stage — the backend validates all of it."));
    root.appendChild(el("div", { id: "pun-body" }));
    paint();
  },
};

// ---- small builders --------------------------------------------------- #
function selectEl(options, value, onChange, disabled = false, placeholder = null) {
  const sel = el("select", { class: "sec-select", disabled: disabled || undefined });
  if (placeholder != null) sel.appendChild(el("option", { value: "", text: placeholder }));
  for (const o of options) {
    const opt = el("option", { value: o, text: o });
    if (o === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}
function numEl(value, placeholder, onChange) {
  const inp = el("input", { class: "sec-input sec-input-num", type: "number", min: "0", placeholder, value: value == null ? "" : value });
  inp.addEventListener("input", () => onChange(inp.value));
  return inp;
}
function iconBtn(label, disabled, onClick) {
  return el("button", { class: "sec-btn sec-btn-sm", disabled: disabled || undefined, text: label, onclick: onClick });
}
function labelWrap(label, node) {
  return el("label", { class: "sec-stage-opt" }, [el("span", { class: "sec-stage-opt-l", text: label }), node]);
}
