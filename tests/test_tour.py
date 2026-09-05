"""De onboarding-tour zoals een bezoeker hem meemaakt, op het Security Center.

Speelt de backend na (stappen uit /api/site/tour) en controleert: de ballon
verschijnt bij het eerste onderdeel, Next en pijl-rechts gaan verder, Escape
sluit, de sessie onthoudt hem (herladen: geen ballon; nieuwe browsercontext:
wel), Tab blijft in de ballon, de focus staat op de ballon, en op een telefoon
is hij een onderbalk die het onderdeel niet bedekt. Maakt twee schermafbeeldingen
voor de preview.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_tour.py [map-voor-schermafbeeldingen]
"""

import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright   # noqa: E402

BASIS = "http://127.0.0.1:8899"
GID = "1392872457475592243"
SCHERM = sys.argv[1] if len(sys.argv) > 1 else None
# de echte stappen, voor de preview-schermafbeeldingen
ECHT = os.path.join(os.path.dirname(__file__), "..", "..", "bucky1.0", "cogs", "data", "currency", "datacurrency", "site_tour.json")

STAPPEN = {"enabled": True, "pages": {"security": [
    {"selector": "#sec-nav, #sec-burger", "title": "The sections", "text": "Everything about protection lives here.", "placement": "right"},
    {"selector": "#sec-nav [data-key=\"snapshots\"]", "title": "Snapshots", "text": "Structural backups.", "placement": "right"},
    {"selector": "#does-not-exist", "title": "Ghost", "text": "This step has no element and is skipped.", "placement": "below"},
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


def open_security(ctx, *, mobile=False, tour=STAPPEN):
    page = ctx.new_page()
    stub(page, tour=tour)
    page.goto(f"{BASIS}/security.html?guild_id={GID}#snapshots", wait_until="domcontentloaded")
    return page


def main():
    fouten = []

    def check(ok, tekst):
        print(("  OK   " if ok else "  FOUT ") + tekst)
        if not ok:
            fouten.append(tekst)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # ---- desktop -------------------------------------------------------
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = open_security(ctx)
        page.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
        ballon = page.locator("#bucky-tour")
        check(ballon.get_attribute("role") == "dialog", "de ballon is een dialoog")
        check(page.locator("#bucky-tour-title").inner_text() == "The sections", "stap 1 staat bij de secties")
        check("Step 1 of 4" in ballon.text_content(), "de teller telt alle geconfigureerde stappen")
        # de pagina zet na haar eigen fetch de focus op de sectiekop; de tour haalt hem terug
        try:
            page.wait_for_function("document.activeElement && document.activeElement.id === 'bucky-tour-title'", timeout=3000)
            check(True, "de focus staat op de ballon")
        except Exception:
            check(False, "de focus staat op de ballon")
        check(page.locator("#sec-nav").evaluate("e => e.classList.contains('tour-target')"), "het onderdeel is gemarkeerd")
        check(page.locator("#bucky-tour .tour-btn:not([hidden])").first.inner_text() == "Next", "zonder Back op stap 1")
        if SCHERM:
            page.screenshot(path=os.path.join(SCHERM, "tour_desktop.png"))
        page.locator("#bucky-tour .tour-btn-primary").click()
        page.wait_for_function("document.querySelector('#bucky-tour-title').textContent === 'Snapshots'")
        check(True, "Next gaat naar stap 2")
        page.keyboard.press("ArrowRight")
        page.wait_for_function("document.querySelector('#bucky-tour-title').textContent === 'Refresh'")
        check("Step 4 of 4" in ballon.text_content(), "de stap zonder onderdeel is overgeslagen (pijl-rechts)")
        check(page.locator("#bucky-tour .tour-btn-primary").inner_text() == "Done", "de laatste knop heet Done")
        # Tab blijft in de ballon
        page.locator("#bucky-tour .tour-btn-skip").focus()
        page.keyboard.press("Tab")
        check(page.evaluate("document.activeElement.textContent") == "Back", "Tab draait rond binnen de ballon")
        page.keyboard.press("ArrowLeft")
        page.wait_for_function("document.querySelector('#bucky-tour-title').textContent === 'Snapshots'")
        check(True, "pijl-links gaat terug")
        page.keyboard.press("Escape")
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        check(page.evaluate("document.body.dataset.tourState") == "skipped", "Escape sluit de tour")
        check(page.evaluate("sessionStorage.getItem('bucky_tour_seen_security')") == "1", "de sessie onthoudt hem")
        check(page.locator(".tour-target").count() == 0, "de markering is weg")

        # herladen in dezelfde sessie: geen ballon
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        check(page.locator("#bucky-tour").count() == 0, "na herladen in dezelfde sessie komt hij niet terug")

        # nieuwe browsercontext (nieuwe sessie): wel
        ctx2 = browser.new_context(viewport={"width": 1280, "height": 800})
        page2 = open_security(ctx2)
        page2.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
        check(True, "in een nieuwe sessie begint hij opnieuw")
        # tour uit: geen ballon
        page3 = open_security(ctx2, tour={"enabled": False, "pages": {}})
        page3.wait_for_timeout(1500)
        check(page3.locator("#bucky-tour").count() == 0, "uit in de config is uit op de pagina")

        # ---- reduced motion --------------------------------------------------
        ctx3 = browser.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
        page4 = open_security(ctx3)
        page4.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
        overgang = page4.locator("#bucky-tour").evaluate("e => getComputedStyle(e).transitionDuration")
        # de site zet sitebreed 0.001ms bij reduced motion; alles onder 10ms is "geen animatie"
        duur = max(float(x.strip().rstrip("s")) for x in overgang.split(","))
        check(duur < 0.01, f"geen animatie met prefers-reduced-motion ({overgang})")

        # ---- telefoon --------------------------------------------------------
        ctx4 = browser.new_context(viewport={"width": 375, "height": 667}, is_mobile=True, has_touch=True)
        page5 = open_security(ctx4)
        page5.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
        check(page5.locator("#bucky-tour").evaluate("e => e.classList.contains('tour-sheet')"), "op een telefoon is de ballon een onderbalk")
        b = page5.locator("#bucky-tour").bounding_box()
        # op een telefoon is #sec-nav de uitgeschoven zijbalk; stap 2 (een navlink) kan
        # onzichtbaar zijn en wordt dan overgeslagen - de eerste zichtbare stap telt
        doel = page5.locator(".tour-target").first.bounding_box()
        def snijdt(a, c):
            return (a["x"] < c["x"] + c["width"] and c["x"] < a["x"] + a["width"]
                    and a["y"] < c["y"] + c["height"] and c["y"] < a["y"] + a["height"])
        overlapt = bool(doel and b and snijdt(doel, b))
        check(doel is not None and doel["x"] >= 0 and doel["x"] < 375, "het gemarkeerde onderdeel staat in beeld (niet de weggeschoven zijbalk)")
        check(page5.locator(".tour-target").first.get_attribute("id") == "sec-burger",
              "op een telefoon wijst stap 1 naar de menuknop in plaats van de zijbalk")
        check(page5.locator("#bucky-tour-title").inner_text() == "The sections", "met dezelfde tekst")
        check(b is not None and b["y"] + b["height"] >= 667 - 2, "de onderbalk staat onderaan")
        check(not overlapt, "de balk bedekt het onderdeel niet")
        if SCHERM:
            page5.screenshot(path=os.path.join(SCHERM, "tour_mobile.png"))

        # ---- preview met de echte configuratie ------------------------------
        if SCHERM:
            echt = json.loads(open(ECHT, encoding="utf-8").read())
            ctx5 = browser.new_context(viewport={"width": 1280, "height": 800})
            page6 = ctx5.new_page()
            stub(page6, tour=echt)
            guilds = [{"id": str(10 ** 17 + i), "name": n, "icon": None} for i, n in enumerate(
                ["Bucky HQ", "Night Market", "The Foundry", "Harbor Watch", "Quiet Hours", "Orbit"])]
            page6.route("**/api/me*", lambda r: r.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({"logged_in": True, "user": {"id": "1", "username": "tester", "avatar": None}, "guilds": guilds})))
            page6.goto(f"{BASIS}/dashboard.html", wait_until="domcontentloaded")
            page6.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
            page6.wait_for_timeout(700)
            page6.screenshot(path=os.path.join(SCHERM, "tour_dashboard.png"))
            def verder(pg):
                """klik Next en wacht tot de teller verspringt (een verborgen stap wordt overgeslagen)"""
                was = pg.locator("#bucky-tour .tour-step").text_content()
                pg.locator("#bucky-tour .tour-btn-primary").click()
                pg.wait_for_function(
                    "was => document.querySelector('#bucky-tour .tour-step').textContent !== was", arg=was, timeout=5000)
                pg.wait_for_timeout(400)
            laatste = len(echt["pages"]["dashboard"])
            for _ in range(laatste):
                if page6.locator("#bucky-tour .tour-btn-primary").inner_text() == "Done":
                    break
                verder(page6)
            page6.screenshot(path=os.path.join(SCHERM, "tour_dashboard_boost.png"))
            check("Security Boost" in page6.locator("#bucky-tour").text_content(), "de laatste dashboardstap is de boost")
            page7 = open_security(ctx5, tour=echt)
            page7.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
            page7.wait_for_timeout(700)
            page7.screenshot(path=os.path.join(SCHERM, "tour_security.png"))
            for _ in range(3):
                verder(page7)
            check(page7.locator("#bucky-tour-title").inner_text() == "Security Boost", "stap 4 van het Security Center is de boost")
            page7.screenshot(path=os.path.join(SCHERM, "tour_security_boost.png"))

        browser.close()
    if fouten:
        print(f"\n{len(fouten)} fout(en)")
        return 1
    print("\nalles klopt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
