"""De v2-balk op elke breedte van 700 tot 1440 px, in Chromium en WebKit (4-11-2026).

Aanleiding: op een iPad liggend (1080 en 1180 px, ook in de browser van de
Discord-app) liep de balk ingelogd rechts buiten beeld en was "Invite Bucky"
afgekapt. Sinds deze datum gaat de balk onder 1200 px naar het menu (v2.css).

Per breedte, uitgelogd en ingelogd met een lange naam, licht en donker:
  * niets van de balk steekt rechts buiten het scherm;
  * "Invite Bucky" staat er heel (niet afgekapt, niet over twee regels);
  * onder 1200 px is er een menuknop, en daarin staan Security en Economy.

DRAAIEN:  python -m pytest tests/test_v2_nav_breedtes.py
WebKit ontbreekt? `python -m playwright install webkit`, anders slaat dat deel over.
"""
from __future__ import annotations

import functools
import http.server
import json
import pathlib
import threading

import pytest

SITE = pathlib.Path(__file__).resolve().parent.parent
playwright_api = pytest.importorskip("playwright.sync_api")

BREEDTES = [700, 768, 820, 1024, 1080, 1100, 1180, 1199, 1200, 1280, 1440]
GENOEMD = [768, 820, 1024, 1180, 1440]          # de breedtes uit de melding, ook in WebKit
NAAM = "Tommy With A Rather Long Name"


class _StilleHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def server():
    handler = functools.partial(_StilleHandler, directory=str(SITE))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


@pytest.fixture(scope="module")
def pw():
    with playwright_api.sync_playwright() as p:
        yield p


def _browser(pw, motor):
    try:
        return getattr(pw, motor).launch()
    except Exception as exc:                    # noqa: BLE001
        pytest.skip(f"{motor} voor Playwright ontbreekt: {exc}")


def _meet(browser, basis, breedte, ingelogd, thema):
    ctx = browser.new_context(viewport={"width": breedte, "height": 800}, reduced_motion="reduce")
    page = ctx.new_page()
    page.add_init_script("try { localStorage.setItem('bucky_thema', '%s'); } catch (e) {}" % thema)
    gebruiker = {"id": "123456789012345678", "username": "tommy", "global_name": NAAM, "avatar": None}
    if ingelogd:
        page.add_init_script("try { sessionStorage.setItem('user_info', %s); } catch (e) {}" % json.dumps(json.dumps(gebruiker)))
    antwoord = {"logged_in": True, "user": gebruiker} if ingelogd else {"logged_in": False}
    page.route("https://api.buckybot.app/**", lambda r: r.fulfill(status=200, content_type="application/json",
                                                                   body=json.dumps(antwoord)))
    page.goto(f"{basis}/v2/index.html?site=v2", wait_until="networkidle")
    page.wait_for_timeout(200)
    uit = page.evaluate("""() => {
      const buiten = [];
      for (const e of document.querySelectorAll('.nav-bar *')) {
        const r = e.getBoundingClientRect(), s = getComputedStyle(e);
        if (r.width && r.height && s.visibility !== 'hidden' && r.right > innerWidth + 0.5) buiten.push(e.className || e.tagName);
      }
      const inv = document.querySelector('.btn-nav'), r = inv.getBoundingClientRect();
      // Regels tellen met een Range over de tekst: één rechthoek is één regel.
      const rg = document.createRange(); rg.selectNodeContents(inv);
      const regels = new Set([...rg.getClientRects()].map(q => Math.round(q.top))).size;
      return {buiten: [...new Set(buiten)], links: r.left, rechts: r.right,
              heel: inv.scrollWidth <= inv.clientWidth + 1 && regels === 1 && inv.textContent.trim() === 'Invite Bucky',
              menu: getComputedStyle(document.querySelector('.nav-toggle')).display !== 'none'};
    }""")
    if uit["menu"]:
        page.locator(".nav-toggle").click()
        page.wait_for_timeout(100)
        uit["in_menu"] = page.evaluate("""() => [...document.querySelectorAll('.nav-menu .nav-links a')]
            .filter(a => a.getBoundingClientRect().height > 0).map(a => a.textContent.trim())""")
    ctx.close()
    return uit


def _eisen(uit, label, breedte):
    assert not uit["buiten"], f"{label}: steekt buiten beeld: {uit['buiten']}"
    assert uit["rechts"] <= breedte and uit["links"] >= 0, f"{label}: Invite Bucky niet in beeld ({uit})"
    assert uit["heel"], f"{label}: Invite Bucky is afgekapt of breekt"
    assert uit["menu"] == (breedte < 1200), f"{label}: menuknop {'verwacht' if breedte < 1200 else 'niet verwacht'}"
    if uit["menu"]:
        assert {"Security", "Economy"} <= set(uit["in_menu"]), f"{label}: menu mist Security/Economy ({uit['in_menu']})"


@pytest.mark.parametrize("breedte", BREEDTES)
@pytest.mark.parametrize("ingelogd", [False, True])
def test_de_balk_past_en_invite_bucky_staat_er_heel_chromium(pw, server, breedte, ingelogd):
    b = _browser(pw, "chromium")
    try:
        for thema in ("licht", "donker"):
            _eisen(_meet(b, server, breedte, ingelogd, thema), f"chromium {breedte} {'in' if ingelogd else 'uit'} {thema}", breedte)
    finally:
        b.close()


@pytest.mark.parametrize("breedte", GENOEMD)
def test_de_balk_past_ook_in_webkit_zoals_op_een_ipad(pw, server, breedte):
    b = _browser(pw, "webkit")
    try:
        for ingelogd in (False, True):
            _eisen(_meet(b, server, breedte, ingelogd, "donker"), f"webkit {breedte} {'in' if ingelogd else 'uit'}", breedte)
    finally:
        b.close()
