// De live preview: hetzelfde document dat de bot krijgt, getekend als Discord.
//
// DE ENIGE REGEL DIE ER ECHT TOE DOET
// Er staat in dit hele bestand geen `innerHTML` en geen `html:`. Alles wat een
// servereigenaar typt gaat via `text:` naar `textContent`. Dat is niet netheid
// maar de hele XSS-verdediging van deze pagina: een preview die markdown "even
// zelf" naar HTML vertaalt is precies de keten die op 6 augustus 2026 in de VM
// is gevonden (docs/onderzoek-2026-08-06/G-beveiliging-site-en-vm.md, G-1).
//
// De scan die dat bewaakt staat in bucky1.0/tests/test_site_html_injectie.py en
// is voor dit scherm uitgebreid: hij ziet nu ook een rechtstreekse toewijzing
// aan `innerHTML`, buiten de bouwer om.
//
// HOE MARKDOWN DAN TOCH WORDT GETOOND
// Door de tekst te KNIPPEN en elk stuk in een eigen element te zetten, nooit
// door er opmaak-HTML van te maken. `**vet**` wordt `el("strong", {text: ...})`
// en niet `<strong>` + de tekst erin geplakt. Het verschil is dat de inhoud
// dan nooit door een HTML-parser gaat.
//
// WAT DE PREVIEW NIET IS
// Geen simulator. Discord rendert net iets anders (regelhoogtes, hoe een
// mention eruitziet, hoe een afbeelding wordt geschaald). Het doel is dat je
// ziet WAT er staat en in welke volgorde - niet dat de pixels kloppen. Waar de
// preview gokt, staat het erbij.
import { el } from "../security/ui.js";
import { magTonen } from "./welcome_checks.js";

// De placeholderwaarden in de preview. VERZONNEN EN HERKENBAAR VERZONNEN: een
// preview die "Tommy" zegt terwijl er straks iemand anders binnenkomt, leest als
// een belofte. Daarom een naam die duidelijk een voorbeeld is.
export const VOORBEELD = {
  user: "@NewMember",
  username: "newmember",
  displayname: "New Member",
  userid: "807581356334120980",
  server: "Your Server",
  membercount: "142",
  memberordinal: "142nd",
  joindate: "26 September 2026",
  accountage: "142 days",
};

// Eén ronde vervangen, net als aan de botkant: een waarde die zelf een
// placeholder bevat wordt niet opnieuw ontleed.
export function vulIn(tekst, waarden) {
  return String(tekst || "").replace(
    /\{([a-z_][a-z0-9_]*)\}/g,
    (heel, naam) => (naam in waarden ? String(waarden[naam]) : heel));
}

// --- leidende blokopmaak eraf, zoals de server dat ook doet -----------------
//
// WAAROM DIT HIER OOK STAAT EN NIET ALLEEN AAN DE SERVERKANT
// Gezien op de preview van 26 september: iemand typt `## Welcome` en de preview
// toonde `## Welcome` met de hekjes erbij. De server HAALT DIE WEG bij het
// opslaan (welcome_layout._ontdoe_van_leidende_opmaak), dus wat er in Discord
// komt te staan is `Welcome`. De preview loog dus precies over het ding waar
// hij voor bestaat.
//
// Dit is een KOPIE van een serverregel, en dat is hier te verdedigen: de server
// blijft de autoriteit (hij schrijft het resultaat terug na het opslaan, en het
// scherm neemt dat over), en deze regel bestaat alleen zodat de preview niet
// iets anders laat zien dan wat er straks staat. Loopt hij ooit uit de pas, dan
// corrigeert de eerstvolgende save het beeld.
const LEIDENDE_OPMAAK = ["###", "##", "#", ">>>", ">", "-#"];

export function ontdoeVanLeidendeOpmaak(regel) {
  let vorig = null;
  let uit = String(regel || "");
  while (vorig !== uit) {
    vorig = uit;
    let kaal = uit.replace(/^\s+/, "");
    for (const teken of LEIDENDE_OPMAAK) {
      if (kaal.startsWith(teken)) { kaal = kaal.slice(teken.length).replace(/^\s+/, ""); break; }
    }
    uit = kaal;
  }
  return uit;
}

