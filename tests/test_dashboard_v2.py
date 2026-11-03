"""Dashboard v2 (3-11-2026): de "Liquid"-look van serverkeuze, Server Center en
Security Center, in een echte browser.

WAT HIER WORDT VASTGEHOUDEN (per stap uitgebreid)
Stap 1, de schil (security.css "DASHBOARD V2 - BASIS", tokens.css --dv2-*, js/glas.js):
  * geen CSP-melding of paginafout, nergens breder dan het scherm (1440, 820, 390, 360);
  * hoogstens DRIE vlakken met backdrop-filter (zijpaneel, balk, venster);
  * desktop: een zwevend paneel; tablet: een rail van 76 px waarin elke knop zijn
    naam houdt voor een schermlezer; telefoon: de lade gaat open en met Esc dicht;
  * het toetsenbord: Tab komt op een menu-item met een zichtbare focusring;
  * vervorming alleen in Chromium, en niet bij minder beweging; zonder transparantie
    een effen paneel;
  * bij scrollen op 390 px met een vier keer tragere CPU geen frame boven 50 ms en
    hoogstens 2 % gemiste frames (zie snelheid(): de oude versie haalt 'nul boven 33 ms'
    op deze laptop ook niet).

Stap 2 tot en met 4 (serverkeuze, Server Center, Security Center), met gevulde
gegevens uit dashboard_v2_data.py:
  * elke pagina (9 + 20) op 1440, 820, 390 en 360: niet te breed, hoogstens drie
    glasvlakken, geen paginafout of CSP-melding, het juiste actieve menu-item;
    desktop en tablet een kale balk en een titel van 38 px met boventitel;
    telefoon een balk op een regel en een titel van 28 px;
  * meldingen en lege toestanden: een tint met pictogram, geen zijstreep of stippellijn;
  * de serverwisselaar (muis, toetsenbord, lade), de klikbare broodkruimel, het
    zoekveld met "/", geen focusring na een muisklik;
  * de serverkeuze met veel servers en een lange naam; contrast AA van de kleurparen.

DRAAIEN (een script, zoals de andere browsertests):
    cd site && python -m http.server 8899
    python tests/test_dashboard_v2.py [map-voor-schermafdrukken]
"""

from __future__ import annotations

import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright        # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
from test_tour import stub as security_stub            # noqa: E402
import welcome_previews as wp                           # noqa: E402

BASIS = os.environ.get("WELCOME_BASIS", "http://127.0.0.1:8899")
GID = wp.GID
FOUTEN: list[str] = []
SCHOTEN = sys.argv[1] if len(sys.argv) > 1 else None

BREEDTES = {"desktop": (1440, 900), "tablet": (820, 1180), "telefoon": (390, 844), "smal": (360, 740)}


def eis(voorwaarde, melding):
    print(("  ok   " if voorwaarde else "  FOUT ") + melding)
    if not voorwaarde:
        FOUTEN.append(melding)


def zonder_tour(page):
    """De rondleiding staat in de weg van wat hier gemeten wordt."""
    page.add_init_script("try { localStorage.setItem('bucky_tour_done_v1', '1'); } catch (e) {}")
    page.route("**/api/site/tour", lambda r: r.fulfill(status=200, content_type="application/json",
                                                        body=json.dumps({"enabled": False, "steps": []})))


def server_stub(page):
    wp.stub(page, wp.welcome_antwoord("welcome", {"v": 1, "accent": 0, "blocks": []}))
    page.route(f"**/api/server/{GID}/me", lambda r: wp.antwoord(r, {
        "can_view": True, "can_edit": True, "is_owner": True, "mode": "administrator", "user_id": "1",
        "tools": {"autorole": True, "verify": True, "ticket_forms": True}, "can_manage_server": True}))


