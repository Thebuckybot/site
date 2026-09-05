"""De onboarding-tour als RONDLEIDING, op het Security Center.

Speelt de backend na (stappen uit /api/site/tour) en controleert dat de tour het
werk doet: bij Next navigeert hij zelf naar de sectie van de stap, wacht tot het
onderdeel er staat, slaat een optionele stap snel over; Back navigeert terug;
Escape of Done laat geen halve staat achter (lade dicht, terug naar het tabblad
waar hij begon). Op een telefoon opent de tour de lade voor de zijbalk en zet de
balk aan de kant waar het onderdeel niet is. Toetsenbord, sessie-geheugen en
reduced motion blijven zoals ze waren. Maakt de previewplaten.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_tour.py [map-voor-schermafbeeldingen]
    TOUR_BASIS=https://buckybot.app python tests/test_tour.py   # tegen productie
"""

import json
import os
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright   # noqa: E402

BASIS = os.environ.get("TOUR_BASIS", "http://127.0.0.1:8899")
GID = "1392872457475592243"
SCHERM = sys.argv[1] if len(sys.argv) > 1 else None
ECHT = os.path.join(os.path.dirname(__file__), "..", "..", "bucky1.0", "cogs", "data", "currency",
                    "datacurrency", "site_tour.json")

STAPPEN = {"enabled": True, "pages": {"security": [
    {"selector": "#sec-nav", "reveal": "#sec-burger", "title": "The sections", "text": "Everything lives here.", "placement": "right"},
    {"selector": "#snap-health", "route": "#snapshots", "title": "Snapshots", "text": "Structural backups.", "placement": "below"},
    {"selector": "#does-not-exist", "optional": True, "title": "Ghost", "text": "Not on this page; skipped fast.", "placement": "below"},
    {"selector": "#sec-boost-card", "route": "#settings", "title": "Security Boost", "text": "Who gave it, until when.", "placement": "below"},
    {"selector": "#sec-refresh", "title": "Refresh", "text": "Reload the section.", "placement": "below"},
]}}


def stub(page, *, tour=STAPPEN):
    def ok(data):
        return dict(status=200, content_type="application/json", body=json.dumps({"ok": True, "data": data}))
    page.route("**/api/**", lambda r: r.fulfill(**ok({})))
    page.route("**/api/site/features", lambda r: r.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({"features": {"soc": True, "security_center": True, "rule_builder": True}})))
    page.route("**/api/site/tour", lambda r: r.fulfill(
        status=200, content_type="application/json", body=json.dumps(tour)))
    page.route(f"**/api/security/{GID}/me", lambda r: r.fulfill(**ok({"can_edit": True})))
    page.route(f"**/api/security/{GID}/snapshots", lambda r: r.fulfill(**ok({
        "snapshots": [], "current_snapshot_id": None, "has_usable": False, "capabilities": {},
        "keep": 10, "retention_days": 14})))
    page.route(f"**/api/security/{GID}/settings", lambda r: r.fulfill(**ok({
        "boost": None, "limits": {"retention_days": 14, "soc_rules": 10, "snapshots": 10, "plan": "free"},
        "retention": {"options": [7, 14], "selectable": [7, 14], "max": 14, "current": 14}})))


def open_security(ctx, *, tour=STAPPEN, start="#overview"):
    page = ctx.new_page()
    stub(page, tour=tour)
    page.goto(f"{BASIS}/security.html?guild_id={GID}{start}", wait_until="domcontentloaded")
    return page


def hash_van(page):
    return page.evaluate("location.hash")


def lade_open(page):
    return page.evaluate("document.getElementById('sec-app').classList.contains('nav-open')")


def titel(page):
    return page.locator("#bucky-tour-title").inner_text()


def wacht_titel(page, tekst, timeout=10000):
    page.wait_for_function("t => document.querySelector('#bucky-tour-title') && "
                           "document.querySelector('#bucky-tour-title').textContent === t", arg=tekst, timeout=timeout)


def snijdt(a, c):
    return (a["x"] < c["x"] + c["width"] and c["x"] < a["x"] + a["width"]
            and a["y"] < c["y"] + c["height"] and c["y"] < a["y"] + a["height"])


