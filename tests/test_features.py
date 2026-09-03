"""De aan/uit-schakelaars, zoals een BEZOEKER ze merkt.

De serverhelft staat in backend/tests/test_site_features.py: die bewaakt dat de
endpoints weigeren. Dit bestand bewaakt de andere helft - dat het onderdeel ook
echt van de pagina verdwijnt, en niet alleen onzichtbaar is terwijl het nog in
de toetsvolgorde staat.

WAAROM DIT NIET UIT DE HTML TE LEZEN IS
De vlaggen komen bij het laden binnen en de pagina past ze daarna toe. Wat er in
`arcade.html` staat zegt dus niets over wat een bezoeker ziet; alleen een
browser die de pagina echt draait kan dat vaststellen. Het antwoord van de
server wordt hier onderschept, zodat de test niet afhangt van wat er op dit
moment toevallig aan of uit staat.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_features.py
"""

import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright   # noqa: E402

BASIS = "http://127.0.0.1:8899"


def open_met(page, vlaggen):
    """Laadt de arcade met een verzonnen vlaggenstand."""
    def antwoord(route):
        route.fulfill(status=200, content_type="application/json",
                      body='{"features": %s}' % _json(vlaggen))
    page.route("**/api/site/features", antwoord)
    page.goto(f"{BASIS}/arcade.html", wait_until="domcontentloaded")
    page.wait_for_timeout(1500)


def _json(d):
    return "{" + ", ".join(f'"{k}": {"true" if v else "false"}'
                           for k, v in d.items()) + "}"


def zichtbaar(page, selector):
    return page.evaluate("""(sel) => {
      const el = document.querySelector(sel);
      if (!el) return {ontbreekt: true};
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const focusbaar = [...el.querySelectorAll(
          "a, button, input, canvas, [tabindex]")]
        .filter((f) => f.getAttribute("tabindex") !== "-1").length;
      return {
        zichtbaar: r.width > 0 && r.height > 0 && s.display !== "none",
        verborgenAttribuut: el.hasAttribute("hidden"),
        ariaHidden: el.getAttribute("aria-hidden") === "true",
        focusbaar,
      };
    }""", selector)


def security_zijbalk(page, vlaggen):
    """De secties in de zijbalk van het Security Center, met een verzonnen stand.

    EEN EIGEN OPSTELLING, want dit is de andere helft van het probleem. De
    Security Center bouwt zijn zijbalk met JavaScript, dus een `data-feature` in
    de HTML raakt hem niet: het attribuut zou op iets moeten staan dat nog niet
    bestaat. De vlaggen gaan daar dus naar de ROUTER, en dat pad heeft zijn
    eigen test nodig.
    """
    def antwoord(route):
        route.fulfill(status=200, content_type="application/json",
                      body='{"features": %s}' % _json(vlaggen))
    page.route("**/api/site/features", antwoord)
    # `guild_id` moet erbij, anders stuurt de pagina je meteen naar het
    # dashboard en test je niets.
    page.goto(f"{BASIS}/security.html?guild_id=1", wait_until="domcontentloaded")
    page.wait_for_timeout(2000)
    return page.evaluate(
        """() => [...document.querySelectorAll('.sec-nav-item')]
                   .map((b) => b.getAttribute('data-key'))""")


