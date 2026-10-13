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


# --------------------------------------------------------------------------- #
# De arcade is onder v2 voor een uitgelogde bezoeker niet alleen dicht, maar
# ook onzichtbaar (13-10-2026, aanvulling op deel C). Het Arcade-item in de nav,
# het telefoonmenu en de footer verschijnt pas met een sessie. De poort op
# arcade.html blijft het vangnet (test_arcade_poort.py); de Arcade-KAART op de
# voorpagina blijft staan als teaser (klik -> login). v1 verandert niet.
# --------------------------------------------------------------------------- #
V2_PAGINAS = ["/v2/index.html", "/v2/organisations.html", "/v2/privacy.html", "/v2/contact.html"]

_ZICHTBARE_ARCADE = """(waar) => [...document.querySelectorAll(waar + ' a')]
  .filter(a => a.textContent.trim() === 'Arcade')
  .filter(a => { const r = a.getBoundingClientRect(); const s = getComputedStyle(a);
                 return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; }).length"""


def _arcade(page, waar):
    return page.evaluate(_ZICHTBARE_ARCADE, waar)


@pytest.mark.parametrize("pad", V2_PAGINAS)
def test_v2_uitgelogd_geen_arcade_in_nav_en_footer(sessie, pad):
    s = sessie(versie="v2")
    s.open(pad)
    s.page.wait_for_function("() => !document.querySelector('.nav-auth .nav-login').hidden")
    assert _arcade(s.page, "header.nav") == 0
    assert _arcade(s.page, "footer.foot") == 0


@pytest.mark.parametrize("pad", V2_PAGINAS)
def test_v2_ingelogd_wel_arcade_in_nav_en_footer(sessie, pad):
    s = sessie(versie="v2")
    s.ingelogd = True
    s.open(pad)
    s.page.wait_for_function("() => !document.querySelector('.nav-user').hidden")
    assert _arcade(s.page, "header.nav") == 1
    assert _arcade(s.page, "footer.foot") == 1


def test_v2_telefoonmenu_arcade_alleen_ingelogd(sessie):
    s = sessie(versie="v2", breedte=390)
    s.open("/v2/index.html")
    s.page.click(".nav-toggle")
    s.page.wait_for_timeout(300)
    assert _arcade(s.page, "header.nav") == 0

    s.ingelogd = True
    s.open("/v2/index.html")
    s.page.click(".nav-toggle")
    s.page.wait_for_function("() => !document.querySelector('.nav-sheet-user').hidden")
    assert _arcade(s.page, "header.nav") == 1


def test_v2_uitloggen_verbergt_arcade_weer(sessie):
    s = sessie(versie="v2")
    s.ingelogd = True
    s.open("/v2/index.html")
    s.page.wait_for_function("() => !document.querySelector('.nav-user').hidden")
    assert _arcade(s.page, "header.nav") == 1
    s.page.click(".nav-user-knop")
    s.page.click("#nav-user-menu [data-auth-logout]")
    s.page.wait_for_url("**/v2/index.html")
    s.page.wait_for_function("() => document.querySelector('.nav-user').hidden")
    assert _arcade(s.page, "header.nav") == 0


def test_v2_de_arcadekaart_blijft_als_teaser(sessie):
    s = sessie(versie="v2")
    s.open("/v2/index.html")
    kaart = s.page.locator('.card-game[href="../arcade.html"]')
    kaart.scroll_into_view_if_needed()
    assert kaart.is_visible()


def test_v1_toont_arcade_ook_uitgelogd(sessie):
    s = sessie(versie="v1")
    s.open("/index.html")
    assert s.page.locator('a[href="arcade.html"]', has_text="Arcade").first.is_visible()


@pytest.mark.parametrize("naam", ["index", "organisations", "tos", "privacy", "cookie", "rules", "contact"])
def test_elke_v2_pagina_draagt_het_arcade_item_verborgen(naam):
    """Statisch: nav en footer van elke v2-pagina (kopieen, geen sjabloon)."""
    import re
    html = (SITE / "v2" / f"{naam}.html").read_text(encoding="utf-8")
    items = re.findall(r'<li([^>]*)><a href="\.\./arcade\.html">Arcade</a></li>', html)
    assert len(items) == 2, (naam, items)
    for attrs in items:
        assert "data-auth-in" in attrs and "hidden" in attrs, (naam, attrs)


# --------------------------------------------------------------------------- #
# Een in-app browser zonder opslag (13-10-2026). localStorage en sessionStorage
# kunnen daar ontbreken of gooien. De sessielaag moet dan "uitgelogd" zeggen
# in plaats van af te breken: anders blijft de org-knop stil op "Checking your
# login..." hangen en tekent de nav zijn uitgelogde stand niet.
# --------------------------------------------------------------------------- #
_GEEN_OPSLAG = ("for (const k of ['localStorage', 'sessionStorage'])"
                "  Object.defineProperty(window, k, {get() { throw new Error('geen opslag'); }});")


def test_zonder_opslag_toont_de_v2_nav_gewoon_de_login(sessie):
    s = sessie(versie="v2")
    fouten = []
    s.page.on("pageerror", lambda e: fouten.append(str(e)))
    s.ctx.add_init_script(_GEEN_OPSLAG)
    s.open("/v2/index.html")
    s.page.wait_for_function("() => !document.querySelector('.nav-auth .nav-login').hidden")
    assert s.page.locator(".nav-auth .nav-login").is_visible()
    assert fouten == [], fouten


def test_zonder_opslag_gaat_de_orgknop_naar_de_login(sessie):
    s = sessie(versie="v2", breedte=390)
    logins = []
    s.page.route(f"{API}/login*", lambda r: (logins.append(r.request.url), r.fulfill(status=200, body="login")))
    s.ctx.add_init_script(_GEEN_OPSLAG)
    s.open("/v2/organisations.html")
    s.page.locator("[data-org-cta]").first.click()
    s.page.wait_for_timeout(2500)
    assert logins and "flow%3Dorg" in logins[0], logins
