"""Alleen tekst: de knoppenrij blijft bewerkbaar, de kaart-containers gaan weg (14-10-2026).

WAT HIER WORDT VASTGEHOUDEN, voor welcome EN leave (de tab "Goodbye"):
1. BIJ "TEXT ONLY" IS HET TEKSTVELD ZICHTBAAR. Dat is het enige veld dat dan nog
   iets naar Discord stuurt dat tekst is, dus het hoort niet onder een kaart te
   staan die er niet meer is.
2. DE KNOPPENRIJ BLIJFT STAAN EN BLIJFT BEWERKBAAR. Een knop mag bij alleen
   tekst - de bot zet hem onder het bericht (welcome_render.bouw) - dus het zou
   niet uit te leggen zijn dat je hem hier niet meer kunt instellen.
3. DE KAART-CONTAINERS ZIJN VERBORGEN: text, divider, text-with-image en image
   komen bij deze vorm niet in het bericht, en een veld dat niets doet terwijl
   je erin typt is erger dan geen veld.
4. VERBORGEN IS NIET WEG. Terug op "Embed only" staan ze er weer, met dezelfde
   inhoud. Het document houdt zijn blokken - de vorm bepaalt alleen wat er van
   verstuurd wordt, aan de botkant net zo.
5. DE PREVIEW ZET DE KNOPPEN ONDERAAN, buiten de kaart.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_welcome_alleen_tekst.py
"""

import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright        # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
import welcome_previews as wp                           # noqa: E402

BASIS = os.environ.get("WELCOME_BASIS", "http://127.0.0.1:8899")
GID = wp.GID
FOUTEN = []
TAB = {"welcome": "Welcome", "leave": "Goodbye"}

# De vier kaart-containers naast de knoppenrij. Namen zoals ze in de kop van een
# blok staan (BLOKNAAM in js/server/pages/welcome.js).
KAARTBLOKKEN = ["text", "separator", "section", "image"]


def eis(voorwaarde, melding):
    print(("  ok   " if voorwaarde else "  FOUT ") + melding)
    if not voorwaarde:
        FOUTEN.append(melding)


def doc():
    """Eén van elke soort, zodat "verborgen" over alle containers gaat."""
    return {"v": 1, "accent": 0x5865F2, "text": "Hi {user}", "blocks": [
        {"type": "text", "content": "Card for {displayname}"},
        {"type": "separator", "divider": True, "spacing": "small"},
        {"type": "section", "content": "Member {membercount}", "accessory": None},
        {"type": "image", "url": ""},
        {"type": "buttons", "items": [
            {"label": "Site", "url": "https://buckybot.app/", "style": "link"}]},
    ]}


def open_scherm(browser, soort):
    page = browser.new_page(viewport={"width": 1400, "height": 1100})
    page.add_init_script("localStorage.setItem('bucky_active_guild', JSON.stringify("
                         "{id: '%s', name: 'Bucky HQ', icon: null}));" % GID)
    fouten = []
    page.on("pageerror", lambda e: fouten.append(str(e)))
    wp.stub(page, wp.welcome_antwoord(soort, doc()))
    page.goto(f"{BASIS}/server.html?guild_id={GID}#welcome", wait_until="networkidle")
    page.wait_for_selector(".srv-welcome", timeout=15000)
    page.get_by_role("tab", name=TAB[soort]).click()
    page.wait_for_timeout(250)
    return page, fouten


def soorten(page):
    """De blokken die in de bouwer staan, op volgorde."""
    return page.locator(".srv-block").evaluate_all(
        "ns => ns.map(n => n.dataset.soort)")


def delen(page):
    return page.locator(".dc-surface [data-part]").evaluate_all(
        "ns => ns.map(n => n.dataset.part)")


def kies(page, label):
    page.get_by_label(label, exact=True).check()
    page.wait_for_timeout(200)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for soort in ("welcome", "leave"):
            print(f"\n=== {soort} ===")
            page, jsfouten = open_scherm(browser, soort)

            print("1. Embed only: alle containers staan er")
            eis(soorten(page) == KAARTBLOKKEN + ["buttons"],
                f"vijf blokken, knoppen onderaan ({soorten(page)})")

            print("2. Text only: tekstveld en knoppen, geen kaart-containers")
            kies(page, "Text only")
            eis(page.get_by_label("Message text", exact=True).is_visible(),
                "het tekstveld is zichtbaar")
            eis(soorten(page) == ["buttons"],
                f"alleen de knoppenrij staat in de bouwer ({soorten(page)})")
            for naam in KAARTBLOKKEN:
                eis(page.locator(f".srv-block[data-soort={naam}]").count() == 0,
                    f"de container {naam} is verborgen")

            print("3. De knoppenrij is echt bewerkbaar")
            label = page.locator(".srv-block[data-soort=buttons] input").first
            eis(label.is_visible() and label.is_enabled(), "het knoplabel is te bewerken")
            label.fill("Our rules")
            page.wait_for_timeout(200)
            knop = page.locator(".dc-surface .dc-btn").first.inner_text()
            eis("Our rules" in knop, f"de preview volgt het nieuwe label ({knop!r})")
            page.get_by_role("button", name="+ Button", exact=True).click()
            page.wait_for_timeout(200)
            eis(page.locator(".srv-block[data-soort=buttons] .srv-knoprij").count() == 2,
                "er kan een knop bij")

            print("4. De preview: tekst, knoppen onderaan, buiten de kaart")
            eis(delen(page) == ["text", "buttons"], f"tekst en knoppen ({delen(page)})")
            eis(page.locator(".dc-surface .dc-container .dc-buttons").count() == 0,
                "de knoppen staan niet in een kaart")

            print("5. Verborgen is niet weg")
            kies(page, "Embed only")
            eis(soorten(page) == KAARTBLOKKEN + ["buttons"],
                f"de containers zijn terug ({soorten(page)})")
            terug = page.locator(".srv-block[data-soort=text] textarea").first.input_value()
            eis(terug == "Card for {displayname}", f"met hun inhoud ({terug!r})")

            eis(not jsfouten, f"geen JS-fouten ({jsfouten})")
            page.close()

        browser.close()

    if FOUTEN:
        print(f"\n{len(FOUTEN)} FOUT(EN)")
        sys.exit(1)
    print("\nalles ok")


if __name__ == "__main__":
    main()
