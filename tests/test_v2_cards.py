"""De kaarteditor van v2 (stap 9, 11-11-2026): site/v2/cards.html, js/cards.js, css/cards.css.

DE PAGINA STAAT ACHTER DE VLAG `kaart_editor` (standaard uit) en NIET in de navigatie (dat is de activatieronde). Hier draait
alles tegen een NEP-API: Playwright onderschept elk verzoek naar api.buckybot.app, er is geen echte vlag of bot.

Dekt: de toestanden (laden, niet ingelogd, geen Discord, vlag uit, geen profiel, fout met opnieuw proberen, rate limit met
wachttijd), de preview met de eigen cijfers als tekst, kiezen en wissen, een gratis item claimen, een 504 gevolgd door een
nieuwe staatlezing, een 401 midden in opslaan, dubbel klikken, hoogstens een preview tegelijk, een vijandige naam of tekst die
als tekst op de pagina komt, een URL van een vreemde host die niet laadt, 360 en 390 px zonder horizontale scroll, licht en
donker, reduced motion, het toetsenbord en de CSP.

DRAAIEN:  python -m pytest tests/test_v2_cards.py"""
from __future__ import annotations

import base64
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
PAGINA = SITE / "v2" / "cards.html"
JS = SITE / "v2" / "js" / "cards.js"
CSS = SITE / "v2" / "css" / "cards.css"
HASH = "ab" * 20
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")


# --------------------------------------------------------------------------- #
# Statisch: de bron
# --------------------------------------------------------------------------- #
def test_de_csp_staat_img_van_de_api_en_discord_toe_en_verder_niets_nieuws():
    html = PAGINA.read_text(encoding="utf-8")
    csp = re.search(r'http-equiv="Content-Security-Policy" content="([^"]*)"', html).group(1)
    assert "img-src 'self' https://cdn.discordapp.com https://api.buckybot.app" in csp
    assert "connect-src 'self' https://api.buckybot.app" in csp and "default-src 'none'" in csp
    assert "unsafe" not in csp and "script-src 'self'" in csp and "style-src 'self'" in csp


def test_geen_innerhtml_geen_inline_en_geen_em_dash_in_de_pagina():
    js = JS.read_text(encoding="utf-8") + (SITE / "js" / "kaart-opbouw.js").read_text(encoding="utf-8")         + (SITE / "js" / "kaart-ingang.js").read_text(encoding="utf-8")
    code = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
    code = re.sub(r"(?m)^\s*//.*$", "", code)
    for verboden in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", 'setAttribute("on',
                     "setAttribute('on", "javascript:", "setAttribute(\"style\"", "setAttribute('style'"):
        assert verboden not in code, verboden
    html = PAGINA.read_text(encoding="utf-8")
    assert not re.search(r"<script(?![^>]*\bsrc=)", html) and "<style" not in html and not re.search(r'\sstyle="', html)
    assert not re.search(r"\son[a-z]+=", html)
    for pad in (PAGINA, JS, CSS, SITE / "js" / "kaart-opbouw.js", SITE / "js" / "kaart-ingang.js"):
        for n, regel in enumerate(pad.read_text(encoding="utf-8").splitlines(), 1):
            if "—" in regel:
                assert regel.strip().startswith(("//", "/*", "*", "<!--", "-->")) or "<!--" in regel, (pad.name, n)


def test_de_pagina_staat_alleen_als_verborgen_ingang_in_de_navigatie():
    """Sinds de ingangen (11-11-2026): "My cards" staat in het menu van het account-bolletje, maar als `data-kaart-ingang hidden`:
    zichtbaar pas als /api/site/features `kaart_editor: true` meldt (site/tests/test_kaart_ingangen.py). Nergens een gewone link."""
    for p in (SITE / "v2").glob("*.html"):
        html = p.read_text(encoding="utf-8")
        for m in re.finditer(r'<a [^>]*href="cards\.html"[^>]*>', html):
            omgeving = html[max(0, m.start() - 80):m.end()]            # het <li> ervoor of de <a> zelf draagt de markering
            assert "data-kaart-ingang" in omgeving and "hidden" in omgeving, (p.name, omgeving)
        assert not re.search(r'<li><a href="cards\.html"', html), p.name
    for p in SITE.glob("*.html"):
        assert "v2/cards.html" not in p.read_text(encoding="utf-8") or p.name == "dashboard.html", p.name


def test_nav_en_footer_zijn_die_van_de_voorpagina():
    from test_v2_legal import _blok
    index = (SITE / "v2" / "index.html").read_text(encoding="utf-8")
    pagina = PAGINA.read_text(encoding="utf-8")
    for begin, eind in (('<header class="nav"', "</header>"), ('<footer class="foot">', "</footer>")):
        assert _blok(pagina, begin, eind) == _blok(index, begin, eind), begin
    nav = pagina[pagina.index('<header class="nav"'):pagina.index("</header>")]
    assert 'class="nav-links"' in nav
    hoofdmenu = nav[nav.index('<ul class="nav-links">'):nav.index("</ul>", nav.index('<ul class="nav-links">'))]
    assert "cards" not in hoofdmenu.lower(), "de hoofdnavigatie is ongewijzigd: de ingang zit in het account-menu"


def test_de_pagina_noemt_geen_google_fonts_en_heeft_een_thema_script_voor_de_stylesheets():
    html = PAGINA.read_text(encoding="utf-8")
    assert "fonts.googleapis" not in html and "fonts.gstatic" not in html
    assert html.index("../js/thema.js") < html.index("css/v2.css")


def test_de_veilige_url_regel_staat_in_de_code():
    js = (SITE / "js" / "kaart-opbouw.js").read_text(encoding="utf-8")
    assert 'u.protocol !== "https:"' in js and "u.host !== API_HOST" in js and "/kaart/plaat/" in js
    assert r"\/api\/v1\/me\/kaart\/preview\/[0-9a-f]{40}" in js


# --------------------------------------------------------------------------- #
# De nep-API
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


def plaat(naam="a", beweegt=False, stil=False):
    h = (naam * 40)[:40]
    return {"url": f"{API}/kaart/plaat/{h}.webp", "beweegt": beweegt,
            "stil": f"{API}/kaart/plaat/{('s' + h)[:40].replace('s', 'c')}.webp" if stil else None}


def item(iid, naam, cat, kaarten, prijs=("gratis", 0), tier=None, staal=True, kleur=None, beweegt=False):
    return {"id": iid, "naam": naam, "categorie": cat, "kaarten": kaarten, "type": "geanimeerd" if beweegt else "statisch",
            "animatie": "glans" if beweegt else "geen", "prijs": {"soort": prijs[0], "bedrag": prijs[1]}, "tier": tier, "kleur": kleur,
            "staal": ({"stil": plaat(iid[:1] or "x", stil=False)["url"], "beweegt": plaat(iid[:1], True)["url"] if beweegt else None}
                      if staal else None)}


