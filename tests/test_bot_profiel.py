"""Het Bot profile-scherm: bijnaam, avatar en bio per server.

WAT HIER WORDT VASTGEHOUDEN (26 september 2026)
1. HET SCHERM TOONT WAT DE BACKEND BIJ DISCORD OPHAALDE, en de preview toont de
   bot zoals hij er in die server uitziet: naam, avatar, bio.
2. ZONDER CHANGE NICKNAME is het naamveld dicht, met de reden erbij - vóór
   iemand op Save drukt.
3. ALLEEN WAT ER VERANDERT GAAT MEE, en LEEGMAKEN stuurt `null`: terug naar de
   eigen naam, avatar of About me van de bot.
4. EEN AVATAR wordt in de browser al beoordeeld (grootte, type) met dezelfde
   woorden als bij Welcome; een goede gaat als data-URI mee en staat lokaal in
   de preview voordat hij is opgeslagen.
5. DE RATELIMIT en andere weigeringen blijven bij de knop staan, en Save werkt
   daarna weer.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_bot_profiel.py [map-voor-schermafbeeldingen]
"""

import base64
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
AVATAR = "data:image/png;base64," + base64.b64encode(wp._png(96, 96, (139, 30, 63))).decode()
EIGEN = "data:image/png;base64," + base64.b64encode(wp._png(96, 96, (88, 101, 242))).decode()
PNG = wp._png(64, 64, (20, 160, 120))
FOUTEN = []


def eis(voorwaarde, melding):
    print(("  ok   " if voorwaarde else "  FOUT ") + melding)
    if not voorwaarde:
        FOUTEN.append(melding)


def stand(*, nick="Bucky Jr", avatar=AVATAR, bio="Here to help in this server.",
          bio_known=True, kan=True):
    return {
        "bot": {"id": "907664862493167680", "username": "bucky", "name": "Bucky.",
                "avatar_url": EIGEN, "bio": "The global About me."},
        "server": {"nick": nick, "avatar_url": avatar, "bio": bio, "bio_known": bio_known},
        "can_change_nickname": kan,
        "limits": {"max_nick": 32, "max_bio": 190, "max_upload_bytes": 2097152,
                   "changes_per_window": 20, "window_seconds": 300},
        "rate_limit": None,
    }


def open_scherm(browser, data, *, patch=None, get_status=200, breed=1400):
    page = browser.new_page(viewport={"width": breed, "height": 1100}, device_scale_factor=2)
    page.add_init_script("localStorage.setItem('bucky_active_guild', JSON.stringify("
                         "{id: '%s', name: 'Bucky HQ', icon: null}));" % GID)
    spoor = {"patches": [], "fouten": []}
    page.on("pageerror", lambda e: spoor["fouten"].append(str(e)))
    wp.stub(page, wp.welcome_antwoord("welcome", {"v": 1, "blocks": []}))

    def profiel(r):
        if r.request.method == "PATCH":
            body = json.loads(r.request.post_data or "{}")
            spoor["patches"].append(body)
            status, antwoord = patch(body) if patch else (200, None)
            if status >= 300:
                return r.fulfill(status=status, content_type="application/json",
                                 body=json.dumps({"ok": False, "error": {"message": antwoord}}))
            # DE REST VAN DE STAND BLIJFT: ook `can_change_nickname`. Een stub
            # die dat vergat, maakte na Save het naamveld weer open.
            nieuw = antwoord or json.loads(json.dumps(data))
            if not antwoord:
                for k in ("nick", "bio"):
                    if k in body:
                        nieuw["server"][k] = body[k]
            nieuw["rate_limit"] = {"limit": 20, "remaining": 17, "reset_after": 240}
            return r.fulfill(status=200, content_type="application/json",
                             body=json.dumps({"ok": True, "data": nieuw}))
        if get_status != 200:
            return r.fulfill(status=get_status, content_type="application/json", body=json.dumps(
                {"ok": False, "error": {"message": "Could not reach Discord to read the bot's "
                 "profile in this server. Nothing is shown rather than an old state; try again in a moment."}}))
        r.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "data": data}))
    page.route(f"**/api/server/{GID}/bot-profile", profiel)
    page.goto(f"{BASIS}/server.html?guild_id={GID}#botprofile", wait_until="networkidle")
    page.wait_for_timeout(500)
    return page, spoor