def open_pagina(browser, soort, breed, *, media=None):
    w, h = BREEDTES[breed]
    page = browser.new_page(viewport={"width": w, "height": h})
    fouten = []
    page.on("pageerror", lambda e: fouten.append(str(e)))
    page.on("console", lambda m: fouten.append(m.text) if "Content Security Policy" in m.text else None)
    if media:
        cdp = page.context.new_cdp_session(page)
        cdp.send("Emulation.setEmulatedMedia", {"features": [{"name": media, "value": "reduce"}]})
    if soort == "security":
        security_stub(page)
    else:
        server_stub(page)
    zonder_tour(page)
    page.goto(f"{BASIS}/{soort}.html?guild_id={GID}#overview", wait_until="networkidle")
    page.wait_for_timeout(400)
    return page, fouten


def tel_blur(page):
    return page.evaluate("""() => [...document.querySelectorAll('body *')].filter(n => {
      const cs = getComputedStyle(n); const r = n.getBoundingClientRect();
      const f = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
      return f !== 'none' && r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    }).map(n => n.className || n.tagName)""")


def schiet(page, naam):
    if SCHOTEN:
        page.screenshot(path=os.path.join(SCHOTEN, naam + ".png"), full_page=False)


def stap1_schil(browser):
    for soort in ("server", "security"):
        for breed in BREEDTES:
            page, fouten = open_pagina(browser, soort, breed)
            label = f"{soort} {breed}"
            breder = page.evaluate("document.documentElement.scrollWidth - innerWidth")
            eis(breder <= 0, f"{label}: niet breder dan het scherm ({breder})")
            blur = tel_blur(page)
            eis(len(blur) <= 3, f"{label}: hoogstens drie glasvlakken ({blur})")
            zij = page.evaluate("""() => { const s = document.querySelector('.sec-sidebar'); const r = s.getBoundingClientRect();
              return {w: Math.round(r.width), x: Math.round(r.left), radius: getComputedStyle(s).borderTopLeftRadius}; }""")
            if breed == "desktop":
                eis(zij["w"] == 252 and zij["x"] == 16 and zij["radius"] == "30px", f"{label}: zwevend zijpaneel ({zij})")
                eis(page.evaluate("document.documentElement.classList.contains('glas-vervorming')"),
                    f"{label}: vervorming aan in Chromium")
            if breed == "tablet":
                eis(zij["w"] == 76, f"{label}: rail van 76 px ({zij})")
                namen = page.evaluate("""() => [...document.querySelectorAll('.sec-nav-item')].map(b => b.innerText.trim())""")
                zichtbaar = page.evaluate("""() => [...document.querySelectorAll('.sec-nav-item')].filter(b =>
                  [...b.children].some(c => !c.classList.contains('ic') && !c.classList.contains('dv2-teller')
                    && c.getBoundingClientRect().width > 2)).length""")
                eis(namen and all(namen) and zichtbaar == 0,
                    f"{label}: de rail toont alleen pictogrammen, elke knop houdt zijn naam ({len(namen)} knoppen)")
                eis(page.get_by_role("button", name="Overview").first.count() == 1, f"{label}: 'Overview' is als knop te vinden")
            if breed in ("telefoon", "smal"):
                hoofd = page.evaluate("document.querySelector('.sec-main').getBoundingClientRect().width")
                eis(hoofd >= BREEDTES[breed][0] - 2, f"{label}: de inhoud gebruikt de hele breedte ({hoofd:.0f} px)")
                balk = page.evaluate("document.querySelector('.sec-topbar').getBoundingClientRect().height")
                eis(balk <= 64, f"{label}: de balk past op een regel ({balk:.0f} px hoog)")
                page.locator("#sec-burger").click()
                page.wait_for_timeout(400)
                open_ = page.evaluate("document.querySelector('.sec-sidebar').getBoundingClientRect().left >= 0")
                page.keyboard.press("Escape")
                page.wait_for_timeout(400)
                dicht = page.evaluate("document.querySelector('.sec-sidebar').getBoundingClientRect().right <= 0")
                eis(open_ and dicht, f"{label}: de lade gaat open en met Esc dicht")
            if breed == "desktop":
                # De drie punten van 3-11-2026: achtergrond, ruimte boven de inhoud, de actieve pil.
                eis(page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgba(0, 0, 0, 0)",
                    f"{label}: body is doorzichtig, zodat gloed en golf zichtbaar zijn")
                import io
                from PIL import Image
                beeld = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
                r, g, b_ = beeld.getpixel((620, 6))
                eis(r > g + 8 and r > b_ + 4, f"{label}: bovenaan kleurt de rode gloed ({(r, g, b_)})")
                ruimte = page.evaluate("""() => {
                  const balk = document.querySelector('.sec-topbar').getBoundingClientRect().bottom;
                  const tekst = [...document.querySelectorAll('#sec-content *')].find(n => n.children.length === 0
                    && n.textContent.trim() && n.getBoundingClientRect().height > 0);
                  return {balk, tekst: tekst ? tekst.getBoundingClientRect().top : 999}; }""")
                eis(ruimte["tekst"] >= ruimte["balk"] + 8, f"{label}: de inhoud begint onder de balk ({ruimte})")
                pil = page.evaluate("""() => { const a = document.querySelector('.sec-nav-item.active'); const cs = getComputedStyle(a);
                  return {bg: cs.backgroundColor, img: cs.backgroundImage, outline: cs.outlineStyle}; }""")
                eis(pil["bg"] != "rgba(0, 0, 0, 0)" and pil["img"] == "none" and pil["outline"] == "none",
                    f"{label}: het actieve item is een gevulde pil zonder rand ({pil})")
            schiet(page, f"stap1-{soort}-{breed}")
            if breed == "desktop":
                page.keyboard.press("Tab")
                for _ in range(8):
                    if page.evaluate("document.activeElement.classList.contains('sec-nav-item')"):
                        break
                    page.keyboard.press("Tab")
                ring = page.evaluate("""() => { const a = document.activeElement; const cs = getComputedStyle(a);
                  return a.classList.contains('sec-nav-item') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; }""")
                eis(ring, f"{label}: Tab komt op een menu-item met een zichtbare focusring")
            eis(not fouten, f"{label}: geen paginafout of CSP-melding ({fouten[:2]})")
            page.close()

    # Minder transparantie: effen. Minder beweging: geen vervorming, wel blur.
    page, _ = open_pagina(browser, "server", "desktop", media="prefers-reduced-transparency")
    eis(page.evaluate("getComputedStyle(document.querySelector('.sec-sidebar')).backdropFilter") == "none",
        "minder transparantie: het zijpaneel is effen")
    page.close()
    page, _ = open_pagina(browser, "server", "desktop", media="prefers-reduced-motion")
    eis(not page.evaluate("document.documentElement.classList.contains('glas-vervorming')"),
        "minder beweging: geen vervorming")
    eis("blur" in page.evaluate("getComputedStyle(document.querySelector('.sec-sidebar')).backdropFilter"),
        "minder beweging: het blurglas blijft")
    page.close()


