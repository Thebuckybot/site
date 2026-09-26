// Het profiel van de bot in DEZE server: bijnaam, avatar en bio.
//
// WAT ER STAAT KOMT VAN DISCORD. Bijnaam en avatar haalt de backend bij elke
// keer laden bij Discord op; iemand met Manage Nicknames kan de bijnaam in
// Discord zelf wijzigen, en dit scherm mag dan niet achterlopen. De bio is de
// uitzondering: een bot kan zijn serverbio nergens teruglezen (gemeten, zie
// backend/api/server_center/bot_profile.py), dus toont het scherm wat er het
// laatst vanaf hier is gezet - en zegt dat erbij.
//
// EEN OPSLAAN IS EEN AANROEP. Discord staat 20 wijzigingen per 5 minuten toe;
// daarom gaat alleen mee wat er echt veranderd is, en alle drie tegelijk.
//
// LEEGMAKEN IS EVEN BELANGRIJK ALS INSTELLEN. Elk veld heeft een knop die het
// terugzet naar wat de bot overal heeft: zijn eigen naam, avatar en About me.
//
// De controles op een afbeelding zijn die van het welcome-scherm
// (welcome_checks.js); de server heeft het laatste woord, met dezelfde woorden.
import { api } from "../api.js";
import { el, clear, toast } from "../../security/ui.js";
import { bestandFout } from "../welcome_checks.js";

function kaart(titel, uitleg, inhoud) {
  return el("div", { class: "sec-card", style: "margin-top:16px" }, [
    el("div", { class: "sec-page-title", text: titel }),
    uitleg ? el("p", { class: "sec-muted", style: "margin:0 0 14px", text: uitleg }) : null,
    ...inhoud,
  ].filter(Boolean));
}

function veld(label, control, hint) {
  return el("label", { class: "srv-field" }, [
    el("span", { class: "srv-field-label", text: label }),
    control,
    hint ? el("span", { class: "srv-field-hint", text: hint }) : null,
  ].filter(Boolean));
}

// Een melding die blijft staan tot de volgende handeling - zelfde vak als bij
// Welcome, om dezelfde reden: een toast is weg voordat hij gelezen is.
function foutvak() {
  const vak = el("p", { class: "srv-fout", role: "alert", hidden: true });
  return {
    node: vak,
    toon(tekst) { vak.textContent = tekst; vak.hidden = false; },
    wis() { vak.textContent = ""; vak.hidden = true; },
  };
}

function leesAlsDataUri(bestand) {
  return new Promise((ok, mis) => {
    const lezer = new FileReader();
    lezer.onload = () => ok(String(lezer.result));
    lezer.onerror = () => mis(new Error("The file could not be read. Pick it again."));
    lezer.readAsDataURL(bestand);
  });
}


// De afmetingen van een gekozen bestand, zonder het ergens heen te sturen.
function afmetingen(bestand) {
  return new Promise((ok) => {
    const url = URL.createObjectURL(bestand);
    const beeld = new Image();
    beeld.onload = () => { ok({ b: beeld.naturalWidth, h: beeld.naturalHeight }); URL.revokeObjectURL(url); };
    beeld.onerror = () => { ok(null); URL.revokeObjectURL(url); };
    beeld.src = url;
  });
}

// DE KLEINSTE BANNER. Een eigen regel en geen regel van Discord (die nam zelfs
// 16x6 aan, gemeten); het getal komt uit `limits.banner_min` van de API, dus
// uit dezelfde plek als de weigering van de server.
async function bannerMaatFout(bestand, minimum) {
  if (!minimum) return null;
  const m = await afmetingen(bestand);
  if (!m || (m.b >= minimum[0] && m.h >= minimum[1])) return null;
  return `Banner: that image is ${m.b}x${m.h} pixels. A banner needs at least `
       + `${minimum[0]} x ${minimum[1]}; Discord shows it wide, like 600 x 240.`;
}

