// Applications — de formulieren die mensen invullen, en de bouwer ervoor.
//
// DE VORM VOLGT DE DISCORD-KANT, want dat is waar het eindigt. Een formulier
// wordt daar een MODAL, en een modal draagt vijf velden. Daarom staat er na elke
// vijfde vraag een paginascheiding in de lijst: je ziet waar Discord het
// afbreekt terwijl je typt, in plaats van erachter te komen als het te laat is.
//
// DE GRENZEN KOMEN VAN DE SERVER (`limits` in het antwoord) en staan niet in dit
// bestand. Eén bron voor de tellers en de validatie; anders schuift er ooit één
// van de twee.
//
// ALLE TEKST VAN EEN SERVEREIGENAAR GAAT VIA `text:` (textContent). Geen enkele
// waarde uit een antwoord raakt `html:`; dat is de regel die
// bucky1.0/tests/test_site_html_injectie.py afdwingt.
import { api } from "../api.js";
import { el, clear, toast, formModal } from "../../security/ui.js";

const TYPES = [
  { value: "short", label: "Short text" },
  { value: "paragraph", label: "Long answer" },
  { value: "choice", label: "Choice" },
  { value: "boolean", label: "Yes / no" },
];

const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

export default {
  async render(root, { navigate }) {
    const state = { data: null, gekozen: null };

    root.appendChild(el("div", { class: "srv-hero" }, [
      el("h1", { text: "Applications" }),
      el("p", { text: "Write the questions people answer when they apply. They fill them in inside Discord, and your team decides." }),
    ]));

    const host = el("div");
    root.appendChild(host);
    host.appendChild(el("div", { class: "sec-loading", text: "Loading forms…" }));

    async function laad() {
      state.data = await api.get("/applications");
      if (state.gekozen) {
        const nog = state.data.forms.find((f) => f.id === state.gekozen);
        state.gekozen = nog ? nog.id : null;
      }
      if (!state.gekozen && state.data.forms.length) state.gekozen = state.data.forms[0].id;
      teken();
    }

    try {
      await laad();
    } catch (err) {
      clear(host);
      host.appendChild(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "The forms did not load" }),
        el("p", { class: "sec-muted", text: err.message }),
        el("button", {
          class: "sec-btn sec-btn-sm", type: "button", text: "Try again",
          onclick: () => { clear(root); this.render(root, { navigate }); },
        }),
      ]));
      return;
    }

    // ---------------------------------------------------------------- acties
    async function nieuwFormulier() {
      const grenzen = state.data.limits;
      const waarden = await formModal({
        title: "New form",
        submitLabel: "Create form",
        fields: [
          { name: "title", label: `Title (max ${grenzen.title})`, value: "" },
          { name: "description", label: `What it is for (max ${grenzen.description})`, type: "textarea", rows: 3, value: "" },
        ],
      });
      if (!waarden || !waarden.title.trim()) return;
      try {
        const gemaakt = await api.post("/applications/forms", waarden);
        state.gekozen = gemaakt.id;
        toast("Form created. Add your questions.");
        await laad();
      } catch (err) { toast(err.message, "err"); }
    }

    async function bewerkFormulier(form) {
      const grenzen = state.data.limits;
      const waarden = await formModal({
        title: "Edit form",
        fields: [
          { name: "title", label: `Title (max ${grenzen.title})`, value: form.title },
          { name: "description", label: `What it is for (max ${grenzen.description})`, type: "textarea", rows: 3, value: form.description },
        ],
      });
      if (!waarden) return;
      try {
        await api.patch(`/applications/forms/${form.id}`, waarden);
        toast("Form saved.");
        await laad();
      } catch (err) { toast(err.message, "err"); }
    }

    async function verwijderFormulier(form) {
      const bevestig = await formModal({
        title: `Delete "${form.title}"?`,
        submitLabel: "Delete form",
        fields: [{
          name: "bevestiging", label: "Type DELETE to confirm", value: "",
          placeholder: "DELETE",
        }],
      });
      if (!bevestig || bevestig.bevestiging.trim().toUpperCase() !== "DELETE") return;
      try {
        await api.del(`/applications/forms/${form.id}`);
        state.gekozen = null;
        toast("Form deleted. Applications people already sent are kept.");
        await laad();
      } catch (err) { toast(err.message, "err"); }
    }

    async function zetAan(form, aan) {
      try {
        await api.patch(`/applications/forms/${form.id}`, { enabled: aan });
        toast(aan ? `${form.title} is live.` : `${form.title} is hidden.`);
        await laad();
      } catch (err) {
        toast(err.message, "err");
        teken();                       // schakelaar terug naar de echte stand
      }
    }

    async function vraagDialoog(form, vraag) {
      const grenzen = state.data.limits;
      const waarden = await formModal({
        title: vraag ? "Edit question" : "New question",
        submitLabel: vraag ? "Save question" : "Add question",
        fields: [
          { name: "label", label: `Question (max ${grenzen.label})`, value: vraag ? vraag.label : "" },
          { name: "description", label: `Help text under it (max ${grenzen.help}, optional)`, value: vraag ? vraag.description : "" },
          { name: "input_type", label: "Answer type", type: "select", value: vraag ? vraag.input_type : "short",
            options: TYPES },
          { name: "options", label: "Choices, one per line (only for Choice)", type: "textarea", rows: 4,
            value: vraag && vraag.options ? vraag.options.join("\n") : "" },
          { name: "required", label: "Required", type: "select", value: vraag && !vraag.required ? "no" : "yes",
            options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
        ],
      });
      if (!waarden || !waarden.label.trim()) return;
      const payload = {
        label: waarden.label,
        description: waarden.description,
        input_type: waarden.input_type,
        required: waarden.required === "yes",
        options: waarden.options.split("\n").map((r) => r.trim()).filter(Boolean),
      };
      try {
        if (vraag) await api.patch(`/applications/questions/${vraag.id}`, payload);
        else await api.post(`/applications/forms/${form.id}/questions`, payload);
        toast(vraag ? "Question saved." : "Question added.");
        await laad();
      } catch (err) { toast(err.message, "err"); }
    }

    async function verwijderVraag(vraag) {
      try {
        await api.del(`/applications/questions/${vraag.id}`);
        toast("Question removed.");
        await laad();
      } catch (err) { toast(err.message, "err"); }
    }

    // ---------------------------------------------------------------- tekenen
    function formulierKaart(form) {
      const actief = form.id === state.gekozen;
      const input = el("input", {
        type: "checkbox", checked: form.enabled ? "checked" : null,
        "aria-label": `${form.title} live`,
      });
      input.addEventListener("change", (e) => {
        e.stopPropagation();
        zetAan(form, input.checked);
      });
      const kaart = el("div", { class: "srv-row" + (actief ? " is-active" : "") }, [
        el("button", {
          class: "srv-form-open", type: "button",
          "aria-current": actief ? "true" : null,
          onclick: () => { state.gekozen = form.id; teken(); },
        }, [
          el("div", { style: "font-weight:700", text: form.title }),
          el("div", { class: "sec-muted", style: "font-size:12px",
            text: `${form.questions.length} question${form.questions.length === 1 ? "" : "s"}` }),
        ]),
        el("span", { class: `srv-state ${form.enabled ? "is-on" : ""}`.trim(),
          text: form.enabled ? "Live" : "Hidden" }),
        el("div", { class: "srv-actions" }, [el("label", { class: "sec-switch" }, [input, el("span", { class: "track" })])]),
      ]);
      return kaart;
    }

    function vraagRij(form, vraag, index, grenzen) {
      // `srv-row-stack`: deze rij draagt vier bedieningselementen, en die passen
      // op een telefoon niet naast de tekst. Zie css/server.css.
      const rij = el("div", { class: "srv-row srv-row-stack" }, [
        el("div", { class: "srv-name" }, [
          el("span", { class: "srv-q-nr", text: String(index + 1) }),
          el("div", {}, [
            el("div", { style: "font-weight:700", text: vraag.label }),
            vraag.description
              ? el("div", { class: "sec-muted", style: "font-size:12px", text: vraag.description })
              : null,
          ].filter(Boolean)),
        ]),
        el("span", { class: "srv-state", text: TYPE_LABEL[vraag.input_type] || vraag.input_type }),
        el("div", { class: "srv-actions" }, [
          vraag.required ? el("span", { class: "srv-state", text: "Required" }) : null,
          el("button", { class: "sec-btn sec-btn-ghost sec-btn-sm", type: "button", text: "Edit",
            onclick: () => vraagDialoog(form, vraag) }),
          el("button", { class: "sec-btn sec-btn-ghost sec-btn-sm", type: "button", text: "Remove",
            "aria-label": `Remove question ${index + 1}`,
            onclick: () => verwijderVraag(vraag) }),
        ].filter(Boolean)),
      ]);
      return rij;
    }

    // De signatuur van dit scherm: de modal zoals Discord hem toont. Geen
    // plaatje maar dezelfde tekst, zodat afkapping en lege velden hier zichtbaar
    // worden en niet pas bij de eerste sollicitant.
    function modalPreview(form, grenzen) {
      const eerste = form.questions.slice(0, grenzen.questions_per_page);
      const paginas = Math.max(1, Math.ceil(form.questions.length / grenzen.questions_per_page));
      return el("div", { class: "srv-preview" }, [
        el("div", { class: "srv-preview-head" }, [
          el("span", { text: `In Discord, page 1 of ${paginas}` }),
        ]),
        el("div", { class: "srv-preview-body" }, [
          el("div", { class: "srv-modal" }, [
            el("div", { class: "srv-modal-title", text: form.title || "Untitled form" }),
            ...(eerste.length ? eerste.map((v) => el("div", { class: "srv-modal-field" }, [
              el("label", { text: v.label + (v.required ? "" : " (optional)") }),
              v.description ? el("div", { class: "srv-modal-help", text: v.description }) : null,
              v.input_type === "choice" || v.input_type === "boolean"
                ? el("div", { class: "srv-modal-select", text: (v.options && v.options[0]) || "Yes" })
                : el("div", { class: "srv-modal-input" + (v.input_type === "paragraph" ? " tall" : "") }),
            ].filter(Boolean))) : [el("div", { class: "sec-muted", text: "No questions yet." })]),
            el("div", { class: "srv-modal-actions" }, [
              el("span", { class: "srv-modal-btn ghost", text: "Cancel" }),
              el("span", { class: "srv-modal-btn", text: paginas > 1 ? "Continue" : "Submit" }),
            ]),
          ]),
        ]),
      ]);
    }

    function teken() {
      clear(host);
      const grenzen = state.data.limits;
      const forms = state.data.forms || [];

      // Kolom links: de formulieren. Rechts: wat er in het gekozen formulier staat.
      const kop = el("div", { class: "sec-row", style: "justify-content:space-between;align-items:flex-start" }, [
        el("div", {}, [
          el("div", { class: "sec-page-title", text: "Forms" }),
          el("p", { class: "sec-muted", style: "margin:0",
            text: `${forms.length} of ${grenzen.forms} used` }),
        ]),
        el("button", {
          class: "sec-btn sec-btn-primary sec-btn-sm", type: "button", text: "New form",
          disabled: forms.length >= grenzen.forms ? "disabled" : null,
          onclick: nieuwFormulier,
        }),
      ]);
      host.appendChild(kop);

      if (!forms.length) {
        host.appendChild(el("div", { class: "srv-empty", style: "margin-top:16px" }, [
          el("h3", { text: "No forms yet" }),
          el("p", { text: "A form is a few questions people answer in Discord: why they want to join, what they have done before, when they are around. You decide what is asked." }),
          el("button", { class: "sec-btn sec-btn-primary sec-btn-sm", type: "button",
            text: "Write your first form", onclick: nieuwFormulier }),
        ]));
        return;
      }

      host.appendChild(el("div", { class: "srv-list srv-stagger", style: "margin-top:12px" },
        forms.map(formulierKaart)));

      const form = forms.find((f) => f.id === state.gekozen);
      if (!form) return;

      const paginaGrens = grenzen.questions_per_page;
      const vraagLijst = el("div", { class: "srv-list" });
      form.questions.forEach((vraag, i) => {
        if (i > 0 && i % paginaGrens === 0) {
          vraagLijst.appendChild(el("div", { class: "srv-page-break" }, [
            el("span", { text: `page ${Math.floor(i / paginaGrens) + 1} in Discord` }),
          ]));
        }
        vraagLijst.appendChild(vraagRij(form, vraag, i, grenzen));
      });

      host.appendChild(el("div", { class: "sec-card", style: "margin-top:22px" }, [
        el("div", { class: "sec-row", style: "justify-content:space-between;align-items:flex-start" }, [
          el("div", {}, [
            el("div", { class: "sec-page-title", text: form.title }),
            el("p", { class: "sec-muted", style: "margin:0", text: form.description || "No description yet." }),
          ]),
          el("div", { class: "srv-actions" }, [
            el("button", { class: "sec-btn sec-btn-ghost sec-btn-sm", type: "button", text: "Edit details",
              onclick: () => bewerkFormulier(form) }),
            el("button", { class: "sec-btn sec-btn-danger sec-btn-sm", type: "button", text: "Delete",
              onclick: () => verwijderFormulier(form) }),
          ]),
        ]),
        el("div", { class: "srv-group-title", style: "margin-top:18px" }, [
          el("span", { text: "Questions" }),
          el("span", { class: "count", text: `${form.questions.length} of ${grenzen.questions}` }),
          el("div", { class: "srv-actions" }, [
            el("button", {
              class: "sec-btn sec-btn-primary sec-btn-sm", type: "button", text: "Add question",
              disabled: form.questions.length >= grenzen.questions ? "disabled" : null,
              onclick: () => vraagDialoog(form, null),
            }),
          ]),
        ]),
        form.questions.length ? vraagLijst : el("div", { class: "srv-empty" }, [
          el("h3", { text: "No questions in this form" }),
          el("p", { text: "Add the first question. Five fit on one page in Discord; after that it continues on a second." }),
        ]),
        modalPreview(form, grenzen),
      ]));
    }
  },
};
