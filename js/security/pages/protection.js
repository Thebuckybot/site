import { api } from "../api.js";
import { el, pageHeader, table, toggle, toast, errorState, formModal, confirmDialog } from "../ui.js";

export default {
  async render(root) {
    let data = null;
    const load = async () => { data = await api.get("/protection"); draw(); };

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
          el("span", { text: "Administrator immunity" }),
        ]),
        el("div", { class: "sec-row" }, [
          toggle(data.owner_only_immunity, (v) => setImmunity("owner_only_immunity", v)),
          el("span", { text: "Owner-only immunity (strictest)" }),
        ]),
      ]);
      const roleCol = [
        { label: "Trusted Role", render: (t) => el("code", { text: t.ref_id }) },
        { label: "", render: (t) => el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "Remove", onclick: () => removeTrust(t) }) },
      ];
      const userCol = [
        { label: "Protected User", render: (t) => el("code", { text: t.ref_id }) },
        { label: "", render: (t) => el("button", { class: "sec-btn sec-btn-sm sec-btn-danger", text: "Remove", onclick: () => removeTrust(t) }) },
      ];
      body.replaceChildren(
        immunity,
        el("div", { class: "sec-actions", style: "margin-top:16px" }, [
          el("h3", { class: "sec-page-title", style: "margin:0;flex:1", text: "Trusted Roles" }),
          el("button", { class: "sec-btn sec-btn-primary sec-btn-sm", text: "+ Add Role", onclick: () => addTrust("role") }),
        ]),
        table(roleCol, data.trusted_roles),
        el("div", { class: "sec-actions", style: "margin-top:16px" }, [
          el("h3", { class: "sec-page-title", style: "margin:0;flex:1", text: "Protected Users" }),
          el("button", { class: "sec-btn sec-btn-primary sec-btn-sm", text: "+ Add User", onclick: () => addTrust("user") }),
        ]),
        table(userCol, data.trusted_users),
      );
    };

    try {
      root.appendChild(pageHeader("Protection", "Trusted roles and users are ignored by anti-nuke. Immunity is scoped and configurable."));
      root.appendChild(el("div", { id: "prot-body" }));
      await load();
    } catch (err) { errorState(root, err, () => this.render(root)); }
  },
};
