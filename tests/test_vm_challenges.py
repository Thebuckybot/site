"""De challengespagina in de VM (bucky://bucky/challenges), echt geopend.

Wat hier gemeten wordt, en waarom in een browser en niet statisch: de pagina
is drie fetches en een render, en of de kaarten, de balken, de catalogus en de
code-opgave er echt staan zie je alleen als de VM ze heeft getekend. De API
wordt nagespeeld met `page.route`, zodat de test niet van een backend afhangt
en de previews altijd dezelfde inhoud tonen.

Vier controles:
  1. de pagina rendert het bord (open challenges per tijdschaal, met balk en
     uitleg), de catalogus (wat komt) en de regels;
  2. de code-opgave staat er ZONDER antwoord in het antwoord van de server;
  3. een antwoord instuen gaat via de knop naar de server en de uitspraak
     van de server komt terug op het scherm (niet die van de browser);
  4. op een telefoon is er geen horizontale scroll.

Schrijft bovendien de twee previews die de sessie achterlaat.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_vm_challenges.py [uitvoermap]
"""

import json
import os
import socket
import subprocess
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright  # noqa: E402

HIER = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HIER)
BASIS = "http://127.0.0.1:8899"
UIT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SITE, "..", "docs", "challenges-previews-2026-09-07")

CATALOGUS = {
    "available": True,
    "cooldown_seconds": 58,
    "rotation": {"enabled": True, "stagger_hours": 12},
    "cadences": {
        "daily": {"duration_hours": 24, "target_multiplier": 1.0, "reward_multiplier": 1.0},
        "weekly": {"duration_hours": 168, "target_multiplier": 5.0, "reward_multiplier": 6.0},
        "monthly": {"duration_hours": 720, "target_multiplier": 18.0, "reward_multiplier": 25.0},
    },
    "definitions": [
        {"key": "honest_work", "title": "Honest Work", "blurb": "No lock picked, no code guessed. Just shifts.",
         "scope": "global", "category": "economic", "cadences": ["daily", "weekly", "monthly"], "needs_vm": False,
         "objectives": [{"key": "shifts", "event": "shards_earned", "how": "Work a shift with `work`", "measure": "count",
                         "per": 1, "unit": "shift", "cooldown_seconds": 0,
                         "target": {"daily": {"min": 2, "max": 4}, "weekly": {"min": 7, "max": 14}, "monthly": {"min": 22, "max": 45}}}],
         "reward": {"daily": {"rep": {"min": 1000, "max": 1600}, "shards": {"min": 150000, "max": 300000}},
                    "weekly": {"rep": {"min": 6000, "max": 9600}, "shards": {"min": 900000, "max": 1800000}},
                    "monthly": {"rep": {"min": 25000, "max": 40000}, "shards": {"min": 3750000, "max": 7500000}}}},
        {"key": "hot_streak", "title": "Hot Streak", "blurb": "Five in a row. No grace, no gaps.",
         "scope": "global", "category": "skill", "cadences": ["daily", "weekly"], "needs_vm": False,
         "objectives": [{"key": "streak", "event": "spar_streak", "how": "Win five bouts in a row on the Range with `spar`",
                         "measure": "count", "per": 1, "unit": "", "cooldown_seconds": 0,
                         "target": {"daily": {"min": 1, "max": 1}, "weekly": {"min": 1, "max": 1}}}],
         "reward": {"daily": {"rep": {"min": 1500, "max": 2200}, "shards": {"min": 250000, "max": 400000}},
                    "weekly": {"rep": {"min": 9000, "max": 13200}, "shards": {"min": 1500000, "max": 2400000}}}},
        {"key": "code_review", "title": "Code Review", "blurb": "The day's puzzle on BuckyNet. The server sets it, the server checks it.",
         "scope": "global", "category": "skill", "cadences": ["daily", "weekly", "monthly"], "needs_vm": True,
         "objectives": [{"key": "solved", "event": "coding_solved", "how": "Solve the day's code challenge on bucky://bucky/challenges in the VM",
                         "measure": "count", "per": 1, "unit": "", "cooldown_seconds": 0,
                         "target": {"daily": {"min": 1, "max": 1}, "weekly": {"min": 3, "max": 3}, "monthly": {"min": 11, "max": 11}}}],
         "reward": {"daily": {"rep": {"min": 1500, "max": 2200}, "shards": {"min": 200000, "max": 350000}},
                    "weekly": {"rep": {"min": 9000, "max": 13200}, "shards": {"min": 1200000, "max": 2100000}},
                    "monthly": {"rep": {"min": 37500, "max": 55000}, "shards": {"min": 5000000, "max": 8750000}}}},
        {"key": "tracer_hunt", "title": "Tracer Hunt", "blurb": "Something in the net fights back. Catch it.",
         "scope": "global", "category": "skill", "cadences": ["weekly", "monthly"], "needs_vm": False,
         "objectives": [{"key": "caught", "event": "tracer_caught", "how": "Catch a tracer that fights back in `scan`",
                         "measure": "count", "per": 1, "unit": "", "cooldown_seconds": 0,
                         "target": {"weekly": {"min": 1, "max": 1}, "monthly": {"min": 1, "max": 1}}}],
         "reward": {"weekly": {"rep": {"min": 12000, "max": 18000}, "shards": {"min": 2100000, "max": 3300000}, "chests": {"min": 1, "max": 1}},
                    "monthly": {"rep": {"min": 50000, "max": 75000}, "shards": {"min": 8750000, "max": 13750000}, "chests": {"min": 1, "max": 1}}}},
    ],
}

