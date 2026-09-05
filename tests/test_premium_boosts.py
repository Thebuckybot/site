"""De vier Security Boosts op buckybot.app/premium, uit de catalogus.

Speelt /api/premium/tiers na met vier tiers en vier boosts en leest wat een
bezoeker ziet: een tweede blok onder de tiers, per kaart de prijs mét korting
uit de data, de looptijd uit `duration_days`, en de koopknop naar Discord. En
zonder boostrijen blijft het blok verborgen in plaats van leeg.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_premium_boosts.py
"""

import json
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright   # noqa: E402

BASIS = "http://127.0.0.1:8899"


def _tier(key, rank, name, price):
    return {"tier_key": key, "tier_rank": rank, "name": name, "price": price, "badge": None,
            "badge_url": None, "sku_id": str(1000 + rank), "store_url": f"https://discord.com/s/{rank}",
            "boost": 1.2, "challenge_bonus": 25, "shards_monthly": 6250000, "cache_key": "small",
            "contents": ["50x Pixel Banknote"], "featured": False, "kind": "tier", "duration_days": None}


def _boost(key, rank, name, price, days):
    return {"tier_key": key, "tier_rank": rank, "name": name, "price": price, "badge": None,
            "badge_url": None, "sku_id": str(2000 + rank), "store_url": f"https://discord.com/s/{rank}",
            "boost": 1.0, "challenge_bonus": 0, "shards_monthly": 0, "cache_key": None,
            "contents": ["Security logs kept 1 year instead of 14 days", "30 detection rules instead of 10",
                         "25 recovery snapshots instead of 10"],
            "featured": False, "kind": "boost", "duration_days": days}


TIERS = [_tier("bucky_plus", 1, "Bucky+", "$4.99 / month"), _tier("elite", 3, "Elite", "$14.99 / month")]
BOOSTS = [_boost("boost_1m", 101, "Security Boost - 1 Month", "$4.99", 30),
          _boost("boost_3m", 102, "Security Boost - 3 Months", "$12.99 (13% off)", 90),
          _boost("boost_6m", 103, "Security Boost - 6 Months", "$22.99 (23% off)", 180),
          _boost("boost_12m", 104, "Security Boost - 1 Year", "$39.99 (33% off)", 365)]


def open_premium(page, rows):
    page.route("**/api/site/features", lambda r: r.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({"features": {"premium": True}})))
    page.route("**/api/premium/me", lambda r: r.fulfill(
        status=200, content_type="application/json", body=json.dumps({"signed_in": False})))
    page.route("**/api/premium/tiers", lambda r: r.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({"available": True, "tiers": rows})))
    page.goto(f"{BASIS}/premium.html", wait_until="domcontentloaded")
    page.wait_for_selector("#pr-grid .pr-card", timeout=15000)
    return page


def main():
    fouten = []

    def check(ok, tekst):
        print(("  OK   " if ok else "  FOUT ") + tekst)
        if not ok:
            fouten.append(tekst)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context()

        page = open_premium(ctx.new_page(), TIERS + BOOSTS)
        check(page.locator("#pr-grid .pr-card").count() == 2, "de tiers staan in het eerste raster, zonder de boosts")
        check(not page.locator("#pr-boosts").is_hidden(), "het boostblok is zichtbaar als er boostrijen zijn")
        kaarten = page.locator("#pr-boost-grid .pr-card-boost")
        check(kaarten.count() == 4, "vier boostkaarten")
        titels = [kaarten.nth(i).locator(".pr-card-title").inner_text() for i in range(4)]
        check(titels == ["Security Boost - 1 Month", "Security Boost - 3 Months",
                         "Security Boost - 6 Months", "Security Boost - 1 Year"], f"de titels in looptijdvolgorde: {titels}")
        prijzen = [kaarten.nth(i).locator(".pr-price").inner_text() for i in range(4)]
        check(prijzen == ["$4.99", "$12.99 (13% off)", "$22.99 (23% off)", "$39.99 (33% off)"],
              f"de prijzen mét korting uit de data: {prijzen}")
        tekst = kaarten.nth(1).inner_text()
        check("3 months, from the day you assign it" in tekst, "de looptijd komt uit duration_days")
        # de uitklap is dicht: text_content leest wat er IN staat, inner_text alleen wat zichtbaar is
        check("30 detection rules instead of 10" in kaarten.nth(1).text_content(),
              "wat de server krijgt staat in de uitklap")
        kaarten.nth(1).locator("summary").click()
        check("30 detection rules instead of 10" in kaarten.nth(1).inner_text(),
              "en na een klik op de uitklap is het te zien")
        knop = kaarten.nth(3).locator("a.pr-buy")
        check(knop.inner_text().startswith("Buy 1 year") and knop.get_attribute("href") == "https://discord.com/s/104",
              "de koopknop noemt de looptijd en linkt naar de winkel")

        page = open_premium(ctx.new_page(), TIERS)
        check(page.locator("#pr-boosts").is_hidden(), "zonder boostrijen blijft het blok verborgen")

        browser.close()
    if fouten:
        print(f"\n{len(fouten)} fout(en)")
        return 1
    print("\nalles klopt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
