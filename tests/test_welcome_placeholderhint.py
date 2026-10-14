"""De placeholder-hint bij het tekstvak van de welcome-bouwer (14-10-2026).

WAT HIER WORDT VASTGEHOUDEN, voor welcome EN leave (de tab "Goodbye"):
1. BIJ HET TEKSTVAK STAAT WELKE PLACEHOLDERS ER ZIJN. Niet alleen de zin
   "placeholders work here too": de namen zelf, zodat je ze niet hoeft te
   onthouden of beneden te gaan zoeken.
2. DE LIJST KOMT UIT HET ANTWOORD VAN DE API (`placeholders`, uit
   `welcome_layout.PLACEHOLDERS`) en is dus niet een tweede lijst die kan gaan
   afwijken. Hij staat op BEIDE tabs, want de set is één set: de bot vult voor
   welcome en leave dezelfde waarden in (`welcome_render.waarden_voor`).
3. EEN KLIK PLAKT HEM OP DE CURSORPLEK in het tekstvak - niet aan het eind, en
   niet in een ander veld dat eerder focus had.
4. TOEGANKELIJK: elke chip is een knop met een naam waarin de placeholder zelf
   staat, de rij heeft een eigen naam, de tekst haalt 4.5:1 contrast, en het
   aanraakdoel is minstens 24 px hoog.
5. OP EEN TELEFOON (390 px) staat hij er nog, en de pagina schuift niet zijwaarts.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_welcome_placeholderhint.py
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

# De hint hangt bij het tekstvak, niet in de kaart "Placeholders" onderaan.
HINT = "#srv-tekst-placeholders"

# Contrast: dezelfde som als in accessibility-review (WCAG 2.1, 1.4.3).
CONTRAST = """
(sel) => {
  const n = document.querySelector(sel);
  const lum = (c) => {
    const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map(Number)
      .map((v) => v / 255).map((v) => v <= 0.03928 ? v / 12.92
                                   : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // De achtergrond van de chip zelf is half doorzichtig; dan telt de kaart
  // eronder mee. Loop op tot er een niet-doorzichtige kleur staat.
  let bgNode = n, bg = null;
  while (bgNode) {
    const c = getComputedStyle(bgNode).backgroundColor;
    const a = c.match(/[\\d.]+/g);
    if (a && (a.length < 4 || Number(a[3]) === 1)) { bg = c; break; }
    bgNode = bgNode.parentElement;
  }
  const fg = getComputedStyle(n).color;
  const [a, b] = [lum(fg), lum(bg || "rgb(0,0,0)")].sort((x, y) => y - x);
  return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
}
"""


def eis(voorwaarde, melding):
    print(("  ok   " if voorwaarde else "  FOUT ") + melding)
    if not voorwaarde:
        FOUTEN.append(melding)


def doc():
    return {"v": 1, "accent": 0x5865F2, "mode": "text_embed", "text": "Hallo daar",
            "blocks": [{"type": "text", "content": "Card for {displayname}"}]}


def open_scherm(browser, soort, breedte=1400):
    page = browser.new_page(viewport={"width": breedte, "height": 1100})
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


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for soort in ("welcome", "leave"):
            print(f"\n=== {soort} ===")
            page, jsfouten = open_scherm(browser, soort)
            veld = page.get_by_label("Message text", exact=True)

            print("1. De hint staat bij het tekstvak")
            hint = page.locator(HINT)
            eis(hint.count() == 1 and hint.is_visible(), "de hint is er en is zichtbaar")
            # Bij het veld: dezelfde kaart, en niet verder dan 120 px eronder.
            afstand = page.evaluate(
                "(sel) => { const h = document.querySelector(sel);"
                " const v = document.querySelector(\"textarea[aria-label='Message text']\");"
                " if (!h || !v) return null;"
                " return Math.round(h.getBoundingClientRect().top"
                "                   - v.getBoundingClientRect().bottom); }", HINT)
            eis(afstand is not None and -5 <= afstand <= 120,
                f"hij staat bij het veld ({afstand} px eronder)")

            print("2. De namen komen uit het antwoord van de API")
            namen = page.locator(f"{HINT} .srv-chip").evaluate_all(
                "ns => ns.map(n => n.textContent)")
            eis(namen == ["{" + n + "}" for n in wp.PLACEHOLDERS],
                f"alle {len(wp.PLACEHOLDERS)} placeholders, in dezelfde volgorde ({namen})")

            print("3. Een klik plakt hem op de cursorplek")
            veld.fill("Hi , good to see you")
            veld.evaluate("n => { n.selectionStart = n.selectionEnd = 3; }")
            page.locator(f"{HINT} .srv-chip", has_text="{user}").first.click()
            page.wait_for_timeout(200)
            eis(veld.input_value() == "Hi {user}, good to see you",
                f"op de cursorplek geplakt ({veld.input_value()!r})")
            los = page.locator(".dc-surface [data-part=text]").inner_text()
            eis(los == "Hi @NewMember, good to see you" or "@" in los,
                f"de preview volgt ({los!r})")
            # NIET in het veld van een kaart-blok, ook niet als dat het laatst
            # aangeraakte veld was: de hint hangt aan DIT veld.
            kaartvak = page.locator(".srv-block[data-soort=text] textarea").first
            kaartvak.click()
            page.locator(f"{HINT} .srv-chip", has_text="{server}").first.click()
            page.wait_for_timeout(200)
            eis("{server}" in veld.input_value() and "{server}" not in kaartvak.input_value(),
                f"hij landt in het tekstvak, niet in de kaart ({kaartvak.input_value()!r})")

            print("4. Toegankelijk")
            rijnaam = page.locator(f"{HINT} [role=group]").evaluate(
                "n => { const id = n.getAttribute('aria-labelledby');"
                " return n.getAttribute('aria-label')"
                " || (id && document.getElementById(id) ? document.getElementById(id).textContent : null); }")
            eis(bool(rijnaam and rijnaam.strip()), f"de rij heeft een naam ({rijnaam!r})")
            eerste = page.locator(f"{HINT} .srv-chip").first
            naam = eerste.evaluate("n => n.getAttribute('aria-label') || n.textContent")
            eis("{user}" in naam, f"de naam van de chip bevat de placeholder ({naam!r})")
            eis(eerste.evaluate("n => n.tagName") == "BUTTON"
                and eerste.evaluate("n => n.tabIndex") >= 0,
                "het is een knop die met het toetsenbord te bereiken is")
            ratio = page.evaluate(CONTRAST, f"{HINT} .srv-chip")
            eis(ratio >= 4.5, f"contrast van de chiptekst is {ratio}:1 (minstens 4.5)")
            eis(not jsfouten, f"geen JS-fouten ({jsfouten})")
            page.close()

        print("\n=== op een telefoon (390 px) ===")
        page, jsfouten = open_scherm(browser, "welcome", breedte=390)
        eis(page.locator(HINT).is_visible(), "de hint staat er ook op 390 px")
        hoogte = page.locator(f"{HINT} .srv-chip").first.evaluate(
            "n => Math.round(n.getBoundingClientRect().height)")
        eis(hoogte >= 24, f"het aanraakdoel is {hoogte} px hoog (minstens 24)")
        breed = page.evaluate("() => [document.documentElement.scrollWidth,"
                              " document.documentElement.clientWidth]")
        eis(breed[0] <= breed[1] + 1, f"geen horizontale scroll ({breed})")
        eis(not jsfouten, f"geen JS-fouten ({jsfouten})")
        page.close()

        browser.close()

    if FOUTEN:
        print(f"\n{len(FOUTEN)} FOUT(EN)")
        sys.exit(1)
    print("\nalles ok")


if __name__ == "__main__":
    main()
