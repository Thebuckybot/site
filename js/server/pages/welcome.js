// Welcome en Goodbye — het bericht dat een server zelf samenstelt.
//
// DE OPZET VAN HET SCHERM, EN WAAROM HIJ ZO IS
// Links bouwen, rechts kijken. Dat is de enige indeling die werkt voor iets
// waar je aan sleutelt: een preview onderaan betekent scrollen na elke wijziging,
// en een preview in een modal betekent dat je hem dichtdoet om verder te kunnen.
// Boven 1100px blijft de preview plakken terwijl je links doorwerkt.
//
// TWEE BERICHTEN, TWEE TABBLADEN. Welcome en Goodbye zijn hetzelfde werk met een
// andere inhoud; ze naast elkaar zetten zou het scherm verdubbelen en de preview
// halveren. Het tabblad onthoudt niets tussen bezoeken - dat is met opzet, want
// "waar was ik" is hier geen vraag: je komt voor een van de twee.
//
// WAT DE BROWSER KLEMT EN WAT DE SERVER KLEMT
// Allebei, en niet hetzelfde. De browser klemt zodat je het ziet aankomen: de
// tellers onder de bouwer lopen mee terwijl je typt. De SERVER klemt omdat het
// moet - wie dit formulier omzeilt praat rechtstreeks met de endpoints. De
// getallen komen uit één bron (`limits` in het antwoord van de API), zodat de
// twee niet uit elkaar kunnen lopen.
//
// GEEN ENKELE `html:` IN DIT BESTAND, en geen `innerHTML`. Alles wat getypt is
// gaat via `text:`. Zie welcome_preview.js voor waarom dat hier strenger telt
// dan elders, en bucky1.0/tests/test_site_html_injectie.py voor de vangrail.
import { api } from "../api.js";
import { el, clear, toast, confirmDialog } from "../../security/ui.js";
import { tekenPreview, gewicht, tekens, VOORBEELD } from "../welcome_preview.js";
import { urlFout, bestandFout } from "../welcome_checks.js";

const LABEL = { welcome: "Welcome", leave: "Goodbye" };
const UITLEG = {
  welcome: "Sent when somebody joins your server.",
  leave: "Sent when somebody leaves. This also fires on a kick or a ban.",
};

// Een nieuw blok begint niet leeg. Een leeg tekstvak vraagt "en nu?"; een
// voorbeeldregel laat zien wat er kan en is in één keer weg te halen.
const NIEUW = {
  text: () => ({ type: "text", content: "Welcome {user} to **{server}**!" }),
  separator: () => ({ type: "separator", divider: true, spacing: "small" }),
  section: () => ({ type: "section", content: "You are member #{membercount}.",
                    accessory: null }),
  image: () => ({ type: "image", url: "" }),
  buttons: () => ({ type: "buttons",
                    items: [{ label: "Read the rules", url: "https://", style: "link" }] }),
};

const BLOKNAAM = {
  text: "Text", separator: "Divider", section: "Text with image",
  image: "Image", buttons: "Buttons",
};

// Acht kleuren die het in Discords donkere thema doen. Een kiezer met alle
// 16 miljoen staat er ook, maar niemand kiest daar een goede kleur uit.
const SWATCHES = [
  0x5865F2, 0x57F287, 0xFEE75C, 0xEB459E,
  0xED4245, 0x8B1E3F, 0x1ABC9C, 0x95A5A6,
];

function hex(n) { return "#" + (n >>> 0).toString(16).padStart(6, "0"); }

function kaart(titel, uitleg, inhoud) {
  return el("div", { class: "sec-card", style: "margin-top:16px" }, [
    el("div", { class: "sec-page-title", text: titel }),
    uitleg ? el("p", { class: "sec-muted", style: "margin:0 0 14px", text: uitleg }) : null,
    ...inhoud,
  ].filter(Boolean));
}

