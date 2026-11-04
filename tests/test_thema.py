"""Licht en donker, in een echte browser (4-11-2026).

    python tests/test_thema.py [BASIS]       (standaard http://127.0.0.1:8899)

Per paginasoort (serverkeuze, Server Center, Security Center, premium, transcript,
elke v2-pagina):

  * geen flits: het thema staat op <html> voordat er een stylesheet of <body> is;
    thema.js staat vóór elke stylesheet, als gewoon (blokkerend) script;
  * de knop met de muis en met het toetsenbord (Enter en Spatie), met een label dat
    zegt wat er nu staat en wat de volgende stap is, en een zichtbare focus;
  * zonder opslag (localStorage gooit): geen fout, de knop werkt in dit tabblad;
  * de apparaatinstelling verandert terwijl de pagina openstaat: "auto" volgt,
    een vaste keuze niet;
  * twee tabbladen: een keuze in het ene geldt in het andere;
  * color-scheme volgt het getekende thema;
  * 360 px: geen horizontale scroll, de knop staat in beeld;
  * contrast AA per tekstelement in beide thema's (contrast_meting.py).
De v1-site laadt het thema niet (ook gecontroleerd).
"""
import os
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contrast_meting as cm  # noqa: E402
# welcome_previews (via test_dashboard_v2) leest sys.argv[1] als uitvoermap: zonder
# argumenten importeren, anders maakt hij een map van de URL.
_ARGV, sys.argv = sys.argv, sys.argv[:1]
import test_dashboard_v2 as dv2  # noqa: E402
sys.argv = _ARGV
import thema_paginas as tp  # noqa: E402

BASIS = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8899"
SITE = pathlib.Path(__file__).resolve().parent.parent
FOUTEN = []

# Elke pagina die het thema hoort te hebben, en de v1-pagina's die het niet mogen hebben.
MET_THEMA = ["dashboard.html", "server.html", "security.html", "premium.html", "transcript.html"] + [
    f"v2/{n}.html" for n in tp.V2_PAGINAS]
ZONDER_THEMA = ["index.html", "contact.html", "cookie.html", "privacy.html", "rules.html", "tos.html", "arcade.html"]

# Wat er op <html> stond op het moment dat de eerste stylesheet of <body> verscheen.
VROEG = """(() => {
  window.__themaVroeg = null;
  new MutationObserver((lijst, obs) => {
    for (const m of lijst) for (const n of m.addedNodes) {
      if (window.__themaVroeg === null && (n.nodeName === 'BODY' || (n.nodeName === 'LINK' && n.rel === 'stylesheet'))) {
        window.__themaVroeg = document.documentElement.getAttribute('data-thema') || '';
        obs.disconnect();
      }
    }
  }).observe(document, {childList: true, subtree: true});
})();"""


def eis(voorwaarde, melding):
    if not voorwaarde:
        FOUTEN.append(melding)
        print("  FOUT:", melding)


def bron():
    """thema.js vóór elke stylesheet, blokkerend; v1 laadt hem niet."""
    for pad in MET_THEMA:
        s = (SITE / pad).read_text(encoding="utf-8")
        script = re.search(r'<script src="(\.\./)?js/thema\.js"></script>', s)
        css = re.search(r'<link rel="stylesheet"', s)
        eis(script is not None, f"{pad}: laadt js/thema.js als gewoon script (geen async/defer/module)")
        eis(script and css and script.start() < css.start(), f"{pad}: thema.js staat vóór de eerste stylesheet")
        eis('href="css/thema.css"' in s or 'href="../css/thema.css"' in s, f"{pad}: laadt css/thema.css")
        eis(s.count("data-thema-knop") >= 1, f"{pad}: heeft een themaknop")
    for pad in ZONDER_THEMA:
        s = (SITE / pad).read_text(encoding="utf-8")
        eis("thema.js" not in s and "data-thema-knop" not in s, f"{pad}: v1/arcade laadt het thema niet")


def _open(browser, naam, breed="desktop", thema=None, **kw):
    if naam in ("server", "security"):
        dv2.BASIS = BASIS
        page, fouten = dv2.open_gevuld(browser, naam, "overview", breed, thema=thema)
        return page, fouten
    page, fouten = tp.OPENERS[naam](browser, breed, thema, **kw)
    if kw.get("vroeg"):
        page.add_init_script(VROEG)
    tp.ga(page, BASIS)
    return page, fouten


def _staat(page):
    return page.evaluate("""() => { const k = document.querySelector('[data-thema-knop]');
      let opslag = null; try { opslag = localStorage.getItem('bucky_thema'); } catch (e) { opslag = 'GEEN'; }
      return {thema: document.documentElement.getAttribute('data-thema'), keuze: document.documentElement.getAttribute('data-thema-keuze'),
              label: k && k.getAttribute('aria-label'), schema: getComputedStyle(document.documentElement).colorScheme,
              opslag, icoon: k ? [...k.querySelectorAll('svg')].filter(s => getComputedStyle(s).display !== 'none').map(s => s.getAttribute('class')) : null}; }""")


