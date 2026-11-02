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
import { el, clear, toast } from "../../security/ui.js";

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

    // Welkomsttekst per type. Een keuzelijst en een tekstvak, en niet zes
    // tekstvakken onder elkaar: je werkt aan een type tegelijk.
    let gekozenType = (data.types || [])[0] ? data.types[0].key : null;
    function perTypeKaart() {
      const types = data.types || [];
      const max = data.max_welcome_text || 1000;
      const keuze = el("select", { class: "sec-select", "aria-label": "Ticket type" },
        types.map((t) => el("option", { value: t.key, text: t.label })));
      keuze.value = gekozenType || "";
      const huidig = () => types.find((t) => t.key === keuze.value) || {};
      const vak = el("textarea", {
        class: "sec-input srv-textarea", rows: "5", maxlength: String(max),
        "aria-label": "Welcome text for this ticket type",
        placeholder: "Thanks {user}! Tell us what happened and add screenshots if you have them.",
      });
      vak.value = huidig().welcome_text || "";
      const teller = el("span", { class: "srv-field-hint", "aria-live": "polite" });
      const tel = () => { teller.textContent = `${vak.value.length} / ${max}`; };
      tel();
      vak.addEventListener("input", tel);
      keuze.addEventListener("change", () => {
        gekozenType = keuze.value;
        vak.value = huidig().welcome_text || "";
        tel();
      });
      const opslaan = el("button", {
        class: "sec-btn sec-btn-primary sec-btn-sm", type: "button", text: "Save welcome text",
        onclick: async () => {
          opslaan.disabled = true;
          try {
            const uit = await api.patch("/tickets/types/welcome", { key: keuze.value, welcome_text: vak.value });
            huidig().welcome_text = uit.welcome_text;
            vak.value = uit.welcome_text;
            tel();
            toast("Welcome text saved.");
          } catch (err) {
            toast(err.message, "err");
          } finally {
            opslaan.disabled = false;
          }
        },
      });
      const placeholders = (data.welcome_placeholders || []).map((p) => "{" + p + "}").join(", ");
      return kaart(
        "Welcome text per type",
        "Shown at the top of a new ticket, above the Close button. Empty means Bucky's standard line. "
          + (placeholders ? `You can use ${placeholders}.` : ""),
        [el("div", { class: "srv-list" }, [
          rij("Ticket type", keuze, "Pick the type you want to write for."),
        ]),
        vak,
        el("div", { class: "sec-row", style: "margin-top:10px" }, [opslaan, teller])]);
    }

    // DE VRAAGRONDE PER TYPE. Hoogstens vijf vragen (een modal draagt er vijf).
    // De antwoorden staan bovenaan het ticket, in codeblokken: een lid kan er
    // geen opmaak, links of pings mee maken (cogs/tickets/views.py).
    let vragen = null;              // {type_key: [vraag, ...]}, geladen bij openen
    let vraagLimieten = {};
    let vraagType = (data.types || [])[0] ? data.types[0].key : null;
    function vragenKaart() {
      const kaartNode = kaart("Questions per type",
        "A short round of questions when someone opens this type of ticket. The answers appear at the top of the ticket for your team. Leave it empty to open tickets straight away.",
        [el("div", { class: "sec-loading", text: "Loading questions…" })]);
      const laad = vragen ? Promise.resolve() : api.get("/tickets/questions").then((uit) => {
        vragen = uit.questions || {};
        vraagLimieten = uit.limits || {};
      });
      laad.then(() => vul(kaartNode)).catch((err) => {
        kaartNode.appendChild(el("p", { class: "sec-muted", text: err.message }));
      });
      return kaartNode;
    }

    function vul(kaartNode) {
      kaartNode.querySelectorAll(".sec-loading, .srv-questions").forEach((n) => n.remove());
      const max = vraagLimieten.max_questions || 5;
      const typeKeuze = el("select", { class: "sec-select", "aria-label": "Ticket type for questions" },
        (data.types || []).map((t) => el("option", { value: t.key, text: t.label })));
      typeKeuze.value = vraagType || "";
      const lijst = el("div");
      const wrap = el("div", { class: "srv-questions" }, [
        el("div", { class: "srv-list" }, [rij("Ticket type", typeKeuze, null)]), lijst]);
      kaartNode.appendChild(wrap);

      let werk = [];
      function laadType() {
        vraagType = typeKeuze.value;
        werk = (vragen[vraagType] || []).map((v) => ({ ...v }));
        tekenLijst();
      }
      function tekenLijst() {
        clear(lijst);
        werk.forEach((v, i) => {
          const label = el("input", { class: "sec-input", value: v.label, maxlength: String(vraagLimieten.max_label || 45),
                                      placeholder: "Question", "aria-label": `Question ${i + 1}` });
          label.addEventListener("input", () => { v.label = label.value; });
          const hint = el("input", { class: "sec-input", value: v.placeholder || "", maxlength: String(vraagLimieten.max_placeholder || 100),
                                     placeholder: "Hint (optional)", "aria-label": `Hint for question ${i + 1}` });
          hint.addEventListener("input", () => { v.placeholder = hint.value; });
          const stijl = el("select", { class: "sec-select", "aria-label": `Answer type for question ${i + 1}` }, [
            el("option", { value: "short", text: "Short" }), el("option", { value: "paragraph", text: "Long" })]);
          stijl.value = v.style || "short";
          stijl.addEventListener("change", () => { v.style = stijl.value; });
          const nodig = el("input", { type: "checkbox", checked: v.required ? "checked" : null,
                                      "aria-label": `Question ${i + 1} required` });
          nodig.addEventListener("change", () => { v.required = nodig.checked; });
          lijst.appendChild(el("div", { class: "srv-question" }, [
            label, hint, stijl,
            el("label", { class: "srv-field-hint" }, [nodig, document.createTextNode(" Required")]),
            el("button", { class: "sec-btn sec-btn-ghost sec-btn-sm", type: "button", text: "Remove",
                           onclick: () => { werk.splice(i, 1); tekenLijst(); } }),
          ]));
        });
        lijst.appendChild(el("div", { class: "sec-row", style: "margin-top:12px;gap:8px" }, [
          el("button", { class: "sec-btn sec-btn-sm", type: "button", text: "Add question",
                         disabled: werk.length >= max ? "disabled" : null,
                         onclick: () => { werk.push({ label: "", placeholder: "", style: "short", required: true, max_length: 300 }); tekenLijst(); } }),
          el("button", { class: "sec-btn sec-btn-primary sec-btn-sm", type: "button", text: "Save questions",
                         onclick: async () => {
                           try {
                             const uit = await api.put(`/tickets/questions/${encodeURIComponent(vraagType)}`, { questions: werk });
                             vragen[vraagType] = uit.questions;
                             toast("Questions saved.");
                           } catch (err) { toast(err.message, "err"); }
                         } }),
          el("span", { class: "srv-field-hint", text: `${werk.length} of ${max}` }),
        ]));
      }
      typeKeuze.addEventListener("change", laadType);
      laadType();
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

      // 4. Soorten
      const typeRijen = (data.types || []).map((t) => {
        const input = el("input", {
          type: "checkbox", checked: t.enabled ? "checked" : null,
          "aria-label": `${t.label} available`,
        });
        input.addEventListener("change", async () => {
          try {
            await api.patch("/tickets/types", {
              key: t.key, label: t.label, enabled: input.checked, position: t.position,
            });
            t.enabled = input.checked;
            toast(`${t.label} ${input.checked ? "is available" : "is hidden"}.`);
          } catch (err) {
            toast(err.message, "err");
            input.checked = t.enabled;
          }
        });
        const naamveld = el("input", {
          class: "sec-input", value: t.label, maxlength: "45",
          "aria-label": `Label for ${t.default_label}`, style: "max-width:190px",
        });
        naamveld.addEventListener("change", async () => {
          try {
            const uit = await api.patch("/tickets/types", {
              key: t.key, label: naamveld.value, enabled: t.enabled, position: t.position,
            });
            t.label = uit.label || t.default_label;
            naamveld.value = t.label;
            toast("Label saved.");
          } catch (err) {
            toast(err.message, "err");
            naamveld.value = t.label;
          }
        });
        return el("div", { class: "srv-row" + (t.enabled ? "" : " is-off") }, [
          el("div", { class: "srv-name" }, [el("code", { text: t.prefix }), naamveld]),
          el("span", { class: "srv-state", text: t.description }),
          el("div", { class: "srv-actions" }, [el("label", { class: "sec-switch" }, [input, el("span", { class: "track" })])]),
        ]);
      });
      host.appendChild(kaart(
        "Ticket types",
        "What a member can pick when they open a ticket. The prefix is the channel name Bucky uses.",
        [el("div", { class: "srv-list srv-stagger" }, typeRijen)]));

      // 4b. Per type: de welkomsttekst bovenaan het ticket (tickets v2). Alleen
      // als de backend `v2` meestuurt; uit bestaat deze kaart niet.
      if (data.v2) host.appendChild(perTypeKaart());
      // 4c. De vraagronde per type (vlag ticket_forms).
      if (data.forms) host.appendChild(vragenKaart());

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

    teken();
  },
};
