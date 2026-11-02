"""De schermdelen van de serverhulpmiddelen, fase 1 (2-11-2026), in een echte browser.

WAT HIER WORDT VASTGEHOUDEN
1. DM-TAB: met `dm: true` van de backend staat er een derde tab "Direct
   message" zonder kanaalkeuze; zonder `dm` is er geen derde tab.
2. DISABLE ALL: met `bulk: true` staan de knoppen er, een klik vraagt eerst
   bevestiging en stuurt dan `{action, channel_id}` naar /commands/bulk.
   Zonder `bulk` zijn ze er niet.
3. WELKOMSTTEKST PER TICKETTYPE: met `v2: true` is er een kaart met een
   keuzelijst en een tekstvak, en Opslaan stuurt PATCH /tickets/types/welcome.
En nergens een paginafout.

DRAAIEN (een script, geen pytest-bestand; zie welcome_previews.py voor waarom):
    cd site && python -m http.server 8899
    python tests/test_server_tools_fase1.py
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


def eis(voorwaarde, melding):
    print(("  ok   " if voorwaarde else "  FOUT ") + melding)
    if not voorwaarde:
        FOUTEN.append(melding)


def pagina(browser, extra_routes):
    page = browser.new_page(viewport={"width": 1400, "height": 1100})
    page.add_init_script("localStorage.setItem('bucky_active_guild', JSON.stringify("
                         "{id: '%s', name: 'Bucky HQ', icon: null}));" % GID)
    fouten = []
    page.on("pageerror", lambda e: fouten.append(str(e)))
    welkom = wp.welcome_antwoord("welcome", {"v": 1, "accent": 0x5865F2, "blocks": []})
    wp.stub(page, welkom)
    for patroon, handler in extra_routes:
        page.route(patroon, handler)
    return page, fouten


def dm_tab(browser, aan):
    welkom = wp.welcome_antwoord("welcome", {"v": 1, "accent": 0x5865F2, "blocks": []})
    if aan:
        welkom["dm"] = True
        welkom["messages"].append({"kind": "dm", "enabled": False, "channel_id": None,
                                   "layout": {"v": 1, "accent": 0x5865F2, "blocks": []},
                                   "updated_at": None, "missing_channels": []})
    page, fouten = pagina(browser, [(f"**/api/server/{GID}/welcome",
                                     lambda r: wp.antwoord(r, welkom))])
    page.goto(f"{BASIS}/server.html?guild_id={GID}#welcome", wait_until="networkidle")
    page.wait_for_selector(".srv-welcome", timeout=15000)
    tabs = page.get_by_role("tab").all_inner_texts()
    if aan:
        eis(any("Direct message" in t for t in tabs), f"DM-tab staat er met de vlag ({tabs})")
        page.get_by_role("tab", name="Direct message").click()
        page.wait_for_timeout(250)
        eis(page.locator("select.sec-select", has_text="Pick a channel").count() == 0,
            "de DM-tab heeft geen kanaalkeuze")
        eis(page.get_by_text("Sent privately to somebody who joins").count() > 0,
            "de DM-tab legt uit wat hij doet")
    else:
        eis(len(tabs) == 2, f"zonder vlag twee tabs ({tabs})")
    eis(not fouten, f"geen paginafouten ({fouten})")
    page.close()


def commands_bulk(browser, aan):
    data = {"cogs": [{"name": "Currency", "cogs": [{"name": "currency", "disabled": False, "channels": []}],
                      "disabled": False, "channels": [],
                      "commands": [{"name": "daily", "disabled": False, "channels": [], "protected": False}]}],
            "channels": [{"id": "111111111111111111", "name": "general", "type": 0}]}
    if aan:
        data["bulk"] = True
    verzonden = []

    def bulk(route):
        verzonden.append(json.loads(route.request.post_data or "{}"))
        wp.antwoord(route, {"action": "disable_all", "changed": 1, "channel_id": None})

    page, fouten = pagina(browser, [
        (f"**/api/server/{GID}/commands", lambda r: wp.antwoord(r, data)),
        (f"**/api/server/{GID}/commands/bulk", bulk),
    ])
    page.goto(f"{BASIS}/server.html?guild_id={GID}#commands", wait_until="networkidle")
    page.wait_for_selector(".srv-row", state="attached", timeout=15000)
    knop = page.get_by_role("button", name="Disable all")
    if aan:
        eis(knop.count() == 1, "Disable all staat er met de vlag")
        knop.click()
        page.wait_for_selector(".sec-modal", timeout=5000)
        eis(not verzonden, "er gaat niets uit voor de bevestiging")
        page.locator(".sec-modal").get_by_role("button", name="Disable all").click()
        page.wait_for_timeout(500)
        eis(verzonden == [{"action": "disable_all", "channel_id": None}],
            f"na bevestigen gaat de juiste actie uit ({verzonden})")
    else:
        eis(knop.count() == 0, "zonder vlag geen Disable all")
    eis(not fouten, f"geen paginafouten ({fouten})")
    page.close()


def ticket_welkomst(browser):
    types = [{"key": k, "label": l, "default_label": l, "description": "d", "prefix": k,
              "enabled": True, "position": i, "welcome_text": "Hoi {user}" if k == "bug" else ""}
             for i, (k, l) in enumerate([("support", "Support"), ("bug", "Bug Report")])]
    data = {"settings": {"enabled": True, "category_id": None, "support_role_id": None,
                         "log_channel_id": None, "transcript_channel_id": None,
                         "panel_channel_id": None, "panel_message_id": None,
                         "max_open_tickets": 3, "close_delay": 10},
            "types": types, "channels": [], "roles": [], "open": [],
            "v2": True, "welcome_placeholders": ["user", "server", "type"], "max_welcome_text": 1000}
    verzonden = []

    def opslaan(route):
        body = json.loads(route.request.post_data or "{}")
        verzonden.append(body)
        wp.antwoord(route, {"key": body["key"], "welcome_text": body["welcome_text"]})

    page, fouten = pagina(browser, [
        (f"**/api/server/{GID}/tickets", lambda r: wp.antwoord(r, data)),
        (f"**/api/server/{GID}/tickets/types/welcome", opslaan),
    ])
    page.goto(f"{BASIS}/server.html?guild_id={GID}#tickets", wait_until="networkidle")
    page.wait_for_selector("text=Welcome text per type", timeout=15000)
    vak = page.get_by_label("Welcome text for this ticket type")
    page.get_by_label("Ticket type", exact=True).select_option("bug")
    eis(vak.input_value() == "Hoi {user}", "het tekstvak volgt het gekozen type")
    vak.fill("Thanks {user}, add a screenshot.")
    page.get_by_role("button", name="Save welcome text").click()
    page.wait_for_timeout(400)
    eis(verzonden == [{"key": "bug", "welcome_text": "Thanks {user}, add a screenshot."}],
        f"opslaan stuurt type en tekst ({verzonden})")
    breedte = vak.bounding_box()["width"]
    eis(breedte > 400, f"het tekstvak is breed genoeg ({breedte:.0f}px)")
    eis(not fouten, f"geen paginafouten ({fouten})")
    page.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        print("DM-tab met vlag");         dm_tab(browser, True)
        print("DM-tab zonder vlag");      dm_tab(browser, False)
        print("Disable all met vlag");    commands_bulk(browser, True)
        print("Disable all zonder vlag"); commands_bulk(browser, False)
        print("Welkomsttekst per type");  ticket_welkomst(browser)
        browser.close()
    if FOUTEN:
        print(f"\n{len(FOUTEN)} FOUT(EN)")
        sys.exit(1)
    print("\nalles ok")


if __name__ == "__main__":
    main()
