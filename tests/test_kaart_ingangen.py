"""De ingangen naar de kaarteditor (11-11-2026): "My cards" in het menu van het account-bolletje (v2 en v1), de tegel "Cards" op
het dashboard met een kleine preview, en "Customise" bij het profiel in de VM.

ALLE INGANGEN VERSCHIJNEN ALLEEN ALS /api/site/features `kaart_editor: true` MELDT. Met de vlag uit ziet niemand ze en gebeurt er
niets (ook geen preview-aanroep); mislukt de features-aanroep of is het antwoord onleesbaar, dan blijft alles verborgen (het
omgekeerde van features.js, dat bij twijfel toont). Nep-API, geen echte vlag."""
from __future__ import annotations

import json

import pytest

from test_v2_cards import (  # noqa: F401  (fixtures en nep-API van de paginatests)
    GEBRUIKER, NepApi, browser, preview_basis, server, tab, wacht_op)

AAN = (200, {"features": {"kaart_editor": True}, "site": {"version": "v2"}})
UIT = (200, {"features": {"kaart_editor": False}, "site": {"version": "v2"}})
ZONDER = (200, {"features": {"wordle": True}, "site": {"version": "v2"}})
STANDEN = {
    "uit": UIT, "zonder-sleutel": ZONDER, "serverfout": (500, {"error": "boem"}), "geen-json": (200, "geen json"),
    "netwerk": "netwerk", "tekst-true": (200, {"features": {"kaart_editor": "true"}}), "getal-1": (200, {"features": {"kaart_editor": 1}}),
    "features-geen-object": (200, {"features": ["kaart_editor"]}),
}
OPBOUW = {"accent": "#4BC987", "onderdelen": [
    {"type": "sectie", "tekst": "## Tommy's Profile\n-# Elite", "plaat": "avatar:discord"},
    {"type": "tekst", "tekst": "**Level:** 27"}, {"type": "scheiding"}]}


def _api(stand):
    api = NepApi()
    api.antwoorden[("GET", "/api/site/features")] = stand
    api.preview = preview_basis(opbouw=OPBOUW)
    api.gebruiker = dict(GEBRUIKER)
    return api


def _open_v2(t, pad):
    t.page.goto(f"{t.server}{pad}", wait_until="commit")
    t.page.wait_for_function("() => document.readyState === 'complete'", timeout=8000)
    t.page.wait_for_function("() => !document.querySelector('[data-auth-in]') || document.querySelector('.nav-user')?.hidden === false", timeout=8000)
    t.page.wait_for_timeout(500)


def _menu_open(t):
    t.page.locator(".nav-user-knop").click()
    t.page.wait_for_timeout(200)


def _ingang(t):
    return t.page.locator('.nav-user-menu a[href="cards.html"]')


# --------------------------------------------------------------------------- #
# v2: het menu van het account-bolletje
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("pad", ["/v2/index.html", "/v2/organisations.html", "/v2/cards.html"])
def test_met_de_vlag_aan_staat_my_cards_in_het_menu_van_het_account_bolletje(tab, pad):
    t = tab(_api(AAN), breedte=1280)
    _open_v2(t, pad)
    _menu_open(t)
    assert _ingang(t).is_visible() and _ingang(t).inner_text() == "My cards"
    assert _ingang(t).get_attribute("href") == "cards.html"


@pytest.mark.parametrize("stand", list(STANDEN))
def test_met_de_vlag_uit_of_een_mislukte_aanroep_staat_my_cards_er_niet(tab, stand):
    t = tab(_api(STANDEN[stand]), breedte=1280)
    _open_v2(t, "/v2/index.html")
    _menu_open(t)
    assert not _ingang(t).is_visible(), stand
    assert t.page.locator('[data-kaart-ingang]:visible').count() == 0, stand
    assert t.page.locator('.nav-user-menu li:visible a').all_inner_texts() == ["Dashboard"] or \
        "My cards" not in t.page.locator('.nav-user-menu').inner_text()


def test_my_cards_staat_ook_in_het_telefoonmenu_alleen_met_de_vlag_aan(tab):
    for stand, zichtbaar in ((AAN, True), (UIT, False)):
        t = tab(_api(stand), breedte=390, hoogte=800)
        _open_v2(t, "/v2/index.html")
        t.page.locator(".nav-toggle").click()
        t.page.wait_for_timeout(300)
        link = t.page.locator('.nav-sheet-extra a[href="cards.html"]')
        assert link.is_visible() == zichtbaar, stand