# ---------------------------------------------------------------------------
# Stap 2 tot en met 4 (3-11-2026): elke pagina in de taal van preview B
# ---------------------------------------------------------------------------
import dashboard_v2_data as dd                          # noqa: E402

SERVER_PAGINAS = ["overview", "commands", "tickets", "welcome", "applications", "submissions",
                  "autorole", "verify", "botprofile"]
SECURITY_PAGINAS = ["overview", "modules", "thresholds", "punishments", "protection", "ignore", "quarantine",
                    "incidents", "audit", "analytics", "health", "soc", "rulebuilder", "rules", "liveevents",
                    "snapshots", "rollback", "emergency", "settings", "advanced"]
SERVERS = [{"id": GID, "name": "Bucky HQ", "icon": None}, {"id": "222222222222222222", "name": "Design Guild", "icon": None},
           {"id": "333333333333333333", "name": "A very long server name that keeps going and going", "icon": None}]
# Meldingen en lege toestanden: een tint, geen streep en geen stippellijn.
MELDINGEN = ".srv-empty, .sec-empty, .sec-empty-card, .srv-warn, .sec-warn-card, .sec-alert, .srv-fout, .sec-warn-banner, .sec-toast, .sec-rb-block, .dv2-foutkaart"


def ingelogd(page, servers=SERVERS):
    page.add_init_script("localStorage.setItem('bucky_active_guild', JSON.stringify({id: '%s', name: 'Bucky HQ', icon: null}));" % GID)
    page.route("**/api/me", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(
        {"logged_in": True, "user": {"id": "123456789012345678", "username": "tommy", "global_name": "tommy", "avatar": None},
         "guilds": servers})))