def catalogus_basis():
    P, S, B = ["profiel"], ["saldo"], ["bank"]
    items = [
        item("banner_standaard", "Default banner", "banner", P, staal=False),
        item("banner_circuit", "Circuit", "banner", P),
        item("banner_gratis", "Free Wave", "banner", P),
        item("banner_betaald", "Neon Sunset", "banner", P, prijs=("shards", 4_000_000)),
        item("banner_tier", "Gold Vault", "banner", P, tier="Elite"),
        item("banner_level", "Veteran", "banner", P, prijs=("level", 30)),
        item("banner_beweegt", "Moving Grid", "banner", P, beweegt=True),
        item("divider_standaard", "Default divider", "divider", ["profiel", "saldo"], staal=False),
        item("titelachtergrond_standaard", "Default plaque", "titelachtergrond", P, staal=False),
        item("titelkader_standaard", "Default frame", "titelkader", P, staal=False),
        item("avatar_standaard", "Default avatar", "avatar", P, staal=False),
        item("kaartthema_standaard", "Bucky Red", "kaartthema", ["profiel", "saldo", "bank"], staal=False,
             kleur={"accent": "#F35168"}),
        item("kaartthema_blauw", "Deep Blue", "kaartthema", ["profiel", "saldo", "bank"], staal=False,
             kleur={"accent": "#3366FF", "rand": "#112244"}),
        item("rand_standaard", "Default border", "rand", ["profiel", "saldo", "bank"], staal=False,
             kleur={"rand": "#34343B", "stijl": "effen", "dikte": 2}),
        item("rand_goud", "Gold Border", "rand", ["profiel", "saldo", "bank"], staal=False,
             kleur={"rand": "#D4AF37", "stijl": "dubbel", "dikte": 4}),
        item("bankbanner_standaard", "Default bank banner", "bankbanner", S, staal=False),
        item("bankkaart_standaard", "Default skin", "bankkaart", B, staal=False),
        item("bankkaart_goud", "Brushed Gold", "bankkaart", B, prijs=("shards", 5_000_000)),
    ]
    return {"versie": "3f2a3f2a3f2a3f2a",
            "kaarten": {"profiel": ["kaartthema", "banner", "rand", "titelachtergrond", "titelkader", "avatar", "divider"],
                        "saldo": ["kaartthema", "bankbanner", "rand", "divider"], "bank": ["kaartthema", "bankkaart", "rand"]},
            "items": items}


def staat_basis(gekozen=None):
    gekozen = gekozen or {}
    per = {k: {"gekozen": gekozen.get(k, {}), "getoond": {c: v for c, v in gekozen.get(k, {}).items()}, "ongeldig": []}
           for k in ("profiel", "saldo", "bank")}
    return {"versie": "3f2a3f2a3f2a3f2a", "bank_modus": "tekst", "per_kaart": per, "level": 27, "verborgen_bezit": [],
            "items": {"banner_standaard": "free", "banner_circuit": "owned", "banner_gratis": "claimable", "banner_betaald": "for_sale",
                      "banner_tier": "locked_tier", "banner_level": "locked_level", "banner_beweegt": "owned",
                      "divider_standaard": "free", "titelachtergrond_standaard": "free", "titelkader_standaard": "free",
                      "avatar_standaard": "free", "kaartthema_standaard": "free", "kaartthema_blauw": "owned",
                      "rand_standaard": "free", "rand_goud": "owned", "bankbanner_standaard": "free",
                      "bankkaart_standaard": "free", "bankkaart_goud": "for_sale"}}


def preview_basis(opbouw=None, **platen):
    alle = {n: None for n in ("banner", "divider", "embleem", "plaquette", "bank", "tegels", "profiel", "blokken")}
    alle.update(platen)
    uit = {"accent": "#F35168", "rand": None, "platen": alle, "tekst": {"bank_regels": True}}
    if opbouw is not None:
        uit["opbouw"] = opbouw
    return uit


SPELER = {"available": True, "item": {"level": 27, "xp_into_level": 400, "xp_to_next_level": 1000, "equipped_title": "Vault Breaker",
                                      "coins": 1_234_567, "bank": 89_000}}
GEBRUIKER = {"id": "80351110224678912", "username": "tester", "global_name": "Tommy", "avatar": None}


def ok(data):
    return 200, {"ok": True, "data": data}


def fout(status, code, bericht="x", **extra):
    return status, {"ok": False, "error": {"code": code, "message": bericht}, **extra}


UIT = (503, {"error": "This part of the site is switched off right now.", "feature": "kaart_editor"})


class NepApi:
    """Alles achter api.buckybot.app. `antwoorden[(methode, pad)]` is een (status, body)-paar of een functie die er een geeft;
    `"wacht"` houdt het verzoek vast tot de test `vrij()` aanroept. Elke aanroep komt in `calls`."""

    def __init__(self):
        self.catalogus = catalogus_basis()
        self.staat = staat_basis()
        self.preview = preview_basis()
        self.antwoorden = {}
        self.calls, self.extern, self.plaatverzoeken, self.vast = [], [], [], []
        self.logins = []
        self.ingelogd = True
        self.gebruiker = dict(GEBRUIKER)
        self.speler = SPELER

    def standaard(self, methode, pad, body):
        if pad == "/api/v1/kaart/catalogus":
            return ok(self.catalogus)
        if pad == "/api/v1/me/kaart":
            return ok(self.staat)
        if pad == "/api/v1/me/kaart/preview":
            return ok(self.preview)
        if pad == "/api/v1/me/kaart/keuze":
            return ok({"geclaimd": False, "kaart": body.get("kaart"), "item": {"id": body.get("item_id"), "status": "owned"},
                       "per_kaart": {"gekozen": {}, "getoond": {}, "ongeldig": []}})
        if pad == "/api/player/me":
            return 200, self.speler
        if pad == "/api/me":
            return (200, {"logged_in": True, "user": self.gebruiker, "guilds": []}) if self.ingelogd else (401, {"logged_in": False})
        if pad == "/api/site/features":
            return 200, {"features": {}, "site": {"version": "v2"}}
        return 200, {}

    def aantal(self, methode, pad):
        return len([c for c in self.calls if c["methode"] == methode and c["pad"] == pad])

    def bodies(self, methode, pad):
        return [c["body"] for c in self.calls if c["methode"] == methode and c["pad"] == pad]