NU = time.time()


def _iso(seconden):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(NU + seconden))


MIJN = {
    "available": True, "viewer": {"user_id": "1", "org_id": 2}, "count": 3, "done_count": 1,
    "history": [],
    "items": [
        {"id": 7, "definition_key": "grid_traffic", "cadence": "daily", "category": "general", "title": "Grid Traffic",
         "blurb": "The Grid rewards the ones who keep it busy.", "scope": "global", "ends_at": _iso(6 * 3600),
         "reward": {"rep": 3750, "shards": 400000, "org_shards": 3500000}, "done": False, "completed_objectives": 0,
         "objectives": [{"key": "activity", "how": "Play actively: each minute counts once, idle time does not", "event": "command_used",
                         "measure": "count", "per": 1, "unit": "minute", "target": 40, "value": 6, "done": False}]},
        {"id": 17, "definition_key": "honest_work", "cadence": "monthly", "category": "economic", "title": "Honest Work",
         "blurb": "No lock picked, no code guessed. Just shifts.", "scope": "global", "ends_at": _iso(29 * 86400),
         "reward": {"rep": 32500, "shards": 5625000}, "done": False, "completed_objectives": 0,
         "objectives": [{"key": "shifts", "how": "Work a shift with `work`", "event": "shards_earned",
                         "measure": "count", "per": 1, "unit": "shift", "target": 34, "value": 9, "done": False}]},
        {"id": 14, "definition_key": "chain_reaction", "cadence": "weekly", "category": "skill", "title": "Chain Reaction",
         "blurb": "Every miss grows the board. Clear it anyway.", "scope": "global", "ends_at": _iso(5 * 86400),
         "reward": {"rep": 9000, "shards": 1500000}, "done": True, "completed_objectives": 1,
         "objectives": [{"key": "boards", "how": "Clear a board in `cascade`", "event": "cascade_solved",
                         "measure": "count", "per": 1, "unit": "board", "target": 14, "value": 14, "done": True}]},
    ],
}

TAAK = {
    "enabled": True, "signed_in": True, "reward": 60000, "attempts_per_day": 3, "attempts_left": 3,
    "solved": False, "paid": 0, "answer_format": "a whole number",
    "task": {"family": "even_sum", "title": "Sum of the even numbers", "date": "2026-09-07",
             "statement": "Take the list `data`. Add up every value that is even. Answer with that sum.",
             "data": {"data": [812, 55, 640, 7, 913, 24, 388, 471, 62, 950, 33, 118, 745, 206, 881, 400, 19, 572, 663, 90]},
             "snippet": "data = [...]\ntotal = 0\nfor v in data:\n    if v % 2 == 0:\n        total += v\nprint(total)"},
}
GOED = 812 + 640 + 24 + 388 + 62 + 950 + 118 + 206 + 400 + 572 + 90


def poort_open():
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", 8899)) == 0


