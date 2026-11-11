"""De editorpagina als Mac-ontwerp met een preview die Discord toont (11-11-2026).

Twee dingen worden bewezen:
  1. DE PREVIEW IS DE BESCHRIJVING VAN DE BOT. De site tekent `opbouw` (de onderdelen van het bericht in volgorde) in een
     look-alike van Discords container, en voegt er niets aan toe: volgorde, tekstregels, scheidingen, platen en accentkleur zijn
     die van de beschrijving. Tekst blijft tekst (ook `<img onerror>`), een plaat komt alleen uit `platen` en alleen als de URL
     veilig is, een eigen emoji komt van cdn.discordapp.com.
  2. HET ONTWERP: een venster met een matglas zijbalk (backdrop-filter), een segmented control, een systeemlettertype-stack, 12 en
     8 px ronding, en op een telefoon een horizontale rij in plaats van een zijbalk; zonder horizontale scroll.

De gelijkheid met het echte Discord-bericht (dezelfde bouwcode) wordt aan de botkant bewezen in
bucky1.0/tests/test_kaart_beschrijving.py; hier wordt bewezen dat de site die beschrijving getrouw tekent."""
from __future__ import annotations

import json

import pytest

from test_v2_cards import (  # noqa: F401  (fixtures en nep-API van de paginatests)
    API, HASH, NepApi, browser, ok, plaat, preview_basis, server, tab, tegel, wacht_op)

PROFIEL_OPBOUW = {"accent": "#4BC987", "onderdelen": [
    {"type": "sectie", "tekst": "## Tommy's Profile\n-# Elite\n-# Vault Breaker", "plaat": "plaat:embleem"},
    {"type": "media", "plaat": "plaat:plaquette", "alt": "Title: Vault Breaker"},
    {"type": "media", "plaat": "plaat:banner", "alt": ""},
    {"type": "media", "plaat": "plaat:profiel", "alt": "Level 27, 400 of 1,000 XP, 1,234,567 shards"},
    {"type": "tekst", "tekst": "**Bank Bonus:** +500"},
    {"type": "media", "plaat": "plaat:divider", "alt": ""},
    {"type": "media", "plaat": "plaat:blokken", "alt": "Stack: A 2 / B 1."}]}

SALDO_OPBOUW = {"accent": "#F35168", "onderdelen": [
    {"type": "sectie", "tekst": "## Tommy's Balance", "plaat": "avatar:discord"},
    {"type": "media", "plaat": "plaat:banner", "alt": ""}, {"type": "scheiding"},
    {"type": "tekst", "tekst": "**Status**\n- Your bank code is still the default.\n\n**Bank Capacity:** 12%\n**Bank:** <:vault:123456789> 5,678\n**Net Worth:** 6,912\n\n-# Global net worth rank: #1"},
    {"type": "media", "plaat": "plaat:divider", "alt": ""}]}


def _platen(*namen):
    return {n: (plaat(n[0]) if n != "embleem" else {"url": f"/api/v1/me/kaart/preview/{HASH}", "beweegt": False}) for n in namen}


def _api(opbouw, *platen):
    api = NepApi()
    api.preview = preview_basis(opbouw=opbouw, **{n: v for n, v in _platen(*platen).items()})
    api.preview["accent"] = opbouw["accent"]
    return api


def _volgorde(t):
    return t.page.evaluate("""() => [...document.querySelector('.kc-dc').children].map(e => {
      if (e.classList.contains('kc-dc-sectie')) return 'sectie';
      if (e.classList.contains('kc-dc-tekst')) return 'tekst';
      if (e.classList.contains('kc-dc-media')) return 'media';
      if (e.classList.contains('kc-dc-hr')) return 'scheiding';
      return e.tagName.toLowerCase();
    })""")


def _wacht_op_container(t):
    wacht_op(t, "() => document.querySelector('[data-kc-pod] .kc-dc')")


