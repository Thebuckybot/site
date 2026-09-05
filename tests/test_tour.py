"""De onboarding-tour als RONDLEIDING met een doe-blok, op het Security Center.

Speelt de backend na (stappen uit de ECHTE site_tour.json, een stateful SOC-API)
en loopt de hele handeling door: de tour navigeert zelf, vult een ongevaarlijke
regel in, de bezoeker drukt Create Rule, de regel bestaat; dan de twee takken -
houden (regel blijft, geen DELETE) en verwijderen (Delete + bevestigen, de tour
gaat door zodra hij weg is). Plus: afhaken na het aanmaken ruimt de regel op,
limiet vol en alleen-lezen slaan het aanmaken over met een melding, zonder SOC
wordt het blok stil overgeslagen, en Escape gaat eerst naar een open bevestiging.
Toetsenbord, sessie-geheugen, reduced motion en de telefoon blijven gecontroleerd.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_tour.py [map-voor-schermafbeeldingen]
    TOUR_BASIS=https://buckybot.app python tests/test_tour.py   # tegen productie
"""

import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright   # noqa: E402

BASIS = os.environ.get("TOUR_BASIS", "http://127.0.0.1:8899")
GID = "1392872457475592243"
SCHERM = sys.argv[1] if len(sys.argv) > 1 else None
ECHT = os.path.join(os.path.dirname(__file__), "..", "..", "bucky1.0", "cogs", "data", "currency",
                    "datacurrency", "site_tour.json")
TOUR = json.loads(open(ECHT, encoding="utf-8").read())
N = len(TOUR["pages"]["security"])
REGELNAAM = next(s for s in TOUR["pages"]["security"] if s.get("id") == "soc-create")["emit"]["detail"]["name"]

REGISTRY = {
    "events": [{"value": "message_create", "label": "When message is sent"},
               {"value": "member_join", "label": "When member joins"}],
    "event_condition_map": {"message_create": ["mentions_greater_equal", "contains_link"], "member_join": []},
    "event_action_map": {"message_create": ["notify_owner", "delete_message"], "member_join": []},
    "conditions": [
        {"type": "mentions_greater_equal", "label": "Mentions ≥", "fields": [{"name": "count", "type": "number", "placeholder": "3"}]},
        {"type": "contains_link", "label": "Message contains link", "fields": []}],
    "actions": [
        {"action": "notify_owner", "label": "Notify owner", "fields": [
            {"name": "title", "type": "text", "placeholder": "Security Alert"},
            {"name": "message", "type": "text", "placeholder": "Rule triggered"}]},
        {"action": "delete_message", "label": "Delete message", "fields": []}],
}


class SocStub:
    """Een SOC-API met geheugen: regels die worden aangemaakt bestaan daarna echt
    voor de lijst, en een DELETE haalt ze weg. `calls` is het spoor."""

    def __init__(self, *, at_limit=False, rules=None):
        self.rules = list(rules or [])
        self.at_limit = at_limit
        self.calls = []
        self.volgende = 101

    def usage(self):
        used = 10 if self.at_limit else len(self.rules)
        return {"used": used, "limit": 10, "at_limit": self.at_limit, "boosted": False, "unlimited": False}

    def rules_route(self, route):
        req = route.request
        self.calls.append((req.method, "rules"))
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            rid = self.volgende
            self.volgende += 1
            self.rules.append({"id": rid, "name": body.get("name"), "event_type": body.get("event_type"),
                               "severity": body.get("severity"), "enabled": True,
                               "conditions_json": body.get("conditions"), "actions_json": body.get("actions")})
            self.last_post = body
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True, "id": rid}))
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps(self.rules))

    def rule_route(self, route):
        req = route.request
        rid = int(req.url.rstrip("/").split("/")[-1])
        self.calls.append((req.method, rid))
        if req.method == "DELETE":
            self.rules = [r for r in self.rules if r["id"] != rid]
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"success": True}))


