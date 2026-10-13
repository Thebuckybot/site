"""De arcade achter de login, alleen onder v2 (13-10-2026, ronde 2 deel C).

De arcade ziet er in v1 en v2 hetzelfde uit; alleen de toegang verschilt, en die
hoort bij de v2-tak (hij rolt mee uit als de eigenaar naar v2 schakelt):

  * v2, uitgelogd  -> naar `/login?redirect=arcade.html`, en na de login terug;
  * v2, ingelogd   -> gewoon binnen, met een Log out in de bestaande nav;
  * v1             -> zoals altijd, zonder poort en zonder extra knop.

EERLIJK OVER WAT DIT IS: een nette deur aan de voorkant. De data achter de
arcade bewaakt de backend zelf; zie de routelijst in het rapport van deze ronde.

LET OP, EEN BEWUSTE OMKERING. js/dashboard.js legt uit dat de minigames onder
de VM juist zonder account speelbaar horen te zijn. Onder v2 gaat dat dicht,
omdat de eigenaar dat in deze ronde zo vroeg. Onder v1 blijft het open.

Ook hier: de sitebrede schakelaar (dezelfde `site.version` bestuurt de arcade-
poort) en dat de dashboards de schakelaar niet laden.

DRAAIEN:  python -m pytest tests/test_arcade_poort.py
"""
from __future__ import annotations

import functools
import http.server
import json
import pathlib
import re
import threading
from urllib.parse import parse_qs, urlsplit

import pytest

SITE = pathlib.Path(__file__).resolve().parent.parent
API = "https://api.buckybot.app"
playwright_api = pytest.importorskip("playwright.sync_api")

GEBRUIKER = {"id": "80351110224678912", "username": "tester", "discriminator": "0", "avatar": None}