def open_gevuld(browser, soort, key, breed, servers=SERVERS):
    w, h = BREEDTES[breed]
    page = browser.new_page(viewport={"width": w, "height": h})
    fouten = []
    page.on("pageerror", lambda e: fouten.append(str(e)))
    page.on("console", lambda m: fouten.append(m.text) if "Content Security Policy" in m.text else None)
    if soort == "security":
        security_stub(page); dd.stub_security(page, GID)
    else:
        server_stub(page); dd.stub_server(page, GID)
    zonder_tour(page)
    ingelogd(page, servers)
    page.goto(f"{BASIS}/{soort}.html?guild_id={GID}#{key}", wait_until="networkidle")
    page.wait_for_timeout(350)
    return page, fouten


def alle_paginas(browser):
    for soort, paginas in (("server", SERVER_PAGINAS), ("security", SECURITY_PAGINAS)):
        for key in paginas:
            for breed in BREEDTES:
                page, fouten = open_gevuld(browser, soort, key, breed)
                label = f"{soort}#{key} {breed}"
                st = page.evaluate("""(sel) => {
                  const r = (q) => { const n = document.querySelector(q); return n ? n.getBoundingClientRect() : null; };
                  const h1 = document.querySelector('#sec-content h1');
                  const balk = document.querySelector('.sec-topbar'); const bcs = getComputedStyle(balk);
                  const actief = document.querySelector('.sec-nav-item[aria-current="page"]');
                  const strepen = [...document.querySelectorAll(sel)].filter(n => n.getBoundingClientRect().width > 0).map(n => {
                    const cs = getComputedStyle(n);
                    return {c: n.className, links: parseFloat(cs.borderLeftWidth), stijl: cs.borderLeftStyle + ' ' + cs.borderTopStyle};
                  }).filter(x => x.links > 1.5 || x.stijl.includes('dashed') || x.stijl.includes('dotted'));
                  const tops = ['#sec-burger', '#sec-breadcrumb', '#sec-refresh'].map(q => r(q)).filter(Boolean)
                    .filter(b => b.width > 0).map(b => Math.round(b.top + b.height / 2));
                  return {breder: document.documentElement.scrollWidth - innerWidth,
                          h1: h1 ? getComputedStyle(h1).fontSize : null, fout: !!document.querySelector('.dv2-foutkaart'),
                          boven: !!document.querySelector('#sec-content .dv2-boven'),
                          balkBg: bcs.backgroundColor, balkBlur: bcs.backdropFilter, balkH: balk.getBoundingClientRect().height,
                          actief: actief ? actief.dataset.key : null, strepen, tops};
                }""", MELDINGEN)
                eis(st["breder"] <= 0, f"{label}: niet breder dan het scherm ({st['breder']})")
                blur = tel_blur(page)
                eis(len(blur) <= 3, f"{label}: hoogstens drie glasvlakken ({len(blur)})")
                eis(not st["fout"], f"{label}: de pagina laadt met gevulde gegevens (geen foutkaart)")
                eis(st["actief"] == (key if key != "advanced" else "overview") or (soort == "security" and key == "advanced"),
                    f"{label}: het actieve menu-item is {key} ({st['actief']})")
                eis(not st["strepen"], f"{label}: meldingen zonder zijstreep of stippellijn ({st['strepen'][:2]})")
                if breed in ("desktop", "tablet"):
                    eis(st["balkBg"] == "rgba(0, 0, 0, 0)" and st["balkBlur"] == "none",
                        f"{label}: de balk is kaal, zonder vlak en zonder glas")
                    eis(st["h1"] == "38px" and st["boven"], f"{label}: grote titel (38 px) met boventitel ({st['h1']}, {st['boven']})")
                else:
                    eis(st["balkH"] <= 64 and len(st["tops"]) >= 3 and max(st["tops"]) - min(st["tops"]) <= 6,
                        f"{label}: de telefoonbalk staat op een regel (menu, titel, Refresh) ({st['balkH']:.0f} px, {st['tops']})")
                    eis(st["h1"] == "28px", f"{label}: titel 28 px op een telefoon ({st['h1']})")
                eis(not fouten, f"{label}: geen paginafout of CSP-melding ({fouten[:2]})")
                if breed in ("desktop", "tablet", "telefoon"):
                    schiet(page, f"pagina-{soort}-{key}-{breed}")
                page.close()


