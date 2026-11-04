"""Het thema verandert niets aan wat er al was: pixel voor pixel (4-11-2026).

    python tests/test_thema_pixels.py OUDE_BASIS NIEUWE_BASIS

OUDE_BASIS serveert de versie van vóór het thema (bijvoorbeeld `git archive` van de
vorige commit), NIEUWE_BASIS de huidige. Drie groepen:

  * de pagina's die DONKER waren (dashboard, serverkeuze, premium, transcript) in
    "donker": gelijk aan de oude;
  * de v2-pagina's, die LICHT waren, in "licht": gelijk aan de oude;
  * de pagina's zonder thema (de v1-site, de arcade, de oude doorverwijzers):
    gelijk aan de oude, zonder enige keuze.

Het enige toegestane verschil is de rij waar de themaknop in kwam (de balk, de
gebruikersregel van het zijpaneel, de bovenbalk van het transcript): die rij wordt
in beide beelden afgedekt, de rest van de pagina moet identiek zijn. Volledige
pagina's, minder beweging, animaties afgespeeld.
"""
import io
import json
import os
import sys

from PIL import Image, ImageChops, ImageDraw
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# welcome_previews (via test_dashboard_v2) leest sys.argv[1] als uitvoermap: zonder
# argumenten importeren, anders maakt hij een map van de URL.
_ARGV, sys.argv = sys.argv, sys.argv[:1]
import test_dashboard_v2 as dv2  # noqa: E402
sys.argv = _ARGV
import thema_paginas as tp  # noqa: E402

RIJEN = ".site-nav .nav-inner, .dv2-ik, .tr-top, .v2 .nav-bar"
ZONDER_THEMA = ["index.html", "contact.html", "cookie.html", "privacy.html", "rules.html", "tos.html",
                "arcade.html", "settings.html", "soc.html", "rule-builder.html"]


def _stil(page):
    page.wait_for_timeout(600)
    page.evaluate("document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} })")
    page.wait_for_timeout(150)


def _rijen(page):
    return page.evaluate("""(sel) => [...document.querySelectorAll(sel)].map(e => { const r = e.getBoundingClientRect();
        return [Math.floor(r.left + scrollX), Math.floor(r.top + scrollY), Math.ceil(r.right + scrollX), Math.ceil(r.bottom + scrollY)]; })""", RIJEN)


def _beeld(page):
    return Image.open(io.BytesIO(page.screenshot(full_page=True))).convert("RGB")


def vergelijk(oud, nu, maskers):
    if oud.size != nu.size:
        return f"andere maat {oud.size} -> {nu.size}"
    for b in (oud, nu):
        teken = ImageDraw.Draw(b)
        for m in maskers:
            teken.rectangle(m, fill=(255, 0, 255))
    diff = ImageChops.difference(oud, nu)
    n = sum(1 for px in diff.getdata() if max(px) > 16) if diff.getbbox() else 0
    return None if n == 0 else f"{n} px anders in {diff.getbbox()}"


def schot_gevuld(browser, basis, opener, breed, thema):
    page, _ = opener(browser, breed, thema)
    tp.ga(page, basis)
    _stil(page)
    uit = (_beeld(page), _rijen(page))
    page.context.close()
    return uit


def schot_dashboard(browser, basis, soort, key, breed, thema):
    dv2.BASIS = basis
    page, _ = dv2.open_gevuld(browser, soort, key, breed, thema=thema)
    _stil(page)
    uit = (_beeld(page), _rijen(page))
    page.close()
    return uit


def schot_kaal(browser, basis, pad, breed):
    w, h = tp.BREEDTES[breed]
    ctx = browser.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce")
    page = ctx.new_page()
    page.add_init_script("Math.random = () => 0.5;")
    page.route("**/api.buckybot.app/**", lambda r: r.fulfill(status=200, content_type="application/json",
                                                             body=json.dumps({"ok": True, "data": {}})))
    page.goto(f"{basis}/{pad}", wait_until="networkidle")
    page.wait_for_timeout(900)
    _stil(page)
    uit = (_beeld(page), [])
    ctx.close()
    return uit


def main(oud, nieuw):
    fouten = []
    with sync_playwright() as p:
        b = p.chromium.launch()

        def meld(label, a, n):
            maskers = a[1] + n[1]
            r = vergelijk(a[0], n[0], maskers)
            print(f"{label:46s} {'GELIJK' if r is None else 'VERSCHIL ' + r}")
            if r:
                fouten.append(label)

        for breed in ("desktop", "telefoon"):
            for naam in ("kiezer", "premium", "transcript"):
                meld(f"donker  {naam} {breed}", schot_gevuld(b, oud, tp.OPENERS[naam], breed, None),
                     schot_gevuld(b, nieuw, tp.OPENERS[naam], breed, "donker"))
            for soort, paginas in (("server", dv2.SERVER_PAGINAS), ("security", dv2.SECURITY_PAGINAS)):
                for key in paginas:
                    meld(f"donker  {soort}#{key} {breed}", schot_dashboard(b, oud, soort, key, breed, None),
                         schot_dashboard(b, nieuw, soort, key, breed, "donker"))
            for naam in tp.V2_PAGINAS:
                o = tp.OPENERS[f"v2-{naam}"]
                meld(f"licht   v2/{naam} {breed}", schot_gevuld(b, oud, o, breed, None), schot_gevuld(b, nieuw, o, breed, "licht"))
            for pad in ZONDER_THEMA:
                meld(f"geen    {pad} {breed}", schot_kaal(b, oud, pad, breed), schot_kaal(b, nieuw, pad, breed))
        b.close()
    print(f"\n{len(fouten)} verschil(len)" if fouten else "\nalles gelijk")
    return 1 if fouten else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
