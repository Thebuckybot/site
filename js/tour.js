// tour.js - de onboarding-tour: een rondleiding die het werk doet, en op één
// plek de bezoeker zelf iets laat doen (een SOC-regel maken en weer weghalen).
//
// VORM (ontwerpronde 6 september 2026, zie docs/TOUR_ONTWERP_2026-09-06.md):
// alles behalve het onderdeel wordt gedempt door één uitsnede (de "spot") met een
// crimson ring; de kaart staat ernaast en glijdt bij Next naar zijn nieuwe plek;
// boven de titel staan hoofdstuk en voortgang ("3 of 9" plus een dunne balk); in de
// kop een sluitkruisje; een doe-stap draagt de chip "Your turn" en heeft geen Next.
// De tour begint en eindigt met een kaart in het midden (selector "@center"): een
// uitnodiging met Start tour / Not now, en een slot. Een knop [data-tour-start] op
// de pagina start hem opnieuw, ook als de sessie hem al kent.
//
// DE STAPPEN KOMEN VAN /api/site/tour, en dat is de hele reden dat dit bestand
// geen tekst kent. De teksten staan in de bot-boom (site_tour.json), waar
// +ownerconfig bij kan; een woord wijzigen is geen deploy.
//
// EEN STAP HEEFT: selector, title, text, en optioneel
//   placement   - below | above | left | right (voorkeur; past het niet, dan een andere);
//   chapter     - het hoofdstuk boven de titel;
//   route       - een hash (#settings): de tour navigeert daarheen vóór hij wijst;
//   reveal      - een selector die wordt aangeklikt als het onderdeel onzichtbaar is
//                 (de lade op een telefoon), en weer om het te verbergen;
//   optional    - het onderdeel is er niet altijd: kort wachten, anders overslaan;
//   id / next   - een naam, en het id van de stap na deze;
//   requires    - een selector die op de HUIDIGE pagina moet bestaan, anders wordt de
//                 stap meteen overgeslagen (SOC niet aanwezig, geen rechten, limiet vol);
//   emit        - {event, detail}: een DOM-event dat de tour afvuurt bij het tonen;
//   done_when   - {event, as, undo} wacht op een DOM-event en bewaart e.detail.id als
//                 artefact; {gone, release} wacht tot een selector verdwijnt;
//   choice      - [{label, goto, release}]: knoppen in plaats van Next;
//   next_label / skip_label - knopteksten (Start tour / Not now / Finish).
// In selectors mag `{naam}` staan: het id van een artefact.
//
// GEEN HALVE STAAT. Sluiten: de lade dicht die de tour opende, terug naar het tabblad
// waar hij begon, en een artefact dat niet is "gehouden" wordt via zijn undo-pad
// verwijderd (`soc:/rules/{rule}`). Een open dialoog van de pagina krijgt Escape
// eerst en laat de kaart wijken.
//
// TOEGANKELIJK: role="dialog" met titel en beschrijving, focus naar de titel bij elke
// stap en terug aan het eind, Tab blijft in de kaart behalve bij een doe-stap, Esc
// sluit, pijlen bladeren, prefers-reduced-motion zet alle beweging uit, en niets
// betekent iets alleen door zijn kleur.

import { API_URL } from "./config.js";
import { api, soc } from "./security/api.js";

const PAGE = document.body ? document.body.dataset.tour : null;
const KEY = `bucky_tour_seen_${PAGE}`;
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMobile = () => window.matchMedia("(max-width: 640px)").matches;
const WAIT_LOAD_MS = 8000;
const WAIT_OPTIONAL_MS = 600;
const WAIT_REVEAL_MS = 2500;
const CENTER = "@center";
const SPOT_PAD = 8;

function seen() {
  try { return sessionStorage.getItem(KEY) === "1"; } catch (_) { return false; }
}
function markSeen() {
  try { sessionStorage.setItem(KEY, "1"); } catch (_) { /* privé venster: dan komt hij vaker, dat is de veilige kant */ }
}

async function loadSteps() {
  try {
    const res = await fetch(`${API_URL}/api/site/tour`, { credentials: "omit" });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || data.enabled !== true) return [];
    const steps = (data.pages || {})[PAGE];
    return Array.isArray(steps) ? steps.filter((s) => s && s.selector && s.title && s.text) : [];
  } catch (_) {
    return [];
  }
}

function visible(elm) {
  if (!elm) return false;
  const r = elm.getBoundingClientRect();
  if (r.width <= 0 && r.height <= 0) return false;
  const cs = getComputedStyle(elm);
  if (cs.visibility === "hidden" || cs.opacity === "0") return false;
  const vw = document.documentElement.clientWidth;
  return r.right > 0 && r.left < vw;
}