def wisselaar(browser):
    for soort in ("server", "security"):
        for breed in ("desktop", "tablet", "telefoon"):
            page, fouten = open_gevuld(browser, soort, "overview", breed)
            label = f"wisselaar {soort} {breed}"
            if breed == "telefoon":
                page.locator("#sec-burger").click(); page.wait_for_timeout(400)
            knop = page.locator("#dv2-server-knop")
            knop.focus()
            page.keyboard.press("Enter")
            page.wait_for_timeout(300)
            st = page.evaluate("""() => { const p = document.getElementById('dv2-wissel'); const r = p.getBoundingClientRect();
              const items = [...p.querySelectorAll('.dv2-wissel-item')];
              return {open: !p.hidden, exp: document.getElementById('dv2-server-knop').getAttribute('aria-expanded'),
                      n: items.length, nu: items.filter(a => a.getAttribute('aria-current') === 'page').map(a => a.textContent),
                      alle: (document.getElementById('dv2-wissel-alle') || {}).getAttribute ? document.getElementById('dv2-wissel-alle').getAttribute('href') : null,
                      focus: document.activeElement.className, binnen: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0,
                      links: items.map(a => a.getAttribute('href'))}; }""")
            eis(st["open"] and st["exp"] == "true", f"{label}: Enter opent de wisselaar")
            eis(st["n"] == 3 and len(st["nu"]) == 1 and "Bucky HQ" in st["nu"][0], f"{label}: drie servers, de huidige gemarkeerd ({st['nu']})")
            eis(st["alle"] == "dashboard.html", f"{label}: onderaan 'All servers' naar de serverkeuze")
            eis(all(l.startswith(f"{soort}.html?guild_id=") for l in st["links"]), f"{label}: een server opent hetzelfde centrum")
            eis("is-nu" in st["focus"], f"{label}: de focus staat op de huidige server")
            eis(st["binnen"], f"{label}: de lijst staat binnen het scherm")
            page.keyboard.press("ArrowDown")
            eis(page.evaluate("document.activeElement.classList.contains('dv2-wissel-item') || document.activeElement.id === 'dv2-wissel-alle'"),
                f"{label}: pijl omlaag loopt door de lijst")
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            eis(page.evaluate("document.getElementById('dv2-wissel').hidden && document.activeElement.id === 'dv2-server-knop'"),
                f"{label}: Esc sluit en zet de focus terug op de knop")
            if breed == "telefoon":
                eis(page.evaluate("document.querySelector('.sec-sidebar').getBoundingClientRect().left >= 0"),
                    f"{label}: Esc in de wisselaar laat de lade open")
            eis(not fouten, f"{label}: geen paginafout ({fouten[:2]})")
            page.close()
    # Een server: de regel naar alle servers blijft.
    page, _ = open_gevuld(browser, "server", "overview", "desktop", servers=SERVERS[:1])
    page.locator("#dv2-server-knop").click(); page.wait_for_timeout(300)
    eis(page.locator(".dv2-wissel-item").count() == 1 and page.locator("#dv2-wissel-alle").is_visible(),
        "wisselaar met een server: die server en 'All servers'")
    page.mouse.click(900, 600); page.wait_for_timeout(200)
    eis(page.evaluate("document.getElementById('dv2-wissel').hidden"), "wisselaar: klik ernaast sluit hem")
    page.close()