class _Stil(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


@pytest.fixture(scope="module")
def server():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_Stil, directory=str(SITE)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


@pytest.fixture(scope="module")
def browser():
    with playwright_api.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


class Tab:
    def __init__(self, browser, server, versie, ingelogd=False):
        self.server, self.versie, self.ingelogd = server, versie, ingelogd
        self.logins, self.uitgelogd, self.me_fout = [], 0, False
        self.ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        self.page = self.ctx.new_page()
        self.page.route("**/*", self._buiten)
        self.page.route(f"{API}/**", self._api)

    def _buiten(self, route):
        if urlsplit(route.request.url).hostname == "127.0.0.1":
            route.continue_()
        else:
            route.abort()

    def _api(self, route):
        deel = urlsplit(route.request.url)
        kop = {"Access-Control-Allow-Origin": route.request.headers.get("origin", "*"),
               "Access-Control-Allow-Credentials": "true"}

        def stuur(body, status=200):
            route.fulfill(status=status, content_type="application/json", body=json.dumps(body), headers=kop)

        if deel.path == "/login":
            # Discord zelf kan hier niet; de test noteert waar hij heen zou gaan.
            self.logins.append(parse_qs(deel.query).get("redirect", [None])[0])
            route.fulfill(status=200, content_type="text/html", body="<!doctype html><title>login</title>")
        elif deel.path == "/api/me":
            if self.me_fout:
                route.abort()
            elif self.ingelogd:
                stuur({"logged_in": True, "user": GEBRUIKER, "guilds": []})
            else:
                stuur({"logged_in": False}, 401)
        elif deel.path == "/logout":
            self.ingelogd = False
            self.uitgelogd += 1
            stuur({"success": True})
        elif deel.path == "/api/site/features":
            stuur({"features": {}, "site": {"version": self.versie}})
        elif self.ingelogd:
            # Met een sessie antwoorden de andere routes gewoon (een 401 laat
            # js/dashboard.js de sessiecache wissen, en dat is uitloggen).
            stuur({})
        else:
            stuur({"error": "login required"}, 401)

    def open(self, pad):
        self.page.goto(f"{self.server}{pad}", wait_until="commit")
        self.page.wait_for_timeout(2200)

    @property
    def pad(self):
        return urlsplit(self.page.url).path

    def zichtbaar(self):
        return self.page.evaluate("() => getComputedStyle(document.documentElement).visibility !== 'hidden'")

    def sluit(self):
        self.ctx.close()


@pytest.fixture
def tab(browser, server):
    open_ = []

    def maak(versie, **kw):
        t = Tab(browser, server, versie, **kw)
        open_.append(t)
        return t

    yield maak
    for t in open_:
        t.sluit()


# --------------------------------------------------------------------------- #
# v2: de poort
# --------------------------------------------------------------------------- #
def test_v2_uitgelogd_gaat_naar_de_login_en_komt_terug_op_de_arcade(tab):
    t = tab("v2")
    t.open("/arcade.html#the-vm")
    assert t.logins == ["arcade.html#the-vm"], t.logins


def test_v2_ingelogd_komt_binnen_en_kan_uitloggen(tab):
    t = tab("v2", ingelogd=True)
    t.open("/arcade.html")
    assert t.pad == "/arcade.html" and t.zichtbaar() and t.logins == []
    knop = t.page.locator("#nav-menu [data-uitloggen]")
    knop.wait_for(timeout=5000)
    # De arcade-nav is een hamburgermenu (ook Home ligt dicht tot je het opent).
    t.page.click(".arcade-nav .hamburger")
    knop.click()
    t.page.wait_for_url("**/index.html")
    assert t.uitgelogd == 1


def test_de_hele_kring(tab):
    """inloggen -> arcade bereikbaar -> uitloggen -> arcade stuurt weer naar de login."""
    t = tab("v2")
    t.open("/arcade.html")
    assert t.logins == ["arcade.html"]
    t.ingelogd = True                        # terug van Discord
    t.open("/arcade.html")
    assert t.pad == "/arcade.html" and t.zichtbaar()
    t.page.locator("#nav-menu [data-uitloggen]").wait_for(timeout=5000)
    t.page.click(".arcade-nav .hamburger")
    t.page.locator("#nav-menu [data-uitloggen]").click()
    t.page.wait_for_url("**/index.html")
    t.open("/arcade.html")
    assert t.logins == ["arcade.html", "arcade.html"]


def test_een_verlopen_sessie_in_de_cache_stuurt_alsnog_naar_de_login(tab):
    t = tab("v2")
    t.page.add_init_script("sessionStorage.setItem('user_info', JSON.stringify({id: '1'}))")
    t.open("/arcade.html")
    assert t.logins == ["arcade.html"]


def test_een_onbereikbare_backend_laat_de_arcade_open(tab):
    """Geen lege pagina en geen lus naar een login die niet antwoordt: open laten.
    De data achter de arcade is zonder sessie toch dicht."""
    t = tab("v2")
    t.me_fout = True
    t.open("/arcade.html")
    t.page.wait_for_timeout(800)
    assert t.pad == "/arcade.html" and t.zichtbaar() and t.logins == []


def test_een_preview_van_v2_heeft_de_poort_ook(tab):
    t = tab("v1")
    t.open("/arcade.html?site=v2")
    assert t.logins and t.logins[0].startswith("arcade.html")


# --------------------------------------------------------------------------- #
# v1: zoals altijd
# --------------------------------------------------------------------------- #
def test_v1_uitgelogd_geen_poort(tab):
    t = tab("v1")
    t.open("/arcade.html")
    assert t.pad == "/arcade.html" and t.zichtbaar() and t.logins == []


def test_v1_ingelogd_geen_extra_knop(tab):
    t = tab("v1", ingelogd=True)
    t.open("/arcade.html")
    t.page.wait_for_timeout(800)
    assert not t.page.locator("#nav-menu [data-uitloggen]").count()


# --------------------------------------------------------------------------- #
# Wat de schakelaar wel en niet laadt
# --------------------------------------------------------------------------- #
DASHBOARDS = ["dashboard.html", "security.html", "server.html", "soc.html", "settings.html",
              "premium.html", "transcript.html", "rule-builder.html"]


@pytest.mark.parametrize("naam", DASHBOARDS)
def test_de_dashboards_laden_de_schakelaar_niet(naam):
    """Niet gemigreerd, dus altijd v1, wat de config ook zegt."""
    pad = SITE / naam
    if not pad.exists():
        pytest.skip(f"{naam} bestaat niet")
    assert "site-version.js" not in pad.read_text(encoding="utf-8")


def test_de_arcade_laadt_de_schakelaar_als_eerste_script_met_de_poort():
    kop = (SITE / "arcade.html").read_text(encoding="utf-8").split("</head>")[0]
    eerste = re.search(r"<(script|link)\b[^>]*>", kop.split("Content-Security-Policy")[1]).group(0)
    assert 'src="js/site-version.js"' in eerste
    assert 'data-page="beide"' in eerste and 'data-gate="login"' in eerste
