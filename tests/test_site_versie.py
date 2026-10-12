"""De versieschakelaar van de voorpagina, zoals een bezoeker hem merkt (deel A0).

buckybot.app heeft twee voorpagina's: v1 (index.html) en v2 (v2/index.html).
Welke het publiek krijgt staat in site_features.json (`homepage.version`, om te
zetten met `+ownerconfig`) en komt binnen via /api/site/features. De keuze
maakt js/site-version.js, voor de eerste paint.

De andere twee kanten van deze schakelaar:
  * backend/tests/test_site_homepage_versie.py  - de lezer (onzin wordt v1);
  * bucky1.0/tests/test_owner_config_homepage.py - de schrijver (alleen v1/v2).

WAT DIT BEWAAKT, in een echte browser met een onderschepte backend:
  * standaard v1; config op v2 geeft v2; een onzinwaarde of een oude backend
    zonder het veld geeft v1;
  * `?site=v2` toont v2 ongeacht de config, alleen in dat tabblad;
  * de backend faalt of hangt: v1 (of de laatst bekende), nooit een leeg scherm;
  * GEEN FLITS: bij een wissel wordt de verkeerde versie geen enkel frame
    zichtbaar getekend;
  * een verse keuze in de browser kost geen verzoek.

DRAAIEN:  python -m pytest tests/test_site_versie.py
"""
from __future__ import annotations

import functools
import http.server
import json
import pathlib
import re
import threading
import time
from urllib.parse import urlsplit

import pytest

SITE = pathlib.Path(__file__).resolve().parent.parent
API = "https://api.buckybot.app"

playwright_api = pytest.importorskip("playwright.sync_api")


class _StilleHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):          # noqa: D401 - geen regel per verzoek
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


#: Legt per getekend frame vast welke versie er stond en of hij zichtbaar was.
#: Draait voor elk script op elke pagina in het tabblad, dus ook voor de
#: schakelaar zelf, en bewaart het spoor in sessionStorage zodat het een
#: paginawissel overleeft.
_FRAMESPOOR = """
(() => {
  const log = () => {
    try {
      const pad = location.pathname;
      const zicht = getComputedStyle(document.documentElement).visibility;
      const spoor = JSON.parse(sessionStorage.getItem("__frames") || "[]");
      spoor.push([pad, zicht, !!document.body]);
      sessionStorage.setItem("__frames", JSON.stringify(spoor.slice(-400)));
    } catch (e) {}
    requestAnimationFrame(log);
  };
  requestAnimationFrame(log);
})();
"""