class Tab:
    def __init__(self, browser, server, api, breedte=1280, hoogte=900, reduced="reduce", schema="light"):
        self.server, self.api = server, api
        self.ctx = browser.new_context(viewport={"width": breedte, "height": hoogte}, reduced_motion=reduced, color_scheme=schema)
        self.page = self.ctx.new_page()
        self.violations = []
        self.page.add_init_script("""
          window.__csp = [];
          document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
        """)
        self.page.route("**/*", self._buiten)
        self.page.route(f"{API}/**", self._api)

    def _buiten(self, route):
        host = urlsplit(route.request.url).hostname
        if host == "127.0.0.1":
            route.continue_()
        elif host == "cdn.discordapp.com":
            route.fulfill(status=200, content_type="image/png", body=PNG)
        else:
            self.api.extern.append(route.request.url)
            route.abort()

    def _api(self, route):
        req = route.request
        deel = urlsplit(req.url)
        kop = {"Access-Control-Allow-Origin": req.headers.get("origin", "*"), "Access-Control-Allow-Credentials": "true"}
        if req.method == "OPTIONS":
            route.fulfill(status=204, headers={**kop, "Access-Control-Allow-Methods": "GET, POST",
                                               "Access-Control-Allow-Headers": "Content-Type, Accept"})
            return
        if deel.path.startswith(("/kaart/plaat/",)) or deel.path.startswith("/api/v1/me/kaart/preview/"):
            self.api.plaatverzoeken.append(req.url)
            route.fulfill(status=200, content_type="image/png", body=PNG, headers=kop)
            return
        if deel.path == "/login":
            self.api.logins.append(parse_qs(deel.query).get("redirect", [None])[0])
            route.fulfill(status=200, content_type="text/html", body="<!doctype html><title>login</title>")
            return
        try:
            body = json.loads(req.post_data) if req.post_data else {}
        except ValueError:
            body = {"__ruw": req.post_data}
        self.api.calls.append({"methode": req.method, "pad": deel.path, "body": body, "headers": dict(req.headers)})
        gekozen = self.api.antwoorden.get((req.method, deel.path))
        if callable(gekozen):
            gekozen = gekozen(body)
        if gekozen == "wacht":
            self.api.vast.append((route, kop))
            return
        if gekozen == "netwerk":
            route.abort()
            return
        status, antwoord = gekozen if gekozen else self.api.standaard(req.method, deel.path, body)
        route.fulfill(status=status, content_type="application/json", body=json.dumps(antwoord), headers=kop)

    def vrij(self, status=200, antwoord=None, n=0):
        route, kop = self.api.vast.pop(n)
        route.fulfill(status=status, content_type="application/json", body=json.dumps(antwoord if antwoord is not None else {}),
                      headers=kop)

    def open(self, pad="/v2/cards.html", staat="editor"):
        self.page.goto(f"{self.server}{pad}", wait_until="commit")
        self.wacht_staat(staat)
        return self

    def wacht_staat(self, staat, timeout=8000):
        self.page.wait_for_function("(s) => document.documentElement.dataset.kcToestand === s", arg=staat, timeout=timeout)

    def sluit(self):
        self.ctx.close()


@pytest.fixture
def tab(browser, server):
    open_ = []

    def maak(api=None, **kw):
        api = api or NepApi()
        t = Tab(browser, server, api, **kw)
        open_.append(t)
        return t

    yield maak
    for t in open_:
        t.sluit()


def tekst(t):
    return t.page.locator("main").inner_text()


def tegel(t, iid):
    return t.page.locator(f'[data-kc-item="{iid}"]')


def wacht_op(t, voorwaarde_js, arg=None, timeout=6000):
    t.page.wait_for_function(voorwaarde_js, arg=arg, timeout=timeout)


# --------------------------------------------------------------------------- #
# 1. De toestanden
# --------------------------------------------------------------------------- #
def test_laden_en_dan_de_editor_met_de_eerst_gelezen_staat(tab):
    api = NepApi()
    api.antwoorden[("GET", "/api/v1/me/kaart")] = "wacht"
    t = tab(api)
    t.page.goto(f"{t.server}/v2/cards.html", wait_until="commit")
    t.wacht_staat("laden")
    assert "Loading your cards" in tekst(t)
    wacht_op(t, "() => true")
    assert api.aantal("POST", "/api/v1/me/kaart/preview") == 0, "geen preview voor de staat er is"
    t.vrij(200, {"ok": True, "data": staat_basis()})
    t.wacht_staat("editor")
    wacht_op(t, "() => document.querySelector('[data-kc-pod] .kc-pod-naam')")
    volgorde = [(c["methode"], c["pad"]) for c in api.calls]
    assert volgorde.index(("GET", "/api/v1/me/kaart")) < volgorde.index(("POST", "/api/v1/me/kaart/preview"))


def test_niet_ingelogd_geeft_uitleg_en_een_inlogknop_die_terugkeert_naar_de_pagina(tab):
    api = NepApi()
    api.antwoorden[("GET", "/api/v1/me/kaart")] = fout(401, "not_signed_in", "Unauthorized")
    t = tab(api).open(staat="login")
    assert "Log in to edit your cards" in tekst(t)
    href = t.page.locator("[data-kc-login]").get_attribute("href")
    assert href == f"{API}/login?redirect=v2%2Fcards.html"
    t.page.locator("[data-kc-login]").click()
    t.page.wait_for_function("() => true")
    assert api.logins == ["v2/cards.html"]


@pytest.mark.parametrize("antwoord,staat,tekst_",
                         [(fout(400, "no_discord"), "nodiscord", "no Discord account"),
                          (fout(404, "no_profile"), "geenprofiel", "Play once in Discord first"),
                          (UIT, "uit", "switched off right now")])
def test_geen_discord_geen_profiel_en_vlag_uit_geven_een_nette_uitleg(tab, antwoord, staat, tekst_):
    api = NepApi()
    api.antwoorden[("GET", "/api/v1/me/kaart")] = antwoord
    t = tab(api).open(staat=staat)
    assert tekst_ in tekst(t)
    assert t.page.locator("[data-kc-editor]").is_hidden()
    assert "Traceback" not in tekst(t) and "undefined" not in tekst(t) and "[object" not in tekst(t)


def test_een_vlag_uit_op_de_catalogus_geeft_dezelfde_rustige_melding(tab):
    api = NepApi()
    api.antwoorden[("GET", "/api/v1/kaart/catalogus")] = UIT
    t = tab(api).open(staat="uit")
    assert "switched off right now" in tekst(t)


def test_een_fout_geeft_opnieuw_proberen_dat_werkt(tab):
    api = NepApi()
    api.antwoorden[("GET", "/api/v1/me/kaart")] = fout(503, "bot_unavailable")
    t = tab(api).open(staat="fout")
    assert "paused while Bucky restarts" in tekst(t)
    api.antwoorden.pop(("GET", "/api/v1/me/kaart"))
    t.page.locator("[data-kc-opnieuw]").click()
    t.wacht_staat("editor")


def test_een_weggevallen_verbinding_geeft_een_fout_en_geen_kapotte_pagina(tab):
    api = NepApi()
    api.antwoorden[("GET", "/api/v1/me/kaart")] = "netwerk"
    t = tab(api).open(staat="fout")
    assert "could not reach Bucky" in tekst(t)


def test_rate_limited_toont_de_wachttijd_en_zet_de_knop_pas_daarna_aan(tab):
    api = NepApi()
    api.antwoorden[("GET", "/api/v1/me/kaart")] = fout(429, "rate_limited", "Slow down", retry_after=2)
    t = tab(api).open(staat="wacht")
    assert t.page.locator("[data-kc-wacht]").inner_text() in ("2", "1")
    assert t.page.locator("[data-kc-wacht-opnieuw]").is_disabled()
    api.antwoorden.pop(("GET", "/api/v1/me/kaart"))
    wacht_op(t, "() => !document.querySelector('[data-kc-wacht-opnieuw]').disabled", timeout=5000)
    t.page.locator("[data-kc-wacht-opnieuw]").click()
    t.wacht_staat("editor")