def stub(page, *, tour=TOUR, soc=None, can_edit=True, soc_aan=True):
    def ok(data):
        return dict(status=200, content_type="application/json", body=json.dumps({"ok": True, "data": data}))
    page.route("**/api/**", lambda r: r.fulfill(**ok({})))
    page.route("**/api/site/features", lambda r: r.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({"features": {"soc": soc_aan, "security_center": True, "rule_builder": soc_aan}})))
    page.route("**/api/site/tour", lambda r: r.fulfill(
        status=200, content_type="application/json", body=json.dumps(tour)))
    page.route(f"**/api/security/{GID}/me", lambda r: r.fulfill(**ok({"can_edit": can_edit})))
    page.route(f"**/api/security/{GID}/snapshots", lambda r: r.fulfill(**ok({
        "snapshots": [], "current_snapshot_id": None, "has_usable": False, "capabilities": {},
        "keep": 10, "retention_days": 14})))
    page.route(f"**/api/security/{GID}/settings", lambda r: r.fulfill(**ok({
        "boost": None, "limits": {"retention_days": 14, "soc_rules": 10, "snapshots": 10, "plan": "free"},
        "retention": {"options": [7, 14], "selectable": [7, 14], "max": 14, "current": 14}})))
    if soc is not None:
        # later geregistreerd wint: rules/* vóór rules/usage, zodat usage niet als regel-id wordt gelezen
        page.route("**/api/security/soc/rule-registry", lambda r: r.fulfill(
            status=200, content_type="application/json", body=json.dumps(REGISTRY)))
        page.route(f"**/api/security/soc/{GID}/rules", soc.rules_route)
        page.route(f"**/api/security/soc/{GID}/rules/*", soc.rule_route)
        page.route(f"**/api/security/soc/{GID}/rules/usage", lambda r: r.fulfill(
            status=200, content_type="application/json", body=json.dumps(soc.usage())))


def open_security(ctx, *, start="#overview", **kw):
    page = ctx.new_page()
    stub(page, **kw)
    page.goto(f"{BASIS}/security.html?guild_id={GID}{start}", wait_until="domcontentloaded")
    page.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
    return page


def hash_van(page):
    return page.evaluate("location.hash")


def titel(page):
    return page.locator("#bucky-tour-title").inner_text()


def wacht_titel(page, tekst, timeout=12000):
    page.wait_for_function("t => document.querySelector('#bucky-tour-title') && "
                           "document.querySelector('#bucky-tour-title').textContent === t", arg=tekst, timeout=timeout)
    page.wait_for_timeout(250)


def volgende(page, tekst):
    page.locator("#bucky-tour .tour-btn-primary").click()
    wacht_titel(page, tekst)


def naar_soc(page):
    """Van stap 1 naar 'Detection rules'."""
    volgende(page, "Snapshots")
    volgende(page, "What is kept")
    volgende(page, "Detection rules")


