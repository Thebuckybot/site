"""De stapelvolgorde van de arcade, gemeten in een echte browser.

WAAROM DIT BESTAAT
De spelerskaart die bij het scrollen vastzet is twee keer gemeld als "gaat
onder de VM". `z-index: 78` op de kaart wordt opgelost BINNEN de stapelcontext
van `.arcade-hero`, dus wat de hero waard is bepaalt wat de kaart waard is - en
dat is precies het soort ding dat je niet ziet door naar de kaart te kijken.

EERLIJK OVER WAT HIER WEL EN NIET IS AANGETOOND. De zichtbaarheidsmeting
hieronder kreeg de gemelde fout NIET gereproduceerd: de kaart lag in elke maat
en in elke VM-toestand bovenop, ook met de hero nog op de oude waarde. De
oorzaak van de melding is dus niet bevestigd.

Wat wel vaststaat en wel te bewaken is, is de VOLGORDE: de hero hoort boven
elke z-index te staan die de VM opzet (backdrop 80, shell 90, bay 95), zodat er
geen toestand KAN zijn waarin de kaart eronder valt. Die eigenschap is het
eerste blok hieronder, en die faalt wel als iemand de hero verlaagt. Het tweede
blok is de zichtbaarheidsmeting: die bewijst niets over de melding, maar vangt
wel een toekomstige regressie waarin er iets bovenop komt te liggen.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_arcade_stapeling.py

Het is met opzet geen pytest: `site/` heeft geen testsuite en geen
afhankelijkheden, en dit hoort daar niet als eerste een te introduceren. Het is
een script dat je draait als je aan de arcade hebt gezeten.
"""

import sys

from playwright.sync_api import sync_playwright

BASIS = "http://127.0.0.1:8899"
MATEN = [("phone", 390, 844), ("tablet", 820, 1180), ("desktop", 1440, 900)]


def meet(page):
    """Wie ligt er bovenop het midden van de spelerskaart?"""
    return page.evaluate("""() => {
      const kaart = document.querySelector('.player-hero-card');
      if (!kaart) return {fout: 'geen kaart'};
      const r = kaart.getBoundingClientRect();
      if (r.width === 0) return {fout: 'kaart onzichtbaar'};
      const punten = [
        [r.x + 6, r.y + 6],
        [r.x + r.width / 2, r.y + r.height / 2],
        [r.x + r.width - 6, r.y + r.height - 6],
      ];
      const raak = punten.map(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'buiten beeld';
        return kaart.contains(el) ? 'KAART' : (el.className || el.tagName).toString().slice(0, 40);
      });
      return {raak, gepind: document.body.classList.contains('arcade-profile-pinned')};
    }""")


# De z-indexen die de VM opzet zodra hij naar het volle scherm gaat. Uit
# vm/styles/vm.css: .bucky-vm-backdrop 80, .bucky-vm-shell.is-expanded 90,
# body.vm-focus-active .arcade-vm-bay 95.
VM_HOOGSTE = 95


def controleer_volgorde(page):
    """De hero moet boven alles staan wat de VM kan opzetten.

    Dit is de eigenschap die er echt toe doet: zolang hij klopt KAN de kaart
    niet onder de VM vallen, ongeacht in welke toestand de VM staat.
    """
    return page.evaluate("""() => {
      const lees = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const z = getComputedStyle(el).zIndex;
        return z === 'auto' ? null : Number(z);
      };
      return {hero: lees('.arcade-hero'), nav: lees('.arcade-nav')};
    }""")


def main():
    mislukt = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for naam, w, h in MATEN:
            ctx = browser.new_context(viewport={"width": w, "height": h})
            page = ctx.new_page()
            page.goto(f"{BASIS}/arcade.html", wait_until="domcontentloaded")
            page.wait_for_timeout(4200)

            # Scroll tot de kaart vastzet en de VM in beeld staat.
            page.evaluate("""() => {
              const vm = document.querySelector('#the-vm');
              if (vm) window.scrollTo(0, vm.offsetTop + 150);
            }""")
            page.wait_for_timeout(700)

            # En zet de VM in de toestand waarin het twee keer is misgegaan:
            # volledig scherm, met de backdrop erover.
            page.evaluate("""() => {
              document.body.classList.add('vm-focus-active');
              const shell = document.querySelector('.bucky-vm-shell');
              if (shell) { shell.classList.remove('is-embedded'); shell.classList.add('is-expanded'); }
              const bd = document.querySelector('.bucky-vm-backdrop');
              if (bd) { bd.classList.add('is-visible'); bd.style.opacity = '1'; bd.style.pointerEvents = 'auto'; }
            }""")
            page.wait_for_timeout(800)

            volgorde = controleer_volgorde(page)
            hero = volgorde.get("hero")
            if hero is None or hero <= VM_HOOGSTE:
                print(f"  {naam:<8} FOUT .arcade-hero staat op {hero}, niet boven "
                      f"de {VM_HOOGSTE} die de VM opzet")
                mislukt.append(f"{naam} (volgorde)")
            elif volgorde.get("nav") is not None and volgorde["nav"] <= hero:
                print(f"  {naam:<8} FOUT de navigatie ({volgorde['nav']}) ligt onder "
                      f"de hero ({hero}); het menu is dan niet klikbaar")
                mislukt.append(f"{naam} (nav)")

            uit = meet(page)
            if uit.get("fout"):
                print(f"  {naam:<8} OVERGESLAGEN: {uit['fout']}")
            elif all(p == "KAART" for p in uit["raak"]):
                print(f"  {naam:<8} OK   de kaart ligt bovenop, ook met de VM op vol scherm")
            else:
                print(f"  {naam:<8} FOUT de kaart gaat eronder: {uit['raak']}")
                mislukt.append(naam)
            ctx.close()
        browser.close()

    if mislukt:
        print(f"\nDe spelerskaart verdwijnt onder de VM op: {', '.join(mislukt)}")
        print("Kijk naar de z-index van .arcade-hero in arcade.css: die bepaalt")
        print("wat de vastgezette kaart waard is, niet de 78 op de kaart zelf.")
        return 1
    print("\nDe kaart ligt op elke maat bovenop.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