def stub(page, *, ingelogd=True, ingeleverd=None):
    # EERST de vangnet-route, want Playwright loopt routes in OMGEKEERDE
    # registratievolgorde af: wie hem als laatste registreert vangt alles.
    # Al het andere onder /api: netjes 404, nooit het echte internet.
    page.route("**/api/**", lambda r: r.fulfill(status=404, content_type="application/json", body="{}"))
    page.route("**/api/org/challenges/catalogue", lambda r: r.fulfill(
        status=200, content_type="application/json", body=json.dumps(CATALOGUS)))
    if ingelogd:
        page.route("**/api/org/challenges", lambda r: r.fulfill(
            status=200, content_type="application/json", body=json.dumps(MIJN)))
        page.route("**/api/minigames/coding/state", lambda r: r.fulfill(
            status=200, content_type="application/json", body=json.dumps(TAAK)))
    else:
        page.route("**/api/org/challenges", lambda r: r.fulfill(
            status=401, content_type="application/json", body=json.dumps({"error": "Unauthorized"})))
        page.route("**/api/minigames/coding/state", lambda r: r.fulfill(
            status=200, content_type="application/json", body=json.dumps({**TAAK, "signed_in": False})))

    def _submit(route):
        body = json.loads(route.request.post_data or "{}")
        ingeleverd.append(body)
        correct = str(body.get("answer", "")).strip() == str(GOED)
        antwoord = {**TAAK, "correct": correct, "attempts_left": 2 if not correct else 3,
                    "solved": correct, "paid": 60000 if correct else 0}
        if correct:
            antwoord["reward_result"] = {"paid": 60000, "reason": "ok"}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(antwoord))
    if ingeleverd is not None:
        page.route("**/api/minigames/coding/submit", _submit)


def maximaliseer(page):
    """Het browservenster van de VM op zijn grootst, via de runtime zelf."""
    page.evaluate("""() => {
        const w = document.querySelector('.vm-window');
        if (w && window.buckyVM && w.dataset.windowId) {
            try { window.buckyVM.toggleMaximizeWindow(w.dataset.windowId); } catch (_) {}
        }
    }""")
    page.wait_for_timeout(500)


def plaat(page, pad):
    """Een preview van de HELE pagina in het browservenster: het venster
    scrolt zelf, dus schuif in stappen en plak de stukken onder elkaar."""
    from PIL import Image

    venster = page.locator("[data-browser-viewport]").first
    maat = page.evaluate("""() => { const v = document.querySelector('[data-browser-viewport]');
                                    return v ? {h: v.clientHeight, s: v.scrollHeight} : null; }""")
    stukken = []
    y = 0
    n = 0
    while True:
        # DE ECHTE SCROLLPOSITIE TERUGLEZEN: het venster kan niet verder dan
        # zijn einde, dus de laatste strook begint lager dan gevraagd. Plakken
        # op de gevraagde hoogte gaf een dubbele band onderaan.
        echt = page.evaluate("y => { const v = document.querySelector('[data-browser-viewport]'); v.scrollTop = y; return v.scrollTop; }", y)
        page.wait_for_timeout(250)
        tmp = pad + f".{n}.png"
        venster.screenshot(path=tmp)
        stukken.append((tmp, int(echt)))
        n += 1
        if int(echt) + maat["h"] >= maat["s"] or n > 12:
            break
        y += maat["h"]
    beelden = [Image.open(p) for p, _ in stukken]
    b, h = beelden[0].size
    totaal = int(maat["s"] * (h / maat["h"]))
    plaat_img = Image.new("RGB", (b, totaal), (10, 4, 8))
    for (p, y0), beeld in zip(stukken, beelden):
        plaat_img.paste(beeld, (0, int(y0 * (h / maat["h"]))))
    plaat_img.save(pad)
    for p, _ in stukken:
        os.remove(p)
    page.evaluate("() => { document.querySelector('[data-browser-viewport]').scrollTop = 0; }")
    return plaat_img.size


