"""De org-pagina van v2 en de knop "Open the org app" (13-10-2026, ronde 2 deel E).

v2/organisations.html laat de vier organisaties zien, elk in een eigen paneel:
de tekst uit het register van de bot (cogs/data/organizations.py), de kleur en
het "materiaal" uit org_config.json. Niets verzonnen, en daarom hier bewaakt:
wie het register of de config aanpast, ziet deze test rood tot de pagina mee is.

De knop kiest een route:

  * niet ingelogd          -> eerst Discord (login), daarna gaat de flow vanzelf door;
  * scherm van 768 px+     -> de VM, gemaximaliseerd, met de org-app open
                              (arcade.html?app=org&maximize=1, deel 0.2);
  * smaller (telefoon)     -> de bot stuurt een DM (POST /api/org/dm, deel 0.3)
                              en de pagina zegt "Check your Discord DMs";
  * DM mislukt             -> dezelfde informatie op de pagina, met de melding
                              dat de DM niet lukte. Nooit stil.

768 is niet gekozen maar gemeten: daaronder sluit de VM zich af
(vm/styles/vm.css, `@media (max-width: 767px)`). Een test houdt die twee gelijk.

DRAAIEN:  python -m pytest tests/test_v2_orgs.py
"""
from __future__ import annotations

import functools
import http.server
import importlib.util
import json
import pathlib
import re
import threading
from urllib.parse import parse_qs, urlsplit

import pytest

SITE = pathlib.Path(__file__).resolve().parent.parent
ROOT = SITE.parent
API = "https://api.buckybot.app"
PAGINA = SITE / "v2" / "organisations.html"
ORG_CONFIG = ROOT / "bucky1.0" / "cogs" / "data" / "currency" / "datacurrency" / "organizations" / "org_config.json"
REGISTER = ROOT / "bucky1.0" / "cogs" / "data" / "organizations.py"
# Slug in het register -> klasse/map op de site (de map heet "null", de slug niet).
SLUGS = {"nulldiv": "null", "vanta": "vanta", "aether": "aether", "cytek": "cytek"}

GEBRUIKER = {"id": "80351110224678912", "username": "tester", "discriminator": "0", "avatar": None}


