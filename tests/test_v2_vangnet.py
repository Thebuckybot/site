"""De voorpagina toont zijn secties ook als de IntersectionObserver hapert (4-11-2026).

Aanleiding: "Security" en "Economy" ontbraken op de voorpagina in donker op een
iPad, in de browser van de Discord-app. Alles met data-reveal begint (met
beweging aan) op opacity 0 en wachtte op de observer. Meldt die niets, dan bleven
de kaarten Security en Economy, de hele Security-sectie en het doel van de
menulink #economy onzichtbaar; in donker zie je dan alleen een leeg donker vlak.
Nagebootst in WebKit met een observer die nooit meldt: de test faalt op de
versie van vóór het vangnet (v2.js, beweging()).

DRAAIEN:  python -m pytest tests/test_v2_vangnet.py
"""
from __future__ import annotations

import functools
import http.server
import pathlib
import threading

import pytest

SITE = pathlib.Path(__file__).resolve().parent.parent
playwright_api = pytest.importorskip("playwright.sync_api")

STUK = ("window.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} "
        "disconnect() {} takeRecords() { return []; } };")
VERBORGEN = """() => [...document.querySelectorAll('[data-reveal]')]
  .filter(e => parseFloat(getComputedStyle(e).opacity) < 0.99).map(e => e.id || e.className)"""


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


@pytest.fixture(scope="module", params=["webkit", "chromium"])
def browser(request):
    with playwright_api.sync_playwright() as p:
        try:
            b = getattr(p, request.param).launch()
        except Exception as exc:                # noqa: BLE001
            pytest.skip(f"{request.param} voor Playwright ontbreekt: {exc}")
        yield b
        b.close()


def _pagina(browser, basis, *, stuk, thema="donker", breedte=1180, hoogte=820, anker=""):
    # Beweging AAN (geen reduced motion): precies de stand waarin het misging.
    ctx = browser.new_context(viewport={"width": breedte, "height": hoogte}, has_touch=True)
    page = ctx.new_page()
    page.add_init_script("try { localStorage.setItem('bucky_thema', '%s'); } catch (e) {}" % thema)
    if stuk:
        page.add_init_script(STUK)
    page.route("https://api.buckybot.app/**", lambda r: r.fulfill(status=200, content_type="application/json",
                                                                   body='{"logged_in": false}'))
    page.goto(f"{basis}/v2/index.html?site=v2{anker}", wait_until="networkidle")
    return page


def _scroll_door(page):
    for _ in range(24):
        page.mouse.wheel(0, 300)
        page.wait_for_timeout(80)
    page.wait_for_timeout(1000)


@pytest.mark.parametrize("thema", ["donker", "licht"])
def test_zonder_werkende_observer_verschijnt_alles_bij_scrollen(browser, server, thema):
    page = _pagina(browser, server, stuk=True, thema=thema)
    assert page.evaluate("document.documentElement.classList.contains('v2-motion')"), "beweging hoort aan te staan"
    _scroll_door(page)
    assert page.evaluate(VERBORGEN) == []
    page.context.close()


@pytest.mark.parametrize("breedte,hoogte", [(1180, 820), (1024, 768)])
def test_de_menulink_naar_economy_landt_op_een_zichtbare_kaart(browser, server, breedte, hoogte):
    page = _pagina(browser, server, stuk=True, breedte=breedte, hoogte=hoogte, anker="#economy")
    page.wait_for_timeout(600)
    st = page.evaluate("""() => { const e = document.getElementById('economy'), r = e.getBoundingClientRect();
      return {opacity: getComputedStyle(e).opacity, top: r.top, titel: e.querySelector('h3').textContent.trim()}; }""")
    assert float(st["opacity"]) > 0.99 and 0 <= st["top"] < hoogte and st["titel"] == "Economy", st
    page.context.close()


def test_met_een_werkende_observer_blijft_het_binnenkomen_zoals_het_was(browser, server):
    page = _pagina(browser, server, stuk=False)
    # Onder de vouw: nog verborgen tot je erheen scrolt (het effect bestaat nog).
    assert "secure-panel" in " ".join(page.evaluate(VERBORGEN))
    _scroll_door(page)
    assert page.evaluate(VERBORGEN) == []
    page.context.close()


def test_security_en_economy_zijn_leesbaar_in_donker(browser, server):
    page = _pagina(browser, server, stuk=False)
    _scroll_door(page)
    for sel in ("#economy h3", "#security .secure-title", ".card-item:first-child h3"):
        kleur = page.evaluate(f"""() => {{ const e = document.querySelector('{sel}'); const s = getComputedStyle(e);
            return [s.color, s.visibility, e.getBoundingClientRect().height]; }}""")
        assert kleur[1] == "visible" and kleur[2] > 0, (sel, kleur)
        assert kleur[0] not in ("rgb(14, 13, 16)", "rgba(0, 0, 0, 0)"), (sel, kleur)
    page.context.close()
