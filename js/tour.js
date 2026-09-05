// tour.js - de onboarding-tour: een rondleiding die het werk doet, en op één
// plek de bezoeker zelf iets laat doen (een SOC-regel maken en weer weghalen).
//
// DE STAPPEN KOMEN VAN /api/site/tour, en dat is de hele reden dat dit bestand
// geen tekst kent. De teksten staan in de bot-boom (site_tour.json), waar
// +ownerconfig bij kan; de backend serveert ze binnen een minuut. Een woord
// wijzigen is dus geen deploy. Welke pagina dit is staat op <body data-tour>.
//
// EEN STAP HEEFT: selector, title, text, placement, en optioneel
//   route     - een hash (#settings): de tour navigeert daarheen vóór hij wijst;
//   reveal    - een selector (#sec-burger): als het onderdeel onzichtbaar is, wordt
//               dit aangeklikt om het te tonen (de lade op een telefoon), en bij
//               een volgende stap of het sluiten weer om het te verbergen;
//   optional  - het onderdeel is er niet altijd: kort wachten en anders overslaan;
//   id        - een naam waar `next` en `choice.goto` naar kunnen springen;
//   requires  - een selector die op de HUIDIGE pagina moet bestaan, anders wordt de
//               stap meteen overgeslagen (SOC niet aanwezig, geen rechten, limiet
//               vol) - gecontroleerd vóór de stap, niet erin;
//   next      - het id van de stap na deze (om een blok over te slaan);
//   emit      - {event, detail}: een DOM-event dat de tour afvuurt zodra het
//               onderdeel er staat (de Rule Builder vult daarmee het formulier);
//   done_when - de stap is pas klaar als de bezoeker iets deed: {event, as, undo}
//               wacht op een DOM-event en bewaart e.detail.id als artefact `as`
//               (met een undo-pad, zie onder); {gone, release} wacht tot een
//               selector uit de pagina verdwijnt en geeft het artefact vrij;
//   choice    - [{label, goto, release}]: knoppen in plaats van Next.
// In selectors mag `{naam}` staan: het id van een artefact. Een stap die naar een
// artefact verwijst dat er niet is, wordt overgeslagen.
//
// GEEN HALVE STAAT, OOK NIET MET EEN ARTEFACT. Sluit de bezoeker de tour terwijl
// een gemaakte regel nog niet is "gehouden" of verwijderd, dan voert de tour het
// undo-pad uit (`soc:/rules/{rule}` = DELETE via de SOC-API). Een open bevestiging
// van de pagina krijgt Escape eerst; de tour pas bij de tweede.
//
// TERUG IS OOK TERUG: Back volgt de geschiedenis van getoonde stappen en slaat
// doe-stappen over (die kun je niet nog eens doen). Escape en Done sluiten de lade
// die de tour opende en keren terug naar het tabblad waar de tour begon.
//
// ALLEEN VOOR DEZE SESSIE ONTHOUDEN (sessionStorage); toetsenbord compleet;
// prefers-reduced-motion zet animatie en zacht scrollen uit; op een telefoon is de
// ballon een balk aan de kant waar het onderdeel niet is.

import { API_URL } from "./config.js";
import { api, soc } from "./security/api.js";