def kruimel_en_zoeken(browser):
    for soort, doel in (("server", "tickets"), ("security", "modules")):
        page, _ = open_gevuld(browser, soort, doel, "desktop")
        eerste = page.locator("#sec-breadcrumb a.crumb-link")
        eis(eerste.count() == 1 and eerste.get_attribute("href") == "#overview", f"kruimel {soort}: het eerste deel is een link naar het overzicht")
        eerste.click(); page.wait_for_timeout(500)
        eis(page.evaluate("location.hash") == "#overview", f"kruimel {soort}: klikken opent het overzicht")
        page.locator("body").click(position={"x": 700, "y": 600})
        page.keyboard.press("/")
        eis(page.evaluate("document.activeElement.id") == "dv2-zoek", f"zoeken {soort}: '/' zet de focus in het zoekveld")
        page.keyboard.type(doel[:4])
        zichtbaar = page.evaluate("[...document.querySelectorAll('.sec-nav-item')].filter(b => !b.hidden && b.offsetParent).map(b => b.dataset.key)")
        eis(doel in zichtbaar and len(zichtbaar) < 5, f"zoeken {soort}: het menu filtert ({zichtbaar})")
        page.keyboard.press("Enter"); page.wait_for_timeout(500)
        eis(page.evaluate("location.hash") == "#" + doel, f"zoeken {soort}: Enter opent de eerste treffer")
        # Geen witte ring na een tik met de muis.
        page.locator(".sec-nav-item[data-key='overview']").click(); page.wait_for_timeout(300)
        ring = page.evaluate("""() => { const a = document.activeElement; return a && a !== document.body ? getComputedStyle(a).outlineStyle : 'none'; }""")
        eis(ring == "none", f"tik {soort}: geen blijvende focusring na een muisklik ({ring})")
        page.close()


def incidenten_filter(browser):
    page, _ = open_gevuld(browser, "security", "incidents", "desktop")
    eerste = page.evaluate("document.querySelector('.sec-toolbar select option').textContent")
    eis(eerste == "Any severity", f"incidenten: de eerste keuze van de ernstfilter heet 'Any severity' ({eerste})")
    page.close()


def meldingen(browser):
    """Lege toestand en waarschuwing: tint, een klein pictogram, de tekst blijft."""
    page, _ = open_gevuld(browser, "server", "verify", "desktop")
    page.evaluate("""() => { const c = document.getElementById('sec-content');
      const e = document.createElement('div'); e.className = 'srv-empty'; e.id = 't-leeg'; e.textContent = 'No panels yet';
      const w = document.createElement('div'); w.className = 'sec-card srv-warn'; w.id = 't-let'; w.textContent = 'Bucky cannot give roles here yet.';
      c.prepend(e, w); }""")
    for sel, naam in (("#t-leeg", "lege toestand"), ("#t-let", "waarschuwing")):
        st = page.evaluate("""(q) => { const n = document.querySelector(q); const cs = getComputedStyle(n); const v = getComputedStyle(n, '::before');
          return {bg: cs.backgroundImage, rand: cs.borderTopColor, ic: v.maskImage || v.webkitMaskImage, w: v.width, radius: cs.borderTopLeftRadius}; }""", sel)
        eis("gradient" in st["bg"] and "url(" in (st["ic"] or "") and st["w"] in ("18px", "20px", "22px") and float(st["radius"][:-2]) >= 16,
            f"melding {naam}: zachte tint, pictogram en ronde hoeken ({st})")
    page.close()


