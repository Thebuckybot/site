"""Contrast per tekstelement, in de browser gemeten (4-11-2026).

Voor elk zichtbaar element met eigen tekst: de tekstkleur tegen de werkelijke
achtergrond, samengesteld uit alle (half)doorzichtige lagen eronder tot een
dekkende kleur. AA: 4,5:1, of 3:1 voor grote tekst (>= 24px, of >= 18,66px vet).

GRENZEN VAN DE METING (eerlijk):
  * een achtergrond die een AFBEELDING of verloop is, telt alleen met zijn
    basiskleur (background-color); tekst over een foto meet dit niet;
  * tekst met een verloop als vulling (-webkit-text-fill-color: transparent)
    wordt overgeslagen; een verloop als ACHTERGROND telt als het gemiddelde
    van zijn kleuren;
  * de Discord-voorbeelden (.dc-*, .srv-preview*) bootsen Discord na en tellen
    niet mee; een los pictogramteken (ⓘ, ›) moet 3:1 halen, geen 4,5:1;
  * schaduwen en filters tellen niet mee.
Gebruikt door test_dashboard_v2.py en test_thema.py.
"""

METING = r"""(opties) => {
  const parse = (c) => {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const d = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return {r: d[0], g: d[1], b: d[2], a: d.length > 3 ? d[3] : 1};
  };
  const over = (boven, onder) => {
    const a = boven.a + onder.a * (1 - boven.a);
    if (a === 0) return {r: 0, g: 0, b: 0, a: 0};
    const k = (x, y) => (x * boven.a + y * onder.a * (1 - boven.a)) / a;
    return {r: k(boven.r, onder.r), g: k(boven.g, onder.g), b: k(boven.b, onder.b), a};
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const achtergrond = (el) => {
    const lagen = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      // Een verloop telt mee als het gemiddelde van zijn kleuren (de rode knop).
      // Alleen de BOVENSTE laag: bij de aanrader is de tweede laag de rand (border-box).
      const bi = cs.backgroundImage || '';
      let eerste = '';
      const begin = bi.indexOf('gradient(');
      if (begin >= 0) { let diep = 0; for (let i = begin + 8; i < bi.length; i++) {
        if (bi[i] === '(') diep++; else if (bi[i] === ')' && --diep === 0) { eerste = bi.slice(begin, i + 1); break; } } }
      const stops = eerste.match(/rgba?\([^)]+\)/g);
      if (stops && stops.length) {
        const kl = stops.map(parse).filter(Boolean);
        const gem = kl.reduce((t, c) => ({r: t.r + c.r / kl.length, g: t.g + c.g / kl.length, b: t.b + c.b / kl.length, a: t.a + c.a / kl.length}), {r: 0, g: 0, b: 0, a: 0});
        if (gem.a > 0.5) { lagen.push(gem); }
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { lagen.push(c); if (c.a >= 0.999) break; }
    }
    let kleur = parse(getComputedStyle(document.documentElement).backgroundColor) || {r: 255, g: 255, b: 255, a: 1};
    if (kleur.a < 1) kleur = over(kleur, {r: 255, g: 255, b: 255, a: 1});
    for (let i = lagen.length - 1; i >= 0; i--) kleur = over(lagen[i], kleur);
    return kleur;
  };
  const uit = [];
  const gezien = new Set();
  const wortel = document.querySelector(opties.wortel || 'body');
  const lopen = document.createTreeWalker(wortel, NodeFilter.SHOW_TEXT);
  while (lopen.nextNode()) {
    const t = lopen.currentNode;
    if (!t.nodeValue.trim()) continue;
    const el = t.parentElement;
    if (!el || gezien.has(el)) continue;
    gezien.add(el);
    if (el.closest('svg, script, style, noscript, [aria-hidden="true"], .dv2-sr, .pr-sr, .sr-only, .visually-hidden')) continue;
    // De Discord-voorbeelden bootsen Discords eigen kleuren na: die meten we niet.
    if (el.closest('.dc-message, .dc-container, [class^="dc-"], [class*=" dc-"], .srv-preview, .srv-preview-card, .srv-form-preview, .tr-discord')) continue;
    // Een los pictogramteken (ⓘ, ›, ×) is geen tekst: daarvoor geldt 3:1 (WCAG 1.4.11).
    const pictogram = t.nodeValue.trim().length <= 2 && !/[A-Za-z0-9]/.test(t.nodeValue);
    if (opties.overslaan && el.closest(opties.overslaan)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    if (r.bottom < 0 || r.right < 0 || r.left > innerWidth) continue;
    // verborgen door een voorouder met opacity 0 of display none
    let weg = false;
    for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n); if (Number(c.opacity) === 0 || c.display === 'none') { weg = true; break; } }
    if (weg) continue;
    if ((cs.webkitTextFillColor || '').includes('0, 0, 0, 0') || cs.webkitTextFillColor === 'transparent') continue;
    const vg = parse(cs.webkitTextFillColor && !cs.webkitTextFillColor.includes('currentcolor') ? cs.webkitTextFillColor : cs.color) || parse(cs.color);
    if (!vg || vg.a === 0) continue;
    const ag = achtergrond(el);
    const tekst = over(vg, ag);
    const l1 = lum(tekst), l2 = lum(ag);
    const verh = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize), vet = parseInt(cs.fontWeight, 10) >= 700;
    const groot = px >= 24 || (px >= 18.66 && vet);
    const eis = groot || pictogram ? 3 : 4.5;
    // uitgeschakelde bediening hoeft geen AA (WCAG 1.4.3, "inactive user interface component")
    const uitgeschakeld = !!el.closest('[disabled], [aria-disabled="true"], .is-dicht, .srv-group.is-off .srv-list');
    if (verh < eis && !uitgeschakeld) {
      uit.push({tekst: t.nodeValue.trim().slice(0, 40), klasse: (el.className && el.className.baseVal === undefined ? el.className : el.tagName) + '',
                ouder: (el.parentElement && el.parentElement.className && el.parentElement.className.baseVal === undefined ? el.parentElement.className : '') + '',
                kleur: cs.color, achter: `rgb(${Math.round(ag.r)},${Math.round(ag.g)},${Math.round(ag.b)})`,
                verhouding: Math.round(verh * 100) / 100, eis});
    }
  }
  return uit;
}"""


def meet(page, *, wortel=None, overslaan=None):
    """Lijst van tekstelementen onder AA op deze pagina, zoals hij nu getekend is."""
    return page.evaluate(METING, {"wortel": wortel, "overslaan": overslaan})