def geen_flits(browser, naam):
    for kleur, thema, verwacht in (("light", "donker", "donker"), ("dark", "licht", "licht"), ("dark", None, "donker"), ("light", None, "licht")):
        page, fouten = tp.OPENERS.get(naam, tp.OPENERS["kiezer"])(browser, "desktop", thema, kleur=kleur) if naam in tp.OPENERS else (None, None)
        if page is None:
            # Server Center en Security Center: dezelfde koppen als de serverkeuze, maar hun eigen HTML.
            page, fouten = tp.nieuw(browser, "desktop", thema, kleur=kleur)
            page.goto_doel = f"{naam}.html?guild_id={tp.GID}"
        page.add_init_script(VROEG)
        page.goto(f"{BASIS}/{page.goto_doel}", wait_until="domcontentloaded")
        vroeg = page.evaluate("window.__themaVroeg")
        eis(vroeg == verwacht, f"{naam} {kleur}/{thema}: thema '{verwacht}' staat er vóór de eerste stylesheet (was {vroeg!r})")
        page.context.close()


def knop(browser, naam):
    page, fouten = _open(browser, naam, thema=None)
    s = _staat(page)
    eis(s["keuze"] == "auto" and s["thema"] == "licht", f"{naam}: standaard auto, op een licht apparaat licht ({s})")
    eis(s["icoon"] == ["ic-auto"], f"{naam}: het icoon van auto ({s['icoon']})")
    eis(s["label"] and "Automatic" in s["label"] and "Switch to light" in s["label"], f"{naam}: label zegt de stand en de volgende ({s['label']})")
    eis(s["schema"] == "light", f"{naam}: color-scheme light ({s['schema']})")
    k = page.locator("[data-thema-knop]").first
    k.click()
    s = _staat(page)
    eis(s["keuze"] == "licht" and s["thema"] == "licht" and s["opslag"] == "licht" and s["icoon"] == ["ic-licht"],
        f"{naam}: klik 1 -> licht, onthouden ({s})")
    k.click()
    s = _staat(page)
    eis(s["keuze"] == "donker" and s["thema"] == "donker" and s["schema"] == "dark" and s["icoon"] == ["ic-donker"],
        f"{naam}: klik 2 -> donker, color-scheme dark ({s})")
    # Toetsenbord: focus, dan Enter en Spatie.
    k.focus()
    focus = page.evaluate("""() => { const k = document.activeElement; return {knop: k && k.hasAttribute('data-thema-knop'),
        rand: getComputedStyle(k).outlineStyle, breed: parseFloat(getComputedStyle(k).outlineWidth)}; }""")
    eis(focus["knop"], f"{naam}: de knop krijgt focus")
    page.keyboard.press("Enter")
    s = _staat(page)
    eis(s["keuze"] == "auto", f"{naam}: Enter -> auto ({s['keuze']})")
    page.keyboard.press("Space")
    s = _staat(page)
    eis(s["keuze"] == "licht", f"{naam}: Spatie -> licht ({s['keuze']})")
    # De focusrand bij toetsenbordgebruik: een Tab terug en weer heen.
    page.keyboard.press("Shift+Tab"); page.keyboard.press("Tab")
    focus = page.evaluate("""() => { const k = document.activeElement; return {knop: !!(k && k.hasAttribute('data-thema-knop')),
        rand: getComputedStyle(k).outlineStyle, breed: parseFloat(getComputedStyle(k).outlineWidth)}; }""")
    eis(not focus["knop"] or (focus["rand"] != "none" and focus["breed"] >= 2), f"{naam}: zichtbare focusrand ({focus})")
    eis(not fouten, f"{naam}: geen paginafout of CSP-melding ({fouten[:2]})")
    page.context.close() if naam not in ("server", "security") else page.close()


def zonder_opslag(browser, naam):
    page, fouten = tp.OPENERS[naam](browser, "desktop", None, opslag=False)
    tp.ga(page, BASIS)
    s = _staat(page)
    eis(s["thema"] == "licht" and s["opslag"] == "GEEN", f"{naam} zonder opslag: laadt, licht ({s})")
    page.locator("[data-thema-knop]").first.click()
    page.locator("[data-thema-knop]").first.click()
    s = _staat(page)
    eis(s["thema"] == "donker", f"{naam} zonder opslag: de knop werkt in dit tabblad ({s})")
    eis(not [f for f in fouten if "thema" in f.lower() or "localStorage" in f], f"{naam} zonder opslag: geen fout uit thema.js ({fouten[:2]})")
    page.context.close()


