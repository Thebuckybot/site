"""Previews van het welcome-scherm en van de kaarten die het maakt.

WAT DIT DOET
Speelt `/api/server/<gid>/welcome` na, opent het echte scherm in een echte
browser, en maakt schermafbeeldingen van vier opzetten: kaal, met een
afbeelding, met knoppen en een eigen kleur, en een leave-bericht. Plus een plaat
van het bouwscherm zelf.

WAAROM MET DE ECHTE PAGINA EN NIET MET EEN NAGEBOUWDE HTML
Een preview van een preview bewijst niets. Wat hier wordt gefotografeerd is
`welcome_preview.js` zoals hij straks draait, met de CSS die er straks bij hoort.
Gaat er iets stuk in de bouwer, dan staat dat op de plaat.

DE ROUTES WORDEN IN OMGEKEERDE VOLGORDE GEREGISTREERD. Playwright kiest de
LAATST geregistreerde route die past, dus de vangnet-route gaat eerst en de
specifieke stubs daarna - zie het geheugen `playwright-routes-reverse-order`.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/welcome_previews.py <uitvoermap>
"""

import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright        # noqa: E402

BASIS = "http://127.0.0.1:8899"
GID = "1392872457475592243"

UIT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(__file__), "..", "..", "previews", "welcome-2026-09")
os.makedirs(UIT, exist_ok=True)

# Een echte PNG van 600x200, effen kleur: genoeg om te zien hoe een banner in
# de kaart valt zonder een bestand van buiten nodig te hebben.
import base64                                          # noqa: E402
import struct                                          # noqa: E402
import zlib                                            # noqa: E402


def _png(breedte, hoogte, rgb):
    def chunk(soort, data):
        c = soort + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    rij = b"\x00" + bytes(rgb) * breedte
    ihdr = struct.pack(">IIBBBBB", breedte, hoogte, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(rij * hoogte))
            + chunk(b"IEND", b""))


BANNER = "data:image/png;base64," + base64.b64encode(_png(600, 200, (70, 86, 111))).decode()
AVATAR = "data:image/png;base64," + base64.b64encode(_png(96, 96, (139, 30, 63))).decode()

KANALEN = [
    {"id": "111111111111111111", "name": "welcome", "type": 0},
    {"id": "222222222222222222", "name": "general", "type": 0},
    {"id": "333333333333333333", "name": "goodbyes", "type": 0},
]

PLACEHOLDERS = {
    "user": "Mentions the member, so they get a ping.",
    "username": "Their username, without the ping.",
    "displayname": "Their nickname on this server, or their username.",
    "userid": "Their numeric Discord ID.",
    "server": "The name of this server.",
    "membercount": "How many members the server has now.",
    "memberordinal": "Their place as a word: 1st, 2nd, 142nd.",
    "joindate": "Today's date, like 26 September 2026.",
    "accountage": "How old their Discord account is, in days.",
}

LIMITS = {
    "max_blocks": 20, "max_weight": 38, "max_text_total": 3400,
    "max_text_block": 2000, "max_buttons": 5, "max_button_label": 80,
    "max_images": 4, "max_upload_bytes": 2097152, "max_uploads": 10,
    "image_hosts": ["api.buckybot.app", "buckybot.app", "cdn.discordapp.com",
                    "media.discordapp.net", "www.buckybot.app"],
}

# --- de vier opzetten -------------------------------------------------------
EENVOUDIG = {
    "v": 1, "accent": 0x5865F2,
    "blocks": [
        {"type": "text", "content": "## nope\nWelcome {user}!"},
        {"type": "text",
         "content": "Glad you found us. Have a look around, and say hello in "
                    "**#general** when you are ready."},
    ],
}
# Let op het eerste blok: `## nope` staat er om te laten zien dat leidende
# blokopmaak eraf gaat. In de preview hoort daar gewoon "nope" te staan en geen
# kop - dat is wat de server ervan maakt bij het opslaan.

MET_AFBEELDING = {
    "v": 1, "accent": 0x1ABC9C,
    "blocks": [
        {"type": "image", "url": BANNER},
        {"type": "text", "content": "# Welcome to **{server}**, {user}"},
        {"type": "separator", "divider": True, "spacing": "small"},
        {"type": "section",
         "content": "You are our **{memberordinal}** member.\n"
                    "Your account is {accountage} old.",
         "accessory": {"kind": "thumbnail", "url": AVATAR}},
    ],
}

MET_KNOPPEN = {
    "v": 1, "accent": 0xEB459E,
    "blocks": [
        {"type": "text", "content": "Hey {user}, welcome to **{server}**!"},
        {"type": "separator", "divider": True, "spacing": "large"},
        {"type": "section",
         "content": "Member **{membercount}** and counting. Grab a role, read "
                    "the rules, and you are good to go.",
         "accessory": {"kind": "thumbnail", "url": AVATAR}},
        {"type": "separator", "divider": False, "spacing": "small"},
        {"type": "text",
         "content": "-# not a footnote\nUse `+help` if you get stuck."},
        {"type": "buttons", "items": [
            {"label": "Read the rules", "url": "https://buckybot.app/", "style": "link"},
            {"label": "Pick your roles", "url": "https://buckybot.app/", "style": "link"},
            {"label": "Support", "url": "https://buckybot.app/", "style": "link"},
        ]},
    ],
}