export default {
  async render(root) {
    root.appendChild(el("div", { class: "srv-hero" }, [
      el("h1", { text: "Bot profile" }),
      el("p", { text: "How Bucky appears in this server: its name, its avatar, its banner "
                      + "and its bio. Changes here only affect this server; everywhere else "
                      + "Bucky keeps its own." }),
    ]));
    const host = el("div");
    root.appendChild(host);
    host.appendChild(el("div", { class: "sec-loading", text: "Asking Discord…" }));

    let stand;
    try {
      stand = await api.get("/bot-profile");
    } catch (err) {
      clear(host);
      host.appendChild(el("div", { class: "sec-card" }, [
        el("div", { class: "sec-page-title", text: "This page did not load" }),
        el("p", { class: "sec-muted", text: (err && err.message) || String(err) }),
      ]));
      return;
    }

    // Wat de gebruiker heeft gewijzigd maar nog niet opgeslagen. `undefined`
    // betekent "niet aangeraakt"; `null` bij de avatar betekent "terug naar de
    // eigen avatar van de bot".
    const wijziging = { nick: undefined, bio: undefined, avatar: undefined, avatarVoorbeeld: null,
                        banner: undefined, bannerVoorbeeld: null };
    const LEEG = { nick: undefined, bio: undefined, avatar: undefined, avatarVoorbeeld: null,
                   banner: undefined, bannerVoorbeeld: null };
    function vergeet() {
      if (wijziging.avatarVoorbeeld) URL.revokeObjectURL(wijziging.avatarVoorbeeld);
      if (wijziging.bannerVoorbeeld) URL.revokeObjectURL(wijziging.bannerVoorbeeld);
      Object.assign(wijziging, LEEG);
    }

    function teken() {
      clear(host);
      const g = stand.limits || {};
      const bot = stand.bot;
      const srv = stand.server;
      const opslaanFout = foutvak();

      // --- bijnaam ------------------------------------------------------
      const nickFout = foutvak();
      const nick = el("input", { class: "sec-input", maxlength: String(g.max_nick || 32),
                                 placeholder: bot.name, "aria-label": "Nickname in this server" });
      nick.value = wijziging.nick !== undefined ? wijziging.nick : (srv.nick || "");
      const nickTeller = el("span", { class: "srv-field-hint" });
      const telNick = () => { nickTeller.textContent = `${nick.value.length} / ${g.max_nick || 32}`; };
      telNick();
      nick.addEventListener("input", () => {
        wijziging.nick = nick.value; telNick(); nickFout.wis(); opslaanFout.wis(); ververs();
      });
      const nickLeeg = el("button", { class: "sec-btn sec-btn-sm", type: "button",
        text: "Use Bucky's own name", onclick: () => {
          nick.value = ""; wijziging.nick = ""; telNick(); ververs();
        } });
      if (!stand.can_change_nickname) {
        // CONCREET, EN VOORDAT IEMAND OP OPSLAAN DRUKT - niet pas als melding
        // van een mislukte opslag.
        nick.disabled = true; nickLeeg.disabled = true;
        nickFout.toon("Bucky does not have the Change Nickname permission in this "
          + "server, so it cannot change its own name here. Give one of Bucky's roles "
          + "\"Change Nickname\" in Server Settings > Roles, then reload this page. "
          + "The avatar and bio do not need it.");
      }

      // --- avatar -------------------------------------------------------
      const avatarFout = foutvak();
      const bestand = el("input", { type: "file", class: "sec-input",
                                    accept: "image/png,image/jpeg,image/gif,image/webp",
                                    "aria-label": "Upload an avatar" });
      bestand.addEventListener("change", async () => {
        const f = bestand.files && bestand.files[0];
        if (!f) return;
        avatarFout.wis(); opslaanFout.wis();
        const vooraf = bestandFout(f, { max_upload_bytes: g.max_upload_bytes,
                                        max_uploads: Infinity }, 0);
        if (vooraf) { avatarFout.toon(vooraf); bestand.value = ""; return; }
        try {
          wijziging.avatar = await leesAlsDataUri(f);
          // EEN LOKALE URL voor de preview: het bestand gaat nergens heen
          // voordat er op Opslaan is gedrukt.
          if (wijziging.avatarVoorbeeld) URL.revokeObjectURL(wijziging.avatarVoorbeeld);
          wijziging.avatarVoorbeeld = URL.createObjectURL(f);
        } catch (err) {
          avatarFout.toon(err.message);
        }
        bestand.value = "";
        teken();
      });
      const huidigeAvatar = wijziging.avatar === null ? bot.avatar_url
        : (wijziging.avatarVoorbeeld || srv.avatar_url || bot.avatar_url);
      const avatarStaat = wijziging.avatar === null ? "Bucky's own avatar (after saving)"
        : wijziging.avatar ? "New picture (not saved yet)"
        : srv.avatar_url ? "A picture for this server" : "Bucky's own avatar";
      const avatarLeeg = el("button", { class: "sec-btn sec-btn-sm", type: "button",
        text: "Use Bucky's own avatar",
        disabled: (!srv.avatar_url && !wijziging.avatar) || wijziging.avatar === null ? "disabled" : null,
        onclick: () => { wijziging.avatar = srv.avatar_url ? null : undefined;
                         wijziging.avatarVoorbeeld = null; teken(); } });

      // --- banner -----------------------------------------------------
      const bannerFout = foutvak();
      const bannerBestand = el("input", { type: "file", class: "sec-input",
                                          accept: "image/png,image/jpeg,image/gif,image/webp",
                                          "aria-label": "Upload a banner" });
      bannerBestand.addEventListener("change", async () => {
        const f = bannerBestand.files && bannerBestand.files[0];
        if (!f) return;
        bannerFout.wis(); opslaanFout.wis();
        const vooraf = bestandFout(f, { max_upload_bytes: g.max_upload_bytes,
                                        max_uploads: Infinity }, 0)
          || await bannerMaatFout(f, g.banner_min);
        if (vooraf) { bannerFout.toon(vooraf); bannerBestand.value = ""; return; }
        try {
          wijziging.banner = await leesAlsDataUri(f);
          if (wijziging.bannerVoorbeeld) URL.revokeObjectURL(wijziging.bannerVoorbeeld);
          wijziging.bannerVoorbeeld = URL.createObjectURL(f);
        } catch (err) {
          bannerFout.toon(err.message);
        }
        bannerBestand.value = "";
        teken();
      });
      const bannerStaat = wijziging.banner === null
        ? (bot.banner_url ? "Bucky's own banner (after saving)" : "No banner (after saving)")
        : wijziging.banner ? "New banner (not saved yet)"
        : srv.banner_url ? "A banner for this server"
        : bot.banner_url ? "Bucky's own banner" : "No banner yet";
      const bannerLeeg = el("button", { class: "sec-btn sec-btn-sm", type: "button",
        text: bot.banner_url ? "Use Bucky's own banner" : "Remove the banner",
        disabled: (!srv.banner_url && !wijziging.banner) || wijziging.banner === null ? "disabled" : null,
        onclick: () => { wijziging.banner = srv.banner_url ? null : undefined;
                         wijziging.bannerVoorbeeld = null; teken(); } });

      // --- bio ----------------------------------------------------------
      const bio = el("textarea", { class: "sec-input", rows: "4",
                                   maxlength: String(g.max_bio || 190),
                                   placeholder: bot.bio || "", "aria-label": "Bio in this server" });
      bio.value = wijziging.bio !== undefined ? wijziging.bio : (srv.bio || "");
      const bioTeller = el("span", { class: "srv-field-hint" });
      const telBio = () => { bioTeller.textContent = `${bio.value.length} / ${g.max_bio || 190}`; };
      telBio();
      bio.addEventListener("input", () => { wijziging.bio = bio.value; telBio(); opslaanFout.wis(); ververs(); });
      const bioLeeg = el("button", { class: "sec-btn sec-btn-sm", type: "button",
        text: "Use Bucky's About me", onclick: () => {
          bio.value = ""; wijziging.bio = ""; telBio(); ververs();
        } });

      // --- opslaan ------------------------------------------------------
      const opslaan = el("button", { class: "sec-btn sec-btn-primary", type: "button",
                                     id: "srv-botprofile-save", text: "Save" });
      const terug = el("button", { class: "sec-btn", type: "button", text: "Undo changes",
        onclick: () => { vergeet(); teken(); } });

      function wat() {
        // ALLEEN WAT ER ECHT VERANDERT. Een veld dat terug is gezet op wat er
        // al stond, telt niet - dat zou een van de twintig wijzigingen kosten.
        const body = {};
        if (wijziging.nick !== undefined && wijziging.nick.trim() !== (srv.nick || "")) {
          body.nick = wijziging.nick.trim() || null;
        }
        if (wijziging.bio !== undefined && wijziging.bio.trim() !== (srv.bio || "")) {
          body.bio = wijziging.bio.trim() || null;
        }
        if (wijziging.avatar !== undefined) body.avatar = wijziging.avatar;
        if (wijziging.banner !== undefined) body.banner = wijziging.banner;
        return body;
      }

      opslaan.addEventListener("click", async () => {
        const body = wat();
        if (!Object.keys(body).length) return;
        opslaan.disabled = true; opslaan.textContent = "Saving…";
        opslaanFout.wis();
        try {
          stand = await api.patch("/bot-profile", body);
          vergeet();
          const rl = stand.rate_limit;
          toast(rl ? `Saved. Discord allows ${rl.remaining} more change${rl.remaining === 1 ? "" : "s"} `
                     + `in the next ${Math.max(1, Math.ceil(rl.reset_after / 60))} minutes.`
                   : "Saved.");
          teken();
        } catch (err) {
          // DE MELDING BLIJFT STAAN, bij de knop. Een 429 zegt hoelang nog; een
          // weigering van Discord zegt wat Discord zei. Niets is dan veranderd.
          opslaanFout.toon((err && err.message) || "Could not save. Nothing was changed.");
          toast("Not saved.", "err");
          opslaan.textContent = "Save";
          ververs();
        }
      });

      const previewHost = el("div");
      function ververs() {
        const body = wat();
        opslaan.disabled = !Object.keys(body).length;
        terug.disabled = wijziging.nick === undefined && wijziging.bio === undefined
                         && wijziging.avatar === undefined && wijziging.banner === undefined;
        clear(previewHost);
        previewHost.appendChild(voorbeeld());
      }

      function huidigeBanner() {
        return wijziging.banner === null ? bot.banner_url
          : (wijziging.bannerVoorbeeld || srv.banner_url || bot.banner_url);
      }

      function voorbeeld() {
        const naam = (wijziging.nick !== undefined ? wijziging.nick.trim() : srv.nick) || bot.name;
        const beeld = wijziging.avatar === null ? bot.avatar_url
          : (wijziging.avatarVoorbeeld || srv.avatar_url || bot.avatar_url);
        const tekst = (wijziging.bio !== undefined ? wijziging.bio.trim() : (srv.bio || "")) || bot.bio;
        const avatar = () => el("img", { class: "dc-avatar-img", src: beeld, alt: "" });
        return el("div", { class: "dc-surface" }, [
          el("div", { class: "dc-surface-head" }, [
            el("span", { class: "hash", text: "#" }), el("span", { text: "general" })]),
          el("div", { class: "dc-msg" }, [
            avatar(),
            el("div", { class: "dc-body" }, [
              el("div", { class: "dc-who" }, [
                el("span", { class: "dc-name", text: naam }),
                el("span", { class: "dc-tag", text: "APP" }),
                el("span", { class: "dc-when", text: "Today at 14:02" }),
              ]),
              el("div", { class: "dc-text", text: "Hey! Type +help to see what I can do." }),
            ]),
          ]),
          el("div", { class: "dc-profiel" }, [
            // EEN <img> EN GEEN background-image in een style-attribuut: de URL
            // komt dan nooit in CSS terecht.
            el("div", { class: "dc-profiel-kop" }, huidigeBanner()
              ? [el("img", { class: "dc-profiel-banner", src: huidigeBanner(), alt: "" })] : []),
            avatar(),
            el("div", { class: "dc-profiel-naam", text: naam }),
            el("div", { class: "dc-profiel-user", text: bot.username }),
            el("div", { class: "dc-profiel-kopje", text: "About me" }),
            el("div", { class: "dc-profiel-bio", text: tekst || "No bio." }),
          ]),
        ]);
      }

      const links = el("div", {}, [
        kaart("Nickname", "The name Bucky uses in this server.", [
          // Tussen haakjes: de echte naam eindigt op een punt ("Bucky."), en
          // "naam: Bucky.." leest als een tikfout.
          veld("Nickname", nick, `Leave empty to use Bucky's own name (${bot.name}).`),
          nickTeller, el("div", { class: "srv-rij" }, [nickLeeg]), nickFout.node,
        ]),
        kaart("Avatar", "The picture next to Bucky's messages in this server.", [
          el("div", { class: "srv-avatar-nu" }, [
            el("img", { class: "srv-avatar-klein", src: huidigeAvatar, alt: "" }),
            el("span", { class: "sec-muted", text: avatarStaat }),
          ]),
          veld("Upload a picture", bestand,
               `PNG, JPEG, GIF or WebP, up to ${Math.round((g.max_upload_bytes || 2097152) / 1048576)} MB.`),
          el("div", { class: "srv-rij" }, [avatarLeeg]), avatarFout.node,
        ]),
        kaart("Banner", "The wide picture at the top of Bucky's profile in this server.", [
          el("div", { class: "srv-banner-nu" }, [
            huidigeBanner() ? el("img", { class: "srv-banner-klein", src: huidigeBanner(), alt: "" })
                            : el("div", { class: "srv-banner-klein leeg" }),
            el("span", { class: "sec-muted", text: bannerStaat }),
          ]),
          veld("Upload a banner", bannerBestand,
               `PNG, JPEG, GIF or WebP, up to ${Math.round((g.max_upload_bytes || 2097152) / 1048576)} MB. `
               + "Discord shows it wide, like 600 x 240, and crops other shapes. "
               + "A GIF moves."),
          el("div", { class: "srv-rij" }, [bannerLeeg]), bannerFout.node,
          // VOORAF GEZEGD, want het is een ander limiet dan de 20 per 5 minuten
          // onderaan, en wie het niet weet, loopt er bij de derde poging tegenaan.
          el("p", { class: "sec-muted", style: "font-size:12px;margin:8px 0 0",
            text: `Discord lets a bot change its banner only ${g.banner_changes
              || "twice in about 10 to 15 minutes"}.` }),
        ]),
        kaart("Bio", "The About me members see on Bucky's profile in this server.", [
          veld("Bio", bio, srv.bio_known
            ? "Leave empty to use Bucky's About me."
            : "Nothing has been set here from this dashboard yet, so members see "
              + "Bucky's About me. Discord does not let Bucky read this back, so this "
              + "field shows what was last saved here."),
          bioTeller, el("div", { class: "srv-rij" }, [bioLeeg]),
        ]),
        el("div", { class: "sec-card", style: "margin-top:16px" }, [
          el("div", { class: "srv-rij" }, [opslaan, terug]),
          el("p", { class: "sec-muted", style: "font-size:12px;margin:8px 0 0",
            text: `Discord allows ${g.changes_per_window || 20} changes to Bucky's profile `
                  + `per ${Math.round((g.window_seconds || 300) / 60)} minutes in a server. `
                  + "One Save counts as one change, however many fields it touches." }),
          opslaanFout.node,
        ]),
      ]);

      const rechts = el("div", { class: "srv-welcome-preview" }, [
        previewHost,
        el("p", { class: "sec-muted", style: "font-size:12px;margin:8px 0 0",
          text: "A preview, not a simulation: Discord's spacing differs a little." }),
      ]);
      host.appendChild(el("div", { class: "srv-welcome" }, [links, rechts]));
      ververs();
    }

    teken();
  },
};