# --------------------------------------------------------------------------- #
# 2. De editor, de preview en het raster
# --------------------------------------------------------------------------- #
def test_de_preview_toont_je_eigen_cijfers_ook_als_tekst(tab):
    t = tab().open()
    wacht_op(t, "() => document.querySelector('[data-kc-pod]').innerText.includes('1,234,567')")
    pod = t.page.locator("[data-kc-pod]").inner_text()
    for verwacht in ("Tommy", "Level", "27", "Vault Breaker", "1,234,567", "89,000", "400 / 1,000 XP"):
        assert verwacht in pod, verwacht
    assert t.page.locator(".kc-xp-spoor").get_attribute("aria-label") == "40 percent to the next level"


def test_de_platen_van_de_bot_komen_in_de_preview_en_persoonlijke_platen_krijgen_de_api_basis(tab):
    api = NepApi()
    api.preview = preview_basis(banner=plaat("b"), embleem={"url": f"/api/v1/me/kaart/preview/{HASH}", "beweegt": False},
                                divider=plaat("d"))
    t = tab(api).open()
    wacht_op(t, "() => document.querySelectorAll('[data-kc-pod] img').length >= 3")
    srcs = t.page.eval_on_selector_all("[data-kc-pod] img", "els => els.map(e => e.src)")
    assert f"{API}/kaart/plaat/{'b' * 40}.webp" in srcs and f"{API}/api/v1/me/kaart/preview/{HASH}" in srcs
    assert all(s.startswith("https://api.buckybot.app/") for s in srcs)
    for img in t.page.locator("[data-kc-pod] img").all():
        assert (img.get_attribute("alt") or "").strip(), "elke plaat heeft een alt"


def test_de_categorieen_en_het_raster_met_namen_en_statussen_als_tekst(tab):
    t = tab().open()
    chips = t.page.locator("[data-kc-cat]").all_inner_texts()
    assert chips == ["Banner", "Divider", "Title plaque", "Avatar frame", "Avatar", "Card theme", "Border"]
    labels = {i: tegel(t, i).get_attribute("aria-label") for i in ("banner_circuit", "banner_gratis", "banner_betaald",
                                                                   "banner_tier", "banner_level", "banner_standaard")}
    assert "Owned" in labels["banner_circuit"] and "Free to claim" in labels["banner_gratis"]
    assert "4,000,000 shards" in labels["banner_betaald"] and "Needs Elite" in labels["banner_tier"]
    assert "Level 30" in labels["banner_level"] and labels["banner_standaard"].startswith("Back to free")
    assert t.page.locator('[role="radiogroup"] [role="radio"]').count() == 7


def test_het_balance_tabblad_heeft_de_bankskin_en_toont_de_bankmodus_alleen(tab):
    api = NepApi()
    api.staat["bank_modus"] = "tegels"
    t = tab(api).open()
    t.page.locator('[data-kc-tab="saldo"]').click()
    chips = t.page.locator("[data-kc-cat]").all_inner_texts()
    assert chips == ["Banner", "Divider", "Card theme", "Border", "Bank card skin"]
    t.page.locator('[data-kc-cat="bankkaart"]').click()
    wacht_op(t, "() => document.querySelector('[data-kc-modus]').textContent.includes('tiles')")
    assert "Change that in Discord with +cardstyle" in t.page.locator("[data-kc-modus]").inner_text()
    assert t.page.locator("[data-kc-modus] button, [data-kc-modus] select, [data-kc-modus] input").count() == 0
    t.page.wait_for_timeout(900)
    assert api.bodies("POST", "/api/v1/me/kaart/preview")[-1]["kaart"] == "bank"


def test_een_verborgen_item_dat_je_bezit_staat_in_het_raster_als_owned(tab):
    api = NepApi()
    api.staat["verborgen_bezit"] = [item("banner_oud", "Old Legend", "banner", ["profiel"])]
    t = tab(api).open()
    assert "Owned" in tegel(t, "banner_oud").get_attribute("aria-label")


def test_een_keuze_die_niet_getoond_wordt_krijgt_een_melding(tab):
    api = NepApi()
    api.staat["per_kaart"]["profiel"]["gekozen"] = {"banner": "banner_tier"}
    api.staat["per_kaart"]["profiel"]["getoond"] = {"banner": "banner_standaard"}
    t = tab(api).open()
    assert "Saved, but not shown right now. Shown again when your Elite tier is active." in t.page.locator("[data-kc-gekozen]").inner_text()


# --------------------------------------------------------------------------- #
# 3. Kiezen, wissen, claimen
# --------------------------------------------------------------------------- #
def test_een_betaald_of_vergrendeld_item_toont_geen_equip_maar_de_reden(tab):
    t = tab().open()
    equip = t.page.locator("[data-kc-equip]")
    for iid, stuk in (("banner_betaald", "Buy that one in Discord with +cardstyle."), ("banner_tier", "premium tier"),
                      ("banner_level", "Your level is too low")):
        tegel(t, iid).click()
        assert equip.is_hidden(), iid
        assert stuk in t.page.locator("[data-kc-actie-tekst]").inner_text(), iid
    assert t.page.locator("button", has_text="Buy").count() == 0, "er is geen koopknop"


def test_een_bezeten_item_equippen_slaat_op_leest_de_staat_en_vraagt_een_nieuwe_preview(tab):
    api = NepApi()

    def keuze(body):
        api.staat["per_kaart"]["profiel"]["gekozen"] = {"banner": "banner_circuit"}
        api.staat["per_kaart"]["profiel"]["getoond"] = {"banner": "banner_circuit"}
        return ok({"geclaimd": False, "kaart": "profiel", "item": {"id": "banner_circuit", "status": "owned"}})

    api.antwoorden[("POST", "/api/v1/me/kaart/keuze")] = keuze
    t = tab(api).open()
    wacht_op(t, "() => document.querySelector('[data-kc-pod] .kc-pod-naam')")
    tegel(t, "banner_circuit").click()
    n_preview = api.aantal("POST", "/api/v1/me/kaart/preview")
    t.page.locator("[data-kc-equip]").click()
    wacht_op(t, "() => document.querySelector('[data-kc-melding]').textContent.includes('Equipped')")
    assert "Equipped Circuit on your profile card." in t.page.locator("[data-kc-melding]").inner_text()
    assert api.bodies("POST", "/api/v1/me/kaart/keuze") == [{"kaart": "profiel", "item_id": "banner_circuit"}]
    post = [c for c in api.calls if c["pad"] == "/api/v1/me/kaart/keuze"][0]
    assert post["headers"]["content-type"] == "application/json"
    assert api.aantal("GET", "/api/v1/me/kaart") == 2, "de staat is na het opslaan opnieuw gelezen"
    wacht_op(t, "(n) => true", n_preview)
    t.page.wait_for_timeout(600)
    assert api.aantal("POST", "/api/v1/me/kaart/preview") > n_preview, "na de keuze een nieuwe preview"
    assert "Equipped" in tegel(t, "banner_circuit").get_attribute("aria-label")


