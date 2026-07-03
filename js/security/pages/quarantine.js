import { api } from "../api.js";
import { el, pageHeader, table, badge, pager, toast, errorState, confirmDialog, fmtTime, debounce, info, infoTitle, formModal } from "../ui.js";
import { settingDesc } from "../descriptions.js";

export default {
  async render(root) {
    let page = 0, status = "active", q = "", data = { items: [], total: 0, per_page: 10 };
    let settings = {}, canEdit = false;

    try {
      [settings, { can_edit: canEdit }] = await Promise.all([
        api.get("/settings"), api.me().catch(() => ({ can_edit: false })),
      ]);
    } catch (err) { return errorState(root, err, () => this.render(root)); }

    const load = async () => {
      data = await api.get(`/quarantine?status=${status}&page=${page}&per_page=10`);
      draw();
    };

    const act = async (rec, action) => {
      const MSG = {
        release: "Release this member and restore their saved roles?",
        kick: "Kick this member?",
        ban: "Ban this member?",
        restore: "Re-apply the quarantine role and re-contain this member? Their current roles are vaulted so a later release restores everything.",
        close: "Close this record WITHOUT restoring roles? Use this when an admin already released the member manually.",
        ignore: "Stop showing the out-of-sync warning for this record? It stays active but is no longer flagged.",
      };
      const danger = action === "kick" || action === "ban";
      if (!(await confirmDialog({
        title: `${action[0].toUpperCase() + action.slice(1)} — <@${rec.user_id}>`.replace(/<@\d+>/, ""),
        message: MSG[action] || `${action}?`,
        danger, confirmLabel: action[0].toUpperCase() + action.slice(1),
      }))) return;
      try { await api.post(`/quarantine/${rec.id}`, { action }); toast(`${action} queued.`); setTimeout(load, 1200); }
      catch (e) { toast(e.message, "err"); }
    };

    // ---- configuration card -------------------------------------------- #
    const setRole = async () => {
      const vals = await formModal({ title: "Set quarantine role", fields: [{ name: "id", label: "Role ID", placeholder: "Right-click role → Copy ID" }], submitLabel: "Save" });
      if (!vals || !vals.id) return;
      try { await api.post("/settings/channels", { quarantine_role_id: vals.id.trim() }); toast("Quarantine role set."); this.render(clear(root)); }
      catch (e) { toast(e.message, "err"); }
    };
    const repair = async () => {
      if (!(await confirmDialog({ title: "Create / repair quarantine role", message: settingDesc("quarantine_repair") + " Continue?", confirmLabel: "Repair" }))) return;
      try {
        await api.post("/repair");
        toast("Repair queued — updating coverage…");
        pollCoverage();   // refresh as soon as the bot processes it (no 5-min wait)
      } catch (e) { toast(e.message, "err"); }
    };
    // Poll /settings after a Repair until the stored coverage refreshes (the bot
    // stores it the moment it applies the overwrites), then re-render. Bounded.
    const pollCoverage = () => {
      const baseline = settings.quarantine_coverage && settings.quarantine_coverage.synced_at;
      let tries = 0;
      const tick = async () => {
        tries += 1;
        let s2 = null;
        try { s2 = await api.get("/settings"); } catch (_) { /* ignore */ }
        const cov = s2 && s2.quarantine_coverage;
        const refreshed = cov && cov.synced_at && cov.synced_at !== baseline;
        if (refreshed || tries >= 10) { this.render(clear(root)); return; }
        setTimeout(tick, 4000);
      };
      setTimeout(tick, 4000);
    };
    const clearRole = async () => {
      try { await api.post("/settings/channels", { quarantine_role_id: "" }); toast("Quarantine role cleared."); this.render(clear(root)); }
      catch (e) { toast(e.message, "err"); }
    };

    const configCard = () => {
      const rid = settings.quarantine_role_id;
      const statusRow = el("div", { class: "sec-settings-row" }, [
        el("div", { class: "k" }, ["Status ", info(settingDesc("quarantine_role"))]),
        rid ? badge(`Configured — role ${rid}`, "ok") : badge("Not configured", "warn"),
      ]);
      const permRow = el("div", { class: "sec-settings-row" }, [
        el("div", { class: "k" }, ["Permissions preview ", info(settingDesc("quarantine_perms"))]),
        el("div", { class: "sec-muted", style: "flex:2", text: settingDesc("quarantine_perms") }),
      ]);
      // Channel coverage — how completely the role is locked down server-wide.
      const cov = settings.quarantine_coverage;
      let coverageRow = null;
      if (rid && cov && cov.total != null) {
        const missing = cov.total - cov.configured;
        const val = missing === 0
          ? badge(`Configured — ${cov.configured} / ${cov.total} channels`, "ok")
          : badge(`Needs Repair — ${missing} channel(s) missing overwrites (${cov.coverage_pct}%)`, "bad");
        coverageRow = el("div", { class: "sec-settings-row" }, [
          el("div", { class: "k" }, ["Coverage ", info("Every channel and category must deny the quarantine role (view, chat, voice, threads, reactions, uploads). Repair re-applies any that were changed or added.")]),
          val,
        ]);
      }
      const controls = el("div", { class: "sec-actions", style: "margin-top:8px" });
      if (canEdit) {
        controls.append(
          el("button", { class: "sec-btn sec-btn-primary sec-btn-sm", text: rid ? "Change Role" : "Select Role", onclick: setRole }),
          el("button", { class: "sec-btn sec-btn-sm", text: rid ? "Repair Role" : "Create Role", onclick: repair }),
        );
        if (rid) controls.append(el("button", { class: "sec-btn sec-btn-ghost sec-btn-sm", text: "Clear", onclick: clearRole }));
      }
      const warning = rid ? null : el("div", { class: "sec-warn-banner" }, [
        el("span", { class: "ic", text: "⚠️" }),
        el("span", { text: "Quarantine is not ready: no quarantine role is configured, so Security cannot isolate a caught member. Press Create Role (or Select an existing one) to activate it." }),
      ]);
      return el("div", { class: `sec-card ${rid ? "" : "sec-warn-card"}` }, [
        infoTitle("Quarantine Role", "The locked role applied to caught members while their real roles are safely vaulted.", "div", "sec-page-title"),
        warning, statusRow, permRow, coverageRow, controls,
      ]);
    };

    const draw = () => {
      const body = root.querySelector("#q-body");
      const rows = (data.items || []).filter((r) => !q || String(r.user_id).includes(q) || (r.reason || "").toLowerCase().includes(q));
      body.replaceChildren(
        table([
          { label: "User", render: (r) => el("code", { text: r.user_id }) },
          { label: "Reason", render: (r) => el("span", { class: "sec-muted", text: r.reason || "—" }) },
          { label: "Status", render: (r) => (r.status === "active" && r.sync_status === "out_of_sync")
              ? el("span", { title: r.sync_reason || "Out of sync with Discord" }, [badge("⚠ Out of Sync", "bad")])
              : badge(r.status, r.status === "active" ? "warn" : "muted") },
          { label: "Since", render: (r) => el("span", { text: fmtTime(r.quarantined_at) }) },
          { label: "Expires", render: (r) => el("span", { text: r.expires_at ? fmtTime(r.expires_at) : "never" }) },
          { label: "Actions", render: (r) => {
            if (!(r.status === "active" && canEdit)) return el("span", { class: "sec-muted", text: "—" });
            if (r.sync_status === "out_of_sync") {
              // Out of sync: do NOT auto-restore. Offer explicit operator choices.
              return el("div", { class: "sec-row" }, [
                el("button", { class: "sec-btn sec-btn-sm sec-btn-primary", text: "Restore Quarantine", onclick: () => act(r, "restore") }),
                el("button", { class: "sec-btn sec-btn-sm", text: "Close Record", onclick: () => act(r, "close") }),
                el("button", { class: "sec-btn sec-btn-sm sec-btn-ghost", text: "Ignore", onclick: () => act(r, "ignore") }),
              ]);
            }
            return el("div", { class: "sec-row" }, [
              el("button", { class: "sec-btn sec-btn-sm", text: "Release", onclick: () => act(r, "release") }),
              el("button", { class: "sec-btn sec-btn-sm", text: "Kick", onclick: () => act(r, "kick") }),
              el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "Ban", onclick: () => act(r, "ban") }),
            ]);
          } },
        ], rows),
        pager(page, (page + 1) * (data.per_page || 10) < (data.total || 0), (p) => { page = p; load(); }),
      );
    };

    // ---- external quarantine (role held manually, not managed by Bucky) - #
    const renderExternal = async () => {
      const host = root.querySelector("#q-external");
      if (!host) return;
      const [ext, ign] = await Promise.all([
        api.get("/quarantine/external").catch(() => []),
        api.get("/quarantine/external?status=ignored").catch(() => []),
      ]);
      const kids = [];
      if (ext.length || ign.length || canEdit) {
        const head = el("div", { class: "sec-actions", style: "align-items:center" }, [
          el("h3", { class: "sec-page-title", style: "margin:0;flex:1" }, [
            "External Quarantine ", info("Members who currently have the configured Quarantine role but were not put there by Bucky (an admin applied the role by hand)."),
          ]),
        ]);
        if (canEdit) head.append(el("button", { class: "sec-btn sec-btn-sm", text: "Scan now", onclick: async () => {
          try { await api.post("/quarantine/external/scan"); toast("Scan queued — results refresh within a minute."); }
          catch (e) { toast(e.message, "err"); }
        } }));
        kids.push(head);
      }
      if (ext.length) {
        kids.push(el("div", { class: "sec-warn-banner" }, [
          el("span", { class: "ic", text: "⚠️" }),
          el("span", { text: "These members have the Quarantine role but are not managed by Bucky. Adopt to let Bucky manage (and later release) them, or Ignore to hide." }),
        ]));
        for (const u of ext) kids.push(externalCard(u, false));
      }
      if (ign.length) {
        kids.push(el("div", { class: "sec-muted", style: "margin-top:8px", text: `Ignored (${ign.length})` }));
        for (const u of ign) kids.push(externalCard(u, true));
      }
      host.replaceChildren(...kids);
    };

    const externalCard = (u, isIgnored) => {
      const meta = el("div", { class: "sec-ext-meta" }, [
        el("div", {}, [el("strong", { text: u.username || u.user_id })]),
        el("div", { class: "sec-muted", text: `${u.user_id}${u.first_seen ? " · seen " + fmtTime(u.first_seen) : ""}` }),
      ]);
      const left = el("div", { class: "sec-ext-left" }, [
        u.avatar_url ? el("img", { class: "sec-ext-avatar", src: u.avatar_url, alt: "" }) : el("div", { class: "sec-ext-avatar" }),
        meta,
      ]);
      const ctl = el("div", { class: "sec-chain-ctl" });
      if (canEdit) {
        if (isIgnored) {
          ctl.append(el("button", { class: "sec-btn sec-btn-sm", text: "Un-ignore", onclick: async () => {
            try { await api.post(`/quarantine/external/${u.user_id}/ignore`, { unignore: true }); toast("Un-ignored."); renderExternal(); }
            catch (e) { toast(e.message, "err"); } } }));
        } else {
          ctl.append(
            el("button", { class: "sec-btn sec-btn-sm sec-btn-primary", text: "Adopt into Bucky", onclick: async () => {
              try { await api.post(`/quarantine/external/${u.user_id}/adopt`); toast("Adopt queued — Bucky will take over management shortly."); setTimeout(renderExternal, 1500); }
              catch (e) { toast(e.message, "err"); } } }),
            el("button", { class: "sec-btn sec-btn-sm sec-btn-ghost", text: "Ignore", onclick: async () => {
              try { await api.post(`/quarantine/external/${u.user_id}/ignore`); toast("Ignored."); renderExternal(); }
              catch (e) { toast(e.message, "err"); } } }),
          );
        }
      }
      return el("div", { class: `sec-card sec-ext-card ${isIgnored ? "sec-ext-dim" : ""}` }, [left, ctl]);
    };

    try {
      root.appendChild(pageHeader("Quarantine", "Configure the quarantine role and manage quarantined members. Actions are validated and executed by the bot."));
      root.appendChild(configCard());
      root.appendChild(el("div", { id: "q-external", style: "margin-top:18px" }));
      await renderExternal();
      root.appendChild(el("div", { class: "sec-page-title", style: "margin-top:18px", text: "Quarantined members" }));
      const search = el("input", { class: "sec-input", type: "search", placeholder: "Search user / reason…" });
      search.addEventListener("input", debounce(() => { q = search.value.toLowerCase(); draw(); }));
      const statusSel = el("select", { class: "sec-select" }, [
        el("option", { value: "active", text: "Active" }),
        el("option", { value: "released", text: "Released" }),
        el("option", { value: "banned", text: "Banned" }),
      ]);
      statusSel.addEventListener("change", () => { status = statusSel.value; page = 0; load(); });
      root.appendChild(el("div", { class: "sec-toolbar" }, [search, statusSel]));
      root.appendChild(el("div", { id: "q-body" }));
      await load();
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};

function clear(root) { while (root.firstChild) root.removeChild(root.firstChild); return root; }
