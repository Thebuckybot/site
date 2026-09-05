"""De snapshotpagina toont het aantal dat de server MAG bewaren, uit de payload.

Op 5 september 2026 stond hier "2 of 10" voor een server met een actieve
Security Boost: de boost had `snapshot_keep = 25` geschreven, de backend gaf
`keep: 25` terug, en de pagina drukte een letterlijke 10 af. Deze test speelt de
backend na met precies die payload en leest wat een bezoeker ziet. De keten
daarvóór (bot -> kolommen -> backend-payload) staat in
bucky1.0/tests/test_boost_keten.py.

DRAAIEN:
    cd site && python -m http.server 8899
    python tests/test_boost_snapshots.py
"""

import json
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright   # noqa: E402

BASIS = "http://127.0.0.1:8899"
GID = "1392872457475592243"


def _snapshot(i):
    return {"id": i, "name": None, "reason": "scheduled", "source": "scheduled",
            "suitability": "scheduled", "usable": True, "schema_version": 3,
            "capability_version": 3, "trust_state": "trusted", "fr_eligible": True,
            "coverage": None, "content_hash": "abc%d" % i, "content_hash_short": "abc%d" % i,
            "channel_count": 5, "role_count": 3, "incident_id": None, "taken_by": None,
            "created_at": "2026-09-0%dT10:00:00" % i, "is_current": False}


def open_snapshots(page, *, keep, retention_days, aantal=2):
    """Laadt de snapshotpagina met een nagespeelde backend."""
    def ok(data):
        return dict(status=200, content_type="application/json",
                    body=json.dumps({"ok": True, "data": data}))

    # De vangnetroute eerst: Playwright probeert de laatst geregistreerde route
    # het eerst, dus de specifieke routes hieronder winnen.
    page.route("**/api/**", lambda route: route.fulfill(**ok({})))
    page.route("**/api/site/features", lambda route: route.fulfill(
        status=200, content_type="application/json",
        body=json.dumps({"features": {"soc": True, "security_center": True, "rule_builder": True}})))
    page.route(f"**/api/security/{GID}/me", lambda route: route.fulfill(
        **ok({"can_edit": True, "role": "owner"})))
    page.route(f"**/api/security/{GID}/snapshots", lambda route: route.fulfill(**ok({
        "snapshots": [_snapshot(i) for i in range(1, aantal + 1)],
        "current_snapshot_id": None, "has_usable": True, "capabilities": {},
        "keep": keep, "retention_days": retention_days,
    })))
    page.goto(f"{BASIS}/security.html?guild_id={GID}#snapshots", wait_until="domcontentloaded")
    page.wait_for_selector("text=Stored snapshots", timeout=15000)
    return page.inner_text("body")


def main():
    fouten = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context()

        page = ctx.new_page()
        tekst = open_snapshots(page, keep=25, retention_days=365)
        if "2 of 25 ·" in tekst:
            print("  OK   een geboostte server toont '2 of 25'")
        else:
            fouten.append("geboost: '2 of 25' ontbreekt")
            print("  FOUT geboost: '2 of 25' ontbreekt")
        if "of 10" in tekst:
            fouten.append("geboost: er staat nog een 'of 10' op de pagina")
            print("  FOUT geboost: er staat nog een 'of 10' op de pagina")
        if "newest 25 snapshots" in tekst and "365 days" in tekst:
            print("  OK   de retentietekst leest 25 en 365 uit de payload")
        else:
            fouten.append("geboost: de retentietekst leest niet uit de payload")
            print("  FOUT geboost: de retentietekst leest niet uit de payload")

        page = ctx.new_page()
        tekst = open_snapshots(page, keep=10, retention_days=14)
        if "2 of 10 ·" in tekst and "newest 10 snapshots" in tekst and "14 days" in tekst:
            print("  OK   een gratis server toont '2 of 10' en 14 dagen")
        else:
            fouten.append("gratis: '2 of 10' of '14 days' ontbreekt")
            print("  FOUT gratis: '2 of 10' of '14 days' ontbreekt")

        browser.close()
    if fouten:
        print(f"\n{len(fouten)} fout(en)")
        return 1
    print("\nalles klopt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