def test_uitgelogd_staat_my_cards_er_niet_ook_niet_met_de_vlag_aan(tab):
    api = _api(AAN)
    api.ingelogd = False
    t = tab(api, breedte=1280)
    t.page.goto(f"{t.server}/v2/index.html", wait_until="commit")
    t.page.wait_for_timeout(1200)
    assert t.page.locator('[data-kaart-ingang]:visible').count() == 0


def test_de_vlag_wordt_een_keer_opgehaald_per_pagina_en_er_gaat_niets_anders_mee(tab):
    api = _api(AAN)
    t = tab(api, breedte=1280)
    _open_v2(t, "/v2/index.html")
    assert api.aantal("GET", "/api/site/features") <= 3, "site-versie, features.js en kaart-ingang.js: een aanroep elk, niet meer"
    assert api.aantal("POST", "/api/v1/me/kaart/preview") == 0, "een nav-ingang vraagt geen preview"


# --------------------------------------------------------------------------- #
# v1: de balk van de oude pagina's (het dashboard)
# --------------------------------------------------------------------------- #
def _open_v1(t, pad="/dashboard.html"):
    t.page.goto(f"{t.server}{pad}", wait_until="commit")
    t.page.wait_for_function("() => document.readyState === 'complete'", timeout=8000)
    t.page.wait_for_timeout(1000)


def test_de_v1_balk_toont_my_cards_alleen_met_de_vlag_aan_en_ingelogd(tab):
    t = tab(_api(AAN), breedte=1280)
    _open_v1(t)
    link = t.page.locator("#kaart-link")
    assert link.is_visible() and link.get_attribute("href") == "v2/cards.html" and link.inner_text() == "My cards"
    for stand in ("uit", "netwerk", "serverfout", "tekst-true"):
        t2 = tab(_api(STANDEN[stand]), breedte=1280)
        _open_v1(t2)
        assert not t2.page.locator("#kaart-link").is_visible(), stand
    api = _api(AAN)
    api.ingelogd = False
    t3 = tab(api, breedte=1280)
    _open_v1(t3)
    assert t3.page.locator("#kaart-link").count() == 0, "uitgelogd bouwt de balk geen My cards"


# --------------------------------------------------------------------------- #
# De tegel op het dashboard
# --------------------------------------------------------------------------- #
def test_de_dashboardtegel_toont_een_kleine_preview_en_een_link_met_de_vlag_aan(tab):
    api = _api(AAN)
    t = tab(api, breedte=1280)
    _open_v1(t)
    tegel = t.page.locator("[data-kaart-tegel]")
    tegel.wait_for(state="visible", timeout=6000)
    wacht_op(t, "() => document.querySelector('[data-kaart-mini] .kc-dc')")
    assert t.page.locator("[data-kaart-mini] .kc-dc h3").inner_text() == "Tommy's Profile"
    assert t.page.locator("[data-kaart-tegel] a.btn").get_attribute("href") == "v2/cards.html"
    assert api.bodies("POST", "/api/v1/me/kaart/preview") == [{"kaart": "profiel", "wijzig": {}}]
    assert t.page.evaluate("() => window.__csp") == []


@pytest.mark.parametrize("stand", list(STANDEN))
def test_de_dashboardtegel_staat_er_niet_en_er_is_geen_previewaanroep_zonder_de_vlag(tab, stand):
    api = _api(STANDEN[stand])
    t = tab(api, breedte=1280)
    _open_v1(t)
    assert not t.page.locator("[data-kaart-tegel]").is_visible(), stand
    assert api.aantal("POST", "/api/v1/me/kaart/preview") == 0, stand


def test_de_tegel_gaat_dicht_als_je_niet_bent_ingelogd_en_blijft_met_een_link_als_de_preview_faalt(tab):
    api = _api(AAN)
    api.antwoorden[("POST", "/api/v1/me/kaart/preview")] = (401, {"ok": False, "error": {"code": "not_signed_in", "message": "x"}})
    t = tab(api, breedte=1280)
    _open_v1(t)
    assert not t.page.locator("[data-kaart-tegel]").is_visible()
    api2 = _api(AAN)
    api2.antwoorden[("POST", "/api/v1/me/kaart/preview")] = (429, {"ok": False, "error": {"code": "rate_limited", "message": "x"}, "retry_after": 3})
    t2 = tab(api2, breedte=1280)
    _open_v1(t2)
    assert t2.page.locator("[data-kaart-tegel]").is_visible() and t2.page.locator("[data-kaart-mini] .kc-dc").count() == 0
    assert t2.page.locator("[data-kaart-tegel] a.btn").is_visible()


