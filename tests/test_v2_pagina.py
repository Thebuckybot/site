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


ECHTE_STATS = {"stats": {"servers": 104, "members": 48213, "commands": 171}}


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
        self.page.route(f"{API}/api/site/features*", self._features)
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


# --------------------------------------------------------------------------- #
# C. De hero
# --------------------------------------------------------------------------- #
def test_het_heldenbeeld_heeft_afmetingen_varianten_en_wordt_vooraf_gehaald(v2):
    t = v2()
    img = t.page.evaluate("""() => {
      const i = document.querySelector('.hero-img');
      const s = document.querySelector('.hero picture source');
      const pre = document.querySelector('link[rel=preload][as=image]');
      return {w: i.getAttribute('width'), h: i.getAttribute('height'), prio: i.getAttribute('fetchpriority'),
              geladen: i.complete && i.naturalWidth > 0, bron: i.currentSrc,
              srcset: s.getAttribute('srcset'), type: s.getAttribute('type'),
              pre: pre && pre.getAttribute('imagesrcset')};
    }""")
    assert (img["w"], img["h"]) == ("1600", "900")
    assert img["prio"] == "high" and img["geladen"]
    assert img["type"] == "image/webp" and img["bron"].endswith(".webp")
    assert img["pre"] == img["srcset"], "de preload haalt een andere variant dan het beeld toont"
    from PIL import Image
    for deel in img["srcset"].split(","):
        pad, breedte = deel.split()
        bestand = (SITE / "v2" / pad).resolve()
        assert bestand.exists(), pad
        assert bestand.stat().st_size < 120_000, f"{pad} is {bestand.stat().st_size} bytes"
        assert Image.open(bestand).width == int(breedte[:-1])


def test_de_hero_draagt_exact_de_hoekkleur_en_het_beeld_vervaagt(v2):
    t = v2()
    uit = t.page.evaluate("""() => {
      const h = getComputedStyle(document.querySelector('.hero'));
      const i = getComputedStyle(document.querySelector('.hero-img'));
      return {bg: h.backgroundColor, masker: i.maskImage || i.webkitMaskImage};
    }""")
    assert uit["bg"] == "rgb(234, 237, 241)"          # #EAEDF1, de pixel linksboven
    assert "gradient" in uit["masker"] and "rgba(0, 0, 0, 0)" in uit["masker"]


_BURCHT = """() => {
  // Waar de rode burcht (66,1% van de breedte van de render) op het scherm
  // staat: object-fit cover, object-position, en dan de schaal rond de origin.
  const i = document.querySelector('.hero-img');
  const s = getComputedStyle(i);
  const m = s.transform === 'none' ? new DOMMatrix() : new DOMMatrix(s.transform);
  const w = i.offsetWidth, h = i.offsetHeight;          // de ongeschaalde doos
  const doos = i.getBoundingClientRect();
  const links = doos.left + (doos.width - w * m.a) / 2 * 0;   // offsetLeft hieronder
  let el = i, x0 = 0; while (el) { x0 += el.offsetLeft; el = el.offsetParent; }
  const schaal = Math.max(w / i.naturalWidth, h / i.naturalHeight);
  const breed = i.naturalWidth * schaal;
  const px = parseFloat(s.objectPosition) / 100;
  const xLokaal = 0.661 * breed - (breed - w) * px;
  const ox = parseFloat(s.transformOrigin);
  const xNa = ox + (xLokaal - ox) * m.a;
  return {burcht: x0 + xNa - scrollX, midden: innerWidth / 2, breedte: innerWidth};
}"""


def test_op_een_telefoon_staat_de_burcht_in_het_midden(v2):
    t = v2(breedte=390, hoogte=844)
    m = t.page.evaluate(_BURCHT)
    assert abs(m["burcht"] - m["midden"]) < 0.08 * m["breedte"], m


