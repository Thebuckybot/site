"""De voorpagina v2 zoals een bezoeker hem krijgt, in een echte browser.

v2 staat niet live zolang de eigenaar niet omschakelt; deze tests openen hem
zoals een tester dat doet, met `?site=v2`. De backend wordt onderschept:
/api/site/features en /api/site/stats geven wat de test kiest, en elk ander
verzoek naar buiten wordt afgebroken en geteld.

Per deel van docs/site-redesign-clean-epic.md:
  A  letters lokaal, geen verzoek naar Google;
  B  nav en footer: echte links, hamburger op een telefoon;
  C  hero: het beeld zonder layout-shift, de stats-balk alleen met echte cijfers;
  D  de vier kaarten linken ergens heen dat bestaat;
  E  de donkere sectie;
  G  zonder beweging (prefers-reduced-motion) staat alles meteen stil en zichtbaar;
  en over alles: elke zichtbare tekst haalt AA tegen wat er werkelijk achter staat.

DRAAIEN:  python -m pytest tests/test_v2_pagina.py
"""
from __future__ import annotations

import functools
import http.server
import json
import pathlib
import threading
from urllib.parse import urlsplit

import pytest

SITE = pathlib.Path(__file__).resolve().parent.parent
API = "https://api.buckybot.app"
GOOGLE = ("fonts.googleapis.com", "fonts.gstatic.com")

playwright_api = pytest.importorskip("playwright.sync_api")


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
def browser():
    with playwright_api.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


ECHTE_STATS = {"stats": {"servers": 104, "players_week": 33, "challenges": 194, "organisations": 4}}


class V2:
    """Een tabblad op v2, met een gekozen backend."""

    def __init__(self, browser, server, *, breedte=1280, hoogte=900, stats=ECHTE_STATS,
                 features=None, minder_beweging=False):
        self.buiten: list[str] = []
        self.verzoeken: list[str] = []
        self.ctx = browser.new_context(
            viewport={"width": breedte, "height": hoogte},
            reduced_motion="reduce" if minder_beweging else "no-preference")
        self.page = self.ctx.new_page()
        self.stats = stats
        self.features = features or {"premium": True, "dashboard": True}
        self.page.on("request", lambda r: self.verzoeken.append(r.url))
        self.page.route("**/*", self._buiten)                  # vangnet eerst
        self.page.route(f"{API}/api/site/features", self._features)
        self.page.route(f"{API}/api/site/stats", self._stats)
        self.page.goto(f"{server}/v2/?site=v2", wait_until="load")
        self.page.wait_for_function(
            "() => window.BuckySiteVersion && window.BuckySiteVersion.pagina === 'v2'"
            " && getComputedStyle(document.documentElement).visibility !== 'hidden'")

    def _buiten(self, route):
        host = urlsplit(route.request.url).hostname
        if host == "127.0.0.1":
            route.continue_()
        else:
            self.buiten.append(host)
            route.abort()

    @staticmethod
    def _json(route, body, status=200):
        # Met de origin en credentials: features.js vraagt met credentials, en
        # dan weigert de browser een "*".
        origin = route.request.headers.get("origin", "*")
        route.fulfill(status=status, content_type="application/json", body=json.dumps(body),
                      headers={"Access-Control-Allow-Origin": origin,
                               "Access-Control-Allow-Credentials": "true"})

    def _features(self, route):
        self._json(route, {"features": self.features, "homepage": {"version": "v1"}})

    def _stats(self, route):
        if self.stats == "afbreken":
            route.abort()
        elif isinstance(self.stats, int):
            self._json(route, {"error": "x"}, status=self.stats)
        else:
            self._json(route, self.stats)

    def sluit(self):
        self.ctx.close()


@pytest.fixture
def v2(browser, server):
    open_ = []

    def maak(**kw):
        t = V2(browser, server, **kw)
        open_.append(t)
        return t

    yield maak
    for t in open_:
        t.sluit()


# --------------------------------------------------------------------------- #
# A. Letters
# --------------------------------------------------------------------------- #
def test_de_letters_komen_van_de_site_en_niet_van_google(v2):
    t = v2()
    geladen = t.page.evaluate("""async () => {
      await document.fonts.ready;
      await Promise.all([document.fonts.load('800 40px Inter'), document.fonts.load('400 16px Inter'),
                         document.fonts.load('500 12px "JetBrains Mono"')]);
      return [document.fonts.check('800 40px Inter'), document.fonts.check('400 16px Inter'),
              document.fonts.check('500 12px "JetBrains Mono"')];
    }""")
    assert geladen == [True, True, True]
    assert not set(t.buiten) & set(GOOGLE), t.buiten
    assert not [u for u in t.verzoeken if any(g in u for g in GOOGLE)]
    letters = [u for u in t.verzoeken if u.endswith(".woff2")]
    assert letters and all(urlsplit(u).path.startswith("/v2/fonts/") for u in letters), letters