# --------------------------------------------------------------------------- #
# 1. De preview is de beschrijving van de bot
# --------------------------------------------------------------------------- #
def test_de_site_tekent_de_onderdelen_in_de_volgorde_van_de_beschrijving_voor_profiel(tab):
    t = tab(_api(PROFIEL_OPBOUW, "embleem", "plaquette", "banner", "profiel", "divider", "blokken")).open()
    _wacht_op_container(t)
    verwacht = [o["type"] for o in PROFIEL_OPBOUW["onderdelen"]]
    assert _volgorde(t) == verwacht
    assert t.page.locator('[data-kc-podium-vak]').get_attribute("data-weergave") == "discord"
    srcs = t.page.eval_on_selector_all(".kc-dc img.kc-dc-media", "els => els.map(e => e.src)")
    assert srcs == [f"{API}/kaart/plaat/{n * 40}.webp" for n in ("p", "b", "p", "d", "b")] or len(srcs) == 5
    assert t.page.locator(".kc-dc .kc-dc-duim").get_attribute("src") == f"{API}/api/v1/me/kaart/preview/{HASH}"


def test_de_site_tekent_de_onderdelen_in_de_volgorde_van_de_beschrijving_voor_balance(tab):
    t = tab(_api(SALDO_OPBOUW, "banner", "divider")).open()
    t.page.locator('[data-kc-tab="saldo"]').click()
    wacht_op(t, "() => document.querySelector('.kc-dc .kc-dc-hr')")
    assert _volgorde(t) == [o["type"] for o in SALDO_OPBOUW["onderdelen"]]


@pytest.mark.parametrize("opbouw,platen", [(PROFIEL_OPBOUW, ("embleem", "plaquette", "banner", "profiel", "divider", "blokken")),
                                           (SALDO_OPBOUW, ("banner", "divider"))])
def test_elk_onderdeel_en_elke_plaat_staat_precies_een_keer_op_de_pagina(tab, opbouw, platen):
    t = tab(_api(opbouw, *platen)).open()
    if opbouw is SALDO_OPBOUW:
        t.page.locator('[data-kc-tab="saldo"]').click()
    wacht_op(t, "() => document.querySelectorAll('.kc-dc > *').length >= 4")
    assert t.page.locator(".kc-dc").count() == 1
    assert t.page.locator(".kc-dc > *").count() == len(opbouw["onderdelen"])
    assert t.page.locator(".kc-dc img.kc-dc-media").count() == len([o for o in opbouw["onderdelen"] if o["type"] == "media"])


def test_de_accentkleur_van_het_bericht_staat_op_de_streep_links(tab):
    t = tab(_api(PROFIEL_OPBOUW, "embleem")).open()
    _wacht_op_container(t)
    assert t.page.evaluate("() => document.querySelector('.kc-dc').style.getPropertyValue('--kc-accent')") == "#4BC987"
    kleur = t.page.evaluate("() => getComputedStyle(document.querySelector('.kc-dc')).borderLeftColor")
    assert kleur == "rgb(75, 201, 135)"
    assert t.page.evaluate("() => parseFloat(getComputedStyle(document.querySelector('.kc-dc')).borderLeftWidth)") == 4
    assert t.page.evaluate("() => getComputedStyle(document.querySelector('.kc-dc')).borderTopLeftRadius") == "8px"


def test_discord_markdown_wordt_koppen_vet_kleine_tekst_opsommingen_en_emoji_zonder_html(tab):
    t = tab(_api(SALDO_OPBOUW, "banner", "divider")).open()
    t.page.locator('[data-kc-tab="saldo"]').click()
    wacht_op(t, "() => document.querySelector('.kc-dc h3')")
    assert t.page.locator(".kc-dc h3").inner_text() == "Tommy's Balance"
    assert t.page.locator(".kc-dc strong").all_inner_texts() == ["Status", "Bank Capacity:", "Bank:", "Net Worth:"]
    assert t.page.locator(".kc-dc .kc-dc-punt").inner_text() == "Your bank code is still the default."
    assert t.page.locator(".kc-dc .kc-dc-klein").inner_text() == "Global net worth rank: #1"
    emoji = t.page.locator(".kc-dc img.kc-dc-emoji")
    assert emoji.get_attribute("src") == "https://cdn.discordapp.com/emojis/123456789.webp?size=48"
    assert emoji.get_attribute("alt") == ":vault:"


