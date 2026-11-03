"""De linkvoorvertoning (OG- en Twitter-tags) op elke publieke pagina.

Geschiedenis: de oude afbeelding was 736x552 en rees in Discord hoog op; daarna
kwam een lage banner van 1200x400 op de twee voorpagina's. Sinds 4-11-2026 (vraag
van de eigenaar) is het de BuckyBot-banner op ALLE publieke pagina's:

  * og:image is de brede versie (1600x703, de verhouding van het origineel), die
    Discord en Slack tonen zonder te knippen;
  * twitter:image is een bijsnede van 1200x630 (1,91:1) met de mascotte en de tekst
    binnen het midden, voor wie op die verhouding knipt;
  * twitter:card is summary_large_image; breedte, hoogte en alt-tekst staan erbij
    en kloppen met de bestanden; beide ruim onder 500 KB;
  * og:title is de <title> van de pagina, og:description de meta description
    (een pagina zonder beschrijving krijgt er geen verzonnen bij);
  * geen enkele tag wijst buiten buckybot.app.
"""

from __future__ import annotations

import os
import re
import struct

import pytest

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGINAS = ["index.html", "arcade.html", "premium.html", "contact.html", "cookie.html", "privacy.html", "rules.html",
           "tos.html", "dashboard.html"] + [os.path.join("v2", f) for f in (
           "index.html", "contact.html", "cookie.html", "privacy.html", "rules.html", "tos.html", "organisations.html")]
BREED = "https://buckybot.app/pics/og/bucky-banner-1600x703.jpg"
SMAL = "https://buckybot.app/pics/og/bucky-banner-1200x630.jpg"


def _meta(html: str, prop: str) -> str | None:
    m = re.search(r'<meta (?:property|name)="' + re.escape(prop) + r'" content="([^"]*)"', html)
    return m.group(1) if m else None


def _jpeg_afmetingen(pad: str) -> tuple[int, int]:
    with open(pad, "rb") as fh:
        data = fh.read()
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        lengte = struct.unpack(">H", data[i + 2:i + 4])[0]
        i += 2 + lengte
    raise AssertionError("geen SOF-marker")


def _lees(pagina: str) -> str:
    with open(os.path.join(SITE, pagina), encoding="utf-8") as fh:
        return fh.read()


def _pad(url: str) -> str:
    return os.path.join(SITE, url.replace("https://buckybot.app/", "").replace("/", os.sep))


@pytest.mark.parametrize("pagina", PAGINAS)
def test_elke_publieke_pagina_draagt_de_banner(pagina):
    html = _lees(pagina)
    assert _meta(html, "og:image") == BREED
    assert _meta(html, "og:image:secure_url") == BREED
    assert (_meta(html, "og:image:width"), _meta(html, "og:image:height")) == ("1600", "703")
    assert _meta(html, "twitter:card") == "summary_large_image"
    assert _meta(html, "twitter:image") == SMAL
    alt = _meta(html, "og:image:alt")
    assert alt and "Bucky" in alt and alt == _meta(html, "twitter:image:alt")


@pytest.mark.parametrize("pagina", PAGINAS)
def test_titel_en_beschrijving_zijn_die_van_de_pagina(pagina):
    html = _lees(pagina)
    assert _meta(html, "og:title"), "geen og:title"
    beschrijving = _meta(html, "description")
    if pagina not in ("index.html", os.path.join("v2", "index.html")):
        # De voorpagina's hadden al eigen OG-teksten; de rest neemt ze letterlijk over.
        titel = re.search(r"<title>(.*?)</title>", html, re.S).group(1).strip()
        assert _meta(html, "og:title") == titel
        assert _meta(html, "og:description") == beschrijving


@pytest.mark.parametrize("pagina", PAGINAS)
def test_geen_tag_wijst_buiten_de_site(pagina):
    html = _lees(pagina)
    for m in re.finditer(r'<meta (?:property|name)="(?:og|twitter):[^"]*" content="(https?://[^"]*)"', html):
        assert m.group(1).startswith("https://buckybot.app/"), m.group(1)


@pytest.mark.parametrize("url,maat", [(BREED, (1600, 703)), (SMAL, (1200, 630))])
def test_de_bestanden_bestaan_kloppen_en_zijn_licht(url, maat):
    pad = _pad(url)
    assert os.path.exists(pad), pad
    assert _jpeg_afmetingen(pad) == maat
    assert maat[0] >= 1200
    assert os.path.getsize(pad) < 500 * 1024