def maak_regel(page, check):
    """Van 'Detection rules' naar de keuze: het formulier staat gevuld, de bezoeker drukt Create Rule."""
    volgende(page, "Create a rule")
    check(hash_van(page) == "#rulebuilder", "de tour opende de Rule Builder")
    page.wait_for_function("document.querySelector('#sec-rb-name') && document.querySelector('#sec-rb-name').value !== ''", timeout=5000)
    check(page.locator("#sec-rb-name").input_value() == REGELNAAM, "de naam staat ingevuld")
    check(page.locator("#sec-rb-event").input_value() == "message_create", "WHEN: message sent")
    check(page.locator("#sec-rb-conditions select").input_value() == "mentions_greater_equal", "IF: mentions ≥")
    check(page.locator("#sec-rb-conditions [data-field='count']").input_value() == "40", "… 40")
    check(page.locator("#sec-rb-actions select").input_value() == "notify_owner", "THEN: notify owner - niets verwijderen, niemand straffen")
    check(page.locator("#bucky-tour .tour-btn-primary").is_hidden(), "geen Next: de bezoeker moet zelf drukken")
    return page.get_by_role("button", name="Create Rule")


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
        desktop = dict(viewport={"width": 1280, "height": 800})

        # ---- A. aanmaken en houden --------------------------------------------
        print("-- A. aanmaken en houden")
        soc = SocStub()
        page = open_security(browser.new_context(**desktop), soc=soc)
        check(titel(page) == "The sections" and f"Step 1 of {N}" in page.locator("#bucky-tour").text_content(), "stap 1, teller telt alle stappen")
        naar_soc(page)
        check(hash_van(page) == "#rules", "de tour opende Detection Rules zelf")
        check(page.locator("#soc-rules-head").get_attribute("data-can-create") == "1", "rechten en limiet staan op de pagina, vóór de stap")
        knop = maak_regel(page, check)
        if SCHERM:
            page.screenshot(path=os.path.join(SCHERM, "soc_create_desktop.png"))
        knop.click()
        wacht_titel(page, "Your rule is live")
        check(("POST", "rules") in soc.calls and soc.last_post["name"] == REGELNAAM, "de regel is echt aangemaakt met het sjabloon")
        check(soc.last_post["conditions"] == [{"type": "mentions_greater_equal", "count": 40}], "voorwaarde zoals ingevuld")
        check(soc.last_post["actions"][0]["action"] == "notify_owner", "actie zoals ingevuld")
        check(page.locator(".tour-target").first.get_attribute("data-rule-id") == "101", "de ballon wijst naar de nieuwe regel")
        keuzes = page.locator("#bucky-tour .tour-btn-choice")
        check(keuzes.count() == 2 and keuzes.nth(0).inner_text() == "Keep it" and keuzes.nth(1).inner_text() == "Delete it", "de keuze: houden of verwijderen")
        if SCHERM:
            page.screenshot(path=os.path.join(SCHERM, "soc_choice_desktop.png"))
        keuzes.nth(0).click()
        wacht_titel(page, "Security Boost")
        check(hash_van(page) == "#settings", "houden: de tour loopt door naar Settings")
        page.locator("#bucky-tour .tour-btn:not([hidden])").first.click()          # Back
        wacht_titel(page, "Detection rules")
        check(hash_van(page) == "#rules", "Back slaat de doe-stappen over en landt op Detection Rules")
        page.keyboard.press("Escape")
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        page.wait_for_timeout(700)
        check(not any(m == "DELETE" for m, _ in soc.calls) and len(soc.rules) == 1, "gehouden is gehouden: geen DELETE")
        check(hash_van(page) == "#overview", "Escape brengt terug naar het begin")

        # ---- B. aanmaken en verwijderen ------------------------------------------
        print("-- B. aanmaken en verwijderen")
        soc = SocStub()
        page = open_security(browser.new_context(**desktop), soc=soc)
        naar_soc(page)
        maak_regel(page, lambda ok, t: None).click()
        wacht_titel(page, "Your rule is live")
        page.locator("#bucky-tour .tour-btn-choice").nth(1).click()
        wacht_titel(page, "Delete a rule")
        check(hash_van(page) == "#rules", "verwijderen: de tour opende Detection Rules")
        doel = page.locator(".tour-target").first
        check(doel.evaluate("e => e.closest('tr') && e.closest('tr').dataset.ruleId") == "101" and doel.inner_text() == "Delete", "en wijst naar de Delete-knop van díe regel")
        doel.click()
        page.wait_for_selector('[aria-modal="true"]', timeout=5000)
        page.keyboard.press("Escape")
        page.wait_for_selector('[aria-modal="true"]', state="detached", timeout=5000)
        check(page.locator("#bucky-tour").count() == 1, "Escape sluit eerst de bevestiging, niet de tour")
        page.locator(".tour-target").first.click()
        page.wait_for_selector('[aria-modal="true"]', timeout=5000)
        page.locator('[aria-modal="true"] button', has_text="Delete").click()
        wacht_titel(page, "Security Boost")
        check(("DELETE", 101) in soc.calls and soc.rules == [], "de regel is echt weg en de tour ging door")
        volgende(page, "Data retention")
        volgende(page, "Refresh")
        check(page.locator("#bucky-tour .tour-btn-primary").inner_text() == "Done", "de laatste stap heet Done")
        page.locator("#bucky-tour .tour-btn-primary").click()
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        page.wait_for_timeout(700)
        check(page.evaluate("document.body.dataset.tourState") == "done" and hash_van(page) == "#overview", "Done eindigt bij de ingang")
        check(sum(1 for m, _ in soc.calls if m == "DELETE") == 1, "geen tweede DELETE bij het afsluiten")

        # ---- C. afhaken na het aanmaken -----------------------------------------
        print("-- C. afhaken na het aanmaken")
        soc = SocStub()
        page = open_security(browser.new_context(**desktop), soc=soc)
        naar_soc(page)
        maak_regel(page, lambda ok, t: None).click()
        wacht_titel(page, "Your rule is live")
        page.keyboard.press("Escape")
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        page.wait_for_function("() => document.body.dataset.tourState === 'skipped'")
        page.wait_for_timeout(900)
        check(("DELETE", 101) in soc.calls and soc.rules == [], "afhaken na het aanmaken: de tour haalt de regel weer weg")
        check(hash_van(page) == "#overview", "en laat geen vreemd tabblad achter")
        # afhaken in het formulier, vóór Create Rule: niets aangemaakt, niets te verwijderen
        soc2 = SocStub()
        page = open_security(browser.new_context(**desktop), soc=soc2)
        naar_soc(page)
        maak_regel(page, lambda ok, t: None)
        page.keyboard.press("Escape")
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        page.wait_for_timeout(700)
        check(not any(m in ("POST", "DELETE") for m, _ in soc2.calls) and hash_van(page) == "#overview", "afhaken in het formulier: geen regel, geen open formulier")

        # ---- D. limiet vol -------------------------------------------------------
        print("-- D. limiet vol")
        soc = SocStub(at_limit=True)
        page = open_security(browser.new_context(**desktop), soc=soc)
        naar_soc(page)
        volgende(page, "The rule limit is reached")
        check(page.locator(".tour-target").first.get_attribute("id") == "soc-rules-head", "wijst naar waar de grens staat")
        volgende(page, "Security Boost")
        check(not any(m == "POST" for m, _ in soc.calls), "aanmaken overgeslagen")

        # ---- E. alleen-lezen -----------------------------------------------------
        print("-- E. alleen-lezen")
        soc = SocStub()
        page = open_security(browser.new_context(**desktop), soc=soc, can_edit=False)
        naar_soc(page)
        volgende(page, "Rules are read-only for you")
        volgende(page, "Security Boost")
        check(not any(m == "POST" for m, _ in soc.calls), "zonder rechten geen aanmaakstap")

        # ---- F. geen SOC -----------------------------------------------------------
        print("-- F. geen SOC")
        soc = SocStub()
        page = open_security(browser.new_context(**desktop), soc=soc, soc_aan=False)
        volgende(page, "Snapshots")
        volgende(page, "What is kept")
        volgende(page, "Security Boost")
        check(soc.calls == [] and f"Step {N - 2} of {N}" in page.locator("#bucky-tour").text_content(), "zonder SOC wordt het blok stil overgeslagen, de teller loopt door")

        # ---- G. wat blijft: sessie, reduced motion ------------------------------------
        print("-- G. wat blijft")
        page.keyboard.press("Escape")
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        check(page.evaluate("sessionStorage.getItem('bucky_tour_seen_security')") == "1", "de sessie onthoudt hem")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        check(page.locator("#bucky-tour").count() == 0, "na herladen komt hij niet terug")
        ctx3 = browser.new_context(**desktop, reduced_motion="reduce")
        page4 = open_security(ctx3, soc=SocStub())
        overgang = page4.locator("#bucky-tour").evaluate("e => getComputedStyle(e).transitionDuration")
        duur = max(float(x.strip().rstrip("s")) for x in overgang.split(","))
        check(duur < 0.01, f"geen animatie met prefers-reduced-motion ({overgang})")

        # ---- H. telefoon ---------------------------------------------------------------
        print("-- H. telefoon")
        soc = SocStub()
        ctx4 = browser.new_context(viewport={"width": 375, "height": 667}, is_mobile=True, has_touch=True)
        page5 = open_security(ctx4, soc=soc)
        check(page5.evaluate("document.getElementById('sec-app').classList.contains('nav-open')"), "op een telefoon opent de tour de lade voor stap 1")
        volgende(page5, "Snapshots")
        page5.wait_for_timeout(400)
        check(not page5.evaluate("document.getElementById('sec-app').classList.contains('nav-open')"), "en sluit hem bij de volgende stap")
        b = page5.locator("#bucky-tour").bounding_box()
        doel = page5.locator(".tour-target").first.bounding_box()
        check(b is not None and doel is not None and not snijdt(b, doel), "de balk bedekt het onderdeel niet")
        volgende(page5, "What is kept")
        volgende(page5, "Detection rules")
        knop = maak_regel(page5, lambda ok, t: None)
        page5.wait_for_timeout(500)
        if SCHERM:
            page5.screenshot(path=os.path.join(SCHERM, "soc_create_mobile.png"))
        knop.click()
        wacht_titel(page5, "Your rule is live")
        check(page5.locator("#bucky-tour .tour-btn-choice").count() == 2, "op de telefoon dezelfde keuze")
        if SCHERM:
            page5.screenshot(path=os.path.join(SCHERM, "soc_choice_mobile.png"))
        page5.locator("#bucky-tour .tour-btn-choice").nth(1).click()
        wacht_titel(page5, "Delete a rule")
        page5.locator(".tour-target").first.click()
        page5.wait_for_selector('[aria-modal="true"]', timeout=5000)
        page5.locator('[aria-modal="true"] button', has_text="Delete").click()
        wacht_titel(page5, "Security Boost")
        check(soc.rules == [], "en op de telefoon gaat de regel ook echt weg")

        browser.close()
    if fouten:
        print(f"\n{len(fouten)} fout(en)")
        return 1
    print("\nalles klopt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