def test_op_een_breed_scherm_staat_de_burcht_rechts_en_de_kop_links(v2):
    t = v2(breedte=1280)
    m = t.page.evaluate(_BURCHT)
    assert m["burcht"] > 0.6 * m["breedte"], m
    kop = t.page.evaluate("() => document.querySelector('.hero-title').getBoundingClientRect().right")
    assert kop < m["burcht"] - 150
    # "More than a bot." op een regel, "A universe." eronder
    regels = t.page.evaluate("""() => [...document.querySelectorAll('.hero-title .hero-line')]
        .map(l => Math.round(l.getBoundingClientRect().height))""")
    hoogte = t.page.evaluate("() => parseFloat(getComputedStyle(document.querySelector('.hero-title')).lineHeight)")
    assert len(regels) == 2 and all(h <= hoogte * 1.2 for h in regels), (regels, hoogte)


# --------------------------------------------------------------------------- #
# C4. De stats-balk: echte cijfers of niets
# --------------------------------------------------------------------------- #
def _balk(page):
    return page.evaluate("""() => {
      const b = document.querySelector('[data-stats]');
      return {zichtbaar: !b.hidden && b.offsetParent !== null,
              vakken: [...b.querySelectorAll('.stat')].map(s => [s.querySelector('dt').textContent,
                       s.querySelector('dd .sr-only').textContent])};
    }""")


def test_de_balk_toont_de_echte_cijfers(v2):
    t = v2(minder_beweging=True)
    t.page.wait_for_function("() => !document.querySelector('[data-stats]').hidden")
    assert _balk(t.page)["vakken"] == [["Discord servers", "104"], ["Members reached", "48,213"],
                                       ["Commands", "171"]]


def test_wat_ontbreekt_of_geen_echt_getal_is_valt_weg(v2):
    # members 0 en commands als tekst vallen weg; players_week en organisations
    # zijn sinds 13-10 geen tegel meer, ook niet als een oude backend ze stuurt.
    t = v2(stats={"stats": {"servers": 104, "members": 0, "commands": "171",
                            "players_week": 33, "organisations": 4, "verzonnen": 999}},
           minder_beweging=True)
    t.page.wait_for_function("() => !document.querySelector('[data-stats]').hidden")
    assert _balk(t.page)["vakken"] == [["Discord servers", "104"]]


@pytest.mark.parametrize("stats", ["afbreken", 500, 503, {"stats": {}}, {"stats": None}, {"iets": 1},
                                   {"stats": {"servers": 0, "members": -3, "commands": None}}],
                         ids=["afbreken", "500", "503", "leeg", "null", "geen-stats", "nul-en-negatief"])
def test_zonder_echte_cijfers_blijft_de_balk_weg(v2, stats):
    t = v2(stats=stats)
    t.page.wait_for_timeout(600)
    b = _balk(t.page)
    assert not b["zichtbaar"] and b["vakken"] == []
    tekst = t.page.evaluate("() => document.querySelector('.hero').innerText")
    assert " 0 " not in f" {tekst} "


def test_de_cijfers_tellen_op_en_eindigen_op_het_echte_getal(v2):
    t = v2()
    t.page.wait_for_function("() => !document.querySelector('[data-stats]').hidden")
    t.page.wait_for_timeout(1500)
    zicht = t.page.evaluate(
        "() => [...document.querySelectorAll('.stat dd [aria-hidden]')].map(s => s.textContent)")
    assert zicht == ["104", "48,213", "171"]


def test_met_minder_beweging_staat_het_getal_er_meteen(v2):
    t = v2(minder_beweging=True)
    t.page.wait_for_function("() => !document.querySelector('[data-stats]').hidden")
    zicht = t.page.evaluate(
        "() => [...document.querySelectorAll('.stat dd [aria-hidden]')].map(s => s.textContent)")
    assert zicht == ["104", "48,213", "171"]


# --------------------------------------------------------------------------- #
# H. Geen layout-shift
# --------------------------------------------------------------------------- #
_CLS = """() => new Promise((klaar) => {
  let som = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) som += e.value; })
    .observe({type: 'layout-shift', buffered: true});
  setTimeout(() => klaar(som), 2200);
})"""


@pytest.mark.parametrize("breedte,hoogte", [(390, 844), (820, 1180), (1280, 900)])
def test_geen_layout_shift_ook_niet_als_de_cijfers_binnenkomen(v2, breedte, hoogte):
    t = v2(breedte=breedte, hoogte=hoogte)
    cls = t.page.evaluate(_CLS)
    assert cls < 0.01, cls


