// tour.js - de onboarding-tour: een rondleiding die het werk doet. Bij Next opent
// de tour zelf het juiste tabblad, klapt een lade uit als het onderdeel daarin
// zit, scrolt ernaartoe en wacht tot het er staat. De bezoeker klikt alleen Next.
//
// DE STAPPEN KOMEN VAN /api/site/tour, en dat is de hele reden dat dit bestand
// geen tekst kent. De teksten staan in de bot-boom (site_tour.json), waar
// +ownerconfig bij kan; de backend serveert ze binnen een minuut. Een woord
// wijzigen is dus geen deploy. Welke pagina dit is staat op <body data-tour>.
//
// EEN STAP HEEFT: selector, title, text, placement, en optioneel
//   route    - een hash (#settings): de tour navigeert daarheen vóór hij wijst;
//   reveal   - een selector (#sec-burger): als het onderdeel onzichtbaar is, wordt
//              dit aangeklikt om het te tonen (de lade op een telefoon), en bij
//              een volgende stap of het sluiten weer om het te verbergen;
//   optional - het onderdeel is er niet altijd (een zoekveld bij weinig servers):
//              kort wachten en anders overslaan. Zonder `optional` wacht de tour
//              tot het onderdeel geladen is in plaats van naar niets te wijzen.
//
// TERUG IS OOK TERUG: Back navigeert naar de route van de vorige stap. SLUITEN
// LAAT GEEN HALVE STAAT ACHTER: de lade gaat dicht als de tour hem opende en de
// pagina keert terug naar het tabblad waar de tour begon - ook na Done, want een
// rondleiding eindigt bij de ingang.
//
// ALLEEN VOOR DEZE SESSIE ONTHOUDEN (sessionStorage): opnieuw inloggen, een
// andere browser of een nieuwe sessie laat hem opnieuw beginnen.
//
// TOEGANKELIJK: role="dialog" met titel en beschrijving; de focus gaat bij elke
// stap naar de ballon en komt aan het eind terug; Tab blijft in de ballon, Enter
// en pijl-rechts gaan verder, pijl-links terug, Escape sluit; op een telefoon is
// de ballon een balk onder- of bovenaan, aan de kant waar het onderdeel niet is,
// en prefers-reduced-motion zet animatie en zacht scrollen uit.

import { API_URL } from "./config.js";

const PAGE = document.body ? document.body.dataset.tour : null;
const KEY = `bucky_tour_seen_${PAGE}`;
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMobile = () => window.matchMedia("(max-width: 640px)").matches;
// De eerste stap en elke stap na een route mogen op de pagina wachten: die laadt
// haar inhoud na een fetch. Een optionele stap krijgt een korte blik.
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
  // een zijbalk die op een telefoon buiten beeld is geschoven heeft wel een
  // maat maar staat links of rechts van het venster: niet zichtbaar
  const vw = document.documentElement.clientWidth;
  return r.right > 0 && r.left < vw;
}

