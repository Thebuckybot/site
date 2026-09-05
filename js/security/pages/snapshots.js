import { api } from "../api.js";
import { el, table, badge, toast, errorState, fmtTime, infoTitle, emptyCard } from "../ui.js";

// SNAPSHOT-2.0 — the Snapshot Vault. Snapshots are first-class restore points you
// can browse, PREVIEW (a read-only virtual Discord), pin as the Current restore
// point, rename, delete, export, and repair from. Repair always uses the Current
// Snapshot (falling back to the newest usable when none is pinned). This page never
// executes recovery itself — Repair routes to Recovery → Rollback. Every field is
// rendered defensively so a malformed row/response is a diagnostic, never a crash.

const SUIT_LABEL = { baseline: "Usable · Baseline", scheduled: "Usable · Scheduled",
                     manual: "Usable · Manual", incident: "Incident / suspect",
                     legacy: "Legacy (v1)", invalid: "Invalid", unsupported: "Unsupported" };
const SUIT_TONE = { baseline: "ok", scheduled: "ok", manual: "ok",
                    incident: "warn", legacy: "muted", invalid: "bad", unsupported: "bad" };
const SOURCE_LABEL = { baseline: "Baseline", scheduled: "Scheduled", manual: "Manual",
                       pre_action: "Incident (pre-action)", join: "Baseline" };
const USABLE = new Set(["baseline", "scheduled", "manual"]);
const WHY_NOT_USABLE = {
  incident: "Captured at incident/pre-action time - may contain attack damage; never auto-selected.",
  legacy: "Legacy v1 payload - the v2 recovery engine cannot safely restore it; a fresh baseline is needed.",
  invalid: "Payload is malformed / unparseable.",
  unsupported: "Payload schema is newer than this build understands.",
};

// Channel kind → short Discord-like type marker for the preview.
const KIND_TAG = { text: "#", news: "announce", voice: "voice", stage: "stage",
                   forum: "forum", media: "media", category: "" };
const PERM_ADMIN = 0x8n;   // Administrator bit

