"""Inloggen en uitloggen, in v1 en v2, met dezelfde sessie (13-10-2026, ronde 2).

v2 bouwt geen eigen login: hij gebruikt js/nav-auth.js (de sessiecache,
`/api/me`, `POST /logout`) en tekent alleen zijn eigen knoppen. Deze suite
loopt de hele kring af in een echte browser, tegen een nep-backend die een
sessie bijhoudt:

    uitgelogd -> Login-knop -> (inloggen) -> avatar/naam -> Log out -> uitgelogd

De Discord-login zelf kan hier niet: "inloggen" is de sessie aanzetten en de
pagina opnieuw laden, zoals de terugkeer van /callback dat doet. Wel getoetst:
de Login-knop wijst naar de echte /login, met de pagina als terugkeerpad.

Ook: de arcade-poort (deel C) en de sitebrede schakelaar staan in
test_arcade_poort.py; hier alleen de nav.

DRAAIEN:  python -m pytest tests/test_auth_flow.py
"""
from __future__ import annotations

import functools
import http.server
import json
import pathlib
import threading
from urllib.parse import parse_qs, urlsplit

import pytest

SITE = pathlib.Path(__file__).resolve().parent.parent
API = "https://api.buckybot.app"
playwright_api = pytest.importorskip("playwright.sync_api")

GEBRUIKER = {"id": "80351110224678912", "username": "tester", "global_name": "Tess",
             "discriminator": "0", "avatar": "a1b2c3"}


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


