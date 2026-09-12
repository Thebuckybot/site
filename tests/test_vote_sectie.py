"""De stemsectie, zoals een BEZOEKER hem ziet.

De serverhelft staat in `backend/tests/test_site_vote.py`: die bewaakt dat de
route dezelfde tabel geeft als de bot rolt. Dit bestand bewaakt de andere helft
- dat de sectie die tabel ook werkelijk op de pagina zet, en dat hij WEGBLIJFT
als er niets te tonen is.

WAAROM DIT NIET UIT DE HTML TE LEZEN IS
In `index.html` staat geen enkel bedrag. De sectie is een leeg skelet dat bij
het laden gevuld wordt, dus wat er in de HTML staat zegt niets over wat een
bezoeker ziet. Alleen een browser die de pagina echt draait kan dat vaststellen.
Het antwoord van de server wordt hier onderschept, zodat de test niet afhangt
van wat er op dit moment toevallig in `vote.json` staat.

DE VOLGORDE VAN DE ROUTES IS BELANGRIJK: de vangnetroute eerst, de specifieke
erna. Playwright past de LAATST geregistreerde route als eerste toe.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_vote_sectie.py
"""

import json
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright   # noqa: E402

BASIS = "http://127.0.0.1:8899"

#: Twee lijsten en drie beloningen: een span, een vast bedrag met een item, en
#: een rij die alleen een kist geeft. Dat zijn de drie vormen die de config mag
#: hebben, dus alle drie de rendervarianten zitten in één plaat.
ANTWOORD = {
    "cooldown_hours": 12,
    "sites": [
        {"key": "topgg", "name": "Top.gg", "url": "https://top.gg/bot/1/vote"},
        {"key": "dbl", "name": "Discord Bot List", "url": "https://discordbotlist.com/b/1/upvote"},
    ],
    "rewards": [
        {"key": "shard_drop", "name": "Shard drop", "chance": 0.26,
         "shards": {"min": 250000, "max": 400000}, "items": []},
        {"key": "banknotes", "name": "Banknote bundle", "chance": 0.18,
         "shards": {"min": 120000, "max": 120000},
         "items": [{"id": "banknote_chip", "label": "banknote chip", "amount": 5}]},
        {"key": "vault", "name": "Cache vault", "chance": 0.03, "shards": None,
         "items": [{"id": "coin_chest", "label": "coin chest", "amount": 1}]},
    ],
}


def open_met(page, vote=ANTWOORD, status=200, vlaggen=None):
    """Laadt de voorpagina met een verzonnen stemantwoord."""
    # eerst het vangnet: alles wat we niet nadoen krijgt een leeg antwoord in
    # plaats van een echte netwerkrondgang
    page.route("**/api/**", lambda r: r.fulfill(
        status=200, content_type="application/json", body="{}"))
    page.route("**/api/site/features", lambda r: r.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({"features": vlaggen if vlaggen is not None
                         else {"vote": True, "dashboard": True}})))

    def antwoord(route):
        if status != 200:
            route.fulfill(status=status, content_type="application/json",
                          body=json.dumps({"error": "off", "feature": "vote"}))
        else:
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps(vote))
    page.route("**/api/site/vote", antwoord)

    page.goto(f"{BASIS}/index.html", wait_until="domcontentloaded")
    page.wait_for_timeout(1600)


def stand(page):
    return page.evaluate("""() => {
      const el = document.getElementById("vote");
      if (!el) return {ontbreekt: true};
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        zichtbaar: r.width > 0 && r.height > 0 && s.display !== "none",
        verborgenAttribuut: el.hasAttribute("hidden"),
        knoppen: [...el.querySelectorAll(".vote-site")].map(
            (a) => ({tekst: a.textContent.trim(), href: a.getAttribute("href")})),
        rijen: [...el.querySelectorAll(".vote-row")].map((li) => ({
            kans: li.querySelector(".vote-chance").textContent.trim(),
            naam: li.querySelector(".vote-name").textContent.trim(),
            wat: li.querySelector(".vote-payout").textContent.trim(),
        })),
        tekst: el.innerText,
      };
    }""")


def zichtbare_kop(page):
    """Staat de kop van de sectie er werkelijk, of alleen in de DOM?

    DIT IS DE VAL WAAR DEZE SECTIE IN LIEP. `index.js` bouwt zijn
    scroll-animaties bij het laden, en toen stond de sectie nog op
    `display: none` omdat het antwoord van de server er nog niet was. De kop
    hield daardoor de begintoestand van de animatie: opacity 0, met twee
    panelen eronder en geen titel. Vandaar de verversing in `vote.js`.
    """
    page.evaluate("""() => document.getElementById("vote")
        .scrollIntoView({block: "center"})""")
    # POLLEN EN NIET EEN VASTE WACHTTIJD. De reveal is een CSS-transitie, en een
    # `wait_for_timeout(1200)` viel er precies middenin: opacity 0,89 op de
    # telefoon en 1,0 op de desktop, dus een test die wisselend faalt op iets
    # dat werkt. Dat is de ergste soort test.
    try:
        page.wait_for_function("""() => {
          const h = document.querySelector("#vote .section-head");
          if (!h) return false;
          const s = getComputedStyle(h);
          return Number(s.opacity) > 0.95 && s.visibility !== "hidden";
        }""", timeout=6000)
        return True
    except Exception:
        return False