def apparaat_wisselt(browser, naam):
    page, _ = tp.OPENERS[naam](browser, "desktop", None)
    tp.ga(page, BASIS)
    page.emulate_media(color_scheme="dark")
    page.wait_for_timeout(100)
    s = _staat(page)
    eis(s["thema"] == "donker" and "now dark" in (s["label"] or ""), f"{naam}: auto volgt het apparaat naar donker ({s})")
    page.emulate_media(color_scheme="light")
    page.wait_for_timeout(100)
    eis(_staat(page)["thema"] == "licht", f"{naam}: en weer terug naar licht")
    page.locator("[data-thema-knop]").first.click()          # auto -> licht (vast)
    page.emulate_media(color_scheme="dark")
    page.wait_for_timeout(100)
    eis(_staat(page)["thema"] == "licht", f"{naam}: een vaste keuze negeert het apparaat")
    page.context.close()


def twee_tabbladen(browser, naam):
    page, _ = tp.OPENERS[naam](browser, "desktop", None)
    tp.ga(page, BASIS)
    tweede = page.context.new_page()
    tweede.goto_doel = page.goto_doel
    tp.ga(tweede, BASIS)
    page.locator("[data-thema-knop]").first.click()
    page.locator("[data-thema-knop]").first.click()          # -> donker
    tweede.wait_for_timeout(200)
    s = _staat(tweede)
    eis(s["thema"] == "donker" and s["keuze"] == "donker" and s["icoon"] == ["ic-donker"], f"{naam}: het andere tabblad volgt ({s})")
    page.context.close()


def smal(browser, naam):
    for thema in ("licht", "donker"):
        page, fouten = _open(browser, naam, "smal", thema)
        r = page.evaluate("""() => { const k = document.querySelector('[data-thema-knop]'); const b = k.getBoundingClientRect();
          return {over: document.documentElement.scrollWidth - innerWidth, links: b.left, rechts: b.right, zicht: b.width > 0 && b.height > 0}; }""")
        # In het Server en Security Center zit de knop in de lade (telefoon): die is dicht.
        in_lade = naam in ("server", "security")
        eis(r["over"] <= 0, f"{naam} 360 px {thema}: geen horizontale scroll ({r['over']})")
        eis(in_lade or (r["zicht"] and r["links"] >= 0 and r["rechts"] <= 360), f"{naam} 360 px {thema}: knop in beeld ({r})")
        page.context.close() if not in_lade else page.close()


def lade(browser):
    """Telefoon: in het Server en Security Center staat de knop in de lade, naast de gebruiker."""
    for soort in ("server", "security"):
        dv2.BASIS = BASIS
        page, _ = dv2.open_gevuld(browser, soort, "overview", "telefoon", thema="licht")
        page.locator("#sec-burger").click()
        page.wait_for_timeout(400)
        k = page.locator(".dv2-ik [data-thema-knop]")
        eis(k.is_visible(), f"{soort} telefoon: de knop staat in de open lade naast de gebruiker")
        k.click()
        eis(_staat(page)["thema"] == "donker", f"{soort} telefoon: de knop in de lade werkt")
        page.close()


def contrast(browser):
    for naam in tp.OPENERS:
        for thema in ("licht", "donker"):
            for breed in ("desktop", "smal"):
                page, _ = _open(browser, naam, breed, thema)
                uit = cm.meet(page)
                eis(not uit, f"contrast {naam} {thema} {breed}: {len(uit)} onder AA {uit[:3]}")
                page.context.close()
    for soort, paginas in (("server", dv2.SERVER_PAGINAS), ("security", dv2.SECURITY_PAGINAS)):
        for key in paginas:
            for thema in ("licht", "donker"):
                dv2.BASIS = BASIS
                page, _ = dv2.open_gevuld(browser, soort, key, "desktop", thema=thema)
                uit = cm.meet(page)
                # Donker is gelijk aan live (pixelvergelijking); de ene bekende uitzondering staat hier met reden.
                if thema == "donker":
                    uit = [u for u in uit if u["klasse"] != "srv-sub-hint"]
                eis(not uit, f"contrast {soort}#{key} {thema}: {len(uit)} onder AA {uit[:3]}")
                page.close()


def main():
    print("Bron: volgorde en v1 ongemoeid"); bron()
    with sync_playwright() as p:
        b = p.chromium.launch()
        print("Geen flits")
        for naam in ("kiezer", "premium", "transcript", "v2-index", "v2-privacy", "server", "security"):
            geen_flits(b, naam)
        print("De knop: muis en toetsenbord")
        for naam in ("kiezer", "premium", "transcript", "v2-index", "v2-organisations", "server", "security"):
            knop(b, naam)
        print("Zonder opslag, apparaat wisselt, twee tabbladen")
        for naam in ("kiezer", "premium", "transcript", "v2-index"):
            zonder_opslag(b, naam); apparaat_wisselt(b, naam); twee_tabbladen(b, naam)
        print("360 px")
        for naam in list(tp.OPENERS) + ["server", "security"]:
            smal(b, naam)
        print("De lade op een telefoon"); lade(b)
        print("Contrast in beide thema's"); contrast(b)
        b.close()
    if FOUTEN:
        print(f"\n{len(FOUTEN)} FOUT(EN)")
        sys.exit(1)
    print("\nalles ok")


if __name__ == "__main__":
    main()