def preview_naam(page):
    return page.locator(".dc-msg .dc-name").inner_text()


def fout(page):
    return " | ".join(page.locator(".srv-fout:not([hidden])").all_inner_texts())


def foto(page, naam, sel=None):
    if not SCHERM:
        return
    os.makedirs(SCHERM, exist_ok=True)
    page.evaluate("window.scrollTo(0, 0)")
    pad = os.path.join(SCHERM, naam + ".png")
    if sel:
        page.locator(sel).first.screenshot(path=pad)
    else:
        page.screenshot(path=pad, full_page=True)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        print("\n1. Het scherm toont de stand, en de preview de bot in deze server")
        page, spoor = open_scherm(browser, stand())
        eis(page.locator(".sec-nav-item[data-key=botprofile]").count() == 1, "in het menu: Bot profile")
        eis(page.get_by_label("Nickname in this server").input_value() == "Bucky Jr", "de bijnaam van nu")
        eis(preview_naam(page) == "Bucky Jr", "de preview gebruikt de bijnaam")
        eis(page.locator(".dc-profiel-bio").inner_text() == "Here to help in this server.", "de bio in het profielkaartje")
        eis(page.locator(".dc-msg img.dc-avatar-img").get_attribute("src") == AVATAR, "de serveravatar in de preview")
        eis(page.locator("#srv-botprofile-save").is_disabled(), "Save staat dicht zolang er niets verandert")
        foto(page, "botprofiel-scherm")
        page.close()

        print("\n2. Instellen: alleen wat verandert gaat mee")
        page, spoor = open_scherm(browser, stand())
        page.get_by_label("Nickname in this server").fill("Helper")
        eis(preview_naam(page) == "Helper", "de preview volgt tijdens het typen")
        page.get_by_label("Bio in this server").fill("Ask me anything.")
        eis(page.locator(".dc-profiel-bio").inner_text() == "Ask me anything.", "de bio in de preview volgt")
        page.get_by_label("Upload an avatar").set_input_files(
            {"name": "face.png", "mimeType": "image/png", "buffer": PNG})
        page.wait_for_timeout(300)
        eis(page.locator(".dc-msg img.dc-avatar-img").get_attribute("src").startswith("blob:"),
            "de nieuwe avatar staat lokaal in de preview, nog niet opgeslagen")
        foto(page, "botprofiel-in-actie")
        page.locator("#srv-botprofile-save").click()
        page.wait_for_timeout(400)
        body = spoor["patches"][0] if spoor["patches"] else {}
        eis(set(body) == {"nick", "bio", "avatar"}, f"drie velden in één aanroep ({sorted(body)})")
        eis(body.get("nick") == "Helper" and body.get("bio") == "Ask me anything.", "de waarden")
        eis(str(body.get("avatar", "")).startswith("data:image/png;base64,"), "de avatar als data-URI")
        eis(len(spoor["patches"]) == 1, "één Save is één aanroep")
        page.close()

        page, spoor = open_scherm(browser, stand())
        page.get_by_label("Nickname in this server").fill("Bucky Jr")      # gelijk aan de stand
        eis(page.locator("#srv-botprofile-save").is_disabled(), "terugtypen wat er al stond is geen wijziging")
        page.close()

        print("\n3. Leegmaken: terug naar de eigen naam, avatar en About me")
        page, spoor = open_scherm(browser, stand())
        page.get_by_role("button", name="Use Bucky's own name").click()
        page.get_by_role("button", name="Use Bucky's own avatar").click()
        page.get_by_role("button", name="Use Bucky's About me").click()
        page.wait_for_timeout(200)
        eis(preview_naam(page) == "Bucky.", "de preview toont de eigen naam")
        eis(page.locator(".dc-msg img.dc-avatar-img").get_attribute("src") == EIGEN, "en de eigen avatar")
        eis(page.locator(".dc-profiel-bio").inner_text() == "The global About me.", "en de About me")
        foto(page, "botprofiel-leeggemaakt")
        page.locator("#srv-botprofile-save").click()
        page.wait_for_timeout(400)
        eis(spoor["patches"] == [{"nick": None, "avatar": None, "bio": None}],
            f"leegmaken stuurt null ({spoor['patches']})")
        page.close()

        print("\n4. Zonder Change Nickname: dicht, met de reden")
        page, spoor = open_scherm(browser, stand(kan=False))
        eis(page.get_by_label("Nickname in this server").is_disabled(), "het naamveld is dicht")
        eis("Change Nickname" in fout(page) and "Server Settings" in fout(page), "met wat er moet gebeuren")
        foto(page, "botprofiel-geen-recht", ".srv-welcome > div > .sec-card")
        page.get_by_label("Bio in this server").fill("Still works.")
        page.locator("#srv-botprofile-save").click()
        page.wait_for_timeout(300)
        eis(spoor["patches"] == [{"bio": "Still works."}], "de bio kan wel")
        eis(page.get_by_label("Nickname in this server").is_disabled(), "en het naamveld blijft dicht na Save")
        page.close()

        print("\n5. Een avatar die niet mag, zegt waarom - en gaat niet over de lijn")
        page, spoor = open_scherm(browser, stand())
        groot = b"\x89PNG\r\n\x1a\n" + b"\0" * (3 * 1024 * 1024)
        page.get_by_label("Upload an avatar").set_input_files(
            {"name": "huge.png", "mimeType": "image/png", "buffer": groot})
        page.wait_for_timeout(200)
        eis("3.0 MB" in fout(page) and "2 MB" in fout(page), "te groot: grootte en limiet")
        page.get_by_label("Upload an avatar").set_input_files(
            {"name": "cv.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4"})
        page.wait_for_timeout(200)
        eis("cv.pdf" in fout(page) and "application/pdf" in fout(page), "verkeerd type: wat er is aangeboden")
        eis(page.locator("#srv-botprofile-save").is_disabled() and not spoor["patches"], "niets verstuurd")
        page.close()

        print("\n6. De ratelimit blijft bij de knop staan, en Save werkt daarna weer")
        melding = ("Discord allows 20 changes to the bot's profile per 5 minutes in a server, "
                   "and that limit has been reached. Try again in 188 seconds. Nothing was changed.")
        page, spoor = open_scherm(browser, stand(), patch=lambda b: (429, melding))
        page.get_by_label("Nickname in this server").fill("Helper")
        page.locator("#srv-botprofile-save").click()
        page.wait_for_timeout(4000)                       # langer dan een toast leeft
        eis(melding in fout(page), "de melding staat er na 4 s nog")
        eis(not page.locator("#srv-botprofile-save").is_disabled(), "Save werkt weer")
        eis(page.get_by_label("Nickname in this server").input_value() == "Helper", "de invoer is niet weg")
        foto(page, "botprofiel-ratelimit", ".srv-welcome > div > .sec-card:last-child")
        page.close()

        print("\n7. Discord onbereikbaar: geen oude stand")
        page, spoor = open_scherm(browser, stand(), get_status=502)
        eis("Could not reach Discord" in page.locator(".sec-card").first.inner_text(), "het scherm zegt het")
        eis(page.get_by_label("Nickname in this server").count() == 0, "en toont geen formulier")
        page.close()

        print("\n8. Een bio die hier nooit is gezet heet onbekend, niet leeg")
        page, spoor = open_scherm(browser, stand(bio=None, bio_known=False))
        eis("Nothing has been set here" in page.locator(".srv-field-hint").all_inner_texts().__str__(),
            "de uitleg staat erbij")
        eis(page.locator(".dc-profiel-bio").inner_text() == "The global About me.", "de preview toont de About me")
        page.close()

        print("\n9. Telefoon")
        page, spoor = open_scherm(browser, stand(), breed=390)
        eis(page.evaluate("document.documentElement.scrollWidth") <= 390, "geen horizontale scroll op 390 px")
        eis(not spoor["fouten"], f"geen paginafouten ({spoor['fouten'][:1]})")
        foto(page, "botprofiel-telefoon")
        page.close()

        browser.close()

    print(f"\n{'ALLES GOED' if not FOUTEN else str(len(FOUTEN)) + ' FOUT(EN)'}")
    sys.exit(1 if FOUTEN else 0)


if __name__ == "__main__":
    main()
