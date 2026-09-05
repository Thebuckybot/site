// tour.js - de onboarding-tour: een tekstballon bij een onderdeel, met Back,
// Next en Skip, langs de stappen die de backend voor DEZE pagina teruggeeft.
//
// DE STAPPEN KOMEN VAN /api/site/tour, en dat is de hele reden dat dit bestand
// geen tekst kent. De teksten staan in de bot-boom (site_tour.json), waar
// +ownerconfig bij kan; de backend serveert ze binnen een minuut. Een woord
// wijzigen is dus geen deploy. Welke pagina dit is staat op <body data-tour>.
//
// ALLEEN VOOR DEZE SESSIE ONTHOUDEN (sessionStorage): opnieuw inloggen, een
// andere browser of een nieuw tabblad in een nieuwe sessie laat hem opnieuw
// beginnen. Dat is de afspraak - hij mag niet voor altijd verdwijnen achter een
// vinkje dat iemand per ongeluk zette.
//
// TOEGANKELIJK, EN DAT IS GEEN LAAG ER BOVENOP:
//   * de ballon is een role="dialog" met een titel en een beschrijving; de
//     focus gaat bij elke stap naar de ballon en komt aan het eind terug waar
//     hij was;
//   * Tab blijft in de ballon, Enter en pijl-rechts gaan verder, pijl-links
//     terug, Escape sluit; de knoppen zijn echte <button>s;
//   * prefers-reduced-motion: geen animatie en geen zacht scrollen;
//   * op een telefoon is de ballon een onderbalk en het onderdeel wordt boven de
//     balk in beeld gescrold, zodat de tekst nooit het onderdeel bedekt.
//
// EEN STAP ZONDER ONDERDEEL WORDT OVERGESLAGEN. Pagina's laden hun inhoud pas na
// een fetch, dus er wordt kort op het onderdeel gewacht; is het er dan nog niet
// (uitgezet, andere rol), dan gaat de tour verder met de volgende stap in plaats
// van een ballon in het niets te zetten.

import { API_URL } from "./config.js";

const PAGE = document.body ? document.body.dataset.tour : null;
const KEY = `bucky_tour_seen_${PAGE}`;
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMobile = () => window.matchMedia("(max-width: 640px)").matches;
// De eerste stap mag op de pagina wachten (die laadt haar inhoud na een fetch);
// daarna is de pagina er al, en een onderdeel dat er dan niet is (verborgen,
// andere rol) wordt na een korte blik overgeslagen - niet na seconden stilte.
const WAIT_FIRST_MS = 8000;
const WAIT_STEP_MS = 400;

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

// Een selector mag meerdere kandidaten noemen ("#sec-nav, #sec-menu"): de eerste
// ZICHTBARE wint. Zo wijst één stap op de desktop naar de zijbalk en op een
// telefoon naar de menuknop, zonder twee configuraties.
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
      if (elm === undefined) return resolve(null);   // ongeldige selector
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
    // bezoeker sindsdien niets, dan hoort de focus terug bij de ballon; deed hij
    // wel iets (klik, toets), dan is dat zijn keuze en blijven we eraf.
    this.interacted = false;
    this.onInteract = () => { this.interacted = true; };
    this.settle = null;
  }

  async start() {
    document.body.appendChild(this.balloon);
    document.addEventListener("keydown", this.onKey, true);
    document.addEventListener("pointerdown", this.onInteract, true);
    document.addEventListener("keydown", this.onInteract, true);
    window.addEventListener("resize", this.onLayout);
    window.addEventListener("scroll", this.onLayout, { passive: true });
    // de eerste stap mag op de pagina wachten: die laadt zijn inhoud na een fetch
    const first = await waitFor(this.steps[0].selector, WAIT_FIRST_MS);
    if (!first) { await this.show(1, +1, WAIT_STEP_MS); return; }
    await this.show(0, +1);
  }

  async show(index, direction, wait = WAIT_STEP_MS) {
    // één overgang tegelijk: een dubbele klik op Next mag geen stap overslaan
    if (this.busy) return;
    this.busy = true;
    try {
      // voorbij het einde is klaar; vóór het begin blijft de eerste staan
      while (index >= 0 && index < this.steps.length) {
        const target = await waitFor(this.steps[index].selector, wait);
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
    this.balloon.classList.toggle("tour-sheet", isMobile());
    try {
      target.scrollIntoView({ block: isMobile() ? "start" : "center", behavior: REDUCED ? "auto" : "smooth" });
    } catch (_) { target.scrollIntoView(); }
    // na het scrollen plaatsen; bij zacht scrollen volgt de scroll-listener
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
    if (isMobile()) {
      // onderbalk: alleen zorgen dat het onderdeel BOVEN de balk zichtbaar is
      b.style.left = b.style.top = "";
      const r = this.target.getBoundingClientRect();
      const sheetTop = window.innerHeight - b.offsetHeight;
      if (r.bottom > sheetTop - 8) {
        window.scrollBy({ top: r.bottom - (sheetTop - 8), behavior: REDUCED ? "auto" : "smooth" });
      }
      return;
    }
    const pref = (this.steps[this.i].placement || "below").toLowerCase();
    const r = this.target.getBoundingClientRect();
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
    // binnen het venster houden
    left = Math.max(8, Math.min(left, vw - bw - 8));
    top = Math.max(8, top);
    b.style.left = `${Math.round(left + window.scrollX)}px`;
    b.style.top = `${Math.round(top + window.scrollY)}px`;
  }

  key(e) {
    if (!this.balloon.isConnected) return;
    if (e.key === "Escape") { e.preventDefault(); this.stop(); return; }
    if (e.key === "ArrowRight" || (e.key === "Enter" && !e.target.closest("button, a, input, select, textarea"))) {
      e.preventDefault(); this.show(this.i + 1, +1); return;
    }
    if (e.key === "ArrowLeft") { e.preventDefault(); if (this.i > 0) this.show(this.i - 1, -1); return; }
    if (e.key === "Tab") {
      // Tab blijft in de ballon: de dialoog hoort bij elkaar te blijven
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
