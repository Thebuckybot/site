"""De linkvoorvertoning (OG-tags): een lage banner die bestaat en klopt met de tags.

Waarom: de oude afbeelding was 736x552 en rees in Discord hoog op. De vraag was
een lage banner. Deze test houdt de verhouding laag, de afmetingen in de tags
gelijk aan het echte bestand, en de twee voorpagina's op dezelfde afbeelding.
"""

from __future__ import annotations

import os
import re
import struct

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGINAS = ("index.html", os.path.join("v2", "index.html"))


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


def test_beide_voorpaginas_wijzen_naar_dezelfde_lage_banner():
    urls = {_meta(_lees(p), "og:image") for p in PAGINAS}
    assert len(urls) == 1
    url = urls.pop()
    assert url.startswith("https://buckybot.app/pics/og/")


def test_de_banner_bestaat_en_is_laag_en_de_tags_kloppen():
    html = _lees("index.html")
    url = _meta(html, "og:image")
    pad = os.path.join(SITE, url.replace("https://buckybot.app/", "").replace("/", os.sep))
    assert os.path.exists(pad), pad
    w, h = _jpeg_afmetingen(pad)
    assert (str(w), str(h)) == (_meta(html, "og:image:width"), _meta(html, "og:image:height"))
    assert w / h >= 2.5, f"{w}x{h} is niet laag"
    # Discord haalt tot 8 MB; ruim eronder blijft de voorvertoning snel.
    assert os.path.getsize(pad) < 300 * 1024


def test_groot_formaat_kaart_en_twitter_wijst_naar_dezelfde_afbeelding():
    for p in PAGINAS:
        html = _lees(p)
        assert _meta(html, "twitter:card") == "summary_large_image"
        assert _meta(html, "twitter:image") == _meta(html, "og:image")
