"""De VM openen vanaf een link: `arcade.html?app=org&maximize=1` (13-10-2026).

De org-pagina van v2 stuurt een bezoeker met een groot genoeg scherm naar de
VM, en daar hoort hij meteen in de org-app te staan: de VM in de focusmodus, de
ENTER SYSTEM-klik al gegeven, het org-venster open en gemaximaliseerd. Zonder
parameters verandert er niets: de VM wacht op ENTER SYSTEM zoals altijd.

De leesfunctie zelf (vm/core/launch.js) staat ook los getest: alleen apps uit
START_APPS, alleen `maximize=1`.

DRAAIEN:  python -m pytest tests/test_vm_start.py
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
playwright_api = pytest.importorskip("playwright.sync_api")


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


GEBRUIKER = {"id": "1", "username": "tester", "discriminator": "0", "avatar": None}


def _api(route):
    """De backend: ingelogd, en elke andere route een nette 401 (de org-app toont
    dan zijn buitenstaanderscherm; dat is genoeg om het venster te zien)."""
    pad = urlsplit(route.request.url).path
    origin = route.request.headers.get("origin", "*")
    kop = {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true"}
    if pad == "/api/me":
        body, status = {"logged_in": True, "user": GEBRUIKER, "guilds": []}, 200
    elif pad == "/api/site/features":
        body, status = {"features": {}, "site": {"version": "v1"}}, 200
    else:
        body, status = {"error": "login required"}, 401
    route.fulfill(status=status, content_type="application/json", body=json.dumps(body), headers=kop)


def _open(browser, server, pad):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    pg.route("**/*", lambda r: r.continue_() if urlsplit(r.request.url).hostname == "127.0.0.1" else r.abort())
    pg.route(f"{API}/**", _api)
    pg.goto(f"{server}{pad}", wait_until="load")
    return ctx, pg


def test_een_link_opent_de_org_app_gemaximaliseerd(browser, server):
    ctx, pg = _open(browser, server, "/arcade.html?app=org&maximize=1#the-vm")
    try:
        pg.wait_for_selector(".vm-window[data-window-id^='org-']", timeout=15000)
        pg.wait_for_timeout(600)
        stand = pg.evaluate("""() => {
          const w = document.querySelector(".vm-window[data-window-id^='org-']");
          return {focus: document.body.classList.contains('vm-focus-active'),
                  maximaal: w.classList.contains('is-maximized'),
                  vensters: document.querySelectorAll('.vm-window').length,
                  login: !!document.querySelector('[data-vm-login]')};
        }""")
        assert stand == {"focus": True, "maximaal": True, "vensters": 1, "login": False}, stand
    finally:
        ctx.close()


def test_zonder_parameters_wacht_de_vm_zoals_altijd(browser, server):
    ctx, pg = _open(browser, server, "/arcade.html#the-vm")
    try:
        pg.wait_for_selector("[data-vm-login]", timeout=15000)
        pg.wait_for_timeout(3000)
        stand = pg.evaluate("""() => ({focus: document.body.classList.contains('vm-focus-active'),
                                       vensters: document.querySelectorAll('.vm-window').length,
                                       login: !!document.querySelector('[data-vm-login]')})""")
        assert stand == {"focus": False, "vensters": 0, "login": True}, stand
    finally:
        ctx.close()


def test_de_lezer_laat_alleen_bekende_waarden_door(browser, server):
    ctx, pg = _open(browser, server, "/index.html")
    try:
        uit = pg.evaluate("""async () => {
          const {leesStart, START_APPS} = await import('/vm/core/launch.js');
          return {apps: START_APPS,
                  org: leesStart('?app=org&maximize=1'), alleenMax: leesStart('?maximize=1'),
                  onbekend: leesStart('?app=terminal'), niets: leesStart(''),
                  hoofdletters: leesStart('?app=ORG'), raar: leesStart('?maximize=yes&app=../x')};
        }""")
        assert uit["apps"] == ["org"]
        assert uit["org"] == {"app": "org", "maximize": True}
        assert uit["alleenMax"] == {"app": None, "maximize": True}
        assert uit["onbekend"] is None and uit["niets"] is None and uit["raar"] is None
        assert uit["hoofdletters"] == {"app": "org", "maximize": False}
    finally:
        ctx.close()
