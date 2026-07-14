import { api } from "../api.js";
import { el, pageHeader, table, badge, toast, errorState, confirmDialog, emptyCard } from "../ui.js";
import { validJobId, isTerminal, pollOutcome } from "./recovery_poll.js";

// SV2-MAN-005 (final): Rollback is the ONLY recovery EXECUTION surface.
// Flow: usable baseline -> POST /recovery/plan returns a REAL durable job id ->
// poll GET /recovery/job/<id> -> preview -> confirm -> execute -> monitor.
// The frontend NEVER invents/falls back an id and never polls 0/null/NaN.
const JOB_TONE = { submitting: "muted", planned: "muted", queued: "muted", running: "muted",
                   succeeded: "ok", partial: "warn", failed: "bad", stale: "bad", cancelled: "muted" };
const MAX_POLLS = 40;   // ~2 min at 3s

export default {
  async render(root) {
    let pollTimer = null;
    let attempts = 0;
    let job = null;                      // { id, status, ... } | null
    const stop = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

    let payload, perms;
    try {
      [payload, perms] = await Promise.all([api.get("/snapshots"), api.me().catch(() => ({ can_edit: false }))]);
    } catch (err) { return errorState(root, err, () => this.render(root)); }

    const canEdit = !!(perms && perms.can_edit);
    const hasUsable = !!(payload && payload.has_usable)
      || (payload && Array.isArray(payload.snapshots) && payload.snapshots.some((s) => s && s.usable));

    root.appendChild(pageHeader("Rollback",
      "Restore the server's structure from a usable snapshot after an attack. Preview the exact changes before anything runs — recovery never deletes resources that are merely missing from the snapshot, and recreated channels/roles receive new Discord ids."));
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
      const btn = el("button", { class: "sec-btn sec-btn-primary", text: "Generate Recovery Preview" });
      btn.addEventListener("click", () => startPreview(btn));
      body.replaceChildren(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "Generate a recovery preview" }),
        el("p", { class: "sec-muted", text: "Builds a side-effect-free diff between the latest usable baseline and the current server. No changes are made until you review and confirm." }),
        el("div", { class: "sec-actions" }, [btn, el("a", { class: "sec-btn", href: "#snapshots", text: "View Snapshots" })]),
      ]));
    };

    const startPreview = async (btn) => {
      if (job) return;                          // one operation at a time (idempotent clicks)
      if (btn) btn.disabled = true;
      job = { id: null, status: "submitting" };
      renderJob();
      try {
        const r = await api.post("/recovery/plan", {});
        const id = r && r.job_id;
        if (!validJobId(id)) {
          job = { id: null, status: "failed", error: "The server did not return a valid recovery job id — please retry." };
          renderJob(); return;
        }
        job = { id: Number(id), status: r.status || "planned" };
        renderJob(); pollJob();
      } catch (e) {
        job = { id: null, status: "failed", error: e.message || "Could not start the recovery preview." };
        renderJob();
      }
    };

    const pollJob = () => {
      stop(); attempts = 0;
      if (!validJobId(job && job.id)) return;   // NEVER poll a bad id (no /job/0)
      pollTimer = setInterval(async () => {
        if (!job || !validJobId(job.id) || !document.body.contains(body)) { stop(); return; }
        if (attempts++ >= MAX_POLLS) {
          stop(); job = { ...job, status: "failed", error: "Timed out waiting for the recovery job." }; renderJob(); return;
        }
        let j, err = null;
        try { j = await api.get(`/recovery/job/${job.id}`); } catch (e) { err = e; }
        const outcome = pollOutcome({ error: err, job: j });
        if (outcome === "stop-404") {
          stop(); job = { ...job, status: "failed", error: "Recovery job not found — stopping." }; renderJob(); return;
        }
        if (outcome === "retry") return;                 // transient (network/5xx): retry until MAX_POLLS
        if (outcome === "stop-malformed") {
          stop(); job = { ...job, status: "failed", error: "Malformed recovery job response — stopping." }; renderJob(); return;
        }
        job = j; renderJob();
        if (outcome === "terminal") stop();
      }, 3000);
    };

    const confirmExec = async () => {
      if (!validJobId(job && job.id)) { toast("No valid recovery job.", "err"); return; }
      const ids = (job.operations || []).map((o) => o.op_id);
      if (!ids.length) { toast("Nothing to recover.", "err"); return; }
      if (!(await confirmDialog({ title: "Execute recovery",
        message: `Recreate/restore ${ids.length} structural item(s) from snapshot #${job.snapshot_id}? Recreated resources get NEW ids. Nothing is deleted.`,
        danger: true, confirmLabel: "Recover" }))) return;
      try {
        await api.post(`/recovery/job/${job.id}/confirm`, { operation_ids: ids });
        toast("Recovery queued — the bot is executing.");
        job = { ...job, status: "queued" }; renderJob(); pollJob();
      } catch (e) { toast(e.message, "err"); }
    };

    const renderJob = () => {
      const parts = [];
      const idText = validJobId(job && job.id) ? `#${job.id}` : "(pending id)";
      parts.push(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title" }, [`Recovery job ${idText} `,
          badge(job.status || "?", JOB_TONE[job.status] || "muted"),
          job.snapshot_id != null ? el("span", { class: "sec-muted" }, [` snapshot #${job.snapshot_id}`]) : null]),
        job.error ? el("p", { class: "sec-muted", text: job.error }) : null,
      ]));
      const ops = job.operations || [];
      if (job.status === "submitting") {
        parts.push(el("p", { class: "sec-muted", text: "Submitting…" }));
      } else if (job.status === "planned" && ops.length) {
        parts.push(el("p", { class: "sec-muted", text: `${ops.length} supported operation(s):` }));
        parts.push(table([
          { label: "Operation", render: (o) => o.type || "?" },
          { label: "Target", render: (o) => (o.target && (o.target.name || o.target.kind)) || "—" },
        ], ops));
        if ((job.unsupported || []).length) parts.push(el("p", { class: "sec-muted", text: `${job.unsupported.length} unsupported difference(s) (e.g. managed resources) — not recoverable.` }));
        if ((job.extras || []).length) parts.push(el("p", { class: "sec-muted", text: `${job.extras.length} live resource(s) not in the snapshot will be KEPT (never deleted).` }));
        parts.push(el("div", { class: "sec-actions", style: "margin-top:8px" }, [
          (() => { const b = el("button", { class: "sec-btn sec-btn-primary", text: "Confirm & Execute" }); b.addEventListener("click", confirmExec); return b; })(),
          (() => { const b = el("button", { class: "sec-btn sec-btn-ghost", text: "Cancel" }); b.addEventListener("click", renderIdle); return b; })(),
        ]));
      } else if (job.status === "planned") {
        parts.push(el("p", { class: "sec-muted", text: "Generating preview… this page updates automatically." }));
      } else if (job.status === "queued" || job.status === "running") {
        parts.push(el("p", { class: "sec-muted", text: "Executing on the bot… this page updates automatically." }));
      } else {
        // terminal (succeeded / partial / failed / stale / cancelled)
        const v = job.verification || {};
        if (job.status && isTerminal(job.status)) {
          parts.push(el("p", { class: "sec-muted", text: `Result: ${job.status}. Succeeded ${v.succeeded || 0} / ${v.total || 0}; remaining ${v.remaining_operations != null ? v.remaining_operations : "?"}.` }));
        }
        const results = (job.result && job.result.operations) || [];
        if (results.length) parts.push(table([
          { label: "Operation", render: (o) => o.type || "?" },
          { label: "Status", render: (o) => badge(o.status || "?", o.status === "success" ? "ok" : o.status === "failed" ? "bad" : "muted") },
          { label: "New id", render: (o) => (o.new_id ? el("code", { text: o.new_id }) : "—") },
          { label: "Reason", render: (o) => el("span", { class: "sec-muted", text: o.reason || "" }) },
        ], results));
        parts.push(el("div", { class: "sec-actions", style: "margin-top:8px" }, [
          (() => { const b = el("button", { class: "sec-btn sec-btn-ghost", text: "New recovery" }); b.addEventListener("click", renderIdle); return b; })(),
        ]));
      }
      body.replaceChildren(...parts);
    };

    renderIdle();
  },
};
