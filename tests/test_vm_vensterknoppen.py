"""De vensterknoppen van de VM, door ze echt aan te klikken.

WAAROM DIT BESTAAT, EN WAAROM HET DE MAAT MEET EN NIET DE KLASSE
"Maximaliseren en minimaliseren doen niets" was de melding. De knoppen wérkten:
er werd geklikt, `is-maximized` ging aan, de inline geometrie veranderde. Een
test op de klasse was dus groen geweest en had de melding niet verklaard.

Wat er aan de hand was, stond in de GETALLEN. `getMaximizedBounds` hield 102px
links vrij voor de iconenrail, en een venster is standaard al 620px breed in een
vak van 777. Maximaliseren maakte het 659: negenendertig pixels erbij, oftewel
zes procent. Dat is geen kapotte knop maar een knop zonder zichtbaar gevolg, en
voor wie ernaar kijkt is dat hetzelfde.

Daarom controleert deze test niet of de klasse omgaat maar of het venster ECHT
groeit - minstens de helft van de ruimte die er in het vak over is. Zo kan de
volgende inspringing er niet ongemerkt bij.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_vm_vensterknoppen.py
"""

import sys

from playwright.sync_api import sync_playwright

BASIS = "http://127.0.0.1:8899"


def meet(page):
    return page.evaluate("""() => {
      const w = document.querySelector('.vm-window');
      if (!w) return null;
      const r = w.getBoundingClientRect();
      const bay = document.querySelector('.arcade-vm-bay');
      const bb = bay ? bay.getBoundingClientRect() : {width: 0, height: 0};
      return {
        breedte: Math.round(r.width), hoogte: Math.round(r.height),
        vakBreedte: Math.round(bb.width), vakHoogte: Math.round(bb.height),
        zichtbaar: parseFloat(getComputedStyle(w).opacity) > 0.05,
        klassen: w.className,
      };
    }""")


def main():
    mislukt = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_context(viewport={"width": 1440, "height": 1000}).new_page()
        page.goto(f"{BASIS}/arcade.html", wait_until="domcontentloaded")
        page.wait_for_timeout(4200)
        page.evaluate("""() => { const v = document.querySelector('#the-vm');
                                 if (v) window.scrollTo(0, v.offsetTop); }""")
        page.wait_for_timeout(500)

        instap = page.locator("button:has-text('ENTER SYSTEM')")
        if not instap.count():
            print("FOUT er is geen ENTER SYSTEM-knop; de VM start niet")
            browser.close()
            return 1
        instap.first.click()
        page.wait_for_timeout(3500)

        iconen = page.locator(".vm-desktop-icon")
        if not iconen.count():
            print("FOUT geen bureaubladiconen; er valt geen venster te openen")
            browser.close()
            return 1
        iconen.first.dblclick()
        page.wait_for_timeout(1400)

        begin = meet(page)
        if not begin:
            print("FOUT er ging geen venster open")
            browser.close()
            return 1
        print(f"  venster bij openen: {begin['breedte']}x{begin['hoogte']} "
              f"in een vak van {begin['vakBreedte']}x{begin['vakHoogte']}")

        # --- maximaliseren ------------------------------------------------
        knop = page.locator(".vm-window [data-window-action='maximize']")
        if not knop.count():
            print("FOUT er is geen maximaliseerknop")
            mislukt.append("knop ontbreekt")
        else:
            knop.first.click()
            page.wait_for_timeout(900)
            groot = meet(page)
            print(f"  na maximaliseren  : {groot['breedte']}x{groot['hoogte']}")

            # De ruimte die er te winnen viel, en hoeveel daarvan is gepakt.
            teWinnen = begin["vakBreedte"] - begin["breedte"]
            gepakt = groot["breedte"] - begin["breedte"]
            deel = (gepakt / teWinnen) if teWinnen > 0 else 1.0
            print(f"  er viel {teWinnen}px te winnen, gepakt {gepakt}px "
                  f"({deel * 100:.0f}%)")
            if "is-maximized" not in groot["klassen"]:
                print("  FOUT de klasse is-maximized komt er niet op")
                mislukt.append("klasse")
            elif deel < 0.5:
                # Dit is de oorspronkelijke fout: klasse goed, geometrie bijna
                # ongewijzigd. Zes procent voelde als een knop die niets doet.
                print(f"  FOUT maximaliseren pakt maar {deel * 100:.0f}% van de "
                      "vrije ruimte; dat is niet te zien")
                mislukt.append("maximaliseren te klein")
            else:
                print("  OK   maximaliseren vult het bureaublad zichtbaar")

            # --- en weer terug --------------------------------------------
            knop.first.click()
            page.wait_for_timeout(800)
            terug = meet(page)
            if (terug["breedte"], terug["hoogte"]) != (begin["breedte"], begin["hoogte"]):
                print(f"  FOUT herstellen geeft {terug['breedte']}x{terug['hoogte']}, "
                      f"verwacht {begin['breedte']}x{begin['hoogte']}")
                mislukt.append("herstellen")
            else:
                print("  OK   herstellen zet het venster terug op zijn oude maat")

        # --- minimaliseren ------------------------------------------------
        knop_min = page.locator(".vm-window [data-window-action='minimize']")
        if not knop_min.count():
            print("FOUT er is geen minimaliseerknop")
            mislukt.append("knop ontbreekt")
        else:
            knop_min.first.click()
            page.wait_for_timeout(900)
            klein = meet(page)
            # Onzichtbaar is de eis, niet "kleiner": minimaliseren laat het
            # venster wegvallen naar de taakbalk en verandert de maat nauwelijks.
            if klein["zichtbaar"]:
                print(f"  FOUT na minimaliseren is het venster nog zichtbaar "
                      f"({klein['klassen']})")
                mislukt.append("minimaliseren")
            else:
                print("  OK   minimaliseren laat het venster verdwijnen")

        browser.close()

    if mislukt:
        print(f"\nMislukt: {', '.join(mislukt)}")
        print("Zie `getMaximizedBounds` in vm/core/vmRuntime.js.")
        return 1
    print("\nElke vensterknop doet zichtbaar wat hij belooft.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