def main():
    mislukt = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # --- alles aan ---------------------------------------------------
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        open_met(page, {"minigames": True, "wordle": True,
                        "open_water": True, "crossing": True})
        for naam, sel in [("de minigames-sectie", "#minigames"),
                          ("de wordle-kaart", '[data-feature="wordle"]'),
                          ("Open Water", '[data-feature="open_water"]')]:
            uit = zichtbaar(page, sel)
            if uit.get("ontbreekt"):
                print(f"  FOUT {naam} bestaat niet op de pagina")
                mislukt.append(naam)
            elif not uit["zichtbaar"]:
                print(f"  FOUT {naam} is verborgen terwijl de vlag aan staat")
                mislukt.append(naam)
            else:
                print(f"  OK   {naam} staat er als de vlag aan staat")
        ctx.close()

        # --- één onderdeel uit --------------------------------------------
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        open_met(page, {"minigames": True, "wordle": False,
                        "open_water": True, "crossing": True})
        uit = zichtbaar(page, '[data-feature="wordle"]')
        if uit.get("ontbreekt"):
            print("  FOUT de wordle-kaart bestaat niet")
            mislukt.append("wordle weg")
        elif uit["zichtbaar"]:
            print("  FOUT de wordle-kaart staat er nog terwijl de vlag uit staat")
            mislukt.append("wordle zichtbaar")
        elif uit["focusbaar"] > 0:
            # ONZICHTBAAR IS NIET WEG. Een verborgen kaart waar je nog doorheen
            # kunt taben is voor een schermlezer gewoon aanwezig, en dan is het
            # onderdeel niet uit maar alleen onzichtbaar voor wie kijkt.
            print(f"  FOUT er zijn nog {uit['focusbaar']} focusbare elementen "
                  "in de verborgen kaart")
            mislukt.append("nog te taben")
        else:
            print("  OK   de wordle-kaart is weg, en niet meer te taben")

        # En de rest hoort er gewoon te staan: één vlag uit mag niet alles
        # meenemen.
        buur = zichtbaar(page, '[data-feature="open_water"]')
        if not buur.get("zichtbaar"):
            print("  FOUT Open Water verdween mee terwijl alleen wordle uit staat")
            mislukt.append("te veel verborgen")
        else:
            print("  OK   de andere kaarten blijven staan")
        ctx.close()

        # --- de grove knop -------------------------------------------------
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        open_met(page, {"minigames": False, "wordle": True,
                        "open_water": True, "crossing": True})
        uit = zichtbaar(page, "#minigames")
        if uit.get("zichtbaar"):
            print("  FOUT de hele minigames-sectie staat er nog")
            mislukt.append("sectie zichtbaar")
        else:
            print("  OK   de hele sectie verdwijnt met de grove knop")

        # DE VM BLIJFT ALTIJD STAAN. Dat is de ene uitzondering, en die hoort
        # bewaakt te worden: hem per ongeluk een vlag geven zou de arcade leeg
        # achterlaten.
        vm = zichtbaar(page, "#the-vm")
        if vm.get("ontbreekt") or not vm.get("zichtbaar"):
            print("  FOUT de VM is verdwenen; die hoort geen vlag te hebben")
            mislukt.append("VM weg")
        else:
            print("  OK   de VM staat er nog, want die heeft geen vlag")
        ctx.close()

        # --- geen antwoord van de server -----------------------------------
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        page.route("**/api/site/features", lambda r: r.abort())
        page.goto(f"{BASIS}/arcade.html", wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        uit = zichtbaar(page, "#minigames")
        if not uit.get("zichtbaar"):
            # BIJ TWIJFEL TONEN. De server weigert dan nog steeds wat uit staat,
            # dus het ergste geval is een kaart die niet werkt - beter dan een
            # halve site die verdwijnt omdat het netwerk hikte.
            print("  FOUT alles verdween toen de vlaggen niet op te halen waren")
            mislukt.append("verdwenen bij netwerkfout")
        else:
            print("  OK   zonder antwoord blijft de pagina staan")
        ctx.close()

        # --- de zijbalk van het Security Center -----------------------------
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        aan = security_zijbalk(page, {"security_center": True, "soc": True,
                                      "rule_builder": True})
        if "soc" in aan and "rulebuilder" in aan:
            print("  OK   met de vlaggen aan staan SOC en de Rule Builder erin")
        else:
            print(f"  FOUT SOC of de Rule Builder ontbreekt terwijl ze aan staan: {aan}")
            mislukt.append("soc mist bij aan")
        ctx.close()

        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        uit = security_zijbalk(page, {"security_center": True, "soc": False,
                                      "rule_builder": False})
        weg = [k for k in ("soc", "rulebuilder", "rules", "liveevents") if k in uit]
        if weg:
            print(f"  FOUT deze secties staan er nog terwijl SOC uit staat: {weg}")
            mislukt.append("soc zichtbaar")
        elif "overview" not in uit:
            print("  FOUT de rest van het Security Center verdween mee")
            mislukt.append("te veel weg")
        else:
            print("  OK   met SOC uit is de hele groep weg en de rest blijft")
        ctx.close()

        # EN JE MOET ER OOK NIET NAARTOE KUNNEN TYPEN. Een sectie die alleen uit
        # de zijbalk is gehaald blijft bereikbaar via `#soc` in de adresbalk, en
        # dan is hij verborgen in plaats van uit.
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()

        def antwoord(route):
            route.fulfill(status=200, content_type="application/json",
                          body='{"features": {"security_center": true, "soc": false}}')
        page.route("**/api/site/features", antwoord)
        page.goto(f"{BASIS}/security.html?guild_id=1#soc", wait_until="domcontentloaded")
        page.wait_for_timeout(2000)
        # NIET OP DE KRUIMEL METEN. Die eerste versie kon niet falen: in de
        # navigatieboom heet de SOC-overzichtspagina óók "Overview", dus de
        # kruimel is letterlijk dezelfde tekst of je nu op het echte overzicht
        # staat of op dat van het SOC. De sectie die geladen werd, verried zich
        # daar dus niet - en de test was groen met en zonder de vangrail.
        #
        # Wat wél verschilt is welke knop actief wordt. Valt `#soc` terug op het
        # overzicht, dan licht die knop op; wordt de SOC-sectie toch geladen,
        # dan is er geen enkele actieve knop, want die van het SOC is weg.
        actief = page.evaluate(
            """() => [...document.querySelectorAll('.sec-nav-item.active')]
                       .map((b) => b.getAttribute('data-key'))""")
        if actief != ["overview"]:
            print(f"  FOUT #soc in de adresbalk valt niet terug op het overzicht "
                  f"(actief: {actief})")
            mislukt.append("soc via de hash")
        else:
            print("  OK   #soc in de adresbalk valt terug op het overzicht")
        ctx.close()

        browser.close()

    if mislukt:
        print(f"\nMislukt: {', '.join(mislukt)}")
        return 1
    print("\nDe schakelaars doen wat een bezoeker ervan hoort te merken.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
