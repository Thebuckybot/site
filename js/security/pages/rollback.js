import { api } from "../api.js";
import { el, pageHeader, table, badge, toast, errorState, confirmDialog, emptyCard } from "../ui.js";

// SV2-MAN-005 (final): Rollback is the ONLY recovery EXECUTION surface.
// Flow: select usable baseline -> generate side-effect-free preview (diff/plan) ->
// confirm -> execute durable job -> monitor. Snapshots page is view/inspect only.
const JOB_TONE = { succeeded: "ok", partial: "warn", running: "muted", queued: "muted",
                   planned: "muted", failed: "bad", stale: "bad", cancelled: "muted" };

export default {
  async render(root) {
    let pollTimer = null;
    const stop = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

    let payload, perms;
    try {
      [payload, perms] = await Promise.all([
        api.get("/snapshots"),
        api.me().catch(() => ({ can_edit: false })),
      ]);
    } catch (err) { return errorState(root, err, () => this.render(root)); }

    const canEdit = !!(perms && perms.can_edit);
    const hasUsable = !!(payload && payload.has_usable)
      || (payload && Array.isArray(payload.snapshots) && payload.snapshots.some((s) => s && s.usable));

    root.appendChild(pageHeader("Rollback",
      "Restore the server's structure from a usable snapshot after an attack. Preview the exact changes before anything is executed — recovery never deletes resources that are merely missing from the snapshot, and recreated channels/roles receive new Discord ids."));

    const body = el("div", { id: "rb-body" });
    root.appendChild(body);

    let job = null;

    const renderIdle = () => {
      stop();
      if (!hasUsable) {
        body.replaceChildren(emptyCard({
          title: "Recovery unavailable",
          message: "There is no usable (healthy) recovery baseline yet. Open Snapshots to capture one — incident/legacy snapshots are never used as a baseline.",
          actionLabel: "View Snapshots", onAction: () => { window.location.hash = "#snapshots"; },
        }));
        return;
      }
      if (!canEdit) {
        body.replaceChildren(el("div", { class: "sec-card" }, [
          el("p", { class: "sec-muted", text: "Read-only — only the Server Owner or a Trusted Administrator can run recovery." }),
        ]));
        return;
      }
      body.replaceChildren(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "Generate a recovery preview" }),
        el("p", { class: "sec-muted", text: "Builds a side-effect-free diff between the latest usable baseline and the current server. No changes are made until you review and confirm." }),
        el("div", { class: "sec-actions" }, [
          (() => { const b = el("button", { class: "sec-btn sec-btn-primary", text: "Generate Recovery Preview" });
            b.addEventListener("click", startPreview); return b; })(),
          el("a", { class: "sec-btn", href: "#snapshots", text: "View Snapshots" }),
        ]),
      ]));
    };

    const startPreview = async () => {
      try {
        const r = await api.post("/recovery/plan", {});
        job = { id: r.job_id, status: "planned" };
        renderJob(); pollJob();
      } catch (e) { toast(e.message, "err"); }
    };

    const pollJob = () => {
      stop();
      pollTimer = setInterval(async () => {
        if (!job || !document.body.contains(body)) { stop(); return; }
        let j;
        try { j = await api.get(`/recovery/job/${job.id}`); } catch { return; }
        job = j; renderJob();
        if (["succeeded", "partial", "failed", "stale", "cancelled"].includes(j.status)) stop();
      }, 3000);
    };

    const confirmExec = async () => {
      const ids = (job.operations || []).map((o) => o.op_id);
      if (!ids.length) { toast("Nothing to recover.", "err"); return; }
      if (!(await confirmDialog({ title: "Execute recovery",
        message: `Recreate/restore ${ids.length} structural item(s) from snapshot #${job.snapshot_id}? Recreated resources get NEW ids. Nothing is deleted.`,
        danger: true, confirmLabel: "Recover" }))) return;
      try {
        await api.post(`/recovery/job/${job.id}/confirm`, { operation_ids: ids });
        toast("Recovery queued — the bot is executing.");
        pollJob();
      } catch (e) { toast(e.message, "err"); }
    };

    const renderJob = () => {
      const ops = job.operations || [];
      const head = el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title" }, [`Recovery job #${job.id} `,
          badge(job.status || "?", JOB_TONE[job.status] || "muted"),
          " ", el("span", { class: "sec-muted", text: `snapshot #${job.snapshot_id != null ? job.snapshot_id : "?"}` })]),
      ]);
      const parts = [head];
      if (job.status === "planned" && ops.length) {
        parts.push(el("p", { class: "sec-muted", text: `${ops.length} supported operation(s):` }));
        parts.push(table([
          { label: "Operation", render: (o) => o.type || "?" },
          { label: "Target", render: (o) => (o.target && (o.target.name || o.target.kind)) || "—" },
        ], ops));
        if ((job.unsupported || []).length) parts.push(el("p", { class: "sec-muted", text: `${job.unsupported.length} unsupported difference(s) (e.g. managed resources) — not recoverable.` }));
        if ((job.extras || []).length) parts.push(el("p", { class: "sec-muted", text: `${job.extras.length} live resource(s) not in the snapshot will be KEPT (never deleted).` }));
        parts.push(el("div", { class: "sec-actions", style: "margin-top:8px" }, [
          (() => { const b = el("button", { class: "sec-btn sec-btn-primary", text: "Confirm & Execute" }); b.addEventListener("click", confirmExec); return b; })(),
          (() => { const b = el("button", { class: "sec-btn sec-btn-ghost", text: "Cancel" }); b.addEventListener("click", () => { job = null; renderIdle(); }); return b; })(),
        ]));
      } else if (job.status === "planned") {
        parts.push(el("p", { class: "sec-muted", text: "Generating preview…" }));
      } else if (["queued", "running"].includes(job.status)) {
        parts.push(el("p", { class: "sec-muted", text: "Executing on the bot… this page updates automatically." }));
      } else {
        const v = job.verification || {};
        parts.push(el("p", { class: "sec-muted", text: `Result: ${job.status}. Succeeded ${v.succeeded || 0} / ${v.total || 0}; remaining ${v.remaining_operations != null ? v.remaining_operations : "?"}.` }));
        const results = (job.result && job.result.operations) || [];
        if (results.length) {
          parts.push(table([
            { label: "Operation", render: (o) => o.type || "?" },
            { label: "Status", render: (o) => badge(o.status || "?", o.status === "success" ? "ok" : o.status === "failed" ? "bad" : "muted") },
            { label: "New id", render: (o) => (o.new_id ? el("code", { text: o.new_id }) : "—") },
            { label: "Reason", render: (o) => el("span", { class: "sec-muted", text: o.reason || "" }) },
          ], results));
        }
        parts.push(el("div", { class: "sec-actions", style: "margin-top:8px" }, [
          (() => { const b = el("button", { class: "sec-btn sec-btn-ghost", text: "New recovery" }); b.addEventListener("click", () => { job = null; renderIdle(); }); return b; })(),
        ]));
      }
      body.replaceChildren(...parts);
    };

    renderIdle();
  },
};
