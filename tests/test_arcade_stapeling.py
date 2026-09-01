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


def controleer_volgorde(page):
    """DE EIGENSCHAP DIE ER ECHT TOE DOET: de vastgezette kaart hangt direct
    onder <body> en heeft dus geen enkele ouder die hem kan klemmen.

    Dit verving het tellen van z-indexen, want dat bleek de verkeerde vraag.
    De kaart zat in VIER geneste stapelcontexten (.hero-left 6, .hero-content 2,
    .arcade-hero 100, #arcade-world 0), en de buitenste stond op 0 - dus geen
    enkel getal daarbinnen kon hem boven iets daarbuiten krijgen. Bovendien
    kreeg `.hero-left` bij het scrollen een inline transform, en een ouder met
    een transform wordt het containing block van een `position: fixed` kind.

    Zolang de ouder <body> is, bestaat die hele klasse problemen niet meer.
    """
    return page.evaluate("""() => {
      const kaart = document.querySelector('.player-hero-card');
      if (!kaart) return {fout: 'geen kaart'};
      const ouders = [];
      let e = kaart.parentElement;
      while (e && e !== document.documentElement) { ouders.push(e.tagName); e = e.parentElement; }
      // Elke ouder die een stapelcontext of containing block maakt.
      const boosdoeners = [];
      e = kaart.parentElement;
      while (e && e !== document.documentElement) {
        const s = getComputedStyle(e);
        if (s.transform !== 'none' || s.filter !== 'none' || s.perspective !== 'none'
            || (s.position !== 'static' && s.zIndex !== 'auto')) {
          boosdoeners.push(e.tagName + '.' + (e.className || '').toString().split(' ')[0]
                           + ' z=' + s.zIndex + (s.transform !== 'none' ? ' +transform' : ''));
        }
        e = e.parentElement;
      }
      return {ouder: kaart.parentElement.tagName, keten: ouders, boosdoeners};
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
            # Onder 700px zet de kaart bewust niet vast (zie arcade.css), dus
            # daar hoort hij juist wél in de hero te blijven staan.
            if w > 700:
                if volgorde.get("ouder") != "BODY":
                    print(f"  {naam:<8} FOUT de vastgezette kaart hangt onder "
                          f"{volgorde.get('ouder')} in plaats van BODY; "
                          f"klemmende ouders: {volgorde.get('boosdoeners')}")
                    mislukt.append(f"{naam} (ouder)")
                elif volgorde.get("boosdoeners"):
                    print(f"  {naam:<8} FOUT er zit alsnog een klemmende ouder "
                          f"tussen: {volgorde['boosdoeners']}")
                    mislukt.append(f"{naam} (context)")

            if w <= 700:
                # Onder 700px zet de kaart met opzet niet vast: op een telefoon
                # legde hij zich over de inhoud eronder. Dan is "ligt hij
                # bovenop" niet de vraag.
                print(f"  {naam:<8} OK   pint niet op deze breedte, met opzet")
                ctx.close()
                continue

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
        print("De vastgezette kaart hoort direct onder <body> te hangen. Zie")
        print("`zetVast` in js/arcade.js: een hoger getal binnen #arcade-world")
        print("(z-index 0) helpt niet, want die context klemt alles eronder.")
        return 1
    print("\nDe kaart ligt op elke maat bovenop.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
