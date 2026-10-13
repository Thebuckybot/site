"""WCAG-AA voor de voorpagina v2, gerekend op de tokens (deel A1).

De site had nog geen contrasttest; de app wel (app/src/__tests__/contrast.test.tsx).
Deze doet voor v2 wat die voor de app doet: elke kleur die als TEKST op een
vlak staat, haalt 4,5:1 (3:1 voor grote tekst), en elke streek die iets
betekent (een icoon, een vinkje, een crest) 3:1. De tabel hieronder is de
plek waar een nieuw paar bij moet: een tekstkleur die in v2.css als `color:`
wordt gebruikt maar hier niet staat, laat de test falen.

En drie dingen die geen contrast zijn maar wel "hetzelfde merk":
  * het rood is EXACT het actierood van de app (#FF465C), niet een tweede rood;
  * de orgkleuren zijn die uit org_config.json (Discord, bot en app);
  * de lucht van de hero is de echte hoekkleur van het beeld.

De gerenderde pagina (wat er werkelijk op welk vlak staat) toetst
test_v2_pagina.py in een browser; deze test is de snelle, statische helft.
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest

SITE = pathlib.Path(__file__).resolve().parent.parent
WORTEL = SITE.parent
CSS = SITE / "v2" / "css" / "v2.css"


def tokens() -> dict[str, str]:
    tekst = CSS.read_text(encoding="utf-8")
    blok = re.search(r"^\.v2 \{(.*?)^\}", tekst, re.S | re.M).group(1)
    return {naam: waarde.upper() for naam, waarde in
            re.findall(r"--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\b", blok)}


def _lin(c: int) -> float:
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminantie(hexkleur: str) -> float:
    h = hexkleur.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a: str, b: str) -> float:
    x, y = sorted((luminantie(a), luminantie(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)


LICHT = ("canvas", "surface", "panel", "sky")
DONKER = ("dark-bg", "dark-surface", "dark-raised")

#: (voorgrond, achtergrond, minimum, waar)
PAREN: list[tuple[str, str, float, str]] = []
for vlak in LICHT:
    PAREN += [
        ("ink", vlak, 4.5, "lopende tekst, koppen"),
        ("ink-dim", vlak, 4.5, "uitleg, labels, de stats"),
        ("signal-text", vlak, 4.5, "rode tekst: 'A universe.', etiketten"),
        ("null-text", vlak, 4.5, "orgnaam Null Division"),
        ("vanta-text", vlak, 4.5, "orgnaam Vanta"),
        ("aether-text", vlak, 4.5, "orgnaam Aether"),
        ("cytek-text", vlak, 4.5, "orgnaam CyTek"),
        ("null-mark", vlak, 3.0, "crest Null Division"),
        ("vanta-mark", vlak, 3.0, "crest Vanta"),
        ("aether-mark", vlak, 3.0, "crest Aether"),
        ("cytek-mark", vlak, 3.0, "crest CyTek"),
        ("game", vlak, 3.0, "het arcade-icoon"),
    ]
for vlak in DONKER:
    PAREN += [
        ("dark-ink", vlak, 4.5, "tekst in de donkere sectie"),
        ("dark-dim", vlak, 4.5, "uitleg in de donkere sectie"),
        ("signal", vlak, 4.5, "rood etiket en vinkjes in de donkere sectie"),
    ]
PAREN += [
    ("signal-ink", "signal", 4.5, "label op de rode knop"),
    ("canvas", "ink", 4.5, "de skiplink (licht op inkt)"),
    ("signal", "surface", 3.0, "rode iconen en de live-stip op wit"),
]


#: De orgpanelen (deel E, v2/organisations.html). Hun kleuren staan per org in
#: `.v2 .op-<org>` en niet bij de tokens, dus worden ze per org nagerekend.
#: (voorgrond, achtergrond, minimum, waar); een naam zonder "op-" is een token.
ORG_PAREN: list[tuple[str, str, float, str]] = [
    ("op-glow", "op-bg", 4.5, "motto en etiketten in het paneel"),
    ("op-mark", "op-bg", 3.0, "crest en kader in het paneel"),
    ("dark-ink", "op-bg", 4.5, "naam en lore in het paneel"),
    ("dark-dim", "op-bg", 4.5, "filosofie, security, ledental"),
]
ORGS = ("null", "vanta", "aether", "cytek")


def _org_kleuren(org: str) -> dict[str, str]:
    tekst = CSS.read_text(encoding="utf-8")
    blok = re.search(rf"^\.v2 \.op-{org} \{{(.*?)^\}}", tekst, re.S | re.M).group(1)
    eigen = {n: w.upper() for n, w in re.findall(r"--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\b", blok)}
    return {**tokens(), **eigen}


@pytest.mark.parametrize("org", ORGS)
@pytest.mark.parametrize("voor,achter,minimum,waar", ORG_PAREN,
                         ids=[f"{v}-op-{a}" for v, a, _, _ in ORG_PAREN])
def test_het_orgpaneel_haalt_aa(org, voor, achter, minimum, waar):
    k = _org_kleuren(org)
    ratio = contrast(k[voor], k[achter])
    assert ratio >= minimum, f"{org}: {voor} {k[voor]} op {achter} {k[achter]}: {ratio:.2f}:1 < {minimum} ({waar})"


@pytest.mark.parametrize("voor,achter,minimum,waar", PAREN,
                         ids=[f"{v}-op-{a}" for v, a, _, _ in PAREN])
def test_het_paar_haalt_aa(voor, achter, minimum, waar):
    t = tokens()
    ratio = contrast(t[voor], t[achter])
    assert ratio >= minimum, f"{voor} {t[voor]} op {achter} {t[achter]}: {ratio:.2f}:1 < {minimum} ({waar})"


def test_elke_tekstkleur_in_de_css_staat_in_de_tabel():
    """Een tekstkleur die nergens is nagerekend, is een gok.

    `color: var(--x)` in v2.css moet als voorgrond in PAREN staan. Zo kan er
    geen kleur bijkomen zonder dat iemand hier opschrijft waar hij op staat.
    """
    css = CSS.read_text(encoding="utf-8")
    gebruikt = set(re.findall(r"(?<![-\w])color:\s*var\(--([a-z0-9-]+)\)", css))
    in_tabel = {v for v, _, _, _ in PAREN} | {v for v, _, _, _ in ORG_PAREN}
    assert gebruikt, "geen enkele color: var(--...) gevonden; dan meet deze test niets"
    assert gebruikt <= in_tabel, f"niet nagerekend: {sorted(gebruikt - in_tabel)}"


def test_er_staan_geen_losse_hexkleuren_als_tekstkleur():
    """Een tekstkleur buiten de tokens om ontloopt de tabel hierboven."""
    css = CSS.read_text(encoding="utf-8")
    los = re.findall(r"(?<![-\w])color:\s*(#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\))", css)
    assert los == [], los


# --------------------------------------------------------------------------- #
# Hetzelfde merk
# --------------------------------------------------------------------------- #
def test_het_rood_is_exact_het_merkrood():
    assert tokens()["signal"] == "#FF465C"


def test_het_rood_is_ook_het_rood_van_de_app():
    """Niet een getal dat toevallig klopt: hetzelfde als in de app zelf."""
    app = WORTEL / "app" / "src" / "theme" / "tokens.ts"
    if not app.exists():
        pytest.skip("app/ staat niet naast site/ in deze checkout")
    bron = app.read_text(encoding="utf-8")
    donker = re.search(r"dark:\s*\{(.*?)\n  \}", bron, re.S).group(1)
    assert re.search(r'acfill:\s*"([^"]+)"', donker).group(1).upper() == tokens()["signal"]
    licht = re.search(r"light:\s*\{(.*?)\n  \}", bron, re.S).group(1)
    assert re.search(r'\bac:\s*"([^"]+)"', licht).group(1).upper() == tokens()["signal-text"]


def test_de_orgkleuren_zijn_die_van_org_config():
    pad = WORTEL / "bucky1.0" / "cogs" / "data" / "currency" / "datacurrency" / "organizations" / "org_config.json"
    if not pad.exists():
        pytest.skip("de bot-boom staat niet naast site/ in deze checkout")
    thema = json.loads(pad.read_text(encoding="utf-8"))["theme"]
    kleur = {slug: "#" + blok["color"][2:].upper() for slug, blok in thema.items()
             if not slug.startswith("_")}
    t = tokens()
    assert t["cytek"] == kleur["cytek"]
    assert t["null"] == kleur["nulldiv"]
    assert t["aether"] == kleur["aether"]
    assert t["vanta"] == kleur["vanta"]


def test_de_lucht_is_de_hoekkleur_van_het_beeld():
    pil = pytest.importorskip("PIL.Image")
    beeld = pil.open(SITE / "assets" / "images" / "hero" / "bucky-hero-island.png").convert("RGB")
    r, g, b = beeld.getpixel((0, 0))
    assert tokens()["sky"] == f"#{r:02X}{g:02X}{b:02X}"


def test_de_rekenregel_zelf():
    """Bekende waarden uit de WCAG-voorbeelden en uit de app."""
    assert round(contrast("#FFFFFF", "#000000"), 2) == 21.0
    assert round(contrast("#FFFFFF", "#FF465C"), 2) == 3.34      # de app noemt 3,34:1
    assert round(contrast("#0E0D10", "#FF465C"), 1) == 5.8       # en 5,8:1