@pytest.mark.parametrize("breedte,hoogte", [(390, 844), (1280, 900)])
def test_geen_layout_shift_als_de_cijfers_wegblijven(v2, breedte, hoogte):
    t = v2(breedte=breedte, hoogte=hoogte, stats="afbreken")
    assert t.page.evaluate(_CLS) < 0.01


# --------------------------------------------------------------------------- #
# Over alles: AA tegen wat er werkelijk achter de tekst staat
# --------------------------------------------------------------------------- #
_AA = r"""() => {
  const rgba = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x)); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (boven, onder) => { const a = boven[3]; return [0, 1, 2].map(i => boven[i] * a + onder[i] * (1 - a)).concat(1); };
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = (k) => 0.2126 * lin(k[0]) + 0.7152 * lin(k[1]) + 0.0722 * lin(k[2]);
  const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const achtergrond = (el) => {
    const lagen = [];
    for (let n = el; n; n = n.parentElement) {
      const k = rgba(getComputedStyle(n).backgroundColor);
      if (k && k[3] > 0) { lagen.push(k); if (k[3] >= 1) break; }
    }
    let kleur = [250, 250, 252, 1];
    for (let i = lagen.length - 1; i >= 0; i--) kleur = over(lagen[i], kleur);
    return kleur;
  };
  const fout = [];
  let geteld = 0;
  const loper = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const gezien = new Set();
  while (loper.nextNode()) {
    const tekst = loper.currentNode; const el = tekst.parentElement;
    if (!tekst.textContent.trim() || gezien.has(el)) continue; gezien.add(el);
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || el.closest('.sr-only,[hidden]')) continue;
    let zicht = 1; for (let n = el; n; n = n.parentElement) zicht *= parseFloat(getComputedStyle(n).opacity);
    if (zicht < 0.99) continue;
    geteld++;
    const voor = rgba(s.color); const bg = achtergrond(el);
    const groot = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && parseInt(s.fontWeight) >= 700);
    const r2 = ratio(over(voor, bg), bg);
    if (r2 < (groot ? 3 : 4.5)) fout.push(`${el.tagName}.${el.className} "${tekst.textContent.trim().slice(0, 30)}" ${r2.toFixed(2)}:1`);
  }
  return {fout, geteld};
}"""


@pytest.mark.parametrize("breedte,hoogte", [(390, 844), (1280, 900)])
def test_elke_zichtbare_tekst_haalt_aa(v2, breedte, hoogte):
    t = v2(breedte=breedte, hoogte=hoogte, minder_beweging=True)
    t.page.wait_for_function("() => !document.querySelector('[data-stats]').hidden")
    uit = t.page.evaluate(_AA)
    assert uit["geteld"] > 20, "de meting zag bijna geen tekst; dan bewijst hij niets"
    assert uit["fout"] == []


def test_de_aa_meting_ziet_een_slecht_paar(v2):
    """De meting hierboven kan alleen groen zijn als hij rood ZOU worden."""
    t = v2(minder_beweging=True)
    t.page.evaluate("""() => { const p = document.createElement('p'); p.textContent = 'proef';
      p.style.color = '#FF465C'; p.style.background = '#EAEDF1'; p.style.fontSize = '16px';
      document.querySelector('.hero-copy').append(p); }""")
    assert any("proef" in f for f in t.page.evaluate(_AA)["fout"])


# --------------------------------------------------------------------------- #
# D. De vier systemen
# --------------------------------------------------------------------------- #
def test_vier_kaarten_met_een_titel_en_een_regel(v2):
    t = v2()
    kaarten = t.page.evaluate("""() => [...document.querySelectorAll('.cards .card')].map(k => ({
      titel: k.querySelector('h3').textContent.trim(),
      tekst: k.querySelector('.card-text').textContent.trim(),
      href: k.getAttribute('href')}))""")
    assert [k["titel"] for k in kaarten] == ["Security", "Economy", "Organisations", "Arcade"]
    for k in kaarten:
        assert k["tekst"].endswith(".") and k["tekst"].count(".") == 1, k   # een zin
        assert k["href"], k
    assert t.page.locator(".bridge-title").inner_text().strip() == "Four systems. One platform."


