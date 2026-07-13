import { api } from "../api.js";
import { el, table, badge, toast, errorState, confirmDialog, fmtTime, infoTitle, emptyCard } from "../ui.js";

// SV2-MAN-005: honest Snapshots + plan-based Recovery.
// A snapshot is a STRUCTURAL recovery baseline (roles, channels, overwrites,
// security settings) — NOT a message/member/file backup. Recreated Discord
// resources get NEW ids. Recovery previews a diff before any destructive change,
// never queues without a usable snapshot, and never claims queued == done.
const SUIT_TONE = { baseline: "ok", scheduled: "ok", manual: "ok",
                    incident: "warn", invalid: "bad", unsupported: "bad" };
const JOB_TONE = { succeeded: "ok", partial: "warn", running: "muted", queued: "muted",
                   planned: "muted", failed: "bad", stale: "bad", cancelled: "muted" };

export default {
  async render(root) {
    let data = null, perms = null;
    try {
      [data, perms] = await Promise.all([
        api.get("/snapshots"),
        api.me().catch(() => ({ can_edit: false })),
      ]);
    } catch (err) { return errorState(root, err, () => this.render(root)); }

    const snaps = (data && data.snapshots) || [];
    const hasUsable = !!(data && data.has_usable);
    const caps = (data && data.capabilities) || {};
    const canEdit = !!(perms && perms.can_edit);

    let job = null;             // active recovery job (plan/preview/result)
    let jobPoll = null;

    root.appendChild(infoTitle("Snapshots & Recovery",
      "Structural recovery baselines: roles, channels, permission overwrites and security settings.", "h1", "sec-page-title"));

    // --- honest scope copy --------------------------------------------- #
    root.appendChild(el("div", { class: "sec-card", style: "margin:8px 0" }, [
      el("p", { class: "sec-muted", text: "A snapshot is a structural / security recovery baseline — NOT a full server backup. It does not store messages, members, files, webhooks/tokens, emojis, stickers or integrations. Recreated channels and roles receive NEW Discord ids, and recovery never deletes resources that are simply missing from the snapshot." }),
      caps.captured ? el("p", { class: "sec-muted", text: "Captured: " + caps.captured.join(", ") + "." }) : null,
      caps.not_captured ? el("p", { class: "sec-muted", text: "Not captured: " + caps.not_captured.join(", ") + "." }) : null,
    ].filter(Boolean)));

    // --- capture control (honest pending) ------------------------------ #
    const captureWrap = el("div", { class: "sec-actions", style: "margin:8px 0" });
    if (canEdit) {
      const btn = el("button", { class: "sec-btn sec-btn-primary", text: "Capture Snapshot" });
      const status = el("span", { class: "sec-muted", style: "margin-left:10px" });
      btn.addEventListener("click", async () => {
        btn.disabled = true; status.textContent = "Queuing…";
        try {
          const r = await api.post("/snapshots/capture", {});
          status.textContent = "Pending — the bot is capturing…";
          await pollCommand(r.command, status, btn);
        } catch (e) { toast(e.message, "err"); btn.disabled = false; status.textContent = ""; }
      });
      captureWrap.append(btn, status);
    }
    root.appendChild(captureWrap);

    const pollCommand = async (key, status, btn) => {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        let c;
        try { c = await api.get(`/command/${encodeURIComponent(key)}`); } catch { continue; }
        if (c.status === "done") {
          const res = c.result || {};
          status.textContent = res.status === "reused"
            ? "No structural changes — reused the latest snapshot."
            : `Snapshot #${res.snapshot_id || "?"} created.`;
          btn.disabled = false;
          return this.render(clear(root));   // refresh list
        }
        if (c.status === "failed") { status.textContent = "Capture failed — check the bot logs."; btn.disabled = false; return; }
      }
      status.textContent = "Still pending — refresh shortly."; btn.disabled = false;
    };

    // --- snapshot list ------------------------------------------------- #
    if (!snaps.length) {
      root.appendChild(emptyCard({
        title: "No snapshots yet",
        message: "Baselines are captured when the bot provisions a guild, on a periodic schedule, before a destructive security response, and when you press Capture Snapshot. A baseline will appear here shortly.",
      }));
    } else {
      root.appendChild(table([
        { label: "#", key: "id" },
        { label: "Source", render: (s) => badge(s.source || s.reason, "muted") },
        { label: "Suitability", render: (s) => badge(s.suitability || "—", SUIT_TONE[s.suitability] || "muted") },
        { label: "Ver", render: (s) => s.schema_version || "—" },
        { label: "Channels", key: "channel_count" },
        { label: "Roles", key: "role_count" },
        { label: "Hash", render: (s) => el("code", { text: s.content_hash_short || "—" }) },
        { label: "Incident", render: (s) => s.incident_id ? String(s.incident_id) : "—" },
        { label: "Captured", render: (s) => el("span", { text: fmtTime(s.created_at) }) },
      ], snaps));
    }

    // --- recovery workflow --------------------------------------------- #
    root.appendChild(el("h2", { class: "sec-section-title", text: "Recovery" }));
    const recBody = el("div", { id: "rec-body" });
    root.appendChild(recBody);

    const renderRecovery = () => {
      recBody.replaceChildren();
      if (!hasUsable) {
        recBody.appendChild(emptyCard({
          title: "Recovery unavailable",
          message: "There is no usable (healthy baseline) snapshot to recover from yet. Capture a snapshot first — incident-time snapshots are never used as a healthy baseline.",
        }));
        return;
      }
      if (!canEdit) { recBody.appendChild(el("p", { class: "sec-muted", text: "Read-only." })); return; }
      if (!job) {
        recBody.appendChild(el("div", { class: "sec-actions" }, [
          el("button", { class: "sec-btn sec-btn-primary", text: "Generate Recovery Preview",
            onclick: startPreview }),
          el("span", { class: "sec-muted", style: "margin-left:10px",
            text: "Builds a diff of what recovery would recreate/restore. No changes are made until you confirm." }),
        ]));
        return;
      }
      renderJob();
    };

    const startPreview = async () => {
      try {
        const r = await api.post("/recovery/plan", {});     // backend picks the usable candidate
        job = { id: r.job_id, status: "planned", plan: null };
        renderRecovery();
        pollJob();
      } catch (e) { toast(e.message, "err"); }
    };

    const pollJob = () => {
      clearInterval(jobPoll);
      jobPoll = setInterval(async () => {
        if (!job) { clearInterval(jobPoll); return; }
        let j;
        try { j = await api.get(`/recovery/job/${job.id}`); } catch { return; }
        job = j;
        renderJob();
        if (["succeeded", "partial", "failed", "stale", "cancelled"].includes(j.status)) clearInterval(jobPoll);
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
      recBody.replaceChildren();
      const head = el("div", { class: "sec-card" }, [
        el("div", {}, [el("strong", { text: `Recovery job #${job.id} ` }),
          badge(job.status, JOB_TONE[job.status] || "muted"),
          " ", el("span", { class: "sec-muted", text: `snapshot #${job.snapshot_id}` })]),
      ]);
      recBody.appendChild(head);

      const ops = job.operations || [];
      if (job.status === "planned" && ops.length) {
        recBody.appendChild(el("p", { class: "sec-muted", text: `${ops.length} supported operation(s):` }));
        recBody.appendChild(table([
          { label: "Operation", render: (o) => o.type },
          { label: "Target", render: (o) => (o.target && (o.target.name || o.target.kind)) || "—" },
        ], ops));
        if ((job.unsupported || []).length) {
          recBody.appendChild(el("p", { class: "sec-muted", text: `${job.unsupported.length} unsupported difference(s) (e.g. managed resources) — not recoverable.` }));
        }
        if ((job.extras || []).length) {
          recBody.appendChild(el("p", { class: "sec-muted", text: `${job.extras.length} live resource(s) not in the snapshot will be KEPT (never deleted).` }));
        }
        recBody.appendChild(el("div", { class: "sec-actions", style: "margin-top:8px" }, [
          el("button", { class: "sec-btn sec-btn-primary", text: "Confirm & Execute", onclick: confirmExec }),
          el("button", { class: "sec-btn sec-btn-ghost", text: "Cancel", onclick: () => { job = null; clearInterval(jobPoll); renderRecovery(); } }),
        ]));
      } else if (job.status === "planned") {
        recBody.appendChild(el("p", { class: "sec-muted", text: "Generating preview…" }));
      } else if (["queued", "running"].includes(job.status)) {
        recBody.appendChild(el("p", { class: "sec-muted", text: "Executing on the bot… this page updates automatically." }));
      } else {
        // terminal
        const v = job.verification || {};
        recBody.appendChild(el("p", { class: "sec-muted",
          text: `Result: ${job.status}. Succeeded ${v.succeeded || 0} / ${v.total || 0}; remaining ${v.remaining_operations != null ? v.remaining_operations : "?"}.` }));
        const results = (job.result && job.result.operations) || [];
        if (results.length) {
          recBody.appendChild(table([
            { label: "Operation", render: (o) => o.type },
            { label: "Status", render: (o) => badge(o.status, o.status === "success" ? "ok" : o.status === "failed" ? "bad" : "muted") },
            { label: "New id", render: (o) => o.new_id ? el("code", { text: o.new_id }) : "—" },
            { label: "Reason", render: (o) => el("span", { class: "sec-muted", text: o.reason || "" }) },
          ], results));
        }
        recBody.appendChild(el("div", { class: "sec-actions", style: "margin-top:8px" }, [
          el("button", { class: "sec-btn sec-btn-ghost", text: "New recovery", onclick: () => { job = null; renderRecovery(); } }),
        ]));
      }
    };

    renderRecovery();
  },
};

function clear(root) { root.replaceChildren(); return root; }
