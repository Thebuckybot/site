import { api } from "../api.js";
import { el, badge, toast, errorState, infoTitle, info, emptyCard, formModal } from "../ui.js";
import { settingDesc } from "../descriptions.js";

// Settings: general config + data retention + the channel/role provisioning the
// website previously could not reach (alert channel, security logging channel,
// quarantine role). Parity with the Discord wizard, which only *picks* these.
export default {
  async render(root) {
    try {
      const [s, perms] = await Promise.all([api.get("/settings"), api.me()]);
      const canEdit = !!(perms && perms.can_edit);

      root.appendChild(infoTitle("Settings", "General configuration, provisioning and data retention for this server."));
      root.appendChild(el("p", { class: "sec-page-sub", text: "The bot is always the authority - these settings are validated and applied server-side." }));

      // ---- General -------------------------------------------------------
      root.appendChild(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "General" }),
        row("Mode", badge(String(s.mode).toUpperCase(), s.mode === "hard" ? "warn" : "ok"), settingDesc("mode")),
        row("Administrator immunity", el("span", { text: s.admin_immunity ? "On" : "Off" }), settingDesc("admin_immunity")),
        row("Owner-only immunity", el("span", { text: s.owner_only_immunity ? "On" : "Off" }), settingDesc("owner_only_immunity")),
        row("Config version", el("code", { text: s.config_version }), "Increments on every change; the bot reloads its cache when it changes."),
      ]));

      // ---- Channels & Roles (new) ---------------------------------------
      const chanCard = el("div", { class: "sec-card", style: "margin-top:16px" }, [
        infoTitle("Channels & Roles", "Where Security posts alerts and which role is applied to quarantined members.", "div", "sec-page-title"),
      ]);
      chanCard.appendChild(provisionRow({
        label: "Alert channel", descKey: "alert_channel", value: s.alert_channel_id,
        emptyMsg: "No alert channel configured. Security has nowhere to post what it catches.",
        field: "alert_channel_id", kind: "channel", canEdit, refresh: () => this.render(clearRoot(root)),
      }));
      chanCard.appendChild(provisionRow({
        label: "Security logging channel", descKey: "logging_channel", value: s.logging_channel_id,
        emptyMsg: "No separate security logging channel. Alerts and logs share the alert channel.",
        field: "logging_channel_id", kind: "channel", canEdit, refresh: () => this.render(clearRoot(root)),
      }));
      chanCard.appendChild(provisionRow({
        label: "Quarantine role", descKey: "quarantine_role", value: s.quarantine_role_id,
        emptyMsg: "No quarantine role configured. Quarantine will create one on first use, or set your own here.",
        field: "quarantine_role_id", kind: "role", canEdit, refresh: () => this.render(clearRoot(root)),
      }));
      root.appendChild(chanCard);

      // ---- Retention -----------------------------------------------------
      // One ladder (`options`), and per server the rungs it may pick
      // (`selectable`, everything up to its `retention_max_days`). The rungs
      // above the ceiling are shown disabled with the thing that lifts the
      // ceiling. There is no "Unlimited" any more and no tier list: two states.
      const ret = s.retention || {};
      const selectable = ret.selectable || [14];
      const options = ret.options || selectable;
      const sel = el("select", { class: "sec-select", disabled: !canEdit });
      options.forEach((d) => {
        const allowed = selectable.includes(d);
        const o = el("option", { value: d, text: `${d} days${allowed ? "" : " (needs a Security Boost)"}` });
        if (!allowed) o.disabled = true;
        if (d === s.retention_days) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", async () => {
        try { await api.post("/settings/retention", { retention_days: Number(sel.value) }); toast("Retention updated."); }
        catch (e) { toast(e.message, "err"); sel.value = String(s.retention_days); }
      });
      root.appendChild(el("div", { class: "sec-card", style: "margin-top:16px" }, [
        infoTitle("Data Retention", settingDesc("retention"), "div", "sec-page-title"),
        el("p", { class: "sec-muted", text: "Incidents, audit logs and analytics older than this window are removed automatically." }),
        el("div", { class: "sec-settings-row" }, [el("div", { class: "k" }, [el("div", { text: "Keep security data for" })]), sel]),
        // GEEN BELOFTE MEER OVER PREMIUM. Hier stond "Longer retention windows
        // are available on Bucky Premium", en dat was niet waar: RETENTION_SELECTABLE
        // in de backend bevat alleen 14, en plan_for_guild() leest helemaal geen
        // entitlement. Er is dus geen aankoop die dit ontgrendelt. Een betaalde
        // functie noemen die niet bestaat is precies het soort belofte waar de
        // rest van deze ronde is opgeruimd.
        el("p", { class: "sec-muted", text: "Every server keeps security data for 14 days." }),
      ]));
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};

function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); return root; }

function row(label, valueNode, desc) {
  const k = el("div", { class: "k" }, [el("div", { text: label })]);
  if (desc) k.appendChild(el("div", { class: "desc", text: desc }));
  return el("div", { class: "sec-settings-row" }, [k, valueNode]);
}

// One provisioning row: label + tooltip, current value or an informative empty
// state, and (if the caller may edit) Set / Clear controls that POST to the
// backend. IDs are entered as Discord IDs, matching the existing trust page.
function provisionRow({ label, descKey, value, emptyMsg, field, kind, canEdit, refresh }) {
  const k = el("div", { class: "k" }, [el("div", {}, [label + " ", info(settingDesc(descKey))])]);
  const right = el("div", { class: "sec-provision-val" });

  if (value) {
    const ref = kind === "role"
      ? el("code", { class: "sec-ref", text: `role ${value}` })
      : el("code", { class: "sec-ref", text: `#${value}` });
    right.appendChild(ref);
  } else {
    right.appendChild(el("span", { class: "sec-muted", text: emptyMsg }));
  }

  if (canEdit) {
    const setBtn = el("button", { class: "sec-btn sec-btn-sm sec-btn-primary", text: value ? "Change" : "Set" });
    setBtn.addEventListener("click", async () => {
      const vals = await formModal({
        title: `Set ${label.toLowerCase()}`,
        fields: [{ name: "id", label: `${kind === "role" ? "Role" : "Channel"} ID`, placeholder: "Right-click → Copy ID" }],
        submitLabel: "Save",
      });
      if (!vals || !vals.id) return;
      try { await api.post("/settings/channels", { [field]: vals.id.trim() }); toast(`${label} updated.`); refresh(); }
      catch (e) { toast(e.message, "err"); }
    });
    right.appendChild(setBtn);
    if (value) {
      const clr = el("button", { class: "sec-btn sec-btn-sm sec-btn-ghost", text: "Clear" });
      clr.addEventListener("click", async () => {
        try { await api.post("/settings/channels", { [field]: "" }); toast(`${label} cleared.`); refresh(); }
        catch (e) { toast(e.message, "err"); }
      });
      right.appendChild(clr);
    }
  }
  return el("div", { class: "sec-settings-row" }, [k, right]);
}