def test_de_iconen_zijn_een_familie(v2):
    """Zelfde grid, zelfde streek, ronde uiteinden: de familie van de app."""
    t = v2()
    iconen = t.page.evaluate("""() => [...document.querySelectorAll('.card-icon svg')].map(s => ({
      box: s.getAttribute('viewBox'), streek: s.getAttribute('stroke-width'),
      kap: s.getAttribute('stroke-linecap'), hoek: s.getAttribute('stroke-linejoin'),
      vulling: s.getAttribute('fill')}))""")
    assert len(iconen) == 4
    assert all(i == {"box": "0 0 24 24", "streek": "1.75", "kap": "round", "hoek": "round", "vulling": "none"}
               for i in iconen), iconen


def test_org_en_arcade_zijn_de_iconen_van_de_app_zelf():
    """Hergebruik, geen namaak: de paden van `org` en `challenge` uit de app."""
    app = SITE.parent / "app" / "src" / "ui" / "iconen" / "LijnIcoon.tsx"
    if not app.exists():
        pytest.skip("app/ staat niet naast site/ in deze checkout")
    import re
    bron = app.read_text(encoding="utf-8")
    html = (SITE / "v2" / "index.html").read_text(encoding="utf-8")
    for naam in ("org", "challenge"):
        blok = re.search(rf"\n  {naam}: \[(.*?)\n  \],", bron, re.S).group(1)
        for d in re.findall(r'd: "([^"]+)"', blok):
            assert f'd="{d}"' in html, (naam, d)


def test_een_kaart_komt_omhoog_met_een_zachte_rode_gloed(v2):
    # Zonder beweging: anders scrolt `scroll-behavior: smooth` ook de muis van
    # Playwright weg van de kaart. Het eindbeeld van de hover is hetzelfde.
    t = v2(minder_beweging=True)
    kaart = t.page.locator(".cards .card").first
    kaart.scroll_into_view_if_needed()
    voor = kaart.evaluate("k => getComputedStyle(k).boxShadow")
    kaart.hover()
    t.page.wait_for_timeout(450)
    na = kaart.evaluate("k => ({t: getComputedStyle(k).transform, s: getComputedStyle(k).boxShadow})")
    assert na["t"] != "none" and na["t"].endswith("-4)"), na
    assert "rgba(255, 70, 92" in na["s"] and na["s"] != voor


# --------------------------------------------------------------------------- #
# E. De donkere Security-sectie
# --------------------------------------------------------------------------- #
def test_de_security_sectie_is_het_warme_bijna_zwart_van_de_app(v2):
    t = v2()
    bg = t.page.evaluate("() => getComputedStyle(document.querySelector('#security')).backgroundColor")
    assert bg == "rgb(14, 13, 16)"          # #0E0D10, palette.dark.bg in de app


def test_de_lijst_noemt_alleen_wat_security_v2_heeft(v2):
    t = v2()
    koppen = t.page.evaluate("() => [...document.querySelectorAll('.secure-list h3')].map(h => h.textContent)")
    assert koppen == ["Anti-Nuke", "Anti-Raid", "Auto-Moderation", "Live incidents and recovery"]
    # "Real-Time Alerts" uit de brief staat er met opzet niet: dat bestaat niet als
    # functie. Komt hij er ooit bij, dan eerst in de bot.
    assert not t.page.locator("text=Real-Time Alerts").count()


def test_het_kaartje_is_een_voorbeeld_en_zegt_dat(v2):
    t = v2()
    paneel = t.page.evaluate("""() => {
      const p = document.querySelector('.secure-panel');
      return {tekst: p.innerText, label: document.getElementById(p.getAttribute('aria-labelledby')).textContent};
    }""")
    assert "EXAMPLE" in paneel["tekst"].upper()
    assert "not live data" in paneel["label"]
    import re
    assert not re.search(r"\d", paneel["tekst"]), "een getal in een voorbeeld leest als een echte telling"


def test_de_modules_in_het_kaartje_bestaan_echt():
    import re
    bron = SITE.parent / "bucky1.0" / "cogs" / "security_v2" / "constants.py"
    if not bron.exists():
        pytest.skip("de bot-boom staat niet naast site/ in deze checkout")
    echt = set(re.findall(r'"label":\s*"([^"]+)"', bron.read_text(encoding="utf-8")))
    html = (SITE / "v2" / "index.html").read_text(encoding="utf-8")
    getoond = re.findall(r'<li class="panel-row"><span>([^<]+)</span>', html)
    getoond.append(re.search(r'class="panel-incident-name">([^<]+)<', html).group(1))
    assert getoond and set(getoond) <= echt, set(getoond) - echt