def test_een_gratis_item_claimen_zegt_dat_het_geclaimd_en_gekozen_is(tab):
    api = NepApi()

    def keuze(body):
        api.staat["items"]["banner_gratis"] = "owned"
        api.staat["per_kaart"]["profiel"]["gekozen"] = {"banner": "banner_gratis"}
        api.staat["per_kaart"]["profiel"]["getoond"] = {"banner": "banner_gratis"}
        return ok({"geclaimd": True, "kaart": "profiel", "item": {"id": "banner_gratis", "status": "owned"}})

    api.antwoorden[("POST", "/api/v1/me/kaart/keuze")] = keuze
    t = tab(api).open()
    tegel(t, "banner_gratis").click()
    assert "Equip adds it to your cards" in t.page.locator("[data-kc-actie-tekst]").inner_text()
    t.page.locator("[data-kc-equip]").click()
    wacht_op(t, "() => document.querySelector('[data-kc-melding]').textContent.includes('Claimed')")
    assert "Claimed and equipped Free Wave" in t.page.locator("[data-kc-melding]").inner_text()
    assert "Owned" in tegel(t, "banner_gratis").get_attribute("aria-label")


def test_back_to_free_wist_de_keuze_met_het_standaarditem(tab):
    api = NepApi()
    api.staat["per_kaart"]["profiel"]["gekozen"] = {"banner": "banner_circuit"}
    api.staat["per_kaart"]["profiel"]["getoond"] = {"banner": "banner_circuit"}
    t = tab(api).open()
    tegel(t, "banner_standaard").click()
    assert t.page.locator("[data-kc-equip]").inner_text() == "Back to free"

    def keuze(body):
        api.staat["per_kaart"]["profiel"]["gekozen"] = {"banner": "banner_standaard"}
        api.staat["per_kaart"]["profiel"]["getoond"] = {"banner": "banner_standaard"}
        return ok({"geclaimd": False, "kaart": "profiel", "item": {"id": "banner_standaard", "status": "free"}})

    api.antwoorden[("POST", "/api/v1/me/kaart/keuze")] = keuze
    t.page.locator("[data-kc-equip]").click()
    wacht_op(t, "() => document.querySelector('[data-kc-melding]').textContent.includes('free default')")
    assert api.bodies("POST", "/api/v1/me/kaart/keuze") == [{"kaart": "profiel", "item_id": "banner_standaard"}]


@pytest.mark.parametrize("code,status,stuk", [("tier_required", 403, "premium tier"), ("level_required", 403, "level is too low"),
                                              ("buy_in_discord", 409, "Buy that one in Discord"), ("not_owned", 409, "do not own"),
                                              ("busy", 409, "busy for a moment"), ("unknown_item", 404, "does not exist")])
def test_een_weigering_bij_het_opslaan_toont_de_reden_en_verandert_niets(tab, code, status, stuk):
    api = NepApi()
    api.antwoorden[("POST", "/api/v1/me/kaart/keuze")] = fout(status, code)
    t = tab(api).open()
    tegel(t, "banner_circuit").click()
    t.page.locator("[data-kc-equip]").click()
    wacht_op(t, "() => document.querySelector('[data-kc-melding]').textContent.length > 0 && !document.querySelector('[data-kc-melding]').textContent.startsWith('Saving')")
    assert stuk in t.page.locator("[data-kc-melding]").inner_text()
    assert t.page.locator("[data-kc-equip]").is_enabled()


def test_een_504_leest_eerst_de_staat_opnieuw_en_meldt_dan_gelukt(tab):
    api = NepApi()
    api.antwoorden[("POST", "/api/v1/me/kaart/keuze")] = fout(504, "bot_timeout")
    t = tab(api).open()
    tegel(t, "banner_circuit").click()
    voor = api.aantal("GET", "/api/v1/me/kaart")
    api.staat["per_kaart"]["profiel"]["gekozen"] = {"banner": "banner_circuit"}      # het is toch gelukt
    api.staat["per_kaart"]["profiel"]["getoond"] = {"banner": "banner_circuit"}
    t.page.locator("[data-kc-equip]").click()
    wacht_op(t, "() => document.querySelector('[data-kc-melding]').textContent.includes('answered slowly')")
    assert api.aantal("GET", "/api/v1/me/kaart") == voor + 1, "de staat is opnieuw gelezen voor er iets werd gemeld"
    assert "Equipped Circuit" in t.page.locator("[data-kc-melding]").inner_text()


def test_een_504_waarbij_het_niet_gelukt_is_zegt_dat_het_niet_is_opgeslagen(tab):
    api = NepApi()
    api.antwoorden[("POST", "/api/v1/me/kaart/keuze")] = fout(504, "bot_timeout")
    t = tab(api).open()
    tegel(t, "banner_circuit").click()
    t.page.locator("[data-kc-equip]").click()
    wacht_op(t, "() => document.querySelector('[data-kc-melding]').textContent.includes('not saved')")
    assert "That was not saved" in t.page.locator("[data-kc-melding]").inner_text()


def test_een_504_en_een_staatlezing_die_ook_mislukt_belooft_niets(tab):
    api = NepApi()
    api.antwoorden[("POST", "/api/v1/me/kaart/keuze")] = fout(504, "bot_timeout")
    t = tab(api).open()
    tegel(t, "banner_circuit").click()
    api.antwoorden[("GET", "/api/v1/me/kaart")] = fout(503, "bot_unavailable")
    t.page.locator("[data-kc-equip]").click()
    wacht_op(t, "() => document.querySelector('[data-kc-melding]').textContent.includes('could not confirm')")


def test_een_401_midden_in_het_opslaan_zegt_dat_er_niets_is_opgeslagen_en_bewaart_het_voorbeeld(tab):
    api = NepApi()
    api.antwoorden[("POST", "/api/v1/me/kaart/keuze")] = fout(401, "session_invalid", "Your session has ended. Sign in again.")
    t = tab(api).open()
    tegel(t, "banner_circuit").click()
    t.page.locator("[data-kc-equip]").click()
    wacht_op(t, "() => document.querySelector('[data-kc-melding]').textContent.includes('nothing was saved')")
    assert "Your session has ended, so nothing was saved. Log in again to keep editing." in t.page.locator("[data-kc-melding]").inner_text()
    assert t.page.locator("[data-kc-melding] a").get_attribute("href") == f"{API}/login?redirect=v2%2Fcards.html"
    concept = json.loads(t.page.evaluate("() => sessionStorage.getItem('kaart_concept')"))
    assert concept["voorbeeld"]["profiel"] == {"banner": "banner_circuit"}
    # Terug na het inloggen: het voorbeeld staat er weer, en er is NIETS vanzelf opgeslagen.
    api.antwoorden.pop(("POST", "/api/v1/me/kaart/keuze"))
    t.page.reload()
    t.wacht_staat("editor")
    wacht_op(t, "() => document.querySelector('[data-kc-melding]').textContent.includes('unsaved preview')")
    assert tegel(t, "banner_circuit").get_attribute("aria-checked") == "true"
    assert api.aantal("POST", "/api/v1/me/kaart/keuze") == 1


