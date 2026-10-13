"""De legal-pagina's in v2-stijl (13-10-2026, ronde 2 deel D).

INHOUD BEHOUDEN, ALLEEN DE VORM. v2/tos.html, privacy, cookie, rules en contact
dragen letterlijk de tekst van hun v1-pagina; alleen nav, footer en opmaak zijn
van v2. Zonder bouwstap betekent dat twee kopieen, en twee kopieen lopen uit
elkaar. Daarom staat hier de vangrail: de tekst van v1 en v2 is woord voor woord
gelijk, en de links wijzen naar dezelfde bestemming. Pas je de een aan, dan moet
de ander mee.

Verder: de sitebrede schakelaar stuurt in beide richtingen goed, de v2-nav en
-footer zijn op elke v2-pagina dezelfde, en op een telefoon is alles leesbaar
(geen horizontaal scrollen, tekst van minstens 16 px, AA tegen de echte
achtergrond).

DRAAIEN:  python -m pytest tests/test_v2_legal.py
"""
from __future__ import annotations

import functools
import http.server
import json
import pathlib
import posixpath
import re
import threading
from html.parser import HTMLParser
from urllib.parse import urlsplit

import pytest

SITE = pathlib.Path(__file__).resolve().parent.parent
API = "https://api.buckybot.app"
PAGINAS = ["tos", "privacy", "cookie", "rules", "contact"]
IN_V2 = {"index.html", "tos.html", "privacy.html", "cookie.html", "rules.html", "contact.html",
         "organisations.html"}


