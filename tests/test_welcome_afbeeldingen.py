"""Afbeeldingen in de welcome-bouwer: plakken, uploaden, en wat er mis is.

WAT HIER WORDT VASTGEHOUDEN (26 september 2026)
1. ELK BLOK MET EEN AFBEELDING HEEFT DRIE WEGEN: lijst, upload, plakken. Tot
   vandaag stond het plakveld alleen bij "Image"; bij "Text with image" beloofde
   de uitleg het wel, maar was er geen veld. In welcome en in leave.
2. EEN GEWEIGERDE LINK WORDT NIET OPGEHAALD. De preview zette elke getypte URL
   in een <img>; dat is het baken waar de allowlist tegen bestaat.
3. ELKE WEIGERING ZEGT WAT ER MIS IS en blijft staan (een toast is na drie
   seconden weg): grootte met limiet, het aangeboden type, de toegestane
   domeinen, hoeveel er al staan. En wat de browser al weet, gaat niet eerst
   over de lijn.
4. EEN TAB WISSELT OOK ALS ER NOG EEN LINK IN EEN VELD STAAT. De `change` bij
   het verlaten van het veld bouwde de tabs opnieuw op, midden in de klik.

De serverkant van dezelfde meldingen: backend/tests/test_welcome_upload_route.py.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_welcome_afbeeldingen.py
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
HOSTS = wp.LIMITS["image_hosts"]

DOC = {"v": 1, "accent": 0x5865F2, "blocks": [
    {"type": "section", "content": "Hey {user}", "accessory": None},
    {"type": "image", "url": ""},
]}

FOUTEN = []


def eis(voorwaarde, melding):
    print(("  ok   " if voorwaarde else "  FOUT ") + melding)
    if not voorwaarde:
        FOUTEN.append(melding)


def open_scherm(browser, *, afbeeldingen=(), upload_antwoord=None):
    page = browser.new_page(viewport={"width": 1400, "height": 1000})
    page.add_init_script("localStorage.setItem('bucky_active_guild', JSON.stringify("
                         "{id: '%s', name: 'Bucky HQ', icon: null}));" % GID)
    spoor = {"extern": [], "posts": [], "fouten": []}
    page.on("pageerror", lambda e: spoor["fouten"].append(str(e)))

    def vang(r):
        u = r.request.url
        if "i.imgur.com" in u or "example.com" in u:
            spoor["extern"].append(u)
            return r.abort()
        return r.fallback()
    page.route("**/*", vang)
    wp.stub(page, dict(wp.welcome_antwoord("welcome", DOC),
                       images=list(afbeeldingen), limits=wp.LIMITS))

    def upload(r):
        spoor["posts"].append(r.request.url)
        status, bericht = upload_antwoord or (200, None)
        body = ({"ok": False, "error": {"message": bericht}} if bericht
                else {"ok": True, "data": {"token": "a" * 32, "filename": "x.png",
                                           "url": "https://api.buckybot.app/i/w/" + "a" * 32 + ".png"}})
        r.fulfill(status=status, content_type="application/json", body=json.dumps(body))
    page.route(f"**/api/server/{GID}/welcome/images", upload)
    page.goto(f"{BASIS}/server.html?guild_id={GID}#welcome", wait_until="networkidle")
    page.wait_for_selector(".srv-welcome", timeout=15000)
    return page, spoor


def plakvelden(page):
    return page.locator(".srv-welcome input[type=url]")


def zichtbare_fout(page):
    f = page.locator(".srv-fout:not([hidden])")
    return f.first.inner_text() if f.count() else ""


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        print("\n1. Elk blok met een afbeelding heeft een plakveld, in welcome en leave")
        page, spoor = open_scherm(browser)
        eis(plakvelden(page).count() == 2, "welcome: Text with image EN Image hebben een plakveld")
        page.get_by_role("tab", name="Goodbye").click()
        page.locator(".srv-welcome button", has_text="+ Text with image").click()
        page.locator(".srv-welcome button", has_text="+ Image").click()
        page.wait_for_timeout(200)
        eis(plakvelden(page).count() == 2, "leave: dezelfde twee plakvelden")
        page.close()

        print("\n2. Een geweigerde link wordt niet opgehaald, en zegt welke domeinen wel mogen")
        for i, blok in ((0, "Text with image"), (1, "Image")):
            page, spoor = open_scherm(browser)
            veld = plakvelden(page).nth(i)
            veld.fill("https://i.imgur.com/abc.png")
            page.wait_for_timeout(300)
            eis(not spoor["extern"], f"{blok}: tijdens het typen niets opgehaald")
            veld.press("Enter")
            page.wait_for_timeout(300)
            fout = zichtbare_fout(page)
            eis("i.imgur.com" in fout and all(h in fout for h in HOSTS),
                f"{blok}: melding noemt de host en alle toegestane domeinen")
            eis(not spoor["extern"], f"{blok}: ook na Enter niets opgehaald")
            eis(page.locator(".dc-surface img[src*='imgur']").count() == 0,
                f"{blok}: geen <img> met die link in de preview")
            page.close()

        page, spoor = open_scherm(browser)
        v = plakvelden(page).nth(1)
        v.fill("https://cdn.discordapp.com/attachments/1/2/rules.pdf"); v.press("Enter")
        eis(".pdf" in zichtbare_fout(page), "een link naar geen afbeelding noemt de extensie")
        v.fill("http://cdn.discordapp.com/a.png"); v.press("Enter")
        eis("https://" in zichtbare_fout(page), "http in plaats van https zegt dat")
        goed = "https://cdn.discordapp.com/embed/avatars/0.png"
        v.fill(goed); v.press("Enter"); page.wait_for_timeout(200)
        eis(zichtbare_fout(page) == "", "een goede link wist de melding")
        eis(page.locator(f".dc-surface img[src='{goed}']").count() == 1,
            "een goede link staat in de preview")
        page.close()

        print("\n3. Uploads: wat de browser al weet, gaat niet over de lijn")
        page, spoor = open_scherm(browser)
        groot = b"\x89PNG\r\n\x1a\n" + b"\0" * (3 * 1024 * 1024)
        page.locator(".srv-welcome input[type=file]").first.set_input_files(
            {"name": "banner.png", "mimeType": "image/png", "buffer": groot})
        page.wait_for_timeout(300)
        fout = zichtbare_fout(page)
        eis("3.0 MB" in fout and "2 MB" in fout, f"te groot: grootte en limiet ({fout[:60]}...)")
        eis(not spoor["posts"], "te groot: niets verstuurd")
        page.locator(".srv-welcome input[type=file]").first.set_input_files(
            {"name": "flyer.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4"})
        page.wait_for_timeout(300)
        fout = zichtbare_fout(page)
        eis("flyer.pdf" in fout and "application/pdf" in fout, "verkeerd type: noemt wat er is aangeboden")
        eis(not spoor["posts"], "verkeerd type: niets verstuurd")
        page.close()

        tien = [{"token": f"{i:032x}", "filename": f"img{i}.png",
                 "url": f"https://api.buckybot.app/i/w/{i:032x}.png"} for i in range(10)]
        page, spoor = open_scherm(browser, afbeeldingen=tien)
        page.locator(".srv-welcome input[type=file]").first.set_input_files(
            {"name": "logo.png", "mimeType": "image/png", "buffer": b"\x89PNG\r\n\x1a\n" + b"\0" * 64})
        page.wait_for_timeout(300)
        eis("10 of 10" in zichtbare_fout(page), "te veel: noemt hoeveel er al staan")
        eis(not spoor["posts"], "te veel: niets verstuurd")
        page.close()

        print("\n4. Wat de server weigert, blijft staan tot de volgende handeling")
        bericht = "banner.png (sent as image/png) is an HTML web page. Only PNG, JPEG, GIF or WebP images can be uploaded."
        page, spoor = open_scherm(browser, upload_antwoord=(400, bericht))
        page.locator(".srv-welcome input[type=file]").first.set_input_files(
            {"name": "banner.png", "mimeType": "image/png", "buffer": b"\x89PNG\r\n\x1a\n" + b"\0" * 64})
        page.wait_for_timeout(4000)                   # langer dan een toast leeft
        eis(zichtbare_fout(page) == bericht, "de melding van de server staat er na 4 s nog")
        eis(len(spoor["posts"]) == 1, "en die ging wel over de lijn")
        page.close()

        print("\n5. Een tab wisselt ook met een link die nog in een veld staat")
        page, spoor = open_scherm(browser)
        plakvelden(page).nth(0).fill("https://cdn.discordapp.com/embed/avatars/1.png")
        page.get_by_role("tab", name="Goodbye").click()
        page.wait_for_timeout(300)
        gekozen = page.locator("[role=tab][aria-selected=true]").inner_text()
        eis(gekozen.startswith("Goodbye"), f"de klik op Goodbye kwam aan (actief: {gekozen!r})")
        eis(not spoor["fouten"], f"geen paginafouten ({spoor['fouten'][:1]})")
        page.close()

        browser.close()

    print(f"\n{'ALLES GOED' if not FOUTEN else str(len(FOUTEN)) + ' FOUT(EN)'}")
    sys.exit(1 if FOUTEN else 0)


if __name__ == "__main__":
    main()
