/*
 * LICHT EN DONKER (4-11-2026), voor de v2-site, de premiumpagina, het dashboard en de
 * transcriptpagina. De v1-site laadt dit bestand niet en verandert dus niet.
 *
 * WAT HET DOET
 *   * Zet op <html> `data-thema` ("licht" of "donker": wat er getekend wordt) en
 *     `data-thema-keuze` ("auto", "licht" of "donker": wat de bezoeker koos). Alle
 *     kleuren in de CSS hangen aan `html[data-thema=...]`, nooit aan een media query:
 *     wie "donker" kiest op een licht apparaat, krijgt donker.
 *   * Standaard "auto": de instelling van het apparaat (prefers-color-scheme), en die
 *     wordt gevolgd terwijl de pagina openstaat.
 *   * Elke knop met `data-thema-knop` wisselt auto -> licht -> donker -> auto. De keuze
 *     staat in localStorage (`bucky_thema`); andere tabbladen volgen via het
 *     storage-event. Zonder opslag (privévenster, geblokkeerd) werkt alles, alleen
 *     onthoudt de site het niet.
 *
 * WAAROM EEN GEWOON SCRIPT IN DE <head>, BLOKKEREND
 * Zo staat het thema vast voor de eerste tekening: geen flits van het verkeerde thema.
 * Inline kan niet (strikte CSP: alleen scripts uit eigen bestanden). Hetzelfde patroon
 * als js/site-version.js.
 */
(function () {
  "use strict";
  var SLEUTEL = "bucky_thema";
  var KEUZES = ["auto", "licht", "donker"];
  var VOLGENDE = { auto: "licht", licht: "donker", donker: "auto" };
  var NAMEN = { auto: "Automatic", licht: "Light", donker: "Dark" };
  var html = document.documentElement;
  var mq = null;
  try { mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null; } catch (e) { mq = null; }

  function gelezen() {
    try {
      var v = window.localStorage.getItem(SLEUTEL);
      return KEUZES.indexOf(v) >= 0 ? v : null;
    } catch (e) {
      return null;
    }
  }

  // De keuze in het geheugen: wat telt als er geen opslag is.
  var keuze = gelezen() || "auto";

  function getekend(k) {
    if (k === "licht" || k === "donker") return k;
    return mq && mq.matches ? "donker" : "licht";
  }

  function knoppen() {
    var lijst = document.querySelectorAll("[data-thema-knop]");
    for (var i = 0; i < lijst.length; i++) {
      var knop = lijst[i];
      var label = "Theme: " + NAMEN[keuze] +
        (keuze === "auto" ? " (follows your device, now " + NAMEN[getekend("auto")].toLowerCase() + ")" : "") +
        ". Switch to " + NAMEN[VOLGENDE[keuze]].toLowerCase() + ".";
      knop.setAttribute("aria-label", label);
      knop.setAttribute("title", label);
      knop.setAttribute("data-keuze", keuze);
    }
  }

  // De kleur van de browserbalk (telefoon): <meta name="theme-color"> met een
  // data-thema-donker krijgt in donker die kleur, in licht zijn eigen content terug.
  function balkkleur(thema) {
    var meta = document.querySelector('meta[name="theme-color"][data-thema-donker]');
    if (!meta) return;
    if (!meta.hasAttribute("data-thema-licht")) meta.setAttribute("data-thema-licht", meta.getAttribute("content") || "");
    meta.setAttribute("content", meta.getAttribute(thema === "donker" ? "data-thema-donker" : "data-thema-licht"));
  }

  function zet(k) {
    keuze = KEUZES.indexOf(k) >= 0 ? k : "auto";
    var thema = getekend(keuze);
    html.setAttribute("data-thema", thema);
    html.setAttribute("data-thema-keuze", keuze);
    balkkleur(thema);
    knoppen();
  }

  zet(keuze);

  // De apparaatinstelling verandert terwijl de pagina openstaat.
  if (mq) {
    var volg = function () { if (keuze === "auto") zet("auto"); };
    if (mq.addEventListener) mq.addEventListener("change", volg);
    else if (mq.addListener) mq.addListener(volg);
  }

  // Een ander tabblad koos iets anders.
  window.addEventListener("storage", function (e) {
    if (e.key === SLEUTEL) zet(gelezen() || "auto");
  });

  // Klikken (muis, aanraking, Enter en Spatie op een <button>).
  document.addEventListener("click", function (e) {
    var doel = e.target && e.target.closest ? e.target.closest("[data-thema-knop]") : null;
    if (!doel) return;
    var nieuw = VOLGENDE[keuze];
    try { window.localStorage.setItem(SLEUTEL, nieuw); } catch (err) { /* geen opslag: alleen dit tabblad */ }
    zet(nieuw);
  });

  // Knoppen die later in de pagina komen (of door een script worden gemaakt).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { knoppen(); balkkleur(html.getAttribute("data-thema")); });
  }
  window.buckyThema = { zet: zet, keuze: function () { return keuze; }, getekend: function () { return html.getAttribute("data-thema"); } };
})();