def test_dubbel_klikken_stuurt_een_keuze_en_zet_de_knop_uit_tijdens_het_verzoek(tab):
    api = NepApi()
    api.antwoorden[("POST", "/api/v1/me/kaart/keuze")] = "wacht"
    t = tab(api).open()
    tegel(t, "banner_circuit").click()
    knop = t.page.locator("[data-kc-equip]")
    knop.click()
    wacht_op(t, "() => document.querySelector('[data-kc-equip]').disabled")
    assert knop.get_attribute("aria-busy") == "true"
    knop.click(force=True)
    knop.dispatch_event("click")
    t.page.wait_for_timeout(300)
    assert api.aantal("POST", "/api/v1/me/kaart/keuze") == 1
    t.vrij(200, {"ok": True, "data": {"geclaimd": False, "kaart": "profiel", "item": {"id": "banner_circuit", "status": "owned"}}})
    wacht_op(t, "() => !document.querySelector('[data-kc-equip]').hasAttribute('aria-busy')")
    assert api.aantal("POST", "/api/v1/me/kaart/keuze") == 1


# --------------------------------------------------------------------------- #
# 4. Previews: een tegelijk, debounce, rate limit
# --------------------------------------------------------------------------- #
def test_hoogstens_een_preview_tegelijk_en_snel_wisselen_geeft_een_laatste_aanvraag(tab):
    api = NepApi()
    t = tab(api).open()
    wacht_op(t, "() => document.querySelector('[data-kc-pod] .kc-pod-naam')")
    t.page.wait_for_timeout(500)
    api.antwoorden[("POST", "/api/v1/me/kaart/preview")] = "wacht"
    n = api.aantal("POST", "/api/v1/me/kaart/preview")
    for iid in ("banner_circuit", "banner_gratis", "banner_betaald", "banner_tier"):
        tegel(t, iid).click()
    t.page.wait_for_timeout(800)
    assert api.aantal("POST", "/api/v1/me/kaart/preview") == n + 1, "snel wisselen geeft een aanvraag (debounce) en niet vier"
    assert len(api.vast) == 1
    tegel(t, "banner_level").click()
    t.page.wait_for_timeout(800)
    assert api.aantal("POST", "/api/v1/me/kaart/preview") == n + 1, "er loopt er al een: een tweede wacht"
    api.antwoorden.pop(("POST", "/api/v1/me/kaart/preview"))
    t.vrij(200, {"ok": True, "data": preview_basis()})
    wacht_op(t, "(n) => true", n)
    t.page.wait_for_timeout(900)
    assert api.aantal("POST", "/api/v1/me/kaart/preview") == n + 2
    assert api.bodies("POST", "/api/v1/me/kaart/preview")[-1]["wijzig"] == {"banner": "banner_level"}


def test_rate_limited_op_een_preview_toont_de_wachttijd_en_probeert_het_daarna_opnieuw(tab):
    api = NepApi()
    t = tab(api).open()
    wacht_op(t, "() => document.querySelector('[data-kc-pod] .kc-pod-naam')")
    t.page.wait_for_timeout(500)
    api.antwoorden[("POST", "/api/v1/me/kaart/preview")] = fout(429, "rate_limited", "Slow down", retry_after=2)
    n = api.aantal("POST", "/api/v1/me/kaart/preview")
    tegel(t, "banner_circuit").click()
    wacht_op(t, "() => document.querySelector('[data-kc-previewstatus]').textContent.includes('Too many previews')")
    assert "in 2 seconds" in t.page.locator("[data-kc-previewstatus]").inner_text()
    api.antwoorden.pop(("POST", "/api/v1/me/kaart/preview"))
    wacht_op(t, "(n) => true", n)
    t.page.wait_for_timeout(2800)
    assert api.aantal("POST", "/api/v1/me/kaart/preview") >= n + 2
    assert t.page.locator("[data-kc-previewstatus]").inner_text() == ""
    assert t.page.locator("[data-kc-equip]").is_visible(), "kiezen blijft kunnen terwijl de preview wacht"


def test_een_preview_die_faalt_laat_het_kiezen_werken(tab):
    api = NepApi()
    api.antwoorden[("POST", "/api/v1/me/kaart/preview")] = fout(503, "bot_unavailable")
    t = tab(api).open()
    wacht_op(t, "() => document.querySelector('[data-kc-previewstatus]').textContent.length > 0")
    assert "Preview unavailable" in t.page.locator("[data-kc-previewstatus]").inner_text()
    tegel(t, "banner_circuit").click()
    assert t.page.locator("[data-kc-equip]").is_visible()
    assert "Tommy" in t.page.locator("[data-kc-pod]").inner_text(), "de tekstpreview blijft staan"


def test_een_401_op_een_preview_toont_de_sessiemelding(tab):
    api = NepApi()
    api.antwoorden[("POST", "/api/v1/me/kaart/preview")] = fout(401, "session_invalid")
    t = tab(api).open()
    wacht_op(t, "() => document.querySelector('[data-kc-melding]').textContent.includes('nothing was saved')")
    assert "Log in again" in t.page.locator("[data-kc-melding]").inner_text()


# --------------------------------------------------------------------------- #
# 5. Veiligheid
# --------------------------------------------------------------------------- #
HOSTIEL = '<img src=x onerror="window.__pwn=1"><script>window.__pwn=2</script>'


def test_een_vijandige_naam_of_tekst_komt_als_tekst_op_de_pagina(tab):
    api = NepApi()
    api.catalogus["items"].append(item("banner_evil", HOSTIEL, "banner", ["profiel"], tier=HOSTIEL))
    api.staat["items"]["banner_evil"] = "locked_tier"
    api.gebruiker["global_name"] = HOSTIEL
    api.speler = {"available": True, "item": {**SPELER["item"], "equipped_title": HOSTIEL}}
    t = tab(api).open()
    wacht_op(t, "() => document.querySelector('[data-kc-pod]').innerText.includes('onerror')")
    tegel(t, "banner_evil").click()
    t.page.wait_for_timeout(500)
    body = tekst(t)
    assert body.count("onerror") >= 3 and "window.__pwn" in body
    assert t.page.evaluate("() => window.__pwn") is None, "er is niets uitgevoerd"
    assert t.page.locator('img[src="x"], img[onerror], main script').count() == 0
    assert HOSTIEL in tegel(t, "banner_evil").get_attribute("aria-label")
    assert not any("x" == u.rsplit("/", 1)[-1] for u in api.extern)


def test_een_url_van_een_vreemde_host_wordt_niet_geladen(tab):
    api = NepApi()
    api.preview = preview_basis(
        banner={"url": "https://evil.example/kaart/plaat/x.webp", "beweegt": False},
        divider={"url": "http://api.buckybot.app/kaart/plaat/" + "d" * 40 + ".webp", "beweegt": False},
        embleem={"url": "javascript:alert(1)", "beweegt": False},
        plaquette={"url": "https://api.buckybot.app.evil.example/kaart/plaat/p.webp", "beweegt": False},
        bank={"url": "https://user:pw@api.buckybot.app/kaart/plaat/" + "e" * 40 + ".webp", "beweegt": False},
        tegels={"url": "https://api.buckybot.app/geheim/pad.webp", "beweegt": False})
    api.catalogus["items"][1]["staal"] = {"stil": "https://evil.example/staal.webp", "beweegt": None}
    t = tab(api).open()
    wacht_op(t, "() => document.querySelector('[data-kc-pod] .kc-pod-naam')")
    t.page.wait_for_timeout(600)
    assert api.extern == [], api.extern
    assert t.page.locator("[data-kc-pod] img").count() == 0
    assert not any("evil" in u or "geheim" in u for u in api.plaatverzoeken)
    assert t.page.locator('img[src*="evil"]').count() == 0


