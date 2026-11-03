"""De premiumpagina in de taal van het dashboard (4-11-2026), in een echte browser.

WAT HIER WORDT VASTGEHOUDEN
  * op 1440, 820, 390 en 360, niet ingelogd en ingelogd (met een tier en een
    wachtende cache): niet breder dan het scherm, hoogstens drie glasvlakken,
    geen paginafout of CSP-melding;
  * elke koopknop wijst naar de store_url uit de data, opent in een nieuw tabblad,
    en draagt dezelfde tekst als voorheen ("Get <tier>", "Buy <looptijd>", "Buy <naam>");
  * één uitgelichte tier: het woord "Recommended", de rode hoofdknop alleen daar;
  * de vergelijking geeft per tier dezelfde waarden als de kaart;
  * de teksten over prijzen, facturering, terugbetaling en de uitleg staan er
    letterlijk zoals ze stonden (TEKSTEN hieronder; verander ze alleen samen met
    de pagina, en nooit voor de opmaak);
  * titel en beschrijving blijven; minder transparantie maakt de balk effen,
    minder beweging zet de draaiende rand stil; contrast AA van de kleurparen.

DRAAIEN (een script, zoals de andere browsertests):
    cd site && python -m http.server 8899
    python tests/test_premium_v2.py
"""

from __future__ import annotations

import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright        # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
from test_premium_boosts import _tier, BOOSTS, CIPHER   # noqa: E402

BASIS = os.environ.get("WELCOME_BASIS", "http://127.0.0.1:8899")
FOUTEN: list[str] = []
BREEDTES = {"desktop": (1440, 900), "tablet": (820, 1180), "telefoon": (390, 844), "smal": (360, 740)}

TIERS = [_tier("bucky_plus", 1, "Bucky+", "$4.99 / month"), _tier("pro", 2, "Bucky Pro", "$9.99 / month"),
         _tier("elite", 3, "Elite", "$14.99 / month"),
         _tier("legend", 4, "Legend with a rather long tier name that keeps going", "$24.99 / month")]
for _i, _t in enumerate(TIERS):
    _t["boost"] = [1.2, 1.35, 1.5, 2][_i]
    _t["challenge_bonus"] = [10, 15, 25, 40][_i]
    _t["shards_monthly"] = [1500000, 3000000, 6250000, 12000000][_i]
    _t["contents"] = [f"{n}x Pixel Banknote" for n in range(_i + 2)]
TIERS[2]["featured"] = True
# badge_url zoals de bot hem stuurt: de PNG in assets/badges/. De laatste tier heeft
# een badge zonder WebP-versie: die moet terugvallen op de PNG zelf.
for _t, _k in zip(TIERS, ("bucky_plus", "bucky_plusplus", "elite", "overclock")):
    _t["badge_url"] = f"{BASIS}/assets/badges/{_k}.png"
for _b in BOOSTS:
    _b["badge_url"] = f"{BASIS}/assets/badges/boost.png"
for _c in CIPHER:
    _c["badge_url"] = f"{BASIS}/assets/badges/cipher.png"
RIJEN = TIERS + BOOSTS + CIPHER

# Letterlijk uit premium.html: prijs, facturering, terugbetaling en de uitleg.
TEKSTEN = [
    "Prices and billing are handled by Discord. Buying opens Discord's own store page for that tier.",
    "One-time purchases, not a subscription. The clock starts when you assign a boost, so a boost you keep in "
    "reserve does not run out. Sold by Discord; a boost is a licence, not property, and is not refundable once delivered.",
    "One-time purchases. Sold by Discord; Cipher is credited once and is not refundable once delivered. "
    "Your balance shows on +balance.",
    "Subscribing twice in the same month still gives one cache. Upgrading mid-month lifts the waiting cache to the higher tier.",
    "It is not part of your balance and not part of your net worth, so it is out of reach of robberies by construction "
    "- there is nothing there to take.",
]


