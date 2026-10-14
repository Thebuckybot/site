"""De vorm van het bericht in de welcome-bouwer: kaart, tekst, of allebei (14-10-2026).

WAT HIER WORDT VASTGEHOUDEN, voor welcome EN leave (de tab "Goodbye"):
1. EEN OUD BERICHT ZONDER VORM staat op "Embed only", en de preview is de kaart
   met de knoppen erin - zoals het was.
2. DE PREVIEW TOONT DE GEKOZEN VORM IN DE GEKOZEN VOLGORDE, en verandert bij elke
   klik op een vorm en bij elke toets in het tekstvak:
     Text only          tekst, knoppen
     Text above embed   tekst, kaart, knoppen
     Embed above text   kaart, tekst, knoppen
3. DE PLACEHOLDERS werken in de tekst, net als in de kaart.
4. DE EDITOR WEIGERT met een leesbare melding: tekst boven 2000 tekens, en een
   lege tekst bij "Text only". Opslaan stuurt dan niets naar de server.
5. OPSLAAN stuurt `mode` en `text` mee.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_welcome_berichtvorm.py
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
FOUTEN = []
TAB = {"welcome": "Welcome", "leave": "Goodbye"}


def eis(voorwaarde, melding):
    print(("  ok   " if voorwaarde else "  FOUT ") + melding)
    if not voorwaarde:
        FOUTEN.append(melding)


def doc(**velden):
    return {"v": 1, "accent": 0x5865F2, "blocks": [
        {"type": "text", "content": "Card for {displayname}"},
        {"type": "buttons", "items": [{"label": "Site", "url": "https://buckybot.app/", "style": "link"}]},
    ], **velden}


def open_scherm(browser, soort, d):
    page = browser.new_page(viewport={"width": 1400, "height": 1100})
    page.add_init_script("localStorage.setItem('bucky_active_guild', JSON.stringify("
                         "{id: '%s', name: 'Bucky HQ', icon: null}));" % GID)
    spoor = {"patch": None, "fouten": []}
    page.on("pageerror", lambda e: spoor["fouten"].append(str(e)))
    wp.stub(page, wp.welcome_antwoord(soort, d))

    def opslaan(r):
        if r.request.method == "PATCH":
            spoor["patch"] = json.loads(r.request.post_data or "{}")
        r.fulfill(status=200, content_type="application/json",
                  body=json.dumps({"ok": True, "data": {"kind": soort, "enabled": True,
                                                        "channel_id": None, "layout": d}}))
    page.route(f"**/api/server/{GID}/welcome/{soort}", opslaan)
    page.goto(f"{BASIS}/server.html?guild_id={GID}#welcome", wait_until="networkidle")
    page.wait_for_selector(".srv-welcome", timeout=15000)
    page.get_by_role("tab", name=TAB[soort]).click()
    page.wait_for_timeout(200)
    return page, spoor


def delen(page):
    """De delen van het bericht in de preview, op volgorde."""
    return page.locator(".dc-surface [data-part]").evaluate_all(
        "ns => ns.map(n => n.dataset.part)")


def knoppen_in_kaart(page):
    return page.locator(".dc-surface .dc-container .dc-buttons").count()


def kies(page, label):
    page.get_by_label(label, exact=True).check()
    page.wait_for_timeout(150)


def fout(page):
    return " ".join(t for t in page.locator("#srv-vorm-fout:not([hidden])").all_inner_texts())


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for soort in ("welcome", "leave"):
            print(f"\n=== {soort} ===")

            print("1. Een oud bericht zonder vorm is alleen de kaart")
            page, spoor = open_scherm(browser, soort, doc())
            eis(page.get_by_label("Embed only", exact=True).is_checked(), "Embed only staat aan")
            eis(delen(page) == ["embed"], f"preview: alleen de kaart ({delen(page)})")
            eis(knoppen_in_kaart(page) == 1, "de knoppen staan in de kaart")

            print("2. Elke vorm, in volgorde, live")
            kies(page, "Text only")
            veld = page.get_by_label("Message text", exact=True)
            veld.fill("Hi {user}, welcome to {server}")
            page.wait_for_timeout(150)
            eis(delen(page) == ["text", "buttons"], f"Text only: tekst, knoppen ({delen(page)})")
            los = page.locator(".dc-surface [data-part=text]").inner_text()
            eis(los == "Hi @NewMember, welcome to Your Server", f"placeholders in de tekst ({los!r})")
            veld.fill("Changed {membercount}")
            page.wait_for_timeout(150)
            eis(page.locator(".dc-surface [data-part=text]").inner_text() == "Changed 142",
                "de preview volgt elke toets")

            kies(page, "Text above embed")
            eis(delen(page) == ["text", "embed", "buttons"], f"tekst boven ({delen(page)})")
            eis(knoppen_in_kaart(page) == 0, "de knoppen staan onder het bericht, niet in de kaart")
            kaart = page.locator(".dc-surface .dc-container").inner_text()
            eis("Card for New Member" in kaart, f"placeholders in de kaart ({kaart!r})")

            kies(page, "Embed above text")
            eis(delen(page) == ["embed", "text", "buttons"], f"kaart boven ({delen(page)})")

            kies(page, "Embed only")
            eis(delen(page) == ["embed"], "terug naar alleen de kaart")
            eis(knoppen_in_kaart(page) == 1, "en de knoppen weer in de kaart")

            print("3. Opslaan stuurt de vorm en de tekst mee")
            kies(page, "Embed above text")
            page.locator("#srv-welcome-save").click()
            page.wait_for_timeout(400)
            layout = (spoor["patch"] or {}).get("layout") or {}
            eis(layout.get("mode") == "embed_text" and layout.get("text") == "Changed {membercount}",
                f"PATCH bevat mode en text ({layout.get('mode')!r}, {layout.get('text')!r})")
            eis(not spoor["fouten"], f"geen JS-fouten ({spoor['fouten']})")
            page.close()

            print("4. Validatie: lege tekst bij Text only, te lange tekst")
            page, spoor = open_scherm(browser, soort, doc())
            kies(page, "Text only")
            eis("empty" in fout(page).lower(), f"lege tekst bij Text only wordt gemeld ({fout(page)!r})")
            page.locator("#srv-welcome-save").click()
            page.wait_for_timeout(300)
            eis(spoor["patch"] is None, "opslaan stuurt dan niets")

            page.get_by_label("Message text", exact=True).fill("a" * 2001)
            page.wait_for_timeout(150)
            eis("2001 of 2000" in fout(page), f"te lange tekst wordt gemeld met het getal ({fout(page)!r})")
            page.locator("#srv-welcome-save").click()
            page.wait_for_timeout(300)
            eis(spoor["patch"] is None, "opslaan stuurt dan niets")

            page.get_by_label("Message text", exact=True).fill("a" * 2000)
            page.wait_for_timeout(150)
            eis(fout(page) == "", "2000 tekens mag")
            page.close()

        browser.close()

    if FOUTEN:
        print(f"\n{len(FOUTEN)} FOUT(EN)")
        sys.exit(1)
    print("\nalles ok")


if __name__ == "__main__":
    main()
