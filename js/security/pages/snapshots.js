import { api } from "../api.js";
import { el, table, badge, toast, errorState, fmtTime, infoTitle, emptyCard } from "../ui.js";

// SV2-MAN-005 (final): Snapshots is a truthful VIEW / INSPECT / CAPTURE page.
// It never executes recovery — restoring from a snapshot lives on Recovery → Rollback.
// A snapshot is a STRUCTURAL recovery baseline (roles, channels, overwrites,
// security settings); NOT a message/member/file backup. Recreated resources get
// NEW Discord ids. Every field is rendered defensively so a malformed row/response
// produces a diagnostic state, never a runtime crash.

const SUIT_LABEL = { baseline: "Usable · Baseline", scheduled: "Usable · Scheduled",
                     manual: "Usable · Manual", incident: "Incident / suspect",
                     legacy: "Legacy (v1)", invalid: "Invalid", unsupported: "Unsupported" };
const SUIT_TONE = { baseline: "ok", scheduled: "ok", manual: "ok",
                    incident: "warn", legacy: "muted", invalid: "bad", unsupported: "bad" };
const SOURCE_LABEL = { baseline: "Baseline", scheduled: "Scheduled", manual: "Manual",
                       pre_action: "Incident (pre-action)", join: "Baseline" };
const USABLE = new Set(["baseline", "scheduled", "manual"]);
const WHY_NOT_USABLE = {
  incident: "Captured at incident/pre-action time — may contain attack damage; never auto-selected.",
  legacy: "Legacy v1 payload — the v2 recovery engine cannot safely restore it; a fresh baseline is needed.",
  invalid: "Payload is malformed / unparseable.",
  unsupported: "Payload schema is newer than this build understands.",
};