class _Inhoud(HTMLParser):
    """De tekst en de links binnen .legal-hero en .legal-body."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.diepte, self.tekst, self.links, self._skip = 0, [], [], 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        klassen = (a.get("class") or "").split()
        if self.diepte == 0 and ("legal-hero" in klassen or "legal-body" in klassen):
            self.diepte = 1
            return
        if self.diepte:
            if tag not in ("br", "img", "input", "meta", "link", "path", "rect", "circle"):
                self.diepte += 1
            if tag in ("script", "style"):
                self._skip += 1
            if tag == "a" and a.get("href"):
                self.links.append(a["href"])

    def handle_startendtag(self, tag, attrs):
        # `<path ... />`: geen diepte, wel een link als het een <a/> is.
        a = dict(attrs)
        if self.diepte and tag == "a" and a.get("href"):
            self.links.append(a["href"])

    def handle_endtag(self, tag):
        if tag in ("br", "img", "input", "meta", "link", "path", "rect", "circle"):
            return
        if self.diepte:
            if tag in ("script", "style"):
                self._skip -= 1
            self.diepte -= 1

    def handle_data(self, data):
        if self.diepte and not self._skip:
            self.tekst.append(data)


def inhoud(pad: pathlib.Path):
    p = _Inhoud()
    p.feed(pad.read_text(encoding="utf-8"))
    return " ".join(" ".join(p.tekst).split()), p.links


def bestemming(href: str, map_: str) -> str:
    """Waar een link heen gaat, als sitepad, met een v2-pagina gelijk aan haar v1."""
    if href.startswith(("http", "mailto:")):
        return href
    if href.startswith("#"):
        return href
    pad = posixpath.normpath(posixpath.join(map_, href.split("#")[0]))
    anker = "#" + href.split("#")[1] if "#" in href else ""
    if pad.startswith("v2/") and pad[3:] in IN_V2:
        pad = pad[3:]
    return pad + anker


@pytest.mark.parametrize("naam", PAGINAS)
def test_v2_draagt_letterlijk_de_tekst_van_v1(naam):
    t1, _ = inhoud(SITE / f"{naam}.html")
    t2, _ = inhoud(SITE / "v2" / f"{naam}.html")
    assert len(t1) > 1000, f"{naam}: de v1-tekst is niet gevonden"
    assert t2 == t1


@pytest.mark.parametrize("naam", PAGINAS)
def test_de_links_wijzen_naar_dezelfde_bestemming(naam):
    _, l1 = inhoud(SITE / f"{naam}.html")
    _, l2 = inhoud(SITE / "v2" / f"{naam}.html")
    assert [bestemming(h, ".") for h in l1] == [bestemming(h, "v2") for h in l2]


@pytest.mark.parametrize("naam", PAGINAS)
def test_elke_link_in_v2_bestaat(naam):
    _, links = inhoud(SITE / "v2" / f"{naam}.html")
    for h in links:
        if h.startswith(("http", "#", "mailto:")):
            continue
        assert (SITE / "v2" / h.split("#")[0]).resolve().exists(), h


def test_de_vangrail_ziet_een_tekst_die_uit_de_pas_loopt(tmp_path):
    """Een woord anders in de kopie moet hij vinden; anders bewaakt hij niets."""
    v2 = (SITE / "v2" / "tos.html").read_text(encoding="utf-8")
    kopie = tmp_path / "tos.html"
    kopie.write_text(v2.replace("govern your access", "govern your use"), encoding="utf-8")
    assert inhoud(kopie)[0] != inhoud(SITE / "tos.html")[0]


def _blok(tekst: str, begin: str, eind: str) -> str:
    stuk = tekst[tekst.index(begin):tekst.index(eind, tekst.index(begin)) + len(eind)]
    stuk = re.sub(r'href="index\.html#', 'href="#', stuk)
    stuk = stuk.replace('href="index.html"', 'href="#top"').replace(' aria-current="page"', "")
    return " ".join(stuk.split())


@pytest.mark.parametrize("naam", PAGINAS)
def test_nav_en_footer_zijn_die_van_de_voorpagina(naam):
    """Een kopie per pagina (geen sjablonen zonder bouwstap), dus bewaakt."""
    index = (SITE / "v2" / "index.html").read_text(encoding="utf-8")
    pagina = (SITE / "v2" / f"{naam}.html").read_text(encoding="utf-8")
    for begin, eind in (('<header class="nav"', "</header>"), ('<footer class="foot">', "</footer>")):
        assert _blok(pagina, begin, eind) == _blok(index, begin, eind), (naam, begin)


# --------------------------------------------------------------------------- #
# In de browser
# --------------------------------------------------------------------------- #
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


def _tab(browser, server, versie, breedte=1280, hoogte=900):
    ctx = browser.new_context(viewport={"width": breedte, "height": hoogte}, reduced_motion="reduce")
    pg = ctx.new_page()

    def api(route):
        pad = urlsplit(route.request.url).path
        kop = {"Access-Control-Allow-Origin": route.request.headers.get("origin", "*"),
               "Access-Control-Allow-Credentials": "true"}
        if pad == "/api/site/features":
            body, status = {"features": {}, "site": {"version": versie}}, 200
        else:
            body, status = {"logged_in": False}, 401
        route.fulfill(status=status, content_type="application/json", body=json.dumps(body), headers=kop)

    pg.route("**/*", lambda r: r.continue_() if urlsplit(r.request.url).hostname == "127.0.0.1" else r.abort())
    pg.route(f"{API}/**", api)
    return ctx, pg


def _open(pg, server, pad):
    pg.goto(f"{server}{pad}", wait_until="commit")
    pg.wait_for_function("() => window.BuckySiteVersion && document.readyState === 'complete'"
                         " && getComputedStyle(document.documentElement).visibility !== 'hidden'",
                         timeout=8000)
    return urlsplit(pg.url).path


@pytest.mark.parametrize("naam", PAGINAS)
def test_de_sitebrede_schakelaar_stuurt_in_beide_richtingen(browser, server, naam):
    ctx, pg = _tab(browser, server, "v2")
    try:
        assert _open(pg, server, f"/{naam}.html") == f"/v2/{naam}.html"
    finally:
        ctx.close()
    ctx, pg = _tab(browser, server, "v1")
    try:
        assert _open(pg, server, f"/v2/{naam}.html") == f"/{naam}.html"
    finally:
        ctx.close()


@pytest.mark.parametrize("naam", PAGINAS)
def test_op_een_telefoon_leesbaar(browser, server, naam):
    ctx, pg = _tab(browser, server, "v2", breedte=390, hoogte=844)
    try:
        _open(pg, server, f"/v2/{naam}.html")
        maat = pg.evaluate("""() => ({breed: document.documentElement.scrollWidth, scherm: innerWidth,
          tekst: Math.min(...[...document.querySelectorAll('.legal-content p')].map(p => parseFloat(getComputedStyle(p).fontSize)))})""")
        assert maat["breed"] <= maat["scherm"], maat
        assert maat["tekst"] >= 16, maat
    finally:
        ctx.close()


@pytest.mark.parametrize("breedte,hoogte", [(390, 844), (1280, 900)])
@pytest.mark.parametrize("naam", ["privacy", "contact"])
def test_elke_zichtbare_tekst_haalt_aa(browser, server, naam, breedte, hoogte):
    from test_v2_pagina import _AA
    ctx, pg = _tab(browser, server, "v2", breedte=breedte, hoogte=hoogte)
    try:
        _open(pg, server, f"/v2/{naam}.html")
        uit = pg.evaluate(_AA)
        assert uit["geteld"] > 20 and uit["fout"] == [], uit["fout"]
    finally:
        ctx.close()
