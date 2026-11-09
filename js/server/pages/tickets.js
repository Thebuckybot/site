// Tickets — waar leden in het geheim om hulp kunnen vragen.
//
// DE VOLGORDE VAN DE KAARTEN IS DE VOLGORDE VAN HET OPZETTEN: eerst of het
// aanstaat, dan waar het speelt (kanalen en rol), dan de grenzen, dan welke
// soorten er te kiezen zijn. Wie hier voor het eerst komt, leest van boven naar
// beneden en is klaar.
//
// WAT HET WEB NIET DOET, EN WAAROM HET ER TOCH STAAT. Het paneel publiceren en
// kanalen aanmaken (Auto Setup) doet de BOT, want daar hoort het thuis: die
// heeft de rechten en maakt de kanalen met de juiste overrides aan. Het scherm
// zegt dat met zoveel woorden in plaats van een knop te tonen die stilletjes
// niets doet.
import { api } from "../api.js";
import { el, clear, toast, openModal } from "../../security/ui.js";

function kaart(titel, uitleg, inhoud) {
  return el("div", { class: "sec-card", style: "margin-top:16px" }, [
    el("div", { class: "sec-page-title", text: titel }),
    uitleg ? el("p", { class: "sec-muted", style: "margin:0 0 14px", text: uitleg }) : null,
    ...inhoud,
  ].filter(Boolean));
}

function rij(label, control, hint) {
  return el("div", { class: "srv-row", style: "grid-template-columns:1fr auto" }, [
    el("div", { class: "srv-name" }, [
      el("div", {}, [
        el("div", { style: "font-weight:700", text: label }),
        hint ? el("div", { class: "sec-muted", style: "font-size:12px", text: hint }) : null,
      ].filter(Boolean)),
    ]),
    control,
  ]);
}

function veld(label, control, hint) {
  return el("label", { class: "srv-field" }, [
    el("span", { text: label }), control,
    hint ? el("span", { class: "srv-field-hint", text: hint }) : null,
  ].filter(Boolean));
}

function keuzelijst(opties, waarde, leeg, onChange) {
  const select = el("select", { class: "sec-select", onchange: (e) => onChange(e.target.value || null) },
    [el("option", { value: "", text: leeg }),
     ...opties.map((o) => el("option", { value: o.id, text: o.name }))]);
  select.value = waarde || "";
  return select;
}