class Opstelling:
    """Een tabblad met een verzonnen backend.

    `antwoord` is wat /api/site/features teruggeeft: een dict (JSON), een
    statuscode (int), "afbreken" of ("traag", seconden, dict).
    """

    def __init__(self, browser, server, antwoord, *, opslag=None, frames=False):
        self.server = server
        self.verzoeken = []
        self.ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        if opslag:
            # localStorage zetten vóór het eerste script: via een init-script op
            # de eigen origin, alleen bij het allereerste laden.
            self.ctx.add_init_script(
                "if (!sessionStorage.getItem('__opslag_gezet')) {"
                f"  const o = {json.dumps(opslag)};"
                "  for (const [k, v] of Object.entries(o)) localStorage.setItem(k, v);"
                "  sessionStorage.setItem('__opslag_gezet', '1');"
                "}")
        if frames:
            self.ctx.add_init_script(_FRAMESPOOR)
        self.page = self.ctx.new_page()
        self.antwoord = antwoord
        # Uitgestelde antwoorden: (tijdstip, route, body). NIET slapen in de
        # handler: de sync-API van Playwright draait handlers op de testdraad,
        # en een sleep daar houdt ook de pagina zelf stil.
        self.uitgesteld = []

        # VANGNET EERST, specifiek erna: Playwright probeert routes in omgekeerde
        # volgorde van registratie.
        self.page.route("**/*", self._buiten)
        # Met en zonder query: de schakelaar vraagt `?switch=1`, js/features.js
        # (op v1 en op v2) vraagt zonder. Alleen de eerste telt als verzoek
        # van de schakelaar.
        self.page.route(f"{API}/api/site/features*", self._features)

    def _buiten(self, route):
        host = urlsplit(route.request.url).hostname
        if host == "127.0.0.1":
            route.continue_()
        else:
            route.abort()           # GSAP van unpkg en de rest: niet nodig hier

    def _features(self, route):
        if "switch=1" in route.request.url:
            self.verzoeken.append(time.monotonic())
        a = self.antwoord
        if a == "afbreken":
            route.abort()
            return
        if isinstance(a, int):
            route.fulfill(status=a, content_type="application/json", body="{}")
            return
        if isinstance(a, tuple) and a[0] == "traag":
            self.uitgesteld.append((time.monotonic() + a[1], route, a[2]))
            return
        self._geef(route, a)

    @staticmethod
    def _geef(route, body):
        try:
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body),
                          headers={"Access-Control-Allow-Origin": "*"})
        except Exception:                       # noqa: BLE001 - pagina al weg
            pass

    def _pomp(self):
        nu = time.monotonic()
        for item in [u for u in self.uitgesteld if u[0] <= nu]:
            self.uitgesteld.remove(item)
            self._geef(item[1], item[2])

    def open(self, pad, timeout=6.0):
        self.page.goto(f"{self.server}{pad}", wait_until="commit")
        # De keuze is gemaakt zodra de pagina zichtbaar is en zichzelf kent.
        eind = time.monotonic() + timeout
        while time.monotonic() < eind:
            self._pomp()
            try:
                klaar = self.page.evaluate(
                    "() => document.readyState === 'complete' && !!window.BuckySiteVersion"
                    " && getComputedStyle(document.documentElement).visibility !== 'hidden'")
            except Exception:                   # noqa: BLE001 - midden in een wissel
                klaar = False
            if klaar:
                return self
            self.page.wait_for_timeout(40)
        raise AssertionError(f"{pad}: geen zichtbare pagina binnen {timeout} s ({self.page.url})")

    @property
    def versie(self):
        return self.page.evaluate("() => window.BuckySiteVersion.pagina")

    @property
    def pad(self):
        return urlsplit(self.page.url).path

    def sluit(self):
        self.ctx.close()


def stand(versie):
    return {"features": {"wordle": True}, "homepage": {"version": versie}}


@pytest.fixture
def opstelling(browser, server):
    gemaakt = []

    def maak(antwoord, **kw):
        o = Opstelling(browser, server, antwoord, **kw)
        gemaakt.append(o)
        return o

    yield maak
    for o in gemaakt:
        o.sluit()


# --------------------------------------------------------------------------- #
# De config bepaalt
# --------------------------------------------------------------------------- #
def test_standaard_is_v1(opstelling):
    o = opstelling(stand("v1")).open("/")
    assert o.versie == "v1"
    assert o.pad == "/"
    assert o.page.locator("section.hero h1").count() == 1      # de echte v1


def test_config_op_v2_toont_v2(opstelling):
    o = opstelling(stand("v2")).open("/")
    assert o.versie == "v2"
    assert o.pad == "/v2/"


def test_een_hash_en_query_gaan_mee_naar_de_andere_versie(opstelling):
    o = opstelling(stand("v2")).open("/?utm=x#security")
    assert o.pad == "/v2/"
    assert o.page.url.endswith("?utm=x#security")


@pytest.mark.parametrize("waarde", ["v3", "V2", "", None, 2])
def test_een_ongeldige_waarde_valt_terug_op_v1(opstelling, waarde):
    o = opstelling({"features": {}, "homepage": {"version": waarde}}).open("/")
    assert o.versie == "v1"


def test_een_backend_van_voor_deze_ronde_geeft_v1(opstelling):
    """Zonder `homepage` in het antwoord (backend nog niet herstart): v1."""
    o = opstelling({"features": {"wordle": True}}).open("/")
    assert o.versie == "v1"


def test_v2_rechtstreeks_openen_gaat_terug_naar_v1_als_de_config_v1_is(opstelling):
    """v2 staat niet live zolang de eigenaar niet omschakelt, ook niet voor
    wie het adres kent. Alleen een preview mag erbij."""
    o = opstelling(stand("v1")).open("/v2/")
    assert o.versie == "v1"
    assert o.pad == "/"


# --------------------------------------------------------------------------- #
# De preview
# --------------------------------------------------------------------------- #
def test_preview_v2_ongeacht_de_config(opstelling):
    o = opstelling(stand("v1")).open("/?site=v2")
    assert o.versie == "v2"
    # Het blijft v2 in hetzelfde tabblad, ook zonder de parameter...
    o.open("/")
    assert o.versie == "v2"


