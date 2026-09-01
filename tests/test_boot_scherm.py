"""Het bootspel op het scherm: maat, bediening, geluid en reduced motion.

WAT HIER WEL EN NIET IN ZIT
De kustlijn wordt NIET hier getest. Dat was de eerste opzet - de boot met
pijltjestoetsen het eiland op sturen en de kleur naast de romp uitlezen - en
die opzet gaf met en zonder de fout hetzelfde antwoord, want sturen is te grof
om een opening van veertig eenheden mee te raken. Die regel staat nu als pure
functie in `opSteiger` en wordt gecontroleerd door tests/test_boot_wereld.js.

Wat overblijft is precies wat je ALLEEN in een browser kunt vaststellen: hoe
groot het canvas werkelijk wordt, of de knoppen aanraakbaar zijn, of het geluid
echt uit staat tot iemand erom vraagt, en of reduced motion de tekenlus stillegt
in plaats van hem te vertragen.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_boot_scherm.py
"""

import sys

from playwright.sync_api import sync_playwright

BASIS = "http://127.0.0.1:8899"


def start_spel(page):
    knop = page.locator('.mg-btn[data-game="boat"]')
    if not knop.count():
        return False
    knop.scroll_into_view_if_needed()
    knop.click()
    page.wait_for_timeout(1300)
    return True


def main():
    mislukt = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # --- 1. gewone browser ------------------------------------------
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        fouten = []
        page.on("pageerror", lambda e: fouten.append(str(e)[:200]))

        # Tellen of er een AudioContext wordt gebouwd. Dit moet VOOR het laden
        # van de pagina, anders is de module al binnen.
        page.add_init_script("""
          window.__audioGebouwd = 0;
          const O = window.AudioContext || window.webkitAudioContext;
          if (O) {
            const W = function (...a) { window.__audioGebouwd++; return new O(...a); };
            W.prototype = O.prototype;
            window.AudioContext = W;
            window.webkitAudioContext = W;
          }
        """)
        page.goto(f"{BASIS}/arcade.html", wait_until="domcontentloaded")
        page.wait_for_timeout(4200)

        if not start_spel(page):
            print("FOUT de startknop van het bootspel bestaat niet")
            browser.close()
            return 1

        breedte = page.locator("#mg-boat").evaluate(
            "c => Math.round(c.getBoundingClientRect().width)")
        print(f"  canvasbreedte {breedte}px")
        if breedte < 420:
            # Vorige ronde stond dit op 260px: een open wereld door een
            # kijkgaatje, en dat viel pas op in een preview.
            print(f"  FOUT het canvas is maar {breedte}px breed")
            mislukt.append("canvasmaat")
        else:
            print("  OK   het canvas is breed genoeg om een wereld in te zien")

        # --- geluid staat uit, en er is niets gebouwd -------------------
        gebouwd = page.evaluate("() => window.__audioGebouwd")
        toggle = page.locator(".mg-touch-toggle")
        if not toggle.count():
            print("  FOUT er is geen geluidsschakelaar")
            mislukt.append("geen schakelaar")
        else:
            stand = toggle.first.get_attribute("aria-pressed")
            tekst = (toggle.first.text_content() or "").strip()
            print(f"  geluid: aria-pressed={stand} tekst={tekst!r} "
                  f"AudioContexts gebouwd={gebouwd}")
            if stand != "false" or "OFF" not in tekst.upper():
                print("  FOUT het geluid staat niet uit bij het starten")
                mislukt.append("geluid staat aan")
            elif gebouwd != 0:
                # Standaard uit is meer dan een vlaggetje: er hoort geen
                # audio-apparaat geopend te worden voordat iemand erom vraagt.
                print("  FOUT er is een AudioContext gebouwd zonder dat het "
                      "geluid aan stond")
                mislukt.append("audio zonder toestemming")
            else:
                print("  OK   geluid uit, en er is geen AudioContext gebouwd")

            # En na een klik hoort hij wel om te gaan.
            toggle.first.click()
            page.wait_for_timeout(500)
            na = toggle.first.get_attribute("aria-pressed")
            na_tekst = (toggle.first.text_content() or "").strip()
            if na != "true" or "ON" not in na_tekst.upper():
                print(f"  FOUT de schakelaar gaat niet aan (aria-pressed={na})")
                mislukt.append("schakelaar dood")
            else:
                print("  OK   de schakelaar gaat aan en zegt dat ook in tekst")
            toggle.first.click()

        # --- aanraakmaten (WCAG 2.5.8) ----------------------------------
        te_klein = page.evaluate("""() => {
          const uit = [];
          for (const b of document.querySelectorAll('.mg-touch-btn')) {
            const r = b.getBoundingClientRect();
            if (r.width < 44 || r.height < 44) {
              uit.push((b.getAttribute('aria-label') || b.textContent).trim()
                       + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
            }
          }
          return uit;
        }""")
        if te_klein:
            print(f"  FOUT knoppen onder 44px: {te_klein}")
            mislukt.append("aanraakmaat")
        else:
            print("  OK   alle bedieningsknoppen halen 44 bij 44")

        ctx.close()

        # --- 2. reduced motion ------------------------------------------
        ctx2 = browser.new_context(viewport={"width": 1440, "height": 1000},
                                   reduced_motion="reduce")
        page2 = ctx2.new_page()
        page2.add_init_script("""
          window.__frames = 0;
          const r = window.requestAnimationFrame;
          window.requestAnimationFrame = function (cb) {
            window.__frames++;
            return r.call(window, cb);
          };
        """)
        page2.goto(f"{BASIS}/arcade.html", wait_until="domcontentloaded")
        page2.wait_for_timeout(4200)
        start_spel(page2)
        voor = page2.evaluate("() => window.__frames")
        page2.wait_for_timeout(2000)
        na = page2.evaluate("() => window.__frames")
        erbij = na - voor
        print(f"  reduced motion: {erbij} rAF-aanvragen in 2 seconden")
        # Andere onderdelen van de pagina mogen best een frame vragen; wat NIET
        # mag is een doorlopende lus, en die zit rond de 120 in twee seconden.
        if erbij > 30:
            print("  FOUT de tekenlus loopt gewoon door bij reduced motion")
            mislukt.append("reduced motion")
        else:
            print("  OK   de tekenlus ligt stil bij reduced motion")
        ctx2.close()

        browser.close()

    if fouten:
        print(f"\n  scriptfouten op de pagina: {fouten[:3]}")
        mislukt.append("scriptfout")

    if mislukt:
        print(f"\nMislukt: {', '.join(mislukt)}")
        return 1
    print("\nHet bootspel staat goed op het scherm.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