export default {
  async render(root, { navigate }) {
    root.appendChild(el("div", { class: "srv-hero" }, [
      el("h1", { text: "Tickets" }),
      el("p", { text: "Members open a private channel with your team. You choose where those channels live, who can see them, and how many someone may have open at once." }),
    ]));

    const host = el("div");
    root.appendChild(host);
    host.appendChild(el("div", { class: "sec-loading", text: "Loading tickets…" }));

    let data;
    try {
      data = await api.get("/tickets");
    } catch (err) {
      clear(host);
      host.appendChild(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "The ticket settings did not load" }),
        el("p", { class: "sec-muted", text: err.message }),
        el("button", {
          class: "sec-btn sec-btn-sm", type: "button", text: "Try again",
          onclick: () => { clear(root); this.render(root, { navigate }); },
        }),
      ]));
      return;
    }

    const s = data.settings;
    const tekstkanalen = (data.channels || []).filter((k) => k.type !== 4);
    const categorieen = (data.channels || []).filter((k) => k.type === 4);

    async function bewaar(velden, wat) {
      try {
        Object.assign(s, await api.patch("/tickets", velden));
        toast(`${wat} saved.`);
        teken();
      } catch (err) {
        toast(err.message, "err");
      }
    }

    // HET BEWERKVENSTER PER TYPE (3-11-2026). Alles van een type op een plek:
    // naam, aan/uit, welkomsttekst en het formulier. Daarvoor stonden de
    // welkomsttekst en de vragen in twee losse kaarten onderaan de pagina, met
    // elk een eigen keuzelijst voor het type, en vond niemand het formulier.
    //
    // HET FORMULIER IS EEN DISCORD-MODAL: hoogstens vijf vragen, een vraag van
    // hoogstens 45 tekens. De antwoorden komen bovenaan het ticket in een kaart,
    // in codeblokken: een lid kan er geen opmaak, links of pings mee maken
    // (bucky1.0/cogs/tickets/views.py, answers_card).
    let vragen = {};                // {type_key: [vraag, ...]}
    let vraagLimieten = {};
    let vragenGeladen = false;

    async function laadVragen() {
      if (!data.forms || vragenGeladen) return;
      try {
        const uit = await api.get("/tickets/questions");
        vragen = uit.questions || {};
        vraagLimieten = uit.limits || {};
        vragenGeladen = true;
      } catch (err) {
        toast(`The forms did not load: ${err.message}`, "err");
      }
    }

    function vraagTelling(t) {
      const n = (vragen[t.key] || []).length;
      return n ? `Form: ${n} question${n === 1 ? "" : "s"}` : "No form";
    }

    function bewerkType(t) {
      const maxVragen = vraagLimieten.max_questions || 5;
      const maxLabel = vraagLimieten.max_label || 45;
      const maxHint = vraagLimieten.max_placeholder || 100;
      const maxAntwoord = vraagLimieten.max_answer || 1000;
      const maxWelkom = data.max_welcome_text || 1000;
      let werk = (vragen[t.key] || []).map((v) => ({ ...v }));
      let formulierAan = werk.length > 0;

      const naam = el("input", { class: "sec-input", value: t.label, maxlength: "45",
                                 placeholder: t.default_label, "aria-label": "Name" });
      const aanInput = el("input", { type: "checkbox", checked: t.enabled ? "checked" : null,
                                     "aria-label": "Members can pick this type" });

      // Welkomsttekst (tickets v2).
      let welkom = null;
      const welkomSectie = el("div", { class: "srv-editor-sec" }, [el("h4", { text: "Welcome text" })]);
      if (data.v2) {
        welkom = el("textarea", { class: "sec-input srv-textarea", rows: "4", maxlength: String(maxWelkom),
                                  "aria-label": "Welcome text",
                                  placeholder: "Thanks {user}! Tell us what happened and add screenshots if you have them." });
        welkom.value = t.welcome_text || "";
        const teller = el("span", { class: "srv-field-hint", "aria-live": "polite" });
        const tel = () => { teller.textContent = `${welkom.value.length} / ${maxWelkom}`; };
        welkom.addEventListener("input", tel);
        tel();
        const ph = (data.welcome_placeholders || []).map((x) => "{" + x + "}").join(", ");
        welkomSectie.append(
          el("p", { class: "sec-muted", style: "margin:0", text: "Shown at the top of a new ticket of this type. Empty means Bucky's standard line." + (ph ? ` You can use ${ph}.` : "") }),
          welkom, teller);
      } else {
        welkomSectie.append(el("p", { class: "sec-muted", style: "margin:0",
          text: "A welcome text per type comes with the new ticket panel, which is not switched on for this server yet." }));
      }

      // Emoji en eigen staff-rol (tickets v2, migratie 0125). Zonder de migratie
      // (`type_appearance` false) toont het scherm deze sectie niet.
      let emojiInput = null;
      let rolKeuze = null;
      const uiterlijkSectie = el("div", { class: "srv-editor-sec" });
      if (data.type_appearance) {
        uiterlijkSectie.appendChild(el("h4", { text: "Emoji and staff role" }));
        emojiInput = el("input", { class: "sec-input", value: t.emoji || "", maxlength: "64",
                                   placeholder: "🐞 or <:name:id>", "aria-label": "Emoji next to the type in the picker" });
        rolKeuze = el("select", { class: "sec-input", "aria-label": "Staff role for this type" });
        rolKeuze.appendChild(el("option", { value: "", text: "General support role" }));
        (data.staff_roles || []).forEach((r) => {
          const o = el("option", { value: r.id, text: "@" + r.name + (r.allowed ? "" : ` (${r.reason || "not allowed"})`) });
          if (!r.allowed && r.id !== t.staff_role_id) o.disabled = true;
          rolKeuze.appendChild(o);
        });
        rolKeuze.value = t.staff_role_id || "";
        uiterlijkSectie.append(
          el("p", { class: "sec-muted", style: "margin:0",
            text: "The emoji shows next to this type in the picker. The staff role sees, claims and closes tickets of this type and is pinged instead of the general support role. Roles with moderator permissions are not allowed." }),
          el("label", { class: "srv-field-label", text: "Emoji" }), emojiInput,
          el("label", { class: "srv-field-label", text: "Staff role" }), rolKeuze);
      }

      // Het formulier.
      const formSectie = el("div", { class: "srv-editor-sec" });
      const voorbeeld = el("div", { class: "srv-form-preview", "aria-label": "Preview of the form", role: "img" });
      function tekenVoorbeeld() {
        clear(voorbeeld);
        voorbeeld.appendChild(el("div", { class: "srv-form-preview-title", text: `Ticket: ${naam.value.trim() || t.default_label}`.slice(0, 45) }));
        werk.forEach((v) => {
          voorbeeld.appendChild(el("div", { class: "srv-form-preview-label" }, [
            document.createTextNode(v.label || "Question"),
            v.required ? el("span", { class: "ster", text: "*", "aria-hidden": "true" }) : null,
          ].filter(Boolean)));
          voorbeeld.appendChild(el("div", { class: "srv-form-preview-box" + (v.style === "paragraph" ? " is-long" : ""),
                                            text: v.placeholder || "" }));
        });
      }
      function tekenFormulier() {
        clear(formSectie);
        formSectie.appendChild(el("h4", { text: "Form" }));
        if (!data.forms) {
          formSectie.appendChild(el("p", { class: "sec-muted", style: "margin:0", text: "Ticket forms are switched off right now." }));
          return;
        }
        if (!formulierAan) {
          formSectie.append(
            el("p", { class: "sec-muted", style: "margin:0 0 10px", text: "This type has no form. Without a form, the ticket opens straight away." }),
            el("button", { class: "sec-btn sec-btn-sm", type: "button", text: "Add form",
                           onclick: () => {
                             formulierAan = true;
                             if (!werk.length) werk.push({ label: "", placeholder: "", style: "short", required: true, max_length: 300 });
                             tekenFormulier();
                             const eerste = formSectie.querySelector("input");
                             if (eerste) eerste.focus();
                           } }));
          return;
        }
        formSectie.appendChild(el("p", { class: "sec-muted", style: "margin:0",
          text: `Only for this type. A member answers these before the ticket opens; the answers are the first card in the ticket. At most ${maxVragen} questions: that is the most Discord allows in one form.` }));
        const lijst = el("div");
        werk.forEach((v, i) => {
          const label = el("input", { class: "sec-input", value: v.label, maxlength: String(maxLabel),
                                      placeholder: "Question", "aria-label": `Question ${i + 1}` });
          label.addEventListener("input", () => { v.label = label.value; tekenVoorbeeld(); });
          const hint = el("input", { class: "sec-input", value: v.placeholder || "", maxlength: String(maxHint),
                                     placeholder: "Hint inside the box (optional)", "aria-label": `Hint for question ${i + 1}` });
          hint.addEventListener("input", () => { v.placeholder = hint.value; tekenVoorbeeld(); });
          const stijl = el("select", { class: "sec-select", "aria-label": `Answer type for question ${i + 1}` }, [
            el("option", { value: "short", text: "Short answer" }), el("option", { value: "paragraph", text: "Long answer" })]);
          stijl.value = v.style || "short";
          stijl.addEventListener("change", () => { v.style = stijl.value; tekenVoorbeeld(); });
          const nodig = el("input", { type: "checkbox", checked: v.required ? "checked" : null,
                                      "aria-label": `Question ${i + 1} required` });
          nodig.addEventListener("change", () => { v.required = nodig.checked; tekenVoorbeeld(); });
          const lengte = el("input", { class: "sec-input sec-input-num", type: "number", min: "1", max: String(maxAntwoord),
                                       value: String(v.max_length || 300), "aria-label": `Longest answer for question ${i + 1}` });
          lengte.addEventListener("change", () => {
            v.max_length = Math.max(1, Math.min(maxAntwoord, Number(lengte.value) || 300));
            lengte.value = String(v.max_length);
          });
          const schuif = (stap) => { const j = i + stap; [werk[i], werk[j]] = [werk[j], werk[i]]; tekenFormulier(); };
          lijst.appendChild(el("div", { class: "srv-form-q" }, [
            el("div", { class: "srv-form-q-head" }, [
              el("strong", { text: `Question ${i + 1}` }),
              el("button", { class: "sec-btn sec-btn-ghost sec-btn-sm", type: "button", text: "Up",
                             "aria-label": `Move question ${i + 1} up`, disabled: i === 0 ? "disabled" : null,
                             onclick: () => schuif(-1) }),
              el("button", { class: "sec-btn sec-btn-ghost sec-btn-sm", type: "button", text: "Down",
                             "aria-label": `Move question ${i + 1} down`, disabled: i === werk.length - 1 ? "disabled" : null,
                             onclick: () => schuif(1) }),
              el("button", { class: "sec-btn sec-btn-ghost sec-btn-sm", type: "button", text: "Remove",
                             "aria-label": `Remove question ${i + 1}`,
                             onclick: () => { werk.splice(i, 1); if (!werk.length) formulierAan = false; tekenFormulier(); } }),
            ]),
            label, hint, stijl,
            el("div", { class: "sec-row", style: "gap:12px;flex-wrap:wrap;align-items:center" }, [
              el("label", { class: "srv-field-hint" }, [nodig, document.createTextNode(" Required")]),
              el("label", { class: "srv-field-hint" }, [document.createTextNode("Longest answer "), lengte]),
            ]),
          ]));
        });
        const vol = werk.length >= maxVragen;
        formSectie.append(lijst, el("div", { class: "sec-row", style: "margin-top:10px;gap:10px;flex-wrap:wrap" }, [
          el("button", { class: "sec-btn sec-btn-sm", type: "button", text: "Add question",
                         disabled: vol ? "disabled" : null,
                         onclick: () => { werk.push({ label: "", placeholder: "", style: "short", required: true, max_length: 300 }); tekenFormulier(); } }),
          el("span", { class: "srv-field-hint", "aria-live": "polite",
                       text: vol ? `${werk.length} of ${maxVragen} questions: Discord allows no more in one form.` : `${werk.length} of ${maxVragen} questions` }),
          el("button", { class: "sec-btn sec-btn-ghost sec-btn-sm", type: "button", text: "Remove form",
                         onclick: () => { werk = []; formulierAan = false; tekenFormulier(); } }),
        ]));
        formSectie.append(el("div", { class: "srv-field-hint", style: "margin-top:12px", text: "Preview" }), voorbeeld);
        tekenVoorbeeld();
      }
      naam.addEventListener("input", tekenVoorbeeld);
      tekenFormulier();

      const steun = (data.roles || []).find((r) => r.id === s.support_role_id);
      const opslaan = el("button", { class: "sec-btn sec-btn-primary", type: "button", text: "Save" });
      const modal = el("div", { class: "sec-modal srv-type-editor", role: "dialog", "aria-modal": "true",
                                "aria-label": `Edit ${t.label}` }, [
        el("h3", { text: `Edit ${t.label}` }),
        el("p", { class: "sec-muted", style: "margin:0",
                  text: `${t.description}. Channels are named ${t.prefix}-<member>.` }),
        el("div", { class: "srv-grid2", style: "margin-top:14px" }, [
          veld("Name", naam, "What members see in the list."),
          veld("Available", el("label", { class: "sec-switch" }, [aanInput, el("span", { class: "track" })]),
               "Off: members cannot pick this type."),
        ]),
        el("div", { class: "srv-editor-sec" }, [
          el("h4", { text: "Staff" }),
          el("p", { class: "sec-muted", style: "margin:0",
                    text: steun ? `Every ticket is handled by @${steun.name}. Change it under Channels and roles.`
                                : "No support role yet. Pick one under Channels and roles." }),
        ]),
        welkomSectie,
        uiterlijkSectie,
        formSectie,
        el("div", { class: "sec-modal-actions" }, [
          el("button", { class: "sec-btn sec-btn-ghost", type: "button", text: "Cancel", onclick: () => sluit() }),
          opslaan,
        ]),
      ]);

      opslaan.addEventListener("click", async () => {
        if (formulierAan && werk.some((v) => !String(v.label || "").trim())) {
          toast("Every question needs a text, or remove it.", "err");
          return;
        }
        opslaan.disabled = true;
        try {
          if (naam.value.trim() !== t.label || aanInput.checked !== !!t.enabled) {
            const uit = await api.patch("/tickets/types", { key: t.key, label: naam.value, enabled: aanInput.checked, position: t.position });
            t.label = uit.label || t.default_label;
            t.enabled = aanInput.checked;
          }
          if (welkom && welkom.value !== (t.welcome_text || "")) {
            const uit = await api.patch("/tickets/types/welcome", { key: t.key, welcome_text: welkom.value });
            t.welcome_text = uit.welcome_text;
          }
          if (emojiInput && (emojiInput.value.trim() !== (t.emoji || "") || rolKeuze.value !== (t.staff_role_id || ""))) {
            const uit = await api.patch("/tickets/types/appearance",
              { key: t.key, emoji: emojiInput.value.trim(), staff_role_id: rolKeuze.value });
            t.emoji = uit.emoji;
            t.staff_role_id = uit.staff_role_id;
          }
          const nieuw = formulierAan ? werk : [];
          if (data.forms && JSON.stringify(nieuw) !== JSON.stringify(vragen[t.key] || [])) {
            const uit = await api.put(`/tickets/questions/${encodeURIComponent(t.key)}`, { questions: nieuw });
            vragen[t.key] = uit.questions;
          }
          toast(`${t.label} saved.`);
          sluit();
          teken();
        } catch (err) {
          toast(err.message, "err");
          opslaan.disabled = false;
        }
      });
      const sluit = openModal(modal);
    }

    function teken() {
      clear(host);

      // 1. Staat
      const aan = !!s.enabled;
      const schakelaarInput = el("input", {
        type: "checkbox", checked: aan ? "checked" : null,
        "aria-label": "Ticket system enabled",
      });
      schakelaarInput.addEventListener("change", () =>
        bewaar({ enabled: schakelaarInput.checked }, schakelaarInput.checked ? "Tickets switched on" : "Tickets switched off"));

      const klaar = !!(s.category_id && s.support_role_id);
      host.appendChild(kaart("Status", null, [
        el("div", { class: "srv-list srv-stagger" }, [
          rij("Ticket system",
            el("div", { class: "srv-actions" }, [
              el("span", { class: `srv-state ${aan ? "is-on" : "is-off"}`, text: aan ? "On" : "Off" }),
              el("label", { class: "sec-switch" }, [schakelaarInput, el("span", { class: "track" })]),
            ]),
            aan ? "Members can open tickets." : "Nobody can open a ticket right now."),
          rij("Panel",
            el("span", { class: `srv-state ${s.panel_message_id ? "is-on" : ""}`, text: s.panel_message_id ? "Published" : "Not published" }),
            s.panel_message_id
              ? "The button members press lives in the channel below."
              : "Publish it in Discord with `ticketsetup`; the bot needs to post it itself."),
          rij("Setup",
            el("span", { class: `srv-state ${klaar ? "is-on" : ""}`, text: klaar ? "Complete" : "Incomplete" }),
            klaar ? "A category and a support role are set." : "Pick a category and a support role below."),
        ]),
      ]));

      // 2. Kanalen en rollen
      host.appendChild(kaart(
        "Channels and roles",
        "Where ticket channels are created, and who can see them.",
        [el("div", { class: "srv-list" }, [
          rij("Category",
            keuzelijst(categorieen, s.category_id, "No category", (v) => bewaar({ category_id: v }, "Category")),
            "New ticket channels are created here."),
          rij("Support role",
            keuzelijst(data.roles || [], s.support_role_id, "No role", (v) => bewaar({ support_role_id: v }, "Support role")),
            "This role can see and manage every ticket."),
          rij("Log channel",
            keuzelijst(tekstkanalen, s.log_channel_id, "No channel", (v) => bewaar({ log_channel_id: v }, "Log channel")),
            "Opened, claimed and closed events are posted here."),
          rij("Transcript channel",
            keuzelijst(tekstkanalen, s.transcript_channel_id, "No channel", (v) => bewaar({ transcript_channel_id: v }, "Transcript channel")),
            "A readable copy of every closed ticket lands here."),
          rij("Panel channel",
            keuzelijst(tekstkanalen, s.panel_channel_id, "No channel", (v) => bewaar({ panel_channel_id: v }, "Panel channel")),
            "Where the button to open a ticket is published."),
        ])]));

      // 3. Grenzen
      const maxInput = el("input", {
        class: "sec-input sec-input-num", type: "number", min: "1", max: "50",
        value: String(s.max_open_tickets), "aria-label": "Maximum open tickets per member",
      });
      const delayInput = el("input", {
        class: "sec-input sec-input-num", type: "number", min: "0", max: "86400",
        value: String(s.close_delay), "aria-label": "Seconds before a closed channel is deleted",
      });
      host.appendChild(kaart("Limits", "The same bounds as the setup dashboard in Discord.", [
        el("div", { class: "srv-list" }, [
          rij("Open tickets per member", maxInput, "Between 1 and 50."),
          rij("Delay before deleting a closed channel", delayInput, "In seconds, up to a day."),
        ]),
        el("div", { class: "sec-row", style: "margin-top:14px" }, [
          el("button", {
            class: "sec-btn sec-btn-primary sec-btn-sm", type: "button", text: "Save limits",
            onclick: () => bewaar({
              max_open_tickets: Number(maxInput.value),
              close_delay: Number(delayInput.value),
            }, "Limits"),
          }),
        ]),
      ]));

      // 4. Soorten: per type een rij met de stand en een Edit-knop. Alles van
      // een type (naam, aan/uit, welkomsttekst, formulier) staat in het venster.
      const typeRijen = (data.types || []).map((t) => el("div", { class: "srv-row srv-type-row" + (t.enabled ? "" : " is-off") }, [
        el("div", { class: "srv-name" }, [
          el("div", {}, [
            el("div", { style: "font-weight:700", text: t.label }),
            el("div", { class: "srv-type-meta" }, [
              el("code", { text: `${t.prefix}-` }),
              el("span", { class: `srv-state ${t.enabled ? "is-on" : ""}`, text: t.enabled ? "Available" : "Hidden" }),
              data.forms ? el("span", { class: `srv-state ${(vragen[t.key] || []).length ? "is-on" : ""}`, text: vraagTelling(t) }) : null,
              data.v2 && t.welcome_text ? el("span", { class: "srv-state is-on", text: "Welcome text" }) : null,
            ].filter(Boolean)),
          ]),
        ]),
        el("span", { class: "srv-field-hint", text: t.description }),
        el("button", { class: "sec-btn sec-btn-sm", type: "button", text: "Edit",
                       "aria-label": `Edit ${t.label}`, onclick: () => bewerkType(t) }),
      ]));
      host.appendChild(kaart(
        "Ticket types",
        data.forms
          ? "What a member can pick when they open a ticket. Edit a type to rename it, switch it off, write its welcome text or give it a form."
          : "What a member can pick when they open a ticket. Edit a type to rename it or switch it off.",
        [el("div", { class: "srv-list srv-stagger" }, typeRijen)]));

      // 5. Wat er open staat
      const open = data.open || [];
      host.appendChild(kaart(
        "Open tickets",
        null,
        open.length ? [
          el("div", { class: "sec-table-wrap" }, [
            el("table", { class: "sec-table" }, [
              el("thead", {}, [el("tr", {}, [
                el("th", { text: "#" }), el("th", { text: "Type" }),
                // "Member ID" en niet "Opened by": er staat een getal, en een
                // kolom die "opened by" heet boven een kaal nummer leest als een
                // naam die niet is opgehaald.
                el("th", { text: "Member ID" }), el("th", { text: "Claimed" }),
              ])]),
              el("tbody", {}, open.map((t) => el("tr", {}, [
                el("td", { text: `#${t.id}` }),
                el("td", { text: t.type }),
                el("td", {}, [el("code", { text: t.owner_id })]),
                el("td", {}, [el("span", {
                  class: `srv-state ${t.claimed ? "is-on" : ""}`,
                  text: t.claimed ? "Claimed" : "Waiting",
                })]),
              ]))),
            ]),
          ]),
        ] : [
          el("div", { class: "srv-empty" }, [
            el("h3", { text: "No open tickets" }),
            el("p", { text: aan ? "Nothing is waiting for your team right now." : "Switch the system on and publish the panel to let members open one." }),
          ]),
        ]));
    }

    await laadVragen();
    teken();
  },
};
