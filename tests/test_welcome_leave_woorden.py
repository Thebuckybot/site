"""Op de Goodbye-tab staat nergens "welcome" (14-10-2026).

WAT HIER WORDT VASTGEHOUDEN
1. EEN NIEUWE CONTAINER OP DE GOODBYE-TAB IS EEN AFSCHEID. De voorbeeldregel in
   een nieuw tekstblok zei "Welcome {user} to {server}!", ook op de leave-tab;
   dat is de tekst die iemand daarna verstuurt als hij hem laat staan. Dat geldt
   voor ELKE container met tekst erin, niet alleen de tekst-container.
2. DE PREVIEW NOEMT HET LID GEEN NIEUW LID. De voorbeeldwaarden van de
   placeholders zijn op deze tab die van iemand die weggaat.
3. HET WOORD "WELCOME" KOMT OP DEZE TAB NERGENS VOOR in de bouwer of de
   preview. Uitgezonderd zijn de keuzelijsten: daar staan kanaalnamen van de
   server zelf in (#welcome), en die zijn niet onze woorden.
4. DE WELCOME-TAB BLIJFT WEL OVER WELKOM GAAN. Zonder die helft zou deze test
   ook groen zijn als er helemaal geen tekst meer stond.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_welcome_leave_woorden.py
"""

import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright        # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
import welcome_previews as wp                           # noqa: E402

BASIS = os.environ.get("WELCOME_BASIS", "http://127.0.0.1:8899")
GID = wp.GID
FOUTEN = []
TAB = {"welcome": "Welcome", "leave": "Goodbye"}

# De containers met tekst erin, zoals ze op de knoppen staan.
TOEVOEGEN = ["+ Text", "+ Text with image", "+ Buttons"]

# Alle zichtbare tekst in de bouwer, zonder de keuzelijsten: daarin staan
# kanaalnamen van de server (#welcome) en dat is geen tekst van ons.
ZICHTBARE_TEKST = """
() => {
  const wortel = document.querySelector(".srv-welcome");
  if (!wortel) return null;
  const kopie = wortel.cloneNode(true);
  for (const n of kopie.querySelectorAll("select, option")) n.remove();
  const stukken = [kopie.innerText];
  // Wat er in een tekstvak STAAT is geen innerText, maar wel tekst die
  // iemand gaat versturen.
  for (const t of wortel.querySelectorAll("textarea, input[type=text], input:not([type])")) {
    stukken.push(t.value || "");
  }
  return stukken.join("\\n");
}
"""


def eis(voorwaarde, melding):
    print(("  ok   " if voorwaarde else "  FOUT ") + melding)
    if not voorwaarde:
        FOUTEN.append(melding)


def doc():
    """Leeg op één knoppenrij na: de containers komen in de test erbij."""
    return {"v": 1, "accent": 0x5865F2, "blocks": []}


def open_scherm(browser, soort):
    page = browser.new_page(viewport={"width": 1400, "height": 1100})
    page.add_init_script("localStorage.setItem('bucky_active_guild', JSON.stringify("
                         "{id: '%s', name: 'Bucky HQ', icon: null}));" % GID)
    fouten = []
    page.on("pageerror", lambda e: fouten.append(str(e)))
    wp.stub(page, wp.welcome_antwoord(soort, doc()))
    page.goto(f"{BASIS}/server.html?guild_id={GID}#welcome", wait_until="networkidle")
    page.wait_for_selector(".srv-welcome", timeout=15000)
    page.get_by_role("tab", name=TAB[soort]).click()
    page.wait_for_timeout(250)
    return page, fouten


def vul_de_bouwer(page):
    for knop in TOEVOEGEN:
        page.get_by_role("button", name=knop, exact=True).click()
        page.wait_for_timeout(150)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        print("=== leave (de tab Goodbye) ===")
        page, jsfouten = open_scherm(browser, "leave")
        vul_de_bouwer(page)

        print("1. Elke nieuwe container is een afscheid")
        inhoud = page.locator(".srv-block textarea").evaluate_all("ns => ns.map(n => n.value)")
        eis(len(inhoud) == 2, f"twee containers met tekst ({len(inhoud)})")
        for waarde in inhoud:
            eis("welcome" not in waarde.lower(), f"geen welkomsttekst in {waarde!r}")
        eis(any("left" in w.lower() or "bye" in w.lower() or "down to" in w.lower()
                for w in inhoud),
            f"het gaat over weggaan ({inhoud})")

        print("2. De preview noemt het lid geen nieuw lid")
        page.get_by_label("Text only", exact=True).check()
        page.get_by_label("Message text", exact=True).fill("Bye {user}, {displayname}")
        page.wait_for_timeout(250)
        los = page.locator(".dc-surface [data-part=text]").inner_text()
        eis("newmember" not in los.lower().replace(" ", ""),
            f"geen NewMember in de preview ({los!r})")
        eis("{" not in los, f"de placeholders zijn wel ingevuld ({los!r})")

        print("3. Het woord welcome komt nergens voor")
        page.get_by_label("Embed above text", exact=True).check()
        page.wait_for_timeout(250)
        tekst = page.evaluate(ZICHTBARE_TEKST)
        treffers = [r.strip() for r in (tekst or "").split("\n") if "welcome" in r.lower()]
        eis(not treffers, f"geen 'welcome' in de bouwer of de preview ({treffers[:4]})")

        print("4. Ook niet in een foutmelding")
        page.get_by_label("Text only", exact=True).check()
        page.get_by_label("Message text", exact=True).fill("")
        page.wait_for_timeout(250)
        fout = " ".join(page.locator("#srv-vorm-fout:not([hidden])").all_inner_texts())
        eis(fout and "welcome" not in fout.lower(), f"de melding is neutraal ({fout!r})")
        eis(not jsfouten, f"geen JS-fouten ({jsfouten})")
        page.close()

        print("\n=== welcome (de tegenproef) ===")
        page, jsfouten = open_scherm(browser, "welcome")
        vul_de_bouwer(page)
        inhoud = page.locator(".srv-block textarea").evaluate_all("ns => ns.map(n => n.value)")
        eis(any("welcome" in w.lower() for w in inhoud),
            f"hier gaat het wel over welkom ({inhoud})")
        page.get_by_label("Text only", exact=True).check()
        page.get_by_label("Message text", exact=True).fill("Hi {displayname}")
        page.wait_for_timeout(250)
        los = page.locator(".dc-surface [data-part=text]").inner_text()
        eis("New Member" in los, f"en het lid is hier een nieuw lid ({los!r})")
        eis(not jsfouten, f"geen JS-fouten ({jsfouten})")
        page.close()

        browser.close()

    if FOUTEN:
        print(f"\n{len(FOUTEN)} FOUT(EN)")
        sys.exit(1)
    print("\nalles ok")


if __name__ == "__main__":
    main()
