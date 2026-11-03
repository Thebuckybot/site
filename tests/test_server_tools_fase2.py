"""De schermen van de serverhulpmiddelen, fase 2 (2-11-2026), in een echte browser.

WAT HIER WORDT VASTGEHOUDEN
1. ZIJBALK: Autorole en Verify staan er alleen met de vlag aan EN Server beheren.
2. AUTOROLE: een rol die de bot niet mag geven staat uitgeschakeld met de reden
   erbij; Opslaan stuurt alleen gekozen ids.
3. VERIFY: een paneel opslaan stuurt alle velden; kanalen zijn niet te kiezen
   zonder Kanalen beheren; "Import from link" gaat naar /images/import.
4. TICKETTYPES: per type Edit; het venster heeft standaard geen formulier, "Add form"
   maakt er een, hoogstens vijf vragen, volgorde, en opslaan stuurt PUT.
6. DE KIEZER: alleen wat de bot kan geven, de rest ingeklapt; chips; zoeken;
   vaste hoogte bij honderden rollen.
5. Een rolnaam met markup wordt tekst, geen HTML.
En nergens een paginafout.

DRAAIEN (een script):
    cd site && python -m http.server 8899
    python tests/test_server_tools_fase2.py
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

ROLLEN = [
    {"id": "111111111111111111", "name": "Member", "color": 3447003, "position": 2, "allowed": True, "reason": None},
    {"id": "333333333333333333", "name": "<img src=x onerror=alert(1)>", "color": 0, "position": 3,
     "allowed": False, "reason": "has moderator or admin permissions"},
]


def eis(voorwaarde, melding):
    print(("  ok   " if voorwaarde else "  FOUT ") + melding)
    if not voorwaarde:
        FOUTEN.append(melding)


def pagina(browser, tools, beheer, routes):
    page = browser.new_page(viewport={"width": 1400, "height": 1100})
    page.add_init_script("localStorage.setItem('bucky_active_guild', JSON.stringify("
                         "{id: '%s', name: 'Bucky HQ', icon: null}));" % GID)
    fouten, dialogen = [], []
    page.on("pageerror", lambda e: fouten.append(str(e)))
    page.on("dialog", lambda d: (dialogen.append(d.message), d.dismiss()))
    wp.stub(page, wp.welcome_antwoord("welcome", {"v": 1, "accent": 0, "blocks": []}))
    page.route(f"**/api/server/{GID}/me", lambda r: wp.antwoord(r, {
        "can_view": True, "can_edit": True, "is_owner": False, "mode": "administrator",
        "user_id": "1", "tools": tools, "can_manage_server": beheer}))
    for patroon, handler in routes:
        page.route(patroon, handler)
    return page, fouten, dialogen


def zijbalk(browser):
    for tools, beheer, verwacht in (
            ({"autorole": True, "verify": True}, True, True),
            ({"autorole": True, "verify": True}, False, False),
            ({"autorole": False, "verify": False}, True, False)):
        page, fouten, _ = pagina(browser, tools, beheer, [])
        page.goto(f"{BASIS}/server.html?guild_id={GID}#overview", wait_until="networkidle")
        page.wait_for_timeout(400)
        namen = page.locator(".sec-nav-item").all_inner_texts()
        eis(("Verify" in namen and "Autorole" in namen) == verwacht,
            f"zijbalk met tools={tools} beheer={beheer}: {'wel' if verwacht else 'geen'} Autorole/Verify")
        eis(not fouten, f"geen paginafouten ({fouten})")
        page.close()


def autorole(browser):
    data = {"enabled": False, "role_ids": [], "include_bots": False, "roles": ROLLEN,
            "bot_can_manage_roles": True, "can_manage_roles": True, "limits": {"max_roles": 5}}
    verzonden = []

    def handler(route):
        if route.request.method == "PATCH":
            body = json.loads(route.request.post_data or "{}")
            verzonden.append(body)
            wp.antwoord(route, {**data, **body})
        else:
            wp.antwoord(route, data)

    page, fouten, dialogen = pagina(browser, {"autorole": True}, True,
                                    [(f"**/api/server/{GID}/autorole", handler)])
    page.goto(f"{BASIS}/server.html?guild_id={GID}#autorole", wait_until="networkidle")
    page.wait_for_selector(".srv-picker", timeout=15000)
    geblokt = page.locator(".srv-role.is-blocked input")
    eis(geblokt.is_disabled(), "een onveilige rol is niet aan te vinken")
    eis(page.get_by_text("has moderator or admin permissions").count() == 1, "de reden staat erbij")
    eis(page.locator(".srv-picker-blocked").get_attribute("open") is None
        and page.get_by_text("Not available (1)").count() == 1,
        "de rol die niet kan staat in een ingeklapte groep 'Not available'")
    eis(page.locator(".srv-picker-list:not(.srv-picker-blocked-list) .srv-role").count() == 1,
        "de gewone lijst toont alleen wat de bot kan geven")
    eis(page.get_by_text("<img src=x onerror=alert(1)>", exact=False).count() == 1,
        "een rolnaam met markup staat er als tekst")
    page.locator(".srv-role:not(.is-blocked) input").check()
    eis(page.locator(".srv-chip").count() == 1 and "@Member" in page.locator(".srv-chip").first.inner_text(),
        "de gekozen rol staat als chip bovenaan")
    page.get_by_role("button", name="Save roles").click()
    page.wait_for_timeout(400)
    eis(verzonden == [{"role_ids": ["111111111111111111"]}], f"opslaan stuurt alleen de gekozen rol ({verzonden})")
    eis(not dialogen and not fouten, f"geen alert en geen paginafouten ({dialogen} {fouten})")
    page.close()


def autorole_zonder_rollenrecht(browser):
    data = {"enabled": False, "role_ids": [], "include_bots": False, "roles": ROLLEN,
            "bot_can_manage_roles": True, "can_manage_roles": False, "limits": {"max_roles": 5}}
    page, fouten, _ = pagina(browser, {"autorole": True}, True,
                             [(f"**/api/server/{GID}/autorole", lambda r: wp.antwoord(r, data))])
    page.goto(f"{BASIS}/server.html?guild_id={GID}#autorole", wait_until="networkidle")
    page.wait_for_selector(".srv-picker", timeout=15000)
    eis(page.locator(".srv-rolelist input:not([disabled])").count() == 0,
        "zonder Rollen beheren is geen enkele rol te kiezen")
    eis(page.get_by_text("You need the Manage Roles permission").count() == 1, "en dat staat er")
    eis(not fouten, f"geen paginafouten ({fouten})")
    page.close()


def verify(browser, kanalen_recht):
    paneel = {"id": 4, "name": "Entry", "enabled": True, "channel_id": None, "message_id": None,
              "use_v2": True, "title": "", "body": "", "button_label": "Verify now", "button_emoji": "",
              "button_style": "success", "accent": 5793266, "add_role_ids": [], "remove_role_ids": [],
              "channel_ids": [], "image_url": ""}
    data = {"panels": [paneel], "roles": ROLLEN,
            "panel_channels": [{"id": "900000000000000001", "name": "verify", "type": 0}],
            "access_channels": [{"id": "900000000000000001", "name": "verify", "type": 0},
                                {"id": "900000000000000002", "name": "general", "type": 0}],
            "bot_can_manage_roles": True, "can_manage_channels": kanalen_recht, "can_manage_roles": True,
            "image_hosts": ["api.buckybot.app"],
            "limits": {"max_panels": 5, "max_add": 5, "max_remove": 5, "max_channels": 10,
                       "max_title": 100, "max_body": 1000, "max_button_label": 80}}
    patches, imports = [], []

    def lijst(route):
        wp.antwoord(route, data)

    def een(route):
        body = json.loads(route.request.post_data or "{}")
        patches.append(body)
        wp.antwoord(route, {**paneel, **body})

    def imp(route):
        imports.append(json.loads(route.request.post_data or "{}"))
        wp.antwoord(route, {"url": "https://api.buckybot.app/i/w/" + "a" * 32 + ".gif"})

    page, fouten, _ = pagina(browser, {"verify": True}, True, [
        (f"**/api/server/{GID}/verify", lijst),
        (f"**/api/server/{GID}/verify/4", een),
        (f"**/api/server/{GID}/images/import", imp),
    ])
    page.goto(f"{BASIS}/server.html?guild_id={GID}#verify", wait_until="networkidle")
    page.wait_for_selector("text=Roles to give", timeout=15000)
    kanaalvakjes = page.get_by_role("group", name="Channels this panel opens", exact=True).locator("input")
    eis(kanaalvakjes.first.is_disabled() != kanalen_recht,
        f"kanalen {'wel' if kanalen_recht else 'niet'} te kiezen met Kanalen beheren={kanalen_recht}")
    page.get_by_role("group", name="Channel for the panel", exact=True).locator("input").first.check()
    page.get_by_role("group", name="Roles to give", exact=True).locator(".srv-role:not(.is-blocked) input").check()
    page.get_by_label("Image address").fill("https://example.com/cat.gif")
    hoogte = page.evaluate("document.querySelector('.srv-verify-preview').getBoundingClientRect().height")
    page.get_by_role("button", name="Import from link").click()
    page.wait_for_timeout(500)
    eis(page.evaluate("document.querySelector('.srv-verify-preview').getAttribute('src')") != "https://example.com/cat.gif",
        "een getypte vreemde URL wordt niet als voorvertoning geladen")
    eis(abs(page.evaluate("document.querySelector('.srv-verify-preview').getBoundingClientRect().height") - hoogte) < 2,
        "de voorvertoning verandert niet van hoogte")
    eis(imports == [{"url": "https://example.com/cat.gif"}], f"import stuurt de link ({imports})")
    eis(page.get_by_label("Image address").input_value().startswith("https://api.buckybot.app/"),
        "na de import staat Bucky's eigen kopie in het veld")
    page.get_by_role("button", name="Save", exact=True).click()
    page.wait_for_timeout(400)
    eis(len(patches) == 1 and patches[0]["add_role_ids"] == ["111111111111111111"]
        and patches[0]["channel_id"] == "900000000000000001"
        and patches[0]["image_url"].startswith("https://api.buckybot.app/"),
        f"opslaan stuurt kanaal, rol en afbeelding ({patches})")
    eis(not fouten, f"geen paginafouten ({fouten})")
    page.close()


def tickettype_venster(browser):
    """Per type een Edit-knop; het venster heeft standaard geen formulier, met
    "Add form" een, hoogstens vijf vragen, volgorde, en opslaan stuurt PUT."""
    types = [{"key": "bug", "label": "Bug Report", "default_label": "Bug Report", "description": "Report a bug",
              "prefix": "bug", "enabled": True, "position": 0},
             {"key": "support", "label": "Support", "default_label": "Support", "description": "Help",
              "prefix": "support", "enabled": True, "position": 1}]
    data = {"settings": {"enabled": True, "max_open_tickets": 3, "close_delay": 10},
            "types": types, "channels": [], "roles": [], "open": [], "v2": False, "forms": True}
    gezet, patches = [], []

    def put(route):
        body = json.loads(route.request.post_data or "{}")
        gezet.append((route.request.method, body))
        wp.antwoord(route, {"type": "bug", "questions": body["questions"]})

    def patch(route):
        body = json.loads(route.request.post_data or "{}")
        patches.append(body)
        wp.antwoord(route, {"key": body["key"], "label": body["label"], "enabled": body["enabled"], "position": 0})

    page, fouten, _ = pagina(browser, {"ticket_forms": True}, True, [
        (f"**/api/server/{GID}/tickets", lambda r: wp.antwoord(r, data)),
        (f"**/api/server/{GID}/tickets/types", patch),
        (f"**/api/server/{GID}/tickets/questions", lambda r: wp.antwoord(r, {
            "questions": {"support": [{"label": "Topic", "placeholder": "", "style": "short",
                                       "required": True, "max_length": 300}]},
            "limits": {"max_questions": 5, "max_label": 45, "max_placeholder": 100, "max_answer": 1000}})),
        (f"**/api/server/{GID}/tickets/questions/bug", put),
    ])
    page.goto(f"{BASIS}/server.html?guild_id={GID}#tickets", wait_until="networkidle")
    page.wait_for_selector("text=Ticket types", timeout=15000)
    eis(page.get_by_text("Form: 1 question", exact=True).count() == 1 and page.get_by_text("No form", exact=True).count() == 1,
        "elke rij zegt of het type een formulier heeft")
    eis(page.get_by_text("Questions per type").count() == 0, "de losse vragenkaart is weg")
    page.get_by_role("button", name="Edit Bug Report").click()
    venster = page.get_by_role("dialog", name="Edit Bug Report")
    eis(venster.is_visible(), "Edit opent het venster van dat type")
    eis(venster.get_by_text("Without a form, the ticket opens straight away").count() == 1,
        "standaard geen formulier, met de uitleg")
    venster.get_by_role("button", name="Add form").click()
    venster.get_by_label("Question 1", exact=True).fill("What happened?")
    for _ in range(4):
        venster.get_by_role("button", name="Add question").click()
    eis(venster.get_by_role("button", name="Add question").is_disabled(), "bij vijf vragen kan er geen bij")
    eis(venster.get_by_text("Discord allows no more in one form").count() == 1, "en dat staat er")
    for i in range(2, 6):
        venster.get_by_label(f"Question {i}", exact=True).fill(f"V{i}")
    venster.get_by_role("button", name="Remove question 5").click()
    venster.get_by_role("button", name="Remove question 4").click()
    venster.get_by_role("button", name="Remove question 3").click()
    venster.get_by_label("Answer type for question 2").select_option("paragraph")
    venster.get_by_role("button", name="Move question 2 up").click()
    labels = [t.upper().replace("\n", "") for t in venster.locator(".srv-form-preview-label").all_inner_texts()]
    eis(labels == ["V2*", "WHAT HAPPENED?*"], f"de voorvertoning volgt de volgorde ({labels})")
    eis(venster.locator(".srv-form-preview-box.is-long").count() == 1, "een lang antwoord is een hoog vak")
    venster.get_by_label("Name", exact=True).fill("Bugs")
    venster.get_by_role("button", name="Save", exact=True).click()
    page.wait_for_timeout(500)
    eis(gezet and gezet[0][0] == "PUT" and [v["label"] for v in gezet[0][1]["questions"]] == ["V2", "What happened?"]
        and gezet[0][1]["questions"][0]["style"] == "paragraph",
        f"opslaan stuurt PUT met de vragen in volgorde ({gezet})")
    eis(patches and patches[0]["label"] == "Bugs", f"en de nieuwe naam ({patches})")
    eis(page.locator("#sec-modal-host.open").count() == 0, "het venster sluit")
    eis(page.get_by_text("Form: 2 questions", exact=True).count() == 1, "de rij telt nu twee vragen")
    eis(not fouten, f"geen paginafouten ({fouten})")
    page.close()


def veel_rollen(browser):
    """Honderden rollen: vaste hoogte, zoeken, chips, de rest ingeklapt."""
    rollen = [{"id": str(100000000000000000 + i), "name": f"role-{i}", "color": 0, "position": i,
               "allowed": i % 7 != 0, "reason": None if i % 7 else "is at or above Bucky's highest role",
               "reason_code": None if i % 7 else "too_high"} for i in range(1, 351)]
    data = {"enabled": False, "role_ids": [rollen[1]["id"]], "include_bots": False, "roles": rollen,
            "bot_can_manage_roles": True, "can_manage_roles": True, "limits": {"max_roles": 5}}
    page, fouten, _ = pagina(browser, {"autorole": True}, True,
                             [(f"**/api/server/{GID}/autorole", lambda r: wp.antwoord(r, data))])
    page.goto(f"{BASIS}/server.html?guild_id={GID}#autorole", wait_until="networkidle")
    page.wait_for_selector(".srv-picker", timeout=15000)
    hoogte = page.evaluate("document.querySelector('.srv-picker-list').getBoundingClientRect().height")
    eis(200 <= hoogte <= 260, f"de lijst heeft een vaste hoogte ({hoogte})")
    eis(page.get_by_text("Not available (50)").count() == 1, "50 rollen ingeklapt onder Not available")
    eis(page.locator(".srv-chip").count() == 1, "de opgeslagen rol staat als chip")
    page.get_by_label("Search roles (Roles to give)").fill("role-34")
    zichtbaar = sorted(t.strip() for t in page.locator(
        ".srv-picker-list:not(.srv-picker-blocked-list) .srv-role:visible").all_inner_texts())
    verwacht = sorted(f"@role-{n}" for n in [34] + list(range(340, 351)) if n % 7)
    eis(zichtbaar == verwacht, f"zoeken filtert ({zichtbaar})")
    page.get_by_label("Search roles (Roles to give)").fill("zzz")
    eis(page.get_by_text("No matches.").is_visible(), "geen treffer staat er")
    eis(not fouten, f"geen paginafouten ({fouten})")
    page.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        print("Zijbalk"); zijbalk(browser)
        print("Autorole"); autorole(browser)
        print("Autorole zonder Rollen beheren"); autorole_zonder_rollenrecht(browser)
        print("Verify met Kanalen beheren"); verify(browser, True)
        print("Verify zonder Kanalen beheren"); verify(browser, False)
        print("Tickettype: het bewerkvenster"); tickettype_venster(browser)
        print("Honderden rollen"); veel_rollen(browser)
        browser.close()
    if FOUTEN:
        print(f"\n{len(FOUTEN)} FOUT(EN)")
        sys.exit(1)
    print("\nalles ok")


if __name__ == "__main__":
    main()
