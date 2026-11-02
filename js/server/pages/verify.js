// Verify - panelen met een knop die rollen geeft en weghaalt (server_tools.verify).
//
// WAT DEZE PAGINA NIET BESLIST. Welke rol veilig is, welk kanaal bij de server
// hoort en of jij kanaaltoegang mag zetten: dat toetst de backend bij het
// opslaan (backend/api/server_center/server_tools.py) en de bot bij elke klik
// opnieuw (bucky1.0/cogs/verify.py). Wat hier grijs staat, is alleen een
// voorproefje van dat oordeel.
//
// AFBEELDINGEN. Leeg = de standaardkaart met de mascotte. Een eigen plaatje kan
// als upload of als link; een link wordt door de backend VEILIG opgehaald
// (safe_fetch.py: alleen https, geen interne adressen, geen ongecontroleerde
// doorverwijzing) en als eigen kopie bewaard. Discord krijgt nooit de vreemde URL.
//
// Geen `html:` en geen innerHTML: alle tekst gaat via `text:`.
import { api } from "../api.js";
import { el, clear, toast, confirmDialog } from "../../security/ui.js";
import { rollenKiezer } from "./autorole.js";

const STIJLEN = [["success", "Green"], ["primary", "Blurple"], ["secondary", "Grey"], ["danger", "Red"]];
const STANDAARDKAART = "pics/verify-default.png";

function veld(label, control, hint) {
  return el("label", { class: "srv-field" }, [
    el("span", { text: label }), control,
    hint ? el("span", { class: "srv-field-hint", text: hint }) : null,
  ].filter(Boolean));
}

function hex(n) { return "#" + (Number(n) >>> 0).toString(16).padStart(6, "0").slice(-6); }

