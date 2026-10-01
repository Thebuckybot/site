"""De regels en het meldbeleid op buckybot.app (ronde 22, deel C, DSA, 1-10-2026).

rules.html is het gepubliceerde deel: de gedragsregels, hoe je meldt, wat er
daarna gebeurt en het contactpunt. Of de tekst klopt met de code, bewaakt
backend/tests/test_regels_zichtbaar.py; deze test bewaakt dat hij te vinden is en
dat elke link op de pagina ergens heen gaat.

DRAAIEN:  python -m pytest tests/test_regels_pagina.py
"""
from __future__ import annotations

import pathlib
import re

SITE = pathlib.Path(__file__).resolve().parent.parent


def _lees(naam):
    return (SITE / naam).read_text(encoding="utf-8")


def test_elke_link_in_de_inhoud_wijst_naar_een_kop_die_bestaat():
    pagina = _lees("rules.html")
    ankers = set(re.findall(r'id="([^"]+)"', pagina))
    for doel in re.findall(r'href="#([^"]+)"', pagina):
        assert doel in ankers, doel


def test_de_regels_zijn_te_vinden_vanuit_de_voorwaarden_het_contact_en_de_voet():
    assert 'href="rules.html"' in _lees("tos.html")
    assert 'href="rules.html#reporting"' in _lees("contact.html")
    assert 'id="reporting"' in _lees("rules.html")
    for naam in ("tos.html", "privacy.html", "contact.html", "cookie.html", "rules.html"):
        assert '<a href="rules.html">Community rules</a>' in _lees(naam), naam


def test_de_pagina_noemt_een_contactpunt_en_de_weg_naar_een_herbeoordeling():
    pagina = _lees("rules.html")
    assert 'id="contact"' in pagina and "discord.gg/" in pagina
    assert 'id="review"' in pagina and "out-of-court" in pagina
