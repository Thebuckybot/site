"""Open Water op het scherm: bediening, geluid, aan wal, binnen, kisten, duiken.

WAT HIER WEL EN NIET IN ZIT
De MEETKUNDE van de wereld staat niet hier maar in tests/test_boot_wereld.js:
of de ligplaats naast de steiger ligt, of elk huis op begaanbaar land staat, of
elke kist onder water bereikbaar is vanaf de oppervlakte. Dat zijn sommen, die
worden exact gecontroleerd, en die falen nooit toevallig.

Hier staat wat je alleen in een BROWSER kunt vaststellen: of de bediening op het
speelveld ligt, of de knoppen aanraakbaar zijn, of het geluid echt uit staat tot
iemand erom vraagt, of reduced motion de tekenlus stillegt, en of je de
verschillende toestanden van het spel ook echt kunt bereiken en verlaten.

HOE DIT IS OPGEBOUWD, EN WAAROM
Eerst was dit één lange reis in één sessie: varen, aanmeren, aan wal, een huis
in, een kist open, naar buiten, en dan duiken. Die viel steeds op een ander been
om - drie runs achter elkaar gaven drie verschillende fouten - en elke reparatie
verplaatste de broosheid naar het volgende been. De oorzaak was de OPZET en niet
de afstanden: als elk been afhangt van waar het vorige eindigde, is de kans dat
alles klopt het product van zeven kansen.

Nu heeft elk hoofdstuk zijn EIGEN sessie en zijn eigen kortste route. Wat
exact is, is OF iets gelukt is, en dat zegt het spel zelf in zijn statusregel.
Daar wordt op gestuurd.

DE TIJD VAN HET SPEL IS EEN NEPKLOK (sinds 29 september 2026)
Tot dan hield de test de joystick "600 ms" vast in ECHTE tijd. Hoeveel frames
een drukke machine in 600 ms tekent, verschilt per run, dus de boot kwam elke
keer ergens anders uit, en elke run viel op een ander hoofdstuk om: aanmeren,
meubels, duiken of de hut. Ook op een schone HEAD. Twee herkansingen per
hoofdstuk maakten dat minder vaak rood, niet minder willekeurig.

Nu staat de klok van de pagina stil (`page.clock`, zie `nieuwe_pagina`), en
krijgt het spel alleen tijd via `wacht()`. Dat is `clock.run_for`: de tekenlus
draait dan precies ms/16 frames van 16 ms, hoe druk de machine ook is. Het spel
zelf heeft geen toeval in zijn beweging (Math.random alleen in de ruis van het
geluid), dus dezelfde invoer geeft dezelfde reis.

De invoer moet dan wel AANGEKOMEN zijn voordat de tijd loopt. Een sleep over
de stick komt pas bij het volgende echte frame van de browser aan, en de
nepklok maakt geen echte frames. Daarom wacht `stick()` op het BEWIJS dat de
sleep er is (de knop van de stick staat uit het midden) voordat hij tijd
geeft, en na het loslaten op de knop die terugveert. Zo wacht de test op
gebeurtenissen en niet op milliseconden. Precies dat miste de eerste poging met
een nepklok op 28 september, en toen viel de stickcontrole in twee van de zes
runs om.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_boot_scherm.py

    Met beelden erbij:  OPENWATER_PREVIEW=<map> python tests/test_boot_scherm.py
"""

import os
import pathlib
import sys

# De uitvoer moet UTF-8 zijn, ook door een pipe heen. Windows zet stdout dan op
# cp1252, en dan valt deze test om op het notenteken van de geluidsknop - een
# crash in de RAPPORTAGE die eruitziet als een crash in het spel.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright   # noqa: E402

BASIS = "http://127.0.0.1:8899"

# Beelden uit dezelfde run als de test. Hiernaast stond een los previewscript
# dat dezelfde route nog eens aflegde; dat liep uit de pas zodra de test zijn
# route verbeterde, en vond het huis niet meer dat de test wel vond. Het script
# dat het goed doet mag de beelden maken.
PREVIEW = os.environ.get("OPENWATER_PREVIEW")


def leg_vast(page, naam):
    if not PREVIEW:
        return
    pad = pathlib.Path(PREVIEW)
    pad.mkdir(parents=True, exist_ok=True)
    page.locator("#mg-boat").screenshot(path=str(pad / f"preview_{naam}.png"))
    print(f"       beeld: preview_{naam}.png")


# --- de klok -------------------------------------------------------------

