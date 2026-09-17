// Submissions — de aanvragen die op een beslissing wachten.
//
// WAAROM DIT SCHERM BESTAAT. Op het overzicht stond "5 waiting for a decision"
// en dat getal wees nergens heen. Een getal dat verwijst naar iets wat je niet
// kunt openen is erger dan geen getal: het zegt dat er werk ligt en verzwijgt
// welk.
//
// ALLE TEKST HIER IS INGETYPT DOOR IEMAND ANDERS - de antwoorden komen van de
// aanvrager, de vragen van de servereigenaar. Alles gaat dus via `text:`
// (textContent), nooit via `html:`. Dat is dezelfde regel als op de bouwer, en
// hij wordt afgedwongen door bucky1.0/tests/test_site_html_injectie.py.
//
// BESLISSEN KAN HIER, BEZORGEN DOET DE BOT. Het dashboard kan geen DM sturen en
// geen kaart in Discord bijwerken. Het zet de uitkomst klaar (`notified = 0`) en
// de bot pikt hem binnen een minuut op. Het scherm zegt dat ook, want "goedgekeurd"
// zonder dat de aanvrager iets hoort zou precies de stilte zijn waar dit systeem
// tegen bestaat.
import { api } from "../api.js";
import { el, clear, toast, formModal } from "../../security/ui.js";

const STATUS = [
  { key: "pending", label: "Waiting" },
  { key: "approved", label: "Approved" },
  { key: "denied", label: "Denied" },
];

function wanneer(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
  if (isNaN(d)) return "";
  const minuten = Math.round((Date.now() - d.getTime()) / 60000);
  if (minuten < 60) return `${Math.max(1, minuten)} min ago`;
  const uren = Math.round(minuten / 60);
  if (uren < 48) return `${uren} h ago`;
  return `${Math.round(uren / 24)} d ago`;
}