def test_de_kop_staat_echt_in_inter_800(v2):
    t = v2()
    stijl = t.page.evaluate("""() => {
      const h = document.querySelector('h1');
      const s = getComputedStyle(h);
      return [s.fontFamily, s.fontWeight];
    }""")
    assert stijl[0].startswith('"Inter"') or stijl[0].startswith("Inter"), stijl
    assert stijl[1] == "800"


def test_geen_bestand_van_v2_noemt_google_fonts():
    for pad in (SITE / "v2").rglob("*"):
        if pad.suffix in {".html", ".css", ".js"}:
            tekst = pad.read_text(encoding="utf-8")
            assert not any(g in tekst for g in GOOGLE), pad


# --------------------------------------------------------------------------- #
# B. Nav en footer
# --------------------------------------------------------------------------- #
INVITE = ("https://discord.com/oauth2/authorize?client_id=907664862493167680"
          "&scope=bot%20applications.commands&permissions=8")
#: Elke link naar buiten die v2 mag hebben. Een nieuwe hoort hier eerst bij,
#: met de plek waar hij al bestaat: geen verzonnen links.
ECHTE_LINKS_NAAR_BUITEN = {
    INVITE,                                   # index.html (v1), contact.html, ...
    "https://discord.gg/sjESUgXguQ",          # contact.html "Join the server"
    "https://api.buckybot.app/login",         # js/nav-auth.js, de Login van v1
}


def _links(page):
    return page.evaluate("() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))")


def test_elke_link_naar_buiten_bestaat_al_op_de_site(v2):
    t = v2()
    buiten = {h for h in _links(t.page) if h.startswith("http")}
    assert buiten <= ECHTE_LINKS_NAAR_BUITEN, buiten - ECHTE_LINKS_NAAR_BUITEN
    assert INVITE in buiten


def test_elke_link_binnen_de_site_wijst_naar_een_bestand_dat_er_is(v2):
    t = v2()
    for h in _links(t.page):
        if h.startswith(("http", "#", "mailto:")):
            continue
        pad = (SITE / "v2" / h.split("#")[0].split("?")[0]).resolve()
        assert pad.exists(), h


def test_op_een_telefoon_opent_en_sluit_de_hamburger(v2):
    t = v2(breedte=390, hoogte=844)
    knop = t.page.locator(".nav-toggle")
    menu = t.page.locator("#nav-menu")
    assert knop.is_visible()
    assert not menu.is_visible()
    knop.click()
    assert knop.get_attribute("aria-expanded") == "true"
    assert menu.is_visible()
    # Grote tikvlakken: elke link in het menu minstens 48 px hoog.
    hoogtes = t.page.evaluate(
        "() => [...document.querySelectorAll('#nav-menu a')].filter(a => a.offsetParent)"
        ".map(a => a.getBoundingClientRect().height)")
    assert hoogtes and min(hoogtes) >= 48, hoogtes
    t.page.keyboard.press("Escape")
    assert knop.get_attribute("aria-expanded") == "false"
    assert not menu.is_visible()


def test_op_een_breed_scherm_staan_de_links_er_gewoon(v2):
    t = v2(breedte=1280)
    assert not t.page.locator(".nav-toggle").is_visible()
    for naam in ("Home", "Security", "Economy", "Organisations", "Arcade", "Premium"):
        assert t.page.locator(".nav-links a", has_text=naam).first.is_visible(), naam
    assert t.page.locator(".nav-actions .btn-signal", has_text="Invite Bucky").is_visible()
    assert t.page.locator(".nav-discord").is_visible()


def test_premium_volgt_de_vlag(v2):
    """Uit in +ownerconfig betekent ook hier: de link is weg (js/features.js)."""
    t = v2(features={"premium": False, "dashboard": True})
    t.page.wait_for_function(
        "() => [...document.querySelectorAll('[data-feature=premium]')].every(e => e.hidden)")
    assert not t.page.locator(".nav-links a", has_text="Premium").is_visible()