const PAGE = document.body ? document.body.dataset.tour : null;
const KEY = `bucky_tour_seen_${PAGE}`;
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMobile = () => window.matchMedia("(max-width: 640px)").matches;
const WAIT_LOAD_MS = 8000;
const WAIT_OPTIONAL_MS = 600;
const WAIT_REVEAL_MS = 2500;

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
    this.artifacts = {};               // naam -> { id, undo }
    this.history = [];                 // getoonde stappen, voor Back
    this.pending = null;               // opruimer van een lopende done_when
    this.balloon = el("div", "tour-balloon");
    this.balloon.setAttribute("role", "dialog");
    this.balloon.setAttribute("aria-live", "polite");
    this.balloon.id = "bucky-tour";
    this.step = el("p", "tour-step");
    this.title = el("h2", "tour-title");
    this.title.id = "bucky-tour-title";
    this.title.tabIndex = -1;
    this.text = el("p", "tour-text");
    this.text.id = "bucky-tour-text";
    this.balloon.setAttribute("aria-labelledby", this.title.id);
    this.balloon.setAttribute("aria-describedby", this.text.id);
    this.back = el("button", "tour-btn", "Back");
    this.next = el("button", "tour-btn tour-btn-primary", "Next");
    this.skip = el("button", "tour-btn tour-btn-skip", "Skip tour");
    this.back.type = this.next.type = this.skip.type = "button";
    this.choices = el("div", "tour-choices");
    const actions = el("div", "tour-actions");
    actions.append(this.back, this.next, this.choices, this.skip);
    this.balloon.append(this.step, this.title, this.text, actions);
    this.back.addEventListener("click", () => this.goBack());
    this.next.addEventListener("click", () => this.show(this.nextIndex(this.i), +1));
    this.skip.addEventListener("click", () => this.stop());
    this.onKey = (e) => this.key(e);
    this.onLayout = () => this.place();
    this.interacted = false;
    this.onInteract = () => { this.interacted = true; };
    this.settle = null;
    this.busy = false;
  }

  async start() {
    document.body.appendChild(this.balloon);
    document.addEventListener("keydown", this.onKey, true);
    document.addEventListener("pointerdown", this.onInteract, true);
    document.addEventListener("keydown", this.onInteract, true);
    window.addEventListener("resize", this.onLayout);
    window.addEventListener("scroll", this.onLayout, { passive: true });
    // Een bevestiging van de pagina (aria-modal) krijgt voorrang: de ballon wijkt
    // zolang die open staat, anders ligt hij over de knoppen van de dialoog.
    this.observer = new MutationObserver(() => this.yieldToModal());
    this.observer.observe(document.body, { childList: true, subtree: true });
    await this.show(0, +1);
  }

  yieldToModal() {
    if (!this.balloon.isConnected) return;
    const open = !!document.querySelector('[aria-modal="true"]');
    this.balloon.classList.toggle("tour-yield", open);
  }

  // -- artefacten en sprongen ------------------------------------------------
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

  goBack() {
    // de huidige eraf, dan terug tot een stap die geen doe-stap is
    this.history.pop();
    while (this.history.length && this.isTask(this.steps[this.history[this.history.length - 1]])) this.history.pop();
    if (!this.history.length) return;
    const prev = this.history.pop();
    this.show(prev, -1);
  }

  release(naam) {
    if (naam && this.artifacts[naam]) this.artifacts[naam].released = true;
  }

  // -- een stap bereiken -------------------------------------------------------
  async reach(step) {
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
        // vóór de stap: verwijst hij naar iets dat er niet is, of is niet voldaan
        // aan wat hij vereist, dan wordt hij overgeslagen zonder te wachten
        const skip = this.refersToMissing(step.selector) || this.refersToMissing(step.requires)
          || (step.requires && !exists(this.fill(step.requires)));
        if (!skip) {
          const target = await this.reach(step);
          if (!this.balloon.isConnected) return;
          if (target) { this.render(index, target); return; }
        }
        // een OVERGESLAGEN stap springt niet: zijn `next` geldt alleen als hij
        // getoond is en de bezoeker op Next drukt
        index = direction < 0 ? index - 1 : index + 1;
      }
      if (index >= this.steps.length) this.stop(true);
    } finally {
      this.busy = false;
    }
  }

  render(index, target) {
    if (this.target) this.target.classList.remove("tour-target");
    this.i = index;
    this.target = target;
    if (this.history[this.history.length - 1] !== index) this.history.push(index);
    target.classList.add("tour-target");
    const s = this.steps[index];
    this.step.textContent = `Step ${index + 1} of ${this.steps.length}`;
    this.title.textContent = s.title;
    this.text.textContent = this.fill(s.text);
    this.back.hidden = this.history.length <= 1;
    this.next.hidden = !!(s.done_when || s.choice);
    this.next.textContent = this.nextIndex(index) >= this.steps.length ? "Done" : "Next";
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
    this.balloon.classList.remove("tour-in");
    // op een telefoon bij een doe-stap: meteen scrollen (geen animatie), zodat
    // place() daarna met de echte positie kan meten waar de balk mag staan
    const direct = REDUCED || (isMobile() && this.isTask(s));
    try {
      target.scrollIntoView({ block: isMobile() ? "start" : "center", behavior: direct ? "auto" : "smooth" });
    } catch (_) { target.scrollIntoView(); }
    this.adjust = true;
    this.interacted = false;
    clearTimeout(this.settle);
    requestAnimationFrame(() => {
      this.place();
      this.balloon.classList.add("tour-in");
      this.title.focus({ preventScroll: true });
      this.settle = setTimeout(() => {
        if (!this.interacted && this.balloon.isConnected && !this.balloon.contains(document.activeElement)) {
          this.title.focus({ preventScroll: true });
        }
      }, 600);
    });
    if (s.emit && s.emit.event) {
      document.dispatchEvent(new CustomEvent(s.emit.event, { detail: s.emit.detail || {} }));
    }
    if (s.done_when) this.arm(index, s.done_when);
  }

  // -- wachten tot de bezoeker iets deed --------------------------------------
  arm(index, done) {
    const advance = () => {
      this.clearPending();
      if (!this.balloon.isConnected || this.i !== index) return;
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
        if (!exists(selector)) {
          this.release(done.release);
          advance();
        }
      }, 300);
      this.pending = () => clearInterval(timer);
    }
  }

  clearPending() {
    if (this.pending) { this.pending(); this.pending = null; }
  }

  // -- plaatsen ------------------------------------------------------------------
  place() {
    if (!this.target || !this.balloon.isConnected) return;
    const b = this.balloon;
    const r = this.target.getBoundingClientRect();
    if (isMobile()) {
      b.style.left = b.style.top = "";
      const midden = window.innerHeight / 2;
      const onderdeelOnder = (r.top + r.height / 2) > midden;
      // bij een doe-stap staat de balk BOVEN: het formulier eronder blijft
      // bereikbaar en scrolbaar tot en met de knop die de bezoeker moet drukken
      const boven = this.isTask(this.steps[this.i]) || onderdeelOnder;
      b.classList.add("tour-sheet");
      b.classList.toggle("tour-sheet-top", boven);
      if (this.adjust) {
        // één keer na het tonen: het onderdeel niet onder de balk laten liggen
        this.adjust = false;
        const sheet = b.getBoundingClientRect();
        const marge = 8;
        if (boven && r.top < sheet.bottom + marge) window.scrollBy(0, r.top - (sheet.bottom + marge));
        else if (!boven && r.bottom > sheet.top - marge) window.scrollBy(0, r.bottom - (sheet.top - marge));
      }
      return;
    }
    b.classList.remove("tour-sheet", "tour-sheet-top");
    const pref = (this.steps[this.i].placement || "below").toLowerCase();
    const gap = 12;
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
    top = Math.max(8, top);
    b.style.left = `${Math.round(left + window.scrollX)}px`;
    b.style.top = `${Math.round(top + window.scrollY)}px`;
  }

  key(e) {
    if (!this.balloon.isConnected) return;
    // een open bevestiging van de pagina krijgt de toetsen eerst
    if (document.querySelector('[aria-modal="true"]')) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.stop(); return; }
    const s = this.steps[this.i];
    const waiting = !!(s && (s.done_when || s.choice));
    if (!waiting && (e.key === "ArrowRight" || (e.key === "Enter" && !e.target.closest("button, a, input, select, textarea")))) {
      e.preventDefault(); this.show(this.nextIndex(this.i), +1); return;
    }
    if (e.key === "ArrowLeft" && !e.target.closest("input, select, textarea")) { e.preventDefault(); this.goBack(); return; }
    if (e.key === "Tab") {
      const focusables = [...this.balloon.querySelectorAll("button:not([hidden])")];
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      // bij een doe-stap mag de focus de ballon uit, naar het formulier
      if (!this.balloon.contains(document.activeElement)) { if (waiting) return; e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { if (waiting) return; e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { if (waiting) return; e.preventDefault(); first.focus(); }
    }
  }

  // -- opruimen van wat de bezoeker niet wilde houden --------------------------
  async undo() {
    for (const [naam, a] of Object.entries(this.artifacts)) {
      if (a.released || !a.undo || a.id == null) continue;
      const path = this.fill(a.undo);
      try {
        if (path.startsWith("soc:")) await soc.del(path.slice(4));
        else if (path.startsWith("api:")) await api.del(path.slice(4));
      } catch (_) { /* de pagina toont het zelf; hier is niets meer te doen */ }
      a.released = true;
      document.dispatchEvent(new CustomEvent("bucky:tour-undone", { detail: { name: naam, id: a.id } }));
    }
  }

  stop(finished = false) {
    markSeen();
    clearTimeout(this.settle);
    this.clearPending();
    document.removeEventListener("keydown", this.onKey, true);
    document.removeEventListener("pointerdown", this.onInteract, true);
    document.removeEventListener("keydown", this.onInteract, true);
    window.removeEventListener("resize", this.onLayout);
    window.removeEventListener("scroll", this.onLayout);
    if (this.observer) this.observer.disconnect();
    if (this.target) this.target.classList.remove("tour-target");
    this.balloon.remove();
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

async function main() {
  if (!PAGE || seen()) return;
  const steps = await loadSteps();
  if (!steps.length) return;
  const tour = new Tour(steps);
  window.buckyTour = tour;
  await tour.start();
}

main();

export async function restartTour() {
  try { sessionStorage.removeItem(KEY); } catch (_) { /* niets */ }
  const steps = await loadSteps();
  if (!steps.length) return false;
  const tour = new Tour(steps);
  window.buckyTour = tour;
  await tour.start();
  return true;
}