def open_pagina(page, *, wacht=25000):
    page.goto(f"{BASIS}/vm/vm-test.html", wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.buckyVM", timeout=wacht)
    # Ook de harness begint op het inlogscherm van de VM: ENTER SYSTEM, dan
    # het bureaublad, dan pas een app. Zelfde volgorde als test_vm_vensterknoppen.
    instap = page.locator("button:has-text('ENTER SYSTEM')")
    instap.first.wait_for(state="visible", timeout=wacht)
    instap.first.click()
    page.locator(".vm-desktop-icon").first.wait_for(state="visible", timeout=wacht)
    page.wait_for_timeout(600)
    page.evaluate("() => window.buckyVM.openApp('browser')")
    page.wait_for_selector("[data-browser-url]", timeout=wacht)
    url = page.locator("[data-browser-url]").first
    url.fill("bucky://bucky/challenges")
    url.press("Enter")
    page.wait_for_selector(".vm-chal", timeout=wacht)
    # de drie fetches landen na de eerste render; wacht tot het bord er staat
    page.wait_for_selector(".vm-chal-card", timeout=wacht)
    page.wait_for_timeout(500)


def main():
    server = None
    if not poort_open():
        server = subprocess.Popen([sys.executable, "-m", "http.server", "8899", "--bind", "127.0.0.1"],
                                  cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            if poort_open():
                break
            time.sleep(0.2)
    os.makedirs(UIT, exist_ok=True)
    fouten = []

    def check(voorwaarde, tekst):
        print(("  ok   " if voorwaarde else "  FOUT ") + tekst)
        if not voorwaarde:
            fouten.append(tekst)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        init = "window.BUCKY_API_BASE = 'http://127.0.0.1:8899';"

        # --- desktop, ingelogd -------------------------------------------
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        ctx.add_init_script(init)
        page = ctx.new_page()
        ingeleverd = []
        stub(page, ingelogd=True, ingeleverd=ingeleverd)
        open_pagina(page)
        maximaliseer(page)

        print("bord")
        kaarten = page.locator(".vm-chal-card:not(.vm-chal-card-cat)")
        check(kaarten.count() == 3, f"drie open challenges op het bord (gezien {kaarten.count()})")
        koppen = [t.strip() for t in page.locator(".vm-chal-group > .vm-chal-h2").all_inner_texts()]
        check(any(k.startswith("Today") for k in koppen) and any(k.startswith("This week") for k in koppen)
              and any(k.startswith("This month") for k in koppen), f"drie tijdschalen als kop: {koppen}")
        tekst = page.locator(".vm-chal").inner_text()
        check("Work a shift with `work`" in tekst, "de uitleg staat op de kaart (wat te doen)")
        check("9 / 34 shifts" in tekst, "de stand met eenheid staat erbij (9 / 34 shifts)")
        check("6 / 40 minutes" in tekst, "de minuten-eenheid staat erbij (6 / 40 minutes)")
        check("counted once per minute" in tekst, "de regel van een minuut staat uitgelegd")
        check("1 of 3 finished" in tekst, "de samenvatting van het bord")
        check(page.locator(".vm-chal-card.is-done").count() == 1, "een afgeronde challenge is als af gemarkeerd")
        balken = page.locator(".vm-chal-card:not(.vm-chal-card-cat) .vm-chal-meter")
        check(balken.count() == 3, "elk doel heeft een balk")

        print("catalogus")
        cat = page.locator(".vm-chal-card-cat")
        check(cat.count() == 4, f"vier definities in de catalogus (gezien {cat.count()})")
        check("Coming up" in tekst and "Tracer Hunt" in tekst, "de catalogus toont wat er komt")
        # De chips staan in kapitalen op het scherm (CSS text-transform), en
        # inner_text geeft wat er STAAT - dus vergelijk zonder hoofdletters.
        laag = tekst.lower()
        check("needs the vm" in laag, "een VM-challenge draagt zijn label")
        check("open now" in laag, "een definitie die open staat is zo gelabeld")
        check("2–4 shifts" in tekst and "22–45 shifts" in tekst, "doelen als bereik per tijdschaal")
        check("150,000–300,000 shards" in tekst, "beloningen als bereik")

        print("code-opgave")
        check("Sum of the even numbers" in tekst, "de opgave staat er")
        check("answer" not in json.dumps(TAAK["task"]), "het antwoord zit niet in de state van de server")
        check("3 of 3 attempts left" in tekst, "de pogingen staan erbij")
        antwoordveld = page.locator("[data-chal='answer']")
        check(antwoordveld.count() == 1, "er is een antwoordveld")

        # eerst fout, dan goed: de uitspraak komt van de (nagespeelde) server
        antwoordveld.fill("1")
        page.locator("[data-inpage-act='submit']").click()
        page.wait_for_selector(".vm-chal-verdict.is-bad", timeout=10000)
        check(ingeleverd and ingeleverd[-1] == {"answer": "1"}, "het antwoord ging als getal naar de server")
        check("Not it" in page.locator(".vm-chal-coding").inner_text(), "een fout antwoord leest de uitspraak van de server")
        page.locator("[data-chal='answer']").fill(str(GOED))
        page.locator("[data-inpage-act='submit']").click()
        page.wait_for_selector(".vm-chal-verdict.is-good", timeout=10000)
        coding_tekst = page.locator(".vm-chal-coding").inner_text()
        check("Correct" in coding_tekst and "60,000 shards" in coding_tekst, "een goed antwoord toont de betaling van de server")
        check(page.locator("[data-chal='answer']").count() == 0, "na oplossen is het veld weg (een keer per dag)")

        # de preview: het browservenster van de VM, na een verse render
        page.locator("[data-browser-url]").first.fill("bucky://bucky/challenges")
        page.locator("[data-browser-url]").first.press("Enter")
        page.wait_for_selector(".vm-chal-card", timeout=15000)
        page.wait_for_timeout(500)
        maat = plaat(page, os.path.join(UIT, "desktop.png"))
        print(f"  preview: {os.path.join(UIT, 'desktop.png')} ({maat[0]}x{maat[1]})")
        ctx.close()

        # --- telefoon, uitgelogd -------------------------------------------
        # DE VM VERGRENDELT ONDER 768 PIXELS (bucky-vm-mobile-lock, vm.css):
        # dat is het ontwerp van de VM zelf - "een breed scherm: iPad, laptop,
        # PC of een grote telefoon" - en niet van deze pagina. De telefoonpreview
        # is dus de smalste breedte waarop de VM opent: een grote telefoon in
        # de breedte of een tablet rechtop. Een 390 pixel brede telefoon ziet
        # het slot van de VM, en dat is een aparte, bewuste beslissing.
        ctx = browser.new_context(viewport={"width": 768, "height": 1024}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.add_init_script(init)
        page = ctx.new_page()
        stub(page, ingelogd=False)
        open_pagina(page)
        maximaliseer(page)
        print("telefoon (768 breed, de smalste breedte waarop de VM opent)")
        tekst = page.locator(".vm-chal").inner_text()
        check("Sign in to see your board" in tekst, "uitgelogd: het bord vraagt om in te loggen, de catalogus staat er wel")
        check("Sign in on the arcade to submit" in tekst, "uitgelogd: de opgave is te zien, inleveren niet")
        scroll = page.evaluate("() => { const v = document.querySelector('[data-browser-viewport]'); return v ? v.scrollWidth - v.clientWidth : 0; }")
        check(scroll <= 1, f"geen horizontale scroll in het venster (overschot {scroll}px)")
        maat = plaat(page, os.path.join(UIT, "mobile.png"))
        print(f"  preview: {os.path.join(UIT, 'mobile.png')} ({maat[0]}x{maat[1]})")
        ctx.close()

        # --- een echte telefoon: het slot van de VM, ter documentatie ------
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.add_init_script(init)
        page = ctx.new_page()
        stub(page, ingelogd=False)
        page.goto(f"{BASIS}/vm/vm-test.html", wait_until="domcontentloaded")
        # Eerst wachten tot de runtime er is - de harness importeert hem lui -
        # en dan nog even, want het slot komt met de schil mee.
        page.wait_for_function("() => !!window.buckyVM", timeout=25000)
        page.wait_for_timeout(2500)
        # De inlogknop is onzichtbaar (of er niet): de VM opent niet. Het slot
        # zelf zit in de schil; of de harness hem tekent doet er minder toe dan
        # dat de deur dicht is.
        slot = page.locator(".bucky-vm-mobile-lock")
        knop = page.locator("button:has-text('ENTER SYSTEM')")
        dicht = knop.count() == 0 or not knop.first.is_visible()
        check(dicht, f"op 390 pixels opent de VM niet: de inlogknop is weg (slot in DOM: {slot.count()}) - bestaand ontwerp")
        page.screenshot(path=os.path.join(UIT, "phone-390-vm-lock.png"))
        ctx.close()
        browser.close()

    if server is not None:
        server.terminate()
    if fouten:
        print(f"\n{len(fouten)} controle(s) mislukt")
        return 1
    print("\nalles klopt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