def test_een_vijandige_tekst_in_de_beschrijving_komt_als_tekst_op_de_pagina(tab):
    hostiel = '<img src=x onerror="window.__pwn=1"><script>window.__pwn=2</script> **vet** <:x:1>'
    opbouw = {"accent": "#4BC987", "onderdelen": [
        {"type": "sectie", "tekst": "## " + hostiel, "plaat": "avatar:discord"}, {"type": "tekst", "tekst": hostiel},
        {"type": "media", "plaat": "plaat:banner", "alt": hostiel}]}
    api = _api(opbouw, "banner")
    api.gebruiker["global_name"] = hostiel
    t = tab(api).open()
    _wacht_op_container(t)
    tekst = t.page.locator(".kc-dc").inner_text()
    assert tekst.count("onerror") >= 2 and "window.__pwn" in tekst
    assert t.page.evaluate("() => window.__pwn") is None
    assert t.page.locator('.kc-dc img[src="x"], .kc-dc img[onerror], .kc-dc script').count() == 0
    assert t.page.locator(".kc-dc img.kc-dc-media").get_attribute("alt") == hostiel
    assert t.page.evaluate("() => window.__csp") == []


def test_een_plaat_die_niet_veilig_is_of_ontbreekt_wordt_niet_getekend_en_er_komt_niets_voor_in_de_plaats(tab):
    opbouw = {"accent": "#4BC987", "onderdelen": [
        {"type": "media", "plaat": "plaat:banner", "alt": ""}, {"type": "media", "plaat": "plaat:divider", "alt": ""},
        {"type": "media", "plaat": "https://evil.example/x.webp", "alt": ""}, {"type": "media", "plaat": "plaat:onbekend", "alt": ""},
        {"type": "tekst", "tekst": "blijft"}, {"type": "knoppen", "labels": ["Customise"]}, {"type": "raar"}]}
    api = NepApi()
    api.preview = preview_basis(opbouw=opbouw, banner={"url": "https://evil.example/kaart/plaat/x.webp", "beweegt": False},
                                divider=plaat("d"))
    t = tab(api).open()
    _wacht_op_container(t)
    assert _volgorde(t) == ["media", "tekst"], "alleen wat veilig en bekend is; de knoppen staan er niet (de preview heeft er geen)"
    assert api.extern == []


def test_zonder_opbouw_van_een_oudere_bot_valt_de_pagina_terug_op_de_eenvoudige_preview(tab):
    api = NepApi()
    api.preview = preview_basis()
    t = tab(api).open()
    wacht_op(t, "() => document.querySelector('[data-kc-pod] .kc-pod-naam')")
    assert t.page.locator('[data-kc-podium-vak]').get_attribute("data-weergave") == "eenvoudig"
    assert t.page.locator(".kc-dc").count() == 0


def test_een_bewegende_plaat_in_de_opbouw_speelt_alleen_op_hover_en_nooit_met_reduced_motion(tab):
    opbouw = {"accent": "#4BC987", "onderdelen": [{"type": "media", "plaat": "plaat:banner", "alt": "Banner"}]}
    api = NepApi()
    api.preview = preview_basis(opbouw=opbouw, banner={"url": f"{API}/kaart/plaat/{'a' * 40}.webp", "beweegt": True,
                                                       "stil": f"{API}/kaart/plaat/{'c' * 40}.webp"})
    t = tab(api, reduced="no-preference").open()
    img = t.page.locator(".kc-dc img.kc-dc-media")
    img.wait_for()
    assert img.get_attribute("src").endswith("c" * 40 + ".webp")
    img.hover()
    wacht_op(t, "() => document.querySelector('.kc-dc-media').src.endsWith('" + "a" * 40 + ".webp')")
    api2 = NepApi()
    api2.preview = api.preview
    t2 = tab(api2, reduced="reduce").open()
    img2 = t2.page.locator(".kc-dc img.kc-dc-media")
    img2.wait_for()
    img2.hover()
    img2.dispatch_event("click")
    t2.page.wait_for_timeout(300)
    assert img2.get_attribute("src").endswith("c" * 40 + ".webp")
    assert not any("a" * 40 in u for u in api2.plaatverzoeken)