def controleer(naam, voorwaarde, uitleg=""):
    print(("  OK   " if voorwaarde else "  FOUT ") + naam + (f"  -- {uitleg}" if uitleg and not voorwaarde else ""))
    return bool(voorwaarde)


def main():
    goed = True
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # --- de gewone situatie -------------------------------------------
        print("De sectie met twee lijsten en drie beloningen")
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        open_met(page)
        s = stand(page)
        goed &= controleer("de sectie is zichtbaar", s.get("zichtbaar"), str(s)[:200])
        goed &= controleer("het hidden-attribuut is weg", not s.get("verborgenAttribuut"))
        goed &= controleer("er staat een knop per lijst",
                           [k["tekst"] for k in s["knoppen"]] ==
                           ["Vote on Top.gg", "Vote on Discord Bot List"], str(s["knoppen"]))
        goed &= controleer("elke knop wijst naar https",
                           all(k["href"].startswith("https://") for k in s["knoppen"]))
        goed &= controleer("de kansen staan als procent",
                           [r["kans"] for r in s["rijen"]] == ["26%", "18%", "3%"],
                           str([r["kans"] for r in s["rijen"]]))
        goed &= controleer("een span leest als bereik",
                           s["rijen"][0]["wat"] == "250,000–400,000 shards",
                           s["rijen"][0]["wat"])
        goed &= controleer("een vast bedrag met item leest als som",
                           s["rijen"][1]["wat"] == "120,000 shards + 5× banknote chip",
                           s["rijen"][1]["wat"])
        goed &= controleer("een rij zonder shards toont geen nul",
                           s["rijen"][2]["wat"] == "1× coin chest", s["rijen"][2]["wat"])
        goed &= controleer("de wachttijd komt uit het antwoord",
                           "every 12 hours" in s["tekst"], s["tekst"][:200])
        goed &= controleer("het aantal stemmen per dag is gerekend",
                           "so 4 rolls a day" in s["tekst"] or "4 rolls a day" in s["tekst"],
                           [r for r in s["tekst"].split("\n") if "rolls a day" in r])
        goed &= controleer("er staat geen los bedrag in de HTML",
                           "250,000" not in open("index.html", encoding="utf-8").read())
        goed &= controleer("de kop is echt te lezen na scrollen", zichtbare_kop(page),
                           "de reveal-animatie heeft hem niet vrijgegeven")
        page.close()

        # --- de vlag staat uit --------------------------------------------
        print("De vlag `vote` staat uit")
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        open_met(page, status=503, vlaggen={"vote": False})
        s = stand(page)
        goed &= controleer("de sectie blijft weg", not s.get("zichtbaar"), str(s)[:160])
        goed &= controleer("de voetnootlink blijft ook weg", page.evaluate(
            """() => {
              const a = [...document.querySelectorAll('.footer-col a')]
                  .find((x) => x.textContent.includes('Vote'));
              return !a || a.hasAttribute('hidden') || getComputedStyle(a).display === 'none';
            }"""))
        page.close()

        # --- de backend is weg --------------------------------------------
        print("De backend antwoordt niet")
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.route("**/api/**", lambda r: r.fulfill(
            status=200, content_type="application/json", body="{}"))
        page.route("**/api/site/vote", lambda r: r.abort())
        page.goto(f"{BASIS}/index.html", wait_until="domcontentloaded")
        page.wait_for_timeout(1600)
        s = stand(page)
        goed &= controleer("geen halve sectie", not s.get("zichtbaar"), str(s)[:160])
        goed &= controleer("de rest van de pagina staat er nog", page.evaluate(
            """() => !!document.querySelector('.final-inner h2')"""))
        page.close()

        # --- een leeg antwoord --------------------------------------------
        print("Een leeg antwoord (onleesbare config)")
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        open_met(page, vote={"cooldown_hours": 12, "sites": [], "rewards": []})
        goed &= controleer("geen sectie zonder lijsten", not stand(page).get("zichtbaar"))
        page.close()

        # --- een link die geen https is -----------------------------------
        print("Een stemlink die geen https is")
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        kwaad = json.loads(json.dumps(ANTWOORD))
        kwaad["sites"][0]["url"] = "javascript:alert(1)"
        open_met(page, vote=kwaad)
        s = stand(page)
        goed &= controleer("alleen de https-knop blijft",
                           [k["tekst"] for k in s["knoppen"]] == ["Vote on Discord Bot List"],
                           str(s["knoppen"]))
        page.close()

        # --- telefoon ------------------------------------------------------
        print("Telefoon (390 breed)")
        page = browser.new_page(viewport={"width": 390, "height": 844})
        open_met(page)
        s = stand(page)
        goed &= controleer("de sectie past en is zichtbaar", s.get("zichtbaar"))
        goed &= controleer("de kop is echt te lezen na scrollen", zichtbare_kop(page),
                           "de reveal-animatie heeft hem niet vrijgegeven")
        goed &= controleer("de pagina schuift niet zijwaarts", page.evaluate(
            """() => document.documentElement.scrollWidth <= window.innerWidth + 1"""),
            str(page.evaluate("() => document.documentElement.scrollWidth")))
        page.close()

        browser.close()

    print("\n" + ("ALLES GOED" if goed else "ER ZIJN FOUTEN"))
    return 0 if goed else 1


if __name__ == "__main__":
    sys.exit(main())