class Sessie:
    """Een tabblad met een nep-backend die onthoudt of je bent ingelogd."""

    def __init__(self, browser, server, versie="v1", breedte=1280):
        self.server, self.ingelogd, self.uitgelogd_via_post = server, False, 0
        self.versie = versie
        self.ctx = browser.new_context(viewport={"width": breedte, "height": 900})
        self.page = self.ctx.new_page()
        self.page.route("**/*", self._buiten)
        self.page.route(f"{API}/**", self._api)
        # avatars komen van Discords CDN; hier een leeg plaatje
        self.page.route("https://cdn.discordapp.com/**",
                        lambda r: r.fulfill(status=200, content_type="image/png", body=b""))

    def _buiten(self, route):
        if urlsplit(route.request.url).hostname == "127.0.0.1":
            route.continue_()
        else:
            route.abort()

    def _api(self, route):
        pad = urlsplit(route.request.url).path
        origin = route.request.headers.get("origin", "*")
        kop = {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true"}

        def stuur(body, status=200):
            route.fulfill(status=status, content_type="application/json", body=json.dumps(body), headers=kop)

        if pad == "/api/me":
            if self.ingelogd:
                stuur({"logged_in": True, "user": GEBRUIKER, "guilds": []})
            else:
                stuur({"logged_in": False}, 401)
        elif pad == "/logout" and route.request.method == "POST":
            self.ingelogd = False
            self.uitgelogd_via_post += 1
            stuur({"success": True})
        elif pad == "/api/site/features":
            stuur({"features": {}, "site": {"version": self.versie}})
        else:
            stuur({"error": "x"}, 404)

    def open(self, pad):
        self.page.goto(f"{self.server}{pad}", wait_until="load")
        self.page.wait_for_function(
            "() => getComputedStyle(document.documentElement).visibility !== 'hidden'")
        self.page.wait_for_timeout(500)

    def sluit(self):
        self.ctx.close()


@pytest.fixture
def sessie(browser, server):
    open_ = []

    def maak(**kw):
        s = Sessie(browser, server, **kw)
        open_.append(s)
        return s

    yield maak
    for s in open_:
        s.sluit()


# --------------------------------------------------------------------------- #
# v1: de bestaande balk, onveranderd
# --------------------------------------------------------------------------- #
def test_v1_de_hele_kring(sessie):
    s = sessie(versie="v1")
    s.open("/")
    assert s.page.locator("#discord-login-button").is_visible()
    assert not s.page.locator("#logout-btn").count()

    s.ingelogd = True                       # terug van de Discord-login
    s.open("/")
    s.page.wait_for_selector("#logout-btn")
    assert not s.page.locator("#discord-login-button").count()

    s.page.click("#logout-btn")
    s.page.wait_for_url("**/index.html")
    s.page.wait_for_selector("#discord-login-button")
    assert s.uitgelogd_via_post == 1


# --------------------------------------------------------------------------- #
# v2: dezelfde sessie, een eigen balk
# --------------------------------------------------------------------------- #
def _v2_stand(page):
    return page.evaluate("""() => ({
      login: getComputedStyle(document.querySelector('.nav-auth .nav-login')).display !== 'none'
             && !document.querySelector('.nav-auth .nav-login').hidden,
      gebruiker: !document.querySelector('.nav-user').hidden,
      naam: document.querySelector('.nav-user-naam').textContent,
      avatar: document.querySelector('.nav-user .nav-avatar').getAttribute('src'),
      loginHref: document.querySelector('.nav-auth .nav-login').getAttribute('href')})""")


def test_v2_de_hele_kring(sessie):
    s = sessie(versie="v1")
    s.open("/v2/?site=v2")
    stand = _v2_stand(s.page)
    assert stand["login"] and not stand["gebruiker"], stand
    # De Login-knop is de echte login van de site, met deze pagina als terugkeer.
    deel = urlsplit(stand["loginHref"])
    assert f"{deel.scheme}://{deel.netloc}{deel.path}" == f"{API}/login"
    assert parse_qs(deel.query)["redirect"] == ["v2/index.html"]

    s.ingelogd = True
    s.open("/v2/")
    s.page.wait_for_function("() => !document.querySelector('.nav-user').hidden")
    stand = _v2_stand(s.page)
    assert stand["gebruiker"] and not stand["login"], stand
    assert stand["naam"] == "Tess"
    assert stand["avatar"] == f"https://cdn.discordapp.com/avatars/{GEBRUIKER['id']}/a1b2c3.png?size=64"

    s.page.click(".nav-user-knop")
    assert s.page.locator("#nav-user-menu").is_visible()
    s.page.click("#nav-user-menu [data-auth-logout]")
    s.page.wait_for_url("**/v2/index.html")
    s.page.wait_for_function("() => document.querySelector('.nav-user').hidden")
    assert s.uitgelogd_via_post == 1
    assert _v2_stand(s.page)["login"]


def test_v2_de_sessie_loopt_door_naar_v1(sessie):
    """Eén sessie: ingelogd in v2 is ingelogd op een v1-pagina (een dashboard)."""
    s = sessie(versie="v1")
    s.ingelogd = True
    s.open("/v2/?site=v2")
    s.page.wait_for_function("() => !document.querySelector('.nav-user').hidden")
    s.open("/tos.html?site=v1")
    s.page.wait_for_selector("#logout-btn")


def test_v2_op_een_telefoon_in_het_menu(sessie):
    s = sessie(versie="v1", breedte=390)
    s.ingelogd = True
    s.open("/v2/?site=v2")
    s.page.click(".nav-toggle")
    s.page.wait_for_function("() => !document.querySelector('.nav-sheet-user').hidden")
    assert s.page.locator(".nav-sheet-user").is_visible()
    assert s.page.locator(".nav-sheet-logout").is_visible()
    assert not s.page.locator(".nav-sheet-extra [data-auth-login]").is_visible()
    s.page.click(".nav-sheet-logout")
    s.page.wait_for_url("**/v2/index.html")
    assert s.uitgelogd_via_post == 1


def test_een_naam_wordt_als_tekst_gezet_en_niet_als_html(sessie):
    """Een gebruikersnaam is invoer van buiten: textContent, nooit innerHTML."""
    s = sessie(versie="v1")
    GEBRUIKER_X = dict(GEBRUIKER, global_name='<img src=x onerror="window.__xss=1">')
    s.ingelogd = True
    s.page.route(f"{API}/api/me", lambda r: r.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({"logged_in": True, "user": GEBRUIKER_X}),
        headers={"Access-Control-Allow-Origin": r.request.headers.get("origin", "*"),
                 "Access-Control-Allow-Credentials": "true"}))
    s.open("/v2/?site=v2")
    s.page.wait_for_function("() => !document.querySelector('.nav-user').hidden")
    assert s.page.evaluate("() => window.__xss") is None
    assert "<img" in s.page.locator(".nav-user-naam").inner_text()
