// Commands — welke commando's leden hier kunnen gebruiken.
//
// DE VORM VOLGT DE VRAAG. Een beheerder komt hier met één van twee vragen:
// "zet dit uit" (hij weet de naam) of "wat staat er eigenlijk uit" (hij weet de
// naam niet). Daarom bovenaan een zoekveld en een filter met drie standen, en
// daaronder de lijst per categorie - niet één lange tabel van 200 regels.
//
// WAT ELKE REGEL ZEGT. De naam als code (want zo typ je hem), waar hij geldt, en
// een schakelaar. De herkomstregel is nooit alleen een kleur: er staat een woord
// naast, want kleur alleen is geen informatie.
//
// DE SIGNATUUR VAN DEZE AFDELING staat onderaan: wat een lid in Discord te zien
// krijgt als hij een uitgezet commando probeert. Dezelfde zin als de bot stuurt
// (cogs/Help.py), zodat dit scherm laat zien in plaats van beweert.
import { api } from "../api.js";
import { el, clear, toast } from "../../security/ui.js";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "on", label: "Available" },
  { key: "off", label: "Switched off" },
];

function preview(naam, waar) {
  // De tekst komt letterlijk uit de bot (Help.py, global_command_check).
  return el("div", { class: "srv-preview" }, [
    el("div", { class: "srv-preview-head" }, [el("span", { text: "In Discord, a member sees" })]),
    el("div", { class: "srv-preview-body" }, [
      el("div", { class: "srv-preview-avatar", text: "B" }),
      el("div", { class: "srv-preview-msg" }, [
        el("div", { class: "who" }, [
          el("span", { text: "Bucky" }),
          el("span", { class: "tag", text: "APP" }),
        ]),
        el("div", { class: "text" }, [
          el("span", { text: "🚫 The command " }),
          el("code", { text: naam }),
          el("span", { text: ` is disabled in ${waar}.` }),
        ]),
        el("div", { class: "text" }, [
          el("span", { text: "Use " }),
          el("code", { text: "/listdisabled" }),
          el("span", { text: " to see all disabled commands or cogs." }),
        ]),
      ]),
    ]),
  ]);
}

