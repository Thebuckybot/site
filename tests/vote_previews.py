"""Previews van de stemsectie, desktop en telefoon.

Draait NIET op verzonnen data: het antwoord komt door de echte normalisatie van
`backend/services/site_vote.py` over het geleverde `earnings/vote.json`. Wat op
de plaat staat is dus precies wat een bezoeker straks ziet, inclusief de acht
beloningen en hun kansen.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/vote_previews.py <uitvoermap>
"""

import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright        # noqa: E402

HIER = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(os.path.dirname(HIER))
sys.path.insert(0, os.path.join(PROJECT, "backend"))
from services import site_vote                        # noqa: E402

BASIS = "http://127.0.0.1:8899"
UIT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HIER, "..", "..", "docs", "vote-previews")
os.makedirs(UIT, exist_ok=True)

with open(os.path.join(PROJECT, "bucky1.0", "cogs", "data", "currency",
                       "datacurrency", "earnings", "vote.json"), encoding="utf-8") as fh:
    ECHT = site_vote.normaliseer(json.load(fh))


def plaat(browser, naam, breedte, hoogte):
    page = browser.new_page(viewport={"width": breedte, "height": hoogte},
                            device_scale_factor=2)
    page.route("**/api/**", lambda r: r.fulfill(
        status=200, content_type="application/json", body="{}"))
    page.route("**/api/site/features", lambda r: r.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({"features": {"vote": True, "dashboard": True}})))
    page.route("**/api/site/vote", lambda r: r.fulfill(
        status=200, content_type="application/json", body=json.dumps(ECHT)))
    page.goto(f"{BASIS}/index.html", wait_until="domcontentloaded")
    page.wait_for_selector("#vote:not([hidden])", timeout=15000)
    # De kop komt met een reveal-animatie binnen, en op de telefoon pas als hij
    # in beeld is. Zonder dit staat er een plaat met twee panelen en een gat
    # waar de titel hoort - en dan lijkt de sectie kapot terwijl hij klopt.
    page.evaluate("""() => document.getElementById("vote")
        .scrollIntoView({block: "center"})""")
    page.wait_for_function("""() => {
      const h = document.querySelector("#vote .section-head");
      return h && Number(getComputedStyle(h).opacity) > 0.95;
    }""", timeout=10000)
    page.wait_for_timeout(600)
    pad = os.path.join(UIT, naam)
    page.locator("#vote").screenshot(path=pad)
    print(f"  {naam}  ({breedte}x{hoogte})")
    page.close()
    return pad


def main():
    print(f"De echte tabel: {len(ECHT['rewards'])} beloningen, "
          f"{len(ECHT['sites'])} lijsten, {ECHT['cooldown_hours']} uur wachttijd")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        plaat(browser, "desktop.png", 1440, 1000)
        plaat(browser, "tablet.png", 900, 1100)
        plaat(browser, "mobile.png", 390, 844)
        browser.close()
    print(f"In {os.path.abspath(UIT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