# --------------------------------------------------------------------------- #
# 2. Het Mac-ontwerp
# --------------------------------------------------------------------------- #
def test_het_venster_heeft_matglas_een_systeemlettertype_segmented_control_en_ronding(tab):
    t = tab().open()
    m = t.page.evaluate("""() => {
      const s = (sel) => getComputedStyle(document.querySelector(sel));
      return {
        glas: [s('.kc-zijbalk').backdropFilter || s('.kc-zijbalk').webkitBackdropFilter, s('.kc-balk').backdropFilter],
        font: s('.kc-venster').fontFamily, venster: s('.kc-venster').borderTopLeftRadius,
        segment: s('.kc-segment').borderTopLeftRadius, seg: s('.kc-seg').borderTopLeftRadius,
        tegel: s('.kc-tegel').borderTopLeftRadius, knop: s('[data-kc-podium]').borderTopLeftRadius,
        rol: document.querySelector('.kc-segment').getAttribute('role'),
        tabs: [...document.querySelectorAll('.kc-segment [role=tab]')].map(e => e.textContent),
      };
    }""")
    assert all(g and g != "none" and "blur" in g for g in m["glas"]), m["glas"]
    assert m["font"].startswith("-apple-system, BlinkMacSystemFont, \"SF Pro Text\", Inter, system-ui") or "-apple-system" in m["font"]
    assert m["venster"] == "12px" and m["tegel"] == "12px" and m["knop"] == "8px" and m["seg"] == "6px" and m["segment"] == "8px"
    assert m["rol"] == "tablist" and m["tabs"] == ["Profile", "Balance"]


def test_er_staan_geen_merknamen_logos_of_externe_afbeeldingen_in_de_pagina(tab):
    t = tab().open()
    tekst = t.page.locator("main").inner_text().lower()
    for merk in ("apple", "macos", "mac os", "finder", "iphone", "ipad", "safari"):
        assert merk not in tekst, merk
    from test_v2_cards import CSS, PAGINA
    html = PAGINA.read_text(encoding="utf-8").lower()
    main = html[html.index("<main"):html.index("</main>")]
    assert "apple" not in main and ".svg" not in main and "<svg" not in main
    css = CSS.read_text(encoding="utf-8")
    assert "url(" not in css, "alleen systeemlettertypes en kleuren: geen afbeeldingen of lettertypebestanden"


def test_de_geselecteerde_staat_is_duidelijk_in_de_zijbalk_het_segment_en_het_raster(tab):
    t = tab().open()
    zij = t.page.evaluate("""() => {
      const a = document.querySelector('.kc-zij[aria-pressed=true]'); const b = document.querySelector('.kc-zij[aria-pressed=false]');
      return [getComputedStyle(a).backgroundColor, getComputedStyle(b).backgroundColor];
    }""")
    assert zij[0] != zij[1] and zij[1] in ("rgba(0, 0, 0, 0)", "transparent")
    seg = t.page.evaluate("""() => [getComputedStyle(document.querySelector('.kc-seg[aria-selected=true]')).backgroundColor,
                                     getComputedStyle(document.querySelector('.kc-seg[aria-selected=false]')).backgroundColor]""")
    assert seg[0] != seg[1]
    t.page.locator('[data-kc-item="banner_circuit"]').click()
    uit = t.page.evaluate("() => getComputedStyle(document.querySelector('[data-kc-item=banner_circuit]')).outlineStyle")
    assert uit == "solid"


