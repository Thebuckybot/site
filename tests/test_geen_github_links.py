"""Geen link meer naar de oude kopie op thebuckybot.github.io (13-10-2026).

De site staat op buckybot.app. De oude projectpagina stuurt wel door (301),
maar een canonical of og:url die daarheen wijst, laat Discord en zoekmachines
het oude adres tonen en delen. Zie ook bucky1.0/tests/test_site_links.py voor
de knoppen van de bot.

DRAAIEN:  python -m pytest tests/test_geen_github_links.py
"""
from __future__ import annotations

import pathlib
import re

SITE = pathlib.Path(__file__).resolve().parent.parent
OVERSLAAN = {"node_modules", ".git", "tests", "docs"}


def test_geen_github_io_link_in_de_site():
    gevonden = []
    for pad in SITE.rglob("*"):
        if pad.suffix not in (".html", ".js", ".json", ".css", ".xml", ".txt", ".webmanifest"):
            continue
        if OVERSLAAN & set(pad.relative_to(SITE).parts):
            continue
        for nr, regel in enumerate(pad.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if re.search(r"thebuckybot\.github\.io", regel, re.I):
                gevonden.append(f"{pad.relative_to(SITE)}:{nr}")
    assert gevonden == [], gevonden


def test_de_voorpagina_noemt_buckybot_app_als_adres():
    kop = (SITE / "index.html").read_text(encoding="utf-8").split("</head>")[0]
    assert '<link rel="canonical" href="https://buckybot.app/" />' in kop
    assert '<meta property="og:url" content="https://buckybot.app/" />' in kop
    for beeld in re.findall(r'(?:og:image(?::secure_url)?|twitter:image)" content="([^"]+)"', kop):
        assert beeld.startswith("https://buckybot.app/"), beeld