// EEN VELD IS EEN GESTAPELD BLOKJE: label boven, bediening eronder, uitleg
// daaronder. De eerste versie hing aan `.sec-field`/`.sec-label`, en die
// bestaan niet in security.css - het label en de uitleg liepen daardoor op de
// preview van 26 september dwars door elkaar heen. Gezien op de plaat, niet
// bedacht.
function veld(label, control, hint) {
  return el("label", { class: "srv-field" }, [
    el("span", { class: "srv-field-label", text: label }),
    control,
    hint ? el("span", { class: "srv-field-hint", text: hint }) : null,
  ].filter(Boolean));
}

// Een schakelaar is de bestaande `sec-switch`: een input MET een `.track`
// ernaast. Een kale checkbox met die klasse erop is onzichtbaar gestyled.
function schakelaar(aan, onChange) {
  const input = el("input", { type: "checkbox" });
  input.checked = !!aan;
  input.addEventListener("change", () => onChange(input.checked, input));
  return { input, node: el("label", { class: "sec-switch" },
                           [input, el("span", { class: "track" })]) };
}

export default {
  async render(root, { navigate }) {
    root.appendChild(el("div", { class: "srv-hero" }, [
      el("h1", { text: "Welcome & Goodbye" }),
      el("p", { text: "Build the message people see when they join or leave. "
                      + "You choose the channel, the colour and every block in it, "
                      + "and you can see it the way Discord will show it." }),
    ]));

    const host = el("div");
    root.appendChild(host);
    host.appendChild(el("div", { class: "sec-loading", text: "Loading messages…" }));

    let data;
    try {
      data = await api.get("/welcome");
    } catch (err) {
      clear(host);
      host.appendChild(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "This page did not load" }),
        el("p", { class: "sec-muted", text: (err && err.message) || String(err) }),
      ]));
      return;
    }

    // De stand van het scherm. Eén object, want twee berichten die elk hun
    // eigen "is er iets gewijzigd" bijhouden is twee keer dezelfde fout maken.
    const state = {
      kind: "welcome",
      berichten: {},
      vuil: { welcome: false, leave: false },
      afbeeldingen: (data.images || []).slice(),
      limieten: data.limits || {},
      kanalen: data.channels || [],
      // Het laatst aangeraakte tekstveld, zodat een placeholder-chip weet waar
      // hij geplakt moet worden.
      laatsteVeld: null,
    };
    for (const bericht of data.messages || []) state.berichten[bericht.kind] = bericht;

    clear(host);
    const tabhost = el("div");
    const scherm = el("div");
    host.append(tabhost, scherm);

    function tabs() {
      // BIJWERKEN, NIET VERVANGEN, als de knoppen er al zijn. `vuil()` roept
      // dit aan, en `vuil()` kan vuren op de `change` van een veld dat zijn
      // focus verliest - precies op het moment dat je op een tab klikt. Werden
      // de knoppen dan vervangen, dan landde de klik op een knop die al uit
      // de pagina was, en gebeurde er niets (gemeten op 26 september).
      const bestaand = tabhost.querySelectorAll("[role=tab]");
      if (bestaand.length === Object.keys(LABEL).length) {
        Object.keys(LABEL).forEach((k, i) => {
          const knop = bestaand[i];
          knop.className = "sec-tab" + (state.kind === k ? " active" : "");
          knop.setAttribute("aria-selected", String(state.kind === k));
          knop.textContent = LABEL[k] + (state.vuil[k] ? " •" : "");
        });
        return;
      }
      clear(tabhost);
      tabhost.appendChild(el("div", { class: "sec-tabs", role: "tablist" },
        Object.keys(LABEL).map((k) => el("button", {
          class: "sec-tab" + (state.kind === k ? " active" : ""),
          type: "button", role: "tab", "aria-selected": String(state.kind === k),
          text: LABEL[k] + (state.vuil[k] ? " •" : ""),
          onclick: () => { state.kind = k; tabs(); teken(); },
        }))));
    }

    // ---------------------------------------------------------------------
    // Tekenen
    // ---------------------------------------------------------------------
    let previewHost = null;

    function huidig() { return state.berichten[state.kind]; }

    function vuil(ja = true) {
      state.vuil[state.kind] = ja;
      tabs();
      const knop = document.getElementById("srv-welcome-save");
      if (knop) knop.disabled = !ja;
    }

    function ververs() {
      if (!previewHost) return;
      clear(previewHost);
      previewHost.appendChild(tekenPreview(huidig().layout,
        { hosts: state.limieten.image_hosts || [] }));
      tellers();
    }

    function tellers() {
      const doc = huidig().layout;
      const g = gewicht(doc);
      const t = tekens(doc, VOORBEELD);
      const n = (doc.blocks || []).length;
      const zet = (id, waarde, max) => {
        const node = document.getElementById(id);
        if (!node) return;
        clear(node);
        node.appendChild(el("b", { text: String(waarde) }));
        node.appendChild(document.createTextNode(` / ${max}`));
        node.className = "srv-meter"
          + (waarde > max ? " over" : waarde > max * 0.85 ? " warn" : "");
      };
      zet("m-blocks", n, state.limieten.max_blocks || 20);
      zet("m-weight", g, state.limieten.max_weight || 38);
      zet("m-text", t, state.limieten.max_text_total || 3400);
    }

    function teken() {
      clear(scherm);
      const bericht = huidig();

      // --- links: instellen en bouwen -----------------------------------
      const links = el("div");

      // 1. Waar en of het aanstaat.
      const aan = schakelaar(bericht.enabled, async (waarde, input) => {
        try {
          await api.patch(`/welcome/${state.kind}`, { enabled: waarde });
          bericht.enabled = waarde;
          toast(`${LABEL[state.kind]} messages are ${waarde ? "on" : "off"}.`);
        } catch (err) {
          input.checked = !waarde;
          toast((err && err.message) || "Could not save that.", "err");
        }
      });

      const kanaal = el("select", { class: "sec-select" }, [
        el("option", { value: "", text: "Pick a channel…" }),
        ...state.kanalen.map((k) => el("option", { value: k.id, text: "#" + k.name })),
      ]);
      kanaal.value = bericht.channel_id || "";
      kanaal.addEventListener("change", async () => {
        try {
          await api.patch(`/welcome/${state.kind}`, { channel_id: kanaal.value || null });
          bericht.channel_id = kanaal.value || null;
          toast("Channel saved.");
        } catch (err) {
          kanaal.value = bericht.channel_id || "";
          toast((err && err.message) || "Could not save that.", "err");
        }
      });

      links.appendChild(kaart(LABEL[state.kind] + " message", UITLEG[state.kind], [
        veld("Switched on", aan.node,
             "Off means nothing is sent. You can still use Send test below."),
        veld("Channel", kanaal,
             "Only text and announcement channels are listed."),
      ]));

      // 2. De kleur van de kaart.
      const kleur = el("input", { type: "color" });
      kleur.value = hex(bericht.layout.accent || 0x5865F2);
      kleur.addEventListener("input", () => {
        bericht.layout.accent = parseInt(kleur.value.slice(1), 16);
        vuil(); ververs();
      });
      links.appendChild(kaart("Colour", "The stripe down the left of the card.", [
        el("div", { class: "srv-accent" }, [
          kleur,
          el("div", { class: "srv-swatches" }, SWATCHES.map((c) => el("button", {
            class: "srv-swatch", type: "button", style: `background:${hex(c)}`,
            "aria-label": `Use ${hex(c)}`,
            onclick: () => {
              bericht.layout.accent = c;
              kleur.value = hex(c);
              vuil(); ververs();
            },
          }))),
        ]),
      ]));

      // 3. De blokken.
      const blokhost = el("div");
      links.appendChild(kaart("Blocks", "Every block becomes a piece of the card. "
                              + "Drag order with the arrows.", [
        blokhost,
        el("div", { class: "srv-add-row" },
          Object.keys(NIEUW).map((soort) => el("button", {
            class: "sec-btn sec-btn-sm", type: "button", text: "+ " + BLOKNAAM[soort],
            onclick: () => {
              const max = state.limieten.max_blocks || 20;
              if ((bericht.layout.blocks || []).length >= max) {
                toast(`A message holds at most ${max} blocks.`, "err");
                return;
              }
              bericht.layout.blocks = (bericht.layout.blocks || []).concat([NIEUW[soort]()]);
              vuil(); blokken(); ververs();
            },
          }))),
        el("div", { class: "srv-meters" }, [
          el("span", { class: "sec-muted" }, [
            document.createTextNode("Blocks "), el("span", { id: "m-blocks" })]),
          el("span", { class: "sec-muted" }, [
            document.createTextNode("Components "), el("span", { id: "m-weight" })]),
          el("span", { class: "sec-muted" }, [
            document.createTextNode("Characters "), el("span", { id: "m-text" })]),
        ]),
        el("p", { class: "sec-muted", style: "font-size:12px;margin:8px 0 0",
                  text: "Discord counts a text-with-image block as three components "
                        + "and an image as two, so the component count runs ahead of "
                        + "the block count." }),
      ]));

      function blokken() {
        clear(blokhost);
        const lijst = bericht.layout.blocks || [];
        if (!lijst.length) {
          blokhost.appendChild(el("p", { class: "sec-muted",
            text: "No blocks yet. Add one below and it appears in the preview." }));
          return;
        }
        lijst.forEach((blok, i) => blokhost.appendChild(blokKaart(blok, i, lijst)));
      }

      function blokKaart(blok, i, lijst) {
        const verplaats = (naar) => {
          if (naar < 0 || naar >= lijst.length) return;
          const [eruit] = lijst.splice(i, 1);
          lijst.splice(naar, 0, eruit);
          vuil(); blokken(); ververs();
        };
        return el("div", { class: "srv-block" }, [
          el("div", { class: "srv-block-head" }, [
            el("span", { class: "srv-block-kind", text: BLOKNAAM[blok.type] || blok.type }),
            el("div", { class: "srv-block-actions" }, [
              el("button", { class: "srv-iconbtn", type: "button", text: "↑",
                             title: "Move up", "aria-label": "Move up",
                             disabled: i === 0 ? "disabled" : null,
                             onclick: () => verplaats(i - 1) }),
              el("button", { class: "srv-iconbtn", type: "button", text: "↓",
                             title: "Move down", "aria-label": "Move down",
                             disabled: i === lijst.length - 1 ? "disabled" : null,
                             onclick: () => verplaats(i + 1) }),
              el("button", { class: "srv-iconbtn", type: "button", text: "✕",
                             title: "Remove", "aria-label": "Remove this block",
                             onclick: () => {
                               lijst.splice(i, 1);
                               vuil(); blokken(); ververs();
                             } }),
            ]),
          ]),
          el("div", { class: "srv-block-body" }, blokVelden(blok)),
        ]);
      }

      function tekstvak(blok, sleutel) {
        const max = state.limieten.max_text_block || 2000;
        const vak = el("textarea", { class: "sec-input", rows: "3", maxlength: String(max) });
        vak.value = blok[sleutel] || "";
        vak.addEventListener("input", () => {
          blok[sleutel] = vak.value;
          vuil(); ververs();
        });
        // Onthouden waar een placeholder-chip geplakt moet worden.
        vak.addEventListener("focus", () => { state.laatsteVeld = vak; });
        return vak;
      }

      // EEN FOUT BLIJFT STAAN tot de volgende handeling. Een toast verdwijnt na
      // drie seconden, en een melding met een lijst domeinen of een grootte
      // is niet in drie seconden gelezen. De toast komt er nog bij, voor wie
      // naar de hoek kijkt.
      function foutvak() {
        const vak = el("p", { class: "srv-fout", role: "alert", hidden: true });
        return {
          node: vak,
          toon(tekst) { vak.textContent = tekst; vak.hidden = false; },
          wis() { vak.textContent = ""; vak.hidden = true; },
        };
      }

      // DE KIEZER HEEFT ALLE DRIE DE WEGEN: uit de lijst, uploaden, of een link
      // plakken. Tot 26 september stond het plakveld alleen bij het losse
      // Image-blok; bij "Text with image" beloofde de uitleg het wel, maar
      // stond er geen veld. Nu zit het in de kiezer zelf, zodat elk blok met
      // een afbeelding - in welcome en in leave - hetzelfde krijgt.
      function afbeeldingskiezer(huidigeUrl, onKies) {
        const hosts = state.limieten.image_hosts || [];
        const fout = foutvak();
        const eigen = (url) => state.afbeeldingen.some((a) => a.url === url);

        const keuze = el("select", { class: "sec-select" }, [
          el("option", { value: "", text: "No image" }),
          ...state.afbeeldingen.map((a) => el("option", {
            value: a.url, text: a.filename || a.token.slice(0, 8) })),
        ]);
        // Een URL die niet in de lijst staat (van Discords CDN, met de hand
        // ingevuld) hoort niet stil te verdwijnen uit de keuzelijst.
        const gelinkt = el("option", { value: "", text: "(linked image)" });
        function zetGelinkt(url) {
          if (url && !eigen(url)) {
            gelinkt.value = url;
            if (!gelinkt.parentNode) keuze.appendChild(gelinkt);
          } else if (gelinkt.parentNode) {
            gelinkt.remove();
          }
          keuze.value = url || "";
        }
        zetGelinkt(huidigeUrl);

        const plak = el("input", { class: "sec-input", type: "url",
                                   placeholder: "https://cdn.discordapp.com/…",
                                   "aria-label": "Paste an image link" });
        plak.value = huidigeUrl && !eigen(huidigeUrl) ? huidigeUrl : "";

        keuze.addEventListener("change", () => {
          fout.wis();
          plak.value = keuze.value && !eigen(keuze.value) ? keuze.value : "";
          onKies(keuze.value || "");
        });

        // Tijdens het typen niets doen: "https://cdn.disc" is nog geen fout,
        // en de preview mag een halve link niet gaan ophalen. Pas bij verlaten
        // of Enter wordt er gekeken - en alleen een goedgekeurde link komt in
        // het document en dus in de preview.
        plak.addEventListener("input", () => fout.wis());
        const neemOver = () => {
          const url = plak.value.trim();
          const probleem = urlFout(url, hosts);
          if (probleem) { fout.toon(probleem); return; }
          fout.wis();
          zetGelinkt(url);
          onKies(url);
        };
        plak.addEventListener("change", neemOver);
        plak.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); neemOver(); }
        });

        const bestand = el("input", { type: "file", class: "sec-input",
                                      accept: "image/png,image/jpeg,image/gif,image/webp" });
        bestand.addEventListener("change", async () => {
          const f = bestand.files && bestand.files[0];
          if (!f) return;
          fout.wis();
          // EERST HIER, dan pas de server. Hetzelfde oordeel, maar zonder dat
          // er drie megabyte over de lijn gaat om het te horen.
          const vooraf = bestandFout(f, state.limieten, state.afbeeldingen.length);
          if (vooraf) {
            fout.toon(vooraf);
            toast("That image was not uploaded.", "err");
            bestand.value = "";
            return;
          }
          try {
            const uit = await api.upload("/welcome/images", f);
            state.afbeeldingen.unshift(uit);
            onKies(uit.url);
            toast("Image uploaded.");
            teken();
          } catch (err) {
            fout.toon((err && err.message) || "Upload failed.");
            toast("That image was not uploaded.", "err");
          } finally {
            bestand.value = "";
          }
        });

        const mb = Math.round((state.limieten.max_upload_bytes || 2097152) / 1048576);
        return el("div", { style: "display:grid;gap:8px" }, [
          keuze,
          veld("Or upload one", bestand,
               `PNG, JPEG, GIF or WebP, up to ${mb} MB. `
               + `At most ${state.limieten.max_uploads || 10} per server.`),
          veld("Or paste a link", plak,
               `Only from ${[...hosts].sort().join(", ")}. `
               + "Anything else has to be uploaded."),
          fout.node,
        ]);
      }

      function blokVelden(blok) {
        if (blok.type === "text") {
          return [veld("Text", tekstvak(blok, "content"))];
        }

        if (blok.type === "separator") {
          const zichtbaar = schakelaar(blok.divider !== false, (waarde) => {
            blok.divider = waarde; vuil(); ververs();
          });
          const ruim = el("select", { class: "sec-select" }, [
            el("option", { value: "small", text: "Small gap" }),
            el("option", { value: "large", text: "Large gap" }),
          ]);
          ruim.value = blok.spacing || "small";
          ruim.addEventListener("change", () => {
            blok.spacing = ruim.value; vuil(); ververs();
          });
          return [veld("Show a line", zichtbaar.node,
                       "Off leaves the space without a line."),
                  veld("Spacing", ruim)];
        }

        if (blok.type === "section") {
          return [
            veld("Text", tekstvak(blok, "content")),
            veld("Image on the right",
                 afbeeldingskiezer(blok.accessory && blok.accessory.url, (url) => {
                   blok.accessory = url ? { kind: "thumbnail", url } : null;
                   vuil(); ververs();
                 })),
          ];
        }

        if (blok.type === "image") {
          return [
            veld("Image", afbeeldingskiezer(blok.url, (url) => {
              blok.url = url; vuil(); ververs();
            })),
          ];
        }

        // buttons
        const max = state.limieten.max_buttons || 5;
        const rijen = (blok.items || []).map((knop, j) => el("div", {
          style: "display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end",
        }, [
          veld("Label", (() => {
            const i1 = el("input", { class: "sec-input",
                                     maxlength: String(state.limieten.max_button_label || 80) });
            i1.value = knop.label || "";
            i1.addEventListener("input", () => { knop.label = i1.value; vuil(); ververs(); });
            return i1;
          })()),
          veld("Link", (() => {
            const i2 = el("input", { class: "sec-input", type: "url" });
            i2.value = knop.url || "";
            i2.addEventListener("input", () => { knop.url = i2.value.trim(); vuil(); ververs(); });
            return i2;
          })()),
          el("button", { class: "srv-iconbtn", type: "button", text: "✕",
                         "aria-label": "Remove this button",
                         onclick: () => {
                           blok.items.splice(j, 1);
                           vuil(); blokken(); ververs();
                         } }),
        ]));
        rijen.push(el("button", {
          class: "sec-btn sec-btn-sm", type: "button", text: "+ Button",
          disabled: (blok.items || []).length >= max ? "disabled" : null,
          onclick: () => {
            blok.items = (blok.items || []).concat(
              [{ label: "Button", url: "https://", style: "link" }]);
            vuil(); blokken(); ververs();
          },
        }));
        rijen.push(el("p", { class: "sec-muted", style: "font-size:12px;margin:0",
          text: "Buttons open a link. A button that does something inside Discord "
                + "is not built yet." }));
        return rijen;
      }

      blokken();

      // 4. De placeholders.
      links.appendChild(kaart("Placeholders",
        "Click one to drop it into the text box you were typing in.", [
          el("div", { class: "srv-chips" },
            Object.keys(data.placeholders || {}).map((naam) => el("button", {
              class: "srv-chip", type: "button", text: "{" + naam + "}",
              title: data.placeholders[naam],
              onclick: () => {
                const vak = state.laatsteVeld;
                if (!vak) { toast("Click in a text box first.", "err"); return; }
                const p = "{" + naam + "}";
                const start = vak.selectionStart ?? vak.value.length;
                vak.value = vak.value.slice(0, start) + p + vak.value.slice(vak.selectionEnd ?? start);
                vak.dispatchEvent(new Event("input"));
                vak.focus();
                vak.selectionStart = vak.selectionEnd = start + p.length;
              },
            }))),
          el("dl", { class: "sec-muted", style: "font-size:12px;margin:12px 0 0;"
                     + "display:grid;grid-template-columns:auto 1fr;gap:4px 12px" },
            Object.entries(data.placeholders || {}).flatMap(([naam, uitleg]) => [
              el("dt", { style: "font-family:var(--font-mono)", text: "{" + naam + "}" }),
              el("dd", { style: "margin:0", text: uitleg }),
            ])),
        ]));

      // --- rechts: de preview -------------------------------------------
      previewHost = el("div");
      const kanaalnaam = (state.kanalen.find((k) => k.id === bericht.channel_id) || {}).name;
      const rechts = el("div", { class: "srv-welcome-preview" }, [
        el("div", { class: "dc-surface" }, [
          el("div", { class: "dc-surface-head" }, [
            el("span", { class: "hash", text: "#" }),
            el("span", { text: kanaalnaam || "no channel picked yet" }),
          ]),
          previewHost,
        ]),
        el("p", { class: "sec-muted", style: "font-size:12px;margin:10px 2px 0",
          text: "A preview, not a simulation. Discord's spacing and the way it "
                + "scales images differ a little; what this shows is what is in "
                + "the message and in what order." }),
        el("div", { style: "display:flex;gap:8px;margin-top:12px;flex-wrap:wrap" }, [
          el("button", {
            class: "sec-btn sec-btn-primary", type: "button", id: "srv-welcome-save",
            text: "Save message", disabled: state.vuil[state.kind] ? null : "disabled",
            onclick: bewaar,
          }),
          el("button", {
            class: "sec-btn", type: "button", text: "Send test", onclick: test,
          }),
        ]),
        el("p", { class: "sec-muted", style: "font-size:12px;margin:8px 2px 0",
          text: "Send test posts it in the channel above, with you as the member, "
                + "even when the message is switched off." }),
      ]);

      scherm.appendChild(el("div", { class: "srv-welcome" }, [links, rechts]));
      ververs();
    }

    // ---------------------------------------------------------------------
    // Opslaan en testen
    // ---------------------------------------------------------------------
    async function bewaar() {
      const knop = document.getElementById("srv-welcome-save");
      if (knop) { knop.disabled = true; knop.textContent = "Saving…"; }
      try {
        const uit = await api.patch(`/welcome/${state.kind}`,
                                    { layout: huidig().layout });
        // DE SERVER HEEFT HET LAATSTE WOORD. Wat er terugkomt is de tekst ZOALS
        // HIJ IS OPGESLAGEN - met de leidende `##` eraf en de lengtes geklemd.
        // Dat terugzetten in het scherm is het verschil tussen "opgeslagen" en
        // "opgeslagen, en dit is wat er staat".
        state.berichten[state.kind] = uit;
        state.vuil[state.kind] = false;
        toast("Saved.");
        tabs(); teken();
      } catch (err) {
        toast((err && err.message) || "Could not save.", "err");
        if (knop) { knop.disabled = false; knop.textContent = "Save message"; }
      }
    }

    async function test() {
      if (state.vuil[state.kind]) {
        const ok = await confirmDialog({
          title: "Save first?",
          message: "The test sends what is saved, not what is on screen. "
                   + "Save your changes first?",
          confirmLabel: "Save and send",
        });
        if (!ok) return;
        await bewaar();
      }
      try {
        await api.post(`/welcome/${state.kind}/test`, {});
        toast("Sent. Have a look in the channel.");
      } catch (err) {
        toast((err && err.message) || "It did not send.", "err");
      }
    }

    tabs();
    teken();
  },
};