def eis(voorwaarde, melding):
    print(("  ok   " if voorwaarde else "  FOUT ") + melding)
    if not voorwaarde:
        FOUTEN.append(melding)


def open_premium(browser, breed, ingelogd, *, media=None):
    w, h = BREEDTES[breed]
    page = browser.new_page(viewport={"width": w, "height": h})
    fouten = []
    page.on("pageerror", lambda e: fouten.append(str(e)))
    page.on("console", lambda m: fouten.append(m.text) if "Content Security Policy" in m.text else None)
    if media:
        cdp = page.context.new_cdp_session(page)
        cdp.send("Emulation.setEmulatedMedia", {"features": [{"name": media, "value": "reduce"}]})
    page.route("**/api.buckybot.app/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"ok": true, "data": {}}'))
    page.route("**/api/site/features", lambda r: r.fulfill(status=200, content_type="application/json",
                                                         body=json.dumps({"features": {"premium": True}})))
    me = {"signed_in": True, "tier": {"tier_key": "elite", "name": "Elite"}, "waiting": 1} if ingelogd else {"signed_in": False}
    page.route("**/api/premium/me", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(me)))
    page.route("**/api/premium/tiers", lambda r: r.fulfill(status=200, content_type="application/json",
                                                         body=json.dumps({"available": True, "tiers": RIJEN})))
    if ingelogd:
        page.route("**/api/me*", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(
            {"logged_in": True, "user": {"id": "1200000000000000001", "username": "tommy", "avatar": None}, "guilds": []})))
    # Alleen verschuivingen IN de inhoud (#pr-main). De gedeelde balk schuift op elke
    # pagina een beetje zodra nav-auth.js het menu vult; dat hoort niet bij deze pagina.
    page.add_init_script("""window.__ls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      const inhoud = (e.sources || []).some(b => b.node && b.node.closest && b.node.closest('#pr-main'));
      if (inhoud) window.__ls += e.value; } }).observe({type: 'layout-shift', buffered: true});""")
    page.goto(f"{BASIS}/premium.html", wait_until="networkidle")
    page.wait_for_selector("#pr-grid .pr-card", timeout=15000)
    page.wait_for_timeout(300)
    return page, fouten


def tel_blur(page):
    return page.evaluate("""() => [...document.querySelectorAll('body *')].filter(n => {
      const cs = getComputedStyle(n); const r = n.getBoundingClientRect();
      const f = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
      return f !== 'none' && r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    }).length""")


