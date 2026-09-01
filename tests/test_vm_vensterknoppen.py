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

# De uitvoer moet UTF-8 zijn, ook door een pipe heen. Windows zet
# stdout dan op cp1252, en dan valt deze test om op het notenteken
# van de geluidsknop - een crash in de RAPPORTAGE die eruitziet als
# een crash in het spel.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright

BASIS = "http://127.0.0.1:8899"


def meet(page):
    """De TOEGEPASTE geometrie van het venster, uit zijn eigen inline stijl.

    DERDE OPZET, EN DE EERSTE TWEE VERLOREN VAN DE ANIMATIE.

    1. `getBoundingClientRect()`: die geeft de maat NA alle transforms, en de
       VM-schil kantelt bij het openen met een `matrix3d` van ongeveer een
       graad. Een venster van 400px hoog meet dan 396 zolang die animatie loopt
       en 400 daarna, dus twee metingen uit verschillende momenten van dezelfde
       animatie leken een verschil dat er niet was.
    2. `offsetWidth`/`offsetHeight`: die negeren transforms wel, maar het
       venster heeft een CSS-overgang OP zijn breedte en hoogte. De layoutmaat
       loopt dus alsnog op, en een poller die op vier gelijke metingen wacht
       komt er op een vlak stuk van de versoepeling te vroeg uit. Drie van de
       zes keer las de test de maat van halverwege.

    Twee verschillende trucs, twee keer dezelfde uitkomst: ik probeerde een
    bewegend beeld op te meten en verloor van de klok. Uitzoomen dus - want de
    vraag is helemaal niet hoe groot het venster op dit moment IS.

    De vraag is wat maximaliseren heeft TOEGEPAST, en dat staat in de inline
    stijl die `syncWindows` erop zet. Die springt in één keer naar zijn nieuwe
    waarde en animeert niet; de overgang is puur wat de browser er daarna
    visueel van maakt. Er valt hier dus niets meer te racen.
    """
    return page.evaluate("""() => {
      const w = document.querySelector('.vm-window');
      if (!w) return null;
      const laag = document.querySelector('.vm-window-layer');
      // GEEN REGEX OVER HET STYLE-ATTRIBUUT. Dat stond er eerst, en het ging
      // stuk op iets doms: de browser schrijft `width:620px` zonder spatie bij
      // het openen en `width: 751px` MET spatie na het maximaliseren, en de
      // backslash in `\s*` overleefde de reis door drie lagen aanhalings-
      // tekens niet. Het patroon werd `widths*:s*` en matchte alleen de vorm
      // zonder spaties - dus precies de beginmaat wel en de nieuwe niet.
      //
      // `w.style.width` laat de browser zijn eigen stijl ontleden. Die kan er
      // niet naast zitten, en er valt niets aan te ontsnappen.
      const getal = (naam) => {
        const v = w.style[naam];
        return v && v.endsWith('px') ? Math.round(parseFloat(v)) : null;
      };
      return {
        breedte: getal('width'), hoogte: getal('height'),
        x: getal('left'), y: getal('top'),
        vakBreedte: laag ? laag.clientWidth : 0,
        vakHoogte: laag ? laag.clientHeight : 0,
        zichtbaar: parseFloat(getComputedStyle(w).opacity) > 0.05,
        klassen: w.className,
        aantal: document.querySelectorAll('.vm-window').length,
      };
    }""")


def wacht_op_maat(page, anders_dan, pogingen=40):
    """Wacht tot de toegepaste breedte iets ANDERS is dan `anders_dan`.

    Als maximaliseren werkt, staat de nieuwe waarde er binnen een paar frames.
    Als het niet werkt, loopt dit af en meldt de test dat - wat precies de
    bedoeling is. Er wordt niet op een minimum gewacht, alleen op verandering:
    hoe groot het moet worden beoordeelt de test zelf.
    """
    for _ in range(pogingen):
        nu = meet(page)
        if nu and nu["breedte"] != anders_dan:
            return nu
        page.wait_for_timeout(80)
    return meet(page)


def main():
    mislukt = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_context(viewport={"width": 1440, "height": 1000}).new_page()
        # WACHTEN OP EEN SIGNAAL, NIET OP DE KLOK.
        #
        # Hier stonden vaste pauzes: 4200ms voor de pagina, 3500ms voor de VM,
        # 1400ms voor het venster. Los gedraaid haalt dat het altijd. Maar toen
        # deze test in een rij met drie andere browsertests op dezelfde
        # eendraads http.server draaide, was de VM een keer nog niet klaar en
        # meldde hij "maximaliseren pakt 0% van de vrije ruimte" - een fout die
        # er niet was.
        #
        # Dat is erger dan geen test: een test die van de machinebelasting
        # afhangt leert je zijn uitslag te negeren, en dan mis je de keer dat
        # hij gelijk heeft. Elke stap wacht nu op iets dat er moet ZIJN.
        page.goto(f"{BASIS}/arcade.html", wait_until="domcontentloaded")
        page.wait_for_selector("#the-vm", timeout=30000)
        page.evaluate("""() => { const v = document.querySelector('#the-vm');
                                 if (v) window.scrollTo(0, v.offsetTop); }""")

        instap = page.locator("button:has-text('ENTER SYSTEM')")
        try:
            instap.first.wait_for(state="visible", timeout=30000)
        except Exception:
            print("FOUT er is geen ENTER SYSTEM-knop; de VM start niet")
            browser.close()
            return 1
        instap.first.click()

        iconen = page.locator(".vm-desktop-icon")
        try:
            iconen.first.wait_for(state="visible", timeout=40000)
        except Exception:
            print("FOUT geen bureaubladiconen; er valt geen venster te openen")
            browser.close()
            return 1
        # Even laten bedaren: de iconen verschijnen met een animatie, en een
        # dubbelklik midden in het intekenen komt soms niet aan.
        page.wait_for_timeout(600)
        iconen.first.dblclick()
        page.wait_for_selector(".vm-window", timeout=20000)
        page.wait_for_timeout(400)

        begin = meet(page)
        if not begin:
            print("FOUT er ging geen venster open")
            browser.close()
            return 1
        print(f"  venster bij openen: {begin['breedte']}x{begin['hoogte']} "
              f"in een vak van {begin['vakBreedte']}x{begin['vakHoogte']} "
              f"| vensters={begin['aantal']}")

        # --- maximaliseren ------------------------------------------------
        knop = page.locator(".vm-window [data-window-action='maximize']")
        if not knop.count():
            print("FOUT er is geen maximaliseerknop")
            mislukt.append("knop ontbreekt")
        else:
            knop.first.click()
            page.wait_for_selector(".vm-window.is-maximized", timeout=15000)
            groot = wacht_op_maat(page, begin["breedte"])
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
            page.wait_for_selector(".vm-window:not(.is-maximized)", timeout=15000)
            terug = wacht_op_maat(page, groot["breedte"])
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
            page.wait_for_selector(".vm-window.is-minimized", timeout=15000)
            # Minimaliseren vervaagt; de MAAT staat dan al stil terwijl de
            # dekking nog loopt. Hier is een korte pauze wel het juiste
            # gereedschap, want er is niets dat op nul springt om op te wachten.
            page.wait_for_timeout(700)
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