def test_de_preview_geldt_alleen_voor_dat_tabblad(opstelling):
    a = opstelling(stand("v1")).open("/?site=v2")
    assert a.versie == "v2"
    b = opstelling(stand("v1")).open("/")          # een andere bezoeker
    assert b.versie == "v1"


def test_preview_v1_terwijl_v2_live_staat(opstelling):
    o = opstelling(stand("v2")).open("/?site=v1")
    assert o.versie == "v1"
    o.open("/v2/")
    assert o.versie == "v1"


def test_site_live_haalt_de_preview_weg(opstelling):
    o = opstelling(stand("v1")).open("/?site=v2")
    assert o.versie == "v2"
    o.open("/?site=live")
    assert o.versie == "v1"
    o.open("/")
    assert o.versie == "v1"


def test_de_preview_verandert_niets_aan_de_opgeslagen_keuze(opstelling):
    """Een tester die v2 bekijkt, krijgt na het sluiten van het tabblad gewoon
    weer wat het publiek krijgt: de preview staat niet in localStorage."""
    o = opstelling(stand("v1")).open("/?site=v2")
    opgeslagen = o.page.evaluate("() => localStorage.getItem('bucky.site.version')")
    assert opgeslagen is None or json.loads(opgeslagen)["v"] == "v1"


# --------------------------------------------------------------------------- #
# De backend faalt
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("antwoord", ["afbreken", 500, 503])
def test_een_falende_backend_geeft_v1_en_een_zichtbare_pagina(opstelling, antwoord):
    begin = time.monotonic()
    o = opstelling(antwoord).open("/")
    assert o.versie == "v1"
    assert time.monotonic() - begin < 5


def test_een_hangende_backend_houdt_de_pagina_niet_op(opstelling):
    """Hooguit WACHT_MS (1,2 s) leeg, dan v1 - ook als het antwoord nooit komt."""
    o = opstelling(("traag", 4, stand("v2")))
    begin = time.monotonic()
    o.open("/")
    assert o.versie == "v1"
    assert time.monotonic() - begin < 3.5


def test_een_falende_backend_valt_terug_op_de_laatst_bekende(opstelling):
    oud = json.dumps({"v": "v2", "at": int(time.time() * 1000) - 60 * 60 * 1000})
    o = opstelling("afbreken", opslag={"bucky.site.version": oud}).open("/")
    assert o.versie == "v2"


def test_kapotte_opslag_geeft_geen_kapot_scherm(opstelling):
    o = opstelling(stand("v1"), opslag={"bucky.site.version": "{niet: json"}).open("/")
    assert o.versie == "v1"


# --------------------------------------------------------------------------- #
# Geen flits, en geen onnodig verzoek
# --------------------------------------------------------------------------- #
def test_bij_een_wissel_wordt_v1_geen_frame_zichtbaar_getekend(opstelling):
    """DE KERN VAN "GEEN LELIJKE FLITS".

    De backend antwoordt traag (0,6 s) met v2. In die tijd tekent de browser
    frames van index.html; geen daarvan mag zichtbaar zijn. Daarna staat v2 er.
    """
    o = opstelling(("traag", 0.6, stand("v2")), frames=True).open("/")
    assert o.versie == "v2"
    spoor = o.page.evaluate("() => JSON.parse(sessionStorage.getItem('__frames') || '[]')")
    v1_frames = [f for f in spoor if f[0] in ("/", "/index.html")]
    assert v1_frames, "het spoor zag de eerste pagina niet - dan bewijst deze test niets"
    zichtbaar = [f for f in v1_frames if f[1] != "hidden" and f[2]]
    assert zichtbaar == [], f"v1 werd zichtbaar getekend: {zichtbaar[:5]}"


def test_het_spoor_ziet_een_flits_als_die_er_is(opstelling):
    """De test hierboven kan alleen groen zijn als hij een flits ZOU zien.

    Zonder schakelaar-besluit (config v1) blijft index.html staan en wordt hij
    dus zichtbaar getekend: dat moet het spoor vastleggen.
    """
    o = opstelling(stand("v1"), frames=True).open("/")
    o.page.wait_for_timeout(300)
    spoor = o.page.evaluate("() => JSON.parse(sessionStorage.getItem('__frames') || '[]')")
    assert any(f[0] == "/" and f[1] == "visible" and f[2] for f in spoor)


