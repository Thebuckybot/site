"""De stapelvolgorde van de arcade, gemeten in een echte browser.

DE REGEL HEEFT TWEE HELFTEN, EN DIE SPREKEN ELKAAR BIJNA TEGEN.

1. De vastgezette spelerskaart hoort boven de rest van de pagina te liggen.
   Twee keer werd gemeld dat hij eronder verdween, en twee keer werd dat
   beantwoord met een hoger getal. Dat kon niet werken: de kaart zat in vier
   geneste stapelcontexten waarvan de buitenste (`#arcade-world`) op z-index 0
   staat, dus geen enkel getal daarbinnen tilt hem boven iets daarbuiten. En
   `.hero-left` krijgt bij het scrollen een inline transform, wat hem het
   containing block maakt van een `position: fixed` kind. De kaart wordt nu bij
   het pinnen naar `<body>` verplaatst; daar bestaat die hele klasse niet meer.

2. Maar de VM hoort boven de kaart te liggen. Zodra de kaart eenmaal boven de
   pagina stond, stond hij ook boven de knop waarmee je de VM verlaat, en dan
   kom je er niet meer uit. De VM is de ene uitzondering.

Allebei worden hieronder gemeten, en niet afgeleid uit z-indexen: er wordt
gekeken WIE ER LIGT op het punt waar de kaart staat.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_arcade_stapeling.py

Het is met opzet geen pytest: `site/` heeft geen testsuite en geen
afhankelijkheden, en dit hoort daar niet als eerste een te introduceren.
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
MATEN = [("phone", 390, 844), ("tablet", 820, 1180), ("desktop", 1440, 900)]


def wie_ligt_erop(page):
    """Wie raak je aan op de plek van de spelerskaart?"""
    return page.evaluate("""() => {
      const kaart = document.querySelector('.player-hero-card');
      if (!kaart) return {fout: 'geen kaart'};
      const r = kaart.getBoundingClientRect();
      if (r.width === 0 || getComputedStyle(kaart).visibility === 'hidden') {
        return {verborgen: true};
      }
      const punten = [
        [r.x + 6, r.y + 6],
        [r.x + r.width / 2, r.y + r.height / 2],
        [r.x + r.width - 6, r.y + r.height - 6],
      ];
      return {raak: punten.map(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'buiten beeld';
        return kaart.contains(el) ? 'KAART'
             : (el.closest('.bucky-vm-shell, .bucky-vm-backdrop, .arcade-vm-bay')
                ? 'VM' : (el.className || el.tagName).toString().slice(0, 34));
      })};
    }""")


def klemmende_ouders(page):
    """Elke voorouder die een stapelcontext of containing block maakt.

    Dit verving het tellen van z-indexen, want dat bleek de verkeerde vraag.
    Zolang de ouder <body> is en er niets tussen zit, kan de kaart niet geklemd
    worden door iets waar hij zelf niets van weet.
    """
    return page.evaluate("""() => {
      const kaart = document.querySelector('.player-hero-card');
      if (!kaart) return {fout: 'geen kaart'};
      const boosdoeners = [];
      let e = kaart.parentElement;
      while (e && e !== document.documentElement) {
        const s = getComputedStyle(e);
        if (s.transform !== 'none' || s.filter !== 'none' || s.perspective !== 'none'
            || (s.position !== 'static' && s.zIndex !== 'auto')) {
          boosdoeners.push(e.tagName + '.' + (e.className || '').toString().split(' ')[0]
                           + ' z=' + s.zIndex + (s.transform !== 'none' ? ' +transform' : ''));
        }
        e = e.parentElement;
      }
      return {ouder: kaart.parentElement.tagName, boosdoeners};
    }""")


def zet_vm_op_vol_scherm(page, aan):
    page.evaluate("""(aan) => {
      document.body.classList.toggle('vm-focus-active', aan);
      const shell = document.querySelector('.bucky-vm-shell');
      if (shell) {
        shell.classList.toggle('is-expanded', aan);
        shell.classList.toggle('is-embedded', !aan);
      }
      const bd = document.querySelector('.bucky-vm-backdrop');
      if (bd) {
        bd.classList.toggle('is-visible', aan);
        bd.style.opacity = aan ? '1' : '';
        bd.style.pointerEvents = aan ? 'auto' : '';
      }
    }""", aan)
    page.wait_for_timeout(700)


def main():
    mislukt = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for naam, w, h in MATEN:
            ctx = browser.new_context(viewport={"width": w, "height": h})
            page = ctx.new_page()
            page.goto(f"{BASIS}/arcade.html", wait_until="domcontentloaded")
            # WACHTEN OP EEN SIGNAAL, NIET OP DE KLOK. Hier stond een vaste
            # pauze van 4200ms. Dat haalt het meestal, maar toen deze test in
            # een rij met drie andere browsertests draaide op dezelfde
            # eendraads http.server, was de pagina een keer nog niet klaar en
            # meldde hij een fout die er niet was. Een test die van de
            # machinebelasting afhangt is erger dan geen test: hij leert je zijn
            # uitslag te negeren.
            page.wait_for_selector(".player-hero-card", timeout=30000)
            page.wait_for_selector("#the-vm", timeout=30000)
            page.wait_for_timeout(600)
            page.evaluate("""() => {
              const vm = document.querySelector('#the-vm');
              if (vm) window.scrollTo(0, vm.offsetTop + 150);
            }""")
            page.wait_for_timeout(700)

            # --- deel 1: boven de gewone pagina, met de VM ingeklapt -------
            zet_vm_op_vol_scherm(page, False)
            if w > 700:
                ketting = klemmende_ouders(page)
                if ketting.get("ouder") != "BODY":
                    print(f"  {naam:<8} FOUT de vastgezette kaart hangt onder "
                          f"{ketting.get('ouder')} in plaats van BODY; "
                          f"klemmende ouders: {ketting.get('boosdoeners')}")
                    mislukt.append(f"{naam} (ouder)")
                elif ketting.get("boosdoeners"):
                    print(f"  {naam:<8} FOUT er zit een klemmende ouder tussen: "
                          f"{ketting['boosdoeners']}")
                    mislukt.append(f"{naam} (context)")

                uit = wie_ligt_erop(page)
                if uit.get("verborgen"):
                    print(f"  {naam:<8} FOUT de kaart is verborgen terwijl de VM dicht is")
                    mislukt.append(f"{naam} (verborgen)")
                elif uit.get("raak") and all(p == "KAART" for p in uit["raak"]):
                    print(f"  {naam:<8} OK   de kaart ligt boven de pagina")
                else:
                    print(f"  {naam:<8} FOUT de kaart gaat onder de pagina: {uit.get('raak')}")
                    mislukt.append(f"{naam} (onder de pagina)")
            else:
                # Onder 700px pint de kaart met opzet niet: op een telefoon lag
                # hij over de inhoud eronder.
                print(f"  {naam:<8} OK   pint niet op deze breedte, met opzet")

            # --- deel 2: en de VM wint, op elke maat ----------------------
            zet_vm_op_vol_scherm(page, True)
            uit = wie_ligt_erop(page)
            if uit.get("verborgen"):
                print(f"  {naam:<8} OK   met de VM open stapt de kaart opzij")
            elif uit.get("raak") and all(p != "KAART" for p in uit["raak"]):
                print(f"  {naam:<8} OK   met de VM open ligt de VM erboven: {uit['raak'][0]}")
            else:
                print(f"  {naam:<8} FOUT de kaart ligt OVER de VM: {uit.get('raak')}")
                print(f"           daardoor kom je de VM niet meer uit")
                mislukt.append(f"{naam} (over de VM)")

            ctx.close()
        browser.close()

    if mislukt:
        print(f"\nMislukt: {', '.join(mislukt)}")
        print("Zie `update` in js/arcade.js: de kaart pint niet zolang")
        print("`vm-focus-active` op <body> staat, met een CSS-vangrail in arcade.css.")
        return 1
    print("\nDe kaart ligt boven de pagina, en de VM ligt boven de kaart.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