def test_de_knop_naar_het_security_center_volgt_de_dashboardvlag(v2):
    t = v2(features={"premium": True, "dashboard": False})
    t.page.wait_for_function("() => document.querySelector('.btn-on-dark').hidden")
    assert not t.page.locator(".btn-on-dark").is_visible()



# --------------------------------------------------------------------------- #
# F. Het slot en de vier orgs
# --------------------------------------------------------------------------- #
def test_de_vier_orgs_met_hun_echte_naam_en_crest(v2):
    import re
    bron = SITE.parent / "bucky1.0" / "cogs" / "data" / "organizations.py"
    t = v2()
    orgs = t.page.evaluate("""() => [...document.querySelectorAll('.org')].map(o => ({
      naam: o.querySelector('.org-name').textContent,
      streek: getComputedStyle(o.querySelector('.crest path')).stroke,
      paden: o.querySelectorAll('.crest path').length}))""")
    assert [o["naam"] for o in orgs] == ["Null Division", "Vanta Collective", "Aether Systems", "CyTek Industries"]
    if bron.exists():
        echt = set(re.findall(r'"name":\s*"([^"]+)"', bron.read_text(encoding="utf-8")))
        assert {o["naam"] for o in orgs} <= echt
    # de streek is de -mark-kleur van de org (3:1 op licht, test_v2_contrast.py)
    assert [o["streek"] for o in orgs] == ["rgb(98, 108, 126)", "rgb(30, 157, 52)",
                                           "rgb(16, 42, 84)", "rgb(175, 126, 12)"]
    assert all(o["paden"] >= 4 for o in orgs)


def test_de_crests_zijn_die_van_de_app():
    """De paden zonder afgeleide (rand, embleem) letterlijk uit Crest.tsx."""
    import re
    app = SITE.parent / "app" / "src" / "ui" / "crests" / "Crest.tsx"
    if not app.exists():
        pytest.skip("app/ staat niet naast site/ in deze checkout")
    bron = app.read_text(encoding="utf-8")
    html = (SITE / "v2" / "index.html").read_text(encoding="utf-8")
    letterlijk = re.findall(r'\{ d: "([^"]+)", streek', bron)
    assert len(letterlijk) >= 8
    for d in letterlijk:
        assert f'd="{d}"' in html, d


def test_het_slot_nodigt_uit_met_de_echte_invite(v2):
    t = v2()
    knop = t.page.locator(".closing .btn-signal")
    assert knop.inner_text().strip() == "Invite Bucky"
    assert knop.get_attribute("href") == INVITE


def test_elk_anker_op_de_pagina_heeft_een_doel(v2):
    t = v2()
    zonder = t.page.evaluate("""() => [...document.querySelectorAll('a[href^="#"]')]
      .map(a => a.getAttribute('href')).filter(h => h.length > 1 && !document.getElementById(h.slice(1)))""")
    assert zonder == []


# --------------------------------------------------------------------------- #
# G. Beweging, ingetogen
# --------------------------------------------------------------------------- #
_ZICHT = """() => [...document.querySelectorAll('[data-reveal]')].map(e => parseFloat(getComputedStyle(e).opacity))"""


def test_met_minder_beweging_staat_alles_stil_en_zichtbaar(v2):
    t = v2(minder_beweging=True)
    assert not t.page.evaluate("() => document.documentElement.classList.contains('v2-motion')")
    assert all(o == 1 for o in t.page.evaluate(_ZICHT))
    t.page.evaluate("() => window.scrollTo(0, 500)")
    t.page.wait_for_timeout(200)
    assert t.page.evaluate("() => document.querySelector('.hero-media').style.transform") == ""


def test_met_beweging_komen_secties_binnen_en_staan_ze_daarna_helemaal(v2):
    t = v2()
    assert t.page.evaluate("() => document.documentElement.classList.contains('v2-motion')")
    voor = t.page.evaluate(_ZICHT)
    assert min(voor) < 1, "onder de vouw hoort het nog te wachten"
    hoogte = t.page.evaluate("() => document.body.scrollHeight")
    for y in range(0, hoogte, 400):
        t.page.evaluate(f"() => window.scrollTo(0, {y})")
        t.page.wait_for_timeout(120)
    t.page.wait_for_timeout(1000)
    assert all(o == 1 for o in t.page.evaluate(_ZICHT))


