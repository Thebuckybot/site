"""Previews van elke stap van de tour, desktop en telefoon, als contactblad.

Speelt de API na (zoals test_tour.py), loopt de echte configuratie van beide
pagina's door met een SOC-server waar de bezoeker mag schrijven, maakt per stap
een schermafbeelding, en zet ze in volgorde op één plaat per apparaat.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/tour_previews.py <uitvoermap>
Schrijft <uitvoermap>/desktop.png, <uitvoermap>/mobile.png en de losse platen in
<uitvoermap>/stappen/.
"""

import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from PIL import Image, ImageDraw, ImageFont            # noqa: E402
from playwright.sync_api import sync_playwright        # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
from test_tour import BASIS, GID, SocStub, stub, wacht_titel  # noqa: E402

UIT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "docs", "tour-previews")
STAPPEN = os.path.join(UIT, "stappen")
os.makedirs(STAPPEN, exist_ok=True)

GUILDS = [{"id": str(10 ** 17 + i), "name": n, "icon": None} for i, n in enumerate(
    ["Bucky HQ", "Night Market", "The Foundry", "Harbor Watch", "Quiet Hours", "Orbit"])]


def veilig(t):
    return "".join(c if c.isalnum() else "_" for c in t)[:28]


def titel(page):
    return page.locator("#bucky-tour-title").text_content()


def wacht_ander(page, was, timeout=12000):
    page.wait_for_function("was => { const t = document.querySelector('#bucky-tour-title'); return t && t.textContent !== was; }",
                           arg=was, timeout=timeout)
    page.wait_for_timeout(700)


def loop_security(ctx, label, platen):
    soc = SocStub()
    page = ctx.new_page()
    stub(page, soc=soc)
    page.goto(f"{BASIS}/security.html?guild_id={GID}#overview", wait_until="domcontentloaded")
    page.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
    page.wait_for_timeout(700)
    n = 0

    def schiet(naam):
        nonlocal n
        n += 1
        pad = os.path.join(STAPPEN, f"{label}_security_{n:02d}_{veilig(naam)}.png")
        page.screenshot(path=pad)
        platen.append((f"Security · {naam}", pad))

    schiet(titel(page))
    # welkom -> secties -> snapshots -> regels -> create
    for _ in range(4):
        was = titel(page)
        page.locator("#bucky-tour .tour-next").click()
        wacht_ander(page, was)
        schiet(titel(page))
    # de bezoeker drukt Create Rule
    was = titel(page)
    page.get_by_role("button", name="Create Rule").click()
    wacht_ander(page, was)
    schiet(titel(page))
    # Delete it -> de verwijderstap
    was = titel(page)
    page.locator("#bucky-tour .tour-btn-choice").nth(1).click()
    wacht_ander(page, was)
    schiet(titel(page))
    # verwijderen: Delete + bevestigen -> boost
    was = titel(page)
    page.locator(".tour-target").first.click()
    page.wait_for_selector('[aria-modal="true"]', timeout=5000)
    page.locator('[aria-modal="true"] button', has_text="Delete").click()
    wacht_ander(page, was)
    schiet(titel(page))
    # slot
    was = titel(page)
    page.locator("#bucky-tour .tour-next").click()
    wacht_ander(page, was)
    schiet(titel(page))
    # en de twee poortstappen, apart: alleen-lezen en limiet vol
    for naam, kw in (("read_only", dict(can_edit=False)), ("limit", dict(soc=SocStub(at_limit=True)))):
        p2 = ctx.new_page()
        stub(p2, **({"soc": SocStub()} | kw))
        p2.goto(f"{BASIS}/security.html?guild_id={GID}#overview", wait_until="domcontentloaded")
        p2.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
        for _ in range(4):
            was = titel(p2)
            p2.locator("#bucky-tour .tour-next").click()
            wacht_ander(p2, was)
        n += 1
        pad = os.path.join(STAPPEN, f"{label}_security_{n:02d}_{naam}.png")
        p2.screenshot(path=pad)
        platen.append((f"Security · {titel(p2)} ({naam})", pad))
        p2.close()
    page.close()


def loop_dashboard(ctx, label, platen):
    page = ctx.new_page()
    stub(page)
    page.route("**/api/me*", lambda r: r.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({"logged_in": True, "user": {"id": "1", "username": "tester", "avatar": None}, "guilds": GUILDS})))
    page.goto(f"{BASIS}/dashboard.html", wait_until="domcontentloaded")
    page.wait_for_selector("#bucky-tour.tour-in", timeout=15000)
    page.wait_for_timeout(700)
    n = 0
    while True:
        n += 1
        naam = titel(page)
        pad = os.path.join(STAPPEN, f"{label}_dashboard_{n:02d}_{veilig(naam)}.png")
        page.screenshot(path=pad)
        platen.append((f"Dashboard · {naam}", pad))
        knop = page.locator("#bucky-tour .tour-next")
        if knop.text_content() == "Finish" or n > 8:
            break
        knop.click()
        wacht_ander(page, naam)
    page.close()


def contactblad(platen, pad, kolommen, breedte):
    if not platen:
        return
    beelden = [Image.open(p).convert("RGB") for _, p in platen]
    schaal = breedte / beelden[0].width
    thumbs = [b.resize((int(b.width * schaal), int(b.height * schaal)), Image.LANCZOS) for b in beelden]
    th, tw = thumbs[0].height, thumbs[0].width
    kop = 26
    rijen = (len(thumbs) + kolommen - 1) // kolommen
    blad = Image.new("RGB", (kolommen * (tw + 16) + 16, rijen * (th + kop + 16) + 16), (11, 15, 22))
    teken = ImageDraw.Draw(blad)
    try:
        font = ImageFont.truetype("segoeui.ttf", 15)
    except OSError:
        font = ImageFont.load_default()
    for i, ((naam, _), t) in enumerate(zip(platen, thumbs)):
        x = 16 + (i % kolommen) * (tw + 16)
        y = 16 + (i // kolommen) * (th + kop + 16)
        teken.text((x, y), f"{i + 1}. {naam}", fill=(238, 241, 246), font=font)
        blad.paste(t, (x, y + kop))
        teken.rectangle([x - 1, y + kop - 1, x + tw, y + kop + th], outline=(38, 50, 74))
    blad.save(pad, optimize=True)
    print("contactblad:", pad, blad.size, len(platen), "platen")


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        desktop = []
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        loop_dashboard(ctx, "desktop", desktop)
        loop_security(ctx, "desktop", desktop)
        mobiel = []
        ctx2 = browser.new_context(viewport={"width": 375, "height": 667}, is_mobile=True, has_touch=True)
        loop_dashboard(ctx2, "mobile", mobiel)
        loop_security(ctx2, "mobile", mobiel)
        browser.close()
    contactblad(desktop, os.path.join(UIT, "desktop.png"), kolommen=3, breedte=560)
    contactblad(mobiel, os.path.join(UIT, "mobile.png"), kolommen=6, breedte=260)


if __name__ == "__main__":
    main()
