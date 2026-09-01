"""Het bootspel op het scherm: bediening, geluid, lopen en reduced motion.

WAT HIER WEL EN NIET IN ZIT
De kustlijn voor de BOOT wordt niet hier getest. Die regel staat als pure
functie in `opSteiger` en wordt gecontroleerd door tests/test_boot_wereld.js.
De eerste opzet stuurde de boot met toetsen naar het gat in de kust en gaf met
en zonder de fout hetzelfde antwoord, want sturen is te grof om een opening van
veertig eenheden mee te raken.

Voor LOPEN ligt dat anders en staat het hier wel. Lopen is traag, in een rechte
lijn, en het eiland is 260 eenheden groot: een paar seconden in dezelfde
richting komt gegarandeerd bij de rand. Dat is een meting die je kunt herhalen.

De rest is wat je alleen in een browser kunt vaststellen: of de bediening op
het speelveld ligt in plaats van eronder, of de knoppen aanraakbaar zijn, of het
geluid echt uit staat tot iemand erom vraagt, en of reduced motion de tekenlus
stillegt in plaats van hem te vertragen.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_boot_scherm.py
"""

import sys

from playwright.sync_api import sync_playwright

BASIS = "http://127.0.0.1:8899"


def is_water(kleur):
    """Is dit water? Op OVERHEERSING, en niet op afstand tot een hex.

    Twee keer bijgesteld, allebei omdat de vraag verkeerd stond.

    Eerst vergeleek dit met `KLEUR.land` (#1d3b2a) binnen een speling van 26
    per kanaal. Dat leek royaal maar was het niet: donker zeewater (21, 36, 54)
    valt binnen die doos, want in het donker liggen groen en blauw dicht bij
    elkaar. De test wees water dus aan als land.

    Daarna vroeg hij "staat hij op GRAS", en dat is niet de eis. Bucky stapt aan
    wal naast de steiger, dus de helft van wat er om hem heen ligt is bruine
    plank. De test noemde dat mislukt terwijl het precies goed ging.

    De eis is: hij mag niet IN HET WATER staan. Water is het enige dat
    blauw-overheersend is; gras is groen, zand en planken zijn rood/geel. Dat
    onderscheid overleeft ook een bijgesteld palet.
    """
    r, g, b = kleur
    return b > g + 6 and b > r + 6


def start_spel(page):
    """Start het spel en wacht tot de bediening er ECHT staat.

    Ook hier gold: een vaste pauze haalt het los gedraaid altijd, en valt om
    zodra er drie andere browsertests naast draaien op dezelfde eendraads
    server. Wachten op de joystick is exact wachten tot het spel er is.
    """
    knop = page.locator('.mg-btn[data-game="boat"]')
    if not knop.count():
        return False
    knop.scroll_into_view_if_needed()
    knop.click()
    try:
        page.wait_for_selector(".mg-stick", timeout=30000)
    except Exception:
        return False
    page.wait_for_timeout(500)
    page.locator("#mg-boat").click()
    return True


def stick(page, dx, dy, ms):
    """Trekt de joystick een kant op en houdt hem daar."""
    s = page.locator(".mg-stick").bounding_box()
    cx, cy = s["x"] + s["width"] / 2, s["y"] + s["height"] / 2
    page.mouse.move(cx, cy)
    page.mouse.down()
    page.mouse.move(cx + dx, cy + dy, steps=4)
    page.wait_for_timeout(ms)
    page.mouse.up()


def grond_rond_het_midden(page):
    """De kleuren net naast het midden van het canvas.

    De camera houdt de speler in het midden, dus het midden is de speler zelf.
    Er wordt eromheen gekeken, ruim buiten zijn eigen straal.
    """
    return page.evaluate("""() => {
      const c = document.getElementById('mg-boat');
      const ctx = c.getContext('2d');
      const dpr = c.width / c.getBoundingClientRect().width;
      const mx = c.width / 2, my = c.height / 2;
      return [[46, 0], [-46, 0], [0, 46], [0, -46]].map(([dx, dy]) => {
        const d = ctx.getImageData(Math.round(mx + dx * dpr),
                                   Math.round(my + dy * dpr), 1, 1).data;
        return [d[0], d[1], d[2]];
      });
    }""")


