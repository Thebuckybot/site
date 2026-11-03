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
import { kiezer } from "../kiezer.js";

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

// De rollenkiezer, gedeeld met verify.js: zoeken, chips, een scrollende lijst
// met alleen wat de bot kan geven, en de rest ingeklapt met de reden
// (js/server/kiezer.js).
export function rollenKiezer(rollen, gekozen, max, label, magKiezen = true) {
  return kiezer({ items: rollen, gekozen, max, label, teken: (r) => "@" + r.name,
                  zoekLabel: "Search roles", magKiezen, leeg: "No roles picked yet." });
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

      const rolKiezer = rollenKiezer(data.roles || [], data.role_ids || [], (data.limits || {}).max_roles || 5,
                                  "Roles to give", data.can_manage_roles !== false);
      const opslaan = el("button", {
        class: "sec-btn sec-btn-primary sec-btn-sm", type: "button", text: "Save roles",
        onclick: async () => {
          opslaan.disabled = true;
          try {
            data = await api.patch("/autorole", { role_ids: rolKiezer.waarde() });
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
          : "Only roles Bucky can give are listed. The others are under Not available, each with the reason: above Bucky or above your own highest role, managed by another app, the Security Center's quarantine role, or moderator or admin permissions.",
        [rolKiezer.node, el("div", { class: "sec-row", style: "margin-top:12px" }, [opslaan])]));
    }
    teken();
  },
};