def pagina(browser):
    for ingelogd in (False, True):
        for breed in BREEDTES:
            page, fouten = open_premium(browser, breed, ingelogd)
            label = f"premium {'ingelogd' if ingelogd else 'niet ingelogd'} {breed}"
            eis(page.evaluate("document.documentElement.scrollWidth - innerWidth") <= 0, f"{label}: niet breder dan het scherm")
            eis(tel_blur(page) <= 3, f"{label}: hoogstens drie glasvlakken")
            st = page.evaluate("""() => {
              const kaarten = [...document.querySelectorAll('.pr-card')];
              const knoppen = [...document.querySelectorAll('a.pr-buy')].map(a => ({href: a.getAttribute('href'), doel: a.target,
                  tekst: a.firstChild.textContent, rood: getComputedStyle(a).backgroundImage.includes('gradient'),
                  aanrader: !!a.closest('.pr-card-featured')}));
              const vgl = document.querySelector('#pr-vergelijk table');
              const kolommen = vgl ? [...vgl.querySelectorAll('thead th')].length - 1 : 0;
              const waarden = vgl ? [...vgl.querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(t => t.textContent)) : [];
              const kaartWaarden = [...document.querySelectorAll('#pr-grid .pr-card')].map(k =>
                  [...k.querySelectorAll('.pr-stats dd')].map(d => d.textContent));
              return {n: kaarten.length, knoppen, kolommen, waarden, kaartWaarden,
                      aanbevolen: [...document.querySelectorAll('#pr-grid .pr-featured-flag')].map(f => f.textContent),
                      jij: !document.getElementById('pr-you').hidden, tekst: document.body.innerText.replace(/\\s+/g, ' '),
                      h1: document.querySelector('h1').textContent,
                      titel: document.title, beschrijving: document.querySelector('meta[name=description]').content};
            }""")
            winkel = {r["name"]: r["store_url"] for r in RIJEN}
            eis(st["n"] == len(RIJEN), f"{label}: alle {len(RIJEN)} kaarten staan er ({st['n']})")
            eis(all(k["href"] in winkel.values() and k["doel"] == "_blank" for k in st["knoppen"]) and len(st["knoppen"]) == len(RIJEN),
                f"{label}: elke koopknop wijst naar de winkel uit de data, in een nieuw tabblad")
            verwacht = [f"Get {t['name']}" for t in TIERS]
            eis([k["tekst"] for k in st["knoppen"]][:4] == verwacht, f"{label}: de knopteksten zijn onveranderd")
            rood = [k for k in st["knoppen"] if k["rood"]]
            eis(len(rood) == 1 and rood[0]["aanrader"], f"{label}: alleen de aanrader heeft de rode hoofdknop")
            eis(st["aanbevolen"] == ["Recommended"], f"{label}: een uitgelichte tier, met het woord")
            eis(st["kolommen"] == 4 and [list(rij) for rij in zip(*st["waarden"][:3])] == [kw[:3] for kw in st["kaartWaarden"]],
                f"{label}: de vergelijking geeft dezelfde waarden als de kaarten")
            eis(st["jij"] == ingelogd, f"{label}: het blok met je abonnement alleen als je er een hebt")
            for t in TEKSTEN:
                eis(" ".join(t.split()) in st["tekst"], f"{label}: tekst letterlijk aanwezig: {t[:50]}...")
            eis(st["h1"] == "Bucky Premium" and st["titel"] == "Bucky Premium"
                and st["beschrijving"] == "The four Bucky premium tiers: what each boost does, and exactly what is in the monthly cache.",
                f"{label}: titel, kop en beschrijving onveranderd")
            eis(not fouten, f"{label}: geen paginafout of CSP-melding ({fouten[:2]})")
            page.close()