# 1 januari 2026, 12:00 UTC. Welk moment maakt niet uit, als het maar vast is.
KLOK_START = 1_767_268_800_000


def nieuwe_pagina(browser, **opties):
    """Een verse sessie waarin de tijd stilstaat tot de test hem geeft.

    `pause_at` staat vóór de eerste `goto`: Playwright zet de klok ook in elk
    nieuw document, dus de arcade laadt al met een stilstaande klok.
    """
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, **opties)
    ctx.clock.install(time=KLOK_START)
    page = ctx.new_page()
    page.clock.pause_at(KLOK_START + 1000)
    return ctx, page


def wacht(page, ms):
    """Geeft het spel `ms` milliseconden, los van hoe snel de machine is."""
    page.clock.run_for(ms)


def wacht_op(page, js, echt_ms=5000):
    """Wacht in ECHTE tijd tot `js` waar is, zonder de nepklok te verzetten.

    Voor wat de browser zelf aflevert, zoals een sleep die bij het volgende
    frame aankomt. Geeft True terug als het gebeurde.
    """
    for _ in range(max(1, echt_ms // 20)):
        if page.evaluate(js):
            return True
        page.wait_for_timeout(20)
    return bool(page.evaluate(js))


STICK_VAST = "() => document.querySelector('.mg-stick').classList.contains('is-actief')"
KNOP_VERSCHOVEN = """() => {
  const t = document.querySelector('.mg-stick-knob').style.transform;
  return !!t && !t.includes('translate(0px, 0px)');
}"""
KNOP_IN_RUST = """() => {
  const s = document.querySelector('.mg-stick');
  const t = document.querySelector('.mg-stick-knob').style.transform;
  return !s.classList.contains('is-actief') && (!t || t.includes('translate(0px, 0px)'));
}"""


def pak_de_stick(page):
    """Muis omlaag op het midden van de stick, tot de stick zegt dat hij vastzit.

    DE PAGINA VERSPRINGT IN ECHTE TIJD. Op 29 september kwam in twee van tien
    runs een pointerdown niet bij de stick aan. De diagnose hieronder liet zien
    waarom: tussen meten en klikken schoof het spel 366 px omlaag (de klik viel
    op het canvas), en een andere keer lag de stick onder de rand van het
    venster (y 1034 bij een venster van 1000; op dat punt lag niets). Iets boven
    het spel krijgt later inhoud, wanneer een netwerkaanroep terugkomt, en dat
    wacht niet op de nepklok. Dus: eerst in beeld scrollen, zoals een mens doet,
    dan pas meten.

    Het spel heeft geen last van een mislukte greep: er loopt geen speltijd
    zolang de stick niet vastzit, en een klik naast de stick valt op het
    canvas, dat er alleen focus van krijgt. Lukt het toch niet, dan zegt de
    NB-regel wat er op dat punt lag.
    """
    for poging in range(3):
        page.locator(".mg-stick").scroll_into_view_if_needed()
        s = page.locator(".mg-stick").bounding_box()
        cx, cy = s["x"] + s["width"] / 2, s["y"] + s["height"] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        if wacht_op(page, STICK_VAST, 2000):
            return cx, cy
        page.mouse.up()
        daar = page.evaluate("""([x, y]) => {
          const e = document.elementFromPoint(x, y);
          const r = document.querySelector('.mg-stick').getBoundingClientRect();
          return (e ? (e.className || e.tagName) : 'niets') + ' ; stick nu op '
            + [r.x, r.y, r.width, r.height].map(Math.round).join(',');
        }""", [cx, cy])
        print(f"       NB  de stick zat niet vast na pointerdown op ({cx:.0f}, {cy:.0f}): "
              f"{daar} (poging {poging + 1})")
    raise AssertionError("de stick is in drie pogingen niet vast te pakken")


# --- gereedschap ---------------------------------------------------------

def start_spel(page):
    """Laadt de arcade en start het bootspel; wacht tot de bediening er staat."""
    page.goto(f"{BASIS}/arcade.html", wait_until="domcontentloaded")
    page.wait_for_selector("#mg-boat", timeout=30000)
    # De opening van de arcade (luiken en een fade) loopt op setTimeout en
    # duurt ruim 3,5 s. Op een stilstaande klok gaat hij anders nooit weg.
    wacht(page, 4500)
    knop = page.locator('.mg-btn[data-game="boat"]')
    if not knop.count():
        return False
    knop.scroll_into_view_if_needed()
    knop.click()
    try:
        page.wait_for_selector(".mg-stick", timeout=30000)
    except Exception:
        return False
    wacht(page, 500)
    page.locator("#mg-boat").click()
    return True


def stick(page, dx, dy, ms):
    """Trekt de joystick een kant op, houdt hem precies `ms` vast, en laat los.

    Houdt de tijd pas vast als de sleep is AANGEKOMEN, en gaat pas verder als
    de stick weer in rust is. Komt een sleep niet aan, dan is dat een fout en
    geen pech: dan faalt de test met die reden.

    EEN beweging, geen `steps=4`. Met vier tussenstappen gaf "de knop is
    verschoven" al groen na de eerste, en druppelden de andere drie binnen
    terwijl de nepklok liep: de boot kreeg dan een paar frames een andere
    richting, en de reis verschilde per run (gemeten met een vingerafdruk van
    het canvas, 29-9-2026). Met één beweging is verschoven ook: op zijn plek.
    """
    cx, cy = pak_de_stick(page)
    page.mouse.move(cx + dx, cy + dy)
    if not wacht_op(page, KNOP_VERSCHOVEN):
        page.mouse.up()
        raise AssertionError(f"de sleep over de stick kwam niet aan ({dx}, {dy})")
    wacht(page, ms)
    page.mouse.up()
    if not wacht_op(page, KNOP_IN_RUST):
        raise AssertionError("de stick veert na loslaten niet terug")


# De laatste statusregel die de test las, voor de foutmelding van een reis.
status_laatst = [""]


def status(page):
    status_laatst[0] = page.locator("#mg-boat-status").text_content() or ""
    return status_laatst[0]


def anker(page, ms=700):
    page.locator(".mg-knop-anker").click()
    wacht(page, ms)


def is_water(kleur):
    """Water is het enige dat blauw-overheersend is.

    Twee keer bijgesteld, allebei omdat de VRAAG verkeerd stond. Eerst werd er
    vergeleken met `KLEUR.land` binnen een speling van 26 per kanaal, en daar
    valt donker zeewater ook in - in het donker liggen groen en blauw dicht bij
    elkaar. Daarna vroeg de test "staat hij op gras", terwijl Bucky naast de
    steiger aan wal komt en de helft van wat om hem heen ligt dus plank is.
    """
    r, g, b = kleur
    return b > g + 6 and b > r + 6


def grond_rond_het_midden(page):
    """De kleuren net naast het midden; de camera houdt de speler daar."""
    return page.evaluate("""() => {
      const c = document.getElementById('mg-boat');
      const ctx = c.getContext('2d');
      const dpr = c.width / c.getBoundingClientRect().width;
      const mx = c.width / 2, my = c.height / 2;
      return [[46, 0], [-46, 0], [0, 46], [0, -46]].map(([dx, dy]) => {
        const d = ctx.getImageData(Math.round(mx + dx * dpr),
                                   Math.round(my + dy * dpr), 1, 1).data;
        return [d[0], d[1], d[2]];
      });
    }""")


def meer_aan(page, pogingen=45):
    """Vaart naar de steiger van The Mainland en meert aan.

    STUURT OP WAT HET SPEL ZEGT, en niet op afgepaste afstanden. Dat laatste
    heeft vier versies lang niet gewerkt: optrekken, uitrollen, de afstand tot
    de ligplaats en het aanmeerbereik zijn vier onzekerheden, en elke keer dat
    er ergens een getal veranderde viel het om.

    De regel is bovendien "doorvaren TENZIJ er reden is om te stoppen", en niet
    "varen bij deze ene melding". Die witte lijst was een keer te kort - de
    geluidstest liet "Sound off." in de statusregel staan, en toen voer de boot
    vijfenveertig pogingen lang geen meter zonder dat er iets stuk was.
    """
    zoekkant = 1
    for _ in range(pogingen):
        st = status(page)
        if "Moored at" in st:
            return True
        if "scraped" in st:
            # Op de kust beland: los, en dan een stuk LANGS de kust. Nog eens
            # recht op dezelfde rots af varen helpt niet.
            stick(page, -44, -10, 600)
            stick(page, 8, 44 * zoekkant, 900)
            zoekkant = -zoekkant
        elif "Too fast" not in st:
            stick(page, 45, 8, 350)
        anker(page, 600)
    return "Moored at" in status(page)


# --- de hoofdstukken -----------------------------------------------------

def hoofdstuk_bediening(browser, mislukt):
    """Maat, plaatsing, aanraakbaarheid en geluid. Geen reis, dus geen kansen."""
    ctx, page = nieuwe_pagina(browser)
    fouten = []
    page.on("pageerror", lambda e: fouten.append(str(e)[:200]))
    page.add_init_script("""
      window.__audioGebouwd = 0;
      const O = window.AudioContext || window.webkitAudioContext;
      if (O) {
        const W = function (...a) { window.__audioGebouwd++; return new O(...a); };
        W.prototype = O.prototype;
        window.AudioContext = W;
        window.webkitAudioContext = W;
      }
    """)
    if not start_spel(page):
        print("  FOUT het bootspel start niet")
        mislukt.append("starten")
        ctx.close()
        return

    breedte = page.locator("#mg-boat").evaluate(
        "c => Math.round(c.getBoundingClientRect().width)")
    if breedte < 420:
        # Een eerdere ronde stond op 260px: een open wereld door een kijkgaatje.
        print(f"  FOUT het canvas is maar {breedte}px breed")
        mislukt.append("canvasmaat")
    else:
        print(f"  OK   het canvas is {breedte}px breed")

    plaatsing = page.evaluate("""() => {
      const c = document.getElementById('mg-boat').getBoundingClientRect();
      const stick = document.querySelector('.mg-stick');
      if (!stick) return {geenStick: true};
      const uit = [];
      for (const el of [stick, ...document.querySelectorAll('.mg-knop')]) {
        const r = el.getBoundingClientRect();
        uit.push({
          naam: (el.getAttribute('aria-label') || el.className).slice(0, 26),
          binnen: r.top >= c.top - 2 && r.bottom <= c.bottom + 2
               && r.left >= c.left - 2 && r.right <= c.right + 2,
          maat: [Math.round(r.width), Math.round(r.height)],
        });
      }
      return {uit};
    }""")
    if plaatsing.get("geenStick"):
        print("  FOUT er is geen joystick")
        mislukt.append("geen joystick")
    else:
        buiten = [d["naam"] for d in plaatsing["uit"] if not d["binnen"]]
        klein = [(d["naam"], d["maat"]) for d in plaatsing["uit"]
                 if d["maat"][0] < 44 or d["maat"][1] < 44]
        if buiten:
            print(f"  FOUT bediening buiten het speelveld: {buiten}")
            mislukt.append("bediening eronder")
        else:
            print(f"  OK   alle {len(plaatsing['uit'])} bedieningsdelen liggen "
                  "op het speelveld")
        if klein:
            # WCAG 2.5.8: een raakdoel is minstens 44 bij 44.
            print(f"  FOUT onder 44px: {klein}")
            mislukt.append("aanraakmaat")
        else:
            print("  OK   alles haalt 44 bij 44")

    # EERST BEWEGEN, DAN TERUGVEREN. Twee stappen, want anders zegt een lege
    # transform hetzelfde als een teruggeveerde: een knop die nooit is
    # aangeraakt staat ook in het midden. Deze test meldde een keer "veert niet
    # terug" terwijl de sleep helemaal niet was aangekomen.
    #
    # Beide stappen wachten op de gebeurtenis, tot 5 s echte tijd, en niet een
    # vast aantal milliseconden: een sleep komt pas bij het volgende frame van
    # de browser aan. Met een vaste 260 ms en een nepklok viel deze controle op
    # 28 september in twee van de zes runs om, terwijl de stick gewoon werkte.
    knob = "() => document.querySelector('.mg-stick-knob').style.transform"
    cx, cy = pak_de_stick(page)
    page.mouse.move(cx + 40, cy)
    wacht_op(page, KNOP_VERSCHOVEN)
    bewogen = page.evaluate(knob)
    page.mouse.up()
    if not bewogen or "translate(0px, 0px)" in bewogen:
        print(f"  FOUT de stick beweegt niet bij slepen ({bewogen!r})")
        mislukt.append("stick beweegt niet")
    else:
        wacht_op(page, KNOP_IN_RUST)
        rust = page.evaluate(knob)
        if "translate(0px, 0px)" not in rust:
            print(f"  FOUT de stick veert niet terug ({rust!r})")
            mislukt.append("stick veert niet terug")
        else:
            print(f"  OK   de stick beweegt ({bewogen}) en veert terug")

    gebouwd = page.evaluate("() => window.__audioGebouwd")
    knop = page.locator(".mg-knop-geluid")
    stand = knop.first.get_attribute("aria-pressed")
    tekst = (knop.first.text_content() or "").strip()
    if stand != "false" or "OFF" not in tekst.upper():
        print("  FOUT het geluid staat niet uit bij het starten")
        mislukt.append("geluid staat aan")
    elif gebouwd != 0:
        # Standaard uit is meer dan een vlaggetje: er hoort geen audio-apparaat
        # geopend te worden voordat iemand erom vraagt.
        print("  FOUT er is een AudioContext gebouwd zonder toestemming")
        mislukt.append("audio zonder toestemming")
    else:
        print("  OK   geluid uit, en geen AudioContext gebouwd")
    knop.first.click()
    wacht(page, 500)
    if knop.first.get_attribute("aria-pressed") != "true":
        print("  FOUT de geluidsknop gaat niet aan")
        mislukt.append("geluidsknop dood")
    else:
        print("  OK   de geluidsknop gaat aan en zegt dat in tekst")

    if fouten:
        print(f"  FOUT scriptfouten: {fouten[:2]}")
        mislukt.append("scriptfout")
    ctx.close()


def hoofdstuk_aan_wal(browser, mislukt):
    """Aanmeren, aan wal stappen, en niet het water in kunnen lopen."""
    ctx, page = nieuwe_pagina(browser)
    try:
        if not start_spel(page) or not meer_aan(page):
            return False
        print(f"  {status(page).strip()}")
        leg_vast(page, "aanmeren")

        if sum(1 for k in grond_rond_het_midden(page) if is_water(k)) >= 3:
            print("  FOUT hij staat na het aanmeren in het water")
            mislukt.append("aan wal")
            return True

        # Vier seconden dezelfde kant op is met zekerheid tot voorbij de kust,
        # als er niets tegenhoudt: lopen gaat 118 eenheden per seconde.
        stick(page, 0, 46, 4200)
        wacht(page, 400)
        kleuren = grond_rond_het_midden(page)
        if sum(1 for k in kleuren if is_water(k)) >= 3:
            print(f"  FOUT Bucky is het water in gelopen ({kleuren})")
            mislukt.append("rand houdt niet")
        else:
            print("  OK   de kust houdt hem tegen")
        return True
    finally:
        ctx.close()


def hoofdstuk_binnen(browser, mislukt):
    """Een huis in, tegen een meubel aan, een kist open, en via de deur eruit."""
    ctx, page = nieuwe_pagina(browser)
    try:
        if not start_spel(page) or not meer_aan(page):
            return False

        # Er staat een hut op ongeveer honderd eenheden van waar je aan wal
        # stapt. Rondom zoeken is daar genoeg voor; een afgepaste richting niet,
        # want waar je precies aan wal komt hangt af van hoe je hebt aangelegd.
        binnen = False
        for kant in [(38, 22), (44, 0), (20, 40), (44, -20), (0, 44), (-30, 30)]:
            for _ in range(4):
                stick(page, kant[0], kant[1], 600)
                anker(page, 1200)
                if "Inside" in status(page):
                    binnen = True
                    break
            if binnen:
                break
        if not binnen:
            return False
        print(f"  {status(page).strip()}")
        leg_vast(page, "interieur")

        # Tegen het bed aan lopen, linksboven. Je mag er niet doorheen.
        stick(page, -40, -30, 2000)
        wacht(page, 300)
        if "Inside" not in status(page):
            print(f"  FOUT lopen tegen een meubel bracht hem de kamer uit "
                  f"({status(page)!r})")
            mislukt.append("meubelbotsing")
            return True
        print("  OK   meubels houden hem tegen")

        # De kist staat tegen de linkerwand. Een muur volgen is stabieler dan
        # losse richtingen proberen: dat zette hem klem in de hoek.
        gevonden = False
        for kant in [(-44, 0), (0, 44), (0, -44), (10, 44)]:
            for _ in range(7):
                stick(page, kant[0], kant[1], 450)
                anker(page, 700)
                if "Found:" in status(page):
                    gevonden = True
                    break
            if gevonden:
                break
        if not gevonden:
            return False
        print(f"  OK   {status(page).strip()}")
        leg_vast(page, "kist")

        page.locator(".mg-knop-tas").click()
        wacht(page, 600)
        if "Your finds:" not in status(page):
            print(f"  FOUT de tas meldt de inhoud niet ({status(page)!r})")
            mislukt.append("tas")
        else:
            print(f"  OK   {status(page).strip()}")
            leg_vast(page, "inventory")

        # EN NIETS ERVAN VERLAAT DIT SPEL.
        opslag = page.evaluate("""() => {
          const uit = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith("openwater.")) uit[k] = localStorage.getItem(k);
          }
          return uit;
        }""")
        if "openwater.inventory.v1" not in opslag:
            print("  FOUT de vondst wordt niet bewaard")
            mislukt.append("niet bewaard")
        elif any(w in str(opslag).lower() for w in ["shard", "coin", "xp", "reward"]):
            print("  FOUT er staat iets in de inventory dat naar de economie verwijst")
            mislukt.append("economie in de inventory")
        else:
            print(f"  OK   de vondst blijft in dit spel: {opslag}")
        page.locator(".mg-knop-tas").click()
        wacht(page, 400)

        # Ver van de deur kom je er niet uit. WELKE melding je krijgt maakt niet
        # uit - het anker doet wat er op die plek te doen valt - maar naar
        # buiten gaan hoort er niet bij te zitten.
        stick(page, 0, -44, 1500)
        anker(page, 900)
        if "Back outside" in status(page):
            print("  FOUT je kunt buiten de deur om naar buiten")
            mislukt.append("deur omzeild")
        else:
            print("  OK   ver van de deur kom je er niet uit")

        # De deur zit ALTIJD in de onderste muur: eerst naar beneden, dan langs
        # die muur vegen. Een kamer heeft een vorm en die kun je gebruiken.
        def buiten_nu():
            # Twee bewijzen: "Back outside" verschijnt pas na de overgang, en
            # "Walk back to the boat" bestaat alleen buiten.
            st = status(page)
            return "Back outside" in st or "Walk back to the boat" in st

        stick(page, 0, 44, 1600)
        anker(page, 1100)
        buiten = buiten_nu()
        if not buiten:
            for kant in (44, -44):
                for _ in range(7):
                    stick(page, kant, 20, 500)
                    anker(page, 1000)
                    if buiten_nu():
                        buiten = True
                        break
                if buiten:
                    break
        if not buiten:
            return False
        print("  OK   en via de deur kom je weer buiten")
        return True
    finally:
        ctx.close()


def hoofdstuk_duiken(browser, mislukt):
    """Duiken, een kist onder water, en zonder lucht boven komen zonder verlies."""
    ctx, page = nieuwe_pagina(browser)
    try:
        if not start_spel(page):
            return False

        # Er ligt een duikplek pal onder het startpunt.
        anker(page, 1500)
        if "Diving at" not in status(page):
            return False
        print(f"  {status(page).strip()}")
        leg_vast(page, "duiken")

        # ONDER WATER STUURT DE TEST MET HET TOETSENBORD, en dat is geen
        # gemakzucht maar noodzaak.
        #
        # Zwemmen heeft drijfvermogen: laat je los, dan kom je omhoog. Met de
        # muis kun je niet tegelijk de stick vasthouden EN op het anker
        # drukken - er is maar één muisaanwijzer - dus elke poging om een kist
        # te openen begon met loslaten, en dan was hij alweer een stuk omhoog
        # gedreven. De zoektocht kwam zo nooit bij de bodem.
        #
        # De pijltjestoetsen voeden hetzelfde bedieningsmodel als de stick (zie
        # `werkRichtingBij` in boat.js), dus dit test dezelfde weg naar de
        # spellogica - en meteen ook dat het toetsenbord werkt, wat een eis is.
        # OOK DE ACTIE GAAT VIA HET TOETSENBORD, en dat is het sluitstuk.
        #
        # Op de ankerKNOP klikken werkte niet samen met sturen op toetsen: een
        # klik verplaatst de focus naar die knop, dus de pijltjes daarna kwamen
        # niet meer bij het spel aan - en het canvas wist bij focusverlies ook
        # nog eens de richting. Bucky dreef dan weer naar boven en de zoektocht
        # kwam nooit bij de bodem.
        #
        # Op het canvas is de spatiebalk dezelfde actie als het anker (zie
        # `TOETSEN` in boat.js). Alles op het toetsenbord houden betekent dus:
        # de focus blijft waar hij hoort, en dit hoofdstuk controleert meteen
        # dat het spel ook volledig met een toetsenbord te spelen is.
        page.locator("#mg-boat").click()

        def zwem(toets, ms):
            page.keyboard.down(toets)
            wacht(page, ms)
            page.keyboard.up(toets)

        # Eerst omlaag: je begint aan de oppervlakte, en daar betekent de actie
        # "klim terug in de boot" - meteen drukken haalt je er dus weer uit.
        page.keyboard.down("ArrowDown")
        wacht(page, 2200)

        gevonden = False
        for toets in ["ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight"]:
            for _ in range(8):
                # Omlaag blijft ingedrukt; opzij erbij, zodat hij langs de bodem
                # scheert in plaats van er tussendoor op te drijven.
                zwem(toets, 420)
                page.keyboard.press("Space")
                wacht(page, 500)
                if "Found:" in status(page):
                    gevonden = True
                    break
            if gevonden:
                break
        # ArrowDown blijft INGEDRUKT: hij gaat zo meteen door naar de
        # zuurstoftest, en tussendoor loslaten laat Bucky opdrijven.
        if not gevonden:
            page.keyboard.up("ArrowDown")
            return False
        print(f"  OK   {status(page).strip()}")
        leg_vast(page, "duikkist")

        # DE ZUURSTOF MOET OPRAKEN, EN DAN MAG ER NIETS VERDWIJNEN.
        #
        # De toets wordt INGEDRUKT GEHOUDEN. Met losse duwtjes drijft Bucky
        # tussendoor naar boven, en aan de oppervlakte vult de lucht met negen
        # per seconde bij tegen een verbruik van een per seconde - dan raakt hij
        # per constructie nooit zonder, en wacht de test op iets dat niet kan
        # gebeuren.
        voor = page.evaluate("() => localStorage.getItem('openwater.inventory.v1')")

        # FOCUS EN TOETS OPNIEUW ZETTEN. Er kan hierboven een schermafdruk zijn
        # genomen, en dat zet de ingedrukte toets niet gegarandeerd voort - met
        # previews aan viel deze meting om terwijl hij zonder previews groen
        # was. Een test die van een vlag afhangt die er niets mee te maken heeft,
        # is geen test.
        # DE TOETS WORDT ELKE RONDE OPNIEUW OPGEGEVEN.
        #
        # Eén keer indrukken en dan vijfenveertig seconden wachten werkte
        # meestal, maar niet altijd: er kan tussendoor een schermafdruk zijn
        # genomen of iets anders de focus hebben aangeraakt, en dan staat de
        # toets niet meer aan zonder dat er iets zichtbaar misgaat. Bucky drijft
        # dan omhoog, vult aan de oppervlakte met negen per seconde bij, en de
        # test wacht op iets dat niet meer kan gebeuren.
        #
        # Opnieuw indrukken is onschadelijk als hij al ingedrukt is, en herstelt
        # het als dat niet zo is.
        for _ in range(20):
            page.locator("#mg-boat").click()
            page.keyboard.down("ArrowDown")
            wacht(page, 2500)
            if "Out of air" in status(page):
                break
            page.keyboard.up("ArrowDown")
        page.keyboard.up("ArrowDown")
        na = page.evaluate("() => localStorage.getItem('openwater.inventory.v1')")

        if "Out of air" not in status(page):
            print(f"  FOUT de zuurstof raakt niet op ({status(page)!r})")
            mislukt.append("zuurstof")
        elif voor != na:
            print(f"  FOUT de vondsten veranderden: {voor} -> {na}")
            mislukt.append("voortgang gewist")
        else:
            print("  OK   zonder lucht kom je boven, en je houdt alles")
        return True
    finally:
        ctx.close()


def hoofdstuk_duikpak(browser, mislukt):
    """Het duikpak verlengt de lucht, en dat wordt aan het GEDRAG gemeten.

    Niet aan de meter: die staat op het canvas en is dus alleen als pixels te
    lezen. Wat wel te meten is, is wat het pak DOET - zonder pak ben je na
    zesentwintig seconden onder water zonder lucht, met pak niet. Dertig
    seconden onderdompelen is dus het hele bewijs.

    De inventory wordt vooraf in localStorage gezet in plaats van het pak eerst
    te gaan zoeken. Dat het pak in de goede kist zit, controleert de wereldtest
    exact; hier gaat het om het gevolg.
    """
    ctx, page = nieuwe_pagina(browser)
    try:
        page.add_init_script("""
          try {
            localStorage.setItem("openwater.inventory.v1",
                                 JSON.stringify({duikpak: 1}));
          } catch (e) { /* privémodus: dan meet deze test niets en faalt hij */ }
        """)
        if not start_spel(page):
            return False
        anker(page, 1500)
        if "Diving at" not in status(page):
            return False

        page.locator("#mg-boat").click()
        page.keyboard.down("ArrowDown")
        opgeraakt_na = None
        for sec in range(1, 33):
            wacht(page, 1000)
            if "Out of air" in status(page):
                opgeraakt_na = sec
                break
        page.keyboard.up("ArrowDown")

        if opgeraakt_na is not None:
            print(f"  FOUT met duikpak was de lucht al na {opgeraakt_na}s op; "
                  "zonder pak is dat 26s, dus het pak doet niets")
            mislukt.append("duikpak werkt niet")
        else:
            print("  OK   met duikpak houdt hij het langer dan 32s onder water uit")
        return True
    finally:
        ctx.close()


def hoofdstuk_reduced_motion(browser, mislukt):
    ctx, page = nieuwe_pagina(browser, reduced_motion="reduce")
    page.add_init_script("""
      window.__frames = 0;
      const r = window.requestAnimationFrame;
      window.requestAnimationFrame = function (cb) {
        window.__frames++;
        return r.call(window, cb);
      };
    """)
    start_spel(page)
    voor = page.evaluate("() => window.__frames")
    wacht(page, 2000)
    erbij = page.evaluate("() => window.__frames") - voor
    # Andere delen van de pagina mogen een frame vragen; wat NIET mag is een
    # doorlopende lus, en die zit rond de 120 in twee seconden.
    if erbij > 30:
        print(f"  FOUT de tekenlus loopt door bij reduced motion ({erbij} frames)")
        mislukt.append("reduced motion")
    else:
        print(f"  OK   de tekenlus ligt stil bij reduced motion ({erbij} frames)")
    ctx.close()


def reis(naam, functie, browser, mislukt):
    """Draait een hoofdstuk dat een REIS bevat, één keer.

    Tot 29 september kreeg een reis twee kansen, omdat hij van de snelheid van
    de machine afhing. Op de nepklok is dezelfde reis elke run dezelfde reis:
    een herkansing zou precies hetzelfde doen, en een echte regressie alleen
    twee keer zo lang laten duren.

    Een reis die zijn doel niet haalt (`False`) is een fout, net als een sleep
    over de stick die niet aankomt (`AssertionError` uit `stick()`). Dat is
    groen dat iets bewaakt, en rood dat iets zegt.
    """
    print(f"\n{naam}")
    try:
        gelukt = functie(browser, mislukt)
    except AssertionError as e:
        print(f"  FOUT {e}")
        mislukt.append(naam.lower())
        return
    if not gelukt:
        print(f"  FOUT {naam.lower()} is niet gelukt "
              f"(laatste status: {status_laatst[0].strip()!r})")
        mislukt.append(naam.lower())


def main():
    """Elk hoofdstuk in een EIGEN browser, die erna dichtgaat.

    LEES DIT VOORDAT JE EEN "Page crashed" ALS REGRESSIE BEHANDELT.

    Op een machine met weinig vrij geheugen valt deze suite halverwege om met
    `Page.wait_for_timeout: Page crashed`, en de plek WISSELT: de ene run het
    duiken, de andere het huisje. Gemeten op 3 september 2026, met ongeveer 2 GB
    vrij naast een draaiende bot, backend, Discord en een browser: elk hoofdstuk
    slaagt LOS (het huisje twee keer op rij, het duiken ook), en de volle run
    haalt het niet.

    Een crash die van plek wisselt is geen regressie in het spel maar
    geheugengebrek in de omgeving, en het is het vervelendste soort rood: het
    wijst elke keer een andere onschuldige aan. Faalt deze suite, draai dan
    eerst het hoofdstuk waar hij op viel apart, zoals hierboven beschreven; is
    dat groen, dan is het de machine.

    Een browser per hoofdstuk verlaagt de piek en is dus een verbetering, maar
    hij LOST HET NIET OP - dat is gemeten en niet aangenomen. De echte oplossing
    is geheugen vrijmaken voordat je hem draait.
    """
    mislukt = []
    with sync_playwright() as pw:
        def alleen(naam, functie, is_reis=False):
            browser = pw.chromium.launch()
            try:
                if is_reis:
                    reis(naam, functie, browser, mislukt)
                else:
                    print(f"\n{naam}")
                    functie(browser, mislukt)
            finally:
                browser.close()

        alleen("De bediening", hoofdstuk_bediening)
        alleen("Aanmeren en aan wal", hoofdstuk_aan_wal, is_reis=True)
        alleen("Binnen, kisten en de tas", hoofdstuk_binnen, is_reis=True)
        alleen("Duiken", hoofdstuk_duiken, is_reis=True)
        alleen("Het duikpak", hoofdstuk_duikpak, is_reis=True)
        alleen("Reduced motion", hoofdstuk_reduced_motion)

    if mislukt:
        print(f"\nMislukt: {', '.join(mislukt)}")
        return 1
    print("\nOpen Water staat goed op het scherm.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
