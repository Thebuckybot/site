"""De framerate van Open Water, op een telefoonprofiel en op een kale pagina.

WAT DIT WEL EN NIET ZEGT
Playwright draait Chromium headless, en daar rastert SwiftShader het canvas in
SOFTWARE - er komt geen GPU aan te pas. Een echte telefoon doet het vullen van
vlakken in hardware, dus de ABSOLUTE getallen hier zijn een ondergrens en geen
voorspelling.

Wat wel klopt is het VERSCHIL tussen scènes, want dat verschil zit in het
JavaScript en in het aantal paden, en dat is op elk apparaat hetzelfde werk. Zo
is ook gevonden dat de kustbanden als taartpunten vanaf het middelpunt werden
getekend: het grote eiland kostte 45% van de frametijd, en als ringstukken nog
25%.

En het draait op `bank_openwater.html` en niet op de arcade, want daar staan
drie spellen op één pagina en dan meet je de pagina in plaats van dit spel.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_openwater_prestaties.py
"""

import sys

# De uitvoer moet UTF-8 zijn, ook door een pipe heen. Windows zet
# stdout dan op cp1252, en dan valt deze test om op het notenteken
# van de geluidsknop - een crash in de RAPPORTAGE die eruitziet als
# een crash in het spel.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright

BASIS = "http://127.0.0.1:8899"

# WAT HIER BEWAAKT WORDT IS EEN VERHOUDING, GEEN GETAL.
#
# Een absolute ondergrens stond hier eerst op 18 fps, en die viel om zodra deze
# test achter vier andere browsertests aan draaide: dezelfde code haalde de ene
# keer 21 en de andere keer 15. Dat is geen eigenschap van het spel maar van de
# machine, en een test die daarvan afhangt leert je zijn uitslag te negeren.
#
# Wat wel stabiel is, is hoeveel het grootste eiland kost TEN OPZICHTE VAN
# dezelfde scène zonder eiland. Dat verschil zit in het aantal paden en in het
# JavaScript, en dat is op elke machine hetzelfde werk. Zo is ook gevonden dat
# de kustbanden en de andere lagen als volle schijven werden getekend: het
# eiland kostte 45% van de frametijd en na de reparatie 39%.
# WAT HIER BEWAAKT WORDT, EN WAAROM HET NIET DE KUST IS.
#
# Er stond hier eerst een vergelijking tussen "open water" en "stil langs de
# kust van The Mainland". Die kust bleek geen SCENE maar een uitkomst: de test
# vaart drie seconden en wacht dan tot de boot uitrolt, en hoe ver hij komt
# hangt af van de framerate zelf. Wordt het zwaar, dan legt de boot in dezelfde
# wandkloktijd minder speelwereld af, dus staat er iets anders in beeld, dus
# meet je iets anders. Dat is een terugkoppellus in een meting, en de uitslagen
# waren dan ook 6,9 - 4,5 - 4,1 - 5,3 fps voor dezelfde code.
#
# Er worden nu twee scenes gemeten die WEL bepaald zijn:
#   - open water op het startpunt: geen invoer, dus altijd hetzelfde beeld;
#   - de duikplek onder het startpunt: één druk op het anker, een vaste indeling.
# Allebei zijn ze zwaar op hun eigen manier (het water met zijn lagen, de duik
# met zijn verlopen en rotsen), en allebei zijn ze herhaalbaar.
#
# De kosten van het grootste eiland zijn met de hand gemeten en staan in de
# commit: 45% van de frametijd toen elke laag een volle schijf was, 39% als
# ringen, en daarna nog eens een derde eraf door de omtrek eenmalig uit te
# rekenen in plaats van per frame.
ABSOLUTE_BODEM_FPS = 8.0
MAX_KOSTEN_DUIK = 0.55


def stick(page, dx, dy, ms):
    s = page.locator(".mg-stick").bounding_box()
    cx, cy = s["x"] + s["width"] / 2, s["y"] + s["height"] / 2
    page.mouse.move(cx, cy)
    page.mouse.down()
    page.mouse.move(cx + dx, cy + dy, steps=4)
    page.wait_for_timeout(ms)
    page.mouse.up()


def meet(page, naam, ms=4000):
    uit = page.evaluate(f"() => window.__bank.meet({ms})")
    fps = 1000 / uit["gemiddeld"]
    print(f"  {naam:<38} {fps:5.1f} fps   "
          f"({uit['gemiddeld']:5.1f} ms gemiddeld, {uit['ergste']:6.1f} ms ergste)")
    return fps


def main():
    mislukt = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(**pw.devices["iPhone 13"])
        page = ctx.new_page()
        fouten = []
        page.on("pageerror", lambda e: fouten.append(str(e)[:200]))

        cdp = ctx.new_cdp_session(page)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})

        page.goto(f"{BASIS}/tests/bank_openwater.html", wait_until="domcontentloaded")
        page.wait_for_selector(".mg-stick", timeout=30000)

        print("  iPhone 13, processor 4x trager, software-rasterisatie")
        print("  (opwarmen)")
        page.wait_for_timeout(6000)

        open_water = meet(page, "open water op het startpunt")

        # De duikplek ligt pal onder het startpunt: één druk, geen navigatie.
        page.locator(".mg-knop-anker").click()
        page.wait_for_timeout(2000)
        st = page.locator("#mg-boat-status").text_content() or ""
        if "Diving at" not in st:
            print(f"  FOUT de duikplek is niet bereikt ({st!r})")
            mislukt.append("duiken")
            duik = open_water
        else:
            duik = meet(page, "onder water, de hele plaats in beeld")

        print()
        if open_water < ABSOLUTE_BODEM_FPS or duik < ABSOLUTE_BODEM_FPS:
            print(f"  FOUT er is iets ingestort: {open_water:.1f} / {duik:.1f} fps")
            mislukt.append("ingestort")
        else:
            print(f"  OK   niets ingestort ({open_water:.1f} / {duik:.1f} fps in "
                  "software-rasterisatie op een vertraagde processor)")

        kosten = (1 - duik / open_water) if open_water else 1
        if kosten > MAX_KOSTEN_DUIK:
            print(f"  FOUT de duikplaats kost {kosten * 100:.0f}% van de "
                  f"frametijd, meer dan de {MAX_KOSTEN_DUIK * 100:.0f}% die we "
                  "accepteren")
            mislukt.append("duiken te duur")
        else:
            print(f"  OK   de duikplaats kost {max(0, kosten) * 100:.0f}% van de "
                  "frametijd")

        ctx.close()
        browser.close()

    if fouten:
        print(f"\n  scriptfouten: {fouten[:2]}")
        mislukt.append("scriptfout")
    if mislukt:
        print(f"\nMislukt: {', '.join(mislukt)}")
        return 1
    print("\nOpen Water blijft speelbaar op een traag toestel.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