export default {
  async render(root) {
    let pollTimer = null;
    let unmounted = false;
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
    let currentId = null;
    // The two retention numbers come from the server's own row (10 / 14 free,
    // 25 / 365 boosted); the page never hardcodes them again.
    let keepN = 10;
    let retDays = 14;
    if (payload && Array.isArray(payload.snapshots)) {
      snaps = payload.snapshots;
      hasUsable = !!payload.has_usable;
      caps = payload.capabilities || {};
      currentId = payload.current_snapshot_id != null ? Number(payload.current_snapshot_id) : null;
      if (payload.keep != null) keepN = Number(payload.keep);
      if (payload.retention_days != null) retDays = Number(payload.retention_days);
    } else if (Array.isArray(payload)) {
      snaps = payload;                                  // tolerate a bare array
    } else {
      return errorState(root, { message: "Snapshots API returned an unexpected shape. "
        + "The bot/backend may be a version behind - check the console." }, () => this.render(root));
    }
    snaps = snaps.filter((s) => s && typeof s === "object").map(norm);
    hasUsable = hasUsable || snaps.some((s) => s.usable);

    const usableSnaps = snaps.filter((s) => s.usable);
    const newestUsable = usableSnaps[0] || null;        // API returns newest-first
    const pinned = (currentId != null && snaps.find((s) => s.id === currentId)) || null;
    // The snapshot a default Repair will actually use: pinned Current if usable, else newest usable.
    const effective = (pinned && pinned.usable) ? pinned : newestUsable;
    const lastScheduled = snaps.find((s) => s.source === "scheduled") || null;
    const counts = {
      total: snaps.length,
      usable: usableSnaps.length,
      incident: snaps.filter((s) => s.suitability === "incident").length,
      legacy: snaps.filter((s) => s.suitability === "legacy").length,
      bad: snaps.filter((s) => s.suitability === "invalid" || s.suitability === "unsupported").length,
    };

    root.appendChild(infoTitle("Snapshot Vault",
      "Browse, preview, pin and restore from structural recovery points.", "h1", "sec-page-title"));

    root.appendChild(el("div", { class: "sec-card", style: "margin:8px 0" }, [
      el("p", { text: "A snapshot is a structural server backup - roles, channels, categories, permission overwrites and security settings." }),
      el("p", { class: "sec-muted", text: "It does NOT back up messages, files, member history, emojis/stickers or webhook tokens. Recreated channels/roles receive new Discord ids. Repair always uses the Current Snapshot; if none is pinned it uses the newest usable one." }),
    ]));

    // ---- readiness summary ------------------------------------------------- #
    const health = el("div", { id: "snap-health" });
    root.appendChild(health);
    const renderHealth = (capturePending) => {
      let readiness, tone;
      if (capturePending) { readiness = "Capture pending"; tone = "warn"; }
      else if (hasUsable && effective) { readiness = "Ready"; tone = "ok"; }
      else { readiness = "No usable baseline"; tone = "bad"; }
      health.replaceChildren(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title" }, ["Recovery readiness ", badge(readiness, tone)]),
        el("div", { class: "sec-grid sec-grid-3", style: "margin-top:8px" }, [
          kv("Repair will use", effective
            ? `${displayName(effective)} (#${effective.id})${pinned && effective.id === pinned.id ? " · pinned" : " · newest usable"}`
            : "None - no usable baseline yet"),
          kv("Current Snapshot", pinned ? `${displayName(pinned)} (#${pinned.id})` : "Not pinned - using newest usable"),
          kv("Automatic snapshots", "at most one every 6 hours (on structural change)"),
          // `keepN` comes from the server's own row (payload.keep): 10 free, 25
          // boosted. This line said "of 10" for every server, so a boosted
          // server's page contradicted what the boost had actually written.
          kv("Stored snapshots", `${counts.total} of ${keepN} · ${counts.usable} usable · ${counts.incident} incident · ${counts.legacy} legacy${counts.bad ? ` · ${counts.bad} invalid` : ""}`),
        ]),
      ]));
    };
    renderHealth(false);

    // ---- manual capture (bypasses the 6h automatic cooldown) --------------- #
    if (canEdit) {
      const status = el("span", { class: "sec-muted", style: "margin-left:10px" });
      const btn = el("button", { class: "sec-btn sec-btn-primary", text: "Generate Snapshot" });
      btn.addEventListener("click", async () => {
        btn.disabled = true; status.textContent = "Queuing…"; renderHealth(true);
        try {
          const r = await api.post("/snapshots/capture", {});
          status.textContent = "Pending - the bot is capturing…";
          pollCapture(r && r.command, status, btn);
        } catch (e) { toast(e.message, "err"); btn.disabled = false; status.textContent = ""; renderHealth(false); }
      });
      root.appendChild(el("div", { class: "sec-actions", style: "margin:10px 0" }, [btn, status,
        el("span", { class: "sec-muted", text: "Manual snapshots always work - they ignore the 6-hour automatic cooldown." })]));
    }

    const pollCapture = (key, status, btn) => {
      if (!key) { status.textContent = "Queued."; btn.disabled = false; return; }
      let tries = 0;
      stopPolling();
      pollTimer = setInterval(async () => {
        if (unmounted || !document.body.contains(btn)) { stopPolling(); return; }
        if (tries++ > 20) { stopPolling(); status.textContent = "Still pending - refresh shortly."; btn.disabled = false; return; }
        let c;
        try { c = await api.get(`/command/${encodeURIComponent(key)}`); }
        catch { if (tries > 5) { stopPolling(); status.textContent = "Status unavailable - refresh."; btn.disabled = false; } return; }
        if (c.status === "done") {
          stopPolling();
          const res = c.result || {};
          status.textContent = res.status === "reused"
            ? "No structural change - reused the latest snapshot."
            : `Snapshot #${res.snapshot_id || "?"} created.`;
          btn.disabled = false;
          this.render(clearRoot(root));
        } else if (c.status === "failed") {
          stopPolling();
          const res = c.result || {};
          status.textContent = `Capture failed${res.reason ? `: ${res.reason}` : res.error ? `: ${res.error}` : ""}.`;
          btn.disabled = false; renderHealth(false);
        }
      }, 3000);
    };

    // ---- filters + list ---------------------------------------------------- #
    const FILTERS = [
      ["current", "All current", (s) => s.suitability !== "legacy" && s.suitability !== "invalid" && s.suitability !== "unsupported"],
      ["usable", "Usable", (s) => s.usable],
      ["baseline", "Baseline", (s) => s.source === "baseline" || s.source === "join"],
      ["scheduled", "Scheduled/Auto", (s) => s.source === "scheduled"],
      ["manual", "Manual", (s) => s.source === "manual"],
      ["incident", "Incident/Suspect", (s) => s.suitability === "incident"],
      ["legacy", "Legacy", (s) => s.suitability === "legacy"],
      ["bad", "Invalid/Unsupported", (s) => s.suitability === "invalid" || s.suitability === "unsupported"],
    ];
    let activeFilter = "current";
    const listBody = el("div", { id: "snap-list" });
    const detail = el("div", { id: "snap-detail" });
    const chips = el("div", { class: "sec-toolbar", style: "flex-wrap:wrap;gap:6px" });

    const refresh = () => this.render(clearRoot(root));

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
            ? "No current snapshots. Generate one, or check the Legacy / Invalid filters for historical rows."
            : "Nothing matches this filter." }));
        return;
      }
      listBody.replaceChildren(table([
        { label: "#", key: "id" },
        { label: "Name", render: (s) => displayName(s) },
        { label: "Source", render: (s) => badge(SOURCE_LABEL[s.source] || s.source || "-", "muted") },
        { label: "Suitability", render: (s) => badge(SUIT_LABEL[s.suitability] || s.suitability || "-", SUIT_TONE[s.suitability] || "muted") },
        { label: "Current", render: (s) => (pinned && s.id === pinned.id) ? badge("Current", "ok")
            : (!pinned && effective && s.id === effective.id) ? badge("Newest (default)", "muted") : "-" },
        { label: "Roles", render: (s) => (s.role_count == null ? "-" : String(s.role_count)) },
        { label: "Channels", render: (s) => (s.channel_count == null ? "-" : String(s.channel_count)) },
        { label: "Captured", render: (s) => fmtTime(s.created_at) },
        { label: "", render: (s) => {
            const view = el("button", { class: "sec-btn sec-btn-sm", text: "Preview" });
            view.addEventListener("click", () => showPreview(s));
            const more = el("button", { class: "sec-btn sec-btn-sm sec-btn-ghost", text: "Details" });
            more.addEventListener("click", () => showDetail(s));
            return el("span", { class: "sec-actions" }, [view, more]);
          } },
      ], rows));
    };

    // ---- details + actions ------------------------------------------------- #
    const showDetail = (s) => {
      const usable = s.usable;
      const isPinned = pinned && s.id === pinned.id;
      const actions = [];
      actions.push(linkBtn("Preview", () => showPreview(s)));
      if (canEdit && usable && !isPinned) actions.push(linkBtn("Set as Current", () => setCurrent(s)));
      if (usable) actions.push(el("a", { class: "sec-btn sec-btn-sm", href: "#rollback", text: "Repair from this" }));
      if (canEdit) actions.push(linkBtn("Rename", () => renameSnap(s)));
      actions.push(linkBtn("Export", () => exportSnap(s)));
      if (canEdit) actions.push(ghostBtn("Delete", () => deleteSnap(s)));
      actions.push(ghostBtn("Close", () => detail.replaceChildren()));

      detail.replaceChildren(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title" }, [`${displayName(s)} `,
          badge(SUIT_LABEL[s.suitability] || s.suitability || "-", SUIT_TONE[s.suitability] || "muted"),
          isPinned ? el("span", {}, [" ", badge("Current", "ok")]) : null]),
        el("div", { class: "sec-grid sec-grid-2", style: "margin-top:8px" }, [
          kv("Snapshot id", `#${s.id}`),
          kv("Captured", fmtTime(s.created_at)),
          kv("Source", SOURCE_LABEL[s.source] || s.source || "-"),
          kv("Schema version", s.schema_version == null ? "-" : String(s.schema_version)),
          kv("Roles", s.role_count == null ? "-" : String(s.role_count)),
          kv("Channels", s.channel_count == null ? "-" : String(s.channel_count)),
          kv("Usable for recovery", usable ? "Yes" : "No"),
          kv("Full Restore eligible", s.fr_eligible ? "Yes (v3)" : "No - Safe Repair only"),
        ]),
        usable ? null : el("p", { class: "sec-muted", text: `Not usable: ${WHY_NOT_USABLE[s.suitability] || "unknown"}` }),
        el("div", { class: "sec-actions", style: "margin-top:8px;flex-wrap:wrap;gap:6px" }, actions),
      ]));
      detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    // ---- PREVIEW: a read-only, frozen virtual Discord ---------------------- #
    const showPreview = async (s) => {
      detail.replaceChildren(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: `Preview - ${displayName(s)}` }),
        el("p", { class: "sec-muted", text: "Loading the frozen server view…" }),
      ]));
      detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
      let pv;
      try { pv = await api.get(`/snapshots/${s.id}/preview`); }
      catch (e) { return void detail.replaceChildren(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: `Preview - ${displayName(s)}` }),
        el("p", { class: "sec-bad", text: `Could not load preview: ${e.message}` }),
        el("div", { class: "sec-actions" }, [ghostBtn("Close", () => detail.replaceChildren())]),
      ])); }

      const roles = Array.isArray(pv.roles) ? pv.roles.slice() : [];
      const channels = Array.isArray(pv.channels) ? pv.channels.slice() : [];
      detail.replaceChildren(el("div", { class: "sec-card sec-preview" }, [
        el("div", { class: "sec-page-title" }, [`Preview - ${displayName(s)} `,
          badge("Read-only", "muted"),
          el("span", { class: "sec-muted", style: "margin-left:8px", text: `captured ${fmtTime(pv.created_at || s.created_at)}` })]),
        el("p", { class: "sec-muted", text: "A frozen copy of the server's structure at capture time. Nothing here changes your server." }),
        el("div", { class: "sec-grid sec-grid-2", style: "align-items:start;margin-top:8px" }, [
          renderChannelTree(channels),
          renderRoleList(roles),
        ]),
        el("div", { class: "sec-actions", style: "margin-top:8px" }, [
          linkBtn("Export JSON", () => exportSnap(s, pv)),
          ghostBtn("Close", () => detail.replaceChildren()),
        ]),
      ]));
    };

    // ---- vault action handlers -------------------------------------------- #
    const setCurrent = async (s) => {
      try {
        await api.post(`/snapshots/${s.id}/current`, {});
        toast(`Current Snapshot set to ${displayName(s)} (#${s.id}).`, "ok");
        refresh();
      } catch (e) { toast(e.message, "err"); }
    };
    const renameSnap = async (s) => {
      const name = window.prompt("Rename snapshot (leave blank to clear):", s.name || "");
      if (name === null) return;
      try { await api.post(`/snapshots/${s.id}/rename`, { name }); toast("Snapshot renamed.", "ok"); refresh(); }
      catch (e) { toast(e.message, "err"); }
    };
    const deleteSnap = async (s) => {
      if (!window.confirm(`Delete ${displayName(s)} (#${s.id})? This cannot be undone.`)) return;
      try { await api.del(`/snapshots/${s.id}`); toast("Snapshot deleted.", "ok"); refresh(); }
      catch (e) { toast(e.message, "err"); }
    };
    const exportSnap = async (s, pv) => {
      try {
        const data = pv || await api.get(`/snapshots/${s.id}/preview`);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `snapshot-${s.id}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      } catch (e) { toast(e.message, "err"); }
    };

    root.appendChild(chips);
    root.appendChild(detail);
    root.appendChild(listBody);
    paintList();

    root.appendChild(el("div", { class: "sec-card", style: "margin-top:10px" }, [
      el("div", { class: "sec-page-title", text: "Coverage & retention" }),
      el("p", { class: "sec-muted", text: `This server keeps its newest ${keepN} snapshots, and none older than ${retDays} days. One exception: the Current Snapshot (pinned, or the newest usable one) is kept however old it is. A snapshot a running recovery job needs is held until that job finishes.` }),
      caps.captured ? el("p", { class: "sec-muted", text: "Captured: " + caps.captured.join(", ") + "." })
        : el("p", { class: "sec-muted", text: "Captured: guild security settings, roles, categories/channels, permission overwrites." }),
      caps.not_captured ? el("p", { class: "sec-muted", text: "Not captured: " + caps.not_captured.join(", ") + "." })
        : el("p", { class: "sec-muted", text: "Not captured: messages, members, files, webhook tokens, secrets, audit history." }),
      el("p", { class: "sec-muted", text: "Recreated channels/roles receive NEW Discord ids. Repair is executed on Recovery → Rollback." }),
    ]));
  },
};

// ---- virtual-Discord renderers ------------------------------------------- #
function renderChannelTree(channels) {
  const cats = channels.filter((c) => c.kind === "category")
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  const nonCat = channels.filter((c) => c.kind !== "category");
  const byCat = new Map();
  const orphan = [];
  for (const c of nonCat) {
    const cid = c.category_id != null ? String(c.category_id) : null;
    if (cid && cats.some((k) => String(k.id) === cid)) {
      if (!byCat.has(cid)) byCat.set(cid, []);
      byCat.get(cid).push(c);
    } else orphan.push(c);
  }
  const sortCh = (arr) => arr.sort((a, b) => (a.position || 0) - (b.position || 0));
  const body = [el("div", { class: "sec-page-title", text: `Channels (${channels.length})` })];
  if (orphan.length) {
    body.push(el("div", { class: "sec-preview-cat" }, ["(no category)"]));
    sortCh(orphan).forEach((c) => body.push(channelRow(c)));
  }
  for (const cat of cats) {
    body.push(el("div", { class: "sec-preview-cat" }, [String(cat.name || "category").toUpperCase()]));
    const kids = sortCh(byCat.get(String(cat.id)) || []);
    if (!kids.length) body.push(el("div", { class: "sec-preview-ch sec-muted", text: "  (empty)" }));
    kids.forEach((c) => body.push(channelRow(c)));
  }
  if (channels.length === 0) body.push(el("p", { class: "sec-muted", text: "No channels captured." }));
  return el("div", { class: "sec-preview-col" }, body);
}

function channelRow(c) {
  const tag = KIND_TAG[c.kind] != null ? KIND_TAG[c.kind] : (c.kind || "?");
  const prefix = c.kind === "text" ? "#" : "";
  const bits = [
    el("span", { class: "sec-preview-ch-name", text: `${prefix}${c.name || "unnamed"}` }),
  ];
  if (c.kind !== "text") bits.push(badge(tag, "muted"));
  if (c.nsfw) bits.push(badge("nsfw", "warn"));
  const ow = Array.isArray(c.overwrites) ? c.overwrites.length : 0;
  if (ow) bits.push(el("span", { class: "sec-muted", text: `${ow} overwrite${ow === 1 ? "" : "s"}` }));
  return el("div", { class: "sec-preview-ch" }, bits);
}

function renderRoleList(roles) {
  const sorted = roles.slice().sort((a, b) => (b.position || 0) - (a.position || 0));
  const body = [el("div", { class: "sec-page-title", text: `Roles (${roles.length})` })];
  if (!sorted.length) body.push(el("p", { class: "sec-muted", text: "No roles captured." }));
  for (const r of sorted) {
    const hex = colorHex(r.color);
    const swatch = el("span", { class: "sec-role-dot", style: `background:${hex || "#99aab5"}` });
    const bits = [swatch, el("span", { class: "sec-role-name", style: hex ? `color:${hex}` : "", text: r.name || "role" })];
    if (isAdmin(r.permissions)) bits.push(badge("admin", "bad"));
    if (r.hoist) bits.push(badge("hoisted", "muted"));
    if (r.managed) bits.push(badge("managed", "muted"));
    body.push(el("div", { class: "sec-preview-role" }, bits));
  }
  return el("div", { class: "sec-preview-col" }, body);
}

function colorHex(color) {
  const n = Number(color || 0);
  if (!n) return null;
  return "#" + (n & 0xffffff).toString(16).padStart(6, "0");
}
function isAdmin(perms) {
  try { return (BigInt(perms || 0) & PERM_ADMIN) === PERM_ADMIN; } catch { return false; }
}

// ---- small helpers -------------------------------------------------------- #
function displayName(s) {
  if (s && s.name) return String(s.name);
  const src = SOURCE_LABEL[(s && s.source)] || (s && s.source) || "Snapshot";
  return `${src} #${s ? s.id : "?"}`;
}
function linkBtn(text, onClick) {
  const b = el("button", { class: "sec-btn sec-btn-sm", text });
  b.addEventListener("click", onClick);
  return b;
}
function ghostBtn(text, onClick) {
  const b = el("button", { class: "sec-btn sec-btn-sm sec-btn-ghost", text });
  b.addEventListener("click", onClick);
  return b;
}

function norm(s) {
  return {
    id: Number(s.id),
    name: s.name || null,
    reason: s.reason,
    source: s.source || s.reason,
    suitability: s.suitability || null,
    is_current: s.is_current === true,
    usable: (s.usable === true) || ["baseline", "scheduled", "manual"].includes(s.suitability),
    schema_version: s.schema_version,
    fr_eligible: s.fr_eligible === true,
    content_hash: s.content_hash || null,
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