def main():
    fouten = []

    def check(ok, tekst):
        print(("  OK   " if ok else "  FOUT ") + tekst)
        if not ok:
            fouten.append(tekst)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # ---- desktop: de rondleiding ------------------------------------------
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = open_security(ctx)
        page.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
        check(titel(page) == "The sections" and hash_van(page) == "#overview", "stap 1 wijst naar de zijbalk, op het tabblad waar de bezoeker begon")
        check("Step 1 of 5" in page.locator("#bucky-tour").text_content(), "de teller telt alle stappen")
        try:
            page.wait_for_function("document.activeElement && document.activeElement.id === 'bucky-tour-title'", timeout=3000)
            check(True, "de focus staat op de ballon")
        except Exception:
            check(False, "de focus staat op de ballon")
        if SCHERM:
            page.screenshot(path=os.path.join(SCHERM, "tour_desktop.png"))

        page.locator("#bucky-tour .tour-btn-primary").click()
        wacht_titel(page, "Snapshots")
        check(hash_van(page) == "#snapshots", "Next opent zelf het tabblad Snapshots")
        check(page.locator(".tour-target").first.get_attribute("id") == "snap-health", "en wijst naar het onderdeel dat na de fetch verscheen")

        t0 = time.time()
        page.locator("#bucky-tour .tour-btn-primary").click()
        wacht_titel(page, "Security Boost")
        check(time.time() - t0 < 4, f"de optionele stap zonder onderdeel is snel overgeslagen ({time.time() - t0:.1f}s)")
        check(hash_van(page) == "#settings", "en de tour is doorgegaan naar Settings")
        check(page.locator(".tour-target").first.get_attribute("id") == "sec-boost-card", "naar de boostkaart")
        check("Step 4 of 5" in page.locator("#bucky-tour").text_content(), "de teller telt de overgeslagen stap wel mee")
        if SCHERM:
            page.screenshot(path=os.path.join(SCHERM, "tour_desktop_boost.png"))

        page.locator("#bucky-tour .tour-btn:not([hidden])").first.click()      # Back
        wacht_titel(page, "Snapshots")
        check(hash_van(page) == "#snapshots", "terug is ook terug: Back opent Snapshots weer")

        page.keyboard.press("ArrowRight")
        wacht_titel(page, "Security Boost")
        page.keyboard.press("ArrowRight")
        wacht_titel(page, "Refresh")
        check(hash_van(page) == "#settings" and page.locator("#bucky-tour .tour-btn-primary").inner_text() == "Done",
              "de laatste stap heeft geen route en heet Done")
        page.locator("#bucky-tour .tour-btn-skip").focus()
        page.keyboard.press("Tab")
        check(page.evaluate("document.activeElement.textContent") == "Back", "Tab draait rond binnen de ballon")

        page.keyboard.press("Escape")
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        page.wait_for_timeout(600)
        check(page.evaluate("document.body.dataset.tourState") == "skipped", "Escape sluit de tour")
        check(hash_van(page) == "#overview", "en brengt de bezoeker terug naar het tabblad waar hij begon")
        check(page.evaluate("sessionStorage.getItem('bucky_tour_seen_security')") == "1", "de sessie onthoudt hem")
        check(page.locator(".tour-target").count() == 0, "de markering is weg")

        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        check(page.locator("#bucky-tour").count() == 0, "na herladen in dezelfde sessie komt hij niet terug")

        # Done: ook dan terug naar het begin
        ctx2 = browser.new_context(viewport={"width": 1280, "height": 800})
        page2 = open_security(ctx2, start="#snapshots")
        page2.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
        for _ in range(5):
            if page2.locator("#bucky-tour").count() == 0:
                break
            page2.locator("#bucky-tour .tour-btn-primary").click()
            page2.wait_for_timeout(900)
        page2.wait_for_selector("#bucky-tour", state="detached", timeout=10000)
        page2.wait_for_timeout(600)
        check(page2.evaluate("document.body.dataset.tourState") == "done", "Done sluit de tour af")
        check(hash_van(page2) == "#snapshots", "en eindigt bij de ingang: het tabblad waar hij begon")

        page3 = open_security(ctx2, tour={"enabled": False, "pages": {}})
        page3.wait_for_timeout(1500)
        check(page3.locator("#bucky-tour").count() == 0, "uit in de config is uit op de pagina")

        # ---- reduced motion --------------------------------------------------
        ctx3 = browser.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
        page4 = open_security(ctx3)
        page4.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
        overgang = page4.locator("#bucky-tour").evaluate("e => getComputedStyle(e).transitionDuration")
        duur = max(float(x.strip().rstrip("s")) for x in overgang.split(","))
        check(duur < 0.01, f"geen animatie met prefers-reduced-motion ({overgang})")

        # ---- telefoon: de tour opent de lade zelf ----------------------------
        ctx4 = browser.new_context(viewport={"width": 375, "height": 667}, is_mobile=True, has_touch=True)
        page5 = open_security(ctx4)
        page5.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
        check(lade_open(page5), "op een telefoon opent de tour de lade voor stap 1")
        check(page5.locator(".tour-target").first.get_attribute("id") == "sec-nav", "en wijst naar de zijbalk zelf, niet naar de knop")
        doel = page5.locator(".tour-target").first.bounding_box()
        check(doel is not None and doel["x"] >= 0, "de zijbalk staat in beeld")
        check(page5.locator("#bucky-tour").evaluate("e => e.classList.contains('tour-sheet')"), "de ballon is een balk")
        if SCHERM:
            page5.screenshot(path=os.path.join(SCHERM, "tour_mobile_drawer.png"))

        page5.locator("#bucky-tour .tour-btn-primary").click()
        wacht_titel(page5, "Snapshots")
        page5.wait_for_timeout(500)
        check(not lade_open(page5), "bij de volgende stap gaat de lade weer dicht")
        check(hash_van(page5) == "#snapshots", "en de tour heeft zelf naar Snapshots genavigeerd")
        b = page5.locator("#bucky-tour").bounding_box()
        doel = page5.locator(".tour-target").first.bounding_box()
        check(b is not None and doel is not None and not snijdt(b, doel), "de balk bedekt het onderdeel niet")
        if SCHERM:
            page5.screenshot(path=os.path.join(SCHERM, "tour_mobile.png"))

        # halverwege sluiten op de telefoon: lade dicht, tabblad terug
        page5.locator("#bucky-tour .tour-btn:not([hidden])").first.click()      # Back -> stap 1, lade open
        wacht_titel(page5, "The sections")
        page5.wait_for_timeout(400)
        check(lade_open(page5), "Back opent de lade opnieuw voor stap 1")
        page5.keyboard.press("Escape")
        page5.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        page5.wait_for_timeout(600)
        check(not lade_open(page5) and hash_van(page5) == "#overview", "Escape laat geen open lade en geen vreemd tabblad achter")

        # ---- preview met de echte configuratie ------------------------------
        if SCHERM:
            echt = json.loads(open(ECHT, encoding="utf-8").read())
            ctx5 = browser.new_context(viewport={"width": 1280, "height": 800})
            page6 = open_security(ctx5, tour=echt)
            page6.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
            page6.wait_for_timeout(700)
            page6.screenshot(path=os.path.join(SCHERM, "tour_echt_1.png"))
            for _ in range(3):
                page6.locator("#bucky-tour .tour-btn-primary").click()
                page6.wait_for_timeout(1200)
            check(titel(page6) == "Security Boost" and hash_van(page6) == "#settings", "de echte tour brengt je naar de boostkaart in Settings")
            page6.screenshot(path=os.path.join(SCHERM, "tour_echt_boost.png"))
            ctx6 = browser.new_context(viewport={"width": 375, "height": 667}, is_mobile=True, has_touch=True)
            page7 = open_security(ctx6, tour=echt)
            page7.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
            page7.wait_for_timeout(700)
            page7.screenshot(path=os.path.join(SCHERM, "tour_echt_mobiel_1.png"))
            page7.locator("#bucky-tour .tour-btn-primary").click()
            wacht_titel(page7, "Snapshots")
            page7.wait_for_timeout(700)
            page7.screenshot(path=os.path.join(SCHERM, "tour_echt_mobiel_2.png"))
            n = len(echt["pages"]["security"])
            check(f"Step 2 of {n}" in page7.locator("#bucky-tour").text_content(), "op de telefoon wordt geen stap meer overgeslagen")

        browser.close()
    if fouten:
        print(f"\n{len(fouten)} fout(en)")
        return 1
    print("\nalles klopt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