def test_een_persoonlijk_pad_met_een_slechte_hash_wordt_niet_geladen(tab):
    api = NepApi()
    api.preview = preview_basis(embleem={"url": "/api/v1/me/kaart/preview/../../etc/passwd", "beweegt": False},
                                banner={"url": "/api/v1/me/kaart/preview/ABC", "beweegt": False})
    t = tab(api).open()
    t.page.wait_for_timeout(700)
    assert t.page.locator("[data-kc-pod] img").count() == 0
    assert not any("/preview/" in u or "passwd" in u for u in api.plaatverzoeken), api.plaatverzoeken


def test_elke_aanroep_gaat_met_de_cookie_en_er_gaat_nooit_een_user_id_mee(tab):
    api = NepApi()
    t = tab(api).open()
    tegel(t, "banner_circuit").click()
    t.page.wait_for_timeout(500)
    for c in api.calls:
        assert "user_id" not in json.dumps(c["body"]) and "uid" not in json.dumps(c["body"])
    assert t.page.evaluate("() => document.cookie") == ""
    assert not any(k.lower() == "authorization" for c in api.calls for k in c["headers"])


def test_geen_enkele_csp_schending_en_alleen_toegestane_hosts(tab):
    api = NepApi()
    api.preview = preview_basis(banner=plaat("b"), divider=plaat("d"), embleem={"url": f"/api/v1/me/kaart/preview/{HASH}"})
    t = tab(api).open()
    t.page.wait_for_timeout(800)
    tegel(t, "banner_circuit").click()
    t.page.wait_for_timeout(500)
    assert t.page.evaluate("() => window.__csp") == []
    assert api.extern == []


# --------------------------------------------------------------------------- #
# 6. Beweging
# --------------------------------------------------------------------------- #
def _bewegende_preview():
    return preview_basis(banner={"url": f"{API}/kaart/plaat/{'a' * 40}.webp", "beweegt": True,
                                 "stil": f"{API}/kaart/plaat/{'c' * 40}.webp"})


def test_een_bewegende_plaat_toont_eerst_stil_en_speelt_bij_hover_en_tik(tab):
    api = NepApi()
    api.preview = _bewegende_preview()
    t = tab(api, reduced="no-preference").open()
    img = t.page.locator("[data-kc-pod] .kc-pod-banner")
    img.wait_for()
    assert img.get_attribute("src").endswith(f"{'c' * 40}.webp")
    img.hover()
    wacht_op(t, "() => document.querySelector('.kc-pod-banner').src.endsWith('" + "a" * 40 + ".webp')")
    t.page.mouse.move(0, 0)
    wacht_op(t, "() => document.querySelector('.kc-pod-banner').src.endsWith('" + "c" * 40 + ".webp')")
    img.dispatch_event("click")                      # een tik of Enter: aan
    wacht_op(t, "() => document.querySelector('.kc-pod-banner').src.endsWith('" + "a" * 40 + ".webp')")
    img.dispatch_event("click")                      # en weer uit
    wacht_op(t, "() => document.querySelector('.kc-pod-banner').src.endsWith('" + "c" * 40 + ".webp')")


def test_met_reduced_motion_speelt_een_plaat_nooit_en_de_animatie_wordt_niet_eens_gevraagd(tab):
    api = NepApi()
    api.preview = _bewegende_preview()
    t = tab(api, reduced="reduce").open()
    img = t.page.locator("[data-kc-pod] .kc-pod-banner")
    img.wait_for()
    img.hover()
    img.click()
    t.page.keyboard.press("Tab")
    t.page.wait_for_timeout(400)
    assert img.get_attribute("src").endswith(f"{'c' * 40}.webp")
    assert not any(("a" * 40) in u for u in api.plaatverzoeken)


def test_een_bewegende_plaat_zonder_stil_beeld_blijft_met_reduced_motion_weg(tab):
    api = NepApi()
    api.preview = preview_basis(banner={"url": f"{API}/kaart/plaat/{'a' * 40}.webp", "beweegt": True, "stil": None})
    t = tab(api, reduced="reduce").open()
    t.page.wait_for_timeout(700)
    assert t.page.locator("[data-kc-pod] .kc-pod-banner").count() == 0
    assert not any(("a" * 40) in u for u in api.plaatverzoeken)


# --------------------------------------------------------------------------- #
# 7. Toetsenbord, uiterlijk en toegankelijkheid
# --------------------------------------------------------------------------- #
def test_het_toetsenbord_bedient_tabs_categorieen_en_raster_met_een_zichtbare_focus(tab):
    t = tab().open()
    t.page.locator('[data-kc-tab="profiel"]').focus()
    t.page.keyboard.press("ArrowRight")
    assert t.page.locator('[data-kc-tab="saldo"]').get_attribute("aria-selected") == "true"
    t.page.keyboard.press("ArrowLeft")
    assert t.page.locator('[data-kc-tab="profiel"]').get_attribute("aria-selected") == "true"
    tegel(t, "banner_standaard").focus()
    t.page.keyboard.press("ArrowRight")
    assert tegel(t, "banner_circuit").get_attribute("aria-checked") == "true"
    assert t.page.evaluate("() => document.activeElement.dataset.kcItem") == "banner_circuit"
    uit = t.page.evaluate("() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, s.outlineWidth]; }")
    assert uit[0] != "none" and uit[1] != "0px"
    assert t.page.get_by_role("tab").count() == 2 and t.page.get_by_role("radio").count() >= 7


@pytest.mark.parametrize("breedte", [360, 390])
@pytest.mark.parametrize("toestand", ["editor", "login", "wacht", "fout"])
def test_telefoon_geen_horizontale_scroll_marge_16_en_tikdoelen_44(tab, breedte, toestand):
    api = NepApi()
    if toestand == "login":
        api.antwoorden[("GET", "/api/v1/me/kaart")] = fout(401, "not_signed_in")
    elif toestand == "wacht":
        api.antwoorden[("GET", "/api/v1/me/kaart")] = fout(429, "rate_limited", retry_after=30)
    elif toestand == "fout":
        api.antwoorden[("GET", "/api/v1/me/kaart")] = fout(500, "server_error")
    api.preview = preview_basis(banner=plaat("b"), divider=plaat("d"), embleem={"url": f"/api/v1/me/kaart/preview/{HASH}"})
    t = tab(api, breedte=breedte, hoogte=800).open(staat=toestand)
    t.page.wait_for_timeout(500)
    m = t.page.evaluate("""() => ({sw: document.documentElement.scrollWidth, iw: window.innerWidth,
        links: Math.min(...[...document.querySelectorAll('.kc-inner > *')].filter(e => !e.hidden).map(e => e.getBoundingClientRect().left))})""")
    assert m["sw"] <= m["iw"], m
    assert m["links"] >= 16 - 0.5, m
    if toestand == "editor":
        klein = t.page.evaluate("""() => [...document.querySelectorAll('.kc-seg, .kc-zij, .kc-tegel, .kc-podium-knop, [data-kc-equip]:not([hidden])')]
            .map(e => [e.className, e.getBoundingClientRect().width, e.getBoundingClientRect().height])
            .filter(([c, w, h]) => w < 43.5 || h < 43.5)""")
        assert klein == [], klein
        t.page.locator('[data-kc-tab="saldo"]').click()
        t.page.wait_for_timeout(300)
        assert t.page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")