// --- markdown, door te knippen en niet door te plakken ----------------------
//
// Zes vormen, en meer met opzet niet: dit is een preview en geen tweede
// markdown-implementatie. Wat hier niet in staat wordt als platte tekst
// getoond, en dat is het eerlijke antwoord - beter dan een preview die iets
// toont wat Discord anders doet.
const INLINE = [
  { re: /\*\*([^*]+)\*\*/, tag: "strong" },
  { re: /__([^_]+)__/, tag: "u" },
  { re: /\*([^*]+)\*/, tag: "em" },
  { re: /_([^_]+)_/, tag: "em" },
  { re: /~~([^~]+)~~/, tag: "s" },
  { re: /`([^`]+)`/, tag: "code" },
];

function inlineStukken(tekst) {
  // Zoek de vroegste match van welke vorm dan ook, knip daar, en ga verder met
  // de rest. Recursief op de INHOUD zodat `**vet met *cursief***` werkt.
  let vroegste = null;
  for (const vorm of INLINE) {
    const m = vorm.re.exec(tekst);
    if (m && (vroegste === null || m.index < vroegste.m.index)) vroegste = { m, vorm };
  }
  if (!vroegste) return [document.createTextNode(tekst)];

  const { m, vorm } = vroegste;
  const uit = [];
  if (m.index > 0) uit.push(document.createTextNode(tekst.slice(0, m.index)));
  // `el(tag, {}, kinderen)` - de inhoud gaat als TEKSTKNOOP naar binnen, nooit
  // als string in innerHTML.
  uit.push(el(vorm.tag, {}, inlineStukken(m[1])));
  uit.push(...inlineStukken(tekst.slice(m.index + m[0].length)));
  return uit;
}

// Een mention (`<@123>`) wordt een pil, zoals Discord hem toont. Het GETAL komt
// uit de tekst, dus dat wordt gecontroleerd voor het wordt gebruikt.
function mentionStukken(tekst) {
  const uit = [];
  let rest = String(tekst || "");
  const MENTION = /<@!?(\d{1,25})>/;
  for (;;) {
    const m = MENTION.exec(rest);
    if (!m) break;
    if (m.index > 0) uit.push(...inlineStukken(rest.slice(0, m.index)));
    uit.push(el("span", { class: "dc-mention", text: VOORBEELD.user }));
    rest = rest.slice(m.index + m[0].length);
  }
  uit.push(...inlineStukken(rest));
  return uit;
}

function tekstNaarKnopen(tekst) {
  // Regels apart, want een `<br>` is layout en geen inhoud.
  const uit = [];
  const regels = String(tekst || "").split("\n");
  regels.forEach((regel, i) => {
    if (i) uit.push(el("br"));
    uit.push(...mentionStukken(ontdoeVanLeidendeOpmaak(regel)));
  });
  return uit;
}

// --- de blokken --------------------------------------------------------------
function blokNaarElement(blok, waarden, opties = {}) {
  const hosts = opties.hosts || [];
  const soort = blok && blok.type;

  if (soort === "text") {
    return el("div", { class: "dc-text" }, tekstNaarKnopen(vulIn(blok.content, waarden)));
  }

  if (soort === "separator") {
    return el("div", {
      class: "dc-sep" + (blok.spacing === "large" ? " large" : "")
             + (blok.divider === false ? " invisible" : ""),
    });
  }

  if (soort === "section") {
    const kinderen = [
      el("div", { class: "dc-section-text" },
         tekstNaarKnopen(vulIn(blok.content, waarden))),
    ];
    if (blok.accessory && blok.accessory.url) {
      kinderen.push(magTonen(blok.accessory.url, hosts)
        ? el("img", { class: "dc-thumb", src: blok.accessory.url, alt: "", loading: "lazy" })
        : el("div", { class: "dc-thumb dc-geweigerd", text: "Not shown" }));
    }
    return el("div", { class: "dc-section" }, kinderen);
  }

  if (soort === "image") {
    // EEN LINK DIE DE SERVER ZOU WEIGEREN WORDT NIET OPGEHAALD. Anders is de
    // preview het baken waar de allowlist juist tegen bestaat (welcome_checks.js).
    if (!magTonen(blok.url, hosts)) {
      return el("div", { class: "dc-media dc-geweigerd", text: blok.url
        ? "This image is not shown: the link is not from an allowed address."
        : "No image picked yet." });
    }
    return el("div", { class: "dc-media" }, [
      el("img", { src: blok.url, alt: "", loading: "lazy" }),
    ]);
  }

  if (soort === "buttons") {
    return el("div", { class: "dc-buttons" },
      (blok.items || []).map((knop) => {
        // EEN KNOP NAAR EEN VERDWENEN KANAAL gaat niet mee (de bot laat hem
        // weg). De preview toont dat, in plaats van een knop te beloven die
        // er straks niet staat.
        const kanaalWeg = knop.kind === "channel" && opties.kanalenBekend
          && !(opties.kanalen || []).some((k) => String(k.id) === String(knop.channel_id));
        if (kanaalWeg) {
          return el("span", { class: "dc-btn dc-btn-weg" }, [
            el("s", { text: knop.label || "Button" }),
            el("span", { text: " channel deleted, not sent" }),
          ]);
        }
        // Een kanaalknop IS een linkknop bij Discord (naar discord.com/channels/…),
        // dus hij krijgt hetzelfde pijltje. Een CONSTANTE, dus `text:` met een
        // vast teken - geen icoon uit de data.
        return el("span", { class: "dc-btn" }, [
          el("span", { text: vulIn(knop.label, waarden) }),
          el("span", { class: "dc-btn-ext", text: "↗" }),
        ]);
      }));
  }

  return null;
}

/**
 * Teken het document als een Discord-bericht.
 *
 * @param {object} document  het layout-document ({v, accent, blocks})
 * @param {object} opties    { botnaam, waarden }
 * @returns {HTMLElement}
 */
export function tekenPreview(doc, opties = {}) {
  const waarden = opties.waarden || VOORBEELD;
  const blokken = (doc && doc.blocks) || [];

  const kaart = el("div", { class: "dc-container" });
  // De accentkleur als CSS-variabele op het element zelf. Een getal uit het
  // document, dus eerst klemmen: `setAttribute` met rommel erin zou een
  // ongeldige stijl opleveren, en in het ergste geval meer dan dat.
  const accent = Number.isInteger(doc && doc.accent)
    ? Math.max(0, Math.min(0xFFFFFF, doc.accent)) : 0x5865F2;
  kaart.style.setProperty("--dc-accent", "#" + accent.toString(16).padStart(6, "0"));

  if (!blokken.length) {
    kaart.appendChild(el("div", { class: "dc-empty", text:
      "Nothing here yet. Add a block on the left and it appears here." }));
  } else {
    for (const blok of blokken) {
      const node = blokNaarElement(blok, waarden, opties);
      if (node) kaart.appendChild(node);
    }
  }

  return el("div", { class: "dc-msg" }, [
    el("div", { class: "dc-avatar", text: "B" }),
    el("div", { class: "dc-body" }, [
      el("div", { class: "dc-who" }, [
        el("span", { class: "dc-name", text: opties.botnaam || "Bucky" }),
        el("span", { class: "dc-tag", text: "APP" }),
        el("span", { class: "dc-when", text: "Today at 14:02" }),
      ]),
      kaart,
    ]),
  ]);
}

/**
 * Wat dit document bij Discord weegt. Dezelfde som als
 * `welcome_layout.gewicht_van_blok` aan de backendkant - hier zodat de teller
 * onder de bouwer meeloopt terwijl je typt, niet om iets af te dwingen. De klem
 * staat op de server; dit is alleen zodat je het ziet aankomen.
 */
export function gewicht(doc) {
  // ZONDER DE CONTAINER, precies zoals `welcome_layout.gewicht_van_document`
  // telt. De container en de marge zitten al verwerkt in het maximum (38 van
  // Discords 40), en ze hier NOG een keer meetellen gaf een teller die "9 / 39"
  // zei terwijl de serverfout het over 38 had. Twee getallen voor hetzelfde is
  // erger dan geen teller.
  let som = 0;
  for (const blok of (doc && doc.blocks) || []) {
    if (blok.type === "section") som += blok.accessory ? 3 : 2;
    else if (blok.type === "image") som += 2;
    else if (blok.type === "buttons") som += 1 + ((blok.items || []).length);
    else som += 1;
  }
  return som;
}

/** Het aantal zichtbare tekens, over alle blokken samen geteld. */
export function tekens(doc, waarden) {
  let som = 0;
  for (const blok of (doc && doc.blocks) || []) {
    if (blok.type === "text" || blok.type === "section") {
      som += vulIn(blok.content || "", waarden || VOORBEELD).length;
    }
  }
  return som;
}