AFSCHEID = {
    "v": 1, "accent": 0x95A5A6,
    "blocks": [
        {"type": "text", "content": "**{displayname}** just left {server}."},
        {"type": "separator", "divider": True, "spacing": "small"},
        {"type": "text", "content": "-# We are down to {membercount} members."},
    ],
}

OPZETTEN = [
    ("01-eenvoudig", "welcome", EENVOUDIG, "Simple: two text blocks"),
    ("02-afbeelding", "welcome", MET_AFBEELDING, "With a banner and a thumbnail"),
    ("03-knoppen", "welcome", MET_KNOPPEN, "Buttons and a colour of its own"),
    ("04-afscheid", "leave", AFSCHEID, "A goodbye message"),
]


def antwoord(route, data):
    route.fulfill(status=200, content_type="application/json",
                  body=json.dumps({"ok": True, "data": data}))


def stub(page, welcome_data):
    # OMGEKEERDE VOLGORDE: het vangnet eerst, de specifieke routes daarna.
    page.route("**/api/**", lambda r: antwoord(r, {}))
    page.route("**/api/site/features",
               lambda r: r.fulfill(status=200, content_type="application/json",
                                   body=json.dumps({"features": {
                                       "server_center": {"enabled": True},
                                       "dashboard": {"enabled": True}}})))
    page.route(f"**/api/server/{GID}/me",
               lambda r: antwoord(r, {"can_view": True, "can_edit": True,
                                      "is_owner": True, "mode": "administrator",
                                      "user_id": "1"}))
    page.route(f"**/api/server/{GID}/welcome", lambda r: antwoord(r, welcome_data))


def welcome_antwoord(kind, doc):
    berichten = []
    for k in ("welcome", "leave"):
        berichten.append({
            "kind": k,
            "enabled": k == kind,
            "channel_id": "111111111111111111" if k == "welcome" else "333333333333333333",
            "layout": doc if k == kind else {"v": 1, "accent": 0x5865F2, "blocks": []},
            "updated_at": None,
        })
    return {"messages": berichten, "channels": KANALEN, "images": [],
            "placeholders": PLACEHOLDERS, "limits": LIMITS}


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        gemaakt = []

        for naam, kind, doc, omschrijving in OPZETTEN:
            page = browser.new_page(viewport={"width": 1500, "height": 1000},
                                    device_scale_factor=2)
            page.add_init_script(
                "localStorage.setItem('bucky_active_guild', JSON.stringify("
                "{id: '%s', name: 'Bucky HQ', icon: null}));" % GID)
            stub(page, welcome_antwoord(kind, doc))
            page.goto(f"{BASIS}/server.html?guild_id={GID}#welcome",
                      wait_until="networkidle")
            page.wait_for_selector(".srv-welcome", timeout=15000)
            if kind == "leave":
                page.get_by_role("tab", name="Goodbye").click()
                page.wait_for_timeout(250)
            page.wait_for_timeout(600)      # de afbeeldingen

            # Alleen de kaart, zoals hij in Discord staat.
            kaart = page.locator(".dc-surface")
            pad = os.path.join(UIT, f"{naam}-kaart.png")
            kaart.screenshot(path=pad)
            gemaakt.append(pad)
            print(f"  {omschrijving:<40} -> {os.path.basename(pad)}")

            page.close()

        # Het bouwscherm zelf, met een gevulde opzet.
        page = browser.new_page(viewport={"width": 1600, "height": 1200},
                                device_scale_factor=2)
        page.add_init_script(
            "localStorage.setItem('bucky_active_guild', JSON.stringify("
            "{id: '%s', name: 'Bucky HQ', icon: null}));" % GID)
        stub(page, welcome_antwoord("welcome", MET_KNOPPEN))
        page.goto(f"{BASIS}/server.html?guild_id={GID}#welcome", wait_until="networkidle")
        page.wait_for_selector(".srv-welcome", timeout=15000)
        page.wait_for_timeout(700)
        pad = os.path.join(UIT, "05-bouwscherm.png")
        page.screenshot(path=pad, full_page=True)
        gemaakt.append(pad)
        print(f"  {'Het bouwscherm':<40} -> {os.path.basename(pad)}")

        # En op een telefoon, want de bouwer moet daar ook werken.
        page.set_viewport_size({"width": 390, "height": 1400})
        page.wait_for_timeout(400)
        pad = os.path.join(UIT, "06-telefoon.png")
        page.screenshot(path=pad, full_page=True)
        gemaakt.append(pad)
        print(f"  {'Het bouwscherm op een telefoon':<40} -> {os.path.basename(pad)}")

        # Consolefouten zijn een reden om NIET tevreden te zijn met een mooie
        # plaat: een preview die er goed uitziet terwijl de console rood staat
        # is precies de val waar `webapp-testing` voor bestaat.
        page.close()
        browser.close()

        print(f"\n{len(gemaakt)} platen in {os.path.abspath(UIT)}")


if __name__ == "__main__":
    main()
