import { api } from "../api.js";
import { el, pageHeader, table, badge, toast, errorState, confirmDialog, emptyCard, alertBox } from "../ui.js";
import { validJobId, isTerminal, pollOutcome } from "./recovery_poll.js";

// SV2-MAN-006: the central RESTORE console — the ONLY structural execution surface.
// Flow: select snapshot (recommended usable) -> select mode (Safe Repair | Full
// Restore) -> POST /recovery/plan{restore_mode} -> poll job -> PREVIEW (visual
// impact diff) -> confirm (strong destructive confirmation for Full Restore) ->
// execute -> monitor -> convergence. Truthful wording throughout: "no repair
// operations" is never rendered as "matches snapshot" when extras exist.
const JOB_TONE = { submitting: "muted", planned: "muted", previewed: "muted", queued: "muted",
                   running: "muted", succeeded: "ok", partial: "warn", failed: "bad",
                   stale: "bad", cancelled: "muted" };
const MODE_LABEL = { safe_repair: "Safe Repair", full_restore: "Full Restore" };
const CONV_LABEL = { exact: "Exact match", converged_with_limitations: "Converged (with limitations)",
                     partial: "Partial", failed: "Failed", stale: "Stale (server changed)" };
const CONV_TONE = { exact: "ok", converged_with_limitations: "warn", partial: "warn",
                    failed: "bad", stale: "bad" };
const MAX_POLLS = 40;   // ~2 min at 3s

// ---- visual impact diff (Snapshot -> Current) --------------------------- #
const IMPACT_CELLS = [
  ["create", "Create", "ok", "resources recreated from the snapshot"],
  ["restore", "Restore", "ok", "settings / permissions corrected"],
  ["move", "Move", "muted", "position / parent restored (best-effort)"],
  ["delete", "Delete", "bad", "live extras removed (Full Restore only)"],
  ["blocked", "Blocked", "warn", "ambiguous / unsafe — not run"],
  ["unsupported", "Unsupported", "muted", "cannot be faithfully restored"],
  ["protected_kept", "Kept", "muted", "extras kept / protected"],
];

function impactBar(impact) {
  const i = impact || {};
  return el("div", { class: "sec-grid sec-grid-4", style: "gap:8px;margin:8px 0" },
    IMPACT_CELLS.map(([key, label, tone, desc]) =>
      el("div", { class: "sec-card sec-stat", title: desc }, [
        el("span", { class: "value" }, [badge(String(i[key] || 0), (i[key] ? tone : "muted"))]),
        el("span", { class: "label", text: label }),
      ])));
}

// ---- strong destructive confirmation (Full Restore) --------------------- #
function strongConfirm({ guildName, deleteCount, affected, snapshotId }) {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "sec-modal-overlay",
      style: "position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999" });
    const nameInput = el("input", { class: "sec-input", type: "text", placeholder: guildName || "server name" });
    const tokenInput = el("input", { class: "sec-input", type: "text", placeholder: "RESTORE" });
    const ack = el("input", { type: "checkbox" });
    const err = el("p", { class: "sec-muted", style: "color:#e06c75;min-height:1em" });
    const go = el("button", { class: "sec-btn sec-btn-danger", text: `Delete ${deleteCount} & Restore` });
    const cancel = el("button", { class: "sec-btn sec-btn-ghost", text: "Cancel" });
    const close = (val) => { document.body.removeChild(overlay); resolve(val); };
    go.addEventListener("click", () => {
      if (guildName && nameInput.value.trim() !== guildName) { err.textContent = "Server name does not match."; return; }
      if (tokenInput.value.trim() !== "RESTORE") { err.textContent = "Type RESTORE to confirm."; return; }
      if (!ack.checked) { err.textContent = "You must acknowledge the deletion."; return; }
      close({ typed_name: nameInput.value.trim(), token: tokenInput.value.trim(),
              delete_ack: true, delete_count: deleteCount });
    });
    cancel.addEventListener("click", () => close(null));
    overlay.appendChild(el("div", { class: "sec-card", style: "max-width:520px;width:92%" }, [
      el("div", { class: "sec-page-title" }, ["⚠ Full Restore — destructive ", badge(`${deleteCount} delete`, "bad")]),
      el("p", { class: "sec-muted", text: `This will restore the server toward snapshot #${snapshotId} and permanently DELETE ${deleteCount} live resource(s) that are absent from it. ${affected || 0} resource(s) are affected in total. Managed, protected and ambiguous resources are never deleted.` }),
      el("label", { class: "sec-muted", text: `Type the server name (${guildName || "unknown"}) to continue:` }), nameInput,
      el("label", { class: "sec-muted", text: "Type RESTORE:" }), tokenInput,
      el("label", { class: "sec-muted", style: "display:flex;gap:8px;align-items:center;margin-top:8px" },
        [ack, `I understand ${deleteCount} resource(s) will be permanently deleted.`]),
      err,
      el("div", { class: "sec-actions", style: "margin-top:8px" }, [go, cancel]),
    ]));
    document.body.appendChild(overlay);
  });
}