function find(selector) {
  let all;
  try { all = document.querySelectorAll(selector); } catch (_) { return undefined; }
  for (const elm of all) if (visible(elm)) return elm;
  return null;
}

function exists(selector) {
  try { return !!document.querySelector(selector); } catch (_) { return false; }
}

function waitFor(selector, ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const elm = find(selector);
      if (elm === undefined) return resolve(null);
      if (elm) return resolve(elm);
      if (Date.now() - t0 > ms) return resolve(null);
      setTimeout(tick, 150);
    };
    tick();
  });
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

const PLACEHOLDER = /\{(\w+)\}/g;

class Tour {
  constructor(steps) {
    this.steps = steps;
    this.i = -1;
    this.target = null;
    this.previousFocus = document.activeElement;
    this.startHash = window.location.hash;
    this.navigated = false;
    this.revealed = null;
    this.artifacts = {};
    this.history = [];
    this.shown = new Set();
    this.pending = null;
    this.busy = false;
    this.settle = null;
    this.interacted = false;

    // de uitsnede: één element waarvan de schaduw de rest van de pagina dempt
    this.spot = el("div", "tour-spot");
    this.spot.id = "bucky-tour-spot";
    this.spot.setAttribute("aria-hidden", "true");

    // de kaart
    this.card = el("div", "tour-card");
    this.card.id = "bucky-tour";
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-live", "polite");
    const head = el("div", "tour-head");
    this.chapter = el("span", "tour-chapter");
    this.count = el("span", "tour-count");
    this.close = el("button", "tour-close");
    this.close.type = "button";
    this.close.setAttribute("aria-label", "Close tour");
    this.close.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    head.append(this.chapter, this.count, this.close);
    this.progress = el("div", "tour-progress");
    this.progress.setAttribute("aria-hidden", "true");
    this.bar = el("i");
    this.progress.appendChild(this.bar);
    this.body = el("div", "tour-body");
    this.turn = el("span", "tour-turn", "Your turn");
    this.title = el("h2", "tour-title");
    this.title.id = "bucky-tour-title";
    this.title.tabIndex = -1;
    this.text = el("p", "tour-text");
    this.text.id = "bucky-tour-text";
    this.body.append(this.turn, this.title, this.text);
    this.card.setAttribute("aria-labelledby", this.title.id);
    this.card.setAttribute("aria-describedby", this.text.id);
    this.back = el("button", "tour-btn tour-back", "Back");
    this.next = el("button", "tour-btn tour-btn-primary tour-next", "Next");
    this.skip = el("button", "tour-btn tour-skip", "Not now");
    this.choices = el("div", "tour-choices");
    this.back.type = this.next.type = this.skip.type = "button";
    const actions = el("div", "tour-actions");
    actions.append(this.back, this.choices, this.skip, this.next);
    this.card.append(head, this.progress, this.body, actions);

    this.close.addEventListener("click", () => this.stop());
    this.skip.addEventListener("click", () => this.stop());
    this.back.addEventListener("click", () => this.goBack());
    this.next.addEventListener("click", () => this.show(this.nextIndex(this.i), +1));
    this.onKey = (e) => this.key(e);
    this.onLayout = () => this.place();
    this.onInteract = () => { this.interacted = true; };
  }

  async start() {
    document.body.append(this.spot, this.card);
    document.body.classList.add("tour-active");
    document.addEventListener("keydown", this.onKey, true);
    document.addEventListener("pointerdown", this.onInteract, true);
    document.addEventListener("keydown", this.onInteract, true);
    window.addEventListener("resize", this.onLayout);
    window.addEventListener("scroll", this.onLayout, { passive: true });
    this.observer = new MutationObserver(() => this.yieldToModal());
    this.observer.observe(document.body, { childList: true, subtree: true });
    await this.show(0, +1);
  }

  yieldToModal() {
    if (!this.card.isConnected) return;
    const open = !!document.querySelector('[aria-modal="true"]');
    this.card.classList.toggle("tour-yield", open);
    this.spot.classList.toggle("tour-yield", open);
  }

  // -- artefacten, sprongen, telling -------------------------------------------
  fill(text) {
    return String(text).replace(PLACEHOLDER, (m, naam) => (this.artifacts[naam] ? this.artifacts[naam].id : m));
  }

  refersToMissing(text) {
    if (!text) return false;
    let missing = false;
    String(text).replace(PLACEHOLDER, (m, naam) => { if (!this.artifacts[naam]) missing = true; return m; });
    return missing;
  }