def test_een_link_naar_een_sectie_toont_hem_en_laat_niets_half_staan(v2, server):
    """Een link naar #security: als het scrollen klaar is, staat alles wat in
    beeld is er helemaal. Wat bij het laden al in beeld stond, krijgt meteen
    zijn eindstand (v2.js), zodat het niet eerst verdwijnt."""
    t = v2()
    t.page.goto(f"{server}/v2/?site=v2#security", wait_until="load")
    t.page.wait_for_function("() => document.documentElement.classList.contains('v2-motion')")
    vorige = -1
    for _ in range(40):                      # wachten tot het zachte scrollen stilstaat
        y = t.page.evaluate("() => scrollY")
        if y == vorige and y > 0:
            break
        vorige = y
        t.page.wait_for_timeout(100)
    t.page.wait_for_timeout(900)
    in_beeld = t.page.evaluate("""() => [...document.querySelectorAll('[data-reveal]')].filter(e => {
        const r = e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; })
      .map(e => parseFloat(getComputedStyle(e).opacity))""")
    assert in_beeld and all(o == 1 for o in in_beeld), in_beeld


def test_de_parallax_is_een_paar_pixels_en_alleen_op_een_breed_scherm(v2):
    t = v2(breedte=1280)
    t.page.evaluate("() => window.scrollTo(0, 600)")
    t.page.wait_for_timeout(250)
    y = t.page.evaluate("() => new DOMMatrix(getComputedStyle(document.querySelector('.hero-media')).transform).m42")
    assert 0 < y <= 50, y
    s = v2(breedte=390, hoogte=844)
    s.page.evaluate("() => window.scrollTo(0, 600)")
    s.page.wait_for_timeout(250)
    assert s.page.evaluate("() => getComputedStyle(document.querySelector('.hero-media')).transform") == "none"


def test_geen_fouten_in_de_console(browser, server):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    fouten = []
    pg.on("pageerror", lambda e: fouten.append(str(e)))
    pg.on("console", lambda m: fouten.append(m.text) if m.type == "error" and "net::" not in m.text
          and "Failed to load resource" not in m.text else None)
    pg.route("**/*", lambda r: r.continue_() if urlsplit(r.request.url).hostname == "127.0.0.1" else r.abort())
    pg.goto(f"{server}/v2/?site=v2", wait_until="load")
    pg.wait_for_timeout(800)
    pg.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
    pg.wait_for_timeout(500)
    ctx.close()
    assert fouten == []


# --------------------------------------------------------------------------- #
# H. Performance: een budget, zodat het licht blijft
# --------------------------------------------------------------------------- #
#: Alles wat v2 bij het laden ophaalt, ongecomprimeerd (GitHub Pages comprimeert
#: tekst nog). Gemeten op 12-10-2026: 201 KB (60 KB daarvan het heldenbeeld). Wie hier
#: overheen gaat, voegt iets zwaars toe en moet dat met een reden doen.
BUDGET_BYTES = 260_000


@pytest.mark.parametrize("breedte,hoogte", [(390, 844), (1280, 900)])
def test_de_pagina_blijft_binnen_het_budget(v2, breedte, hoogte):
    t = v2(breedte=breedte, hoogte=hoogte)
    t.page.wait_for_timeout(500)
    bytes_ = t.page.evaluate("""() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return [nav, ...performance.getEntriesByType('resource')]
        .filter(e => e.name.startsWith(location.origin))
        .reduce((s, e) => s + (e.decodedBodySize || 0), 0);
    }""")
    assert 0 < bytes_ < BUDGET_BYTES, bytes_


def test_alleen_de_eigen_site_en_de_eigen_api(v2):
    """Geen derde partijen: geen fonts-CDN, geen GSAP van unpkg, geen tracker."""
    t = v2()
    t.page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
    t.page.wait_for_timeout(600)
    hosts = {urlsplit(u).hostname for u in t.verzoeken if u.startswith("http")}
    assert hosts <= {"127.0.0.1", "api.buckybot.app"}, hosts
