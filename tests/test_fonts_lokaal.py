"""Geen lettertype meer van Google (ronde 22, deel D, 1-10-2026).

WAAROM. De site laadde Manrope van fonts.googleapis.com en fonts.gstatic.com. Dan
stuurt elke bezoeker zijn IP-adres naar Google, nog voor hij iets doet; onder de
AVG een bekend pijnpunt (een Duitse rechter vond het in 2022 al onrechtmatig).
Nu staan de bestanden op buckybot.app zelf (fonts/, css/fonts.css).

WAT DIT BEWAAKT, in een echte browser en niet alleen in de bron:
  * geen enkele pagina vraagt nog iets aan een server van Google voor letters;
  * Manrope is wel echt geladen, van /fonts/ (anders zou "geen verzoek" ook
    groen zijn als de letter gewoon ontbrak en de systeemletter het overnam);
  * de CSP van elke pagina staat stijl en letters alleen van 'self' toe.

DRAAIEN:  python -m pytest tests/test_fonts_lokaal.py
"""
from __future__ import annotations

import functools
import http.server
import pathlib
import re
import threading
from urllib.parse import urlsplit

import pytest

SITE = pathlib.Path(__file__).resolve().parent.parent
GOOGLE = ("fonts.googleapis.com", "fonts.gstatic.com")
OVERSLAAN = {"node_modules", ".git", "__pycache__", "tests", ".pytest_cache", "-q"}


def _bronbestanden():
    for pad in SITE.rglob("*"):
        if pad.is_file() and pad.suffix in {".html", ".css", ".js"} and not (set(pad.relative_to(SITE).parts) & OVERSLAAN):
            yield pad


def _paginas_met_manrope():
    return sorted(p for p in SITE.glob("*.html") if "manrope" in p.read_text(encoding="utf-8", errors="ignore").lower()
                  or "fonts.css" in p.read_text(encoding="utf-8", errors="ignore"))


def test_geen_bestand_verwijst_nog_naar_google_fonts():
    fout = [str(p.relative_to(SITE)) for p in _bronbestanden()
            if any(h in p.read_text(encoding="utf-8", errors="ignore") for h in GOOGLE)]
    assert fout == []


def test_elke_pagina_met_manrope_haalt_hem_van_de_site_en_de_csp_zegt_alleen_self():
    paginas = _paginas_met_manrope()
    assert len(paginas) >= 10, paginas
    for p in paginas:
        tekst = p.read_text(encoding="utf-8")
        assert 'href="css/fonts.css"' in tekst, p.name
        csp = re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', tekst).group(1)
        regels = {d.split()[0]: d.split()[1:] for d in (x.strip() for x in csp.split(";")) if d}
        assert regels.get("font-src") == ["'self'"], (p.name, regels.get("font-src"))
        assert regels.get("style-src") == ["'self'"], (p.name, regels.get("style-src"))


def test_de_bestanden_en_de_licentie_staan_er():
    css = (SITE / "css" / "fonts.css").read_text(encoding="utf-8")
    bestanden = re.findall(r"url\('\.\./fonts/([^']+)'\)", css)
    assert "manrope-latin.woff2" in bestanden
    for b in bestanden:
        assert (SITE / "fonts" / b).stat().st_size > 1000, b
    assert "SIL OPEN FONT LICENSE" in (SITE / "fonts" / "OFL.txt").read_text(encoding="utf-8").upper()


@pytest.fixture(scope="module")
def server():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(SITE))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def test_in_de_browser_gaat_er_geen_verzoek_naar_google_en_manrope_staat_er(server):
    playwright = pytest.importorskip("playwright.sync_api")
    paginas = _paginas_met_manrope()
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        # Fabrieken en geen standaardargumenten: Playwright geeft een handler een
        # tweede argument mee, en dat overschrijft een standaardwaarde op die plek.
        def maak_route(buiten):
            def route(r):
                host = urlsplit(r.request.url).hostname
                if host == "127.0.0.1":
                    r.continue_()
                else:
                    buiten.append(host)              # niets naar buiten: niet nodig voor deze toets
                    r.abort()
            return route

        def maak_teller(letters):
            def klaar(q):
                if "/fonts/" in q.url:
                    letters.append(q.url)
            return klaar

        for pagina in paginas:
            buiten, letters = [], []
            ctx = b.new_context()
            pg = ctx.new_page()
            pg.route("**/*", maak_route(buiten))
            pg.on("requestfinished", maak_teller(letters))
            pg.goto(f"{server}/{pagina.name}", wait_until="load")
            # Een pagina zonder sessie (het dashboard) stuurt zichzelf door: dan meten
            # op de pagina waar hij uitkomt, die laadt dezelfde letters.
            for _ in range(3):
                try:
                    pg.wait_for_load_state("load")
                    geladen = pg.evaluate("async () => { await document.fonts.ready; await document.fonts.load('700 16px Manrope');"
                                          " return document.fonts.check('700 16px Manrope'); }")
                    break
                except Exception as fout:                       # noqa: BLE001
                    if "Execution context was destroyed" not in str(fout):
                        raise
            else:
                raise AssertionError(f"{pagina.name}: bleef doorsturen")
            ctx.close()
            assert not set(buiten) & set(GOOGLE), (pagina.name, buiten)
            assert geladen, pagina.name
            assert any(u.endswith(".woff2") for u in letters), (pagina.name, letters)
        b.close()