  indexOf(id) {
    const at = this.steps.findIndex((s) => s.id === id);
    return at >= 0 ? at : this.steps.length;
  }

  nextIndex(i) {
    const s = this.steps[i];
    return s && s.next ? this.indexOf(s.next) : i + 1;
  }

  isTask(s) {
    return !!(s && (s.done_when || s.choice || s.emit));
  }

  isCenter(s) {
    return !!s && s.selector === CENTER;
  }

  // "3 of 7": de welkom- en slotkaart tellen niet mee, en een VOORWAARDELIJKE stap
  // (met `requires`, of met een artefact in zijn selector) telt pas mee zodra hij
  // getoond is. Zo belooft de telling geen stappen die deze bezoeker niet krijgt
  // (geen SOC, geen rechten) en groeit de balk alleen maar.
  conditional(s) {
    return !!s.requires || /\{\w+\}/.test(String(s.selector));
  }

  counted() {
    return this.steps.filter((s) => !this.isCenter(s) && (!this.conditional(s) || this.shown.has(s)));
  }

  position(index) {
    const items = this.counted();
    const at = items.indexOf(this.steps[index]);
    return { at: at + 1, total: items.length };
  }

  goBack() {
    this.history.pop();
    while (this.history.length && this.isTask(this.steps[this.history[this.history.length - 1]])) this.history.pop();
    if (!this.history.length) return;
    const prev = this.history.pop();
    this.show(prev, -1);
  }

  release(naam) {
    if (naam && this.artifacts[naam]) this.artifacts[naam].released = true;
  }

  // -- een stap bereiken -----------------------------------------------------------
  async reach(step) {
    if (this.isCenter(step)) {
      if (this.revealed) this.unreveal();
      return document.body;
    }
    const selector = this.fill(step.selector);
    if (step.route && window.location.hash !== step.route) {
      window.location.hash = step.route;
      this.navigated = true;
    }
    if (this.revealed && !find(selector)) this.unreveal();
    const wait = step.optional ? WAIT_OPTIONAL_MS : WAIT_LOAD_MS;
    let target = await waitFor(selector, step.reveal ? Math.min(wait, WAIT_REVEAL_MS) : wait);
    if (!target && step.reveal) {
      const toggle = find(step.reveal);
      if (toggle) {
        toggle.click();
        target = await waitFor(selector, WAIT_REVEAL_MS);
        if (target) this.revealed = { toggle, target };
        else toggle.click();
      }
    }
    return target;
  }

  unreveal() {
    if (!this.revealed) return;
    const { toggle, target } = this.revealed;
    this.revealed = null;
    if (visible(target) && toggle.isConnected) toggle.click();
  }

  async show(index, direction) {
    if (this.busy) return;
    this.busy = true;
    this.clearPending();
    try {
      while (index >= 0 && index < this.steps.length) {
        const step = this.steps[index];
        const skip = this.refersToMissing(step.selector) || this.refersToMissing(step.requires)
          || (step.requires && !exists(this.fill(step.requires)));
        if (!skip) {
          const target = await this.reach(step);
          if (!this.card.isConnected) return;
          if (target) { this.render(index, target); return; }
        }
        // een overgeslagen stap springt niet: zijn `next` geldt alleen als hij
        // getoond is en de bezoeker op Next drukt
        index = direction < 0 ? index - 1 : index + 1;
      }
      if (index >= this.steps.length) this.stop(true);
    } finally {
      this.busy = false;
    }
  }

