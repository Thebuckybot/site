"""Bewaakt dat er geen verminkte tekens of BOM in `site/` staan.

WAAROM DIT BESTAAT
De pijlen en het anker op de knoppen van het bootspel zijn als drie onleesbare
tekens in productie gegaan - een a met een dakje gevolgd door twee leestekens,
in plaats van het pictogram. De oorzaak was een PowerShell-bewerking:
`Set-Content -Encoding utf8` en `Out-File` lezen UTF-8-bytes, interpreteren ze
als cp1252 en schrijven dat weer als UTF-8 weg. Elk teken buiten ASCII komt er
dan dubbel gecodeerd uit, en er komt een BOM voor het bestand.

(De voorbeelden staan hier met opzet in woorden en niet als tekens: dit bestand
verbiedt precies dat patroon, dus het mag het zelf niet bevatten. De eerste
versie deed dat wel en sloeg op zijn eigen documentatie aan.)

WAAROM HET NIET IS OPGEVALLEN
Niets breekt ervan. `node --check` is tevreden, pytest is tevreden, de pagina
laadt. Alleen de tekst klopt niet, en dat zie je pas in de browser - of, zoals
hier, pas als een gebruiker het meldt.

En de reparatie die ik er de eerste keer op losliet was zelf fout: die zocht
alleen naar verminkte LETTERS met een accent. Die beginnen in UTF-8 met byte
C3 en worden dus een hoofdletter-A-met-tilde. Een pijl begint met byte E2 en
wordt een kleine-a-met-dakje - een heel ander startteken, dat de zoekopdracht
niet kende. Daarna telde ik hoe vaak dat ene startteken voorkwam, kreeg nul, en
noemde het opgelost: de controle bevestigde precies de aanname die fout was.

Vandaar dat deze test niet op een teken zoekt maar op het PATROON - elk
startteken uit het Latin-1 Supplement gevolgd door cp1252-leestekens - en dat
hij bovendien controleert of de bytes echt terug te draaien zijn. Zo kan hij
niet blind zijn voor het soort teken dat toevallig niet in het voorbeeld stond.

DRAAIEN:  python tests/test_tekencodering.py
"""

import pathlib
import re
import sys

SITE = pathlib.Path(__file__).resolve().parent.parent
EXTENSIES = {".js", ".py", ".css", ".html", ".md", ".json", ".txt", ".svg"}
OVERSLAAN = {"node_modules", ".git", "__pycache__", "venv", ".venv"}

# Een startteken uit het Latin-1 Supplement gevolgd door tekens uit het gebied
# waar cp1252 zijn leestekens heeft staan. Dat is hoe dubbel gecodeerde UTF-8
# er altijd uitziet, ongeacht welk teken er oorspronkelijk stond.
VERDACHT = re.compile(
    r"[Â-Ãâ-ã]"
    r"[-¿–—‘’“”†‡"
    r"€‚ƒ„…‰Š‹ŒŽ"
    r"ˆ™š›œžŸ˜]+"
)


def herstelbaar(stuk):
    """Wat er zou moeten staan, als dit inderdaad dubbel gecodeerd is."""
    try:
        terug = stuk.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None
    if "�" in terug or VERDACHT.search(terug):
        return None
    return terug


def main():
    kapot = []
    bommen = []
    bekeken = 0

    for pad in SITE.rglob("*"):
        if not pad.is_file() or pad.suffix.lower() not in EXTENSIES:
            continue
        if any(deel in OVERSLAAN for deel in pad.parts):
            continue
        ruw = pad.read_bytes()
        rel = pad.relative_to(SITE)

        if ruw[:3] == b"\xef\xbb\xbf":
            # Een BOM is op het web niet nodig en op sommige plekken schadelijk:
            # in een .js-module hoort hij niet, en voor een .css of .html kan
            # hij de eerste regel stukmaken.
            bommen.append(rel)
            ruw = ruw[3:]

        try:
            tekst = ruw.decode("utf-8")
        except UnicodeDecodeError:
            kapot.append((rel, "is geen geldige UTF-8", None))
            continue

        bekeken += 1
        for m in VERDACHT.finditer(tekst):
            zou_moeten = herstelbaar(m.group(0))
            if zou_moeten:
                regel = tekst[:m.start()].count("\n") + 1
                kapot.append((rel, f"regel {regel}: {m.group(0)!r}", zou_moeten))

    print(f"  {bekeken} bestanden bekeken")

    for rel in bommen:
        print(f"  FOUT BOM aan het begin van {rel}")
    for rel, waar, zou in kapot[:25]:
        extra = f" -> hoort {zou!r} te zijn" if zou else ""
        print(f"  FOUT {rel} {waar}{extra}")
    if len(kapot) > 25:
        print(f"  ... en nog {len(kapot) - 25}")

    if kapot or bommen:
        print("\nVerminkte tekst of een BOM gevonden.")
        print("Bijna altijd is de oorzaak een bewerking via PowerShell.")
        print("Repareer met Python: strip de BOM, en draai daarna")
        print("  re.sub(patroon, lambda m: m.group(0).encode('cp1252')")
        print("                              .decode('utf-8'), tekst)")
        print("Bewerk broncode niet met Set-Content of Out-File.")
        return 1

    print("\nGeen verminkte tekens en geen BOM.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
