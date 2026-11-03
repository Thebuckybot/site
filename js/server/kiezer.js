// De kiezer voor rollen en kanalen (3-11-2026), gedeeld door Autorole en Verify.
//
// GEBOUWD VOOR HONDERDEN ROLLEN. Een server met 250 rollen gaf een raster van
// 250 vinkjes waarin je je keuze kwijtraakte. Nu: wat gekozen is staat als chips
// bovenaan, een zoekveld filtert, de lijst heeft een vaste hoogte en scrolt, en
// standaard staan er alleen rollen die de bot echt kan geven. De rest zit in een
// ingeklapte groep "Not available", per rol met de reden van de backend.
//
// DEZE KIEZER BESLIST NIETS. Of een rol mag, zegt de backend (`allowed` en
// `reason` uit role_safety.py) bij het laden en opnieuw bij het opslaan; de bot
// toetst bij elke klik. Wat hier grijs staat, is alleen een voorproefje.
//
// Geen innerHTML: namen van rollen en kanalen zijn tekst van de server.
import { el, clear, toast } from "../security/ui.js";

let teller = 0;

function kleurVan(item) {
  if (item.color) return "#" + Number(item.color).toString(16).padStart(6, "0");
  return "var(--sec-muted, #8b8b9a)";
}

// items: [{id, name, color?, allowed?, reason?}], `allowed` ontbreekt = te kiezen.
// enkel: precies een keuze (keuzerondjes) in plaats van vinkjes.
// teken(item): de zichtbare naam, bv. "@Member" of "#general".
// magKiezen: false = niets toe te voegen (de backend weigert het ook).
// magWeghalen: een gekozen item mag eraf, ook zonder kiesrecht (een kanaal
// uit de lijst halen mag zonder Kanalen beheren; zie server_tools._valideer).
export function kiezer({ items, gekozen = [], max = 1, label, enkel = false,
                         teken = (i) => i.name, zoekLabel = "Search",
                         magKiezen = true, magWeghalen = magKiezen, leeg = "Nothing picked yet." }) {
  const id = `kiezer-${++teller}`;
  const kies = new Set((gekozen || []).filter(Boolean).map(String));
  const perId = new Map(items.map((i) => [String(i.id), i]));
  const kan = (i) => i.allowed !== false;
  const vrij = items.filter(kan);
  const dicht = items.filter((i) => !kan(i));

  const chips = el("div", { class: "srv-chips", "aria-live": "polite" });
  const telling = el("span", { class: "srv-field-hint" });
  const zoek = el("input", { class: "sec-input srv-picker-search", type: "search",
                             placeholder: zoekLabel, "aria-label": `${zoekLabel} (${label})` });
  const geenTreffer = el("p", { class: "srv-field-hint srv-picker-none", text: "No matches.", hidden: "hidden" });

  const invoer = new Map();       // id -> <input>
  const rijen = [];               // [{item, node}]

  function rij(item, beschikbaar) {
    const input = el("input", {
      type: enkel ? "radio" : "checkbox", name: enkel ? id : null, value: String(item.id),
      checked: kies.has(String(item.id)) ? "checked" : null,
    });
    input.addEventListener("change", () => zet(String(item.id), input.checked));
    invoer.set(String(item.id), input);
    const node = el("label", { class: "srv-role" + (beschikbaar ? "" : " is-blocked") }, [
      input,
      el("span", { class: "srv-role-dot", style: `background:${kleurVan(item)}`, "aria-hidden": "true" }),
      el("span", { class: "srv-role-name", text: teken(item) }),
      beschikbaar ? null : el("span", { class: "srv-role-why", text: item.reason || "Not available" }),
    ].filter(Boolean));
    rijen.push({ item, node, beschikbaar });
    return node;
  }

  const lijst = el("div", { class: "srv-rolelist srv-picker-list", role: "group", "aria-label": label },
    vrij.map((i) => rij(i, true)));
  const dichtTitel = el("summary", {});
  const dichtLijst = el("div", { class: "srv-rolelist srv-picker-list srv-picker-blocked-list",
                                 role: "group", "aria-label": `${label}: not available` },
    dicht.map((i) => rij(i, false)));
  const dichtGroep = dicht.length
    ? el("details", { class: "srv-picker-blocked" }, [dichtTitel, dichtLijst]) : null;

  function zet(sleutel, aan) {
    if (aan) {
      if (enkel) kies.clear();
      else if (kies.size >= max) {
        const input = invoer.get(sleutel);
        if (input) input.checked = false;
        toast(`At most ${max}.`, "err");
        return;
      }
      kies.add(sleutel);
    } else {
      kies.delete(sleutel);
    }
    ververs();
  }

  function ververs() {
    // Chips: in de volgorde van de lijst, zodat ze niet springen.
    clear(chips);
    const gekozenItems = Array.from(kies).map((k) => perId.get(k) || { id: k, name: "deleted", allowed: false,
                                                                     reason: "no longer exists" });
    if (!gekozenItems.length) chips.appendChild(el("span", { class: "srv-field-hint", text: leeg }));
    for (const item of gekozenItems) {
      const goed = kan(item);
      chips.appendChild(el("span", { class: "srv-chip" + (goed ? "" : " is-blocked"),
                                     title: goed ? null : (item.reason || "Not available") }, [
        el("span", { class: "srv-role-dot", style: `background:${kleurVan(item)}`, "aria-hidden": "true" }),
        el("span", { text: teken(item) }),
        magWeghalen ? el("button", {
          class: "srv-chip-x", type: "button", "aria-label": `Remove ${teken(item)}`, text: "×",
          onclick: () => { const i = invoer.get(String(item.id)); if (i) i.checked = false; zet(String(item.id), false); },
        }) : null,
      ].filter(Boolean)));
    }
    telling.textContent = enkel ? "" : `${kies.size} of ${max} picked`;
    // Vinkjes: een geblokkeerde rol is nooit aan te zetten; een gekozen item
    // mag eraf als dat mag.
    for (const { item, beschikbaar } of rijen) {
      const input = invoer.get(String(item.id));
      const aan = kies.has(String(item.id));
      input.checked = aan;
      const toevoegen = magKiezen && beschikbaar;
      input.disabled = !(aan ? (magWeghalen || toevoegen) : toevoegen);
    }
  }

  function filter() {
    const q = zoek.value.trim().toLowerCase();
    let zichtbaarVrij = 0, zichtbaarDicht = 0;
    for (const { item, node, beschikbaar } of rijen) {
      const past = !q || teken(item).toLowerCase().includes(q);
      node.hidden = !past;
      if (past && beschikbaar) zichtbaarVrij += 1;
      if (past && !beschikbaar) zichtbaarDicht += 1;
    }
    geenTreffer.hidden = zichtbaarVrij > 0;
    geenTreffer.textContent = q ? "No matches." : "Nothing here can be picked.";
    dichtTitel.textContent = `Not available (${zichtbaarDicht})`;
    if (dichtGroep) dichtGroep.hidden = zichtbaarDicht === 0 && !!q;
  }
  zoek.addEventListener("input", filter);

  ververs();
  filter();
  const node = el("div", { class: "srv-picker" }, [
    chips,
    el("div", { class: "srv-picker-bar" }, [zoek, telling]),
    lijst,
    geenTreffer,
    dichtGroep,
  ].filter(Boolean));
  return {
    node,
    waarde: () => (enkel ? (Array.from(kies)[0] || null) : Array.from(kies)),
  };
}