def test_een_verse_keuze_kost_geen_verzoek_en_geen_wachttijd(opstelling):
    vers = json.dumps({"v": "v2", "at": int(time.time() * 1000)})
    o = opstelling(stand("v1"), opslag={"bucky.site.version": vers}).open("/")
    assert o.versie == "v2"
    assert o.verzoeken == []


def test_een_oude_keuze_wordt_meteen_gebruikt_en_op_de_achtergrond_ververst(opstelling):
    oud = json.dumps({"v": "v1", "at": int(time.time() * 1000) - 60 * 60 * 1000})
    o = opstelling(stand("v2"), opslag={"bucky.site.version": oud}).open("/")
    assert o.versie == "v1"                         # nu nog de oude, zonder wachten
    o.page.wait_for_function(
        "() => JSON.parse(localStorage.getItem('bucky.site.version')).v === 'v2'", timeout=4000)
    o.open("/")
    assert o.versie == "v2"                         # het volgende bezoek de nieuwe


def test_een_eerste_bezoek_slaat_de_keuze_op(opstelling):
    o = opstelling(stand("v1")).open("/")
    opgeslagen = json.loads(o.page.evaluate("() => localStorage.getItem('bucky.site.version')"))
    assert opgeslagen["v"] == "v1"


# --------------------------------------------------------------------------- #
# Het besluit los, en de twee bestanden die het moeten dragen
# --------------------------------------------------------------------------- #
def test_het_besluit_zonder_browserstaat(opstelling):
    o = opstelling(stand("v1")).open("/")
    uit = o.page.evaluate("""() => {
      const k = window.BuckySiteVersion.kies, nu = 1e12;
      return {
        query:     k({query: "V2", preview: null, cache: null, nu}),
        live:      k({query: "live", preview: "v2", cache: {v: "v2", at: nu}, nu}),
        onzin:     k({query: "v9", preview: "v7", cache: null, nu}),
        vers:      k({query: null, preview: null, cache: {v: "v2", at: nu - 1000}, nu}),
        oud:       k({query: null, preview: null, cache: {v: "v2", at: nu - 11 * 60 * 1000}, nu}),
        toekomst:  k({query: null, preview: null, cache: {v: "v2", at: nu + 5000}, nu}),
      };
    }""")
    assert uit["query"]["versie"] == "v2" and uit["query"]["preview"] == "v2"
    assert uit["live"]["versie"] == "v2" and uit["live"]["bron"] == "cache"
    assert uit["live"]["preview"] == ""
    assert uit["onzin"]["versie"] is None and uit["onzin"]["ophalen"] == "wachten"
    assert uit["vers"]["ophalen"] == "nee"
    assert uit["oud"]["ophalen"] == "achtergrond"
    # Een klok die terugsprong maakt een keuze niet eeuwig vers.
    assert uit["toekomst"]["ophalen"] == "achtergrond"


def test_de_api_url_is_dezelfde_als_in_config_js():
    schakelaar = (SITE / "js" / "site-version.js").read_text(encoding="utf-8")
    config = (SITE / "js" / "config.js").read_text(encoding="utf-8")
    a = re.search(r'var API_URL = "([^"]+)"', schakelaar).group(1)
    b = re.search(r'const API_URL = "([^"]+)"', config).group(1)
    assert a == b


def test_beide_voorpaginas_laden_de_schakelaar_als_eerste_script():
    """Na de CSP en vóór elk ander script of stylesheet: anders tekent de
    browser al iets voordat de keuze er is."""
    for pad, naam, src in ((SITE / "index.html", "v1", "js/site-version.js"),
                           (SITE / "v2" / "index.html", "v2", "../js/site-version.js")):
        tekst = pad.read_text(encoding="utf-8")
        kop = tekst.split("</head>")[0]
        eerste = re.search(r"<(script|link)\b[^>]*>", kop.split("Content-Security-Policy")[1])
        assert eerste and f'src="{src}"' in eerste.group(0), (pad.name, eerste and eerste.group(0))
        assert f'data-page="{naam}"' in eerste.group(0)
        assert "async" not in eerste.group(0) and "defer" not in eerste.group(0)
        assert 'type="module"' not in eerste.group(0)