def kiezer(browser):
    for breed in ("desktop", "telefoon", "smal"):
        w, h = BREEDTES[breed]
        page = browser.new_page(viewport={"width": w, "height": h})
        fouten = []
        page.on("pageerror", lambda e: fouten.append(str(e)))
        page.on("console", lambda m: fouten.append(m.text) if "Content Security Policy" in m.text else None)
        page.route("**/api/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"ok": true, "data": {}}'))
        zonder_tour(page)
        page.route("**/api/site/features", lambda r: r.fulfill(status=200, content_type="application/json", body='{"features": {}}'))
        ingelogd(page, SERVERS + [{"id": str(500000000000000000 + i), "name": f"Server {i}", "icon": None} for i in range(12)])
        page.goto(f"{BASIS}/dashboard.html", wait_until="networkidle")
        page.wait_for_timeout(500)
        st = page.evaluate("""() => { const k = [...document.querySelectorAll('#guilds-container .server-card')];
          const naam = document.querySelector('.server-card .s-name');
          return {n: k.length, breder: document.documentElement.scrollWidth - innerWidth,
                  links: k.every(c => c.querySelector('a[href^="server.html?guild_id="]') && c.querySelector('a[href^="security.html?guild_id="]')),
                  knal: naam.scrollWidth > naam.clientWidth ? getComputedStyle(naam).textOverflow : 'past',
                  zoek: !document.getElementById('picker-search').hidden, h1: getComputedStyle(document.querySelector('.picker-title h1')).fontSize}; }""")
        label = f"serverkeuze {breed}"
        eis(st["n"] == 15 and st["links"], f"{label}: elke kaart heeft Open Server Center en Security ({st['n']})")
        eis(st["breder"] <= 0, f"{label}: niet breder dan het scherm ({st['breder']})")
        eis(st["knal"] in ("ellipsis", "past"), f"{label}: een lange naam wordt afgekapt ({st['knal']})")
        eis(st["zoek"], f"{label}: bij veel servers staat het zoekveld er")
        eis(st["h1"] == ("38px" if breed == "desktop" else "28px"), f"{label}: titel als in B ({st['h1']})")
        eis(len(tel_blur(page)) <= 3, f"{label}: hoogstens drie glasvlakken")
        eis(not fouten, f"{label}: geen paginafout of CSP-melding ({fouten[:2]})")
        schiet(page, f"kiezer-{breed}")
        page.close()


def _lum(hexkleur):
    r, g, b = (int(hexkleur[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def _meng(voor, achter, a):
    v = [int(voor[i:i + 2], 16) for i in (1, 3, 5)]; w = [int(achter[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(a * x + (1 - a) * y):02X}" for x, y in zip(v, w))


def contrast():
    """AA voor de kleurparen van de nieuwe look, op het lichtste vlak waar ze staan.
    Getinte meldingen: de tint (hoogstens 15 %) over het kaartvlak."""
    vlak, glas = "#141418", "#1E1E26"
    paren = [
        ("tekst op kaart", "#E6E6EC", vlak), ("tekst-2 op kaart", "#BDBDC6", vlak), ("tekst-3 op kaart", "#A2A2AC", vlak),
        ("groepsnaam op paneel", "#A2A2AC", glas), ("kop op paneel", "#F7F7FA", glas),
        ("wit op hoofdknop (onderkant)", "#FFFFFF", "#BE0A25"), ("wit op teller", "#FFFFFF", "#E8102E"),
        ("link op kaart", "#FF8A9A", vlak), ("groen chip", "#5FD69A", _meng("#5FD69A", vlak, 0.14)),
        ("oranje chip", "#F5B262", _meng("#F5B262", vlak, 0.15)), ("rood chip", "#FF7A8A", _meng("#FF7A8A", vlak, 0.12)),
        ("tekst in oranje melding", "#E6E6EC", _meng("#F5B262", vlak, 0.15)), ("tekst-2 in blauwe lege toestand", "#BDBDC6", _meng("#7DA0FF", vlak, 0.15)),
        ("tekst in rode fout", "#FFD3D9", _meng("#FF7A8A", vlak, 0.15)),
    ]
    for naam, v, a in paren:
        l1, l2 = sorted((_lum(v), _lum(a)), reverse=True)
        verhouding = (l1 + 0.05) / (l2 + 0.05)
        eis(verhouding >= 4.5, f"contrast {naam}: {verhouding:.2f}:1 (AA 4,5)")


FRAMES = """async () => {
  const tijden = []; let vorige = performance.now(); let loopt = true;
  const tel = (t) => { tijden.push(t - vorige); vorige = t; if (loopt) requestAnimationFrame(tel); };
  requestAnimationFrame(tel);
  const doel = document.scrollingElement;
  const hoog = Math.max(600, doel.scrollHeight - innerHeight);
  for (let r = 0; r < 3; r++) {
    for (let y = 0; y <= hoog; y += 40) { scrollTo(0, y); await new Promise(z => requestAnimationFrame(z)); }
    for (let y = hoog; y >= 0; y -= 40) { scrollTo(0, y); await new Promise(z => requestAnimationFrame(z)); }
  }
  loopt = false; return tijden.slice(5);
}"""


def snelheid(browser, paginas):
    for soort, hash_ in paginas:
        page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        cdp = page.context.new_cdp_session(page)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
        (security_stub if soort == "security" else server_stub)(page)
        zonder_tour(page)
        page.goto(f"{BASIS}/{soort}.html?guild_id={GID}{hash_}", wait_until="networkidle")
        page.wait_for_timeout(300)
        # Genoeg inhoud om te scrollen, ook op een lege pagina.
        page.evaluate("""() => { const c = document.getElementById('sec-content');
          const extra = document.createElement('div'); extra.style.height = '2400px'; c.appendChild(extra); }""")
        tijden = sorted(page.evaluate(FRAMES))
        gemist = sum(1 for t in tijden if t > 33.4)
        hapering = sum(1 for t in tijden if t > 50)
        # WAAROM NIET "NUL BOVEN 33 MS". Op deze laptop (RAM rond 89 %) haalt ook de
        # versie van VOOR v2 dat niet: 3 tot 21 gemiste frames per ronde, tegen 0 tot 7
        # voor v2 (nulmeting 3-11-2026). Een gemist frame is precies 33,4 ms: één
        # verversing. Wat hier wel vast staat: geen echte hapering (> 50 ms) en
        # hoogstens 2 % gemiste frames.
        eis(hapering == 0 and gemist <= 0.02 * len(tijden),
            f"snelheid {soort}{hash_} op 390 px, CPU 4x trager: geen frame boven 50 ms en hoogstens 2 % gemist "
            f"(mediaan {tijden[len(tijden) // 2]:.1f} ms, {gemist} van {len(tijden)} gemist, langste {tijden[-1]:.1f} ms)")
        page.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        print("Stap 1: de schil"); stap1_schil(browser)
        print("Stap 2-4: elke pagina, gevuld, op vier breedtes"); alle_paginas(browser)
        print("De serverwisselaar"); wisselaar(browser)
        print("Broodkruimel, zoeken, tikken"); kruimel_en_zoeken(browser)
        print("Incidenten: de ernstfilter"); incidenten_filter(browser)
        print("Meldingen en lege toestanden"); meldingen(browser)
        print("De serverkeuze"); kiezer(browser)
        print("Contrast"); contrast()
        print("Snelheid"); snelheid(browser, [("server", "#overview"), ("security", "#overview")])
        browser.close()
    if FOUTEN:
        print(f"\n{len(FOUTEN)} FOUT(EN)")
        sys.exit(1)
    print("\nalles ok")


if __name__ == "__main__":
    main()
