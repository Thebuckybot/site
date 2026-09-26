"""De kanaalknop in de welcome-bouwer.

WAT HIER WORDT VASTGEHOUDEN (26 september 2026)
1. EEN KANAAL KIES JE UIT EEN LIJST. Geen invoerveld voor een id.
2. WAT ER OPGESLAGEN WORDT IS ALLEEN HET KANAAL: `kind: "channel"` en
   `channel_id`. Geen URL en geen server-id - die vult de bot in uit zijn eigen
   server (backend/tests/test_welcome_kanaalknop.py, bucky1.0/tests/...).
3. HET LABEL VOLGT HET KANAAL ("#rules") tot de beheerder er zelf iets van maakt.
4. DE PREVIEW TOONT DE KNOP ZOALS DISCORD HEM TOONT: het label, met het pijltje
   van een linkknop.
5. EEN VERDWENEN KANAAL WORDT BIJ HET LADEN GEMELD, bovenaan en bij de knop, en
   de preview laat zien dat die knop niet meegaat. Kon de kanaallijst niet
   worden opgehaald, dan heet niets "verwijderd".

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_welcome_kanaalknop.py [map-voor-schermafbeeldingen]
"""

import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright        # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
import welcome_previews as wp                           # noqa: E402

BASIS = os.environ.get("WELCOME_BASIS", "http://127.0.0.1:8899")
GID = wp.GID
SCHERM = sys.argv[1] if len(sys.argv) > 1 else None
KANALEN = [
    {"id": "111111111111111111", "name": "welcome", "type": 0},
    {"id": "444444444444444444", "name": "rules", "type": 0},
    {"id": "555555555555555555", "name": "roles", "type": 0},
]
WEG = "999999999999999999"
FOUTEN = []


def eis(voorwaarde, melding):
    print(("  ok   " if voorwaarde else "  FOUT ") + melding)
    if not voorwaarde:
        FOUTEN.append(melding)


def open_scherm(browser, doc, *, kanalen=KANALEN, bekend=True, breed=1400):
    page = browser.new_page(viewport={"width": breed, "height": 1100}, device_scale_factor=2)
    page.add_init_script("localStorage.setItem('bucky_active_guild', JSON.stringify("
                         "{id: '%s', name: 'Bucky HQ', icon: null}));" % GID)
    spoor = {"patch": None, "fouten": []}
    page.on("pageerror", lambda e: spoor["fouten"].append(str(e)))
    data = dict(wp.welcome_antwoord("welcome", doc), channels=kanalen,
                channels_known=bekend, limits=wp.LIMITS)
    wp.stub(page, data)

    def opslaan(r):
        if r.request.method == "PATCH":
            spoor["patch"] = json.loads(r.request.post_data or "{}")
        r.fulfill(status=200, content_type="application/json",
                  body=json.dumps({"ok": True, "data": {"kind": "welcome", "layout": doc}}))
    page.route(f"**/api/server/{GID}/welcome/welcome", opslaan)
    page.goto(f"{BASIS}/server.html?guild_id={GID}#welcome", wait_until="networkidle")
    page.wait_for_selector(".srv-welcome", timeout=15000)
    return page, spoor


def knoppen_doc(*items):
    return {"v": 1, "accent": 0x5865F2, "blocks": [
        {"type": "text", "content": "Welcome {user}!"},
        {"type": "buttons", "items": list(items)}]}


def preview_knoppen(page):
    # Label en pijltje zijn twee spans; `inner_text` zet er een regeleinde tussen.
    return [t.replace("\n", "") for t in page.locator(".dc-surface .dc-btn").all_inner_texts()]