def main():
    mislukt = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # --- 1. gewone browser ------------------------------------------
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        fouten = []
        page.on("pageerror", lambda e: fouten.append(str(e)[:200]))

        # Tellen of er een AudioContext wordt gebouwd, van voor het laden.
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
        page.wait_for_selector("#mg-boat", timeout=30000)
        page.wait_for_timeout(800)

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

        # --- de bediening ligt OP het veld, niet eronder ----------------
        plaatsing = page.evaluate("""() => {
          const c = document.getElementById('mg-boat').getBoundingClientRect();
          const uit = [];
          const stick = document.querySelector('.mg-stick');
          if (!stick) return {geenStick: true};
          for (const el of [stick, ...document.querySelectorAll('.mg-knop')]) {
            const r = el.getBoundingClientRect();
            const binnen = r.top >= c.top - 2 && r.bottom <= c.bottom + 2
                        && r.left >= c.left - 2 && r.right <= c.right + 2;
            uit.push({
              naam: (el.getAttribute('aria-label') || el.className).slice(0, 26),
              binnen,
              maat: [Math.round(r.width), Math.round(r.height)],
            });
          }
          return {uit};
        }""")
        if plaatsing.get("geenStick"):
            print("  FOUT er is geen joystick")
            mislukt.append("geen joystick")
        else:
            buiten = [d for d in plaatsing["uit"] if not d["binnen"]]
            klein = [d for d in plaatsing["uit"]
                     if d["maat"][0] < 44 or d["maat"][1] < 44]
            if buiten:
                print(f"  FOUT bediening ligt buiten het speelveld: "
                      f"{[d['naam'] for d in buiten]}")
                mislukt.append("bediening eronder")
            else:
                print(f"  OK   alle {len(plaatsing['uit'])} bedieningsdelen "
                      "liggen op het speelveld")
            if klein:
                # WCAG 2.5.8: een raakdoel is minstens 44 bij 44.
                print(f"  FOUT onder 44px: {[(d['naam'], d['maat']) for d in klein]}")
                mislukt.append("aanraakmaat")
            else:
                print("  OK   alles haalt 44 bij 44")

        # --- de joystick reageert op de muis ----------------------------
        stick(page, 40, 0, 260)
        # Na loslaten hoort hij terug te veren naar het midden.
        page.wait_for_timeout(400)
        rust = page.evaluate(
            "() => document.querySelector('.mg-stick-knob').style.transform")
        if "translate(0px, 0px)" not in rust.replace(" ", " "):
            print(f"  FOUT de stick veert niet terug (transform={rust!r})")
            mislukt.append("stick veert niet terug")
        else:
            print("  OK   de stick veert terug naar het midden")

        # --- geluid staat uit, en er is niets gebouwd -------------------
        gebouwd = page.evaluate("() => window.__audioGebouwd")
        toggle = page.locator(".mg-knop-geluid")
        if not toggle.count():
            print("  FOUT er is geen geluidsknop")
            mislukt.append("geen geluidsknop")
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
                print("  FOUT er is een AudioContext gebouwd zonder toestemming")
                mislukt.append("audio zonder toestemming")
            else:
                print("  OK   geluid uit, en er is geen AudioContext gebouwd")

            toggle.first.click()
            page.wait_for_timeout(500)
            na = toggle.first.get_attribute("aria-pressed")
            na_tekst = (toggle.first.text_content() or "").strip()
            if na != "true" or "ON" not in na_tekst.upper():
                print(f"  FOUT de geluidsknop gaat niet aan (aria-pressed={na})")
                mislukt.append("geluidsknop dood")
            else:
                print("  OK   de geluidsknop gaat aan en zegt dat ook in tekst")
            toggle.first.click()

        # --- aanmeren en lopen ------------------------------------------
        # Naar het eiland en aanmeren.
        stick(page, 46, 0, 3600)
        page.wait_for_timeout(900)
        page.locator(".mg-knop-anker").click()
        page.wait_for_timeout(1800)

        aan_wal = grond_rond_het_midden(page)
        nat = sum(1 for k in aan_wal if is_water(k))
        if nat >= 3:
            # Geen stille overslag: als aanmeren niet lukt is dat een fout en
            # geen reden om de rest van de meting maar over te slaan. Een test
            # die zichzelf uitschakelt bewaakt niets.
            print(f"  FOUT aanmeren is niet gelukt; kleuren {aan_wal}")
            mislukt.append("aanmeren")
        else:
            print("  OK   aangemeerd en aan wal gestapt")

            # Nu een paar seconden dezelfde kant op lopen, tegen de rand aan.
            # Het eiland is 260 groot en lopen gaat 118 per seconde, dus vier
            # seconden is met zekerheid tot voorbij de kust - als er niets
            # tegenhoudt.
            stick(page, 0, 46, 4200)
            page.wait_for_timeout(400)
            na_lopen = grond_rond_het_midden(page)
            nat_na = sum(1 for k in na_lopen if is_water(k))
            print(f"  kleuren rond de speler na het lopen: {na_lopen}")
            if nat_na >= 3:
                print("  FOUT Bucky is het water in gelopen; de rand houdt niet")
                mislukt.append("rand houdt niet")
            else:
                print("  OK   Bucky blijft op het eiland; de rand houdt hem tegen")

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
        page2.wait_for_selector("#mg-boat", timeout=30000)
        page2.wait_for_timeout(800)
        start_spel(page2)
        voor = page2.evaluate("() => window.__frames")
        page2.wait_for_timeout(2000)
        na = page2.evaluate("() => window.__frames")
        erbij = na - voor
        print(f"  reduced motion: {erbij} rAF-aanvragen in 2 seconden")
        # Andere delen van de pagina mogen een frame vragen; wat NIET mag is
        # een doorlopende lus, en die zit rond de 120 in twee seconden.
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
