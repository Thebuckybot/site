"""De pagina's van het licht/donker-thema, gevuld en zonder netwerk (4-11-2026).

Eén opener per pagina, zodat test_thema.py, de contrastmeting en de pixelvergelijking
dezelfde toestand zien. Elke opener zet de keuze van de bezoeker (`bucky_thema`) zoals
js/thema.js hem bewaart, of laat hem leeg ("auto": dan beslist prefers-color-scheme).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

BREEDTES = {"desktop": (1440, 900), "tablet": (820, 1180), "telefoon": (390, 844), "smal": (360, 740)}

GID = "1531768413742039231"
SERVERS = [{"id": GID, "name": "Bucky HQ", "icon": None, "owner": True, "permissions": "8"}] + [
    {"id": str(500000000000000000 + i), "name": f"Server {i}", "icon": None, "owner": False, "permissions": "8"}
    for i in range(5)]


from test_premium_boosts import _tier, BOOSTS, CIPHER  # noqa: E402  dezelfde rijen als de premiumtest

TIERS = [_tier("bucky_plus", 1, "Bucky+", "$4.99 / month"), _tier("pro", 2, "Bucky Pro", "$9.99 / month"),
         _tier("elite", 3, "Elite", "$14.99 / month"), _tier("legend", 4, "Legend", "$24.99 / month")]
TIERS[2]["featured"] = True
for _t, _k in zip(TIERS, ("bucky_plus", "bucky_plusplus", "elite", "overclock")):
    _t["badge_url"] = f"/assets/badges/{_k}.png"
RIJEN = TIERS + BOOSTS + CIPHER

TRANSCRIPT = {"ok": True, "data": {
    "version": 1, "view": "staff", "closed_at": "2026-09-27T10:00:00Z", "expires_at": "2026-09-29T10:00:00Z",
    "ticket": {"id": 41, "type_label": "Support", "guild_name": "Bucky HQ", "channel_name": "ticket-0041",
               "created_at": "2026-09-27T09:00:00Z", "closed_at": "2026-09-27T10:00:00Z",
               "message_count": 3, "reopen_count": 1},
    "owner": {"id": "42", "name": "tommy", "display": "Tommy"},
    "claimer": {"id": "43", "name": "mod", "display": "A moderator"},
    "closer": {"id": "43", "name": "mod", "display": "A moderator"},
    "participants": [{"id": "44", "name": "helper"}],
    "messages": [
        {"author_id": "42", "author_name": "tommy", "display_name": "Tommy", "is_bot": False, "system": False,
         "avatar_url": None, "created_at": "2026-09-27T09:01:00Z",
         "content": "My daily did not pay out. Here is the `+daily` output: ```Offer Changed``` see <@43>",
         "attachments": [{"filename": "screenshot.png", "url": "https://x.test/a.png", "is_image": False}],
         "embeds": [{"title": "Daily", "description": "You chose shards.", "url": None,
                     "fields": [{"name": "Streak", "value": "2"}], "footer": "Bucky"}], "stickers": []},
        {"author_id": "999", "author_name": "Bucky", "display_name": "Bucky", "is_bot": True, "system": False,
         "avatar_url": None, "created_at": "2026-09-27T09:02:00Z",
         "content": "A moderator will be with you shortly.", "attachments": [], "embeds": [], "stickers": []},
        {"author_id": "43", "author_name": "mod", "display_name": "A moderator", "is_bot": False, "system": False,
         "avatar_url": None, "created_at": "2026-09-27T09:20:00Z",
         "content": "Fixed: your daily is reset.", "attachments": [], "embeds": [], "stickers": []}],
    "notes": [{"author_id": "43", "author_name": "mod", "content": "Reset via owner tool.",
               "created_at": "2026-09-27T09:30:00Z"}]}}


def _json(r, data, status=200):
    r.fulfill(status=status, content_type="application/json", body=json.dumps(data))


def nieuw(browser, breed, thema=None, *, opslag=True, kleur=None):
    """Een pagina met de keuze van de bezoeker; opslag=False gooit bij elke toegang."""
    w, h = BREEDTES[breed]
    # Minder beweging: anders staan de secties van v2 op opacity 0 tot je erheen scrolt,
    # en meet en fotografeert een test een lege pagina (smooth scroll speelt ook mee).
    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=kleur or "light",
                              reduced_motion="reduce")
    page = ctx.new_page()
    fouten = []
    page.on("pageerror", lambda e: fouten.append(str(e)))
    page.on("console", lambda m: fouten.append(m.text) if "Content Security Policy" in m.text else None)
    page.add_init_script("try { localStorage.setItem('bucky_tour_seen_dashboard', '1');"
                         " localStorage.setItem('bucky_tour_done', '1'); } catch (e) {}")
    if thema:
        page.add_init_script("try { localStorage.setItem('bucky_thema', '%s'); } catch (e) {}" % thema)
    if not opslag:
        page.add_init_script("""(() => { const weg = { get() { throw new DOMException('denied', 'SecurityError'); } };
          Object.defineProperty(window, 'localStorage', weg); Object.defineProperty(window, 'sessionStorage', weg); })();""")
    # Eerst de vangnetroute, dan de specifieke: Playwright zoekt achterstevoren.
    page.route("**/api/**", lambda r: _json(r, {"ok": True, "data": {}}))
    page.route("**/api/site/features", lambda r: _json(r, {"features": {"premium": True}}))
    return page, fouten


def open_kiezer(browser, breed, thema=None, **kw):
    page, fouten = nieuw(browser, breed, thema, **kw)
    page.route("**/api/me", lambda r: _json(r, {"logged_in": True, "user": {
        "id": "123456789012345678", "username": "tommy", "global_name": "tommy", "avatar": None}, "guilds": SERVERS}))
    page.goto_doel = "dashboard.html"
    return page, fouten


def open_premium(browser, breed, thema=None, **kw):
    page, fouten = nieuw(browser, breed, thema, **kw)
    page.route("**/api/premium/me", lambda r: _json(r, {"signed_in": False}))
    page.route("**/api/premium/tiers", lambda r: _json(r, {"available": True, "tiers": RIJEN}))
    page.goto_doel = "premium.html"
    return page, fouten


def open_transcript(browser, breed, thema=None, **kw):
    page, fouten = nieuw(browser, breed, thema, **kw)
    page.route("https://api.buckybot.app/api/tickets/transcripts/**", lambda r: _json(r, TRANSCRIPT))
    page.route("https://x.test/**", lambda r: r.abort())
    page.goto_doel = "transcript.html?id=41"
    return page, fouten


def ga(page, basis):
    """Naar de pagina, en wachten tot hij gevuld is (niet op een vaste tijd)."""
    page.goto(f"{basis}/{page.goto_doel}", wait_until="networkidle")
    doel = page.goto_doel.split("?")[0]
    wacht = {"dashboard.html": "#guilds-container .server-card:not(.skeleton)",
             "premium.html": "body:not(.pr-laden)",
             "transcript.html": "#tr-main[aria-busy='false']"}.get(doel)
    if wacht:
        try:
            page.wait_for_selector(wacht, timeout=10000)
        except Exception:
            pass
    page.wait_for_timeout(300)


def _v2(naam):
    def open_v2(browser, breed, thema=None, **kw):
        page, fouten = nieuw(browser, breed, thema, **kw)
        page.route("**/api/stats*", lambda r: _json(r, {"servers": 104, "users": 104831, "commands": 212}))
        # ?site=v2: de preview van de versieschakelaar, los van wat live de standaard is.
        page.goto_doel = f"v2/{naam}.html?site=v2"
        return page, fouten
    return open_v2


V2_PAGINAS = ("index", "organisations", "contact", "privacy", "tos", "rules", "cookie")

OPENERS = {"kiezer": open_kiezer, "premium": open_premium, "transcript": open_transcript,
           **{f"v2-{n}": _v2(n) for n in V2_PAGINAS}}