export default {
  async render(root) {
    let pollTimer = null;
    let unmounted = false;
    // best-effort unmount detection: the router replaces #sec-page content
    const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

    let payload, perms;
    try {
      [payload, perms] = await Promise.all([
        api.get("/snapshots"),
        api.me().catch(() => ({ can_edit: false })),
      ]);
    } catch (err) { return errorState(root, err, () => this.render(root)); }

    // --- defensive normalization (malformed response -> diagnostic, not crash) --
    const canEdit = !!(perms && perms.can_edit);
    let snaps = [];
    let hasUsable = false;
    let caps = {};
    if (payload && Array.isArray(payload.snapshots)) {
      snaps = payload.snapshots;
      hasUsable = !!payload.has_usable;
      caps = payload.capabilities || {};
    } else if (Array.isArray(payload)) {
      snaps = payload;                                  // tolerate a bare array
    } else {
      return errorState(root, { message: "Snapshots API returned an unexpected shape. "
        + "The bot/backend may be a version behind — check the console." }, () => this.render(root));
    }
    snaps = snaps.filter((s) => s && typeof s === "object").map(norm);
    hasUsable = hasUsable || snaps.some((s) => s.usable);

    const usableSnaps = snaps.filter((s) => s.usable);
    const currentBaseline = usableSnaps[0] || null;     // API returns newest-first
    const lastScheduled = snaps.find((s) => s.source === "scheduled") || null;
    const counts = {
      total: snaps.length,
      usable: usableSnaps.length,
      incident: snaps.filter((s) => s.suitability === "incident").length,
      legacy: snaps.filter((s) => s.suitability === "legacy").length,
      bad: snaps.filter((s) => s.suitability === "invalid" || s.suitability === "unsupported").length,
    };

    root.appendChild(infoTitle("Snapshots",
      "Structural recovery baselines you can view, inspect and capture.", "h1", "sec-page-title"));

    // ---- health summary ---------------------------------------------------- #
    const health = el("div", { id: "snap-health" });
    root.appendChild(health);
    const renderHealth = (capturePending) => {
      let readiness, tone;
      if (capturePending) { readiness = "Capture pending"; tone = "warn"; }
      else if (hasUsable && currentBaseline) { readiness = "Ready"; tone = "ok"; }
      else { readiness = "No usable baseline"; tone = "bad"; }
      health.replaceChildren(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title" }, ["Recovery readiness ", badge(readiness, tone)]),
        el("div", { class: "sec-grid sec-grid-3", style: "margin-top:8px" }, [
          kv("Current recovery baseline", currentBaseline
            ? `#${currentBaseline.id} · ${SOURCE_LABEL[currentBaseline.source] || currentBaseline.source} · captured ${fmtTime(currentBaseline.created_at)}`
            : "None — no usable baseline yet"),
          kv("Last scheduled snapshot", lastScheduled ? fmtTime(lastScheduled.created_at) : "No scheduled snapshot yet"),
          kv("Scheduled capture cadence", "~every 6 hours (only when the structure changed)"),
          kv("Stored snapshots", `${counts.total} total · ${counts.usable} usable · ${counts.incident} incident · ${counts.legacy} legacy${counts.bad ? ` · ${counts.bad} invalid/unsupported` : ""}`),
        ]),
      ]));
    };
    renderHealth(false);

    // ---- capture control (honest lifecycle) -------------------------------- #
    if (canEdit) {
      const status = el("span", { class: "sec-muted", style: "margin-left:10px" });
      const btn = el("button", { class: "sec-btn sec-btn-primary", text: "Capture Snapshot" });
      btn.addEventListener("click", async () => {
        btn.disabled = true; status.textContent = "Queuing…"; renderHealth(true);
        try {
          const r = await api.post("/snapshots/capture", {});
          status.textContent = "Pending — the bot is capturing…";
          pollCapture(r && r.command, status, btn);
        } catch (e) { toast(e.message, "err"); btn.disabled = false; status.textContent = ""; renderHealth(false); }
      });
      root.appendChild(el("div", { class: "sec-actions", style: "margin:10px 0" }, [btn, status]));
    }

    const pollCapture = (key, status, btn) => {
      if (!key) { status.textContent = "Queued."; btn.disabled = false; return; }
      let tries = 0;
      stopPolling();
      pollTimer = setInterval(async () => {
        if (unmounted || !document.body.contains(btn)) { stopPolling(); return; }
        if (tries++ > 20) { stopPolling(); status.textContent = "Still pending — refresh shortly."; btn.disabled = false; return; }
        let c;
        try { c = await api.get(`/command/${encodeURIComponent(key)}`); }
        catch { if (tries > 5) { stopPolling(); status.textContent = "Status unavailable — refresh."; btn.disabled = false; } return; }
        if (c.status === "done") {
          stopPolling();
          const res = c.result || {};
          status.textContent = res.status === "reused"
            ? "No structural change — reused the latest snapshot."
            : `Snapshot #${res.snapshot_id || "?"} created.`;
          btn.disabled = false;
          this.render(clearRoot(root));            // refresh page state
        } else if (c.status === "failed") {
          stopPolling();
          const res = c.result || {};
          status.textContent = `Capture failed${res.reason ? `: ${res.reason}` : res.error ? `: ${res.error}` : ""}.`;
          btn.disabled = false; renderHealth(false);
        }
      }, 3000);
    };

    // ---- timeline + filters ------------------------------------------------ #
    const FILTERS = [
      ["current", "All current", (s) => s.suitability !== "legacy" && s.suitability !== "invalid" && s.suitability !== "unsupported"],
      ["usable", "Usable", (s) => s.usable],
      ["baseline", "Baseline", (s) => s.source === "baseline" || s.source === "join"],
      ["scheduled", "Scheduled", (s) => s.source === "scheduled"],
      ["manual", "Manual", (s) => s.source === "manual"],
      ["incident", "Incident/Suspect", (s) => s.suitability === "incident"],
      ["legacy", "Legacy", (s) => s.suitability === "legacy"],
      ["bad", "Invalid/Unsupported", (s) => s.suitability === "invalid" || s.suitability === "unsupported"],
    ];
    let activeFilter = "current";
    const listBody = el("div", { id: "snap-list" });
    const detail = el("div", { id: "snap-detail" });
    const chips = el("div", { class: "sec-toolbar", style: "flex-wrap:wrap;gap:6px" });

    const paintList = () => {
      chips.replaceChildren(...FILTERS.map(([key, label]) => {
        const b = el("button", { class: `sec-btn sec-btn-sm ${key === activeFilter ? "sec-btn-primary" : ""}`, text: label });
        b.addEventListener("click", () => { activeFilter = key; paintList(); });
        return b;
      }));
      const fn = (FILTERS.find((f) => f[0] === activeFilter) || FILTERS[0])[2];
      const rows = snaps.filter(fn);
      if (!rows.length) {
        listBody.replaceChildren(emptyCard({ title: "No snapshots in this view",
          message: activeFilter === "current"
            ? "No current snapshots. Capture one, or check the Legacy / Invalid filters for historical rows."
            : "Nothing matches this filter." }));
        return;
      }
      listBody.replaceChildren(table([
        { label: "#", key: "id" },
        { label: "Source", render: (s) => badge(SOURCE_LABEL[s.source] || s.source || "—", "muted") },
        { label: "Suitability", render: (s) => badge(SUIT_LABEL[s.suitability] || s.suitability || "—", SUIT_TONE[s.suitability] || "muted") },
        { label: "Baseline", render: (s) => currentBaseline && s.id === currentBaseline.id ? badge("Current", "ok") : "—" },
        { label: "Ver", render: (s) => (s.schema_version == null ? "—" : String(s.schema_version)) },
        { label: "Roles", render: (s) => (s.role_count == null ? "—" : String(s.role_count)) },
        { label: "Channels", render: (s) => (s.channel_count == null ? "—" : String(s.channel_count)) },
        { label: "Hash", render: (s) => el("code", { text: s.content_hash_short || "—" }) },
        { label: "Incident", render: (s) => (s.incident_id ? String(s.incident_id) : "—") },
        { label: "Captured", render: (s) => fmtTime(s.created_at) },
        { label: "", render: (s) => { const b = el("button", { class: "sec-btn sec-btn-sm", text: "Details" });
          b.addEventListener("click", () => showDetail(s)); return b; } },
      ], rows));
    };

    const showDetail = (s) => {
      const usable = s.usable;
      detail.replaceChildren(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title" }, [`Snapshot #${s.id} `,
          badge(SUIT_LABEL[s.suitability] || s.suitability || "—", SUIT_TONE[s.suitability] || "muted"),
          currentBaseline && s.id === currentBaseline.id ? el("span", {}, [" ", badge("Current baseline", "ok")]) : null]),
        el("div", { class: "sec-grid sec-grid-2", style: "margin-top:8px" }, [
          kv("Captured", fmtTime(s.created_at)),
          kv("Source", SOURCE_LABEL[s.source] || s.source || "—"),
          kv("Reason", s.reason || "—"),
          kv("Schema version", s.schema_version == null ? "—" : String(s.schema_version)),
          kv("Roles", s.role_count == null ? "—" : String(s.role_count)),
          kv("Channels", s.channel_count == null ? "—" : String(s.channel_count)),
          kv("Incident", s.incident_id ? String(s.incident_id) : "—"),
          kv("Usable for recovery", usable ? "Yes" : "No"),
        ]),
        el("div", { class: "sec-settings-row", style: "margin-top:6px" }, [
          el("div", { class: "k" }, ["Content hash"]),
          el("code", { class: "sec-mono", text: s.content_hash || "—" }),
        ]),
        usable ? null : el("p", { class: "sec-muted", text: `Not usable: ${WHY_NOT_USABLE[s.suitability] || "unknown"}` }),
        el("p", { class: "sec-muted", text: "Kept per retention (newest ~10 per guild; the newest usable baseline and snapshots referenced by an active recovery job are always protected). To restore from this snapshot, open Recovery → Rollback." }),
        el("div", { class: "sec-actions" }, [
          el("a", { class: "sec-btn sec-btn-sm", href: "#rollback", text: "Go to Rollback" }),
          (() => { const b = el("button", { class: "sec-btn sec-btn-sm sec-btn-ghost", text: "Close" }); b.addEventListener("click", () => detail.replaceChildren()); return b; })(),
        ]),
      ]));
    };

    root.appendChild(chips);
    root.appendChild(detail);
    root.appendChild(listBody);
    paintList();

    // ---- coverage & retention + product contract --------------------------- #
    root.appendChild(el("div", { class: "sec-card", style: "margin-top:10px" }, [
      el("div", { class: "sec-page-title", text: "Coverage & retention" }),
      el("p", { class: "sec-muted", text: `${counts.usable} usable snapshot(s). Retention keeps the newest ~10 per guild; the newest usable baseline and snapshots referenced by an active recovery job are never pruned.` }),
      caps.captured ? el("p", { class: "sec-muted", text: "Captured: " + caps.captured.join(", ") + "." })
        : el("p", { class: "sec-muted", text: "Captured: guild security settings, roles, categories/channels, permission overwrites." }),
      caps.not_captured ? el("p", { class: "sec-muted", text: "Not captured: " + caps.not_captured.join(", ") + "." })
        : el("p", { class: "sec-muted", text: "Not captured: messages, members, files, webhook tokens, secrets, audit history." }),
      el("p", { class: "sec-muted", text: "Recreated channels/roles receive NEW Discord ids. Restoring is done on Recovery → Rollback, not here." }),
    ]));
  },
};

function norm(s) {
  return {
    id: s.id,
    reason: s.reason,
    source: s.source || s.reason,
    suitability: s.suitability || null,
    usable: (s.usable === true) || ["baseline", "scheduled", "manual"].includes(s.suitability),
    schema_version: s.schema_version,
    content_hash: s.content_hash || null,
    content_hash_short: s.content_hash_short || (s.content_hash ? String(s.content_hash).slice(0, 12) : null),
    channel_count: s.channel_count,
    role_count: s.role_count,
    incident_id: s.incident_id,
    created_at: s.created_at,
  };
}

function kv(label, value) {
  return el("div", { class: "sec-kv" }, [
    el("div", { class: "sec-kv-l", text: label }),
    el("div", { class: "sec-kv-v", text: String(value) }),
  ]);
}

function clearRoot(root) { root.replaceChildren(); return root; }