def test_de_dashboardtegel_zonder_opbouw_van_een_oudere_bot_toont_alleen_de_link(tab):
    api = _api(AAN)
    api.preview = preview_basis()
    t = tab(api, breedte=1280)
    _open_v1(t)
    assert t.page.locator("[data-kaart-tegel]").is_visible() and t.page.locator("[data-kaart-mini] .kc-dc").count() == 0


def test_de_tegel_op_een_telefoon_geeft_geen_horizontale_scroll(tab):
    for breedte in (360, 390):
        t = tab(_api(AAN), breedte=breedte, hoogte=800)
        _open_v1(t)
        t.page.locator("[data-kaart-tegel]").wait_for(state="visible", timeout=6000)
        assert t.page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"), breedte
        assert t.page.locator("[data-kaart-tegel] a.btn").bounding_box()["height"] >= 43.5


def test_een_vijandige_naam_in_de_dashboardpreview_blijft_tekst(tab):
    hostiel = '<img src=x onerror="window.__pwn=1">'
    api = _api(AAN)
    api.preview = preview_basis(opbouw={"accent": "#4BC987", "onderdelen": [
        {"type": "sectie", "tekst": "## " + hostiel, "plaat": "avatar:discord"}, {"type": "tekst", "tekst": hostiel}]})
    api.gebruiker["global_name"] = hostiel
    t = tab(api, breedte=1280)
    _open_v1(t)
    wacht_op(t, "() => document.querySelector('[data-kaart-mini] .kc-dc')")
    assert "onerror" in t.page.locator("[data-kaart-mini]").inner_text()
    assert t.page.evaluate("() => window.__pwn") is None
    assert t.page.locator('[data-kaart-mini] img[src="x"], [data-kaart-mini] img[onerror]').count() == 0


# --------------------------------------------------------------------------- #
# De VM: "Customise" bij het profiel
# --------------------------------------------------------------------------- #
VM_MODULE = "/vm/apps/browser/sites/profile.js"


def _vm(t):
    t.page.goto(f"{t.server}/v2/cards.html", wait_until="commit")
    t.page.wait_for_function("() => document.readyState === 'complete'", timeout=8000)


def test_customise_staat_alleen_in_de_vm_als_de_vlag_aan_is(tab):
    t = tab(_api(AAN))
    _vm(t)
    uit = t.page.evaluate("""async (m) => {
      const mod = await import(m);
      const voor = mod.renderCosmeticsBlock({titles: [], achievements: []});
      mod.registerProfileSite({register() {}, registerMatcher() {}});
      for (let i = 0; i < 40 && !mod.kaartIngangHtml(); i++) await new Promise(r => setTimeout(r, 50));
      return [voor, mod.renderCosmeticsBlock({titles: [], achievements: []}), mod.kaartIngangHtml()];
    }""", VM_MODULE)
    assert "Customise" in uit[1] and "Customise" in uit[2] and 'href="v2/cards.html"' in uit[1]
    assert "Customise" not in uit[0], "voordat de vlag is gelezen staat er niets"


@pytest.mark.parametrize("stand", list(STANDEN))
def test_customise_staat_er_niet_in_de_vm_zonder_de_vlag_of_bij_een_mislukte_aanroep(tab, stand):
    t = tab(_api(STANDEN[stand]))
    _vm(t)
    uit = t.page.evaluate("""async (m) => {
      const mod = await import(m);
      mod.registerProfileSite({register() {}, registerMatcher() {}});
      await new Promise(r => setTimeout(r, 800));
      return [mod.kaartIngangHtml(), mod.renderCosmeticsBlock({titles: [], achievements: []})];
    }""", VM_MODULE)
    assert uit[0] == "" and "Customise" not in uit[1], stand


def test_de_ingangen_laden_niets_van_een_vreemde_host(tab):
    api = _api(AAN)
    t = tab(api, breedte=1280)
    _open_v1(t)
    _open_v2(t, "/v2/index.html")
    assert api.extern == []