def _lum(rgb):
    def k(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (k(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a, b):
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def _rgb(s):
    return tuple(int(float(x)) for x in re.findall(r"[\d.]+", s)[:3])


@pytest.mark.parametrize("schema", ["light", "dark"])
def test_licht_en_donker_halen_4_5_op_de_pagina_en_op_beide_podiumstanden(tab, schema):
    api = NepApi()
    t = tab(api, schema=schema, breedte=1280).open()
    t.page.wait_for_timeout(600)
    assert t.page.evaluate("() => document.documentElement.dataset.thema") == ("donker" if schema == "dark" else "licht")
    pagina = t.page.evaluate("""() => {
      const bg = (e) => { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)') return c; } return 'rgb(255,255,255)'; };
      return [...document.querySelectorAll('.kc-lead, .kc-tegel-status, .kc-tegel-naam, .kc-actie-tekst, .kc-pod-noot, .kc-gekozen, .kc-seg, .kc-zij, .kc-eyebrow')]
        .filter(e => e.getBoundingClientRect().width && e.textContent.trim())
        .map(e => [e.className, getComputedStyle(e).color, bg(e)]);
    }""")
    for klasse, fg, bg in pagina:
        if "kc-seg" in klasse or "kc-zij" in klasse:
            continue
        assert _contrast(_rgb(fg), _rgb(bg)) >= 4.5, (schema, klasse, fg, bg)
    assert t.page.evaluate("() => document.querySelector('[data-kc-podium]').textContent") == ("Discord dark" if schema == "dark" else "Discord light")
    for stand in ("licht", "donker"):
        if t.page.locator("[data-kc-podium-vak]").get_attribute("data-podium") != stand:
            t.page.locator("[data-kc-podium]").click()
            t.page.wait_for_timeout(250)                 # de kleuren zijn pas na een frame bijgewerkt
        waarden = t.page.evaluate("""() => {
          const bg = (e) => { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)') return c; } return 'rgb(255,255,255)'; };
          const k = document.querySelector('[data-kc-podium-vak]');
          const naam = k.querySelector('.kc-pod-naam');
          const label = k.querySelector('.kc-pod-label');
          const klein = k.querySelector('.kc-pod-klein');
          return [bg(naam), getComputedStyle(naam).color, getComputedStyle(label).color, getComputedStyle(klein).color];
        }""")
        for fg in waarden[1:]:
            assert _contrast(_rgb(fg), _rgb(waarden[0])) >= 4.5, (schema, stand, fg, waarden[0])


def test_de_podiumschakelaar_wisselt_alleen_het_podium(tab):
    t = tab().open()
    kader = t.page.locator("[data-kc-podium-vak]")
    voor = t.page.evaluate("() => getComputedStyle(document.body).backgroundColor")
    start = kader.get_attribute("data-podium")
    t.page.locator("[data-kc-podium]").click()
    assert kader.get_attribute("data-podium") != start
    assert t.page.locator("[data-kc-podium]").get_attribute("aria-pressed") in ("true", "false")
    assert t.page.evaluate("() => getComputedStyle(document.body).backgroundColor") == voor


def test_kleur_en_rand_van_de_bot_komen_op_het_podium_en_een_slechte_kleur_wordt_genegeerd(tab):
    api = NepApi()
    api.preview = {**preview_basis(), "accent": "#3366FF", "rand": {"rand": "#D4AF37", "stijl": "dubbel", "dikte": 4}}
    t = tab(api).open()
    wacht_op(t, "() => getComputedStyle(document.querySelector('[data-kc-podium-vak]')).getPropertyValue('--kc-accent') === '#3366FF'")
    assert t.page.locator("[data-kc-podium-vak]").get_attribute("data-rand-stijl") == "dubbel"
    api.preview = {**preview_basis(), "accent": "rood;}</style>", "rand": {"rand": "url(javascript:1)", "stijl": "x", "dikte": 999}}
    tegel(t, "banner_circuit").click()
    t.page.wait_for_timeout(900)
    assert t.page.evaluate("() => document.querySelector('[data-kc-podium-vak]').style.getPropertyValue('--kc-accent')") == ""
    assert t.page.locator("[data-kc-podium-vak]").get_attribute("data-rand-stijl") == "geen"


def test_staaltjes_laden_lui(tab):
    api = NepApi()
    for i in range(30):
        api.catalogus["items"].append(item(f"banner_extra{i:02d}", f"Extra {i}", "banner", ["profiel"]))
        api.staat["items"][f"banner_extra{i:02d}"] = "owned"
    t = tab(api, breedte=390, hoogte=700).open()
    t.page.wait_for_timeout(700)
    assert t.page.locator('.kc-tegel-beeld[loading="lazy"]').count() >= 30
    geladen = len([u for u in api.plaatverzoeken if "/kaart/plaat/" in u])
    assert geladen < 30 + 8, "buiten beeld niet alles laden"


def test_de_pagina_werkt_los_zonder_site_versie_of_navigatie(tab):
    t = tab().open()
    assert t.page.locator("h1").inner_text() == "Make your cards yours"
    assert not t.page.locator("a", has_text="My cards").first.is_visible(), "met de vlag uit staat de ingang er niet"


def test_in_een_vreemd_frame_blijft_de_editor_leeg_en_zelf_open_werkt_hij_gewoon(tab):
    """Review A8: een frame zonder toestemming om het bovenste venster te sturen (sandbox zonder allow-top-navigation) krijgt een
    lege pagina; de pagina zelf, niet in een frame, laadt zoals altijd. De gastpagina heeft geen eigen CSP, zodat het frame laadt."""
    t = tab(NepApi())
    gast = (f"{t.server}/__gast.html")
    t.page.route(gast, lambda r: r.fulfill(status=200, content_type="text/html",
        body='<!doctype html><title>gast</title><iframe id="vreemd" sandbox="allow-scripts" src="/v2/cards.html"></iframe>'))
    t.page.goto(gast, wait_until="load")
    t.page.wait_for_timeout(2500)
    frame = [f for f in t.page.frames if f != t.page.main_frame][0]
    assert "cards.html" in frame.url, frame.url
    assert frame.evaluate("() => document.documentElement.children.length") == 0
    assert frame.evaluate("() => document.querySelectorAll('main, script').length") == 0
    t2 = tab(NepApi())
    t2.page.goto(f"{t2.server}/v2/cards.html", wait_until="commit")
    t2.wacht_staat("editor")
    assert t2.page.locator("main").count() == 1