export default {
  async render(root, { navigate }) {
    // `open` houdt bij welke categorieën de gebruiker zelf heeft opengeklapt.
    // Standaard staat alles dicht: de kop zegt al hoeveel er uitstaan, en dat is
    // wat je in één blik wilt zien.
    const state = { zoek: "", filter: "all", data: null, kanalen: [], open: new Set() };

    root.appendChild(el("div", { class: "srv-hero" }, [
      el("h1", { text: "Commands" }),
      el("p", { text: "Switch a command or a whole category off for this server, or only in one channel. A member who tries it gets a short reply telling them where it is off." }),
    ]));

    // De bediening blijft in beeld tijdens het scrollen: met tweehonderd
    // commando's is zoeken de snelste weg, en dan moet het veld niet boven de
    // vouw achterblijven.
    const controls = el("div", { class: "sec-row srv-sticky" });
    const zoekveld = el("input", {
      class: "sec-input", type: "search", placeholder: "Search commands…",
      "aria-label": "Search commands", style: "max-width:260px",
      oninput: (e) => { state.zoek = e.target.value.trim().toLowerCase(); teken(); },
    });
    const filterGroep = el("div", { class: "srv-dept", role: "group", "aria-label": "Filter" },
      FILTERS.map((f) => el("button", {
        class: "srv-dept-btn" + (f.key === state.filter ? " is-active" : ""),
        type: "button", "data-filter": f.key,
        text: f.label,
        onclick: () => {
          state.filter = f.key;
          filterGroep.querySelectorAll("[data-filter]").forEach((b) =>
            b.classList.toggle("is-active", b.getAttribute("data-filter") === f.key));
          teken();
        },
      })));
    controls.append(zoekveld, filterGroep);
    root.appendChild(controls);

    const teller = el("p", { class: "sec-page-sub", text: "" });
    root.appendChild(teller);

    const host = el("div");
    root.appendChild(host);
    host.appendChild(el("div", { class: "sec-loading", text: "Loading commands…" }));

    try {
      state.data = await api.get("/commands");
      state.kanalen = state.data.channels || [];
    } catch (err) {
      clear(host);
      host.appendChild(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "The command list did not load" }),
        el("p", { class: "sec-muted", text: err.message }),
        el("button", {
          class: "sec-btn sec-btn-sm", type: "button", text: "Try again",
          onclick: () => { clear(root); this.render(root, { navigate }); },
        }),
      ]));
      return;
    }

    async function schakel(rij, naam, isCog, uit, knop) {
      knop.disabled = true;
      try {
        await api.post("/commands/toggle", { name: naam, is_cog: isCog, disabled: uit });
        rij.disabled = uit;
        toast(uit ? `${naam} is switched off.` : `${naam} is available again.`);
        teken();
      } catch (err) {
        toast(err.message, "err");
        knop.disabled = false;
        // De schakelaar terugzetten: hij stond al om, en anders toont het scherm
        // een stand die de server niet heeft.
        knop.querySelector("input").checked = !uit;
      }
    }

    function regel(item, cogNaam, isCog) {
      const uit = !!item.disabled;
      const kanalen = item.channels || [];
      const rij = el("div", { class: "srv-row" + (uit ? " is-off" : "") });

      const naamBlok = el("div", { class: "srv-name" }, [
        el("code", { text: isCog ? cogNaam : item.name }),
        item.protected ? el("span", { class: "srv-state", text: "Always on" }) : null,
      ].filter(Boolean));

      const waar = uit
        ? el("span", { class: "srv-state is-off", text: "Off in this server" })
        : kanalen.length
          ? el("span", { class: "srv-state", text: `Off in ${kanalen.length} channel${kanalen.length === 1 ? "" : "s"}` })
          : el("span", { class: "srv-state is-on", text: "Available" });

      const input = el("input", {
        type: "checkbox", checked: uit ? "checked" : null,
        "aria-label": `${isCog ? cogNaam : item.name} switched off in this server`,
        disabled: item.protected ? "disabled" : null,
      });
      const schakelaar = el("label", { class: "sec-switch" }, [input, el("span", { class: "track" })]);
      input.addEventListener("change", () => schakel(item, isCog ? cogNaam : item.name, isCog, input.checked, schakelaar));

      const acties = el("div", { class: "srv-actions" }, [
        item.protected ? null : el("button", {
          class: "sec-btn sec-btn-ghost sec-btn-sm", type: "button",
          text: "Per channel…",
          onclick: () => perKanaal(item, isCog ? cogNaam : item.name, isCog),
        }),
        schakelaar,
      ].filter(Boolean));

      rij.append(naamBlok, waar, acties);
      return rij;
    }

    async function perKanaal(item, naam, isCog) {
      const { formModal } = await import("../../security/ui.js");
      const opties = state.kanalen.filter((k) => k.type !== 4);
      if (!opties.length) {
        toast("No channels to choose from.", "err");
        return;
      }
      const huidig = new Set(item.channels || []);
      const waarden = await formModal({
        title: `${naam} per channel`,
        fields: [{
          name: "channel", label: "Channel", type: "select",
          options: opties.map((k) => ({ value: k.id, label: `#${k.name}` })),
        }, {
          name: "mode", label: "In that channel", type: "select",
          options: [{ value: "off", label: "Switched off" }, { value: "on", label: "Available" }],
        }],
      });
      if (!waarden) return;
      try {
        await api.post("/commands/toggle", {
          name: naam, is_cog: isCog,
          disabled: waarden.mode === "off",
          channel_id: waarden.channel,
        });
        const kanaal = opties.find((k) => k.id === waarden.channel);
        if (waarden.mode === "off") huidig.add(waarden.channel); else huidig.delete(waarden.channel);
        item.channels = [...huidig];
        toast(waarden.mode === "off"
          ? `${naam} is off in #${kanaal ? kanaal.name : "the channel"}.`
          : `${naam} is available in #${kanaal ? kanaal.name : "the channel"} again.`);
        teken();
      } catch (err) {
        toast(err.message, "err");
      }
    }

    function past(item, naam) {
      if (state.zoek && !naam.toLowerCase().includes(state.zoek)) return false;
      if (state.filter === "off") return !!item.disabled || (item.channels || []).length;
      if (state.filter === "on") return !item.disabled;
      return true;
    }

    function teken() {
      clear(host);
      const cogs = state.data.cogs || [];
      if (!cogs.length) {
        host.appendChild(el("div", { class: "srv-empty" }, [
          el("h3", { text: "No commands to show yet" }),
          el("p", { text: "Bucky fills this list when it starts. If the bot has just restarted, refresh in a minute." }),
          el("button", {
            class: "sec-btn sec-btn-primary sec-btn-sm", type: "button", text: "Refresh",
            onclick: () => { clear(root); this.render(root, { navigate }); },
          }),
        ]));
        return;
      }

      let zichtbaar = 0, uitTotaal = 0;
      const lijst = el("div");
      for (const cog of cogs) {
        const commandos = (cog.commands || []).filter((c) => past(c, c.name));
        const cogPast = past(cog, cog.name);
        uitTotaal += (cog.commands || []).filter((c) => c.disabled).length + (cog.disabled ? 1 : 0);
        if (!commandos.length && !cogPast) continue;

        // De schakelaar van de CATEGORIE hoort op de kop van de categorie, niet
        // als eerste rij van de lijst eronder: daar leest hij als een commando
        // dat toevallig zo heet.
        const cogInput = el("input", {
          type: "checkbox", checked: cog.disabled ? "checked" : null,
          "aria-label": `Whole ${cog.name} category switched off`,
        });
        const cogSchakelaar = el("label", { class: "sec-switch" }, [cogInput, el("span", { class: "track" })]);
        cogInput.addEventListener("change", () =>
          schakel(cog, cog.name, true, cogInput.checked, cogSchakelaar));

        // INGEKLAPT TENZIJ JE ERNAAR ZOEKT (17 september 2026).
        //
        // Met tweehonderd commando's is een lange lijst geen ontwerp: op een
        // telefoon scrol je langs zeventien categorieën om er één te vinden.
        // Een categorie toont daarom zijn kop met de stand erin, en klapt open
        // als je hem opent - of vanzelf, zodra je zoekt of op "Switched off"
        // filtert, want dan is de lijst zelf al het antwoord.
        const uitTeller = (cog.commands || []).filter((c) => c.disabled).length;
        const vanzelfOpen = !!state.zoek || state.filter !== "all" || cog.disabled;
        const open = vanzelfOpen || state.open.has(cog.name);

        const kop = el("button", {
          class: "srv-group-title", type: "button",
          "aria-expanded": open ? "true" : "false",
          onclick: () => {
            state.open.has(cog.name) ? state.open.delete(cog.name) : state.open.add(cog.name);
            teken();
          },
        }, [
          el("span", { class: "chev", text: open ? "⌄" : "›" }),
          el("span", { class: "name", text: cog.name }),
          el("span", { class: "count", text: `${(cog.commands || []).length} commands` }),
          uitTeller
            ? el("span", { class: "srv-state is-off", text: `${uitTeller} off` })
            : null,
        ].filter(Boolean));

        const groep = el("div", {
          class: "srv-group" + (cog.disabled ? " is-off" : "") + (open ? " open" : ""),
        }, [
          el("div", { class: "srv-group-row" }, [
            kop,
            el("div", { class: "srv-actions" }, [
              el("span", {
                class: `srv-state ${cog.disabled ? "is-off" : ""}`.trim(),
                text: cog.disabled ? "Whole category off" : "Whole category",
              }),
              cogSchakelaar,
            ]),
          ]),
        ]);

        const blok = el("div", { class: "srv-list srv-stagger srv-group-body" });
        for (const c of commandos) blok.appendChild(regel(c, cog.name, false));
        zichtbaar += commandos.length;
        groep.appendChild(blok);
        lijst.appendChild(groep);
      }

      if (!zichtbaar) {
        host.appendChild(el("div", { class: "srv-empty" }, [
          el("h3", { text: "Nothing matches" }),
          el("p", { text: state.filter === "off" ? "Every command is available on this server." : "No command has that name." }),
        ]));
      } else {
        host.appendChild(lijst);
      }

      teller.textContent = uitTotaal
        ? `${uitTotaal} switched off on this server`
        : "Every command is available on this server";

      // De preview hoort bij de stand, dus hij staat onder de lijst en toont het
      // geval dat er is: iets uit, of niets uit.
      host.appendChild(preview(uitTotaal ? firstOff() : "snipe", "this server"));
    }

    function firstOff() {
      for (const cog of state.data.cogs || []) {
        if (cog.disabled) return cog.name;
        for (const c of cog.commands || []) if (c.disabled) return c.name;
      }
      return "snipe";
    }

    teken();
  },
};