def foto(page, naam, *, preview=False):
    if not SCHERM:
        return
    os.makedirs(SCHERM, exist_ok=True)
    doel = page.locator(".dc-surface") if preview else page.locator(".srv-block").nth(1)
    if preview:
        # De preview plakt bovenaan; na scrollen valt de navigatiebalk erover.
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(150)
    else:
        doel.scroll_into_view_if_needed()
    doel.screenshot(path=os.path.join(SCHERM, naam + ".png"))


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        print("\n1. Een knop omzetten naar een kanaal: kiezen uit een lijst")
        page, spoor = open_scherm(browser, knoppen_doc(
            {"label": "Button", "url": "https://buckybot.app/", "style": "link"}))
        page.get_by_label("Where this button goes").select_option("channel")
        page.wait_for_timeout(200)
        kies = page.get_by_label("Channel", exact=True)
        eis(kies.evaluate("n => n.tagName") == "SELECT", "het kanaal is een keuzelijst, geen invoerveld")
        eis(kies.locator("option").all_inner_texts() == ["#welcome", "#rules", "#roles"],
            "de lijst toont de kanalen van de server met hun naam")
        kies.select_option(label="#rules")
        page.wait_for_timeout(200)
        eis(page.locator(".srv-knoprij input.sec-input").first.input_value() == "#rules",
            "het label volgt het kanaal")
        eis(preview_knoppen(page) == ["#rules↗"], f"de preview toont #rules als linkknop ({preview_knoppen(page)})")
        foto(page, "kanaalknop-bouwer")
        foto(page, "kanaalknop-preview", preview=True)

        page.locator("#srv-welcome-save").click()
        page.wait_for_timeout(400)
        knop = spoor["patch"]["layout"]["blocks"][1]["items"][0] if spoor["patch"] else {}
        eis(knop.get("kind") == "channel" and knop.get("channel_id") == "444444444444444444",
            "opgeslagen: kind channel met het kanaal-id")
        eis("url" not in knop and "guild_id" not in knop,
            f"opgeslagen: geen url en geen server-id ({sorted(knop)})")
        page.close()

        print("\n2. Een eigen label blijft staan als het kanaal verandert")
        page, spoor = open_scherm(browser, knoppen_doc(
            {"label": "Read the rules", "kind": "channel", "channel_id": "444444444444444444", "style": "link"}))
        page.get_by_label("Channel", exact=True).select_option(label="#roles")
        page.wait_for_timeout(200)
        eis(page.locator(".srv-knoprij input.sec-input").first.input_value() == "Read the rules",
            "eigen label blijft")
        page.close()

        print("\n3. Een verdwenen kanaal wordt bij het laden gemeld")
        page, spoor = open_scherm(browser, knoppen_doc(
            {"label": "#old-rules", "kind": "channel", "channel_id": WEG, "style": "link"},
            {"label": "Site", "url": "https://buckybot.app/", "style": "link"}))
        fouten = page.locator(".srv-fout:not([hidden])").all_inner_texts()
        eis(any("no longer exists" in f and "#old-rules" in f for f in fouten),
            "bovenaan: welke knop naar een verdwenen kanaal wijst")
        eis(any("left out of the message until you pick another channel or remove it" in f for f in fouten),
            "bij de knop: wat dat betekent")
        eis(page.get_by_label("Channel", exact=True).locator("option:checked").inner_text() == "#deleted-channel",
            "de keuzelijst kiest niet stil een ander kanaal")
        pk = preview_knoppen(page)
        eis(len(pk) == 2 and "not sent" in pk[0] and pk[1] == "Site↗",
            f"de preview laat zien dat die knop niet meegaat ({pk})")
        foto(page, "kanaalknop-verdwenen")
        foto(page, "kanaalknop-verdwenen-preview", preview=True)
        page.close()

        print("\n4. Kon de lijst niet worden opgehaald, dan is niets 'verwijderd'")
        page, spoor = open_scherm(browser, knoppen_doc(
            {"label": "#rules", "kind": "channel", "channel_id": "444444444444444444", "style": "link"}),
            kanalen=[], bekend=False)
        tekst = " ".join(page.locator(".srv-fout:not([hidden])").all_inner_texts())
        eis("no longer exists" not in tekst, "geen 'verwijderd' zonder lijst")
        eis("Could not check" in tekst, "wel: kon niet controleren")
        eis(preview_knoppen(page) == ["#rules↗"], "de preview toont de knop gewoon")
        page.close()

        print("\n5. Op een telefoon")
        page, spoor = open_scherm(browser, knoppen_doc(
            {"label": "#rules", "kind": "channel", "channel_id": "444444444444444444", "style": "link"}),
            breed=390)
        breedte = page.evaluate("document.documentElement.scrollWidth")
        eis(breedte <= 390, f"geen horizontale scroll op 390 px ({breedte})")
        eis(not spoor["fouten"], f"geen paginafouten ({spoor['fouten'][:1]})")
        page.close()

        browser.close()

    print(f"\n{'ALLES GOED' if not FOUTEN else str(len(FOUTEN)) + ' FOUT(EN)'}")
    sys.exit(1 if FOUTEN else 0)


if __name__ == "__main__":
    main()
