"""De onboarding-tour: rondleiding, doe-blok en vorm, op het Security Center.

Speelt de backend na (stappen uit de ECHTE site_tour.json, een stateful SOC-API)
en loopt de hele handeling door: welkomstkaart met Start tour, de tour navigeert
zelf, vult een ongevaarlijke regel in, de bezoeker drukt Create Rule; dan de twee
takken - houden en verwijderen. Plus afhaken (regel wordt opgeruimd), limiet vol,
alleen-lezen, geen SOC, de slotkaart, de Tour-knop die hem terughaalt, en de vorm:
één uitsnede om het onderdeel, hoofdstuk en telling, voortgangsbalk, de chip
"Your turn" bij een doe-stap, geen blauw. Toetsenbord, sessie, reduced motion en
de telefoon blijven gecontroleerd.

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
SEC = TOUR["pages"]["security"]
N = sum(1 for s in SEC if s["selector"] != "@center")           # de telling: geen welkom/slot
REGELNAAM = next(s for s in SEC if s.get("id") == "soc-create")["emit"]["detail"]["name"]
T = {s.get("id") or s["selector"]: s["title"] for s in SEC}
WELKOM, SECTIES, SNAPSHOTS = SEC[0]["title"], SEC[1]["title"], SEC[2]["title"]
REGELS, LEZEN, LIMIET = T["soc-rules"], SEC[4]["title"], SEC[5]["title"]
MAAK, KEUZE, WEG, BOOST, SLOT = T["soc-create"], T["soc-choice"], T["soc-delete"], T["soc-end"], SEC[-1]["title"]

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
        page.route("**/api/security/soc/rule-registry", lambda r: r.fulfill(
            status=200, content_type="application/json", body=json.dumps(REGISTRY)))
        page.route(f"**/api/security/soc/{GID}/rules", soc.rules_route)
        page.route(f"**/api/security/soc/{GID}/rules/*", soc.rule_route)
        page.route(f"**/api/security/soc/{GID}/rules/usage", lambda r: r.fulfill(
            status=200, content_type="application/json", body=json.dumps(soc.usage())))


def open_security(ctx, *, start="#overview", begin=True, **kw):
    """Opent de pagina; met begin=True wordt de welkomstkaart bevestigd met Start tour."""
    page = ctx.new_page()
    stub(page, **kw)
    page.goto(f"{BASIS}/security.html?guild_id={GID}{start}", wait_until="domcontentloaded")
    page.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
    if begin:
        page.locator("#bucky-tour .tour-next").click()
        wacht_titel(page, SECTIES)
    return page


def hash_van(page):
    return page.evaluate("location.hash")


def titel(page):
    return page.locator("#bucky-tour-title").inner_text()


def wacht_titel(page, tekst, timeout=12000):
    page.wait_for_function("t => document.querySelector('#bucky-tour-title') && "
                           "document.querySelector('#bucky-tour-title').textContent === t", arg=tekst, timeout=timeout)
    page.wait_for_timeout(650)


def volgende(page, tekst):
    page.locator("#bucky-tour .tour-next").click()
    wacht_titel(page, tekst)


def naar_soc(page):
    volgende(page, SNAPSHOTS)
    volgende(page, REGELS)


def maak_regel(page, check):
    volgende(page, MAAK)
    check(hash_van(page) == "#rulebuilder", "de tour opende de Rule Builder")
    page.wait_for_function("document.querySelector('#sec-rb-name') && document.querySelector('#sec-rb-name').value !== ''", timeout=5000)
    check(page.locator("#sec-rb-name").input_value() == REGELNAAM, "de naam staat ingevuld")
    check(page.locator("#sec-rb-conditions select").input_value() == "mentions_greater_equal"
          and page.locator("#sec-rb-conditions [data-field='count']").input_value() == "40", "IF: mentions ≥ 40")
    check(page.locator("#sec-rb-actions select").input_value() == "notify_owner", "THEN: notify owner")
    check(page.locator("#bucky-tour .tour-next").is_hidden(), "geen Next: de bezoeker moet zelf drukken")
    check(page.locator("#bucky-tour .tour-turn").is_visible() and page.locator("#bucky-tour .tour-turn").text_content() == "Your turn",
          "de chip 'Your turn' zegt het in woorden")
    for sel in ("#sec-rb-form", "#sec-rb-create"):
        ok, waarom = verlicht(page, sel)
        check(ok, f"uitgelicht en bereikbaar bij het aanmaken: {sel} {waarom}")
    return page.get_by_role("button", name="Create Rule")


def snijdt(a, c):
    return (a["x"] < c["x"] + c["width"] and c["x"] < a["x"] + a["width"]
            and a["y"] < c["y"] + c["height"] and c["y"] < a["y"] + a["height"])


def gaten(page):
    """De gaten in de demping, in schermcoördinaten."""
    # rects in een <mask> hebben geen getBoundingClientRect; de tour schrijft de
    # gaten daarom ook als data-holes (schermcoördinaten) op de svg
    return page.evaluate("""() => { const e = document.getElementById('bucky-tour-spot');
        return e ? JSON.parse(e.dataset.holes || '[]').map(h => ({x: h.x, y: h.y, width: h.w, height: h.h})) : []; }""")


def in_gat(gat, doel, marge=8):
    return (gat["x"] <= doel["x"] - marge + 1 and gat["y"] <= doel["y"] - marge + 1
            and gat["x"] + gat["width"] >= doel["x"] + doel["width"] + marge - 1
            and gat["y"] + gat["height"] >= doel["y"] + doel["height"] + marge - 1)


def omsluit(page, doel, marge=8):
    return any(in_gat(g, doel, marge) for g in gaten(page))


def verlicht(page, selector):
    """DE REGEL VOOR DOE-STAPPEN: elk element dat de bezoeker moet aanklikken ligt in
    een gat van de demping én is het element dat een klik in zijn midden raakt (niets
    van de tour ligt eroverheen)."""
    holes = gaten(page)
    elementen = page.locator(selector)
    n = elementen.count()
    if n == 0:
        return False, f"{selector}: niet gevonden"
    for i in range(n):
        e = elementen.nth(i)
        if not e.is_visible():
            continue
        box = e.bounding_box()
        if not any(in_gat(g, box, 0) for g in holes):
            return False, f"{selector}: ligt niet in een gat ({box} vs {holes})"
        raak = e.evaluate("""el => { const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            return hit && (el === hit || el.contains(hit)) ? 'ok' : (hit ? hit.id || hit.className || hit.tagName : 'niets'); }""")
        if raak != "ok":
            return False, f"{selector}: een klik in het midden raakt {raak}"
    return True, ""


def main():
    fouten = []

    def check(ok, tekst):
        print(("  OK   " if ok else "  FOUT ") + tekst)
        if not ok:
            fouten.append(tekst)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        desktop = dict(viewport={"width": 1280, "height": 800})

        # ---- 0. de vorm: welkom, spot, kop, voortgang --------------------------------
        print("-- 0. de vorm")
        soc = SocStub()
        page = open_security(browser.new_context(**desktop), soc=soc, begin=False)
        check(titel(page) == WELKOM and page.locator("#bucky-tour").evaluate("e => e.classList.contains('tour-center')"),
              "de tour begint met een welkomstkaart in het midden")
        check(page.locator("#bucky-tour .tour-next").inner_text() == "Start tour"
              and page.locator("#bucky-tour .tour-skip").inner_text() == "Not now", "met Start tour en Not now")
        check(page.locator("#bucky-tour-spot").evaluate("e => e.classList.contains('tour-spot-center')") and gaten(page) == [],
              "en alles gedempt, zonder gat")
        check(page.locator("#bucky-tour .tour-close").get_attribute("aria-label") == "Close tour", "het sluitkruisje heeft een naam")
        if SCHERM:
            page.screenshot(path=os.path.join(SCHERM, "vorm_welkom.png"))
        page.locator("#bucky-tour .tour-next").click()
        wacht_titel(page, SECTIES)
        doel = page.locator(".tour-target").first.bounding_box()
        check(omsluit(page, doel), "het gat in de demping omsluit het onderdeel met 8 px marge")
        check(page.locator("#bucky-tour .tour-chapter").text_content() == "Sections", "het hoofdstuk staat boven de titel")
        check(page.locator("#bucky-tour .tour-count").text_content() == "1 of 3",
              "de telling telt welkom, slot en de voorwaardelijke SOC-stappen (nog) niet mee")
        breedte1 = page.locator("#bucky-tour .tour-progress i").evaluate("e => e.getBoundingClientRect().width")
        kleur = page.locator("#bucky-tour .tour-next").evaluate("e => getComputedStyle(e).backgroundImage + getComputedStyle(e).backgroundColor")
        check("139, 30, 63" in kleur and "91, 124, 250" not in kleur, "de primaire knop is crimson, niet blauw")
        volgende(page, SNAPSHOTS)
        breedte2 = page.locator("#bucky-tour .tour-progress i").evaluate("e => e.getBoundingClientRect().width")
        check(breedte2 > breedte1 > 0, "de voortgangsbalk groeit")
        check(page.locator("#bucky-tour .tour-chapter").text_content() == "Snapshots", "en het hoofdstuk wisselt mee")
        doel = page.locator(".tour-target").first.bounding_box()
        check(omsluit(page, doel), "het gat is meegegleden naar het nieuwe onderdeel")
        page.locator("#bucky-tour .tour-close").click()
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        page.wait_for_timeout(500)
        check(page.locator("#bucky-tour-spot").count() == 0 and hash_van(page) == "#overview", "het kruisje sluit alles en brengt terug")
        page.locator("[data-tour-start]").first.click()
        page.wait_for_selector("#bucky-tour.tour-in", timeout=5000)
        check(titel(page) == WELKOM, "de Tour-knop haalt hem terug, ook al kent de sessie hem")
        page.keyboard.press("Escape")
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)

        # ---- A. aanmaken en houden -----------------------------------------------------
        print("-- A. aanmaken en houden")
        soc = SocStub()
        page = open_security(browser.new_context(**desktop), soc=soc)
        naar_soc(page)
        check(hash_van(page) == "#rules" and page.locator("#soc-rules-head").get_attribute("data-can-create") == "1",
              "Detection Rules geopend; rechten en limiet staan op de pagina")
        check(page.locator("#bucky-tour .tour-count").text_content() == "3 of 4", "een SOC-stap telt mee zodra hij er is")
        knop = maak_regel(page, check)
        if SCHERM:
            page.screenshot(path=os.path.join(SCHERM, "soc_create_desktop.png"))
        knop.click()
        wacht_titel(page, KEUZE)
        check(("POST", "rules") in soc.calls and soc.last_post["name"] == REGELNAAM
              and soc.last_post["conditions"] == [{"type": "mentions_greater_equal", "count": 40}], "de regel is echt aangemaakt met het sjabloon")
        check(page.locator(".tour-target").first.get_attribute("data-rule-id") == "101", "de uitsnede wijst naar de nieuwe regel")
        keuzes = page.locator("#bucky-tour .tour-btn-choice")
        check(keuzes.count() == 2 and keuzes.nth(0).inner_text() == "Keep it" and keuzes.nth(1).inner_text() == "Delete it", "de keuze: houden of verwijderen")
        if SCHERM:
            page.screenshot(path=os.path.join(SCHERM, "soc_choice_desktop.png"))
        keuzes.nth(0).click()
        wacht_titel(page, BOOST)
        check(hash_van(page) == "#settings", "houden: door naar Settings")
        page.locator("#bucky-tour .tour-back").click()
        wacht_titel(page, REGELS)
        check(hash_van(page) == "#rules", "Back slaat de doe-stappen over")
        page.keyboard.press("Escape")
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        page.wait_for_timeout(700)
        check(not any(m == "DELETE" for m, _ in soc.calls) and len(soc.rules) == 1, "gehouden is gehouden: geen DELETE")

        # ---- B. aanmaken en verwijderen, tot en met het slot ------------------------------
        print("-- B. aanmaken en verwijderen")
        soc = SocStub()
        page = open_security(browser.new_context(**desktop), soc=soc)
        naar_soc(page)
        maak_regel(page, lambda ok, t: None).click()
        wacht_titel(page, KEUZE)
        page.locator("#bucky-tour .tour-btn-choice").nth(1).click()
        wacht_titel(page, WEG)
        doel = page.locator(".tour-target").first
        check(hash_van(page) == "#rules" and doel.inner_text() == "Delete"
              and doel.evaluate("e => e.closest('tr').dataset.ruleId") == "101", "verwijderen: de Delete-knop van díe regel")
        ok, waarom = verlicht(page, 'tr[data-rule-id="101"] .sec-btn-danger')
        check(ok, f"uitgelicht en bereikbaar bij het verwijderen: de Delete-knop {waarom}")
        doel.click()
        page.wait_for_selector('[aria-modal="true"]', timeout=5000)
        page.wait_for_timeout(600)
        check(page.locator("#bucky-tour").evaluate("e => e.classList.contains('tour-yield')"), "de kaart wijkt voor de bevestiging")
        check(not page.locator("#bucky-tour-spot").evaluate("e => e.classList.contains('tour-yield')"), "maar de demping blijft")
        ok, waarom = verlicht(page, '[aria-modal="true"] button')
        check(ok, f"en de bevestiging zelf is uitgelicht, met beide knoppen bereikbaar {waarom}")
        if SCHERM:
            page.screenshot(path=os.path.join(SCHERM, "soc_confirm_desktop.png"))
        page.keyboard.press("Escape")
        page.wait_for_selector('[aria-modal="true"]', state="detached", timeout=5000)
        check(page.locator("#bucky-tour").count() == 1, "Escape sluit eerst de bevestiging, niet de tour")
        page.locator(".tour-target").first.click()
        page.wait_for_selector('[aria-modal="true"]', timeout=5000)
        page.locator('[aria-modal="true"] button', has_text="Delete").click()
        wacht_titel(page, BOOST)
        check(("DELETE", 101) in soc.calls and soc.rules == [], "de regel is echt weg en de tour ging door")
        volgende(page, SLOT)
        check(page.locator("#bucky-tour").evaluate("e => e.classList.contains('tour-center')")
              and page.locator("#bucky-tour .tour-next").inner_text() == "Finish", "de slotkaart, met Finish")
        breedte = page.locator("#bucky-tour .tour-progress i").evaluate("e => e.getBoundingClientRect().width / e.parentElement.getBoundingClientRect().width")
        check(breedte > 0.99, "de balk staat vol")
        if SCHERM:
            page.screenshot(path=os.path.join(SCHERM, "vorm_slot.png"))
        page.locator("#bucky-tour .tour-next").click()
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        page.wait_for_timeout(700)
        check(page.evaluate("document.body.dataset.tourState") == "done" and hash_van(page) == "#overview", "Finish eindigt bij de ingang")
        check(sum(1 for m, _ in soc.calls if m == "DELETE") == 1, "geen tweede DELETE bij het afsluiten")

        # ---- C. afhaken ------------------------------------------------------------------
        print("-- C. afhaken")
        soc = SocStub()
        page = open_security(browser.new_context(**desktop), soc=soc)
        naar_soc(page)
        maak_regel(page, lambda ok, t: None).click()
        wacht_titel(page, KEUZE)
        page.keyboard.press("Escape")
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        page.wait_for_function("() => document.body.dataset.tourState === 'skipped'")
        page.wait_for_timeout(900)
        check(("DELETE", 101) in soc.calls and soc.rules == [] and hash_van(page) == "#overview", "afhaken na het aanmaken: regel weg, tabblad terug")
        soc2 = SocStub()
        page = open_security(browser.new_context(**desktop), soc=soc2)
        naar_soc(page)
        maak_regel(page, lambda ok, t: None)
        page.keyboard.press("Escape")
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        page.wait_for_timeout(700)
        check(not any(m in ("POST", "DELETE") for m, _ in soc2.calls), "afhaken in het formulier: geen regel, niets te verwijderen")
        # Not now op de welkomstkaart: geen tour, sessie onthoudt het
        page = open_security(browser.new_context(**desktop), soc=SocStub(), begin=False)
        page.locator("#bucky-tour .tour-skip").click()
        page.wait_for_selector("#bucky-tour", state="detached", timeout=5000)
        check(page.evaluate("sessionStorage.getItem('bucky_tour_seen_security')") == "1", "Not now: de sessie onthoudt het")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        check(page.locator("#bucky-tour").count() == 0, "en na herladen komt hij niet terug")

        # ---- D/E/F. limiet vol, alleen-lezen, geen SOC ------------------------------------
        print("-- D. limiet vol")
        soc = SocStub(at_limit=True)
        page = open_security(browser.new_context(**desktop), soc=soc)
        naar_soc(page)
        volgende(page, LIMIET)
        check(page.locator(".tour-target").first.get_attribute("id") == "soc-rules-head", "wijst naar waar de grens staat")
        volgende(page, BOOST)
        check(not any(m == "POST" for m, _ in soc.calls), "aanmaken overgeslagen")
        print("-- E. alleen-lezen")
        soc = SocStub()
        page = open_security(browser.new_context(**desktop), soc=soc, can_edit=False)
        naar_soc(page)
        volgende(page, LEZEN)
        volgende(page, BOOST)
        check(not any(m == "POST" for m, _ in soc.calls), "zonder rechten geen aanmaakstap")
        print("-- F. geen SOC")
        soc = SocStub()
        page = open_security(browser.new_context(**desktop), soc=soc, soc_aan=False)
        volgende(page, SNAPSHOTS)
        volgende(page, BOOST)
        check(soc.calls == [] and page.locator("#bucky-tour .tour-count").text_content() == "3 of 3",
              "zonder SOC wordt het blok stil overgeslagen en belooft de telling het ook niet")

        # ---- G. reduced motion --------------------------------------------------------------
        print("-- G. reduced motion")
        page4 = open_security(browser.new_context(**desktop, reduced_motion="reduce"), soc=SocStub(), begin=False)
        for sel in ("#bucky-tour", "#bucky-tour-spot", "#bucky-tour .tour-progress i"):
            overgang = page4.locator(sel).evaluate("e => getComputedStyle(e).transitionDuration")
            duur = max(float(x.strip().rstrip("s")) for x in overgang.split(","))
            check(duur < 0.01, f"geen animatie met prefers-reduced-motion op {sel} ({overgang})")

        # ---- H. telefoon ----------------------------------------------------------------------
        print("-- H. telefoon")
        soc = SocStub()
        ctx4 = browser.new_context(viewport={"width": 375, "height": 667}, is_mobile=True, has_touch=True)
        page5 = open_security(ctx4, soc=soc, begin=False)
        check(page5.locator("#bucky-tour").evaluate("e => e.classList.contains('tour-center')"), "de welkomstkaart ook op de telefoon in het midden")
        if SCHERM:
            page5.screenshot(path=os.path.join(SCHERM, "vorm_welkom_mobiel.png"))
        page5.locator("#bucky-tour .tour-next").click()
        wacht_titel(page5, SECTIES)
        check(page5.evaluate("document.getElementById('sec-app').classList.contains('nav-open')"), "de tour opent de lade voor de zijbalk")
        volgende(page5, SNAPSHOTS)
        page5.wait_for_timeout(400)
        check(not page5.evaluate("document.getElementById('sec-app').classList.contains('nav-open')"), "en sluit hem bij de volgende stap")
        b = page5.locator("#bucky-tour").bounding_box()
        doel = page5.locator(".tour-target").first.bounding_box()
        check(b is not None and doel is not None and not snijdt(b, doel), "de balk bedekt het onderdeel niet")
        volgende(page5, REGELS)
        knop = maak_regel(page5, lambda ok, t: None)
        page5.wait_for_timeout(500)
        if SCHERM:
            page5.screenshot(path=os.path.join(SCHERM, "soc_create_mobile.png"))
        knop.click()
        wacht_titel(page5, KEUZE)
        if SCHERM:
            page5.screenshot(path=os.path.join(SCHERM, "soc_choice_mobile.png"))
        page5.locator("#bucky-tour .tour-btn-choice").nth(1).click()
        wacht_titel(page5, WEG)
        page5.locator(".tour-target").first.click()
        page5.wait_for_selector('[aria-modal="true"]', timeout=5000)
        page5.locator('[aria-modal="true"] button', has_text="Delete").click()
        wacht_titel(page5, BOOST)
        check(soc.rules == [], "op de telefoon gaat de regel ook echt weg")

        browser.close()
    if fouten:
        print(f"\n{len(fouten)} fout(en)")
        return 1
    print("\nalles klopt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
