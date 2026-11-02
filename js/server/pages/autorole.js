// Autorole - rollen die een nieuw lid automatisch krijgt (server_tools.autorole).
//
// DE LIJST TOONT ELKE ROL, MET HET OORDEEL VAN DE BACKEND ERBIJ. Een rol die de
// bot niet mag geven (te hoog, beheerd, moderator- of adminrechten) staat er
// grijs met de reden, in plaats van pas bij Opslaan te worden geweigerd. Het
// oordeel komt uit backend/api/server_center/role_safety.py; de bot oordeelt
// bij elke join opnieuw. Deze pagina beslist niets.
//
// Geen `html:` en geen innerHTML: rolnamen zijn tekst van de server.
import { api } from "../api.js";
import { el, clear, toast } from "../../security/ui.js";

function kaart(titel, uitleg, inhoud) {
  return el("div", { class: "sec-card", style: "margin-top:16px" }, [
    el("div", { class: "sec-page-title", text: titel }),
    uitleg ? el("p", { class: "sec-muted", style: "margin:0 0 14px", text: uitleg }) : null,
    ...inhoud,
  ].filter(Boolean));
}

function schakelaar(aan, label) {
  const input = el("input", { type: "checkbox", checked: aan ? "checked" : null, "aria-label": label });
  return { input, node: el("label", { class: "sec-switch" }, [input, el("span", { class: "track" })]) };
}

// Een rollenlijst met vinkjes. Gedeeld met verify.js.
export function rollenKiezer(rollen, gekozen, max, label, magKiezen = true) {
  const kies = new Set(gekozen.map(String));
  const teller = el("span", { class: "srv-field-hint", "aria-live": "polite" });
  const tel = () => { teller.textContent = `${kies.size} of ${max} picked`; };
  const lijst = el("div", { class: "srv-rolelist", role: "group", "aria-label": label },
    rollen.map((r) => {
      const input = el("input", {
        type: "checkbox", value: r.id,
        checked: kies.has(r.id) ? "checked" : null,
        // Zonder Rollen beheren is niets te kiezen (de backend weigert het ook).
        disabled: magKiezen && (r.allowed || kies.has(r.id)) ? null : "disabled",
      });
      input.addEventListener("change", () => {
        if (input.checked && kies.size >= max) {
          input.checked = false;
          toast(`At most ${max} roles.`, "err");
          return;
        }
        if (input.checked) kies.add(r.id); else kies.delete(r.id);
        tel();
      });
      const kleur = r.color ? "#" + r.color.toString(16).padStart(6, "0") : "var(--sec-muted, #8b8b9a)";
      return el("label", { class: "srv-role" + (r.allowed ? "" : " is-blocked") }, [
        input,
        el("span", { class: "srv-role-dot", style: `background:${kleur}`, "aria-hidden": "true" }),
        el("span", { class: "srv-role-name", text: "@" + r.name }),
        r.allowed ? null : el("span", { class: "srv-role-why", text: r.reason || "Not allowed" }),
      ].filter(Boolean));
    }));
  tel();
  return { node: el("div", {}, [lijst, teller]), waarde: () => Array.from(kies) };
}

export default {
  async render(root) {
    root.appendChild(el("div", { class: "srv-hero" }, [
      el("h1", { text: "Autorole" }),
      el("p", { text: "Give roles to everybody who joins. People who still have to accept your "
                      + "server rules get them once they have." }),
    ]));
    const host = el("div");
    root.appendChild(host);
    host.appendChild(el("div", { class: "sec-loading", text: "Loading roles…" }));

    let data;
    try {
      data = await api.get("/autorole");
    } catch (err) {
      clear(host);
      host.appendChild(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "This page did not load" }),
        el("p", { class: "sec-muted", text: err.message }),
      ]));
      return;
    }

    function teken() {
      clear(host);
      if (!data.bot_can_manage_roles) {
        host.appendChild(el("div", { class: "sec-card srv-warn", role: "alert" }, [
          el("strong", { text: "Bucky cannot give roles here yet." }),
          el("p", { class: "sec-muted", text: "Give Bucky's role the Manage Roles permission, and move it above the roles you want to hand out." }),
        ]));
      }
      const aan = schakelaar(data.enabled, "Autorole switched on");
      aan.input.addEventListener("change", async () => {
        try {
          data = await api.patch("/autorole", { enabled: aan.input.checked });
          toast(aan.input.checked ? "Autorole is on." : "Autorole is off.");
          teken();
        } catch (err) {
          aan.input.checked = !aan.input.checked;
          toast(err.message, "err");
        }
      });
      const bots = schakelaar(data.include_bots, "Also give roles to bots");
      bots.input.addEventListener("change", async () => {
        try {
          data = await api.patch("/autorole", { include_bots: bots.input.checked });
          toast("Saved.");
        } catch (err) {
          bots.input.checked = !bots.input.checked;
          toast(err.message, "err");
        }
      });
      host.appendChild(kaart("Status", null, [
        el("div", { class: "srv-list" }, [
          el("div", { class: "srv-row", style: "grid-template-columns:1fr auto" }, [
            el("div", { class: "srv-name" }, [el("div", { style: "font-weight:700", text: "Switched on" })]), aan.node]),
          el("div", { class: "srv-row", style: "grid-template-columns:1fr auto" }, [
            el("div", { class: "srv-name" }, [el("div", { style: "font-weight:700", text: "Bots too" })]), bots.node]),
        ]),
      ]));

      const kiezer = rollenKiezer(data.roles || [], data.role_ids || [], (data.limits || {}).max_roles || 5,
                                  "Roles to give", data.can_manage_roles !== false);
      const opslaan = el("button", {
        class: "sec-btn sec-btn-primary sec-btn-sm", type: "button", text: "Save roles",
        onclick: async () => {
          opslaan.disabled = true;
          try {
            data = await api.patch("/autorole", { role_ids: kiezer.waarde() });
            toast("Roles saved.");
            teken();
          } catch (err) {
            toast(err.message, "err");
            opslaan.disabled = false;
          }
        },
      });
      host.appendChild(kaart("Roles",
        data.can_manage_roles === false
          ? "You need the Manage Roles permission to pick roles."
          : "Greyed-out roles cannot be given by a bot: they sit above Bucky or above your own highest role, belong to another app or the Security Center, or carry moderator or admin permissions.",
        [kiezer.node, el("div", { class: "sec-row", style: "margin-top:12px" }, [opslaan])]));
    }
    teken();
  },
};