export default {
  async render(root) {
    let pollTimer = null;
    let attempts = 0;
    let job = null;
    let mode = "safe_repair";
    const stop = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

    let payload, perms;
    try {
      [payload, perms] = await Promise.all([api.get("/snapshots"), api.me().catch(() => ({ can_edit: false }))]);
    } catch (err) { return errorState(root, err, () => this.render(root)); }

    const canEdit = !!(perms && perms.can_edit);
    const snaps = (payload && Array.isArray(payload.snapshots)) ? payload.snapshots : [];
    const hasUsable = !!(payload && payload.has_usable) || snaps.some((s) => s && s.usable);
    const hasFrEligible = snaps.some((s) => s && s.fr_eligible);

    root.appendChild(pageHeader("Restore",
      "Restore the server's structure from a trusted snapshot after an attack or mistake. Preview the exact changes before anything runs. Safe Repair never deletes; Full Restore can delete live resources absent from the snapshot after explicit confirmation."));
    const body = el("div", { id: "rb-body" });
    root.appendChild(body);

    const renderIdle = () => {
      stop(); job = null;
      if (!hasUsable) {
        body.replaceChildren(emptyCard({ title: "Recovery unavailable",
          message: "There is no usable (healthy) recovery baseline yet. Capture one on Snapshots — incident/legacy snapshots are never used as a baseline.",
          actionLabel: "View Snapshots", onAction: () => { window.location.hash = "#snapshots"; } }));
        return;
      }
      if (!canEdit) {
        body.replaceChildren(el("div", { class: "sec-card" }, [el("p", { class: "sec-muted", text: "Read-only — only the Server Owner or a Trusted Administrator can run recovery." })]));
        return;
      }
      // mode selector
      const mkMode = (key, title, desc, disabled) => {
        const r = el("input", { type: "radio", name: "rb-mode", value: key });
        if (key === mode && !disabled) r.checked = true;
        if (disabled) r.disabled = true;
        r.addEventListener("change", () => { if (r.checked) mode = key; });
        return el("label", { class: "sec-settings-row", style: "align-items:flex-start;gap:8px" }, [
          r, el("div", {}, [el("strong", { text: title }),
            el("div", { class: "sec-muted", text: desc + (disabled ? " — no Full-Restore-eligible (v3) snapshot yet; capture a new one." : "") })]),
        ]);
      };
      const btn = el("button", { class: "sec-btn sec-btn-primary", text: "Generate Recovery Preview" });
      btn.addEventListener("click", () => startPreview(btn));
      body.replaceChildren(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "1 · Choose a restore mode" }),
        mkMode("safe_repair", "Safe Repair (recommended)",
          "Repairs missing or modified structure. Never deletes live resources that are absent from the snapshot — they are reported and kept.", false),
        mkMode("full_restore", "Full Restore (destructive)",
          "Returns supported structure toward the snapshot. Eligible live resources absent from the snapshot MAY be deleted after Preview and an explicit confirmation.", !hasFrEligible),
        el("div", { class: "sec-actions", style: "margin-top:10px" }, [btn, el("a", { class: "sec-btn", href: "#snapshots", text: "View Snapshots" })]),
      ]));
    };

    const startPreview = async (btn) => {
      if (job) return;
      if (btn) btn.disabled = true;
      job = { id: null, status: "submitting" };
      renderJob();
      try {
        const r = await api.post("/recovery/plan", { restore_mode: mode });
        const id = r && r.job_id;
        if (!validJobId(id)) {
          job = { id: null, status: "failed", error: "The server did not return a valid recovery job id — please retry." };
          renderJob(); return;
        }
        job = { id: Number(id), status: r.status || "planned", restore_mode: r.restore_mode || mode };
        renderJob(); pollJob();
      } catch (e) {
        job = { id: null, status: "failed", error: e.message || "Could not start the recovery preview." };
        renderJob();
      }
    };

    const pollJob = () => {
      stop(); attempts = 0;
      if (!validJobId(job && job.id)) return;
      pollTimer = setInterval(async () => {
        if (!job || !validJobId(job.id) || !document.body.contains(body)) { stop(); return; }
        if (attempts++ >= MAX_POLLS) {
          stop(); job = { ...job, status: "failed", error: "Timed out waiting for the recovery job." }; renderJob(); return;
        }
        let j, err = null;
        try { j = await api.get(`/recovery/job/${job.id}`); } catch (e) { err = e; }
        const outcome = pollOutcome({ error: err, job: j });
        if (outcome === "stop-404") { stop(); job = { ...job, status: "failed", error: "Recovery job not found — stopping." }; renderJob(); return; }
        if (outcome === "retry") return;
        if (outcome === "stop-malformed") { stop(); job = { ...job, status: "failed", error: "Malformed recovery job response — stopping." }; renderJob(); return; }
        job = j; renderJob();
        if (outcome === "terminal" || outcome === "preview-ready") stop();
      }, 3000);
    };

    const confirmExec = async () => {
      if (!validJobId(job && job.id)) { toast("No valid recovery job.", "err"); return; }
      const ids = (job.operations || []).map((o) => o.op_id);
      if (!ids.length) { toast("Nothing to recover.", "err"); return; }
      const destructive = job.destructive === true || (job.restore_mode || mode) === "full_restore";
      let confBody = { operation_ids: ids, restore_mode: job.restore_mode || mode };
      if (destructive) {
        const impact = job.impact || {};
        const conf = await strongConfirm({ guildName: job.guild_name, deleteCount: impact.delete || 0,
          affected: impact.affected_total || 0, snapshotId: job.snapshot_id });
        if (!conf) return;
        confBody.confirmation = conf;
      } else if (!(await confirmDialog({ title: "Execute Safe Repair",
        message: `Recreate/restore ${ids.length} structural item(s) from snapshot #${job.snapshot_id}? Recreated resources get NEW ids. Nothing is deleted.`,
        danger: false, confirmLabel: "Repair" }))) return;
      try {
        await api.post(`/recovery/job/${job.id}/confirm`, confBody);
        toast("Recovery queued — the bot is executing.");
        job = { ...job, status: "queued" }; renderJob(); pollJob();
      } catch (e) { toast(e.message, "err"); }
    };

    const renderJob = () => {
      const parts = [];
      const idText = validJobId(job && job.id) ? `#${job.id}` : "(pending id)";
      const modeBadge = badge(MODE_LABEL[job.restore_mode || mode] || "Safe Repair",
        (job.restore_mode || mode) === "full_restore" ? "warn" : "muted");
      parts.push(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title" }, [`Recovery job ${idText} `, modeBadge, " ",
          badge(job.status || "?", JOB_TONE[job.status] || "muted"),
          job.snapshot_id != null ? el("span", { class: "sec-muted" }, [` snapshot #${job.snapshot_id}`]) : null]),
        job.error ? el("p", { class: "sec-muted", text: job.error }) : null,
      ]));
      const ops = job.operations || [];
      const blocked = job.blocked_operations || [];
      if (job.status === "submitting" || job.status === "planned") {
        parts.push(el("p", { class: "sec-muted",
          text: job.status === "submitting" ? "Submitting…" : "Generating preview… this page updates automatically." }));
      } else if (job.status === "previewed") {
        const noRepair = (job.no_recovery_needed === true) || (ops.length === 0 && blocked.length === 0);
        const extras = job.extras || [];
        const destructive = job.destructive === true || (job.restore_mode || mode) === "full_restore";
        const executable = (job.executable === true) || (job.executable == null && ops.length > 0 && blocked.length === 0);

        // visual impact diff
        parts.push(el("div", { class: "sec-card", style: "margin-top:8px" }, [
          el("div", { class: "sec-page-title", text: "Preview — Snapshot vs Current" }),
          impactBar(job.impact),
        ]));

        if (noRepair) {
          // TRUTHFUL wording — never "matches snapshot" when extras exist
          const msg = extras.length
            ? (destructive
              ? `No repair operations are required. ${extras.length} live resource(s) are absent from this snapshot and are eligible for deletion — but none were classified safe to delete (protected/ambiguous), so nothing will be removed.`
              : `No repair operations are required. ${extras.length} live resource(s) are absent from this snapshot and will be KEPT in Safe Repair mode.`)
            : "The current supported structure already matches this snapshot exactly — nothing to do.";
          parts.push(el("div", { class: "sec-card", style: "margin-top:8px" }, [el("p", { text: msg })]));
          parts.push(el("div", { class: "sec-actions", style: "margin-top:8px" }, [mkGhost("New recovery", renderIdle)]));
        } else {
          if (ops.length) {
            parts.push(el("p", { class: "sec-muted", text: `${ops.length} operation(s) will run:` }));
            parts.push(table([
              { label: "Operation", render: (o) => o.type || "?" },
              { label: "Target", render: (o) => (o.target && (o.target.name || o.target.kind)) || "—" },
              { label: "Change", render: (o) => el("span", { class: "sec-muted", text: o.change_class || "" }) },
            ], ops));
          }
          const deletes = ops.filter((o) => o.destructive);
          if (deletes.length) {
            parts.push(alertBox({ kind: "danger", message: el("strong", { text: `${deletes.length} resource(s) will be DELETED (Full Restore):` }) }));
            parts.push(table([
              { label: "Type", render: (o) => o.resource || "?" },
              { label: "Name", render: (o) => (o.target && o.target.name) || "—" },
              { label: "Live id", render: (o) => el("code", { text: (o.target && o.target.id) || "—" }) },
              { label: "Why extra", render: (o) => el("span", { class: "sec-muted", text: o.reason || "" }) },
            ], deletes));
          }
          if (blocked.length) {
            parts.push(alertBox({ kind: "warn", message: el("strong", { text: `${blocked.length} operation(s) are BLOCKED and will NOT run:` }) }));
            parts.push(table([
              { label: "Operation", render: (o) => o.type || "?" },
              { label: "Target", render: (o) => (o.target && (o.target.name || o.target.kind)) || "—" },
              { label: "Why", render: (o) => el("span", { class: "sec-muted", text: o.reason || o.safety || "" }) },
            ], blocked));
          }
          if ((job.unsupported || []).length) parts.push(el("p", { class: "sec-muted", text: `${job.unsupported.length} unsupported difference(s) — not recoverable.` }));
          if (extras.length && !deletes.length) parts.push(el("p", { class: "sec-muted", text: `${extras.length} live resource(s) not in the snapshot will be KEPT.` }));

          if (!executable) {
            parts.push(alertBox({ kind: "warn", message: blocked.length
              ? "This plan cannot be executed while it contains blocked operations (duplicate-identity or corrupted-name risk). Resolve them, then regenerate the preview."
              : "There is nothing safe to execute in this plan." }));
            parts.push(el("div", { class: "sec-actions", style: "margin-top:8px" }, [mkGhost("New recovery", renderIdle)]));
          } else {
            const runBtn = el("button", { class: `sec-btn ${destructive ? "sec-btn-danger" : "sec-btn-primary"}`,
              text: destructive ? "Confirm & Full Restore" : "Confirm & Repair" });
            runBtn.addEventListener("click", confirmExec);
            parts.push(el("div", { class: "sec-actions", style: "margin-top:8px" }, [runBtn, mkGhost("Cancel", renderIdle)]));
          }
        }
      } else if (job.status === "queued" || job.status === "running") {
        parts.push(el("p", { class: "sec-muted", text: `Executing on the bot${job.phase ? ` — ${job.phase}` : ""}… this page updates automatically.` }));
      } else {
        const v = job.verification || {};
        const conv = (job.convergence && job.convergence.result) || null;
        if (job.status && isTerminal(job.status)) {
          parts.push(el("div", { class: "sec-card", style: "margin-top:8px" }, [
            el("div", { class: "sec-page-title" }, ["Result ",
              conv ? badge(CONV_LABEL[conv] || conv, CONV_TONE[conv] || "muted") : badge(job.status, JOB_TONE[job.status] || "muted")]),
            el("p", { class: "sec-muted", text: `Succeeded ${v.succeeded || 0} / ${v.total || 0}; failed ${v.failed || 0}; remaining ${v.remaining_operations != null ? v.remaining_operations : "?"}${v.remaining_best_effort ? ` (+${v.remaining_best_effort} best-effort)` : ""}.` }),
          ]));
        }
        const results = (job.result && job.result.operations) || [];
        if (results.length) parts.push(table([
          { label: "Operation", render: (o) => o.type || "?" },
          { label: "Status", render: (o) => badge(o.status || "?", o.status === "success" ? "ok" : o.status === "failed" ? "bad" : "muted") },
          { label: "New id", render: (o) => (o.new_id ? el("code", { text: o.new_id }) : "—") },
          { label: "Reason", render: (o) => el("span", { class: "sec-muted", text: o.reason || "" }) },
        ], results));
        parts.push(el("div", { class: "sec-actions", style: "margin-top:8px" }, [mkGhost("New recovery", renderIdle)]));
      }
      body.replaceChildren(...parts);
    };

    const mkGhost = (text, fn) => { const b = el("button", { class: "sec-btn sec-btn-ghost", text }); b.addEventListener("click", fn); return b; };

    renderIdle();
  },
};
