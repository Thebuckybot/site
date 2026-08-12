import { api } from "../api.js";
import { el, pageHeader, table, toggle, toast, errorState, formModal, confirmDialog, info, emptyCard } from "../ui.js";
import { settingDesc } from "../descriptions.js";

export default {
  async render(root) {
    let data = null;
    let canEdit = false;
    const load = async () => {
      const [d, perms] = await Promise.all([api.get("/protection"), api.me()]);
      data = d; canEdit = !!(perms && perms.can_edit); draw();
    };

    const addTrust = async (type) => {
      const vals = await formModal({
        title: `Add trusted ${type}`,
        fields: [{ name: "ref_id", label: `${type === "role" ? "Role" : "User"} ID`, placeholder: "Discord ID" }],
      });
      if (!vals || !vals.ref_id) return;
      try { await api.post("/trust", { trust_type: type, ref_id: vals.ref_id }); toast("Added."); await load(); }
      catch (e) { toast(e.message, "err"); }
    };
    const removeTrust = async (t) => {
      if (!(await confirmDialog({ title: "Remove trust", message: "Remove this trusted entry?", danger: true, confirmLabel: "Remove" }))) return;
      try { await api.del(`/trust/${t.id}`); toast("Removed."); await load(); }
      catch (e) { toast(e.message, "err"); }
    };
    const setImmunity = async (field, val) => {
      try { await api.post("/protection", { [field]: val }); toast("Updated."); }
      catch (e) { toast(e.message, "err"); await load(); }
    };

    const draw = () => {
      const body = root.querySelector("#prot-body");
      const immunity = el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "Immunity" }),
        el("div", { class: "sec-row", style: "margin:8px 0" }, [
          toggle(data.admin_immunity, (v) => setImmunity("admin_immunity", v)),
          el("span", {}, ["Administrator immunity ", info(settingDesc("admin_immunity"))]),
        ]),
        el("div", { class: "sec-row" }, [
          toggle(data.owner_only_immunity, (v) => setImmunity("owner_only_immunity", v)),
          el("span", {}, ["Owner-only immunity (strictest) ", info(settingDesc("owner_only_immunity"))]),
        ]),
      ]);
      const roleCol = [
        { label: "Trusted Role", render: (t) => el("code", { text: t.ref_id }) },
        { label: "", render: (t) => canEdit ? el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "Remove", onclick: () => removeTrust(t) }) : el("span", { class: "sec-muted", text: "-" }) },
      ];
      const userCol = [
        { label: "Protected User", render: (t) => el("code", { text: t.ref_id }) },
        { label: "", render: (t) => canEdit ? el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "Remove", onclick: () => removeTrust(t) }) : el("span", { class: "sec-muted", text: "-" }) },
      ];

      const roleHead = el("div", { class: "sec-actions", style: "margin-top:16px" }, [
        el("h3", { class: "sec-page-title", style: "margin:0;flex:1" }, ["Trusted Roles ", info(settingDesc("protection_role_setting"))]),
      ]);
      if (canEdit) roleHead.appendChild(el("button", { class: "sec-btn sec-btn-primary sec-btn-sm", text: "+ Add Role", onclick: () => addTrust("role") }));
      const userHead = el("div", { class: "sec-actions", style: "margin-top:16px" }, [
        el("h3", { class: "sec-page-title", style: "margin:0;flex:1" }, ["Protected Users ", info(settingDesc("protected_user"))]),
      ]);
      if (canEdit) userHead.appendChild(el("button", { class: "sec-btn sec-btn-primary sec-btn-sm", text: "+ Add User", onclick: () => addTrust("user") }));

      const rolesBlock = data.trusted_roles.length
        ? table(roleCol, data.trusted_roles)
        : emptyCard({ title: "No trusted roles configured", message: "Add a staff role here and anti-nuke will ignore its members. Keep it to people you trust with mass actions.", actionLabel: canEdit ? "Add Role" : null, onAction: () => addTrust("role") });
      const usersBlock = data.trusted_users.length
        ? table(userCol, data.trusted_users)
        : emptyCard({ title: "No protected users configured", message: "Individual users added here are ignored by anti-nuke. Most servers rely on a trusted role instead.", actionLabel: canEdit ? "Add User" : null, onAction: () => addTrust("user") });

      body.replaceChildren(immunity, roleHead, rolesBlock, userHead, usersBlock);
    };

    try {
      root.appendChild(pageHeader("Protection", "Trusted roles and users are ignored by anti-nuke. Immunity is scoped and configurable."));
      root.appendChild(el("div", { id: "prot-body" }));
      await load();
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