export default {
  async render(root, { navigate }) {
    const state = { status: "pending", items: [], open: new Set() };

    root.appendChild(el("div", { class: "srv-hero" }, [
      el("h1", { text: "Applications waiting" }),
      el("p", { text: "What people sent in. Read the answers, then say yes or no. Bucky tells the applicant and updates the card in Discord within a minute." }),
    ]));

    const filters = el("div", { class: "srv-dept", role: "group", "aria-label": "Filter by status" },
      STATUS.map((s) => el("button", {
        class: "srv-dept-btn" + (s.key === state.status ? " is-active" : ""),
        type: "button", "data-status": s.key, text: s.label,
        onclick: () => {
          state.status = s.key;
          filters.querySelectorAll("[data-status]").forEach((b) =>
            b.classList.toggle("is-active", b.getAttribute("data-status") === s.key));
          laad();
        },
      })));
    root.appendChild(el("div", { class: "sec-row", style: "margin-bottom:14px" }, [filters]));

    const host = el("div");
    root.appendChild(host);

    async function laad() {
      clear(host);
      host.appendChild(el("div", { class: "sec-loading", text: "Loading applications…" }));
      try {
        const data = await api.get(`/applications/submissions?status=${state.status}&limit=100`);
        state.items = data.items || [];
      } catch (err) {
        clear(host);
        host.appendChild(el("div", { class: "sec-card" }, [
          el("div", { class: "sec-page-title", text: "The applications did not load" }),
          el("p", { class: "sec-muted", text: err.message }),
          el("button", { class: "sec-btn sec-btn-sm", type: "button", text: "Try again", onclick: laad }),
        ]));
        return;
      }
      teken();
    }

    async function beslis(item, status) {
      const woord = status === "approved" ? "Approve" : "Deny";
      const waarden = await formModal({
        title: `${woord} application #${item.id}?`,
        submitLabel: woord,
        fields: [{
          name: "note", label: "Note for your own records (optional)", value: "",
          placeholder: "Only staff sees this",
        }],
      });
      if (!waarden) return;
      try {
        await api.patch(`/applications/submissions/${item.id}`, { status, note: waarden.note });
        toast(status === "approved"
          ? `#${item.id} approved. Bucky is telling the applicant.`
          : `#${item.id} denied. Bucky is telling the applicant.`);
        laad();
      } catch (err) {
        // 409: iemand anders was net sneller. Dat is geen fout van deze
        // beheerder, dus het scherm ververst en zegt wat er gebeurd is.
        toast(err.message, "err");
        if (err.status === 409) laad();
      }
    }

    function antwoordBlok(item) {
      const antwoorden = item.answers || [];
      if (!antwoorden.length) {
        return el("p", { class: "sec-muted", style: "margin:10px 0 0",
          text: "This application was moved over from the old system, so the answers are not stored here." });
      }
      return el("div", { class: "srv-answers" }, antwoorden.map((a) => el("div", { class: "srv-answer" }, [
        el("div", { class: "srv-answer-q", text: a.label || "Question" }),
        el("div", { class: "srv-answer-a", text: a.answer || "-" }),
      ])));
    }

    function rij(item) {
      const open = state.open.has(item.id);
      // DE RIJ MOET ZICHTBAAR OPENGAAN (17 september 2026). Hij deed dat al, maar
      // er stond alleen "4 answers" en geen enkel teken dat daar iets achter zat -
      // op een scherm dat juist bestaat om die antwoorden te lezen. Nu staat er
      // een chevron voor de stand en een woord voor de handeling, en die twee
      // vervangen samen de losse telling.
      const aantal = (item.answers || []).length;
      const hint = !aantal ? "No answers stored"
        : open ? "Hide answers"
        : `Show ${aantal} answer${aantal === 1 ? "" : "s"}`;
      const kop = el("button", {
        class: "srv-form-open srv-sub-open", type: "button",
        "aria-expanded": open ? "true" : "false",
        onclick: () => { open ? state.open.delete(item.id) : state.open.add(item.id); teken(); },
      }, [
        el("span", { class: "chev", "aria-hidden": "true", text: open ? "⌄" : "›" }),
        el("div", { class: "srv-sub-head" }, [
          el("div", { style: "font-weight:700", text: `#${item.id} · ${item.form_key}` }),
          el("div", { class: "sec-muted", style: "font-size:12px" }, [
            el("span", { text: `Member ${item.user_id} · ${wanneer(item.created_at)} · ` }),
            el("span", { class: "srv-sub-hint", text: hint }),
          ]),
        ]),
      ]);

      const acties = item.status === "pending"
        ? el("div", { class: "srv-actions" }, [
            el("button", { class: "sec-btn sec-btn-sm", type: "button", text: "Approve",
              onclick: () => beslis(item, "approved") }),
            el("button", { class: "sec-btn sec-btn-danger sec-btn-sm", type: "button", text: "Deny",
              onclick: () => beslis(item, "denied") }),
          ])
        : el("span", { class: `srv-state ${item.status === "approved" ? "is-on" : "is-off"}`,
            text: item.status === "approved" ? "Approved" : "Denied" });

      const kaart = el("div", { class: "srv-row srv-row-stack" }, [kop, acties]);
      if (!open) return kaart;
      return el("div", {}, [kaart, el("div", { class: "srv-answer-wrap" }, [antwoordBlok(item)])]);
    }

    function teken() {
      clear(host);
      if (!state.items.length) {
        host.appendChild(el("div", { class: "srv-empty" }, [
          el("h3", { text: state.status === "pending" ? "Nothing waiting" : "Nothing here" }),
          el("p", { text: state.status === "pending"
            ? "Every application has been decided. New ones appear here the moment someone sends one."
            : "No applications with this status yet." }),
          el("button", { class: "sec-btn sec-btn-sm", type: "button", text: "Open the form builder",
            onclick: () => navigate("applications") }),
        ]));
        return;
      }
      host.appendChild(el("p", { class: "sec-page-sub",
        text: `${state.items.length} application${state.items.length === 1 ? "" : "s"}` }));
      host.appendChild(el("div", { class: "srv-list srv-stagger" }, state.items.map(rij)));
    }

    laad();
  },
};