// Een selector mag meerdere kandidaten noemen ("#sec-nav, #sec-burger"): de eerste
// ZICHTBARE wint. `undefined` betekent: ongeldige selector.
function find(selector) {
  let all;
  try { all = document.querySelectorAll(selector); } catch (_) { return undefined; }
  for (const elm of all) if (visible(elm)) return elm;
  return null;
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

class Tour {
  constructor(steps) {
    this.steps = steps;
    this.i = -1;
    this.target = null;
    this.previousFocus = document.activeElement;
    this.startHash = window.location.hash;
    this.navigated = false;
    this.revealed = null;              // { toggle, target } als de tour een lade opende
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
    const actions = el("div", "tour-actions");
    actions.append(this.back, this.next, this.skip);
    this.balloon.append(this.step, this.title, this.text, actions);
    this.back.addEventListener("click", () => this.show(this.i - 1, -1));
    this.next.addEventListener("click", () => this.show(this.i + 1, +1));
    this.skip.addEventListener("click", () => this.stop());
    this.onKey = (e) => this.key(e);
    this.onLayout = () => this.place();
    // Pagina's zetten na hun eigen fetch de focus op de sectiekop. Deed de
    // bezoeker sindsdien niets, dan hoort de focus terug bij de ballon.
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
    await this.show(0, +1);
  }

  // Doe het werk voor een stap: navigeren, wachten tot het onderdeel er is, en
  // een lade openen als het daarin zit. Geeft het onderdeel of null.
  async reach(step) {
    if (step.route && window.location.hash !== step.route) {
      window.location.hash = step.route;
      this.navigated = true;
    }
    // een lade die de tour opende gaat dicht als het volgende onderdeel er
    // niet in zit; zit het er wel in, dan blijft hij open
    if (this.revealed && !find(step.selector)) this.unreveal();
    const wait = step.optional ? WAIT_OPTIONAL_MS : WAIT_LOAD_MS;
    let target = await waitFor(step.selector, step.reveal ? Math.min(wait, WAIT_REVEAL_MS) : wait);
    if (!target && step.reveal) {
      const toggle = find(step.reveal);
      if (toggle) {
        toggle.click();
        target = await waitFor(step.selector, WAIT_REVEAL_MS);
        if (target) this.revealed = { toggle, target };
        else toggle.click();               // het hielp niet: laat het zoals het was
      }
    }
    return target;
  }

  unreveal() {
    if (!this.revealed) return;
    const { toggle, target } = this.revealed;
    this.revealed = null;
    // alleen sluiten als het nog open staat (de pagina kan het zelf al hebben gesloten)
    if (visible(target) && toggle.isConnected) toggle.click();
  }

  async show(index, direction) {
    if (this.busy) return;                 // één overgang tegelijk
    this.busy = true;
    try {
      while (index >= 0 && index < this.steps.length) {
        const target = await this.reach(this.steps[index]);
        if (!this.balloon.isConnected) return;       // ondertussen gesloten
        if (target) { this.render(index, target); return; }
        index += direction || 1;             // stap zonder onderdeel: overslaan
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
    target.classList.add("tour-target");
    const s = this.steps[index];
    this.step.textContent = `Step ${index + 1} of ${this.steps.length}`;
    this.title.textContent = s.title;
    this.text.textContent = s.text;
    this.back.hidden = index === 0;
    this.next.textContent = index === this.steps.length - 1 ? "Done" : "Next";
    this.balloon.classList.remove("tour-in");
    try {
      target.scrollIntoView({ block: isMobile() ? "start" : "center", behavior: REDUCED ? "auto" : "smooth" });
    } catch (_) { target.scrollIntoView(); }
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
  }

  place() {
    if (!this.target || !this.balloon.isConnected) return;
    const b = this.balloon;
    const r = this.target.getBoundingClientRect();
    if (isMobile()) {
      // een balk aan de kant waar het onderdeel NIET is: onder als het
      // onderdeel boven het midden staat, boven als het eronder staat
      b.style.left = b.style.top = "";
      const midden = window.innerHeight / 2;
      const onderdeelOnder = (r.top + r.height / 2) > midden;
      b.classList.add("tour-sheet");
      b.classList.toggle("tour-sheet-top", onderdeelOnder);
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
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.stop(); return; }
    if (e.key === "ArrowRight" || (e.key === "Enter" && !e.target.closest("button, a, input, select, textarea"))) {
      e.preventDefault(); this.show(this.i + 1, +1); return;
    }
    if (e.key === "ArrowLeft") { e.preventDefault(); if (this.i > 0) this.show(this.i - 1, -1); return; }
    if (e.key === "Tab") {
      const focusables = [...this.balloon.querySelectorAll("button:not([hidden])")];
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (!this.balloon.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  stop(finished = false) {
    markSeen();
    clearTimeout(this.settle);
    document.removeEventListener("keydown", this.onKey, true);
    document.removeEventListener("pointerdown", this.onInteract, true);
    document.removeEventListener("keydown", this.onInteract, true);
    window.removeEventListener("resize", this.onLayout);
    window.removeEventListener("scroll", this.onLayout);
    if (this.target) this.target.classList.remove("tour-target");
    this.balloon.remove();
    // geen halve staat: de lade dicht die de tour opende, en terug naar het
    // tabblad waar de bezoeker was toen de tour begon
    this.unreveal();
    if (this.navigated && window.location.hash !== this.startHash) {
      window.location.hash = this.startHash || "";
    }
    document.body.dataset.tourState = finished ? "done" : "skipped";
    const back = this.previousFocus;
    if (back && typeof back.focus === "function" && back.isConnected) {
      try { back.focus({ preventScroll: true }); } catch (_) { /* niets */ }
    }
  }
}

async function main() {
  if (!PAGE || seen()) return;
  const steps = await loadSteps();
  if (!steps.length) return;
  const tour = new Tour(steps);
  window.buckyTour = tour;          // voor tests en voor wie hem opnieuw wil starten
  await tour.start();
}

main();

// Opnieuw starten (bijvoorbeeld vanuit een helpknop): vergeet de sessie en begin.
export async function restartTour() {
  try { sessionStorage.removeItem(KEY); } catch (_) { /* niets */ }
  const steps = await loadSteps();
  if (!steps.length) return false;
  const tour = new Tour(steps);
  window.buckyTour = tour;
  await tour.start();
  return true;
}