def _register():
    if not REGISTER.exists():
        pytest.skip("het botregister staat niet naast de site")
    spec = importlib.util.spec_from_file_location("org_register", REGISTER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.ORGANIZATIONS


def _thema():
    if not ORG_CONFIG.exists():
        pytest.skip("org_config.json staat niet naast de site")
    return json.loads(ORG_CONFIG.read_text(encoding="utf-8"))["theme"]


def _tekst(html: str) -> str:
    html = re.sub(r"<(script|style)\b.*?</\1>", " ", html, flags=re.S)
    html = re.sub(r"<[^>]+>", " ", html)
    import html as h
    return " ".join(h.unescape(html).split())


# --------------------------------------------------------------------------- #
# Statisch: de bron
# --------------------------------------------------------------------------- #
def test_de_pagina_bestaat_en_valt_onder_v1_terug_op_de_vm():
    kop = PAGINA.read_text(encoding="utf-8").split("</head>")[0]
    eerste = re.search(r"<(script|link)\b[^>]*>", kop.split("Content-Security-Policy")[1]).group(0)
    assert 'src="../js/site-version.js"' in eerste
    assert 'data-page="v2"' in eerste
    # Onder v1 het oude gedrag: Organisations bracht je naar de VM.
    assert 'data-v1="../arcade.html#the-vm"' in eerste


@pytest.mark.parametrize("slug", list(SLUGS))
def test_de_tekst_komt_letterlijk_uit_het_register(slug):
    org = _register()[slug]
    paneel = re.search(rf'<article class="op op-{SLUGS[slug]}".*?</article>',
                       PAGINA.read_text(encoding="utf-8"), re.S)
    assert paneel, f"geen paneel voor {slug}"
    tekst = _tekst(paneel.group(0))
    for veld in ("name", "tagline", "philosophy", "security_ideology", "description"):
        assert " ".join(org[veld].split()) in tekst, (slug, veld)


def test_vier_panelen_in_de_volgorde_van_de_voorpagina():
    html = PAGINA.read_text(encoding="utf-8")
    assert re.findall(r'<article class="op op-(\w+)"', html) == ["null", "vanta", "aether", "cytek"]


def _css_blok(css: str, klasse: str) -> str:
    m = re.search(rf"\.v2 \.op-{klasse}\s*\{{(.*?)\}}", css, re.S)
    assert m, f".op-{klasse} ontbreekt in v2.css"
    return m.group(1)


@pytest.mark.parametrize("slug", list(SLUGS))
def test_kleur_en_materiaal_komen_uit_org_config(slug):
    thema = _thema()[slug]
    blok = _css_blok((SITE / "v2" / "css" / "v2.css").read_text(encoding="utf-8"), SLUGS[slug])
    kleur = "#" + thema["color"][2:].upper()
    assert re.search(rf"--org:\s*{kleur};", blok, re.I), (slug, kleur)
    for naam, waarde in thema["material"].items():
        css_naam = "--m-" + naam.replace("_", "-")
        m = re.search(rf"{css_naam}:\s*([0-9.]+);", blok)
        assert m, (slug, css_naam)
        assert float(m.group(1)) == pytest.approx(float(waarde)), (slug, naam)


def test_de_drempel_is_die_van_de_vm():
    """Daaronder sluit de VM zich af; de pagina stuurt er dan niemand heen."""
    vm = (SITE / "vm" / "styles" / "vm.css").read_text(encoding="utf-8")
    slot = re.search(r"@media \(max-width: (\d+)px\)\s*\{[^@]*?\.bucky-vm-shell,\s*\.bucky-vm-backdrop\s*\{\s*display: none", vm)
    assert slot, "het VM-slot is niet meer te vinden"
    js = (SITE / "v2" / "js" / "orgs.js").read_text(encoding="utf-8")
    drempel = int(re.search(r"VM_MIN_BREEDTE\s*=\s*(\d+)", js).group(1))
    assert drempel == int(slot.group(1)) + 1


def test_de_vm_link_is_die_van_deel_0_2():
    js = (SITE / "v2" / "js" / "orgs.js").read_text(encoding="utf-8")
    assert '"../arcade.html?app=org&maximize=1#the-vm"' in js


@pytest.mark.parametrize("naam", ["index", "tos", "privacy", "cookie", "rules", "contact", "organisations"])
def test_organisations_in_de_nav_wijst_naar_deze_pagina(naam):
    html = (SITE / "v2" / f"{naam}.html").read_text(encoding="utf-8")
    nav = html[html.index('<header class="nav"'):html.index("</header>")]
    links = re.findall(r'<a href="([^"]+)"[^>]*>Organisations</a>', nav)
    assert links == ["organisations.html"], (naam, links)


def test_nav_en_footer_zijn_die_van_de_voorpagina():
    from test_v2_legal import _blok
    index = (SITE / "v2" / "index.html").read_text(encoding="utf-8")
    pagina = PAGINA.read_text(encoding="utf-8")
    for begin, eind in (('<header class="nav"', "</header>"), ('<footer class="foot">', "</footer>")):
        assert _blok(pagina, begin, eind) == _blok(index, begin, eind), begin


def test_v1_is_niet_aangeraakt():
    """Onder v1 blijft Organisations wat het was: naar de VM."""
    v1 = (SITE / "index.html").read_text(encoding="utf-8")
    assert 'href="arcade.html#the-vm"' in v1
    assert "organisations.html" not in v1


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


def _orgs_lijst():
    return {"available": True, "count": 4, "items": [
        {"id": "cytek", "name": "CyTek Industries", "members": 11},
        {"id": "nulldiv", "name": "Null Division", "members": 9},
        {"id": "aether", "name": "Aether Systems", "members": 8},
        {"id": "vanta", "name": "Vanta Collective", "members": 7},
    ]}


class Tab:
    """Een tab met een nagebootste backend. `dm` is wat POST /api/org/dm antwoordt
    (dict + status), of "netwerk" voor een verbinding die wegvalt."""

    def __init__(self, browser, server, breedte=1280, hoogte=900, versie="v2", ingelogd=False,
                 dm=None, me=None, orgs=None):
        self.server, self.versie, self.ingelogd = server, versie, ingelogd
        self.dm = dm if dm is not None else ({"delivered": True, "kind": "myorg", "reason": None}, 200)
        self.me = me if me is not None else ({"available": True, "viewer": None, "org": None}, 200)
        self.orgs = orgs if orgs is not None else (_orgs_lijst(), 200)
        self.logins, self.dm_verzoeken, self.extern = [], [], []
        self.ctx = browser.new_context(viewport={"width": breedte, "height": hoogte}, reduced_motion="reduce")
        self.page = self.ctx.new_page()
        self.page.route("**/*", self._buiten)
        self.page.route(f"{API}/**", self._api)

    def _buiten(self, route):
        host = urlsplit(route.request.url).hostname
        if host == "127.0.0.1":
            route.continue_()
        else:
            if host != "cdn.discordapp.com":
                self.extern.append(route.request.url)
            route.abort()

    def _api(self, route):
        deel = urlsplit(route.request.url)
        kop = {"Access-Control-Allow-Origin": route.request.headers.get("origin", "*"),
               "Access-Control-Allow-Credentials": "true"}

        def stuur(body, status=200):
            route.fulfill(status=status, content_type="application/json", body=json.dumps(body), headers=kop)

        if route.request.method == "OPTIONS":
            route.fulfill(status=204, headers={**kop, "Access-Control-Allow-Methods": "GET, POST",
                                               "Access-Control-Allow-Headers": "Content-Type"})
        elif deel.path == "/login":
            self.logins.append(parse_qs(deel.query).get("redirect", [None])[0])
            route.fulfill(status=200, content_type="text/html", body="<!doctype html><title>login</title>")
        elif deel.path == "/api/site/features":
            stuur({"features": {}, "site": {"version": self.versie}})
        elif deel.path == "/api/me":
            if self.ingelogd:
                stuur({"logged_in": True, "user": GEBRUIKER, "guilds": []})
            else:
                stuur({"logged_in": False}, 401)
        elif deel.path == "/api/player/organizations":
            body, status = self.orgs
            stuur(body, status)
        elif deel.path == "/api/org/dm":
            self.dm_verzoeken.append({"methode": route.request.method, "body": route.request.post_data})
            if self.dm == "netwerk":
                route.abort()
            else:
                stuur(*self.dm)
        elif deel.path == "/api/org/me":
            if not self.ingelogd:
                stuur({"error": "login required"}, 401)
            else:
                stuur(*self.me)
        elif self.ingelogd:
            stuur({})
        else:
            stuur({"error": "login required"}, 401)

    def open(self, pad="/v2/organisations.html"):
        self.page.goto(f"{self.server}{pad}", wait_until="commit")
        self.page.wait_for_function(
            "() => window.BuckySiteVersion && document.readyState === 'complete'"
            " && getComputedStyle(document.documentElement).visibility !== 'hidden'", timeout=8000)
        return self

    def klik(self):
        self.page.locator("[data-org-cta]").first.click()

    def staat(self, verwacht, timeout=6000):
        self.page.wait_for_function(
            "(s) => [...document.querySelectorAll('[data-flow]')].some(f => f.dataset.staat === s)",
            arg=verwacht, timeout=timeout)
        return self.page.locator(f'[data-flow][data-staat="{verwacht}"]').first

    def sluit(self):
        self.ctx.close()


@pytest.fixture
def tab(browser, server):
    open_ = []

    def maak(**kw):
        t = Tab(browser, server, **kw)
        open_.append(t)
        return t

    yield maak
    for t in open_:
        t.sluit()


# ---- de route kiezen --------------------------------------------------------
def test_uitgelogd_eerst_naar_discord_en_daarna_verder(tab):
    t = tab(ingelogd=False).open()
    t.klik()
    t.page.wait_for_url(f"{API}/login**")
    assert t.logins == ["v2/organisations.html?flow=org"]


def test_terug_van_de_login_op_een_groot_scherm_gaat_vanzelf_naar_de_vm(tab):
    t = tab(ingelogd=True, breedte=1280)
    t.page.goto(f"{t.server}/v2/organisations.html?flow=org", wait_until="commit")
    t.page.wait_for_url("**/arcade.html?app=org&maximize=1#the-vm", timeout=8000)
    assert t.dm_verzoeken == []


def test_ingelogd_op_768_breed_naar_de_vm(tab):
    t = tab(ingelogd=True, breedte=768, hoogte=1024).open()
    t.klik()
    t.page.wait_for_url("**/arcade.html?app=org&maximize=1#the-vm", timeout=8000)


def test_ingelogd_op_een_telefoon_een_dm(tab):
    t = tab(ingelogd=True, breedte=390, hoogte=844).open()
    t.klik()
    vak = t.staat("dm-verstuurd")
    assert "Check your Discord DMs" in vak.inner_text()
    assert t.dm_verzoeken[0]["methode"] == "POST"
    # Wie de DM krijgt, weet de backend uit de sessie; de pagina noemt niemand.
    assert not (t.dm_verzoeken[0]["body"] or "").strip("{} ")
    assert urlsplit(t.page.url).path == "/v2/organisations.html"


def test_767_breed_is_een_telefoon(tab):
    t = tab(ingelogd=True, breedte=767, hoogte=1024).open()
    t.klik()
    t.staat("dm-verstuurd")
    assert len(t.dm_verzoeken) == 1


def test_terug_van_de_login_op_een_telefoon_stuurt_de_dm_vanzelf(tab):
    t = tab(ingelogd=True, breedte=390, hoogte=844)
    t.open("/v2/organisations.html?flow=org")
    t.staat("dm-verstuurd")
    assert len(t.dm_verzoeken) == 1
    # De parameter is weg: verversen stuurt geen tweede DM.
    assert "flow=org" not in t.page.url


def test_flow_zonder_login_lust_niet_terug_naar_discord(tab):
    """Login afgebroken: terug met ?flow=org maar zonder sessie. Een melding, geen lus."""
    t = tab(ingelogd=False, breedte=390, hoogte=844)
    t.open("/v2/organisations.html?flow=org")
    vak = t.staat("uitgelogd")
    assert "Log in" in vak.inner_text()
    t.page.wait_for_timeout(400)
    assert t.logins == [] and t.dm_verzoeken == []


@pytest.mark.parametrize("soort,verwacht", [("myorg", "/myorg"), ("chooseorg", "/chooseorg"), ("start", "/start")])
def test_de_dm_zegt_wat_er_komt(tab, soort, verwacht):
    t = tab(ingelogd=True, breedte=390, hoogte=844,
            dm=({"delivered": True, "kind": soort, "reason": None}, 200)).open()
    t.klik()
    assert verwacht in t.staat("dm-verstuurd").inner_text()


def test_een_tweede_klik_binnen_de_afkoeltijd_zegt_dat_hij_al_onderweg_is(tab):
    t = tab(ingelogd=True, breedte=390, hoogte=844,
            dm=({"delivered": True, "kind": "myorg", "reason": None, "repeat": True}, 200)).open()
    t.klik()
    assert "already" in t.staat("dm-verstuurd").inner_text().lower()


# ---- de DM mislukt: nooit stil -------------------------------------------
LID = ({"available": True,
        "viewer": {"user_id": GEBRUIKER["id"], "org_id": 3, "rank": "specialist", "specialisation": "infiltrator",
                   "contribution": 0, "season_contribution": 0, "personal_rep": 0, "joined_at": None},
        "org": {"org_id": 3, "slug": "vanta", "name": "Vanta Collective", "emblem": "▽", "members": 7, "active": 4,
                "rep": 0, "invite": None, "theme": {}, "leader_id": None}}, 200)


def test_dms_dicht_toont_de_myorg_info_op_de_pagina(tab):
    t = tab(ingelogd=True, breedte=390, hoogte=844, me=LID,
            dm=({"delivered": False, "kind": "myorg", "reason": "dms_closed"}, 200)).open()
    t.klik()
    tekst = t.staat("dm-fallback").inner_text()
    assert "We couldn't DM you" in tekst and "Open Discord" in tekst
    assert "Vanta Collective" in tekst and "specialist" in tekst and "infiltrator" in tekst
    assert t.page.locator('[data-flow][data-staat="dm-fallback"] a[href^="https://discord.com"]').count() >= 1


def test_bot_onbereikbaar_zonder_org_toont_de_keuzelijst(tab):
    t = tab(ingelogd=True, breedte=390, hoogte=844,
            dm=({"delivered": False, "kind": None, "reason": "unavailable"}, 503)).open()
    t.klik()
    tekst = t.staat("dm-fallback").inner_text()
    assert "We couldn't DM you" in tekst
    assert "/chooseorg" in tekst
    for naam in ("Null Division", "Vanta Collective", "Aether Systems", "CyTek Industries"):
        assert naam in tekst


def test_geen_profiel_toont_start(tab):
    t = tab(ingelogd=True, breedte=390, hoogte=844,
            dm=({"delivered": False, "kind": "start", "reason": "dms_closed"}, 200)).open()
    t.klik()
    assert "/start" in t.staat("dm-fallback").inner_text()


def test_een_wegvallende_verbinding_is_ook_een_fallback(tab):
    t = tab(ingelogd=True, breedte=390, hoogte=844, dm="netwerk").open()
    t.klik()
    assert "We couldn't DM you" in t.staat("dm-fallback").inner_text()


def test_te_vaak_geklikt_is_ook_een_fallback(tab):
    t = tab(ingelogd=True, breedte=390, hoogte=844, me=LID,
            dm=({"error": "rate limited"}, 429)).open()
    t.klik()
    assert "Vanta Collective" in t.staat("dm-fallback").inner_text()


def test_ook_als_org_me_faalt_staat_er_iets_bruikbaars(tab):
    t = tab(ingelogd=True, breedte=390, hoogte=844, me=({"error": "boom"}, 500),
            dm=({"delivered": False, "kind": "myorg", "reason": "failed"}, 200)).open()
    t.klik()
    tekst = t.staat("dm-fallback").inner_text()
    assert "We couldn't DM you" in tekst and "/myorg" in tekst


# ---- de panelen -------------------------------------------------------------
def test_ledentallen_komen_van_de_api(tab):
    t = tab().open()
    t.page.wait_for_function("() => document.querySelector('[data-leden=\"vanta\"]').textContent.includes('7')")
    assert "11" in t.page.locator('[data-leden="cytek"]').inner_text()


def test_zonder_api_geen_verzonnen_ledental(tab):
    t = tab(orgs=({"error": "boom"}, 500)).open()
    t.page.wait_for_timeout(600)
    for slug in SLUGS:
        assert not re.search(r"\d", t.page.locator(f'[data-leden="{slug}"]').inner_text())


@pytest.mark.parametrize("breedte,hoogte", [(390, 844), (820, 1180), (1280, 900)])
def test_geen_horizontaal_scrollen_en_geen_externe_verzoeken(tab, breedte, hoogte):
    t = tab(breedte=breedte, hoogte=hoogte).open()
    t.page.wait_for_timeout(300)
    maat = t.page.evaluate("() => ({breed: document.documentElement.scrollWidth, scherm: innerWidth})")
    assert maat["breed"] <= maat["scherm"], maat
    assert t.extern == [], t.extern


@pytest.mark.parametrize("breedte,hoogte", [(390, 844), (1280, 900)])
def test_elke_zichtbare_tekst_haalt_aa(tab, breedte, hoogte):
    from test_v2_pagina import _AA
    t = tab(breedte=breedte, hoogte=hoogte).open()
    t.page.evaluate("() => document.querySelectorAll('[data-reveal]').forEach(e => e.classList.add('is-in'))")
    totaal = []
    geteld = 0
    # Per paneel in beeld: de meting slaat niets over, ook niet onder de vouw.
    for sel in ["body", ".op-null", ".op-vanta", ".op-aether", ".op-cytek"]:
        t.page.locator(sel).first.scroll_into_view_if_needed()
        uit = t.page.evaluate(_AA)
        totaal += uit["fout"]
        geteld = max(geteld, uit["geteld"])
    assert geteld > 30 and totaal == [], totaal


def test_de_fallback_haalt_ook_aa(tab):
    from test_v2_pagina import _AA
    t = tab(ingelogd=True, breedte=390, hoogte=844, me=LID,
            dm=({"delivered": False, "kind": "myorg", "reason": "dms_closed"}, 200)).open()
    t.klik()
    t.staat("dm-fallback")
    assert t.page.evaluate(_AA)["fout"] == []


def test_onder_v1_naar_de_vm(tab):
    t = tab(versie="v1")
    t.page.goto(f"{t.server}/v2/organisations.html", wait_until="commit")
    t.page.wait_for_url("**/arcade.html#the-vm", timeout=8000)


def test_de_nav_toont_de_login(tab):
    t = tab(ingelogd=True).open()
    t.page.wait_for_function("() => !document.querySelector('.nav-user').hidden")
    assert t.page.locator(".nav-user-naam").inner_text() == "tester"
    assert t.page.locator('.nav-links a[aria-current="page"]').inner_text() == "Organisations"


# --------------------------------------------------------------------------- #
# De afgeleide kleuren: uit de orgkleur en void, niet verzonnen
# --------------------------------------------------------------------------- #
def _hex(s):
    return tuple(int(s[i:i + 2], 16) for i in (1, 3, 5))


def _lum(c):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = map(f, c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _ratio(a, b):
    x, y = sorted([_lum(a), _lum(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)


@pytest.mark.parametrize("slug", list(SLUGS))
def test_het_paneel_is_de_orgkleur_door_het_donker_van_de_app(slug):
    """--op-bg = --dark-bg met de orgkleur voor (1 - void) + 12 %; --op-glow en
    --op-mark zijn de orgkleur zelf, of zo weinig naar wit als AA vraagt."""
    thema = _thema()[slug]
    css = (SITE / "v2" / "css" / "v2.css").read_text(encoding="utf-8")
    blok = _css_blok(css, SLUGS[slug])
    donker = _hex(re.search(r"--dark-bg:\s*(#[0-9A-Fa-f]{6})", css).group(1))
    org = _hex("#" + thema["color"][2:])
    t = (1 - float(thema["material"]["void"])) + 0.12
    verwacht = tuple(round(donker[i] * (1 - t) + org[i] * t) for i in range(3))
    bg = _hex(re.search(r"--op-bg:\s*(#[0-9A-Fa-f]{6})", blok).group(1))
    assert all(abs(bg[i] - verwacht[i]) <= 1 for i in range(3)), (slug, bg, verwacht)

    wit = (255, 255, 255)
    for naam, drempel in (("--op-glow", 4.5), ("--op-mark", 3.0)):
        k = _hex(re.search(rf"{naam}:\s*(#[0-9A-Fa-f]{{6}})", blok).group(1))
        assert _ratio(k, bg) >= drempel, (slug, naam)
        # Op de lijn orgkleur -> wit, en niet verder dan nodig (+3 % marge).
        s = 0.0 if k == org else max((k[i] - org[i]) / (255 - org[i]) for i in range(3) if org[i] < 255)
        op_lijn = tuple(round(org[i] * (1 - s) + 255 * s) for i in range(3))
        assert all(abs(op_lijn[i] - k[i]) <= 2 for i in range(3)), (slug, naam, k)
        if s > 0:
            minder = tuple(round(org[i] * (1 - (s - 0.03)) + 255 * (s - 0.03)) for i in range(3))
            assert _ratio(minder, bg) < drempel + 0.35, (slug, naam, "verder naar wit dan nodig")
