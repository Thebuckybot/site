// Overview — wat er op deze server aan staat, in drie tegels.
//
// WAAROM DRIE TEGELS EN GEEN STATISTIEKENMUUR. Dit scherm is een wegwijzer, en
// de enige vraag die het beantwoordt is "waar moet ik heen". Elk blok zegt
// daarom precies één ding over zijn onderdeel plus het getal dat die zin waar
// maakt. Geen grafieken: er valt hier niets te volgen over tijd.
//
// EEN SERVER DIE NIETS HEEFT INGESTELD ZIET DIT HET EERST, dus de lege staat is
// hier geen randgeval maar het gewone geval. Vandaar dat elke tegel ook zonder
// gegevens een zin heeft die zegt wat je zou doen.
import { api } from "../api.js";
import { el, clear } from "../../security/ui.js";
import { icon } from "../icons.js";

function figure(n, unit) {
  return el("span", { class: "srv-figure" }, [
    el("span", { class: "n", text: String(n) }),
    el("span", { class: "unit", text: unit }),
  ]);
}

function state(tekst, soort) {
  // Nooit alleen kleur: er staat altijd een woord. (WCAG 1.4.1)
  return el("span", { class: `srv-state ${soort || ""}`.trim(), text: tekst });
}

function tile({ key, title, body, foot, navigate }) {
  return el("button", {
    class: "srv-tile", type: "button",
    onclick: () => navigate(key),
    "aria-label": `Open ${title}`,
  }, [
    el("div", { class: "srv-tile-head" }, [
      el("span", { class: "ic", html: icon(key) }),   // constante SVG, geen serverdata
      el("h2", { text: title }),
    ]),
    el("div", { class: "srv-tile-body", text: body }),
    el("div", { class: "srv-tile-foot" }, foot),
  ]);
}

function skeleton(root) {
  const wrap = el("div", { class: "srv-cards" });
  for (let i = 0; i < 3; i++) {
    wrap.appendChild(el("div", { class: "sec-card" }, [
      el("div", { class: "sec-skel", style: "width:45%" }),
      el("div", { class: "sec-skel", style: "margin-top:12px;height:34px" }),
    ]));
  }
  root.appendChild(wrap);
}

export default {
  async render(root, { navigate }) {
    root.appendChild(el("div", { class: "srv-hero" }, [
      el("h1", { text: "Server Center" }),
      el("p", { text: "Everything Bucky does on this server that is not security: which commands members can use, the ticket system, and the applications people fill in." }),
    ]));
    const host = el("div");
    root.appendChild(host);
    skeleton(host);

    let data;
    try {
      data = await api.get("/overview");
    } catch (err) {
      clear(host);
      host.appendChild(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "This page did not load" }),
        el("p", { class: "sec-muted", text: err.message }),
        el("button", {
          class: "sec-btn sec-btn-sm", type: "button", text: "Try again",
          onclick: () => { clear(root); this.render(root, { navigate }); },
        }),
      ]));
      return;
    }

    const c = data.commands || {};
    const t = data.tickets || {};
    const a = data.applications || {};
    const uitgezet = (c.disabled_commands || 0) + (c.disabled_cogs || 0);

    clear(host);
    const cards = el("div", { class: "srv-cards srv-stagger" }, [
      tile({
        key: "commands", navigate,
        title: "Commands",
        body: uitgezet
          ? "Some commands are switched off here."
          : "Every command Bucky has is available on this server.",
        foot: [
          figure(uitgezet, uitgezet === 1 ? "switched off" : "switched off"),
          c.channels_with_overrides
            ? state(`${c.channels_with_overrides} channel${c.channels_with_overrides === 1 ? "" : "s"} differ`, "")
            : state("Same everywhere", "is-on"),
        ],
      }),
      tile({
        key: "tickets", navigate,
        title: "Tickets",
        body: t.enabled
          ? "Members can open a ticket and your team picks it up."
          : "Set up a place where members can ask for help in private.",
        foot: [
          figure(t.open_tickets || 0, (t.open_tickets === 1 ? "ticket" : "tickets") + " open"),
          t.enabled ? state("On", "is-on") : state("Off", "is-off"),
          t.enabled && !t.panel_published ? state("Panel not published", "") : null,
        ].filter(Boolean),
      }),
      tile({
        key: "applications", navigate,
        title: "Applications",
        body: a.forms
          ? "People apply through a form you wrote, and your team decides."
          : "Write a form people fill in to apply, for staff or anything else.",
        foot: [
          figure(a.enabled_forms || 0, `of ${a.forms || 0} live`),
          a.pending
            ? state(`${a.pending} waiting for a decision`, "")
            : state("Nothing waiting", "is-on"),
        ],
      }),
    ]);
    host.appendChild(cards);

    // De rustige voetregel: waar dit vandaan komt. Geen uitleg die niemand
    // vroeg, wel het antwoord op "verandert dit ook in Discord".
    host.appendChild(el("p", {
      class: "sec-page-sub", style: "margin-top:22px",
      text: "Changes here take effect in Discord straight away. The same settings can be changed with commands in the server.",
    }));
  },
};