export default {
  async render(root) {
    root.appendChild(el("div", { class: "srv-hero" }, [
      el("h1", { text: "Verify" }),
      el("p", { text: "A button that gives roles, and can take others away. Use one panel to let "
                      + "people in, and another for a part of the server they opt into." }),
    ]));
    const host = el("div");
    root.appendChild(host);
    host.appendChild(el("div", { class: "sec-loading", text: "Loading panels…" }));

    let data;
    async function laad() { data = await api.get("/verify"); }
    try {
      await laad();
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
      const lim = data.limits || {};
      if (!data.bot_can_manage_roles) {
        host.appendChild(el("div", { class: "sec-card srv-warn", role: "alert" }, [
          el("strong", { text: "Bucky cannot give roles here yet." }),
          el("p", { class: "sec-muted", text: "Give Bucky's role the Manage Roles permission, and move it above the roles a panel hands out." }),
        ]));
      }
      const vol = (data.panels || []).length >= (lim.max_panels || 5);
      host.appendChild(el("div", { class: "sec-row", style: "margin-top:8px" }, [
        el("button", {
          class: "sec-btn sec-btn-primary sec-btn-sm", type: "button", text: "New panel",
          disabled: vol ? "disabled" : null,
          onclick: async () => {
            try {
              await api.post("/verify", { name: `Panel ${(data.panels || []).length + 1}` });
              await laad();
              teken();
            } catch (err) { toast(err.message, "err"); }
          },
        }),
        el("span", { class: "srv-field-hint",
                     text: `${(data.panels || []).length} of ${lim.max_panels || 5} panels` }),
      ]));
      if (!(data.panels || []).length) {
        host.appendChild(el("div", { class: "sec-card srv-empty", style: "margin-top:16px" }, [
          el("h3", { text: "No panels yet" }),
          el("p", { text: "Create one, pick the roles it gives and the channel it goes in, then publish it." }),
        ]));
      }
      for (const p of data.panels || []) host.appendChild(paneelKaart(p));
    }

    function paneelKaart(p) {
      const lim = data.limits || {};
      const naam = el("input", { class: "sec-input", value: p.name, maxlength: "45", "aria-label": "Panel name" });
      const aan = el("input", { type: "checkbox", checked: p.enabled ? "checked" : null, "aria-label": "Panel switched on" });
      const kanaal = el("select", { class: "sec-select", "aria-label": "Channel for the panel" }, [
        el("option", { value: "", text: "Pick a channel…" }),
        ...(data.panel_channels || []).map((k) => el("option", { value: k.id, text: "#" + k.name })),
      ]);
      kanaal.value = p.channel_id || "";
      const vorm = el("select", { class: "sec-select", "aria-label": "Message style" }, [
        el("option", { value: "1", text: "Components V2 card" }),
        el("option", { value: "0", text: "Classic embed" }),
      ]);
      vorm.value = p.use_v2 ? "1" : "0";
      const titel = el("input", { class: "sec-input", value: p.title, maxlength: String(lim.max_title || 100), "aria-label": "Title" });
      const tekst = el("textarea", { class: "sec-input srv-textarea", maxlength: String(lim.max_body || 1000), "aria-label": "Text" });
      tekst.value = p.body || "";
      const knop = el("input", { class: "sec-input", value: p.button_label, maxlength: String(lim.max_button_label || 80), "aria-label": "Button label" });
      const emoji = el("input", { class: "sec-input", value: p.button_emoji || "", maxlength: "64", placeholder: "✅ or <:name:id>", "aria-label": "Button emoji" });
      const stijl = el("select", { class: "sec-select", "aria-label": "Button colour" },
        STIJLEN.map(([v, l]) => el("option", { value: v, text: l })));
      stijl.value = p.button_style || "success";
      const kleur = el("input", { type: "color", value: hex(p.accent || 0x5865F2), "aria-label": "Accent colour" });
      const beeld = el("input", { class: "sec-input", style: "flex:1;min-width:240px", value: p.image_url || "", placeholder: "Empty = the default Verify now card",
                                  "aria-label": "Image address" });
      // DE VOORVERTONING LAADT ALLEEN BUCKY'S EIGEN ADRESSEN. Een getypte vreemde
      // URL laden is een baken dat het IP van de beheerder ziet (en CSP weigert
      // hem toch); bovendien klapte het kapotte plaatje in, verschoof de pagina
      // en miste de klik op "Import from link" zijn knop (gemeten 2-11-2026).
      // Een vaste verhouding houdt de knoppen erboven op hun plek.
      const eigenAdres = (u) => {
        try {
          const url = new URL(u);
          return url.protocol === "https:" && (data.image_hosts || []).includes(url.hostname);
        } catch (_) { return false; }
      };
      const voorbeeld = el("img", { class: "srv-verify-preview", alt: "Panel image preview",
                                    src: eigenAdres(p.image_url) ? p.image_url : STANDAARDKAART });
      beeld.addEventListener("change", () => {
        const v = beeld.value.trim();
        if (!v) voorbeeld.src = STANDAARDKAART;
        else if (eigenAdres(v)) voorbeeld.src = v;
      });

      const bestand = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp",
                                    "aria-label": "Upload an image", style: "max-width:240px" });
      bestand.addEventListener("change", async () => {
        const f = bestand.files && bestand.files[0];
        if (!f) return;
        try {
          const uit = await api.upload("/welcome/images", f);
          beeld.value = uit.url; voorbeeld.src = uit.url;
          toast("Image uploaded. Save the panel to use it.");
        } catch (err) { toast(err.message, "err"); }
        bestand.value = "";
      });
      const importeer = el("button", {
        class: "sec-btn sec-btn-sm", type: "button", text: "Import from link",
        title: "Bucky fetches the image once, checks it and keeps its own copy",
        onclick: async () => {
          const url = beeld.value.trim();
          if (!url) { toast("Paste an https:// link to an image first.", "err"); return; }
          importeer.disabled = true;
          try {
            const uit = await api.post("/images/import", { url });
            beeld.value = uit.url; voorbeeld.src = uit.url;
            toast("Image imported. Save the panel to use it.");
          } catch (err) { toast(err.message, "err"); }
          importeer.disabled = false;
        },
      });

      const magRollen = data.can_manage_roles !== false;
      const geven = rollenKiezer(data.roles || [], p.add_role_ids || [], lim.max_add || 5, "Roles to give", magRollen);
      const nemen = rollenKiezer(data.roles || [], p.remove_role_ids || [], lim.max_remove || 5, "Roles to take away", magRollen);
      const kanaalKeuze = new Set(p.channel_ids || []);
      const kanalen = el("div", { class: "srv-rolelist", role: "group", "aria-label": "Channels this panel opens" },
        (data.access_channels || []).map((k) => {
          const input = el("input", { type: "checkbox", value: k.id,
                                      checked: kanaalKeuze.has(k.id) ? "checked" : null,
                                      disabled: data.can_manage_channels || kanaalKeuze.has(k.id) ? null : "disabled" });
          input.addEventListener("change", () => {
            if (input.checked && kanaalKeuze.size >= (lim.max_channels || 10)) {
              input.checked = false; toast(`At most ${lim.max_channels || 10} channels.`, "err"); return;
            }
            if (input.checked) kanaalKeuze.add(k.id); else kanaalKeuze.delete(k.id);
          });
          return el("label", { class: "srv-role" }, [input, el("span", { class: "srv-role-name", text: (k.type === 4 ? "▸ " : "#") + k.name })]);
        }));

      async function bewaar() {
        const uit = await api.patch(`/verify/${p.id}`, {
          name: naam.value, enabled: aan.checked, channel_id: kanaal.value || null,
          use_v2: vorm.value === "1", title: titel.value, body: tekst.value,
          button_label: knop.value, button_emoji: emoji.value, button_style: stijl.value,
          accent: parseInt(kleur.value.slice(1), 16), image_url: beeld.value.trim(),
          add_role_ids: geven.waarde(), remove_role_ids: nemen.waarde(),
          channel_ids: Array.from(kanaalKeuze),
        });
        Object.assign(p, uit);
        return uit;
      }

      const knoppen = el("div", { class: "sec-row", style: "margin-top:14px;flex-wrap:wrap;gap:8px" }, [
        el("button", { class: "sec-btn sec-btn-primary sec-btn-sm", type: "button", text: "Save",
                       onclick: async () => { try { await bewaar(); toast("Panel saved."); } catch (err) { toast(err.message, "err"); } } }),
        el("button", { class: "sec-btn sec-btn-sm", type: "button", text: p.message_id ? "Save and update in Discord" : "Save and publish",
                       onclick: async () => {
                         try {
                           await bewaar();
                           const uit = await api.post(`/verify/${p.id}/publish`, {});
                           toast(uit.channel_access_applied ? "Published, and channel access was set." : "Published.");
                           await laad(); teken();
                         } catch (err) { toast(err.message, "err"); }
                       } }),
        el("button", { class: "sec-btn sec-btn-danger sec-btn-sm", type: "button", text: "Delete",
                       onclick: async () => {
                         const ok = await confirmDialog({ title: "Delete this panel?",
                           message: "The message in Discord stays, but its button stops working. Channel access Bucky gave stays as it is.",
                           danger: true, confirmLabel: "Delete" });
                         if (!ok) return;
                         try { await api.del(`/verify/${p.id}`); await laad(); teken(); toast("Panel deleted."); }
                         catch (err) { toast(err.message, "err"); }
                       } }),
      ]);

      return el("div", { class: "sec-card", style: "margin-top:16px" }, [
        el("div", { class: "srv-panel-head" }, [
          el("div", { class: "sec-page-title", text: p.name || `Panel ${p.id}` }),
          el("span", { class: `srv-state ${p.message_id ? "is-on" : ""}`, text: p.message_id ? "Published" : "Not published" }),
        ]),
        el("div", { class: "srv-grid2" }, [
          veld("Name", naam, "Only you see this."),
          veld("Switched on", el("label", { class: "sec-switch" }, [aan, el("span", { class: "track" })]),
               "Off: the button answers that the panel is off."),
          veld("Channel", kanaal, "Where the panel is posted."),
          veld("Style", vorm, "If Discord refuses the V2 card, Bucky posts a classic embed."),
          veld("Title", titel, null),
          veld("Button label", knop, null),
          veld("Button emoji", emoji, "Optional."),
          veld("Button colour", stijl, null),
          veld("Accent colour", kleur, null),
        ]),
        veld("Text", tekst, null),
        el("div", { style: "margin-top:14px" }, [
          el("div", { style: "font-weight:700", text: "Image or gif" }),
          el("div", { class: "sec-row", style: "gap:8px;flex-wrap:wrap;margin-top:6px" }, [beeld, importeer, bestand]),
          el("span", { class: "srv-field-hint", text: "https only, PNG, JPEG, GIF or WebP, at most 2 MB. Links are fetched once and kept as Bucky's own copy." }),
          voorbeeld,
        ]),
        el("div", { style: "margin-top:16px" }, [el("div", { style: "font-weight:700", text: "Roles to give" }), geven.node]),
        el("div", { style: "margin-top:16px" }, [el("div", { style: "font-weight:700", text: "Roles to take away" }), nemen.node]),
        el("div", { style: "margin-top:16px" }, [
          el("div", { style: "font-weight:700", text: "Channels this opens" }),
          el("p", { class: "sec-muted", style: "margin:2px 0 6px",
                    text: data.can_manage_channels
                      ? "On publish, the first role to give can see these channels. Bucky only adds view access; taking a channel off this list does not remove it again."
                      : "You need the Manage Channels and Manage Roles permissions to give access to channels." }),
          kanalen,
        ]),
        knoppen,
      ]);
    }

    teken();
  },
};