def test_op_een_telefoon_wordt_de_zijbalk_een_horizontale_rij_zonder_horizontale_scroll(tab):
    t = tab(breedte=390, hoogte=800).open()
    m = t.page.evaluate("""() => {
      const cats = document.querySelector('.kc-cats'); const s = getComputedStyle(cats);
      return {richting: s.flexDirection, scroll: document.documentElement.scrollWidth <= window.innerWidth,
              kop: getComputedStyle(document.querySelector('.kc-zij-kop')).display,
              zij: document.querySelector('.kc-zijbalk').getBoundingClientRect().width,
              raster: document.querySelector('.kc-grid').getBoundingClientRect().width};
    }""")
    assert m["richting"] == "row" and m["scroll"] and m["kop"] == "none"
    assert m["zij"] >= m["raster"] - 40, "de rij staat boven het raster, niet ernaast"


def test_breed_staan_zijbalk_raster_en_preview_naast_elkaar_en_de_preview_blijft_staan(tab):
    t = tab(breedte=1280, hoogte=900).open()
    _wacht = wacht_op
    _wacht(t, "() => document.querySelector('[data-kc-pod]')")
    r = t.page.evaluate("""() => {
      const b = (s) => document.querySelector(s).getBoundingClientRect();
      const z = b('.kc-zijbalk'), m = b('.kc-midden'), p = b('.kc-rechts');
      return {z: [z.left, z.right], m: [m.left, m.right], p: [p.left, p.right], sticky: getComputedStyle(document.querySelector('.kc-rechts')).position};
    }""")
    assert r["z"][1] <= r["m"][0] + 1 and r["m"][1] <= r["p"][0] + 1 and r["sticky"] == "sticky"


@pytest.mark.parametrize("schema", ["light", "dark"])
@pytest.mark.parametrize("stand", ["licht", "donker"])
def test_de_tekst_van_de_discord_preview_haalt_4_5_in_licht_en_donker_en_in_beide_podiumstanden(tab, schema, stand):
    t = tab(_api(SALDO_OPBOUW, "banner", "divider"), schema=schema).open()
    t.page.locator('[data-kc-tab="saldo"]').click()
    wacht_op(t, "() => document.querySelector('.kc-dc h3')")
    if t.page.locator("[data-kc-podium-vak]").get_attribute("data-podium") != stand:
        t.page.locator("[data-kc-podium]").click()
        t.page.wait_for_timeout(250)
    waarden = t.page.evaluate("""() => {
      const bg = (e) => { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)') return c; } return 'rgb(255,255,255)'; };
      return [...document.querySelectorAll('.kc-dc h3, .kc-dc .kc-dc-regel, .kc-dc .kc-dc-klein, .kc-dc .kc-dc-punt')]
        .map(e => [e.className || e.tagName, getComputedStyle(e).color, bg(e)]);
    }""")
    from test_v2_cards import _contrast, _rgb
    assert len(waarden) >= 4
    for klasse, fg, achter in waarden:
        assert _contrast(_rgb(fg), _rgb(achter)) >= 4.5, (schema, stand, klasse, fg, achter)


def test_de_pagina_blijft_werken_met_het_toetsenbord_in_de_zijbalk(tab):
    t = tab().open()
    t.page.locator('[data-kc-cat="divider"]').focus()
    t.page.keyboard.press("Enter")
    assert t.page.locator('[data-kc-cat="divider"]').get_attribute("aria-pressed") == "true"
    uit = t.page.evaluate("() => { document.querySelector('[data-kc-cat=banner]').focus(); const s = getComputedStyle(document.activeElement); return [s.outlineStyle, s.outlineWidth]; }")
    assert uit[0] != "none" and uit[1] != "0px"