def afbeeldingen(browser):
    """Punt 2 van 4-11-2026: bij elke tier en elk onderdeel zijn afbeelding, licht en zonder sprong."""
    for breed in ("desktop", "tablet", "telefoon"):
        page, fouten = open_premium(browser, breed, True)
        # Rustig naar beneden, zodat elk lazy beeld in beeld komt en laadt.
        page.evaluate("""async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) {
          scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } }""")
        page.wait_for_timeout(900)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(200)
        st = page.evaluate("""() => {
          const imgs = [...document.querySelectorAll('#pr-main img')];
          return {
            kapot: imgs.filter(i => !i.complete || !i.naturalWidth).map(i => i.getAttribute('src')),
            zonderMaat: imgs.filter(i => !i.getAttribute('width') || !i.getAttribute('height')).map(i => i.getAttribute('src')),
            badges: [...document.querySelectorAll('#pr-grid .pr-card .pr-badge')].map(i => i.getAttribute('src')),
            secties: [...document.querySelectorAll('.pr-sectie-beeld')].map(i => ({src: i.getAttribute('src'), lazy: i.loading, alt: i.alt,
                       w: Math.round(i.getBoundingClientRect().width)})),
            held: [...document.querySelectorAll('.pr-held img')].filter(i => i.naturalWidth).length,
            cls: window.__ls };
        }""")
        label = f"afbeeldingen {breed}"
        eis(not st["kapot"], f"{label}: elke afbeelding laadt ({st['kapot']})")
        eis(not st["zonderMaat"], f"{label}: elke afbeelding heeft een vaste maat ({st['zonderMaat']})")
        eis(st["badges"][:3] == [f"assets/images/premium/badge-{k}-192.webp" for k in ("bucky_plus", "bucky_plusplus", "elite")],
            f"{label}: elke tier haar eigen badge, als lichte WebP ({st['badges'][:3]})")
        eis(st["badges"][3].endswith("assets/images/premium/badge-overclock-192.webp"), f"{label}: ook de vierde tier")
        eis(len(st["secties"]) == 3 and all(x["lazy"] == "lazy" and x["alt"] and x["src"].endswith(".webp") and x["w"] >= 72 for x in st["secties"]),
            f"{label}: Security, Cipher en Shards met een eigen beeld, lazy, met alt-tekst ({st['secties']})")
        eis(st["held"] == 4, f"{label}: de vier tierbadges boven de titel")
        eis(st["cls"] < 0.001, f"{label}: niets springt tijdens het laden (CLS {st['cls']:.4f})")
        eis(not fouten, f"{label}: geen paginafout ({fouten[:2]})")
        page.close()
    # Een badge waarvoor geen WebP bestaat, valt terug op de PNG uit de data.
    TIERS[3]["badge_url"] = f"{BASIS}/assets/badges/onbekend_test.png"
    page, _ = open_premium(browser, "desktop", False)
    page.route("**/assets/badges/onbekend_test.png", lambda r: r.fulfill(path=os.path.join(os.path.dirname(__file__), "..", "assets", "badges", "elite.png")))
    page.wait_for_timeout(600)
    src = page.evaluate("(() => { const b = document.querySelectorAll('#pr-grid .pr-badge')[3]; return b ? b.getAttribute('src') : null; })()")
    eis(src is None or src.endswith("onbekend_test.png"), f"afbeeldingen: zonder WebP de PNG uit de data, of geen badge ({src})")
    TIERS[3]["badge_url"] = f"{BASIS}/assets/badges/overclock.png"
    page.close()


def voorkeuren(browser):
    page, _ = open_premium(browser, "desktop", False, media="prefers-reduced-transparency")
    eis(page.evaluate("getComputedStyle(document.querySelector('.nav-inner')).backdropFilter") == "none",
        "minder transparantie: de balk is effen")
    page.close()
    page, _ = open_premium(browser, "desktop", False, media="prefers-reduced-motion")
    eis(page.evaluate("getComputedStyle(document.querySelector('.pr-card-featured')).animationName") == "none",
        "minder beweging: de rand van de aanrader draait niet")
    page.close()


def _lum(h):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast():
    for naam, v, a in (("tekst-2 op kaart", "#BDBDC6", "#141418"), ("tekst-3 op achtergrond", "#A2A2AC", "#08080A"),
                       ("kop op kaart", "#F7F7FA", "#141418"), ("wit op hoofdknop", "#FFFFFF", "#BE0A25"),
                       ("wit op Recommended", "#FFFFFF", "#BE0A25"), ("groen op Your tier", "#5FD69A", "#1B2A24"),
                       ("tekst in de vergelijking (aanrader)", "#F7F7FA", "#24141A")):
        l1, l2 = sorted((_lum(v), _lum(a)), reverse=True)
        eis((l1 + 0.05) / (l2 + 0.05) >= 4.5, f"contrast {naam}: {(l1 + 0.05) / (l2 + 0.05):.2f}:1")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        print("De pagina, niet ingelogd en ingelogd, op vier breedtes"); pagina(browser)
        print("De afbeeldingen"); afbeeldingen(browser)
        print("Minder transparantie en minder beweging"); voorkeuren(browser)
        browser.close()
    print("Contrast"); contrast()
    if FOUTEN:
        print(f"\n{len(FOUTEN)} FOUT(EN)")
        sys.exit(1)
    print("\nalles ok")


if __name__ == "__main__":
    main()