  // -- tonen ---------------------------------------------------------------------------
  render(index, target) {
    const s = this.steps[index];
    const center = this.isCenter(s);
    if (this.target) this.target.classList.remove("tour-target");
    this.i = index;
    this.target = center ? null : target;
    if (this.history[this.history.length - 1] !== index) this.history.push(index);
    if (this.target) this.target.classList.add("tour-target");
    this.shown.add(s);

    // kop: hoofdstuk en telling; voortgang
    const pos = this.position(index);
    this.chapter.textContent = s.chapter || "";
    this.chapter.hidden = !s.chapter;
    this.count.textContent = center ? "" : `${pos.at} of ${pos.total}`;
    const done = center ? (index === 0 ? 0 : 1) : pos.at / Math.max(pos.total, 1);
    this.bar.style.width = `${Math.round(done * 100)}%`;
    this.progress.hidden = center && index === 0;

    // inhoud: wisselt met een korte overgang, één ding dat verandert
    const task = this.isTask(s);
    this.body.classList.add("tour-swap");
    this.turn.hidden = !task;
    this.title.textContent = s.title;
    this.text.textContent = this.fill(s.text);
    requestAnimationFrame(() => this.body.classList.remove("tour-swap"));

    // knoppen
    this.back.hidden = this.history.length <= 1 || center;
    this.next.hidden = !!(s.done_when || s.choice);
    const last = this.nextIndex(index) >= this.steps.length;
    this.next.textContent = s.next_label || (last ? "Finish" : "Next");
    this.skip.textContent = s.skip_label || "Not now";
    this.skip.hidden = !s.skip_label;
    this.choices.replaceChildren();
    if (s.choice) {
      for (const c of s.choice) {
        const b = el("button", "tour-btn tour-btn-choice", c.label);
        b.type = "button";
        b.addEventListener("click", () => {
          this.release(c.release);
          this.show(c.goto ? this.indexOf(c.goto) : index + 1, +1);
        });
        this.choices.appendChild(b);
      }
    }
    this.card.classList.toggle("tour-task", task);
    this.card.classList.toggle("tour-center", center);
    this.spot.classList.toggle("tour-spot-center", center);

    // scrollen en plaatsen
    if (!center) {
      const direct = REDUCED || (isMobile() && task);
      try {
        target.scrollIntoView({ block: isMobile() ? "start" : "center", behavior: direct ? "auto" : "smooth" });
      } catch (_) { target.scrollIntoView(); }
    }
    this.adjust = true;
    this.interacted = false;
    clearTimeout(this.settle);
    requestAnimationFrame(() => {
      this.place();
      this.card.classList.add("tour-in");
      this.spot.classList.add("tour-in");
      this.title.focus({ preventScroll: true });
      this.settle = setTimeout(() => {
        if (!this.interacted && this.card.isConnected && !this.card.contains(document.activeElement)) {
          this.title.focus({ preventScroll: true });
        }
      }, 600);
    });
    if (s.emit && s.emit.event) {
      document.dispatchEvent(new CustomEvent(s.emit.event, { detail: s.emit.detail || {} }));
    }
    if (s.done_when) this.arm(index, s.done_when);
  }

  arm(index, done) {
    const advance = () => {
      this.clearPending();
      if (!this.card.isConnected || this.i !== index) return;
      this.show(this.nextIndex(index), +1);
    };
    if (done.event) {
      const handler = (e) => {
        const detail = e && e.detail;
        const id = detail && typeof detail === "object" ? detail.id : detail;
        if (done.as) this.artifacts[done.as] = { id, undo: done.undo || null, released: false };
        advance();
      };
      document.addEventListener(done.event, handler);
      this.pending = () => document.removeEventListener(done.event, handler);
      return;
    }
    if (done.gone) {
      const selector = this.fill(done.gone);
      const timer = setInterval(() => {
        if (!exists(selector)) { this.release(done.release); advance(); }
      }, 300);
      this.pending = () => clearInterval(timer);
    }
  }

  clearPending() {
    if (this.pending) { this.pending(); this.pending = null; }
  }

  // -- plaatsen: de spot om het onderdeel, de kaart ernaast -------------------------------
  place() {
    if (!this.card.isConnected) return;
    const s = this.steps[this.i];
    const b = this.card;
    if (this.isCenter(s) || !this.target) {
      // kaart in het midden, spot zonder maat: alles gedempt
      b.style.left = b.style.top = "";
      this.spot.style.left = `${Math.round(window.innerWidth / 2)}px`;
      this.spot.style.top = `${Math.round(window.innerHeight / 2)}px`;
      this.spot.style.width = this.spot.style.height = "0px";
      b.classList.remove("tour-sheet", "tour-sheet-top");
      return;
    }
    const r = this.target.getBoundingClientRect();
    // de spot volgt het onderdeel (fixed, dus in schermcoördinaten)
    this.spot.style.left = `${Math.round(r.left - SPOT_PAD)}px`;
    this.spot.style.top = `${Math.round(r.top - SPOT_PAD)}px`;
    this.spot.style.width = `${Math.round(r.width + SPOT_PAD * 2)}px`;
    this.spot.style.height = `${Math.round(r.height + SPOT_PAD * 2)}px`;

    if (isMobile()) {
      b.style.left = b.style.top = "";
      const midden = window.innerHeight / 2;
      const onderdeelOnder = (r.top + r.height / 2) > midden;
      const boven = this.isTask(s) || onderdeelOnder;
      b.classList.add("tour-sheet");
      b.classList.toggle("tour-sheet-top", boven);
      if (this.adjust) {
        this.adjust = false;
        const sheet = b.getBoundingClientRect();
        const marge = 8;
        if (boven && r.top < sheet.bottom + marge) window.scrollBy(0, r.top - (sheet.bottom + marge));
        else if (!boven && r.bottom > sheet.top - marge) window.scrollBy(0, r.bottom - (sheet.top - marge));
      }
      return;
    }
    b.classList.remove("tour-sheet", "tour-sheet-top");
    const pref = (s.placement || "below").toLowerCase();
    const gap = 14;
    const bw = b.offsetWidth, bh = b.offsetHeight;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const fits = {
      below: r.bottom + gap + bh <= vh,
      above: r.top - gap - bh >= 0,
      right: r.right + gap + bw <= vw,
      left: r.left - gap - bw >= 0,
    };
    const order = [pref, "below", "above", "right", "left"];
    const placement = order.find((p) => fits[p]) || "below";
    let top, left;
    if (placement === "below") { top = r.bottom + gap; left = r.left; }
    else if (placement === "above") { top = r.top - gap - bh; left = r.left; }
    else if (placement === "right") { top = r.top; left = r.right + gap; }
    else { top = r.top; left = r.left - gap - bw; }
    left = Math.max(8, Math.min(left, vw - bw - 8));
    top = Math.max(8, Math.min(top, vh - bh - 8));
    b.dataset.placement = placement;
    b.style.left = `${Math.round(left + window.scrollX)}px`;
    b.style.top = `${Math.round(top + window.scrollY)}px`;
  }

  key(e) {
    if (!this.card.isConnected) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.stop(); return; }
    const s = this.steps[this.i];
    const waiting = !!(s && (s.done_when || s.choice));
    if (!waiting && (e.key === "ArrowRight" || (e.key === "Enter" && !e.target.closest("button, a, input, select, textarea")))) {
      e.preventDefault(); this.show(this.nextIndex(this.i), +1); return;
    }
    if (e.key === "ArrowLeft" && !e.target.closest("input, select, textarea")) { e.preventDefault(); this.goBack(); return; }
    if (e.key === "Tab") {
      const focusables = [...this.card.querySelectorAll("button:not([hidden])")];
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (!this.card.contains(document.activeElement)) { if (waiting) return; e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { if (waiting) return; e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { if (waiting) return; e.preventDefault(); first.focus(); }
    }
  }

  async undo() {
    for (const [naam, a] of Object.entries(this.artifacts)) {
      if (a.released || !a.undo || a.id == null) continue;
      const path = this.fill(a.undo);
      try {
        if (path.startsWith("soc:")) await soc.del(path.slice(4));
        else if (path.startsWith("api:")) await api.del(path.slice(4));
      } catch (_) { /* de pagina toont het zelf */ }
      a.released = true;
      document.dispatchEvent(new CustomEvent("bucky:tour-undone", { detail: { name: naam, id: a.id } }));
    }
  }

  stop(finished = false) {
    markSeen();
    clearTimeout(this.settle);
    this.clearPending();
    if (this.observer) this.observer.disconnect();
    document.removeEventListener("keydown", this.onKey, true);
    document.removeEventListener("pointerdown", this.onInteract, true);
    document.removeEventListener("keydown", this.onInteract, true);
    window.removeEventListener("resize", this.onLayout);
    window.removeEventListener("scroll", this.onLayout);
    if (this.target) this.target.classList.remove("tour-target");
    this.card.remove();
    this.spot.remove();
    document.body.classList.remove("tour-active");
    this.unreveal();
    const cleanup = this.undo();
    if (this.navigated && window.location.hash !== this.startHash) {
      window.location.hash = this.startHash || "";
    }
    document.body.dataset.tourState = finished ? "done" : "skipped";
    const back = this.previousFocus;
    if (back && typeof back.focus === "function" && back.isConnected) {
      try { back.focus({ preventScroll: true }); } catch (_) { /* niets */ }
    }
    return cleanup;
  }
}

let lopend = null;

async function begin(force) {
  if (!PAGE) return false;
  if (lopend && lopend.card.isConnected) return true;
  if (!force && seen()) return false;
  const steps = await loadSteps();
  if (!steps.length) return false;
  lopend = new Tour(steps);
  window.buckyTour = lopend;
  await lopend.start();
  return true;
}

// De knop "Tour" op de pagina: opnieuw beginnen, ook als de sessie hem al kent
// (NN/g: hulp moet makkelijk weg én makkelijk terug te halen zijn).
document.addEventListener("click", (e) => {
  const knop = e.target.closest("[data-tour-start]");
  if (!knop) return;
  e.preventDefault();
  try { sessionStorage.removeItem(KEY); } catch (_) { /* niets */ }
  begin(true);
});

begin(false);

export async function restartTour() {
  try { sessionStorage.removeItem(KEY); } catch (_) { /* niets */ }
  return begin(true);
}
